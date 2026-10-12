/**
 * src/app/api/cron/content-schedule/route.ts   (R46-S1)
 *
 * The worker behind "Schedule: go live Friday 9 AM / come down Sunday 11 PM"
 * in the website editors, and behind Releases (R46-S2).
 *
 * It decides nothing itself:
 *   - WHAT is due and whether a failure retries -> content-schedule-core.ts
 *     (pure, self-tested);
 *   - HOW a change is made -> applyScheduledChange in
 *     content-schedule-server.ts, which calls the SAME publish functions as
 *     the editors' Publish buttons.
 *
 * SCHEDULING (AGENTS rule 12). vercel.json runs this every 5 minutes (288
 * ticks a day; pinned in vercel.json and by
 * tests/compliance/leafly-certification.test.ts L-34 cadence map). The
 * editor snaps every time UP to the same 5-minute grid, so "9:00 AM" is
 * applied by the 9:00 tick (Vercel Pro has per-minute precision). UTC is
 * irrelevant here: the rows hold UTC instants converted from Pacific when the
 * owner scheduled them (rule 9), so there is no Pacific arithmetic in the
 * cron expression. An idle tick is one indexed query on
 * content_schedule_due_idx and returns skipped "nothing_due".
 *
 * A tick is a REQUEST TO CONSIDER WORKING, never a lock:
 *   - each row is claimed with a compare-and-swap on (status, attempts);
 *   - a doubled tick loses the CAS and counts it under lostClaims;
 *   - a run killed mid-row leaves it "running": after 10 minutes the next
 *     tick retries it (publishing is idempotent), at most 3 attempts;
 *   - a skipped tick only delays a change by 5 minutes.
 *
 * AUTH. The same fail-closed preamble as /api/cron/lookup-jobs (copied, not
 * shared, for the reason recorded in leafly-ack-sweep):
 *   - CRON_SECRET set            -> Bearer must match, else staff session.
 *   - Production + secret unset  -> staff session or 503. Never open.
 *   - Development + unset        -> warn and continue, for local testing.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { runContentScheduleTick } from "@/lib/cms/content-schedule-server";

export const dynamic = "force-dynamic";
/** 25 rows a tick, each a few small queries: far below this. */
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
    console.warn("[cron/content-schedule] CRON_SECRET unset \u2014 allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  // Never throws. A change that fails is recorded on its own row (retried,
  // then "failed" with the reason on the Schedule page); only an unreadable
  // database is a 500, so the logs stay quiet when the system is healthy.
  const result = await runContentScheduleTick();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

// Vercel Cron uses GET. POST runs the same path.
export async function POST(req: NextRequest) {
  return GET(req);
}
