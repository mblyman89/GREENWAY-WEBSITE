/**
 * src/lib/payroll/sick-leave-mentor.ts   (books-35)
 *
 * THE MENTOR LAYER FOR WASHINGTON PAID SICK LEAVE.
 *
 * books-33 shipped `sick-leave-core.ts` — 45KB of engine, sixteen authorities,
 * eighteen refusal codes — and shipped it with NO mentor. Standing rule 26 says
 * every engine ships a mentor layer, and that debt is what this file pays.
 * Michael's instruction, verbatim:
 *
 *     "Please make sure the last slice has expert cpa mentoring like the
 *      others, I haven't had a chance to inspect yet. But I want rich
 *      mentorship and expert guidance. Please keep including that including
 *      the verbatim source text. Include anything you think will help me
 *      understand everything easier and better."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY SICK LEAVE IS THE MOST DANGEROUS SMALL THING IN PAYROLL
 * ─────────────────────────────────────────────────────────────────────────────
 * Every mistake available here produces a number that looks entirely
 * reasonable. There is no crash, no imbalance, no rejected filing. The engine
 * is built around that fact, and so is this mentor.
 *
 *   - Accrue at one hour per forty and round DOWN each period: defensible,
 *     tidy, and it shorts every employee by a few minutes every fortnight for
 *     years.
 *   - Pay sick leave at the employee's own hourly rate: obviously right, and
 *     wrong for anyone sitting at the minimum wage, because the rule says the
 *     GREATER of their rate or the minimum.
 *   - Count sick hours toward the forty-hour overtime threshold: intuitive,
 *     and it overpays forever.
 *   - Pool awarded leave with earned leave: generous, and it permanently
 *     raises the carryover Michael is legally obliged to honour.
 *
 * None of those four surfaces as an error. Each surfaces as a Labor &
 * Industries finding, years later, with interest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURE DATA. NO `node:fs`. STANDING RULE 65b.
 * ─────────────────────────────────────────────────────────────────────────────
 * This file is imported by client components. It must stay free of Node
 * built-ins. The coverage GATES that read the migration and the engine off
 * disk live in `sick-leave-mentor-gates.ts`, which tests import and browsers
 * cannot reach. In books-33 mixing the two dragged `node:fs` into a browser
 * bundle and Turbopack refused every Vercel deployment while CI stayed green.
 */
import type { SickLeaveRefusalCode } from "@/lib/payroll/sick-leave-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * FIELD LESSONS - one per stored column
 * ═══════════════════════════════════════════════════════════════════════════ */

export type FieldLesson = {
  /** `table.column` this teaches. */
  readonly field: string;
  /** WHAT it is, with no jargon. */
  readonly whatItIs: string;
  /** WHERE it is used, naming the screens and the consequences. */
  readonly whereItIsUsed: string;
  /** WHY it matters - the consequence, not the definition. */
  readonly whyItMatters: string;
  /** The mistake a competent person actually makes here. */
  readonly theTrap: string;
  /** Where to look it up rather than recalling it. */
  readonly howToBeSure: string;
  readonly authorityIds: readonly string[];
};

/**
 * ONE LESSON PER COLUMN.
 *
 * The unit columns are the ones to read slowly. This schema stores sick leave
 * in MINUTES, accrual in HUNDREDTHS OF A MINUTE per hour worked, and pay rates
 * in THOUSANDTHS OF A CENT per hour. Those are not affectations. Each one
 * exists because the natural unit loses money to rounding, and the lessons say
 * where.
 */
export const SICK_LEAVE_FIELD_LESSONS: readonly FieldLesson[] = [
  /* ── sick_leave_policy: the rules Michael chose ──────────────────────── */
  {
    field: "sick_leave_policy.id",
    whatItIs:
      "Always the number 1. Greenway is one employer with one sick leave policy, and this column " +
      "is what makes a second policy row impossible rather than a convention somebody has to " +
      "remember.",
    whereItIsUsed:
      "Nowhere on screen. It exists so the database itself enforces that there is exactly one " +
      "answer to 'what is our policy', instead of trusting that nobody ever inserts a second row.",
    whyItMatters:
      "If two policy rows could exist, the accrual engine would silently pick one of them. Two " +
      "plausible accrual rates in a table with no rule about which wins is how an employer ends " +
      "up accruing at different rates in different months and cannot explain why.",
    theTrap:
      "Treating a settings table as ordinary data. Settings tables want a constraint that pins " +
      "them to one row; without it, the second row is never noticed because nothing breaks.",
    howToBeSure:
      "The migration declares `id smallint primary key check (id = 1)`. The check constraint is " +
      "the enforcement; the primary key alone would happily accept a row with id 2.",
    authorityIds: [],
  },
  {
    field: "sick_leave_policy.accrual_hundredth_minutes_per_hour",
    whatItIs:
      "How much sick leave an employee earns for each hour they work, counted in HUNDREDTHS OF A " +
      "MINUTE. The legal minimum is 150 — that is 1.50 minutes of leave per hour worked, which " +
      "is one hour of leave for every forty hours worked.",
    whereItIsUsed:
      "Multiplied by hours worked every pay period to produce the accrual entry in the ledger. It " +
      "is the single number the whole accrual side of the system turns on.",
    whyItMatters:
      "The unit is the point. If this were stored as whole minutes it would have to be 1 or 2 — " +
      "one minute per hour accrues one hour of leave per SIXTY hours worked, which is below the " +
      "legal floor, and two minutes per hour is a third more generous than required. Neither is " +
      "the law. Hundredths let the system store exactly one-fortieth of an hour and be right.",
    theTrap:
      "Accruing to the nearest whole minute each pay period and letting the remainder fall on the " +
      "floor. Eighty hours worked at the statutory rate is 120.00 minutes exactly, so it looks " +
      "harmless — until a period with 73 hours in it, where the true accrual is 109.5 minutes and " +
      "rounding down loses half a minute. Do that twenty-six times a year for a decade and the " +
      "employer has quietly kept hours the employee earned. The engine carries the remainder " +
      "instead of discarding it.",
    howToBeSure:
      "WAC 296-128-620(1) sets the floor and says in as many words that you may be more generous. " +
      "The system refuses to save anything below 150 rather than accepting it and underpaying " +
      "quietly.",
    authorityIds: ["wac-296-128-620-accrual"],
  },
  {
    field: "sick_leave_policy.carryover_cap_minutes",
    whatItIs:
      "The most unused sick leave an employee may carry into next year, in minutes. The legal " +
      "floor is 2400 minutes, which is forty hours.",
    whereItIsUsed:
      "The year-end carryover calculation. Anything above this cap in the statutory bucket lapses " +
      "on 31 December; everything up to it becomes the employee's opening balance in January.",
    whyItMatters:
      "Forty hours is the LOWEST cap you may set, not the required one. You may cap higher or not " +
      "cap at all. And next year's accrual stacks on top of whatever carries over — an employee " +
      "who carries forty hours does not start the year at forty and stop, they start at forty and " +
      "keep earning.",
    theTrap:
      "Recording 'we don't cap it' as a blank. Blank in this column means UNANSWERED, not " +
      "UNLIMITED, and the system refuses to close a year until you have said which you mean. An " +
      "uncapped policy is stored as a very large number, on purpose, so that the absence of an " +
      "answer never masquerades as a generous one.",
    howToBeSure:
      "WAC 296-128-620(4) requires at least forty hours to carry over; (5) permits a cap at forty " +
      "and permits more generous carryover. Read together they make forty the floor and the " +
      "minimum lawful cap simultaneously.",
    authorityIds: ["wac-296-128-620-carryover", "wac-296-128-620-carryover-cap"],
  },
  {
    field: "sick_leave_policy.usable_after_days",
    whatItIs:
      "How many calendar days after a person is hired before they may SPEND the sick leave they " +
      "have been earning since day one. The legal ceiling is 90.",
    whereItIsUsed:
      "Checked on every request. A new hire inside the window gets the refusal NOT_YET_USABLE, " +
      "which says the leave is banked and cannot be spent yet.",
    whyItMatters:
      "Accrual starts on day one; only USE waits. Those are different dates and conflating them " +
      "is the commonest sick leave error there is. Ninety days is the longest you may make anyone " +
      "wait — you may allow use sooner, and many employers do.",
    theTrap:
      "Showing a new hire a balance of zero. They have not earned nothing; they have earned hours " +
      "they cannot spend yet, and a zero tells them a lie they may repeat to L&I. The system says " +
      "the sentence out loud instead of showing a misleading number.",
    howToBeSure:
      "WAC 296-128-630(2). The column is constrained to 0–90 in the migration, so a policy that " +
      "tried to make somebody wait four months cannot be saved at all.",
    authorityIds: ["wac-296-128-630-usable"],
  },
  {
    field: "sick_leave_policy.usage_increment_minutes",
    whatItIs:
      "The smallest slice of sick leave an employee may take. Legally this may not exceed 60 " +
      "minutes without a variance from L&I.",
    whereItIsUsed:
      "Every request is checked against it. A request that is not a whole multiple is refused " +
      "with REQUEST_NOT_IN_INCREMENT before it can reach a timesheet.",
    whyItMatters:
      "This is an employee protection, not an employer convenience. Someone who needs forty " +
      "minutes for an appointment must be charged forty minutes. Forcing them to spend half a day " +
      "for a forty minute absence is unlawful, and it is the default behaviour of a great many " +
      "payroll systems.",
    theTrap:
      "Setting this to a half day or a full shift because that is how the schedule is built. The " +
      "system refuses any value above 60 outright, so the unlawful setting cannot be saved and " +
      "then forgotten.",
    howToBeSure:
      "WAC 296-128-630(4) caps the increment at one hour 'unless a greater increment is approved " +
      "by a variance'. If Greenway ever obtains such a variance, that is a deliberate change to " +
      "this constraint, not a setting.",
    authorityIds: ["wac-296-128-630-increment"],
  },
  {
    field: "sick_leave_policy.verification_after_days",
    whatItIs:
      "How many consecutive days an absence must run before Michael may ask for a doctor's note. " +
      "The law permits this only for absences EXCEEDING three days, so the lowest lawful value " +
      "here is 4.",
    whereItIsUsed:
      "Policy validation, and the request review that tells Michael whether he is entitled to ask " +
      "for verification on a given absence.",
    whyItMatters:
      "The word in the regulation is 'exceeding'. Exceeding three days means the fourth day is " +
      "the earliest you may ask. Asking on day two is unlawful even if the employee happily " +
      "complies, and the system will not save a policy that tries.",
    theTrap:
      "Reading 'three days' as 'three days or more' and setting this to 3. Off by one, unlawful, " +
      "and completely invisible until somebody complains. The engine refuses anything below 4 " +
      "with VERIFICATION_THRESHOLD_UNLAWFUL.",
    howToBeSure:
      "WAC 296-128-660(1), quoted verbatim in the authorities file: 'For absences exceeding three " +
      "days, an employer may require verification...'",
    authorityIds: ["wac-296-128-660-verification"],
  },
  {
    field: "sick_leave_policy.verification_required",
    whatItIs:
      "Whether Greenway actually asks for verification, as opposed to whether it would be " +
      "entitled to. Yes, no, or unanswered.",
    whereItIsUsed:
      "Two places, and the second is the surprising one. It gates whether verification may be " +
      "requested at all, and it changes the PAYMENT DEADLINE for the leave.",
    whyItMatters:
      "'We may ask after four days' and 'we do ask' are different facts, and the law requires a " +
      "WRITTEN POLICY on file before verification may be demanded of anybody. So this is stored " +
      "separately from the threshold, and left blank it means unanswered rather than no.",
    theTrap:
      "Not realising this moves the payday. Normally sick leave must be paid on the payday for " +
      "the period in which it was used. If you required verification, the clock instead runs from " +
      "when the employee hands the note in. Employers who require notes and pay on the original " +
      "schedule are usually paying EARLY, which is fine — but the ones who hold the pay without " +
      "having required verification are late, and that is a wage violation.",
    howToBeSure:
      "WAC 296-128-660(2) requires the written policy; WAC 296-128-680(1) sets both deadlines and " +
      "makes the distinction explicit.",
    authorityIds: ["wac-296-128-660-verification", "wac-296-128-680-payment"],
  },
  {
    field: "sick_leave_policy.notification_policy_text",
    whatItIs:
      "The written sick leave notice given to employees at hire, stored as text so the version " +
      "that was in force on any past date can be recovered.",
    whereItIsUsed:
      "Onboarding paperwork, and as evidence if a policy question is ever raised about a past " +
      "period.",
    whyItMatters:
      "Written notice at hire is a requirement, not a courtesy. Storing the text rather than a " +
      "tick-box means that when somebody asks 'what did we tell employees in 2027', there is an " +
      "answer that does not depend on anyone's memory.",
    theTrap:
      "Keeping the policy in a Word document on one computer. The obligation is to have notified " +
      "the employee; proving it years later is the hard part, and a file nobody can find is the " +
      "same as no policy at all.",
    howToBeSure: "WAC 296-128-755(1) requires the notification at the commencement of employment.",
    authorityIds: ["wac-296-128-755-notification"],
  },
  {
    field: "sick_leave_policy.notes",
    whatItIs:
      "Free text for Michael. Why a setting is what it is, when it changed, who advised it.",
    whereItIsUsed: "The policy screen only. Nothing computes from it.",
    whyItMatters:
      "Settings outlive the reasoning behind them. A note saying 'accrual raised to 200 on " +
      "1/1/2028 because we promised it at the staff meeting' is the difference between a " +
      "deliberate benefit and a number nobody can account for three years later.",
    theTrap:
      "Putting an employee's medical information here. Nothing about anybody's health belongs in " +
      "this system anywhere, and this free-text box is the most tempting place to break that.",
    howToBeSure:
      "If it names a person and a condition, it does not go in the software. The purpose codes " +
      "exist precisely so that the reason for leave is recorded as a category and never as a " +
      "diagnosis.",
    authorityIds: [],
  },

  /* ── sick_leave_requests: what was asked, and what Michael decided ───── */
  {
    field: "sick_leave_requests.leave_date",
    whatItIs:
      "The single calendar day this request covers. A three-day absence is three rows, not one " +
      "row with a range.",
    whereItIsUsed:
      "The approval inbox, the timesheet once approved, and the consecutive-day count that " +
      "decides whether verification may be asked for.",
    whyItMatters:
      "One row per day is what makes partial approval possible and what makes the day count " +
      "honest. Michael can approve Monday and Tuesday and query Wednesday. With a date range he " +
      "would have to approve or refuse the whole absence.",
    theTrap:
      "Assuming consecutive rows mean a consecutive absence. Two days either side of a day off " +
      "are not a three-day absence for verification purposes, and the engine counts actual " +
      "consecutive days rather than counting rows.",
    howToBeSure:
      "The verification threshold in WAC 296-128-660(1) is about days of absence. Look at the " +
      "dates themselves, not the number of requests.",
    authorityIds: ["wac-296-128-660-verification"],
  },
  {
    field: "sick_leave_requests.minutes_requested",
    whatItIs:
      "How much leave is being asked for on that day, in minutes. Constrained to more than zero " +
      "and no more than 1440, which is a full twenty-four hours.",
    whereItIsUsed:
      "Checked against the balance and the usage increment, then drawn from the ledger once " +
      "approved, then priced and paid.",
    whyItMatters:
      "Minutes, not hours, because the increment rule is expressed in minutes and because a " +
      "forty-minute appointment is a lawful request. Storing hours as a decimal would reintroduce " +
      "the rounding this schema exists to avoid.",
    theTrap:
      "Requesting more than the balance holds and expecting the system to go negative and sort it " +
      "out later. It refuses with INSUFFICIENT_BALANCE. If Michael wants to cover the shortfall " +
      "he awards the time deliberately, which is recorded as a gift, rather than by letting a " +
      "balance drift below zero where nobody can tell earned hours from gifted ones.",
    howToBeSure:
      "The increment rule is WAC 296-128-630(4). The balance is the ledger, which is the sum of " +
      "every accrual, award, usage and lapse — never a stored running total that can drift.",
    authorityIds: ["wac-296-128-630-increment"],
  },
  {
    field: "sick_leave_requests.purpose",
    whatItIs:
      "Which of the statute's own categories the absence falls into: own health, family care, " +
      "closure of the business or a school, immigration proceedings, or domestic violence.",
    whereItIsUsed:
      "Recorded with the request. It is NOT used to approve or deny — every one of these is a " +
      "qualified purpose, so the category never changes the answer.",
    whyItMatters:
      "This list is the statute's list, copied deliberately. Its real function is to keep " +
      "DIAGNOSIS out of the system. An employee picks a category; nobody types what is wrong with " +
      "them or their child.",
    theTrap:
      "Adding a free-text 'reason' box next to this because a category feels vague. That box " +
      "becomes a medical record in a point-of-sale database, and it is a genuine liability. The " +
      "categories are deliberately coarse.",
    howToBeSure:
      "RCW 49.46.210(1)(b) and (c) define the authorised purposes, and WAC 296-128-660(1) " +
      "references them by number when describing what verification may confirm.",
    authorityIds: ["wac-296-128-660-verification", "wac-296-128-630-employee-chooses"],
  },
  {
    field: "sick_leave_requests.notice_kind",
    whatItIs:
      "Whether the need was foreseeable — a scheduled surgery — or unforeseeable — waking up ill.",
    whereItIsUsed:
      "The review, which reports whether the notice given met the standard for that kind. It does " +
      "not decide the request.",
    whyItMatters:
      "Two different notice standards apply. Foreseeable leave may require up to ten days' " +
      "advance notice; unforeseeable leave requires notice as soon as possible before the shift, " +
      "unless that is not practicable.",
    theTrap:
      "Automatically denying for short notice. THE REMEDY FOR LATE NOTICE IS NOT FORFEITURE. " +
      "Nothing in the rule says an employee who gives eight days' notice instead of ten loses the " +
      "leave. The system flags it as something to have a word about and still approves it, " +
      "because auto-denial here would manufacture unlawful denials at scale.",
    howToBeSure: "WAC 296-128-650(1)(a) for foreseeable, (1)(b) for unforeseeable.",
    authorityIds: ["wac-296-128-650-notice", "wac-296-128-650-notice-unforeseeable"],
  },
  {
    field: "sick_leave_requests.status",
    whatItIs:
      "Where the request stands: pending, approved, denied or cancelled. It starts as pending and " +
      "nothing sets that default except the database itself.",
    whereItIsUsed:
      "This is the column that implements Michael's decision that a request must be APPROVED " +
      "BEFORE it appears on a timesheet. The approval inbox lists pending; the timesheet reads " +
      "approved only.",
    whyItMatters:
      "It is the boundary between a person asking for something and payroll paying for it. If " +
      "requests flowed straight to the timesheet, an absence could be paid before anyone with " +
      "authority had looked at it, and the first time Michael saw it would be on the register.",
    theTrap:
      "Deleting a denied or cancelled request to tidy the list. The record of what was asked and " +
      "what was decided is exactly what protects Greenway in a dispute. Denied requests stay, " +
      "with their reason attached.",
    howToBeSure:
      "The employee's right to choose whether to use leave — WAC 296-128-630(1) — is why leave is " +
      "only ever deducted against a request. The ledger structurally cannot record a usage nobody " +
      "asked for.",
    authorityIds: ["wac-296-128-630-employee-chooses"],
  },
  {
    field: "sick_leave_requests.employee_note",
    whatItIs:
      "Anything the employee wants to add. Optional, and deliberately unstructured.",
    whereItIsUsed: "Shown to Michael in the approval inbox. Nothing computes from it.",
    whyItMatters:
      "Context that does not fit a category — 'I can come in at noon if that helps' — is worth " +
      "having and is nobody's medical record.",
    theTrap:
      "Requiring it. A required explanation is pressure to disclose a condition, which is the " +
      "thing the purpose categories exist to prevent. It is optional in the schema, not just on " +
      "the screen.",
    howToBeSure:
      "WAC 296-128-660(4): verification 'may not result in an unreasonable burden or expense on " +
      "the employee'. Demanded explanations sit on the same spectrum.",
    authorityIds: ["wac-296-128-660-no-burden"],
  },
  {
    field: "sick_leave_requests.requested_by_staff_id",
    whatItIs:
      "Which staff member entered the request, when somebody entered it on the employee's behalf. " +
      "NULL is the NORMAL case and means the employee entered it themselves at the time clock " +
      "using their PIN.",
    whereItIsUsed:
      "The audit trail on the request, and the answer to 'who actually typed this' when a request " +
      "is queried months later.",
    whyItMatters:
      "This is one of the few places in the schema where NULL is the expected value rather than a " +
      "gap. It matters because an employee too ill to come in may telephone at six in the " +
      "morning, and a manager entering that call is compliant notice — so the system has to " +
      "record who typed it without implying the employee failed to do something.",
    theTrap:
      "Reading NULL as missing data and 'fixing' it by backfilling a manager's id. That would " +
      "rewrite history to say a manager entered requests the employees entered themselves.",
    howToBeSure:
      "WAC 296-128-650(1)(b) contemplates notice given before the shift where practicable; " +
      "nothing requires the employee to be the one who types it.",
    authorityIds: ["wac-296-128-650-notice-unforeseeable"],
  },
  {
    field: "sick_leave_requests.requested_at",
    whatItIs:
      "The moment the employee asked — not the moment somebody typed it into the computer. Those " +
      "are usually the same and occasionally are not.",
    whereItIsUsed:
      "Compared against the leave date to measure how much notice was actually given.",
    whyItMatters:
      "Notice is a duration, and a duration needs two timestamps. This is the first one. Without " +
      "it there is no way to say whether ten days' notice was given, and no way to defend the " +
      "assertion later.",
    theTrap:
      "Using the created_at audit stamp for this. They are usually the same and occasionally are " +
      "not — a request entered on Monday for a call received on Friday has a requested_at of " +
      "Friday. Notice runs from when the employee asked, not when somebody typed it.",
    howToBeSure: "WAC 296-128-650(1)(a) — ten days, 'or as early as practicable'.",
    authorityIds: ["wac-296-128-650-notice"],
  },
  {
    field: "sick_leave_requests.decided_by_staff_id",
    whatItIs: "Who approved or denied it. Empty while the request is pending.",
    whereItIsUsed: "The audit trail, and the approval inbox once a decision is made.",
    whyItMatters:
      "A decision with no decider is not a decision anybody can stand behind. In a dispute the " +
      "first question is who authorised this, and the answer needs to be in the record rather " +
      "than in somebody's recollection.",
    theTrap:
      "Letting a decision be recorded without a decider, or a decider without a time. The " +
      "database refuses both: the constraint `sick_leave_requests_decided_together` requires the " +
      "decider and the timestamp to be present or absent together.",
    howToBeSure:
      "Read the constraint in migration 0198. It is enforced by Postgres, not by the screen, so " +
      "no future code path can bypass it.",
    authorityIds: [],
  },
  {
    field: "sick_leave_requests.decided_at",
    whatItIs:
      "When the request was approved or denied. Empty for as long as it sits pending in the inbox.",
    whereItIsUsed:
      "The audit trail, and the measure of how long an employee was left not knowing whether they " +
      "would be paid.",
    whyItMatters:
      "Paired with the decider by a database constraint. It also matters practically: a request " +
      "sitting pending for a week is a person who does not know whether they are being paid.",
    theTrap:
      "Approving retrospectively after payroll has run and assuming the timesheet will catch up. " +
      "Approval is what admits leave to the timesheet, so a late approval means a late payment, " +
      "and sick leave has a statutory payday.",
    howToBeSure: "WAC 296-128-680(1) sets the payday for the period the leave was used in.",
    authorityIds: ["wac-296-128-680-payment"],
  },
  {
    field: "sick_leave_requests.decision_note",
    whatItIs:
      "Why. Required with at least ten characters when a request is DENIED; optional on approval.",
    whereItIsUsed: "Shown with the decision, kept permanently.",
    whyItMatters:
      "A denial with no stated reason is the single worst artefact this system could produce. If " +
      "it is ever examined, the absence of a reason is what the examination is about. Ten " +
      "characters is a low bar deliberately — it stops an empty box and a full stop, not much " +
      "more.",
    theTrap:
      "Denying because the employee gave short notice, and writing that down. Late notice is not " +
      "grounds for forfeiture, so that note documents an unlawful denial in Greenway's own " +
      "handwriting. If notice is a problem, approve the leave and address the notice separately.",
    howToBeSure:
      "The constraint `sick_leave_requests_denial_has_reason` enforces the ten characters. The " +
      "substance is WAC 296-128-650, which provides no forfeiture remedy at all.",
    authorityIds: ["wac-296-128-650-notice"],
  },

  /* ── sick_leave_ledger: the balance, as history rather than a total ──── */
  {
    field: "sick_leave_ledger.entry_date",
    whatItIs:
      "The date this movement takes effect — the day leave was earned, awarded, used or lapsed. Not " +
      "the day the row was written.",
    whereItIsUsed:
      "Ordering the ledger, computing the balance as at any date, and deciding which year an " +
      "entry belongs to at carryover.",
    whyItMatters:
      "The balance is not a stored number that gets edited. It is the sum of every line up to a " +
      "date, which means it can be recomputed and audited, and cannot drift.",
    theTrap:
      "Assuming the balance today is what the balance was in March. Any question about a past " +
      "absence is answered by summing to that date, not by reading the current figure.",
    howToBeSure:
      "Sum the ledger. If a displayed balance ever disagrees with the sum of the ledger, the " +
      "ledger is right and the display is broken.",
    authorityIds: [],
  },
  {
    field: "sick_leave_ledger.entry_kind",
    whatItIs:
      "What kind of movement this is: leave earned by working, leave awarded by Michael, leave " +
      "used, or leave that lapsed at year end.",
    whereItIsUsed: "Every balance calculation, and the monthly notification to employees.",
    whyItMatters:
      "The kinds are separate because they behave differently in law. Earned leave must carry " +
      "over up to forty hours; awarded leave is a gift and may lapse. Collapsing them into 'plus' " +
      "and 'minus' would destroy the distinction the carryover rule depends on.",
    theTrap:
      "Recording an award as an accrual because both increase the balance. It does increase the " +
      "balance — and it also permanently increases the carryover Michael is obliged to honour, " +
      "which a gift was never meant to do.",
    howToBeSure: "WAC 296-128-620(4) is about accrued leave. A gift is not accrued leave.",
    authorityIds: ["wac-296-128-620-carryover"],
  },
  {
    field: "sick_leave_ledger.minutes",
    whatItIs:
      "The size of the movement, in minutes. Positive for leave earned or awarded, negative for " +
      "leave used or lapsed.",
    whereItIsUsed:
      "Summed across every row for an employee to produce their balance. There is no other " +
      "calculation, and no stored total that could disagree with it.",
    whyItMatters:
      "Signed, so the balance is a straight sum with no branching. Code that adds some rows and " +
      "subtracts others depending on their kind gets the sign wrong for one kind eventually.",
    theTrap:
      "Storing a usage as a positive number 'because it is an amount'. Then the balance grows " +
      "every time somebody is off sick.",
    howToBeSure:
      "The sum of every minutes value for an employee is their balance. There is no other " +
      "calculation and no stored total to disagree with it.",
    authorityIds: [],
  },
  {
    field: "sick_leave_ledger.request_id",
    whatItIs:
      "Which approved request this usage came from. Present on usage lines; empty on accruals, " +
      "awards and lapses, which have no request behind them.",
    whereItIsUsed:
      "Tying spent leave back to the request that authorised it, and enforcing that a request is " +
      "only ever drawn once.",
    whyItMatters:
      "This is the structural expression of the employee's right to choose. Leave can only leave " +
      "the balance against a request, so the system CANNOT record a usage nobody asked for. It is " +
      "not a policy that could be forgotten; there is no code path for it.",
    theTrap:
      "Drawing the same request twice — approving, drawing, then re-running the draw. A unique " +
      "index, `sick_leave_ledger_one_usage_per_request`, makes the second attempt fail rather " +
      "than double-charging the employee's balance. That index is keyed on the request AND the " +
      "bucket, not the request alone, because one approved day can legitimately produce two " +
      "rows when the draw runs out of earned hours and finishes in awarded ones. Keyed on the " +
      "request alone — which is how it originally shipped — the second row of an ordinary split " +
      "was rejected and the approval could not be recorded at all.",
    howToBeSure:
      "WAC 296-128-630(1): an employer 'may not require an employee to use accrued, unused paid " +
      "sick leave if the employee does not choose to request to use paid sick leave.'",
    authorityIds: ["wac-296-128-630-employee-chooses"],
  },
  {
    field: "sick_leave_ledger.drawn_from",
    whatItIs:
      "Which bucket a usage came out of: the statutory bucket of earned leave, or the awarded " +
      "bucket of leave Michael gifted.",
    whereItIsUsed:
      "The draw plan that decides which bucket a request is satisfied from, and the year-end " +
      "carryover that decides what survives into January.",
    whyItMatters:
      "THE ORDER IS DELIBERATE AND IT SAVES MICHAEL MONEY. Earned hours are spent FIRST. What " +
      "survives to December is therefore the gifted hours, which may lapse — instead of statutory " +
      "hours, which must be carried. Spend the gift first and every generous gesture would " +
      "permanently raise the carryover liability.",
    theTrap:
      "Thinking this is arbitrary bookkeeping. It is the single most valuable design decision in " +
      "the sick leave engine, and reversing it would cost real money every year while looking " +
      "identical on screen.",
    howToBeSure:
      "WAC 296-128-620(4) requires carryover of ACCRUED, unused leave. Awarded leave is not " +
      "accrued leave, so it is not subject to the requirement.",
    authorityIds: ["wac-296-128-620-carryover", "wac-296-128-620-carryover-cap"],
  },
  {
    field: "sick_leave_ledger.pay_period_id",
    whatItIs: "Which pay period this entry was paid in. Empty until it has been paid.",
    whereItIsUsed:
      "The unpaid-leave index, which is how the system finds sick leave that has been used but " +
      "not yet paid.",
    whyItMatters:
      "Sick leave has a statutory payday — the payday for the period in which it was used, unless " +
      "verification was required. An empty value here after that payday is a wage violation " +
      "waiting to be discovered, so it is indexed and findable rather than buried.",
    theTrap:
      "Letting approved leave sit unpaid because the request was decided after the run closed. " +
      "The index exists precisely to surface that; it is not a housekeeping field.",
    howToBeSure: "WAC 296-128-680(1), quoted in full in the authorities file.",
    authorityIds: ["wac-296-128-680-payment"],
  },
  {
    field: "sick_leave_ledger.paid_rate_milli_cents_per_hour",
    whatItIs:
      "The hourly rate this leave was actually paid at, in THOUSANDTHS OF A CENT per hour. " +
      "$16.28 per hour is stored as 1628000.",
    whereItIsUsed: "Pricing the leave, and proving afterwards what rate was used.",
    whyItMatters:
      "The unit exists because of the greater-of rule combined with partial hours. Pricing forty " +
      "minutes at an hourly rate means multiplying by two thirds, and doing that in whole cents " +
      "loses a fraction of a cent every time. Thousandths carry it.",
    theTrap:
      "Paying sick leave at the employee's own rate. The law says the GREATER of their normal " +
      "hourly compensation or the state minimum wage. For everyone above the floor that is the " +
      "same number, which is exactly why an engine that ignores the rule passes every test anyone " +
      "thinks to run — until somebody is hired at the minimum, or the minimum moves in January " +
      "and a rate does not move with it.",
    howToBeSure:
      "WAC 296-128-670(1): 'an employee must be paid the greater of the minimum hourly wage rate " +
      "established by RCW 49.46.020 or their normal hourly compensation.' The engine compares " +
      "both every time and refuses to price leave for a date it has no evidenced minimum wage for.",
    authorityIds: ["wac-296-128-670-rate"],
  },
  {
    field: "sick_leave_ledger.paid_amount_cents",
    whatItIs: "What was actually paid for this leave, in whole cents.",
    whereItIsUsed: "The pay run, the general ledger, and the employee's stub.",
    whyItMatters:
      "The rounding to whole cents happens once, here, at the end. Rate in thousandths, minutes " +
      "exact, one multiplication, one rounding.",
    theTrap:
      "Rounding at each step. Round the rate, round the hours, round the product, and a " +
      "forty-minute absence can be off by several cents — small, repeated, and impossible to " +
      "reconcile later because no single step looks wrong.",
    howToBeSure:
      "Recompute from `minutes` and `paid_rate_milli_cents_per_hour`. If it does not match, the " +
      "rounding rule changed.",
    authorityIds: ["wac-296-128-670-rate"],
  },
  {
    field: "sick_leave_ledger.reason",
    whatItIs:
      "Why this entry exists. Required for awards, where it records what Michael was doing and " +
      "why.",
    whereItIsUsed:
      "The ledger view, the audit trail, and any later question about why a balance went up " +
      "without anybody working the hours.",
    whyItMatters:
      "An award is an unexplained increase in a liability unless somebody says what it was for. " +
      "'Covered Angela's first week before her ninety days' is the difference between a " +
      "deliberate kindness and an anomaly.",
    theTrap:
      "Awarding leave with no reason to work around a refusal. The refusal AWARD_WITHOUT_REASON " +
      "exists to stop that, because an award used as an override with no note is indistinguishable " +
      "from an error.",
    howToBeSure:
      "Awards are permitted because WAC 296-128-620(1) allows an employer to be more generous. " +
      "The reason is what proves it was generosity rather than a mistake.",
    authorityIds: ["wac-296-128-620-accrual"],
  },
  {
    field: "sick_leave_ledger.created_by_staff_id",
    whatItIs: "Who created this ledger entry. Empty for entries the system generated itself.",
    whereItIsUsed:
      "The audit trail. Read alongside the entry kind, it separates what the system did on " +
      "schedule from what a person chose to do.",
    whyItMatters:
      "Accruals are automatic and have no author. Awards and adjustments have one, and should. " +
      "Empty here means the machine did it on schedule, which is a meaningful answer rather than " +
      "a missing one.",
    theTrap:
      "Treating every empty value as a data quality problem. In this column and in " +
      "`requested_by_staff_id`, empty carries information.",
    howToBeSure:
      "Cross-reference the entry kind. An accrual with an author, or an award without one, is the " +
      "combination worth asking about.",
    authorityIds: [],
  },
];

export function taughtSickLeaveFieldNames(): readonly string[] {
  return SICK_LEAVE_FIELD_LESSONS.map((l) => l.field);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SCREEN LESSONS - the ideas, not the fields
 * ═══════════════════════════════════════════════════════════════════════════ */

export type ScreenLesson = {
  readonly topic: string;
  readonly plainEnglish: string;
  readonly whyItMatters: string;
  readonly authorityIds: readonly string[];
};

export const SICK_LEAVE_SCREEN_LESSONS: readonly ScreenLesson[] = [
  {
    topic:
      "Why every mistake in this area looks fine: sick leave errors do not fail, they accumulate",
    plainEnglish:
      "Nothing in sick leave crashes. Accrue slightly too little and the balance still looks " +
      "plausible. Pay at the wrong rate and the cheque still clears. Count sick hours toward " +
      "overtime and the employee is delighted. Every error here produces a number a reasonable " +
      "person would accept, which is why these particular rules are worth knowing rather than " +
      "trusting.",
    whyItMatters:
      "The consequence arrives as an L&I finding covering every affected employee for the whole " +
      "look-back period, with interest, long after the person who set the policy has forgotten " +
      "setting it. That is why the engine refuses unlawful settings at the point they are typed " +
      "instead of accepting them and computing quietly.",
    authorityIds: ["wac-296-128-620-accrual", "wac-296-128-670-rate"],
  },
  {
    topic: "Your own question, answered: sick time does not create overtime",
    plainEnglish:
      "You worked it out yourself and you were right. Thirty-six hours worked plus eight hours of " +
      "sick leave is forty-four PAID hours and ZERO overtime, because overtime is owed on hours " +
      "actually WORKED, and paid leave is not work.",
    whyItMatters:
      "The regulation says two things here and payroll systems routinely get the first right and " +
      "the second wrong. Sick pay is excluded from the regular rate — most systems handle that. " +
      "And 'no part of such payments may be credited toward overtime compensation due under the " +
      "Act' — that is the half that answers your question, and both halves are implemented here " +
      "with a mutation test proving the suite notices if either breaks.",
    authorityIds: ["cfr-778-218-idle-hours", "cfr-778-102-hours-worked"],
  },
  {
    topic: "Two buckets, and why spending the earned one first is worth real money",
    plainEnglish:
      "Leave employees EARN by working and leave you AWARD as a gift are held separately, and " +
      "when somebody takes leave the earned hours are spent first.",
    whyItMatters:
      "Up to forty hours of unused EARNED leave must carry into next year, and next year's " +
      "accrual stacks on top of it. Gifted leave carries no such obligation. Spend earned hours " +
      "first and what survives to December is the gift, which can lapse. Spend the gift first and " +
      "every generous gesture you ever make permanently raises the carryover you are legally " +
      "required to honour. Same kindness, same cost this year, very different cost forever.",
    authorityIds: ["wac-296-128-620-carryover", "wac-296-128-620-carryover-cap"],
  },
  {
    topic: "The greater of — three words that only matter on the day they matter",
    plainEnglish:
      "Sick leave is paid at the GREATER of the state minimum wage or the employee's own hourly " +
      "rate. Not their rate. The greater of the two.",
    whyItMatters:
      "For everyone at Greenway earning above the floor, both answers are identical, so an engine " +
      "that ignored this rule would pass every test anyone thought to run. It bites on exactly " +
      "two occasions: when somebody is hired at the minimum, and every January when the state " +
      "minimum rises and an individual's rate does not. The engine compares both every single " +
      "time, and refuses to price sick leave at all for a date with no evidenced minimum wage.",
    authorityIds: ["wac-296-128-670-rate"],
  },
  {
    topic: "Approval comes first, and that was your decision",
    plainEnglish:
      "You chose option 1: a request must be approved before it reaches the timesheet. A request " +
      "starts as pending, appears in your inbox under Accounting, and only becomes hours on a " +
      "timesheet once you have approved it.",
    whyItMatters:
      "The alternative was for requests to post straight to the timesheet with a right of " +
      "correction afterwards. That is faster and it means the first time you see an absence is on " +
      "the payroll register, after the money has moved. With approval first, nothing is paid that " +
      "you have not seen — and because approval is what admits leave to the timesheet, a request " +
      "left pending is a person waiting on an answer, which is why pending requests are indexed " +
      "and surfaced rather than buried in a list.",
    authorityIds: ["wac-296-128-630-employee-chooses"],
  },
  {
    topic: "The one obligation almost every small employer misses",
    plainEnglish:
      "At least monthly, in writing, every employee must be told how much sick leave they " +
      "accrued, how much was deducted since last time, and how much they have available. Not on " +
      "request — automatically.",
    whyItMatters:
      "Most small employers have never heard of this and are in breach every month without " +
      "knowing. The regulation also gives the easy way out in its own last sentence: putting the " +
      "figures on the regular payroll statement satisfies it. So the system builds the sentence " +
      "from the ledger and puts it on the stub, rather than relying on anybody remembering to " +
      "send something.",
    authorityIds: ["wac-296-128-755-notification"],
  },
  {
    topic: "Late notice is not forfeiture, and denying for it manufactures a violation",
    plainEnglish:
      "You may require ten days' notice for something foreseeable and notice before the shift for " +
      "something unforeseeable. What you may NOT do is take the leave away because the notice was " +
      "late.",
    whyItMatters:
      "Nothing in the rule provides forfeiture as a remedy. A system that auto-denied on short " +
      "notice would generate unlawful denials at scale, each one documented in Greenway's own " +
      "records with a reason attached. So the review flags short notice as a conversation to have " +
      "and approves the request anyway.",
    authorityIds: ["wac-296-128-650-notice", "wac-296-128-650-notice-unforeseeable"],
  },
  {
    topic: "Verification: the fourth day, a written policy first, and who pays for the note",
    plainEnglish:
      "You may ask for proof only for absences EXCEEDING three days — so the fourth day at the " +
      "earliest. You must have a written policy on file before asking anyone. And the request may " +
      "not put an unreasonable burden or expense on the employee.",
    whyItMatters:
      "Three separate conditions, and employers usually satisfy none of them. 'Exceeding three " +
      "days' is an off-by-one trap that reads as 'three or more' to almost everybody. The written " +
      "policy must exist BEFORE the first request, not be written when a question arises. And an " +
      "hourly employee paying a clinic to prove they were ill is the textbook unreasonable " +
      "burden, which in practice can mean Greenway pays for the visit.",
    authorityIds: ["wac-296-128-660-verification", "wac-296-128-660-no-burden"],
  },
  {
    topic: "Why leave never accrues on leave",
    plainEnglish:
      "Sick leave is earned on hours WORKED. A week containing eight hours of sick leave accrues " +
      "on the worked hours only, not on the paid total.",
    whyItMatters:
      "The intuitive implementation — accrue on every paid hour — is wrong in the employee's " +
      "favour, and generous errors are the ones that survive longest, because they are nobody's " +
      "complaint until the year they are found. The engine subtracts leave hours before it " +
      "multiplies, inside one named function, so it cannot be remembered at one call site and " +
      "forgotten at another.",
    authorityIds: ["wac-296-128-620-hours-worked-only"],
  },
  {
    topic: "Balances are history, not a number somebody edits",
    plainEnglish:
      "There is no stored balance anywhere in this system. When a screen shows you that Angela has " +
      "22.50 hours available, that number was added up the instant you asked for it, by summing " +
      "every accrual, award, usage and lapse row in her ledger dated on or before the date you " +
      "asked about. Change the date and the same rows produce a different, equally correct answer.",
    whyItMatters:
      "A stored running total drifts, and once it has drifted nobody can say when or why. Summing " +
      "history means the balance as at any past date is recoverable, every movement has a reason " +
      "attached, and a displayed figure that disagrees with the ledger is a display bug rather " +
      "than a money problem.",
    authorityIds: ["wac-296-128-755-notification"],
  },
  {
    topic: "Nobody's diagnosis belongs in this system",
    plainEnglish:
      "An employee picks one of the statute's own categories — own health, family care, closure, " +
      "immigration, domestic violence. Nobody types what is wrong with them.",
    whyItMatters:
      "The categories come straight from the law and are deliberately coarse. The instinct to add " +
      "a 'reason' box because a category feels vague would turn a point-of-sale database into a " +
      "medical record, which is a real liability and buys nothing: the category never changes the " +
      "answer, because every one of them is a qualified purpose.",
    authorityIds: ["wac-296-128-630-employee-chooses", "wac-296-128-660-no-burden"],
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * REFUSAL LESSONS - every code the engine can emit
 * ═══════════════════════════════════════════════════════════════════════════ */

export type RefusalLesson = {
  readonly code: SickLeaveRefusalCode;
  /** One line, for a banner. */
  readonly headline: string;
  /** Why refusing beats computing anyway. */
  readonly whyWeStop: string;
  /** What Michael actually does about it. */
  readonly whatToDo: string;
};

/**
 * Every refusal the engine can emit, explained.
 *
 * The gate parses the engine's own union type FROM DISK and fails if a code
 * ships untaught — or if a lesson outlives the code it explains, which is the
 * more dangerous direction because the count still looks right.
 */
export const SICK_LEAVE_REFUSAL_LESSONS: readonly RefusalLesson[] = [
  {
    code: "NO_ACCRUAL_RATE_ON_FILE",
    headline: "Nobody has said how fast sick leave is earned here.",
    whyWeStop:
      "The obvious fallback is to assume the statutory minimum. That would be a guess dressed as " +
      "a policy, and it would be indistinguishable on screen from a rate you actually chose.",
    whatToDo:
      "Open the sick leave policy and set the accrual rate. The statutory floor is one hour per " +
      "forty worked; you may be more generous, and if you intend to be, this is where it is " +
      "recorded.",
  },
  {
    code: "ACCRUAL_RATE_BELOW_STATUTORY_FLOOR",
    headline: "That accrual rate is below the legal minimum, so it cannot be saved.",
    whyWeStop:
      "Saving it would underpay every employee, every period, invisibly. There is no version of " +
      "this that is a preference — it is simply not lawful.",
    whatToDo:
      "Set it to at least 150 hundredth-minutes per hour worked, which is one hour of leave per " +
      "forty hours worked. Check the unit before assuming the number is wrong.",
  },
  {
    code: "NO_CARRYOVER_CAP_ON_FILE",
    headline: "Nobody has said how much unused leave carries into next year.",
    whyWeStop:
      "Blank might mean 'forty hours' or 'no limit', and those produce different balances every " +
      "January. Choosing one for you would put a number on employees' records that nobody decided.",
    whatToDo:
      "Set the cap. Forty hours is the lowest you may set. If you do not want to cap it at all, " +
      "record that explicitly rather than leaving it empty.",
  },
  {
    code: "CARRYOVER_CAP_BELOW_STATUTORY_FLOOR",
    headline: "A carryover cap below forty hours is not lawful.",
    whyWeStop:
      "Forty hours of accrued unused leave must be allowed to carry over. A lower cap would " +
      "destroy hours employees are entitled to keep, and it would do it silently at year end.",
    whatToDo: "Set the cap to at least 2400 minutes, or higher if you choose to be more generous.",
  },
  {
    code: "NO_USABLE_AFTER_ANSWER",
    headline: "Nobody has said how long a new hire waits before spending sick leave.",
    whyWeStop:
      "This decides whether a specific person can be paid for a specific day. Guessing ninety " +
      "days because that is the legal maximum would impose the harshest lawful answer on Michael's " +
      "behalf.",
    whatToDo:
      "Set the waiting period between 0 and 90 days. Zero is lawful and generous; ninety is the " +
      "most you may require.",
  },
  {
    code: "NO_USAGE_INCREMENT_ON_FILE",
    headline: "Nobody has said what the smallest slice of sick leave is.",
    whyWeStop:
      "Without it there is no way to tell a valid request from an invalid one, so every request " +
      "would be accepted, including ones your payroll practices cannot actually handle.",
    whatToDo:
      "Set the increment, between 1 and 60 minutes. Most employers use 15 or 30; the law caps it " +
      "at 60.",
  },
  {
    code: "USAGE_INCREMENT_ABOVE_ONE_HOUR",
    headline: "You cannot require sick leave to be taken in blocks bigger than an hour.",
    whyWeStop:
      "An increment above one hour forces employees to spend more leave than they need, which is " +
      "unlawful without a variance from L&I.",
    whatToDo:
      "Set it to 60 minutes or less. If Greenway ever obtains a variance under WAC 296-128-640, " +
      "that is a deliberate code change and a conversation, not a setting.",
  },
  {
    code: "VERIFICATION_THRESHOLD_UNLAWFUL",
    headline: "You may only ask for a doctor's note after more than three days.",
    whyWeStop:
      "The rule says 'exceeding three days', so the earliest lawful threshold is the fourth day. " +
      "A threshold of three is the off-by-one almost everybody makes, and it would authorise an " +
      "unlawful request every time it fired.",
    whatToDo: "Set the verification threshold to 4 days or more.",
  },
  {
    code: "VERIFICATION_POLICY_UNANSWERED",
    headline: "Nobody has said whether Greenway actually requires verification.",
    whyWeStop:
      "This changes the statutory PAYDAY for sick leave, not just whether you may ask for a note. " +
      "Assuming an answer would set a legal deadline nobody chose.",
    whatToDo:
      "Answer yes or no on the policy screen. If yes, the written policy must be on file before " +
      "anyone is asked for anything.",
  },
  {
    code: "NOT_YET_USABLE",
    headline: "This employee has earned the leave but cannot spend it yet.",
    whyWeStop:
      "They are inside the waiting period. Note the wording: the hours exist and are banked. " +
      "Showing a zero balance instead would tell them they had earned nothing, which is untrue.",
    whatToDo:
      "If you want to cover them anyway — and for a new hire who is genuinely ill, you usually " +
      "will — award the time. That records it as a deliberate gift, keeps it out of the statutory " +
      "carryover, and leaves a reason on the record.",
  },
  {
    code: "REQUEST_DATES_BACKWARD",
    headline: "The dates on this request do not make sense.",
    whyWeStop:
      "A request whose end precedes its start cannot be priced or counted. Repairing it by " +
      "swapping the dates would be inventing an intention.",
    whatToDo: "Check the dates and re-enter. Usually a typo in the year or a transposed month.",
  },
  {
    code: "REQUEST_NOT_A_POSITIVE_AMOUNT",
    headline: "A request for zero minutes, or a negative number, is not a request.",
    whyWeStop:
      "Zero would create a ledger entry that moves nothing and clutters the audit trail; a " +
      "negative would quietly ADD leave through the usage path, bypassing awards entirely.",
    whatToDo:
      "Enter the actual minutes. If you meant to give someone leave, use an award, which records " +
      "a reason.",
  },
  {
    code: "REQUEST_NOT_IN_INCREMENT",
    headline: "That amount is not a whole number of your smallest allowed slice.",
    whyWeStop:
      "Rounding it silently would either overcharge the employee's balance or undercharge it, " +
      "and either way the figure on screen would not be the figure requested.",
    whatToDo:
      "Round the request to your increment, or reduce the increment if your policy is finer than " +
      "you recorded.",
  },
  {
    code: "INSUFFICIENT_BALANCE",
    headline: "There is not enough leave in the balance to cover this request.",
    whyWeStop:
      "Going negative would make it impossible to tell earned hours from gifted ones or from an " +
      "overdraft, and the carryover calculation depends on that distinction.",
    whatToDo:
      "Approve what the balance covers and treat the rest as unpaid, or award the shortfall " +
      "deliberately with a reason. Both are lawful; a silent negative balance is not a third " +
      "option.",
  },
  {
    code: "AWARD_NOT_POSITIVE",
    headline: "An award of zero or less is not an award.",
    whyWeStop:
      "A negative award would remove leave through the gift path, with none of the checks a " +
      "usage goes through and no request behind it.",
    whatToDo:
      "Enter a positive number of minutes. To remove leave, use the ordinary usage path, which " +
      "requires an approved request.",
  },
  {
    code: "AWARD_WITHOUT_REASON",
    headline: "An award needs a reason.",
    whyWeStop:
      "An unexplained increase in a leave liability is indistinguishable from a mistake, both to " +
      "an auditor and to you in two years. The reason is what makes it evidence of generosity.",
    whatToDo:
      "Say what it was for. 'Covered Angela's first week before her ninety days' is enough.",
  },
  {
    code: "NO_MINIMUM_WAGE_FOR_DATE",
    headline: "There is no minimum wage on file for that date, so sick leave cannot be priced.",
    whyWeStop:
      "Sick leave is paid at the greater of the minimum wage or the employee's own rate. Without " +
      "the minimum, only half the comparison can be made — and carrying last year's figure " +
      "forward is exactly the mistake this refusal exists to prevent, because the state minimum " +
      "changes every January.",
    whatToDo:
      "Enter the Washington minimum wage for that year. L&I announces the next year's figure " +
      "around the end of September.",
  },
  {
    code: "NO_NORMAL_HOURLY_RATE",
    headline: "This employee has no hourly rate on file, so their sick leave cannot be priced.",
    whyWeStop:
      "The other half of the greater-of comparison is missing. Defaulting to the minimum wage " +
      "would underpay anybody who earns more, and would look entirely correct on the stub.",
    whatToDo:
      "Set the employee's pay rate. For a salaried employee this is the hourly equivalent, which " +
      "the pay setup screen calculates.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * WHAT TO CHECK BEFORE APPROVING
 * ═══════════════════════════════════════════════════════════════════════════ */

export type SickLeaveReviewCheckKey =
  | "balance-covers-it"
  | "usable-yet"
  | "increment-matches"
  | "verification-entitlement"
  | "notice-is-a-conversation"
  | "rate-is-the-greater-of";

export type SickLeaveReviewCheck = {
  readonly key: SickLeaveReviewCheckKey;
  readonly order: number;
  readonly question: string;
  readonly whyThisOrder: string;
  readonly howToCheck: string;
  readonly ifItFails: string;
  readonly authorityIds: readonly string[];
};

/**
 * The order matters and is asserted by the gate.
 *
 * Eligibility questions come before pricing questions, because there is no
 * point discovering the correct rate for leave the employee is not yet
 * entitled to spend.
 */
export const SICK_LEAVE_REVIEW_CHECKS: readonly SickLeaveReviewCheck[] = [
  {
    key: "usable-yet",
    order: 1,
    question: "Is this employee past their waiting period?",
    whyThisOrder:
      "First, because if they are not, every other question is premature. It is also the one " +
      "with a humane answer available: you can award the time.",
    howToCheck:
      "The review states it outright. It compares the hire date with the leave date against the " +
      "waiting period in the policy.",
    ifItFails:
      "The leave is banked but not yet spendable. Award the time if you want to cover them; " +
      "otherwise the day is unpaid and the balance is untouched.",
    authorityIds: ["wac-296-128-630-usable"],
  },
  {
    key: "balance-covers-it",
    order: 2,
    question: "Is there enough leave in the balance?",
    whyThisOrder:
      "Second, because it determines whether this is a straightforward approval or a decision " +
      "about covering a shortfall.",
    howToCheck:
      "The review shows the balance as at the leave date — not today's balance, which may include " +
      "accruals that had not happened yet.",
    ifItFails:
      "Approve what is covered and leave the rest unpaid, or award the difference with a reason. " +
      "The system will not let the balance go negative.",
    authorityIds: ["wac-296-128-620-carryover"],
  },
  {
    key: "increment-matches",
    order: 3,
    question: "Is the amount a whole number of your smallest allowed slice?",
    whyThisOrder:
      "Third, because it is mechanical and cheap to fix, and fixing it changes the amount that " +
      "the later questions price.",
    howToCheck: "The request screen refuses a non-multiple before it ever reaches you.",
    ifItFails: "Round the request, or reduce your increment if your practice is finer.",
    authorityIds: ["wac-296-128-630-increment"],
  },
  {
    key: "verification-entitlement",
    order: 4,
    question: "Is this absence long enough that you may ask for a note?",
    whyThisOrder:
      "Fourth, because it depends on how many consecutive days were approved, which is not known " +
      "until the days above are settled.",
    howToCheck:
      "Count consecutive days of absence, not the number of request rows. More than three means " +
      "you may ask — if a written policy is already on file.",
    ifItFails:
      "You may not ask. Asking anyway is unlawful even if the employee cheerfully complies, and " +
      "the request itself becomes the evidence.",
    authorityIds: ["wac-296-128-660-verification", "wac-296-128-660-no-burden"],
  },
  {
    key: "notice-is-a-conversation",
    order: 5,
    question: "Was the notice adequate — and does that change anything?",
    whyThisOrder:
      "Fifth, and deliberately after the decision-shaped questions, because the answer never " +
      "changes the decision.",
    howToCheck: "The review reports the notice given against the standard for that kind of leave.",
    ifItFails:
      "Have a conversation. Do NOT deny the request, and above all do not write short notice down " +
      "as the reason for a denial — nothing in the rule makes late notice a forfeiture, so that " +
      "note would document an unlawful denial in your own records.",
    authorityIds: ["wac-296-128-650-notice", "wac-296-128-650-notice-unforeseeable"],
  },
  {
    key: "rate-is-the-greater-of",
    order: 6,
    question: "Is it being paid at the greater of minimum wage or their own rate?",
    whyThisOrder:
      "Last, because it is the only question here about money rather than entitlement, and it " +
      "applies once the leave is approved.",
    howToCheck:
      "The engine does the comparison every time and refuses to price leave for a date with no " +
      "evidenced minimum wage. You are checking that the minimum wage on file for the year is " +
      "right.",
    ifItFails:
      "Enter the correct Washington minimum wage for that year. This is the check that costs " +
      "nothing for years and then matters the January somebody's rate sits at the old floor.",
    authorityIds: ["wac-296-128-670-rate"],
  },
];
