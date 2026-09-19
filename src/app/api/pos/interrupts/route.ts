/**
 * /api/pos/interrupts  (SLICE L-14)
 *
 * The register's blocking-interrupt channel.
 *
 *   GET                                  → everything currently blocking this
 *                                          device. Normally an empty list.
 *   POST { rowId, disposition, employeeName }
 *                                        → record a human's decision and clear
 *                                          the interrupt.
 *
 * ── WHY A SEPARATE ROUTE FROM /api/pos/pickup ───────────────────────────────
 *
 * The pickup route answers "what work is waiting?". This one answers "is
 * anything WRONG with work already in hand?". They have different shapes,
 * different urgency, and different failure modes — and folding an interrupt
 * into the pickup queue's response would mean a register that fails to parse
 * the queue also loses its cancellation warnings. The one signal that must
 * never be lost should not ride on the busiest payload in the system.
 *
 * Device-authenticated (x-pos-device-id/-key) like every register endpoint, and
 * online-only: an interrupt is about a durable fact that changed on the server,
 * so there is nothing sensible to queue offline.
 *
 * ── THE ENTERPRISE STANDARD THIS IMPLEMENTS ─────────────────────────────────
 *
 *   1. Accept the upstream event immediately        → the webhook already does
 *   2. Never mutate an open till from a background event
 *                                                   → this route only READS;
 *                                                      nothing here touches the
 *                                                      cashier's sale
 *   3. Interrupt with a blocking acknowledgement    → GET feeds the modal
 *   4. Require an explicit human disposition        → POST demands one of two
 *   5. Record the collision                         → POST writes who/when/what
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import {
  listOpenInterruptsForDevice,
  resolveRegisterInterrupt,
} from "@/lib/leafly/register-claim-server";
import { toCancelDisposition } from "@/lib/leafly/register-claim-core";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function handleGet(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(
    req.headers.get("x-pos-device-id") ?? "",
    req.headers.get("x-pos-device-key") ?? "",
  );
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { interrupts, degraded } = await listOpenInterruptsForDevice(auth.device.id);

  // `degraded` means migration 0229 is not applied yet. Reported honestly
  // rather than hidden, so the register can say "warnings are not available"
  // instead of implying an all-clear it cannot actually vouch for. It is NOT
  // an error status: the register must keep working.
  return NextResponse.json({ interrupts, degraded });
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(
    req.headers.get("x-pos-device-id") ?? "",
    req.headers.get("x-pos-device-key") ?? "",
  );
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { rowId?: unknown; disposition?: unknown; employeeName?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (!isUuid(body.rowId)) {
    return NextResponse.json({ error: "rowId must be a UUID." }, { status: 400 });
  }

  // ALLOWLIST via the pure core. A value that is not exactly one of the two
  // documented dispositions is refused here rather than written to the
  // database — the only thing a tablet can send that is not one of these is a
  // bug or a tampered request, and either way it must not become a recorded
  // decision that nobody designed.
  const disposition = toCancelDisposition(body.disposition);
  if (disposition === null) {
    return NextResponse.json(
      { error: 'disposition must be "void" or "walk_in".' },
      { status: 400 },
    );
  }

  // Required, and required to be non-blank. Point 5 of the standard is a
  // record of WHO decided; an anonymous disposition is not that record, and
  // this is precisely the entry that gets read back during a dispute.
  const employeeName = String(body.employeeName ?? "").trim();
  if (employeeName === "") {
    return NextResponse.json(
      { error: "employeeName is required — the decision has to be attributable." },
      { status: 400 },
    );
  }

  const resolved = await resolveRegisterInterrupt({
    rowId: body.rowId,
    disposition,
    employeeName,
    deviceId: auth.device.id,
  });

  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error ?? "Could not record the decision." }, { status: 503 });
  }

  return NextResponse.json({ ok: true, disposition });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withPosCors(req, await handleGet(req));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withPosCors(req, await handlePost(req));
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}
