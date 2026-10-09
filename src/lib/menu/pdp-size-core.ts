/**
 * src/lib/menu/pdp-size-core.ts  (R33, T-329)
 *
 * OWNER'S ASK: "the details page needs to add the size and weight of
 * products ... consistent with the existing code and system. Edibles and
 * liquids maybe setup this way already. Flower and concentrates are not."
 *
 * Verified before building: the product page's chip row shows a net-weight
 * chip ONLY for ratio-led products (edibles, drinks, tinctures, topicals -
 * card-cannabinoids.deriveNetWeightLine returns null for everything else),
 * and the purchase panel shows size buttons ONLY when a product has two or
 * more sizes. So a single-size eighth of flower or gram of wax never told the
 * customer how much they were buying anywhere on the page.
 *
 * WHAT THIS DOES (display only - nothing stored changes):
 *   - GRAM-UNIT categories (flower, popcorn bud, infused flower, trim,
 *     prerolls / blunts / packs, concentrates, RSO, cartridges, disposables)
 *     get a size line from the product's REAL measures: its variant labels
 *     ("3.5g", "1 g", "1oz"), else the stored package net weight
 *     (net_weight_grams, migration 0138). Never invented: no measure, no line.
 *   - Grams lead (the industry unit for these products, and the unit the
 *     SLICE 98 rule keeps for them); the familiar retail fraction follows for
 *     the standard sizes ("3.5 g (1/8 oz)"). Those fractions are the WA
 *     retail convention the register already uses (statutory 28 g ounce,
 *     cart-discount.ts "1/8 oz" => 3.5) - the measured avoirdupois value is
 *     used only for weights that are not a standard retail size.
 *   - Several sizes: the range ("1 g – 28 g (1 oz)"), since the size buttons
 *     show each one.
 *   - Ratio-led categories and non-cannabis items return null here; the
 *     existing deriveNetWeightLine keeps owning them (unchanged).
 *
 * Also: the schema.org Product `weight` (QuantitativeValue, UN/CEFACT unit
 * code GRM) for a single-size product, so search engines see the same size
 * the customer does. https://schema.org/weight
 *
 * Pure; self-tests run in the pure runner.
 */
import { parseNetMeasure } from "@/lib/menu/card-cannabinoids";
import { isRatioLedCategory } from "@/lib/menu/cannabinoid-profile-core";
import { displayVariantLabel } from "@/lib/menu/weight-display-core";

/** Website categories whose package size is a weight in grams. */
export const GRAM_SIZE_CATEGORIES: ReadonlySet<string> = new Set([
  "flower",
  "popcorn-bud",
  "infused-flower",
  "trim",
  "preroll",
  "blunt",
  "preroll-pack",
  "infused-preroll",
  "infused-blunt",
  "infused-preroll-pack",
  "cartridge",
  "disposable-cartridge",
  "concentrate",
  "rso",
]);

/** WA retail size names for the standard flower/concentrate weights. */
const RETAIL_FRACTIONS: ReadonlyArray<[number, string]> = [
  [3.5, "1/8 oz"],
  [7, "1/4 oz"],
  [14, "1/2 oz"],
  [28, "1 oz"],
];

function trim2(n: number): string {
  return n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** "3.5 g (1/8 oz)" / "1 g" / "28 g (1 oz)". */
export function gramsLabel(grams: number): string {
  const frac = RETAIL_FRACTIONS.find(([g]) => Math.abs(g - grams) < 0.01);
  return frac ? `${trim2(grams)} g (${frac[1]})` : `${trim2(grams)} g`;
}

type SizeSource = {
  category?: string | null;
  variants?: ReadonlyArray<{ label?: string | null }> | null;
  netWeightGrams?: number | null;
};

/** Distinct real gram sizes of a product, smallest first. */
export function productGramSizes(item: SizeSource): number[] {
  const set = new Set<number>();
  for (const v of item.variants ?? []) {
    const m = parseNetMeasure(v.label ?? null);
    if (m && m.grams !== null && Number.isFinite(m.grams) && m.grams > 0) {
      // An "oz" label converts with the avoirdupois factor (28.3495); snap a
      // whole retail ounce back to the 28 g the register sells it as.
      const g = Math.abs(m.grams - 28.3495 * Math.round(m.grams / 28.3495)) < 0.01 && m.grams >= 28 ? 28 * Math.round(m.grams / 28.3495) : m.grams;
      set.add(Math.round(g * 100) / 100);
    }
  }
  if (set.size === 0 && typeof item.netWeightGrams === "number" && Number.isFinite(item.netWeightGrams) && item.netWeightGrams > 0) {
    set.add(Math.round(item.netWeightGrams * 100) / 100);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * The size line for a gram-unit product's detail page, or null (ratio-led,
 * non-cannabis, or no real measure).
 */
export function pdpSizeLine(item: SizeSource): string | null {
  const cat = String(item.category ?? "").trim().toLowerCase();
  if (!GRAM_SIZE_CATEGORIES.has(cat) || isRatioLedCategory(cat)) return null;
  const sizes = productGramSizes(item);
  if (sizes.length === 0) return null;
  if (sizes.length === 1) return gramsLabel(sizes[0]);
  return `${gramsLabel(sizes[0])} – ${gramsLabel(sizes[sizes.length - 1])}`;
}

/** schema.org Product.weight for a single-size product (any category), else null. */
export function productSchemaWeight(item: SizeSource): { "@type": "QuantitativeValue"; value: number; unitCode: "GRM" } | null {
  const sizes = productGramSizes(item);
  if (sizes.length !== 1) return null;
  return { "@type": "QuantitativeValue", value: sizes[0], unitCode: "GRM" };
}

/**
 * The purchase panel's "Size" line for ONE package label (used when a product
 * has a single size, so no size buttons render). Gram-unit categories read
 * "3.5 g (1/8 oz)" (same words as the chip); every other category keeps the
 * SLICE 98 display rule (displayVariantLabel: ounces for edibles/liquids/
 * topicals). Labels that are not a real size ("each", blank, potency "mg",
 * pack counts the display rule leaves alone) return null - never invented.
 */
export function purchaseSizeLabel(label: string | null | undefined, category: string | null | undefined): string | null {
  const raw = typeof label === "string" ? label.trim() : "";
  if (!raw) return null;
  const cat = String(category ?? "").trim().toLowerCase();
  const m = parseNetMeasure(raw);
  if (GRAM_SIZE_CATEGORIES.has(cat)) {
    if (!m || m.grams === null || !Number.isFinite(m.grams) || m.grams <= 0) return null;
    const sizes = productGramSizes({ variants: [{ label: raw }] });
    return sizes.length === 1 ? gramsLabel(sizes[0]) : null;
  }
  if (!m) return null;
  if ((m.grams !== null && !(m.grams > 0)) || (m.ml !== null && !(m.ml > 0))) return null;
  return displayVariantLabel(raw, cat);
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runPdpSizeCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const eq = (a: unknown, b: unknown, msg: string) => {
    if (JSON.stringify(a) === JSON.stringify(b)) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL pdp-size-core: ${msg} (got ${JSON.stringify(a)})`);
    }
  };
  const v = (...labels: string[]) => labels.map((label) => ({ label }));

  eq(gramsLabel(3.5), "3.5 g (1/8 oz)", "eighth");
  eq(gramsLabel(7), "7 g (1/4 oz)", "quarter");
  eq(gramsLabel(14), "14 g (1/2 oz)", "half");
  eq(gramsLabel(28), "28 g (1 oz)", "ounce");
  eq(gramsLabel(1), "1 g", "gram has no fraction");
  eq(gramsLabel(0.5), "0.5 g", "half gram");

  eq(pdpSizeLine({ category: "flower", variants: v("3.5g") }), "3.5 g (1/8 oz)", "single-size flower");
  eq(pdpSizeLine({ category: "concentrate", variants: v("1 g") }), "1 g", "single-size concentrate");
  eq(pdpSizeLine({ category: "cartridge", variants: v("0.5g") }), "0.5 g", "cartridge");
  eq(pdpSizeLine({ category: "popcorn-bud", variants: v("28g") }), "28 g (1 oz)", "popcorn ounce");
  eq(pdpSizeLine({ category: "flower", variants: v("1oz") }), "28 g (1 oz)", "1oz label snaps to the 28 g retail ounce");
  eq(pdpSizeLine({ category: "flower", variants: v("1g", "3.5g", "28g") }), "1 g – 28 g (1 oz)", "range across sizes");
  eq(pdpSizeLine({ category: "flower", variants: v("3.5g", "3.5 g") }), "3.5 g (1/8 oz)", "duplicate sizes collapse");
  eq(pdpSizeLine({ category: "flower", variants: v("each"), netWeightGrams: 3.5 }), "3.5 g (1/8 oz)", "stored net weight fills a label with no size");
  eq(pdpSizeLine({ category: "flower", variants: v("each") }), null, "no measure -> no line (never invented)");
  eq(pdpSizeLine({ category: "flower", variants: v("100mg") }), null, "mg is potency, never a size");
  eq(pdpSizeLine({ category: "edible-solid", variants: v("50g") }), null, "ratio-led stays with deriveNetWeightLine");
  eq(pdpSizeLine({ category: "topical", variants: v("96.4g") }), null, "topical stays with deriveNetWeightLine");
  eq(pdpSizeLine({ category: "merch", variants: v("1g") }), null, "non-cannabis -> null");
  eq(pdpSizeLine({ category: null, variants: v("1g") }), null, "unknown category -> null");
  eq(pdpSizeLine({ category: "flower", variants: null }), null, "no variants -> null");
  eq(pdpSizeLine({ category: "flower", variants: v("0g") }), null, "zero weight never shown");
  eq(pdpSizeLine({ category: "flower", variants: [], netWeightGrams: -1 }), null, "negative stored weight ignored");
  eq(pdpSizeLine({ category: " Flower ", variants: v("7g") }), "7 g (1/4 oz)", "category trimmed + lower-cased");

  eq(productSchemaWeight({ category: "flower", variants: v("3.5g") }), { "@type": "QuantitativeValue", value: 3.5, unitCode: "GRM" }, "schema weight GRM");
  eq(productSchemaWeight({ category: "edible-solid", variants: v("50g") }), { "@type": "QuantitativeValue", value: 50, unitCode: "GRM" }, "schema weight for an edible too");
  eq(productSchemaWeight({ category: "flower", variants: v("1g", "3.5g") }), null, "multi-size -> no single weight");
  eq(productSchemaWeight({ category: "edible-liquid", variants: v("355ml") }), null, "volume is not a weight");
  eq(productGramSizes({ variants: v("3.5g", "1g", "7g") }), [1, 3.5, 7], "sizes sorted smallest first");

  eq(purchaseSizeLabel("3.5g", "flower"), "3.5 g (1/8 oz)", "panel: flower eighth");
  eq(purchaseSizeLabel("1oz", "flower"), "28 g (1 oz)", "panel: 1oz snaps to 28 g");
  eq(purchaseSizeLabel("1 g", "concentrate"), "1 g", "panel: concentrate gram");
  eq(purchaseSizeLabel("each", "flower"), null, "panel: each -> null");
  eq(purchaseSizeLabel("", "flower"), null, "panel: blank -> null");
  eq(purchaseSizeLabel("100mg", "edible-solid"), null, "panel: potency mg is not a size");
  eq(purchaseSizeLabel("355ml", "edible-liquid"), "12 fl oz", "panel: liquid keeps the SLICE 98 fl oz rule");
  eq(purchaseSizeLabel("100g", "topical"), "3.53 oz", "panel: topical keeps the SLICE 98 oz rule");
  eq(purchaseSizeLabel("0g", "flower"), null, "panel: zero weight never shown");
  eq(purchaseSizeLabel("10 pack", "preroll-pack"), null, "panel: pack count is not a weight");

  console.log(`pdp-size-core self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
