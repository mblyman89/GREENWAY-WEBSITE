/**
 * TIMESHEET CORE — clock punches into payable hours, split by WORKWEEK.
 *
 * books-32. This is the engine that stands between the time clock and the
 * paycheck. Everything downstream — gross pay, withholding, the 941, the W-2,
 * the L&I hours report — is computed from the numbers this file produces. If
 * this file is wrong, all of them are wrong in the same direction, silently,
 * every period.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ONE MISTAKE THIS FILE EXISTS TO MAKE IMPOSSIBLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Greenway pays biweekly. A biweekly period is fourteen days, which is TWO
 * WORKWEEKS. Overtime is owed PER WORKWEEK:
 *
 *     "The Act takes a single workweek as its standard and does not permit
 *      averaging of hours over 2 or more weeks. Thus, if an employee works 30
 *      hours one week and 50 hours the next, he must receive overtime
 *      compensation for the overtime hours worked beyond the applicable
 *      maximum in the second week, even though the average number of hours
 *      worked in the 2 weeks is 40."
 *                                                        — 29 CFR §778.104
 *
 * Forty-five hours then thirty-five hours is eighty hours. An engine that sums
 * the period and asks "is 80 more than 80?" pays no overtime and is wrong by
 * five hours of premium. The gross looks plausible. The withholding is
 * arithmetically consistent with the gross. Nothing anywhere goes red.
 *
 * So this engine NEVER computes overtime on a period total. It buckets by
 * workweek first, always, even when the period happens to be one week long.
 * `computePeriodHours` has no code path that can total a period and threshold
 * it — the only threshold comparison in this file lives inside the per-week
 * loop.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DESIGN RULES THIS FILE FOLLOWS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * INTEGER EVERYTHING. Hours are integer HUNDREDTHS of an hour, matching the
 * `lniHundredthHours` convention the withholding engine already uses (rule 25:
 * one representation of hours, not two). Rates are milli-cents. Money is whole
 * cents. No float ever touches a payable number.
 *
 * IT REFUSES RATHER THAN GUESSES. Standing rule 62d. Every input this engine
 * cannot interpret produces a REFUSAL with a plain-English reason and the
 * authority behind it — never a zero, never a default, never a best guess. A
 * zero that means "I could not tell" is indistinguishable from a zero that
 * means "they did not work", and only one of those is safe to pay.
 *
 * IT DOES NOT READ THE DATABASE. Pure functions, no imports from supabase, so
 * every rule below is unit-testable against the regulation's own worked
 * examples. The store layer feeds it rows and takes back a result.
 *
 * @see src/lib/payroll/timesheet-authorities.ts — the verbatim law
 * @see src/lib/payroll/timesheet-mentor.ts      — the teaching layer
 * @see supabase/migrations/0197_timesheet_workweek.sql — the schema
 */

import { hourlyGrossCents } from "./payroll-onboarding-core";
import { pacificDayKey, addPacificDays } from "@/lib/reports/timezone";

// ===========================================================================
// 1) THE VOCABULARY
// ===========================================================================

/**
 * A raw clock punch, exactly as `public.time_punches` stores it.
 *
 * NOTE ON `minutes`: the table has a `minutes` column the app fills on
 * clock-out. This engine accepts it but NEVER pays from it. It is a
 * convenience written by a different layer at a different time, and standing
 * rule 63d says the handoff is where the defect lives. So we recompute from
 * the timestamps and REPORT the variance. See `PunchVariance`.
 */
export type RawPunch = {
  readonly id: string;
  readonly employeeId: string;
  /** 'work' | 'break' — a break punch is unpaid time. */
  readonly punchKind: "work" | "break";
  /** ISO instant. */
  readonly clockInAt: string;
  /** ISO instant, or null when the punch is still open. */
  readonly clockOutAt: string | null;
  /** The app-written convenience value. Checked, never trusted. */
  readonly minutes: number | null;
};

/** 0 = Sunday .. 6 = Saturday. Matches Date#getUTCDay and the DB column. */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_NAMES: readonly string[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** The setup facts the engine needs before it will compute anything. */
export type TimesheetSettings = {
  /**
   * Day the fixed 168-hour workweek begins, or null when nobody has chosen.
   * NULL IS NOT SUNDAY. It is "unanswered", and the engine refuses.
   */
  readonly workweekStartsOn: WeekdayIndex | null;
  /**
   * Overtime threshold in hundredths of an hour. 4000 = 40 hours. Held as a
   * parameter rather than a literal so the tests can prove the threshold is
   * actually consulted, and so a future jurisdiction with a different figure
   * does not require surgery on the loop.
   */
  readonly overtimeThresholdHundredthHours: number;
  /** Overtime multiplier in basis points. 15000 = 1.5x. */
  readonly overtimeMultiplierBasisPoints: number;
};

/**
 * Washington and federal law agree on both numbers, so these are the defaults.
 * They are still DATA rather than literals in the loop, for the reason above.
 *
 * 40 hours: RCW 49.46.130(1) and 29 CFR §778.104.
 * 1.5x:     RCW 49.46.130(1) — "one and one-half times the regular rate".
 */
export const WA_OVERTIME_THRESHOLD_HUNDREDTH_HOURS = 4_000;
export const WA_OVERTIME_MULTIPLIER_BASIS_POINTS = 15_000;

export const DEFAULT_OVERTIME_RULES = {
  overtimeThresholdHundredthHours: WA_OVERTIME_THRESHOLD_HUNDREDTH_HOURS,
  overtimeMultiplierBasisPoints: WA_OVERTIME_MULTIPLIER_BASIS_POINTS,
} as const;

/** What we know about the person being paid. */
export type EmployeePayFacts = {
  readonly employeeId: string;
  readonly fullName: string;
  /** 'non_exempt' is owed overtime. 'exempt' is not. */
  readonly flsaStatus: "non_exempt" | "exempt";
  readonly basis: "hourly" | "salary";
  /** Thousandths of a cent per hour. Null for salaried staff. */
  readonly hourlyRateMilliCents: number | null;
};

/** The pay period being computed, as Pacific calendar days. */
export type PayPeriodDates = {
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate: string; // YYYY-MM-DD
};

// ===========================================================================
// 2) REFUSALS — every way this engine can decline to answer
//
// Standing rule 62d: never invent a default for missing upstream data. A
// refusal is a first-class result here, not an exception, because the screen
// has to SHOW Michael what is missing and why it matters. An exception would
// reach him as a stack trace or, worse, as a zero.
// ===========================================================================

export type TimesheetRefusalCode =
  | "NO_WORKWEEK_ANCHOR"
  | "OPEN_PUNCH"
  | "NEGATIVE_SPAN"
  | "OVERLAPPING_PUNCHES"
  | "PUNCH_OUTSIDE_PERIOD"
  | "NO_HOURLY_RATE"
  | "EXEMPT_PAID_HOURLY"
  | "SALARY_WITH_PUNCHES"
  | "BAD_PERIOD_DATES"
  | "IMPLAUSIBLE_SHIFT";

export type TimesheetRefusal = {
  readonly code: TimesheetRefusalCode;
  /** Plain English. This is shown to Michael verbatim. */
  readonly message: string;
  /** What to do about it. Never "contact support". */
  readonly fix: string;
  /** Ids into the merged guidance registry. */
  readonly authorityIds: readonly string[];
  /** The punch or employee at fault, when there is one. */
  readonly subjectId?: string;
};

// ===========================================================================
// 3) THE VARIANCE REPORT — standing rule 63d
//
// "The handoff is where the defect lives — print the variance."
//
// `time_punches.minutes` is written by the time-clock UI on clock-out. This
// engine recomputes from the timestamps. Where the two disagree we do NOT pick
// a winner silently: we pay from the timestamps (which are the evidence) and
// SHOW the disagreement, because a systematic gap between the two means one of
// the two layers has a bug and nobody would otherwise ever find out.
// ===========================================================================

export type PunchVariance = {
  readonly punchId: string;
  /** What the app wrote into time_punches.minutes. */
  readonly storedMinutes: number;
  /** What the timestamps actually say. */
  readonly computedMinutes: number;
  /** computed - stored. Positive means the stored value UNDERPAID. */
  readonly varianceMinutes: number;
};

// ===========================================================================
// 4) RESULT SHAPES
// ===========================================================================

/** One workweek bucket inside a pay period. */
export type WorkweekBucket = {
  /** 1-based, in date order, for display: "workweek 1 of 2". */
  readonly index: number;
  /** Pacific YYYY-MM-DD of the first day of this workweek segment. */
  readonly startDate: string;
  /** Pacific YYYY-MM-DD of the last day of this workweek segment. */
  readonly endDate: string;
  /**
   * TRUE when this bucket covers fewer than seven days because the pay period
   * boundary cut it short.
   *
   * THIS FLAG MATTERS AND IS NOT COSMETIC. A partial workweek means hours from
   * the OTHER half of that workweek fall in a different pay period. Forty
   * hours is still the threshold for the whole workweek, so a partial bucket
   * can under-report overtime unless the neighbouring period is considered.
   * The engine surfaces it rather than hiding it; see `partialWeekWarning`.
   */
  readonly isPartial: boolean;
  readonly totalHundredthHours: number;
  readonly regularHundredthHours: number;
  readonly overtimeHundredthHours: number;
  /** Punch ids that contributed, so every number drills down to evidence. */
  readonly punchIds: readonly string[];
};

export type EmployeePeriodHours = {
  readonly employeeId: string;
  readonly fullName: string;
  readonly weeks: readonly WorkweekBucket[];
  readonly totalHundredthHours: number;
  readonly regularHundredthHours: number;
  readonly overtimeHundredthHours: number;
  /** Straight-time pay for ALL hours worked, including the overtime hours. */
  readonly straightTimeCents: number;
  /**
   * The EXTRA half-rate owed on overtime hours. §778.110(a) computes overtime
   * as straight time on every hour plus one-half the rate on the hours over
   * forty, and this field is that second part on its own.
   */
  readonly overtimePremiumCents: number;
  readonly grossCents: number;
  readonly variances: readonly PunchVariance[];
  /** Set when any bucket is partial. Plain English, shown on screen. */
  readonly partialWeekWarning: string | null;
};

export type TimesheetResult =
  | { readonly ok: true; readonly value: EmployeePeriodHours }
  | { readonly ok: false; readonly refusals: readonly TimesheetRefusal[] };

// ===========================================================================
// 5) WORKWEEK BUCKETING
// ===========================================================================

/** Weekday index (0=Sun) of a Pacific YYYY-MM-DD label. Pure date arithmetic. */
export function weekdayOfDayKey(ymd: string): WeekdayIndex {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as WeekdayIndex;
}

/** Whole days from `a` to `b`, both Pacific YYYY-MM-DD. Negative if b < a. */
export function daysBetweenDayKeys(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

/**
 * Given any Pacific day, return the day the workweek CONTAINING it began.
 *
 * Example: anchor = Sunday (0), day = Wednesday 2027-01-06. Wednesday is
 * weekday 3, anchor is 0, so we step back (3 - 0 + 7) % 7 = 3 days to
 * 2027-01-03, the Sunday. That is the start of the 168-hour period that
 * Wednesday lives in.
 *
 * The `+ 7` before the modulo is what makes it work for every anchor: a
 * Wednesday anchor with a Monday date gives (1 - 3 + 7) % 7 = 5, stepping back
 * five days to the previous Wednesday. Without the + 7 the intermediate value
 * is negative and JavaScript's % returns a negative remainder.
 */
export function workweekStartFor(ymd: string, anchor: WeekdayIndex): string {
  const wd = weekdayOfDayKey(ymd);
  const back = (wd - anchor + 7) % 7;
  return addPacificDays(ymd, -back);
}

/**
 * The later of two Pacific day keys. Used to clip a segment START to the
 * pay period.
 *
 * These two helpers exist because the bare comparison they replace was
 * written backwards once already, and the symptom was silent: a fourteen-day
 * pay period collapsed into a SINGLE eighty-hour "workweek", which then
 * reported forty hours of overtime premium on two ordinary forty-hour weeks.
 * A named function whose name states the answer cannot be read backwards.
 */
function maxDayKey(a: string, b: string): string {
  return daysBetweenDayKeys(a, b) > 0 ? b : a;
}

/** The earlier of two Pacific day keys. Used to clip a segment END. */
function minDayKey(a: string, b: string): string {
  return daysBetweenDayKeys(a, b) < 0 ? b : a;
}

/**
 * Split a pay period into its workweek segments.
 *
 * A fourteen-day biweekly period aligned to the anchor yields exactly two
 * complete buckets. A period that is NOT aligned yields three: a partial, a
 * complete, and another partial. That is not an error — it is the truth about
 * the calendar, and hiding it would be the bug.
 *
 * Each segment is the intersection of one 168-hour workweek with the pay
 * period: it starts at the LATER of the two starts and ends at the EARLIER of
 * the two ends. Getting either direction wrong merges weeks together, and
 * merged weeks are exactly what 29 CFR 778.104 forbids.
 */
export function splitIntoWorkweeks(
  period: PayPeriodDates,
  anchor: WeekdayIndex,
): Array<{ startDate: string; endDate: string; isPartial: boolean }> {
  const out: Array<{ startDate: string; endDate: string; isPartial: boolean }> =
    [];
  let cursor = period.startDate;
  let index = 0;
  // Bounded loop. A pay period longer than 400 weeks is not a pay period, and
  // an unbounded while over date strings is how a bad input becomes a hung
  // server rather than an error message.
  while (daysBetweenDayKeys(cursor, period.endDate) >= 0 && index < 400) {
    const weekStart = workweekStartFor(cursor, anchor);
    const weekEnd = addPacificDays(weekStart, 6);
    // Clip this workweek to the pay period on both ends.
    const segStart = maxDayKey(weekStart, period.startDate);
    const segEnd = minDayKey(weekEnd, period.endDate);
    out.push({
      startDate: segStart,
      endDate: segEnd,
      // Seven days inclusive means daysBetween == 6. Anything less was clipped.
      isPartial: daysBetweenDayKeys(segStart, segEnd) !== 6,
    });
    cursor = addPacificDays(segEnd, 1);
    index += 1;
  }
  return out;
}

// ===========================================================================
// 6) PUNCH ARITHMETIC
// ===========================================================================

/**
 * Worked minutes of a punch, from the TIMESTAMPS. Never from `minutes`.
 *
 * Returns null when the punch is open. Note that this uses real elapsed time,
 * which is what makes a shift spanning the spring-forward DST transition come
 * out at the hours actually worked rather than the hours the wall clock
 * appears to show. Someone clocking in at 1am and out at 4am on the second
 * Sunday in March worked two hours, not three, and the timestamps know that.
 */
export function punchMinutes(p: RawPunch): number | null {
  if (!p.clockOutAt) return null;
  const inMs = Date.parse(p.clockInAt);
  const outMs = Date.parse(p.clockOutAt);
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return null;
  return Math.round((outMs - inMs) / 60_000);
}

/**
 * Convert whole minutes into integer hundredths of an hour, HALF UP.
 *
 * THE ARITHMETIC, derived rather than guessed:
 *
 *   60 minutes = 100 hundredths, so  hundredths = minutes x 100 / 60
 *                                               = minutes x 5 / 3
 *
 *   Half-up rounding of a positive rational a/b is  floor((2a + b) / 2b).
 *   With a = minutes x 5 and b = 3 that is  floor((10 x minutes + 3) / 6).
 *
 * This was verified exhaustively against exact decimal ROUND_HALF_UP for every
 * minute value from 0 to 100,000 before being written here — zero mismatches.
 * (100,000 minutes is about 69 days, comfortably beyond any pay period.)
 *
 * A NOTE ON THE BOUNDARY. A denominator of 3 can never produce a fraction of
 * exactly one half, so in practice the half-up branch is never taken for whole
 * minutes and the direction is moot. It is still written as half-up rather
 * than as a plain truncation, because truncation is a systematic downward bias
 * and this function will one day be handed something other than whole minutes.
 * The direction matches `hourlyGrossCents`, which rounds the same way for the
 * same reason: a half-cent is trivial, and a finding that you systematically
 * rounded a worker's hours DOWN is not.
 *
 * WHY NOT Math.round? Because Math.round(-0.5) is -0 and Math.round(2.5) is 3
 * while Math.round(-2.5) is -2 — its behaviour at the boundary depends on sign
 * in a way nobody remembers under pressure. Integer arithmetic with the +b
 * written out is auditable by reading it.
 */
export function minutesToHundredthHours(minutes: number): number {
  if (!Number.isInteger(minutes)) {
    throw new Error(
      `minutesToHundredthHours: minutes must be an integer (got ${String(minutes)}). ` +
        `Fractional minutes re-introduce the float drift integer units exist to stop.`,
    );
  }
  if (minutes < 0) {
    throw new Error(
      `minutesToHundredthHours: minutes must not be negative (got ${String(minutes)}). ` +
        `A negative span is a broken punch and must be refused upstream, not rounded.`,
    );
  }
  return Math.floor((10 * minutes + 3) / 6);
}

// ===========================================================================
// 7) THE ENGINE
// ===========================================================================

/**
 * Turn one employee's punches into payable hours for one pay period.
 *
 * REFUSES, in this order, and reports EVERY problem it finds rather than the
 * first — a screen that surfaces one error at a time turns a five-minute fix
 * into five round trips.
 */
export function computePeriodHours(args: {
  employee: EmployeePayFacts;
  period: PayPeriodDates;
  punches: readonly RawPunch[];
  settings: TimesheetSettings;
}): TimesheetResult {
  const { employee, period, punches, settings } = args;
  const refusals: TimesheetRefusal[] = [];

  // ── Setup facts ────────────────────────────────────────────────────────
  if (settings.workweekStartsOn === null) {
    refusals.push({
      code: "NO_WORKWEEK_ANCHOR",
      message:
        "Nobody has chosen which day the workweek starts, so this pay period cannot be " +
        "split into workweeks and overtime cannot be computed.",
      fix:
        "Open Company Information and set 'Workweek starts on'. It is a one-time choice " +
        "and it should not be changed casually afterwards.",
      authorityIds: [
        "cfr-778-105-workweek-definition",
        "cfr-778-104-workweek-stands-alone",
      ],
    });
  }

  if (daysBetweenDayKeys(period.startDate, period.endDate) < 0) {
    refusals.push({
      code: "BAD_PERIOD_DATES",
      message: `The pay period ends (${period.endDate}) before it starts (${period.startDate}).`,
      fix: "Correct the pay period on the pay calendar before gathering timesheets.",
      authorityIds: [],
    });
  }

  // ── Classification facts ───────────────────────────────────────────────
  if (employee.basis === "hourly" && employee.hourlyRateMilliCents === null) {
    refusals.push({
      code: "NO_HOURLY_RATE",
      message: `${employee.fullName} is paid hourly but has no hourly rate on file.`,
      fix: "Set the pay rate on the employee's pay record before running payroll.",
      authorityIds: ["cfr-778-109-regular-rate-is-hourly"],
      subjectId: employee.employeeId,
    });
  }

  if (employee.flsaStatus === "exempt" && employee.basis === "hourly") {
    refusals.push({
      code: "EXEMPT_PAID_HOURLY",
      message:
        `${employee.fullName} is marked exempt from overtime but is paid an hourly rate. ` +
        "That combination is almost always a mistake.",
      fix:
        "Check the classification. Exemption depends on job DUTIES and a salary threshold, " +
        "not on how someone is paid — and paying a salary does not create an exemption either. " +
        "If they really are exempt, record the duties relied on.",
      authorityIds: ["rcw-49-46-130-exemptions"],
      subjectId: employee.employeeId,
    });
  }

  if (employee.basis === "salary" && punches.length > 0) {
    refusals.push({
      code: "SALARY_WITH_PUNCHES",
      message:
        `${employee.fullName} is salaried but has ${punches.length} clock punch(es) in this period.`,
      fix:
        "Decide which is right. If they are genuinely hourly, change the pay basis. If the " +
        "punches are a time-tracking convenience only, exclude them from payroll deliberately " +
        "rather than letting the engine pick.",
      authorityIds: ["rcw-49-46-130-exemptions"],
      subjectId: employee.employeeId,
    });
  }

  // ── Punch-level facts ──────────────────────────────────────────────────
  const work = punches.filter((p) => p.punchKind === "work");
  const variances: PunchVariance[] = [];

  for (const p of punches) {
    if (!p.clockOutAt) {
      refusals.push({
        code: "OPEN_PUNCH",
        message:
          `A punch that started ${p.clockInAt} has never been clocked out, so its length is unknown.`,
        fix:
          "Close or correct the punch on the time-clock screen. Every correction needs a reason, " +
          "which is what keeps the record defensible.",
        authorityIds: [],
        subjectId: p.id,
      });
      continue;
    }
    const mins = punchMinutes(p);
    if (mins === null) {
      refusals.push({
        code: "OPEN_PUNCH",
        message: `A punch (${p.id}) has timestamps that cannot be read.`,
        fix: "Correct the punch on the time-clock screen.",
        authorityIds: [],
        subjectId: p.id,
      });
      continue;
    }
    if (mins < 0) {
      refusals.push({
        code: "NEGATIVE_SPAN",
        message: `A punch clocks out (${p.clockOutAt}) before it clocks in (${p.clockInAt}).`,
        fix: "Correct the punch on the time-clock screen.",
        authorityIds: [],
        subjectId: p.id,
      });
      continue;
    }
    // A single punch longer than 24 hours is not a shift, it is a missed
    // clock-out that someone later closed. Paying it silently is how a
    // 31-hour day reaches a paycheck.
    if (mins > 24 * 60) {
      refusals.push({
        code: "IMPLAUSIBLE_SHIFT",
        message:
          `A single punch is ${(mins / 60).toFixed(1)} hours long, which is longer than a day.`,
        fix:
          "This is almost always a missed clock-out that was closed later. Correct it on the " +
          "time-clock screen rather than paying it as worked time.",
        authorityIds: [],
        subjectId: p.id,
      });
      continue;
    }
    // Standing rule 63d: print the variance at the handoff.
    if (p.minutes !== null && p.minutes !== mins) {
      variances.push({
        punchId: p.id,
        storedMinutes: p.minutes,
        computedMinutes: mins,
        varianceMinutes: mins - p.minutes,
      });
    }
  }

  // Overlapping WORK punches mean the same minute is about to be paid twice.
  const sorted = [...work]
    .filter((p) => p.clockOutAt !== null)
    .sort((a, b) => Date.parse(a.clockInAt) - Date.parse(b.clockInAt));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (Date.parse(cur.clockInAt) < Date.parse(prev.clockOutAt as string)) {
      refusals.push({
        code: "OVERLAPPING_PUNCHES",
        message:
          `Two work punches overlap: one runs to ${prev.clockOutAt} and the next starts ` +
          `${cur.clockInAt}. The overlapping minutes would be paid twice.`,
        fix: "Correct one of the two punches on the time-clock screen.",
        authorityIds: [],
        subjectId: cur.id,
      });
    }
  }

  if (refusals.length > 0) return { ok: false, refusals };

  // ── Bucket by WORKWEEK. Never by period. ───────────────────────────────
  const anchor = settings.workweekStartsOn as WeekdayIndex;
  const segments = splitIntoWorkweeks(period, anchor);

  const buckets: WorkweekBucket[] = segments.map((seg, i) => {
    const inSeg = work.filter((p) => {
      const day = pacificDayKey(p.clockInAt);
      return (
        daysBetweenDayKeys(seg.startDate, day) >= 0 &&
        daysBetweenDayKeys(day, seg.endDate) >= 0
      );
    });
    // Sum MINUTES first, convert ONCE. Converting each punch and then adding
    // would round every punch separately and accumulate the error — eight
    // punches rounded up is up to eight hundredths of an hour of drift.
    const totalMinutes = inSeg.reduce((s, p) => s + (punchMinutes(p) ?? 0), 0);
    const total = minutesToHundredthHours(totalMinutes);
    // THE ONLY THRESHOLD COMPARISON IN THIS FILE, and it is inside the
    // per-week loop by construction. An exempt employee has no overtime.
    //
    // MUTATION-TESTING NOTE (recorded so nobody has to re-derive it).
    // Twelve mutants were run against tests/compliance/timesheet-core.test.ts.
    // Nine were killed. Three survived, and all three were then PROVEN
    // equivalent rather than accepted as test gaps:
    //
    //   * `>` -> `>=` on the line below. Reachability of `total == threshold`
    //     was demonstrated with a real five-day 40-hour scenario; at that
    //     point `total - threshold` is 0, so both operators return the same
    //     zero premium. Equivalent by arithmetic, not by luck.
    //
    //   * `eligible` forced to `true`. Every route that puts an exempt worker
    //     into this loop WITH hours is refused upstream — EXEMPT_PAID_HOURLY
    //     for exempt+hourly, SALARY_WITH_PUNCHES for salary+punches — leaving
    //     only exempt+salary+no-punches, where hours are 0 and no overtime can
    //     arise either way.
    //
    //   * the anchor cast defaulted with `?? 0`. A null anchor is refused
    //     upstream as NO_WORKWEEK_ANCHOR, so this loop is unreachable then.
    //
    // The last two are defence in depth over currently-unreachable states, and
    // they stay. If a future change ever relaxes one of those upstream
    // refusals, these guards become live and the mutants become killable. That
    // is the point of keeping them.
    const eligible = employee.flsaStatus === "non_exempt";
    const over =
      eligible && total > settings.overtimeThresholdHundredthHours
        ? total - settings.overtimeThresholdHundredthHours
        : 0;
    return {
      index: i + 1,
      startDate: seg.startDate,
      endDate: seg.endDate,
      isPartial: seg.isPartial,
      totalHundredthHours: total,
      regularHundredthHours: total - over,
      overtimeHundredthHours: over,
      punchIds: inSeg.map((p) => p.id),
    };
  });

  const totalHundredthHours = buckets.reduce(
    (s, b) => s + b.totalHundredthHours,
    0,
  );
  const overtimeHundredthHours = buckets.reduce(
    (s, b) => s + b.overtimeHundredthHours,
    0,
  );
  const regularHundredthHours = totalHundredthHours - overtimeHundredthHours;

  // ── Money ──────────────────────────────────────────────────────────────
  //
  // §778.110(a) states the calculation as: straight time on EVERY hour, plus
  // one-half the rate on the hours over forty. We implement it that way rather
  // than as "40 x rate + OT x 1.5 x rate" because the regulation's own worked
  // example is expressed in those terms and the test compares against it
  // directly. Both forms give $588.00 for 46 hours at $12; using the same
  // shape as the source removes a translation step where a bug could hide.
  const rate = employee.hourlyRateMilliCents;
  let straightTimeCents = 0;
  let overtimePremiumCents = 0;
  if (employee.basis === "hourly" && rate !== null) {
    straightTimeCents = hourlyGrossCents(totalHundredthHours, rate);
    // The premium half. multiplier 15000 bp = 1.5x, so the EXTRA is 0.5x, i.e.
    // (multiplier - 10000) basis points of the rate.
    const premiumBp = settings.overtimeMultiplierBasisPoints - 10_000;
    const premiumRateMilliCents = Math.round((rate * premiumBp) / 10_000);
    overtimePremiumCents = hourlyGrossCents(
      overtimeHundredthHours,
      premiumRateMilliCents,
    );
  }

  const partial = buckets.filter((b) => b.isPartial);
  const partialWeekWarning =
    partial.length === 0
      ? null
      : `This pay period does not line up with the workweek. ` +
        `${partial.length} of the ${buckets.length} workweeks shown ${partial.length === 1 ? "is" : "are"} ` +
        `only part of a full week, because the rest of ${partial.length === 1 ? "that week falls" : "those weeks fall"} ` +
        `in the neighbouring pay period. Overtime is owed on the WHOLE workweek, so those hours have ` +
        `to be read together with the neighbouring period before you can be sure the overtime is right.`;

  return {
    ok: true,
    value: {
      employeeId: employee.employeeId,
      fullName: employee.fullName,
      weeks: buckets,
      totalHundredthHours,
      regularHundredthHours,
      overtimeHundredthHours,
      straightTimeCents,
      overtimePremiumCents,
      grossCents: straightTimeCents + overtimePremiumCents,
      variances,
      partialWeekWarning,
    },
  };
}

// ===========================================================================
// 8) FORMATTING — shared so two screens cannot disagree about a number
// ===========================================================================

/** 4650 -> "46.50". Integer arithmetic; never toFixed on a float. */
export function formatHundredthHours(h: number): string {
  const sign = h < 0 ? "-" : "";
  const a = Math.abs(h);
  return `${sign}${Math.trunc(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** 58800 -> "$588.00". */
export function formatCents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(c);
  return `${sign}$${Math.trunc(a / 100).toLocaleString("en-US")}.${String(a % 100).padStart(2, "0")}`;
}
