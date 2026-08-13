/**
 * tests/compliance/plaid-investments-core.test.ts
 *
 * Vitest mirror for the Plaid Investments (holdings) pure core: quantity↔micros,
 * dollars→cents mapping, the holding↔security join, the per-row view (gain/loss,
 * display fallback), and the per-account roll-up (total value + value-desc sort).
 */
import { describe, it, expect } from "vitest";
import {
  quantityToMicros,
  formatQuantityMicros,
  QUANTITY_SCALE,
  mapHolding,
  mapHoldings,
  buildHoldingRow,
  buildHoldingsAccountView,
  __runPlaidInvestmentsCoreTests,
  type PlaidHoldingInput,
  type PlaidSecurityInput,
} from "@/lib/plaid/investments-core";

describe("quantityToMicros", () => {
  it("scales decimal shares to integer micro-units", () => {
    expect(quantityToMicros(12.5)).toBe(12_500_000);
    expect(quantityToMicros(0.317)).toBe(317_000);
    expect(quantityToMicros(3)).toBe(3 * QUANTITY_SCALE);
    expect(quantityToMicros("10")).toBe(10_000_000);
    expect(quantityToMicros(-2.25)).toBe(-2_250_000);
  });
  it("returns null for null/empty/NaN", () => {
    expect(quantityToMicros(null)).toBeNull();
    expect(quantityToMicros("")).toBeNull();
    expect(quantityToMicros(Number.NaN)).toBeNull();
  });
});

describe("formatQuantityMicros", () => {
  it("renders a trimmed decimal string", () => {
    expect(formatQuantityMicros(12_500_000)).toBe("12.5");
    expect(formatQuantityMicros(3_000_000)).toBe("3");
    expect(formatQuantityMicros(317_000)).toBe("0.317");
    expect(formatQuantityMicros(-2_250_000)).toBe("-2.25");
    expect(formatQuantityMicros(1_000_001)).toBe("1.000001");
  });
  it("returns an em dash for null", () => {
    expect(formatQuantityMicros(null)).toBe("—");
  });
});

const securities: PlaidSecurityInput[] = [
  { security_id: "sec_aapl", name: "Apple Inc.", ticker_symbol: "AAPL", type: "equity", close_price: 190.12 },
  { security_id: "sec_vti", name: "Vanguard Total Stock Market ETF", ticker_symbol: "VTI", type: "etf", close_price: 245.5 },
];

describe("mapHoldings + security join", () => {
  it("maps keyable holdings and drops holdings missing account/security id", () => {
    const holds: PlaidHoldingInput[] = [
      { account_id: "acc_fid", security_id: "sec_aapl", institution_price: 190.12, institution_value: 1901.2, cost_basis: 1500, quantity: 10 },
      { account_id: null, security_id: "sec_x", quantity: 1 },
      { account_id: "acc_fid", security_id: null, quantity: 1 },
    ];
    const recs = mapHoldings(holds, securities);
    expect(recs).toHaveLength(1);
    expect(recs[0].securityName).toBe("Apple Inc.");
    expect(recs[0].tickerSymbol).toBe("AAPL");
    expect(recs[0].institutionValueCents).toBe(190_120);
    expect(recs[0].costBasisCents).toBe(150_000);
    expect(recs[0].quantityMicros).toBe(10_000_000);
    expect(recs[0].isoCurrencyCode).toBe("USD");
  });

  it("keeps null security fields for an orphan holding", () => {
    const rec = mapHolding({ account_id: "a", security_id: "unknown", quantity: 1 }, new Map());
    expect(rec).not.toBeNull();
    expect(rec?.securityName).toBeNull();
    expect(rec?.tickerSymbol).toBeNull();
  });
});

describe("buildHoldingRow", () => {
  it("computes gain/loss and formats it with a sign", () => {
    const recs = mapHoldings(
      [{ account_id: "a", security_id: "sec_aapl", institution_value: 1901.2, cost_basis: 1500, quantity: 10 }],
      securities,
    );
    const row = buildHoldingRow(recs[0]);
    expect(row.displayName).toBe("Apple Inc.");
    expect(row.gainLossCents).toBe(40_120);
    expect(row.gainLossText).toBe("+$401.20");
    expect(row.quantityText).toBe("10");
  });

  it("renders a loss with a minus sign", () => {
    const recs = mapHoldings(
      [{ account_id: "a", security_id: "sec_vti", institution_value: 2455, cost_basis: 2600, quantity: 10 }],
      securities,
    );
    const row = buildHoldingRow(recs[0]);
    expect(row.gainLossCents).toBe(-14_500);
    expect(row.gainLossText).toBe("-$145.00");
  });

  it("falls back to ticker then id for display and blanks missing money", () => {
    const row = buildHoldingRow({
      accountId: "a", securityId: "sec_z", securityName: null, tickerSymbol: "ZZZ",
      securityType: null, quantityMicros: null, institutionPriceCents: null,
      institutionValueCents: null, costBasisCents: null, isoCurrencyCode: "USD",
    });
    expect(row.displayName).toBe("ZZZ");
    expect(row.gainLossCents).toBeNull();
    expect(row.gainLossText).toBe("—");
    expect(row.valueText).toBe("—");
  });
});

describe("buildHoldingsAccountView", () => {
  it("totals value in cents and sorts positions by value desc", () => {
    const recs = mapHoldings(
      [
        { account_id: "a", security_id: "sec_aapl", institution_value: 1901.2, cost_basis: 1500, quantity: 10 },
        { account_id: "a", security_id: "sec_vti", institution_value: 2455, cost_basis: 2600, quantity: 10 },
      ],
      securities,
    );
    const view = buildHoldingsAccountView(recs);
    expect(view.positionCount).toBe(2);
    expect(view.totalValueCents).toBe(190_120 + 245_500);
    expect(view.totalValueText).toBe("$4,356.20");
    expect(view.rows[0].securityId).toBe("sec_vti"); // larger value first
  });

  it("returns zeros for an empty account", () => {
    const view = buildHoldingsAccountView([]);
    expect(view.positionCount).toBe(0);
    expect(view.totalValueCents).toBe(0);
    expect(view.totalValueText).toBe("$0.00");
  });
});

describe("plaid-investments-core self-tests (harness parity)", () => {
  it("passes the in-module self-test battery", () => {
    expect(() => __runPlaidInvestmentsCoreTests()).not.toThrow();
  });
});
