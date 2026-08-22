/**
 * WAGE ORDER ENTRY AUTHORITIES - the law that governs RECEIVING a garnishment
 * order, not the law that governs computing one.
 *
 * books-38. Michael's instruction for this slice, verbatim (standing rule 1):
 *
 *   "The next question I have is, the child support and garnishment page does
 *    not have a way for me to enter that in. Is it on other page like the
 *    payroll setup page? Please let me know how to use and set up garnishments
 *    and child support with the details from the judgement."
 *
 * He is right, and the gap is worse than it looks. `wage_orders` has existed
 * since migration 0198 with every field a judgement carries, and
 * `garnishment-core.ts` has computed correct ceilings since books-33. But a
 * grep for insert/update/upsert against `wage_orders` across the whole of src/
 * returns exactly one hit, and that hit is a STRING inside a mentor-gate file.
 * There has never been a write path. The engine was a calculator with no keys.
 *
 * WHY THESE SENTENCES AND NOT THE ONES IN garnishment-authorities.ts
 *
 * `garnishment-authorities.ts` (books-33) answers "how much comes out?" - the
 * CCPA ceiling, the support exception, the pay-period conversion, the
 * Washington exemptions. That arithmetic is done and tested.
 *
 * This file answers a completely different set of questions, and they are the
 * ones that actually generate employer liability:
 *
 *   - What must Greenway DO when the paper arrives, and by when?
 *   - What happens if Michael does nothing?
 *   - When does withholding STOP?
 *   - What may Greenway charge for the trouble?
 *   - Which order wins when two arrive for the same person?
 *   - What may Michael NOT do to the employee?
 *
 * Every one of those has a deadline or a penalty attached, and NONE of them is
 * answerable by the garnishment engine, because none of them is arithmetic.
 * That is the whole reason this slice exists as its own registry rather than
 * six more records appended to the old one (rule 25 says EXTEND rather than
 * duplicate - but these are a different SUBJECT, not a duplicate of one).
 *
 * THE ASYMMETRY THAT SHAPES THE ENTIRE SCREEN
 *
 * Read RCW 6.27.200 and RCW 26.18.110(6) together and a pattern appears that
 * every payroll person eventually learns the hard way: the penalties for
 * IGNORING an order are catastrophic and the penalties for over-withholding
 * are merely bad. A creditor writ ignored can become a default judgment
 * against Greenway for the FULL amount of somebody else's debt. A support
 * order ignored can make Greenway liable for 100% of the support debt plus
 * interest and the other side's attorney fees.
 *
 * That asymmetry is exactly why the entry screen is built to make ENTERING an
 * order fast and to make the deadlines impossible to miss, rather than being
 * built to make the arithmetic pretty. The arithmetic was never the dangerous
 * part.
 *
 * STANDING RULE 24: the quote is sacred. Every `quote` below is a
 * character-for-character copy taken from the mirrored source file named in
 * `source`, never retyped from memory. scripts/verify-verbatim-quotes.ts
 * re-reads each one against its corpus on every commit and fails the build on
 * a single character of drift.
 */

export type WageOrderEntryAuthority = {
  readonly id: string;
  readonly kind: "statute" | "state_law";
  readonly cite: string;
  /** Verbatim. Copied from the mirrored corpus, never retyped. */
  readonly quote: string;
  /** What it means for Greenway, in Michael's language. */
  readonly soWhat: string;
  readonly source: string;
};

const USC1674 = "docs/authorities/federal/usc-15-1674.txt";
const RCW2618_110 = "docs/authorities/state-wa/rcw-26.18.110.txt";
const RCW627_200 = "docs/authorities/state-wa/rcw-6.27.200.txt";
const RCW627_350 = "docs/authorities/state-wa/rcw-6.27.350.txt";

/* ------------------------------------------------------------------ *
 * THE CLOCK THAT STARTS THE MOMENT THE PAPER IS HANDED OVER
 * ------------------------------------------------------------------ */

/**
 * TWENTY DAYS, BY SWORN AFFIDAVIT, AND IT IS NOT OPTIONAL.
 *
 * Note what the answer has to disclose: not merely "yes he works here" but
 * whether there are OTHER attachments already running. That last clause is the
 * statute quietly telling the employer it is the only party who can see the
 * whole picture - the court cannot know about the other order, and neither
 * creditor knows about the other.
 */
export const SUPPORT_ORDER_ANSWER_DUTY: WageOrderEntryAuthority = {
  id: "wage-order-rcw-26-18-110-answer",
  kind: "state_law",
  cite: "RCW 26.18.110(1)",
  quote:
    "An employer upon whom service of a wage assignment order or income withholding order has been made shall answer the order by sworn affidavit within twenty days after the date of service. The answer shall state whether the obligor is employed by or receives earnings or other remuneration from the employer, whether the employer will honor the wage assignment order or income withholding order, and whether there are either multiple child support or maintenance attachments, or both, against the obligor.",
  soWhat:
    "Twenty days from the day it is served, and it has to be a SWORN affidavit - not a phone call, not an email to the caseworker. The clock starts on the service date, which is why the entry screen asks for that date and not for the date you got round to opening the envelope. Notice the third thing the answer must disclose: whether this person already has other support attachments running. You are the only party who can see that, because the court cannot and neither creditor can. That is the single most useful reason to keep every order in one place instead of in a folder.",
  source: RCW2618_110,
};

/**
 * WITHHOLD IMMEDIATELY, REMIT WITHIN FIVE WORKING DAYS OF EACH PAY INTERVAL.
 *
 * Two separate deadlines living in one subsection, and people routinely
 * conflate them. Withholding starts on RECEIPT. Remittance is measured from
 * each PAY INTERVAL.
 */
export const SUPPORT_WITHHOLD_AND_REMIT: WageOrderEntryAuthority = {
  id: "wage-order-rcw-26-18-110-remit",
  kind: "state_law",
  cite: "RCW 26.18.110(2)",
  quote:
    "If the employer possesses any earnings or remuneration due and owing to the obligor, the earnings subject to the wage assignment order or income withholding order shall be withheld immediately upon receipt of the wage assignment order or income withholding order. The withheld earnings shall be delivered to the Washington state support registry or, if the wage assignment order is to satisfy a duty of maintenance, to the addressee specified in the assignment within five working days of each regular pay interval.",
  soWhat:
    "Two different clocks in one sentence and they are easy to mix up. WITHHOLDING starts immediately on receipt - not at the start of the next pay period, not once payroll is set up. REMITTANCE is five working days after each regular pay interval. Money you have withheld and not yet sent is not your money and it is not the employee's either; you are holding it as a stakeholder. That is why the entry screen records the effective date separately from the order date, and why a support order entered mid-period is flagged rather than quietly starting next period.",
  source: RCW2618_110,
};

/* ------------------------------------------------------------------ *
 * WHAT HAPPENS IF YOU DO NOTHING - BOTH FLAVOURS
 * ------------------------------------------------------------------ */

/**
 * THE SUPPORT-ORDER PENALTY. 100% OF SOMEBODY ELSE'S DEBT.
 *
 * Read (b) carefully. Failing to ANSWER is its own independent trigger,
 * separate from failing to withhold. An employer who withholds perfectly but
 * never files the affidavit is inside this subsection.
 */
export const SUPPORT_EMPLOYER_LIABILITY: WageOrderEntryAuthority = {
  id: "wage-order-rcw-26-18-110-liability",
  kind: "state_law",
  cite: "RCW 26.18.110(6)",
  quote:
    "An employer who fails to withhold earnings as required by a wage assignment order or income withholding order issued under this chapter may be held liable to the obligee for one hundred percent of the support or maintenance debt, or the amount of support or maintenance moneys that should have been withheld from the employee's earnings whichever is the lesser amount, if the employer: (a) Fails or refuses, after being served with a wage assignment order or income withholding order, to deduct and promptly remit from the unpaid earnings the amounts of money required in the order; (b) Fails or refuses to submit an answer to the notice of wage assignment or income withholding after being served; or (c) Is unwilling to comply with the other requirements of this section.",
  soWhat:
    "This is the sentence that should decide how seriously you treat the envelope. Ignore a support order and Greenway can be made to pay the support debt itself - somebody else's child support - plus costs, interest and their attorney's fees. And look at trigger (b): failing to ANSWER is its own independent route into this liability. You could withhold every penny correctly and still land here by never filing the affidavit. The paperwork is not the administrative part of the job; it IS the job.",
  source: RCW2618_110,
};

/**
 * THE CREDITOR-WRIT PENALTY, AND IT IS ARGUABLY WORSE.
 *
 * A default judgment for the FULL amount claimed by the plaintiff. Not the
 * amount you should have withheld - the whole debt.
 */
export const CREDITOR_WRIT_DEFAULT_JUDGMENT: WageOrderEntryAuthority = {
  id: "wage-order-rcw-6-27-200-default",
  kind: "state_law",
  cite: "RCW 6.27.200",
  quote:
    "If the garnishee fails to answer the writ within the time prescribed in the writ, after the time to answer the writ has expired and after required returns or affidavits have been filed, showing service on the garnishee and service on or mailing to the defendant, it shall be lawful for the court to render judgment by default against such garnishee, after providing a notice to the garnishee by personal service or first-class mail deposited in the mail at least ten calendar days prior to entry of the judgment, for the full amount claimed by the plaintiff against the defendant, or in case the plaintiff has a judgment against the defendant, for the full amount of the plaintiff's unpaid judgment against the defendant with all accruing interest and costs as prescribed in RCW 6.27.090",
  soWhat:
    "In an ordinary creditor garnishment you are the 'garnishee'. Fail to answer the writ on time and the court can enter judgment against GREENWAY for the full amount your employee owes - not the slice you should have withheld from one cheque, the entire debt, with interest and costs. There is a relief valve: move within seven days of the execution writ and it can be cut back. But relief requires you to notice, hire counsel and move fast, all triggered by a notice that arrives at least ten days before judgment. The cheap version of this is answering on time. Note also the deadline is 'the time prescribed in the writ' - it is printed on the paper and it is NOT always twenty days, which is precisely why this system asks you to type the deadline off the document rather than computing one.",
  source: RCW627_200,
};

/* ------------------------------------------------------------------ *
 * WHEN WITHHOLDING STOPS - THE OPPOSITE ERROR
 * ------------------------------------------------------------------ */

/**
 * A CREDITOR WRIT EXPIRES. A SUPPORT ORDER DOES NOT.
 *
 * This is the single most important structural difference between the two
 * kinds, and an employer who treats them the same will make one of two
 * mistakes: stopping a support order that should continue, or continuing a
 * creditor lien that expired sixty days ago.
 */
export const CREDITOR_LIEN_SIXTY_DAYS: WageOrderEntryAuthority = {
  id: "wage-order-rcw-6-27-350-sixty-days",
  kind: "state_law",
  cite: "RCW 6.27.350(1)",
  quote:
    'Where the garnishee\'s answer to a garnishment for a continuing lien reflects that the defendant is employed by the garnishee, the judgment or balance due thereon as reflected on the writ of garnishment shall become a lien on earnings due at the time of the effective date of the writ, as defined in this subsection, to the extent that they are not exempt from garnishment, and such lien shall continue as to subsequent nonexempt earnings until the total subject to the lien equals the amount stated on the writ of garnishment or until the expiration of the employer\'s payroll period ending on or before sixty days after the effective date of the writ, whichever occurs first, except that such lien on subsequent earnings shall terminate sooner if the employment relationship is terminated or if the underlying judgment is vacated, modified, or satisfied in full or if the writ is dismissed. The "effective date" of a writ is the date of service of the writ if there is no previously served writ; otherwise, it is the date of termination of a previously served writ or writs.',
  soWhat:
    "A creditor garnishment is NOT permanent. It runs until the writ amount is collected or until the payroll period ending on or before sixty days after the effective date - whichever comes first. Keep withholding after that and you are taking money you have no authority to take, which is a wage claim under RCW 49.52.050 and reaches you personally. Child support is the opposite: it continues until the court or the registry tells you to stop. Same envelope, same drawer, opposite rules. The last sentence matters too - if a second writ is served while one is running, its clock does not start until the first one ends, so two overlapping writs do not run sixty days each from their own service dates.",
  source: RCW627_350,
};

/* ------------------------------------------------------------------ *
 * WHO WINS WHEN TWO ORDERS ARRIVE FOR THE SAME PERSON
 * ------------------------------------------------------------------ */

/**
 * PRIORITY IS STATUTORY, NOT FIRST-COME-FIRST-SERVED.
 *
 * The intuition that the earliest writ wins is wrong, and acting on it means
 * paying a creditor out of money that belonged to a child.
 */
export const SUPPORT_HAS_PRIORITY: WageOrderEntryAuthority = {
  id: "wage-order-rcw-26-18-110-priority",
  kind: "state_law",
  cite: "RCW 26.18.110(5)",
  quote:
    "An income withholding order for support for a dependent child entered under this chapter shall have priority over any other wage assignment or garnishment, except for another wage assignment or garnishment for child support, or order to withhold and deliver under chapter 74.20A RCW. An order for wage assignment for spousal maintenance entered under this chapter shall have priority over any other wage assignment or garnishment, except for a wage assignment, garnishment, or order to withhold and deliver under chapter 74.20A RCW for support of a dependent child, and except for another wage assignment or garnishment for maintenance.",
  soWhat:
    "Order of arrival is irrelevant. A child-support withholding order outranks every other garnishment, full stop. Spousal maintenance outranks everything except child support. If a creditor writ is already running when a support order lands, the support order goes first and the creditor gets whatever room is left under the ceiling - frequently nothing. Getting this backwards means paying a creditor with money that belonged to a child, and the support obligee can come after Greenway for it under subsection (6). This is why the entry screen sets a support order's priority to 1 by default and makes you type a reason to override it.",
  source: RCW2618_110,
};

/* ------------------------------------------------------------------ *
 * WHAT YOU MAY CHARGE, AND WHAT YOU MAY NOT DO
 * ------------------------------------------------------------------ */

/**
 * THE PROCESSING FEE. TEN DOLLARS, THEN ONE.
 *
 * Small, and quoted because the interesting part is WHERE it comes from: the
 * remainder AFTER withholding, and it is allowed to reach into the exempt
 * portion. Michael gets to decide whether to charge it at all.
 */
export const PROCESSING_FEE: WageOrderEntryAuthority = {
  id: "wage-order-rcw-26-18-110-fee",
  kind: "state_law",
  cite: "RCW 26.18.110(4)",
  quote:
    "The employer may deduct a processing fee from the remainder of the employee's earnings after withholding under the wage assignment order or income withholding order, even if the remainder is exempt under RCW 26.18.090. The processing fee may not exceed (a) ten dollars for the first disbursement made by the employer to the Washington state support registry; and (b) one dollar for each subsequent disbursement to the clerk.",
  soWhat:
    "You MAY charge ten dollars on the first disbursement and one dollar on each one after that. 'May', not must - and given what you have said about how you treat your people, declining to charge it is entirely your call to make. Two technical points if you do charge it: it comes out of what is left AFTER the withholding, and the statute expressly lets it reach into the part of the pay that would otherwise be exempt. Charge more than the statutory cap and you are back inside RCW 49.52.050 territory, which is the unlawful-deduction statute that names officers personally.",
  source: RCW2618_110,
};

/**
 * THE ONE THAT REACHES MICHAEL PERSONALLY, WASHINGTON VERSION.
 *
 * Double damages, fees, a civil penalty per violation, AND reinstatement.
 * Note the scope: discharge, DISCIPLINE, or refuse to hire.
 */
export const NO_RETALIATION_WA: WageOrderEntryAuthority = {
  id: "wage-order-rcw-26-18-110-no-retaliation",
  kind: "state_law",
  cite: "RCW 26.18.110(8)",
  quote:
    "No employer may discharge, discipline, or refuse to hire an employee because of the entry or service of a wage assignment or income withholding order issued and executed under this chapter. If an employer discharges, disciplines, or refuses to hire an employee in violation of this section, the employee or person shall have a cause of action against the employer. The employer shall be liable for double the amount of damages suffered as a result of the violation and for costs and reasonable attorneys' fees, and shall be subject to a civil penalty of not more than two thousand five hundred dollars for each violation. The employer may also be ordered to hire, rehire, or reinstate the aggrieved individual.",
  soWhat:
    "Three verbs, and the middle one catches people who would never dream of firing somebody: discharge, DISCIPLINE, or refuse to hire. Cutting somebody's hours, moving them off a good shift, or passing them over because their wages are being garnished is inside this sentence. The consequences are doubled damages, their attorney's fees, up to $2,500 per violation, and a court can order you to reinstate them. Also read subsection (7) alongside it - an employer who COMPLIES with an order cannot be sued by the employee for wrongful withholding. Between (7) and (8), following the order exactly is the only genuinely safe position.",
  source: RCW2618_110,
};

/**
 * THE FEDERAL FLOOR ON THE SAME QUESTION, AND IT IS CRIMINAL.
 *
 * Narrower than Washington's - it protects only against DISCHARGE, and only
 * for ONE indebtedness - but it carries a prison term, which the state
 * provision does not.
 */
export const NO_DISCHARGE_FEDERAL: WageOrderEntryAuthority = {
  id: "wage-order-usc-15-1674-discharge",
  kind: "statute",
  cite: "15 U.S.C. §1674",
  quote:
    "(a) Termination of employment No employer may discharge any employee by reason of the fact that his earnings have been subjected to garnishment for any one indebtedness. (b) Penalties Whoever willfully violates subsection (a) of this section shall be fined not more than $1,000, or imprisoned not more than one year, or both.",
  soWhat:
    "The federal backstop, and note the words 'imprisoned not more than one year'. This is one of the few genuinely criminal provisions in ordinary payroll. It is NARROWER than Washington's rule - it covers discharge only, not discipline, and only for any ONE indebtedness, so the federal protection thins out for an employee with two separate debts. Washington's RCW 26.18.110(8) is broader and has no such limit. You are subject to both, so plan against the broader one and remember the narrower one is the one with a jail term attached.",
  source: USC1674,
};

/* ------------------------------------------------------------------ *
 * THE REGISTRY
 * ------------------------------------------------------------------ */

export const WAGE_ORDER_ENTRY_AUTHORITIES: readonly WageOrderEntryAuthority[] = [
  SUPPORT_ORDER_ANSWER_DUTY,
  SUPPORT_WITHHOLD_AND_REMIT,
  SUPPORT_EMPLOYER_LIABILITY,
  CREDITOR_WRIT_DEFAULT_JUDGMENT,
  CREDITOR_LIEN_SIXTY_DAYS,
  SUPPORT_HAS_PRIORITY,
  PROCESSING_FEE,
  NO_RETALIATION_WA,
  NO_DISCHARGE_FEDERAL,
];

/** Lookup by id. Returns undefined rather than throwing - callers decide. */
export function findWageOrderEntryAuthority(
  id: string,
): WageOrderEntryAuthority | undefined {
  return WAGE_ORDER_ENTRY_AUTHORITIES.find((a) => a.id === id);
}
