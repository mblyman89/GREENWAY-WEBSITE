/**
 * src/lib/pos/cutover-watch.ts   (R50 A4)
 *
 * The server half of the cutover failure alerts. Decisions live in
 * cutover-watch-core.ts (pure, self-tested); this file only reads facts,
 * claims, and sends through the EXISTING notification channels:
 *   - email: Resend (RESEND_API_KEY, ORDER_EMAIL_FROM, ORDER_STAFF_EMAILS),
 *     the same env the compliance reminders use;
 *   - phone: Web Push to every staff device that turned notifications on
 *     (VAPID keys), the same sendPushToAll the deadline reminders use.
 *
 * CLAIM BEFORE SEND (AGENTS rule 12). Each alert's dedupe key is INSERTED
 * into compliance_reminder_log first; the table's UNIQUE(dedupe_key) makes
 * the insert a real claim, so a doubled or overlapping cron tick can never
 * send the same alert twice. The row is then updated with the channel that
 * actually delivered. The trade-off, chosen on purpose: if every channel
 * fails after the claim, that alert is not retried (it stays visible on the
 * runbook page as "not delivered"), because a duplicate page at 3 AM is worse
 * than one the owner can see on the page he is already watching.
 *
 * NO CHANNEL CONFIGURED -> nothing is claimed, so the alert fires as soon as a
 * channel exists (same rule as the compliance reminders).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { sendPushToAll, isPushConfigured } from "@/lib/notifications/push";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import { publicSiteOrigin } from "@/lib/site/site-domain-core";
import { getPosRun, isValidRunId } from "@/lib/pos/cultivera-fetch-client";
import { isCrawlerConfigured } from "@/lib/ai/crawler-client";
import {
  WATCH_AUDIT_ACTIONS,
  WATCH_CLAIM_PENDING,
  WATCH_UNDELIVERED,
  WATCH_IMPORT_LOOKBACK_HOURS,
  WATCH_RUN_LOOKBACK_HOURS,
  WATCH_STAGE,
  WATCH_TEST_STAGE,
  alertHtml,
  planCutoverAlerts,
  plainText,
  runIdsToWatch,
  testAlert,
  describeWatchLog,
  type WatchAlert,
  type WatchLogView,
  type WatchChannels,
  type WatchImportFact,
  type WatchRunFact,
} from "@/lib/pos/cutover-watch-core";

export type WatchTickResult = {
  ok: boolean;
  planned: number;
  sent: number;
  alreadyClaimed: number;
  undelivered: number;
  unsentNoChannel: number;
  notes: string[];
};

export type WatchLogRow = {
  dedupe_key: string;
  stage: string;
  channel: string;
  subject: string | null;
  recipients: string | null;
  sent_at: string;
};

export type WatchLogEntry = WatchLogRow & { view: WatchLogView };

function staffEmails(): string[] {
  return (process.env.ORDER_STAFF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.ORDER_EMAIL_FROM && staffEmails().length > 0);
}

/** The crawler's own budget env (Railway). The site reads the same name if set; else the crawler default. */
function budgetSeconds(): number | undefined {
  const n = Number(process.env.CULTIVERA_POS_BUDGET_SECONDS ?? "");
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** What the runbook page shows about the channels. Never throws. */
export async function readWatchChannels(): Promise<WatchChannels> {
  const pushOn = isPushConfigured();
  let devices: number | null = null;
  if (pushOn && isSupabaseServiceConfigured) {
    try {
      const admin = createSupabaseAdminClient();
      const { count, error } = await admin.from("push_subscriptions").select("id", { count: "exact", head: true });
      devices = error ? null : (count ?? 0);
    } catch {
      devices = null;
    }
  }
  return { emailConfigured: emailConfigured(), emailRecipients: staffEmails().length, pushConfigured: pushOn, pushDevices: devices };
}

/** Recent cutover alerts (real + test) for the runbook page, newest first. Never throws. */
export async function readRecentWatchAlerts(limit = 20, nowMs: number = Date.now()): Promise<{ rows: WatchLogEntry[]; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { rows: [], error: "Supabase is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("compliance_reminder_log")
      .select("dedupe_key, stage, channel, subject, recipients, sent_at")
      .in("stage", [WATCH_STAGE, WATCH_TEST_STAGE])
      .order("sent_at", { ascending: false })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    const rows = (data as WatchLogRow[] | null) ?? [];
    return { rows: rows.map((r) => ({ ...r, view: describeWatchLog(r, nowMs, r.sent_at) })), error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Placeholder written by the claim (replaced after sending), and the every-channel-failed marker. */
const CLAIM_PENDING = WATCH_CLAIM_PENDING;
const UNDELIVERED = WATCH_UNDELIVERED;

type Claim = "claimed" | "taken" | "error";

async function claim(a: WatchAlert): Promise<Claim> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("compliance_reminder_log").insert({
      dedupe_key: a.dedupeKey,
      stage: a.stage,
      week_key: null,
      channel: "email", // the column's check allows email / push / email+push; corrected after the send
      subject: a.subject,
      recipients: CLAIM_PENDING,
    });
    if (!error) return "claimed";
    return error.code === "23505" ? "taken" : "error";
  } catch {
    return "error";
  }
}

async function record(a: WatchAlert, channel: string, recipients: string): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("compliance_reminder_log").update({ channel, recipients }).eq("dedupe_key", a.dedupeKey);
  } catch {
    // best effort: the claim row already prevents a second send
  }
}

/** Send one claimed alert through every configured channel. Returns what delivered. */
async function deliver(a: WatchAlert): Promise<{ channels: string[]; recipients: string[]; notes: string[] }> {
  const channels: string[] = [];
  const recipients: string[] = [];
  const notes: string[] = [];
  const link = `${publicSiteOrigin(process.env)}${a.linkPath}`;
  if (emailConfigured()) {
    const r = await sendStaffAlertEmail({
      apiKey: process.env.RESEND_API_KEY ?? "",
      from: process.env.ORDER_EMAIL_FROM ?? "",
      to: staffEmails(),
      subject: plainText(a.subject),
      html: alertHtml(a, link),
    });
    if (r.ok) {
      channels.push("email");
      recipients.push(...staffEmails());
    } else notes.push(`email failed for ${a.dedupeKey}: ${r.detail}`);
  }
  if (isPushConfigured()) {
    const n = await sendPushToAll({ title: plainText(a.subject), body: plainText(a.body), url: a.linkPath, tag: a.dedupeKey }).catch(() => 0);
    if (n > 0) {
      channels.push("push");
      recipients.push(`${n} push device(s)`);
    } else notes.push(`push reached no device for ${a.dedupeKey}`);
  }
  return { channels, recipients, notes };
}

async function claimAndSend(alerts: WatchAlert[], result: WatchTickResult): Promise<void> {
  for (const a of alerts) {
    const c = await claim(a);
    if (c === "taken") {
      result.alreadyClaimed += 1;
      continue;
    }
    if (c === "error") {
      // Cannot claim -> do not send (a send without a claim could repeat every 5 minutes).
      result.ok = false;
      result.notes.push(`could not claim ${a.dedupeKey}; will try again next tick`);
      continue;
    }
    const d = await deliver(a);
    result.notes.push(...d.notes);
    if (d.channels.length === 0) {
      result.undelivered += 1;
      await record(a, "email", UNDELIVERED);
      continue;
    }
    result.sent += 1;
    await record(a, d.channels.join("+"), d.recipients.join(", "));
  }
}

function emptyResult(): WatchTickResult {
  return { ok: true, planned: 0, sent: 0, alreadyClaimed: 0, undelivered: 0, unsentNoChannel: 0, notes: [] };
}

/** One cron tick. Never throws; ok=false only when the database could not be read or a claim failed. */
export async function runCutoverWatchTick(nowMs: number = Date.now()): Promise<WatchTickResult> {
  const result = emptyResult();
  if (!isSupabaseServiceConfigured) {
    result.ok = false;
    result.notes.push("Supabase is not configured.");
    return result;
  }
  const admin = createSupabaseAdminClient();

  // 1) Harvests started or resumed recently (the audit row is written by the Start button).
  const runs: WatchRunFact[] = [];
  const runSince = new Date(nowMs - WATCH_RUN_LOOKBACK_HOURS * 3_600_000).toISOString();
  const { data: auditRows, error: auditErr } = await admin
    .from("audit_logs")
    .select("entity_id")
    .in("action", [...WATCH_AUDIT_ACTIONS])
    .gte("created_at", runSince)
    .order("created_at", { ascending: false })
    .limit(50);
  if (auditErr) {
    result.ok = false;
    result.notes.push(`audit read failed: ${auditErr.message}`);
    return result;
  }
  const ids = runIdsToWatch((auditRows as { entity_id: string | null }[] | null) ?? [], isValidRunId);
  if (ids.length > 0 && !isCrawlerConfigured()) {
    result.notes.push("crawler not configured; harvests not checked");
  } else {
    for (const runId of ids) {
      try {
        runs.push({ runId, reachable: true, run: await getPosRun(runId) });
      } catch (e) {
        runs.push({ runId, reachable: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // 2) Imports created recently.
  const impSince = new Date(nowMs - WATCH_IMPORT_LOOKBACK_HOURS * 3_600_000).toISOString();
  const { data: impRows, error: impErr } = await admin
    .from("pos_imports")
    .select("id, status, is_test, error_message, started_at, completed_at")
    .gte("created_at", impSince)
    .in("status", ["failed", "processing"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (impErr) {
    result.ok = false;
    result.notes.push(`import read failed: ${impErr.message}`);
    return result;
  }

  const alerts = planCutoverAlerts({ nowMs, runs, imports: (impRows as WatchImportFact[] | null) ?? [], budgetSeconds: budgetSeconds() });
  result.planned = alerts.length;
  if (alerts.length === 0) return result;

  if (!emailConfigured() && !isPushConfigured()) {
    result.unsentNoChannel = alerts.length;
    result.notes.push("No alert channel configured (email env or VAPID keys). Nothing claimed, so alerts fire once a channel exists.");
    return result;
  }
  await claimAndSend(alerts, result);
  return result;
}

/** The runbook page's "Send a test alert" button. */
export async function sendCutoverTestAlert(nowIso: string = new Date().toISOString()): Promise<WatchTickResult> {
  const result = emptyResult();
  result.planned = 1;
  if (!isSupabaseServiceConfigured) {
    result.ok = false;
    result.notes.push("Supabase is not configured.");
    return result;
  }
  if (!emailConfigured() && !isPushConfigured()) {
    result.unsentNoChannel = 1;
    result.notes.push("No alert channel is configured yet.");
    return result;
  }
  await claimAndSend([testAlert(nowIso)], result);
  return result;
}
