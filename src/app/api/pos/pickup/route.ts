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
 *   POST { orderId, cancel: { pin, reason, employeeName } }   (SLICE L-36)
 *                            → cancel an ACTIVE online order from the register.
 *                              Needs a MANAGER or LEAD PIN (same salted verify
 *                              + brute-force throttle as /api/pos/approve).
 *                              Leafly orders are cancelled AT LEAFLY first
 *                              (so the Online Orders report records it); if
 *                              Leafly refuses, nothing local changes. The
 *                              Orders board + Reports read live, so they
 *                              update on their next load.
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
import { isRegisterCancelReason } from "@/lib/pos/pickup-detail-core";
import { isOutboundCancelReason } from "@/lib/leafly/order-ack-core";
import { getEmployeeByPin } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess, deviceThrottleScope } from "@/lib/security/pin-throttle-store";

/** Roles allowed to cancel an online order at the register (employees.job_role). */
const CANCEL_APPROVER_ROLES = new Set(["manager", "lead"]);

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
    cancel?: { pin?: unknown; reason?: unknown; employeeName?: unknown };
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

    // ── SLICE L-14: this till now holds the order ──────────────────────────
    //
    // Recording the claim is what makes `decideCancelPlan`'s collision branch
    // reachable: until L-14 nothing in the system knew a register was holding
    // an order, so a cancellation arriving mid-sale was classified as though
    // the counter were empty.
    //
    // Only for marketplace orders. A website order has no upstream that can
    // cancel it out from under the counter, so claiming one would write a lock
    // nothing ever reads.
    //
    // Best-effort, and deliberately AFTER the load succeeded: a claim that
    // cannot be written must never stop a budtender serving a customer. The
    // cost of a missing claim is one cancellation escalated to a human, which
    // is the safe direction. It is also self-correcting -- the claim is a
    // lease and the register renews it on every poll.
    if (loaded.isMarketplace) {
      const { claimLeaflyOrderForRegister } = await import("@/lib/leafly/register-claim-server");
      const claimed = await claimLeaflyOrderForRegister({
        localOrderId: loaded.orderId,
        deviceId: auth.device.id,
        deviceName: auth.device.name,
        employeeName,
      });
      if (!claimed.ok) {
        console.error(
          `[pos/pickup] loaded ${loaded.orderNumber} but could not claim it for ${auth.device.name}: ${claimed.error ?? "unknown"}`,
        );
      }
    }

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

  // ── Cancel mode (SLICE L-36): manager/lead PIN, then cancel ─────────────
  if (body.cancel) {
    const reason = body.cancel.reason;
    // Both checks: the register's own list AND Leafly's outbound list, so a
    // reason the register offers can never be one Leafly would reject.
    if (!isRegisterCancelReason(reason) || !isOutboundCancelReason(reason)) {
      return NextResponse.json({ error: "Pick a cancel reason." }, { status: 400 });
    }
    const employeeName = String(body.cancel.employeeName ?? "").trim();
    if (!employeeName) {
      return NextResponse.json({ error: "cancel.employeeName is required." }, { status: 400 });
    }
    const throttleScope = deviceThrottleScope(auth.device.id);
    const locked = await pinPadBlocked(throttleScope);
    if (locked) return NextResponse.json({ error: locked }, { status: 429 });
    const pin = String(body.cancel.pin ?? "");
    if (!isValidPin(pin)) {
      return NextResponse.json({ error: "Enter a valid 4–6 digit manager PIN." }, { status: 400 });
    }
    const approver = await getEmployeeByPin(pin);
    if (!approver) {
      await notePinFailure(throttleScope);
      return NextResponse.json({ error: "No active employee for that PIN." }, { status: 401 });
    }
    await notePinSuccess(throttleScope);
    if (!CANCEL_APPROVER_ROLES.has(approver.job_role)) {
      return NextResponse.json(
        { error: `${approver.full_name} is not a manager or lead — cancelling an order needs a manager PIN.` },
        { status: 403 },
      );
    }
    // Dynamic import keeps the store's cancel path (Leafly push, audit) out of
    // the module graph for the read-only branches.
    const { cancelPickupAtRegister } = await import("@/lib/pos/pickup-store");
    const cancelled = await cancelPickupAtRegister({
      orderId: body.orderId,
      reason,
      approverName: approver.full_name,
      deviceName: auth.device.name,
      employeeName,
    });
    if (!cancelled.ok) return NextResponse.json({ error: cancelled.error }, { status: 422 });
    return NextResponse.json({
      cancelled: {
        orderNumber: cancelled.orderNumber,
        displayName: cancelled.displayName,
        message: cancelled.message,
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
