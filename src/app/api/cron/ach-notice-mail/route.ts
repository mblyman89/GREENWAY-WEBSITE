/**
 * src/app/api/cron/ach-notice-mail/route.ts   (R41 S17)
 *
 * The notice-email watch (ach-notice-mail-core / -store). It looks in the
 * company Google Workspace mailbox for the Federal Reserve's encrypted ACH
 * notice emails, using the same Workspace sign-in the CCRS monitor already
 * uses (no new keys).
 *
 * OFF BY DEFAULT. Until the owner turns it on at
 * /admin/settings/banking/notice-email, a tick reads one site_settings row
 * and returns 200 {reason:"off"}: no Google call of any kind.
 *
 * SCHEDULE: vercel.json "50 * * * *" = once an hour at :50 (24 a day; the
 * minute is not used by any other cron). Brenda (Timberland, 2026-10-19,
 * email 3; NOTICE_MAIL_QUOTES.brendaTwoWays / brendaEmail / brendaPortal)
 * says notices come two ways, a secure encrypted email and the portal's
 * reporting tab; the Fed guide (NOTICE_MAIL_QUOTES.fedDontRely) says not to
 * rely on the email. So the hourly look is
 * an early heads-up only. The daily portal check stays on the owner's list.
 *
 * NEVER A PAYMENT GATE: nothing here is read by payroll or the file builder.
 * It never opens the link in a notice email and never decrypts anything for
 * the email it sends (the alert carries only facts: sender, sign-in result,
 * link hosts, spam folder).
 *
 * AUTH: the same fail-closed preamble as the other ACH crons (copied, not
 * shared, as in the other crons).
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { runNoticeMailTick } from "@/lib/payments/ach-notice-mail-store";

export const dynamic = "force-dynamic";
/** A few Gmail reads at most; OFF is one database read. */
export const maxDuration = 120;

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
    console.warn("[cron/ach-notice-mail] CRON_SECRET unset \u2014 allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  const r = await runNoticeMailTick(Date.now());
  // OFF is a normal, healthy answer.
  if (r.reason === "off") return NextResponse.json({ ok: true, ran: false, reason: "off" });
  // Never echo message ids or mailbox details in the response body.
  const body = { ok: r.ok, ran: r.ran, reason: r.ok ? r.reason : r.reason.slice(0, 200), listed: r.listed, stored: r.stored, alerted: r.alerted, failures: r.failures.length };
  return NextResponse.json(body, { status: r.ok ? 200 : 500 });
}

// Vercel Cron uses GET. POST runs the same path.
export async function POST(req: NextRequest) {
  return GET(req);
}
