/**
 * src/lib/payroll/timesheet-mentor.ts   (books-32)
 *
 * THE CPA SITTING NEXT TO MICHAEL WHILE HE TURNS PUNCHES INTO PAYABLE HOURS.
 *
 * He asked for exactly this, in these words:
 *
 *   "I want the same verbatim text, the same mentorship, the same guidance. I
 *    love how the system knows what I've done so far and what's still left to
 *    complete. I want this behavior here too, if there is a way to hold my hand
 *    here, then I'm all for it. It's another way to teach me the proper way, the
 *    way the enterprise players do it. I want to be on the same level as a
 *    seasoned expert cpa."
 *
 * So this module does three jobs, and the third one is the new request.
 *
 *   1. FIELD LESSONS - what each stored value is, where it is used, why it
 *      matters, the trap, and how to be sure. Same five questions, same order,
 *      as the company-information screen he liked.
 *
 *   2. SCREEN LESSONS - the ideas that are not about any one field, above all
 *      the one this entire slice exists for: overtime is owed per WORKWEEK and
 *      a pay period is not a workweek.
 *
 *   3. PROGRESS - "what's done and what's left". This is deliberately built on
 *      the SAME vocabulary the employee-onboarding checklist already uses
 *      (`StepStatus`-shaped records with a key, a label, a completeness flag,
 *      a prerequisite flag and per-field problems). Standing rule 25: extend,
 *      do not duplicate. A second, differently-shaped progress widget would
 *      look the same to Michael and behave differently the first time an edge
 *      case appeared.
 *
 * WHY THE HAND-HOLDING IS NOT DECORATION HERE. Michael's own warning about this
 * slice was "we can not mess up payroll and its reporting and payments, this one
 * will bankrupt me if we aren't careful". The specific way payroll goes wrong
 * quietly is that a biweekly period gets treated as one long week: 45 hours in
 * week one and 35 in week two is 80 hours, the period total looks like a normal
 * fortnight, and five hours of overtime premium is never paid. Nothing on screen
 * looks wrong. 29 CFR 778.104 forbids exactly that averaging, and the lessons
 * below say so in the regulation's own words.
 *
 * COVERAGE GATES AT THE BOTTOM. Standing rule 26: every engine ships a mentor
 * layer, and the gate reads the core module FROM DISK rather than trusting that
 * someone remembered to update a list.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TIMESHEET_AUTHORITIES } from "@/lib/payroll/timesheet-authorities";
import {
  WEEKDAY_NAMES,
  WA_OVERTIME_THRESHOLD_HUNDREDTH_HOURS,
  formatHundredthHours,
  type TimesheetRefusalCode,
  type WeekdayIndex,
} from "@/lib/payroll/timesheet-core";

/* ═══════════════════════════════════════════════════════════════════════════ *
 * FIELD LESSONS - what Michael reads beside each input
 * ═══════════════════════════════════════════════════════════════════════════ */

export type FieldLesson = {
  /** `table.column` this teaches. Qualified because this slice spans three tables. */
  readonly field: string;
  /** WHAT it is, with no jargon. */
  readonly whatItIs: string;
  /** WHERE it is used, naming the forms and the screens. */
  readonly whereItIsUsed: string;
  /** WHY it matters - the consequence, not the definition. */
  readonly whyItMatters: string;
  /** The mistake a competent person actually makes here. */
  readonly theTrap: string;
  /** Where to look it up rather than recalling it. */
  readonly howToBeSure: string;
  readonly authorityIds: readonly string[];
};

export const TIMESHEET_FIELD_LESSONS: readonly FieldLesson[] = [
  {
    field: "company_profile.workweek_starts_on",
    whatItIs:
      "The day of the week your workweek begins. One number, 0 for Sunday through 6 for Saturday. It is " +
      "not a preference and it is not a display setting - it is the boundary that decides which hours " +
      "belong to which week.",
    whereItIsUsed:
      "Every overtime calculation this business will ever make. It splits each pay period into workweeks " +
      "before a single hour is priced, and it therefore reaches every paycheck, every Form 941, every " +
      "W-2, and the hours reported on the Washington quarterly reports.",
    whyItMatters:
      "29 CFR 778.105 lets an employer choose the day, but once chosen the workweek is fixed and " +
      "recurring. Move it and you can make the same hours produce a different amount of overtime, which " +
      "is why the regulation says a change must be intended to be permanent rather than a device for " +
      "evading the overtime requirement. This system therefore has NO default: nobody's paycheck should " +
      "depend on a value a programmer picked.",
    theTrap:
      "Assuming it is Sunday because that is what most calendars show, or setting it to Monday because " +
      "the store's business week feels like it starts then. The right answer is whatever your existing " +
      "practice has actually been - and if payroll has never been run, it is whatever you decide now and " +
      "then leave alone. Picking the wrong day is not a small error: with a Sunday anchor a Saturday " +
      "double shift lands in the week that is already at 40 hours, and with a Saturday anchor it starts " +
      "a fresh week at zero. Same hours, different pay.",
    howToBeSure:
      "If Greenway has any payroll history, read the day off it and match it. If there is genuinely no " +
      "history, choose the day that makes your scheduling easiest to reason about and write down the " +
      "date the choice takes effect in the field below.",
    authorityIds: [
      "cfr-778-105-workweek-definition",
      "cfr-778-104-workweek-stands-alone",
    ],
  },
  {
    field: "company_profile.workweek_starts_at_hour",
    whatItIs:
      "The hour of that day at which the workweek turns over, 0 for midnight through 23. Almost always " +
      "midnight, which is why this one does have a default of 0.",
    whereItIsUsed:
      "The same place as the day: the boundary between one 168-hour period and the next.",
    whyItMatters:
      "778.105 defines the workweek as a fixed and regularly recurring period of 168 hours - seven " +
      "consecutive 24-hour periods - and says it may begin on any day AND AT ANY HOUR. The hour exists " +
      "in the regulation, so it exists here. A business running overnight shifts that turns its week " +
      "over at midnight cuts a single shift in half and puts the two halves in different weeks.",
    theTrap:
      "Treating this as a formality. It is a formality for a store that closes in the evening, and it is " +
      "decidedly not one for anybody with a shift that crosses midnight on the anchor day.",
    howToBeSure:
      "Unless Greenway runs shifts through midnight on the anchor day, leave it at midnight. If it ever " +
      "does, set the hour to a time when nobody is on the clock.",
    authorityIds: ["cfr-778-105-workweek-definition"],
  },
  {
    field: "company_profile.workweek_effective_date",
    whatItIs:
      "The date this workweek definition started applying. A history marker, not a switch.",
    whereItIsUsed:
      "Reading back a past pay period. A period from before this date was computed against whatever the " +
      "definition was then, and this field is what lets anyone tell the difference later.",
    whyItMatters:
      "778.105 permits the beginning of the workweek to be changed, but only if the change is intended " +
      "to be permanent and is not designed to evade the overtime requirements. That standard is about " +
      "INTENT, and intent is proved by contemporaneous records. A dated change with a reason is a " +
      "record; an undated edit to a settings row is not.",
    theTrap:
      "Changing the anchor day and leaving this blank, which turns a documented policy change into an " +
      "unexplained discrepancy between old paychecks and new ones.",
    howToBeSure:
      "Set it to the first day of the first workweek the new definition governs - never to a mid-week " +
      "date, which would create a stub period that is neither the old week nor the new one.",
    authorityIds: ["cfr-778-105-workweek-definition"],
  },
  {
    field: "employees.flsa_status",
    whatItIs:
      "Whether this person is entitled to overtime pay. 'non_exempt' means yes, they get time and a half " +
      "past forty hours. 'exempt' means no. The default is non_exempt, on purpose.",
    whereItIsUsed:
      "The overtime calculation for every pay period, and the classification you would have to defend if " +
      "the Department of Labor or Washington L&I ever asked.",
    whyItMatters:
      "RCW 49.46.130 requires one and one-half times the regular rate over forty hours a week, and then " +
      "lists who is excluded. Getting this wrong in the employer's favour is the single most expensive " +
      "mistake in wage and hour law, because it is not one paycheck - it is every paycheck for that " +
      "person for as long as the misclassification lasted, plus interest, and often doubled.",
    theTrap:
      "Believing that paying a salary creates an exemption. It does not. Exemption depends on the DUTIES " +
      "actually performed plus a salary threshold; a salaried shift lead who mostly rings up customers " +
      "is non-exempt and is owed overtime. The reverse trap is just as real: this system refuses the " +
      "combination of 'exempt' with an hourly rate, because that pairing is nearly always somebody " +
      "reaching for the wrong dropdown.",
    howToBeSure:
      "Default to non_exempt. It is the safe answer and it is the correct answer for essentially every " +
      "retail position. Only mark somebody exempt after reading the duties tests, and write the duties " +
      "you relied on into the reason field so the decision survives the memory of it.",
    authorityIds: ["rcw-49-46-130-overtime", "rcw-49-46-130-exemptions"],
  },
  {
    field: "employees.flsa_exempt_reason",
    whatItIs:
      "The written reason a person is marked exempt. Required, and at least ten characters, whenever " +
      "flsa_status is 'exempt'.",
    whereItIsUsed:
      "Nowhere in the arithmetic. It exists solely so that the classification can be explained later by " +
      "someone reading the record rather than reconstructing a decision from memory.",
    whyItMatters:
      "An exemption is a legal conclusion about someone's job duties. If it is ever questioned, the " +
      "employer is the one who has to justify it, and 'that is how it was set up' is not a " +
      "justification. Writing the reason at the moment of the decision costs a minute and is worth " +
      "years.",
    theTrap:
      "Typing 'salaried' or 'manager'. Neither is a reason - the first is a payment method and the " +
      "second is a job title. A reason names the duties: who they direct, what they decide, what they " +
      "are responsible for.",
    howToBeSure:
      "Read the exclusions in RCW 49.46.130 and the corresponding federal duties tests, then write one " +
      "or two sentences naming the specific duties. If you cannot write it, the exemption probably does " +
      "not hold.",
    authorityIds: ["rcw-49-46-130-exemptions"],
  },
  {
    field: "pay_periods.start_date",
    whatItIs: "The first calendar day of the pay period, inclusive.",
    whereItIsUsed:
      "Selecting which punches belong to this paycheck, and splitting the period into workweeks.",
    whyItMatters:
      "The period is the container for the paycheck; the workweek is the container for overtime. They " +
      "are different containers and this field defines only the first one. A period that starts on the " +
      "same weekday as the workweek anchor divides cleanly into whole weeks. One that does not will " +
      "contain part-weeks, and the system will say so rather than pretending otherwise.",
    theTrap:
      "Setting periods that overlap. The database physically refuses overlapping periods of the same " +
      "cadence, because an overlap means some hours could be paid on two different cheques.",
    howToBeSure:
      "Generate the year's calendar in one go rather than adding periods one at a time. Twenty-six " +
      "biweekly periods laid out at once cannot drift; twenty-six typed individually will.",
    authorityIds: ["cfr-778-104-workweek-stands-alone"],
  },
  {
    field: "pay_periods.end_date",
    whatItIs: "The last calendar day of the pay period, inclusive.",
    whereItIsUsed: "The other end of the punch selection and of the workweek split.",
    whyItMatters:
      "Inclusive means a period ending 2027-01-16 includes everything worked on the 16th. Off-by-one " +
      "here does not error - it silently moves a day's hours into the next cheque.",
    theTrap:
      "Making the end date the same as the next period's start date. That is an overlap, the day is in " +
      "two periods, and the constraint will reject it.",
    howToBeSure:
      "Each period's end date should be exactly one day before the next period's start date. For a " +
      "biweekly calendar, end minus start is always thirteen days.",
    authorityIds: ["cfr-778-104-workweek-stands-alone"],
  },
  {
    field: "pay_periods.pay_date",
    whatItIs: "The day the money actually reaches the employee. For Greenway, a Friday.",
    whereItIsUsed:
      "This, not the end date, determines the TAX YEAR and the QUARTER the wages belong to. It therefore " +
      "drives which Form 941 the wages appear on and which year's W-2.",
    whyItMatters:
      "Wages are reported when PAID, not when earned. A period ending 31 December 2027 that is paid on " +
      "7 January 2028 is 2028 wages. Getting that backwards misstates two years at once - it overstates " +
      "one W-2 and understates the next - and the error is discovered by a mismatch notice rather than " +
      "by anyone reading the books.",
    theTrap:
      "Assuming the pay date follows the period end automatically. At a year boundary it is the one " +
      "field on the screen that decides which annual return the money lands on.",
    howToBeSure:
      "Check the last period of every calendar year individually. Everything else in the year takes care " +
      "of itself.",
    authorityIds: ["cfr-778-104-workweek-stands-alone"],
  },
  {
    field: "pay_periods.status",
    whatItIs:
      "Where this period is in its life. 'planned' means generated but not reviewed. 'approved' means a " +
      "human read it and said yes. 'locked' means payroll has been run and filed against it.",
    whereItIsUsed:
      "The approval gate. Timesheets are gathered against approved periods; nothing may change a locked " +
      "one.",
    whyItMatters:
      "Once a Form 941 has been filed for a quarter, the periods inside that quarter are evidence, and " +
      "evidence that can be edited is not evidence. The lock is what makes the filed return and the " +
      "underlying records agree permanently.",
    theTrap:
      "Approving the whole year's calendar at generation time because it is quicker. Approval is meant " +
      "to be the moment somebody looks at a specific fortnight; approving fifty-two weeks in advance " +
      "converts a control into a formality.",
    howToBeSure:
      "Approve a period when you are about to run it. The system records who approved it and when, and " +
      "an approval with no name on it is not an approval.",
    authorityIds: ["cfr-778-104-workweek-stands-alone"],
  },
];

/* ═══════════════════════════════════════════════════════════════════════════ *
 * SCREEN LESSONS - the ideas that are not about one field
 * ═══════════════════════════════════════════════════════════════════════════ */

export type ScreenLesson = {
  readonly topic: string;
  readonly plainEnglish: string;
  readonly whyItMatters: string;
  readonly authorityIds: readonly string[];
};

export const TIMESHEET_SCREEN_LESSONS: readonly ScreenLesson[] = [
  {
    topic: "The one idea this whole screen exists to protect: each workweek stands alone",
    plainEnglish:
      "Overtime is owed per WORKWEEK, never per pay period. 29 CFR 778.104 says each workweek stands " +
      "alone and that an employer cannot average hours over two or more weeks. The regulation's own " +
      "example is a worker who puts in 30 hours one week and 50 the next: that worker is owed overtime " +
      "for the ten hours over forty in the second week, even though the two-week total is exactly 80.",
    whyItMatters:
      "A biweekly pay period contains two workweeks. If software asks 'is the period total over 80?' it " +
      "will answer no for 30 and 50, pay nothing extra, and look completely normal on screen. That is " +
      "the defect this engine is built to make impossible: it buckets hours into workweeks before it " +
      "prices a single one, and the tests include that exact 30-and-50 example alongside a 40-and-40 " +
      "control that must owe nothing.",
    authorityIds: [
      "cfr-778-104-workweek-stands-alone",
      "cfr-778-105-workweek-definition",
    ],
  },
  {
    topic: "Why the system refuses to guess which day your week starts",
    plainEnglish:
      "There is no default workweek. If nobody has chosen one, this screen stops and asks instead of " +
      "computing. The column in the database has no default value either, so the refusal cannot be " +
      "bypassed by writing directly to the table.",
    whyItMatters:
      "The anchor day changes the answer. Take an employee who works 45 hours across a stretch that " +
      "straddles a Saturday: with one anchor those hours fall in a single week and five hours of premium " +
      "are owed, with another they split across two weeks and none is. A guessed default would produce " +
      "a confident number that is wrong, and nothing on the screen would hint at it. A refusal is " +
      "louder and cheaper.",
    authorityIds: ["cfr-778-105-workweek-definition"],
  },
  {
    topic: "What time and a half actually means, and why we add a half rather than multiplying",
    plainEnglish:
      "RCW 49.46.130 requires at least one and one-half times the regular rate for hours over forty. The " +
      "federal regulation's worked example computes it as straight time on EVERY hour, plus an extra " +
      "half-rate on the hours past forty: 46 hours at $12 is $552 of straight time plus $36 of premium, " +
      "which is $588. The engine follows that shape exactly, and the test compares against $588.00.",
    whyItMatters:
      "The two ways of writing it - 40 x rate + 6 x 1.5 x rate, or 46 x rate + 6 x 0.5 x rate - give the " +
      "same answer, but only one of them matches how the regulation and the payroll forms present it. " +
      "Keeping the same shape as the source removes a translation step, and a translation step is " +
      "somewhere a bug can live undetected.",
    authorityIds: [
      "cfr-778-110-hourly-rate-employee",
      "cfr-778-109-regular-rate-is-hourly",
      "rcw-49-46-130-overtime",
    ],
  },
  {
    topic: "Hours are a reportable quantity, not just an ingredient of pay",
    plainEnglish:
      "Washington's quarterly report asks for the total HOURS worked by each worker, and L&I charges " +
      "workers' compensation premium per hour rather than per dollar. So hours have to survive the trip " +
      "from the time clock to the quarterly reports intact - they cannot be collapsed into a gross-pay " +
      "figure along the way.",
    whyItMatters:
      "It is why this engine keeps hours in integer hundredths all the way through instead of converting " +
      "to money as early as possible. Money is one consumer of these hours. The state reports are " +
      "another, and they need the hours themselves.",
    authorityIds: ["rcw-49-46-130-overtime"],
  },
  {
    topic: "Why hours are stored as whole numbers and rounded only once",
    plainEnglish:
      "Every quantity here is an integer: hours in hundredths of an hour, money in cents, pay rates in " +
      "thousandths of a cent. Minutes are added up for a whole workweek FIRST, and converted to hours " +
      "once at the end.",
    whyItMatters:
      "Rounding each punch separately and then adding them accumulates error. Eight seven-minute punches " +
      "rounded individually come to 96 hundredths of an hour; summed first they are 56 minutes, which is " +
      "93. Three hundredths of an hour is small, and it is also wrong, and it recurs every period " +
      "forever. There is a test that asserts 93 and would fail on 96.",
    authorityIds: ["cfr-778-109-regular-rate-is-hourly"],
  },
  {
    topic: "When a pay period does not line up with the workweek, you get told",
    plainEnglish:
      "If a period begins on a day other than your workweek anchor, it contains part-weeks: a piece of a " +
      "week at the start, whole weeks in the middle, and a piece at the end. The system shows those " +
      "part-weeks as part-weeks and warns you, rather than treating a fragment as though it were a full " +
      "week.",
    whyItMatters:
      "Overtime is owed on the WHOLE workweek. If four days of a week are in this period and three are " +
      "in the next, neither period can decide on its own whether overtime is owed for that week - the " +
      "hours have to be read together. Silently treating a four-day fragment as a complete week is how " +
      "overtime goes unpaid at every period boundary. The clean fix is to align pay periods to the " +
      "workweek, which is why the biweekly calendar starts on the anchor day.",
    authorityIds: [
      "cfr-778-104-workweek-stands-alone",
      "cfr-778-105-workweek-definition",
    ],
  },
  {
    topic: "The minimum wage moves every January 1st, and 2027 is your first payroll",
    plainEnglish:
      "RCW 49.46.020(2)(b) has L&I recalculate the Washington minimum wage each September 30th, using " +
      "CPI-W inflation for the twelve months to September 1st, and the new figure takes effect the " +
      "following January 1st. The rate on file here is $16.66 for 2025 and $17.13 for 2026, and the 2026 " +
      "row deliberately CLOSES on 2026-12-31.",
    whyItMatters:
      "Your first payroll runs on January 1st 2027, which is the exact day a new minimum wage takes " +
      "effect. The 2027 figure will be announced on 30 September 2026 and it is not in this system yet. " +
      "Until somebody enters it, the pay screens refuse rather than testing rates against the stale " +
      "2026 floor - because a rate that was legal in December can be illegal in January without anyone " +
      "touching it, and a silent pass using last year's number looks exactly like a real check. This is " +
      "a live item on your cutover list, not a hypothetical.",
    authorityIds: ["rcw-49-46-020-minimum-wage-indexed"],
  },
  {
    topic: "The engine pays from the timestamps, and tells you when the stored total disagrees",
    plainEnglish:
      "Each punch has a clock-in time, a clock-out time, and a stored minutes figure. Pay is always " +
      "computed from the two timestamps. If the stored figure disagrees, the difference is reported " +
      "beside the punch instead of being quietly overwritten.",
    whyItMatters:
      "A disagreement between a stored total and its own source data is a symptom. It might be a manual " +
      "edit, a clock correction, or a bug in whatever wrote the row - and all three are worth knowing " +
      "about. Picking one silently would destroy the evidence that anything ever differed.",
    authorityIds: ["cfr-778-109-regular-rate-is-hourly"],
  },
];

/* ═══════════════════════════════════════════════════════════════════════════ *
 * REFUSAL LESSONS - what a refusal means, in Michael's language
 * ═══════════════════════════════════════════════════════════════════════════ */

export type RefusalLesson = {
  readonly code: TimesheetRefusalCode;
  /** One line, for a banner. */
  readonly headline: string;
  /** Why refusing is better than computing anyway. */
  readonly whyWeStop: string;
  /** What Michael actually does about it. */
  readonly whatToDo: string;
};

/**
 * Every refusal code the engine can emit is explained here.
 *
 * Standing rule 26 with teeth: a refusal that reaches Michael as a bare code is
 * a dead end, and a dead end in payroll is where somebody decides to override
 * the software. The gate below proves this list covers the engine's own union
 * type, read from disk.
 */
export const TIMESHEET_REFUSAL_LESSONS: readonly RefusalLesson[] = [
  {
    code: "NO_WORKWEEK_ANCHOR",
    headline: "Nobody has chosen which day the workweek starts.",
    whyWeStop:
      "Without the anchor there is no way to split this pay period into workweeks, and without workweeks " +
      "there is no lawful way to work out overtime. Assuming Sunday would produce a number that looks " +
      "authoritative and could be wrong by hours of premium pay.",
    whatToDo:
      "Open Company Information and set 'Workweek starts on'. It is a one-time choice that should not be " +
      "changed casually afterwards.",
  },
  {
    code: "OPEN_PUNCH",
    headline: "Somebody is still clocked in, or a punch has no readable clock-out.",
    whyWeStop:
      "An open punch has no duration. Treating it as zero hours underpays somebody for a shift they " +
      "actually worked, and nothing later in the process would ever reveal it.",
    whatToDo:
      "Find the punch on the time-clock screen and close it with the correct time. If the employee " +
      "genuinely forgot to clock out, record the actual end of the shift and note why it was edited.",
  },
  {
    code: "NEGATIVE_SPAN",
    headline: "A punch clocks out before it clocks in.",
    whyWeStop:
      "Negative time is not a small data problem - it subtracts hours from the week's total, so one bad " +
      "punch can reduce somebody's pay below what they earned.",
    whatToDo:
      "Correct whichever of the two timestamps is wrong. Usually it is a date typed a day early on the " +
      "clock-out.",
  },
  {
    code: "OVERLAPPING_PUNCHES",
    headline: "Two work punches cover the same minutes.",
    whyWeStop:
      "Overlapping punches mean the same minutes would be paid twice. That is an overpayment, and " +
      "overpayments discovered later have to be recovered from an employee, which is unpleasant and " +
      "sometimes legally constrained.",
    whatToDo:
      "Open both punches and decide which one is real. A common cause is a double clock-in where the " +
      "first attempt did not appear to register.",
  },
  {
    code: "PUNCH_OUTSIDE_PERIOD",
    headline: "A punch falls outside the pay period it was gathered for.",
    whyWeStop:
      "It means the punch would be paid in the wrong period, or paid twice if the neighbouring period " +
      "also picks it up.",
    whatToDo:
      "Check the pay period dates and the punch date. Either the punch has the wrong date or the period " +
      "boundaries are not what you expected.",
  },
  {
    code: "NO_HOURLY_RATE",
    headline: "An hourly employee has no pay rate on file.",
    whyWeStop:
      "There is no honest way to price hours without a rate. Substituting zero produces a paycheck for " +
      "nothing that looks like a completed calculation.",
    whatToDo:
      "Set the rate on the employee's pay record. If the rate changed mid-period, set the current rate " +
      "and check whether the earlier part of the period needs computing separately.",
  },
  {
    code: "EXEMPT_PAID_HOURLY",
    headline: "Somebody is marked exempt from overtime but is paid by the hour.",
    whyWeStop:
      "That combination is almost always a mistake, and it is the expensive direction of mistake. If the " +
      "exemption is wrong, every hour over forty since the classification was set is unpaid overtime.",
    whatToDo:
      "Check the classification against the actual duties. Exemption depends on job duties and a salary " +
      "threshold, not on how somebody is paid - and paying a salary does not create an exemption either. " +
      "If they really are exempt, record the duties you relied on in the reason field.",
  },
  {
    code: "SALARY_WITH_PUNCHES",
    headline: "A salaried employee has clock punches in this period.",
    whyWeStop:
      "The engine will not decide on its own whether those punches are pay data or merely attendance " +
      "tracking. Guessing wrong either double-pays a salaried person or discards hours that were " +
      "supposed to be paid.",
    whatToDo:
      "Decide deliberately. If they are genuinely hourly, change the pay basis. If the punches are for " +
      "attendance only, exclude them on purpose. Note that Washington still wants hours reported " +
      "quarterly even for salaried staff.",
  },
  {
    code: "BAD_PERIOD_DATES",
    headline: "The pay period ends before it starts.",
    whyWeStop:
      "Nothing downstream can be trusted from a period whose dates are impossible - the workweek split, " +
      "the punch selection and the quarter assignment all read these two dates.",
    whatToDo: "Correct the period dates on the pay calendar.",
  },
  {
    code: "IMPLAUSIBLE_SHIFT",
    headline: "A single punch is longer than twenty-four hours.",
    whyWeStop:
      "Nobody works a shift longer than a day. This is almost always a missed clock-out that somebody " +
      "closed days later, and paying it as worked time would be a large, obvious overpayment - the kind " +
      "that is embarrassing to explain and hard to recover.",
    whatToDo:
      "Correct the punch to the shift that was actually worked, and record why it was edited.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════ *
 * PROGRESS - "what's done and what's left"
 *
 * Michael: "I love how the system knows what I've done so far and what's still
 * left to complete. I want this behavior here too."
 *
 * Shapes deliberately mirror OnboardingStepKey / StepStatus / OnboardingEvaluation
 * in payroll-onboarding-core.ts (standing rule 25 - extend the vocabulary, do
 * not invent a second one).
 * ═══════════════════════════════════════════════════════════════════════════ */

export type TimesheetSetupStepKey =
  | "workweek_anchor"
  | "employee_classification"
  | "pay_calendar"
  | "period_approved"
  | "punches_clean";

export type TimesheetStepDef = {
  readonly key: TimesheetSetupStepKey;
  readonly label: string;
  /** Why this step exists, in Michael's language. */
  readonly why: string;
  /** Steps that must be complete first, because one genuinely depends on the other. */
  readonly requires: readonly TimesheetSetupStepKey[];
  /** True when an incomplete step means hours must not be computed at all. */
  readonly blocksCompute: boolean;
  readonly authorityIds: readonly string[];
};

/**
 * THE ORDER IS CAUSAL, NOT COSMETIC.
 *
 * You cannot classify hours into workweeks without an anchor. You cannot know
 * whether overtime applies to a person without their classification. You cannot
 * select punches without period dates. And you should not compute against a
 * period nobody has approved. Each step genuinely needs the one before it, and
 * `requires` is what the UI reads to grey out a step rather than letting Michael
 * start in the middle and hit a wall.
 */
export const TIMESHEET_SETUP_STEPS: readonly TimesheetStepDef[] = [
  {
    key: "workweek_anchor",
    label: "Choose the day your workweek starts",
    why:
      "Overtime is owed per workweek, so nothing can be computed until the software knows where one " +
      "week ends and the next begins. There is no default, because a guessed anchor produces confident " +
      "wrong numbers.",
    requires: [],
    blocksCompute: true,
    authorityIds: [
      "cfr-778-105-workweek-definition",
      "cfr-778-104-workweek-stands-alone",
    ],
  },
  {
    key: "employee_classification",
    label: "Say who is entitled to overtime",
    why:
      "Every employee needs an overtime status. The default is non-exempt, which is both the safe answer " +
      "and the right one for essentially every retail role. Anybody marked exempt needs the reason " +
      "written down.",
    requires: [],
    blocksCompute: true,
    authorityIds: ["rcw-49-46-130-overtime", "rcw-49-46-130-exemptions"],
  },
  {
    key: "pay_calendar",
    label: "Lay out the pay periods for the year",
    why:
      "Twenty-six biweekly periods generated in one go cannot drift apart or overlap. Periods that start " +
      "on the workweek anchor divide cleanly into whole weeks, which is what keeps overtime from " +
      "straddling a period boundary.",
    requires: ["workweek_anchor"],
    blocksCompute: true,
    authorityIds: ["cfr-778-104-workweek-stands-alone"],
  },
  {
    key: "period_approved",
    label: "Approve the period you are about to run",
    why:
      "Approval is the moment a human looks at a specific fortnight and says yes. The system records who " +
      "and when. Computing against an unapproved period is how a draft becomes a payment.",
    requires: ["pay_calendar"],
    blocksCompute: false,
    authorityIds: ["cfr-778-104-workweek-stands-alone"],
  },
  {
    key: "punches_clean",
    label: "Clear the punch problems",
    why:
      "Open punches, overlaps and impossible shifts are refused rather than estimated. Each one is a real " +
      "discrepancy between what the clock recorded and what somebody worked, and each has to be resolved " +
      "by a person who knows what happened.",
    requires: ["pay_calendar"],
    blocksCompute: true,
    authorityIds: ["cfr-778-109-regular-rate-is-hourly"],
  },
];

/** The observable facts the progress panel needs. Supplied by the store, never invented here. */
export type TimesheetSetupFacts = {
  /** null when nobody has chosen - NOT defaulted (standing rule 62d). */
  readonly workweekStartsOn: WeekdayIndex | null;
  /** How many employees are active and therefore need a classification. */
  readonly activeEmployeeCount: number;
  /** Active employees whose flsa_status has never been reviewed by a human. */
  readonly unclassifiedEmployeeCount: number;
  /** Active employees marked exempt with no written reason. */
  readonly exemptWithoutReasonCount: number;
  /** Pay periods on the calendar for the tax year in question. */
  readonly payPeriodCount: number;
  /** How many there should be for the cadence, e.g. 26 biweekly. */
  readonly expectedPayPeriodCount: number | null;
  /** Whether the period currently selected has been approved. Null when none is selected. */
  readonly selectedPeriodApproved: boolean | null;
  /** Punch problems found in the selected period. Null when nothing has been checked yet. */
  readonly punchProblemCount: number | null;
};

export type TimesheetStepStatus = {
  readonly key: TimesheetSetupStepKey;
  readonly label: string;
  readonly complete: boolean;
  /** True when an earlier required step is not done yet. */
  readonly blockedByPrerequisite: boolean;
  /** What is still outstanding, in plain English. Empty when complete. */
  readonly outstanding: readonly string[];
  /** The single next thing to do, or null when there is nothing. */
  readonly nextAction: string | null;
};

export type TimesheetProgress = {
  readonly steps: readonly TimesheetStepStatus[];
  readonly completeCount: number;
  readonly totalCount: number;
  /** TRUE only when every compute-blocking step is clean. */
  readonly canCompute: boolean;
  /** One sentence for the top of the screen. */
  readonly summary: string;
  /** The single next thing across the whole screen, or null when finished. */
  readonly nextAction: string | null;
};

/**
 * Work out what is done and what is left.
 *
 * PURE. It reads facts and returns a description; it does not query anything and
 * it does not decide policy. That keeps it testable against constructed states
 * that would be tedious to create in a database - including the states nobody
 * expects, like a calendar with more periods than the cadence allows.
 *
 * Standing rule 62d: `null` means UNKNOWN and is reported as unknown. It is
 * never quietly read as zero or as false, because "we have not checked the
 * punches yet" and "the punches are clean" must not look identical to Michael.
 */
export function evaluateTimesheetSetup(
  facts: TimesheetSetupFacts,
): TimesheetProgress {
  const statuses: TimesheetStepStatus[] = [];
  const done = new Set<TimesheetSetupStepKey>();

  for (const step of TIMESHEET_SETUP_STEPS) {
    const blockedByPrerequisite = step.requires.some((r) => !done.has(r));
    const outstanding: string[] = [];

    switch (step.key) {
      case "workweek_anchor": {
        if (facts.workweekStartsOn === null) {
          outstanding.push(
            "No workweek start day has been chosen. Overtime cannot be computed until there is one.",
          );
        }
        break;
      }
      case "employee_classification": {
        if (facts.activeEmployeeCount === 0) {
          outstanding.push(
            "There are no active employees to classify. Add employees before running payroll.",
          );
        }
        if (facts.unclassifiedEmployeeCount > 0) {
          outstanding.push(
            `${facts.unclassifiedEmployeeCount} active employee(s) still carry the default overtime ` +
              "status without anyone having confirmed it.",
          );
        }
        if (facts.exemptWithoutReasonCount > 0) {
          outstanding.push(
            `${facts.exemptWithoutReasonCount} employee(s) are marked exempt with no written reason. ` +
              "An exemption you cannot explain is one you cannot defend.",
          );
        }
        break;
      }
      case "pay_calendar": {
        if (facts.payPeriodCount === 0) {
          outstanding.push("No pay periods exist yet for this tax year.");
        } else if (
          facts.expectedPayPeriodCount !== null &&
          facts.payPeriodCount !== facts.expectedPayPeriodCount
        ) {
          outstanding.push(
            `The calendar has ${facts.payPeriodCount} period(s) but this cadence needs ` +
              `${facts.expectedPayPeriodCount}. A short year misses a paycheck and a long one pays twice.`,
          );
        }
        break;
      }
      case "period_approved": {
        if (facts.selectedPeriodApproved === null) {
          outstanding.push("No pay period is selected, so there is nothing to approve yet.");
        } else if (!facts.selectedPeriodApproved) {
          outstanding.push(
            "The selected pay period has not been approved. Approval records who signed off and when.",
          );
        }
        break;
      }
      case "punches_clean": {
        if (facts.punchProblemCount === null) {
          outstanding.push(
            "The punches for this period have not been checked yet. Not checked is not the same as clean.",
          );
        } else if (facts.punchProblemCount > 0) {
          outstanding.push(
            `${facts.punchProblemCount} punch problem(s) need a human decision before hours can be paid.`,
          );
        }
        break;
      }
    }

    const complete = !blockedByPrerequisite && outstanding.length === 0;
    if (complete) done.add(step.key);

    statuses.push({
      key: step.key,
      label: step.label,
      complete,
      blockedByPrerequisite,
      outstanding,
      nextAction: complete
        ? null
        : blockedByPrerequisite
          ? `Finish "${
              TIMESHEET_SETUP_STEPS.find((s) => s.key === step.requires[0])?.label ??
              step.requires[0]
            }" first.`
          : (outstanding[0] ?? null),
    });
  }

  const completeCount = statuses.filter((s) => s.complete).length;
  const totalCount = statuses.length;
  const canCompute = TIMESHEET_SETUP_STEPS.filter((s) => s.blocksCompute).every(
    (s) => statuses.find((x) => x.key === s.key)?.complete === true,
  );
  const firstIncomplete = statuses.find((s) => !s.complete);

  const summary =
    completeCount === totalCount
      ? "Everything on this screen is set up. Hours can be computed and proposed for your approval."
      : `${completeCount} of ${totalCount} steps done. ${
          canCompute
            ? "Hours can be computed, but the remaining steps are worth finishing."
            : "Hours cannot be computed until the blocking steps are finished."
        }`;

  return {
    steps: statuses,
    completeCount,
    totalCount,
    canCompute,
    summary,
    nextAction: firstIncomplete?.nextAction ?? null,
  };
}

/**
 * A plain-English sentence naming the chosen workweek.
 *
 * Small, and it earns its place: "0" on a screen is meaningless and "Sunday" is
 * not, and this is the one place that translation happens so it cannot drift
 * between the settings screen and the results screen.
 */
export function describeWorkweek(
  anchor: WeekdayIndex | null,
  atHour: number = 0,
): string {
  if (anchor === null) {
    return (
      "No workweek has been chosen yet. Until one is, overtime cannot be computed - the system will " +
      "refuse rather than assume Sunday."
    );
  }
  const dayName = WEEKDAY_NAMES[anchor];
  const hourLabel =
    atHour === 0
      ? "midnight"
      : atHour < 12
        ? `${atHour}:00 in the morning`
        : atHour === 12
          ? "noon"
          : `${atHour - 12}:00 in the evening`;
  return (
    `Your workweek runs for 168 hours beginning ${dayName} at ${hourLabel}. Overtime is owed on hours ` +
    `over ${formatHundredthHours(WA_OVERTIME_THRESHOLD_HUNDREDTH_HOURS)} hours within each of those ` +
    "weeks, counted separately - never on the pay period total."
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * COVERAGE GATES (standing rule 26)
 *
 * Each one reads a real source rather than a maintained list, and each one
 * fails loudly when it reads NOTHING (standing rule 39 - a gate that inspects
 * an empty set approves everything).
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Field names that have a lesson. */
export function taughtFieldNames(): readonly string[] {
  return TIMESHEET_FIELD_LESSONS.map((l) => l.field);
}

/**
 * Every field the migration added must be taught.
 *
 * READS THE MIGRATION FROM DISK. A list typed by hand would pass forever after
 * somebody added a column and forgot the lesson, which is precisely the failure
 * this gate exists to catch.
 */
export function migrationFieldNames(sourcePath?: string): readonly string[] {
  const p =
    sourcePath ??
    join(process.cwd(), "supabase", "migrations", "0197_timesheet_workweek.sql");
  const text = readFileSync(p, "utf8");

  const names: string[] = [];

  // `alter table X add column if not exists <col>` - the table is named on a
  // preceding line, so we track the most recent `alter table` as we scan.
  let currentTable = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const alter = line.match(/^alter table (?:if exists )?(?:public\.)?([a-z_]+)/i);
    if (alter) currentTable = alter[1];
    const col = line.match(/^add column if not exists ([a-z_]+)/i);
    if (col && currentTable) names.push(`${currentTable}.${col[1]}`);
  }

  return names;
}

/** The pay_periods columns Michael actually chooses. Structural columns are not lessons. */
const PAY_PERIOD_TAUGHT_COLUMNS = [
  "pay_periods.start_date",
  "pay_periods.end_date",
  "pay_periods.pay_date",
  "pay_periods.status",
] as const;

export function assertEveryFieldIsTaught(sourcePath?: string): void {
  const fromMigration = migrationFieldNames(sourcePath);
  if (fromMigration.length === 0) {
    throw new Error(
      "MENTOR COVERAGE GATE BROKEN: read no added columns from migration 0197. A gate that inspects " +
        "nothing passes vacuously and protects nothing.",
    );
  }
  const taught = new Set(taughtFieldNames());
  const untaught = fromMigration.filter((f) => !taught.has(f));
  if (untaught.length > 0) {
    throw new Error(
      `MENTOR COVERAGE GAP: these columns have no lesson: ${untaught.join(", ")}. Standing rule 26 ` +
        `requires every field Michael can see or set to be explained before it ships.`,
    );
  }
  const missingPeriodLessons = PAY_PERIOD_TAUGHT_COLUMNS.filter((f) => !taught.has(f));
  if (missingPeriodLessons.length > 0) {
    throw new Error(
      `MENTOR COVERAGE GAP: pay period columns with no lesson: ${missingPeriodLessons.join(", ")}.`,
    );
  }
}

/**
 * No lesson may teach a field that does not exist.
 *
 * The other direction, and it matters: a lesson beside a column that was
 * renamed or dropped reads as reassurance while covering nothing.
 */
export function assertNoLessonForUnknownField(sourcePath?: string): void {
  const known = new Set([
    ...migrationFieldNames(sourcePath),
    ...PAY_PERIOD_TAUGHT_COLUMNS,
  ]);
  if (known.size === 0) {
    throw new Error(
      "MENTOR GATE BROKEN: no known fields were read, so every lesson would look stray.",
    );
  }
  const stray = taughtFieldNames().filter((f) => !known.has(f));
  if (stray.length > 0) {
    throw new Error(
      `MENTOR TEACHES FIELDS THAT DO NOT EXIST: ${stray.join(", ")}. Either the column was renamed ` +
        `and the lesson was not, or the lesson is for a field that was never added.`,
    );
  }
}

/** Every authority id cited by any lesson must exist. */
export function assertEveryCitedAuthorityExists(): void {
  const known = new Set(TIMESHEET_AUTHORITIES.map((a) => a.id));
  if (known.size === 0) {
    throw new Error(
      "MENTOR CITATION GATE BROKEN: the authority registry is empty, so every citation would pass " +
        "vacuously.",
    );
  }
  const dangling: string[] = [];
  for (const l of TIMESHEET_FIELD_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) dangling.push(`${l.field} -> ${id}`);
  }
  for (const l of TIMESHEET_SCREEN_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) dangling.push(`${l.topic} -> ${id}`);
  }
  for (const s of TIMESHEET_SETUP_STEPS) {
    for (const id of s.authorityIds) if (!known.has(id)) dangling.push(`${s.key} -> ${id}`);
  }
  if (dangling.length > 0) {
    throw new Error(
      `MENTOR CITES AUTHORITIES THAT DO NOT EXIST: ${dangling.join(", ")}. A citation with nothing ` +
        `behind it is worse than none, because the reader believes it was checked.`,
    );
  }
}

/** Authorities that no lesson uses. Reported, not thrown - see company-identity-mentor. */
export function unusedAuthorityIds(): readonly string[] {
  const used = new Set<string>();
  for (const l of TIMESHEET_FIELD_LESSONS) for (const id of l.authorityIds) used.add(id);
  for (const l of TIMESHEET_SCREEN_LESSONS) for (const id of l.authorityIds) used.add(id);
  for (const s of TIMESHEET_SETUP_STEPS) for (const id of s.authorityIds) used.add(id);
  return TIMESHEET_AUTHORITIES.filter((a) => !used.has(a.id)).map((a) => a.id);
}

/**
 * Every refusal code the engine declares has a lesson.
 *
 * READS THE ENGINE FROM DISK and parses its union type. If somebody adds an
 * eleventh refusal code, this fails until they explain it - which is the whole
 * point, because the alternative is Michael seeing a bare code on a payroll
 * screen with no idea what to do next.
 */
export function engineRefusalCodes(sourcePath?: string): readonly string[] {
  const p =
    sourcePath ?? join(process.cwd(), "src", "lib", "payroll", "timesheet-core.ts");
  const text = readFileSync(p, "utf8");
  const block = text.match(
    /export type TimesheetRefusalCode\s*=([\s\S]*?);/,
  );
  if (!block) return [];
  return [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

export function assertEveryRefusalCodeIsTaught(sourcePath?: string): void {
  const codes = engineRefusalCodes(sourcePath);
  if (codes.length === 0) {
    throw new Error(
      "MENTOR REFUSAL GATE BROKEN: read no refusal codes from timesheet-core.ts. A gate that parses " +
        "nothing approves everything.",
    );
  }
  const taught = new Set(TIMESHEET_REFUSAL_LESSONS.map((l) => l.code as string));
  const untaught = codes.filter((c) => !taught.has(c));
  if (untaught.length > 0) {
    throw new Error(
      `REFUSAL CODES WITH NO EXPLANATION: ${untaught.join(", ")}. A refusal that reaches Michael as a ` +
        `bare code is a dead end, and a dead end in payroll is where somebody overrides the software.`,
    );
  }
  const phantom = [...taught].filter((c) => !codes.includes(c));
  if (phantom.length > 0) {
    throw new Error(
      `MENTOR EXPLAINS REFUSAL CODES THAT NO LONGER EXIST: ${phantom.join(", ")}. A stale entry masks ` +
        `a real gap, because the count looks right while a live code goes untaught.`,
    );
  }
}

/** Which core functions the mentor explains. A judgement, so it is written out. */
export const CORE_FUNCTION_COVERAGE: Readonly<Record<string, string>> = {
  weekdayOfDayKey:
    "Taught by the workweek_starts_on lesson, which explains that the anchor is a weekday number and " +
    "that the boundary it creates decides which hours belong to which week.",
  daysBetweenDayKeys:
    "Taught by the pay period start/end lessons, which explain that both ends are inclusive and that " +
    "an off-by-one silently moves a day's hours onto the next cheque.",
  workweekStartFor:
    "Taught by the screen lesson on each workweek standing alone - this is the function that finds " +
    "which 168-hour period a given day belongs to.",
  splitIntoWorkweeks:
    "Taught by the screen lesson on part-weeks: a period aligned to the anchor divides into whole " +
    "weeks, one that is not divides into fragments and says so.",
  punchMinutes:
    "Taught by the screen lesson on paying from the timestamps, which explains why the stored minutes " +
    "figure is compared rather than trusted.",
  minutesToHundredthHours:
    "Taught by the screen lesson on rounding once: minutes are summed for a whole week before being " +
    "converted, because per-punch rounding accumulates.",
  computePeriodHours:
    "Taught by every screen lesson together - it is the function they describe. Its refusals are each " +
    "explained individually in TIMESHEET_REFUSAL_LESSONS.",
  formatHundredthHours:
    "Taught by the lesson on hours being a reportable quantity: hours are stored as integers and only " +
    "formatted for display, never rounded for storage.",
  formatCents:
    "Taught by the same lesson applied to money - cents are the stored unit and dollars are a " +
    "presentation of them.",
};

/**
 * The rule-26 gate: every exported core function is covered.
 *
 * Reads the file. Fails when it reads nothing. Fails when a function ships with
 * no explanation, and fails when an explanation outlives its function.
 */
export function exportedCoreFunctionNames(sourcePath?: string): readonly string[] {
  const p =
    sourcePath ?? join(process.cwd(), "src", "lib", "payroll", "timesheet-core.ts");
  const text = readFileSync(p, "utf8");
  return [...text.matchAll(/^export function ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
}

export function assertEveryExportedFunctionIsTaught(sourcePath?: string): void {
  const exported = exportedCoreFunctionNames(sourcePath);
  if (exported.length === 0) {
    throw new Error(
      "MENTOR COVERAGE GATE BROKEN: read no exported functions from timesheet-core.ts. A coverage " +
        "gate that inspects nothing passes vacuously and protects nothing.",
    );
  }
  const uncovered = exported.filter((f) => !(f in CORE_FUNCTION_COVERAGE));
  if (uncovered.length > 0) {
    throw new Error(
      `MENTOR COVERAGE GAP: these exported functions have no explanation: ${uncovered.join(", ")}. ` +
        `Standing rule 26 requires every exported function to be taught before it ships.`,
    );
  }
  const phantom = Object.keys(CORE_FUNCTION_COVERAGE).filter((k) => !exported.includes(k));
  if (phantom.length > 0) {
    throw new Error(
      `MENTOR EXPLAINS FUNCTIONS THAT NO LONGER EXIST: ${phantom.join(", ")}. A stale coverage entry ` +
        `masks a real gap, because the count looks right while a live function goes untaught.`,
    );
  }
}

/** Every setup step's prerequisites must name real steps, and must not cycle. */
export function assertSetupStepsAreWellFormed(): void {
  if (TIMESHEET_SETUP_STEPS.length === 0) {
    throw new Error("SETUP STEP GATE BROKEN: there are no steps, so progress would always read 100%.");
  }
  const keys = new Set(TIMESHEET_SETUP_STEPS.map((s) => s.key));
  const seen = new Set<TimesheetSetupStepKey>();
  for (const s of TIMESHEET_SETUP_STEPS) {
    for (const r of s.requires) {
      if (!keys.has(r)) {
        throw new Error(`STEP ${s.key} REQUIRES AN UNKNOWN STEP: ${r}.`);
      }
      if (!seen.has(r)) {
        throw new Error(
          `STEP ${s.key} REQUIRES ${r}, WHICH COMES LATER IN THE LIST. Prerequisites must be declared ` +
            `before the steps that need them, otherwise the progress panel can report a step complete ` +
            `while its prerequisite is still outstanding.`,
        );
      }
    }
    seen.add(s.key);
  }
  if (!TIMESHEET_SETUP_STEPS.some((s) => s.blocksCompute)) {
    throw new Error(
      "NO STEP BLOCKS COMPUTE: the progress panel would permit hours to be computed from nothing.",
    );
  }
}
