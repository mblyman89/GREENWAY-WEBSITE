import { describe, it, expect } from "vitest";
import {
  postProcessStrainLookup,
  coerceRawStrainLookup,
  toPct,
  __runStrainLookupCoreTests,
} from "@/lib/ai/kb/strain-lookup-core";

describe("strain-lookup core", () => {
  it("passes its own pure self-tests", () => {
    expect(() => __runStrainLookupCoreTests()).not.toThrow();
  });

  it("canonicalizes the strain type and lower-cases + de-dupes terpenes", () => {
    const r = postProcessStrainLookup(
      coerceRawStrainLookup({
        strain_type: "Sativa Hybrid",
        strain_type_confidence: 0.9,
        terpenes: ["Limonene", "limonene", "Pinene"],
        found: true,
      }),
    );
    expect(r.strainType).toBe("sativa-hybrid");
    expect(r.terpenes).toEqual(["limonene", "pinene"]);
  });

  it("drops a medical-claim summary but keeps the other fields", () => {
    const r = postProcessStrainLookup(
      coerceRawStrainLookup({
        strain_type: "indica",
        terpenes: ["myrcene"],
        summary: "Cures insomnia and relieves pain.",
        found: true,
      }),
    );
    expect(r.summary).toBe("");
    expect(r.rejectedSummary).not.toBeNull();
    expect(r.terpenes).toEqual(["myrcene"]);
  });

  it("never counts an empty result as a find, even if found=true", () => {
    const r = postProcessStrainLookup(
      coerceRawStrainLookup({ strain_type: "unknown", found: true }),
    );
    expect(r.found).toBe(false);
    expect(r.hasAnyFindings).toBe(false);
  });

  it("scales confidence to 0-100", () => {
    expect(toPct(0.85)).toBe(85);
    expect(toPct(90)).toBe(90);
  });
});
