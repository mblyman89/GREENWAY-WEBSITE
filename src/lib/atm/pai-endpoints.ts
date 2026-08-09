/**
 * src/lib/atm/pai-endpoints.ts — ATM/PAI Slice A-2c-2 (PURE)
 *
 * The single, honest source of truth for WHICH PAI report to fetch and HOW to
 * ask for its CSV. Kept pure (no I/O) so it is fully unit-tested and so the
 * "still-to-confirm" bits are visible and impossible to accidentally guess.
 *
 * ── WHAT IS CONFIRMED (from Michael's live address bar, 2026-08) ────────────
 *   Domain: https://www.paireports.com/myreports/   (note the leading www.)
 *   Simple Summary : GetTerminalTrxDataReport.event?ReportCmd=Filter
 *   ATM Cash Load  : GetATMCashLoadsReport.event?ReportCmd=Filter
 *   Bank Deposits  : GetFundsMovementByAcctByDayReport.event?ReportCmd=Filter
 *   Download mechanic: the "Go!" button submits the SAME .event path with
 *     ReportCmd=CustomCommand&CustomCmdList=<value>  (a FORM submit — the URL
 *     does not change on screen). SDK docs say the value is "DownloadCSV".
 *
 * ── WHAT IS NOT YET CONFIRMED (we will NOT guess) ───────────────────────────
 *   1) The exact CustomCmdList VALUE for the CSV option in Michael's account.
 *      SDK default is "DownloadCSV"; we keep it OVERRIDABLE via report_config
 *      so the moment Michael captures it (DevTools → Network → the .event
 *      request → Form Data), we set it with zero code change.
 *   2) The date-filter FIELD NAMES on ReportForm (SDK convention: F_[Column]).
 *      Until captured, we DO NOT send a date filter — we fetch the report as
 *      currently configured in the portal and let atm-core map whatever rows
 *      come back. Sending a guessed filter name could silently return the wrong
 *      window, so we simply don't (honest over clever).
 *
 * report_config (jsonb on atm_connection) may override any of these once the
 * real values are captured — see resolvePaiReportPlan(). This is how "yes, PAI
 * gave a read-only user / here are the exact params" becomes a data change,
 * not a code change.
 */

export type PaiReportKind = "cashLoad" | "simpleSummary" | "fundsMovement";

/** Confirmed .event path for each report (base path, no query beyond Filter). */
export const PAI_REPORT_EVENT: Record<PaiReportKind, string> = {
  cashLoad: "GetATMCashLoadsReport.event",
  simpleSummary: "GetTerminalTrxDataReport.event",
  fundsMovement: "GetFundsMovementByAcctByDayReport.event",
};

/**
 * The default CSV custom-command value per the PAI SDK docs. OVERRIDABLE via
 * report_config.customCmdList — we treat the SDK value as a sensible default,
 * NOT a certainty, and flag when it's still the unverified default so the UI
 * can say so honestly.
 */
export const PAI_DEFAULT_CUSTOM_CMD = "DownloadCSV";

/** Default portal base (with the confirmed www.). Overridable by portal_base_url. */
export const PAI_DEFAULT_BASE = "https://www.paireports.com/myreports/";

export type PaiReportPlan = {
  kind: PaiReportKind;
  /** Absolute URL of the report page (ReportCmd=Filter) — the "open report". */
  filterUrl: string;
  /** Absolute URL for the CSV custom-command fetch. */
  downloadUrl: string;
  /** The CustomCmdList value used (default or config override). */
  customCmdList: string;
  /** True when customCmdList is still the UNVERIFIED SDK default. */
  usingDefaultCustomCmd: boolean;
};

/** Join a base + path safely with exactly one slash. */
export function joinUrl(base: string, path: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path.slice(1) : path;
  return `${b}/${p}`;
}

/**
 * Build the fetch plan for one report. `baseUrl` comes from the connection's
 * portal_base_url (falls back to the confirmed www. default). `reportConfig`
 * is the connection's jsonb, where a captured CSV command value can override
 * the SDK default: `{ customCmdList: "..." }`.
 */
export function resolvePaiReportPlan(
  kind: PaiReportKind,
  baseUrl: string | null | undefined,
  reportConfig?: Record<string, unknown> | null,
): PaiReportPlan {
  const base = (baseUrl ?? "").trim() || PAI_DEFAULT_BASE;
  const event = PAI_REPORT_EVENT[kind];

  const configured =
    reportConfig && typeof reportConfig.customCmdList === "string"
      ? (reportConfig.customCmdList as string).trim()
      : "";
  const customCmdList = configured !== "" ? configured : PAI_DEFAULT_CUSTOM_CMD;
  const usingDefaultCustomCmd = configured === "";

  const filterUrl = `${joinUrl(base, event)}?ReportCmd=Filter`;
  const downloadUrl =
    `${joinUrl(base, event)}?ReportCmd=CustomCommand` +
    `&CustomCmdList=${encodeURIComponent(customCmdList)}`;

  return { kind, filterUrl, downloadUrl, customCmdList, usingDefaultCustomCmd };
}

/** All three report plans at once (the sync pulls all three). */
export function resolveAllPaiReportPlans(
  baseUrl: string | null | undefined,
  reportConfig?: Record<string, unknown> | null,
): Record<PaiReportKind, PaiReportPlan> {
  return {
    cashLoad: resolvePaiReportPlan("cashLoad", baseUrl, reportConfig),
    simpleSummary: resolvePaiReportPlan("simpleSummary", baseUrl, reportConfig),
    fundsMovement: resolvePaiReportPlan("fundsMovement", baseUrl, reportConfig),
  };
}

// ---------------------------------------------------------------------------
// Self-tests (pure — run via scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPaiEndpointsTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`[pai-endpoints] ${msg}`);
  };

  // joinUrl handles slashes.
  assert(joinUrl("https://x/myreports/", "A.event") === "https://x/myreports/A.event", "joinUrl trailing");
  assert(joinUrl("https://x/myreports", "A.event") === "https://x/myreports/A.event", "joinUrl no-trailing");
  assert(joinUrl("https://x/myreports/", "/A.event") === "https://x/myreports/A.event", "joinUrl leading");

  // Default plan uses confirmed www. base + confirmed event paths.
  const ss = resolvePaiReportPlan("simpleSummary", null, null);
  assert(
    ss.filterUrl === "https://www.paireports.com/myreports/GetTerminalTrxDataReport.event?ReportCmd=Filter",
    "simpleSummary filterUrl",
  );
  assert(ss.usingDefaultCustomCmd === true, "simpleSummary flags default cmd");
  assert(
    ss.downloadUrl ===
      "https://www.paireports.com/myreports/GetTerminalTrxDataReport.event?ReportCmd=CustomCommand&CustomCmdList=DownloadCSV",
    "simpleSummary downloadUrl default",
  );

  const cl = resolvePaiReportPlan("cashLoad", null, null);
  assert(cl.filterUrl.includes("GetATMCashLoadsReport.event"), "cashLoad event");
  const fm = resolvePaiReportPlan("fundsMovement", null, null);
  assert(fm.filterUrl.includes("GetFundsMovementByAcctByDayReport.event"), "fundsMovement event");

  // report_config override wins and clears the "default" flag.
  const overridden = resolvePaiReportPlan("simpleSummary", null, { customCmdList: "OpenCSV" });
  assert(overridden.customCmdList === "OpenCSV", "override value used");
  assert(overridden.usingDefaultCustomCmd === false, "override clears default flag");
  assert(overridden.downloadUrl.endsWith("CustomCmdList=OpenCSV"), "override in downloadUrl");

  // Custom base override respected.
  const custom = resolvePaiReportPlan("cashLoad", "https://paireports.com/myreports/", null);
  assert(custom.filterUrl.startsWith("https://paireports.com/myreports/"), "custom base respected");

  // all-three helper returns all kinds.
  const all = resolveAllPaiReportPlans(null, null);
  assert(!!all.cashLoad && !!all.simpleSummary && !!all.fundsMovement, "all three plans present");

  console.log("pai-endpoints: all self-tests passed");
}
