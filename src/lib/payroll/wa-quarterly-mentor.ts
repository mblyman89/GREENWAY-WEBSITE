/**
 * src/lib/payroll/wa-quarterly-mentor.ts   (books-41)
 *
 * THE CPA WHO SITS BESIDE MICHAEL WHILE HE READS THE FORMS.
 *
 * WHY THIS FILE EXISTS, VERBATIM (standing rule 1)
 *
 *   "Add all the verbatim text, add the mentor and the guidance, the examples
 *    and helpers and the PhD level cpa to hold my hand. The forms are an
 *    important step and I really want to make sure I understand everything
 *    that is happening on the forms in plain english."
 *
 * Michael has a Master's in accounting he has not used in thirteen years. He
 * does not need to be told what a liability is. What he needs is the thing a
 * textbook never gives you: for THIS box, on THIS form, what number goes in it,
 * where that number came from, who the money actually belongs to, and what goes
 * wrong if it is wrong. That is what §2 of this file is - a box-by-box reading
 * of all four Washington returns.
 *
 * THE ORGANISING IDEA: THREE WAYS OF COUNTING ONE QUARTER
 *
 * If a reader takes one thing from this file, it should be this. Washington
 * measures the same three months in three incompatible ways, and almost every
 * mistake on these returns comes from carrying an intuition from one to
 * another:
 *
 *   - Unemployment counts WAGES, caps them per person per year, and the
 *     employer pays every cent.
 *   - Paid Leave and WA Cares count WAGES too, but one caps and one does not,
 *     and the money is the employees', merely passed through.
 *   - L&I counts HOURS. A raise does not change this return at all.
 *
 * CLIENT SAFETY. This module is DATA. It imports nothing that touches the file
 * system or the database, so a "use client" component can render it directly.
 * The coverage gates that read source files live in
 * `wa-quarterly-mentor-gates.ts` and are imported only by tests.
 */

import {
  ALL_WA_QUARTER_REFUSAL_CODES,
  type WaQuarterFormId,
  type WaQuarterRefusalCode,
  type WhoseMoney,
} from "@/lib/payroll/wa-quarterly-core";

/* ══════════════════════════════════════════════════════════════════════════
 * §1  THE FOUR FORMS, AND WHY THERE ARE FOUR
 * ══════════════════════════════════════════════════════════════════════════ */

export type WaFormGuide = {
  readonly form: WaQuarterFormId;
  /** What the form is actually called, so it can be recognised on a screen. */
  readonly officialName: string;
  readonly agency: string;
  /** One sentence: what this form is FOR. */
  readonly purpose: string;
  /** What it is charged on. The single most confusable fact across the four. */
  readonly chargedOn: string;
  /** The thing people get wrong about this specific form. */
  readonly commonMistake: string;
  readonly authorityIds: readonly string[];
};

export const WA_FORM_GUIDES: readonly WaFormGuide[] = [
  {
    form: "esd_5208a",
    officialName: "Form 5208A - Quarterly Tax Report",
    agency: "Washington Employment Security Department (filed in EAMS)",
    purpose:
      "Reports one number for the whole business - total wages paid in the quarter - and " +
      "applies your unemployment tax rate to it. This is the form that produces a bill.",
    chargedOn:
      "Wages, capped per person per year at the unemployment wage base ($78,200 for 2026). " +
      "Once somebody passes that ceiling their later wages stop being taxable, which is why " +
      "this return usually shrinks through the year even when payroll does not.",
    commonMistake:
      "Treating the 0.40% on the rate notice as one tax. It is two: 0.37% unemployment " +
      "insurance and a 0.03% Employment Administration Fund surcharge, and they are rounded " +
      "separately. Applying 0.40% in one go to Greenway's Q2 2026 wages gives $275.69; the two " +
      "lines rounded separately give the $275.70 that was actually assessed.",
    authorityIds: [
      "wac-192-310-010-tax-report",
      "rcw-50-24-010-rounding",
      "rcw-50-24-014-eaf-account-a",
      "rcw-50-24-014-eaf-account-b",
    ],
  },
  {
    form: "esd_5208b",
    officialName: "Form 5208B - Quarterly Wage Detail Report",
    agency: "Washington Employment Security Department (filed in EAMS)",
    purpose:
      "Lists every person you paid, one row each. It produces no bill of its own - it is how " +
      "the state knows whose earnings to credit if that person later claims unemployment.",
    chargedOn:
      "Nothing. This report is information, not money. It must nevertheless agree with the " +
      "5208A: the wages on these rows have to add up to the single total on the tax report.",
    commonMistake:
      "Thinking hours are optional because no tax is charged on them here. WAC " +
      "192-310-010(3)(b) requires total hours worked for every person, and the same hour count " +
      "is what L&I charges real money on. An hour missed here is an hour missed there.",
    authorityIds: ["wac-192-310-010-wage-detail"],
  },
  {
    form: "pfml_wa_cares",
    officialName: "Paid Family & Medical Leave and WA Cares quarterly report",
    agency: "Washington Employment Security Department (a separate system from EAMS)",
    purpose:
      "Reports two employee-funded premiums that happen to be collected together. Almost all " +
      "of the money on this return was already taken out of paycheques; the business is " +
      "handing it on, not paying it.",
    chargedOn:
      "Wages - but the two premiums do not agree on which wages. Paid Leave stops at the " +
      "Social Security wage base; WA Cares has no ceiling whatsoever and is charged on every " +
      "dollar.",
    commonMistake:
      "Collapsing Paid Leave into a single rate on wages. It is a percentage OF a percentage: " +
      "the premium is 1.13% of wages, and the employees pay 71.43% OF THAT PREMIUM. Multiplying " +
      "wages by one blended number does not reproduce the filed figure.",
    authorityIds: [
      "rcw-50a-10-030-wage-cap",
      "rcw-50a-10-030-agent-and-trust",
      "rcw-50a-10-030-small-employer",
      "wa-cares-uncapped",
    ],
  },
  {
    form: "lni_quarterly",
    officialName: "L&I Quarterly Report (workers' compensation premium)",
    agency: "Washington Department of Labor & Industries",
    purpose:
      "Reports hours worked in each risk classification and pays the workers' compensation " +
      "premium. This is insurance against workplace injury, priced by exposure to it.",
    chargedOn:
      "HOURS. Not wages - wages appear nowhere in the calculation. Greenway has one risk " +
      "class, 6403, so the whole return is one hour count times one rate.",
    commonMistake:
      "Expecting this return to move when pay moves. Give everyone a raise and the three ESD " +
      "numbers all rise while this one does not change by a cent. The reverse trap is worse: " +
      "cut hours and this falls, so an hours error here is invisible against the wage figures " +
      "that would normally catch it.",
    authorityIds: [
      "wac-296-17-31021-unit-of-exposure",
      "wac-296-17-31021-salaried",
      "wac-296-17-31023-no-payroll",
      "rcw-51-16-140-lni-deduction",
    ],
  },
] as const;

export function waFormGuide(form: WaQuarterFormId): WaFormGuide | undefined {
  return WA_FORM_GUIDES.find((g) => g.form === form);
}

/* ══════════════════════════════════════════════════════════════════════════
 * §2  EVERY BOX ON EVERY FORM, IN PLAIN ENGLISH
 *
 * This is the section Michael asked for by name. One entry per box that
 * carries a number, each answering the same five questions in the same order,
 * so that reading the second box is easier than reading the first.
 * ══════════════════════════════════════════════════════════════════════════ */

export type BoxExplainer = {
  /** Ties this box to the engine line of the same id. */
  readonly lineId: string;
  readonly form: WaQuarterFormId;
  /** The label as the form prints it. */
  readonly boxLabel: string;
  /** WHAT number goes here. */
  readonly whatGoesHere: string;
  /** WHERE it comes from - which record in this system produced it. */
  readonly whereItComesFrom: string;
  /** WHOSE money it is. Carried as data, not prose, so the screen cannot blur it. */
  readonly whoseMoney: WhoseMoney;
  /** WHY that matters - the legal consequence of the ownership. */
  readonly whyOwnershipMatters: string;
  /** WHAT GOES WRONG if this box is wrong, stated concretely. */
  readonly ifItIsWrong: string;
  /** The Q2 2026 figure, so every explanation has a real number attached. */
  readonly q2_2026Example: string;
  readonly authorityIds: readonly string[];
};

export const WA_BOX_EXPLAINERS: readonly BoxExplainer[] = [
  {
    lineId: "esd-ui",
    form: "esd_5208a",
    boxLabel: "UI tax due",
    whatGoesHere:
      "Your unemployment insurance rate multiplied by the quarter's taxable wages. The rate is " +
      "specific to Greenway - ESD calculates it from your own history of former staff claiming " +
      "benefits and mails it every December. It is not a rate you can look up.",
    whereItComesFrom:
      "Taxable wages come from the pay runs for the quarter, capped per person at the annual " +
      "wage base. The rate comes from the dated rate registry, which holds the figure read off " +
      "your ESD tax rate notice for account 000-073905-00-0.",
    whoseMoney: "employer_cost",
    whyOwnershipMatters:
      "RCW 50.24.010 does not merely discourage passing this on to staff - it says any such " +
      "deduction 'shall be unlawful'. There is no consent form that makes it acceptable.",
    ifItIsWrong:
      "Too low and ESD assesses the difference with interest under RCW 50.24.040 and a penalty " +
      "under RCW 50.12.220. Too high and you have simply overpaid, and getting it back means " +
      "an amended return. The likeliest error is not arithmetic at all: it is using last year's " +
      "rate because the December notice was never entered.",
    q2_2026Example:
      "$68,923.45 x 0.37% = $255.016765, which the half-cent rule rounds to $255.02. That is " +
      "exactly what was filed, under confirmation G2413C8A6HP330LL.",
    authorityIds: ["rcw-50-24-010-no-deduction", "rcw-50-24-010-rounding", "esd-suta-rate-structure"],
  },
  {
    lineId: "esd-eaf",
    form: "esd_5208a",
    boxLabel: "EAF tax due",
    whatGoesHere:
      "The Employment Administration Fund surcharge - 0.03% of the same taxable wages. It pays " +
      "for running the unemployment system rather than for benefits themselves.",
    whereItComesFrom:
      "The same taxable wage figure as the line above. The 0.03% is two statutory accounts " +
      "added together: 0.02% under RCW 50.24.014(1)(a) and 0.01% under (1)(b).",
    whoseMoney: "employer_cost",
    whyOwnershipMatters:
      "RCW 50.24.014(2)(a) carries its own copy of the no-deduction rule and its own word " +
      "'unlawful'. Small surcharge, identical legal treatment.",
    ifItIsWrong:
      "It is small enough to be waved through, which is the danger. A wrong EAF makes the total " +
      "disagree with what ESD assessed, and reconciling a $0.30 difference three quarters later " +
      "costs far more than getting it right now.",
    q2_2026Example:
      "$68,923.45 x 0.03% = $20.677035, rounded to $20.68 by its own statute's half-cent rule.",
    authorityIds: [
      "rcw-50-24-014-eaf-account-a",
      "rcw-50-24-014-eaf-account-b",
      "rcw-50-24-014-eaf-no-deduction-and-rounding",
    ],
  },
  {
    lineId: "esd-total",
    form: "esd_5208a",
    boxLabel: "Total due",
    whatGoesHere: "The two lines above, added after each has been rounded on its own.",
    whereItComesFrom:
      "Nothing new - it is arithmetic on the two boxes above. But the ORDER is not cosmetic.",
    whoseMoney: "employer_cost",
    whyOwnershipMatters:
      "This is the figure that leaves the bank account, and every cent of it is company money. " +
      "Neither part of it may be deducted from anybody's pay: RCW 50.24.010 says an employer " +
      "attempting to do so is guilty of a misdemeanour, and RCW 50.24.014(2)(b) applies the same " +
      "prohibition to the EAF portion. There is no consent form that makes it lawful.",
    ifItIsWrong:
      "The classic failure is rounding once instead of twice. It produces a figure one cent " +
      "below what ESD assessed, the payment does not clear the balance, and the account shows " +
      "as delinquent over a cent - which is enough to attract a notice.",
    q2_2026Example:
      "$255.02 + $20.68 = $275.70, which is what was paid. Applying the combined 0.40% in one " +
      "step gives $275.6938, which rounds to $275.69 - a cent short of the actual assessment.",
    authorityIds: ["rcw-50-24-010-rounding", "rcw-50-24-014-eaf-no-deduction-and-rounding"],
  },
  {
    lineId: "pfml-employee",
    form: "pfml_wa_cares",
    boxLabel: "Paid Leave premiums withheld from employees",
    whatGoesHere:
      "The Paid Family and Medical Leave money already taken out of paycheques during the " +
      "quarter. Two steps: work out the whole premium on wages, then take the employees' share " +
      "of that premium.",
    whereItComesFrom:
      "Wages from the pay runs, capped at the Social Security wage base. The 1.13% premium rate " +
      "and the 71.43% employee share both come from the dated rate registry, and both are reset " +
      "by ESD every year.",
    whoseMoney: "employee_money",
    whyOwnershipMatters:
      "RCW 50A.10.030(7)(b) makes Greenway the AGENT of its employees for this money, and " +
      "subsection (9) says it is held in trust. It is never available to the business, even " +
      "briefly. This is the state-level twin of the federal trust-fund rule.",
    ifItIsWrong:
      "Withhold too much and you owe the staff a refund, individually, with a wage-payment " +
      "problem attached. Withhold too little and the premium is still owed - you simply cannot " +
      "go back and take extra from a past paycheque without running into RCW 49.52.050.",
    q2_2026Example:
      "$68,923.45 x 1.13% = $778.83 of premium; 71.43% of $778.83 = $556.32. Note that " +
      "collapsing it to a single blended rate does not land on $556.32.",
    authorityIds: [
      "rcw-50a-10-030-agent-and-trust",
      "rcw-50a-10-030-wage-cap",
      "esd-pfml-2026-rate-announcement",
    ],
  },
  {
    lineId: "pfml-employer",
    form: "pfml_wa_cares",
    boxLabel: "Employer Medical + Employer Family",
    whatGoesHere:
      "Greenway's own share of the Paid Leave premium - which for Greenway is $0.00, because a " +
      "business with fewer than fifty Washington employees is not required to pay it.",
    whereItComesFrom:
      "The small-employer relief in RCW 50A.10.030(5)(a), applied to the size ESD determined on " +
      "30 September from the average of four quarter-end headcounts.",
    whoseMoney: "employer_cost",
    whyOwnershipMatters:
      "If it were owed it would be a genuine company cost, not a withholding - so it must never " +
      "be recovered from staff by adjusting their share upward.",
    ifItIsWrong:
      "A zero here looks like something was forgotten, so the reason must travel with the " +
      "number. The real risk is drift: cross fifty employees and this stops being zero from the " +
      "following January, and nothing on the payroll screen will announce that.",
    q2_2026Example:
      "$0.00 filed. Had it been owed, it would have been 28.57% of the $778.83 premium = " +
      "$222.51 - which is the size of the exposure if the headcount test is ever missed.",
    authorityIds: ["rcw-50a-10-030-small-employer", "rcw-50a-10-030-size-test"],
  },
  {
    lineId: "wa-cares",
    form: "pfml_wa_cares",
    boxLabel: "Total WA Cares premiums",
    whatGoesHere:
      "The long-term care premium: 0.58% of gross wages, all of it employee money, with no " +
      "wage ceiling of any kind.",
    whereItComesFrom:
      "Gross wages for the quarter - the same $68,923.45 the ESD tax report uses - and the " +
      "0.58% rate from the registry. Some employees hold exemptions, which is a per-person fact " +
      "and not something to net off the total by hand.",
    whoseMoney: "employee_money",
    whyOwnershipMatters:
      "Every cent was withheld from staff. The business is a conduit, exactly as with Paid " +
      "Leave.",
    ifItIsWrong:
      "The trap is applying the Paid Leave wage cap to it. WA Cares has no cap, so capping it " +
      "under-collects from anyone above the Social Security base - and because the two premiums " +
      "sit side by side on the same return and use the same wage definition, this is an easy " +
      "and entirely silent error.",
    q2_2026Example: "$68,923.45 x 0.58% = $399.76 exactly, with no cap applied to anybody.",
    authorityIds: ["wa-cares-uncapped", "rcw-50b-04-080-wa-cares"],
  },
  {
    lineId: "lni-hours",
    form: "lni_quarterly",
    boxLabel: "Hours reported, risk class",
    whatGoesHere:
      "The total hours worked in the quarter, in each risk classification. Greenway has one " +
      "class - 6403, specialty grocery retail - so there is one figure.",
    whereItComesFrom:
      "The time clock, via the timesheets for the quarter. The same total must appear on the " +
      "5208B wage detail; if the two returns disagree about hours, one of them is wrong.",
    whoseMoney: "shared",
    whyOwnershipMatters:
      "Hours are not money, but they determine money on both sides: employer premium and the " +
      "employee share that RCW 51.16.140 allows to be withheld.",
    ifItIsWrong:
      "This is the highest-leverage number on any of the four returns, because it is the only " +
      "one no wage figure can cross-check. Wrong hours means a wrong premium, a wrong employee " +
      "deduction, and a wage detail that disagrees with the L&I filing.",
    q2_2026Example: "3,558 hours across ten people, matching the 5208B exactly.",
    authorityIds: ["wac-296-17-31021-unit-of-exposure", "rcw-51-16-035-lni-classification"],
  },
  {
    lineId: "lni-employee",
    form: "lni_quarterly",
    boxLabel: "Employee share withheld",
    whatGoesHere:
      "Hours times the employee's hourly rate from the L&I rate notice. For Greenway in 2026 " +
      "that is $0.16445 per hour.",
    whereItComesFrom:
      "The rate notice for account 521,756-00, held in the registry to five decimal places " +
      "because that is how the state quotes it.",
    whoseMoney: "employee_money",
    whyOwnershipMatters:
      "RCW 51.16.140 expressly permits withholding this portion. It is one of the few payroll " +
      "deductions Washington affirmatively allows, and only up to the rate on the notice.",
    ifItIsWrong:
      "Deriving this rate instead of reading it is a known, expensive mistake - this system " +
      "once computed it as half the medical aid rate and produced $0.067185 per hour against a " +
      "true $0.16445. It never derives it now.",
    q2_2026Example: "3,558 hours x $0.16445 = $585.11 withheld from staff across the quarter.",
    authorityIds: ["rcw-51-16-140-lni-deduction", "lni-premium-rate-formula"],
  },
  {
    lineId: "lni-employer",
    form: "lni_quarterly",
    boxLabel: "Employer share",
    whatGoesHere: "Hours times the employer's hourly rate, $0.39485 for Greenway in 2026.",
    whereItComesFrom: "The same L&I rate notice. Read, never derived.",
    whoseMoney: "employer_cost",
    whyOwnershipMatters:
      "The larger half of workers' compensation is a company cost. RCW 51.16.140(1) lets an " +
      "employer deduct only the employee's stated half from wages, which means this half may " +
      "not be deducted or otherwise recovered from staff at all - not by withholding it, and " +
      "not by quietly reducing pay to offset it. Deducting more than the notice allows is the " +
      "error to guard against, because the employee rate and the employer rate arrive on the " +
      "same piece of paper and are easy to transpose.",
    ifItIsWrong:
      "An error here is a straight over- or under-payment of premium, and L&I audits hours " +
      "against payroll records. Transposing the two halves is worse than a simple miscount: it " +
      "under-pays L&I and over-deducts from every employee at the same time, so one mistake " +
      "creates both a premium liability and a wage claim.",
    q2_2026Example: "3,558 hours x $0.39485 = $1,404.88.",
    authorityIds: ["lni-premium-rate-formula", "rcw-51-16-060-lni-hours", "rcw-51-16-140-lni-deduction"],
  },
  {
    lineId: "lni-premium",
    form: "lni_quarterly",
    boxLabel: "Amount owed",
    whatGoesHere:
      "The full workers' compensation premium for the quarter: hours times the combined rate " +
      "of $0.5593 per hour.",
    whereItComesFrom:
      "Hours from the time clock; the combined rate is the employee and employer rates on the " +
      "notice added together, which is how L&I bills it.",
    whoseMoney: "shared",
    whyOwnershipMatters:
      "Part of this was already taken from staff and part is company money. The split matters " +
      "for the books even though one payment leaves the bank.",
    ifItIsWrong:
      "Not filing at all is worse than filing wrong. WAC 296-17-31023 says L&I will estimate " +
      "the premium and pursue it, and an estimate made without your hours will not favour you.",
    q2_2026Example:
      "3,558 x $0.5593 = $1,989.99 exactly, filed under confirmation 12616784. Note the whole " +
      "return never mentions the $68,923.45 of wages.",
    authorityIds: ["wac-296-17-31023-no-payroll", "lni-premium-rate-formula"],
  },
] as const;

export function boxExplainer(lineId: string): BoxExplainer | undefined {
  return WA_BOX_EXPLAINERS.find((b) => b.lineId === lineId);
}

export function boxExplainersForForm(form: WaQuarterFormId): readonly BoxExplainer[] {
  return WA_BOX_EXPLAINERS.filter((b) => b.form === form);
}

/* ══════════════════════════════════════════════════════════════════════════
 * §3  THE CHECKLIST - WHAT TO DO, IN ORDER
 * ══════════════════════════════════════════════════════════════════════════ */

export type WaQuarterCheck = {
  readonly key: string;
  readonly order: number;
  readonly title: string;
  /** What to actually do. An instruction, not a topic. */
  readonly doThis: string;
  /** How you know it is done - a checkable condition, not a feeling. */
  readonly doneWhen: string;
  /** What it costs to skip it. */
  readonly ifSkipped: string;
  /**
   * The authorities behind this step.
   *
   * Present so that a checklist item is never merely somebody's opinion about
   * good practice: every instruction here can be traced to the rule that makes
   * it necessary, and the coverage gate proves each id resolves.
   */
  readonly authorityIds: readonly string[];
};

export const WA_QUARTER_CHECKS: readonly WaQuarterCheck[] = [
  {
    key: "rates-current",
    order: 1,
    title: "Check this year's rate notices are entered",
    doThis:
      "Find the ESD tax rate notice and the L&I rate notice for the current year - both arrive " +
      "in December - and confirm the figures on the rate screen match them.",
    doneWhen:
      "The unemployment rate, the EAF rate and both L&I hourly rates all show the current " +
      "year's dates, and the rate screen refuses nothing.",
    ifSkipped:
      "Every figure on all four returns is computed at last year's prices. This is the single " +
      "most common way a quarterly filing goes wrong, and it produces a return that looks " +
      "entirely reasonable.",
    authorityIds: ["esd-suta-rate-structure", "esd-pfml-2026-rate-announcement", "lni-premium-rate-formula"],
  },
  {
    key: "hours-complete",
    order: 2,
    title: "Confirm the hours are complete before anything else",
    doThis:
      "Check that every timesheet in the quarter is approved and that nobody shows wages with " +
      "zero hours. If anyone is salaried, confirm which reporting method is in force for ALL " +
      "salaried people.",
    doneWhen:
      "The total hours figure is stable and equals what you would get by adding the approved " +
      "timesheets by hand.",
    ifSkipped:
      "Hours drive the entire L&I premium and no wage figure can catch an error in them. WAC " +
      "296-17-31021(2) also forbids mixing methods for salaried staff, so a per-person decision " +
      "made quietly is itself a defect.",
    authorityIds: ["wac-296-17-31021-unit-of-exposure", "wac-296-17-31021-salaried", "rcw-51-16-060-lni-hours"],
  },
  {
    key: "cross-foot",
    order: 3,
    title: "Cross-foot the wage detail against the tax report",
    doThis:
      "Add the wages on the 5208B rows and check the total equals the single figure on the " +
      "5208A. Do the same for hours against the L&I return.",
    doneWhen:
      "One wage number appears on the 941, the 5208A, the 5208B and the Paid Leave return, and " +
      "one hour number appears on the 5208B and the L&I return.",
    ifSkipped:
      "Returns that disagree with each other are the fastest route to an audit letter, because " +
      "the agencies compare them to one another and to the federal filing.",
    authorityIds: ["wac-192-310-010-wage-detail", "wac-296-17-31023-no-payroll"],
  },
  {
    key: "whose-money",
    order: 4,
    title: "Separate the money you owe from the money you are holding",
    doThis:
      "Read down the 'whose money' column. Everything marked as employee money was already " +
      "withheld and is being passed on; everything marked as employer cost is a company expense.",
    doneWhen:
      "You can say, without looking it up, which of the four payments are your cost and which " +
      "are your staff's money in transit.",
    ifSkipped:
      "The two are governed by opposite rules. Unemployment tax may never be deducted from " +
      "anybody, and Paid Leave money is held in trust and may never be used by the business. " +
      "Blurring them is how an employer ends up owing both the agency and the staff.",
    authorityIds: ["rcw-50-24-010-no-deduction", "rcw-50a-10-030-agent-and-trust", "rcw-51-16-140-lni-deduction"],
  },
  {
    key: "employer-size",
    order: 5,
    title: "Confirm the Paid Leave employer exemption still applies",
    doThis:
      "Check the averaged headcount ESD determined on 30 September. If it is close to fifty, " +
      "plan for the employer share from the following January.",
    doneWhen:
      "The determined average headcount is recorded on the return, with the margin to fifty " +
      "visible.",
    ifSkipped:
      "The exemption is decided once a year and fixed for the whole of the next one. Crossing " +
      "fifty does not produce a warning anywhere in payroll; it produces a bill.",
    authorityIds: ["rcw-50a-10-030-small-employer", "rcw-50a-10-030-size-test", "rcw-50a-10-030-pfml"],
  },
  {
    key: "due-date",
    order: 6,
    title: "Read the due date off the return, not off the calendar",
    doThis:
      "Check whether the last day of the month after the quarter is a weekend. If it is, the " +
      "deadline moves to the next business day - and only then.",
    doneWhen: "The due date shown on the screen is the one in your diary.",
    ifSkipped:
      "Two of Greenway's four 2027 deadlines move: 31 July 2027 is a Saturday and 31 October " +
      "2027 is a Sunday. Assuming the federal 941's ten-day extension applies here is the more " +
      "expensive mistake, because Washington has no such extension at all.",
    authorityIds: ["wac-192-310-010-due-dates"],
  },
  {
    key: "late-cost",
    order: 7,
    title: "Know what being late actually costs before you need to know",
    doThis:
      "If a return is going to be late, file it anyway and pay what you can. Read the penalty " +
      "and interest figures on this screen so the decision is made with numbers rather than " +
      "with dread.",
    doneWhen:
      "You can say, out loud, what a month's delay would cost on this quarter's figures - and " +
      "you have filed rather than waited until you could pay in full.",
    ifSkipped:
      "The two agencies charge differently and both charge for the FILING as well as the " +
      "payment. ESD's late-report penalty under RCW 50.12.220 is per employee not reported, so " +
      "with ten people it scales ten times faster than the intuition of 'a small late fee'. " +
      "Interest under RCW 50.24.040 runs separately from the penalty and does not stop while " +
      "you gather the money. And a balance still unpaid on 30 September can push next year's " +
      "unemployment RATE up, which quietly costs more than the penalty ever did. Filing on " +
      "time while paying late is nearly always cheaper than doing neither.",
    authorityIds: [
      "rcw-50-12-220-esd-late-penalty",
      "rcw-50-24-040-esd-interest",
      "esd-delinquent-tax-rate-sept-30",
      "rcw-51-48-210-lni-late-penalty",
    ],
  },
  {
    key: "closing-a-quarter-you-stopped-in",
    order: 8,
    title: "If Greenway ever stops paying wages, say so ON the return",
    doThis:
      "If the business stops employing anybody, report it on the quarterly return for the " +
      "quarter it happened in, rather than assuming the agencies will notice the zeros.",
    doneWhen:
      "The final return states the date wages stopped, and you have kept the confirmation.",
    ifSkipped:
      "Nothing about closing is automatic. Both agencies keep expecting returns, and a return " +
      "they expect and do not receive is a late return with a penalty attached, quarter after " +
      "quarter, for a business that no longer has any payroll to pay them from. L&I is " +
      "explicit that a quarter with no payroll still requires a report - silence is not a " +
      "filing. This check is here for a day Michael hopefully never has, because the cost of " +
      "learning it on that day is entirely avoidable.",
    authorityIds: ["wac-192-310-010-termination", "wac-296-17-31023-no-payroll"],
  },
  {
    /*
     * books-65. Added because Michael asked for the field and, having built it,
     * the obligation belongs on the list he actually works through before
     * filing - not only on the employee screen where it is set. The wage detail
     * is where a missing code shows up, and by then the quarter is over.
     *
     * Placed LAST by order rather than next to "hours-complete" because it is
     * checked against the finished wage detail. The numbering below is 9; the
     * earlier eight are untouched, so nothing a reader has learned moves.
     */
    key: "work-code-on-every-line",
    order: 9,
    title: "Every person on the wage detail has a work code, or a job title ready",
    doThis:
      "Open the payroll setup screen and confirm each employee shows an ESD work code. " +
      "Greenway's people are 41-2031, Retail Salespersons, which is what the filed 5208B " +
      "shows. Anyone left blank needs a job title typed into EAMS by hand at filing time, so " +
      "decide which it is now rather than at the deadline.",
    doneWhen:
      "The work-code column on the payroll setup roster has no dashes in it - or you have " +
      "written down the job title for each person who has none.",
    ifSkipped:
      "The statute takes the classification OR a job title, so a blank column is not itself a " +
      "violation and nothing will bounce for being empty. What bounces is a code that is " +
      "nearly right: EAMS rejects the WHOLE wage file over one malformed value, not the single " +
      "row, so ten good employees fail to upload because of one typo. The other cost is " +
      "quieter - somebody re-types ten job titles into EAMS every quarter forever, and the " +
      "quarter they mistype one is the quarter the state's occupational statistics say " +
      "Greenway employs something it does not.",
    authorityIds: [
      "rcw-50-12-070-occupational-classification",
      "wac-192-310-010-soc-six-digits",
      "wac-192-310-010-wage-detail",
    ],
  },
] as const;

export function waChecksInOrder(): readonly WaQuarterCheck[] {
  return [...WA_QUARTER_CHECKS].sort((a, b) => a.order - b.order);
}

/* ══════════════════════════════════════════════════════════════════════════
 * §4  WORKED EXAMPLES - REAL NUMBERS, ARITHMETIC SHOWN
 * ══════════════════════════════════════════════════════════════════════════ */

export type WaWorkedExample = {
  readonly key: string;
  readonly title: string;
  /** The situation, in one or two sentences. */
  readonly setup: string;
  /** Each step of the arithmetic, in order, with the numbers in it. */
  readonly steps: readonly string[];
  /** The answer. */
  readonly answer: string;
  /** The point of the example - what it teaches that a rule alone would not. */
  readonly lesson: string;
};

export const WA_WORKED_EXAMPLES: readonly WaWorkedExample[] = [
  {
    key: "two-roundings",
    title: "The cent that proves the two funds are separate",
    setup:
      "Greenway's Q2 2026: $68,923.45 of taxable wages, an unemployment rate of 0.37% and an " +
      "EAF surcharge of 0.03%. The rate notice shows 0.40% as the headline. What is owed?",
    steps: [
      "The tempting shortcut: 0.40% of $68,923.45 = $275.6938, which rounds to $275.69.",
      "The lawful method, part one: 0.37% of $68,923.45 = $255.016765. RCW 50.24.010 says a " +
        "fractional part of a cent is increased to one cent at one-half or more, so $255.02.",
      "Part two: 0.03% of $68,923.45 = $20.677035. RCW 50.24.014(2)(b) says the same thing for " +
        "its own section, so $20.68.",
      "Add the two ROUNDED figures: $255.02 + $20.68 = $275.70.",
    ],
    answer: "$275.70 - which is exactly what ESD assessed, under confirmation G2413C8A6HP330LL.",
    lesson:
      "The shortcut is off by one cent, and the reason is legal rather than mathematical: these " +
      "are two separate statutory accounts, each with its own command to round. When the law " +
      "rounds twice, the software rounds twice.",
  },
  {
    key: "percentage-of-a-percentage",
    title: "Why Paid Leave cannot be done in one multiplication",
    setup:
      "Same quarter, same $68,923.45. The Paid Leave premium rate is 1.13% and employees pay " +
      "71.43% of the premium. How much comes out of paycheques?",
    steps: [
      "First the whole premium, on wages: $68,923.45 x 1.13% = $778.8349...",
      "Then the employees' share OF THE PREMIUM: $778.8349 x 71.43% = $556.32.",
      "The employer's share would be the other 28.57%, or $222.51 - but see the next example.",
    ],
    answer: "$556.32 withheld from employees, matching the filed return.",
    lesson:
      "The 71.43% is a share of the premium, not a rate on wages. Anyone who stores it as a " +
      "wage rate produces a number ninety times too small, and it will look plausible on the " +
      "screen. The engine keeps the two steps apart and rounds only at the end.",
  },
  {
    key: "the-zero-that-is-a-position",
    title: "A zero that has to be defended",
    setup:
      "The employer share of Paid Leave on Greenway's filed Q2 2026 return is $0.00. Is that a " +
      "mistake?",
    steps: [
      "The premium for the quarter is $778.83, and the employer share of it would be 28.57%, " +
        "or $222.51.",
      "RCW 50A.10.030(5)(a): employers with fewer than 50 Washington employees are not required " +
        "to pay the employer portion.",
      "Greenway employs ten. The exemption applies, so the correct figure is $0.00.",
      "RCW 50A.10.030(7)(c): size is fixed each 30 September, from the average of the four " +
        "previous quarter-end headcounts, and governs the whole following calendar year.",
    ],
    answer: "$0.00 is correct, and it is a legal position rather than an omission.",
    lesson:
      "Every zero on a tax return should have a reason attached to it, because a zero and a " +
      "blank look identical to a reviewer. The exposure here is $222.51 a quarter, and it " +
      "switches on in January following the September the headcount crosses fifty - not on the " +
      "day the fiftieth person is hired.",
  },
  {
    key: "the-raise-that-changes-nothing",
    title: "Give everyone a raise; watch which returns move",
    setup:
      "Suppose Greenway's Q2 2026 wages had been 10% higher - $75,815.80 - on exactly the same " +
      "3,558 hours. Which of the four returns change?",
    steps: [
      "5208A unemployment: 0.37% of $75,815.80 = $280.52, up from $255.02. Changes.",
      "EAF: 0.03% of $75,815.80 = $22.74, up from $20.68. Changes.",
      "Paid Leave and WA Cares: both are rates on wages, so both rise by 10% too.",
      "L&I: 3,558 hours x $0.5593 = $1,989.99. Unchanged, to the cent.",
    ],
    answer:
      "Three of the four move. Unemployment goes from $255.02 to $280.52, the EAF from $20.68 " +
      "to $22.74, and Paid Leave and WA Cares rise by the same 10%. The L&I premium stays at " +
      "$1,989.99 - not approximately, but to the cent, because 3,558 hours is still 3,558 hours.",
    lesson:
      "This is the fastest way to internalise the difference. L&I is insurance against injury " +
      "and an hour is an hour regardless of what it pays. It also explains the asymmetry in " +
      "risk: an error in WAGES shows up in three places and is likely to be caught, while an " +
      "error in HOURS shows up in the one return that no wage figure can cross-check.",
  },
] as const;

/* ══════════════════════════════════════════════════════════════════════════
 * §5  LESSONS ON THE ENGINE'S OWN FUNCTIONS
 * ══════════════════════════════════════════════════════════════════════════ */

export type WaMentorLesson = {
  /** The exported function this lesson teaches. */
  readonly fn: string;
  readonly plainEnglish: string;
  /** The mistake this function exists to prevent. */
  readonly guardsAgainst: string;
  readonly authorityIds: readonly string[];
};

export const WA_QUARTER_LESSONS: readonly WaMentorLesson[] = [
  {
    fn: "statutoryRoundCents",
    plainEnglish:
      "Rounds a part-cent up at one-half and down below it, which is precisely how RCW " +
      "50.24.010 words it. It refuses a negative amount rather than inventing a rule, because " +
      "the statute describes rounding contributions and a contribution cannot be negative.",
    guardsAgainst:
      "Using an ordinary rounding helper that quietly handles negatives, which would let an " +
      "upstream sign error through as a plausible-looking figure.",
    authorityIds: ["rcw-50-24-010-rounding", "rcw-50-24-014-eaf-no-deduction-and-rounding"],
  },
  {
    fn: "exactMilliPct",
    plainEnglish:
      "Applies a percentage to an amount of money WITHOUT rounding the answer, so a two-step " +
      "calculation can round once at the end instead of twice in the middle.",
    guardsAgainst:
      "Rounding the Paid Leave premium before taking the employees' share of it, which shifts " +
      "the final figure off the filed one.",
    authorityIds: ["esd-pfml-2026-rate-announcement"],
  },
  {
    fn: "hourlyPremiumCents",
    plainEnglish:
      "Turns hours into money at a rate quoted in milli-cents per hour, because L&I quotes five " +
      "decimal places of a dollar and integer cents cannot hold $0.16445.",
    guardsAgainst:
      "Storing the rate in cents and losing the last three digits - the books-14 defect, which " +
      "produced an employee rate less than half the true one.",
    authorityIds: ["lni-premium-rate-formula", "wac-296-17-31021-unit-of-exposure"],
  },
  {
    fn: "validateWaQuarterRequest",
    plainEnglish:
      "Collects everything wrong with the quarter at once and explains each in plain English " +
      "with the one thing to do about it, rather than stopping at the first problem.",
    guardsAgainst:
      "Six round trips through the same screen fixing one row at a time, and silent acceptance " +
      "of wages with no hours - which understates the L&I premium without touching any wage " +
      "figure.",
    authorityIds: ["wac-192-310-010-wage-detail", "wac-296-17-31021-salaried"],
  },
  {
    fn: "buildWaQuarter",
    plainEnglish:
      "Builds all four Washington returns from one quarter of payroll, keeping the three " +
      "different ways of counting - capped wages, uncapped wages and hours - strictly apart.",
    guardsAgainst:
      "Applying the Paid Leave wage cap to WA Cares, which has none; and applying wages to the " +
      "L&I return, which is charged on hours.",
    authorityIds: ["rcw-50a-10-030-wage-cap", "wa-cares-uncapped", "wac-296-17-31021-unit-of-exposure"],
  },
  {
    fn: "waQuarterDueDate",
    plainEnglish:
      "Works out when the return is actually due, moving the date off a Saturday or Sunday to " +
      "the next business day as WAC 192-310-010(3)(d) requires.",
    guardsAgainst:
      "Assuming the last day of the month is always the deadline. Two of Greenway's four 2027 " +
      "Washington deadlines fall at a weekend.",
    authorityIds: ["wac-192-310-010-due-dates"],
  },
  {
    fn: "waVersusFederalDeadlineNote",
    plainEnglish:
      "States the one difference between the federal and Washington deadlines that costs money: " +
      "the 941's ten extra days for clean depositors have no Washington equivalent.",
    guardsAgainst:
      "Carrying the federal habit across to the state returns and filing ten days late.",
    authorityIds: ["wac-192-310-010-due-dates"],
  },
  {
    fn: "waLinesForForm",
    plainEnglish:
      "Returns the lines belonging to one of the four returns, in the order that return prints " +
      "them, so a screen can show one form at a time instead of a single undifferentiated list.",
    guardsAgainst:
      "Presenting all four filings as one bill, which hides the fact that they go to two " +
      "agencies through three different systems on different rules.",
    authorityIds: ["wac-192-310-010-tax-report"],
  },
  {
    fn: "waLineOf",
    plainEnglish:
      "Finds one box on the return by its name, so a screen or a test can ask for 'the " +
      "unemployment line' rather than counting positions in a list.",
    guardsAgainst:
      "Reading a line by its index. Positions move the moment a line is added, and an index " +
      "that has silently started pointing at the wrong box still returns a plausible number.",
    authorityIds: ["wac-192-310-010-tax-report"],
  },
  {
    fn: "formatWaLineValue",
    plainEnglish:
      "Renders a box the way that box is actually measured: money as dollars, hours as hours. " +
      "The L&I return's first box is a count of 3,558 hours, not an amount of money, and this " +
      "is the one function that knows the difference.",
    guardsAgainst:
      "Printing '$0.00' beside the hours box. The hours line legitimately carries zero cents, " +
      "so any screen that reached for the money field directly would display a confident, " +
      "wrong, and very believable zero on a return that is charged entirely on hours.",
    authorityIds: ["wac-296-17-31021-unit-of-exposure"],
  },
  {
    fn: "waLegalHolidays",
    plainEnglish:
      "Lists Washington's own legal holidays for a year, with the observed-day shift already " +
      "applied - Saturday holidays move back to Friday and Sunday holidays forward to Monday, " +
      "exactly as RCW 1.16.050(5) words it.",
    guardsAgainst:
      "Reusing the federal holiday table for a state deadline. The two lists genuinely differ: " +
      "Washington has no Columbus Day (RCW 1.16.050(7)(r) recognises the date and then says it " +
      "may not be considered a legal holiday for any purpose) and no DC Emancipation Day, and " +
      "it adds Native American Heritage Day, the Friday after Thanksgiving, which has no " +
      "federal equivalent.",
    authorityIds: ["wac-192-310-010-due-dates"],
  },
  {
    fn: "isWaLegalHoliday",
    plainEnglish:
      "Answers whether one particular date is a Washington legal holiday. Neighbouring years " +
      "are consulted because an observed shift can carry New Year's Day back across a year " +
      "boundary into 31 December.",
    guardsAgainst:
      "The tempting shortcut. This check used to be a function that simply returned 'no', on " +
      "the reasoning that no Washington holiday can land on 30 April, 31 July, 31 October or " +
      "31 January anyway. That reasoning happens to be correct - but it was a claim taken on " +
      "trust, and a branch that can never fire is untested code that looks tested. The check " +
      "now runs against a real table, and a test walks fifty years to prove the holiday branch " +
      "never moves a deadline. If Washington ever adds a holiday on one of those dates, the " +
      "engine already handles it and the test tells us the world changed.",
    authorityIds: ["wac-192-310-010-due-dates"],
  },
] as const;

export function waLessonFor(fn: string): WaMentorLesson | undefined {
  return WA_QUARTER_LESSONS.find((l) => l.fn === fn);
}

export function waTaughtFunctionNames(): readonly string[] {
  return WA_QUARTER_LESSONS.map((l) => l.fn);
}

/* ══════════════════════════════════════════════════════════════════════════
 * §6  WHAT EVERY REFUSAL MEANS
 * ══════════════════════════════════════════════════════════════════════════ */

export type WaRefusalLesson = {
  readonly code: WaQuarterRefusalCode;
  /** What the software actually noticed. */
  readonly whatHappened: string;
  /** Why it refuses instead of guessing. */
  readonly whyItRefuses: string;
  /** The fix, as a first action. */
  readonly howToFix: string;
};

export const WA_REFUSAL_LESSONS: readonly WaRefusalLesson[] = [
  {
    code: "NO_SUBJECTS",
    whatHappened: "There is nobody on this quarter.",
    whyItRefuses:
      "A quarter with no people is either a quarter with no payroll - which still needs a " +
      "return - or a quarter whose pay runs have not arrived. Those need opposite responses, so " +
      "the software will not pick one.",
    howToFix:
      "If nobody was paid, file the return marked 'no payroll'. Otherwise find the missing pay " +
      "runs.",
  },
  {
    code: "NEGATIVE_WAGES",
    whatHappened: "Somebody has negative wages for the quarter.",
    whyItRefuses:
      "No quarter pays a negative amount. It is almost always a reversal entered as a fresh pay " +
      "run, and filing it would understate the whole return.",
    howToFix: "Void the original pay run properly rather than posting a negative one.",
  },
  {
    code: "NEGATIVE_HOURS",
    whatHappened: "Somebody has negative hours.",
    whyItRefuses: "Hours are charged directly by L&I; a negative would reduce the premium owed.",
    howToFix: "Correct the timesheet for the quarter.",
  },
  {
    code: "TAXABLE_EXCEEDS_TOTAL",
    whatHappened: "Somebody's taxable wages are larger than their total wages.",
    whyItRefuses:
      "Taxable wages are the part of total wages still under a ceiling, so they can never be " +
      "the larger of the two. This means the year-to-date figures are wrong.",
    howToFix: "Check the year-to-date wage records feeding this quarter.",
  },
  {
    code: "FRACTIONAL_HOURS",
    whatHappened: "Somebody's hours are not a whole number.",
    whyItRefuses:
      "Both agencies collect whole hours for this employer, so a fraction means a rounding " +
      "decision was made somewhere it is not visible.",
    howToFix: "Round at the timesheet, where the decision can be seen and defended.",
  },
  {
    code: "MISSING_RATE",
    whatHappened: "One or more rates were not supplied.",
    whyItRefuses:
      "The rate registry refuses rather than reaching for a neighbouring year, because last " +
      "year's rate produces a return that looks entirely normal and is wrong throughout.",
    howToFix:
      "Enter this year's figures from the December ESD tax rate notice and the L&I rate notice.",
  },
  {
    code: "PFML_SHARE_NOT_A_SHARE",
    whatHappened: "The Paid Leave employee share is not a percentage between 0 and 100.",
    whyItRefuses:
      "This field is a share of the premium, not a rate on wages. A wage-shaped number here " +
      "would under-collect by roughly ninety times and look plausible.",
    howToFix: "Enter 71.43% as 71_430 milli-percent.",
  },
  {
    code: "WAGES_WITHOUT_HOURS",
    whatHappened: "Somebody was paid but reported no hours.",
    whyItRefuses:
      "Washington requires hours per person, and L&I charges premium on them, so zero hours " +
      "against real pay understates the premium while every wage figure still looks right.",
    howToFix:
      "Record the hours. If the person is salaried, choose actual hours or 160 per month for " +
      "ALL salaried staff, as WAC 296-17-31021(2) requires.",
  },
  {
    code: "HOURS_WITHOUT_WAGES",
    whatHappened: "Somebody worked hours but was paid nothing.",
    whyItRefuses:
      "This is either unpaid work, which is a far larger problem than a tax return, or a pay " +
      "run that has not posted.",
    howToFix: "Resolve the pay run before filing.",
  },
  {
    code: "PFML_SIZE_UNDETERMINED",
    whatHappened:
      "The return says the employer share of Paid Leave is owed, but no determined headcount is " +
      "recorded.",
    whyItRefuses:
      "Paying the employer share is a consequence of ESD's 30 September determination. Paying " +
      "it without recording that determination leaves no reason on the file.",
    howToFix: "Record the averaged headcount ESD determined.",
  },
] as const;

export function waRefusalLesson(code: WaQuarterRefusalCode): WaRefusalLesson | undefined {
  return WA_REFUSAL_LESSONS.find((l) => l.code === code);
}

/**
 * Every refusal code, with whether it is taught.
 *
 * Exists so the screen can display its own coverage honestly rather than a
 * test asserting it privately (standing rule 43: a refusal nobody can reach is
 * indistinguishable from one that does not work).
 */
export function waRefusalCoverage(): readonly { code: string; taught: boolean }[] {
  return ALL_WA_QUARTER_REFUSAL_CODES.map((code) => ({
    code,
    taught: WA_REFUSAL_LESSONS.some((l) => l.code === code),
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
 * §7  THE ONE-PARAGRAPH ORIENTATION
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The whole slice in a paragraph, for the top of the screen.
 *
 * Deliberately a function rather than a constant so the numbers can never drift
 * from the engine: everything quoted here is passed in.
 */
export function waQuarterOrientation(args: {
  readonly grossWagesCents: number;
  readonly totalHours: number;
  readonly headcount: number;
}): string {
  const wages = `$${(args.grossWagesCents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return (
    `Four returns, two agencies, one quarter of payroll. ${args.headcount} people, ${wages} in ` +
    `wages and ${args.totalHours.toLocaleString("en-US")} hours. Washington measures those three ` +
    `months in three incompatible ways, and nearly every mistake on these forms comes from ` +
    `carrying an intuition from one to another. Unemployment is charged on wages, capped per ` +
    `person per year, and paid entirely by the business. Paid Leave and WA Cares are charged on ` +
    `wages too - one capped, one not - but that money was already taken from your staff and is ` +
    `merely passing through. Workers' compensation ignores wages altogether and is charged on ` +
    `hours. Read each form knowing which of the three you are looking at, and the rest follows.`
  );
}
