/**
 * SICK LEAVE AUTHORITIES - the law behind accrual, use, payment and carryover.
 *
 * books-33. Michael's instruction for this slice, verbatim: "I need a way for
 * employees to request sick time. I want an enterprise grade solution for this."
 *
 * Washington's paid sick leave rules are unusually easy to implement WRONG in a
 * way that is invisible for years, because almost every mistake produces a
 * number that looks reasonable. Accrue at 1 hour per 40 and floor the remainder
 * each period: defensible-looking, and it quietly shorts every employee. Pay
 * sick leave at the employee's own rate: obviously correct, and wrong for
 * anybody sitting at the minimum wage. Count sick hours toward the forty-hour
 * overtime threshold: intuitive, and it overpays forever.
 *
 * So the sentences that decide those questions are quoted here VERBATIM from
 * the mirrored regulation rather than paraphrased, and the engine is built
 * around them.
 *
 * STANDING RULE 24: the quote is sacred. Every `quote` below is a
 * character-for-character copy taken from the mirrored source file on disk, not
 * a retyping from memory. scripts/verify-verbatim-quotes.ts re-reads each one
 * against its corpus on every commit and fails the build on a single character
 * of drift.
 */

export type SickLeaveAuthority = {
  readonly id: string;
  /**
   * Same vocabulary the merged guidance registry uses. Washington rules are
   * tagged "state_law" because that is what every other WAC and RCW in this
   * codebase is tagged, and the tag drives the badge printed next to the
   * citation on screen.
   */
  readonly kind: "regulation" | "state_law";
  readonly cite: string;
  /** Verbatim. Copied from the mirrored corpus, never retyped. */
  readonly quote: string;
  /** What it means for Greenway, in Michael's language. */
  readonly soWhat: string;
  readonly source: string;
};

const WAC_SOURCE = "docs/authorities/state-wa/wac-296-128-paid-sick-leave.txt";
const CFR778_SOURCE = "docs/authorities/federal/29-cfr-778-overtime.txt";

/* ------------------------------------------------------------------ *
 * ACCRUAL - the floor, and the right to beat it
 * ------------------------------------------------------------------ */

/**
 * The rate, and the explicit permission to be more generous.
 *
 * That second sentence matters to Michael specifically. He wants to treat
 * people well, and the rule says in as many words that he may.
 */
export const SICK_ACCRUAL_RATE: SickLeaveAuthority = {
  id: "wac-296-128-620-accrual",
  kind: "state_law",
  cite: "WAC 296-128-620(1)",
  quote:
    "Employees accrue paid sick leave for all hours worked. An employee must accrue at least one hour of paid sick leave for every forty hours worked as an employee. Employers may provide employees with a more generous paid sick leave accrual rate.",
  soWhat:
    "One hour of sick leave for every forty hours worked is the FLOOR, not the rule. You may accrue faster and the law encourages it. What you may not do is accrue slower, so the system refuses an accrual rate below the floor rather than saving it and letting it underpay quietly.",
  source: WAC_SOURCE,
};

/**
 * Sick leave does not accrue on sick leave.
 *
 * Worth its own entry because the intuitive implementation - accrue on every
 * paid hour - is wrong and generous, and generous errors survive audits by
 * being nobody's complaint until the year they are.
 */
export const SICK_NO_ACCRUAL_ON_LEAVE: SickLeaveAuthority = {
  id: "wac-296-128-620-hours-worked-only",
  kind: "state_law",
  cite: "WAC 296-128-620(3)",
  quote:
    "Employers are not required to allow employees to accrue paid sick leave for hours paid when not working. For example, employers are not required to allow employees to accrue paid sick leave during vacation, paid time off, or while using paid sick leave.",
  soWhat:
    "Leave accrues on hours WORKED. A week with eight hours of sick leave in it accrues on the worked hours only. The engine subtracts leave hours before it multiplies, in one named function, so this cannot be forgotten at one call site and remembered at another.",
  source: WAC_SOURCE,
};

/**
 * Carryover. THE reason the two-bucket design exists.
 *
 * Read (4) and (5) together: at least forty hours MUST carry over, and forty is
 * also the most an employer may cap it at. So every statutory hour left unused
 * at year end, up to forty, becomes next year's opening balance. If Michael's
 * gifts were pooled with statutory hours, his generosity would permanently
 * raise that floor.
 */
export const SICK_CARRYOVER: SickLeaveAuthority = {
  id: "wac-296-128-620-carryover",
  kind: "state_law",
  cite: "WAC 296-128-620(4)",
  quote:
    "Employers must allow employees to carry over at least forty hours of accrued, unused paid sick leave to the following year. If an employee carries over forty hours of unused paid sick leave to the following year, accrual of paid sick leave in the subsequent year would be in addition to the forty hours accrued in the previous year and carried over.",
  soWhat:
    "Up to forty unused hours follow the employee into next year and next year's accrual stacks ON TOP. This is exactly why the system spends EARNED hours before hours you awarded: what survives to December is then the gift, which may lapse, instead of statutory leave you would be required to carry. Without that ordering every generous gesture would raise your carryover liability permanently.",
  source: WAC_SOURCE,
};

export const SICK_CARRYOVER_CAP: SickLeaveAuthority = {
  id: "wac-296-128-620-carryover-cap",
  kind: "state_law",
  cite: "WAC 296-128-620(5)",
  quote:
    "Employers may cap carryover of accrued, unused paid sick leave to the following year at forty hours. Employers may allow for a more generous carryover of accrued, unused paid sick leave to the following year.",
  soWhat:
    "Forty hours is the lowest cap you may set. You may set a higher one or none at all. Leaving the answer blank is NOT the same as unlimited, so the system refuses to close out a year until you have said which you mean.",
  source: WAC_SOURCE,
};

/* ------------------------------------------------------------------ *
 * USE - when, and in what slices
 * ------------------------------------------------------------------ */

export const SICK_USABLE_NINETIETH_DAY: SickLeaveAuthority = {
  id: "wac-296-128-630-usable",
  kind: "state_law",
  cite: "WAC 296-128-630(2)",
  quote:
    "An employee is entitled to use accrued, unused paid sick leave beginning on the 90th calendar day after the commencement of their employment. Employers may allow employees to use accrued, unused paid sick leave prior to the 90th calendar day after the commencement of their employment.",
  soWhat:
    "Accrual starts on day one; only USE waits, and ninety days is the longest you may make anyone wait. A new hire who gets sick in week two has the leave banked and simply cannot spend it yet - the system says so in those words rather than showing a zero, because a zero looks like they earned nothing. Awarding the time is the normal way to cover someone early.",
  source: WAC_SOURCE,
};

export const SICK_USAGE_INCREMENT: SickLeaveAuthority = {
  id: "wac-296-128-630-increment",
  kind: "state_law",
  cite: "WAC 296-128-630(4)",
  quote:
    "Unless a greater increment is approved by a variance as provided by WAC 296-128-640, employers must allow employees to use paid sick leave in increments consistent with the employer's payroll system and practices, not to exceed one hour.",
  soWhat:
    "You cannot force sick leave to be taken in blocks bigger than an hour. Someone who needs forty minutes for an appointment is charged forty minutes, not a half day. The system refuses a usage increment above one hour outright.",
  source: WAC_SOURCE,
};

export const SICK_EMPLOYEE_CHOOSES: SickLeaveAuthority = {
  id: "wac-296-128-630-employee-chooses",
  kind: "state_law",
  cite: "WAC 296-128-630(1)",
  quote:
    "This right means an employee has the choice about whether or not to use accrued, unused paid sick leave when a qualified purpose occurs and an employer may not require an employee to use accrued, unused paid sick leave if the employee does not choose to request to use paid sick leave.",
  soWhat:
    "You cannot make someone burn sick leave they did not ask to use. An employee who wants an unpaid day rather than spending their balance is entitled to that. This is why leave is only ever deducted against a REQUEST in the system - the ledger structurally cannot record a usage that nobody asked for.",
  source: WAC_SOURCE,
};

/* ------------------------------------------------------------------ *
 * NOTICE AND VERIFICATION - what you may ask for, and what you may not
 * ------------------------------------------------------------------ */

export const SICK_NOTICE_FORESEEABLE: SickLeaveAuthority = {
  id: "wac-296-128-650-notice",
  kind: "state_law",
  cite: "WAC 296-128-650(1)(a)",
  quote:
    "If the need for paid sick leave is foreseeable, the employer may require advance notice from the employee. Unless the employer allows less advance notice, the employee must provide notice at least ten days, or as early as practicable, in advance of the use of paid sick leave.",
  soWhat:
    "Ten days' notice for something planned, like surgery. NOTE WHAT THE REMEDY IS NOT: late notice does not forfeit the leave. The system flags short notice as something to have a word about and still approves the request, because a system that auto-denied on notice would generate unlawful denials at scale.",
  source: WAC_SOURCE,
};

export const SICK_NOTICE_UNFORESEEABLE: SickLeaveAuthority = {
  id: "wac-296-128-650-notice-unforeseeable",
  kind: "state_law",
  cite: "WAC 296-128-650(1)(b)",
  quote:
    "If the need for paid sick leave is unforeseeable, the employer may require notice from the employee. The employee must provide notice to the employer as soon as possible before the required start of their shift, unless it is not practicable to do so.",
  soWhat:
    "Waking up sick means telling you before the shift starts, if they can. If they cannot, someone else may call on their behalf. That is the standard the request screen is built to - a phone call at 6am is compliant notice, so a manager can enter the request for them.",
  source: WAC_SOURCE,
};

export const SICK_VERIFICATION_THREE_DAYS: SickLeaveAuthority = {
  id: "wac-296-128-660-verification",
  kind: "state_law",
  cite: "WAC 296-128-660(1)",
  quote:
    "For absences exceeding three days, an employer may require verification that an employee's use of paid sick leave is for an authorized purpose under RCW 49.46.210 (1)(b) and (c).",
  soWhat:
    "EXCEEDING three days, so the earliest you may ask for a note is the fourth day. Asking on day two is unlawful, and the system will not save a policy that tries. You also need a written policy on file BEFORE asking anyone for anything, and the note may not be made a condition of taking the time off.",
  source: WAC_SOURCE,
};

export const SICK_VERIFICATION_NO_BURDEN: SickLeaveAuthority = {
  id: "wac-296-128-660-no-burden",
  kind: "state_law",
  cite: "WAC 296-128-660(4)",
  quote: "Employer-required verification may not result in an unreasonable burden or expense on the employee.",
  soWhat:
    "If getting the note costs the employee money or time they cannot spare, that is your problem to solve, not theirs - which in practice can mean paying for the visit. A person earning hourly wages who has to pay a clinic to prove they were sick is the textbook unreasonable burden.",
  source: WAC_SOURCE,
};

/* ------------------------------------------------------------------ *
 * PAYMENT - the rate, and the deadline
 * ------------------------------------------------------------------ */

/**
 * THE GREATER OF. The single most missable word in this whole area.
 *
 * For everyone at Greenway earning above minimum wage this makes no difference,
 * which is exactly why an engine that ignores it passes every test anyone
 * thinks to run - right up until the year someone is hired at the floor, or the
 * floor moves in January and a rate does not.
 */
export const SICK_RATE_OF_PAY: SickLeaveAuthority = {
  id: "wac-296-128-670-rate",
  kind: "state_law",
  cite: "WAC 296-128-670(1)",
  quote:
    "For each hour of paid sick leave used, an employee must be paid the greater of the minimum hourly wage rate established by RCW 49.46.020 or their normal hourly compensation.",
  soWhat:
    "Sick leave is paid at the GREATER of minimum wage or their own rate - not simply their own rate. It only bites for someone sitting at the floor, which is precisely why it is easy to get wrong and never notice. The system compares both every time, and refuses to price sick leave at all for a date it has no evidenced minimum wage for.",
  source: WAC_SOURCE,
};

export const SICK_PAYMENT_DEADLINE: SickLeaveAuthority = {
  id: "wac-296-128-680-payment",
  kind: "state_law",
  cite: "WAC 296-128-680(1)",
  quote:
    "Unless verification for absences exceeding three days is required by an employer, the employer must pay paid sick leave to an employee no later than the payday for the pay period in which the paid sick leave was used by the employee. If verification is required by the employer, paid sick leave must be paid to the employee no later than the payday for the pay period during which verification is provided to the employer by the employee.",
  soWhat:
    "Sick leave is paid on the normal payday for the period it was used in - you do not get to hold it over. The one exception is where you required verification, in which case the clock runs from when they hand the note in. The ledger tracks which pay period each entry was paid in, so unpaid leave cannot silently roll forward.",
  source: WAC_SOURCE,
};

export const SICK_MONTHLY_NOTIFICATION: SickLeaveAuthority = {
  id: "wac-296-128-755-notification",
  kind: "state_law",
  cite: "WAC 296-128-755(2)",
  quote:
    "Not less than monthly, employers must provide each employee with written or electronic notification detailing the amount of paid sick leave accrued, the amount of paid sick leave paid before usage to construction workers covered by a collective bargaining agreement as permissible under RCW 49.46.180, the paid sick leave reductions since the last notification, and any unused paid sick leave available for use by the employee. Employers may satisfy the notification requirements by providing this information in regular payroll statements.",
  soWhat:
    "Every month, in writing: accrued, reductions since last time, and available. Not on request - automatically. Note the last sentence, which is the practical way to comply: put it on the pay stub and the obligation is met. This is the requirement most small employers do not know exists, and it is met here by a function that builds the sentence from the ledger rather than by somebody remembering to send something.",
  source: WAC_SOURCE,
};

/* ------------------------------------------------------------------ *
 * THE OVERTIME INTERACTION - the question Michael asked by name
 * ------------------------------------------------------------------ */

/**
 * "no part of such payments may be credited toward overtime compensation due
 * under the Act."
 *
 * Michael got here on his own: "If sick time used pushes the total hours for
 * the week over 40, they do not get paid over time for that sick time." The
 * regulation agrees, and says two things, not one:
 *
 *   - sick pay is EXCLUDED FROM THE REGULAR RATE, and
 *   - no part of it may be CREDITED TOWARD OVERTIME.
 *
 * The second is the one that answers his question, and the one payroll systems
 * miss while getting the first right.
 */
export const SICK_NOT_HOURS_WORKED: SickLeaveAuthority = {
  id: "cfr-778-218-idle-hours",
  kind: "regulation",
  cite: "29 CFR §778.218(a)",
  quote:
    "Payments which are made for occasional periods when the employee is not at work due to vacation, holiday, illness, failure of the employer to provide sufficient work, or other similar cause, where the payments are in amounts approximately equivalent to the employee's normal earnings for a similar period of time, are not made as compensation for his hours of employment. Therefore, such payments may be excluded from the regular rate of pay under section 7(e)(2) of the Act and, for the same reason, no part of such payments may be credited toward overtime compensation due under the Act.",
  soWhat:
    "You were right. Thirty-six worked hours plus eight sick hours is forty-four PAID hours and ZERO overtime, because overtime counts hours WORKED and paid leave is not work. The sick pay also stays out of the regular rate used to price any real overtime in the week. Both halves are implemented, and a mutation test proves the suite notices if either is broken.",
  source: CFR778_SOURCE,
};

export const SICK_OVERTIME_ON_HOURS_WORKED: SickLeaveAuthority = {
  id: "cfr-778-102-hours-worked",
  kind: "regulation",
  cite: "29 CFR §778.102",
  quote:
    "If no more than the maximum number of hours prescribed in the Act are actually worked in the workweek, overtime compensation pursuant to section 7(a) need not be paid.",
  soWhat:
    "ACTUALLY WORKED. That phrase is the whole answer to the sick-time-and-overtime question, and it is why the engine tests worked hours against forty and never the paid total.",
  source: CFR778_SOURCE,
};

/* ------------------------------------------------------------------ *
 * THE REGISTRY
 * ------------------------------------------------------------------ */

export const SICK_LEAVE_AUTHORITIES: readonly SickLeaveAuthority[] = [
  SICK_ACCRUAL_RATE,
  SICK_NO_ACCRUAL_ON_LEAVE,
  SICK_CARRYOVER,
  SICK_CARRYOVER_CAP,
  SICK_USABLE_NINETIETH_DAY,
  SICK_USAGE_INCREMENT,
  SICK_EMPLOYEE_CHOOSES,
  SICK_NOTICE_FORESEEABLE,
  SICK_NOTICE_UNFORESEEABLE,
  SICK_VERIFICATION_THREE_DAYS,
  SICK_VERIFICATION_NO_BURDEN,
  SICK_RATE_OF_PAY,
  SICK_PAYMENT_DEADLINE,
  SICK_MONTHLY_NOTIFICATION,
  SICK_NOT_HOURS_WORKED,
  SICK_OVERTIME_ON_HOURS_WORKED,
];
