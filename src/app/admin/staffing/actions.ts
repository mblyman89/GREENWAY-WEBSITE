"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toggleClock, getEmployeeByPin } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";

const BASE = "/admin/staffing";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

// ---------------------------------------------------------------------------
// Clock in/out
// ---------------------------------------------------------------------------

/** Clock in/out for a known employee (button on the clock page). */
export async function clockToggleAction(formData: FormData): Promise<void> {
  const session = await requirePermission("loyalty.view"); // any active staff member
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
  await requirePermission("loyalty.view");
  const pin = str(formData, "pin");
  if (!isValidPin(pin)) redirect(`${BASE}?error=` + encodeURIComponent("Enter a valid 4–6 digit PIN."));
  const emp = await getEmployeeByPin(pin);
  if (!emp) redirect(`${BASE}?error=` + encodeURIComponent("No active employee for that PIN."));
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

// ---------------------------------------------------------------------------
// Employee management (staffing.manage)
// ---------------------------------------------------------------------------

export async function createEmployeeAction(formData: FormData): Promise<void> {
  const session = await requirePermission("staffing.manage");
  const fullName = str(formData, "full_name");
  if (!fullName) redirect(`${BASE}/employees?error=` + encodeURIComponent("Name is required."));
  const pin = str(formData, "clock_pin");
  if (pin && !isValidPin(pin)) redirect(`${BASE}/employees?error=` + encodeURIComponent("PIN must be 4–6 digits."));
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("employees").insert({
    full_name: fullName,
    clock_pin: pin || null,
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
  const pin = str(formData, "clock_pin");
  if (pin && !isValidPin(pin)) redirect(`${BASE}/employees?error=` + encodeURIComponent("PIN must be 4–6 digits."));
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("employees")
    .update({
      full_name: str(formData, "full_name"),
      clock_pin: pin || null,
      job_role: str(formData, "job_role") || "sales",
      active: formData.get("active") === "on" || formData.get("active") === "true",
      notes: str(formData, "notes") || null,
    })
    .eq("id", id);
  if (error) {
    const msg = error.code === "23505" ? "That PIN is already in use." : error.message;
    redirect(`${BASE}/employees?error=` + encodeURIComponent(msg));
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "employee.updated",
    entityType: "employee",
    entityId: id,
  });
  revalidatePath(`${BASE}/employees`);
  redirect(`${BASE}/employees?saved=1`);
}

/** Manager edit of a punch (correct a missed clock-out, etc.). */
export async function editPunchAction(formData: FormData): Promise<void> {
  const session = await requirePermission("staffing.manage");
  const id = str(formData, "id");
  if (!id) redirect(`${BASE}?error=` + encodeURIComponent("Missing punch id."));
  const admin = createSupabaseAdminClient();
  const update: Record<string, unknown> = {};
  const inAt = str(formData, "clock_in_at");
  const outAt = str(formData, "clock_out_at");
  if (inAt) update.clock_in_at = new Date(inAt).toISOString();
  if (outAt) {
    update.clock_out_at = new Date(outAt).toISOString();
  }
  update.source = "manager_edit";
  // Recompute minutes if both present.
  if (inAt && outAt) {
    const mins = Math.max(0, Math.round((Date.parse(outAt) - Date.parse(inAt)) / 60000));
    update.minutes = mins;
  }
  const { error } = await admin.from("time_punches").update(update).eq("id", id);
  if (error) redirect(`${BASE}?error=` + encodeURIComponent(error.message));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "timepunch.edited",
    entityType: "time_punch",
    entityId: id,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?saved=1`);
}
