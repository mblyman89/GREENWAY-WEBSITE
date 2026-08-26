/**
 * src/lib/payroll/form-941-schedule-b-core.ts   (books-62)
 *
 * Schedule B (Form 941): the DAILY federal tax liability of a semiweekly
 * schedule depositor. Michael: "I am a schedule b filer, so we don't need to
 * compute the monthly payment."
 *
 * The trap this whole file exists for is D-05: liability summed from the
 * payroll lines does NOT equal line 12, because the 941 rounds each levy ONCE
 * on the quarter's aggregate wage base while payroll rounded it on every
 * cheque. The gap is the fractions-of-cents residual line 7 carries, and the
 * IRS is explicit that Schedule B must tie:
 *
 *   "Your total liability for the quarter must equal line 12 on Form 941."
 *   - Instructions for Schedule B (Form 941) (Rev. 6-2025)
 */

import {
  MEDICARE_COMBINED_MILLI_PCT,
  MEDICARE_EMPLOYEE_MILLI_PCT,
  OASDI_COMBINED_MILLI_PCT,
  OASDI_EMPLOYEE_MILLI_PCT,
} from "./form-941-core";
import { applyMilliPct } from "./payroll-withholding-core";
import { formatCents, type QuarterRef } from "./payroll-deposit-schedule-core";

/**
 * One payday, with the withheld figures as the cheques actually came out.
 *
 * `payDate` is an ISO date, and it is the date WAGES WERE PAID - not the period
 * end, not the deposit due date. The IRS: "Write your daily tax liability on
 * the numbered space that corresponds to the date wages were paid."
 */
export type ScheduleBPayday = {
  readonly payDate: string;
  /** Federal income tax withheld on this payday. */
  readonly federalIncomeTaxCents: number;
  /** OASDI + Medicare + Additional Medicare withheld from employees. */
  readonly employeeFicaWithheldCents: number;
  /** The OASDI wage base this payday contributed. */
  readonly oasdiWagesCents: number;
  /** The Medicare wage base this payday contributed. */
  readonly medicareWagesCents: number;
};

export type ScheduleBDay = {
  /** 1-3, the quarter's month, as Schedule B numbers its blocks. */
  readonly month: 1 | 2 | 3;
  /** 1-31, the printed numbered space. */
  readonly day: number;
  readonly payDate: string;
  readonly liabilityCents: number;
};

export type ScheduleB = {
  readonly ok: true;
  readonly quarter: QuarterRef;
  readonly days: readonly ScheduleBDay[];
  /** Index 0 is month 1. Always length 3, zeros included. */
  readonly monthTotalsCents: readonly [number, number, number];
  readonly quarterTotalCents: number;
  /**
   * The fractions-of-cents residual, spread across paydays.
   *
   * Surfaced rather than hidden because it is the ONLY reason the daily figures
   * are not a plain sum of the payroll lines, and a reader comparing our
   * Schedule B against his own spreadsheet needs to know it exists.
   */
  readonly roundingSpreadCents: number;
  readonly plain: string;
};

export type ScheduleBRefused = {
  readonly ok: false;
  readonly reason:
    | "no_paydays"
    | "pay_date_outside_quarter"
    | "does_not_reconcile"
    | "negative_liability";
  readonly explanation: string;
};

export type ScheduleBResult = ScheduleB | ScheduleBRefused;

/** The three calendar months of a quarter, 1-based. */
function monthsOf(q: QuarterRef): readonly [number, number, number] {
  const first = (q.quarter - 1) * 3 + 1;
  return [first, first + 1, first + 2];
}

/**
 * Build Schedule B, or refuse.
 *
 * `line12Cents` is passed IN rather than recomputed, so this function cannot
 * disagree with the return it is attached to. It is the anchor the whole
 * schedule is reconciled against.
 */
export function scheduleBLiability(args: {
  readonly quarter: QuarterRef;
  readonly paydays: readonly ScheduleBPayday[];
  readonly line12Cents: number;
}): ScheduleBResult {
  const { quarter, paydays, line12Cents } = args;

  if (paydays.length === 0) {
    return {
      ok: false,
      reason: "no_paydays",
      explanation:
        `No wages were paid in ${quarter.year} Q${quarter.quarter}, so there is no daily ` +
        `liability to report. An all-zero Schedule B would state to the IRS that this ` +
        `business paid nobody, which is a claim rather than an absence of data.`,
    };
  }

  const months = monthsOf(quarter);

  /*
   * Every payday must land in this quarter's three months. A pay date one day
   * outside would silently vanish from the grid (no numbered space to hold it)
   * and the schedule would still add up down every column while understating
   * the quarter.
   */
  const placed: { month: 1 | 2 | 3; day: number; p: ScheduleBPayday }[] = [];
  for (const p of paydays) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.payDate);
    if (m === null) {
      return {
        ok: false,
        reason: "pay_date_outside_quarter",
        explanation:
          `Pay date "${p.payDate}" is not an ISO date. Schedule B reports liability on the ` +
          `numbered space matching the date wages were paid, so an unreadable date has ` +
          `nowhere to land.`,
      };
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const index = months.indexOf(month);
    if (year !== quarter.year || index === -1) {
      return {
        ok: false,
        reason: "pay_date_outside_quarter",
        explanation:
          `Pay date ${p.payDate} is outside ${quarter.year} Q${quarter.quarter}, which covers ` +
          `months ${months.join(", ")} of ${quarter.year}. Schedule B has no numbered space ` +
          `for it, so including it would drop the figure while the columns still added up.`,
      };
    }
    placed.push({ month: (index + 1) as 1 | 2 | 3, day, p });
  }

  /*
   * ═══ THE RECONCILIATION, WHICH IS THE WHOLE POINT ═══
   *
   * The employer share is taken as the RESIDUAL the 941 itself implies:
   *
   *     employer share = (line 5a + line 5c) - employee FICA at statutory rate
   *
   * not as a re-rounding of each payday's wage base. Both halves are computed
   * from the SAME aggregate the 941 used, so the total is exact by
   * construction. Re-rounding per payday would reintroduce D-05.
   */
  const oasdiBase = paydays.reduce((a, p) => a + p.oasdiWagesCents, 0);
  const medicareBase = paydays.reduce((a, p) => a + p.medicareWagesCents, 0);
  const combined =
    applyMilliPct(oasdiBase, OASDI_COMBINED_MILLI_PCT) +
    applyMilliPct(medicareBase, MEDICARE_COMBINED_MILLI_PCT);
  const employeeByRate =
    applyMilliPct(oasdiBase, OASDI_EMPLOYEE_MILLI_PCT) +
    applyMilliPct(medicareBase, MEDICARE_EMPLOYEE_MILLI_PCT);
  const employerShare = combined - employeeByRate;

  /*
   * Each payday carries what actually came off the cheques - the figures a
   * bank statement would show - plus its slice of the employer share.
   *
   * The employer share is apportioned by OASDI+Medicare wage base using
   * LARGEST REMAINDER, so the slices are whole cents that sum to the residual
   * exactly. Rounding each slice independently would lose or gain cents, which
   * is precisely the failure this file exists to prevent.
   */
  const weights = placed.map((x) => x.p.oasdiWagesCents + x.p.medicareWagesCents);
  const weightTotal = weights.reduce((a, w) => a + w, 0);

  const slices: number[] = weights.map(() => 0);
  if (weightTotal > 0) {
    const exact = weights.map((w) => (employerShare * w) / weightTotal);
    let assigned = 0;
    for (let i = 0; i < slices.length; i += 1) {
      slices[i] = Math.floor(exact[i]);
      assigned += slices[i];
    }
    // Hand the leftover cents to the largest fractional parts, in order.
    const order = exact
      .map((e, i) => ({ i, frac: e - Math.floor(e) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    let leftover = employerShare - assigned;
    for (let k = 0; leftover > 0 && k < order.length; k += 1, leftover -= 1) {
      slices[order[k].i] += 1;
    }
  } else {
    // No wage base at all, so nothing to apportion against. The residual is
    // handed to the LAST payday rather than dropped, and it can only be
    // non-zero if there was FIT-only pay.
    slices[slices.length - 1] += employerShare;
  }

  const days: ScheduleBDay[] = placed.map((x, i) => ({
    month: x.month,
    day: x.day,
    payDate: x.p.payDate,
    liabilityCents: x.p.federalIncomeTaxCents + x.p.employeeFicaWithheldCents + slices[i],
  }));

  /*
   * The IRS forbids a negative entry: "Don't reduce your daily tax liability
   * reported on Schedule B below zero." If one comes out negative the inputs
   * are wrong, and a clamped figure would tie to line 12 while misstating a
   * day - so this refuses instead.
   */
  const negative = days.find((d) => d.liabilityCents < 0);
  if (negative !== undefined) {
    return {
      ok: false,
      reason: "negative_liability",
      explanation:
        `The liability computed for ${negative.payDate} is ${formatCents(negative.liabilityCents)}, ` +
        `which is negative. The IRS instruction is "Don't reduce your daily tax liability ` +
        `reported on Schedule B below zero", and clamping it to zero would make the ` +
        `schedule tie to line 12 while misstating that day. Nothing was produced.`,
    };
  }

  // Two paydays can share one calendar day only if the same date appears twice;
  // the grid has one space per day, so their liability is the SUM.
  const merged = new Map<string, ScheduleBDay>();
  for (const d of days) {
    const key = `${d.month}-${d.day}`;
    const prior = merged.get(key);
    merged.set(
      key,
      prior === undefined
        ? d
        : { ...prior, liabilityCents: prior.liabilityCents + d.liabilityCents },
    );
  }
  const finalDays = [...merged.values()].sort((a, b) => a.month - b.month || a.day - b.day);

  const monthTotals: [number, number, number] = [0, 0, 0];
  for (const d of finalDays) monthTotals[d.month - 1] += d.liabilityCents;
  const quarterTotal = monthTotals[0] + monthTotals[1] + monthTotals[2];

  /*
   * ═══ THE GATE THAT MAKES THIS SAFE TO PRINT ═══
   *
   * Asserted, not assumed. A Schedule B that is a few cents off line 12 is
   * arithmetically self-consistent down every column and produces a notice
   * months later, so it must never leave this function.
   */
  if (quarterTotal !== line12Cents) {
    return {
      ok: false,
      reason: "does_not_reconcile",
      explanation:
        `Schedule B totals ${formatCents(quarterTotal)} but Form 941 line 12 is ` +
        `${formatCents(line12Cents)}, a difference of ` +
        `${formatCents(quarterTotal - line12Cents)}. The IRS requires that "your total ` +
        `liability for the quarter must equal line 12 on Form 941", so nothing is printed. ` +
        `This is a real disagreement between the payroll records and the return, not a ` +
        `rounding artefact, and it needs looking at rather than forcing.`,
    };
  }

  /*
   * How much the reconciliation actually moved.
   *
   * The naive construction rounds the employer match on EACH payday's own wage
   * base; this one takes the residual the 941 implies. The difference is the
   * figure a reader comparing our schedule against a per-payday spreadsheet
   * will see, so it is stated rather than left as a mystery of a few cents.
   *
   * The first version of this line computed `employerShare - (combined -
   * employeeByRate)`, which is algebraically zero - a number that looked like
   * a measurement and could never be anything but 0.
   */
  const naivePerPayday = paydays.reduce(
    (a, p) =>
      a +
      (applyMilliPct(p.oasdiWagesCents, OASDI_COMBINED_MILLI_PCT) -
        applyMilliPct(p.oasdiWagesCents, OASDI_EMPLOYEE_MILLI_PCT)) +
      (applyMilliPct(p.medicareWagesCents, MEDICARE_COMBINED_MILLI_PCT) -
        applyMilliPct(p.medicareWagesCents, MEDICARE_EMPLOYEE_MILLI_PCT)),
    0,
  );
  const roundingSpread = employerShare - naivePerPayday;

  return {
    ok: true,
    quarter,
    days: finalDays,
    monthTotalsCents: monthTotals,
    quarterTotalCents: quarterTotal,
    roundingSpreadCents: roundingSpread,
    plain:
      `${finalDays.length} payday${finalDays.length === 1 ? "" : "s"} in ` +
      `${quarter.year} Q${quarter.quarter}, totalling ${formatCents(quarterTotal)}, which ` +
      `equals line 12 exactly. Each figure is the federal income tax and employee FICA ` +
      `actually withheld on that payday, plus that payday's share of Greenway's own ` +
      `matching FICA.`,
  };
}
