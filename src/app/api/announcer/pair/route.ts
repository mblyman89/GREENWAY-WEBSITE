/**
 * POST /api/announcer/pair  (SLICE 28)
 *
 * The one exchange in a speaker's life that is not authenticated by a device
 * key, because the whole point is that it does not have one yet.
 *
 * The Pi presents an eight-character code the owner generated on the Announcer
 * page and read across the room. In return it gets a permanent device id and a
 * device key. The key appears in this response and NOWHERE else, ever: the
 * server keeps only a scrypt hash of it, the same discipline
 * pos_devices.provision_hash uses. If the Pi loses it, the speaker gets
 * re-paired. That is the correct trade — it means a database dump can never be
 * turned into a working speaker credential.
 *
 * The code is the credential here, which is why it is short-lived (60 minutes),
 * single-use, and generated with a CSPRNG rather than Math.random.
 *
 * Not behind the admin middleware (matcher is /admin/:path*), because a
 * headless Pi has no Supabase session — same arrangement as /api/pos/sync.
 */
import { NextResponse, type NextRequest } from "next/server";
import { redeemPairing } from "@/lib/announcer/announcer-store";
import {
  badRequest,
  parsePairRequest,
  unavailable,
  type PairSuccess,
} from "@/lib/announcer/announcer-protocol-core";
import { POLL_HOLD_SECONDS } from "@/lib/announcer/announcer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const e = badRequest("Expected a JSON body containing a pairing code.");
    return NextResponse.json(e, { status: e.status });
  }

  const parsed = parsePairRequest(body);
  if (!parsed.ok) {
    const e = badRequest(parsed.error);
    return NextResponse.json(e, { status: e.status });
  }

  const result = await redeemPairing(parsed.request.code, parsed.request.agentInfo);
  if (!result.ok) {
    // Every refusal is specific. "Pairing failed" with no explanation is the
    // most frustrating thing this endpoint could say to somebody standing in a
    // storage room holding a Raspberry Pi, so the reason always comes through:
    // wrong code, expired code, or already-used code are three different fixes.
    if (result.status === 503) {
      const e = unavailable(result.error);
      return NextResponse.json(e, { status: e.status });
    }
    return NextResponse.json(
      {
        status: result.status,
        error: result.error,
        retryable: false,
        hint: "Generate a fresh code on the Announcer page and run the pairing command again.",
      },
      { status: result.status },
    );
  }

  const success: PairSuccess = {
    deviceId: result.deviceId,
    deviceKey: result.deviceKey,
    deviceName: result.deviceName,
    pollHoldSeconds: POLL_HOLD_SECONDS,
  };
  return NextResponse.json(success, { status: 200 });
}
