/**
 * tests/compliance/cart-estimator-core.test.ts  (Task T / PR 2)
 *
 * The cart estimator promises REGISTER-FINAL estimates: its math must mirror
 * the register's own pure cores exactly, so every figure it shows can only
 * differ from the register when the register knows something the website
 * cannot. This suite pins:
 *
 *  1. LOYALTY parity — estimateEarnPoints === basePointsForSubtotal
 *     (engine.ts); redemption honours the min-redeem gate exactly like
 *     canRedeem(); value = pointsValueMinor; the cap never lets loyalty zero
 *     a cannabis unit (RCW 69.50.357 — mirrors loyaltyUnitFloor with costs
 *     unknown).
 *  2. MEDICAL parity — per-line savings equal lineBaseMinor +
 *     decideLineExemption + the same bps math the completion gate uses
 *     (buildOrderExemptionPlan in medical-sale-core.ts); the honest range
 *     floors on DOH-verified lines and ceilings on unverified cannabis;
 *     endorsement off / excise sunset respected; high-THC lines are flagged.
 *  3. TIER NUDGES — thresholds and unlock percents match the SAME tier
 *     mechanics the pricing engine applies (weight grams / qty units / spend
 *     on REGULAR prices / basket group completion); either/or rules never
 *     nudge (store-advantaged minimum).
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_ESTIMATOR_LOYALTY,
  estimateEarnPoints,
  estimateLoyaltyRedemption,
  estimateMedicalSavings,
  estimatorLineBaseMinor,
  maxLoyaltyAbsorbMinor,
  tierNudges,
  type EstimatorLine,
  type EstimatorMedicalConfig,
} from "@/lib/checkout/estimator-core";
import {
  basePointsForSubtotal,
  canRedeem,
  pointsValueMinor,
  type LoyaltyConfig,
} from "@/lib/loyalty/engine";
import {
  buildOrderExemptionPlan,
  lineBaseMinor,
  type DohCategory,
  type PlanLine,
} from "@/lib/medical/medical-sale-core";
import {
  activeSnapshotsFor,
  seedRuleSnapshots,
} from "@/lib/promotions/published-rules-core";
import type { EngineCartLine } from "@/lib/promotions/discount-engine-core";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function estLine(overrides: Partial<EstimatorLine> = {}): EstimatorLine {
  return {
    lineId: overrides.lineId ?? "l1",
    productId: overrides.productId ?? "p1",
    productName: overrides.productName ?? "Test Flower 3.5g",
    category: overrides.category ?? "flower",
    quantity: overrides.quantity ?? 1,
    unitPriceMinorUnits: overrides.unitPriceMinorUnits ?? 3500,
    ...overrides,
  };
}

function engineLine(overrides: Partial<EngineCartLine> = {}): EngineCartLine {
  return {
    lineId: overrides.lineId ?? "l1",
    regularPriceMinorUnits: overrides.regularPriceMinorUnits ?? 3500,
    quantity: overrides.quantity ?? 1,
    categories: overrides.categories ?? ["flower"],
    brand: overrides.brand ?? null,
    productKey: overrides.productKey ?? "p1",
    variantLabel: overrides.variantLabel ?? "3.5g",
    costMinorUnits: null,
    ...overrides,
  };
}

const REG_CFG: LoyaltyConfig = {
  pointsPerDollar: 1,
  pointValueMinor: 1,
  minRedeemPoints: 100,
  signupBonusPoints: 0,
  codeExpiryDays: null,
};

const MED_ON: EstimatorMedicalConfig = { endorsed: true, exciseActive: true };

// ---------------------------------------------------------------------------
// 1) Loyalty parity with the register engine
// ---------------------------------------------------------------------------

describe("loyalty earn estimate mirrors the register engine", () => {
  it("matches basePointsForSubtotal across a spread of subtotals", () => {
    for (const subtotal of [0, 1, 99, 100, 2599, 5000, 12345, 99999]) {
      const est = estimateEarnPoints(subtotal, DEFAULT_ESTIMATOR_LOYALTY);
      expect(est.points).toBe(basePointsForSubtotal(subtotal, REG_CFG));
      expect(est.valueMinor).toBe(pointsValueMinor(est.points, REG_CFG));
    }
  });

  it("matches at a non-default earn rate (2 pt/$1, 2¢/pt)", () => {
    const cfg = { pointsPerDollar: 2, pointValueMinor: 2, minRedeemPoints: 100 };
    const regCfg: LoyaltyConfig = { ...REG_CFG, pointsPerDollar: 2, pointValueMinor: 2 };
    const est = estimateEarnPoints(2599, cfg);
    expect(est.points).toBe(basePointsForSubtotal(2599, regCfg)); // floor(25.99*2)=51
    expect(est.points).toBe(51);
    expect(est.valueMinor).toBe(102);
  });

  it("negative and zero subtotals earn nothing (register parity)", () => {
    expect(estimateEarnPoints(0, DEFAULT_ESTIMATOR_LOYALTY).points).toBe(0);
    expect(estimateEarnPoints(-500, DEFAULT_ESTIMATOR_LOYALTY).points).toBe(0);
  });
});

describe("loyalty redemption estimate honours the register gates", () => {
  const lines = [estLine({ unitPriceMinorUnits: 3500, quantity: 2 })]; // $70 cannabis

  it("below the minimum matches canRedeem() refusal, with the exact shortfall", () => {
    const r = estimateLoyaltyRedemption(99, DEFAULT_ESTIMATOR_LOYALTY, lines);
    expect(r.status).toBe("below_min");
    if (r.status === "below_min") expect(r.shortfallPoints).toBe(1);
    expect(canRedeem(99, 99, REG_CFG)).toBe(false);
  });

  it("at the minimum the full value applies (register parity)", () => {
    const r = estimateLoyaltyRedemption(100, DEFAULT_ESTIMATOR_LOYALTY, lines);
    expect(r).toEqual({ status: "ok", valueMinor: 100, cappedByCart: false });
    expect(canRedeem(100, 100, REG_CFG)).toBe(true);
    expect(pointsValueMinor(100, REG_CFG)).toBe(100);
  });

  it("zero / invalid balances estimate nothing", () => {
    expect(estimateLoyaltyRedemption(0, DEFAULT_ESTIMATOR_LOYALTY, lines).status).toBe("none");
    expect(estimateLoyaltyRedemption(-5, DEFAULT_ESTIMATOR_LOYALTY, lines).status).toBe("none");
    expect(estimateLoyaltyRedemption(NaN, DEFAULT_ESTIMATOR_LOYALTY, lines).status).toBe("none");
  });

  it("cannabis can never be free: cap leaves the 1¢ statutory floor per unit", () => {
    // Cart: 2 × $35.00 cannabis. Absorb = 2 × (3500 − 1) = 6998.
    expect(maxLoyaltyAbsorbMinor(lines)).toBe(6998);
    const r = estimateLoyaltyRedemption(1_000_000, DEFAULT_ESTIMATOR_LOYALTY, lines);
    expect(r).toEqual({ status: "ok", valueMinor: 6998, cappedByCart: true });
  });

  it("merch may reach $0 (statutory floor is cannabis-only)", () => {
    const merch = [estLine({ category: "merch", unitPriceMinorUnits: 2000, quantity: 1 })];
    expect(maxLoyaltyAbsorbMinor(merch)).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// 2) Medical parity with the completion gate's plan math
// ---------------------------------------------------------------------------

describe("medical estimate mirrors the completion gate math", () => {
  it("line base backs out the inclusive price exactly like lineBaseMinor", () => {
    const cases: Array<Pick<EstimatorLine, "category" | "quantity" | "unitPriceMinorUnits">> = [
      { category: "flower", quantity: 1, unitPriceMinorUnits: 3500 },
      { category: "flower", quantity: 3, unitPriceMinorUnits: 1234 },
      { category: "edible-solid", quantity: 2, unitPriceMinorUnits: 2599 },
      { category: "merch", quantity: 1, unitPriceMinorUnits: 2000 },
    ];
    for (const c of cases) {
      expect(estimatorLineBaseMinor(c)).toBe(lineBaseMinor(c as PlanLine));
    }
  });

  it("a DOH-verified line saves exactly what buildOrderExemptionPlan claims", () => {
    const registry = new Map<string, DohCategory>([["p1", "general_use"]]);
    const planLines: PlanLine[] = [
      {
        productId: "p1",
        productName: "Verified Gummies",
        category: "edible-solid",
        quantity: 2,
        unitPriceMinorUnits: 2500,
      },
    ];
    const plan = buildOrderExemptionPlan(planLines, {
      registry,
      cardedValid: true,
      endorsed: true,
      saleDate: "2026-07-15",
      exciseExemptionUntil: "2029-06-30",
    });
    const est = estimateMedicalSavings(
      [
        estLine({
          productId: "p1",
          productName: "Verified Gummies",
          category: "edible-solid",
          quantity: 2,
          unitPriceMinorUnits: 2500,
        }),
      ],
      { p1: "general_use" },
      MED_ON,
    );
    expect(est.verifiedMinor).toBe(plan.exciseExemptedMinor + plan.salesTaxExemptedMinor);
    expect(est.verifiedLineCount).toBe(1);
    expect(est.minMinor).toBe(est.verifiedMinor);
    expect(est.maxMinor).toBe(est.verifiedMinor);
  });

  it("unverified cannabis lines only raise the CEILING (honest range)", () => {
    const est = estimateMedicalSavings(
      [
        estLine({ lineId: "a", productId: "verified", quantity: 1, unitPriceMinorUnits: 3500 }),
        estLine({ lineId: "b", productId: "unverified", quantity: 1, unitPriceMinorUnits: 3500 }),
      ],
      { verified: "general_use" },
      MED_ON,
    );
    // base per line = round(3500 / 1.463); savings = 37% excise + 9.3% sales on the base.
    const base = estimatorLineBaseMinor({ category: "flower", quantity: 1, unitPriceMinorUnits: 3500 });
    expect(base).toBe(lineBaseMinor({ category: "flower", quantity: 1, unitPriceMinorUnits: 3500 }));
    const perLine = Math.round((base * 3700) / 10000) + Math.round((base * 930) / 10000);
    expect(est.verifiedMinor).toBe(perLine);
    expect(est.bestCaseAdditionalMinor).toBe(perLine);
    expect(est.minMinor).toBe(perLine);
    expect(est.maxMinor).toBe(perLine * 2);
    expect(est.unverifiedCannabisLineCount).toBe(1);
  });

  it("non-cannabis lines never qualify (sales tax always due on accessories)", () => {
    const est = estimateMedicalSavings(
      [estLine({ category: "merch", productId: "m1", unitPriceMinorUnits: 2000 })],
      {},
      MED_ON,
    );
    expect(est.minMinor).toBe(0);
    expect(est.maxMinor).toBe(0);
  });

  it("endorsement OFF → zero savings even for verified lines (register parity)", () => {
    const est = estimateMedicalSavings(
      [estLine({ productId: "p1" })],
      { p1: "general_use" },
      { endorsed: false, exciseActive: true },
    );
    expect(est.endorsed).toBe(false);
    expect(est.maxMinor).toBe(0);
  });

  it("excise sunset passed → only the 9.3% sales share remains (WAC 314-55-090(6))", () => {
    const est = estimateMedicalSavings(
      [estLine({ productId: "p1", unitPriceMinorUnits: 3500 })],
      { p1: "general_use" },
      { endorsed: true, exciseActive: false },
    );
    const base = estimatorLineBaseMinor({ category: "flower", quantity: 1, unitPriceMinorUnits: 3500 });
    expect(est.verifiedMinor).toBe(Math.round((base * 930) / 10000));
  });

  it("flags registered High-THC products (card required — 246-70 hard gate)", () => {
    const est = estimateMedicalSavings(
      [estLine({ productId: "ht", productName: "50mg Capsules" })],
      { ht: "high_thc" },
      MED_ON,
    );
    expect(est.highThcNames).toEqual(["50mg Capsules"]);
  });
});

// ---------------------------------------------------------------------------
// 3) Tier nudges match the pricing engine's tier mechanics
// ---------------------------------------------------------------------------

const SEEDS = seedRuleSnapshots();
const WHEN = new Date("2026-07-15T12:00:00-07:00");

describe("tier nudges use the same thresholds the engine prices with", () => {
  it("Ounce Friday: 3.5g in cart → add 3.5g to unlock 15%", () => {
    const rules = activeSnapshotsFor(SEEDS, "friday", WHEN);
    const nudges = tierNudges([engineLine({ variantLabel: "3.5g", quantity: 1 })], rules);
    expect(nudges).toHaveLength(1);
    expect(nudges[0].kind).toBe("weight");
    expect(nudges[0].addLabel).toBe("3.5g");
    expect(nudges[0].unlockLabel).toBe("15% off");
    // 15% of the eligible $35.00 regular = 525.
    expect(nudges[0].estAdditionalSavingsMinor).toBe(525);
  });

  it("Ounce Friday: 14g in cart (already 20%) → next unlock is 30% at 28g", () => {
    const rules = activeSnapshotsFor(SEEDS, "friday", WHEN);
    const nudges = tierNudges(
      [engineLine({ variantLabel: "14g", quantity: 1, regularPriceMinorUnits: 12000 })],
      rules,
    );
    expect(nudges).toHaveLength(1);
    expect(nudges[0].addLabel).toBe("14g");
    expect(nudges[0].unlockLabel).toBe("30% off");
    // From 20% (2400) to 30% (3600) on $120 = 1200 more.
    expect(nudges[0].estAdditionalSavingsMinor).toBe(1200);
  });

  it("Ounce Friday: a full ounce is the top tier — no nudge", () => {
    const rules = activeSnapshotsFor(SEEDS, "friday", WHEN);
    expect(tierNudges([engineLine({ variantLabel: "1oz", quantity: 1 })], rules)).toHaveLength(0);
  });

  it("Ounce Friday: unparseable weights cannot tier — no nudge (engine parity)", () => {
    const rules = activeSnapshotsFor(SEEDS, "friday", WHEN);
    expect(
      tierNudges([engineLine({ variantLabel: "each", quantity: 2 })], rules),
    ).toHaveLength(0);
  });

  it("Wax Wednesday: $40 of eligible concentrate → add $10.00 to unlock 15%", () => {
    const rules = activeSnapshotsFor(SEEDS, "wednesday", WHEN);
    const nudges = tierNudges(
      [engineLine({ categories: ["concentrate"], regularPriceMinorUnits: 4000, variantLabel: "1g" })],
      rules,
    );
    expect(nudges).toHaveLength(1);
    expect(nudges[0].kind).toBe("spend");
    expect(nudges[0].addLabel).toBe("$10.00");
    expect(nudges[0].unlockLabel).toBe("15% off");
  });

  it("spend nudges qualify on REGULAR prices (engine parity)", () => {
    const rules = activeSnapshotsFor(SEEDS, "wednesday", WHEN);
    // Regular $50 exactly → already at the 15% tier; next nudge is the $100 tier.
    const nudges = tierNudges(
      [engineLine({ categories: ["cartridge"], regularPriceMinorUnits: 5000, variantLabel: "1g" })],
      rules,
    );
    expect(nudges).toHaveLength(1);
    expect(nudges[0].addLabel).toBe("$50.00");
    expect(nudges[0].unlockLabel).toBe("20% off");
  });

  it("Ice Cream Sunday: 2 items → add 1 more to complete 3-for-2", () => {
    const rules = activeSnapshotsFor(SEEDS, "sunday", WHEN);
    const nudges = tierNudges(
      [
        engineLine({ lineId: "a", regularPriceMinorUnits: 3000 }),
        engineLine({ lineId: "b", regularPriceMinorUnits: 2000 }),
      ],
      rules,
    );
    expect(nudges).toHaveLength(1);
    expect(nudges[0].kind).toBe("basket");
    expect(nudges[0].addLabel).toBe("1 more item");
    expect(nudges[0].unlockLabel).toBe("3 for 2");
    // Conservative estimate: the cheapest current unit ($20.00).
    expect(nudges[0].estAdditionalSavingsMinor).toBe(2000);
  });

  it("Ice Cream Sunday: complete groups → no nudge", () => {
    const rules = activeSnapshotsFor(SEEDS, "sunday", WHEN);
    expect(
      tierNudges([engineLine({ quantity: 3, regularPriceMinorUnits: 3000 })], rules),
    ).toHaveLength(0);
  });

  it("Doobie Tuesday (either/or) NEVER nudges — the engine takes the smaller savings", () => {
    const rules = activeSnapshotsFor(SEEDS, "tuesday", WHEN);
    const nudges = tierNudges(
      [engineLine({ categories: ["preroll"], quantity: 3, regularPriceMinorUnits: 1000 })],
      rules,
    );
    expect(nudges).toHaveLength(0);
  });

  it("no eligible items in the cart → no nudges (no advertising into an empty basket)", () => {
    const rules = activeSnapshotsFor(SEEDS, "friday", WHEN);
    expect(
      tierNudges([engineLine({ categories: ["edible-solid"], variantLabel: null })], rules),
    ).toHaveLength(0);
  });

  it("Munchie Monday (flat 25%) has nothing to unlock — no nudge", () => {
    const rules = activeSnapshotsFor(SEEDS, "monday", WHEN);
    expect(
      tierNudges([engineLine({ categories: ["edible-solid"] })], rules),
    ).toHaveLength(0);
  });

  it("nudges sort best savings first", () => {
    // Friday cart with BOTH a small flower position — one rule, one nudge —
    // sanity check ordering is stable for a single entry, then a synthetic
    // multi-rule day: use wednesday (spend) + a friday-like line has no rule,
    // so instead assert ordering with two nudges from a custom rule set.
    const rules = [
      ...activeSnapshotsFor(SEEDS, "friday", WHEN),
      ...activeSnapshotsFor(SEEDS, "wednesday", WHEN),
    ];
    const nudges = tierNudges(
      [
        engineLine({ lineId: "f", categories: ["flower"], variantLabel: "3.5g", regularPriceMinorUnits: 3500 }),
        engineLine({ lineId: "w", categories: ["concentrate"], variantLabel: "1g", regularPriceMinorUnits: 4000 }),
      ],
      rules,
    );
    expect(nudges.length).toBe(2);
    expect(nudges[0].estAdditionalSavingsMinor).toBeGreaterThanOrEqual(
      nudges[1].estAdditionalSavingsMinor,
    );
  });
});
