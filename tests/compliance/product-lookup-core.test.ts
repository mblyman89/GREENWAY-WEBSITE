/**
 * T-314 \u2014 AI Product/Strain Lookup pure core.
 *
 * Exercises the embedded self-test (which covers coercion, the >= 90% autofill
 * bar, compliance filtering \u2014 inflammation OUT, relaxing/hungry IN \u2014 and the
 * honest-miss path) plus a few targeted API assertions. Runs under vitest where
 * `server-only` is aliased, so the compliance import resolves.
 */
import { describe, it, expect } from "vitest";
import {
  __runProductLookupTests,
  postProcessLookup,
  coerceStrainType,
  toPct,
  buildLookupUserPrompt,
  lookupToStrainSuggestion,
  LOOKUP_AUTO_MIN_CONFIDENCE,
  PRODUCT_LOOKUP_SYSTEM,
  LOOKUP_HONEST_MISS,
  coerceCategory,
  coercePotencyRatio,
  cleanImageCandidates,
  type RawProductLookup,
} from "@/lib/inventory/product-lookup-core";
import { __runProductLookupParseTests, looseParseLookupJson } from "@/lib/inventory/product-lookup-parse";

const base: RawProductLookup = {
  strain_type: "unknown",
  strain_type_confidence: 0,
  summary: "",
  effects: [],
  aroma_notes: [],
  flavor_notes: [],
  lineage: "",
  found: false,
};

describe("product-lookup-core (T-314)", () => {
  it("embedded self-tests all pass", () => {
    const { passed } = __runProductLookupTests();
    expect(passed).toBeGreaterThanOrEqual(30);
  });

  it("parse core self-tests pass", () => {
    const { passed } = __runProductLookupParseTests();
    expect(passed).toBeGreaterThanOrEqual(6);
  });

  it("shares the 90% autofill bar", () => {
    expect(LOOKUP_AUTO_MIN_CONFIDENCE).toBe(90);
  });

  it("coerces strain types to canonical values", () => {
    expect(coerceStrainType("Indica")).toBe("indica");
    expect(coerceStrainType("SATIVA HYBRID")).toBe("sativa-hybrid");
    expect(coerceStrainType("")).toBe("unknown");
    expect(coerceStrainType(null)).toBe("unknown");
  });

  it("converts 0..1 confidence to a clamped 0..100 integer", () => {
    expect(toPct(0.9)).toBe(90);
    expect(toPct(0.895)).toBe(90);
    expect(toPct(1.5)).toBe(100);
    expect(toPct(-0.2)).toBe(0);
  });

  it("autofills only at >= 90% and only for a real strain type", () => {
    expect(
      postProcessLookup({ ...base, found: true, strain_type: "indica", strain_type_confidence: 0.9 })
        .autofillStrainType,
    ).toBe(true);
    expect(
      postProcessLookup({ ...base, found: true, strain_type: "indica", strain_type_confidence: 0.89 })
        .autofillStrainType,
    ).toBe(false);
    expect(
      postProcessLookup({ ...base, found: true, strain_type: "unknown", strain_type_confidence: 1 })
        .autofillStrainType,
    ).toBe(false);
  });

  it("keeps experiential effects and drops medical ones (Michael's rule)", () => {
    const r = postProcessLookup({
      ...base,
      found: true,
      effects: ["relaxed", "energizing", "hungry", "appetite", "inflammation"],
    });
    expect(r.effects).toContain("relaxed");
    expect(r.effects).toContain("energizing");
    expect(r.effects).toContain("hungry");
    expect(r.effects).toContain("appetite");
    expect(r.effects).not.toContain("inflammation");
    expect(r.rejectedEffects.some((x) => x.effect === "inflammation")).toBe(true);
  });

  it("drops a summary that carries a medical/curative claim", () => {
    const r = postProcessLookup({
      ...base,
      found: true,
      summary: "This strain reduces inflammation and cures anxiety.",
    });
    expect(r.summary).toBe("");
  });

  it("keeps a clean sensory summary", () => {
    const r = postProcessLookup({
      ...base,
      found: true,
      summary: "Bright citrus aroma with a smooth, earthy finish and a mellow character.",
    });
    expect(r.summary.length).toBeGreaterThan(0);
  });

  it("never guesses: not found yields no draft and no autofill", () => {
    const r = postProcessLookup({ ...base, found: false });
    expect(r.autofillStrainType).toBe(false);
    expect(r.hasKbDraft).toBe(false);
    expect(r.strainType).toBe("unknown");
  });

  it("offers a KB draft when real detail is present", () => {
    const r = postProcessLookup({
      ...base,
      found: true,
      strain_type: "hybrid",
      strain_type_confidence: 0.7,
      aroma_notes: ["gas", "pine"],
    });
    expect(r.hasKbDraft).toBe(true);
  });

  it("builds a user prompt including the query and vendor", () => {
    const p = buildLookupUserPrompt({ query: "Blue Dream", vendorOrBrand: "Acme Farms" });
    expect(p).toContain("Blue Dream");
    expect(p).toContain("Acme Farms");
  });

  it("system prompt bakes in the no-guess + compliance rules", () => {
    expect(PRODUCT_LOOKUP_SYSTEM).toContain("NEVER GUESS");
    expect(PRODUCT_LOOKUP_SYSTEM).toContain("I-502");
  });

  it("converts a confident result into a strain suggestion, null otherwise", () => {
    const hi = postProcessLookup({
      ...base,
      found: true,
      strain_type: "sativa",
      strain_type_confidence: 0.95,
    });
    expect(lookupToStrainSuggestion(hi)?.value).toBe("sativa");
    const miss = postProcessLookup({ ...base, found: false });
    expect(lookupToStrainSuggestion(miss)).toBeNull();
  });

  it("honest-miss message is defined", () => {
    expect(LOOKUP_HONEST_MISS.toLowerCase()).toContain("reliable");
  });

  it("tolerant JSON parser extracts embedded objects", () => {
    const o = looseParseLookupJson('prose {"found":true,"strain_type":"indica"} tail') as Record<
      string,
      unknown
    >;
    expect(o.found).toBe(true);
    expect(o.strain_type).toBe("indica");
  });
});

describe("product-lookup-core all-inclusive fields (T-315)", () => {
  it("category coercion maps synonyms and never guesses", () => {
    expect(coerceCategory("Beverage")).toBe("beverage");
    expect(coerceCategory("gummies")).toBe("edible");
    expect(coerceCategory("cartridge")).toBe("vape");
    expect(coerceCategory("who knows")).toBe("");
  });

  it("potency ratio is extracted or blank", () => {
    expect(coercePotencyRatio("1:1")).toBe("1:1");
    expect(coercePotencyRatio("ratio 20:1 cbd")).toBe("20:1");
    expect(coercePotencyRatio("none")).toBe("");
  });

  it("image candidates drop junk/svg/dupes and cap", () => {
    const out = cleanImageCandidates([
      "https://cdn.x.com/p/rays.jpg",
      "https://cdn.x.com/p/rays.jpg",
      "https://cdn.x.com/logo.png",
      "https://cdn.x.com/a.svg",
      "http://cdn.x.com/p/berry.png",
      "not-a-url",
    ]);
    expect(out).toEqual(["https://cdn.x.com/p/rays.jpg", "http://cdn.x.com/p/berry.png"]);
    expect(cleanImageCandidates(null as unknown)).toEqual([]);
  });

  it("non-flower product stages enrichment without autofilling strain", () => {
    const r = postProcessLookup({
      ...base,
      found: true,
      strain_type: "unknown",
      description: "Bright raspberry lemonade with a balanced, easygoing lift.",
      short_description: "Balanced 1:1 raspberry lemonade.",
      category: "beverage",
      potency_ratio: "1:1",
      size: "12oz",
      image_candidates: ["https://cdn.x.com/p/rays-raspberry.jpg"],
    });
    expect(r.autofillStrainType).toBe(false);
    expect(r.category).toBe("beverage");
    expect(r.potencyRatio).toBe("1:1");
    expect(r.size).toBe("12oz");
    expect(r.description.length).toBeGreaterThan(0);
    expect(r.imageCandidates).toHaveLength(1);
    expect(r.hasEnrichmentDraft).toBe(true);
  });

  it("medical description is blocked even for non-flower", () => {
    const r = postProcessLookup({
      ...base,
      found: true,
      description: "This tincture reduces inflammation and cures insomnia.",
      category: "tincture",
    });
    expect(r.description).toBe("");
    expect(r.hasEnrichmentDraft).toBe(false);
  });
});
