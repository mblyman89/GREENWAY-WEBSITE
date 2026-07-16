"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  toggleClock,
  getEmployeeByPin,
  getPunch,
  updatePunchTimes,
  createManualPunch,
} from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { parsePunchEdit, composeEditNote } from "@/lib/staffing/timeclock-core";
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { hashPin } from "@/lib/security/pin-hash";
import {
  pinPadBlocked,
  notePinFailure,
  notePinSuccess,
  TIMECLOCK_THROTTLE_SCOPE,
} from "@/lib/security/pin-throttle-store";

const BASE = "/admin/staffing";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

// ---------------------------------------------------------------------------
// Clock in/out
// ---------------------------------------------------------------------------

/** Clock in/out for a known employee (button on the clock page). */
export async function clockToggleAction(formData: FormData): Promise<void> {
  const session = await requirePermission("timeclock.use"); // any active staff member
  const employeeId = str(formData, "employee_id");
  if (!employeeId) redirect(`${BASE}?error=` + encodeURIComponent("Missing employee."));
  const result = await toggleClock(employeeId, "web");
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `timeclock.${result.action}`,
    entityType: "employee",
    entityId: employeeId,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?clocked=${result.action}`);
}

/** Clock in/out via PIN at a shared station. */
export async function clockByPinAction(formData: FormData): Promise<void> {
  await requirePermission("timeclock.use");
  // S-10: brute-force throttle on the shared PIN pad.
  const locked = await pinPadBlocked(TIMECLOCK_THROTTLE_SCOPE);
  if (locked) redirect(`${BASE}?error=` + encodeURIComponent(locked));
  const pin = str(formData, "pin");
  if (!isValidPin(pin)) redirect(`${BASE}?error=` + encodeURIComponent("Enter a valid 4–6 digit PIN."));
  const emp = await getEmployeeByPin(pin);
  if (!emp) {
    await notePinFailure(TIMECLOCK_THROTTLE_SCOPE);
    redirect(`${BASE}?error=` + encodeURIComponent("No active employee for that PIN."));
  }
  await notePinSuccess(TIMECLOCK_THROTTLE_SCOPE);
  const result = await toggleClock(emp.id, "station");
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error));
  await recordAudit({
    actorId: emp.staff_id,
    actorEmail: emp.full_name,
    action: `timeclock.${result.action}`,
    entityType: "employee",
    entityId: emp.id,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?clocked=${result.action}&who=${encodeURIComponent(emp.full_name)}`);
}

/**
 * Clock in/out from an employee's PHONE (Slice 70, item 8). Same PIN flow as
 * the station, but tagged source="phone" and lives on the mobile-first
 * /admin/staffing/clock page so employees can bookmark it. Any active staff
 * session is allowed (the PIN identifies the employee).
 */
export async function clockByPinPhoneAction(formData: FormData): Promise<void> {
  await requirePermission("timeclock.use");
  const pin = str(formData, "pin");
  const CLOCK = `${BASE}/clock`;
  // S-10: brute-force throttle on the PIN entry (shared with the station pad).
  const locked = await pinPadBlocked(TIMECLOCK_THROTTLE_SCOPE);
  if (locked) redirect(`${CLOCK}?error=` + encodeURIComponent(locked));
  if (!isValidPin(pin)) redirect(`${CLOCK}?error=` + encodeURIComponent("Enter a valid 4–6 digit PIN."));
  const emp = await getEmployeeByPin(pin);
  if (!emp) {
    await notePinFailure(TIMECLOCK_THROTTLE_SCOPE);
    redirect(`${CLOCK}?error=` + encodeURIComponent("No active employee for that PIN."));
  }
  await notePinSuccess(TIMECLOCK_THROTTLE_SCOPE);
  const result = await toggleClock(emp.id, "phone");
  if (!result.ok) redirect(`${CLOCK}?error=` + encodeURIComponent(result.error));
  await recordAudit({
    actorId: emp.staff_id,
    actorEmail: emp.full_name,
    action: `timeclock.${result.action}`,
    entityType: "employee",
    entityId: emp.id,
  });
  revalidatePath(CLOCK);
  revalidatePath(BASE);
  redirect(`${CLOCK}?clocked=${result.action}&who=${encodeURIComponent(emp.full_name)}`);
}

// ---------------------------------------------------------------------------
// Employee management (staffing.manage)
// ---------------------------------------------------------------------------

export async function createEmployeeAction(formData: FormData): Promise<void> {
  const session = await requirePermission("staffing.manage");
  const fullName = str(formData, "full_name");
  if (!fullName) redirect(`${BASE}/employees?error=` + encodeURIComponent("Name is required."));
  const pin = str(formData, "clock_pin");
  if (pin && !isValidPin(pin)) redirect(`${BASE}/employees?error=` + encodeURIComponent("PIN must be 4–6 digits."));
  // S-10: PINs are stored as salted scrypt hashes, so the old unique index
  // cannot catch duplicates — check by verification before saving.
  if (pin) {
    const holder = await getEmployeeByPin(pin);
    if (holder) redirect(`${BASE}/employees?error=` + encodeURIComponent("That PIN is already in use."));
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("employees").insert({
    full_name: fullName,
    clock_pin: pin ? hashPin(pin) : null,
    job_role: str(formData, "job_role") || "sales",
    active: true,
  });
  if (error) {
    const msg = error.code === "23505" ? "That PIN is already in use." : error.message;
    redirect(`${BASE}/employees?error=` + encodeURIComponent(msg));
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "employee.created",
    entityType: "employee",
    entityId: fullName,
  });
  revalidatePath(`${BASE}/employees`);
  redirect(`${BASE}/employees?saved=1`);
}

export async function updateEmployeeAction(formData: FormData): Promise<void> {
  const session = await requirePermission("staffing.manage");
  const id = str(formData, "id");
  if (!id) redirect(`${BASE}/employees?error=` + encodeURIComponent("Missing id."));
  // Task S-b: the roster edit form now lives on the employee FILE page, so
  // return there when asked (values restricted to our own employee routes).
  const back =
    formData.get("return_to") === "file" ? `${BASE}/employees/${id}` : `${BASE}/employees`;
  // S-10: hashes are never shown, so the PIN field is now write-only —
  // blank = keep the current PIN; the "remove PIN" checkbox clears it.
  const pin = str(formData, "clock_pin");
  const clearPin = formData.get("clear_pin") === "on";
  if (pin && !isValidPin(pin)) redirect(`${back}?error=` + encodeURIComponent("PIN must be 4–6 digits."));
  if (pin) {
    const holder = await getEmployeeByPin(pin);
    if (holder && holder.id !== id) {
      redirect(`${back}?error=` + encodeURIComponent("That PIN is already in use."));
    }
  }
  const update: Record<string, unknown> = {
    full_name: str(formData, "full_name"),
    job_role: str(formData, "job_role") || "sales",
    notes: str(formData, "notes") || null,
  };
  // Task S-b: `active` is driven by the lifecycle (activate/terminate) on the
  // employee file page. Only legacy forms that still render the checkbox may
  // set it — the file-page basics form omits it entirely.
  if (formData.has("active")) {
    update.active = formData.get("active") === "on" || formData.get("active") === "true";
  }
  if (clearPin) update.clock_pin = null;
  else if (pin) update.clock_pin = hashPin(pin);
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("employees").update(update).eq("id", id);
  if (error) {
    const msg = error.code === "23505" ? "That PIN is already in use." : error.message;
    redirect(`${back}?error=` + encodeURIComponent(msg));
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "employee.updated",
    entityType: "employee",
    entityId: id,
  });
  revalidatePath(`${BASE}/employees`);
  revalidatePath(`${BASE}/employees/${id}`);
  redirect(formData.get("return_to") === "file" ? `${back}?ok=` + encodeURIComponent("Saved.") : `${back}?saved=1`);
}

// ---------------------------------------------------------------------------
// Hour adjustments (staffing.manage) — Slice 70, item 8
// ---------------------------------------------------------------------------

export type PunchActionResult = { ok: true; minutes?: number | null } | { ok: false; error?: string; errors?: string[] };

/** Convert a WallTime (Pacific) to a UTC ISO instant via the tz helper. */
function wallToUtc(w: { ymd: string; h: number; m: number; s: number }): string {
  return pacificWallTimeToUtcISO(w.ymd, { h: w.h, m: w.m, s: w.s, ms: 0 });
}

/**
 * Manager edit of an existing punch (correct a missed clock-out, fix times).
 * Requires a reason, which is prepended to the punch notes and audited. Times
 * are entered as Pacific wall-clock and converted to UTC here.
 */
export async function editPunchAction(input: {
  id: string;
  clockInLocal: string;
  clockOutLocal?: string;
  reason: string;
}): Promise<PunchActionResult> {
  const session = await requirePermission("staffing.manage");
  if (!input.id) return { ok: false, error: "Missing punch id." };

  const parsed = parsePunchEdit({
    clockInLocal: input.clockInLocal,
    clockOutLocal: input.clockOutLocal,
    reason: input.reason,
  });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const existing = await getPunch(input.id);
  if (!existing) return { ok: false, error: "Punch not found." };

  const clockInUtc = wallToUtc(parsed.value.inWall);
  const clockOutUtc = parsed.value.outWall ? wallToUtc(parsed.value.outWall) : null;
  const notes = composeEditNote(parsed.value.reason, existing.notes);

  const res = await updatePunchTimes(input.id, {
    clock_in_at: clockInUtc,
    clock_out_at: clockOutUtc,
    notes,
  });
  if (!res.ok) return { ok: false, error: res.error };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "timepunch.edited",
    entityType: "time_punch",
    entityId: input.id,
    after: { clock_in_at: clockInUtc, clock_out_at: clockOutUtc, minutes: res.minutes, reason: parsed.value.reason },
  });
  revalidatePath(`${BASE}/hours`);
  revalidatePath(BASE);
  return { ok: true, minutes: res.minutes };
}

/**
 * Create a brand-new manual punch (employee forgot to clock in entirely).
 * Requires a reason; audited. Times are Pacific wall-clock.
 */
export async function createPunchAction(input: {
  employeeId: string;
  clockInLocal: string;
  clockOutLocal?: string;
  reason: string;
}): Promise<PunchActionResult> {
  const session = await requirePermission("staffing.manage");
  if (!input.employeeId) return { ok: false, error: "Choose an employee." };

  const parsed = parsePunchEdit({
    clockInLocal: input.clockInLocal,
    clockOutLocal: input.clockOutLocal,
    reason: input.reason,
  });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const clockInUtc = wallToUtc(parsed.value.inWall);
  const clockOutUtc = parsed.value.outWall ? wallToUtc(parsed.value.outWall) : null;
  const notes = composeEditNote(parsed.value.reason);

  const res = await createManualPunch({
    employeeId: input.employeeId,
    clockInUtc,
    clockOutUtc,
    notes,
  });
  if (!res.ok) return { ok: false, error: res.error };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "timepunch.created",
    entityType: "time_punch",
    entityId: res.id,
    after: { employee_id: input.employeeId, clock_in_at: clockInUtc, clock_out_at: clockOutUtc, minutes: res.minutes, reason: parsed.value.reason },
  });
  revalidatePath(`${BASE}/hours`);
  revalidatePath(BASE);
  return { ok: true, minutes: res.minutes };
}
