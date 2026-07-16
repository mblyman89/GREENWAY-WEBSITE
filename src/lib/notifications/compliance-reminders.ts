/**
 * src/lib/notifications/compliance-reminders.ts  (Task W)
 *
 * SERVER orchestrator for CCRS deadline reminders — the "no way we could ever
 * miss the upload deadline" engine. Called by the daily cron route.
 *
 * What it does, in order:
 *   1. Plans today's WEEKLY reminders with the pure planner
 *      (planWeeklyReminders: Thursday heads-up, Saturday wrap, Sunday DUE,
 *      overdue-daily) against the ccrs_week_submissions ledger.
 *   2. Plans today's MONTHLY LIQ-1295 reminders with the pure planner
 *      (planMonthlyReminders: due-soon, due-today, overdue-daily) against the
 *      ccrs_export_batches evidence via getCcrsFilingOverview.
 *   3. For each planned reminder, checks compliance_reminder_log by dedupe_key —
 *      a key can only ever be sent ONCE, so a re-run cron can never double-send.
 *   4. Sends email (Resend REST pattern from orders/notify.ts — env-gated) and
 *      Web Push (push.ts — env-gated) — whichever is configured.
 *   5. Inserts the log row recording stage/channel/recipients.
 *
 * Every send is best-effort and every failure is contained: a broken email
 * provider can't block push, and vice versa. If NEITHER channel is configured
 * the reminder is NOT logged, so it fires as soon as a channel comes online.
 *
 * Env (email):  RESEND_API_KEY, ORDER_EMAIL_FROM, ORDER_STAFF_EMAILS
 * Env (push):   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificToday, pacificDayKey } from "@/lib/reports/timezone";
import { planPosExceptionReminder } from "@/lib/pos/exception-reminder-core";
import { posExceptionSnapshot } from "@/lib/pos/sync-store";
import { planWeeklyReminders } from "@/lib/compliance/ccrs-week-core";
import { getWeekResolutions } from "@/lib/compliance/ccrs-week-store";
import { planMonthlyReminders } from "@/lib/compliance/ccrs-deadline-core";
import { getCcrsFilingOverview } from "@/lib/compliance/ccrs-filing-status";
import { sendPushToAll, isPushConfigured } from "@/lib/notifications/push";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const COMMAND_CENTER_PATH = "/admin/compliance/ccrs";

/** One reminder normalized across the weekly + monthly + POS planners. */
type Reminder = {
  dedupeKey: string;
  stage: string;
  weekKey: string | null;
  subject: string;
  body: string;
  urgency: "info" | "warning" | "critical";
  /** AN-6: optional deep-link override (defaults to the CCRS Command Center). */
  linkPath?: string;
  /** AN-6: optional button label override. */
  linkLabel?: string;
  /** AN-6: optional footer override (defaults to the CCRS upload-portal note). */
  footnote?: string;
};

export type ReminderRunResult = {
  /** True when the run executed (DB configured). */
  ran: boolean;
  /** Reminders the planners produced for today. */
  planned: number;
  /** Reminders actually sent this run (not previously logged). */
  sent: number;
  /** Reminders skipped because their dedupe key was already logged. */
  deduped: number;
  /** Reminders skipped because no channel (email/push) is configured. */
  unsent: number;
  /** Human notes for the cron response / logs. */
  notes: string[];
};

function staffEmails(): string[] {
  return (process.env.ORDER_STAFF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isEmailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY && process.env.ORDER_EMAIL_FROM && staffEmails().length > 0,
  );
}

function urgencyColor(u: Reminder["urgency"]): string {
  if (u === "critical") return "#b91c1c";
  if (u === "warning") return "#b45309";
  return "#12351f";
}

function reminderHtml(r: Reminder, linkUrl: string): string {
  const footnote =
    r.footnote ??
    `Upload portal: <a href="https://cannabisreporting.lcb.wa.gov">cannabisreporting.lcb.wa.gov</a> (SAW login).
        This is an automated Greenway compliance reminder; it repeats until the week is recorded as
        submitted or nothing-to-report.`;
  return `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:560px">
      <h2 style="color:${urgencyColor(r.urgency)};margin-bottom:4px">${r.subject}</h2>
      <p style="line-height:1.5">${r.body}</p>
      <p>
        <a href="${linkUrl}"
           style="display:inline-block;background:#12351f;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">
          ${r.linkLabel ?? "Open the Compliance Command Center"}
        </a>
      </p>
      <p style="color:#555;font-size:13px">
        ${footnote}
      </p>
    </div>`;
}

async function sendReminderEmail(r: Reminder): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ORDER_EMAIL_FROM ?? "";
  const to = staffEmails();
  if (!apiKey || !from || to.length === 0) return false;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://greenwaymarijuana.com").replace(/\/$/, "");
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: r.subject,
        html: reminderHtml(r, `${site}${r.linkPath ?? COMMAND_CENTER_PATH}`),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function alreadySent(dedupeKeys: string[]): Promise<Set<string>> {
  const sent = new Set<string>();
  if (dedupeKeys.length === 0) return sent;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("compliance_reminder_log")
      .select("dedupe_key")
      .in("dedupe_key", dedupeKeys);
    for (const row of (data as { dedupe_key: string }[] | null) ?? []) {
      sent.add(row.dedupe_key);
    }
  } catch {
    // Fail SAFE for the deadline (better a rare duplicate than a missed
    // reminder) — but the unique constraint on dedupe_key still prevents a
    // second log row, and the next run will see it.
  }
  return sent;
}

async function logReminder(r: Reminder, channel: string, recipients: string): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("compliance_reminder_log").insert({
      dedupe_key: r.dedupeKey,
      stage: r.stage,
      week_key: r.weekKey,
      channel,
      subject: r.subject,
      recipients,
    });
  } catch {
    // best effort — unique constraint makes a duplicate insert a no-op error
  }
}

/**
 * Plan + send today's compliance reminders (weekly CCRS + monthly LIQ-1295).
 * Idempotent per day: safe to invoke multiple times.
 */
export async function runComplianceReminders(): Promise<ReminderRunResult> {
  const result: ReminderRunResult = {
    ran: false,
    planned: 0,
    sent: 0,
    deduped: 0,
    unsent: 0,
    notes: [],
  };
  if (!isSupabaseServiceConfigured) {
    result.notes.push("Supabase service not configured; skipped.");
    return result;
  }
  result.ran = true;

  const todayIso = pacificToday();

  // 1) Weekly CCRS reminders from the submission ledger.
  const reminders: Reminder[] = [];
  try {
    const resolutions = await getWeekResolutions(8);
    for (const r of planWeeklyReminders(todayIso, resolutions, { lookbackWeeks: 4 })) {
      reminders.push({
        dedupeKey: r.dedupeKey,
        stage: r.stage,
        weekKey: r.weekKey,
        subject: r.subject,
        body: r.body,
        urgency: r.urgency,
      });
    }
  } catch (e) {
    result.notes.push(
      `Weekly planner failed: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }

  // 2) Monthly LIQ-1295 reminders from the export evidence.
  try {
    const filing = await getCcrsFilingOverview(todayIso, { lookbackMonths: 3 });
    if (filing.available) {
      for (const m of planMonthlyReminders(todayIso, filing.periods)) {
        reminders.push({
          dedupeKey: m.dedupeKey,
          stage: m.stage,
          weekKey: null,
          subject: m.subject,
          body: m.body,
          urgency: m.urgency,
        });
      }
    }
  } catch (e) {
    result.notes.push(
      `Monthly planner failed: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }

  // 3) AN-6: daily nag while ANY register exception sits unresolved. The
  //    dedupe key is per Pacific day, so this re-fires each day the queue is
  //    non-empty and goes quiet the day it drains. Best-effort — a failed
  //    snapshot must never break the CCRS deadline reminders above.
  try {
    const snap = await posExceptionSnapshot();
    const r = planPosExceptionReminder(todayIso, {
      count: snap.count,
      oldestDayKey: snap.oldestOccurredAt ? pacificDayKey(snap.oldestOccurredAt) : null,
    });
    if (r) reminders.push(r);
  } catch (e) {
    result.notes.push(
      `POS exception planner failed: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }

  result.planned = reminders.length;
  if (reminders.length === 0) {
    result.notes.push("Nothing due today — no reminders planned.");
    return result;
  }

  // 3) Dedupe against the send log.
  const sentBefore = await alreadySent(reminders.map((r) => r.dedupeKey));

  const emailOn = isEmailConfigured();
  const pushOn = isPushConfigured();
  if (!emailOn && !pushOn) {
    result.unsent = reminders.length;
    result.notes.push(
      "No notification channel configured (set RESEND_API_KEY/ORDER_EMAIL_FROM/ORDER_STAFF_EMAILS and/or VAPID keys). Reminders NOT logged so they fire once a channel exists.",
    );
    return result;
  }

  // 4) Send sequentially (tiny volume; keeps logs ordered and providers happy).
  for (const r of reminders) {
    if (sentBefore.has(r.dedupeKey)) {
      result.deduped += 1;
      continue;
    }

    const channels: string[] = [];
    const recipients: string[] = [];

    if (emailOn) {
      const ok = await sendReminderEmail(r);
      if (ok) {
        channels.push("email");
        recipients.push(...staffEmails());
      }
    }
    if (pushOn) {
      const count = await sendPushToAll({
        title: r.subject,
        body: r.body,
        url: r.linkPath ?? COMMAND_CENTER_PATH,
        tag: r.dedupeKey,
      });
      if (count > 0) {
        channels.push("push");
        recipients.push(`${count} push subscription(s)`);
      }
    }

    if (channels.length === 0) {
      // Both channels attempted and failed — do NOT log, so the next run retries.
      result.unsent += 1;
      result.notes.push(`Send failed for ${r.dedupeKey}; will retry next run.`);
      continue;
    }

    await logReminder(r, channels.join("+"), recipients.join(", "));
    result.sent += 1;
  }

  return result;
}
