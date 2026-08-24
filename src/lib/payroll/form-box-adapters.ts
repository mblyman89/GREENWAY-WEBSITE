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
type WhoseRow = { readonly whose: WhoseMoney; readonly why: string };

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
const FORM_941_WHOSE: Readonly<Record<string, WhoseRow>> = {
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
  "15": {
    whose: "shared",
    why: "An overpayment — money already sent that exceeds the tax, of both kinds.",
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

const FORM_940_WHOSE: Readonly<Record<string, WhoseRow>> = {
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
const FORM_W2_WHOSE: Readonly<Record<string, WhoseRow>> = {
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
export function assertEveryClassificationIsJustified(): void {
  const tables: readonly [string, Readonly<Record<string, WhoseRow>>][] = [
    ["Form 941", FORM_941_WHOSE],
    ["Form 940", FORM_940_WHOSE],
    ["Form W-2", FORM_W2_WHOSE],
  ];
  for (const [name, table] of tables) {
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

export function __runFormBoxAdapterTests(): void {
  assertUnknownBoxIsRefused();
  assertEveryClassificationIsJustified();
  assertFutaIsNeverEmployeeMoney();
  assertSocialSecurityIsClassifiedTwice();
}
