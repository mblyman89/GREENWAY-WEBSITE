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
];
