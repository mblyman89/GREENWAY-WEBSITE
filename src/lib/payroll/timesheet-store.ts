/**
 * src/lib/payroll/timesheet-store.ts   (books-32)
 *
 * Server-side persistence for the timesheet screen: the workweek anchor, the
 * pay-period calendar, and the punches that feed the overtime engine.
 *
 * THE DIVISION OF LABOUR, AND WHY IT IS STRICT
 *
 * `timesheet-core.ts` decides what the hours are. This file decides nothing. It
 * reads rows, maps them into the engine's input types, hands them over, and
 * writes back only what a human has approved. Every judgement about overtime
 * lives in the core, and a second copy of that judgement here would eventually
 * disagree with the first - silently, on a paycheck.
 *
 * THE MAPPING IS THE DANGEROUS PART (standing rule 63d)
 *
 * The handoff is where the defect lives. A database row and an engine input
 * look similar enough that a wrong column name, a null read as a zero, or a
 * timestamp that lost its timezone all produce a plausible number rather than
 * an error. So `toRawPunch` and `toEmployeePayFacts` below are deliberately
 * explicit, they refuse rather than defaulting, and the variance between the
 * stored `minutes` column and the minutes implied by the timestamps is carried
 * all the way to the screen instead of being reconciled quietly.
 *
 * THE SERVICE ROLE BYPASSES EVERY DATABASE GATE
 *
 * These functions use createSupabaseAdminClient(), which runs as the service
 * role and ignores the owner-only RLS policies migration 0197 puts on
 * `pay_periods`. So the SQL gate does NOT protect anything reached through this
 * file. Every caller must pass through `requireBooksAccess()` first, which is
 * `is_owner()` in application form. That is stated here rather than assumed,
 * because the migration's RLS is genuinely inert on this path.
 *
 * WHAT THE NEXT SLICES DO WITH THIS (standing rule 62e)
 *
 *   - The pay-run builder will read `computeTimesheetForPeriod` and use the
 *     regular/overtime split to produce gross pay, instead of asking Michael to
 *     type a number as it does today.
 *   - The Form 941 builder reads pay_periods.quarter and tax_year, which is why
 *     they are stored on the row rather than derived at read time.
 *   - The Washington quarterly reports read the HOURS, not the money, because
 *     RCW 50.12.070 asks for hours worked per employee and L&I charges premium
 *     per hour. That is why hours survive this layer as integers.
 */
import "server-only";

import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import {
  computePeriodHours,
  type EmployeePayFacts,
  type EmployeePeriodHours,
  type PayPeriodDates,
  type RawPunch,
  type TimesheetRefusal,
  type TimesheetSettings,
  type WeekdayIndex,
  WA_OVERTIME_MULTIPLIER_BASIS_POINTS,
  WA_OVERTIME_THRESHOLD_HUNDREDTH_HOURS,
} from "./timesheet-core";
import {
  evaluateTimesheetSetup,
  type TimesheetProgress,
  type TimesheetSetupFacts,
} from "./timesheet-mentor";

/** The singleton company_profile primary key. There is one company. */
const SINGLETON_ID = true;

const NOT_CONFIGURED =
  "Supabase is not configured in this environment, so nothing could be read. This is a deployment " +
  "problem, not a data problem - no payroll data has been lost.";

/* ═══════════════════════════════════════════════════════════════════════════ *
 * TYPES
 * ═══════════════════════════════════════════════════════════════════════════ */

export type PayPeriodRow = {
  readonly id: string;
  readonly label: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly pay_date: string;
  readonly pay_frequency: string;
  readonly quarter: number;
  readonly tax_year: number;
  readonly status: "planned" | "approved" | "locked";
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly locked_at: string | null;
  readonly notes: string | null;
};

export type WorkweekSettingsRow = {
  /** null when nobody has chosen. NEVER defaulted (standing rule 62d). */
  readonly workweekStartsOn: WeekdayIndex | null;
  readonly workweekStartsAtHour: number;
  readonly workweekEffectiveDate: string | null;
};

export type StoreFailure = {
  readonly ok: false;
  readonly code:
    | "NOT_CONFIGURED"
    | "READ_FAILED"
    | "WRITE_FAILED"
    | "NOT_FOUND"
    | "PERIOD_LOCKED"
    | "BAD_INPUT";
  readonly message: string;
};

/* ═══════════════════════════════════════════════════════════════════════════ *
 * READS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Read the workweek anchor.
 *
 * `workweek_starts_on` has NO database default, so a null here genuinely means
 * "nobody has chosen" rather than "somebody chose Sunday". This function
 * preserves that distinction all the way to the screen, because collapsing it
 * into a default is the single change that would make the overtime engine
 * confidently wrong.
 */
export async function loadWorkweekSettings(): Promise<
  ({ ok: true } & WorkweekSettingsRow) | StoreFailure
> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("company_profile")
    .select("workweek_starts_on, workweek_starts_at_hour, workweek_effective_date")
    .eq("id", SINGLETON_ID)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the workweek settings: ${error.message}`,
    };
  }

  const row = data as
    | {
        workweek_starts_on: number | null;
        workweek_starts_at_hour: number | null;
        workweek_effective_date: string | null;
      }
    | null;

  return {
    ok: true,
    workweekStartsOn:
      row?.workweek_starts_on === null || row?.workweek_starts_on === undefined
        ? null
        : (row.workweek_starts_on as WeekdayIndex),
    // The hour DOES have a database default of 0, so reading a missing row as
    // midnight matches what the database would have stored. The anchor day
    // above is the one where a default would be a lie.
    workweekStartsAtHour: row?.workweek_starts_at_hour ?? 0,
    workweekEffectiveDate: row?.workweek_effective_date ?? null,
  };
}

/** Every pay period for a tax year, in date order. */
export async function loadPayPeriods(
  taxYear: number,
): Promise<{ ok: true; periods: readonly PayPeriodRow[] } | StoreFailure> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pay_periods")
    .select(
      "id, label, start_date, end_date, pay_date, pay_frequency, quarter, tax_year, status, approved_by, approved_at, locked_at, notes",
    )
    .eq("tax_year", taxYear)
    .order("start_date", { ascending: true });

  if (error) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the pay period calendar: ${error.message}`,
    };
  }
  return { ok: true, periods: (data ?? []) as unknown as PayPeriodRow[] };
}

export async function loadPayPeriod(
  periodId: string,
): Promise<{ ok: true; period: PayPeriodRow } | StoreFailure> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pay_periods")
    .select(
      "id, label, start_date, end_date, pay_date, pay_frequency, quarter, tax_year, status, approved_by, approved_at, locked_at, notes",
    )
    .eq("id", periodId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read that pay period: ${error.message}`,
    };
  }
  if (!data) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message:
        "That pay period does not exist. It may have been removed, or the link may be stale - go back " +
        "to the pay calendar and pick it again.",
    };
  }
  return { ok: true, period: data as unknown as PayPeriodRow };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * THE HANDOFF - database rows into engine inputs (standing rule 63d)
 * ═══════════════════════════════════════════════════════════════════════════ */

type PunchRow = {
  id: string;
  employee_id: string;
  punch_kind: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  minutes: number | null;
};

/**
 * Map a stored punch onto the engine's input type.
 *
 * REFUSES rather than defaulting. A punch with no clock-in time has no place in
 * a pay calculation, and inventing one - or silently skipping the row - is how
 * hours disappear without anybody being told. Returns a refusal the screen can
 * display beside the punch.
 *
 * Note what is NOT done here: the stored `minutes` column is carried across
 * untouched, never used as a fallback for a missing timestamp. The engine
 * computes from the timestamps and reports the disagreement. This layer must
 * not resolve that disagreement, because resolving it destroys the evidence
 * that anything ever differed.
 */
export function toRawPunch(
  row: PunchRow,
): { ok: true; punch: RawPunch } | { ok: false; refusal: TimesheetRefusal } {
  if (!row.clock_in_at) {
    return {
      ok: false,
      refusal: {
        code: "OPEN_PUNCH",
        message: `A punch (${row.id}) has no clock-in time at all, so it cannot be paid.`,
        fix:
          "Find this punch on the time-clock screen and either give it the correct start time or " +
          "delete it if it was created in error.",
        authorityIds: [],
        subjectId: row.id,
      },
    };
  }
  const kind = row.punch_kind === "break" ? "break" : "work";
  return {
    ok: true,
    punch: {
      id: row.id,
      employeeId: row.employee_id,
      punchKind: kind,
      clockInAt: row.clock_in_at,
      clockOutAt: row.clock_out_at,
      minutes: row.minutes,
    },
  };
}

type EmployeeRow = {
  id: string;
  full_name: string | null;
  flsa_status: string | null;
};

type PayRow = {
  employee_id: string;
  basis: string | null;
  hourly_rate_milli_cents: number | null;
};

/**
 * Map an employee plus their current pay record onto the engine's facts type.
 *
 * `flsa_status` has a database default of 'non_exempt', so a null here means
 * the row predates migration 0197 rather than that somebody chose. We read that
 * as non_exempt, which is BOTH the database default and the legally safe
 * answer - and the mentor's progress panel separately counts how many
 * employees still carry an unreviewed status, so "defaulted" never silently
 * becomes "confirmed".
 */
export function toEmployeePayFacts(
  employee: EmployeeRow,
  pay: PayRow | null,
): EmployeePayFacts {
  return {
    employeeId: employee.id,
    fullName: employee.full_name ?? "(no name on file)",
    flsaStatus: employee.flsa_status === "exempt" ? "exempt" : "non_exempt",
    basis: pay?.basis === "salary" ? "salary" : "hourly",
    hourlyRateMilliCents: pay?.hourly_rate_milli_cents ?? null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * THE COMPUTE - reads everything, proposes nothing to the database
 * ═══════════════════════════════════════════════════════════════════════════ */

export type EmployeeTimesheet = {
  readonly employee: EmployeePayFacts;
  readonly hours: EmployeePeriodHours | null;
  readonly refusals: readonly TimesheetRefusal[];
};

export type TimesheetComputation = {
  readonly ok: true;
  readonly period: PayPeriodRow;
  readonly settings: WorkweekSettingsRow;
  readonly sheets: readonly EmployeeTimesheet[];
  /** Totals across everybody who computed cleanly. */
  readonly totalRegularHundredthHours: number;
  readonly totalOvertimeHundredthHours: number;
  readonly totalGrossCents: number;
  /** How many employees could not be computed at all. */
  readonly refusedCount: number;
};

/**
 * Compute the hours for every active employee in a pay period.
 *
 * PROPOSES. WRITES NOTHING. Standing rule 63c: automatic, with approval gates.
 * This function is the "automatic" half - it does the arithmetic nobody should
 * be doing by hand - and `approvePayPeriod` is the gate. Michael sees the
 * numbers, the workweek breakdown behind them, and every refusal, and then he
 * decides.
 *
 * ONE EMPLOYEE'S PROBLEM DOES NOT HIDE ANOTHER'S NUMBERS. Each employee is
 * computed independently and a refusal is attached to that person, so a single
 * open punch does not blank the whole screen. That matters on a payday: the
 * useful response to one bad punch is to fix that punch, not to be told the
 * period is broken.
 */
export async function computeTimesheetForPeriod(
  periodId: string,
): Promise<TimesheetComputation | StoreFailure> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  const periodRes = await loadPayPeriod(periodId);
  if (!periodRes.ok) return periodRes;
  const period = periodRes.period;

  const settingsRes = await loadWorkweekSettings();
  if (!settingsRes.ok) return settingsRes;

  const admin = createSupabaseAdminClient();

  const { data: empData, error: empErr } = await admin
    .from("employees")
    .select("id, full_name, flsa_status")
    .eq("active", true)
    .order("full_name", { ascending: true });
  if (empErr) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the employee list: ${empErr.message}`,
    };
  }
  const employees = (empData ?? []) as unknown as EmployeeRow[];

  const { data: payData, error: payErr } = await admin
    .from("employee_pay")
    .select("employee_id, basis, hourly_rate_milli_cents")
    .eq("is_current", true);
  if (payErr) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the pay records: ${payErr.message}`,
    };
  }
  const payByEmployee = new Map<string, PayRow>();
  for (const p of (payData ?? []) as unknown as PayRow[]) {
    payByEmployee.set(p.employee_id, p);
  }

  // Punches are selected on the PACIFIC calendar days of the period, inclusive
  // at both ends. The end bound is exclusive-of-the-next-day rather than
  // `lte end_date`, because clock_in_at is a timestamp and `lte '2027-01-16'`
  // would silently exclude everything worked after midnight on the last day.
  //
  // WHY pacificWallTimeToUtcISO AND NOT A LITERAL "-08:00" (books-32 defect)
  //
  // An earlier draft of this file wrote the bounds as `${start}T00:00:00-08:00`.
  // -08:00 is Pacific STANDARD time. Washington observes daylight saving from
  // the second Sunday in March to the first Sunday in November, when the true
  // offset is -07:00. For any pay period in that stretch the whole window slid
  // one hour late, which was MEASURED, not assumed:
  //
  //   period 2027-06-05 .. 2027-06-18
  //     hardcoded lower bound 2027-06-05T08:00:00Z
  //     correct   lower bound 2027-06-05T07:00:00Z      variance +60 minutes
  //
  //   a punch clocking in 00:30 Pacific on 2027-06-05 (day ONE of the period,
  //   pacificDayKey 2027-06-05) was NOT selected  -> hours silently unpaid
  //   a punch clocking in 00:30 Pacific on 2027-06-19 (the NEXT period) WAS
  //   selected -> the engine then refuses it as PUNCH_OUTSIDE_PERIOD
  //
  // The control matters as much as the finding: the same comparison on a
  // JANUARY period gives a variance of 0. Michael's first payroll is
  // 2027-01-01, so this bug would have passed every cutover test he ran and
  // then started losing hours in March. The engine already assigns punches to
  // days with pacificDayKey (DST-aware); the query bound must agree with the
  // engine or the two disagree twice a year.
  const { data: punchData, error: punchErr } = await admin
    .from("time_punches")
    .select("id, employee_id, punch_kind, clock_in_at, clock_out_at, minutes")
    .gte("clock_in_at", pacificWallTimeToUtcISO(period.start_date, "start"))
    .lt("clock_in_at", pacificWallTimeToUtcISO(nextDay(period.end_date), "start"))
    .order("clock_in_at", { ascending: true });
  if (punchErr) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the time punches: ${punchErr.message}`,
    };
  }

  const punchesByEmployee = new Map<string, RawPunch[]>();
  const mappingRefusals = new Map<string, TimesheetRefusal[]>();
  for (const row of (punchData ?? []) as unknown as PunchRow[]) {
    const mapped = toRawPunch(row);
    if (!mapped.ok) {
      const list = mappingRefusals.get(row.employee_id) ?? [];
      list.push(mapped.refusal);
      mappingRefusals.set(row.employee_id, list);
      continue;
    }
    const list = punchesByEmployee.get(row.employee_id) ?? [];
    list.push(mapped.punch);
    punchesByEmployee.set(row.employee_id, list);
  }

  const engineSettings: TimesheetSettings = {
    workweekStartsOn: settingsRes.workweekStartsOn,
    overtimeThresholdHundredthHours: WA_OVERTIME_THRESHOLD_HUNDREDTH_HOURS,
    overtimeMultiplierBasisPoints: WA_OVERTIME_MULTIPLIER_BASIS_POINTS,
  };
  const dates: PayPeriodDates = {
    startDate: period.start_date,
    endDate: period.end_date,
  };

  const sheets: EmployeeTimesheet[] = [];
  let totalRegular = 0;
  let totalOvertime = 0;
  let totalGross = 0;
  let refusedCount = 0;

  for (const emp of employees) {
    const facts = toEmployeePayFacts(emp, payByEmployee.get(emp.id) ?? null);
    const mapFails = mappingRefusals.get(emp.id) ?? [];
    const result = computePeriodHours({
      employee: facts,
      period: dates,
      punches: punchesByEmployee.get(emp.id) ?? [],
      settings: engineSettings,
    });

    if (!result.ok || mapFails.length > 0) {
      refusedCount += 1;
      sheets.push({
        employee: facts,
        hours: result.ok ? result.value : null,
        refusals: [...mapFails, ...(result.ok ? [] : result.refusals)],
      });
      continue;
    }

    totalRegular += result.value.regularHundredthHours;
    totalOvertime += result.value.overtimeHundredthHours;
    totalGross += result.value.grossCents;
    sheets.push({ employee: facts, hours: result.value, refusals: [] });
  }

  return {
    ok: true,
    period,
    settings: settingsRes,
    sheets,
    totalRegularHundredthHours: totalRegular,
    totalOvertimeHundredthHours: totalOvertime,
    totalGrossCents: totalGross,
    refusedCount,
  };
}

/** Next Pacific calendar day, as YYYY-MM-DD. Pure string arithmetic on the date label. */
function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
    t.getUTCDate(),
  ).padStart(2, "0")}`;
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * PROGRESS - the facts the mentor's tracker needs
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Gather the observable facts and hand them to the mentor.
 *
 * The counting happens here because it needs the database; the JUDGEMENT about
 * what those counts mean happens in `evaluateTimesheetSetup`, which is pure and
 * therefore testable against states that would be tedious to build in SQL.
 *
 * Standing rule 62d shows up twice below: `punchProblemCount` stays null when
 * nothing has been checked, and `selectedPeriodApproved` stays null when no
 * period is selected. Neither is reported as a zero or a false, because "not
 * checked" and "clean" must never look the same on a payroll screen.
 */
export async function loadTimesheetProgress(
  taxYear: number,
  selectedPeriodId: string | null,
): Promise<{ ok: true; progress: TimesheetProgress; facts: TimesheetSetupFacts } | StoreFailure> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  const settings = await loadWorkweekSettings();
  if (!settings.ok) return settings;

  const admin = createSupabaseAdminClient();

  const { data: empData, error: empErr } = await admin
    .from("employees")
    .select("id, flsa_status, flsa_exempt_reason")
    .eq("active", true);
  if (empErr) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the employee list: ${empErr.message}`,
    };
  }
  const emps = (empData ?? []) as unknown as {
    id: string;
    flsa_status: string | null;
    flsa_exempt_reason: string | null;
  }[];

  const periodsRes = await loadPayPeriods(taxYear);
  if (!periodsRes.ok) return periodsRes;

  let selectedApproved: boolean | null = null;
  let punchProblems: number | null = null;
  if (selectedPeriodId) {
    const sel = periodsRes.periods.find((p) => p.id === selectedPeriodId);
    if (sel) {
      selectedApproved = sel.status === "approved" || sel.status === "locked";
      const computed = await computeTimesheetForPeriod(selectedPeriodId);
      if (computed.ok) {
        punchProblems = computed.sheets.reduce((s, x) => s + x.refusals.length, 0);
      }
    }
  }

  const expected = expectedPeriodCount(periodsRes.periods);

  const facts: TimesheetSetupFacts = {
    workweekStartsOn: settings.workweekStartsOn,
    activeEmployeeCount: emps.length,
    // A null flsa_status means the row predates the migration and nobody has
    // reviewed it. The database default makes the ARITHMETIC safe; this count
    // is what stops "defaulted" from quietly becoming "confirmed".
    unclassifiedEmployeeCount: emps.filter((e) => e.flsa_status === null).length,
    exemptWithoutReasonCount: emps.filter(
      (e) =>
        e.flsa_status === "exempt" &&
        (e.flsa_exempt_reason === null || e.flsa_exempt_reason.trim().length < 10),
    ).length,
    payPeriodCount: periodsRes.periods.length,
    expectedPayPeriodCount: expected,
    selectedPeriodApproved: selectedApproved,
    punchProblemCount: punchProblems,
  };

  return { ok: true, progress: evaluateTimesheetSetup(facts), facts };
}

/**
 * How many periods a year should have, from the cadence actually on the
 * calendar.
 *
 * Returns null when the calendar is empty or mixes cadences, because in those
 * cases there is no single right answer and inventing one would produce a
 * confident complaint about a calendar that is fine. Standing rule 62d again:
 * unknown is reported as unknown.
 */
export function expectedPeriodCount(
  periods: readonly { pay_frequency: string }[],
): number | null {
  if (periods.length === 0) return null;
  const cadences = new Set(periods.map((p) => p.pay_frequency));
  if (cadences.size !== 1) return null;
  const only = [...cadences][0];
  switch (only) {
    case "weekly":
      return 52;
    case "biweekly":
      return 26;
    case "semimonthly":
      return 24;
    case "monthly":
      return 12;
    case "quarterly":
      return 4;
    case "semiannually":
      return 2;
    case "annually":
      return 1;
    default:
      // 'daily' has no fixed count, and an unknown cadence is not something to
      // guess at.
      return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * THE APPROVAL GATE (standing rule 63c)
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Approve a pay period.
 *
 * WHO and WHEN are both recorded, because an approval with no name on it is not
 * an approval. A locked period is refused: once a Form 941 has been filed
 * against a quarter, the periods inside it are evidence, and evidence that can
 * be re-approved is not evidence.
 */
export async function approvePayPeriod(
  periodId: string,
  approvedByStaffId: string,
): Promise<{ ok: true; period: PayPeriodRow } | StoreFailure> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }
  if (!approvedByStaffId) {
    return {
      ok: false,
      code: "BAD_INPUT",
      message:
        "An approval needs a person attached to it. Nothing was changed. This is a wiring problem " +
        "rather than something you did wrong.",
    };
  }

  const current = await loadPayPeriod(periodId);
  if (!current.ok) return current;

  if (current.period.status === "locked") {
    return {
      ok: false,
      code: "PERIOD_LOCKED",
      message:
        `The pay period "${current.period.label}" is locked, so it cannot be approved again. A period ` +
        "is locked once payroll has been run and filed against it, and the lock is what keeps the " +
        "filed return and the underlying records in agreement. Nothing was changed.",
    };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pay_periods")
    .update({
      status: "approved",
      approved_by: approvedByStaffId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", periodId)
    // Belt and braces: the status check above is a friendly message, and this
    // is the condition that actually prevents the write. A check-then-write
    // with nothing in between is a race, and the race here would silently
    // re-approve a filed quarter.
    .neq("status", "locked")
    .select(
      "id, label, start_date, end_date, pay_date, pay_frequency, quarter, tax_year, status, approved_by, approved_at, locked_at, notes",
    )
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      code: "WRITE_FAILED",
      message: `The approval was not saved: ${error.message}`,
    };
  }
  if (!data) {
    return {
      ok: false,
      code: "PERIOD_LOCKED",
      message:
        "The pay period was locked between reading it and approving it, so nothing was changed.",
    };
  }
  return { ok: true, period: data as unknown as PayPeriodRow };
}
