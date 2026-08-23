/**
 * src/lib/payroll/wage-order-watch-mentor.ts   (books-40c - "the watchman")
 *
 * THE TEACHING FOR THE DEADLINE WATCHMAN.
 *
 * WHY THIS EXISTS, VERBATIM (standing rule 1)
 *
 *   "I am not sure the best way to be notified about ending garnishments or
 *    for filing the 20 day notice, etc. I want everything to be built
 *    enterprise grade... I need your expert knowledge to properly build this
 *    the way a top of the line payroll solution would have."
 *
 * The mechanism that answers that question is `wage-order-watch-core.ts` and
 * the fourth planner in `compliance-reminders.ts`. This file is the part that
 * makes the mechanism understandable: what each alert means, why it escalates
 * the way it does, what actually happens if it is ignored, and - the part
 * people skip - how to make it stop honestly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY DATA HERE AND GATES NEXT DOOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `GarnishmentWorkbench.tsx` and `WageOrderAnswerControl.tsx` are `"use client"`
 * files and they import this module for its sentences. A coverage gate calls
 * `readFileSync`. Putting both in one file is what once killed several Vercel
 * deployments with `request: node:fs`, with a fully green test suite the whole
 * time. So: DATA here, GATES in `wage-order-watch-mentor-gates.ts`, gates
 * imported only by tests. Same split as the lifecycle mentor next to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING IN THIS FILE DECIDES ANYTHING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Not one threshold is written here as a number. The rungs of the escalation
 * ladder are described by importing the constants the watchman actually uses,
 * so the sentence Michael reads and the day the email arrives cannot drift
 * apart. If somebody changes `ANSWER_WARNING_DAYS` from five to seven, this
 * teaching changes with it in the same commit, without anybody remembering to.
 */

import {
  ANSWER_CRITICAL_DAYS,
  ANSWER_INFO_DAYS,
  ANSWER_WARNING_DAYS,
  CREDITOR_DIARY_PROMPT_DAYS,
  EXPIRY_CRITICAL_DAYS,
  EXPIRY_WARNING_DAYS,
  type WageOrderAlertKind,
} from "./wage-order-watch-core";
import { CREDITOR_LIEN_DAYS, SUPPORT_ANSWER_DAYS } from "./wage-order-entry-core";
import type { AnswerRecordRefusalCode } from "./wage-order-lifecycle-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  THE AUTHORITIES THIS SCREEN LEANS ON
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The four texts that decide everything the watchman does.
 *
 * A SHORT LIST ON PURPOSE. Michael asked not to "get lost in the guidance
 * helpers", and all nine entry authorities on one panel is a wall nobody
 * reads, which is the same as no mentoring at all. These four are the ones
 * that set the deadline, set the penalty for missing it, refuse to invent a
 * creditor deadline, and end a creditor lien.
 *
 * Resolved against `WAGE_ORDER_ENTRY_AUTHORITIES` by
 * `watchAuthorityIdsResolve()` in the gates module, so a typo here cannot
 * silently render a blank card.
 */
export const WATCH_AUTHORITY_IDS = [
  "wage-order-rcw-26-18-110-answer",
  "wage-order-rcw-26-18-110-liability",
  "wage-order-rcw-6-27-200-default",
  "wage-order-rcw-6-27-350-sixty-days",
] as const;

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  WHAT EACH ALERT MEANS
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WatchAlertLesson = {
  readonly kind: WageOrderAlertKind;
  /** What the machine is actually telling you, in one sentence. */
  readonly whatItMeans: string;
  /** The next physical action. Never "review" - always something you can do. */
  readonly whatToDo: string;
  /** Why this one is not just paperwork. */
  readonly ifIgnored: string;
};

/**
 * One lesson per alert kind, and the gate proves the set is complete.
 *
 * `everyAlertKindTaught()` compares these keys against
 * `ALL_WAGE_ORDER_ALERT_KINDS` in the core. Adding a seventh alert kind
 * without teaching it fails the build - which is standing rule 26 applied to
 * notifications rather than to form fields: if Michael can see it, it is
 * explained.
 */
export const WATCH_ALERT_LESSONS: readonly WatchAlertLesson[] = [
  {
    kind: "answer_due_soon",
    whatItMeans:
      "A support order was served on Greenway, the sworn answer has not been recorded yet, and " +
      "the deadline is getting close. This is the early, quiet warning - there is still plenty " +
      "of time.",
    whatToDo:
      "Complete the answer that came with the order and send it to the address on the paperwork. " +
      "Then come back to this order and record the date you sent it, which is what stops these " +
      "messages.",
    ifIgnored:
      "Nothing yet. This one exists so the deadline never arrives as a surprise. It will get " +
      "louder on its own, and then it will stop being quiet altogether.",
  },
  {
    kind: "answer_due_today",
    whatItMeans:
      "Today is the last day. The answer for this support order is due now, and nothing has been " +
      "recorded against it.",
    whatToDo:
      "Send the answer today, by a method that produces a receipt - certified mail, fax " +
      "confirmation, or the registry's portal. Keep the receipt. Then record the date here.",
    ifIgnored:
      "From tomorrow this order is in default territory. The liability under RCW 26.18.110(6)(b) " +
      "is not a fine or a percentage - it is the ENTIRE support debt, plus costs, interest and " +
      "the other side's attorney fees.",
  },
  {
    kind: "answer_overdue",
    whatItMeans:
      "The answer deadline for this support order has passed and no answer has been recorded. " +
      "This message repeats every single day until something is recorded, and that is deliberate.",
    whatToDo:
      "Send the answer today anyway - late is enormously better than never, because it caps the " +
      "argument at lateness rather than at absence. Then telephone the issuing registry, tell " +
      "them it is going out, and write down who you spoke to. Record the filing date here. If " +
      "any money has already been withheld under this order, say so in the answer.",
    ifIgnored:
      "A court may enter judgment against Greenway for one hundred percent of the support debt " +
      "under RCW 26.18.110(6)(b). Withholding every cent correctly does not cure a missing " +
      "answer - they are two separate duties, and this is the one that is missed.",
  },
  {
    kind: "answer_deadline_unknown",
    whatItMeans:
      "This system cannot work out when the answer is due. Either the service date was never " +
      "recorded, or this is a creditor writ, where the deadline is printed on the paper and " +
      "varies. The clock is running in the real world regardless.",
    whatToDo:
      "For a missing service date: find the delivery receipt or the envelope, read the date " +
      "Greenway actually received it - not the date the court signed it - and record it on the " +
      "order. For a creditor writ: take the writ out and read the return date off it, put that " +
      "date in your calendar today, then answer it and record the answer here.",
    ifIgnored:
      "This is the most dangerous alert on the list precisely because it is the quietest. Every " +
      "other message counts down. This one cannot count, so no deadline will ever arrive - the " +
      "system will simply never mention it again, and a default judgment for somebody else's " +
      "whole debt is available the day after a deadline nobody measured.",
  },
  {
    kind: "lien_expiring",
    whatItMeans:
      "A creditor writ is coming up on the end of its life. A writ of garnishment is not " +
      "permanent - it runs out.",
    whatToDo:
      "Work out the last payroll period that ends on or before the expiry date, withhold through " +
      "that period, and then end the order here with the reason written down. Do not simply stop " +
      "and leave it sitting active.",
    ifIgnored:
      "You keep taking money out of an employee's pay under an authority that no longer exists. " +
      "That is not a paperwork error - RCW 49.52.050 makes wilful deprivation of wages a crime " +
      "that reaches officers personally, and RCW 49.52.070 makes it twice the amount taken.",
  },
  {
    kind: "lien_expired",
    whatItMeans:
      "A creditor writ has passed its sixty-day life and it is still recorded as live here.",
    whatToDo:
      "Stop withholding under it immediately. Check what came out after the expiry date - if " +
      "anything did, it has to go back to the employee, not to the creditor. Then end the order " +
      "here with the reason and the date.",
    ifIgnored:
      "Every additional pay run takes money with no legal authority behind it, and the exposure " +
      "compounds with each one. This is the single clearest way an employer turns somebody " +
      "else's debt problem into its own.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE LADDER, EXPLAINED
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WatchLadderRung = {
  readonly when: string;
  readonly what: string;
  readonly why: string;
};

/**
 * Why the reminders escalate instead of arriving all at once.
 *
 * Michael asked how he should be notified. The honest answer is that HOW
 * matters less than HOW OFTEN: a system that emails about everything every day
 * gets filtered into a folder within a fortnight, and a filtered alarm is worse
 * than no alarm because it feels like coverage. So the volume is tied to the
 * consequence, and this table says so out loud.
 *
 * Every number in it is interpolated from the constants the watchman uses. None
 * is typed.
 */
export const WATCH_LADDER: readonly WatchLadderRung[] = [
  {
    when: `Days 1 to ${SUPPORT_ANSWER_DAYS - ANSWER_INFO_DAYS} after service`,
    what: "Silence.",
    why:
      "There is nothing useful to say yet, and saying it anyway is how the later messages get " +
      "ignored. The deadline is visible on the order the whole time if you go looking.",
  },
  {
    when: `${ANSWER_INFO_DAYS} days before the deadline`,
    what: "One note, by email. Low key.",
    why:
      "Enough time to find the paperwork, complete it and post it without rearranging the week. " +
      "This is the message that should be doing all the work.",
  },
  {
    when: `${ANSWER_WARNING_DAYS} days before`,
    what: "A warning.",
    why:
      "Still comfortable, but this is the point where it stops being something for next week. " +
      "One message per rung - it does not repeat daily at this level.",
  },
  {
    when: `${ANSWER_CRITICAL_DAYS} days before, and on the day`,
    what: "Critical, every day, email and push.",
    why:
      "The remaining time is now measured in postal collections. This is the level where " +
      "interrupting your day is cheaper than what it is protecting against.",
  },
  {
    when: "Every day after the deadline, indefinitely",
    what: "Critical, every day, and it never stops on its own.",
    why:
      "Because the liability does not stop on its own. RCW 26.18.110(6)(b) exposure is the whole " +
      "support debt, it does not expire, and late filing still helps. A reminder that gave up " +
      "after a week would go quiet exactly when the problem was at its worst.",
  },
  {
    when: `${CREDITOR_DIARY_PROMPT_DAYS} days after a creditor writ is entered`,
    what: "One prompt: read the writ and diary the date.",
    why:
      `A creditor writ's deadline is "the time prescribed in the writ" under RCW 6.27.200, and ` +
      "it is not always twenty days. This system will not invent that date, so it asks you to " +
      "read it off the paper once, early, while the envelope is still on the desk.",
  },
  {
    when: `${EXPIRY_WARNING_DAYS} days, then ${EXPIRY_CRITICAL_DAYS} days before a creditor writ expires`,
    what: "A warning, then critical.",
    why:
      `A writ dies at ${CREDITOR_LIEN_DAYS} days and continuing to withhold past that is taking ` +
      "wages with no authority. This is the only alert on the list about STOPPING rather than " +
      "starting, and it is the one nobody expects.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  THE CHECKLIST
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WatchCheck = {
  readonly key: string;
  readonly order: number;
  readonly question: string;
  readonly whyThisOrder: string;
  readonly ifItFails: string;
};

/**
 * "I want check lists and blockers if things are right."
 *
 * Four questions, in the order they have to be asked. The order is the lesson:
 * asking "have I answered it?" before "when was it served?" produces a
 * confident answer to the wrong question.
 */
export const WATCH_CHECKS: readonly WatchCheck[] = [
  {
    key: "served-date",
    order: 1,
    question: "What date was this order actually served on Greenway?",
    whyThisOrder:
      "First, because every deadline on the page is measured from it. Not the date the court " +
      "signed the order, not the date it was mailed, not the date you opened it - the date it " +
      "was delivered here. Those can be a fortnight apart.",
    ifItFails:
      "Look for the certified mail card, the process server's affidavit, or the date stamp on " +
      "the envelope. If none of them exists, use the earliest date you can prove Greenway had " +
      "it, and note in the record why that date was chosen. Never leave it blank to be safe - " +
      "blank is the one state where nothing will ever warn you.",
  },
  {
    key: "which-clock",
    order: 2,
    question: "Is this a support order or a creditor writ?",
    whyThisOrder:
      "Second, because it decides which clock applies. A support order is twenty days from " +
      "service, fixed by statute. A creditor writ is whatever the writ says, and this system " +
      "will not guess it.",
    ifItFails:
      "Read the issuing authority at the top. Chapter 26.18 RCW, the Division of Child Support, " +
      "or a family court means support. Chapter 6.27 RCW with a company as plaintiff means a " +
      "creditor writ. If you genuinely cannot tell, treat it as support and answer within twenty " +
      "days - being early on a creditor writ costs nothing.",
  },
  {
    key: "answer-sent",
    order: 3,
    question: "Has the sworn answer physically left the building, and can you prove it?",
    whyThisOrder:
      "Third, because withholding correctly is not the same duty as answering, and this is the " +
      "one that gets missed. People remember to take the money out. The affidavit sits in a pile.",
    ifItFails:
      "Send it today by something that generates a receipt, and keep the receipt with the order. " +
      "The date recorded in this system is a record of what you did - it is not evidence that " +
      "you did it. The certified mail card is the evidence.",
  },
  {
    key: "recorded-here",
    order: 4,
    question: "Have you recorded the filing date here, so the reminders stop?",
    whyThisOrder:
      "Last, because it is the only step that is purely administrative - and because doing it " +
      "before the answer is genuinely sent would switch off the alarm for a job that is not " +
      "done. That is the failure this whole feature exists to prevent.",
    ifItFails:
      "If the reminders are still arriving, nothing was recorded. Open the order, use Record the " +
      "answer, and enter the date it went. If the system refuses the date, read the refusal - it " +
      "names the exact problem and it is usually that one of two dates is wrong.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  WORKED EXAMPLES
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WatchWorkedExample = {
  readonly key: string;
  readonly situation: string;
  readonly rightAnswer: string;
  readonly whatToType: string;
  readonly theTrap: string;
};

/**
 * Michael asks for worked examples by name, in nearly every slice, and they are
 * the part people actually read. Three, including the one where the right
 * answer is the uncomfortable one.
 */
export const WATCH_WORKED_EXAMPLES: readonly WatchWorkedExample[] = [
  {
    key: "answered-on-time",
    situation:
      "A child support order was served on 4 January. You completed the employer answer and put " +
      "it in certified mail on 18 January. The receipt is stapled to the order in the payroll " +
      "binder. Reminders have been arriving since the 14th.",
    rightAnswer: "Record the answer, filed 2027-01-18.",
    whatToType:
      "Date: 2027-01-18. Note: 'employer answer, certified mail 7020 1810 0001 2345 6789, " +
      "receipt in payroll binder'.",
    theTrap:
      "Typing today's date instead of the date it actually went. It feels harmless - the answer " +
      "IS filed either way - but the recorded date is the one you will quote if this is ever " +
      "questioned, and a date that disagrees with the postal receipt turns a clean file into an " +
      "argument about your record-keeping.",
  },
  {
    key: "tax-levy-no-answer",
    situation:
      "An IRS Form 668-W levy arrived. You returned parts 3 and 4 with the employee's exemption " +
      "certificate and started withholding from the levy tables. There is no Washington court " +
      "involved at all.",
    rightAnswer:
      "Nothing to do. The watchman never asks for an answer on a tax levy, because there is no " +
      "chapter 26.18 or chapter 6.27 duty to answer one.",
    whatToType:
      "Nothing. If you are seeing answer reminders on a levy, the order kind is recorded wrongly " +
      "- fix the kind, do not tick the exemption to make the noise stop.",
    theTrap:
      "Reaching for the 'no answer required' tick as a general mute button. It is the right tool " +
      "for exactly this situation and a catastrophe on a support order, which is why the system " +
      "refuses it outright on support and makes you write down the reason on everything else.",
  },
  {
    key: "support-tempted-to-waive",
    situation:
      "A child support order has been sitting unanswered for six weeks. The daily critical " +
      "reminders are relentless and you are certain the withholding itself is perfect. You are " +
      "tempted to tick 'no answer required' and get your inbox back.",
    rightAnswer:
      "The system will refuse, and the refusal is doing you the biggest favour on this screen.",
    whatToType:
      "Send the answer today, late. Then record it with the real date, and add a note saying it " +
      "was late and why.",
    theTrap:
      "Believing that perfect withholding cures a missing answer. It does not. RCW 26.18.110(6) " +
      "creates two independent routes to liability, and (6)(b) - failure to answer - is measured " +
      "against the whole support debt, not against the amount that should have been withheld. " +
      "Doing the expensive half right does not excuse the free half.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  THE TRAPS
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WatchLesson = {
  readonly topic: string;
  readonly plainEnglish: string;
  readonly whyItMatters: string;
};

export const WATCH_LESSONS: readonly WatchLesson[] = [
  {
    topic: "There is no snooze, and that is on purpose",
    plainEnglish:
      "Nothing on this screen dismisses a reminder. The only thing that stops one is recording " +
      "the fact that makes it unnecessary - the answer was filed on such a date, or this kind of " +
      "order carries no answer duty and here is why.",
    whyItMatters:
      "A dismiss button records that you saw a message. Six months later that answers nothing. " +
      "'Answer filed 18 January, certified mail' is the sentence that ends the conversation, and " +
      "the only way to have it on file is for the off switch to be the record itself.",
  },
  {
    topic: "Withholding perfectly is not answering",
    plainEnglish:
      "Taking the right amount out of the right cheque and sending it to the right registry " +
      "satisfies one duty. Returning the sworn employer answer within twenty days satisfies a " +
      "different one. Doing the first does not do the second.",
    whyItMatters:
      "This is the mistake, more than any other, that turns an employer into a defendant. The " +
      "money side is visible every pay run and gets attention. The affidavit is one piece of " +
      "paper, once, and it is the one with hundred-percent liability attached to it.",
  },
  {
    topic: "A quiet board is not the same as a safe one",
    plainEnglish:
      "If an order has no service date recorded, no deadline can be calculated for it, so it " +
      "cannot count down and it cannot go red. The watchman raises a warning saying exactly that " +
      "- and that warning is the loudest thing on this screen for a reason.",
    whyItMatters:
      "Every other alert here fails noisily. This one is the only place the system can fail " +
      "silently, so it is deliberately surfaced as a problem in its own right rather than as an " +
      "absence. An empty deadline column looks identical to a met deadline at a glance.",
  },
  {
    topic: "The reminders reach you where you are, not where the screen is",
    plainEnglish:
      "These go out by email and push notification on a daily schedule, from the same engine " +
      "that already handles the CCRS upload window and the LIQ-1295 excise return. You do not " +
      "have to open the garnishments page for the clock to be watched.",
    whyItMatters:
      "A warning that only appears on a screen you visit once per order, at the moment you " +
      "create it, is not a warning. That was literally the position before this - the twenty-day " +
      "deadline was calculated while you typed, shown for thirty seconds, and never evaluated " +
      "again for the rest of the order's life.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §7  WHAT A REFUSAL MEANS
 * ═══════════════════════════════════════════════════════════════════════════ */

export type AnswerRefusalLesson = {
  readonly code: AnswerRecordRefusalCode | "NOT_FOUND" | "READ_FAILED" | "WRITE_FAILED" | "NOT_CONFIGURED" | "REFUSED";
  readonly whatItMeans: string;
  readonly whatToDo: string;
};

/**
 * Every refusal, with the next step attached.
 *
 * Standing rule 43 says every refusal code must be reachable, and rule 48 says
 * a refusal explains rather than returns a bare boolean. This is the third
 * piece: a refusal without a NEXT STEP is a dead end, and a dead end is where
 * people start clicking the same button repeatedly.
 *
 * `everyAnswerRefusalCodeTaught()` in the gates module compares these keys
 * against `ALL_ANSWER_RECORD_REFUSAL_CODES` plus the store-level codes, so a
 * new refusal cannot ship without its lesson.
 */
export const ANSWER_REFUSAL_LESSONS: readonly AnswerRefusalLesson[] = [
  {
    code: "NO_ANSWER_GIVEN",
    whatItMeans:
      "No filing date was entered and no exemption was claimed, or the date was not in a form " +
      "this system will accept. Nothing was recorded and the reminders continue.",
    whatToDo:
      "Enter the date the answer left Greenway, four-digit year first: 2027-01-18. A format like " +
      "01/02/2027 is genuinely ambiguous between two countries, and this is a legal deadline.",
  },
  {
    code: "ANSWER_BEFORE_SERVICE",
    whatItMeans:
      "The filing date entered is earlier than the date the order was served, which cannot have " +
      "happened. Nothing was recorded.",
    whatToDo:
      "One of the two dates is wrong. Check the service date against the delivery receipt and " +
      "the filing date against your proof of sending. Correct whichever one disagrees with the " +
      "paper - do not adjust one to fit the other.",
  },
  {
    code: "ANSWER_IN_FUTURE",
    whatItMeans:
      "The filing date entered has not arrived yet. Nothing was recorded.",
    whatToDo:
      "Record the answer after you send it, using the date it actually went. Recording an " +
      "intention as a fact would switch the reminder off for something not yet done, which is " +
      "the exact failure this field exists to prevent.",
  },
  {
    code: "BOTH_FILED_AND_WAIVED",
    whatItMeans:
      "The form says both that the answer was filed and that no answer was required. Both cannot " +
      "be true, so nothing was recorded.",
    whatToDo:
      "Pick one. If you sent an answer, record the date and leave the exemption unticked. If " +
      "this order genuinely carries no Washington answer duty, clear the date.",
  },
  {
    code: "WAIVER_REASON_TOO_SHORT",
    whatItMeans:
      "The exemption was ticked without a written reason, or with only a couple of characters. " +
      "Nothing was recorded and the reminders continue.",
    whatToDo:
      "Name the document and why it carries no Washington answer duty, for example 'IRS Form " +
      "668-W levy: satisfied by returning the exemption certificate, no ch. 26.18 answer duty'. " +
      "If you cannot write that sentence, you do not yet know the exemption is correct.",
  },
  {
    code: "WAIVER_FORBIDDEN_FOR_SUPPORT",
    whatItMeans:
      "You tried to mark a child support or spousal maintenance order as needing no answer. The " +
      "system refused outright and changed nothing.",
    whatToDo:
      "Answer the order instead, even if it is late. RCW 26.18.110(1) requires a sworn answer " +
      "within twenty days of service and RCW 26.18.110(6)(b) makes Greenway liable for the " +
      "entire support debt if it is not answered. There is no version of this order that does " +
      "not need answering, so there is no reason you could write that would make the tick " +
      "correct.",
  },
  {
    code: "NOT_FOUND",
    whatItMeans:
      "The order could not be found or could not be updated, so nothing was recorded. Usually " +
      "this means the page has been open a while and the order changed in another window.",
    whatToDo:
      "Reload the garnishments page, find the order again, and look at where it actually stands " +
      "before re-entering anything.",
  },
  {
    code: "READ_FAILED",
    whatItMeans:
      "The order itself could not be read, so the system could not check the filing date against " +
      "the service date or check whether an exemption is even allowed. Nothing was recorded.",
    whatToDo:
      "This is a database problem rather than something you typed. Try again in a minute. If it " +
      "persists, the reminders will keep arriving, which is the correct behaviour - the duty is " +
      "still outstanding until something is recorded.",
  },
  {
    code: "WRITE_FAILED",
    whatItMeans:
      "The database rejected the change. Nothing was recorded and the reminders continue.",
    whatToDo:
      "Read the message underneath - it carries the database's own reason. If it mentions a " +
      "constraint on dates, the filing date and the service date disagree with each other.",
  },
  {
    code: "NOT_CONFIGURED",
    whatItMeans:
      "This installation has no service credentials configured, so no write of any kind can " +
      "happen. Nothing was recorded.",
    whatToDo:
      "This is a deployment setting, not a data problem. Nothing you type will change it. In the " +
      "meantime the answer deadline is still running, so send the answer on paper and record it " +
      "here once the system is available.",
  },
  {
    code: "REFUSED",
    whatItMeans:
      "The server re-ran the same checks the form ran and one of them failed. Nothing was " +
      "recorded.",
    whatToDo:
      "The sentence above names the specific rule. The server always re-checks, even when the " +
      "form was happy, because a browser can be out of date about what the order says.",
  },
];
