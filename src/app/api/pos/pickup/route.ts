/**
 * /api/pos/pickup  (POS Slice B28)
 *
 * The register's online-order pickup queue.
 *
 *   GET                      → the active website pickup queue (counter-sorted).
 *   POST { orderId }         → one order's lines + totals for the counter view.
 *   POST { orderId, complete: { employeeId, tenderedMinor, idConfirmed,
 *          drawerSessionId } }
 *                            → complete the handover: register-side policy
 *                              (evaluatePickupCompletion) → the SAME server
 *                              completion gate every sale runs → completed
 *                              (inventory decrement + loyalty accrual fire
 *                              exactly like every other completion) → day
 *                              ledger row → printable receipt.
 *   POST { orderId, load: { employeeName } }   (Task AM-D)
 *                            → load the order INTO a register sale: the
 *                              order is SUPERSEDED (cancelled with a loud
 *                              timeline note — the register sale becomes
 *                              the sale of record, so nothing can double-
 *                              decrement or double-accrue) and the line
 *                              ids come back for the device to rebuild
 *                              against its CURRENT menu bundle, plus the
 *                              linked customer as a one-tap member attach.
 *
 * Device-authenticated (x-pos-device-id/-key) like every register endpoint.
 * ONLINE-ONLY by design: the queue lives on the server and completion
 * mutates durable facts — there is nothing sensible to queue offline.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import {
  listRegisterPickupQueue,
  getRegisterPickupOrder,
  completePickupAtRegister,
  loadOrderIntoRegister,
} from "@/lib/pos/pickup-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(
    req.headers.get("x-pos-device-id") ?? "",
    req.headers.get("x-pos-device-key") ?? "",
  );
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const result = await listRegisterPickupQueue();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 503 });
  return NextResponse.json({ queue: result.queue });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(
    req.headers.get("x-pos-device-id") ?? "",
    req.headers.get("x-pos-device-key") ?? "",
  );
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.device.register_id) {
    return NextResponse.json(
      { error: "This device is not bound to a register — a manager must assign one in the back office." },
      { status: 409 },
    );
  }

  let body: {
    orderId?: unknown;
    complete?: { employeeId?: unknown; tenderedMinor?: unknown; idConfirmed?: unknown; drawerSessionId?: unknown };
    load?: { employeeName?: unknown };
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!isUuid(body.orderId)) {
    return NextResponse.json({ error: "orderId must be a UUID." }, { status: 400 });
  }

  // ── Load mode (AM-D): supersede the order and hand back its lines ────────
  if (body.load) {
    const employeeName = String(body.load.employeeName ?? "").trim();
    if (!employeeName) {
      return NextResponse.json({ error: "load.employeeName is required." }, { status: 400 });
    }
    const loaded = await loadOrderIntoRegister({
      orderId: body.orderId,
      deviceName: auth.device.name,
      employeeName,
    });
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 422 });
    return NextResponse.json({
      loaded: {
        orderNumber: loaded.orderNumber,
        customerLabel: loaded.customerLabel,
        customerNote: loaded.customerNote,
        lines: loaded.lines,
        member: loaded.member,
      },
    });
  }

  // ── Detail mode ───────────────────────────────────────────────────────────
  if (!body.complete) {
    const detail = await getRegisterPickupOrder(body.orderId);
    if (!detail.ok) return NextResponse.json({ error: detail.error }, { status: 404 });
    return NextResponse.json({ order: detail.order });
  }

  // ── Completion mode ───────────────────────────────────────────────────────
  const c = body.complete;
  if (!isUuid(c.employeeId)) {
    return NextResponse.json({ error: "complete.employeeId must be the unlocked employee's id." }, { status: 400 });
  }
  if (!isUuid(c.drawerSessionId)) {
    return NextResponse.json({ error: "complete.drawerSessionId must be the open drawer session." }, { status: 400 });
  }
  if (!Number.isInteger(c.tenderedMinor) || (c.tenderedMinor as number) < 0) {
    return NextResponse.json({ error: "complete.tenderedMinor must be a non-negative integer (cents)." }, { status: 400 });
  }

  const result = await completePickupAtRegister({
    orderId: body.orderId,
    employeeId: c.employeeId,
    tenderedMinor: c.tenderedMinor as number,
    idConfirmed: c.idConfirmed === true,
    deviceId: auth.device.id,
    deviceName: auth.device.name,
    registerId: auth.device.register_id,
    drawerSessionId: c.drawerSessionId,
  });
  if (!result.ok) return NextResponse.json({ errors: result.errors }, { status: 422 });

  return NextResponse.json({
    changeMinor: result.changeMinor,
    receiptHtml: result.receiptHtml,
    orderNumber: result.orderNumber,
    receiptNumber: result.receiptNumber,
  });
}
