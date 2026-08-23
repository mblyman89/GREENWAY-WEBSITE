/**
 * PAY RUN CORE — turning one employee's facts into one real paycheque.
 *
 * books-39. PURE. No Supabase, no `server-only`, no I/O of any kind. Everything
 * this module needs arrives as an argument, which is what makes it testable
 * against a hundred awkward cases in milliseconds and what lets the screen
 * import it without dragging the database into the browser.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Before this slice, five finished engines sat side by side and nothing joined
 * them on a real person:
 *
 *   computeTimesheetForPeriod   hours worked, overtime, gross    (timesheet-store)
 *   computePaycheckTaxes        federal + Washington withholding (payroll-withholding-core)
 *   computeAllOrders            garnishment ceilings             (garnishment-core)
 *   computeNetPay               the order the law requires       (net-pay-core)
 *   loadYtdForEmployee          wage-base tracking               (ytd-store)
 *
 * `computeNetPay` was called exactly once in the whole codebase, from the
 * ILLUSTRATION on the net-pay screen. Meanwhile the actual payroll screen
 * stored a net figure Michael typed in by hand.
 *
 * This module is the join, and it is deliberately the DULL part: it gathers,
 * it checks, it delegates. There is no tax arithmetic in this file and there
 * must never be. Every number comes back from an engine that already owns it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DESIGN RULE THAT MATTERS MOST HERE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A pay run touches many people at once. That creates a failure mode that a
 * single-employee calculator does not have:
 *
 *   ONE PERSON'S PROBLEM MUST NEVER HIDE ANOTHER PERSON'S NUMBERS,
 *   AND MUST NEVER SILENTLY PAY THEM ANYWAY.
 *
 * So the result is per-employee. Each person is `ready`, `blocked`, or
 * `attention`. A blocked employee names what is missing and how to fix it; the
 * rest of the run still computes. Michael sees eleven good cheques and one
 * problem, not a blank screen — and he cannot pay the problem by accident,
 * because a blocked line has no amount at all.
 *
 * The `attention` state exists because of the W-4 finding, and it is the most
 * carefully-reasoned decision in this file. See NOTE ON `attention` below.
 */

import type { MinimumWageFacts, WageOrder } from "./garnishment-core";
import {
  computeNetPay,
  netPayReconciles,
  type NetPayBreakdown,
  type NetPayRefusal,
  type VoluntaryDeduction,
} from "./net-pay-core";
import type { PayFrequency, W4Record } from "./payroll-w4-core";
import { defaultW4WhenNoneFurnished } from "./payroll-w4-core";
import {
  computePaycheckTaxes,
  type PaycheckTaxes,
  type YtdWageAccumulators,
} from "./payroll-withholding-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) THE W-4 DECISION — the blocker this slice exists to remove
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Which W-4 governed this cheque, and how we came to use it.
 *
 * This is recorded on every line, not just the odd ones, because "why did this
 * person's federal withholding change in March?" is a question that gets asked
 * in December, and the only honest answer is one that was written down at the
 * time.
 */
export type W4Provenance =
  /** A signed, current W-4 was on file and was used exactly as furnished. */
  | "furnished"
  /**
   * No W-4 on file at all. 26 C.F.R. § 31.3402(f)(2)-1(a)(4) applies: the
   * employee is treated as single with no adjustments. This is a LAWFUL
   * treatment, not a guess, and it is nearly always more withholding than the
   * employee would have chosen.
   */
  | "statutory_default_no_w4"
  /**
   * A W-4 row exists but is unsigned. An unsigned certificate has not been
   * "furnished" — the regulation requires a *signed* certificate — so it is
   * disregarded and the statutory default applies, same as if it were absent.
   */
  | "statutory_default_unsigned";

export const ALL_W4_PROVENANCES: readonly W4Provenance[] = [
  "furnished",
  "statutory_default_no_w4",
  "statutory_default_unsigned",
];

/**
 * Decide which W-4 to use, and say why.
 *
 * WHY THIS IS A FUNCTION AND NOT THREE LINES AT THE CALL SITE
 *
 * Because it is the exact decision that was missing. Every read of the
 * `employee_w4` table in this codebase was `.select("employee_id")` — an
 * existence check. Whether a form exists is not the question a paycheque asks.
 * The question is "which certificate governs, and what do I do when there
 * isn't a good one", and the answer has legal consequences in three different
 * directions. Putting it in one named, tested function means there is exactly
 * one answer, and it is the same answer on the screen, in the ledger, and in
 * the explanation printed on the pay stub.
 *
 * NOT IMPLEMENTED HERE, DELIBERATELY: the prior-certificate fallback.
 * § 31.3402(f)(2)-1(e)(1)(ii) says that when a certificate is invalid and a
 * PRIOR valid one is in effect, the employer keeps withholding under the prior
 * one rather than defaulting to single. Our schema supports this — superseded
 * W-4s keep their row and only `is_current` flips — but the store currently
 * loads only the current row, so the prior form is not in hand at this point.
 * Rather than pretend, this function handles the case it can see and the
 * store's loader documents the gap. Inventing a fallback we cannot source is
 * exactly what rule 62d forbids.
 */
export function chooseW4(args: {
  readonly employeeId: string;
  /** The current W-4 as read from the database, or null if there is none. */
  readonly onFile: W4Record | null;
  /** The calendar year of the PAY DATE — used only to stamp the default. */
  readonly payYear: number;
}): { readonly w4: W4Record; readonly provenance: W4Provenance } {
  const { employeeId, onFile, payYear } = args;

  if (onFile === null) {
    return {
      w4: defaultW4WhenNoneFurnished(employeeId, payYear),
      provenance: "statutory_default_no_w4",
    };
  }

  // An unsigned form is not a form. The regulation requires a *signed*
  // certificate, and Pub. 15-T's electronic-substitute rules put the perjury
  // statement last for a reason: a record with data and no signature is an
  // abandoned draft, not an election. Honouring it would mean withholding
  // according to numbers nobody swore to.
  if (onFile.signedAt === null) {
    return {
      w4: defaultW4WhenNoneFurnished(employeeId, payYear),
      provenance: "statutory_default_unsigned",
    };
  }

  return { w4: onFile, provenance: "furnished" };
}

/** Plain-English sentence for a provenance, shown on the line and the stub. */
export function describeW4Provenance(p: W4Provenance): string {
  switch (p) {
    case "furnished":
      return "Withheld according to the signed W-4 on file.";
    case "statutory_default_no_w4":
      return (
        "No W-4 on file. Federal income tax was withheld as SINGLE with no adjustments, which " +
        "is the treatment the IRS requires when an employee has not furnished a certificate " +
        "(26 C.F.R. § 31.3402(f)(2)-1(a)(4)). This is almost always MORE tax than the employee " +
        "would have chosen. Collect a signed W-4 — the employee is paying for the missing form " +
        "out of every cheque until it arrives."
      );
    case "statutory_default_unsigned":
      return (
        "The W-4 on file is NOT SIGNED, so it cannot be honoured. Federal income tax was " +
        "withheld as SINGLE with no adjustments, the same treatment as no form at all. Get the " +
        "employee to sign the form they already filled in — this is usually a one-minute fix."
      );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) WHAT ONE EMPLOYEE'S PAY RUN NEEDS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything required to compute one person's cheque.
 *
 * Assembled by the store from five different tables. Kept as one flat,
 * readonly record so a test can build an awkward case by hand in six lines,
 * and so it is obvious at a glance what a paycheque actually depends on.
 */
export type PayRunEmployeeInput = {
  readonly employeeId: string;
  readonly employeeName: string;

  /** From the timesheet engine. Null when the timesheet refused for this person. */
  readonly grossWagesCents: number | null;
  /** Hours in HUNDREDTHS. Drives the L&I premium, which is per-hour, not percent. */
  readonly hundredthHours: number | null;
  /** Why the timesheet could not produce hours. Empty when it did. */
  readonly timesheetRefusals: readonly string[];

  /** The current W-4 row, already converted. Null when none is on file. */
  readonly w4OnFile: W4Record | null;
  /**
   * How often this person is paid. Drives the whole withholding table.
   *
   * NULLABLE ON PURPOSE. The obvious shortcut is to type this `PayFrequency`
   * and let the store write `?? "biweekly"` when no pay record is found - and
   * that is exactly what the first version of pay-run-store.ts did, underneath
   * a comment claiming it did not. Biweekly is right for Greenway's staff today
   * and silently wrong for the owner, who is paid annually. A null reaches the
   * refusal below instead of inventing a divisor (standing rule 62d).
   */
  readonly payFrequency: PayFrequency | null;

  /** Year-to-date wage bases. NOT zeros — the wage-base ceilings depend on these. */
  readonly ytd: YtdWageAccumulators;

  /** Active court orders against this person's wages. Empty is normal. */
  readonly orders: readonly WageOrder[];
  /** Deductions the employee authorised in writing. Empty is normal. */
  readonly voluntaryDeductions: readonly VoluntaryDeduction[];

  /** Workweeks the period spans. Garnishment ceilings are per workweek. */
  readonly workweeksInPeriod: number;
};

/** The company-wide facts every line in the run shares. */
export type PayRunContext = {
  /** Pay date, YYYY-MM-DD. Chooses the rate rows. NOT the period end date. */
  readonly payDateIso: string;
  /** Minimum wage floors in force on the pay date. Nulls mean refuse. */
  readonly wages: MinimumWageFacts;

  // ── the evidenced rates, exactly as the registry returned them ────────────
  // Nulls are passed through, never defaulted. Rule 46: a zero rate computes a
  // confident, wrong paycheque, and nothing anywhere flags it.
  readonly stateUnemploymentRateMilliPct: number | null;
  readonly sutaRateNoticeDocumentId: string | null;
  readonly pfmlTotalRateMilliPct: number | null;
  readonly pfmlEmployerSharePctMilliPct: number | null;
  readonly waCaresRateMilliPct: number | null;
  readonly lniEmployeeRateMilliCentsPerHour: number | null;
  readonly lniEmployerRateMilliCentsPerHour: number | null;
  readonly lniRiskClassCode: string | null;
  readonly lniRateNoticeDocumentId: string | null;

  /** Greenway facts that are policy, not rates. */
  readonly employerHasFewerThan50WaEmployees: boolean;
  readonly stateContributionsPaidTimely: boolean;
  readonly creditReductionMilliPct: number;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) REFUSALS — every way one line can decline to produce a cheque
 * ═══════════════════════════════════════════════════════════════════════════ */

export type PayRunRefusalCode =
  /** The timesheet could not produce hours for this person. */
  | "NO_HOURS"
  /** Hours exist but no pay rate, so gross is unknowable. */
  | "NO_GROSS"
  /**
   * No current pay record says how often this person is paid.
   *
   * This is its own code, and not folded into NO_GROSS, because it is a
   * DIVISOR rather than a missing amount. Pub. 15-T's percentage method
   * annualises the wages, finds the bracket, then divides back down by the
   * number of periods in the year. Believe 24 where the truth is 26 and every
   * federal withholding figure is out by roughly eight percent, in a direction
   * nobody notices, on a cheque that looks entirely ordinary - and it will not
   * tie out until the W-2.
   */
  | "NO_PAY_FREQUENCY"
  /** A rate needed by every cheque has no evidenced row for the pay date. */
  | "RATE_NOT_ON_FILE"
  /** The minimum wage floor is unknown, so garnishment ceilings cannot be set. */
  | "NO_MINIMUM_WAGE"
  /** The net-pay engine refused. Its own reasons are carried through. */
  | "ENGINE_REFUSED"
  /** The parts do not re-add to the whole. Never seen; always checked. */
  | "DOES_NOT_RECONCILE";

export const ALL_PAY_RUN_REFUSAL_CODES: readonly PayRunRefusalCode[] = [
  "NO_HOURS",
  "NO_GROSS",
  "NO_PAY_FREQUENCY",
  "RATE_NOT_ON_FILE",
  "NO_MINIMUM_WAGE",
  "ENGINE_REFUSED",
  "DOES_NOT_RECONCILE",
];

export type PayRunRefusal = {
  readonly code: PayRunRefusalCode;
  /** What is wrong, in a sentence Michael can act on. */
  readonly message: string;
  /** The exact next click. Never "check your configuration". */
  readonly whatToDo: string;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 4) THE RESULT
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * NOTE ON `attention` — why three states and not two.
 *
 * The obvious design is ready/blocked. It is wrong here, and the W-4 case
 * shows why.
 *
 * An employee with no W-4 on file produces a PERFECTLY VALID cheque. The law
 * says exactly what to do, we do exactly that, and refusing to pay them would
 * be both unlawful and absurd — you cannot withhold someone's wages because
 * they owe you paperwork. So it cannot be `blocked`.
 *
 * But calling it `ready` and moving on is how the employee ends up
 * over-withheld for eleven months while everyone assumes the software would
 * have said something. It DID say something, in a note, next to eleven other
 * notes, in grey.
 *
 * `attention` is the honest third answer: this cheque is correct and payable,
 * AND there is something you should fix. It is a different colour on screen
 * and it is counted separately in the summary, so "3 need attention" is a
 * number Michael sees before he approves, not after.
 */
export type PayRunLineStatus = "ready" | "attention" | "blocked";

export type PayRunLine = {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly status: PayRunLineStatus;

  /** Present when status is ready or attention. Null when blocked. */
  readonly breakdown: NetPayBreakdown | null;
  /** The tax detail behind the breakdown. Null when blocked. */
  readonly taxes: PaycheckTaxes | null;

  /** Which W-4 governed, and how we came to use it. Always present. */
  readonly w4Provenance: W4Provenance;

  /** Why this line cannot be paid. Empty unless blocked. */
  readonly refusals: readonly PayRunRefusal[];
  /**
   * Things that are true and worth saying, on a line that still computed.
   * These are what drive `attention`.
   */
  readonly attentionNotes: readonly string[];
  /** Non-blocking commentary from the engines (e.g. "L&I rate not on file"). */
  readonly engineNotes: readonly string[];

  /** Convenience for the screen and the ledger. Null when blocked. */
  readonly netPayCents: number | null;
  readonly grossWagesCents: number | null;
  readonly totalGarnishedCents: number;
};

export type PayRunResult = {
  readonly payDateIso: string;
  readonly lines: readonly PayRunLine[];
  readonly readyCount: number;
  readonly attentionCount: number;
  readonly blockedCount: number;
  /** Sum of net pay across lines that can actually be paid. */
  readonly totalNetPayCents: number;
  readonly totalGrossWagesCents: number;
  readonly totalGarnishedCents: number;
  /**
   * Can money move? True only when NOTHING is blocked.
   *
   * `attention` does not stop a run — those cheques are correct. Blocked lines
   * do, and they stop the WHOLE run rather than just their own line, because a
   * partial payroll is its own kind of wrong: the person left out finds out on
   * payday.
   */
  readonly canPay: boolean;
  /** One sentence, plain English, that says what to do next. */
  readonly summary: string;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 5) COMPUTING ONE LINE
 * ═══════════════════════════════════════════════════════════════════════════ */

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** Year of a YYYY-MM-DD label, without constructing a Date (no timezone risk). */
export function yearOfDayKey(iso: string): number {
  return Number(iso.slice(0, 4));
}

/**
 * Compute one employee's cheque, or explain precisely why not.
 *
 * The order of the checks is deliberate: cheapest and most-explanatory first,
 * so that an employee with no hours AND no rates on file is told about the
 * hours (which is their actual situation) rather than about the rates (which
 * is everybody's situation and drowns out the specific one).
 */
export function computePayRunLine(args: {
  readonly input: PayRunEmployeeInput;
  readonly context: PayRunContext;
}): PayRunLine {
  const { input, context } = args;
  const refusals: PayRunRefusal[] = [];
  const attentionNotes: string[] = [];

  // ── The W-4 decision happens FIRST and unconditionally ────────────────────
  // Even on a blocked line. If someone is blocked for missing hours and ALSO
  // has no W-4, both facts are true and both should survive to the screen.
  // Deciding this inside the success branch would have hidden the second
  // problem until the first was fixed, which is how a two-week fix becomes a
  // four-week fix.
  const { w4, provenance } = chooseW4({
    employeeId: input.employeeId,
    onFile: input.w4OnFile,
    payYear: yearOfDayKey(context.payDateIso),
  });

  if (provenance !== "furnished") {
    attentionNotes.push(describeW4Provenance(provenance));
  }

  const blocked = (
    partial: readonly PayRunRefusal[],
    notes: readonly string[] = [],
  ): PayRunLine => ({
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    status: "blocked",
    breakdown: null,
    taxes: null,
    w4Provenance: provenance,
    refusals: partial,
    attentionNotes,
    engineNotes: notes,
    netPayCents: null,
    grossWagesCents: input.grossWagesCents,
    totalGarnishedCents: 0,
  });

  // ── 1. Hours and gross ────────────────────────────────────────────────────
  if (input.timesheetRefusals.length > 0) {
    refusals.push({
      code: "NO_HOURS",
      message:
        `The timesheet could not produce hours for ${input.employeeName}: ` +
        `${input.timesheetRefusals.join(" ")}`,
      whatToDo:
        "Open Timesheets for this pay period and fix the punches for this person. The pay run " +
        "reads the same figures the timesheet screen shows, so once it is clean there, it is " +
        "clean here.",
    });
    return blocked(refusals);
  }

  if (input.grossWagesCents === null || input.hundredthHours === null) {
    refusals.push({
      code: "NO_GROSS",
      message:
        `There are hours for ${input.employeeName} but no gross pay could be worked out, which ` +
        `normally means no pay rate is on file.`,
      whatToDo:
        "Open Staffing → this employee → Pay and set the pay basis and rate. A rate that was " +
        "never entered reads as 'unknown', not as zero, which is why nothing was computed.",
    });
    return blocked(refusals);
  }

  if (input.payFrequency === null) {
    refusals.push({
      code: "NO_PAY_FREQUENCY",
      message:
        `There is no current pay record for ${input.employeeName} saying how often they are ` +
        `paid, and that answer is a divisor in the federal withholding tables rather than a ` +
        `detail. Assuming "every two weeks" for somebody paid monthly gets every income-tax ` +
        `figure wrong by a wide margin on a cheque that otherwise looks perfectly normal.`,
      whatToDo:
        "Open Staffing → this employee → Pay and set the pay frequency. Greenway's staff are " +
        "biweekly (26 a year); the owner's is annual (1 a year). Nothing has been calculated " +
        "for this person.",
    });
    return blocked(refusals);
  }

  // ── 2. Rates that EVERY cheque needs ──────────────────────────────────────
  // Rule 46. A missing rate is passed to the engines as null and they refuse
  // individually — but PFML and WA Cares apply to every employee, so a missing
  // one is a whole-run problem and saying so once, clearly, beats eleven
  // identical refusals buried in eleven cards.
  const missingRates: string[] = [];
  if (context.pfmlTotalRateMilliPct === null) missingRates.push("WA Paid Leave total premium rate");
  if (context.pfmlEmployerSharePctMilliPct === null) {
    missingRates.push("WA Paid Leave employer share");
  }
  if (context.waCaresRateMilliPct === null) missingRates.push("WA Cares rate");

  if (missingRates.length > 0) {
    refusals.push({
      code: "RATE_NOT_ON_FILE",
      message:
        `No evidenced rate covers ${context.payDateIso} for: ${missingRates.join(", ")}. ` +
        `Every cheque needs these, so nothing can be computed for this pay date.`,
      whatToDo:
        "Open Books → Payroll rates and enter the rate from the agency notice, attaching the " +
        "notice itself. The system will not carry last year's figure forward — a rate that is " +
        "quietly one year stale produces a small, plausible error on every cheque for a year.",
    });
  }

  if (
    context.wages.federalMilliCentsPerHour === null ||
    context.wages.stateMilliCentsPerHour === null
  ) {
    // Only actually fatal when somebody is garnished — but see the authority:
    // the minimum wage sets the garnishment floor, so this is checked against
    // the orders rather than assumed harmless.
    if (input.orders.length > 0) {
      refusals.push({
        code: "NO_MINIMUM_WAGE",
        message:
          `${input.employeeName} has ${input.orders.length} active wage order(s), and the ` +
          `minimum wage in force on ${context.payDateIso} is not on file. The garnishment ` +
          `exemption is measured in multiples of the minimum hourly wage, so the amount that ` +
          `may lawfully be taken cannot be determined.`,
        whatToDo:
          "Enter the Washington and federal minimum wage for this year in Books → Payroll " +
          "rates. Washington's is recalculated every September 30th and takes effect the " +
          "following January 1st, so a new figure is needed every year.",
      });
    } else {
      attentionNotes.push(
        "The minimum wage for this pay date is not on file. It did not affect this cheque " +
          "because there are no wage orders against this employee, but it will block anyone " +
          "who is garnished.",
      );
    }
  }

  if (refusals.length > 0) return blocked(refusals);

  // ── 3. Taxes ──────────────────────────────────────────────────────────────
  const taxes = computePaycheckTaxes({
    w4,
    payFrequency: input.payFrequency,
    grossWagesCents: input.grossWagesCents,
    // The REAL year-to-date. Passing ZERO_YTD here would mean the Social
    // Security wage base could never be reached, and a high earner would be
    // over-withheld all the way to December.
    ytd: input.ytd,
    hundredthHours: input.hundredthHours,
    stateUnemploymentRateMilliPct: context.stateUnemploymentRateMilliPct,
    sutaRateNoticeDocumentId: context.sutaRateNoticeDocumentId,
    stateContributionsPaidTimely: context.stateContributionsPaidTimely,
    creditReductionMilliPct: context.creditReductionMilliPct,
    // Non-null asserted: the guard above returned already if any was null.
    // Writing `?? 0` here would restore the exact defect the guard prevents.
    pfmlTotalRateMilliPct: context.pfmlTotalRateMilliPct!,
    pfmlEmployerSharePctMilliPct: context.pfmlEmployerSharePctMilliPct!,
    employerHasFewerThan50WaEmployees: context.employerHasFewerThan50WaEmployees,
    waCaresRateMilliPct: context.waCaresRateMilliPct!,
    waCaresExemptionApprovalDocumentId: null,
    employeeClaimsWaCaresExemption: false,
    lniEmployeeRateMilliCentsPerHour: context.lniEmployeeRateMilliCentsPerHour,
    lniEmployerRateMilliCentsPerHour: context.lniEmployerRateMilliCentsPerHour,
    lniRiskClassCode: context.lniRiskClassCode,
    lniRateNoticeDocumentId: context.lniRateNoticeDocumentId,
  });

  // ── 4. Gross to net, in the only order the law permits ────────────────────
  const net = computeNetPay({
    taxes,
    orders: input.orders,
    wages: context.wages,
    workweeksInPeriod: input.workweeksInPeriod,
    voluntaryDeductions: input.voluntaryDeductions,
  });

  if (!net.ok) {
    return blocked(
      net.refusals.map((r: NetPayRefusal) => ({
        code: "ENGINE_REFUSED" as const,
        message: r.message,
        whatToDo: r.whatToDo,
      })),
    );
  }

  const breakdown = net.value;

  // ── 5. Re-add the parts (rule: run it, do not assert it) ──────────────────
  // Two compensating errors produce a correct-looking net pay with a wrong
  // garnishment remittance behind it. The only way to see that is to re-add.
  const recon = netPayReconciles(breakdown);
  if (!recon.balanced) {
    return blocked(
      [
        {
          code: "DOES_NOT_RECONCILE",
          message:
            `${input.employeeName}'s cheque does not re-add to itself: ${recon.explanation} ` +
            `This is a software fault, not a data problem, and no cheque should be issued ` +
            `from it.`,
          whatToDo:
            "Do not pay this run. Send this screen to whoever maintains the system — the " +
            "difference above names the exact amount that is unaccounted for.",
        },
      ],
      [recon.explanation],
    );
  }

  // ── 6. Things worth saying about a cheque that IS payable ─────────────────
  if (breakdown.totalGarnishedCents > 0) {
    attentionNotes.push(
      `${money(breakdown.totalGarnishedCents)} was withheld under a court order. Washington ` +
        `requires withheld support to be delivered within five working days of the pay ` +
        `interval (RCW 26.18.110(2)), so this remittance has a clock on it starting today.`,
    );
  }

  if (breakdown.netPayCents === 0 && input.grossWagesCents > 0) {
    attentionNotes.push(
      "This cheque is zero. That can be lawful — a heavily garnished employee with other " +
        "deductions can net nothing — but it is worth confirming before it goes out, because " +
        "a zero cheque is also what a data error looks like.",
    );
  }

  const status: PayRunLineStatus = attentionNotes.length > 0 ? "attention" : "ready";

  return {
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    status,
    breakdown,
    taxes,
    w4Provenance: provenance,
    refusals: [],
    attentionNotes,
    engineNotes: breakdown.notes,
    netPayCents: breakdown.netPayCents,
    grossWagesCents: breakdown.grossWagesCents,
    totalGarnishedCents: breakdown.totalGarnishedCents,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 6) THE WHOLE RUN
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Compute every line, then say in one sentence what to do next.
 *
 * PROPOSES. WRITES NOTHING. Standing rule 63c: automatic, with an approval
 * gate. This function is the automatic half. Michael reads it and decides.
 */
export function computePayRun(args: {
  readonly context: PayRunContext;
  readonly employees: readonly PayRunEmployeeInput[];
}): PayRunResult {
  const { context, employees } = args;

  const lines = employees.map((input) => computePayRunLine({ input, context }));

  const readyCount = lines.filter((l) => l.status === "ready").length;
  const attentionCount = lines.filter((l) => l.status === "attention").length;
  const blockedCount = lines.filter((l) => l.status === "blocked").length;

  const payable = lines.filter((l) => l.netPayCents !== null);
  const totalNetPayCents = payable.reduce((s, l) => s + (l.netPayCents ?? 0), 0);
  const totalGrossWagesCents = payable.reduce((s, l) => s + (l.grossWagesCents ?? 0), 0);
  const totalGarnishedCents = lines.reduce((s, l) => s + l.totalGarnishedCents, 0);

  const canPay = blockedCount === 0 && lines.length > 0;

  // The summary NAMES the next action. "3 issues found" is a status; "fix
  // these two people's timesheets, then approve" is an instruction.
  let summary: string;
  if (lines.length === 0) {
    summary =
      "There is nobody to pay in this period. Either no employees are active, or the pay " +
      "period has no approved timesheet yet.";
  } else if (blockedCount > 0) {
    const names = lines
      .filter((l) => l.status === "blocked")
      .map((l) => l.employeeName)
      .join(", ");
    summary =
      `${blockedCount} of ${lines.length} cannot be paid yet: ${names}. Nothing will be paid ` +
      `until they are fixed — a payroll that leaves somebody out is discovered by that person ` +
      `on payday. Each blocked card below says exactly what is missing and where to fix it.`;
  } else if (attentionCount > 0) {
    summary =
      `All ${lines.length} cheques computed and total ${money(totalNetPayCents)}. ` +
      `${attentionCount} need${attentionCount === 1 ? "s" : ""} your attention before you ` +
      `approve — those cheques are correct and payable, but something behind them should be ` +
      `fixed. Read the amber cards, then approve.`;
  } else {
    summary =
      `All ${lines.length} cheques computed cleanly and total ${money(totalNetPayCents)}. ` +
      `Nothing needs fixing. Check the totals against your expectation, then approve.`;
  }

  return {
    payDateIso: context.payDateIso,
    lines,
    readyCount,
    attentionCount,
    blockedCount,
    totalNetPayCents,
    totalGrossWagesCents,
    totalGarnishedCents,
    canPay,
    summary,
  };
}
