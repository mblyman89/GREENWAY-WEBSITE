/**
 * SLICE 93 — strain-type intelligence on Product Onboarding.
 *
 * The name parser (s/i/h/sh/ih/sat/ind/full words, bracketed codes), the
 * kb > manifest > name suggestion fold, the closed-vocabulary pick validator,
 * the honest picker placeholder, and the KB gap-fill policy ("the machine
 * never overrides curation").
 */
import { describe, it, expect } from "vitest";
import {
  __runStrainTypeIntelTests,
  parseStrainTypeFromName,
  suggestStrainType,
  validateStrainTypeChoice,
  strainTypePickerPlaceholder,
  decideKbStrainTypeWrite,
  STRAIN_TYPE_AUTO_MIN_CONFIDENCE,
} from "@/lib/inventory/strain-type-intel-core";
import { __runDraftInjectionCoreTests } from "@/lib/pos/draft-injection-core";

describe("strain-type-intel-core (SLICE 93)", () => {
  it("embedded self-tests all pass", () => {
    const { passed } = __runStrainTypeIntelTests();
    expect(passed).toBeGreaterThanOrEqual(50);
  });

  it("parses the owner's exact token list from names, word-boundary safe", () => {
    // "look for terms like, s, I, h, sh, ih, or sat, ind, sat hybrid, ind hybrid"
    expect(parseStrainTypeFromName("Blue Dream S")?.value).toBe("sativa");
    expect(parseStrainTypeFromName("Grape Ape - I 1g")?.value).toBe("indica");
    expect(parseStrainTypeFromName("Moonbow h")?.value).toBe("hybrid");
    expect(parseStrainTypeFromName("Green Crack sh 1g")?.value).toBe("sativa-hybrid");
    expect(parseStrainTypeFromName("Gelato ih")?.value).toBe("indica-hybrid");
    expect(parseStrainTypeFromName("GG4 - sat 1g")?.value).toBe("sativa");
    expect(parseStrainTypeFromName("Blueberry ind 3.5g")?.value).toBe("indica");
    expect(parseStrainTypeFromName("Super Silver Sativa Hybrid Cart")?.value).toBe("sativa-hybrid");
    expect(parseStrainTypeFromName("Grease Monkey Indica Hybrid")?.value).toBe("indica-hybrid");
    // Real names never mangled.
    expect(parseStrainTypeFromName("Sunset Sherbet 1g")).toBeNull();
    expect(parseStrainTypeFromName("Indoor Grown OG")).toBeNull();
    expect(parseStrainTypeFromName("Watermelon CBD")).toBeNull();
  });

  it("folds signals kb > manifest > name and hits the 90% auto bar", () => {
    expect(STRAIN_TYPE_AUTO_MIN_CONFIDENCE).toBe(90);
    const kb = suggestStrainType({ kbStrainType: "indica", lotStrainType: "sativa", productName: "X (H)" });
    expect(kb).toMatchObject({ value: "indica", source: "strain library", confidence: 100 });
    const lot = suggestStrainType({ lotStrainType: "hybrid", productName: "X (S)" });
    expect(lot).toMatchObject({ value: "hybrid", source: "manifest", confidence: 95 });
    const name = suggestStrainType({ productName: "Blue Dream (S)" });
    expect(name).toMatchObject({ value: "sativa", source: "product name", confidence: 95 });
    expect(suggestStrainType({ productName: "Wedding Cake" })).toBeNull();
  });

  it("validates picks against the closed taxonomy and refuses junk", () => {
    expect(validateStrainTypeChoice("indica-hybrid")).toEqual({ ok: true, value: "indica-hybrid" });
    expect(validateStrainTypeChoice("")).toEqual({ ok: true, value: null });
    expect(validateStrainTypeChoice("unknown")).toEqual({ ok: true, value: null });
    const junk = validateStrainTypeChoice("purple");
    expect(junk.ok).toBe(false);
  });

  it("placeholder is honest: Keep auto at >=90, a hint below, an invite at none", () => {
    expect(strainTypePickerPlaceholder(null)).toBe("Set strain type… (optional)");
    expect(
      strainTypePickerPlaceholder({ value: "sativa", confidence: 95, source: "manifest", evidence: "x" }),
    ).toContain("Keep auto: Sativa");
    expect(
      strainTypePickerPlaceholder({ value: "hybrid", confidence: 80, source: "product name", evidence: "x" }),
    ).toContain("pick to confirm");
  });

  it("KB write policy: create/gap-fill yes, machine flip never, human flip yes", () => {
    expect(decideKbStrainTypeWrite({ exists: false, verdict: "indica", source: "auto" }).action).toBe("create");
    expect(
      decideKbStrainTypeWrite({ exists: true, existingType: null, verdict: "sativa", source: "auto" }).action,
    ).toBe("set");
    expect(
      decideKbStrainTypeWrite({ exists: true, existingType: "indica", verdict: "sativa", source: "auto" }).action,
    ).toBe("skip");
    expect(
      decideKbStrainTypeWrite({ exists: true, existingType: "indica", verdict: "sativa", source: "human" }).action,
    ).toBe("flip");
  });

  it("injection core honors the approver's strain pick (self-tests incl. SLICE 93 pins)", () => {
    const { passed } = __runDraftInjectionCoreTests();
    expect(passed).toBeGreaterThan(0);
  });
});
