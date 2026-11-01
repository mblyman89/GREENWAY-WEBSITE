/**
 * src/lib/platform/platform-errors-core.ts  (slice G-71d, owner message 12)
 *
 * PURE logic for error alerting (item 4 of the owner message 11 recommendation:
 * "A spike of 'permission denied' or server errors sends you a text or email
 * right away, instead of waiting for a cashier to report it.").
 *
 * Two sources feed one log (public.platform_error_events, 0333):
 *   - "request": an unhandled server error Next.js reports to
 *     src/instrumentation.ts `onRequestError` (a page, API route or server
 *     action that crashed).
 *   - "db": a database refusal the code HANDLED and so never crashed. R-RET
 *     was exactly this: record_customer_return answered 42501, the code showed
 *     a message, and nothing anywhere said "the platform moved". A tap on the
 *     shared Supabase fetch (src/lib/supabase/fetch-floor.ts) sees the
 *     PostgREST error code on service-role calls.
 *
 * Kinds and when they alert (within ALERT_WINDOW_MINUTES):
 *   db_permission  42501                          1st event   (never normal for the server role)
 *   db_missing     42883 PGRST202 42P01 PGRST205  3 events    (a table or function moved)
 *   server_error   onRequestError                 5 events    (one crash can be a bot; five is a pattern)
 * One alert per kind per Pacific hour (missing: per day), claimed in
 * compliance_reminder_log, so a storm sends one email, not hundreds.
 *
 * Nothing here touches the network or the database.
 */
import type { HealthProblem, HealthReport, HealthStatus } from "./db-contract-core";

export const PLATFORM_ERRORS_MIGRATION = "0333_platform_error_events.sql";
export const ERRORS_TABLE = "platform_error_events";
export const ALERT_WINDOW_MINUTES = 10;

export type ErrorKind = "db_permission" | "db_missing" | "server_error";
export type ErrorSource = "request" | "db";

export const ERROR_KINDS: readonly ErrorKind[] = ["db_permission", "db_missing", "server_error"];

export const ALERT_THRESHOLD: Record<ErrorKind, number> = {
  db_permission: 1,
  db_missing: 3,
  server_error: 5,
};

export const KIND_LABEL: Record<ErrorKind, string> = {
  db_permission: "Database refused the server (permission denied)",
  db_missing: "A database table or function the code uses is missing",
  server_error: "Server errors",
};

const PERMISSION_CODES = new Set(["42501"]);
const MISSING_CODES = new Set(["42883", "PGRST202", "42P01", "PGRST205"]);

/** Database codes that mean the platform (grants, schema) moved under the code. */
export function kindForDbCode(code: string | null | undefined): ErrorKind | null {
  if (!code) return null;
  if (PERMISSION_CODES.has(code)) return "db_permission";
  if (MISSING_CODES.has(code)) return "db_missing";
  return null;
}

/**
 * Next.js control flow that travels as a thrown error but is not a failure:
 * redirect(), notFound(), forbidden()/unauthorized(), dynamic bail-outs.
 */
const CONTROL_FLOW_DIGESTS = [
  "NEXT_REDIRECT",
  "NEXT_NOT_FOUND",
  "NEXT_HTTP_ERROR_FALLBACK",
  "DYNAMIC_SERVER_USAGE",
  "BAILOUT_TO_CLIENT_SIDE_RENDERING",
  "NEXT_PRERENDER_INTERRUPTED",
];

export function isControlFlowError(err: { digest?: unknown; message?: unknown } | null | undefined): boolean {
  if (!err) return false;
  const digest = typeof err.digest === "string" ? err.digest : "";
  const message = typeof err.message === "string" ? err.message : "";
  return CONTROL_FLOW_DIGESTS.some((d) => digest.startsWith(d) || message === d || message.startsWith(`${d};`));
}

/**
 * Remove what must never be stored: tokens, keys, emails, long digit runs
 * (cards, phone numbers, license numbers). Then cap the length.
 */
export function scrubMessage(raw: unknown, max = 300): string {
  let s = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : raw == null ? "" : String(raw);
  s = s
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt]")
    .replace(/\b(sk|pk|rk|re|sb)_[A-Za-z0-9_]{12,}/g, "[key]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\d{7,}/g, "[number]")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Route without query string, ids collapsed, so the same failure groups together. */
export function normalizeRoute(raw: unknown): string {
  let s = typeof raw === "string" ? raw : "";
  const q = s.search(/[?#]/);
  if (q >= 0) s = s.slice(0, q);
  s = s
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d+(?=\/|$)/g, "/:n");
  if (!s.startsWith("/")) s = `/${s}`;
  return s.slice(0, 200);
}

/**
 * PostgREST path to the object name: "/rest/v1/rpc/record_customer_return" ->
 * "rpc record_customer_return", "/rest/v1/orders" -> "table orders". Query
 * strings (which can carry customer values) are dropped.
 */
export function dbObjectFromUrl(url: string): string | null {
  const path = url.split(/[?#]/)[0];
  const m = path.match(/\/rest\/v1\/(rpc\/)?([A-Za-z0-9_]+)\/?$/);
  if (!m) return null;
  return m[1] ? `rpc ${m[2]}` : `table ${m[2]}`;
}

export type ErrorEventInput = {
  kind: ErrorKind;
  source: ErrorSource;
  code: string | null;
  route: string;
  method: string | null;
  message: string;
  digest: string | null;
};

export type ErrorEventRow = ErrorEventInput & { fingerprint: string };

export function fingerprintOf(e: Pick<ErrorEventInput, "kind" | "code" | "route">): string {
  return `${e.kind}|${e.code ?? "-"}|${e.route}`.slice(0, 300);
}

export function buildEventRow(e: ErrorEventInput): ErrorEventRow {
  const route = e.source === "db" ? e.route.slice(0, 200) : normalizeRoute(e.route);
  const code = e.code ? e.code.slice(0, 20) : null;
  const method = e.method ? e.method.toUpperCase().slice(0, 10) : null;
  return {
    kind: e.kind,
    source: e.source,
    code,
    route,
    method,
    message: scrubMessage(e.message),
    digest: e.digest ? e.digest.slice(0, 100) : null,
    fingerprint: fingerprintOf({ kind: e.kind, code, route }),
  };
}

/**
 * Per server instance, cap how many rows one failure can write, so an error
 * storm cannot flood the database it is reporting on. Pure: state in, decision out.
 */
export const THROTTLE_PER_FINGERPRINT_PER_MINUTE = 10;
export const THROTTLE_TOTAL_PER_MINUTE = 60;

export type ThrottleState = { minute: number; total: number; perKey: Map<string, number> };

export function newThrottleState(): ThrottleState {
  return { minute: -1, total: 0, perKey: new Map() };
}

export function admitEvent(state: ThrottleState, fingerprint: string, nowMs: number): boolean {
  const minute = Math.floor(nowMs / 60_000);
  if (minute !== state.minute) {
    state.minute = minute;
    state.total = 0;
    state.perKey.clear();
  }
  const n = state.perKey.get(fingerprint) ?? 0;
  if (n >= THROTTLE_PER_FINGERPRINT_PER_MINUTE || state.total >= THROTTLE_TOTAL_PER_MINUTE) return false;
  state.perKey.set(fingerprint, n + 1);
  state.total += 1;
  return true;
}

export function shouldAlert(kind: ErrorKind, countInWindow: number): boolean {
  return countInWindow >= ALERT_THRESHOLD[kind];
}

/**
 * One alert per kind per Pacific hour (`pacificHourKey` is "YYYY-MM-DDTHH").
 * "Missing" is once per Pacific DAY: many screens degrade safely until their
 * migration is run, and an hourly reminder of an unapplied migration is noise.
 */
export function errorAlertKey(kind: ErrorKind, pacificHourKey: string): string {
  const period = kind === "db_missing" ? pacificHourKey.slice(0, 10) : pacificHourKey;
  return `platform-errors:${kind}:${period}`;
}

export function windowStartIso(nowMs: number, minutes = ALERT_WINDOW_MINUTES): string {
  return new Date(nowMs - minutes * 60_000).toISOString();
}

export function fixFor(kind: ErrorKind): string {
  if (kind === "db_permission")
    return "Run supabase/migrations/0330_service_role_grants.sql in the Supabase SQL editor, then press Run check now on Platform health to confirm which object was locked. This is the failure that broke customer returns in October 2026.";
  if (kind === "db_missing")
    return "A migration the code needs is not applied, or a function changed shape. Check docs/MIGRATIONS_TO_RUN.md for anything not yet run, then press Run check now on Platform health.";
  return "Open Platform health, Recent errors, for the page and message, and search the Vercel logs for the digest. If it keeps happening on a money page (register, returns, orders), tell staff to use the paper fallback until fixed.";
}

export type AlertSample = { route: string; code: string | null; message: string; digest: string | null; occurred_at: string };

export function errorAlertSubject(kind: ErrorKind, count: number): string {
  const tag = kind === "server_error" ? "ERRORS" : "ACTION NEEDED";
  return `Greenway ${tag}: ${KIND_LABEL[kind]} (${count} in ${ALERT_WINDOW_MINUTES} min)`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function errorAlertText(kind: ErrorKind, count: number, samples: readonly AlertSample[]): string {
  const where = [...new Set(samples.map((s) => s.route))].slice(0, 5).join(", ");
  return `${count} in the last ${ALERT_WINDOW_MINUTES} minutes${where ? ` (${where})` : ""}. Fix: ${fixFor(kind)}`;
}

export function errorAlertHtml(kind: ErrorKind, count: number, samples: readonly AlertSample[], pageUrl: string): string {
  const items = samples
    .slice(0, 10)
    .map(
      (s) =>
        `<li><strong>${esc(s.route)}</strong>${s.code ? ` (${esc(s.code)})` : ""}: ${esc(s.message || "no message")}${s.digest ? ` <em>digest ${esc(s.digest)}</em>` : ""}</li>`,
    )
    .join("");
  return (
    `<p style="color:#991b1b;font-weight:bold">${esc(KIND_LABEL[kind])}: ${count} in the last ${ALERT_WINDOW_MINUTES} minutes.</p>` +
    (items ? `<ul>${items}</ul>` : "") +
    `<p><em>Fix:</em> ${esc(fixFor(kind))}</p>` +
    `<p>You get at most one of these per kind per ${kind === "db_missing" ? "day" : "hour"}. <a href="${esc(pageUrl)}">Open Platform health</a></p>`
  );
}

// ---------------------------------------------------------------------------
// The 24-hour digest folded into the daily platform-health email (no new cron)
// ---------------------------------------------------------------------------

export type ErrorCounts = Record<ErrorKind, number>;
export type DigestCallError = { code?: string | null; message?: string | null } | null;

/** Server errors in a day above which the daily email warns even without a spike. */
export const DAILY_SERVER_ERROR_WARN = 20;

export function errorDigestProblems(counts: ErrorCounts | null, callError: DigestCallError): HealthProblem[] {
  if (callError) {
    const c = callError.code ?? "";
    if (c === "42P01" || c === "PGRST205")
      return [
        {
          severity: "warn",
          title: "Error alerting is not installed",
          detail: "The error log table does not exist yet, so crashes and database refusals are not being recorded or alerted.",
          fix: `Run supabase/migrations/${PLATFORM_ERRORS_MIGRATION} in the Supabase SQL editor.`,
        },
      ];
    if (c === "42501")
      return [
        {
          severity: "fail",
          title: "The server cannot read the error log",
          detail: "Permission denied on platform_error_events, so error alerts cannot count.",
          fix: `Run 0330_service_role_grants.sql, then ${PLATFORM_ERRORS_MIGRATION}.`,
        },
      ];
    return [
      {
        severity: "warn",
        title: "Could not read the error log",
        detail: `${callError.code ?? "error"}: ${scrubMessage(callError.message ?? "")}`,
        fix: "Press Run check now on Platform health; if it repeats, check the Supabase status page.",
      },
    ];
  }
  if (!counts) return [];
  const out: HealthProblem[] = [];
  if (counts.db_permission > 0)
    out.push({
      severity: "fail",
      title: `The database refused the server ${counts.db_permission} time(s) in the last 24 hours`,
      detail: "Permission denied (42501) on a call the code makes. See Platform health, Recent errors, for which table or function.",
      fix: fixFor("db_permission"),
    });
  if (counts.db_missing > 0)
    out.push({
      severity: "warn",
      title: `${counts.db_missing} call(s) to a missing table or function in the last 24 hours`,
      detail: "The code asked for something the database does not have.",
      fix: fixFor("db_missing"),
    });
  if (counts.server_error >= DAILY_SERVER_ERROR_WARN)
    out.push({
      severity: "warn",
      title: `${counts.server_error} server errors in the last 24 hours`,
      detail: "Pages, API routes or actions crashed. See Platform health, Recent errors.",
      fix: fixFor("server_error"),
    });
  return out;
}

export function mergeErrorDigest(base: HealthReport, counts: ErrorCounts | null, callError: DigestCallError): HealthReport {
  const extra = errorDigestProblems(counts, callError);
  const rank: Record<HealthStatus, number> = { ok: 0, warn: 1, fail: 2 };
  const extraStatus: HealthStatus = extra.some((p) => p.severity === "fail") ? "fail" : extra.length > 0 ? "warn" : "ok";
  const status: HealthStatus = rank[extraStatus] > rank[base.status] ? extraStatus : base.status;
  const line = counts && !callError ? `Last 24 hours: ${counts.server_error} server error(s), ${counts.db_permission + counts.db_missing} database refusal(s).` : "";
  return { status, problems: [...base.problems, ...extra], summary: `${base.summary} ${line}`.trim() };
}

// ---------------------------------------------------------------------------
// Self-tests (PURE; registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPlatformErrorsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`platform-errors-core FAIL: ${name}`);
    }
  };

  ok(kindForDbCode("42501") === "db_permission", "42501 is a permission refusal");
  ok(kindForDbCode("PGRST202") === "db_missing" && kindForDbCode("42883") === "db_missing", "function missing codes");
  ok(kindForDbCode("PGRST205") === "db_missing" && kindForDbCode("42P01") === "db_missing", "table missing codes");
  ok(kindForDbCode("23505") === null, "a duplicate key (claim taken) is normal, not an alert");
  ok(kindForDbCode("P0001") === null && kindForDbCode(null) === null, "business errors and null ignored");

  ok(isControlFlowError({ digest: "NEXT_REDIRECT;replace;/admin;307;" }), "redirect is not a failure");
  ok(isControlFlowError({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" }), "notFound is not a failure");
  ok(isControlFlowError({ message: "NEXT_NOT_FOUND" }), "legacy notFound message");
  ok(!isControlFlowError({ digest: "123456", message: "Cannot read properties of undefined" }), "a real crash is a failure");
  ok(!isControlFlowError(null), "null is not control flow");

  const s = scrubMessage("Bearer abc.def-123 for jane@ex.com card 4111111111111111 key sb_secret_abcdefghijklmnop");
  ok(!s.includes("abc.def") && s.includes("Bearer [redacted]"), "scrub: bearer token");
  ok(!s.includes("jane@ex.com") && s.includes("[email]"), "scrub: email");
  ok(!s.includes("4111111111111111") && s.includes("[number]"), "scrub: card number");
  ok(!s.includes("sb_secret_abcdefghijklmnop"), "scrub: api key");
  ok(scrubMessage("eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4f") === "[jwt]", "scrub: jwt");
  ok(scrubMessage("x".repeat(500)).length === 300, "scrub: capped at 300");
  ok(scrubMessage(new Error("boom")) === "boom" && scrubMessage(undefined) === "", "scrub: Error and undefined");

  ok(normalizeRoute("/admin/orders/3f2a1b4c-1111-2222-3333-444455556666?tab=x") === "/admin/orders/:id", "route: uuid and query");
  ok(normalizeRoute("https://greenway.test/api/x/123/y") === "/api/x/:n/y", "route: origin and number");
  ok(normalizeRoute("") === "/", "route: empty");

  ok(dbObjectFromUrl("https://p.supabase.co/rest/v1/rpc/record_customer_return") === "rpc record_customer_return", "url: rpc");
  ok(dbObjectFromUrl("https://p.supabase.co/rest/v1/orders?select=*&phone=eq.5551234567") === "table orders", "url: table, query dropped");
  ok(dbObjectFromUrl("https://p.supabase.co/auth/v1/user") === null, "url: not PostgREST");

  const row = buildEventRow({ kind: "server_error", source: "request", code: null, route: "/admin/pos/123?x=1", method: "post", message: "boom", digest: "999" });
  ok(row.route === "/admin/pos/:n" && row.method === "POST" && row.fingerprint === "server_error|-|/admin/pos/:n", "row: normalized and fingerprinted");
  const dbRow = buildEventRow({ kind: "db_permission", source: "db", code: "42501", route: "rpc record_customer_return", method: "POST", message: "permission denied", digest: null });
  ok(dbRow.route === "rpc record_customer_return" && dbRow.fingerprint === "db_permission|42501|rpc record_customer_return", "row: db object kept as is");

  const st = newThrottleState();
  let admitted = 0;
  for (let i = 0; i < 25; i++) if (admitEvent(st, "a", 1_000)) admitted++;
  ok(admitted === THROTTLE_PER_FINGERPRINT_PER_MINUTE, "throttle: one failure capped per minute");
  ok(admitEvent(st, "b", 1_000), "throttle: another failure still recorded");
  ok(admitEvent(st, "a", 61_000), "throttle: next minute resets");
  const st2 = newThrottleState();
  let total = 0;
  for (let i = 0; i < 200; i++) if (admitEvent(st2, `k${i}`, 5_000)) total++;
  ok(total === THROTTLE_TOTAL_PER_MINUTE, "throttle: total capped per minute");

  ok(shouldAlert("db_permission", 1), "first permission refusal alerts");
  ok(!shouldAlert("db_missing", 2) && shouldAlert("db_missing", 3), "missing alerts at 3");
  ok(!shouldAlert("server_error", 4) && shouldAlert("server_error", 5), "server errors alert at 5");
  ok(errorAlertKey("db_permission", "2026-11-01T09") === "platform-errors:db_permission:2026-11-01T09", "one alert per kind per hour");
  ok(errorAlertKey("db_missing", "2026-11-01T09") === errorAlertKey("db_missing", "2026-11-01T17"), "missing: one alert per day");
  ok(windowStartIso(Date.parse("2026-11-01T12:00:00Z")) === "2026-11-01T11:50:00.000Z", "window is 10 minutes");

  const samples: AlertSample[] = [{ route: "rpc record_customer_return", code: "42501", message: "<script>x</script>", digest: null, occurred_at: "2026-11-01T12:00:00Z" }];
  const html = errorAlertHtml("db_permission", 1, samples, "https://x.test/admin/settings/platform-health");
  ok(!html.includes("<script>") && html.includes("&lt;script&gt;"), "alert html escaped");
  ok(html.includes("0330_service_role_grants.sql"), "permission alert names the fix");
  ok(errorAlertSubject("db_permission", 1).includes("ACTION NEEDED"), "permission subject is action needed");
  ok(errorAlertText("server_error", 6, samples).includes("rpc record_customer_return"), "text names where");

  const base: HealthReport = { status: "ok", problems: [], summary: "All clear." };
  const zero: ErrorCounts = { db_permission: 0, db_missing: 0, server_error: 3 };
  const m0 = mergeErrorDigest(base, zero, null);
  ok(m0.status === "ok" && m0.summary.includes("3 server error(s)"), "digest: quiet day stays ok, counts shown");
  ok(mergeErrorDigest(base, { ...zero, db_permission: 2 }, null).status === "fail", "digest: a refusal in 24h fails");
  ok(mergeErrorDigest(base, { ...zero, db_missing: 1 }, null).status === "warn", "digest: missing warns");
  ok(mergeErrorDigest(base, { ...zero, server_error: DAILY_SERVER_ERROR_WARN }, null).status === "warn", "digest: many crashes warn");
  ok(mergeErrorDigest(base, null, { code: "PGRST205", message: "" }).problems[0]?.fix.includes("0333"), "digest: not installed -> run 0333");
  ok(mergeErrorDigest(base, null, { code: "42501", message: "" }).status === "fail", "digest: cannot read -> fail");
  const failBase: HealthReport = { status: "fail", problems: [{ severity: "fail", title: "t", detail: "d", fix: "f" }], summary: "x" };
  ok(mergeErrorDigest(failBase, zero, null).status === "fail", "digest: worse status wins");
  ok(ERROR_KINDS.every((k) => KIND_LABEL[k] && ALERT_THRESHOLD[k] >= 1 && fixFor(k).length > 20), "every kind labelled, thresholded, with a fix");

  console.log(`platform-errors-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
