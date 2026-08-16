/**
 * src/lib/atm/terminal-status-core.ts — ATM/PAI Slice A-2e (PURE)
 *
 * PAI's **Terminal Status** report (Reports → ATM Realtime Reports → Terminal
 * Status) is a REALTIME SNAPSHOT of the machine right now: is it up, how much
 * cash is actually in it, and how many transactions it has run since the last
 * settlement. That is fundamentally different from the three HISTORICAL reports
 * the sync already pulls (cash loads / simple summary / funds movement), which
 * are date-ranged ledgers of things that already happened.
 *
 * ── WHY THIS MATTERS ───────────────────────────────────────────────────────
 * Until now "current cash in machine" was DERIVED: balance at the last cash
 * load, minus the cash settled since. That derivation is honest but it is an
 * ESTIMATE with a known blind spot — settlements land as whole days, so
 * anything dispensed after the last settled day couldn't be counted, making the
 * figure a conservative UPPER bound. Terminal Status reports the machine's
 * balance DIRECTLY, so when it is available it supersedes the estimate. We keep
 * both and always say which one is on screen.
 *
 * ── WHAT IS CONFIRMED (sources, not guesses) ───────────────────────────────
 *  1) Columns — from Michael's OWN PAI home screen (ATM Status grid,
 *     source-documents/PAI_REPORTS_home_page_right_after_login.png):
 *       Terminal | Group | Location | Status | Days Until Cash Out | Last Trx |
 *       Last WD Trx | Last Rev Trx | Trxs Since Settlement | Balance Prev EOD |
 *       Balance
 *     Live values seen there: Status "OK", Trxs Since Settlement 61,
 *     Balance Prev EOD $20, Balance $1,800, Terminal HG26499.
 *  2) Download mechanic — PAI's OFFICIAL SDK (gopai/reporting-sdk,
 *     PAIClient.retrieveReportUsingBuilder): ANY report is fetched by GUID via
 *     POST Report.event with
 *       ReportGUID=<guid>&ReportCmd=Filter&ReportCmd=CustomCommand&CustomCmdList=DownloadCSV
 *     The SDK hardcodes NO per-report .event paths.
 *  3) Report lookup — PAI's OFFICIAL example client (gopai/paireportsclient,
 *     ReportIdentifierRetriever): every report the user can see is enumerable
 *     with `SELECT * FROM ReportConfigs r ORDER BY r.Name`.
 *
 * ── WHAT WE DELIBERATELY DO NOT DO ─────────────────────────────────────────
 * We do NOT invent a per-report `.event` path for Terminal Status (we never saw
 * one in Michael's address bar and the SDK proves one isn't needed). We resolve
 * the report BY NAME → GUID and download it the SDK's universal way.
 *
 * PURE: no I/O, no DB, no fetch. Fully unit-tested.
 */

import {
  parseCsv,
  headerIndex,
  pickColumn,
  dollarsToCents,
  toIntOrNull,
  type MapProblem,
  type MapResult,
} from "./atm-core";

// ---------------------------------------------------------------------------
// 1) Finding the report: the name PAI shows in the menu.
// ---------------------------------------------------------------------------

/**
 * Title fragments that identify the Terminal Status report in PAI's report
 * list. Matched case/space-insensitively against BOTH `Name` and `ExternalName`
 * from `ReportConfigs`. Ordered most-specific first so the best match wins.
 *
 * "ATM Status" is included because that is the exact wording PAI uses for this
 * same grid on the portal home page (see Michael's screenshot). If more than
 * one report matches we report the ambiguity rather than picking blindly.
 */
export const TERMINAL_STATUS_TITLE_HINTS: readonly string[] = [
  "terminal status",
  "atm status",
  "terminal realtime status",
  "realtime terminal status",
] as const;

/** Normalize a report name for tolerant matching (lowercase, alnum only). */
export function normalizeReportName(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A report identity row as returned by PAI's Data API (ReportConfigs). */
export type ReportConfigLike = {
  reportGuid: string;
  externalName: string;
  name: string;
};

export type TerminalStatusMatch = {
  /** Every row whose name looked like Terminal Status. */
  candidates: ReportConfigLike[];
  /** The single unambiguous winner, or null. */
  best: ReportConfigLike | null;
  /** True only when exactly one candidate matched (or one clearly best hint). */
  confident: boolean;
};

/**
 * Find the Terminal Status report among PAI's report list.
 *
 * NEVER GUESSES: when several reports match we try the hints in priority order
 * and only accept a winner if that hint matches exactly ONE report. Otherwise
 * `confident` is false and every candidate is returned so a human can choose.
 */
export function matchTerminalStatusReport(rows: ReportConfigLike[]): TerminalStatusMatch {
  const safe = Array.isArray(rows) ? rows.filter((r) => r && typeof r.reportGuid === "string") : [];
  const hay = (r: ReportConfigLike) =>
    `${normalizeReportName(r.name)} ${normalizeReportName(r.externalName)}`;

  const candidates = safe.filter((r) => {
    const h = hay(r);
    return TERMINAL_STATUS_TITLE_HINTS.some((hint) => h.includes(normalizeReportName(hint)));
  });

  if (candidates.length === 1) {
    return { candidates, best: candidates[0], confident: true };
  }
  // Several matched — walk the hints most-specific first. A hint that singles
  // out exactly one report is decisive; anything else stays ambiguous.
  for (const hint of TERMINAL_STATUS_TITLE_HINTS) {
    const needle = normalizeReportName(hint);
    const exact = candidates.filter((r) => hay(r).includes(needle));
    if (exact.length === 1) return { candidates, best: exact[0], confident: true };
  }
  return { candidates, best: null, confident: false };
}

// ---------------------------------------------------------------------------
// 2) The snapshot row + CSV mapper.
// ---------------------------------------------------------------------------

/**
 * One machine's realtime snapshot. Money in CENTS. EVERY field except the
 * terminal id is nullable on purpose: PAI omits columns depending on how the
 * report is configured, and an absent value means UNKNOWN — never zero.
 */
export type TerminalStatusRow = {
  terminalId: string;
  location: string | null;
  groupName: string | null;
  /** PAI's own health word, e.g. "OK". Kept verbatim — we never reinterpret it. */
  status: string | null;
  daysUntilCashOut: number | null;
  /** Raw "Last Trx" / "Last WD Trx" text exactly as PAI printed it. */
  lastTrxRaw: string | null;
  lastWithdrawalTrxRaw: string | null;
  lastReversalTrxRaw: string | null;
  /** Transactions run since the last settlement — the "withdrawals currently". */
  trxsSinceSettlement: number | null;
  balancePrevEodCents: number | null;
  /** THE number Michael wants: cash actually in the machine right now. */
  balanceCents: number | null;
  raw: Record<string, string>;
};

function rowObject(header: string[], cells: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  header.forEach((h, idx) => {
    o[h] = cells[idx] ?? "";
  });
  return o;
}

/** Trim to a string, or null when blank. Keeps "unknown" distinct from "". */
function textOrNull(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

/**
 * Map the Terminal Status CSV to snapshot rows.
 *
 * Column matching is tolerant (normalized aliases) because PAI lets the report
 * be reconfigured, but it is never inventive: a column we cannot find yields
 * null, and a row without a terminal id is reported as a problem and dropped.
 *
 * NOTE ON "Balance": PAI prints the machine's CURRENT cash balance here. This
 * is the same "Balance" wording the Cash Load report uses for its POST-LOAD
 * balance, but the two are different instants — this one is live.
 */
export function mapTerminalStatusCsv(csv: string): MapResult<TerminalStatusRow> {
  const table = parseCsv(csv);
  const problems: MapProblem[] = [];
  const rows: TerminalStatusRow[] = [];
  if (table.length === 0) return { rows, problems };

  const header = table[0];
  const map = headerIndex(header);

  const iTerminal = pickColumn(map, ["terminal", "terminalnumber", "terminalid"]);
  const iLocation = pickColumn(map, ["location"]);
  const iGroup = pickColumn(map, ["group", "groupname"]);
  const iStatus = pickColumn(map, ["status", "terminalstatus"]);
  const iDaysOut = pickColumn(map, ["daysuntilcashout", "daystilcashout", "daystocashout"]);
  const iLastTrx = pickColumn(map, ["lasttrx", "lasttransaction"]);
  const iLastWd = pickColumn(map, ["lastwdtrx", "lastwithdrawaltrx", "lastwdtransaction"]);
  const iLastRev = pickColumn(map, ["lastrevtrx", "lastreversaltrx"]);
  const iSinceSettle = pickColumn(map, [
    "trxssincesettlement",
    "trxsincesettlement",
    "transactionssincesettlement",
  ]);
  const iBalPrevEod = pickColumn(map, ["balancepreveod", "balancepreviouseod", "preveodbalance"]);
  const iBalance = pickColumn(map, ["balance", "currentbalance"]);

  if (iTerminal < 0) {
    problems.push({
      row: 0,
      message:
        "Terminal Status CSV is missing a terminal column — got: " +
        header.map((h) => `"${h}"`).join(", "),
    });
    return { rows, problems };
  }
  // The whole point of this report is the live balance. If PAI didn't send it,
  // say so loudly instead of silently returning rows full of nulls.
  if (iBalance < 0) {
    problems.push({
      row: 0,
      message:
        "Terminal Status CSV has no 'Balance' column, so it can't report current cash. " +
        "Add the Balance column to the report in PAI, then sync again.",
    });
  }

  for (let r = 1; r < table.length; r += 1) {
    const cells = table[r];
    if (cells.length === 1 && (cells[0] ?? "").trim() === "") continue; // blank line
    const terminalId = (cells[iTerminal] ?? "").trim();
    if (!terminalId) {
      problems.push({ row: r, message: "missing terminal id" });
      continue;
    }
    // PAI appends a grand-total line with no terminal id; it's already skipped
    // by the check above. Any row reaching here is a real machine.
    rows.push({
      terminalId,
      location: iLocation >= 0 ? textOrNull(cells[iLocation]) : null,
      groupName: iGroup >= 0 ? textOrNull(cells[iGroup]) : null,
      status: iStatus >= 0 ? textOrNull(cells[iStatus]) : null,
      daysUntilCashOut: iDaysOut >= 0 ? toIntOrNull(cells[iDaysOut]) : null,
      lastTrxRaw: iLastTrx >= 0 ? textOrNull(cells[iLastTrx]) : null,
      lastWithdrawalTrxRaw: iLastWd >= 0 ? textOrNull(cells[iLastWd]) : null,
      lastReversalTrxRaw: iLastRev >= 0 ? textOrNull(cells[iLastRev]) : null,
      trxsSinceSettlement: iSinceSettle >= 0 ? toIntOrNull(cells[iSinceSettle]) : null,
      balancePrevEodCents: iBalPrevEod >= 0 ? dollarsToCents(cells[iBalPrevEod]) : null,
      balanceCents: iBalance >= 0 ? dollarsToCents(cells[iBalance]) : null,
      raw: rowObject(header, cells),
    });
  }
  return { rows, problems };
}

/**
 * Pick the snapshot for one terminal. Exact match on the trimmed id; when the
 * connection has no terminal configured and PAI returned exactly one machine,
 * that machine is used (unambiguous). Otherwise null — never a guess.
 */
export function pickTerminalSnapshot(
  rows: TerminalStatusRow[],
  terminalId: string | null | undefined,
): TerminalStatusRow | null {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return null;
  const want = (terminalId ?? "").trim();
  if (want === "") return list.length === 1 ? list[0] : null;
  return list.find((r) => r.terminalId.trim() === want) ?? null;
}

// ---------------------------------------------------------------------------
// 3) Presentation — the card the owner actually reads.
// ---------------------------------------------------------------------------

/** Where the "current cash" number on screen came from. */
export type CashSource = "live" | "estimate" | "unknown";

export type TerminalStatusView = {
  hasSnapshot: boolean;
  terminalId: string | null;
  status: string | null;
  /** True when PAI's status word reads healthy. Null when there's no status. */
  statusIsOk: boolean | null;
  statusTone: "green" | "orange" | "neutral";
  location: string | null;
  daysUntilCashOut: number | null;
  trxsSinceSettlement: number | null;
  lastTrxRaw: string | null;
  lastWithdrawalTrxRaw: string | null;
  balanceCents: number | null;
  balancePrevEodCents: number | null;
  /** When PAI captured this snapshot (ISO), and a friendly age line. */
  capturedAt: string | null;
  /** The number to SHOW as current cash, preferring the live reading. */
  currentCashCents: number | null;
  currentCashSource: CashSource;
  /** One plain-English sentence explaining the figure and its provenance. */
  currentCashExplanation: string;
};

/** PAI's healthy status words, normalized. Anything else is treated as notable. */
const OK_STATUS_WORDS = new Set(["ok", "inservice", "online", "active", "normal"]);

/**
 * Build the view. `estimateCents` is the derived figure the loads tab already
 * computes (balance at last load − dispensed since); it is used ONLY when the
 * live reading is unavailable, and the view always states which one is shown so
 * the owner is never misled about precision.
 */
export function buildTerminalStatusView(
  snapshot: TerminalStatusRow | null,
  opts?: { capturedAt?: string | null; estimateCents?: number | null },
): TerminalStatusView {
  const capturedAt = (opts?.capturedAt ?? "").trim() || null;
  const estimate =
    opts?.estimateCents !== null && opts?.estimateCents !== undefined && Number.isFinite(opts.estimateCents)
      ? Math.trunc(opts.estimateCents)
      : null;

  if (!snapshot) {
    return {
      hasSnapshot: false,
      terminalId: null,
      status: null,
      statusIsOk: null,
      statusTone: "neutral",
      location: null,
      daysUntilCashOut: null,
      trxsSinceSettlement: null,
      lastTrxRaw: null,
      lastWithdrawalTrxRaw: null,
      balanceCents: null,
      balancePrevEodCents: null,
      capturedAt: null,
      currentCashCents: estimate,
      currentCashSource: estimate === null ? "unknown" : "estimate",
      currentCashExplanation:
        estimate === null
          ? "No live reading from PAI yet, and there aren’t enough cash loads and settlements to estimate it. Sync to pull the machine’s current status."
          : "Estimated from your last cash load minus the cash settled since. Sync to pull PAI’s live Terminal Status for the exact figure.",
    };
  }

  const statusRaw = snapshot.status;
  const statusNorm = normalizeReportName(statusRaw ?? "");
  const statusIsOk = statusRaw === null ? null : OK_STATUS_WORDS.has(statusNorm);
  const statusTone: "green" | "orange" | "neutral" =
    statusIsOk === null ? "neutral" : statusIsOk ? "green" : "orange";

  const live = snapshot.balanceCents;
  const currentCashCents = live !== null ? live : estimate;
  const currentCashSource: CashSource = live !== null ? "live" : estimate !== null ? "estimate" : "unknown";

  let currentCashExplanation: string;
  if (currentCashSource === "live") {
    currentCashExplanation =
      "Read directly from the machine by PAI — this is the actual cash in the ATM right now, not an estimate.";
  } else if (currentCashSource === "estimate") {
    currentCashExplanation =
      "PAI’s live status didn’t include a balance, so this is estimated from your last cash load minus the cash settled since.";
  } else {
    currentCashExplanation =
      "PAI’s live status didn’t include a balance and there isn’t enough history to estimate one.";
  }

  return {
    hasSnapshot: true,
    terminalId: snapshot.terminalId,
    status: statusRaw,
    statusIsOk,
    statusTone,
    location: snapshot.location,
    daysUntilCashOut: snapshot.daysUntilCashOut,
    trxsSinceSettlement: snapshot.trxsSinceSettlement,
    lastTrxRaw: snapshot.lastTrxRaw,
    lastWithdrawalTrxRaw: snapshot.lastWithdrawalTrxRaw,
    balanceCents: snapshot.balanceCents,
    balancePrevEodCents: snapshot.balancePrevEodCents,
    capturedAt,
    currentCashCents,
    currentCashSource,
    currentCashExplanation,
  };
}

// ---------------------------------------------------------------------------
// Self-test harness (mirrors the vitest file; run by the pure self-test script).
// ---------------------------------------------------------------------------

export function __runTerminalStatusCoreTests(): void {
  const ok = (cond: boolean, label: string) => {
    if (!cond) throw new Error(`terminal-status-core self-test failed: ${label}`);
  };

  // Michael's real ATM Status grid, in the CSV shape PAI exports.
  const csv = [
    `"Terminal","Group","Location","Status","Days Until Cash Out","Last Trx","Last WD Trx","Last Rev Trx","Trxs Since Settlement","Balance Prev EOD","Balance"`,
    `"HG26499","CASCADE GENERAL PARTNERS","CASCADE GENERAL PARTNERS","OK","0","8/9/26 9:54:19 AM","8/9/26 9:54:19 AM","6/28/26 1:23:36 PM","61","$20","$1,800"`,
  ].join("\n");
  const mapped = mapTerminalStatusCsv(csv);
  ok(mapped.problems.length === 0, "real CSV maps without problems");
  ok(mapped.rows.length === 1, "one terminal row");
  const row = mapped.rows[0];
  ok(row.terminalId === "HG26499", "terminal id");
  ok(row.status === "OK", "status verbatim");
  ok(row.trxsSinceSettlement === 61, "trxs since settlement");
  ok(row.balanceCents === 180000, "balance $1,800 → cents");
  ok(row.balancePrevEodCents === 2000, "prev EOD $20 → cents");
  ok(row.daysUntilCashOut === 0, "days until cash out is 0, not null");

  // Picking + view.
  ok(pickTerminalSnapshot(mapped.rows, "HG26499") !== null, "picks by id");
  ok(pickTerminalSnapshot(mapped.rows, "NOPE") === null, "unknown id → null");
  ok(pickTerminalSnapshot(mapped.rows, "") !== null, "blank id + single row → that row");

  const view = buildTerminalStatusView(row, { capturedAt: "2026-08-16T12:00:00.000Z", estimateCents: 98000 });
  ok(view.currentCashCents === 180000, "live balance wins over the estimate");
  ok(view.currentCashSource === "live", "source is live");
  ok(view.statusIsOk === true && view.statusTone === "green", "OK status is green");

  // No snapshot → fall back to the estimate, and SAY it's an estimate.
  const fallback = buildTerminalStatusView(null, { estimateCents: 98000 });
  ok(fallback.currentCashCents === 98000, "falls back to estimate");
  ok(fallback.currentCashSource === "estimate", "source is estimate");
  ok(fallback.hasSnapshot === false, "no snapshot flagged");

  const nothing = buildTerminalStatusView(null, { estimateCents: null });
  ok(nothing.currentCashCents === null, "nothing known → null, never 0");
  ok(nothing.currentCashSource === "unknown", "source unknown");

  // A zero balance is REAL data and must not be confused with unknown.
  const zero = mapTerminalStatusCsv(
    `"Terminal","Balance"\n"HG26499","$0.00"`,
  );
  ok(zero.rows[0].balanceCents === 0, "$0.00 maps to 0, not null");
  const zeroView = buildTerminalStatusView(zero.rows[0], { estimateCents: 98000 });
  ok(zeroView.currentCashCents === 0, "a real zero balance beats the estimate");

  // Missing Balance column is called out rather than silently nulled.
  const noBal = mapTerminalStatusCsv(`"Terminal","Status"\n"HG26499","OK"`);
  ok(noBal.problems.length === 1, "missing Balance column reported");
  ok(noBal.rows[0].balanceCents === null, "no balance → null");

  // Report matching.
  const rowsCfg: ReportConfigLike[] = [
    { reportGuid: "G1", name: "Terminal Status", externalName: "terminalstatus" },
    { reportGuid: "G2", name: "ATM Cash Load Report", externalName: "cashload" },
  ];
  const m = matchTerminalStatusReport(rowsCfg);
  ok(m.confident && m.best?.reportGuid === "G1", "matches Terminal Status by name");
  ok(matchTerminalStatusReport([rowsCfg[1]]).confident === false, "no match → not confident");
  const ambiguous = matchTerminalStatusReport([
    { reportGuid: "A", name: "ATM Status", externalName: "" },
    { reportGuid: "B", name: "ATM Status Copy", externalName: "" },
  ]);
  ok(ambiguous.confident === false && ambiguous.candidates.length === 2, "ambiguous → not confident");

  console.log("terminal-status-core: all self-tests passed");
}
