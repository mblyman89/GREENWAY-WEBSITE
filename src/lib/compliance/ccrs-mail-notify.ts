/**
 * src/lib/compliance/ccrs-mail-notify.ts  (CCRS Bible v2 slice S-18b). Server glue.
 *
 * Tells the owner, once, that CCRS sent an error file (or an email the system
 * cannot read), with the headline of the strategy report and a link to it.
 * Called at the end of every ccrs-mail tick. Decisions are in the PURE
 * ccrs-strategy-core (planMailAlert, buildCcrsStrategy).
 *
 * SEND ONCE (AGENTS rule 12, same pattern as cutover-watch):
 *   - the claim is an INSERT into compliance_reminder_log (dedupe_key UNIQUE,
 *     0118); 23505 = another tick already claimed it -> skip;
 *   - claim first, then send, then record the channels; a claim that fails
 *     sends nothing (a send without a claim could repeat every 5 minutes);
 *   - no channel configured -> nothing is claimed, so the alert goes out the
 *     first tick after a channel exists (within MAIL_ALERT_LOOKBACK_DAYS);
 *   - a quiet tick reads (open mail, existing claims) and writes nothing.
 * Never throws: a notify fault is a note on the tick result, never a failed read.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToAll, isPushConfigured } from "@/lib/notifications/push";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import { publicSiteOrigin } from "@/lib/site/site-domain-core";
import { WATCH_CLAIM_PENDING, WATCH_UNDELIVERED } from "@/lib/pos/cutover-watch-core";
import { errorsFromStored, type AuthVerdict } from "./ccrs-mail-core";
import { buildCcrsStrategy, mailAlertKey, MAIL_ALERT_LOOKBACK_DAYS, MAIL_ALERT_STAGE, planMailAlert, type MailAlert } from "./ccrs-strategy-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type MailNotifyResult = { planned: number; sent: number; alreadyClaimed: number; undelivered: number; unsentNoChannel: number; notes: string[] };

/** The same markers cutover-watch writes (claim placeholder, every-channel-failed), so the log reads one way. */
export const MAIL_CLAIM_PENDING = WATCH_CLAIM_PENDING;
export const MAIL_UNDELIVERED = WATCH_UNDELIVERED;

function staffEmails(): string[] {
  return (process.env.ORDER_STAFF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.ORDER_EMAIL_FROM && staffEmails().length > 0);
}

type OpenRow = { mailbox: string; gmail_id: string; kind: "error" | "unknown"; subject: string; auth: AuthVerdict; in_spam: boolean; csvs: { filename: string; text: string }[] | null };

async function claim(admin: Admin, a: MailAlert): Promise<"claimed" | "taken" | "error"> {
  try {
    const { error } = await admin.from("compliance_reminder_log").insert({
      dedupe_key: a.dedupeKey,
      stage: a.stage,
      week_key: null,
      channel: "email", // 0118 check allows email / push / email+push; corrected after the send
      subject: a.subject,
      recipients: MAIL_CLAIM_PENDING,
    });
    if (!error) return "claimed";
    return error.code === "23505" ? "taken" : "error";
  } catch {
    return "error";
  }
}

async function record(admin: Admin, a: MailAlert, channel: string, recipients: string): Promise<void> {
  try {
    await admin.from("compliance_reminder_log").update({ channel, recipients }).eq("dedupe_key", a.dedupeKey);
  } catch {
    // best effort: the claim row already prevents a second send
  }
}

/** Alert the owner about open CCRS error / unreadable mail not yet alerted. Never throws. */
export async function notifyOpenCcrsMail(admin: Admin, mailbox: string, nowMs: number = Date.now()): Promise<MailNotifyResult> {
  const out: MailNotifyResult = { planned: 0, sent: 0, alreadyClaimed: 0, undelivered: 0, unsentNoChannel: 0, notes: [] };
  try {
    const since = new Date(nowMs - MAIL_ALERT_LOOKBACK_DAYS * 86_400_000).toISOString();
    const { data, error } = await admin
      .from("ccrs_mail_messages")
      .select("mailbox, gmail_id, kind, subject, auth, in_spam, csvs")
      .eq("mailbox", mailbox)
      .eq("state", "new")
      .in("kind", ["error", "unknown"])
      .gte("fetched_at", since)
      .order("fetched_at", { ascending: true })
      .limit(25);
    if (error) {
      out.notes.push(`alert read failed: ${error.message}`);
      return out;
    }
    const rows = (data as OpenRow[] | null) ?? [];
    if (rows.length === 0) return out;

    const keys = rows.map((r) => mailAlertKey(r.mailbox, r.gmail_id));
    const { data: done, error: doneErr } = await admin.from("compliance_reminder_log").select("dedupe_key").in("dedupe_key", keys);
    if (doneErr) {
      out.notes.push(`alert log read failed: ${doneErr.message}`);
      return out;
    }
    const claimed = new Set(((done as { dedupe_key: string }[] | null) ?? []).map((d) => d.dedupe_key));
    const origin = publicSiteOrigin(process.env);
    const alerts: MailAlert[] = [];
    for (const r of rows) {
      if (claimed.has(mailAlertKey(r.mailbox, r.gmail_id))) {
        out.alreadyClaimed += 1;
        continue;
      }
      const strategy = r.kind === "error" ? buildCcrsStrategy(errorsFromStored(r.csvs ?? []), { licenseNumber: "", licenseeName: "" }) : null;
      const a = planMailAlert(r, strategy, origin);
      if (a) alerts.push(a);
    }
    out.planned = alerts.length;
    if (alerts.length === 0) return out;

    const emailOn = emailConfigured();
    const pushOn = isPushConfigured();
    if (!emailOn && !pushOn) {
      out.unsentNoChannel = alerts.length;
      out.notes.push("No alert channel configured (email env or VAPID keys). Nothing claimed, so the alert goes out once a channel exists.");
      return out;
    }

    for (const a of alerts) {
      const c = await claim(admin, a);
      if (c === "taken") {
        out.alreadyClaimed += 1;
        continue;
      }
      if (c === "error") {
        out.notes.push(`could not claim ${a.dedupeKey}; will try again next tick`);
        continue;
      }
      const channels: string[] = [];
      const recipients: string[] = [];
      if (emailOn) {
        const r = await sendStaffAlertEmail({
          apiKey: process.env.RESEND_API_KEY ?? "",
          from: process.env.ORDER_EMAIL_FROM ?? "",
          to: staffEmails(),
          subject: a.subject,
          html: a.html,
        });
        if (r.ok) {
          channels.push("email");
          recipients.push(...staffEmails());
        } else out.notes.push(`email failed for ${a.dedupeKey}: ${r.detail}`);
      }
      if (pushOn) {
        const n = await sendPushToAll({ title: a.subject, body: a.text, url: a.linkPath, tag: a.dedupeKey }).catch(() => 0);
        if (n > 0) {
          channels.push("push");
          recipients.push(`${n} push device(s)`);
        } else out.notes.push(`push reached no device for ${a.dedupeKey}`);
      }
      if (channels.length === 0) {
        out.undelivered += 1;
        await record(admin, a, "email", MAIL_UNDELIVERED);
        continue;
      }
      out.sent += 1;
      await record(admin, a, channels.join("+"), recipients.join(", "));
    }
    return out;
  } catch (e) {
    out.notes.push(`alert failed: ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }
}

export { MAIL_ALERT_STAGE };
