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

/**
 * The UNIVERSAL report-download endpoint, CONFIRMED from PAI's official SDK
 * (gopai/reporting-sdk PAIClient.retrieveReportUsingBuilder): any report is
 * fetched by its GUID via `POST Report.event`, NOT a per-report .event path.
 * This is what lets us probe ANY candidate report uniformly.
 */
export const PAI_REPORT_EVENT_UNIVERSAL = "Report.event";

/**
 * Build the x-www-form-urlencoded BODY to download a report's CSV BY ITS GUID,
 * exactly the way PAI's SDK does:
 *   ReportGUID=<guid>&ReportCmd=Filter&ReportCmd=CustomCommand&CustomCmdList=<cmd>
 *   [&F_<Col>=<range>&E_<Col>=false ...]
 * `filters` is an optional list of {column, value} — each becomes the F_/E_ pair.
 * PURE: returns just the encoded body string. `customCmdList` defaults to the
 * SDK's DownloadCSV.
 */
export function buildPaiGuidDownloadBody(
  guid: string,
  opts?: { customCmdList?: string; filters?: Array<{ column: string; value: string }> },
): string {
  const params = new URLSearchParams();
  params.append("ReportGUID", (guid ?? "").trim());
  params.append("ReportCmd", "Filter");
  params.append("ReportCmd", "CustomCommand");
  params.append("CustomCmdList", (opts?.customCmdList ?? "").trim() || PAI_DEFAULT_CUSTOM_CMD);
  for (const f of opts?.filters ?? []) {
    const col = (f.column ?? "").trim();
    if (col === "") continue;
    params.append(`F_${col}`, f.value ?? "");
    params.append(`E_${col}`, "false"); // E_ = "exclude column from output" → false = keep it
  }
  return params.toString();
}

/**
 * Build a GET download URL for a specific report GUID via a PER-REPORT `.event`
 * path — the SAME mechanic the working live sync uses (resolvePaiReportPlan's
 * combinedUrl: `<event>?ReportCmd=Filter&ReportCmd=CustomCommand&CustomCmdList=..`),
 * but pinned to one candidate by appending `&ReportGUID=<guid>`.
 *
 * WHY: probing showed the "Terminal Trx Data" (Simple Summary) report family
 * returns an HTML page for the universal `POST Report.event` GUID call, yet
 * downloads correctly through this per-report GET `.event` path (that's how
 * Michael's Simple Summary history backfilled). Funds Movement / Cash Loads
 * accept both. So the probe tries THIS proven GET path first, then falls back
 * to the universal POST — never guessing which a given report prefers.
 *
 * PURE: `event` is a confirmed per-kind `.event` path (PAI_REPORT_EVENT[kind]).
 * `customCmdList` defaults to the SDK's DownloadCSV.
 */
export function buildPaiGuidDownloadUrl(
  base: string,
  event: string,
  guid: string,
  opts?: { customCmdList?: string },
): string {
  const cmd = (opts?.customCmdList ?? "").trim() || PAI_DEFAULT_CUSTOM_CMD;
  const g = (guid ?? "").trim();
  return (
    `${joinUrl(base, event)}?ReportCmd=Filter&ReportCmd=CustomCommand` +
    `&CustomCmdList=${encodeURIComponent(cmd)}` +
    (g === "" ? "" : `&ReportGUID=${encodeURIComponent(g)}`)
  );
}

/** Default portal base (with the confirmed www.). Overridable by portal_base_url. */
export const PAI_DEFAULT_BASE = "https://www.paireports.com/myreports/";

/**
 * The earliest date to request on a history/backfill pull. CONFIRMED by Michael:
 * the furthest back his PAI portal allows is 2/29/2024, so that's where the first
 * pull starts. Overridable per connection via report_config.historyStart (ISO
 * yyyy-mm-dd), e.g. if a future account has deeper history.
 */
export const PAI_DEFAULT_HISTORY_START = "2024-02-29";

export type PaiReportPlan = {
  kind: PaiReportKind;
  /** Absolute URL of the report page (ReportCmd=Filter) — the "open report". */
  filterUrl: string;
  /** Absolute URL for the CSV custom-command fetch (no filter — legacy 2-step). */
  downloadUrl: string;
  /**
   * Absolute URL that combines Filter + CustomCommand + the F_<Column> date
   * filter in ONE request — the robust pattern from PAI's official SDK. This is
   * what the client actually fetches so the date filter travels WITH the CSV
   * download for every report (not just the one PAI happened to persist).
   */
  combinedUrl: string;
  /** The CustomCmdList value used (default or config override). */
  customCmdList: string;
  /** True when customCmdList is still the UNVERIFIED SDK default. */
  usingDefaultCustomCmd: boolean;
  /** True when a date range was applied to filterUrl (backfill/history pull). */
  dateFilterApplied: boolean;
  /**
   * True when the date range was applied using the UNVERIFIED default FIELD NAME
   * (the range VALUE FORMAT is confirmed from Michael's portal; only the form
   * field's name is still the SDK-convention default until captured). Lets the
   * UI say "history window is best-effort until the field name is captured."
   */
  usingDefaultDateField: boolean;
};

/**
 * An inclusive date window in ISO yyyy-mm-dd (internal representation). It is
 * FORMATTED into PAI's confirmed on-screen format when sent (see below).
 */
export type PaiDateRange = { from: string; to: string };

/**
 * The PAI report column each report is date-filtered on — CONFIRMED from
 * Michael's portal screenshots (2026-08): the settlement reports filter on
 * "Settlement Date"; the Cash Load report on "Trx Time".
 */
export const PAI_DATE_COLUMN: Record<PaiReportKind, string> = {
  cashLoad: "Trx Time",
  simpleSummary: "Settlement Date",
  fundsMovement: "Settlement Date",
};

/**
 * CONFIRMED from Michael's portal (2026-08): PAI's date filter is a SINGLE text
 * field whose value is a RANGE STRING in the form `M/D/YYYY - M/D/YYYY`
 * (e.g. `08/01/2026 - 08/31/2026`). The helper text confirms: "Enter single date
 * or date range in the form M/D/YYYY ... A date range is specified with two dates
 * separated by a hyphen." So we send ONE field, not two From/To fields.
 *
 * Convert an ISO yyyy-mm-dd date to PAI's M/D/YYYY (zero-padded MM/DD/YYYY is
 * accepted, as the portal itself renders 08/01/2026). Returns "" for bad input.
 */
export function formatPaiDate(iso: string | null | undefined): string {
  const s = (iso ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  const [, y, mo, d] = m;
  return `${mo}/${d}/${y}`;
}

/** Build PAI's range-string value `MM/DD/YYYY - MM/DD/YYYY` from an ISO range. */
export function buildPaiRangeValue(range: PaiDateRange): string {
  const from = formatPaiDate(range.from);
  const to = formatPaiDate(range.to);
  if (from === "" || to === "") return "";
  return `${from} - ${to}`;
}

/**
 * Resolve the SINGLE date-filter form field NAME for a report. The VALUE FORMAT
 * is confirmed; the field NAME is the one remaining unknown, so it stays
 * overridable via report_config.dateFieldName and defaults to the SDK convention
 * `F_[Column]` (spaces removed, e.g. "Settlement Date" → F_SettlementDate).
 * Returns the field name + whether it's still the unverified default.
 */
export function resolvePaiDateFieldName(
  kind: PaiReportKind,
  reportConfig?: Record<string, unknown> | null,
): { name: string; usingDefault: boolean } {
  // report_config.dateFieldName may be EITHER:
  //   • a plain string  → a single override applied to every report (legacy), OR
  //   • an object keyed by report kind → a PER-REPORT override, e.g.
  //       { dateFieldName: { fundsMovement: "F_PostDate", cashLoad: "F_TrxDate" } }
  // The per-report form is what we need here: each PAI report names its date
  // filter column differently, and we CONFIRM each one rather than guess.
  const raw = reportConfig?.dateFieldName;

  if (typeof raw === "string") {
    const s = raw.trim();
    if (s !== "") return { name: s, usingDefault: false };
  } else if (raw && typeof raw === "object") {
    const perKind = (raw as Record<string, unknown>)[kind];
    if (typeof perKind === "string") {
      const s = perKind.trim();
      if (s !== "") return { name: s, usingDefault: false };
    }
    // Reserved "*" key = a legacy single override applied to every report
    // (preserved by mergeDateFieldOverride when the old value was a plain
    // string). Only used when this report has no per-kind entry of its own.
    const star = (raw as Record<string, unknown>)["*"];
    if (typeof star === "string") {
      const s = star.trim();
      if (s !== "") return { name: s, usingDefault: false };
    }
  }

  const col = PAI_DATE_COLUMN[kind].replace(/\s+/g, "");
  return { name: `F_${col}`, usingDefault: true };
}

/**
 * List the report kinds that DO NOT yet have a confirmed (saved) date-filter
 * column name in report_config.dateFieldName \u2014 i.e. the ones still using the
 * unverified SDK-convention default. These are exactly the reports PAI will
 * silently refuse to date-filter (returning only its small default window)
 * during a history/backfill pull. The self-heal step discovers + saves their
 * real column names before pulling. Pure (no I/O) so it is fully unit-tested.
 */
export function reportKindsMissingDateField(
  reportConfig?: Record<string, unknown> | null,
): PaiReportKind[] {
  const kinds: PaiReportKind[] = ["cashLoad", "simpleSummary", "fundsMovement"];
  return kinds.filter((k) => resolvePaiDateFieldName(k, reportConfig).usingDefault);
}

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
  dateRange?: PaiDateRange | null,
  /**
   * The SPECIFIC report GUID to download (Michael's saved reportSelection[kind]).
   * When set, `&ReportGUID=<guid>` is appended so PAI serves exactly that report
   * — essential when two reports share a name (e.g. the two "Funds Movement By
   * Account By Day"). When absent, the per-kind .event path's default is used.
   */
  reportGuid?: string | null,
): PaiReportPlan {
  const base = (baseUrl ?? "").trim() || PAI_DEFAULT_BASE;
  const event = PAI_REPORT_EVENT[kind];
  // The chosen report's GUID fragment, appended to every URL when present.
  const guid = (reportGuid ?? "").trim();
  const guidFragment = guid === "" ? "" : `&ReportGUID=${encodeURIComponent(guid)}`;

  const configured =
    reportConfig && typeof reportConfig.customCmdList === "string"
      ? (reportConfig.customCmdList as string).trim()
      : "";
  const customCmdList = configured !== "" ? configured : PAI_DEFAULT_CUSTOM_CMD;
  const usingDefaultCustomCmd = configured === "";

  // Base filter URL (open the report as currently configured in the portal).
  let filterUrl = `${joinUrl(base, event)}?ReportCmd=Filter${guidFragment}`;
  let dateFilterApplied = false;
  let usingDefaultDateField = false;

  // The date-filter query fragment (e.g. "&F_SettlementDate=02%2F29%2F2024...").
  // Built once and appended to BOTH the filter URL and the combined download URL
  // so the filter travels WITH the CSV request (see combinedUrl below).
  let dateFilterFragment = "";

  // Apply a date range ONLY when one is explicitly requested (history/backfill).
  // The normal daily pull passes no range → identical to today's working path.
  // PAI expects ONE field holding a range string "MM/DD/YYYY - MM/DD/YYYY".
  if (dateRange) {
    const rangeValue = buildPaiRangeValue(dateRange);
    if (rangeValue !== "") {
      const field = resolvePaiDateFieldName(kind, reportConfig);
      dateFilterFragment = `&${encodeURIComponent(field.name)}=${encodeURIComponent(rangeValue)}`;
      filterUrl += dateFilterFragment;
      dateFilterApplied = true;
      usingDefaultDateField = field.usingDefault;
    }
  }

  const downloadUrl =
    `${joinUrl(base, event)}?ReportCmd=CustomCommand` +
    `&CustomCmdList=${encodeURIComponent(customCmdList)}` +
    guidFragment;

  // COMBINED URL — the ROBUST, documented pattern from PAI's official SDK
  // (gopai/reporting-sdk PAIClient.retrieveReportUsingBuilder): the SAME request
  // carries BOTH ReportCmd=Filter AND ReportCmd=CustomCommand&CustomCmdList=...
  // AND the F_<Column> filter. Sending the filter in a SEPARATE request (as we
  // did before) relied on PAI persisting the last filter in the session — which
  // happened to work for one report but not the others. Combining them makes the
  // date filter travel WITH the CSV download for every report.
  const combinedUrl =
    `${joinUrl(base, event)}?ReportCmd=Filter&ReportCmd=CustomCommand` +
    `&CustomCmdList=${encodeURIComponent(customCmdList)}` +
    dateFilterFragment +
    guidFragment;

  return {
    kind,
    filterUrl,
    downloadUrl,
    combinedUrl,
    customCmdList,
    usingDefaultCustomCmd,
    dateFilterApplied,
    usingDefaultDateField,
  };
}

/**
 * All three report plans at once (the sync pulls all three).
 *
 * `reportGuids` is Michael's saved per-kind report GUID (from
 * report_config.reportSelection[kind].reportGuid). When present for a kind,
 * that GUID is pinned onto the URLs so PAI serves EXACTLY that report — this is
 * essential when two reports share a name (e.g. the two "Funds Movement By
 * Account By Day"). Parsing lives in the caller (pai-client) to keep this leaf
 * module free of imports and avoid a circular dependency with pai-discovery.
 */
export function resolveAllPaiReportPlans(
  baseUrl: string | null | undefined,
  reportConfig?: Record<string, unknown> | null,
  dateRange?: PaiDateRange | null,
  reportGuids?: Partial<Record<PaiReportKind, string | null | undefined>> | null,
): Record<PaiReportKind, PaiReportPlan> {
  const guids = reportGuids ?? {};
  return {
    cashLoad: resolvePaiReportPlan("cashLoad", baseUrl, reportConfig, dateRange, guids.cashLoad),
    simpleSummary: resolvePaiReportPlan("simpleSummary", baseUrl, reportConfig, dateRange, guids.simpleSummary),
    fundsMovement: resolvePaiReportPlan("fundsMovement", baseUrl, reportConfig, dateRange, guids.fundsMovement),
  };
}

/**
 * Compute the history window to request from PAI: from the connection's earliest
 * available date (report_config.historyStart, default PAI_DEFAULT_HISTORY_START =
 * 2024-02-29) through `today`. `today` is injectable for testing. Returns ISO dates.
 * If the resolved start is somehow after today, it clamps to a single-day window.
 */
export function computePaiHistoryRange(
  today: Date,
  reportConfig?: Record<string, unknown> | null,
): PaiDateRange {
  const toIso = today.toISOString().slice(0, 10);
  const fromIso = resolvePaiHistoryStart(reportConfig);
  // Guard: never emit a backwards range.
  return { from: fromIso <= toIso ? fromIso : toIso, to: toIso };
}

/**
 * The default number of days the DAILY sync looks back. Settlements land T+1
 * (and later across weekends/holidays), and the ingest is an idempotent upsert,
 * so a generous overlapping window is both safe and cheap \u2014 re-pulled days just
 * overwrite identical rows. 45 days comfortably covers any settlement lag while
 * staying far smaller than the full-history backfill.
 */
export const PAI_SYNC_LOOKBACK_DAYS = 45;

/**
 * Compute the DAILY-sync window: a rolling `daysBack`-day window ending `today`.
 * This is the fix for "Sync is broken but Backfill works" \u2014 the daily sync used
 * to send NO date range, so PAI silently returned only its narrow default window
 * and the data looked stale. Now the daily sync pulls a real recent window using
 * the same confirmed date-field names the backfill uses. `today` is injectable
 * for testing. Returns ISO dates; never emits a backwards range.
 */
export function computePaiRecentRange(
  today: Date,
  daysBack: number = PAI_SYNC_LOOKBACK_DAYS,
): PaiDateRange {
  const toIso = today.toISOString().slice(0, 10);
  const back = Number.isFinite(daysBack) && daysBack > 0 ? Math.floor(daysBack) : 0;
  const fromMs = today.getTime() - back * 24 * 60 * 60 * 1000;
  const fromIso = new Date(fromMs).toISOString().slice(0, 10);
  return { from: fromIso <= toIso ? fromIso : toIso, to: toIso };
}

/**
 * Read the earliest history date (ISO yyyy-mm-dd) from report_config.historyStart.
 * Falls back to PAI_DEFAULT_HISTORY_START. Validates the shape so a typo can't
 * inject a malformed value into the request.
 */
export function resolvePaiHistoryStart(reportConfig?: Record<string, unknown> | null): string {
  const raw = reportConfig?.historyStart;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return PAI_DEFAULT_HISTORY_START;
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

  // --- Date-range / history backfill (capture-gated) -----------------------

  // No range → today's exact behavior: no date filter on the URL, flags false.
  assert(ss.dateFilterApplied === false, "no range → no date filter applied");
  assert(ss.usingDefaultDateField === false, "no range → not using default date field");
  assert(!ss.filterUrl.includes("F_"), "no range → no F_ param on filterUrl");

  // formatPaiDate: ISO → M/D/YYYY (portal renders zero-padded MM/DD/YYYY).
  assert(formatPaiDate("2024-02-29") === "02/29/2024", "formatPaiDate leap day");
  assert(formatPaiDate("2026-08-11") === "08/11/2026", "formatPaiDate normal");
  assert(formatPaiDate("garbage") === "", "formatPaiDate bad input → empty");
  assert(formatPaiDate(null) === "", "formatPaiDate null → empty");

  // buildPaiRangeValue: confirmed "MM/DD/YYYY - MM/DD/YYYY" format.
  assert(
    buildPaiRangeValue({ from: "2024-02-29", to: "2026-08-11" }) === "02/29/2024 - 08/11/2026",
    "range value matches confirmed portal format",
  );
  assert(buildPaiRangeValue({ from: "bad", to: "2026-08-11" }) === "", "bad from → empty range value");

  // With a range → ONE field with the range string, using the SDK-default name.
  const ranged = resolvePaiReportPlan("simpleSummary", null, null, { from: "2024-02-29", to: "2026-08-11" });
  assert(ranged.dateFilterApplied === true, "range → date filter applied");
  assert(ranged.usingDefaultDateField === true, "range → flags unverified default field name");
  // Single field F_SettlementDate = "02/29/2024 - 08/11/2026" (URL-encoded).
  assert(
    ranged.filterUrl.includes(`F_SettlementDate=${encodeURIComponent("02/29/2024 - 08/11/2026")}`),
    "range → single settlement-date field with range string",
  );
  assert(!ranged.filterUrl.includes("F_SettlementDateFrom"), "range → NOT two From/To fields");
  assert(
    ranged.filterUrl.startsWith("https://www.paireports.com/myreports/GetTerminalTrxDataReport.event?ReportCmd=Filter"),
    "range → keeps ReportCmd=Filter base",
  );

  // cashLoad filters on Trx Time → F_TrxTime (single field).
  const clRange = resolvePaiReportPlan("cashLoad", null, null, { from: "2024-02-29", to: "2026-08-11" });
  assert(
    clRange.filterUrl.includes(`F_TrxTime=${encodeURIComponent("02/29/2024 - 08/11/2026")}`),
    "cashLoad Trx Time single field with range string",
  );

  // Malformed range is ignored (safety — never send a bad filter value).
  const bad = resolvePaiReportPlan("simpleSummary", null, null, { from: "nope", to: "2026-08-11" });
  assert(bad.dateFilterApplied === false, "bad range ignored (no filter applied)");

  // report_config can OVERRIDE the field name (STRING form) → clears default flag.
  const nameOverride = resolvePaiReportPlan(
    "simpleSummary",
    null,
    { dateFieldName: "SettlementDate" },
    { from: "2024-02-29", to: "2026-08-11" },
  );
  assert(nameOverride.usingDefaultDateField === false, "captured field name clears default flag");
  assert(
    nameOverride.filterUrl.includes(`SettlementDate=${encodeURIComponent("02/29/2024 - 08/11/2026")}`),
    "captured field name used",
  );

  // PER-REPORT override (OBJECT form) — each report can carry its own confirmed
  // filter field name. This is the fix for Bank Deposits / Cash Loads returning
  // only PAI's default window because their real filter column differs.
  const perReportCfg = {
    dateFieldName: { fundsMovement: "F_PostDate", cashLoad: "F_TrxDate" },
  };
  const fmPer = resolvePaiReportPlan("fundsMovement", null, perReportCfg, { from: "2024-02-29", to: "2026-08-11" });
  assert(fmPer.usingDefaultDateField === false, "per-report override clears default flag (fundsMovement)");
  assert(
    fmPer.combinedUrl.includes(`F_PostDate=${encodeURIComponent("02/29/2024 - 08/11/2026")}`),
    "per-report fundsMovement field name used in combinedUrl",
  );
  const clPer = resolvePaiReportPlan("cashLoad", null, perReportCfg, { from: "2024-02-29", to: "2026-08-11" });
  assert(
    clPer.combinedUrl.includes(`F_TrxDate=${encodeURIComponent("02/29/2024 - 08/11/2026")}`),
    "per-report cashLoad field name used in combinedUrl",
  );
  // A report NOT listed in the per-report object falls back to the default name.
  const ssPer = resolvePaiReportPlan("simpleSummary", null, perReportCfg, { from: "2024-02-29", to: "2026-08-11" });
  assert(ssPer.usingDefaultDateField === true, "report not in per-report object → default field name");

  // resolvePaiDateFieldName: per-report object override + string override + default.
  const fnObj = resolvePaiDateFieldName("fundsMovement", { dateFieldName: { fundsMovement: "F_X" } });
  assert(fnObj.name === "F_X" && !fnObj.usingDefault, "per-report object override on resolvePaiDateFieldName");
  const fnStr = resolvePaiDateFieldName("cashLoad", { dateFieldName: "F_Y" });
  assert(fnStr.name === "F_Y" && !fnStr.usingDefault, "string override applies to any report");

  // --- combinedUrl: the robust single-request pattern (PAI official SDK) ------

  // Default (no range): combinedUrl carries Filter + CustomCommand together.
  assert(
    ss.combinedUrl ===
      "https://www.paireports.com/myreports/GetTerminalTrxDataReport.event?ReportCmd=Filter&ReportCmd=CustomCommand&CustomCmdList=DownloadCSV",
    "combinedUrl default = Filter + CustomCommand in one URL",
  );
  // With a range: combinedUrl ALSO carries the F_<Column> date filter.
  assert(
    ranged.combinedUrl.includes("ReportCmd=Filter&ReportCmd=CustomCommand") &&
      ranged.combinedUrl.includes(`F_SettlementDate=${encodeURIComponent("02/29/2024 - 08/11/2026")}`),
    "combinedUrl with range carries filter + command together",
  );

  // --- reportGuid pinning: serve EXACTLY the saved report --------------------
  // Two reports can share a name (the two "Funds Movement By Account By Day");
  // pinning &ReportGUID=<guid> makes PAI serve the exact one Michael picked.

  // No guid (undefined/empty/whitespace) → NO ReportGUID param anywhere.
  assert(!ss.combinedUrl.includes("ReportGUID"), "no guid → no ReportGUID on combinedUrl");
  assert(!ss.filterUrl.includes("ReportGUID"), "no guid → no ReportGUID on filterUrl");
  assert(!ss.downloadUrl.includes("ReportGUID"), "no guid → no ReportGUID on downloadUrl");
  const emptyGuid = resolvePaiReportPlan("fundsMovement", null, null, null, "   ");
  assert(!emptyGuid.combinedUrl.includes("ReportGUID"), "whitespace guid → no ReportGUID (trimmed to empty)");

  // A concrete guid is appended to ALL THREE urls, URL-encoded.
  const pinned = resolvePaiReportPlan("fundsMovement", null, null, null, "G-abc 123");
  const encGuid = encodeURIComponent("G-abc 123");
  assert(pinned.combinedUrl.includes(`&ReportGUID=${encGuid}`), "guid appended to combinedUrl (encoded)");
  assert(pinned.filterUrl.includes(`&ReportGUID=${encGuid}`), "guid appended to filterUrl (encoded)");
  assert(pinned.downloadUrl.includes(`&ReportGUID=${encGuid}`), "guid appended to downloadUrl (encoded)");

  // With BOTH a date range and a guid, combinedUrl carries filter + command + guid.
  const pinnedRanged = resolvePaiReportPlan(
    "fundsMovement",
    null,
    null,
    { from: "2024-02-29", to: "2026-08-11" },
    "G-xyz",
  );
  assert(
    pinnedRanged.combinedUrl.includes("ReportCmd=Filter&ReportCmd=CustomCommand") &&
      pinnedRanged.combinedUrl.includes("F_SettlementDate=") &&
      pinnedRanged.combinedUrl.includes("&ReportGUID=G-xyz"),
    "combinedUrl carries filter + command + guid together",
  );

  // resolveAllPaiReportPlans threads the per-kind guid map onto each plan.
  const allPinned = resolveAllPaiReportPlans(null, null, null, {
    cashLoad: "G-cash",
    simpleSummary: "",
    fundsMovement: "G-funds",
  });
  assert(allPinned.cashLoad.combinedUrl.includes("&ReportGUID=G-cash"), "resolveAll pins cashLoad guid");
  assert(allPinned.fundsMovement.combinedUrl.includes("&ReportGUID=G-funds"), "resolveAll pins fundsMovement guid");
  assert(!allPinned.simpleSummary.combinedUrl.includes("ReportGUID"), "resolveAll: empty guid → no pin");
  // No guid map at all → identical to the byte-for-byte proven path (no pins).
  const allDefault = resolveAllPaiReportPlans(null, null, null);
  assert(!allDefault.cashLoad.combinedUrl.includes("ReportGUID"), "resolveAll no map → no pins (cashLoad)");
  assert(!allDefault.fundsMovement.combinedUrl.includes("ReportGUID"), "resolveAll no map → no pins (fundsMovement)");

  // resolvePaiDateFieldName convention + override.
  const fn = resolvePaiDateFieldName("fundsMovement", null);
  assert(fn.name === "F_SettlementDate" && fn.usingDefault, "date field default convention");
  const fno = resolvePaiDateFieldName("fundsMovement", { dateFieldName: "X" });
  assert(fno.name === "X" && !fno.usingDefault, "date field override");

  // computePaiHistoryRange: starts at the confirmed earliest date, ends today.
  const range = computePaiHistoryRange(new Date("2026-08-11T00:00:00Z"), null);
  assert(range.to === "2026-08-11", "history range ends today");
  assert(range.from === "2024-02-29", "history range starts at confirmed 2/29/2024");

  // computePaiRecentRange: rolling window ending today (the daily-sync fix).
  const recent = computePaiRecentRange(new Date("2026-08-15T00:00:00Z"), 45);
  assert(recent.to === "2026-08-15", "recent range ends today");
  assert(recent.from === "2026-07-01", "recent range starts 45 days back");
  assert(recent.from <= recent.to, "recent range never backwards");
  // Default lookback is the documented constant.
  const recentDefault = computePaiRecentRange(new Date("2026-08-15T00:00:00Z"));
  assert(
    recentDefault.from === computePaiRecentRange(new Date("2026-08-15T00:00:00Z"), PAI_SYNC_LOOKBACK_DAYS).from,
    "recent range default = PAI_SYNC_LOOKBACK_DAYS",
  );
  // A 0/negative/garbage lookback collapses to a single-day window (never backwards).
  assert(
    computePaiRecentRange(new Date("2026-08-15T00:00:00Z"), 0).from === "2026-08-15",
    "zero lookback \u21d2 single-day window",
  );
  assert(
    computePaiRecentRange(new Date("2026-08-15T00:00:00Z"), -7).from === "2026-08-15",
    "negative lookback \u21d2 single-day window",
  );
  // Month boundary: 45 days back from mid-March crosses into late January correctly.
  const mar = computePaiRecentRange(new Date("2026-03-15T00:00:00Z"), 45);
  assert(mar.from === "2026-01-29" && mar.to === "2026-03-15", "recent range crosses month boundary");

  // resolvePaiHistoryStart: config override + fallback + validation.
  assert(resolvePaiHistoryStart(null) === PAI_DEFAULT_HISTORY_START, "history start default 2024-02-29");
  assert(resolvePaiHistoryStart({ historyStart: "2023-01-01" }) === "2023-01-01", "history start from config");
  assert(resolvePaiHistoryStart({ historyStart: "not-a-date" }) === PAI_DEFAULT_HISTORY_START, "invalid start → default");
  assert(resolvePaiHistoryStart({ historyStart: 20240229 }) === PAI_DEFAULT_HISTORY_START, "non-string start → default");

  // --- Universal GUID download body (PAI SDK: POST Report.event) -------------
  assert(PAI_REPORT_EVENT_UNIVERSAL === "Report.event", "universal report event path");
  // Default: GUID + Filter + CustomCommand + DownloadCSV, no F_/E_ pairs.
  const body = buildPaiGuidDownloadBody("G-123");
  const bp = new URLSearchParams(body);
  assert(bp.get("ReportGUID") === "G-123", "guid body carries the ReportGUID");
  assert(bp.getAll("ReportCmd").join(",") === "Filter,CustomCommand", "guid body carries both ReportCmd values in order");
  assert(bp.get("CustomCmdList") === "DownloadCSV", "guid body defaults to DownloadCSV");
  assert(!body.includes("F_"), "guid body has no filter when none requested");
  // Custom command override.
  assert(new URLSearchParams(buildPaiGuidDownloadBody("G", { customCmdList: "OpenCSV" })).get("CustomCmdList") === "OpenCSV", "guid body honors customCmdList override");
  // Blank/whitespace command falls back to the default.
  assert(new URLSearchParams(buildPaiGuidDownloadBody("G", { customCmdList: "   " })).get("CustomCmdList") === "DownloadCSV", "guid body blank cmd → DownloadCSV");
  // A filter adds F_<Col>=<value> and E_<Col>=false (keep the column). Spaces preserved (encoded).
  const filtered = buildPaiGuidDownloadBody("G", { filters: [{ column: "Settlement Date", value: "02/29/2024 - 08/11/2026" }] });
  const fp = new URLSearchParams(filtered);
  assert(fp.get("F_Settlement Date") === "02/29/2024 - 08/11/2026", "guid body filter adds F_<Col>=<value>");
  assert(fp.get("E_Settlement Date") === "false", "guid body filter adds E_<Col>=false (keep column)");
  // Empty-column filters are skipped (never send a bogus F_).
  assert(!buildPaiGuidDownloadBody("G", { filters: [{ column: "  ", value: "x" }] }).includes("F_"), "guid body skips blank-column filter");
  // Trims the GUID.
  assert(new URLSearchParams(buildPaiGuidDownloadBody("  G-9  ")).get("ReportGUID") === "G-9", "guid body trims the GUID");

  // --- Per-report GET download URL by GUID (proven .event path) -------------
  const gurl = buildPaiGuidDownloadUrl(PAI_DEFAULT_BASE, PAI_REPORT_EVENT.simpleSummary, "G-SS");
  assert(
    gurl.startsWith("https://www.paireports.com/myreports/GetTerminalTrxDataReport.event?ReportCmd=Filter&ReportCmd=CustomCommand"),
    "guid GET url uses the per-kind .event path + Filter/CustomCommand",
  );
  assert(gurl.includes("CustomCmdList=DownloadCSV"), "guid GET url defaults to DownloadCSV");
  assert(gurl.endsWith("&ReportGUID=G-SS"), "guid GET url pins the candidate by GUID");
  // Custom command respected; GUID trimmed + URL-encoded.
  assert(buildPaiGuidDownloadUrl(PAI_DEFAULT_BASE, "X.event", "  a b  ", { customCmdList: "OpenCSV" }).includes("CustomCmdList=OpenCSV"), "guid GET url honors custom cmd");
  assert(buildPaiGuidDownloadUrl(PAI_DEFAULT_BASE, "X.event", "a b").endsWith("ReportGUID=a%20b"), "guid GET url encodes the GUID");
  // No GUID → no ReportGUID param (still a valid report-default download URL).
  assert(!buildPaiGuidDownloadUrl(PAI_DEFAULT_BASE, "X.event", "  ").includes("ReportGUID="), "guid GET url omits empty GUID");

  // reportKindsMissingDateField: which reports still lack a CONFIRMED date column.
  // Nothing saved → ALL three are on the guessed default → all three "missing".
  const missAll = reportKindsMissingDateField(null);
  assert(
    missAll.length === 3 &&
      missAll.includes("cashLoad") &&
      missAll.includes("simpleSummary") &&
      missAll.includes("fundsMovement"),
    "no override → all three reports missing a confirmed date field",
  );
  // A per-report override for one report → only the other two remain missing.
  const missPartial = reportKindsMissingDateField({ dateFieldName: { fundsMovement: "F_Settlement Date" } });
  assert(
    missPartial.length === 2 &&
      missPartial.includes("cashLoad") &&
      missPartial.includes("simpleSummary") &&
      !missPartial.includes("fundsMovement"),
    "one confirmed report → exactly the other two are missing",
  );
  // All three confirmed → none missing.
  const missNone = reportKindsMissingDateField({
    dateFieldName: { cashLoad: "F_Trx Time", simpleSummary: "F_Settlement Date", fundsMovement: "F_Settlement Date" },
  });
  assert(missNone.length === 0, "all three confirmed → none missing");
  // Legacy plain-string override (applies to every report) → none missing.
  const missLegacy = reportKindsMissingDateField({ dateFieldName: "F_Some Column" });
  assert(missLegacy.length === 0, "legacy single-string override → none missing");
  // Reserved "*" key (legacy string preserved by deep-merge) → none missing.
  const missStar = reportKindsMissingDateField({ dateFieldName: { "*": "F_Some Column" } });
  assert(missStar.length === 0, "reserved '*' override applies to every report → none missing");
  // A per-report entry wins over "*" for its own report, and "*" covers the rest.
  const starResolveCl = resolvePaiDateFieldName("cashLoad", {
    dateFieldName: { cashLoad: "F_Trx Time", "*": "F_Fallback" },
  });
  assert(starResolveCl.name === "F_Trx Time" && !starResolveCl.usingDefault, "per-report entry beats '*'");
  const starResolveSs = resolvePaiDateFieldName("simpleSummary", {
    dateFieldName: { cashLoad: "F_Trx Time", "*": "F_Fallback" },
  });
  assert(starResolveSs.name === "F_Fallback" && !starResolveSs.usingDefault, "'*' covers a report with no own entry");

  console.log("pai-endpoints: all self-tests passed");
}
