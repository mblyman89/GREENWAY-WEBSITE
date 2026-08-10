/**
 * tests/compliance/atm-report-diagnostics.test.ts
 *
 * Vitest mirror for the PURE ATM per-report diagnostic helper. This is the tool
 * that answers — WITHOUT GUESSING — why the Bank Deposits (Funds Movement) and
 * Cash Loads reports only showed recent dates after a backfill while the Simple
 * Summary report went all the way back: it reports, per report, the row count
 * and the earliest→latest date actually present, plus whether the backfill date
 * filter was applied.
 */
import { describe, expect, it } from "vitest";
import {
  dateSpan,
  buildReportDiagnostic,
  summarizeReportDiagnostics,
  PAI_REPORT_LABEL,
  __runAtmReportDiagnosticsTests,
} from "@/lib/atm/atm-report-diagnostics";

describe("dateSpan (earliest → latest, ignores bad values)", () => {
  it("finds min and max across ISO dates", () => {
    expect(dateSpan(["2026-07-04", "2024-02-29", "2026-01-01"])).toEqual({
      min: "2024-02-29",
      max: "2026-07-04",
    });
  });
  it("ignores malformed, empty, and non-ISO entries", () => {
    expect(dateSpan(["", null, "7/4/2026", "2026-06-15", undefined])).toEqual({
      min: "2026-06-15",
      max: "2026-06-15",
    });
  });
  it("returns nulls when there are no valid dates", () => {
    expect(dateSpan([null, "", "nope"])).toEqual({ min: null, max: null });
  });
});

describe("buildReportDiagnostic (honest per-report result)", () => {
  it("reports row count and span for a downloaded report", () => {
    const d = buildReportDiagnostic({
      kind: "simpleSummary",
      downloaded: true,
      dates: ["2024-02-29", "2026-07-04"],
      problemCount: 0,
      dateFilterApplied: true,
      usingDefaultDateField: true,
    });
    expect(d.rowCount).toBe(2);
    expect(d.minDate).toBe("2024-02-29");
    expect(d.maxDate).toBe("2026-07-04");
    expect(d.note).toContain("2024-02-29 → 2026-07-04");
  });
  it("flags a downloaded-but-empty report", () => {
    const d = buildReportDiagnostic({
      kind: "cashLoad",
      downloaded: true,
      dates: [],
      problemCount: 0,
      dateFilterApplied: true,
      usingDefaultDateField: false,
    });
    expect(d.rowCount).toBe(0);
    expect(d.note).toBe("downloaded but returned no rows");
  });
  it("reports a not-downloaded report with its error", () => {
    const d = buildReportDiagnostic({
      kind: "fundsMovement",
      downloaded: false,
      dates: [],
      problemCount: 0,
      dateFilterApplied: false,
      usingDefaultDateField: false,
      downloadError: "timed out",
    });
    expect(d.downloaded).toBe(false);
    expect(d.note).toBe("not downloaded — timed out");
  });
});

describe("summarizeReportDiagnostics (plain-English multi-report line)", () => {
  it("labels each report and shows the date-filter state", () => {
    const line = summarizeReportDiagnostics([
      buildReportDiagnostic({
        kind: "simpleSummary",
        downloaded: true,
        dates: ["2024-02-29", "2026-07-04"],
        problemCount: 0,
        dateFilterApplied: true,
        usingDefaultDateField: true,
      }),
      buildReportDiagnostic({
        kind: "fundsMovement",
        downloaded: true,
        dates: ["2026-07-01", "2026-07-04"],
        problemCount: 0,
        dateFilterApplied: true,
        usingDefaultDateField: true,
      }),
    ]);
    expect(line).toContain(PAI_REPORT_LABEL.simpleSummary);
    expect(line).toContain(PAI_REPORT_LABEL.fundsMovement);
    expect(line).toContain("(date filter applied, default field name)");
  });
});

describe("atm-report-diagnostics in-module self-tests", () => {
  it("runs __runAtmReportDiagnosticsTests without throwing", () => {
    expect(() => __runAtmReportDiagnosticsTests()).not.toThrow();
  });
});
