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
          "Enter the number of employees on your payroll for the pay\nperiod including March 12, June 12, September 12, or\nDecember 12, for the quarter indicated at the top of Form\n941.",
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
        quote: "Enter the amount before payroll deductions.",
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
        quote: "Enter all wages,",
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
];
