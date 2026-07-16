/**
 * POST /api/pos/void  (POS Slice B27)
 *
 * Void a SAME-DAY register sale from the iPad. Two-man rule in one request:
 * the authenticated DEVICE submits the receipt number, a written reason, the
 * MANAGER/LEAD PIN (verified with the same salted-scrypt + shared throttle
 * as /api/pos/approve), and the display name of the employee at the counter.
 *
 * Modes:
 *   { receipt }                      → lookup only: the voidable sale's
 *                                      lines + total, or the complete list
 *                                      of policy failures.
 *   { receipt, reason, pin, processedByName } → process the void.
 *
 * ONLINE-ONLY by design: a void reverses durable server facts (order,
 * inventory, loyalty) — there is nothing sensible to queue offline. The
 * register hides the action while offline, matching /api/pos/member.
 *
 * See void-sale-core.ts for the policy and void-store.ts for the reversal
 * machinery (lifecycle → restock → loyalty clawback → medical ledger →
 * audit → printable slip).
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { getEmployeeByPin } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess, deviceThrottleScope } from "@/lib/security/pin-throttle-store";
import { lookupVoidableSale, processVoidSale } from "@/lib/pos/void-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same role gate as /api/pos/approve. */
const APPROVER_ROLES = new Set(["manager", "lead"]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { receipt?: unknown; reason?: unknown; pin?: unknown; processedByName?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const receipt = String(body.receipt ?? "").trim();
  if (!receipt) {
    return NextResponse.json({ error: "Enter the receipt number." }, { status: 400 });
  }

  // ── Lookup mode (no reason/pin yet): show what would be voided ───────────
  const reason = String(body.reason ?? "").trim();
  const pin = String(body.pin ?? "");
  if (!reason && !pin) {
    const lookup = await lookupVoidableSale(receipt);
    if (!lookup.ok) return NextResponse.json({ errors: lookup.errors }, { status: 404 });
    const s = lookup.sale;
    return NextResponse.json({
      sale: {
        receiptNumber: s.receiptNumber,
        orderNumber: s.orderNumber,
        totalMinor: s.totalMinor,
        lines: s.lines.map((l) => ({ productName: l.productName, quantity: l.quantity })),
      },
    });
  }

  // ── Process mode: manager PIN required ────────────────────────────────────
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
      { error: `${employee.full_name} is not a manager or lead — voids need a manager PIN.` },
      { status: 403 },
    );
  }

  const result = await processVoidSale({
    receiptNumber: receipt,
    reason,
    approver: { id: employee.id, fullName: employee.full_name },
    processedByName: String(body.processedByName ?? "").trim() || "Register",
    deviceId: auth.device.id,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });

  return NextResponse.json({
    refundMinor: result.refundMinor,
    pointsClawed: result.pointsClawed,
    slipHtml: result.slipHtml,
    orderNumber: result.orderNumber,
  });
}
