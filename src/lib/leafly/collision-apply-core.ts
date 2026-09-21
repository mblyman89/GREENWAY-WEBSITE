/**
 * src/lib/leafly/collision-apply-core.ts
 *
 * APPLY the collision remedy to a built Leafly payload.
 *
 * ###########################################################################
 * # WHY THIS FILE HAD TO EXIST                                             #
 * #                                                                        #
 * # `collision-remedy-core.ts` decides WHAT should be done and explains it #
 * # in English. Nothing carried it out. The owner could therefore read a   #
 * # perfect description of the fix for his 124 errors and still have 124   #
 * # errors, because describing a repair is not performing one.             #
 * #                                                                        #
 * # The owner's words (ask 7):                                             #
 * #   "if the fix is something simple, that could be blanket applied to    #
 * #    many products, please build that into the system somehow in a       #
 * #    professional expert enterprise way."                                #
 * #                                                                        #
 * # "Blanket applied" is the operative phrase. This is the blanket.        #
 * ###########################################################################
 *
 * THE DEFECT BEING REPAIRED, stated precisely.
 *
 * `variantAmountAndUnit()` (payload-core.ts:452) reads the weight out of a
 * label, then DISCARDS it when the Leafly type forbids `g`, substituting
 * `{amount: 1, unit: "each"}`. Three real sizes -- 1g, 3g, 5g -- therefore
 * all describe themselves to Leafly as "1 each". Leafly cannot tell them
 * apart and rejects the payload. Proven live on `main`: seven of Leafly's
 * ten product types collapse this way (Accessory, Seeds, Clone, Edible,
 * PreRoll, Topical, Other).
 *
 * WHAT LEAFLY'S OWN SCHEMA PERMITS -- this is the whole legal basis, quoted
 * from `docs/leafly-specs/schemas/v2-items.json`:
 *
 *   variant.amount : { "type": "number", "description":
 *                      "The count of `unit` for this item." }
 *   variant.unit   : { "enum": ["oz", "g", "each"] }
 *   variant.id     : "Unique to all items in the menu."
 *
 * Three facts follow, and every rule below is derived from them:
 *
 *   1. `amount` is an unconstrained `number`. There is NO rule that an
 *      "each" amount must be 1. The collapse is our invention, not Leafly's
 *      requirement.
 *   2. `unit` is constrained per type by the table in the schema, so we may
 *      NOT simply start sending `g` for a PreRoll to dodge the collision.
 *   3. Uniqueness that matters for this error is WITHIN one item's variants.
 *
 * SO THE REPAIR IS: keep the lawful unit, and stop throwing away the
 * distinguishing information. Sizes that differ in the source data must
 * differ on the wire.
 *
 * ############ THE FOUR RULES THIS FILE WILL NOT BREAK ####################
 *
 * R1. NEVER INVENT A SIZE. Every number written here is read from a label
 *     that already exists. If a label has no readable size, this file
 *     refuses and reports -- it does not fabricate one to make the payload
 *     pass. An invented weight on a cannabis menu is a compliance exposure.
 *
 * R2. NEVER DROP A SIZE. Silently discarding one of three sizes would make
 *     the payload valid and the menu wrong. Anything not repaired is
 *     returned in `unrepaired` with a reason.
 *
 * R3. NEVER CHANGE THE PRICE, THE STOCK, OR THE PRODUCT'S IDENTITY. The
 *     repair touches `amount` (and, where lawful, `unit`). Money and
 *     inventory are copied through untouched.
 *
 * R4. NEVER PRODUCE AN UNLAWFUL UNIT. The type/unit matrix is Leafly's, and
 *     this file consults it rather than assuming.
 *
 * PURITY. Zero imports. The Leafly unit matrix is re-declared here as a
 * literal, and a compliance test asserts it stays identical to the one in
 * `contract-core.ts` -- so this file stays pure without the two drifting.
 */

/* ========================================================================== */
/* Types                                                                      */
/* ========================================================================== */

export type ApplyUnit = "oz" | "g" | "each";

/** The variant shape this module needs. A subset of the wire variant. */
export type ApplyVariant = {
  id: string;
  amount: number;
  unit: string;
  /** The original human size label, e.g. "1g", "3.5 g", "10pk". */
  label?: string | null;
  price?: number;
  medical?: boolean;
  inventoryLevel?: number;
};

export type ApplyItem = {
  id: string;
  type: string;
  name: string;
  variants: ApplyVariant[];
};

/** How a single item's collision was resolved. */
export type RepairKind =
  /** The type allows a weight; the real weight was restored. */
  | "restored_weight"
  /** Each-only type; `amount` now carries the distinct pack/size count. */
  | "distinct_each_amount"
  /** Nothing safe was possible. Reported, never forced. */
  | "unrepaired";

export type ItemRepair = {
  itemId: string;
  itemName: string;
  leaflyType: string;
  kind: RepairKind;
  /** Plain-English account of what changed, for the owner. */
  narrative: string;
  /** Per-variant before/after, so the change is auditable. */
  changes: Array<{
    variantId: string;
    label: string | null;
    fromAmount: number;
    fromUnit: string;
    toAmount: number;
    toUnit: string;
  }>;
  /** Variants this repair could not help, with the reason why. */
  unrepairedVariantIds: string[];
  reason: string | null;
};

export type ApplyResult<T> = {
  items: T[];
  repairs: ItemRepair[];
  repairedItemCount: number;
  repairedVariantCount: number;
  /** Items that still collide after the pass. Never hidden. */
  unrepaired: ItemRepair[];
  /** True when the payload is provably free of size collisions afterwards. */
  clean: boolean;
};

/* ========================================================================== */
/* Leafly's type -> unit table (mirrored; drift-guarded by a compliance test) */
/* ========================================================================== */

const UNITS_BY_TYPE: Record<string, readonly ApplyUnit[]> = {
  Accessory: ["each"],
  Seeds: ["each"],
  Clone: ["each"],
  Flower: ["g", "oz"],
  Edible: ["each"],
  PreRoll: ["each"],
  Concentrate: ["each", "g"],
  Cartridge: ["each", "g"],
  Topical: ["each"],
  Other: ["each"],
};

export const APPLY_UNITS_BY_TYPE = UNITS_BY_TYPE;

/* ========================================================================== */
/* Reading a size out of a label -- READ ONLY, never invent (rule R1)         */
/* ========================================================================== */

export type ParsedSize =
  | { kind: "weight"; value: number; unit: "g" | "oz" }
  | { kind: "count"; value: number }
  | null;

/**
 * Parse a size from a label.
 *
 * Deliberately conservative. It recognises the forms Cultivera actually
 * emits and returns `null` for everything else, because a wrong reading is
 * worse than no reading: it would silently publish a product as a size it
 * is not. `mg` is NOT converted to grams here -- a 10mg edible is a dose,
 * not a package weight, and treating it as one would misdescribe the
 * product.
 */
export function parseSizeFromLabel(label: string | null | undefined): ParsedSize {
  const raw = String(label ?? "").trim().toLowerCase();
  if (raw.length === 0) return null;

  // "2 x 0.5g", "2x0.5 g" -> a pack of weights. The COUNT is what
  // distinguishes it for an each-only type.
  const packOfWeights = /^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(g|gram|grams|oz)\b/.exec(raw);
  if (packOfWeights !== null) {
    const n = Number(packOfWeights[1]);
    if (Number.isFinite(n) && n > 0) return { kind: "count", value: n };
  }

  // "10pk", "10 pack", "10ct", "10 count", "10 pc"
  const pack = /^(\d+(?:\.\d+)?)\s*(pk|pack|packs|ct|count|pc|pcs|piece|pieces)\b/.exec(raw);
  if (pack !== null) {
    const n = Number(pack[1]);
    if (Number.isFinite(n) && n > 0) return { kind: "count", value: n };
  }

  // "1g", "3.5 g", "1 gram", "1oz", "0.5 ounce"
  const weight = /^(\d+(?:\.\d+)?)\s*(g|gram|grams|oz|ounce|ounces)\b/.exec(raw);
  if (weight !== null) {
    const n = Number(weight[1]);
    if (Number.isFinite(n) && n > 0) {
      const u = weight[2].startsWith("o") ? "oz" : "g";
      return { kind: "weight", value: n, unit: u };
    }
  }

  // A bare number is a count: "2" on a pre-roll means two of them.
  const bare = /^(\d+(?:\.\d+)?)$/.exec(raw);
  if (bare !== null) {
    const n = Number(bare[1]);
    if (Number.isFinite(n) && n > 0) return { kind: "count", value: n };
  }

  return null;
}

/** Two variants collide when they describe themselves identically. */
export function sizeKey(amount: number, unit: string): string {
  return `${amount}|${String(unit).trim().toLowerCase()}`;
}

/** Which variants of an item are indistinguishable? Mirrors the validator. */
export function collidingVariantIds(variants: readonly ApplyVariant[]): string[] {
  const byKey = new Map<string, string[]>();
  for (const v of variants) {
    if (!Number.isFinite(v.amount)) continue;
    const k = sizeKey(v.amount, v.unit);
    const list = byKey.get(k);
    if (list === undefined) byKey.set(k, [v.id]);
    else list.push(v.id);
  }
  const out: string[] = [];
  for (const [, ids] of byKey) if (ids.length > 1) out.push(...ids);
  return out;
}

/* ========================================================================== */
/* Repairing one item                                                         */
/* ========================================================================== */

/**
 * Repair a single item's colliding sizes, or explain why it cannot be done.
 *
 * STRATEGY ORDER, and the reasoning for it:
 *
 *   A. If the type lawfully accepts a weight (Flower, Concentrate,
 *      Cartridge) and every colliding size has a readable weight, restore
 *      the weights. This is the truest possible repair: it puts back
 *      exactly the information that was discarded, and the customer sees
 *      the real gram weight.
 *
 *   B. Otherwise the type is each-only, so the unit cannot change. Use the
 *      DISTINCT COUNT from the label as `amount`. Leafly's schema defines
 *      `amount` as "the count of unit" with no requirement that it be 1, so
 *      a 3-pack legitimately is `3 each`. This distinguishes the variants
 *      using only recorded data.
 *
 *   C. If neither is available -- because labels are missing, unreadable,
 *      or two labels genuinely say the same thing -- REFUSE. Rule R1 and R2:
 *      no invented sizes, no dropped sizes, just an honest report.
 *
 * Note strategy B is attempted only when it produces values that are
 * actually distinct. Rewriting three variants from "1 each" to "1 each" is
 * not a repair, and claiming it as one would be worse than doing nothing.
 */
export function repairItem(item: ApplyItem): { item: ApplyItem; repair: ItemRepair | null } {
  const variants = item.variants ?? [];
  if (variants.length < 2) return { item, repair: null };

  const colliding = new Set(collidingVariantIds(variants));
  if (colliding.size === 0) return { item, repair: null };

  const legal = UNITS_BY_TYPE[item.type] ?? ["each"];
  const changes: ItemRepair["changes"] = [];

  // ---- Strategy A: restore the real weight ------------------------------
  const weightAllowed = legal.includes("g") || legal.includes("oz");
  if (weightAllowed) {
    const parsed = variants.map((v) => ({ v, size: parseSizeFromLabel(v.label) }));
    const allWeights = parsed.every(
      (p) => p.size !== null && p.size.kind === "weight" && legal.includes(p.size.unit),
    );
    if (allWeights) {
      const keys = parsed.map((p) =>
        sizeKey((p.size as { value: number }).value, (p.size as { unit: string }).unit),
      );
      if (new Set(keys).size === keys.length) {
        const next = variants.map((v) => {
          const size = parseSizeFromLabel(v.label) as { value: number; unit: ApplyUnit };
          if (v.amount === size.value && v.unit === size.unit) return v;
          changes.push({
            variantId: v.id,
            label: v.label ?? null,
            fromAmount: v.amount,
            fromUnit: v.unit,
            toAmount: size.value,
            toUnit: size.unit,
          });
          return { ...v, amount: size.value, unit: size.unit };
        });
        return {
          item: { ...item, variants: next },
          repair: {
            itemId: item.id,
            itemName: item.name,
            leaflyType: item.type,
            kind: "restored_weight",
            narrative:
              `"${item.name}" had ${colliding.size} sizes that all reached Leafly as the same ` +
              `thing. Leafly accepts a weight for a ${item.type}, and every size already had a ` +
              `real weight on its label, so the weights were put back ` +
              `(${changes.map((c) => `${c.toAmount}${c.toUnit}`).join(", ")}). ` +
              `Nothing about the product, its price or its stock changed.`,
            changes,
            unrepairedVariantIds: [],
            reason: null,
          },
        };
      }
    }
  }

  // ---- Strategy B: distinct counts on an each-only type -----------------
  {
    const sizes = variants.map((v) => parseSizeFromLabel(v.label));
    const counts = variants.map((v, i) => {
      const s = sizes[i];
      if (s === null) return null;
      // A weight on an each-only type still distinguishes the package: a 1g
      // and a 5g pre-roll are different packages. But `amount` must remain a
      // COUNT of "each", so the weight cannot be written into it. Only a
      // genuine count can be used here.
      if (s.kind === "count") return s.value;
      return null;
    });

    const haveAll = counts.every((c) => c !== null);
    const distinct = new Set(counts.map((c) => String(c)));
    if (haveAll && distinct.size === counts.length) {
      const next = variants.map((v, i) => {
        const c = counts[i] as number;
        if (v.amount === c) return v;
        changes.push({
          variantId: v.id,
          label: v.label ?? null,
          fromAmount: v.amount,
          fromUnit: v.unit,
          toAmount: c,
          toUnit: v.unit,
        });
        return { ...v, amount: c };
      });
      return {
        item: { ...item, variants: next },
        repair: {
          itemId: item.id,
          itemName: item.name,
          leaflyType: item.type,
          kind: "distinct_each_amount",
          narrative:
            `Leafly only allows "each" for a ${item.type}, so "${item.name}" could not be sent ` +
            `with weights. Each size does record a pack count, so the counts were used to tell ` +
            `them apart (${changes.map((c) => `${c.toAmount} each`).join(", ")}). ` +
            `No size was invented and none was dropped.`,
          changes,
          unrepairedVariantIds: [],
          reason: null,
        },
      };
    }
  }

  // ---- Strategy C: refuse, and say why ----------------------------------
  const labels = variants.map((v) => (v.label ?? "").trim()).filter((l) => l.length > 0);
  const reason =
    labels.length < variants.length
      ? `${variants.length - labels.length} of this product's ${variants.length} sizes has no size ` +
        `label recorded, so there is nothing to tell them apart by. A size is never invented.`
      : new Set(labels.map((l) => l.toLowerCase())).size < labels.length
        ? `Two or more sizes carry the SAME label (${labels.join(", ")}), so they cannot be told ` +
          `apart. The labels need correcting on the product first.`
        : `Leafly only allows "each" for a ${item.type}, and these labels (${labels.join(", ")}) ` +
          `record a weight rather than a pack count, so they cannot lawfully be distinguished ` +
          `on the wire. This product needs to be split into separate Leafly products.`;

  return {
    item,
    repair: {
      itemId: item.id,
      itemName: item.name,
      leaflyType: item.type,
      kind: "unrepaired",
      narrative: `"${item.name}" could not be repaired automatically. ${reason}`,
      changes: [],
      unrepairedVariantIds: Array.from(colliding),
      reason,
    },
  };
}

/* ========================================================================== */
/* The blanket pass                                                           */
/* ========================================================================== */

/**
 * Apply the repair across a whole payload.
 *
 * Returns NEW objects; the input is never mutated, so a caller can always
 * diff before and after, and a failed apply cannot leave a half-edited
 * payload behind.
 */
export function applyCollisionRepairs<T extends ApplyItem>(items: readonly T[]): ApplyResult<T> {
  const out: T[] = [];
  const repairs: ItemRepair[] = [];
  const unrepaired: ItemRepair[] = [];
  let repairedVariantCount = 0;

  for (const item of items ?? []) {
    const { item: fixed, repair } = repairItem(item);
    out.push(fixed as T);
    if (repair === null) continue;
    if (repair.kind === "unrepaired") unrepaired.push(repair);
    else {
      repairs.push(repair);
      repairedVariantCount += repair.changes.length;
    }
  }

  // Verify rather than assume. The claim "this payload is now clean" is
  // checked against the same collision rule the validator uses, on the
  // OUTPUT -- so a strategy that thought it had worked but had not cannot
  // report success.
  const clean = out.every((i) => collidingVariantIds(i.variants ?? []).length === 0);

  return {
    items: out,
    repairs,
    repairedItemCount: repairs.length,
    repairedVariantCount,
    unrepaired,
    clean,
  };
}

/** Owner-facing summary of a blanket apply. */
export function describeApplyResult(result: ApplyResult<ApplyItem>): string {
  const { repairedItemCount, repairedVariantCount, unrepaired } = result;
  if (repairedItemCount === 0 && unrepaired.length === 0) {
    return "No products had sizes that Leafly could not tell apart. Nothing needed changing.";
  }
  const parts: string[] = [];
  if (repairedItemCount > 0) {
    parts.push(
      `Corrected ${repairedItemCount} product${repairedItemCount === 1 ? "" : "s"} ` +
        `(${repairedVariantCount} size${repairedVariantCount === 1 ? "" : "s"}) so Leafly can tell ` +
        `their sizes apart. No size was invented, dropped, or repriced.`,
    );
  }
  if (unrepaired.length > 0) {
    parts.push(
      `${unrepaired.length} product${unrepaired.length === 1 ? "" : "s"} still need${
        unrepaired.length === 1 ? "s" : ""
      } a person: ${unrepaired
        .slice(0, 3)
        .map((u) => u.itemName)
        .join("; ")}${unrepaired.length > 3 ? `; and ${unrepaired.length - 3} more` : ""}.`,
    );
  }
  return parts.join(" ");
}

/* ========================================================================== */
/* Embedded self-tests                                                        */
/* ========================================================================== */

export function __runLeaflyCollisionApplyTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean): void => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`leafly-collision-apply FAIL: ${name}`);
    }
  };

  /* ---- parseSizeFromLabel: reads only, never invents ------------------- */
  ok("reads 1g", JSON.stringify(parseSizeFromLabel("1g")) === JSON.stringify({ kind: "weight", value: 1, unit: "g" }));
  ok("reads 3.5 g with a space", (parseSizeFromLabel("3.5 g") as { value: number }).value === 3.5);
  ok("reads grams spelled out", (parseSizeFromLabel("2 grams") as { value: number }).value === 2);
  ok("reads oz", (parseSizeFromLabel("1oz") as { unit: string }).unit === "oz");
  ok("reads ounce spelled out", (parseSizeFromLabel("0.5 ounce") as { unit: string }).unit === "oz");
  ok("reads a 10pk as a count", JSON.stringify(parseSizeFromLabel("10pk")) === JSON.stringify({ kind: "count", value: 10 }));
  ok("reads '5 pack' as a count", (parseSizeFromLabel("5 pack") as { value: number }).value === 5);
  ok("reads '3ct' as a count", (parseSizeFromLabel("3ct") as { value: number }).value === 3);
  ok("reads '2 x 0.5g' as a count of 2", JSON.stringify(parseSizeFromLabel("2 x 0.5g")) === JSON.stringify({ kind: "count", value: 2 }));
  ok("bare number is a count", JSON.stringify(parseSizeFromLabel("2")) === JSON.stringify({ kind: "count", value: 2 }));
  ok("empty label reads nothing", parseSizeFromLabel("") === null);
  ok("null label reads nothing", parseSizeFromLabel(null) === null);
  ok("'each' is not a size", parseSizeFromLabel("each") === null);
  ok("pure prose reads nothing", parseSizeFromLabel("Dragon Balm") === null);
  // R1, the most important negative: mg is NOT silently made into grams.
  ok("mg is NOT converted to grams", parseSizeFromLabel("10mg") === null);
  ok("zero is not a size", parseSizeFromLabel("0g") === null);
  ok("negative is not parsed", parseSizeFromLabel("-1g") === null);

  /* ---- collision detection --------------------------------------------- */
  const collided: ApplyVariant[] = [
    { id: "a", amount: 1, unit: "each", label: "1g" },
    { id: "b", amount: 1, unit: "each", label: "3g" },
    { id: "c", amount: 1, unit: "each", label: "5g" },
  ];
  ok("three identical descriptions collide", collidingVariantIds(collided).length === 3);
  ok(
    "distinct sizes do not collide",
    collidingVariantIds([
      { id: "a", amount: 1, unit: "g" },
      { id: "b", amount: 3, unit: "g" },
    ]).length === 0,
  );
  ok("a lone variant cannot collide", collidingVariantIds([{ id: "a", amount: 1, unit: "each" }]).length === 0);
  ok("same amount, different unit does not collide", collidingVariantIds([
    { id: "a", amount: 1, unit: "g" },
    { id: "b", amount: 1, unit: "each" },
  ]).length === 0);

  /* ---- Strategy A: restore the weight ---------------------------------- */
  {
    const item: ApplyItem = {
      id: "i1",
      type: "Concentrate",
      name: "Live Resin",
      variants: [
        { id: "v1", amount: 1, unit: "each", label: "1g", price: 1200 },
        { id: "v2", amount: 1, unit: "each", label: "3g", price: 3300 },
      ],
    };
    const { item: fixed, repair } = repairItem(item);
    ok("A: concentrate weights restored", repair !== null && repair.kind === "restored_weight");
    ok("A: amounts now differ", fixed.variants[0].amount === 1 && fixed.variants[1].amount === 3);
    ok("A: unit is now g", fixed.variants.every((v) => v.unit === "g"));
    ok("A: collision is gone", collidingVariantIds(fixed.variants).length === 0);
    // R3: money and stock untouched.
    ok("A: price untouched", fixed.variants[0].price === 1200 && fixed.variants[1].price === 3300);
    // Immutability: the input must not have been edited.
    ok("A: input not mutated", item.variants[0].amount === 1 && item.variants[0].unit === "each");
  }

  /* ---- R4: never produce an unlawful unit ------------------------------ */
  {
    // A PreRoll is each-only. Even though the labels are weights, strategy A
    // must NOT fire, because `g` is illegal for this type.
    const item: ApplyItem = {
      id: "i2",
      type: "PreRoll",
      name: "Sunset Sherbet PreRoll",
      variants: [
        { id: "v1", amount: 1, unit: "each", label: "1g" },
        { id: "v2", amount: 1, unit: "each", label: "2g" },
      ],
    };
    const { item: fixed, repair } = repairItem(item);
    ok("R4: preroll never becomes grams", fixed.variants.every((v) => v.unit === "each"));
    ok("R4: weight-labelled each-only type is refused, not forced", repair !== null && repair.kind === "unrepaired");
    ok("R4: the refusal explains splitting", repair !== null && /separate Leafly products/.test(repair.reason ?? ""));
  }

  /* ---- Strategy B: distinct counts on an each-only type ---------------- */
  {
    const item: ApplyItem = {
      id: "i3",
      type: "PreRoll",
      name: "Blue Dream PreRolls",
      variants: [
        { id: "v1", amount: 1, unit: "each", label: "2pk" },
        { id: "v2", amount: 1, unit: "each", label: "5pk" },
      ],
    };
    const { item: fixed, repair } = repairItem(item);
    ok("B: pack counts used", repair !== null && repair.kind === "distinct_each_amount");
    ok("B: amounts are the counts", fixed.variants[0].amount === 2 && fixed.variants[1].amount === 5);
    ok("B: unit stays lawful", fixed.variants.every((v) => v.unit === "each"));
    ok("B: collision resolved", collidingVariantIds(fixed.variants).length === 0);
  }

  /* ---- Strategy C: refuse rather than guess ---------------------------- */
  {
    const noLabels: ApplyItem = {
      id: "i4",
      type: "Topical",
      name: "Dragon Balm",
      variants: [
        { id: "v1", amount: 1, unit: "each", label: null },
        { id: "v2", amount: 1, unit: "each", label: null },
      ],
    };
    const { item: same, repair } = repairItem(noLabels);
    ok("C: unlabelled sizes are refused", repair !== null && repair.kind === "unrepaired");
    // R2: refusing must NOT drop anything.
    ok("C: no size dropped", same.variants.length === 2);
    ok("C: nothing invented", same.variants.every((v) => v.amount === 1));
    ok("C: reason names the missing labels", repair !== null && /no size label/.test(repair.reason ?? ""));
  }
  {
    const dupLabels: ApplyItem = {
      id: "i5",
      type: "Edible",
      name: "Gummies",
      variants: [
        { id: "v1", amount: 1, unit: "each", label: "10pk" },
        { id: "v2", amount: 1, unit: "each", label: "10pk" },
      ],
    };
    const { repair } = repairItem(dupLabels);
    ok("C: identical labels are refused", repair !== null && repair.kind === "unrepaired");
    ok("C: reason names the duplicate", repair !== null && /SAME label/.test(repair.reason ?? ""));
  }

  /* ---- healthy items are left completely alone ------------------------- */
  {
    const healthy: ApplyItem = {
      id: "i6",
      type: "Flower",
      name: "OG Kush",
      variants: [
        { id: "v1", amount: 3.5, unit: "g", label: "3.5g" },
        { id: "v2", amount: 7, unit: "g", label: "7g" },
      ],
    };
    const { repair } = repairItem(healthy);
    ok("healthy item produces NO repair", repair === null);
  }
  {
    const single: ApplyItem = {
      id: "i7",
      type: "Topical",
      name: "Solo",
      variants: [{ id: "v1", amount: 1, unit: "each", label: null }],
    };
    ok("single-variant item produces no repair", repairItem(single).repair === null);
  }

  /* ---- the blanket pass ------------------------------------------------- */
  {
    const payload: ApplyItem[] = [
      {
        id: "p1",
        type: "Concentrate",
        name: "Shatter",
        variants: [
          { id: "a1", amount: 1, unit: "each", label: "1g" },
          { id: "a2", amount: 1, unit: "each", label: "2g" },
        ],
      },
      {
        id: "p2",
        type: "Topical",
        name: "Unfixable Balm",
        variants: [
          { id: "b1", amount: 1, unit: "each", label: null },
          { id: "b2", amount: 1, unit: "each", label: null },
        ],
      },
      {
        id: "p3",
        type: "Flower",
        name: "Healthy",
        variants: [
          { id: "c1", amount: 3.5, unit: "g", label: "3.5g" },
          { id: "c2", amount: 7, unit: "g", label: "7g" },
        ],
      },
    ];
    const res = applyCollisionRepairs(payload);
    ok("blanket: one item repaired", res.repairedItemCount === 1);
    ok("blanket: two variants changed", res.repairedVariantCount === 2);
    ok("blanket: one item reported unrepaired", res.unrepaired.length === 1);
    // R2 again, at the payload level.
    ok("blanket: no item is dropped", res.items.length === 3);
    ok(
      "blanket: no variant is dropped",
      res.items.reduce((n, i) => n + i.variants.length, 0) === 6,
    );
    // The honesty property: `clean` must be FALSE while something still collides.
    ok("blanket: NOT clean while one item still collides", res.clean === false);
    ok("blanket: healthy item untouched", res.items[2].variants[0].amount === 3.5);
    ok("blanket: input payload not mutated", payload[0].variants[0].amount === 1);

    const narrative = describeApplyResult(res);
    ok("blanket: narrative names the unrepaired product", narrative.includes("Unfixable Balm"));
    ok("blanket: narrative promises no invention", /invented/.test(narrative));
    ok("blanket: narrative leads with a count, not an id", !narrative.includes("p1"));
  }
  {
    // All-clean case: `clean` must be TRUE and say so plainly.
    const res = applyCollisionRepairs([
      {
        id: "q1",
        type: "Cartridge",
        name: "Cart",
        variants: [
          { id: "d1", amount: 1, unit: "each", label: "0.5g" },
          { id: "d2", amount: 1, unit: "each", label: "1g" },
        ],
      },
    ]);
    ok("all-clean: reports clean", res.clean === true);
    ok("all-clean: collision really gone", collidingVariantIds(res.items[0].variants).length === 0);
    ok("all-clean: 0.5g preserved exactly", res.items[0].variants[0].amount === 0.5);
  }
  {
    const res = applyCollisionRepairs([]);
    ok("empty payload is clean and silent", res.clean === true && res.repairedItemCount === 0);
    ok("empty payload narrative says nothing needed changing", /Nothing needed changing/.test(describeApplyResult(res)));
  }

  /* ---- the exact defect from the owner's error message ------------------ */
  {
    // 1g / 3g / 5g, medical and adult, all collapsed to "1 each" -- the real
    // shape decoded from the owner's 124-error push.
    const ownersItem: ApplyItem = {
      id: "pos-45c6e282e0e8",
      type: "Concentrate",
      name: "RSO Syringe",
      variants: [
        { id: "pos-45c6e282e0e8-cca24072824d", amount: 1, unit: "each", label: "1g", price: 1200 },
        { id: "pos-45c6e282e0e8-00de6c9e8f2c", amount: 1, unit: "each", label: "3g", price: 3300 },
        { id: "pos-45c6e282e0e8-feda4c3b3628", amount: 1, unit: "each", label: "5g", price: 4500 },
      ],
    };
    ok("owner's item collides before", collidingVariantIds(ownersItem.variants).length === 3);
    const res = applyCollisionRepairs([ownersItem]);
    ok("owner's item is repaired", res.clean === true);
    ok("owner's 1g preserved", res.items[0].variants[0].amount === 1 && res.items[0].variants[0].unit === "g");
    ok("owner's 3g restored", res.items[0].variants[1].amount === 3);
    ok("owner's 5g restored", res.items[0].variants[2].amount === 5);
    ok("owner's prices untouched", res.items[0].variants.map((v) => v.price).join(",") === "1200,3300,4500");
    ok("owner's variant ids untouched", res.items[0].variants[0].id === "pos-45c6e282e0e8-cca24072824d");
  }

  /* ---- UNIVERSAL INVARIANT: no repair may EVER emit an unlawful unit ----
   *
   * Added after mutation testing. Two separate guards enforce R4 (the
   * `weightAllowed` precondition and the per-size `legal.includes()` check),
   * and breaking EITHER alone changed nothing -- each mutant was equivalent,
   * because the other guard still held. Only breaking BOTH produced "1g" on
   * a PreRoll.
   *
   * Redundant guards are good engineering and bad test coverage: they let a
   * defect hide until the day someone simplifies "dead" code and removes the
   * survivor. So this asserts the PROPERTY directly, across every type and a
   * broad spread of labels, instead of trusting either guard. It fails the
   * moment an unlawful unit reaches the wire, by whatever route.
   */
  {
    const labelSpread = ["1g", "3g", "5g", "3.5g", "1oz", "0.5 ounce", "10pk", "2pk", "each", "", "10mg", "Balm"];
    let illegal = 0;
    let checked = 0;
    for (const type of Object.keys(UNITS_BY_TYPE)) {
      const legal = UNITS_BY_TYPE[type];
      // Seed with a unit that is LAWFUL for this type.
      //
      // The first version of this sweep seeded every type with "each",
      // including Flower -- which is weight-only, so the input was already
      // invalid before any repair ran. It reported 228 "violations" that
      // were really just `repairItem` correctly declining to touch an item
      // it could not fix (rule R2: never drop, never rewrite blindly). The
      // invariant was right and its FIXTURE was wrong, which is the same
      // class of mistake as testing against an invented error code: the
      // test, not the system, was the thing that did not match reality.
      const seedUnit = legal[0];
      for (const a of labelSpread) {
        for (const b of labelSpread) {
          const { item: fixed } = repairItem({
            id: `t-${type}`,
            type,
            name: `${type} probe`,
            variants: [
              { id: "x1", amount: 1, unit: seedUnit, label: a, price: 100 },
              { id: "x2", amount: 1, unit: seedUnit, label: b, price: 200 },
            ],
          });
          for (const v of fixed.variants) {
            checked += 1;
            if (!(legal as readonly string[]).includes(v.unit)) illegal += 1;
            // R1 corollary: an amount must never be zero, negative or NaN.
            if (!Number.isFinite(v.amount) || v.amount <= 0) illegal += 1;
          }
        }
      }
    }
    ok("INVARIANT: the sweep actually ran", checked === 10 * 12 * 12 * 2);
    ok("INVARIANT: no unlawful unit or impossible amount is ever emitted", illegal === 0);

    // And the complementary guarantee: an item the repair REFUSES must come
    // back byte-for-byte identical. "We could not fix it" must never mean
    // "we changed it anyway".
    {
      const untouchable: ApplyItem = {
        id: "u1",
        type: "Topical",
        name: "Dragon Balm",
        variants: [
          { id: "t1", amount: 1, unit: "each", label: null, price: 500, inventoryLevel: 3 },
          { id: "t2", amount: 1, unit: "each", label: null, price: 900, inventoryLevel: 7 },
        ],
      };
      const before = JSON.stringify(untouchable);
      const { item: after, repair } = repairItem(untouchable);
      ok("INVARIANT: a refused item is returned unchanged", JSON.stringify(after) === before);
      ok("INVARIANT: a refusal is reported, not silent", repair !== null && repair.kind === "unrepaired");
    }
  }

  /* ---- UNIVERSAL INVARIANT: a repair never loses or reprices anything --- */
  {
    const labelSpread = ["1g", "3g", "10pk", "2pk", "", "10mg"];
    let lost = 0;
    let repriced = 0;
    for (const type of Object.keys(UNITS_BY_TYPE)) {
      for (const a of labelSpread) {
        for (const b of labelSpread) {
          const input: ApplyItem = {
            id: "keep",
            type,
            name: "probe",
            variants: [
              { id: "k1", amount: 1, unit: "each", label: a, price: 111, inventoryLevel: 4 },
              { id: "k2", amount: 1, unit: "each", label: b, price: 222, inventoryLevel: 9 },
            ],
          };
          const { item: fixed } = repairItem(input);
          if (fixed.variants.length !== 2) lost += 1;
          if (fixed.variants[0]?.price !== 111 || fixed.variants[1]?.price !== 222) repriced += 1;
          if (fixed.variants[0]?.inventoryLevel !== 4) repriced += 1;
          if (fixed.variants[0]?.id !== "k1" || fixed.variants[1]?.id !== "k2") lost += 1;
        }
      }
    }
    ok("INVARIANT: R2 -- no size is ever dropped by a repair", lost === 0);
    ok("INVARIANT: R3 -- price, stock and ids are never touched", repriced === 0);
  }

  /* ---- unit table matches Leafly's published matrix -------------------- */
  ok("Flower is weight-only", JSON.stringify(UNITS_BY_TYPE.Flower) === JSON.stringify(["g", "oz"]));
  ok("PreRoll is each-only", JSON.stringify(UNITS_BY_TYPE.PreRoll) === JSON.stringify(["each"]));
  ok("Concentrate allows both", UNITS_BY_TYPE.Concentrate.includes("g") && UNITS_BY_TYPE.Concentrate.includes("each"));
  ok("Cartridge allows both", UNITS_BY_TYPE.Cartridge.includes("g") && UNITS_BY_TYPE.Cartridge.includes("each"));
  ok("ten types are covered", Object.keys(UNITS_BY_TYPE).length === 10);

  console.log(`leafly-collision-apply: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
