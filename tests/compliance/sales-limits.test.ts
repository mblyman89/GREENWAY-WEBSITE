/**
 * tests/compliance/sales-limits.test.ts  (S-14 / GAP M-11)
 *
 * WAC 314-55-095 single-transaction limit buckets. The defaults in
 * sales-limits-core encode the statute exactly; these tests pin them and prove
 * the cart evaluator blocks over-limit carts in every bucket for both
 * recreational (095(1)(d)) and medical (095(2)(d)) customers.
 */
import { describe, it, expect } from "vitest";
import {
  GRAMS_PER_OUNCE,
  RECREATIONAL_LIMITS,
  MEDICAL_LIMITS,
  LIMIT_BUCKETS,
  DEFAULT_UNIT_GRAMS,
  categoryToBucket,
  clampLimitProfile,
  evaluateCart,
  gramsToOunces,
  lineGrams,
  resolveLimits,
} from "@/lib/compliance/sales-limits-core";

describe("statutory limit profiles are exact", () => {
  it("recreational — WAC 314-55-095(1)(d)", () => {
    expect(RECREATIONAL_LIMITS.usable).toBe(28); // 1 oz
    expect(RECREATIONAL_LIMITS.solid_edible).toBe(16 * GRAMS_PER_OUNCE); // 16 oz
    expect(RECREATIONAL_LIMITS.concentrate).toBe(7); // 7 g
    expect(RECREATIONAL_LIMITS.liquid_edible).toBe(72 * GRAMS_PER_OUNCE); // 72 oz
  });
  it("medical — WAC 314-55-095(2)(d) (3× rec)", () => {
    expect(MEDICAL_LIMITS.usable).toBe(84); // 3 oz
    expect(MEDICAL_LIMITS.solid_edible).toBe(48 * GRAMS_PER_OUNCE); // 48 oz
    expect(MEDICAL_LIMITS.concentrate).toBe(21); // 21 g
    expect(MEDICAL_LIMITS.liquid_edible).toBe(216 * GRAMS_PER_OUNCE); // 216 oz
  });
  it("statute treats 1 oz useable as 28 g", () => {
    expect(GRAMS_PER_OUNCE).toBe(28);
    expect(gramsToOunces(28)).toBe(1);
  });
});

describe("category → bucket mapping", () => {
  it("flower family (non-infused only) → usable", () => {
    for (const c of ["flower", "popcorn-bud", "preroll", "blunt", "preroll-pack", "trim"]) {
      expect(categoryToBucket(c)).toBe("usable");
    }
  });
  it("concentrates/cartridges → concentrate", () => {
    for (const c of ["concentrate", "cartridge", "disposable-cartridge", "rso"]) {
      expect(categoryToBucket(c)).toBe("concentrate");
    }
  });
  it("MIX-INFUSED RULE: infused flower/prerolls/blunts → concentrate (7 g), never usable", () => {
    // WAC 314-55-010(8) (cannabis mix infused) + WAC 314-55-095(1)(d)(i)(C):
    // infused products contain concentrate for inhalation, so they count
    // against the 7 g concentrate bucket, not the 28 g flower bucket.
    for (const c of ["infused-flower", "infused-preroll", "infused-blunt", "infused-preroll-pack"]) {
      expect(categoryToBucket(c)).toBe("concentrate");
    }
  });
  it("edibles map to their phase buckets", () => {
    expect(categoryToBucket("edible-solid")).toBe("solid_edible");
    expect(categoryToBucket("edible-liquid")).toBe("liquid_edible");
    expect(categoryToBucket("tincture")).toBe("liquid_edible");
  });
  it("non-cannabis categories are unlimited (null)", () => {
    for (const c of ["merch", "accessories", "paraphernalia", null, undefined]) {
      expect(categoryToBucket(c)).toBe(null);
    }
  });
});

describe("evaluateCart — recreational blocking per bucket", () => {
  it("exactly at the 1 oz usable limit is allowed", () => {
    // 8 × 3.5 g flower = 28 g.
    const v = evaluateCart([{ category: "flower", quantity: 8 }]);
    expect(v.blocked).toBe(false);
    expect(v.buckets.find((b) => b.bucket === "usable")?.usedGrams).toBe(28);
  });
  it("one gram over the usable limit blocks with a reason", () => {
    const v = evaluateCart([
      { category: "flower", quantity: 8 },
      { category: "preroll", quantity: 1 }, // +1 g ⇒ 29 g
    ]);
    expect(v.blocked).toBe(true);
    expect(v.reasons.length).toBeGreaterThan(0);
    expect(v.buckets.find((b) => b.bucket === "usable")?.exceeded).toBe(true);
  });
  it("8 g of concentrate blocks (7 g limit)", () => {
    const v = evaluateCart([{ category: "concentrate", quantity: 8 }]);
    expect(v.blocked).toBe(true);
    expect(v.buckets.find((b) => b.bucket === "concentrate")?.overBy).toBe(1);
  });
  it("17 solid-edible units (1 oz each) block the 16 oz bucket", () => {
    const v = evaluateCart([{ category: "edible-solid", quantity: 17 }]);
    expect(v.blocked).toBe(true);
  });
  it("73 liquid-edible units block the 72 oz bucket", () => {
    const v = evaluateCart([{ category: "edible-liquid", quantity: 73 }]);
    expect(v.blocked).toBe(true);
  });
  it("buckets are independent — a full usable bucket plus tiny concentrate passes", () => {
    const v = evaluateCart([
      { category: "flower", quantity: 8 },
      { category: "concentrate", quantity: 1 },
    ]);
    expect(v.blocked).toBe(false);
  });
});

describe("evaluateCart — MIX-INFUSED RULE (owner bug report: infused was sliding under the 28 g flower wall)", () => {
  it("8 × 1 g infused prerolls trip the 7 g concentrate wall, contribute nothing to flower", () => {
    const v = evaluateCart([{ category: "infused-preroll", quantity: 8 }]);
    expect(v.blocked).toBe(true);
    expect(v.buckets.find((b) => b.bucket === "concentrate")?.exceeded).toBe(true);
    expect(v.buckets.find((b) => b.bucket === "usable")?.usedGrams).toBe(0);
  });
  it("7 × 1 g infused prerolls exactly at the 7 g limit passes", () => {
    expect(evaluateCart([{ category: "infused-preroll", quantity: 7 }]).blocked).toBe(false);
  });
  it("5 × 1.5 g infused blunts (7.5 g) block", () => {
    expect(evaluateCart([{ category: "infused-blunt", quantity: 5 }]).blocked).toBe(true);
  });
  it("infused products share the 7 g bucket with dabs/carts", () => {
    const v = evaluateCart([
      { category: "concentrate", quantity: 5 },
      { category: "infused-preroll", quantity: 3 },
    ]);
    expect(v.blocked).toBe(true); // 5 + 3 = 8 g > 7 g
  });
  it("a full 28 g of flower PLUS 6 g of infused prerolls passes — infused no longer eats the flower allowance", () => {
    const v = evaluateCart([
      { category: "flower", quantity: 8 }, // 28 g usable, at limit
      { category: "infused-preroll", quantity: 6 }, // 6 g concentrate, under 7
    ]);
    expect(v.blocked).toBe(false);
  });
  it("medical cardholders get the 21 g concentrate ceiling for infused too", () => {
    expect(evaluateCart([{ category: "infused-preroll", quantity: 21 }], "medical").blocked).toBe(false);
    expect(evaluateCart([{ category: "infused-preroll", quantity: 22 }], "medical").blocked).toBe(true);
  });
  it("AN-1: label weight rides along — one 2.5 g infused blunt counts 2.5 g of concentrate", () => {
    const v = evaluateCart([{ category: "infused-blunt", quantity: 1, grams: 2.5 }]);
    expect(v.buckets.find((b) => b.bucket === "concentrate")?.usedGrams).toBe(2.5);
    expect(v.blocked).toBe(false);
  });
});

describe("evaluateCart — medical gets 3× headroom", () => {
  it("2 oz flower blocks recreational but passes medical", () => {
    const lines = [{ category: "flower", quantity: 16 }]; // 56 g
    expect(evaluateCart(lines, "recreational").blocked).toBe(true);
    expect(evaluateCart(lines, "medical").blocked).toBe(false);
  });
  it("21 g concentrate passes medical, 22 g blocks", () => {
    expect(evaluateCart([{ category: "concentrate", quantity: 21 }], "medical").blocked).toBe(false);
    expect(evaluateCart([{ category: "concentrate", quantity: 22 }], "medical").blocked).toBe(true);
  });
});

describe("explicit grams and overrides", () => {
  it("explicit line grams override per-unit defaults", () => {
    const line = { category: "flower", quantity: 1, grams: 30 };
    expect(lineGrams(line)).toBe(30);
    expect(evaluateCart([line]).blocked).toBe(true);
  });
  it("owner overrides can only be honored through resolveLimits", () => {
    const limits = resolveLimits("recreational", { usable: 14 });
    expect(limits.usable).toBe(14);
    // Tightened limit blocks a half-ounce+1 cart.
    const v = evaluateCart([{ category: "flower", quantity: 5 }], "recreational", { usable: 14 });
    expect(v.blocked).toBe(true); // 17.5 g > 14 g
  });
  it("AN-2: overrides can tighten but NEVER widen past the statute", () => {
    // A widened override (999 g usable) clamps back to the statutory 28 g.
    expect(resolveLimits("recreational", { usable: 999 }).usable).toBe(28);
    expect(resolveLimits("medical", { concentrate: 500 }).concentrate).toBe(21);
    // The engine itself refuses the widened cart: 10 × 3.5 g = 35 g > 28 g
    // blocks even when the override claims a 999 g allowance.
    const v = evaluateCart([{ category: "flower", quantity: 10 }], "recreational", { usable: 999 });
    expect(v.blocked).toBe(true);
  });
  it("AN-2: clampLimitProfile collapses garbage to the statutory base", () => {
    const clamped = clampLimitProfile(
      { usable: 0, solid_edible: -5, concentrate: NaN, liquid_edible: "junk" },
      RECREATIONAL_LIMITS,
    );
    expect(clamped).toEqual(RECREATIONAL_LIMITS);
    expect(clampLimitProfile(null, MEDICAL_LIMITS)).toEqual(MEDICAL_LIMITS);
    // Numeric strings are accepted (pg numeric can arrive as text).
    expect(clampLimitProfile({ usable: "14" }, RECREATIONAL_LIMITS).usable).toBe(14);
  });
  it("per-category unit-gram overrides are applied", () => {
    const v = evaluateCart(
      [{ category: "preroll", quantity: 28 }],
      "recreational",
      { unitGrams: { preroll: 0.5 } },
    );
    expect(v.buckets.find((b) => b.bucket === "usable")?.usedGrams).toBe(14);
    expect(v.blocked).toBe(false);
  });
});

describe("non-cannabis lines are counted as untracked, never blocked", () => {
  it("a merch-only cart passes with untrackedLines set", () => {
    const v = evaluateCart([{ category: "merch", quantity: 500 }]);
    expect(v.blocked).toBe(false);
    expect(v.untrackedLines).toBe(1);
  });
});

describe("defaults sanity", () => {
  it("every bucket has a label and every DEFAULT_UNIT_GRAMS category maps to a bucket", () => {
    expect(LIMIT_BUCKETS.length).toBe(4);
    for (const slug of Object.keys(DEFAULT_UNIT_GRAMS)) {
      expect(categoryToBucket(slug)).not.toBe(null);
    }
  });
});
