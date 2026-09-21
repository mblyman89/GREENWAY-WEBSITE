/**
 * COLLISION REMEDY -- turning 124 identical errors into one decision.
 *
 * ###########################################################################
 * # WHY THIS FILE EXISTS                                                    #
 * #                                                                         #
 * # The owner's full-menu push failed with 124 errors, every one of them    #
 * # the same shape:                                                         #
 * #                                                                         #
 * #   items[101].variants: 2 sizes of this item are all described to        #
 * #   Leafly as "1 each" (pos-45c6e282e0e8-cca24072824d,                    #
 * #   pos-45c6e282e0e8-00de6c9e8f2c)                                        #
 * #                                                                         #
 * # He asked, verbatim:                                                     #
 * #                                                                         #
 * #   "if the fix is something simple, that could be blanket applied to     #
 * #    many products, please build that into the system somehow in a        #
 * #    professional expert enterprise way."                                 #
 * #                                                                         #
 * # It is simple, and it can be blanket applied -- but ONLY because of      #
 * # what the investigation found, and NOT in the way the existing error     #
 * # message suggests.                                                       #
 * ###########################################################################
 *
 * FINDING J-1: WHAT THE DATA ACTUALLY IS
 *
 * Variant ids are `${itemId}-${stableId(label, priceMinorUnits, medical)}`
 * (src/lib/pos/transform.ts:1044), where `stableId` is a 12-hex-char SHA-1
 * prefix over the collapsed parts (transform.ts:266). That is a small enough
 * domain to invert by exhaustive search, and doing so recovered an EXACT
 * SHA-1 match for all five variant ids the owner pasted:
 *
 *   cca24072824d -> label "1g", $12.00, medical
 *   00de6c9e8f2c -> label "3g", $33.00, medical
 *   feda4c3b3628 -> label "5g", $45.00, medical
 *   28e453b71118 -> label "1g", $12.00, adult
 *   34e5d01d3909 -> label "5g", $45.00, adult
 *
 * THE LABELS ARE NOT JUNK. They are "1g", "3g" and "5g" -- clean, real,
 * distinct weights. The owner's data is fine. The message telling him these
 * products need to be split apart by hand is answering the wrong question.
 *
 * WHY THEY COLLAPSE ANYWAY
 *
 * `variantAmountAndUnit()` (payload-core.ts:452) parses the weight correctly
 * and then DISCARDS it when the item's Leafly type does not permit that unit,
 * falling back to `{ amount: 1, unit: "each" }`. Per Leafly's own schema --
 * the `variant.unit` description in docs/leafly-specs/schemas/v2-items.json,
 * which is a verbatim vendored copy of Leafly's published contract:
 *
 *   | Type                                            | Valid variant.unit |
 *   | Accessory, Seeds, Clone, Edible, PreRoll,       | each               |
 *   |   Topical, Other                                |                    |
 *   | Flower                                          | g, oz              |
 *   | Concentrate, Cartridge                          | each, g            |
 *
 * So a gram-labelled PreRoll has nowhere to put the "3". Every size becomes
 * "1 each" and Leafly, which identifies a size by nothing but amount+unit,
 * keeps one and discards the rest.
 *
 * THE TWO LAWFUL REMEDIES
 *
 * 1. CARRY THE WEIGHT. If the item's type permits `g` (Concentrate,
 *    Cartridge) and the label holds a real weight, send the weight. The sizes
 *    become distinguishable with no change to the product at all. This is
 *    free and it is the correct answer whenever it applies.
 *
 * 2. SPLIT INTO SIBLING ITEMS. For genuinely each-only types (PreRoll,
 *    Topical, Edible, ...), Leafly cannot be told the size in the variant, so
 *    the size has to live where Leafly does have room: `item.id` (documented
 *    "Unique to all items in the menu") and `item.name` (free text,
 *    minLength 1). One item per size, named "<name> - 3g".
 *
 * WHY 2 IS NOT "INVENTING DATA"
 *
 * This is the line this module is most careful about. The size text is taken
 * VERBATIM from `menu_variants.label`, which is data we already hold and
 * already show on our own menu. Nothing is computed, rounded, converted or
 * guessed. If a variant has no usable label, it is NOT given a synthesised
 * one -- it is reported as unfixable and left for a human. A plan that
 * quietly manufactures "Size 2" for an unlabelled variant would be exactly
 * the fabrication the standing rules forbid.
 *
 * WHAT THIS MODULE WILL NOT DO
 *
 * It will not drop a size, ever. Dropping a size is a pricing decision on a
 * cannabis menu and belongs to the shop, not to a remediation routine. It
 * also does not APPLY anything: it produces a PLAN that a human reviews. A
 * bulk operation that runs before anyone has read it is how 400 products get
 * renamed at once by mistake.
 *
 * PURE: no React, no DOM, no I/O, no `server-only`. Zero imports. Runs under
 * tsx directly.
 */

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The Leafly funnel types that permit a weight in `variant.unit`.
 *
 * Mirrored deliberately as data rather than imported, to keep this module at
 * zero imports. `__runLeaflyCollisionRemedyTests` cross-checks it against
 * `LEAFLY_TYPE_UNIT_MATRIX` indirectly via the compliance suite, and the
 * vendored schema is the authority for both.
 */
export const WEIGHT_CAPABLE_LEAFLY_TYPES: readonly string[] = ["Flower", "Concentrate", "Cartridge"];

/** Units Leafly accepts in `variant.unit` (v2-items.json enum). */
export const LEAFLY_VARIANT_UNITS: readonly string[] = ["oz", "g", "each"];

/** One size of a product as it exists in OUR system, before Leafly mapping. */
export type RemedyVariant = {
  /** `menu_variants.source_variant_id`. */
  id: string;
  /** `menu_variants.label` -- "1g", "3g", "10pk", "each", or blank. */
  label: string | null;
  priceMinorUnits: number;
};

/** One product that failed with a size collision. */
export type RemedyItem = {
  /** `menu_items.source_item_id`. */
  id: string;
  name: string;
  /** The Leafly funnel type this item maps to ("PreRoll", "Cartridge", ...). */
  leaflyType: string;
  variants: RemedyVariant[];
};

/* -------------------------------------------------------------------------- */
/* Reading a weight out of a label                                            */
/* -------------------------------------------------------------------------- */

export type ParsedLabelWeight = { value: number; unit: "g" | "oz" };

/**
 * Read a real weight out of a variant label, or return null.
 *
 * Intentionally STRICTER than the general-purpose parser in
 * weedmaps/payload-core.ts, and the difference is the point. That parser
 * accepts `mg` and `kg` and `lb` and converts between them, which is right
 * for building a payload. Here a conversion would change what the owner sees
 * printed on his own menu ("3g") into something else ("0.003kg"), and the
 * whole purpose of this module is to preserve the size EXACTLY as recorded.
 *
 * `mg` is refused outright: milligrams on a cannabis label are a POTENCY, not
 * a package weight (the same rule `validatedPackageSize` applies in
 * src/lib/pos/transform.ts:548-566). Treating "100mg" as a package weight
 * would turn a dose into a size and produce a nonsense menu.
 */
export function parseLabelWeight(label: string | null | undefined): ParsedLabelWeight | null {
  if (label === null || label === undefined) return null;
  const text = String(label).toLowerCase().trim();
  if (text.length === 0) return null;

  // Fraction form first ("1/8 oz"), because the decimal pattern would
  // otherwise match the "8" and report an eighth of an ounce as 8 ounces.
  const frac = /(\d+)\s*\/\s*(\d+)\s*(g|gram|grams|oz|ounce|ounces)\b/.exec(text);
  if (frac !== null) {
    const num = Number.parseInt(frac[1], 10);
    const den = Number.parseInt(frac[2], 10);
    if (den > 0) {
      const value = num / den;
      if (Number.isFinite(value) && value > 0) {
        return { value, unit: frac[3].startsWith("o") ? "oz" : "g" };
      }
    }
    return null;
  }

  const dec = /(\d*\.?\d+)\s*(g|gram|grams|oz|ounce|ounces)\b/.exec(text);
  if (dec !== null) {
    const value = Number.parseFloat(dec[1]);
    if (Number.isFinite(value) && value > 0) {
      return { value, unit: dec[2].startsWith("o") ? "oz" : "g" };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Classifying a collision                                                    */
/* -------------------------------------------------------------------------- */

export type RemedyKind =
  /** The type permits a weight and every colliding size has one -- just send it. */
  | "carry_weight"
  /** Each-only type: publish one Leafly item per size, named from the real label. */
  | "split_items"
  /** We cannot fix this safely. A human must look. */
  | "manual";

export type RemedyPlanItem = {
  itemId: string;
  itemName: string;
  leaflyType: string;
  kind: RemedyKind;
  /** Why this kind was chosen, in plain English. */
  reason: string;
  /**
   * For `split_items`: the new item each colliding size becomes.
   * Empty for other kinds.
   */
  splits: Array<{
    variantId: string;
    /** Proposed `item.id` -- the variant id, which is already unique menu-wide. */
    newItemId: string;
    /** Proposed `item.name` -- "<name> - <label>", label taken verbatim. */
    newItemName: string;
    /** The label this name came from. Never synthesised. */
    label: string;
  }>;
  /** Variant ids this plan cannot help with (e.g. no usable label). */
  unfixableVariantIds: string[];
};

/**
 * Decide what to do about ONE item whose sizes collide.
 *
 * The ordering of the checks is the safety argument:
 *   1. Nothing colliding -> no plan. A remedy for a healthy item is noise.
 *   2. Weight-capable type with weights everywhere -> carry the weight. Free,
 *      reversible, changes nothing the customer sees.
 *   3. Every colliding size has a real, DISTINCT label -> split. Uses only
 *      recorded data.
 *   4. Anything else -> manual. Refusing is always available and is the right
 *      answer when the data will not support a safe automatic choice.
 */
export function planRemedyForItem(item: RemedyItem): RemedyPlanItem | null {
  const variants = item.variants ?? [];
  if (variants.length < 2) return null;

  const weightCapable = WEIGHT_CAPABLE_LEAFLY_TYPES.includes(item.leaflyType);
  const weights = variants.map((v) => parseLabelWeight(v.label));

  // --- 2. carry_weight ------------------------------------------------------
  if (weightCapable && weights.every((w) => w !== null)) {
    const keys = weights.map((w) => `${w!.value}|${w!.unit}`);
    if (new Set(keys).size === keys.length) {
      return {
        itemId: item.id,
        itemName: item.name,
        leaflyType: item.leaflyType,
        kind: "carry_weight",
        reason:
          `Every size of this ${item.leaflyType} carries a real weight in its label, and Leafly ` +
          `accepts a weight for this product type, so the sizes can be sent as they are ` +
          `(${weights.map((w) => `${w!.value}${w!.unit}`).join(", ")}). Nothing about the product changes.`,
        splits: [],
        unfixableVariantIds: [],
      };
    }
  }

  // --- 3. split_items -------------------------------------------------------
  const labelled: Array<{ v: RemedyVariant; label: string }> = [];
  const unlabelled: string[] = [];
  for (const v of variants) {
    const label = (v.label ?? "").replace(/\s+/g, " ").trim();
    // "each" is not a size. It is the absence of one, and naming a product
    // "Dragon Balm - each" is worse than leaving it alone.
    if (label.length === 0 || label.toLowerCase() === "each") unlabelled.push(v.id);
    else labelled.push({ v, label });
  }

  const distinctLabels = new Set(labelled.map((l) => l.label.toLowerCase()));
  const canSplit = labelled.length >= 2 && distinctLabels.size === labelled.length;

  if (canSplit) {
    return {
      itemId: item.id,
      itemName: item.name,
      leaflyType: item.leaflyType,
      kind: "split_items",
      reason:
        `Leafly only allows "each" for a ${item.leaflyType}, so it cannot be told these sizes apart ` +
        `and would keep one and discard the rest. Each size is published as its own Leafly product ` +
        `instead, named from the size already recorded on the product ` +
        `(${labelled.map((l) => l.label).join(", ")}). No size is dropped and no size is invented.`,
      splits: labelled.map((l) => ({
        variantId: l.v.id,
        newItemId: l.v.id,
        newItemName: `${item.name} - ${l.label}`,
        label: l.label,
      })),
      unfixableVariantIds: unlabelled,
    };
  }

  // --- 4. manual ------------------------------------------------------------
  const why =
    labelled.length < 2
      ? `Only ${labelled.length} of this item's ${variants.length} sizes has a size label recorded, so there is ` +
        `nothing to tell the others apart by. A size is never invented.`
      : `Two or more sizes of this item carry the SAME label (${labelled.map((l) => l.label).join(", ")}), so ` +
        `splitting them would produce two Leafly products with the same name. The sizes need to be ` +
        `corrected on the product first.`;

  return {
    itemId: item.id,
    itemName: item.name,
    leaflyType: item.leaflyType,
    kind: "manual",
    reason: why,
    splits: [],
    unfixableVariantIds: variants.map((v) => v.id),
  };
}

/* -------------------------------------------------------------------------- */
/* The whole-menu plan                                                        */
/* -------------------------------------------------------------------------- */

export type RemedyPlan = {
  items: RemedyPlanItem[];
  counts: Record<RemedyKind, number>;
  /** Total colliding items considered. */
  total: number;
  /** How many can be fixed with no human decision. */
  automatic: number;
  /** How many need a person. */
  manual: number;
};

export function planRemedies(items: readonly RemedyItem[]): RemedyPlan {
  const plans: RemedyPlanItem[] = [];
  for (const item of items) {
    const p = planRemedyForItem(item);
    if (p !== null) plans.push(p);
  }
  const counts: Record<RemedyKind, number> = { carry_weight: 0, split_items: 0, manual: 0 };
  for (const p of plans) counts[p.kind] += 1;
  return {
    items: plans,
    counts,
    total: plans.length,
    automatic: counts.carry_weight + counts.split_items,
    manual: counts.manual,
  };
}

/**
 * One-paragraph summary for the owner.
 *
 * Leads with the number that answers his actual question -- "can this be
 * blanket applied?" -- rather than with a breakdown he would have to add up
 * himself.
 */
export function describeRemedyPlan(plan: RemedyPlan): string {
  if (plan.total === 0) return "No products have sizes that Leafly cannot tell apart.";

  const bits: string[] = [];
  bits.push(
    `${plan.total} ${plan.total === 1 ? "product has" : "products have"} sizes Leafly cannot tell apart.`,
  );

  if (plan.automatic > 0) {
    bits.push(
      `${plan.automatic} of ${plan.total} can be fixed automatically, in bulk, using size information ` +
        `already recorded on the products.`,
    );
  }
  if (plan.counts.carry_weight > 0) {
    bits.push(
      `${plan.counts.carry_weight} simply need their real weight sent to Leafly, which their product ` +
        `type already allows.`,
    );
  }
  if (plan.counts.split_items > 0) {
    bits.push(
      `${plan.counts.split_items} are product types Leafly only measures in "each", so each size is ` +
        `published as its own Leafly product, named from the size already on the product.`,
    );
  }
  if (plan.manual > 0) {
    bits.push(
      `${plan.manual} cannot be fixed safely without a person, because the size information needed is ` +
        `missing or duplicated. Nothing is guessed for these.`,
    );
  }
  bits.push("No size is ever dropped, and nothing is sent until you approve this plan.");
  return bits.join(" ");
}

/* -------------------------------------------------------------------------- */
/* Self-tests                                                                 */
/* -------------------------------------------------------------------------- */

export function __runLeaflyCollisionRemedyTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL: ${name}`);
    }
  };

  // ---- parseLabelWeight ----
  ok("parse 1g", parseLabelWeight("1g")?.value === 1 && parseLabelWeight("1g")?.unit === "g");
  ok("parse 3g (real, from the owner's data)", parseLabelWeight("3g")?.value === 3);
  ok("parse 5g (real, from the owner's data)", parseLabelWeight("5g")?.value === 5);
  ok("parse 3.5g", parseLabelWeight("3.5g")?.value === 3.5);
  ok("parse with a space", parseLabelWeight("3.5 g")?.value === 3.5);
  ok("parse grams spelled out", parseLabelWeight("3 grams")?.value === 3);
  ok("parse oz", parseLabelWeight("1oz")?.unit === "oz");
  ok("parse ounce spelled out", parseLabelWeight("1 ounce")?.unit === "oz");
  ok("parse uppercase", parseLabelWeight("3.5G")?.value === 3.5);
  ok("parse fraction eighth", parseLabelWeight("1/8 oz")?.value === 0.125);
  ok("parse fraction half gram", parseLabelWeight("1/2g")?.value === 0.5);
  ok("parse leading-dot decimal", parseLabelWeight(".5g")?.value === 0.5);

  // The refusals -- each one is a decision, not an oversight.
  ok("mg is REFUSED (potency, not package weight)", parseLabelWeight("100mg") === null);
  ok("kg is refused (would change the recorded size)", parseLabelWeight("1kg") === null);
  ok("lb is refused", parseLabelWeight("1lb") === null);
  ok("ml is refused (volume is not weight)", parseLabelWeight("30ml") === null);
  ok("pack count is not a weight", parseLabelWeight("10pk") === null);
  ok("'each' is not a weight", parseLabelWeight("each") === null);
  ok("blank is not a weight", parseLabelWeight("") === null);
  ok("whitespace is not a weight", parseLabelWeight("   ") === null);
  ok("null is not a weight", parseLabelWeight(null) === null);
  ok("undefined is not a weight", parseLabelWeight(undefined) === null);
  ok("zero is not a weight", parseLabelWeight("0g") === null);
  ok("a bare number is not a weight", parseLabelWeight("3") === null);
  ok("divide by zero is refused", parseLabelWeight("1/0 g") === null);
  // "1/8 oz" must NOT be read as 8oz -- the fraction branch has to win.
  ok("fraction is not misread as its denominator", parseLabelWeight("1/8 oz")!.value < 1);

  // ---- carry_weight ----
  const cart: RemedyItem = {
    id: "pos-cart",
    name: "Live Resin Cart",
    leaflyType: "Cartridge",
    variants: [
      { id: "pos-cart-a", label: "0.5g", priceMinorUnits: 3000 },
      { id: "pos-cart-b", label: "1g", priceMinorUnits: 5000 },
    ],
  };
  const cartPlan = planRemedyForItem(cart)!;
  ok("cartridge with weights -> carry_weight", cartPlan.kind === "carry_weight");
  ok("carry_weight proposes no splits", cartPlan.splits.length === 0);
  ok("carry_weight has nothing unfixable", cartPlan.unfixableVariantIds.length === 0);
  ok("carry_weight reason names the sizes", cartPlan.reason.includes("0.5g") && cartPlan.reason.includes("1g"));
  ok("carry_weight reassures nothing changes", cartPlan.reason.includes("Nothing about the product changes"));

  // Concentrate is also weight-capable per Leafly's matrix.
  const conc = planRemedyForItem({ ...cart, id: "pos-c2", leaflyType: "Concentrate" })!;
  ok("concentrate is weight-capable too", conc.kind === "carry_weight");

  // Two sizes with the SAME weight are still indistinguishable -- carrying the
  // weight would not help, so it must not be offered.
  const sameWeight = planRemedyForItem({
    ...cart,
    id: "pos-c3",
    variants: [
      { id: "v1", label: "1g", priceMinorUnits: 3000 },
      { id: "v2", label: "1 g", priceMinorUnits: 5000 },
    ],
  })!;
  ok("same weight twice is NOT carry_weight", sameWeight.kind !== "carry_weight");

  // ---- split_items: the owner's actual case ----
  // PreRoll is each-only, labels are the real decoded 1g/3g/5g.
  const preroll: RemedyItem = {
    id: "pos-45c6e282e0e8",
    name: "Dragon Balm CBD RED",
    leaflyType: "PreRoll",
    variants: [
      { id: "pos-45c6e282e0e8-cca24072824d", label: "1g", priceMinorUnits: 1200 },
      { id: "pos-45c6e282e0e8-00de6c9e8f2c", label: "3g", priceMinorUnits: 3300 },
    ],
  };
  const prPlan = planRemedyForItem(preroll)!;
  ok("each-only type with real labels -> split_items", prPlan.kind === "split_items");
  ok("split produces one new item per size", prPlan.splits.length === 2);
  ok(
    "split name uses the REAL label verbatim",
    prPlan.splits[0].newItemName === "Dragon Balm CBD RED - 1g",
  );
  ok("split second name", prPlan.splits[1].newItemName === "Dragon Balm CBD RED - 3g");
  ok(
    "split reuses the variant id, which is already menu-unique",
    prPlan.splits[0].newItemId === "pos-45c6e282e0e8-cca24072824d",
  );
  ok("split new ids are distinct", prPlan.splits[0].newItemId !== prPlan.splits[1].newItemId);
  ok("split loses nothing", prPlan.unfixableVariantIds.length === 0);
  ok("split reason promises nothing is dropped", prPlan.reason.includes("No size is dropped"));
  ok("split reason promises nothing is invented", prPlan.reason.includes("no size is invented"));
  ok("split labels are carried for display", prPlan.splits[0].label === "1g");

  // Three sizes -- the 5g case from items[198]/[201].
  const three = planRemedyForItem({
    ...preroll,
    variants: [
      { id: "a", label: "1g", priceMinorUnits: 1200 },
      { id: "b", label: "3g", priceMinorUnits: 3300 },
      { id: "c", label: "5g", priceMinorUnits: 4500 },
    ],
  })!;
  ok("three colliding sizes all split", three.splits.length === 3);
  ok("third split named from its label", three.splits[2].newItemName.endsWith("- 5g"));

  // Non-weight labels are still perfectly good NAMES for a split.
  const packs = planRemedyForItem({
    id: "pos-p",
    name: "Sour Gummies",
    leaflyType: "Edible",
    variants: [
      { id: "g1", label: "10pk", priceMinorUnits: 1500 },
      { id: "g2", label: "20pk", priceMinorUnits: 2800 },
    ],
  })!;
  ok("pack labels split fine (a label need not be a weight)", packs.kind === "split_items");
  ok("pack split name", packs.splits[1].newItemName === "Sour Gummies - 20pk");

  // ---- manual ----
  const noLabels = planRemedyForItem({
    id: "pos-n",
    name: "Mystery Topical",
    leaflyType: "Topical",
    variants: [
      { id: "n1", label: "", priceMinorUnits: 1000 },
      { id: "n2", label: null, priceMinorUnits: 2000 },
    ],
  })!;
  ok("no labels -> manual", noLabels.kind === "manual");
  ok("manual proposes no splits", noLabels.splits.length === 0);
  ok("manual lists every variant as unfixable", noLabels.unfixableVariantIds.length === 2);
  ok("manual refuses to invent", noLabels.reason.includes("never invented"));

  const eachOnly = planRemedyForItem({
    id: "pos-e",
    name: "Balm",
    leaflyType: "Topical",
    variants: [
      { id: "e1", label: "each", priceMinorUnits: 1000 },
      { id: "e2", label: "each", priceMinorUnits: 2000 },
    ],
  })!;
  ok("'each' labels are not sizes -> manual", eachOnly.kind === "manual");

  const dupLabels = planRemedyForItem({
    id: "pos-d",
    name: "Twin",
    leaflyType: "PreRoll",
    variants: [
      { id: "d1", label: "1g", priceMinorUnits: 1000 },
      { id: "d2", label: "1g", priceMinorUnits: 2000 },
    ],
  })!;
  ok("duplicate labels -> manual (would make two same-named products)", dupLabels.kind === "manual");
  // Match case-insensitively: the sentence emphasises "SAME", and pinning the
  // test to one capitalisation would fail on a harmless copy edit while
  // telling us nothing about behaviour.
  ok(
    "duplicate-label reason explains the clash",
    /same label/i.test(dupLabels.reason) && dupLabels.reason.includes("same name"),
  );

  const oneLabelled = planRemedyForItem({
    id: "pos-o",
    name: "Half Known",
    leaflyType: "PreRoll",
    variants: [
      { id: "o1", label: "1g", priceMinorUnits: 1000 },
      { id: "o2", label: "", priceMinorUnits: 2000 },
    ],
  })!;
  ok("only one usable label -> manual", oneLabelled.kind === "manual");
  ok("partial-label reason counts them honestly", oneLabelled.reason.includes("1 of this item's 2 sizes"));

  // ---- the negative control ----
  ok(
    "a single-variant item produces NO plan",
    planRemedyForItem({ id: "s", name: "S", leaflyType: "PreRoll", variants: [{ id: "s1", label: "1g", priceMinorUnits: 1 }] }) === null,
  );
  ok(
    "a zero-variant item produces NO plan",
    planRemedyForItem({ id: "z", name: "Z", leaflyType: "PreRoll", variants: [] }) === null,
  );

  // ---- planRemedies ----
  const plan = planRemedies([cart, preroll, noLabels as unknown as RemedyItem].slice(0, 2).concat([
    { id: "pos-n2", name: "Mystery", leaflyType: "Topical", variants: [
      { id: "m1", label: "", priceMinorUnits: 1 },
      { id: "m2", label: "", priceMinorUnits: 2 },
    ] },
  ]));
  ok("plan counts every item", plan.total === 3);
  ok("plan counts carry_weight", plan.counts.carry_weight === 1);
  ok("plan counts split_items", plan.counts.split_items === 1);
  ok("plan counts manual", plan.counts.manual === 1);
  ok("plan automatic = carry + split", plan.automatic === 2);
  ok("plan manual matches", plan.manual === 1);
  ok("plan totals add up", plan.automatic + plan.manual === plan.total);

  const empty = planRemedies([]);
  ok("empty plan has no items", empty.total === 0);
  ok("empty plan is all zeroes", empty.automatic === 0 && empty.manual === 0);

  // ---- describeRemedyPlan ----
  ok(
    "empty plan describes silence, not a scary zero",
    describeRemedyPlan(empty) === "No products have sizes that Leafly cannot tell apart.",
  );
  const text = describeRemedyPlan(plan);
  ok("description leads with the count", text.startsWith("3 products have"));
  ok("description answers 'can it be bulk fixed'", text.includes("2 of 3 can be fixed automatically"));
  ok("description mentions bulk", text.includes("in bulk"));
  ok("description is honest about the manual remainder", text.includes("1 cannot be fixed safely"));
  ok("description promises no guessing", text.includes("Nothing is guessed"));
  ok("description promises no dropped sizes", text.includes("No size is ever dropped"));
  ok("description promises approval first", text.includes("until you approve"));

  const singular = describeRemedyPlan(planRemedies([preroll]));
  ok("description uses singular grammar for one item", singular.startsWith("1 product has"));

  console.log(`leafly-collision-remedy: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
