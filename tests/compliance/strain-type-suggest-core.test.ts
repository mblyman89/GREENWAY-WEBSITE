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

  it("learns over time: a new active saved strain grows the pool by one", () => {
    const seed = buildStrainTypeSuggestion("sativa");
    const learned = buildStrainTypeSuggestion("sativa", {
      extraRows: [
        {
          slug: "__vitest_unique_sativa__",
          strain_type: "sativa",
          terpenes: ["myrcene"],
          aroma_notes: ["citrus"],
          flavor_notes: ["orange"],
        },
      ],
    });
    expect(learned.sampleSize).toBe(seed.sampleSize + 1);
  });

  it("de-dupes by slug so a saved strain never double-counts its seed copy", () => {
    const seed = buildStrainTypeSuggestion("indica");
    const withDupe = buildStrainTypeSuggestion("indica", {
      extraRows: [
        {
          // 'afghani' is a seed indica; reusing its slug must not grow the count.
          slug: "afghani",
          strain_type: "indica",
          terpenes: ["myrcene"],
          aroma_notes: ["earthy"],
          flavor_notes: ["pine"],
        },
      ],
    });
    expect(withDupe.sampleSize).toBe(seed.sampleSize);
  });

  it("empty options equals the seed-only baseline (backward compatible)", () => {
    expect(JSON.stringify(buildStrainTypeSuggestion("hybrid", {}))).toBe(
      JSON.stringify(buildStrainTypeSuggestion("hybrid")),
    );
  });

  it("ignores blank fields on a saved strain (can't skew a field it lacks)", () => {
    // A saved strain with NO terpenes must not change the terpene ranking.
    const seed = buildStrainTypeSuggestion("hybrid");
    const withBlank = buildStrainTypeSuggestion("hybrid", {
      extraRows: [
        {
          slug: "__vitest_blank_terps__",
          strain_type: "hybrid",
          terpenes: [],
          aroma_notes: ["sweet"],
          flavor_notes: ["berry"],
        },
      ],
    });
    expect(withBlank.terpenes).toEqual(seed.terpenes);
  });
});
