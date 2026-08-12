import { describe, it, expect } from "vitest";
import {
  __runCryptoTaxCenterCoreTests,
  buildTaxCenterView,
  buildAuditBinderHtml,
  formatWholeDollars,
  esc,
  type TaxCenterYearInput,
  type BinderYear,
} from "../../src/lib/crypto/crypto-tax-center-core";
import type { Form8949Report } from "../../src/lib/crypto/crypto-form8949-core";
import type { IncomeYearReport } from "../../src/lib/crypto/crypto-income-report-core";
import type { FileReadinessResult } from "../../src/lib/crypto/crypto-file-readiness-core";
import type { MethodSandboxResult } from "../../src/lib/crypto/crypto-method-sandbox-core";

/**
 * R1-F6 — the pure presenter + printable Audit Binder. Zero tax math of its
 * own; it composes the four upstream engines into an on-screen year-by-year
 * view-model and a self-contained, escape-safe printable HTML binder.
 */

function fake8949(net: number, shortG: number, longG: number, carry: number): Form8949Report {
  return {
    rows: [],
    shortTermTotals: {
      proceedsCents: 0,
      basisCents: 0,
      gainLossCents: shortG,
      proceedsDollars: 0,
      basisDollars: 0,
      gainLossDollars: 0,
    },
    longTermTotals: {
      proceedsCents: 0,
      basisCents: 0,
      gainLossCents: longG,
      proceedsDollars: 0,
      basisDollars: 0,
      gainLossDollars: 0,
    },
    scheduleD: {
      shortTermGainCents: shortG,
      longTermGainCents: longG,
      netCapitalGainCents: net,
      deductibleLossCents: 0,
      lossCarryforwardCents: carry,
      priorLossCarryforwardCents: 0,
    },
    hasAnyMissingBasis: false,
  } as unknown as Form8949Report;
}

function fakeIncome(taxYear: number, s1: number, sc: number): IncomeYearReport {
  return {
    taxYear,
    schedule1: { schedule: "schedule1", eventCount: 1, amountCents: s1, byTag: [] },
    scheduleC: { schedule: "scheduleC", eventCount: 0, amountCents: sc, byTag: [] },
    totalIncomeCents: s1 + sc,
    eventCount: 1,
  } as unknown as IncomeYearReport;
}

function fakeReadiness(taxYear: number, ready: boolean, blocking: number): FileReadinessResult {
  return {
    taxYear,
    issues: [],
    blockingCount: blocking,
    warningCount: 0,
    fileReady: ready,
    yearLocked: false,
  };
}

function fakeSandbox(): MethodSandboxResult {
  return {
    outcomes: [
      {
        method: "fifo",
        totalRealizedGainCents: 1000,
        shortTermGainCents: 1000,
        longTermGainCents: 0,
        hasMissingBasis: false,
        requiresSpecId: false,
        guardRailNote: "",
      },
    ],
    lowestGainMethod: "fifo",
    defaultMethod: "fifo",
    potentialGainReductionVsFifoCents: 0,
    hasAnyMissingBasis: false,
  } as unknown as MethodSandboxResult;
}

function fakeYear(taxYear: number, ready = true): TaxCenterYearInput {
  return {
    taxYear,
    form8949: fake8949(150000, 100000, 50000, 0),
    income: fakeIncome(taxYear, 30000, 0),
    readiness: fakeReadiness(taxYear, ready, ready ? 0 : 2),
    sandbox: fakeSandbox(),
  };
}

describe("crypto-tax-center-core embedded self-tests", () => {
  it("passes all pure self-tests", () => {
    expect(() => __runCryptoTaxCenterCoreTests()).not.toThrow();
  });
});

describe("whole-dollar formatting (IRS half-up rounding, thousands separators)", () => {
  it("formats positive and negative amounts", () => {
    expect(formatWholeDollars(123456)).toBe("$1,235");
    expect(formatWholeDollars(-250149)).toBe("-$2,501");
    expect(formatWholeDollars(0)).toBe("$0");
  });
});

describe("HTML escaping", () => {
  it("neutralizes angle brackets, ampersands, and quotes", () => {
    const out = esc('<script>&"\'');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;");
    expect(out).toContain("&amp;");
  });
});

describe("year view-model composition", () => {
  it("rolls up totals across years and reflects file-readiness", () => {
    const view = buildTaxCenterView({ years: [fakeYear(2023), fakeYear(2024)] });
    expect(view.years).toHaveLength(2);
    expect(view.allYearsReady).toBe(true);
    expect(view.totalNetCapitalGainCents).toBe(300000);
    expect(view.totalIncomeCents).toBe(60000);
    const y = view.years.find((v) => v.taxYear === 2024)!;
    expect(y.netCapitalGainCents).toBe(150000);
    expect(y.totalIncomeCents).toBe(30000);
    expect(y.fileReady).toBe(true);
  });

  it("marks allYearsReady false when any year has blocking issues", () => {
    const view = buildTaxCenterView({ years: [fakeYear(2023, true), fakeYear(2024, false)] });
    expect(view.allYearsReady).toBe(false);
  });

  it("treats an empty portfolio as trivially ready", () => {
    const view = buildTaxCenterView({ years: [] });
    expect(view.allYearsReady).toBe(true);
    expect(view.years).toHaveLength(0);
  });
});

describe("audit binder HTML", () => {
  const binderYear: BinderYear = {
    taxYear: 2024,
    method: "fifo",
    fileReady: true,
    netCapitalGainDisplay: "$1,500",
    totalIncomeDisplay: "$300",
    lots: [
      {
        assetSymbol: "FLR",
        quantityDisplay: "100",
        acquiredDate: "2024-01-05",
        basisDisplay: "$1,000",
        source: "on-chain",
      },
    ],
    disposals: [
      {
        assetSymbol: "FLR",
        quantityDisplay: "40",
        box: "I",
        dateAcquired: "2024-01-05",
        dateSold: "2024-06-15",
        proceedsDisplay: "$800",
        basisDisplay: "$400",
        gainLossDisplay: "$400",
        consumedLots: "lot-1",
        hasMissingBasis: false,
      },
    ],
    income: [],
    transfers: [],
    priceSources: [],
    acknowledgments: [],
    issues: [],
  };

  it("produces a complete, self-contained printable document", () => {
    const html = buildAuditBinderHtml({
      ownerName: "Michael",
      businessName: "Greenway Marijuana",
      generatedAtIso: "2026-01-15T00:00:00Z",
      years: [binderYear],
    });
    expect(html.toLowerCase()).toContain("<!doctype html>");
    expect(html).toContain("Greenway Marijuana");
    expect(html).toContain("Michael");
    expect(html).toContain("2024");
    expect(html).toContain("FLR");
    // Form 8949 box citation appears.
    expect(html.toUpperCase()).toContain("8949");
  });

  it("escapes malicious owner/business names (no raw script injection)", () => {
    const html = buildAuditBinderHtml({
      ownerName: "M<script>alert(1)</script>",
      businessName: "Green&way",
      generatedAtIso: "2026-01-15T00:00:00Z",
      years: [binderYear],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&amp;");
  });

  it("flags a missing-basis disposal in the binder", () => {
    const withMissing: BinderYear = {
      ...binderYear,
      disposals: [{ ...binderYear.disposals[0], hasMissingBasis: true }],
    };
    const html = buildAuditBinderHtml({
      ownerName: "Michael",
      businessName: "Greenway",
      generatedAtIso: "2026-01-15T00:00:00Z",
      years: [withMissing],
    });
    expect(html.toUpperCase()).toContain("MISSING BASIS");
  });
});
