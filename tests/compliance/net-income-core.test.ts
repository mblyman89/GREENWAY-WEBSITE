/**
 * tests/compliance/net-income-core.test.ts
 *
 * Vitest mirror of the PURE net-income roll-up (P6c). Confirms the operating
 * statement math (revenue − COGS = gross profit; + ATM − payroll = operating
 * result), margins, the profit/loss/empty headline, the honesty "not included"
 * list, and that messy inputs are cleaned without throwing. All money is cents.
 */
import { describe, expect, it } from "vitest";
import {
  buildNetIncome,
  netIncomeHeadline,
  safeRatio,
  formatRatioPct,
  NET_INCOME_NOT_INCLUDED,
  __runNetIncomeCoreTests,
} from "@/lib/reports/net-income-core";

describe("net-income-core harness parity", () => {
  it("runs the embedded self-tests without throwing", () => {
    expect(() => __runNetIncomeCoreTests()).not.toThrow();
  });
});

describe("pure helpers", () => {
  it("computes safe ratios (no divide-by-zero)", () => {
    expect(safeRatio(50, 100)).toBe(0.5);
    expect(safeRatio(1, 0)).toBe(0);
  });
  it("formats ratios as percent", () => {
    expect(formatRatioPct(0.512)).toBe("51.2%");
    expect(formatRatioPct(0)).toBe("0.0%");
  });
});

describe("operating roll-up math", () => {
  it("computes gross profit and operating result", () => {
    const r = buildNetIncome({
      revenueCents: 1_000_000,
      cogsCents: 400_000,
      atmSurchargeCents: 50_000,
      payrollNetCents: 300_000,
      payrollRunCount: 2,
    });
    expect(r.grossProfitCents).toBe(600_000);
    expect(r.operatingResultCents).toBe(350_000);
    expect(r.grossMarginRatio).toBe(0.6);
    expect(r.isProfitable).toBe(true);
    expect(r.notIncluded).toEqual(NET_INCOME_NOT_INCLUDED);
  });

  it("signed component lines sum to the operating result", () => {
    const r = buildNetIncome({
      revenueCents: 800_000,
      cogsCents: 250_000,
      atmSurchargeCents: 40_000,
      payrollNetCents: 200_000,
      payrollRunCount: 1,
    });
    const byKey = Object.fromEntries(r.lines.map((l) => [l.key, l.amountCents]));
    const componentSum = byKey.revenue + byKey.cogs + byKey.atm_surcharge + byKey.payroll;
    expect(componentSum).toBe(r.operatingResultCents);
    expect(byKey.cogs).toBeLessThan(0);
    expect(byKey.payroll).toBeLessThan(0);
    expect(byKey.revenue).toBeGreaterThan(0);
  });

  it("flags a loss", () => {
    const r = buildNetIncome({
      revenueCents: 100_000,
      cogsCents: 60_000,
      atmSurchargeCents: 5_000,
      payrollNetCents: 90_000,
      payrollRunCount: 1,
    });
    expect(r.operatingResultCents).toBe(-45_000);
    expect(r.isProfitable).toBe(false);
  });

  it("cleans messy inputs without throwing", () => {
    const r = buildNetIncome({
      revenueCents: Number.NaN,
      cogsCents: 100.6,
      atmSurchargeCents: Number.POSITIVE_INFINITY,
      payrollNetCents: 50.4,
      payrollRunCount: -3,
    });
    expect(r.lines[0].amountCents).toBe(0);
    expect(r.lines[1].amountCents).toBe(-101);
    expect(Number.isFinite(r.operatingResultCents)).toBe(true);
  });
});

describe("headline", () => {
  it("is neutral with no revenue", () => {
    const r = buildNetIncome({ revenueCents: 0, cogsCents: 0, atmSurchargeCents: 0, payrollNetCents: 0, payrollRunCount: 0 });
    expect(netIncomeHeadline(r, 0).tone).toBe("neutral");
  });
  it("is green when profitable", () => {
    const r = buildNetIncome({ revenueCents: 100_00, cogsCents: 10_00, atmSurchargeCents: 0, payrollNetCents: 0, payrollRunCount: 0 });
    const h = netIncomeHeadline(r, 100_00);
    expect(h.tone).toBe("green");
    expect(h.title).toBe("In the black ✓");
  });
  it("is orange at a loss", () => {
    const r = buildNetIncome({ revenueCents: 100_00, cogsCents: 200_00, atmSurchargeCents: 0, payrollNetCents: 0, payrollRunCount: 0 });
    expect(netIncomeHeadline(r, 100_00).tone).toBe("orange");
  });
});
