/**
 * src/app/api/cron/ach-approvals-reminder/route.ts   (R41 S0, D-7)
 *
 * The owner's decision D-7 (recorded in R41-TIMBERLAND-SLICE-PLAN.md):
 * Stephen's ACH requests never expire, Michael gets a daily reminder, and a
 * stale request is refused when he approves it. This cron is the reminder.
 *
 * Once a day (vercel.json "0 15 * * *" UTC = 7am PST / 8am PDT; Vercel crons
 * run in UTC). It counts the requests waiting for Michael and the stop
 * actions he has not checked off yet. If both are zero it sends nothing. Otherwise
 * it claims today's Pacific dedupe key `ach_approvals:<YYYY-MM-DD>` in
 * compliance_reminder_log (UNIQUE, 0118) BEFORE sending, so a doubled tick
 * or a manual re-run never sends twice in one day.
 *
 * AUTH: the same fail-closed preamble as /api/cron/cutover-watch (copied,
 * not shared, as in the other crons):
 *   - CRON_SECRET set            -> Bearer must match, else staff session.
 *   - Production + secret unset  -> staff session or 503. Never open.
 *   - Development + unset        -> warn and continue, for local testing.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { dailyReminderEmail } from "@/lib/auth/ach-authority-core";
import { pacificWhen } from "@/lib/payments/ach-gate-core";
import { claimDailyReminder, countWaitingForOwner, markReminded } from "@/lib/payments/ach-requests-store";
import { APPROVALS_PATH } from "@/lib/payments/ach-gate";
import { resolveNotifyContacts } from "@/lib/payments/ach-authorization-core";
import { resendOpsMailer } from "@/lib/payments/ach-ops-store";
import { opsSiteUrl } from "@/lib/payments/ach-ops-ui-core";
import { pacificToday } from "@/lib/reports/timezone";

export const dynamic = "force-dynamic";
/** Two small reads, one insert, one email. */
export const maxDuration = 60;

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
    console.warn("[cron/ach-approvals-reminder] CRON_SECRET unset \u2014 allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;

  const waiting = await countWaitingForOwner();
  const msg = dailyReminderEmail({
    pending: waiting.pending,
    toReview: waiting.toReview,
    oldestPacific: waiting.oldest ? pacificWhen(new Date(waiting.oldest)) : null,
    url: `${opsSiteUrl(process.env)}${APPROVALS_PATH}`,
  });
  if (!msg) return NextResponse.json({ ok: true, sent: false, reason: "nothing waiting" });

  const today = pacificToday();
  const to = resolveNotifyContacts(process.env).contacts.michael.email;
  const claimed = await claimDailyReminder(today, msg.subject, to);
  if (!claimed) return NextResponse.json({ ok: true, sent: false, reason: "already sent today", day: today });

  let sent = false;
  try {
    sent = (await resendOpsMailer()([to], msg)).ok;
  } catch {
    sent = false;
  }
  if (sent) await markReminded(today);
  // 500 when the email failed, so the Vercel log shows it (never silent).
  return NextResponse.json({ ok: sent, sent, day: today, pending: waiting.pending, toReview: waiting.toReview }, { status: sent ? 200 : 500 });
}

// Vercel Cron uses GET. POST runs the same path.
export async function POST(req: NextRequest) {
  return GET(req);
}
