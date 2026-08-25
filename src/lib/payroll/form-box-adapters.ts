/**
 * src/lib/payroll/form-box-adapters.ts
 *
 * ONE SHAPE FOR EVERY FORM.
 *
 * Four engines already exist and each one grew its own box type, honestly, for
 * its own reasons:
 *
 *   Form941Line   { line, caption, amountCents, isCount, derivation }
 *   Form940Line   { line, label,   amountCents, blank }
 *   W2Box         { box,  caption, amountCents, derivation }
 *   WaQuarterLine { id, form, boxLabel, measure, amountCents, quantity,
 *                   whoseMoney, shownAs }
 *
 * They are NOT being rewritten. Rule 25 - extend, never duplicate. Each engine
 * is the authority for its own arithmetic and has its own gates, and reaching
 * into any of them to bend its output into a common shape would be a rewrite
 * wearing the word "refactor". Instead this module TRANSLATES, one direction
 * only: engine -> FormBox. Nothing here computes a figure. Every amountCents in
 * every box out of this file came from an engine unchanged, and the tests prove
 * it by comparing the numbers on both sides.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT THE ADAPTER MUST ADD, AND WHY IT CANNOT BE GUESSED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A FormBox carries two facts the federal engines do not: WHOSE MONEY the box
 * holds, and whether a blank box is blank ON PURPOSE. The Washington engine
 * already tracks whose money, so its adapter copies the field across and adds
 * nothing. The federal engines do not, so it has to come from somewhere.
 *
 * It comes from an explicit per-box TABLE below, one entry per printed line,
 * each with the reason written next to it. Not from a heuristic. The tempting
 * heuristic - "lines with 'withheld' in the caption are employee money" - is
 * wrong on Form 941 line 5a, which is the COMBINED 12.4% of Social Security,
 * half the employer's and half the employee's, and whose caption contains no
 * such word. A heuristic that is wrong about FICA is wrong about the single
 * largest number on the return.
 *
 * So the tables are exhaustive and the lookup REFUSES rather than defaults.
 * Rule 62d: never invent a default. If the IRS adds a line to Form 941, this
 * module throws, loudly, naming the line, instead of quietly painting it a
 * colour that asserts something legally false about whose money it is. A wrong
 * colour here is not a cosmetic bug: it is the screen telling Michael he may
 * deduct something from his staff that he may not.
 */
import {
  type FormBox,
  type WhoseMoney,
} from "@/lib/payroll/form-box-core";
import {
  type Form941Line,
  type Form941Return,
} from "@/lib/payroll/form-941-core";
import { type Form940Line, type Form940Return } from "@/lib/payroll/form-940-core";
import { type W2Box, type W2Form } from "@/lib/payroll/form-w2-core";
import {
  waLinesForForm,
  type WaQuarterFormId,
  type WaQuarterLine,
  type WaQuarterReturn,
} from "@/lib/payroll/wa-quarterly-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  THE FORM IDS
 *
 * One vocabulary of form ids shared by the adapters, the lessons and the pages.
 * The Washington ids are the engine's own `WaQuarterFormId` values, unchanged,
 * so a lesson keyed to "lni_quarterly" is reachable from a box the engine
 * emitted without a translation step in between. A translation step between two
 * id spaces is exactly where a lesson goes quietly unreachable.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const FORM_ID_941 = "form_941";
export const FORM_ID_940 = "form_940";
export const FORM_ID_W2 = "form_w2";
export const FORM_ID_W3 = "form_w3";

/** Every form the Form/Why/Check surface can render, as data. */
export const ALL_TAUGHT_FORM_IDS: readonly string[] = [
  FORM_ID_941,
  FORM_ID_940,
  FORM_ID_W2,
  FORM_ID_W3,
  "esd_5208a",
  "esd_5208b",
  "pfml_wa_cares",
  "lni_quarterly",
];

/**
 * The printable name of a form, for a heading.
 *
 * Includes the agency, because the whole reason Michael has four logins is that
 * these are four different agencies, and a heading that says only "Quarterly
 * Report" hides the one fact that explains the filing calendar.
 */
export function taughtFormTitle(formId: string): string {
  switch (formId) {
    case FORM_ID_941:
      return "Form 941 — Employer's Quarterly Federal Tax Return (IRS)";
    case FORM_ID_940:
      return "Form 940 — Employer's Annual Federal Unemployment (FUTA) Tax Return (IRS)";
    case FORM_ID_W2:
      return "Form W-2 — Wage and Tax Statement (SSA)";
    case FORM_ID_W3:
      return "Form W-3 — Transmittal of Wage and Tax Statements (SSA)";
    case "esd_5208a":
      return "Form 5208A — Quarterly Tax Report (WA Employment Security Department)";
    case "esd_5208b":
      return "Form 5208B — Quarterly Wage Detail Report (WA Employment Security Department)";
    case "pfml_wa_cares":
      return "Paid Family & Medical Leave and WA Cares — Quarterly Report (WA ESD)";
    case "lni_quarterly":
      return "Quarterly Report — Workers' Compensation (WA Department of Labor & Industries)";
    default:
      throw new Error(
        `form-box-adapters: no title for form id "${formId}". Every form rendered on this ` +
          `surface must be named here, because an untitled form gives Michael no way to know ` +
          `which agency's website he is meant to be typing it into.`,
      );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  FORM 941 — WHOSE MONEY, LINE BY LINE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One row of the classification table.
 *
 * `why` is not decoration. It is the sentence a reader needs in order to
 * disagree with the classification, and a classification nobody can disagree
 * with is a classification nobody can check.
 */
export type WhoseRow = { readonly whose: WhoseMoney; readonly why: string };

/**
 * Form 941, every printed line the engine emits, classified.
 *
 * The two entries worth arguing about, stated plainly:
 *
 * LINE 5a AND 5c ARE `shared`. Line 5a is taxable Social Security wages times
 * 0.124 - twelve point four percent, which is 6.2% withheld from the employee
 * and 6.2% paid by Greenway. One box, two owners, an exact half each. It is the
 * cleanest example on any form of why a box needs an owner and not just an
 * amount, and it is also the box a "contains the word withheld" heuristic gets
 * wrong.
 *
 * LINE 3 IS `employee_money`. Federal income tax withheld was taken out of
 * somebody's pay. Greenway never owned a cent of it and is a custodian of it
 * until it is deposited. That is what makes late deposits so much more serious
 * than a late payment of Greenway's own expense - the money was never Greenway's
 * to be short of.
 */
/*
 * ═══ WHY THESE THREE TABLES ARE EXPORTED (books-49) ═══
 *
 * They were private, and being private is what let a second copy of the same
 * knowledge appear. The teaching specimen in `form-box-teaching-core.ts` needs
 * to know whose money each box is BEFORE any return has been computed, and
 * with no export available the first draft simply re-typed the answers by hand.
 *
 * That copy drifted immediately - inside the same slice, written the same day
 * by the same author. Running the engine and printing its lines beside the
 * hand-written table showed `lni-hours` classified `not_money` in one place and
 * `shared` in the other, and the two bottom-line boxes (`esd-total`,
 * `lni-premium`) missing from the copy altogether.
 *
 * So these are exported not for convenience but so that there is exactly ONE
 * answer to "whose money is box 5a", and any screen that wants it has to come
 * here and get it. Standing rule 25: extend, never duplicate.
 */
export const FORM_941_WHOSE: Readonly<Record<string, WhoseRow>> = {
  "1": {
    whose: "not_money",
    why: "A headcount of people, not an amount. Nothing is owed because of this box.",
  },
  "2": {
    whose: "tax_base",
    why:
      "Wages paid. The biggest figure on the return and nobody owes a penny of it — it is what " +
      "the taxes below are calculated on.",
  },
  "3": {
    whose: "employee_money",
    why:
      "Federal income tax withheld. This came out of your employees' pay; Greenway is holding it " +
      "and passing it on.",
  },
  "5a": {
    whose: "shared",
    why:
      "Social Security at 12.4% — 6.2% withheld from the employee and 6.2% paid by Greenway. One " +
      "box, an exact half each.",
  },
  "5c": {
    whose: "shared",
    why: "Medicare at 2.9% — 1.45% from the employee and 1.45% from Greenway. Again an exact half.",
  },
  "5e": {
    whose: "shared",
    why: "The total of 5a and 5c, so it inherits their shared ownership.",
  },
  "6": { whose: "shared", why: "A subtotal of withheld tax and shared FICA." },
  "7": {
    whose: "shared",
    why:
      "The fractions-of-cents adjustment. A rounding difference of a few cents between what was " +
      "withheld person by person and what the return computes in one sum.",
  },
  "10": { whose: "shared", why: "Total tax after adjustments — a total of shared and withheld tax." },
  "12": { whose: "shared", why: "Total tax after adjustments and credits." },
  "13": {
    whose: "shared",
    why: "Deposits already made against the tax above, so it carries the same mixed ownership.",
  },
  "14": {
    whose: "shared",
    why: "What is still owed. Part of it was withheld from employees, part is Greenway's own share.",
  },
  "15a": {
    whose: "shared",
    why: "An overpayment — money already sent that exceeds the tax, of both kinds.",
  },
  /*
   * ═══ THE ELEVEN LINES ADDED IN books-53 ═══
   *
   * A note on `tax_base` versus `not_money`, because the distinction is not
   * about importance. `tax_base` means the line reports a FIGURE that some tax
   * is later computed from; `not_money` means the line is a tickbox, a name or
   * an identifier and drives the measure "count", so it can never be rendered
   * with a dollar sign.
   *
   * Lines 4, 16, 17 and 18 are tickboxes and dates. They are `not_money` for
   * that mechanical reason, not because they are unimportant — line 16 in
   * particular can draw a penalty when filled in wrongly.
   *
   * Line 5d is the interesting one. Every other Social Security and Medicare
   * line on this form is `shared`, because those taxes are paid twice. The
   * Additional Medicare Tax is not: the instructions say "There is no employer
   * share of Additional Medicare Tax." Classifying it `shared` would tell
   * Michael that Greenway owes a matching 0.9% it does not owe.
   */
  "4": {
    whose: "not_money",
    why:
      "A tickbox stating that no wages at all are subject to Social Security or Medicare tax. " +
      "It reports no amount, so it can never be a dollar figure.",
  },
  "5b": {
    whose: "shared",
    why:
      "Social Security on reported tips, paid twice like line 5a — 6.2% withheld from the " +
      "employee and 6.2% from Greenway on the same tips.",
  },
  "5d": {
    whose: "employee_money",
    why:
      "Wages above $200,000 carrying the 0.9% Additional Medicare Tax. The instructions state " +
      "there is no employer share, so unlike 5a and 5c this is the employee's money alone.",
  },
  "5f": {
    whose: "shared",
    why:
      "Tax the IRS demands on tips employees failed to report, billed by notice. It covers the " +
      "employer share of Social Security and Medicare on those tips.",
  },
  "8": {
    whose: "shared",
    why:
      "An adjustment moving liability for sick-pay taxes between Greenway and a third-party " +
      "payer. It touches both the employee share and the employer share.",
  },
  "9": {
    whose: "employee_money",
    why:
      "The uncollected EMPLOYEE share of Social Security and Medicare on tips and on group-term " +
      "life for former employees. It is their tax that could not be withheld, not Greenway's.",
  },
  "11": {
    whose: "shared",
    why:
      "A research credit from Form 8974 offsetting total tax, which is itself made of both the " +
      "withheld employee money and Greenway's own share.",
  },
  "15c": {
    whose: "not_money",
    why:
      "A bank routing number. It says where a refund should be sent, not who owns anything.",
  },
  "15d": {
    whose: "not_money",
    why: "A tickbox naming the type of bank account. It reports no money at all.",
  },
  "15e": {
    whose: "not_money",
    why:
      "A bank account number. It says where a refund should be sent, not who owns anything.",
  },
  "15b": {
    whose: "not_money",
    why:
      "A choice between having the overpayment refunded or applied to the next return. A tickbox, " +
      "carrying no amount of its own.",
  },
  "16": {
    whose: "not_money",
    why:
      "The deposit-schedule tickbox and the monthly liability breakdown. The line itself records " +
      "a schedule rather than a single amount owed.",
  },
  "17": {
    whose: "not_money",
    why:
      "A tickbox and a date, stating that the business has stopped paying wages. It reports no " +
      "money at all.",
  },
  "18": {
    whose: "not_money",
    why:
      "A tickbox stating that the employer hires only seasonally. It reports no money at all.",
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  FORM 940 — WHOSE MONEY, LINE BY LINE
 *
 * Form 940 is the simplest of all four on this question and the most important
 * to get visibly right: FUTA IS ENTIRELY THE EMPLOYER'S. Not one cent of
 * federal unemployment tax may be withheld from a worker, ever. So almost every
 * money line here is `employer_cost` and the screen will be almost entirely
 * gold — and that uniform gold is itself the lesson. A reader who has learned
 * the palette on Form 941, where the FICA lines are orange for "shared", will
 * see at a glance that this form has no shared lines at all.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const FORM_940_WHOSE: Readonly<Record<string, WhoseRow>> = {
  /*
   * ═══ THE TWELVE LINES ADDED IN books-54 ═══
   *
   * Form 940 has 30 numbered lines on the paper Michael holds. This table had
   * eighteen. `resolveWhose` THROWS for a box that is not here, so the twelve
   * below could not be listed, clicked, or taught -- the teaching screen would
   * have crashed rather than shown them.
   *
   * ALL TWELVE ARE `not_money`, AND THAT IS THE POINT OF THE FIELD.
   *
   * Ten of them are tickboxes or text: a two-letter state code (1a), a
   * multi-state tick (1b), a credit-reduction tick (2), five exempt-payment
   * category ticks (4a-4e), an apply-or-refund tick (15b), an account-type tick
   * (15d), and two bank strings (15c, 15e). Not one is an amount, so not one
   * can be owed by anyone.
   *
   * `not_money` is load-bearing rather than decorative: in the teaching layer
   * it drives measure "count" instead of "money", so none of these will ever be
   * rendered with a dollar sign. The concrete bug it prevents is a box holding
   * the letters "WA" being printed as "$WA".
   *
   * WHY 4a-4e ARE NOT `tax_base`. They describe an amount -- the line 4
   * subtraction -- but they are not that amount. They are the boxes that say
   * which KIND of exempt payment it was. The dollars live on line 4, which is
   * already `tax_base`. Classifying the tickboxes as `tax_base` as well would
   * double-count the same money in anything that sums by ownership.
   *
   * WHY 15c AND 15e ARE NOT MERELY "not_money" BUT ALSO NEVER SPECIMEN-FILLED.
   * They are a bank routing number and a bank account number. They are
   * credentials, not figures, and they are the two boxes on this form where a
   * plausible-looking example value would be actively harmful.
   */
  "1a": {
    whose: "not_money",
    why:
      "The two-letter state code for the one state where state unemployment tax was paid. " +
      "Text, not an amount — for Greenway it reads WA.",
  },
  "1b": {
    whose: "not_money",
    why:
      "A tickbox for employers who owe state unemployment tax in more than one state. Ticking " +
      "it obliges a Schedule A. Greenway is Washington-only, so it stays blank.",
  },
  "2": {
    whose: "not_money",
    why:
      "A tickbox for paying wages in a credit-reduction state. Not an amount; the extra tax it " +
      "leads to is computed on Schedule A and lands on line 11.",
  },
  "4a": {
    whose: "not_money",
    why:
      "A tickbox saying the line 4 exemption was fringe benefits. The money is on line 4; this " +
      "box only names the category.",
  },
  "4b": {
    whose: "not_money",
    why: "A tickbox saying the line 4 exemption was group-term life insurance.",
  },
  "4c": {
    whose: "not_money",
    why:
      "A tickbox saying the line 4 exemption was retirement or pension contributions — the " +
      "employer's own, not an employee's elective deferral.",
  },
  "4d": {
    whose: "not_money",
    why: "A tickbox saying the line 4 exemption was dependent care, which is capped at $5,000.",
  },
  "4e": {
    whose: "not_money",
    why:
      "A tickbox for the catch-all exemption category. Not a place to park anything that does " +
      "not fit — if nothing on the IRS list applies, line 4 is blank and this is unticked.",
  },
  "15b": {
    whose: "not_money",
    why:
      "A choice between carrying an overpayment forward and taking it back. It directs money " +
      "already counted on line 15a; it is not itself money.",
  },
  "15c": {
    whose: "not_money",
    why:
      "A bank routing number for a refund. Nine digits from the bank, never from the ledger, and " +
      "not an amount.",
  },
  "15d": {
    whose: "not_money",
    why: "A tickbox for checking or savings. Exactly one, and only when a refund was requested.",
  },
  "15e": {
    whose: "not_money",
    why:
      "A bank account number for a refund. A credential rather than a figure, which is why no " +
      "specimen value is ever shown for it.",
  },
  "3": {
    whose: "tax_base",
    why: "Total payments to employees. The starting figure, not an amount owed.",
  },
  "4": {
    whose: "tax_base",
    why: "Payments exempt from FUTA — a subtraction from the base, still not money owed.",
  },
  "5": {
    whose: "tax_base",
    why:
      "Wages above the $7,000 per-person FUTA ceiling. Also a subtraction from the base: FUTA " +
      "stops at the first $7,000 each person earns in the year.",
  },
  "6": { whose: "tax_base", why: "The subtotal of lines 4 and 5 — the part being taken out." },
  "7": {
    whose: "tax_base",
    why: "Total taxable FUTA wages. Still the base; the tax itself appears on line 8.",
  },
  "8": {
    whose: "employer_cost",
    why:
      "FUTA tax. Greenway's cost in full — federal unemployment tax may never be withheld from " +
      "an employee.",
  },
  "9": {
    whose: "employer_cost",
    why: "An adjustment for wages excluded from state unemployment tax. Still Greenway's own cost.",
  },
  "10": {
    whose: "employer_cost",
    why: "An adjustment for state unemployment tax paid late. Greenway's cost, and avoidable.",
  },
  "11": {
    whose: "employer_cost",
    why:
      "Credit reduction, which applies only when a state has borrowed from the federal " +
      "unemployment fund and not repaid it. Washington is not such a state.",
  },
  "12": { whose: "employer_cost", why: "Total FUTA tax after adjustments. All Greenway's." },
  "13": { whose: "employer_cost", why: "Deposits already made against Greenway's own FUTA tax." },
  "14": { whose: "employer_cost", why: "Balance still due, entirely Greenway's." },
  "15a": { whose: "employer_cost", why: "An overpayment of Greenway's own tax." },
  "16a": { whose: "employer_cost", why: "First-quarter FUTA liability. Greenway's cost." },
  "16b": { whose: "employer_cost", why: "Second-quarter FUTA liability. Greenway's cost." },
  "16c": { whose: "employer_cost", why: "Third-quarter FUTA liability. Greenway's cost." },
  "16d": { whose: "employer_cost", why: "Fourth-quarter FUTA liability. Greenway's cost." },
  "17": {
    whose: "employer_cost",
    why: "The four quarters added up, which must equal line 12 to the cent.",
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  THE W-2 — WHOSE MONEY, BOX BY BOX
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The W-2 is a STATEMENT, not a bill, and that changes what the colours mean.
 *
 * Nothing is owed on the strength of a W-2. Boxes 1, 3 and 5 are wage figures -
 * `tax_base`. Boxes 2, 4 and 6 are amounts withheld from the employee, which is
 * `employee_money`: they are the employee's own tax payments, made through
 * Greenway, and they are why the employee can file a return at all.
 *
 * Note that box 4 (Social Security withheld) is `employee_money` here while
 * Form 941 line 5a is `shared`. Both are right, and the difference is the point:
 * the 941 line is the COMBINED 12.4% of both halves, and the W-2 box is only the
 * employee's 6.2%. Line 5a should be almost exactly twice the sum of every
 * employee's box 4, and the Check tab uses precisely that relationship. A single
 * classification for "Social Security" would have destroyed the ability to state
 * that reconciliation.
 */
export const FORM_W2_WHOSE: Readonly<Record<string, WhoseRow>> = {
  /*
   * ═══ THE SIX LETTERED BOXES, ADDED IN books-56 ═══
   *
   * This table began at box 1 and ended at box 20, so the six lettered boxes the
   * paper prints ABOVE box 1 did not exist to this system at all. `resolveWhose`
   * throws for a box that is not in this table, so the W-2 could not even LIST
   * them, and the ownership question "whose is this?" could not be asked of the
   * employee's own name and Social Security number.
   *
   * HOW THE GAP WAS FOUND, because the method matters more than the fix. It was
   * not found by reading this file. A lesson written for the ESD 5208B wage
   * detail tied its employee row to `form_w2` box `e` — the box that carries the
   * same person's name on the federal form — and `assertEveryTieResolves` refused
   * it, naming the twenty boxes the W-2 had and the one it did not. The tie was
   * right about the paper and the specimen was wrong, which is the direction that
   * matters: a gate written in books-49 for a different purpose caught a
   * seven-slice-old omission because a NEW cross-reference forced it to answer.
   *
   * WHY THIS PARTICULAR GAP IS NOT COSMETIC. Michael has said he prepared all ten
   * of Greenway's 2025 W-2s and the W-3 himself and believes he may have done it
   * wrong. Boxes a, e and f are the SSN, the name and the address — the three
   * fields the SSA matches on. A wrong figure in box 1 is an arithmetic error the
   * IRS will query. A wrong name in box e is a SILENT error: the return is
   * accepted, nothing on Greenway's side looks wrong, and an employee's earnings
   * record is short by a year. Those were the boxes with nothing behind them.
   *
   * WHY ALL SIX ARE `not_money`, and why that is a substantive answer rather than
   * a shrug. `not_money` is load-bearing here: it drives measure "count" instead
   * of "money" in the teaching layer, so without it box a would render Teri
   * Becker's SSN as a dollar amount. These boxes carry identifiers and text. The
   * classification is asking whose MONEY a figure is, and the honest answer for a
   * name is that it is not money at all.
   *
   * ═══ A WARNING FOR WHOEVER READS THE DRIFT GATE NEXT ═══
   *
   * `assertW3MoneyBoxesMatchTheirW2Box` compares this table against FORM_W3_WHOSE
   * by SHARED BOX ID. Adding a-f here makes six new ids shared, and on the two
   * forms those letters do NOT mean the same box: W-2 box a is the employee's
   * SSN, W-3 box a is an optional control number. They happen to agree at
   * `not_money`, so nothing goes red — which is precisely the sort of accidental
   * green rule 40 exists to refuse. That gate has been taught the difference
   * rather than left to coincidence; see its own docblock.
   */
  a: {
    whose: "not_money",
    why:
      "The employee's Social Security number, copied from their card. An identifier, not an " +
      "amount — and the field the SSA matches the whole form on, so an error here credits the " +
      "wages to nobody and shows up nowhere on Greenway's side.",
  },
  b: {
    whose: "not_money",
    why:
      "Greenway's nine-digit EIN, which must be the same number used on the 941s. An identifier, " +
      "not an amount, and the instructions forbid truncating it or substituting an SSN.",
  },
  c: {
    whose: "not_money",
    why:
      "Greenway's own name, address and ZIP code, which must match the 941s. Text, not an " +
      "amount. This is the EMPLOYER's block; the employee's address is box f.",
  },
  d: {
    whose: "not_money",
    why:
      "An optional control number for identifying individual W-2s. A filing reference Greenway " +
      "does not use, and the instructions say plainly you do not have to use this box.",
  },
  e: {
    whose: "not_money",
    why:
      "The employee's name as shown on their social security card. Text, not an amount, and the " +
      "instructions single out the LAST name as especially important to report exactly.",
  },
  f: {
    whose: "not_money",
    why:
      "The employee's address and ZIP code — where their copy of this form is posted. Text, not " +
      "an amount, and distinct from box c, which is Greenway's address.",
  },
  "1": {
    whose: "tax_base",
    why: "Taxable wages for income tax. A wage figure the employee reports, not an amount owed.",
  },
  "2": {
    whose: "employee_money",
    why:
      "Federal income tax withheld from this employee. Their money, paid toward their own tax " +
      "bill through Greenway.",
  },
  "3": {
    whose: "tax_base",
    why:
      "Social Security wages, capped at the annual wage base. A wage figure, and often different " +
      "from box 1 for good reasons.",
  },
  "4": {
    whose: "employee_money",
    why:
      "The employee's 6.2% of Social Security. Only their half — Greenway's matching half appears " +
      "on no W-2 anywhere.",
  },
  "5": {
    whose: "tax_base",
    why: "Medicare wages. Uncapped, unlike box 3, which is why the two can differ for a high earner.",
  },
  "6": { whose: "employee_money", why: "The employee's 1.45% of Medicare. Again only their half." },
  /*
   * ═══ THE TWELVE BOXES ADDED IN books-52 ═══
   *
   * The table stopped at box 6 and then jumped to 16 and 17, because those were
   * the only boxes the W-2 engine emits. Every box between them existed on the
   * paper form Michael holds in his hand and was unexplainable by this system:
   * `resolveWhose` throws for a box that is not in this table, so the teaching
   * specimen could not even LIST them.
   *
   * The gap was not cosmetic. Box 14 is where Michael's own filed 2025 W-2s
   * carry an entry captioned HEALTH - 11,029.32 for Teri Becker against box 1
   * of exactly 11,029.32 - and that box could not be clicked, read, or learned
   * from. The one box on the form that touches the live open question about
   * shareholder health premiums was the one box with nothing behind it.
   *
   * WHY `tax_base` IS THE RIGHT CLASSIFICATION FOR MOST OF THEM. These are
   * classifications of OWNERSHIP, not of size or importance. `tax_base` means
   * "a wage or benefit figure that other numbers are computed from, which
   * nobody owes as a payment". Boxes 7, 8, 10, 11, 12 and 14 are all of that
   * kind: they report amounts of pay or benefit, and no tax is due BECAUSE of
   * the box. That is exactly the distinction the `whose` field exists to draw,
   * and it is why a "contains the word tax" heuristic gets it wrong.
   *
   * BOX 9 AND BOX 13 ARE `not_money` AND THAT IS NOT A DODGE. Box 9 is a dead
   * box the IRS instructs you to leave empty; box 13 holds three checkboxes.
   * Neither is an amount at all. `not_money` also drives measure "count" rather
   * than "money" in the teaching layer, so neither will ever be formatted with
   * a dollar sign - which is the concrete bug this classification prevents.
   */
  "7": {
    whose: "tax_base",
    why:
      "Tips the employee told you about. A wage figure, not an amount owed — and boxes 3 and 7 " +
      "added together are what the Social Security wage base caps, not box 3 alone.",
  },
  "8": {
    whose: "tax_base",
    why:
      "Tips YOU allocated to the employee, which only large food or beverage establishments do. " +
      "Deliberately excluded from boxes 1, 3, 5 and 7, so it is a wage figure that feeds nothing.",
  },
  "9": {
    whose: "not_money",
    why:
      "A retired box. The instructions say to enter nothing here, so it is not an amount at all " +
      "and cannot be anybody's money.",
  },
  "10": {
    whose: "tax_base",
    why:
      "Dependent care benefits provided. A benefit figure reported so the employee can work out " +
      "their own exclusion; Greenway owes no tax because of this box.",
  },
  "11": {
    whose: "tax_base",
    why:
      "Nonqualified plan distributions. Reported so the Social Security Administration can tell " +
      "which year the money was EARNED, which is a timing signal rather than a tax.",
  },
  "12": {
    whose: "tax_base",
    why:
      "Coded amounts — retirement deferrals, the cost of employer health coverage, and others. " +
      "Each is a wage or benefit figure; the code tells the reader how to treat it.",
  },
  "13": {
    whose: "not_money",
    why:
      "Three checkboxes, not an amount. Ticked or not ticked, so there is no money here to " +
      "belong to anyone.",
  },
  "14": {
    whose: "tax_base",
    why:
      "A free-text box for anything the employee should know — the instructions name health " +
      "insurance premiums deducted among the examples. It reports a figure and settles nothing.",
  },
  "15": {
    whose: "not_money",
    why:
      "The state's two-letter abbreviation and your state ID number. Identifiers, not an amount.",
  },
  "18": {
    whose: "tax_base",
    why:
      "Local wages. A wage figure for a city or county income tax, of which Washington has none, " +
      "so it stays blank.",
  },
  "19": {
    whose: "employee_money",
    why:
      "Local income tax withheld from the employee's pay. Their money — blank in Washington " +
      "because there is no local income tax to withhold.",
  },
  "20": {
    whose: "not_money",
    why: "The name of the locality. A label, not an amount.",
  },
  "16": {
    whose: "tax_base",
    why: "State wages. In Washington there is no state income tax, so this is normally blank.",
  },
  "17": {
    whose: "employee_money",
    why:
      "State income tax withheld. Always blank in Washington. Paid Leave and WA Cares are " +
      "withheld from Washington employees but are not income tax and belong in box 14.",
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §4b  FORM W-3 — WHOSE MONEY, BOX BY BOX (books-55)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══ WHAT WAS HERE BEFORE: NOTHING, AND THAT WAS WORSE THAN ABSENT ═══
 *
 * `form_w3` has been in `ALL_TAUGHT_FORM_IDS` and has had a working
 * `taughtFormTitle()` entry — "Form W-3 — Transmittal of Wage and Tax
 * Statements (SSA)" — since the registry was written. It had NO teaching
 * specimen, NO ownership table, and NO lessons. `teachingBoxes("form_w3")`
 * threw.
 *
 * That combination is the worst of the three possible states. A form that is
 * absent is honestly absent. A form that is NAMED on the surface, appears in the
 * id list, and renders a title, but explodes the moment anything asks for its
 * boxes, is a form that looks finished from every angle except the one that
 * matters.
 *
 * ═══ THE THING THIS UNBLOCKS, WHICH IS NOT COSMETIC ═══
 *
 * `FORM_941_CONFIRMATION_LESSONS` — the panel where Michael types what he
 * ACTUALLY filed on each 941 so the system can compare it against what it
 * computed — carries three cross-references to W-3 boxes 2, 3 and 5. Those are
 * three of the four figures the IRS reconciles automatically, and the
 * instructions say "you will be contacted", not "may be". All three ties were
 * DEAD: they pointed Michael at a screen that threw. Measured, not assumed:
 * 62 ties across five lesson sets, 3 dead, all three of them these.
 *
 * ═══ WHY MOST OF THIS FORM IS `not_money`, AND WHY THAT IS THE HONEST ANSWER
 *
 * The W-3 is a TRANSMITTAL. It is the cover sheet on an envelope of W-2s. It
 * creates no liability, computes no tax, and is never accompanied by a payment —
 * the form itself says "Do not send any payment (cash, checks, money orders,
 * etc.) with Forms W-2 and W-3."
 *
 * So the lettered boxes a-h, the contact block, and boxes 9, 13 and 15 are
 * identifiers, counts, checkboxes and dead boxes. `not_money` is not a dodge for
 * them: it is the only true answer, and it is load-bearing, because `not_money`
 * drives measure "count" rather than "money" in the teaching layer. Without it,
 * box 15 would render as "$WA" and box c's headcount of ten W-2s would render as
 * "$0.10".
 *
 * ═══ WHY THE MONEY BOXES KEEP THE SAME OWNERSHIP AS THEIR W-2 BOX ═══
 *
 * Every money box on the W-3 is defined by the instructions as the TOTAL of the
 * same-numbered box across the W-2s in the envelope. Summing does not change
 * whose money something is: ten employees' withheld federal income tax is still
 * ten employees' money. So box 2 here is `employee_money` exactly as box 2 of
 * the W-2 is, and box 1 is `tax_base` exactly as box 1 of the W-2 is.
 *
 * This is CHECKED, not asserted: `assertW3MoneyBoxesMatchTheirW2Box` compares
 * every shared box id against FORM_W2_WHOSE and fails on any divergence that is
 * not named and justified. That is the gate that would have caught a
 * hand-written table drifting from the form it totals — which is the exact
 * failure books-49 found in the W-2 specimen.
 */
export const FORM_W3_WHOSE: Readonly<Record<string, WhoseRow>> = {
  /* ---- the lettered header boxes: identifiers and counts, never money ---- */
  a: {
    whose: "not_money",
    why:
      "An optional control number for numbering the whole transmittal. A filing reference, " +
      "not an amount, and the instructions say you may leave it empty.",
  },
  "b-kind-of-payer": {
    whose: "not_money",
    why:
      "A row of checkboxes saying which return you file — Greenway ticks 941. Ticked or not " +
      "ticked, so there is no money here to belong to anyone.",
  },
  "b-kind-of-employer": {
    whose: "not_money",
    why:
      "A second row of checkboxes for the kind of organisation. Greenway ticks 'None apply', " +
      "which is the correct answer for an ordinary for-profit company, not a gap.",
  },
  "b-third-party-sick-pay": {
    whose: "not_money",
    why:
      "A single checkbox for third-party sick pay payers. A flag, not an amount, and the " +
      "instructions are explicit that it is not a kind of payer.",
  },
  c: {
    whose: "not_money",
    why:
      "A count of the W-2s in the envelope — ten on Greenway's 2025 transmittal. A number of " +
      "FORMS, not a number of dollars, which is exactly why it must never be money-formatted.",
  },
  d: {
    whose: "not_money",
    why:
      "An optional establishment number for splitting one EIN across sites. An identifier " +
      "Greenway does not use, because it files one transmittal for one location.",
  },
  e: {
    whose: "not_money",
    why:
      "The nine-digit EIN. An identifier that must match the 941s exactly; getting it wrong " +
      "makes the whole wage report unmatchable, but it is not an amount.",
  },
  f: {
    whose: "not_money",
    why:
      "The employer's name, which must be the same name as on the 941s. Text, not an amount.",
  },
  g: {
    whose: "not_money",
    why: "The employer's address and ZIP code. Text, not an amount.",
  },
  h: {
    whose: "not_money",
    why:
      "Another EIN used during the year, including a prior owner's. Blank for Greenway, " +
      "because the EIN has not changed. An identifier either way.",
  },
  /* ---- boxes 1-8: straight totals of the same box on every W-2 ---- */
  "1": {
    whose: "tax_base",
    why:
      "Total wages, tips and other compensation across every W-2 in the envelope. A wage " +
      "figure other numbers are computed from, which nobody owes as a payment.",
  },
  "2": {
    whose: "employee_money",
    why:
      "Total federal income tax withheld from every employee. Summing ten people's withheld " +
      "tax does not make it Greenway's money — it is still the employees', paid toward their " +
      "own tax bills through Greenway.",
  },
  "3": {
    whose: "tax_base",
    why:
      "Total Social Security wages, each already capped at the annual wage base on its own " +
      "W-2. A wage figure, and one of the four the IRS reconciles against the 941s.",
  },
  "4": {
    whose: "employee_money",
    why:
      "Total Social Security tax withheld — only the employees' 6.2% halves added up. " +
      "Greenway's matching half appears on no W-2 and therefore on no W-3.",
  },
  "5": {
    whose: "tax_base",
    why:
      "Total Medicare wages and tips. Uncapped, unlike box 3, which is why the two can differ " +
      "once anyone is paid above the Social Security wage base.",
  },
  "6": {
    whose: "employee_money",
    why:
      "Total Medicare tax withheld — the employees' 1.45% halves, plus any Additional Medicare " +
      "Tax, which has no employer match at all.",
  },
  "7": {
    whose: "tax_base",
    why:
      "Total Social Security tips reported by employees. A wage figure, and the fourth of the " +
      "four boxes the IRS reconciles against the 941s. Blank for Greenway, which has no tips.",
  },
  "8": {
    whose: "tax_base",
    why:
      "Total allocated tips, which only large food or beverage establishments report. " +
      "Deliberately excluded from boxes 1, 3, 5 and 7, so it is a wage figure that feeds " +
      "nothing.",
  },
  /* ---- 9 through 19 ---- */
  "9": {
    whose: "not_money",
    why:
      "A retired box. The instructions say 'Do not enter an amount in box 9', so it is not an " +
      "amount at all and cannot be anybody's money. The printed form leaves it unlabelled.",
  },
  "10": {
    whose: "tax_base",
    why:
      "Total dependent care benefits. A benefit figure reported so employees can work out " +
      "their own exclusion; Greenway owes no tax because of this box.",
  },
  "11": {
    whose: "tax_base",
    why:
      "Total nonqualified plan distributions. Reported so the SSA can tell which year the " +
      "money was EARNED — a timing signal rather than a tax.",
  },
  "12a": {
    whose: "tax_base",
    why:
      "Total deferred compensation, and the ONE money box on this form that is a filtered " +
      "subset rather than a straight total: only codes D-H, S, Y, AA, BB and EE are carried " +
      "up. A benefit figure, not an amount owed.",
  },
  "12b": {
    whose: "not_money",
    why:
      "A second slot printed under 12a that the IRS instructions never describe — there is no " +
      "'Box 12b' heading anywhere in the General Instructions. Classified not_money because " +
      "we have no authority saying an amount belongs here, and inventing one would be a guess.",
  },
  "13": {
    whose: "not_money",
    why:
      "For third-party sick pay use only. The instructions say 'Leave this box blank', so for " +
      "Greenway it holds nothing at all.",
  },
  "14": {
    whose: "employee_money",
    why:
      "Income tax withheld by a third-party payer of sick pay. Still the employees' money — it " +
      "is already inside the box 2 total and is shown again here separately.",
  },
  "15": {
    whose: "not_money",
    why:
      "The state's two-letter abbreviation and the employer's state ID number. Identifiers, " +
      "not an amount — and the reason this must be not_money is that 'WA' would otherwise " +
      "render as a dollar figure.",
  },
  "16": {
    whose: "tax_base",
    why:
      "Total state wages across the W-2s. Washington levies no state income tax, so this is " +
      "blank on Greenway's transmittal by operation of law, not by oversight.",
  },
  "17": {
    whose: "employee_money",
    why:
      "Total state income tax withheld. The employees' money where a state levies it; always " +
      "blank in Washington. Paid Leave and WA Cares are withheld here but are not income tax.",
  },
  "18": {
    whose: "tax_base",
    why:
      "Total local wages. A wage figure for a city or county income tax, of which Washington " +
      "has none, so it stays blank.",
  },
  "19": {
    whose: "employee_money",
    why:
      "Total local income tax withheld from employees' pay. Their money — blank in Washington " +
      "because there is no local income tax to withhold.",
  },
  /* ---- the contact block, which the instructions treat as one unit ---- */
  contact: {
    whose: "not_money",
    why:
      "The contact person, telephone, fax and email the SSA uses if a question arises in " +
      "processing. Contact details, not an amount — and the one part of this form that " +
      "determines whether a problem reaches Michael or a payroll bureau.",
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  THE LOOKUP THAT REFUSES
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Classify one box, or throw.
 *
 * ═══ WHY THIS THROWS INSTEAD OF RETURNING A SAFE DEFAULT ═══
 *
 * There is no safe default. Every candidate asserts something:
 *
 *   "not_money"      says nothing is owed, on a box where something is.
 *   "employer_cost"  says Greenway pays it, on a box that may be withheld.
 *   "employee_money" says it may be deducted from staff. If that is wrong on
 *                    an unemployment or workers' comp line, acting on it is a
 *                    crime under RCW 50.24.010 or RCW 51.16.140(2).
 *
 * A default here is a system that answers a legal question it was never told
 * the answer to. Throwing means a new IRS line stops the page with a message
 * naming the line, which is annoying for exactly as long as it takes to add one
 * table entry, and is the behaviour Michael asked for when he said never guess.
 */
function whoseFor(
  table: Readonly<Record<string, WhoseRow>>,
  formId: string,
  boxId: string,
): WhoseRow {
  const row = table[boxId];
  if (row === undefined) {
    throw new Error(
      `form-box-adapters: ${formId} box "${boxId}" has no whose-money classification. Add it to ` +
        `the table with its reason. There is deliberately no default, because every possible ` +
        `default asserts something false about whose money the box holds, and on the ` +
        `unemployment and workers' compensation lines that assertion is the difference between a ` +
        `lawful deduction and a criminal one.`,
    );
  }
  return row;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  THE ADAPTERS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Form 941's lines as generic boxes.
 *
 * `isCount` becomes `measure: "count"` and the number moves from `amountCents`
 * to `quantity`, because line 1 holds a number of PEOPLE. The engine keeps a
 * headcount in a field named amountCents, which is honest inside an engine that
 * knows what it means, but a generic renderer given that box would print
 * "$0.06" for six employees. Moving it is the whole reason `measure` exists.
 */
export function form941Boxes(ret: Form941Return): readonly FormBox[] {
  return ret.lines.map((l: Form941Line): FormBox => {
    const row = whoseFor(FORM_941_WHOSE, "Form 941", l.line);
    return {
      formId: FORM_ID_941,
      box: l.line,
      caption: l.caption,
      measure: l.isCount ? "count" : "money",
      // A count carries no cents. Leaving the headcount in amountCents would let
      // any money-formatting path print it as a dollar figure.
      amountCents: l.isCount ? 0 : l.amountCents,
      quantity: l.isCount ? l.amountCents : null,
      whose: row.whose,
      derivation: `${l.derivation} — ${row.why}`,
      // Form 941's engine does not model a deliberately-blank line; the lines it
      // omits are simply absent, which is a different and equally valid design.
      blankOnPurpose: null,
      // Line 12 is the figure that must be deposited and the one every other
      // line exists to arrive at.
      emphasise: l.line === "12",
      // This adapter is only ever handed a return the engine successfully
      // BUILT, so every figure here is computed. The not-yet-computed case is
      // a different adapter entirely (`teachingBoxes`), because a screen with
      // no data does not have a Form941Return to map over at all.
      notComputedYet: null,
    };
  });
}

/**
 * Form 940's lines as generic boxes.
 *
 * The one adapter where `blankOnPurpose` does real work. The engine already
 * tracks a `blank` flag, because the Form 940 instructions say "if any line in
 * Part 3 doesn't apply, leave it blank" — and a blank box and a box containing
 * 0.00 are different statements to the IRS. This adapter carries that
 * distinction into the renderer with a reason attached, so the box appears grey
 * and labelled rather than either invisible or falsely showing a zero.
 */
export function form940Boxes(ret: Form940Return): readonly FormBox[] {
  return ret.lines.map((l: Form940Line): FormBox => {
    const row = whoseFor(FORM_940_WHOSE, "Form 940", l.line);
    return {
      formId: FORM_ID_940,
      box: l.line,
      caption: l.label,
      measure: "money",
      amountCents: l.amountCents,
      quantity: null,
      whose: row.whose,
      derivation: row.why,
      blankOnPurpose: l.blank
        ? "The Form 940 instructions say to leave this line blank when it does not apply. A blank " +
          "line and a line reading 0.00 say different things to the IRS, so this one is left empty " +
          "on purpose rather than filled with a zero."
        : null,
      // Line 12 is the annual FUTA tax; line 17 must equal it, and the equality
      // is the return's own internal check.
      emphasise: l.line === "12" || l.line === "17",
      // Built from a return the engine produced: every figure is computed.
      notComputedYet: null,
    };
  });
}

/**
 * One employee's W-2 as generic boxes.
 *
 * Box 17 is the reason `blankOnPurpose` exists at all. In Washington it is
 * always empty, and an empty box with no explanation reads as an omission —
 * something forgotten, or worse, something the employee was supposed to have
 * withheld. Saying "blank on purpose: Washington has no state income tax"
 * converts a suspicious gap into a fact learned once.
 *
 * Box 16 gets the same treatment when it is empty, but only WHEN it is empty:
 * a Washington employer with an employee working in Oregon would have a figure
 * there, and hard-coding the box as always-blank would hide it. The condition
 * is on the value, not on the state.
 */
export function w2Boxes(form: W2Form): readonly FormBox[] {
  return form.boxes.map((b: W2Box): FormBox => {
    const row = whoseFor(FORM_W2_WHOSE, "Form W-2", b.box);
    const isWaStateBox = (b.box === "16" || b.box === "17") && b.amountCents === 0;
    return {
      formId: FORM_ID_W2,
      box: b.box,
      caption: b.caption,
      measure: "money",
      amountCents: b.amountCents,
      quantity: null,
      whose: row.whose,
      derivation: `${b.derivation} — ${row.why}`,
      blankOnPurpose: isWaStateBox
        ? "Blank because Washington has no state income tax. This is correct and permanent, not " +
          "a missing figure. Paid Family and Medical Leave and WA Cares ARE withheld from " +
          "Washington employees, but they are not income tax; they belong in box 14."
        : null,
      // Box 1 is the figure the employee copies onto their own tax return.
      emphasise: b.box === "1",
      // Built from a W-2 the engine produced: every figure is computed.
      notComputedYet: null,
    };
  });
}

/**
 * One Washington return's lines as generic boxes.
 *
 * The shortest adapter, because the Washington engine already carries
 * `whoseMoney` and `measure` itself — it was written after the distinction was
 * understood. There is no classification table here and there must not be one:
 * a table would be a SECOND opinion about ownership, able to drift out of step
 * with the engine's own, and the resulting disagreement would be invisible.
 * Rule 63, one platform one ledger, applied to a colour.
 */
export function waBoxes(
  ret: WaQuarterReturn,
  form: WaQuarterFormId,
): readonly FormBox[] {
  return waLinesForForm(ret, form).map((l: WaQuarterLine): FormBox => {
    const isHours = l.measure === "hours";
    // An hours line with a null quantity is a contradiction in the engine's own
    // terms: `quantity` is documented as "the count when measure is hours". It
    // is not defaulted to 0 here, because 0 hours is a CLAIM — it would put a
    // reportable-hours figure of zero on a workers' compensation return, which
    // is a statement L&I acts on. Refusing is the only honest option.
    if (isHours && l.quantity === null) {
      throw new Error(
        `form-box-adapters: Washington line "${l.id}" is measured in hours but carries no hour ` +
          `count. This is not defaulted to zero, because zero reportable hours is a claim on a ` +
          `workers' compensation return rather than an absence of one.`,
      );
    }
    return {
      formId: l.form,
      box: l.id,
      caption: l.boxLabel,
      measure: isHours ? "hours" : "money",
      amountCents: l.amountCents,
      // Hours arrive from the engine as whole hours. FormBox.quantity for an
      // hours box is in HUNDREDTHS, because that is the unit the shared
      // formatter documents. Converting here rather than at the renderer means
      // exactly one place performs it.
      quantity: l.quantity === null ? null : isHours ? l.quantity * 100 : null,
      whose: l.whoseMoney,
      derivation: l.shownAs,
      // The Washington engine emits a line only when it belongs on the return.
      blankOnPurpose: null,
      emphasise: l.id === "lni-premium" || l.id === "esd-total",
      // Built from a quarter the engine produced: every figure is computed.
      notComputedYet: null,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §7  SELF-TESTS
 *
 * These prove the properties that a screenshot cannot: that no amount was
 * altered in translation, that the tables are exhaustive against the engines'
 * own line lists, and that the lookup really refuses.
 * ═══════════════════════════════════════════════════════════════════════════ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`form-box-adapters self-test failed: ${msg}`);
}

/**
 * The lookup must throw on an unknown box, in both directions.
 *
 * Rule 34: the gate is run both ways. A known box must pass and an unknown box
 * must throw, because a lookup that throws on everything is not a gate either.
 */
export function assertUnknownBoxIsRefused(): void {
  let threw = false;
  try {
    whoseFor(FORM_941_WHOSE, "Form 941", "999");
  } catch (e) {
    threw = true;
    assert(
      String(e).includes('box "999"'),
      "the refusal must name the offending box, or nobody can fix it",
    );
    assert(
      String(e).includes("no default"),
      "the refusal must say why there is no default, not merely that there isn't one",
    );
  }
  assert(threw, "an unclassified box must throw, never default");

  // The other direction: a real line must resolve, or the gate above proves
  // nothing except that the function throws.
  assert(whoseFor(FORM_941_WHOSE, "Form 941", "2").whose === "tax_base", "line 2 must resolve");
}

/**
 * Every classification must carry a REASON, not just a category.
 *
 * A category with no reason is unfalsifiable. This also catches the copy-paste
 * failure where a new row is added with a placeholder that nobody ever revisits.
 */
/**
 * EVERY ownership table in this module, in one place, so a gate cannot check
 * three of four and report success (books-55).
 *
 * ═══ WHY THIS EXISTS, AND WHAT IT IS FIXING ═══
 *
 * `assertEveryClassificationIsJustified` used to build this list inline, by
 * hand, inside its own body. That works only for as long as somebody remembers
 * to add a line to it — and books-55 proved that memory is not a mechanism, in
 * the most embarrassing way available: the books-54 slice added a gate
 * specifically to close standing rule 39 ("a verifier that cannot see something
 * approves it"), and then pointed that new gate at four of the FIVE lesson sets
 * in the repository, leaving three dead cross-references green.
 *
 * The identical hole existed right here. Adding FORM_W3_WHOSE without touching
 * this list would have left thirty-one new LEGAL classifications unchecked for
 * prose quality, silently, with nothing anywhere going red.
 *
 * So the list is a named export, and `tests/compliance/form-box-adapters.test.ts`
 * reads THIS FILE'S OWN SOURCE and asserts that every `export const *_WHOSE`
 * declaration in it appears here. A fifth table cannot be added without the gate
 * naming it.
 *
 * The form NAME travels with the table because assertion messages have to say
 * "Form W-3 box 12b", not "table[3] key 12b". A failure that does not name the
 * form is a failure Michael cannot act on.
 */
export const ALL_WHOSE_TABLES: readonly (readonly [
  string,
  Readonly<Record<string, WhoseRow>>,
])[] = [
  ["Form 941", FORM_941_WHOSE],
  ["Form 940", FORM_940_WHOSE],
  ["Form W-2", FORM_W2_WHOSE],
  ["Form W-3", FORM_W3_WHOSE],
];

export function assertEveryClassificationIsJustified(): void {
  const tables = ALL_WHOSE_TABLES;
  /*
   * Rule 66d: assert existence before absence. An empty or shortened registry
   * would make the loop below a no-op, and this function would report success
   * having justified nothing at all.
   */
  assert(
    tables.length >= 4,
    `ALL_WHOSE_TABLES holds ${tables.length} tables. There are at least four ownership tables ` +
      "in this module (941, 940, W-2, W-3), so a shorter list means one was dropped and its " +
      "classifications are no longer being checked at all.",
  );
  for (const [name, table] of tables) {
    assert(
      Object.keys(table).length > 0,
      `${name}'s ownership table is empty. An empty table makes every check below vacuous, ` +
        "so it is refused here rather than passing quietly.",
    );
    for (const [boxId, row] of Object.entries(table)) {
      assert(row.why.length > 30, `${name} box ${boxId} has no real reason: "${row.why}"`);
      assert(
        row.why.trim().endsWith(".") || row.why.trim().endsWith("blank."),
        `${name} box ${boxId} reason is not a sentence`,
      );
    }
  }
}

/**
 * FUTA must be employer money on EVERY money line of Form 940.
 *
 * This is the one classification on that form that is legally load-bearing, and
 * it is asserted as a property of the whole table rather than of one row, so it
 * cannot be broken by adding a row.
 */
export function assertFutaIsNeverEmployeeMoney(): void {
  for (const [boxId, row] of Object.entries(FORM_940_WHOSE)) {
    assert(
      row.whose !== "employee_money",
      `Form 940 line ${boxId} is classified as employee money. Federal unemployment tax may ` +
        `never be withheld from an employee.`,
    );
    assert(
      row.whose !== "shared",
      `Form 940 line ${boxId} is classified as shared. FUTA has no employee share at all.`,
    );
  }
}

/**
 * Social Security must be `shared` on the 941 and `employee_money` on the W-2.
 *
 * Both are correct and the difference is the whole basis of the W-3-to-941
 * reconciliation. If either drifted to match the other, the Check tab's
 * "line 5a should be about twice the sum of the box 4s" would stop making sense
 * while every colour on screen still looked reasonable.
 */
export function assertSocialSecurityIsClassifiedTwice(): void {
  assert(
    FORM_941_WHOSE["5a"].whose === "shared",
    "941 line 5a is the combined 12.4% and must be shared",
  );
  assert(
    FORM_W2_WHOSE["4"].whose === "employee_money",
    "W-2 box 4 is the employee's 6.2% only and must be employee money",
  );
  assert(
    FORM_941_WHOSE["5a"].why.includes("6.2%"),
    "the 941 reason must show both halves, or the shared classification looks arbitrary",
  );
}

/**
 * The W-2 boxes that report money taken OUT OF an employee's pay.
 *
 * Held as data rather than inlined in the loop (rule 43) so the list itself can
 * be checked for staleness below.
 *
 * Why these five and not others: each one reports a withholding. Boxes 2, 4 and
 * 6 say "withheld" in their printed captions. Boxes 17 and 19 are the state and
 * local income taxes; their captions read "State income tax" and "Local income
 * tax" without the word, but the instructions describe the same mechanic --
 * "state and local income taxes may need to be withheld and" (line 482) -- and
 * both are already classified `employee_money` with reasons that say "withheld".
 * They are permanently blank for a Greenway employee because Washington imposes
 * no personal income tax, but a box that is blank today is still a box that must
 * never be relabelled as the employer's cost.
 */
const W2_BOXES_WITHHELD_FROM_THE_EMPLOYEE = ["2", "4", "6", "17", "19"] as const;

/**
 * Money withheld from a worker may never be reclassified as the employer's.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS GATE EXISTS -- IT WAS FOUND BY BREAKING THE CODE, NOT BY READING IT
 * ─────────────────────────────────────────────────────────────────────────────
 * While mutation-testing books-52 I changed W-2 box 19 from `employee_money` to
 * `employer_cost` -- that is, I relabelled a tax withheld from a worker as
 * Greenway's own expense -- and the entire suite still passed, 37 green. Running
 * the identical mutation on box 17, which shipped long before books-52, also
 * passed. So the hole was pre-existing and not introduced by that slice
 * (rule 106), which is exactly why it had survived: nothing had ever probed it.
 *
 * The 940 already had `assertFutaIsNeverEmployeeMoney` guarding the mirror-image
 * error. The W-2 had no counterpart. This is that counterpart.
 *
 * The direction matters and is not symmetric with the FUTA gate. There the
 * danger is charging the employee for the employer's tax; here it is the reverse
 * bookkeeping lie -- but the reverse lie is the one with the criminal edge.
 * RCW 51.16.140(2) makes deducting the employer's share of workers' compensation
 * from a worker's pay a gross misdemeanour. A system that cheerfully calls
 * withheld money "employer_cost" is a system that will one day render a screen
 * telling Michael he may recover it from someone's cheque.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS GATE IS NARROW ON PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * The tempting version -- "no W-2 box is ever employer_cost" -- is FACTUALLY
 * WRONG, and I checked before writing it. Box 12 code DD is "Cost of
 * employer-sponsored health coverage": genuinely the employer's money, reported
 * on the employee's W-2 for information. A blanket rule would have to be
 * weakened the first time box 12 was modelled properly, and a gate that gets
 * weakened is a gate that teaches people to edit tests instead of think.
 *
 * So this asserts only what is actually true: the five boxes that report money
 * withheld from the worker are the worker's money. `shared` is refused for the
 * same reason as `employer_cost` -- withheld income tax has no employer half.
 */
export function assertWithheldMoneyIsNeverTheEmployers(): void {
  // Rule 66d: prove the boxes exist before asserting anything about their
  // contents. Without this, a renamed or deleted box would empty the loop and
  // the gate would pass by examining nothing at all (rule 40).
  assert(
    W2_BOXES_WITHHELD_FROM_THE_EMPLOYEE.length === 5,
    `the withholding-box list is meant to name 5 boxes but names ` +
      `${W2_BOXES_WITHHELD_FROM_THE_EMPLOYEE.length}. If the W-2 gained or lost a ` +
      `withholding box, update the list and say why in its comment.`,
  );
  for (const boxId of W2_BOXES_WITHHELD_FROM_THE_EMPLOYEE) {
    assert(
      Object.prototype.hasOwnProperty.call(FORM_W2_WHOSE, boxId),
      `W-2 box ${boxId} is named as a withholding box but is missing from ` +
        `FORM_W2_WHOSE, so this gate would silently protect nothing.`,
    );
  }

  for (const boxId of W2_BOXES_WITHHELD_FROM_THE_EMPLOYEE) {
    const row = FORM_W2_WHOSE[boxId];
    assert(
      row.whose !== "employer_cost",
      `W-2 box ${boxId} reports money withheld from the employee but is classified as ` +
        `employer_cost. That inverts who owns the money. Withheld tax is the employee's, ` +
        `paid toward their own liability through Greenway.`,
    );
    assert(
      row.whose !== "shared",
      `W-2 box ${boxId} reports money withheld from the employee but is classified as ` +
        `shared. Withheld income tax has no employer half; the employer's Social Security ` +
        `and Medicare halves appear on no W-2 anywhere.`,
    );
    assert(
      row.whose === "employee_money",
      `W-2 box ${boxId} reports money withheld from the employee and must be classified ` +
        `employee_money, not ${row.whose}.`,
    );
  }
}

/**
 * Every Form 941 line, and whose money it is, pinned one line at a time.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS GATE EXISTS -- IT WAS FOUND BY BREAKING THE CODE, NOT BY READING IT
 * ────────────────────────────────────────────────────────────────────────────
 * While mutation-testing books-53 I changed line 5d from `employee_money` to
 * `shared` -- an assertion that Greenway pays half of the Additional Medicare
 * Tax. The IRS instructions say the exact opposite, in the very file this
 * module quotes: "Additional Medicare Tax is only imposed on the employee.
 * There is no employer share of Additional Medicare Tax."
 * (docs/authorities/federal/irs-instructions-941-2026.txt, lines 1192-1194.)
 *
 * All 11,046 tests passed.
 *
 * Rule 106 says find out whether a hole is new or pre-existing before claiming
 * credit for it, so I mutated line 13 -- `shared` -> `employer_cost`, a line
 * that has been in this table since books-49. That passed too. So the hole was
 * PRE-EXISTING and books-53 merely widened it from 13 lines to 24: only lines
 * 1, 2, 3 and 5a had individually named tests, and the other twenty lines could
 * be relabelled at will without a single test objecting.
 *
 * Why the existing gates did not catch it:
 *   - assertEveryClassificationIsJustified only checks that a `why` string is
 *     present and non-trivial. A wrong classification with good prose sails
 *     through -- and mutation 1 kept the prose that CONTRADICTED it.
 *   - assertSocialSecurityIsClassifiedTwice pins 5a alone.
 *   - assertWithheldMoneyIsNeverTheEmployers (books-52) covers the W-2 only.
 *
 * Why a full table instead of one more assertion about 5d: a single assertion
 * would have closed exactly one hole and left nineteen open, and the next line
 * added to the form would arrive unprotected all over again. Pinning the whole
 * table means an unintended ownership change cannot be silent, and a NEW line
 * cannot be added without someone deciding, in writing, whose money it is.
 *
 * This is a deliberate duplication of the data in FORM_941_WHOSE, which rule 25
 * would normally forbid. It is justified because the two copies exist for
 * opposite reasons: FORM_941_WHOSE is what the application believes, and this is
 * what a human checked against the printed form and the instructions. A gate
 * that imports its expectation from the thing it is checking asserts nothing.
 * Written out by hand from the classifications verified in books-49 and
 * books-53; the captions are in FORM_941_TEACHING.
 */
const FORM_941_EXPECTED_WHOSE: Readonly<Record<string, WhoseMoney>> = {
  "1": "not_money", // Number of employees -- a headcount
  "2": "tax_base", // Wages, tips, and other compensation
  "3": "employee_money", // Federal income tax withheld from wages
  "4": "not_money", // Tickbox: wages not subject to social security/Medicare
  "5a": "shared", // Taxable social security wages (12.4% = 6.2% + 6.2%)
  "5b": "shared", // Taxable social security tips (same split)
  "5c": "shared", // Taxable Medicare wages & tips (2.9% = 1.45% + 1.45%)
  "5d": "employee_money", // Additional Medicare Tax -- NO employer share
  "5e": "shared", // Total of 5a-5d
  "5f": "shared", // Section 3121(q) Notice and Demand -- tax due on unreported tips
  "6": "shared", // Total taxes before adjustments
  "7": "shared", // Current quarter's adjustment for fractions of cents
  "8": "shared", // Current quarter's adjustment for sick pay
  "9": "employee_money", // Uncollected EMPLOYEE share on tips and group-term life
  "10": "shared", // Total taxes after adjustments
  "11": "shared", // Nonrefundable portion of credit
  "12": "shared", // Total taxes after adjustments and nonrefundable credits
  "13": "shared", // Total deposits for this quarter
  "14": "shared", // Balance due
  "15a": "shared", // Overpayment
  "15b": "not_money", // Tickbox: apply to next return, or send a refund
  "15c": "not_money", // Routing number for a refund by direct deposit
  "15d": "not_money", // Tickbox: checking or savings
  "15e": "not_money", // Account number for a refund by direct deposit
  "16": "not_money", // Deposit schedule and tax liability selection
  "17": "not_money", // Tickbox: business has closed / stopped paying wages
  "18": "not_money", // Tickbox: seasonal employer
};

/**
 * The Additional Medicare Tax has no employer share. Said once, in the open,
 * with the authority attached, because it is the one line on this form whose
 * ownership differs from the social security and Medicare lines beside it.
 */
export function assertAdditionalMedicareTaxHasNoEmployerShare(): void {
  const row = FORM_941_WHOSE["5d"];
  assert(
    row !== undefined,
    "Form 941 line 5d (Additional Medicare Tax) has no classification at all. " +
      "It must be classified before this gate can check it.",
  );
  assert(
    row.whose !== "shared",
    "Form 941 line 5d is classified `shared`, which says Greenway pays half of the " +
      "Additional Medicare Tax. The instructions say: \u201cAdditional Medicare Tax is only " +
      "imposed on the employee. There is no employer share of Additional Medicare Tax.\u201d " +
      "Lines 5a, 5b and 5c are shared; 5d is not, and that is the point of the line.",
  );
  assert(
    row.whose !== "employer_cost",
    "Form 941 line 5d is classified `employer_cost`, but the Additional Medicare Tax is " +
      "withheld from the employee and is never Greenway's own cost.",
  );
  assert(
    row.whose === "employee_money",
    `Form 941 line 5d must be classified employee_money, not ${row.whose}. ` +
      "It is withheld from one employee's pay above $200,000 and nobody else contributes.",
  );
}

/**
 * No line on the 941 may quietly change whose money it is.
 *
 * Checks both directions on purpose (rule 66d): every expected line must still
 * be classified, and every classified line must be expected. The second half is
 * what protects the NEXT line added to the form -- it will fail here until
 * somebody writes down whose money it is.
 */
export function assertEvery941LineOwnershipIsPinned(): void {
  const expectedIds = Object.keys(FORM_941_EXPECTED_WHOSE);
  const actualIds = Object.keys(FORM_941_WHOSE);

  assert(
    expectedIds.length === 27,
    `The pinned Form 941 ownership table should describe 27 lines but describes ` +
      `${expectedIds.length}. If the form gained or lost a line, update the table ` +
      "deliberately rather than changing this count to match.",
  );

  for (const lineId of expectedIds) {
    assert(
      Object.prototype.hasOwnProperty.call(FORM_941_WHOSE, lineId),
      `Form 941 line ${lineId} is pinned in the expected-ownership table but is no longer ` +
        "classified in FORM_941_WHOSE. A line cannot stop having an owner.",
    );
  }

  for (const lineId of actualIds) {
    assert(
      Object.prototype.hasOwnProperty.call(FORM_941_EXPECTED_WHOSE, lineId),
      `Form 941 line ${lineId} is classified in FORM_941_WHOSE but nobody has pinned whose ` +
        "money it is. Add it to FORM_941_EXPECTED_WHOSE with a comment naming the line, so " +
        "the classification is a decision on the record and not an accident.",
    );
  }

  for (const lineId of expectedIds) {
    const expected = FORM_941_EXPECTED_WHOSE[lineId];
    const actual = FORM_941_WHOSE[lineId].whose;
    assert(
      actual === expected,
      `Form 941 line ${lineId} is classified ${actual} but was verified against the printed ` +
        `form and the instructions as ${expected}. Either the classification is wrong, or the ` +
        "law changed and the pinned table needs updating with a source. Do not simply " +
        "reconcile the two to make this pass.",
    );
  }
}

/**
 * ═══ THE SAME HOLE WAS OPEN ON THE 940, AND IT WAS PRE-EXISTING (books-54) ═══
 *
 * books-53 found that 20 of the 941's 24 ownership rows could be relabelled
 * without a single test objecting, and closed it with a pinned table. The
 * obvious question was whether the 940 had the same hole. Rule 106 says measure
 * before claiming, so it was MEASURED FIRST, before this slice changed
 * anything, by mutating four rows that had been in the table since books-47:
 *
 *   line 8  employer_cost -> employee_money   CAUGHT
 *   line 13 employer_cost -> shared           CAUGHT
 *   line 17 employer_cost -> tax_base         SURVIVED  <-- 274 tests, all green
 *   line 3  tax_base -> employer_cost         CAUGHT
 *
 * So the hole was real, PRE-EXISTING, and narrower than the 941's -- because
 * the 940 happens to have two gates the 941 lacks:
 *
 *   - `assertFutaIsNeverEmployeeMoney` refuses `employee_money` and `shared` on
 *     EVERY line of this form. That is what caught lines 8 and 13.
 *   - a named test in form-box-lessons-940.test.ts, "keeps the wage-base lines
 *     out of the money split", pins lines 3-7 as `tax_base`. That caught line 3.
 *
 * What nothing covered was drift AMONG the three remaining values -- exactly
 * the `employer_cost` <-> `tax_base` <-> `not_money` triangle. Line 17 is the
 * worst possible place for that to be unguarded: it is the annual total that
 * must equal line 12 to the cent, and calling it `tax_base` says the year's
 * FUTA tax is a wage figure nobody owes.
 *
 * Note what this means about the FUTA gate: it is a good gate that creates a
 * false sense of security. It proves no line is the EMPLOYEE's, and it is
 * silent on whether a line is money at all.
 *
 * Same justified duplication as the 941 table above: this is what a human read
 * off the printed 2025 Form 940 and its instructions, not what the application
 * believes. A gate that imports its expectation from the thing it checks
 * asserts nothing (rule 39).
 */
const FORM_940_EXPECTED_WHOSE: Readonly<Record<string, WhoseMoney>> = {
  "1a": "not_money", // State abbreviation -- two letters of text, "WA"
  "1b": "not_money", // Tickbox: multi-state employer, requires Schedule A
  "2": "not_money", // Tickbox: paid wages in a credit reduction state
  "3": "tax_base", // Total payments to all employees
  "4": "tax_base", // Payments exempt from FUTA tax -- a subtraction
  "4a": "not_money", // Tickbox: exemption was fringe benefits
  "4b": "not_money", // Tickbox: exemption was group-term life insurance
  "4c": "not_money", // Tickbox: exemption was retirement/pension
  "4d": "not_money", // Tickbox: exemption was dependent care
  "4e": "not_money", // Tickbox: exemption was some other listed category
  "5": "tax_base", // Payments to each employee above the $7,000 ceiling
  "6": "tax_base", // Subtotal of lines 4 and 5
  "7": "tax_base", // Total taxable FUTA wages
  "8": "employer_cost", // FUTA tax before adjustments -- never the employee's
  "9": "employer_cost", // Adjustment: all wages excluded from state unemployment
  "10": "employer_cost", // Adjustment: some excluded, or state tax paid late
  "11": "employer_cost", // Credit reduction amount from Schedule A
  "12": "employer_cost", // Total FUTA tax after adjustments
  "13": "employer_cost", // FUTA tax deposited for the year
  "14": "employer_cost", // Balance due
  "15a": "employer_cost", // Overpayment of Greenway's own tax
  "15b": "not_money", // Tickbox: apply to next return, or send a refund
  "15c": "not_money", // Routing number for a refund by direct deposit
  "15d": "not_money", // Tickbox: checking or savings
  "15e": "not_money", // Account number for a refund by direct deposit
  "16a": "employer_cost", // 1st quarter FUTA liability
  "16b": "employer_cost", // 2nd quarter FUTA liability
  "16c": "employer_cost", // 3rd quarter FUTA liability
  "16d": "employer_cost", // 4th quarter FUTA liability
  "17": "employer_cost", // Total for the year -- must equal line 12
};

/**
 * Pin every Form 940 line's ownership, in both directions.
 *
 * Both directions matter, and for different reasons. Expected-but-missing means
 * a line silently stopped having an owner. Actual-but-unpinned means a line was
 * added to the form without anyone deciding, in writing, whose money it is --
 * which is exactly how the twelve lines this slice added could have arrived.
 */
export function assertEvery940LineOwnershipIsPinned(): void {
  const expectedIds = Object.keys(FORM_940_EXPECTED_WHOSE);
  const actualIds = Object.keys(FORM_940_WHOSE);

  assert(
    expectedIds.length === 30,
    `The pinned Form 940 ownership table should describe 30 lines but describes ` +
      `${expectedIds.length}. Form 940 has 30 numbered lines on the printed page ` +
      "(1a through 17). If the form gained or lost a line, update the table " +
      "deliberately rather than changing this count to match.",
  );

  for (const lineId of expectedIds) {
    assert(
      Object.prototype.hasOwnProperty.call(FORM_940_WHOSE, lineId),
      `Form 940 line ${lineId} is pinned in the expected-ownership table but is no longer ` +
        "classified in FORM_940_WHOSE. A line cannot stop having an owner.",
    );
  }

  for (const lineId of actualIds) {
    assert(
      Object.prototype.hasOwnProperty.call(FORM_940_EXPECTED_WHOSE, lineId),
      `Form 940 line ${lineId} is classified in FORM_940_WHOSE but nobody has pinned whose ` +
        "money it is. Add it to FORM_940_EXPECTED_WHOSE with a comment naming the line, so " +
        "the classification is a decision on the record and not an accident.",
    );
  }

  for (const lineId of expectedIds) {
    const expected = FORM_940_EXPECTED_WHOSE[lineId];
    const actual = FORM_940_WHOSE[lineId].whose;
    assert(
      actual === expected,
      `Form 940 line ${lineId} is classified ${actual} but was verified against the printed ` +
        `2025 Form 940 and its instructions as ${expected}. Either the classification is ` +
        "wrong, or the law changed and the pinned table needs updating with a source. Do not " +
        "simply reconcile the two to make this pass.",
    );
  }
}

/**
 * The line that survived the mutation sweep, pinned by name as well as by table.
 *
 * Line 17 is the year's total FUTA liability and must equal line 12 to the cent.
 * Named separately because the table above protects it by construction, and a
 * future refactor that weakened the table would take this with it -- whereas a
 * named assertion about the one line that actually escaped will go red on its
 * own and carry the reason with it.
 */
export function assertForm940AnnualTotalIsTheEmployersCost(): void {
  for (const lineId of ["12", "17"]) {
    assert(
      FORM_940_WHOSE[lineId].whose === "employer_cost",
      `Form 940 line ${lineId} must be employer_cost. It is the year's federal unemployment ` +
        "tax, which is Greenway's own cost in full and may never be withheld from anyone. " +
        `Line 17 is the line that survived books-54's mutation sweep before the pinned table ` +
        "existed, so it is asserted here by name and not only by table.",
    );
  }
}

/**
 * What a human read off Michael's OWN filed 2025 Form W-3, box by box (books-55).
 *
 * Source of truth for this table: `/workspace/2025_FORM_W-3.pdf`, Michael's real
 * 2025 transmittal covering ten W-2s, extracted with `pdftotext -layout` so the
 * boxes appear in their PRINTED positions rather than in a regex's idea of
 * order. Cross-checked against
 * `docs/authorities/federal/irs-instructions-w-2-w-3-2026.txt` lines 2867-3055,
 * which is the "Specific Instructions for Form W-3" section.
 *
 * Same justified duplication as the 941 and 940 tables above: this is what the
 * PAPER says, not what the application believes. A gate that imports its
 * expectation from the thing it checks asserts nothing (rule 39).
 *
 * ═══ THE TWO BOXES WHERE THE PAPER AND THE INSTRUCTIONS DISAGREE ═══
 *
 * `12b` is printed on the form, bottom right, directly under 12a. There is NO
 * "Box 12b" heading anywhere in the 4,216 lines of the mirrored General
 * Instructions — a grep for "12b" across the whole corpus returns nothing. It is
 * therefore pinned `not_money`, because we have no authority saying an amount
 * belongs there, and classifying it `tax_base` would be asserting a rule that
 * nobody wrote.
 *
 * `9` is printed with NO CAPTION AT ALL on the 2025 form — the layout shows a
 * bare "9" followed immediately by box 10's label. The instructions explain why:
 * "Box 9. Do not enter an amount in box 9." An unlabelled box is not an
 * oversight here; it is a retired box the SSA has stopped naming.
 */
const FORM_W3_EXPECTED_WHOSE: Readonly<Record<string, WhoseMoney>> = {
  a: "not_money", // Control number -- optional filing reference
  "b-kind-of-payer": "not_money", // 941 / Military / 943 / 944 / CT-1 / Hshld. / Medicare govt.
  "b-kind-of-employer": "not_money", // None apply / 501c non-govt / State-local / Federal govt
  "b-third-party-sick-pay": "not_money", // One checkbox, explicitly NOT a kind of payer
  c: "not_money", // Total number of Forms W-2 -- a COUNT of forms; ten for 2025
  d: "not_money", // Establishment number -- optional, unused by Greenway
  e: "not_money", // Employer identification number -- an identifier
  f: "not_money", // Employer's name -- text
  g: "not_money", // Employer's address and ZIP code -- text
  h: "not_money", // Other EIN used this year -- an identifier, blank for Greenway
  "1": "tax_base", // Wages, tips, other compensation -- total of W-2 box 1
  "2": "employee_money", // Federal income tax withheld -- total of W-2 box 2
  "3": "tax_base", // Social security wages -- total of W-2 box 3
  "4": "employee_money", // Social security tax withheld -- employees' 6.2% halves only
  "5": "tax_base", // Medicare wages and tips -- total of W-2 box 5
  "6": "employee_money", // Medicare tax withheld -- employees' 1.45% halves only
  "7": "tax_base", // Social security tips -- total of W-2 box 7
  "8": "tax_base", // Allocated tips -- total of W-2 box 8
  "9": "not_money", // Retired box. "Do not enter an amount in box 9."
  "10": "tax_base", // Dependent care benefits -- total of W-2 box 10
  "11": "tax_base", // Nonqualified plans -- total of W-2 box 11
  "12a": "tax_base", // Deferred compensation -- a FILTERED subset of W-2 box 12
  "12b": "not_money", // Printed on the form; NO instruction text exists for it
  "13": "not_money", // For third-party sick pay use only -- "Leave this box blank."
  "14": "employee_money", // Income tax withheld by payer of third-party sick pay
  "15": "not_money", // State abbreviation and state ID number -- identifiers
  "16": "tax_base", // State wages -- blank in Washington
  "17": "employee_money", // State income tax -- blank in Washington
  "18": "tax_base", // Local wages -- blank in Washington
  "19": "employee_money", // Local income tax -- blank in Washington
  contact: "not_money", // Contact person, telephone, fax, email
};

/**
 * Pin every Form W-3 box's ownership, in both directions.
 *
 * Both directions matter for the same reasons they do on the 940:
 * expected-but-missing means a box silently stopped having an owner;
 * actual-but-unpinned means a box was added to the form without anyone deciding,
 * in writing, whose money it is.
 */
export function assertEveryW3BoxOwnershipIsPinned(): void {
  const expectedIds = Object.keys(FORM_W3_EXPECTED_WHOSE);
  const actualIds = Object.keys(FORM_W3_WHOSE);

  assert(
    expectedIds.length === 31,
    `The pinned Form W-3 ownership table should describe 31 boxes but describes ` +
      `${expectedIds.length}. The printed 2025 Form W-3 carries box a, THREE separate ` +
      "checkbox groups all printed as b, boxes c through h, boxes 1 through 19 with 12 split " +
      "into 12a and 12b, and the contact block. If the form gained or lost a box, update the " +
      "table deliberately rather than changing this count to match.",
  );

  for (const boxId of expectedIds) {
    assert(
      Object.prototype.hasOwnProperty.call(FORM_W3_WHOSE, boxId),
      `Form W-3 box ${boxId} is pinned in the expected-ownership table but is no longer ` +
        "classified in FORM_W3_WHOSE. A box cannot stop having an owner.",
    );
  }

  for (const boxId of actualIds) {
    assert(
      Object.prototype.hasOwnProperty.call(FORM_W3_EXPECTED_WHOSE, boxId),
      `Form W-3 box ${boxId} is classified in FORM_W3_WHOSE but nobody has pinned whose ` +
        "money it is. Add it to FORM_W3_EXPECTED_WHOSE with a comment naming the box, so the " +
        "classification is a decision on the record and not an accident.",
    );
  }

  for (const boxId of expectedIds) {
    const expected = FORM_W3_EXPECTED_WHOSE[boxId];
    const actual = FORM_W3_WHOSE[boxId].whose;
    assert(
      actual === expected,
      `Form W-3 box ${boxId} is classified ${actual} but was verified against Michael's own ` +
        `filed 2025 Form W-3 and the General Instructions as ${expected}. Either the ` +
        "classification is wrong, or the law changed and the pinned table needs updating with " +
        "a source. Do not simply reconcile the two to make this pass.",
    );
  }
}

/**
 * THE CLASS-LEVEL GATE FOR A TRANSMITTAL: totalling money cannot change who owns
 * it.
 *
 * ═══ WHY THIS IS THE RIGHT SHAPE OF CHECK FOR THIS PARTICULAR FORM ═══
 *
 * Every money box on the W-3 is defined by the instructions as the total of the
 * same-numbered box across the W-2s in the envelope: "Boxes 1 through 8. Enter
 * the totals reported in boxes 1 through 8 on the Forms W-2."
 *
 * Addition does not transfer ownership. Ten employees' withheld federal income
 * tax, added together, is still ten employees' money. So for every box id the two
 * forms SHARE, the classification must be identical — and rather than
 * hand-checking that once and hoping, this DERIVES the expectation from
 * FORM_W2_WHOSE, so the two tables cannot drift apart silently.
 *
 * ═══ WHY THE EXCEPTIONS ARE NAMED RATHER THAN SKIPPED ═══
 *
 * Some shared ids legitimately differ, and each is named with its reason. A
 * blanket "skip anything that disagrees" would let a real drift hide behind the
 * exception list. So the list is CLOSED IN BOTH DIRECTIONS: an id not in it must
 * match exactly, and every id in it must still exist and still carry a real
 * reason. An exemption that has outlived its purpose is dead weight that hides
 * the next genuine difference.
 */
export function assertW3MoneyBoxesMatchTheirW2Box(): void {
  /*
   * The closed exception list. Each entry says what each form's box actually is,
   * so the difference can be judged rather than merely tolerated.
   */
  const JUSTIFIED_DIFFERENCES: Readonly<Record<string, string>> = {
    /*
     * BOX 13 IS DELIBERATELY NOT LISTED HERE, and that is worth recording.
     *
     * The two forms' box 13 really are different boxes: on the W-2 it is three
     * checkboxes about the EMPLOYEE (statutory employee, retirement plan,
     * third-party sick pay), and on the W-3 it is a money box reserved for
     * third-party sick pay payers which Greenway must leave blank.
     *
     * The first draft of this function listed it, on the reasoning that
     * "different box, therefore exempt". But they both classify `not_money`, so
     * they do not disagree, and an exemption for a box that does not disagree is
     * a hole: it would silently absorb a future change classifying W-3 box 13 as
     * employee_money. Found by printing the real difference set rather than by
     * reading — the set has exactly ONE member, box 14.
     *
     * So the rule is now enforced in both directions below: an entry in this
     * list must ACTUALLY differ, or it fails as stale.
     */
    "14":
      "W-2 box 14 is a free-text 'Other' box, classified tax_base because it reports a figure " +
      "such as the health insurance premiums on Michael's own W-2. W-3 box 14 is a specific " +
      "money box — income tax withheld by a payer of third-party sick pay — which is the " +
      "employees' money. The number is shared but the box genuinely is not.",
  };

  /*
   * ═══ THE SIX LETTERS ARE SHARED IDS THAT ARE NOT SHARED BOXES (books-56) ═══
   *
   * Until books-56, FORM_W2_WHOSE held boxes 1-20 only, so every id shared with
   * the W-3 was a NUMBERED box, and for numbered boxes the premise of this whole
   * function holds: W-3 box 2 is defined by the instructions as the total of
   * W-2 box 2 across the envelope, and summing money does not change whose it is.
   *
   * Adding the W-2's lettered boxes a-f broke that premise without breaking this
   * gate, which is the dangerous combination. The letters collide but the boxes
   * do not:
   *
   *     letter │ on the W-2                    │ on the W-3
   *     ───────┼───────────────────────────────┼──────────────────────────────
   *       a    │ Employee's SSN                │ Control number (optional)
   *       b    │ Employer's EIN                │ Kind of Payer  (as b-*, so no clash)
   *       c    │ Employer's name and address   │ Total number of Forms W-2
   *       d    │ Control number (optional)     │ Establishment number
   *       e    │ Employee's name               │ Employer's EIN
   *       f    │ Employee's address            │ Employer's name
   *
   * Note box d and box a: the W-2's control number is box d and the W-3's is box
   * a. The two forms genuinely disagree about which letter means what.
   *
   * All twelve classify `not_money`, so `w2 === w3` holds for every one of them
   * and this gate would have gone green on all six. That green would have been an
   * ACCIDENT — it would prove only that identifiers are not money, a fact already
   * known — while implying to a future reader that a total-of relationship had
   * been verified. Rule 40 refuses a guard that cannot fail for the reason it
   * claims to be checking.
   *
   * So the letters are excluded from the comparison BY NAME and by a stated
   * reason, and the exclusion is itself gated below: each excluded letter must
   * actually exist on both forms and must actually mean two different things,
   * or the exclusion fails as stale. That way the list cannot quietly grow to
   * cover a numbered box, which is the failure it would be built to hide.
   */
  const NOT_THE_SAME_BOX: Readonly<Record<string, string>> = {
    a: "W-2 box a is the employee's SSN; W-3 box a is an optional control number.",
    /*
     * BOX b IS DELIBERATELY ABSENT FROM THIS LIST, and it was absent only after
     * the list's own staleness guard refused it.
     *
     * The first draft listed b, reasoning that the W-2's box b (the employer's
     * EIN) and the W-3's box b (three checkbox groups) are obviously different
     * boxes. They are — but the W-3 does not HAVE a box id "b". Its three
     * checkbox groups are registered as b-kind-of-payer, b-kind-of-employer and
     * b-third-party-sick-pay precisely because one printed letter carries three
     * separate rules. So "b" is not a shared id, no comparison on it ever
     * happens, and an entry here excused nothing while implying it had.
     *
     * That is the same defect this file already documents for box 13 in
     * JUSTIFIED_DIFFERENCES: an exemption for a comparison that does not occur
     * is not neutral, it is a standing licence for the next real difference on
     * that id to pass unnoticed. Written down because it is now the second time
     * the identical mistake has been made in this one function, once in books-55
     * and once here, and the reason it was caught both times is that the
     * exemption lists are gated in both directions rather than merely read.
     */
    c: "W-2 box c is the employer's name and address; W-3 box c is a count of the Forms W-2 in the envelope.",
    d: "W-2 box d is an optional control number; W-3 box d is an establishment number. The W-3's control number is box a, so the two forms disagree about which letter means what.",
    e: "W-2 box e is the employee's name; W-3 box e is the employer's EIN.",
    f: "W-2 box f is the employee's address; W-3 box f is the employer's name.",
  };

  const sharedIds = Object.keys(FORM_W3_WHOSE).filter((b) =>
    Object.prototype.hasOwnProperty.call(FORM_W2_WHOSE, b),
  );

  /*
   * Both halves of the closed list, applied to the letters as well. An entry
   * naming a box that is not on both forms excuses a comparison that never
   * happens; an entry whose two captions are identical is not a real difference.
   */
  for (const [letter, why] of Object.entries(NOT_THE_SAME_BOX)) {
    assert(
      Object.prototype.hasOwnProperty.call(FORM_W2_WHOSE, letter) &&
        Object.prototype.hasOwnProperty.call(FORM_W3_WHOSE, letter),
      `Box ${letter} is excluded from the W-2/W-3 total-of comparison as "not the same box", ` +
        "but it is not present on both forms, so the comparison it excuses never happens. " +
        "A guard against a comparison that cannot occur hides the next real one. Remove it.",
    );
    assert(
      why.length > 60,
      `The reason box ${letter} is excluded from the W-2/W-3 comparison is ${why.length} ` +
        "characters. Say what each form's box actually is, or the exclusion cannot be judged.",
    );
    assert(
      !/^[0-9]/.test(letter),
      `Box ${letter} is excluded from the W-2/W-3 comparison as "not the same box", but it is ` +
        "a NUMBERED box. Numbered boxes on the W-3 are defined as the total of the same-numbered " +
        "box across the W-2s, so they are the same box by definition and must be compared. This " +
        "list exists only for the lettered header boxes, where the letters collide but the boxes " +
        "do not.",
    );
  }

  const shared = sharedIds.filter((b) => NOT_THE_SAME_BOX[b] === undefined);

  /*
   * Rule 66d again, one level down: prove the exclusion list actually excluded
   * something. If FORM_W2_WHOSE ever loses its lettered boxes, every entry above
   * fails loudly on the existence assertion rather than this filter silently
   * becoming an identity function.
   */
  assert(
    sharedIds.length - shared.length === Object.keys(NOT_THE_SAME_BOX).length,
    `${Object.keys(NOT_THE_SAME_BOX).length} lettered boxes are excluded from the W-2/W-3 ` +
      `comparison but only ${sharedIds.length - shared.length} were actually removed from the ` +
      "shared set. The exclusion list and the tables have drifted apart.",
  );

  /*
   * Rule 66d: assert existence before absence. A filter that matched nothing
   * would make every assertion below vacuous, and this function would report
   * success having compared no boxes at all.
   */
  assert(
    shared.length >= 15,
    `Only ${shared.length} box ids are shared between FORM_W2_WHOSE and FORM_W3_WHOSE. The ` +
      "two forms share boxes 1-11 and 13-19 at minimum, so a number this low means one of the " +
      "tables was renamed or emptied and this comparison is no longer comparing anything.",
  );

  let compared = 0;
  for (const boxId of shared) {
    const w2 = FORM_W2_WHOSE[boxId].whose;
    const w3 = FORM_W3_WHOSE[boxId].whose;
    if (JUSTIFIED_DIFFERENCES[boxId] !== undefined) continue;

    assert(
      w2 === w3,
      `Form W-3 box ${boxId} is ${w3} but the same box on the W-2 is ${w2}. Every money box ` +
        "on the W-3 is the TOTAL of that box across the W-2s in the envelope, and adding money " +
        "up does not change whose it is. Either one of the two classifications is wrong, or " +
        "this box is a genuine exception and belongs in JUSTIFIED_DIFFERENCES with a written " +
        "reason. Do not add it to that list merely to silence this.",
    );
    compared += 1;
  }

  assert(
    compared >= 17,
    `Only ${compared} boxes were actually compared after exceptions. The two forms share 18 ` +
      "box ids and exactly one of them (box 14) genuinely differs, so anything below 17 means " +
      "the exception list has grown and this gate has stopped checking the form.",
  );

  /*
   * THE OTHER HALF OF A CLOSED LIST. Three ways an exemption can rot, all
   * refused: the box stops existing on either form, the reason decays to a stub,
   * or — the one that actually caught me here — the two forms come to AGREE and
   * the exemption is left behind, sitting ready to absorb the next real
   * difference on that box id.
   */
  for (const [boxId, why] of Object.entries(JUSTIFIED_DIFFERENCES)) {
    assert(
      Object.prototype.hasOwnProperty.call(FORM_W3_WHOSE, boxId),
      `Box ${boxId} is excused in JUSTIFIED_DIFFERENCES but is not in FORM_W3_WHOSE at all. ` +
        "An exemption for a box that does not exist is dead weight that hides the next real " +
        "difference. Remove it.",
    );
    assert(
      Object.prototype.hasOwnProperty.call(FORM_W2_WHOSE, boxId),
      `Box ${boxId} is excused in JUSTIFIED_DIFFERENCES but is not in FORM_W2_WHOSE, so the ` +
        "comparison it claims to excuse never happens. Remove the stale exemption.",
    );
    assert(
      FORM_W2_WHOSE[boxId].whose !== FORM_W3_WHOSE[boxId].whose,
      `Box ${boxId} is excused in JUSTIFIED_DIFFERENCES, but the W-2 and the W-3 both ` +
        `classify it ${FORM_W3_WHOSE[boxId].whose} — they AGREE, so there is nothing to ` +
        "excuse. Delete the entry. An exemption on a box that does not disagree is not " +
        "harmless: it is a standing licence for a future divergence on that box to pass " +
        "unnoticed, which is exactly how box 13 nearly slipped through this slice.",
    );
    assert(
      why.length > 80,
      `The justification for Form W-3 box ${boxId} differing from the W-2 is ${why.length} ` +
        "characters. That is too short to be a reason. Say what each form's box actually is.",
    );
  }
}

export function __runFormBoxAdapterTests(): void {
  assertUnknownBoxIsRefused();
  assertEveryClassificationIsJustified();
  assertFutaIsNeverEmployeeMoney();
  assertSocialSecurityIsClassifiedTwice();
  assertWithheldMoneyIsNeverTheEmployers();
  assertAdditionalMedicareTaxHasNoEmployerShare();
  assertEvery941LineOwnershipIsPinned();
  assertEvery940LineOwnershipIsPinned();
  assertForm940AnnualTotalIsTheEmployersCost();
  assertEveryW3BoxOwnershipIsPinned();
  assertW3MoneyBoxesMatchTheirW2Box();
}
