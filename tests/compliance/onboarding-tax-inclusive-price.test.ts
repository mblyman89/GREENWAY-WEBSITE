/**
 * tests/compliance/onboarding-tax-inclusive-price.test.ts
 *
 * T-319 — the onboarding auto price is TAX-INCLUSIVE and rounds UP to the next
 * whole dollar, so the owner's 2× markup survives the tax-inclusive shelf price.
 *
 * Rule under test (owner Michael):
 *   base         = cost × min_markup_multiple           (2×)
 *   taxInclusive = base × divisor(category)             (cannabis 1.463 / merch 1.093)
 *   autoPrice    = round UP to the next whole dollar
 *
 * `server-only` is aliased to a no-op stub by the vitest config, so importing
 * the server-only pricing module resolves cleanly for these pure-function tests.
 */
import { describe, it, expect } from "vitest";
import {
  priceFloorMinor,
  suggestPrice,
  validatePrice,
  roundUpToNextDollarMinor,
  taxInclusiveDivisorFor,
  DEFAULT_PRICING,
  type PricingSettings,
} from "@/lib/inventory/pricing";
import {
  TAX_INCLUSIVE_DIVISOR,
  NON_CANNABIS_TAX_INCLUSIVE_DIVISOR,
} from "@/lib/orders/order-pricing-core";

const S: PricingSettings = { ...DEFAULT_PRICING, min_markup_multiple: 2 };

describe("T-319 tax-inclusive onboarding auto price", () => {
  it("Michael's example: $5.00 cost → $15.00 out the door (cannabis)", () => {
    // 500¢ × 2 = 1000¢ base → × 1.463 = 1463¢ → round up to next dollar = 1500¢.
    expect(priceFloorMinor(500, S, "flower")).toBe(1500);
  });

  it("uses the SAME statutory divisor the menu/cart use", () => {
    expect(TAX_INCLUSIVE_DIVISOR).toBeCloseTo(1.463, 6);
    expect(NON_CANNABIS_TAX_INCLUSIVE_DIVISOR).toBeCloseTo(1.093, 6);
    expect(taxInclusiveDivisorFor("flower")).toBe(TAX_INCLUSIVE_DIVISOR);
    expect(taxInclusiveDivisorFor("vape")).toBe(TAX_INCLUSIVE_DIVISOR);
    expect(taxInclusiveDivisorFor("accessories")).toBe(NON_CANNABIS_TAX_INCLUSIVE_DIVISOR);
    expect(taxInclusiveDivisorFor("merch")).toBe(NON_CANNABIS_TAX_INCLUSIVE_DIVISOR);
  });

  it("merch (sales-tax-only) uses the 1.093 divisor", () => {
    // $10 merch cost: 1000¢ × 2 = 2000¢ → × 1.093 = 2186¢ → up to next dollar = 2200¢.
    expect(priceFloorMinor(1000, S, "merch")).toBe(2200);
  });

  it("defaults to the cannabis divisor when category is unknown/omitted", () => {
    expect(priceFloorMinor(500, S)).toBe(1500);
    expect(priceFloorMinor(500, S, null)).toBe(1500);
    expect(priceFloorMinor(500, S, "")).toBe(1500);
  });

  it("always lands on a whole dollar", () => {
    for (const cost of [199, 333, 500, 777, 1234, 4599]) {
      const floor = priceFloorMinor(cost, S, "flower")!;
      expect(floor % 100).toBe(0);
    }
  });

  it("an already-whole tax-inclusive amount is not bumped an extra dollar", () => {
    expect(roundUpToNextDollarMinor(1500)).toBe(1500);
    expect(roundUpToNextDollarMinor(1501)).toBe(1600);
    expect(roundUpToNextDollarMinor(1400)).toBe(1400);
  });

  it("respects a different markup multiple", () => {
    // 3× of $5: 500 × 3 = 1500¢ → × 1.463 = 2194.5¢ → up = 2200¢.
    expect(priceFloorMinor(500, { ...S, min_markup_multiple: 3 }, "flower")).toBe(2200);
  });

  it("returns null when cost is unknown (can't floor without cost)", () => {
    expect(priceFloorMinor(null, S, "flower")).toBeNull();
    expect(priceFloorMinor(0, S, "flower")).toBeNull();
    expect(priceFloorMinor(undefined, S, "flower")).toBeNull();
  });

  it("suggestPrice with no velocity starts at the tax-inclusive floor", () => {
    const s = suggestPrice(500, null, S, "flower");
    expect(s.floorMinor).toBe(1500);
    expect(s.suggestedMinor).toBe(1500);
    expect(s.rationale.toLowerCase()).toContain("tax-inclusive");
  });

  it("suggestPrice never drops below the floor and stays whole-dollar", () => {
    const s = suggestPrice(500, { unitsSold: 300, daysAvailable: 60, onHand: 0 }, S, "flower");
    expect(s.suggestedMinor!).toBeGreaterThanOrEqual(s.floorMinor!);
    expect(s.suggestedMinor! % 100).toBe(0);
  });

  it("validatePrice enforces the tax-inclusive floor but still allows an override at/above it", () => {
    // Below the $15 floor is refused; at/above is fine (override still works).
    const below = validatePrice(1400, 500, S, "flower");
    expect(below.ok).toBe(false);
    if (!below.ok) {
      expect(below.floorMinor).toBe(1500);
      expect(below.error.toLowerCase()).toContain("tax-inclusive");
    }
    expect(validatePrice(1500, 500, S, "flower").ok).toBe(true);
    expect(validatePrice(2000, 500, S, "flower").ok).toBe(true); // owner override upward
    expect(validatePrice(1, 500, S, "flower").ok).toBe(false);
    // Unknown cost = can't enforce a floor -> allowed.
    expect(validatePrice(100, null, S, "flower").ok).toBe(true);
  });
});
