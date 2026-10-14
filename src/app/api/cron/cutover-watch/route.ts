/**
 * src/app/api/cron/cutover-watch/route.ts   (R50 A4)
 *
 * Failure alerts for the cutover jobs nobody is watching: the Cultivera
 * harvest (crawler thread, 10-30 min) and the import it feeds. Decisions:
 * src/lib/pos/cutover-watch-core.ts (pure, self-tested). Claims + sends:
 * src/lib/pos/cutover-watch.ts.
 *
 * SCHEDULING (AGENTS rule 12). vercel.json runs this every 5 minutes (288
 * ticks a day; pinned by tests/compliance/leafly-certification.test.ts L-34
 * cadence map). Five minutes is the delay between a harvest failing and the
 * owner's phone buzzing. No Pacific arithmetic: the watch windows are
 * relative ("last 6 hours"), not wall-clock times. An idle tick (nothing
 * started in 6 h, no failed/processing import in 24 h) is two indexed reads
 * and sends nothing.
 *
 * A tick is a REQUEST TO CONSIDER, never a lock: each alert is claimed by
 * inserting its dedupe key into compliance_reminder_log (UNIQUE) before it is
 * sent, so a doubled tick sends nothing twice; a skipped tick only delays an
 * alert by 5 minutes; a quiet tick writes nothing.
 *
 * AUTH. The same fail-closed preamble as /api/cron/content-schedule (copied,
 * not shared, for the reason recorded in leafly-ack-sweep):
 *   - CRON_SECRET set            -> Bearer must match, else staff session.
 *   - Production + secret unset  -> staff session or 503. Never open.
 *   - Development + unset        -> warn and continue, for local testing.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { runCutoverWatchTick } from "@/lib/pos/cutover-watch";

export const dynamic = "force-dynamic";
/** Two small reads, at most 3 crawler GETs (20 s ceiling each), a few sends (8 s ceiling each). */
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
    console.warn("[cron/cutover-watch] CRON_SECRET unset \u2014 allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  // Never throws. 500 only when the database could not be read or a claim
  // failed, so the Vercel logs stay quiet while the cutover is healthy.
  const result = await runCutoverWatchTick();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

// Vercel Cron uses GET. POST runs the same path.
export async function POST(req: NextRequest) {
  return GET(req);
}
