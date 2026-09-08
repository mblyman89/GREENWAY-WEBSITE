/**
 * tests/compliance/liquid-volume-core.test.ts  (SLICE L1)
 *
 * The vitest mirror for the liquid VOLUME basis.
 *
 * TESTING DOCTRINE FOR THIS FILE
 * ------------------------------
 * A test that re-imports a constant and asserts it equals itself proves
 * nothing. So the statutory figures here are derived INDEPENDENTLY from the
 * literal numbers in WAC 314-55-095 -- 72 and 216 fluid ounces at 29.5735
 * ml/fl oz -- and compared against what the module exports. If someone edits
 * the module's cap, these fail. That is the whole point.
 *
 * The oversell table is the oracle. Every row is a real product size that the
 * pre-slice grams path enforced WRONGLY, with the number of units the statute
 * actually allows. Those numbers came from measuring the live modules during
 * recon, not from recollection.
 */
import { describe, expect, it } from "vitest";
import {
  ML_PER_FLUID_OUNCE,
  ML_PER_LITRE,
  REC_LIQUID_FLUID_OUNCES,
  REC_LIQUID_ML,
  MED_LIQUID_FLUID_OUNCES,
  MED_LIQUID_ML,
  toMl,
  volumeMlFromLabel,
  lineVolumeMl,
  formatMl,
  __runLiquidVolumeTests,
} from "../../src/lib/compliance/liquid-volume-core";

/** Independent restatement of the statute, not an import of the answer. */
const STATUTE_FLOZ_TO_ML = 29.5735;
const STATUTE_REC_OZ = 72; // WAC 314-55-095(1)(d)(i)(E)
const STATUTE_MED_OZ = 216; // WAC 314-55-095(2)(d)

describe("the embedded self-tests", () => {
  it("all pass (the tsx/CI path runs this same function)", () => {
    expect(() => __runLiquidVolumeTests()).not.toThrow();
  });
});

describe("statutory constants", () => {
  it("recreational cap is 72 FLUID ounces, per the owner's explicit ruling", () => {
    expect(REC_LIQUID_FLUID_OUNCES).toBe(STATUTE_REC_OZ);
    expect(REC_LIQUID_ML).toBeCloseTo(STATUTE_REC_OZ * STATUTE_FLOZ_TO_ML, 6);
    // The headline number the owner signed off on.
    expect(REC_LIQUID_ML).toBeCloseTo(2129.292, 3);
  });

  it("medical cap is 216 fluid ounces = exactly 3x recreational", () => {
    expect(MED_LIQUID_FLUID_OUNCES).toBe(STATUTE_MED_OZ);
    expect(MED_LIQUID_ML).toBeCloseTo(STATUTE_MED_OZ * STATUTE_FLOZ_TO_ML, 6);
    expect(MED_LIQUID_ML).toBeCloseTo(REC_LIQUID_ML * 3, 6);
  });

  it("is NOT the old 2016-gram weight basis", () => {
    // 2016 = 72 * 28 was the pre-slice cap. It is numerically correct for
    // OUNCE-labelled liquids by coincidence (the 28 cancels) but it is the
    // wrong DIMENSION, and it is what allowed ml/L products to be oversold.
    // If a future edit reverts the cap to a grams figure, this fails.
    expect(REC_LIQUID_ML).not.toBeCloseTo(2016, 0);
    expect(Math.abs(REC_LIQUID_ML - 2016)).toBeGreaterThan(100);
  });

  it("pins the unit conversions", () => {
    expect(ML_PER_FLUID_OUNCE).toBe(29.5735);
    expect(ML_PER_LITRE).toBe(1000);
  });
});

describe("toMl", () => {
  it("converts each recognised unit", () => {
    expect(toMl(30, "ml")).toBeCloseTo(30, 6);
    expect(toMl(1, "l")).toBeCloseTo(1000, 6);
    expect(toMl(1, "floz")).toBeCloseTo(29.5735, 6);
  });

  it("refuses non-positive and non-finite quantities rather than returning 0", () => {
    // Returning 0 would read downstream as "this line consumes no allowance",
    // which is the fail-OPEN direction. null forces the caller to decide.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(toMl(bad, "ml")).toBeNull();
    }
  });
});

describe("volumeMlFromLabel -- the labels that were being oversold", () => {
  it("reads millilitres", () => {
    expect(volumeMlFromLabel("30ml")).toBeCloseTo(30, 6);
    expect(volumeMlFromLabel("30 ml")).toBeCloseTo(30, 6);
    expect(volumeMlFromLabel("30ML")).toBeCloseTo(30, 6);
    expect(volumeMlFromLabel("100 milliliters")).toBeCloseTo(100, 6);
    expect(volumeMlFromLabel("100 millilitres")).toBeCloseTo(100, 6);
  });

  it("reads litres -- the size that previously extracted NOTHING", () => {
    // Neither transform.ts's parsePackageSize nor fact-extraction-core had a
    // litre branch, so a 1 L bottle arrived labelled "each" with no size at
    // all and consumed 1/72nd of the allowance.
    expect(volumeMlFromLabel("1L")).toBeCloseTo(1000, 6);
    expect(volumeMlFromLabel("1 L")).toBeCloseTo(1000, 6);
    expect(volumeMlFromLabel("1.5L")).toBeCloseTo(1500, 6);
    expect(volumeMlFromLabel("1 liter")).toBeCloseTo(1000, 6);
    expect(volumeMlFromLabel("2 litres")).toBeCloseTo(2000, 6);
  });

  it("reads fluid ounces in every spelling", () => {
    expect(volumeMlFromLabel("2 fl oz")).toBeCloseTo(59.147, 3);
    expect(volumeMlFromLabel("12 fl oz")).toBeCloseTo(354.882, 3);
    expect(volumeMlFromLabel("12fl oz")).toBeCloseTo(354.882, 3);
    expect(volumeMlFromLabel("1.7 fl. oz")).toBeCloseTo(50.27495, 5);
    expect(volumeMlFromLabel("8 floz")).toBeCloseTo(236.588, 3);
    expect(volumeMlFromLabel("16 fluid ounces")).toBeCloseTo(473.176, 3);
    expect(volumeMlFromLabel("1 fluid ounce")).toBeCloseTo(29.5735, 6);
  });

  it("does not mistake 'mL' for litres -- ml is tried first", () => {
    // If LITRE_RE ran before ML_RE, "750 mL" would parse as 750 litres and the
    // limit would be 750,000 ml. This ordering is load-bearing.
    expect(volumeMlFromLabel("750 mL")).toBeCloseTo(750, 6);
    expect(volumeMlFromLabel("750ml")).toBeCloseTo(750, 6);
  });

  it("returns null for BARE ounces instead of inventing a density", () => {
    // A bare "oz" is a fluid ounce on a can and a weight ounce on a salve.
    // Guessing is what created this bug class; refusing is correct. The liquid
    // SIZE for ounce labels is still enforced via the existing grams path.
    for (const ambiguous of ["1oz", "12oz", "16 ounces", "2 ounce"]) {
      expect(volumeMlFromLabel(ambiguous)).toBeNull();
    }
  });

  it("returns null for weights, potencies, counts and junk", () => {
    for (const notVolume of [
      "3.5g",
      "1 gram",
      "100mg",
      "4pk",
      "each",
      "",
      "   ",
      "ml",
      "abc",
      "0ml",
      "-5ml",
    ]) {
      expect(volumeMlFromLabel(notVolume)).toBeNull();
    }
    expect(volumeMlFromLabel(null)).toBeNull();
    expect(volumeMlFromLabel(undefined)).toBeNull();
  });

  it("is anchored -- a volume buried in prose is not accepted", () => {
    // Pulling sizes out of free-text NAMES is fact-extraction-core's job and it
    // has its own precedence rules. This parser takes a package-size LABEL, so
    // it must not half-do the other job.
    expect(volumeMlFromLabel("Tonic 750ml Bottle")).toBeNull();
    expect(volumeMlFromLabel("Hi-Fi Hops 12 fl oz can")).toBeNull();
  });

  it("never reads pounds, lots or sizes as litres", () => {
    // The bare `l` alternative is the one genuinely dangerous pattern in the
    // parser. These are real shapes of cannabis product wording.
    for (const notLitres of ["2 Lb", "2 lbs", "5 Lot", "XL", "3 Large", "1 Lid", "2 Lg"]) {
      expect(volumeMlFromLabel(notLitres)).toBeNull();
    }
  });
});

describe("lineVolumeMl", () => {
  it("multiplies per-unit volume by quantity", () => {
    expect(lineVolumeMl(30, 2)).toBeCloseTo(60, 6);
    // Six 12 fl oz cans is EXACTLY the recreational cap -- the boundary case.
    expect(lineVolumeMl(354.882, 6)).toBeCloseTo(REC_LIQUID_ML, 2);
  });

  it("propagates unknown as null rather than collapsing it to 0", () => {
    // 0 would mean "consumes no allowance" -- fail-open. null means "unknown",
    // which is what the receiving gate and the register policy act on.
    expect(lineVolumeMl(null, 5)).toBeNull();
    expect(lineVolumeMl(undefined, 5)).toBeNull();
    expect(lineVolumeMl(0, 5)).toBeNull();
    expect(lineVolumeMl(-1, 5)).toBeNull();
    expect(lineVolumeMl(30, Number.NaN)).toBeNull();
  });

  it("treats a zero quantity as a real zero", () => {
    expect(lineVolumeMl(30, 0)).toBe(0);
  });

  it("rounds fractional quantities to whole units", () => {
    expect(lineVolumeMl(30, 2.4)).toBeCloseTo(60, 6);
  });
});

describe("the oversell oracle -- measured against the live modules in recon", () => {
  // Left column: a real liquid size. Right column: units the STATUTE allows.
  // The pre-slice system allowed 72 of EVERY one of these, because ml/fl oz/L
  // returned null from gramsFromVariantLabel and fell back to 28 g/unit.
  const CASES: [string, number][] = [
    ["2 fl oz", 36],
    ["12 fl oz", 6],
    ["100ml", 21],
    ["500ml", 4],
    ["750ml", 2],
    ["1L", 2],
    ["1.5L", 1],
    ["10ml", 212],
  ];

  it.each(CASES)("%s allows %i units", (label, expected) => {
    const per = volumeMlFromLabel(label);
    expect(per).not.toBeNull();
    expect(Math.floor(REC_LIQUID_ML / (per as number))).toBe(expected);
  });

  it("the worst case was a 72x over-sale", () => {
    const per = volumeMlFromLabel("1.5L") as number;
    const legal = Math.floor(REC_LIQUID_ML / per);
    const oldSystemAllowed = 72; // 2016 g cap / 28 g default unit
    expect(legal).toBe(1);
    expect(oldSystemAllowed / legal).toBe(72);
  });

  it("small tinctures were UNDER-sold, refusing legal sales", () => {
    // The error ran both ways. This is the same class of lost-legal-sale
    // problem that motivated Slice 16.
    const per = volumeMlFromLabel("10ml") as number;
    expect(Math.floor(REC_LIQUID_ML / per)).toBeGreaterThan(72);
  });
});

describe("formatMl", () => {
  it("shows ml with the fluid-ounce equivalent so the cap is readable", () => {
    expect(formatMl(REC_LIQUID_ML)).toBe("2129.3 ml (72.0 fl oz)");
    expect(formatMl(30)).toBe("30 ml (1.0 fl oz)");
  });

  it("does not throw on non-finite input", () => {
    expect(formatMl(Number.NaN)).toBe("0 ml");
  });
});
