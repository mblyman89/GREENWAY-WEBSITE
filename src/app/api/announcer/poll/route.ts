/**
 * POST /api/announcer/poll  (SLICE 28)
 *
 * The long-poll a Raspberry Pi lives inside.
 *
 * THE SHAPE, AND WHY
 * ------------------
 * The Pi opens this request and the server holds it for up to
 * POLL_HOLD_SECONDS (25) waiting for work. If work appears, it answers
 * immediately; otherwise it answers "nothing" and the Pi asks again at once.
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
import { POLL_HOLD_SECONDS } from "@/lib/announcer/announcer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The hold is 25s; 60 is the platform maximum and gives the handler room for a
// cold start plus the final claim without ever being truncated mid-response.
export const maxDuration = 60;

/**
 * How often we look for work while holding the connection.
 *
 * One second is the whole latency budget the shop actually feels: an order
 * lands, and at worst a second later the speaker starts. Polling the database
 * more often than that would buy nothing a human can perceive and would cost
 * 25 pointless queries per device per cycle.
 */
const CHECK_INTERVAL_MS = 1000;

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

  // The heartbeat happens on EVERY poll, before any work is looked for. This
  // is what keeps the dot green, and it must not depend on there being work or
  // on the claim succeeding — a device that is healthy but idle is the normal
  // state, and a device that is healthy but hitting a claim error still needs
  // to show as alive so the owner debugs the right thing.
  await touchDevice(device.id, undefined);

  // A DISABLED speaker still gets a clean, successful, immediate answer rather
  // than being held for 25 seconds for work it will never be given. It stays
  // green in the back office, which is correct: it is healthy, just muted.
  if (!device.enabled) {
    return NextResponse.json(
      {
        jobs: [],
        serverTime: new Date().toISOString(),
        pollHoldSeconds: POLL_HOLD_SECONDS,
        deviceName: device.name,
        enabled: false,
      },
      { status: 200 },
    );
  }

  const deadline = Date.now() + holdSeconds * 1000;
  let jobs: AnnouncerJob[] = [];
  let lastError: string | null = null;

  // Check once immediately, so a queued announcement is not made to wait a
  // second for the first tick.
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
      deviceName: device.name,
      enabled: true,
    },
    { status: 200 },
  );
}
