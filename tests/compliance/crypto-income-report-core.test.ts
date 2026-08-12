import { describe, it, expect } from "vitest";
import {
  __runCryptoIncomeReportCoreTests,
  buildIncomeReport,
  incomeYear,
  isIncomeTag,
  taxYearOf,
  centsToWholeDollars,
  INCOME_TAGS,
} from "../../src/lib/crypto/crypto-income-report-core";

const Y2024 = Date.UTC(2024, 0, 1);
const Y2024_END = Date.UTC(2024, 11, 31);
const Y2025 = Date.UTC(2025, 5, 1);

describe("crypto-income-report-core embedded self-tests", () => {
  it("passes all pure self-tests", () => {
    expect(() => __runCryptoIncomeReportCoreTests()).not.toThrow();
  });
});

describe("income tag allow-list", () => {
  it("recognizes every income tag and rejects non-income tags", () => {
    for (const t of INCOME_TAGS) expect(isIncomeTag(t)).toBe(true);
    for (const t of ["buy", "sell", "transfer", "trade", "gift_sent", "nope"]) {
      expect(isIncomeTag(t)).toBe(false);
    }
  });
});

describe("tax year is UTC calendar year", () => {
  it("maps timestamps to the correct year", () => {
    expect(taxYearOf(Y2024)).toBe(2024);
    expect(taxYearOf(Y2024_END)).toBe(2024);
    expect(taxYearOf(Y2025)).toBe(2025);
  });
});

describe("whole-dollar rounding parity", () => {
  it("rounds half-up preserving sign (same as 8949 engine)", () => {
    expect(centsToWholeDollars(49)).toBe(0);
    expect(centsToWholeDollars(50)).toBe(1);
    expect(centsToWholeDollars(-150)).toBe(-2);
  });
});

describe("Schedule 1 vs Schedule C split", () => {
  it("routes non-business income to Schedule 1 and business to Schedule C", () => {
    const report = buildIncomeReport({
      events: [
        { id: "ftso", tag: "reward_ftso", assetSymbol: "FLR", fmvCents: 3000, receivedAtMs: Y2024 },
        { id: "mine", tag: "reward_mining", assetSymbol: "BTC", fmvCents: 120000, receivedAtMs: Y2024, isBusiness: true },
        { id: "pay", tag: "income_payment", assetSymbol: "BTC", fmvCents: 80000, receivedAtMs: Y2024, isBusiness: true },
      ],
    });
    const y = incomeYear(report, 2024)!;
    expect(y.schedule1.amountCents).toBe(3000);
    expect(y.scheduleC.amountCents).toBe(200000);
    expect(y.totalIncomeCents).toBe(203000);
  });
});

describe("per-tag breakdown", () => {
  it("aggregates by tag in display order, non-zero only", () => {
    const report = buildIncomeReport({
      events: [
        { id: "a", tag: "airdrop", assetSymbol: "SGB", fmvCents: 500, receivedAtMs: Y2024 },
        { id: "f1", tag: "reward_ftso", assetSymbol: "FLR", fmvCents: 100, receivedAtMs: Y2024 },
        { id: "f2", tag: "reward_ftso", assetSymbol: "FLR", fmvCents: 200, receivedAtMs: Y2024 },
      ],
    });
    const s1 = incomeYear(report, 2024)!.schedule1;
    // reward_ftso appears before airdrop in INCOME_TAGS display order.
    expect(s1.byTag.map((t) => t.tag)).toEqual(["reward_ftso", "airdrop"]);
    expect(s1.byTag[0].amountCents).toBe(300);
    expect(s1.byTag[0].eventCount).toBe(2);
    expect(s1.byTag[1].amountCents).toBe(500);
  });
});

describe("multi-year aggregation", () => {
  it("splits events by year sorted ascending", () => {
    const report = buildIncomeReport({
      events: [
        { id: "y5", tag: "interest", assetSymbol: "USDC", fmvCents: 900, receivedAtMs: Y2025 },
        { id: "y4", tag: "reward_ftso", assetSymbol: "FLR", fmvCents: 400, receivedAtMs: Y2024 },
      ],
    });
    expect(report.years.map((y) => y.taxYear)).toEqual([2024, 2025]);
    expect(report.totalIncomeCents).toBe(1300);
  });
});

describe("guard rails", () => {
  it("rejects a non-income tag rather than miscategorizing it", () => {
    expect(() =>
      buildIncomeReport({ events: [{ id: "x", tag: "sell", assetSymbol: "FLR", fmvCents: 100, receivedAtMs: Y2024 }] }),
    ).toThrow();
  });

  it("rejects a negative FMV", () => {
    expect(() =>
      buildIncomeReport({ events: [{ id: "x", tag: "airdrop", assetSymbol: "FLR", fmvCents: -1, receivedAtMs: Y2024 }] }),
    ).toThrow();
  });

  it("returns an empty report for no events", () => {
    const report = buildIncomeReport({ events: [] });
    expect(report.years).toHaveLength(0);
    expect(report.totalIncomeCents).toBe(0);
  });
});
