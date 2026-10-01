/**
 * src/app/api/cron/lookup-jobs/route.ts   (bible SLICE S13, Phase 2, Ring 1)
 *
 * The worker behind "Look up all N products on this manifest".
 *
 * The button only writes a job (lookup_jobs + one lookup_job_items row per
 * product). THIS route does the work, on the server, on a schedule, so the
 * batch keeps going after the person closes the tab (bible S13 acceptance:
 * "survives closing the tab"). It decides nothing itself:
 *
 *   - WHAT to do and WHEN to stop -> lookup-job-core.ts (pure, self-tested).
 *   - HOW one product is looked up -> runOneItem in lookup-job-server.ts,
 *     which calls the SAME recall / lookup / attach functions as the row's
 *     AI Lookup + Save selected. One code path; a fix to one fixes both.
 *
 * SCHEDULING (AGENTS rule 12). vercel.json runs this every minute (1,440
 * ticks a day; the expression is pinned in vercel.json and by
 * tests/compliance/leafly-certification.test.ts and cannot be quoted here
 * because its characters would close this comment). An idle tick costs one
 * indexed query on lookup_jobs_open_idx and returns skipped "no_job".
 *
 * A tick is a REQUEST TO CONSIDER WORKING, never a lock:
 *   - the job lease is taken with a compare-and-swap on lease_token;
 *   - LOOKUP_LEASE_MS (840 s) outlives maxDuration (800 s), so a live run is
 *     never overtaken, and the ticks that land while it runs see "leased";
 *   - each product is claimed with a compare-and-swap on (status, attempts);
 *   - a run killed mid-product leaves the item "running": the next lease
 *     requeues it once, then fails it with a plain reason;
 *   - a doubled tick loses the lease CAS and returns "leased";
 *   - a skipped tick only delays the batch by one minute.
 *
 * TIME. maxDuration 800 s is the Vercel Pro maximum with Fluid compute (docs
 * "Vercel Functions Limits", last updated 2026-08-24, read 2026-10-01). Work
 * stops being STARTED at LOOKUP_TICK_BUDGET_MS (760 s) minus one worst-case
 * product (LOOKUP_ITEM_WORST_MS, 300 s: the web lookup's own 290 s abort
 * plus reads and writes), so a product is only started when it can finish,
 * and at most LOOKUP_MAX_ITEMS_PER_TICK (12) per run.
 *
 * FLAG. MANIFEST_BATCH_LOOKUP (default on). Off: returns before any database
 * read. AI_API_KEY unset or ATTACH_FACTS_V2 off: returns before any write.
 *
 * AUTH. The same fail-closed preamble as /api/cron/leafly-ack-sweep (copied,
 * not shared, for the reason recorded there):
 *   - CRON_SECRET set            -> Bearer must match, else staff session.
 *   - Production + secret unset  -> staff session or 503. Never open.
 *   - Development + unset        -> warn and continue, for local testing.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { runLookupJobsTick } from "@/lib/catalog/lookup-job-server";

export const dynamic = "force-dynamic";

/** = LOOKUP_TICK_MAX_DURATION_S in lookup-job-core.ts (pinned equal by tests). */
export const maxDuration = 800;

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
    console.warn("[cron/lookup-jobs] CRON_SECRET unset \u2014 allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;

  // Never throws. A product that fails is recorded on its own row and the
  // batch carries on; only a broken run (database unreadable) is a 500, so
  // the logs stay quiet when the system is healthy.
  const result = await runLookupJobsTick();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

// Vercel Cron uses GET. POST runs the same consider-and-maybe-work path.
export async function POST(req: NextRequest) {
  return GET(req);
}
