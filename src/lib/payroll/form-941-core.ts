/**
 * src/lib/payroll/form-941-core.ts   (books-40)
 *
 * FORM 941 - EMPLOYER'S QUARTERLY FEDERAL TAX RETURN.
 *
 * WHY THIS FILE EXISTS, VERBATIM (standing rule 1)
 *
 *   "Then - books-40: quarterly filings. 941 first, since it is due first and
 *    is mostly summation; then the ESD and L&I quarterly reports."
 *
 * MICHAEL IS RIGHT, AND THAT IS THE DANGER
 *
 * The 941 really is mostly summation. Lines 2, 3, 5a and 5c are totals; line 6
 * adds three of them; line 12 adds one more. A programmer reading the form for
 * the first time will write it in forty lines and it will look finished.
 *
 * It will also be wrong, in two specific places:
 *
 *   LINE 1 is not a sum at all. It is a headcount on ONE DAY - the pay period
 *   containing the 12th of the quarter's last month (I941_LINE_1_...). Counting
 *   distinct people in the quarter's wage detail gives a plausible number that
 *   is not the number the IRS asked for.
 *
 *   LINE 7 is a residual, and it is the one line on this form where a wrong
 *   number looks completely normal. The IRS expects it to be a few cents, so a
 *   few cents is exactly what a bug produces before anybody notices. See
 *   `fractionsOfCents` below for the rule that stops this file from plugging.
 *
 * HOW WE KNOW IT IS RIGHT (standing rule 59: evidence is ranked)
 *
 * `src/lib/reports/known-good-quarters.ts` holds Greenway's ACTUALLY FILED
 * Q2 2026 figures, taken off returns the IRS and Washington accepted, several
 * with confirmation numbers. This engine is built to reproduce them. When this
 * code and that file disagree, this code is wrong - there is no third
 * possibility to argue about. That fixture is an oracle, not a test.
 *
 * WHAT THIS FILE DOES NOT DO
 *
 * It does not file anything, and it never will. Standing boundary: we replace
 * the data-preparation half of Aatrix, not the transmission half. This produces
 * a return a human being reads, checks and signs.
 *
 * It also does not invent a single number. Where a fact is missing, the
 * function returns a refusal naming the fact and the one question that would
 * fix it (standing rule 62d: never invent a default).
 *
 * UNITS. Money is integer cents throughout. Rates are milli-percent, matching
 * the rest of the payroll code (1.45% = 1_450).
 */

import {
  type QuarterRef,
  formatQuarter,
  quarterDateRange,
  formatCents,
  federalHolidays,
  onOrAfterBusinessDay,
} from "@/lib/payroll/payroll-deposit-schedule-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  THE STATUTORY RATES THIS FORM IS BUILT ON
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Social Security, BOTH HALVES. Line 5a column 2 is line 5a column 1 x 0.124,
 * printed on the form itself - see I941_LINE_5A_BOTH_HALVES_AND_THE_CAP.
 *
 * Expressed in milli-percent: 12.4% = 12_400.
 */
export const OASDI_COMBINED_MILLI_PCT = 12_400;

/** Social Security, employee half only. 6.2%. Needed for the line 7 residual. */
export const OASDI_EMPLOYEE_MILLI_PCT = 6_200;

/** Medicare, BOTH HALVES. 2.9%. No ceiling, ever. */
export const MEDICARE_COMBINED_MILLI_PCT = 2_900;

/** Medicare, employee half only. 1.45%. */
export const MEDICARE_EMPLOYEE_MILLI_PCT = 1_450;

/**
 * Multiply cents by a milli-percent rate, rounding half away from zero.
 *
 * HALF AWAY FROM ZERO, not banker's rounding and not `Math.round`.
 * `Math.round(-0.5)` is `-0`, which rounds negative halves the wrong way; on a
 * form that carries negative adjustments (line 7 can be negative, and
 * Greenway's filed Q2 2026 line 7 IS negative) that asymmetry is a real defect
 * rather than a theoretical one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * books-45: THIS IS NOW THE WITHHOLDING ENGINE'S FUNCTION, RE-EXPORTED.
 *
 * It used to be a second, independent implementation with the same name, and it
 * computed `(cents * milliPct) / 100_000` — a FLOAT DIVIDE — before rounding.
 * The withholding engine's version never leaves integer arithmetic: it forms
 * the product and divides with `divideRoundHalfUp`, using `%` and comparison
 * only.
 *
 * WHAT THE DUPLICATE ACTUALLY COST, measured rather than assumed. Exhaustively
 * comparing both versions over −300,000 to +300,000 cents at all six rates this
 * codebase uses produced ZERO disagreements, and they agree on the exact-half
 * cases too. So this was never handing Michael a wrong number on a filed form,
 * and it is important to say that plainly rather than dress the fix up as a
 * near-miss.
 *
 * The cost was in the GUARDS, and there the two were not equivalent at all:
 *
 *   applyMilliPct(10_000, 6_200.5)          float: returned 620   integer: THREW
 *   applyMilliPct(900_000_000_000_000, ...) float: returned a value from a
 *                                           product past 2^53    integer: THREW
 *
 * A non-integer RATE is exactly how a "6.2%" typed as 0.062 or a rate divided
 * one time too many enters a money path, and the float version accepted it
 * silently and returned a plausible-looking number. The integer version refuses.
 * Standing rule 27: refuse rather than default.
 *
 * Two functions with one name, one of which is stricter, is a coin flip over
 * which safety net is under any given line of the return — decided by which
 * file the caller happened to be in. The stricter one wins, everywhere.
 *
 * The re-export is deliberate rather than a call-site sweep: `applyMilliPct` is
 * taught as part of the 941 module's own vocabulary (see form-941-mentor), and
 * a lesson that points at a name this file no longer exports would be a broken
 * lesson. Same name, same module surface, one implementation underneath.
 *
 * NOTE the two-line form. A bare `export { x } from "..."` re-exports without
 * creating a local binding, so this file's own four call sites could not see
 * it — `tsc` said so immediately, which is the compiler doing the job a guess
 * would have skipped.
 */
import { applyMilliPct } from "@/lib/payroll/payroll-withholding-core";
export { applyMilliPct };

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  WHAT THE ENGINE NEEDS TO BE TOLD
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One person's quarter.
 *
 * `oasdiTaxableWagesCents` is carried SEPARATELY from `wagesCents` rather than
 * being derived, because the two genuinely differ once somebody crosses the
 * Social Security wage base, and deriving it here would mean this file
 * silently re-implementing a cap that `ytd-core` already owns. One rule, one
 * home. For everybody at Greenway today the two are equal, and the engine does
 * not assume that.
 */
export type Form941Subject = {
  readonly subjectId: string;
  readonly displayName: string;
  /** Line 2 basis: wages, tips and other compensation - W-2 box 1. */
  readonly wagesCents: number;
  /** Line 5a basis: wages subject to Social Security, after the annual cap. */
  readonly oasdiTaxableWagesCents: number;
  /** Line 5c basis: wages subject to Medicare. Uncapped, so normally = wages. */
  readonly medicareTaxableWagesCents: number;
  /** Line 3 contribution: federal income tax actually withheld this quarter. */
  readonly federalIncomeTaxWithheldCents: number;
  /**
   * What was ACTUALLY withheld from this person for the employee half of
   * Social Security and Medicare, summed across the quarter's paycheques.
   *
   * This is the input that makes line 7 honest. It is deliberately the sum of
   * real paycheque amounts, not a recomputation - if it were recomputed, line 7
   * would always be zero and the form would be lying in a way the IRS
   * specifically anticipates.
   */
  readonly actualEmployeeFicaWithheldCents: number;
  /**
   * Was this person on the payroll for the pay period containing the 12th of
   * the quarter's last month? Drives line 1 and nothing else.
   *
   * `null` means nobody has recorded it. That is a refusal, not a `false`.
   */
  readonly onPayrollForTwelfthPayPeriod: boolean | null;
};

export type Form941Request = {
  readonly quarter: QuarterRef;
  readonly subjects: readonly Form941Subject[];
  /**
   * Total federal tax deposited for this quarter, from the deposit record.
   * `null` when the deposit history has not been supplied - line 13 then
   * refuses instead of assuming zero, because assuming zero turns a fully paid
   * quarter into a balance due equal to the entire quarter's tax.
   */
  readonly totalDepositsCents: number | null;
  /** Where the caller got these figures. Printed on the return for provenance. */
  readonly sourceLabel: string;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  REFUSALS - the codes, and why each one exists
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Form941RefusalCode =
  /** No subjects at all AND the caller did not ask for a zero return. */
  | "NO_SUBJECTS"
  /** At least one person's line-1 answer has never been recorded. */
  | "TWELFTH_DAY_UNKNOWN"
  /** A wage figure is negative, which no quarter can produce honestly. */
  | "NEGATIVE_WAGES"
  /** OASDI taxable wages exceed total wages for somebody. Impossible. */
  | "OASDI_EXCEEDS_WAGES"
  /** The line 7 residual is too large to be rounding. Something is actually wrong. */
  | "FRACTIONS_TOO_LARGE"
  /** Deposits were not supplied, so lines 13-15 cannot be stated. */
  | "DEPOSITS_UNKNOWN"
  /** The quarter is not a real quarter, or is in the future. */
  | "QUARTER_NOT_VALID";

export const ALL_FORM_941_REFUSAL_CODES: readonly Form941RefusalCode[] = [
  "NO_SUBJECTS",
  "TWELFTH_DAY_UNKNOWN",
  "NEGATIVE_WAGES",
  "OASDI_EXCEEDS_WAGES",
  "FRACTIONS_TOO_LARGE",
  "DEPOSITS_UNKNOWN",
  "QUARTER_NOT_VALID",
] as const;

export type Form941Refusal = {
  readonly code: Form941RefusalCode;
  /** What is wrong, in a whole sentence, safe to render on its own. */
  readonly what: string;
  /** The ONE question that would clear it. Standing rule 43. */
  readonly fix: string;
  /** Who or what the problem attaches to, when it attaches to somebody. */
  readonly subjectId: string | null;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  THE FRACTIONS-OF-CENTS RULE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The largest line 7 that rounding alone can explain.
 *
 * Each paycheque rounds Social Security and Medicare independently, and each
 * rounding can be off by at most half a cent in either direction. With two
 * levies and 26 pay periods a year, one person can accumulate at most about
 * 13 cents of drift in a QUARTER of 6.5 periods - call it 1 cent per person
 * per levy per period, which is generous.
 *
 * The formula below is deliberately generous rather than tight: a false
 * refusal on a correct quarter would train Michael to click past refusals,
 * which costs more than it saves. It still catches the failure that matters -
 * a rate applied wrongly, which produces a drift proportional to WAGES rather
 * than to headcount, and blows past any headcount-based allowance immediately.
 *
 * Greenway's filed Q2 2026 line 7 is -7 cents against 10 people: the allowance
 * at 10 people is 260 cents, so the real quarter sits at 3% of the limit.
 */
export function maxFractionsOfCentsDriftCents(subjectCount: number, payPeriodsInQuarter = 6.5): number {
  if (subjectCount < 0) {
    throw new Error(`form-941: subject count cannot be negative, got ${subjectCount}.`);
  }
  // 2 levies x 2 (either direction) x periods, rounded up, per person.
  return Math.ceil(subjectCount * payPeriodsInQuarter * 2 * 2);
}

export type FractionsOfCents = {
  /** Employee-half FICA as the statutory rates say it should have been. */
  readonly byRateCents: number;
  /** Employee-half FICA as the paycheques actually came out. */
  readonly actuallyWithheldCents: number;
  /** Line 7. Actual minus by-rate. Negative when slightly less came out. */
  readonly adjustmentCents: number;
  /** The largest drift rounding alone could produce for this many people. */
  readonly allowedCents: number;
  readonly withinRounding: boolean;
  /** A whole sentence a non-accountant can act on. */
  readonly plain: string;
};

/**
 * Compute line 7 as a RESIDUAL, and say whether it is credible.
 *
 * THE RULE THIS FILE REFUSES TO BREAK: line 7 is never plugged to make the
 * form balance. It is measured, and if the measurement is too big to be
 * rounding then the return REFUSES. Plugging would hide a genuine withholding
 * error inside the one line the IRS expects to be small and ignores.
 */
export function fractionsOfCents(subjects: readonly Form941Subject[]): FractionsOfCents {
  let byRate = 0;
  let actual = 0;
  for (const s of subjects) {
    byRate +=
      applyMilliPct(s.oasdiTaxableWagesCents, OASDI_EMPLOYEE_MILLI_PCT) +
      applyMilliPct(s.medicareTaxableWagesCents, MEDICARE_EMPLOYEE_MILLI_PCT);
    actual += s.actualEmployeeFicaWithheldCents;
  }

  const adjustment = actual - byRate;
  const allowed = maxFractionsOfCentsDriftCents(subjects.length);
  const withinRounding = Math.abs(adjustment) <= allowed;

  const plain = withinRounding
    ? adjustment === 0
      ? "Line 7 is zero. What came out of the paycheques matches the statutory rates to the cent."
      : `Line 7 is ${formatCents(adjustment)}. That is the normal few-cents difference between ` +
        `rounding every paycheque and taxing the quarter in one go, and the IRS puts a line on the ` +
        `form for exactly this. Rounding could explain up to ${formatCents(allowed)} across ` +
        `${subjects.length} ${subjects.length === 1 ? "person" : "people"}.`
    : `Line 7 would be ${formatCents(adjustment)}, which is too big to be rounding - across ` +
      `${subjects.length} ${subjects.length === 1 ? "person" : "people"} rounding could only ` +
      `explain ${formatCents(allowed)}. Something is genuinely different between what the rates ` +
      `say and what came out of the paycheques. This is not a line to plug.`;

  return {
    byRateCents: byRate,
    actuallyWithheldCents: actual,
    adjustmentCents: adjustment,
    allowedCents: allowed,
    withinRounding,
    plain,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  LINE 1 - THE HEADCOUNT ON ONE DAY
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The date whose pay period line 1 counts: the 12th of the quarter's LAST
 * month. March 12, June 12, September 12, December 12 - stated on the form.
 */
export function twelfthDayFor(q: QuarterRef): string {
  const lastMonth = q.quarter * 3;
  return `${q.year}-${String(lastMonth).padStart(2, "0")}-12`;
}

/**
 * Line 1. A count, not a sum.
 *
 * Returns `null` when anybody's answer is unrecorded, so the caller refuses
 * rather than quietly counting an unknown as a no. An unrecorded fact and a
 * recorded "no" look identical in a count and mean completely different
 * things (standing rule 39).
 */
export function line1EmployeeCount(subjects: readonly Form941Subject[]): number | null {
  if (subjects.some((s) => s.onPayrollForTwelfthPayPeriod === null)) return null;
  return subjects.filter((s) => s.onPayrollForTwelfthPayPeriod === true).length;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  DUE DATES
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Form941DueDates = {
  /** Last day of the first month after the quarter, shifted off weekends/holidays. */
  readonly ordinary: string;
  /** The 10th of the second month after, EARNED by timely full deposits. */
  readonly ifDepositsWereTimely: string;
  /** True when 7503 actually moved the ordinary date. */
  readonly ordinaryWasShifted: boolean;
  readonly plain: string;
};

/**
 * Both due dates, computed rather than looked up.
 *
 * Reuses `federalHolidays` and `onOrAfterBusinessDay` from the deposit-schedule
 * engine instead of writing a second calendar (standing rule 25). If the two
 * ever disagreed about whether a day is a business day, one of them would be
 * wrong on a deadline - so there is only one of them.
 */
export function form941DueDates(q: QuarterRef): Form941DueDates {
  const { end } = quarterDateRange(q);
  const [ey, em] = end.split("-").map(Number);

  // Last day of the month AFTER the quarter ends. Day 0 of month+2 in JS's
  // 1-based-month-as-0-indexed convention is the last day of month+1.
  const ordinaryRaw = new Date(Date.UTC(ey, em + 1, 0));
  const rawIso = ordinaryRaw.toISOString().slice(0, 10);

  const secondMonth = new Date(Date.UTC(ey, em + 1, 10));
  const tenthIso = secondMonth.toISOString().slice(0, 10);

  // Holidays can span a year boundary for Q4 (December quarter, January due).
  const holidays = new Set<string>([
    ...federalHolidays(ey).map((h) => h.date),
    ...federalHolidays(ey + 1).map((h) => h.date),
  ]);

  const ordinary = onOrAfterBusinessDay(rawIso, holidays);
  const tenth = onOrAfterBusinessDay(tenthIso, holidays);
  const shifted = ordinary !== rawIso;

  const plain = shifted
    ? `${formatQuarter(q)} is due ${ordinary}. The ordinary deadline would be ${rawIso}, but that ` +
      `is a weekend or a federal holiday, so the law moves it to the next working day. If every ` +
      `deposit for the quarter was made in full and on time, the return may instead be filed by ` +
      `${tenth}.`
    : `${formatQuarter(q)} is due ${ordinary} - the last day of the month after the quarter ends. ` +
      `If every deposit for the quarter was made in full and on time, the return may instead be ` +
      `filed by ${tenth}. That extension is earned by the deposit history, not requested.`;

  return {
    ordinary,
    ifDepositsWereTimely: tenth,
    ordinaryWasShifted: shifted,
    plain,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §7  THE RETURN
 * ═══════════════════════════════════════════════════════════════════════════ */

/** One line on the form, with its own arithmetic shown. */
export type Form941Line = {
  /** "1", "5a", "12" - as printed on the form. */
  readonly line: string;
  readonly caption: string;
  /** Money in cents, or a bare count for line 1. */
  readonly amountCents: number;
  /** True for line 1, where the number is people rather than money. */
  readonly isCount: boolean;
  /** How this figure was arrived at, in words Michael can check. */
  readonly derivation: string;
};

export type Form941Return = {
  readonly ok: true;
  readonly quarter: QuarterRef;
  readonly quarterLabel: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly due: Form941DueDates;
  readonly lines: readonly Form941Line[];
  readonly fractions: FractionsOfCents;
  /** Line 12 - the number that matters. */
  readonly totalTaxCents: number;
  /** Line 13, or null when the deposit history was not supplied. */
  readonly totalDepositsCents: number | null;
  /** Line 14 balance due (positive) / line 15 overpayment (negative), or null. */
  readonly balanceDueCents: number | null;
  readonly subjectCount: number;
  readonly sourceLabel: string;
  /** The single sentence to put at the top of the screen. */
  readonly verdict: string;
};

export type Form941Result =
  | Form941Return
  | { readonly ok: false; readonly refusals: readonly Form941Refusal[] };

/** Cheap lookup so callers and tests do not index into `lines` by position. */
export function lineOf(ret: Form941Return, line: string): Form941Line | undefined {
  return ret.lines.find((l) => l.line === line);
}

/**
 * Build the return.
 *
 * ORDER OF OPERATIONS IS DELIBERATE. Every validation runs BEFORE any
 * arithmetic, and ALL refusals are collected rather than the first one being
 * thrown. A screen that reports one problem, gets it fixed, and then reports
 * the next is a screen that wastes an afternoon; Michael should see the whole
 * list at once.
 */
export function buildForm941(req: Form941Request): Form941Result {
  const refusals: Form941Refusal[] = [];

  // ── Validate the quarter itself ──────────────────────────────────────────
  if (
    !Number.isInteger(req.quarter.year) ||
    req.quarter.year < 2000 ||
    req.quarter.year > 2100 ||
    ![1, 2, 3, 4].includes(req.quarter.quarter)
  ) {
    refusals.push({
      code: "QUARTER_NOT_VALID",
      what:
        `"${req.quarter.year} Q${req.quarter.quarter}" is not a quarter this system will build a ` +
        `return for.`,
      fix: "Pick a quarter between 2000 and 2100, numbered 1 to 4.",
      subjectId: null,
    });
    // Nothing below can be trusted without a valid quarter.
    return { ok: false, refusals };
  }

  // ── Validate each person ─────────────────────────────────────────────────
  for (const s of req.subjects) {
    if (
      s.wagesCents < 0 ||
      s.oasdiTaxableWagesCents < 0 ||
      s.medicareTaxableWagesCents < 0 ||
      s.federalIncomeTaxWithheldCents < 0 ||
      s.actualEmployeeFicaWithheldCents < 0
    ) {
      refusals.push({
        code: "NEGATIVE_WAGES",
        what: `${s.displayName} has a negative figure in the quarter, which no real quarter produces.`,
        fix:
          `Look at ${s.displayName}'s pay history for this quarter. A negative usually means a ` +
          `correction was entered as a negative paycheque instead of as an adjustment - fix it at ` +
          `the source rather than here.`,
        subjectId: s.subjectId,
      });
    }

    if (s.oasdiTaxableWagesCents > s.wagesCents) {
      refusals.push({
        code: "OASDI_EXCEEDS_WAGES",
        what:
          `${s.displayName} has more wages subject to Social Security ` +
          `(${formatCents(s.oasdiTaxableWagesCents)}) than total wages ` +
          `(${formatCents(s.wagesCents)}), which cannot happen.`,
        fix:
          `Social Security wages are a subset of total wages - the cap can only ever make line 5a ` +
          `smaller than line 2, never larger. Check ${s.displayName}'s year-to-date record for a ` +
          `double-counted pay run.`,
        subjectId: s.subjectId,
      });
    }

    if (s.onPayrollForTwelfthPayPeriod === null) {
      refusals.push({
        code: "TWELFTH_DAY_UNKNOWN",
        what:
          `Nobody has recorded whether ${s.displayName} was on the payroll for the pay period ` +
          `containing ${twelfthDayFor(req.quarter)}.`,
        fix:
          `Line 1 of the 941 is a headcount on that one pay period, not a count of everybody paid ` +
          `during the quarter. Answer yes or no for ${s.displayName} and line 1 can be stated. ` +
          `Guessing here is not harmless: line 1 is the figure the IRS matches against the W-2 ` +
          `count in January.`,
        subjectId: s.subjectId,
      });
    }
  }

  if (req.subjects.length === 0) {
    refusals.push({
      code: "NO_SUBJECTS",
      what: `No employees were supplied for ${formatQuarter(req.quarter)}.`,
      fix:
        `If nobody was paid this quarter, that is still a return - 26 CFR 31.6011(a)-1(a)(1) ` +
        `requires one "whether or not wages are paid therein". Use the zero-return option, which ` +
        `states the zeroes deliberately, rather than leaving the quarter unfiled.`,
      subjectId: null,
    });
  }

  // ── Line 7 credibility, before anything is totalled ──────────────────────
  const fractions = fractionsOfCents(req.subjects);
  if (!fractions.withinRounding) {
    refusals.push({
      code: "FRACTIONS_TOO_LARGE",
      what: fractions.plain,
      fix:
        `Do not adjust line 7 to make the form balance. Run the payroll reconciliation for this ` +
        `quarter - it shows the difference per person, largest first - and find the person whose ` +
        `withholding does not match the rate. The usual causes are a rate typed in wrong and a pay ` +
        `run that was posted twice.`,
      subjectId: null,
    });
  }

  if (req.totalDepositsCents === null) {
    refusals.push({
      code: "DEPOSITS_UNKNOWN",
      what:
        `The total deposited for ${formatQuarter(req.quarter)} has not been supplied, so lines 13, ` +
        `14 and 15 cannot be stated.`,
      fix:
        `Supply the quarter's deposit total from the deposit record. It is deliberately not ` +
        `assumed to be zero: assuming zero would turn a fully paid quarter into a balance due for ` +
        `the entire quarter's tax, which is the most alarming possible wrong answer.`,
      subjectId: null,
    });
  }

  if (refusals.length > 0) return { ok: false, refusals };

  // ── Arithmetic. Everything above passed. ─────────────────────────────────
  const { start, end } = quarterDateRange(req.quarter);

  const count = line1EmployeeCount(req.subjects);
  /* istanbul ignore next -- unreachable: TWELFTH_DAY_UNKNOWN refuses above. */
  if (count === null) {
    throw new Error(
      "form-941: line 1 was unknown after validation passed. This is a bug in buildForm941, not " +
        "in the data - the TWELFTH_DAY_UNKNOWN refusal should have caught it.",
    );
  }

  const wages = req.subjects.reduce((a, s) => a + s.wagesCents, 0);
  const fit = req.subjects.reduce((a, s) => a + s.federalIncomeTaxWithheldCents, 0);
  const oasdiBase = req.subjects.reduce((a, s) => a + s.oasdiTaxableWagesCents, 0);
  const medicareBase = req.subjects.reduce((a, s) => a + s.medicareTaxableWagesCents, 0);

  const line5a = applyMilliPct(oasdiBase, OASDI_COMBINED_MILLI_PCT);
  const line5c = applyMilliPct(medicareBase, MEDICARE_COMBINED_MILLI_PCT);
  const line5e = line5a + line5c;
  const line6 = fit + line5a + line5c;
  const line7 = fractions.adjustmentCents;
  const line10 = line6 + line7;
  const line12 = line10;

  const deposits = req.totalDepositsCents;
  const balance = deposits === null ? null : line12 - deposits;

  const lines: Form941Line[] = [
    {
      line: "1",
      caption: "Number of employees who received wages, tips, or other compensation",
      amountCents: count,
      isCount: true,
      derivation:
        `A headcount, not a total. ${count} ${count === 1 ? "person was" : "people were"} on the ` +
        `payroll for the pay period containing ${twelfthDayFor(req.quarter)}. ` +
        `${req.subjects.length} ${req.subjects.length === 1 ? "person" : "people"} appear in this ` +
        `quarter's wage detail; the two numbers are allowed to differ and usually do.`,
    },
    {
      line: "2",
      caption: "Wages, tips, and other compensation",
      amountCents: wages,
      isCount: false,
      derivation:
        `Total wages for the quarter - the same definition as box 1 of the W-2, which is why the ` +
        `four quarterly returns have to agree with January's W-2s.`,
    },
    {
      line: "3",
      caption: "Federal income tax withheld from wages, tips, and other compensation",
      amountCents: fit,
      isCount: false,
      derivation:
        `Added up from the paycheques. This one cannot be recomputed from a rate: income tax ` +
        `withholding depends on each person's W-4, so the payroll record is the only source.`,
    },
    {
      line: "5a",
      caption: "Taxable social security wages x 0.124",
      amountCents: line5a,
      isCount: false,
      derivation:
        `${formatCents(oasdiBase)} of Social Security wages x 12.4% = ${formatCents(line5a)}. ` +
        `The 12.4% is both halves together - Greenway's and the employees' - which is why this is ` +
        `larger than what came out of the paycheques.`,
    },
    {
      line: "5c",
      caption: "Taxable Medicare wages & tips x 0.029",
      amountCents: line5c,
      isCount: false,
      derivation:
        `${formatCents(medicareBase)} of Medicare wages x 2.9% = ${formatCents(line5c)}. Both ` +
        `halves again. Medicare has no wage ceiling, so this base never stops growing.`,
    },
    {
      line: "5e",
      caption: "Total social security and Medicare taxes",
      amountCents: line5e,
      isCount: false,
      derivation: `${formatCents(line5a)} + ${formatCents(line5c)} = ${formatCents(line5e)}.`,
    },
    {
      line: "6",
      caption: "Total taxes before adjustments",
      amountCents: line6,
      isCount: false,
      derivation:
        `Line 3 + line 5a + line 5c = ${formatCents(fit)} + ${formatCents(line5a)} + ` +
        `${formatCents(line5c)} = ${formatCents(line6)}.`,
    },
    {
      line: "7",
      caption: "Current quarter's adjustment for fractions of cents",
      amountCents: line7,
      isCount: false,
      derivation: fractions.plain,
    },
    {
      line: "10",
      caption: "Total taxes after adjustments",
      amountCents: line10,
      isCount: false,
      derivation: `Line 6 + line 7 = ${formatCents(line6)} + ${formatCents(line7)} = ${formatCents(line10)}.`,
    },
    {
      line: "12",
      caption: "Total taxes after adjustments and nonrefundable credits",
      amountCents: line12,
      isCount: false,
      derivation:
        `Same as line 10 - Greenway claims no payroll tax credits. This is the figure the quarter's ` +
        `deposits are measured against, and the figure Schedule B's daily liabilities must add to.`,
    },
  ];

  if (deposits !== null) {
    lines.push({
      line: "13",
      caption: "Total deposits for this quarter",
      amountCents: deposits,
      isCount: false,
      derivation: `From the deposit record for ${formatQuarter(req.quarter)}.`,
    });
    if (balance !== null && balance > 0) {
      lines.push({
        line: "14",
        caption: "Balance due",
        amountCents: balance,
        isCount: false,
        derivation:
          `Line 12 - line 13 = ${formatCents(line12)} - ${formatCents(deposits)} = ` +
          `${formatCents(balance)} still owed.`,
      });
    } else if (balance !== null && balance < 0) {
      lines.push({
        line: "15",
        caption: "Overpayment",
        amountCents: -balance,
        isCount: false,
        derivation:
          `Line 13 - line 12 = ${formatCents(deposits)} - ${formatCents(line12)} = ` +
          `${formatCents(-balance)} overpaid. Choose on the form whether it is refunded or applied ` +
          `to the next quarter.`,
      });
    }
  }

  const due = form941DueDates(req.quarter);

  const verdict =
    balance === null
      ? `${formatQuarter(req.quarter)}: ${formatCents(line12)} of federal tax on ` +
        `${formatCents(wages)} of wages. Due ${due.ordinary}.`
      : balance === 0
        ? `${formatQuarter(req.quarter)} is fully paid. ${formatCents(line12)} of tax, ` +
          `${formatCents(deposits ?? 0)} deposited, nothing owed. Due ${due.ordinary}.`
        : balance > 0
          ? `${formatQuarter(req.quarter)} has ${formatCents(balance)} still owed. ` +
            `${formatCents(line12)} of tax against ${formatCents(deposits ?? 0)} deposited. ` +
            `Due ${due.ordinary}.`
          : `${formatQuarter(req.quarter)} was overpaid by ${formatCents(-balance)}. ` +
            `${formatCents(line12)} of tax against ${formatCents(deposits ?? 0)} deposited. ` +
            `Due ${due.ordinary}.`;

  return {
    ok: true,
    quarter: req.quarter,
    quarterLabel: formatQuarter(req.quarter),
    periodStart: start,
    periodEnd: end,
    due,
    lines,
    fractions,
    totalTaxCents: line12,
    totalDepositsCents: deposits,
    balanceDueCents: balance,
    subjectCount: req.subjects.length,
    sourceLabel: req.sourceLabel,
    verdict,
  };
}
