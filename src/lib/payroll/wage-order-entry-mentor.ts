/**
 * src/lib/payroll/wage-order-entry-mentor.ts   (books-38)
 *
 * THE MENTOR LAYER FOR TYPING A JUDGEMENT INTO THE SYSTEM.
 *
 * Michael's instruction, verbatim, and the reason this file exists:
 *
 *     "The next question I have is, the child support and garnishment page
 *      does not have a way for me to enter that in. Is it on other page like
 *      the payroll setup page? Please let me know how to use and set up
 *      garnishments and child support with the details from the judgement."
 *
 * He was right. There was no write path anywhere in the codebase. `wage_orders`
 * existed from migration 0198 with every field a judgement needs, and the only
 * exported function that touched it was `loadGarnishmentBoard()`, which reads.
 * books-38 builds the entry act; this file is the teaching that goes with it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY A SECOND GARNISHMENT MENTOR, AND NOT MORE OF THE FIRST
 * ───────────────────────────────────────────────────────────────────────────
 * `garnishment-mentor.ts` (books-35) teaches the MATH: disposable earnings,
 * the CCPA ceilings, the Washington exemptions, which cap governs. That is a
 * complete subject and it is well covered.
 *
 * This file teaches a genuinely different one: the ACT OF RECEIVING A COURT
 * ORDER. Its questions are not "how much" but "what does this piece of paper
 * oblige Greenway to do, by when, and what happens if we are late". The two
 * subjects have different authorities behind them, different failure modes,
 * and different consequences.
 *
 * The distinction is worth stating plainly, because it is the thing most
 * employers get backwards:
 *
 *     THE MATH punishes you for taking TOO MUCH. Over-withhold and the
 *     employee has a wage claim, and it is Michael who repays it.
 *
 *     THE ENTRY ACT punishes you for doing NOTHING. Ignore a writ, or simply
 *     fail to file an answer on time, and a court can enter judgment against
 *     GREENWAY for the entire debt the employee owes.
 *
 * Those pull in opposite directions, and the second is by far the larger
 * number. A cautious employer who is nervous about withholding from someone's
 * pay, and who therefore waits to be sure, is walking directly into the more
 * expensive of the two mistakes. That asymmetry shapes every lesson below.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * PURE DATA. NO `node:fs`. STANDING RULE 65b.
 * ───────────────────────────────────────────────────────────────────────────
 * Client components import this. It must stay free of Node built-ins. The
 * coverage gates that read the engine off disk live in
 * `wage-order-entry-mentor-gates.ts`, which only tests import. Mixing the two
 * in books-33 dragged `node:fs` into a browser bundle and broke every
 * deployment while CI stayed green.
 */
import type { WageOrderRefusalCode } from "@/lib/payroll/wage-order-entry-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  WHAT IS ON THE PAPER
 *
 * Michael asked how to set an order up "with the details from the judgement".
 * So these lessons are keyed to the DOCUMENT rather than to the database. Each
 * one says where on the paper the value is, what it is called on the various
 * forms that arrive, and the specific way it gets mistyped.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type JudgementFieldLesson = {
  /** The field on the entry form, matching a key of WageOrderDraft. */
  readonly draftField: string;
  /** The label Michael sees. */
  readonly label: string;
  /** Where to find it on the physical document. */
  readonly whereOnThePaper: string;
  /** Other names the same thing goes by. */
  readonly alsoCalled: readonly string[];
  /** The mistake that actually happens. */
  readonly theTrap: string;
  /** A real-shaped example. */
  readonly example: string;
  readonly authorityIds: readonly string[];
};

export const JUDGEMENT_FIELD_LESSONS: readonly JudgementFieldLesson[] = [
  {
    draftField: "orderKind",
    label: "What kind of order is this?",
    whereOnThePaper:
      "The title across the top of the first page. It is the largest text on the document and it " +
      "is almost always accurate - courts are precise about what they are issuing.",
    alsoCalled: [
      "Income Withholding for Support (IWO)",
      "Order / Notice to Withhold Income for Child Support",
      "Writ of Garnishment",
      "Writ of Garnishment for Continuing Lien on Earnings",
      "Notice of Levy",
    ],
    theTrap:
      "Treating anything from a court as a 'garnishment'. The kind decides which ceiling applies, " +
      "and the ceilings are not close together: a creditor writ is capped near twenty-five " +
      "percent of disposable earnings, a support order can reach sixty-five, and a federal tax " +
      "levy is not subject to that ceiling at all. Choosing the wrong kind produces a plausible " +
      "number that is wrong by hundreds of dollars a period.",
    example:
      "A page headed 'INCOME WITHHOLDING FOR SUPPORT' is child_support, even when it arrives from " +
      "a collection agency rather than from a court, and even when the words 'child support' " +
      "never appear again.",
    authorityIds: ["wage-order-rcw-26-18-110-remit"],
  },
  {
    draftField: "caseNumber",
    label: "Case number",
    whereOnThePaper:
      "Top right of the first page, in the caption block beside the court's name. Copy it " +
      "EXACTLY, including punctuation and leading zeros.",
    alsoCalled: ["Cause number", "Case no.", "Docket number", "IV-D case number"],
    theTrap:
      "Two different numbers appear on a support order and they are not interchangeable. The " +
      "COURT cause number identifies the case; the IV-D or member number identifies the support " +
      "registry account. Use the cause number here, and put the other in the remittance " +
      "instructions, because the payment has to carry it or it will not be credited to the right " +
      "person.",
    example: "26-3-01234-5 is a Kitsap County Superior Court cause number for a domestic matter.",
    authorityIds: ["wage-order-rcw-26-18-110-answer"],
  },
  {
    draftField: "issuingAuthority",
    label: "Who issued it",
    whereOnThePaper:
      "Directly above the case number, at the very top: 'IN THE SUPERIOR COURT OF THE STATE OF " +
      "WASHINGTON IN AND FOR THE COUNTY OF KITSAP', or an agency's name on a letterhead.",
    alsoCalled: ["Court", "Issuing agency", "Tribunal"],
    theTrap:
      "Writing the plaintiff's or the collection agency's name here. The issuing authority is who " +
      "has the power to compel Greenway, and it is the body to contact when something about the " +
      "order does not make sense. On an administrative support order it may be a state agency " +
      "rather than a court, and that is normal - such an order binds an employer exactly as a " +
      "court order does.",
    example: "Kitsap County Superior Court",
    authorityIds: ["wage-order-rcw-26-18-110-answer"],
  },
  {
    draftField: "orderDate",
    label: "Date the order was signed",
    whereOnThePaper: "Beside the judge's or commissioner's signature at the END of the document.",
    alsoCalled: ["Dated", "Entered", "Signed this ___ day of"],
    theTrap:
      "Believing this is the date that matters. It almost never is. Read the next lesson before " +
      "typing anything into either date field.",
    example: "Signed 5 January 2026 - written here as 2026-01-05.",
    authorityIds: ["wage-order-rcw-6-27-350-sixty-days"],
  },
  {
    draftField: "servedDate",
    label: "Date it was SERVED on Greenway",
    whereOnThePaper:
      "NOT on the order. It is on the evidence of delivery: the process server's return, the " +
      "certified-mail green card, the courier's receipt, the postmark, or the received stamp if " +
      "somebody at the shop applied one. If the envelope has been thrown away, ask the person who " +
      "opened it before the memory goes cold.",
    alsoCalled: ["Date of service", "Served on", "Effective date of the writ"],
    theTrap:
      "Copying the signature date into this box because it is right there and this one is not. " +
      "That single keystroke misstates both statutory clocks at once. The answer on a support " +
      "order is due twenty days after SERVICE, and the sixty-day life of a creditor writ is " +
      "measured from SERVICE, because the statute defines the writ's effective date that way. " +
      "An order signed on the 5th and served on the 20th has an answer due on 9 February, not " +
      "25 January. Get this wrong in the generous direction and the screen reassures you while " +
      "the deadline passes.",
    example:
      "Signed 2026-01-05, handed to the shop 2026-01-20 -> servedDate is 2026-01-20 and the " +
      "answer is due 2026-02-09.",
    authorityIds: [
      "wage-order-rcw-26-18-110-answer",
      "wage-order-rcw-6-27-350-sixty-days",
      "wage-order-rcw-6-27-200-default",
    ],
  },
  {
    draftField: "payeeName",
    label: "Who the money goes to",
    whereOnThePaper:
      "In the payment instructions, usually a boxed section headed 'REMIT PAYMENT TO' or 'MAKE " +
      "CHECKS PAYABLE TO'. On a Washington support order this is almost always the Washington " +
      "State Support Registry, not the other parent.",
    alsoCalled: ["Remit to", "Payable to", "Obligee", "Judgment creditor"],
    theTrap:
      "Paying the person the money is FOR instead of the entity named to receive it. Sending " +
      "child support directly to the other parent feels obviously correct and is a failure to " +
      "comply: the payment is not recorded, the arrears keep building, and Greenway has to pay " +
      "again to the registry. The money is gone and the debt is not.",
    example: "Washington State Support Registry, PO Box 45868, Olympia WA 98504-5868.",
    authorityIds: ["wage-order-rcw-26-18-110-remit"],
  },
  {
    draftField: "payeeAddress",
    label: "Where the payment is sent",
    whereOnThePaper:
      "In the same boxed section as the payee, immediately under the name. On a support order it " +
      "is a PO box belonging to the registry rather than a street address.",
    alsoCalled: ["Remit to address", "Send payment to", "Mailing address"],
    theTrap:
      "Reusing an address from memory or from a previous order for the same registry. Support " +
      "registries and collection firms move their lockboxes, and a payment posted to a superseded " +
      "PO box is not late, it is lost - it does not bounce back quickly and it is not credited " +
      "while it is missing. Copy the address printed on THIS order every time, even when the " +
      "payee is one you have paid before.",
    example: "PO Box 45868, Olympia WA 98504-5868.",
    authorityIds: ["wage-order-rcw-26-18-110-remit"],
  },
  {
    draftField: "remittanceInstructions",
    label: "How the payment must be identified",
    whereOnThePaper:
      "Beside the payee: the case identifier the payment must quote, the FIPS or state code, any " +
      "electronic-payment details.",
    alsoCalled: ["Payment identifier", "Remittance ID", "Include with payment"],
    theTrap:
      "Sending a correct amount to a correct payee with nothing to identify it. An unidentified " +
      "payment to a support registry is not a paid support obligation, it is an unallocated " +
      "receipt sitting in a suspense account while the employee's arrears continue to accrue. " +
      "Copy the identifiers verbatim.",
    example: "Include case 26-3-01234-5 and SSN last four on every remittance.",
    authorityIds: ["wage-order-rcw-26-18-110-remit"],
  },
  {
    draftField: "fixedAmountText",
    label: "A flat amount per pay period",
    whereOnThePaper:
      "In the withholding instructions. Support orders overwhelmingly state a fixed amount, and " +
      "they usually state it PER MONTH.",
    alsoCalled: ["Current support", "Monthly obligation", "Amount to withhold"],
    theTrap:
      "Entering a monthly figure into a per-period box. Greenway pays every two weeks, twenty-six " +
      "times a year, so a monthly obligation is not the monthly figure divided by two. It is the " +
      "monthly figure times twelve divided by twenty-six. Using half of the monthly amount " +
      "under-withholds by about eight percent all year, and on a support order the employer can " +
      "be liable for the shortfall. If the order does not state a per-period figure, ask the " +
      "issuing authority to confirm the conversion in writing rather than doing the arithmetic " +
      "quietly.",
    example:
      "$650.00 per month is $650 x 12 / 26 = $300.00 per biweekly period, entered as 300.00.",
    authorityIds: ["wage-order-rcw-26-18-110-remit"],
  },
  {
    draftField: "percentText",
    label: "A percentage of disposable earnings",
    whereOnThePaper: "In the withholding instructions, where the order states a percentage.",
    alsoCalled: ["Percent of disposable earnings", "Percentage to withhold"],
    theTrap:
      "This box takes a PERCENT, typed the way it is printed. Type 25 for twenty-five percent. " +
      "The system stores it internally in basis points, and the conversion is the single most " +
      "dangerous one in the entry path - storing 25 where 2500 belongs turns a $288.20 " +
      "withholding into $2.88 and nothing about the resulting number looks alarming. An order " +
      "states an amount OR a percentage, never both, which the database enforces.",
    example: "'25% of disposable earnings' is entered as 25.",
    authorityIds: ["wage-order-rcw-6-27-350-sixty-days"],
  },
  {
    draftField: "arrearsText",
    label: "Past-due balance",
    whereOnThePaper:
      "A separate line from the ongoing obligation, often headed 'arrears', 'past due' or " +
      "'judgment amount'.",
    alsoCalled: ["Past due support", "Arrearage", "Back support"],
    theTrap:
      "Adding arrears into the ongoing amount. They are recorded separately because they do " +
      "different work: the arrears figure is what tells you the balance is finite, and it drives " +
      "the twelve-week question below, which moves the federal ceiling by five percentage points.",
    example: "$4,200.00 past due, entered as 4200.00.",
    authorityIds: ["wage-order-rcw-26-18-110-remit"],
  },
  {
    draftField: "arrearsOverTwelveWeeks",
    label: "Is any of the arrears more than twelve weeks old?",
    whereOnThePaper:
      "Usually a tick box on a support order. If the form does not say, the issuing authority " +
      "must be asked - it is not something to infer from the size of the balance.",
    alsoCalled: ["Arrears greater than 12 weeks", "In arrears more than 12 weeks"],
    theTrap:
      "Leaving it blank to be safe. Blank is not safe here, it is refused, and deliberately: this " +
      "answer adds five percentage points to the federal ceiling. Guessing 'no' under-withholds " +
      "on an order the employer is liable for; guessing 'yes' takes money the employee is " +
      "entitled to keep. There is no cautious direction, so the system refuses rather than " +
      "picking one.",
    example: "Ticked 'yes' -> the ceiling moves from 50% to 55%, or from 60% to 65%.",
    authorityIds: ["wage-order-rcw-26-18-110-remit"],
  },
  {
    draftField: "supportsSecondFamily",
    label: "Does this employee support another spouse or child?",
    whereOnThePaper:
      "A tick box on the support order. Same rule as above: if the paper does not say, ask.",
    alsoCalled: ["Supports a second family", "Obligor supports another dependent"],
    theTrap:
      "Assuming from what you know about the person. This single answer is the difference between " +
      "a fifty percent ceiling and a sixty percent one - on a $2,000 disposable-earnings cheque " +
      "that is two hundred dollars a period. It is a question about their legal support " +
      "obligations, not about their household, and it belongs to the court's finding rather than " +
      "to an employer's impression.",
    example: "Ticked 'no' -> the 60% branch applies, and 65% if arrears exceed twelve weeks.",
    authorityIds: ["wage-order-rcw-26-18-110-remit"],
  },
  {
    draftField: "priorityText",
    label: "Priority",
    whereOnThePaper:
      "Not on the paper. It is Greenway's record of the order in which competing orders are " +
      "satisfied when one paycheque cannot cover them all. Lower number is paid first.",
    alsoCalled: ["Rank", "Order of satisfaction"],
    theTrap:
      "Changing it by instinct. Support outranks everything by statute, so a support order should " +
      "be 1 and everything else should be left alone unless a court has said otherwise. Paying a " +
      "creditor writ ahead of a support order is not merely out of order, it exposes Greenway to " +
      "the support liability while the money has already gone elsewhere.",
    example: "Support order -> 1. Creditor writ -> leave the default of 100.",
    authorityIds: ["wage-order-rcw-26-18-110-priority"],
  },
  {
    draftField: "effectiveFrom",
    label: "First pay period this affects",
    whereOnThePaper:
      "Derived, not copied. It is the start of the first pay period Greenway can lawfully apply " +
      "the order to after service.",
    alsoCalled: ["Begin withholding", "First affected pay period"],
    theTrap:
      "Setting it to the order date and back-dating into periods already paid. A pay run that has " +
      "been issued cannot be re-cut, and withholding retroactively from a later cheque to make up " +
      "for it takes more than the ceiling permits from that cheque. Start with the next period " +
      "and let the arrears balance carry the history.",
    example: "Served 2026-01-20, next period starts 2026-01-26 -> effectiveFrom is 2026-01-26.",
    authorityIds: ["wage-order-rcw-26-18-110-remit"],
  },
  {
    draftField: "effectiveTo",
    label: "Last day it applies (if known)",
    whereOnThePaper:
      "Rarely printed. Leave it empty unless the order states an end date, in which case it will " +
      "be explicit.",
    alsoCalled: ["Terminates on", "Through"],
    theTrap:
      "Two opposite errors, one per order type, and they are the most common mistakes in this " +
      "whole slice. A CREDITOR writ dies sixty days after service by operation of law, so leaving " +
      "it open-ended means withholding from someone's pay under an expired writ, which is simply " +
      "taking their money. A SUPPORT order does NOT expire - it continues until the issuing " +
      "authority says stop, in writing - so putting a guessed end date on one stops a legally " +
      "required withholding early and leaves Greenway liable for what was not taken.",
    example:
      "Creditor writ served 2026-01-20 -> the lien runs to roughly 2026-03-21. Support order -> " +
      "leave empty.",
    authorityIds: ["wage-order-rcw-6-27-350-sixty-days"],
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  WHY THE FORM SAID NO
 *
 * One lesson per refusal code. Every code in the engine's closed union appears
 * here exactly once, and `wage-order-entry-mentor-gates.ts` proves it against
 * the engine's own runtime list rather than a copy.
 *
 * A refusal that only says WHAT is missing teaches nothing. Standing rule 64a:
 * detection is not explanation. Each lesson answers three questions - what
 * happened, why refusing beats computing anyway, and what to actually do.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type EntryRefusalLesson = {
  readonly code: WageOrderRefusalCode;
  readonly headline: string;
  readonly whyWeStop: string;
  readonly whatToDo: string;
};

export const WAGE_ORDER_ENTRY_REFUSAL_LESSONS: readonly EntryRefusalLesson[] = [
  {
    code: "NO_EMPLOYEE",
    headline: "No employee is selected",
    whyWeStop:
      "An order withholds from one named person's pay. Stored without one it would sit in the " +
      "system affecting nobody, which reads as compliance and is not.",
    whatToDo:
      "Choose the employee the order names. If the person named does not work here, do not store " +
      "the order - answer the writ saying so. That answer is itself the legal obligation, and it " +
      "is due whether or not there is anyone to withhold from.",
  },
  {
    code: "UNKNOWN_ORDER_KIND",
    headline: "The kind of order has not been chosen",
    whyWeStop:
      "The kind decides which ceiling applies. There is no safe default: guess creditor on a " +
      "support order and it under-withholds against an obligation Greenway is liable for; guess " +
      "support on a creditor writ and it takes far more than the law permits.",
    whatToDo:
      "Read the title across the top of the first page and choose the matching kind. If the title " +
      "is genuinely ambiguous, telephone the issuing authority - the case number is on the paper " +
      "and they will tell you.",
  },
  {
    code: "NO_CASE_NUMBER",
    headline: "The case number is missing",
    whyWeStop:
      "It is how a payment gets credited to the right person and how this order is distinguished " +
      "from the next one for the same employee. It is also what prevents the same writ being " +
      "entered twice and doubling the withholding.",
    whatToDo:
      "Copy it from the caption block at the top right of the first page, exactly as printed, " +
      "including punctuation and leading zeros.",
  },
  {
    code: "NO_ISSUING_AUTHORITY",
    headline: "The issuing court or agency is missing",
    whyWeStop:
      "This is who to contact when something is wrong, and who receives the answer. An order with " +
      "no issuer cannot be answered, and the answer is the deadline that carries the penalty.",
    whatToDo:
      "Take it from the very top of the first page, above the case number. Enter the COURT or " +
      "AGENCY, not the plaintiff or the collection firm.",
  },
  {
    code: "NO_PAYEE",
    headline: "There is nobody to pay",
    whyWeStop:
      "Withholding money from an employee and not remitting it is worse than not withholding at " +
      "all: the employee is short and the debt is unpaid, and Greenway is holding funds it has no " +
      "right to.",
    whatToDo:
      "Find the 'remit payment to' box. On a Washington support order it is almost always the " +
      "Washington State Support Registry rather than the other parent.",
  },
  {
    code: "NO_ORDER_DATE",
    headline: "The date the order was signed is missing",
    whyWeStop:
      "It is the audit anchor and the tiebreaker when two orders of the same kind compete. It " +
      "also lets the system check that service did not precede signature, which is how a " +
      "transposed year gets caught before it misstates a deadline.",
    whatToDo: "Beside the signature at the end of the document. Enter it as yyyy-mm-dd.",
  },
  {
    code: "BAD_ORDER_DATE",
    headline: "That is not a real date",
    whyWeStop:
      "Dates are stored as real dates so they can be compared and counted. A date that does not " +
      "exist would compute deadlines that do not exist.",
    whatToDo:
      "Use yyyy-mm-dd - 2026-01-05, not 01/05/26. February the 30th and month 13 are rejected " +
      "outright rather than silently rolled forward into March.",
  },
  {
    code: "NO_SERVED_DATE",
    headline: "The date of service is missing",
    whyWeStop:
      "This is the field the penalties are measured from, and the system will not invent it. On a " +
      "support order the answer is due twenty days after service; on a creditor writ the sixty-day " +
      "lien runs from service. A guessed date here produces a confident, specific, wrong deadline " +
      "- and a wrong deadline is more dangerous than a blank one, because a blank one gets asked " +
      "about.",
    whatToDo:
      "Look at the evidence of delivery rather than the order: the process server's return, the " +
      "certified-mail card, the courier receipt, the postmark, or the received stamp. If nobody " +
      "can establish it, telephone the issuing authority and ask for the date of service on " +
      "record. Do not estimate.",
  },
  {
    code: "BAD_SERVED_DATE",
    headline: "The service date is not a real date",
    whyWeStop:
      "Same reason as the order date, with more at stake: this one is what the twenty-day and " +
      "sixty-day clocks are counted from.",
    whatToDo:
      "Enter it as yyyy-mm-dd - 2026-01-20, not 20/01/26 and not 'last Tuesday'. Take it from the " +
      "delivery evidence rather than the order itself, and if the day is genuinely unknown, ask " +
      "the issuing authority for the date of service on record instead of approximating.",
  },
  {
    code: "SERVED_BEFORE_ORDERED",
    headline: "This says the order was served before it was signed",
    whyWeStop:
      "That cannot have happened, so one of the two dates is mistyped - and the likeliest mistype " +
      "is a transposed year on the date every deadline is measured from. Catching it now is much " +
      "cheaper than discovering it when a default notice arrives.",
    whatToDo:
      "Check both dates against the documents. The signature date is on the order; the service " +
      "date is on the delivery evidence. A 2025 typed where 2026 belongs is the usual culprit.",
  },
  {
    code: "NO_MEASURE",
    headline: "The order does not say how much to withhold",
    whyWeStop:
      "An order has to state either a fixed amount per period or a percentage of disposable " +
      "earnings. With neither, there is nothing to compute, and any figure chosen would be " +
      "invented by an employer.",
    whatToDo:
      "Re-read the withholding instructions - the amount is sometimes in a paragraph rather than " +
      "a box, and on a support order it is very often stated per MONTH. Convert a monthly figure " +
      "with x 12 / 26 for biweekly pay, and never with a simple halving.",
  },
  {
    code: "TWO_MEASURES",
    headline: "Both an amount and a percentage were entered",
    whyWeStop:
      "The two would disagree on almost every cheque, and the system will not silently choose the " +
      "one that favours anybody. The database enforces this too, so it cannot be worked around.",
    whatToDo:
      "Clear whichever the order does not state. If the paper really does give both - typically a " +
      "fixed amount 'not to exceed' a percentage - enter the fixed amount here and put the ceiling " +
      "in the notes, because the statutory caps are applied on top of whatever is entered anyway.",
  },
  {
    code: "BAD_AMOUNT",
    headline: "The amount could not be read as money",
    whyWeStop:
      "A misread amount is withheld from a real person's pay every fortnight until somebody " +
      "notices.",
    whatToDo:
      "Type digits with at most two decimal places. A leading $ and thousands commas are " +
      "understood; anything else is refused rather than guessed at.",
  },
  {
    code: "AMOUNT_NOT_POSITIVE",
    headline: "The amount must be greater than zero",
    whyWeStop:
      "A zero-amount order looks active on the board and withholds nothing, which is the worst " +
      "combination available: it reassures everyone while the arrears grow.",
    whatToDo:
      "If the order genuinely withholds nothing at present, do not store it as an active order. " +
      "Answer it, and store it terminated with a note saying why.",
  },
  {
    code: "BAD_PERCENT",
    headline: "The percentage could not be read",
    whyWeStop:
      "Percentages are stored in basis points, and a misread here is the most consequential " +
      "conversion in the whole entry path.",
    whatToDo:
      "Type the number as printed - 25 for twenty-five percent. A trailing % sign is understood.",
  },
  {
    code: "PERCENT_OUT_OF_RANGE",
    headline: "That percentage is outside the possible range",
    whyWeStop:
      "A percentage over one hundred would withhold more than the employee earns. This usually " +
      "means basis points were typed into a percent box - 2500 instead of 25.",
    whatToDo:
      "Enter a figure between 0 and 100 exclusive of zero. If the order says 25%, type 25.",
  },
  {
    code: "BAD_ARREARS",
    headline: "The past-due balance could not be read as money",
    whyWeStop:
      "The arrears figure is what makes a balance finite and it feeds the twelve-week question, " +
      "which moves the federal ceiling.",
    whatToDo: "Digits and at most two decimals. Leave it empty if the order states no arrears.",
  },
  {
    code: "ARREARS_NEGATIVE",
    headline: "The past-due balance cannot be negative",
    whyWeStop: "A negative arrears balance would mean the creditor owes the employee.",
    whatToDo:
      "Enter zero, or leave it empty, if there is no past-due amount. If the order shows a credit, " +
      "record that in the notes instead.",
  },
  {
    code: "SUPPORT_NEEDS_SECOND_FAMILY_ANSWER",
    headline: "A support order needs the second-family question answered",
    whyWeStop:
      "It is the difference between a fifty percent ceiling and a sixty percent one. Left blank " +
      "there is no cautious default: guessing one way over-withholds from a real paycheque and " +
      "guessing the other leaves Greenway liable for the shortfall.",
    whatToDo:
      "It is a tick box on the order. If the form does not say, telephone the issuing authority " +
      "with the case number and ask. Note the date and the name of whoever answered.",
  },
  {
    code: "SUPPORT_NEEDS_ARREARS_AGE_ANSWER",
    headline: "A support order needs the twelve-week arrears question answered",
    whyWeStop:
      "It adds five percentage points to the ceiling. Same reasoning as above - there is no safe " +
      "direction to guess in, so the engine refuses instead.",
    whatToDo:
      "Look for the 'arrears greater than 12 weeks' tick box. Ask the issuing authority if it is " +
      "not marked. Do not infer it from the size of the balance.",
  },
  {
    code: "BAD_PRIORITY",
    headline: "The priority could not be read as a number",
    whyWeStop: "Priority decides who gets paid first when a cheque cannot satisfy every order.",
    whatToDo: "Enter a whole number, or leave it empty to accept the default of 100.",
  },
  {
    code: "PRIORITY_NOT_POSITIVE",
    headline: "Priority must be a positive number",
    whyWeStop: "Priority is a rank starting at 1. Zero and negatives have no meaning in a rank.",
    whatToDo: "Support orders should be 1. Leave everything else at the default of 100.",
  },
  {
    code: "NO_EFFECTIVE_FROM",
    headline: "The first affected pay period is missing",
    whyWeStop:
      "Without it the engine cannot tell which pay run this order belongs to, and an order that " +
      "belongs to no pay run withholds nothing while appearing active.",
    whatToDo:
      "Use the start date of the next pay period that has not yet been paid. Do not back-date " +
      "into periods already issued.",
  },
  {
    code: "BAD_EFFECTIVE_FROM",
    headline: "The start date is not a real date",
    whyWeStop: "It is compared against pay period boundaries, so it has to be a genuine date.",
    whatToDo:
      "Enter it as yyyy-mm-dd, using the first day of the next pay period that has not been paid " +
      "yet. If you are unsure which period that is, open the payroll calendar rather than " +
      "estimating - starting in the wrong period either misses a withholding or back-dates into " +
      "a cheque that has already been issued.",
  },
  {
    code: "BAD_EFFECTIVE_TO",
    headline: "The end date is not a real date",
    whyWeStop: "Same reason. An unreadable end date could stop a withholding early or never.",
    whatToDo:
      "Enter yyyy-mm-dd, or leave it empty. Empty is correct for a support order, which continues " +
      "until the issuing authority says otherwise.",
  },
  {
    code: "EFFECTIVE_DATES_REVERSED",
    headline: "The end date is before the start date",
    whyWeStop:
      "The order would cover no pay periods at all, and would sit on the board looking active " +
      "while withholding nothing.",
    whatToDo:
      "Check both. If the intention is to end an order that has already run, do not edit the " +
      "dates - terminate it, which keeps the history intact and records the reason.",
  },
  {
    code: "DUPLICATE_CASE_NUMBER",
    headline: "There is already a live order with this case number for this employee",
    whyWeStop:
      "This is the guard against the most damaging clerical error available here. A writ entered " +
      "twice withholds twice, and the employee has no way to discover it until their rent bounces. " +
      "The database enforces this as well as the form.",
    whatToDo:
      "Open the existing order and compare. If this is an AMENDED order, terminate the old one " +
      "with a note naming the amendment, then enter the new one - that keeps the history rather " +
      "than overwriting it. If it is a duplicate copy of the same writ, no action is needed.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE WALKTHROUGH
 *
 * Michael asked to be told HOW to set one up. This is that answer, in order,
 * as steps rather than as reference material.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type EntryWalkthroughStep = {
  readonly step: number;
  readonly title: string;
  readonly doThis: string;
  readonly whyThisOrder: string;
  readonly authorityIds: readonly string[];
};

export const WAGE_ORDER_ENTRY_WALKTHROUGH: readonly EntryWalkthroughStep[] = [
  {
    step: 1,
    title: "Write the date of service on the envelope, before anything else",
    doThis:
      "The moment the paper arrives, write the date it arrived on it and keep the envelope or the " +
      "delivery receipt with it. Do this before reading the order.",
    whyThisOrder:
      "It is the only fact in the whole process that cannot be recovered later from the document " +
      "itself, and it is the one every deadline is measured from. Everything else can be re-read " +
      "off the paper next week. This cannot.",
    authorityIds: ["wage-order-rcw-26-18-110-answer", "wage-order-rcw-6-27-350-sixty-days"],
  },
  {
    step: 2,
    title: "Answer the order - this is separate from withholding, and it comes first",
    doThis:
      "A support order requires a sworn affidavit within twenty days of service saying whether the " +
      "person works here, whether Greenway will honour the order, and whether other support " +
      "attachments already exist. A creditor writ states its own deadline on its face; find it and " +
      "diary it today.",
    whyThisOrder:
      "This is the step employers skip, and it carries the largest penalty in the area. Failing to " +
      "answer is an INDEPENDENT route to liability - withholding every cent correctly does not " +
      "cure a missing answer. On a creditor writ, not answering lets the court enter judgment " +
      "against Greenway for the full amount the employee owes.",
    authorityIds: [
      "wage-order-rcw-26-18-110-answer",
      "wage-order-rcw-26-18-110-liability",
      "wage-order-rcw-6-27-200-default",
    ],
  },
  {
    step: 3,
    title: "Identify what kind of order it is, from the title",
    doThis:
      "Read the heading on the first page and choose the matching kind on the form. Support, " +
      "creditor, consumer debt, student loan, or a tax levy.",
    whyThisOrder:
      "Every later field means something different depending on this one, and the ceilings differ " +
      "by a factor of two or more.",
    authorityIds: ["wage-order-rcw-26-18-110-remit"],
  },
  {
    step: 4,
    title: "Copy the identifying details exactly",
    doThis:
      "Case number from the caption block, issuing court or agency from the top of the page, " +
      "signature date from the end, service date from the envelope you labelled in step 1.",
    whyThisOrder:
      "These are transcription, not judgement. Doing them together, straight off the paper, is " +
      "how they stay accurate.",
    authorityIds: ["wage-order-rcw-26-18-110-answer"],
  },
  {
    step: 5,
    title: "Enter the payee and the payment identifiers together",
    doThis:
      "Who the cheque is made out to, and every identifier the payment must quote. Copy the " +
      "identifiers verbatim.",
    whyThisOrder:
      "A correct amount to a correct payee with no identifier is not a paid obligation. It sits " +
      "unallocated while the arrears grow.",
    authorityIds: ["wage-order-rcw-26-18-110-remit"],
  },
  {
    step: 6,
    title: "Enter the measure - amount or percentage, never both",
    doThis:
      "If the order states a fixed amount per month, convert it with x 12 / 26 for biweekly pay " +
      "and enter the result. If it states a percentage, type the percentage as printed.",
    whyThisOrder:
      "Halving a monthly figure to get a fortnightly one under-withholds by about eight percent " +
      "every period, all year, on an obligation the employer can be liable for.",
    authorityIds: ["wage-order-rcw-26-18-110-remit"],
  },
  {
    step: 7,
    title: "Answer the two support questions from the paper, or ask",
    doThis:
      "Second family, and arrears older than twelve weeks. If the order does not say, telephone " +
      "the issuing authority with the case number, then record the date and the name of whoever " +
      "answered in the notes.",
    whyThisOrder:
      "Together they move the ceiling from fifty percent to sixty-five. The form refuses to store " +
      "a support order without them precisely because there is no safe direction to guess in.",
    authorityIds: ["wage-order-rcw-26-18-110-remit"],
  },
  {
    step: 8,
    title: "Set the first affected pay period, and the end date only if you know it",
    doThis:
      "Start with the next unpaid pay period. Leave the end date empty for a support order. For a " +
      "creditor writ, expect it to expire about sixty days after service.",
    whyThisOrder:
      "The two order types fail in opposite directions here. An open-ended creditor writ keeps " +
      "taking money after it has legally died; a support order with a guessed end date stops a " +
      "required withholding early.",
    authorityIds: ["wage-order-rcw-6-27-350-sixty-days"],
  },
  {
    step: 9,
    title: "Save, then check the first paycheque by hand",
    doThis:
      "Run the next pay period and read the garnishment lines on that employee's cheque against " +
      "the order. Confirm the disposable-earnings base, the ceiling applied, and the amount taken.",
    whyThisOrder:
      "Every mistake available in this area produces a plausible dollar figure. Nothing crashes " +
      "and nothing looks wrong. One deliberate check of the first cheque catches what no amount of " +
      "re-reading the form will.",
    authorityIds: ["wage-order-rcw-26-18-110-liability"],
  },
  {
    step: 10,
    title: "Deduct the processing fee if you choose to, and never from the order",
    doThis:
      "Washington permits an employer to recover a processing fee from the EMPLOYEE'S remaining " +
      "wages. It is optional. It never reduces what is remitted.",
    whyThisOrder:
      "Taking the fee out of the amount sent to the registry is a short remittance, and short " +
      "remittances are the employer's liability. The fee comes out of what is left of the " +
      "employee's pay, or it is not taken at all.",
    authorityIds: ["wage-order-rcw-26-18-110-fee"],
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  THINGS THAT ARE TRUE AND SURPRISING
 *
 * The things a competent person gets wrong because the wrong answer is the
 * intuitive one.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type EntryScreenLesson = {
  readonly topic: string;
  readonly plainEnglish: string;
  readonly whyItMatters: string;
  readonly authorityIds: readonly string[];
};

export const WAGE_ORDER_ENTRY_SCREEN_LESSONS: readonly EntryScreenLesson[] = [
  {
    topic: "Doing nothing is the expensive mistake, not withholding too much",
    plainEnglish:
      "The instinct on receiving a court order about somebody's wages is to be careful and wait " +
      "until it is understood. That instinct is backwards here. Over-withholding produces a wage " +
      "claim for the difference. Ignoring the order - or merely failing to file the answer - can " +
      "produce a judgment against Greenway for the employee's ENTIRE debt.",
    whyItMatters:
      "The two errors are not the same size and they are not close. One is the difference; the " +
      "other is the whole thing, plus interest, costs and the other side's attorney fees.",
    authorityIds: [
      "wage-order-rcw-6-27-200-default",
      "wage-order-rcw-26-18-110-liability",
    ],
  },
  {
    topic: "Answering and withholding are two separate duties",
    plainEnglish:
      "The answer is a sworn statement filed with the court or agency. The withholding is money " +
      "taken from a paycheque. Doing one perfectly does not discharge the other.",
    whyItMatters:
      "The statute makes failing to answer its own independent trigger for liability. An employer " +
      "who withholds correctly for a year and never filed the answer is still exposed.",
    authorityIds: ["wage-order-rcw-26-18-110-answer", "wage-order-rcw-26-18-110-liability"],
  },
  {
    topic: "A creditor writ dies after sixty days. A support order never does.",
    plainEnglish:
      "A Washington continuing lien on earnings reaches the payroll period ending on or before " +
      "sixty days after the writ's effective date, and then it is finished. A support order runs " +
      "until the issuing authority releases it in writing.",
    whyItMatters:
      "This one asymmetry causes both errors. Withholding under an expired writ is taking an " +
      "employee's money with no legal basis. Stopping a support order because sixty days passed " +
      "leaves Greenway liable for everything not withheld.",
    authorityIds: ["wage-order-rcw-6-27-350-sixty-days"],
  },
  {
    topic: "Compliance protects you; the statute says so explicitly",
    plainEnglish:
      "An employer who withholds and remits as the order directs is not liable to the employee " +
      "for the money that was taken. That protection is written into the statute.",
    whyItMatters:
      "It removes the reason people hesitate. The risk is not in complying with an order that " +
      "later turns out to be wrong - it is in delaying while trying to be sure.",
    authorityIds: ["wage-order-rcw-26-18-110-liability"],
  },
  {
    topic: "You may not discipline or dismiss someone over a garnishment",
    plainEnglish:
      "Firing, refusing to hire, or disciplining an employee because their wages are subject to a " +
      "withholding order is prohibited. Under federal law, discharge for a garnishment arising " +
      "from ONE debt carries a criminal penalty as well as a civil one.",
    whyItMatters:
      "Garnishments create administrative work and it is easy to feel the employee caused it. The " +
      "protection is absolute and the exposure is personal, not merely corporate.",
    authorityIds: [
      "wage-order-rcw-26-18-110-no-retaliation",
      "wage-order-usc-15-1674-discharge",
    ],
  },
  {
    topic: "The processing fee comes from the employee, never out of the remittance",
    plainEnglish:
      "Washington lets an employer recover a small processing fee for the work of withholding. It " +
      "is deducted from the employee's remaining wages. It is optional, and it never reduces the " +
      "amount sent to the payee.",
    whyItMatters:
      "Netting the fee out of the remittance turns an administrative convenience into a short " +
      "payment, and short payments are the employer's liability.",
    authorityIds: ["wage-order-rcw-26-18-110-fee"],
  },
  {
    topic: "Support is paid first when a cheque cannot cover everything",
    plainEnglish:
      "Support orders take precedence over other wage assignments regardless of which arrived " +
      "first.",
    whyItMatters:
      "Paying a creditor writ ahead of a support order because it was served earlier means the " +
      "support obligation is short, and the employer is liable for that shortfall while the money " +
      "has already gone elsewhere.",
    authorityIds: ["wage-order-rcw-26-18-110-priority"],
  },
  {
    topic: "Enter the order even when the employee says it is a mistake",
    plainEnglish:
      "Employees sometimes report that a garnishment is being appealed, was paid, or belongs to " +
      "somebody with a similar name. That may well be true, and it is not the employer's decision " +
      "to make.",
    whyItMatters:
      "The order binds Greenway until the issuing authority modifies or releases it. Suspending a " +
      "withholding on an employee's say-so puts the company in default on a court order. Give them " +
      "the case number and the issuing authority's contact details, and keep complying until " +
      "written notice arrives.",
    authorityIds: ["wage-order-rcw-26-18-110-liability", "wage-order-rcw-26-18-110-remit"],
  },
];
