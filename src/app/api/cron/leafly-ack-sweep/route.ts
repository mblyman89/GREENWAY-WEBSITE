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
 *                              pure, 3,657 self-test assertions, no I/O.
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
 * ── SCHEDULING: A MEASURED CONSTRAINT, NOT A DESIGN CHOICE ──────────────────
 * This project is on Vercel Hobby (recorded in docs/CRYPTO_PORTFOLIO_BIBLE.md
 * and corroborated by all four existing crons being once-daily). Vercel's
 * documentation states Hobby accounts are "limited to cron jobs that run once
 * per day" and that a sub-daily expression "will fail during deployment".
 *
 * THIS IS A GENUINE MISMATCH AND IT IS RECORDED RATHER THAN PAPERED OVER: a
 * once-daily tick cannot protect a fifteen-minute deadline. A daily run will
 * essentially always find orders in the `expired` bucket rather than the
 * `sweep` one.
 *
 * That does NOT make the endpoint pointless, and it is registered in
 * vercel.json deliberately, for three reasons:
 *
 *   1. AS A DETECTOR. A daily run that reports `expired > 0` is the only thing
 *      in this system that will ever tell the owner "your arrival webhook is
 *      failing and you are losing orders". Without it, a broken arrival path
 *      is invisible until a customer complains. Catching the loss late is
 *      worth much more than not knowing about it.
 *
 *   2. BECAUSE THE SAVE IS SOMETIMES REAL. The window is fifteen minutes from
 *      the webhook, and the daily tick will occasionally land inside one. A
 *      sweeper that saves one order a month has paid for itself.
 *
 *   3. BECAUSE IT IS READY. The moment the owner adds any sub-daily trigger —
 *      Vercel Pro, an UptimeRobot monitor hitting this URL every five minutes
 *      with the CRON_SECRET, a GitHub Actions schedule, a phone shortcut —
 *      the net becomes a real one with no code change at all. Every one of
 *      those is free or nearly so. That decision is the owner's to make and is
 *      recorded here rather than made for him; see docs/l33-auto-acknowledge-
 *      facts.md for the options written out.
 *
 * CALLING THIS MORE OFTEN IS SAFE AND IS THE POINT. A tick is a REQUEST TO
 * CONSIDER SWEEPING. The core's grace period ignores anything younger than two
 * minutes, the idempotency check ignores anything already acknowledged, and a
 * run with nothing to do costs one indexed query and returns `acknowledged: 0`.
 *
 * ── WHY "0 13 * * *" ────────────────────────────────────────────────────────
 * vercel.json is JSON and cannot carry a comment, so the arithmetic lives
 * here. Vercel cron expressions are UTC; Greenway is Pacific.
 *
 *   13:00 UTC → 06:00 PDT (summer) / 05:00 PST (winter)
 *
 * Early morning Pacific, which is BEFORE the shop opens. That is deliberate:
 * an overnight order that arrived after closing and whose webhook was missed
 * gets examined before anyone is on the floor, and the alarm is already on
 * screen when the first person logs in.
 *
 * It also avoids all four existing crons (12:00, 14:00, 16:00, 17:00 UTC), so
 * no two jobs on this project contend for the same cold start.
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
