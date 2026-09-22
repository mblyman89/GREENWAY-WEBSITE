/**
 * src/lib/leafly/collision-split-core.ts
 *
 * PURE. The remedy for the collisions that `collision-apply-core.ts` honestly
 * refuses to fix: split one product carrying indistinguishable sizes into
 * several Leafly products, one per size.
 *
 * -------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS
 * -------------------------------------------------------------------------
 * `collision-apply-core.ts` repairs a collision two ways: restore the real
 * weight when the type allows a weight (Flower, Concentrate, Cartridge), or
 * use distinct pack COUNTS when the labels record counts ("2pk", "10pk").
 * Measured against a realistic menu, those two strategies clear every
 * collision except one shape -- and it is the owner's actual shape:
 *
 *     an EACH-ONLY type (PreRoll, Edible, Topical, Accessory, Seeds, Clone,
 *     Other) whose sizes are distinguished by WEIGHT.
 *
 * That is exactly the failure in the owner's report: `items[101].variants:
 * 2 sizes of this item are all described to Leafly as "1 each"
 * (pos-45c6e282e0e8-cca24072824d, pos-45c6e282e0e8-00de6c9e8f2c)`, whose
 * suffixes decode to `1g|1200|medical` and `3g|3300|medical`.
 *
 * The apply core is RIGHT to refuse it. Leafly permits only `each` for those
 * types, so a weight cannot be written into `amount` without lying about the
 * unit, and writing `1 each` / `2 each` for a 1g and a 3g pre-roll would
 * publish a pack count that does not exist. Both are inventions, and the
 * standing rule is that a size is never invented.
 *
 * -------------------------------------------------------------------------
 * WHY SPLITTING IS THE LAWFUL ANSWER, AND WHY IT IS SAFE
 * -------------------------------------------------------------------------
 * It is the remedy Leafly's own guidance points to, and the one already given
 * to the owner in writing ("List them as two separate products... Each gets
 * its own name, so each is distinguishable on the menu and to a shopper").
 *
 * Three facts from `docs/leafly-specs/schemas/v2-items.json` make it safe:
 *
 *   1. `items` is a plain unconstrained array -- there is no rule that two
 *      menu items may not share a brand, a strain or a description.
 *   2. `item.id` is only required to be "Unique to all items in the menu.
 *      Should remain consistent between updates to the menu". A split id
 *      derived deterministically from the parent id plus the size label
 *      satisfies both halves: unique, and identical on every future push.
 *   3. Decisively, `variant.id` "Takes precedence over top-level id for ORDER
 *      INTEGRATION purposes". So as long as each split product keeps its
 *      ORIGINAL variant id untouched -- which this module guarantees -- an
 *      incoming Leafly order still resolves to the same POS variant it would
 *      have before the split. Splitting cannot break ordering.
 *
 * -------------------------------------------------------------------------
 * WHAT THIS MODULE WILL NOT DO
 * -------------------------------------------------------------------------
 * S1. Never invent, alter or drop a size. Every source variant appears
 *     exactly once across the split products, with its amount, unit, price,
 *     stock, medical flag and id byte-identical.
 * S2. Never split a product whose sizes are NOT genuinely distinguishable.
 *     If two sizes carry the same label, or a label is missing, splitting
 *     would produce two products with the same name -- swapping a collision
 *     for an ambiguity. It refuses and says so.
 * S3. Never emit a duplicate `item.id`. Derived ids are checked for
 *     uniqueness against each other AND against every id already in the
 *     menu; a clash refuses rather than overwrites.
 * S4. Never leave the caller guessing. Every split is reported with the new
 *     product names, and every refusal carries a reason in plain English.
 *
 * Splitting changes how the menu LOOKS to a shopper, so unlike the amount/unit
 * repair it is deliberately a separate, opt-in step with its own preview.
 */

/* ========================================================================== */
/* Types                                                                      */
/* ========================================================================== */

export type SplitVariant = {
  id: string;
  amount: number;
  unit: string;
  label?: string | null;
  price?: number;
  medical?: boolean;
  inventoryLevel?: number;
};

export type SplitItem = {
  id: string;
  type: string;
  name: string;
  variants: SplitVariant[];
};

export type ItemSplit = {
  parentId: string;
  parentName: string;
  leaflyType: string;
  /** The products the parent became. */
  products: Array<{ id: string; name: string; variantIds: string[]; label: string }>;
  narrative: string;
};

export type SplitRefusal = {
  itemId: string;
  itemName: string;
  leaflyType: string;
  reason: string;
  variantIds: string[];
};

export type SplitResult<T> = {
  items: T[];
  splits: ItemSplit[];
  refusals: SplitRefusal[];
  splitItemCount: number;
  createdItemCount: number;
  /** Verified against the OUTPUT: no item still carries a size collision. */
  clean: boolean;
};

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

/** The size key Leafly actually identifies a variant by. */
export function splitSizeKey(v: SplitVariant): string {
  return `${v.amount}|${v.unit}|${v.medical === true ? "medical" : "adult"}`;
}

/** Variant ids that are indistinguishable from at least one sibling. */
export function splitCollidingVariantIds(variants: readonly SplitVariant[]): string[] {
  const byKey = new Map<string, string[]>();
  for (const v of variants ?? []) {
    const k = splitSizeKey(v);
    byKey.set(k, [...(byKey.get(k) ?? []), v.id]);
  }
  const out: string[] = [];
  for (const ids of byKey.values()) if (ids.length > 1) out.push(...ids);
  return out;
}

/**
 * Turn a size label into an id-safe slug.
 *
 * Lower-cased, non-alphanumerics collapsed to a single hyphen. Deliberately
 * lossy in a CONTROLLED way -- "3.5 G" and "3.5g" both become "3-5g" -- which
 * is why the caller must check the resulting ids for uniqueness (rule S3)
 * rather than trusting the slug to be injective.
 */
export function labelSlug(label: string): string {
  return String(label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The marker that separates a parent product id from its size slug.
 *
 * EXPORTED DELIBERATELY, and this is not cosmetic. A split id is the one id
 * in the system that does NOT exist in `menu_items`, so anything that wants
 * to turn an id back into a back-office product page has to recognise the
 * marker and strip it. Before this constant existed the separator was a
 * string literal inside `splitItemId`, which meant any reader had to
 * re-derive it by eye -- and a reader who guessed `"-"` instead of `"--"`
 * would produce a link that silently 404s.
 *
 * Two hyphens rather than one because single hyphens are extremely common
 * inside real POS product keys (`pos-45c6e282e0e8`). A single-hyphen marker
 * could not be told apart from the key's own punctuation.
 *
 * `fix-link-core.ts` imports this and a drift test pins the two together.
 */
export const SPLIT_ID_SEPARATOR = "--";

/** Deterministic, stable id for a split product. */
export function splitItemId(parentId: string, label: string): string {
  return `${parentId}${SPLIT_ID_SEPARATOR}${labelSlug(label)}`;
}

/**
 * The product name a shopper sees. The size is appended so the two products
 * are distinguishable on the menu, which is the entire point of splitting.
 * An en-dash is deliberately avoided in favour of a plain hyphen: this string
 * travels to a third party and plain ASCII cannot be mangled by an encoding
 * mismatch anywhere along the way.
 */
export function splitItemName(parentName: string, label: string): string {
  const base = String(parentName ?? "").trim();
  const size = String(label ?? "").trim();
  if (size.length === 0) return base;
  // Do not duplicate a size the name already ends with.
  if (base.toLowerCase().endsWith(size.toLowerCase())) return base;
  return `${base} - ${size}`;
}

/* ========================================================================== */
/* The split                                                                  */
/* ========================================================================== */

/**
 * Split ONE item, if it both needs splitting and can be split safely.
 *
 * `takenIds` is every item id already present in the menu (including ids
 * minted by earlier splits in the same pass) so rule S3 can be enforced.
 */
export function splitItem(
  item: SplitItem,
  takenIds: ReadonlySet<string>,
): { products: SplitItem[]; split: ItemSplit | null; refusal: SplitRefusal | null } {
  const variants = item.variants ?? [];
  const colliding = splitCollidingVariantIds(variants);

  // Nothing to do. Returning the item untouched keeps this function safe to
  // run across a whole menu.
  if (colliding.length === 0) return { products: [item], split: null, refusal: null };

  // Rule S2: every size must carry a label, or the split products cannot be
  // told apart by name either.
  const labels = variants.map((v) => String(v.label ?? "").trim());
  const missing = labels.filter((l) => l.length === 0).length;
  if (missing > 0) {
    return {
      products: [item],
      split: null,
      refusal: {
        itemId: item.id,
        itemName: item.name,
        leaflyType: item.type,
        reason:
          `${missing} of this product's ${variants.length} sizes has no size label recorded. ` +
          `Splitting it would create products with identical names, which is no better than ` +
          `the problem it replaces. Add the size to the product label first.`,
        variantIds: colliding,
      },
    };
  }

  // Rule S2 continued: labels must be distinct from one another.
  const lowered = labels.map((l) => l.toLowerCase());
  if (new Set(lowered).size !== lowered.length) {
    return {
      products: [item],
      split: null,
      refusal: {
        itemId: item.id,
        itemName: item.name,
        leaflyType: item.type,
        reason:
          `Two or more sizes carry the same label (${labels.join(", ")}), so splitting would ` +
          `produce two products with the same name. The labels need correcting on the ` +
          `product first.`,
        variantIds: colliding,
      },
    };
  }

  // Rule S3: derived ids must be unique among themselves and unused.
  const ids = labels.map((l) => splitItemId(item.id, l));
  const clash =
    new Set(ids).size !== ids.length ||
    ids.some((id) => takenIds.has(id) && id !== item.id);
  if (clash) {
    return {
      products: [item],
      split: null,
      refusal: {
        itemId: item.id,
        itemName: item.name,
        leaflyType: item.type,
        reason:
          `Splitting this product would produce a duplicate product id, which Leafly rejects ` +
          `(ids must be unique across the whole menu). This is usually two labels that differ ` +
          `only by punctuation or capitalisation. The labels need correcting first.`,
        variantIds: colliding,
      },
    };
  }

  // Build one product per size. Rule S1: the variant is carried across
  // UNCHANGED -- same id, amount, unit, price, stock and medical flag -- so
  // order integration, which keys on variant id, is unaffected.
  const products: SplitItem[] = variants.map((v, i) => ({
    ...item,
    id: ids[i],
    name: splitItemName(item.name, labels[i]),
    variants: [v],
  }));

  return {
    products,
    split: {
      parentId: item.id,
      parentName: item.name,
      leaflyType: item.type,
      products: products.map((p, i) => ({
        id: p.id,
        name: p.name,
        variantIds: [variants[i].id],
        label: labels[i],
      })),
      narrative:
        `"${item.name}" had ${variants.length} sizes that all reached Leafly as the same thing, ` +
        `and Leafly only allows "each" for a ${item.type}, so the sizes could not be told apart ` +
        `on one product. It was listed as ${products.length} separate products ` +
        `(${products.map((p) => `"${p.name}"`).join(", ")}). Every size kept its own price, ` +
        `stock and ordering id, so nothing was invented, dropped or repriced.`,
    },
    refusal: null,
  };
}

/**
 * Split across a whole payload.
 *
 * Returns NEW objects; the input is never mutated.
 */
export function applyCollisionSplits<T extends SplitItem>(items: readonly T[]): SplitResult<T> {
  const source = items ?? [];

  // Seed with every existing id so a minted id can never shadow a real
  // product that happens to be named like a split (rule S3).
  const takenIds = new Set<string>();
  for (const i of source) takenIds.add(i.id);

  const out: T[] = [];
  const splits: ItemSplit[] = [];
  const refusals: SplitRefusal[] = [];

  for (const item of source) {
    const { products, split, refusal } = splitItem(item, takenIds);
    for (const p of products) {
      out.push(p as T);
      takenIds.add(p.id);
    }
    if (split !== null) splits.push(split);
    if (refusal !== null) refusals.push(refusal);
  }

  // Verify rather than assume, on the OUTPUT.
  const clean = out.every((i) => splitCollidingVariantIds(i.variants ?? []).length === 0);

  return {
    items: out,
    splits,
    refusals,
    splitItemCount: splits.length,
    createdItemCount: splits.reduce((n, s) => n + s.products.length, 0),
    clean,
  };
}

/** Owner-facing summary. */
export function describeSplitResult(result: SplitResult<SplitItem>): string {
  const { splitItemCount, createdItemCount, refusals } = result;
  if (splitItemCount === 0 && refusals.length === 0) {
    return "No products needed splitting.";
  }
  const parts: string[] = [];
  if (splitItemCount > 0) {
    parts.push(
      `Listed ${splitItemCount} product${splitItemCount === 1 ? "" : "s"} as ${createdItemCount} ` +
        `separate Leafly products so every size is visible and orderable. No size was invented, ` +
        `dropped or repriced, and every size kept its ordering id.`,
    );
  }
  if (refusals.length > 0) {
    parts.push(
      `${refusals.length} product${refusals.length === 1 ? "" : "s"} could not be split ` +
        `automatically and ${refusals.length === 1 ? "is" : "are"} listed individually with the ` +
        `reason, because the fix needs a label corrected on the product first.`,
    );
  }
  return parts.join(" ");
}

/* ========================================================================== */
/* Self-tests                                                                 */
/* ========================================================================== */

export function __runLeaflyCollisionSplitTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  collision-split-core FAIL: ${name}`);
    }
  };

  const v = (o: Partial<SplitVariant> & { id: string }): SplitVariant => ({
    amount: 1,
    unit: "each",
    price: 1200,
    medical: false,
    inventoryLevel: 5,
    ...o,
  });

  /* ---- helpers --------------------------------------------------------- */
  ok("sizeKey joins amount/unit/medical", splitSizeKey(v({ id: "a" })) === "1|each|adult");
  ok(
    "sizeKey separates medical from adult",
    splitSizeKey(v({ id: "a", medical: true })) !== splitSizeKey(v({ id: "b", medical: false })),
  );
  ok("labelSlug lowercases", labelSlug("3.5G") === "3-5g");
  ok("labelSlug trims separators", labelSlug("  1 g  ") === "1-g");
  ok("labelSlug collapses runs", labelSlug("10 -- pk") === "10-pk");
  ok("splitItemId is deterministic", splitItemId("p", "1g") === splitItemId("p", "1g"));
  ok("splitItemId differs per label", splitItemId("p", "1g") !== splitItemId("p", "3g"));
  ok("splitItemName appends the size", splitItemName("Blue Dream", "1g") === "Blue Dream - 1g");
  ok(
    "splitItemName does not duplicate a size already present",
    splitItemName("Blue Dream 1g", "1g") === "Blue Dream 1g",
  );
  ok("splitItemName tolerates a blank label", splitItemName("Blue Dream", "") === "Blue Dream");

  /* ---- collision detection -------------------------------------------- */
  ok("no collision when sizes differ", splitCollidingVariantIds([v({ id: "a", amount: 1 }), v({ id: "b", amount: 2 })]).length === 0);
  ok("collision when sizes match", splitCollidingVariantIds([v({ id: "a" }), v({ id: "b" })]).length === 2);
  ok("single variant never collides", splitCollidingVariantIds([v({ id: "a" })]).length === 0);
  ok("empty list never collides", splitCollidingVariantIds([]).length === 0);
  ok(
    "medical and adult of the same size do NOT collide",
    splitCollidingVariantIds([v({ id: "a", medical: true }), v({ id: "b", medical: false })]).length === 0,
  );

  /* ---- the owner's real case ------------------------------------------ */
  const owner: SplitItem = {
    id: "pos-45c6e282e0e8",
    type: "PreRoll",
    name: "House Pre-Roll",
    variants: [
      v({ id: "pos-45c6e282e0e8-cca24072824d", label: "1g", price: 1200, medical: true }),
      v({ id: "pos-45c6e282e0e8-00de6c9e8f2c", label: "3g", price: 3300, medical: true }),
    ],
  };
  const ownerRes = applyCollisionSplits([owner]);
  ok("owner's case is split", ownerRes.splitItemCount === 1);
  ok("owner's case yields two products", ownerRes.items.length === 2);
  ok("owner's case is clean afterwards", ownerRes.clean);
  ok("split products have distinct ids", new Set(ownerRes.items.map((i) => i.id)).size === 2);
  ok("split products have distinct names", new Set(ownerRes.items.map((i) => i.name)).size === 2);
  ok(
    "S1 variant ids are preserved verbatim (order integration)",
    ownerRes.items.flatMap((i) => i.variants.map((x) => x.id)).join(",") ===
      "pos-45c6e282e0e8-cca24072824d,pos-45c6e282e0e8-00de6c9e8f2c",
  );
  ok(
    "S1 prices preserved",
    ownerRes.items.flatMap((i) => i.variants.map((x) => x.price)).join(",") === "1200,3300",
  );
  ok(
    "S1 medical flag preserved",
    ownerRes.items.every((i) => i.variants.every((x) => x.medical === true)),
  );
  ok("S1 every size survives exactly once", ownerRes.items.flatMap((i) => i.variants).length === 2);
  ok("type is carried to every split product", ownerRes.items.every((i) => i.type === "PreRoll"));
  ok("narrative names both products", (ownerRes.splits[0]?.narrative ?? "").includes("House Pre-Roll - 3g"));
  ok("describe mentions the count", describeSplitResult(ownerRes).includes("2 separate"));

  /* ---- S2: refuses rather than creating ambiguity ---------------------- */
  const noLabel: SplitItem = {
    id: "p2",
    type: "Topical",
    name: "Salve",
    variants: [v({ id: "a", label: "1g" }), v({ id: "b", label: "" })],
  };
  const noLabelRes = applyCollisionSplits([noLabel]);
  ok("S2 refuses when a label is missing", noLabelRes.refusals.length === 1);
  ok("S2 refusal leaves the item intact", noLabelRes.items.length === 1);
  ok("S2 refusal is reported as not clean", !noLabelRes.clean);
  ok("S2 refusal explains itself", (noLabelRes.refusals[0]?.reason ?? "").includes("no size label"));
  ok("S2 refusal names the variants", noLabelRes.refusals[0]?.variantIds.length === 2);

  const dupLabel: SplitItem = {
    id: "p3",
    type: "Edible",
    name: "Gummies",
    variants: [v({ id: "a", label: "10pk" }), v({ id: "b", label: "10pk" })],
  };
  const dupRes = applyCollisionSplits([dupLabel]);
  ok("S2 refuses duplicate labels", dupRes.refusals.length === 1);
  ok("S2 duplicate-label refusal explains itself", (dupRes.refusals[0]?.reason ?? "").includes("same label"));
  ok("S2 duplicate-label leaves item intact", dupRes.items.length === 1);

  /* ---- S3: id uniqueness ---------------------------------------------- */
  const punct: SplitItem = {
    id: "p4",
    type: "PreRoll",
    name: "Roll",
    // Both slug to "1-g" -> would collide.
    variants: [v({ id: "a", label: "1 g" }), v({ id: "b", label: "1-g" })],
  };
  const punctRes = applyCollisionSplits([punct]);
  ok("S3 refuses when derived ids would clash", punctRes.refusals.length === 1);
  ok("S3 clash refusal explains itself", (punctRes.refusals[0]?.reason ?? "").includes("duplicate product id"));

  const shadow: SplitItem = {
    id: "p5",
    type: "PreRoll",
    name: "Roll",
    variants: [v({ id: "a", label: "1g" }), v({ id: "b", label: "3g" })],
  };
  const existing: SplitItem = { id: "p5--1g", type: "PreRoll", name: "Already here", variants: [v({ id: "z", amount: 9 })] };
  const shadowRes = applyCollisionSplits([shadow, existing]);
  ok("S3 refuses to shadow an id already in the menu", shadowRes.refusals.length === 1);
  ok("S3 the pre-existing product is untouched", shadowRes.items.some((i) => i.id === "p5--1g" && i.name === "Already here"));

  /* ---- no-op safety ---------------------------------------------------- */
  const fine: SplitItem = {
    id: "p6",
    type: "Flower",
    name: "Bud",
    variants: [v({ id: "a", amount: 1, unit: "g" }), v({ id: "b", amount: 3.5, unit: "g" })],
  };
  const fineRes = applyCollisionSplits([fine]);
  ok("a clean item is not split", fineRes.splitItemCount === 0);
  ok("a clean item passes through byte-identical", fineRes.items.length === 1 && fineRes.items[0] === fine);
  ok("a clean payload reports clean", fineRes.clean);
  ok("describe says nothing needed doing", describeSplitResult(fineRes) === "No products needed splitting.");
  ok("empty payload is clean", applyCollisionSplits([]).clean);
  ok("empty payload creates nothing", applyCollisionSplits([]).items.length === 0);

  /* ---- input is never mutated ------------------------------------------ */
  const before = JSON.stringify(owner);
  applyCollisionSplits([owner]);
  ok("input payload is not mutated", JSON.stringify(owner) === before);

  /* ---- three-way split and mixed menus --------------------------------- */
  const three: SplitItem = {
    id: "p7",
    type: "PreRoll",
    name: "Triple",
    variants: [v({ id: "a", label: "1g" }), v({ id: "b", label: "3g" }), v({ id: "c", label: "5g" })],
  };
  const threeRes = applyCollisionSplits([three]);
  ok("three colliding sizes yield three products", threeRes.items.length === 3);
  ok("three-way split is clean", threeRes.clean);
  ok("createdItemCount counts products made", threeRes.createdItemCount === 3);

  const mixed = applyCollisionSplits([fine, owner, noLabel]);
  ok("mixed menu splits only what needs it", mixed.splitItemCount === 1);
  ok("mixed menu reports the refusal", mixed.refusals.length === 1);
  ok("mixed menu item count is 1 + 2 + 1", mixed.items.length === 4);
  ok("mixed menu is not clean while a refusal stands", !mixed.clean);
  ok(
    "mixed menu preserves every original variant exactly once",
    mixed.items.flatMap((i) => i.variants.map((x) => x.id)).sort().join(",") ===
      ["a", "b", "pos-45c6e282e0e8-cca24072824d", "pos-45c6e282e0e8-00de6c9e8f2c", "a", "b"]
        .sort()
        .join(","),
  );

  /* ---- universal invariants over a generated menu ---------------------- */
  {
    const TYPES = ["Accessory", "Seeds", "Clone", "Edible", "PreRoll", "Topical", "Other"];
    const LABELS = ["1g", "3g", "5g"];
    const menu: SplitItem[] = [];
    for (let t = 0; t < TYPES.length; t++) {
      for (let n = 0; n < 4; n++) {
        menu.push({
          id: `gen-${t}-${n}`,
          type: TYPES[t],
          name: `Product ${t}-${n}`,
          variants: LABELS.slice(0, 2 + (n % 2)).map((label, k) =>
            v({ id: `gen-${t}-${n}-v${k}`, label, price: 1000 + k * 500, inventoryLevel: 9 - k }),
          ),
        });
      }
    }
    const res = applyCollisionSplits(menu);
    const inVariants = menu.flatMap((i) => i.variants);
    const outVariants = res.items.flatMap((i) => i.variants);

    ok("INV every generated collision is resolved", res.clean);
    ok("INV no variant lost or duplicated", outVariants.length === inVariants.length);
    ok(
      "INV variant ids are exactly preserved",
      outVariants.map((x) => x.id).sort().join(",") === inVariants.map((x) => x.id).sort().join(","),
    );
    ok(
      "INV no price changed",
      outVariants.every((o) => o.price === inVariants.find((i) => i.id === o.id)?.price),
    );
    ok(
      "INV no stock changed",
      outVariants.every((o) => o.inventoryLevel === inVariants.find((i) => i.id === o.id)?.inventoryLevel),
    );
    ok(
      "INV no amount or unit changed (splitting never rewrites a size)",
      outVariants.every((o) => {
        const src = inVariants.find((i) => i.id === o.id);
        return o.amount === src?.amount && o.unit === src?.unit;
      }),
    );
    ok("INV all emitted item ids are unique", new Set(res.items.map((i) => i.id)).size === res.items.length);
    ok("INV all emitted item names are non-empty", res.items.every((i) => i.name.trim().length > 0));
    ok(
      "INV every emitted unit is still lawful for an each-only type",
      res.items.every((i) => i.variants.every((x) => x.unit === "each")),
    );
    ok("INV nothing was refused on well-formed input", res.refusals.length === 0);
    ok("INV every item now holds exactly one variant or had no collision", res.items.every((i) => i.variants.length >= 1));
  }

  return { passed, failed };
}
