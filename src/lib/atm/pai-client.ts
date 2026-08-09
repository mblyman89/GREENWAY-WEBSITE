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
  type PaiReportKind,
  type PaiReportPlan,
} from "./pai-endpoints";

/** How long any single PAI HTTP call may take before we give up (ms). */
const PAI_TIMEOUT_MS = 30_000;
/** A stable, honest User-Agent so PAI sees a real client, not a spoof. */
const PAI_USER_AGENT = "GreenwayBackOffice/1.0 (+https://greenwaymarijuana.com)";

/** The plaintext CSV of one report, or a per-report failure — never throws. */
export type PaiReportResult =
  | { ok: true; kind: PaiReportKind; csv: string }
  | { ok: false; kind: PaiReportKind; error: string };

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
export async function pullAllPaiReports(): Promise<PaiPullResult> {
  const secrets = await getAtmConnectionSecrets();
  if (!secrets) {
    return {
      ok: false,
      error:
        "PAI login isn’t saved yet. Add your paireports.com username and password on the " +
        "Connection & health tab first.",
    };
  }

  const plans = resolveAllPaiReportPlans(secrets.portalBaseUrl, secrets.reportConfig);
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
  try {
    // First establish the report context (ReportCmd=Filter), then request the
    // CSV custom command on the same path — mirrors the portal's own flow
    // (the "Go!" button re-requests the current report with the CSV command).
    await fetchWithTimeout(plan.filterUrl, {
      method: "GET",
      headers: { Cookie: cookies, "User-Agent": PAI_USER_AGENT, Accept: "text/html" },
    });

    const res = await fetchWithTimeout(plan.downloadUrl, {
      method: "GET",
      headers: {
        Cookie: cookies,
        "User-Agent": PAI_USER_AGENT,
        Accept: "text/csv,application/octet-stream,*/*",
      },
    });

    if (res.status < 200 || res.status >= 400) {
      return { ok: false, kind: plan.kind, error: `PAI returned status ${res.status} for this report.` };
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
      };
    }
    if (text.trim() === "") {
      return { ok: false, kind: plan.kind, error: "PAI returned an empty file for this report." };
    }
    return { ok: true, kind: plan.kind, csv: text };
  } catch {
    return { ok: false, kind: plan.kind, error: "Timed out downloading this report from PAI." };
  }
}
