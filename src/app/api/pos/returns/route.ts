/**
 * POST /api/pos/returns  (POS Slice AM-C)
 *
 * Counter returns FROM THE REGISTER — the same receipt-first, policy-gated
 * flow the back office runs at /admin/registers/returns (B16), brought to
 * the iPad so the customer never has to wait for a back-office computer.
 * Nothing is re-implemented: lookup and processing call the EXACT SAME
 * returns-store machinery (store policy re-check, exact refund from the
 * stored paid price, Task Q's compliant pipeline — WAC 314-55-079(12)
 * attestations, CCRS Sale correction queue, positive add-back,
 * restock/destroy — proportional loyalty clawback, printable refund
 * receipt).
 *
 * Two-man rule in one request, exactly like /api/pos/void (B27): the
 * authenticated DEVICE submits the receipt + line + reason, and a
 * MANAGER/LEAD PIN (salted-scrypt + the shared throttle) authorizes the
 * processing. Returns move inventory and queue CCRS corrections — that
 * stays a manager-level action even at the counter.
 *
 * Modes:
 *   { receipt }              → lookup only: the returnable sale (lines with
 *                              remaining-returnable quantities, member label,
 *                              days remaining) or the COMPLETE list of
 *                              policy failures.
 *   { receipt, orderLineId, quantity, reason, detail?, disposition,
 *     originalPackaging, lotIdLegible, pin, processedByName }
 *                            → process the return.
 *
 * ONLINE-ONLY by design: a return reverses durable server facts (inventory,
 * loyalty, CCRS queue) — there is nothing sensible to queue offline. The
 * register hides the action while offline, matching /api/pos/void.
 *
 * Money in MINOR UNITS (cents) everywhere.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { getEmployeeByPin } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess, deviceThrottleScope } from "@/lib/security/pin-throttle-store";
import { recordAudit } from "@/lib/auth/audit";
import { CUSTOMER_RETURN_REASONS } from "@/lib/inventory/disposition-core";
import { lookupSaleByReceipt, processCounterReturn } from "@/lib/pos/returns-store";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same role gate as /api/pos/approve and /api/pos/void. */
const APPROVER_ROLES = new Set(["manager", "lead"]);

const REASONS = new Set<string>(CUSTOMER_RETURN_REASONS);

async function handlePost(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: {
    receipt?: unknown;
    orderLineId?: unknown;
    quantity?: unknown;
    reason?: unknown;
    detail?: unknown;
    disposition?: unknown;
    originalPackaging?: unknown;
    lotIdLegible?: unknown;
    pin?: unknown;
    processedByName?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const receipt = String(body.receipt ?? "").trim();
  if (!receipt) {
    return NextResponse.json({ error: "Enter the receipt number." }, { status: 400 });
  }

  // ── Lookup mode (no line/pin yet): show what could be returned ───────────
  const orderLineId = String(body.orderLineId ?? "").trim();
  const pin = String(body.pin ?? "");
  if (!orderLineId && !pin) {
    const lookup = await lookupSaleByReceipt(receipt);
    if (!lookup.ok) return NextResponse.json({ errors: lookup.errors }, { status: 404 });
    const s = lookup.sale;
    return NextResponse.json({
      sale: {
        receiptNumber: s.receiptNumber,
        orderNumber: s.orderNumber,
        purchasedAtIso: s.purchasedAtIso,
        memberLabel: s.memberLabel,
        daysRemaining: s.daysRemaining,
        orderTotalMinor: s.orderTotalMinor,
        lines: s.lines.map((l) => ({
          lineId: l.lineId,
          productName: l.productName,
          quantity: l.quantity,
          priceMinorUnits: l.priceMinorUnits,
          alreadyReturned: l.alreadyReturned,
          remainingReturnable: l.remainingReturnable,
        })),
      },
    });
  }

  // ── Process mode: validate the return, then the manager PIN ─────────────
  if (!orderLineId) {
    return NextResponse.json({ error: "Pick the line item being returned." }, { status: 400 });
  }
  const quantity = Number(body.quantity ?? 0);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return NextResponse.json({ error: "Quantity must be a positive whole number." }, { status: 400 });
  }
  const reason = String(body.reason ?? "").trim();
  if (!REASONS.has(reason)) {
    return NextResponse.json({ error: "Pick a valid return reason." }, { status: 400 });
  }
  const disposition = body.disposition === "restock" ? "restock" : body.disposition === "destroy" ? "destroy" : null;
  if (!disposition) {
    return NextResponse.json({ error: "Pick restock or destroy." }, { status: 400 });
  }

  const throttleScope = deviceThrottleScope(auth.device.id);
  const locked = await pinPadBlocked(throttleScope);
  if (locked) return NextResponse.json({ error: locked }, { status: 429 });
  if (!isValidPin(pin)) {
    return NextResponse.json({ error: "Enter a valid 4–6 digit manager PIN." }, { status: 400 });
  }
  const employee = await getEmployeeByPin(pin);
  if (!employee) {
    await notePinFailure(throttleScope);
    return NextResponse.json({ error: "No active employee for that PIN." }, { status: 401 });
  }
  await notePinSuccess(throttleScope);
  if (!APPROVER_ROLES.has(employee.job_role)) {
    return NextResponse.json(
      { error: `${employee.full_name} is not a manager or lead — returns need a manager PIN.` },
      { status: 403 },
    );
  }

  const processedByName = String(body.processedByName ?? "").trim() || "Register";
  const result = await processCounterReturn(
    {
      receiptNumber: receipt,
      orderLineId,
      quantity,
      reason,
      detail: String(body.detail ?? "").trim() || null,
      disposition,
      originalPackaging: body.originalPackaging === true,
      lotIdLegible: body.lotIdLegible === true,
    },
    employee.staff_id, // staff_profiles id (nullable) — same FK the back office writes
    processedByName,
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });

  // Same audit action as the back-office path, tagged as register-originated.
  await recordAudit({
    actorId: employee.staff_id,
    actorEmail: employee.full_name,
    action: "customer_return.counter",
    entityType: "customer_returns",
    entityId: result.returnId,
    after: {
      via: "register",
      deviceId: auth.device.id,
      receipt_number: receipt,
      order_line_id: orderLineId,
      quantity,
      reason,
      disposition,
      refund_minor: result.refundMinor,
      points_clawed: result.pointsClawed,
      correction_operation: result.correctionOperation,
      approved_by: employee.full_name,
      processed_by_name: processedByName,
    },
  });

  return NextResponse.json({
    returnId: result.returnId,
    refundMinor: result.refundMinor,
    pointsClawed: result.pointsClawed,
    correctionOperation: result.correctionOperation,
    receiptHtml: result.receiptHtml,
  });
}

/**
 * CORS preflight. The packaged register app ("Greenway Point of Transaction")
 * calls this API cross-origin from capacitor://localhost. Policy lives in
 * @/lib/pos/cors-core (pure).
 */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Wrap once so EVERY return path carries the CORS headers.
  return withPosCors(req, await handlePost(req));
}
