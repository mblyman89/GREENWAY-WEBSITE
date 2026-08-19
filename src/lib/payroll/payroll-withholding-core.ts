/**
 * src/lib/payroll/payroll-withholding-core.ts
 *
 * THE PAYROLL WITHHOLDING ENGINE. Pure, deterministic, integer-only.
 *
 * WHAT THIS IS, IN PLAIN ENGLISH (for Michael)
 * --------------------------------------------
 * When you pay an employee $1,000, you do not hand them $1,000. You hand them
 * what is left after you take out the money that was never theirs to keep and
 * was never yours to keep either: federal income tax, Social Security,
 * Medicare, and two Washington programs. Then, on top of the $1,000, YOU owe a
 * second set of taxes that never appear on their check at all.
 *
 * This file computes both halves of that, to the penny, from their W-4.
 *
 * THE ONE THING THAT MAKES PAYROLL HARD
 * --------------------------------------
 * There is no such thing as "wages." There are EIGHT different definitions of
 * wages in a single paycheck, each of which stops counting at a different
 * point in the year:
 *
 *   Social Security     stops at $184,500          (2026)
 *   Medicare            never stops
 *   Extra Medicare      STARTS at $200,000
 *   Federal unemployment stops at $7,000
 *   WA unemployment     stops at $78,200           (2026)
 *   WA Paid Leave       stops at $184,500          (by statute, = Social Security)
 *   WA Cares            NEVER STOPS                <- the trap
 *   L&I workers' comp   is not a percentage of money at all; it is per HOUR
 *
 * WA Paid Leave and WA Cares are reported to the same agency on the same
 * quarterly form, and they have different ceilings. That is the single most
 * common Washington payroll error. This engine keeps eight separate running
 * totals and can never confuse them, because there is no such variable as
 * "wages" anywhere in this file.
 *
 * WHY THERE ARE NO DECIMALS ANYWHERE IN HERE (Rule 13e)
 * ------------------------------------------------------
 * A floating-point number cannot represent 0.1 exactly. Add a tenth of a cent
 * of error to every line of every check for a year and you do not get a
 * rounding difference, you get a Form 941 that does not tie to your W-2s, which
 * is an automatic IRS notice. So: every amount in this file is an INTEGER
 * NUMBER OF CENTS and every rate is an INTEGER NUMBER OF THOUSANDTHS OF A
 * PERCENT ("milli-percent," per standing rule 4). 6.2% is the integer 6200.
 * $184,500.00 is the integer 18450000. Division happens in exactly three named
 * helpers, all of which round explicitly. There is not one `/` operator applied
 * to money outside of them.
 *
 * PROVENANCE OF THE TABLES
 * -------------------------
 * The six percentage-method tables below were transcribed from IRS Publication
 * 15-T (2026) page 12 and then PROVEN, not proofread. Two structural identities
 * that the IRS's own numbers must satisfy are asserted in the self-tests:
 *
 *   1. CONTINUITY - the tax at the top of a bracket must equal the tax at the
 *      bottom of the next one. This checks every base figure against the
 *      thresholds and rates around it.
 *   2. THE HALVING RULE - the Step-2-checkbox schedules are, exactly, the
 *      standard schedules with the line-1g standard-deduction offset added back
 *      and everything then cut in half. (That is what checking the box MEANS:
 *      "assume a second job about this size.") So $96,489.63 in the Step 2
 *      single table is provably half of $192,979.25 in the standard single
 *      table, and each confirms the other.
 *
 * A typo cannot survive both identities. See the self-tests at the bottom.
 *
 * Standing rules honored: 1 (never guess - unknown rates REFUSE rather than
 * default), 2 (no drift - the WA Paid Leave ceiling is DERIVED from the Social
 * Security constant and never typed twice), 4 (integer cents, milli-percent),
 * 13e (no floats in money paths), 14 (gate/block everything - see the refusal
 * union), 15 (every test provably capable of failing).
 */

import {
  PAY_PERIODS_PER_YEAR,
  type PayFrequency,
  type W4FilingStatus,
  type W4Record,
  isModernW4,
} from "./payroll-w4-core";

// ===========================================================================
// 1) EXACT INTEGER ARITHMETIC. The only three places division touches money.
// ===========================================================================

/**
 * The largest product we will tolerate before refusing to compute. JavaScript
 * integers are exact only up to 2^53-1; past that, `+ 1` silently does nothing.
 * Rather than let a hostile or fat-fingered input push us into the range where
 * arithmetic quietly lies, we refuse. (Rule 14: choose refusal.)
 */
const MAX_SAFE_PRODUCT = Number.MAX_SAFE_INTEGER;

/** One hundred percent, expressed in milli-percent. 100% = 100000. */
export const ONE_HUNDRED_PERCENT_MILLI = 100_000;

/**
 * Divide two integers, rounding halves AWAY FROM ZERO ("half up" for positive
 * money). This is the convention the IRS uses in Pub. 15-T's own rounding
 * instruction ("$2.50 becomes $3") and the one every payroll system uses.
 *
 * Implemented with `%` and comparison only - never `Math.round`, which takes a
 * float and would reintroduce exactly the error we are avoiding.
 */
export function divideRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new Error("divideRoundHalfUp requires integers - a float reached a money path");
  }
  if (denominator === 0) throw new Error("divideRoundHalfUp: division by zero");
  const negative = numerator < 0 !== denominator < 0;
  const a = Math.abs(numerator);
  const b = Math.abs(denominator);
  const q = Math.floor(a / b);
  const r = a - q * b;
  // r*2 >= b means the remainder is at or past the halfway mark.
  const rounded = r * 2 >= b ? q + 1 : q;
  return negative ? -rounded : rounded;
}

/**
 * Apply a milli-percent rate to an integer-cent amount, exactly.
 *
 *   applyMilliPct(18_450_000, 6_200) === 1_143_900
 *
 * That example is not decorative: the Social Security Administration publishes
 * "$11,439.00" as the maximum 2026 employee OASDI contribution, so this single
 * call is a free correctness oracle supplied by the government. If this
 * function is wrong, that assertion in the self-tests dies.
 */
export function applyMilliPct(amountCents: number, rateMilliPct: number): number {
  if (!Number.isInteger(amountCents) || !Number.isInteger(rateMilliPct)) {
    throw new Error("applyMilliPct requires integers - a float reached a money path");
  }
  const product = amountCents * rateMilliPct;
  if (!Number.isSafeInteger(product)) {
    throw new Error(
      `applyMilliPct overflow: ${amountCents} cents x ${rateMilliPct} milli-percent exceeds exact integer range`,
    );
  }
  if (Math.abs(product) > MAX_SAFE_PRODUCT) {
    throw new Error("applyMilliPct overflow");
  }
  return divideRoundHalfUp(product, ONE_HUNDRED_PERCENT_MILLI);
}

/**
 * Pub. 15-T "Rounding": withheld tax MAY be rounded to whole dollars, but "if
 * rounding is used, it must be used consistently." We therefore never round
 * implicitly; a caller must ask for it, and the setting is all-or-nothing.
 */
export function roundToWholeDollarCents(amountCents: number): number {
  if (!Number.isInteger(amountCents)) {
    throw new Error("roundToWholeDollarCents requires integer cents");
  }
  return divideRoundHalfUp(amountCents, 100) * 100;
}

/**
 * Integer cents to a dollar string, for refusal messages a human reads.
 *
 * Deliberately does its own digit work instead of dividing by 100, because
 * dividing integer cents by 100 creates a float, and this file's whole premise
 * is that a float never touches a money path (rule 13e). A number that only
 * appears in a sentence is still a number Michael will act on.
 */
export function formatCentsPlain(amountCents: number): string {
  if (!Number.isInteger(amountCents)) {
    throw new Error("formatCentsPlain requires integer cents - a float reached a money path");
  }
  const negative = amountCents < 0;
  const abs = Math.abs(amountCents);
  const dollars = Math.floor(abs / 100);
  const cents = abs - dollars * 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${String(cents).padStart(2, "0")}`;
}

/**
 * A FLAT-RATE TAX ON CUMULATIVE WAGES, COMPUTED SO THE YEAR ALWAYS LANDS EXACTLY
 * WHERE THE STATUTE SAYS IT SHOULD.
 *
 * THE PROBLEM THIS SOLVES, IN PLAIN ENGLISH.
 *
 * Social Security is 6.2% of the first $184,500. Multiply those two numbers and
 * you get $11,439.00 exactly - that is the figure the Social Security
 * Administration publishes, and it is the most an employee can have withheld all
 * year. Now pay somebody $17,333.33 a month for twelve months. That is $208,000
 * of wages, so they blow through the ceiling in October and the answer is still
 * supposed to be $11,439.00.
 *
 * If you compute each paycheck on its own - round 6.2% of this month's wages to
 * the nearest cent, then do it again next month - you finish the year at
 * $11,439.04. Four cents too much, taken out of a real person's pay. Change the
 * pay cadence and the error changes with it: semimonthly overshoots by 8 cents,
 * biweekly by 10 cents, daily by 31 cents. The error is not a bug in any single
 * paycheck. Every paycheck is individually correct to the penny. The error is
 * that twelve separately-rounded numbers do not have to add up to the rounded
 * total, and here they do not.
 *
 * THE FIX. Tax the RUNNING TOTAL, not the slice:
 *
 *     tax for this period = round(6.2% x wages through this period)
 *                         - round(6.2% x wages through last period)
 *
 * The terms telescope. Whatever this period rounds off, the next period picks
 * back up, and the final period is by definition round(6.2% x $184,500) minus
 * everything already taken - which is $11,439.00 on the nose, at every pay
 * cadence, with no special case for the last check of the year.
 *
 * WHY THE IRS DOES NOT SIMPLY FORBID THE NAIVE METHOD. It cannot; per-paycheck
 * rounding is normal and unavoidable, and the IRS says so in the Form 941
 * instructions for line 7, "Current quarter's adjustment for fractions of
 * cents": "The employee share of amounts shown in column 2 of lines 5a-5d may
 * differ slightly from amounts actually withheld from employees' pay due to the
 * rounding of social security and Medicare taxes based on statutory rates. This
 * adjustment may be a positive or a negative adjustment." That line exists to
 * absorb exactly this drift on the return.
 *
 * SO WHY NOT JUST USE LINE 7 AND MOVE ON? Because line 7 reconciles the
 * EMPLOYER'S RETURN. It does not give the employee their four cents back. This
 * engine takes the position that money we never should have taken out of
 * somebody's check should not come out of their check in the first place. Using
 * the cumulative method makes the fractions-of-cents adjustment converge on zero
 * for these taxes instead of quietly growing all year, which is also a much
 * easier quarterly return to explain to Michael.
 *
 * PRECONDITIONS. Both cumulative figures must be integer cents, and the running
 * total may not go backwards. A negative period is a corrected or voided check,
 * which is a different operation with a different audit trail; it is refused
 * here rather than silently netted.
 *
 * @param cumulativeTaxableBeforeCents taxable wages through the PRIOR period
 * @param cumulativeTaxableAfterCents  taxable wages through THIS period
 * @param rateMilliPct                 flat rate, integer milli-percent
 */
export function telescopingTaxForPeriod(
  cumulativeTaxableBeforeCents: number,
  cumulativeTaxableAfterCents: number,
  rateMilliPct: number,
): number {
  if (
    !Number.isInteger(cumulativeTaxableBeforeCents) ||
    !Number.isInteger(cumulativeTaxableAfterCents) ||
    !Number.isInteger(rateMilliPct)
  ) {
    throw new Error("telescopingTaxForPeriod requires integers - a float reached a money path");
  }
  if (cumulativeTaxableBeforeCents < 0 || cumulativeTaxableAfterCents < 0 || rateMilliPct < 0) {
    throw new Error("telescopingTaxForPeriod: cumulative wages and rate must be non-negative");
  }
  if (cumulativeTaxableAfterCents < cumulativeTaxableBeforeCents) {
    throw new Error(
      "telescopingTaxForPeriod: cumulative taxable wages went backwards. A negative pay period is a " +
        "correction or a void, which has to be recorded as its own reversing entry with its own audit " +
        "trail - it cannot be netted into a normal payroll run.",
    );
  }
  return (
    applyMilliPct(cumulativeTaxableAfterCents, rateMilliPct) -
    applyMilliPct(cumulativeTaxableBeforeCents, rateMilliPct)
  );
}

// ===========================================================================
// 2) THE 2026 PERCENTAGE-METHOD TABLES (Pub. 15-T (2026), p.12)
// ===========================================================================

/**
 * One row of an IRS withholding rate schedule.
 *
 * The bracket test in Worksheet 1A step 2b is ">= column A AND < column B".
 * We store only column A (`atLeastCents`) because column B of a row is always
 * column A of the next row, and storing it twice is exactly the kind of
 * duplicated fact that drifts (Rule 2). The last row has no column B.
 */
export type WithholdingBracket = {
  /** Column A: bracket floor, integer cents. */
  atLeastCents: number;
  /** Column C: tentative tax at the floor, integer cents. */
  baseTaxCents: number;
  /** Column D: marginal rate, integer milli-percent (22% = 22000). */
  rateMilliPct: number;
};

/** STANDARD schedule - Married Filing Jointly. Pub. 15-T (2026) p.12. */
export const STANDARD_MARRIED_FILING_JOINTLY: readonly WithholdingBracket[] = [
  { atLeastCents: 0, baseTaxCents: 0, rateMilliPct: 0 },
  { atLeastCents: 1_930_000, baseTaxCents: 0, rateMilliPct: 10_000 },
  { atLeastCents: 4_410_000, baseTaxCents: 248_000, rateMilliPct: 12_000 },
  { atLeastCents: 12_010_000, baseTaxCents: 1_160_000, rateMilliPct: 22_000 },
  { atLeastCents: 23_070_000, baseTaxCents: 3_593_200, rateMilliPct: 24_000 },
  { atLeastCents: 42_285_000, baseTaxCents: 8_204_800, rateMilliPct: 32_000 },
  { atLeastCents: 53_175_000, baseTaxCents: 11_689_600, rateMilliPct: 35_000 },
  { atLeastCents: 78_800_000, baseTaxCents: 20_658_350, rateMilliPct: 37_000 },
] as const;

/** STANDARD schedule - Single or Married Filing Separately. */
export const STANDARD_SINGLE_OR_MFS: readonly WithholdingBracket[] = [
  { atLeastCents: 0, baseTaxCents: 0, rateMilliPct: 0 },
  { atLeastCents: 750_000, baseTaxCents: 0, rateMilliPct: 10_000 },
  { atLeastCents: 1_990_000, baseTaxCents: 124_000, rateMilliPct: 12_000 },
  { atLeastCents: 5_790_000, baseTaxCents: 580_000, rateMilliPct: 22_000 },
  { atLeastCents: 11_320_000, baseTaxCents: 1_796_600, rateMilliPct: 24_000 },
  { atLeastCents: 20_927_500, baseTaxCents: 4_102_400, rateMilliPct: 32_000 },
  { atLeastCents: 26_372_500, baseTaxCents: 5_844_800, rateMilliPct: 35_000 },
  { atLeastCents: 64_810_000, baseTaxCents: 19_297_925, rateMilliPct: 37_000 },
] as const;

/** STANDARD schedule - Head of Household. */
export const STANDARD_HEAD_OF_HOUSEHOLD: readonly WithholdingBracket[] = [
  { atLeastCents: 0, baseTaxCents: 0, rateMilliPct: 0 },
  { atLeastCents: 1_555_000, baseTaxCents: 0, rateMilliPct: 10_000 },
  { atLeastCents: 3_325_000, baseTaxCents: 177_000, rateMilliPct: 12_000 },
  { atLeastCents: 8_300_000, baseTaxCents: 774_000, rateMilliPct: 22_000 },
  { atLeastCents: 12_125_000, baseTaxCents: 1_615_500, rateMilliPct: 24_000 },
  { atLeastCents: 21_730_000, baseTaxCents: 3_920_700, rateMilliPct: 32_000 },
  { atLeastCents: 27_175_000, baseTaxCents: 5_663_100, rateMilliPct: 35_000 },
  { atLeastCents: 65_615_000, baseTaxCents: 19_117_100, rateMilliPct: 37_000 },
] as const;

/** STEP 2 CHECKBOX schedule - Married Filing Jointly. */
export const STEP2_MARRIED_FILING_JOINTLY: readonly WithholdingBracket[] = [
  { atLeastCents: 0, baseTaxCents: 0, rateMilliPct: 0 },
  { atLeastCents: 1_610_000, baseTaxCents: 0, rateMilliPct: 10_000 },
  { atLeastCents: 2_850_000, baseTaxCents: 124_000, rateMilliPct: 12_000 },
  { atLeastCents: 6_650_000, baseTaxCents: 580_000, rateMilliPct: 22_000 },
  { atLeastCents: 12_180_000, baseTaxCents: 1_796_600, rateMilliPct: 24_000 },
  { atLeastCents: 21_787_500, baseTaxCents: 4_102_400, rateMilliPct: 32_000 },
  { atLeastCents: 27_232_500, baseTaxCents: 5_844_800, rateMilliPct: 35_000 },
  { atLeastCents: 40_045_000, baseTaxCents: 10_329_175, rateMilliPct: 37_000 },
] as const;

/** STEP 2 CHECKBOX schedule - Single or Married Filing Separately. */
export const STEP2_SINGLE_OR_MFS: readonly WithholdingBracket[] = [
  { atLeastCents: 0, baseTaxCents: 0, rateMilliPct: 0 },
  { atLeastCents: 805_000, baseTaxCents: 0, rateMilliPct: 10_000 },
  { atLeastCents: 1_425_000, baseTaxCents: 62_000, rateMilliPct: 12_000 },
  { atLeastCents: 3_325_000, baseTaxCents: 290_000, rateMilliPct: 22_000 },
  { atLeastCents: 6_090_000, baseTaxCents: 898_300, rateMilliPct: 24_000 },
  { atLeastCents: 10_893_800, baseTaxCents: 2_051_200, rateMilliPct: 32_000 },
  { atLeastCents: 13_616_300, baseTaxCents: 2_922_400, rateMilliPct: 35_000 },
  { atLeastCents: 32_835_000, baseTaxCents: 9_648_963, rateMilliPct: 37_000 },
] as const;

/** STEP 2 CHECKBOX schedule - Head of Household. */
export const STEP2_HEAD_OF_HOUSEHOLD: readonly WithholdingBracket[] = [
  { atLeastCents: 0, baseTaxCents: 0, rateMilliPct: 0 },
  { atLeastCents: 1_207_500, baseTaxCents: 0, rateMilliPct: 10_000 },
  { atLeastCents: 2_092_500, baseTaxCents: 88_500, rateMilliPct: 12_000 },
  { atLeastCents: 4_580_000, baseTaxCents: 387_000, rateMilliPct: 22_000 },
  { atLeastCents: 6_492_500, baseTaxCents: 807_750, rateMilliPct: 24_000 },
  { atLeastCents: 11_295_000, baseTaxCents: 1_960_350, rateMilliPct: 32_000 },
  { atLeastCents: 14_017_500, baseTaxCents: 2_831_550, rateMilliPct: 35_000 },
  { atLeastCents: 33_237_500, baseTaxCents: 9_558_550, rateMilliPct: 37_000 },
] as const;

/**
 * Worksheet 1A line 1g. VERBATIM: "If the box in Step 2 of Form W-4 is checked,
 * enter -0-. If the box is not checked, enter $12,900 if the taxpayer is
 * married filing jointly or $8,600 otherwise."
 *
 * This is the built-in standard deduction the withholding tables assume. It is
 * ALSO the additive constant in the halving rule that proves the Step 2 tables
 * - which is why it lives here next to them rather than buried in the function.
 */
export const LINE_1G_MFJ_CENTS = 1_290_000;
export const LINE_1G_OTHER_CENTS = 860_000;

/**
 * Worksheet 1A line 1k: the value of one withholding allowance on a
 * 2019-or-earlier Form W-4. Personal exemptions were permanently repealed, but
 * the IRS still publishes this figure so that employers are not forced to make
 * long-tenured employees file a new W-4.
 */
export const LEGACY_ALLOWANCE_VALUE_CENTS = 430_000;

/** Pick the schedule Worksheet 1A step 2 says to use. */
export function selectRateSchedule(
  filingStatus: W4FilingStatus,
  step2Checked: boolean,
): readonly WithholdingBracket[] {
  if (step2Checked) {
    switch (filingStatus) {
      case "married_filing_jointly":
        return STEP2_MARRIED_FILING_JOINTLY;
      case "single_or_married_filing_separately":
        return STEP2_SINGLE_OR_MFS;
      case "head_of_household":
        return STEP2_HEAD_OF_HOUSEHOLD;
    }
  }
  switch (filingStatus) {
    case "married_filing_jointly":
      return STANDARD_MARRIED_FILING_JOINTLY;
    case "single_or_married_filing_separately":
      return STANDARD_SINGLE_OR_MFS;
    case "head_of_household":
      return STANDARD_HEAD_OF_HOUSEHOLD;
  }
}

/**
 * Worksheet 1A step 2b/2c/2d: find the row where the adjusted annual wage is
 * ">= column A and < column B".
 *
 * Implemented as a descending scan for the highest floor at or below the wage,
 * which is equivalent to the IRS's two-sided test given ascending, gapless
 * thresholds - a property the self-tests assert rather than assume.
 */
export function findBracket(
  schedule: readonly WithholdingBracket[],
  adjustedAnnualWageCents: number,
): WithholdingBracket {
  for (let i = schedule.length - 1; i >= 0; i -= 1) {
    const row = schedule[i]!;
    if (adjustedAnnualWageCents >= row.atLeastCents) return row;
  }
  // Unreachable: every schedule's first row starts at 0 and the wage is clamped
  // at zero by step 1i. Asserted by the self-tests; thrown rather than defaulted
  // because a silent fallback here would understate someone's tax.
  throw new Error(
    `findBracket: no bracket contains ${adjustedAnnualWageCents} cents - the rate schedule is malformed`,
  );
}

// ===========================================================================
// 3) WORKSHEET 1A - FEDERAL INCOME TAX WITHHOLDING
// ===========================================================================

/**
 * Every intermediate line of Worksheet 1A, kept and returned.
 *
 * This is not debugging clutter - it is the product. Michael asked for a system
 * that explains itself when he disagrees with a number. You cannot explain a
 * withholding amount by showing the answer; you explain it by showing that line
 * 1i was $41,200, which landed in the 12% bracket, which is why the number
 * looks small. The UI renders these lines with their IRS labels.
 */
export type Worksheet1AResult = {
  /** 1a - taxable wages this period. */
  line1a_wagesThisPeriodCents: number;
  /** 1b - pay periods per year. */
  line1b_payPeriodsPerYear: number;
  /** 1c - annualized wages. */
  line1c_annualWagesCents: number;
  /** 1d - W-4 Step 4(a) other income. Zero on a legacy form. */
  line1d_otherIncomeCents: number;
  /** 1e - 1c + 1d. */
  line1e_cents: number;
  /** 1f - W-4 Step 4(b) deductions. Zero on a legacy form. */
  line1f_deductionsCents: number;
  /** 1g - the standard-deduction offset, or zero if Step 2 is checked. */
  line1g_cents: number;
  /** 1h - 1f + 1g. */
  line1h_cents: number;
  /** 1j - legacy allowances claimed, or null on a modern form. */
  line1j_allowances: number | null;
  /** 1k - 1j x $4,300, or null on a modern form. */
  line1k_cents: number | null;
  /**
   * 1i (modern) or 1l (legacy) - the Adjusted Annual Wage Amount.
   * CLAMPED AT ZERO. This is the first of the two clamps.
   */
  adjustedAnnualWageCents: number;
  /** True if the clamp actually fired (deductions exceeded income). */
  clamp1iFired: boolean;
  /** 2b - column A of the chosen bracket. */
  line2b_bracketFloorCents: number;
  /** 2c - column C. */
  line2c_baseTaxCents: number;
  /** 2d - column D. */
  line2d_rateMilliPct: number;
  /** 2e - 2a - 2b. */
  line2e_excessCents: number;
  /** 2f - 2e x 2d. */
  line2f_marginalTaxCents: number;
  /** 2g - 2c + 2f, the annual tentative tax. */
  line2g_annualTentativeCents: number;
  /** 2h - 2g / 1b, the per-period tentative withholding. */
  line2h_tentativePerPeriodCents: number;
  /** 3a - W-4 Step 3 annual credits. */
  line3a_annualCreditCents: number;
  /** 3b - 3a / 1b. */
  line3b_creditPerPeriodCents: number;
  /**
   * 3c - 2h - 3b, CLAMPED AT ZERO. This is the second clamp, and it is a
   * separate clamp: credits can zero out withholding but can never turn it
   * negative into a refund through payroll.
   */
  line3c_afterCreditsCents: number;
  /** True if the second clamp fired. */
  clamp3cFired: boolean;
  /** 4a - W-4 Step 4(c) extra withholding per period. */
  line4a_extraPerPeriodCents: number;
  /** 4b - 3c + 4a. THE ANSWER. */
  line4b_withholdingCents: number;
  /** Which schedule was used, for the on-screen explanation. */
  scheduleUsed:
    | "standard_mfj"
    | "standard_single_mfs"
    | "standard_hoh"
    | "step2_mfj"
    | "step2_single_mfs"
    | "step2_hoh";
  /** True when the employee claimed exemption and only steps 4a survive. */
  exemptFromIncomeTax: boolean;
  /** Plain-English notes about anything unusual that happened. */
  notes: string[];
};

function scheduleName(
  filingStatus: W4FilingStatus,
  step2: boolean,
): Worksheet1AResult["scheduleUsed"] {
  if (step2) {
    if (filingStatus === "married_filing_jointly") return "step2_mfj";
    if (filingStatus === "head_of_household") return "step2_hoh";
    return "step2_single_mfs";
  }
  if (filingStatus === "married_filing_jointly") return "standard_mfj";
  if (filingStatus === "head_of_household") return "standard_hoh";
  return "standard_single_mfs";
}

/**
 * Publication 15-T (2026) Worksheet 1A, in full.
 *
 * THE TWO CLAMPS ARE SEPARATE AND THE ORDER IS LOAD-BEARING. Line 1i says "if
 * zero or less, enter -0-" and line 3c says it again. It is tempting to skip
 * the first one and just floor the final answer. That produces a DIFFERENT and
 * WRONG number for a low-paid employee with large Step 4(b) deductions and a
 * large Step 3 credit, because a negative line 1i would otherwise flow into the
 * bracket lookup and produce a negative tentative tax that silently absorbs the
 * credit. Both clamps are implemented in place and both are separately tested
 * with a case that dies if either is removed.
 *
 * EXEMPT: an employee who claims exemption below Step 4(c) has no federal
 * INCOME tax withheld - but they still owe Social Security and Medicare. This
 * function returns zero income tax for them and does not touch FICA, which is
 * computed independently in `computeFicaForPeriod`. Wiring "exempt" to FICA
 * would be a section 6672 trust-fund exposure, so the two are structurally
 * incapable of being confused: they are different functions with different
 * inputs.
 */
export function computeWorksheet1A(args: {
  w4: W4Record;
  payFrequency: PayFrequency;
  wagesThisPeriodCents: number;
}): Worksheet1AResult {
  const { w4, payFrequency, wagesThisPeriodCents } = args;

  if (!Number.isInteger(wagesThisPeriodCents)) {
    throw new Error("computeWorksheet1A: wagesThisPeriodCents must be integer cents");
  }
  if (wagesThisPeriodCents < 0) {
    throw new Error("computeWorksheet1A: wages cannot be negative - reverse the run instead");
  }

  const notes: string[] = [];
  const periods = PAY_PERIODS_PER_YEAR[payFrequency];
  const modern = isModernW4(w4);
  const step2 = modern && w4.step2MultipleJobs;

  // --- Step 1: adjust the payment amount ----------------------------------
  const line1c = wagesThisPeriodCents * periods;

  let line1d = 0;
  let line1e = line1c;
  let line1f = 0;
  let line1g = 0;
  let line1h = 0;
  let line1j: number | null = null;
  let line1k: number | null = null;
  let adjusted: number;
  let clamp1iFired = false;

  if (modern) {
    line1d = w4.step4aOtherIncomeAnnualCents;
    line1e = line1c + line1d;
    line1f = w4.step4bDeductionsAnnualCents;
    line1g = step2
      ? 0
      : w4.filingStatus === "married_filing_jointly"
        ? LINE_1G_MFJ_CENTS
        : LINE_1G_OTHER_CENTS;
    line1h = line1f + line1g;
    const raw1i = line1e - line1h;
    // CLAMP #1 - Worksheet 1A line 1i, "If zero or less, enter -0-."
    adjusted = raw1i > 0 ? raw1i : 0;
    if (raw1i <= 0) {
      clamp1iFired = true;
      notes.push(
        "This employee's W-4 deductions are larger than their annualized pay, so the IRS " +
          "worksheet floors the taxable figure at zero. No federal income tax is withheld " +
          "before credits.",
      );
    }
  } else {
    // Legacy (2019-or-earlier) Form W-4 path: lines 1j, 1k, 1l.
    const allowances = w4.legacyAllowances ?? 0;
    line1j = allowances;
    line1k = allowances * LEGACY_ALLOWANCE_VALUE_CENTS;
    const raw1l = line1c - line1k;
    // CLAMP #1, legacy spelling - line 1l, "If zero or less, enter -0-."
    adjusted = raw1l > 0 ? raw1l : 0;
    if (raw1l <= 0) {
      clamp1iFired = true;
      notes.push(
        "The allowances on this old-style W-4 are worth more than the employee's annualized " +
          "pay, so the worksheet floors the taxable figure at zero.",
      );
    }
    notes.push(
      "This employee is still on a Form W-4 from 2019 or earlier. That is legal and you may " +
        "not require them to file a new one, but the Head of Household table is off limits for " +
        "them and their allowances are valued at $4,300 each.",
    );
  }

  // --- Step 2: tentative withholding --------------------------------------
  const schedule = selectRateSchedule(w4.filingStatus, step2);
  const bracket = findBracket(schedule, adjusted);
  const line2e = adjusted - bracket.atLeastCents;
  const line2f = applyMilliPct(line2e, bracket.rateMilliPct);
  const line2g = bracket.baseTaxCents + line2f;
  const line2h = divideRoundHalfUp(line2g, periods);

  // --- Step 3: credits -----------------------------------------------------
  const line3a = modern ? w4.step3AnnualCreditCents : 0;
  const line3b = divideRoundHalfUp(line3a, periods);
  const raw3c = line2h - line3b;
  // CLAMP #2 - Worksheet 1A line 3c, "If zero or less, enter -0-."
  const line3c = raw3c > 0 ? raw3c : 0;
  const clamp3cFired = raw3c <= 0;
  if (clamp3cFired && line3a > 0) {
    notes.push(
      "The credits this employee claimed in Step 3 of their W-4 are big enough to wipe out " +
        "their federal income tax withholding entirely. Payroll stops at zero - it never pays " +
        "a refund out. Any excess credit comes back to them when they file.",
    );
  }

  // --- Step 4: the final answer -------------------------------------------
  const line4a = w4.step4cExtraPerPeriodCents;

  // EXEMPT short-circuit. Note it happens HERE, after the full worksheet has
  // been computed, so the UI can still show Michael what WOULD have been
  // withheld if the exemption were not claimed. That is the difference between
  // a system that hides a decision and one that teaches it.
  if (w4.exemptFromFederalIncomeTax) {
    notes.push(
      "This employee claimed exemption from federal income tax withholding on their W-4, so " +
        "no federal income tax comes out. Read this carefully: exempt means exempt from INCOME " +
        "tax only. Social Security and Medicare still come out of every check, and you still " +
        "owe your employer half. An exemption also expires - it is only good through February " +
        "15 of the following year unless they file a new W-4.",
    );
    return {
      line1a_wagesThisPeriodCents: wagesThisPeriodCents,
      line1b_payPeriodsPerYear: periods,
      line1c_annualWagesCents: line1c,
      line1d_otherIncomeCents: line1d,
      line1e_cents: line1e,
      line1f_deductionsCents: line1f,
      line1g_cents: line1g,
      line1h_cents: line1h,
      line1j_allowances: line1j,
      line1k_cents: line1k,
      adjustedAnnualWageCents: adjusted,
      clamp1iFired,
      line2b_bracketFloorCents: bracket.atLeastCents,
      line2c_baseTaxCents: bracket.baseTaxCents,
      line2d_rateMilliPct: bracket.rateMilliPct,
      line2e_excessCents: line2e,
      line2f_marginalTaxCents: line2f,
      line2g_annualTentativeCents: line2g,
      line2h_tentativePerPeriodCents: line2h,
      line3a_annualCreditCents: line3a,
      line3b_creditPerPeriodCents: line3b,
      line3c_afterCreditsCents: line3c,
      clamp3cFired,
      line4a_extraPerPeriodCents: line4a,
      line4b_withholdingCents: 0,
      scheduleUsed: scheduleName(w4.filingStatus, step2),
      exemptFromIncomeTax: true,
      notes,
    };
  }

  const line4b = line3c + line4a;

  return {
    line1a_wagesThisPeriodCents: wagesThisPeriodCents,
    line1b_payPeriodsPerYear: periods,
    line1c_annualWagesCents: line1c,
    line1d_otherIncomeCents: line1d,
    line1e_cents: line1e,
    line1f_deductionsCents: line1f,
    line1g_cents: line1g,
    line1h_cents: line1h,
    line1j_allowances: line1j,
    line1k_cents: line1k,
    adjustedAnnualWageCents: adjusted,
    clamp1iFired,
    line2b_bracketFloorCents: bracket.atLeastCents,
    line2c_baseTaxCents: bracket.baseTaxCents,
    line2d_rateMilliPct: bracket.rateMilliPct,
    line2e_excessCents: line2e,
    line2f_marginalTaxCents: line2f,
    line2g_annualTentativeCents: line2g,
    line2h_tentativePerPeriodCents: line2h,
    line3a_annualCreditCents: line3a,
    line3b_creditPerPeriodCents: line3b,
    line3c_afterCreditsCents: line3c,
    clamp3cFired,
    line4a_extraPerPeriodCents: line4a,
    line4b_withholdingCents: line4b,
    scheduleUsed: scheduleName(w4.filingStatus, step2),
    exemptFromIncomeTax: false,
    notes,
  };
}

// ===========================================================================
// 4) THE EIGHT WAGE BASES
// ===========================================================================

/**
 * 2026 rate and ceiling constants. Every one of these is sourced to a primary
 * authority in `payroll-tax-authorities.ts` by the id named in the comment.
 *
 * A CEILING OF `null` MEANS UNCAPPED AND IS A DELIBERATE, TESTED VALUE - not a
 * missing number. `applyWageCeiling` treats null as "no ceiling," and the
 * self-tests prove that Medicare and WA Cares keep accruing past $184,500.
 */

/** SSA contribution and benefit base for 2026. Authority: ssa-2026-contribution-benefit-base */
export const OASDI_WAGE_BASE_2026_CENTS = 18_450_000;
/** 26 U.S.C. 3101(a) / 3111(a). Authority: irc-3101-employee-fica, irc-3111-employer-fica */
export const OASDI_RATE_MILLI_PCT = 6_200;
/**
 * SSA publishes this figure directly: "an individual with wages equal to or
 * larger than $184,500 would contribute $11,439.00 to the OASDI program in
 * 2026." It is a free correctness oracle and the self-tests use it as one.
 */
export const OASDI_MAX_EMPLOYEE_TAX_2026_CENTS = 1_143_900;

/** 26 U.S.C. 3101(b)(1) / 3111(b). Medicare has NO wage base - do not add one. */
export const MEDICARE_RATE_MILLI_PCT = 1_450;
export const MEDICARE_WAGE_BASE_CENTS: number | null = null;

/**
 * 26 U.S.C. 3101(b)(2) Additional Medicare Tax.
 *
 * TWO DIFFERENT NUMBERS LIVE HERE AND CONFLATING THEM IS A CLASSIC ERROR:
 *  - The employer's WITHHOLDING trigger is a flat $200,000 of wages paid by
 *    THIS employer in the calendar year, regardless of the employee's filing
 *    status (section 3102(f)). That is what payroll uses.
 *  - The employee's actual LIABILITY thresholds are $250,000 joint / $125,000
 *    married filing separately / $200,000 otherwise, trued up by the employee
 *    on Form 8959. That is NOT payroll's job and we must not try.
 * There is no employer match on this tax. Section 3111 has no counterpart.
 */
export const ADDITIONAL_MEDICARE_RATE_MILLI_PCT = 900;
export const ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD_CENTS = 20_000_000;
export const ADDITIONAL_MEDICARE_LIABILITY_THRESHOLD_JOINT_CENTS = 25_000_000;
export const ADDITIONAL_MEDICARE_LIABILITY_THRESHOLD_MFS_CENTS = 12_500_000;
export const ADDITIONAL_MEDICARE_LIABILITY_THRESHOLD_OTHER_CENTS = 20_000_000;

/** 26 U.S.C. 3301 - 6%. Authority: irc-3301-futa-rate */
export const FUTA_GROSS_RATE_MILLI_PCT = 6_000;
/** 26 U.S.C. 3306(b)(1) - $7,000, written into the statute and NOT indexed. */
export const FUTA_WAGE_BASE_CENTS = 700_000;
/** 26 U.S.C. 3302(b) - the state credit is capped at 5.4%. */
export const FUTA_MAX_CREDIT_MILLI_PCT = 5_400;
/** 26 U.S.C. 3302(a)(3) - contributions paid late earn only 90% of the credit. */
export const FUTA_LATE_PAYMENT_CREDIT_MILLI_PCT = 90_000;
/** 26 U.S.C. 3306(a)(1)(A) - the $1,500-in-a-quarter employer test. */
export const FUTA_EMPLOYER_TEST_QUARTERLY_WAGES_CENTS = 150_000;

/** ESD 2026 taxable wage base. Authority: esd-suta-rate-structure */
export const WA_SUTA_WAGE_BASE_2026_CENTS = 7_820_000;
/** ESD: experience + social combined may not exceed 6%. */
export const WA_SUTA_COMBINED_CEILING_MILLI_PCT = 6_000;

/**
 * WA Paid Family & Medical Leave, 2026.
 *
 * THE CEILING IS DERIVED, NEVER TYPED. RCW 50A.10.030(4): "The commissioner
 * must annually set a maximum limit on the amount of wages that is subject to a
 * premium assessment under this section that is equal to the maximum wages
 * subject to taxation for social security." So the PFML ceiling IS the OASDI
 * base, by statute. Typing 18_450_000 twice would create two facts that can
 * drift apart when the base changes - precisely the catastrophe standing rule 2
 * is about. It is one fact, referenced twice.
 */
export const WA_PFML_WAGE_BASE_2026_CENTS = OASDI_WAGE_BASE_2026_CENTS;
/** ESD 2026: total premium 1.13%. RCW 50A.10.030(6)(b)(ii) caps it at 1.20%. */
export const WA_PFML_TOTAL_RATE_2026_MILLI_PCT = 1_130;
export const WA_PFML_STATUTORY_RATE_CEILING_MILLI_PCT = 1_200;
/** ESD 2026 split: employer 28.57%, employee 71.43% of the total premium. */
export const WA_PFML_EMPLOYER_SHARE_MILLI_PCT = 28_570;
export const WA_PFML_EMPLOYEE_SHARE_MILLI_PCT = 71_430;
/** RCW 50A.10.030(5)(a) - fewer than 50 WA employees, no employer portion. */
export const WA_PFML_SMALL_EMPLOYER_HEADCOUNT = 50;

/**
 * WA Cares / long-term services and supports, 2026.
 *
 * THE CEILING IS `null` ON PURPOSE. wacaresfund.wa.gov/employers, verbatim:
 * "Note that unlike Paid Leave, premium contributions are not capped at the
 * taxable maximum for social security." Two Washington programs, one quarterly
 * return, two different ceilings. This `null` is the single most important
 * value in this file and it has its own dedicated test.
 */
export const WA_CARES_RATE_2026_MILLI_PCT = 580;
export const WA_CARES_STATUTORY_RATE_CEILING_MILLI_PCT = 580;
export const WA_CARES_WAGE_BASE_CENTS: number | null = null;

/**
 * Which pot of money a given tax comes out of. This is not cosmetic: it decides
 * whether the amount reduces the employee's take-home pay or increases the
 * company's expense, and getting it backwards is how an employer commits a
 * wage-deduction violation.
 */
export type TaxIncidence = "employee" | "employer" | "shared";

/** The eight wage definitions, as data. This list IS the test matrix. */
export type WageBaseKey =
  | "oasdi"
  | "medicare"
  | "additional_medicare"
  | "futa"
  | "wa_suta"
  | "wa_pfml"
  | "wa_cares"
  | "lni_hours";

export type WageBaseSpec = {
  key: WageBaseKey;
  label: string;
  /** Integer cents, or null when the base is UNCAPPED. */
  ceilingCents: number | null;
  incidence: TaxIncidence;
  /** Authority record id in payroll-tax-authorities.ts. */
  authorityId: string;
  /** Plain-English one-liner shown next to the number on screen. */
  plain: string;
};

export const WAGE_BASE_SPECS: readonly WageBaseSpec[] = [
  {
    key: "oasdi",
    label: "Social Security",
    ceilingCents: OASDI_WAGE_BASE_2026_CENTS,
    incidence: "shared",
    authorityId: "ssa-2026-contribution-benefit-base",
    plain:
      "6.2% from the employee and 6.2% from you, and it stops for the year once they have earned $184,500.",
  },
  {
    key: "medicare",
    label: "Medicare",
    ceilingCents: MEDICARE_WAGE_BASE_CENTS,
    incidence: "shared",
    authorityId: "irc-3101-employee-fica",
    plain: "1.45% from the employee and 1.45% from you, on every dollar. There is no stopping point.",
  },
  {
    key: "additional_medicare",
    label: "Additional Medicare",
    ceilingCents: null,
    incidence: "employee",
    authorityId: "irc-3101-employee-fica",
    plain:
      "An extra 0.9% from the employee only, and only on what they earn above $200,000 here. You do not match this one.",
  },
  {
    key: "futa",
    label: "Federal unemployment (FUTA)",
    ceilingCents: FUTA_WAGE_BASE_CENTS,
    incidence: "employer",
    authorityId: "irc-3306-futa-wage-base",
    plain:
      "Yours alone, and only on the first $7,000 each person earns in the year. Never comes out of their check.",
  },
  {
    key: "wa_suta",
    label: "Washington unemployment (SUTA)",
    ceilingCents: WA_SUTA_WAGE_BASE_2026_CENTS,
    incidence: "employer",
    authorityId: "esd-suta-rate-structure",
    plain:
      "Yours alone, on the first $78,200 each person earns. Your rate is specific to your business and arrives in the mail every December.",
  },
  {
    key: "wa_pfml",
    label: "WA Paid Family & Medical Leave",
    ceilingCents: WA_PFML_WAGE_BASE_2026_CENTS,
    incidence: "shared",
    authorityId: "rcw-50a-10-030-pfml",
    plain:
      "1.13% total, split roughly 71/29 between the employee and you - and it stops at the same $184,500 as Social Security, because the statute ties it there.",
  },
  {
    key: "wa_cares",
    label: "WA Cares",
    ceilingCents: WA_CARES_WAGE_BASE_CENTS,
    incidence: "employee",
    authorityId: "wa-cares-uncapped",
    plain:
      "0.58% out of the employee's check and nothing out of yours - and unlike Paid Leave it NEVER stops. Same agency, same form, different ceiling. This is the one people get wrong.",
  },
  {
    key: "lni_hours",
    label: "L&I workers' compensation",
    ceilingCents: null,
    incidence: "shared",
    authorityId: "rcw-51-16-060-lni-hours",
    plain:
      "Not a percentage of money at all - it is a fixed amount per HOUR worked, per risk class. The employee pays half of the medical aid portion and not one cent more.",
  },
] as const;

export function wageBaseSpec(key: WageBaseKey): WageBaseSpec {
  const found = WAGE_BASE_SPECS.find((s) => s.key === key);
  if (!found) throw new Error(`wageBaseSpec: unknown wage base "${key}"`);
  return found;
}

/**
 * How much of THIS period's wages is still under a ceiling, given what the
 * employee has already been paid this year.
 *
 * This is the whole trick, and it is four lines. `ceilingCents === null` means
 * uncapped, and that branch is what makes Medicare and WA Cares behave
 * correctly while Social Security and PFML stop.
 */
export function applyWageCeiling(args: {
  ytdWagesCents: number;
  periodWagesCents: number;
  ceilingCents: number | null;
}): { taxableThisPeriodCents: number; roomRemainingCents: number | null; ceilingReached: boolean } {
  const { ytdWagesCents, periodWagesCents, ceilingCents } = args;
  if (!Number.isInteger(ytdWagesCents) || !Number.isInteger(periodWagesCents)) {
    throw new Error("applyWageCeiling requires integer cents");
  }
  if (ytdWagesCents < 0 || periodWagesCents < 0) {
    throw new Error("applyWageCeiling: wages cannot be negative");
  }
  if (ceilingCents === null) {
    return { taxableThisPeriodCents: periodWagesCents, roomRemainingCents: null, ceilingReached: false };
  }
  const room = ceilingCents - ytdWagesCents;
  if (room <= 0) {
    return { taxableThisPeriodCents: 0, roomRemainingCents: 0, ceilingReached: true };
  }
  const taxable = periodWagesCents < room ? periodWagesCents : room;
  return {
    taxableThisPeriodCents: taxable,
    roomRemainingCents: room - taxable,
    ceilingReached: room - taxable === 0,
  };
}

/**
 * Wages already paid to this employee, this calendar year, BEFORE the run being
 * computed. Eight separate figures because there are eight separate
 * definitions. There is deliberately no field called `ytdWagesCents`.
 */
export type YtdWageAccumulators = {
  oasdiWagesCents: number;
  medicareWagesCents: number;
  futaWagesCents: number;
  waSutaWagesCents: number;
  waPfmlWagesCents: number;
  waCaresWagesCents: number;
  /** Hours already reported to L&I, in HUNDREDTHS of an hour (integer). */
  lniHundredthHours: number;
};

export const ZERO_YTD: YtdWageAccumulators = {
  oasdiWagesCents: 0,
  medicareWagesCents: 0,
  futaWagesCents: 0,
  waSutaWagesCents: 0,
  waPfmlWagesCents: 0,
  waCaresWagesCents: 0,
  lniHundredthHours: 0,
};

// ===========================================================================
// 5) FICA
// ===========================================================================

export type FicaResult = {
  oasdiTaxableCents: number;
  employeeOasdiCents: number;
  employerOasdiCents: number;
  oasdiCeilingReached: boolean;
  medicareTaxableCents: number;
  employeeMedicareCents: number;
  employerMedicareCents: number;
  /** Wages in THIS period that sit above the $200,000 withholding trigger. */
  additionalMedicareTaxableCents: number;
  employeeAdditionalMedicareCents: number;
  /** Always zero. Present so the absence of an employer match is VISIBLE. */
  employerAdditionalMedicareCents: 0;
  totalEmployeeFicaCents: number;
  totalEmployerFicaCents: number;
  notes: string[];
};

/**
 * Social Security + Medicare + Additional Medicare for one pay period.
 *
 * Deliberately takes no W-4. FICA does not care about filing status, allowances,
 * credits, or an exemption claim - and the only way to guarantee an "exempt"
 * checkbox can never suppress FICA is for this function to be physically unable
 * to see it. That is a structural safeguard, not a stylistic one: unremitted
 * FICA is trust-fund money under section 7501 and reaches Michael personally
 * under section 6672.
 */
export function computeFicaForPeriod(args: {
  ytd: YtdWageAccumulators;
  periodWagesCents: number;
}): FicaResult {
  const { ytd, periodWagesCents } = args;
  if (!Number.isInteger(periodWagesCents) || periodWagesCents < 0) {
    throw new Error("computeFicaForPeriod: periodWagesCents must be a non-negative integer");
  }
  const notes: string[] = [];

  // --- Social Security (capped) -------------------------------------------
  const oasdi = applyWageCeiling({
    ytdWagesCents: ytd.oasdiWagesCents,
    periodWagesCents,
    ceilingCents: OASDI_WAGE_BASE_2026_CENTS,
  });
  // TELESCOPING, NOT PER-PERIOD. See `telescopingTaxForPeriod` for the full
  // explanation. In one line: rounding 6.2% of each paycheck separately finishes
  // the year 4 to 31 cents over the $11,439.00 statutory maximum depending on
  // how often the employee is paid, so we tax the running total and subtract
  // what has already been taken.
  const oasdiCumBefore = Math.min(ytd.oasdiWagesCents, OASDI_WAGE_BASE_2026_CENTS);
  const oasdiCumAfter = oasdiCumBefore + oasdi.taxableThisPeriodCents;
  const employeeOasdi = telescopingTaxForPeriod(oasdiCumBefore, oasdiCumAfter, OASDI_RATE_MILLI_PCT);
  const employerOasdi = employeeOasdi; // 3111(a) mirrors 3101(a) exactly.
  if (oasdi.ceilingReached && oasdi.taxableThisPeriodCents < periodWagesCents) {
    notes.push(
      "This employee hit the $184,500 Social Security ceiling in this check. Social Security " +
        "stops for the rest of the year for them - but Medicare and WA Cares keep going on " +
        "every dollar, so their net pay will go UP without their deductions being wrong.",
    );
  }

  // --- Medicare (uncapped) -------------------------------------------------
  const medicare = applyWageCeiling({
    ytdWagesCents: ytd.medicareWagesCents,
    periodWagesCents,
    ceilingCents: MEDICARE_WAGE_BASE_CENTS,
  });
  // Medicare is uncapped, so there is no statutory annual total to land on - but
  // the same drift argument applies to the employee's W-2 box 6, and mixing
  // methods between the two halves of FICA would be its own inconsistency. Same
  // treatment, same reason.
  const medicareCumBefore = ytd.medicareWagesCents;
  const medicareCumAfter = medicareCumBefore + medicare.taxableThisPeriodCents;
  const employeeMedicare = telescopingTaxForPeriod(
    medicareCumBefore,
    medicareCumAfter,
    MEDICARE_RATE_MILLI_PCT,
  );
  const employerMedicare = employeeMedicare;

  // --- Additional Medicare (starts, rather than stops, at a threshold) -----
  // Section 3102(f): withhold once wages paid by THIS employer pass $200,000,
  // regardless of filing status. Only the portion above the line is taxed.
  const ytdMed = ytd.medicareWagesCents;
  const endOfPeriod = ytdMed + periodWagesCents;
  let addlTaxable = 0;
  if (endOfPeriod > ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD_CENTS) {
    const alreadyOver = Math.max(0, ytdMed - ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD_CENTS);
    const totalOver = endOfPeriod - ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD_CENTS;
    addlTaxable = totalOver - alreadyOver;
  }
  // Telescoped against the cumulative over-threshold amount for the same reason
  // as the other two: Form 8959 reconciles the employee's real liability against
  // what was withheld, and a drifting withheld figure makes that form harder to
  // tie out for no benefit to anybody.
  const addlCumBefore = Math.max(0, ytdMed - ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD_CENTS);
  const employeeAddl = telescopingTaxForPeriod(
    addlCumBefore,
    addlCumBefore + addlTaxable,
    ADDITIONAL_MEDICARE_RATE_MILLI_PCT,
  );
  if (addlTaxable > 0) {
    notes.push(
      "This employee has passed $200,000 in wages from you this year, so an extra 0.9% Medicare " +
        "tax starts coming out of the amount above that line. You do NOT match this one - it is " +
        "the employee's tax alone. They settle up the real threshold for their filing status on " +
        "Form 8959 when they file.",
    );
  }

  return {
    oasdiTaxableCents: oasdi.taxableThisPeriodCents,
    employeeOasdiCents: employeeOasdi,
    employerOasdiCents: employerOasdi,
    oasdiCeilingReached: oasdi.ceilingReached,
    medicareTaxableCents: medicare.taxableThisPeriodCents,
    employeeMedicareCents: employeeMedicare,
    employerMedicareCents: employerMedicare,
    additionalMedicareTaxableCents: addlTaxable,
    employeeAdditionalMedicareCents: employeeAddl,
    employerAdditionalMedicareCents: 0,
    totalEmployeeFicaCents: employeeOasdi + employeeMedicare + employeeAddl,
    totalEmployerFicaCents: employerOasdi + employerMedicare,
    notes,
  };
}

// ===========================================================================
// 6) FUTA - AND WHY 0.6% IS A LIE WORTH BLOCKING
// ===========================================================================

export type FutaResult = {
  futaTaxableCents: number;
  grossFutaCents: number;
  /** The rate actually credited, in milli-percent, after every haircut. */
  effectiveCreditMilliPct: number;
  creditCents: number;
  netFutaCents: number;
  notes: string[];
};

/**
 * FUTA for one pay period.
 *
 * EVERYBODY "KNOWS" FUTA IS 0.6%. It is not. Section 3301 imposes SIX PERCENT.
 * The 0.6% figure is what is left after a credit under section 3302 that is
 * CONDITIONAL, and the conditions are the whole point:
 *
 *  - Section 3302(b): the credit is the lower of your actual state
 *    unemployment rate or 5.4%.
 *  - Section 3302(a)(3): state contributions paid AFTER the Form 940 due date
 *    earn only 90% of the credit they would otherwise have earned. Paying
 *    Washington late therefore costs Michael twice - once in state penalty and
 *    again in lost federal credit. He will never see that connection on a
 *    notice; the system has to tell him.
 *  - Section 3302(c)(2): in a "credit reduction state" (one that has not repaid
 *    its federal loans) the credit is cut further, 0.3% per year outstanding.
 *
 * Hardcoding 0.6% would silently understate the liability in exactly the years
 * it matters. So we compute it, and `creditReductionMilliPct` must be supplied
 * from the IRS's annual Schedule A determination - never assumed.
 */
export function computeFutaForPeriod(args: {
  ytd: YtdWageAccumulators;
  periodWagesCents: number;
  /** The employer's actual state unemployment rate, milli-percent. */
  stateUnemploymentRateMilliPct: number;
  /** Were state contributions paid by the Form 940 due date? */
  stateContributionsPaidTimely: boolean;
  /** IRS Schedule A credit reduction for the state and year. 0 in a normal year. */
  creditReductionMilliPct: number;
}): FutaResult {
  const {
    ytd,
    periodWagesCents,
    stateUnemploymentRateMilliPct,
    stateContributionsPaidTimely,
    creditReductionMilliPct,
  } = args;

  if (!Number.isInteger(periodWagesCents) || periodWagesCents < 0) {
    throw new Error("computeFutaForPeriod: periodWagesCents must be a non-negative integer");
  }
  if (!Number.isInteger(stateUnemploymentRateMilliPct) || stateUnemploymentRateMilliPct < 0) {
    throw new Error("computeFutaForPeriod: state rate must be a non-negative integer milli-percent");
  }
  if (!Number.isInteger(creditReductionMilliPct) || creditReductionMilliPct < 0) {
    throw new Error("computeFutaForPeriod: credit reduction must be a non-negative integer milli-percent");
  }

  const notes: string[] = [];

  const band = applyWageCeiling({
    ytdWagesCents: ytd.futaWagesCents,
    periodWagesCents,
    ceilingCents: FUTA_WAGE_BASE_CENTS,
  });
  const taxable = band.taxableThisPeriodCents;
  // Telescoped for the same reason as FICA: 6% of the $7,000 FUTA base is
  // exactly $420.00 per employee per year, and that is what Form 940 should
  // foot to. Per-period rounding can land a cent off it.
  const futaCumBefore = Math.min(ytd.futaWagesCents, FUTA_WAGE_BASE_CENTS);
  const gross = telescopingTaxForPeriod(
    futaCumBefore,
    futaCumBefore + taxable,
    FUTA_GROSS_RATE_MILLI_PCT,
  );

  // 3302(b): lower of the actual state rate or 5.4%.
  let creditRate = Math.min(stateUnemploymentRateMilliPct, FUTA_MAX_CREDIT_MILLI_PCT);

  // 3302(a)(3): 90% of the credit if the state money went in late.
  if (!stateContributionsPaidTimely) {
    creditRate = divideRoundHalfUp(
      creditRate * FUTA_LATE_PAYMENT_CREDIT_MILLI_PCT,
      ONE_HUNDRED_PERCENT_MILLI,
    );
    notes.push(
      "Your Washington unemployment contributions were not paid by the Form 940 deadline, so " +
        "federal law cuts your FUTA credit to 90% of what it would have been. That is the part " +
        "people miss: paying the state late does not just cost a state penalty, it raises your " +
        "FEDERAL bill for the same money. The same lateness gets billed twice.",
    );
  }

  // 3302(c)(2): credit reduction state.
  if (creditReductionMilliPct > 0) {
    creditRate = Math.max(0, creditRate - creditReductionMilliPct);
    notes.push(
      "Washington is on the IRS credit-reduction list for this year, which means the state still " +
        "owes the federal unemployment fund. Your FUTA credit is reduced and your effective FUTA " +
        "rate goes up. This is nothing you did wrong and nothing you can appeal - but it does " +
        "have to be on the Form 940 Schedule A.",
    );
  }

  let credit = telescopingTaxForPeriod(futaCumBefore, futaCumBefore + taxable, creditRate);

  // 3302(c)(1): total credits may never exceed 90% of the tax itself.
  const creditCeiling = divideRoundHalfUp(gross * 90_000, ONE_HUNDRED_PERCENT_MILLI);
  if (credit > creditCeiling) {
    credit = creditCeiling;
    notes.push(
      "The credit was trimmed because section 3302(c)(1) will not let credits exceed 90% of the " +
        "federal unemployment tax itself.",
    );
  }

  const net = gross - credit;

  return {
    futaTaxableCents: taxable,
    grossFutaCents: gross,
    effectiveCreditMilliPct: creditRate,
    creditCents: credit,
    netFutaCents: net,
    notes,
  };
}

// ===========================================================================
// 7) WASHINGTON PROGRAMS
// ===========================================================================

export type WaPfmlResult = {
  pfmlTaxableCents: number;
  totalPremiumCents: number;
  employeeShareCents: number;
  employerShareCents: number;
  employerExemptSmallBusiness: boolean;
  notes: string[];
};

/**
 * WA Paid Family & Medical Leave for one pay period.
 *
 * RCW 50A.10.030(5)(a): an employer with fewer than 50 Washington employees
 * owes no EMPLOYER portion - but still must withhold and remit the EMPLOYEE
 * portion. Skipping the employee half because "we're too small" is a common and
 * expensive misreading, so the small-employer branch says so out loud.
 *
 * The headcount is a point-in-time determination (four-quarter average measured
 * at September 30 under RCW 50A.10.030(7)(c)), which is why it is passed in as a
 * stored, dated fact rather than recomputed from today's employee list.
 */
export function computeWaPfmlForPeriod(args: {
  ytd: YtdWageAccumulators;
  periodWagesCents: number;
  /** Total premium rate, milli-percent. 2026 = 1130. */
  totalRateMilliPct: number;
  /** Employer share of the premium, milli-percent of the premium. 2026 = 28570. */
  employerSharePctMilliPct: number;
  /** The stored determination, not a live count. */
  employerHasFewerThan50WaEmployees: boolean;
}): WaPfmlResult {
  const {
    ytd,
    periodWagesCents,
    totalRateMilliPct,
    employerSharePctMilliPct,
    employerHasFewerThan50WaEmployees,
  } = args;

  if (!Number.isInteger(totalRateMilliPct) || totalRateMilliPct < 0) {
    throw new Error("computeWaPfmlForPeriod: rate must be a non-negative integer milli-percent");
  }
  if (totalRateMilliPct > WA_PFML_STATUTORY_RATE_CEILING_MILLI_PCT) {
    // RCW 50A.10.030(6)(b)(ii): "The total premium rate must not exceed 1.20
    // percent." A configured rate above the statutory ceiling is a data-entry
    // error, and computing with it would produce a real over-deduction from a
    // real person's check. Refuse. (Rule 14.)
    throw new Error(
      `computeWaPfmlForPeriod: a Paid Leave premium rate of ${totalRateMilliPct} milli-percent exceeds ` +
        "the 1.20% ceiling in RCW 50A.10.030(6)(b)(ii). Check the rate you entered against the ESD notice.",
    );
  }

  const notes: string[] = [];
  const band = applyWageCeiling({
    ytdWagesCents: ytd.waPfmlWagesCents,
    periodWagesCents,
    // DERIVED from the Social Security base by statute - not a second constant.
    ceilingCents: WA_PFML_WAGE_BASE_2026_CENTS,
  });
  const taxable = band.taxableThisPeriodCents;
  // Telescoped. Paid Leave shares the $184,500 Social Security ceiling, so the
  // annual premium has an exact statutory maximum just like OASDI does, and the
  // ESD quarterly return should foot to it without a fractions-of-cents line.
  const pfmlCumBefore = Math.min(ytd.waPfmlWagesCents, WA_PFML_WAGE_BASE_2026_CENTS);
  const total = telescopingTaxForPeriod(pfmlCumBefore, pfmlCumBefore + taxable, totalRateMilliPct);

  // Split the premium, then make the halves reconcile by construction: compute
  // the employer share and DERIVE the employee share by subtraction. Rounding
  // two shares independently can leave the pair off by a cent from the total,
  // and that cent shows up as an unexplained variance on the quarterly return.
  const employerRaw = applyMilliPct(total, employerSharePctMilliPct);
  const employer = employerHasFewerThan50WaEmployees ? 0 : employerRaw;
  const employee = total - employerRaw;

  if (employerHasFewerThan50WaEmployees) {
    notes.push(
      "You have fewer than 50 Washington employees, so you do not owe the employer share of Paid " +
        "Leave. You DO still have to withhold the employee's share out of their check and send it " +
        "in. Being small excuses your part, not theirs.",
    );
  }

  return {
    pfmlTaxableCents: taxable,
    totalPremiumCents: employerHasFewerThan50WaEmployees ? employee : total,
    employeeShareCents: employee,
    employerShareCents: employer,
    employerExemptSmallBusiness: employerHasFewerThan50WaEmployees,
    notes,
  };
}

export type WaCaresResult = {
  waCaresTaxableCents: number;
  employeeCents: number;
  /** Always zero. There is no employer share in the statute at all. */
  employerCents: 0;
  exempt: boolean;
  notes: string[];
};

/**
 * WA Cares for one pay period.
 *
 * TWO THINGS ABOUT THIS FUNCTION ARE DELIBERATE AND BOTH ARE TESTED:
 *
 * 1. IT PASSES `null` AS THE CEILING. WA Cares is uncapped. Paid Leave is
 *    capped at $184,500. They go on the same ESD quarterly return. An engine
 *    that computes one "Washington wage base" and reuses it under-withholds
 *    WA Cares for every high earner. There is no shared variable here.
 *
 * 2. AN EXEMPTION REQUIRES EVIDENCE, NOT A CHECKBOX. Exemptions are approved by
 *    ESD and the employer must keep the approval letter on file. So the caller
 *    passes the evidence document id, and a claimed exemption with no document
 *    is REFUSED rather than honored (standing rule 11: evidence, not
 *    assertion). Honoring a bare boolean would mean under-withholding trust
 *    money on somebody's say-so.
 */
export function computeWaCaresForPeriod(args: {
  ytd: YtdWageAccumulators;
  periodWagesCents: number;
  rateMilliPct: number;
  exemptionApprovalDocumentId: string | null;
  employeeClaimsExemption: boolean;
}): WaCaresResult {
  const { ytd, periodWagesCents, rateMilliPct, exemptionApprovalDocumentId, employeeClaimsExemption } =
    args;

  if (!Number.isInteger(rateMilliPct) || rateMilliPct < 0) {
    throw new Error("computeWaCaresForPeriod: rate must be a non-negative integer milli-percent");
  }
  if (rateMilliPct > WA_CARES_STATUTORY_RATE_CEILING_MILLI_PCT) {
    throw new Error(
      `computeWaCaresForPeriod: a WA Cares rate of ${rateMilliPct} milli-percent exceeds the .58% ceiling ` +
        "in RCW 50B.04.080(1). The pension funding council cannot set it higher, so this is a data-entry error.",
    );
  }

  const notes: string[] = [];

  if (employeeClaimsExemption && !exemptionApprovalDocumentId) {
    throw new Error(
      "computeWaCaresForPeriod: this employee is marked exempt from WA Cares but there is no ESD " +
        "approval letter on file. An exemption is not something an employee can simply declare - ESD " +
        "approves it and you must keep the letter. Attach the approval before turning the deduction off, " +
        "because if it turns out they were not exempt, the money you failed to withhold is money you owe.",
    );
  }

  if (employeeClaimsExemption) {
    notes.push(
      "This employee has an approved ESD exemption from WA Cares on file, so nothing is withheld " +
        "for it. Their Paid Leave premium is unaffected - those are two different programs.",
    );
    return {
      waCaresTaxableCents: 0,
      employeeCents: 0,
      employerCents: 0,
      exempt: true,
      notes,
    };
  }

  const band = applyWageCeiling({
    ytdWagesCents: ytd.waCaresWagesCents,
    periodWagesCents,
    ceilingCents: WA_CARES_WAGE_BASE_CENTS, // null - UNCAPPED, on purpose.
  });
  // Telescoped for consistency with the other Washington programs. WA Cares is
  // uncapped so there is no annual maximum to hit, but the employee's total for
  // the year should still be .58% of their actual wages rounded once, not the
  // sum of twenty-six separate roundings.
  const caresCumBefore = ytd.waCaresWagesCents;
  const employee = telescopingTaxForPeriod(
    caresCumBefore,
    caresCumBefore + band.taxableThisPeriodCents,
    rateMilliPct,
  );

  return {
    waCaresTaxableCents: band.taxableThisPeriodCents,
    employeeCents: employee,
    employerCents: 0,
    exempt: false,
    notes,
  };
}

// ===========================================================================
// 8) DESIGNED REFUSALS
// ===========================================================================

/**
 * Some numbers cannot be computed, and the correct output is a refusal.
 *
 * A refusal is a first-class RESULT here, not an exception, because Michael has
 * to be able to see it on screen, understand it, and act on it. Every refusal
 * carries the authority that requires it and the exact next step that clears
 * it. "I don't know" is a legitimate answer; "here is a plausible number I made
 * up" is not (standing rule 1).
 */
/** One line in the withholding queue, in priority order. */
export type OrderedDeduction = { label: string; amountCents: number };

export type OrderingResult = {
  totalWithheldCents: number;
  totalUncollectedCents: number;
  uncollectedByTax: readonly { label: string; shortfallCents: number }[];
};

/**
 * THE INSUFFICIENT-FUNDS ORDERING RULE, as a pure function.
 *
 * Walk the queue in priority order, take what is available for each line, stop
 * when the money runs out. Report what could not be collected, per line.
 *
 * This is deliberately separated from `computePaycheckTaxes` so it can be swept
 * exhaustively over its whole input domain rather than sampled through a
 * paycheck. Its two invariants are checked here, at the only place they can be
 * violated, instead of being asserted downstream where they are unreachable:
 *
 *   withheld <= available            (nobody gets a negative paycheck)
 *   withheld + uncollected == wanted (no cent appears or disappears)
 *
 * See `computePaycheckTaxes` for the authorities: IRS Pub. 15 section 6 supplies
 * the ordering, Pub. 15 section 13 supplies the treatment of the shortfall, and
 * RCW 49.52.050 supplies the reason it is a refusal and not a warning.
 */
export function applyWithholdingOrderingRule(
  availableCents: number,
  queue: readonly OrderedDeduction[],
): OrderingResult {
  if (!Number.isInteger(availableCents) || availableCents < 0) {
    throw new Error(
      "applyWithholdingOrderingRule: available pay must be a non-negative integer number of cents",
    );
  }
  let remaining = availableCents;
  let totalWithheld = 0;
  let wanted = 0;
  const uncollectedByTax: { label: string; shortfallCents: number }[] = [];

  for (const d of queue) {
    if (!Number.isInteger(d.amountCents) || d.amountCents < 0) {
      throw new Error(
        `applyWithholdingOrderingRule: "${d.label}" is not a non-negative integer number of cents. ` +
          "A deduction that is not a whole number of cents cannot be taken out of a real paycheck.",
      );
    }
    wanted += d.amountCents;
    const taken = Math.min(d.amountCents, remaining);
    totalWithheld += taken;
    remaining -= taken;
    if (taken < d.amountCents) {
      uncollectedByTax.push({ label: d.label, shortfallCents: d.amountCents - taken });
    }
  }

  const totalUncollected = wanted - totalWithheld;

  // The invariants, checked where they are actually reachable.
  if (totalWithheld > availableCents) {
    throw new Error(
      "applyWithholdingOrderingRule: withheld more than was available. This would produce a negative " +
        "paycheck, which RCW 49.52.050 makes a misdemeanor. Refusing to return it.",
    );
  }
  if (totalWithheld + totalUncollected !== wanted) {
    throw new Error(
      "applyWithholdingOrderingRule: withheld plus uncollected did not equal the amount owed. " +
        "A cent went missing; refusing to return an unbalanced result.",
    );
  }

  return {
    totalWithheldCents: totalWithheld,
    totalUncollectedCents: totalUncollected,
    uncollectedByTax,
  };
}

export type PayrollRefusalCode =
  | "wa_suta_rate_not_evidenced"
  | "lni_rate_not_evidenced"
  | "lni_class_not_evidenced"
  | "withholding_exceeds_gross_pay";

export type PayrollRefusal = {
  code: PayrollRefusalCode;
  /** What Michael reads. Plain English, no jargon, no blame. */
  message: string;
  /** The single concrete action that unblocks it. */
  whatToDo: string;
  /** Authority record id in payroll-tax-authorities.ts. */
  authorityId: string;
};

export type Computed<T> = { ok: true; value: T } | { ok: false; refusal: PayrollRefusal };

export type WaSutaResult = {
  sutaTaxableCents: number;
  employerCents: number;
  /** Always zero: SUTA never comes out of an employee's check in Washington. */
  employeeCents: 0;
  notes: string[];
};

/**
 * Washington unemployment tax for one pay period.
 *
 * REFUSES without an evidenced rate. Washington does not publish one SUTA rate;
 * it computes a rate for each employer from that employer's own benefit-charge
 * history and mails it every December. There is no public constant to fall back
 * on and no way to derive it. Guessing would produce a wrong quarterly return
 * that looks right, which is worse than no answer at all.
 */
export function computeWaSutaForPeriod(args: {
  ytd: YtdWageAccumulators;
  periodWagesCents: number;
  /** From Michael's ESD rate notice. null when we do not have it. */
  combinedRateMilliPct: number | null;
  /** The document id of the stored rate notice. */
  rateNoticeDocumentId: string | null;
}): Computed<WaSutaResult> {
  const { ytd, periodWagesCents, combinedRateMilliPct, rateNoticeDocumentId } = args;

  if (combinedRateMilliPct === null || rateNoticeDocumentId === null) {
    return {
      ok: false,
      refusal: {
        code: "wa_suta_rate_not_evidenced",
        message:
          "I can't compute your Washington unemployment tax, because your rate is not a number I " +
          "can look up. Washington gives every employer a different rate based on your own layoff " +
          "history, and they mail it to you every December. I will not invent one - a made-up rate " +
          "produces a quarterly return that balances perfectly and is still wrong.",
        whatToDo:
          "Find your Employment Security Department tax rate notice for this year (it arrives by " +
          "mail in December, and it is also in your ESD online account under Tax Rate Notice). " +
          "Upload it here and I will read the combined rate off it and store it with the document " +
          "attached, so a year from now we can both see where the number came from.",
        authorityId: "esd-suta-rate-structure",
      },
    };
  }

  if (!Number.isInteger(combinedRateMilliPct) || combinedRateMilliPct < 0) {
    throw new Error("computeWaSutaForPeriod: rate must be a non-negative integer milli-percent");
  }

  const notes: string[] = [];
  if (combinedRateMilliPct > WA_SUTA_COMBINED_CEILING_MILLI_PCT) {
    notes.push(
      "The rate on file is above the 6% cap that normally applies to the experience and social " +
        "taxes combined. That can be legitimate - delinquency surcharges and the administrative " +
        "fund fee ride on top - but it is worth checking the notice again.",
    );
  }

  const band = applyWageCeiling({
    ytdWagesCents: ytd.waSutaWagesCents,
    periodWagesCents,
    ceilingCents: WA_SUTA_WAGE_BASE_2026_CENTS,
  });
  // Telescoped like every other capped tax here, so the year foots to
  // rate x $78,200 exactly and the ESD quarterly return needs no plug.
  const sutaCumBefore = Math.min(ytd.waSutaWagesCents, WA_SUTA_WAGE_BASE_2026_CENTS);
  const employer = telescopingTaxForPeriod(
    sutaCumBefore,
    sutaCumBefore + band.taxableThisPeriodCents,
    combinedRateMilliPct,
  );

  return {
    ok: true,
    value: {
      sutaTaxableCents: band.taxableThisPeriodCents,
      employerCents: employer,
      employeeCents: 0,
      notes,
    },
  };
}

export type LniResult = {
  hundredthHours: number;
  /** Employer's share of the accident fund + supplemental pension, cents. */
  employerCents: number;
  /** Employee's share: exactly HALF the medical aid rate. Nothing else. */
  employeeCents: number;
  totalPremiumCents: number;
  notes: string[];
};

/**
 * L&I industrial insurance for one pay period.
 *
 * THIS IS THE MOST DANGEROUS CALCULATION IN WASHINGTON PAYROLL and the code is
 * shaped around that fact.
 *
 * It is not a percentage of wages. It is a fixed number of cents per HOUR
 * worked, and the rate depends on the risk classification L&I assigned to the
 * business. Both the rate and the class come from the employer's own rate
 * notice; L&I revises them at times it designates (RCW 51.16.035(2)), so there
 * is no public constant we can safely freeze. We refuse without evidence.
 *
 * And the employee's share is not "half of L&I." Under RCW 51.16.140(1) the
 * employer may deduct one-half of the MEDICAL AID portion and nothing else. The
 * accident fund and supplemental pension are the employer's alone. Deducting
 * more is not an accounting error - RCW 51.16.140(2) makes it a GROSS
 * MISDEMEANOR. That is why this function takes the medical aid rate as its own
 * separate parameter and computes the employee share from that rate alone: it
 * is structurally incapable of deducting half the total.
 *
 * Hours are integers in HUNDREDTHS of an hour. Once hours become a tax base
 * they carry the same integrity requirement as money, so floats are forbidden
 * here for the same reason (Rule 13e).
 */
export function computeLniForPeriod(args: {
  hundredthHours: number;
  /** Accident fund + supplemental pension, cents per hour. Employer only. */
  employerOnlyRateCentsPerHour: number | null;
  /** Medical aid fund, cents per hour. Split half/half. */
  medicalAidRateCentsPerHour: number | null;
  riskClassCode: string | null;
  rateNoticeDocumentId: string | null;
}): Computed<LniResult> {
  const {
    hundredthHours,
    employerOnlyRateCentsPerHour,
    medicalAidRateCentsPerHour,
    riskClassCode,
    rateNoticeDocumentId,
  } = args;

  if (!riskClassCode) {
    return {
      ok: false,
      refusal: {
        code: "lni_class_not_evidenced",
        message:
          "I can't compute workers' comp until I know which risk classification L&I assigned you. " +
          "Retail cannabis, growing, and processing are different classes with very different " +
          "rates, and putting people in the wrong class is one of the first things an L&I auditor " +
          "checks. I am not going to pick one for you.",
        whatToDo:
          "Look at your L&I rate notice or your quarterly report - the class code is printed on " +
          "both, usually as a four-digit number with a sub-class. Enter it here along with the " +
          "notice itself.",
        authorityId: "rcw-51-16-035-lni-classification",
      },
    };
  }

  if (
    employerOnlyRateCentsPerHour === null ||
    medicalAidRateCentsPerHour === null ||
    rateNoticeDocumentId === null
  ) {
    return {
      ok: false,
      refusal: {
        code: "lni_rate_not_evidenced",
        message:
          "I can't compute workers' comp without your actual L&I hourly rates. These are set per " +
          "risk class and L&I changes them when it decides to, so there is no published number I " +
          "can safely assume. I also need them split out, because the law only lets you deduct " +
          "half of the MEDICAL AID piece from your employees - not half of the total.",
        whatToDo:
          "Upload your L&I rate notice. It lists, per class, the accident fund rate, the medical " +
          "aid rate, and the supplemental pension rate, each as an amount per hour worked. Once " +
          "those are in, every paycheck computes automatically and the employee half is capped by " +
          "the software at exactly half the medical aid rate.",
        authorityId: "rcw-51-16-035-lni-classification",
      },
    };
  }

  if (!Number.isInteger(hundredthHours) || hundredthHours < 0) {
    throw new Error("computeLniForPeriod: hours must be a non-negative integer in hundredths of an hour");
  }
  if (!Number.isInteger(employerOnlyRateCentsPerHour) || !Number.isInteger(medicalAidRateCentsPerHour)) {
    throw new Error("computeLniForPeriod: L&I rates must be integer cents per hour");
  }

  // Rates are per WHOLE hour; hours arrive in hundredths. Divide once, explicitly.
  const employerOnly = divideRoundHalfUp(hundredthHours * employerOnlyRateCentsPerHour, 100);
  const medicalAidTotal = divideRoundHalfUp(hundredthHours * medicalAidRateCentsPerHour, 100);

  // RCW 51.16.140(1): the employee pays ONE-HALF of the medical aid amount.
  // Round the employee's half DOWN so a rounding penny can never fall on the
  // worker. Over-deducting by a penny is still an unlawful deduction; the
  // employer absorbing a penny is not.
  const employeeShare = Math.floor(medicalAidTotal / 2);
  const employerMedicalAid = medicalAidTotal - employeeShare;

  return {
    ok: true,
    value: {
      hundredthHours,
      employerCents: employerOnly + employerMedicalAid,
      employeeCents: employeeShare,
      totalPremiumCents: employerOnly + medicalAidTotal,
      notes: [
        "The only thing Washington lets you take out of an employee's check for workers' comp is " +
          "half of the medical aid rate. The accident fund and the supplemental pension are yours. " +
          "If the total ever looks like it should be split down the middle, it should not be.",
      ],
    },
  };
}

// ===========================================================================
// 9) ONE PAYCHECK, END TO END
// ===========================================================================

export type PaycheckTaxes = {
  grossWagesCents: number;
  federalIncomeTax: Worksheet1AResult;
  fica: FicaResult;
  futa: FutaResult;
  pfml: WaPfmlResult;
  waCares: WaCaresResult;
  /** Refusals are surfaced, not swallowed. */
  suta: Computed<WaSutaResult>;
  lni: Computed<LniResult>;
  /**
   * What the employee actually loses from this check, AFTER the insufficient-
   * funds ordering rule. Equal to `fullEmployeeWithholdingCents` on any normal
   * check; smaller only when the check could not carry its own withholding.
   */
  totalEmployeeWithheldCents: number;
  /**
   * What the tax calculations said should come out, before any ordering. Kept
   * separately so the shortfall is a visible subtraction rather than a number
   * that quietly changed.
   */
  fullEmployeeWithholdingCents: number;
  /**
   * Computed withholding that this check could not cover. Zero on a normal
   * check. When non-zero, the employer still owes it (Pub. 15 section 13) and
   * must either recover it from later pay or absorb it.
   */
  uncollectedEmployeeTaxCents: number;
  /** Which taxes got cut short, and by how much. Empty on a normal check. */
  uncollectedByTax: readonly { label: string; shortfallCents: number }[];
  /** What the company owes on top of gross pay. */
  totalEmployerTaxCents: number;
  /**
   * Gross minus employee withholding. GUARANTEED to be zero or positive: this
   * engine will not produce a paycheck for a negative amount. See the ordering
   * block in `computePaycheckTaxes` for why that is a legal requirement in
   * Washington and not merely good manners.
   */
  netPayCents: number;
  /** True when any component refused; net pay is still exact, employer cost is not. */
  hasRefusals: boolean;
  refusals: PayrollRefusal[];
  notes: string[];
};

/**
 * Compute every tax on one paycheck.
 *
 * NOTE WHAT A REFUSAL DOES AND DOES NOT BREAK. If the SUTA rate or the L&I rate
 * is missing, the employee's NET PAY is still exact - none of those are employee
 * deductions (except the L&I medical aid half, which is why its absence is
 * flagged). What becomes unknown is the EMPLOYER's cost. So we still cut an
 * accurate check and we tell Michael precisely which part of his own cost we
 * cannot state yet. Refusing to compute anything at all would be theater.
 */
export function computePaycheckTaxes(args: {
  w4: W4Record;
  payFrequency: PayFrequency;
  grossWagesCents: number;
  ytd: YtdWageAccumulators;
  hundredthHours: number;
  stateUnemploymentRateMilliPct: number | null;
  sutaRateNoticeDocumentId: string | null;
  stateContributionsPaidTimely: boolean;
  creditReductionMilliPct: number;
  pfmlTotalRateMilliPct: number;
  pfmlEmployerSharePctMilliPct: number;
  employerHasFewerThan50WaEmployees: boolean;
  waCaresRateMilliPct: number;
  waCaresExemptionApprovalDocumentId: string | null;
  employeeClaimsWaCaresExemption: boolean;
  lniEmployerOnlyRateCentsPerHour: number | null;
  lniMedicalAidRateCentsPerHour: number | null;
  lniRiskClassCode: string | null;
  lniRateNoticeDocumentId: string | null;
}): PaycheckTaxes {
  const gross = args.grossWagesCents;

  const federalIncomeTax = computeWorksheet1A({
    w4: args.w4,
    payFrequency: args.payFrequency,
    wagesThisPeriodCents: gross,
  });
  const fica = computeFicaForPeriod({ ytd: args.ytd, periodWagesCents: gross });

  // FUTA's credit depends on the state rate. When the state rate is unknown we
  // must NOT silently credit 5.4% - that would understate the federal tax. Use
  // a zero credit, which is the conservative direction (it overstates the
  // liability rather than understating it), and say so.
  const futa = computeFutaForPeriod({
    ytd: args.ytd,
    periodWagesCents: gross,
    stateUnemploymentRateMilliPct: args.stateUnemploymentRateMilliPct ?? 0,
    stateContributionsPaidTimely: args.stateContributionsPaidTimely,
    creditReductionMilliPct: args.creditReductionMilliPct,
  });

  const pfml = computeWaPfmlForPeriod({
    ytd: args.ytd,
    periodWagesCents: gross,
    totalRateMilliPct: args.pfmlTotalRateMilliPct,
    employerSharePctMilliPct: args.pfmlEmployerSharePctMilliPct,
    employerHasFewerThan50WaEmployees: args.employerHasFewerThan50WaEmployees,
  });

  const waCares = computeWaCaresForPeriod({
    ytd: args.ytd,
    periodWagesCents: gross,
    rateMilliPct: args.waCaresRateMilliPct,
    exemptionApprovalDocumentId: args.waCaresExemptionApprovalDocumentId,
    employeeClaimsExemption: args.employeeClaimsWaCaresExemption,
  });

  const suta = computeWaSutaForPeriod({
    ytd: args.ytd,
    periodWagesCents: gross,
    combinedRateMilliPct: args.stateUnemploymentRateMilliPct,
    rateNoticeDocumentId: args.sutaRateNoticeDocumentId,
  });

  const lni = computeLniForPeriod({
    hundredthHours: args.hundredthHours,
    employerOnlyRateCentsPerHour: args.lniEmployerOnlyRateCentsPerHour,
    medicalAidRateCentsPerHour: args.lniMedicalAidRateCentsPerHour,
    riskClassCode: args.lniRiskClassCode,
    rateNoticeDocumentId: args.lniRateNoticeDocumentId,
  });

  const refusals: PayrollRefusal[] = [];
  if (!suta.ok) refusals.push(suta.refusal);
  if (!lni.ok) refusals.push(lni.refusal);

  const notes: string[] = [
    ...federalIncomeTax.notes,
    ...fica.notes,
    ...futa.notes,
    ...pfml.notes,
    ...waCares.notes,
    ...(suta.ok ? suta.value.notes : []),
    ...(lni.ok ? lni.value.notes : []),
  ];

  if (args.stateUnemploymentRateMilliPct === null) {
    notes.push(
      "Because I do not have your Washington unemployment rate yet, I calculated federal " +
        "unemployment tax with NO state credit at all - the full 6%. That is deliberately the " +
        "cautious direction: the real number will be lower once your rate notice is loaded, never " +
        "higher. Do not send this figure to the IRS as-is.",
    );
  }

  const employeeLni = lni.ok ? lni.value.employeeCents : 0;

  const fullEmployeeWithholding =
    federalIncomeTax.line4b_withholdingCents +
    fica.totalEmployeeFicaCents +
    pfml.employeeShareCents +
    waCares.employeeCents +
    employeeLni;

  // =========================================================================
  // THE INSUFFICIENT-FUNDS ORDERING RULE
  //
  // A paycheck can be too small to carry its own withholding. It is not a
  // theoretical case and it is not always a data-entry error. Washington L&I
  // premiums are assessed PER HOUR WORKED, not as a percentage of pay, so an
  // employee who worked a full 80-hour period and whose gross pay for that
  // period is nearly nothing - a final check that is almost entirely offset by
  // an advance, a corrected check, a commission-only period with no sales -
  // carries a real dollar L&I liability against pennies of gross. Twelve
  // dollars of employee L&I against one cent of gross is arithmetic, not a bug.
  //
  // WHAT THE NAIVE ANSWER GETS WRONG. Subtract anyway and you have computed a
  // negative net pay. In Washington, handing someone a check that says they owe
  // YOU money is not a rounding curiosity, it is RCW 49.52.050: paying an
  // employee less than the wage you are obligated to pay them, wilfully, is a
  // MISDEMEANOR, and the statute reaches "any officer, vice principal or agent"
  // - Michael personally, not just the corporation. RCW 49.52.060 provides the
  // only two exits: the deduction is required by law, or the employee
  // authorized it in writing in advance. Neither one lets a deduction exceed
  // the wages it is being taken from.
  //
  // WHAT THE IRS ACTUALLY SAYS TO DO. Pub. 15 section 6 gives the only ordering
  // instruction in the whole publication, and its shape is the answer:
  // "If there aren't enough funds available, withhold taxes in the following
  // order" - you go down a list and you STOP when the money is gone. You do not
  // overdraw. Pub. 15 section 13 then handles the leftover: "you can make it up
  // from later pay to that employee. But you're the one who owes the
  // underpayment."
  //
  // SO THAT IS WHAT WE DO, in this order, most-protected money first:
  //   1. Social Security and Medicare      - trust fund money, section 7501
  //   2. Additional Medicare               - trust fund money
  //   3. Federal income tax                - trust fund money
  //   4. WA Paid Leave employee share      - state trust money
  //   5. WA Cares employee share           - state trust money
  //   6. L&I employee half                 - a premium, and the item most
  //                                          likely to be what overflowed
  //
  // AND THEN WE REFUSE ANYWAY. Even after ordering, net pay lands at zero and
  // the employee gets a check for nothing while still owing tax. That is a
  // situation no automatic rule should resolve silently - it means something
  // upstream is wrong (wrong hours, wrong pay, a check that should have been a
  // correction) or it means Michael has to decide to absorb the shortfall. So
  // the ordering keeps the arithmetic legal and a REFUSAL puts the decision in
  // front of a human, with the number that could not be collected stated
  // plainly. Silence here would be the worst possible outcome: an employee
  // shorted, a liability unrecorded, and nobody told.
  // =========================================================================
  const ordering = applyWithholdingOrderingRule(gross, [
    { label: "Social Security and Medicare", amountCents: fica.employeeOasdiCents + fica.employeeMedicareCents },
    { label: "Additional Medicare", amountCents: fica.employeeAdditionalMedicareCents },
    { label: "federal income tax", amountCents: federalIncomeTax.line4b_withholdingCents },
    { label: "WA Paid Leave", amountCents: pfml.employeeShareCents },
    { label: "WA Cares", amountCents: waCares.employeeCents },
    { label: "L&I medical aid (employee half)", amountCents: employeeLni },
  ]);
  const totalEmployeeWithheld = ordering.totalWithheldCents;
  const uncollectedByTax = ordering.uncollectedByTax;
  const uncollected = ordering.totalUncollectedCents;

  if (uncollected > 0) {
    const detail = uncollectedByTax
      .map((u) => `${u.label} (${formatCentsPlain(u.shortfallCents)})`)
      .join(", ");
    refusals.push({
      code: "withholding_exceeds_gross_pay",
      message:
        `I stopped this paycheck. The taxes that are supposed to come out of it add up to ` +
        `${formatCentsPlain(fullEmployeeWithholding)}, but the check itself is only ` +
        `${formatCentsPlain(gross)}. Taking it all out would hand this person a check for a NEGATIVE ` +
        `amount, which in Washington is not a math quirk - RCW 49.52.050 makes wilfully paying an ` +
        `employee less than you owe them a misdemeanor, and it names officers personally, not just the ` +
        `company. So I withheld in the order the IRS lays out in Pub. 15 (trust-fund taxes first) until ` +
        `the money ran out, and I stopped there. Left uncollected: ${detail}. ` +
        `The usual cause is Labor & Industries: their premium is charged per HOUR WORKED, not as a ` +
        `percentage of pay, so a lot of hours against very little gross pay produces exactly this. ` +
        `Note that you still owe the uncollected amount either way - Pub. 15 is blunt about it: "you're ` +
        `the one who owes the underpayment."`,
      whatToDo:
        "Check three things, in this order. First, are the hours right for this check? A full period of " +
        "hours against near-zero pay is almost always a timecard entered on the wrong pay period. " +
        "Second, is the gross right - was something already deducted upstream that should have been on " +
        "this check instead? Third, if the hours and the pay are both genuinely correct (a final check " +
        "mostly offset by an advance, say), then this is a real shortfall: record it as uncollected " +
        "employee tax and recover it from the next check. Federal income tax and Additional Medicare " +
        "have to be recovered on or before December 31 of this year or they stop being recoverable and " +
        "become yours. Do not paper over it by lowering the tax - the tax is right; the check is small.",
      authorityId: "pub15-2026-insufficient-funds-ordering",
    });
  }

  // The two invariants that keep a negative check off the printer - withheld
  // never exceeds available, and withheld plus uncollected equals owed - are
  // enforced inside `applyWithholdingOrderingRule`, where they are reachable
  // and exhaustively tested. Re-asserting them here would be unreachable code
  // that no test could ever kill, which is its own kind of lie (rule 15).
  //
  // What IS worth checking here is the seam: that the queue we handed the
  // ordering rule actually accounted for every employee deduction we computed.
  // Forgetting to add a new deduction to the queue is a real, easy mistake, and
  // it would silently under-withhold rather than throw.
  if (ordering.totalWithheldCents + ordering.totalUncollectedCents !== fullEmployeeWithholding) {
    throw new Error(
      "computePaycheckTaxes: the withholding queue does not add up to the total employee withholding. " +
        "A deduction was computed but left out of the ordering queue (or counted twice). Refusing to " +
        "issue a paycheck whose parts do not equal its whole.",
    );
  }

  const totalEmployerTax =
    fica.totalEmployerFicaCents +
    futa.netFutaCents +
    pfml.employerShareCents +
    (suta.ok ? suta.value.employerCents : 0) +
    (lni.ok ? lni.value.employerCents : 0);

  return {
    grossWagesCents: gross,
    federalIncomeTax,
    fica,
    futa,
    pfml,
    waCares,
    suta,
    lni,
    totalEmployeeWithheldCents: totalEmployeeWithheld,
    fullEmployeeWithholdingCents: fullEmployeeWithholding,
    uncollectedEmployeeTaxCents: uncollected,
    uncollectedByTax,
    totalEmployerTaxCents: totalEmployerTax,
    // By construction `totalEmployeeWithheld` never exceeds `gross`, so this is
    // never negative. The assertion below is not defensive programming, it is
    // the invariant this whole block exists to hold, checked at the seam.
    netPayCents: gross - totalEmployeeWithheld,
    hasRefusals: refusals.length > 0,
    refusals,
    notes,
  };
}

/** Roll this period's wages into the year-to-date accumulators. */
export function advanceYtd(
  ytd: YtdWageAccumulators,
  periodWagesCents: number,
  hundredthHours: number,
): YtdWageAccumulators {
  if (!Number.isInteger(periodWagesCents) || periodWagesCents < 0) {
    throw new Error("advanceYtd: periodWagesCents must be a non-negative integer");
  }
  return {
    oasdiWagesCents: ytd.oasdiWagesCents + periodWagesCents,
    medicareWagesCents: ytd.medicareWagesCents + periodWagesCents,
    futaWagesCents: ytd.futaWagesCents + periodWagesCents,
    waSutaWagesCents: ytd.waSutaWagesCents + periodWagesCents,
    waPfmlWagesCents: ytd.waPfmlWagesCents + periodWagesCents,
    waCaresWagesCents: ytd.waCaresWagesCents + periodWagesCents,
    lniHundredthHours: ytd.lniHundredthHours + hundredthHours,
  };
}

// ===========================================================================
// 10) SELF-TESTS
// ===========================================================================

/**
 * Embedded harness, mirrored by tests/compliance/payroll-withholding-core.test.ts.
 *
 * The two table identities below are the reason I am willing to sign off on 48
 * hand-transcribed IRS figures. Neither depends on my typing being right: they
 * check the numbers against each other.
 */
export function __runPayrollWithholdingCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else failures.push(msg);
  };
  const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} (got ${String(a)}, want ${String(b)})`);
  const throws = (fn: () => unknown, needle: string, msg: string) => {
    try {
      fn();
      failures.push(`${msg} - expected a throw, got none`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes(needle)) passed += 1;
      else failures.push(`${msg} - threw "${m}", expected it to mention "${needle}"`);
    }
  };

  // --- exact arithmetic ----------------------------------------------------
  eq(divideRoundHalfUp(5, 2), 3, "half rounds up");
  eq(divideRoundHalfUp(-5, 2), -3, "negative half rounds away from zero");
  eq(divideRoundHalfUp(4, 2), 2, "exact division");
  eq(divideRoundHalfUp(1, 3), 0, "a third rounds down");
  eq(divideRoundHalfUp(2, 3), 1, "two thirds rounds up");
  throws(() => divideRoundHalfUp(1.5, 2), "integers", "a float in the money path throws");
  throws(() => divideRoundHalfUp(1, 0), "division by zero", "divide by zero throws");

  // THE SSA ORACLE. The Social Security Administration publishes both the base
  // and the resulting maximum tax, so this asserts our rate math against a
  // number we did not compute.
  eq(
    applyMilliPct(OASDI_WAGE_BASE_2026_CENTS, OASDI_RATE_MILLI_PCT),
    OASDI_MAX_EMPLOYEE_TAX_2026_CENTS,
    "6.2% of the 2026 Social Security base equals the $11,439.00 SSA publishes",
  );
  eq(OASDI_MAX_EMPLOYEE_TAX_2026_CENTS, 1_143_900, "the SSA oracle constant is $11,439.00");

  // --- TABLE IDENTITY 1: CONTINUITY ---------------------------------------
  // The tax at the top of each bracket must equal the base tax of the next.
  const standardTables: Array<[string, readonly WithholdingBracket[]]> = [
    ["standard MFJ", STANDARD_MARRIED_FILING_JOINTLY],
    ["standard single/MFS", STANDARD_SINGLE_OR_MFS],
    ["standard HoH", STANDARD_HEAD_OF_HOUSEHOLD],
  ];
  const step2Tables: Array<[string, readonly WithholdingBracket[]]> = [
    ["step2 MFJ", STEP2_MARRIED_FILING_JOINTLY],
    ["step2 single/MFS", STEP2_SINGLE_OR_MFS],
    ["step2 HoH", STEP2_HEAD_OF_HOUSEHOLD],
  ];
  for (const [name, tbl] of standardTables) {
    for (let i = 0; i < tbl.length - 1; i += 1) {
      const row = tbl[i]!;
      const next = tbl[i + 1]!;
      const width = next.atLeastCents - row.atLeastCents;
      const expected = row.baseTaxCents + applyMilliPct(width, row.rateMilliPct);
      eq(expected, next.baseTaxCents, `${name} bracket ${i} flows continuously into bracket ${i + 1}`);
    }
  }

  // --- TABLE IDENTITY 1b: STEP-2 CONTINUITY ON THE *EXACT* BREAKPOINTS -----
  //
  // WHY THIS TEST LOOKS DIFFERENT FROM THE ONE ABOVE - read before "fixing" it.
  //
  // The Step 2 checkbox schedules are the standard schedules with line 1g added
  // back and the whole thing cut in half (that is IDENTITY 2, below). Halving an
  // odd dollar amount lands on a half dollar. The IRS handles that asymmetrically:
  //
  //   * the printed THRESHOLD is rounded to a whole dollar, but
  //   * the printed BASE TAX is computed from the EXACT, unrounded half-dollar
  //     breakpoint.
  //
  // The consequence is that two rows of the Single/MFS step-2 schedule are not
  // continuous against their own PRINTED thresholds - bracket 4->5 is short by
  // 12 cents and bracket 6->7 is long by 18 cents. Those are the IRS's numbers,
  // not a typo. An employer is instructed to use the printed figures, and every
  // other payroll vendor and the IRS's own calculator produce the printed
  // result, so the engine reproduces the published table byte for byte.
  //
  // Asserting printed-threshold continuity here would therefore be asserting
  // that the IRS is wrong. Instead we assert the identity that actually holds
  // and is strictly STRONGER, because it pins the base tax to the arithmetic
  // that generated it: continuity against the exact halved breakpoints.
  //
  // The arithmetic is done in HALF-CENTS so a half-cent breakpoint is still an
  // exact integer and no floating point is ever created. Note that
  // (standardFloor + line1g) expressed in CENTS is, without any division at
  // all, exactly the step-2 breakpoint expressed in HALF-CENTS.
  const step2Derivations: Array<
    [string, readonly WithholdingBracket[], readonly WithholdingBracket[], number]
  > = [
    ["step2 MFJ", STANDARD_MARRIED_FILING_JOINTLY, STEP2_MARRIED_FILING_JOINTLY, LINE_1G_MFJ_CENTS],
    ["step2 single/MFS", STANDARD_SINGLE_OR_MFS, STEP2_SINGLE_OR_MFS, LINE_1G_OTHER_CENTS],
    ["step2 HoH", STANDARD_HEAD_OF_HOUSEHOLD, STEP2_HEAD_OF_HOUSEHOLD, LINE_1G_OTHER_CENTS],
  ];
  for (const [name, std, s2, g] of step2Derivations) {
    // exactBreakpointHalfCents[i] === (standardFloor[i] + line1g) in cents.
    const exactBreakpointHalfCents = std.map((row, i) => (i === 0 ? 0 : row.atLeastCents + g));
    for (let i = 0; i < s2.length - 1; i += 1) {
      const row = s2[i]!;
      const widthHalfCents = exactBreakpointHalfCents[i + 1]! - exactBreakpointHalfCents[i]!;
      const baseHalfCents = row.baseTaxCents * 2;
      // applyMilliPct is unit-agnostic: half-cents in, half-cents out.
      const topHalfCents = baseHalfCents + applyMilliPct(widthHalfCents, row.rateMilliPct);
      eq(
        divideRoundHalfUp(topHalfCents, 2),
        s2[i + 1]!.baseTaxCents,
        `${name} bracket ${i} flows continuously into bracket ${i + 1} on the exact halved breakpoint`,
      );
    }
  }
  // And prove the two documented discontinuities against the PRINTED thresholds
  // are still exactly where we found them. If the IRS ever cleans this up, or if
  // somebody retypes the table, this test fails loudly instead of drifting.
  {
    const t = STEP2_SINGLE_OR_MFS;
    const printedTop = (i: number) =>
      t[i]!.baseTaxCents + applyMilliPct(t[i + 1]!.atLeastCents - t[i]!.atLeastCents, t[i]!.rateMilliPct);
    eq(
      printedTop(4) - t[5]!.baseTaxCents,
      12,
      "step2 single/MFS bracket 4->5 is 12c long against the printed threshold - the IRS's own rounding",
    );
    eq(
      printedTop(6) - t[7]!.baseTaxCents,
      -18,
      "step2 single/MFS bracket 6->7 is 18c short against the printed threshold - the IRS's own rounding",
    );
    for (const [name, tbl] of step2Tables) {
      if (name === "step2 single/MFS") continue;
      for (let i = 0; i < tbl.length - 1; i += 1) {
        const row = tbl[i]!;
        const width = tbl[i + 1]!.atLeastCents - row.atLeastCents;
        eq(
          row.baseTaxCents + applyMilliPct(width, row.rateMilliPct),
          tbl[i + 1]!.baseTaxCents,
          `${name} bracket ${i} happens to also be continuous on the printed threshold`,
        );
      }
    }
  }

  // --- TABLE IDENTITY 2: THE HALVING RULE ---------------------------------
  // Each Step-2 schedule is the standard schedule with line 1g added back and
  // the whole thing halved. This cross-proves 16 more figures.
  const pairs: Array<[string, readonly WithholdingBracket[], readonly WithholdingBracket[], number]> = [
    ["MFJ", STANDARD_MARRIED_FILING_JOINTLY, STEP2_MARRIED_FILING_JOINTLY, LINE_1G_MFJ_CENTS],
    ["single/MFS", STANDARD_SINGLE_OR_MFS, STEP2_SINGLE_OR_MFS, LINE_1G_OTHER_CENTS],
    ["HoH", STANDARD_HEAD_OF_HOUSEHOLD, STEP2_HEAD_OF_HOUSEHOLD, LINE_1G_OTHER_CENTS],
  ];
  for (const [name, std, s2, g] of pairs) {
    eq(std.length, s2.length, `${name}: both schedules have the same bracket count`);
    for (let i = 1; i < std.length; i += 1) {
      const a = std[i]!;
      const b = s2[i]!;
      eq(a.rateMilliPct, b.rateMilliPct, `${name} bracket ${i}: same marginal rate in both schedules`);
      const expectedFloor = roundToWholeDollarCents(divideRoundHalfUp(a.atLeastCents + g, 2));
      eq(expectedFloor, b.atLeastCents, `${name} bracket ${i}: step-2 floor is half of (standard floor + line 1g)`);
      eq(divideRoundHalfUp(a.baseTaxCents, 2), b.baseTaxCents, `${name} bracket ${i}: step-2 base tax is half the standard base tax`);
    }
  }
  // Spot-check the two figures most likely to be mistyped, by hand.
  eq(STEP2_SINGLE_OR_MFS[7]!.baseTaxCents, 9_648_963, "$96,489.63 survived as integer cents");
  eq(STANDARD_SINGLE_OR_MFS[7]!.baseTaxCents, 19_297_925, "$192,979.25 survived as integer cents");
  eq(divideRoundHalfUp(19_297_925, 2), 9_648_963, "and the first is exactly half the second");

  // --- table shape ---------------------------------------------------------
  for (const [name, tbl] of [...standardTables, ...step2Tables]) {
    eq(tbl[0]!.atLeastCents, 0, `${name} starts at zero so findBracket can never fall through`);
    eq(tbl[0]!.rateMilliPct, 0, `${name} has a 0% first bracket`);
    eq(tbl[tbl.length - 1]!.rateMilliPct, 37_000, `${name} tops out at 37%`);
    for (let i = 1; i < tbl.length; i += 1) {
      ok(tbl[i]!.atLeastCents > tbl[i - 1]!.atLeastCents, `${name} thresholds ascend at ${i}`);
      ok(tbl[i]!.rateMilliPct > tbl[i - 1]!.rateMilliPct, `${name} rates ascend at ${i}`);
      ok(Number.isInteger(tbl[i]!.baseTaxCents), `${name} base tax ${i} is an integer`);
    }
  }

  // --- bracket selection ---------------------------------------------------
  const sched = STANDARD_SINGLE_OR_MFS;
  eq(findBracket(sched, 0).rateMilliPct, 0, "zero wages land in the 0% bracket");
  eq(findBracket(sched, 749_999).rateMilliPct, 0, "one cent below $7,500 is still 0%");
  eq(findBracket(sched, 750_000).rateMilliPct, 10_000, "exactly $7,500 is the 10% bracket (>= column A)");
  eq(findBracket(sched, 1_989_999).rateMilliPct, 10_000, "one cent below $19,900 is still 10% (< column B)");
  eq(findBracket(sched, 1_990_000).rateMilliPct, 12_000, "exactly $19,900 moves to 12%");
  eq(findBracket(sched, 99_999_999_9).rateMilliPct, 37_000, "an enormous wage lands in the top bracket");

  // --- Worksheet 1A, a full walk-through ----------------------------------
  const plainW4: W4Record = {
    employeeId: "e1",
    formYear: 2026,
    filingStatus: "single_or_married_filing_separately",
    step2MultipleJobs: false,
    step3AnnualCreditCents: 0,
    step4aOtherIncomeAnnualCents: 0,
    step4bDeductionsAnnualCents: 0,
    step4cExtraPerPeriodCents: 0,
    legacyAllowances: null,
    exemptFromFederalIncomeTax: false,
    signedAt: "2026-01-02",
  };
  // $2,000 biweekly = $52,000/yr. Less $8,600 (line 1g) = $43,400 adjusted.
  // $43,400 is in the 12% bracket ($19,900-$57,900): $1,240 + 12% of $23,500
  // = $1,240 + $2,820 = $4,060/yr; / 26 = $156.15 per check.
  const w1 = computeWorksheet1A({ w4: plainW4, payFrequency: "biweekly", wagesThisPeriodCents: 200_000 });
  eq(w1.line1c_annualWagesCents, 5_200_000, "annualized wages are $52,000");
  eq(w1.line1g_cents, LINE_1G_OTHER_CENTS, "line 1g is $8,600 for a single filer with the box unchecked");
  eq(w1.adjustedAnnualWageCents, 4_340_000, "adjusted annual wage is $43,400");
  eq(w1.line2d_rateMilliPct, 12_000, "which lands in the 12% bracket");
  eq(w1.line2g_annualTentativeCents, 406_000, "annual tentative tax is $4,060.00");
  eq(w1.line4b_withholdingCents, 15_615, "so $156.15 comes out of each biweekly check");
  eq(w1.scheduleUsed, "standard_single_mfs", "and the standard single schedule was used");

  // Line 1g really is $12,900 for MFJ.
  const mfj = computeWorksheet1A({
    w4: { ...plainW4, filingStatus: "married_filing_jointly" },
    payFrequency: "biweekly",
    wagesThisPeriodCents: 200_000,
  });
  eq(mfj.line1g_cents, LINE_1G_MFJ_CENTS, "line 1g is $12,900 for married filing jointly");
  eq(mfj.adjustedAnnualWageCents, 3_910_000, "MFJ adjusted annual wage is $39,100");

  // Checking the Step 2 box zeroes line 1g AND switches schedules.
  const step2 = computeWorksheet1A({
    w4: { ...plainW4, step2MultipleJobs: true },
    payFrequency: "biweekly",
    wagesThisPeriodCents: 200_000,
  });
  eq(step2.line1g_cents, 0, "checking the Step 2 box makes line 1g zero");
  eq(step2.adjustedAnnualWageCents, 5_200_000, "so the full $52,000 is adjusted wages");
  eq(step2.scheduleUsed, "step2_single_mfs", "and the step-2 schedule is used");
  ok(
    step2.line4b_withholdingCents > w1.line4b_withholdingCents,
    "checking the box withholds MORE, which is the entire point of the box",
  );

  // --- CLAMP #1 (line 1i) has to be its own clamp -------------------------
  // Deductions bigger than pay. Without the 1i clamp, adjusted wages go
  // negative, findBracket returns the 0% row, line 2e is negative, and the
  // annual tentative tax comes out NEGATIVE - which then absorbs the step 3
  // credit and can produce a positive number out of nowhere.
  const bigDeductions = computeWorksheet1A({
    w4: { ...plainW4, step4bDeductionsAnnualCents: 10_000_000 },
    payFrequency: "biweekly",
    wagesThisPeriodCents: 100_000,
  });
  eq(bigDeductions.adjustedAnnualWageCents, 0, "clamp 1i floors the adjusted annual wage at zero");
  ok(bigDeductions.clamp1iFired, "and reports that it fired");
  eq(bigDeductions.line4b_withholdingCents, 0, "so nothing is withheld rather than a negative amount");
  ok(bigDeductions.notes.length > 0, "and it explains itself in plain English");

  // --- CLAMP #2 (line 3c) is a SEPARATE clamp ------------------------------
  const bigCredit = computeWorksheet1A({
    w4: { ...plainW4, step3AnnualCreditCents: 10_000_000 },
    payFrequency: "biweekly",
    wagesThisPeriodCents: 200_000,
  });
  eq(bigCredit.line2h_tentativePerPeriodCents, 15_615, "the tentative tax is unchanged by credits");
  ok(bigCredit.clamp3cFired, "clamp 3c fires when credits exceed the tax");
  eq(bigCredit.line3c_afterCreditsCents, 0, "and floors withholding at zero");
  eq(bigCredit.line4b_withholdingCents, 0, "payroll never refunds");

  // The two clamps are genuinely independent: extra withholding still applies
  // after clamp 3c, which would be impossible if the clamp were applied last.
  const creditPlusExtra = computeWorksheet1A({
    w4: { ...plainW4, step3AnnualCreditCents: 10_000_000, step4cExtraPerPeriodCents: 5_000 },
    payFrequency: "biweekly",
    wagesThisPeriodCents: 200_000,
  });
  eq(
    creditPlusExtra.line4b_withholdingCents,
    5_000,
    "step 4(c) extra withholding is added AFTER the clamp, so it survives a credit wipeout",
  );

  // --- exempt is income tax ONLY ------------------------------------------
  const exempt = computeWorksheet1A({
    w4: { ...plainW4, exemptFromFederalIncomeTax: true },
    payFrequency: "biweekly",
    wagesThisPeriodCents: 200_000,
  });
  eq(exempt.line4b_withholdingCents, 0, "an exempt employee has no federal income tax withheld");
  eq(exempt.line2h_tentativePerPeriodCents, 15_615, "but we still show what it WOULD have been");
  ok(exempt.exemptFromIncomeTax, "and flag it");
  const exemptFica = computeFicaForPeriod({ ytd: ZERO_YTD, periodWagesCents: 200_000 });
  eq(exemptFica.employeeOasdiCents, 12_400, "and Social Security still comes out - exempt does not touch FICA");
  eq(exemptFica.employeeMedicareCents, 2_900, "and so does Medicare");

  // --- legacy W-4 ----------------------------------------------------------
  const legacy = computeWorksheet1A({
    w4: {
      ...plainW4,
      formYear: 2019,
      legacyAllowances: 2,
      step2MultipleJobs: false,
      step3AnnualCreditCents: 0,
      step4aOtherIncomeAnnualCents: 0,
      step4bDeductionsAnnualCents: 0,
    },
    payFrequency: "biweekly",
    wagesThisPeriodCents: 200_000,
  });
  eq(legacy.line1k_cents, 860_000, "two legacy allowances are worth $8,600");
  eq(legacy.adjustedAnnualWageCents, 4_340_000, "$52,000 less $8,600 = $43,400");
  eq(legacy.line1d_otherIncomeCents, 0, "and the modern Step 4(a) line is not used");
  eq(legacy.line1g_cents, 0, "nor is line 1g");

  // --- the eight wage bases -----------------------------------------------
  eq(WAGE_BASE_SPECS.length, 8, "there are eight distinct wage definitions");
  eq(wageBaseSpec("medicare").ceilingCents, null, "Medicare is uncapped");
  eq(wageBaseSpec("wa_cares").ceilingCents, null, "WA Cares is uncapped");
  eq(wageBaseSpec("oasdi").ceilingCents, 18_450_000, "Social Security stops at $184,500");
  eq(wageBaseSpec("wa_pfml").ceilingCents, 18_450_000, "Paid Leave stops at the same place");
  eq(wageBaseSpec("wa_suta").ceilingCents, 7_820_000, "WA unemployment stops at $78,200");
  eq(wageBaseSpec("futa").ceilingCents, 700_000, "FUTA stops at $7,000");
  ok(
    wageBaseSpec("wa_pfml").ceilingCents !== wageBaseSpec("wa_cares").ceilingCents,
    "THE BIG ONE: Paid Leave and WA Cares do NOT share a ceiling",
  );
  eq(wageBaseSpec("wa_cares").incidence, "employee", "WA Cares comes only from the employee");
  eq(wageBaseSpec("futa").incidence, "employer", "FUTA comes only from the employer");
  throws(() => wageBaseSpec("nope" as WageBaseKey), "unknown wage base", "an unknown base throws");

  // The PFML ceiling must BE the OASDI constant, not a copy of its value.
  ok(
    WA_PFML_WAGE_BASE_2026_CENTS === OASDI_WAGE_BASE_2026_CENTS,
    "the Paid Leave ceiling is derived from the Social Security base, per RCW 50A.10.030(4)",
  );

  // --- ceiling behaviour ---------------------------------------------------
  const under = applyWageCeiling({ ytdWagesCents: 0, periodWagesCents: 100_000, ceilingCents: 700_000 });
  eq(under.taxableThisPeriodCents, 100_000, "wages under the ceiling are fully taxable");
  eq(under.roomRemainingCents, 600_000, "and the remaining room is reported");
  const straddle = applyWageCeiling({ ytdWagesCents: 650_000, periodWagesCents: 100_000, ceilingCents: 700_000 });
  eq(straddle.taxableThisPeriodCents, 50_000, "a check that straddles the ceiling is split exactly");
  ok(straddle.ceilingReached, "and the ceiling is flagged");
  const over = applyWageCeiling({ ytdWagesCents: 700_000, periodWagesCents: 100_000, ceilingCents: 700_000 });
  eq(over.taxableThisPeriodCents, 0, "past the ceiling nothing more is taxable");
  const uncapped = applyWageCeiling({ ytdWagesCents: 99_999_999, periodWagesCents: 100_000, ceilingCents: null });
  eq(uncapped.taxableThisPeriodCents, 100_000, "an uncapped base never stops");
  eq(uncapped.roomRemainingCents, null, "and reports no remaining room");
  ok(!uncapped.ceilingReached, "and never reports a ceiling reached");

  // --- FICA at the ceiling -------------------------------------------------
  const atCeiling = computeFicaForPeriod({
    ytd: { ...ZERO_YTD, oasdiWagesCents: 18_400_000, medicareWagesCents: 18_400_000 },
    periodWagesCents: 100_000,
  });
  eq(atCeiling.oasdiTaxableCents, 50_000, "only $500 of this check is under the Social Security ceiling");
  eq(atCeiling.medicareTaxableCents, 100_000, "but ALL of it is Medicare wages");
  ok(atCeiling.oasdiCeilingReached, "and the ceiling is reported");

  // A full year at the cap must reproduce SSA's published maximum exactly.
  let ytdRun = ZERO_YTD;
  let oasdiTotal = 0;
  for (let i = 0; i < 26; i += 1) {
    const r = computeFicaForPeriod({ ytd: ytdRun, periodWagesCents: 1_000_000 }); // $10,000 biweekly
    oasdiTotal += r.employeeOasdiCents;
    ytdRun = advanceYtd(ytdRun, 1_000_000, 0);
  }
  eq(ytdRun.oasdiWagesCents, 26_000_000, "26 checks of $10,000 is $260,000 of wages");
  eq(
    oasdiTotal,
    OASDI_MAX_EMPLOYEE_TAX_2026_CENTS,
    "and a year of them withholds exactly the $11,439.00 maximum SSA publishes - no more, no less",
  );

  // Additional Medicare starts at $200,000 and has no employer match.
  const addl = computeFicaForPeriod({
    ytd: { ...ZERO_YTD, medicareWagesCents: 19_950_000 },
    periodWagesCents: 100_000,
  });
  eq(addl.additionalMedicareTaxableCents, 50_000, "only the $500 above $200,000 gets the extra 0.9%");
  eq(addl.employeeAdditionalMedicareCents, 450, "which is $4.50");
  eq(addl.employerAdditionalMedicareCents, 0, "and the employer matches NONE of it");
  const belowAddl = computeFicaForPeriod({
    ytd: { ...ZERO_YTD, medicareWagesCents: 10_000_000 },
    periodWagesCents: 100_000,
  });
  eq(belowAddl.additionalMedicareTaxableCents, 0, "below $200,000 there is no additional Medicare at all");

  // --- FUTA ----------------------------------------------------------------
  const futaNormal = computeFutaForPeriod({
    ytd: ZERO_YTD,
    periodWagesCents: 200_000,
    stateUnemploymentRateMilliPct: 2_000,
    stateContributionsPaidTimely: true,
    creditReductionMilliPct: 0,
  });
  eq(futaNormal.futaTaxableCents, 200_000, "the whole check is under the $7,000 FUTA base");
  eq(futaNormal.grossFutaCents, 12_000, "gross FUTA is 6% = $120.00");
  eq(futaNormal.effectiveCreditMilliPct, 2_000, "a 2% state rate credits 2%, not 5.4%");
  eq(futaNormal.netFutaCents, 8_000, "so net FUTA is $80.00, NOT the folklore 0.6%");

  const futaFullCredit = computeFutaForPeriod({
    ytd: ZERO_YTD,
    periodWagesCents: 200_000,
    stateUnemploymentRateMilliPct: 9_000,
    stateContributionsPaidTimely: true,
    creditReductionMilliPct: 0,
  });
  eq(futaFullCredit.effectiveCreditMilliPct, 5_400, "a 9% state rate is capped at the 5.4% credit");
  eq(futaFullCredit.netFutaCents, 1_200, "which finally does produce the familiar 0.6% = $12.00");

  const futaLate = computeFutaForPeriod({
    ytd: ZERO_YTD,
    periodWagesCents: 200_000,
    stateUnemploymentRateMilliPct: 5_400,
    stateContributionsPaidTimely: false,
    creditReductionMilliPct: 0,
  });
  eq(futaLate.effectiveCreditMilliPct, 4_860, "paying the state late cuts the 5.4% credit to 90% of it");
  ok(futaLate.netFutaCents > futaFullCredit.netFutaCents, "so the federal bill goes UP for paying the STATE late");
  ok(futaLate.notes.some((n) => n.includes("billed twice")), "and the system says so in plain English");

  const futaReduction = computeFutaForPeriod({
    ytd: ZERO_YTD,
    periodWagesCents: 200_000,
    stateUnemploymentRateMilliPct: 5_400,
    stateContributionsPaidTimely: true,
    creditReductionMilliPct: 300,
  });
  eq(futaReduction.effectiveCreditMilliPct, 5_100, "a 0.3% credit reduction lowers the credit");
  const futaOverBase = computeFutaForPeriod({
    ytd: { ...ZERO_YTD, futaWagesCents: 700_000 },
    periodWagesCents: 200_000,
    stateUnemploymentRateMilliPct: 5_400,
    stateContributionsPaidTimely: true,
    creditReductionMilliPct: 0,
  });
  eq(futaOverBase.futaTaxableCents, 0, "past $7,000 there is no more FUTA for the year");
  eq(futaOverBase.netFutaCents, 0, "so nothing is owed");

  // --- WA PFML -------------------------------------------------------------
  const pfml = computeWaPfmlForPeriod({
    ytd: ZERO_YTD,
    periodWagesCents: 200_000,
    totalRateMilliPct: WA_PFML_TOTAL_RATE_2026_MILLI_PCT,
    employerSharePctMilliPct: WA_PFML_EMPLOYER_SHARE_MILLI_PCT,
    employerHasFewerThan50WaEmployees: false,
  });
  eq(pfml.totalPremiumCents, 2_260, "1.13% of $2,000 is $22.60");
  eq(pfml.employerShareCents + pfml.employeeShareCents, pfml.totalPremiumCents, "and the two shares reconcile to the penny");
  eq(pfml.employerShareCents, 646, "employer 28.57% = $6.46");
  eq(pfml.employeeShareCents, 1_614, "employee gets the remainder, $16.14");

  const pfmlSmall = computeWaPfmlForPeriod({
    ytd: ZERO_YTD,
    periodWagesCents: 200_000,
    totalRateMilliPct: WA_PFML_TOTAL_RATE_2026_MILLI_PCT,
    employerSharePctMilliPct: WA_PFML_EMPLOYER_SHARE_MILLI_PCT,
    employerHasFewerThan50WaEmployees: true,
  });
  eq(pfmlSmall.employerShareCents, 0, "a small employer owes no employer share");
  eq(pfmlSmall.employeeShareCents, 1_614, "but STILL withholds the employee share");
  ok(pfmlSmall.notes.some((n) => n.includes("not theirs")), "and is told why");
  throws(
    () =>
      computeWaPfmlForPeriod({
        ytd: ZERO_YTD,
        periodWagesCents: 200_000,
        totalRateMilliPct: 1_300,
        employerSharePctMilliPct: WA_PFML_EMPLOYER_SHARE_MILLI_PCT,
        employerHasFewerThan50WaEmployees: false,
      }),
    "1.20% ceiling",
    "a Paid Leave rate above the statutory ceiling is refused",
  );

  // --- WA CARES: THE UNCAPPED ONE -----------------------------------------
  const caresLow = computeWaCaresForPeriod({
    ytd: ZERO_YTD,
    periodWagesCents: 200_000,
    rateMilliPct: WA_CARES_RATE_2026_MILLI_PCT,
    exemptionApprovalDocumentId: null,
    employeeClaimsExemption: false,
  });
  eq(caresLow.employeeCents, 1_160, "0.58% of $2,000 is $11.60");
  eq(caresLow.employerCents, 0, "and the employer pays none of it");

  // THE DEDICATED DIVERGENCE TEST. Same employee, same check, past the SSA base.
  const richYtd: YtdWageAccumulators = {
    ...ZERO_YTD,
    oasdiWagesCents: 20_000_000,
    medicareWagesCents: 20_000_000,
    waPfmlWagesCents: 20_000_000,
    waCaresWagesCents: 20_000_000,
  };
  const pfmlRich = computeWaPfmlForPeriod({
    ytd: richYtd,
    periodWagesCents: 200_000,
    totalRateMilliPct: WA_PFML_TOTAL_RATE_2026_MILLI_PCT,
    employerSharePctMilliPct: WA_PFML_EMPLOYER_SHARE_MILLI_PCT,
    employerHasFewerThan50WaEmployees: false,
  });
  const caresRich = computeWaCaresForPeriod({
    ytd: richYtd,
    periodWagesCents: 200_000,
    rateMilliPct: WA_CARES_RATE_2026_MILLI_PCT,
    exemptionApprovalDocumentId: null,
    employeeClaimsExemption: false,
  });
  eq(pfmlRich.pfmlTaxableCents, 0, "past $184,500 Paid Leave STOPS");
  eq(caresRich.waCaresTaxableCents, 200_000, "but WA Cares KEEPS GOING - same agency, same form, different ceiling");
  eq(caresRich.employeeCents, 1_160, "so the WA Cares deduction is unchanged at $11.60");
  const ficaRich = computeFicaForPeriod({ ytd: richYtd, periodWagesCents: 200_000 });
  eq(ficaRich.oasdiTaxableCents, 0, "and Social Security has stopped too");
  eq(ficaRich.medicareTaxableCents, 200_000, "while Medicare keeps going");

  // WA Cares exemption needs EVIDENCE.
  throws(
    () =>
      computeWaCaresForPeriod({
        ytd: ZERO_YTD,
        periodWagesCents: 200_000,
        rateMilliPct: WA_CARES_RATE_2026_MILLI_PCT,
        exemptionApprovalDocumentId: null,
        employeeClaimsExemption: true,
      }),
    "no ESD approval letter on file",
    "a WA Cares exemption without the approval letter is refused",
  );
  const caresExempt = computeWaCaresForPeriod({
    ytd: ZERO_YTD,
    periodWagesCents: 200_000,
    rateMilliPct: WA_CARES_RATE_2026_MILLI_PCT,
    exemptionApprovalDocumentId: "doc-esd-1",
    employeeClaimsExemption: true,
  });
  eq(caresExempt.employeeCents, 0, "with the letter on file, nothing is withheld");
  ok(caresExempt.exempt, "and the exemption is recorded");
  throws(
    () =>
      computeWaCaresForPeriod({
        ytd: ZERO_YTD,
        periodWagesCents: 200_000,
        rateMilliPct: 600,
        exemptionApprovalDocumentId: null,
        employeeClaimsExemption: false,
      }),
    ".58% ceiling",
    "a WA Cares rate above .58% is refused",
  );

  // --- REFUSALS ------------------------------------------------------------
  const sutaNoRate = computeWaSutaForPeriod({
    ytd: ZERO_YTD,
    periodWagesCents: 200_000,
    combinedRateMilliPct: null,
    rateNoticeDocumentId: null,
  });
  ok(!sutaNoRate.ok, "WA unemployment refuses without an evidenced rate");
  if (!sutaNoRate.ok) {
    eq(sutaNoRate.refusal.code, "wa_suta_rate_not_evidenced", "with the right refusal code");
    ok(sutaNoRate.refusal.message.includes("mail it to you every December"), "and explains where the rate comes from");
    ok(sutaNoRate.refusal.whatToDo.includes("rate notice"), "and says exactly what to upload");
    eq(sutaNoRate.refusal.authorityId, "esd-suta-rate-structure", "and cites its authority");
  }
  const sutaWithRate = computeWaSutaForPeriod({
    ytd: ZERO_YTD,
    periodWagesCents: 200_000,
    combinedRateMilliPct: 1_500,
    rateNoticeDocumentId: "doc-esd-rate-2026",
  });
  ok(sutaWithRate.ok, "with the notice on file it computes");
  if (sutaWithRate.ok) {
    eq(sutaWithRate.value.employerCents, 3_000, "1.5% of $2,000 is $30.00");
    eq(sutaWithRate.value.employeeCents, 0, "and none of it comes out of the employee");
  }

  const lniNoClass = computeLniForPeriod({
    hundredthHours: 8_000,
    employerOnlyRateCentsPerHour: 50,
    medicalAidRateCentsPerHour: 30,
    riskClassCode: null,
    rateNoticeDocumentId: "doc",
  });
  ok(!lniNoClass.ok, "L&I refuses without a risk class");
  if (!lniNoClass.ok) eq(lniNoClass.refusal.code, "lni_class_not_evidenced", "with the class refusal code");

  const lniNoRate = computeLniForPeriod({
    hundredthHours: 8_000,
    employerOnlyRateCentsPerHour: null,
    medicalAidRateCentsPerHour: null,
    riskClassCode: "6420-00",
    rateNoticeDocumentId: null,
  });
  ok(!lniNoRate.ok, "L&I refuses without evidenced rates");
  if (!lniNoRate.ok) {
    eq(lniNoRate.refusal.code, "lni_rate_not_evidenced", "with the rate refusal code");
    ok(lniNoRate.refusal.message.includes("half of the MEDICAL AID piece"), "and warns about the deduction limit up front");
  }

  // --- L&I: THE GROSS-MISDEMEANOR GUARD -----------------------------------
  // 80.00 hours, accident+pension 50c/hr, medical aid 30c/hr.
  // Employer-only = $40.00. Medical aid total = $24.00. Employee = $12.00.
  const lni = computeLniForPeriod({
    hundredthHours: 8_000,
    employerOnlyRateCentsPerHour: 50,
    medicalAidRateCentsPerHour: 30,
    riskClassCode: "6420-00",
    rateNoticeDocumentId: "doc-lni-2026",
  });
  ok(lni.ok, "with evidence, L&I computes");
  if (lni.ok) {
    eq(lni.value.totalPremiumCents, 6_400, "total premium is $64.00 for 80 hours");
    eq(lni.value.employeeCents, 1_200, "the employee pays $12.00 - half the MEDICAL AID only");
    eq(lni.value.employerCents, 5_200, "the employer pays the other $52.00");
    ok(
      lni.value.employeeCents !== divideRoundHalfUp(lni.value.totalPremiumCents, 2),
      "and the employee's share is NOT half the total - deducting that would be a gross misdemeanor",
    );
    eq(lni.value.employeeCents + lni.value.employerCents, lni.value.totalPremiumCents, "the halves still reconcile");
  }
  // An odd medical aid amount must round the employee's penny DOWN, never up.
  const lniOdd = computeLniForPeriod({
    hundredthHours: 100,
    employerOnlyRateCentsPerHour: 0,
    medicalAidRateCentsPerHour: 5,
    riskClassCode: "6420-00",
    rateNoticeDocumentId: "doc",
  });
  ok(lniOdd.ok, "an odd-cent medical aid premium computes");
  if (lniOdd.ok) {
    eq(lniOdd.value.totalPremiumCents, 5, "one hour at 5c/hr is 5 cents");
    eq(lniOdd.value.employeeCents, 2, "the employee's half rounds DOWN to 2 cents");
    eq(lniOdd.value.employerCents, 3, "and the employer absorbs the extra penny, never the worker");
  }

  // --- one full paycheck ---------------------------------------------------
  const check = computePaycheckTaxes({
    w4: plainW4,
    payFrequency: "biweekly",
    grossWagesCents: 200_000,
    ytd: ZERO_YTD,
    hundredthHours: 8_000,
    stateUnemploymentRateMilliPct: 1_500,
    sutaRateNoticeDocumentId: "doc-esd-rate-2026",
    stateContributionsPaidTimely: true,
    creditReductionMilliPct: 0,
    pfmlTotalRateMilliPct: WA_PFML_TOTAL_RATE_2026_MILLI_PCT,
    pfmlEmployerSharePctMilliPct: WA_PFML_EMPLOYER_SHARE_MILLI_PCT,
    employerHasFewerThan50WaEmployees: true,
    waCaresRateMilliPct: WA_CARES_RATE_2026_MILLI_PCT,
    waCaresExemptionApprovalDocumentId: null,
    employeeClaimsWaCaresExemption: false,
    lniEmployerOnlyRateCentsPerHour: 50,
    lniMedicalAidRateCentsPerHour: 30,
    lniRiskClassCode: "6420-00",
    lniRateNoticeDocumentId: "doc-lni-2026",
  });
  ok(!check.hasRefusals, "a fully evidenced payroll produces no refusals");
  // 15615 fed + 12400 SS + 2900 Med + 1614 PFML + 1160 Cares + 1200 L&I = 34889
  eq(check.totalEmployeeWithheldCents, 34_889, "total withheld from a $2,000 check is $348.89");
  eq(check.netPayCents, 200_000 - 34_889, "net pay is gross less withholding");
  eq(check.netPayCents, 165_111, "which is $1,651.11");
  ok(check.totalEmployerTaxCents > 0, "and the employer owes their own taxes on top");
  ok(
    check.netPayCents + check.totalEmployeeWithheldCents === check.grossWagesCents,
    "the check reconciles exactly - no lost pennies",
  );

  // A paycheck missing evidence still cuts an exact NET check.
  const checkNoEvidence = computePaycheckTaxes({
    w4: plainW4,
    payFrequency: "biweekly",
    grossWagesCents: 200_000,
    ytd: ZERO_YTD,
    hundredthHours: 8_000,
    stateUnemploymentRateMilliPct: null,
    sutaRateNoticeDocumentId: null,
    stateContributionsPaidTimely: true,
    creditReductionMilliPct: 0,
    pfmlTotalRateMilliPct: WA_PFML_TOTAL_RATE_2026_MILLI_PCT,
    pfmlEmployerSharePctMilliPct: WA_PFML_EMPLOYER_SHARE_MILLI_PCT,
    employerHasFewerThan50WaEmployees: true,
    waCaresRateMilliPct: WA_CARES_RATE_2026_MILLI_PCT,
    waCaresExemptionApprovalDocumentId: null,
    employeeClaimsWaCaresExemption: false,
    lniEmployerOnlyRateCentsPerHour: null,
    lniMedicalAidRateCentsPerHour: null,
    lniRiskClassCode: null,
    lniRateNoticeDocumentId: null,
  });
  ok(checkNoEvidence.hasRefusals, "missing evidence produces refusals");
  eq(checkNoEvidence.refusals.length, 2, "one for WA unemployment and one for L&I");
  eq(checkNoEvidence.futa.effectiveCreditMilliPct, 0, "with no state rate we credit NOTHING against FUTA");
  eq(checkNoEvidence.futa.netFutaCents, 12_000, "so the full 6% is accrued - the cautious direction");
  ok(
    checkNoEvidence.notes.some((n) => n.includes("Do not send this figure to the IRS as-is")),
    "and Michael is told the FUTA figure is provisional",
  );

  // --- no floats anywhere --------------------------------------------------
  const allNumbers = [
    check.totalEmployeeWithheldCents,
    check.totalEmployerTaxCents,
    check.netPayCents,
    check.fica.employeeOasdiCents,
    check.pfml.employeeShareCents,
    check.waCares.employeeCents,
    w1.line4b_withholdingCents,
  ];
  for (const n of allNumbers) ok(Number.isInteger(n), `${n} is an integer number of cents`);

  // --- input guards --------------------------------------------------------
  throws(
    () => computeWorksheet1A({ w4: plainW4, payFrequency: "biweekly", wagesThisPeriodCents: -1 }),
    "cannot be negative",
    "negative wages are refused rather than producing negative tax",
  );
  throws(
    () => computeWorksheet1A({ w4: plainW4, payFrequency: "biweekly", wagesThisPeriodCents: 100.5 }),
    "integer cents",
    "fractional cents are refused",
  );
  throws(() => applyMilliPct(1.5, 100), "integers", "applyMilliPct rejects floats");
  throws(() => applyMilliPct(Number.MAX_SAFE_INTEGER, 100_000), "overflow", "applyMilliPct refuses to lose precision");

  if (failures.length > 0) {
    throw new Error(
      `payroll-withholding-core self-tests: ${failures.length} failure(s)\n  - ${failures.join("\n  - ")}`,
    );
  }
  return { passed, failed: 0 };
}
