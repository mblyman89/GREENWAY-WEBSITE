/**
 * POST /api/pos/witness  (SLICE 28 — employee special discount)
 *
 * Employee-identity PIN check for the EMPLOYEE purchase program. The owner's
 * rule: an employee buying with the 35% discount must have ANOTHER employee
 * enter their PIN, and the purchase can't ring on the register the buying
 * employee is logged into. The register calls this endpoint twice — once so
 * the BUYING employee identifies themselves by PIN, once for the WITNESS —
 * and refuses to proceed when both PINs resolve to the same person
 * (validateSalePayload and the sync re-check approver ≠ buyer server-side).
 *
 * Same salted-scrypt PIN verify + shared per-device brute-force throttle as
 * /api/pos/unlock and /api/pos/approve. Unlike /api/pos/approve there is NO
 * role gate: ANY active employee can witness (the owner asked for "another
 * employee", not a manager). The response is the MINIMUM the register needs
 * to stamp the sale (employees.id + display name) — the PIN itself never
 * rides in any queue payload.
 *
 * Why a separate endpoint instead of reusing /api/pos/approve: approve is
 * deliberately gated to manager|lead for register EXCEPTIONS (no-sale,
 * price override). Loosening that gate would weaken every existing approval
 * flow; a purpose-built endpoint keeps both rules exact.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { getEmployeeByPin } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess, deviceThrottleScope } from "@/lib/security/pin-throttle-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const throttleScope = deviceThrottleScope(auth.device.id);
  const locked = await pinPadBlocked(throttleScope);
  if (locked) return NextResponse.json({ error: locked }, { status: 429 });

  let pin = "";
  try {
    pin = String(((await req.json()) as { pin?: unknown })?.pin ?? "");
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!isValidPin(pin)) {
    return NextResponse.json({ error: "Enter a valid 4–6 digit PIN." }, { status: 400 });
  }

  const employee = await getEmployeeByPin(pin);
  if (!employee) {
    await notePinFailure(throttleScope);
    return NextResponse.json({ error: "No active employee for that PIN." }, { status: 401 });
  }
  await notePinSuccess(throttleScope);

  // Deliberately no audit row HERE: the sale itself is validated + audited at
  // sync with both employee ids inside it (special_discount_uses ledger), so
  // one purchase never produces two competing audit trails.
  return NextResponse.json({
    employee: { id: employee.id, fullName: employee.full_name },
  });
}
