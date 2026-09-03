/**
 * tests/compliance/low-thc-liquid-limit.test.ts  (SLICE 16)
 *
 * The low-THC beverage transaction limit: WAC 314-55-095(1)(d)(i)(E)+(F) for
 * recreational, WAC 314-55-095(2)(d) for medical, RCW 69.50.360(3)(c)+(d).
 *
 * These tests exist to pin FOUR facts that a well-meaning future editor is
 * likely to get wrong, because each one cuts against an obvious pattern:
 *
 *   1. The cap is 200 MILLIGRAMS OF THC, not 200 ounces of volume. (The owner
 *      himself initially read it as ounces; it is an easy mistake.)
 *   2. The MEDICAL cap is ALSO 200 mg. Every other bucket triples for a
 *      DOH-database patient, so `200 * 3` looks right and is wrong.
 *   3. (E) and (F) are MUTUALLY EXCLUSIVE. The word "unless" in (E) carves
 *      qualifying product out of the 72 oz bucket; it never consumes both.
 *   4. A serving is NOT a unit. A single bottle labelled "4 servings x 4 mg" is
 *      one 16 mg unit and does NOT qualify.
 */
import { describe, it, expect } from "vitest";
import {
  LIMIT_BUCKETS,
  LIMIT_BUCKET_UNITS,
  LOW_THC_UNIT_MAX_MG,
  MEDICAL_LIMITS,
  RECREATIONAL_LIMITS,
  clampLimitProfile,
  evaluateCart,
  formatLimitAmount,
  isThcBucket,
  lineBucket,
  lineThcMg,
  qualifiesAsLowThcLiquid,
  type LimitCartLine,
} from "@/lib/compliance/sales-limits-core";

/** A qualifying 4 mg can. */
function can(quantity: number, mg = 4): LimitCartLine {
  return { category: "edible-liquid", quantity, lowThcLiquid: true, unitThcMg: mg };
}

function bucketOf(v: ReturnType<typeof evaluateCart>, name: string) {
  const b = v.buckets.find((x) => x.bucket === name);
  if (!b) throw new Error(`bucket ${name} missing`);
  return b;
}

describe("the statutory numbers themselves", () => {
  it("recreational low-THC liquid is 200 MILLIGRAMS of THC \u2014 not 200 ounces", () => {
    expect(RECREATIONAL_LIMITS.low_thc_liquid).toBe(200);
    // Guard against the ounces misreading: 200 oz would be 5600 g at the
    // statutory 28 g/oz. If anyone ever writes that, this fails loudly.
    expect(RECREATIONAL_LIMITS.low_thc_liquid).not.toBe(200 * 28);
  });

  it("the per-unit qualifying ceiling is 4 mg", () => {
    expect(LOW_THC_UNIT_MAX_MG).toBe(4);
  });

  it("MEDICAL is ALSO 200 mg \u2014 it does NOT triple like every other bucket", () => {
    // WAC 314-55-095(2)(d): "...and up to 200 mg of active delta-9 THC within a
    // cannabis-infused product in liquid form meant to be eaten or swallowed if
    // product is packaged in individual units containing no more than four
    // milligrams of active delta-9 THC per unit."
    expect(MEDICAL_LIMITS.low_thc_liquid).toBe(200);
    expect(MEDICAL_LIMITS.low_thc_liquid).not.toBe(600);
    expect(MEDICAL_LIMITS.low_thc_liquid).toBe(RECREATIONAL_LIMITS.low_thc_liquid);
  });

  it("sanity: every OTHER bucket really does triple, so the 200 mg equality is deliberate", () => {
    expect(MEDICAL_LIMITS.usable).toBe(RECREATIONAL_LIMITS.usable * 3);
    expect(MEDICAL_LIMITS.solid_edible).toBe(RECREATIONAL_LIMITS.solid_edible * 3);
    expect(MEDICAL_LIMITS.concentrate).toBe(RECREATIONAL_LIMITS.concentrate * 3);
    expect(MEDICAL_LIMITS.liquid_edible).toBe(RECREATIONAL_LIMITS.liquid_edible * 3);
  });

  it("the bucket is denominated in mg of THC, not grams", () => {
    expect(LIMIT_BUCKET_UNITS.low_thc_liquid).toBe("mg_thc");
    expect(isThcBucket("low_thc_liquid")).toBe(true);
    expect(LIMIT_BUCKETS).toContain("low_thc_liquid");
    for (const b of ["usable", "solid_edible", "concentrate", "liquid_edible"] as const) {
      expect(LIMIT_BUCKET_UNITS[b]).toBe("g");
      expect(isThcBucket(b)).toBe(false);
    }
  });
});

describe("qualification \u2014 a serving is not a unit", () => {
  it("a flagged 4 mg can qualifies", () => {
    expect(qualifiesAsLowThcLiquid(can(1))).toBe(true);
    expect(lineBucket(can(1))).toBe("low_thc_liquid");
  });

  it("exactly 4 mg per unit qualifies (the statute says 'no more than four')", () => {
    expect(qualifiesAsLowThcLiquid(can(1, 4))).toBe(true);
  });

  it("4.1 mg per unit does NOT qualify", () => {
    expect(qualifiesAsLowThcLiquid(can(1, 4.1))).toBe(false);
    expect(lineBucket(can(1, 4.1))).toBe("liquid_edible");
  });

  it("a 16 mg bottle labelled '4 servings x 4 mg' does NOT qualify", () => {
    // The whole point of the explicit flag: servings x mg-per-serving would
    // compute 4 mg here and wrongly qualify a single 16 mg container.
    const bottle: LimitCartLine = {
      category: "edible-liquid",
      quantity: 1,
      lowThcLiquid: false,
      unitThcMg: 16,
    };
    expect(qualifiesAsLowThcLiquid(bottle)).toBe(false);
    expect(lineBucket(bottle)).toBe("liquid_edible");
  });

  it("an UNFLAGGED liquid is treated as a normal liquid \u2014 unknown never unlocks", () => {
    const unknown: LimitCartLine = { category: "edible-liquid", quantity: 1 };
    expect(qualifiesAsLowThcLiquid(unknown)).toBe(false);
    expect(lineBucket(unknown)).toBe("liquid_edible");
    const nulled: LimitCartLine = {
      category: "edible-liquid",
      quantity: 1,
      lowThcLiquid: null,
      unitThcMg: null,
    };
    expect(qualifiesAsLowThcLiquid(nulled)).toBe(false);
    expect(lineBucket(nulled)).toBe("liquid_edible");
  });

  it("flagged but with NO mg figure does not qualify (fails safe)", () => {
    const noMg: LimitCartLine = { category: "edible-liquid", quantity: 1, lowThcLiquid: true };
    expect(qualifiesAsLowThcLiquid(noMg)).toBe(false);
    expect(lineBucket(noMg)).toBe("liquid_edible");
  });

  it("an unclassified liquid does NOT qualify even when its mg figure is low", () => {
    // GAP FOUND BY MUTATION TESTING (scripts/slice16/mutation_test.py).
    // Every other "unflagged" case in this file also omits unitThcMg, so they
    // are rejected by the mg guard and would still pass if the FLAG guard were
    // deleted. This is the case that isolates the flag: intake captured the
    // milligrams from the invoice but nobody classified the product yet.
    //
    // Michael's rule, verbatim: "A product with no flag should be treated as a
    // normal liquid." Not "a product with no flag but a low mg number".
    for (const flag of [undefined, null] as const) {
      const line: LimitCartLine = {
        category: "edible-liquid",
        quantity: 1,
        lowThcLiquid: flag,
        unitThcMg: 4,
      };
      expect(qualifiesAsLowThcLiquid(line)).toBe(false);
      expect(lineBucket(line)).toBe("liquid_edible");
      expect(lineThcMg(line)).toBe(0);
    }

    // And it must really land in the 72 oz bucket, not vanish from the cart.
    const v = evaluateCart(
      [{ category: "edible-liquid", quantity: 1, unitThcMg: 4, grams: 355 }],
      "recreational",
    );
    expect(bucketOf(v, "liquid_edible").used).toBe(355);
    expect(bucketOf(v, "low_thc_liquid").used).toBe(0);
  });

  it("only the boolean true unlocks the bucket \u2014 truthy look-alikes do not", () => {
    // GAP FOUND BY MUTATION TESTING. `if (!line.lowThcLiquid)` passes every
    // test in this file, because every test passes a real boolean. But this
    // flag crosses a DB column, a jsonb payload and an HTTP body on its way
    // here, and each of those can hand us the STRING "false" -- which is
    // truthy in JavaScript and would silently unlock the more permissive
    // bucket. The engine must demand `=== true`.
    const lookAlikes: unknown[] = ["false", "true", "no", 1, "1", {}, [], "0"];
    for (const bad of lookAlikes) {
      const line = {
        category: "edible-liquid",
        quantity: 1,
        lowThcLiquid: bad,
        unitThcMg: 4,
      } as unknown as LimitCartLine;
      expect(qualifiesAsLowThcLiquid(line)).toBe(false);
      expect(lineBucket(line)).toBe("liquid_edible");
    }

    // Positive control: the real boolean still works, so the assertion above
    // is not passing for some unrelated reason.
    expect(qualifiesAsLowThcLiquid(can(1, 4))).toBe(true);
  });

  it("garbage mg values fail safe to the normal liquid bucket", () => {
    for (const bad of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
      const line: LimitCartLine = {
        category: "edible-liquid",
        quantity: 1,
        lowThcLiquid: true,
        unitThcMg: bad,
      };
      expect(qualifiesAsLowThcLiquid(line)).toBe(false);
      expect(lineBucket(line)).toBe("liquid_edible");
    }
  });

  it("the flag only applies to LIQUID categories \u2014 the statute says 'in liquid form'", () => {
    const solid: LimitCartLine = {
      category: "edible-solid",
      quantity: 1,
      lowThcLiquid: true,
      unitThcMg: 4,
    };
    expect(qualifiesAsLowThcLiquid(solid)).toBe(false);
    expect(lineBucket(solid)).toBe("solid_edible");

    const flower: LimitCartLine = {
      category: "flower",
      quantity: 1,
      lowThcLiquid: true,
      unitThcMg: 4,
    };
    expect(qualifiesAsLowThcLiquid(flower)).toBe(false);
    expect(lineBucket(flower)).toBe("usable");
  });

  it("tinctures are liquid and CAN qualify when genuinely packaged that way", () => {
    const tincture: LimitCartLine = {
      category: "tincture",
      quantity: 1,
      lowThcLiquid: true,
      unitThcMg: 2,
    };
    expect(qualifiesAsLowThcLiquid(tincture)).toBe(true);
  });
});

describe("counting \u2014 one can is one unit, a 4-pack is four units", () => {
  it("per-unit mg times quantity", () => {
    expect(lineThcMg(can(1))).toBe(4);
    expect(lineThcMg(can(4))).toBe(16); // a 4-pack of 4 mg cans
    expect(lineThcMg(can(50))).toBe(200);
  });

  it("a non-qualifying line contributes zero mg", () => {
    expect(lineThcMg({ category: "edible-liquid", quantity: 10 })).toBe(0);
  });

  it("scanning 4 cans individually equals ringing one line of quantity 4", () => {
    const individually = evaluateCart([can(1), can(1), can(1), can(1)]);
    const asPack = evaluateCart([can(4)]);
    expect(bucketOf(individually, "low_thc_liquid").usedGrams).toBe(
      bucketOf(asPack, "low_thc_liquid").usedGrams,
    );
    expect(bucketOf(asPack, "low_thc_liquid").usedGrams).toBe(16);
  });
});

describe("the 200 mg ceiling \u2014 recreational", () => {
  it("50 cans at 4 mg is exactly 200 mg and is ALLOWED", () => {
    const v = evaluateCart([can(50)]);
    expect(bucketOf(v, "low_thc_liquid").usedGrams).toBe(200);
    expect(v.blocked).toBe(false);
  });

  it("51 cans at 4 mg is 204 mg and BLOCKS", () => {
    const v = evaluateCart([can(51)]);
    expect(bucketOf(v, "low_thc_liquid").usedGrams).toBe(204);
    expect(v.blocked).toBe(true);
  });

  it("100 cans at 2 mg is exactly 200 mg and is ALLOWED", () => {
    const v = evaluateCart([can(100, 2)]);
    expect(bucketOf(v, "low_thc_liquid").usedGrams).toBe(200);
    expect(v.blocked).toBe(false);
  });

  it("101 cans at 2 mg BLOCKS", () => {
    expect(evaluateCart([can(101, 2)]).blocked).toBe(true);
  });
});

describe("the 200 mg ceiling \u2014 MEDICAL does not get more", () => {
  it("50 cans passes for a patient", () => {
    expect(evaluateCart([can(50)], "medical").blocked).toBe(false);
  });

  it("51 cans BLOCKS for a patient too \u2014 the mg cap does not triple", () => {
    const v = evaluateCart([can(51)], "medical");
    expect(v.blocked).toBe(true);
    expect(bucketOf(v, "low_thc_liquid").maxGrams).toBe(200);
  });

  it("a cart that a patient CAN take more of proves the medical profile is otherwise active", () => {
    // 8 g of concentrate blocks rec (7 g) but passes medical (21 g). This
    // confirms the medical profile is genuinely applied in the same call where
    // the mg cap stayed flat \u2014 so the flat mg cap is not an accident of the
    // recreational profile leaking through.
    expect(evaluateCart([{ category: "concentrate", quantity: 8 }]).blocked).toBe(true);
    expect(evaluateCart([{ category: "concentrate", quantity: 8 }], "medical").blocked).toBe(false);
  });
});

describe("(E) and (F) are alternatives, never additive", () => {
  it("a qualifying beverage contributes NOTHING to the 72 oz liquid bucket", () => {
    const v = evaluateCart([can(50)]);
    expect(bucketOf(v, "low_thc_liquid").usedGrams).toBe(200);
    expect(bucketOf(v, "liquid_edible").usedGrams).toBe(0);
  });

  it("an ordinary liquid still counts against the 72 oz bucket and NOT the mg bucket", () => {
    const v = evaluateCart([{ category: "edible-liquid", quantity: 73 }]);
    expect(bucketOf(v, "liquid_edible").exceeded).toBe(true);
    expect(bucketOf(v, "low_thc_liquid").usedGrams).toBe(0);
    expect(v.blocked).toBe(true);
  });

  it("the two buckets are independent: a full mg bucket plus a small normal liquid passes", () => {
    const v = evaluateCart([can(50), { category: "edible-liquid", quantity: 1 }]);
    expect(bucketOf(v, "low_thc_liquid").usedGrams).toBe(200);
    expect(bucketOf(v, "liquid_edible").usedGrams).toBe(28);
    expect(v.blocked).toBe(false);
  });

  it("a cart can trip the normal liquid bucket while the mg bucket stays clean", () => {
    const v = evaluateCart([can(10), { category: "edible-liquid", quantity: 73 }]);
    expect(bucketOf(v, "low_thc_liquid").exceeded).toBe(false);
    expect(bucketOf(v, "liquid_edible").exceeded).toBe(true);
  });
});

describe("the customer-visible reason text uses the right unit", () => {
  it("an over-limit beverage cart says mg, never oz", () => {
    const v = evaluateCart([can(51)]);
    const reason = v.reasons.join(" ");
    expect(reason).toContain("mg THC");
    expect(reason).not.toContain("oz");
    expect(reason).toContain("204");
    expect(reason).toContain("200");
  });

  it("an over-limit ORDINARY liquid cart still says oz", () => {
    const reason = evaluateCart([{ category: "edible-liquid", quantity: 73 }]).reasons.join(" ");
    expect(reason).toContain("oz");
    expect(reason).not.toContain("mg THC");
  });

  it("formatLimitAmount speaks each bucket's own language", () => {
    expect(formatLimitAmount("low_thc_liquid", 200)).toBe("200 mg THC");
    expect(formatLimitAmount("concentrate", 7)).toBe("7 g");
    expect(formatLimitAmount("liquid_edible", 2016)).toBe("72 oz");
    expect(formatLimitAmount("usable", 28)).toBe("1 oz");
  });

  it("the bucket carries unit-explicit display fields", () => {
    const b = bucketOf(evaluateCart([can(25)]), "low_thc_liquid");
    expect(b.unit).toBe("mg_thc");
    expect(b.used).toBe(100);
    expect(b.max).toBe(200);
    expect(b.usedLabel).toBe("100 mg THC");
    expect(b.maxLabel).toBe("200 mg THC");
    expect(b.ratio).toBe(0.5);
  });
});

describe("owner overrides clamp INTO the statute (AN-2 semantics)", () => {
  it("the owner may tighten below 200 mg", () => {
    const p = clampLimitProfile({ ...RECREATIONAL_LIMITS, low_thc_liquid: 100 }, RECREATIONAL_LIMITS);
    expect(p.low_thc_liquid).toBe(100);
  });

  it("the owner may NOT widen above 200 mg", () => {
    const p = clampLimitProfile({ ...RECREATIONAL_LIMITS, low_thc_liquid: 999 }, RECREATIONAL_LIMITS);
    expect(p.low_thc_liquid).toBe(200);
  });

  it("nonsense collapses to the statutory maximum", () => {
    for (const bad of [0, -5, Number.NaN, "abc"]) {
      const p = clampLimitProfile(
        { ...RECREATIONAL_LIMITS, low_thc_liquid: bad },
        RECREATIONAL_LIMITS,
      );
      expect(p.low_thc_liquid).toBe(200);
    }
  });

  it("a tightened limit actually blocks earlier", () => {
    const v = evaluateCart([can(30)], "recreational", { low_thc_liquid: 100 });
    expect(bucketOf(v, "low_thc_liquid").usedGrams).toBe(120);
    expect(v.blocked).toBe(true);
  });
});

describe("regression: nothing else moved", () => {
  it("the four original buckets keep their exact statutory values", () => {
    expect(RECREATIONAL_LIMITS.usable).toBe(28);
    expect(RECREATIONAL_LIMITS.solid_edible).toBe(448);
    expect(RECREATIONAL_LIMITS.concentrate).toBe(7);
    expect(RECREATIONAL_LIMITS.liquid_edible).toBe(2016);
    expect(MEDICAL_LIMITS.usable).toBe(84);
    expect(MEDICAL_LIMITS.solid_edible).toBe(1344);
    expect(MEDICAL_LIMITS.concentrate).toBe(21);
    expect(MEDICAL_LIMITS.liquid_edible).toBe(6048);
  });

  it("an empty cart is clean across all five buckets", () => {
    const v = evaluateCart([]);
    expect(v.blocked).toBe(false);
    expect(v.buckets).toHaveLength(5);
    for (const b of v.buckets) expect(b.usedGrams).toBe(0);
  });

  it("non-cannabis lines are still untracked", () => {
    const v = evaluateCart([{ category: "merch", quantity: 500 }]);
    expect(v.blocked).toBe(false);
    expect(v.untrackedLines).toBe(1);
  });
});
