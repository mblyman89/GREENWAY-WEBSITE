/**
 * tests/compliance/price-floor.test.ts  (S-14 / GAP M-11)
 *
 * RCW 69.50.357 / WAC 314-55-523 — no free (or below-floor) cannabis. Pins the
 * ONE shared floor check (order-pricing-core, S-3) and the authoritative
 * order-totals math that both the cart and the server reprice run.
 */
import { describe, it, expect } from "vitest";
import {
  MIN_CANNABIS_UNIT_PRICE_MINOR,
  CANNABIS_EXCISE_TAX_RATE,
  LOCAL_SALES_TAX_RATE,
  TAX_INCLUSIVE_DIVISOR,
  NON_CANNABIS_TAX_INCLUSIVE_DIVISOR,
  assertCannabisLineSellable,
  clampCannabisUnitPrice,
  computeOrderTotals,
  isNonCannabisCategory,
  moneyMatches,
} from "@/lib/orders/order-pricing-core";

describe("constants pin the statutory rates", () => {
  it("37% excise + 9.3% sales ⇒ 1.463 inclusive divisor", () => {
    expect(CANNABIS_EXCISE_TAX_RATE).toBe(0.37);
    expect(LOCAL_SALES_TAX_RATE).toBe(0.093);
    expect(TAX_INCLUSIVE_DIVISOR).toBeCloseTo(1.463, 10);
    expect(NON_CANNABIS_TAX_INCLUSIVE_DIVISOR).toBeCloseTo(1.093, 10);
  });
});

describe("assertCannabisLineSellable — the S-3 floor", () => {
  it("a $0 cannabis line is refused with an RCW citation", () => {
    const check = assertCannabisLineSellable({ category: "flower", unitPriceMinorUnits: 0 });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/69\.50\.357/);
  });
  it("a negative or NaN price is refused", () => {
    expect(assertCannabisLineSellable({ category: "flower", unitPriceMinorUnits: -100 }).ok).toBe(false);
    expect(assertCannabisLineSellable({ category: "flower", unitPriceMinorUnits: NaN }).ok).toBe(false);
  });
  it("the floor itself passes (1 minor unit by default)", () => {
    expect(MIN_CANNABIS_UNIT_PRICE_MINOR).toBe(1);
    expect(
      assertCannabisLineSellable({ category: "flower", unitPriceMinorUnits: 1 }).ok,
    ).toBe(true);
  });
  it("non-cannabis (merch) may be $0 — giveaways of merch are legal", () => {
    expect(assertCannabisLineSellable({ category: "merch", unitPriceMinorUnits: 0 }).ok).toBe(true);
  });
  it("a custom floor is honored", () => {
    expect(
      assertCannabisLineSellable({ category: "flower", unitPriceMinorUnits: 99 }, 100).ok,
    ).toBe(false);
  });
});

describe("clampCannabisUnitPrice — discount engines can never emit $0 cannabis", () => {
  it("a 100%-discounted cannabis unit clamps to the floor", () => {
    expect(clampCannabisUnitPrice("flower", 0, 3500)).toBe(MIN_CANNABIS_UNIT_PRICE_MINOR);
  });
  it("normal discounted prices pass through", () => {
    expect(clampCannabisUnitPrice("flower", 2450, 3500)).toBe(2450);
  });
  it("merch may clamp to zero", () => {
    expect(clampCannabisUnitPrice("merch", 0, 2000)).toBe(0);
  });
  it("a cannabis item whose REGULAR price is already 0 is left for the sellable check to refuse", () => {
    expect(clampCannabisUnitPrice("flower", 0, 0)).toBe(0);
    expect(assertCannabisLineSellable({ category: "flower", unitPriceMinorUnits: 0 }).ok).toBe(false);
  });
});

describe("isNonCannabisCategory", () => {
  it("merch/accessories/paraphernalia are non-cannabis; flower is cannabis", () => {
    expect(isNonCannabisCategory("merch")).toBe(true);
    expect(isNonCannabisCategory("accessories")).toBe(true);
    expect(isNonCannabisCategory("paraphernalia")).toBe(true);
    expect(isNonCannabisCategory("flower")).toBe(false);
    expect(isNonCannabisCategory(null)).toBe(false); // unknown ⇒ treated as cannabis (safe)
  });
});

describe("computeOrderTotals — authoritative money math (minor units)", () => {
  it("cannabis line: subtotal backed out with the 1.463 divisor", () => {
    const totals = computeOrderTotals([
      { category: "flower", quantity: 2, unitPriceMinorUnits: 3500, regularPriceMinorUnits: 3500 },
    ]);
    expect(totals.totalMinorUnits).toBe(7000);
    expect(totals.subtotalMinorUnits).toBe(Math.round(7000 / 1.463)); // 4785
    expect(totals.estimatedTaxMinorUnits).toBe(7000 - totals.subtotalMinorUnits);
    expect(totals.savingsMinorUnits).toBe(0);
  });
  it("mixed cart uses the category-correct divisor per line", () => {
    const totals = computeOrderTotals([
      { category: "flower", quantity: 1, unitPriceMinorUnits: 3500, regularPriceMinorUnits: 3500 },
      { category: "merch", quantity: 1, unitPriceMinorUnits: 2000, regularPriceMinorUnits: 2000 },
    ]);
    const expectedSubtotal = Math.round(3500 / 1.463 + 2000 / 1.093);
    expect(totals.subtotalMinorUnits).toBe(expectedSubtotal);
    expect(totals.totalMinorUnits).toBe(5500);
  });
  it("savings = regular − discounted, floored at 0", () => {
    const totals = computeOrderTotals([
      { category: "flower", quantity: 2, unitPriceMinorUnits: 2450, regularPriceMinorUnits: 3500 },
    ]);
    expect(totals.savingsMinorUnits).toBe(2100);
  });
  it("negative or fractional quantities are neutralized", () => {
    const totals = computeOrderTotals([
      { category: "flower", quantity: -3, unitPriceMinorUnits: 3500, regularPriceMinorUnits: 3500 },
    ]);
    expect(totals.totalMinorUnits).toBe(0);
  });
});

describe("moneyMatches — the S-2 client-total cross-check", () => {
  it("accepts drift within 2 minor units, rejects beyond", () => {
    expect(moneyMatches(1000, 1002)).toBe(true);
    expect(moneyMatches(1000, 1003)).toBe(false);
  });
});
