/**
 * tests/compliance/promotion-selector-ai-core.test.ts  (PR-P3)
 *
 * The AI Smart Selector's PURE transform (AI draft -> validated
 * SelectionPredicate). Runs the module's embedded self-tests and adds explicit
 * vitest assertions for the safety-critical anti-hallucination invariants:
 *   - an empty/vague draft yields a predicate that selects NOTHING (never all)
 *   - brands/categories/vendors not on the live menu are DROPPED (+warned)
 *   - only real size buckets and cannabinoid codes survive
 *   - numeric ranges are clamped and backwards ranges are removed
 *   - the schema is a FLAT shape (no arrays-of-objects) the AI layer supports
 */
import { describe, it, expect } from "vitest";
import {
  draftToPredicate,
  predicateDraftSchema,
  __runPromotionSelectorAiTests,
  SENTINEL,
  type MenuVocabulary,
  type PredicateDraft,
} from "@/lib/promotions/promotion-selector-ai-core";
import { predicateHasPositiveCondition } from "@/lib/promotions/promotion-selector-core";

const VOCAB: MenuVocabulary = {
  brands: ["Artizen", "Fairwinds"],
  categories: ["flower", "edibles", "prerolls"],
  vendors: ["Northwest Cannabis Solutions"],
  strainTypes: ["indica", "sativa", "hybrid", "cbd", "unknown"],
  inventoryStatuses: ["in_stock", "low_stock"],
};

function draft(over: Partial<PredicateDraft> = {}): PredicateDraft {
  const base: PredicateDraft = {
    sizes: [],
    categories: [],
    strainTypes: [],
    brands: [],
    vendors: [],
    nameContains: [],
    nameExcludes: [],
    hasCannabinoid: [],
    priceMinDollars: SENTINEL,
    priceMaxDollars: SENTINEL,
    weightMinGrams: SENTINEL,
    weightMaxGrams: SENTINEL,
    thcMinPercent: SENTINEL,
    thcMaxPercent: SENTINEL,
    cbdMinPercent: SENTINEL,
    cbdMaxPercent: SENTINEL,
    ratioProducts: false,
    lowStock: false,
    lowStockThreshold: SENTINEL,
    newArrival: false,
    onSaleFilter: "any",
    inventoryStatuses: [],
    summary: "",
  };
  return { ...base, ...over };
}

describe("promotion-selector-ai-core embedded self-tests", () => {
  it("all embedded assertions pass", () => {
    const r = __runPromotionSelectorAiTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(24);
  });
});

describe("anti-hallucination invariants", () => {
  it("an empty draft selects NOTHING (fail-safe, never everything)", () => {
    const r = draftToPredicate(draft(), VOCAB);
    expect(r.empty).toBe(true);
    expect(predicateHasPositiveCondition(r.predicate)).toBe(false);
    expect(Object.keys(r.predicate)).toHaveLength(0);
  });

  it("drops brands not on the live menu and warns", () => {
    const r = draftToPredicate(draft({ brands: ["Artizen", "TotallyFakeBrand"] }), VOCAB);
    expect(r.predicate.brands).toEqual(["Artizen"]);
    expect(r.warnings.some((w) => w.includes("TotallyFakeBrand"))).toBe(true);
  });

  it("drops categories not on the live menu and warns", () => {
    const r = draftToPredicate(draft({ categories: ["flower", "spaceweed"] }), VOCAB);
    expect(r.predicate.categories).toEqual(["flower"]);
    expect(r.warnings.some((w) => w.toLowerCase().includes("category"))).toBe(true);
  });

  it("canonicalizes vocab values to the menu's own casing", () => {
    const r = draftToPredicate(draft({ brands: ["artizen"], categories: ["FLOWER"] }), VOCAB);
    expect(r.predicate.brands).toEqual(["Artizen"]);
    expect(r.predicate.categories).toEqual(["flower"]);
  });

  it("keeps only real size buckets and cannabinoid codes", () => {
    const r = draftToPredicate(
      draft({ sizes: ["eighth", "grande", "ounce"], hasCannabinoid: ["cbg", "nonsense", "cbn"] }),
      VOCAB,
    );
    expect(r.predicate.sizes).toEqual(["eighth", "ounce"]);
    expect(r.predicate.hasCannabinoid).toEqual(["cbg", "cbn"]);
  });
});

describe("numeric range handling", () => {
  it("converts price dollars to cents and treats 0 as a real floor", () => {
    const r = draftToPredicate(draft({ priceMinDollars: 0, priceMaxDollars: 30 }), VOCAB);
    expect(r.predicate.priceMinCents).toBe(0);
    expect(r.predicate.priceMaxCents).toBe(3000);
  });

  it("drops a backwards price range and warns", () => {
    const r = draftToPredicate(draft({ priceMinDollars: 50, priceMaxDollars: 10 }), VOCAB);
    expect(r.predicate.priceMinCents).toBeUndefined();
    expect(r.predicate.priceMaxCents).toBeUndefined();
    expect(r.warnings.some((w) => w.toLowerCase().includes("price range was backwards"))).toBe(true);
  });

  it("clamps THC to <= 100 and ignores the sentinel", () => {
    const r = draftToPredicate(draft({ thcMinPercent: 999, thcMaxPercent: SENTINEL }), VOCAB);
    expect(r.predicate.thcMinPercent).toBe(100);
    expect(r.predicate.thcMaxPercent).toBeUndefined();
  });
});

describe("flags and sale filter", () => {
  it("maps onSaleFilter to the tri-state onSaleAlready", () => {
    expect(draftToPredicate(draft({ onSaleFilter: "only_not_on_sale" }), VOCAB).predicate.onSaleAlready).toBe(false);
    expect(draftToPredicate(draft({ onSaleFilter: "only_on_sale" }), VOCAB).predicate.onSaleAlready).toBe(true);
    expect(draftToPredicate(draft({ onSaleFilter: "any" }), VOCAB).predicate.onSaleAlready).toBeUndefined();
  });

  it("carries lowStock with an optional threshold", () => {
    expect(draftToPredicate(draft({ lowStock: true, lowStockThreshold: 5 }), VOCAB).predicate.lowStockThreshold).toBe(5);
    expect(draftToPredicate(draft({ lowStock: true }), VOCAB).predicate.lowStockThreshold).toBeUndefined();
  });
});

describe("schema shape", () => {
  it("is a flat schema (no arrays-of-objects) the AI layer supports", () => {
    for (const [, spec] of Object.entries(predicateDraftSchema.shape)) {
      expect(["string", "enum", "stringArray", "number", "boolean"]).toContain(spec.kind);
    }
  });

  it("locks sizes and cannabinoids to an allowed enum list", () => {
    const sizes = predicateDraftSchema.shape.sizes;
    const cann = predicateDraftSchema.shape.hasCannabinoid;
    expect(sizes.kind).toBe("stringArray");
    expect(cann.kind).toBe("stringArray");
    if (sizes.kind === "stringArray") expect(sizes.allowed).toContain("eighth");
    if (cann.kind === "stringArray") expect(cann.allowed).toContain("cbg");
  });
});
