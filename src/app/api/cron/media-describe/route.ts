/**
 * src/app/api/cron/media-describe/route.ts   (D221 M4)
 *
 * Owner: "use gpt-6-luna with detail high" (the closer look) to write alt
 * text, SEO and the subject / brand check for every image in the media
 * library, resumable, with a budget cap, recorded in media_ai_runs.
 *
 * The Start button on /admin/media only writes a media_ai_runs row (status
 * running). Every 10 minutes at :08, :18 ... :58 ("8-59/10 * * * *", UTC; the
 * minute is the same in Pacific because Pacific is a whole-hour offset; every
 * 5-minute offset is already used by another cron, and :08 is shared only with
 * exception-retry's one-read tick) this
 * route takes the run's lease by compare-and-set (lease_token / lease_until)
 * and describes the next images for about 270 seconds
 * (media-describe-store.tickDescribe). The run stops itself when the budget
 * is spent or when nothing is left; a "follow new" run stays open so every
 * image harvested later is described within one tick, about 10 minutes (inline at harvest).
 * An idle tick (no run going) is ONE media_ai_runs read and writes nothing.
 *
 * AUTH. The same fail-closed preamble as /api/cron/coa-trust-all.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { tickDescribe } from "@/lib/media/media-describe-store";

export const dynamic = "force-dynamic";
/** DESCRIBE_TICK_MS (270 s) of work plus headroom; the lease (330 s) outlives it. */
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
    console.warn("[cron/media-describe] CRON_SECRET unset \u2014 allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  const result = await tickDescribe();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

// Vercel Cron uses GET. POST runs the same path.
export async function POST(req: NextRequest) {
  return GET(req);
}
