/**
 * src/app/api/cron/inbound-reconcile/route.ts   (Fix Phase 3.2a, G-17 / F-04-4)
 *
 * The vendor_intake@ mailbox check. The owner (verbatim): "I want this table
 * to receive every manifest, no exceptions." The Resend webhook is the fast
 * path; this is the safety net professionals run behind every webhook: list
 * the source of truth (Resend's received mail AND the vendor_intake@ Gmail
 * mailbox), compare with inbound_email_log, pull in anything missing, retry
 * temporary failures with backoff, alert a person once per failure, and write
 * a heartbeat the Receiving page shows. Decisions: inbound-reconcile-core
 * (pure, self-tested). I/O: inbound-reconcile-store.
 *
 * SCHEDULING (AGENTS rule 12). vercel.json runs this every 15 minutes at
 * :07, :22, :37, :52 ("7-59/15 * * * *", 96 ticks a day; pinned by
 * tests/compliance/leafly-certification.test.ts cadence map). The 7-minute
 * offset keeps it off leafly-menu-sync (:00/:15/:30/:45), content-schedule
 * (:00/:05) and ccrs-mail (:04/:09); it shares minutes with cutover-watch's
 * 5-minute grid but is a different expression (L-33 bans two identical
 * expressions). An email the
 * webhook missed is on the table within about 30 minutes (15-minute grace +
 * one tick). A quiet tick is two list calls and one indexed read; it writes
 * nothing (the heartbeat refreshes every 30 minutes).
 *
 * A tick is a REQUEST TO CONSIDER, never a lock: each missed email is pulled
 * in under the insert-first delivery claim (0255 unique delivery_key), each
 * retry re-opens its row by compare-and-set, each alert is claimed in
 * compliance_reminder_log before it is sent. Two ticks at once stage nothing
 * twice and send nothing twice; a skipped tick only delays by 15 minutes.
 *
 * AUTH. The same fail-closed preamble as /api/cron/ccrs-mail (copied, not
 * shared, for the reason recorded in leafly-ack-sweep):
 *   - CRON_SECRET set            -> Bearer must match, else staff session.
 *   - Production + secret unset  -> staff session or 503. Never open.
 *   - Development + unset        -> warn and continue, for local testing.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { runReconcile } from "@/lib/inbound-email/inbound-reconcile-store";

export const dynamic = "force-dynamic";
/** Two lists, up to 5 missed emails + 3 retries, inside a 200 s budget (RUN_BUDGET_MS). */
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
    console.warn("[cron/inbound-reconcile] CRON_SECRET unset \u2014 allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  // Never throws. "Not set up yet" is routine (200, shown on Receiving);
  // 500 only when a configured source failed, so Vercel's logs flag real faults.
  const r = await runReconcile({ trigger: "cron" });
  const failed = r.configured && r.heartbeat !== null && !r.heartbeat.ok;
  return NextResponse.json(
    {
      ok: !failed,
      configured: r.configured,
      onTable: r.onTable,
      recovered: r.recovered,
      recoveredStaged: r.recoveredStaged,
      deferred: r.deferred,
      tooNew: r.tooNew,
      autoRetried: r.autoRetried,
      alertsSent: r.alertsSent,
      migrationApplied: r.migrationApplied,
      errors: r.errors.length,
    },
    { status: failed ? 500 : 200 },
  );
}

// Vercel Cron uses GET. POST runs the same path.
export async function POST(req: NextRequest) {
  return GET(req);
}
