/**
 * src/lib/accounting/tax-penalty-core.ts   (slice books-16)
 *
 * LATE PAYMENT PENALTIES AND INTEREST — FOR EVERY AGENCY THAT CAN FINE MICHAEL.
 *
 * Michael, 2026-08-20, recorded verbatim (standing rule 1):
 *
 *   "I have not been delinquent for a while now with them. I am most often,
 *    which isn't that often, but the one I fail on the most is payroll taxes.
 *    I pay biweekly and I just forget. But I do want the fines and penalties
 *    and interest and such to be applicable to all agencies just in case. I am
 *    very very rarely late on either sales tax and excise tax too, but I have
 *    let it slip my mind."
 *
 * So: no outstanding balances to open with, but a real and self-diagnosed habit
 * of forgetting the biweekly payroll deposit. This file is what tells him what
 * forgetting actually costs, per agency, to the cent.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE ONE FINDING THAT SHAPES THIS ENTIRE FILE
 *
 * There is no such thing as "the late penalty." Five agencies bill Michael and
 * every one of them counts time differently:
 *
 *   WA ESD   5 / 10 / 20 %   running TOTALS   elapsed months "or part thereof"
 *   WA L&I   5 / 10 / 20 %   running TOTALS   elapsed months "or part thereof"
 *   WA DOR   9 / 19 / 29 %   running TOTALS   CALENDAR MONTH-ENDS after due date
 *   WA LCB   2 % per month   ACCUMULATING     months after the 20th
 *   IRS      2/5/10/15 %     STEP by DAYS     5-day and 15-day thresholds
 *
 * Three of those look similar enough to tempt a shared function and all three
 * would then be wrong. ESD counts how many months have elapsed since the due
 * date; DOR counts how many calendar month-ends have gone by. Those diverge
 * depending on where in the month the due date falls. The IRS does not count
 * months at all.
 *
 * Therefore: FIVE SEPARATE FUNCTIONS. No shared schedule table, no clever
 * parameterisation, no `tiers[]` array reused across agencies. Each one is
 * implemented against its own statutory words and tested against its own
 * statutory words. Duplication here is the safety feature (standing rule 2 —
 * drift is catastrophic).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * MONEY DISCIPLINE (standing rules 4 and 13e)
 *
 * Every amount is INTEGER CENTS. Every rate is MILLI-PERCENT (percent × 1000,
 * so 9% = 9_000 and 0.5% = 500). Percentages are applied with BigInt and a
 * single explicit rounding step. There is not one float literal, one
 * `parseFloat`, one `toFixed`, or one division by a non-integer anywhere in
 * this file, and a test greps the compiled source to prove it.
 *
 * PURITY: no I/O, no Date.now(), no randomness, no ambient clock. Every
 * function is a total function of its arguments — the caller passes the dates
 * in. That is what lets the tests sweep whole domains instead of sampling one
 * happy value (standing rule 15b), and it is what stops a penalty from
 * silently changing because the server rebooted in a different timezone.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE REFUSES TO DO (standing rule 14 — gate, don't warn)
 *
 *   - It will not compute a penalty for a date it has no rate evidence for.
 *   - It will not extrapolate a fourth tier where the statute stops at three.
 *   - It will not silently choose between two readings of an ambiguous rule
 *     (see the LCB "outstanding balance" question) — it returns an estimate
 *     flagged as an estimate, with the ambiguity named.
 *   - It will not pro-rata a partial month. "Or fraction thereof" means the
 *     whole tier, and that is Math.ceil, always.
 *   - It will not net a penalty against interest or blend the two into one
 *     number, because they land on different lines of the tax return.
 */

import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";

// ---------------------------------------------------------------------------
// 1) UNITS — stated once, enforced everywhere
// ---------------------------------------------------------------------------

/**
 * Rates are MILLI-PERCENT: percent × 1000.
 *   100%  = 100_000
 *     9%  =   9_000
 *     0.5%=     500
 *
 * Why not basis points? Because §6651(a)(2) is 0.5% and basis points would
 * make that 50 — fine — but §1.163-9T style half-percents combined with the
 * 0.58% WA Cares rate already forced milli-percent on the payroll registry in
 * books-15, and having two different rate units in one codebase is exactly the
 * kind of drift standing rule 2 is about. One unit. Milli-percent.
 */
export const MILLI_PERCENT_ONE_HUNDRED = 100_000;

/** Multiply cents by a milli-percent rate. Exact BigInt math, then ONE rounding. */
export function applyMilliPercent(
  amountCents: number,
  rateMilliPercent: number,
): number {
  if (!Number.isInteger(amountCents)) {
    throw new Error(
      `applyMilliPercent: amountCents must be an integer number of cents, got ${amountCents}`,
    );
  }
  if (!Number.isInteger(rateMilliPercent)) {
    throw new Error(
      `applyMilliPercent: rateMilliPercent must be an integer, got ${rateMilliPercent}`,
    );
  }
  if (rateMilliPercent < 0) {
    throw new Error(
      `applyMilliPercent: rateMilliPercent must not be negative, got ${rateMilliPercent}`,
    );
  }

  const negative = amountCents < 0;
  const magnitude = BigInt(negative ? -amountCents : amountCents);
  const rate = BigInt(rateMilliPercent);
  const denominator = BigInt(MILLI_PERCENT_ONE_HUNDRED);

  // Round HALF UP on the magnitude, so the sign never changes the rounding
  // direction. (Banker's rounding is wrong here: statutes say "of the amount
  // of the tax", and every agency worksheet rounds half up.)
  const scaled = magnitude * rate;
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;
  // NOTE: written as BigInt(2) / BigInt(1), not the `2n` literal. This repo's
  // tsconfig targets below ES2020, where BigInt literals are a COMPILE ERROR
  // (TS2737). The BigInt() constructor is available and identical in effect.
  // Verified by compiling: `2n` here fails the build.
  const rounded =
    remainder * BigInt(2) >= denominator ? quotient + BigInt(1) : quotient;

  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) {
    throw new Error(
      `applyMilliPercent: result ${rounded.toString()} exceeds MAX_SAFE_INTEGER`,
    );
  }
  return negative ? -result : result;
}

// ---------------------------------------------------------------------------
// 2) DATES — no Date.now(), no timezones, ISO strings only
// ---------------------------------------------------------------------------

/**
 * Strict ISO date validation via round-trip. Rejects 2026-02-30, 2025-02-29,
 * 1900-02-29 (century rule), and anything that is not exactly YYYY-MM-DD.
 * Same contract as the books-15 rate registry — deliberately duplicated rather
 * than imported, because a penalty engine must not break if payroll moves.
 */
export function isValidIsoDate(s: string): boolean {
  if (typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

function assertIso(label: string, s: string): void {
  if (!isValidIsoDate(s)) {
    throw new Error(`${label}: not a valid ISO date (YYYY-MM-DD): ${JSON.stringify(s)}`);
  }
}

const MS_PER_DAY = 86_400_000;

/** Whole days from `fromIso` to `toIso`. Negative if toIso is earlier. */
export function daysBetween(fromIso: string, toIso: string): number {
  assertIso("daysBetween(from)", fromIso);
  assertIso("daysBetween(to)", toIso);
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / MS_PER_DAY);
}

/** Add whole days to an ISO date, returning an ISO date. */
export function addDays(iso: string, days: number): string {
  assertIso("addDays", iso);
  if (!Number.isInteger(days)) {
    throw new Error(`addDays: days must be an integer, got ${days}`);
  }
  const t = Date.parse(`${iso}T00:00:00Z`) + days * MS_PER_DAY;
  return new Date(t).toISOString().slice(0, 10);
}

/** Day of week, 0 = Sunday .. 6 = Saturday. Pure, UTC, no locale. */
export function dayOfWeek(iso: string): number {
  assertIso("dayOfWeek", iso);
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** Last calendar day of the month containing `iso`. Leap-year correct. */
export function endOfMonth(iso: string): string {
  assertIso("endOfMonth", iso);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  // Day 0 of the NEXT month is the last day of this one. Handles Feb/leap and
  // the December rollover without a table of month lengths.
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Add whole calendar months, clamping to the end of the target month.
 * 2026-01-31 + 1 month = 2026-02-28 (not 2026-03-03).
 */
export function addMonths(iso: string, months: number): string {
  assertIso("addMonths", iso);
  if (!Number.isInteger(months)) {
    throw new Error(`addMonths: months must be an integer, got ${months}`);
  }
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));

  const zeroBased = month - 1 + months;
  const targetYear = year + Math.floor(zeroBased / 12);
  const targetMonth = ((zeroBased % 12) + 12) % 12; // 0-based, always positive

  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = day < lastDay ? day : lastDay;
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay))
    .toISOString()
    .slice(0, 10);
}

/**
 * RCW 1.12.040 — "computed by excluding the first day, and including the last,
 * unless the last day is a holiday, Saturday, or Sunday, and then it is also
 * excluded." A due date landing on a weekend rolls FORWARD.
 *
 * ⚠️ HOLIDAYS ARE NOT HANDLED HERE AND THAT IS DELIBERATE. Legal holidays under
 * RCW 1.16.050 include floating dates and observed-day rules; guessing them
 * would be exactly the silent plug standing rule 12 forbids. This function
 * handles Saturday and Sunday, which is provably correct, and the result
 * carries `holidayUnchecked: true` so the caller can never mistake it for a
 * complete answer. A future slice loads the holiday calendar as evidence.
 */
export type RolledDueDate = {
  readonly original: string;
  readonly effective: string;
  readonly rolledDays: number;
  readonly rolledReason: "none" | "saturday" | "sunday";
  readonly holidayUnchecked: true;
};

export function rollWeekendForward(iso: string): RolledDueDate {
  assertIso("rollWeekendForward", iso);
  const dow = dayOfWeek(iso);
  if (dow === 6) {
    return {
      original: iso,
      effective: addDays(iso, 2),
      rolledDays: 2,
      rolledReason: "saturday",
      holidayUnchecked: true,
    };
  }
  if (dow === 0) {
    return {
      original: iso,
      effective: addDays(iso, 1),
      rolledDays: 1,
      rolledReason: "sunday",
      holidayUnchecked: true,
    };
  }
  return {
    original: iso,
    effective: iso,
    rolledDays: 0,
    rolledReason: "none",
    holidayUnchecked: true,
  };
}

/**
 * Months of delinquency, "or part thereof" — the phrase that appears in
 * RCW 50.12.220(4), RCW 50.24.040 and RCW 51.48.210.
 *
 * Paid ON the due date  -> 0 (not delinquent at all)
 * One day late          -> 1 (the FULL first month)
 * Exactly one month late-> 1
 * One month + one day   -> 2
 *
 * This is Math.ceil over elapsed calendar months. It is NEVER pro-rata. A
 * business owner's instinct is that one day late costs one day's worth; the
 * statute says one day late costs the whole tier, and pretending otherwise
 * would understate every estimate this system ever produces.
 */
export function monthsOrPartThereof(dueIso: string, paidIso: string): number {
  assertIso("monthsOrPartThereof(due)", dueIso);
  assertIso("monthsOrPartThereof(paid)", paidIso);
  if (daysBetween(dueIso, paidIso) <= 0) return 0;

  let months = 1;
  // Walk forward a month at a time until the anniversary reaches the paid date.
  // Bounded so a hostile 1000-year-late input cannot spin: 1200 months = 100y.
  while (months < 1200) {
    const anniversary = addMonths(dueIso, months);
    if (daysBetween(anniversary, paidIso) <= 0) return months;
    months += 1;
  }
  return 1200;
}

/**
 * DOR counts differently and this function is why DOR gets its own code path.
 *
 * RCW 82.32.090(1) keys off "the last day of the month following the due date"
 * and "the last day of the second month following the due date" — CALENDAR
 * month-ends, not elapsed months.
 *
 * Returns 0 (on time), 1 (late but by the first month-end), 2, or 3.
 *
 * Worked divergence, so the difference is impossible to miss.
 *
 *   Facts: due 2026-01-25, paid 2026-03-01.
 *
 *   ESD's clock (monthsOrPartThereof) asks "how many months have ELAPSED?"
 *     2026-02-25 has passed, 2026-03-25 has not  ->  2  ->  10% tier
 *
 *   DOR's clock (dorPenaltyStep) asks "which calendar MONTH-ENDS have passed?"
 *     "the last day of the month following the due date"        = 2026-02-28
 *     "the last day of the second month following the due date" = 2026-03-31
 *     2026-03-01 is past 2026-02-28 but not past 2026-03-31    ->  2 -> 19%
 *
 *   Same lateness, and the tier INDEX happens to agree here — but the rate is
 *   10% versus 19%, so the answers are already miles apart.
 *
 *   Now move the due date and the indices diverge too:
 *     Facts: due 2026-01-05, paid 2026-02-10.
 *       ESD: 2026-02-05 has passed  ->  tier 2  ->  10%
 *       DOR: "last day of the month following" = 2026-02-28, not yet reached
 *                                   ->  step 1  ->   9%
 *   One is in its second tier while the other is still in its first, on
 *   identical facts.
 *
 * Both worked examples above are asserted as tests, so this comment cannot
 * quietly rot away from the code (standing rule 2).
 *
 * Hence two functions, never one parameterised one.
 */
export function dorPenaltyStep(dueIso: string, paidIso: string): 0 | 1 | 2 | 3 {
  assertIso("dorPenaltyStep(due)", dueIso);
  assertIso("dorPenaltyStep(paid)", paidIso);
  if (daysBetween(dueIso, paidIso) <= 0) return 0;

  // "the last day of the month following the due date"
  const firstThreshold = endOfMonth(addMonths(dueIso, 1));
  // "the last day of the second month following the due date"
  const secondThreshold = endOfMonth(addMonths(dueIso, 2));

  if (daysBetween(paidIso, secondThreshold) < 0) return 3;
  if (daysBetween(paidIso, firstThreshold) < 0) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// 3) THE RESULT SHAPE — penalty and interest NEVER blended
// ---------------------------------------------------------------------------

/** Which agency. Each has its own function; this tags the result. */
export type TaxAgency = "wa_esd" | "wa_lni" | "wa_dor" | "wa_lcb" | "irs";

export const ALL_TAX_AGENCIES: readonly TaxAgency[] = [
  "wa_esd",
  "wa_lni",
  "wa_dor",
  "wa_lcb",
  "irs",
] as const;

export const TAX_AGENCY_LABELS: Record<TaxAgency, string> = {
  wa_esd: "WA Employment Security Department (unemployment)",
  wa_lni: "WA Labor & Industries (workers' comp)",
  wa_dor: "WA Department of Revenue (sales tax, B&O)",
  wa_lcb: "WA Liquor and Cannabis Board (37% cannabis excise)",
  irs: "Internal Revenue Service (federal payroll deposits)",
};

/**
 * DEDUCTIBILITY. Researched, not assumed — see
 * /workspace/research-books-16/01-all-agency-penalties.md §7.
 *
 *   tax          -> deductible          IRC §162(f)(4)
 *   penalty      -> NOT deductible      IRC §162(f)(1)
 *   interest on a BUSINESS tax -> deductible   Treas. Reg. §1.163-9T(b)(2)(iii)(A)
 *   interest on a PERSONAL income tax deficiency -> NOT deductible
 *                                       Treas. Reg. §1.163-9T(b)(2)(i)(A)
 *
 * Three answers on one notice. This is why the engine classifies every
 * component instead of returning a single "penalties and interest" number.
 */
export type Deductibility =
  | "deductible_business_expense"
  | "not_deductible_irc_162f"
  | "not_deductible_personal_interest_1_163_9t";

export const DEDUCTIBILITY_LABELS: Record<Deductibility, string> = {
  deductible_business_expense: "Deductible business expense",
  not_deductible_irc_162f: "NOT deductible — government penalty (IRC §162(f)(1))",
  not_deductible_personal_interest_1_163_9t:
    "NOT deductible — personal interest (Treas. Reg. §1.163-9T(b)(2)(i)(A))",
};

/** One line of a late-payment assessment. */
export type PenaltyComponent = {
  /** Stable key so the ledger mapping is data, not a string match. */
  readonly key: string;
  /** What to call it on screen. */
  readonly label: string;
  readonly amountCents: number;
  /**
   * Is this line INTEREST (true) or a PENALTY (false)?
   *
   * This is a separate, explicit field and NOT inferred from `deductibility`,
   * which is a mistake this file made once and which is worth explaining so it
   * is never made again.
   *
   * The tempting shortcut is "penalties are non-deductible and interest is
   * deductible, so deductibility tells me which is which." That is false in
   * exactly the case that matters most to Michael. Interest on a personal 1040
   * deficiency flowing off a Greenway K-1 is NON-deductible under
   * Treas. Reg. §1.163-9T(b)(2)(i)(A) — it is still interest. Inferring the
   * category from deductibility would file that interest as a penalty, which
   * then reports the wrong split to Michael AND books it to the wrong account.
   *
   * Two independent facts, two independent fields. Standing rule 2: the moment
   * one value is derived from another that only USUALLY agrees with it, drift
   * is guaranteed, it is just waiting for the right input.
   */
  readonly isInterest: boolean;
  /** Which tax-return treatment this line gets. */
  readonly deductibility: Deductibility;
  /** The statutory words this number came from. */
  readonly authorityId: string;
  /** How the number was arrived at, in one sentence, with the inputs in it. */
  readonly workings: string;
};

/**
 * An ambiguity the statute or rule does not resolve. Standing rule 12: no
 * silent plugs. If the engine had to pick a reading, it says so out loud and
 * the result is marked an estimate.
 */
export type PenaltyCaveat = {
  readonly code: string;
  readonly message: string;
  readonly authorityId: string;
};

export type PenaltyAssessment = {
  readonly agency: TaxAgency;
  readonly agencyLabel: string;
  /** The tax that was late, in cents. Never modified by this engine. */
  readonly taxCents: number;
  readonly dueDate: RolledDueDate;
  readonly paidDate: string;
  /** 0 when paid on or before the effective due date. */
  readonly daysLate: number;
  readonly components: readonly PenaltyComponent[];
  /** Sum of components where isInterest === false. */
  readonly totalPenaltyCents: number;
  /** Sum of components where isInterest === true. Separate on purpose. */
  readonly totalInterestCents: number;
  /** penalty + interest. Does NOT include the tax itself. */
  readonly totalAddedCents: number;
  /** True when every number is fully determined by the cited text. */
  readonly isExact: boolean;
  readonly caveats: readonly PenaltyCaveat[];
};

/**
 * Refusal, not a wrong answer (standing rule 14). The engine returns this
 * rather than guessing when it cannot know.
 */
export type PenaltyRefusalCode =
  | "invalid_tax_amount"
  | "invalid_date"
  | "paid_before_due"
  | "rate_not_evidenced_for_date";

export type PenaltyRefusal = {
  readonly code: PenaltyRefusalCode;
  readonly message: string;
};

export type PenaltyResult =
  | { readonly ok: true; readonly assessment: PenaltyAssessment }
  | { readonly ok: false; readonly refusal: PenaltyRefusal };

function refuse(code: PenaltyRefusalCode, message: string): PenaltyResult {
  return { ok: false, refusal: { code, message } };
}

/** Shared entry validation. Every agency function calls this first. */
function validateInputs(
  taxCents: number,
  dueIso: string,
  paidIso: string,
): PenaltyRefusal | null {
  if (!Number.isInteger(taxCents)) {
    return {
      code: "invalid_tax_amount",
      message: `Tax must be a whole number of cents, got ${taxCents}. Money is never a decimal in this system.`,
    };
  }
  if (taxCents < 0) {
    return {
      code: "invalid_tax_amount",
      message: `Tax must not be negative, got ${taxCents} cents. A negative liability is an overpayment and belongs in a refund workflow, not a penalty calculation.`,
    };
  }
  if (!Number.isSafeInteger(taxCents)) {
    return {
      code: "invalid_tax_amount",
      message: `Tax of ${taxCents} cents exceeds the safe integer range.`,
    };
  }
  if (!isValidIsoDate(dueIso)) {
    return {
      code: "invalid_date",
      message: `Due date is not a valid ISO date (YYYY-MM-DD): ${JSON.stringify(dueIso)}`,
    };
  }
  if (!isValidIsoDate(paidIso)) {
    return {
      code: "invalid_date",
      message: `Payment date is not a valid ISO date (YYYY-MM-DD): ${JSON.stringify(paidIso)}`,
    };
  }
  return null;
}

/** Apply a statutory dollar floor to a penalty. Returns the floored amount. */
function applyFloor(computedCents: number, floorCents: number): number {
  return computedCents < floorCents ? floorCents : computedCents;
}

// ---------------------------------------------------------------------------
// 4) WA EMPLOYMENT SECURITY DEPARTMENT — RCW 50.12.220(4) + RCW 50.24.040
//
//    THE ONE MICHAEL ACTUALLY TRIPS OVER.
// ---------------------------------------------------------------------------

/** 5% / 10% / 20% — RUNNING TOTALS, not additions. Milli-percent. */
const ESD_TIERS_MILLI_PERCENT = [5_000, 10_000, 20_000] as const;
/** "No penalty so added shall be less than $10." */
const ESD_PENALTY_FLOOR_CENTS = 1_000;
/** RCW 50.24.040: "one percent per month or fraction thereof". */
const ESD_INTEREST_MILLI_PERCENT_PER_MONTH = 1_000;
/** RCW 50.12.220(1): flat $25 for a late report, separate from the money. */
export const ESD_LATE_REPORT_PENALTY_CENTS = 2_500;

export type EsdPenaltyInput = {
  readonly taxCents: number;
  readonly dueDate: string;
  readonly paidDate: string;
  /** Set when the quarterly report was ALSO filed late — a separate $25. */
  readonly reportFiledLate?: boolean;
};

export function computeEsdPenalty(input: EsdPenaltyInput): PenaltyResult {
  const bad = validateInputs(input.taxCents, input.dueDate, input.paidDate);
  if (bad) return { ok: false, refusal: bad };

  const due = rollWeekendForward(input.dueDate);
  const daysLate = daysBetween(due.effective, input.paidDate);

  if (daysLate <= 0) {
    return refuse(
      "paid_before_due",
      `Paid ${input.paidDate}, which is on or before the effective due date ${due.effective}. Nothing is owed and this engine will not invent a penalty.`,
    );
  }

  const months = monthsOrPartThereof(due.effective, input.paidDate);
  const components: PenaltyComponent[] = [];
  const caveats: PenaltyCaveat[] = [];

  // ── LATE PAYMENT PENALTY ─────────────────────────────────────────────────
  // The statute defines three tiers and then STOPS. It does not say what
  // happens in month four, and it does not say the penalty keeps growing.
  // We clamp at the third tier. We do NOT extrapolate a 40% tier that no
  // legislature ever wrote (standing rule 1).
  const tierIndex = months >= 3 ? 2 : months - 1;
  const tierRate = ESD_TIERS_MILLI_PERCENT[tierIndex];
  const rawPenalty = applyMilliPercent(input.taxCents, tierRate);
  const penalty = applyFloor(rawPenalty, ESD_PENALTY_FLOOR_CENTS);

  const flooredNote =
    penalty !== rawPenalty
      ? ` Raw ${rawPenalty} cents was below the $10 statutory floor, so the floor applies.`
      : "";

  components.push({
    key: "esd_late_payment_penalty",
    label: `Late contribution penalty (month ${months >= 3 ? "3+" : String(months)} tier)`,
    amountCents: penalty,
    isInterest: false,
    deductibility: "not_deductible_irc_162f",
    authorityId: "rcw-50-12-220-esd-late-penalty",
    workings:
      `${months} month(s) or part thereof late. RCW 50.12.220(4) sets a TOTAL penalty of ` +
      `${tierRate / 1000}% at that tier (these are running totals, not amounts you add up). ` +
      `${tierRate / 1000}% of ${input.taxCents} cents = ${rawPenalty} cents.${flooredNote}`,
  });

  if (months >= 3) {
    caveats.push({
      code: "esd_schedule_exhausted",
      message:
        "RCW 50.12.220(4) writes out three tiers and stops at 20%. It says nothing about a fourth " +
        "month, so this engine holds at 20% rather than inventing a tier. If ESD has actually " +
        "assessed more than 20%, do not overwrite this — get their notice and enter it as evidence.",
      authorityId: "rcw-50-12-220-esd-late-penalty",
    });
  }

  // ── LATE REPORT PENALTY (separate offence, flat rate) ────────────────────
  if (input.reportFiledLate === true) {
    components.push({
      key: "esd_late_report_penalty",
      label: "Late report penalty (flat)",
      amountCents: ESD_LATE_REPORT_PENALTY_CENTS,
      isInterest: false,
      deductibility: "not_deductible_irc_162f",
      authorityId: "rcw-50-12-220-esd-late-penalty",
      workings:
        "RCW 50.12.220(1): a flat $25 per violation for a late report. This is independent of the " +
        "money owed — filing late and paying late are two different failures and both get billed.",
    });
  }

  // ── INTEREST ─────────────────────────────────────────────────────────────
  // "one percent per month or fraction thereof" — SIMPLE, on the tax only.
  // Contrast the IRS, which compounds daily under §6622. Never share this code.
  const interest = applyMilliPercent(
    input.taxCents,
    ESD_INTEREST_MILLI_PERCENT_PER_MONTH * months,
  );
  components.push({
    key: "esd_interest",
    label: "Interest on delinquent contributions",
    amountCents: interest,
    isInterest: true,
    deductibility: "deductible_business_expense",
    authorityId: "rcw-50-24-040-esd-interest",
    workings:
      `RCW 50.24.040: 1% per month or fraction thereof, simple, on the unpaid contributions. ` +
      `${months} month(s) x 1% = ${months}% of ${input.taxCents} cents = ${interest} cents. ` +
      `Note this is SIMPLE interest — Washington does not compound, the IRS does.`,
    });

  // EXACT: RCW 50.12.220(4) and RCW 50.24.040 fully determine every number
  // above. Nothing here required a judgement call.
  return finish("wa_esd", input.taxCents, due, input.paidDate, daysLate, components, caveats, true);
}

// ---------------------------------------------------------------------------
// 5) WA LABOR & INDUSTRIES — RCW 51.48.210
//
//    Same 5/10/20 shape as ESD, but with a warrant penalty bounded [$5, $100]
//    and — the part nobody expects — RCW 51.16.150 lets the State enjoin you
//    from operating. Separate function, because "same shape today" is exactly
//    how two things drift apart tomorrow.
// ---------------------------------------------------------------------------

const LNI_TIERS_MILLI_PERCENT = [5_000, 10_000, 20_000] as const;
const LNI_PENALTY_FLOOR_CENTS = 1_000; // "not be less than ten dollars"
const LNI_INTEREST_MILLI_PERCENT_PER_MONTH = 1_000;
const LNI_WARRANT_MILLI_PERCENT = 5_000; // 5% of the tax
const LNI_WARRANT_MIN_CENTS = 500; // "not less than five dollars"
const LNI_WARRANT_MAX_CENTS = 10_000; // "nor greater than one hundred dollars"

export type LniPenaltyInput = {
  readonly taxCents: number;
  readonly dueDate: string;
  readonly paidDate: string;
  /** Set when L&I has issued a warrant for collection. */
  readonly warrantIssued?: boolean;
};

export function computeLniPenalty(input: LniPenaltyInput): PenaltyResult {
  const bad = validateInputs(input.taxCents, input.dueDate, input.paidDate);
  if (bad) return { ok: false, refusal: bad };

  const due = rollWeekendForward(input.dueDate);
  const daysLate = daysBetween(due.effective, input.paidDate);
  if (daysLate <= 0) {
    return refuse(
      "paid_before_due",
      `Paid ${input.paidDate}, on or before the effective due date ${due.effective}. Nothing is owed.`,
    );
  }

  const months = monthsOrPartThereof(due.effective, input.paidDate);
  const components: PenaltyComponent[] = [];
  const caveats: PenaltyCaveat[] = [];

  const tierIndex = months >= 3 ? 2 : months - 1;
  const tierRate = LNI_TIERS_MILLI_PERCENT[tierIndex];
  const rawPenalty = applyMilliPercent(input.taxCents, tierRate);
  const penalty = applyFloor(rawPenalty, LNI_PENALTY_FLOOR_CENTS);

  components.push({
    key: "lni_late_payment_penalty",
    label: `Late premium penalty (month ${months >= 3 ? "3+" : String(months)} tier)`,
    amountCents: penalty,
    isInterest: false,
    deductibility: "not_deductible_irc_162f",
    authorityId: "rcw-51-48-210-lni-late-penalty",
    workings:
      `${months} month(s) or part thereof late. RCW 51.48.210 sets a TOTAL penalty of ` +
      `${tierRate / 1000}% at that tier. ${tierRate / 1000}% of ${input.taxCents} cents = ` +
      `${rawPenalty} cents.` +
      (penalty !== rawPenalty ? ` Raised to the $10 statutory floor.` : ""),
  });

  if (months >= 3) {
    caveats.push({
      code: "lni_schedule_exhausted",
      message:
        "RCW 51.48.210 stops at 20% after the third month. This engine holds there rather than " +
        "inventing a fourth tier.",
      authorityId: "rcw-51-48-210-lni-late-penalty",
    });
  }

  if (input.warrantIssued === true) {
    const rawWarrant = applyMilliPercent(input.taxCents, LNI_WARRANT_MILLI_PERCENT);
    const bounded =
      rawWarrant < LNI_WARRANT_MIN_CENTS
        ? LNI_WARRANT_MIN_CENTS
        : rawWarrant > LNI_WARRANT_MAX_CENTS
          ? LNI_WARRANT_MAX_CENTS
          : rawWarrant;

    components.push({
      key: "lni_warrant_penalty",
      label: "Warrant penalty",
      amountCents: bounded,
      isInterest: false,
      deductibility: "not_deductible_irc_162f",
      authorityId: "rcw-51-48-210-lni-late-penalty",
      workings:
        `RCW 51.48.210: 5% of the tax when a warrant issues, "but not less than five dollars nor ` +
        `greater than one hundred dollars." 5% of ${input.taxCents} cents = ${rawWarrant} cents, ` +
        `bounded to ${bounded} cents. Note this cap is absolute — on a large balance the warrant ` +
        `penalty stops at $100.`,
    });

    caveats.push({
      code: "lni_warrant_means_escalation",
      message:
        "A warrant is not just another 5%. Under RCW 51.16.150 an L&I default that survives a written " +
        "demand lets the State require a bond of DOUBLE a year's estimated premiums and, failing that, " +
        "obtain an injunction restraining you from working at all — and it clouds any sale, transfer or " +
        "lease of the business until the delinquency is cured. Treat this as an emergency, not a bill.",
      authorityId: "rcw-51-16-150-lni-injunction",
    });
  }

  const interest = applyMilliPercent(
    input.taxCents,
    LNI_INTEREST_MILLI_PERCENT_PER_MONTH * months,
  );
  components.push({
    key: "lni_interest",
    label: "Interest on delinquent premiums",
    amountCents: interest,
    isInterest: true,
    deductibility: "deductible_business_expense",
    authorityId: "rcw-51-48-210-lni-late-penalty",
    workings:
      `RCW 51.48.210: "one percent of the delinquent amount per month or fraction thereof". ` +
      `${months} month(s) x 1% of ${input.taxCents} cents = ${interest} cents. Simple, not compounded.`,
  });

  // EXACT: RCW 51.48.210 states the schedule, the $10 floor and the bounded
  // warrant penalty outright.
  return finish("wa_lni", input.taxCents, due, input.paidDate, daysLate, components, caveats, true);
}

// ---------------------------------------------------------------------------
// 6) WA DEPARTMENT OF REVENUE — RCW 82.32.090
//
//    ⚠️ DIFFERENT NUMBERS **AND** A DIFFERENT CLOCK. 9/19/29 on calendar
//    month-ends. This is the function that proves a shared implementation
//    would have been wrong.
// ---------------------------------------------------------------------------

/** 9% / 19% / 29% — RUNNING TOTALS. RCW 82.32.090(1). */
const DOR_TIERS_MILLI_PERCENT = [9_000, 19_000, 29_000] as const;
/** "No penalty so added may be less than $5." */
const DOR_PENALTY_FLOOR_CENTS = 500;
/** RCW 82.32.090(3): warrant penalty 10%, "but not less than $10". */
const DOR_WARRANT_MILLI_PERCENT = 10_000;
const DOR_WARRANT_MIN_CENTS = 1_000;

export type DorPenaltyInput = {
  readonly taxCents: number;
  readonly dueDate: string;
  readonly paidDate: string;
  /**
   * The DOR interest rate for the year, in milli-percent per ANNUM.
   * RCW 82.32.050(2): federal short-term averaged +2, set each January 1,
   * rounded to the nearest whole percent.
   *
   * REQUIRED and never defaulted. There is no "current rate" fallback, because
   * a defaulted interest rate is a silent plug (standing rule 12) and because
   * the statutory formula needs four historical federal short-term rates that
   * this system does not hold. Pass the evidenced rate or get a refusal.
   */
  readonly annualInterestMilliPercent?: number;
  readonly warrantIssued?: boolean;
};

export function computeDorPenalty(input: DorPenaltyInput): PenaltyResult {
  const bad = validateInputs(input.taxCents, input.dueDate, input.paidDate);
  if (bad) return { ok: false, refusal: bad };

  const due = rollWeekendForward(input.dueDate);
  const daysLate = daysBetween(due.effective, input.paidDate);
  if (daysLate <= 0) {
    return refuse(
      "paid_before_due",
      `Paid ${input.paidDate}, on or before the effective due date ${due.effective}. Nothing is owed.`,
    );
  }

  const step = dorPenaltyStep(due.effective, input.paidDate);
  // step is 1..3 here because daysLate > 0 guarantees it is not 0.
  const tierRate = DOR_TIERS_MILLI_PERCENT[step - 1];
  const rawPenalty = applyMilliPercent(input.taxCents, tierRate);
  const penalty = applyFloor(rawPenalty, DOR_PENALTY_FLOOR_CENTS);

  const components: PenaltyComponent[] = [];
  const caveats: PenaltyCaveat[] = [];

  components.push({
    key: "dor_late_payment_penalty",
    label: `Late payment penalty (step ${step})`,
    amountCents: penalty,
    isInterest: false,
    deductibility: "not_deductible_irc_162f",
    authorityId: "rcw-82-32-090-dor-late-penalty",
    workings:
      `RCW 82.32.090(1) is keyed to CALENDAR MONTH-ENDS, not elapsed months: 9% immediately, a ` +
      `TOTAL of 19% if unpaid after the last day of the month following the due date, a TOTAL of ` +
      `29% after the last day of the second month following. Due ${due.effective}, paid ` +
      `${input.paidDate} puts this at step ${step} = ${tierRate / 1000}%. ` +
      `${tierRate / 1000}% of ${input.taxCents} cents = ${rawPenalty} cents.` +
      (penalty !== rawPenalty ? ` Raised to the $5 statutory floor.` : ""),
  });

  if (input.warrantIssued === true) {
    const rawWarrant = applyMilliPercent(input.taxCents, DOR_WARRANT_MILLI_PERCENT);
    const warrant = applyFloor(rawWarrant, DOR_WARRANT_MIN_CENTS);
    components.push({
      key: "dor_warrant_penalty",
      label: "Warrant penalty",
      amountCents: warrant,
      isInterest: false,
      deductibility: "not_deductible_irc_162f",
      authorityId: "rcw-82-32-090-dor-late-penalty",
      workings:
        `RCW 82.32.090(3): 10% of the tax when a warrant issues, "but not less than $10". ` +
        `10% of ${input.taxCents} cents = ${rawWarrant} cents -> ${warrant} cents. Unlike L&I's ` +
        `warrant penalty there is NO upper cap here.`,
    });
    caveats.push({
      code: "dor_penalties_stack",
      message:
        "RCW 82.32.090(8) says out loud that the penalties in subsections (1) through (4) \"can each " +
        "be imposed on the same tax found to be due.\" Late payment, substantial underpayment, warrant " +
        "and unregistered-business penalties STACK — they are not alternatives and the engine never " +
        "quietly takes the largest one.",
      authorityId: "rcw-82-32-090-dor-late-penalty",
    });
  }

  // ── INTEREST — refuse rather than default ────────────────────────────────
  if (input.annualInterestMilliPercent === undefined) {
    return refuse(
      "rate_not_evidenced_for_date",
      `DOR interest requires the evidenced annual rate for the year containing ${due.effective}. ` +
        `RCW 82.32.050(2) sets it as an average of the federal short-term rate plus two percentage ` +
        `points, fixed each January 1 and rounded to the nearest whole percent. This engine will not ` +
        `guess it and will not carry forward last year's. Load the rate as evidence, then ask again.`,
    );
  }
  if (
    !Number.isInteger(input.annualInterestMilliPercent) ||
    input.annualInterestMilliPercent < 0
  ) {
    return refuse(
      "rate_not_evidenced_for_date",
      `DOR annual interest rate must be a non-negative integer in milli-percent, got ` +
        `${input.annualInterestMilliPercent}.`,
    );
  }

  // RCW 82.32.050 computes interest by month-ends, mirroring the penalty steps.
  // Simple interest, annual rate pro-rated by whole months.
  const interestMonths = monthsOrPartThereof(due.effective, input.paidDate);
  const monthlyNumerator = input.annualInterestMilliPercent * interestMonths;
  // Divide by 12 with BigInt, half-up, so no float ever touches this.
  // (x*2 + 12) / 24 is (x/12) rounded half up, in exact integer arithmetic.
  // BigInt() constructor form, not `2n` literals — see applyMilliPercent.
  const interestRateMilliPercent = Number(
    (BigInt(monthlyNumerator) * BigInt(2) + BigInt(12)) / BigInt(24),
  );
  const interest = applyMilliPercent(input.taxCents, interestRateMilliPercent);

  components.push({
    key: "dor_interest",
    label: "Interest on deficiency",
    amountCents: interest,
    isInterest: true,
    deductibility: "deductible_business_expense",
    authorityId: "rcw-82-32-050-dor-interest",
    workings:
      `RCW 82.32.050(2): annual rate of ${input.annualInterestMilliPercent / 1000}% (federal ` +
      `short-term averaged, plus two points, set every January 1). Pro-rated over ` +
      `${interestMonths} month(s) = ${interestRateMilliPercent / 1000}% of ${input.taxCents} cents ` +
      `= ${interest} cents. Note DOR uses +2 points and resets ANNUALLY; the IRS uses +3 points and ` +
      `resets QUARTERLY. They are not the same rate and never will be.`,
  });

  caveats.push({
    code: "dor_interest_is_annual_evidence",
    message:
      "The DOR interest rate is fixed once a year and must come from DOR's published figure. It is " +
      "carried in the rate registry as a dated row, not computed here — computing it would need four " +
      "historical federal short-term rates that this system does not hold.",
    authorityId: "rcw-82-32-050-dor-interest",
  });

  // EXACT: the 9/19/29 schedule and the calendar-month-end triggers are
  // written into RCW 82.32.090(1). The interest RATE is not computed here at
  // all — it is supplied as an evidenced registry value or the caller gets a
  // refusal, so there is nothing approximate left in this result.
  return finish("wa_dor", input.taxCents, due, input.paidDate, daysLate, components, caveats, true);
}

// ---------------------------------------------------------------------------
// 7) WA LIQUOR AND CANNABIS BOARD — WAC 314-55-092
//
//    The 37% excise tax. 2% PER MONTH, genuinely accumulating (not a running
//    total table), no stated cap, no interest provision at all.
//
//    ⭐ And the money was never Michael's: RCW 69.50.535(4) says the tax "is
//    deemed to be held in trust by the seller until paid to the board."
// ---------------------------------------------------------------------------

/** WAC 314-55-092(1): "two percent per month ... on the outstanding balance". */
const LCB_MILLI_PERCENT_PER_MONTH = 2_000;
/** WAC 314-55-089(1)(c): due "on or before the 20th day of each month". */
export const LCB_DUE_DAY_OF_MONTH = 20;

/**
 * The LCB due date for a given sales month: the 20th of the FOLLOWING month,
 * rolled forward off a weekend.
 *
 * @param salesMonthIso any date inside the month of sale (e.g. "2026-01-15")
 */
export function lcbDueDateForSalesMonth(salesMonthIso: string): RolledDueDate {
  assertIso("lcbDueDateForSalesMonth", salesMonthIso);
  const year = Number(salesMonthIso.slice(0, 4));
  const month = Number(salesMonthIso.slice(5, 7));
  // 20th of the following month.
  const raw = new Date(Date.UTC(year, month, LCB_DUE_DAY_OF_MONTH))
    .toISOString()
    .slice(0, 10);
  return rollWeekendForward(raw);
}

/**
 * ⚠️ NOTE WHAT IS *NOT* IN THIS TYPE: a `dueDate`.
 *
 * An earlier draft took one, and that was a defect caught by probing the
 * engine rather than by reading it. The LCB deadline is not a fact about a
 * particular payment that a caller gets to supply — it is a RULE:
 * WAC 314-55-089(1)(c) fixes it at the 20th of the month following the month
 * of sale, full stop. Accepting a caller-supplied due date means any screen,
 * any import, any future author can hand this function the 25th and get a
 * confidently wrong penalty with no error anywhere.
 *
 * So the caller supplies the only thing it actually knows — WHICH MONTH the
 * sales happened in — and the engine derives the deadline from the rule. The
 * wrong due date is now unrepresentable rather than merely discouraged, which
 * is standing rule 14: gate it, don't warn about it.
 */
export type LcbPenaltyInput = {
  readonly taxCents: number;
  /** Any date inside the MONTH OF SALE, e.g. "2026-01-15" for January sales. */
  readonly salesMonth: string;
  readonly paidDate: string;
};

export function computeLcbPenalty(input: LcbPenaltyInput): PenaltyResult {
  // Validate the sales month FIRST — lcbDueDateForSalesMonth throws on a bad
  // date, and a throw is not a refusal. Every other agency function returns a
  // structured refusal for bad input and this one must not be the exception.
  if (!isValidIsoDate(input.salesMonth)) {
    return refuse(
      "invalid_date",
      `Sales month is not a valid ISO date (YYYY-MM-DD): ${JSON.stringify(input.salesMonth)}. ` +
        `Pass any day inside the month the sales happened in — the 20th-of-next-month deadline is ` +
        `derived from WAC 314-55-089(1)(c), never supplied by the caller.`,
    );
  }

  const due = lcbDueDateForSalesMonth(input.salesMonth);
  const bad = validateInputs(input.taxCents, due.original, input.paidDate);
  if (bad) return { ok: false, refusal: bad };
  const daysLate = daysBetween(due.effective, input.paidDate);
  if (daysLate <= 0) {
    return refuse(
      "paid_before_due",
      `Paid ${input.paidDate}, on or before the effective due date ${due.effective}. Nothing is owed.`,
    );
  }

  const months = monthsOrPartThereof(due.effective, input.paidDate);
  const rate = LCB_MILLI_PERCENT_PER_MONTH * months;
  const penalty = applyMilliPercent(input.taxCents, rate);

  const components: PenaltyComponent[] = [
    {
      key: "lcb_late_excise_penalty",
      label: "Late cannabis excise tax penalty",
      amountCents: penalty,
      isInterest: false,
      deductibility: "not_deductible_irc_162f",
      authorityId: "wac-314-55-092-lcb-late-excise",
      workings:
        `WAC 314-55-092(1): "A penalty of two percent per month will be assessed on the outstanding ` +
        `balance for any payments postmarked after the 20th day of the month following the month of ` +
        `sale." ${months} month(s) x 2% = ${rate / 1000}% of ${input.taxCents} cents = ${penalty} cents. ` +
        `Unlike ESD/L&I/DOR this is NOT a running-total table — it genuinely accumulates, so month 4 ` +
        `is 8% and there is no stated ceiling.`,
    },
  ];

  const caveats: PenaltyCaveat[] = [
    {
      code: "lcb_outstanding_balance_ambiguous",
      message:
        'WAC 314-55-092 charges 2% per month "on the outstanding balance" but never says whether ' +
        "previously accrued penalty is itself part of that balance. Read one way it is simple interest " +
        "on the tax; read the other it compounds. The rule does not resolve it, so this engine computes " +
        "the SIMPLE reading and refuses to pick the other silently. Treat the number as an estimate and " +
        "reconcile to the LCB's own notice before you book it.",
      authorityId: "wac-314-55-092-lcb-late-excise",
    },
    {
      code: "lcb_money_is_held_in_trust",
      message:
        "This one is not like the others. RCW 69.50.535(4): the 37% excise tax \"is deemed to be held " +
        "in trust by the seller until paid to the board\", and if you fail to pay it — \"whether such " +
        "failure is the result of the seller's own acts or the result of acts or conditions beyond the " +
        "seller's control\" — you are \"personally liable to the state for the amount of the tax.\" " +
        "There is no bad-luck defence and no LLC shield. For a cash-only store this is the single most " +
        "dangerous dollar in the building: it is not your money and it never was.",
      authorityId: "rcw-69-50-535-excise-trust",
    },
    {
      code: "lcb_license_is_at_risk",
      message:
        "WAC 314-55-092(2): failure to report and/or pay \"will be sufficient grounds for the LCB to " +
        "suspend or revoke a cannabis license.\" The exposure here is not the 2% — it is the licence.",
      authorityId: "wac-314-55-092-lcb-late-excise",
    },
  ];

  // NOT EXACT, and this is the whole reason `isExact` is an explicit argument.
  // WAC 314-55-092(1) charges 2% per month "on the outstanding balance" and
  // never defines whether an unpaid penalty is itself part of that balance.
  // Simple or compounding? The rule does not say. This engine computes the
  // SIMPLE reading and declares the result an estimate rather than presenting
  // a coin-flip as a fact (standing rule 12 — no silent plugs).
  return finish(
    "wa_lcb",
    input.taxCents,
    due,
    input.paidDate,
    daysLate,
    components,
    caveats,
    false,
  );
}

// ---------------------------------------------------------------------------
// 8) IRS — IRC §6656 (deposits) and §6651 (file / pay)
//
//    ⚠️ THE FEDERAL CLOCK IS IN **DAYS**. This is why Michael's biweekly habit
//    is expensive: by the time Washington notices, the IRS is already at 10%.
// ---------------------------------------------------------------------------

/** IRC §6656(b)(1). Day thresholds, not months. */
const IRS_DEPOSIT_2_PERCENT = 2_000;
const IRS_DEPOSIT_5_PERCENT = 5_000;
const IRS_DEPOSIT_10_PERCENT = 10_000;
const IRS_DEPOSIT_15_PERCENT = 15_000;

export type IrsDepositPenaltyInput = {
  readonly taxCents: number;
  readonly dueDate: string;
  readonly paidDate: string;
  /**
   * True once the IRS has issued a notice and demand (or the taxpayer was
   * designated). §6656(b)(1)(B) then makes the rate a flat 15%.
   */
  readonly afterNoticeAndDemand?: boolean;
};

/**
 * IRC §6656 failure-to-deposit. Returns the applicable percentage in
 * milli-percent for a given lateness in days. Exported so the tests can sweep
 * the boundary days directly rather than through the whole assessment.
 */
export function irsDepositRateMilliPercent(
  daysLate: number,
  afterNoticeAndDemand: boolean,
): number {
  if (!Number.isInteger(daysLate)) {
    throw new Error(`irsDepositRateMilliPercent: daysLate must be an integer, got ${daysLate}`);
  }
  if (daysLate <= 0) return 0;
  if (afterNoticeAndDemand) return IRS_DEPOSIT_15_PERCENT;
  // "(i) 2 percent if the failure is for not more than 5 days"
  if (daysLate <= 5) return IRS_DEPOSIT_2_PERCENT;
  // "(ii) 5 percent if ... more than 5 days but not more than 15 days"
  if (daysLate <= 15) return IRS_DEPOSIT_5_PERCENT;
  // "(iii) 10 percent if the failure is for more than 15 days"
  return IRS_DEPOSIT_10_PERCENT;
}

export function computeIrsDepositPenalty(input: IrsDepositPenaltyInput): PenaltyResult {
  const bad = validateInputs(input.taxCents, input.dueDate, input.paidDate);
  if (bad) return { ok: false, refusal: bad };

  const due = rollWeekendForward(input.dueDate);
  const daysLate = daysBetween(due.effective, input.paidDate);
  if (daysLate <= 0) {
    return refuse(
      "paid_before_due",
      `Deposited ${input.paidDate}, on or before the effective due date ${due.effective}. Nothing is owed.`,
    );
  }

  const afterNotice = input.afterNoticeAndDemand === true;
  const rate = irsDepositRateMilliPercent(daysLate, afterNotice);
  const penalty = applyMilliPercent(input.taxCents, rate);

  const components: PenaltyComponent[] = [
    {
      key: "irs_failure_to_deposit",
      label: `Failure-to-deposit penalty (${rate / 1000}%)`,
      amountCents: penalty,
      isInterest: false,
      deductibility: "not_deductible_irc_162f",
      authorityId: "irc-6656-deposit-penalty",
      workings:
        `IRC §6656(b)(1) counts DAYS: 2% at 1-5 days, 5% at 6-15 days, 10% beyond 15 days, and a ` +
        `flat 15% once the IRS has issued notice and demand. ${daysLate} day(s) late` +
        (afterNotice ? " (after notice and demand)" : "") +
        ` = ${rate / 1000}% of ${input.taxCents} cents = ${penalty} cents. There is NO dollar floor ` +
        `on this penalty and no cap.`,
    },
  ];

  const caveats: PenaltyCaveat[] = [
    {
      code: "irs_counts_days_not_months",
      message:
        "This is the one that catches a biweekly payer. Washington is still inside its first month " +
        "while the IRS has already stepped twice: six days late is 5% federally, sixteen days late is " +
        "10%. The federal meter runs three times faster than the state one at the start.",
      authorityId: "irc-6656-deposit-penalty",
    },
    {
      code: "irs_interest_not_included",
      message:
        "Interest is NOT included in this number, and since books-21 it is computed by a different " +
        "engine: computeInterest in interest-core.ts. Federal interest runs at the IRC §6621 " +
        "underpayment rate (federal short-term plus 3 points, reset every quarter) and it COMPOUNDS " +
        "DAILY under IRC §6622, so it is not a percentage that can be added to the figure above. Two " +
        "things worth knowing while you wait for it. The penalties here are capped and the interest is " +
        "not, so on a balance more than a year old the interest is usually the larger number. And the " +
        "punitive §6621(c) rate — five points instead of three — cannot apply to Greenway at all, " +
        "because §6621(c)(3)(A) restricts it to a C corporation and §1361(a)(2) says an S corporation " +
        "is not one.",
      authorityId: "irc-6621-a-2-underpayment-rate",
    },
    {
      code: "irs_reasonable_cause_exists",
      message:
        "§6656(a) excuses a failure \"due to reasonable cause and not due to willful neglect.\" That is " +
        "a real defence, but it has to be argued and it is not a plan. \"I forgot\" is the textbook " +
        "example of willful neglect.",
      authorityId: "irc-6656-deposit-penalty",
    },
  ];

  // EXACT: IRC §6656(b)(1) is a pure day-count table with no floor, no cap and
  // no discretion. Interest is deliberately not part of this number.
  return finish("irs", input.taxCents, due, input.paidDate, daysLate, components, caveats, true);
}

/**
 * IRC §6651 — failure to FILE (a)(1) and failure to PAY (a)(2), including the
 * interaction in (c)(1) that almost everybody gets wrong.
 *
 * ⭐ §6651(c)(1): "the amount of the addition under paragraph (1) ... shall be
 * reduced by the amount of the addition under paragraph (2) ... for any month
 * (or fraction thereof) to which an addition to tax applies under both."
 *
 * So filing late AND paying late in the same month is 5.0% total (4.5% + 0.5%),
 * NOT 5.5%. Naively summing the two schedules overstates the penalty by 10% of
 * itself every single month.
 */
const IRS_FTF_PER_MONTH = 5_000; // 5%
const IRS_FTF_CAP = 25_000; // 25%
const IRS_FTP_PER_MONTH = 500; // 0.5%
const IRS_FTP_CAP = 25_000; // 25%

export type IrsFilePayPenaltyInput = {
  readonly taxCents: number;
  readonly dueDate: string;
  /** When the return was actually filed. Omit if filed on time. */
  readonly filedDate?: string;
  /** When the tax was actually paid. */
  readonly paidDate: string;
};

export function computeIrsFilePayPenalty(input: IrsFilePayPenaltyInput): PenaltyResult {
  const bad = validateInputs(input.taxCents, input.dueDate, input.paidDate);
  if (bad) return { ok: false, refusal: bad };
  if (input.filedDate !== undefined && !isValidIsoDate(input.filedDate)) {
    return refuse(
      "invalid_date",
      `Filed date is not a valid ISO date (YYYY-MM-DD): ${JSON.stringify(input.filedDate)}`,
    );
  }

  const due = rollWeekendForward(input.dueDate);
  const payDaysLate = daysBetween(due.effective, input.paidDate);
  const fileDaysLate =
    input.filedDate === undefined ? 0 : daysBetween(due.effective, input.filedDate);

  if (payDaysLate <= 0 && fileDaysLate <= 0) {
    return refuse(
      "paid_before_due",
      `Filed and paid on or before the effective due date ${due.effective}. Nothing is owed.`,
    );
  }

  const payMonths = payDaysLate > 0 ? monthsOrPartThereof(due.effective, input.paidDate) : 0;
  const fileMonths =
    input.filedDate !== undefined && fileDaysLate > 0
      ? monthsOrPartThereof(due.effective, input.filedDate)
      : 0;

  const components: PenaltyComponent[] = [];
  const caveats: PenaltyCaveat[] = [];

  // Failure to pay: 0.5% per month or fraction, capped at 25% aggregate.
  const ftpRateUncapped = IRS_FTP_PER_MONTH * payMonths;
  const ftpRate = ftpRateUncapped > IRS_FTP_CAP ? IRS_FTP_CAP : ftpRateUncapped;
  const ftpAmount = payMonths > 0 ? applyMilliPercent(input.taxCents, ftpRate) : 0;

  // Failure to file: 5% per month or fraction, capped at 25% aggregate, THEN
  // reduced by the failure-to-pay addition for overlapping months.
  const ftfRateUncapped = IRS_FTF_PER_MONTH * fileMonths;
  const ftfRateBeforeOffset = ftfRateUncapped > IRS_FTF_CAP ? IRS_FTF_CAP : ftfRateUncapped;

  // §6651(c)(1) offset. THE SUBTLE PART, and the engine got this wrong once.
  //
  // The offset applies "for any month (or fraction thereof) to which an
  // addition to tax applies under BOTH paragraphs (1) and (2)". Once the
  // failure-to-file penalty has hit its 25% ceiling it STOPS ACCRUING, so
  // from that month on no addition arises under paragraph (1) and there is
  // nothing left for paragraph (2) to reduce. The offset therefore stops
  // growing too.
  //
  // The earlier version multiplied the offset by every overlapping month
  // without limit. At 50 months that subtracted 25% from a 25% penalty and
  // reported a failure-to-file penalty of ZERO, which is nonsense: it made a
  // longer delinquency cheaper, and it capped the combined federal exposure
  // at 25% when the real ceiling is 47.5%. On a $10,000 liability that is a
  // $2,250 understatement, reported as though it were reliable.
  //
  // IRS, "Failure to file penalty" (irs.gov, reviewed 07-Feb-2026), verbatim:
  //   "If failure to file and failure to pay penalties both apply, the failure
  //    to file penalty is reduced by the amount of the failure to pay penalty
  //    (0.5% for each month). After 5 months the failure to file penalty will
  //    max out, but the failure to pay penalty continues."
  //
  // So the ladder is 4.5%/month for five months (22.5% total), then the
  // failure-to-pay 0.5%/month runs alone to its own separate 25% ceiling:
  //   22.5% + 25% = 47.5% maximum in additions, before a dollar of interest.
  const ftfAccrualMonths = Math.min(fileMonths, IRS_FTF_CAP / IRS_FTF_PER_MONTH);
  const overlapMonths = Math.min(ftfAccrualMonths, payMonths);
  const offsetRate = IRS_FTP_PER_MONTH * overlapMonths;
  const ftfRate = ftfRateBeforeOffset > offsetRate ? ftfRateBeforeOffset - offsetRate : 0;
  const ftfAmount = fileMonths > 0 ? applyMilliPercent(input.taxCents, ftfRate) : 0;

  if (fileMonths > 0) {
    components.push({
      key: "irs_failure_to_file",
      label: "Failure-to-file penalty",
      amountCents: ftfAmount,
      isInterest: false,
      deductibility: "not_deductible_irc_162f",
      authorityId: "irc-6651-failure-to-file",
      workings:
        `IRC §6651(a)(1): 5% per month or fraction, capped at 25%. ${fileMonths} month(s) = ` +
        `${ftfRateBeforeOffset / 1000}%` +
        (overlapMonths > 0
          ? `, then REDUCED by the failure-to-pay addition for the ${overlapMonths} overlapping ` +
            `month(s) per §6651(c)(1) (-${offsetRate / 1000}%) = ${ftfRate / 1000}%`
          : ` = ${ftfRate / 1000}%`) +
        `. Applied to ${input.taxCents} cents = ${ftfAmount} cents.`,
    });
  }

  if (payMonths > 0) {
    components.push({
      key: "irs_failure_to_pay",
      label: "Failure-to-pay penalty",
      amountCents: ftpAmount,
      isInterest: false,
      deductibility: "not_deductible_irc_162f",
      authorityId: "irc-6651-failure-to-file",
      workings:
        `IRC §6651(a)(2): 0.5% per month or fraction, capped at 25%. ${payMonths} month(s) = ` +
        `${ftpRate / 1000}% of ${input.taxCents} cents = ${ftpAmount} cents.`,
    });
  }

  if (overlapMonths > 0) {
    caveats.push({
      code: "irs_6651c1_offset_applied",
      message:
        "Filing late and paying late in the same month is NOT 5.5% a month. IRC §6651(c)(1) reduces " +
        "the failure-to-file penalty by the failure-to-pay penalty for every month both apply, so the " +
        "combined bite is 5.0% (4.5% + 0.5%). Adding the two published schedules together — which is " +
        "what almost every online calculator does — overstates the penalty by 10% of itself each month.",
      authorityId: "irc-6651-failure-to-file",
    });
  }

  if (ftfRateUncapped > IRS_FTF_CAP || ftpRateUncapped > IRS_FTP_CAP) {
    caveats.push({
      code: "irs_6651_cap_reached",
      message:
        "One or both §6651 penalties have hit their 25% aggregate ceiling and stop growing. The " +
        "interest does not stop, and neither does the §6656 deposit penalty if this was a deposit.",
      authorityId: "irc-6651-failure-to-file",
    });
  }

  caveats.push({
    code: "irs_6651_60day_minimum_not_applied",
    message:
      "IRC §6651(a) also sets a minimum for a chapter 1 return more than 60 days late — the lesser of " +
      "the §6651(j) inflation-adjusted figure or 100% of the tax. This engine still does not APPLY that " +
      "minimum, so the number above may be understated for a very late income tax return — but since " +
      "books-21 the figures are on file: $450 for 2023, $485 for 2024 and $525 for 2025 and 2026, by " +
      "the year the return was required to be FILED, not the tax year it covers. Note the $435 in the " +
      "statute is the BASE and is correct as such, not a stale figure; §6651(j) inflates it annually, " +
      "and using the base for 2026 would understate the floor by $90. None of this affects payroll " +
      "deposits.",
    authorityId: "irc-6651-j-inflation-adjustment",
  });

  // §6699 IS NOT §6651, AND FOR AN S CORPORATION IT IS THE ONE THAT BITES.
  //
  // books-21 measured this rather than assuming it: asked what a year-late Form
  // 1120-S cost, this engine answered $0.00, because every penalty it knew about
  // is a percentage of the tax shown on the return and an S corporation normally
  // shows none. §6699 charges a flat amount per shareholder per month and never
  // mentions the tax at all. A system that reports a real five-figure exposure as
  // nothing does not merely fail to warn; it recommends the behaviour it exists to
  // prevent. Hence this caveat, on every IRS assessment.
  caveats.push({
    code: "irs_6699_s_corp_late_filing_separate",
    message:
      "If the late return is a Form 1120-S, the §6651 percentages above are NOT the main exposure. " +
      "IRC §6699 charges a flat amount per shareholder per month, up to 12 months, and makes no " +
      "reference to how much tax is due — so a return showing nothing owed carries exactly the same " +
      "penalty as one showing a million. With Greenway's three shareholders that is about $7,000 for a " +
      "year even at the un-inflated statutory base, and the ownership split is irrelevant: a 5% holder " +
      "costs exactly as much as an 85% holder. It is charged for each month or fraction thereof, so one " +
      "day late is a full month. Use computeSection6699Penalty in interest-core.ts for that number. " +
      "This engine does not fold it in, because it is a different penalty on a different base and " +
      "adding the two together would hide which one is which.",
    authorityId: "irc-6699-s-corp-failure-to-file",
  });

  // NOT EXACT — and unusually, it may be UNDERSTATED rather than approximate.
  // §6651(a)'s flush text imposes a minimum on a chapter 1 return more than 60
  // days late (the lesser of the §6651(j) inflation-adjusted figure or 100% of
  // the tax). This engine does not hold that evidenced figure, so it does not
  // apply the minimum. Reporting a possibly-low number as "exact" would be the
  // worst of both worlds: wrong, and confidently so.
  return finish(
    "irs",
    input.taxCents,
    due,
    input.paidDate,
    Math.max(payDaysLate, fileDaysLate),
    components,
    caveats,
    false,
  );
}

// ---------------------------------------------------------------------------
// 9) ASSEMBLY — shared only for TOTALLING, never for the schedules
// ---------------------------------------------------------------------------

/**
 * Assemble the final assessment. This is the ONLY thing the five agency
 * functions share, and it deliberately shares no schedule, no rate and no
 * clock — only addition and the result shape.
 *
 * `isExact` is an EXPLICIT PARAMETER, not something inferred here. An earlier
 * draft of this file derived it with
 * `caveats.every((c) => !c.code.includes("ambiguous"))`, which is a defect
 * dressed up as cleverness: it silently makes the correctness of a money
 * number depend on whether a future author happens to spell "ambiguous" inside
 * a caveat code. Rename a code and an estimate starts presenting itself as
 * exact, with nothing failing. The agency function knows perfectly well
 * whether it had to make a judgement call, so it says so directly.
 */
function finish(
  agency: TaxAgency,
  taxCents: number,
  due: RolledDueDate,
  paidDate: string,
  daysLate: number,
  components: readonly PenaltyComponent[],
  caveats: readonly PenaltyCaveat[],
  isExact: boolean,
): PenaltyResult {
  let penaltyTotal = 0;
  let interestTotal = 0;

  for (const c of components) {
    // Split on the explicit category, NEVER on deductibility. Non-deductible
    // interest exists (Treas. Reg. §1.163-9T(b)(2)(i)(A)) and it is still
    // interest. See the long note on PenaltyComponent.isInterest.
    if (c.isInterest) {
      interestTotal += c.amountCents;
    } else {
      penaltyTotal += c.amountCents;
    }
  }

  return {
    ok: true,
    assessment: {
      agency,
      agencyLabel: TAX_AGENCY_LABELS[agency],
      taxCents,
      dueDate: due,
      paidDate,
      daysLate,
      components,
      totalPenaltyCents: penaltyTotal,
      totalInterestCents: interestTotal,
      totalAddedCents: penaltyTotal + interestTotal,
      isExact,
      caveats,
    },
  };
}

// ---------------------------------------------------------------------------
// 10) THE LEDGER CONSEQUENCE — where these dollars actually go
// ---------------------------------------------------------------------------

/**
 * A penalty is not deductible and interest (usually) is. Booking both to one
 * "penalties and interest" account produces a wrong tax return in two
 * directions at once, and then somebody has to reconstruct the split from
 * notices at year end. This function does the split up front.
 */
export type BookingInstruction = {
  readonly accountHint: string;
  readonly amountCents: number;
  readonly deductibility: Deductibility;
  readonly scheduleM1Addback: boolean;
  readonly why: string;
};

export function bookingInstructions(
  assessment: PenaltyAssessment,
): readonly BookingInstruction[] {
  return assessment.components.map((c) => {
    // TWO independent questions, answered from TWO independent fields.
    //
    //   isInterest    -> which EXPENSE ACCOUNT this belongs in
    //   deductibility -> whether it gets ADDED BACK on Schedule M-1
    //
    // They are not the same question and they do not always agree. There are
    // three live combinations, not two:
    //
    //   penalty, non-deductible        - every agency penalty (§162(f)(1))
    //   interest, deductible           - late payroll/sales/excise interest
    //                                    (Treas. Reg. §1.163-9T(b)(2)(iii)(A))
    //   interest, NON-deductible       - interest on Michael's personal 1040
    //                                    deficiency flowing off a Greenway K-1
    //                                    (Treas. Reg. §1.163-9T(b)(2)(i)(A))
    //
    // That third row is why deriving one field from the other was a defect.
    const nonDeductible = c.deductibility !== "deductible_business_expense";

    const accountHint = c.isInterest
      ? nonDeductible
        ? "Expense: Interest — Taxes (NON-DEDUCTIBLE, personal interest)"
        : "Expense: Interest — Taxes"
      : "Expense: Fines & Penalties (NON-DEDUCTIBLE)";

    let why: string;
    if (!c.isInterest) {
      why =
        "IRC §162(f)(1) denies a deduction for any amount paid to a government in relation to the " +
        "violation of a law. It still leaves the bank account, so it is a real book expense — it " +
        "just gets added back on Schedule M-1. Keeping it in its own account means that add-back " +
        "falls out of the books instead of being rebuilt from agency notices in April.";
    } else if (!nonDeductible) {
      why =
        "Interest on a business tax is not 'personal interest' — Treas. Reg. §1.163-9T(b)(2)(iii)(A) " +
        "expressly carves out interest on sales, excise and similar taxes incurred in a trade or " +
        "business, so this one is deductible. It goes in the interest account, NOT the penalty " +
        "account, and it is not added back. The separate §280E question is handled by the §280E " +
        "layer and not pre-collapsed into this answer.";
    } else {
      why =
        "This is interest, so it belongs in an interest account — but it is still not deductible. " +
        "Treas. Reg. §1.163-9T(b)(2)(i)(A) makes interest on an individual income tax underpayment " +
        "'personal interest' 'regardless of the source of the income generating the tax liability,' " +
        "and the regulation's own worked example is an S-corporation shareholder. So it is booked as " +
        "interest for accuracy and added back on Schedule M-1 for the return. Filing it as a penalty " +
        "would be tidier and wrong.";
    }

    return {
      accountHint,
      amountCents: c.amountCents,
      deductibility: c.deductibility,
      scheduleM1Addback: nonDeductible,
      why,
    };
  });
}

// ---------------------------------------------------------------------------
// 11) SELF-DESCRIPTION — so the UI never hard-codes a rule
// ---------------------------------------------------------------------------

export type AgencyClockDescription = {
  readonly agency: TaxAgency;
  readonly label: string;
  readonly countsBy: "elapsed_months_or_part" | "calendar_month_ends" | "days";
  readonly schedule: string;
  readonly isRunningTotal: boolean;
  readonly floorCents: number | null;
  readonly capMilliPercent: number | null;
  readonly interest: string;
  readonly authorityId: string;
};

/**
 * The five clocks, as DATA. Rendered on screen so Michael can see at a glance
 * why one agency's answer differs from another's on identical facts.
 */
export const AGENCY_CLOCKS: readonly AgencyClockDescription[] = [
  {
    agency: "wa_esd",
    label: TAX_AGENCY_LABELS.wa_esd,
    countsBy: "elapsed_months_or_part",
    schedule: "5% / 10% / 20% (running totals, stops at the third month)",
    isRunningTotal: true,
    floorCents: ESD_PENALTY_FLOOR_CENTS,
    capMilliPercent: 20_000,
    interest: "1% per month or fraction thereof, simple (RCW 50.24.040)",
    authorityId: "rcw-50-12-220-esd-late-penalty",
  },
  {
    agency: "wa_lni",
    label: TAX_AGENCY_LABELS.wa_lni,
    countsBy: "elapsed_months_or_part",
    schedule: "5% / 10% / 20% (running totals) + warrant 5% bounded $5-$100",
    isRunningTotal: true,
    floorCents: LNI_PENALTY_FLOOR_CENTS,
    capMilliPercent: 20_000,
    interest: "1% per month or fraction thereof, simple (RCW 51.48.210)",
    authorityId: "rcw-51-48-210-lni-late-penalty",
  },
  {
    agency: "wa_dor",
    label: TAX_AGENCY_LABELS.wa_dor,
    countsBy: "calendar_month_ends",
    schedule: "9% / 19% / 29% (running totals, keyed to calendar month-ends)",
    isRunningTotal: true,
    floorCents: DOR_PENALTY_FLOOR_CENTS,
    capMilliPercent: 29_000,
    interest:
      "Federal short-term averaged + 2 points, fixed each January 1, rounded to a whole percent (RCW 82.32.050(2))",
    authorityId: "rcw-82-32-090-dor-late-penalty",
  },
  {
    agency: "wa_lcb",
    label: TAX_AGENCY_LABELS.wa_lcb,
    countsBy: "elapsed_months_or_part",
    schedule: "2% per month, accumulating, no stated cap",
    isRunningTotal: false,
    floorCents: null,
    capMilliPercent: null,
    interest: "None stated in WAC 314-55-092 — the 2% per month IS the charge",
    authorityId: "wac-314-55-092-lcb-late-excise",
  },
  {
    agency: "irs",
    label: TAX_AGENCY_LABELS.irs,
    countsBy: "days",
    schedule: "2% (1-5d) / 5% (6-15d) / 10% (>15d) / 15% after notice and demand",
    isRunningTotal: false,
    floorCents: null,
    capMilliPercent: null,
    interest:
      "Federal short-term + 3 points, reset QUARTERLY, COMPOUNDED DAILY (IRC §6621, §6622)",
    authorityId: "irc-6656-deposit-penalty",
  },
] as const;

/**
 * Re-exported so a screen can render the authority next to the number without
 * importing two modules and risking one of them going stale.
 */
export type { GuidanceAuthority };
