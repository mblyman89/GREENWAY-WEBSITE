/**
 * src/lib/accounting/tax-penalty-mentor.ts   (slice books-16)
 *
 * THE PhD CPA WHO HOLDS YOUR HAND, ONE FUNCTION AT A TIME.
 *
 * Michael asked for this in as many words, 2026-08-20:
 *
 *   "Keep adding in verbatim authoritative text to block and teach and guide
 *    me. From tax authorities and from a PhD cpa who will hold my hand every
 *    step of they way. This added layer helps the concierge slice we will
 *    build. Each function we build in the books production needs authoritative
 *    text verbatim so I know why and how."
 *
 * ── WHY THIS IS A SEPARATE FILE AND NOT JUST MORE COMMENTS ─────────────────
 *
 * Comments teach the next programmer. Michael is not reading the source. He
 * has a Master's in accounting from UW and has not opened an accounting book
 * in thirteen years, so the teaching has to arrive ON THE SCREEN, next to the
 * number, at the moment the number confuses him.
 *
 * That means the mentoring has to be DATA:
 *   - renderable by a UI without importing the engine's internals
 *   - queryable by the concierge slice when he asks a question in English
 *   - and, critically, TESTABLE — a test in this slice asserts that every
 *     exported function of tax-penalty-core.ts has a lesson here. Add a
 *     function without teaching it and the build fails. Documentation that
 *     cannot rot is the only documentation worth writing.
 *
 * ── THE VOICE ──────────────────────────────────────────────────────────────
 *
 * Every lesson answers five questions in a fixed order, because a fixed order
 * is what makes it skimmable at 11pm when the deposit is already late:
 *
 *   plainEnglish   what does this actually do, in one breath, no jargon
 *   whyItExists    what goes wrong in the real world without it
 *   theTrap        the specific mistake a competent person makes here
 *   whatIWouldDo   what a CPA would actually tell a client to DO
 *   authorityIds   the verbatim source text backing all of the above
 *
 * `theTrap` is the field that earns its keep. Michael does not need to be told
 * what a penalty is. He needs to be told the thing that is counter-intuitive
 * and expensive — that 5/10/20 are running totals, that the IRS counts days
 * while Washington counts months, that filing late and paying late in the same
 * month is 5.0% and not 5.5%.
 *
 * PURE DATA. No I/O, no clock, no engine import at runtime (type-only).
 */

import { TAX_PENALTY_AUTHORITIES_NEW } from "./tax-penalty-authorities";

// ---------------------------------------------------------------------------
// 1) THE SHAPE
// ---------------------------------------------------------------------------

/**
 * One lesson, attached to one exported function.
 *
 * `fn` is the exact exported symbol name from tax-penalty-core.ts. It is a
 * plain string rather than a union of function names on purpose: the coverage
 * test reads the real export list off the module at runtime and compares, so a
 * hand-maintained union would just be a second thing to forget to update.
 */
export type MentorLesson = {
  /** Exported symbol name in tax-penalty-core.ts. */
  readonly fn: string;
  /** One sentence. No jargon. What it does. */
  readonly plainEnglish: string;
  /** What goes wrong in the real world if this does not exist. */
  readonly whyItExists: string;
  /** The specific expensive mistake a competent person makes here. */
  readonly theTrap: string;
  /** What a CPA would actually tell you to do about it. */
  readonly whatIWouldDo: string;
  /** Authority ids backing this lesson. Never empty. */
  readonly authorityIds: readonly string[];
};

// ---------------------------------------------------------------------------
// 2) THE LESSONS
// ---------------------------------------------------------------------------

export const TAX_PENALTY_LESSONS: readonly MentorLesson[] = [
  // ── units and money ──────────────────────────────────────────────────────
  {
    fn: "applyMilliPercent",
    plainEnglish:
      "Takes a percentage of a dollar amount and gives you back a whole number of cents.",
    whyItExists:
      "Every penalty in this system is 'some percent of the tax.' If that one multiplication " +
      "is sloppy, every number downstream inherits the sloppiness, and it inherits it silently. " +
      "This function is the only place in the engine where a percentage ever meets money.",
    theTrap:
      "Ordinary computer arithmetic cannot represent most decimals exactly. In plain JavaScript " +
      "0.1 + 0.2 is 0.30000000000000004. Do that a few thousand times across a year of penalty " +
      "calculations and your books are off by an amount nobody can trace to any single entry — " +
      "which is exactly the shape of the $4,624,697.31 inventory plug that started this whole " +
      "project. So this function never uses decimals at all: it does the multiplication in exact " +
      "whole-number arithmetic and rounds ONCE, half-up, at the very end.",
    whatIWouldDo:
      "Nothing — this one is plumbing and it is deliberately boring. Just know that if you ever " +
      "see a penalty that ends in a fraction of a cent anywhere in this system, something has " +
      "gone badly wrong and you should stop and call someone.",
    authorityIds: ["rcw-82-32-090-dor-late-penalty"],
  },

  // ── dates ────────────────────────────────────────────────────────────────
  {
    fn: "isValidIsoDate",
    plainEnglish: "Checks that a date is real before anything is calculated from it.",
    whyItExists:
      "A bad date does not usually announce itself. Feed most systems 'February 30' and they " +
      "quietly roll it to March 2, then compute a penalty from a day that never existed and " +
      "present the answer with total confidence.",
    theTrap:
      "The obvious check — 'does this parse as a date' — passes February 30. This function " +
      "instead builds the date and then checks that it says the same thing back, so a day that " +
      "silently rolled into the next month gets caught.",
    whatIWouldDo:
      "If the system refuses a date you typed, do not fight it. Look at the calendar. It is " +
      "almost always a real typo and it would have cost you money downstream.",
    authorityIds: ["rcw-1-12-040-time-computation"],
  },
  {
    fn: "daysBetween",
    plainEnglish: "How many whole days from one date to another.",
    whyItExists:
      "The IRS penalty schedule is measured in DAYS, not months. Getting the day count off by " +
      "one at the wrong moment moves you a whole tier — from 2% to 5%, or 5% to 10%.",
    theTrap:
      "Daylight saving. Count days by subtracting two local timestamps and twice a year you get " +
      "23 or 25 hours instead of 24, which rounds to the wrong number of days. Every date in " +
      "this engine is handled in UTC for exactly that reason.",
    whatIWouldDo:
      "When you check a federal penalty against an IRS notice, count the days on a physical " +
      "calendar. If we disagree with the IRS by one day at a tier boundary, that is worth a " +
      "phone call — it can be thousands of dollars.",
    authorityIds: ["irc-6656-deposit-penalty"],
  },
  {
    fn: "addDays",
    plainEnglish: "Moves a date forward by a number of days.",
    whyItExists: "Used to roll a weekend due date forward to the next business day.",
    theTrap:
      "Month ends and leap years. Adding a day to February 28 is not always March 1 — in 2028 " +
      "it is February 29. Real calendar arithmetic, never assumptions about month lengths.",
    whatIWouldDo:
      "Nothing directly. But note 2028 is a leap year and this system is tested on it, because " +
      "leap-day bugs surface once every four years and always at the worst time.",
    authorityIds: ["rcw-1-12-040-time-computation"],
  },
  {
    fn: "dayOfWeek",
    plainEnglish: "Tells you which day of the week a date falls on.",
    whyItExists:
      "Because a deadline that lands on a Saturday is not really a Saturday deadline — " +
      "Washington law moves it to the next business day.",
    theTrap:
      "Time zones. Ask what day of the week it is in local time and a date near midnight can " +
      "answer differently depending on which server is asking. Everything here is UTC.",
    whatIWouldDo: "Nothing. This is plumbing under the weekend rule.",
    authorityIds: ["rcw-1-12-040-time-computation"],
  },
  {
    fn: "endOfMonth",
    plainEnglish: "Gives you the last day of whatever month a date falls in.",
    whyItExists:
      "The Department of Revenue's penalty tiers are keyed to 'the last day of the month " +
      "following the due date.' To apply that rule you have to be able to find that day exactly.",
    theTrap:
      "Assuming 30 or 31 days. February has 28 — except in 2028, 2032 and 2036, when it has 29. " +
      "A hard-coded month length is a bug with a four-year fuse.",
    whatIWouldDo:
      "When Revenue sends a notice, check WHICH month-end they used. That single date decides " +
      "whether you owe 9%, 19% or 29% — a ten-point swing on a date, not on an amount.",
    authorityIds: ["rcw-82-32-090-dor-late-penalty"],
  },
  {
    fn: "addMonths",
    plainEnglish: "Moves a date forward by whole months, clamping to the end of short months.",
    whyItExists:
      "Employment Security and L&I count 'months or part thereof of delinquency,' which means " +
      "walking forward month by month from the due date.",
    theTrap:
      "January 31 plus one month. There is no February 31. Naive code rolls it to March 3 and " +
      "silently gives you an extra tier of penalty. This clamps to February 28 (or 29) instead.",
    whatIWouldDo:
      "If you are ever late on something due at a month end, look closely at the tier we " +
      "calculated. Month-end due dates are where this arithmetic is hardest and where a vendor's " +
      "software is most likely to disagree with ours.",
    authorityIds: ["rcw-50-12-220-esd-late-penalty"],
  },
  {
    fn: "rollWeekendForward",
    plainEnglish:
      "If a deadline lands on a Saturday or Sunday, moves it to the following Monday — because " +
      "the law says the weekend does not count.",
    whyItExists:
      "RCW 1.12.040 excludes a final day that is 'a holiday, Saturday, or Sunday.' Without this, " +
      "the system would invent penalties on days when you were not actually late, and once it " +
      "does that once you stop believing any number it shows you.",
    theTrap:
      "HOLIDAYS. The statute excludes legal holidays too, and this engine does not have a " +
      "holiday calendar yet. So it handles weekends correctly and tells you on every single " +
      "result that holidays were not checked, rather than quietly pretending the gap is not " +
      "there. If your deadline is near Thanksgiving, Christmas or the Fourth of July, our answer " +
      "may show you as late by a day when the law does not.",
    whatIWouldDo:
      "Never aim for the deadline. Aim for two business days early and the entire question of " +
      "which days count stops mattering to you forever.",
    authorityIds: ["rcw-1-12-040-time-computation", "wac-314-55-089-lcb-due-date"],
  },
  {
    fn: "monthsOrPartThereof",
    plainEnglish:
      "Counts how many months late you are, where ANY part of a month counts as the whole month.",
    whyItExists:
      "Because that is the phrase the Washington statutes actually use: 'the first month or " +
      "part thereof of delinquency.'",
    theTrap:
      "There is no such thing as being a little bit into a month. One day past the one-month " +
      "mark is the full second tier — at Employment Security that is the difference between 5% " +
      "and 10% of your contributions, earned overnight, for a single day. The system rounds UP, " +
      "always, because the statute does.",
    whatIWouldDo:
      "If you are already late, find out today which side of a month boundary you are on. " +
      "Paying one day earlier can genuinely halve the penalty. That is the highest-return hour " +
      "of work available to you when you are behind.",
    authorityIds: ["rcw-50-12-220-esd-late-penalty", "rcw-51-48-210-lni-late-penalty"],
  },
  {
    fn: "dorPenaltyStep",
    plainEnglish:
      "Works out which of Revenue's three penalty steps you have reached — but counts by " +
      "CALENDAR MONTH-ENDS, not by elapsed months.",
    whyItExists:
      "Revenue's statute is worded completely differently from Employment Security's. It does " +
      "not ask how long you have been late; it asks whether particular calendar dates have gone " +
      "past. Those two questions give different answers.",
    theTrap:
      "This is the single most dangerous place in the whole engine to reuse code. Take a payment " +
      "due January 5 and paid February 10. Employment Security says you are into your second " +
      "month. Revenue says the last day of February has not arrived yet, so you are still on " +
      "step one. Identical facts, different tiers, in opposite directions. Any system that runs " +
      "both agencies through one shared calculation is wrong for at least one of them and looks " +
      "perfectly reasonable while being wrong.",
    whatIWouldDo:
      "Be aware that Revenue's clock is harsh for anything due early in a month: a return due " +
      "January 5 hits 19% the moment January 31 passes — that is 26 days of lateness costing you " +
      "a whole extra tier. Early-month due dates deserve earlier reminders.",
    authorityIds: ["rcw-82-32-090-dor-late-penalty"],
  },

  // ── the five agencies ────────────────────────────────────────────────────
  {
    fn: "computeEsdPenalty",
    plainEnglish:
      "What Employment Security charges when your unemployment contributions are late: 5%, then " +
      "10%, then 20%, plus 1% a month interest.",
    whyItExists:
      "You told us this is the one you trip over. You pay biweekly, and you forget. This puts a " +
      "number on forgetting.",
    theTrap:
      "Those percentages are RUNNING TOTALS, not additions. At the third month you owe 20% — not " +
      "5+10+20=35%. The statute says 'a TOTAL penalty of 10 percent' and 'a TOTAL penalty of 20 " +
      "percent,' and Employment Security's own website states the same schedule as increments " +
      "(5%, an additional 5%, an additional 10%). Both are correct and anyone reading one while " +
      "remembering the other double-counts. Second trap: filing late and paying late are two " +
      "separate offences, so a flat $25 report penalty can land on top.",
    whatIWouldDo:
      "This is a calendar problem, not an accounting problem, and it has a calendar solution. " +
      "Set the reminder for two business days before every deposit and it never happens again. " +
      "On a $20,000 quarterly contribution, one forgotten month is $1,000 plus interest — that " +
      "is a lot of money for a recurring appointment you make once.",
    authorityIds: [
      "rcw-50-12-220-esd-late-penalty",
      "rcw-50-24-040-esd-interest",
      "rcw-50-12-220-6-penalty-waiver",
    ],
  },
  {
    fn: "computeLniPenalty",
    plainEnglish:
      "What L&I charges on late workers' comp premiums: the same 5/10/20 running totals, a $10 " +
      "floor, 1% a month interest, plus an extra penalty if they issue a warrant.",
    whyItExists:
      "L&I premiums are quarterly and easy to overlook because the amounts are smaller than " +
      "payroll taxes. The penalty schedule is not smaller.",
    theTrap:
      "The money is not the real exposure here. Under RCW 51.16.150, after a written demand the " +
      "State can require a bond of DOUBLE a year's estimated premiums and, failing that, get a " +
      "court order 'restraining the delinquent from prosecuting an occupation or work.' An L&I " +
      "default does not just cost you a percentage — it can close your doors.",
    whatIWouldDo:
      "Treat L&I with the same seriousness as payroll tax even though the dollars are smaller. " +
      "And if you ever receive a written demand from L&I, that is not a bill to file — that is " +
      "the same day you call a professional.",
    authorityIds: ["rcw-51-48-210-lni-late-penalty", "rcw-51-16-150-lni-injunction"],
  },
  {
    fn: "computeDorPenalty",
    plainEnglish:
      "What the Department of Revenue charges on late sales tax and B&O: 9%, then 19%, then 29%, " +
      "plus interest at an annual rate that is fixed every January.",
    whyItExists:
      "These are the biggest percentages of any agency you deal with, and Revenue's clock is the " +
      "one that behaves least like the others.",
    theTrap:
      "Two things. First, 9/19/29 are running totals — 29% is the worst case, not 57%. Second, " +
      "and this one genuinely surprises people: the penalties STACK. RCW 82.32.090(8) says " +
      "outright that the late-payment, substantial-underpayment and warrant penalties 'can each " +
      "be imposed on the same tax.' A bad audit can realistically produce 29 + 25 + 10 = 64% " +
      "before interest. The system adds them rather than taking the largest, because the statute " +
      "says to.",
    whatIWouldDo:
      "Sales tax is money you collected from customers on the State's behalf — like the excise " +
      "tax, it was never yours. If cash is ever tight, pay the trust taxes first and negotiate " +
      "on everything else. That is the ranking a CPA would give you and it is not close.",
    authorityIds: [
      "rcw-82-32-090-dor-late-penalty",
      "rcw-82-32-090-8-penalties-stack",
      "rcw-82-32-050-dor-interest",
    ],
  },
  {
    fn: "lcbDueDateForSalesMonth",
    plainEnglish:
      "Works out the LCB deadline for a month of sales: the 20th of the following month, moved " +
      "forward if that lands on a weekend.",
    whyItExists:
      "So no screen and no import can ever hand the engine a made-up excise due date. The " +
      "deadline is a rule in WAC 314-55-089(1)(c), not a fact somebody types in.",
    theTrap:
      "It is the 20th of the month AFTER the sales — January's sales are due February 20. And " +
      "you file every month even if you owe nothing. A zero month with no report is still a " +
      "missed filing.",
    whatIWouldDo:
      "The 20th, every month, no exceptions. Put it on the wall. This is the tax that can cost " +
      "you the licence, not just money.",
    authorityIds: ["wac-314-55-089-lcb-due-date"],
  },
  {
    fn: "computeLcbPenalty",
    plainEnglish:
      "What the Liquor and Cannabis Board charges on late cannabis excise tax: 2% per month, " +
      "with no ceiling.",
    whyItExists:
      "The 37% excise is the largest single tax you handle, and the LCB's penalty is the only " +
      "one of the five with no stated cap.",
    theTrap:
      "Two traps, and one of them is not about money at all. First: the 37% was NEVER YOUR " +
      "MONEY. RCW 69.50.535(4) says it is 'held in trust,' and you are 'personally liable' — " +
      "past the LLC — 'whether such failure is the result of the seller's own acts or the result " +
      "of acts or conditions beyond the seller's control.' Being robbed is not a defence. " +
      "Second: WAC 314-55-092(2) makes non-payment 'sufficient grounds ... to suspend or revoke " +
      "a cannabis license.' The 2% is the least of it.",
    whatIWouldDo:
      "Physically separate the excise money. In a cash business, trust money sitting in the same " +
      "drawer as operating money is the single largest uninsured risk in the building — and " +
      "because the liability is personal, it follows you home. Also: confirm you have a " +
      "cash-payment waiver on file, because paying the LCB in cash without one is its own 10% " +
      "penalty under WAC 314-55-089(8), separate from being late.",
    authorityIds: [
      "rcw-69-50-535-excise-trust",
      "wac-314-55-092-lcb-late-excise",
      "wac-314-55-089-cash-payment-penalty",
    ],
  },
  {
    fn: "irsDepositRateMilliPercent",
    plainEnglish:
      "The federal penalty percentage for a late payroll deposit, based on how many DAYS late " +
      "it is: 2%, 5%, 10%, or 15%.",
    whyItExists:
      "Exposed on its own so the boundary days can be tested directly. The jumps between tiers " +
      "are where the money is.",
    theTrap:
      "Read the boundaries carefully, because they are not evenly spaced. Five days late is 2%. " +
      "SIX days late is 5% — the penalty more than doubles overnight. Fifteen days is 5%; " +
      "sixteen is 10%. There is no gentle ramp and there is no floor or cap.",
    whatIWouldDo:
      "If you have already missed a federal deposit, the question is not 'when can I get to " +
      "it' — it is 'can I do it before day 6.' That one day is worth 3% of the deposit. On a " +
      "$15,000 deposit that is $450 for a single day.",
    authorityIds: ["irc-6656-deposit-penalty"],
  },
  {
    fn: "computeIrsDepositPenalty",
    plainEnglish:
      "The full federal penalty for depositing payroll taxes late, with the reasoning and " +
      "warnings attached.",
    whyItExists:
      "This is the one that punishes your specific habit hardest, and it is the reason the " +
      "alerting work matters more than any other feature on the roadmap.",
    theTrap:
      "The federal meter runs about three times faster than Washington's at the start. Six days " +
      "late and the IRS is already at 5% while Employment Security is still inside its first " +
      "month at 5% — but the IRS reaches 10% at day 16, which the State does not reach for " +
      "months. Paying biweekly and 'catching up next payroll' is precisely the pattern this " +
      "penalty was designed to catch, because two weeks is always past day 15.",
    whatIWouldDo:
      "Two things, in order. Short term: an automatic reminder two business days before every " +
      "deposit. Longer term: consider paying the deposit the same day you run payroll, as one " +
      "action, so there is no window to forget in. And know that the amounts you withhold from " +
      "employees are trust funds under IRC §7501 — under §6672 the IRS can collect 100% of the " +
      "trust portion from you personally, LLC or not. Same principle as the cannabis excise.",
    authorityIds: ["irc-6656-deposit-penalty", "irc-7501-trust-fund-payroll"],
  },
  {
    fn: "computeIrsFilePayPenalty",
    plainEnglish:
      "Federal penalties for filing a return late (5% a month) and for paying it late (0.5% a " +
      "month), with the offset between them applied correctly.",
    whyItExists:
      "Filing and paying are two different failures with two different penalties, and there is a " +
      "rule connecting them that almost every calculator gets wrong.",
    theTrap:
      "Filing late and paying late in the same month is 5.0%, NOT 5.5%. IRC §6651(c)(1) reduces " +
      "the failure-to-file penalty by the failure-to-pay penalty for every month both apply. " +
      "Adding the two published schedules together is the obvious thing to do and it overstates " +
      "the penalty by ten percent of itself, every month. The flip side is the lesson: the " +
      "penalty for not FILING is TEN TIMES the penalty for not PAYING. And there is a second " +
      "trap hiding behind the first, which this engine originally fell into: the offset does " +
      "NOT run forever. The failure-to-file penalty maxes out after five months, and once it " +
      "stops accruing there is nothing left for the offset to reduce. Keep subtracting anyway " +
      "and you eventually report a failure-to-file penalty of zero, which makes a five-year " +
      "delinquency look cheaper than a five-month one. The IRS says it plainly: 'After 5 " +
      "months the failure to file penalty will max out, but the failure to pay penalty " +
      "continues.' The real ladder is 4.5% a month for five months (22.5%), then 0.5% a month " +
      "alone up to a SEPARATE 25% ceiling. Worst case is 47.5% of the tax in penalties before " +
      "a single dollar of interest.",
    whatIWouldDo:
      "If you cannot pay, file anyway. Always. File on time and pay late and you are at 0.5% a " +
      "month; miss both and you are at 5%. Filing costs you nothing and it is the single " +
      "cheapest decision available to a business that is short on cash. Put differently: on a " +
      "$10,000 liability, filing the return on time and paying nothing for five months costs " +
      "$250. Not filing it costs $2,500. Same money owed, same date, ten times the damage, and " +
      "the only difference is a signature.",
    authorityIds: ["irc-6651-failure-to-file", "irc-6651-c-1-file-pay-interaction"],
  },

  // ── consequences and self-description ────────────────────────────────────
  {
    fn: "bookingInstructions",
    plainEnglish:
      "Tells you which expense account each piece of a penalty notice goes to, and which pieces " +
      "get added back on the tax return.",
    whyItExists:
      "A single agency notice contains up to three amounts with three DIFFERENT tax treatments. " +
      "Booking them to one 'penalties and interest' account produces a wrong return in two " +
      "directions at once and guarantees somebody rebuilds the split from paper in April.",
    theTrap:
      "Most people assume penalties are non-deductible and interest is deductible, and use one " +
      "to work out the other. That is wrong in the case that matters most to you. Interest on " +
      "your PERSONAL 1040 deficiency flowing off a Greenway K-1 is NOT deductible — Treasury's " +
      "own worked example in Reg. §1.163-9T(b)(2)(ii) is literally 'A, an individual, owns stock " +
      "of an S corporation.' But interest on a late sales or excise or payroll tax IS " +
      "deductible under §1.163-9T(b)(2)(iii)(A). So 'is it interest' and 'is it deductible' are " +
      "two separate questions and this system stores two separate answers.",
    whatIWouldDo:
      "Keep the three accounts separate and never net them. Do that and your Schedule M-1 " +
      "add-back falls straight out of the ledger. One footnote: at Greenway, §280E then " +
      "disallows the deductible interest anyway because it is not cost of goods sold — but the " +
      "ATM and the landholding activity are not cannabis businesses, so there the deduction is " +
      "real. Same rule, different answer per entity, which is why we classify rather than " +
      "pre-collapse.",
    authorityIds: [
      "irc-162-f-penalties-not-deductible",
      "irc-163-h-personal-interest",
      "treas-reg-1-163-9t-personal-interest",
      "treas-reg-1-163-9t-business-tax-carveout",
    ],
  },
  {
    fn: "AGENCY_CLOCKS",
    plainEnglish:
      "A plain-language summary of how each of the five agencies counts lateness, so you can see " +
      "side by side why they give different answers.",
    whyItExists:
      "Because the most common reaction to these numbers is 'why does the IRS say one thing and " +
      "the State another on the same day.' This is the answer, on screen, as data rather than " +
      "buried in code.",
    theTrap:
      "Assuming there is such a thing as 'the late penalty.' There are five, they use three " +
      "different units of time (elapsed months, calendar month-ends, days), and only some of " +
      "them have caps or floors. Any mental shortcut that treats them as one thing will be " +
      "wrong at least four times out of five.",
    whatIWouldDo:
      "Read this table once, properly, and you will never again be surprised by a notice. The " +
      "single most useful fact in it: the IRS counts DAYS and everyone else counts MONTHS. That " +
      "is why the federal deposit is always the most urgent thing on the list.",
    authorityIds: [
      "rcw-50-12-220-esd-late-penalty",
      "rcw-51-48-210-lni-late-penalty",
      "rcw-82-32-090-dor-late-penalty",
      "wac-314-55-092-lcb-late-excise",
      "irc-6656-deposit-penalty",
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// 3) LOOKUP AND VALIDATION
// ---------------------------------------------------------------------------

const LESSONS_BY_FN: ReadonlyMap<string, MentorLesson> = new Map(
  TAX_PENALTY_LESSONS.map((l) => [l.fn, l]),
);

/** The lesson for one function, or undefined. */
export function lessonFor(fn: string): MentorLesson | undefined {
  return LESSONS_BY_FN.get(fn);
}

/** Every function name that has a lesson. */
export function taughtFunctionNames(): readonly string[] {
  return TAX_PENALTY_LESSONS.map((l) => l.fn);
}

/**
 * The ids of every authority cited anywhere in the mentoring layer.
 *
 * Used by the wiring test: every one of these must resolve to a real record,
 * either in this slice's registry or in one of the registries listed in
 * AUTHORITY_IDS_OWNED_ELSEWHERE. A lesson that cites a citation which does not
 * exist is worse than a lesson with no citation, because it looks sourced.
 */
export function citedAuthorityIds(): readonly string[] {
  const out = new Set<string>();
  for (const l of TAX_PENALTY_LESSONS) for (const id of l.authorityIds) out.add(id);
  return [...out].sort();
}

/**
 * Ids cited by the mentoring layer that live in THIS slice's registry.
 * Exposed so a test can prove the two files agree without importing both into
 * every caller.
 */
export function locallyOwnedAuthorityIds(): readonly string[] {
  return TAX_PENALTY_AUTHORITIES_NEW.map((a) => a.id).sort();
}
