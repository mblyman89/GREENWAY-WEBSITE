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
    expect(passed).toBeGreaterThanOrEqual(20);
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
