/**
 * tests/compliance/public-surfaces-core.test.ts
 *
 * Task T / PR 3 — public loyalty + medical surfaces.
 *
 * Guards two promises:
 *   1. The /loyalty program-terms section renders EXACTLY the live config the
 *      register pays with (loyalty-store.getConfig / engine.ts math) — the
 *      back office is the single source of truth.
 *   2. The /medical purchase-limit table derives from the SAME constants the
 *      register enforces (MEDICAL_PURCHASE_LIMITS / RECREATIONAL_PURCHASE_LIMITS,
 *      WAC 314-55-095) — the public page can never overstate limits.
 */
import { describe, expect, it } from "vitest";
import type { LoyaltyConfig, LoyaltyTier } from "@/lib/loyalty/engine";
import { pointsValueMinor } from "@/lib/loyalty/engine";
import { loyaltyTermsSummary, tierDisplayRows } from "@/lib/loyalty/program-terms-core";
import { purchaseLimitRows } from "@/lib/medical/purchase-limit-display-core";
import { MEDICAL_PURCHASE_LIMITS, RECREATIONAL_PURCHASE_LIMITS } from "@/lib/medical/tax";
import {
  RECREATIONAL_LIMITS,
  MEDICAL_LIMITS,
  LOW_THC_UNIT_MAX_MG,
} from "@/lib/compliance/sales-limits-core";

const DEFAULT_CONFIG: LoyaltyConfig = {
  pointsPerDollar: 1,
  pointValueMinor: 1,
  minRedeemPoints: 100,
  signupBonusPoints: 0,
  codeExpiryDays: null,
};

describe("loyaltyTermsSummary — live-config program terms", () => {
  it("renders the store defaults exactly (1pt/$1, 1¢/pt, redeem from 100)", () => {
    const t = loyaltyTermsSummary(DEFAULT_CONFIG);
    expect(t.earnLine).toBe("Earn 1 point for every $1 you spend (pre-tax).");
    expect(t.valueLine).toBe("100 points = $1.00 off at the register.");
    expect(t.redeemLine).toBe("Redeem once you reach 100 points ($1.00).");
    expect(t.signupBonusLine).toBeNull();
    expect(t.expiryLine).toBeNull();
  });

  it("pluralizes the earn rate when the admin raises points per dollar", () => {
    const t = loyaltyTermsSummary({ ...DEFAULT_CONFIG, pointsPerDollar: 2 });
    expect(t.earnLine).toBe("Earn 2 points for every $1 you spend (pre-tax).");
  });

  it("value line tracks pointValueMinor (5¢/pt → 100 pts = $5.00)", () => {
    const t = loyaltyTermsSummary({ ...DEFAULT_CONFIG, pointValueMinor: 5 });
    expect(t.valueLine).toBe("100 points = $5.00 off at the register.");
  });

  it("redeem line dollar figure MATCHES the register's pointsValueMinor math", () => {
    const cfg: LoyaltyConfig = { ...DEFAULT_CONFIG, pointValueMinor: 2, minRedeemPoints: 250 };
    const registerValueMinor = pointsValueMinor(cfg.minRedeemPoints, cfg);
    expect(registerValueMinor).toBe(500);
    const t = loyaltyTermsSummary(cfg);
    expect(t.redeemLine).toBe("Redeem once you reach 250 points ($5.00).");
  });

  it("formats thousands with separators in the redeem threshold", () => {
    const t = loyaltyTermsSummary({ ...DEFAULT_CONFIG, minRedeemPoints: 1000 });
    expect(t.redeemLine).toBe("Redeem once you reach 1,000 points ($10.00).");
  });

  it("shows the signup bonus only when configured", () => {
    const t = loyaltyTermsSummary({ ...DEFAULT_CONFIG, signupBonusPoints: 200 });
    expect(t.signupBonusLine).toBe("New members start with 200 bonus points.");
  });

  it("shows code expiry with singular/plural days", () => {
    expect(loyaltyTermsSummary({ ...DEFAULT_CONFIG, codeExpiryDays: 30 }).expiryLine).toBe(
      "Redemption codes stay valid for 30 days.",
    );
    expect(loyaltyTermsSummary({ ...DEFAULT_CONFIG, codeExpiryDays: 1 }).expiryLine).toBe(
      "Redemption codes stay valid for 1 day.",
    );
    expect(loyaltyTermsSummary({ ...DEFAULT_CONFIG, codeExpiryDays: 0 }).expiryLine).toBeNull();
  });
});

describe("tierDisplayRows — live tier ladder", () => {
  const tiers: LoyaltyTier[] = [
    { id: "t1", name: "Green", minPoints: 0, discountBps: 0 },
    { id: "t2", name: "Gold", minPoints: 5000, discountBps: 500 },
    { id: "t3", name: "Emerald", minPoints: 15000, discountBps: 1000 },
  ];

  it("renders one row per active tier, thresholds and perks from the DB values", () => {
    const rows = tierDisplayRows(tiers);
    expect(rows).toEqual([
      { name: "Green", thresholdLabel: "0+ pts", perkLabel: "" },
      { name: "Gold", thresholdLabel: "5,000+ pts", perkLabel: "5% off" },
      { name: "Emerald", thresholdLabel: "15,000+ pts", perkLabel: "10% off" },
    ]);
  });

  it("handles fractional bps discounts (250 bps → 2.5% off)", () => {
    const rows = tierDisplayRows([{ id: "x", name: "Silver", minPoints: 100, discountBps: 250 }]);
    expect(rows[0]!.perkLabel).toBe("2.5% off");
  });

  it("empty ladder → no rows (section hidden on the page)", () => {
    expect(tierDisplayRows([])).toEqual([]);
  });
});

describe("purchaseLimitRows — table derives from register constants (WAC 314-55-095)", () => {
  it("renders the five statutory product forms with correct ounce/gram/mg figures", () => {
    const rows = purchaseLimitRows();
    expect(rows).toEqual([
      { category: "Usable cannabis (flower)", recreational: "1 oz", medical: "3 oz" },
      { category: "Solid edibles", recreational: "16 oz", medical: "48 oz" },
      { category: "Cannabis-infused liquid", recreational: "72 oz", medical: "216 oz" },
      { category: "Concentrates", recreational: "7 g", medical: "21 g" },
      // SLICE 16. Note the unit suffix is "mg THC", not "oz" and not "g" — a
      // weight suffix here would be a factual misstatement to the public.
      {
        category: "Low-THC beverages (units of 4 mg THC or less)",
        recreational: "200 mg THC",
        medical: "200 mg THC",
      },
    ]);
  });

  it("figures are DERIVED from the enforcement constants, not hardcoded copies", () => {
    // If the register constants ever change, the public table must follow.
    expect(MEDICAL_PURCHASE_LIMITS.usableGrams).toBeCloseTo(3 * 28.35);
    expect(RECREATIONAL_PURCHASE_LIMITS.usableGrams).toBeCloseTo(28.35);
    expect(MEDICAL_PURCHASE_LIMITS.concentrateGrams).toBe(21);
    expect(RECREATIONAL_PURCHASE_LIMITS.concentrateGrams).toBe(7);
    // Every medical GRAM row is exactly 3× the recreational row. (Renamed from
    // "every medical row" in SLICE 16: that claim is no longer universally
    // true, and the exception is pinned by the very next test.)
    expect(MEDICAL_PURCHASE_LIMITS.usableGrams / RECREATIONAL_PURCHASE_LIMITS.usableGrams).toBeCloseTo(3);
    expect(MEDICAL_PURCHASE_LIMITS.solidGrams / RECREATIONAL_PURCHASE_LIMITS.solidGrams).toBeCloseTo(3);
    expect(MEDICAL_PURCHASE_LIMITS.liquidGrams / RECREATIONAL_PURCHASE_LIMITS.liquidGrams).toBeCloseTo(3);
    expect(MEDICAL_PURCHASE_LIMITS.concentrateGrams / RECREATIONAL_PURCHASE_LIMITS.concentrateGrams).toBeCloseTo(3);
  });

  it("the low-THC beverage row is the ONE row that does NOT triple for a patient", () => {
    // WAC 314-55-095(2)(d) reads "…and up to 200 mg…" — the SAME figure as
    // (1)(d)(i)(F). The 3× pattern above is seductive and wrong here; publishing
    // 600 mg on the public /medical page would advertise an over-sale to every
    // patient who reads it. Ratio is 1, not 3.
    expect(MEDICAL_LIMITS.low_thc_liquid / RECREATIONAL_LIMITS.low_thc_liquid).toBe(1);

    const row = purchaseLimitRows().find((r) => r.category.startsWith("Low-THC beverages"));
    expect(row).toBeDefined();
    expect(row!.recreational).toBe(row!.medical);
    expect(row!.medical).not.toContain("600");
  });

  it("the public table quotes the REGISTER's constants, so it cannot advertise a limit we do not enforce", () => {
    const row = purchaseLimitRows().find((r) => r.category.startsWith("Low-THC beverages"))!;
    // Derived, not retyped: change the enforcement constant and this follows.
    expect(row.recreational).toBe(`${RECREATIONAL_LIMITS.low_thc_liquid} mg THC`);
    expect(row.medical).toBe(`${MEDICAL_LIMITS.low_thc_liquid} mg THC`);
    expect(row.category).toContain(`${LOW_THC_UNIT_MAX_MG} mg`);
  });

  it("no row states a THC-milligram cap in ounces or grams (the 7.143 oz trap)", () => {
    // 200 mg of THC is not 200 mg of product and is certainly not 7.143 oz.
    // Any row whose figure is milligrams must SAY milligrams.
    for (const r of purchaseLimitRows()) {
      for (const v of [r.recreational, r.medical]) {
        if (v.includes("mg")) expect(v).toContain("mg THC");
        if (v.includes("mg")) expect(v).not.toMatch(/\boz\b/);
      }
    }
  });
});
