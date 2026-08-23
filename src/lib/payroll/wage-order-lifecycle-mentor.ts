/**
 * src/lib/payroll/wage-order-lifecycle-mentor.ts   (books-40b)
 *
 * THE CPA SITTING NEXT TO THE END / PAUSE / RESUME BUTTONS.
 *
 * WHY THIS FILE EXISTS, VERBATIM (standing rule 1)
 *
 *   "Keep adding all the mentoring and guidance walkthroughs from the PhD cpa
 *    we have been building. It is the single greatest thing we have included in
 *    this project in my opinion."
 *
 *   "I want it to tell me how to do it properly if I mess it up."
 *
 * Stopping a garnishment is where this feature is most dangerous, and it is
 * dangerous in BOTH directions, which is what makes it hard:
 *
 *   Stop too late  - you keep taking money you have no authority to take. In
 *                    Washington that is an unlawful deduction under
 *                    RCW 49.52.050, which names officers personally.
 *   Stop too early - you fail to withhold on a live support order, and under
 *                    RCW 26.18.110(6) Greenway can be made to pay one hundred
 *                    percent of somebody else's child support debt.
 *
 * There is no cautious default. "When in doubt, keep withholding" is wrong for
 * an expired creditor writ. "When in doubt, stop" is catastrophic for a support
 * order. The only way through is knowing which kind of order is in your hand,
 * and that is what this module teaches.
 *
 * DATA ONLY - NO `readFileSync`, NO IMPORTS OF NODE MODULES.
 *
 * This is imported by a `"use client"` component. The coverage GATES that read
 * source off disk live in `wage-order-lifecycle-mentor-gates.ts`, which is
 * imported only by tests. That split exists because several Vercel deployments
 * once died with "the chunking context does not support external modules
 * (request: node:fs)" after a mentor holding a `readFileSync` gate was imported
 * into a client component - see `tests/compliance/client-bundle-purity.test.ts`.
 *
 * AUTHORITY IDS, NOT AUTHORITY TEXT.
 *
 * Standing rule 25: extend, do not duplicate. Every statute this screen quotes
 * already exists verbatim in `garnishment-authorities.ts` or
 * `wage-order-entry-authorities.ts`. This module names them by ID and the
 * screen resolves them against the real registry, so there is exactly one copy
 * of every quotation in the codebase. A typo in an ID here renders nothing and
 * the gate fails; it cannot render a plausible-looking wrong quotation.
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  THE AUTHORITIES THIS SCREEN LEANS ON
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The four texts that decide WHEN withholding stops, quoted on screen.
 *
 * Chosen because between them they answer the only question that matters at
 * this button: is this order still live?
 *
 *   RCW 6.27.350(1)   a creditor writ EXPIRES - sixty days, or the amount, or
 *                     the end of employment, whichever comes first.
 *   RCW 26.18.110(2)  a support order withholds IMMEDIATELY on receipt and
 *                     keeps going; there is no expiry in it at all.
 *   RCW 26.18.110(6)  what it costs to stop a support order too early.
 *   RCW 26.18.110(1)  the twenty-day sworn answer, because "we ended it" is not
 *                     an answer and ending an order does not discharge that duty.
 *
 * Every id is resolved against the live registry by
 * `tests/compliance/wage-order-lifecycle.test.ts`, in the test named
 * "every lifecycle authority id resolves in the real registry". That test
 * exists and is named accurately; if you delete it, delete this sentence.
 */
export const LIFECYCLE_AUTHORITY_IDS = [
  "wage-order-rcw-6-27-350-sixty-days",
  "wage-order-rcw-26-18-110-remit",
  "wage-order-rcw-26-18-110-liability",
  "wage-order-rcw-26-18-110-answer",
] as const;

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE CHECKLIST
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * "I want check lists and blockers if things are right."
 *
 * Five questions in the order a CPA would actually ask them. The ORDER is the
 * teaching. Question 1 comes first because the answer to it changes the meaning
 * of every question after it: a creditor writ and a support order look almost
 * identical in the envelope and have opposite rules about ending.
 */
export type LifecycleCheck = {
  readonly key: string;
  readonly order: number;
  /** Asked as a question, because a question is answerable and a heading is not. */
  readonly question: string;
  readonly whyThisOrder: string;
  readonly ifItFails: string;
};

export const LIFECYCLE_CHECKS: readonly LifecycleCheck[] = [
  {
    key: "which-kind",
    order: 1,
    question: "Which kind of order is this - support, or a creditor writ?",
    whyThisOrder:
      "It has to be first, because it changes the answer to everything below it. A creditor " +
      "writ is temporary and expires on its own. A support order runs until somebody with " +
      "authority says stop. Same envelope, same drawer, opposite rules - and the single most " +
      "common way this goes wrong is treating one like the other.",
    ifItFails:
      "Look at the top of the paperwork for the issuing authority. A Washington support order " +
      "comes from the Division of Child Support or a court under chapter 26.18 RCW. A creditor " +
      "writ of garnishment comes from a court under chapter 6.27 RCW and names a plaintiff who " +
      "is a company. If you cannot tell, do not end anything - ask.",
  },
  {
    key: "what-paper",
    order: 2,
    question: "What piece of paper tells you it is over, and do you have it in front of you?",
    whyThisOrder:
      "Because the reason box is about to ask you what it says, and a reason written from " +
      "memory is the one that turns out to be wrong two years later. A release, a satisfaction " +
      "of judgment, a registry letter, a termination date, or a writ whose sixty days have run.",
    ifItFails:
      "Do not end it yet. If you believe it is over but cannot show why, that is exactly the " +
      "situation Pause exists for - pause it, get the paper, then end it properly. Pausing is " +
      "reversible and ending is not.",
  },
  {
    key: "sixty-days",
    order: 3,
    question: "If it is a creditor writ, have the sixty days actually run?",
    whyThisOrder:
      "RCW 6.27.350(1) ends a continuing lien at the payroll period ending on or before sixty " +
      "days after the EFFECTIVE DATE of the writ - and the effective date is the date of " +
      "service, unless another writ was already running, in which case the clock does not start " +
      "until that one ends. Counting from the wrong date is how you keep withholding on a dead " +
      "writ, which is somebody else's money.",
    ifItFails:
      "Count from the service date recorded on the order, not from the date on the judge's " +
      "signature and not from the day you opened the envelope. If a second writ was queued " +
      "behind a first, its sixty days start when the first one terminated.",
  },
  {
    key: "money-in-hand",
    order: 4,
    question: "Is there money already withheld that has not been sent to the payee yet?",
    whyThisOrder:
      "Ending an order stops FUTURE withholding. It does not cancel what is already out of " +
      "somebody's cheque. Money withheld and not yet remitted is not Greenway's money and it is " +
      "not the employee's either - you are holding it as a stakeholder, and it still has to go " +
      "where the order said.",
    ifItFails:
      "Send it. RCW 26.18.110(2) gives you five working days from each regular pay interval for " +
      "support, and the writ states the timing for a creditor garnishment. Ending the order in " +
      "this system does not do it for you and does not excuse it.",
  },
  {
    key: "answer-filed",
    order: 5,
    question: "Has the answer or affidavit this order required already been filed?",
    whyThisOrder:
      "Ending an order in your own records is not a communication to anybody. RCW 26.18.110(1) " +
      "requires a sworn answer within twenty days of service, and RCW 26.18.110(6)(b) makes " +
      "failing to answer its own independent route into full liability - you can withhold every " +
      "penny correctly and still land there by never filing the affidavit.",
    ifItFails:
      "File it. If the reason you are ending the order is 'this person does not work here', " +
      "that still needs to be said in the answer - silence reads as ignoring the order, and for " +
      "a creditor writ silence is how a default judgment against Greenway for the entire debt " +
      "happens under RCW 6.27.200.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE TRAPS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Mistakes competent people actually make here, not definitions.
 *
 * Each one is a thing that looks reasonable at the moment of clicking and is
 * expensive afterwards.
 */
export type LifecycleLesson = {
  readonly topic: string;
  readonly plainEnglish: string;
  readonly whyItMatters: string;
};

export const LIFECYCLE_LESSONS: readonly LifecycleLesson[] = [
  {
    topic: "Pausing an order that was actually released",
    plainEnglish:
      "Pause is for a genuine hold - an employee on unpaid leave, or the issuing authority " +
      "telling you in writing to stop for now. It is not the safe-looking version of ending " +
      "something. If the order is over, end it and type the reason.",
    whyItMatters:
      "A paused order drops off the active board, and off the board is out of mind. Nobody is " +
      "reminded about it, nothing chases it, and the reason it was paused was never written " +
      "down because pausing does not ask. Six months later there is a live obligation nobody " +
      "can explain.",
  },
  {
    topic: "Thinking ending an order deletes it",
    plainEnglish:
      "It does not, and nothing in this system does. The order, every figure on it, and every " +
      "cent withheld under it stay on file permanently. Ending adds a status and a reason; it " +
      "removes nothing.",
    whyItMatters:
      "That permanence is the point. The record is the proof Greenway did what the court said. " +
      "Under RCW 26.18.110(6) an employer who cannot show that can be made to pay the support " +
      "debt itself, so the file is the defence - which is exactly why there is no delete button " +
      "to find.",
  },
  {
    topic: "Expecting Resume to catch up the periods it missed",
    plainEnglish:
      "It does not. Resuming puts the order back on the active board from now on. It does not " +
      "reach back and collect for the pay periods that went by while it was paused.",
    whyItMatters:
      "That is deliberate. Collecting a backlog out of one cheque can drive somebody below the " +
      "protected floor and is a decision with real consequences for their rent. If the issuing " +
      "authority wants the missed amounts collected, that comes from them in writing and gets " +
      "entered as arrears on the order, where the calculator can apply the correct ceiling to it.",
  },
  {
    topic: "Ending a support order because the employee said it was over",
    plainEnglish:
      "An employee telling you their support case has closed is not authority to stop " +
      "withholding. A support order ends when the court or the registry says so, in writing.",
    whyItMatters:
      "They may be sincere and still wrong - a modification is not a termination, and an " +
      "agreement between the parents does not bind you. If you stop on their word and they were " +
      "wrong, the shortfall is Greenway's under RCW 26.18.110(6), and 'the employee told me' " +
      "is not one of the defences in that subsection.",
  },
  {
    topic: "Ending the order but not answering the court",
    plainEnglish:
      "Recording an ending here changes your records. It does not tell the court, the registry " +
      "or the creditor anything at all. This system is your books; it is not a filing agent.",
    whyItMatters:
      "The answer deadlines run regardless. Twenty days for a support order under " +
      "RCW 26.18.110(1), and for a creditor writ the deadline printed on the writ itself - miss " +
      "that one and RCW 6.27.200 lets the court enter judgment against Greenway for the FULL " +
      "amount the employee owes, with interest and costs.",
  },
  {
    topic: "Two people acting on the same order in two tabs",
    plainEnglish:
      "If somebody else ended or paused this order while your page was open, your click will " +
      "be refused with an explanation rather than quietly overwriting theirs. Reload and look " +
      "before doing anything else.",
    whyItMatters:
      "On an ending, the reason is the entire point of the record. A silent overwrite would " +
      "replace a correct reason with a stale one and nobody would ever know. That is why every " +
      "one of these three writes is guarded on the order's CURRENT status in the database and " +
      "not merely on its id.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  WHAT EACH REFUSAL MEANS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * "I want it to tell me how to do it properly if I mess it up."
 *
 * The server actions never throw and never return a bare boolean. They return
 * a result carrying a code and a sentence. These are the codes, explained, so
 * that a refusal on screen is a next step rather than a dead end.
 *
 * Keys are the real `WageOrderWriteFailure["code"]` union plus the browser-side
 * `REASON_TOO_SHORT`. The gate asserts every code the store can emit has a
 * lesson here (standing rule 43: refusal codes must be reachable AND explained).
 */
export type LifecycleRefusalLesson = {
  readonly code: string;
  readonly whatItMeans: string;
  readonly whatToDo: string;
};

export const LIFECYCLE_REFUSAL_LESSONS: readonly LifecycleRefusalLesson[] = [
  {
    code: "REASON_TOO_SHORT",
    whatItMeans:
      "The reason for ending the order was blank or only a couple of characters, so nothing was " +
      "sent to the server and withholding continues exactly as it was.",
    whatToDo:
      "Write what happened in the words you would use out loud, naming the paper and the date " +
      "where you can - 'released by the registry 2026-04-02', 'balance paid in full', 'writ " +
      "expired 60 days after service 2026-02-01'.",
  },
  {
    code: "NOT_FOUND",
    whatItMeans:
      "The order was not in the state this action needs it to be in, so nothing was changed. " +
      "Usually that means somebody else got there first - it has already been ended, or already " +
      "paused, while this page was sitting open.",
    whatToDo:
      "Reload the garnishments page and look at where the order actually stands before doing " +
      "anything else. Do not click again on the stale page; the second click cannot succeed and " +
      "the state you are looking at is not the real one.",
  },
  {
    code: "REFUSED",
    whatItMeans:
      "The database itself rejected the change because it would have broken one of the rules " +
      "written into the table - most often the rule that an ended order must carry a written " +
      "reason of at least five characters. Nothing was changed.",
    whatToDo:
      "Read the sentence shown with it: it names the specific rule and what to do about it. " +
      "This is the last line of defence rather than the first, so seeing it usually means " +
      "something reached the server that the screen should have caught - worth reporting.",
  },
  {
    code: "WRITE_FAILED",
    whatItMeans:
      "The database returned an error the system does not recognise, and nothing was changed. " +
      "This is a defect, not something you typed.",
    whatToDo:
      "Do not work around it and do not keep clicking. Send the exact sentence on screen to the " +
      "developer - it contains the database's own message, which is what makes it fixable.",
  },
  {
    code: "READ_FAILED",
    whatItMeans:
      "The orders could not be read, so what you are looking at may be incomplete. Nothing was " +
      "changed by this.",
    whatToDo:
      "Reload. If it keeps happening, treat the board as unreliable until it is fixed - a " +
      "garnishment screen that cannot list every live order is worse than no screen, because it " +
      "looks complete.",
  },
  {
    code: "NOT_CONFIGURED",
    whatItMeans:
      "The database connection is not configured in this environment. Nothing was changed and " +
      "nothing was lost - no order has been affected and no withholding has changed.",
    whatToDo:
      "This is a deployment problem rather than a data problem. Nothing you can do on this " +
      "screen fixes it; report it.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  THE TWO KINDS, SIDE BY SIDE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The comparison Michael asked to be walked through, as data.
 *
 * "I want to be walked through this with my hand held. Plain english teaching.
 *  Examples."
 *
 * This renders as a two-column table on screen. It is the single highest-value
 * thing on the page, because almost every serious mistake in ending a
 * garnishment comes from applying one column's rule to the other column's order.
 */
export type KindComparisonRow = {
  readonly aspect: string;
  readonly creditorWrit: string;
  readonly supportOrder: string;
};

export const KIND_COMPARISON: readonly KindComparisonRow[] = [
  {
    aspect: "Does it end by itself?",
    creditorWrit:
      "Yes. It expires at the payroll period ending on or before sixty days after the writ's " +
      "effective date, or when the amount on the writ is collected, whichever comes first.",
    supportOrder:
      "No. It runs indefinitely until the court or the registry says otherwise. There is no " +
      "expiry date in it and none should be invented.",
  },
  {
    aspect: "Who can tell you to stop?",
    creditorWrit:
      "The court, the creditor's release, or the clock. Satisfaction of the judgment also ends " +
      "it.",
    supportOrder:
      "The issuing authority only - a court order or the Division of Child Support, in writing. " +
      "Not the employee, and not the other parent.",
  },
  {
    aspect: "What ending it too early costs",
    creditorWrit:
      "You under-collect for a creditor. Recoverable, and the writ can be re-served.",
    supportOrder:
      "Up to one hundred percent of the support debt, from Greenway, under RCW 26.18.110(6) - " +
      "plus costs and their attorney's fees.",
  },
  {
    aspect: "What ending it too late costs",
    creditorWrit:
      "You take money you have no authority to take. That is an unlawful deduction from wages " +
      "under RCW 49.52.050, which reaches officers personally.",
    supportOrder:
      "The same exposure, and it is the more likely error here because there is no clock telling " +
      "you the order is over.",
  },
  {
    aspect: "The typical reason to end it",
    creditorWrit:
      "'Writ expired 60 days after service 2026-02-01' or 'judgment satisfied in full " +
      "2026-03-15'.",
    supportOrder:
      "'Released by the Washington State Support Registry 2026-04-02' or 'terminated by court " +
      "order dated 2026-04-02'.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  WORKED EXAMPLES
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Three situations, with the right button named.
 *
 * Michael asked for examples repeatedly and they are the part people actually
 * read. Each one is a plausible Tuesday at Greenway, not a textbook case.
 */
export type LifecycleWorkedExample = {
  readonly key: string;
  readonly situation: string;
  readonly rightAnswer: string;
  readonly whatToType: string;
  readonly theTrap: string;
};

export const LIFECYCLE_WORKED_EXAMPLES: readonly LifecycleWorkedExample[] = [
  {
    key: "writ-expired",
    situation:
      "A creditor writ for one of your budtenders was served on 1 February 2026. It is now " +
      "10 April. Payroll is about to run and the order is still on the active board.",
    rightAnswer:
      "End it. Sixty days after 1 February is 2 April, so the lien ended at the payroll period " +
      "ending on or before that date. It should already have stopped, and every dollar withheld " +
      "after it expired is money taken without authority.",
    whatToType: "Writ expired 60 days after service 2026-02-01; lien ended 2026-04-02.",
    theTrap:
      "Waiting for the court to send something. It will not. A creditor writ ends by the clock, " +
      "and nobody writes to tell you - which is why this one is missed far more often than a " +
      "support order is.",
  },
  {
    key: "employee-says-so",
    situation:
      "An employee with a child support withholding order tells you their case is closed and " +
      "asks you to stop taking it out of their cheque. They are sincere and slightly upset.",
    rightAnswer:
      "Change nothing. Keep withholding. A support order ends when the registry or the court " +
      "says so, in writing, and neither has said anything to you.",
    whatToType:
      "Nothing - do not end it. Tell them you will stop the day the registry or the court tells " +
      "Greenway, and that you will act the same day it arrives.",
    theTrap:
      "That this feels unkind, so it is tempting to help. If they are wrong, the shortfall is " +
      "Greenway's under RCW 26.18.110(6), and 'the employee told me it was closed' is not one " +
      "of the defences listed in that subsection. Helping them here costs them nothing and " +
      "costs Greenway the whole debt.",
  },
  {
    key: "unpaid-leave",
    situation:
      "An employee with an active support order goes on three months of unpaid leave. There are " +
      "no earnings to withhold from, and the order sits on the board every payroll asking to be " +
      "looked at.",
    rightAnswer:
      "Pause it, and set yourself a reminder for the date they are due back. This is the narrow " +
      "case Pause was built for: nothing is over, there is simply nothing to withhold from.",
    whatToType:
      "Nothing is required for a pause - but write the return date in the note anyway, because " +
      "the note is the only thing that will remind you.",
    theTrap:
      "Forgetting it. A paused order leaves the active board, so nothing puts it in front of " +
      "you again. When they come back, resuming does NOT collect anything for the months that " +
      "passed - and it should not, but you need to know that is what happened.",
  },
];
