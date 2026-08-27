/**
 * src/lib/payroll/form-box-teaching-core.ts   (books-49)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TEACH THE FORM EVEN WHEN THERE IS NOTHING TO PUT IN IT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, verbatim, after inspecting the shipped build:
 *
 *   "I am unable to see or use the tab system we built to let me see the
 *    various forms and be able to click them for learning about them. The form
 *    pages are still just walls of text... There should be a visual form for
 *    every single form in its own tab."
 *
 * ─── THE BUG, STATED PRECISELY ─────────────────────────────────────────────
 *
 * Every teaching surface was rendered inside a conditional on computed data:
 *
 *   form-940/page.tsx      {result.ok ? <FormBoxExplorer .../> : null}
 *   form-941/page.tsx      {result.ok && result.subjectCount > 0 ? ... : null}
 *   wa-quarterly/page.tsx  {result.ok && result.value.lines.length > 0 ? ...}
 *
 * Greenway's first payroll is 1 January 2027. Until then there are no pay
 * runs, so every one of those guards is FALSE, so the tabs were never on the
 * page at all. Verified by running `buildForm941` against the data the live
 * system actually has and printing the guard: `false`.
 *
 * The teaching was not broken. It was NEVER REACHED. That is standing rule 40
 * — an unreachable guard is an untested guard — with the twist that here the
 * unreachable thing was the entire feature.
 *
 * ─── WHY THE FIX IS A NEW ADAPTER AND NOT JUST DELETING THE GUARDS ─────────
 *
 * `form941Boxes(ret)`, `form940Boxes(ret)` and `waBoxes(ret, form)` all map
 * over `ret.lines`. With no computed return there is no `ret` to map, so
 * deleting the guards alone would render three tabs above an empty table.
 *
 * So this module builds the boxes from metadata that does not depend on
 * payroll at all: the box number, the caption as the form prints it, whose
 * money it is, and why. All of that is a property of the FORM, published by
 * the IRS, true in a year with no employees.
 *
 * ─── THE ONE RULE THIS MODULE EXISTS TO ENFORCE ────────────────────────────
 *
 * A box with no computed figure is NEVER shown as 0.00.
 *
 * A zero is a claim. "$0.00" in box 5a says "you paid no Social Security wages
 * this quarter", which is a sentence the IRS acts on. This codebase already
 * refuses that trade in the Washington adapter, which THROWS rather than
 * report zero reportable hours, because zero hours is a claim on a workers'
 * compensation return. The same logic applies to every box on every form, so
 * `FormBox.notComputedYet` carries the reason and `formatBoxValue` prints
 * "not computed yet" instead of a number.
 *
 * ─── WHY CAPTIONS LIVE HERE AND NOT IN A SECOND TABLE ──────────────────────
 *
 * The engines hold their captions inline, interpolated with real figures in
 * the `derivation` field. Reusing an engine would mean inventing a specimen
 * return — which would put fabricated numbers on Michael's screen wearing the
 * same styling as his real ones. Rule 62d forbids inventing a default, and a
 * fabricated figure is the most expensive default there is.
 *
 * So the caption is stated once, here, and a self-test asserts that every box
 * carrying a LESSON also appears in this table. That is the drift guard: the
 * moment somebody teaches a box this file does not know about, the build
 * fails and names it.
 */

import {
  type FormBox,
  type BoxLesson,
  type WhoseMoney,
  type BoxMeasure,
} from "@/lib/payroll/form-box-core";
import { type W3Form } from "@/lib/payroll/form-w2-core";
import {
  FORM_941_WHOSE,
  FORM_940_WHOSE,
  FORM_W2_WHOSE,
  FORM_W3_WHOSE,
  FORM_ID_W3,
  ENTITY_BOX_CAPTIONS,
  type WhoseRow,
} from "@/lib/payroll/form-box-adapters";
/*
 * The REAL identity builders the sheet pages call, imported so D-15's gate can
 * ask them what they emit rather than being told. Safe in this direction:
 * form-facsimile-core imports nothing from this module, so there is no cycle.
 */
import {
  nine41IdentityText,
  nine40IdentityText,
  w3IdentityText,
} from "@/lib/payroll/form-facsimile-core";
// Imported so the drift gate can compare this file's claims against a return
// the engine actually built, rather than against this file's own opinions.
import {
  buildWaQuarter,
  type WaQuarterRequest,
  type WaQuarterFormId,
} from "@/lib/payroll/wa-quarterly-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  THE TEACHING SPECIMEN
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One box of a form, described without reference to any figure.
 *
 * `caption` is the form's own words, not ours — a reader holding the paper
 * must be able to find the same line by reading across.
 */
export type TeachingBox = {
  readonly box: string;
  readonly caption: string;
  /**
   * ═══ WHOSE MONEY IS NOT WRITTEN HERE (books-49) ═══
   *
   * This field used to be `readonly whose: WhoseMoney`, authored by hand next
   * to the caption. It was wrong within hours of being written.
   *
   * Printing the engine's real output beside the hand-written table showed
   * `lni-hours` classified `not_money` here and `shared` there, and the two
   * bottom-line boxes of the Washington returns missing from this file
   * entirely. Whose money a box is, is a LEGAL classification with criminal
   * consequences when it is wrong (RCW 51.16.140(2) makes deducting the
   * employer's workers' compensation share from a worker a gross misdemeanour)
   * and it must have exactly one answer in the codebase.
   *
   * So it is now looked up: the federal forms from the adapters' own
   * `FORM_*_WHOSE` tables, the Washington forms from a source gated against a
   * REAL engine build. `whoseSource` names where the answer comes from; it does
   * not contain the answer. Rule 25 - extend, never duplicate.
   */
  readonly whoseSource: WhoseSource;
  /**
   * How this box gets filled in, in English, with NO numbers substituted.
   *
   * Deliberately different in kind from the engines' `derivation`, which reads
   * "$10,000.00 x 12.4% = $1,240.00". That sentence is only true of a specific
   * return. This one is true of every return, which is what makes it safe to
   * show before any return exists.
   */
  readonly howItGetsFilled: string;
};

/**
 * Where a box's `whose` classification is read from.
 *
 * `federal` means the adapters' shared table, keyed by this box's own id.
 * `wa` means the value is carried on the row, because the Washington engine
 * holds its classification inline on each line rather than in a table - and a
 * self-test builds a real quarter and asserts the two agree, so "carried here"
 * still cannot drift.
 */
export type WhoseSource =
  | { readonly kind: "federal"; readonly table: Readonly<Record<string, WhoseRow>> }
  | { readonly kind: "wa"; readonly whose: WhoseMoney; readonly measure: BoxMeasure };

/** Shorthand so a spec row names its table once and never repeats the answer. */
const FED_941: WhoseSource = { kind: "federal", table: FORM_941_WHOSE };
const FED_940: WhoseSource = { kind: "federal", table: FORM_940_WHOSE };
const FED_W2: WhoseSource = { kind: "federal", table: FORM_W2_WHOSE };
const FED_W3: WhoseSource = { kind: "federal", table: FORM_W3_WHOSE };

/** A Washington row states its classification AND its unit; both are gated. */
function wa(whose: WhoseMoney, measure: BoxMeasure = "money"): WhoseSource {
  return { kind: "wa", whose, measure };
}

/**
 * Resolve a box's classification and unit, or throw naming the box.
 *
 * Throws rather than defaulting for exactly the reason `whoseFor` in the
 * adapters throws: there is no safe default. Every candidate value asserts
 * something about whose money it is, and asserting that wrongly on a
 * Washington return is a crime rather than a typo (rule 48, rule 62d).
 */
function resolveWhose(
  formId: string,
  t: TeachingBox,
): { readonly whose: WhoseMoney; readonly measure: BoxMeasure } {
  if (t.whoseSource.kind === "wa") {
    return { whose: t.whoseSource.whose, measure: t.whoseSource.measure };
  }
  const row = t.whoseSource.table[t.box];
  if (row === undefined) {
    throw new Error(
      `form-box-teaching-core: form "${formId}" box "${t.box}" is in the teaching specimen but ` +
        `not in the adapters' classification table, so there is no answer to whose money it is. ` +
        `Add it to the FORM_*_WHOSE table in form-box-adapters.ts - that table is the single ` +
        `source, and this file deliberately does not keep a second copy of the answer.`,
    );
  }
  // Form 941 line 1 is the only federal box that counts people rather than
  // money; the engine flags it with `isCount` and the adapter turns that into
  // measure "count". Derived from the classification rather than from a second
  // hand-written list, because "not_money" is exactly what that means.
  return { whose: row.whose, measure: row.whose === "not_money" ? "count" : "money" };
}

/**
 * Why the figure column is empty, in Michael's words rather than a code.
 *
 * One constant so the sentence cannot drift between forms, and so a gate can
 * assert the screen says the honest thing rather than merely saying something.
 */
export const NOT_COMPUTED_REASON =
  "No pay runs exist for this period yet, so there is no figure to show. This is not a " +
  "zero — a zero would be a claim that nothing was paid. The box is explained here so the " +
  "form can be learned before the first payroll runs.";

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  FORM 941 — the quarterly federal return
 * ═══════════════════════════════════════════════════════════════════════════ */

export const FORM_941_TEACHING: readonly TeachingBox[] = [
  {
    box: "1",
    caption: "Number of employees who received wages, tips, or other compensation",
    whoseSource: FED_941,
    howItGetsFilled:
      "A headcount of the people on the payroll for the pay period containing the 12th day of " +
      "the last month of the quarter. Not a total of anything, and not the number of people " +
      "who worked during the quarter — one specific day decides it.",
  },
  {
    box: "2",
    caption: "Wages, tips, and other compensation",
    whoseSource: FED_941,
    howItGetsFilled:
      "Every dollar of pay for the quarter, using the same definition as box 1 of the W-2. " +
      "This is why the four quarterly returns must add up to January's W-2s.",
  },
  {
    box: "3",
    caption: "Federal income tax withheld from wages, tips, and other compensation",
    whoseSource: FED_941,
    howItGetsFilled:
      "Added up from the paycheques. It cannot be recomputed from a rate, because how much is " +
      "withheld depends on each person's W-4 — so the payroll record is the only source.",
  },
  {
    box: "5a",
    caption: "Taxable social security wages x 0.124",
    whoseSource: FED_941,
    howItGetsFilled:
      "Wages subject to Social Security, capped at the annual wage base, multiplied by 12.4%. " +
      "That 12.4% is 6.2% withheld from the employee and 6.2% paid by Greenway — one box with " +
      "two owners and an exact half each.",
  },
  {
    box: "5c",
    caption: "Taxable Medicare wages & tips x 0.029",
    whoseSource: FED_941,
    howItGetsFilled:
      "Wages subject to Medicare, multiplied by 2.9%. There is no ceiling on Medicare wages, " +
      "ever — which is the single most common thing people get wrong about this box.",
  },
  {
    box: "5e",
    caption: "Total social security and Medicare taxes",
    whoseSource: FED_941,
    howItGetsFilled:
      "Box 5a plus box 5c. Pure addition and no new information, but worth reading carefully: " +
      "this total contains BOTH halves of FICA, so it is roughly twice what your employees " +
      "actually saw deducted from their pay.",
  },
  {
    box: "6",
    caption: "Total taxes before adjustments",
    whoseSource: FED_941,
    howItGetsFilled:
      "Box 3 plus box 5e — the income tax you held in trust plus both halves of Social Security " +
      "and Medicare. This is the first line on the form that represents everything the IRS " +
      "expects from this quarter.",
  },
  {
    box: "7",
    caption: "Current quarter's adjustment for fractions of cents",
    whoseSource: FED_941,
    howItGetsFilled:
      "The few cents by which what was actually withheld across the quarter's paycheques " +
      "differs from the exact percentage of the quarterly total, because each cheque was " +
      "rounded on its own. The IRS expects this line to be small and non-zero.",
  },
  {
    box: "10",
    caption: "Total taxes after adjustments",
    whoseSource: FED_941,
    howItGetsFilled:
      "Box 6 plus box 7 — the quarter's tax once the fractions-of-cents rounding has been " +
      "accounted for. This is the honest total of what is owed for the quarter.",
  },
  {
    box: "12",
    caption: "Total taxes after adjustments and nonrefundable credits",
    whoseSource: FED_941,
    howItGetsFilled:
      "The figure that must have been deposited. Every other line on the return exists to " +
      "arrive at this one.",
  },
  {
    box: "13",
    caption: "Total deposits for this quarter",
    whoseSource: FED_941,
    howItGetsFilled:
      "What was actually sent to the IRS through EFTPS during the quarter, from the deposit " +
      "record — never recomputed from the tax, or the line could never disagree.",
  },
  {
    box: "14",
    caption: "Balance due",
    whoseSource: FED_941,
    howItGetsFilled:
      "Box 12 minus box 13, when the tax is the larger — what still has to be paid. Left blank " +
      "rather than filled with a zero when nothing is due, because a blank and a zero say " +
      "different things to the IRS.",
  },
  {
    // Relabelled from "15" to "15a" in books-53. The printed 2026 form has
    // 15a Overpayment and 15b the refund-or-apply choice; there is no bare
    // line 15. Michael copies these labels into agency portals, so the label
    // must match the paper.
    box: "15a",
    caption: "Overpayment",
    whoseSource: FED_941,
    howItGetsFilled:
      "Box 13 minus box 12, when the deposits were the larger — money the IRS is holding that " +
      "is yours. You then choose on line 15b whether it is refunded or applied to the next quarter.",
  },
  /*
   * ═══ THE ELEVEN LINES ADDED IN books-53 ═══
   *
   * Captions are transcribed from the PRINTED form Michael files
   * (2ND_QTR_FORM_941.pdf), not from the prose headings in the instructions.
   * The two differ, and the paper is what he is looking at when he reads this
   * screen.
   */
  {
    box: "4",
    caption: "If no wages, tips, and other compensation are subject to social security or Medicare tax",
    whoseSource: FED_941,
    howItGetsFilled:
      "A tickbox, not an amount. Ticked only if NONE of the wages on line 2 are subject to " +
      "Social Security or Medicare tax — which is not the case at Greenway.",
  },
  {
    box: "5b",
    caption: "Taxable social security tips",
    whoseSource: FED_941,
    howItGetsFilled:
      "Tips employees reported for the quarter, sharing line 5a's annual ceiling per person. " +
      "Service charges are not tips and do not belong here.",
  },
  {
    box: "5d",
    caption: "Taxable wages & tips subject to Additional Medicare Tax withholding",
    whoseSource: FED_941,
    howItGetsFilled:
      "Wages above $200,000 for one person, taxed at 0.9% and withheld from the employee only. " +
      "The multiplier is not doubled because there is no employer share.",
  },
  {
    box: "5f",
    caption: "Section 3121(q) Notice and Demand — Tax due on unreported tips",
    whoseSource: FED_941,
    howItGetsFilled:
      "Copied from an IRS Section 3121(q) Notice and Demand when one is received. Never " +
      "computed here, and blank unless such a notice has arrived.",
  },
  {
    box: "8",
    caption: "Current quarter's adjustment for sick pay",
    whoseSource: FED_941,
    howItGetsFilled:
      "A normally NEGATIVE adjustment when a third-party payer of sick pay handled the taxes. " +
      "The sick pay itself still belongs on lines 5a and 5c.",
  },
  {
    box: "9",
    caption: "Current quarter's adjustments for tips and group-term life insurance",
    whoseSource: FED_941,
    howItGetsFilled:
      "A normally NEGATIVE adjustment for the employee share that could not be collected — on " +
      "tips, and on group-term life insurance for former employees.",
  },
  {
    box: "11",
    caption: "Qualified small business payroll tax credit for increasing research activities",
    whoseSource: FED_941,
    howItGetsFilled:
      "Taken from Form 8974, line 12 or line 17. If an amount appears here, Form 8974 must be " +
      "attached to the return.",
  },
  {
    box: "15b",
    caption: "Check one: Apply to next return / Send a refund",
    whoseSource: FED_941,
    howItGetsFilled:
      "A choice, not an amount. If neither box is ticked the IRS will generally apply the " +
      "overpayment to the next return rather than refund it.",
  },
  {
    box: "15c",
    caption: "Routing number",
    whoseSource: FED_941,
    howItGetsFilled:
      "Supplied from the bank, never from the ledger. Nine digits, used only when line 15b asks " +
      "for a refund. No specimen value is shown here because this box holds a real bank " +
      "credential.",
  },
  {
    box: "15d",
    caption: "Type: Checking / Savings",
    whoseSource: FED_941,
    howItGetsFilled:
      "A tickbox describing the account on 15c and 15e. Exactly one, and only when a refund is " +
      "being requested.",
  },
  {
    box: "15e",
    caption: "Account number",
    whoseSource: FED_941,
    howItGetsFilled:
      "Supplied from the bank, never from the ledger. Up to seventeen characters, used only when " +
      "line 15b asks for a refund. No specimen value is shown here because this box holds a real " +
      "bank credential.",
  },
  {
    box: "16",
    caption: "Check one: tax liability for the quarter",
    whoseSource: FED_941,
    howItGetsFilled:
      "The deposit schedule, plus the monthly tax LIABILITY if monthly. Liability follows pay " +
      "dates, not deposit dates, and the three months must total line 12.",
  },
  {
    box: "17",
    caption: "If your business has closed or you stopped paying wages",
    whoseSource: FED_941,
    howItGetsFilled:
      "A tickbox and the final date wages were paid. Ticked only when Greenway has genuinely " +
      "stopped paying wages, never for a quarter that merely had no payroll.",
  },
  {
    box: "18",
    caption: "If you're a seasonal employer and you don't have to file a return for every quarter of the year",
    whoseSource: FED_941,
    howItGetsFilled:
      "A tickbox for employers who hire only seasonally. It must be ticked on EVERY Form 941 " +
      "filed, not once.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  FORM 940 — the annual FUTA return
 * ═══════════════════════════════════════════════════════════════════════════ */

export const FORM_940_TEACHING: readonly TeachingBox[] = [
  /*
   * ═══ PART 1, ADDED IN books-54 ═══
   *
   * The 940 specimen started at line 3, so the whole of Part 1 was missing:
   * the state code, the multi-state tick and the credit-reduction tick. Those
   * three boxes decide whether a Schedule A has to be attached at all, which
   * makes them the first thing to check on the form and the last thing this
   * screen could show.
   *
   * Captions below are transcribed from the printed 2025 Form 940 (the filed
   * copy at /workspace/2025_FORM_940_-_SAGE.pdf), not from the instructions.
   * The two differ in wording, and what Michael is holding is the form.
   */
  {
    box: "1a",
    caption: "If you had to pay state unemployment tax in one state only, enter the state abbreviation",
    whoseSource: FED_940,
    howItGetsFilled:
      "The two-letter postal code of the single state where state unemployment tax was owed. " +
      "For Greenway that is WA. Left blank by a multi-state employer, who ticks 1b instead.",
  },
  {
    box: "1b",
    caption: "If you had to pay state unemployment tax in more than one state, you are a multi-state employer",
    whoseSource: FED_940,
    howItGetsFilled:
      "A tickbox. Ticking it requires Schedule A to be completed and attached. Greenway pays " +
      "only Washington, so this stays empty \u2014 but it would have to be ticked the first year an " +
      "employee worked in another state.",
  },
  {
    box: "2",
    caption: "If you paid wages in a state that is subject to CREDIT REDUCTION",
    whoseSource: FED_940,
    howItGetsFilled:
      "A tickbox, and it also requires Schedule A. Ticked only if a state you paid wages in was " +
      "named a credit reduction state for that year by the Department of Labor. Washington is " +
      "not one today; this is decided annually and must be re-checked, never assumed.",
  },
  {
    box: "3",
    caption: "Total payments to all employees",
    whoseSource: FED_940,
    howItGetsFilled: "Every dollar paid to employees in the year. The starting figure.",
  },
  {
    box: "4",
    caption: "Payments exempt from FUTA tax",
    whoseSource: FED_940,
    howItGetsFilled:
      "Pay that FUTA does not reach — for example certain fringe benefits and group-term life " +
      "insurance. Subtracted from box 3.",
  },
  /*
   * ═══ THE FIVE CATEGORY TICKBOXES UNDER LINE 4 (books-54) ═══
   *
   * The printed form groups these under one instruction, "Check all that
   * apply", so they are five boxes describing ONE amount. The amount is on
   * line 4; these say which kind it was.
   *
   * Their captions on the paper are two or three words each, which is why the
   * `howItGetsFilled` text carries the real content. The IRS gives each
   * category a bulleted list of what qualifies, and those lists are where the
   * traps live — 4c in particular excludes the employee's own elective
   * deferral while including the employer's contribution.
   */
  {
    box: "4a",
    caption: "Fringe benefits",
    whoseSource: FED_940,
    howItGetsFilled:
      "Ticked when part of the line 4 amount was fringe benefits — certain meals and lodging, " +
      "contributions to accident or health plans, or benefits excluded under a section 125 " +
      "cafeteria plan.",
  },
  {
    box: "4b",
    caption: "Group-term life insurance",
    whoseSource: FED_940,
    howItGetsFilled:
      "Ticked when part of the line 4 amount was employer-paid group-term life insurance.",
  },
  {
    box: "4c",
    caption: "Retirement/Pension",
    whoseSource: FED_940,
    howItGetsFilled:
      "Ticked for employer contributions to a qualified plan, including a SIMPLE retirement " +
      "account. Read the exclusion carefully: an employee's own elective salary reduction " +
      "contribution is NOT exempt and stays in the FUTA base.",
  },
  {
    box: "4d",
    caption: "Dependent care",
    whoseSource: FED_940,
    howItGetsFilled:
      "Ticked for dependent care assistance, exempt up to $5,000 per employee and $2,500 if the " +
      "employee is married filing separately. Anything above the cap is ordinary taxable wages.",
  },
  {
    box: "4e",
    caption: "Other",
    whoseSource: FED_940,
    howItGetsFilled:
      "The catch-all category, for things such as agricultural labour payments, H-2A visa " +
      "workers, and payments under a workers' compensation law. Not a place to put anything " +
      "that does not fit: if nothing on the IRS list applies, line 4 is blank and this is empty.",
  },
  {
    box: "5",
    caption: "Total of payments made to each employee in excess of $7,000",
    whoseSource: FED_940,
    howItGetsFilled:
      "FUTA only reaches the first $7,000 paid to each person in the year. Everything above " +
      "that, per person, is totalled here and removed.",
  },
  {
    box: "6",
    caption: "Subtotal",
    whoseSource: FED_940,
    howItGetsFilled: "Box 4 plus box 5 — everything being taken out of the base.",
  },
  {
    box: "7",
    caption: "Total taxable FUTA wages",
    whoseSource: FED_940,
    howItGetsFilled: "Box 3 minus box 6. The wages the tax is actually charged on.",
  },
  {
    box: "8",
    caption: "FUTA tax before adjustments",
    whoseSource: FED_940,
    howItGetsFilled:
      "Box 7 multiplied by 0.6% for an employer entitled to the full state credit. The headline " +
      "rate is 6.0%, and the credit for state unemployment tax paid on time takes most " +
      "employers down to 0.6%.",
  },
  {
    box: "9",
    caption: "If ALL of the taxable FUTA wages were excluded from state unemployment tax",
    whoseSource: FED_940,
    howItGetsFilled:
      "Only used when NO state unemployment tax applied to any of the wages. Rare, and it " +
      "removes the credit entirely.",
  },
  {
    box: "10",
    caption: "If SOME of the taxable FUTA wages were excluded from state unemployment tax",
    whoseSource: FED_940,
    howItGetsFilled:
      "The worksheet line for a partial credit. Needed when some wages were subject to state " +
      "unemployment tax and some were not.",
  },
  {
    box: "11",
    caption: "If credit reduction applies",
    whoseSource: FED_940,
    howItGetsFilled:
      "Extra FUTA owed when a state has borrowed from the federal unemployment account and not " +
      "repaid it. Washington is not currently a credit-reduction state, but this is decided " +
      "each year by the Department of Labor and must be re-checked annually.",
  },
  {
    box: "12",
    caption: "Total FUTA tax after adjustments",
    whoseSource: FED_940,
    howItGetsFilled: "The year's FUTA tax. Every cent of it is Greenway's own cost.",
  },
  {
    box: "13",
    caption: "FUTA tax deposited for the year, including any overpayment applied from a prior year",
    whoseSource: FED_940,
    howItGetsFilled: "What was actually deposited during the year, from the deposit record.",
  },
  {
    box: "14",
    caption: "Balance due",
    whoseSource: FED_940,
    howItGetsFilled: "Box 12 minus box 13, when tax exceeds deposits.",
  },
  {
    box: "15a",
    caption: "Overpayment",
    whoseSource: FED_940,
    howItGetsFilled: "Box 13 minus box 12, when deposits exceeded the tax.",
  },
  /*
   * ═══ THE DIRECT-DEPOSIT BOXES (books-54) ═══
   *
   * Direct deposit of a Form 940 refund is new for the 2025 revision, which is
   * why these four boxes appear on the form Michael filed and were absent from
   * this specimen. On his copy they are printed and empty, because Greenway's
   * line 13 equalled line 12 exactly and there was nothing to refund.
   *
   * 15c and 15e carry NO specimen value on purpose. They are a bank routing
   * number and a bank account number — credentials, not accounting figures.
   * A plausible-looking example in either box is the one kind of teaching aid
   * that could cause real harm, and the no-fabricated-figures gate in this
   * file's test would object to a digit here in any case.
   */
  {
    box: "15b",
    caption: "Check one: Apply to next return. / Send a refund.",
    whoseSource: FED_940,
    howItGetsFilled:
      "A choice, ticked only when line 15a shows an overpayment. Check exactly one box: " +
      "checking both, or neither, means the IRS applies the money to the next return by " +
      "default. Whatever is ticked, the IRS may still take the overpayment against any " +
      "past-due account under the same EIN.",
  },
  {
    box: "15c",
    caption: "Routing number",
    whoseSource: FED_940,
    howItGetsFilled:
      "Nine digits from the bank, used only when 15b asks for a refund. The first two digits " +
      "must fall in 01—12 or 21—32, which is a free validity check before filing. No " +
      "specimen value is shown here because this box holds a real bank credential.",
  },
  {
    box: "15d",
    caption: "Type: Checking / Savings",
    whoseSource: FED_940,
    howItGetsFilled:
      "A tickbox describing the account on 15c and 15e. Exactly one. Getting it wrong can cause " +
      "the deposit to be rejected outright and a paper cheque issued instead.",
  },
  {
    box: "15e",
    caption: "Account number",
    whoseSource: FED_940,
    howItGetsFilled:
      "Up to seventeen characters from the bank, hyphens included but spaces and symbols " +
      "omitted, entered left to right. Used only when line 15b asks for a refund. No specimen " +
      "value is shown here because this box holds a real bank credential.",
  },
  {
    box: "16a",
    caption: "1st quarter (January 1 – March 31)",
    whoseSource: FED_940,
    howItGetsFilled:
      "FUTA liability for the quarter — only required when the year's tax exceeds $500. FUTA " +
      "is filed annually but deposited quarterly once you cross that line.",
  },
  {
    box: "16b",
    caption: "2nd quarter (April 1 – June 30)",
    whoseSource: FED_940,
    howItGetsFilled: "FUTA liability for the second quarter, on the same basis as 16a.",
  },
  {
    box: "16c",
    caption: "3rd quarter (July 1 – September 30)",
    whoseSource: FED_940,
    howItGetsFilled: "FUTA liability for the third quarter, on the same basis as 16a.",
  },
  {
    box: "16d",
    caption: "4th quarter (October 1 – December 31)",
    whoseSource: FED_940,
    howItGetsFilled: "FUTA liability for the fourth quarter, on the same basis as 16a.",
  },
  {
    box: "17",
    caption: "Total tax liability for the year",
    whoseSource: FED_940,
    howItGetsFilled:
      "Boxes 16a to 16d added up. It MUST equal box 12 — that equality is the return's own " +
      "internal check, and a mismatch is the most common reason a 940 comes back.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  FORM W-2 — the annual wage statement
 * ═══════════════════════════════════════════════════════════════════════════ */

export const FORM_W2_TEACHING: readonly TeachingBox[] = [
  /*
   * ═══ THE SIX LETTERED BOXES (books-56) ═══
   *
   * WHERE THESE CAPTIONS COME FROM. Read off `/workspace/2025_FORM_W-2_EMPLOYER.pdf`
   * — Michael's OWN filed 2025 employer copies — with `pdftotext -layout`, so the
   * captions are the words actually printed above the boxes on the paper he holds.
   * They are NOT the headings from the instructions, which are worded differently:
   * the instructions say "Box a—Employee's social security number" while the form
   * prints "a Employee's SSN". The caption field is defined as the form's own
   * words, so the form wins. The instructions supply the RULES, quoted verbatim in
   * the lessons; the paper supplies the LABELS.
   *
   * Two details from that extraction are worth recording because they are the
   * kind of thing a reader would otherwise assume:
   *
   *   1. The paper prints boxes e and f as ONE combined block spanning the name
   *      and address, with "e Employee's first name and initial", "Last name" and
   *      "Suff." on one line and "f Employee's address and ZIP code" beneath. The
   *      instructions likewise give them a single joint heading, "Boxes e and
   *      f—Employee's name and address". They are kept as two boxes here because
   *      the form prints two letters and the ESD wage detail ties to the NAME
   *      specifically, not to the address.
   *
   *   2. Box f's label prints BELOW its own content on the layout, after box e's
   *      address lines. That is a quirk of the printed grid, not an error in the
   *      extraction, and it is why the boxes were read from the labels rather than
   *      from their vertical order.
   *
   * WHY THEY WERE MISSING FOR SEVEN SLICES. Every earlier slice built the
   * specimen outward from the boxes the W-2 ENGINE emits, and the engine computes
   * money. Nothing computes a person's name, so nothing put it on the screen.
   * That is the same shape of defect as books-49's: the form Michael holds has
   * boxes that the system that teaches the form did not know existed.
   */
  {
    // The first box on the paper, and the one that decides whose year this is.
    box: "a",
    caption: "Employee's SSN",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Copied from the employee's social security card — not from a nickname, an old record, or " +
      "memory. If they have no card yet, the instructions say to enter 'Applied For' on paper, " +
      "or zeros if e-filing, and never a made-up number. An ITIN must NOT be used here.",
  },
  {
    box: "b",
    caption: "Employer identification number",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Greenway's own EIN, 46-4217016 on the 2025 forms, and it must be the SAME number used on " +
      "the quarterly 941s. Not truncated, and never a Social Security number in its place.",
  },
  {
    box: "c",
    caption: "Employer's name, address, and ZIP code",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Greenway's name and address, matching the 941s. This is the EMPLOYER's block — the " +
      "employee's address is box f, and confusing the two is easy because they sit adjacent.",
  },
  {
    box: "d",
    caption: "Control number",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Optional. Your own reference for telling individual W-2s apart. The instructions say you " +
      "do not have to use this box, and Greenway leaves it empty. Note that the W-3's control " +
      "number is box a, not box d — the two forms use different letters for the same idea.",
  },
  {
    box: "e",
    caption: "Employee's first name and initial, Last name, Suff.",
    whoseSource: FED_W2,
    howItGetsFilled:
      "The name exactly as it appears on the employee's social security card. The last name " +
      "matters most. Compound names are separated with a hyphen or a space and never joined into " +
      "one word; titles and degrees are left off; a suffix goes in 'Suff.' only if it is on the " +
      "card. This is the box the ESD wage detail must agree with, person by person.",
  },
  {
    box: "f",
    caption: "Employee's address and ZIP code",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Where the employee's own copies are posted. Number, street, and apartment or suite. " +
      "Distinct from box c, which is Greenway's address.",
  },
  {
    box: "1",
    caption: "Wages, tips, other compensation",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Taxable pay for income tax. This is the figure the employee copies onto their own 1040, " +
      "and the four quarterly 941 box 2 figures must add up to the total of everyone's box 1.",
  },
  {
    box: "2",
    caption: "Federal income tax withheld",
    whoseSource: FED_W2,
    howItGetsFilled:
      "What was actually withheld across the year, from the paycheques. Every employee's box 2 " +
      "added together must equal the four 941 box 3 figures.",
  },
  {
    box: "3",
    caption: "Social security wages",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Pay subject to Social Security, capped at the annual wage base. Often DIFFERENT from " +
      "box 1, and a difference is not automatically an error — pre-tax retirement deferrals " +
      "reduce box 1 but not box 3.",
  },
  {
    box: "4",
    caption: "Social security tax withheld",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Box 3 multiplied by 6.2% — the EMPLOYEE half only. Greenway's matching 6.2% is a company " +
      "expense and never appears on a W-2.",
  },
  {
    box: "5",
    caption: "Medicare wages and tips",
    whoseSource: FED_W2,
    howItGetsFilled: "Pay subject to Medicare. No ceiling, so this is usually the largest wage box.",
  },
  {
    box: "6",
    caption: "Medicare tax withheld",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Box 5 multiplied by 1.45%, plus Additional Medicare Tax of 0.9% on pay above the " +
      "threshold. The extra 0.9% is the employee's alone — Greenway does not match it.",
  },
  /*
   * ═══ BOXES 7 THROUGH 15 AND 18 THROUGH 20 (books-52) ═══
   *
   * This specimen stopped at box 6 and resumed at box 16, so the entire middle
   * of the W-2 was unteachable: `teachingBoxes("form_w2")` returned 8 rows for
   * a form with 19 numbered boxes. Michael asked for the missing ones by
   * observation alone - "i think there are line items/ boxes i should be able
   * to click to learn more that are not available yet" - and counting the boxes
   * on his own filed 2025 W-2 confirmed it exactly.
   *
   * The captions below are the captions as the FORM PRINTS THEM, checked
   * against the employee copy in `2025_FORM_W-2_EMPLOYEE.pdf` rather than
   * against the instructions' prose headings, because this string is what a
   * person reads on the page while trying to match it to the paper in hand.
   */
  {
    box: "7",
    caption: "Social security tips",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Tips the employee reported to Greenway. The same tips are ALSO inside box 1 and box 5 — " +
      "this box is not extra pay. Boxes 3 and 7 share one ceiling: their TOTAL is what the " +
      "Social Security wage base caps, not box 3 alone.",
  },
  {
    box: "8",
    caption: "Allocated tips",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Tips assigned to an employee by a large food or beverage establishment. Uniquely on this " +
      "form, the instructions say NOT to include it in boxes 1, 3, 5 or 7. Permanently blank for " +
      "a cannabis retailer.",
  },
  {
    box: "9",
    caption: "(not used)",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Nothing. The box is retired and the entire IRS instruction is \u201cdo not enter an amount in " +
      "box 9\u201d. Any figure here is an error, and there is no correct amount.",
  },
  {
    box: "10",
    caption: "Dependent care benefits",
    whoseSource: FED_W2,
    howItGetsFilled:
      "The TOTAL dependent care assistance provided, including any amount above the $5,000 " +
      "exclusion — not just the taxable excess. The employee's own return works out what part " +
      "is taxable.",
  },
  {
    box: "11",
    caption: "Nonqualified plans",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Distributions from a nonqualified deferred compensation plan, which are also inside box 1. " +
      "It creates no tax; it tells the Social Security Administration that money paid this year " +
      "was earned in an earlier one.",
  },
  {
    box: "12",
    caption: "See instructions for box 12",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Up to four coded entries, each a letter plus an amount. The letter carries the meaning: " +
      "code D is a 401(k) deferral that reduces box 1, code DD is the cost of health coverage " +
      "and is taxable to nobody. The slots 12a to 12d are just slots.",
  },
  {
    box: "13",
    caption: "Statutory employee / Retirement plan / Third-party sick pay",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Three checkboxes, not an amount. Tick Statutory employee for nobody at Greenway — the " +
      "instructions forbid it for common-law employees. The Retirement plan tick can restrict " +
      "the employee's own IRA deduction, so a wrong tick has a real cost.",
  },
  {
    box: "14",
    caption: "Other",
    whoseSource: FED_W2,
    howItGetsFilled:
      "A labelled free-text box. The instructions name \u201chealth insurance premiums deducted\u201d as " +
      "an example, and Washington's Paid Leave and WA Cares belong here. The caption is written " +
      "by the employer, so it is NOT authority for how the amount was treated.",
  },
  {
    box: "15",
    caption: "State / Employer's state ID number",
    whoseSource: FED_W2,
    howItGetsFilled:
      "The two-letter state abbreviation and the ID number the STATE assigned — not the federal " +
      "EIN, which is already in box b. Reads WA for Greenway, with boxes 16 and 17 beside it " +
      "empty.",
  },
  {
    box: "16",
    caption: "State wages, tips, etc.",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Blank for Washington. There is no state personal income tax, so there are no state wages " +
      "to report. This blank is correct and permanent.",
  },
  {
    box: "17",
    caption: "State income tax",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Blank for Washington, for the same reason as box 16. Filling it in would tell the IRS " +
      "your employees paid a tax that does not exist. Paid Family and Medical Leave and WA " +
      "Cares ARE withheld from Washington employees, but they are not income tax — they belong " +
      "in box 14.",
  },
  {
    box: "18",
    caption: "Local wages, tips, etc.",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Blank for Washington. Some states layer a city or county INCOME tax under the state one; " +
      "Washington has neither. Not to be confused with the Port Orchard local SALES tax on " +
      "Greenway's excise return, which taxes sales and never touches a W-2.",
  },
  {
    box: "19",
    caption: "Local income tax",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Blank for Washington. A figure here would mean money was taken from an employee for a tax " +
      "that does not exist. Paid Leave and WA Cares DO come out of pay, but they are not income " +
      "tax and belong in box 14.",
  },
  {
    box: "20",
    caption: "Locality name",
    whoseSource: FED_W2,
    howItGetsFilled:
      "Blank for Washington. This names a taxing locality, not a place of business — Greenway's " +
      "address is already in box c. Boxes 18, 19 and 20 are filled or empty as a set.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §4b  FORM W-3 — the transmittal that goes on top of the W-2s (books-55)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══ WHERE THESE CAPTIONS COME FROM ═══
 *
 * Read off `/workspace/2025_FORM_W-3.pdf` — Michael's OWN filed 2025
 * transmittal, ten W-2s, box 1 of $332,975.44 — extracted with `pdftotext
 * -layout` so the boxes appear in their printed positions. Not from memory, and
 * not with a label regex: the regex approach has now failed on the 940, the 941
 * AND this form, and on this one it failed in the worst way available, reporting
 * "measurement complete, parser hit no problems" while seeing ZERO boxes on all
 * seven registered forms. Rule 39 committed by a measuring tool. Every count in
 * this slice was therefore taken by importing the real modules and asking them.
 *
 * ═══ THE THREE BOXES ALL PRINTED AS "b" ═══
 *
 * The paper prints one lettered box "b" containing THREE separate checkbox
 * groups: Kind of Payer, Kind of Employer, and Third-party sick pay. The
 * instructions give each its own heading — "Box b—Kind of Payer", "Box b—Kind of
 * Employer", "Box b—Third-party sick pay" — so there are three different rules
 * hiding behind one letter.
 *
 * They are given three distinct ids here rather than one. A single "b" box would
 * have to teach three unrelated rules in one lesson, and the reason they are
 * separate is not tidiness: the instructions say to check only ONE Kind of Payer
 * box, only ONE Kind of Employer box, and that Third-party sick pay is
 * explicitly NOT a kind of payer and may be checked as well as one of the
 * others. Collapsing them would make that distinction unteachable.
 *
 * ═══ BOX 9 HAS NO CAPTION ON THE PAPER, AND THAT IS DELIBERATE ═══
 *
 * The layout shows a bare "9" with no label at all, then box 10's label. The
 * instructions explain it: "Box 9. Do not enter an amount in box 9." It is a
 * retired box the SSA has stopped naming. The caption below says exactly that,
 * rather than inventing a label the form does not print.
 *
 * ═══ BOX 12b IS PRINTED AND UNDOCUMENTED ═══
 *
 * The paper prints "12b" under "12a Deferred compensation", with no label. There
 * is NO "Box 12b" heading anywhere in the 4,216 lines of the mirrored General
 * Instructions. Its caption records that, because a caption invented for it
 * would be the one thing on this screen that no authority backs.
 */
export const FORM_W3_TEACHING: readonly TeachingBox[] = [
  {
    box: "a",
    caption: "Control number",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Optional. Your own reference for numbering the whole transmittal, if you number them at " +
      "all. The SSA does not require it and Greenway leaves it empty.",
  },
  {
    box: "b-kind-of-payer",
    caption: "Kind of Payer (Check one)",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Tick the one return you file. Greenway files quarterly 941s, so the 941 box is ticked " +
      "and the other six — Military, 943, 944, CT-1, Hshld. emp., Medicare govt. emp. — are " +
      "left alone. If you had two kinds of W-2, each kind needs its own separate W-3.",
  },
  {
    box: "b-kind-of-employer",
    caption: "Kind of Employer (Check one)",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Tick what sort of organisation you are. Greenway is an ordinary for-profit company, so " +
      "'None apply' is the correct tick — the other four are for tax-exempt bodies and " +
      "government entities. 'None apply' being right is not the same as nothing being ticked.",
  },
  {
    box: "b-third-party-sick-pay",
    caption: "Third-party sick pay (Check if applicable)",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Left unticked unless you are a third-party sick pay payer, or are reporting sick pay a " +
      "third party made. The instructions say this is NOT a kind of payer, which is why it can " +
      "be ticked as well as one of the boxes above rather than instead of one.",
  },
  {
    box: "c",
    caption: "Total number of Forms W-2",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Count the completed W-2s inside this envelope. Do NOT count any marked VOID. A count of " +
      "forms, not of people and not of dollars — Michael's 2025 transmittal says ten.",
  },
  {
    box: "d",
    caption: "Establishment number",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Optional, and only useful if you split one EIN across several sites and want to file a " +
      "separate transmittal for each. Greenway files one, so this stays empty.",
  },
  {
    box: "e",
    caption: "Employer identification number (EIN)",
    whoseSource: FED_W3,
    howItGetsFilled:
      "The nine-digit EIN, formatted 00-0000000, and it must be the SAME number as on the " +
      "941s. Never truncated, and never a Social Security number — if you have applied for an " +
      "EIN but not yet received it, the instructions say to write 'Applied For' here.",
  },
  {
    box: "f",
    caption: "Employer's name",
    whoseSource: FED_W3,
    howItGetsFilled:
      "The same name as on the 941s, character for character. The SSA matches on name and EIN " +
      "together, so a trading name here against a legal name there is enough to break the " +
      "match.",
  },
  {
    box: "g",
    caption: "Employer's address and ZIP code",
    whoseSource: FED_W3,
    howItGetsFilled: "Greenway's address. Plain text, and it must be a real deliverable address.",
  },
  {
    box: "h",
    caption: "Other EIN used this year",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Only filled if you used a DIFFERENT EIN on a 941 this year — most often after buying a " +
      "business and using the previous owner's number for part of the year. Blank for Greenway.",
  },
  {
    box: "1",
    caption: "Wages, tips, other compensation",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Add up box 1 from every W-2 in the envelope, excluding any marked VOID. Nothing is " +
      "computed here that was not already computed on a W-2 — this is arithmetic on the forms " +
      "underneath, which is why it can be checked with a calculator.",
  },
  {
    box: "2",
    caption: "Federal income tax withheld",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Add up box 2 from every W-2. This is one of the four figures the IRS compares against " +
      "your four 941s automatically — it must equal line 3 of the four returns added together.",
  },
  {
    box: "3",
    caption: "Social security wages",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Add up box 3 from every W-2 — each already capped at that year's Social Security wage " +
      "base on its own form. Must equal line 5a column 1 of the four 941s added together.",
  },
  {
    box: "4",
    caption: "Social security tax withheld",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Add up box 4 from every W-2. Only the employees' 6.2% halves — Greenway's matching half " +
      "appears on no W-2, so it appears here nowhere either. Against the 941s this should be " +
      "about HALF what they show, because they carry both halves.",
  },
  {
    box: "5",
    caption: "Medicare wages and tips",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Add up box 5 from every W-2. Uncapped, so this can exceed box 3 once anyone earns above " +
      "the Social Security wage base. Must equal line 5c column 1 of the four 941s.",
  },
  {
    box: "6",
    caption: "Medicare tax withheld",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Add up box 6 from every W-2 — the 1.45% halves, plus any Additional Medicare Tax on pay " +
      "above $200,000. That extra 0.9% has no employer match, which is why the 941 comparison " +
      "is 'approximately twice' rather than exactly twice.",
  },
  {
    box: "7",
    caption: "Social security tips",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Add up box 7 from every W-2. Blank for Greenway, which has no reported tips. It is still " +
      "one of the four boxes the IRS reconciles, so a figure appearing here unexpectedly is " +
      "worth chasing before the SSA does.",
  },
  {
    box: "8",
    caption: "Allocated tips",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Add up box 8 from every W-2. Only large food or beverage establishments ever fill this, " +
      "so it is blank for Greenway.",
  },
  {
    box: "9",
    caption: "(no caption — the form prints only the number 9)",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Nothing. The instructions say 'Do not enter an amount in box 9', and the printed form " +
      "does not even give it a label any more. Leaving it empty is the correct entry, not an " +
      "omission — which is exactly why it is listed here rather than skipped.",
  },
  {
    box: "10",
    caption: "Dependent care benefits",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Add up box 10 from every W-2. Blank for Greenway, which provides no dependent care " +
      "benefit.",
  },
  {
    box: "11",
    caption: "Nonqualified plans",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Add up box 11 from every W-2. Blank for Greenway, which has no nonqualified deferred " +
      "compensation plan.",
  },
  {
    box: "12a",
    caption: "Deferred compensation",
    whoseSource: FED_W3,
    howItGetsFilled:
      "The ONE box on this form that is not a straight total. Add up only the box 12 amounts " +
      "coded D through H, S, Y, AA, BB and EE — the retirement deferrals — and enter no code. " +
      "Everything else in box 12, including code DD for the cost of health coverage, is " +
      "deliberately left out.",
  },
  {
    box: "12b",
    caption: "12b (printed on the form with no label and no instruction)",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Left empty. The form prints a second slot under 12a, but the General Instructions " +
      "contain no 'Box 12b' heading at all — so there is no rule saying what goes here, and " +
      "this system will not invent one. If a payroll bureau ever fills it, ask them which " +
      "instruction they are following.",
  },
  {
    box: "13",
    caption: "For third-party sick pay use only",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Left blank. The instructions say so in those words, and point to Form 8922 for anyone " +
      "who actually needs to report third-party sick pay.",
  },
  {
    box: "14",
    caption: "Income tax withheld by payer of third-party sick pay",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Only filled if a third party withheld federal income tax on sick pay for your " +
      "employees. That money is ALREADY inside the box 2 total; this box shows it separately " +
      "as well. Blank for Greenway.",
  },
  {
    box: "15",
    caption: "State / Employer's state ID number",
    whoseSource: FED_W3,
    howItGetsFilled:
      "The two-letter state code and your state-assigned ID. Greenway is Washington only, so " +
      "'WA'. If the W-2s in one envelope covered more than one state you would put an 'X' here " +
      "instead and leave the ID number off entirely.",
  },
  {
    box: "16",
    caption: "State wages, tips, etc.",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Add up box 16 from every W-2. Blank for Greenway because Washington levies no state " +
      "income tax, so there are no state wages to total.",
  },
  {
    box: "17",
    caption: "State income tax",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Add up box 17 from every W-2. Blank in Washington. Paid Leave and WA Cares ARE withheld " +
      "from Washington employees but are not income tax and belong in box 14 of the W-2.",
  },
  {
    box: "18",
    caption: "Local wages, tips, etc.",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Add up box 18 from every W-2. Blank for Washington, which has no city or county income " +
      "tax. Not to be confused with local SALES tax, which never touches a wage form.",
  },
  {
    box: "19",
    caption: "Local income tax",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Add up box 19 from every W-2. Blank for Washington. A figure here would mean money was " +
      "taken from employees for a tax that does not exist.",
  },
  {
    box: "contact",
    caption: "Employer's contact person, telephone number, fax number, and email address",
    whoseSource: FED_W3,
    howItGetsFilled:
      "Whoever the SSA should ring if something is wrong with the filing. Michael's own name, " +
      "number and email are on the 2025 form. The instructions warn payroll service providers " +
      "to enter the CLIENT's details here — so if a bureau puts their own contact in, a " +
      "problem with Greenway's wage report gets resolved without Greenway ever hearing of it.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  WASHINGTON — ESD, PFML / WA Cares, and L&I
 * ═══════════════════════════════════════════════════════════════════════════ */

export const ESD_5208A_TEACHING: readonly TeachingBox[] = [
  {
    box: "esd-ui",
    caption: "UI tax due",
    whoseSource: wa("employer_cost"),
    howItGetsFilled:
      "Wages up to Washington's annual taxable wage base, multiplied by YOUR experience rate — " +
      "a rate specific to Greenway that ESD sets each year. Unemployment insurance in " +
      "Washington is entirely an employer cost; nothing is withheld from anybody.",
  },
  {
    box: "esd-eaf",
    caption: "EAF tax due",
    whoseSource: wa("employer_cost"),
    howItGetsFilled:
      "A small percentage added on top of the unemployment contribution, funding ESD's " +
      "administration. Also entirely Greenway's cost. The 0.03% is itself two separate " +
      "statutory accounts, 0.02% under RCW 50.24.014(1)(a) and 0.01% under (1)(b).",
  },
  {
    /*
     * ═══ NOT AN ENGINE LINE, AND THAT IS THE POINT (books-64) ═══
     *
     * The 5208A prints THREE wage lines and the engine emits none of them: it
     * emits the two taxes and their total. Gross (13), excess (14) and taxable
     * (16) are wage figures the form derives, and line 14 is the one that bites
     * — it is cumulative across the YEAR, not the quarter.
     *
     * A box with no engine line is legitimate here for the same reason the
     * whole 5208B is: `assertSpecimenMatchesTheEngine` walks the ENGINE's lines
     * and requires each to be taught, not the reverse. A form may teach more
     * than it computes. What it may not do is compute something it cannot
     * explain.
     */
    box: "esd-excess-wages",
    caption: "Excess wages",
    whoseSource: wa("not_money"),
    howItGetsFilled:
      "The part of each person's pay this quarter that sits ABOVE the annual taxable wage " +
      "base, counting from 1 January. Derived on the worksheet by subtracting taxable wages " +
      "from gross wages, so it can never disagree with the figure the tax is charged on.",
  },
  {
    /*
     * ALSO NOT AN ENGINE LINE, AND DELIBERATELY SO.
     *
     * Line 12 asks for a headcount on the payroll period containing the 12th
     * day of each of the three months. The engine does not compute it, and this
     * system does not claim to: it is a fact about who was ON THE PAYROLL on
     * three specific dates, which is not the same question as who was paid
     * during the quarter. Teaching it without computing it is the honest
     * position — Michael's filed Q1 shows 10 / 11 / 9 against 11 employees paid
     * in the quarter, which is precisely why the two cannot be conflated.
     */
    box: "esd-headcount-12th",
    caption: "Number of employees who were paid wages during the payroll period that includes the 12th day of the month",
    whoseSource: wa("not_money", "count"),
    howItGetsFilled:
      "Three separate counts, one per month of the quarter, of people on the payroll for the " +
      "pay period containing the 12th. NOT computed by this system: it is a fact about three " +
      "specific dates rather than about the quarter's wages, and it is not the same number as " +
      "the count of people paid during the quarter.",
  },
  {
    // MISSING FROM THE FIRST DRAFT. The bottom line of the form - the figure
    // Michael actually pays - had no teaching entry at all, which was found by
    // printing the engine's real lines rather than by re-reading this file.
    box: "esd-total",
    caption: "Total due",
    whoseSource: wa("employer_cost"),
    howItGetsFilled:
      "The unemployment contribution plus the EAF assessment. Each is rounded to the cent on " +
      "its own figure BEFORE they are added, because RCW 50.24.010 and RCW 50.24.014(2)(b) " +
      "each command that rounding for their own section — so this total can differ by a cent " +
      "from rounding the combined figure once.",
  },
];

/**
 * ═══ FORM 5208B — THE FORM THAT HAS NO BOXES ═══
 *
 * This form's tab was not merely invisible before payroll exists (that is the
 * bug the rest of this file fixes). It was dropped ALWAYS, including with a
 * complete year of real payroll behind it, and that was proved by building a
 * valid quarter and printing the line count per form:
 *
 *     esd_5208a      lines=3
 *     esd_5208b      lines=0     <-- and the tab loop skips empty forms
 *     pfml_wa_cares  lines=3
 *     lni_quarterly  lines=4
 *
 * The reason is not a defect in the engine. The 5208B genuinely has no boxes:
 * it is one ROW PER PERSON carrying that person's wages and hours, which is why
 * the engine puts it in `wageDetail` rather than in `lines`. The prose renderer
 * on the page already knew this and calls `waWageDetailRows` for it. The
 * teaching renderer never got the same treatment, so the loop that builds the
 * tabs saw zero boxes and returned null.
 *
 * Michael asked for "a visual form for every single form in its own tab", and
 * this was the single form that could never satisfy that. So it is taught as
 * its COLUMNS - the four things each row must carry - which is the honest
 * description of a form made of people. The columns are the fields of the
 * engine's own `WageDetailRow`, so if that shape changes the drift gate fails.
 *
 * Why it matters enough to be worth a tab: the 5208A and the 5208B are two
 * halves of ONE filing. Sending the tax report without the wage detail leaves
 * Employment Security with an incomplete report and its own penalty, even
 * though the money arrived.
 */
export const ESD_5208B_TEACHING: readonly TeachingBox[] = [
  {
    box: "employee",
    caption: "Employee name and Social Security number",
    // A name is not money and nothing is owed because of it.
    whoseSource: wa("not_money", "count"),
    howItGetsFilled:
      "One row for every person paid in the quarter, named exactly as the Social Security " +
      "Administration has them. A name that does not match the number is the single most " +
      "common reason a wage report is rejected, and the wages then credit nobody.",
  },
  {
    box: "wage-detail-wages",
    caption: "Total gross wages paid this quarter",
    whoseSource: wa("tax_base"),
    howItGetsFilled:
      "That one person's gross pay for the quarter. Nobody owes this figure — it is a wage " +
      "amount, not a tax. These rows must ADD UP to the single total wage figure on the 5208A; " +
      "if the two returns disagree, one of them is wrong and ESD will say so.",
  },
  {
    box: "wage-detail-hours",
    caption: "Total hours worked this quarter",
    whoseSource: wa("not_money", "hours"),
    howItGetsFilled:
      "Hours are NOT optional here just because no tax is charged on them on this form. WAC " +
      "192-310-010(3)(b) requires total hours worked for every person, and the same hour count " +
      "drives the L&I premium — so the 5208B and the L&I return have to agree about hours.",
  },
  {
    box: "wage-detail-total",
    caption: "Report total — the sum of every row",
    whoseSource: wa("tax_base"),
    howItGetsFilled:
      "No tax is computed on this form at all; it produces no bill of its own. It exists so " +
      "the state knows whose earnings to credit if that person later claims unemployment. Its " +
      "total is the reconciliation point with the 5208A.",
  },
];

export const PFML_WA_CARES_TEACHING: readonly TeachingBox[] = [
  {
    box: "pfml-employee",
    caption: "Paid Leave premiums withheld from employees",
    whoseSource: wa("employee_money"),
    howItGetsFilled:
      "The employee's portion of the PFML premium, withheld from pay. Washington sets both the " +
      "total premium rate and the split between employer and employee each year.",
  },
  {
    box: "pfml-employer",
    caption: "Employer Medical + Employer Family",
    whoseSource: wa("employer_cost"),
    howItGetsFilled:
      "Greenway's portion of the same premium. Employers with fewer than 50 employees in " +
      "Washington are not required to pay the employer share — which is a real exemption worth " +
      "confirming rather than assuming.",
  },
  {
    box: "wa-cares",
    caption: "Total WA Cares premiums",
    whoseSource: wa("employee_money"),
    howItGetsFilled:
      "Withheld from employees at a flat rate on all wages, with no cap. There is no employer " +
      "share at all — every cent is the employee's money, and Greenway is only the custodian " +
      "of it between payday and the quarterly payment.",
  },
];

export const LNI_QUARTERLY_TEACHING: readonly TeachingBox[] = [
  {
    box: "lni-hours",
    // The engine's own boxLabel, copied exactly, so Michael reading this screen
    // beside the paper return finds the same words on both.
    caption: "Hours reported, risk class",
    // NOT `not_money`, which is what the first draft of this file said. The
    // engine classifies these hours `shared`, and it is right: the hours are
    // the "unit of exposure" of WAC 296-17-31021(1) and they are what the whole
    // premium is charged on - a premium both Greenway and the employee pay a
    // part of. `not_money` would have printed "nothing is owed because of this
    // box" under the one figure the entire return is computed from.
    whoseSource: wa("shared", "hours"),
    howItGetsFilled:
      "Actual hours worked, per risk classification. L&I is the one payroll return charged on " +
      "HOURS rather than on wages, which is why the hours have to be tracked and cannot be " +
      "reconstructed from pay. The same hour count has to appear on the 5208B wage detail.",
  },
  {
    box: "lni-employee",
    caption: "Employee share withheld",
    whoseSource: wa("employee_money"),
    howItGetsFilled:
      "The share of the workers' compensation premium that may lawfully be withheld from " +
      "employees — the medical aid portion only. Withholding more than the law allows is not " +
      "an accounting error.",
  },
  {
    box: "lni-employer",
    caption: "Employer share",
    whoseSource: wa("employer_cost"),
    howItGetsFilled:
      "The rest of the premium — the accident fund and supplemental pension portions — which " +
      "is Greenway's own cost and may never be deducted from anyone's pay. RCW 51.16.140(2) " +
      "makes the attempt a gross misdemeanour, not a fine.",
  },
  {
    // ALSO MISSING FROM THE FIRST DRAFT, and it is the amount on the bill.
    box: "lni-premium",
    caption: "Amount owed",
    whoseSource: wa("shared"),
    howItGetsFilled:
      "Hours multiplied by the COMBINED rate — the employee's share and Greenway's share added " +
      "together — because that is how the L&I notice quotes the rate and how L&I bills it. " +
      "Greenway pays the whole of this figure to L&I and recovers only the employee half " +
      "through withholding.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  THE ADAPTER
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Every form that can be taught with no data, keyed by the SAME formId the
 * lessons use. Held as data (rule 43) so adding a form is one row.
 */
/**
 * How each entity box gets filled, in English, with no numbers substituted.
 *
 * Written per box rather than shared, because "it comes from the company
 * profile" is true of all five and therefore teaches nothing. What Michael
 * needs from each is the trap particular to it: which name goes in which box,
 * why the EIN has no hyphen on the paper, and that the address is where the
 * IRS will post a notice.
 */
const ENTITY_HOW_IT_GETS_FILLED: Readonly<Record<string, string>> = {
  ein:
    "Copied from Company Information. The IRS matches this return to your account on the EIN " +
    "and the name together, so a return missing either cannot post. On the paper it prints as " +
    "two digits, then seven, in separate squares — the hyphen is part of the printed form, not " +
    "something you type, and typing it would push the last digit off the end of the box.",
  name:
    "Copied from Company Information. This is the LEGAL name the EIN was issued to — for " +
    "Greenway that is LYMAN'S MARIJUANA L.L.C., not the name over the door. The IRS builds a " +
    "'name control' from the first four characters and checks it against the EIN, so putting " +
    "the trading name here is one of the most common reasons a return fails to post.",
  tradeName:
    "Copied from Company Information. GREENWAY MARIJUANA — the name customers know. The IRS " +
    "gives it a box of its own precisely so it does not end up in the legal-name box, and " +
    "captions that one 'Name (not your trade name)' to say so.",
  address:
    "Copied from Company Information. The street address of the business. This is where the " +
    "IRS posts a notice about this return, so an out-of-date address here is how a letter " +
    "with a deadline on it goes unanswered.",
  cityStateZip:
    "Copied from Company Information. City, state and ZIP, filled into three separate " +
    "rectangles in that order. They are kept apart rather than run together so that a missing " +
    "city cannot slide the ZIP into the state box.",
};

/**
 * The employer's entity area, as TEACHING boxes.
 *
 * ═══ D-15: THE DEFECT THIS CLOSES, MEASURED ═══
 *
 * Michael, books-65: "i input all my company info into the company info page
 * and have green checks for all of them. but when i view the forms, they do not
 * populate with my company data in them."
 *
 * He was right, and the cause was not the company profile. The sheet pages read
 * it correctly, and `nine41IdentityText` turns it into exactly five entries -
 * `ein`, `name`, `tradeName`, `address`, `cityStateZip`. The facsimile then
 * places that text by looking each entry up BY BOX ID: `identity[r.box.box]`.
 * So a value only reaches the paper if a box with that id is in the box list.
 *
 * `form941Boxes` and `form940Boxes` add those five (books-61, books-63). But
 * those adapters only run when a return has been BUILT. With no 2026 payroll
 * yet, every form page falls back to `teachingBoxes`, and the specimen had no
 * entity boxes at all. Measured, before the fix:
 *
 *     form_941: 27 boxes | entity MISSING=[ein,name,tradeName,address,cityStateZip]
 *     form_940: 30 boxes | entity MISSING=[ein,name,tradeName,address,cityStateZip]
 *     JOIN RESULT in specimen mode: 0 of 5 identity values find a box.
 *
 * So the EIN was read from the database, formatted, split for the comb, handed
 * to the component - and dropped on the floor, silently, because nothing was
 * listening for it. A form whose name boxes are blank reads as a form nobody
 * has started rather than as a form that is broken, which is why this survived
 * three slices of people looking straight at it.
 *
 * WHY THE CAPTIONS ARE NOT RETYPED HERE. They are the same five captions the
 * adapters print, and a second copy would eventually disagree with the first.
 * `ENTITY_BOX_CAPTIONS` is imported from form-box-adapters.ts, which is already
 * a dependency of this module (it supplies every FORM_*_WHOSE table), so this
 * adds no cycle.
 *
 * WHY `FED_941` ON A 940 ROW. Because the entity facts are not per-form facts.
 * Greenway has one EIN, one legal name, one trade name and one address, and the
 * IRS reconciles a year's 940 against the four 941s filed under that same EIN.
 * The adapters made the same choice for the same reason - `employerEntityBoxes`
 * calls `whoseFor(FORM_941_WHOSE, ...)` whichever form it is building.
 */
const ENTITY_TEACHING: readonly TeachingBox[] = ENTITY_BOX_CAPTIONS.map(
  ({ box, caption }): TeachingBox => ({
    box,
    caption,
    whoseSource: FED_941,
    howItGetsFilled: ENTITY_HOW_IT_GETS_FILLED[box],
  }),
);

export const TEACHING_FORMS: Readonly<Record<string, readonly TeachingBox[]>> = {
  form_941: [...ENTITY_TEACHING, ...FORM_941_TEACHING],
  form_940: [...ENTITY_TEACHING, ...FORM_940_TEACHING],
  form_w2: FORM_W2_TEACHING,
  // The transmittal. Registered in books-55. Before that, `form_w3` was already
  // named in ALL_TAUGHT_FORM_IDS and already had a working title, but asking it
  // for its boxes THREW. That combination is worse than a plain absence: three
  // cross-references from the Form 941 confirmation panel pointed at a screen
  // that could not render, and nothing failed, because the only gate that could
  // have noticed was never handed that lesson set. See
  // assertEveryLessonSetWasHandedOver below.
  form_w3: FORM_W3_TEACHING,
  esd_5208a: ESD_5208A_TEACHING,
  // The wage detail. Present here precisely because it emits no engine lines
  // and would otherwise be the one form with no tab (see its own docblock).
  esd_5208b: ESD_5208B_TEACHING,
  pfml_wa_cares: PFML_WA_CARES_TEACHING,
  lni_quarterly: LNI_QUARTERLY_TEACHING,
};

/**
 * The boxes of a form, ready to teach, with every figure marked not computed.
 *
 * Throws on an unknown form id rather than returning an empty array, because
 * an empty array renders as a form with no boxes — which looks exactly like a
 * working screen that happens to have nothing on it. That is the failure mode
 * this whole slice exists to remove, so it must not be reintroduced by the fix
 * (rule 48: throw rather than return a value that reads as success).
 */
export function teachingBoxes(formId: string): readonly FormBox[] {
  const spec = TEACHING_FORMS[formId];
  if (spec === undefined) {
    throw new Error(
      `form-box-teaching-core: no teaching specimen for form "${formId}". Add it to ` +
        `TEACHING_FORMS with every box, its caption as the form prints it, whose money it is, ` +
        `and how it gets filled. There is deliberately no empty-array fallback, because an ` +
        `empty form renders as a working screen with nothing on it.`,
    );
  }
  return spec.map((t): FormBox => {
    /*
     * Both the classification and the unit come from `resolveWhose`, not from
     * this call site. The first draft decided the unit here with
     *
     *     t.whose === "not_money" ? (t.box === "lni-hours" ? "hours" : "count") : "money"
     *
     * which is a hand-written special case naming one box id in a renderer -
     * and it was wrong twice over, because `lni-hours` is not `not_money` at
     * all (the engine says `shared`), so the condition could never fire and the
     * hours box would have been formatted as dollars. A branch that cannot be
     * reached is an untested branch (rule 40), and this one was hiding a
     * misclassification behind an impossible condition.
     */
    const { whose, measure } = resolveWhose(formId, t);
    return {
      formId,
      box: t.box,
      caption: t.caption,
      measure,
      amountCents: 0,
      quantity: null,
      whose,
      derivation: t.howItGetsFilled,
      blankOnPurpose: null,
      notComputedYet: NOT_COMPUTED_REASON,
      emphasise: false,
    };
  });
}

/*
 * ═══ WHY THIS ADAPTER LIVES HERE AND NOT IN form-box-adapters.ts ═══
 *
 * Every other `*Boxes` adapter is in `form-box-adapters.ts`, so that is where
 * this one was written first. It could not stay there.
 *
 * `w3Boxes` must start from the teaching specimen (see its docblock for why),
 * which means calling `teachingBoxes` — and `form-box-teaching-core` already
 * imports `FORM_W3_WHOSE` FROM `form-box-adapters` at module scope, to build
 * TEACHING_FORMS. Importing back the other way closes the cycle, and this is
 * not the harmless kind: TEACHING_FORMS is constructed during module
 * initialisation, so whichever module happened to load second would see
 * `undefined` for the other's exports. That failure appears as a null-property
 * crash at import time, in a file that looks unrelated, and it depends on load
 * order rather than on anything visible in the code.
 *
 * So the function goes on the side of the dependency that already holds both
 * halves. Rule 25 — extend, never duplicate: the WHOSE tables are not copied
 * here, they are reached through `teachingBoxes`, which already resolves them.
 */
/**
 * ═══ THE W-3'S BOXES, WITH THE COMPUTED FIGURES OVERLAID (books-55) ═══
 *
 * The W-3 screen had a table but no explorer, so the thirty-one W-3 lessons
 * were unreachable: written, tested, and invisible. This is the adapter that
 * connects them.
 *
 * ─── WHY IT STARTS FROM THE SPECIMEN AND NOT FROM THE FORM ───────────────
 *
 * `w2Boxes` maps over a W2Form's own `boxes` array, because a W-2 knows all
 * twenty of its boxes. A `W3Form` does NOT: it carries the nine figures the
 * engine totals (boxes 1-6, 12a, 16, 17) and nothing else. There is no field on
 * it for box a, for the kind-of-payer checkboxes, for box e's EIN, or for the
 * contact block.
 *
 * Mapping over what the W3Form carries would therefore have produced an
 * explorer with nine boxes and silently orphaned twenty-two lessons. That is
 * the precise defect this system keeps finding: a renderer that shows a subset
 * looks completely healthy, because nothing anywhere states what the full set
 * is (rule 39).
 *
 * So the SPECIMEN is the spine — it is the one place that lists all thirty-one
 * boxes with their captions in the form's own words — and the computed figures
 * are overlaid onto it where they exist. Every box therefore renders, every
 * lesson is reachable, and a box the engine cannot yet fill keeps saying "not
 * computed yet" instead of showing a zero.
 *
 * ─── WHY A ZERO WOULD BE A LIE, SPECIFICALLY ─────────────────────────────
 *
 * `notComputedYet` is cleared ONLY for boxes this function actually overlays. A
 * $0.00 in box 4 would state that Greenway withheld no social security tax all
 * year, which is a factual claim about a tax filing, not a blank. The
 * distinction is the whole reason `notComputedYet` exists.
 *
 * Box 12a is overlaid but deliberately keeps the loudest derivation on the
 * screen, because it is the one box on this form that is NOT a plain total —
 * only the deferral codes carry up, and summing all of box 12 into it is the
 * easiest W-3 error a generator can make.
 */
export function w3Boxes(w3: W3Form): readonly FormBox[] {
  /*
   * Money boxes the engine really computes, in cents. Anything absent from
   * this map keeps the specimen's "not computed yet", which is the honest
   * answer for a box nothing populates.
   *
   * Rule 62d: no defaults invented here. A box missing from this map is a box
   * we cannot fill, and it must SAY so rather than resolve to zero.
   */
  const computed = new Map<string, number>([
    ["1", w3.box1Cents],
    ["2", w3.box2Cents],
    ["3", w3.box3Cents],
    ["4", w3.box4Cents],
    ["5", w3.box5Cents],
    ["6", w3.box6Cents],
    ["12a", w3.box12aCents],
    ["16", w3.box16Cents],
    ["17", w3.box17Cents],
  ]);

  return teachingBoxes(FORM_ID_W3).map((b): FormBox => {
    /*
     * Box c is the form count, and it is a COUNT, not money. It is overlaid
     * through `quantity` rather than `amountCents` so the formatter cannot
     * render ten W-2s as "$0.10" — a wrong answer that looks like a
     * formatting nit and therefore survives review.
     */
    if (b.box === "c") {
      return {
        ...b,
        quantity: w3.formCount,
        notComputedYet: null,
        derivation:
          `${b.derivation} — counted from the W-2s this run produced: ${w3.formCount} ` +
          `included` +
          (w3.voidedCount > 0
            ? `, and ${w3.voidedCount} marked VOID and therefore excluded, which is what the ` +
              `instructions require`
            : ``),
      };
    }

    const cents = computed.get(b.box);
    if (cents === undefined) return b;

    /*
     * Boxes 16 and 17 are the Washington case, and they are handled like the
     * W-2's: blank BECAUSE Washington has no state income tax, and said so
     * out loud. The condition is on the VALUE, not on the state, so a
     * Washington employer with an employee working in Oregon still shows the
     * figure instead of a hard-coded blank.
     */
    const isWaStateBox = (b.box === "16" || b.box === "17") && cents === 0;

    return {
      ...b,
      amountCents: cents,
      notComputedYet: null,
      emphasise: b.box === "1",
      blankOnPurpose: isWaStateBox
        ? "Blank because Washington has no state income tax, so there is nothing for the " +
          "transmittal to total. This is correct and permanent, not a missing figure. Paid " +
          "Family and Medical Leave and WA Cares ARE withheld from Washington employees, but " +
          "they are not income tax and do not belong here."
        : null,
      derivation:
        b.box === "12a"
          ? `${b.derivation} — FILTERED, not a plain total: only the deferral codes carry up. ` +
            `Codes DD and C are excluded on purpose, and a naive sum of every box 12 would ` +
            `have overstated this by ` +
            `${(w3.box12ExcludedFromW3Cents / 100).toFixed(2)} dollars.`
          : b.derivation,
    };
  });
}


/* ═══════════════════════════════════════════════════════════════════════════
 * §7  SELF-TESTS (rule 5)
 * ═══════════════════════════════════════════════════════════════════════════ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`form-box-teaching-core self-test failed: ${msg}`);
}

/**
 * THE DRIFT GUARD.
 *
 * Every box that has a LESSON must exist in the teaching specimen, or the
 * lesson becomes unreachable on a screen with no data — which is the exact
 * class of bug this module was written to fix, reappearing one box at a time.
 */
export function assertEveryTaughtBoxHasASpecimen(lessons: readonly BoxLesson[]): void {
  for (const l of lessons) {
    const spec = TEACHING_FORMS[l.formId];
    assert(
      spec !== undefined,
      `lesson for ${l.formId} box ${l.box} has no teaching specimen for its form`,
    );
    assert(
      spec.some((t) => t.box === l.box),
      `${l.formId} box ${l.box} has a lesson but is not in the teaching specimen, so the ` +
        `lesson cannot be reached before payroll exists`,
    );
  }
}

/**
 * THE DEAD CROSS-REFERENCE GUARD (books-54).
 *
 * ═══ WHAT THIS FOUND, AND WHY IT HAD TO BE A GATE RATHER THAN A FIX ═══
 *
 * Every lesson carries `tiesTo` — "this box relates to that box on that other
 * form" — and NOTHING in the repository checked that the other box existed.
 * Standing rule 39 in its plainest form: a verifier that cannot see something
 * approves it.
 *
 * Measured before anything was written: 56 ties across the four lesson sets,
 * of which TWO were dead. Both in `form-box-lessons-wa.ts`, both pointing at
 * `esd_5208b` box "wage-detail", which has never existed. The 5208B specimen
 * carries `wage-detail-wages`, `wage-detail-hours` and `wage-detail-total`.
 * The ties predate this slice (they arrived with books-47 slice D) and were
 * green for every commit since, because a tie is rendered prose and prose does
 * not execute.
 *
 * That is a real defect and not a cosmetic one. The tie tells Michael to go
 * and compare a figure against a box that is not on the screen he is sent to.
 *
 * Fixing only those two would have been fixing the instance (rule 23). The
 * class is "a lesson may point anywhere", and this closes it: a tie must name
 * a form in TEACHING_FORMS and a box that form actually has.
 *
 * WHY IT TAKES THE LESSONS AS A PARAMETER. Same reason
 * `assertEveryTaughtBoxHasASpecimen` does: this module must not import the
 * lesson modules, or the teaching specimen — the thing that is supposed to be
 * checkable on its own — would depend on the material it checks.
 */
export function assertEveryTieResolves(
  lessons: readonly BoxLesson[],
  /**
   * Box ids of forms whose specimen is GENERATED, keyed by formId.
   *
   * Without this, a tie between two boxes of the SAME generated form - the
   * month totals of Schedule B point at its quarter total - reads as a tie to
   * a form with no specimen, which is the one thing this gate exists to catch.
   */
  generatedForms: Readonly<Record<string, readonly string[]>> = {},
): void {
  let checked = 0;
  for (const l of lessons) {
    for (const t of l.tiesTo) {
      const generated = generatedForms[t.formId];
      if (generated !== undefined) {
        assert(
          generated.includes(t.box),
          `${l.formId} box ${l.box} ties to ${t.formId} box ${t.box}, which that form's ` +
            `generated specimen does not render. Its boxes are: ${generated.join(", ")}`,
        );
        checked += 1;
        continue;
      }
      const spec = TEACHING_FORMS[t.formId];
      assert(
        spec !== undefined,
        `${l.formId} box ${l.box} ties to form ${t.formId}, which has no teaching specimen, ` +
          `so the cross-reference sends Michael to a screen that cannot exist`,
      );
      assert(
        spec.some((b) => b.box === t.box),
        `${l.formId} box ${l.box} ties to ${t.formId} box ${t.box}, which that form does not ` +
          `have. Its boxes are: ${spec.map((b) => b.box).join(", ")}`,
      );
      checked += 1;
    }
  }
  /*
   * Rule 66d: assert existence before absence. A loop over lessons that all
   * happen to carry an empty `tiesTo` array passes without checking anything,
   * and would keep passing if every tie in the repository were deleted. So the
   * function refuses to report success on a set it never actually examined.
   */
  assert(
    checked > 0,
    `no ties were checked across ${lessons.length} lessons, so this proves nothing`,
  );
}

/**
 * ═══ THE GATE THAT WATCHES THE GATES (books-55) ═══
 *
 * `assertEveryTieResolves` and `assertEveryTaughtBoxHasASpecimen` were both
 * correct at books-54. They still found nothing wrong with three dead
 * cross-references, because the test that called them listed FOUR lesson sets
 * by hand and the repository contained FIVE. The fifth,
 * `FORM_941_CONFIRMATION_LESSONS`, held three ties into `form_w3` — a form that
 * threw when asked for its boxes. Nobody was lying and nothing was broken; the
 * verifier was simply never shown a fifth of the material, so it approved it.
 *
 * That is the same failure the books-54 gate was written to prevent, committed
 * by the slice that wrote it. Fixing the one test would leave a sixth set free
 * to repeat it, so the class is closed here instead of the instance.
 *
 * The mechanism is to make the caller state a NUMBER. A number cannot be
 * satisfied by adding a file: whoever adds a sixth lesson module must either
 * hand it over or edit this count and explain why, in the diff, where a reader
 * will see it. The companion gate in the test file goes further and reads the
 * count out of the repository's own source, so the number itself cannot rot.
 *
 * `sets` is named rather than anonymous so a failure says which file to open.
 * Both per-set gates are run here as well, so a caller cannot hand over the
 * full list and then forget to check half of it.
 */
/**
 * Whether a lesson set teaches boxes that exist on PAPER.
 *
 * This distinction was forced by the fifth set and is worth recording, because
 * the obvious version of this gate is wrong in a dangerous direction.
 *
 * `FORM_941_CONFIRMATION_LESSONS` uses formId "filed_941" and boxes "why",
 * "doubling", "5d" and "source". Those are not lines of a return. They are the
 * four questions the confirmation SCREEN raises, and the module says so
 * explicitly: the id is deliberately not "form_941" so these lessons cannot
 * shadow the real line lessons. There is no printed W-3-style specimen for them
 * because there is no printed page.
 *
 * So `assertEveryTaughtBoxHasASpecimen` cannot apply to it — and when the gate
 * was first pointed at all five sets, it threw. The tempting fixes were both
 * bad: silently skip the set (which is how it came to be missed in the first
 * place), or invent a specimen table for a screen, which would put four
 * fabricated "captions" into a system whose whole claim is that every caption
 * is the form's own words (rule 62d).
 *
 * The honest fix is to make the set STATE which kind it is, and then to check
 * the statement. A set that claims "screen-only" while its formId is in fact a
 * printed form registered in TEACHING_FORMS is a stale exemption, and a stale
 * exemption is a standing licence for a real gap to pass unnoticed. So that
 * claim is verified in both directions below.
 */
export type LessonSetKind = "printed-form" | "screen-only";

/**
 * The smallest number of lesson sets this repository has ever had since the
 * gate below was written. A BACKSTOP, not the expected count.
 *
 * The expected count is supplied by the caller, which reads it off the source
 * tree, so this number does not need to track growth. It exists only so that a
 * caller which hard-codes `assertEveryLessonSetWasHandedOver(sets, 1)` cannot
 * switch the gate off. Raising it is fine; LOWERING it means a lesson module
 * was deleted, and that must be a deliberate, commented act.
 *
 * MEASURED at books-62: 940, 941, W-2, W-3, WA, 941-confirmation,
 * 941-schedule-B = 7.
 */
export const MIN_LESSON_SETS = 7;

/**
 * How many lesson sets may be exempt from the printed-specimen check.
 *
 * books-55 wrote the companion floor as `printed >= 4`, naming the four
 * printed sets of the day in the failure message. That number goes stale in the
 * same direction as the one above: with six sets, `printed >= 4` would accept
 * TWO unexplained screen-only exemptions, and a mislabelled set is exactly how
 * a real form stops being checked against its own paper.
 *
 * Expressing it as a cap on exemptions instead of a floor on printed sets makes
 * it self-adjusting: every set added must be printed-form, or must argue for a
 * raise to this constant in its own commit. Today exactly one set is exempt —
 * `FORM_941_CONFIRMATION_LESSONS`, which teaches a screen and has no paper.
 */
export const MAX_SCREEN_ONLY_LESSON_SETS = 1;

export type NamedLessonSet = {
  readonly name: string;
  readonly lessons: readonly BoxLesson[];
  readonly kind: LessonSetKind;
  /**
   * Box ids of a specimen that is GENERATED rather than typed as a table.
   *
   * Schedule B is printed paper, so it is not `screen-only`; but its specimen
   * is 93 calendar cells plus four totals plus three header boxes, produced by
   * `scheduleBTeachingBoxes`. Typing 100 `TeachingBox` rows whose captions are
   * "4" through "31" would add no information and could drift from the grid.
   * The trap this closes: a set supplying its own box list could name a
   * convenient subset, so the check below runs in BOTH directions.
   */
  readonly generatedSpecimenBoxes?: readonly string[];
};

/**
 * Every lesson matches a box the generated specimen really renders, and every
 * rendered box has a lesson. Bidirectional because a set that supplies its own
 * box list would otherwise be free to hand over only the boxes it has covered.
 */
export function assertGeneratedSpecimenCoversItsLessons(
  name: string,
  lessons: readonly BoxLesson[],
  specimenBoxes: readonly string[],
): void {
  assert(
    specimenBoxes.length > 0,
    `lesson set "${name}" declares a generated specimen but handed over no boxes, so the ` +
      `specimen check would pass having compared nothing`,
  );
  const inSpecimen = new Set(specimenBoxes);
  assert(
    inSpecimen.size === specimenBoxes.length,
    `lesson set "${name}" generated a specimen with duplicate box ids, which lets a missing ` +
      `box hide behind a repeated one`,
  );
  const taught = new Set<string>();
  for (const l of lessons) {
    assert(
      inSpecimen.has(l.box),
      `lesson set "${name}" teaches box ${l.box}, which its generated specimen does not ` +
        `render, so the lesson cannot be reached before payroll exists`,
    );
    assert(!taught.has(l.box), `lesson set "${name}" teaches box ${l.box} twice`);
    taught.add(l.box);
  }
  for (const box of specimenBoxes) {
    assert(
      taught.has(box),
      `lesson set "${name}" renders box ${box} with no lesson behind it, so clicking it ` +
        `opens an empty overlay`,
    );
  }
}

export function assertEveryLessonSetWasHandedOver(
  sets: readonly NamedLessonSet[],
  expectedSetCount: number,
): void {
  /*
   * Rule 66d: assert existence before absence. Called with an empty array and
   * an expected count of zero, every loop below is a no-op and the function
   * would certify that the repository's cross-references are sound while having
   * read none of them. So a floor comes first.
   *
   * books-55 wrote this floor as the literal `5`, being the number of sets that
   * existed that day. books-56 added the W-3 set and the floor was instantly
   * one short of the truth — it would have accepted a list of five when six
   * exist, which is the precise defect the whole function was written to stop.
   * A floor that must be hand-edited every time the thing it measures grows is
   * a floor that is wrong between edits (rule 23: fix the class).
   *
   * So the floor is now the count the CALLER derived from the source tree, and
   * the caller's job is to derive it rather than type it. `MIN_LESSON_SETS` is
   * only a backstop against a caller that hard-codes something tiny; it is
   * deliberately the count at the slice that introduced this comment, and if it
   * ever needs raising the source-tree gate in
   * `form-box-teaching-core.test.ts` will have failed first and by name.
   */
  assert(
    expectedSetCount >= MIN_LESSON_SETS,
    `this repository has had at least ${MIN_LESSON_SETS} lesson sets since books-56, so an ` +
      `expected count of ${expectedSetCount} means either a set was deleted — say so ` +
      `deliberately, and lower ${MIN_LESSON_SETS} in the same commit — or this call is not ` +
      `checking what it claims to check`,
  );
  assert(
    sets.length === expectedSetCount,
    `handed ${sets.length} lesson sets but ${expectedSetCount} were expected. If a lesson ` +
      `module was added, hand it over here too: the books-54 dead-tie gate was correct and ` +
      `still missed three dead ties, purely because one of five sets was never passed to it. ` +
      `Sets handed over: ${sets.map((s) => s.name).join(", ")}`,
  );

  /*
   * Collected across ALL sets before any is checked, so a tie from one form
   * into another form's generated specimen resolves regardless of table order.
   */
  const generatedForms: Record<string, readonly string[]> = {};
  for (const s of sets) {
    if (s.generatedSpecimenBoxes === undefined) continue;
    for (const l of s.lessons) generatedForms[l.formId] = s.generatedSpecimenBoxes;
  }

  const seenNames = new Set<string>();
  for (const s of sets) {
    assert(
      !seenNames.has(s.name),
      `lesson set "${s.name}" was handed over twice, which inflates the count and lets a ` +
        `genuinely missing set hide behind a duplicate`,
    );
    seenNames.add(s.name);
    /*
     * An empty set satisfies both gates below vacuously. If a module is
     * gutted, that must fail here rather than read as a clean pass.
     */
    assert(
      s.lessons.length > 0,
      `lesson set "${s.name}" is empty, so checking it proves nothing about it`,
    );

    /*
     * Ties are checked for EVERY set regardless of kind. A screen-only panel
     * still points Michael at boxes on real forms, and those three ties into
     * `form_w3` are exactly the ones that were dead from books-48 to books-55.
     */
    assertEveryTieResolves(s.lessons, generatedForms);

    if (s.kind === "printed-form") {
      /*
       * A generated specimen is checked against the boxes it really renders,
       * not against TEACHING_FORMS. It is still PRINTED paper, so it earns no
       * exemption from the cap below - see `generatedSpecimenBoxes`.
       */
      if (s.generatedSpecimenBoxes !== undefined) {
        assertGeneratedSpecimenCoversItsLessons(s.name, s.lessons, s.generatedSpecimenBoxes);
      } else {
        assertEveryTaughtBoxHasASpecimen(s.lessons);
      }
    } else {
      assert(
        s.generatedSpecimenBoxes === undefined,
        `lesson set "${s.name}" is screen-only yet supplies generated specimen boxes; a screen ` +
          `has no paper, so one of the two claims is wrong`,
      );
      /*
       * The exemption is verified, not taken on trust, in both directions.
       *
       * Forward: a set calling itself screen-only must genuinely have no
       * registered specimen. The day somebody registers `filed_941` in
       * TEACHING_FORMS, this exemption becomes a hole and must be deleted, so
       * the build says so instead of quietly skipping a set that could now be
       * checked properly.
       */
      for (const l of s.lessons) {
        assert(
          TEACHING_FORMS[l.formId] === undefined,
          `lesson set "${s.name}" is declared screen-only, but form "${l.formId}" now HAS a ` +
            `teaching specimen. The exemption is stale: change its kind to "printed-form" so ` +
            `its boxes are checked against the specimen instead of skipped`,
        );
      }
      /*
       * Backward: a screen-only set must still be internally coherent. Without
       * this, "screen-only" would mean "unchecked", which is a worse hole than
       * the one this whole function exists to close. Every lesson must carry
       * the teaching fields the panel actually renders, so a gutted lesson
       * cannot hide behind the exemption.
       */
      for (const l of s.lessons) {
        assert(
          l.headline.length > 0 && l.plainEnglish.length > 0 && l.whatToDo.length > 0,
          `lesson set "${s.name}" box ${l.box} is screen-only and therefore exempt from the ` +
            `specimen check, so it must at least be a complete lesson; this one has an empty ` +
            `headline, plain-English body or next step`,
        );
      }
    }
  }

  /*
   * Rule 66d again, one level up: the loop above would be satisfied by every
   * set calling itself screen-only, in which case the specimen gate ran zero
   * times and this function's most important check did nothing.
   *
   * Stated as a CAP ON EXEMPTIONS rather than a floor on printed sets, so it
   * tightens automatically as sets are added instead of loosening. See
   * MAX_SCREEN_ONLY_LESSON_SETS.
   */
  const screenOnly = sets.filter((s) => s.kind === "screen-only");
  assert(
    screenOnly.length <= MAX_SCREEN_ONLY_LESSON_SETS,
    `${screenOnly.length} of ${sets.length} lesson sets claim to be screen-only ` +
      `(${screenOnly.map((s) => s.name).join(", ")}), but at most ` +
      `${MAX_SCREEN_ONLY_LESSON_SETS} may be. A screen-only set is NOT checked against the ` +
      `form's printed captions, so mislabelling one is how a real form silently stops being ` +
      `verified. If a genuinely new screen panel has been added, raise ` +
      `MAX_SCREEN_ONLY_LESSON_SETS in the same commit and say why`,
  );
  /*
   * And the positive form of the same statement, because a cap alone is
   * satisfied by a list of zero sets, which the length check above already
   * refuses but only as long as it stays above the cap.
   */
  const printed = sets.length - screenOnly.length;
  assert(
    printed >= MIN_LESSON_SETS - MAX_SCREEN_ONLY_LESSON_SETS,
    `only ${printed} of ${sets.length} lesson sets were checked against a printed specimen, ` +
      `and at least ${MIN_LESSON_SETS - MAX_SCREEN_ONLY_LESSON_SETS} teach real forms ` +
      `(940, 941, W-2, W-3, WA), so a lower number means a set was mislabelled screen-only ` +
      `and its boxes are no longer being checked`,
  );
}

/** No specimen box may claim a figure. The whole point is that none is known. */
export function assertNoSpecimenClaimsAFigure(): void {
  for (const formId of Object.keys(TEACHING_FORMS)) {
    for (const b of teachingBoxes(formId)) {
      assert(
        b.notComputedYet !== null,
        `${formId} box ${b.box} does not say its figure is uncomputed`,
      );
      assert(b.amountCents === 0, `${formId} box ${b.box} carries an invented amount`);
      assert(b.quantity === null, `${formId} box ${b.box} carries an invented quantity`);
    }
  }
}

/**
 * D-15's gate: every identity value a page computes must have a box to land in.
 *
 * WHAT IT ACTUALLY MEASURES, and why it is not a restatement of the fix.
 *
 * It does not read a list of box ids and compare it with the same list written
 * twice. It CALLS the real identity builders with a filled-in employer, takes
 * the keys they genuinely emit, and asserts each one is a box in the specimen
 * the form would render with no payroll on file. That is the exact join the
 * facsimile performs at `identity[r.box.box]`, so the gate fails in precisely
 * the circumstance the owner reported and in no other (rule 39: a gate must not
 * measure its own opinion).
 *
 * The employer passed in is fully populated ON PURPOSE. `nine41IdentityText`
 * omits an absent field, so an empty employer emits zero keys and the loop
 * below would pass by having nothing to check - a gate that cannot fail. Every
 * field is present so every key is emitted.
 */
export function assertEveryIdentityValueHasABox(): void {
  const employer = {
    ein: "464217016",
    legalName: "LYMAN'S MARIJUANA L.L.C.",
    street: "4851 GEIGER RD SE",
    city: "PORT ORCHARD",
    state: "WA",
    zip: "98366",
  };

  /*
   * Each row is a REAL page: the form id it renders with no data, and the
   * identity builder that page calls. Both halves are taken from the page's own
   * source, so a new form cannot be added to one without the other.
   */
  const pages: readonly {
    readonly formId: string;
    readonly keys: readonly string[];
    readonly label: string;
  }[] = [
    {
      formId: "form_941",
      keys: Object.keys(nine41IdentityText(employer, "GREENWAY MARIJUANA")),
      label: "Form 941",
    },
    {
      formId: "form_940",
      keys: Object.keys(nine40IdentityText(employer, "GREENWAY MARIJUANA")),
      label: "Form 940",
    },
    { formId: "form_w3", keys: Object.keys(w3IdentityText(employer)), label: "Form W-3" },
  ];

  for (const page of pages) {
    // Rule 66d / 87: prove the builder produced something before proving each
    // one lands. An identity builder that silently returned {} would otherwise
    // satisfy every assertion below by vacuity.
    assert(
      page.keys.length >= 3,
      `${page.label}: its identity builder emitted only ${page.keys.length} values, so the ` +
        `check below has almost nothing to verify. Expected the entity area to produce at ` +
        `least the number, the name and the address.`,
    );

    const specimen = new Set(teachingBoxes(page.formId).map((b) => b.box));
    for (const key of page.keys) {
      assert(
        specimen.has(key),
        `D-15 has come back on ${page.label}. Its page reads the company profile and builds an ` +
          `identity value for "${key}", but the teaching specimen for "${page.formId}" has no ` +
          `box with that id - and the facsimile places identity text by looking it up on the ` +
          `box id. So that value is computed, formatted, handed to the component and then ` +
          `dropped, and the form prints with an empty box that looks merely unstarted. This is ` +
          `the exact bug Michael reported in books-65: "i input all my company info into the ` +
          `company info page and have green checks for all of them. but when i view the forms, ` +
          `they do not populate with my company data in them."`,
      );
    }
  }
}

/** Captions must be the form's words, and every box must explain itself. */
export function assertEverySpecimenBoxTeaches(): void {
  for (const [formId, spec] of Object.entries(TEACHING_FORMS)) {
    assert(spec.length > 0, `${formId} has no boxes`);
    const seen = new Set<string>();
    for (const t of spec) {
      assert(!seen.has(t.box), `${formId} lists box ${t.box} twice`);
      seen.add(t.box);
      assert(t.caption.trim().length > 3, `${formId} box ${t.box} has no caption`);
      assert(
        t.howItGetsFilled.trim().length > 40,
        `${formId} box ${t.box} does not explain how it gets filled`,
      );
      /*
       * NO FABRICATED GREENWAY FIGURE MAY APPEAR — but a STATUTORY figure may.
       *
       * The first version of this check banned every "$" and immediately
       * failed on Form 940 box 5, whose explanation names the $7,000 FUTA
       * wage base. That is not a fabricated number: it is the threshold
       * Congress set, printed on the form itself, and removing it would make
       * the explanation worse in order to satisfy a gate.
       *
       * The real risk is a figure that looks like GREENWAY'S money — an amount
       * with cents, of the shape a computed return produces ("$1,240.00").
       * A round statutory threshold is a fact about the law; a figure with
       * cents is a claim about this company. So the ban is on the latter.
       *
       * This is the same lesson as standing rule 89: the first draft of a
       * scan is usually banning the wrong thing, and the fix is to make the
       * scan describe the actual hazard rather than to weaken it.
       */
      assert(
        !/\$[\d,]+\.\d{2}/.test(t.howItGetsFilled),
        `${formId} box ${t.box} puts a computed-looking currency amount in the explanation`,
      );
    }
  }
}

/** An unknown form must throw, not hand back an empty form. */
export function assertUnknownFormThrows(): void {
  let threw = false;
  try {
    teachingBoxes("form_does_not_exist");
  } catch {
    threw = true;
  }
  assert(threw, "an unknown form id returned instead of throwing");
}

/**
 * ═══ THE DRIFT GATE — the one that would have caught this slice's own bug ═══
 *
 * Every other self-test in this file reads only this file. That is precisely
 * how the specimen came to disagree with the engine while every test stayed
 * green: a file checked against itself agrees with itself.
 *
 * So this one BUILDS A REAL WASHINGTON QUARTER and compares, box for box:
 *
 *   - every line the engine emits must have a teaching entry, or a real box
 *     Michael can see figures for is a box he cannot be taught;
 *   - the caption must be the engine's own `boxLabel`, so the teaching tab and
 *     the figures table name the same line the same way;
 *   - `whose` must match the engine's `whoseMoney` — the drift that actually
 *     happened, and the one with criminal consequences when it is wrong;
 *   - `measure` must match, so hours are never formatted as dollars.
 *
 * The quarter is built with obviously synthetic inputs and its FIGURES ARE
 * NEVER READ. Only the shape and the classification are compared, so nothing
 * fabricated can leak onto a screen.
 */
export function assertSpecimenMatchesTheEngine(): void {
  const req: WaQuarterRequest = {
    quarter: { year: 2026, quarter: 2 },
    subjects: [
      {
        subjectId: "drift-gate",
        displayName: "Drift Gate",
        wagesCents: 1_000_000,
        esdTaxableWagesCents: 1_000_000,
        pfmlTaxableWagesCents: 1_000_000,
        hours: 500,
      },
    ],
    rates: {
      sutaUiMilliPct: 370,
      sutaEafMilliPct: 30,
      pfmlTotalMilliPct: 1_130,
      pfmlEmployeeShareMilliPct: 71_430,
      waCaresMilliPct: 580,
      lniEmployeeMilliCentsPerHour: 16_445,
      lniEmployerMilliCentsPerHour: 39_485,
    },
    pfml: { employerOwesEmployerShare: true, determinedAverageHeadcount: 50 },
  };
  const built = buildWaQuarter(req);
  assert(built.ok, "the drift gate could not build a quarter, so it compared nothing");
  if (!built.ok) return;

  for (const line of built.value.lines) {
    const spec = TEACHING_FORMS[line.form];
    assert(spec !== undefined, `the engine emits form ${line.form} but nothing teaches it`);
    if (spec === undefined) continue;
    const t = spec.find((x) => x.box === line.id);
    assert(
      t !== undefined,
      `the engine emits ${line.form} line "${line.id}" (${line.boxLabel}) but the teaching ` +
        `specimen has no entry for it, so that box shows a figure it cannot explain`,
    );
    if (t === undefined) continue;
    assert(
      t.caption === line.boxLabel,
      `${line.form} box ${line.id}: teaching caption "${t.caption}" does not match the engine's ` +
        `own label "${line.boxLabel}"`,
    );
    const resolved = resolveWhose(line.form, t);
    assert(
      resolved.whose === line.whoseMoney,
      `${line.form} box ${line.id}: teaching says whose money is "${resolved.whose}", the engine ` +
        `says "${line.whoseMoney}". Whose money a box is has exactly one right answer.`,
    );
    assert(
      resolved.measure === line.measure,
      `${line.form} box ${line.id}: teaching measures it in "${resolved.measure}", the engine in ` +
        `"${line.measure}". A unit mismatch prints hours as dollars.`,
    );
  }

  /*
   * AND THE FORM THAT EMITS NO LINES AT ALL.
   *
   * The loop above can never reach the 5208B, because the 5208B has no lines -
   * which is exactly the blind spot that let its tab be dropped. Asserting the
   * absence AS an absence (rule 87): prove the engine really produces no lines
   * for it, prove it produces wage-detail rows instead, and prove it is taught
   * anyway. If the engine ever starts emitting lines for it, this fails and
   * says so rather than quietly falling through.
   */
  const b5208b = built.value.lines.filter((l) => l.form === "esd_5208b");
  assert(
    b5208b.length === 0,
    `the 5208B now emits ${b5208b.length} engine lines; it used to emit none, and the teaching ` +
      `specimen describes it as columns rather than boxes on that basis. Recheck both.`,
  );
  assert(
    built.value.wageDetail.length > 0,
    "the 5208B carries no wage-detail rows either, so nothing renders it at all",
  );
  assert(
    TEACHING_FORMS["esd_5208b"] !== undefined,
    "the 5208B has no teaching specimen, so it is the one form with no tab",
  );
}

/**
 * Every form the Washington screen offers a tab for must be teachable.
 *
 * `FORM_ORDER` on the page iterates the engine's four form ids. If any one of
 * them has no specimen, `teachingBoxes` throws at render time - a runtime crash
 * on Michael's screen rather than a red build. Asserted here so it is a red
 * build.
 */
export function assertEveryWaFormIsTeachable(): void {
  const waForms: readonly WaQuarterFormId[] = [
    "esd_5208a",
    "esd_5208b",
    "pfml_wa_cares",
    "lni_quarterly",
  ];
  for (const f of waForms) {
    assert(TEACHING_FORMS[f] !== undefined, `Washington form ${f} has a tab but nothing to teach`);
    assert(teachingBoxes(f).length > 0, `Washington form ${f} teaches zero boxes`);
  }
}

/**
 * A federal box may not be taught unless the adapters can classify it.
 *
 * `resolveWhose` throws for a federal box missing from the FORM_*_WHOSE table.
 * That throw happens at render time. This turns it into a build failure by
 * resolving every federal box up front.
 */
export function assertEveryFederalBoxIsClassified(): void {
  for (const formId of ["form_941", "form_940", "form_w2"]) {
    for (const t of TEACHING_FORMS[formId] ?? []) {
      // Throws, naming the box, if the adapters do not know it.
      resolveWhose(formId, t);
    }
  }
}

export function __runFormBoxTeachingCoreTests(): void {
  assertNoSpecimenClaimsAFigure();
  assertEverySpecimenBoxTeaches();
  assertUnknownFormThrows();
  assertSpecimenMatchesTheEngine();
  assertEveryWaFormIsTeachable();
  assertEveryFederalBoxIsClassified();
  assertEveryIdentityValueHasABox();
}
