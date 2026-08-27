/**
 * src/lib/payroll/form-box-lessons-941.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FORM 941 — WHAT A CPA KNOWS ABOUT EVERY LINE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael's instruction for this slice, verbatim:
 *
 *   "I want to be able to see the form, and click a box to have it teach me all
 *   there is to know about that box. It should be thorough and verbatim and
 *   plain English explain actions. It should teach me how to read them and use
 *   them as a tool. Everything a cpa would know about these forms, I want to
 *   know to."
 *
 * WHAT FORM 941 ACTUALLY IS. The quarterly federal payroll return. Four times a
 * year Greenway tells the IRS three things: how much it paid people, how much it
 * withheld from them, and how much it owes. It is filed four times and then the
 * W-2s at year end must agree with the four of them added together.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE IDEA THAT MAKES THE WHOLE FORM MAKE SENSE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Social Security and Medicare are paid TWICE on the same wages - once by the
 * employee (withheld from their cheque) and once by Greenway (its own money, on
 * top of the wage). That is why line 5a is multiplied by 12.4% rather than 6.2%,
 * and line 5c by 2.9% rather than 1.45%. The IRS instructions print the
 * multiplier as "x 0.124" right on the form, and the first time a reader sees
 * that number it looks like a mistake. It is not: it is 6.2% + 6.2%.
 *
 * Every quote below is VERBATIM from the mirrored 2026 instructions at
 * docs/authorities/federal/irs-instructions-941-2026.txt. Rule 24: verbatim
 * authority or no feature. Rule 35: the quotes are verified by a gate that reads
 * that file, not by careful typing.
 *
 * WHY THE QUOTES ARE SHORT. The wall-of-words problem Michael described comes
 * from dumping a whole instruction page into a panel. Each quote here is the
 * SENTENCE THAT DECIDES THE QUESTION, and `soWhat` translates it. The full
 * document is one click away for anyone who wants it.
 */

import type { BoxLesson } from "./form-box-core";

/** The mirrored corpus. A gate reads this file to verify every quote. */
export const FORM_941_SOURCE_PATH = "docs/authorities/federal/irs-instructions-941-2026.txt";
/** Where Michael reads the real thing. Rendered as an href. */
export const FORM_941_SOURCE_URL = "https://www.irs.gov/pub/irs-pdf/i941.pdf";

/**
 * The 2026 Social Security wage base, quoted from the instructions.
 *
 * Held as a named constant so the lessons and the worked examples cannot drift
 * apart, and so the gate can assert the figure appears in the mirrored source.
 * NOT used for any calculation - the engine owns the arithmetic. This is for
 * teaching text only.
 */
export const SS_WAGE_BASE_2026_DOLLARS = 184_500;

export const FORM_941_LESSONS: readonly BoxLesson[] = [
  {
    formId: "form_941",
    box: "1",
    headline: "How many people were on the payroll — on one specific day",
    plainEnglish:
      "A headcount, not an amount of money. It is the only box on this form that is not dollars. " +
      "And it is not the number of people you employed during the quarter, nor the number you paid: " +
      "it is the number on the payroll for the pay period that INCLUDES ONE PARTICULAR DAY — the " +
      "12th of the last month of the quarter.",
    whereItComesFrom:
      "Counted from the pay run covering March 12, June 12, September 12 or December 12, depending " +
      "on which quarter this return is for. Greenway's biweekly Friday schedule means you have to " +
      "find the period that CONTAINS that date, which is rarely the period that ends on it.",
    howToReadIt:
      "Read it as a staffing snapshot the government can compare across quarters. If this number " +
      "swings while your wage total stays flat, you are running more people on fewer hours each — " +
      "or fewer people on overtime. Both are worth knowing, and this is the only box on any payroll " +
      "form that tells you.",
    commonMistake:
      "Entering the headcount for the whole quarter, or for the day you happen to prepare the " +
      "return. Someone hired on the 15th does not count; someone who quit on the 20th does. The " +
      "date is fixed by the instructions and it is not the date you are working on.",
    whatToDo:
      "Open the pay run that contains the 12th of the quarter's final month and count the people on " +
      "it. Exclude anyone in nonpay status for that period.",
    examples: [
      {
        title: "Q1 2027 — finding the right pay period",
        steps: [
          "Q1's final month is March, so the target date is 12 March 2027.",
          "12 March 2027 is a Friday, and Greenway pays biweekly on Fridays.",
          "If a pay period runs Sunday 28 February to Saturday 13 March, that period CONTAINS 12 March.",
          "Count everyone on the payroll for that period — including anyone who worked zero hours but was still employed and in pay status.",
        ],
        answer: "12",
        moral:
          "The pay period that contains the 12th is what counts, not the period that ends nearest to it.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 1",
        quote:
          "Enter the number of employees on your payroll for the pay\nperiod including March 12, June 12, September 12, or\nDecember 12, for the quarter indicated at the top of Form\n941. Don’t include:\n• Household employees,\n• Employees in nonpay status for the pay period,\n• Farm employees,\n• Pensioners, or\n• Active members of the U.S. Armed Forces.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "The date is not negotiable and it is not the date you file. Find the pay period containing " +
          "the 12th of the quarter's last month.",
      },
    ],
    tiesTo: [],
  },

  {
    formId: "form_941",
    box: "2",
    headline: "Total wages — and this must equal the W-2 box 1 figures added up",
    plainEnglish:
      "Everything you paid people that counts as taxable compensation for income tax: wages, " +
      "bonuses, tips they reported, and taxable fringe benefits. This is the box the IRS " +
      "instructions tie DIRECTLY to box 1 of the W-2 — same money, quarterly instead of annually.",
    whereItComesFrom:
      "The sum of every pay run's taxable-for-income-tax gross in the quarter, taken from the " +
      "year-to-date accumulators. For Michael specifically it includes the company-paid health " +
      "premium for a 2%-or-more shareholder-employee, which is wages here even though it is NOT " +
      "wages on lines 5a and 5c.",
    howToReadIt:
      "This is your quarterly labour cost before Greenway's own payroll taxes. Divide by the line 1 " +
      "headcount and you have average pay per person for the quarter — the single most useful " +
      "number on the form for running the business rather than filing it.",
    commonMistake:
      "Making this agree with line 5a. For an ordinary employee they do agree, which is exactly why " +
      "the difference looks like an error on Michael's own numbers. Company-paid health premiums for " +
      "a 2%-or-more shareholder are in line 2 and NOT in 5a or 5c. Forcing them to match either " +
      "overpays Social Security and Medicare or understates his income.",
    whatToDo:
      "At year end, add line 2 from all four quarters and compare to the total of box 1 on every " +
      "W-2. They must be equal. If they are not, the difference is a real error in one of the five " +
      "documents, and finding it in January is far cheaper than being told in August.",
    examples: [
      {
        title: "Why line 2 is bigger than line 5a on Michael's return",
        steps: [
          "Ordinary staff wages for the quarter: $84,000.00.",
          "Michael's own salary for the quarter: $15,000.00.",
          "Company-paid health premium for Michael (a 2%-or-more shareholder): $1,800.00.",
          "Line 2 = 84,000 + 15,000 + 1,800 = $100,800.00 — the premium IS wages for income tax.",
          "Line 5a = 84,000 + 15,000 = $99,000.00 — the premium is NOT Social Security wages.",
        ],
        answer: "$100,800.00",
        moral:
          "A $1,800 gap between line 2 and line 5a is not a mistake. It is the shareholder health " +
          "premium, and it is supposed to be there.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 2",
        quote:
          "Enter amounts on line 2 that would also be included in\nbox 1 of your employees\u2019 Forms W-2.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "This is the IRS stating the cross-check itself. Four line 2s must equal the total of every " +
          "W-2 box 1 — the reconciliation is not our invention, it is theirs.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "1",
        why:
          "Same money. The four quarterly line 2 figures added together must equal the sum of box 1 " +
          "on every W-2 for the year. The instructions say so in as many words.",
      },
    ],
  },

  {
    formId: "form_941",
    box: "3",
    headline: "Federal income tax you withheld and are holding in trust",
    plainEnglish:
      "The income tax taken out of your employees' cheques this quarter. This is not Greenway's " +
      "money and never was — you withheld it as the government's collecting agent and you are " +
      "holding it until you deposit it.",
    whereItComesFrom:
      "The sum of federal income tax withheld across the quarter's pay runs, computed per person " +
      "from their Form W-4 and the Publication 15-T tables.",
    howToReadIt:
      "Compare it to line 2. The ratio is your workforce's effective federal withholding rate. If " +
      "it moves sharply without a change in pay, someone filed a new W-4 — which is legitimate, but " +
      "worth knowing rather than discovering.",
    commonMistake:
      "Treating this as a tax Greenway owes and can manage. It is not a liability you can negotiate " +
      "or defer; it is somebody else's money in your custody. The IRS treats a shortfall here far " +
      "more seriously than an ordinary business debt for exactly that reason.",
    whatToDo:
      "Never let this money fund anything. It leaves on the deposit schedule and nothing else " +
      "touches it in the meantime.",
    examples: [],
    quotes: [],
    tiesTo: [
      {
        formId: "form_w2",
        box: "2",
        why:
          "Four quarters of line 3 must equal the total of box 2 on every W-2. Same withheld income " +
          "tax, reported quarterly and then annually.",
      },
    ],
  },

  {
    formId: "form_941",
    box: "5a",
    headline: "Social Security wages — the box with a ceiling, taxed at 12.4%",
    plainEnglish:
      "Wages subject to Social Security tax. Two things make this box different from every other " +
      `wage box. First, it STOPS: once a person's Social Security wages reach $${SS_WAGE_BASE_2026_DOLLARS.toLocaleString(
        "en-US",
      )} ` +
      "for the year, you stop adding their pay here. Second, the rate printed beside it is 12.4%, " +
      "not 6.2%, because the tax is paid twice on the same wage — once by the employee and once by " +
      "Greenway.",
    whereItComesFrom:
      "Quarterly wages subject to Social Security, taken from the year-to-date accumulators, which " +
      "are what know whether anyone has crossed the annual ceiling. Excludes tips, which get their " +
      "own line (5b), and excludes the shareholder health premium.",
    howToReadIt:
      "If line 5a is LOWER than line 2, ask why, and there should always be a specific answer: " +
      "somebody hit the wage base, or there is a shareholder health premium, or there are reported " +
      "tips on line 5b. A gap with no explanation is an error you have not found yet.",
    commonMistake:
      "Continuing to accrue Social Security wages after an employee passes the annual base — or, " +
      "the reverse and far more common at Greenway's scale, stopping MEDICARE too. Medicare has no " +
      "ceiling. The instructions say to keep withholding income and Medicare tax for the whole year " +
      "even after the Social Security base is reached.",
    whatToDo:
      `Check whether anyone is near $${SS_WAGE_BASE_2026_DOLLARS.toLocaleString("en-US")} in ` +
      "Social Security wages before running the last pay period of the year, and confirm the " +
      "accumulators stopped 5a while leaving 5c alone.",
    examples: [
      {
        title: "The employer tax on $99,000 of Social Security wages",
        steps: [
          "Line 5a, column 1 (the wages): $99,000.00.",
          "The instructions print the multiplier as \u201cx 0.124\u201d.",
          "0.124 is 6.2% employee + 6.2% employer — the same wage taxed twice.",
          "$99,000.00 x 0.124 = $12,276.00 for column 2.",
          "Half of that ($6,138.00) was withheld from staff; the other half is Greenway's own cost.",
        ],
        answer: "$12,276.00",
        moral:
          "The 12.4% on the form is not a typo. Half of every Social Security dollar on this line is " +
          "Greenway's money, not your employees'.",
      },
      {
        title: "Someone crosses the wage base",
        steps: [
          `An employee reaches $${SS_WAGE_BASE_2026_DOLLARS.toLocaleString("en-US")} of Social Security wages in November.`,
          "From that point their pay stops being added to line 5a.",
          "Their pay KEEPS being added to line 5c (Medicare), which has no ceiling.",
          "Their pay also keeps being added to line 2, and to box 1 of their W-2.",
        ],
        answer: "5a stops; 5c and line 2 continue",
        moral:
          "One employee can make lines 2, 5a and 5c three different numbers, all correct at the same " +
          "time.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 5a",
        quote:
          "For 2026, the rate of social security tax on taxable\nwages is 6.2% (0.062) each for the employer and\nemployee.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "\u201cEach\u201d is the whole lesson. 6.2% twice is the 12.4% multiplier printed on the form.",
      },
      {
        cite: "IRS Instructions for Form 941 (2026), line 5a",
        quote:
          "However, continue to withhold income and Medicare taxes\nfor the whole year on all wages and tips, even when the\nsocial security wage base limit of $184,500 has been\nreached.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "Hitting the Social Security ceiling stops line 5a ONLY. Medicare and income tax carry on " +
          "unchanged. Stopping all three is the expensive version of this mistake.",
      },
      {
        cite: "IRS Instructions for Form 941 (2026), line 5a",
        quote: "Enter the amount before payroll deductions. Don’t\ninclude tips on this line.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "Gross, not net. A 401(k) deferral or an insurance deduction does not reduce this box, even " +
          "though it does reduce box 1 of the W-2.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "3",
        why:
          "Four quarters of line 5a must equal the total of box 3 on every W-2. Both are capped at " +
          "the same annual wage base per person.",
      },
    ],
  },

  {
    formId: "form_941",
    box: "5c",
    headline: "Medicare wages — no ceiling, ever, taxed at 2.9%",
    plainEnglish:
      "Wages subject to Medicare tax. The important difference from line 5a is that this box has NO " +
      "annual limit. Every dollar of wages is Medicare wages, however much someone earns. Like " +
      "Social Security it is paid twice, so the printed multiplier is 2.9% — 1.45% from the " +
      "employee and 1.45% from Greenway.",
    whereItComesFrom:
      "Quarterly wages subject to Medicare from the year-to-date accumulators. At Greenway this is " +
      "usually the same as line 5a plus anything above the Social Security base, and it still " +
      "excludes the shareholder health premium.",
    howToReadIt:
      "Line 5c should be greater than or equal to line 5a, always. If 5c is ever SMALLER, something " +
      "is wrong — there is no lawful way for Medicare wages to fall below Social Security wages.",
    commonMistake:
      "Applying the Social Security wage base to this line. There is no Medicare wage base. The " +
      "additional 0.9% Medicare surtax on high earners is also NOT here — that has its own line, " +
      "5d, and it is withheld from the employee only, with no employer match.",
    whatToDo:
      "Confirm line 5c is greater than or equal to line 5a on every return before you file it. It " +
      "is a two-second check that catches a whole class of accumulator error.",
    examples: [
      {
        title: "Medicare keeps counting after Social Security stops",
        steps: [
          `A shareholder-employee earns $200,000 in wages for the year — above the $${SS_WAGE_BASE_2026_DOLLARS.toLocaleString("en-US")} Social Security base.`,
          `Social Security wages for the year stop at $${SS_WAGE_BASE_2026_DOLLARS.toLocaleString("en-US")}.`,
          "Medicare wages for the year are the full $200,000.",
          "The $15,500 difference is taxed for Medicare and not for Social Security.",
        ],
        answer: "5c > 5a by $15,500",
        moral: "5c greater than 5a is normal for a well-paid employee. 5c less than 5a is never right.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 5c",
        quote: "5c. Taxable Medicare wages & tips. Enter all wages,\ntips, sick pay, and taxable fringe benefits that are subject\nto Medicare tax.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "\u201cAll\u201d — the instruction for this line begins where line 5a's ceiling ends. There is no " +
          "Medicare wage base to stop at.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "5",
        why:
          "Four quarters of line 5c must equal the total of box 5 on every W-2. Neither is capped, so " +
          "a difference here is always an error rather than a wage-base effect.",
      },
    ],
  },
  /*
   * ═══ THE TWELVE LINES ADDED IN books-53 ═══
   *
   * The lessons stopped at 5c. Every line below existed on the Form 941 Michael
   * actually files each quarter and this system could not explain any of them.
   *
   * Three of them are the ones that bite hardest, and none is obvious:
   *   - line 5d is the only payroll tax here with NO employer match;
   *   - lines 8 and 9 are normally NEGATIVE, which looks like an error;
   *   - line 16 asks for LIABILITY and is habitually filled with DEPOSITS,
   *     which can draw an averaged FTD penalty even when every dollar was paid
   *     on time.
   *
   * Every `quote:` below was sliced mechanically out of the mirrored
   * instructions by exact line range and escaped programmatically -- none was
   * retyped by hand, and each is re-verified byte for byte on every test run by
   * tests/compliance/form-box-lessons-941.test.ts and by
   * scripts/verify-verbatim-quotes.ts.
   */
  {
    formId: "form_941",
    box: "4",
    headline: "The exemption tickbox \u2014 almost certainly not you",
    plainEnglish:
      "A single checkbox, not an amount. You tick it only if NONE of the wages on line 2 are " +
      "subject to Social Security or Medicare tax. That is a rare situation \u2014 certain religious " +
      "employers, some student or foreign-worker arrangements. A cannabis retailer paying ordinary " +
      "wages in Washington does not tick this box.",
    whereItComesFrom:
      "Nowhere in the ledger. It is a statement about the legal character of the wages, not a " +
      "figure computed from them.",
    howToReadIt:
      "Blank on every Greenway return. If it is ever ticked, lines 5a through 5f should be empty " +
      "too \u2014 the box and those lines contradict each other otherwise.",
    commonMistake:
      "Ticking it because a particular PERSON is exempt, or because a particular payment is " +
      "exempt. The box asks whether NO wages at all are subject to those taxes. One exempt " +
      "employee among ten does not qualify; that person is simply excluded from 5a and 5c.",
    whatToDo:
      "Leave it blank, and treat a tick as a red flag to investigate rather than a setting to " +
      "adjust. If it is ever ticked while line 5a shows wages, stop and find out why.",
    examples: [
      {
        title: "Why one exempt person does not tick the box",
        steps: [
          "Suppose nine employees have ordinary taxable wages and one is genuinely exempt.",
          "Line 2 includes everyone's wages.",
          "Lines 5a and 5c include only the nine.",
          "The box asks whether NO wages are subject to the tax. Nine sets of wages are.",
        ],
        answer: "Leave line 4 blank",
        moral: "Line 4 is about the whole return, never about one person.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 4",
        quote: "If no wages, tips, and other compensation on line 2 are\nsubject to social security or Medicare tax, check the box\non line 4. If this question doesn\u2019t apply to you, leave the\nbox blank. For more information about exempt wages, see\nsection 15 of Pub. 15. For religious exemptions, see\nsection 4 of Pub. 15-A.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "Read the condition exactly: \u201cno wages, tips, and other compensation on line 2\u201d. It is " +
          "all-or-nothing, which is why one exempt employee is irrelevant to this box.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "5a",
        why:
          "The box and line 5a are mutually exclusive in practice. Wages on 5a mean the box " +
          "cannot be correctly ticked.",
      },
    ],
  },
  {
    formId: "form_941",
    box: "5b",
    headline: "Tips \u2014 counted even when you could not withhold on them",
    plainEnglish:
      "Social Security tax on reported tips. Tips are wages for this purpose. The hard part is " +
      "that tips can exceed the cash you actually control: an employee may report tips you never " +
      "handled, so there is nothing to withhold FROM. You still report them here.",
    whereItComesFrom:
      "Tips employees reported to you for the quarter. Not service charges \u2014 an amount the " +
      "business adds to a bill is revenue, and paying it out is a wage, not a tip.",
    howToReadIt:
      "Blank at Greenway unless tipping starts. If a figure appears, it shares line 5a's annual " +
      "ceiling: tips plus wages together stop at the Social Security base for each person.",
    commonMistake:
      "Two mistakes, and they pull in opposite directions. Putting service charges here, which " +
      "inflates it; and leaving off tips you could not withhold on, which understates it. The " +
      "instruction covers the second case explicitly \u2014 report them anyway, and use line 9 for " +
      "the employee share you could not collect.",
    whatToDo:
      "Decide whether a payment is a tip or a service charge before it reaches payroll, and keep " +
      "the two apart in the POS. Reversing that decision at quarter end is far more expensive " +
      "than making it correctly once.",
    examples: [
      {
        title: "A tip you cannot withhold on still gets reported",
        steps: [
          "An employee reports $200 of cash tips you never touched.",
          "You report the $200 on line 5b \u2014 it is Social Security wages.",
          "There is no cash of theirs in your hands to withhold the 6.2% from.",
          "The uncollected employee share is adjusted on line 9, not omitted from 5b.",
        ],
        answer: "5b includes the $200; line 9 carries the uncollected share",
        moral: "Reporting and collecting are two different obligations. Do not let a failure of the second erase the first.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 5b",
        quote: "5b. Taxable social security tips. Enter all tips your\nemployees reported to you during the quarter until the\ntotal of the tips and taxable wages, including wages\nreported on line 5a, for an employee reaches $184,500 for\nthe year. Include all tips your employee reported to you\neven if you were unable to withhold the employee tax of\n6.2%.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "The ceiling is shared with line 5a \u2014 \u201cthe total of the tips and taxable wages, including " +
          "wages reported on line 5a\u201d. Tips do not get their own separate wage base.",
      },
      {
        cite: "IRS Instructions for Form 941 (2026), line 5b",
        quote: "insurance, later. Don\u2019t include service charges on line 5b.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "A service charge is not a tip. If the business sets the amount and adds it to the " +
          "bill, it is revenue that becomes an ordinary wage when paid out.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "9",
        why:
          "Line 9 exists largely to carry the employee share of tip taxes that could not be " +
          "collected, which is why 5b can be right while the cash never balanced.",
      },
    ],
  },
  {
    formId: "form_941",
    box: "5d",
    headline: "The 0.9% surtax \u2014 the employee's alone, with no match",
    plainEnglish:
      "Wages above $200,000 for one person carry an extra 0.9% Medicare tax. This is the one " +
      "payroll tax on this form with NO employer half. You withhold it and remit it, but it is " +
      "not your cost, and Greenway matches nothing.",
    whereItComesFrom:
      "Year-to-date wages per person. You must start withholding in the pay period in which that " +
      "person's wages pass $200,000, and continue for the rest of the calendar year.",
    howToReadIt:
      "Blank unless someone is paid over $200,000. The printed multiplier is 0.009 \u2014 not doubled, " +
      "unlike 5a's 0.124 and 5c's 0.029. That single undoubled rate is the whole point of the line.",
    commonMistake:
      "Matching it. Every other Social Security and Medicare figure on this form is paid twice, " +
      "so the habit is to match automatically. Matching this one overstates your tax and " +
      "misstates whose money it is.",
    whatToDo:
      "Check whether any single person's year-to-date wages approach $200,000, and confirm the " +
      "threshold is applied per person and not to the payroll as a whole.",
    examples: [
      {
        title: "The threshold is per person, not per company",
        steps: [
          "Ten employees are paid $30,000 each \u2014 $300,000 of payroll in total.",
          "The company total is above $200,000, but no individual is.",
          "The threshold applies to each employee separately.",
          "Nobody crosses it, so nothing is withheld.",
        ],
        answer: "Line 5d is blank",
        moral: "A payroll total above the threshold means nothing. Only an individual crossing it does.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 5d",
        quote: "withholding Additional Medicare Tax in the pay period in\nwhich you pay wages in excess of $200,000 to an\nemployee and continue to withhold it each pay period until\nthe end of the calendar year. Additional Medicare Tax is\nonly imposed on the employee. There is no employer\nshare of Additional Medicare Tax.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "Two operative rules: begin in the pay period the wages exceed $200,000, and continue " +
          "to the end of the calendar year. It does not reset per pay period.",
      },
      {
        cite: "IRS Instructions for Form 941 (2026), line 5d",
        quote: "only imposed on the employee. There is no employer\nshare of Additional Medicare Tax. All wages that are\nsubject to Medicare tax are subject to Additional Medicare\nTax withholding if paid in excess of the $200,000\nwithholding threshold.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "\u201cThere is no employer share of Additional Medicare Tax.\u201d This is why the classification " +
          "for this line is the employee's money and not shared, unlike 5a and 5c.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "6",
        why:
          "The surtax is reported with ordinary Medicare tax in W-2 box 6, not separately, so " +
          "box 6 can exceed 1.45% of box 5 for a high earner without anything being wrong.",
      },
    ],
  },
  {
    formId: "form_941",
    box: "5f",
    headline: "Tax the IRS tells you that you owe \u2014 never a figure you compute",
    plainEnglish:
      "This line exists only when the IRS sends you a Section 3121(q) Notice and Demand. That " +
      "happens when employees under-reported tips to you: the IRS determines the amount and " +
      "bills you for the employer share. You copy the figure from the notice.",
    whereItComesFrom:
      "The notice itself, and nothing else. There is no calculation on your side and no ledger " +
      "account that produces it.",
    howToReadIt:
      "Blank on every return unless such a notice arrived that quarter. If a figure appears, the " +
      "paper notice should be in the file next to the return.",
    commonMistake:
      "Estimating it, or entering suspected unreported tips before a notice arrives. You are not " +
      "liable for the employer share on unreported tips UNTIL notice and demand is made. Entering " +
      "it early pays tax you do not yet owe.",
    whatToDo:
      "Leave it blank unless you are holding the notice. If one ever arrives, enter the amount " +
      "exactly as stated and keep the notice with the filed return.",
    examples: [
      {
        title: "Suspicion is not liability",
        steps: [
          "You suspect tips were under-reported in a quarter.",
          "No Section 3121(q) Notice and Demand has been issued.",
          "The employer share on unreported tips is not yet your liability.",
          "Line 5f stays blank until the IRS makes notice and demand.",
        ],
        answer: "Blank \u2014 no notice, no line 5f",
        moral: "This is the rare line where waiting is the correct action.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 5f",
        quote: "Demand on line 5f. The IRS issues a Section 3121(q)\nNotice and Demand to advise an employer of the amount\nof tips received by employees who failed to report or\nunderreported tips to the employer. An employer isn\u2019t\nliable for the employer share of the social security and\nMedicare taxes on unreported tips until notice and\ndemand for the taxes is made to the employer by the IRS\nin a Section 3121(q) Notice and Demand.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "The IRS determines the amount and advises the employer. The figure originates outside " +
          "your books entirely.",
      },
      {
        cite: "IRS Instructions for Form 941 (2026), line 5f",
        quote: "liable for the employer share of the social security and\nMedicare taxes on unreported tips until notice and\ndemand for the taxes is made to the employer by the IRS\nin a Section 3121(q) Notice and Demand. The tax due\nmay have been determined from tips reported to the IRS\non employees\u2019 Forms 4137, Social Security and Medicare\nTax on Unreported Tip Income, or other tips that weren\u2019t\nreported to their employer as determined by the IRS\nduring an examination.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "\u201cisn\u2019t liable ... until notice and demand\u201d \u2014 the trigger is the notice arriving, not " +
          "your own discovery of the shortfall.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "5b",
        why:
          "Both lines concern tips. 5b is tips employees DID report; 5f is tax on tips they did " +
          "not, and only once the IRS has quantified it.",
      },
    ],
  },
  {
    formId: "form_941",
    box: "8",
    headline: "Third-party sick pay \u2014 a negative number, and that is correct",
    plainEnglish:
      "An adjustment used when an insurance company pays sick pay to your employees and the " +
      "liability for the taxes moves between you and them. It is normally entered as a NEGATIVE " +
      "number, which alarms people who assume a tax form only ever adds.",
    whereItComesFrom:
      "The third-party payer's statement of what it withheld and deposited. Not from your own " +
      "payroll records, because the payments did not run through your payroll.",
    howToReadIt:
      "Blank unless a third party pays sick pay for your employees. When present, expect a " +
      "negative figure, and expect the underlying sick pay to appear in lines 5a and 5c anyway.",
    commonMistake:
      "Two of them. Entering it positive, which double-counts tax that was already deposited by " +
      "someone else; and leaving the sick pay out of lines 5a and 5c because it was not on your " +
      "payroll. The wages belong on those lines; only the tax liability is adjusted here.",
    whatToDo:
      "Get the third-party payer's figures in writing before completing the return, and check the " +
      "sign of the adjustment against the instruction rather than against intuition.",
    examples: [
      {
        title: "Why a tax line can legitimately go negative",
        steps: [
          "An insurer pays sick pay and withholds and deposits the employee share.",
          "Lines 5a and 5c include those wages, so the form computes tax on them.",
          "But that tax has already been deposited by the insurer, not by you.",
          "A negative adjustment on line 8 removes what you do not owe.",
        ],
        answer: "A negative line 8",
        moral: "The negative is not a correction of an error. It prevents paying the same tax twice.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 8",
        quote: "8. Current quarter\u2019s adjustment for sick pay. If your\nthird-party payer of sick pay that isn\u2019t your agent (for\nexample, an insurance company) transfers the liability for\nthe employer share of the social security and Medicare\ntaxes to you, enter a negative adjustment on line 8 for the\nemployee share of social security and Medicare taxes that\nwere withheld and deposited by your third-party sick pay\npayer on the sick pay.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "The instruction says \u201center a negative adjustment\u201d in plain words. The sign is not a " +
          "matter of judgement.",
      },
      {
        cite: "IRS Instructions for Form 941 (2026), line 8",
        quote: "employer. The sick pay should be included on line 5a,\nline 5c, and, if the withholding threshold is met, line 5d.\nNo adjustment is reported on line 8 for sick pay that is\npaid through a third party as an employer\u2019s agent.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "The sick pay still belongs on lines 5a, 5c and possibly 5d. Only the tax liability is " +
          "adjusted here \u2014 the wages are reported normally.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "10",
        why:
          "Line 10 combines lines 6 through 9, so a negative line 8 legitimately reduces the " +
          "total tax after adjustments.",
      },
    ],
  },
  {
    formId: "form_941",
    box: "9",
    headline: "Tax you could not collect \u2014 also negative",
    plainEnglish:
      "The employee share of Social Security and Medicare that you were unable to collect \u2014 on " +
      "tips, and on group-term life insurance premiums for former employees. You reported the " +
      "wages, the form computed the tax, but there was no cheque of theirs left to take it from.",
    whereItComesFrom:
      "The gap between tax computed on reported tips and tax actually withheld. For former " +
      "employees, from the group-term life insurance premium records.",
    howToReadIt:
      "Blank at Greenway today \u2014 no tips, and no group-term life for former employees. A negative " +
      "figure here is normal when it appears at all.",
    commonMistake:
      "Trying to fix the shortfall by reducing line 5b instead. That understates wages, which " +
      "then breaks the reconciliation to the W-2s at year end. Report the wages fully and adjust " +
      "here.",
    whatToDo:
      "If tipping ever starts, track uncollected employee share as its own figure from the first " +
      "quarter. Reconstructing it later from cash differences is painful and unreliable.",
    examples: [
      {
        title: "The former employee you cannot withhold from",
        steps: [
          "Group-term life insurance premiums are paid for a former employee.",
          "That creates wages subject to Social Security and Medicare.",
          "The person no longer receives a paycheque from you.",
          "The uncollected employee share is adjusted negatively on line 9.",
        ],
        answer: "A negative line 9",
        moral: "You can owe reporting on someone you no longer pay. Line 9 is where that reality is reconciled.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 9",
        quote: "9. Current quarter\u2019s adjustments for tips and\ngroup-term life insurance. Enter a negative adjustment\nfor:\n\u2022 Any uncollected employee share of social security and\nMedicare taxes on tips, and\n\u2022 The uncollected employee share of social security and\nMedicare taxes on group-term life insurance premiums\npaid for former employees.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "Exactly two things belong here, and the instruction lists them: uncollected employee " +
          "share on tips, and on group-term life for former employees. Nothing else.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "5b",
        why:
          "Line 5b reports the tips in full even when withholding was impossible; line 9 is where " +
          "the uncollected employee share is then removed.",
      },
    ],
  },
  {
    formId: "form_941",
    box: "11",
    headline: "The research credit \u2014 requires Form 8974 attached",
    plainEnglish:
      "A payroll tax credit some small businesses can claim for increasing research activities. " +
      "The figure is not computed here; it comes off Form 8974, and that form must be attached " +
      "to the return.",
    whereItComesFrom:
      "Form 8974, line 12 or, if applicable, line 17 \u2014 and nowhere else. No account in the ledger produces this figure, and the 941 does not compute it for you.",
    howToReadIt:
      "Blank unless Greenway is claiming the credit. A figure without an attached Form 8974 is an " +
      "incomplete return.",
    commonMistake:
      "Entering an amount without attaching Form 8974. The instruction makes the attachment " +
      "mandatory in the same sentence as the amount \u2014 they are one action, not two.",
    whatToDo:
      "Leave it blank unless a qualified credit has been computed on Form 8974, and attach that " +
      "form in the same filing action rather than promising it later.",
    examples: [
      {
        title: "The amount and the attachment are one step",
        steps: [
          "A credit is computed on Form 8974.",
          "The amount from line 12 (or line 17) is entered on line 11.",
          "Form 8974 must be attached to the Form 941.",
          "Entering the amount without the form leaves the return incomplete.",
        ],
        answer: "Amount plus attached Form 8974",
        moral: "Never enter this figure in one sitting and plan to attach the form in another.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 11",
        quote: "Enter the amount of the credit from Form 8974, line 12 or,\nif applicable, line 17. If you enter an amount on line 11,\nyou must attach Form 8974.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "\u201cyou must attach Form 8974\u201d \u2014 stated as a requirement, in the same breath as the " +
          "amount itself.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "12",
        why:
          "Line 12 is line 10 minus line 11, so this credit is what makes 12 differ from 10.",
      },
    ],
  },
  {
    formId: "form_941",
    box: "15a",
    headline: "Overpayment \u2014 and never on the same return as line 14",
    plainEnglish:
      "When your deposits for the quarter exceeded the tax, the difference goes here. It is money " +
      "the IRS is holding that belongs to Greenway. Line 14 is the opposite case, a balance due. " +
      "One return can show one of them, never both.",
    whereItComesFrom:
      "Line 13 minus line 12, in the case where line 13 is the larger of the two. It is the arithmetic left over once total deposits are set against total tax for the quarter.",
    howToReadIt:
      "If 15a has a figure, line 14 must be empty, and vice versa. That is the fastest single " +
      "check on the bottom of this form.",
    commonMistake:
      "Filling both, usually by combining two quarters or by entering a deposit in the wrong " +
      "period. The instruction forbids it outright.",
    whatToDo:
      "Before filing, confirm exactly one of line 14 and line 15a is populated. If both are, the " +
      "deposits are misdated and the return is wrong.",
    examples: [
      {
        title: "The one-or-the-other check",
        steps: [
          "Line 12 total tax is 16,000.00 and line 13 deposits are 16,500.00.",
          "Deposits exceed the tax, so there is no balance due.",
          "16,500.00 minus 16,000.00 is 500.00.",
          "That 500.00 goes on line 15a, and line 14 stays empty.",
        ],
        answer: "15a = 500.00, line 14 blank",
        moral: "Both lines populated is always an error, never a nuance.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 15a",
        quote: "If line 13 is more than line 12, enter the difference on\nline 15a.\nNever make an entry on both lines 14 and 15a.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "\u201cNever make an entry on both lines 14 and 15a.\u201d An absolute rule, and a free " +
          "correctness check on every return you file.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "14",
        why:
          "They are the two mutually exclusive outcomes of the same subtraction. Both populated " +
          "means the deposits or the period are wrong.",
      },
    ],
  },
  {
    formId: "form_941",
    box: "15b",
    headline: "Refund or apply forward \u2014 tick exactly one",
    plainEnglish:
      "Having shown an overpayment on 15a, you choose what happens to it: refunded to you, or " +
      "applied to next quarter's return. Two tickboxes, and you must pick one.",
    whereItComesFrom:
      "A decision rather than a calculation \u2014 a cash-flow choice about money that has already been overpaid. Nothing in the ledger determines it and no figure is entered here.",
    howToReadIt:
      "Only meaningful when 15a has a figure. If you tick neither, or tick both, the IRS will " +
      "generally apply the overpayment to your next return rather than refund it.",
    commonMistake:
      "Leaving it blank while expecting a cheque. Silence is not neutral here \u2014 it defaults " +
      "against a refund, and the money stays with the IRS.",
    whatToDo:
      "Whenever line 15a has a figure, tick one box deliberately. If cash matters this quarter, " +
      "tick refund; do not assume a blank produces one.",
    examples: [
      {
        title: "A blank tickbox is a decision made for you",
        steps: [
          "Line 15a shows an overpayment of 500.00.",
          "Neither box on 15b is ticked.",
          "The IRS will generally apply the overpayment to the next return.",
          "No cheque arrives, and the 500.00 is not lost \u2014 just not liquid.",
        ],
        answer: "Applied forward by default",
        moral: "Not choosing is choosing. Tick the box.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 15b",
        quote: "15b. Choose to have your overpayment applied to\nyour next return or refunded. If you deposited more\nthan the correct amount for the quarter, you can choose to\nhave the IRS either refund the overpayment or apply it to\nyour next return. Check only one box on line 15b. If you\ndon\u2019t check either box or if you check both boxes, we will\ngenerally apply the overpayment to your next return.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "The default is spelled out: neither box or both boxes, and the overpayment is generally " +
          "applied to the next return rather than refunded.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "15a",
        why:
          "15b only has meaning when 15a shows an overpayment. Without a figure there, the choice " +
          "is moot.",
      },
    ],
  },
  {
    formId: "form_941",
    box: "16",
    headline: "Your deposit schedule \u2014 for Greenway, the semiweekly tick and nothing else",
    plainEnglish:
      "Three mutually exclusive choices: under $2,500, monthly schedule depositor, or " +
      "semiweekly schedule depositor. Greenway is a SEMIWEEKLY depositor, so the third tick is " +
      "the one that applies and the three monthly liability boxes beside it stay EMPTY. The " +
      "liability detail goes on Schedule B instead, one figure per payday.",
    whereItComesFrom:
      "Michael, 26 Aug 2026: \u201cI am a schedule b filer, so we don't need to compute the monthly " +
      "payment.\u201d Confirmed against his filed Q2 2026 return, where the monthly grid is blank " +
      "and the semiweekly box is ticked.",
    howToReadIt:
      "Read it as a declaration of which schedule you are on, not as a figure. The amounts " +
      "themselves \u2014 whether here or on Schedule B \u2014 are what you BECAME LIABLE for, never what " +
      "you PAID, and they must total line 12 rather than line 13.",
    commonMistake:
      "A semiweekly depositor entering liabilities in the monthly boxes here instead of on " +
      "Schedule B. The instruction names the consequence directly: an averaged " +
      "failure-to-deposit penalty, even when every dollar was paid on time.",
    whatToDo:
      "Tick semiweekly, leave the three monthly boxes blank, and attach Schedule B. Then check " +
      "that Schedule B's quarter total equals line 12. Never fill either from the bank statement.",
    examples: [
      {
        title: "Liability and deposit fall in different months",
        steps: [
          "Wages are paid on 31 March, creating liability in March.",
          "The deposit is made in early April, per the deposit schedule.",
          "Line 16 shows the liability in March.",
          "Line 13 shows the deposit when it was made.",
        ],
        answer: "March liability, April deposit \u2014 both correct",
        moral: "Line 16 follows pay dates. Line 13 follows bank dates. Do not merge them.",
      },
      {
        title: "Why Greenway's monthly boxes are blank and that is correct",
        steps: [
          "Greenway is a semiweekly schedule depositor, so the third tick applies.",
          "The three monthly liability boxes are left empty on purpose.",
          "Schedule B carries the detail instead, one figure per payday.",
          "Schedule B's quarter total is checked against line 12.",
        ],
        answer: "Semiweekly ticked, monthly grid blank, Schedule B attached",
        moral:
          "An empty monthly grid on this return is not an omission. Filling it in would " +
          "report the wrong deposit schedule to the IRS.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 16",
        quote: "on Schedule B (Form 941).\nCaution: The amounts entered on line 16 are a summary\nof your monthly tax liability, not a summary of deposits you\nmade. If you don\u2019t properly report your liabilities when\nrequired or if you\u2019re a semiweekly schedule depositor and\nenter your liabilities on line 16 instead of on Schedule B\n(Form 941), you may be assessed an \u201caveraged\u201d FTD\npenalty.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "\u201ca summary of your monthly tax liability, not a summary of deposits you made\u201d \u2014 and the " +
          "consequence named in the same passage is an averaged FTD penalty.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "12",
        why:
          "The monthly liabilities on line 16 must total line 12. That is the arithmetic check " +
          "which catches the deposits-instead-of-liability error.",
      },
    ],
  },
  {
    formId: "form_941",
    box: "17",
    headline: "Final return \u2014 tick only if you have stopped paying wages",
    plainEnglish:
      "A checkbox telling the IRS this is your last Form 941, because the business closed or " +
      "stopped paying wages. You also enter the final date wages were paid.",
    whereItComesFrom:
      "A fact about the business, not the ledger. The date comes from the last payroll run.",
    howToReadIt:
      "Blank on every ordinary return. Ticked, it tells the IRS to stop expecting quarterly " +
      "returns from you.",
    commonMistake:
      "Ticking it during a temporary pause \u2014 a seasonal closure, a quarter with no payroll. That " +
      "tells the IRS you have stopped for good. A quarter with no wages still gets an ordinary " +
      "return, and seasonality has its own box on line 18.",
    whatToDo:
      "Leave it blank unless Greenway has genuinely stopped paying wages. If a quarter simply had " +
      "no payroll, file the return normally with zeros.",
    examples: [
      {
        title: "No payroll this quarter is not a final return",
        steps: [
          "A quarter passes in which no wages are paid.",
          "The business continues and intends to pay wages again.",
          "Line 17 stays blank \u2014 nothing has ended.",
          "The return is filed showing no wages for the quarter.",
        ],
        answer: "Line 17 blank; file an ordinary return",
        moral: "Only tick it when it is genuinely the last 941 Greenway will ever file.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 17",
        quote: "If you go out of business or stop paying wages, you must\nfile a final return. To tell the IRS that a particular Form 941\nis your final return, check the box on line 17 and enter the\nfinal date you paid wages in the space provided. For\nadditional filing requirements, including information about\nattaching a statement to your final return, see If Your\nBusiness Has Closed, earlier.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "Two actions in one instruction: tick the box AND enter the final date wages were paid. " +
          "The date is not optional.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "18",
        why:
          "Line 18 is the box for a business that pauses seasonally. Confusing the two tells the " +
          "IRS the business has closed when it has not.",
      },
    ],
  },
  {
    formId: "form_941",
    box: "18",
    headline: "Seasonal employer \u2014 and it must be ticked EVERY time",
    plainEnglish:
      "If you hire only seasonally, ticking this tells the IRS not to expect four returns a year. " +
      "The catch that surprises people: it must be ticked on every Form 941 you file, not once.",
    whereItComesFrom:
      "The hiring pattern of the business, not any figure in the books. It describes whether wages are paid year round or only in certain seasons.",
    howToReadIt:
      "Blank at Greenway \u2014 a year-round retailer. If it is ever ticked, it must be ticked on " +
      "every subsequent return too.",
    commonMistake:
      "Ticking it once and assuming the IRS remembers. It does not: miss it on a later return and " +
      "the IRS expects a filing for every quarter again.",
    whatToDo:
      "Leave it blank while Greenway pays wages year round. If that ever changes, add it to the " +
      "filing checklist for every quarter rather than treating it as a one-time election.",
    examples: [
      {
        title: "Ticked once is not ticked",
        steps: [
          "A seasonal employer ticks line 18 on the first-quarter return.",
          "The box is left blank on the second-quarter return.",
          "The instruction requires it on every Form 941 filed.",
          "The IRS resumes expecting a return for each quarter.",
        ],
        answer: "Tick it on every return, every time",
        moral: "This is a per-return statement, not a standing election.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 18",
        quote: "If you hire employees seasonally\u2014such as for summer or\nwinter only\u2014check the box on line 18. Checking the box\ntells the IRS not to expect four Forms 941 from you\nthroughout the year because you haven\u2019t paid wages\nregularly.\nGenerally, we won\u2019t ask about unfiled returns if at least\none taxable return is filed each year.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "The purpose is stated plainly \u2014 it tells the IRS not to expect four Forms 941 because " +
          "wages are not paid regularly.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "17",
        why:
          "Line 18 is for a business that pauses and resumes; line 17 is for one that has stopped " +
          "for good. Ticking the wrong one misinforms the IRS about the company's existence.",
      },
    ],
  },
  /*
   * ═══ THE LAST THREE LINES, ADDED AFTER RE-MEASURING THE PRINTED FORM ═══
   *
   * The roadmap recorded this form as having 25 labels, listing "15c" and "15e"
   * but not 15d. That was wrong. Reading the labels mechanically out of
   * 2ND_QTR_FORM_941.pdf gives 27, because line 15 splits five ways: 15a, 15b,
   * 15c, 15d and 15e. Trusting the roadmap instead of the form would have left
   * this slice one line short of complete while reporting it finished.
   *
   * These three are the refund direct-deposit fields. They are the only boxes on
   * the whole form that ask for BANK CREDENTIALS, which makes them the only
   * boxes where a teaching specimen could leak a real account number. The
   * specimens deliberately carry no digits at all -- enforced for every form by
   * assertNoSpecimenClaimsAFigure() in form-box-teaching-core.ts.
   */
  {
    formId: "form_941",
    box: "15c",
    headline: "Routing number \u2014 nine digits, and the IRS will not fix a typo",
    plainEnglish:
      "If you asked for a refund on 15b, this is where the money goes. Nine digits identifying " +
      "your bank. It is only used when a refund is actually being sent; if you applied the " +
      "overpayment forward, leave 15c through 15e empty.",
    whereItComesFrom:
      "Your bank, not your books. No ledger account produces it and no report can derive it \u2014 " +
      "it is a standing fact about the business's bank account that you supply from outside the " +
      "accounting system entirely.",
    howToReadIt:
      "Exactly nine digits, and the first two must fall in 01\u201312 or 21\u201332. Any other opening " +
      "pair is not a valid routing number, which makes this one of the few boxes on the form you " +
      "can check for correctness without knowing anything about the business.",
    commonMistake:
      "Copying the routing number off a deposit slip. The instructions warn specifically that a " +
      "deposit-slip routing number is often NOT the one for electronic deposits, and the IRS " +
      "states plainly that it is not responsible for a refund lost to wrong account information.",
    whatToDo:
      "Complete 15c, 15d and 15e together or leave all three blank. Take the routing number from " +
      "your bank's stated ACH or direct-deposit number, not from a deposit slip, and never cross " +
      "out or white out a correction \u2014 that alone will get the request rejected.",
    examples: [
      {
        title: "A refund that turns back into a cheque",
        steps: [
          "Line 15a shows an overpayment and 15b is ticked for a refund.",
          "The routing number is copied from a paper deposit slip.",
          "The deposit slip number differs from the bank's ACH routing number.",
          "The direct deposit is rejected and a paper cheque is mailed instead.",
        ],
        answer: "Rejected, paid by cheque",
        moral: "A wrong routing number does not lose the money; it costs weeks.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 15c",
        quote:
          "15c. Routing number. The routing number must be nine\ndigits. The first two digits must be 01 through 12 or 21\nthrough 32. Verify that your financial institution will accept\na direct deposit.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "The format is a hard rule, so an invalid routing number can be spotted before filing " +
          "rather than after the refund fails.",
      },
      {
        cite: "IRS Instructions for Form 941 (2026), direct deposit",
        quote:
          "To have your refund direct deposited, you must complete\nlines 15c\u201315e.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "All three lines or none. A partially completed direct-deposit block is not a valid " +
          "request.",
      },
      {
        cite: "IRS Instructions for Form 941 (2026), lost refund caution",
        quote:
          "Caution: The IRS isn\u2019t responsible for a lost refund if you\nenter the wrong account information. Check with your\nfinancial institution to get the correct routing and account\nnumbers and to make sure your direct deposit will be\naccepted.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "The risk sits entirely with the filer. That is why this box is worth checking twice " +
          "even though it reports no tax at all.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "15b",
        why:
          "15c only matters because 15b was ticked for a refund. If the overpayment was applied " +
          "forward instead, these three lines should be blank.",
      },
    ],
  },
  {
    formId: "form_941",
    box: "15d",
    headline: "Checking or savings \u2014 tick one, and tick the right one",
    plainEnglish:
      "Two tickboxes saying what kind of account the refund is going to. Not an amount, and not " +
      "optional if you want the direct deposit to work.",
    whereItComesFrom:
      "The bank account itself, not the accounting records. It is a description of the account " +
      "named on 15c and 15e, supplied by you from outside the books.",
    howToReadIt:
      "Exactly one box ticked whenever 15c and 15e are filled in, and both blank whenever they " +
      "are. The instructions are explicit that more than one box must not be checked.",
    commonMistake:
      "Ticking savings for an account that does not permit cheque-writing without confirming the " +
      "bank accepts direct deposits to it. The instructions raise that exact case, and warn that " +
      "the wrong box can stop the deposit being accepted at all.",
    whatToDo:
      "Tick one box only, matching the account on 15c and 15e. If you are unsure which, ask the " +
      "bank before filing rather than guessing between two boxes.",
    examples: [
      {
        title: "Two ticks are worse than one",
        steps: [
          "A refund is requested and the routing and account numbers are correct.",
          "Both the checking and savings boxes are ticked, to be safe.",
          "The account type is now ambiguous.",
          "The deposit may be refused even though every digit was right.",
        ],
        answer: "One box, always",
        moral: "On a tickbox, hedging is an error and not caution.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 15d",
        quote:
          "15d. Type of account. Check the appropriate box for the\ntype of account. Don\u2019t check more than one box. You must\ncheck the correct box to ensure your deposit is accepted.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "Both halves are stated: not more than one box, and the correct one, or the deposit may " +
          "not be accepted.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "15c",
        why:
          "15c, 15d and 15e are one instruction split across three boxes. Any one of them left " +
          "wrong or blank defeats the other two.",
      },
    ],
  },
  {
    formId: "form_941",
    box: "15e",
    headline: "Account number \u2014 up to 17 characters, no spaces, no corrections",
    plainEnglish:
      "The account the refund is deposited into. Letters as well as numbers are allowed, up to " +
      "seventeen characters. Like 15c and 15d it is only used when a refund is actually being " +
      "sent.",
    whereItComesFrom:
      "Your bank account, not the general ledger. Nothing in the books can validate it, which is " +
      "exactly why it deserves a second pair of eyes before the return is filed.",
    howToReadIt:
      "Entered left to right with any unused boxes left blank. Hyphens are kept but spaces and " +
      "special symbols are omitted, so a number that looks right on a statement may need " +
      "reformatting for this box.",
    commonMistake:
      "Correcting a mistake by striking through or whiting out a character. The instructions list " +
      "crossed-out or whited-out numbers on lines 15c\u201315e as a reason the direct deposit " +
      "request is rejected outright, so a tidy-looking correction still costs you the deposit.",
    whatToDo:
      "Enter the number from left to right, keep hyphens, drop spaces and symbols, and if you " +
      "make an error start the form or that entry again rather than correcting it in place.",
    examples: [
      {
        title: "A neat correction is still a rejection",
        steps: [
          "The account number is entered one character out of position.",
          "The wrong character is whited out and the right one written over it.",
          "The entry now reads correctly to a human.",
          "The direct deposit request is rejected because the line was altered.",
        ],
        answer: "Rejected on sight",
        moral: "This box is read by machine. Re-enter it; never patch it.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 15e",
        quote:
          "15e. Account number. The account number can be up\nto 17 characters (both numbers and letters). Include\nhyphens but omit spaces and special symbols. Enter the\nnumber from left to right and leave any unused boxes\nblank.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "The formatting rules are exact, and they differ from how a bank statement usually " +
          "presents the same number.",
      },
      {
        cite: "IRS Instructions for Form 941 (2026), rejected direct deposit",
        quote:
          "\u2022 Any numbers or letters on lines 15c\u201315e are crossed\nout or whited out.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "An altered character is itself a ground for rejection, across all three direct-deposit " +
          "lines and not just this one.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "15a",
        why:
          "None of 15c, 15d or 15e means anything unless 15a shows an overpayment. The refund " +
          "block describes where an overpayment goes, and 15a is what creates one.",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // books-59 ADDITIONS — the running-total spine, and the one adjustment that
  // is supposed to be there.
  //
  // Michael's instruction for this batch, verbatim: "there are some boxes that
  // dont apply to me and so we dont need to waste time learning something that
  // does not apply to us. only add the lesson if it will really truly benefit
  // me."
  //
  // So these were chosen by MEASUREMENT, not by filling in the blanks. Seven
  // 941 boxes had no lesson; four are taught here and three are deliberately
  // left alone:
  //
  //   TAUGHT   5e  the FICA total that is DOUBLE what employees saw
  //   TAUGHT   6   the first "everything so far" line
  //   TAUGHT   7   fractions of cents — the box that SHOULD be non-zero
  //   TAUGHT   10  the number the deposits get compared against
  //
  //   NOT TAUGHT 12  identical to 10 for Greenway (no credits claimed), and a
  //                  lesson saying "same as line 10" teaches nothing
  //   NOT TAUGHT 13  a transcription of the EFTPS record, with no judgement in
  //                  it — the box-10 lesson covers what happens when it differs
  //   NOT TAUGHT 14  balance due is arithmetic on 12 and 13; taught inside the
  //                  box-10 lesson where it actually matters
  // ═══════════════════════════════════════════════════════════════════════════

  {
    formId: "form_941",
    box: "5e",
    headline: "The FICA total — and it is roughly DOUBLE what your staff saw deducted",
    plainEnglish:
      "Social Security and Medicare added together, both halves of each. This is the box where the " +
      "doubling stops being an abstraction and turns into a number, and it is the single most " +
      "misread figure on the form. If an employee looked at their own pay stubs for the quarter and " +
      "added up the Social Security and Medicare withheld, they would see roughly HALF of this. The " +
      "other half is Greenway's own money, matched dollar for dollar.",
    whereItComesFrom:
      "Line 5a plus line 5c — and each of those was already computed at the DOUBLE rate (12.4% for " +
      "Social Security, 2.9% for Medicare) rather than the 6.2% and 1.45% that came off the " +
      "cheques. So the doubling happened upstream; 5e is only the addition.",
    howToReadIt:
      "Read it as the true cost of FICA for the quarter, not as what you withheld. Half of this " +
      "number is money you held in trust for your employees; the other half is an employer tax " +
      "that came out of Greenway. If you are budgeting payroll, the employer half of this box is " +
      "the part that is genuinely yours to fund, and it is easy to forget it exists because it " +
      "never appears on anyone's pay stub.",
    commonMistake:
      "Reconciling this box against the FICA column of your payroll register and concluding the " +
      "form is wrong because it is twice as big. It is supposed to be twice as big. The opposite " +
      "mistake is worse: entering the employee half only, which understates the return and creates " +
      "a deposit shortfall the IRS will notice.",
    whatToDo:
      "Add lines 5a and 5c. Then, as a sanity check, halve the result and compare THAT against " +
      "what your payroll register shows as withheld. Those two should be close — within the " +
      "fractions of cents that line 7 exists to absorb.",
    examples: [
      {
        title: "Why halving it is the right sanity check",
        steps: [
          "Suppose line 5a (Social Security, taxable wages x 0.124) comes to 12,400.00.",
          "And line 5c (Medicare, taxable wages x 0.029) comes to 2,900.00.",
          "Line 5e is 12,400.00 + 2,900.00 = 15,300.00.",
          "Half of that is 7,650.00 — and that is roughly what the employees actually saw withheld.",
          "The other 7,650.00 is Greenway's employer share, which no pay stub ever showed.",
        ],
        answer: "15,300.00",
        moral:
          "Half of line 5e is trust money you were holding. The other half is a tax on Greenway. " +
          "The form does not distinguish them, and your books must.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 5e",
        quote: "5e. Total social security and Medicare taxes. Add the\ncolumn 2 amounts on lines 5a–5d. Enter the result on\nline 5e.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "It is pure addition of the column 2 figures. Every bit of the doubling was already " +
          "built into those lines by their own multipliers.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "6",
        why:
          "Line 6 is line 3 plus this box. 5e is the FICA half of the quarter's total tax, and " +
          "line 3 is the income-tax half.",
      },
    ],
  },

  {
    formId: "form_941",
    box: "6",
    headline: "The first line that says \u201Ceverything so far\u201D",
    plainEnglish:
      "Income tax withheld plus all of FICA, both halves. This is the first point on the form where " +
      "you can look at one number and say: that is what this quarter generated in federal payroll " +
      "tax, before any adjustment. Nothing has been subtracted yet and nothing has been credited.",
    whereItComesFrom:
      "Line 3 (federal income tax withheld) plus line 5e (all of Social Security and Medicare). " +
      "Two very different kinds of money added into one figure — see the warning below.",
    howToReadIt:
      "Read it as the gross obligation for the quarter. It is worth pausing here because this box " +
      "mixes two things your books must never mix: line 3 is money you took out of employees' pay " +
      "and are holding in trust, and part of line 5e is Greenway's own employer tax. The form is " +
      "happy to add them because the IRS only cares about the total that must be deposited. Your " +
      "general ledger has to keep them apart — trust liability on one side, employer payroll " +
      "expense on the other.",
    commonMistake:
      "Treating this whole number as a business expense at close. A large part of it was never " +
      "Greenway's money. Expensing the trust portion overstates costs and understates the " +
      "liability, and it is the same error pattern as booking sales tax to the P&L.",
    whatToDo:
      "Add lines 3 and 5e. Then, when this quarter is journalised, split it: the employee " +
      "withholding and employee FICA to a trust liability, the employer FICA to payroll tax " +
      "expense. One number on the form, two very different lines in the books.",
    examples: [
      {
        title: "One box, two kinds of money",
        steps: [
          "Line 3 — federal income tax withheld from employees: 9,000.00. Trust money.",
          "Line 5e — all FICA, both halves: 15,300.00. Half trust, half Greenway's own tax.",
          "Line 6 is 9,000.00 + 15,300.00 = 24,300.00.",
          "Of that, roughly 9,000.00 + 7,650.00 = 16,650.00 was never Greenway's.",
          "And roughly 7,650.00 is a genuine employer expense.",
        ],
        answer: "24,300.00",
        moral:
          "The IRS wants one total. Your books need the split. Line 6 is where the two views of " +
          "the same money part company.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 6",
        quote: "6. Total Taxes Before Adjustments\nAdd the total federal income tax withheld from wages, tips,\nand other compensation (line 3); the total social security\nand Medicare taxes before adjustments (line 5e); and any\ntax due under a Section 3121(q) Notice and Demand\n(line 5f). Enter the result on line 6.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "Three lines added, one of which (5f) only exists if the IRS has served a notice about " +
          "unreported tips. For Greenway it is lines 3 and 5e.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "5e",
        why: "Line 6 is line 3 plus 5e. This is the box 5e feeds.",
      },
      {
        formId: "form_941",
        box: "10",
        why:
          "Line 10 is this figure after the fractions-of-cents adjustment on line 7 — the total " +
          "the deposits are finally measured against.",
      },
    ],
  },

  {
    formId: "form_941",
    box: "7",
    headline: "The box that is SUPPOSED to be a few cents, and suspicious when it is zero",
    plainEnglish:
      "A tiny correction for rounding. Every paycheque has its Social Security and Medicare rounded " +
      "to the nearest cent on its own. Add up a quarter of individually-rounded cheques and the " +
      "total will differ by a few cents from the exact percentage of the quarterly wage total. This " +
      "box is where that difference goes. It is the one line on Form 941 where a small number is " +
      "the correct answer and a clean zero is worth a second look.",
    whereItComesFrom:
      "The difference between what was actually withheld across every cheque in the quarter and " +
      "what the statutory percentage of the quarterly total comes to. The system derives it by " +
      "comparing those two figures — never by plugging whatever makes the return balance.",
    howToReadIt:
      "Read it as a rounding artefact, and read its SIZE as a diagnostic. A few cents, positive or " +
      "negative, is normal and healthy. Dollars is not: that says something real is wrong " +
      "upstream — a wrong rate, a missed wage-base cap, a cheque calculated by hand. The IRS " +
      "expects this line to be small, so a large figure here is exactly the kind of thing that " +
      "invites a letter.",
    commonMistake:
      "Using this box as a plug to force the return to balance. It is the most tempting box on the " +
      "form for exactly that, because a small number here looks unremarkable. That is precisely " +
      "the LAZY ENTRY pattern that put a multi-million-dollar plug in Greenway's inventory: a " +
      "difference nobody could explain got written into whichever box would swallow it. If this " +
      "box has to be dollars to make the form foot, the error is somewhere else and this box is " +
      "hiding it.",
    whatToDo:
      "Let it be computed from the two totals, then look at the size. Cents: file it. Dollars: " +
      "stop and find out why before filing, because the return is telling you something.",
    examples: [
      {
        title: "Why individually-rounded cheques cannot add up exactly",
        steps: [
          "Take three paycheques with Social Security of 62.005, 62.005 and 62.005 before rounding.",
          "Each cheque is rounded on its own, so each withholds 62.01 \u2014 total 186.03.",
          "But the quarterly wage total x 6.2% comes to 186.015, which rounds to 186.02.",
          "The difference is one cent, and it is nobody's mistake \u2014 it is what rounding does.",
          "That one cent goes on line 7.",
        ],
        answer: "0.01",
        moral:
          "The adjustment exists because the law rounds every cheque separately. Small is correct; " +
          "large means look elsewhere.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 7",
        quote: "7. Current quarter’s adjustment for fractions of\ncents. Enter adjustments for fractions of cents (due to\nrounding) relating to the employee share of social security\nand Medicare taxes withheld. The employee share of\namounts shown in column 2 of lines 5a–5d may differ\nslightly from amounts actually withheld from employees’\npay due to the rounding of social security and Medicare\ntaxes based on statutory rates. This adjustment may be a\npositive or a negative adjustment.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "The IRS says the cause outright \u2014 rounding at the level of each cheque \u2014 and says it " +
          "may go either way. \u201CSlightly\u201D is the operative word: this is a cents-sized box.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "10",
        why: "Line 10 is line 6 plus this adjustment. This is the only thing standing between them.",
      },
    ],
  },

  {
    formId: "form_941",
    box: "10",
    headline: "The number your deposits are measured against",
    plainEnglish:
      "The quarter's total tax once the rounding adjustment has been applied. This is the figure " +
      "that matters most on the whole form, because it is what the IRS compares your actual " +
      "deposits to. Everything above this line is working out what is owed; everything below is " +
      "working out whether it was paid.",
    whereItComesFrom:
      "Line 6 plus line 7 — the gross tax plus the fractions-of-cents adjustment. Nothing else.",
    howToReadIt:
      "Read it against line 13, your deposits, and understand what the gap means. If line 10 is " +
      "larger, you underdeposited and there is a balance due. That matters far more than the " +
      "dollar amount suggests, because underdepositing employment tax is not an ordinary debt: " +
      "this figure contains money you WITHHELD FROM EMPLOYEES. The IRS treats unpaid trust-fund " +
      "money as the most serious category of tax debt there is, and it can be assessed personally " +
      "against the individual responsible \u2014 the corporation is not a shield. If line 13 is larger " +
      "you overdeposited, which is only a cash-flow annoyance.",
    commonMistake:
      "Treating a small balance due as something to settle later. Penalties and interest on " +
      "employment tax compound from the deposit due date, not the filing date, and the trust-fund " +
      "portion carries personal exposure. A late deposit of withheld tax is a different kind of " +
      "problem from a late payment of income tax, and it is worth knowing which one you are " +
      "looking at.",
    whatToDo:
      "Add lines 6 and 7, then compare the result with line 13 before filing. If they differ, find " +
      "out WHY while the quarter is still fresh \u2014 a missed deposit, a deposit posted to the wrong " +
      "quarter, or a real calculation error all look identical at this line and have completely " +
      "different remedies.",
    examples: [
      {
        title: "Reading the gap between tax and deposits",
        steps: [
          "Line 6 (total before adjustments): 24,300.00.",
          "Line 7 (fractions of cents): 0.02.",
          "Line 10 is therefore 24,300.02 \u2014 the quarter's real obligation.",
          "If line 13 (deposits) shows 24,300.02, the quarter is clean.",
          "If line 13 shows 20,000.00, there is a 4,300.02 balance due \u2014 and most of it is money " +
            "withheld from employees, which is the serious kind.",
        ],
        answer: "24,300.02",
        moral:
          "This box is the pivot of the form. Above it, what you owe. Below it, what you paid. The " +
          "difference is the only thing the IRS is really looking at.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 10",
        quote: "10. Total Taxes After Adjustments\nCombine the amounts shown on lines 6–9 and enter the\nresult on line 10.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "\u201CCombine\u201D rather than \u201Cadd\u201D because lines 7 through 9 can be negative. For Greenway, " +
          "with no sick-pay or tips adjustments, it is line 6 plus line 7.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "6",
        why: "Line 10 is line 6 plus the rounding adjustment. Line 6 is where it starts.",
      },
      {
        formId: "form_941",
        box: "7",
        why: "The only adjustment between line 6 and this box, for Greenway.",
      },
    ],
  },

  /* ═══════════════════════════════════════════════════════════════════════
   * books-65 — THE LINES THAT WERE NEVER WRITTEN
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Michael, on inspecting the forms: "the boxes that dont have lessons, the
   * boxes look like there is a red squiggly line in it, but id rather they
   * just open a box that says in plain english what it is and why it doesn't
   * need a lesson." And: "on the 941 schedule b, every single box opens with
   * an explanation. this is the level of thoroughness i want."
   *
   * He asked for a fallback panel. He does not need one. Every box that was
   * carrying the amber marker turned out to have real instruction text sitting
   * in the mirrored corpus already — none of them was a box that "doesn't need
   * a lesson", every one was a box nobody had written yet. So the marker is
   * removed by removing its cause.
   *
   * Lines 12, 13 and 14 are not minor. They are the three lines an IRS notice
   * is actually about: what you owed, what you paid, and the gap. Leaving them
   * unexplained while lines 1 through 10 were fully taught meant the form got
   * quieter exactly where it got expensive.
   * ═══════════════════════════════════════════════════════════════════════ */

  {
    formId: "form_941",
    box: "12",
    headline: "What the quarter actually costs \u2014 and the figure Schedule B must equal",
    plainEnglish:
      "The bottom line of the top half of the form. Line 10 was everything owed after the small " +
      "rounding adjustments; line 11 is a research credit Greenway does not claim; so line 12 is " +
      "the quarter's real federal employment tax bill. It is what you owe. It is NOT what you " +
      "have paid \u2014 that is line 13, one row down, and the whole point of the form is the " +
      "comparison between them. This figure can never be negative; if the arithmetic above it " +
      "produces a negative number, something above it is wrong.",
    whereItComesFrom:
      "Line 10 minus line 11. Line 10 is the withheld income tax plus both halves of Social " +
      "Security and Medicare plus the fractions-of-cents adjustment; line 11 is zero for " +
      "Greenway, because the qualified small business research credit requires a Form 8974 and a " +
      "qualifying research activity, and a cannabis retailer has neither. So in practice line 12 " +
      "equals line 10 exactly.",
    howToReadIt:
      "Two things at once. First, it is the number that decides how Greenway must PAY: under " +
      "$2,500 for this quarter and the last, and the tax may simply go with the return; at " +
      "$2,500 or more it must be deposited on schedule, and paying it with the return instead is " +
      "penalised. Second, it is the reconciliation target \u2014 the IRS requires it to equal the " +
      "\u201CTotal liability for the quarter\u201D on Schedule B, to the cent. Greenway files Schedule B, " +
      "so this box is checked against another document every single quarter.",
    commonMistake:
      "Reading it as the amount to write a cheque for. It is the amount OWED for the quarter, and " +
      "most of it has usually been deposited already, payday by payday. Sending it again is a " +
      "double payment that takes months to unwind. The amount to pay is line 14, and on a " +
      "correctly deposited quarter line 14 is zero.",
    whatToDo:
      "Read this box beside the quarter total on Schedule B and confirm they are identical. If " +
      "they differ by even a cent, fix the difference before filing \u2014 an internally inconsistent " +
      "return invites a notice about the whole quarter rather than about one day.",
    examples: [
      {
        title: "Why line 12 equals line 10 on every Greenway return",
        steps: [
          "Line 10 (total taxes after adjustments): 24,300.02.",
          "Line 11 (qualified small business payroll tax credit): blank \u2014 Greenway claims no research credit and files no Form 8974.",
          "24,300.02 \u2212 0.00 = 24,300.02.",
          "That figure must also appear as the quarter total on Schedule B.",
        ],
        answer: "24,300.02",
        moral:
          "Line 11 exists on the form for companies that are not Greenway. Its emptiness is the " +
          "correct entry, not a gap.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 12",
        quote:
          "Subtract line 11 from line 10 and enter the result on\nline 12. The amount entered on line 12 can\u2019t be less than\nzero.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "One subtraction, and a floor of zero. A negative result is not an overpayment to be " +
          "shown here \u2014 it means a line above is wrong.",
      },
      {
        cite: "IRS Instructions for Form 941 (2026), line 12, deposit rules",
        quote:
          "The amount\nshown on line 12 must equal the \u201CTotal liability for quarter\u201D\nshown on line 16 or the \u201CTotal liability for the quarter\u201D\nshown on Schedule B (Form 941). For more information,\nsee the line 16 instructions, later.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "This is the identity the IRS checks mechanically. Greenway files Schedule B, so this " +
          "box is compared against that schedule's quarter total on every return.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "10",
        why: "Line 12 is line 10 less the research credit, and Greenway's research credit is always zero \u2014 so these two boxes should show the same figure.",
      },
      {
        formId: "form_941",
        box: "13",
        why: "Line 12 is what is owed; line 13 is what was paid. The form exists to put them next to each other.",
      },
      {
        // books-65: the form id is "form_941_sb", not "form_941_schedule_b".
        // The first draft of this tie invented the longer spelling, and
        // assertEveryTieResolves caught it: a tie into a form id that does not
        // exist sends Michael to a screen that cannot load. Verified against
        // FORM_ID_941_SB in form-941-schedule-b-boxes.ts, and "quarterTotal" is
        // a real box in the generated Schedule B specimen.
        formId: "form_941_sb",
        box: "quarterTotal",
        why: "The IRS requires these two to be equal to the cent. A difference is what a notice is written about.",
      },
    ],
  },

  {
    formId: "form_941",
    box: "13",
    headline: "What was already sent to the IRS during the quarter",
    plainEnglish:
      "The total of the deposits Greenway actually made during the quarter, plus any overpayment " +
      "carried forward from a prior quarter. Everything above this line is a LIABILITY \u2014 what " +
      "the wages caused Greenway to owe. This line is the only one on the form that records " +
      "money leaving the bank. It is the answer to \u201Cwhat have we already paid?\u201D",
    whereItComesFrom:
      "The federal tax deposits recorded in the books for the quarter, matched to what actually " +
      "cleared the bank via EFTPS. It is a cash figure and not a computed one: nothing on the " +
      "top half of the form can produce it, which is precisely why it can disagree with the top " +
      "half and why the form asks for it separately.",
    howToReadIt:
      "Read it against line 12 and nothing else. Equal means the quarter was deposited correctly. " +
      "Smaller than line 12 means Greenway is short, and the shortfall matters more than its size " +
      "suggests \u2014 the money above it includes tax WITHHELD FROM EMPLOYEES, which the IRS treats " +
      "as trust-fund money and can assess personally against the responsible individual. Larger " +
      "than line 12 is only a cash-flow annoyance and produces an overpayment on line 15a.",
    commonMistake:
      "Entering the liability instead of the deposits, so the two lines agree by construction. " +
      "That defeats the entire purpose of the bottom half of the form: line 13 exists to be an " +
      "INDEPENDENT figure, taken from the bank, that can contradict the computation above it. A " +
      "line 13 copied from line 12 will never catch the missed deposit it was designed to catch.",
    whatToDo:
      "Pull the quarter's EFTPS payment history and add it up from the payment records, not from " +
      "this return. Then compare it to line 12. If the two differ, identify whether it was a " +
      "missed deposit, a deposit posted to the wrong quarter, or an error in the wages above \u2014 " +
      "the three look identical here and have completely different remedies.",
    examples: [
      {
        title: "A deposit that landed in the wrong quarter",
        steps: [
          "Line 12 for Q2: 24,300.02.",
          "EFTPS history for April, May and June totals 21,800.02.",
          "Line 13 is therefore 21,800.02 and line 14 shows a 2,500.00 balance due.",
          "The missing 2,500.00 turns out to have been deposited on 2 July and applied to Q3.",
          "Q2 is genuinely short and Q3 will show an overpayment \u2014 two errors, not one.",
        ],
        answer: "21,800.02",
        moral:
          "A deposit made is not a deposit made in the right period. The date the IRS applied it " +
          "is what this line is counting.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 13",
        quote:
          "Enter your deposits for this quarter, including any\noverpayment from a prior quarter that you applied to this\nreturn.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "Deposits made, plus credit carried in. Not the liability, and not what the return " +
          "computes \u2014 this figure comes from outside the form.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "12",
        why: "Line 13 is only meaningful next to line 12. Equal is a clean quarter; short is a balance due; over is an overpayment.",
      },
      {
        formId: "form_941",
        box: "14",
        why: "When line 13 falls short of line 12, the difference lands on line 14 as the amount to pay.",
      },
    ],
  },

  {
    formId: "form_941",
    box: "14",
    headline: "The amount still to pay \u2014 which on a correctly deposited quarter is empty",
    plainEnglish:
      "The gap, when line 12 (owed) is bigger than line 13 (paid). It is the only box on Form 941 " +
      "that asks Greenway to send money WITH the return. On a quarter where every deposit was " +
      "made on time this box is blank, and blank is the goal. Line 14 and line 15a are mutually " +
      "exclusive: one is a shortfall, the other an overpayment, and no return can have both.",
    whereItComesFrom:
      "Line 12 minus line 13, when that difference is positive. Nothing is looked up for this " +
      "box \u2014 it is pure subtraction of the two lines above it, which is why an error anywhere " +
      "on the form surfaces here rather than being absorbed.",
    howToReadIt:
      "A figure here on a $2,500-or-more quarter is a warning, not a bill. If Greenway was " +
      "required to deposit and instead pays with the return, the IRS may penalise the deposit " +
      "even though the tax was ultimately paid \u2014 the offence is the missed deposit, not the " +
      "unpaid tax. So the question a figure here raises is never \u201Chow do I pay this?\u201D but " +
      "\u201Cwhich deposit did we miss, and when?\u201D",
    commonMistake:
      "Two, and they compound. First, entering a figure on both line 14 and line 15a \u2014 the " +
      "instructions forbid it outright, because a return cannot be both short and over. Second, " +
      "paying a balance due by cheque while also being required to deposit, which fixes the " +
      "cash and leaves the penalty in place.",
    whatToDo:
      "If this box is not blank, find the deposit that is missing before you pay anything. Then " +
      "pay by EFT rather than by cheque, and check whether the quarter also needs a corrected " +
      "Schedule B \u2014 a missed deposit does not change the liability schedule, but a mis-recorded " +
      "payday does.",
    examples: [
      {
        title: "Under a dollar",
        steps: [
          "Line 12: 24,300.02. Line 13: 24,299.50.",
          "The difference is 0.52, which goes on line 14.",
          "The instructions say you don\u2019t have to pay if line 14 is under $1.",
          "So nothing is remitted \u2014 but the 52 cents is still worth explaining, because it is " +
            "usually a rounding difference between the engine and a deposit made by hand.",
        ],
        answer: "0.52",
        moral:
          "A tiny balance due is not a payment problem. It is a signal that two systems rounded " +
          "differently, and it is cheaper to find out which than to ignore it four times a year.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), line 14",
        quote:
          "If line 12 is more than line 13, enter the difference on\nline 14. Otherwise, see the instructions for line 15a, later.\nNever make an entry on both lines 14 and 15a.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "\u201CNever\u201D is the IRS\u2019s own word. One box or the other, never both \u2014 a return with " +
          "figures in both is self-contradicting on its face.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "12",
        why: "The larger of the two figures this box subtracts. If line 12 is wrong, so is the balance due.",
      },
      {
        formId: "form_941",
        box: "13",
        why: "The deposits. A balance due almost always means a deposit is missing rather than that the tax was computed wrongly.",
      },
    ],
  },

  /* ─────────────────────────────────────────────────────────────────────
   * THE FIVE IDENTIFIER BOXES
   *
   * These are the boxes D-15 was hiding. Until books-65 the teaching
   * specimen had no box carrying the ids `ein`, `name`, `tradeName`,
   * `address` or `cityStateZip`, so Michael's company profile \u2014 correctly
   * stored, green ticks and all \u2014 had nowhere to print. Adding the boxes
   * fixed the printing; these lessons make them teach.
   *
   * Michael on this exact request: "it would be nice to have the ein and top
   * section have clickables. dont waste too much time, these boxes are
   * already self explanatory, but i really like thoroughness."
   *
   * They are self-explanatory as DATA ENTRY and they are not self-explanatory
   * as RISK. An EIN that does not match IRS records is a penalty; a legal name
   * that does not match the SS-4 delays processing; a trade name filled in
   * when it duplicates the legal name is contrary to the instructions. Those
   * are the parts worth reading, so those are the parts these lessons lead
   * with.
   * ───────────────────────────────────────────────────────────────────── */

  {
    formId: "form_941",
    box: "ein",
    headline: "The nine digits every filing is filed under \u2014 46-4217016",
    plainEnglish:
      "Greenway's Employer Identification Number, the federal account number for the business. " +
      "Every 941, every 940, every W-2 and W-3 is filed under it, and the IRS matches those " +
      "documents to each other by this number and nothing else. It appears twice on Form 941 " +
      "\u2014 the top of page 1 and the top of page 2 \u2014 and both must be filled in.",
    whereItComesFrom:
      "The company profile in Accounting \u2192 Company Info, stored once and printed on every form " +
      "that asks for it. It is never typed onto a form here. That is deliberate: a number that " +
      "is entered once and reused cannot be right on the 941 and wrong on the W-3, which is " +
      "exactly the failure the IRS instructions warn about.",
    howToReadIt:
      "Read it as the join key of the entire federal filing year. If the EIN on the 941s does not " +
      "match the EIN on the W-3, the year-end reconciliation the IRS runs has nothing to " +
      "reconcile against and the mismatch surfaces months later as a letter. Check it once a " +
      "year against an actual IRS notice, not against memory.",
    commonMistake:
      "Using a social security number, an ITIN, or a prior owner's EIN. Each is a penalty rather " +
      "than a typo, and an electronically filed return with an invalid EIN is rejected outright " +
      "rather than corrected.",
    whatToDo:
      "Compare the printed number against the EIN confirmation letter or a recent IRS notice, and " +
      "correct it in Company Info if it differs. Never correct it on the form.",
    examples: [
      {
        title: "Greenway's own",
        steps: [
          "The company profile holds 464217016 as nine digits with no punctuation.",
          "The form prints it in the IRS's own two-then-seven layout: 46 \u2013 4217016.",
          "The same nine digits print on page 2, on Form 940, and on the W-3.",
        ],
        answer: "46-4217016",
        moral:
          "One stored value, many forms. The hyphen is presentation; the digits are the account.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), Employer identification number (EIN)",
        quote:
          "Always be sure the EIN on the form you file exactly\nmatches the EIN the IRS assigned to your business. Don\u2019t\nuse your SSN or ITIN on forms that ask for an EIN.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "\u201CExactly\u201D is the operative word. Close is a rejected return, not an approximate one.",
      },
      {
        cite: "IRS Instructions for Form 941 (2026), Employer identification number (EIN)",
        quote:
          "Filing a\nForm 941 with an incorrect EIN or using another\nbusiness\u2019s EIN may result in penalties and delays in\nprocessing your return.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "This is why the number lives in one place in this product. Four entities means four " +
          "EINs, and the chance of borrowing the wrong one is real.",
      },
    ],
    tiesTo: [
      {
        formId: "form_940",
        box: "ein",
        why: "The same nine digits. The annual FUTA return and the four quarterly returns are matched to each other by this number.",
      },
      {
        formId: "form_w3",
        box: "e",
        why: "The W-3 carries the same EIN, and the IRS reconciles the four 941s against the W-3 using it. A mismatch means the reconciliation fails.",
      },
    ],
  },

  {
    formId: "form_941",
    box: "name",
    headline: "The legal name \u2014 the one on the SS-4, not the one on the sign",
    plainEnglish:
      "The business's legal name as it was given to the IRS when the EIN was applied for. For " +
      "Greenway that is LYMAN'S MARIJUANA L.L.C., which is not what the shop is called and not " +
      "what customers know. The IRS instructions are explicit that this line takes the name used " +
      "on the EIN application, and the trading name goes on the line below.",
    whereItComesFrom:
      "The legal name field of the company profile. It prints identically on page 1 and page 2 of " +
      "the 941, on Form 940 and on the W-3, because they all ask the same question.",
    howToReadIt:
      "Read it as a matching exercise, not a description. The only question that matters is " +
      "whether these characters are the ones in the IRS's file. A missing apostrophe or an " +
      "expanded \u201CL.L.C.\u201D is enough to make an automated match fail, and a failed match delays " +
      "processing rather than announcing itself.",
    commonMistake:
      "Entering the trading name because it is the name everyone uses. The two lines exist " +
      "precisely so the business can be identified by its legal name and recognised by its " +
      "trading name, and swapping them is the single most common identifier error on the form.",
    whatToDo:
      "Check the printed name character for character against the EIN confirmation letter. If it " +
      "differs, correct Company Info \u2014 and if the legal name has genuinely changed, write to the " +
      "IRS office where the returns are filed, because a name change is not something a form can " +
      "communicate on its own.",
    examples: [
      {
        title: "Which name goes where",
        steps: [
          "Legal name on the SS-4: LYMAN'S MARIJUANA L.L.C.",
          "Trading name on the door: GREENWAY MARIJUANA.",
          "Line \u201CName (not your trade name)\u201D takes LYMAN'S MARIJUANA L.L.C.",
          "Line \u201CTrade name (if any)\u201D takes GREENWAY MARIJUANA.",
        ],
        answer: "LYMAN'S MARIJUANA L.L.C.",
        moral:
          "The form's own caption \u2014 \u201Cnot your trade name\u201D \u2014 is there because this is the line " +
          "people get wrong.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), How Should You Complete Form 941?",
        quote:
          "Type or print your EIN, name, and address in the spaces\nprovided. Also enter your name and EIN on the top of\npage 2. Don\u2019t use your social security number (SSN) or\nindividual taxpayer identification number (ITIN). Generally,\nenter the business (legal) name you used when you\napplied for your EIN. For example, if you\u2019re a sole\nproprietor, enter \u201CHaleigh Smith\u201D on the \u201CName\u201D line and\n\u201CHaleigh\u2019s Cycles\u201D on the \u201CTrade name\u201D line. Leave the\n\u201CTrade name\u201D line blank if it is the same as your \u201CName.\u201D",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "The IRS's own worked example is exactly Greenway's situation: legal entity on one line, " +
          "shop name on the next.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "tradeName",
        why: "The two are a pair, and the instructions define each by reference to the other.",
      },
      {
        formId: "form_w3",
        box: "f",
        why: "The W-3 carries the employer's name for the same year. The IRS matches them, so they must be the same characters.",
      },
    ],
  },

  {
    formId: "form_941",
    box: "tradeName",
    headline: "The name on the door \u2014 and the rule about leaving it blank",
    plainEnglish:
      "The name Greenway actually trades under: GREENWAY MARIJUANA. It is here so the IRS can " +
      "recognise the business a human would recognise, while still filing it under its legal " +
      "name. The instructions add a rule that surprises people \u2014 if the trade name is the same " +
      "as the legal name, this line is left BLANK rather than repeated.",
    whereItComesFrom:
      "The trade name field of the company profile. Greenway's differs from its legal name, so " +
      "the line is printed rather than left empty.",
    howToReadIt:
      "Read it as the recognisable half of a two-part identifier. It carries no tax consequence " +
      "on its own, but it is the line that lets a person at the IRS, or Michael's CPA, see at a " +
      "glance which of the four entities this return belongs to \u2014 which matters a great deal " +
      "when four sets of forms are on the same desk.",
    commonMistake:
      "Repeating the legal name here when there is no separate trading name. The instructions say " +
      "to leave it blank, and a duplicated name is the kind of small inconsistency that makes " +
      "automated matching harder for no benefit.",
    whatToDo:
      "Confirm the printed trade name matches the name registered with the State \u2014 for Greenway, " +
      "the trade name on the UBI record. If the business ever trades under a single name, clear " +
      "the trade name field in Company Info rather than duplicating the legal one.",
    examples: [
      {
        title: "When the line stays empty",
        steps: [
          "A company whose legal name and trading name are both \u201CAcme Holdings LLC\u201D.",
          "The instructions: leave the Trade name line blank if it is the same as your Name.",
          "So the line prints nothing at all \u2014 and blank is the correct entry, not an omission.",
          "Greenway is the opposite case: two genuinely different names, so both lines print.",
        ],
        answer: "GREENWAY MARIJUANA",
        moral:
          "An empty box on a tax form is sometimes the right answer. This is one of the few " +
          "places the instructions say so outright.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), How Should You Complete Form 941?",
        quote:
          "Leave the\n\u201CTrade name\u201D line blank if it is the same as your \u201CName.\u201D",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "A rule with a definite answer, which is why this box is worth a lesson even though it " +
          "looks trivial. Blank is an instruction, not an oversight.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "name",
        why: "Defined against each other: the trade name is blank precisely when it would repeat the legal name.",
      },
    ],
  },

  {
    formId: "form_941",
    box: "address",
    headline: "Where the IRS writes to \u2014 and why a form cannot change it",
    plainEnglish:
      "The street address of the business: 4851 GEIGER RD SE. Every notice, every letter and " +
      "every refund the IRS sends about federal employment tax goes to the address it has on " +
      "file. Printing an address here does NOT update that file \u2014 that is the part worth " +
      "knowing, and it is the reason this box has a lesson at all.",
    whereItComesFrom:
      "The address fields of the company profile, printed on every form that asks. Nothing about " +
      "this box is computed.",
    howToReadIt:
      "Read it as a delivery instruction with a delay built in. An IRS notice that goes to a stale " +
      "address is still legally delivered, and the response clock still runs. The consequence of " +
      "a wrong address on this line is therefore not a filing error \u2014 it is missing a letter " +
      "whose deadline has already started.",
    commonMistake:
      "Assuming that changing the address on the return changes it at the IRS. It does not. The " +
      "IRS requires Form 8822-B for an address change, and it must be mailed separately \u2014 the " +
      "instructions say explicitly not to send it with the 941.",
    whatToDo:
      "If Greenway ever moves, file Form 8822-B separately as well as updating Company Info. Do " +
      "not rely on the next return to carry the message.",
    examples: [
      {
        title: "Moving premises",
        steps: [
          "The business relocates in March and Company Info is updated the same week.",
          "The Q1 941 prints the new address, so the return looks correct.",
          "The IRS still holds the old address, because a return does not change an address of record.",
          "A notice about Q4 of the prior year goes to the old premises, and the 30-day clock runs.",
          "Form 8822-B, mailed on its own, is what would have prevented it.",
        ],
        answer: "Form 8822-B",
        moral:
          "The form reports the address. It does not register it. Those are two different acts " +
          "and only one of them happens automatically.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), If you change your business name, business address, or responsible party",
        quote:
          "Complete and mail Form 8822-B to notify the IRS of a\nbusiness address or responsible party change. Don\u2019t mail\nForm 8822-B with your Form 941.",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "Two separate mailings. Enclosing the 8822-B with the return is the natural thing to do " +
          "and the instructions specifically forbid it.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "cityStateZip",
        why: "The other half of the same address. They are separate boxes on the paper and one fact in the books.",
      },
    ],
  },

  {
    formId: "form_941",
    box: "cityStateZip",
    headline: "City, state and ZIP \u2014 the half of the address that routes the mail",
    plainEnglish:
      "The second line of Greenway's address: PORT ORCHARD, WA 98366. The form splits the address " +
      "across two boxes because the IRS reads them as separate fields, not because they are " +
      "separate facts. The state matters beyond the postal service: WA is what makes Greenway " +
      "subject to Washington unemployment insurance, which is what the FUTA credit on Form 940 " +
      "depends on.",
    whereItComesFrom:
      "The city, state and postal code fields of the company profile, joined for printing. One " +
      "stored fact, one printed line.",
    howToReadIt:
      "Read the state code as more than an address. It is the state whose unemployment fund " +
      "Greenway pays into, and therefore the state that determines whether the 5.4% FUTA credit " +
      "is available and whether a credit reduction applies. An address in the wrong state would " +
      "be a filing inconsistency across two different agencies, not just bad post.",
    commonMistake:
      "A ZIP+4 typed into a field expecting five digits, or a state spelled out rather than " +
      "abbreviated. Neither invalidates the return, but both make the automated address match " +
      "fail, and a failed match is how a business ends up on a stale address without knowing it.",
    whatToDo:
      "Check the state code reads WA and the ZIP matches the ESD and Department of Revenue " +
      "records. Those three agencies should hold one address between them, not three.",
    examples: [
      {
        title: "Why the state code is a tax fact",
        steps: [
          "The address line says PORT ORCHARD, WA 98366.",
          "WA means Greenway pays Washington state unemployment tax to ESD.",
          "Paying state unemployment on time is what earns the 5.4% credit on Form 940.",
          "That credit is the difference between 6.0% and 0.6% FUTA \u2014 a ten-fold difference in " +
            "the annual federal unemployment bill.",
        ],
        answer: "WA",
        moral:
          "Two characters in the address box decide the size of an entire federal tax. That is " +
          "why it is worth reading rather than skipping.",
      },
    ],
    quotes: [
      {
        cite: "IRS Instructions for Form 941 (2026), How Should You Complete Form 941?",
        quote:
          "Type or print your EIN, name, and address in the spaces\nprovided. Also enter your name and EIN on the top of\npage 2. Don\u2019t use your social security number (SSN) or\nindividual taxpayer identification number (ITIN).",
        sourcePath: FORM_941_SOURCE_PATH,
        sourceUrl: FORM_941_SOURCE_URL,
        soWhat:
          "\u201CIn the spaces provided\u201D \u2014 the split across two boxes is the IRS's layout, and each " +
          "box is read as its own field.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "address",
        why: "The first half of the same address. Both are printed from the same stored profile.",
      },
      {
        formId: "form_940",
        box: "cityStateZip",
        why: "The state on this line is the state Form 940 line 1a names as Greenway's unemployment state. They must agree.",
      },
    ],
  },

];
