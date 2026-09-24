/**
 * src/app/api/cron/leafly-ack-sweep/route.ts  (SLICE L-33 — C7)
 *
 * THE NET UNDER THE NET.
 *
 * Slice L-33 makes the machine press acknowledge the moment a Leafly order
 * arrives, so that the owner never again has to say "hang on, I have to go
 * push a button in the office". That covers every order whose webhook lands.
 *
 * This endpoint covers the ones whose webhook DOESN'T.
 *
 *   > "Orders are acknowledged as having been retrieved in whole by your
 *   >  system within fifteen minutes of receiving an order submission webhook.
 *   >  Any orders not acknowledged by this deadline WILL BE AUTO CANCELED."
 *   >                                        — Leafly Order API, Expectations
 *
 * A deploy, a cold start that times out, a Supabase blip, or a delivery
 * failure on Leafly's side during those fifteen minutes, and a real order is
 * cancelled. The shopper is told by Leafly, not by us, so the first anyone at
 * Greenway hears about it is a customer who never came in.
 *
 * ── WHAT THIS ROUTE IS ──────────────────────────────────────────────────────
 * Auth, and a JSON body. Nothing else. It decides nothing:
 *
 *   • WHICH orders to sweep  → `planAutoAckSweep` in auto-ack-sweep-core.ts,
 *                              pure, 18,000+ self-test assertions, no I/O.
 *   • WHETHER to sweep at all → `isAutoAcknowledgeEnabled`, the SAME kill
 *                              switch that governs arrival. One flag, both
 *                              paths.
 *   • HOW to acknowledge      → `autoAcknowledgeOnArrival`, the SAME function
 *                              the webhook calls. There is exactly one piece
 *                              of code in this system that presses this
 *                              button, so a fix to one path fixes both.
 *
 * If you are tempted to add an `if` about timing here, it belongs in the core
 * where it can be proven without a database.
 *
 * ── SCHEDULING: EVERY TWO MINUTES ON VERCEL PRO  (SLICE L-34) ─────────────
 * Until L-34 this project was on Vercel Hobby ("limited to cron jobs that run
 * once per day"), so this route ran once a day at 13:00 UTC. That was recorded
 * honestly as a mismatch: a daily tick cannot protect a fifteen-minute
 * deadline, so it served mainly as a detector.
 *
 * The project is now on Vercel Pro (required to deploy it at all — see
 * AGENTS.md, "Vercel plan"). Pro crons may run as often as once a minute with
 * per-minute precision. The owner asked for a two-to-three minute sweep, and
 * vercel.json now registers this route every two minutes (720 ticks a day;
 * the expression is written in vercel.json and pinned by tests — it cannot be
 * quoted here because its first two characters would close this comment).
 *
 * WHY TWO, NOT ONE OR THREE. Leafly's window is fifteen minutes; the sweep
 * waits a two-minute grace period and stops thirty seconds short, leaving a
 * 12.5-minute actionable window. Worst-case phase, that is 6 chances per order
 * at two minutes, 4 at three, 12 at one. Two gives ample redundancy against a
 * skipped tick (Vercel describes delivery as best effort) at half the
 * invocations of one. Cost on Pro: about 21,600 invocations a month at
 * $0.60 per million. See scripts/recon/l34-cadence-probe.mts, PROBE 4.
 *
 * WHAT RAISING THE CADENCE EXPOSED, AND WHAT WAS FIXED FIRST. Executing the
 * real core at 720 ticks a day showed that a Leafly-cancelled order was
 * classed "expired" on every tick forever (one lost order → 720 alarms a
 * day), that historic rows could crowd a live order out of the query window,
 * and that two concurrent runs could both press acknowledge on the same order
 * and create its register order twice. Fixed in auto-ack-sweep-core
 * (`canceledAt`, `out_of_window`, `decideSweepClaim`) and auto-ack-server
 * (the bounded query and the compare-and-swap claim), and proven by running
 * the real server in tests/compliance/leafly-l34-sweep-concurrency.test.ts.
 *
 * THE 502 ALARM AT THIS CADENCE. An order past its deadline is reported as
 * `expired` only for SWEEP_EXPIRED_REPORT_MS (ten minutes) after the
 * deadline, i.e. on a handful of consecutive runs, then it drops out as
 * `out_of_window`. So an uptime monitor sees a short burst of 502s per lost
 * order — loud enough to notice, bounded so it never becomes noise.
 *
 * CALLING THIS MORE OFTEN IS SAFE. A tick is a REQUEST TO CONSIDER SWEEPING.
 * The grace period ignores anything younger than two minutes, the claim and
 * the idempotency re-read ignore anything another run or path has touched,
 * and a run with nothing to do costs one indexed query and returns
 * `acknowledged: 0`. maxDuration (below, 60 s) is shorter than the two-minute
 * tick, so one run cannot normally overlap the next; the case that remains is
 * Vercel delivering the same tick twice, which is exactly what the claim is
 * for.
 *
 * ── AUTH ────────────────────────────────────────────────────────────────────
 * Identical fail-closed posture to /api/cron/leafly-menu-sync and
 * /api/cron/atm-sync. Copied rather than shared for the reason recorded there:
 * it is an auth preamble, and a shared one would couple five unrelated routes.
 *
 *   • CRON_SECRET set            → Bearer must match, else staff-session fallback.
 *   • Production + secret unset  → staff session or 503. Never open.
 *   • Development + unset        → warn-and-continue, for local testing.
 *
 * The staff-session fallback is a feature here, not a loophole: it is what
 * lets a "check for missed orders now" button reach this without a second
 * endpoint, and what lets the owner verify the sweeper works by visiting the
 * URL while logged in.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { sweepUnacknowledgedLeaflyOrders } from "@/lib/leafly/auto-ack-server";

export const dynamic = "force-dynamic";

/**
 * The sweep is one indexed query plus, at most, `SWEEP_MAX_PER_RUN` (10)
 * sequential HTTPS calls to Leafly, each with its own bounded database writes.
 * 60s matches the other cron routes and leaves a wide margin: the realistic
 * case is zero or one call.
 *
 * The per-run cap is what makes this number safe. Without it, a backlog would
 * turn one tick into an unbounded loop and the function would be killed
 * mid-flight, leaving no record of what it had already done.
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
    console.warn("[cron/leafly-ack-sweep] CRON_SECRET unset — allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;

  // Never throws. `sweepUnacknowledgedLeaflyOrders` converts every failure
  // into a result, for the same reason the menu sync does: a cron endpoint
  // that 500s teaches whoever reads the logs to ignore it, and an ignored
  // alarm on this particular route means orders are being lost unnoticed.
  const result = await sweepUnacknowledgedLeaflyOrders();

  // ── THE STATUS CODE IS THE ALARM ──────────────────────────────────────────
  //
  // 200 when the run was clean, INCLUDING when it did nothing. A quiet sweep
  // is a successful sweep — it means every webhook arrived and the arrival
  // hook did its job.
  //
  // 502 when `expired > 0` or `failed > 0`. Both mean something is wrong
  // upstream of this endpoint:
  //
  //   • `expired` — an order passed Leafly's deadline unacknowledged. A
  //     customer's order was cancelled. This is not a sweeper failure, it is
  //     the sweeper CORRECTLY REPORTING a failure elsewhere, and it must be
  //     loud. A 200 here would leave the single most important number in this
  //     system visible only to somebody who opened the response body.
  //
  //   • `failed` — we tried to acknowledge and Leafly refused.
  //
  // `acknowledged > 0` alone is deliberately NOT an error status, because the
  // run succeeded — but it IS called out in the body, because every swept
  // order is an arrival webhook that did not work.
  const status = result.expired > 0 || result.failed > 0 ? 502 : 200;

  return NextResponse.json(
    {
      ok: result.expired === 0 && result.failed === 0,
      examined: result.examined,
      acknowledged: result.acknowledged,
      failed: result.failed,
      expired: result.expired,
      deferred: result.deferred,
      // True when the arrival path demonstrably did not do its job. Named as a
      // flag rather than left for the reader to infer from `acknowledged > 0`,
      // so an uptime monitor can alert on it without parsing prose.
      arrivalPathSuspect: result.acknowledged > 0 || result.expired > 0,
      message: result.summary,
      details: result.details,
    },
    { status },
  );
}

// Vercel Cron uses GET. POST is supported so the admin UI, an external
// scheduler, or a phone shortcut can trigger the same consider-and-maybe-sweep
// path without a second endpoint.
export async function POST(req: NextRequest) {
  return GET(req);
}
