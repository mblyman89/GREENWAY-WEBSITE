/**
 * src/lib/payroll/form-w2-mentor.ts   (books-46)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TEACHING LAYER FOR THE W-2 AND W-3
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE DATA ONLY. No `node:fs`, no imports that reach the filesystem, because
 * this is read by client components. The coverage gates that DO read files live
 * in `form-w2-mentor-gates.ts` (standing rule 65b — in books-33 the two lived
 * together, `node:fs` reached a browser bundle, and every deployment broke
 * while CI stayed green).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT MAKES THE W-2 DIFFERENT FROM EVERY OTHER FORM IN THIS SYSTEM
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Nothing on it is a decision. There is no election, no method, no judgement
 * call — every box is a copy of something twenty-six pay runs already
 * determined months earlier. That single fact cuts two ways, and both belong in
 * the teaching:
 *
 * THE GOOD NEWS. A W-2 engine cannot make a tax mistake, because it does not
 * compute tax. It can only make a TRANSCRIPTION mistake. So the right mental
 * model is not "a calculator I must check" but "a copier I must reconcile".
 *
 * THE BAD NEWS, and the reason January is the wrong month to find out: because
 * the W-2 only re-reports, an error IN it is almost never an error OF it. It is
 * an error made in March that nobody noticed, surfacing in January with a
 * deadline attached. By then the four 941s are filed and the money is paid, so
 * fixing it means Forms W-2c, W-3c and 941-X rather than editing a box.
 *
 * THAT IS WHY THE RECONCILIATION MATTERS MORE THAN THE FORM GENERATOR, and why
 * the lessons below spend more words on October than on January.
 */

import type { W2RefusalCode } from "@/lib/payroll/form-w2-core";

/* ══════════════════════════════════════════════════════════════════════════
 * §1  THE PRE-FILING CHECKLIST
 *
 * Ordered by WHEN IT IS STILL CHEAP TO FIX, not by the order the boxes appear
 * on the form. A checklist sorted by the form teaches you to read the form; a
 * checklist sorted by cost teaches you when to look.
 * ══════════════════════════════════════════════════════════════════════════ */

export type W2CheckKey =
  | "reconcile-in-october"
  | "names-and-numbers"
  | "shareholder-premium-recorded"
  | "box-17-is-blank"
  | "box-12-fits-on-copy-a"
  | "voids-excluded"
  | "w3-matches-the-941s"
  | "read-your-own-w2";

export type W2Check = {
  readonly key: W2CheckKey;
  readonly order: number;
  /** The question, phrased so that "no" is obviously a problem. */
  readonly question: string;
  /** Why it sits at this point in the order and not later. */
  readonly whyThisOrder: string;
  /** The physical action that answers it. Never "verify the data". */
  readonly howToCheck: string;
  /** What it costs to get this one wrong, in money or in filings. */
  readonly ifItFails: string;
};

export const FORM_W2_CHECKS: readonly W2Check[] = [
  {
    key: "reconcile-in-october",
    order: 1,
    question:
      "Have you run the W-3-to-941 comparison BEFORE the year ends, while a mistake is still an adjustment rather than an amendment?",
    whyThisOrder:
      "This is first because it is the only item on the list whose cost depends entirely on the date you do it. " +
      "Run it in October and a bad quarter is a correction on the next 941. Run it on January 30th and the same " +
      "error costs a 941-X, a W-2c and a W-3c, three filings to fix one number. Nothing else here has that property.",
    howToCheck:
      "Open the W-2 page after the third quarter is filed and press the reconcile button with three quarters loaded. " +
      "It will tell you the comparison is incomplete - that is expected and correct. You are not looking for a green " +
      "tick, you are looking at whether the three quarters you DO have already disagree.",
    ifItFails:
      "Nothing yet, and that is the point. A variance found in October is a bookkeeping task; the identical variance " +
      "found in February is three amended returns and a letter you have to answer.",
  },
  {
    key: "names-and-numbers",
    order: 2,
    question:
      "Does every name on a W-2 match the Social Security card exactly, and is every SSN nine digits?",
    whyThisOrder:
      "Second because it is the error the SSA rejects OUTRIGHT rather than questioning, and because it is the only " +
      "item you can fix by asking somebody a question. The IRS lists 'misformat the employee's name' on its own " +
      "list of common errors - it is common precisely because it looks too trivial to check.",
    howToCheck:
      "Put the card, or a copy of it, next to the screen. First name and middle initial in one field, surname in the " +
      "second, suffix like 'Jr.' in the third. Not 'Mike' if the card says 'Michael'. Not a married name the SSA has " +
      "not been told about.",
    ifItFails:
      "The SSA cannot match the wage report to a person. The wages may not be credited to that employee's earnings " +
      "record, which affects their eventual benefit, and you get a notice asking you to correct it.",
  },
  {
    key: "shareholder-premium-recorded",
    order: 3,
    question:
      "If Greenway paid health insurance for Michael, has that premium been recorded as wages BEFORE the last pay run of the year?",
    whyThisOrder:
      "Third because it has a deadline inside the year that nothing on the form will remind you about. The premium " +
      "has to be run through payroll to land in box 1. Discovering in January that it never was means the W-2 is " +
      "wrong the moment it is printed.",
    howToCheck:
      "Look at the shareholder's year-to-date figures and ask whether box 1 is higher than box 5. If the company paid " +
      "premiums and those two numbers are equal, the premium never went through payroll.",
    ifItFails:
      "Box 1 understates his income, and - the part people miss - he then cannot take the self-employed health " +
      "insurance deduction on the front of his 1040, because that deduction is only available BECAUSE the premium " +
      "was on the W-2 first. Missing it costs him the deduction as well as the accuracy.",
  },
  {
    key: "box-17-is-blank",
    order: 4,
    question: "Is box 17 empty on every single form?",
    whyThisOrder:
      "Fourth because it is the one error a conscientious person is MORE likely to make than a careless one. " +
      "Washington money genuinely was withheld; the box says 'State income tax'; filling it in feels like accuracy.",
    howToCheck:
      "Look down the box 17 column. Every cell blank. If PFML or WA Cares appears anywhere in it, move the figure to " +
      "box 14 with a label.",
    ifItFails:
      "You have reported state income tax withheld to a state that levies no income tax. There is no state return " +
      "for it ever to match against, and the employee may try to claim a refund of a tax that does not exist.",
  },
  {
    key: "box-12-fits-on-copy-a",
    order: 5,
    question: "Does anyone have more than four box 12 items?",
    whyThisOrder:
      "Fifth because it is a printing constraint rather than a tax one, and because the fix - a second W-2 for the " +
      "same person - has a knock-on effect on the electronic-filing count that is easy to miss.",
    howToCheck: "Count the box 12 lines per employee. Four is the maximum Copy A holds.",
    ifItFails:
      "The fifth item has nowhere to go. You need a second W-2 for that employee, and that second form counts " +
      "separately toward the ten-return threshold that forces electronic filing.",
  },
  {
    key: "voids-excluded",
    order: 6,
    question: "Do the W-3 totals exclude every form marked VOID?",
    whyThisOrder:
      "Sixth because it is invisible on the individual forms. Every W-2 underneath can be perfectly correct while " +
      "the W-3 above them is wrong, which makes it one of the hardest errors to find by looking.",
    howToCheck:
      "Compare the form count on the W-3 against the number of people you actually paid. If a form was voided and " +
      "reissued, the count should be the number of PEOPLE, not the number of rows.",
    ifItFails:
      "The W-3 overstates wages by the whole voided form, so it disagrees with the four 941s - and you will spend a " +
      "day checking individual W-2s that are all correct.",
  },
  {
    key: "w3-matches-the-941s",
    order: 7,
    question:
      "Do the five reconciling figures agree exactly with the four Forms 941 you already filed?",
    whyThisOrder:
      "Seventh because it cannot be done until the fourth quarter is closed, not because it is unimportant. This is " +
      "the check the IRS itself performs.",
    howToCheck:
      "Load all four 941s and press reconcile. Federal income tax and both wage figures must match exactly. The two " +
      "tax figures should be double, because the 941 carries the employer's half as well as the employee's.",
    ifItFails:
      "The IRS instruction says you WILL be contacted, not that you may be. Find the cause before filing rather " +
      "than after: a disagreement you have already explained to yourself is a letter you answer in ten minutes.",
  },
  {
    key: "read-your-own-w2",
    order: 8,
    question:
      "Have you read your OWN W-2 as though a stranger handed it to you, and can you explain every difference between the boxes?",
    whyThisOrder:
      "Last, because it is the only check that catches the error nobody anticipated. Every other item on this list " +
      "looks for a known failure. This one looks for the unknown one.",
    howToCheck:
      "Cover the screen's explanations. Ask: why is box 1 not the same as box 5? Why is box 3 lower than box 5, or " +
      "why is it not? If you cannot answer without help, the answer is worth finding now.",
    ifItFails:
      "You file something you cannot explain. That is survivable right up until somebody asks, and the person most " +
      "likely to ask about Michael's W-2 is Michael's own tax preparer, in April.",
  },
];

export function w2ChecksInOrder(): readonly W2Check[] {
  return [...FORM_W2_CHECKS].sort((a, b) => a.order - b.order);
}

/* ══════════════════════════════════════════════════════════════════════════
 * §2  A LESSON FOR EVERY REFUSAL
 *
 * The engine refuses in twelve places. Each one is a moment where Michael is
 * stopped and needs to know what happened, what to do, and why the system
 * declined to guess. A refusal without a lesson is an obstacle.
 * ══════════════════════════════════════════════════════════════════════════ */

export type W2RefusalLesson = {
  readonly code: W2RefusalCode;
  /** One line, big and calm, at the top of the panel. */
  readonly headline: string;
  /** What has actually gone wrong, without jargon. */
  readonly whatHappened: string;
  /** The specific next action. Never "check the data". */
  readonly howToFix: string;
  /** Why the system refuses instead of guessing - the cost of the guess. */
  readonly whyWeRefuse: string;
};

export const FORM_W2_REFUSAL_LESSONS: readonly W2RefusalLesson[] = [
  {
    code: "W2_YEAR_MISMATCH",
    headline: "The form and the figures are from different years.",
    whatHappened:
      "You asked for a W-2 for one tax year, but the year-to-date totals handed to it belong to another one.",
    howToFix:
      "Load the accumulator for the same year as the form. If you are reissuing an old W-2, change the year on the " +
      "form rather than borrowing this year's numbers.",
    whyWeRefuse:
      "A W-2 built from the wrong year's wages is internally perfect and matches no Form 941 on earth. It would " +
      "pass every eye that looked at it and fail the only comparison that counts.",
  },
  {
    code: "W2_EMPLOYEE_MISMATCH",
    headline: "These wages belong to somebody else.",
    whatHappened:
      "The form is for one employee and the year-to-date figures are filed under a different employee id.",
    howToFix: "Load this person's own accumulator.",
    whyWeRefuse:
      "One person's wages on another person's W-2 is the hardest payroll error to find after the fact, because both " +
      "forms look reasonable and the totals still foot. It usually surfaces when an employee says the number is wrong " +
      "and cannot say why.",
  },
  {
    code: "W2_NEGATIVE_AMOUNT",
    headline: "A W-2 cannot report a negative number.",
    whatHappened: "One of the wage or withholding figures is below zero.",
    howToFix:
      "Find the pay run that produced it. If you are correcting an overpayment from a PRIOR year, that is a Form " +
      "W-2c against that year, not a negative figure in this one.",
    whyWeRefuse:
      "There is no box on the form that means 'minus'. Filing a negative would either be silently read as a positive " +
      "or rejected outright, and neither outcome tells you what actually happened.",
  },
  {
    code: "W2_NON_INTEGER_AMOUNT",
    headline: "Somewhere upstream, a division did not decide where the remainder went.",
    whatHappened: "A money figure arrived with a fraction of a cent attached.",
    howToFix:
      "Trace it back to the calculation that produced it. Every rate in this system is applied in whole cents with " +
      "the rounding decided explicitly, so a fraction here means something bypassed that.",
    whyWeRefuse:
      "A fraction of a cent cannot be printed on the form at all, so it must be rounded by somebody. If the system " +
      "rounds silently, the total stops matching the sum of its parts and no one can say by how much or why.",
  },
  {
    code: "W2_BOX_17_MUST_BE_BLANK_IN_WA",
    headline: "Washington has no income tax, so box 17 has nothing to report.",
    whatHappened:
      "A state income tax figure was entered on a Washington W-2. It is almost certainly Paid Family and Medical " +
      "Leave or WA Cares - real money, correctly withheld, in the wrong box.",
    howToFix:
      "Move it to box 14 and give it a label, 'WA PFML' or 'WA Cares'. Box 14 is free text and exists for exactly this.",
    whyWeRefuse:
      "This is refused rather than warned because there is no set of facts in which a Washington employer has state " +
      "income tax to report. A warning you can click past is a warning you will click past in February at 11pm.",
  },
  {
    code: "W2_PREMIUM_WITHOUT_SHAREHOLDER_STATUS",
    headline: "A shareholder health premium is recorded against someone who is not a shareholder.",
    whatHappened:
      "An S-corporation health premium was attached to an employee who is not a 2%-or-more shareholder-employee. " +
      "Either it is the wrong person, or their shareholder status has never been recorded.",
    howToFix:
      "If they really are a 2%-or-more shareholder, record that first. If they are an ordinary employee, the health " +
      "cover is a tax-free benefit: it belongs in box 12 with code DD and does NOT go in box 1.",
    whyWeRefuse:
      "The two treatments are opposites. Guess wrong toward the shareholder rule and you have made a tax-free " +
      "benefit taxable for an ordinary employee. Guess wrong the other way and the shareholder loses a deduction.",
  },
  {
    code: "W2_BOX_12_TOO_MANY_ITEMS",
    headline: "Copy A holds four box 12 items, and there are more than four.",
    whatHappened: "This employee has five or more coded items and the paper form has room for four.",
    howToFix:
      "Issue a second W-2 for the same employee carrying the extra items. Do not combine two different codes into " +
      "one line to make them fit.",
    whyWeRefuse:
      "The limit is physical - there are four slots, 12a to 12d. And the second form matters beyond the printing: " +
      "it counts as another return against the ten-return threshold that forces electronic filing.",
  },
  {
    code: "W2_BOX_12_DUPLICATE_CODE",
    headline: "The same box 12 code appears twice.",
    whatHappened: "Two separate lines carry the same code, for example code D listed on two rows.",
    howToFix: "Add the amounts together and report the code once.",
    whyWeRefuse:
      "Two lines with one code read to the SSA as either a duplicate submission or a contradiction, and it also " +
      "burns one of the four available slots for no benefit.",
  },
  {
    code: "W2_BOX_4_EXCEEDS_CEILING",
    headline: "More Social Security tax was withheld than a single year can produce.",
    whatHappened:
      "Box 4 is above the annual maximum, which for 2026 is $11,439 - that is the $184,500 wage base times 6.2%.",
    howToFix:
      "Check whether a pay run kept charging Social Security after the employee passed the wage base. The " +
      "year-to-date accumulator is where that stops, so that is where to look.",
    whyWeRefuse:
      "One employer cannot legitimately exceed the ceiling. (An employee with TWO jobs can go over in total, and " +
      "they reclaim it on their own return - but that never shows up on one employer's W-2, so this figure being " +
      "high means the withholding itself was wrong.)",
  },
  {
    code: "W2_MEDICARE_BELOW_OASDI",
    headline: "Medicare wages are below Social Security wages, which is impossible.",
    whatHappened: "Box 5 came out lower than box 3.",
    howToFix:
      "Do not adjust the W-2. Rebuild the year-to-date accumulator from the pay runs, because this means the stored " +
      "totals are damaged rather than merely wrong.",
    whyWeRefuse:
      "Social Security stops at the wage base and Medicare never stops, so box 5 is always at least box 3. This is " +
      "not a rule that can be waived by circumstances - if it is violated, the data is corrupt and every other " +
      "figure on the form is suspect too.",
  },
  {
    code: "W2_SSN_NOT_NINE_DIGITS",
    headline: "The Social Security number is not nine digits.",
    whatHappened: "The number entered has too few digits, too many, or characters that are not digits.",
    howToFix: "Type the nine digits from the employee's card. Dashes are added for display; do not type them.",
    whyWeRefuse:
      "The SSA matches on name and SSN together. A wrong number makes the entire wage report unmatchable, and the " +
      "employee's earnings record does not get credited.",
  },
  {
    code: "W2_NAME_INCOMPLETE",
    headline: "Both the first name and the surname are required, in separate fields.",
    whatHappened: "One of the two name fields is empty.",
    howToFix:
      "First name and middle initial in the first field, surname in the second, suffix such as 'Jr.' in the third " +
      "if there is one.",
    whyWeRefuse:
      "'Misformat the employee's name in box e' is on the IRS's own published list of common errors that cause " +
      "processing delays. The separate fields exist so the SSA can match reliably; one field with everything in it " +
      "defeats that.",
  },
];

export function w2RefusalLessonFor(code: W2RefusalCode): W2RefusalLesson | undefined {
  return FORM_W2_REFUSAL_LESSONS.find((l) => l.code === code);
}

/* ══════════════════════════════════════════════════════════════════════════
 * §3  WORKED EXAMPLES
 *
 * Standing rules 82-84a. Every example carries real arithmetic, one step per
 * line, in the order a person would actually do it - not a summary of the
 * answer. An example you cannot follow with a pencil is a decoration.
 * ══════════════════════════════════════════════════════════════════════════ */

export type W2WorkedExample = {
  readonly key: string;
  readonly title: string;
  /** The situation in one or two sentences. */
  readonly setup: string;
  /** The arithmetic, one step per line, in the order a person would do it. */
  readonly steps: readonly string[];
  /** What the example is actually teaching. */
  readonly theLesson: string;
};

export const FORM_W2_WORKED_EXAMPLES: readonly W2WorkedExample[] = [
  {
    key: "box-4-ceiling",
    title: "The box 4 ceiling, derived rather than looked up",
    setup:
      "The IRS instruction says box 4 'should not exceed $11,439 ($184,500 x 6.2%)'. It printed both the inputs and " +
      "the answer, which makes it something rarer than an example - it is a test we can run against ourselves.",
    steps: [
      "Start with the 2026 Social Security wage base: $184,500.00, which the system stores as 18,450,000 cents.",
      "The employee's Social Security rate is 6.2%, stored as 6,200 milli-percent so it is an integer.",
      "Multiply: 18,450,000 x 6,200 = 114,390,000,000.",
      "Divide by 100,000 to undo the milli-percent scaling: 114,390,000,000 / 100,000 = 1,143,900 cents.",
      "The remainder of that division is ZERO, so no rounding rule was needed and no one has to agree about it.",
      "1,143,900 cents is $11,439.00 - exactly the figure the IRS printed.",
    ],
    theLesson:
      "The system never stores $11,439 as a number. It recomputes it from the wage base and the rate every time. " +
      "That sounds pedantic until the wage base changes: a stored figure would still say $11,439 and would still " +
      "look right, because it WAS right, once. A derived figure moves on its own.",
  },
  {
    key: "michael-premium",
    title: "Michael's W-2, where box 1 is higher than box 5 and that is correct",
    setup:
      "Michael takes $120,000 of wages for the year and Greenway pays $18,000 of health insurance for him. He owns " +
      "85%, so he is a 2%-or-more shareholder-employee and the ordinary tax-free-fringe-benefit rule does not apply.",
    steps: [
      "Cash wages run through payroll: $120,000.00.",
      "Box 3, Social Security wages: $120,000.00. The premium is excluded, and he is under the $184,500 base so nothing is capped.",
      "Box 5, Medicare wages: $120,000.00. The premium is excluded here too.",
      "Box 1: $120,000.00 + $18,000.00 = $138,000.00, because the premium IS wages for income tax.",
      "Box 1 minus box 3 = $18,000.00, which is exactly the premium and nothing else.",
      "Box 4: $120,000.00 x 6.2% = $7,440.00, comfortably under the $11,439.00 ceiling.",
      "Box 6: $120,000.00 x 1.45% = $1,740.00, with no Additional Medicare because he is under $200,000.",
    ],
    theLesson:
      "A W-2 whose boxes disagree looks broken and here is not. Anyone who 'corrects' it makes one of two errors: " +
      "adding the premium to boxes 3 and 5 overpays FICA on money that is exempt, and removing it from box 1 " +
      "understates his income AND costs him the self-employed health insurance deduction on his 1040 - because that " +
      "deduction exists only because the premium was on the W-2 first.",
  },
  {
    key: "deferral-mirror",
    title: "The mirror image: a 401(k) makes box 1 LOWER than box 5",
    setup:
      "Same $120,000 of wages, but this time the employee puts $9,000 into a traditional 401(k) before tax. No " +
      "health premium involved.",
    steps: [
      "Cash wages: $120,000.00.",
      "Box 3 and box 5, Social Security and Medicare wages: $120,000.00 each. A 401(k) deferral does NOT escape FICA.",
      "Box 1: $120,000.00 - $9,000.00 = $111,000.00, because the instruction says 'do not include elective deferrals'.",
      "Box 12, code D: $9,000.00, printed as 'D 9000.00' with a decimal point and no comma and no dollar sign.",
      "Box 5 minus box 1 = $9,000.00, exactly the deferral.",
    ],
    theLesson:
      "Box 1 and box 5 differ for two completely different reasons that push in opposite directions - a shareholder " +
      "premium raises box 1, a pre-tax deferral lowers it. If Michael ever does both in one year, both adjustments " +
      "land and the difference is the net. This is also why the code that computes box 1 has to know WHICH kind of " +
      "box 12 item it is looking at: a Roth deferral (AA) and an HSA contribution (W) are both 'not in box 1' in " +
      "casual speech, and neither one may be subtracted.",
  },
  {
    key: "w3-box-12a-filter",
    title: "The W-3 box that is not a total",
    setup:
      "One employee with four box 12 items: $9,000 of 401(k) (D), $1,000 of Roth (AA), $24,000 of health coverage " +
      "cost (DD), and $120 of group-term life (C).",
    steps: [
      "Add up all of box 12 the obvious way: $9,000 + $1,000 + $24,000 + $120 = $34,120.00.",
      "That figure is WRONG for W-3 box 12a, and it is wrong by a lot.",
      "Box 12a carries only the deferral codes - D through H, S, Y, AA, BB and EE.",
      "Code D qualifies: $9,000.00. Code AA qualifies: $1,000.00.",
      "Code DD does not, and code C does not. The instruction's Caution names both.",
      "Box 12a = $9,000.00 + $1,000.00 = $10,000.00.",
      "The $24,120.00 left behind is not reported on the W-3 at all.",
    ],
    theLesson:
      "Every other money box on the W-3 is a straight sum of that box across the W-2s, so the natural assumption is " +
      "that box 12a is too. It is the single easiest W-3 error for software to make - the IRS's own note says it " +
      "catches software as often as people. The engine stores the include/exclude decision on each code rather than " +
      "in the totalling routine, so the filter is data you can read rather than logic you have to trust.",
  },
  {
    key: "approximately-twice",
    title: 'Why the IRS says "approximately" twice, and what it costs to round that off',
    setup:
      "The W-3 reports only the employee's half of FICA. The four Forms 941 report both halves. So the 941 should be " +
      "double the W-3 - except when it should not.",
    steps: [
      "Suppose the W-3 shows box 6 Medicare tax withheld of $1,740.00 for a $120,000 employee.",
      "The 941s should show $1,740.00 x 2 = $3,480.00, because Greenway matched every cent.",
      "Now suppose an employee earned $250,000. Medicare at 1.45% on all of it is $3,625.00.",
      "Additional Medicare Tax is 0.9% on the excess over $200,000: $50,000 x 0.9% = $450.00.",
      "Box 6 for that person is $3,625.00 + $450.00 = $4,075.00.",
      "The employer matches the $3,625.00 but matches NONE of the $450.00.",
      "So the 941 should show $3,625.00 x 2 + $450.00 = $7,700.00 - not $4,075.00 x 2 = $8,150.00.",
      "The naive doubling is off by $450.00, which is exactly the unmatched surtax.",
    ],
    theLesson:
      "This engine does not assert 'about twice' with a tolerance band. It computes the exact expected figure by " +
      "doubling the matched part and adding the unmatched part once. A tolerance wide enough to accommodate the " +
      "surtax is wide enough to hide a real error, and a tolerance narrow enough to catch errors raises a false " +
      "alarm the first year anyone crosses $200,000. False alarms are how a control dies: it cries wolf once, and " +
      "the next person switches it off.",
  },
  {
    key: "void-in-the-total",
    title: "The voided form that breaks a W-3 while every W-2 is perfect",
    setup:
      "Two employees. One W-2 was printed wrong, voided, and reissued - so there are three rows in the system for " +
      "two people.",
    steps: [
      "Employee A: $60,000.00. Employee B, the voided row: $40,000.00. Employee B, the good row: $40,000.00.",
      "Total all three rows: $60,000 + $40,000 + $40,000 = $140,000.00.",
      "Total correctly, excluding the void: $60,000 + $40,000 = $100,000.00.",
      "The four 941s say $100,000.00, because payroll only ever paid that.",
      "The W-3 is overstated by $40,000.00 and the reconciliation fails.",
    ],
    theLesson:
      "Every individual W-2 in this scenario is correct. You can check all three of them, twice, and find nothing - " +
      "which is what makes it an expensive afternoon in February. The error exists only in the total, and only " +
      "because a voided form is still a row in the database. The instruction says 'excluding any Forms W-2 marked " +
      "VOID' in a parenthesis that is easy to read past.",
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * §4  A LESSON FOR EVERY EXPORTED FUNCTION  (standing rule 26)
 *
 * If the engine exports it, this file explains it. The gate in
 * `form-w2-mentor-gates.ts` reads the engine off disk and fails when the two
 * lists disagree, so this cannot quietly fall behind.
 * ══════════════════════════════════════════════════════════════════════════ */

export type MentorLesson = {
  /** The exported function this lesson teaches. */
  readonly fn: string;
  readonly plainEnglish: string;
  readonly whyItExists: string;
  readonly theTrap: string;
  readonly whatIWouldDo: string;
  readonly authorityIds: readonly string[];
};

export const FORM_W2_LESSONS: readonly MentorLesson[] = [
  {
    fn: "buildW2",
    plainEnglish:
      "Takes one employee's year-to-date totals and turns them into the boxes of one W-2, or refuses and tells you why.",
    whyItExists:
      "So that the transcription from a year of pay runs onto a form happens once, in one place, with every " +
      "cross-check applied - rather than being retyped each January.",
    theTrap:
      "It runs ALL its validation before ANY arithmetic and returns every problem at once. That is deliberate: a " +
      "screen that reports one error, gets it fixed, then reports the next one wastes an afternoon per form.",
    whatIWouldDo:
      "Build every employee's form early, in October, even though you cannot file them yet. The refusals are the " +
      "point - they tell you what is wrong while there is still time for it to be a bookkeeping fix.",
    authorityIds: [
      "iw2w3-2026-box-1-scorp-health-premiums",
      "iw2w3-2026-box-3-scorp-health-carve-out",
      "iw2w3-2026-common-errors",
    ],
  },
  {
    fn: "buildW3",
    plainEnglish:
      "Adds the W-2s up into the single summary form that goes on top of them, leaving out anything marked VOID.",
    whyItExists:
      "The W-3 is the form the SSA reads first, and every money box on it except one is a plain total of the forms " +
      "underneath. Because it is a pure sum, it can be checked with a calculator - so it is.",
    theTrap:
      "Two of them. Voided forms are excluded, and box 12a is a FILTER rather than a total. Miss either and the " +
      "W-3 disagrees with the 941s while every W-2 beneath it is perfect.",
    whatIWouldDo:
      "Check the form count against the number of people you actually paid before looking at any money. If those " +
      "two numbers disagree, nothing below them is worth reading yet.",
    authorityIds: [
      "iw2w3-2026-w3-boxes-are-totals",
      "iw2w3-2026-w3-box-12a-filtered-subset",
      "iw2w3-2026-w3-box-15-state-id",
    ],
  },
  {
    fn: "reconcileW3To941s",
    plainEnglish:
      "Compares the five figures the IRS compares - federal income tax, both wage bases, and both FICA taxes - " +
      "between your W-3 and the four Forms 941 you already filed.",
    whyItExists:
      "Because the IRS runs this comparison whether you do or not, and the instruction says you WILL be contacted " +
      "when it fails. Both sets of numbers are already in this system, so running it costs nothing.",
    theTrap:
      "The two tax lines are doubled, because the 941 carries the employer's half too - but Additional Medicare Tax " +
      "has no employer match, so it is added once rather than doubled. This function computes the exact expected " +
      "figure instead of allowing a fuzzy tolerance.",
    whatIWouldDo:
      "Run it in October with three quarters loaded. It will say the comparison is incomplete, which is correct and " +
      "not a failure. What you are looking for is whether the three quarters you have already disagree.",
    authorityIds: [
      "iw2w3-2026-reconcile-w3-to-941s",
      "iw2w3-2026-reconcile-941-approximately-twice",
      "iw2w3-2026-w3-amounts-should-agree",
    ],
  },
  {
    fn: "box4CeilingCentsFor",
    plainEnglish:
      "Works out the most Social Security tax any single W-2 can legitimately show for a given year - or returns " +
      "nothing at all if it does not know that year's wage base.",
    whyItExists:
      "To catch a pay run that kept charging Social Security after an employee passed the wage base, which is a " +
      "real and silent error.",
    theTrap:
      "It returns null rather than guessing for a year it has no wage base for. A ceiling extrapolated from the " +
      "wrong base would REFUSE correct W-2s, and being wrong in that direction is much more expensive than having " +
      "no check at all.",
    whatIWouldDo:
      "When the 2027 rates arrive, add the wage base to the registry and this function starts working for 2027 on " +
      "its own. Do not type the new ceiling in anywhere - it is arithmetic, not a fact to be looked up.",
    authorityIds: ["iw2w3-2026-box-4-ceiling"],
  },
  {
    fn: "formatBox12Entry",
    plainEnglish:
      'Prints one box 12 item the way Copy A requires: a capital code, a space, and the amount - "D 5300.00".',
    whyItExists:
      "Copy A is machine-read. The format is not a style preference, and the IRS supplied a literal example of it.",
    theTrap:
      "No dollar sign and no thousands separator. A comma is a rejection. The IRS's own list of common errors " +
      "includes both adding dollar signs and omitting the cents.",
    whatIWouldDo:
      "Never hand-type a box 12 entry into anything. If you see a comma in one on a printed form, stop and find out " +
      "what produced it.",
    authorityIds: ["iw2w3-2026-box-12-entry-format", "iw2w3-2026-common-errors"],
  },
  {
    fn: "box12CodeSpec",
    plainEnglish: "Looks up what one box 12 code means and how it affects the wage boxes.",
    whyItExists:
      "So the codes are data rather than knowledge held in someone's head, and so the screen can explain each one " +
      "at the moment it is used.",
    theTrap:
      "Each code records WHERE its money already sits - inside box 1, inside FICA wages only, or outside every wage " +
      "box. Those three cases need different arithmetic, and a single true/false cannot tell code D from code W.",
    whatIWouldDo:
      "Read the plain-English line before choosing a code. Choosing the wrong one silently changes box 1 for that " +
      "employee.",
    authorityIds: ["iw2w3-2026-box-12-four-item-limit"],
  },
  {
    fn: "describeBox1",
    plainEnglish:
      "Writes the sentence that explains box 1 as a sum - the wages, plus any premium, minus any deferral.",
    whyItExists:
      "Because box 1 is the box that disagrees with the others, and 'why is box 1 different' is the question " +
      "somebody asks every single year.",
    theTrap:
      "The sentence and the number are generated from the same figures, so they cannot drift apart. A derivation " +
      "that contradicts the amount beside it is worse than no derivation - it is a confident wrong answer.",
    whatIWouldDo:
      "Read this sentence before filing, and if it does not describe what you believe happened, the accumulator is " +
      "wrong rather than the sentence.",
    authorityIds: ["iw2w3-2026-box-1-scorp-health-premiums"],
  },
  {
    fn: "boxOf",
    plainEnglish: "Fetches one box off a built form by its printed number.",
    whyItExists:
      "So nothing indexes into the box list by position. Positions shift when a box is added; box '3' does not.",
    theTrap:
      "It returns undefined for a box that is not present rather than throwing, because not every W-2 carries every " +
      "box.",
    whatIWouldDo:
      "Nothing directly - this is plumbing. It is listed because every exported function is taught, including the " +
      "boring ones, so that nothing hides in the gaps.",
    authorityIds: [],
  },
  {
    fn: "formatCentsForW2",
    plainEnglish: 'Formats money for reading rather than for filing - "$11,439.00", with the separators.',
    whyItExists:
      "The explanations Michael reads are easier with commas and a dollar sign. The boxes machines read must not " +
      "have them. Two audiences, two formatters.",
    theTrap:
      "Never use this for a box value on Copy A. That is what `formatBox12Entry` is for, and the difference is a " +
      "rejected filing.",
    whatIWouldDo: "Treat any dollar sign on Copy A as a defect to be traced, not a cosmetic issue.",
    authorityIds: ["iw2w3-2026-common-errors"],
  },
  {
    fn: "maskSsnForW2",
    plainEnglish: "Shows only the last four digits of a Social Security number.",
    whyItExists:
      "The screen has to be able to tell two employees apart without displaying a full SSN to whoever is standing " +
      "behind you.",
    theTrap:
      "This is for display only. The full number still has to reach Copy A - truncating it there is not permitted.",
    whatIWouldDo:
      "If you ever see a full SSN on a screen in this system, treat it as a defect and report it.",
    authorityIds: [],
  },
  {
    fn: "assertBox4CeilingMatchesIrsArithmetic",
    plainEnglish:
      "Re-derives the $11,439 ceiling from the wage base and the rate, and fails if the answer is not the one the " +
      "IRS published.",
    whyItExists:
      "The IRS printed the inputs AND the answer, which makes it a test rather than an illustration. Deriving it " +
      "means that editing either constant surfaces the disagreement immediately.",
    theTrap:
      "It also checks the multiplication comes out exact in whole cents - remainder zero - so no rounding rule is " +
      "silently deciding the last cent.",
    whatIWouldDo:
      "If this ever fails after a rate update, believe it. It is comparing your new constants against a figure the " +
      "IRS published.",
    authorityIds: ["iw2w3-2026-box-4-ceiling"],
  },
  {
    fn: "assertBox12CodesAreComplete",
    plainEnglish: "Checks every box 12 code is filed under its own name and carries a real explanation.",
    whyItExists:
      "So a code cannot be added with a placeholder description, and so the three-way box 1 distinction always has " +
      "at least one code exercising each branch.",
    theTrap:
      "It no longer checks COMPLETENESS - the compiler does that now, because the specs are a total record keyed by " +
      "the code type. It used to re-declare the six codes by hand and compare that list against itself, which is " +
      "exactly the kind of check that passes forever while going stale.",
    whatIWouldDo: "Nothing. This runs in the test suite. It is described here so you know what it does not cover.",
    authorityIds: [],
  },
  {
    fn: "assertW3Box12aIsFiltered",
    plainEnglish:
      "Proves W-3 box 12a still excludes the codes the IRS says it excludes, and still includes the ones it names.",
    whyItExists:
      "Because 'make box 12a a simple total like all the others' is a plausible-looking simplification that someone " +
      "will eventually propose, and this is what goes red when they do.",
    theTrap:
      "It asserts against the instruction's two named lists - DD and C must be dropped, D and AA and EE must carry " +
      "up - rather than against a count, so it cannot be satisfied by coincidence.",
    whatIWouldDo:
      "Nothing to run by hand - but know what it protects. Box 12a on the W-3 is the ONLY box on that form that is " +
      "not a plain total of the W-2s beneath it. If you are ever reconciling by hand and box 12a comes out lower " +
      "than the sum of the box 12 amounts, that is correct behaviour, not an error to chase.",
    authorityIds: ["iw2w3-2026-w3-box-12a-filtered-subset"],
  },
  {
    fn: "assertRefusalCodesAreListed",
    plainEnglish: "Checks the published list of refusal codes has no duplicates.",
    whyItExists:
      "The list is what the screen iterates to explain refusals. A duplicate would render a lesson twice and " +
      "suggest a code is more common than it is.",
    theTrap:
      "Small, but the alternative to checking it is remembering it - and the list grows every time a new refusal " +
      "is added, which is exactly when a copy-paste duplicate slips in.",
    whatIWouldDo:
      "Nothing to run by hand. Its value to you is indirect: it is why the refusal list on screen can be trusted " +
      "as a complete menu of every reason this tool will decline to build a form, with nothing listed twice.",
    authorityIds: [],
  },
  {
    fn: "assertAdditionalMedicareBoundary",
    plainEnglish:
      "Runs the reconciliation at the $200,000 boundary and proves the doubling rule bends exactly where the " +
      "surtax begins.",
    whyItExists:
      "This is the one piece of arithmetic in the module that is not a straight copy, so it is the one most worth " +
      "pinning down.",
    theTrap:
      "The first version of this gate could not fail. It computed 0.9% of (threshold minus threshold) - which is " +
      "zero by construction - and asserted the answer was zero. It was green because it was incapable of anything " +
      "else. It now drives the real reconciler with real figures.",
    whatIWouldDo:
      "Remember the principle even if you never read the code: a check that cannot fail is not a check. If a " +
      "control has never once gone red, ask whether it can.",
    authorityIds: ["iw2w3-2026-box-6-includes-additional-medicare"],
  },
];

export function w2LessonFor(fn: string): MentorLesson | undefined {
  return FORM_W2_LESSONS.find((l) => l.fn === fn);
}

export function w2TaughtFunctionNames(): readonly string[] {
  return FORM_W2_LESSONS.map((l) => l.fn);
}

export function w2CitedAuthorityIds(): readonly string[] {
  const out = new Set<string>();
  for (const l of FORM_W2_LESSONS) for (const id of l.authorityIds) out.add(id);
  return [...out].sort();
}
