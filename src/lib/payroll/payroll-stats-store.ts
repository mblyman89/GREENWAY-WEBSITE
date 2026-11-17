/**
 * src/lib/payroll/payroll-stats-store.ts   (D248 slice 5)
 *
 * READS ONLY. Gathers the last N workweeks of punches, current pay rates, the
 * workweek setting, meal-break flags and the sick-leave ledger, and hands them
 * to payroll-stats-core. Nothing here writes.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { addPacificDays, pacificDayKey, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { dayBreakFlags } from "@/lib/staffing/break-clock-core";
import type { WeekdayIndex } from "@/lib/payroll/timesheet-core";
import { computeStats, weekRange, type SickLedgerRow, type StatsPunch, type StatsResult } from "@/lib/payroll/payroll-stats-core";

const short = (e: unknown) =>
  (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e)).slice(0, 240);

export type PayrollStatsView = StatsResult & { readonly workweekStartsOn: WeekdayIndex | null; readonly sickWarning: string | null };

/** Throws a plain-English error on a failed read (except sick leave, which degrades). */
export async function loadPayrollStats(today: string, weeks: number): Promise<PayrollStatsView> {
  if (!isSupabaseServiceConfigured) throw new Error("The database is not configured.");
  const admin = createSupabaseAdminClient();

  const cp = await admin.from("company_profile").select("workweek_starts_on").eq("id", true).maybeSingle();
  if (cp.error) throw new Error(`The workweek setting could not be read: ${short(cp.error)}`);
  const wsRaw = (cp.data as { workweek_starts_on?: number | null } | null)?.workweek_starts_on;
  const workweekStartsOn = typeof wsRaw === "number" && wsRaw >= 0 && wsRaw <= 6 ? (wsRaw as WeekdayIndex) : null;

  const range = weekRange(today, workweekStartsOn ?? 0, weeks);
  const lo = pacificWallTimeToUtcISO(range[0].startDate, "start");
  const hi = pacificWallTimeToUtcISO(addPacificDays(range[range.length - 1].endDate, 1), "start");

  const punchQuery = (cols: string) =>
    admin.from("time_punches").select(cols).gte("clock_in_at", lo).lt("clock_in_at", hi).order("clock_in_at", { ascending: true }).limit(20000);
  const [emps, pay, full] = await Promise.all([
    admin.from("employees").select("id, full_name").eq("active", true).order("full_name", { ascending: true }),
    admin.from("employee_pay").select("employee_id, basis, hourly_rate_milli_cents").eq("is_current", true),
    punchQuery("employee_id, punch_kind, clock_in_at, clock_out_at, break_reason"),
  ]);
  for (const r of [emps, pay]) if (r.error) throw new Error(`Payroll stats could not be read: ${short(r.error)}`);
  // break_reason arrives with migration 0348. Without it, read the rest.
  const pun = full.error ? await punchQuery("employee_id, punch_kind, clock_in_at, clock_out_at") : full;
  if (pun.error) throw new Error(`Time punches could not be read: ${short(pun.error)}`);

  const rate = new Map(
    ((pay.data ?? []) as { employee_id: string; basis: string; hourly_rate_milli_cents: number | null }[]).map((p) => [
      p.employee_id,
      p.basis === "salary" ? null : p.hourly_rate_milli_cents,
    ]),
  );
  const employees = ((emps.data ?? []) as { id: string; full_name: string }[]).map((e) => ({
    id: e.id,
    name: e.full_name,
    rateMilliCents: rate.get(e.id) ?? null,
  }));

  type Row = { employee_id: string; punch_kind: string | null; clock_in_at: string | null; clock_out_at: string | null; break_reason?: string | null };
  const raw = ((pun.data ?? []) as unknown as Row[]).filter((r) => r.clock_in_at);
  const reasonBy = new Map(raw.map((r) => [`${r.employee_id}|${r.clock_in_at}`, r.break_reason ?? null]));
  const punches: StatsPunch[] = raw
    .map((r) => ({
      employeeId: r.employee_id,
      kind: r.punch_kind === "break" ? "break" : "work",
      day: pacificDayKey(r.clock_in_at as string),
      clockInIso: r.clock_in_at as string,
      clockOutIso: r.clock_out_at,
    }));

  const flags = dayBreakFlags(
    punches.map((p) => ({ employeeId: p.employeeId, kind: p.kind, reason: reasonBy.get(`${p.employeeId}|${p.clockInIso}`) ?? null, clockInIso: p.clockInIso, clockOutIso: p.clockOutIso })),
  ).map((f) => ({ employeeId: f.employeeId, day: f.day }));

  let sickLedger: SickLedgerRow[] = [];
  let sickWarning: string | null = null;
  const sl = await admin.from("sick_leave_ledger").select("employee_id, entry_kind, minutes, entry_date").lte("entry_date", today).limit(50000);
  if (sl.error) sickWarning = `Sick leave could not be read, so sick figures show zero: ${short(sl.error)}`;
  else
    sickLedger = ((sl.data ?? []) as { employee_id: string; entry_kind: string; minutes: number; entry_date: string }[]).map((r) => ({
      employeeId: r.employee_id,
      kind: r.entry_kind,
      minutes: r.minutes,
      date: r.entry_date,
    }));

  const stats = computeStats({ today, weeks, workweekStartsOn, employees, punches, breakFlags: flags, sickLedger });
  return { ...stats, workweekStartsOn, sickWarning };
}
