/**
 * POST /api/announcer/heartbeat  (SLICE 28)
 *
 * "I am still here."
 *
 * The poll already stamps last_seen_at, so in steady state this endpoint is
 * redundant — and that is exactly why it exists. It gives the agent a cheap,
 * instant way to prove liveness in the two situations where a poll cannot:
 *
 *   * during startup, before the first poll has completed, so a freshly
 *     installed Pi turns its dot green within a second or two instead of
 *     looking "never connected" for half a minute while the owner watches;
 *   * from the on-device self-test, where the whole question being asked is
 *     "can this box reach the site at all", and holding a 25-second poll open
 *     to answer it would be a terrible diagnostic.
 *
 * It also returns the device's current name and enabled flag, so an agent that
 * has been renamed or muted in the back office finds out promptly rather than
 * on its next successful poll.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateAnnouncerDevice, touchDevice } from "@/lib/announcer/announcer-store";
import {
  parseCredentials,
  parseHeartbeatRequest,
  unauthorized,
  unavailable,
} from "@/lib/announcer/announcer-protocol-core";
import { POLL_HOLD_SECONDS } from "@/lib/announcer/announcer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // A heartbeat with no body is the common case. Its whole job is to be a
    // beat; refusing one over a missing body would be absurd.
    body = null;
  }
  const parsed = parseHeartbeatRequest(body);

  await touchDevice(auth.device.id, parsed.agentInfo);

  return NextResponse.json(
    {
      ok: true,
      deviceName: auth.device.name,
      enabled: auth.device.enabled,
      pollHoldSeconds: POLL_HOLD_SECONDS,
      serverTime: new Date().toISOString(),
    },
    { status: 200 },
  );
}
