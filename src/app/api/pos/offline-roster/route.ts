/**
 * POST /api/pos/offline-roster  (D161)
 *
 * Owner, 2026-11-04: "please now build for me something that allows my
 * employees to unlock the ipad registers in offline mode."
 *
 * The iPad calls this every few minutes while online. The answer says who
 * may still unlock THIS iPad offline (active, PIN set, handbook gate passed),
 * each person's PIN stamp (changes when the PIN changes), who may approve,
 * the owner's policy, this iPad's offline key, and the register's open
 * drawer. The iPad purges anyone not in the answer.
 *
 * Contains NO PIN, NO PIN hash and NO verifier. A verifier can only be
 * created on the iPad at the moment someone types their PIN and the server
 * confirms it (the arm block on /api/pos/unlock, /approve and /clock).
 *
 * Auth: device id + device key (scrypt-verified). Fails closed. Any database
 * error is a 503 so the iPad keeps its cache (never purge on a hiccup).
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { buildOfflineRoster } from "@/lib/pos/offline-unlock-store";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withPosCors(req, await handlePost(req));
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const res = await buildOfflineRoster(auth.device);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.roster, { headers: { "cache-control": "no-store" } });
}
