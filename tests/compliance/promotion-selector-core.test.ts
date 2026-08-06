/**
 * tests/compliance/promotion-selector-core.test.ts  (PR-P2)
 *
 * The deterministic selection brain. Runs the module's embedded self-tests
 * (fail-safe empty predicate, size buckets, cannabinoids, ranges, exclusions,
 * AND-across-kinds, warnings) and adds a few explicit vitest assertions for the
 * safety-critical invariants: exclusions always win, empty predicate selects
 * NOTHING, and every match carries a human reason.
 */
import { describe, it, expect } from "vitest";
import {
  resolveSelection,
  matchProduct,
  describePredicate,
  predicateHasPositiveCondition,
  SIZE_GRAMS,
  __runPromotionSelectorTests,
  type SelectableProduct,
  type SelectionPredicate,
} from "@/lib/promotions/promotion-selector-core";

function product(over: Partial<SelectableProduct> = {}): SelectableProduct {
  return {
    key: "k",
    name: "Blue Dream",
    brand: "Lifted",
    vendor: "Grow Co",
    categories: ["flower"],
    strainType: "hybrid",
    strainName: "Blue Dream",
    priceMinorUnits: 3000,
    netWeightGrams: 3.5,
    variantLabels: ["Eighth"],
    minInventoryLevel: 50,
    thcPercent: 22,
    cbdPercent: 0.1,
    compounds: [],
    ratioLabel: null,
    inventoryStatus: "in_stock",
    ...over,
  };
}

describe("promotion-selector-core embedded self-tests", () => {
  it("passes every embedded assertion with zero failures", () => {
    const r = __runPromotionSelectorTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(25);
  });
});

describe("selection safety invariants", () => {
  it("fail-safe: an empty predicate selects NOTHING (never everything)", () => {
    const menu = [product({ key: "a" }), product({ key: "b" }), product({ key: "c" })];
    const r = resolveSelection(menu, {});
    expect(r.matched).toHaveLength(0);
    expect(r.predicateEmpty).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("exclusions always win over any include condition", () => {
    const p = product({ key: "x", brand: "Lifted", thcPercent: 30 });
    const pred: SelectionPredicate = {
      brands: ["Lifted"],
      thcMinPercent: 20,
      includeKeys: ["x"],
      excludeKeys: ["x"],
    };
    expect(matchProduct(p, pred)).toBeNull();
    expect(resolveSelection([p], pred).matched).toHaveLength(0);
  });

  it("every match carries at least one plain-English reason", () => {
    const menu = [
      product({ key: "hi", thcPercent: 28, categories: ["flower"], netWeightGrams: 28 }),
    ];
    const r = resolveSelection(menu, { categories: ["flower"], thcMinPercent: 20, sizes: ["ounce"] });
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].reasons.length).toBeGreaterThanOrEqual(1);
    for (const reason of r.matched[0].reasons) expect(reason.length).toBeGreaterThan(0);
  });
});

describe("size vocabulary", () => {
  it("uses the owner-confirmed grams table", () => {
    expect(SIZE_GRAMS).toEqual({ gram: 1, eighth: 3.5, quarter: 7, half: 14, ounce: 28 });
  });

  it("matches an eighth by net weight within tolerance", () => {
    const p = product({ netWeightGrams: 3.54, variantLabels: [] });
    expect(resolveSelection([p], { sizes: ["eighth"] }).matched).toHaveLength(1);
    expect(resolveSelection([p], { sizes: ["ounce"] }).matched).toHaveLength(0);
  });
});

describe("predicate helpers", () => {
  it("predicateHasPositiveCondition is false for blank, true with a condition", () => {
    expect(predicateHasPositiveCondition({})).toBe(false);
    expect(predicateHasPositiveCondition({ excludeKeys: ["a"] })).toBe(false);
    expect(predicateHasPositiveCondition({ categories: ["flower"] })).toBe(true);
  });

  it("describePredicate produces a readable sentence", () => {
    const s = describePredicate({ categories: ["flower"], sizes: ["ounce"], thcMinPercent: 20 });
    expect(s).toContain("flower");
    expect(s).toContain("Ounce");
    expect(s).toContain("THC");
    expect(describePredicate({})).toContain("no conditions");
  });
});
