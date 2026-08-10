/**
 * src/lib/atm/atm-report-diagnostics.ts — ATM/PAI (PURE)
 *
 * WHY THIS EXISTS
 * ---------------
 * Michael's backfill pulled transaction history (Simple Summary: counts +
 * surcharge) all the way back to 2/29/2024, but the "Cash withdrawn" and
 * "Expected deposit" columns — which come ONLY from the Funds Movement (Bank
 * Deposits) report — plus the Cash Loads history, only showed recent dates.
 *
 * The three PAI reports go through the SAME date-range code, so the fact that
 * one backfilled and the others did not means one of these is true, and we must
 * NOT guess which:
 *   (1) PAI's Funds Movement / Cash Load reports have SHORTER retention than the
 *       Simple Summary report (older history simply isn't available → honest
 *       blanks, like the earlier "—" finding), OR
 *   (2) those reports need a different date FIELD NAME than F_SettlementDate /
 *       F_TrxTime, OR
 *   (3) the CSVs came back but older rows failed to parse.
 *
 * This PURE module turns each report's parsed rows into a small, honest
 * DIAGNOSTIC — row count and the earliest→latest date actually present — so ONE
 * backfill run tells us the truth per report with zero guessing. sync-server
 * attaches whether the date filter was applied (and whether it used the still-
 * default field name) from the plan, so the full picture is visible.
 *
 * STANDING RULES honored:
 *   • NEVER GUESS — this only REPORTS what the parsers actually returned.
 *   • PURE — no I/O; fully unit-tested via run-pure-selftests.ts.
 *   • MONEY IN CENTS — not relevant here (dates/counts only), but no money math.
 */

import type { PaiReportKind } from "./pai-endpoints";

/** One report's honest diagnostic after a pull+parse. */
export type PaiReportDiagnostic = {
  kind: PaiReportKind;
  /** True when the report downloaded AND parsed without a fatal error. */
  downloaded: boolean;
  /** Number of usable rows the mapper produced. */
  rowCount: number;
  /** Number of per-row problems the mapper flagged (unparseable rows, etc.). */
  problemCount: number;
  /** Earliest ISO yyyy-mm-dd date present in the parsed rows, or null if none. */
  minDate: string | null;
  /** Latest ISO yyyy-mm-dd date present in the parsed rows, or null if none. */
  maxDate: string | null;
  /** True when the backfill date range was applied to this report's request. */
  dateFilterApplied: boolean;
  /** True when the date filter used the still-unverified default FIELD NAME. */
  usingDefaultDateField: boolean;
  /** A plain-English note (download error, or empty, or ok). */
  note: string;
};

/**
 * Compute the earliest and latest ISO date from a list of ISO yyyy-mm-dd
 * strings. Ignores null/empty/malformed entries so a single bad row can't skew
 * the span. Returns { min: null, max: null } when there are no valid dates.
 * PURE.
 */
export function dateSpan(dates: readonly (string | null | undefined)[]): {
  min: string | null;
  max: string | null;
} {
  let min: string | null = null;
  let max: string | null = null;
  for (const raw of dates) {
    const s = (raw ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) continue; // only well-formed ISO dates
    if (min === null || s < min) min = s;
    if (max === null || s > max) max = s;
  }
  return { min, max };
}

/**
 * Build one report's diagnostic from its parsed rows. `dates` is the list of ISO
 * settlement/load dates the mapper produced (one per row). `downloaded` reflects
 * whether the CSV came back and parsed at all (false → the client returned an
 * error and there are no rows). PURE.
 */
export function buildReportDiagnostic(input: {
  kind: PaiReportKind;
  downloaded: boolean;
  dates: readonly (string | null | undefined)[];
  problemCount: number;
  dateFilterApplied: boolean;
  usingDefaultDateField: boolean;
  /** Optional download-level error/skip reason (used in the note when not ok). */
  downloadError?: string | null;
}): PaiReportDiagnostic {
  const rowCount = input.dates.length;
  const span = dateSpan(input.dates);

  let note: string;
  if (!input.downloaded) {
    note = input.downloadError?.trim()
      ? `not downloaded — ${input.downloadError.trim()}`
      : "not downloaded";
  } else if (rowCount === 0) {
    note = "downloaded but returned no rows";
  } else {
    note = `${rowCount} row(s), ${span.min ?? "?"} → ${span.max ?? "?"}`;
  }

  return {
    kind: input.kind,
    downloaded: input.downloaded,
    rowCount,
    problemCount: input.problemCount,
    minDate: span.min,
    maxDate: span.max,
    dateFilterApplied: input.dateFilterApplied,
    usingDefaultDateField: input.usingDefaultDateField,
    note,
  };
}

/** A friendly label for each report kind (for the diagnostics message). */
export const PAI_REPORT_LABEL: Record<PaiReportKind, string> = {
  cashLoad: "Cash Loads",
  simpleSummary: "Simple Summary (counts + surcharge)",
  fundsMovement: "Bank Deposits (cash withdrawn + expected)",
};

/**
 * Render a compact, plain-English multi-report diagnostic line for the backfill
 * result message + audit. Example:
 *   "Simple Summary (counts + surcharge): 900 row(s), 2024-02-29 → 2026-07-04.
 *    Bank Deposits (cash withdrawn + expected): 4 row(s), 2026-07-01 → 2026-07-04
 *    (date filter applied). Cash Loads: not downloaded — timed out."
 * PURE.
 */
export function summarizeReportDiagnostics(diags: readonly PaiReportDiagnostic[]): string {
  if (diags.length === 0) return "No report diagnostics.";
  const parts: string[] = [];
  for (const d of diags) {
    const label = PAI_REPORT_LABEL[d.kind];
    const filterBit = d.dateFilterApplied
      ? d.usingDefaultDateField
        ? " (date filter applied, default field name)"
        : " (date filter applied)"
      : " (no date filter)";
    parts.push(`${label}: ${d.note}${filterBit}`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Self-tests (pure — run via scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runAtmReportDiagnosticsTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`[atm-report-diagnostics] ${msg}`);
  };

  // dateSpan: basic min/max.
  const s1 = dateSpan(["2026-07-04", "2024-02-29", "2026-01-01"]);
  assert(s1.min === "2024-02-29" && s1.max === "2026-07-04", "dateSpan min/max");

  // dateSpan: ignores malformed/empty/null.
  const s2 = dateSpan(["", null, "garbage", "2026-06-15", undefined, "7/4/2026"]);
  assert(s2.min === "2026-06-15" && s2.max === "2026-06-15", "dateSpan ignores bad values");

  // dateSpan: no valid dates → nulls.
  const s3 = dateSpan([null, "", "nope"]);
  assert(s3.min === null && s3.max === null, "dateSpan empty → nulls");

  // dateSpan: single date.
  const s4 = dateSpan(["2026-07-01"]);
  assert(s4.min === "2026-07-01" && s4.max === "2026-07-01", "dateSpan single");

  // buildReportDiagnostic: downloaded with rows → span note.
  const good = buildReportDiagnostic({
    kind: "simpleSummary",
    downloaded: true,
    dates: ["2024-02-29", "2026-07-04", "2025-01-01"],
    problemCount: 0,
    dateFilterApplied: true,
    usingDefaultDateField: true,
  });
  assert(good.rowCount === 3, "diag rowCount");
  assert(good.minDate === "2024-02-29" && good.maxDate === "2026-07-04", "diag span");
  assert(good.note.includes("2024-02-29 → 2026-07-04"), "diag note shows span");
  assert(good.downloaded === true, "diag downloaded true");

  // buildReportDiagnostic: downloaded but zero rows.
  const empty = buildReportDiagnostic({
    kind: "cashLoad",
    downloaded: true,
    dates: [],
    problemCount: 0,
    dateFilterApplied: true,
    usingDefaultDateField: false,
  });
  assert(empty.rowCount === 0, "diag empty rowCount");
  assert(empty.minDate === null && empty.maxDate === null, "diag empty span null");
  assert(empty.note === "downloaded but returned no rows", "diag empty note");

  // buildReportDiagnostic: not downloaded, with error.
  const failed = buildReportDiagnostic({
    kind: "fundsMovement",
    downloaded: false,
    dates: [],
    problemCount: 0,
    dateFilterApplied: false,
    usingDefaultDateField: false,
    downloadError: "timed out",
  });
  assert(failed.downloaded === false, "diag failed downloaded false");
  assert(failed.note === "not downloaded — timed out", "diag failed note with error");

  // not downloaded, no error string.
  const failed2 = buildReportDiagnostic({
    kind: "fundsMovement",
    downloaded: false,
    dates: [],
    problemCount: 0,
    dateFilterApplied: false,
    usingDefaultDateField: false,
  });
  assert(failed2.note === "not downloaded", "diag failed note without error");

  // summarizeReportDiagnostics: joins labels + filter bits, distinguishes reports.
  const line = summarizeReportDiagnostics([good, failed]);
  assert(line.includes("Simple Summary (counts + surcharge)"), "summary has SS label");
  assert(line.includes("Bank Deposits (cash withdrawn + expected)"), "summary has FM label");
  assert(line.includes("(date filter applied, default field name)"), "summary shows default-field note");
  assert(line.includes("(no date filter)"), "summary shows no-filter note for failed");

  // summary of empty list.
  assert(summarizeReportDiagnostics([]) === "No report diagnostics.", "summary empty");

  // labels present for all kinds.
  assert(
    !!PAI_REPORT_LABEL.cashLoad && !!PAI_REPORT_LABEL.simpleSummary && !!PAI_REPORT_LABEL.fundsMovement,
    "labels for all kinds",
  );

  console.log("atm-report-diagnostics: all self-tests passed");
}
