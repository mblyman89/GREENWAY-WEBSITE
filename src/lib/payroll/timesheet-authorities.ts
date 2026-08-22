/**
 * TIMESHEET AUTHORITIES - the law behind turning punches into payable hours.
 *
 * books-32. Michael's instruction for this slice, verbatim: "We can not mess up
 * payroll and its reporting and payments. This one will bankrupt me if we
 * aren't careful."
 *
 * He is right, and the specific way it bankrupts a biweekly employer is narrow
 * enough to name. A pay period that covers two weeks contains TWO WORKWEEKS.
 * The overtime threshold is forty hours PER WORKWEEK, not eighty per period.
 * An employee who works 45 hours and then 35 has worked 80 hours and is owed
 * five hours of overtime premium. An engine that sums the period and asks "is
 * 80 more than 80?" pays that employee nothing extra, every single period, for
 * years, and the arithmetic looks perfectly reasonable while it happens.
 *
 * That is not a rounding difference. It is a wage claim, and in Washington it
 * carries exposure well beyond the unpaid amount. So the rule that forbids it
 * is quoted here verbatim from the regulation rather than paraphrased, and the
 * engine is built around it rather than having it bolted on.
 *
 * STANDING RULE 24: the quote is sacred. Every `quote` below is a
 * character-for-character copy taken from the mirrored source file on disk, not
 * a retyping from memory. scripts/verify-verbatim-quotes.ts re-reads each one
 * against its corpus on every commit and fails the build on a single character
 * of drift.
 */

export type TimesheetAuthority = {
  readonly id: string;
  /**
   * Deliberately the SAME vocabulary the merged registry uses. Washington
   * statutes are tagged "state_law" here because that is what every other RCW
   * in this codebase is tagged, and the tag drives the badge printed next to
   * the citation on screen. Two RCW sections wearing different badges would be
   * a defect visible to Michael, not a naming preference.
   */
  readonly kind: "regulation" | "state_law";
  readonly cite: string;
  /** Verbatim. Copied from the mirrored corpus, never retyped. */
  readonly quote: string;
  /** What it means for Greenway, in Michael's language. */
  readonly soWhat: string;
  readonly source: string;
};

/* ------------------------------------------------------------------ *
 * THE WORKWEEK - why a biweekly period is two buckets, not one
 * ------------------------------------------------------------------ */

/**
 * The single most consequential sentence in this entire slice.
 *
 * Read it twice. "Does not permit averaging of hours over 2 or more weeks."
 * The regulation then gives the exact example that describes a Greenway
 * employee: 30 hours one week, 50 the next. Average 40. Overtime still owed.
 */
export const WORKWEEK_STANDS_ALONE: TimesheetAuthority = {
  id: "cfr-778-104-workweek-stands-alone",
  kind: "regulation",
  cite: "29 CFR §778.104",
  quote:
    "The Act takes a single workweek as its standard and does not permit averaging of hours over 2 or more weeks. " +
    "Thus, if an employee works 30 hours one week and 50 hours the next, he must receive overtime compensation for " +
    "the overtime hours worked beyond the applicable maximum in the second week, even though the average number of " +
    "hours worked in the 2 weeks is 40. This is true regardless of whether the employee works on a standard or " +
    "swing-shift schedule and regardless of whether he is paid on a daily, weekly, biweekly, monthly or other basis.",
  soWhat:
    "Your pay periods are two weeks long, so every period contains two workweeks and the engine has to split them " +
    "before it counts anything. The regulation's own example is a Greenway example: 30 hours then 50 hours is 80 " +
    "hours total, and the employee is still owed ten hours of overtime premium. If we totalled the period and asked " +
    "whether it exceeded 80, we would pay that person nothing extra and the number on the screen would look right. " +
    "That is the mistake this engine is shaped to make impossible.",
  source: "https://www.ecfr.gov/current/title-29/part-778/section-778.104",
};

/**
 * A workweek is a FIXED period you choose once. It is not "Monday to Sunday
 * because that is what a calendar looks like", and it is not allowed to move
 * around to suit a schedule.
 */
export const WORKWEEK_IS_FIXED_168_HOURS: TimesheetAuthority = {
  id: "cfr-778-105-workweek-definition",
  kind: "regulation",
  cite: "29 CFR §778.105",
  quote:
    "An employee's workweek is a fixed and regularly recurring period of 168 hours\u2014seven consecutive 24-hour " +
    "periods. It need not coincide with the calendar week but may begin on any day and at any hour of the day. " +
    "For purposes of computing pay due under the Fair Labor Standards Act, a single workweek may be established " +
    "for a plant or other establishment as a whole or different workweeks may be established for different " +
    "employees or groups of employees. Once the beginning time of an employee's workweek is established, it " +
    "remains fixed regardless of the schedule of hours worked by him.",
  soWhat:
    "You pick the day your workweek starts, once, and then it stays put. That is why the company information " +
    "screen now has a 'workweek starts on' setting and why this engine refuses to compute anything until it is " +
    "filled in. It cannot pick Sunday for you: choosing your workweek is a business decision with legal " +
    "consequences, and a default chosen by software would be a decision nobody made. The regulation does permit " +
    "changing it later, but only as a permanent change and not one timed to dodge overtime.",
  source: "https://www.ecfr.gov/current/title-29/part-778/section-778.105",
};

/* ------------------------------------------------------------------ *
 * THE REGULAR RATE - what the 1.5 multiplies
 * ------------------------------------------------------------------ */

export const REGULAR_RATE_IS_HOURLY: TimesheetAuthority = {
  id: "cfr-778-109-regular-rate-is-hourly",
  kind: "regulation",
  cite: "29 CFR §778.109",
  quote:
    "The regular hourly rate of pay of an employee is determined by dividing his total remuneration for employment " +
    "(except statutory exclusions) in any workweek by the total number of hours actually worked by him in that " +
    "workweek for which such compensation was paid.",
  soWhat:
    "Overtime is 1.5 times the REGULAR RATE, and the regular rate is a computed figure rather than simply whatever " +
    "is written on the employee's pay record. For a Greenway sales associate paid one flat hourly rate and nothing " +
    "else, the two are the same number and the arithmetic is simple. The moment you add a nondiscretionary bonus " +
    "or a shift differential, the regular rate rises and the overtime premium rises with it. This engine handles " +
    "the single-rate case and REFUSES the others rather than quietly applying the simple formula to a situation it " +
    "does not fit.",
  source: "https://www.ecfr.gov/current/title-29/part-778/section-778.109",
};

/**
 * The worked example. This is the arithmetic the engine implements, and the
 * numbers in this quote are used as a literal test case.
 */
export const HOURLY_RATE_EMPLOYEE_EXAMPLE: TimesheetAuthority = {
  id: "cfr-778-110-hourly-rate-employee",
  kind: "regulation",
  cite: "29 CFR §778.110(a)",
  quote:
    "If the employee is employed solely on the basis of a single hourly rate, the hourly rate is the \u201cregular " +
    "rate.\u201d For overtime hours of work the employee must be paid, in addition to the straight time hourly " +
    "earnings, a sum determined by multiplying one-half the hourly rate by the number of hours worked in excess " +
    "of 40 in the week. Thus a $12 hourly rate will bring, for an employee who works 46 hours, a total weekly " +
    "wage of $588 (46 hours at $12 plus 6 at $6). In other words, the employee is entitled to be paid an amount " +
    "equal to $12 an hour for 40 hours and $18 an hour for the 6 hours of overtime, or a total of $588.",
  soWhat:
    "This is the whole calculation, with the government's own numbers. Read the regulation carefully and it " +
    "gives the SAME $588.00 two different ways: as $552.00 for all 46 hours at $12 plus a $36.00 premium " +
    "(46 at $12, plus 6 at $6), and as $480.00 for 40 hours at $12 plus $108.00 for 6 hours at $18. This " +
    "engine reports the FIRST split, because straight time on every hour plus a separately identifiable " +
    "overtime premium is the shape the W-2 and the 941 need. Both are tested against $588.00, so a future " +
    "change that breaks the arithmetic fails with the regulation's own example rather than one I invented.",
  source: "https://www.ecfr.gov/current/title-29/part-778/section-778.110",
};

/* ------------------------------------------------------------------ *
 * WASHINGTON - the state rule, which is what actually binds Greenway
 * ------------------------------------------------------------------ */

export const WA_OVERTIME_OVER_FORTY: TimesheetAuthority = {
  id: "rcw-49-46-130-overtime",
  kind: "state_law",
  cite: "RCW 49.46.130(1)",
  quote:
    "Except as otherwise provided in this section, no employer shall employ any of his or her employees for a " +
    "workweek longer than forty hours unless such employee receives compensation for his or her employment in " +
    "excess of the hours above specified at a rate not less than one and one-half times the regular rate at which " +
    "he or she is employed.",
  soWhat:
    "Washington's rule and the federal rule point the same direction here, which is convenient but not something " +
    "to rely on generally - where they differ, the employer follows whichever is more generous to the employee. " +
    "This is also the promise your own employee handbook already makes, in these words: 'Non-exempt employees " +
    "earn overtime at 1.5x the regular rate for hours over 40 in a workweek (RCW 49.46.130).' You have told your " +
    "staff this in writing. The engine is built to keep that promise rather than to reinterpret it.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=49.46.130",
};

/**
 * The exemption list. Quoted because "exempt" is the single most abused word in
 * small-business payroll, and the statute's own list is short and specific.
 */
export const WA_OVERTIME_EXEMPTIONS: TimesheetAuthority = {
  id: "rcw-49-46-130-exemptions",
  kind: "state_law",
  cite: "RCW 49.46.130(2)(a)",
  quote:
    "This section does not apply to:(a) Any person exempted pursuant to *RCW 49.46.010(3). The payment of " +
    "compensation or provision of compensatory time off in addition to a salary shall not be a factor in " +
    "determining whether a person is exempted under *RCW 49.46.010(3)(c);",
  soWhat:
    "Read the second sentence carefully, because it is the trap. Paying someone a salary does NOT make them exempt " +
    "from overtime. Exemption depends on duties and on meeting a salary threshold, not on the mere fact of being " +
    "salaried, and calling a retail sales associate a 'manager' does not change what they do all day. For " +
    "Greenway this matters in one specific place: you are the only salaried person, and everyone on the floor is " +
    "non-exempt and owed overtime. That is why every employee in this system defaults to non-exempt and marking " +
    "someone exempt is a deliberate act that the screen makes you justify.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=49.46.130",
};

/* ------------------------------------------------------------------ *
 * THE FLOOR - minimum wage, checked against the computed rate
 * ------------------------------------------------------------------ */

export const WA_MINIMUM_WAGE_ADJUSTS_ANNUALLY: TimesheetAuthority = {
  id: "rcw-49-46-020-minimum-wage-indexed",
  kind: "state_law",
  cite: "RCW 49.46.020(2)(b)",
  quote:
    "On September 30, 2020, and on each following September 30th, the department of labor and industries shall " +
    "calculate an adjusted minimum wage rate to maintain employee purchasing power by increasing the current " +
    "year's minimum wage rate by the rate of inflation. The adjusted minimum wage rate shall be calculated to the " +
    "nearest cent using the consumer price index for urban wage earners and clerical workers, CPI-W, or a " +
    "successor index, for the twelve months prior to each September 1st as calculated by the United States " +
    "department of labor. Each adjusted minimum wage rate calculated under this subsection (2)(b) takes effect on " +
    "the following January 1st.",
  soWhat:
    "The Washington minimum wage changes every January 1st, announced the previous September 30th. That means a " +
    "pay rate which was legal in December can be illegal in January without anyone touching it. The engine " +
    "therefore checks the computed hourly rate against a minimum-wage floor that is stored WITH ITS EFFECTIVE " +
    "YEAR rather than hardcoded, and it refuses to check at all - rather than checking against a stale number - " +
    "if it has no floor on file for the year being paid. A silent pass using last year's figure is worse than no " +
    "check, because it looks like a check.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=49.46.020",
};

export const TIMESHEET_AUTHORITIES: readonly TimesheetAuthority[] = [
  WORKWEEK_STANDS_ALONE,
  WORKWEEK_IS_FIXED_168_HOURS,
  REGULAR_RATE_IS_HOURLY,
  HOURLY_RATE_EMPLOYEE_EXAMPLE,
  WA_OVERTIME_OVER_FORTY,
  WA_OVERTIME_EXEMPTIONS,
  WA_MINIMUM_WAGE_ADJUSTS_ANNUALLY,
];

/** Look one up by id, or null. Never throws, never guesses. */
export function timesheetAuthorityById(id: string): TimesheetAuthority | null {
  return TIMESHEET_AUTHORITIES.find((a) => a.id === id) ?? null;
}
