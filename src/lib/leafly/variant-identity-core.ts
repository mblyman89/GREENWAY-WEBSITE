/**
 * VARIANT IDENTITY -- what Leafly can and cannot tell apart.
 *
 * WHY THIS FILE EXISTS
 *
 * The owner sent 8 products to Leafly. Leafly accepted all 8. The read-back then
 * reported four errors of the form:
 *
 *   Size/variant "pos-406a50c84648-b8c643bfe6ae" of "Ceres Dragon Balm CBD RED"
 *   is missing from Leafly's menu.
 *
 * The read-back was right: those variant ids really were absent. The question was
 * why, and the answer is not in the transport, the credentials, or the ids. It is
 * in the shape of Leafly's variant object.
 *
 * A Leafly variant describes its size with exactly two fields: `amount` and
 * `unit`. That pair is the ONLY size descriptor in the schema (see
 * docs/leafly-menu-api-v2.md, "Variant"). There is no `label`, no `name`, no
 * `size` string. So two variants of the same item that carry the same
 * amount+unit are not "two similar sizes" to Leafly -- they are the same size
 * described twice, and only one of them survives.
 *
 * That collision is easy to create without noticing, because of a rule that is
 * correct on its own terms. `variantAmountAndUnit()` in payload-core maps every
 * variant of a COUNTED type (Accessory, Seeds, Clone, Edible, PreRoll, Topical,
 * Other) to `amount: 1, unit: "each"`, since a variant IS one saleable package
 * and Leafly allows no other unit for those types. MIXED types (Concentrate,
 * Cartridge) do the same whenever the label carries no readable weight. Both
 * behaviours are deliberate and documented. Neither is wrong. But together with
 * a product that has two sizes, they produce two identical descriptors.
 *
 * So this is not a bug in a function. Every function involved does exactly what
 * its documentation says. It is a bug in a COMBINATION -- the same shape as the
 * read-back scope defect -- and it only becomes visible when a multi-size
 * counted-type product is pushed, which is what happened the first time the
 * owner pushed a topical and three vape products.
 *
 * WHAT THIS MODULE ADDS
 *
 * One idea, stated once: the size key Leafly sees. Everything else -- the
 * pre-flight warning in the picker, the validator finding, and the explanation
 * attached to a read-back error -- is derived from it, so the prediction we make
 * before sending and the diagnosis we offer afterwards cannot drift apart. They
 * are the same function.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not silently merge or drop the colliding variants. Dropping a size is
 * a pricing decision on a cannabis menu, and the shop -- not this file -- has to
 * make it. Our job is to make the collision impossible to miss BEFORE the push,
 * not to quietly pick a winner afterwards. A menu that silently loses a size is
 * exactly the kind of thing nobody notices until a customer is standing at the
 * counter asking for it.
 *
 * PURE: no React, no DOM, no I/O, no `server-only`. Runs under tsx directly.
 */

// ---------------------------------------------------------------------------
// The size key
// ---------------------------------------------------------------------------

/** The two fields Leafly uses to describe a variant's size. */
export type VariantSize = {
  amount: number;
  unit: string;
};

/**
 * The identity Leafly sees for one variant's size.
 *
 * NOTE WHAT IS NOT IN HERE. Not the id -- Leafly stores the id but does not use
 * it to decide whether two variants are the same size. Not the price -- two
 * variants at $10 and $20 with the same amount+unit are still one size as far as
 * the size descriptor is concerned, and treating price as part of identity would
 * make us predict "distinct" for a pair Leafly will still collapse. Not the
 * label -- the label never leaves our system; `variantAmountAndUnit()` consumes
 * it and emits amount+unit, and the label is not a field in Leafly's variant
 * schema at all.
 *
 * Including any of those would make this function describe OUR data model rather
 * than Leafly's, and the whole point is to predict what LEAFLY will do.
 *
 * Numbers are normalised through `Number()` so that `3.50` and `3.5` -- which are
 * the same number and will serialise to the same JSON -- produce the same key.
 * Unit is lower-cased and trimmed: the schema enum is lowercase (`oz`, `g`,
 * `each`), and a stray `"G"` describes the same size as `"g"`.
 */
export function variantSizeKey(v: VariantSize): string {
  const amount = Number.isFinite(v.amount) ? Number(v.amount) : NaN;
  const unit = String(v.unit ?? "").trim().toLowerCase();
  // NaN is not a size. Key it distinctly so two unparseable amounts are not
  // reported as "the same size" -- they are both broken, which is a different
  // finding, and the validator already covers a non-numeric amount.
  const amountKey = Number.isFinite(amount) ? String(amount) : "nan";
  return `${amountKey}|${unit}`;
}

/** Human-readable rendering of a size, for messages. `3.5g`, `1 each`. */
export function describeVariantSize(v: VariantSize): string {
  const amount = Number.isFinite(v.amount) ? Number(v.amount) : NaN;
  const unit = String(v.unit ?? "").trim().toLowerCase();
  if (!Number.isFinite(amount)) return `(unreadable size)`;
  // "each" reads better with a space; weights read better without one.
  return unit === "each" ? `${amount} each` : `${amount}${unit}`;
}

// ---------------------------------------------------------------------------
// Collision detection
// ---------------------------------------------------------------------------

export type IdentifiedVariant = {
  id: string;
  amount: number;
  unit: string;
};

/** One group of variants that Leafly cannot tell apart. */
export type VariantCollision = {
  /** The shared size key. */
  key: string;
  /** Human-readable shared size, e.g. `1 each`. */
  size: string;
  /** Every variant id in the group, in the order they appear in the payload. */
  variantIds: string[];
  /**
   * The id Leafly is most likely to keep. Leafly's behaviour on duplicates is
   * not documented, so this is explicitly a GUESS about their side and is named
   * as one -- it is the first occurrence, which is the conventional outcome of
   * an upsert keyed on a descriptor. It is used only to phrase the message, and
   * never to decide what we send.
   */
  likelyKeptId: string;
  /** The ids that will probably NOT come back. `variantIds` minus `likelyKeptId`. */
  likelyLostIds: string[];
};

/**
 * Find every group of variants within ONE item that share a size key.
 *
 * Scoped to a single item on purpose. Leafly's variant ids are unique across the
 * whole menu, but "the same size" is only a meaningful collision WITHIN an item
 * -- a 1g of one product and a 1g of another are genuinely different variants and
 * must never be reported as colliding. Comparing across items would generate a
 * finding on essentially every menu, which is the definition of a warning nobody
 * reads.
 *
 * Returns `[]` when every variant is distinguishable. That empty result is the
 * negative control this module is built around: a correct item must produce
 * silence, or the warning is worthless.
 */
export function findVariantCollisions(variants: readonly IdentifiedVariant[]): VariantCollision[] {
  const groups = new Map<string, IdentifiedVariant[]>();
  const order: string[] = [];

  for (const v of variants) {
    const key = variantSizeKey(v);
    const existing = groups.get(key);
    if (existing) {
      existing.push(v);
    } else {
      groups.set(key, [v]);
      order.push(key);
    }
  }

  const out: VariantCollision[] = [];
  for (const key of order) {
    const group = groups.get(key);
    if (!group || group.length < 2) continue;
    const ids = group.map((v) => String(v.id));
    out.push({
      key,
      size: describeVariantSize(group[0]),
      variantIds: ids,
      likelyKeptId: ids[0],
      likelyLostIds: ids.slice(1),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Item-level summary
// ---------------------------------------------------------------------------

export type ItemVariantIdentity = {
  itemId: string;
  itemName: string;
  /** How many variants we will send. */
  sentCount: number;
  /** How many DISTINCT sizes Leafly will be able to see. */
  distinctCount: number;
  /** sentCount - distinctCount. The number of sizes that will be lost. */
  lostCount: number;
  collisions: VariantCollision[];
};

export function assessItemVariantIdentity(input: {
  itemId: string;
  itemName: string;
  variants: readonly IdentifiedVariant[];
}): ItemVariantIdentity {
  const collisions = findVariantCollisions(input.variants);
  const sentCount = input.variants.length;
  const distinctCount = new Set(input.variants.map(variantSizeKey)).size;
  return {
    itemId: input.itemId,
    itemName: input.itemName,
    sentCount,
    distinctCount,
    lostCount: Math.max(0, sentCount - distinctCount),
    collisions,
  };
}

/**
 * Owner-facing explanation of one item's collisions.
 *
 * Returns `null` when there is nothing wrong. A function that always returns a
 * sentence trains the reader to skip it.
 */
export function describeItemVariantIdentity(a: ItemVariantIdentity): string | null {
  if (a.collisions.length === 0) return null;

  const sizeWord = a.lostCount === 1 ? "size" : "sizes";
  const parts = a.collisions.map((c) => {
    const lost = c.likelyLostIds.length;
    return `${c.variantIds.length} of its sizes are all described to Leafly as "${c.size}", so ${lost} ${lost === 1 ? "of them" : "of them"} will be dropped`;
  });

  return (
    `"${a.itemName}" will lose ${a.lostCount} ${sizeWord}. ` +
    `${parts.join("; ")}. ` +
    `Leafly identifies a size only by its amount and unit, so sizes that come out ` +
    `to the same amount and unit are the same size to them.`
  );
}

/**
 * The remedy for a size collision, worded for the type it actually applies to.
 *
 * WHY THIS IS NOT ONE FIXED SENTENCE.
 *
 * The obvious advice -- "give these sizes distinct weights in their labels" --
 * is good advice for a Cartridge or a Concentrate, because those types accept
 * `g` as well as `each`, so a label carrying a real weight produces a distinct
 * size. It is IMPOSSIBLE advice for a Topical, a PreRoll or an Edible: Leafly
 * allows those types no unit but `each`, so every variant is `1 each` no matter
 * what the label says. Relabelling a topical "1oz" and "2oz" changes nothing --
 * verified by running the real mapper, not assumed.
 *
 * Telling a shop owner to do something that cannot work costs him an afternoon
 * and costs us his trust in every other message on the page. So the caller
 * passes the units Leafly permits for the type, and the wording follows.
 *
 * `weightCapable` is derived rather than hard-coded against a list of type
 * names, so a change to Leafly's unit matrix updates the advice automatically.
 */
export function remedyForCollision(legalUnits: readonly string[]): string {
  const weightCapable = legalUnits.some((u) => u !== "each");
  if (weightCapable) {
    return (
      `Give these sizes distinct weights in their labels (for example "1g" and "3.5g"), or ` +
      `sell them as separate products.`
    );
  }
  return (
    `Leafly allows only "each" for this product type, so relabelling the sizes cannot ` +
    `separate them — list them as separate products instead.`
  );
}

// ---------------------------------------------------------------------------
// Payload-level summary
// ---------------------------------------------------------------------------

export type PayloadItemLike = {
  id: string;
  name: string;
  variants: readonly IdentifiedVariant[];
};

export type PayloadVariantIdentity = {
  /** Items that will lose at least one size. */
  affected: ItemVariantIdentity[];
  /** Total variants across the whole payload. */
  totalVariants: number;
  /** Total distinct sizes Leafly will end up holding. */
  totalDistinct: number;
  /** totalVariants - totalDistinct. */
  totalLost: number;
};

export function assessPayloadVariantIdentity(
  items: readonly PayloadItemLike[],
): PayloadVariantIdentity {
  const affected: ItemVariantIdentity[] = [];
  let totalVariants = 0;
  let totalDistinct = 0;

  for (const item of items) {
    const a = assessItemVariantIdentity({
      itemId: item.id,
      itemName: item.name,
      variants: item.variants,
    });
    totalVariants += a.sentCount;
    totalDistinct += a.distinctCount;
    if (a.collisions.length > 0) affected.push(a);
  }

  return {
    affected,
    totalVariants,
    totalDistinct,
    totalLost: Math.max(0, totalVariants - totalDistinct),
  };
}

/**
 * One sentence summarising a whole payload. `null` when the payload is clean.
 */
export function describePayloadVariantIdentity(p: PayloadVariantIdentity): string | null {
  if (p.affected.length === 0) return null;
  const itemWord = p.affected.length === 1 ? "product" : "products";
  const sizeWord = p.totalLost === 1 ? "size" : "sizes";
  return (
    `${p.affected.length} ${itemWord} will lose ${p.totalLost} ${sizeWord} because Leafly ` +
    `cannot tell those sizes apart. Leafly identifies a size only by its amount and unit ` +
    `(for example "1 each" or "3.5g"), and these products have sizes that come out the same.`
  );
}

// ---------------------------------------------------------------------------
// Explaining a read-back error after the fact
// ---------------------------------------------------------------------------

/**
 * Given the variants we SENT for one item and a variant id Leafly did NOT return,
 * say why -- but only when we can actually prove it.
 *
 * This is the half that makes the module honest. It is easy to write an
 * explainer that always has an answer; such an explainer is just a guess with
 * good grammar. This one returns `null` unless the missing id was part of a
 * genuine collision in the payload we sent, in which case the explanation is a
 * fact about our own data rather than a theory about Leafly's behaviour.
 *
 * When it returns null the caller keeps the plain "missing" error, which is the
 * correct thing to show for a cause we have not established.
 */
export function explainMissingVariant(input: {
  missingVariantId: string;
  sentVariants: readonly IdentifiedVariant[];
}): string | null {
  const missingId = String(input.missingVariantId);
  const collisions = findVariantCollisions(input.sentVariants);

  for (const c of collisions) {
    if (!c.variantIds.includes(missingId)) continue;
    const others = c.variantIds.filter((id) => id !== missingId);
    return (
      `This size was sent to Leafly as "${c.size}", and so ${others.length === 1 ? "was" : "were"} ` +
      `${others.length} other ${others.length === 1 ? "size" : "sizes"} of the same product ` +
      `(${others.join(", ")}). Leafly identifies a size only by its amount and unit, so it kept ` +
      `one and discarded the rest. This is not a transmission failure — the data arrived, but ` +
      `two sizes described themselves identically.`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runLeaflyVariantIdentityTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`leafly-variant-identity FAIL: ${label}`);
    }
  };

  // --- variantSizeKey ------------------------------------------------------
  ok("same amount+unit -> same key", variantSizeKey({ amount: 1, unit: "each" }) === variantSizeKey({ amount: 1, unit: "each" }));
  ok("different unit -> different key", variantSizeKey({ amount: 1, unit: "each" }) !== variantSizeKey({ amount: 1, unit: "g" }));
  ok("different amount -> different key", variantSizeKey({ amount: 1, unit: "g" }) !== variantSizeKey({ amount: 3.5, unit: "g" }));
  ok("3.50 and 3.5 are one size", variantSizeKey({ amount: 3.5, unit: "g" }) === variantSizeKey({ amount: 3.50, unit: "g" }));
  ok("unit case folded", variantSizeKey({ amount: 1, unit: "G" }) === variantSizeKey({ amount: 1, unit: "g" }));
  ok("unit whitespace trimmed", variantSizeKey({ amount: 1, unit: " g " }) === variantSizeKey({ amount: 1, unit: "g" }));
  ok("NaN amount keyed distinctly", variantSizeKey({ amount: NaN, unit: "g" }) === "nan|g");
  ok("integer 1 and 1.0 are one size", variantSizeKey({ amount: 1, unit: "each" }) === variantSizeKey({ amount: 1.0, unit: "each" }));

  // Price and id are deliberately NOT part of identity. Proven by constructing
  // two variants that differ ONLY in those and asserting they still collide.
  {
    const collisions = findVariantCollisions([
      { id: "a", amount: 1, unit: "each" },
      { id: "b", amount: 1, unit: "each" },
    ]);
    ok("id is not part of size identity", collisions.length === 1);
  }

  // --- describeVariantSize -------------------------------------------------
  ok("weight rendered tight", describeVariantSize({ amount: 3.5, unit: "g" }) === "3.5g");
  ok("each rendered with space", describeVariantSize({ amount: 1, unit: "each" }) === "1 each");
  ok("unreadable size described", describeVariantSize({ amount: NaN, unit: "g" }) === "(unreadable size)");
  ok("oz rendered tight", describeVariantSize({ amount: 1, unit: "oz" }) === "1oz");

  // --- findVariantCollisions: the NEGATIVE CONTROL first -------------------
  ok(
    "distinct weights produce NO finding",
    findVariantCollisions([
      { id: "v1", amount: 3.5, unit: "g" },
      { id: "v2", amount: 7, unit: "g" },
      { id: "v3", amount: 14, unit: "g" },
    ]).length === 0,
  );
  ok("single variant produces no finding", findVariantCollisions([{ id: "v1", amount: 1, unit: "each" }]).length === 0);
  ok("empty list produces no finding", findVariantCollisions([]).length === 0);
  ok(
    "same amount different unit does not collide",
    findVariantCollisions([
      { id: "v1", amount: 1, unit: "g" },
      { id: "v2", amount: 1, unit: "each" },
    ]).length === 0,
  );

  // --- findVariantCollisions: the real case --------------------------------
  {
    const c = findVariantCollisions([
      { id: "pos-406a50c84648-aaa", amount: 1, unit: "each" },
      { id: "pos-406a50c84648-b8c643bfe6ae", amount: 1, unit: "each" },
    ]);
    ok("two counted variants collide", c.length === 1);
    ok("collision lists both ids", c[0].variantIds.length === 2);
    ok("collision size described", c[0].size === "1 each");
    ok("first id is the likely keeper", c[0].likelyKeptId === "pos-406a50c84648-aaa");
    ok("second id is the likely loss", c[0].likelyLostIds.length === 1 && c[0].likelyLostIds[0] === "pos-406a50c84648-b8c643bfe6ae");
  }
  {
    const c = findVariantCollisions([
      { id: "a", amount: 1, unit: "each" },
      { id: "b", amount: 1, unit: "each" },
      { id: "c", amount: 1, unit: "each" },
    ]);
    ok("three-way collision is one group", c.length === 1);
    ok("three-way keeps one", c[0].likelyKeptId === "a");
    ok("three-way loses two", c[0].likelyLostIds.length === 2);
  }
  {
    // Two separate collisions in one item.
    const c = findVariantCollisions([
      { id: "a", amount: 1, unit: "each" },
      { id: "b", amount: 1, unit: "each" },
      { id: "c", amount: 2, unit: "g" },
      { id: "d", amount: 2, unit: "g" },
    ]);
    ok("two distinct collision groups", c.length === 2);
    ok("groups reported in first-seen order", c[0].size === "1 each" && c[1].size === "2g");
  }
  {
    // Mixed: one colliding pair plus one genuinely distinct size.
    const c = findVariantCollisions([
      { id: "a", amount: 1, unit: "each" },
      { id: "b", amount: 1, unit: "each" },
      { id: "c", amount: 3.5, unit: "g" },
    ]);
    ok("distinct size excluded from collision group", c.length === 1 && c[0].variantIds.length === 2);
    ok("distinct size id absent from group", !c[0].variantIds.includes("c"));
  }

  // --- assessItemVariantIdentity -------------------------------------------
  {
    const a = assessItemVariantIdentity({
      itemId: "i1",
      itemName: "Ceres Dragon Balm CBD RED",
      variants: [
        { id: "v1", amount: 1, unit: "each" },
        { id: "v2", amount: 1, unit: "each" },
      ],
    });
    ok("sent count is 2", a.sentCount === 2);
    ok("distinct count is 1", a.distinctCount === 1);
    ok("lost count is 1", a.lostCount === 1);
    ok("one collision", a.collisions.length === 1);
  }
  {
    const a = assessItemVariantIdentity({
      itemId: "i2",
      itemName: "Khush Kush",
      variants: [
        { id: "v1", amount: 3.5, unit: "g" },
        { id: "v2", amount: 7, unit: "g" },
        { id: "v3", amount: 14, unit: "g" },
      ],
    });
    ok("clean item: sent 3", a.sentCount === 3);
    ok("clean item: distinct 3", a.distinctCount === 3);
    ok("clean item: lost 0", a.lostCount === 0);
    ok("clean item: no collisions", a.collisions.length === 0);
  }
  {
    const a = assessItemVariantIdentity({ itemId: "i3", itemName: "Empty", variants: [] });
    ok("no variants: sent 0", a.sentCount === 0);
    ok("no variants: lost 0", a.lostCount === 0);
  }

  // --- describeItemVariantIdentity -----------------------------------------
  {
    const clean = assessItemVariantIdentity({
      itemId: "i",
      itemName: "Fine",
      variants: [
        { id: "a", amount: 3.5, unit: "g" },
        { id: "b", amount: 7, unit: "g" },
      ],
    });
    ok("clean item explains nothing (negative control)", describeItemVariantIdentity(clean) === null);
  }
  {
    const dirty = assessItemVariantIdentity({
      itemId: "i",
      itemName: "Ceres Dragon Balm CBD RED",
      variants: [
        { id: "a", amount: 1, unit: "each" },
        { id: "b", amount: 1, unit: "each" },
      ],
    });
    const msg = describeItemVariantIdentity(dirty);
    ok("dirty item explains something", typeof msg === "string" && msg.length > 0);
    ok("explanation names the product", (msg ?? "").includes("Ceres Dragon Balm CBD RED"));
    ok("explanation names the size", (msg ?? "").includes("1 each"));
    ok("explanation uses singular size for 1 lost", (msg ?? "").includes("lose 1 size"));
  }
  {
    const two = assessItemVariantIdentity({
      itemId: "i",
      itemName: "Three Sizes",
      variants: [
        { id: "a", amount: 1, unit: "each" },
        { id: "b", amount: 1, unit: "each" },
        { id: "c", amount: 1, unit: "each" },
      ],
    });
    ok("plural sizes when 2 lost", (describeItemVariantIdentity(two) ?? "").includes("lose 2 sizes"));
  }

  // --- assessPayloadVariantIdentity ----------------------------------------
  {
    const p = assessPayloadVariantIdentity([
      {
        id: "i1",
        name: "Ceres",
        variants: [
          { id: "a", amount: 1, unit: "each" },
          { id: "b", amount: 1, unit: "each" },
        ],
      },
      {
        id: "i2",
        name: "Khush",
        variants: [
          { id: "c", amount: 3.5, unit: "g" },
          { id: "d", amount: 7, unit: "g" },
        ],
      },
    ]);
    ok("payload: one affected item", p.affected.length === 1);
    ok("payload: affected is the right item", p.affected[0].itemId === "i1");
    ok("payload: total variants 4", p.totalVariants === 4);
    ok("payload: total distinct 3", p.totalDistinct === 3);
    ok("payload: total lost 1", p.totalLost === 1);
  }
  {
    const clean = assessPayloadVariantIdentity([
      { id: "i1", name: "A", variants: [{ id: "a", amount: 3.5, unit: "g" }] },
      { id: "i2", name: "B", variants: [{ id: "b", amount: 1, unit: "each" }] },
    ]);
    ok("clean payload: no affected", clean.affected.length === 0);
    ok("clean payload: lost 0", clean.totalLost === 0);
    ok("clean payload describes nothing (negative control)", describePayloadVariantIdentity(clean) === null);
  }
  {
    // CRITICAL: the same size in two DIFFERENT items must never collide.
    const p = assessPayloadVariantIdentity([
      { id: "i1", name: "A", variants: [{ id: "a", amount: 1, unit: "each" }] },
      { id: "i2", name: "B", variants: [{ id: "b", amount: 1, unit: "each" }] },
    ]);
    ok("same size across different items does NOT collide", p.affected.length === 0);
    ok("cross-item: lost 0", p.totalLost === 0);
  }
  {
    const p = assessPayloadVariantIdentity([
      {
        id: "i1",
        name: "A",
        variants: [
          { id: "a", amount: 1, unit: "each" },
          { id: "b", amount: 1, unit: "each" },
        ],
      },
      {
        id: "i2",
        name: "B",
        variants: [
          { id: "c", amount: 1, unit: "each" },
          { id: "d", amount: 1, unit: "each" },
        ],
      },
    ]);
    const msg = describePayloadVariantIdentity(p);
    ok("two affected items described", (msg ?? "").includes("2 products"));
    ok("two lost sizes described", (msg ?? "").includes("lose 2 sizes"));
  }
  {
    const p = assessPayloadVariantIdentity([
      {
        id: "i1",
        name: "A",
        variants: [
          { id: "a", amount: 1, unit: "each" },
          { id: "b", amount: 1, unit: "each" },
        ],
      },
    ]);
    ok("one affected item uses singular product", (describePayloadVariantIdentity(p) ?? "").includes("1 product"));
    ok("one lost size uses singular size", (describePayloadVariantIdentity(p) ?? "").includes("lose 1 size"));
  }
  ok("empty payload has no findings", assessPayloadVariantIdentity([]).affected.length === 0);
  ok("empty payload describes nothing", describePayloadVariantIdentity(assessPayloadVariantIdentity([])) === null);

  // --- explainMissingVariant -----------------------------------------------
  {
    // The owner's exact case.
    const msg = explainMissingVariant({
      missingVariantId: "pos-406a50c84648-b8c643bfe6ae",
      sentVariants: [
        { id: "pos-406a50c84648-aaaaaaaaaaaa", amount: 1, unit: "each" },
        { id: "pos-406a50c84648-b8c643bfe6ae", amount: 1, unit: "each" },
      ],
    });
    ok("collided missing variant is explained", typeof msg === "string" && msg.length > 0);
    ok("explanation names the size", (msg ?? "").includes("1 each"));
    ok("explanation names the surviving sibling", (msg ?? "").includes("pos-406a50c84648-aaaaaaaaaaaa"));
    ok("explanation denies a transmission failure", (msg ?? "").includes("not a transmission failure"));
  }
  {
    // NEGATIVE CONTROL: a genuinely absent variant with no collision gets NO
    // invented explanation. This is the assertion that keeps the feature honest.
    const msg = explainMissingVariant({
      missingVariantId: "v2",
      sentVariants: [
        { id: "v1", amount: 3.5, unit: "g" },
        { id: "v2", amount: 7, unit: "g" },
      ],
    });
    ok("uncollided missing variant gets NO explanation", msg === null);
  }
  {
    // A missing id that was not even in the payload must not be explained.
    const msg = explainMissingVariant({
      missingVariantId: "not-sent-at-all",
      sentVariants: [
        { id: "v1", amount: 1, unit: "each" },
        { id: "v2", amount: 1, unit: "each" },
      ],
    });
    ok("unknown id gets no explanation", msg === null);
  }
  {
    const msg = explainMissingVariant({
      missingVariantId: "b",
      sentVariants: [
        { id: "a", amount: 1, unit: "each" },
        { id: "b", amount: 1, unit: "each" },
        { id: "c", amount: 1, unit: "each" },
      ],
    });
    ok("three-way collision explains plural siblings", (msg ?? "").includes("2 other sizes"));
  }
  {
    const msg = explainMissingVariant({
      missingVariantId: "b",
      sentVariants: [
        { id: "a", amount: 1, unit: "each" },
        { id: "b", amount: 1, unit: "each" },
      ],
    });
    ok("two-way collision explains singular sibling", (msg ?? "").includes("1 other size"));
  }
  ok(
    "empty sent list explains nothing",
    explainMissingVariant({ missingVariantId: "x", sentVariants: [] }) === null,
  );

  // --- remedy wording ------------------------------------------------------
  // The advice has to be POSSIBLE for the type it is given about. Suggesting
  // "relabel with distinct weights" to a Topical owner sends him off to do
  // something that cannot work, which is worse than saying nothing.
  {
    const weighable = remedyForCollision(["each", "g"]);
    ok("weight-capable type is told to relabel", weighable.includes("distinct weights"));
    ok("weight-capable advice also offers the split", weighable.includes("separate products"));

    const eachOnly = remedyForCollision(["each"]);
    ok(
      "each-only type is NOT told to relabel",
      !eachOnly.includes("distinct weights"),
    );
    ok("each-only type is told to split the product", eachOnly.includes("separate products"));
    ok(
      "each-only advice says why relabelling cannot work",
      eachOnly.includes("only \"each\""),
    );

    // Flower is g/oz and has no `each` at all -- still weight-capable.
    ok(
      "oz/g type is treated as weight-capable",
      remedyForCollision(["g", "oz"]).includes("distinct weights"),
    );
    // Defensive: an empty list must not claim relabelling works.
    ok(
      "empty unit list falls back to the each-only wording",
      !remedyForCollision([]).includes("distinct weights"),
    );
  }

  // --- ordering / stability ------------------------------------------------
  {
    const c = findVariantCollisions([
      { id: "z", amount: 1, unit: "each" },
      { id: "y", amount: 1, unit: "each" },
    ]);
    ok("payload order preserved, not sorted", c[0].variantIds[0] === "z" && c[0].variantIds[1] === "y");
  }
  {
    // Running twice must give the same answer -- no hidden state.
    const input = [
      { id: "a", amount: 1, unit: "each" },
      { id: "b", amount: 1, unit: "each" },
    ];
    const first = JSON.stringify(findVariantCollisions(input));
    const second = JSON.stringify(findVariantCollisions(input));
    ok("function is pure across repeated calls", first === second);
  }

  console.log(`leafly variant-identity-core self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
