/**
 * tests/compliance/liquid-limit-ml-engine.test.ts  (SLICE L4)
 *
 * The liquid sales limit, measured in millilitres against 72 FLUID ounces.
 *
 * This is the slice the owner's bug report was actually about: "the system
 * converts 72 liquid ounces into weighted grams, so it allows me to sell an
 * incredibly larger amount than I'm allowed to sell."
 *
 * TWO THINGS MUST BOTH BE TRUE, and this file asserts both:
 *
 *   1. Every volume-labelled liquid now blocks at its LEGAL package count.
 *   2. Every currently-correct answer is UNCHANGED — ounce-labelled liquids
 *      and, critically, every weight-based TOPICAL (the owner's decision is
 *      that topicals stay on weighted ounces until their own later slice).
 *
 * The second is the harder one, and it is why this rebase is safe: the bucket
 * total and the cap are rescaled by the SAME ratio, so no verdict can move.
 *
 * The statute figures are derived here from WAC/RCW independently rather than
 * imported, so these tests still fail if the implementation's constants drift.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateCart,
  lineMl,
  formatLimitAmount,
  isVolumeBucket,
  LIMIT_BUCKET_UNITS,
  RECREATIONAL_LIMITS,
  MEDICAL_LIMITS,
  DEFAULT_UNIT_GRAMS,
  categoryToBucket,
  type LimitCartLine,
} from "@/lib/compliance/sales-limits-core";

// ── the statute, derived independently ─────────────────────────────────────
const FLOZ_ML = 29.5735; // 1 US fluid ounce in ml
const STATUTORY_G_PER_OZ = 28; // GW-016 enforcement equivalence
const REC_ML = 72 * FLOZ_ML; // WAC 314-55-095(1)(d)(i)(E)
const MED_ML = 216 * FLOZ_ML; // WAC 314-55-095(2)(d)
/** The rescale ratio between the two bases. */
const R = FLOZ_ML / STATUTORY_G_PER_OZ;

const bucket = (v: ReturnType<typeof evaluateCart>, b: string) =>
  v.buckets.find((x) => x.bucket === b)!;

/** Largest quantity of one product that still passes. */
function maxPasses(line: (q: number) => LimitCartLine, ceiling = 400): number {
  for (let q = 1; q <= ceiling; q++) {
    if (evaluateCart([line(q)], "recreational").blocked) return q - 1;
  }
  return ceiling;
}

// ---------------------------------------------------------------------------
describe("SLICE L4 — the bucket is denominated in millilitres", () => {
  it("declares ml, not grams", () => {
    expect(LIMIT_BUCKET_UNITS.liquid_edible).toBe("ml");
    expect(isVolumeBucket("liquid_edible")).toBe(true);
    // The other buckets did NOT move.
    expect(isVolumeBucket("usable")).toBe(false);
    expect(isVolumeBucket("solid_edible")).toBe(false);
    expect(isVolumeBucket("concentrate")).toBe(false);
    expect(isVolumeBucket("low_thc_liquid")).toBe(false);
    expect(isVolumeBucket("otherwise_taken")).toBe(false);
  });

  it("caps recreational at 72 fluid ounces and medical at 216", () => {
    expect(RECREATIONAL_LIMITS.liquid_edible).toBeCloseTo(REC_ML, 6);
    expect(MEDICAL_LIMITS.liquid_edible).toBeCloseTo(MED_ML, 6);
    // Medical is exactly 3x recreational, as the statute has it.
    expect(MEDICAL_LIMITS.liquid_edible / RECREATIONAL_LIMITS.liquid_edible).toBeCloseTo(3, 9);
  });

  it("is NOT the old grams figure", () => {
    // The whole point. 2016 g was a weight cap masquerading as a volume cap.
    expect(RECREATIONAL_LIMITS.liquid_edible).not.toBe(2016);
    expect(MEDICAL_LIMITS.liquid_edible).not.toBe(6048);
  });

  it("renders in fluid ounces, because that is how the statute states it", () => {
    expect(formatLimitAmount("liquid_edible", REC_ML)).toBe("72 fl oz");
    expect(formatLimitAmount("liquid_edible", MED_ML)).toBe("216 fl oz");
    // Rendering ml through the WEIGHT-ounce divisor would say "76.046 oz".
    expect(formatLimitAmount("liquid_edible", REC_ML)).not.toContain("76");
    // The other buckets keep their own languages.
    expect(formatLimitAmount("usable", 28)).toBe("1 oz");
    expect(formatLimitAmount("concentrate", 7)).toBe("7 g");
    expect(formatLimitAmount("low_thc_liquid", 200)).toBe("200 mg THC");
    expect(formatLimitAmount("otherwise_taken", 10)).toBe("10 units");
  });
});

// ---------------------------------------------------------------------------
describe("SLICE L4 — THE BUG: a volume-labelled liquid blocks at its legal count", () => {
  // `oldAllowed` is what the register permitted before this workstream: every
  // ml / fl oz / L label failed gramsFromVariantLabel's g|oz-only regex, fell
  // back to DEFAULT_UNIT_GRAMS["edible-liquid"] = 28, and so allowed exactly
  // 72 packages of ANY size.
  const cases = [
    { label: "2 fl oz", ml: 2 * FLOZ_ML, legal: 36, oldAllowed: 72 },
    { label: "12 fl oz", ml: 12 * FLOZ_ML, legal: 6, oldAllowed: 72 },
    { label: "100 ml", ml: 100, legal: 21, oldAllowed: 72 },
    { label: "500 ml", ml: 500, legal: 4, oldAllowed: 72 },
    { label: "750 ml", ml: 750, legal: 2, oldAllowed: 72 },
    { label: "1 L", ml: 1000, legal: 2, oldAllowed: 72 },
    { label: "1.5 L", ml: 1500, legal: 1, oldAllowed: 72 },
  ];

  it.each(cases)("$label allows $legal, not $oldAllowed", ({ ml, legal }) => {
    const n = maxPasses((q) => ({ category: "edible-liquid", quantity: q, volumeMl: ml * q }));
    expect(n).toBe(legal);
    // and the very next package is refused
    const over = evaluateCart([
      { category: "edible-liquid", quantity: legal + 1, volumeMl: ml * (legal + 1) },
    ]);
    expect(over.blocked).toBe(true);
    expect(bucket(over, "liquid_edible").exceeded).toBe(true);
  });

  it("a 1.5 L growler is ONE package, where 72 used to fit", () => {
    // The headline case: 72 x 1.5 L = 108 litres against a 2.13 litre cap.
    const one = evaluateCart([{ category: "edible-liquid", quantity: 1, volumeMl: 1500 }]);
    expect(one.blocked).toBe(false);
    const two = evaluateCart([{ category: "edible-liquid", quantity: 2, volumeMl: 3000 }]);
    expect(two.blocked).toBe(true);
    expect(bucket(two, "liquid_edible").overBy).toBeCloseTo(3000 - REC_ML, 3);
  });

  it("also fixes the UNDER-sell: a 10 ml dropper allows 212, not 72", () => {
    // The error ran BOTH ways, and this direction was costing legal sales.
    const n = maxPasses((q) => ({ category: "edible-liquid", quantity: q, volumeMl: 10 * q }), 400);
    expect(n).toBe(212);
    expect(n).toBeGreaterThan(72);
  });

  it("medical gets exactly three times the volume", () => {
    // 216 fl oz / 1 L = 6 bottles.
    const six = evaluateCart(
      [{ category: "edible-liquid", quantity: 6, volumeMl: 6000 }],
      "medical",
    );
    expect(six.blocked).toBe(false);
    const seven = evaluateCart(
      [{ category: "edible-liquid", quantity: 7, volumeMl: 7000 }],
      "medical",
    );
    expect(seven.blocked).toBe(true);
  });

  it("blocks on the total across MIXED sizes, not per line", () => {
    // 1 L + 1 L + 200 ml = 2200 ml > 2129.292 ml.
    const v = evaluateCart([
      { category: "edible-liquid", quantity: 1, volumeMl: 1000 },
      { category: "edible-liquid", quantity: 1, volumeMl: 1000 },
      { category: "edible-liquid", quantity: 1, volumeMl: 200 },
    ]);
    expect(bucket(v, "liquid_edible").used).toBeCloseTo(2200, 3);
    expect(v.blocked).toBe(true);
    // ...and 1 L + 1 L + 100 ml = 2100 ml is still legal.
    const ok = evaluateCart([
      { category: "edible-liquid", quantity: 1, volumeMl: 1000 },
      { category: "edible-liquid", quantity: 1, volumeMl: 1000 },
      { category: "edible-liquid", quantity: 1, volumeMl: 100 },
    ]);
    expect(ok.blocked).toBe(false);
  });

  it("counts tinctures in the same bucket", () => {
    expect(categoryToBucket("tincture")).toBe("liquid_edible");
    const v = evaluateCart([{ category: "tincture", quantity: 1, volumeMl: 3000 }]);
    expect(v.blocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("SLICE L4 — NOTHING CURRENTLY CORRECT MOVED", () => {
  // For an OUNCE-labelled product the grams basis was already numerically
  // exact, because the 28 cancels:
  //     2016 / (q*28) == 72/q == (72*29.5735) / (q*29.5735)
  // The rebase must therefore leave these answers untouched.
  const ounceCases = [
    { oz: 1, legal: 72 },
    { oz: 2, legal: 36 },
    { oz: 12, legal: 6 },
    { oz: 16, legal: 4 },
    { oz: 32, legal: 2 },
  ];

  it.each(ounceCases)("an ounce-labelled $oz oz liquid still allows $legal", ({ oz, legal }) => {
    const n = maxPasses((q) => ({
      category: "edible-liquid",
      quantity: q,
      grams: oz * STATUTORY_G_PER_OZ * q,
    }));
    expect(n).toBe(legal);
  });

  // The owner's decision: topicals stay on WEIGHTED ounces until their own
  // slice. categoryToBucket routes them into liquid_edible, so the rebase had
  // to be provably neutral for them.
  const topicalCases = [
    { oz: 1, legal: 72 },
    { oz: 1.7, legal: 42 },
    { oz: 2, legal: 36 },
    { oz: 4, legal: 18 },
    { oz: 8, legal: 9 },
  ];

  it.each(topicalCases)("a $oz oz weight-based TOPICAL still allows $legal", ({ oz, legal }) => {
    const n = maxPasses((q) => ({
      category: "topical",
      quantity: q,
      grams: oz * STATUTORY_G_PER_OZ * q,
    }));
    expect(n).toBe(legal);
  });

  it("routes topicals into the liquid bucket, because the STATUTE puts them there", () => {
    // SLICE T1 - this assertion was written expecting topicals to move OUT to
    // their own bucket in a later slice. Then the statute was actually read,
    // and it says the opposite. WAC 314-55-095(1)(d)(i)(E), current text
    // effective 1/7/2025:
    //
    //   "72 ounces of cannabis-infused product in liquid form for oral
    //    ingestion OR APPLIED TOPICALLY TO THE SKIN, unless the product is
    //    packaged in individual units containing no more than 4 milligrams of
    //    active delta-9 THC per unit"
    //
    // Salves are named INSIDE the 72 ounce clause and share the bucket with
    // drinks by law. There is no separate topical transaction limit anywhere
    // in 314-55-095, and the medical column (2)(d) lists only useable, solid,
    // concentrate and liquid.
    //
    // So moving topicals to their own bucket would INVENT a limit the statute
    // does not contain, and would stop a salve and a drink from sharing the
    // bucket the law says they share -- letting a customer take 72 oz of drink
    // AND a pile of salve in one transaction. That is the permissive
    // direction, which is the one that creates real exposure.
    //
    // Owner decision, recorded: "lets keep topicals in the same liquids
    // bucket". Do NOT "fix" this to a topical bucket.
    expect(categoryToBucket("topical")).toBe("liquid_edible");
    // The same clause, same bucket, for the oral side.
    expect(categoryToBucket("edible-liquid")).toBe("liquid_edible");
    expect(categoryToBucket("tincture")).toBe("liquid_edible");
  });

  it("leaves the other three buckets on grams with their exact values", () => {
    expect(RECREATIONAL_LIMITS.usable).toBe(28);
    expect(RECREATIONAL_LIMITS.solid_edible).toBe(448);
    expect(RECREATIONAL_LIMITS.concentrate).toBe(7);
    expect(MEDICAL_LIMITS.usable).toBe(84);
    expect(MEDICAL_LIMITS.solid_edible).toBe(1344);
    expect(MEDICAL_LIMITS.concentrate).toBe(21);
    expect(LIMIT_BUCKET_UNITS.usable).toBe("g");
    expect(LIMIT_BUCKET_UNITS.solid_edible).toBe("g");
    expect(LIMIT_BUCKET_UNITS.concentrate).toBe("g");
  });

  it("leaves the low-THC mg bucket and the ten-unit bucket alone", () => {
    expect(RECREATIONAL_LIMITS.low_thc_liquid).toBe(200);
    expect(MEDICAL_LIMITS.low_thc_liquid).toBe(200); // NOT tripled
    expect(RECREATIONAL_LIMITS.otherwise_taken).toBe(10);
    expect(MEDICAL_LIMITS.otherwise_taken).toBe(10);
  });

  it("proves the rescale cannot flip a verdict, across the whole range", () => {
    // G <= 2016  <==>  G*R <= 2129.292, for every G. This is the safety
    // argument for the entire slice, asserted rather than asserted-in-prose.
    for (let g = 0; g <= 4000; g += 0.5) {
      expect(g > 2016).toBe(g * R > REC_ML);
    }
    // and the boundary is exact
    expect(2016 * R).toBeCloseTo(REC_ML, 9);
    expect(6048 * R).toBeCloseTo(MED_ML, 9);
  });
});

// ---------------------------------------------------------------------------
describe("SLICE L4 — lineMl source priority", () => {
  it("prefers a real measured volume over any weight", () => {
    // A 1 L bottle whose label ALSO produced a bogus 28 g default must be
    // measured as 1000 ml, not 29.574 ml.
    expect(lineMl({ category: "edible-liquid", quantity: 1, volumeMl: 1000, grams: 28 })).toBeCloseTo(1000, 3);
  });

  it("carries a weight across at its OUNCE-COUNT, assuming no density", () => {
    // 56 g = 2 statutory ounces -> 2 fluid ounces of the 72-ounce allowance.
    expect(lineMl({ category: "edible-liquid", quantity: 1, grams: 56 })).toBeCloseTo(2 * FLOZ_ML, 2);
    // 2dp, not 3: the engine rounds to 3dp (round3), so 29.5735 -> 29.574.
    expect(lineMl({ category: "topical", quantity: 1, grams: 28 })).toBeCloseTo(FLOZ_ML, 2);
  });

  it("falls back to the category default rather than making a line free", () => {
    // An unmeasured liquid must still consume allowance. Free lines are how
    // an oversell becomes invisible.
    const ml = lineMl({ category: "edible-liquid", quantity: 1 });
    expect(ml).toBeGreaterThan(0);
    expect(ml).toBeCloseTo((DEFAULT_UNIT_GRAMS["edible-liquid"] / STATUTORY_G_PER_OZ) * FLOZ_ML, 2);
  });

  it("treats a null/zero/negative volume as 'not measured', never as zero ml", () => {
    for (const bad of [null, undefined, 0, -100]) {
      const ml = lineMl({ category: "edible-liquid", quantity: 1, volumeMl: bad as number | null });
      expect(ml).toBeGreaterThan(0);
    }
  });

  it("returns 0 only for a genuinely absent quantity", () => {
    expect(lineMl({ category: "edible-liquid", quantity: 0 })).toBe(0);
    expect(lineMl({ category: "edible-liquid", quantity: -3 })).toBe(0);
  });

  it("respects an owner unitGrams override through the weight path", () => {
    const ml = lineMl(
      { category: "edible-liquid", quantity: 2 },
      { unitGrams: { "edible-liquid": 56 } },
    );
    expect(ml).toBeCloseTo((112 / STATUTORY_G_PER_OZ) * FLOZ_ML, 3);
  });

  it("scales with quantity", () => {
    expect(lineMl({ category: "edible-liquid", quantity: 3, volumeMl: 1500 })).toBeCloseTo(1500, 3);
    // volumeMl is the LINE total (L3 semantics: per-package x quantity,
    // resolved by the caller), so it is used verbatim.
  });
});

// ---------------------------------------------------------------------------
describe("SLICE L4 — the carve-outs still win over the volume bucket", () => {
  it("a qualifying low-THC drink contributes NOTHING to the ml bucket", () => {
    // (E) and (F) are alternatives, not additive. A 4 mg can is measured in
    // mg of THC, so even a large can must not consume the 72 fl oz.
    const v = evaluateCart([
      { category: "edible-liquid", quantity: 10, lowThcLiquid: true, unitThcMg: 4, volumeMl: 3550 },
    ]);
    expect(bucket(v, "liquid_edible").used).toBe(0);
    expect(bucket(v, "low_thc_liquid").used).toBe(40);
    expect(v.blocked).toBe(false);
  });

  it("a flagged suppository leaves the ml bucket for the ten-unit bucket", () => {
    const v = evaluateCart([
      { category: "topical", quantity: 4, otherwiseTaken: true, unitsPerPackage: 1, volumeMl: 9999 },
    ]);
    expect(bucket(v, "liquid_edible").used).toBe(0);
    expect(bucket(v, "otherwise_taken").used).toBe(4);
  });

  it("an UNFLAGGED liquid still counts, so unknown never unlocks the cap", () => {
    const v = evaluateCart([{ category: "edible-liquid", quantity: 1, volumeMl: 3000 }]);
    expect(bucket(v, "liquid_edible").used).toBeCloseTo(3000, 3);
    expect(v.blocked).toBe(true);
  });
});
