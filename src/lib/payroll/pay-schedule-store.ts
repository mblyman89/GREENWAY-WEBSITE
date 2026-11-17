/**
 * src/lib/payroll/pay-schedule-store.ts   (D248 slice 1)
 *
 * Reads and writes for the payroll command center's pay schedule:
 *   - the schedule itself (one site_settings row, key payroll_pay_schedule),
 *   - the workweek anchor (company_profile.workweek_starts_on - the column the
 *     timesheet engine already reads; set ONLY when the owner/admin picks it),
 *   - the pay calendar (public.pay_periods), INSERTING planned rows only.
 *
 * It never updates or deletes an existing pay period, never approves or locks
 * one, never books a journal and never files anything. Overlaps are refused
 * twice: by diffPlan() before the insert and by the pay_periods_no_overlap_excl
 * exclusion constraint in the database.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  PAY_SCHEDULE_KEY,
  PAY_SCHEDULE_LABEL,
  diffPlan,
  insertRowsFor,
  parsePaySchedule,
  planYear,
  type ExistingPeriod,
  type PaySchedule,
  type PlanRowVerdict,
} from "@/lib/payroll/pay-schedule-core";
import { addCalendarDays } from "@/lib/payments/ach-authorization-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const short = (e: unknown) =>
  (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e)).slice(0, 240);

const PERIOD_COLS = "id, label, start_date, end_date, pay_date, pay_frequency, quarter, tax_year, status, approved_at, locked_at, notes";

export type StoredPeriod = ExistingPeriod & {
  readonly quarter: number;
  readonly tax_year: number;
  readonly approved_at: string | null;
  readonly locked_at: string | null;
  readonly notes: string | null;
};

/** The saved schedule, or null when none is saved. A failed read throws. */
export async function loadPaySchedule(admin: Admin = createSupabaseAdminClient()): Promise<PaySchedule | null> {
  const { data, error } = await admin.from("site_settings").select("value_json").eq("key", PAY_SCHEDULE_KEY).maybeSingle();
  if (error) throw new Error(`The pay schedule could not be read: ${short(error)}`);
  return parsePaySchedule((data as { value_json?: unknown } | null)?.value_json ?? null);
}

export async function savePaySchedule(
  schedule: Omit<PaySchedule, "updatedAt" | "updatedBy">,
  actorId: string,
  admin: Admin = createSupabaseAdminClient(),
): Promise<PaySchedule> {
  const value: PaySchedule = { ...schedule, updatedAt: new Date().toISOString(), updatedBy: actorId };
  const { error } = await admin
    .from("site_settings")
    .upsert({ key: PAY_SCHEDULE_KEY, label: PAY_SCHEDULE_LABEL, value_json: value, updated_by: actorId }, { onConflict: "key" });
  if (error) throw new Error(`The pay schedule was not saved: ${short(error)}`);
  return value;
}

export type WorkweekSetting = { readonly startsOn: number | null; readonly effectiveDate: string | null };

export async function loadWorkweek(admin: Admin = createSupabaseAdminClient()): Promise<WorkweekSetting> {
  const { data, error } = await admin
    .from("company_profile")
    .select("workweek_starts_on, workweek_effective_date")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(`The workweek could not be read: ${short(error)}`);
  const r = data as { workweek_starts_on: number | null; workweek_effective_date: string | null } | null;
  return { startsOn: r?.workweek_starts_on ?? null, effectiveDate: r?.workweek_effective_date ?? null };
}

/** Set the workweek anchor. The company_profile row must already exist (Company information). */
export async function saveWorkweek(
  startsOn: number,
  effectiveDate: string,
  admin: Admin = createSupabaseAdminClient(),
): Promise<void> {
  if (!Number.isInteger(startsOn) || startsOn < 0 || startsOn > 6) throw new Error("Pick a day of the week.");
  const { data, error } = await admin
    .from("company_profile")
    .update({ workweek_starts_on: startsOn, workweek_effective_date: effectiveDate })
    .eq("id", true)
    .select("id");
  if (error) throw new Error(`The workweek was not saved: ${short(error)}`);
  if (((data as unknown[] | null) ?? []).length !== 1) {
    throw new Error("There is no company profile yet. Fill in Books → Company information first, then set the workweek.");
  }
}

/** Pay periods whose dates touch [fromIso, toIso] (any cadence). */
export async function loadPeriodsBetween(
  fromIso: string,
  toIso: string,
  admin: Admin = createSupabaseAdminClient(),
): Promise<StoredPeriod[]> {
  const { data, error } = await admin
    .from("pay_periods")
    .select(PERIOD_COLS)
    .lte("start_date", toIso)
    .gte("end_date", fromIso)
    .order("start_date", { ascending: true });
  if (error) throw new Error(`The pay calendar could not be read: ${short(error)}`);
  return (data ?? []) as unknown as StoredPeriod[];
}

/** Every pay period paid in a tax year. */
export async function loadPeriodsForYear(year: number, admin: Admin = createSupabaseAdminClient()): Promise<StoredPeriod[]> {
  const { data, error } = await admin
    .from("pay_periods")
    .select(PERIOD_COLS)
    .eq("tax_year", year)
    .order("pay_date", { ascending: true });
  if (error) throw new Error(`The pay calendar could not be read: ${short(error)}`);
  return (data ?? []) as unknown as StoredPeriod[];
}

export type YearPlan = { readonly year: number; readonly verdicts: PlanRowVerdict[] };

/** The schedule's plan for a year compared with the calendar on file. */
export async function planYearAgainstCalendar(
  schedule: PaySchedule,
  year: number,
  admin: Admin = createSupabaseAdminClient(),
): Promise<YearPlan> {
  const plan = planYear(schedule, year);
  if (plan.length === 0) return { year, verdicts: [] };
  const existing = await loadPeriodsBetween(
    addCalendarDays(plan[0].startDate, -1),
    addCalendarDays(plan[plan.length - 1].endDate, 1),
    admin,
  );
  return { year, verdicts: diffPlan(plan, existing) };
}

export type GenerateOutcome = {
  readonly inserted: number;
  readonly alreadyOnFile: number;
  readonly conflicts: number;
  readonly conflictNotes: string[];
};

/**
 * Insert the NEW planned periods for a year. Existing rows are never touched;
 * conflicts are reported, never "fixed".
 */
export async function generateYear(
  schedule: PaySchedule,
  year: number,
  admin: Admin = createSupabaseAdminClient(),
): Promise<GenerateOutcome> {
  const { verdicts } = await planYearAgainstCalendar(schedule, year, admin);
  const rows = insertRowsFor(verdicts);
  const conflicts = verdicts.filter((v) => v.kind === "conflict");
  let inserted = 0;
  if (rows.length > 0) {
    const { data, error } = await admin.from("pay_periods").insert(rows).select("id");
    if (error) throw new Error(`The pay periods were not added: ${short(error)}`);
    inserted = ((data as unknown[] | null) ?? []).length;
  }
  return {
    inserted,
    alreadyOnFile: verdicts.filter((v) => v.kind === "on_file").length,
    conflicts: conflicts.length,
    conflictNotes: conflicts.map((c) => (c.kind === "conflict" ? `${c.planned.label}: ${c.why}` : "")),
  };
}

/* ── hub facts ─────────────────────────────────────────────────────────── */

export type PayrollHubFacts = {
  readonly activeEmployees: number;
  readonly withPayRate: number;
  readonly withW4: number;
  readonly hourlyNames: readonly string[];
  readonly missingPayNames: readonly string[];
  readonly missingW4Names: readonly string[];
};

/** Who is ready to be calculated. Reads only. */
export async function loadPayrollHubFacts(admin: Admin = createSupabaseAdminClient()): Promise<PayrollHubFacts> {
  const [emps, pay, w4] = await Promise.all([
    admin.from("employees").select("id, full_name").eq("active", true).order("full_name", { ascending: true }),
    admin.from("employee_pay").select("employee_id, basis").eq("is_current", true),
    admin.from("employee_w4").select("employee_id").eq("is_current", true),
  ]);
  for (const r of [emps, pay, w4]) if (r.error) throw new Error(`Payroll readiness could not be read: ${short(r.error)}`);
  const people = (emps.data ?? []) as { id: string; full_name: string }[];
  const payBy = new Map(((pay.data ?? []) as { employee_id: string; basis: string }[]).map((p) => [p.employee_id, p.basis]));
  const w4Set = new Set(((w4.data ?? []) as { employee_id: string }[]).map((w) => w.employee_id));
  return {
    activeEmployees: people.length,
    withPayRate: people.filter((p) => payBy.has(p.id)).length,
    withW4: people.filter((p) => w4Set.has(p.id)).length,
    hourlyNames: people.filter((p) => payBy.get(p.id) === "hourly").map((p) => p.full_name),
    missingPayNames: people.filter((p) => !payBy.has(p.id)).map((p) => p.full_name),
    missingW4Names: people.filter((p) => !w4Set.has(p.id)).map((p) => p.full_name),
  };
}

export const payScheduleConfigured = (): boolean => isSupabaseServiceConfigured;
