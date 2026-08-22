/**
 * SICK LEAVE CORE - accrual, balance, requests, award-beyond-accrued, and the
 * rate sick leave is actually paid at.
 *
 * books-33. Michael's instruction for this slice, verbatim: "I also need a way
 * to allow me to award more sick time hours than the employee has accrued. I
 * like to treat my employees as good as possible, and this really makes them
 * respect me which in turn makes them work harder for me."
 *
 * That sentence is a feature request AND a compliance trap, and the trap is
 * worth naming before any code appears.
 *
 * Washington makes an employer carry over up to forty unused hours into the
 * next year (WAC 296-128-620(4)). If Michael's gifted hours are pooled with
 * statutory hours and the employee never uses them, those gifts inflate the
 * balance he is legally required to carry, forever, compounding every year. A
 * generous employer would be punished by his own generosity, and he would not
 * find out for years.
 *
 * The fix is not to refuse the gift. The fix is to remember WHICH BUCKET each
 * hour came from and to SPEND THE STATUTORY HOURS FIRST, so that what survives
 * to year end is the gift, and the gift can lapse without touching the
 * employee's statutory entitlement. That is what `drawn_from` in
 * sick_leave_ledger records and what `planDraw` below computes. Michael gets
 * to be generous; the generosity does not silently become a permanent
 * liability.
 *
 * WHAT THIS FILE IS NOT. It does not read the database and it does not write
 * one. Every function is pure: facts in, answer or refusal out. That is what
 * lets the tests drive it with the regulation's own numbers instead of a
 * fixture nobody can check.
 *
 * STANDING RULE 25 - EXTEND, DO NOT DUPLICATE. The per-hour accrual primitive
 * and the forty-hour carryover cap ALREADY EXIST in
 * src/lib/staffing/employee-lifecycle-core.ts, where the new-hire checklist
 * uses them. They are imported here, not re-typed. A second copy of the
 * accrual rule would be a second thing to get wrong when the law changes.
 *
 * STANDING RULE 62d - NEVER INVENT A DEFAULT. Every policy figure arrives as a
 * nullable field from sick_leave_policy, and NULL means UNANSWERED. A missing
 * accrual rate does not quietly become the statutory minimum, because "we
 * accrue at the legal floor" is a decision Michael has to make and be able to
 * point at later, not something this file assumes on his behalf.
 */

import {
  sickLeaveAccruedMinutes,
  SICK_LEAVE_CARRYOVER_CAP_MINUTES,
  minutesLabel,
} from "../staffing/employee-lifecycle-core";

// Re-exported so callers of the sick-leave engine do not have to know that the
// primitive lives in the staffing module. Re-export, NOT redefinition: there is
// still exactly one implementation.
export { sickLeaveAccruedMinutes, SICK_LEAVE_CARRYOVER_CAP_MINUTES, minutesLabel };

// ===========================================================================
// 1) STATUTORY CONSTANTS
//
// Held as named constants with the citation attached, so that a reader can
// check the number against the law without leaving the file, and so a future
// change is a one-line edit with an obvious blast radius.
// ===========================================================================

/**
 * The statutory MINIMUM accrual rate, in hundredths of a minute of leave per
 * hour worked.
 *
 * WAC 296-128-620(1): "at least one hour of paid sick leave for every forty
 * hours worked". One hour per forty hours is sixty minutes per forty hours,
 * which is 1.5 minutes per hour, which is 150 hundredths of a minute per hour.
 *
 * Hundredths rather than whole minutes because 1.5 is not an integer, and an
 * accrual engine that rounds the RATE before it multiplies loses real hours
 * over a year.
 */
export const STATUTORY_ACCRUAL_HUNDREDTH_MINUTES_PER_HOUR = 150;

/**
 * The latest day an employer may withhold USE of accrued leave.
 *
 * WAC 296-128-630(2) ties this to the ninetieth calendar day after the start of
 * employment. Accrual itself starts on day one; only USE waits.
 */
export const STATUTORY_USABLE_AFTER_DAYS = 90;

/**
 * The shortest absence for which verification may ever be demanded.
 *
 * WAC 296-128-660(1) permits verification only for absences EXCEEDING three
 * days. Exceeding three is four, so four is the floor. A policy that asked for
 * a doctor's note on day three would be unlawful, which is why the database
 * refuses anything below this and why the engine checks it again here rather
 * than trusting that the row was written by our own code.
 */
export const STATUTORY_VERIFICATION_MINIMUM_DAYS = 4;

/**
 * The largest usage increment an employer may impose without a variance.
 * WAC 296-128-630(4) caps increments at one hour.
 */
export const STATUTORY_MAX_USAGE_INCREMENT_MINUTES = 60;

// ===========================================================================
// 2) INPUT SHAPES - mirrors of the 0198 tables, in TypeScript
//
// These deliberately match the column names and NULLABILITY of the migration.
// Where the database says "nullable, no default", the type says `| null`, so
// that an unanswered policy question is impossible to overlook at a call site:
// TypeScript will not let it be read as a number.
// ===========================================================================

/** A row of public.sick_leave_policy. Every answer may be missing. */
export type SickLeavePolicy = {
  readonly accrualHundredthMinutesPerHour: number | null;
  readonly carryoverCapMinutes: number | null;
  readonly usableAfterDays: number | null;
  readonly usageIncrementMinutes: number | null;
  readonly verificationAfterDays: number | null;
  readonly verificationRequired: boolean | null;
};

/** Which bucket an hour of leave came out of. Mirrors ledger.drawn_from. */
export type SickLeaveBucket = "statutory" | "awarded";

/** Mirrors sick_leave_ledger.entry_kind. */
export type SickLeaveEntryKind =
  | "accrual"
  | "award"
  | "carry_in"
  | "reinstate"
  | "usage"
  | "forfeit"
  | "payout"
  | "correction";

/** One row of public.sick_leave_ledger, as the engine needs to see it. */
export type SickLeaveLedgerEntry = {
  readonly id: string;
  readonly entryKind: SickLeaveEntryKind;
  /** Signed whole minutes, never zero. Positive adds, negative reduces. */
  readonly minutes: number;
  /** Set on usage entries only - which bucket the minutes came out of. */
  readonly drawnFrom: SickLeaveBucket | null;
  readonly effectiveDate: string; // YYYY-MM-DD
};

/** Mirrors sick_leave_requests.purpose. */
export type SickLeavePurpose =
  | "own_health"
  | "family_care"
  | "closure"
  | "immigration"
  | "domestic_violence";

/** Mirrors sick_leave_requests.notice_kind. */
export type SickLeaveNoticeKind = "foreseeable" | "unforeseeable";

/** A request as submitted, before anyone has decided it. */
export type SickLeaveRequestFacts = {
  readonly employeeId: string;
  readonly purpose: SickLeavePurpose;
  readonly noticeKind: SickLeaveNoticeKind;
  /** First calendar day of absence. */
  readonly startDate: string; // YYYY-MM-DD
  /** Last calendar day of absence. Same as startDate for a single day. */
  readonly endDate: string; // YYYY-MM-DD
  /** Whole minutes of leave being asked for. */
  readonly requestedMinutes: number;
  /** The day the request was actually submitted. Drives the notice test. */
  readonly submittedOn: string; // YYYY-MM-DD
};

// ===========================================================================
// 3) REFUSALS
//
// STANDING RULE 43: a refusal code no path emits is decoration. Every code in
// this union is emitted by a function in this file, and
// tests/compliance/sick-leave-core.test.ts asserts that fact code by code
// rather than trusting the list.
// ===========================================================================

export type SickLeaveRefusalCode =
  | "NO_ACCRUAL_RATE_ON_FILE"
  | "ACCRUAL_RATE_BELOW_STATUTORY_FLOOR"
  | "NO_CARRYOVER_CAP_ON_FILE"
  | "CARRYOVER_CAP_BELOW_STATUTORY_FLOOR"
  | "NO_USABLE_AFTER_ANSWER"
  | "NO_USAGE_INCREMENT_ON_FILE"
  | "USAGE_INCREMENT_ABOVE_ONE_HOUR"
  | "VERIFICATION_THRESHOLD_UNLAWFUL"
  | "VERIFICATION_POLICY_UNANSWERED"
  | "NOT_YET_USABLE"
  | "REQUEST_DATES_BACKWARD"
  | "REQUEST_NOT_A_POSITIVE_AMOUNT"
  | "REQUEST_NOT_IN_INCREMENT"
  | "INSUFFICIENT_BALANCE"
  | "AWARD_NOT_POSITIVE"
  | "AWARD_WITHOUT_REASON"
  | "NO_MINIMUM_WAGE_FOR_DATE"
  | "NO_NORMAL_HOURLY_RATE";

export type SickLeaveRefusal = {
  readonly code: SickLeaveRefusalCode;
  /** Plain English. Michael reads this verbatim on screen. */
  readonly message: string;
  /** The single concrete action that unblocks it. Never "contact support". */
  readonly fix: string;
  /** Citations, for the mentor layer to expand. */
  readonly authorityIds: readonly string[];
};

export type SickLeaveResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusals: readonly SickLeaveRefusal[] };

function refuse(
  code: SickLeaveRefusalCode,
  message: string,
  fix: string,
  authorityIds: readonly string[] = [],
): SickLeaveRefusal {
  return { code, message, fix, authorityIds };
}

// ===========================================================================
// 4) POLICY VALIDATION
//
// Called before anything else. The point is that an unanswered or unlawful
// policy produces a NAMED refusal that says which question is unanswered,
// rather than an accrual of zero that looks like an employee who never worked.
//
// STANDING RULE 64a - DETECTION IS NOT EXPLANATION. Each message says what is
// wrong, what the law requires, and what to type to fix it.
// ===========================================================================

export function validatePolicy(policy: SickLeavePolicy): SickLeaveResult<true> {
  const refusals: SickLeaveRefusal[] = [];

  if (policy.accrualHundredthMinutesPerHour === null) {
    refusals.push(
      refuse(
        "NO_ACCRUAL_RATE_ON_FILE",
        "Nobody has recorded how fast sick leave accrues at Greenway, so I cannot work out what anyone has earned. I am not assuming the legal minimum, because accruing at the floor is a decision you make, not one I make for you.",
        "Open Payroll to Sick leave policy and set the accrual rate. The legal minimum is one hour of leave for every forty hours worked; you may be more generous.",
        ["wac-296-128-620-accrual"],
      ),
    );
  } else if (
    policy.accrualHundredthMinutesPerHour < STATUTORY_ACCRUAL_HUNDREDTH_MINUTES_PER_HOUR
  ) {
    refusals.push(
      refuse(
        "ACCRUAL_RATE_BELOW_STATUTORY_FLOOR",
        `The accrual rate on file is slower than Washington allows. The law sets a floor of one hour of paid sick leave for every forty hours worked, and the rate recorded is below it.`,
        "Raise the accrual rate to at least one hour per forty hours worked. A rate below the floor underpays every employee every period and is a wage claim waiting to happen.",
        ["wac-296-128-620-accrual"],
      ),
    );
  }

  if (policy.carryoverCapMinutes === null) {
    refusals.push(
      refuse(
        "NO_CARRYOVER_CAP_ON_FILE",
        "Nobody has recorded how much unused sick leave carries into the next year. I will not guess: leaving this blank is not the same as unlimited carryover, and treating it as unlimited would quietly create a liability you never agreed to.",
        "Set the carryover cap in the sick leave policy. Forty hours is the legal minimum you must allow; enter a larger number if you want to be more generous, or forty to match the law.",
        ["wac-296-128-620-carryover"],
      ),
    );
  } else if (policy.carryoverCapMinutes < SICK_LEAVE_CARRYOVER_CAP_MINUTES) {
    refusals.push(
      refuse(
        "CARRYOVER_CAP_BELOW_STATUTORY_FLOOR",
        "The carryover cap on file is smaller than the forty hours Washington requires you to carry over. A cap below forty hours takes leave away from employees that the law says they keep.",
        "Raise the carryover cap to at least forty hours (2,400 minutes).",
        ["wac-296-128-620-carryover"],
      ),
    );
  }

  if (policy.usableAfterDays === null) {
    refusals.push(
      refuse(
        "NO_USABLE_AFTER_ANSWER",
        "Nobody has recorded how long a new employee waits before they can USE accrued sick leave. Leave still accrues from day one either way; this is only about when it can be spent.",
        "Set the waiting period in the sick leave policy. Ninety calendar days is the longest the law allows; zero is lawful and more generous.",
        ["wac-296-128-630-usable"],
      ),
    );
  }

  if (policy.usageIncrementMinutes === null) {
    refusals.push(
      refuse(
        "NO_USAGE_INCREMENT_ON_FILE",
        "Nobody has recorded the smallest slice of sick leave an employee may take, so I cannot tell whether a request for twenty minutes is allowed.",
        "Set the usage increment in the sick leave policy. Fifteen minutes is common; one hour is the largest the law permits.",
        ["wac-296-128-630-increment"],
      ),
    );
  } else if (policy.usageIncrementMinutes > STATUTORY_MAX_USAGE_INCREMENT_MINUTES) {
    refusals.push(
      refuse(
        "USAGE_INCREMENT_ABOVE_ONE_HOUR",
        "The usage increment on file is larger than one hour. Washington does not let an employer force sick leave to be taken in blocks bigger than an hour without a variance, so an employee who needs forty minutes off would be charged more leave than they used.",
        "Lower the usage increment to one hour or less.",
        ["wac-296-128-630-increment"],
      ),
    );
  }

  // The two verification fields are checked TOGETHER, because "we may ask after
  // four days" and "we do ask" are different facts and only the combination is
  // meaningful.
  if (policy.verificationRequired === null) {
    refusals.push(
      refuse(
        "VERIFICATION_POLICY_UNANSWERED",
        "Nobody has recorded whether Greenway asks for verification of a long absence. Blank is not the same as no.",
        "Answer yes or no in the sick leave policy. If yes, the law also requires a WRITTEN policy given to employees before you may ask for anything.",
        ["wac-296-128-660-verification"],
      ),
    );
  } else if (policy.verificationRequired) {
    if (policy.verificationAfterDays === null) {
      refusals.push(
        refuse(
          "VERIFICATION_POLICY_UNANSWERED",
          "The policy says Greenway requires verification for long absences, but does not say after how many days, so nobody can tell when it applies.",
          "Set the verification threshold. It must be more than three days.",
          ["wac-296-128-660-verification"],
        ),
      );
    } else if (policy.verificationAfterDays < STATUTORY_VERIFICATION_MINIMUM_DAYS) {
      refusals.push(
        refuse(
          "VERIFICATION_THRESHOLD_UNLAWFUL",
          "The policy asks for verification sooner than the law allows. Washington permits verification only for absences EXCEEDING three days, so the earliest lawful threshold is the fourth day.",
          "Raise the verification threshold to four days or more.",
          ["wac-296-128-660-verification"],
        ),
      );
    }
  }

  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, value: true };
}

// ===========================================================================
// 5) ACCRUAL - with the remainder carried, not thrown away
//
// THE BUG THIS AVOIDS. Accrual is 1.5 minutes per hour worked. An employee who
// works 35 hours in a week earns 52.5 minutes. Round that down to 52 every
// period and you have quietly stolen half a minute; do it twenty-six times a
// year, for years, and the employee is short real hours while every individual
// period looks defensible.
//
// So accrual is computed in HUNDREDTHS of a minute, whole minutes are credited
// to the ledger, and the remainder is handed back to the caller to store and
// pass in next period. Nothing is lost, and nothing is invented either.
// ===========================================================================

export type AccrualResult = {
  /** Whole minutes to write to the ledger as an `accrual` entry. */
  readonly minutesToCredit: number;
  /** Fractional remainder to store and pass back in as carryIn next period. */
  readonly remainderHundredthMinutes: number;
  /** Plain-English arithmetic, for the pay stub and the owner report. */
  readonly explanation: string;
};

/**
 * Accrue leave for one pay period.
 *
 * @param workedHundredthHours Hours ACTUALLY WORKED, in hundredths of an hour,
 *   which is the unit timesheet-core already speaks. Sick hours themselves are
 *   NOT hours worked and must not be included by the caller - see
 *   `hoursThatCountTowardAccrual` below, which enforces that.
 * @param carryInHundredthMinutes The remainder from last period. Zero on the
 *   very first period.
 */
export function accrueForPeriod(
  workedHundredthHours: number,
  policy: SickLeavePolicy,
  carryInHundredthMinutes = 0,
): SickLeaveResult<AccrualResult> {
  const rate = policy.accrualHundredthMinutesPerHour;
  if (rate === null) {
    return {
      ok: false,
      refusals: [
        refuse(
          "NO_ACCRUAL_RATE_ON_FILE",
          "I cannot accrue sick leave for this period because no accrual rate is on file. I am refusing rather than crediting zero, because zero looks exactly like an employee who did not work.",
          "Set the accrual rate in the sick leave policy, then re-run this pay period.",
          ["wac-296-128-620-accrual"],
        ),
      ],
    };
  }
  if (rate < STATUTORY_ACCRUAL_HUNDREDTH_MINUTES_PER_HOUR) {
    return {
      ok: false,
      refusals: [
        refuse(
          "ACCRUAL_RATE_BELOW_STATUTORY_FLOOR",
          "I cannot accrue at the rate on file because it is below the Washington minimum of one hour per forty hours worked.",
          "Raise the accrual rate to at least one hour per forty hours worked.",
          ["wac-296-128-620-accrual"],
        ),
      ],
    };
  }

  const worked = Number.isFinite(workedHundredthHours) && workedHundredthHours > 0
    ? Math.floor(workedHundredthHours)
    : 0;
  const carry = Number.isFinite(carryInHundredthMinutes) && carryInHundredthMinutes > 0
    ? Math.floor(carryInHundredthMinutes)
    : 0;

  // worked is hundredth-hours; rate is hundredth-minutes per hour.
  // hundredth-minutes earned = workedHundredthHours * rate / 100.
  const earnedHundredthMinutes = Math.floor((worked * rate) / 100) + carry;
  const minutesToCredit = Math.floor(earnedHundredthMinutes / 100);
  const remainderHundredthMinutes = earnedHundredthMinutes - minutesToCredit * 100;

  const hoursWorkedLabel = (worked / 100).toFixed(2);
  const explanation =
    `${hoursWorkedLabel} hours worked at ${(rate / 100).toFixed(2)} minutes of sick leave per hour ` +
    `earns ${minutesLabel(minutesToCredit)}` +
    (remainderHundredthMinutes > 0
      ? `, with ${(remainderHundredthMinutes / 100).toFixed(2)} of a minute carried into the next period so nothing is lost to rounding.`
      : " exactly, with nothing left over.");

  return { ok: true, value: { minutesToCredit, remainderHundredthMinutes, explanation } };
}

/**
 * Hours that count toward ACCRUAL.
 *
 * Sick leave does not accrue on sick leave. WAC 296-128-620(1) accrues leave
 * "for every forty hours worked", and paid leave is not hours worked. This
 * helper exists so the exclusion is a named, tested function rather than a
 * subtraction someone might forget at one of several call sites.
 */
export function hoursThatCountTowardAccrual(args: {
  readonly totalPaidHundredthHours: number;
  readonly sickHundredthHours: number;
}): number {
  const total = Math.max(0, Math.floor(args.totalPaidHundredthHours));
  const sick = Math.max(0, Math.floor(args.sickHundredthHours));
  return Math.max(0, total - sick);
}

// ===========================================================================
// 6) BALANCE, SPLIT BY BUCKET
//
// The whole point of the two buckets is that they are spent in a particular
// order. So the balance is never a single number internally - it is a pair,
// and the single number is only computed for display.
// ===========================================================================

export type SickLeaveBalance = {
  readonly statutoryMinutes: number;
  readonly awardedMinutes: number;
  readonly totalMinutes: number;
};

/**
 * Sum a ledger into the two buckets.
 *
 * Positive kinds land in `statutory` unless they are an `award`, which is the
 * only kind that creates gifted hours. Negative kinds are subtracted from the
 * bucket named in `drawnFrom`, which the database guarantees is present on
 * every usage row.
 *
 * `correction` may be either sign. A correction with no `drawnFrom` is treated
 * as statutory, because that is the bucket the law cares about and putting an
 * unexplained correction in the gifted bucket could understate what the
 * employee is owed.
 */
export function computeBalance(
  entries: readonly SickLeaveLedgerEntry[],
): SickLeaveBalance {
  let statutory = 0;
  let awarded = 0;

  for (const e of entries) {
    if (!Number.isFinite(e.minutes) || e.minutes === 0) continue;

    if (e.entryKind === "award") {
      awarded += e.minutes;
      continue;
    }
    if (e.minutes < 0 || e.entryKind === "usage" || e.entryKind === "forfeit" || e.entryKind === "payout") {
      if (e.drawnFrom === "awarded") awarded += e.minutes;
      else statutory += e.minutes;
      continue;
    }
    statutory += e.minutes;
  }

  return {
    statutoryMinutes: statutory,
    awardedMinutes: awarded,
    totalMinutes: statutory + awarded,
  };
}

// ===========================================================================
// 7) THE DRAW ORDER - statutory hours are spent FIRST
//
// Explained at the top of the file. This is the function that keeps Michael's
// generosity from becoming a permanent carryover liability.
// ===========================================================================

export type DrawPlan = {
  readonly fromStatutoryMinutes: number;
  readonly fromAwardedMinutes: number;
  readonly explanation: string;
};

export function planDraw(
  balance: SickLeaveBalance,
  requestedMinutes: number,
): SickLeaveResult<DrawPlan> {
  if (!Number.isFinite(requestedMinutes) || requestedMinutes <= 0) {
    return {
      ok: false,
      refusals: [
        refuse(
          "REQUEST_NOT_A_POSITIVE_AMOUNT",
          "A sick leave draw has to be for more than zero minutes.",
          "Enter how much time off is being taken.",
        ),
      ],
    };
  }

  const available = Math.max(0, balance.statutoryMinutes) + Math.max(0, balance.awardedMinutes);
  if (requestedMinutes > available) {
    return {
      ok: false,
      refusals: [
        refuse(
          "INSUFFICIENT_BALANCE",
          `This asks for ${minutesLabel(requestedMinutes)} of sick leave but only ${minutesLabel(available)} is available (${minutesLabel(Math.max(0, balance.statutoryMinutes))} earned, ${minutesLabel(Math.max(0, balance.awardedMinutes))} awarded by you).`,
          `If you want to cover it anyway, award the shortfall of ${minutesLabel(requestedMinutes - available)} first - that is what the Award button is for - and the awarded hours will be spent after the earned ones.`,
          ["wac-296-128-620-accrual"],
        ),
      ],
    };
  }

  const fromStatutory = Math.min(Math.max(0, balance.statutoryMinutes), requestedMinutes);
  const fromAwarded = requestedMinutes - fromStatutory;

  const explanation =
    fromAwarded === 0
      ? `All ${minutesLabel(requestedMinutes)} comes out of earned leave.`
      : `${minutesLabel(fromStatutory)} comes out of earned leave first, then ${minutesLabel(fromAwarded)} out of the hours you awarded. Earned hours are always spent first, so the hours you gave are the ones left at year end - those can lapse, while earned hours you are required to carry over.`;

  return {
    ok: true,
    value: {
      fromStatutoryMinutes: fromStatutory,
      fromAwardedMinutes: fromAwarded,
      explanation,
    },
  };
}

// ===========================================================================
// 8) AWARDING MORE THAN ACCRUED - Michael's explicit ask
// ===========================================================================

export type AwardPlan = {
  readonly minutes: number;
  readonly bucket: "awarded";
  readonly reason: string;
  readonly explanation: string;
};

/**
 * Validate an award of leave the employee has not earned.
 *
 * The reason is REQUIRED and is not ceremony. A positive adjustment with no
 * explanation is indistinguishable from a data-entry error six months later,
 * and it is exactly the sort of thing an auditor asks about. Standing rule 64a.
 */
export function planAward(args: {
  readonly minutes: number;
  readonly reason: string;
}): SickLeaveResult<AwardPlan> {
  const refusals: SickLeaveRefusal[] = [];

  if (!Number.isFinite(args.minutes) || args.minutes <= 0) {
    refusals.push(
      refuse(
        "AWARD_NOT_POSITIVE",
        "An award has to be for more than zero minutes. To take leave away, use a correction instead, so the ledger shows what happened.",
        "Enter how many hours you want to give.",
      ),
    );
  }

  const reason = (args.reason ?? "").trim();
  if (reason.length < 3) {
    refusals.push(
      refuse(
        "AWARD_WITHOUT_REASON",
        "An award of sick leave needs a reason written down. Six months from now, a row that says plus eight hours and nothing else cannot be told apart from a typing mistake.",
        'Write a short reason, for example "covered his shift when his kid was sick".',
      ),
    );
  }

  if (refusals.length > 0) return { ok: false, refusals };

  return {
    ok: true,
    value: {
      minutes: Math.floor(args.minutes),
      bucket: "awarded",
      reason,
      explanation: `${minutesLabel(Math.floor(args.minutes))} awarded on top of what was earned. It goes into a separate bucket and is spent only after earned leave runs out, so it does not increase what you are required to carry over at year end.`,
    },
  };
}

// ===========================================================================
// 9) REQUEST VALIDATION
// ===========================================================================

function daysInclusive(startYmd: string, endYmd: string): number {
  const a = Date.UTC(
    Number(startYmd.slice(0, 4)),
    Number(startYmd.slice(5, 7)) - 1,
    Number(startYmd.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(endYmd.slice(0, 4)),
    Number(endYmd.slice(5, 7)) - 1,
    Number(endYmd.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000) + 1;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return daysInclusive(fromYmd, toYmd) - 1;
}

export type RequestReview = {
  readonly draw: DrawPlan;
  /** Days of absence, inclusive of both ends. */
  readonly absenceDays: number;
  /**
   * TRUE when the policy permits asking for a doctor's note. This is a
   * PERMISSION, not an obstacle: the leave is still owed, and the law forbids
   * making verification a precondition of taking the time off.
   */
  readonly verificationMayBeRequested: boolean;
  /** Days of notice actually given. Negative means notice after the fact. */
  readonly noticeDaysGiven: number;
  /**
   * Set when foreseeable leave was requested with less than ten days' notice.
   * INFORMATIONAL ONLY. Short notice does not forfeit the leave.
   */
  readonly noticeShortfallNote: string | null;
  readonly explanation: string;
};

/**
 * Review a request against the policy and the balance.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not refuse for short notice.
 * WAC 296-128-650 requires an employee to give notice where the need is
 * foreseeable, but the remedy for late notice is not confiscating the leave,
 * and a system that auto-denied on notice would generate unlawful denials at
 * scale. Short notice is surfaced as a NOTE for Michael to weigh, which is the
 * distinction between an engine that assists and one that decides.
 */
export function reviewRequest(args: {
  readonly request: SickLeaveRequestFacts;
  readonly policy: SickLeavePolicy;
  readonly balance: SickLeaveBalance;
  /** Employee's first day. Drives the ninety-day usability test. */
  readonly hireDate: string; // YYYY-MM-DD
}): SickLeaveResult<RequestReview> {
  const { request, policy, balance } = args;
  const refusals: SickLeaveRefusal[] = [];

  if (daysInclusive(request.startDate, request.endDate) < 1) {
    refusals.push(
      refuse(
        "REQUEST_DATES_BACKWARD",
        "This request ends before it starts, so I cannot tell how long the absence is.",
        "Check the first and last day of the absence.",
      ),
    );
    return { ok: false, refusals };
  }

  if (!Number.isFinite(request.requestedMinutes) || request.requestedMinutes <= 0) {
    refusals.push(
      refuse(
        "REQUEST_NOT_A_POSITIVE_AMOUNT",
        "This request does not say how much time off is being taken.",
        "Enter the number of hours.",
      ),
    );
  }

  if (policy.usableAfterDays === null) {
    refusals.push(
      refuse(
        "NO_USABLE_AFTER_ANSWER",
        "I cannot tell whether this employee is allowed to use sick leave yet, because nobody has recorded the waiting period.",
        "Set the waiting period in the sick leave policy. Ninety days is the legal maximum.",
        ["wac-296-128-630-usable"],
      ),
    );
  } else {
    const daysEmployed = daysBetween(args.hireDate, request.startDate);
    if (daysEmployed < policy.usableAfterDays) {
      refusals.push(
        refuse(
          "NOT_YET_USABLE",
          `This employee has been here ${daysEmployed} days and the policy makes leave usable after ${policy.usableAfterDays}. The leave is still accruing and is not lost - it just cannot be spent yet.`,
          `Either wait until day ${policy.usableAfterDays}, or award the time so it can be paid now. Awarding is the normal way to cover someone early.`,
          ["wac-296-128-630-usable"],
        ),
      );
    }
  }

  if (policy.usageIncrementMinutes === null) {
    refusals.push(
      refuse(
        "NO_USAGE_INCREMENT_ON_FILE",
        "I cannot check this request against the smallest allowed slice of leave, because no usage increment is on file.",
        "Set the usage increment in the sick leave policy.",
        ["wac-296-128-630-increment"],
      ),
    );
  } else if (
    request.requestedMinutes > 0 &&
    request.requestedMinutes % policy.usageIncrementMinutes !== 0
  ) {
    refusals.push(
      refuse(
        "REQUEST_NOT_IN_INCREMENT",
        `This asks for ${minutesLabel(request.requestedMinutes)}, but sick leave here is taken in ${minutesLabel(policy.usageIncrementMinutes)} steps.`,
        `Round the request to a multiple of ${minutesLabel(policy.usageIncrementMinutes)}, or lower the increment in the policy.`,
        ["wac-296-128-630-increment"],
      ),
    );
  }

  if (refusals.length > 0) return { ok: false, refusals };

  const draw = planDraw(balance, request.requestedMinutes);
  if (!draw.ok) return draw;

  const absenceDays = daysInclusive(request.startDate, request.endDate);
  const verificationMayBeRequested =
    policy.verificationRequired === true &&
    policy.verificationAfterDays !== null &&
    absenceDays > policy.verificationAfterDays - 1 &&
    absenceDays >= STATUTORY_VERIFICATION_MINIMUM_DAYS;

  const noticeDaysGiven = daysBetween(request.submittedOn, request.startDate);
  const noticeShortfallNote =
    request.noticeKind === "foreseeable" && noticeDaysGiven < 10
      ? `This was marked foreseeable but came with ${noticeDaysGiven} days' notice rather than ten. Worth a word, but it does not cost them the leave - short notice is not a lawful reason to deny paid sick leave.`
      : null;

  const explanation =
    `${draw.value.explanation} ` +
    (verificationMayBeRequested
      ? `The absence is ${absenceDays} days, which is long enough that your written policy lets you ask for verification. You cannot make the note a condition of taking the time, and if getting one costs the employee money you may have to cover it.`
      : `At ${absenceDays} day${absenceDays === 1 ? "" : "s"} this is too short to ask for a doctor's note.`);

  return {
    ok: true,
    value: {
      draw: draw.value,
      absenceDays,
      verificationMayBeRequested,
      noticeDaysGiven,
      noticeShortfallNote,
      explanation,
    },
  };
}

// ===========================================================================
// 10) THE RATE SICK LEAVE IS PAID AT
//
// WAC 296-128-670(1): "For each hour of paid sick leave used, an employee must
// be paid the greater of the minimum hourly wage rate established by RCW
// 49.46.020 or their normal hourly compensation."
//
// GREATER OF. Not "their rate". For anyone at Greenway earning above minimum
// wage the two are the same number, which is exactly why this is easy to get
// wrong and never notice - until the year someone is hired at the floor and
// the floor moves mid-year.
//
// The minimum wage is NOT hardcoded here. It comes from the dated rate
// registry, which already refuses for any date it has no announcement for -
// including every date in 2027 until L&I publishes on September 30 2026. This
// function passes that refusal straight through rather than substituting the
// 2026 figure.
// ===========================================================================

export type SickPayRate = {
  readonly rateMilliCentsPerHour: number;
  readonly basis: "normal_hourly_compensation" | "minimum_wage_floor";
  readonly explanation: string;
};

export function sickLeaveRateOfPay(args: {
  /** The employee's normal hourly compensation, thousandths of a cent. */
  readonly normalHourlyMilliCents: number | null;
  /**
   * The Washington minimum wage on the date the leave was used, thousandths of
   * a cent, or a refusal from the rate registry when the date is not evidenced.
   */
  readonly minimumWage:
    | { readonly ok: true; readonly value: number }
    | { readonly ok: false; readonly refusal: { readonly message: string; readonly whatToDo: string } };
  readonly usedOn: string; // YYYY-MM-DD, for the message
}): SickLeaveResult<SickPayRate> {
  if (!args.minimumWage.ok) {
    return {
      ok: false,
      refusals: [
        refuse(
          "NO_MINIMUM_WAGE_FOR_DATE",
          `I cannot price sick leave used on ${args.usedOn}, because sick leave must be paid at the GREATER of the employee's normal rate or the Washington minimum wage, and I have no evidenced minimum wage for that date. ${args.minimumWage.refusal.message}`,
          args.minimumWage.refusal.whatToDo,
          ["wac-296-128-670-rate", "rcw-49-46-020-minimum-wage"],
        ),
      ],
    };
  }

  if (args.normalHourlyMilliCents === null || args.normalHourlyMilliCents <= 0) {
    return {
      ok: false,
      refusals: [
        refuse(
          "NO_NORMAL_HOURLY_RATE",
          "This employee has no hourly rate on file, so I cannot work out their normal hourly compensation and cannot compare it to the minimum wage.",
          "Set the employee's pay rate on their payroll setup, then approve the sick time again.",
          ["wac-296-128-670-rate"],
        ),
      ],
    };
  }

  const mw = args.minimumWage.value;
  const normal = args.normalHourlyMilliCents;

  if (normal >= mw) {
    return {
      ok: true,
      value: {
        rateMilliCentsPerHour: normal,
        basis: "normal_hourly_compensation",
        explanation: `Paid at their normal rate of ${formatMilliCents(normal)} an hour, which is at or above the ${formatMilliCents(mw)} minimum wage in force on ${args.usedOn}.`,
      },
    };
  }

  return {
    ok: true,
    value: {
      rateMilliCentsPerHour: mw,
      basis: "minimum_wage_floor",
      explanation: `Paid at the minimum wage of ${formatMilliCents(mw)} an hour rather than their recorded ${formatMilliCents(normal)}, because sick leave must be paid at the GREATER of the two. This is a legal floor, not a raise - their worked hours are a separate question, and a rate below minimum wage for worked time needs looking at.`,
    },
  };
}

/** Thousandths of a cent to "$17.13". */
export function formatMilliCents(milliCents: number): string {
  return `$${(milliCents / 100_000).toFixed(2)}`;
}

/** What the sick hours are worth, in whole cents, rounded half up. */
export function sickLeavePayCents(minutes: number, rateMilliCentsPerHour: number): number {
  const m = Math.max(0, Math.floor(minutes));
  // minutes * rate/60 milli-cents, then milli-cents to cents.
  const milliCents = (m * rateMilliCentsPerHour) / 60;
  return Math.round(milliCents / 1000);
}

// ===========================================================================
// 11) THE OVERTIME INTERACTION - Michael asked about this by name
//
// His words: "If sick time used pushes the total hours for the week over 40,
// they do not get paid over time for that sick time. Over time is based on
// regular hours only."
//
// He is right, and the law is unusually blunt about it. 29 CFR 778.218(a) says
// payments for idle hours "are not made as compensation for his hours of
// employment" and that "no part of such payments may be credited toward
// overtime compensation due under the Act."
//
// Two separate consequences, and systems routinely get the first right and the
// second wrong:
//
//   1. Sick hours do not COUNT toward the forty-hour threshold. Thirty-six
//      worked plus eight sick is forty-four paid hours and ZERO overtime.
//   2. Sick pay does not enter the REGULAR RATE used to price the premium.
//
// This function answers (1) and is the only place the threshold question is
// answered for a week containing leave, so there is one place to test and one
// place to be wrong.
// ===========================================================================

export type WeekOvertimeSplit = {
  readonly workedHundredthHours: number;
  readonly sickHundredthHours: number;
  readonly regularHundredthHours: number;
  readonly overtimeHundredthHours: number;
  readonly totalPaidHundredthHours: number;
  readonly explanation: string;
};

export function splitWeekWithSickLeave(args: {
  readonly workedHundredthHours: number;
  readonly sickHundredthHours: number;
  /** 4000 = forty hours. Passed in so the threshold is data, not a literal. */
  readonly overtimeThresholdHundredthHours: number;
}): WeekOvertimeSplit {
  const worked = Math.max(0, Math.floor(args.workedHundredthHours));
  const sick = Math.max(0, Math.floor(args.sickHundredthHours));
  const threshold = Math.max(0, Math.floor(args.overtimeThresholdHundredthHours));

  // ONLY worked hours are tested against the threshold. This single line is the
  // whole rule, and it is the line that would otherwise be `worked + sick`.
  const overtime = Math.max(0, worked - threshold);
  const regular = worked - overtime;

  const explanation =
    sick === 0
      ? `${(worked / 100).toFixed(2)} hours worked, ${(overtime / 100).toFixed(2)} of them overtime.`
      : `${(worked / 100).toFixed(2)} hours worked plus ${(sick / 100).toFixed(2)} hours of sick leave is ${((worked + sick) / 100).toFixed(2)} paid hours, but overtime is counted on WORKED hours only, so overtime is ${(overtime / 100).toFixed(2)} hours` +
        (worked <= threshold && worked + sick > threshold
          ? ` - none. The sick hours pushed the paid total over forty without triggering any overtime, which is correct: paid leave is not hours worked and cannot be credited toward overtime.`
          : `.`);

  return {
    workedHundredthHours: worked,
    sickHundredthHours: sick,
    regularHundredthHours: regular,
    overtimeHundredthHours: overtime,
    totalPaidHundredthHours: worked + sick,
    explanation,
  };
}

// ===========================================================================
// 12) YEAR-END CARRYOVER
//
// WAC 296-128-620(4) makes at least forty hours carry over. (5) permits a cap.
// The gifted bucket is capped SEPARATELY and forfeits first, which is the
// payoff for the draw order in section 7.
// ===========================================================================

export type CarryoverPlan = {
  readonly carriedStatutoryMinutes: number;
  readonly carriedAwardedMinutes: number;
  readonly forfeitedStatutoryMinutes: number;
  readonly forfeitedAwardedMinutes: number;
  readonly explanation: string;
};

export function planYearEndCarryover(args: {
  readonly balance: SickLeaveBalance;
  readonly policy: SickLeavePolicy;
  /**
   * Whether awarded hours lapse at year end. NO DEFAULT - Michael has to say.
   * Null means unanswered and the engine refuses, because silently lapsing a
   * gift and silently carrying it forever are both wrong and both plausible.
   */
  readonly awardedHoursLapse: boolean | null;
}): SickLeaveResult<CarryoverPlan> {
  const cap = args.policy.carryoverCapMinutes;
  if (cap === null) {
    return {
      ok: false,
      refusals: [
        refuse(
          "NO_CARRYOVER_CAP_ON_FILE",
          "I cannot close out the year because no carryover cap is on file.",
          "Set the carryover cap in the sick leave policy. Forty hours is the legal minimum you must allow.",
          ["wac-296-128-620-carryover"],
        ),
      ],
    };
  }
  if (cap < SICK_LEAVE_CARRYOVER_CAP_MINUTES) {
    return {
      ok: false,
      refusals: [
        refuse(
          "CARRYOVER_CAP_BELOW_STATUTORY_FLOOR",
          "The carryover cap on file is below the forty hours Washington requires, so applying it would take leave employees are entitled to keep.",
          "Raise the carryover cap to at least forty hours (2,400 minutes).",
          ["wac-296-128-620-carryover"],
        ),
      ],
    };
  }
  if (args.awardedHoursLapse === null) {
    return {
      ok: false,
      refusals: [
        refuse(
          "VERIFICATION_POLICY_UNANSWERED",
          "I cannot close out the year because nobody has said whether the hours you awarded on top of what was earned lapse at year end or roll forward. Blank is not an answer: carrying them forever and wiping them are both defensible and I will not pick for you.",
          "Answer it once in the sick leave policy. Most employers let gifted hours lapse, since the point was to cover a specific situation.",
          ["wac-296-128-620-carryover"],
        ),
      ],
    };
  }

  const statutory = Math.max(0, args.balance.statutoryMinutes);
  const awarded = Math.max(0, args.balance.awardedMinutes);

  const carriedStatutory = Math.min(statutory, cap);
  const forfeitedStatutory = statutory - carriedStatutory;
  const carriedAwarded = args.awardedHoursLapse ? 0 : awarded;
  const forfeitedAwarded = awarded - carriedAwarded;

  const explanation =
    `${minutesLabel(carriedStatutory)} of earned leave carries into next year` +
    (forfeitedStatutory > 0
      ? `, and ${minutesLabel(forfeitedStatutory)} is above your ${minutesLabel(cap)} cap and lapses.`
      : ` (under the ${minutesLabel(cap)} cap, so none is lost).`) +
    (awarded > 0
      ? args.awardedHoursLapse
        ? ` The ${minutesLabel(awarded)} you awarded lapses, as your policy says. Because earned hours are always spent first, these leftovers are the gift you gave - not leave anyone was owed.`
        : ` The ${minutesLabel(awarded)} you awarded also rolls forward, on top of the cap.`
      : "");

  return {
    ok: true,
    value: {
      carriedStatutoryMinutes: carriedStatutory,
      carriedAwardedMinutes: carriedAwarded,
      forfeitedStatutoryMinutes: forfeitedStatutory,
      forfeitedAwardedMinutes: forfeitedAwarded,
      explanation,
    },
  };
}

// ===========================================================================
// 13) THE MONTHLY NOTIFICATION - WAC 296-128-755(2)
//
// Employers must tell each employee, at least monthly, how much leave they
// accrued, how much they used, and how much is available. This builds that
// sentence from the ledger so the obligation is met by a function rather than
// by somebody remembering.
// ===========================================================================

export function monthlyNotificationText(args: {
  readonly employeeName: string;
  readonly monthLabel: string;
  readonly entriesThisMonth: readonly SickLeaveLedgerEntry[];
  readonly balanceAfter: SickLeaveBalance;
}): string {
  let accrued = 0;
  let used = 0;
  let awarded = 0;

  for (const e of args.entriesThisMonth) {
    if (e.entryKind === "accrual" || e.entryKind === "carry_in" || e.entryKind === "reinstate") {
      accrued += e.minutes;
    } else if (e.entryKind === "award") {
      awarded += e.minutes;
    } else if (e.entryKind === "usage") {
      used += Math.abs(e.minutes);
    }
  }

  const awardSentence =
    awarded > 0 ? ` We also added ${minutesLabel(awarded)} on top of what you earned.` : "";

  return (
    `${args.employeeName} - paid sick leave for ${args.monthLabel}. ` +
    `You earned ${minutesLabel(accrued)} and used ${minutesLabel(used)}.${awardSentence} ` +
    `You have ${minutesLabel(args.balanceAfter.totalMinutes)} available. ` +
    `Questions about any of these numbers go to Michael.`
  );
}

// ===========================================================================
// 14) THE GENEROSITY LEDGER - Michael's explicit ask, in his own words
//
// He said, verbatim:
//
//   "I use the legally required minimum, it's easier that way, I give extra on
//    demand, I don't want to try and figure out a complex formula to accumulate
//    sick time. I just need a smart and easy to use tool that tracks their sick
//    time, including if it goes negative. I want to keep track of how generous
//    I am being."
//
// That is three separate requirements, and they are easy to blur together:
//
//   (a) ACCRUE AT THE FLOOR. One hour per forty worked, RCW 49.46.210(1)(a).
//       No custom formula. Section 5 already does this; nothing here changes it.
//   (b) GIVE EXTRA AD HOC, and have the extra recorded as extra rather than
//       disappearing into the earned balance. Section 8 (`planAward`) already
//       does this, and section 6 already keeps the two buckets apart.
//   (c) TOTAL UP THE GENEROSITY so he can see what he has given away, and
//       SHOW A NEGATIVE BALANCE if one ever occurs.
//
// (a) and (b) existed. (c) did not, and this section is (c).
//
// WHY A NEGATIVE BALANCE IS POSSIBLE AT ALL
//
// It should not be. `reviewRequest` refuses leave the employee has not got, and
// the draw order in section 7 spends earned hours before gifted ones. But a
// balance is a SUM OF A LEDGER, and a ledger can be corrected. A `correction`
// row may be negative (0198 permits it deliberately, so a mistake can be undone
// honestly rather than by deleting history), a `forfeit` can be recorded, and a
// payout can be entered for an amount somebody mistyped.
//
// Note also that a forfeit and a payout carry NO bucket - 0198's
// `sick_leave_ledger_draw_only_on_usage` constraint permits `drawn_from` on
// usage rows only - so section 6 charges both to the statutory bucket. An
// oversized payout therefore drives EARNED leave negative, which is precisely
// the case this section has to surface rather than round away.
//
// So the honest engineering position is: a negative balance means SOMETHING
// WENT WRONG, and Michael must be told, loudly, rather than shown a clamped
// zero that hides it. `Math.max(0, total)` would be one character of "tidying"
// that permanently conceals an error in a wage record. This section therefore
// reports negativity as a first-class fact with the bucket named.
//
// WHY GENEROSITY IS MEASURED GROSS, NET AND OUTSTANDING
//
// "How generous have I been" has three defensible answers and they differ:
//
//   GROSS      - every minute ever awarded. What he has given, cumulatively.
//   USED       - awarded minutes the employee actually spent. What the gift
//                was worth to them in practice.
//   OUTSTANDING- awarded minutes still sitting in the bucket. What he is still
//                carrying. NOTE this is a real liability if he ever chooses to
//                cash it out, though the law does NOT require him to.
//
// Reporting only one of the three would answer a different question from the
// one he asked, so all three are returned and named. Standing rule 64a:
// detection is not explanation.
// ===========================================================================

/** What one employee's leave looks like, generosity included. */
export type GenerosityLine = {
  readonly employeeId: string;
  readonly employeeName: string;
  /** Hours the law made him give, still on the books. */
  readonly statutoryMinutes: number;
  /** Gifted hours still on the books. */
  readonly awardedMinutes: number;
  readonly totalMinutes: number;
  /** Every minute ever awarded to this person, spent or not. */
  readonly awardedEverMinutes: number;
  /** Awarded minutes this person has actually used. */
  readonly awardedUsedMinutes: number;
  /**
   * True when any bucket is below zero. Reported, never clamped: a negative
   * balance is a signal that a correction or payout needs looking at.
   */
  readonly isNegative: boolean;
  /** Which bucket(s) went negative, in plain English. Empty when none did. */
  readonly negativeExplanation: string;
};

export type GenerositySummary = {
  readonly lines: readonly GenerosityLine[];
  /** Every minute ever awarded, across everybody. */
  readonly totalAwardedEverMinutes: number;
  /** Awarded minutes that have actually been used, across everybody. */
  readonly totalAwardedUsedMinutes: number;
  /** Awarded minutes still on the books, across everybody. */
  readonly totalAwardedOutstandingMinutes: number;
  /** Statutory minutes still on the books, across everybody. */
  readonly totalStatutoryOutstandingMinutes: number;
  /** How many people are carrying a negative balance. Should be zero. */
  readonly negativeCount: number;
  /** One sentence Michael can read without opening anything. */
  readonly explanation: string;
};

/**
 * Roll one employee's ledger into a generosity line.
 *
 * Deliberately reuses `computeBalance` rather than re-summing, so there is
 * exactly one definition of "what the balance is" in this codebase (standing
 * rule 25). If the bucket rules ever change, they change in one place and this
 * follows automatically.
 */
export function generosityLineFor(args: {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly entries: readonly SickLeaveLedgerEntry[];
}): GenerosityLine {
  const balance = computeBalance(args.entries);

  let awardedEver = 0;
  let awardedUsed = 0;
  for (const e of args.entries) {
    if (!Number.isFinite(e.minutes) || e.minutes === 0) continue;
    if (e.entryKind === "award") {
      awardedEver += e.minutes;
    } else if (e.drawnFrom === "awarded" && e.minutes < 0) {
      /*
       * USAGE ROWS ONLY, and that is not a simplification - it is what the
       * database permits. 0198 carries
       *
       *   check ((entry_kind = 'usage') = (drawn_from is not null))
       *
       * so a forfeit, a payout or a correction CANNOT name a bucket. The test
       * is written against `drawnFrom` rather than against `entryKind ===
       * "usage"` anyway, because if that constraint is ever relaxed to let a
       * payout draw from the gifted bucket, this line starts counting it
       * correctly with no edit. Matching on the kind would silently under-count
       * from the day the constraint changed.
       *
       * The consequence today: a forfeit or payout has no bucket, so
       * `computeBalance` charges it to STATUTORY. That is the conservative
       * direction - it never overstates what has been given away - and it is
       * section 6's documented behaviour, not an accident here.
       */
      awardedUsed += Math.abs(e.minutes);
    }
  }

  const negatives: string[] = [];
  if (balance.statutoryMinutes < 0) {
    negatives.push(
      `earned leave is ${minutesLabel(Math.abs(balance.statutoryMinutes))} below zero`,
    );
  }
  if (balance.awardedMinutes < 0) {
    negatives.push(
      `gifted leave is ${minutesLabel(Math.abs(balance.awardedMinutes))} below zero`,
    );
  }

  return {
    employeeId: args.employeeId,
    employeeName: args.employeeName,
    statutoryMinutes: balance.statutoryMinutes,
    awardedMinutes: balance.awardedMinutes,
    totalMinutes: balance.totalMinutes,
    awardedEverMinutes: awardedEver,
    awardedUsedMinutes: awardedUsed,
    isNegative: negatives.length > 0,
    negativeExplanation:
      negatives.length === 0
        ? ""
        : `${args.employeeName}: ${negatives.join(" and ")}. A balance cannot go below zero ` +
          `by accruing or by taking approved leave, so this came from a correction, a ` +
          `forfeit or a payout. Somebody should look at this employee's ledger before the ` +
          `next pay run.`,
  };
}

/**
 * Roll every employee up into the answer to "how generous have I been".
 *
 * The explanation sentence is built here rather than in the screen so that the
 * number and the words describing it can never disagree - the same reason the
 * garnishment engine carries its own explanations.
 */
export function summariseGenerosity(
  lines: readonly GenerosityLine[],
): GenerositySummary {
  let ever = 0;
  let used = 0;
  let outstanding = 0;
  let statutory = 0;
  let negatives = 0;

  for (const l of lines) {
    ever += l.awardedEverMinutes;
    used += l.awardedUsedMinutes;
    outstanding += l.awardedMinutes;
    statutory += l.statutoryMinutes;
    if (l.isNegative) negatives += 1;
  }

  const explanation =
    ever === 0
      ? "You have not given any sick leave beyond what the law requires. Everyone's balance is what they earned at one hour per forty hours worked."
      : `You have given ${minutesLabel(ever)} of sick leave on top of what the law ` +
        `required. ${minutesLabel(used)} of that has been used, and ` +
        `${minutesLabel(outstanding)} is still sitting in people's gifted balances. ` +
        `Gifted hours are spent only after earned hours run out, and you are not ` +
        `required to carry them over at year end or pay them out when someone leaves.`;

  return {
    lines,
    totalAwardedEverMinutes: ever,
    totalAwardedUsedMinutes: used,
    totalAwardedOutstandingMinutes: outstanding,
    totalStatutoryOutstandingMinutes: statutory,
    negativeCount: negatives,
    explanation,
  };
}
