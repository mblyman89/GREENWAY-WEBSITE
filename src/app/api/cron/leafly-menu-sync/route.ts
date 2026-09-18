/**
 * src/app/api/cron/leafly-menu-sync/route.ts  (SLICE L-7)
 *
 * The automatic half of Leafly menu syncing. The manual push button on
 * /admin/integrations/leafly is the other half, and both are deliberate: the
 * schedule is what Leafly grades, and the button is what you reach for when you
 * have just changed a price and do not want to wait.
 *
 * WHY THIS ENDPOINT EXISTS AT ALL
 * -------------------------------
 * Leafly's menu certification checklist grades sync CADENCE (criterion 3:
 * "daily full POST + PUT/DELETE for intraday changes"), and criterion 4
 * disqualifies request signatures that look hand-driven. Until this route
 * existed, the only thing that ever pushed the menu was a person clicking a
 * button, which fails both criteria. See `certification-core.ts`.
 *
 * THIS ROUTE DECIDES NOTHING
 * --------------------------
 * Every "should we sync now" question is answered by the pure core in
 * `src/lib/leafly/schedule-core.ts` (156 self-test assertions, no I/O), and the
 * reading/locking/pushing is done by `schedule-server.ts`. This file is only
 * auth plus a JSON response. If you are tempted to add an `if` about timing
 * here, it belongs in the core where it can be tested without a database.
 *
 * WHY IT IS SAFE TO CALL THIS MORE OFTEN THAN IT SYNCS
 * ---------------------------------------------------
 * Calling this endpoint is a REQUEST TO CONSIDER SYNCING, not a command to
 * sync. The core enforces the daily hour, the intraday interval, a 10-minute
 * hard floor between runs, backoff after repeated failures, and two in-flight
 * locks. So a tick that arrives early, twice, or from a monitoring service
 * costs one database read and returns `pushed: false` with a reason. That
 * property is what makes the external-scheduler option below safe.
 *
 * SCHEDULING REALITY ON THIS PROJECT (measured, not assumed)
 * ----------------------------------------------------------
 * Vercel's cron docs (read 2026-09-18; page last updated 2026-07-15) state that
 * Hobby accounts are "limited to cron jobs that run once per day" and that a
 * sub-daily expression "will fail during deployment". This project is recorded
 * as Vercel Hobby in `docs/CRYPTO_PORTFOLIO_BIBLE.md`, and all three existing
 * crons are once-daily, which corroborates it.
 *
 * So `vercel.json` registers this route ONCE per day. That single tick is
 * enough to satisfy Leafly's "daily full POST" recommendation, and the core's
 * `DAILY_CATCHUP_HOURS` guarantee means a tick which lands slightly off the
 * configured hour (DST drift, or Vercel's documented +-59 minute precision)
 * still performs the full sync instead of silently skipping a day.
 *
 * The intraday PUT half of Leafly's recommendation needs more than one tick a
 * day, which this plan cannot schedule. It is NOT dead code and it is not
 * aspirational: it runs on every tick this endpoint receives. Three things
 * already drive it without any plan change --
 *   1. the manual push button, which the owner asked to keep;
 *   2. an authenticated staff session hitting this URL (the `GET` fallback
 *      below), which is how the "Run the check now" button in the admin UI
 *      works;
 *   3. any external scheduler calling this URL with the CRON_SECRET.
 * Upgrading to Vercel Pro would let `vercel.json` do (3) itself. That is a
 * billing decision for the owner, recorded rather than made for him, and
 * nothing here breaks either way.
 *
 * WHY THE SCHEDULE IS "0 12 * * *" (and not 11, and not 0)
 * --------------------------------------------------------
 * `vercel.json` is JSON and cannot carry a comment, so the arithmetic lives
 * here. Vercel cron expressions are UTC; Greenway is Pacific (UTC-7 in summer,
 * UTC-8 in winter), and the schedule default is a 4am Pacific full sync:
 *
 *   12:00 UTC -> 05:00 PDT (summer)  /  04:00 PST (winter)
 *
 * Both land AT OR AFTER the 4am default, in both halves of the year, so the
 * hour gate never blocks the single daily tick this plan allows. 11:00 UTC was
 * the obvious choice for "4am Pacific" and is subtly worse: it becomes 03:00
 * PST in winter, i.e. BELOW the configured hour, leaving the daily sync
 * dependent on the catch-up rule rather than on the schedule working as
 * written. Midnight was rejected because it is when every other system on
 * shared infrastructure runs its jobs.
 *
 * It also avoids the three existing crons (14:00, 16:00, 17:00 UTC), so no two
 * jobs on this project contend for the same cold start.
 *
 * AUTH -- identical fail-closed posture to /api/cron/atm-sync:
 *   - CRON_SECRET set           -> Bearer must match, else staff-session fallback.
 *   - Production + secret unset -> staff session or 503 (never open).
 *   - Development + unset       -> warn-and-continue for local testing.
 *
 * The staff-session fallback is not a loophole here; it is the feature that
 * lets the admin page offer a "check now" button without a second endpoint.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { runScheduledLeaflySync } from "@/lib/leafly/schedule-server";

export const dynamic = "force-dynamic";
/**
 * A menu push is one HTTPS request to Leafly plus the menu query behind it. The
 * manual button completes in seconds. 60s is the same ceiling the ATM sync uses
 * and leaves a wide margin; it also sits well under the core's
 * STALE_RUN_MINUTES (30), so a function killed at this limit is guaranteed to
 * have its lock released by the staleness rule rather than wedging automation.
 */
export const maxDuration = 60;

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
    console.warn("[cron/leafly-menu-sync] CRON_SECRET unset — allowing (dev only).");
    return null;
  }

  // Secret set but the header did not match — fall back to a staff session,
  // which is how the admin page's "Run the check now" button reaches this.
  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;

  // Never throws: `runScheduledLeaflySync` converts every failure into an
  // outcome. A cron endpoint that 500s tells Vercel's log a story about
  // infrastructure when the truth is usually "Leafly said no", and the
  // difference matters when the owner is trying to work out what happened.
  const outcome = await runScheduledLeaflySync();

  // HTTP 200 for "we considered it and here is what happened", including a
  // reasoned refusal. A refusal is a SUCCESSFUL tick: the scheduler did exactly
  // its job by declining. Only a genuine failure to push is reported as 502, so
  // that Vercel's cron log distinguishes "nothing to do" from "Leafly rejected
  // us" without anybody reading the body.
  const status = outcome.disposition === "failed" || outcome.disposition === "blocked" ? 502 : 200;

  return NextResponse.json(
    {
      ok: outcome.disposition !== "failed" && outcome.disposition !== "blocked",
      pushed: outcome.pushed,
      code: outcome.decision.code,
      method: outcome.decision.method,
      disposition: outcome.disposition,
      httpStatus: outcome.httpStatus,
      itemCount: outcome.itemCount,
      planSummary: outcome.planSummary,
      needsAttention: outcome.decision.needsAttention,
      message: outcome.message,
    },
    { status },
  );
}

// Vercel Cron uses GET; POST is supported so the admin UI and any external
// scheduler can trigger the same consider-and-maybe-sync path.
export async function POST(req: NextRequest) {
  return GET(req);
}
