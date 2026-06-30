/**
 * src/lib/staffing/store.ts
 *
 * Server-side read/write helpers for the workforce roster, shifts, and time
 * punches (Slice 25). Clock in/out enforces a single open work punch per
 * employee and stamps worked minutes on clock-out.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { punchMinutes, businessDayFor } from "@/lib/staffing/time";

export type Employee = {
  id: string;
  full_name: string;
  staff_id: string | null;
  clock_pin: string | null;
  job_role: "sales" | "manager" | "lead" | "other";
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Shift = {
  id: string;
  employee_id: string;
  business_day: string;
  shift_role: "sales" | "manager" | "lead" | "other";
  status: "scheduled" | "open" | "closed";
  scheduled_start: string | null;
  scheduled_end: string | null;
  started_at: string | null;
  ended_at: string | null;
  notes: string | null;
};

export type TimePunch = {
  id: string;
  employee_id: string;
  shift_id: string | null;
  punch_kind: "work" | "break";
  clock_in_at: string;
  clock_out_at: string | null;
  minutes: number | null;
  source: string;
  notes: string | null;
};

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export async function listEmployees(opts?: { includeInactive?: boolean }): Promise<Employee[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin.from("employees").select("*").order("full_name", { ascending: true });
  if (!opts?.includeInactive) q = q.eq("active", true);
  const { data } = await q;
  return (data as Employee[] | null) ?? [];
}

export async function getEmployee(id: string): Promise<Employee | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("employees").select("*").eq("id", id).maybeSingle();
  return (data as Employee | null) ?? null;
}

export async function getEmployeeByPin(pin: string): Promise<Employee | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("employees")
    .select("*")
    .eq("clock_pin", pin)
    .eq("active", true)
    .maybeSingle();
  return (data as Employee | null) ?? null;
}

// ---------------------------------------------------------------------------
// Punches
// ---------------------------------------------------------------------------

/** The currently-open WORK punch for an employee (clock_out_at IS NULL). */
export async function openWorkPunch(employeeId: string): Promise<TimePunch | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("time_punches")
    .select("*")
    .eq("employee_id", employeeId)
    .is("clock_out_at", null)
    .order("clock_in_at", { ascending: false })
    .limit(1);
  const rows = (data as TimePunch[] | null) ?? [];
  return rows[0] ?? null;
}

/** All employees currently on the clock (one open work punch each). */
export async function onTheClock(): Promise<
  { employee: Employee; punch: TimePunch }[]
> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("time_punches")
    .select("*")
    .is("clock_out_at", null)
    .eq("punch_kind", "work")
    .order("clock_in_at", { ascending: true });
  const punches = (data as TimePunch[] | null) ?? [];
  if (punches.length === 0) return [];
  const ids = [...new Set(punches.map((p) => p.employee_id))];
  const { data: emps } = await admin.from("employees").select("*").in("id", ids);
  const byId = new Map(((emps as Employee[] | null) ?? []).map((e) => [e.id, e]));
  return punches
    .map((p) => ({ employee: byId.get(p.employee_id), punch: p }))
    .filter((x): x is { employee: Employee; punch: TimePunch } => Boolean(x.employee));
}

export type ClockResult =
  | { ok: true; action: "in" | "out"; punch: TimePunch; shiftId: string }
  | { ok: false; error: string };

/**
 * Toggle clock in/out for an employee. On clock-in we open (or reuse) the
 * employee's OPEN shift for today and create a work punch. On clock-out we close
 * the open work punch and stamp worked minutes. Single open punch enforced.
 */
export async function toggleClock(
  employeeId: string,
  source: "web" | "station" | "manager_edit" = "web",
): Promise<ClockResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const emp = await getEmployee(employeeId);
  if (!emp || !emp.active) return { ok: false, error: "Employee not found or inactive." };

  const open = await openWorkPunch(employeeId);
  const nowISO = new Date().toISOString();

  if (open) {
    // Clock OUT.
    const minutes = punchMinutes(open.clock_in_at, nowISO);
    const { data, error } = await admin
      .from("time_punches")
      .update({ clock_out_at: nowISO, minutes })
      .eq("id", open.id)
      .select("*")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Failed to clock out." };
    return { ok: true, action: "out", punch: data as TimePunch, shiftId: open.shift_id ?? "" };
  }

  // Clock IN — find/open today's shift.
  const businessDay = businessDayFor(nowISO);
  let shiftId: string;
  const { data: existingShift } = await admin
    .from("shifts")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("business_day", businessDay)
    .in("status", ["scheduled", "open"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingShift) {
    shiftId = (existingShift as Shift).id;
    if ((existingShift as Shift).status !== "open") {
      await admin
        .from("shifts")
        .update({ status: "open", started_at: (existingShift as Shift).started_at ?? nowISO })
        .eq("id", shiftId);
    }
  } else {
    const { data: newShift, error: shiftErr } = await admin
      .from("shifts")
      .insert({
        employee_id: employeeId,
        business_day: businessDay,
        shift_role: emp.job_role,
        status: "open",
        started_at: nowISO,
      })
      .select("id")
      .single();
    if (shiftErr || !newShift) return { ok: false, error: shiftErr?.message ?? "Failed to open shift." };
    shiftId = (newShift as { id: string }).id;
  }

  const { data: punch, error: punchErr } = await admin
    .from("time_punches")
    .insert({
      employee_id: employeeId,
      shift_id: shiftId,
      punch_kind: "work",
      clock_in_at: nowISO,
      source,
    })
    .select("*")
    .single();
  if (punchErr || !punch) return { ok: false, error: punchErr?.message ?? "Failed to clock in." };
  return { ok: true, action: "in", punch: punch as TimePunch, shiftId };
}

/** Punches for an employee on a given Pacific business day. */
export async function punchesForDay(employeeId: string, businessDay: string): Promise<TimePunch[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  // We can't filter by Pacific day in SQL cheaply; pull recent and filter in app.
  const { data } = await admin
    .from("time_punches")
    .select("*")
    .eq("employee_id", employeeId)
    .order("clock_in_at", { ascending: true });
  const all = (data as TimePunch[] | null) ?? [];
  return all.filter((p) => businessDayFor(p.clock_in_at) === businessDay);
}

/** Recent shifts (most recent first) for the management view. */
export async function listRecentShifts(limit = 60): Promise<(Shift & { employee_name: string })[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("shifts")
    .select("*")
    .order("business_day", { ascending: false })
    .order("started_at", { ascending: false })
    .limit(limit);
  const shifts = (data as Shift[] | null) ?? [];
  if (shifts.length === 0) return [];
  const ids = [...new Set(shifts.map((s) => s.employee_id))];
  const { data: emps } = await admin.from("employees").select("id, full_name").in("id", ids);
  const byId = new Map(((emps as { id: string; full_name: string }[] | null) ?? []).map((e) => [e.id, e.full_name]));
  return shifts.map((s) => ({ ...s, employee_name: byId.get(s.employee_id) ?? "—" }));
}
