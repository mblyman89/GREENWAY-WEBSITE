/**
 * POST /api/announcer/ack  (SLICE 28)
 *
 * "I played these; I could not play those."
 *
 * WHY THE TWO HALVES ARE TREATED DIFFERENTLY
 * ------------------------------------------
 * A played job is stamped delivered and retires for good. A FAILED job is not
 * — its lease is cleared so it becomes claimable again immediately, and the
 * next poll picks it up. That asymmetry is the whole reason an ack exists
 * rather than the server assuming success at hand-out time: a speaker whose
 * audio device hiccupped on one job should get the announcement on the next
 * poll, not lose it silently.
 *
 * Both updates are scoped to the calling device, so one speaker can never
 * retire another speaker's work and silence it.
 *
 * An EMPTY ack is a success, not an error. Agents retry acks after a network
 * failure, and a retry that finds nothing left to confirm is normal operation.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateAnnouncerDevice,
  markDelivered,
  markFailed,
  touchDevice,
} from "@/lib/announcer/announcer-store";
import {
  badRequest,
  parseAckRequest,
  parseCredentials,
  unauthorized,
  unavailable,
} from "@/lib/announcer/announcer-protocol-core";

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

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    const e = badRequest("Expected a JSON body.");
    return NextResponse.json(e, { status: e.status });
  }

  const parsed = parseAckRequest(body);
  if (!parsed.ok) {
    const e = badRequest(parsed.error);
    return NextResponse.json(e, { status: e.status });
  }

  await markDelivered(auth.device.id, parsed.request.played);
  await markFailed(auth.device.id, parsed.request.failed);
  await touchDevice(auth.device.id, undefined);

  return NextResponse.json(
    {
      ok: true,
      delivered: parsed.request.played.length,
      requeued: parsed.request.failed.length,
      serverTime: new Date().toISOString(),
    },
    { status: 200 },
  );
}
