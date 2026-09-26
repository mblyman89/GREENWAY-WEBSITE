/**
 * POST /api/announcer/poll  (SLICE 28, cost-shaped in USAGE-1)
 *
 * The long-poll a Raspberry Pi lives inside.
 *
 * THE SHAPE, AND WHY
 * ------------------
 * The Pi opens this request and the server holds it for up to
 * POLL_HOLD_SECONDS (25) waiting for work. If work appears, it answers
 * immediately; otherwise it answers "nothing" and the Pi rests for
 * `idleRestSeconds` (POLL_IDLE_REST_SECONDS) before asking again.
 *
 * 25 seconds is not arbitrary. The longest maxDuration anywhere in this
 * repository is 60 (src/app/api/pos/sync/route.ts), and a request that
 * outlives the platform limit is truncated in a way that looks to the agent
 * exactly like an outage. Better than a 2x margin leaves room for TLS setup, a
 * cold start, and a slow uplink without ever brushing the ceiling.
 *
 * The connection is always initiated by the Pi, which is the entire reliability
 * argument: it crosses the shop router the same way a browser does. No port
 * forwarding, no static IP, nothing that breaks when the ISP rotates the WAN
 * address at 3am.
 *
 * Auth is `X-Announcer-Device-Id` + `X-Announcer-Device-Key`, verified against
 * a scrypt hash exactly like pos_devices.provision_hash. Like /api/pos/sync,
 * this route is NOT behind the admin middleware (its matcher is /admin/:path*)
 * so a headless Pi can reach it without a Supabase session. The device key IS
 * the credential and the route fails closed without a valid one.
 *
 * WHAT USAGE-1 CHANGED, AND WHY (2026-09-26)
 * ------------------------------------------
 * The owner received usage warnings from Vercel and from Supabase (egress).
 * This route was the single largest always-on consumer of both:
 *
 *   • It looked for work every ONE second while holding — 25 RPC calls per
 *     hold, ~86,000 per idle speaker per day, at every hour of the night.
 *   • It rewrote `last_seen_at` on EVERY poll — one UPDATE per 25 seconds
 *     that changed nothing anybody could see.
 *   • The Pi reconnected the instant a hold ended, so one Vercel instance was
 *     alive 24 hours a day. Fluid compute bills provisioned memory for the
 *     whole time a request is in flight, including while it sleeps.
 *
 * Now: the check interval is POLL_CHECK_INTERVAL_SECONDS (5); the heartbeat
 * write is skipped while the stamp is fresher than
 * HEARTBEAT_WRITE_INTERVAL_SECONDS; and the response carries
 * `idleRestSeconds` so a current agent rests between empty polls. The
 * constants and the inequality that keeps the dot green live in
 * announcer-core.ts and are self-tested there. Older agents (v1.1.0) ignore
 * the new field and keep working — they just do not get the saving until the
 * installer is re-run.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateAnnouncerDevice,
  claimWork,
  touchDevice,
} from "@/lib/announcer/announcer-store";
import {
  parseCredentials,
  resolveHoldSeconds,
  resolveJobLimit,
  unauthorized,
  unavailable,
  type AnnouncerJob,
} from "@/lib/announcer/announcer-protocol-core";
import {
  POLL_CHECK_INTERVAL_SECONDS,
  POLL_HOLD_SECONDS,
  POLL_IDLE_REST_SECONDS,
} from "@/lib/announcer/announcer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The hold is 25s; 60 is the platform maximum and gives the handler room for a
// cold start plus the final claim without ever being truncated mid-response.
export const maxDuration = 60;

/**
 * How often we look for work while holding the connection. See
 * POLL_CHECK_INTERVAL_SECONDS for the reasoning; the first check is immediate.
 */
const CHECK_INTERVAL_MS = POLL_CHECK_INTERVAL_SECONDS * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const creds = parseCredentials((n) => req.headers.get(n));
  if (!creds.ok) {
    const e = unauthorized(creds.error);
    return NextResponse.json(e, { status: e.status });
  }

  const auth = await authenticateAnnouncerDevice(
    creds.credentials.deviceId,
    creds.credentials.deviceKey,
  );
  if (!auth.ok) {
    const e = auth.status === 401 ? unauthorized(auth.error) : unavailable(auth.error);
    return NextResponse.json(e, { status: e.status });
  }
  const device = auth.device;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // A poll with no body is perfectly valid — the defaults are the common
    // case. Never refuse a poll over a missing body.
    body = {};
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const holdSeconds = resolveHoldSeconds(b.holdSeconds);
  const limit = resolveJobLimit(b.limit);

  // The heartbeat is CONSIDERED on every poll, before any work is looked for,
  // and WRITTEN only when the stamp we just read during authentication is old
  // enough to matter (HEARTBEAT_WRITE_INTERVAL_SECONDS). This is what keeps
  // the dot green, and it must not depend on there being work or on the claim
  // succeeding — a device that is healthy but idle is the normal state.
  await touchDevice(device.id, undefined, device.last_seen_at);

  // A DISABLED speaker still gets a clean, successful, immediate answer rather
  // than being held for 25 seconds for work it will never be given. It stays
  // green in the back office, which is correct: it is healthy, just muted.
  if (!device.enabled) {
    return NextResponse.json(
      {
        jobs: [],
        serverTime: new Date().toISOString(),
        pollHoldSeconds: POLL_HOLD_SECONDS,
        idleRestSeconds: POLL_IDLE_REST_SECONDS,
        deviceName: device.name,
        enabled: false,
      },
      { status: 200 },
    );
  }

  const deadline = Date.now() + holdSeconds * 1000;
  let jobs: AnnouncerJob[] = [];
  let lastError: string | null = null;

  // Check once immediately, so a queued announcement is not made to wait for
  // the first tick.
  for (;;) {
    const claim = await claimWork(device.id, limit);
    if (claim.ok) {
      lastError = null;
      if (claim.jobs.length > 0) {
        jobs = claim.jobs;
        break;
      }
    } else {
      lastError = claim.error;
    }
    if (Date.now() + CHECK_INTERVAL_MS >= deadline) break;
    await sleep(CHECK_INTERVAL_MS);
  }

  // Only surface an error if we found nothing AND the last attempt failed. A
  // transient error mid-hold that later succeeded is not the agent's problem
  // and must not be reported as one.
  if (jobs.length === 0 && lastError !== null) {
    const e = unavailable(lastError);
    return NextResponse.json(e, { status: e.status });
  }

  return NextResponse.json(
    {
      jobs,
      serverTime: new Date().toISOString(),
      pollHoldSeconds: POLL_HOLD_SECONDS,
      // A poll that found work should be followed at once (there may be
      // more); an empty one should rest. The agent decides which, from `jobs`.
      idleRestSeconds: POLL_IDLE_REST_SECONDS,
      deviceName: device.name,
      enabled: true,
    },
    { status: 200 },
  );
}
