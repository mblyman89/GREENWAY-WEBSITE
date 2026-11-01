/**
 * src/lib/platform/platform-health-store.ts  (slice G-71a, owner message 12)
 *
 * Server-only runner for the daily database health check.
 *
 *   1. Calls public.platform_db_contract_check (0331) with the generated DB
 *      contract (every table and function the code reads or calls).
 *   2. Turns the answer (or the call error) into a plain report
 *      (db-contract-core.ts, pure).
 *   3. Writes one row to platform_health_runs (append-only, 0331).
 *   4. Cron runs only: claims "platform-health:daily:<Pacific day>" in
 *      compliance_reminder_log (UNIQUE) and emails staff once a day: an "all
 *      clear" on good days, an alert with the fix on bad days. Push goes out
 *      only when something is wrong.
 *
 * Every database call is explicit and its error is read (standing rule 15).
 * Nothing here throws; a failure becomes a FAIL report.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import { sendPushToAll, isPushConfigured } from "@/lib/notifications/push";
import { publicSiteOrigin } from "@/lib/site/site-domain-core";
import { pacificToday } from "@/lib/reports/timezone";
import { DB_CONTRACT_FUNCTIONS, DB_CONTRACT_TABLES } from "./db-contract";
import {
  alertHtml,
  alertSubject,
  alertText,
  buildHealthReport,
  dailyAlertKey,
  parseContractCheck,
  reportForCallError,
  shouldSend,
  type HealthReport,
} from "./db-contract-core";
import { MONEY_SMOKE_RPC, mergeSmokeIntoReport, parseSmokeResult } from "./money-smoke-core";
import { mergeErrorDigest } from "./platform-errors-core";
import { countErrorsSince } from "./platform-error-store";

export const PLATFORM_HEALTH_PAGE = "/admin/settings/platform-health";
const RUNS_TABLE = "platform_health_runs";
const CHECK_RPC = "platform_db_contract_check";
const KIND = "db_contract";
const CLAIM_PENDING = "pending";

export type HealthRunRow = {
  id: string;
  kind: string;
  status: "ok" | "warn" | "fail";
  summary: string;
  report: unknown;
  source: "cron" | "manual";
  run_by: string | null;
  created_at: string;
};

export type HealthRunOutcome = {
  report: HealthReport;
  saved: boolean;
  alert: "sent" | "already-sent" | "not-configured" | "skipped" | "failed";
  notes: string[];
};

function staffEmails(): string[] {
  return (process.env.ORDER_STAFF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function runCheck(admin: Admin): Promise<HealthReport> {
  try {
    const { data, error } = await admin.rpc(CHECK_RPC, {
      p_tables: [...DB_CONTRACT_TABLES],
      p_functions: [...DB_CONTRACT_FUNCTIONS],
    });
    if (error) return reportForCallError({ code: error.code, message: error.message });
    const parsed = parseContractCheck(data);
    if (!parsed) return reportForCallError({ code: "BADSHAPE", message: "The check answered in an unexpected shape." });
    return buildHealthReport(parsed);
  } catch (e) {
    return reportForCallError({ code: null, message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * G-71c: the daily money-path test (0332). A till, a sale, a return and a
 * cash drop run as the server and are rolled back inside the database. Its
 * result is folded into the same report, so there is still one email a day.
 */
async function runSmoke(admin: Admin, db: HealthReport): Promise<HealthReport> {
  try {
    const { data, error } = await admin.rpc(MONEY_SMOKE_RPC);
    if (error) return mergeSmokeIntoReport(db, null, { code: error.code, message: error.message });
    return mergeSmokeIntoReport(db, parseSmokeResult(data), null);
  } catch (e) {
    return mergeSmokeIntoReport(db, null, { code: null, message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * G-71d: the last 24 hours of server errors and database refusals
 * (platform_error_events, 0333) folded into the same daily report.
 */
async function addErrorDigest(report: HealthReport): Promise<HealthReport> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { counts, error } = await countErrorsSince(since);
  return mergeErrorDigest(report, counts, error);
}

async function claimDaily(admin: Admin, key: string, subject: string): Promise<"claimed" | "taken" | "error"> {
  try {
    const { error } = await admin.from("compliance_reminder_log").insert({
      dedupe_key: key,
      stage: "platform_health",
      week_key: null,
      channel: "email",
      subject,
      recipients: CLAIM_PENDING,
    });
    if (!error) return "claimed";
    return error.code === "23505" ? "taken" : "error";
  } catch {
    return "error";
  }
}

/**
 * Run the check once. `source: "cron"` also sends the once-a-day message;
 * `source: "manual"` (the admin "Run check now" button) only records the run.
 */
export async function runPlatformHealthCheck(opts: { source: "cron" | "manual"; runBy?: string | null }): Promise<HealthRunOutcome> {
  const notes: string[] = [];
  if (!isSupabaseServiceConfigured) {
    return {
      report: { status: "fail", problems: [], summary: "Supabase is not configured on this deployment." },
      saved: false,
      alert: "skipped",
      notes: ["supabase not configured"],
    };
  }
  const admin = createSupabaseAdminClient();
  const report = await addErrorDigest(await runSmoke(admin, await runCheck(admin)));

  let saved = false;
  try {
    const { error } = await admin.from(RUNS_TABLE).insert({
      kind: KIND,
      status: report.status,
      summary: report.summary.slice(0, 500),
      report,
      source: opts.source,
      run_by: opts.runBy ?? null,
    });
    if (error) notes.push(`could not save the run (${error.code ?? "?"}): ${error.message}`);
    else saved = true;
  } catch (e) {
    notes.push(`could not save the run: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (opts.source !== "cron") return { report, saved, alert: "skipped", notes };

  const day = pacificToday();
  const subject = alertSubject(report, day);
  const claim = await claimDaily(admin, dailyAlertKey(day), subject);
  if (!shouldSend(claim)) return { report, saved, alert: "already-sent", notes };
  if (claim === "error") notes.push("could not claim today's alert row; sending anyway");

  const to = staffEmails();
  const emailOn = Boolean(process.env.RESEND_API_KEY && process.env.ORDER_EMAIL_FROM && to.length > 0);
  const pushOn = report.status !== "ok" && isPushConfigured();
  if (!emailOn && !pushOn) return { report, saved, alert: "not-configured", notes };

  const channels: string[] = [];
  const recipients: string[] = [];
  const pageUrl = `${publicSiteOrigin(process.env)}${PLATFORM_HEALTH_PAGE}`;
  if (emailOn) {
    const r = await sendStaffAlertEmail({
      apiKey: process.env.RESEND_API_KEY ?? "",
      from: process.env.ORDER_EMAIL_FROM ?? "",
      to,
      subject,
      html: alertHtml(report, pageUrl),
    });
    if (r.ok) {
      channels.push("email");
      recipients.push(...to);
    } else notes.push(`email failed: ${r.detail}`);
  }
  if (pushOn) {
    const n = await sendPushToAll({ title: subject, body: alertText(report).slice(0, 300), url: PLATFORM_HEALTH_PAGE, tag: "platform-health" }).catch(() => 0);
    if (n > 0) {
      channels.push("push");
      recipients.push(`${n} push device(s)`);
    } else notes.push("push reached no device");
  }
  if (claim === "claimed" && channels.length > 0) {
    try {
      await admin
        .from("compliance_reminder_log")
        .update({ channel: channels.join("+"), recipients: recipients.join(", ").slice(0, 1000) })
        .eq("dedupe_key", dailyAlertKey(day));
    } catch {
      // best effort: the claim row already prevents a second send today
    }
  }
  return { report, saved, alert: channels.length > 0 ? "sent" : "failed", notes };
}

export async function listRecentHealthRuns(limit = 30): Promise<{ rows: HealthRunRow[]; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { rows: [], error: "Supabase is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from(RUNS_TABLE)
      .select("id, kind, status, summary, report, source, run_by, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      const hint =
        error.code === "42P01" || error.code === "PGRST205"
          ? "The health-check table is not installed yet: run supabase/migrations/0331_platform_health.sql."
          : error.code === "42501"
            ? "The server cannot read the health-check table: run 0330_service_role_grants.sql, then 0331_platform_health.sql."
            : `Could not load runs (${error.code ?? "?"}): ${error.message}`;
      return { rows: [], error: hint };
    }
    return { rows: (data ?? []) as HealthRunRow[], error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}
