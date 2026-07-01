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
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { type Hm, shiftDurationMinutes } from "@/lib/staffing/schedule-core";

export type Employee = {
  id: string;
  full_name: string;
  staff_id: string | null;
  clock_pin: string | null;
  job_role: "sales" | "manager" | "lead" | "other";
  active: boolean;
  notes: string | null;
  // Optional direct-deposit banking (added in migration 0057). Present because
  // listEmployees/getEmployee select "*". May be null until an admin fills them in.
  bank_routing?: string | null;
  bank_account_number?: string | null;
  bank_account_type?: "checking" | "savings" | null;
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
  source: "web" | "station" | "phone" | "manager_edit" = "web",
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

// ---------------------------------------------------------------------------
// Schedule builder (Slice 69 — item 4)
// ---------------------------------------------------------------------------

/** SCHEDULED shifts for a Pacific week [startYmd, endYmd] inclusive. */
export async function listScheduledShiftsForWeek(
  startYmd: string,
  endYmd: string,
): Promise<Shift[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("shifts")
    .select("*")
    .gte("business_day", startYmd)
    .lte("business_day", endYmd)
    .order("business_day", { ascending: true })
    .order("scheduled_start", { ascending: true });
  return (data as Shift[] | null) ?? [];
}

/** Create a SCHEDULED shift; converts Pacific wall times to UTC for storage. */
export async function createScheduledShift(input: {
  employeeId: string;
  businessDay: string;
  shiftRole: Shift["shift_role"];
  start: Hm;
  end: Hm;
  notes?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const admin = createSupabaseAdminClient();
  const startISO = pacificWallTimeToUtcISO(input.businessDay, {
    h: input.start.h,
    m: input.start.m,
    s: 0,
    ms: 0,
  });
  // If the end wraps past midnight, the end lands on the next calendar day.
  const endsNextDay = shiftDurationMinutes(input.start, input.end) > 0 && input.end.h * 60 + input.end.m <= input.start.h * 60 + input.start.m;
  const endYmd = endsNextDay ? nextYmd(input.businessDay) : input.businessDay;
  const endISO = pacificWallTimeToUtcISO(endYmd, { h: input.end.h, m: input.end.m, s: 0, ms: 0 });

  const { data, error } = await admin
    .from("shifts")
    .insert({
      employee_id: input.employeeId,
      business_day: input.businessDay,
      shift_role: input.shiftRole,
      status: "scheduled",
      scheduled_start: startISO,
      scheduled_end: endISO,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create shift." };
  return { ok: true, id: (data as { id: string }).id };
}

/** Update a SCHEDULED shift's times/role/notes. */
export async function updateScheduledShift(input: {
  id: string;
  businessDay: string;
  shiftRole: Shift["shift_role"];
  start: Hm;
  end: Hm;
  notes?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const admin = createSupabaseAdminClient();
  const startISO = pacificWallTimeToUtcISO(input.businessDay, { h: input.start.h, m: input.start.m, s: 0, ms: 0 });
  const endsNextDay = input.end.h * 60 + input.end.m <= input.start.h * 60 + input.start.m;
  const endYmd = endsNextDay ? nextYmd(input.businessDay) : input.businessDay;
  const endISO = pacificWallTimeToUtcISO(endYmd, { h: input.end.h, m: input.end.m, s: 0, ms: 0 });
  const { error } = await admin
    .from("shifts")
    .update({
      shift_role: input.shiftRole,
      scheduled_start: startISO,
      scheduled_end: endISO,
      notes: input.notes ?? null,
    })
    .eq("id", input.id)
    .eq("status", "scheduled");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Delete a SCHEDULED shift (only if not yet opened/worked). */
export async function deleteScheduledShift(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("shifts").delete().eq("id", id).eq("status", "scheduled");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Copy every SCHEDULED shift from one Pacific week onto another, shifting each
 * shift by the same number of days. Idempotency is the caller's concern; this
 * inserts fresh scheduled rows. Returns how many were copied.
 */
export async function copyWeekSchedule(
  fromMondayYmd: string,
  toMondayYmd: string,
): Promise<{ ok: true; copied: number } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const admin = createSupabaseAdminClient();
  const fromEnd = addDaysYmdLocal(fromMondayYmd, 6);
  const source = await listScheduledShiftsForWeek(fromMondayYmd, fromEnd);
  const scheduled = source.filter((s) => s.status === "scheduled");
  if (scheduled.length === 0) return { ok: true, copied: 0 };

  const dayOffset = diffDaysYmd(fromMondayYmd, toMondayYmd);
  const rows = scheduled.map((s) => {
    const newDay = addDaysYmdLocal(s.business_day, dayOffset);
    const newStart = s.scheduled_start ? shiftISOByDays(s.scheduled_start, dayOffset) : null;
    const newEnd = s.scheduled_end ? shiftISOByDays(s.scheduled_end, dayOffset) : null;
    return {
      employee_id: s.employee_id,
      business_day: newDay,
      shift_role: s.shift_role,
      status: "scheduled" as const,
      scheduled_start: newStart,
      scheduled_end: newEnd,
      notes: s.notes,
    };
  });
  const { error } = await admin.from("shifts").insert(rows);
  if (error) return { ok: false, error: error.message };
  return { ok: true, copied: rows.length };
}

// -- small local date helpers (kept private to avoid importing client core) --
function addDaysYmdLocal(ymd: string, days: number): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function nextYmd(ymd: string): string {
  return addDaysYmdLocal(ymd, 1);
}
function diffDaysYmd(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ams = Date.UTC(ay, am - 1, ad);
  const bms = Date.UTC(by, bm - 1, bd);
  return Math.round((bms - ams) / 86400000);
}
function shiftISOByDays(iso: string, days: number): string {
  const dt = new Date(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString();
}

// ---------------------------------------------------------------------------
// Slice 70 [item 8] — hour adjustments (manager punch management)
// ---------------------------------------------------------------------------

export type PunchWithEmployee = TimePunch & { employee_name: string; job_role: string };

/**
 * All time punches whose clock-in falls on a given Pacific business day,
 * joined with the employee name. Used by the hour-adjustment view. We pull a
 * generous recent window and filter by Pacific day in app (see punchesForDay).
 */
export async function listPunchesForDayAll(businessDay: string): Promise<PunchWithEmployee[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  // Window: clock_in within [day-1, day+2) UTC covers all Pacific-day punches.
  const startUtc = pacificWallTimeToUtcISO(businessDay, "start");
  const endUtc = pacificWallTimeToUtcISO(businessDay, "end");
  // Widen by 12h each side for tz safety.
  const lo = new Date(Date.parse(startUtc) - 12 * 3600000).toISOString();
  const hi = new Date(Date.parse(endUtc) + 12 * 3600000).toISOString();
  const { data } = await admin
    .from("time_punches")
    .select("*, employees(full_name, job_role)")
    .gte("clock_in_at", lo)
    .lte("clock_in_at", hi)
    .order("clock_in_at", { ascending: true });
  const rows = (data as (TimePunch & { employees: { full_name: string; job_role: string } | null })[] | null) ?? [];
  return rows
    .filter((r) => businessDayFor(r.clock_in_at) === businessDay)
    .map((r) => {
      const { employees, ...rest } = r;
      return {
        ...(rest as TimePunch),
        employee_name: employees?.full_name ?? "—",
        job_role: employees?.job_role ?? "sales",
      };
    });
}

/** Fetch a single punch by id (for edit forms / validation). */
export async function getPunch(id: string): Promise<TimePunch | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("time_punches").select("*").eq("id", id).maybeSingle();
  return (data as TimePunch | null) ?? null;
}

type PunchWrite = { clock_in_at: string; clock_out_at: string | null; notes: string };

/**
 * Update an existing punch's in/out times + note. Recomputes minutes. If
 * clock_out ends up before clock_in (after UTC conversion) we reject.
 */
export async function updatePunchTimes(
  id: string,
  write: PunchWrite,
): Promise<{ ok: true; minutes: number | null } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  let minutes: number | null = null;
  if (write.clock_out_at) {
    if (Date.parse(write.clock_out_at) <= Date.parse(write.clock_in_at)) {
      return { ok: false, error: "Clock-out must be after clock-in." };
    }
    minutes = punchMinutes(write.clock_in_at, write.clock_out_at);
  }
  const { error } = await admin
    .from("time_punches")
    .update({
      clock_in_at: write.clock_in_at,
      clock_out_at: write.clock_out_at,
      minutes,
      notes: write.notes,
      source: "manager_edit",
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, minutes };
}

/**
 * Create a brand-new manual punch for an employee (e.g. someone forgot to
 * clock in entirely). Opens/reuses that employee's shift for the Pacific
 * business day of the clock-in, then inserts a work punch.
 */
export async function createManualPunch(input: {
  employeeId: string;
  clockInUtc: string;
  clockOutUtc: string | null;
  notes: string;
}): Promise<{ ok: true; id: string; minutes: number | null } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const emp = await getEmployee(input.employeeId);
  if (!emp) return { ok: false, error: "Employee not found." };

  let minutes: number | null = null;
  if (input.clockOutUtc) {
    if (Date.parse(input.clockOutUtc) <= Date.parse(input.clockInUtc)) {
      return { ok: false, error: "Clock-out must be after clock-in." };
    }
    minutes = punchMinutes(input.clockInUtc, input.clockOutUtc);
  }

  const businessDay = businessDayFor(input.clockInUtc);
  let shiftId: string;
  const { data: existingShift } = await admin
    .from("shifts")
    .select("id, status, started_at")
    .eq("employee_id", input.employeeId)
    .eq("business_day", businessDay)
    .in("status", ["scheduled", "open", "closed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingShift) {
    shiftId = (existingShift as { id: string }).id;
  } else {
    const { data: newShift, error: shiftErr } = await admin
      .from("shifts")
      .insert({
        employee_id: input.employeeId,
        business_day: businessDay,
        shift_role: emp.job_role,
        status: input.clockOutUtc ? "closed" : "open",
        started_at: input.clockInUtc,
      })
      .select("id")
      .single();
    if (shiftErr || !newShift) return { ok: false, error: shiftErr?.message ?? "Failed to open shift." };
    shiftId = (newShift as { id: string }).id;
  }

  const { data: punch, error: punchErr } = await admin
    .from("time_punches")
    .insert({
      employee_id: input.employeeId,
      shift_id: shiftId,
      punch_kind: "work",
      clock_in_at: input.clockInUtc,
      clock_out_at: input.clockOutUtc,
      minutes,
      source: "manager_edit",
      notes: input.notes,
    })
    .select("id")
    .single();
  if (punchErr || !punch) return { ok: false, error: punchErr?.message ?? "Failed to create punch." };
  return { ok: true, id: (punch as { id: string }).id, minutes };
}
