/**
 * GARNISHMENT AUTHORITIES - the law behind withholding money from a paycheck
 * for somebody other than the employee.
 *
 * books-33. Michael's instruction for this slice, verbatim: "I also need a way
 * to set garnishments and child support deductions."
 *
 * WHY THESE PARTICULAR SENTENCES ARE QUOTED. Garnishment is the corner of
 * payroll where the EMPLOYER becomes personally liable for arithmetic. Withhold
 * too little on a support order and the shortfall can land on Greenway.
 * Withhold too much and it is a wage claim. There is no safe direction to err
 * in, and no way to eyeball a wrong answer, because every wrong answer is still
 * a plausible dollar figure.
 *
 * The four sentences that decide almost every real case are the definition of
 * disposable earnings, the CCPA ceiling, the support-order exception, and the
 * pay-period conversion. All four are quoted verbatim below, along with the
 * Washington exemptions that frequently override the federal ones.
 *
 * STANDING RULE 24: the quote is sacred. Every `quote` below is a
 * character-for-character copy taken from the mirrored source file on disk, not
 * a retyping from memory. scripts/verify-verbatim-quotes.ts re-reads each one
 * against its corpus on every commit and fails the build on a single character
 * of drift.
 */

export type GarnishmentAuthority = {
  readonly id: string;
  readonly kind: "statute" | "regulation" | "state_law";
  readonly cite: string;
  /** Verbatim. Copied from the mirrored corpus, never retyped. */
  readonly quote: string;
  /** What it means for Greenway, in Michael's language. */
  readonly soWhat: string;
  readonly source: string;
};

const USC1672 = "docs/authorities/federal/usc-15-1672.txt";
const USC1673 = "docs/authorities/federal/usc-15-1673.txt";
const CFR870 = "docs/authorities/federal/29-cfr-870-garnishment.txt";
const RCW627 = "docs/authorities/state-wa/rcw-6.27.150.txt";
const RCW2618 = "docs/authorities/state-wa/rcw-26.18.090.txt";

/* ------------------------------------------------------------------ *
 * THE BASE - what you are allowed to take a percentage OF
 * ------------------------------------------------------------------ */

/**
 * TRAP ONE, and the most common error in the whole field.
 *
 * "amounts required by law to be withheld". Taxes qualify. Health insurance,
 * retirement contributions, union dues and a uniform deduction do NOT, however
 * automatic they feel on a pay stub. Subtracting them produces a smaller base,
 * a smaller garnishment, and an employer holding the difference.
 */
export const DISPOSABLE_EARNINGS: GarnishmentAuthority = {
  id: "usc-15-1672-disposable",
  kind: "statute",
  cite: "15 U.S.C. §1672(b)",
  quote:
    'The term "disposable earnings" means that part of the earnings of any individual remaining after the deduction from those earnings of any amounts required by law to be withheld.',
  soWhat:
    "Disposable earnings is NOT take-home pay. It is gross pay minus only what the law FORCES you to withhold - income tax, social security, medicare, and in this state the employee share of PFML and WA Cares. Health insurance and retirement come out AFTER this line, not before it. Subtracting them is the single most common garnishment error, it under-withholds on the order, and on a support order the shortfall can become yours. The system shows you which deductions it deliberately ignored, so when a number looks too big you can see why.",
  source: USC1672,
};

/* ------------------------------------------------------------------ *
 * THE FEDERAL CEILING
 * ------------------------------------------------------------------ */

export const CCPA_MAX_GARNISHMENT: GarnishmentAuthority = {
  id: "usc-15-1673-max-garnishment",
  kind: "statute",
  cite: "15 U.S.C. §1673(a)",
  quote:
    "Except as provided in subsection (b) and in section 1675 of this title, the maximum part of the aggregate disposable earnings of an individual for any workweek which is subjected to garnishment may not exceed (1) 25 per centum of his disposable earnings for that week, or (2) the amount by which his disposable earnings for that week exceed thirty times the Federal minimum hourly wage prescribed by section 206(a)(1) of title 29 in effect at the time the earnings are payable, whichever is less.",
  soWhat:
    "Two tests, and the SMALLER one wins. Twenty-five percent of disposable earnings, or whatever is left after protecting thirty times the federal minimum wage. On a small paycheck the second test protects everything and nothing at all may be taken. Both are computed on every cheque and the engine tells you which one bound.",
  source: USC1673,
};

/**
 * TRAP FOUR. Support orders are not held to 25 percent at all.
 *
 * Two facts most payroll systems never collect decide whether the cap is 50,
 * 55, 60 or 65 percent. Both are nullable in our schema and BOTH REFUSE WHEN
 * NULL, because guessing either way causes a different serious harm.
 */
export const CCPA_SUPPORT_CAP: GarnishmentAuthority = {
  id: "usc-15-1673-support-cap",
  kind: "statute",
  cite: "15 U.S.C. §1673(b)(2)",
  quote:
    "The maximum part of the aggregate disposable earnings of an individual for any workweek which is subject to garnishment to enforce any order for the support of any person shall not exceed- (A) where such individual is supporting his spouse or dependent child (other than a spouse or child with respect to whose support such order is used), 50 per centum of such individual's disposable earnings for that week; and (B) where such individual is not supporting such a spouse or dependent child described in clause (A), 60 per centum of such individual's disposable earnings for that week;",
  soWhat:
    "Child support and maintenance blow straight past the 25% ceiling. The cap is 50% if the employee supports another spouse or child, 60% if not, and each rises by five points when arrears are more than twelve weeks old - so 50, 55, 60 or 65. Those two answers have to come off the withholding order or from the employee; the system refuses to compute rather than assume, because assuming 50 under-withholds and can make you liable, and assuming 65 takes too much out of someone's cheque.",
  source: USC1673,
};

/**
 * THE THREE THINGS THE 25% CEILING DOES NOT COVER.
 *
 * RULE 24, AND A REAL CATCH. This record originally quoted only subparagraph
 * (C) - but it kept the lead-in "The restrictions of subsection (a) do not
 * apply in the case of" and stitched it directly onto "(C) any debt due for any
 * State or Federal tax." That reads perfectly, every word of it appears in the
 * statute, and the resulting sentence exists NOWHERE in the United States Code:
 * (A) and (B) sit between the two halves. verify-verbatim-quotes.ts reported it
 * as "matches the first 63 characters, then diverges" and the build stopped.
 *
 * Quoting all three subparagraphs is both honest and more useful, because the
 * engine needs (A) anyway: support orders are exempt from the 25% ceiling and
 * are capped instead by subsection (b)(2), which is the record directly above.
 */
export const CCPA_TAX_DEBT_EXCEPTION: GarnishmentAuthority = {
  id: "usc-15-1673-tax-exception",
  kind: "statute",
  cite: "15 U.S.C. §1673(b)(1)",
  quote:
    "The restrictions of subsection (a) do not apply in the case of (A) any order for the support of any person issued by a court of competent jurisdiction or in accordance with an administrative procedure, which is established by State law, which affords substantial due process, and which is subject to judicial review. (B) any order of any court of the United States having jurisdiction over cases under chapter 13 of title 11. (C) any debt due for any State or Federal tax.",
  soWhat:
    "Three kinds of order ignore the 25% ceiling entirely. A tax levy is one of them: the IRS or the Department of Revenue works out what the employee gets to keep and prints it on the levy notice, and you withhold the rest. The system takes that figure from the paperwork rather than computing one, because the federal exempt amount comes from a filing-status table we have deliberately not guessed at. Support orders are the second, and they get their own cap - 50, 55, 60 or 65 percent - from the record just above. Chapter 13 bankruptcy orders are the third, and if one ever lands the trustee's order sets the amount, not this formula.",
  source: USC1673,
};

/* ------------------------------------------------------------------ *
 * TRAP THREE - the biweekly conversion, which is the one that bites
 * Greenway specifically
 * ------------------------------------------------------------------ */

/**
 * The statute is written PER WORKWEEK. Greenway pays every two weeks.
 *
 * Use the weekly protected floor on a two-week cheque and you over-garnish
 * every single period, by a consistent amount, forever.
 */
export const CCPA_LONGER_PAY_PERIOD: GarnishmentAuthority = {
  id: "cfr-870-10-longer-period",
  kind: "regulation",
  cite: "29 CFR §870.10(c)(2)",
  quote:
    "The following formula should be used to calculate the dollar amount of disposable earnings which would not be subject to garnishment: The number of workweeks, or fractions thereof, should be multiplied times the applicable Federal minimum wage and that amount should be multiplied by 30.",
  soWhat:
    "The protected amount is a WEEKLY figure and Greenway pays biweekly, so it has to be doubled for a normal pay period. Skip that and you take roughly twice what the law allows out of somebody's cheque, every time, and it looks perfectly ordinary. Note also that the dollar amounts printed in this regulation are frozen at the 1991 minimum wage of $4.25 - the system reproduces the FORMULA and refuses to run without a current wage, rather than copying figures that are decades stale.",
  source: CFR870,
};

export const CCPA_BELOW_FLOOR_NOTHING: GarnishmentAuthority = {
  id: "cfr-870-10-below-floor",
  kind: "regulation",
  cite: "29 CFR §870.10(b)(1)",
  quote:
    "If an individual's disposable earnings for such a period are equal to or less than 30 times the minimum wage, the individual's earnings may not be garnished in any amount.",
  soWhat:
    "Below the floor, nothing may be taken - not a reduced amount, nothing. A part-time employee on a light cheque is simply not garnishable that period, and the correct response is to report that to the issuing agency, not to squeeze something out.",
  source: CFR870,
};

/* ------------------------------------------------------------------ *
 * WASHINGTON - frequently more protective than the federal rule
 * ------------------------------------------------------------------ */

/**
 * TRAP TWO. Federal and state both apply and the employee keeps the better
 * deal, so an engine that implements only one of them is wrong about half the
 * time.
 *
 * Note this subsection measures against the FEDERAL minimum wage while
 * subsection (4) measures against the STATE one. That is not a transcription
 * error, and in Washington the two differ by more than a factor of two.
 */
export const WA_EXEMPTION_GENERAL: GarnishmentAuthority = {
  id: "rcw-6-27-150-general",
  kind: "state_law",
  cite: "RCW 6.27.150(1)",
  quote:
    "if the garnishee is an employer owing the defendant earnings, then for each week of such earnings, an amount shall be exempt from garnishment which is the greatest of the following: (a) Thirty-five times the federal minimum hourly wage in effect at the time the earnings are payable; or (b) Seventy-five percent of the disposable earnings of the defendant.",
  soWhat:
    "Washington protects the GREATEST of thirty-five times the federal minimum wage or seventy-five percent of disposable earnings - noticeably more than the federal twenty-five percent rule leaves. Both the federal cap and this exemption are computed and the employee keeps whichever protects more, which for an ordinary creditor writ in this state is usually this one.",
  source: RCW627,
};

export const WA_EXEMPTION_CONSUMER_DEBT: GarnishmentAuthority = {
  id: "rcw-6-27-150-consumer-debt",
  kind: "state_law",
  cite: "RCW 6.27.150(4)",
  quote:
    "In the case of a garnishment based on a judgment or other order for the collection of consumer debt, for each week of such earnings, an amount shall be exempt from garnishment which is the greater of the following: (a) Thirty-five times the state minimum hourly wage; or (b) Eighty percent of the disposable earnings of the defendant.",
  soWhat:
    "Consumer debt - a credit card, a medical bill - is measured against the STATE minimum wage, not the federal one, and protects eighty percent. In Washington that is a much larger protection than the general rule, so classifying an order correctly as consumer debt genuinely changes what comes out of the cheque.",
  source: RCW627,
};

export const WA_EXEMPTION_STUDENT_LOAN: GarnishmentAuthority = {
  id: "rcw-6-27-150-student-loan",
  kind: "state_law",
  cite: "RCW 6.27.150(3)",
  quote:
    "In the case of a garnishment based on a judgment or other order for the collection of private student loan debt, for each week of such earnings, an amount shall be exempt from garnishment which is the greater of the following: (a) Fifty times the minimum hourly wage of the highest minimum wage law in the state at the time the earnings are payable; or (b) Eighty-five percent of the disposable earnings of the defendant.",
  soWhat:
    "Private student loan debt gets the most protection of all: fifty times the highest minimum wage in the state, or eighty-five percent. Note 'highest minimum wage law in the state' - if a city ordinance were higher than the state figure it would govern. Port Orchard has no local minimum wage, so the state figure applies here.",
  source: RCW627,
};

/* ------------------------------------------------------------------ *
 * SUPPORT AND MAINTENANCE - Washington's own caps
 * ------------------------------------------------------------------ */

export const WA_MAINTENANCE_FIFTY_PERCENT: GarnishmentAuthority = {
  id: "rcw-26-18-090-fifty-percent",
  kind: "state_law",
  cite: "RCW 26.18.090(2)",
  quote:
    "The total amount to be withheld from the obligor's earnings each month, or from each earnings disbursement, shall not exceed fifty percent of the disposable earnings of the obligor.",
  soWhat:
    "Washington caps support withholding at fifty percent flat, which can be stricter than the federal 55, 60 or 65. Both apply and the employee keeps the benefit of the tighter one, so the engine computes each and takes the lower ceiling.",
  source: RCW2618,
};

/**
 * EQUALLY. Not pro rata.
 *
 * This is the sentence almost everyone gets wrong, including several commercial
 * payroll packages, because proportional division feels obviously fairer and is
 * what an accountant would reach for unprompted.
 */
export const WA_MULTIPLE_ORDERS_EQUALLY: GarnishmentAuthority = {
  id: "rcw-26-18-090-apportion-equally",
  kind: "state_law",
  cite: "RCW 26.18.090(4)",
  quote:
    "If an obligor is subject to two or more attachments for maintenance on account of different obligees, the employer shall, if the nonexempt portion of the obligor's earnings is not sufficient to respond fully to all the attachments, apportion the obligor's nonexempt disposable earnings between or among the various obligees equally.",
  soWhat:
    "EQUALLY - split the available money into even shares, one per order. NOT in proportion to what each order asks for, which is what nearly everyone assumes. Two orders for $600 and $200 against $400 available is $200 and $200, not $300 and $100. If an obligee objects, the remedy is a court order reapportioning it; the employer does not get to decide. The engine divides equally and hands out leftover pennies one at a time so the total reconciles exactly.",
  source: RCW2618,
};

/* ------------------------------------------------------------------ *
 * THE REGISTRY
 * ------------------------------------------------------------------ */

export const GARNISHMENT_AUTHORITIES: readonly GarnishmentAuthority[] = [
  DISPOSABLE_EARNINGS,
  CCPA_MAX_GARNISHMENT,
  CCPA_SUPPORT_CAP,
  CCPA_TAX_DEBT_EXCEPTION,
  CCPA_LONGER_PAY_PERIOD,
  CCPA_BELOW_FLOOR_NOTHING,
  WA_EXEMPTION_GENERAL,
  WA_EXEMPTION_CONSUMER_DEBT,
  WA_EXEMPTION_STUDENT_LOAN,
  WA_MAINTENANCE_FIFTY_PERCENT,
  WA_MULTIPLE_ORDERS_EQUALLY,
];
