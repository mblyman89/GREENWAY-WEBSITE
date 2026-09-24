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
 * `src/lib/leafly/schedule-core.ts` (300+ self-test assertions since L-34, no I/O), and the
 * reading/locking/pushing is done by `schedule-server.ts`. This file is only
 * auth plus a JSON response. If you are tempted to add an `if` about timing
 * here, it belongs in the core where it can be tested without a database.
 *
 * WHY IT IS SAFE TO CALL THIS MORE OFTEN THAN IT SYNCS
 * ---------------------------------------------------
 * Calling this endpoint is a REQUEST TO CONSIDER SYNCING, not a command to
 * sync. The core enforces the daily hour, the intraday interval, a 10-minute
 * hard floor between runs, backoff after repeated failures, and two in-flight
 * locks (plus, since L-34, a start-race tie-break for duplicate deliveries).
 * So a tick that arrives early, twice, or from a monitoring service costs a
 * few database reads and returns `pushed: false` with a reason. That
 * property is what makes a fifteen-minute cron, a staff "check now" press and
 * any external monitor safe to combine.
 *
 * SCHEDULING: VERCEL PRO, EVERY FIFTEEN MINUTES  (SLICE L-34)
 * -----------------------------------------------------------
 * Until L-34 this project was on Vercel Hobby, which permits one cron run per
 * day, so this route was registered once a day ("0 12 * * *") and the
 * intraday PUT half of Leafly's recommendation could only run from the
 * manual button or an external caller. The project is now on Vercel Pro
 * (required to deploy it at all -- see AGENTS.md, "Vercel plan"), whose cron
 * documentation allows a minimum interval of one minute with per-minute
 * precision. `vercel.json` now registers this route as:
 *
 *   "*" + "/15 * * * *"   -- every fifteen minutes, 96 ticks a day.
 *
 * (Written split because the two characters together would close this
 * comment block.)
 *
 * WHY FIFTEEN. It is INTRADAY_MINUTES_MIN, the finest interval the owner can
 * choose on the admin page, and every offered interval is a whole multiple
 * of it. A coarser tick would silently turn the owner's "every 15 minutes"
 * into something slower -- exactly what one-tick-a-day did to every setting.
 * A finer tick would buy nothing: the core would refuse it as not due. It
 * divides sixty, so every Pacific hour is visited and the configured daily
 * full-sync hour is hit on schedule in both PDT and PST; DAILY_CATCHUP_HOURS
 * remains as a safety net for a missed tick, no longer as the primary path.
 * All of this is pinned by tests/compliance/leafly-certification.test.ts.
 *
 * WHAT RAISING THE CADENCE EXPOSED, AND WHAT WAS FIXED FIRST. Running the
 * real core at 96 ticks a day (scripts/recon/l34-cadence-probe.mts) showed
 * three defects that one tick a day had hidden: each refusal row reset the
 * intraday clock, so a 60-minute setting pushed ONCE in six hours; a quiet
 * day's skipped daily POST was not counted, so the full sync was retried on
 * every tick; and a duplicate delivery of one tick could open two lock rows
 * and push twice. All three are fixed in schedule-core / schedule-server and
 * proven by executing the real server in
 * tests/compliance/leafly-l34-menu-sync-runtime.test.ts.
 *
 * COST. Vercel Pro bills function invocations at $0.60 per million (Vercel
 * docs, "Functions usage and pricing"). 96 a day is about 2,900 a month. A
 * tick that is not due does a handful of indexed reads and returns.
 *
 * The owner can still switch automation off entirely on the admin page; a
 * disabled schedule makes every tick a no-op that writes nothing.
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
 * and leaves a wide margin. It is also far shorter than the fifteen-minute
 * tick, so one run never overlaps the next scheduled one. It sits well under the core's
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
