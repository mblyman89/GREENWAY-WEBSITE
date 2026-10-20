/**
 * src/app/api/cron/ccrs-mail/route.ts   (CCRS Bible v2 slice S-18a)
 *
 * Reads CCRS's answers (confirmation emails and error-CSV emails from
 * info@lcb.wa.gov) from the submitting Gmail mailbox and stores each once in
 * ccrs_mail_messages (0282) for the hub. Decisions: ccrs-mail-core (pure,
 * self-tested). Gmail calls: ccrs-mail-fetch. Tick: ccrs-mail-store.
 *
 * SCHEDULING (AGENTS rule 12). vercel.json runs this every 5 minutes at
 * :04, :09, ... :59 ("4-59/5 * * * *", 288 ticks a day; pinned by
 * tests/compliance/leafly-certification.test.ts cadence map). The 4-minute
 * offset keeps it off content-schedule (:00/:05) and cutover-watch (:02/:07);
 * L-33 bans two identical expressions. CCRS usually answers within 1-2
 * minutes of an upload, so the owner sees it in the hub within about 5.
 * A quiet tick is one token request, one messages.list (5 quota units) and one
 * indexed read; it writes nothing (the heartbeat refreshes every 30 minutes).
 *
 * A tick is a REQUEST TO CONSIDER, never a lock: each message is claimed by
 * inserting its Gmail id (UNIQUE), so a doubled tick stores nothing twice and a
 * skipped tick only delays a message by 5 minutes.
 *
 * AUTH. The same fail-closed preamble as /api/cron/cutover-watch (copied, not
 * shared, for the reason recorded in leafly-ack-sweep):
 *   - CRON_SECRET set            -> Bearer must match, else staff session.
 *   - Production + secret unset  -> staff session or 503. Never open.
 *   - Development + unset        -> warn and continue, for local testing.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { runCcrsMailTick } from "@/lib/compliance/ccrs-mail-store";

export const dynamic = "force-dynamic";
/** One token call, one list, up to 25 messages + their CSVs (15 s ceiling each). */
export const maxDuration = 300;

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
    console.warn("[cron/ccrs-mail] CRON_SECRET unset \u2014 allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  // Never throws. "Not set up yet" is routine (200, recorded in the heartbeat);
  // 500 only when a configured monitor failed, so Vercel's logs flag real faults.
  const result = await runCcrsMailTick();
  const status = result.ok || !result.configured ? 200 : 500;
  return NextResponse.json(result, { status });
}

// Vercel Cron uses GET. POST runs the same path.
export async function POST(req: NextRequest) {
  return GET(req);
}
