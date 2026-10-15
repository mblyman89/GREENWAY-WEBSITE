/**
 * src/app/api/cron/ach-funding-8am/route.ts   (R41 S9, plan point 4)
 *
 * The settlement-morning funding reminder. Timberland's agreement, section 14:
 * "Company shall provide Financial Institution with immediately available
 * funds not later than 9:00 a.m. PST on each Settlement Date". The app cannot
 * read the balance, so it reminds the owner to look.
 *
 * SCHEDULE: vercel.json "0 15-16/1 * * *" = 15:00 and 16:00 UTC. Vercel crons
 * run in UTC, so 8:00 am Pacific is 15:00 UTC in PDT (UTC-7) and 16:00 UTC in
 * PST (UTC-8). Both ticks come every day; a tick is a request to consider,
 * never a command (AGENTS.md rule 12): the pure planner planFundingReminders
 * sends only from 8:00 am Pacific up to the 9:00 am deadline, on the file's
 * own settlement day. In PDT the 16:00 tick is 9:00 am, so it sends nothing;
 * in PST the 15:00 tick is 7:00 am, so it sends nothing.
 *
 * ONE SEND PER FILE: the dedupe key `ach-funding:<id>:settle` is INSERTED into
 * compliance_reminder_log (UNIQUE, 0118) BEFORE the email goes out (a real
 * claim). If the email fails, the claim is removed so the next tick retries,
 * and the route answers 500.
 *
 * NEVER SILENT: if the ACH file list cannot be read, a "could not be read"
 * note is claimed once per day and sent, and the route answers 500.
 *
 * AUTH: the same fail-closed preamble as /api/cron/ach-deadline-1pm (copied,
 * not shared, as in the other crons).
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { fundingReadFailedReminder, planFundingReminders } from "@/lib/payments/timberland-funding-core";
import { readFilesForFundingReminder } from "@/lib/payments/ach-file-ledger-store";
import { resolveNotifyContacts } from "@/lib/payments/ach-authorization-core";
import { resendOpsMailer } from "@/lib/payments/ach-ops-store";
import { opsSiteUrl } from "@/lib/payments/ach-ops-ui-core";
import { escapeHtml } from "@/lib/pos/cutover-watch-core";
import { pacificDayKey } from "@/lib/reports/timezone";

export const dynamic = "force-dynamic";
/** One indexed read; normally zero emails, at most a few. */
export const maxDuration = 60;

const FILES_PATH = "/admin/settings/banking/operations";

type Planned = { dedupeKey: string; stage: string; subject: string; body: string };

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
    console.warn("[cron/ach-funding-8am] CRON_SECRET unset \u2014 allowing (dev only).");
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
  const read = await readFilesForFundingReminder(pacificDayKey(now));
  const planned: Planned[] = read.ok ? planFundingReminders(now, read.files) : [fundingReadFailedReminder(now, read.error)];
  if (planned.length === 0) return NextResponse.json({ ok: true, planned: 0, sent: 0 });

  const to = resolveNotifyContacts(process.env).contacts.michael.email;
  const db = createSupabaseAdminClient();
  const mail = resendOpsMailer();
  const link = `${opsSiteUrl(process.env)}${FILES_PATH}`;
  let sent = 0;
  let already = 0;
  const failed: string[] = read.ok ? [] : [`ACH files could not be read: ${read.error}`];
  for (const r of planned) {
    const { error: claimError } = await db
      .from("compliance_reminder_log")
      .insert({ dedupe_key: r.dedupeKey, stage: r.stage, channel: "email", subject: r.subject.slice(0, 300), recipients: to });
    if (claimError) {
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
