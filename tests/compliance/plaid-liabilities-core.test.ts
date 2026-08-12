/**
 * tests/compliance/plaid-liabilities-core.test.ts
 *
 * Vitest mirror for the Plaid Liabilities (mortgage) pure core: dollars→cents,
 * rate→basis-points, address formatting, mapping, and the plain-English view.
 */
import { describe, it, expect } from "vitest";
import {
  ratePercentToBps,
  formatRateBps,
  formatPropertyAddress,
  mapMortgage,
  mapMortgages,
  buildMortgageView,
  __runPlaidLiabilitiesCoreTests,
} from "@/lib/plaid/liabilities-core";

describe("ratePercentToBps", () => {
  it("converts percentages to integer basis points", () => {
    expect(ratePercentToBps(3.99)).toBe(399);
    expect(ratePercentToBps(6)).toBe(600);
    expect(ratePercentToBps("4.25")).toBe(425);
  });
  it("returns null for null/garbage", () => {
    expect(ratePercentToBps(null)).toBeNull();
    expect(ratePercentToBps("abc")).toBeNull();
  });
});

describe("formatRateBps", () => {
  it("formats basis points back to a percent", () => {
    expect(formatRateBps(399)).toBe("3.99%");
    expect(formatRateBps(600)).toBe("6.00%");
    expect(formatRateBps(null)).toBe("—");
  });
});

describe("formatPropertyAddress", () => {
  it("builds a one-line address, skipping blanks", () => {
    expect(
      formatPropertyAddress({ street: "2992 Cameron Road", city: "Malakoff", region: "NY", postal_code: "14236" }),
    ).toBe("2992 Cameron Road, Malakoff, NY 14236");
    expect(formatPropertyAddress({ city: "Port Orchard", region: "WA" })).toBe("Port Orchard, WA");
    expect(formatPropertyAddress(null)).toBeNull();
  });
});

describe("mapMortgage / mapMortgages", () => {
  it("maps money to integer cents and rate to bps", () => {
    const rec = mapMortgage({
      account_id: "acc_m1",
      escrow_balance: 3141.54,
      interest_rate: { percentage: 3.99, type: "fixed" },
      origination_principal_amount: 425000,
    });
    expect(rec).not.toBeNull();
    expect(rec?.escrowBalanceCents).toBe(314154);
    expect(rec?.interestRateBps).toBe(399);
    expect(rec?.originationPrincipalCents).toBe(42500000);
  });
  it("drops entries with no account_id", () => {
    expect(mapMortgage({ account_id: null })).toBeNull();
    expect(mapMortgages([{ account_id: "a" }, { account_id: null }])).toHaveLength(1);
    expect(mapMortgages(null)).toHaveLength(0);
  });
});

describe("buildMortgageView", () => {
  it("renders plain-English text from integer cents/bps", () => {
    const rec = mapMortgage({
      account_id: "acc_m1",
      escrow_balance: 3141.54,
      interest_rate: { percentage: 3.99, type: "fixed" },
      next_monthly_payment: 3141.54,
      next_payment_due_date: "2019-11-15",
      has_pmi: true,
    });
    const view = buildMortgageView({ ...rec!, principalCents: 5630206 });
    expect(view.balanceText).toBe("$56,302.06");
    expect(view.rateText).toBe("3.99% fixed");
    expect(view.nextPaymentText).toBe("$3,141.54 due 2019-11-15");
    expect(view.pmiText).toBe("Yes");
  });
});

describe("__runPlaidLiabilitiesCoreTests", () => {
  it("passes its embedded self-tests", () => {
    expect(() => __runPlaidLiabilitiesCoreTests()).not.toThrow();
  });
});
