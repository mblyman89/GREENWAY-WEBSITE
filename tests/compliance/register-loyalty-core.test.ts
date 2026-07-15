/**
 * tests/compliance/register-loyalty-core.test.ts  (Task AM-B)
 *
 * Vitest mirror for the pure register-loyalty helpers (redeeming points at
 * the register): cart fingerprinting for stale-spread detection, applying
 * the server's per-variant spread, and the redeem-button/code-input helpers.
 */
import { describe, expect, it } from "vitest";
import {
  __runRegisterLoyaltyCoreTests,
  applyLoyaltyToPricedLines,
  looksLikeLoyaltyCode,
  maxRedeemablePoints,
  normalizeLoyaltyCodeInput,
  pricingFingerprint,
  type LoyaltyPricedLine,
} from "@/lib/pos/register-loyalty-core";
import { computeOrderTotals } from "@/lib/orders/order-pricing-core";

const mk = (variantId: string, unit: number, qty = 1, category = "flower"): LoyaltyPricedLine => ({
  variantId,
  productId: `prod-${variantId}`,
  category,
  quantity: qty,
  unitPriceMinor: unit,
  regularPriceMinor: unit,
});

describe("pricingFingerprint", () => {
  it("is order-independent but sensitive to quantity and price", () => {
    const a = pricingFingerprint([mk("v1", 1000), mk("v2", 2000, 2)]);
    const b = pricingFingerprint([mk("v2", 2000, 2), mk("v1", 1000)]);
    expect(a).toBe(b);
    expect(pricingFingerprint([mk("v1", 1000), mk("v2", 2000, 3)])).not.toBe(a);
    expect(pricingFingerprint([mk("v1", 999), mk("v2", 2000, 2)])).not.toBe(a);
  });

  it("falls back to productId when variantId is absent", () => {
    expect(pricingFingerprint([{ productId: "p1", quantity: 1, unitPriceMinor: 500 }])).toBe(
      "p1:1:500",
    );
  });
});

describe("applyLoyaltyToPricedLines", () => {
  it("reduces matched lines, stamps per-unit discounts, and recomputes totals with the shared math", () => {
    const applied = applyLoyaltyToPricedLines([mk("v1", 1000, 2), mk("v2", 2000)], {
      v1: 100,
      v2: 300,
    });
    expect(applied.lines[0].unitPriceMinor).toBe(900);
    expect(applied.lines[0].loyaltyDiscountMinor).toBe(100);
    expect(applied.lines[1].unitPriceMinor).toBe(1700);
    expect(applied.appliedMinor).toBe(100 * 2 + 300);
    expect(applied.totals.totalMinorUnits).toBe(
      computeOrderTotals([
        { category: "flower", quantity: 2, unitPriceMinorUnits: 900, regularPriceMinorUnits: 1000 },
        { category: "flower", quantity: 1, unitPriceMinorUnits: 1700, regularPriceMinorUnits: 2000 },
      ]).totalMinorUnits,
    );
  });

  it("leaves unmatched variants untouched", () => {
    const untouched = applyLoyaltyToPricedLines([mk("v1", 1000)], { v9: 100 });
    expect(untouched.lines[0].unitPriceMinor).toBe(1000);
    expect(untouched.appliedMinor).toBe(0);
  });

  it("clamps a corrupted over-large reduction at the 1-cent floor", () => {
    const clamped = applyLoyaltyToPricedLines([mk("v1", 100)], { v1: 500 });
    expect(clamped.lines[0].unitPriceMinor).toBe(1);
    expect(clamped.lines[0].loyaltyDiscountMinor).toBe(99);
  });
});

describe("maxRedeemablePoints", () => {
  it("redeems the full balance only at/above the program minimum", () => {
    expect(maxRedeemablePoints(250, 100)).toBe(250);
    expect(maxRedeemablePoints(99, 100)).toBe(0);
    expect(maxRedeemablePoints(0, 0)).toBe(0);
  });
});

describe("code input helpers", () => {
  it("normalizes and shape-checks GW codes", () => {
    expect(normalizeLoyaltyCodeInput("  gw-7k3m-92qf ")).toBe("GW-7K3M-92QF");
    expect(looksLikeLoyaltyCode("GW-7K3M-92QF")).toBe(true);
    expect(looksLikeLoyaltyCode("GW-7K3M-92QO")).toBe(false); // ambiguous O
    expect(looksLikeLoyaltyCode("FOO-1234")).toBe(false);
  });
});

describe("embedded self-tests", () => {
  it("run clean", () => {
    expect(() => __runRegisterLoyaltyCoreTests()).not.toThrow();
  });
});
