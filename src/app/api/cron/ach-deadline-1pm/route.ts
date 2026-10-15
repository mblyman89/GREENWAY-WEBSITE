/**
 * src/app/api/cron/ach-deadline-1pm/route.ts   (R41 S5)
 *
 * The 1 pm Pacific nudge on a Timberland deadline day (plan S5: "remind on
 * deadline-day morning and at 1 pm"). The morning reminder rides the daily
 * compliance run; this route is the afternoon pass.
 *
 * SCHEDULE: vercel.json "0 20-21/1 * * *" = 20:00 and 21:00 UTC. Vercel crons
 * run in UTC, so 1:00 pm Pacific is 20:00 UTC in PDT (UTC-7) and 21:00 UTC in
 * PST (UTC-8). Both ticks come every day; a tick is a request to consider,
 * never a command (AGENTS.md rule 12): the pure planner
 * planAfternoonDeadlineReminders sends only at or after 1:00 pm Pacific and
 * before the 4:00 pm cutoff, on the file's own deadline day. In PDT the 21:00
 * tick (2 pm) finds the reminder already claimed, so nothing is sent twice.
 *
 * ONE SEND PER FILE: each reminder's dedupe key `ach-deadline:<id>:1pm` is
 * INSERTED into compliance_reminder_log (UNIQUE, 0118) BEFORE the email goes
 * out (insert-then-send = a real claim, not a read-then-act check), so a
 * doubled tick or an overlapping run never sends twice. If the email then
 * fails, the claim is removed so the next tick retries, and the route answers
 * 500 so the Vercel log shows it.
 *
 * AUTH: the same fail-closed preamble as /api/cron/ach-approvals-reminder
 * (copied, not shared, as in the other crons).
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { planAfternoonDeadlineReminders } from "@/lib/payments/timberland-deadline-core";
import { readOpenFilesForDeadlines } from "@/lib/payments/ach-file-ledger-store";
import { resolveNotifyContacts } from "@/lib/payments/ach-authorization-core";
import { resendOpsMailer } from "@/lib/payments/ach-ops-store";
import { opsSiteUrl } from "@/lib/payments/ach-ops-ui-core";
import { escapeHtml } from "@/lib/pos/cutover-watch-core";
import { pacificToday } from "@/lib/reports/timezone";

export const dynamic = "force-dynamic";
/** One indexed read; normally zero emails, at most a few. */
export const maxDuration = 60;

const FILES_PATH = "/admin/settings/banking/operations";

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  const secret = process.env.CRON_SECRET ?? "";

  if (secret) {
    const header = req.headers.get("authorization") ?? "";
    if (header === `Bearer ${secret}`) return null; // cron OK
  } else if (shouldRefuseWhenSecretMissing(secret)) {
    const session = await getStaffSession().catch(() => null);
    if (session) return null;
    return NextResponse.json(
      { error: "CRON_SECRET is not configured; refusing unauthenticated cron calls." },
      { status: 503 },
    );
  } else {
    console.warn("[cron/ach-deadline-1pm] CRON_SECRET unset \u2014 allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  if (!isSupabaseServiceConfigured) return NextResponse.json({ ok: false, error: "Database not connected." }, { status: 503 });

  const now = new Date();
  const open = await readOpenFilesForDeadlines(pacificToday());
  // Never silent: an unreadable ledger is a 500 the Vercel log shows.
  if (!open.ok) return NextResponse.json({ ok: false, error: `ACH files could not be read: ${open.error}` }, { status: 500 });

  const planned = planAfternoonDeadlineReminders(now, open.files);
  if (planned.length === 0) return NextResponse.json({ ok: true, planned: 0, sent: 0 });

  const to = resolveNotifyContacts(process.env).contacts.michael.email;
  const db = createSupabaseAdminClient();
  const mail = resendOpsMailer();
  const link = `${opsSiteUrl(process.env)}${FILES_PATH}`;
  let sent = 0;
  let already = 0;
  const failed: string[] = [];
  for (const r of planned) {
    const { error: claimError } = await db
      .from("compliance_reminder_log")
      .insert({ dedupe_key: r.dedupeKey, stage: r.stage, channel: "email", subject: r.subject.slice(0, 300), recipients: to });
    if (claimError) {
      // Taken = another tick already sent it. Anything else is a failure to report.
      if (/duplicate key|unique/i.test(claimError.message ?? "")) already++;
      else failed.push(`${r.dedupeKey}: could not claim (${claimError.message})`);
      continue;
    }
    let ok = false;
    try {
      const html = `<p><strong>${escapeHtml(r.subject)}</strong></p><p>${escapeHtml(r.body)}</p><p><a href="${escapeHtml(link)}">Open ACH files</a></p>`;
      ok = (await mail([to], { subject: r.subject, html })).ok;
    } catch {
      ok = false;
    }
    if (ok) sent++;
    else {
      failed.push(`${r.dedupeKey}: email failed`);
      // Release the claim so the next tick tries again.
      await db.from("compliance_reminder_log").delete().eq("dedupe_key", r.dedupeKey);
    }
  }
  const okAll = failed.length === 0;
  return NextResponse.json({ ok: okAll, planned: planned.length, sent, already, failed }, { status: okAll ? 200 : 500 });
}

// Vercel Cron uses GET. POST runs the same path.
export async function POST(req: NextRequest) {
  return GET(req);
}
