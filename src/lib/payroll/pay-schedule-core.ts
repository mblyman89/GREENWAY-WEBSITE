/**
 * src/lib/payroll/pay-schedule-core.ts   (D248 slice 1)
 *
 * THE PAY SCHEDULE: "which Friday is payday, and which days does it pay for".
 *
 * Owner (D248, verbatim): "I need a way to set the pay Friday and pay period."
 *
 * Before this file the whole payroll engine was waiting on two facts nobody
 * could enter from a screen: the workweek anchor (company_profile.
 * workweek_starts_on, deliberately NO default) and the pay calendar
 * (public.pay_periods, empty). The timesheet engine and the pay-run join both
 * refuse without them - correctly - so nothing downstream could be tried.
 *
 * The owner states the schedule ONCE:
 *   - one real payday (the anchor pay Friday),
 *   - how often (weekly or every two weeks),
 *   - how many days after the period ends that payday falls (the "lag").
 * Everything else is DERIVED, never typed: the period end is payday minus the
 * lag, the start is the end minus (length - 1), the tax year and quarter come
 * from the PAY date (IRS: wages are taxed in the year they are paid, so a
 * period worked in December and paid in January is next year's W-2).
 *
 * Nothing here guesses. No default anchor, no default lag, no default cadence.
 * A pay date that lands on a bank holiday is FLAGGED (and optionally moved to
 * the banking day before, which is what employers do and what Timberland's
 * Schedule D expects) - never silently moved.
 *
 * PURE. No I/O. Self-tests at the bottom (__runPayScheduleCoreTests), registered
 * in scripts/compliance/run-pure-selftests.ts.
 *
 * WHAT THIS FILE DOES NOT DO: book journals, file forms, move money. It plans
 * a calendar. The store (pay-schedule-store.ts) writes planned pay_periods rows
 * and nothing else.
 */

import { addCalendarDays, weekday, isFedAchBankingDay } from "@/lib/payments/ach-authorization-core";

/* ═════════════════════════════════════════════════════════════════════════ *
 * TYPES
 * ═════════════════════════════════════════════════════════════════════════ */

/** The cadences this planner builds. Both are in pay_periods' check list. */
export type ScheduleFrequency = "weekly" | "biweekly";

export const SCHEDULE_FREQUENCIES: readonly ScheduleFrequency[] = ["weekly", "biweekly"];

/** What to do when payday lands on a day the banks are shut. */
export type HolidayRule = "pay_banking_day_before" | "keep_date_and_flag";

export type PaySchedule = {
  readonly v: 1;
  readonly frequency: ScheduleFrequency;
  /** One real payday, YYYY-MM-DD. Every other payday is this +/- whole periods. */
  readonly anchorPayDate: string;
  /** Days from the LAST day of the period to payday. 0 = paid on the last day. */
  readonly lagDays: number;
  readonly holidayRule: HolidayRule;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
};

export const PAY_SCHEDULE_KEY = "payroll_pay_schedule";
export const PAY_SCHEDULE_LABEL = "Payroll - pay schedule (pay Friday, period length, lag)";

export const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function periodLengthDays(f: ScheduleFrequency): number {
  return f === "weekly" ? 7 : 14;
}

export function periodsPerYear(f: ScheduleFrequency): number {
  return f === "weekly" ? 52 : 26;
}

/* ═════════════════════════════════════════════════════════════════════════ *
 * PARSING + VALIDATION
 * ═════════════════════════════════════════════════════════════════════════ */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Saved JSON -> schedule, or null when nothing (valid) is saved. Never defaults a field. */
export function parsePaySchedule(raw: unknown): PaySchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.frequency !== "weekly" && r.frequency !== "biweekly") return null;
  if (!isIsoDay(r.anchorPayDate)) return null;
  const lag = r.lagDays;
  if (typeof lag !== "number" || !Number.isInteger(lag) || lag < 0 || lag > 31) return null;
  const rule = r.holidayRule === "keep_date_and_flag" ? "keep_date_and_flag" : r.holidayRule === "pay_banking_day_before" ? "pay_banking_day_before" : null;
  if (!rule) return null;
  return {
    v: 1,
    frequency: r.frequency,
    anchorPayDate: r.anchorPayDate,
    lagDays: lag,
    holidayRule: rule,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
    updatedBy: typeof r.updatedBy === "string" ? r.updatedBy : null,
  };
}

export type ScheduleInput = {
  readonly frequency: string;
  readonly anchorPayDate: string;
  readonly lagDays: string | number;
  readonly holidayRule: string;
};

/** Form input -> schedule, or a plain-English list of what is wrong. */
export function validateScheduleInput(
  input: ScheduleInput,
): { ok: true; schedule: Omit<PaySchedule, "updatedAt" | "updatedBy"> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const freq = input.frequency === "weekly" || input.frequency === "biweekly" ? input.frequency : null;
  if (!freq) errors.push("Choose how often you pay: every week or every two weeks.");
  const anchor = String(input.anchorPayDate ?? "").trim();
  if (!isIsoDay(anchor)) errors.push("Enter one real payday (a date), for example the next Friday you pay.");
  const lagRaw = String(input.lagDays ?? "").trim();
  const lag = /^\d+$/.test(lagRaw) ? Number(lagRaw) : NaN;
  if (!Number.isInteger(lag) || lag < 0 || lag > 31) {
    errors.push("Enter how many days after the period ends payday falls (0 to 31). Example: period ends Saturday, paid the next Friday = 6.");
  }
  const rule =
    input.holidayRule === "pay_banking_day_before" || input.holidayRule === "keep_date_and_flag" ? input.holidayRule : null;
  if (!rule) errors.push("Choose what happens when payday is a bank holiday.");
  if (errors.length > 0 || !freq || !rule) return { ok: false, errors };
  return { ok: true, schedule: { v: 1, frequency: freq, anchorPayDate: anchor, lagDays: lag, holidayRule: rule } };
}

/* ═════════════════════════════════════════════════════════════════════════ *
 * DERIVATION
 * ═════════════════════════════════════════════════════════════════════════ */

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function quarterOf(iso: string): 1 | 2 | 3 | 4 {
  const m = Number(iso.slice(5, 7));
  return (Math.floor((m - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

export function shortDay(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

export function weekdayName(iso: string): string {
  return WEEKDAY_LONG[weekday(iso)];
}

/**
 * Bank-holiday status of a day. The FRB calendar is mirrored for 2026-2030 only
 * and throws outside it; that becomes "unknown", never "open".
 */
export function bankStatus(iso: string): "open" | "closed" | "unknown" {
  try {
    return isFedAchBankingDay(iso) ? "open" : "closed";
  } catch {
    return "unknown";
  }
}

/** The banking day on or before `iso` (null when the calendar is not mirrored). */
export function bankingDayOnOrBefore(iso: string): string | null {
  let d = iso;
  for (let i = 0; i < 10; i += 1) {
    const s = bankStatus(d);
    if (s === "unknown") return null;
    if (s === "open") return d;
    d = addCalendarDays(d, -1);
  }
  return null;
}

export type PlannedPeriod = {
  /** Payday as scheduled (anchor + k periods), before any holiday move. */
  readonly scheduledPayDate: string;
  /** The date actually used as pay_date (decides tax year and quarter). */
  readonly payDate: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly frequency: ScheduleFrequency;
  readonly taxYear: number;
  readonly quarter: 1 | 2 | 3 | 4;
  /** 1-based number of this payday inside its tax year. */
  readonly number: number;
  readonly label: string;
  /** Plain-English notes (holiday moves, unknown holiday calendar). */
  readonly flags: readonly string[];
};

/** The k-th scheduled payday from the anchor (k may be negative). */
export function scheduledPayDate(s: Pick<PaySchedule, "anchorPayDate" | "frequency">, k: number): string {
  return addCalendarDays(s.anchorPayDate, k * periodLengthDays(s.frequency));
}

/** Smallest k whose scheduled payday is on or after `iso`. */
export function firstIndexOnOrAfter(s: Pick<PaySchedule, "anchorPayDate" | "frequency">, iso: string): number {
  const len = periodLengthDays(s.frequency);
  return Math.ceil(daysBetween(s.anchorPayDate, iso) / len);
}

type ScheduleCore = Omit<PaySchedule, "updatedAt" | "updatedBy" | "v">;

/** The pay date actually used for index k (after the holiday rule), plus notes. */
export function payDateFor(s: ScheduleCore, k: number): { payDate: string; flags: string[] } {
  const scheduled = scheduledPayDate(s, k);
  const endDate = addCalendarDays(scheduled, -s.lagDays);
  const flags: string[] = [];
  let payDate = scheduled;
  const status = bankStatus(scheduled);
  if (status === "unknown") {
    flags.push(`No bank-holiday calendar is on file for ${scheduled.slice(0, 4)}, so this payday was not checked for a holiday.`);
  } else if (status === "closed") {
    const before = bankingDayOnOrBefore(scheduled);
    if (s.holidayRule === "pay_banking_day_before" && before && daysBetween(endDate, before) >= 0) {
      payDate = before;
      flags.push(`${weekdayName(scheduled)} ${shortDay(scheduled)} is a bank holiday, so payday moves to ${weekdayName(before)} ${shortDay(before)}.`);
      if (before.slice(0, 4) !== scheduled.slice(0, 4)) {
        flags.push(
          `Moving it crosses the year end: wages are taxed in the year they are PAID, so this check is ${before.slice(0, 4)} wages (W-2, wage bases, quarter) and ${before.slice(0, 4)} gets an extra payday.`,
        );
      }
    } else if (s.holidayRule === "pay_banking_day_before") {
      flags.push(
        `${weekdayName(scheduled)} ${shortDay(scheduled)} is a bank holiday, and the banking day before falls inside the period, so the date was kept. Pay it the next banking day or pay early by hand.`,
      );
    } else {
      flags.push(`${weekdayName(scheduled)} ${shortDay(scheduled)} is a bank holiday (kept as scheduled because of your setting).`);
    }
  }
  return { payDate, flags };
}

/** 1-based count of paydays in `taxYear` up to and including index k (by ACTUAL pay date). */
function numberInYear(s: ScheduleCore, k: number, taxYear: number): number {
  const kStart = firstIndexOnOrAfter(s, addCalendarDays(`${taxYear}-01-01`, -10));
  let n = 0;
  for (let j = kStart; j <= k; j += 1) {
    if (Number(payDateFor(s, j).payDate.slice(0, 4)) === taxYear) n += 1;
  }
  return Math.max(1, n);
}

/** Build the period for scheduled payday index k. */
export function periodAt(s: ScheduleCore, k: number): PlannedPeriod {
  const len = periodLengthDays(s.frequency);
  const scheduled = scheduledPayDate(s, k);
  const endDate = addCalendarDays(scheduled, -s.lagDays);
  const startDate = addCalendarDays(endDate, -(len - 1));
  const { payDate, flags } = payDateFor(s, k);
  const taxYear = Number(payDate.slice(0, 4));
  const number = numberInYear(s, k, taxYear);
  const label = `${taxYear}-${String(number).padStart(2, "0")} · ${shortDay(startDate)}–${shortDay(endDate)} · paid ${weekdayName(payDate).slice(0, 3)} ${shortDay(payDate)}`;
  return {
    scheduledPayDate: scheduled,
    payDate,
    startDate,
    endDate,
    frequency: s.frequency,
    taxYear,
    quarter: quarterOf(payDate),
    number,
    label,
    flags,
  };
}

/** Every period whose SCHEDULED payday falls in [fromIso, toIso] inclusive. */
export function planPeriods(
  s: Omit<PaySchedule, "updatedAt" | "updatedBy" | "v">,
  fromIso: string,
  toIso: string,
): PlannedPeriod[] {
  const out: PlannedPeriod[] = [];
  let k = firstIndexOnOrAfter(s, fromIso);
  for (let guard = 0; guard < 120; guard += 1) {
    const sched = scheduledPayDate(s, k);
    if (daysBetween(sched, toIso) < 0) break;
    out.push(periodAt(s, k));
    k += 1;
  }
  return out;
}

/** Every period whose ACTUAL pay date falls in the calendar year (= that tax year's paydays). */
export function planYear(s: Omit<PaySchedule, "updatedAt" | "updatedBy" | "v">, year: number): PlannedPeriod[] {
  // Window widened by a few days and then filtered on the ACTUAL pay date, so a
  // Jan 1 payday moved back to Dec 31 lands in the year it is really paid.
  return planPeriods(s, addCalendarDays(`${year}-01-01`, -7), addCalendarDays(`${year}-12-31`, 7)).filter(
    (p) => p.taxYear === year,
  );
}

/** The period that contains the work day `iso`. */
export function periodContaining(s: Omit<PaySchedule, "updatedAt" | "updatedBy" | "v">, iso: string): PlannedPeriod {
  const len = periodLengthDays(s.frequency);
  // end(k) = anchor - lag + k*len ; we want start(k) <= iso <= end(k)
  const endAnchor = addCalendarDays(s.anchorPayDate, -s.lagDays);
  const k = Math.ceil(daysBetween(endAnchor, iso) / len);
  return periodAt(s, k);
}

/* ═════════════════════════════════════════════════════════════════════════ *
 * WORKWEEK AGREEMENT
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Overtime is owed per WORKWEEK (FLSA 29 CFR 778.104; RCW 49.46.130). A pay
 * period that starts mid-workweek splits a week across two paychecks, and the
 * timesheet engine then has to flag it. The clean set-up is: the period starts
 * on the workweek's first day.
 */
export function workweekAdvice(
  s: Omit<PaySchedule, "updatedAt" | "updatedBy" | "v">,
  workweekStartsOn: number | null,
): { readonly suggested: number; readonly agrees: boolean | null; readonly message: string } {
  const p = periodAt(s, 0);
  const suggested = weekday(p.startDate);
  if (workweekStartsOn === null) {
    return {
      suggested,
      agrees: null,
      message: `No workweek is set yet. Your periods start on ${WEEKDAY_LONG[suggested]}, so a ${WEEKDAY_LONG[suggested]} workweek keeps every overtime week inside one paycheck.`,
    };
  }
  const agrees = workweekStartsOn === suggested;
  return {
    suggested,
    agrees,
    message: agrees
      ? `Your workweek starts ${WEEKDAY_LONG[workweekStartsOn]} and so do your pay periods, so every workweek sits wholly inside one paycheck.`
      : `Your workweek starts ${WEEKDAY_LONG[workweekStartsOn]} but your pay periods start ${WEEKDAY_LONG[suggested]}. A workweek will straddle two paychecks; overtime is still owed per workweek, so change one or the other.`,
  };
}

/* ═════════════════════════════════════════════════════════════════════════ *
 * PLAN vs CALENDAR ON FILE
 * ═════════════════════════════════════════════════════════════════════════ */

export type ExistingPeriod = {
  readonly id: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly pay_date: string;
  readonly pay_frequency: string;
  readonly status: string;
  readonly label: string;
};

export type PlanRowVerdict =
  | { readonly kind: "new"; readonly planned: PlannedPeriod }
  | { readonly kind: "on_file"; readonly planned: PlannedPeriod; readonly existing: ExistingPeriod }
  | { readonly kind: "conflict"; readonly planned: PlannedPeriod; readonly existing: ExistingPeriod; readonly why: string };

function overlaps(a1: string, a2: string, b1: string, b2: string): boolean {
  return daysBetween(a1, b2) >= 0 && daysBetween(b1, a2) >= 0;
}

/** Compare a plan with the calendar on file (same cadence only - other cadences may overlap). */
export function diffPlan(planned: readonly PlannedPeriod[], existing: readonly ExistingPeriod[]): PlanRowVerdict[] {
  return planned.map((p) => {
    const same = existing.filter((e) => e.pay_frequency === p.frequency);
    const exact = same.find((e) => e.start_date === p.startDate && e.end_date === p.endDate);
    if (exact) {
      if (exact.pay_date === p.payDate) return { kind: "on_file", planned: p, existing: exact };
      return {
        kind: "conflict",
        planned: p,
        existing: exact,
        why: `Already on file with payday ${exact.pay_date}; the schedule says ${p.payDate}.`,
      };
    }
    const clash = same.find((e) => overlaps(p.startDate, p.endDate, e.start_date, e.end_date));
    if (clash) {
      return {
        kind: "conflict",
        planned: p,
        existing: clash,
        why: `Overlaps "${clash.label}" (${clash.start_date} to ${clash.end_date}), which is ${clash.status}.`,
      };
    }
    return { kind: "new", planned: p };
  });
}

/** pay_periods insert rows for the NEW verdicts only. */
export function insertRowsFor(verdicts: readonly PlanRowVerdict[]): Array<{
  label: string;
  start_date: string;
  end_date: string;
  pay_date: string;
  pay_frequency: ScheduleFrequency;
  quarter: number;
  tax_year: number;
  status: "planned";
  notes: string | null;
}> {
  return verdicts
    .filter((v): v is Extract<PlanRowVerdict, { kind: "new" }> => v.kind === "new")
    .map(({ planned: p }) => ({
      label: p.label,
      start_date: p.startDate,
      end_date: p.endDate,
      pay_date: p.payDate,
      pay_frequency: p.frequency,
      quarter: p.quarter,
      tax_year: p.taxYear,
      status: "planned" as const,
      notes: p.flags.length ? `Payroll command center (D248): ${p.flags.join(" ")}` : "Payroll command center (D248)",
    }));
}

/* ═════════════════════════════════════════════════════════════════════════ *
 * TODAY
 * ═════════════════════════════════════════════════════════════════════════ */

export type ScheduleNow = {
  readonly current: PlannedPeriod;
  readonly previous: PlannedPeriod;
  readonly next: PlannedPeriod;
  /** The next payday on or after today (it may pay the PREVIOUS period). */
  readonly nextPayday: PlannedPeriod;
  readonly daysToPayday: number;
  /** Day n of the current period (1-based) and its length. */
  readonly dayOfPeriod: number;
  readonly periodLength: number;
};

export function scheduleNow(s: Omit<PaySchedule, "updatedAt" | "updatedBy" | "v">, todayIso: string): ScheduleNow {
  const current = periodContaining(s, todayIso);
  const len = periodLengthDays(s.frequency);
  const prev = periodContaining(s, addCalendarDays(current.startDate, -1));
  const next = periodContaining(s, addCalendarDays(current.endDate, 1));
  // Next payday on/after today: previous period's payday if not yet passed, else current's...
  const candidates = [prev, current, next].filter((p) => daysBetween(todayIso, p.payDate) >= 0);
  const nextPayday = candidates.sort((a, b) => daysBetween(b.payDate, a.payDate))[0] ?? next;
  return {
    current,
    previous: prev,
    next,
    nextPayday,
    daysToPayday: daysBetween(todayIso, nextPayday.payDate),
    dayOfPeriod: daysBetween(current.startDate, todayIso) + 1,
    periodLength: len,
  };
}

/* ═════════════════════════════════════════════════════════════════════════ *
 * SELF-TESTS
 * ═════════════════════════════════════════════════════════════════════════ */

export function __runPayScheduleCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("pay-schedule-core FAIL:", m);
    }
  };

  // Biweekly, Sun-Sat periods, paid the Friday after (lag 6). Anchor: Fri 2026-11-20.
  const s = { frequency: "biweekly" as const, anchorPayDate: "2026-11-20", lagDays: 6, holidayRule: "pay_banking_day_before" as const };
  const p0 = periodAt(s, 0);
  ok(p0.endDate === "2026-11-14", "end = payday - lag");
  ok(p0.startDate === "2026-11-01", "start = end - 13");
  ok(weekday(p0.startDate) === 0, "starts Sunday");
  ok(p0.payDate === "2026-11-20" && p0.taxYear === 2026 && p0.quarter === 4, "pay date/tax year/quarter");
  ok(p0.flags.length === 0, "no flags on a normal Friday");
  const p1 = periodAt(s, 1);
  ok(p1.startDate === "2026-11-15" && p1.endDate === "2026-11-28" && p1.payDate === "2026-12-04", "next period contiguous");
  const pm1 = periodAt(s, -1);
  ok(pm1.endDate === "2026-10-31" && pm1.payDate === "2026-11-06", "previous period");
  ok(daysBetween(pm1.endDate, p0.startDate) === 1, "no gap between periods");

  // Year plans: 26 or 27 paydays; 2027 plan numbers 1..n, all pay in 2027.
  const y27 = planYear(s, 2027);
  ok(y27.length === 26 || y27.length === 27, `2027 has 26/27 paydays (${y27.length})`);
  ok(y27.every((p) => p.taxYear === 2027), "all 2027 paydays are 2027 wages");
  ok(y27[0].number === 1 && y27[y27.length - 1].number === y27.length, "numbered 1..n");
  ok(y27.every((p, i) => i === 0 || daysBetween(y27[i - 1].endDate, p.startDate) === 1), "2027 plan contiguous");
  // The first 2027 payday pays work done in Dec 2026 - wages of 2027 anyway.
  ok(y27[0].startDate.startsWith("2026-12"), "Jan payday pays December work, taxed in 2027");
  // Fri 2027-01-01 is a bank holiday: that payday moves to Thu 2026-12-31 = 2026 wages.
  const y26 = planYear(s, 2026);
  const last26 = y26[y26.length - 1];
  ok(last26.payDate === "2026-12-31" && last26.scheduledPayDate === "2027-01-01", "Jan 1 payday moves to Dec 31");
  ok(last26.taxYear === 2026 && last26.flags.some((f) => f.includes("year end")), "year-end move flagged, taxed when paid");
  ok(y27[0].payDate === "2027-01-15" && y27[0].number === 1, "2027 #1 is Jan 15 after the move");
  ok(y26.length === 27, `2026 has 27 paydays on this schedule (${y26.length})`);

  // Holiday: Christmas 2026 is Friday 2026-12-25 (FRB closed). Anchor that lands on it.
  const xmas = { frequency: "biweekly" as const, anchorPayDate: "2026-12-25", lagDays: 6, holidayRule: "pay_banking_day_before" as const };
  const px = periodAt(xmas, 0);
  ok(px.scheduledPayDate === "2026-12-25" && px.payDate === "2026-12-24", "Christmas payday moves to Thu 12-24");
  ok(px.flags.length === 1 && px.flags[0].includes("bank holiday"), "holiday move is flagged");
  const keep = periodAt({ ...xmas, holidayRule: "keep_date_and_flag" }, 0);
  ok(keep.payDate === "2026-12-25" && keep.flags.length === 1, "keep rule keeps the date but flags");
  // Lag 0 + holiday: moving earlier would precede the period end -> kept + flagged.
  const lag0 = periodAt({ ...xmas, lagDays: 0 }, 0);
  ok(lag0.payDate === "2026-12-25" && lag0.flags[0].includes("inside the period"), "never pays before the period ends");
  // Unknown calendar year.
  const far = periodAt({ ...s, anchorPayDate: "2035-01-05" }, 0);
  ok(far.flags.some((f) => f.includes("No bank-holiday calendar")), "unknown holiday calendar flagged, not assumed open");
  ok(bankStatus("2026-12-25") === "closed" && bankStatus("2026-12-24") === "open" && bankStatus("2040-01-02") === "unknown", "bankStatus");

  // Weekly.
  const w = { frequency: "weekly" as const, anchorPayDate: "2026-11-20", lagDays: 6, holidayRule: "keep_date_and_flag" as const };
  const w0 = periodAt(w, 0);
  ok(w0.startDate === "2026-11-08" && w0.endDate === "2026-11-14", "weekly period 7 days");
  ok(planYear(w, 2027).length >= 52, "weekly year has 52+");

  // periodContaining.
  ok(periodContaining(s, "2026-11-01").startDate === "2026-11-01", "contains first day");
  ok(periodContaining(s, "2026-11-14").startDate === "2026-11-01", "contains last day");
  ok(periodContaining(s, "2026-11-15").startDate === "2026-11-15", "next day = next period");
  ok(periodContaining(s, "2026-10-31").endDate === "2026-10-31", "day before = previous period");

  // scheduleNow on Tue 2026-11-17: current = Nov 15-28; next payday = Fri Nov 20 (pays Nov 1-14).
  const now = scheduleNow(s, "2026-11-17");
  ok(now.current.startDate === "2026-11-15", "current period");
  ok(now.nextPayday.payDate === "2026-11-20" && now.nextPayday.startDate === "2026-11-01", "next payday pays the previous period");
  ok(now.daysToPayday === 3 && now.dayOfPeriod === 3 && now.periodLength === 14, "countdown + day of period");
  const onPayday = scheduleNow(s, "2026-11-20");
  ok(onPayday.daysToPayday === 0, "payday is day 0");

  // Workweek advice.
  ok(workweekAdvice(s, null).suggested === 0 && workweekAdvice(s, null).agrees === null, "suggest Sunday, unset");
  ok(workweekAdvice(s, 0).agrees === true, "agrees");
  ok(workweekAdvice(s, 1).agrees === false && workweekAdvice(s, 1).message.includes("straddle"), "disagree warns");

  // Validation never defaults.
  ok(!validateScheduleInput({ frequency: "", anchorPayDate: "", lagDays: "", holidayRule: "" }).ok, "empty refused");
  const vbad = validateScheduleInput({ frequency: "biweekly", anchorPayDate: "2026-02-30", lagDays: "6", holidayRule: "keep_date_and_flag" });
  ok(!vbad.ok && vbad.errors.length === 1, "impossible date refused");
  ok(!validateScheduleInput({ frequency: "biweekly", anchorPayDate: "2026-11-20", lagDays: "-1", holidayRule: "keep_date_and_flag" }).ok, "negative lag refused");
  ok(!validateScheduleInput({ frequency: "monthly", anchorPayDate: "2026-11-20", lagDays: "6", holidayRule: "keep_date_and_flag" }).ok, "monthly not offered");
  const vgood = validateScheduleInput({ frequency: "biweekly", anchorPayDate: "2026-11-20", lagDays: "6", holidayRule: "pay_banking_day_before" });
  ok(vgood.ok && vgood.schedule.lagDays === 6, "valid accepted");

  // Parse round trip; garbage -> null.
  ok(parsePaySchedule({ ...s, v: 1 })?.anchorPayDate === "2026-11-20", "parse");
  ok(parsePaySchedule({ frequency: "biweekly", anchorPayDate: "2026-11-20" }) === null, "missing lag -> null, not default");
  ok(parsePaySchedule(null) === null && parsePaySchedule("x") === null, "garbage -> null");

  // diffPlan.
  const plan = planPeriods(s, "2026-11-15", "2026-12-31");
  const existing: ExistingPeriod[] = [
    { id: "a", start_date: "2026-11-01", end_date: "2026-11-14", pay_date: "2026-11-20", pay_frequency: "biweekly", status: "planned", label: "x" },
    { id: "b", start_date: "2026-11-20", end_date: "2026-12-03", pay_date: "2026-12-09", pay_frequency: "biweekly", status: "approved", label: "odd" },
    { id: "c", start_date: "2026-01-01", end_date: "2026-12-31", pay_date: "2026-12-31", pay_frequency: "annually", status: "planned", label: "owner" },
  ];
  const d = diffPlan(plan, existing);
  ok(d[0].kind === "on_file", "exact match on file");
  ok(d[1].kind === "conflict", "overlap conflict");
  ok(d.every((v) => v.kind !== "conflict" || v.existing.pay_frequency === "biweekly"), "other cadences ignored");
  const rows = insertRowsFor(d);
  ok(rows.every((r) => r.status === "planned" && r.pay_date >= r.end_date), "inserts planned, pay after end");
  ok(rows.length === d.filter((v) => v.kind === "new").length, "inserts only new");
  ok(insertRowsFor(diffPlan(plan, [])).length === plan.length, "empty calendar -> insert all");

  // Label shape.
  ok(/^2026-\d{2} · Nov 1–Nov 14 · paid Fri Nov 20$/.test(p0.label), `label ${p0.label}`);

  return { passed, failed };
}
