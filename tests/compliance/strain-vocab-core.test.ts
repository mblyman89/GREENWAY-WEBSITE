import { describe, it, expect } from "vitest";
import { buildStrainVocab, __runStrainVocabCoreTests } from "@/lib/ai/kb/strain-vocab-core";

describe("strain-vocab core", () => {
  it("passes its own pure self-tests", () => {
    expect(() => __runStrainVocabCoreTests()).not.toThrow();
  });

  it("falls back to the verified seed when no live terpene rows are passed", () => {
    const v = buildStrainVocab([]);
    expect(v.terpenes.length).toBeGreaterThan(0);
    expect(v.terpenes).toContain("myrcene");
  });

  it("lower-cases, de-dupes and sorts options from live rows + seed", () => {
    const v = buildStrainVocab([
      { name: "Limonene", aroma_notes: ["Citrus", "citrus"], flavor_notes: ["Citrus"] },
    ]);
    expect(v.terpenes).toContain("limonene");
    expect(v.aromaNotes.filter((x) => x === "citrus")).toHaveLength(1);
    const sorted = [...v.aromaNotes].sort((a, b) => a.localeCompare(b));
    expect(v.aromaNotes).toEqual(sorted);
  });
});
