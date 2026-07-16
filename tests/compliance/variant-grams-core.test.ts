/**
 * AN-1 — per-variant grams for the WAC 314-55-095 limit engine (vitest
 * mirror).
 *
 * Mirrors the pure self-tests in src/lib/pos/variant-grams-core.ts and pins
 * the contract: plain weight labels ("3.5g", "1oz") parse to per-unit grams
 * exactly as the transform's parsePackageSize computes gramsEquivalent
 * (g → quantity, oz → quantity × 28); every non-weight label (mg/ml/fl oz
 * doses, packs, "each", blanks, free text) returns null so the limit engine
 * keeps its conservative per-category default; and line grams are the
 * WHOLE-LINE total (sales-limits-core's lineGrams never multiplies by
 * quantity when explicit grams are provided).
 */
import { describe, expect, it } from "vitest";
import {
  __runVariantGramsCoreTests,
  gramsFromVariantLabel,
  lineGramsFromUnit,
  normalizeUnitGrams,
} from "../../src/lib/pos/variant-grams-core";

describe("variant-grams-core (AN-1)", () => {
  it("passes its pure self-tests", () => {
    expect(() => __runVariantGramsCoreTests()).not.toThrow();
  });

  it("parses the transform's weight labels to statute-equivalent grams", () => {
    expect(gramsFromVariantLabel("3.5g")).toBe(3.5);
    expect(gramsFromVariantLabel("7g")).toBe(7);
    expect(gramsFromVariantLabel("14g")).toBe(14);
    expect(gramsFromVariantLabel("1oz")).toBe(28);
    expect(gramsFromVariantLabel("2oz")).toBe(56);
    expect(gramsFromVariantLabel("0.5g")).toBe(0.5);
    expect(gramsFromVariantLabel(" 3.5 G ")).toBe(3.5);
    expect(gramsFromVariantLabel("1 gram")).toBe(1);
    expect(gramsFromVariantLabel("2 ounces")).toBe(56);
  });

  it("returns null for every non-weight label so category defaults apply", () => {
    expect(gramsFromVariantLabel("100mg")).toBeNull();
    expect(gramsFromVariantLabel("30ml")).toBeNull();
    expect(gramsFromVariantLabel("1fl oz")).toBeNull();
    expect(gramsFromVariantLabel("2pk")).toBeNull();
    expect(gramsFromVariantLabel("each")).toBeNull();
    expect(gramsFromVariantLabel("5 each")).toBeNull();
    expect(gramsFromVariantLabel("")).toBeNull();
    expect(gramsFromVariantLabel(null)).toBeNull();
    expect(gramsFromVariantLabel(undefined)).toBeNull();
    expect(gramsFromVariantLabel("0g")).toBeNull();
    expect(gramsFromVariantLabel("-3g")).toBeNull();
    expect(gramsFromVariantLabel("premium flower")).toBeNull();
  });

  it("normalizes untrusted per-unit grams (pg numeric may arrive as text)", () => {
    expect(normalizeUnitGrams(3.5)).toBe(3.5);
    expect(normalizeUnitGrams("3.5")).toBe(3.5);
    expect(normalizeUnitGrams(0)).toBeNull();
    expect(normalizeUnitGrams(-1)).toBeNull();
    expect(normalizeUnitGrams(NaN)).toBeNull();
    expect(normalizeUnitGrams(Infinity)).toBeNull();
    expect(normalizeUnitGrams("abc")).toBeNull();
    expect(normalizeUnitGrams("-3")).toBeNull();
    expect(normalizeUnitGrams(null)).toBeNull();
    expect(normalizeUnitGrams(3.0000004)).toBe(3);
  });

  it("computes whole-LINE grams (explicit grams are the line total)", () => {
    expect(lineGramsFromUnit(3.5, 2)).toBe(7);
    expect(lineGramsFromUnit(7, 4)).toBe(28);
    expect(lineGramsFromUnit(1.1, 3)).toBe(3.3);
    expect(lineGramsFromUnit(null, 3)).toBeNull();
    expect(lineGramsFromUnit(3.5, 0)).toBeNull();
    expect(lineGramsFromUnit(-2, 3)).toBeNull();
  });
});
