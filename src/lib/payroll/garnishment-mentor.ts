/**
 * src/lib/payroll/garnishment-mentor.ts   (books-35)
 *
 * THE RULE-26 MENTOR LAYER FOR THE GARNISHMENT ENGINE.
 *
 * Books-33 shipped `garnishment-core.ts` with eleven refusal codes, eight
 * exported functions and a twenty-three column table, and explained none of it
 * to the person who has to sign the cheques. This file is that explanation.
 *
 * WHY THIS CORNER OF PAYROLL GETS THE LONGEST LESSONS.
 *
 * Garnishment is the one place in payroll where the EMPLOYER becomes personally
 * liable for arithmetic. Under-withhold on a support order and the shortfall
 * can be collected from Greenway. Over-withhold and it is a wage claim from the
 * employee. There is no safe direction to err in.
 *
 * Worse, there is no way to eyeball a wrong answer. Every wrong garnishment is
 * still a plausible dollar figure. A payroll clerk who subtracts health
 * insurance before computing the base produces a number that looks exactly like
 * a correct number, on a stub that looks exactly like a correct stub, and the
 * error surfaces years later as a demand letter. That is why the lessons below
 * dwell on traps rather than definitions.
 *
 * WHAT LIVES HERE AND WHAT DOES NOT.
 *
 * This file is PURE DATA. It reads no files, touches no database, and imports
 * exactly one thing — a TYPE, which erases at compile time. That is standing
 * rule 65b and it was learned expensively: mixing `node:fs` into a module a
 * client component imports put `node:fs` in a browser bundle and Turbopack
 * refused every deployment while CI stayed green.
 *
 * The gates that PROVE this teaching matches the code — every column taught,
 * every refusal code explained, every authority real — read from disk and
 * therefore live next door in `garnishment-mentor-gates.ts`.
 *
 * STANDING RULE 24 applies to everything quoted here: where a lesson states
 * what a statute says, the statute's own words live in
 * `garnishment-authorities.ts`, character for character from the mirrored
 * corpus, and `scripts/verify-verbatim-quotes.ts` re-reads every one of them
 * against its source on every commit. The lessons below paraphrase for
 * readability and CITE the id, so that Michael can always get from the plain
 * English to the exact sentence Congress wrote.
 */
import type { GarnishmentRefusalCode } from "@/lib/payroll/garnishment-core";

/* ════════════════════════════════════════════════════════════════════════
 * FIELD LESSONS - one per column of wage_orders that holds a decision
 * ════════════════════════════════════════════════════════════════════════ */

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

export const GARNISHMENT_FIELD_LESSONS: readonly FieldLesson[] = [
  {
    field: "wage_orders.order_kind",
    whatItIs:
      "Which of the seven kinds of order this is: child support, spousal support, a plain creditor " +
      "writ, a consumer debt writ, a student loan writ, a federal tax levy or a state tax levy.",
    whereItIsUsed:
      "It is the first thing the engine reads and it selects the entire calculation path. Support " +
      "orders go to supportCap, consumer and student-loan writs go to washingtonExemption with " +
      "different multipliers, and tax levies bypass the CCPA ceiling altogether.",
    whyItMatters:
      "The kind decides the cap, and the caps are nowhere near each other. A creditor writ is held " +
      "to twenty-five percent of disposable earnings. A support order with old arrears and no " +
      "second family can reach sixty-five percent. Filing a support order as a creditor writ " +
      "under-withholds by more than half, and the shortfall is collectable from Greenway.",
    theTrap:
      "Treating a tax levy like any other garnishment. 15 U.S.C. §1673(b)(1) removes IRS and state " +
      "tax levies from the CCPA ceiling entirely — the twenty-five percent limit simply does not " +
      "apply to them. Applying it anyway feels conservative and protective of the employee, but it " +
      "is a failure to honour a levy, which carries its own penalty.",
    howToBeSure:
      "Read the caption of the paper that arrived. A support order says so, usually as 'Income " +
      "Withholding for Support' on the federal OMB form. A tax levy arrives on IRS Form 668-W. " +
      "Everything else is a writ of garnishment from a court, and the writ names the debt type.",
    authorityIds: ["usc-15-1673-max-garnishment", "usc-15-1673-tax-exception"],
  },
  {
    field: "wage_orders.case_number",
    whatItIs:
      "The court's or agency's own identifier for the matter, exactly as it is printed on the order.",
    whereItIsUsed:
      "It appears on every remittance so the receiving office can apply the money to the right " +
      "case, on the pay stub line, and in the unique index that stops the same live order being " +
      "entered twice for one employee.",
    whyItMatters:
      "Money remitted without the right case number is money the court cannot match to a debt. It " +
      "sits unapplied, the employee keeps accruing arrears they have actually paid, and the " +
      "eventual enforcement action lands on somebody who did everything right.",
    theTrap:
      "Tidying it up. Stripping the leading zeros, dropping the hyphens or the two-letter prefix " +
      "because it looks like formatting noise. Those characters are part of the identifier and a " +
      "matching system will not find the case without them.",
    howToBeSure:
      "Copy it character for character from the order, including punctuation and case. If the " +
      "order shows it in more than one place, use the one in the caption at the top.",
    authorityIds: ["rcw-6-27-150-general"],
  },
  {
    field: "wage_orders.issuing_authority",
    whatItIs:
      "Who issued the order — the named court, the state child support agency, or the taxing " +
      "authority. Not the creditor, and not their law firm.",
    whereItIsUsed:
      "Shown on the wage order screen so Michael can tell at a glance whether an instruction to " +
      "stop or change withholding came from the body with the power to give it.",
    whyItMatters:
      "Only the issuing authority can modify or release the order. A creditor's attorney phoning " +
      "to say the debt is settled is not a release, however credible they sound. Withholding stops " +
      "when a paper arrives from the body named in this field, and this field is how you check.",
    theTrap:
      "Recording the creditor. On a consumer-debt writ the creditor's name is in the biggest type " +
      "on the page and the court's name is in small type at the top. The engine does not care, but " +
      "the human deciding whether to honour a release call does, and this is the field they read.",
    howToBeSure:
      "It is the body named in the caption at the very top of the order, above the parties. If the " +
      "document is a support order, it is the court or the agency, never the custodial parent.",
    authorityIds: ["rcw-6-27-150-general"],
  },
  {
    field: "wage_orders.order_date",
    whatItIs:
      "The date the court or agency signed the order. A historical fact about the document.",
    whereItIsUsed:
      "Displayed alongside effective_from on the order screen, and used when two orders of the " +
      "same kind compete, because the older order is generally satisfied first.",
    whyItMatters:
      "It is the tiebreaker of last resort and the audit anchor. If anyone later asks why Greenway " +
      "began withholding when it did, the answer is a comparison between this date, the date it " +
      "was served, and the first pay period it affected.",
    theTrap:
      "Confusing it with the date it arrived in the mail or the date it was entered here. They are " +
      "usually different by days or weeks, and the order date is the only one printed on the " +
      "document itself.",
    howToBeSure:
      "It is next to the judge's or officer's signature at the end of the order, not on the " +
      "envelope and not on the cover letter.",
    authorityIds: ["rcw-6-27-150-general"],
  },
  {
    /**
     * books-38. The single most consequential date in this table, and until
     * migration 0201 it had nowhere to live. Read the lesson beside
     * `order_date` first: these two are neighbours that get confused, and the
     * confusion is expensive in both directions.
     */
    field: "wage_orders.served_date",
    whatItIs:
      "The date the order or writ was handed to GREENWAY. Not the date the judge signed it - " +
      "that is order_date, directly above - and not the date you typed it in here. It is the day " +
      "the paper legally arrived at the company.",
    whereItIsUsed:
      "It drives the two clocks that decide whether Greenway is in trouble. The answer deadline " +
      "on a support order runs twenty days from this date. The sixty-day life of a creditor writ " +
      "is measured from this date, because the statute defines the writ's 'effective date' as the " +
      "date of service. The garnishment board sorts by it, so the order closest to its deadline " +
      "sits at the top of the screen.",
    whyItMatters:
      "Everything Greenway can be punished for is measured from this day rather than from the " +
      "signature. Use the signature date by mistake and the arithmetic is confidently wrong in " +
      "whichever direction happens to hurt: on an order that took three weeks to arrive the " +
      "screen declares the answer already overdue the morning you open the envelope, and on one " +
      "that arrived quickly it shows a deadline LATER than the real one while you read it and " +
      "relax. The second is the one that costs money, because nothing looks wrong.",
    theTrap:
      "Leaving it until later because the withholding maths does not need it. The maths does not, " +
      "and the deadlines do. Missing the ANSWER on a support order is its own separate route to " +
      "liability for the entire support debt - withholding every cent correctly does not cure a " +
      "missing answer. On a creditor writ, not answering in time lets the court enter judgment " +
      "against Greenway for the full amount the employee owes. Not the slice that should have " +
      "been withheld from a paycheck: the whole of somebody else's debt, against the company.",
    howToBeSure:
      "Read it off the evidence of delivery, never off the order itself: the process server's " +
      "return, the certified-mail card, the date stamp on the envelope, or the received stamp if " +
      "someone at the shop applied one. If nobody can establish it, the system will not guess a " +
      "date for you and neither should you - it is the number two statutes measure from. Find " +
      "the envelope.",
    authorityIds: [
      "wage-order-rcw-26-18-110-answer",
      "wage-order-rcw-6-27-350-sixty-days",
      "wage-order-rcw-6-27-200-default",
    ],
  },
  {
    /*
     * books-40c. The OFF SWITCH.
     *
     * This column is the reason the deadline reminders can exist at all. A
     * warning that cannot be satisfied is a warning that gets muted, and a
     * muted warning protects nobody - so before building anything that nags
     * about the answer deadline, there had to be a way to say "done".
     */
    field: "wage_orders.answer_filed_at",
    whatItIs:
      "The date you actually sent the sworn answer back. Blank means it has not been done yet, " +
      "and blank is the only thing that keeps the reminders coming.",
    whereItIsUsed:
      "It is the switch that turns the answer reminders off. While it is blank the system counts " +
      "the days from the service date and escalates - quiet at first, then a warning, then a " +
      "daily alert once the deadline has passed. Fill it in and all of that stops immediately " +
      "for this order.",
    whyItMatters:
      "Answering and RECORDING that you answered are two different acts, and only the second one " +
      "is visible to anybody else. If you file the answer and never note it here, the system " +
      "keeps shouting at you about something you already did - and the real damage is not the " +
      "noise, it is that you learn to ignore the alert. The next order, the one you genuinely " +
      "forgot, arrives into a channel you have already decided is wrong.",
    theTrap:
      "Putting the date you FILLED IN the form rather than the date you sent it. The deadline is " +
      "about when the answer left Greenway. Also: do not backdate it to make an overdue order " +
      "look tidy. If it went late, record when it actually went - a late answer honestly dated " +
      "is a far better position than a false record, and the database will refuse any date " +
      "earlier than the service date anyway.",
    howToBeSure:
      "Use the proof you kept when you sent it: the certified-mail receipt, the fax confirmation, " +
      "or the timestamp on the portal submission. Keep that proof with the order. If you cannot " +
      "produce evidence that the answer was sent, treat it as not sent and answer it again today.",
    authorityIds: ["wage-order-rcw-26-18-110-answer", "wage-order-rcw-6-27-200-default"],
  },
  {
    field: "wage_orders.answer_filed_note",
    whatItIs:
      "A short free-text note about how the answer went out - who signed it, how it was sent, and " +
      "anything unusual that happened.",
    whereItIsUsed:
      "Nothing calculates from it. It sits with the order so that a year from now, when somebody " +
      "asks what Greenway did about this case, the answer is written down instead of remembered.",
    whyItMatters:
      "The value of this field only appears when there is a dispute, which is exactly when memory " +
      "is worth nothing. 'Mailed certified 1/18, receipt in the payroll binder, signed by " +
      "Michael' is evidence. 'I am fairly sure we sent it' is not.",
    theTrap:
      "Treating it as optional because nothing breaks when it is empty. Nothing breaks today. It " +
      "breaks in eighteen months when the only person who remembers has left.",
    howToBeSure:
      "Write it while you are sending the answer, not afterwards. One sentence is enough: what " +
      "went, how it went, and where the proof is filed.",
    authorityIds: ["wage-order-rcw-26-18-110-answer"],
  },
  {
    /*
     * Deliberately awkward to use, and the lesson says so. See migration 0202.
     */
    field: "wage_orders.answer_not_required",
    whatItIs:
      "A tick that means this particular order genuinely has no Washington answer duty, so the " +
      "reminders should never start. It is NOT a snooze button.",
    whereItIsUsed:
      "Ticking it silences the answer reminders for this order permanently, in the same way that " +
      "recording an answer date does.",
    whyItMatters:
      "It is true for some orders and dangerous for others. A federal tax levy on IRS Form 668-W " +
      "is not answered by a sworn affidavit to a Washington court - you complete the exemption " +
      "certificate and begin withholding, and that is the whole duty. The same is broadly true " +
      "of a student-loan administrative garnishment, which runs under its own federal procedure. " +
      "For those, a twenty-day RCW 26.18 countdown would be inventing an obligation. But tick it " +
      "on a child-support order and you have switched off the alarm on the one obligation where " +
      "failing to answer makes Greenway liable for the ENTIRE support debt.",
    theTrap:
      "Using it to make a nagging alert go away on a busy day. That is why it is deliberately " +
      "awkward: the system will not accept the tick without a written reason, and it refuses it " +
      "outright on child-support and spousal-support orders. If you find yourself wanting to " +
      "tick this to get some quiet, the honest move is to answer the order instead.",
    howToBeSure:
      "Ask one question: does a Washington court or the state registry expect a sworn answer from " +
      "Greenway on this paper? Support orders and creditor writs, yes. Tax levies, no. If you " +
      "are not certain, do not tick it - answer the order, which is never the wrong thing to do.",
    authorityIds: ["wage-order-rcw-26-18-110-answer", "wage-order-rcw-6-27-200-default"],
  },
  {
    field: "wage_orders.answer_waived_reason",
    whatItIs:
      "The written reason why the tick above is correct. The database will not accept the tick " +
      "without at least a few words here.",
    whereItIsUsed:
      "Stored with the order and shown wherever the exemption is displayed, so the decision is " +
      "always visible next to its justification rather than as a bare tick.",
    whyItMatters:
      "An unexplained waiver looks exactly like a mistake, and in a year nobody - including you - " +
      "will be able to tell which it was. Requiring the sentence also slows the decision down by " +
      "about ten seconds, which is precisely the point: it converts a reflex click into a small " +
      "act of judgement.",
    theTrap:
      "Typing 'n/a' or 'not needed'. That is not a reason, it is a restatement of the tick, and " +
      "the field is length-checked specifically to make that answer inconvenient.",
    howToBeSure:
      "Name the document and the rule in one line - for example 'IRS Form 668-W levy: satisfied " +
      "by returning the exemption certificate, no ch. 26.18 answer duty'. If you cannot write " +
      "that sentence, you do not yet know that the waiver is correct.",
    authorityIds: ["wage-order-rcw-26-18-110-answer"],
  },
  {
    field: "wage_orders.payee_name",
    whatItIs:
      "Who the cheque is actually made out to. Very often this is NOT the person owed the money.",
    whereItIsUsed:
      "It is printed on the remittance and drives the payable that the pay run creates.",
    whyItMatters:
      "Support money in Washington generally goes to the Washington State Support Registry, not to " +
      "the custodial parent, even though the parent is who the money is for. Paying the parent " +
      "directly is a well-meant mistake that does not discharge the obligation: as far as the " +
      "registry is concerned nothing was paid, and Greenway can be asked to pay it again.",
    theTrap:
      "Reading the order for who benefits rather than who is paid. The order names the child and " +
      "the custodial parent prominently, and names the registry in the remittance instructions.",
    howToBeSure:
      "Look for the payment section of the order, headed something like 'send payments to'. That " +
      "name, exactly, goes here.",
    authorityIds: ["rcw-26-18-090-fifty-percent"],
  },
  {
    field: "wage_orders.payee_address",
    whatItIs: "Where the payment is physically or electronically sent.",
    whereItIsUsed:
      "Carried onto the remittance advice and the payable, so the person cutting the cheque never " +
      "has to go back to the paper order.",
    whyItMatters:
      "Money sent to the wrong office of the right agency is as unapplied as money sent to the " +
      "wrong agency. It takes months to trace, and while it is being traced the employee is in " +
      "arrears on paper for a debt they have already had taken from their pay.",
    theTrap:
      "Using the court's street address because it is the most prominent one on the page. The " +
      "remittance address is frequently a lockbox in a different city and sometimes a different " +
      "state.",
    howToBeSure:
      "Take it from the same payment section that gave you the payee name, never from the caption " +
      "or the letterhead.",
    authorityIds: ["rcw-26-18-090-fifty-percent"],
  },
  {
    field: "wage_orders.remittance_instructions",
    whatItIs:
      "Free text for anything the receiving office requires that does not fit in a name and an " +
      "address — an EFT routing requirement, a required reference format, a payment frequency.",
    whereItIsUsed:
      "Shown to whoever processes the payment, next to the amount, at the moment they process it.",
    whyItMatters:
      "This is the field that stops institutional knowledge living in one person's head. When the " +
      "person who has always handled the registry payments is on holiday, the instruction has to " +
      "be on the record or the payment goes out wrong.",
    theTrap:
      "Leaving it empty because the requirement seems obvious to whoever is entering it today. " +
      "Obvious-to-me is exactly the knowledge that disappears when staff change.",
    howToBeSure:
      "Copy anything the order says about HOW to pay, as opposed to whom and how much. If the " +
      "order says nothing, leaving this blank is correct and honest.",
    authorityIds: ["rcw-6-27-150-general"],
  },
  {
    field: "wage_orders.amount_cents_per_period",
    whatItIs:
      "A fixed sum, in cents, that the order demands from each pay period. One of the two possible " +
      "measures, and it is null whenever the order is expressed as a percentage instead.",
    whereItIsUsed:
      "computeOneOrder reads it as the amount REQUESTED, before any cap. What is actually withheld " +
      "is the lesser of this and the lawful maximum.",
    whyItMatters:
      "A fixed amount is a demand, not a permission. If the cap allows less, the cap wins and the " +
      "difference becomes a shortfall that the engine reports rather than hides. Withholding the " +
      "full demanded amount because the order 'says so' is how employers end up defending a wage " +
      "claim for taking more than the law allows.",
    theTrap:
      "The period mismatch. Support orders are very often written as a MONTHLY figure while " +
      "Greenway pays biweekly, twenty-six times a year. Entering the monthly figure here " +
      "withholds it twenty-six times instead of twelve — a little over twice the correct annual " +
      "amount, taken from someone who cannot afford it.",
    howToBeSure:
      "Read the period stated on the order, then convert to a biweekly figure: monthly × 12 ÷ 26. " +
      "Many support orders helpfully print the biweekly equivalent themselves — if it is there, " +
      "use theirs rather than your own arithmetic.",
    authorityIds: ["cfr-870-10-longer-period", "usc-15-1673-support-cap"],
  },
  {
    field: "wage_orders.percent_of_disposable_basis_points",
    whatItIs:
      "The other possible measure: a percentage of disposable earnings, held in basis points, so " +
      "2500 means twenty-five percent and 10000 means one hundred percent.",
    whereItIsUsed:
      "computeOneOrder multiplies it by disposable earnings to get the requested amount, then " +
      "applies the caps to that.",
    whyItMatters:
      "Basis points exist here for the same reason cents do everywhere else in this system: to " +
      "avoid floating point. Twenty-five percent stored as 0.25 and multiplied by a large " +
      "disposable figure can land a cent away from the right answer, and a cent that moves when " +
      "nothing changed is a cent nobody can reconcile.",
    theTrap:
      "Entering 25 and meaning twenty-five percent. Twenty-five basis points is one quarter of one " +
      "percent — the order would collect almost nothing, silently, for as long as it took somebody " +
      "to notice. The database constraint permits 1 to 10000, so 25 is perfectly legal and " +
      "perfectly wrong.",
    howToBeSure:
      "Multiply the percentage on the order by one hundred. Twenty-five percent is 2500. Fifty " +
      "percent is 5000. If the number you are about to type is smaller than 100, stop and check.",
    authorityIds: ["usc-15-1673-max-garnishment"],
  },
  {
    field: "wage_orders.arrears_cents",
    whatItIs:
      "The total past-due balance the order states, in cents. Informational: the engine never " +
      "withholds this amount.",
    whereItIsUsed:
      "Shown on the order screen so Michael can see roughly how long the order is likely to run, " +
      "and read alongside arrears_over_twelve_weeks, which is the field that actually changes the " +
      "arithmetic.",
    whyItMatters:
      "It is the context that makes the rest of the order make sense. An order with a large arrears " +
      "balance and a small periodic amount will run for years, and knowing that in advance is the " +
      "difference between planning and being surprised.",
    theTrap:
      "Assuming that because a large arrears figure is recorded, the engine will collect it faster. " +
      "It will not. The periodic amount is what is collected; the arrears total changes nothing " +
      "except through the separate twelve-week question.",
    howToBeSure:
      "Take it from the arrears or past-due line on the order as at the order date, and do not try " +
      "to keep it current — it is a snapshot, and the registry keeps the running balance.",
    authorityIds: ["usc-15-1673-support-cap"],
  },
  {
    field: "wage_orders.arrears_over_twelve_weeks",
    whatItIs:
      "A yes, a no, or an unanswered question: is any part of the arrears more than twelve weeks " +
      "old? Nullable ON PURPOSE, so that 'nobody has asked yet' is a state the system can hold.",
    whereItIsUsed:
      "supportCap reads it and adds five percentage points to the cap when it is true.",
    whyItMatters:
      "Five points of disposable earnings on every cheque, indefinitely. On a thousand dollars of " +
      "disposable pay that is fifty dollars a period, thirteen hundred a year, taken or not taken " +
      "from someone already behind on a support obligation.",
    theTrap:
      "Treating the unanswered state as a no. It is the obvious default — most orders have no old " +
      "arrears — and it is exactly the assumption standing rule 62d forbids. The engine refuses " +
      "with SUPPORT_MISSING_ARREARS_ANSWER instead, because a refusal gets answered and a wrong " +
      "default never gets revisited.",
    howToBeSure:
      "The withholding order normally states it in the same box as the arrears balance. If it truly " +
      "does not, ring the issuing agency and quote the case number; do not infer it from the size " +
      "of the balance.",
    authorityIds: ["usc-15-1673-support-cap"],
  },
  {
    field: "wage_orders.supports_second_family",
    whatItIs:
      "Whether this employee is also supporting another spouse or dependent child, beyond the one " +
      "this order is for. Also nullable, for the same deliberate reason.",
    whereItIsUsed:
      "supportCap reads it first: true sets the cap at fifty percent, false sets it at sixty.",
    whyItMatters:
      "This single yes-or-no is worth ten percentage points of disposable earnings. It is the " +
      "largest swing produced by any one field in the whole payroll system, and it is a question " +
      "about the employee's private life that nobody at Greenway can answer by looking at them.",
    theTrap:
      "The intuition runs backwards. Supporting a second family gives the LOWER cap, fifty percent " +
      "rather than sixty, because the law is protecting the second household too. Guessing from " +
      "first principles produces the wrong answer about as often as the right one.",
    howToBeSure:
      "The federal income withholding order has a box for it. Where it is genuinely blank, ask the " +
      "employee and note the date and the answer — the database will not accept a support order " +
      "without this recorded, which is intentional.",
    authorityIds: ["usc-15-1673-support-cap"],
  },
  {
    field: "wage_orders.priority",
    whatItIs:
      "A small whole number saying which order is satisfied first when one paycheque cannot satisfy " +
      "them all. Lower is earlier. Defaults to 100.",
    whereItIsUsed:
      "computeAllOrders sorts by the KIND first and only then by this number, so priority breaks " +
      "ties within a kind rather than overriding the statutory ordering.",
    whyItMatters:
      "When the money runs out, whoever is last gets nothing. Federal law puts support ahead of " +
      "everything, and the sort respects that regardless of what is typed here — so this field " +
      "cannot be used, accidentally or otherwise, to pay a creditor ahead of a child.",
    theTrap:
      "Believing this number alone controls the order of payment. Setting a creditor writ to " +
      "priority 1 does not move it ahead of a support order, and the fact that nothing visibly " +
      "changes is the point rather than a bug.",
    howToBeSure:
      "Leave the default unless a court has expressly ordered a particular sequence among orders " +
      "of the same kind. If a court has, quote it in the notes field.",
    authorityIds: ["usc-15-1673-support-cap", "rcw-26-18-090-apportion-equally"],
  },
  {
    field: "wage_orders.effective_from",
    whatItIs:
      "The first date this order can take money from a paycheque. Not the order date and not the " +
      "date it was entered.",
    whereItIsUsed:
      "The pay run only picks up orders whose effective window covers the pay period being run.",
    whyItMatters:
      "Withholding one period too early takes money the employer had no authority to take, which " +
      "is a wage claim. Withholding one period too late is a missed obligation on a support order. " +
      "Both are visible on the stub and both are avoidable by getting this date right once.",
    theTrap:
      "Backdating it to the order date so the arrears 'catch up'. Greenway has no authority to " +
      "collect for periods before service, and self-help catch-up withholding is precisely the " +
      "conduct that turns a compliant employer into a defendant.",
    howToBeSure:
      "Use the first pay period that begins after the order was served, unless the order names a " +
      "date itself, in which case use the order's date.",
    authorityIds: ["rcw-6-27-150-general"],
  },
  {
    field: "wage_orders.effective_to",
    whatItIs:
      "The last date the order can take money, or null when the order runs until somebody stops it.",
    whereItIsUsed:
      "The same pay-run filter. A period beginning after this date sees no order at all. The " +
      "database refuses a value earlier than effective_from.",
    whyItMatters:
      "Continuing to withhold after an order has expired is taking money with no authority, and " +
      "the employee usually notices before the employer does. A dated end that the system enforces " +
      "is better than a reminder somebody has to remember to act on.",
    theTrap:
      "Filling it in with a guess at when the debt will be paid off. Most writs end when the " +
      "balance is satisfied, which is a fact the receiving office knows and Greenway does not. " +
      "Null is the honest answer for an open-ended order.",
    howToBeSure:
      "Set it only where the order itself names an end date. Otherwise leave it null and terminate " +
      "the order through status when the release arrives.",
    authorityIds: ["rcw-6-27-150-general"],
  },
  {
    field: "wage_orders.status",
    whatItIs:
      "Whether the order is active, suspended, or terminated. Active is the only value that causes " +
      "money to move.",
    whereItIsUsed:
      "The pay-run filter, and the unique index that allows only one ACTIVE order per employee per " +
      "case number.",
    whyItMatters:
      "Suspended and terminated are deliberately different. Suspended is a pause that keeps the " +
      "order visible and easy to resume; terminated is an ending that requires a written reason. " +
      "Collapsing them into a single delete would destroy the record of a legal obligation, which " +
      "is why nothing in this system deletes a wage order at all.",
    theTrap:
      "Terminating an order on a phone call. A release is a document from the issuing authority. " +
      "Suspend it if there is a genuine dispute, and terminate only when the paper arrives.",
    howToBeSure:
      "Terminate when a release or satisfaction has been received and filed. Suspend when the " +
      "employee is on unpaid leave or the order is being contested.",
    authorityIds: ["rcw-6-27-150-general"],
  },
  {
    field: "wage_orders.termination_note",
    whatItIs:
      "The written reason an order was terminated. The database requires at least five characters " +
      "whenever status is terminated.",
    whereItIsUsed:
      "Stored with the order forever and shown whenever a terminated order is opened.",
    whyItMatters:
      "The question 'why did we stop withholding on this case' arrives years later, from an agency, " +
      "and it arrives to whoever is doing the job then rather than whoever made the decision. A " +
      "one-line reason written at the time is the entire defence.",
    theTrap:
      "Writing 'done' or 'finished' to satisfy the five-character minimum. The constraint can " +
      "check the length but it cannot check the meaning, and a note that says nothing is a note " +
      "that will not help anyone.",
    howToBeSure:
      "Name the document that authorised the ending and its date: 'Release of garnishment received " +
      "14 March, filed with the order.'",
    authorityIds: ["rcw-6-27-150-general"],
  },
  {
    field: "wage_orders.notes",
    whatItIs:
      "Free text for anything about this order that the structured fields cannot hold.",
    whereItIsUsed:
      "Displayed on the order screen. Never read by the engine and never used in a calculation.",
    whyItMatters:
      "It is where a court's unusual instruction goes — an express priority sequence, an agreed " +
      "variation, a phone conversation with the registry. The engine ignores it precisely so that " +
      "nothing typed here can quietly change a number.",
    theTrap:
      "Putting a substantive instruction here and expecting it to be honoured. A note saying " +
      "'withhold only 20%' does nothing at all. If it changes the money, it belongs in a " +
      "structured field or it does not happen.",
    howToBeSure:
      "Ask whether the note is meant to change an amount. If it is, find the field that holds it. " +
      "If there is no such field, that is a conversation to have before the next pay run.",
    authorityIds: ["rcw-6-27-150-general"],
  },
];

export function taughtGarnishmentFieldNames(): readonly string[] {
  return GARNISHMENT_FIELD_LESSONS.map((l) => l.field);
}

/* ════════════════════════════════════════════════════════════════════════
 * SCREEN LESSONS - the ideas, not the fields
 * ════════════════════════════════════════════════════════════════════════ */

export type ScreenLesson = {
  readonly topic: string;
  readonly plainEnglish: string;
  readonly whyItMatters: string;
  readonly authorityIds: readonly string[];
};

export const GARNISHMENT_SCREEN_LESSONS: readonly ScreenLesson[] = [
  {
    topic: "Disposable earnings is not take-home pay",
    plainEnglish:
      "Disposable earnings means gross pay minus the deductions the law REQUIRES you to make — " +
      "income tax, Social Security, Medicare, and mandatory state items. Health insurance, " +
      "retirement contributions, union dues and a uniform deduction are all voluntary in this " +
      "sense, however automatic they look on a stub, and none of them come off the base.",
    whyItMatters:
      "This is the single most common error in the whole field and it always errs the same way. " +
      "Subtracting voluntary deductions makes the base smaller, makes the garnishment smaller, and " +
      "leaves the employer holding the difference on a support order. The engine reports the " +
      "voluntary deductions it deliberately did NOT subtract, so the arithmetic can be checked " +
      "rather than trusted.",
    authorityIds: ["usc-15-1672-disposable"],
  },
  {
    topic: "The employee always gets whichever rule protects them more",
    plainEnglish:
      "Federal law sets one ceiling and Washington sets another. They are not alternatives to " +
      "choose between and Washington does not simply override the federal rule. The engine works " +
      "out both, every time, and takes the smaller permitted withholding.",
    whyItMatters:
      "Picking the state rule because we are in Washington, or the federal rule because it is " +
      "federal, produces the right answer perhaps half the time. Which one binds depends on the " +
      "employee's actual pay: at low wages the protected floor dominates, at higher wages the " +
      "percentage does. Computing both costs nothing and removes the judgement call entirely.",
    authorityIds: ["usc-15-1673-max-garnishment", "rcw-6-27-150-general"],
  },
  {
    topic: "The protected floor is weekly, and Greenway pays biweekly",
    plainEnglish:
      "The federal ceiling protects the first thirty times the minimum wage each WEEK. Greenway's " +
      "pay periods cover two weeks, so the floor has to be multiplied by the number of workweeks " +
      "in the period before it means anything.",
    whyItMatters:
      "Using the weekly floor on a biweekly cheque protects half as much as the law requires and " +
      "takes roughly twice the lawful amount. This is why the engine refuses outright with " +
      "NO_WORKWEEK_COUNT rather than assuming two: the assumption is right almost always, and the " +
      "'almost' is a final cheque covering one week, which is exactly the cheque somebody is most " +
      "likely to need.",
    authorityIds: ["cfr-870-10-longer-period"],
  },
  {
    topic: "Below the floor, nothing at all may be taken",
    plainEnglish:
      "If disposable earnings for the period do not exceed the protected floor, the lawful " +
      "garnishment is zero. Not a reduced amount, not a token payment — zero.",
    whyItMatters:
      "There is a strong instinct to take something, because an order is sitting there unpaid and " +
      "taking nothing feels like ignoring a court. It is not. Zero IS compliance on that cheque, " +
      "the shortfall is reported rather than concealed, and the order continues against the next " +
      "one. Taking a token amount from someone below the floor is unlawful.",
    authorityIds: ["cfr-870-10-below-floor"],
  },
  {
    topic: "Support orders are not held to twenty-five percent",
    plainEnglish:
      "The familiar twenty-five percent ceiling is for ordinary creditors. Support orders run on " +
      "their own scale: fifty percent if the employee supports another spouse or dependent child, " +
      "sixty percent if not, and five points more on top if any arrears are over twelve weeks old.",
    whyItMatters:
      "Fifty, fifty-five, sixty or sixty-five percent — four possible answers decided by two " +
      "yes-or-no questions, and the difference between the outermost two is fifteen percent of " +
      "disposable earnings. Applying the creditor ceiling to a support order under-withholds by " +
      "more than half, and on support orders the employer is liable for the shortfall.",
    authorityIds: ["usc-15-1673-support-cap"],
  },
  {
    topic: "Tax levies ignore the ceiling completely",
    plainEnglish:
      "A federal or state tax levy is expressly carved out of the CCPA limits. The twenty-five " +
      "percent ceiling does not restrict it, and the amount left to the employee is set by the " +
      "levy's own exempt-amount table rather than by the garnishment rules.",
    whyItMatters:
      "Applying the CCPA ceiling to a levy feels cautious and employee-friendly, and it is a " +
      "failure to honour the levy. The exempt-amount table for levies is a separate piece of work " +
      "that this engine does not yet do, which is why the levy path is walled off and refuses " +
      "loudly rather than producing a confident wrong number.",
    authorityIds: ["usc-15-1673-tax-exception"],
  },
  {
    topic: "Washington's exemptions differ by debt type, and consumer debt is not creditor debt",
    plainEnglish:
      "Washington protects more than the federal floor does, and how much more depends on what " +
      "the debt is. A private student loan writ leaves eighty-five percent and fifty times the " +
      "state minimum wage. A consumer debt writ leaves eighty percent and thirty-five times. An " +
      "ordinary creditor writ leaves seventy-five percent and thirty-five times the federal wage.",
    whyItMatters:
      "Three similar-looking writs, three different exemptions, and the difference is real money " +
      "every period. Note too that the student-loan and consumer-debt calculations use the STATE " +
      "minimum wage while the ordinary creditor calculation uses the FEDERAL one — the engine " +
      "refuses rather than substituting one for the other when the needed figure is missing.",
    authorityIds: [
      "rcw-6-27-150-consumer-debt",
      "rcw-6-27-150-student-loan",
      "rcw-6-27-150-general",
    ],
  },
  {
    topic: "Competing maintenance orders are split equally, not proportionally",
    plainEnglish:
      "When two spousal maintenance orders compete for pay that will not cover both, Washington " +
      "divides the available money EQUALLY between them. Not in proportion to what each one asks " +
      "for, which is what almost everyone assumes.",
    whyItMatters:
      "Proportional splitting is the intuitive answer and it is wrong. An order asking for nine " +
      "hundred and an order asking for three hundred get six hundred each, not nine hundred and " +
      "three hundred scaled down. If an obligee thinks that is unfair the remedy is a court order " +
      "reapportioning it, and never an adjustment made here.",
    authorityIds: ["rcw-26-18-090-apportion-equally"],
  },
  {
    topic: "Maintenance has its own fifty percent rule",
    plainEnglish:
      "Spousal maintenance wage assignments in Washington are capped at fifty percent of " +
      "disposable earnings, and the ordinary garnishment exemption in RCW 6.27.150 is expressly " +
      "disapplied to them.",
    whyItMatters:
      "Maintenance sits awkwardly between support and ordinary debt, and the temptation is to " +
      "treat it as one or the other. It is neither: it takes the fifty percent cap without the " +
      "second-family and arrears adjustments that child support gets, and without the RCW 6.27.150 " +
      "exemption that a creditor writ gets.",
    authorityIds: ["rcw-26-18-090-fifty-percent"],
  },
  {
    topic: "A shortfall is reported, never carried forward on its own initiative",
    plainEnglish:
      "When an order asks for more than the caps allow, the engine withholds the lawful maximum " +
      "and records the difference as a shortfall. It does not quietly add it to the next cheque.",
    whyItMatters:
      "Self-help catch-up withholding is unlawful — the caps apply to every cheque individually, " +
      "and last period's shortfall does not create room in this one. The shortfall exists so that " +
      "Michael can see it and, where it persists, tell the issuing agency, which is the only body " +
      "that can do anything about it.",
    authorityIds: ["usc-15-1673-max-garnishment"],
  },
  {
    topic: "Every number on the screen arrives with the sentence that produced it",
    plainEnglish:
      "The engine returns an explanation with every result: what the disposable figure was, which " +
      "of the competing ceilings actually bound, and why. The explanation is part of the answer " +
      "rather than decoration on top of it.",
    whyItMatters:
      "A garnishment figure with no reasoning cannot be checked by anybody, including the person " +
      "who produced it. The engine even decides WHICH rule bound before rounding, because just " +
      "below a crossover point two rounded figures can tie and the resulting sentence would name " +
      "the wrong reason on a cheque where the amount happened to be right.",
    authorityIds: ["usc-15-1673-max-garnishment", "cfr-870-10-below-floor"],
  },
];

/* ════════════════════════════════════════════════════════════════════════
 * REFUSAL LESSONS - every code the engine can emit
 * ════════════════════════════════════════════════════════════════════════ */

export type RefusalLesson = {
  readonly code: GarnishmentRefusalCode;
  /** One line, for a banner. */
  readonly headline: string;
  /** Why refusing beats computing anyway. */
  readonly whyWeStop: string;
  /** What Michael actually does about it. */
  readonly whatToDo: string;
};

export const GARNISHMENT_REFUSAL_LESSONS: readonly RefusalLesson[] = [
  {
    code: "NO_FEDERAL_MINIMUM_WAGE",
    headline: "The federal minimum wage for this pay period is not on file",
    whyWeStop:
      "The protected floor is thirty times the federal minimum wage, so without that figure there " +
      "is no floor, and without a floor every garnishment computed would take too much from the " +
      "lowest-paid people on the payroll.",
    whatToDo:
      "Record the federal minimum wage effective for this pay period in the wage table. It has " +
      "been $7.25 since 2009, but it is stored rather than assumed so that the day it changes, " +
      "nothing silently keeps using the old figure.",
  },
  {
    code: "NO_STATE_MINIMUM_WAGE",
    headline: "The Washington minimum wage for this pay period is not on file",
    whyWeStop:
      "Consumer-debt and student-loan exemptions are measured against the STATE minimum wage, not " +
      "the federal one. Substituting the federal figure would compute a much smaller exemption and " +
      "take money Washington protects.",
    whatToDo:
      "Enter the Washington minimum wage for the year of this pay period. L&I publishes the " +
      "following year's rate at the end of September, and it changes every single year.",
  },
  {
    code: "NEGATIVE_GROSS",
    headline: "This paycheque has negative or missing gross pay",
    whyWeStop:
      "There is nothing sensible to garnish from. Any percentage of a negative number is a " +
      "negative garnishment, which would pay money INTO the employee's cheque from a creditor.",
    whatToDo:
      "Look at the pay run itself rather than the order. A negative gross almost always means a " +
      "correction was entered in the wrong direction and the garnishment is not the problem.",
  },
  {
    code: "WITHHOLDING_EXCEEDS_GROSS",
    headline: "The required withholding on this cheque is larger than the gross pay",
    whyWeStop:
      "Disposable earnings would be negative, which cannot be right. Computing a garnishment from " +
      "a nonsense base produces a confident number that is wrong in a way nobody can spot later.",
    whatToDo:
      "Check the tax lines on this pay run before touching any order. Something upstream is wrong " +
      "and the garnishment engine is only the first thing to notice it.",
  },
  {
    code: "NO_WORKWEEK_COUNT",
    headline: "Nobody has said how many workweeks this cheque covers",
    whyWeStop:
      "The protected floor is a weekly figure that must be multiplied up. Using the weekly number " +
      "on a two-week cheque takes about twice what the law allows.",
    whatToDo:
      "Set the number of workweeks on the pay period — two for a normal biweekly period. It is " +
      "asked rather than assumed because final cheques and mid-period starts genuinely cover one.",
  },
  {
    code: "ORDER_HAS_NO_MEASURE",
    headline: "This order says neither an amount nor a percentage",
    whyWeStop:
      "There is nothing to compute. An order with no measure cannot be guessed at from the arrears " +
      "balance or from what similar orders usually say.",
    whatToDo:
      "Open the paper order and find the amount or percentage it demands, then record it. If the " +
      "order genuinely states neither, ring the issuing authority before the next pay run.",
  },
  {
    code: "ORDER_HAS_TWO_MEASURES",
    headline: "This order has both a fixed amount and a percentage",
    whyWeStop:
      "Two measures mean two different answers with no rule for choosing, and choosing the smaller " +
      "would be a policy invented here rather than one the court ordered.",
    whatToDo:
      "Read the order again and keep only the measure it actually states. The database enforces " +
      "exactly one, so this usually means an edit set the second without clearing the first.",
  },
  {
    code: "SUPPORT_MISSING_SECOND_FAMILY_ANSWER",
    headline: "Nobody has recorded whether this employee supports another family",
    whyWeStop:
      "That one answer is the difference between fifty and sixty percent of disposable earnings. " +
      "Guessing it either shortchanges the order, which can land on Greenway, or takes ten percent " +
      "too much from someone's cheque.",
    whatToDo:
      "Read it off the withholding order, which has a box for it, or ask the employee. Then record " +
      "it on the wage order — the database will not accept a support order without it.",
  },
  {
    code: "SUPPORT_MISSING_ARREARS_ANSWER",
    headline: "Nobody has recorded whether any arrears are over twelve weeks old",
    whyWeStop:
      "That answer adds five percentage points to the cap. Defaulting it to no would be the " +
      "cheaper assumption, and assuming in the employer's favour on a support order is exactly how " +
      "an employer ends up liable for the difference.",
    whatToDo:
      "The withholding order normally states it alongside the arrears balance. Record the answer " +
      "on the wage order rather than inferring it from the size of the balance.",
  },
  {
    code: "PERCENT_OUT_OF_RANGE",
    headline: "The percentage on this order is outside the range that can be meant",
    whyWeStop:
      "A percentage at or below zero withholds nothing while looking like an active order, and one " +
      "above one hundred percent of disposable earnings cannot be honoured at all.",
    whatToDo:
      "Check the basis points. Twenty-five percent is 2500, not 25 — the commonest cause of a " +
      "figure that looks legal and collects nearly nothing.",
  },
  {
    code: "UNKNOWN_ORDER_KIND",
    headline: "This kind of order does not belong on the path that was asked for",
    whyWeStop:
      "Child support and tax levies do not run through the ordinary Washington exemption at all. " +
      "Returning a zero exemption for them would be a silent wrong answer rather than a visible " +
      "stop, and silent wrong answers in garnishment are the expensive kind.",
    whatToDo:
      "Do not adjust the order — the order is probably fine. This means the pay run called the " +
      "wrong path for the kind, which is a code defect. Tell the developer and show them the case " +
      "number.",
  },
];

/* ════════════════════════════════════════════════════════════════════════
 * THE REVIEW CHECKLIST - the order a human should think in
 * ════════════════════════════════════════════════════════════════════════ */

export type GarnishmentReviewCheckKey =
  | "disposable-first"
  | "what-the-order-asks"
  | "which-cap-governs"
  | "both-ceilings-then-the-kinder"
  | "floor-can-make-it-zero"
  | "priority-and-apportionment";

export type GarnishmentReviewCheck = {
  readonly key: GarnishmentReviewCheckKey;
  readonly order: number;
  readonly question: string;
  readonly whyThisOrder: string;
  readonly howToCheck: string;
  readonly ifItFails: string;
  readonly authorityIds: readonly string[];
};

export const GARNISHMENT_REVIEW_CHECKS: readonly GarnishmentReviewCheck[] = [
  {
    key: "disposable-first",
    order: 1,
    question: "What are the disposable earnings on this cheque?",
    whyThisOrder:
      "Every cap that follows is a percentage of this number, so getting it wrong makes every " +
      "later step wrong by the same proportion while each step still looks internally consistent.",
    howToCheck:
      "Gross pay less the withholding the law REQUIRES. Confirm that health insurance, retirement " +
      "and any uniform deduction were not subtracted — the engine lists what it deliberately " +
      "ignored, so this can be read rather than recalculated.",
    ifItFails:
      "Stop and fix the pay run. Nothing downstream of a wrong disposable figure is worth checking.",
    authorityIds: ["usc-15-1672-disposable"],
  },
  {
    key: "what-the-order-asks",
    order: 2,
    question: "What does the order actually demand this period?",
    whyThisOrder:
      "The request is compared against the caps, so it has to be known before any cap means " +
      "anything. It is also where the period-conversion error hides.",
    howToCheck:
      "Either a fixed amount or a percentage of disposable, never both. If the order is written " +
      "monthly, confirm it was converted to biweekly at twelve twenty-sixths and not simply " +
      "copied across.",
    ifItFails:
      "Correct the measure on the wage order. Do not let the pay run proceed on a monthly figure " +
      "in a biweekly field.",
    authorityIds: ["cfr-870-10-longer-period"],
  },
  {
    key: "which-cap-governs",
    order: 3,
    question: "What kind of order is this, and therefore which cap applies?",
    whyThisOrder:
      "The kind selects the whole calculation path. Asking it after computing a ceiling means " +
      "possibly having computed the wrong ceiling.",
    howToCheck:
      "Support runs on the fifty-to-sixty-five scale, tax levies are outside the CCPA ceiling " +
      "entirely, and everything else runs the federal ceiling against the Washington exemption.",
    ifItFails:
      "Correct the order kind before anything else. Every number already on the screen was " +
      "produced by the wrong rule.",
    authorityIds: ["usc-15-1673-support-cap", "usc-15-1673-tax-exception"],
  },
  {
    key: "both-ceilings-then-the-kinder",
    order: 4,
    question: "Were both the federal ceiling and the Washington exemption computed?",
    whyThisOrder:
      "Once the path is known, both limits can be worked out — and they must both be worked out, " +
      "because which one binds is not predictable from the kind of order alone.",
    howToCheck:
      "The explanation names which limit bound and why. Confirm the state figures used the STATE " +
      "minimum wage where the rule calls for it, and the federal figure where it does not.",
    ifItFails:
      "If only one was computed, the answer is not trustworthy even if it happens to be right. " +
      "The employee is entitled to whichever rule protects them more.",
    authorityIds: ["usc-15-1673-max-garnishment", "rcw-6-27-150-general"],
  },
  {
    key: "floor-can-make-it-zero",
    order: 5,
    question: "Do disposable earnings actually exceed the protected floor?",
    whyThisOrder:
      "This is asked after the ceilings because it can override all of them. However large the " +
      "order, nothing may be taken from a cheque at or below the floor.",
    howToCheck:
      "The floor is thirty times the federal minimum wage multiplied by the workweeks in the " +
      "period — sixty times for Greenway's biweekly cheques, not thirty.",
    ifItFails:
      "Withhold nothing. Zero is the compliant answer, the shortfall is reported, and the order " +
      "continues against the next cheque. Do not take a token amount.",
    authorityIds: ["cfr-870-10-below-floor", "cfr-870-10-longer-period"],
  },
  {
    key: "priority-and-apportionment",
    order: 6,
    question: "If there is more than one order, who gets paid and in what proportion?",
    whyThisOrder:
      "Last, because it only arises once each order's own lawful maximum is known. Sequencing " +
      "before capping would apportion money that was never available.",
    howToCheck:
      "Support outranks everything by federal law regardless of the priority numbers. Competing " +
      "maintenance orders split the available money EQUALLY, not in proportion to what each asks.",
    ifItFails:
      "If a creditor writ was paid ahead of a support order, stop the pay run. If maintenance was " +
      "split proportionally, that is the intuitive answer and the wrong one.",
    authorityIds: ["rcw-26-18-090-apportion-equally", "rcw-26-18-090-fifty-percent"],
  },
];
