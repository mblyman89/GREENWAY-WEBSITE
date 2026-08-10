/**
 * src/lib/atm/pai-client.ts — ATM/PAI Slice A-2c-2 (server-only)
 *
 * The secure engine that logs into paireports.com, downloads a report's CSV,
 * and logs out. Session-cookie API (no OAuth): POST Login.event with
 * Username+Password → JSESSIONID cookie carried on every subsequent request →
 * DoLogout.event at the end. Credentials come DECRYPTED from the vault
 * (getAtmConnectionSecrets) and are used only in-memory here; they are NEVER
 * logged, never returned, never shipped to the browser.
 *
 * WHY THIS IS SAFE TO BUILD NOW (Michael can't reach PAI until Monday):
 *   • The login/session/logout mechanics are documented and identical whether
 *     Michael uses his MAIN login or a future READ-ONLY sub-user — the vault
 *     just stores "a username + password", so swapping later is a data change.
 *   • The three report .event paths are CONFIRMED from Michael's address bar.
 *   • The ONLY unconfirmed bit — the exact CSV custom-command value and the
 *     date-filter field names — is isolated in pai-endpoints.ts as an
 *     OVERRIDABLE default (never a hardcoded guess). Until Michael captures the
 *     real value (DevTools → Network → Form Data), the client fetches the
 *     report AS CURRENTLY CONFIGURED in the portal, with no guessed date filter.
 *
 * STANDING RULES honored:
 *   • NEVER GUESS — no invented endpoints/params; unknowns stay overridable.
 *   • Errors are RETURNED (never thrown to the UI); credentials never leak into
 *     an error string or a log line.
 *   • This module is server-only (import "server-only").
 */
import "server-only";
import { getAtmConnectionSecrets } from "./store";
import {
  resolveAllPaiReportPlans,
  computePaiHistoryRange,
  joinUrl,
  buildPaiGuidDownloadBody,
  buildPaiGuidDownloadUrl,
  PAI_DEFAULT_BASE,
  PAI_REPORT_EVENT,
  PAI_REPORT_EVENT_UNIVERSAL,
  type PaiReportKind,
  type PaiReportPlan,
} from "./pai-endpoints";
import {
  PAI_LIST_CONFIGS_QUERY,
  parseReportConfigIds,
  parseReportFields,
  parseReportSelection,
  resolveReportChoice,
  candidateLabel,
  matchReportConfig,
  buildDiscovery,
  toDateFieldOverride,
  summarizeDiscovery,
  summarizeProbeCsv,
  pickDateField,
  candidateDateFilterKeys,
  measureCsvDateSpan,
  candidateWidensHistory,
  scoreProbeForKind,
  countExpectedColumns,
  PAI_REPORT_COLUMN_TOKENS,
  PAI_REPORT_TITLE_HINTS,
  normalizeName,
  type PaiReportField,
  type PaiReportDiscovery,
  type PaiReportConfigId,
  type PaiProbeSummary,
  type PaiReportSelection,
  type PaiCsvDateSpan,
} from "./pai-discovery";

/** How long any single PAI HTTP call may take before we give up (ms). */
const PAI_TIMEOUT_MS = 30_000;
/** A stable, honest User-Agent so PAI sees a real client, not a spoof. */
const PAI_USER_AGENT = "GreenwayBackOffice/1.0 (+https://greenwaymarijuana.com)";

/**
 * The plaintext CSV of one report, or a per-report failure — never throws.
 * Both variants carry the plan's date-filter flags so the caller can build an
 * honest per-report diagnostic (was the backfill date range even applied to
 * this report, and did it use the still-unverified default field name) without
 * re-resolving the plan.
 */
export type PaiReportResult =
  | { ok: true; kind: PaiReportKind; csv: string; dateFilterApplied: boolean; usingDefaultDateField: boolean }
  | { ok: false; kind: PaiReportKind; error: string; dateFilterApplied: boolean; usingDefaultDateField: boolean };

/** The result of a full pull attempt (login → each report → logout). */
export type PaiPullResult =
  | { ok: true; reports: PaiReportResult[] }
  | { ok: false; error: string; reports?: PaiReportResult[] };

/** fetch() with a hard timeout via AbortController (no hanging syncs). */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract the session cookie(s) from a Set-Cookie header and return a compact
 * "name=value; name2=value2" Cookie string for subsequent requests. We keep
 * only the cookie name=value pair (drop path/expires/etc.) which is all a
 * request needs. NEVER logged.
 */
function collectCookies(existing: string, setCookie: string | null): string {
  const jar = new Map<string, string>();
  for (const pair of existing.split(";")) {
    const t = pair.trim();
    if (!t) continue;
    const eq = t.indexOf("=");
    if (eq > 0) jar.set(t.slice(0, eq).trim(), t.slice(eq + 1).trim());
  }
  if (setCookie) {
    // A response may set multiple cookies; split conservatively on comma only
    // when it precedes a "name=" token (avoids splitting Expires date commas).
    const parts = setCookie.split(/,(?=[^;,]+?=)/);
    for (const raw of parts) {
      const first = raw.split(";")[0]?.trim() ?? "";
      const eq = first.indexOf("=");
      if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Full pull: log in, download all three report CSVs, log out. Returns per-report
 * results so a single bad report doesn't sink the others. Never throws; secrets
 * never appear in any returned string.
 */
export async function pullAllPaiReports(options?: {
  /** When true, request the widest history window (backfill) instead of PAI's default. */
  history?: boolean;
}): Promise<PaiPullResult> {
  const secrets = await getAtmConnectionSecrets();
  if (!secrets) {
    return {
      ok: false,
      error:
        "PAI login isn’t saved yet. Add your paireports.com username and password on the " +
        "Connection & health tab first.",
    };
  }

  // History/backfill pull: request from the confirmed earliest date (2/29/2024,
  // overridable via report_config.historyStart) through today. The date VALUE
  // FORMAT is confirmed from Michael's portal; only the form field NAME is the
  // SDK default until captured, which is flagged on the plan and reported
  // honestly. The normal daily pull passes NO range → byte-for-byte identical to
  // today's proven-working path.
  const dateRange = options?.history
    ? computePaiHistoryRange(new Date(), secrets.reportConfig)
    : null;

  // Honor Michael's SAVED report choice per kind: pin its GUID onto the URLs so
  // PAI serves EXACTLY that report (critical when two reports share a name, e.g.
  // the two "Funds Movement By Account By Day"). No saved GUID → PAI's default
  // for that .event path, byte-for-byte identical to today's proven path.
  const savedSelections = parseReportSelection(
    (secrets.reportConfig as Record<string, unknown> | null)?.reportSelection,
  );
  const reportGuids: Partial<Record<PaiReportKind, string | null | undefined>> = {
    cashLoad: savedSelections.cashLoad?.reportGuid,
    simpleSummary: savedSelections.simpleSummary?.reportGuid,
    fundsMovement: savedSelections.fundsMovement?.reportGuid,
  };
  const plans = resolveAllPaiReportPlans(
    secrets.portalBaseUrl,
    secrets.reportConfig,
    dateRange,
    reportGuids,
  );
  const loginUrl = plans.cashLoad.filterUrl.replace(/\/[^/]*\?.*$/, "/Login.event");
  const logoutUrl = loginUrl.replace(/Login\.event$/, "DoLogout.event");

  let cookies = "";

  // 1) LOGIN — POST Username+Password (x-www-form-urlencoded), capture JSESSIONID.
  try {
    const body = new URLSearchParams({
      Username: secrets.username,
      Password: secrets.password,
    }).toString();
    const res = await fetchWithTimeout(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": PAI_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      body,
    });
    cookies = collectCookies(cookies, res.headers.get("set-cookie"));
    if (!cookies.toLowerCase().includes("jsessionid")) {
      // Some deployments set the session on a follow-up; treat "no session at
      // all" as a login failure (wrong creds or portal change) — but NEVER echo
      // the credentials in the error.
      return {
        ok: false,
        error:
          "Couldn’t sign in to PAI. Double-check the saved username and password on the " +
          "Connection & health tab (or PAI may require a captcha/2-step that blocks automatic login).",
      };
    }
  } catch {
    return {
      ok: false,
      error: "Couldn’t reach PAI to sign in (network timeout). Try again, or use the manual CSV import.",
    };
  }

  // 2) DOWNLOAD each report CSV with the session cookie.
  const reports: PaiReportResult[] = [];
  for (const kind of ["cashLoad", "simpleSummary", "fundsMovement"] as PaiReportKind[]) {
    reports.push(await downloadOne(plans[kind], cookies));
  }

  // 3) LOGOUT (best-effort — never fail the pull on a logout hiccup).
  try {
    await fetchWithTimeout(logoutUrl, {
      method: "GET",
      headers: { Cookie: cookies, "User-Agent": PAI_USER_AGENT },
    });
  } catch {
    // ignore — the session will expire on its own.
  }

  const anyOk = reports.some((r) => r.ok);
  if (!anyOk) {
    return { ok: false, error: "Signed in, but no report downloaded successfully.", reports };
  }
  return { ok: true, reports };
}

/** Download one report's CSV using the established session. Never throws. */
async function downloadOne(plan: PaiReportPlan, cookies: string): Promise<PaiReportResult> {
  // Carry the plan's date-filter flags onto every result so the caller can
  // report, per report, whether the backfill range was applied (and whether it
  // used the still-unverified default field name).
  const flags = {
    dateFilterApplied: plan.dateFilterApplied,
    usingDefaultDateField: plan.usingDefaultDateField,
  };
  try {
    // ONE request that carries BOTH ReportCmd=Filter AND the CSV custom command
    // AND the F_<Column> date filter (plan.combinedUrl). This mirrors PAI's
    // official SDK (gopai/reporting-sdk retrieveReportUsingBuilder), where Filter
    // + CustomCommand + F_<Column> are sent together. Sending the filter in a
    // SEPARATE request relied on PAI persisting the last filter in the session,
    // which worked for one report but not the others — combining them makes the
    // date range travel WITH the download for EVERY report.
    const res = await fetchWithTimeout(plan.combinedUrl, {
      method: "GET",
      headers: {
        Cookie: cookies,
        "User-Agent": PAI_USER_AGENT,
        Accept: "text/csv,application/octet-stream,*/*",
      },
    });

    if (res.status < 200 || res.status >= 400) {
      return { ok: false, kind: plan.kind, error: `PAI returned status ${res.status} for this report.`, ...flags };
    }
    const text = await res.text();

    // Honesty guard: if PAI handed back an HTML page (login expired, or the CSV
    // command value differs for this account), do NOT treat it as CSV. This is
    // exactly where the still-to-confirm CustomCmdList value would surface — we
    // fail loudly with a helpful message instead of importing garbage.
    const head = text.slice(0, 200).toLowerCase();
    if (head.includes("<html") || head.includes("<!doctype")) {
      return {
        ok: false,
        kind: plan.kind,
        error:
          "PAI returned a web page instead of a CSV for this report — the CSV download command " +
          "for your account may differ from the default. Capture it once (DevTools → Network → " +
          "the report request → Form Data) and we’ll set it exactly.",
        ...flags,
      };
    }
    if (text.trim() === "") {
      return { ok: false, kind: plan.kind, error: "PAI returned an empty file for this report.", ...flags };
    }
    return { ok: true, kind: plan.kind, csv: text, ...flags };
  } catch {
    return { ok: false, kind: plan.kind, error: "Timed out downloading this report from PAI.", ...flags };
  }
}

// ---------------------------------------------------------------------------
// Slice A-2c-3 — DISCOVER each report's REAL date-filter column (no F12).
//
// This is the no-F12 answer to "why does the filter only work for one report?":
// it asks PAI itself for each report's real column names, exactly the way PAI's
// official example client does (Data API `Query.event` to list report configs,
// then `ReportConfigManagement.event` FIND_CONFIG per report to read its
// fields). It ONLY READS — it never changes anything at PAI and never writes to
// our DB. The caller (a server action) turns confident results into the
// per-report `report_config.dateFieldName` override, which the backfill then
// uses so ALL THREE reports pull full history.
// ---------------------------------------------------------------------------

export type PaiDiscoveryResult =
  | {
      ok: true;
      discoveries: PaiReportDiscovery[];
      /** Confident per-report override ({kind: "F_<Real Name>"}) — may be partial. */
      override: Record<string, string>;
      /** Plain-English, multi-line summary for the UI + audit. */
      summary: string;
    }
  | { ok: false; error: string };

/**
 * Log into PAI, discover each report's real date-filter column name, log out.
 * Never throws; credentials never appear in any returned string. Reuses the
 * same session-cookie mechanics as the report pull.
 */
export async function discoverReportFilterFields(): Promise<PaiDiscoveryResult> {
  const secrets = await getAtmConnectionSecrets();
  if (!secrets) {
    return {
      ok: false,
      error:
        "PAI login isn’t saved yet. Add your paireports.com username and password on the " +
        "Connection & health tab first.",
    };
  }

  const base = (secrets.portalBaseUrl ?? "").trim() || PAI_DEFAULT_BASE;
  const loginUrl = joinUrl(base, "Login.event");
  const logoutUrl = joinUrl(base, "DoLogout.event");
  const queryUrl = joinUrl(base, "Query.event");
  const configUrl = joinUrl(base, "ReportConfigManagement.event");

  let cookies = "";

  // 1) LOGIN (identical mechanics to the report pull).
  try {
    const body = new URLSearchParams({
      Username: secrets.username,
      Password: secrets.password,
    }).toString();
    const res = await fetchWithTimeout(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": PAI_USER_AGENT,
        Accept: "application/json",
      },
      body,
    });
    cookies = collectCookies(cookies, res.headers.get("set-cookie"));
    if (!cookies.toLowerCase().includes("jsessionid")) {
      return {
        ok: false,
        error:
          "Couldn’t sign in to PAI to read your report settings. Double-check the saved username " +
          "and password on the Connection & health tab.",
      };
    }
  } catch {
    return { ok: false, error: "Couldn’t reach PAI to sign in (network timeout). Try again shortly." };
  }

  // 2) LIST report configs via the Data API (SELECT * FROM ReportConfigs).
  let allConfigs: ReturnType<typeof parseReportConfigIds>;
  try {
    const res = await fetchWithTimeout(queryUrl, {
      method: "POST",
      headers: {
        Cookie: cookies,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": PAI_USER_AGENT,
        Accept: "*/*",
      },
      body: new URLSearchParams({ query: PAI_LIST_CONFIGS_QUERY }).toString(),
    });
    const text = await res.text();
    allConfigs = parseReportConfigIds(text);
  } catch {
    allConfigs = [];
  }

  if (allConfigs.length === 0) {
    await bestEffortLogout(logoutUrl, cookies);
    return {
      ok: false,
      error:
        "Signed in to PAI, but its report list came back empty or unreadable. Your login may not have " +
        "Data-API access — tell me and we’ll confirm the right PAI permission.",
    };
  }

  // 3) For each report we care about, if we matched exactly one config row
  //    (either from Michael's saved selection or an unambiguous hint match),
  //    FIND_CONFIG it to read that report's real fields.
  const selections = parseReportSelection(
    (secrets.reportConfig as Record<string, unknown> | null)?.reportSelection,
  );
  const selFor = (kind: PaiReportKind): PaiReportSelection | null => selections[kind] ?? null;
  const kinds: PaiReportKind[] = ["cashLoad", "simpleSummary", "fundsMovement"];
  const fieldsByGuid = new Map<string, PaiReportField[]>();
  for (const kind of kinds) {
    const match = matchReportConfig(kind, allConfigs, selFor(kind));
    if (!match.confident || !match.best) continue; // ambiguous/none → reported, not guessed
    const guid = match.best.reportGuid;
    if (fieldsByGuid.has(guid)) continue;
    try {
      const res = await fetchWithTimeout(configUrl, {
        method: "POST",
        headers: {
          Cookie: cookies,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": PAI_USER_AGENT,
          Accept: "application/json",
        },
        body: new URLSearchParams({ method: "FIND_CONFIG", GUID: guid }).toString(),
      });
      const text = await res.text();
      fieldsByGuid.set(guid, parseReportFields(text));
    } catch {
      fieldsByGuid.set(guid, []);
    }
  }

  // 4) LOGOUT (best-effort).
  await bestEffortLogout(logoutUrl, cookies);

  // 5) Build the per-report discovery (pure) + the confident override.
  const discoveries = kinds.map((kind) => buildDiscovery(kind, allConfigs, fieldsByGuid, selFor(kind)));
  return {
    ok: true,
    discoveries,
    override: toDateFieldOverride(discoveries),
    summary: summarizeDiscovery(discoveries),
  };
}

// ---------------------------------------------------------------------------
// EMPIRICAL date-field verification — the no-guess way to fix full-history.
//
// The FIND_CONFIG discovery came back empty for this account, and we can't be
// certain whether PAI wants "F_Settlement Date" (spaces kept) or
// "F_SettlementDate" (spaces stripped). Rather than GUESS, we PROVE it: for each
// report that still uses the unverified default, we
//   (1) download a BASELINE CSV with NO date range and measure its date span;
//   (2) for each candidate F_ key (both space conventions), download the FULL
//       history window and measure the span;
//   (3) KEEP the first candidate whose span reaches materially further back than
//       the baseline (candidateWidensHistory) — that candidate demonstrably made
//       PAI honor the range. If no candidate widens it, we confirm NOTHING (the
//       caller reports honestly; we never claim a fix that didn't happen).
// Read-only at PAI (downloads only). Never throws; creds never leak.
// ---------------------------------------------------------------------------

/** Per-report outcome of empirical verification (transparent + auditable). */
export type PaiVerifyReport = {
  kind: PaiReportKind;
  /** The proven F_ filter key, or "" when no candidate widened the history. */
  filterKey: string;
  /** The human column name we derived the candidates from (from the CSV header). */
  columnName: string;
  /** Baseline (no-range) span, for the note. */
  baseline: PaiCsvDateSpan;
  /** The winning candidate's span (equals baseline shape when none won). */
  proven: PaiCsvDateSpan | null;
  /** Plain-English note for Michael (what we tried and what happened). */
  note: string;
};

export type PaiVerifyResult =
  | {
      ok: true;
      /** Proven per-report override ({kind: "F_<key>"}) — only keys that WORKED. */
      override: Record<string, string>;
      reports: PaiVerifyReport[];
    }
  | { ok: false; error: string };

/**
 * For each report kind in `kinds`, empirically confirm the date-filter key by
 * proving it widens the returned history. Logs in once, probes, logs out. Only
 * returns keys that DEMONSTRABLY worked. Never throws; never guesses.
 */
export async function verifyDateFieldsByProbe(
  kinds: PaiReportKind[],
): Promise<PaiVerifyResult> {
  const secrets = await getAtmConnectionSecrets();
  if (!secrets) {
    return {
      ok: false,
      error:
        "PAI login isn’t saved yet. Add your paireports.com username and password on the " +
        "Connection & health tab first.",
    };
  }

  // Pin to the saved report GUIDs so we probe the RIGHT report each time.
  const savedSelections = parseReportSelection(
    (secrets.reportConfig as Record<string, unknown> | null)?.reportSelection,
  );
  const reportGuids: Partial<Record<PaiReportKind, string | null | undefined>> = {
    cashLoad: savedSelections.cashLoad?.reportGuid,
    simpleSummary: savedSelections.simpleSummary?.reportGuid,
    fundsMovement: savedSelections.fundsMovement?.reportGuid,
  };

  const fullRange = computePaiHistoryRange(new Date(), secrets.reportConfig);

  // Login URL derived exactly as the pull does (from a default plan's filterUrl).
  const defaultPlans = resolveAllPaiReportPlans(secrets.portalBaseUrl, secrets.reportConfig, null, reportGuids);
  const loginUrl = defaultPlans.cashLoad.filterUrl.replace(/\/[^/]*\?.*$/, "/Login.event");
  const logoutUrl = loginUrl.replace(/Login\.event$/, "DoLogout.event");

  // 1) LOGIN.
  let cookies = "";
  try {
    const res = await fetchWithTimeout(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": PAI_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      body: new URLSearchParams({ Username: secrets.username, Password: secrets.password }).toString(),
    });
    cookies = collectCookies(cookies, res.headers.get("set-cookie"));
    if (!cookies.toLowerCase().includes("jsessionid")) {
      return {
        ok: false,
        error:
          "Couldn’t sign in to PAI to verify your report date columns. Double-check the saved " +
          "username and password on the Connection & health tab.",
      };
    }
  } catch {
    return { ok: false, error: "Couldn’t reach PAI to sign in (network timeout). Try again shortly." };
  }

  const override: Record<string, string> = {};
  const reports: PaiVerifyReport[] = [];

  for (const kind of kinds) {
    // 2) BASELINE — download with NO date range (the proven daily path).
    const baseDl = await downloadOne(defaultPlans[kind], cookies);
    if (!baseDl.ok) {
      reports.push({
        kind,
        filterKey: "",
        columnName: "",
        baseline: { rowCount: 0, from: "", to: "", spanDays: 0 },
        proven: null,
        note: `Couldn’t download a baseline for this report (${baseDl.error}).`,
      });
      continue;
    }
    const baseline = measureCsvDateSpan(kind, baseDl.csv);

    // Derive the real date column name from the baseline CSV header.
    const summary = summarizeProbeCsv(baseDl.csv);
    const headerPick = pickDateField(
      kind,
      summary.columns.map((name) => ({ name, type: "", readonly: false })),
    );
    const columnName = headerPick.fieldName; // e.g. "Settlement Date" (from the real header)
    if (columnName === "") {
      reports.push({
        kind,
        filterKey: "",
        columnName: "",
        baseline,
        proven: null,
        note:
          summary.columns.length > 0
            ? `No single date column in the header (columns: ${summary.columns.join(", ")}).`
            : "The report returned no readable column header.",
      });
      continue;
    }

    // 3) Try each candidate key over the FULL history window; keep the first
    //    that PROVABLY widens the span vs the baseline.
    const candidates = candidateDateFilterKeys(columnName);
    let proven: PaiCsvDateSpan | null = null;
    let provenKey = "";
    const tried: string[] = [];
    for (const key of candidates) {
      const plans = resolveAllPaiReportPlans(
        secrets.portalBaseUrl,
        { ...(secrets.reportConfig as Record<string, unknown> | null), dateFieldName: { [kind]: key } },
        fullRange,
        reportGuids,
      );
      const dl = await downloadOne(plans[kind], cookies);
      if (!dl.ok) {
        tried.push(`${key} (download failed)`);
        continue;
      }
      const span = measureCsvDateSpan(kind, dl.csv);
      tried.push(`${key} → ${span.from || "?"}…${span.to || "?"} (${span.rowCount} rows)`);
      if (candidateWidensHistory(baseline, span)) {
        proven = span;
        provenKey = key;
        break;
      }
    }

    if (provenKey !== "") {
      override[kind] = provenKey;
      reports.push({
        kind,
        filterKey: provenKey,
        columnName,
        baseline,
        proven,
        note:
          `Confirmed ${provenKey}: full history ${proven?.from}…${proven?.to} ` +
          `(${proven?.rowCount} rows) vs baseline ${baseline.from || "?"}…${baseline.to || "?"}.`,
      });
    } else {
      reports.push({
        kind,
        filterKey: "",
        columnName,
        baseline,
        proven: null,
        note:
          `No date-filter key widened this report’s history. Tried: ${tried.join("; ")}. ` +
          `PAI may not accept a range filter for this report via the download URL.`,
      });
    }
  }

  // 4) LOGOUT (best-effort).
  await bestEffortLogout(logoutUrl, cookies);

  return { ok: true, override, reports };
}

/** Best-effort logout — never fails the caller on a logout hiccup. */
async function bestEffortLogout(logoutUrl: string, cookies: string): Promise<void> {
  try {
    await fetchWithTimeout(logoutUrl, {
      method: "GET",
      headers: { Cookie: cookies, "User-Agent": PAI_USER_AGENT },
    });
  } catch {
    // ignore — the session expires on its own.
  }
}

/**
 * Log into PAI and return the enumerated ReportConfigs rows (name + GUID), then
 * log out. Read-only. Returns { ok:false, error } with a friendly message on any
 * failure. Shared by discovery and report selection so both see the SAME list.
 */
async function loginAndListConfigs(): Promise<
  | { ok: true; rows: ReturnType<typeof parseReportConfigIds> }
  | { ok: false; error: string }
> {
  const secrets = await getAtmConnectionSecrets();
  if (!secrets) {
    return {
      ok: false,
      error:
        "PAI login isn’t saved yet. Add your paireports.com username and password on the " +
        "Connection & health tab first.",
    };
  }
  const base = (secrets.portalBaseUrl ?? "").trim() || PAI_DEFAULT_BASE;
  const loginUrl = joinUrl(base, "Login.event");
  const logoutUrl = joinUrl(base, "DoLogout.event");
  const queryUrl = joinUrl(base, "Query.event");

  let cookies = "";
  try {
    const res = await fetchWithTimeout(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": PAI_USER_AGENT,
        Accept: "application/json",
      },
      body: new URLSearchParams({ Username: secrets.username, Password: secrets.password }).toString(),
    });
    cookies = collectCookies(cookies, res.headers.get("set-cookie"));
    if (!cookies.toLowerCase().includes("jsessionid")) {
      return { ok: false, error: "Couldn’t sign in to PAI. Double-check the saved username and password." };
    }
  } catch {
    return { ok: false, error: "Couldn’t reach PAI to sign in (network timeout). Try again shortly." };
  }

  let rows: ReturnType<typeof parseReportConfigIds> = [];
  try {
    const res = await fetchWithTimeout(queryUrl, {
      method: "POST",
      headers: {
        Cookie: cookies,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": PAI_USER_AGENT,
        Accept: "*/*",
      },
      body: new URLSearchParams({ query: PAI_LIST_CONFIGS_QUERY }).toString(),
    });
    rows = parseReportConfigIds(await res.text());
  } catch {
    rows = [];
  }
  await bestEffortLogout(logoutUrl, cookies);

  if (rows.length === 0) {
    return { ok: false, error: "Signed in to PAI, but its report list came back empty or unreadable." };
  }
  return { ok: true, rows };
}

/** Result of resolving a report selection against PAI's live report list. */
export type PaiSelectReportResult =
  | { ok: true; kind: PaiReportKind; selection: PaiReportSelection; chosenLabel: string }
  | { ok: false; error: string };

/**
 * Resolve Michael's chosen report (by exact name and/or GUID) against PAI's live
 * report list and return the `reportSelection[kind]` value to SAVE. NEVER
 * guesses — if the choice doesn't resolve to exactly one report it returns an
 * error. The caller (server action) persists the returned selection into
 * report_config.reportSelection. Read-only against PAI.
 */
export async function selectPaiReport(
  kind: PaiReportKind,
  choice: { reportGuid?: string; name?: string },
): Promise<PaiSelectReportResult> {
  const listed = await loginAndListConfigs();
  if (!listed.ok) return { ok: false, error: listed.error };
  const resolved = resolveReportChoice(listed.rows, choice);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  return { ok: true, kind, selection: resolved.selection, chosenLabel: candidateLabel(resolved.row) };
}

// ---------------------------------------------------------------------------
// PROBE — "try each candidate and show what actually returns data" (no guess).
//
// PAI's official SDK downloads ANY report by its GUID via POST Report.event
// (retrieveReportUsingBuilder). So for a report kind we take every candidate
// report the list matched, download a SMALL sample of each BY GUID, and report
// what came back (rows / columns / date column). Evidence — not a guess — tells
// us which report is the real one. Read-only; downloads a sample only.
// ---------------------------------------------------------------------------

/** One candidate report, plus what probing it actually returned. */
export type PaiProbeCandidate = {
  reportGuid: string;
  name: string;
  externalName: string;
  label: string;
  summary: PaiProbeSummary;
  score: number;
};

export type PaiProbeResult =
  | {
      ok: true;
      kind: PaiReportKind;
      /** Candidates, ranked best-first (most data + a date column at the top). */
      candidates: PaiProbeCandidate[];
      /** The single clear winner when exactly one candidate ranked strictly highest. */
      autoWinner: PaiProbeCandidate | null;
      /** Plain-English, multi-line summary for the UI + audit. */
      summary: string;
    }
  | { ok: false; error: string };

/** How many candidates we'll probe for one kind (safety cap on load/time). */
const PAI_PROBE_MAX_CANDIDATES = 14;

/**
 * Probe every candidate report for one kind and rank them by what they return.
 * Downloads a sample of each candidate BY GUID (Report.event) with the SDK's
 * DownloadCSV command and NO date filter (so a wrong date-column name can't hide
 * data). Never throws; secrets never leak into any returned string.
 */
export async function probeReportCandidates(kind: PaiReportKind): Promise<PaiProbeResult> {
  const secrets = await getAtmConnectionSecrets();
  if (!secrets) {
    return {
      ok: false,
      error:
        "PAI login isn’t saved yet. Add your paireports.com username and password on the " +
        "Connection & health tab first.",
    };
  }
  const base = (secrets.portalBaseUrl ?? "").trim() || PAI_DEFAULT_BASE;
  const loginUrl = joinUrl(base, "Login.event");
  const logoutUrl = joinUrl(base, "DoLogout.event");
  const queryUrl = joinUrl(base, "Query.event");
  const reportUrl = joinUrl(base, PAI_REPORT_EVENT_UNIVERSAL);
  // The PER-KIND .event path (the mechanic the working live sync uses). We try
  // this GET path FIRST when probing, because the Simple Summary family only
  // downloads via its per-report .event path (the universal POST returns HTML).
  const perKindEvent = PAI_REPORT_EVENT[kind];
  const customCmd =
    typeof secrets.reportConfig?.customCmdList === "string"
      ? (secrets.reportConfig.customCmdList as string).trim()
      : "";

  // 1) LOGIN.
  let cookies = "";
  try {
    const res = await fetchWithTimeout(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": PAI_USER_AGENT,
        Accept: "application/json",
      },
      body: new URLSearchParams({ Username: secrets.username, Password: secrets.password }).toString(),
    });
    cookies = collectCookies(cookies, res.headers.get("set-cookie"));
    if (!cookies.toLowerCase().includes("jsessionid")) {
      return { ok: false, error: "Couldn’t sign in to PAI. Double-check the saved username and password." };
    }
  } catch {
    return { ok: false, error: "Couldn’t reach PAI to sign in (network timeout). Try again shortly." };
  }

  // 2) LIST configs.
  let allConfigs: ReturnType<typeof parseReportConfigIds> = [];
  try {
    const res = await fetchWithTimeout(queryUrl, {
      method: "POST",
      headers: {
        Cookie: cookies,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": PAI_USER_AGENT,
        Accept: "*/*",
      },
      body: new URLSearchParams({ query: PAI_LIST_CONFIGS_QUERY }).toString(),
    });
    allConfigs = parseReportConfigIds(await res.text());
  } catch {
    allConfigs = [];
  }
  if (allConfigs.length === 0) {
    await bestEffortLogout(logoutUrl, cookies);
    return { ok: false, error: "Signed in to PAI, but its report list came back empty or unreadable." };
  }

  // The candidates for this kind = rows whose name matches the kind's hints.
  const hints = PAI_REPORT_TITLE_HINTS[kind];
  const candidateRows: PaiReportConfigId[] = allConfigs.filter((r) => {
    const hay = `${normalizeName(r.name)} ${normalizeName(r.externalName)}`;
    return hints.some((h) => hay.includes(normalizeName(h)));
  });
  if (candidateRows.length === 0) {
    await bestEffortLogout(logoutUrl, cookies);
    return { ok: false, error: `PAI’s report list has no report that looks like “${kind}”.` };
  }

  // 3) PROBE each candidate by GUID (capped), summarize its CSV.
  //    Try the PROVEN per-kind .event GET path FIRST (what the working live sync
  //    uses — the Simple Summary family only downloads this way); if that didn't
  //    return usable CSV, fall back to the universal POST Report.event by GUID
  //    (what Funds Movement / Cash Loads also accept). We keep whichever
  //    actually returned data — evidence, never a guess about which a report
  //    prefers.
  const probed: PaiProbeCandidate[] = [];
  for (const row of candidateRows.slice(0, PAI_PROBE_MAX_CANDIDATES)) {
    // Attempt A — per-kind .event GET path, pinned to this candidate by GUID.
    let csv = "";
    try {
      const res = await fetchWithTimeout(
        buildPaiGuidDownloadUrl(base, perKindEvent, row.reportGuid, { customCmdList: customCmd }),
        {
          method: "GET",
          headers: {
            Cookie: cookies,
            "User-Agent": PAI_USER_AGENT,
            Accept: "text/csv,application/octet-stream,*/*",
          },
        },
      );
      csv = await res.text();
    } catch {
      csv = "";
    }
    let summary = summarizeProbeCsv(csv);

    // Attempt B — universal POST Report.event by GUID, only if A didn't produce data.
    if (!summary.hasData) {
      let csvB = "";
      try {
        const res = await fetchWithTimeout(reportUrl, {
          method: "POST",
          headers: {
            Cookie: cookies,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": PAI_USER_AGENT,
            Accept: "*/*",
          },
          body: buildPaiGuidDownloadBody(row.reportGuid, { customCmdList: customCmd }),
        });
        csvB = await res.text();
      } catch {
        csvB = "";
      }
      const summaryB = summarizeProbeCsv(csvB);
      // Keep whichever attempt FITS the mapper better (column-fit wins; ties keep A).
      if (scoreProbeForKind(kind, summaryB) > scoreProbeForKind(kind, summary)) summary = summaryB;
    }

    probed.push({
      reportGuid: row.reportGuid,
      name: row.name,
      externalName: row.externalName,
      label: candidateLabel(row),
      summary,
      // KIND-AWARE score: which report FITS the mapper's columns, not which is
      // biggest. This stops a raw per-transaction report from beating the daily
      // summary just by returning more rows.
      score: scoreProbeForKind(kind, summary),
    });
  }

  await bestEffortLogout(logoutUrl, cookies);

  // 4) RANK best-first by column-fit score; row count is only a SECONDARY
  //    tiebreak (so among equally-fitting reports the fuller one wins). Stable.
  const ranked = [...probed].sort((a, b) => b.score - a.score || b.summary.rowCount - a.summary.rowCount);
  const top = ranked[0];
  const runnerUp = ranked[1];
  // Expected-column hits for the top candidate — the honest "does this fit?" number.
  const topHits = top ? countExpectedColumns(kind, top.summary.columns) : 0;
  const needed = PAI_REPORT_COLUMN_TOKENS[kind].length;
  // Auto-save ONLY when the top candidate has data AND STRICTLY out-fits the
  // runner-up on expected columns (a clear column-fit lead — never a row-count
  // tie). If two reports fit equally, we do NOT guess — Michael picks.
  const strictlyLeads =
    !!top &&
    top.summary.hasData &&
    topHits >= 2 &&
    (!runnerUp || top.score > runnerUp.score);
  const autoWinner = strictlyLeads ? top : null;

  const lines = ranked.map((c, i) => {
    const hits = countExpectedColumns(kind, c.summary.columns);
    const fit = c.summary.hasData ? `matches ${hits}/${needed} expected columns` : "no data";
    const flag = c.summary.hasData && hits >= 2 ? "✅" : c.summary.hasData ? "•" : c.summary.columns.length > 0 ? "◦" : "✗";
    return `${i + 1}. ${flag} ${c.label} — ${c.summary.note} (${fit})`;
  });
  const header = autoWinner
    ? `Best fit: “${autoWinner.label}” — matches ${topHits}/${needed} of the columns this report needs. Saved it for you.`
    : "No single best fit — pick the one below whose columns match what you expect (higher “expected columns” is better).";
  const summary = `${header}\n${lines.join("\n")}`;

  return { ok: true, kind, candidates: ranked, autoWinner, summary };
}
