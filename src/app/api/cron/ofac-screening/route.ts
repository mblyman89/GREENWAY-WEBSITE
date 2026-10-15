/**
 * src/app/api/cron/ofac-screening/route.ts   (R41 S11)
 *
 * The daily OFAC sanctions screen of every payee (employees and vendors).
 * Timberland ACH agreement, section 3: "It shall be the responsibility of
 * Company to obtain information regarding such OFAC enforced sanctions."
 *
 * SCHEDULE: vercel.json "30 13 * * *" = 13:30 UTC, which is 6:30 am PDT or
 * 5:30 am PST: before the business day, so a list OFAC published the day
 * before is screened before anyone builds a file. It screens every day (a
 * full screen takes seconds), so every day has its own record.
 *
 * NEVER A PAYMENT GATE: nothing here is read by payroll or the vendor file
 * builder. The answer is a record and, when something needs the owner, an
 * email.
 *
 * EMAILS (claimed in compliance_reminder_log first, a real claim, like
 * /api/cron/ach-funding-8am; if the email fails the claim is removed so the
 * next run retries):
 *   - possible matches to review: once when the set of unreviewed matches
 *     changes, and again each week while they wait;
 *   - a failed screen: once per Pacific day.
 *
 * AUTH: the same fail-closed preamble as the other ACH crons (copied, not
 * shared, as in the other crons).
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { runOfacScreening } from "@/lib/payments/ofac-screening-store";
import { screeningEmail, screeningFailedEmail, weekKey } from "@/lib/payments/ofac-screening-core";
import { resolveNotifyContacts } from "@/lib/payments/ach-authorization-core";
import { resendOpsMailer } from "@/lib/payments/ach-ops-store";
import { opsSiteUrl } from "@/lib/payments/ach-ops-ui-core";
import { escapeHtml } from "@/lib/pos/cutover-watch-core";
import { pacificDayKey } from "@/lib/reports/timezone";

export const dynamic = "force-dynamic";
/** Four downloads (about 7 MB) and a screen of every payee: well under a minute, with room. */
export const maxDuration = 300;

const PAGE = "/admin/settings/banking/screening";

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
    console.warn("[cron/ofac-screening] CRON_SECRET unset \u2014 allowing (dev only).");
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
  const day = pacificDayKey(now);
  const link = `${opsSiteUrl(process.env)}${PAGE}`;
  const r = await runOfacScreening({ trigger: "cron", actorId: null });

  let planned: { dedupeKey: string; subject: string; text: string } | null = null;
  if (!r.ok) {
    const m = screeningFailedEmail(r.error, link);
    planned = { dedupeKey: `ofac-screening:failed:${day}`, ...m };
  } else {
    const m = screeningEmail(
      {
        ranAt: `${day} (Pacific)`,
        payees: r.payees,
        possibleMatches: r.possibleMatches,
        needsReview: r.needsReview,
        trueMatches: r.trueMatches,
        unscreenable: r.unscreenable,
        listLastModified: r.listLastModified,
        digestVerified: r.digestVerified,
      },
      link,
    );
    if (m) planned = { dedupeKey: `ofac-screening:attention:${r.pendingKey.slice(0, 24)}:${r.trueMatches}:${r.unscreenable}:${weekKey(day)}`, ...m };
  }

  const summary = r.ok
    ? { ok: true, runId: r.runId, payees: r.payees, possibleMatches: r.possibleMatches, needsReview: r.needsReview }
    : { ok: false, error: r.error, recorded: r.recorded };
  if (!planned) return NextResponse.json({ ...summary, emailed: false });

  const to = resolveNotifyContacts(process.env).contacts.michael.email;
  const db = createSupabaseAdminClient();
  const { error: claimError } = await db
    .from("compliance_reminder_log")
    .insert({ dedupe_key: planned.dedupeKey, stage: "ofac-screening", channel: "email", subject: planned.subject.slice(0, 300), recipients: to });
  let emailed = false;
  let emailError: string | null = null;
  if (claimError) {
    if (!/duplicate key|unique/i.test(claimError.message ?? "")) emailError = `could not claim (${claimError.message})`;
  } else {
    try {
      const html = `<p><strong>${escapeHtml(planned.subject)}</strong></p><p>${escapeHtml(planned.text)}</p><p><a href="${escapeHtml(link)}">Open Sanctions screening</a></p>`;
      emailed = (await resendOpsMailer()([to], { subject: planned.subject, html })).ok;
    } catch {
      emailed = false;
    }
    if (!emailed) {
      emailError = "email failed";
      await db.from("compliance_reminder_log").delete().eq("dedupe_key", planned.dedupeKey);
    }
  }
  const okAll = r.ok && emailError === null;
  return NextResponse.json({ ...summary, emailed, emailError }, { status: okAll ? 200 : 500 });
}

// Vercel Cron uses GET. POST runs the same path.
export async function POST(req: NextRequest) {
  return GET(req);
}
