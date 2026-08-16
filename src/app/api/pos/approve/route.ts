/**
 * POST /api/pos/approve  (POS Slice B17)
 *
 * Manager-approval PIN check for register exceptions — today the audited
 * NO-SALE drawer open. An authenticated DEVICE submits a second PIN; the
 * server resolves the employee with the SAME salted-scrypt verify + shared
 * brute-force throttle as /api/pos/unlock, then gates on role: only a
 * manager or lead can approve. The response is the MINIMUM the register
 * needs to stamp the event (employees.id + display name) — the approver's
 * PIN never rides in any queue payload.
 *
 * Why a separate endpoint instead of reusing /api/pos/unlock: unlock opens a
 * SESSION (punch state + drawer lookup + "register.unlocked" audit). An
 * approval must do none of that — it is a point-in-time authorization that
 * leaves the current session owner untouched.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { getEmployeeByPin } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess, deviceThrottleScope } from "@/lib/security/pin-throttle-store";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Roles allowed to approve register exceptions (employees.job_role). */
const APPROVER_ROLES = new Set(["manager", "lead"]);

async function handlePost(req: NextRequest): Promise<NextResponse> {
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

  if (!APPROVER_ROLES.has(employee.job_role)) {
    return NextResponse.json(
      { error: `${employee.full_name} is not a manager or lead — approvals need a manager PIN.` },
      { status: 403 },
    );
  }

  // Deliberately no audit row HERE: the approved action itself (the no_sale
  // event) is validated + audited at sync with this approver's id inside it,
  // so one drawer open never produces two competing audit trails.
  return NextResponse.json({
    approver: { id: employee.id, fullName: employee.full_name },
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
