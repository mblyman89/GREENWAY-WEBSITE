/**
 * src/lib/compliance/ccrs-watchdog.ts  (CCRS Bible v2 slice S-18c). Server glue.
 *
 * Reads the facts, claims, sends. Every decision is in the PURE
 * ccrs-watchdog-core (planNoEmail, noEmailMessage, planMonitorAlert).
 *
 * WHO CALLS IT
 *   - every ccrs-mail tick (5 minutes), on EVERY path: set up or not, Gmail
 *     working or not. A file with no CCRS answer is worth an alert even when
 *     the monitor is off (the message then says "check Gmail by hand");
 *   - the daily compliance-reminders cron with checkStale=true, because a
 *     5-minute cron that stopped running cannot report that it stopped.
 *
 * SEND ONCE (AGENTS rule 12, the cutover-watch / S-18b pattern):
 *   - each dedupe key is INSERTED into compliance_reminder_log (UNIQUE, 0118)
 *     before anything is sent; 23505 = another tick has it -> skip;
 *   - several files crossing the line together go out as ONE message, but
 *     every file still has its own claim row (so a file is never repeated);
 *   - no channel configured -> nothing is claimed (the alert goes out once a
 *     channel exists, while the file is still waiting);
 *   - every channel failed after the claim -> recorded undelivered, not retried
 *     (a duplicate page is worse than one the hub already shows);
 *   - a quiet tick reads and writes nothing.
 * Never throws: a watchdog fault is a note on the tick result.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToAll, isPushConfigured } from "@/lib/notifications/push";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import { publicSiteOrigin } from "@/lib/site/site-domain-core";
import { CCRS_EMAIL_SLA_MINUTES } from "./ccrs-outcome-core";
import { heartbeatStale, type MailHeartbeat } from "./ccrs-mail-core";
import { MAIL_ALERT_LOOKBACK_DAYS } from "./ccrs-strategy-core";
import { MAIL_CLAIM_PENDING, MAIL_UNDELIVERED } from "./ccrs-mail-notify";
import {
  NO_EMAIL_STAGE,
  WATCHDOG_FILE_LIMIT,
  noEmailKey,
  noEmailMessage,
  planMonitorAlert,
  planNoEmail,
  successNamesFromAnalysis,
  type NoEmailItem,
  type OpenMail,
  type WaitingFile,
  type WatchdogMessage,
} from "./ccrs-watchdog-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type WatchdogResult = { planned: number; sent: number; alreadyClaimed: number; undelivered: number; unsentNoChannel: number; notes: string[] };

export type WatchdogInput = {
  /** mailConfigFromEnv(...).configured */
  configured: boolean;
  mailbox: string;
  /** The heartbeat as it stands after this tick (or as read, for the daily check). */
  heartbeat: MailHeartbeat | null;
  nowMs: number;
  /** Only the daily cron asks "has the 5-minute cron stopped?". */
  checkStale: boolean;
};

function staffEmails(): string[] {
  return (process.env.ORDER_STAFF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.ORDER_EMAIL_FROM && staffEmails().length > 0);
}

async function claim(admin: Admin, key: string, stage: string, subject: string): Promise<"claimed" | "taken" | "error"> {
  try {
    const { error } = await admin.from("compliance_reminder_log").insert({
      dedupe_key: key,
      stage,
      week_key: null,
      channel: "email", // 0118 check allows email / push / email+push; corrected after the send
      subject,
      recipients: MAIL_CLAIM_PENDING,
    });
    if (!error) return "claimed";
    return error.code === "23505" ? "taken" : "error";
  } catch {
    return "error";
  }
}

async function record(admin: Admin, keys: readonly string[], channel: string, recipients: string): Promise<void> {
  try {
    await admin.from("compliance_reminder_log").update({ channel, recipients }).in("dedupe_key", [...keys]);
  } catch {
    // best effort: the claim rows already prevent a second send
  }
}

/** Send one message on every configured channel. */
async function deliver(m: WatchdogMessage, tag: string, emailOn: boolean, pushOn: boolean, out: WatchdogResult): Promise<{ channels: string[]; recipients: string[] }> {
  const channels: string[] = [];
  const recipients: string[] = [];
  if (emailOn) {
    const r = await sendStaffAlertEmail({ apiKey: process.env.RESEND_API_KEY ?? "", from: process.env.ORDER_EMAIL_FROM ?? "", to: staffEmails(), subject: m.subject, html: m.html });
    if (r.ok) {
      channels.push("email");
      recipients.push(...staffEmails());
    } else out.notes.push(`email failed for ${tag}: ${r.detail}`);
  }
  if (pushOn) {
    const n = await sendPushToAll({ title: m.subject, body: m.text, url: m.linkPath, tag }).catch(() => 0);
    if (n > 0) {
      channels.push("push");
      recipients.push(`${n} push device(s)`);
    } else out.notes.push(`push reached no device for ${tag}`);
  }
  return { channels, recipients };
}

/** Claim every key, send ONE message for the keys this run won, record them all. */
async function claimAndSend(admin: Admin, keys: readonly string[], stage: string, build: (won: readonly string[]) => WatchdogMessage | null, emailOn: boolean, pushOn: boolean, out: WatchdogResult): Promise<void> {
  const won: string[] = [];
  const probe = build(keys);
  for (const k of keys) {
    const c = await claim(admin, k, stage, probe?.subject ?? stage);
    if (c === "claimed") won.push(k);
    else if (c === "taken") out.alreadyClaimed += 1;
    else out.notes.push(`could not claim ${k}; will try again next tick`);
  }
  if (won.length === 0) return;
  const m = build(won);
  if (!m) return;
  const d = await deliver(m, won[0], emailOn, pushOn, out);
  if (d.channels.length === 0) {
    out.undelivered += won.length;
    await record(admin, won, "email", MAIL_UNDELIVERED);
    return;
  }
  out.sent += won.length;
  await record(admin, won, d.channels.join("+"), d.recipients.join(", "));
}

type FileRow = WaitingFile;
type MailRow = { kind: string; received_at: string | null; fetched_at: string; analysis: unknown };

/** One watchdog pass. Never throws. */
export async function runCcrsWatchdog(admin: Admin, input: WatchdogInput): Promise<WatchdogResult> {
  const out: WatchdogResult = { planned: 0, sent: 0, alreadyClaimed: 0, undelivered: 0, unsentNoChannel: 0, notes: [] };
  try {
    const { nowMs, heartbeat: hb } = input;
    const origin = publicSiteOrigin(process.env);

    // 1) Files still waiting for CCRS 60+ minutes after the upload (both envs; seed files are never uploaded).
    const cutoff = new Date(nowMs - CCRS_EMAIL_SLA_MINUTES * 60_000).toISOString();
    let items: NoEmailItem[] = [];
    const { data: fData, error: fErr } = await admin
      .from("ccrs_files")
      .select("id, env, file_name, file_type, state, uploaded_at")
      .eq("state", "uploaded")
      .lte("uploaded_at", cutoff)
      .order("uploaded_at", { ascending: true })
      .limit(WATCHDOG_FILE_LIMIT);
    if (fErr) out.notes.push(`file read failed: ${fErr.message}`);
    const files = (fData as FileRow[] | null) ?? [];
    if (files.length > 0) {
      const keys = files.map((f) => noEmailKey(f.env, f.id));
      const { data: done, error: dErr } = await admin.from("compliance_reminder_log").select("dedupe_key").in("dedupe_key", keys);
      if (dErr) out.notes.push(`alert log read failed: ${dErr.message}`);
      else {
        const claimed = new Set(((done as { dedupe_key: string }[] | null) ?? []).map((d) => d.dedupe_key));
        const fresh = files.filter((f) => !claimed.has(noEmailKey(f.env, f.id)));
        out.alreadyClaimed += files.length - fresh.length;
        if (fresh.length > 0) {
          // What the mailbox already holds: unhandled CCRS mail of the last 7 days.
          let mail: OpenMail[] = [];
          if (input.configured) {
            const since = new Date(nowMs - MAIL_ALERT_LOOKBACK_DAYS * 86_400_000).toISOString();
            const { data: mData, error: mErr } = await admin
              .from("ccrs_mail_messages")
              .select("kind, received_at, fetched_at, analysis")
              .eq("mailbox", input.mailbox)
              .eq("state", "new")
              .in("kind", ["success", "error", "unknown"])
              .gte("fetched_at", since)
              .limit(100);
            if (mErr) out.notes.push(`mail read failed: ${mErr.message}`);
            mail = ((mData as MailRow[] | null) ?? []).map((m) => ({ kind: m.kind, received_at: m.received_at, fetched_at: m.fetched_at, successNames: successNamesFromAnalysis(m.analysis) }));
          }
          const healthy = !!hb && hb.ok && !heartbeatStale(hb, nowMs);
          items = planNoEmail(fresh, mail, { configured: input.configured, healthy }, nowMs);
        }
      }
    }

    // 2) The monitor itself.
    const monitor = planMonitorAlert(hb, input.configured, input.mailbox, nowMs, input.checkStale, origin);
    let monitorTaken = false;
    if (monitor) {
      const { data: done, error: dErr } = await admin.from("compliance_reminder_log").select("dedupe_key").eq("dedupe_key", monitor.dedupeKey);
      if (dErr) {
        out.notes.push(`alert log read failed: ${dErr.message}`);
        monitorTaken = true;
      } else if (((done as unknown[] | null) ?? []).length > 0) {
        out.alreadyClaimed += 1;
        monitorTaken = true;
      }
    }

    out.planned = items.length + (monitor && !monitorTaken ? 1 : 0);
    if (out.planned === 0) return out;

    const emailOn = emailConfigured();
    const pushOn = isPushConfigured();
    if (!emailOn && !pushOn) {
      out.unsentNoChannel = out.planned;
      out.notes.push("No alert channel configured (email env or VAPID keys). Nothing claimed, so the alert goes out once a channel exists.");
      return out;
    }
    if (items.length > 0) {
      const byKey = new Map(items.map((i) => [i.dedupeKey, i]));
      await claimAndSend(admin, items.map((i) => i.dedupeKey), NO_EMAIL_STAGE, (won) => noEmailMessage(won.map((k) => byKey.get(k)!), origin), emailOn, pushOn, out);
    }
    if (monitor && !monitorTaken) {
      await claimAndSend(admin, [monitor.dedupeKey], monitor.stage, () => monitor, emailOn, pushOn, out);
    }
    return out;
  } catch (e) {
    out.notes.push(`watchdog failed: ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }
}
