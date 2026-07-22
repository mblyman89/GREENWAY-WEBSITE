/**
 * POST /api/pos/sync  (POS Slice B4)
 *
 * The register's offline-queue flush endpoint. An authenticated POS device
 * submits a batch of append-only event envelopes; the server ACKs each one by
 * client UUID (POS_FRONTEND_RESEARCH §4.2):
 *
 *   processed  — durably applied (sale completed / punch replayed / audit written)
 *   duplicate  — this exact clientUuid was accepted earlier (idempotent retry)
 *   exception  — recorded in the manager exception queue (durably accepted;
 *                a human resolves it server-side — never silently dropped)
 *   rejected   — never entered the ledger (malformed / foreign device); the
 *                device keeps the row and surfaces it
 *
 * Auth: `X-POS-Device-Id` + `X-POS-Device-Key` headers, verified against
 * pos_devices.provision_hash (scrypt; plaintext never stored). This route is
 * NOT behind the admin middleware (matcher is /admin/:path*) so the iPad can
 * reach it without a Supabase session; the device key IS the credential and
 * the route fails closed without a valid one.
 *
 * Batches are capped to keep request bodies bounded; the device flushes in
 * a loop until its queue is empty.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice, ingestPosEvents } from "@/lib/pos/sync-store";
import type { PosEventEnvelope } from "@/lib/pos/sale-event-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// GW-023: a batch of sales runs a long processing chain per event (order
// materialization + the full completion gate). Give the function explicit
// room instead of relying on the platform default, so a slow cold start or a
// briefly slow database doesn't kill an ingest mid-chain and strand rows at
// `pending` (the recovery paths heal those, but prevention beats recovery).
export const maxDuration = 60;

const MAX_BATCH = 50;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";

  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const events = (body as { events?: unknown })?.events;
  if (!Array.isArray(events)) {
    return NextResponse.json({ error: "Body must be { events: [...] }." }, { status: 400 });
  }
  // Empty batch = credential heartbeat (device setup screens verify their
  // key without submitting a fact).
  if (events.length === 0) {
    return NextResponse.json({ acks: [], device: { name: auth.device.name, registerId: auth.device.register_id } });
  }
  if (events.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Batch too large — send at most ${MAX_BATCH} events per request.` },
      { status: 413 },
    );
  }

  const result = await ingestPosEvents(auth.device, events as Partial<PosEventEnvelope>[]);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  // GW-002 — every ack response also carries the device's CURRENT binding
  // (same shape as the empty-batch heartbeat above), so the register can
  // self-heal a stale stored registerId on any successful flush instead of
  // waiting for the next unlock. The server is the source of truth for
  // which register a device is bound to.
  return NextResponse.json({
    acks: result.acks,
    device: { name: auth.device.name, registerId: auth.device.register_id },
  });
}
