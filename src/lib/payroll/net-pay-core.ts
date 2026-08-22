/**
 * src/lib/payroll/net-pay-core.ts   (books-37)
 *
 * NET PAY, END TO END. The one number the employee actually cares about, and
 * the one number no single existing module could produce.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS, WHEN `netPayCents` ALREADY EXISTED
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `computePaycheckTaxes` in payroll-withholding-core.ts already returns a field
 * called `netPayCents`, and it is arithmetically correct for what it measures:
 *
 *     gross - employee taxes
 *
 * That is NOT net pay. It is net pay for an employee with no garnishment and no
 * voluntary deductions. The name does not say so, and a name that overstates
 * what it measures is the most dangerous kind of correct code - nobody
 * double-checks a field called `netPayCents`.
 *
 * Meanwhile garnishment-core.ts computes garnishments perfectly and takes its
 * input as `PaycheckFacts.requiredByLawWithheldCents` - a number that, before
 * this file, NOTHING IN THE REPOSITORY PRODUCED. A grep for that field outside
 * the engine returns test fixtures only. The tax engine computed the exact
 * components it needs; the two were never connected.
 *
 * So the defect was not a wrong calculation. It was a MISSING SEAM, and the
 * two halves each looked complete on their own. This file is that seam, and it
 * renames the pre-garnishment figure honestly on the way through.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS FILE FIXES ON THE WAY: L&I AND DISPOSABLE EARNINGS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `PaycheckFacts.requiredByLawWithheldCents` is documented as "federal income
 * tax, social security, medicare, and in Washington the employee share of PFML
 * and WA Cares. NOTHING ELSE." That list omits the L&I workers' compensation
 * employee premium. The omission is wrong, and it is wrong in the direction
 * that takes too much money out of an employee's cheque.
 *
 * 15 U.S.C. 1672(b) defines the base:
 *
 *   "The term 'disposable earnings' means that part of the earnings of any
 *    individual remaining after the deduction from those earnings of any
 *    amounts required by law to be withheld."
 *
 * The statute does not enumerate what qualifies, so the test is whether the law
 * REQUIRES the withholding. RCW 51.16.140(1) answers it for L&I:
 *
 *   "Every employer who is not a self-insurer shall deduct from the pay of
 *    each of his or her workers one-half of the amount he or she is required
 *    to pay, for medical benefits within each risk classification."
 *
 * "Shall deduct", not "may deduct" - and RCW 51.16.140(2) makes deducting the
 * wrong amount a GROSS MISDEMEANOR. A deduction the employer is commanded by
 * statute to make, on pain of criminal liability, is the paradigm case of an
 * amount "required by law to be withheld".
 *
 * The enforcing agency agrees. DOL Wage and Hour Division Fact Sheet #30
 * (December 2024) describes disposable earnings as "the amount of earnings left
 * after legally required deductions are made", and gives as examples "federal,
 * state, and local taxes, and the employee's share of Social Security, Medicare
 * and State Unemployment Insurance tax". State unemployment insurance is a
 * state-law payroll deduction that is not a tax on income - structurally the
 * same animal as the L&I medical-aid half. The test the fact sheet applies is
 * compulsion, not the identity of the payee. (That fact sheet says of itself
 * that its contents "do not have the force and effect of law"; it is used here
 * as the enforcing agency's reading of a statutory term, never as the rule.)
 *
 * WHAT THE ERROR WOULD HAVE COST. Omitting L&I inflates disposable earnings by
 * the employee premium, and a creditor garnishment takes 25% of the inflated
 * figure. The over-withholding is small per cheque and permanent per employee,
 * it comes out of the pocket of someone already being garnished, and it is
 * invisible on a pay stub that shows only the final number. `disposableFor`
 * below therefore includes L&I, and says so in the returned explanation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ORDER OF OPERATIONS, AND WHY IT IS NOT NEGOTIABLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. GROSS
 *   2. less taxes required by law        -> DISPOSABLE EARNINGS (the CCPA base)
 *   3. less garnishment, capped on (2)
 *   4. less voluntary deductions
 *   5. = NET PAY
 *
 * Step 4 comes after step 3 and is NOT part of step 2. Every instinct says
 * health insurance is a deduction like any other, and the CCPA says otherwise
 * in as many words - Fact Sheet #30: "Deductions not required by law - such as
 * those for voluntary wage assignments, union dues, health and life insurance,
 * contributions to charitable causes, purchases of savings bonds, retirement
 * plan contributions (except those required by law) ... usually may not be
 * subtracted from gross earnings when calculating disposable earnings".
 *
 * Subtracting them at step 2 shrinks the base, shrinks the garnishment, and
 * leaves the employer holding the difference. On a support order that shortfall
 * can become the employer's own liability.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PURITY (standing rule 65b)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * No `node:fs`, no database, no `server-only`. This module is reachable from a
 * client component and must stay reachable. Everything it needs is an argument.
 */

import {
  computeAllOrders,
  type MinimumWageFacts,
  type MultiOrderResult,
  type WageOrder,
} from "./garnishment-core";
import { type PaycheckTaxes } from "./payroll-withholding-core";

/* ══════════════════════════════════════════════════════════════════════════
 * 1) VOLUNTARY DEDUCTIONS
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * One deduction that the law does NOT require.
 *
 * THERE IS NO TABLE FOR THESE YET, AND THIS FILE DOES NOT INVENT ONE.
 * Greenway has no voluntary-deduction table in any migration - verified, not
 * assumed. Standing rule 62d forbids inventing a default, so this type is an
 * explicit INPUT with no source: callers pass an empty array today, and that
 * empty array is reported on screen as "none recorded" rather than silently
 * producing a net pay that happens to be right for the wrong reason.
 *
 * When the deductions table arrives (health premiums are the likely first
 * case), it populates this array and nothing else in the chain changes. That is
 * standing rule 62e - build the seam the next slice needs, not the guess.
 */
export type VoluntaryDeduction = {
  readonly label: string;
  readonly amountCents: number;
  /**
   * True only for deductions the employee authorised IN WRITING, IN ADVANCE.
   *
   * RCW 49.52.060 is the only thing that makes a non-statutory deduction lawful
   * in Washington, and it requires exactly that. This flag is not decoration:
   * `computeNetPay` refuses to take a deduction that does not carry it, because
   * an unauthorised deduction is a wage rebate under RCW 49.52.050 - a
   * misdemeanor that names officers personally.
   */
  readonly writtenAuthorizationOnFile: boolean;
};

/* ══════════════════════════════════════════════════════════════════════════
 * 2) REFUSALS
 * ══════════════════════════════════════════════════════════════════════════ */

export type NetPayRefusalCode =
  | "NET_PAY_TAXES_REFUSED"
  | "NET_PAY_GARNISHMENT_REFUSED"
  | "NET_PAY_DEDUCTION_NOT_AUTHORIZED"
  | "NET_PAY_DEDUCTION_NOT_WHOLE_CENTS"
  | "NET_PAY_WOULD_GO_NEGATIVE";

export type NetPayRefusal = {
  readonly code: NetPayRefusalCode;
  /** Plain English. Michael reads these, not the code. */
  readonly message: string;
  /** The single concrete action that clears it. */
  readonly whatToDo: string;
};

export type NetPayResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusals: readonly NetPayRefusal[] };

/* ══════════════════════════════════════════════════════════════════════════
 * 3) DISPOSABLE EARNINGS, FROM REAL COMPUTED TAXES
 * ══════════════════════════════════════════════════════════════════════════ */

/** The legally-required withholding on a cheque, itemised so it can be audited. */
export type RequiredByLawBreakdown = {
  readonly federalIncomeTaxCents: number;
  readonly socialSecurityCents: number;
  readonly medicareCents: number;
  readonly additionalMedicareCents: number;
  readonly waPfmlCents: number;
  readonly waCaresCents: number;
  /** RCW 51.16.140(1). Included deliberately - see the header. */
  readonly waLniCents: number;
  readonly totalCents: number;
};

/**
 * Itemise what the law required to be withheld from this cheque.
 *
 * WHY IT TAKES THE WHOLE `PaycheckTaxes` AND NOT A NUMBER. Passing a
 * pre-summed total would let a caller decide what belongs in it, which is
 * precisely the decision that was got wrong before this file existed. Taking
 * the computed result and summing it HERE means there is exactly one answer to
 * "what counts", and it is this function.
 *
 * ON THE UNCOLLECTED CASE. When a cheque cannot carry its own withholding,
 * `computePaycheckTaxes` withholds in IRS Pub. 15 order until the money runs
 * out. What reduces disposable earnings is what was ACTUALLY withheld, not what
 * was owed - so this reads `totalEmployeeWithheldCents` for the total and the
 * itemisation is shown for explanation. In that situation disposable earnings
 * are zero or near it and no garnishment can be taken anyway, which is the
 * correct outcome: the tax comes first.
 */
export function requiredByLawFor(taxes: PaycheckTaxes): RequiredByLawBreakdown {
  const lni = taxes.lni.ok ? taxes.lni.value.employeeCents : 0;
  return {
    federalIncomeTaxCents: taxes.federalIncomeTax.line4b_withholdingCents,
    socialSecurityCents: taxes.fica.employeeOasdiCents,
    medicareCents: taxes.fica.employeeMedicareCents,
    additionalMedicareCents: taxes.fica.employeeAdditionalMedicareCents,
    waPfmlCents: taxes.pfml.employeeShareCents,
    waCaresCents: taxes.waCares.employeeCents,
    waLniCents: lni,
    // The ACTUALLY-withheld figure, which equals the sum of the parts on any
    // normal cheque and is smaller only when the cheque could not carry them.
    totalCents: taxes.totalEmployeeWithheldCents,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4) THE WHOLE CHEQUE
 * ══════════════════════════════════════════════════════════════════════════ */

export type NetPayBreakdown = {
  readonly grossWagesCents: number;
  readonly requiredByLaw: RequiredByLawBreakdown;
  /** Gross less legally-required withholding. The CCPA base. */
  readonly disposableEarningsCents: number;
  /**
   * Gross less taxes only. This is the figure `computePaycheckTaxes` calls
   * `netPayCents`, carried through under a name that says what it is, so the
   * two can be compared and the difference explained.
   */
  readonly afterTaxBeforeDeductionsCents: number;
  readonly garnishment: MultiOrderResult | null;
  readonly totalGarnishedCents: number;
  readonly voluntaryDeductions: readonly VoluntaryDeduction[];
  readonly totalVoluntaryCents: number;
  /** The number on the cheque. Never negative. */
  readonly netPayCents: number;
  /** Every step, in order, in plain English. */
  readonly explanation: readonly string[];
  /** Non-fatal things Michael should know. */
  readonly notes: readonly string[];
};

/**
 * Gross to net, in the only order the law permits.
 *
 * REFUSES RATHER THAN PRODUCING A WRONG CHEQUE. Four conditions stop it:
 * the tax engine refused; the garnishment engine refused; a voluntary deduction
 * has no written authorisation; the deductions would drive the cheque negative.
 * All four are reported together where possible, because fixing them one screen
 * refresh at a time is how a Friday payroll becomes a Saturday payroll.
 */
export function computeNetPay(args: {
  readonly taxes: PaycheckTaxes;
  readonly orders: readonly WageOrder[];
  readonly wages: MinimumWageFacts;
  readonly workweeksInPeriod: number;
  readonly voluntaryDeductions: readonly VoluntaryDeduction[];
}): NetPayResult<NetPayBreakdown> {
  const { taxes, orders, wages, workweeksInPeriod, voluntaryDeductions } = args;
  const refusals: NetPayRefusal[] = [];
  const notes: string[] = [];
  const explanation: string[] = [];

  const gross = taxes.grossWagesCents;
  const requiredByLaw = requiredByLawFor(taxes);
  const disposable = gross - requiredByLaw.totalCents;

  explanation.push(
    `Gross pay for this period is ${money(gross)}.`,
    `Withholding required by law comes to ${money(requiredByLaw.totalCents)}: ` +
      `${money(requiredByLaw.federalIncomeTaxCents)} federal income tax, ` +
      `${money(requiredByLaw.socialSecurityCents)} Social Security, ` +
      `${money(requiredByLaw.medicareCents)} Medicare` +
      (requiredByLaw.additionalMedicareCents > 0
        ? `, ${money(requiredByLaw.additionalMedicareCents)} Additional Medicare`
        : "") +
      `, ${money(requiredByLaw.waPfmlCents)} WA Paid Leave, ` +
      `${money(requiredByLaw.waCaresCents)} WA Cares, and ` +
      `${money(requiredByLaw.waLniCents)} L&I workers' comp.`,
    `That leaves ${money(disposable)} of disposable earnings. This is the figure the ` +
      `garnishment limits are measured against - not take-home pay, and not gross.`,
  );

  if (requiredByLaw.waLniCents > 0) {
    notes.push(
      `The L&I employee premium of ${money(requiredByLaw.waLniCents)} IS subtracted before the ` +
        `garnishment limits are applied. RCW 51.16.140(1) says the employer "shall deduct" it, and ` +
        `a deduction the law compels is one of the "amounts required by law to be withheld" that ` +
        `15 U.S.C. 1672(b) removes from the base. Leaving it in would overstate disposable ` +
        `earnings and take too much from someone who is already being garnished.`,
    );
  }

  if (!taxes.lni.ok) {
    notes.push(
      `Your L&I rate is not on file, so no L&I employee premium was withheld and none was ` +
        `subtracted before the garnishment limits. If a premium should have been withheld, the ` +
        `disposable earnings figure above is too HIGH and any garnishment computed from it is too ` +
        `large. Load the L&I rate notice before running a garnished cheque.`,
    );
  }

  if (taxes.hasRefusals) {
    // A SUTA or L&I rate refusal does not make net pay wrong - neither is an
    // employee deduction, except the L&I half, whose absence is noted above.
    // Only the insufficient-funds refusal actually stops the cheque.
    const blocking = taxes.refusals.filter((r) => r.code === "withholding_exceeds_gross_pay");
    for (const r of blocking) {
      refusals.push({
        code: "NET_PAY_TAXES_REFUSED",
        message: r.message,
        whatToDo: r.whatToDo,
      });
    }
    for (const r of taxes.refusals.filter((x) => x.code !== "withholding_exceeds_gross_pay")) {
      notes.push(`${r.message} ${r.whatToDo}`);
    }
  }

  // ── garnishment ────────────────────────────────────────────────────────
  let garnishment: MultiOrderResult | null = null;
  let totalGarnished = 0;

  if (orders.length > 0) {
    const result = computeAllOrders({
      orders,
      pay: {
        grossCents: gross,
        requiredByLawWithheldCents: requiredByLaw.totalCents,
        voluntaryDeductionsCents: sumDeductions(voluntaryDeductions),
        workweeksInPeriod,
      },
      wages,
    });

    if (!result.ok) {
      for (const r of result.refusals) {
        refusals.push({
          code: "NET_PAY_GARNISHMENT_REFUSED",
          message: r.message,
          // The garnishment engine calls its remedy field `fix`; this engine
          // calls it `whatToDo`. Translated here, at the seam, rather than
          // renaming either side - both names are already load-bearing in
          // their own module's tests and screens.
          whatToDo: r.fix,
        });
      }
    } else {
      garnishment = result.value;
      totalGarnished = result.value.totalWithheldCents;
      explanation.push(
        `Garnishment takes ${money(totalGarnished)} across ${result.value.lines.length} ` +
          `order${result.value.lines.length === 1 ? "" : "s"}.`,
      );
      notes.push(...result.value.notes);
    }
  } else {
    explanation.push("There are no wage orders against this employee, so nothing was garnished.");
  }

  // ── voluntary deductions ───────────────────────────────────────────────
  let totalVoluntary = 0;
  for (const d of voluntaryDeductions) {
    if (!Number.isInteger(d.amountCents) || d.amountCents < 0) {
      refusals.push({
        code: "NET_PAY_DEDUCTION_NOT_WHOLE_CENTS",
        message:
          `The deduction "${d.label}" is ${d.amountCents}, which is not a whole number of cents ` +
          `at or above zero. A deduction that is not whole cents cannot come out of a real cheque, ` +
          `and a negative one is a payment wearing the wrong label.`,
        whatToDo: `Correct the amount on the "${d.label}" deduction, or remove it.`,
      });
      continue;
    }
    if (!d.writtenAuthorizationOnFile) {
      refusals.push({
        code: "NET_PAY_DEDUCTION_NOT_AUTHORIZED",
        message:
          `The deduction "${d.label}" (${money(d.amountCents)}) has no written authorisation on ` +
          `file. In Washington the ONLY two things that make a deduction lawful are that the law ` +
          `requires it, or that the employee authorised it in writing in advance - RCW 49.52.060. ` +
          `This one is neither. Taking it anyway is a wage rebate under RCW 49.52.050, which is a ` +
          `misdemeanor, and the statute names "any officer, vice principal or agent" personally, ` +
          `not just the company.`,
        whatToDo:
          `Get the employee's written authorisation for "${d.label}" and attach it, or remove the ` +
          `deduction from this cheque. Do not take it and collect the paperwork afterwards - the ` +
          `statute requires the authorisation IN ADVANCE.`,
      });
      continue;
    }
    totalVoluntary += d.amountCents;
  }

  if (voluntaryDeductions.length === 0) {
    explanation.push(
      "There are no voluntary deductions on this cheque - no health premium, no retirement, no " +
        "dues. Nothing was subtracted here, and nothing was assumed.",
    );
  } else if (totalVoluntary > 0) {
    explanation.push(
      `Voluntary deductions take ${money(totalVoluntary)}. These come out AFTER the garnishment ` +
        `limits, never before: subtracting them earlier would shrink the base the garnishment is ` +
        `measured against, under-withhold on the order, and leave you owing the difference.`,
    );
  }

  const afterTax = gross - requiredByLaw.totalCents;
  const net = afterTax - totalGarnished - totalVoluntary;

  if (net < 0 && refusals.length === 0) {
    refusals.push({
      code: "NET_PAY_WOULD_GO_NEGATIVE",
      message:
        `After tax, garnishment and voluntary deductions this cheque comes to ${money(net)} - a ` +
        `negative amount. I stopped rather than produce it. Handing someone a cheque that says ` +
        `they owe you money is RCW 49.52.050 territory, and the garnishment and deduction figures ` +
        `disagree with what is actually on this cheque.`,
      whatToDo:
        "Check the voluntary deductions first - a fixed monthly premium taken from a short or " +
        "final cheque is the usual cause. Reduce or skip the voluntary deduction for this period; " +
        "the garnishment and the tax are not yours to reduce.",
    });
  }

  if (refusals.length > 0) return { ok: false, refusals };

  explanation.push(
    `Net pay is ${money(net)}. That is gross ${money(gross)}, less ${money(requiredByLaw.totalCents)} ` +
      `required by law, less ${money(totalGarnished)} garnished, less ${money(totalVoluntary)} in ` +
      `voluntary deductions.`,
  );

  return {
    ok: true,
    value: {
      grossWagesCents: gross,
      requiredByLaw,
      disposableEarningsCents: disposable,
      afterTaxBeforeDeductionsCents: afterTax,
      garnishment,
      totalGarnishedCents: totalGarnished,
      voluntaryDeductions,
      totalVoluntaryCents: totalVoluntary,
      netPayCents: net,
      explanation,
      notes,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5) THE CROSS-CHECK
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Prove that the parts of a cheque add up to the whole.
 *
 * WHY A SEPARATE FUNCTION AND NOT AN ASSERTION INSIDE `computeNetPay`.
 * An invariant checked at the only place it can be violated is good practice;
 * an invariant checked where it CANNOT be violated is unreachable code wearing
 * a green tick (standing rule 15/50). Inside `computeNetPay`, `net` is defined
 * as the subtraction, so re-checking the subtraction there proves nothing and
 * no test could ever kill it.
 *
 * Exposed instead as something the PAY RUN calls, comparing this engine's
 * answer against the figure that is about to be written to a payment file. That
 * comparison CAN fail - it fails the moment a fifth deduction is added upstream
 * and forgotten here - and it is the check that actually protects the cheque.
 */
export function netPayReconciles(b: NetPayBreakdown): {
  readonly balanced: boolean;
  readonly differenceCents: number;
  readonly explanation: string;
} {
  const rebuilt =
    b.grossWagesCents -
    b.requiredByLaw.totalCents -
    b.totalGarnishedCents -
    b.totalVoluntaryCents;
  const difference = b.netPayCents - rebuilt;
  return {
    balanced: difference === 0,
    differenceCents: difference,
    explanation:
      difference === 0
        ? `Gross ${money(b.grossWagesCents)} less ${money(b.requiredByLaw.totalCents)} required by ` +
          `law, less ${money(b.totalGarnishedCents)} garnished, less ${money(b.totalVoluntaryCents)} ` +
          `voluntary equals the net pay of ${money(b.netPayCents)} exactly.`
        : `The parts of this cheque do not add up to the whole. Adding the pieces back together ` +
          `gives ${money(rebuilt)}, but the cheque says ${money(b.netPayCents)} - a difference of ` +
          `${money(difference)}. Something was deducted that is not in the list, or something in ` +
          `the list was not deducted. Do not pay this cheque until the difference is explained.`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6) SMALL HELPERS
 * ══════════════════════════════════════════════════════════════════════════ */

function sumDeductions(ds: readonly VoluntaryDeduction[]): number {
  let total = 0;
  for (const d of ds) {
    if (Number.isInteger(d.amountCents) && d.amountCents > 0) total += d.amountCents;
  }
  return total;
}

/**
 * Cents as a plain dollar string, minus sign preserved.
 *
 * The negative case is deliberate. A cheque that comes out negative is
 * something Michael must SEE as negative; formatting it as "$0.00" or
 * "($12.34)" would soften the one number that has to be alarming.
 */
function money(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$${dollars.toLocaleString("en-US")}.${rest}`;
}
