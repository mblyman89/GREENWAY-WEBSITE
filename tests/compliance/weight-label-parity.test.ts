/**
 * tests/compliance/weight-label-parity.test.ts  (SLICE W1)
 *
 * THE DRIFT THIS FILE EXISTS TO PREVENT.
 *
 * Three functions answered "how many grams is this label?" and they disagreed
 * on 14 of 37 measured label shapes. The worst pair:
 *
 *   "1/8 oz" -> 224 g in the DISCOUNT engines (an unanchored regex matched the
 *               "8 oz" substring, so an eighth earned the full-ounce 30% tier)
 *            -> null   in the WAC 314-55-095 LIMIT parser
 *   "28 grams" -> 0 g  in the DISCOUNT engines (its gram branch used `\bg\b`)
 *              -> 28 g in the LIMIT parser
 *
 * Nothing failed, because each function was tested only against its OWN
 * hand-picked labels. So the fix is not merely "anchor the regex" -- it is to
 * drive BOTH consumers from ONE shared fixture table, which is what the
 * `WEIGHT_LABEL_FIXTURES` loops below do. Add a label to that table and it is
 * automatically enforced on the register, the website, and the limit engine at
 * once; no future edit can move one parser without the others.
 *
 * DIRECTIONAL SAFETY, stated because the two engines differ:
 *   - discount side: OVER-reporting grams costs the store money;
 *   - limit side:    UNDER-reporting grams risks the LICENSE.
 * The shared parser therefore declines whenever a label is ambiguous, which is
 * the safe direction on both sides simultaneously (0 g = no tier; null =
 * conservative per-category default).
 */
import { describe, it, expect } from "vitest";
import {
  parseWeightLabelGrams,
  WEIGHT_LABEL_FIXTURES,
  __runWeightLabelTests,
} from "@/lib/compliance/weight-label-core";
import { gramsForLabel as gramsForLabelEngine } from "@/lib/promotions/discount-engine-core";
import { gramsForLabel as gramsForLabelCart } from "@/lib/specials/cart-discount";
import { gramsFromVariantLabel } from "@/lib/pos/variant-grams-core";
import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";

describe("SLICE W1: one weight-label parser, three consumers", () => {
  it("runs the core's own embedded self-tests", () => {
    expect(() => __runWeightLabelTests()).not.toThrow();
  });

  it("the fixture table is non-trivial (covers weights AND refusals)", () => {
    // A truncated or all-null table would let every parity loop below pass
    // vacuously, so the table itself is guarded.
    expect(WEIGHT_LABEL_FIXTURES.length).toBeGreaterThan(40);
    expect(WEIGHT_LABEL_FIXTURES.some((f) => f.grams !== null)).toBe(true);
    expect(WEIGHT_LABEL_FIXTURES.some((f) => f.grams === null)).toBe(true);
  });

  it("has no duplicate fixture labels (a dupe would hide a disagreement)", () => {
    const keys = WEIGHT_LABEL_FIXTURES.map((f) => f.label);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // -------------------------------------------------------------------------
  // THE PARITY LOOPS -- every fixture, every consumer.
  // -------------------------------------------------------------------------

  it.each(WEIGHT_LABEL_FIXTURES.map((f) => [f.label, f.grams, f.why] as const))(
    "shared parser: %j -> %s  (%s)",
    (label, grams) => {
      expect(parseWeightLabelGrams(label)).toBe(grams);
    },
  );

  it("register discount engine agrees with the shared parser on EVERY fixture", () => {
    const disagreements: string[] = [];
    for (const f of WEIGHT_LABEL_FIXTURES) {
      // The discount side collapses "unknown" to 0, which tierPercent reads as
      // "no tier". That is the only representational difference.
      const expected = f.grams ?? 0;
      const actual = gramsForLabelEngine(f.label);
      if (actual !== expected) {
        disagreements.push(`${JSON.stringify(f.label)}: expected ${expected}, got ${actual}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("website cart engine agrees with the shared parser on EVERY fixture", () => {
    const disagreements: string[] = [];
    for (const f of WEIGHT_LABEL_FIXTURES) {
      const expected = f.grams ?? 0;
      const actual = gramsForLabelCart(f.label);
      if (actual !== expected) {
        disagreements.push(`${JSON.stringify(f.label)}: expected ${expected}, got ${actual}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("WAC limit parser agrees with the shared parser on EVERY fixture", () => {
    const disagreements: string[] = [];
    for (const f of WEIGHT_LABEL_FIXTURES) {
      const actual = gramsFromVariantLabel(f.label);
      if (actual !== f.grams) {
        disagreements.push(`${JSON.stringify(f.label)}: expected ${f.grams}, got ${actual}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("register and website are byte-identical to each other (they were duplicated code)", () => {
    for (const f of WEIGHT_LABEL_FIXTURES) {
      expect(gramsForLabelCart(f.label)).toBe(gramsForLabelEngine(f.label));
    }
  });

  it("discount and limit parsers never disagree about whether a weight EXISTS", () => {
    // The exact 224-vs-null class of bug: one side saw a weight, the other did
    // not. Now they must always agree on existence, not just on the number.
    for (const f of WEIGHT_LABEL_FIXTURES) {
      const discountSawWeight = gramsForLabelEngine(f.label) > 0;
      const limitSawWeight = gramsFromVariantLabel(f.label) !== null;
      expect(discountSawWeight).toBe(limitSawWeight);
    }
  });

  // -------------------------------------------------------------------------
  // THE ORIGINAL DEFECT, pinned explicitly.
  // -------------------------------------------------------------------------

  describe("the 1/8 oz defect", () => {
    it("reads an eighth as 3.5 g, NOT the 224 g it used to", () => {
      expect(gramsForLabelEngine("1/8 oz")).toBe(3.5);
      expect(gramsForLabelCart("1/8 oz")).toBe(3.5);
      expect(gramsFromVariantLabel("1/8 oz")).toBe(3.5);
      // 224 = 8 x 28: the substring misread. Never again, on any consumer.
      expect(gramsForLabelEngine("1/8 oz")).not.toBe(224);
      expect(gramsForLabelCart("1/8 oz")).not.toBe(224);
    });

    it("an eighth can never reach the 28 g (30% off) Ounce-Friday tier", () => {
      // The money consequence: 224 g cleared the 28 g tier eight times over.
      expect(gramsForLabelEngine("1/8 oz")).toBeLessThan(7);
      expect(gramsForLabelEngine("1/4 oz")).toBeLessThan(14);
      expect(gramsForLabelEngine("1/2 oz")).toBeLessThan(28);
    });

    it("fractional ounces are exact arithmetic on the statutory ounce", () => {
      expect(parseWeightLabelGrams("1/8 oz")).toBe(STATUTORY_GRAMS_PER_OUNCE / 8);
      expect(parseWeightLabelGrams("1/4 oz")).toBe(STATUTORY_GRAMS_PER_OUNCE / 4);
      expect(parseWeightLabelGrams("1/2 oz")).toBe(STATUTORY_GRAMS_PER_OUNCE / 2);
      expect(parseWeightLabelGrams("3/4 oz")).toBe((STATUTORY_GRAMS_PER_OUNCE * 3) / 4);
      expect(parseWeightLabelGrams("1 1/2 oz")).toBe(STATUTORY_GRAMS_PER_OUNCE * 1.5);
    });

    it("spelled-out grams now parse (they silently returned 0 g before)", () => {
      expect(gramsForLabelEngine("28 grams")).toBe(28);
      expect(gramsForLabelEngine("7 grams")).toBe(7);
      expect(gramsForLabelEngine("1 gram")).toBe(1);
      expect(gramsForLabelCart("28 grams")).toBe(28);
    });

    it("weights are strictly monotonic across the fraction ladder", () => {
      const g = (l: string) => parseWeightLabelGrams(l) ?? 0;
      expect(g("1/8 oz")).toBeLessThan(g("1/4 oz"));
      expect(g("1/4 oz")).toBeLessThan(g("1/2 oz"));
      expect(g("1/2 oz")).toBeLessThan(g("3/4 oz"));
      expect(g("3/4 oz")).toBeLessThan(g("1 oz"));
      expect(g("1 oz")).toBeLessThan(g("1 1/2 oz"));
    });
  });

  // -------------------------------------------------------------------------
  // COMPLIANCE GUARD RAILS -- these must never loosen.
  // -------------------------------------------------------------------------

  describe("compliance guard rails", () => {
    it("VOLUME is never read as WEIGHT (the SLICE L2 fl-oz conflation)", () => {
      // "12 fl oz" once became 336 g of net weight. A fluid ounce is volume.
      for (const v of ["1fl oz", "12 fl oz", "1.7 fl. oz", "12floz", "750ml", "1.5l", "1 liter", "2 litres"]) {
        expect(parseWeightLabelGrams(v)).toBeNull();
        expect(gramsFromVariantLabel(v)).toBeNull();
        expect(gramsForLabelEngine(v)).toBe(0);
      }
    });

    it("mg DOSES and pack COUNTS are never read as weight", () => {
      for (const d of ["100mg", "500 mg", "10mg", "2pk", "10pk", "each", "12 each"]) {
        expect(parseWeightLabelGrams(d)).toBeNull();
        expect(gramsFromVariantLabel(d)).toBeNull();
      }
    });

    it("a weight token beside a pack count is REFUSED, not guessed", () => {
      // The rejected design: parsing "10pk 0.5g" as 0.5 g per unit would
      // UNDER-report a ten-pack whose conservative category default is 5 g.
      // Under-reporting on the limit side is the license-risk direction.
      expect(parseWeightLabelGrams("10pk 0.5g")).toBeNull();
      expect(parseWeightLabelGrams("1g 10pk")).toBeNull();
      expect(gramsFromVariantLabel("10pk 0.5g")).toBeNull();
    });

    it("garbage, zero, negative and divide-by-zero all decline", () => {
      for (const bad of ["", " ", "0g", "-3g", "0/8 oz", "1/0 oz", "premium flower", "oz", "3.5", "2 lbs", "5 lot", "xl gummy"]) {
        expect(parseWeightLabelGrams(bad)).toBeNull();
      }
      expect(parseWeightLabelGrams(null)).toBeNull();
      expect(parseWeightLabelGrams(undefined)).toBeNull();
    });

    it("never throws on hostile input", () => {
      const hostile = [
        "1/8 oz".repeat(500),
        "9".repeat(400) + "g",
        "\u215B".repeat(50),
        "1/",
        "/8 oz",
        "1//8 oz",
        "1 1/ oz",
        "NaNg",
        "Infinity oz",
        "1e5g",
        "\u0000g",
        "1/8\toz",
        "1/8\noz",
      ];
      for (const h of hostile) {
        expect(() => parseWeightLabelGrams(h)).not.toThrow();
        const v = parseWeightLabelGrams(h);
        // Whatever comes back must be null or a finite positive number --
        // never NaN, never Infinity, which would poison the limit arithmetic.
        expect(v === null || (Number.isFinite(v) && v > 0)).toBe(true);
      }
    });

    it("scientific notation does not sneak past as a weight", () => {
      // "1e5g" must not become 100000 g. The quantity pattern is digits,
      // dots and fractions only.
      expect(parseWeightLabelGrams("1e5g")).toBeNull();
      expect(parseWeightLabelGrams("1e5 oz")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // NO-OP PROOF -- today's real labels cannot move.
  // -------------------------------------------------------------------------

  it("is a NO-OP across every label the importer can actually emit", () => {
    // parsePackageSize builds labels as `${formatNumber(qty)}${unit}`. If W1
    // had changed ANY of these, live discounts or live limit verdicts would
    // have shifted the moment it shipped. Measured: 0 changes.
    const fmt = (v: number) => Number(v.toFixed(2)).toString();
    let checked = 0;
    for (let q = 0.25; q <= 60; q += 0.25) {
      for (const unit of ["g", "oz"]) {
        const label = `${fmt(q)}${unit}`;
        const expected = unit === "g" ? q : q * STATUTORY_GRAMS_PER_OUNCE;
        expect(parseWeightLabelGrams(label)).toBe(Math.round(expected * 1000) / 1000);
        expect(gramsForLabelEngine(label)).toBe(Math.round(expected * 1000) / 1000);
        expect(gramsFromVariantLabel(label)).toBe(Math.round(expected * 1000) / 1000);
        checked += 1;
      }
    }
    // The non-weight shapes the importer emits must all still decline.
    for (let q = 1; q <= 30; q += 1) {
      for (const label of [`${q}mg`, `${q}ml`, `${q}L`, `${q}fl oz`, `${q}pk`, `${q} each`]) {
        expect(parseWeightLabelGrams(label)).toBeNull();
        expect(gramsForLabelEngine(label)).toBe(0);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(600);
  });

  it("the Ounce Friday tier ladder still lands on the intended percents", () => {
    // Guards the CONSUMER, not just the parser: 7 g -> 15%, 14 g -> 20%,
    // 28 g -> 30% (DEFAULT_WEIGHT_TIERS). An eighth must earn nothing.
    const ladder: ReadonlyArray<[string, number]> = [
      ["3.5g", 3.5],
      ["1/8 oz", 3.5],
      ["7g", 7],
      ["1/4 oz", 7],
      ["14g", 14],
      ["1/2 oz", 14],
      ["1oz", 28],
      ["28g", 28],
      ["28 grams", 28],
    ];
    for (const [label, grams] of ladder) {
      expect(gramsForLabelEngine(label)).toBe(grams);
    }
  });
});
