/**
 * /api/pos/pickup  (POS Slice B28)
 *
 * The register's online-order pickup queue.
 *
 *   GET                      → the active website pickup queue (counter-sorted).
 *   POST { orderId }         → one order's lines + totals for the counter view.
 *   POST { orderId, complete: … }
 *                            → RETIRED (SLICE 17). Always 410 Gone. This used
 *                              to complete a handover on a checkbox
 *                              (`idConfirmed`); it is now impossible. Every
 *                              pickup goes through the register sale so the
 *                              REAL ID gate (id-scan-core) runs. See
 *                              docs/slice-17-one-door-handover.md.
 *   POST { orderId, load: { employeeName } }   (Task AM-D / AM-D2)
 *                            → load the order INTO a register sale: the
 *                              order stays ACTIVE (it is NOT superseded on
 *                              load — that lost the order + revenue when the
 *                              register sale was abandoned). The line ids +
 *                              the source orderId come back so the device
 *                              rebuilds against its CURRENT bundle and carries
 *                              orderId into the sale; the SYNC supersedes the
 *                              website order ONLY when that register sale
 *                              COMPLETES. Also returns the linked customer as
 *                              a one-tap member attach.
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
  loadOrderIntoRegister,
} from "@/lib/pos/pickup-store";
import {
  isRetiredAttestationCompletion,
  CHECKBOX_HANDOVER_RETIRED_MESSAGE,
  SANCTIONED_HANDOVER_ROUTE,
} from "@/lib/pos/pickup-handover-core";
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

  const result = await listRegisterPickupQueue();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 503 });
  return NextResponse.json({ queue: result.queue });
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
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
        // The source order's id — the register carries it into the sale it is
        // building; the sync supersedes this order ONLY on completion (AM-D2).
        orderId: loaded.orderId,
        orderNumber: loaded.orderNumber,
        customerLabel: loaded.customerLabel,
        customerNote: loaded.customerNote,
        lines: loaded.lines,
        member: loaded.member,
        // SLICE L-12 - origin travels into the sale.
        //
        // NOTE FOR ANYONE ADDING A FIELD HERE: this object is hand-copied
        // rather than spread, so a field added to LoadOrderResult does NOT
        // appear at the register until it is named on this line too. That is
        // deliberate (the register is an external client and the payload is a
        // contract), but it means this is exactly the seam where a new field
        // gets silently lost. tests/compliance/leafly-bridge-wiring.test.ts
        // asserts that these three are present.
        origin: loaded.origin,
        originLabel: loaded.originLabel,
        isMarketplace: loaded.isMarketplace,
      },
    });
  }

  // ── Detail mode ───────────────────────────────────────────────────────────
  if (!body.complete) {
    const detail = await getRegisterPickupOrder(body.orderId);
    if (!detail.ok) return NextResponse.json({ error: detail.error }, { status: 404 });
    return NextResponse.json({ order: detail.order });
  }

  /**
   * RETIRED: the checkbox completion route (SLICE 17).
   *
   * Owner: "The former is just a check box. I don't like that. Please remove
   * that option."
   *
   * This endpoint used to complete a cannabis handover on the strength of
   * `idConfirmed: true` - a boolean the budtender ticked. The ONLY ID check
   * on that path was `if (!input.idConfirmed)` inside
   * evaluatePickupCompletion. Meanwhile the "load into a sale" route put the
   * same customer through the REAL gate in id-scan-core.ts: AAMVA PDF417
   * parse, age against MINIMUM_AGE_YEARS (RCW 69.50.357), expiry rejection,
   * the WAC 314-55-150 acceptable-ID list, and an audit record on every
   * manual verification. Two doors for one regulated act, and only one of
   * them actually verified anything.
   *
   * Removing the button alone would have left this endpoint live and still
   * accepting `complete{}` from anything holding device credentials. So the
   * CAPABILITY is closed here, at the earliest point - before any employee
   * lookup, drawer validation or money math runs - and it is refused by the
   * SHAPE of the request, so `idConfirmed: false` cannot smuggle one through
   * either. No body completes a pickup this way any more.
   *
   * 410 Gone is the honest status: the route existed, it was deliberately
   * retired, and no retry will bring it back.
   */
  if (isRetiredAttestationCompletion(body)) {
    return NextResponse.json(
      {
        errors: [CHECKBOX_HANDOVER_RETIRED_MESSAGE],
        retiredRoute: "complete",
        useRoute: SANCTIONED_HANDOVER_ROUTE,
      },
      { status: 410 },
    );
  }

  return NextResponse.json({ error: "Unsupported pickup request." }, { status: 400 });
}

/**
 * CORS preflight. The packaged register app ("Greenway Point of Transaction")
 * calls this API cross-origin from capacitor://localhost. Policy lives in
 * @/lib/pos/cors-core (pure).
 */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Wrap once so EVERY return path carries the CORS headers.
  return withPosCors(req, await handleGet(req));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Wrap once so EVERY return path carries the CORS headers.
  return withPosCors(req, await handlePost(req));
}
