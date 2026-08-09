import { describe, it, expect } from "vitest";
import {
  buildStrainTypeSuggestion,
  suggestionPoolFor,
  houseSuggestedSourceTag,
  __runStrainTypeSuggestCoreTests,
} from "@/lib/ai/kb/strain-type-suggest-core";

describe("strain-type-suggest core", () => {
  it("passes its own pure self-tests", () => {
    expect(() => __runStrainTypeSuggestCoreTests()).not.toThrow();
  });

  it("widens the pool for leaning hybrids", () => {
    expect(suggestionPoolFor("indica-hybrid")).toEqual(["indica-hybrid", "indica", "hybrid"]);
  });

  it("returns grounded, lower-cased, capped suggestions for indica", () => {
    const s = buildStrainTypeSuggestion("Indica");
    expect(s.type).toBe("indica");
    expect(s.sampleSize).toBeGreaterThan(100);
    expect(s.terpenes.length).toBeGreaterThan(0);
    expect(s.terpenes.length).toBeLessThanOrEqual(6);
    expect(s.terpenes.every((t) => t === t.toLowerCase())).toBe(true);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildStrainTypeSuggestion("hybrid"))).toBe(
      JSON.stringify(buildStrainTypeSuggestion("hybrid")),
    );
  });

  it("never fabricates a CBD profile", () => {
    const s = buildStrainTypeSuggestion("cbd");
    expect(s.sampleSize).toBe(0);
    expect(s.terpenes).toEqual([]);
  });

  it("stamps an honest, auditable source tag", () => {
    expect(houseSuggestedSourceTag("sativa-hybrid")).toBe("house-suggested (sativa-hybrid typical)");
  });
});
