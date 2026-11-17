/**
 * src/lib/payroll/time-card-store.ts   (D248 slice 2)
 *
 * READS ONLY. Gathers one pay period's punches, meal-break flags, sick-leave
 * usage and the pay engine's own verdict, and hands them to time-card-core to
 * lay out. Adjustments go through the existing audited staffing actions
 * (editPunchAction / createPunchAction - reason required); approval goes through
 * the existing timesheet approval (approvePayPeriod). Nothing here writes.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificDayKey, pacificParts, pacificWallTimeToUtcISO, addPacificDays } from "@/lib/reports/timezone";
import { BREAK_FLAG_TEXT, dayBreakFlags } from "@/lib/staffing/break-clock-core";
import { computeTimesheetForPeriod, loadPayPeriod, type PayPeriodRow } from "@/lib/payroll/timesheet-store";
import type { WeekdayIndex } from "@/lib/payroll/timesheet-core";
import {
  buildTimeCard,
  rollUp,
  sortCards,
  type CardFlag,
  type CardPunch,
  type EngineView,
  type PeriodRollup,
  type TimeCard,
} from "@/lib/payroll/time-card-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const short = (e: unknown) =>
  (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e)).slice(0, 240);

function toLocal(iso: string | null): string {
  if (!iso) return "";
  const p = pacificParts(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

type PunchRow = {
  id: string;
  employee_id: string;
  punch_kind: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  source: string | null;
  notes: string | null;
  break_reason?: string | null;
};

export type TimeCardsView = {
  readonly period: PayPeriodRow;
  readonly workweekStartsOn: WeekdayIndex | null;
  readonly cards: readonly TimeCard[];
  readonly rollup: PeriodRollup;
  /** The pay engine's period-level problem (e.g. no workweek), if it refused the whole period. */
  readonly engineProblem: string | null;
  /** Gross the engine computed for clean employees (cents), or null when it did not run. */
  readonly engineGrossCents: number | null;
  readonly employees: readonly { id: string; name: string }[];
};

/** Everything the time-card screen needs for one period. Throws on a failed read. */
export async function loadTimeCards(periodId: string, admin: Admin = createSupabaseAdminClient()): Promise<TimeCardsView> {
  if (!isSupabaseServiceConfigured) throw new Error("The database is not configured.");
  const pr = await loadPayPeriod(periodId);
  if (!pr.ok) throw new Error(pr.message);
  const period = pr.period;

  const lo = pacificWallTimeToUtcISO(period.start_date, "start");
  const hi = pacificWallTimeToUtcISO(addPacificDays(period.end_date, 1), "start");

  const [emps, pay, cp] = await Promise.all([
    admin.from("employees").select("id, full_name").eq("active", true).order("full_name", { ascending: true }),
    admin.from("employee_pay").select("employee_id, basis, hourly_rate_milli_cents").eq("is_current", true),
    admin.from("company_profile").select("workweek_starts_on").eq("id", true).maybeSingle(),
  ]);
  for (const r of [emps, pay, cp]) if (r.error) throw new Error(`Time cards could not be read: ${short(r.error)}`);
  const people = (emps.data ?? []) as { id: string; full_name: string }[];
  const rateBy = new Map(
    ((pay.data ?? []) as { employee_id: string; basis: string; hourly_rate_milli_cents: number | null }[]).map((p) => [
      p.employee_id,
      p.basis === "salary" || (p.hourly_rate_milli_cents ?? 0) > 0,
    ]),
  );
  const wsRaw = (cp.data as { workweek_starts_on?: number | null } | null)?.workweek_starts_on;
  const workweekStartsOn = typeof wsRaw === "number" && wsRaw >= 0 && wsRaw <= 6 ? (wsRaw as WeekdayIndex) : null;

  // Punches - with break_reason when migration 0348 is applied, without it otherwise.
  let rows: PunchRow[];
  {
    const full = await admin
      .from("time_punches")
      .select("id, employee_id, punch_kind, clock_in_at, clock_out_at, source, notes, break_reason")
      .gte("clock_in_at", lo)
      .lt("clock_in_at", hi)
      .order("clock_in_at", { ascending: true });
    if (full.error) {
      const basic = await admin
        .from("time_punches")
        .select("id, employee_id, punch_kind, clock_in_at, clock_out_at, source, notes")
        .gte("clock_in_at", lo)
        .lt("clock_in_at", hi)
        .order("clock_in_at", { ascending: true });
      if (basic.error) throw new Error(`Time punches could not be read: ${short(basic.error)}`);
      rows = (basic.data ?? []) as PunchRow[];
    } else {
      rows = (full.data ?? []) as PunchRow[];
    }
  }
  const punches: CardPunch[] = rows
    .filter((r) => r.clock_in_at)
    .map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      kind: r.punch_kind === "break" ? "break" : "work",
      day: pacificDayKey(r.clock_in_at as string),
      clockInIso: r.clock_in_at as string,
      clockOutIso: r.clock_out_at,
      inLocal: toLocal(r.clock_in_at),
      outLocal: toLocal(r.clock_out_at),
      source: r.source ?? "",
      notes: r.notes,
      breakReason: r.break_reason ?? null,
    }));

  // Meal-break flags (WAC 296-126-092) - advisory, same function the pay engine uses.
  const flagsByEmp = new Map<string, CardFlag[]>();
  for (const f of dayBreakFlags(
    punches.map((p) => ({
      employeeId: p.employeeId,
      kind: p.kind,
      reason: p.breakReason,
      clockInIso: p.clockInIso,
      clockOutIso: p.clockOutIso,
    })),
  )) {
    const list = flagsByEmp.get(f.employeeId) ?? [];
    list.push({ day: f.day, code: f.code, label: BREAK_FLAG_TEXT[f.code].label, detail: f.detail });
    flagsByEmp.set(f.employeeId, list);
  }

  // Sick leave USED in the period (ledger usage rows carry negative minutes).
  const sickBy = new Map<string, Record<string, number>>();
  {
    const s = await admin
      .from("sick_leave_ledger")
      .select("employee_id, entry_date, minutes")
      .eq("entry_kind", "usage")
      .gte("entry_date", period.start_date)
      .lte("entry_date", period.end_date);
    if (s.error) throw new Error(`Sick leave could not be read: ${short(s.error)}`);
    for (const r of (s.data ?? []) as { employee_id: string; entry_date: string; minutes: number }[]) {
      const m = sickBy.get(r.employee_id) ?? {};
      m[r.entry_date] = (m[r.entry_date] ?? 0) + Math.abs(r.minutes);
      sickBy.set(r.employee_id, m);
    }
  }

  // The pay engine's verdict, for the cross-check. A period-level refusal is shown, not thrown.
  const engineBy = new Map<string, EngineView>();
  let engineProblem: string | null = null;
  let engineGrossCents: number | null = null;
  const eng = await computeTimesheetForPeriod(periodId);
  if (!eng.ok) {
    engineProblem = eng.message;
  } else {
    engineGrossCents = eng.totalGrossCents;
    for (const s of eng.sheets) {
      if (s.refusals.length > 0) {
        engineBy.set(s.employee.employeeId, { kind: "refused", messages: s.refusals.map((r) => `${r.message} ${r.fix}`) });
      } else if (s.hours) {
        engineBy.set(s.employee.employeeId, {
          kind: "computed",
          regularHundredthHours: s.hours.regularHundredthHours,
          overtimeHundredthHours: s.hours.overtimeHundredthHours,
          grossCents: s.hours.grossCents,
        });
      }
    }
  }

  const cards = sortCards(
    people.map((p) =>
      buildTimeCard({
        employeeId: p.id,
        fullName: p.full_name,
        startDate: period.start_date,
        endDate: period.end_date,
        workweekStartsOn,
        punches,
        breakFlags: flagsByEmp.get(p.id) ?? [],
        sickByDay: sickBy.get(p.id) ?? {},
        engine: engineBy.get(p.id) ?? { kind: "not_run" },
        hasHourlyRate: rateBy.get(p.id) ?? false,
      }),
    ),
  );

  return {
    period,
    workweekStartsOn,
    cards,
    rollup: rollUp(cards),
    engineProblem,
    engineGrossCents,
    employees: people.map((p) => ({ id: p.id, name: p.full_name })),
  };
}

/** Periods to pick from: everything on the calendar around today, newest first. */
export async function loadPeriodChoices(admin: Admin = createSupabaseAdminClient()): Promise<PayPeriodRow[]> {
  const { data, error } = await admin
    .from("pay_periods")
    .select("id, label, start_date, end_date, pay_date, pay_frequency, quarter, tax_year, status, approved_by, approved_at, locked_at, notes")
    .order("start_date", { ascending: false })
    .limit(80);
  if (error) throw new Error(`The pay calendar could not be read: ${short(error)}`);
  return (data ?? []) as unknown as PayPeriodRow[];
}

/** The period containing a Pacific day, else the latest one that started before it. */
export function pickDefaultPeriod(periods: readonly PayPeriodRow[], today: string): PayPeriodRow | null {
  const containing = periods.find((p) => p.start_date <= today && today <= p.end_date);
  if (containing) return containing;
  const past = periods.filter((p) => p.start_date <= today).sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  return past[0] ?? periods[periods.length - 1] ?? null;
}
