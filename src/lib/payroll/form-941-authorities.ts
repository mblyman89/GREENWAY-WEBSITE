/**
 * src/lib/payroll/form-941-authorities.ts   (books-40)
 *
 * THE LAW THAT MAKES THE QUARTERLY RETURN A DUTY, TRANSCRIBED WORD FOR WORD.
 *
 * WHY THIS FILE EXISTS, VERBATIM (standing rule 1)
 *
 *   "Then - books-40: quarterly filings. 941 first, since it is due first and
 *    is mostly summation; then the ESD and L&I quarterly reports."
 *
 * Michael is right that the 941 is "mostly summation", and that is precisely
 * what makes it dangerous. A form that is mostly addition invites the belief
 * that it is entirely addition, and the two lines that are NOT addition -
 * the number-of-employees count on line 1 and the fractions-of-cents
 * adjustment on line 7 - are exactly the two lines a summing program gets
 * wrong. Both are quoted below in the government's own words so that the code
 * downstream can be checked against the source rather than against my memory
 * of the source.
 *
 * WHAT IS DELIBERATELY *NOT* HERE
 *
 * Twelve deposit-schedule and Schedule B authorities already exist in
 * `payroll-tax-authorities.ts` - PUB15_LOOKBACK_PERIOD, PUB15_SCHEDULE_B_REQUIRED,
 * PUB15_SEMIWEEKLY_SPANNING_QUARTERS and nine more - and the FICA rate and wage
 * base authorities (IRC_3101, IRC_3111, SSA_2026_WAGE_BASE) are there too.
 * Standing rule 25 says extend, do not duplicate, so this file quotes only the
 * texts that registry does not already carry: the duty to FILE, the date it is
 * due, the weekend/holiday shift, and the four line-level instructions the
 * return's own arithmetic depends on. `form941Authorities()` hands back both
 * sets together, so a reader gets the whole picture from one call without the
 * same paragraph being maintained in two places.
 *
 * TRANSCRIPTION NOTE. Every `quote` below was taken from the live source on the
 * date this file was written, by fetching the page and extracting the text
 * mechanically rather than retyping it. Curly apostrophes in the originals are
 * rendered as ASCII apostrophes to match the rest of this codebase; no other
 * character has been changed, and no sentence has been shortened without an
 * explicit ellipsis. Standing rule 24: the quote is sacred.
 */

import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import { PAYROLL_TAX_AUTHORITIES } from "@/lib/payroll/payroll-tax-authorities";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  THE DUTY TO FILE AT ALL
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * THE ONE THAT SURPRISES PEOPLE. Note the parenthesis: "whether or not wages
 * are paid therein". The obligation is not triggered quarter by quarter by
 * having a payroll; it is triggered ONCE, by the first payroll ever, and then
 * it repeats until a final return is filed. A quiet quarter is still a return.
 */
export const CFR_31_6011_A_1_MUST_FILE_QUARTERLY: GuidanceAuthority = {
  id: "cfr-31-6011a1-must-file-quarterly",
  kind: "regulation",
  cite: "26 CFR 31.6011(a)-1(a)(1)",
  quote:
    "Except as otherwise provided in paragraphs (a)(3) and (a)(5) of this section and in " +
    "31.6011(a)-5 every employer is required to make a return for the first calendar quarter in " +
    "which the employer pays wages, other than wages for agricultural labor, subject to the tax " +
    "imposed by the Federal Insurance Contributions Act, and is required to make a return for each " +
    "subsequent calendar quarter (whether or not wages are paid therein) until the employer has " +
    "filed a final return in accordance with 31.6011(a)-6. ... Form 941, \"Employer's QUARTERLY " +
    "Federal Tax Return,\" is the form prescribed for making the return required by this paragraph " +
    "(a)(1).",
  soWhat:
    "Greenway's first payroll under this system is 1 January 2027, which lands in Q1 2027. That " +
    "single payroll creates a filing duty for Q1 2027 AND for every quarter after it - Q2, Q3, Q4, " +
    "and on into 2028 - regardless of whether anybody is paid in those quarters. The words in the " +
    "parenthesis are the whole point: a quarter with no payroll is not a quarter with no return, " +
    "it is a quarter with a zero return. The only thing that ever switches the duty off is a FINAL " +
    "return, which is a deliberate act on a specific form, not something that happens by going " +
    "quiet. This is why the screen offers to build a zero return instead of showing an empty page.",
  source:
    "https://www.ecfr.gov/current/title-26/chapter-I/subchapter-C/part-31/subpart-G/section-31.6011(a)-1",
};

/**
 * THE DEADLINE, AND THE TEN-DAY REWARD FOR HAVING DEPOSITED PROPERLY.
 *
 * The second sentence is easy to skim past and is worth real money in
 * breathing room: file by the 10th of the second month IF the deposits were
 * made in full and on time. It is conditional on conduct, not on asking.
 */
export const CFR_31_6071_A_1_WHEN_DUE: GuidanceAuthority = {
  id: "cfr-31-6071a1-when-due",
  kind: "regulation",
  cite: "26 CFR 31.6071(a)-1(a)(1)",
  quote:
    "Except as provided in paragraph (a)(4) of this section, each return required to be made under " +
    "31.6011(a)-1, in respect of the taxes imposed by the Federal Insurance Contributions Act (26 " +
    "U.S.C. 3101-3128), or required to be made under 31.6011(a)-4, in respect of income tax " +
    "withheld, shall be filed on or before the last day of the first calendar month following the " +
    "period for which it is made. A return may be filed on or before the 10th day of the second " +
    "calendar month following such period if timely deposits under section 6302(c) of the Code and " +
    "the regulations have been made in full payment of such taxes due for the period.",
  soWhat:
    "Two dates, not one. The ordinary due date is the last day of the month after the quarter ends " +
    "- 30 April, 31 July, 31 October, 31 January. The extended date is the 10th of the following " +
    "month, and it is EARNED: it applies only if every deposit for the quarter was made on time " +
    "and in full. The software computes both and shows the ordinary one as the deadline, because " +
    "the extension depends on a deposit history the return itself cannot verify. Treating the 10th " +
    "as the deadline and then discovering one late deposit turns a comfortable filing into a late " +
    "one, and lateness on this form is priced by IRC 6651 at 5% of the tax per month.",
  source:
    "https://www.ecfr.gov/current/title-26/chapter-I/subchapter-C/part-31/subpart-G/section-31.6071(a)-1",
};

/**
 * WHY A DUE DATE IS NOT ALWAYS THE DATE ON THE CALENDAR.
 *
 * 30 April 2027 is a Friday, so this rule does not move Greenway's first
 * deadline - but 31 October 2027 is a Sunday, and it does move that one. The
 * rule is mirrored here rather than assumed, because "the deadline is the last
 * day of the month" is true right up until the last day of the month is a
 * Sunday.
 */
export const CFR_301_7503_1_WEEKEND_HOLIDAY_SHIFT: GuidanceAuthority = {
  id: "cfr-301-7503-1-weekend-holiday-shift",
  kind: "regulation",
  cite: "26 CFR 301.7503-1(a)",
  quote:
    "Section 7503 provides that when the last day prescribed under authority of any internal " +
    "revenue law for the performance of any act falls on a Saturday, Sunday, or legal holiday, " +
    "such act shall be considered performed timely if performed on the next succeeding day which " +
    "is not a Saturday, Sunday, or legal holiday. For this purpose, any authorized extension of " +
    "time shall be included in determining the last day for performance of any act.",
  soWhat:
    "The deadline shown on this screen is computed, not copied off a calendar. Q3 2027 ends 30 " +
    "September and would ordinarily be due 31 October 2027 - which is a Sunday - so the real " +
    "deadline is Monday 1 November 2027. The same engine that already knows federal holidays for " +
    "deposit due dates is reused here rather than a second calendar being written, so the two can " +
    "never drift apart and disagree about whether a day is a business day.",
  source: "https://www.ecfr.gov/current/title-26/part-301/section-301.7503-1",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE FOUR LINE-LEVEL INSTRUCTIONS THE ARITHMETIC DEPENDS ON
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * LINE 1 IS A HEADCOUNT ON ONE NAMED DAY. IT IS NOT "HOW MANY PEOPLE DID I PAY".
 *
 * This is the first of the two lines a summing program gets wrong, and it is
 * the one that looks most obviously like summation. It is not summation at
 * all: it is a snapshot of a single pay period, the one containing the 12th of
 * the last month of the quarter.
 */
export const I941_LINE_1_PAY_PERIOD_INCLUDING_THE_12TH: GuidanceAuthority = {
  id: "i941-line-1-pay-period-including-the-12th",
  kind: "irs_guidance",
  cite: "IRS, Instructions for Form 941, line 1 (Number of Employees Who Received Wages, Tips, or Other Compensation)",
  quote:
    "Enter the number of employees on your payroll for the pay period including March 12, June 12, " +
    "September 12, or December 12, for the quarter indicated at the top of Form 941. Don't include: " +
    "Household employees, Employees in nonpay status for the pay period, Farm employees, " +
    "Pensioners, or Active members of the U.S. Armed Forces.",
  soWhat:
    "Line 1 is a headcount on one particular day, not a count of everybody paid during the three " +
    "months. If somebody quit in April and somebody else started in May, the June figure counts " +
    "whoever was on the payroll for the pay period containing 12 June and nobody else. Michael " +
    "could easily have twelve people paid across a quarter and a line 1 of nine, and both numbers " +
    "are right. The software therefore computes this from the pay period that contains the 12th " +
    "rather than from the number of people appearing in the quarter's wage detail - and it says " +
    "which date it used, so the answer can be checked.",
  source: "https://www.irs.gov/instructions/i941",
};

/**
 * LINE 2 IS DEFINED BY REFERENCE TO THE W-2, WHICH IS WHY IT IS NOT THE SAME
 * NUMBER AS LINE 5a.
 */
export const I941_LINE_2_MATCHES_W2_BOX_1: GuidanceAuthority = {
  id: "i941-line-2-matches-w2-box-1",
  kind: "irs_guidance",
  cite: "IRS, Instructions for Form 941, line 2 (Wages, Tips, and Other Compensation)",
  quote:
    "Enter amounts on line 2 that would also be included in box 1 of your employees' Forms W-2. See " +
    "Box 1 - Wages, tips, other compensation in the General Instructions for Forms W-2 and W-3 for " +
    "details.",
  soWhat:
    "Line 2 is tied by definition to W-2 box 1, which is why the four quarterly 941s and the " +
    "January W-2s have to agree - and why the IRS compares them. It also explains a difference " +
    "that worries people the first time they see it: line 2 and line 5a are allowed to be " +
    "different numbers, because box 1 excludes things like 401(k) deferrals that Social Security " +
    "still taxes. For Greenway in Q2 2026 they happen to be identical, because there is nothing " +
    "in the pay that is treated differently by the two definitions. The software does not assume " +
    "they are always identical.",
  source: "https://www.irs.gov/instructions/i941",
};

/**
 * LINE 5a CARRIES BOTH HALVES AT ONCE, AND STOPS AT THE WAGE BASE.
 *
 * The 12.4% is the giveaway that this line is employer + employee combined.
 * The dollar figure in this quote is the 2026 base; SSA_2026_WAGE_BASE in the
 * shared registry is the authority of record for it, and the two agree.
 */
export const I941_LINE_5A_BOTH_HALVES_AND_THE_CAP: GuidanceAuthority = {
  id: "i941-line-5a-both-halves-and-the-cap",
  kind: "irs_guidance",
  cite: "IRS, Instructions for Form 941, line 5a (Taxable social security wages)",
  quote:
    "Enter the total wages, sick pay, and taxable fringe benefits subject to social security tax " +
    "you paid to your employees during the quarter. ... Enter the amount before payroll deductions. " +
    "Don't include tips on this line. ... For 2026, the rate of social security tax on taxable " +
    "wages is 6.2% (0.062) each for the employer and employee. Stop paying social security tax on " +
    "and entering an employee's wages on line 5a when the employee's taxable wages and tips reach " +
    "$184,500 for the year. However, continue to withhold income and Medicare taxes for the whole " +
    "year on all wages and tips, even when the social security wage base limit of $184,500 has " +
    "been reached. line 5a (column 1) x 0.124 line 5a (column 2)",
  soWhat:
    "Three things Michael should be able to say out loud. First, the 12.4% at the end means line " +
    "5a already contains BOTH halves - his and the employee's - so the 941 total is not the same " +
    "as what came out of the paycheques. Second, the cap is per employee and per calendar year, " +
    "which is why year-to-date wages are an input to a quarterly return and not just a report: " +
    "the quarter in which somebody crosses $184,500 has a line 5a smaller than its line 2. Third, " +
    "Medicare does not stop, ever. Nobody at Greenway is near $184,500, so the cap does not bite " +
    "today - it is implemented and tested anyway, because the first year it matters is the year " +
    "nobody is looking for it.",
  source: "https://www.irs.gov/instructions/i941",
};

/**
 * LINE 7 - THE LINE THAT PROVES THE FORM IS NOT PURE SUMMATION.
 *
 * This is the second line a summing program gets wrong, and the more subtle of
 * the two. Greenway's filed Q2 2026 return carries -0.07 here.
 */
export const I941_LINE_7_FRACTIONS_OF_CENTS: GuidanceAuthority = {
  id: "i941-line-7-fractions-of-cents",
  kind: "irs_guidance",
  cite: "IRS, Instructions for Form 941, line 7 (Current quarter's adjustment for fractions of cents)",
  quote:
    "Enter adjustments for fractions of cents (due to rounding) relating to the employee share of " +
    "social security and Medicare taxes withheld. The employee share of amounts shown in column 2 " +
    "of lines 5a-5d may differ slightly from amounts actually withheld from employees' pay due to " +
    "the rounding of social security and Medicare taxes based on statutory rates. This adjustment " +
    "may be a positive or a negative adjustment.",
  soWhat:
    "This is the IRS admitting in writing that the form will not foot, and telling you where to " +
    "put the difference. Taxing each paycheque and rounding to the cent does not give the same " +
    "answer as taxing the whole quarter in one multiplication, and the gap is a few cents. " +
    "Greenway's filed Q2 2026 return shows -0.07 on this line. The software computes line 7 as a " +
    "RESIDUAL - what was actually withheld minus what the rate says - rather than plugging it to " +
    "make the form balance, and it refuses if the residual is bigger than rounding can explain. " +
    "A plug that absorbs any difference would hide a genuine withholding error behind a line the " +
    "IRS expects to be small, which is the one place on this form where a wrong number looks " +
    "completely normal.",
  source: "https://www.irs.gov/instructions/i941",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE REGISTRY
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The seven texts this slice adds. */
export const FORM_941_AUTHORITIES: readonly GuidanceAuthority[] = [
  CFR_31_6011_A_1_MUST_FILE_QUARTERLY,
  CFR_31_6071_A_1_WHEN_DUE,
  CFR_301_7503_1_WEEKEND_HOLIDAY_SHIFT,
  I941_LINE_1_PAY_PERIOD_INCLUDING_THE_12TH,
  I941_LINE_2_MATCHES_W2_BOX_1,
  I941_LINE_5A_BOTH_HALVES_AND_THE_CAP,
  I941_LINE_7_FRACTIONS_OF_CENTS,
] as const;

/**
 * The ids this slice reuses from the shared payroll registry rather than
 * restating (standing rule 25).
 *
 * Named explicitly instead of pulled in by a wildcard so that deleting one of
 * them from the shared registry breaks a test here with a useful message,
 * rather than silently shrinking the authority panel on the screen.
 */
export const FORM_941_BORROWED_AUTHORITY_IDS: readonly string[] = [
  "irc-3101-employee-fica",
  "irc-3111-employer-fica",
  "ssa-2026-contribution-benefit-base",
  "wa-cares-uncapped",
  "pub15-2026-lookback-period",
  "pub15-2026-schedule-b-required",
  "pub15-2026-semiweekly-spanning-quarters",
  "irc-6651-failure-to-file",
  "irc-6656-deposit-penalty",
  "irc-7501-trust-fund-payroll",
] as const;

/**
 * Everything a reader of the 941 screen should be able to click through to:
 * the seven new texts plus the ten borrowed ones, in that order.
 *
 * Throws rather than skipping if a borrowed id has gone missing. A citation
 * panel that quietly renders sixteen items when it was built to render
 * seventeen is standing rule 39's vacuous read wearing a different hat.
 */
export function form941Authorities(): readonly GuidanceAuthority[] {
  const borrowed = FORM_941_BORROWED_AUTHORITY_IDS.map((id) => {
    const found = PAYROLL_TAX_AUTHORITIES.find((a) => a.id === id);
    if (!found) {
      throw new Error(
        `form-941-authorities: borrowed authority "${id}" is no longer in PAYROLL_TAX_AUTHORITIES. ` +
          `Either restore it there or remove it from FORM_941_BORROWED_AUTHORITY_IDS - do not let ` +
          `the 941 screen silently cite one fewer source than it was built to cite.`,
      );
    }
    return found;
  });
  return [...FORM_941_AUTHORITIES, ...borrowed];
}

/**
 * Self-check: ids unique, nothing empty, no accidental duplication of a text
 * the shared registry already carries.
 *
 * Throws rather than returning a boolean (standing rule 48).
 */
export function assertForm941AuthoritiesAreWellFormed(): void {
  const seen = new Set<string>();
  for (const a of FORM_941_AUTHORITIES) {
    if (seen.has(a.id)) {
      throw new Error(`form-941-authorities: duplicate id "${a.id}".`);
    }
    seen.add(a.id);

    for (const [field, value] of [
      ["cite", a.cite],
      ["quote", a.quote],
      ["soWhat", a.soWhat],
      ["source", a.source],
    ] as const) {
      if (value.trim().length === 0) {
        throw new Error(`form-941-authorities: "${a.id}" has an empty ${field}.`);
      }
    }

    if (PAYROLL_TAX_AUTHORITIES.some((p) => p.id === a.id)) {
      throw new Error(
        `form-941-authorities: "${a.id}" also exists in PAYROLL_TAX_AUTHORITIES. One text, one home.`,
      );
    }
  }
}
