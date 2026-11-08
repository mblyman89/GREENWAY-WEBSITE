/**
 * POST /api/pos/clock  (owner D124: "The clock out feature is not working")
 *
 * Clock in / clock out from the register, ONLINE, with a straight answer.
 *
 * Before this, the register put a clock punch in its offline queue and showed
 * "clock-out recorded" right away. If the server then refused the punch (for
 * example the D84 rule: no clock-out while you still own an open drawer) the
 * refusal became a quiet sync "exception" the cashier never saw, so the
 * person walked away still clocked in. Production showed exactly that: four
 * open clock-ins and not one clock-out ever recorded.
 *
 * Now the register asks the server directly and shows what really happened:
 * "Zachary: clocked OUT at 4:46 PM" or the exact reason it was refused.
 *
 * Two ways in (both device-authenticated, like every POS endpoint):
 *   { pin }                  lock screen. The PIN says who. Anyone can clock
 *                            in or out on a locked register (owner Q-E-6), so
 *                            there is NO handbook / unlock gate here.
 *   { employeeId, intent }   home screen, for the employee who already
 *                            unlocked this register with their PIN. Same trust
 *                            as the queued punch it replaces (the sync queue
 *                            also carries only the employee id).
 * `intent` ("in" | "out") is optional with a PIN (the server toggles) and
 * required with an employeeId (so a stale screen cannot flip the wrong way).
 *
 * The real rule still lives in toggleClock (staffing/store.ts): a clock-out is
 * refused while the employee owns an open drawer (owner D84). Closing a
 * drawer never clocks anyone out. Every punch is audited (timeclock.in/out,
 * or timeclock.refused with the reason).
 *
 * D211 (owner: "There needs to be an option to clock out for lunch, or, for
 * an “other” reason"): intent "break" with { reason: "lunch"|"other", note }
 * leaves for a break WITHOUT the drawer guard (startBreak); intent "back" (or
 * a plain PIN toggle while on break) comes back (endBreak). Audited as
 * timeclock.break_start / timeclock.break_end.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { getEmployee, getEmployeeByPin, openPunchAny, toggleClock, startBreak, onClockAfter } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess, deviceThrottleScope } from "@/lib/security/pin-throttle-store";
import { recordAudit } from "@/lib/auth/audit";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";
import { punchTimeLabel } from "@/lib/pos/clock-core";
import { breakSuccessMessage, clockStateOf, decideClockAction, parseBreakRequest, type ClockIntent } from "@/lib/staffing/break-clock-core";
import { offlineArmFor } from "@/lib/pos/offline-unlock-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Wrap once so EVERY return path carries the CORS headers.
  return withPosCors(req, await handlePost(req));
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { pin?: unknown; employeeId?: unknown; intent?: unknown; reason?: unknown; note?: unknown } = {};
  try {
    body = ((await req.json()) as typeof body) ?? {};
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const pin = typeof body.pin === "string" ? body.pin : "";
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  const intent: ClockIntent | null =
    body.intent === "in" || body.intent === "out" || body.intent === "break" || body.intent === "back" ? body.intent : null;

  let employee = null as Awaited<ReturnType<typeof getEmployeeByPin>>;
  if (pin) {
    const throttleScope = deviceThrottleScope(auth.device.id);
    const locked = await pinPadBlocked(throttleScope);
    if (locked) return NextResponse.json({ error: locked }, { status: 429 });
    if (!isValidPin(pin)) return NextResponse.json({ error: "Enter a valid 4–6 digit PIN." }, { status: 400 });
    employee = await getEmployeeByPin(pin);
    if (!employee) {
      await notePinFailure(throttleScope);
      return NextResponse.json({ error: "No active employee for that PIN." }, { status: 401 });
    }
    await notePinSuccess(throttleScope);
  } else if (employeeId) {
    if (!intent) return NextResponse.json({ error: "Say whether this is a clock in, a clock out, a break or back from break." }, { status: 400 });
    employee = await getEmployee(employeeId);
    if (!employee || !employee.active) {
      return NextResponse.json({ error: "Employee not found or inactive. Lock the register and use your PIN." }, { status: 404 });
    }
  } else {
    return NextResponse.json({ error: "Enter your PIN." }, { status: 400 });
  }

  // D161 — a PIN-proven punch also arms offline unlock (PIN path only).
  const offline = pin ? await offlineArmFor(auth.device, employee) : null;
  const open = await openPunchAny(employee.id);
  const state = clockStateOf(open);
  const decision = decideClockAction(intent, state);
  const employeeState = (clockedIn: boolean, onBreak: boolean, breakReason: string | null = null) => ({
    id: employee.id,
    fullName: employee.full_name,
    clockedIn,
    onBreak,
    breakReason,
  });
  if (decision.kind === "already") {
    return NextResponse.json({
      ok: true,
      action: state === "off" ? "out" : "in",
      already: true,
      employee: employeeState(state === "working", state === "on_break", open?.break_reason ?? null),
      message: `${employee.full_name}: ${decision.message}`,
      offline,
    });
  }
  if (decision.kind === "refuse") {
    return NextResponse.json(
      {
        error: `${employee.full_name} ${decision.message}`,
        employee: employeeState(state === "working", state === "on_break", open?.break_reason ?? null),
      },
      { status: 409 },
    );
  }

  let breakReq = null as null | { reason: "lunch" | "other"; note: string | null };
  if (decision.kind === "start_break") {
    const parsed = parseBreakRequest(body.reason, body.note);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    breakReq = parsed.value;
  }

  const result = breakReq ? await startBreak(employee.id, breakReq, "register") : await toggleClock(employee.id, "register");
  if (!result.ok) {
    await recordAudit({
      actorId: employee.staff_id,
      actorEmail: employee.full_name,
      action: "timeclock.refused",
      entityType: "employee",
      entityId: employee.id,
      after: { via: "register", deviceId: auth.device.id, intent: intent ?? decision.kind, reason: result.error, breakReason: breakReq?.reason ?? null },
    });
    return NextResponse.json(
      {
        error: result.error,
        employee: employeeState(state === "working", state === "on_break", open?.break_reason ?? null),
      },
      { status: 409 },
    );
  }

  await recordAudit({
    actorId: employee.staff_id,
    actorEmail: employee.full_name,
    action: `timeclock.${result.action}`,
    entityType: "time_punch",
    entityId: result.punch.id,
    after: {
      via: "register",
      deviceId: auth.device.id,
      employeeId: employee.id,
      shiftId: result.shiftId || null,
      breakReason: result.punch.break_reason ?? null,
      breakNote: result.punch.break_note ?? null,
    },
  });

  const isBreak = result.action === "break_start" || result.action === "break_end";
  const at = result.action === "in" || result.action === "break_start" ? result.punch.clock_in_at : result.punch.clock_out_at;
  return NextResponse.json({
    ok: true,
    action: result.action,
    employee: employeeState(
      onClockAfter(result.action),
      result.action === "break_start",
      result.action === "break_start" ? (result.punch.break_reason ?? null) : null,
    ),
    at,
    message: isBreak
      ? breakSuccessMessage(employee.full_name, result.action as "break_start" | "break_end", result.punch.break_reason, punchTimeLabel(at))
      : `${employee.full_name}: clocked ${result.action === "in" ? "IN" : "OUT"}.`,
    offline,
  });
}
