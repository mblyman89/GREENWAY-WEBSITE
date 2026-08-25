/**
 * src/lib/payroll/form-box-lessons-w2.ts
 *
 * ═══ THE W-2, BOX BY BOX ═══
 *
 * Michael, verbatim: "There should be a visual form for every single form in
 * its own tab."
 *
 * Form W-2 was the form with no lessons. `FORM_W2_LESSONS` already existed
 * elsewhere in this codebase, and looked like it filled this gap - but it is a
 * `MentorLesson`, not a `BoxLesson`, and the two teach different things:
 *
 *   MentorLesson  teaches a FUNCTION - what the W-2 is FOR, when it is due,
 *                 who gets a copy. One lesson for the whole form.
 *   BoxLesson     teaches a BOX - what goes in it, where the figure comes
 *                 from, what a wrong one looks like, and which boxes on OTHER
 *                 forms must agree with it. One lesson per box.
 *
 * The explorer consumes `BoxLesson` and cannot consume the other. So the W-2
 * tab would have rendered eight boxes that were not clickable, which is the
 * same defect this whole slice exists to remove, wearing a different hat: a
 * surface that looks interactive and teaches nothing (rule 39 - a gate that
 * parses nothing approves everything).
 *
 * ─── WHY THE W-2 IS THE MOST IMPORTANT FORM TO GET RIGHT ─────────────────
 *
 * Every other payroll form is between Greenway and a government. The W-2 goes
 * to the EMPLOYEE, and they file their own tax return from it. An error on the
 * 941 costs Greenway a notice; an error on a W-2 sends a real person's personal
 * tax return wrong, and then requires a W-2c, which is a separate filing with
 * its own deadline and its own penalty. It is also the form Michael's mother
 * received - and the reason her situation appears in the lessons below is that
 * it is a real Greenway fact, not a hypothetical.
 *
 * ─── EVERY QUOTE IS VERIFIED MECHANICALLY (rule 24, rule 35) ─────────────
 *
 * Every string in a `quote` field below was extracted from the mirrored IRS
 * corpus at FORM_W2_SOURCE_PATH with the line breaks the PDF actually has,
 * and a gate re-reads that file and asserts each one is present character for
 * character. Nothing here was typed from memory. The embedded newlines look
 * wrong and are correct: they are where the IRS's two-column layout wraps, and
 * "tidying" them would break the verification that makes the citation worth
 * anything.
 */

import type { BoxLesson } from "./form-box-core";

/** The mirrored corpus. The gate reads this file to verify every quote. */
export const FORM_W2_SOURCE_PATH = "docs/authorities/federal/irs-instructions-w-2-w-3-2026.txt";
/** Where Michael reads the real thing. Rendered as an href. */
export const FORM_W2_SOURCE_URL = "https://www.irs.gov/pub/irs-pdf/iw2w3.pdf";

/**
 * The 2026 Social Security wage base and the box 4 ceiling that follows from it.
 *
 * Both are QUOTED from the instructions rather than computed here, and the gate
 * asserts the sentence containing them is present in the corpus. The engine
 * owns the arithmetic; these exist so the teaching text and the worked examples
 * cannot drift from each other.
 */
export const SS_WAGE_BASE_2026_DOLLARS = 184_500;
export const BOX_4_CEILING_2026_DOLLARS = 11_439;

export const FORM_W2_BOX_LESSONS: readonly BoxLesson[] = [
  {
    formId: "form_w2",
    box: "1",
    headline: "The wage figure the employee copies onto their own tax return",
    plainEnglish:
      "Taxable wages for income tax purposes. This is the number the employee types into their " +
      "own Form 1040, so it is the single most consequential figure Greenway reports about " +
      "another person. It is NOT simply everything you paid them: pre-tax items come out first, " +
      "and certain items that are not cash go in.",
    whereItComesFrom:
      "The payroll engine totals every pay run for the calendar year, on a CASH basis - the date " +
      "the cheque was paid, not the period it covers - then subtracts the pre-tax deductions " +
      "that are exempt from income tax and adds any taxable non-cash compensation.",
    howToReadIt:
      "Compare box 1 with box 3 first, every time. If box 1 is SMALLER, someone has pre-tax " +
      "deductions that reduce income tax but not Social Security - a 401(k) deferral is the " +
      "classic case. If box 1 is LARGER, something taxable for income tax escaped Social " +
      "Security, or box 3 hit the wage base ceiling. Both differences are normal; neither should " +
      "be unexplained.",
    commonMistake:
      "Assuming box 1 must equal box 3 and box 5, and 'fixing' it when it does not. The three " +
      "boxes measure three different tax bases and are SUPPOSED to differ for good reasons. The " +
      "error is not that they differ - it is being unable to say why.",
    whatToDo:
      "Add box 2 of all four quarterly 941s for the year and confirm the total equals the sum of " +
      "box 1 across every W-2 you issue. Do this BEFORE filing, in January. The IRS runs exactly " +
      "this comparison and writes to you when it fails.",
    examples: [
      {
        title: "Why box 1 and box 3 differ for a Greenway budtender",
        steps: [
          "Gross pay for the year: $42,000.00.",
          "Employee deferred $2,000.00 into a 401(k). That is exempt from income tax but NOT from Social Security tax.",
          "Box 1 = $42,000.00 - $2,000.00 = $40,000.00.",
          "Box 3 = $42,000.00, because the deferral never reduced the Social Security base.",
        ],
        answer: "$40,000.00 in box 1 and $42,000.00 in box 3",
        moral:
          "A $2,000 gap between box 1 and box 3 is not an error. Being unable to name the $2,000 is.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 1",
        quote:
          "Box 1\u2014Wages, tips, other compensation. Show the\ntotal taxable wages, tips, and other compensation that you\npaid to your employee during the year. However, do not\ninclude elective deferrals (such as employee contributions\nto a section 401(k) or 403(b) plan) except section 501(c)\n(18) contributions.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "The IRS says in one sentence both what goes in (everything taxable you paid) and the " +
          "main thing that comes out (elective deferrals). That exclusion is the usual reason box 1 " +
          "is smaller than box 3.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "2",
        why:
          "The four quarterly line 2s must add up to the total of box 1 across every W-2. Same " +
          "wages, reported quarterly to the IRS and then annually to the employee. The IRS " +
          "compares them automatically and a mismatch generates a notice.",
      },
    ],
  },
  {
    formId: "form_w2",
    box: "2",
    headline: "Income tax you took out of their pay and sent to the IRS",
    plainEnglish:
      "The employee's own money, withheld from their wages across the year and paid to the IRS on " +
      "their behalf. Greenway never owned a cent of it. When they file their return, this is the " +
      "amount already credited against whatever they turn out to owe - which is why a wrong " +
      "figure here produces a wrong refund for a real person.",
    whereItComesFrom:
      "The sum of federal income tax withheld on every pay run for the calendar year, driven by " +
      "the employee's Form W-4 and the IRS withholding tables. It is not a percentage of anything " +
      "Greenway chose.",
    howToReadIt:
      "There is no 'correct' ratio to box 1 - a W-4 with dependents or extra withholding moves it " +
      "a long way. But a box 2 of zero on meaningful wages is worth a look: it usually means a " +
      "W-4 claiming exemption, which expires and must be re-filed each year.",
    commonMistake:
      "Including anything Greenway paid. This box is withholding ONLY. The employer's share of " +
      "Social Security and Medicare appears on no W-2 anywhere, and putting company money in an " +
      "employee's box 2 credits them with tax they never paid.",
    whatToDo:
      "Add line 3 of all four quarterly 941s and confirm it equals the total of box 2 across every " +
      "W-2. If a budtender's box 2 is zero, pull their W-4 and check whether the exemption was " +
      "renewed for the year.",
    examples: [
      {
        title: "The four-quarter reconciliation that prevents a notice",
        steps: [
          "941 line 3, Q1 through Q4: $1,200.00 + $1,310.00 + $1,255.00 + $1,485.00.",
          "Total withheld and reported quarterly: $5,250.00.",
          "Add box 2 across all W-2s issued for the year: $5,250.00.",
          "They agree, so the annual and quarterly stories match.",
        ],
        answer: "$5,250.00 both ways",
        moral:
          "This is the reconciliation the IRS performs whether or not you do. Doing it in January " +
          "costs an hour; not doing it costs a notice in the autumn.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 2",
        quote:
          "Box 2\u2014Federal income tax withheld. Show the total\nfederal income tax withheld from the employee\u2019s wages\nfor the year.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "\"Withheld from the employee's wages\" is the whole test. If it did not come out of their " +
          "pay, it does not belong in this box.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "3",
        why:
          "Four quarters of line 3 must equal the total of box 2 on every W-2. Same withheld " +
          "income tax, reported quarterly and then annually.",
      },
    ],
  },
  {
    formId: "form_w2",
    box: "3",
    headline: "Wages subject to Social Security — and this one has a ceiling",
    plainEnglish:
      "The wages Social Security tax was charged on. This is the one wage box with an annual CAP: " +
      `once an employee's pay for the year passes the wage base ($${SS_WAGE_BASE_2026_DOLLARS.toLocaleString("en-US")} ` +
      "for 2026), box 3 stops growing even though their pay keeps going. Note it says wages PAID " +
      "BEFORE payroll deductions - so most pre-tax deductions do not reduce it.",
    whereItComesFrom:
      "The engine tracks each person's year-to-date Social Security wages and stops adding once " +
      "the wage base is reached. Crossing the cap mid-year is the moment this box separates from " +
      "box 5, which has no cap at all.",
    howToReadIt:
      "If box 3 equals box 5, nobody crossed the ceiling - which at Greenway's wage levels is the " +
      "normal case for staff. If box 3 is LOWER than box 5, that person crossed it, and box 3 " +
      "should equal the wage base exactly. If box 3 is HIGHER than box 5, something is wrong: " +
      "there is no lawful way to owe Social Security on wages that escaped Medicare.",
    commonMistake:
      "Reducing box 3 by a pre-tax deduction that only reduces income tax. A 401(k) deferral cuts " +
      "box 1 and leaves box 3 alone. Cutting both understates Social Security wages, which " +
      "shortchanges the employee's own future benefit - an error that hurts them, not just the " +
      "government.",
    whatToDo:
      `Check every W-2 where box 3 is not equal to box 5. Box 3 should be exactly ` +
      `$${SS_WAGE_BASE_2026_DOLLARS.toLocaleString("en-US")} in those cases and nothing else. Any other ` +
      "number means the cap logic did not run cleanly.",
    examples: [
      {
        title: "An owner's salary that crosses the wage base",
        steps: [
          "Annual salary paid: $200,000.00.",
          `The 2026 Social Security wage base is $${SS_WAGE_BASE_2026_DOLLARS.toLocaleString("en-US")}.`,
          `Box 3 stops at $${SS_WAGE_BASE_2026_DOLLARS.toLocaleString("en-US")} - it cannot exceed the base.`,
          "Box 5 shows the full $200,000.00, because Medicare has no ceiling.",
        ],
        answer: `$${SS_WAGE_BASE_2026_DOLLARS.toLocaleString("en-US")} in box 3, $200,000.00 in box 5`,
        moral:
          "Box 3 and box 5 differing by a large amount is the signature of a high earner, not a bug.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 3",
        quote:
          "Box 3\u2014Social security wages. Show the total wages\npaid (before payroll deductions) subject to employee\nsocial security tax but not including social security tips and\nallocated tips.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "\"Before payroll deductions\" is the phrase that decides the 401(k) question. The deferral " +
          "reduces box 1 and does not reduce this box.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "5a",
        why:
          "941 line 5a is taxable Social Security wages for the quarter. Four quarters of the " +
          "line 5a wage column must equal the total of box 3 across every W-2 - the same wages, " +
          "counted twice for two different audiences.",
      },
    ],
  },
  {
    formId: "form_w2",
    box: "4",
    headline: "The employee's HALF of Social Security — never Greenway's half",
    plainEnglish:
      "The 6.2% of Social Security tax taken out of this person's pay. Only their half. Greenway " +
      "pays a matching 6.2% out of its own pocket and THAT AMOUNT APPEARS ON NO W-2 ANYWHERE. " +
      "This is the box that shows the split most plainly, and the one where confusing whose money " +
      "it is doubles the figure.",
    whereItComesFrom:
      "6.2% of box 3, accumulated pay run by pay run. Because box 3 is capped, this box is capped " +
      "too - and the instructions state the exact ceiling for the year.",
    howToReadIt:
      "Multiply box 3 by 6.2% and compare. It should match to the cent, or within a rounding cent " +
      "or two from per-period rounding. A figure noticeably larger than 6.2% of box 3 usually " +
      "means the employer half was added in by mistake.",
    commonMistake:
      "Reporting the combined 12.4%. The employer half is a Greenway expense, deductible on the " +
      "1120-S, and it is not the employee's tax. Putting it here credits them with tax they never " +
      "paid and overstates their withholding on their own return.",
    whatToDo:
      `Divide box 4 by box 3 on a sample of W-2s. If the answer is 12.4% rather than 6.2%, stop ` +
      `and fix it before filing. Also confirm no box 4 exceeds ` +
      `$${BOX_4_CEILING_2026_DOLLARS.toLocaleString("en-US")} for 2026.`,
    examples: [
      {
        title: "Checking box 4 against box 3",
        steps: [
          "Box 3 shows $42,000.00.",
          "6.2% of $42,000.00 = $2,604.00.",
          "Box 4 should read $2,604.00.",
          "If it reads $5,208.00, that is 12.4% - the employer half has been wrongly included.",
        ],
        answer: "$2,604.00",
        moral:
          "The doubled figure looks like a plausible tax amount, which is exactly why this check " +
          "has to be arithmetic rather than a glance.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 4",
        quote:
          "Box 4\u2014Social security tax withheld. Show the total\nemployee social security tax (not your share) withheld,\nincluding social security tax on tips. For 2026, the amount\nshould not exceed $11,439 ($184,500 \u00d7 6.2%).",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "\"(not your share)\" is the IRS saying the quiet part out loud, and it gives the exact " +
          "2026 ceiling: no box 4 may exceed $11,439.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "5a",
        why:
          "Line 5a of the 941 carries the FULL 12.4% - both halves in one box. Box 4 of the W-2 " +
          "carries only the employee 6.2%. So the annual total of box 4 should be HALF the tax " +
          "column of the four line 5as, and anyone expecting them to match will chase a phantom.",
      },
    ],
  },
  {
    formId: "form_w2",
    box: "5",
    headline: "Wages subject to Medicare — no ceiling at all",
    plainEnglish:
      "The wages Medicare tax was charged on. Same starting point as box 3, with one decisive " +
      "difference: there is NO wage base limit. Medicare keeps being charged on every dollar, " +
      "however much someone earns, which is why this is usually the largest wage box on the form.",
    whereItComesFrom:
      "The engine's year-to-date Medicare wages, which never stop accumulating. For anyone below " +
      "the Social Security wage base this equals box 3 exactly.",
    howToReadIt:
      "Box 5 is the best single measure of what a person really earned in a tax sense. It should " +
      "be greater than or equal to box 3, never less. Less is a genuine error and worth stopping " +
      "for.",
    commonMistake:
      "Applying the Social Security cap to this box because the two are computed side by side. " +
      "Capping box 5 understates Medicare wages and understates the tax in box 6 with it.",
    whatToDo:
      "Sort every W-2 by the difference between box 5 and box 3. Anything non-zero should be " +
      "explainable in one sentence - normally 'this person crossed the wage base'.",
    examples: [
      {
        title: "Why box 5 is the honest earnings figure",
        steps: [
          "A person is paid $200,000.00 for the year.",
          `Box 3 is capped at $${SS_WAGE_BASE_2026_DOLLARS.toLocaleString("en-US")}.`,
          "Box 1 may be lower still, if they deferred into a 401(k).",
          "Box 5 shows the full $200,000.00, because Medicare has no ceiling and deferrals do not reduce it.",
        ],
        answer: "$200,000.00",
        moral:
          "When three boxes disagree, box 5 is usually the one that reflects what was actually earned.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 5",
        quote:
          "Box 5\u2014Medicare wages and tips. The wages and tips\nsubject to Medicare tax are the same as those subject to\nsocial security tax (boxes 3 and 7) except that there is no\nwage base limit for Medicare tax.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "The IRS states the relationship between box 3 and box 5 in a single sentence: same " +
          "wages, no ceiling. That is the whole difference.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "5c",
        why:
          "941 line 5c is taxable Medicare wages for the quarter. Four quarters of its wage column " +
          "must equal the total of box 5 across every W-2.",
      },
    ],
  },
  {
    formId: "form_w2",
    box: "6",
    headline: "The employee's Medicare tax — again only their half",
    plainEnglish:
      "1.45% of box 5, withheld from the employee. Greenway matches it from its own money and that " +
      "match appears on no W-2. One extra wrinkle: an employee earning over $200,000 pays an " +
      "Additional Medicare Tax of 0.9% on the excess, which Greenway must withhold and which " +
      "belongs in THIS box - and Greenway does NOT match that part.",
    whereItComesFrom:
      "1.45% of box 5 accumulated across the year, plus any Additional Medicare Tax withheld once " +
      "an individual's wages pass $200,000.",
    howToReadIt:
      "Box 6 divided by box 5 should be 1.45% for everyone below $200,000. Above that threshold " +
      "the ratio rises, because the extra 0.9% is in the numerator only.",
    commonMistake:
      "Matching the Additional Medicare Tax. Greenway matches the ordinary 1.45% and matches " +
      "nothing of the 0.9% surcharge - it is the employee's alone. Matching it overpays the IRS " +
      "from company funds and misstates the return.",
    whatToDo:
      "Check box 6 against 1.45% of box 5 on every W-2. Where wages exceed $200,000, confirm the " +
      "extra 0.9% was withheld on the excess only, and that Greenway's own liability did not " +
      "increase by the same amount.",
    examples: [
      {
        title: "The ordinary case at Greenway",
        steps: [
          "Box 5 shows $42,000.00.",
          "1.45% of $42,000.00 = $609.00.",
          "Box 6 should read $609.00.",
          "Greenway separately pays $609.00 of its own money, which appears nowhere on this form.",
        ],
        answer: "$609.00",
        moral:
          "Two identical amounts, one belonging to the employee and one to the company, and only " +
          "one of them is ever printed on a W-2.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 6",
        quote:
          "Box 6\u2014Medicare tax withheld. Enter the total\nemployee Medicare tax (including any Additional\nMedicare Tax) withheld. Do not include your share.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "Two instructions in one: the Additional Medicare Tax DOES belong here, and Greenway's " +
          "own share does not.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "5c",
        why:
          "Line 5c carries the full 2.9% of Medicare, both halves. The annual total of box 6 should " +
          "be half of the four line 5c tax columns, before any Additional Medicare Tax is added.",
      },
    ],
  },
  {
    formId: "form_w2",
    box: "16",
    headline: "State wages — permanently blank in Washington",
    plainEnglish:
      "State wages for state income tax. Washington has no personal income tax, so Greenway has no " +
      "state wages to report and this box stays empty. That emptiness is CORRECT AND PERMANENT - " +
      "it is not a figure waiting to be found.",
    whereItComesFrom:
      "Nowhere, by design. There is no Washington personal income tax to compute a wage base for.",
    howToReadIt:
      "Blank is the right answer. A number appearing here means either an employee worked in " +
      "another state, or something was mapped to the wrong box - and in Washington the second is " +
      "far more likely than the first.",
    commonMistake:
      "Putting Paid Family and Medical Leave or WA Cares wages here because they are 'state' " +
      "amounts. They are state PREMIUMS, not state income tax, and belong in box 14. Reporting " +
      "them in box 16 tells the employee's tax software that Washington taxed their income, which " +
      "it did not.",
    whatToDo:
      "Confirm box 16 is empty on every Washington W-2 you issue. If any is populated, trace it " +
      "before filing - it is almost certainly PFML or WA Cares in the wrong box.",
    examples: [
      {
        title: "The blank that has to stay blank",
        steps: [
          "A Port Orchard budtender works only in Washington all year.",
          "Washington levies no personal income tax, so there is no state wage base.",
          "Box 16 is left empty - not zero, empty.",
          "Their PFML and WA Cares withholding is reported in box 14 with a label, where it belongs.",
        ],
        answer: "(blank)",
        moral:
          "A blank box and a box containing 0.00 are different statements. Here the blank is the " +
          "accurate one.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Boxes 15 through 20",
        quote:
          "Use these boxes to report state and\nlocal income tax information.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "\"State and local INCOME TAX information\" is the limit of what these boxes are for. " +
          "Paid Leave and WA Cares are not income tax, so they are outside it.",
      },
    ],
    tiesTo: [],
  },
  {
    formId: "form_w2",
    box: "17",
    headline: "State income tax withheld — always blank in Washington",
    plainEnglish:
      "State income tax withheld from the employee. Washington withholds no personal income tax, " +
      "so this is always empty for a Greenway employee. Washington DOES require withholding for " +
      "Paid Family and Medical Leave and for WA Cares - real money, really deducted - but neither " +
      "is an income tax and neither goes here.",
    whereItComesFrom:
      "Nowhere. No Washington personal income tax exists to withhold.",
    howToReadIt:
      "Blank. If a figure appears, ask which state imposed it. In Washington the answer is none, " +
      "so a number here is a mapping error.",
    commonMistake:
      "Reporting WA Cares or PFML withholding here so the employee 'gets credit' for it. They get " +
      "no credit - there is no Washington return to claim it on - and it makes their federal " +
      "software offer them a state income tax deduction they are not entitled to.",
    whatToDo:
      "Verify box 17 is blank on every W-2. Report PFML and WA Cares in box 14 with a clear label " +
      "so the employee can see what came out of their pay and why.",
    examples: [
      {
        title: "Where the Washington withholding actually goes",
        steps: [
          "WA Cares was withheld from the employee all year - real money, really deducted.",
          "It is a long-term care premium, not an income tax.",
          "Box 17 stays blank because Washington levies no income tax to withhold.",
          "The amount is shown in box 14, labelled, so the employee can see it and ask about it.",
        ],
        answer: "(blank in box 17; the amount appears in box 14)",
        moral:
          "Money really left the employee's pay and the correct income-tax box is still empty. " +
          "Where a figure goes is decided by what KIND of charge it is, not by whether it was paid.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Boxes 15 through 20",
        quote:
          "The state and local information boxes can be used to\nreport wages and taxes for two states and two localities.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "These boxes exist for states that tax wages. Washington is not one of them, so for " +
          "Greenway they stay empty however many people are on the payroll.",
      },
    ],
    tiesTo: [],
  },

  /* ═════════════════════════════════════════════════════════════════════════
   * §  THE TWELVE BOXES ADDED IN books-52
   *
   * Michael, August 2026: "i think there are line items/ boxes i should be
   * able to click to learn more that are not available yet."
   *
   * He was right, and it was measurable: this file taught 8 boxes against 19
   * numbered boxes on the W-2 he actually holds. The gap was not evenly
   * distributed either. It was boxes 7 through 15 and 18 through 20 - the
   * entire middle of the form - plus box 14, which is where his own filed 2025
   * W-2s carry an entry captioned HEALTH.
   *
   * EVERY QUOTE BELOW WAS TRANSCRIBED MECHANICALLY, NOT TYPED. A script read
   * the mirrored instructions, sliced the exact line ranges, escaped them, and
   * printed the string literals that appear here. Rule 24 says verbatim must be
   * mechanically verified rather than carefully typed; the safest way to obey
   * that is to never let a human hand touch the characters at all.
   * ═══════════════════════════════════════════════════════════════════════ */

  {
    formId: "form_w2",
    box: "7",
    headline: "Tips the employee told you about",
    plainEnglish:
      "Tips the employee reported to Greenway. Reporting them here does not make them a second " +
      "kind of pay - the same tips are ALSO included in box 1 and box 5. Box 7 exists so the " +
      "Social Security Administration can see how much of the wage figure came from tips.",
    whereItComesFrom:
      "Tip amounts the employee declared to the employer during the year. Not tips they kept " +
      "quiet about, and not tips Greenway estimated on their behalf - that is box 8.",
    howToReadIt:
      "Add box 3 and box 7 together and compare the total against the Social Security wage base. " +
      "That combined total is what the ceiling applies to. Reading box 3 alone against the base " +
      "understates how close an employee is to the cap.",
    commonMistake:
      "Treating box 7 as extra wages to be added to box 1. The tips are already in box 1. Adding " +
      "them again inflates the employee's taxable income and produces a wrong personal return.",
    whatToDo:
      "For Greenway this box is normally empty - a cannabis retailer's budtenders are paid wages, " +
      "not tips. If it is ever not empty, confirm the same amount is inside box 1 and box 5 " +
      "before the W-2 goes out.",
    examples: [
      {
        title: "Why the ceiling watches boxes 3 and 7 together",
        steps: [
          "An employee has $180,000.00 in box 3 and $6,000.00 in box 7.",
          "Box 3 alone is under the $184,500.00 Social Security wage base, so nothing looks wrong.",
          "But the instructions cap the TOTAL of boxes 3 and 7, and 180,000 + 6,000 = $186,000.00.",
          "That is $1,500.00 over the base, so Social Security was over-withheld.",
        ],
        answer: "$186,000.00 combined — $1,500.00 above the 2026 wage base",
        moral:
          "The box that breaches the ceiling is not always the box you were watching.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 7",
        quote:
          "Box 7\u2014Social security tips. Show the tips that the\nemployee reported to you even if you did not have enough\nemployee funds to collect the social security tax for the\ntips. The total of boxes 3 and 7 should not be more than\n$184,500 (the maximum social security wage base for\n2026). Report all tips in box 1 along with wages and other\ncompensation. Also include any tips reported in box 7 in\nbox 5.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "The instructions state the wage-base test on boxes 3 AND 7 combined, and they say the " +
          "same tips go in boxes 1, 5 and 7. One passage settles both the ceiling question and " +
          "the double-counting question.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "3",
        why:
          "Boxes 3 and 7 share one ceiling. Neither can be checked against the wage base on its " +
          "own, because the limit applies to their sum.",
      },
    ],
  },

  {
    formId: "form_w2",
    box: "8",
    headline: "Tips the employer assigned — and the one box deliberately in nothing else",
    plainEnglish:
      "Allocated tips are tips a large food or beverage establishment assigns to an employee " +
      "because reported tips fell below a threshold. This is the strangest box on the W-2: the " +
      "instructions explicitly say the amount is NOT included in boxes 1, 3, 5 or 7.",
    whereItComesFrom:
      "A tip allocation calculation that only applies to large food or beverage establishments, " +
      "reported on Form 8027. Greenway is a cannabis retailer and is not one.",
    howToReadIt:
      "If this box has a figure at Greenway, something is wrong with the payroll setup rather " +
      "than with the employee. It should be permanently empty for this business.",
    commonMistake:
      "Adding box 8 into box 1 to 'make the wages complete'. The exclusion is deliberate — the " +
      "employee accounts for allocated tips on their own return. Folding it into box 1 taxes it " +
      "twice.",
    whatToDo:
      "Leave it blank. If payroll software ever populates it, stop and find out why before " +
      "filing, because it means Greenway has been classified as a food or beverage establishment.",
    examples: [
      {
        title: "The box that feeds nothing",
        steps: [
          "Box 1, 3, 5 and 7 are built from wages and reported tips.",
          "An allocated tip figure of $500.00 is entered in box 8.",
          "Boxes 1, 3, 5 and 7 do NOT change — the instructions forbid including it.",
          "The employee resolves the $500.00 on their own Form 1040.",
        ],
        answer: "$500.00 in box 8 and no change to any other box",
        moral:
          "Most boxes on this form feed a total. This one is quarantined on purpose.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 8",
        quote:
          "Box 8\u2014Allocated tips (not applicable to Forms\nW-2AS, W-2CM, W-2GU, or W-2VI). If you operate a\nlarge food or beverage establishment, show the tips\nallocated to the employee. See the Instructions for Form\n8027, Employer\u2019s Annual Information Return of Tip\nIncome and Allocated Tips. Do not include this amount in\nbox 1, 3, 5, or 7.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "\"Do not include this amount in box 1, 3, 5, or 7\" is unusually blunt for the " +
          "instructions, and it is the whole reason this box cannot be reconciled like the others.",
      },
    ],
    tiesTo: [],
  },

  {
    formId: "form_w2",
    box: "9",
    headline: "The box that must stay empty",
    plainEnglish:
      "Box 9 is retired. It once carried an advance Earned Income Credit payment, that programme " +
      "ended, and the box was left on the form. The instruction for it is a single sentence: do " +
      "not enter an amount.",
    whereItComesFrom:
      "Nowhere. No payroll calculation produces a figure for this box.",
    howToReadIt:
      "Any number here is an error, full stop. There is no amount that is correct.",
    commonMistake:
      "Putting something in it because a blank box looks unfinished. A form with a deliberately " +
      "empty box is complete; the emptiness is the content.",
    whatToDo:
      "Leave it alone. This is a box to recognise and skip, which is exactly why it is worth " +
      "teaching — an unexplained blank invites someone to fill it.",
    examples: [
      {
        title: "The shortest instruction in the whole document",
        steps: [
          "Look up box 9 in the IRS instructions.",
          "The entire instruction reads: do not enter an amount in box 9.",
          "There is no exception, no threshold, and no special case.",
        ],
        answer: "(permanently blank)",
        moral:
          "Some boxes are answered by knowing there is nothing to answer.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 9",
        quote: "Box 9. Do not enter an amount in box 9.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "Unambiguous, and short enough to quote in full. There is no judgement to exercise here.",
      },
    ],
    tiesTo: [],
  },

  {
    formId: "form_w2",
    box: "10",
    headline: "Dependent care benefits, reported in full even above the limit",
    plainEnglish:
      "The total value of dependent care assistance Greenway provided or paid for. The important " +
      "and counter-intuitive part is that you report ALL of it, including any amount above the " +
      "$5,000 exclusion — you do not report only the taxable excess.",
    whereItComesFrom:
      "Amounts paid or incurred under a section 129 dependent care assistance programme, " +
      "including the fair market value of employer-provided daycare and amounts run through a " +
      "section 125 cafeteria plan.",
    howToReadIt:
      "A figure over $5,000 does not mean a mistake was made. It means part of the benefit is " +
      "taxable to the employee, which their own return works out.",
    commonMistake:
      "Reporting only the portion above the exclusion. The instructions say to report all " +
      "amounts paid or incurred regardless of forfeitures, including those in excess of the " +
      "$5,000 exclusion. Reporting the net understates the benefit provided.",
    whatToDo:
      "If Greenway ever offers dependent care assistance, report the gross figure and let the " +
      "employee's own return apply the exclusion. Do not do their arithmetic for them on a form " +
      "that is not theirs to correct.",
    examples: [
      {
        title: "Why $6,000 of benefit is reported as $6,000",
        steps: [
          "Greenway pays $6,000.00 of dependent care assistance for an employee.",
          "The exclusion is $5,000.00, so $1,000.00 of it is taxable to the employee.",
          "Box 10 shows $6,000.00 — the whole amount — not the $1,000.00 excess.",
          "The employee's Form 2441 works out the taxable part.",
        ],
        answer: "$6,000.00 in box 10",
        moral:
          "Box 10 reports what was provided. It is not a taxable-amount box.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 10",
        quote:
          "Box 10\u2014Dependent care benefits (not applicable to\nForms W-2AS, W-2CM, W-2GU, or W-2VI). Show the\ntotal dependent care benefits under a dependent care\nassistance program (section 129) paid or incurred by you",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "\"Show the total\" is the operative phrase. The box is a report of benefits provided, " +
          "not a computation of what is taxable.",
      },
    ],
    tiesTo: [],
  },

  {
    formId: "form_w2",
    box: "11",
    headline: "Nonqualified plan payouts — a timing signal, not a tax",
    plainEnglish:
      "Distributions from a nonqualified deferred compensation plan. This box does not create " +
      "any tax. It exists so the Social Security Administration can work out whether money paid " +
      "this year was actually EARNED in an earlier year, which matters for the earnings test " +
      "applied to people drawing benefits.",
    whereItComesFrom:
      "Payments out of a nonqualified plan or a nongovernmental section 457(b) plan. The same " +
      "money is also reported in box 1.",
    howToReadIt:
      "Read it as an annotation on box 1 rather than as an amount in its own right. It tells the " +
      "SSA that part of this year's box 1 belongs to a different year's work.",
    commonMistake:
      "Reporting a governmental section 457(b) distribution here. Those go on Form 1099-R " +
      "instead, not on the W-2 at all.",
    whatToDo:
      "Greenway has no nonqualified plan, so this stays blank. If one is ever set up, make only " +
      "ONE entry in this box and confirm the same money is in box 1.",
    examples: [
      {
        title: "Why the SSA cares which year the work happened",
        steps: [
          "A retired employee draws $20,000.00 from a nonqualified plan this year.",
          "The work that earned it was done years earlier.",
          "Box 1 includes the $20,000.00, because it is taxable now.",
          "Box 11 also shows it, telling the SSA not to treat it as current-year earnings.",
        ],
        answer: "$20,000.00 in box 1 and $20,000.00 in box 11",
        moral:
          "The same dollars appear twice on purpose, answering two different questions.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 11",
        quote:
          "Box 11\u2014Nonqualified plans. The purpose of box 11 is\nfor the SSA to determine if any part of the amount\nreported in box 1 or boxes 3 and/or 5 was earned in a prior\nyear. The SSA uses this information to verify that they\nhave properly applied the social security earnings test and\npaid the correct amount of benefits.\nReport distributions to an employee from a nonqualified\nplan or nongovernmental section 457(b) plan in box 11.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "The instructions state the box's PURPOSE outright, which is rare. Knowing it is a " +
          "timing signal for the earnings test explains why it duplicates box 1 rather than " +
          "adding to it.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "1",
        why:
          "A box 11 distribution is also inside box 1. The two are the same money, described " +
          "once as taxable and once as earned in an earlier year.",
      },
    ],
  },

  {
    formId: "form_w2",
    box: "12",
    headline: "The coded box — where the letter matters as much as the number",
    plainEnglish:
      "A set of up to four coded entries, each a capital letter followed by an amount. The code " +
      "is not decoration: code D is a 401(k) deferral, code DD is the cost of employer-sponsored " +
      "health coverage and is purely informational, code W is an HSA contribution. The same " +
      "dollar figure means completely different things under different letters.",
    whereItComesFrom:
      "Payroll deductions and employer-provided benefits, each mapped to the IRS code for that " +
      "item. The codes run from A through II.",
    howToReadIt:
      "Read the letter first. Code DD is the one that alarms people every year: it shows what " +
      "health coverage COST, is often five figures, and is not taxable to anybody. Code D, by " +
      "contrast, explains why box 1 is smaller than box 3.",
    commonMistake:
      "Assuming the sub-labels 12a, 12b, 12c and 12d mean something. They do not — the " +
      "instructions say the codes do not relate to where they are entered. Code D can go in 12a " +
      "or 12c and it is the same report.",
    whatToDo:
      "Never put more than four items in box 12 on Copy A. If a fifth is needed, use a second " +
      "Form W-2. And do not put section 414(h)(2) contributions here — those belong in box 14a.",
    examples: [
      {
        title: "Two codes, two completely different meanings",
        steps: [
          "Code D $2,000.00 — a 401(k) deferral. It reduced box 1 but not boxes 3 and 5.",
          "Code DD $14,000.00 — the cost of health coverage. It reduced nothing and is taxed nowhere.",
          "Both are amounts in box 12 and only one of them affects a single other figure.",
          "An employee seeing $14,000.00 often believes they are being taxed on it. They are not.",
        ],
        answer: "D 2000.00 and DD 14000.00",
        moral:
          "In box 12 the letter carries the meaning. The amount alone tells you nothing.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 12",
        quote:
          "Box 12\u2014Codes. Complete and code this box for all\nitems described below. Note that the codes do not relate\nto where they should be entered in boxes 12a through 12d\non Form W-2. For example, if you are only required to\nreport code D in box 12, you can enter code D and the\namount in box 12a of Form W-2. Report in box 12 any\nitems that are listed as codes A through II. Do not report in\nbox 12 section 414(h)(2) contributions (relating to certain",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "The instructions dispose of the most common confusion directly: 12a through 12d are " +
          "just slots, and the code carries the meaning wherever it sits.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "1",
        why:
          "A code D deferral is the usual reason box 1 is smaller than box 3. The explanation " +
          "for a gap between the wage boxes is often sitting in box 12.",
      },
    ],
  },

  {
    formId: "form_w2",
    box: "13",
    headline: "Three checkboxes that change how the whole form is read",
    plainEnglish:
      "Not an amount — three tick boxes: Statutory employee, Retirement plan, and Third-party " +
      "sick pay. Each one changes how the IRS interprets every other figure on the form.",
    whereItComesFrom:
      "The employee's classification and benefits, not from any calculation. Somebody has to " +
      "decide these, and the decision is a legal one.",
    howToReadIt:
      "The Retirement plan tick is the one with reach beyond this form: it can limit the " +
      "employee's ability to deduct an IRA contribution on their personal return. A wrong tick " +
      "produces a wrong personal deduction, not a payroll error.",
    commonMistake:
      "Ticking Statutory employee for a common-law employee. The instructions say not to, in " +
      "those words. Statutory employees are a narrow list — certain drivers, full-time life " +
      "insurance agents, homeworkers on employer-supplied materials — and a budtender is not " +
      "among them.",
    whatToDo:
      "Leave Statutory employee unticked for every Greenway employee. Tick Retirement plan only " +
      "if the employee was genuinely an active participant in one during the year.",
    examples: [
      {
        title: "A tick with no dollar value that still changes a tax return",
        steps: [
          "An employee contributes nothing to a retirement plan but the Retirement plan box is ticked in error.",
          "No figure on the W-2 changes — box 13 holds no amount.",
          "The employee's ability to deduct a traditional IRA contribution is now restricted by income limits that should not apply.",
          "They lose a deduction because of a tick mark.",
        ],
        answer: "(no dollar amount, and a real tax consequence)",
        moral:
          "A box does not need a number in it to be worth getting right.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 13",
        quote:
          "Box 13\u2014Checkboxes. Check all boxes that apply.\nStatutory employee. Check this box for statutory\nemployees whose earnings are subject to social security\nand Medicare taxes but not subject to federal income tax\nwithholding. Do not check this box for common-law\nemployees. There are workers who are independent\ncontractors under the common-law rules but are treated\nby statute as employees. They are called \u201cstatutory",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "\"Do not check this box for common-law employees\" is the sentence that keeps a normal " +
          "hourly worker from being mis-tagged. Greenway's staff are common-law employees.",
      },
    ],
    tiesTo: [],
  },

  {
    formId: "form_w2",
    box: "14",
    headline: "The free-text box — and the one Michael's own W-2s use",
    plainEnglish:
      "A labelled, free-form box for anything the employee should know that has no box of its " +
      "own. The instructions list examples, and health insurance premiums deducted is one of " +
      "them by name. Washington's Paid Family and Medical Leave and WA Cares withholding belong " +
      "here too, because they are not income tax.",
    whereItComesFrom:
      "Whatever Greenway chooses to disclose, each item labelled. It is the only box on the form " +
      "where the employer writes the caption as well as the figure.",
    howToReadIt:
      "Box 14 explains, it does not compute. Nothing on the form is derived from it, and no tax " +
      "is calculated from it. But it is often the box that answers 'why is my pay different from " +
      "my wages'.",
    commonMistake:
      "Believing box 14 proves how an amount was TREATED. It does not. The caption is written by " +
      "the employer and is not authority for the tax treatment of the amount beside it. Whether " +
      "something was handled correctly is settled by boxes 1, 3 and 5 — never by box 14's label.",
    whatToDo:
      "Label every item. And when a box 14 figure represents something with a tax consequence — " +
      "a shareholder's health premium being the live example at Greenway — confirm the treatment " +
      "in boxes 1, 3 and 5 with the preparer rather than inferring it from the caption.",
    examples: [
      {
        title: "A real Greenway box 14, and the question it raises",
        steps: [
          "On the filed 2025 W-2 for Teri Becker, box 14 is captioned HEALTH with 11,029.32.",
          "Box 1 on that same W-2 is 11,029.32 — identical to the penny.",
          "That is consistent with the premium having BEEN the compensation, which is what Michael described.",
          "It does not by itself establish that the boxes 3 and 5 treatment is right — box 14 is a label, not a determination.",
        ],
        answer: "HEALTH 11,029.32 against box 1 of 11,029.32",
        moral:
          "Box 14 is where you notice a question. It is not where you answer it.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 14a",
        quote:
          "Box 14a\u2014Other. If you included 100% of a vehicle\u2019s\nannual lease value in the employee\u2019s income, it must also\nbe reported here or on a separate statement to your\nemployee.\nYou may also use this box for any other information that",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "The box has one mandatory use — the vehicle lease value — and is otherwise open. That " +
          "openness is why its caption carries no authority.",
      },
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Box 14a, examples",
        quote:
          "you want to give to your employee. Label each item.\nExamples include state disability insurance taxes\nwithheld, union dues, uniform payments, health insurance\npremiums deducted, nontaxable income, educational\nassistance payments, or a minister\u2019s parsonage allowance\nand utilities. In addition, you may enter the following",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "\"health insurance premiums deducted\" is named in the instructions as an example of a " +
          "box 14 item, and \"Label each item\" is an instruction rather than a suggestion. This " +
          "is the authority behind the HEALTH caption on Greenway's own filed W-2s.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "1",
        why:
          "A box 14 item may or may not be inside box 1, and which it is cannot be told from " +
          "box 14 itself. When the two are equal, as on a Greenway W-2, that is worth asking " +
          "the preparer about rather than assuming.",
      },
    ],
  },

  {
    formId: "form_w2",
    box: "15",
    headline: "The state and the state ID number",
    plainEnglish:
      "The two-letter state abbreviation and Greenway's state employer ID number. Not an amount " +
      "— an identifier that tells the reader which state the boxes beside it refer to.",
    whereItComesFrom:
      "The state abbreviation, and the ID number that the individual state assigns to the " +
      "employer. It is not issued by the IRS.",
    howToReadIt:
      "For Greenway this reads WA, with boxes 16 and 17 beside it empty. That combination — a " +
      "state named, no state wages, no state tax — is correct and permanent in Washington.",
    commonMistake:
      "Putting the federal EIN here. Box b already holds the federal EIN; box 15 wants the " +
      "state's own number, which is a different identifier from a different agency.",
    whatToDo:
      "Enter WA. If Greenway ever employs someone in a second state, keep each state's rows " +
      "separated by the broken line, and use a second W-2 beyond two states.",
    examples: [
      {
        title: "A named state with nothing beside it",
        steps: [
          "Box 15 shows WA and the state ID number.",
          "Box 16, state wages, is blank.",
          "Box 17, state income tax, is blank.",
          "All three are correct together, because Washington levies no personal income tax.",
        ],
        answer: "WA, with boxes 16 and 17 empty",
        moral:
          "Naming the state and reporting nothing for it is the right answer here, not an omission.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Boxes 15 through 20",
        quote:
          "Boxes 15 through 20\u2014State and local income tax in-\nformation (not applicable to Forms W-2AS, W-2CM,\nW-2GU, or W-2VI). Use these boxes to report state and\nlocal income tax information. Enter the two-letter\nabbreviation for the name of the state. The employer\u2019s\nstate ID numbers are assigned by the individual states.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "The state ID number is assigned by the state, not the IRS — which is why the federal " +
          "EIN in box b is the wrong number to copy here.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "16",
        why:
          "Box 15 names the state that box 16's wages belong to. A wage figure with no state " +
          "beside it cannot be attributed to any tax authority.",
      },
    ],
  },

  {
    formId: "form_w2",
    box: "18",
    headline: "Local wages — blank in Washington",
    plainEnglish:
      "Wages subject to a city or county income tax. Some states have local income taxes layered " +
      "under the state one. Washington has neither, so this box stays empty for every Greenway " +
      "employee.",
    whereItComesFrom:
      "Nowhere, for Greenway. In a jurisdiction with a local income tax it would be that " +
      "locality's own wage base, which is not always the same as the state or federal figure.",
    howToReadIt:
      "Empty is correct. A figure here would assert that Port Orchard levies an income tax on " +
      "wages, which it does not.",
    commonMistake:
      "Copying box 1 into box 18 to keep the row looking consistent. That claims a local wage " +
      "base that does not exist.",
    whatToDo:
      "Leave blank. Do not confuse this with the Port Orchard LOCAL SALES TAX that appears on " +
      "Greenway's DOR excise return — that is a tax on sales, has nothing to do with wages, and " +
      "never touches a W-2.",
    examples: [
      {
        title: "Two different things both called 'local'",
        steps: [
          "Greenway's DOR excise return shows a Port Orchard local line at a 0.028 rate on sales.",
          "That is a local SALES tax, charged on what customers buy.",
          "Box 18 is for local INCOME tax, charged on what employees earn.",
          "Washington has the first and not the second, so box 18 stays blank.",
        ],
        answer: "(blank)",
        moral:
          "A local tax existing does not mean a local INCOME tax exists.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Boxes 15 through 20",
        quote:
          "Use these boxes to report state and\nlocal income tax information.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "These boxes are scoped to state and local INCOME tax. A sales tax, however local, is " +
          "outside their scope entirely.",
      },
    ],
    tiesTo: [],
  },

  {
    formId: "form_w2",
    box: "19",
    headline: "Local income tax withheld — the employee's money, and none of it here",
    plainEnglish:
      "Local income tax actually withheld from the employee's pay. Where it exists it is the " +
      "employee's own money, held by the employer and passed on. In Washington there is no local " +
      "income tax, so nothing is withheld and the box is empty.",
    whereItComesFrom:
      "Withholding from paycheques in a locality that levies an income tax. Greenway has none.",
    howToReadIt:
      "Blank. If a figure ever appeared here it would mean money had been taken from an " +
      "employee's pay for a tax that does not exist — a real loss to a real person.",
    commonMistake:
      "Recording Washington's Paid Family and Medical Leave or WA Cares withholding here because " +
      "it is a state-level deduction that genuinely came out of pay. Those are not income taxes " +
      "and belong in box 14.",
    whatToDo:
      "Leave blank, and put PFML and WA Cares in box 14 with a label. If this box is ever " +
      "populated, treat it as an urgent payroll configuration error, not a filing question.",
    examples: [
      {
        title: "Money left the paycheque and this box is still empty",
        steps: [
          "WA Cares withholding of $58.00 comes out of an employee's pay across the year.",
          "It is a long-term care premium, not an income tax.",
          "Box 19 stays blank because no local income tax was withheld.",
          "The $58.00 is disclosed in box 14, labelled, so the employee can see it.",
        ],
        answer: "(blank in box 19; disclosed in box 14)",
        moral:
          "Which box a deduction goes in is decided by what kind of charge it is, not by whether " +
          "the employee felt it.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Boxes 15 through 20",
        quote:
          "The state and local information boxes can be used to\nreport wages and taxes for two states and two localities.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "The boxes accommodate two localities for employers who need them. Greenway needs " +
          "none, so the pair stays empty.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "17",
        why:
          "Boxes 17 and 19 are the state and local versions of the same idea, and both are " +
          "permanently blank in Washington for the same reason.",
      },
    ],
  },

  {
    formId: "form_w2",
    box: "20",
    headline: "The name of the locality",
    plainEnglish:
      "The name of the city or district whose local income tax appears in boxes 18 and 19. A " +
      "label, not an amount. Blank for Greenway because there is no such locality.",
    whereItComesFrom:
      "The locality imposing the income tax. There is none for a Washington employer.",
    howToReadIt:
      "Empty, and correct. A locality name with no figures beside it would be as odd as figures " +
      "with no name.",
    commonMistake:
      "Writing PORT ORCHARD here because that is where the shop is. Box 20 identifies a taxing " +
      "locality, not a physical location. The employer's address already lives in box c.",
    whatToDo:
      "Leave blank. Boxes 18, 19 and 20 are a set — all three empty, or all three populated.",
    examples: [
      {
        title: "Where the business is, versus which locality taxes it",
        steps: [
          "Greenway operates in Port Orchard, Washington.",
          "The address appears in box c, the employer address box.",
          "Port Orchard levies no local income tax on wages.",
          "So box 20 is blank, even though the business plainly has a location.",
        ],
        answer: "(blank)",
        moral:
          "Having an address is not the same as having a taxing locality.",
      },
    ],
    quotes: [
      {
        cite: "IRS General Instructions for Forms W-2 and W-3 (2026), Boxes 15 through 20",
        quote:
          "Keep each state\u2019s and locality\u2019s information separated by\nthe broken line.",
        sourcePath: FORM_W2_SOURCE_PATH,
        sourceUrl: FORM_W2_SOURCE_URL,
        soWhat:
          "The locality boxes are grouped as a unit, separated per locality. That grouping is why " +
          "18, 19 and 20 are filled or empty together.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "18",
        why:
          "Box 20 names the locality whose wages are in box 18. Neither means anything without " +
          "the other.",
      },
    ],
  },
];
