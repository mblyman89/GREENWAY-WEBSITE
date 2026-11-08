/**
 * src/lib/registers/night-watch-store.ts   (D182, round slice S5)
 *
 * SERVER-ONLY. Gathers the night watch findings from the database, builds the
 * morning report (night-watch-core.ts), and, from the cron only, sends it by
 * email and/or text IF the owner has switched those on (both OFF by default).
 *
 * Every read that fails is reported as "could not check", never as all clear
 * (rule 135). The send is claimed once per Pacific day in
 * compliance_reminder_log (UNIQUE dedupe_key) before anything goes out, so a
 * doubled cron tick sends nothing twice.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { addPacificDays, pacificToday } from "@/lib/reports/timezone";
import { listBagsInRange } from "@/lib/registers/deposit-bag-store";
import { bagStage } from "@/lib/registers/deposit-bag-flow-core";
import { missingBagDays } from "@/lib/registers/guided-cash-core";
import { loudFlags } from "@/lib/registers/count-integrity-core";
import { isOverShortWarning } from "@/lib/registers/over-short-warning-core";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import { isSmsConfigured, sendStaffSms } from "@/lib/notifications/sms";
import { publicSiteOrigin } from "@/lib/site/site-domain-core";
import { isMissingColumn } from "@/lib/payments/payee-banking-store";
import { breakReasonLabel, LONG_OPEN_BREAK_HOURS } from "@/lib/staffing/break-clock-core";
import {
  buildMorningReport,
  nightWatchKey,
  notifyPlan,
  NOTIFY_SETTING_KEY,
  OPEN_PUNCH_HOURS,
  parseNotifySettings,
  reportEmailHtml,
  reportSmsText,
  reportSubject,
  type MorningReport,
  type NotifySettings,
  type WatchFindings,
} from "@/lib/registers/night-watch-core";

export const NIGHT_WATCH_PAGE = "/admin/registers/night-watch";
const LOOKBACK_DAYS = 14;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

type SessRow = {
  register_id: string;
  business_day: string;
  status: string;
  second_count_minor: number | null;
  second_count_flags: string[] | null;
  over_short_minor: number | null;
  over_short_reason: string | null;
};

function daysBetween(fromIso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / 86_400_000));
}

type OpenBreakRow = { employee_id: string; clock_in_at: string; break_reason?: string | null };

/** D211 — open break punches older than the cutoff; tolerant of 0348 not applied. */
async function readOpenBreaks(admin: Admin, cutoff: string): Promise<{ rows: OpenBreakRow[]; error: string | null }> {
  const q = (cols: string) =>
    admin.from("time_punches").select(cols).is("clock_out_at", null).eq("punch_kind", "break").lt("clock_in_at", cutoff);
  const first = await q("employee_id, clock_in_at, break_reason");
  if (!first.error) return { rows: (first.data as unknown as OpenBreakRow[] | null) ?? [], error: null };
  if (!isMissingColumn(first.error)) return { rows: [], error: first.error.message };
  const second = await q("employee_id, clock_in_at");
  if (second.error) return { rows: [], error: second.error.message };
  return { rows: (second.data as unknown as OpenBreakRow[] | null) ?? [], error: null };
}

/** Read everything the report needs. Never throws. */
export async function gatherFindings(now: Date = new Date()): Promise<WatchFindings> {
  const day = pacificToday();
  const yesterday = addPacificDays(day, -1);
  const from = addPacificDays(day, -LOOKBACK_DAYS);
  const weekAgo = addPacificDays(day, -7);
  const f: WatchFindings & { readErrors: string[] } = {
    day,
    openOldDrawers: [],
    noSecondCount: [],
    notReconciled: [],
    missingBagDays: [],
    bagNeedsReason: false,
    unsealedBagDays: [],
    unbankedBagDays: [],
    openExceptions: 0,
    oldestExceptionDays: null,
    loudSecondCounts: [],
    unexplainedOverShort: [],
    longOpenPunches: [],
    platformStatus: null,
    readErrors: [],
  };
  if (!isSupabaseServiceConfigured) {
    f.readErrors.push("the database is not configured on this deployment.");
    return f;
  }
  const admin: Admin = createSupabaseAdminClient();
  const punchCutoff = new Date(now.getTime() - OPEN_PUNCH_HOURS * 3_600_000).toISOString();

  const breakCutoff = new Date(now.getTime() - LONG_OPEN_BREAK_HOURS * 3_600_000).toISOString();
  const [regs, sess, bags, exc, punches, health, breaks] = await Promise.all([
    admin.from("registers").select("id, name"),
    admin
      .from("drawer_sessions")
      .select("register_id, business_day, status, second_count_minor, second_count_flags, over_short_minor, over_short_reason")
      .gte("business_day", from)
      .lt("business_day", day)
      .order("business_day", { ascending: true }),
    listBagsInRange(from, day),
    admin.from("pos_sale_events").select("received_at").eq("status", "exception").order("received_at", { ascending: true }).limit(500),
    admin.from("time_punches").select("employee_id, clock_in_at").is("clock_out_at", null).eq("punch_kind", "work").lt("clock_in_at", punchCutoff),
    admin.from("platform_health_runs").select("status, created_at").eq("kind", "db_contract").order("created_at", { ascending: false }).limit(1),
    // D211 — breaks still open after LONG_OPEN_BREAK_HOURS (break_reason needs 0348).
    readOpenBreaks(admin, breakCutoff),
  ]);

  const names = new Map(((regs.data as { id: string; name: string }[] | null) ?? []).map((r) => [r.id, r.name]));
  if (regs.error) f.readErrors.push(`register names (${regs.error.message}).`);

  if (sess.error) {
    f.readErrors.push(`drawers (${sess.error.message}).`);
  } else {
    const rows = (sess.data as SessRow[] | null) ?? [];
    const openOld: WatchFindings["openOldDrawers"][number][] = [];
    const noSecond: WatchFindings["noSecondCount"][number][] = [];
    const notRec: WatchFindings["notReconciled"][number][] = [];
    const loud: WatchFindings["loudSecondCounts"][number][] = [];
    const os: WatchFindings["unexplainedOverShort"][number][] = [];
    for (const r of rows) {
      const ref = { registerName: names.get(r.register_id) ?? "Register", businessDay: r.business_day };
      if (r.status === "open") openOld.push(ref);
      else if (r.status === "closed" && r.second_count_minor == null) noSecond.push(ref);
      else if (r.status === "closed") notRec.push(ref);
      const lf = loudFlags(r.second_count_flags);
      if (r.business_day === yesterday && lf.length > 0) loud.push({ ...ref, flags: lf });
      if (
        r.business_day >= weekAgo &&
        (r.status === "reconciled" || r.status === "verified") &&
        isOverShortWarning(r.over_short_minor) &&
        !(r.over_short_reason ?? "").trim()
      ) {
        os.push({ ...ref, overShortMinor: r.over_short_minor ?? 0 });
      }
    }
    f.openOldDrawers = openOld;
    f.noSecondCount = noSecond;
    f.notReconciled = notRec;
    f.loudSecondCounts = loud;
    f.unexplainedOverShort = os;

    if (!bags.ok) {
      f.readErrors.push(`deposit bags (${bags.error}).`);
    } else {
      f.missingBagDays = missingBagDays({ drawerDays: rows.map((r) => r.business_day), bagDays: bags.bags.map((b) => b.businessDay), today: day });
    }
  }
  if (bags.ok) {
    const stages = bags.bags.map((b) => ({ day: b.businessDay, stage: bagStage(b) }));
    f.bagNeedsReason = stages.some((s) => s.stage === "needs_reason");
    f.unsealedBagDays = stages.filter((s) => s.stage === "ready_to_seal").map((s) => s.day);
    f.unbankedBagDays = stages.filter((s) => s.stage === "sealed_in_safe").map((s) => s.day);
  }

  if (exc.error) f.readErrors.push(`register exceptions (${exc.error.message}).`);
  else {
    const e = (exc.data as { received_at: string }[] | null) ?? [];
    f.openExceptions = e.length;
    f.oldestExceptionDays = e.length > 0 ? daysBetween(e[0]!.received_at, now) : null;
  }

  if (punches.error) f.readErrors.push(`the time clock (${punches.error.message}).`);
  else {
    const p = (punches.data as { employee_id: string; clock_in_at: string }[] | null) ?? [];
    if (p.length > 0) {
      const { data: emps } = await admin.from("employees").select("id, full_name").in("id", [...new Set(p.map((x) => x.employee_id))]);
      const en = new Map(((emps as { id: string; full_name: string }[] | null) ?? []).map((x) => [x.id, x.full_name]));
      f.longOpenPunches = p.map((x) => ({
        name: en.get(x.employee_id) ?? "Someone",
        hours: Math.floor((now.getTime() - new Date(x.clock_in_at).getTime()) / 3_600_000),
      }));
    }
  }

  if (breaks.error) f.readErrors.push(`breaks on the time clock (${breaks.error}).`);
  else if (breaks.rows.length > 0) {
    const { data: emps } = await admin.from("employees").select("id, full_name").in("id", [...new Set(breaks.rows.map((x) => x.employee_id))]);
    const en = new Map(((emps as { id: string; full_name: string }[] | null) ?? []).map((x) => [x.id, x.full_name]));
    f.longOpenBreaks = breaks.rows.map((x) => ({
      name: en.get(x.employee_id) ?? "Someone",
      hours: Math.floor((now.getTime() - new Date(x.clock_in_at).getTime()) / 3_600_000),
      reason: breakReasonLabel(x.break_reason),
    }));
  }

  if (!health.error) {
    const h = ((health.data as { status: string; created_at: string }[] | null) ?? [])[0];
    // Only this morning's run counts: an old "ok" must not vouch for today.
    if (h && now.getTime() - new Date(h.created_at).getTime() < 26 * 3_600_000) {
      f.platformStatus = h.status === "ok" || h.status === "warn" || h.status === "fail" ? h.status : null;
    }
  }
  return f;
}

export async function morningReportNow(): Promise<MorningReport> {
  return buildMorningReport(await gatherFindings());
}

// ---------------------------------------------------------------------------
// Settings (site_settings, key night_watch_notify)
// ---------------------------------------------------------------------------

export async function getNotifySettings(): Promise<NotifySettings> {
  if (!isSupabaseServiceConfigured) return parseNotifySettings(null);
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("site_settings").select("value_json").eq("key", NOTIFY_SETTING_KEY).maybeSingle();
    if (error) return parseNotifySettings(null);
    return parseNotifySettings((data as { value_json: unknown } | null)?.value_json ?? null);
  } catch {
    return parseNotifySettings(null);
  }
}

export async function saveNotifySettings(s: NotifySettings, byId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("site_settings")
      .upsert(
        { key: NOTIFY_SETTING_KEY, label: "Night watch morning report: email and text (D182)", value_json: s, updated_by: byId },
        { onConflict: "key" },
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

function fallbackEmails(): string[] {
  return (process.env.ORDER_STAFF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function channelReadiness(s: NotifySettings) {
  const emailTo = s.emailTo.length > 0 ? s.emailTo : fallbackEmails();
  return {
    emailTo,
    ready: {
      emailProvider: Boolean(process.env.RESEND_API_KEY && process.env.ORDER_EMAIL_FROM),
      smsProvider: isSmsConfigured(),
      emailRecipients: emailTo.length,
    },
  };
}

// ---------------------------------------------------------------------------
// The cron run (and the owner's "send a test" button)
// ---------------------------------------------------------------------------

export type NightWatchOutcome = {
  report: MorningReport;
  sent: { email: boolean; sms: number };
  why: string;
  notes: string[];
};

async function deliver(report: MorningReport, s: NotifySettings, notes: string[]): Promise<{ email: boolean; sms: number; channels: string[]; recipients: string[] }> {
  const { emailTo, ready } = channelReadiness(s);
  const plan = notifyPlan(s, report, ready);
  const origin = publicSiteOrigin(process.env);
  const out = { email: false, sms: 0, channels: [] as string[], recipients: [] as string[] };
  if (plan.email) {
    const r = await sendStaffAlertEmail({
      apiKey: process.env.RESEND_API_KEY ?? "",
      from: process.env.ORDER_EMAIL_FROM ?? "",
      to: emailTo,
      subject: reportSubject(report),
      html: reportEmailHtml(report, origin),
    });
    if (r.ok) {
      out.email = true;
      out.channels.push("email");
      out.recipients.push(...emailTo);
    } else notes.push(`email failed: ${r.detail}`);
  }
  if (plan.sms) {
    const r = await sendStaffSms(s.smsTo, reportSmsText(report, origin));
    out.sms = r.sent;
    if (r.sent > 0) out.recipients.push(`text: ${r.sent} phone(s)`);
    for (const x of r.failed) notes.push(`text to ...${x.to.slice(-4)} failed: ${x.detail}`);
  }
  return out;
}

export async function runNightWatch(): Promise<NightWatchOutcome> {
  const notes: string[] = [];
  const report = await morningReportNow();
  const s = await getNotifySettings();
  const plan = notifyPlan(s, report, channelReadiness(s).ready);
  if (!plan.email && !plan.sms) return { report, sent: { email: false, sms: 0 }, why: plan.why, notes };
  if (!isSupabaseServiceConfigured) return { report, sent: { email: false, sms: 0 }, why: "Database not configured.", notes };

  const admin = createSupabaseAdminClient();
  const key = nightWatchKey(report.day);
  const { error: claimErr } = await admin.from("compliance_reminder_log").insert({
    dedupe_key: key,
    stage: "night_watch",
    week_key: null,
    channel: "email",
    subject: reportSubject(report),
    recipients: "pending",
  });
  if (claimErr) {
    if (claimErr.code === "23505") return { report, sent: { email: false, sms: 0 }, why: "Already sent today.", notes };
    notes.push(`could not claim today's send (${claimErr.message}); sending anyway`);
  }
  const d = await deliver(report, s, notes);
  if (!claimErr) {
    try {
      // channel's CHECK allows email / push / email+push; texts are recorded in recipients.
      await admin
        .from("compliance_reminder_log")
        .update({ recipients: (d.recipients.join(", ") || "nothing delivered").slice(0, 1000) })
        .eq("dedupe_key", key);
    } catch {
      // best effort: the claim already prevents a second send today
    }
  }
  return { report, sent: { email: d.email, sms: d.sms }, why: plan.why, notes };
}

/** The owner's "send me a test now": ignores the daily claim and the all-clear rule. */
export async function sendNightWatchTest(): Promise<NightWatchOutcome> {
  const notes: string[] = [];
  const report = await morningReportNow();
  const s = await getNotifySettings();
  const forced: NotifySettings = { ...s, sendAllClear: true };
  const plan = notifyPlan(forced, report, channelReadiness(forced).ready);
  if (!plan.email && !plan.sms) return { report, sent: { email: false, sms: 0 }, why: plan.why, notes };
  const d = await deliver(report, forced, notes);
  return { report, sent: { email: d.email, sms: d.sms }, why: plan.why, notes };
}
