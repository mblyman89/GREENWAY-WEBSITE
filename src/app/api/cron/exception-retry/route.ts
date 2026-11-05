/**
 * src/app/api/cron/exception-retry/route.ts   (D178 · S1 "Sales always land")
 *
 * Owner: "if product left the shop and money was given to me in exchange,
 * there can be no manual exceptions."
 *
 * Retries every register exception the pure core
 * (src/lib/pos/exception-retry-core.ts) calls a SYSTEM FAULT, or a harmless
 * lower discount rate, through the exact sync chain
 * (sync-store.runExceptionAutoRetry → retryPosException).
 *
 * SCHEDULING (AGENTS rule 12). vercel.json runs this every 5 minutes at
 * :03, :08, ... :58 ("3-59/5 * * * *", 288 ticks a day; pinned by
 * tests/compliance/leafly-certification.test.ts). The 3-minute offset keeps
 * it off content-schedule (:00), cutover-watch (:02) and ccrs-mail (:04).
 * No Pacific arithmetic: nothing here depends on the wall clock.
 *
 * A tick is a REQUEST TO CONSIDER, never a lock: each row is CLAIMED by a
 * compare-and-swap (status exception → pending, only while no order exists)
 * before it runs, and orders.pos_client_uuid is UNIQUE, so a doubled or
 * overlapping tick can never record a sale twice. Each row is tried at most
 * AUTO_RETRY_MAX_ATTEMPTS times, so a poison event cannot loop. A quiet tick
 * is one indexed read and writes nothing.
 *
 * AUTH. The same fail-closed preamble as /api/cron/cutover-watch.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { runExceptionAutoRetry } from "@/lib/pos/sync-store";

export const dynamic = "force-dynamic";
/** At most AUTO_RETRY_BATCH_LIMIT (10) sales, each a few seconds. */
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
    console.warn("[cron/exception-retry] CRON_SECRET unset \u2014 allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  const result = await runExceptionAutoRetry();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

// Vercel Cron uses GET. POST runs the same path.
export async function POST(req: NextRequest) {
  return GET(req);
}
