/**
 * src/lib/payroll/wa-quarterly-authorities.ts   (books-41)
 *
 * THE LAW BEHIND WASHINGTON'S TWO QUARTERLY RETURNS, TRANSCRIBED WORD FOR WORD.
 *
 * WHY THIS FILE EXISTS, VERBATIM (standing rule 1)
 *
 *   "Then - books-40: quarterly filings. 941 first, since it is due first and
 *    is mostly summation; then the ESD and L&I quarterly reports."
 *
 * and, on this slice specifically:
 *
 *   "The forms are an important step and I really want to make sure I
 *    understand everything that is happening on the forms in plain english."
 *
 * That second sentence set the shape of this file. It is not enough to quote
 * the statutes that create the duty; the quotes chosen here are the ones that
 * EXPLAIN A BOX. WAC 192-310-010(3)(b) is not background reading - it is
 * literally the column list of the 5208B wage detail, in the state's own words.
 * When Michael asks "why does this form want hours when the federal one does
 * not", the answer is a sentence he can read for himself, not my summary of it.
 *
 * WHAT IS DELIBERATELY *NOT* HERE (standing rule 25)
 *
 * `payroll-tax-authorities.ts` already carries eighteen Washington texts,
 * including RCW 50A.10.030 (PFML premiums), RCW 50B.04.080 (WA Cares),
 * RCW 51.16.035 (L&I classification), RCW 51.16.060 (L&I hours),
 * RCW 51.16.140 (the L&I half an employer may deduct), RCW 50.12.220 and
 * RCW 50.24.040 (ESD lateness and interest), and RCW 51.48.210 (L&I lateness).
 * `company-identity-authorities.ts` carries RCW 50.12.070 - the registration
 * duty and the statutory contents of the quarterly report. None of that is
 * repeated. This file quotes only what those two do not have: the RULE that
 * prescribes the forms and their due dates, the two statutes that make the
 * unemployment levies EMPLOYER-ONLY money, the half-cent rounding command that
 * the filed return actually depends on, the EAF's two component accounts, and
 * the L&I rules that define what a reportable hour is.
 *
 * `waQuarterlyAuthorities()` hands back this file's texts together with the
 * relevant ones already on file, so a reader gets the whole picture from one
 * call without the same paragraph being maintained in two places.
 *
 * TRANSCRIPTION NOTE. Every `quote` below was fetched from the live source on
 * the date this file was written and extracted mechanically rather than
 * retyped. Curly apostrophes are rendered as ASCII to match the rest of this
 * codebase; no other character has been changed, and nothing has been shortened
 * without an explicit ellipsis. Standing rule 24: the quote is sacred.
 */

import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import {
  ESD_DELINQUENT_TAX_RATE,
  ESD_PFML_2026_RATE,
  ESD_SUTA_RATE_STRUCTURE,
  LNI_PREMIUM_RATE_FORMULA,
  RCW_50_12_220_ESD_LATE,
  RCW_50_24_040_ESD_INTEREST,
  RCW_50A_10_030_PFML,
  RCW_50B_04_080_WA_CARES,
  RCW_51_16_035_LNI_CLASSIFICATION,
  RCW_51_16_060_LNI_HOURS,
  RCW_51_16_140_LNI_DEDUCTION,
  RCW_51_48_210_LNI_LATE,
  WA_CARES_UNCAPPED,
} from "@/lib/payroll/payroll-tax-authorities";

/* ══════════════════════════════════════════════════════════════════════════
 * §1  THE RULE THAT IS THE FORM
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * THE TAX REPORT. One sentence, and it is the whole of Form 5208A.
 *
 * Note what it asks for and what it does not. TOTAL WAGES PAID TO EVERY
 * EMPLOYEE - a single number for the business. No hours, no names. That is the
 * entire tax report; everything else on the screen exists to compute a rate
 * against this one figure.
 */
export const WAC_192_310_010_TAX_REPORT: GuidanceAuthority = {
  id: "wac-192-310-010-tax-report",
  kind: "regulation",
  cite: "WAC 192-310-010(3)(a)",
  quote:
    "Tax report. Each calendar quarter, every employer must file a tax report with the " +
    "commissioner. The report must list the total wages paid to every employee during that quarter.",
  soWhat:
    "This is Form 5208A in a single sentence, and it is worth reading closely because of how " +
    "little it asks for. The tax report is ONE number - total wages for the whole business. For " +
    "Greenway's Q2 2026 that number is 68,923.45, and every dollar ESD assessed for the quarter " +
    "is a percentage of it. There are no names on this report and no hours. That is what makes " +
    "the second report necessary, and it is why a mistake in the wage total is far more " +
    "expensive than a mistake in any one person's line: the total is what gets taxed.",
  source: "https://app.leg.wa.gov/WAC/default.aspx?cite=192-310-010",
};

/**
 * THE WAGE DETAIL. This is the 5208B column list, in the state's own words.
 *
 * Five things per person: full name, SSN, occupational code or job title, total
 * hours worked, wages paid. The federal 941 asks for NONE of these per person.
 * That difference is the single most useful fact for understanding why the
 * Washington filing needs the time clock and the 941 does not.
 */
export const WAC_192_310_010_WAGE_DETAIL: GuidanceAuthority = {
  id: "wac-192-310-010-wage-detail",
  kind: "regulation",
  cite: "WAC 192-310-010(3)(b)",
  quote:
    "Report of employees' wages. Each calendar quarter, every employer must file a report of " +
    "employees' wages with the commissioner. This report must list each employee by full name, " +
    "Social Security number, standard occupational classification code or job title, and total " +
    "hours worked and wages paid during that quarter.",
  soWhat:
    "Read this next to the 941 and the difference jumps out: the federal return never asks who " +
    "anybody is, and this one asks for five facts about every single person. Those five are " +
    "exactly the columns of the 5208B, and the fourth one - TOTAL HOURS WORKED - is why the time " +
    "clock is a compliance system and not merely a way to calculate pay. Ten people appear on " +
    "Greenway's Q2 2026 detail and their hours add to 3,558. If the hours are wrong the wage " +
    "report is wrong even when every paycheque was right, and the same 3,558 has to appear on " +
    "the L&I return, where it is what the premium is actually charged on.",
  source: "https://app.leg.wa.gov/WAC/default.aspx?cite=192-310-010",
};

/**
 * THE DUE DATE, INCLUDING THE WEEKEND SHIFT AND THE POSTMARK RULE.
 *
 * Quoted in full rather than reduced to "the last day of the following month",
 * because the three sentences after that phrase each change the answer on some
 * quarter: the weekend/holiday shift moves the date, the postmark rule decides
 * whether a mailed return was late, and exceptions require advance approval.
 */
export const WAC_192_310_010_DUE_DATES: GuidanceAuthority = {
  id: "wac-192-310-010-due-dates",
  kind: "regulation",
  cite: "WAC 192-310-010(3)(d)",
  quote:
    "Due dates. The quarterly tax and wage reports are due by the last day of the month " +
    "following the end of the calendar quarter being reported. Calendar quarters end on March " +
    "31st, June 30th, September 30th and December 31st of each year. So, reports are due by " +
    "April 30th, July 31st, October 31st, and January 31st, in that order. If these dates fall " +
    "on a Saturday, Sunday, or a legal holiday, the reports will be due on the next business " +
    "day. Reports submitted by mail will be considered filed on the postmarked date. The " +
    "commissioner must approve exceptions to the time and method of filing in advance.",
  soWhat:
    "Same four dates as the federal 941, which is convenient and also a trap: the 941 has a " +
    "SECOND, later date you can earn by depositing on time, and this rule has no such thing. " +
    "There is one date here and it does not move for good behaviour. It does move for weekends " +
    "- 31 October 2027 is a Sunday, so that quarter is due 1 November 2027 - and the engine " +
    "computes that shift rather than assuming the calendar date. The postmark sentence matters " +
    "if a return is ever mailed: posting it on the due date counts, whereas an electronic filing " +
    "counts when it arrives.",
  source: "https://app.leg.wa.gov/WAC/default.aspx?cite=192-310-010",
};

/**
 * THE QUARTER YOU STOP TRADING IS DUE IMMEDIATELY, NOT ON THE USUAL DATE.
 *
 * Included because it is the one deadline in this file that is not a date at
 * all, and because "immediately" is genuinely what it says.
 */
export const WAC_192_310_010_TERMINATION: GuidanceAuthority = {
  id: "wac-192-310-010-termination",
  kind: "regulation",
  cite: "WAC 192-310-010(3)(e)",
  quote:
    "Each employer who stops doing business or whose account is closed by the department must " +
    "immediately file: (i) A tax report for the current calendar quarter which covers tax " +
    "payments due on the date the account is closed; and (ii) A report of employees' wages for " +
    "the current calendar quarter which includes all wages paid as of the date the account is " +
    "closed.",
  soWhat:
    "The word is IMMEDIATELY, not 'by the usual due date'. If Greenway ever closed or sold, or " +
    "if ESD closed the account, the part-quarter return would be due at once rather than at the " +
    "end of the following month. Recorded now because this is precisely the rule nobody looks up " +
    "at the time it applies, when there is a great deal else going on.",
  source: "https://app.leg.wa.gov/WAC/default.aspx?cite=192-310-010",
};

/* ══════════════════════════════════════════════════════════════════════════
 * §2  WHOSE MONEY IT IS - AND THE ROUNDING THE RETURN DEPENDS ON
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * UNEMPLOYMENT TAX IS THE EMPLOYER'S MONEY. TAKING IT FROM A WORKER IS UNLAWFUL.
 *
 * Blunt, and worth having in the codebase verbatim: the statute does not say
 * "should not", it says "shall not", and then says any deduction in violation
 * "shall be unlawful".
 */
export const RCW_50_24_010_NO_DEDUCTION: GuidanceAuthority = {
  id: "rcw-50-24-010-no-deduction",
  kind: "statute",
  cite: "RCW 50.24.010",
  quote:
    "Contributions shall become due and be paid by each employer to the treasurer for the " +
    "unemployment compensation fund in accordance with such regulations as the commissioner may " +
    "prescribe, and shall not be deducted, in whole or in part, from the remuneration of " +
    "individuals in employment of the employer. Any deduction in violation of the provisions of " +
    "this section shall be unlawful.",
  soWhat:
    "Unemployment tax is Greenway's cost, not a withholding. Nobody's paycheque may be reduced " +
    "by any part of it, and the statute uses the word 'unlawful' rather than merely forbidding " +
    "it. This is the cleanest dividing line on the whole quarterly screen: the ESD tax lines and " +
    "the L&I employer share are company expenses, while PFML, WA Cares and the L&I employee " +
    "share are money already taken from staff and merely being passed on. Confusing the two " +
    "directions is how an employer ends up owing the tax AND owing the workers.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50.24.010",
};

/**
 * THE HALF-CENT RULE. The reason the filed return says 275.70 and a single
 * combined rate says 275.69.
 *
 * This sentence is why the engine rounds each account separately: the command
 * is about "the payment of any contributions" under this section, and the EAF
 * is a different section with its own identical command.
 */
export const RCW_50_24_010_ROUNDING: GuidanceAuthority = {
  id: "rcw-50-24-010-rounding",
  kind: "statute",
  cite: "RCW 50.24.010",
  quote:
    "In the payment of any contributions, a fractional part of a cent shall be disregarded " +
    "unless it amounts to one-half cent or more, in which case it shall be increased to one cent.",
  soWhat:
    "A one-sentence rounding rule that decides a real cent on Greenway's filed return. " +
    "Unemployment tax at 0.37% of 68,923.45 is 255.016765, which this sentence turns into " +
    "255.02. The EAF has its own identical sentence in its own statute, and 0.03% of the same " +
    "wages is 20.677035, which becomes 20.68. Add the two ROUNDED figures and you get 275.70, " +
    "which is what was filed. Add the rates first and round once and you get 275.69. The law " +
    "rounds twice because there are two funds, so the software rounds twice.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50.24.010",
};

/**
 * THE EAF, FIRST ACCOUNT: two one-hundredths of one percent.
 *
 * The surcharge is not one levy. It is two statutory accounts that happen to be
 * collected together, and neither the statute nor the notice ever states the
 * sum - so the sum is done here, in the open.
 */
export const RCW_50_24_014_EAF_ACCOUNT_A: GuidanceAuthority = {
  id: "rcw-50-24-014-eaf-account-a",
  kind: "statute",
  cite: "RCW 50.24.014(1)(a)",
  quote:
    "A separate and identifiable account to provide for the financing of special programs to " +
    "assist the unemployed is established in the administrative contingency fund. ... " +
    "Contributions to this account shall accrue and become payable by each employer, except " +
    "employers as described in RCW 50.44.010 and 50.44.030 who have properly elected to make " +
    "payments in lieu of contributions, taxable local government employers as described in RCW " +
    "50.44.035, and those employers who are required to make payments in lieu of contributions, " +
    "at a basic rate of two one-hundredths of one percent. The amount of wages subject to tax " +
    "shall be determined under RCW 50.24.010.",
  soWhat:
    "Two one-hundredths of one percent is 0.02%. This is the larger half of the 0.03% EAF line " +
    "on the return. Note the last sentence: the wages this is charged on are defined by the " +
    "unemployment statute, so the EAF rides on exactly the same wage base as the UI tax and " +
    "cannot quietly diverge from it.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50.24.014",
};

/**
 * THE EAF, SECOND ACCOUNT: one one-hundredth of one percent.
 */
export const RCW_50_24_014_EAF_ACCOUNT_B: GuidanceAuthority = {
  id: "rcw-50-24-014-eaf-account-b",
  kind: "statute",
  cite: "RCW 50.24.014(1)(b)",
  quote:
    "A separate and identifiable account is established in the administrative contingency fund " +
    "for financing the employment security department's administrative costs under RCW 50.22.150 " +
    "and 50.22.155 and the costs under RCW 50.22.150(11) and 50.22.155 (1)(m) and (2)(m). ... " +
    "Contributions to this account shall accrue and become payable by each employer, ... and " +
    "those qualified employers assigned rate class 20 or rate class 40, as applicable, under RCW " +
    "50.29.025, at a basic rate of one one-hundredth of one percent. The amount of wages subject " +
    "to tax shall be determined under RCW 50.24.010.",
  soWhat:
    "One one-hundredth of one percent is 0.01%. Add it to the 0.02% above and the EAF's 0.03% " +
    "stops being a number somebody has to take on trust and becomes an arithmetic fact with two " +
    "statutory citations behind it. Both accounts are also subject to the same rate-class " +
    "exclusions, which is why the rate is a fact about Greenway's own notice rather than a " +
    "universal constant.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50.24.014",
};

/**
 * THE EAF MAY NOT BE DEDUCTED EITHER, AND IT ROUNDS ON ITS OWN.
 *
 * Both subsections in one authority because they are two halves of the same
 * point: this is separate money, so it follows the separate-money rules.
 */
export const RCW_50_24_014_EAF_NO_DEDUCTION_AND_ROUNDING: GuidanceAuthority = {
  id: "rcw-50-24-014-eaf-no-deduction-and-rounding",
  kind: "statute",
  cite: "RCW 50.24.014(2)(a), (2)(b)",
  quote:
    "Contributions under this section shall become due and be paid by each employer under rules " +
    "as the commissioner may prescribe, and shall not be deducted, in whole or in part, from the " +
    "remuneration of individuals in the employ of the employer. Any deduction in violation of " +
    "this section is unlawful. ... In the payment of any contributions under this section, a " +
    "fractional part of a cent shall be disregarded unless it amounts to one-half cent or more, " +
    "in which case it shall be increased to one cent.",
  soWhat:
    "The EAF carries its own copy of both rules, and the second one is the authority for " +
    "rounding the EAF separately from the UI tax. 'Under this section' is doing the work: the " +
    "EAF is a different section from the unemployment tax, so its cent is decided on its own " +
    "figure. That is the whole reason Greenway's filed total is 275.70 rather than 275.69.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50.24.014",
};

/* ══════════════════════════════════════════════════════════════════════════
 * §3  THE PAID-LEAVE RULES THAT DECIDE GREENWAY'S NUMBERS
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * WHY GREENWAY'S EMPLOYER PFML LINE IS 0.00 AND NOT 222.51.
 *
 * A zero on a return always looks like something was forgotten. This sentence
 * is the evidence that it was not.
 */
export const RCW_50A_10_030_SMALL_EMPLOYER: GuidanceAuthority = {
  id: "rcw-50a-10-030-small-employer",
  kind: "statute",
  cite: "RCW 50A.10.030(5)(a), (5)(b)",
  quote:
    "Employers with fewer than 50 employees employed in the state are not required to pay the " +
    "employer portion of premiums for family and medical leave. ... If an employer with fewer " +
    "than 50 employees elects to pay the premiums, the employer is then eligible for assistance " +
    "under RCW 50A.24.030.",
  soWhat:
    "Greenway employs ten people, so the employer share of Paid Leave is not owed and the filed " +
    "Q2 2026 return shows 0.00 for it. That zero is a legal position, not a gap: had it been " +
    "owed it would have been 28.57% of the 778.83 premium, or 222.51. The second sentence is a " +
    "genuine choice rather than a trap - a small employer who volunteers to pay becomes eligible " +
    "for state grants when staff take leave - but it is a choice with a cost, and the software " +
    "will never make it silently.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50A.10.030",
};

/**
 * HOW "FEWER THAN 50" IS ACTUALLY MEASURED. Not today's headcount.
 *
 * This is the sentence that turns the exemption from a fact into a forecast:
 * the size that governs next year is fixed on 30 September of this year, from
 * an average of four quarter-end counts.
 */
export const RCW_50A_10_030_SIZE_TEST: GuidanceAuthority = {
  id: "rcw-50a-10-030-size-test",
  kind: "statute",
  cite: "RCW 50A.10.030(7)(c)",
  quote:
    "On September 30th of each year, the department shall average the number of employees " +
    "reported by an employer on the last day of each quarter over the last four completed " +
    "calendar quarters to determine the size of the employer for the next calendar year for the " +
    "purposes of this section, RCW 50A.24.010, and 50A.24.030.",
  soWhat:
    "The exemption is not tested on the day the return is filed. It is tested once a year, on 30 " +
    "September, using the average of the headcounts reported on the last day of the four " +
    "previous quarters - and the result governs the WHOLE of the following calendar year. Two " +
    "practical consequences. Growing past fifty does not create a bill mid-year; it creates one " +
    "next January. And the numbers that decide it are the ones on these very returns, which " +
    "means the quarterly headcount is not a throwaway field. At ten employees Greenway has a " +
    "wide margin, and the software states the margin rather than merely asserting the exemption.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50A.10.030",
};

/**
 * THE EMPLOYER IS THE EMPLOYEES' AGENT FOR THIS MONEY.
 *
 * The federal trust-fund idea (IRC 7501, already on file) has a Washington
 * counterpart, and it is worth quoting because it explains why the PFML and WA
 * Cares lines are not really Greenway's money at any point.
 */
export const RCW_50A_10_030_AGENT_AND_TRUST: GuidanceAuthority = {
  id: "rcw-50a-10-030-agent-and-trust",
  kind: "statute",
  cite: "RCW 50A.10.030(7)(a), (7)(b), (9)",
  // books-45. THE ELISION AFTER "to the department." IS REQUIRED, and its
  // absence was a real defect that went unnoticed for as long as this quote has
  // existed - because RCW 50A.10.030 was not mirrored, so nothing could check it.
  //
  // (7)(a) ends at "remit the amounts collected to the department." and (7)(b)
  // then STARTS A NEW SUBSECTION with "In collecting employee premiums...".
  // Running them together implied the legislature wrote one continuous sentence.
  // It did not. Every word here is the statute's own, in the statute's own
  // order, but the seam between two separately-numbered subsections has to be
  // shown, or the reader is told something about the text that is not true.
  //
  // This is exactly what mirroring buys: the moment the source landed on disk,
  // the verifier reported "matches the first 163 characters, then diverges" -
  // 163 being the precise length of (7)(a). The machine found a punctuation-
  // level misrepresentation no human review had caught.
  quote:
    "The employer must collect from the employees the premiums provided under this section " +
    "through payroll deductions and remit the amounts collected to the department. ... " +
    "In collecting employee premiums through payroll deductions, the employer shall act as " +
    "the agent of the employees and shall remit the amounts to the department as required by " +
    "this title. ... " +
    "Premiums collected under this section are placed in trust for the employees and employers " +
    "that the program is intended to assist.",
  soWhat:
    "Two words carry this: AGENT and TRUST. When Greenway takes 556.32 of Paid Leave premium out " +
    "of ten paycheques, that money is being held on the staff's behalf, in the same spirit as " +
    "the federal trust-fund taxes. It is never available to fund the business, even briefly, " +
    "even with every intention of paying it across next week. This is why the quarterly screen " +
    "separates 'money you already took from people' from 'money you owe' rather than showing one " +
    "total to remit.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50A.10.030",
};

/**
 * THE PFML WAGE CAP IS THE SOCIAL SECURITY WAGE BASE - BY REFERENCE.
 *
 * Quoted because it is the authority for a cap that is never printed on the
 * PFML form itself, and because it is the sharpest contrast with WA Cares.
 */
export const RCW_50A_10_030_WAGE_CAP: GuidanceAuthority = {
  id: "rcw-50a-10-030-wage-cap",
  kind: "statute",
  cite: "RCW 50A.10.030(4)",
  quote:
    "The commissioner must annually set a maximum limit on the amount of wages that is subject " +
    "to a premium assessment under this section that is equal to the maximum wages subject to " +
    "taxation for social security as determined by the social security administration.",
  soWhat:
    "Paid Leave stops at the same ceiling as Social Security - 184,500.00 for 2026 - and it does " +
    "so by reference, so the cap moves every time the SSA moves it. Set this beside WA Cares, " +
    "which has NO cap at all: two Washington premiums, on the same definition of wages, in the " +
    "same agency's system, and only one of them stops. Nobody at Greenway is near 184,500 in a " +
    "quarter, so the cap does not bite today, and the engine still applies it rather than " +
    "assuming it never will.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50A.10.030",
};

/* ══════════════════════════════════════════════════════════════════════════
 * §4  THE L&I SIDE - WHERE THE UNIT IS AN HOUR, NOT A DOLLAR
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * "UNIT OF EXPOSURE" - the phrase that explains why L&I ignores wages.
 */
export const WAC_296_17_31021_UNIT_OF_EXPOSURE: GuidanceAuthority = {
  id: "wac-296-17-31021-unit-of-exposure",
  kind: "regulation",
  cite: "WAC 296-17-31021(1)",
  quote:
    "A unit of exposure is the measure which is used to help determine the premium you will pay. " +
    "For most businesses the unit of exposure is the hours worked by their employees. Because " +
    "not all employees are compensated based on the hours they work, we have developed reporting " +
    "alternatives to make reporting to us easier.",
  soWhat:
    "The reason the L&I return looks nothing like the other three. Workers' compensation is " +
    "insurance against injury, and an hour on the shop floor is an hour of exposure to injury " +
    "whether the person earning it is paid minimum wage or three times that. So the premium is " +
    "charged per HOUR: Greenway's Q2 2026 bill is 3,558 hours times 0.5593, and the 68,923.45 of " +
    "wages that drives all three ESD lines never enters the calculation. A raise changes three " +
    "of Washington's four quarterly numbers and leaves this one untouched.",
  source: "https://app.leg.wa.gov/WAC/default.aspx?cite=296-17-31021",
};

/**
 * THE SALARIED-EMPLOYEE ELECTION, AND ITS ALL-OR-NOTHING CONDITION.
 *
 * Directly relevant to Michael: the owner is paid annually rather than hourly,
 * so the question of how a non-hourly person's hours get reported is a live one
 * at Greenway rather than a hypothetical.
 */
export const WAC_296_17_31021_SALARIED: GuidanceAuthority = {
  id: "wac-296-17-31021-salaried",
  kind: "regulation",
  cite: "WAC 296-17-31021(2)",
  quote:
    "Salaried employees: You must select one of the following methods to report your salaried " +
    "employees: Actual hours worked; or Assumed hours of one hundred-sixty hours per month. All " +
    "salaried employees of an employer must be reported by the same method. You cannot report " +
    "some salaried employees based on the actual hours they work and others using the one " +
    "hundred sixty hours per month method.",
  soWhat:
    "A real choice with a real constraint. Anyone salaried may be reported either at their " +
    "actual hours or at a flat 160 per month - but the choice is made ONCE for everybody " +
    "salaried, not person by person, and mixing the two methods is expressly forbidden. This " +
    "matters at Greenway because the owner is paid annually rather than clocked, so the software " +
    "must know which method is in force before it can put a defensible hour count on the L&I " +
    "return. It will ask rather than assume, because assuming 160 for a working owner overstates " +
    "the premium and assuming zero understates it.",
  source: "https://app.leg.wa.gov/WAC/default.aspx?cite=296-17-31021",
};

/**
 * A QUARTER WITH NO PAYROLL IS STILL A RETURN - AND THE PRICE OF SILENCE.
 *
 * The second half is the part with teeth: L&I does not merely fine you, it
 * ESTIMATES the premium and then collects the estimate.
 */
export const WAC_296_17_31023_NO_PAYROLL: GuidanceAuthority = {
  id: "wac-296-17-31023-no-payroll",
  kind: "regulation",
  cite: "WAC 296-17-31023",
  quote:
    "If you do not have employees during a quarter, you must report by the due date and indicate " +
    "\"no payroll\" or \"no employees\". If you do not submit reports when required, we will " +
    "estimate premiums and initiate legal action against you to collect premiums due.",
  soWhat:
    "Exactly the same shape as the federal rule that a quiet quarter still needs a 941, and with " +
    "a sharper edge. Not filing does not leave a blank in L&I's records - it prompts L&I to " +
    "invent a number and pursue it, and an estimate made without your figures will not be " +
    "generous. Filing a nil return takes a minute; disputing an estimated assessment does not. " +
    "This is why the screen offers to build a 'no payroll' return rather than showing an empty " +
    "page.",
  source: "https://app.leg.wa.gov/WAC/default.aspx?cite=296-17-31023",
};

/* ══════════════════════════════════════════════════════════════════════════
 * §5  THE REGISTRY
 * ══════════════════════════════════════════════════════════════════════════ */

/** Only the texts this slice adds. */
export const WA_QUARTERLY_OWN_AUTHORITIES: readonly GuidanceAuthority[] = [
  WAC_192_310_010_TAX_REPORT,
  WAC_192_310_010_WAGE_DETAIL,
  WAC_192_310_010_DUE_DATES,
  WAC_192_310_010_TERMINATION,
  RCW_50_24_010_NO_DEDUCTION,
  RCW_50_24_010_ROUNDING,
  RCW_50_24_014_EAF_ACCOUNT_A,
  RCW_50_24_014_EAF_ACCOUNT_B,
  RCW_50_24_014_EAF_NO_DEDUCTION_AND_ROUNDING,
  RCW_50A_10_030_SMALL_EMPLOYER,
  RCW_50A_10_030_SIZE_TEST,
  RCW_50A_10_030_AGENT_AND_TRUST,
  RCW_50A_10_030_WAGE_CAP,
  WAC_296_17_31021_UNIT_OF_EXPOSURE,
  WAC_296_17_31021_SALARIED,
  WAC_296_17_31023_NO_PAYROLL,
] as const;

/**
 * The texts already on file that a reader of the quarterly screen needs, pulled
 * in by reference rather than copied.
 *
 * Standing rule 25 in practice. Every one of these is maintained in
 * `payroll-tax-authorities.ts`; if a rate or a penalty changes there, this list
 * follows automatically instead of drifting.
 */
export const WA_QUARTERLY_BORROWED_AUTHORITIES: readonly GuidanceAuthority[] = [
  ESD_SUTA_RATE_STRUCTURE,
  RCW_50A_10_030_PFML,
  ESD_PFML_2026_RATE,
  RCW_50B_04_080_WA_CARES,
  WA_CARES_UNCAPPED,
  RCW_51_16_035_LNI_CLASSIFICATION,
  RCW_51_16_060_LNI_HOURS,
  RCW_51_16_140_LNI_DEDUCTION,
  LNI_PREMIUM_RATE_FORMULA,
  RCW_50_12_220_ESD_LATE,
  RCW_50_24_040_ESD_INTEREST,
  ESD_DELINQUENT_TAX_RATE,
  RCW_51_48_210_LNI_LATE,
] as const;

/**
 * Everything a reader of the Washington quarterly screen may need, in one call.
 *
 * Own texts first, then the borrowed ones, so the reading order matches the
 * order the screen teaches in: what the form is, whose money it is, then what
 * happens if it is late.
 */
export function waQuarterlyAuthorities(): readonly GuidanceAuthority[] {
  return [...WA_QUARTERLY_OWN_AUTHORITIES, ...WA_QUARTERLY_BORROWED_AUTHORITIES];
}

/** Look one up by id, across both sets. */
export function findWaQuarterlyAuthority(id: string): GuidanceAuthority | undefined {
  return waQuarterlyAuthorities().find((a) => a.id === id);
}

/**
 * Every id this slice can cite. Used by the mentor gate to prove no lesson
 * points at an authority that does not exist.
 */
export function waQuarterlyAuthorityIds(): readonly string[] {
  return waQuarterlyAuthorities().map((a) => a.id);
}
