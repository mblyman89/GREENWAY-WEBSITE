/**
 * tests/compliance/loan-core.test.ts
 *
 * Vitest mirror for the manual-loan pure core: money/rate parsing, calendar
 * month stepping, the amortization engine (verified against Michael's real
 * Sound CU mortgage statement to the penny), the interest-free (Jared) flat
 * schedule, and the plain-English summary view.
 */
import { describe, it, expect } from "vitest";
import {
  formatLoanCents,
  formatRateMilliPct,
  dollarsToCents,
  percentToMilliPct,
  addMonthsIso,
  parseIsoDate,
  computeScheduledPaymentCents,
  buildAmortizationSchedule,
  buildLoanSummaryView,
  __runLoanCoreTests,
  type LoanInput,
} from "@/lib/loans/loan-core";

describe("money + rate parsing", () => {
  it("parses dollars to integer cents", () => {
    expect(dollarsToCents("475588.75")).toBe(47558875);
    expect(dollarsToCents("$475,588.75")).toBe(47558875);
    expect(dollarsToCents(21881.91)).toBe(2188191);
    expect(dollarsToCents("-12.50")).toBe(-1250);
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
  });

  it("parses percent to milli-percent", () => {
    expect(percentToMilliPct("2.375")).toBe(2375);
    expect(percentToMilliPct(2.375)).toBe(2375);
    expect(percentToMilliPct("2.375%")).toBe(2375);
    expect(percentToMilliPct("3.99")).toBe(3990);
    expect(percentToMilliPct("0")).toBe(0);
    expect(percentToMilliPct("")).toBeNull();
  });

  it("formats cents and rates", () => {
    expect(formatLoanCents(47558875)).toBe("$475,588.75");
    expect(formatLoanCents(null)).toBe("—");
    expect(formatRateMilliPct(2375)).toBe("2.375%");
    expect(formatRateMilliPct(3990)).toBe("3.99%");
    expect(formatRateMilliPct(5000)).toBe("5%");
    expect(formatRateMilliPct(0)).toBe("0%");
  });
});

describe("calendar month stepping", () => {
  it("adds months and clamps the day", () => {
    expect(addMonthsIso("2022-06-01", 0)).toBe("2022-06-01");
    expect(addMonthsIso("2022-06-01", 12)).toBe("2023-06-01");
    expect(addMonthsIso("2022-01-31", 1)).toBe("2022-02-28");
    expect(addMonthsIso("2024-01-31", 1)).toBe("2024-02-29");
  });
  it("rejects malformed dates", () => {
    expect(parseIsoDate("2022-13-01")).toBeNull();
    expect(parseIsoDate("nope")).toBeNull();
  });
});

describe("amortization engine (mortgage, verified vs statement)", () => {
  const mortgage: LoanInput = {
    id: "m1",
    name: "Sound CU mortgage",
    kind: "amortizing",
    originalPrincipalCents: 64700000,
    rateMilliPct: 2375,
    termMonths: 180,
    firstPaymentDate: "2022-06-01",
    scheduledPaymentCents: 427616,
  };

  it("computes the servicer P&I payment ($4,276.16)", () => {
    expect(computeScheduledPaymentCents(64700000, 2375, 180)).toBe(427616);
  });

  it("builds a 180-row schedule that pays off to 0 by May 2037", () => {
    const s = buildAmortizationSchedule(mortgage);
    expect(s.rows.length).toBe(180);
    expect(s.rows[0].date).toBe("2022-06-01");
    expect(s.rows[179].date).toBe("2037-05-01");
    expect(s.rows[179].balanceCents).toBe(0);
  });

  it("matches the first month's interest, principal, and balance to the statement", () => {
    const s = buildAmortizationSchedule(mortgage);
    expect(s.rows[0].interestCents).toBe(128052); // $1,280.52
    expect(s.rows[0].principalCents).toBe(427616 - 128052);
    expect(s.rows[0].balanceCents).toBe(64400436); // $644,004.36
  });
});

describe("amortization engine (Jared, interest-free)", () => {
  const jared: LoanInput = {
    id: "j1",
    name: "Jared",
    kind: "interest_free",
    originalPrincipalCents: 2188191,
    rateMilliPct: 0,
    termMonths: 18,
    firstPaymentDate: "2026-07-17",
  };

  it("builds an 18-row zero-interest schedule that pays off to 0", () => {
    const s = buildAmortizationSchedule(jared);
    expect(s.rows.length).toBe(18);
    expect(s.totalInterestCents).toBe(0);
    expect(s.rows[17].balanceCents).toBe(0);
    expect(s.totalPaidCents).toBe(2188191);
    expect(s.rows[0].date).toBe("2026-07-17");
    expect(s.rows[1].date).toBe("2026-08-17");
    expect(s.rows[0].paymentCents).toBe(121566); // ~$1,215.66
  });
});

describe("loan summary view", () => {
  it("renders the mortgage summary with paid-off percent", () => {
    const v = buildLoanSummaryView({
      name: "Sound CU mortgage",
      kind: "amortizing",
      originalPrincipalCents: 64700000,
      currentBalanceCents: 47558875,
      rateMilliPct: 2375,
      termMonths: 180,
      firstPaymentDate: "2022-06-01",
      maturityDate: "2037-05-01",
      scheduledPaymentCents: 427616,
    });
    expect(v.rateText).toBe("2.375%");
    expect(v.balanceText).toBe("$475,588.75");
    expect(v.paymentText).toBe("$4,276.16");
    expect(v.paidOffPercent).toBe(26);
  });

  it("renders the interest-free summary", () => {
    const v = buildLoanSummaryView({
      name: "Jared",
      kind: "interest_free",
      originalPrincipalCents: 2188191,
      currentBalanceCents: 2098091,
      rateMilliPct: 0,
      termMonths: 18,
      firstPaymentDate: "2026-07-17",
      maturityDate: null,
      scheduledPaymentCents: 121566,
    });
    expect(v.rateText).toBe("0% (interest-free)");
    expect(v.maturityText).toBe("—");
  });
});

describe("embedded self-tests", () => {
  it("runs the full loan-core self-test battery", () => {
    expect(() => __runLoanCoreTests()).not.toThrow();
  });
});
