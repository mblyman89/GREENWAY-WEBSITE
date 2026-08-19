/**
 * src/lib/payroll/payroll-withholding-guidance-core.ts   (slice books-13)
 *
 * THE MENTOR THAT STANDS BETWEEN MICHAEL AND A PAYROLL FIGURE.
 * =============================================================================
 *
 * Michael, recorded verbatim (standing rule 1):
 *
 *   "I want all the blockers state why they blocked, and to help fix it where it
 *    is meant to be fixed. Like if I need to modify a number on the form,
 *    because it is setup to allow me to modify it, the moment i try to modify a
 *    number, the system will jump in and say hey, you can't do that here, what
 *    are you trying to accomplish... and then help them discover the proper path
 *    to get that number on the form to change properly with the proper audit
 *    trail that follows. That's true mentoring behavior and the type of hand
 *    holding I want baked into our system."
 *
 * -----------------------------------------------------------------------------
 * WHAT A "BLOCKER" IS HERE, AND WHAT IT IS NOT
 * -----------------------------------------------------------------------------
 * A blocker in this module is NOT a validation error. A validation error says
 * "that value is not allowed" and leaves the person exactly where they were,
 * frustrated, with a form that will not submit. That is the behavior of software
 * that has rules but no opinions.
 *
 * A blocker here is an INTERCEPTION followed by a REDIRECTION. It has five
 * parts, and a blocker missing any of them is refused by the self-tests:
 *
 *   1. WHAT I STOPPED  - the specific edit, named in the user's own words.
 *   2. WHY             - in plain English, with the actual consequence spelled
 *                        out, not "this field is read-only".
 *   3. THE AUTHORITY   - a real citation with a verbatim quote, so Michael can
 *                        check me rather than trust me. Rule 1 cuts both ways:
 *                        I do not guess, and he does not have to take my word.
 *   4. WHAT YOU ARE PROBABLY TRYING TO DO - stated as a question, because the
 *                        same blocked keystroke can mean four different things
 *                        and guessing which one is how mentoring turns into
 *                        nagging.
 *   5. THE CORRECT PATH - a concrete route to the same outcome, done properly,
 *                        WITH the audit trail that route produces. Every path
 *                        names the record it writes. A "correct path" that
 *                        leaves no trace is not a correct path; it is the same
 *                        problem with extra steps.
 *
 * -----------------------------------------------------------------------------
 * WHY THE FORM FIELDS ARE NOT SIMPLY LOCKED
 * -----------------------------------------------------------------------------
 * Because Michael will need to change these numbers. Not hypothetically -
 * routinely. An employee submits a new W-4, an ESD rate notice arrives, a
 * timecard was wrong, a bonus was run as regular pay. Every one of those is a
 * legitimate reason for a payroll figure to change, and a system that answers
 * all of them with a grey box teaches him that the software is an obstacle to
 * work around. Then, one day, he works around it - in a spreadsheet, or by
 * hand-typing a 941 - and the audit trail ends there.
 *
 * So the field is not grey. The field looks editable, because the NUMBER is
 * changeable. What is blocked is changing it HERE, at the end, where the change
 * would have no cause. Every blocker below therefore ends by pointing upstream
 * to the place where the same number has a reason attached to it.
 *
 * -----------------------------------------------------------------------------
 * WHY THE AUDIT TRAIL IS PART OF THE BLOCKER AND NOT A SEPARATE FEATURE
 * -----------------------------------------------------------------------------
 * RCW 49.52.060 makes it explicit for wage deductions - a deduction is lawful
 * only if it is "openly, clearly and in due course recorded in the employer's
 * books." Washington wrote the audit trail into the statute. It is not our
 * house style; it is the condition on which the deduction is legal at all.
 *
 * For federal payroll the pressure is even more direct. Withheld money is a
 * "special fund in trust for the United States" under 26 U.S.C. 7501, and
 * section 6672 reaches through the S-corp to Michael personally for 100% of it.
 * When the money is held in trust and the penalty is personal, "who changed this
 * number, when, and on what evidence" is not bookkeeping hygiene. It is the
 * defense.
 *
 * -----------------------------------------------------------------------------
 * PURITY
 * -----------------------------------------------------------------------------
 * Everything here is pure: no I/O, no Date.now(), no randomness, no Supabase,
 * no server-only imports. Every function is a total function of its arguments so
 * the self-tests can sweep whole domains rather than sample one happy value
 * (standing rule 15b). The .tsx screens render DATA from this file - a diagram
 * that drifts from the engine is worse than no diagram, because it teaches the
 * wrong thing with confidence.
 *
 * RULE FOR MAINTAINERS: `quote` fields in the authorities this module cites are
 * TRANSCRIPTIONS. Do not paraphrase, tidy, modernise, or "fix" them. If a quote
 * is wrong, fix it against the PRIMARY SOURCE and update the test - never the
 * other way around.
 */

import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import {
  findPayrollAuthority,
  resolvePayrollAuthorities,
} from "./payroll-tax-authorities";
import { formatCentsPlain } from "./payroll-withholding-core";

// ===========================================================================
// 1) THE SHAPE OF A BLOCKER
// ===========================================================================

/**
 * Every field on a payroll screen that a person can put a cursor into and which
 * must not be typed over directly.
 *
 * These are deliberately named after WHAT MICHAEL SEES, not after the database
 * column. He is not editing `fica_oasdi_employee_cents`; he is editing the
 * number next to the words "Social Security" on a pay stub. A blocker that
 * opens by naming a column he has never heard of has already lost him.
 */
export type PayrollEditTarget =
  | "federal_income_tax_withheld"
  | "social_security_withheld"
  | "medicare_withheld"
  | "additional_medicare_withheld"
  | "wa_paid_leave_withheld"
  | "wa_cares_withheld"
  | "lni_employee_withheld"
  | "gross_wages"
  | "hours_worked"
  | "net_pay"
  | "employer_futa"
  | "employer_suta"
  | "wage_base_ytd"
  | "w4_filing_status"
  | "w4_step2_checkbox"
  | "941_line_5a_taxable_social_security"
  | "941_line_7_fractions_of_cents";

export const ALL_PAYROLL_EDIT_TARGETS: readonly PayrollEditTarget[] = [
  "federal_income_tax_withheld",
  "social_security_withheld",
  "medicare_withheld",
  "additional_medicare_withheld",
  "wa_paid_leave_withheld",
  "wa_cares_withheld",
  "lni_employee_withheld",
  "gross_wages",
  "hours_worked",
  "net_pay",
  "employer_futa",
  "employer_suta",
  "wage_base_ytd",
  "w4_filing_status",
  "w4_step2_checkbox",
  "941_line_5a_taxable_social_security",
  "941_line_7_fractions_of_cents",
] as const;

/** What Michael sees on screen, for each target. */
export const PAYROLL_EDIT_TARGET_LABELS: Record<PayrollEditTarget, string> = {
  federal_income_tax_withheld: "Federal income tax withheld",
  social_security_withheld: "Social Security withheld",
  medicare_withheld: "Medicare withheld",
  additional_medicare_withheld: "Additional Medicare withheld",
  wa_paid_leave_withheld: "WA Paid Leave withheld",
  wa_cares_withheld: "WA Cares withheld",
  lni_employee_withheld: "L&I withheld (employee half)",
  gross_wages: "Gross wages",
  hours_worked: "Hours worked",
  net_pay: "Net pay",
  employer_futa: "Federal unemployment (FUTA)",
  employer_suta: "Washington unemployment (SUTA)",
  wage_base_ytd: "Year-to-date wages toward the wage base",
  w4_filing_status: "Filing status from the W-4",
  w4_step2_checkbox: "Step 2 checkbox on the W-4",
  "941_line_5a_taxable_social_security": "Form 941, line 5a - taxable Social Security wages",
  "941_line_7_fractions_of_cents": "Form 941, line 7 - fractions of cents",
};

/**
 * HOW HARD IS THIS BLOCK?
 *
 * Not every interception is a refusal, and pretending otherwise is how a mentor
 * becomes noise. Three levels, and the difference between them is real:
 *
 *  - `teach`   The edit is legitimate and will go through. We interrupt once to
 *              make sure he knows what it will do downstream, and we get out of
 *              the way. Dismissible.
 *  - `reroute` The edit is not allowed HERE, but the outcome he wants is
 *              entirely legitimate and there is a specific place to get it.
 *              We refuse the keystroke and hand him the route. This is the
 *              common case and the one Michael described.
 *  - `refuse`  The outcome itself is unlawful or destroys the trust-fund audit
 *              trail. There is no correct path to what was attempted, only a
 *              correct path to the underlying goal. Never dismissible.
 */
export type BlockerSeverity = "teach" | "reroute" | "refuse";

export const BLOCKER_SEVERITY_MEANING: Record<BlockerSeverity, string> = {
  teach:
    "You can do this. I am stopping you once so you know what it changes downstream, and then I " +
    "will get out of your way.",
  reroute:
    "Not here - but yes, absolutely, and here is where. The number you want to change is real and " +
    "changeable; it just needs a reason attached to it, and this screen has nowhere to put one.",
  refuse:
    "No, and not anywhere else either. What was attempted is not a thing that can be done lawfully " +
    "or without destroying the record. There is still a correct path - to the underlying problem, " +
    "not to this edit.",
};

export const BLOCKER_SEVERITY_RANK: Record<BlockerSeverity, number> = {
  refuse: 0,
  reroute: 1,
  teach: 2,
};

/**
 * A route to the outcome, done properly.
 *
 * `auditTrail` is required and is checked by the self-tests for a non-trivial
 * value, because a path that leaves no record is not a correct path. Naming the
 * record also does something subtler: it tells Michael, before he starts, what
 * will exist afterward with his name on it. That is the difference between an
 * audit trail he maintains and an audit trail that happens to him.
 */
export type CorrectPath = {
  /** Imperative and specific: "Enter the corrected timecard", not "review hours". */
  action: string;
  /** Where he physically goes. A screen name he can find in the nav. */
  where: string;
  /** What record this produces, in plain words. Never empty. */
  auditTrail: string;
  /** What the number on THIS screen will do once he has done it. */
  thenWhat: string;
};

/**
 * A mentoring blocker: the whole five-part interception, as data.
 */
export type PayrollBlocker = {
  /** Stable id for tests, telemetry, and cross-references. */
  id: string;
  target: PayrollEditTarget;
  severity: BlockerSeverity;
  /** The opening line. Conversational, first person, no jargon, no blame. */
  whatIStopped: string;
  /** Why, with the actual consequence. Multiple sentences is fine. */
  why: string;
  /**
   * "What are you trying to accomplish?" - the question Michael asked for by
   * name. Phrased as OPTIONS, because the same blocked keystroke means
   * different things on different days and the system does not know which.
   */
  whatAreYouTryingToDo: readonly string[];
  /** One route per intent, in the same order as `whatAreYouTryingToDo`. */
  correctPaths: readonly CorrectPath[];
  /** Authority ids in payroll-tax-authorities.ts. Never empty. */
  authorityIds: readonly string[];
  /**
   * The sentence Michael reads if he only reads one sentence. Deliberately
   * separate from `why`, which he reads when he wants the whole story.
   */
  oneLine: string;
};

// ===========================================================================
// 2) THE BLOCKERS
// ===========================================================================

/**
 * THE CENTRAL ONE. Typing over a computed withholding figure.
 *
 * This is the edit Michael described, and it is the one that matters most,
 * because it is the one that looks harmless. Changing "Social Security
 * withheld" from $124.00 to $120.00 on a pay stub does not feel like tampering
 * with a federal trust fund. It feels like fixing a typo.
 */
export const BLOCK_EDIT_COMPUTED_WITHHOLDING: PayrollBlocker = {
  id: "edit-computed-withholding",
  target: "social_security_withheld",
  severity: "reroute",
  whatIStopped:
    "You just tried to type over the Social Security amount on this paycheck. Hang on a second " +
    "before you do - what are you trying to accomplish?",
  why:
    "That number is not stored anywhere. It is 6.2% of this employee's wages up to $184,500 for the " +
    "year, recomputed from their wages every single time this screen opens. If I let you type $120.00 " +
    "over it, one of two things happens and both are bad. Either it does not stick, and you spend a " +
    "week thinking the software is broken - or it does stick, and now the paycheck says one thing " +
    "while the wages that generated it say another, and the two will never agree again. At the end of " +
    "the quarter your Form 941 gets built from the wages, not from what the stub said, so the " +
    "difference shows up as an unexplained variance you will be trying to reconstruct in April.\n\n" +
    "The deeper reason is that this is not ordinary money. The instant it comes out of somebody's " +
    "check it is held in trust for the United States, and section 6672 lets the IRS collect 100% of " +
    "any shortfall from the responsible person individually. Being an S-corp does not stop that. So " +
    "the answer to 'why can't I just change it' is: because the reason for the change has to travel " +
    "with the number, and this box has nowhere to put a reason.",
  whatAreYouTryingToDo: [
    "The wages on this check are wrong, so the tax coming out of them is wrong too.",
    "The employee gave me a new W-4 and this should have been calculated differently.",
    "This person is over the Social Security wage limit and I think we kept withholding.",
    "A previous check withheld the wrong amount and I am trying to fix it on this one.",
    "I already know the right number because I checked it somewhere else.",
  ],
  correctPaths: [
    {
      action: "Correct the gross wages or the hours on this pay run and recalculate",
      where: "Payroll > this pay run > Edit wages",
      auditTrail:
        "A pay run revision entry: the old wage figure, the new one, who changed it, when, and the " +
        "reason you type in. Every tax on the check is then recomputed from the corrected wages, so " +
        "the stub and the wages agree by construction.",
      thenWhat: "Social Security updates on its own, to 6.2% of the corrected amount.",
    },
    {
      action: "Record the new Form W-4 with its effective date, then reopen this pay run",
      where: "Employees > this employee > Tax forms > New W-4",
      auditTrail:
        "The W-4 is stored as a dated document with the employee's electronic signature and the " +
        "perjury statement attached, and every paycheck after the effective date links back to it.",
      thenWhat:
        "Federal income tax changes. Social Security does NOT - a W-4 has no effect on FICA at all, " +
        "which is worth knowing before you go looking.",
    },
    {
      action: "Check the year-to-date Social Security wages against the $184,500 ceiling",
      where: "Payroll > this employee > Wage bases",
      auditTrail:
        "No change is recorded because you are reading, not editing. If the year-to-date figure " +
        "itself is wrong, that traces back to a specific pay run and gets corrected there.",
      thenWhat:
        "If they really are over the ceiling, withholding already stopped by itself. If the " +
        "year-to-date total is wrong, the pay run that made it wrong is the thing to fix.",
    },
    {
      action: "Record a prior-period correction rather than burying it in this check",
      where: "Payroll > Corrections > Prior period adjustment",
      auditTrail:
        "A standalone correction entry naming the original pay run, the amount, and the reason - " +
        "which is exactly what a Form 941-X needs later. Hiding it inside an unrelated paycheck " +
        "leaves nothing to file from.",
      thenWhat:
        "This check stays correct on its own terms, and the correction is separately visible and " +
        "separately explainable.",
    },
    {
      action: "Tell me where your figure came from and let me reconcile against it",
      where: "Payroll > this pay run > Compare to outside figure",
      auditTrail:
        "The comparison and its outcome are recorded either way, so if we disagree there is a record " +
        "of the disagreement and what was decided.",
      thenWhat:
        "If your number is right, something upstream is wrong and we find it. If mine is right, you " +
        "have the arithmetic in front of you and can see why. Either way, one of us learns something " +
        "and neither of us guesses.",
    },
  ],
  authorityIds: ["irc-3101-employee-fica", "irc-7501-trust-fund-payroll", "irc-6672-trust-fund-penalty-payroll"],
  oneLine:
    "This number is calculated from wages, not stored - change the wages or the W-4 and it will " +
    "follow, with a record of why.",
};

/**
 * Typing over net pay. The most tempting edit on the whole screen, because net
 * pay is the number the employee actually cares about.
 */
export const BLOCK_EDIT_NET_PAY: PayrollBlocker = {
  id: "edit-net-pay",
  target: "net_pay",
  severity: "reroute",
  whatIStopped:
    "You tried to set the take-home amount directly. I stopped it - but I suspect I know what you " +
    "are actually after, so tell me which one this is.",
  why:
    "Net pay is not an input, it is a subtraction: gross minus everything withheld. Typing a number " +
    "into it does not change what the employee earned or what came out; it just makes the bottom of " +
    "the stub stop matching the top of it. The employee will notice, because the lines no longer add " +
    "up, and they will be right.\n\n" +
    "Worth saying plainly: if the goal is to hand someone a specific round amount, the way to do it " +
    "is to work backwards from that amount to the gross that produces it - a gross-up. That is a real " +
    "and legitimate calculation, it is common for bonuses, and this system will do it for you. What " +
    "it will not do is write a smaller number on the stub and leave the tax alone, because the tax " +
    "was still withheld and still has to be paid over.",
  whatAreYouTryingToDo: [
    "I want this person to take home an exact round number, like $2,000.00 even.",
    "The gross pay on this check is wrong.",
    "There is a deduction on here that should not be, or one missing.",
    "I already paid them part of this in cash and I am netting it down.",
  ],
  correctPaths: [
    {
      action: "Use gross-up: enter the take-home you want and let me solve for the gross",
      where: "Payroll > this pay run > Gross up to target net",
      auditTrail:
        "The pay run records that it was grossed up, the target net you asked for, and the gross that " +
        "produced it - so a year from now the unusual-looking gross has its reason attached.",
      thenWhat:
        "Gross goes up, every tax recomputes on the higher gross, and net lands exactly on your " +
        "number. Note the employer cost goes up too, and you will see by how much before you commit.",
    },
    {
      action: "Correct the gross wages",
      where: "Payroll > this pay run > Edit wages",
      auditTrail: "A pay run revision entry with the before, the after, who, when, and why.",
      thenWhat: "Everything below it recomputes, including net.",
    },
    {
      action: "Add or remove the deduction itself, where deductions live",
      where: "Employees > this employee > Deductions",
      auditTrail:
        "The deduction record carries its authorization - and for anything that is not required by " +
        "law, RCW 49.52.060 requires the employee's written authorization IN ADVANCE, which gets " +
        "attached here. That is not our policy, that is the statute.",
      thenWhat: "The deduction appears or disappears on the stub as its own line, with its reason.",
    },
    {
      action: "Record the cash advance as an advance, then recover it as a deduction",
      where: "Employees > this employee > Advances",
      auditTrail:
        "An advance record and a repayment schedule, both signed. This one matters more than it " +
        "looks: an unrecorded cash advance netted out of a paycheck is indistinguishable, on paper, " +
        "from paying someone less than they earned - which RCW 49.52.050 makes a misdemeanor. Record " +
        "it and it is a loan being repaid. Do not record it and it is a wage violation waiting to be " +
        "found. In a cash business this is the single easiest way to get into trouble by accident.",
      thenWhat:
        "The stub shows the full gross, the full tax, and a clearly-labelled repayment line. Everyone " +
        "can see what happened, including you, later.",
    },
  ],
  authorityIds: ["rcw-49-52-050-wage-rebate", "rcw-49-52-060-authorized-withholding"],
  oneLine:
    "Net pay is the bottom of a subtraction - to change it, change something above it, or use " +
    "gross-up if you want an exact take-home.",
};

/**
 * The one with no correct path to the edit: suppressing FICA because a W-4 says
 * "exempt".
 */
export const BLOCK_EXEMPT_SUPPRESSES_FICA: PayrollBlocker = {
  id: "exempt-does-not-cover-fica",
  target: "social_security_withheld",
  severity: "refuse",
  whatIStopped:
    "You are trying to zero out Social Security and Medicare because this employee's W-4 says " +
    "'exempt'. I will not do that one, and I want to explain why rather than just refusing.",
  why:
    "'Exempt' on a Form W-4 is narrower than it sounds. It covers FEDERAL INCOME TAX WITHHOLDING and " +
    "nothing else. It does not touch Social Security, it does not touch Medicare, it does not touch " +
    "Washington Paid Leave or WA Cares or L&I. The word on the form is just 'Exempt', with no noun " +
    "after it, which is genuinely misleading - and this is one of the most common payroll mistakes " +
    "there is. You are not being careless; the form is badly worded.\n\n" +
    "The reason I refuse instead of warning is the consequence. If FICA is not withheld, the employer " +
    "still owes it - both halves, because the employee's half does not disappear just because you " +
    "did not collect it. It becomes yours. And it is trust-fund money, so section 6672 puts it on " +
    "you personally, not on the corporation. There is no version of this where letting it through is " +
    "the kinder option.",
  whatAreYouTryingToDo: [
    "The employee told me they are exempt and I am doing what they asked.",
    "This person is a student, or a family member, or is otherwise genuinely outside FICA.",
    "Their income tax withholding should be zero and I am at the wrong field.",
  ],
  correctPaths: [
    {
      action: "Record the exempt W-4 exactly as furnished - it will zero income tax and nothing else",
      where: "Employees > this employee > Tax forms > New W-4",
      auditTrail:
        "The W-4 is stored as a signed, dated document. Note that an exempt W-4 expires: it is good " +
        "only through February 15 of the following year, and if a new one is not furnished you revert " +
        "to withholding as Single with no adjustments. This system will remind you before that date, " +
        "which is the kind of thing that is very hard to remember on your own.",
      thenWhat:
        "Federal income tax goes to zero on the next check. FICA continues, correctly, and the stub " +
        "will show it - which is also how the employee finds out what 'exempt' actually meant.",
    },
    {
      action: "If there is a genuine statutory FICA exclusion, establish it on its own record",
      where: "Employees > this employee > Employment classification",
      auditTrail:
        "A classification record citing the specific exclusion and holding the evidence for it. This " +
        "is deliberately a separate, harder path than a checkbox, because a wrong FICA exclusion is " +
        "expensive and quiet - it does not surface until an audit, by which point it has compounded " +
        "for years across every check.",
      thenWhat:
        "FICA changes only if a real exclusion is established and evidenced. A claim on its own does " +
        "not move it.",
    },
    {
      action: "Go to the federal income tax line, which is the one 'exempt' actually governs",
      where: "This same pay run, the 'Federal income tax withheld' line",
      auditTrail: "None needed - you are moving to the right field, not making a change.",
      thenWhat: "You will find it is already zero, because the exempt W-4 already did that.",
    },
  ],
  authorityIds: [
    "pub15t-2026-exempt-scope",
    "irc-3101-employee-fica",
    "irc-3111-employer-fica",
    "irc-6672-trust-fund-penalty-payroll",
  ],
  oneLine:
    "'Exempt' on a W-4 means exempt from federal INCOME TAX withholding only - FICA keeps running, " +
    "and if you skip it you owe both halves personally.",
};

/**
 * Reclassifying withheld payroll money as anything other than a liability.
 * In a cash business this is the one that ends badly.
 */
export const BLOCK_RECLASSIFY_WITHHELD_LIABILITY: PayrollBlocker = {
  id: "reclassify-withheld-liability",
  target: "wage_base_ytd",
  severity: "refuse",
  whatIStopped:
    "You are moving withheld payroll tax out of the liability account - into income, or owner draw, " +
    "or an expense line. I am stopping that one hard.",
  why:
    "Money withheld from an employee's paycheck is not the company's money for even one second. " +
    "Section 7501 says it is 'a special fund in trust for the United States' from the moment it is " +
    "withheld. It sits in a liability account because it is somebody else's money that you are " +
    "holding, exactly like a customer deposit - and reclassifying it makes the books say you own " +
    "something you are only holding.\n\n" +
    "I am blunt about this one because of how the business actually runs. Greenway is cash-only. The " +
    "cash from a payday sits in the same drawer whether it is revenue or withheld tax, and nothing " +
    "physically separates them. The liability account IS the separation. When it is the only thing " +
    "keeping trust money distinct from operating money, moving a number out of it is not a " +
    "reclassification - it is spending the trust fund and then rewriting the books to match. Section " +
    "6672 makes that a personal liability for 100% of the amount, and 'I needed it for inventory' is " +
    "specifically the fact pattern the willfulness test was written for.\n\n" +
    "One more thing, particular to you: 280E already denies deductions for most of what this business " +
    "spends. Payroll tax you have properly accrued and paid is one of the few lines that is not in " +
    "dispute. Moving it to an expense account does not gain a deduction; it loses a clean liability " +
    "and creates a question.",
  whatAreYouTryingToDo: [
    "The liability balance looks wrong and I am trying to clear it out.",
    "I already paid this and it is still sitting there.",
    "I need the cash and I am recording that I used it.",
    "I am cleaning up an account that has never balanced since the Sage days.",
  ],
  correctPaths: [
    {
      action: "Reconcile the payroll liability against what was actually remitted",
      where: "Payroll > Liabilities > Reconcile",
      auditTrail:
        "A reconciliation record listing each deposit, its EFTPS confirmation, and the remaining " +
        "balance with an explanation for it. This is also exactly the working paper you want if the " +
        "IRS ever asks, so it is worth doing properly once.",
      thenWhat:
        "The balance becomes explainable line by line. Nine times out of ten a 'wrong' balance is a " +
        "deposit that was made but never recorded, and this finds it in minutes.",
    },
    {
      action: "Record the tax deposit against the liability",
      where: "Payroll > Liabilities > Record deposit",
      auditTrail:
        "The deposit entry carries the EFTPS confirmation number, the date, the period it applies to, " +
        "and which taxes it covered.",
      thenWhat: "The liability comes down by exactly what you paid, and the two match.",
    },
    {
      action: "Stop, and treat this as a cash-flow problem rather than a bookkeeping one",
      where: "Talk to your CPA before you do anything else",
      auditTrail:
        "Nothing is recorded, because nothing should be done here. This is not me being unhelpful. " +
        "If the withheld money has already been spent, that is a serious problem with real options - " +
        "installment agreements exist, and the IRS is markedly more workable with an employer who " +
        "comes forward than with one they catch. What has no good version is disguising it in the " +
        "ledger, because that turns a payment problem into a willfulness problem.",
      thenWhat:
        "Nothing changes in the books, on purpose. The books stay true, which keeps every option open.",
    },
    {
      action: "Route legacy Sage cleanup through the conversion process, not through this account",
      where: "Books > Conversion > Opening balance evidence",
      auditTrail:
        "Every opening balance is tied to the document that proves it, and any difference from Sage " +
        "is written into the drift register with an explanation rather than plugged.",
      thenWhat:
        "The account gets a defensible opening balance backed by evidence instead of a plug that " +
        "nobody can explain later - including you.",
    },
  ],
  authorityIds: ["irc-7501-trust-fund-payroll", "irc-6672-trust-fund-penalty-payroll"],
  oneLine:
    "Withheld payroll tax is trust money, not yours - it stays a liability until it is remitted, and " +
    "moving it makes a payment problem into a personal one.",
};

/**
 * Deducting more than half the medical aid premium from an employee. The
 * gross-misdemeanor blocker.
 */
export const BLOCK_LNI_OVER_DEDUCTION: PayrollBlocker = {
  id: "lni-over-deduction",
  target: "lni_employee_withheld",
  severity: "refuse",
  whatIStopped:
    "You are raising the L&I amount coming out of this employee's check. Before that goes any " +
    "further - Washington puts a hard ceiling on this specific deduction, and going over it is a " +
    "criminal matter rather than a billing dispute.",
  why:
    "Your L&I premium has parts. There is an accident fund and pension piece, which is 100% the " +
    "employer's, and there is a MEDICAL AID piece, of which you may deduct up to half from the " +
    "worker. Half of the medical aid piece - not half of the total premium. Those two are very " +
    "different numbers, and taking half the total is the single most common L&I error there is.\n\n" +
    "RCW 51.16.140(2) makes deducting more than the allowed portion a GROSS MISDEMEANOR. Not a " +
    "penalty, not interest - a criminal charge, per occurrence, and 'occurrence' means per employee " +
    "per pay period. Twenty-six paychecks is twenty-six occurrences. That is why this is a refusal " +
    "and not a warning: there is no amount of explanation that makes it safe to let through.\n\n" +
    "There is a quieter detail worth knowing. When the employee's half of the medical aid comes out " +
    "to an odd number of cents, this system rounds the spare penny to the EMPLOYER, never to the " +
    "worker. One cent is not going to be prosecuted, but the direction of a rounding rule is a " +
    "decision, and where the law caps what you may take, the cap is the direction you round.",
  whatAreYouTryingToDo: [
    "My L&I rates changed and the amount coming out looks too low.",
    "I want to recover more of the premium from the employees.",
    "The hours on this check are wrong so the L&I is wrong.",
    "I think this employee is in the wrong risk class.",
  ],
  correctPaths: [
    {
      action: "Load the new L&I rate notice and let the rates come from the document",
      where: "Settings > Payroll taxes > L&I rates > Upload rate notice",
      auditTrail:
        "The rate notice is stored as a document and each rate is linked to it, including which part " +
        "is medical aid. The split is what determines the legal ceiling, so it has to come from the " +
        "notice rather than from memory - and a year from now, both of us can see where it came from.",
      thenWhat:
        "The employee's half recalculates from the new medical aid rate, automatically and legally.",
    },
    {
      action: "There is no path to this one - the ceiling is statutory",
      // Deliberately a real destination even though the answer is no. Sending
      // Michael to "Nowhere" is the one thing a mentor must not do: it reads as
      // a shrug. Send him to the statute instead, so the refusal is checkable.
      where: "Read the rule: RCW 51.16.140(1) (linked from this message)",
      auditTrail:
        "Nothing is recorded because nothing can be done. Half of the medical aid portion is the " +
        "maximum, full stop. If premiums are a real cost problem, the lever is the risk class and " +
        "your claims experience, not the employee's paycheck.",
      thenWhat:
        "The deduction stays at the legal maximum. Which, for what it is worth, is where it already " +
        "was - this system never withholds less than it should either.",
    },
    {
      action: "Correct the hours on this pay run",
      where: "Payroll > this pay run > Edit hours",
      auditTrail:
        "A revision entry with the old hours, the new hours, and your reason. L&I is billed per hour " +
        "worked rather than as a percentage of pay, so hours are the only thing that moves it.",
      thenWhat: "Both halves of the L&I premium recalculate from the corrected hours.",
    },
    {
      action: "Change the risk classification, with the evidence for it",
      where: "Employees > this employee > L&I risk class",
      auditTrail:
        "A classification record with an effective date and the basis for the change. Risk class is " +
        "determined by the work actually performed, and getting it wrong is both a premium error and " +
        "an audit finding, so the reasoning is stored alongside the code.",
      thenWhat:
        "Future pay runs use the new class. Past ones do not move by themselves - if the class was " +
        "wrong historically, that is an amended quarterly report, which is its own process.",
    },
  ],
  authorityIds: [
    "rcw-51-16-140-lni-deduction",
    "rcw-51-16-035-lni-classification",
    "rcw-51-16-060-lni-hours",
    "rcw-49-52-050-wage-rebate",
  ],
  oneLine:
    "You may deduct half of the MEDICAL AID portion only - not half the total premium - and going " +
    "over it is a gross misdemeanor per paycheck.",
};

/**
 * Hand-typing Form 941 line 5a instead of letting it derive from the payroll.
 * The forms-builder blocker Michael specifically described.
 */
export const BLOCK_EDIT_941_DERIVED_LINE: PayrollBlocker = {
  id: "edit-941-derived-line",
  target: "941_line_5a_taxable_social_security",
  severity: "reroute",
  whatIStopped:
    "You are typing directly into line 5a of the 941. That line is built from the payroll underneath " +
    "it - so before you overwrite it, what is the number you are expecting?",
  why:
    "A tax form is a report, not a document. Every derived line on it is a query against the payroll " +
    "records for the quarter. If you type over line 5a, the form no longer describes the payroll it " +
    "was built from, and you have quietly created two versions of the truth: the one you filed and " +
    "the one in your books. That gap does not stay hidden. It surfaces the following January when " +
    "the W-2s are produced from the payroll records and the totals do not agree with the four 941s " +
    "already on file - and reconciling that after the fact, across four quarters, is genuinely awful " +
    "work.\n\n" +
    "The instinct to type over it is usually right about something, though. If line 5a looks wrong, " +
    "it very often IS wrong - because something in the underlying payroll is wrong. Overwriting the " +
    "form hides the symptom and keeps the disease. So let us go find it; that is a much shorter job " +
    "than it sounds, and the form fixes itself at the end of it.",
  whatAreYouTryingToDo: [
    "The taxable wage total does not match what I think we paid this quarter.",
    "A paycheck is missing from this quarter, or one is in here twice.",
    "My deposits do not match the tax on this form.",
    "Somebody went over the Social Security wage limit and I do not think it was handled.",
  ],
  correctPaths: [
    {
      action: "Open the wage detail behind line 5a and find the check that is off",
      where: "Payroll > Quarterly > 941 > line 5a > Show detail",
      auditTrail:
        "Read-only. It lists every paycheck feeding the line, so you can spot the wrong one in a " +
        "single pass instead of guessing at the total.",
      thenWhat:
        "Almost always the discrepancy is one identifiable check. Fix that check and the line agrees " +
        "on its own, along with every other line that shares the same wages.",
    },
    {
      action: "Correct the pay run that is wrong, or add the one that is missing",
      where: "Payroll > Pay runs > the affected run",
      auditTrail:
        "A revision or a new pay run, each with its own reason. If the quarter has already been " +
        "filed, the system routes you to a 941-X instead, because amending a filed return is a " +
        "different act from correcting an open one and the paperwork is different.",
      thenWhat: "Line 5a, and every line derived from the same wages, updates together and stays consistent.",
    },
    {
      action: "Reconcile deposits separately from the tax - they are different questions",
      where: "Payroll > Liabilities > Reconcile",
      auditTrail: "A reconciliation record tying each deposit to its EFTPS confirmation and period.",
      thenWhat:
        "The tax lines say what you owed; the deposit lines say what you paid. If those differ, the " +
        "answer is a payment or a refund, not an edit to line 5a.",
    },
    {
      action: "Check the wage-base tracking for the employee who crossed the ceiling",
      where: "Payroll > Wage bases > this employee",
      auditTrail: "Read-only unless a pay run turns out to need correcting.",
      thenWhat:
        "You will see exactly which check crossed $184,500 and how it was split. If that is right, " +
        "line 5a is right and the expectation was off - which is also a useful thing to learn.",
    },
  ],
  authorityIds: ["ssa-2026-contribution-benefit-base", "irc-3101-employee-fica", "irc-7501-trust-fund-payroll"],
  oneLine:
    "Lines on a 941 are built from the payroll - if a line looks wrong, a paycheck is wrong, and " +
    "fixing the paycheck fixes the form and the W-2s together.",
};

/**
 * Line 7, fractions of cents. A `teach` rather than a block: this line is
 * genuinely meant to be adjustable, and the mentoring value is in explaining
 * what a large number there means.
 */
export const TEACH_941_FRACTIONS_OF_CENTS: PayrollBlocker = {
  id: "teach-941-fractions-of-cents",
  target: "941_line_7_fractions_of_cents",
  severity: "teach",
  whatIStopped:
    "You are editing line 7, fractions of cents. This one you genuinely can adjust - I am interrupting " +
    "once to say what it is for, and then it is yours.",
  why:
    "Line 7 exists because the tax the IRS computes on your quarterly totals and the tax you actually " +
    "withheld paycheck by paycheck can differ by a few cents. The instructions say so directly: the " +
    "employee share 'may differ slightly from amounts actually withheld from employees' pay due to the " +
    "rounding of social security and Medicare taxes based on statutory rates.' Line 7 absorbs that. It " +
    "can be positive or negative, and a few cents there is completely normal.\n\n" +
    "Here is the part worth knowing. This system computes FICA on a running total rather than " +
    "paycheck by paycheck, specifically so that rounding does not accumulate - which means your line 7 " +
    "should be at or very near zero every quarter. So if you find yourself typing dollars into it, " +
    "that is information. Line 7 is a place to absorb pennies, and using it to absorb dollars turns it " +
    "into a plug: the return balances, and the reason it did not balance on its own is gone. A " +
    "reconciling item you cannot explain is the thing an examiner pulls on first.",
  whatAreYouTryingToDo: [
    "I have a few cents of difference and I am clearing it, which is what this line is for.",
    "There are dollars of difference and I am making the return balance.",
    "I have no idea why this is not balancing and this is the only editable box.",
  ],
  correctPaths: [
    {
      action: "Go ahead - enter the cents",
      where: "Right here",
      auditTrail:
        "The adjustment is recorded with the amount and your note. Anything under a dollar is flagged " +
        "as routine and nobody will ever ask about it.",
      thenWhat: "The return balances and you are done.",
    },
    {
      action: "Stop before you plug it - run the quarter reconciliation first",
      where: "Payroll > Quarterly > Reconcile quarter",
      auditTrail:
        "A reconciliation record showing each difference and its cause. Dollars of variance in " +
        "fractions of cents essentially always means something real: a manual check that never made " +
        "it in, a correction posted to the wrong quarter, or a rate that changed mid-quarter.",
      thenWhat:
        "You find the actual cause, fix it at the source, and line 7 goes back to pennies on its own.",
    },
    {
      action: "Let me walk the whole quarter with you and show you where it diverges",
      where: "Payroll > Quarterly > Reconcile quarter > Guided walkthrough",
      auditTrail:
        "The walkthrough records what was examined and what was found, so if the answer is 'we could " +
        "not identify it', even that is documented - which is a far better position than a silent plug.",
      thenWhat:
        "Either we find it, or we document precisely what we could not find and why. Both of those " +
        "are defensible. A number typed in to make the form balance is not.",
    },
  ],
  authorityIds: ["irc-3101-employee-fica", "irc-3111-employer-fica"],
  oneLine:
    "Line 7 is for pennies of rounding - if you are putting dollars in it, something real is wrong " +
    "and the plug will hide it.",
};

/**
 * Editing the W-4 on the employee's behalf. A refusal grounded in the
 * electronic-substitute rules discovered in research.
 */
export const BLOCK_EDIT_W4_ON_BEHALF: PayrollBlocker = {
  id: "edit-w4-on-behalf",
  target: "w4_filing_status",
  severity: "refuse",
  whatIStopped:
    "You are changing the filing status on an employee's W-4 for them. I will not let that through, " +
    "and the reason is more about protecting you than about protecting them.",
  why:
    "A Form W-4 is the employee's sworn statement. It carries a penalties-of-perjury declaration that " +
    "THEY sign. When an employer edits one on the employee's behalf, the document stops being what it " +
    "claims to be - and if the withholding later turns out to be wrong, the employer is holding a " +
    "certificate they modified themselves. That is a bad position to be in for what is usually a " +
    "two-minute favour.\n\n" +
    "The IRS is also unusually specific about electronic W-4 systems. Pub. 15-T says the allowance of " +
    "an electronic substitute 'isn't a license to simplify or modify the Form W-4', requires the " +
    "employee to be able to see all the text of Steps 2 through 4, requires that any collapsible " +
    "toggles default to OFF, requires a hyperlink to the form on IRS.gov, and requires the perjury " +
    "statement to be signed as the FINAL entry. Our W-4 screen is built to those rules exactly - it " +
    "is the one screen in this whole product that deliberately breaks our own design conventions, " +
    "because the IRS's rules win.",
  whatAreYouTryingToDo: [
    "The employee told me verbally what to change and asked me to do it.",
    "There is an obvious mistake on the form they filed.",
    "The form is old and I want to bring it up to date.",
    "Too much or too little is coming out and I am trying to fix it for them.",
  ],
  correctPaths: [
    {
      action: "Send them the W-4 to complete and sign themselves",
      where: "Employees > this employee > Tax forms > Request new W-4",
      auditTrail:
        "The request, the completion, and the employee's electronic signature with the perjury " +
        "statement are all recorded with timestamps - which is precisely the documentation that " +
        "protects you if the withholding is ever questioned. It takes them about ninety seconds.",
      thenWhat: "Withholding changes from the effective date forward.",
    },
    {
      action: "Point out the mistake to them and let them file a corrected one",
      where: "Employees > this employee > Tax forms > Flag for employee review",
      auditTrail:
        "A note recording what you flagged and when. You may absolutely tell an employee their form " +
        "looks wrong - you simply may not fix it for them.",
      thenWhat: "Nothing changes until they file a new one. The old form stays in force until then.",
    },
    {
      action: "Leave the old form alone - a valid W-4 does not expire",
      where: "Nowhere - no action needed",
      auditTrail:
        "None. A 2019-or-earlier W-4 stays valid indefinitely and this system computes it correctly " +
        "using the allowance method, so there is nothing to fix. The only W-4 that does expire is one " +
        "claiming exempt, which lapses on February 15 each year.",
      thenWhat: "Withholding continues correctly on the old form.",
    },
    {
      action: "Give them the IRS estimator rather than adjusting it yourself",
      where: "Employees > this employee > Tax forms > Send withholding estimator link",
      auditTrail:
        "The link and the date sent are recorded. Pub. 15 is explicit that you should not accept " +
        "extra withholding outside of a W-4 - if they want more taken out, it goes on Step 4(c) of a " +
        "form they sign.",
      thenWhat:
        "They come back with a new W-4 that reflects their actual situation, which is more likely to " +
        "be right than either of you guessing.",
    },
  ],
  authorityIds: ["pub15t-2026-no-w4-default", "pub15t-2026-exempt-scope"],
  oneLine:
    "A W-4 is the employee's sworn statement - they change it, you record it, and that separation is " +
    "what protects you.",
};

/**
 * Typing a SUTA rate in by hand instead of loading the notice. `reroute`,
 * because the rate is real and needs to be entered - just not from memory.
 */
export const BLOCK_TYPE_SUTA_RATE_FROM_MEMORY: PayrollBlocker = {
  id: "type-suta-rate-from-memory",
  target: "employer_suta",
  severity: "reroute",
  whatIStopped:
    "You are typing a Washington unemployment rate in directly. I would rather read it off the notice " +
    "than take it from memory - and there is a specific reason beyond general fussiness.",
  why:
    "Your SUTA rate is not a published number that anybody can look up. Employment Security calculates " +
    "it individually from your own layoff history and mails it to you each December, and it changes " +
    "every year. There is no way for me to check a typed rate against anything, which means a " +
    "transposed digit produces quarterly returns that balance perfectly and are wrong all year.\n\n" +
    "The rate also does more work than it looks like it does. Your FUTA credit under section 3302 is " +
    "capped at the LOWER of your actual state rate or 5.4%, so the state rate you enter here changes " +
    "your FEDERAL unemployment tax too. One wrong digit misstates both returns, in the same direction, " +
    "all year - and the two agreeing with each other makes it look right.",
  whatAreYouTryingToDo: [
    "I have the notice right here and I am just typing what it says.",
    "I cannot find the notice but I remember the rate.",
    "The rate changed mid-year and I am updating it.",
    "I am setting up payroll for the first time and do not have a rate yet.",
  ],
  correctPaths: [
    {
      action: "Upload the notice and confirm the rate I read off it",
      where: "Settings > Payroll taxes > Washington unemployment > Upload rate notice",
      auditTrail:
        "The notice is stored and the rate is linked to it, with the year it applies to. Next December " +
        "you will get a reminder, and if a return is ever questioned the source document is one click " +
        "away instead of in a drawer.",
      thenWhat: "SUTA computes, and your FUTA credit computes correctly from the same figure.",
    },
    {
      action: "Get a copy from your ESD online account - it is faster than looking for the paper",
      where: "esd.wa.gov, your employer account, Tax Rate Notice",
      auditTrail:
        "None until you upload it. Until then this system will keep refusing to compute SUTA, which " +
        "is deliberate: an accrual built on a remembered rate is worse than a visible gap, because a " +
        "gap gets fixed and a wrong number gets relied on.",
      thenWhat: "Once it is loaded, SUTA and the FUTA credit both start computing.",
    },
    {
      action: "Load the revised notice with its effective date",
      where: "Settings > Payroll taxes > Washington unemployment > Add rate revision",
      auditTrail:
        "Both notices are kept, each with its own effective period, so pay runs before and after the " +
        "change each use the rate that was actually in force at the time.",
      thenWhat: "Historic pay runs keep the old rate. New ones use the new one. Neither is rewritten.",
    },
    {
      action: "Register with ESD first - new employers get an assigned starting rate",
      where: "Settings > Payroll taxes > Washington unemployment > New employer setup",
      auditTrail:
        "The registration and the assigned rate notice are stored together, so the first year of " +
        "returns has its basis attached from day one.",
      thenWhat:
        "You get a rate from ESD, we load it, and payroll computes. Until then this stays blocked, " +
        "which is the honest answer rather than a placeholder.",
    },
  ],
  authorityIds: ["esd-suta-rate-structure", "irc-3302-futa-credit"],
  oneLine:
    "Your unemployment rate is unique to you and mailed to you - load the notice, because a typed rate " +
    "cannot be checked and it moves your federal tax too.",
};

// ===========================================================================
// 3) THE REGISTRY
// ===========================================================================

export const PAYROLL_BLOCKERS: readonly PayrollBlocker[] = [
  BLOCK_EDIT_COMPUTED_WITHHOLDING,
  BLOCK_EDIT_NET_PAY,
  BLOCK_EXEMPT_SUPPRESSES_FICA,
  BLOCK_RECLASSIFY_WITHHELD_LIABILITY,
  BLOCK_LNI_OVER_DEDUCTION,
  BLOCK_EDIT_941_DERIVED_LINE,
  TEACH_941_FRACTIONS_OF_CENTS,
  BLOCK_EDIT_W4_ON_BEHALF,
  BLOCK_TYPE_SUTA_RATE_FROM_MEMORY,
] as const;

/** Look one up by id. Returns undefined rather than throwing. */
export function findBlocker(id: string): PayrollBlocker | undefined {
  return PAYROLL_BLOCKERS.find((b) => b.id === id);
}

/**
 * Every blocker that can fire on a given field, hardest first.
 *
 * Ordered by severity because when two blockers apply to the same field, the
 * one that says "no, never" has to be read before the one that says "not here".
 * Showing a reroute above a refusal would send Michael down a path that ends in
 * a wall.
 */
export function blockersFor(target: PayrollEditTarget): readonly PayrollBlocker[] {
  return PAYROLL_BLOCKERS.filter((b) => b.target === target).sort(
    (a, b) => BLOCKER_SEVERITY_RANK[a.severity] - BLOCKER_SEVERITY_RANK[b.severity],
  );
}

/**
 * Resolve a blocker's citations to full authority records.
 *
 * Throws on a dangling id, by way of `resolvePayrollAuthorities`. A mentoring
 * blocker whose citation does not exist is worse than no blocker at all,
 * because it is authoritative-looking and empty - and Michael has explicitly
 * asked to be given sources he can check.
 */
export function authoritiesForBlocker(blocker: PayrollBlocker): GuidanceAuthority[] {
  return resolvePayrollAuthorities(blocker.authorityIds);
}

// ===========================================================================
// 4) THE AUDIT TRAIL A BLOCKER PRODUCES
// ===========================================================================

/**
 * WHY AN INTERCEPTION IS ITSELF RECORDED.
 *
 * Michael asked for "the proper audit trail that follows". Most of that trail
 * is produced by the correct path once he takes it. But the interception itself
 * is worth recording too, for three reasons that only become obvious later:
 *
 *  1. If the same blocker fires forty times, the software is wrong, not the
 *     user. A blocker that fires constantly is a missing feature wearing a
 *     lecture, and without a count nobody ever notices.
 *  2. If a figure is ever questioned, "an edit was attempted here, refused with
 *     this reason, and corrected upstream instead" is a far stronger record
 *     than silence. It shows a control that operated.
 *  3. It is evidence the control exists and works - which is exactly what an
 *     auditor means by testing a control rather than reading a policy.
 *
 * NO TIMESTAMP IS GENERATED HERE. This module is pure and must stay that way,
 * so the caller supplies `occurredAt`. A module that reaches for Date.now()
 * cannot be swept exhaustively by its own tests, and a clock is exactly the
 * kind of hidden input that makes a test pass on Tuesday and fail on Wednesday.
 */
export type BlockerAuditEntry = {
  kind: "payroll_edit_intercepted";
  blockerId: string;
  target: PayrollEditTarget;
  targetLabel: string;
  severity: BlockerSeverity;
  /** ISO 8601, supplied by the caller. Never generated in here. */
  occurredAt: string;
  /** Who tried it. */
  actorId: string;
  /** What they were trying to change it from and to, in integer cents. */
  attemptedFromCents: number | null;
  attemptedToCents: number | null;
  /** Which of the offered intents they picked, if any. */
  chosenIntentIndex: number | null;
  /** The path they were sent to, if they picked one. */
  chosenPathAction: string | null;
  /** The one-line reason, denormalised so the log reads without a join. */
  reason: string;
  /** Citations, denormalised for the same reason. */
  authorityIds: readonly string[];
};

/**
 * Build the audit entry for an interception.
 *
 * Validates rather than trusts: an audit record that is wrong is worse than no
 * audit record, because it will be believed. In particular the intent index is
 * bounds-checked against the blocker's own list, since an out-of-range index
 * would silently record that Michael chose an option that was never on screen.
 */
export function recordBlockerInterception(args: {
  blocker: PayrollBlocker;
  occurredAt: string;
  actorId: string;
  attemptedFromCents?: number | null;
  attemptedToCents?: number | null;
  chosenIntentIndex?: number | null;
}): BlockerAuditEntry {
  const {
    blocker,
    occurredAt,
    actorId,
    attemptedFromCents = null,
    attemptedToCents = null,
    chosenIntentIndex = null,
  } = args;

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(occurredAt)) {
    throw new Error(
      "recordBlockerInterception: occurredAt must be an ISO 8601 timestamp supplied by the caller. " +
        "This module is pure and does not read the clock.",
    );
  }
  if (actorId.trim().length === 0) {
    throw new Error(
      "recordBlockerInterception: an audit entry with no actor is not an audit entry. Refusing to " +
        "record an anonymous interception.",
    );
  }
  for (const [name, v] of [
    ["attemptedFromCents", attemptedFromCents],
    ["attemptedToCents", attemptedToCents],
  ] as const) {
    if (v !== null && !Number.isInteger(v)) {
      throw new Error(
        `recordBlockerInterception: ${name} must be integer cents or null - a float reached a money path`,
      );
    }
  }
  if (chosenIntentIndex !== null) {
    if (!Number.isInteger(chosenIntentIndex)) {
      throw new Error("recordBlockerInterception: chosenIntentIndex must be an integer or null");
    }
    if (chosenIntentIndex < 0 || chosenIntentIndex >= blocker.whatAreYouTryingToDo.length) {
      throw new Error(
        `recordBlockerInterception: chosenIntentIndex ${chosenIntentIndex} is not one of the ` +
          `${blocker.whatAreYouTryingToDo.length} options offered by blocker "${blocker.id}". ` +
          "Refusing to record that someone chose an option that was never on the screen.",
      );
    }
  }

  return {
    kind: "payroll_edit_intercepted",
    blockerId: blocker.id,
    target: blocker.target,
    targetLabel: PAYROLL_EDIT_TARGET_LABELS[blocker.target],
    severity: blocker.severity,
    occurredAt,
    actorId,
    attemptedFromCents,
    attemptedToCents,
    chosenIntentIndex,
    chosenPathAction:
      chosenIntentIndex === null ? null : blocker.correctPaths[chosenIntentIndex]!.action,
    reason: blocker.oneLine,
    authorityIds: blocker.authorityIds,
  };
}

/**
 * One line of human-readable log text for an interception.
 *
 * Written out rather than left to the UI because this string may end up in an
 * export, an email, or a working paper, and it should read the same everywhere.
 */
export function describeInterception(entry: BlockerAuditEntry): string {
  const amounts =
    entry.attemptedFromCents !== null && entry.attemptedToCents !== null
      ? ` (tried to change ${formatCentsPlain(entry.attemptedFromCents)} to ${formatCentsPlain(
          entry.attemptedToCents,
        )})`
      : "";
  const routed = entry.chosenPathAction ? ` Routed to: ${entry.chosenPathAction}.` : "";
  return (
    `${entry.occurredAt} - ${entry.actorId} was stopped editing "${entry.targetLabel}"${amounts}. ` +
    `${entry.reason}${routed}`
  );
}

// ===========================================================================
// 5) SELF-TESTS
// ===========================================================================

/**
 * Mirrored by tests/compliance/payroll-withholding-guidance-core.test.ts.
 *
 * These are structural: they enforce that every blocker is a COMPLETE blocker.
 * The failure mode this guards against is not a wrong calculation, it is a
 * half-written mentor - a blocker that stops Michael, explains nothing, cites
 * nothing, and offers nowhere to go. That reads as an obstacle rather than
 * guidance, and one of them poisons the credibility of all the others.
 */
export function __runPayrollWithholdingGuidanceTests(): { passed: number; failed: number } {
  const failures: string[] = [];
  let passed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else failures.push(name);
  };
  const eq = (got: unknown, want: unknown, name: string) => {
    if (got === want) passed += 1;
    else failures.push(`${name} (got ${String(got)}, want ${String(want)})`);
  };

  // --- every blocker is structurally complete ------------------------------
  const ids = PAYROLL_BLOCKERS.map((b) => b.id);
  eq(new Set(ids).size, ids.length, "blocker ids are unique");
  ok(PAYROLL_BLOCKERS.length > 0, "the registry is not empty");

  for (const b of PAYROLL_BLOCKERS) {
    ok(/^[a-z0-9-]+$/.test(b.id), `${b.id}: id is a slug`);
    ok(b.whatIStopped.trim().length >= 40, `${b.id}: says what it stopped`);
    ok(b.why.trim().length >= 200, `${b.id}: explains why at length`);
    ok(b.oneLine.trim().length >= 40, `${b.id}: has a one-line summary`);
    ok(b.authorityIds.length > 0, `${b.id}: cites at least one authority`);
    ok(b.whatAreYouTryingToDo.length >= 2, `${b.id}: offers at least two possible intents`);

    // THE INVARIANT THAT MAKES IT MENTORING RATHER THAN SCOLDING: every intent
    // has a route. A blocker that asks what you are trying to do and then has
    // no answer for one of the options is worse than one that never asked.
    eq(
      b.correctPaths.length,
      b.whatAreYouTryingToDo.length,
      `${b.id}: every stated intent has exactly one correct path`,
    );

    for (const p of b.correctPaths) {
      ok(p.action.trim().length >= 10, `${b.id}: path action is specific`);
      ok(p.where.trim().length >= 5, `${b.id}: path says where to go`);
      ok(p.thenWhat.trim().length >= 15, `${b.id}: path says what happens next`);
      // A path with no audit trail is not a correct path.
      ok(p.auditTrail.trim().length >= 30, `${b.id}: path names the record it produces`);
    }

    // Every citation must resolve. Checked here, not just in the vitest mirror,
    // so the module refuses to load broken in any consumer.
    for (const id of b.authorityIds) {
      ok(findPayrollAuthority(id) !== undefined, `${b.id}: authority "${id}" exists`);
    }
  }

  // --- the labels are complete --------------------------------------------
  for (const t of ALL_PAYROLL_EDIT_TARGETS) {
    ok(
      (PAYROLL_EDIT_TARGET_LABELS[t] ?? "").trim().length > 0,
      `target "${t}" has a human label`,
    );
  }
  eq(
    Object.keys(PAYROLL_EDIT_TARGET_LABELS).length,
    ALL_PAYROLL_EDIT_TARGETS.length,
    "no orphan labels and no missing ones",
  );

  // --- severities ----------------------------------------------------------
  for (const s of ["teach", "reroute", "refuse"] as const) {
    ok((BLOCKER_SEVERITY_MEANING[s] ?? "").length > 40, `severity "${s}" is explained`);
  }
  ok(
    BLOCKER_SEVERITY_RANK.refuse < BLOCKER_SEVERITY_RANK.reroute &&
      BLOCKER_SEVERITY_RANK.reroute < BLOCKER_SEVERITY_RANK.teach,
    "refusals sort above reroutes, which sort above teaching moments",
  );

  // --- lookup and ordering -------------------------------------------------
  ok(findBlocker("edit-net-pay") !== undefined, "findBlocker finds a real one");
  ok(findBlocker("no-such-blocker") === undefined, "findBlocker misses an unreal one");

  const ssBlockers = blockersFor("social_security_withheld");
  ok(ssBlockers.length >= 2, "two different blockers can guard the same field");
  eq(ssBlockers[0]!.severity, "refuse", "and the hardest one is listed first");

  // --- the audit trail -----------------------------------------------------
  const entry = recordBlockerInterception({
    blocker: BLOCK_EDIT_NET_PAY,
    occurredAt: "2026-08-19T12:00:00Z",
    actorId: "michael",
    attemptedFromCents: 165_111,
    attemptedToCents: 200_000,
    chosenIntentIndex: 0,
  });
  eq(entry.blockerId, "edit-net-pay", "the audit entry names the blocker");
  eq(entry.targetLabel, "Net pay", "and the field in human words");
  eq(entry.severity, "reroute", "and how hard the block was");
  eq(
    entry.chosenPathAction,
    "Use gross-up: enter the take-home you want and let me solve for the gross",
    "and where he was sent",
  );
  ok(describeInterception(entry).includes("$1,651.11"), "the log line shows the attempted from");
  ok(describeInterception(entry).includes("$2,000.00"), "and the attempted to");

  let threw = false;
  try {
    recordBlockerInterception({
      blocker: BLOCK_EDIT_NET_PAY,
      occurredAt: "yesterday",
      actorId: "michael",
    });
  } catch {
    threw = true;
  }
  ok(threw, "a non-ISO timestamp is refused rather than recorded");

  threw = false;
  try {
    recordBlockerInterception({
      blocker: BLOCK_EDIT_NET_PAY,
      occurredAt: "2026-08-19T12:00:00Z",
      actorId: "   ",
    });
  } catch {
    threw = true;
  }
  ok(threw, "an anonymous interception is refused");

  threw = false;
  try {
    recordBlockerInterception({
      blocker: BLOCK_EDIT_NET_PAY,
      occurredAt: "2026-08-19T12:00:00Z",
      actorId: "michael",
      chosenIntentIndex: 99,
    });
  } catch {
    threw = true;
  }
  ok(threw, "recording an option that was never offered is refused");

  if (failures.length > 0) {
    throw new Error(
      `payroll-withholding-guidance-core self-tests: ${failures.length} failure(s)\n  - ` +
        failures.join("\n  - "),
    );
  }
  return { passed, failed: 0 };
}
