/**
 * src/lib/payroll/net-pay-mentor.ts   (books-37)
 *
 * THE TEACHING LAYER FOR NET PAY - the order of operations on a paycheque.
 *
 * Michael's instruction for this slice, verbatim: "Please make sure to include
 * the same level of verbatim authoritative text and their plain english
 * explanations. Please go above and beyond for me."
 *
 * WHAT MAKES THIS SLICE DIFFERENT FROM EVERY OTHER PAYROLL SLICE
 *
 * Every other payroll engine here answers "how much". The withholding engine
 * says how much tax. The garnishment engine says how much a creditor may take.
 * The sick-leave engine says how many hours were earned. Each is separately
 * checkable, and each was separately checked.
 *
 * This module is about SEQUENCE, and sequence has a property that makes it
 * uniquely dangerous: every individual number can be right while the cheque is
 * wrong. There is no figure to eyeball, no total that fails to foot, no
 * negative balance to notice. A payroll run computed in the wrong order
 * balances perfectly. That is why the teaching here dwells on order rather than
 * on arithmetic, and why the engine reports the deductions it deliberately did
 * NOT subtract rather than quietly leaving them out.
 *
 * PURE DATA, NO `node:fs`. Standing rule 65b. The lesson objects below are
 * reachable from client components, so the gates that read files live in
 * `net-pay-mentor-gates.ts` and this file imports nothing that touches a disk.
 * Mixing the two put `node:fs` into a browser bundle in books-33 and broke
 * every deployment while CI stayed green.
 */

import type { NetPayRefusalCode } from "@/lib/payroll/net-pay-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) THE FIELDS - what each figure on the breakdown actually is
 * ═══════════════════════════════════════════════════════════════════════════ */

export type NetPayFieldLesson = {
  /** The field on `NetPayBreakdown` this teaches. */
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

/**
 * ONE LESSON PER FIGURE ON THE BREAKDOWN.
 *
 * The fields are taught in the order the engine computes them, because the
 * order IS the subject. Reading these top to bottom is reading a paycheque
 * being built.
 */
export const NET_PAY_FIELD_LESSONS: readonly NetPayFieldLesson[] = [
  {
    field: "grossWagesCents",
    whatItIs:
      "Everything the employee earned this period before anything comes out: regular hours at their " +
      "rate, overtime at time-and-a-half, and any paid sick leave taken. One number, and it is the " +
      "only one on the cheque that nobody argues about.",
    whereItIsUsed:
      "Box 1 of the W-2 (after pre-tax adjustments), line 2 of the 941, the wage base for every tax " +
      "on the cheque, and the starting point for the disposable-earnings calculation that every " +
      "garnishment is a percentage of.",
    whyItMatters:
      "It is the root of the tree. Every other figure in this breakdown is derived from it, so an " +
      "error here does not stay here - it propagates into withholding, into the garnishment cap, " +
      "into the quarterly return and onto the W-2, all in the same direction.",
    theTrap:
      "Thinking gross pay is where garnishment starts. It is not, and the gap between the two is " +
      "large: a creditor's twenty-five percent is twenty-five percent of DISPOSABLE earnings, which " +
      "is a smaller number. Applying the percentage to gross takes far too much and the arithmetic " +
      "still looks tidy.",
    howToBeSure:
      "The timesheet screen shows the hours that produced this figure, per workweek rather than per " +
      "pay period, which is the form 29 CFR 778.104 requires overtime to be computed in.",
    authorityIds: ["net-pay-usc-15-1672-base"],
  },
  {
    field: "requiredByLaw.federalIncomeTaxCents",
    whatItIs:
      "Federal income tax withheld, computed from the employee's Form W-4 using the percentage " +
      "method worksheets in IRS Publication 15-T.",
    whereItIsUsed:
      "Box 2 of the W-2, line 3 of the 941, and - the part people forget - it comes out BEFORE " +
      "disposable earnings are measured, so it reduces what any creditor can reach.",
    whyItMatters:
      "This is the largest of the required deductions for most employees, so it moves the " +
      "garnishment base more than anything else on the list. It is also the one that changes when " +
      "an employee hands in a new W-4, which means a garnished employee's take-home can change " +
      "for a reason that has nothing to do with the garnishment.",
    theTrap:
      "Assuming a big income-tax deduction protects the employee. It reduces disposable earnings, " +
      "so it reduces the creditor's twenty-five percent - but it also reduces the CCPA's protected " +
      "floor test in the opposite direction, and which of the two limits binds can flip.",
    howToBeSure:
      "The pay-run screen shows the W-4 inputs that produced the figure and the Pub. 15-T worksheet " +
      "line each one fed.",
    authorityIds: ["net-pay-usc-15-1672-base", "net-pay-fs30-legally-required"],
  },
  {
    field: "requiredByLaw.socialSecurityCents",
    whatItIs:
      "The employee's own share of Social Security: 6.2% of wages, but only up to the annual wage " +
      "base ($184,500 for 2026). Above that ceiling the tax simply stops for the rest of the year.",
    whereItIsUsed:
      "Box 4 of the W-2, lines 5a of the 941, and the required-by-law bucket here.",
    whyItMatters:
      "It is required by law in the plainest sense - the employer has no discretion at all - so it " +
      "reduces disposable earnings on every cheque without exception. The DOL fact sheet names the " +
      "employee's share of Social Security explicitly, so there is no judgement call to make.",
    theTrap:
      "It STOPS mid-year for a high earner. When it stops, disposable earnings jump, and a " +
      "garnishment computed as a percentage of them jumps with it. An employee whose garnishment " +
      "suddenly gets bigger in November has usually just crossed the wage base, and that is the " +
      "correct answer rather than a bug - but only if the year-to-date figures are real, which is " +
      "why the year-to-date store had to be built before this engine could be trusted.",
    howToBeSure:
      "The year-to-date screen shows exactly where the employee stands against the ceiling and how " +
      "much room is left before withholding stops.",
    authorityIds: ["net-pay-fs30-legally-required", "w2-box3-wage-base-ceiling"],
  },
  {
    field: "requiredByLaw.medicareCents",
    whatItIs:
      "The employee's share of Medicare: 1.45% of every dollar of wages, with no ceiling of any " +
      "kind.",
    whereItIsUsed:
      "Box 6 of the W-2, line 5c of the 941, and the required-by-law bucket here.",
    whyItMatters:
      "Same compelled status as Social Security, so it reduces disposable earnings identically. Its " +
      "value here is as a check: because it never stops, Medicare wages on a W-2 are always at " +
      "least as large as Social Security wages, and the SSA rejects a W-2 where they are not.",
    theTrap:
      "Assuming it stops when Social Security does, because for most employees the two figures are " +
      "identical all year and quietly teach you they should match. The first time they differ, the " +
      "instinct is to 'fix' the discrepancy - which produces exactly the condition the SSA rejects.",
    howToBeSure:
      "The year-to-date screen shows the two wage bases separately rather than as one 'FICA wages' " +
      "figure, precisely so the divergence is visible when it happens.",
    authorityIds: ["net-pay-fs30-legally-required", "w2-box5-no-medicare-limit"],
  },
  {
    field: "requiredByLaw.additionalMedicareCents",
    whatItIs:
      "An extra 0.9% Medicare tax on wages above $200,000 in a calendar year. Withheld from the " +
      "employee only - the employer does NOT match this one.",
    whereItIsUsed:
      "Folded into box 6 withholding on the W-2, line 5d of the 941, and the required-by-law " +
      "bucket here.",
    whyItMatters:
      "It is the one payroll tax with no employer half, which makes it easy to mis-book: the " +
      "employer expense entry for Medicare must not include it. It is also compelled, so like the " +
      "rest it comes out before disposable earnings are measured.",
    theTrap:
      "The $200,000 threshold is per EMPLOYER and takes no account of a spouse's wages or a second " +
      "job. The employer withholds strictly on what it paid; the employee settles the true amount " +
      "on their own return. Trying to be helpful by withholding on a household estimate is wrong " +
      "and is not the employer's call to make.",
    howToBeSure:
      "The year-to-date screen shows wages against the $200,000 threshold; the pay-run screen names " +
      "the threshold it applied.",
    authorityIds: ["net-pay-fs30-legally-required", "w2-box5-no-medicare-limit"],
  },
  {
    field: "requiredByLaw.waPfmlCents",
    whatItIs:
      "The employee's share of Washington's Paid Family and Medical Leave premium, withheld by the " +
      "employer and remitted to the Employment Security Department.",
    whereItIsUsed:
      "The quarterly ESD report, and the required-by-law bucket here.",
    whyItMatters:
      "It is a state-law payroll deduction that is not an income tax, which is exactly the shape of " +
      "deduction the DOL fact sheet confirms belongs in disposable earnings - it lists the " +
      "employee's share of state unemployment insurance as an example, and PFML is the same kind " +
      "of compelled state premium.",
    theTrap:
      "Treating it as optional because the employee never signed anything for it. Nobody signs for " +
      "a required deduction; that is what makes it required, and it is precisely why it belongs in " +
      "this bucket rather than the voluntary one.",
    howToBeSure:
      "ESD publishes the premium rate and the employee/employer split each year; the pay-run screen " +
      "names the rate it used.",
    authorityIds: ["net-pay-fs30-legally-required"],
  },
  {
    field: "requiredByLaw.waCaresCents",
    whatItIs:
      "The employee's WA Cares Fund long-term care premium. Entirely employee-paid - the employer " +
      "contributes nothing and merely withholds it.",
    whereItIsUsed:
      "The quarterly ESD report, and the required-by-law bucket here.",
    whyItMatters:
      "Same reasoning as PFML: compelled by state law, therefore it comes out before the " +
      "garnishment limits are applied.",
    theTrap:
      "An employee with an approved exemption has this withheld anyway because nobody updated their " +
      "record. That is over-withholding from someone who is entitled not to pay it, and it also " +
      "understates disposable earnings, which under-garnishes a creditor. Two errors from one " +
      "stale flag.",
    howToBeSure:
      "The employee's onboarding record carries the exemption status; the pay-run screen shows " +
      "which way it was set for this cheque.",
    authorityIds: ["net-pay-fs30-legally-required"],
  },
  {
    field: "requiredByLaw.waLniCents",
    whatItIs:
      "The employee's half of the Washington industrial-insurance medical-aid premium, charged per " +
      "HOUR WORKED rather than as a percentage of pay, at the rate for the employer's risk class - " +
      "6403 for a retail cannabis store.",
    whereItIsUsed:
      "The quarterly L&I report, and - as of books-37 - the required-by-law bucket here.",
    whyItMatters:
      "THIS IS THE FIGURE THAT WAS MISSING, and it is the reason this slice exists. The " +
      "garnishment engine's required-by-law bucket documented itself as income tax, FICA, PFML and " +
      "WA Cares, and said 'NOTHING ELSE'. RCW 51.16.140(1) says the employer 'shall deduct' the " +
      "medical-aid half from the worker's pay, and subsection (2) makes deducting the wrong amount " +
      "a GROSS MISDEMEANOR. A deduction the state compels on pain of a criminal charge is required " +
      "by law by any reading. Leaving it out made disposable earnings look bigger than they were, " +
      "which let a creditor take twenty-five percent of a number that was too high - from an " +
      "employee who is already being garnished.",
    theTrap:
      "It is small per cheque, so it looks like a rounding detail and gets skipped. It is not a " +
      "rounding detail, it is a wrong base, and a wrong base is wrong on every cheque forever in " +
      "the same direction. The other trap is the unit: this premium is per HOUR, not per dollar, so " +
      "an employee who worked more hours has a bigger deduction at the same salary.",
    howToBeSure:
      "The L&I rate notice states the composite rate and the employee-withheld portion for risk " +
      "class 6403; the pay-run screen shows the hours and the milli-cent rate it multiplied.",
    authorityIds: ["net-pay-rcw-51-16-140-required", "net-pay-fs30-legally-required"],
  },
  {
    field: "disposableEarningsCents",
    whatItIs:
      "Gross pay minus everything the law requires to be withheld, and nothing else. It is the " +
      "single number every garnishment cap is a percentage of.",
    whereItIsUsed:
      "Every wage order on the cheque: the CCPA twenty-five percent ceiling, the Washington " +
      "exemptions, and the fifty/fifty-five/sixty/sixty-five percent support caps are all " +
      "percentages of THIS, not of gross and not of take-home.",
    whyItMatters:
      "It sits between two numbers people confuse it with, and it equals neither. It is smaller " +
      "than gross pay because tax has come out, and larger than net pay because health insurance " +
      "and the like have not. Get it wrong in either direction and every order on the cheque is " +
      "wrong by the same proportion.",
    theTrap:
      "Using take-home pay because it is the number sitting right there at the bottom of the stub. " +
      "Take-home is AFTER the voluntary deductions, and 15 U.S.C. §1672(b) counts only amounts " +
      "'required by law to be withheld'. Subtracting a health premium first shrinks the base, takes " +
      "too little for the order, and on a support order the shortfall can become the employer's " +
      "own liability rather than the employee's.",
    howToBeSure:
      "The breakdown itemises every deduction that went into this figure AND lists the voluntary " +
      "ones it deliberately excluded, so the exclusion is visible rather than assumed.",
    authorityIds: [
      "net-pay-usc-15-1672-base",
      "net-pay-fs30-legally-required",
      "net-pay-fs30-voluntary-excluded",
    ],
  },
  {
    field: "afterTaxBeforeDeductionsCents",
    whatItIs:
      "Gross pay less taxes only - the figure the tax engine itself calls 'net pay', carried " +
      "through here under a name that says what it actually is.",
    whereItIsUsed:
      "Comparison and explanation. It is deliberately NOT used as a garnishment base, and it is " +
      "NOT what the employee receives.",
    whyItMatters:
      "The tax engine legitimately calls this 'net pay' because from where it stands, tax is all " +
      "there is. Once garnishments and voluntary deductions exist, that name becomes actively " +
      "misleading - so it is renamed at the boundary rather than passed along, and both figures " +
      "are shown so the difference between them can be explained instead of argued about.",
    theTrap:
      "Two different numbers in the codebase called 'net pay'. Renaming one of them at the seam is " +
      "the cheapest fix available; the alternative is a system where the correct answer depends on " +
      "which module you happen to be reading.",
    howToBeSure:
      "The breakdown shows this beside disposable earnings and beside true net pay, so all three " +
      "are visible at once and none of them can be mistaken for another.",
    authorityIds: ["net-pay-usc-15-1672-base"],
  },
  {
    field: "garnishment",
    whatItIs:
      "The full per-order detail from the garnishment engine: each wage order, the cap that bound " +
      "it, and any shortfall between what the order demanded and what the law allowed. Null when " +
      "the employee has no active orders.",
    whereItIsUsed:
      "The garnishment screen's per-order breakdown, and the remittance to each creditor or to the " +
      "Washington State Support Registry.",
    whyItMatters:
      "The total alone cannot be remitted - money has to go to specific creditors in specific " +
      "amounts. Keeping the detail attached to the cheque means the remittance and the deduction " +
      "come from a single computation rather than two that can drift apart.",
    theTrap:
      "Treating null as zero orders in a way that hides a failure. Null here means the employee has " +
      "no orders; an employee WITH an order whose calculation failed produces a refusal, not a " +
      "null. Those two states must never be collapsed, because one is normal and the other means " +
      "somebody is about to be paid money a court has claimed.",
    howToBeSure:
      "The garnishment screen lists every active order for the employee; a cheque with orders shows " +
      "them itemised, and a cheque that could not compute them refuses outright.",
    authorityIds: ["net-pay-usc-15-1672-base"],
  },
  {
    field: "totalGarnishedCents",
    whatItIs:
      "The total taken this period across every active wage order, after each order's own cap has " +
      "been applied and after the combined ceiling has been enforced.",
    whereItIsUsed:
      "The remittance to each creditor or to the Washington State Support Registry, and the " +
      "garnishment screen's per-order breakdown.",
    whyItMatters:
      "This is a third party's claim on money that is already the employee's. Taking too much is " +
      "converting somebody's wages without authority; taking too little on a support order can make " +
      "the employer liable for the difference. There is no comfortable direction to be wrong in.",
    theTrap:
      "Computing each order correctly in isolation and letting the sum breach the combined ceiling. " +
      "Two valid orders can each be under their own cap and jointly take more than the law allows.",
    howToBeSure:
      "The garnishment screen shows each order, the cap that bound it, and the shortfall where an " +
      "order demanded more than the caps allowed.",
    authorityIds: ["net-pay-usc-15-1672-base"],
  },
  {
    field: "totalVoluntaryCents",
    whatItIs:
      "Everything the employee agreed in writing to have taken out: health premiums, retirement " +
      "contributions, a repayment of a payroll advance. Never anything the employer decided alone.",
    whereItIsUsed:
      "Subtracted at the very END of the cheque, after tax and after garnishment, to arrive at net " +
      "pay. Deliberately NOT part of disposable earnings.",
    whyItMatters:
      "The ORDER is the whole point. These come out last because they are the employee's own " +
      "choices about money that is already theirs, not claims the law places ahead of them. Move " +
      "them earlier and a creditor is effectively made to share in the employee's benefit " +
      "elections, which is not how the CCPA works.",
    theTrap:
      "Health insurance feels mandatory - it is automatic, it is on every stub, the employee cannot " +
      "skip it mid-year. None of that makes it 'required by law', which asks whether the STATE " +
      "compels it, not whether the employee can practically avoid it. The DOL fact sheet names " +
      "health and life insurance in its list of deductions that do NOT reduce the base.",
    howToBeSure:
      "Every voluntary deduction carries a written-authorisation flag, and the engine refuses the " +
      "cheque rather than taking one without it.",
    authorityIds: [
      "net-pay-fs30-voluntary-excluded",
      "net-pay-rcw-49-52-060-authorized",
    ],
  },
  {
    field: "netPayCents",
    whatItIs:
      "What the employee actually receives: gross, minus required withholding, minus garnishment, " +
      "minus authorised voluntary deductions. The number on the cheque.",
    whereItIsUsed:
      "The payment itself, the pay stub, and the bank reconciliation for the payroll clearing " +
      "account.",
    whyItMatters:
      "It is the only figure in the whole system the employee independently verifies, every " +
      "fortnight, against their own expectation. It is where errors upstream finally become " +
      "visible - and by then the money has moved.",
    theTrap:
      "A net pay that comes out right by accident. Two compensating errors - too much taken here, " +
      "too little there - produce a correct-looking cheque with a wrong garnishment remittance and " +
      "a wrong quarterly return sitting behind it. That is why the engine checks that the " +
      "components RECONCILE to the total rather than only checking the total is plausible.",
    howToBeSure:
      "`netPayReconciles` re-adds every component and compares; the breakdown is shown itemised so " +
      "the addition can be done by eye.",
    authorityIds: ["net-pay-usc-15-1672-base"],
  },
  {
    field: "explanation",
    whatItIs:
      "The cheque narrated step by step, in order, in plain English: what the employee earned, " +
      "what the law took, what that left as disposable earnings, what the orders took from it, " +
      "what the employee had agreed to, and what remained.",
    whereItIsUsed:
      "The net-pay screen, and it is the text to read aloud when an employee asks why their cheque " +
      "is smaller than they expected.",
    whyItMatters:
      "A figure with no derivation cannot be checked or defended. This slice is about ORDER, and " +
      "order is invisible in a list of totals - the narration is the only place the sequence is " +
      "actually shown. It is also the fastest way to spot a wrong base: if the narration says " +
      "disposable earnings equal take-home, the error is legible in words before anyone finds it " +
      "in the numbers.",
    theTrap:
      "Treating it as decoration and letting it drift out of step with the arithmetic. It is " +
      "generated from the same computation that produces the figures, never written separately, " +
      "because two independent descriptions of one calculation is how a system starts lying " +
      "politely.",
    howToBeSure:
      "Read it against the itemised figures beside it - they come from one pass over the same data " +
      "and must agree line for line.",
    authorityIds: ["net-pay-usc-15-1672-base", "net-pay-fs30-legally-required"],
  },
  {
    field: "notes",
    whatItIs:
      "Things worth knowing that are not errors: an order that hit its cap, a Social Security " +
      "ceiling reached mid-period, a voluntary deduction that was reduced to fit.",
    whereItIsUsed:
      "The net-pay screen, shown separately from refusals so the difference between 'stop' and " +
      "'be aware' is never ambiguous.",
    whyItMatters:
      "Most of the surprising things a payroll does are correct. Someone who cannot tell a correct " +
      "surprise from a defect either investigates the harmless ones until they stop investigating " +
      "at all, or overrides the software. Notes are what keeps a warning meaningful by making sure " +
      "it is rare.",
    theTrap:
      "Putting something in notes that should have been a refusal. The test is simple: if the " +
      "cheque should not be paid until a human acts, it is a refusal. Anything else is a note.",
    howToBeSure:
      "Refusals block the run and are listed with a code and a required action; notes never block " +
      "and never carry a code.",
    authorityIds: ["net-pay-rcw-49-52-050-rebate"],
  },
];

/** Field names this module actually teaches. Used by the coverage gate. */
export function taughtNetPayFieldNames(): readonly string[] {
  return NET_PAY_FIELD_LESSONS.map((l) => l.field);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) THE SCREEN LESSONS - the ideas, not the fields
 * ═══════════════════════════════════════════════════════════════════════════ */

export type NetPayScreenLesson = {
  readonly topic: string;
  readonly plainEnglish: string;
  readonly whyItMatters: string;
  readonly authorityIds: readonly string[];
};

export const NET_PAY_SCREEN_LESSONS: readonly NetPayScreenLesson[] = [
  {
    topic: "Every number can be right and the cheque still wrong",
    plainEnglish:
      "A paycheque is not a pile of deductions, it is a SEQUENCE. Gross pay comes first. Then the " +
      "deductions the law forces out, which produce disposable earnings. Then garnishments, which " +
      "are percentages of that figure. Then the deductions the employee signed up for. What is " +
      "left is net pay. Each step feeds the next, so the order is part of the arithmetic rather " +
      "than a matter of presentation.",
    whyItMatters:
      "This is the failure mode that has no symptom. If a tax rate is wrong, a figure looks odd. If " +
      "hours are wrong, someone complains. If the ORDER is wrong, every individual number is " +
      "defensible, the cheque foots, the ledger balances, and the garnishment remittance is quietly " +
      "wrong on every cheque for years. Nothing surfaces it except recomputing it in the right " +
      "order, which is what this engine does.",
    authorityIds: ["net-pay-usc-15-1672-base", "net-pay-fs30-legally-required"],
  },
  {
    topic: "Disposable earnings is not take-home pay, and the difference is the whole game",
    plainEnglish:
      "Two numbers sit near the bottom of a pay stub and they are not the same. Disposable earnings " +
      "is gross minus ONLY what the law requires. Take-home is gross minus everything, including " +
      "health insurance and retirement. Garnishment percentages apply to the first one. Take-home " +
      "is simply not used for this purpose at all.",
    whyItMatters:
      "Take-home is the smaller number and it is the one printed in bold, so it is the one people " +
      "reach for. Using it means every garnishment is computed on too small a base, which " +
      "under-pays the order. On an ordinary creditor garnishment that is the creditor's problem. On " +
      "a child-support order the employer who under-withholds can be made to pay the difference " +
      "personally.",
    authorityIds: ["net-pay-usc-15-1672-base", "net-pay-fs30-voluntary-excluded"],
  },
  {
    topic: "The L&I premium was missing from the base, and that is not a rounding detail",
    plainEnglish:
      "Washington makes the employer take half the medical-aid premium out of the worker's pay. The " +
      "statute says 'shall deduct', and the very next subsection makes deducting the wrong amount a " +
      "gross misdemeanor. Until books-37 the garnishment engine did not count it among the " +
      "required deductions, so disposable earnings were computed as if that money were still in " +
      "the employee's pocket.",
    whyItMatters:
      "The effect is small per cheque and it never stops. Disposable earnings came out too high, so " +
      "the creditor's twenty-five percent came out too high, taken from an employee whose wages are " +
      "already under a court order. Nobody would ever have spotted it from the totals - the cheque " +
      "balanced perfectly every single time. It was found by asking, for each deduction on the " +
      "stub, whether a law compels it.",
    authorityIds: ["net-pay-rcw-51-16-140-required", "net-pay-fs30-legally-required"],
  },
  {
    topic: "Health insurance feels required and legally is not",
    plainEnglish:
      "The test is not whether the employee can practically avoid the deduction. It is whether the " +
      "STATE compels it. Health premiums, retirement contributions, union dues, charitable giving " +
      "and repayment of a payroll advance are all voluntary in this sense, however automatic they " +
      "feel, and none of them reduce the base a garnishment is measured against.",
    whyItMatters:
      "This is the most common garnishment error in payroll, and it is common precisely because the " +
      "wrong answer looks completely ordinary. The DOL's enforcement guidance lists these by name. " +
      "The engine therefore reports the voluntary deductions it did NOT subtract, rather than " +
      "silently omitting them, so the exclusion is something you can see rather than something you " +
      "have to trust.",
    authorityIds: ["net-pay-fs30-voluntary-excluded", "net-pay-rcw-49-52-060-authorized"],
  },
  {
    topic: "An unauthorised deduction is a crime in Washington, so the engine stops instead of warning",
    plainEnglish:
      "RCW 49.52.050 makes it a misdemeanor to take a rebate of wages or to pay less than what is " +
      "owed, and it names 'any employer or officer, vice principal or agent'. RCW 49.52.060 gives " +
      "the only ways out: the law requires the deduction, or the employee authorised it IN WRITING, " +
      "IN ADVANCE, for something that benefits them.",
    whyItMatters:
      "Because the statute reaches officers and agents personally, this is not only a company " +
      "exposure - it reaches Michael by name. 'In advance' is the part that catches people: taking " +
      "the deduction on Friday and collecting the signature the following week does not satisfy " +
      "the section, because the authorisation has to exist before the money moves. A refusal costs " +
      "five minutes. A wage claim costs doubled damages and attorney fees.",
    authorityIds: ["net-pay-rcw-49-52-050-rebate", "net-pay-rcw-49-52-060-authorized"],
  },
  {
    topic: "Why the engine refuses a negative cheque instead of clamping it to zero",
    plainEnglish:
      "If the deductions add up to more than the employee earned this period, the software stops " +
      "and says so. It does not quietly print a cheque for zero, and it does not carry the excess " +
      "forward into the next period on its own initiative. It refuses the run and names the " +
      "employee, so that a person decides what happens next rather than the software choosing the " +
      "least alarming-looking outcome.",
    whyItMatters:
      "A zero cheque is a plausible-looking artefact of an impossible situation, and it hides the " +
      "cause. Something genuinely wrong produced it: a duplicated deduction, a garnishment computed " +
      "on the wrong base, a repayment schedule that outgrew the pay period. Clamping to zero throws " +
      "away the only evidence. Refusing keeps the inputs intact so the actual cause can be found " +
      "and fixed before anyone is paid.",
    authorityIds: ["net-pay-rcw-49-52-050-rebate"],
  },
  {
    topic: "Year-to-date is not a report, it is an input",
    plainEnglish:
      "The Social Security ceiling and the Additional Medicare threshold are ANNUAL tests. A single " +
      "pay run, looked at on its own, cannot apply them - it has no idea what the employee has " +
      "already been paid. The year-to-date store is what supplies that, and it is written as part " +
      "of the same operation that computes the cheque.",
    whyItMatters:
      "Before this, the one place in the app that computed taxes passed a zeroed year-to-date " +
      "record on every call. For an employee below the wage base that gives the right answer all " +
      "year, which is exactly why nothing ever looked wrong - and it is the same code path that " +
      "will be wrong the first time a shareholder salary or a bonus crosses the base.",
    authorityIds: ["w2-box3-wage-base-ceiling", "w2-worked-example-199750"],
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) THE REFUSALS - why stopping beats guessing
 * ═══════════════════════════════════════════════════════════════════════════ */

export type NetPayRefusalLesson = {
  readonly code: NetPayRefusalCode;
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
 * The gate in `net-pay-mentor-gates.ts` parses the engine's own union type FROM
 * DISK and fails if a code ships untaught - or if a lesson outlives the code it
 * explains, which is the more dangerous of the two because the count still
 * looks right while a live code goes unexplained.
 */
export const NET_PAY_REFUSAL_LESSONS: readonly NetPayRefusalLesson[] = [
  {
    code: "NET_PAY_TAXES_REFUSED",
    headline: "The tax calculation refused, so there is no cheque to build.",
    whyWeStop:
      "Net pay is gross minus withholding minus everything else. If the withholding engine could " +
      "not produce a figure it trusted, there is nothing to subtract, and inventing a zero would " +
      "produce a cheque that is too large by exactly the amount of tax that should have come out - " +
      "money already handed over before anyone notices.",
    whatToDo:
      "Read the underlying tax refusal, which is passed through unchanged rather than summarised. " +
      "It names the specific input it could not accept - usually a missing W-4 field or a filing " +
      "status that was never set.",
  },
  {
    code: "NET_PAY_GARNISHMENT_REFUSED",
    headline: "A wage order could not be computed, so the whole cheque stops.",
    whyWeStop:
      "The alternative is paying the employee in full and sorting the order out later, and that is " +
      "the worst available option: the money is gone, the order is still owed, and on a support " +
      "order the employer can be liable for the amount that should have been withheld. Stopping " +
      "keeps the money where it can still be directed correctly.",
    whatToDo:
      "Open the garnishment screen for that employee. The refusal names the order and the field it " +
      "needs - most often whether the employee supports a second family, or whether arrears exceed " +
      "twelve weeks, since those two answers change the support cap.",
  },
  {
    code: "NET_PAY_DEDUCTION_NOT_AUTHORIZED",
    headline: "A voluntary deduction has no written authorisation on file.",
    whyWeStop:
      "RCW 49.52.050 makes an unauthorised deduction a misdemeanor and names officers and agents " +
      "personally, and RCW 49.52.060 requires the authorisation to be in writing IN ADVANCE. " +
      "Taking the money and collecting the paperwork afterwards does not satisfy the statute, so " +
      "there is no version of 'proceed and fix it later' that is lawful.",
    whatToDo:
      "Get the employee's signature before the run, not after. If the paperwork exists but the flag " +
      "was never set, set it and re-run. If it genuinely does not exist, remove the deduction from " +
      "this cheque and start it next period.",
  },
  {
    code: "NET_PAY_DEDUCTION_NOT_WHOLE_CENTS",
    headline: "A deduction amount is not a whole number of cents.",
    whyWeStop:
      "Every figure in this system is an integer number of cents precisely so that nothing moves by " +
      "a rounding artefact. A fractional cent arriving here means the amount was computed as a " +
      "floating-point number somewhere upstream, and the first symptom of that is a cheque that " +
      "will not reconcile against the ledger by a penny nobody can locate.",
    whatToDo:
      "Fix the source of the amount rather than rounding it here. Rounding at the point of use " +
      "hides which upstream calculation is producing fractions, and it will produce a different " +
      "fraction next period.",
  },
  {
    code: "NET_PAY_WOULD_GO_NEGATIVE",
    headline: "The deductions add up to more than the employee earned this period.",
    whyWeStop:
      "There is no lawful cheque here and no honest way to shrink one. Clamping to zero would " +
      "produce a plausible-looking document that conceals whatever actually caused it, and the " +
      "employee would receive nothing without anybody being told why.",
    whatToDo:
      "Look for the cause in this order: a deduction entered twice, a garnishment computed on the " +
      "wrong base, or a repayment instalment larger than the period can carry. Reduce or defer the " +
      "voluntary deductions - they are last in line by law and they are the only part of the stack " +
      "you are free to move.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * 4) THE REVIEW CHECKS - what to look at before releasing a pay run
 * ═══════════════════════════════════════════════════════════════════════════ */

export type NetPayReviewCheck = {
  readonly question: string;
  readonly why: string;
  readonly howToCheck: string;
};

/**
 * The questions a reviewer asks BEFORE the money moves.
 *
 * Deliberately phrased as questions rather than assertions: a checklist that
 * states conclusions gets ticked, a checklist that asks questions gets read.
 */
export const NET_PAY_REVIEW_CHECKS: readonly NetPayReviewCheck[] = [
  {
    question: "Does disposable earnings sit between net pay and gross pay on every line?",
    why:
      "It must, by definition - it has more subtracted than gross and less subtracted than net. A " +
      "line where it equals net pay means the voluntary deductions were wrongly included in the " +
      "base; a line where it equals gross means no tax came out at all.",
    howToCheck:
      "The net-pay screen shows all three side by side for each employee, so the ordering is " +
      "visible at a glance rather than requiring arithmetic.",
  },
  {
    question: "Is the L&I employee premium showing inside the required-by-law bucket?",
    why:
      "This is the deduction that was missing before books-37. If it ever silently drops out again, " +
      "disposable earnings rise, and every garnishment on the run quietly takes too much.",
    howToCheck:
      "The required-by-law breakdown itemises it separately rather than folding it into a single " +
      "'taxes' total, specifically so its absence is visible.",
  },
  {
    question: "Does every voluntary deduction on the run have written authorisation on file?",
    why:
      "An unauthorised deduction is a misdemeanor in Washington and the statute reaches officers " +
      "personally. The engine refuses rather than warns, so a run that completed has already " +
      "passed this - but a run that refused will name exactly which one is missing.",
    howToCheck:
      "The refusal names the employee and the deduction label. The employee's record holds the " +
      "authorisation flag and the date it was signed.",
  },
  {
    question: "For anyone with a garnishment, has their year-to-date crossed the Social Security ceiling?",
    why:
      "When Social Security withholding stops, disposable earnings jump, and the garnishment jumps " +
      "with them. That is correct, and it will look alarming to the employee. Knowing it is coming " +
      "means explaining it rather than investigating it.",
    howToCheck:
      "The year-to-date screen shows the remaining room against the wage base for every active " +
      "employee.",
  },
  {
    question: "Do the components of every cheque add back up to its net pay?",
    why:
      "Two compensating errors produce a correct-looking net pay with a wrong garnishment " +
      "remittance behind it. Re-adding the parts is the only way to catch that, because the total " +
      "alone looks fine.",
    howToCheck:
      "`netPayReconciles` performs exactly this addition and reports the difference; the screen " +
      "shows a reconciliation status per line rather than only on the run as a whole.",
  },
];
