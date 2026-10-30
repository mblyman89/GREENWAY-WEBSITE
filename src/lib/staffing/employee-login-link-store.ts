/**
 * employee-login-link-store.ts - Phase 5 (G-53 / G-54, owner D70 / D71).
 *
 * THE ONLY CODE THAT WRITES `employees.staff_id`. books-87 still holds: the
 * owner creates the employee in Payroll Setup and grants a back-office sign-in
 * separately ("I want to create the employee in payroll/ W-4 setup, then I
 * will give them access to the back office if they need access to it."). This
 * file never inserts an employee and never writes `staff_profiles`; it sets or
 * clears a pointer between two records that already exist, with an owner or
 * admin pressing the button (`[id]/actions.ts` linkSignInAction /
 * unlinkSignInAction) and an audit row with before/after.
 *
 * The trap in tests/compliance/logins-are-not-employees.test.ts allows this
 * one file, this one function, update-only. Anything else that writes
 * staff_id still fails that test.
 *
 * Races: link writes with `.is("staff_id", null)` and unlink with
 * `.eq("staff_id", expected)`, so two people pressing at once cannot overwrite
 * each other. Migration 0324 adds a unique index (one sign-in, one employee);
 * a 23505 from it is reported in plain English.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type { StaffRole } from "@/lib/supabase/types";
import type { EmployeeSummary, FutureShift, SignInSummary } from "@/lib/staffing/offboarding-core";

type Status = EmployeeSummary["status"];

function toStatus(row: { employment_status?: string | null; active?: boolean | null }): Status {
  const s = row.employment_status;
  if (s === "candidate" || s === "onboarding" || s === "active" || s === "terminated") return s;
  return row.active ? "active" : "terminated";
}

/** Every back-office sign-in (staff_profiles), for the picker and the Users page. */
export async function listSignIns(): Promise<SignInSummary[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("staff_profiles")
    .select("id, email, full_name, role, active")
    .order("email", { ascending: true });
  if (error) return [];
  return ((data as { id: string; email: string; full_name: string | null; role: StaffRole; active: boolean }[] | null) ?? []).map(
    (r) => ({ id: r.id, email: r.email, fullName: r.full_name, role: r.role, active: Boolean(r.active) }),
  );
}

export async function getSignIn(staffId: string | null | undefined): Promise<SignInSummary | null> {
  if (!staffId || !isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("staff_profiles")
    .select("id, email, full_name, role, active")
    .eq("id", staffId)
    .maybeSingle();
  if (!data) return null;
  const r = data as { id: string; email: string; full_name: string | null; role: StaffRole; active: boolean };
  return { id: r.id, email: r.email, fullName: r.full_name, role: r.role, active: Boolean(r.active) };
}

export async function getEmployeeSummary(employeeId: string): Promise<EmployeeSummary | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("employees").select("*").eq("id", employeeId).maybeSingle();
  if (!data) return null;
  const r = data as { id: string; full_name: string; staff_id: string | null; employment_status?: string | null; active?: boolean };
  return { id: r.id, fullName: r.full_name, status: toStatus(r), staffId: r.staff_id ?? null };
}

/**
 * Linked employees keyed by sign-in id. A sign-in that appears on two files
 * (possible only before 0324) maps to the first and is listed in `doubled`.
 */
export async function linkedEmployeesBySignIn(): Promise<{
  bySignIn: Map<string, { id: string; fullName: string; status: Status }>;
  doubled: string[];
}> {
  const bySignIn = new Map<string, { id: string; fullName: string; status: Status }>();
  const doubled: string[] = [];
  if (!isSupabaseServiceConfigured) return { bySignIn, doubled };
  const admin = createSupabaseAdminClient();
  // Paged so a large roster is never truncated (no .limit >= 1000).
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("employees")
      .select("*")
      .not("staff_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) break;
    const rows = (data as { id: string; full_name: string; staff_id: string; employment_status?: string | null; active?: boolean }[] | null) ?? [];
    for (const r of rows) {
      if (bySignIn.has(r.staff_id)) doubled.push(r.staff_id);
      else bySignIn.set(r.staff_id, { id: r.id, fullName: r.full_name, status: toStatus(r) });
    }
    if (rows.length < PAGE) break;
  }
  return { bySignIn, doubled };
}

/** The OTHER employee file this sign-in is linked to, if any. */
export async function employeeLinkedToSignIn(
  staffId: string,
  exceptEmployeeId: string,
): Promise<{ id: string; fullName: string } | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("employees")
    .select("id, full_name")
    .eq("staff_id", staffId)
    .neq("id", exceptEmployeeId)
    .limit(1);
  const row = ((data as { id: string; full_name: string }[] | null) ?? [])[0];
  return row ? { id: row.id, fullName: row.full_name } : null;
}

/** The employee file linked to this sign-in (any), for the Users page messages. */
export async function employeeForSignIn(staffId: string): Promise<{ id: string; fullName: string; status: Status } | null> {
  if (!staffId || !isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("employees").select("*").eq("staff_id", staffId).limit(1);
  const r = ((data as { id: string; full_name: string; employment_status?: string | null; active?: boolean }[] | null) ?? [])[0];
  return r ? { id: r.id, fullName: r.full_name, status: toStatus(r) } : null;
}

export type LinkWriteResult = { ok: true } | { ok: false; error: string };

/**
 * THE one write of employees.staff_id (update only). `expected` is what the
 * caller read: null when linking, the current sign-in id when unlinking.
 */
export async function setEmployeeSignInLink(
  employeeId: string,
  next: string | null,
  expected: string | null,
): Promise<LinkWriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured. Nothing changed." };
  const admin = createSupabaseAdminClient();
  const base = admin.from("employees").update({ staff_id: next }).eq("id", employeeId);
  const guarded = expected === null ? base.is("staff_id", null) : base.eq("staff_id", expected);
  const { data, error } = await guarded.select("id");
  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "That sign-in was just linked to another employee. One sign-in belongs to one employee. Nothing was linked.",
      };
    }
    return { ok: false, error: `${error.message}. Nothing changed.` };
  }
  if (((data as unknown[] | null) ?? []).length !== 1) {
    return {
      ok: false,
      error: "Someone else changed this file's sign-in a moment ago. Reload the page and try again. Nothing changed.",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Offboarding reads + the one shift delete (G-54)
// ---------------------------------------------------------------------------

/** Scheduled shifts on or after `fromYmd` for this employee (bounded: 400 days of shifts at most). */
export async function scheduledShiftsFrom(employeeId: string, fromYmd: string): Promise<FutureShift[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("shifts")
    .select("id, business_day, status")
    .eq("employee_id", employeeId)
    .eq("status", "scheduled")
    .gte("business_day", fromYmd)
    .order("business_day", { ascending: true })
    .limit(400);
  if (error) return [];
  return (data as FutureShift[] | null) ?? [];
}

/** Deletes only rows that are still `scheduled`; returns how many went. */
export async function deleteScheduledShiftsByIds(
  employeeId: string,
  ids: string[],
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  if (ids.length === 0) return { ok: true, deleted: 0 };
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured" };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("shifts")
    .delete()
    .eq("employee_id", employeeId)
    .eq("status", "scheduled")
    .in("id", ids)
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, deleted: ((data as unknown[] | null) ?? []).length };
}
