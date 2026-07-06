/**
 * tests/compliance/naming.test.ts  (S-14 / GAP M-11)
 *
 * CCRS Product.Name convention gate (docs/PRODUCT_NAMING_CONVENTION.md):
 * 75-char cap, no commas/disallowed chars, Title Case, no leading symbols.
 * validateName is the HARD-BLOCK submit gate; suggestName is drafts-only.
 */
import { describe, it, expect } from "vitest";
import {
  NAME_MAX_LEN,
  validateName,
  suggestName,
  toTitleCase,
  __runNamingConventionTests,
} from "@/lib/naming/convention-core";

describe("validateName — hard-block gate", () => {
  it("a clean convention name passes", () => {
    expect(validateName("Blue Dream Flower 3.5g T25").ok).toBe(true);
  });
  it("empty names are refused", () => {
    const v = validateName("");
    expect(v.ok).toBe(false);
    expect(v.issues[0].code).toBe("empty");
  });
  it("names over the 75-char CCRS cap are refused", () => {
    expect(NAME_MAX_LEN).toBe(75);
    const long = "A".repeat(76);
    expect(validateName(long).issues.some((i) => i.code === "too_long")).toBe(true);
  });
  it("commas and other disallowed characters are refused", () => {
    for (const bad of ["Blue, Dream", "50/50 Mix", "Rock & Roll", "Wow!", 'Say "Hi"']) {
      expect(
        validateName(bad).issues.some((i) => i.code === "disallowed_char"),
        bad,
      ).toBe(true);
    }
  });
  it("leading symbols are refused", () => {
    expect(validateName("- 3pk Prerolls").issues.some((i) => i.code === "leading_symbol")).toBe(true);
  });
  it("ALL CAPS and all lowercase are refused", () => {
    expect(validateName("BLUE DREAM FLOWER").issues.some((i) => i.code === "all_caps")).toBe(true);
    expect(validateName("blue dream flower").issues.some((i) => i.code === "all_lower")).toBe(true);
  });
  it("double spaces / underscores are refused", () => {
    expect(validateName("Blue  Dream").issues.some((i) => i.code === "double_space")).toBe(true);
    expect(validateName("Blue_Dream").issues.some((i) => i.code === "double_space")).toBe(true);
  });
  it("reports EVERY failing rule at once", () => {
    const v = validateName("blue,  dream");
    const codes = v.issues.map((i) => i.code);
    expect(codes).toContain("disallowed_char");
    expect(codes).toContain("double_space");
    expect(codes).toContain("all_lower");
  });
});

describe("suggestName — drafts-only cleanup", () => {
  it("cleans a messy raw name into a passing one", () => {
    const s = suggestName("- BLUE  DREAM, flower 3.5G!!");
    expect(validateName(s).ok).toBe(true);
  });
  it("clamps to the 75-char cap at a word boundary", () => {
    const s = suggestName("Super Long Product Name ".repeat(10));
    expect(s.length).toBeLessThanOrEqual(NAME_MAX_LEN);
    expect(validateName(s).ok).toBe(true);
  });
  it("title-cases correctly", () => {
    expect(toTitleCase("blue dream")).toMatch(/^Blue Dream/);
  });
});

describe("embedded self-tests still pass under vitest", () => {
  it("__runNamingConventionTests", () => {
    expect(() => __runNamingConventionTests()).not.toThrow();
  });
});
