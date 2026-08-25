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
import {
  FORM_941_WHOSE,
  FORM_940_WHOSE,
  FORM_W2_WHOSE,
  type WhoseRow,
} from "@/lib/payroll/form-box-adapters";
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
    box: "15",
    caption: "Overpayment",
    whoseSource: FED_941,
    howItGetsFilled:
      "Box 13 minus box 12, when the deposits were the larger — money the IRS is holding that " +
      "is yours. You then choose whether it is refunded or applied to the next quarter.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  FORM 940 — the annual FUTA return
 * ═══════════════════════════════════════════════════════════════════════════ */

export const FORM_940_TEACHING: readonly TeachingBox[] = [
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
export const TEACHING_FORMS: Readonly<Record<string, readonly TeachingBox[]>> = {
  form_941: FORM_941_TEACHING,
  form_940: FORM_940_TEACHING,
  form_w2: FORM_W2_TEACHING,
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
}
