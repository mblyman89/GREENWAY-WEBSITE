/**
 * POST /api/pos/unlock  (POS Slice B5)
 *
 * The register lock screen. An authenticated DEVICE submits a budtender's
 * clock PIN; the server resolves the employee (salted-scrypt verify, same
 * S-10 discipline and shared brute-force throttle as the time-clock pad) and
 * returns what the shell needs to open a session:
 *
 *   - who unlocked (employees.id + name + role)
 *   - whether they are currently clocked in (punch intent baseline)
 *   - the register's open drawer session, if any (drawer accountability)
 *
 * PINs identify HUMANS; the device key identifies the IPAD. Both are required
 * — a stolen PIN is useless without a provisioned device, and vice versa.
 * Every unlock writes an audit row (owner rule: tie every action to a person).
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { getEmployeeByPin, openWorkPunch } from "@/lib/staffing/store";
import { openSessionForRegister } from "@/lib/registers/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess, deviceThrottleScope } from "@/lib/security/pin-throttle-store";
import { recordAudit } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.device.register_id) {
    return NextResponse.json(
      { error: "This device is not bound to a register — a manager must assign one in the back office." },
      { status: 409 },
    );
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

  const [openPunch, drawerSession] = await Promise.all([
    openWorkPunch(employee.id),
    openSessionForRegister(auth.device.register_id),
  ]);

  await recordAudit({
    actorId: employee.staff_id,
    actorEmail: employee.full_name,
    action: "register.unlocked",
    entityType: "register",
    entityId: auth.device.register_id,
    after: { employeeId: employee.id, deviceId: auth.device.id, deviceName: auth.device.name },
  });

  return NextResponse.json({
    employee: {
      id: employee.id,
      fullName: employee.full_name,
      jobRole: employee.job_role,
      clockedIn: !!openPunch,
    },
    register: { id: auth.device.register_id },
    drawer: drawerSession
      ? { sessionId: drawerSession.id, openedAt: drawerSession.opened_at, businessDay: drawerSession.business_day }
      : null,
  });
}
