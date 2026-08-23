/**
 * src/lib/payroll/form-941-mentor.ts   (books-40)
 *
 * THE CPA SITTING NEXT TO MICHAEL WHILE HE FILES THE QUARTERLY RETURN.
 *
 * WHY THIS FILE EXISTS, VERBATIM (standing rule 1)
 *
 *   "I want to be walked through this with my hand held. Plain english
 *    teaching. Examples. All that good stuff."
 *
 * and, from the same message:
 *
 *   "941 first, since it is due first and is mostly summation"
 *
 * The whole teaching job of this file is to honour the first quote while
 * gently complicating the second. The 941 IS mostly summation. The two lines
 * that are not - line 1 and line 7 - are where the money and the audit risk
 * live, and they are the two a confident person fills in fastest.
 *
 * ARCHITECTURE (standing rule 65b). This file is DATA ONLY. It contains no
 * `readFileSync`, no `node:fs`, no `process`, nothing that cannot be imported
 * by a client component. The coverage GATES that read source files off disk
 * live in `form-941-mentor-gates.ts`, which is node-only and is imported by
 * tests, never by a page. The two were one file once and it put `node:fs` on
 * the client bundle path.
 *
 * WHAT A LESSON OWES THE READER. Every lesson answers four questions in the
 * same order: what this does in plain English, why it exists at all, the trap
 * that makes it worth having, and what I would actually do. The fourth is not
 * decoration - "verify the data" is not an instruction, and a mentor that only
 * describes the problem has done half the job (standing rule 64a: detection is
 * not explanation).
 */

import {
  ALL_FORM_941_REFUSAL_CODES,
  type Form941RefusalCode,
} from "@/lib/payroll/form-941-core";
import { FORM_941_AUTHORITIES } from "@/lib/payroll/form-941-authorities";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  THE PRE-FLIGHT CHECKLIST
 *
 * What must be true BEFORE the return means anything. Ordered, because the
 * order is the lesson: getting step 1 wrong makes every later step wrong while
 * each of them still looks internally consistent.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Form941CheckKey =
  | "quarter-closed"
  | "every-run-posted"
  | "ytd-agrees"
  | "twelfth-day-answered"
  | "deposits-recorded"
  | "line-7-is-small"
  | "read-it-as-a-stranger";

export type Form941Check = {
  readonly key: Form941CheckKey;
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

export const FORM_941_CHECKS: readonly Form941Check[] = [
  {
    key: "quarter-closed",
    order: 1,
    question: "Is the quarter actually over, and is every pay date inside it accounted for?",
    whyThisOrder:
      "A return built before the quarter closes is not an early return, it is a wrong return. " +
      "This is first because it is the only error on this list that cannot be found by looking " +
      "at the form - every line will foot perfectly against a quarter that is missing its last " +
      "payroll.",
    howToCheck:
      "The 941 belongs to pay DATES, not to work periods. A pay period that ends 28 June but " +
      "pays on 2 July belongs to Q3, not Q2. Open the pay-run list, filter to the quarter's date " +
      "range, and check the last pay date in the quarter is there and the first one after it is " +
      "not.",
    ifItFails:
      "Wages and tax are both understated by one payroll. The deposits will not match, so it " +
      "surfaces as a balance due rather than silently - but the fix is an amended return on Form " +
      "941-X, not an edit, because the original was already filed.",
  },
  {
    key: "every-run-posted",
    order: 2,
    question: "Is every pay run in the quarter approved and posted - none left half-finished?",
    whyThisOrder:
      "Second because it is the same class of problem as the first - a missing input - but it " +
      "hides better. A quarter can be closed on the calendar and still have a run sitting in " +
      "draft.",
    howToCheck:
      "The pay-run screen shows status per run. Anything not approved is not in these numbers. " +
      "Count the runs: a biweekly quarter has six or seven, never five.",
    ifItFails:
      "Same as above, and with the same cure. The reason it is worth its own line on the " +
      "checklist is that a draft run looks like a real one on every screen except the one that " +
      "shows its status.",
  },
  {
    key: "ytd-agrees",
    order: 3,
    question: "Do the quarter's wages agree with the year-to-date record?",
    whyThisOrder:
      "Third because it is the first check that can actually be performed against a number " +
      "rather than against a memory, and because it catches the two problems above as well as " +
      "its own.",
    howToCheck:
      "Take year-to-date wages at the end of this quarter, subtract year-to-date at the end of " +
      "the last one, and compare with line 2. They are the same number computed two different " +
      "ways from the same underlying paycheques, so any difference is real.",
    ifItFails:
      "Do not adjust the 941 to match year-to-date or the other way round. One of the two is " +
      "wrong and the difference tells you the size, not the direction. Find the pay run that " +
      "explains the gap.",
  },
  {
    key: "twelfth-day-answered",
    order: 4,
    question: "Do we know who was on the payroll for the pay period containing the 12th?",
    whyThisOrder:
      "Fourth because it is a fact about people rather than money, and it is the only figure on " +
      "the whole return that cannot be derived from the wage records at all.",
    howToCheck:
      "Line 1 asks for a headcount on ONE pay period - the one containing 12 March, 12 June, 12 " +
      "September or 12 December. Not everyone paid during the quarter. The system refuses to " +
      "state line 1 until every person has a yes or a no on file.",
    ifItFails:
      "Line 1 is the figure the IRS reconciles against the W-2 count in January. A wrong count " +
      "does not change a penny of tax, which is exactly why it goes unnoticed until it generates " +
      "a notice asking why twelve W-2s were issued for a quarter reporting nine employees.",
  },
  {
    key: "deposits-recorded",
    order: 5,
    question: "Is the quarter's deposit total recorded, from the deposit record and not from memory?",
    whyThisOrder:
      "Fifth because it is the last input, and because until line 12 exists there is nothing to " +
      "compare a deposit against.",
    howToCheck:
      "Total the federal deposits made for pay dates inside this quarter. Deposits are matched " +
      "to the quarter of the PAY DATE that created the liability, not the date the money left " +
      "the bank - a deposit made in July for a June payroll belongs to Q2.",
    ifItFails:
      "The system refuses rather than assuming zero. Assuming zero would turn a fully paid " +
      "quarter into a balance due for the whole quarter's tax, which is the most alarming " +
      "possible wrong answer and the one most likely to cause a duplicate payment.",
  },
  {
    key: "line-7-is-small",
    order: 6,
    question: "Is line 7 a few cents rather than a few dollars?",
    whyThisOrder:
      "Sixth because it can only be asked once every other figure is in, and because it is the " +
      "single most informative number on the form about whether the payroll underneath it is " +
      "healthy.",
    howToCheck:
      "Look at it. Greenway's filed Q2 2026 return carries minus seven cents. Anything in " +
      "dollars is not rounding. The system computes the largest drift rounding could possibly " +
      "produce for the number of people involved and refuses if the residual exceeds it.",
    ifItFails:
      "Do NOT adjust line 7 to make the form balance. That is the one place on this return where " +
      "a wrong number looks completely normal, because the IRS expects the line to be small and " +
      "does not look at it. Run the reconciliation and find the person.",
  },
  {
    key: "read-it-as-a-stranger",
    order: 7,
    question: "Read line 1, line 2 and line 12 out loud. Do all three sound like Greenway?",
    whyThisOrder:
      "Last, because it is the only check that uses judgement rather than arithmetic, and " +
      "judgement is worthless until the arithmetic is settled.",
    howToCheck:
      "Three sentences. 'We had about this many people.' 'We paid about this much in wages.' " +
      "'We owe about this much federal tax - roughly fifteen to twenty percent of wages once " +
      "income tax withholding and both halves of FICA are in.' If a figure is off by a factor " +
      "of ten you will hear it before any test catches it.",
    ifItFails:
      "Stop and find out why before signing. The signature block is a declaration under penalty " +
      "of perjury that you examined the return - so the four seconds this takes is not optional " +
      "politeness, it is the thing being signed.",
  },
] as const;

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  WHAT EACH REFUSAL MEANS, AND WHAT TO DO ABOUT IT
 *
 * One lesson per refusal code, enforced by a test. A refusal a screen can emit
 * but the mentor cannot explain is standing rule 43's unreachable refusal in
 * its most annoying form: the user sees a code and gets no help.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Form941RefusalLesson = {
  readonly code: Form941RefusalCode;
  /** One line, big and calm, at the top of the panel. */
  readonly headline: string;
  /** What has actually gone wrong, without jargon. */
  readonly whatHappened: string;
  /** The specific next action. Never "check the data". */
  readonly howToFix: string;
  /** Why the system refuses instead of guessing - the cost of the guess. */
  readonly whyWeRefuse: string;
};

export const FORM_941_REFUSAL_LESSONS: readonly Form941RefusalLesson[] = [
  {
    code: "NO_SUBJECTS",
    headline: "A quarter with nobody paid is still a return.",
    whatHappened:
      "No employees were supplied for this quarter, so there is nothing to total.",
    howToFix:
      "If that is genuinely right - a quarter where Greenway paid nobody - file a zero return " +
      "rather than filing nothing. If it is not right, the likely cause is that the quarter's " +
      "pay runs have not been posted yet; check the pay-run list before doing anything else.",
    whyWeRefuse:
      "26 CFR 31.6011(a)-1(a)(1) requires a return for every quarter after the first one " +
      "'whether or not wages are paid therein'. Silence is not an option the regulation offers, " +
      "and a missed return is priced by IRC 6651 at 5% of the tax per month even when the tax is " +
      "nil - because the penalty for a nil return is assessed on a minimum, not on zero.",
  },
  {
    code: "TWELFTH_DAY_UNKNOWN",
    headline: "Line 1 is a headcount on one day, and nobody has answered it for this person.",
    whatHappened:
      "At least one person has no record of whether they were on the payroll for the pay period " +
      "containing the 12th of the quarter's last month.",
    howToFix:
      "Answer yes or no for each person named. The question is narrow on purpose: not 'did they " +
      "work this quarter' but 'were they on the payroll for that particular pay period'.",
    whyWeRefuse:
      "An unanswered question and a 'no' look identical in a count and mean completely different " +
      "things. Counting unknowns as no would understate line 1 silently, and line 1 is the " +
      "figure matched against the W-2 count in January - a mismatch generates a notice months " +
      "later with nothing left to check it against.",
  },
  {
    code: "NEGATIVE_WAGES",
    headline: "Somebody has a negative figure for the quarter.",
    whatHappened:
      "A wage, withholding or tax figure came through below zero. No real quarter produces that.",
    howToFix:
      "Almost always a correction that was entered as a negative paycheque instead of as an " +
      "adjustment. Fix it in the pay run it came from - correcting it here would leave the " +
      "payroll records and the return permanently disagreeing.",
    whyWeRefuse:
      "A negative flows straight into the totals and reduces them, so the form still foots " +
      "perfectly while reporting less wages than were paid. It is a wrong return that passes " +
      "every arithmetic check on it.",
  },
  {
    code: "OASDI_EXCEEDS_WAGES",
    headline: "Somebody's Social Security wages are larger than their total wages.",
    whatHappened:
      "Line 5a's base for this person exceeds line 2's base, which cannot happen.",
    howToFix:
      "Social Security wages are a subset of total wages - the annual cap can only ever make " +
      "line 5a smaller than line 2, never bigger. Check the person's year-to-date record for a " +
      "pay run that was posted twice.",
    whyWeRefuse:
      "This one overstates the tax, so it costs real money immediately, and it is invisible on " +
      "the finished form: line 5a is simply a bit high, and nothing on the return compares it to " +
      "line 2.",
  },
  {
    code: "FRACTIONS_TOO_LARGE",
    headline: "Line 7 is too big to be rounding. Something is genuinely wrong underneath.",
    whatHappened:
      "The difference between what the statutory rates say should have been withheld and what " +
      "actually came out of the paycheques is larger than per-paycheque rounding could produce " +
      "for this many people.",
    howToFix:
      "Run the payroll reconciliation for this quarter. It lists the difference per person, " +
      "largest first. The two usual causes are a rate typed in wrong - which produces a " +
      "difference proportional to wages - and a pay run posted twice, which produces one large " +
      "difference on one person. Do NOT edit line 7 to make the return balance: fix the " +
      "paycheque that is wrong, and line 7 will come back down on its own.",
    whyWeRefuse:
      "This is the only line on the return where a wrong number looks completely normal. The IRS " +
      "expects line 7 to be small change and does not scrutinise it, so a genuine withholding " +
      "error dropped in here disappears. Plugging this line to make the form balance would be " +
      "the single most effective way to hide a payroll problem, so the system will not do it.",
  },
  {
    code: "DEPOSITS_UNKNOWN",
    headline: "The quarter's deposits have not been supplied, so we cannot say what is owed.",
    whatHappened:
      "Lines 13, 14 and 15 need the total actually deposited for the quarter, and it is not on " +
      "file.",
    howToFix:
      "Total the federal deposits for pay dates inside this quarter and supply that figure. " +
      "Match deposits to the quarter of the PAY DATE, not the date the money left the bank.",
    whyWeRefuse:
      "The tempting default is zero, and zero is catastrophic: it turns a fully paid quarter " +
      "into a balance due for the entire quarter's tax. The most likely response to that screen " +
      "is to pay it, which means paying twice. An honest refusal costs a minute; the default " +
      "costs the quarter's tax.",
  },
  {
    code: "QUARTER_NOT_VALID",
    headline: "That is not a quarter this system will build a return for.",
    whatHappened:
      "The year or the quarter number is outside the range the engine accepts.",
    howToFix: "Pick a year between 2000 and 2100 and a quarter numbered 1 to 4.",
    whyWeRefuse:
      "Mostly this catches a typo in a date before it becomes a return filed for the wrong " +
      "period - which is a real and irritating problem, because a return filed for the wrong " +
      "quarter has to be corrected in two places at once.",
  },
] as const;

export function form941RefusalLessonFor(
  code: Form941RefusalCode,
): Form941RefusalLesson | undefined {
  return FORM_941_REFUSAL_LESSONS.find((l) => l.code === code);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  WORKED EXAMPLES
 *
 * Michael asked for examples, and an example that cannot be checked is a
 * story. Every number in the first example below is off a return the IRS
 * accepted; the arithmetic is written out so it can be followed on paper.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Form941WorkedExample = {
  readonly key: string;
  readonly title: string;
  /** The situation in one or two sentences. */
  readonly setup: string;
  /** The arithmetic, one step per line, in the order a person would do it. */
  readonly steps: readonly string[];
  /** What the example is actually teaching. */
  readonly theLesson: string;
};

export const FORM_941_WORKED_EXAMPLES: readonly Form941WorkedExample[] = [
  {
    key: "q2-2026-real",
    title: "Greenway's real Q2 2026, line by line",
    setup:
      "Ten people, $68,923.45 of wages, 3,558 hours. These are not invented figures - they are " +
      "off the return that was actually filed and accepted for April, May and June of 2026, and " +
      "the same wage base appears on four separate filings to three different agencies.",
    steps: [
      "Line 1: not a total. Count the people on the payroll for the pay period containing 12 June.",
      "Line 2: add up the quarter's wages. $68,923.45.",
      "Line 3: add up the federal income tax withheld. $3,659.35. This one cannot be recomputed - it depends on each person's W-4.",
      "Line 5a: $68,923.45 x 12.4% = $8,546.51. That 12.4% is BOTH halves, Greenway's and the employees'.",
      "Line 5c: $68,923.45 x 2.9% = $1,998.78. Both halves again, and Medicare has no ceiling.",
      "Line 6: $3,659.35 + $8,546.51 + $1,998.78 = $14,204.64.",
      "Line 7: what actually came out of the paycheques was 7 cents less than the rates say, because every cheque rounds. Minus $0.07.",
      "Line 12: $14,204.64 - $0.07 = $14,204.57. This is the figure the deposits are measured against.",
    ],
    theLesson:
      "Everything except lines 1 and 7 is addition or one multiplication. Line 7 is the form " +
      "admitting it does not foot, and telling you where to put the difference. If you ever see " +
      "it in dollars rather than cents, the problem is not on the 941.",
  },
  {
    key: "why-5a-is-not-what-you-paid",
    title: "Why line 5a is bigger than the Social Security you took out of the cheques",
    setup:
      "A perfectly reasonable objection: the paycheques for Q2 2026 show $4,273.25 of Social " +
      "Security withheld, but line 5a says $8,546.51. The form appears to be double-counting.",
    steps: [
      "The employee pays 6.2%: $68,923.45 x 6.2% = $4,273.25. That is what came out of the cheques.",
      "Greenway pays 6.2% as well, out of its own pocket: another $4,273.25. Nobody sees this one on a payslip.",
      "Add those two halves and you get $8,546.50 - but line 5a says $8,546.51. That ONE CENT is not an error.",
      "The form does not ask for two halves added together. It prints the multiplier on the form itself: 'line 5a (column 1) x 0.124'. $68,923.45 x 12.4% = $8,546.5078, which rounds to $8,546.51.",
      "Rounding once at 12.4% and rounding twice at 6.2% are different sums, and the form tells you which one it wants. The engine does what the form says.",
    ],
    theLesson:
      "The 941 is a return for the EMPLOYER's liability, and the employer's liability includes " +
      "both halves - the half withheld from the employee and held in trust, plus the employer's " +
      "own matching half. That is why line 5a is roughly double what the payslips show, and why " +
      "the money in the payroll bank account has to cover more than the net cheques.",
  },
  {
    key: "the-quarter-a-pay-date-moves",
    title: "The pay period that ends in June but pays in July",
    setup:
      "A biweekly period runs 21 June to 4 July and pays on 9 July. Which quarter reports it? " +
      "Most of the work was done in June.",
    steps: [
      "The 941 reports wages PAID in the quarter, not wages earned in it.",
      "The pay date is 9 July, which is in Q3.",
      "Every cent of that payroll - wages, income tax withheld, both halves of FICA - lands on the Q3 return.",
      "The June work does not appear on the Q2 return at all, even though most of it happened in Q2.",
    ],
    theLesson:
      "Pay date decides, always. This is the single most common way a quarter comes out wrong, " +
      "because 'the quarter's payroll' means something different to a bookkeeper than it does to " +
      "the IRS. It is also why the first checklist item is about pay dates rather than work " +
      "periods.",
  },
  {
    key: "nobody-paid",
    title: "A quarter where Greenway pays nobody",
    setup:
      "Suppose the shop closes for a quarter, or the only employee is the owner and he takes his " +
      "single annual payment in Q4. Q2 has no payroll at all.",
    steps: [
      "The instinct is to file nothing, because there is nothing to report.",
      "26 CFR 31.6011(a)-1(a)(1) requires a return for each quarter after the first 'whether or not wages are paid therein'.",
      "So the return is filed with zeroes on it. It takes two minutes.",
      "The duty only ever stops when a FINAL return is filed - a deliberate act, not going quiet.",
    ],
    theLesson:
      "The owner being paid annually makes this a live question for Greenway rather than a " +
      "curiosity. Three of the four quarters in a year may have nothing in them for him, and all " +
      "four still need returns.",
  },
] as const;

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  A LESSON PER EXPORTED FUNCTION
 *
 * Coverage is enforced from disk by `form-941-mentor-gates.ts`. The point is
 * not tidiness: an exported function nobody has explained is a function whose
 * behaviour lives only in its implementation, and the first person to need it
 * will read the implementation and copy whatever it happens to do.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type MentorLesson = {
  /** The exported function this lesson teaches. */
  fn: string;
  plainEnglish: string;
  whyItExists: string;
  theTrap: string;
  whatIWouldDo: string;
  authorityIds: readonly string[];
};

export const FORM_941_LESSONS: readonly MentorLesson[] = [
  {
    fn: "applyMilliPct",
    plainEnglish:
      "Multiplies an amount of money by a tax rate and gives back whole cents, rounding half " +
      "away from zero.",
    whyItExists:
      "Every rate in this codebase is stored in milli-percent - 1.45% as 1,450 - so that no rate " +
      "is ever a floating-point number. This is the one place those rates meet money, so it is " +
      "the one place rounding is decided.",
    theTrap:
      "`Math.round(-0.5)` is `-0` in JavaScript, not `-1`. It rounds negative halves towards " +
      "zero while rounding positive halves away from it. On a form that carries negative " +
      "adjustments - and Greenway's filed line 7 IS negative - that asymmetry is a real defect, " +
      "not a theoretical one.",
    whatIWouldDo:
      "Leave the sign handling alone. If a future rate needs banker's rounding, add a second " +
      "function with a name that says so rather than changing this one, because everything on " +
      "the 941 already agrees with this behaviour.",
    authorityIds: ["i941-line-5a-both-halves-and-the-cap"],
  },
  {
    fn: "maxFractionsOfCentsDriftCents",
    plainEnglish:
      "Works out the largest line 7 that per-paycheque rounding could possibly explain, given " +
      "how many people are in the quarter.",
    whyItExists:
      "Line 7 has no independent check on it - the IRS expects it to be small and does not look " +
      "at it. Without a ceiling, any error anywhere in withholding would flow silently into this " +
      "line and the form would still foot.",
    theTrap:
      "Making the allowance tight. A false refusal on a correct quarter teaches Michael to click " +
      "past refusals, which costs far more than the handful of cents a tight bound would catch. " +
      "The allowance is deliberately generous and still catches what matters, because a wrong " +
      "RATE produces drift proportional to wages and blows past any headcount-based bound " +
      "immediately.",
    whatIWouldDo:
      "Check it against reality before touching it: Greenway's real Q2 2026 sits at 7 cents " +
      "against an allowance of 260. There is a factor of thirty of headroom, so if this ever " +
      "fires it is not a rounding question.",
    authorityIds: ["i941-line-7-fractions-of-cents"],
  },
  {
    fn: "fractionsOfCents",
    plainEnglish:
      "Computes line 7 by comparing what the statutory rates say should have been withheld with " +
      "what actually came out of the paycheques, and says whether the difference is credible.",
    whyItExists:
      "Rounding every cheque to the cent does not give the same answer as taxing the quarter in " +
      "one multiplication. The IRS knows this and puts a line on the form for it.",
    theTrap:
      "Computing this line as a plug - taking whatever makes the form balance - which is what " +
      "almost every implementation does because it always works. It hides a genuine withholding " +
      "error in the one place nobody checks. This function measures the residual instead, and " +
      "reports when it is too big to be rounding.",
    whatIWouldDo:
      "Never adjust this number by hand. If it refuses, open the payroll reconciliation for the " +
      "quarter, which shows the difference per person largest first, and find the human cause.",
    authorityIds: ["i941-line-7-fractions-of-cents", "irc-3101-employee-fica"],
  },
  {
    fn: "twelfthDayFor",
    plainEnglish:
      "Gives the date whose pay period line 1 counts - the 12th of the quarter's last month.",
    whyItExists:
      "March 12, June 12, September 12, December 12 are printed on the form itself. Having one " +
      "function produce them means the screen, the refusal message and the return can never " +
      "quote three different dates at each other.",
    theTrap:
      "Assuming the date is in the FIRST month of the quarter. It is the last: Q2 uses 12 June, " +
      "not 12 April.",
    whatIWouldDo:
      "Use this rather than writing the date into a message. The refusal for a missing line-1 " +
      "answer already names the exact date, which is what makes it answerable.",
    authorityIds: ["i941-line-1-pay-period-including-the-12th"],
  },
  {
    fn: "line1EmployeeCount",
    plainEnglish:
      "Counts the people who were on the payroll for the pay period containing the 12th, and " +
      "returns nothing at all if anybody's answer is unrecorded.",
    whyItExists:
      "Line 1 is the only figure on the return that cannot be derived from the wage records, " +
      "because it is a question about a moment in time rather than about money.",
    theTrap:
      "Counting an unrecorded answer as a 'no'. An unknown and a no are indistinguishable in a " +
      "count and mean completely different things - so this returns null rather than a number " +
      "that is quietly too small, and the caller refuses.",
    whatIWouldDo:
      "Answer the question for each person named in the refusal. It is a two-second question per " +
      "person and it prevents a mismatch that surfaces in January against the W-2s.",
    authorityIds: ["i941-line-1-pay-period-including-the-12th"],
  },
  {
    fn: "form941DueDates",
    plainEnglish:
      "Gives both deadlines for a quarter: the ordinary one, and the later one that is earned by " +
      "having made every deposit on time.",
    whyItExists:
      "The regulation states two dates, and the second is conditional on conduct rather than on " +
      "asking. Showing only one of them would either hide breathing room or promise it falsely.",
    theTrap:
      "Treating the last day of the month as the deadline without checking what day it falls on. " +
      "31 October 2027 is a Sunday, so Q3 2027 is really due 1 November. This function reuses " +
      "the deposit engine's holiday calendar rather than writing a second one - two calendars " +
      "that disagree about a business day is two answers to a deadline.",
    whatIWouldDo:
      "Plan to the ordinary date. The ten-day extension depends on a deposit history this return " +
      "cannot verify, and discovering one late deposit after relying on it converts a " +
      "comfortable filing into a late one.",
    authorityIds: ["cfr-31-6071a1-when-due", "cfr-301-7503-1-weekend-holiday-shift"],
  },
  {
    fn: "lineOf",
    plainEnglish: "Fetches one line of the finished return by its number, like '5a' or '12'.",
    whyItExists:
      "So that callers and tests never index into the line list by position. Positions change " +
      "when a line is added; line numbers are fixed by the IRS.",
    theTrap:
      "`lines[6]` is line 7 today and line 5b tomorrow. A test written that way passes while " +
      "checking the wrong figure.",
    whatIWouldDo:
      "Always ask for the line by its printed number, and treat a missing line as a real answer - " +
      "line 14 genuinely does not exist on a quarter with nothing owed.",
    authorityIds: [],
  },
  {
    fn: "buildForm941",
    plainEnglish:
      "Builds the whole return from a quarter's wages, or refuses and says exactly what is " +
      "missing.",
    whyItExists:
      "This is the summation Michael described, plus the two lines that are not summation, plus " +
      "the refusals that stop it producing a plausible wrong answer.",
    theTrap:
      "Returning on the first problem found. A screen that reports one error, gets it fixed, and " +
      "then reports the next one wastes an afternoon and feels like the software is toying with " +
      "you. Every validation runs before any arithmetic and all refusals come back together.",
    whatIWouldDo:
      "Work the refusal list from the top - they are ordered so that fixing the earlier ones " +
      "often clears the later ones - and re-run. Nothing is saved by building a return, so " +
      "there is never anything to undo.",
    authorityIds: [
      "cfr-31-6011a1-must-file-quarterly",
      "i941-line-2-matches-w2-box-1",
      "i941-line-7-fractions-of-cents",
    ],
  },
];

export function form941LessonFor(fn: string): MentorLesson | undefined {
  return FORM_941_LESSONS.find((l) => l.fn === fn);
}

export function form941TaughtFunctionNames(): readonly string[] {
  return FORM_941_LESSONS.map((l) => l.fn);
}

/**
 * Every authority id any lesson cites, de-duplicated.
 *
 * Used by the gate that proves no lesson cites a text that does not exist -
 * a citation to a missing authority renders as nothing at all on the screen,
 * which is worse than no citation because it looks like the claim was sourced.
 */
export function form941CitedAuthorityIds(): readonly string[] {
  const out = new Set<string>();
  for (const l of FORM_941_LESSONS) for (const id of l.authorityIds) out.add(id);
  return [...out];
}

/**
 * Prove every cited authority id actually resolves.
 *
 * Checks against this slice's own registry and the borrowed-id list rather
 * than against the whole payroll registry, so that a lesson citing a text the
 * 941 screen does not actually display is still an error.
 *
 * Throws rather than returning a boolean (standing rule 48).
 */
export function assertEveryForm941CitationResolves(knownIds: readonly string[]): void {
  const known = new Set([...FORM_941_AUTHORITIES.map((a) => a.id), ...knownIds]);
  for (const l of FORM_941_LESSONS) {
    for (const id of l.authorityIds) {
      if (!known.has(id)) {
        throw new Error(
          `form-941-mentor: lesson for "${l.fn}" cites authority "${id}", which the 941 screen ` +
            `does not carry. A citation that resolves to nothing renders as nothing, which looks ` +
            `exactly like a claim that was never sourced.`,
        );
      }
    }
  }
}

/** Checklist in order, with a guard against two items claiming the same slot. */
export function form941ChecksInOrder(): readonly Form941Check[] {
  const sorted = [...FORM_941_CHECKS].sort((a, b) => a.order - b.order);
  const orders = sorted.map((c) => c.order);
  if (new Set(orders).size !== orders.length) {
    throw new Error("form-941-mentor: two checklist items claim the same order.");
  }
  return sorted;
}

/**
 * Prove every refusal code the engine can emit has a lesson.
 *
 * Throws rather than returning a boolean (standing rule 48).
 */
export function assertEveryForm941RefusalIsTaught(): void {
  for (const code of ALL_FORM_941_REFUSAL_CODES) {
    if (!form941RefusalLessonFor(code)) {
      throw new Error(
        `form-941-mentor: refusal code "${code}" can be shown to Michael but has no lesson. ` +
          `He would see a code and no way forward.`,
      );
    }
  }
  for (const lesson of FORM_941_REFUSAL_LESSONS) {
    if (!ALL_FORM_941_REFUSAL_CODES.includes(lesson.code)) {
      throw new Error(
        `form-941-mentor: there is a lesson for "${lesson.code}", which the engine can no longer ` +
          `emit. Dead teaching is standing rule 50 in the mentor layer.`,
      );
    }
  }
}
