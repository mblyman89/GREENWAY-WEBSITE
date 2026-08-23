/**
 * src/lib/payroll/form-940-core.ts   (books-43)
 *
 * THE ANNUAL FEDERAL UNEMPLOYMENT RETURN. Pure arithmetic, no I/O, no dates
 * from the clock, no assumptions about facts nobody supplied.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ONE THING TO UNDERSTAND ABOUT THIS FORM
 * ────────────────────────────────────────────────────────────────────────────
 * FUTA is not a 0.6% tax. It is a 6% tax with a discount you have to keep
 * earning, and the discount is worth NINE TIMES the tax you actually pay.
 *
 * Run Greenway's numbers. Ten employees who each clear the $7,000 FUTA wage
 * base is $70,000 of taxable wages.
 *
 *   6.0%  of $70,000  = $4,200.00   <- the statutory tax (IRC 3301)
 *   5.4%  of $70,000  = $3,780.00   <- the maximum credit (IRC 3302(b))
 *   0.6%  of $70,000  =   $420.00   <- what you actually pay, if all is well
 *
 * Everything on this form between line 8 and line 12 exists to decide how much
 * of that $3,780.00 credit you really earned. Nothing else on the form is
 * interesting; the wage arithmetic is trivial. The credit is the whole game.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS ENGINE REFUSES INSTEAD OF ASSUMING
 * ────────────────────────────────────────────────────────────────────────────
 * A program that defaults `statePaidOnTimeCents` to zero would report the
 * WORST case. A program that defaults it to "all of it" would report the BEST
 * case. Both are lies of the same size and the second one is more dangerous,
 * because it agrees with what the owner expects and so is never questioned.
 *
 * So every fact this engine cannot derive, it demands. `null` is not zero. A
 * missing answer produces a refusal that names the one question that would
 * clear it (standing rule 43), and every refusal code is reachable.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE DEADLINE TRAP, STATED ONCE SO IT IS NEVER MISREAD
 * ────────────────────────────────────────────────────────────────────────────
 * "On time" on this form does NOT mean "by Washington's quarterly deadline".
 * The instructions define it explicitly: "'On time' means that you paid the
 * state unemployment taxes by the due date for filing Form 940."
 *
 * That is the following 31 January. So an ESD payment that was two months late
 * to Washington — and which therefore attracts Washington's own penalty and
 * interest under RCW 50.12.220 and RCW 50.24.040 — is still ON TIME for the
 * federal credit, provided it cleared before the 940 was due.
 *
 * This engine takes the two amounts as separate inputs measured against the
 * FEDERAL deadline, and refuses to infer either from state filing dates. See
 * `I940_ON_TIME_AND_LATE_DEFINED`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND THE SECOND TRAP: WHAT COUNTS AS "STATE UNEMPLOYMENT TAX"
 * ────────────────────────────────────────────────────────────────────────────
 * Michael writes ESD a single cheque each quarter. That cheque contains at
 * least four different things:
 *
 *   - the employer's unemployment contribution      <- ONLY THIS counts
 *   - the Employment Administration Fund surcharges <- does not count
 *   - PFML premium, most of which is the EMPLOYEE's <- does not count
 *   - WA Cares, which is entirely the employee's    <- does not count
 *   - any penalty or interest for being late        <- does not count
 *
 * The instructions say so directly: "Don't include any penalties, interest, or
 * unemployment taxes deducted from your employees' pay in the amount of state
 * unemployment taxes." Putting the whole ESD cheque on worksheet line 2 would
 * overstate the credit and understate the federal tax — an error in the
 * taxpayer's favour, which is the kind the IRS finds.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND THE THIRD TRAP, WHICH COST THE FIRST DRAFT OF THIS FILE ITS LIFE:
 * LINES 9 AND 10 COUNT WAGES, NOT PEOPLE
 * ────────────────────────────────────────────────────────────────────────────
 * The headings are "If ALL of the Taxable FUTA WAGES You Paid Were Excluded"
 * and "If SOME of the Taxable FUTA WAGES You Paid Were Excluded". The first
 * draft of this file tested `employees.every(...)` and `employees.some(...)`,
 * which counts HEADS.
 *
 * Those differ. An excluded corporate officer who was paid nothing in the year
 * contributes zero taxable FUTA wages, so under the form's own words nothing
 * was excluded and line 10 does not apply — but a head count sees one excluded
 * person out of several and drags the return onto the worksheet. Everything
 * below is wage-weighted for that reason.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DOES NOT DO (standing rule 25)
 * ────────────────────────────────────────────────────────────────────────────
 * It does not restate the FUTA rate, the wage base, the maximum credit, the
 * 90% late factor or the $1,500 employer test. All five already live in
 * `payroll-withholding-core.ts` and are IMPORTED. It does not re-implement
 * rate application: `applyMilliPct` is imported too. The first draft declared
 * its own `applyRate`, which would have been the THIRD copy of that function
 * in this directory; see the note on `form-941-core.ts` below.
 *
 * A NOTE ON A DIFFERENCE FROM THE PER-PERIOD ENGINE, WHICH IS NOT A BUG IN
 * EITHER. `payroll-withholding-core.futaForPeriod()` applies the 90% late
 * factor to the RATE, because at cheque time nobody knows which dollars will
 * be paid late — it is an accrual estimate. The ANNUAL form does not estimate:
 * Worksheet-Line 10 applies the 90% factor to the LATE AMOUNT ITSELF, and caps
 * it at the credit still remaining (line 5c takes the smaller of 5a and 5b).
 * Those produce different numbers on purpose. The per-period figure is a
 * provision; this one is the return.
 */

import {
  FUTA_EMPLOYER_TEST_QUARTERLY_WAGES_CENTS,
  FUTA_GROSS_RATE_MILLI_PCT,
  FUTA_LATE_PAYMENT_CREDIT_MILLI_PCT,
  FUTA_MAX_CREDIT_MILLI_PCT,
  FUTA_WAGE_BASE_CENTS,
  applyMilliPct,
} from "@/lib/payroll/payroll-withholding-core";

/* ════════════════════════════════════════════════════════════════════════════
 * §1  UNITS AND DERIVED RATES
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Money is integer cents. Rates are MILLI-PERCENT: 5.4% is 5,400. The one
 * exception arriving from outside is Washington's experience rate, which ESD
 * publishes and everybody quotes in BASIS POINTS (4.1% = 410), so that is the
 * unit this engine accepts for it — and converts, once, in one place.
 */

/**
 * The FUTA tax rate net of the maximum credit: 6.0% − 5.4% = 0.6%.
 *
 * DERIVED, NEVER TYPED. Form 940 line 8 multiplies by 0.006, and it would be
 * trivial to write `600` here. Deriving it means that if either constant is
 * ever corrected, this follows automatically instead of silently disagreeing
 * with the two numbers it is supposed to sit between.
 */
export const FUTA_NET_RATE_MILLI_PCT =
  FUTA_GROSS_RATE_MILLI_PCT - FUTA_MAX_CREDIT_MILLI_PCT;

/**
 * Basis points to milli-percent. 1 bp = 0.01% = 10 milli-percent.
 *
 * Named rather than written as a bare `* 10` at the call site, because mixing
 * these two units is exactly how a rate lands off by a factor of ten and still
 * looks entirely plausible on screen.
 */
export const MILLI_PCT_PER_BASIS_POINT = 10;

/** The deposit threshold: $500.00. Instructions, "When Must You Deposit". */
export const FUTA_DEPOSIT_THRESHOLD_CENTS = 50_000;

/** Line 14: "Less than $1, you don't have to pay it." */
export const FUTA_DE_MINIMIS_BALANCE_CENTS = 100;

/**
 * The highest combined state unemployment rate this engine will accept as a
 * typing error rather than a fact, in basis points. 15% — comfortably above
 * every state's statutory maximum, so a real rate is never rejected, while
 * "5.4" typed where "540" was meant sails past and "54000" does not.
 */
export const EXPERIENCE_RATE_MAX_PLAUSIBLE_BPS = 1_500;

/* ════════════════════════════════════════════════════════════════════════════
 * §2  WHAT THE ENGINE MUST BE TOLD
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * One employee's year, as Form 940 lines 3–5 need it.
 *
 * `totalPaymentsCents` is EVERYTHING paid to the person (line 3), not the
 * taxable amount. The form deliberately starts from the gross and subtracts,
 * which is why line 5 asks for the EXCESS over $7,000 rather than the taxable
 * wages themselves. Deriving the excess here rather than accepting it as an
 * input is the correct direction: it is arithmetic, not a fact.
 *
 * `exemptPaymentsCents` is line 4 — the fringe benefits, retirement
 * contributions and similar payments FUTA does not reach.
 *
 * `excludedFromStateUnemploymentTax` is the fact that decides between line 9
 * and line 10, and it is NOT the same as "we paid no state tax on them". A
 * corporate officer whose wages Washington excludes belongs here. Somebody
 * whose wages were covered but whose employer was assigned a 0% rate does NOT
 * — the instructions carry an explicit Caution about exactly that confusion.
 */
export type Form940Employee = {
  readonly employeeId: string;
  readonly name: string;
  /** Line 3. Everything paid, before any exclusion. */
  readonly totalPaymentsCents: number;
  /** Line 4. Payments exempt from FUTA (fringe benefits, retirement, etc.). */
  readonly exemptPaymentsCents: number;
  /**
   * Were this person's wages excluded from STATE unemployment tax?
   *
   * `null` means nobody has recorded it. That is a refusal, not a `false` —
   * because guessing `false` silently claims a credit that may not exist.
   */
  readonly excludedFromStateUnemploymentTax: boolean | null;
};

/**
 * What Michael actually paid Washington, measured against the FEDERAL deadline.
 *
 * BOTH PAYMENT FIELDS ARE THE EMPLOYER'S UNEMPLOYMENT CONTRIBUTION ONLY. No
 * PFML, no WA Cares, no EAF surcharge, no penalty, no interest. See the header.
 */
export type StateUnemploymentPayments = {
  /**
   * Paid on or before the Form 940 due date. Worksheet line 2.
   * `null` refuses; it does not default to zero.
   */
  readonly paidOnTimeCents: number | null;
  /**
   * Paid AFTER the Form 940 due date. Worksheet line 5b. Earns 90 cents on
   * the dollar of credit.
   */
  readonly paidLateCents: number | null;
  /**
   * Still not paid at all when the return is filed. Earns NOTHING — it is not
   * on the worksheet anywhere, which is the point: unpaid state tax is a
   * total loss of that slice of credit, whereas late tax loses only 10%.
   *
   * Carried as an input purely so the engine can TEACH that difference; it
   * never enters the arithmetic.
   */
  readonly notPaidCents: number | null;
  /**
   * Taxable state unemployment wages. Worksheet line 3 multiplies THESE, not
   * the federal figure, and the two really do differ: the federal base is
   * $7,000 and Washington's is many times that.
   */
  readonly taxableStateWagesCents: number | null;
  /**
   * The experience rate Washington assigned, in BASIS POINTS. 4.1% = 410.
   *
   * Worksheet line 3 turns a rate BELOW 5.4% into extra credit, so a good
   * experience rating is worth money federally as well as to the state.
   */
  readonly experienceRateBps: number | null;
};

/**
 * Quarterly FUTA liability, for Part 5 and the deposit schedule.
 *
 * These are the amounts of tax INCURRED in each quarter, not deposited. Most
 * of Greenway's annual FUTA lands in Q1, because the $7,000 base is exhausted
 * early in the year for anyone working full time.
 */
export type Form940Quarterly = {
  readonly q1Cents: number;
  readonly q2Cents: number;
  readonly q3Cents: number;
  readonly q4Cents: number;
};

/**
 * The facts that decide whether a Form 940 is required AT ALL.
 *
 * THESE ARE INPUTS, AND THE FIRST DRAFT OF THIS FILE GOT IT WRONG BY TRYING TO
 * DERIVE THEM. It recovered a wage figure by dividing the quarterly FUTA tax
 * by 0.6%. That is wrong twice over, and both errors point the same way:
 *
 *   1. The quarterly tax is only computed at 0.6% when the full state credit
 *      survives. The moment line 9 or line 10 bites, the effective rate moves
 *      toward 6.0% and the reversal understates wages by up to a factor of ten.
 *   2. The statutory test in IRC 3306(a)(1)(A) is on WAGES PAID, which has no
 *      ceiling. FUTA tax is computed on wages CAPPED at $7,000 per person.
 *      They are different quantities and NO rate converts between them. An
 *      employer who paid one person $60,000 in Q1 pays FUTA on $7,000 of it.
 *
 * So the engine asks. `null` refuses.
 *
 * The lookback is two years — "during 2024 or 2025" for a 2025 return — which
 * is why the prior year appears here at all. The obligation is sticky: cross
 * the threshold once and the following year is captured too, even if quiet.
 */
export type Form940FilingTest = {
  /** Largest single calendar quarter of WAGES PAID in the return year. */
  readonly maxQuarterWagesThisYearCents: number | null;
  /** Same figure for the year before. Part of the two-year lookback. */
  readonly maxQuarterWagesPriorYearCents: number | null;
  /** Different weeks with at least one employee for any part of a day. */
  readonly weeksWithAnyEmployeeThisYear: number | null;
  readonly weeksWithAnyEmployeePriorYear: number | null;
};

/** "any 20 or more different weeks" — the second half of Who Must File. */
export const FUTA_EMPLOYER_TEST_WEEKS = 20;

export type Form940Request = {
  /** The calendar year the return covers. */
  readonly year: number;
  readonly employees: readonly Form940Employee[];
  readonly statePayments: StateUnemploymentPayments;
  readonly filingTest: Form940FilingTest;
  /**
   * The DOL credit reduction rate for the state, in milli-percent.
   *
   * `null` refuses rather than defaulting to zero. Washington is not a credit
   * reduction state today, and "not this year" is a fact with an expiry date;
   * a hard-coded zero would silently understate the tax the year it changes.
   */
  readonly creditReductionMilliPct: number | null;
  /**
   * FUTA already deposited during the year. Line 13. `null` refuses, because
   * assuming zero turns a fully-deposited year into a fabricated balance due.
   */
  readonly depositedCents: number | null;
  /** Quarterly incurred liability for Part 5. `null` refuses. */
  readonly quarterly: Form940Quarterly | null;
  /**
   * Box c. A year in which no payments at all were made to employees.
   *
   * The instructions send that year straight from the box to the signature:
   * "check box c in the top right corner of the form. Then, go to Part 7, sign
   * the form, and file it with the IRS." Parts 2 through 6 are skipped, so
   * this engine skips the refusals that guard them.
   */
  readonly noPaymentsThisYear?: boolean;
};

/* ════════════════════════════════════════════════════════════════════════════
 * §3  REFUSALS — every code reachable (standing rule 43)
 * ════════════════════════════════════════════════════════════════════════════ */

export type Form940RefusalCode =
  /** No employees, and the caller did not declare a dormant year. */
  | "NO_EMPLOYEES"
  /** A year was declared dormant, yet employees with pay were supplied. */
  | "DORMANT_CONTRADICTED"
  /** A money figure is negative. No year produces that honestly. */
  | "NEGATIVE_AMOUNT"
  /** Exempt payments exceed total payments for somebody. Impossible. */
  | "EXEMPT_EXCEEDS_TOTAL"
  /** Somebody's state-exclusion status was never recorded. */
  | "STATE_EXCLUSION_UNKNOWN"
  /** The on-time / late / unpaid split was not supplied. */
  | "STATE_PAYMENTS_UNKNOWN"
  /** The assigned experience rate was not supplied. */
  | "EXPERIENCE_RATE_UNKNOWN"
  /** An experience rate outside anything a state can assign. */
  | "EXPERIENCE_RATE_IMPLAUSIBLE"
  /** Nobody said whether the state is on the DOL credit reduction list. */
  | "CREDIT_REDUCTION_UNKNOWN"
  /** Deposits were not supplied, so lines 13-15 cannot be stated. */
  | "DEPOSITS_UNKNOWN"
  /** Part 5 quarterly liabilities were not supplied. */
  | "QUARTERLY_UNKNOWN"
  /** The quarterly figures do not add up to the annual tax. */
  | "QUARTERLY_MISMATCH"
  /** The Who Must File facts were not supplied and cannot be derived. */
  | "FILING_TEST_UNKNOWN"
  /** The year is not a plausible filing year. */
  | "YEAR_NOT_VALID";

export const ALL_FORM_940_REFUSAL_CODES: readonly Form940RefusalCode[] = [
  "NO_EMPLOYEES",
  "DORMANT_CONTRADICTED",
  "NEGATIVE_AMOUNT",
  "EXEMPT_EXCEEDS_TOTAL",
  "STATE_EXCLUSION_UNKNOWN",
  "STATE_PAYMENTS_UNKNOWN",
  "EXPERIENCE_RATE_UNKNOWN",
  "EXPERIENCE_RATE_IMPLAUSIBLE",
  "CREDIT_REDUCTION_UNKNOWN",
  "DEPOSITS_UNKNOWN",
  "QUARTERLY_UNKNOWN",
  "QUARTERLY_MISMATCH",
  "FILING_TEST_UNKNOWN",
  "YEAR_NOT_VALID",
] as const;

export type Form940Refusal = {
  readonly code: Form940RefusalCode;
  /** What is wrong, in a whole sentence, safe to render on its own. */
  readonly what: string;
  /** The ONE question that would clear it. */
  readonly fix: string;
  /** Who it attaches to, when it attaches to somebody. */
  readonly employeeId: string | null;
};

/* ════════════════════════════════════════════════════════════════════════════
 * §4  THE WORKSHEET — the arithmetic that decides the whole return
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Worksheet-Line 10, reproduced line for line.
 *
 * `stoppedAtLine` records WHERE the worksheet ended, because two of its steps
 * are early exits and "the worksheet said stop" is a materially different
 * statement from "the worksheet ran to the end and produced zero". A reader
 * who cannot tell those apart cannot check the work.
 *
 * The IRS lists exactly two STOP points — after line 2 and after line 4 — plus
 * a third condition after line 6 ("If line 6 is equal to or more than line 1,
 * STOP here"). Line 7 is reached only when line 6 falls short of line 1.
 */
export type Form940Worksheet = {
  /** Line 1: taxable FUTA wages x 5.4%. The credit you COULD have had. */
  readonly line1MaximumCreditCents: number;
  /** Line 2: state tax paid on time. Credit earned outright. */
  readonly line2TimelyCreditCents: number;
  /** Line 3: top-up when the assigned experience rate is below 5.4%. */
  readonly line3AdditionalCreditCents: number;
  /** Line 4: line 2 + line 3. */
  readonly line4SubtotalCents: number;
  /** Line 5a: credit still unclaimed (line 1 − line 4). */
  readonly line5aRemainingCreditCents: number;
  /** Line 5b: state tax paid late. */
  readonly line5bPaidLateCents: number;
  /** Line 5c: the SMALLER of 5a and 5b. */
  readonly line5cSmallerCents: number;
  /** Line 5d: line 5c x 0.900 — the 10% haircut for paying late. */
  readonly line5dLateCreditCents: number;
  /** Line 6: line 4 + line 5d. The credit actually earned. */
  readonly line6FutaCreditCents: number;
  /** Line 7: line 1 − line 6. The credit LOST, which raises the tax. */
  readonly line7AdjustmentCents: number;
  /** 2, 4 or 6 for a STOP; 7 when the worksheet ran to the end. */
  readonly stoppedAtLine: 2 | 4 | 6 | 7;
  /** True when Form 940 line 10 is left blank. */
  readonly line10IsBlank: boolean;
};

/**
 * Run Worksheet-Line 10.
 *
 * Exported separately from `buildForm940` because it is the single most
 * error-prone calculation on the return, it is worth testing in isolation
 * against the IRS's own worked example, and the screen shows it as its own
 * panel. Pure: same inputs, same output, every time.
 *
 * A note on the lines left at zero after an early STOP. The IRS worksheet
 * leaves them physically BLANK, and a blank is not a zero — it is "this
 * question was never reached". `stoppedAtLine` is what carries that
 * distinction, and any renderer must consult it before printing a 0.00 that
 * the IRS never asked for.
 */
export function form940Worksheet(args: {
  readonly taxableFutaWagesCents: number;
  readonly taxableStateWagesCents: number;
  readonly experienceRateBps: number;
  readonly paidOnTimeCents: number;
  readonly paidLateCents: number;
}): Form940Worksheet {
  // Line 1: "$21,000.00 (Form 940, line 7) x 0.054 (maximum credit rate)".
  const line1 = applyMilliPct(args.taxableFutaWagesCents, FUTA_MAX_CREDIT_MILLI_PCT);

  // Line 2: "Credit for timely state unemployment tax payments".
  const line2 = args.paidOnTimeCents;

  const stopAt = (
    stoppedAtLine: 2 | 4 | 6,
    partial: Partial<Form940Worksheet>,
  ): Form940Worksheet => ({
    line1MaximumCreditCents: line1,
    line2TimelyCreditCents: line2,
    line3AdditionalCreditCents: 0,
    line4SubtotalCents: 0,
    line5aRemainingCreditCents: 0,
    line5bPaidLateCents: 0,
    line5cSmallerCents: 0,
    line5dLateCreditCents: 0,
    line6FutaCreditCents: 0,
    line7AdjustmentCents: 0,
    stoppedAtLine,
    line10IsBlank: true,
    ...partial,
  });

  // "If line 2 is equal to or more than line 1, STOP here. ... Leave Form 940,
  // line 10, blank."
  //
  // WHY THE FORM CAN STOP HERE AT ALL. Washington's taxable wage base is many
  // times the federal $7,000, so the state tax Michael pays on one employee
  // routinely exceeds 5.4% of that employee's federal base. For a normal
  // Greenway year this is the branch that fires, the worksheet ends on its
  // second line, and line 10 stays empty.
  if (line2 >= line1) return stopAt(2, {});

  // Line 3, "Additional credit". A state rate BELOW 5.4% does not shrink the
  // credit — the IRS hands back the difference, so being a stable employer
  // with a low experience rating is rewarded federally as well as locally.
  //
  // The IRS's own worked arithmetic:
  //     0.054 (maximum credit rate)
  //   − 0.041 (your experience rate)
  //   = 0.013 (your computation rate)   x  $8,000  =  $104.00
  //
  // Converted to one unit FIRST, then applied once, so basis points and
  // milli-percent never meet inside the same expression.
  const experienceRateMilliPct = args.experienceRateBps * MILLI_PCT_PER_BASIS_POINT;
  const computationRateMilliPct = Math.max(
    0,
    FUTA_MAX_CREDIT_MILLI_PCT - experienceRateMilliPct,
  );
  const line3 = applyMilliPct(args.taxableStateWagesCents, computationRateMilliPct);

  // Line 4: "Subtotal (line 2 + line 3 = line 4)".
  const line4 = line2 + line3;

  // "If line 4 is equal to or more than line 1, STOP here. ... Leave Form 940,
  // line 10, blank."
  if (line4 >= line1) {
    return stopAt(4, {
      line3AdditionalCreditCents: line3,
      line4SubtotalCents: line4,
    });
  }

  // Line 5a: "What is your remaining allowable credit? (line 1 – line 4)".
  const line5a = line1 - line4;
  // Line 5b: "How much state unemployment tax did you pay late?"
  const line5b = args.paidLateCents;
  // Line 5c: "Which is smaller, line 5a or line 5b?"
  //
  // THIS CAP IS THE POINT OF THE WHOLE STEP. Paying late does not buy credit
  // you had not already lost; it can only recover credit that is still on the
  // table. Without the cap an employer could pay late and end up with MORE
  // credit than the 5.4% maximum, which is obviously not the design.
  const line5c = Math.min(line5a, line5b);
  // Line 5d: "(line 5c x 0.900 = line 5d)". The constant is 90_000
  // milli-percent, i.e. 90%, already declared in payroll-withholding-core.
  const line5d = applyMilliPct(line5c, FUTA_LATE_PAYMENT_CREDIT_MILLI_PCT);
  // Line 6: "Your FUTA credit (line 4 + line 5d = line 6)".
  const line6 = line4 + line5d;

  // "If line 6 is equal to or more than line 1, STOP here. ... Leave Form 940,
  // line 10, blank."
  if (line6 >= line1) {
    return stopAt(6, {
      line3AdditionalCreditCents: line3,
      line4SubtotalCents: line4,
      line5aRemainingCreditCents: line5a,
      line5bPaidLateCents: line5b,
      line5cSmallerCents: line5c,
      line5dLateCreditCents: line5d,
      line6FutaCreditCents: line6,
    });
  }

  // Line 7: "Your adjustment (line 1 – line 6)". This is the money lost.
  return {
    line1MaximumCreditCents: line1,
    line2TimelyCreditCents: line2,
    line3AdditionalCreditCents: line3,
    line4SubtotalCents: line4,
    line5aRemainingCreditCents: line5a,
    line5bPaidLateCents: line5b,
    line5cSmallerCents: line5c,
    line5dLateCreditCents: line5d,
    line6FutaCreditCents: line6,
    line7AdjustmentCents: line1 - line6,
    stoppedAtLine: 7,
    line10IsBlank: false,
  };
}

/* ════════════════════════════════════════════════════════════════════════════
 * §5  THE DEPOSIT SCHEDULE — a CARRY-FORWARD, not a per-quarter threshold
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * One quarter's row in the deposit schedule.
 *
 * `carriedInCents` is what rolled in from earlier quarters. That is the field
 * a naive implementation does not have, and its absence is the defect: testing
 * each quarter against $500 in isolation reports "no deposit due" four times
 * for an employer who genuinely owed a deposit in Q3.
 *
 * Concretely — four quarters of $200. Per-quarter thinking says nothing is
 * ever due. The carry-forward says the cumulative total passes $500 during Q3,
 * so a deposit of $600 was due by 31 October. Getting that wrong is a failure
 * to deposit, and the penalty runs from the date the deposit was due.
 */
export type Form940DepositQuarter = {
  readonly quarter: 1 | 2 | 3 | 4;
  readonly incurredCents: number;
  readonly carriedInCents: number;
  readonly cumulativeCents: number;
  readonly depositRequired: boolean;
  readonly depositAmountCents: number;
  readonly carriedOutCents: number;
  /**
   * Q4 ONLY, and only when the remainder is $500 or less: the instructions
   * allow that amount to travel with the return instead of being deposited.
   * "If it is $500 or less, you can either deposit the amount or pay it with
   * your Form 940." False in Q1 to Q3, where there is no such choice.
   */
  readonly mayPayWithReturn: boolean;
};

export type Form940DepositSchedule = {
  readonly quarters: readonly Form940DepositQuarter[];
  /** Left over at year end; payable with the return if $500 or less. */
  readonly payableWithReturnCents: number;
  readonly anyDepositRequired: boolean;
};

/**
 * Walk the four quarters applying the carry-forward.
 *
 * "If your FUTA tax is $500 or less in a quarter, carry it over to the next
 * quarter. Continue carrying your tax liability over until your cumulative tax
 * is more than $500. At that point, you must deposit your tax for the quarter."
 *
 * The fourth quarter is different: "If your FUTA tax for the fourth quarter
 * (plus any undeposited amounts from earlier quarters) is more than $500,
 * deposit the entire amount ... If it is $500 or less, you can either deposit
 * the amount or pay it with your Form 940." One payment a year rather than
 * four is the ordinary path for an employer of Greenway's size.
 */
export function form940DepositSchedule(q: Form940Quarterly): Form940DepositSchedule {
  const incurred = [q.q1Cents, q.q2Cents, q.q3Cents, q.q4Cents];
  const quarters: Form940DepositQuarter[] = [];
  let carried = 0;

  for (let i = 0; i < 4; i++) {
    const carriedIn = carried;
    const cumulative = carriedIn + incurred[i];
    const isFourth = i === 3;

    // The threshold is MORE THAN $500, not $500 or more. Exactly $500.00
    // carries forward; $500.01 does not. Written as a strict comparison
    // because "at least" and "more than" differ by one cent, and the
    // instructions say "more than $500".
    const depositRequired = cumulative > FUTA_DEPOSIT_THRESHOLD_CENTS;

    // A required deposit clears the running balance; anything else rolls on.
    // In Q4 "rolls on" means "goes out with the return", which is why
    // `payableWithReturnCents` below is simply whatever is left after Q4.
    const carriedOut = depositRequired ? 0 : cumulative;

    quarters.push({
      quarter: (i + 1) as 1 | 2 | 3 | 4,
      incurredCents: incurred[i],
      carriedInCents: carriedIn,
      cumulativeCents: cumulative,
      depositRequired,
      depositAmountCents: depositRequired ? cumulative : 0,
      carriedOutCents: carriedOut,
      mayPayWithReturn: isFourth && !depositRequired && cumulative > 0,
    });

    carried = carriedOut;
  }

  return {
    quarters,
    payableWithReturnCents: carried,
    anyDepositRequired: quarters.some((x) => x.depositRequired),
  };
}

/* ════════════════════════════════════════════════════════════════════════════
 * §6  THE RETURN
 * ════════════════════════════════════════════════════════════════════════════ */

export type Form940Line = {
  /** "3", "5", "9", "10", "12", "15a" — as printed on the form. */
  readonly line: string;
  readonly label: string;
  readonly amountCents: number;
  /**
   * True when the form says to leave the box EMPTY. "If any line in Part 3
   * doesn't apply, leave it blank" and the same instruction opens Part 4.
   * A blank box and a box containing 0.00 are different statements, and this
   * flag is the only thing that keeps them apart downstream.
   */
  readonly blank: boolean;
};

export type Form940Return = {
  readonly year: number;
  readonly lines: readonly Form940Line[];
  /** Null when the worksheet was not required at all. */
  readonly worksheet: Form940Worksheet | null;
  readonly deposits: Form940DepositSchedule;
  /** Line 12 restated for convenience. */
  readonly totalTaxCents: number;
  /** Line 14, zero when there is an overpayment. */
  readonly balanceDueCents: number;
  /** Line 15a, zero when there is a balance due. */
  readonly overpaymentCents: number;
  /** True when box c applies: no payments to employees at all this year. */
  readonly isZeroReturn: boolean;
  /**
   * IRC 3306(a)(1)(A): $1,500 of wages in any calendar quarter, this year or
   * last. Stated even when true, because a reader should be able to see WHY a
   * return is required rather than simply be told that it is.
   */
  readonly meetsQuarterlyWageTest: boolean;
  /** The other half of Who Must File: 20 different weeks, this year or last. */
  readonly meetsTwentyWeekTest: boolean;
  /** "if you answer 'Yes' to EITHER one of these questions, you must file". */
  readonly mustFile: boolean;
  /** Plain-English observations. Never a substitute for a refusal. */
  readonly notes: readonly string[];
};

export type Form940Result =
  | { readonly ok: true; readonly ret: Form940Return }
  | { readonly ok: false; readonly refusals: readonly Form940Refusal[] };

/** Find a line by its printed number. */
export function lineOf(ret: Form940Return, line: string): Form940Line | undefined {
  return ret.lines.find((l) => l.line === line);
}

/**
 * One employee's TAXABLE FUTA wages: pay, less exempt pay, capped at $7,000.
 *
 * Exported because the wage-weighted line 9 / line 10 decision depends on it
 * and that decision is worth testing directly. Note the identity it satisfies:
 * summing this over everybody equals line 3 − line 4 − line 5, which is line 7.
 * `buildForm940` asserts exactly that, so the two routes to line 7 can never
 * quietly disagree.
 */
export function taxableFutaWagesForEmployee(e: Form940Employee): number {
  const afterExempt = Math.max(0, e.totalPaymentsCents - e.exemptPaymentsCents);
  return Math.min(afterExempt, FUTA_WAGE_BASE_CENTS);
}

/**
 * Build the return, or refuse with every reason at once.
 *
 * ALL refusals are collected rather than returning on the first, because an
 * owner who fixes one missing fact and is immediately shown a second is being
 * made to do the work in the least efficient order possible.
 */
export function buildForm940(req: Form940Request): Form940Result {
  const refusals: Form940Refusal[] = [];
  const push = (
    code: Form940RefusalCode,
    what: string,
    fix: string,
    employeeId: string | null = null,
  ) => refusals.push({ code, what, fix, employeeId });

  // ── the year ──────────────────────────────────────────────────────────────
  if (!Number.isInteger(req.year) || req.year < 2000 || req.year > 2100) {
    push(
      "YEAR_NOT_VALID",
      `The return is dated ${req.year}, which is not a year Form 940 can cover.`,
      "Set the calendar year the return covers, as a four-digit year.",
    );
  }

  // ── Who Must File ─────────────────────────────────────────────────────────
  // Checked BEFORE the dormant shortcut, because it is the reason a dormant
  // year has to file anything at all. Box c says "I'm not liable THIS year";
  // it does not say "I have no filing obligation".
  const ft = req.filingTest;
  if (
    ft.maxQuarterWagesThisYearCents === null ||
    ft.maxQuarterWagesPriorYearCents === null ||
    ft.weeksWithAnyEmployeeThisYear === null ||
    ft.weeksWithAnyEmployeePriorYear === null
  ) {
    push(
      "FILING_TEST_UNKNOWN",
      "The two Who Must File facts have not been recorded, so the engine cannot say " +
        "whether a Form 940 is required. It will not assume one is, and it will not " +
        "assume one is not.",
      "Record four numbers: the largest single quarter of TOTAL WAGES paid this year " +
        "and last year, and the number of different weeks in each year in which you " +
        "had at least one employee for any part of a day. Note that the wage figure " +
        "is uncapped total pay, NOT the $7,000-per-person FUTA base — the two tests " +
        "measure different things.",
    );
  }
  for (const [label, v] of [
    ["largest quarter of wages this year", ft.maxQuarterWagesThisYearCents],
    ["largest quarter of wages last year", ft.maxQuarterWagesPriorYearCents],
    ["weeks with an employee this year", ft.weeksWithAnyEmployeeThisYear],
    ["weeks with an employee last year", ft.weeksWithAnyEmployeePriorYear],
  ] as const) {
    if (v !== null && v < 0) {
      push(
        "NEGATIVE_AMOUNT",
        `The figure for "${label}" is negative.`,
        `Correct the "${label}" figure — it cannot be less than zero.`,
      );
    }
  }

  const dormant = req.noPaymentsThisYear === true;
  const anyoneWasPaid = req.employees.some((e) => e.totalPaymentsCents !== 0);
  if (dormant && anyoneWasPaid) {
    push(
      "DORMANT_CONTRADICTED",
      "This year is marked as having no payments to employees, but employees with pay " +
        "were supplied. Both cannot be true, and box c is a statement made under " +
        "penalty of perjury.",
      "Either clear the no-payments flag and file a normal return, or remove the paid " +
        "employees if they belong to a different year.",
    );
  }

  // ── THE BOX-C SHORTCUT ────────────────────────────────────────────────────
  // "If you're not liable for FUTA tax for 2025 because you made no payments to
  // employees in 2025, check box c ... Then, go to Part 7, sign the form, and
  // file it with the IRS." Parts 2 to 6 are skipped, so the facts that feed
  // them are not demanded. Demanding an experience rate for a year with no
  // payroll would be a refusal the form itself does not make.
  if (dormant && !anyoneWasPaid) {
    if (refusals.length > 0) return { ok: false, refusals };
    const meetsQ =
      (ft.maxQuarterWagesThisYearCents as number) >=
        FUTA_EMPLOYER_TEST_QUARTERLY_WAGES_CENTS ||
      (ft.maxQuarterWagesPriorYearCents as number) >=
        FUTA_EMPLOYER_TEST_QUARTERLY_WAGES_CENTS;
    const meetsW =
      (ft.weeksWithAnyEmployeeThisYear as number) >= FUTA_EMPLOYER_TEST_WEEKS ||
      (ft.weeksWithAnyEmployeePriorYear as number) >= FUTA_EMPLOYER_TEST_WEEKS;
    return {
      ok: true,
      ret: {
        year: req.year,
        lines: [],
        worksheet: null,
        deposits: form940DepositSchedule({ q1Cents: 0, q2Cents: 0, q3Cents: 0, q4Cents: 0 }),
        totalTaxCents: 0,
        balanceDueCents: 0,
        overpaymentCents: 0,
        isZeroReturn: true,
        meetsQuarterlyWageTest: meetsQ,
        meetsTwentyWeekTest: meetsW,
        mustFile: meetsQ || meetsW,
        notes: [
          "No wages were paid this year, so this is a box-c return: you tick box c in the " +
            "top right corner, go straight to Part 7, sign it and send it. Parts 2 through " +
            "6 stay empty. It still has to be filed — silence is not a filing, and the IRS " +
            "cannot tell a dormant business from a delinquent one unless you tell it.",
        ],
      },
    };
  }

  // ── employees ─────────────────────────────────────────────────────────────
  if (req.employees.length === 0) {
    push(
      "NO_EMPLOYEES",
      "No employees were supplied, and nobody has said this was a year with no payroll.",
      "Either add the employees paid during the year, or mark the year as having no " +
        "payments so the return can be filed with box c checked. A year with no payroll " +
        "still needs a Form 940 if you met the filing test in the lookback.",
    );
  }

  for (const e of req.employees) {
    if (e.totalPaymentsCents < 0 || e.exemptPaymentsCents < 0) {
      push(
        "NEGATIVE_AMOUNT",
        `${e.name} has a negative payment figure, which no year produces honestly.`,
        "Correct the payroll records for this person, then rebuild the return.",
        e.employeeId,
      );
    }
    if (e.exemptPaymentsCents > e.totalPaymentsCents) {
      push(
        "EXEMPT_EXCEEDS_TOTAL",
        `${e.name} has more FUTA-exempt pay than total pay, which cannot be true.`,
        "Check the exempt payments figure — line 4 is a subset of line 3, never larger.",
        e.employeeId,
      );
    }
    if (e.excludedFromStateUnemploymentTax === null) {
      push(
        "STATE_EXCLUSION_UNKNOWN",
        `Nobody has recorded whether ${e.name}'s wages are excluded from Washington ` +
          `unemployment tax. That fact decides between line 9 and line 10, and the two ` +
          `differ by the entire 5.4% credit.`,
        `Answer one question for ${e.name}: were these wages excluded from Washington ` +
          `unemployment tax? The IRS prints a Caution on this exact point — being ` +
          `assigned a 0% rate is NOT an exclusion, and wages at a 0% rate still earn ` +
          `the full credit.`,
        e.employeeId,
      );
    }
  }

  // ── the state payments ────────────────────────────────────────────────────
  const sp = req.statePayments;
  if (
    sp.paidOnTimeCents === null ||
    sp.paidLateCents === null ||
    sp.notPaidCents === null ||
    sp.taxableStateWagesCents === null
  ) {
    push(
      "STATE_PAYMENTS_UNKNOWN",
      "The Washington unemployment tax has not been split into what was paid on time, " +
        "what was paid late, and what is still unpaid, or the taxable state wages are " +
        "missing. Without that split the credit cannot be computed, and the credit is " +
        "worth nine times the tax itself.",
      "Record four figures, counting ONLY the employer unemployment contribution — no " +
        "PFML, no WA Cares, no EAF surcharge, no penalties or interest. 'On time' means " +
        "paid by the FORM 940 due date (the following 31 January), not by Washington's " +
        "own quarterly deadline.",
    );
  }
  for (const [label, v] of [
    ["paid on time", sp.paidOnTimeCents],
    ["paid late", sp.paidLateCents],
    ["not paid", sp.notPaidCents],
    ["taxable state wages", sp.taxableStateWagesCents],
  ] as const) {
    if (v !== null && v < 0) {
      push(
        "NEGATIVE_AMOUNT",
        `The Washington figure for "${label}" is negative.`,
        `Correct the "${label}" amount — it cannot be less than zero.`,
      );
    }
  }

  if (sp.experienceRateBps === null) {
    push(
      "EXPERIENCE_RATE_UNKNOWN",
      "Washington's assigned experience rate has not been recorded. A rate below 5.4% " +
        "earns EXTRA federal credit on worksheet line 3, so leaving it out throws away " +
        "money that is owed to you.",
      "Enter the experience rate from your ESD tax rate notice, in basis points " +
        "(4.1% is 410).",
    );
  } else if (
    sp.experienceRateBps < 0 ||
    sp.experienceRateBps > EXPERIENCE_RATE_MAX_PLAUSIBLE_BPS
  ) {
    push(
      "EXPERIENCE_RATE_IMPLAUSIBLE",
      `An experience rate of ${sp.experienceRateBps} basis points is outside anything a ` +
        `state assigns.`,
      "Re-read the rate from the ESD notice and enter it in basis points: 5.4% is 540, " +
        "not 5.4 and not 54000.",
    );
  }

  if (req.creditReductionMilliPct === null) {
    push(
      "CREDIT_REDUCTION_UNKNOWN",
      "Nobody has said whether Washington is on the Department of Labor's credit " +
        "reduction list for this year.",
      "Check the credit reduction list for the year and enter the rate — zero if " +
        "Washington is not on it, which has been true for years but is not permanent.",
    );
  } else if (req.creditReductionMilliPct < 0) {
    push(
      "NEGATIVE_AMOUNT",
      "The credit reduction rate is negative.",
      "A credit reduction rate is zero or positive; it never adds credit.",
    );
  }

  if (req.depositedCents === null) {
    push(
      "DEPOSITS_UNKNOWN",
      "The amount of FUTA already deposited during the year has not been supplied, so " +
        "the balance due cannot be stated.",
      "Enter the total FUTA deposited for the year, including any overpayment applied " +
        "from the prior year. If nothing was deposited, enter zero explicitly.",
    );
  } else if (req.depositedCents < 0) {
    push("NEGATIVE_AMOUNT", "Deposits are negative.", "Deposits cannot be less than zero.");
  }

  if (req.quarterly === null) {
    push(
      "QUARTERLY_UNKNOWN",
      "The quarterly FUTA liabilities for Part 5 have not been supplied.",
      "Enter the FUTA tax incurred in each quarter. These drive the deposit schedule, " +
        "and a quarter under $500 CARRIES FORWARD rather than being forgiven.",
    );
  } else {
    for (const [label, v] of [
      ["1st quarter", req.quarterly.q1Cents],
      ["2nd quarter", req.quarterly.q2Cents],
      ["3rd quarter", req.quarterly.q3Cents],
      ["4th quarter", req.quarterly.q4Cents],
    ] as const) {
      if (v < 0) {
        push(
          "NEGATIVE_AMOUNT",
          `The ${label} FUTA liability is negative.`,
          `Correct the ${label} figure — FUTA liability for a quarter is never negative.`,
        );
      }
    }
  }

  if (refusals.length > 0) return { ok: false, refusals };

  // ── from here every optional field is known ───────────────────────────────
  const paidOnTime = sp.paidOnTimeCents as number;
  const paidLate = sp.paidLateCents as number;
  const notPaid = sp.notPaidCents as number;
  const stateWages = sp.taxableStateWagesCents as number;
  const experienceRateBps = sp.experienceRateBps as number;
  const creditReduction = req.creditReductionMilliPct as number;
  const deposited = req.depositedCents as number;
  const quarterly = req.quarterly as Form940Quarterly;

  const notes: string[] = [];

  // ── Part 2, lines 3 to 8 ──────────────────────────────────────────────────
  const line3 = req.employees.reduce((s, e) => s + e.totalPaymentsCents, 0);
  const line4 = req.employees.reduce((s, e) => s + e.exemptPaymentsCents, 0);

  // Line 5 is the EXCESS over $7,000 per person, after removing exempt pay.
  // PER PERSON, never in aggregate: the wage base is an individual cap, and
  // applying it to the total would let one high earner absorb everyone else's
  // allowance. The IRS's own example makes the point — Joan's excess is
  // $35,000, Sara's is $500 and John's is $7,000, totalling $42,500.
  const line5 = req.employees.reduce((s, e) => {
    const afterExempt = e.totalPaymentsCents - e.exemptPaymentsCents;
    return s + Math.max(0, afterExempt - FUTA_WAGE_BASE_CENTS);
  }, 0);

  const line6 = line4 + line5;
  const line7 = line3 - line6;

  // THE CROSS-CHECK. Line 7 computed the form's way (3 − 4 − 5) must equal the
  // sum of each person's capped taxable wages. It is an algebraic identity, so
  // a mismatch means one of the two routes has been edited and the other has
  // not. Throwing is right here: this is not a fact the user got wrong, it is
  // the engine contradicting itself, and returning a number would hide it.
  const line7ByEmployee = req.employees.reduce(
    (s, e) => s + taxableFutaWagesForEmployee(e),
    0,
  );
  if (line7ByEmployee !== line7) {
    throw new Error(
      `form-940: line 7 disagreement — ${line7} from lines 3-6 but ${line7ByEmployee} ` +
        `by employee. One of the two computations has been changed without the other.`,
    );
  }

  const line8 = applyMilliPct(line7, FUTA_NET_RATE_MILLI_PCT);

  // ── Part 3: which adjustment branch? WAGE-WEIGHTED, NOT HEAD-COUNTED ──────
  // "If ALL of the Taxable FUTA Wages You Paid Were Excluded..." (line 9)
  // "If SOME of the Taxable FUTA Wages You Paid Were Excluded..." (line 10)
  const excludedWages = req.employees.reduce(
    (s, e) =>
      e.excludedFromStateUnemploymentTax === true ? s + taxableFutaWagesForEmployee(e) : s,
    0,
  );
  const allExcluded = line7 > 0 && excludedWages === line7;
  const someExcluded = excludedWages > 0 && excludedWages < line7;

  let line9 = 0;
  let line10 = 0;
  let worksheet: Form940Worksheet | null = null;

  if (allExcluded) {
    // "If all of the taxable FUTA wages you paid were excluded from state
    // unemployment tax, multiply line 7 by 0.054 and enter the result on line
    // 9." No credit at all, so the whole 5.4% is added back and the effective
    // rate becomes the full 6.0%.
    line9 = applyMilliPct(line7, FUTA_MAX_CREDIT_MILLI_PCT);
    notes.push(
      "Every dollar of taxable FUTA wages was excluded from Washington unemployment tax, " +
        "so there is no state credit to claim and the federal rate is the full 6% rather " +
        "than 0.6% — ten times the tax. Lines 10 and 11 are left blank: the instructions " +
        "say that if line 9 applies, those two do not.",
    );
  } else if (someExcluded || paidLate > 0) {
    // "You must fill out the worksheet, later, if: Some of the taxable FUTA
    // wages you paid were excluded from state unemployment tax, or Any of your
    // payments of state unemployment tax were late."
    worksheet = form940Worksheet({
      taxableFutaWagesCents: line7,
      taxableStateWagesCents: stateWages,
      experienceRateBps,
      paidOnTimeCents: paidOnTime,
      paidLateCents: paidLate,
    });
    line10 = worksheet.line10IsBlank ? 0 : worksheet.line7AdjustmentCents;

    if (worksheet.line10IsBlank) {
      notes.push(
        `The worksheet stopped at line ${worksheet.stoppedAtLine} because the credit you ` +
          "had already earned reached the maximum, so Form 940 line 10 is left blank and " +
          "nothing is added to your tax. That is the good outcome — and it is worth " +
          "knowing that the worksheet ran and cleared you, rather than never having been " +
          "done at all.",
      );
    } else {
      notes.push(
        `You could have claimed ${fmt(worksheet.line1MaximumCreditCents)} of credit and ` +
          `earned ${fmt(worksheet.line6FutaCreditCents)}. The difference, ` +
          `${fmt(worksheet.line7AdjustmentCents)}, is added to your federal tax on line ` +
          "10 — for wages you already reported correctly. This is what paying the state " +
          "late, or not at all, actually costs at federal level.",
      );
    }

    if (paidLate > 0) {
      notes.push(
        `${fmt(paidLate)} of Washington unemployment tax was paid after the Form 940 due ` +
          "date. Late state tax still earns credit, but only 90 cents on the dollar — the " +
          "10% haircut on worksheet line 5d is the federal cost of being late to the " +
          "state, and it lands on top of whatever Washington charged you in penalty and " +
          "interest.",
      );
    }
    if (notPaid > 0) {
      notes.push(
        `${fmt(notPaid)} of Washington unemployment tax is still unpaid. Unlike tax paid ` +
          "late, unpaid tax earns NO credit at all — it does not appear on the worksheet " +
          "anywhere. Paying it, even now and even late, would recover 90% of the credit " +
          "it is currently costing you.",
      );
    }
  }

  // ── line 11: credit reduction ─────────────────────────────────────────────
  // "However, if you entered an amount on line 9 because all the FUTA taxable
  // wages you paid were excluded from state unemployment tax, skip line 11 and
  // go to line 12."
  const line11 = allExcluded ? 0 : applyMilliPct(line7, creditReduction);
  if (line11 > 0) {
    notes.push(
      "Washington is on the Department of Labor's credit reduction list this year, which " +
        "raises your federal tax through no act of your own. It happens when a state has " +
        "borrowed from the federal government to pay unemployment benefits and has not " +
        "repaid it. Note that credit reduction liability must go out with your FOURTH " +
        "QUARTER deposit, not with the return.",
    );
  }

  // "Add the amounts shown on lines 8, 9, 10, and 11, and enter the result on
  // line 12." And the Caution beneath it: "If line 9 is greater than zero,
  // lines 10 and 11 must be zero because they don't apply."
  const line12 = line8 + line9 + line10 + line11;
  if (line9 > 0 && (line10 !== 0 || line11 !== 0)) {
    throw new Error(
      "form-940: line 9 is positive but line 10 or line 11 is not zero. The instructions " +
        "state these cannot coexist; the branch logic above has been broken.",
    );
  }

  // ── Part 5 must foot to line 12 ───────────────────────────────────────────
  const quarterlyTotal =
    quarterly.q1Cents + quarterly.q2Cents + quarterly.q3Cents + quarterly.q4Cents;
  if (quarterlyTotal !== line12) {
    return {
      ok: false,
      refusals: [
        {
          code: "QUARTERLY_MISMATCH",
          what:
            `Part 5 adds to ${fmt(quarterlyTotal)} but line 12 is ${fmt(line12)}. The four ` +
            "quarters must add to the annual tax exactly — line 17 on the form says so, " +
            "and the IRS matches them.",
          fix:
            `Recheck the quarterly figures — they are off by ${fmt(
              Math.abs(quarterlyTotal - line12),
            )}. A common cause is applying the $7,000 wage base per quarter instead of ` +
            `once per person per year.`,
          employeeId: null,
        },
      ],
    };
  }

  const deposits = form940DepositSchedule(quarterly);

  // ── Part 4 ────────────────────────────────────────────────────────────────
  // "If line 13 is less than line 12, enter the difference on line 14."
  const balanceDue = Math.max(0, line12 - deposited);
  const overpayment = Math.max(0, deposited - line12);

  if (balanceDue > FUTA_DEPOSIT_THRESHOLD_CENTS) {
    notes.push(
      `The balance due is ${fmt(balanceDue)}, which is more than $500. The instructions ` +
        "say that amount was supposed to be DEPOSITED, not paid with the return, and the " +
        "Caution is explicit: if you don't deposit as required and pay the balance with " +
        "Form 940, you may be subject to a penalty — even though the IRS ends up with " +
        "exactly the same money.",
    );
  } else if (balanceDue > 0 && balanceDue < FUTA_DE_MINIMIS_BALANCE_CENTS) {
    notes.push(
      `The balance due is ${fmt(balanceDue)}, which is under one dollar. The instructions ` +
        "say plainly: \"Less than $1, you don't have to pay it.\"",
    );
  }

  if (deposits.anyDepositRequired) {
    const due = deposits.quarters.filter((q) => q.depositRequired).map((q) => `Q${q.quarter}`);
    notes.push(
      `A deposit was required in ${due.join(", ")}. Remember the carry-forward: a quarter ` +
        "under $500 is not forgiven, it rolls into the next quarter, and the deposit " +
        "becomes due the moment the RUNNING TOTAL passes $500 — not the moment a single " +
        "quarter does.",
    );
  } else {
    notes.push(
      `No deposit was required in any quarter. The whole year's tax, ` +
        `${fmt(deposits.payableWithReturnCents)}, can travel with the return, because the ` +
        "running total never exceeded $500. That is one payment a year instead of four.",
    );
  }

  // ── Who Must File, answered ───────────────────────────────────────────────
  const meetsQuarterlyWageTest =
    (ft.maxQuarterWagesThisYearCents as number) >= FUTA_EMPLOYER_TEST_QUARTERLY_WAGES_CENTS ||
    (ft.maxQuarterWagesPriorYearCents as number) >= FUTA_EMPLOYER_TEST_QUARTERLY_WAGES_CENTS;
  const meetsTwentyWeekTest =
    (ft.weeksWithAnyEmployeeThisYear as number) >= FUTA_EMPLOYER_TEST_WEEKS ||
    (ft.weeksWithAnyEmployeePriorYear as number) >= FUTA_EMPLOYER_TEST_WEEKS;

  const lines: Form940Line[] = [
    { line: "3", label: "Total payments to all employees", amountCents: line3, blank: false },
    { line: "4", label: "Payments exempt from FUTA tax", amountCents: line4, blank: false },
    {
      line: "5",
      label: "Total of payments made to each employee in excess of $7,000",
      amountCents: line5,
      blank: false,
    },
    { line: "6", label: "Subtotal (line 4 + line 5)", amountCents: line6, blank: false },
    {
      line: "7",
      label: "Total taxable FUTA wages (line 3 - line 6)",
      amountCents: line7,
      blank: false,
    },
    {
      line: "8",
      label: "FUTA tax before adjustments (line 7 x 0.006)",
      amountCents: line8,
      blank: false,
    },
    {
      line: "9",
      label: "If ALL of the taxable FUTA wages were excluded from state unemployment tax",
      amountCents: line9,
      blank: line9 === 0,
    },
    {
      line: "10",
      label: "If SOME wages were excluded, or state tax was paid late (worksheet)",
      amountCents: line10,
      blank: line10 === 0,
    },
    { line: "11", label: "Credit reduction amount", amountCents: line11, blank: line11 === 0 },
    { line: "12", label: "Total FUTA tax after adjustments", amountCents: line12, blank: false },
    { line: "13", label: "FUTA tax deposited for the year", amountCents: deposited, blank: false },
    { line: "14", label: "Balance due", amountCents: balanceDue, blank: balanceDue === 0 },
    { line: "15a", label: "Overpayment", amountCents: overpayment, blank: overpayment === 0 },
    { line: "16a", label: "1st quarter liability", amountCents: quarterly.q1Cents, blank: false },
    { line: "16b", label: "2nd quarter liability", amountCents: quarterly.q2Cents, blank: false },
    { line: "16c", label: "3rd quarter liability", amountCents: quarterly.q3Cents, blank: false },
    { line: "16d", label: "4th quarter liability", amountCents: quarterly.q4Cents, blank: false },
    {
      line: "17",
      label: "Total tax liability for the year (must equal line 12)",
      amountCents: quarterlyTotal,
      blank: false,
    },
  ];

  return {
    ok: true,
    ret: {
      year: req.year,
      lines,
      worksheet,
      deposits,
      totalTaxCents: line12,
      balanceDueCents: balanceDue,
      overpaymentCents: overpayment,
      isZeroReturn: false,
      meetsQuarterlyWageTest,
      meetsTwentyWeekTest,
      mustFile: meetsQuarterlyWageTest || meetsTwentyWeekTest,
      notes,
    },
  };
}

/** Money for a sentence: 123456 -> "$1,234.56". Never for arithmetic. */
function fmt(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(cents);
  const d = Math.floor(a / 100).toLocaleString("en-US");
  return `${sign}$${d}.${String(a % 100).padStart(2, "0")}`;
}
