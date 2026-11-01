/**
 * src/lib/platform/platform-error-store.ts  (slice G-71d, owner message 12)
 *
 * Server side of error alerting (platform-errors-core.ts is the pure logic).
 *
 *   recordRequestError  called by src/instrumentation.ts onRequestError when a
 *                       page, API route or server action crashes.
 *   recordDbRefusal     called by the service-role fetch tap (db-error-tap.ts)
 *                       when PostgREST answers 42501 / 42883 / PGRST202 /
 *                       42P01 / PGRST205, even when the calling code handled it.
 *   countErrorsSince    the 24-hour digest for the daily platform-health email.
 *   listRecentErrors    Settings -> Platform health, Recent errors.
 *
 * Every event is one row in platform_error_events (0333, append-only). After
 * a row is written, the same kind is counted over the last 10 minutes; at the
 * threshold staff get ONE email (and a push) per kind per Pacific hour,
 * claimed first in compliance_reminder_log (rule 12).
 *
 * Deliberate (standing rule 15):
 *   - Uses its OWN service-role client WITHOUT the tap, so a failure to write
 *     the error log can never record itself in a loop.
 *   - Every call reads its error. Nothing here throws to the caller: reporting
 *     an error must never cause one.
 *   - Writes are throttled per server instance (10 per failure, 60 in total per
 *     minute) so an outage cannot flood the database it is reporting on.
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { isSupabaseServiceConfigured, supabaseServiceRoleKey, supabaseUrl } from "@/lib/supabase/env";
import { SUPABASE_DB_OPTIONS } from "@/lib/supabase/db-floor";
import { SUPABASE_GLOBAL_OPTIONS } from "@/lib/supabase/fetch-floor";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import { publicSiteOrigin } from "@/lib/site/site-domain-core";
import { pacificParts } from "@/lib/reports/timezone";
import {
  ALERT_WINDOW_MINUTES,
  ERRORS_TABLE,
  ERROR_KINDS,
  admitEvent,
  buildEventRow,
  errorAlertHtml,
  errorAlertKey,
  errorAlertSubject,
  errorAlertText,
  isControlFlowError,
  kindForDbCode,
  newThrottleState,
  shouldAlert,
  windowStartIso,
  type AlertSample,
  type ErrorCounts,
  type ErrorEventInput,
  type ErrorKind,
} from "./platform-errors-core";

const PAGE = "/admin/settings/platform-health";
const STAGE = "platform_errors";

/** Untapped client (see header). Same floors as the main admin client. */
function errorLogClient() {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: SUPABASE_DB_OPTIONS,
    global: SUPABASE_GLOBAL_OPTIONS,
  });
}
type LogClient = ReturnType<typeof errorLogClient>;

const throttle = newThrottleState();
/** Per-instance fallback when the claim table itself cannot be reached. */
const sentWithoutClaim = new Set<string>();

function staffEmails(): string[] {
  return (process.env.ORDER_STAFF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function pacificHourKey(now: Date): string {
  const p = pacificParts(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}`;
}

async function maybeAlert(db: LogClient, kind: ErrorKind, nowMs: number): Promise<void> {
  const since = windowStartIso(nowMs);
  const { count, error } = await db
    .from(ERRORS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("kind", kind)
    .gte("occurred_at", since);
  if (error) {
    console.error(`[platform-errors] could not count ${kind} (${error.code ?? "?"}): ${error.message}`);
    return;
  }
  const n = count ?? 0;
  if (!shouldAlert(kind, n)) return;

  const key = errorAlertKey(kind, pacificHourKey(new Date(nowMs)));
  const subject = errorAlertSubject(kind, n);
  const to = staffEmails();
  const { error: claimErr } = await db.from("compliance_reminder_log").insert({
    dedupe_key: key,
    stage: STAGE,
    week_key: null,
    channel: "email",
    subject: subject.slice(0, 300),
    recipients: to.join(", ").slice(0, 1000) || "none",
  });
  if (claimErr) {
    if (claimErr.code === "23505") return; // already alerted this hour
    // The claim table may be locked by the very outage we are reporting.
    // Send once per server instance per hour rather than never or always.
    if (sentWithoutClaim.has(key)) return;
    sentWithoutClaim.add(key);
    console.error(`[platform-errors] could not claim ${key} (${claimErr.code ?? "?"}); sending once from this instance`);
  }

  const { data: rows, error: sampleErr } = await db
    .from(ERRORS_TABLE)
    .select("route, code, message, digest, occurred_at")
    .eq("kind", kind)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(10);
  if (sampleErr) console.error(`[platform-errors] could not read samples (${sampleErr.code ?? "?"}): ${sampleErr.message}`);
  const samples = (rows ?? []) as AlertSample[];
  const pageUrl = `${publicSiteOrigin(process.env)}${PAGE}`;

  let delivered = false;
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ORDER_EMAIL_FROM ?? "";
  if (apiKey && from && to.length > 0) {
    const r = await sendStaffAlertEmail({ apiKey, from, to, subject, html: errorAlertHtml(kind, n, samples, pageUrl) });
    if (r.ok) delivered = true;
    else console.error(`[platform-errors] alert email failed: ${r.detail}`);
  }
  try {
    const push = await import("@/lib/notifications/push");
    if (push.isPushConfigured()) {
      const sent = await push.sendPushToAll({ title: subject, body: errorAlertText(kind, n, samples).slice(0, 300), url: PAGE, tag: `platform-errors-${kind}` });
      if (sent > 0) delivered = true;
    }
  } catch (e) {
    console.error(`[platform-errors] push failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!delivered && !claimErr) {
    // Release so the next event this hour can try again (same as the ACH crons).
    const { error: relErr } = await db.from("compliance_reminder_log").delete().eq("dedupe_key", key);
    if (relErr) console.error(`[platform-errors] could not release ${key} (${relErr.code ?? "?"}): ${relErr.message}`);
  }
}

async function record(input: ErrorEventInput): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const row = buildEventRow(input);
  const nowMs = Date.now();
  if (!admitEvent(throttle, row.fingerprint, nowMs)) return;
  try {
    const db = errorLogClient();
    const { error } = await db.from(ERRORS_TABLE).insert({ ...row, occurred_at: new Date(nowMs).toISOString() });
    if (error) {
      console.error(`[platform-errors] could not record (${error.code ?? "?"}): ${error.message}`);
      return;
    }
    await maybeAlert(db, row.kind, nowMs);
  } catch (e) {
    console.error(`[platform-errors] ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** From src/instrumentation.ts. Never throws. */
export async function recordRequestError(
  err: unknown,
  request: { path?: string; method?: string },
  context: { routeType?: string; routePath?: string },
): Promise<void> {
  const e = (err ?? {}) as { digest?: unknown; message?: unknown };
  if (isControlFlowError(e)) return;
  await record({
    kind: "server_error",
    source: "request",
    code: typeof context?.routeType === "string" ? context.routeType : null,
    route: context?.routePath || request?.path || "/",
    method: request?.method ?? null,
    message: typeof e.message === "string" ? e.message : String(err),
    digest: typeof e.digest === "string" ? e.digest : null,
  });
}

/** From the service-role fetch tap. Never throws. */
export async function recordDbRefusal(code: string, object: string, method: string | null, message: string): Promise<void> {
  const kind = kindForDbCode(code);
  if (!kind) return;
  await record({ kind, source: "db", code, route: object, method, message, digest: null });
}

/** Counts per kind since an instant, for the daily digest. */
export async function countErrorsSince(sinceIso: string): Promise<{ counts: ErrorCounts | null; error: { code: string | null; message: string } | null }> {
  if (!isSupabaseServiceConfigured) return { counts: null, error: null };
  try {
    const db = errorLogClient();
    const counts: ErrorCounts = { db_permission: 0, db_missing: 0, server_error: 0 };
    for (const k of ERROR_KINDS) {
      const { count, error } = await db.from(ERRORS_TABLE).select("id", { count: "exact", head: true }).eq("kind", k).gte("occurred_at", sinceIso);
      if (error) return { counts: null, error: { code: error.code ?? null, message: error.message } };
      counts[k] = count ?? 0;
    }
    return { counts, error: null };
  } catch (e) {
    return { counts: null, error: { code: null, message: e instanceof Error ? e.message : String(e) } };
  }
}

export type ErrorEventListRow = {
  id: string;
  occurred_at: string;
  kind: ErrorKind;
  source: "request" | "db";
  code: string | null;
  route: string;
  method: string | null;
  message: string;
  digest: string | null;
};

export async function listRecentErrors(limit = 50): Promise<{ rows: ErrorEventListRow[]; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { rows: [], error: "Supabase is not configured." };
  try {
    const db = errorLogClient();
    const { data, error } = await db
      .from(ERRORS_TABLE)
      .select("id, occurred_at, kind, source, code, route, method, message, digest")
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (error) {
      const hint =
        error.code === "42P01" || error.code === "PGRST205"
          ? "Error alerting is not installed yet: run supabase/migrations/0333_platform_error_events.sql."
          : error.code === "42501"
            ? "The server cannot read the error log: run 0330_service_role_grants.sql, then 0333_platform_error_events.sql."
            : `Could not load errors (${error.code ?? "?"}): ${error.message}`;
      return { rows: [], error: hint };
    }
    return { rows: (data ?? []) as ErrorEventListRow[], error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export { ALERT_WINDOW_MINUTES };
