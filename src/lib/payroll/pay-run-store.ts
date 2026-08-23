/**
 * src/lib/payroll/pay-run-store.ts   (books-39 phase E)
 *
 * THE JOIN. This is the file that makes a real paycheque computable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS ACTUALLY WRONG BEFORE THIS FILE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every part of a paycheque already existed, was tested, and was correct:
 *
 *   computeTimesheetForPeriod   hours and gross, from real punches
 *   computePaycheckTaxes        federal, FICA, SUTA, PFML, WA Cares, L&I
 *   computeNetPay               garnishments, voluntary deductions, the floor
 *   loadYtdForEmployee          the wage bases the ceilings depend on
 *   toWageOrder                 court orders, in the shape the engine wants
 *   payRunRatesOn               the eleven evidenced rates
 *
 * And `computeNetPay` was called in exactly ONE place in the entire codebase -
 * net-pay-ui-core.ts, inside `buildNetPayWorkedExample`. An ILLUSTRATION. A
 * teaching aid built from a hand-made scenario. No real employee ever went
 * through it.
 *
 * What actually produced Michael's numbers was this, in the payroll action:
 *
 *     dollarsToCents(String(formData.get(`net_${id}`) ?? ""))
 *
 * A net figure TYPED IN BY HAND. Everything downstream - the journal entry, the
 * 941 worksheet, the W-2 accumulators - was arithmetic performed on a number
 * somebody keyed. The engines were a very well-tested ornament.
 *
 * This file is the join. It reads the five sources, hands them to the pure
 * `computePayRun`, and returns what it says. It performs NO arithmetic of its
 * own - not a percentage, not a cap, not a rounding. Every figure Michael sees
 * came out of a module that has been mutation-tested against the statute it
 * encodes. If this file did its own sums they would eventually disagree with
 * the engine's, silently, on somebody's paycheque.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT REFUSES THE WHOLE RUN FOR SOME THINGS AND ONE LINE FOR OTHERS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A missing SUTA rate is not one employee's problem - it is wrong for everyone,
 * so the run stops. A missing W-4 IS one employee's problem, and the CFR says
 * exactly what to do about it, so that line computes and gets flagged. Merging
 * those two would either block a payday over one person's paperwork or bury a
 * firm-wide rate gap inside a list of per-employee notes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * It does not WRITE. Nothing here inserts a payroll run, posts a journal entry,
 * or touches the YTD accumulators. Computing and committing are separate acts
 * and they are separated here on purpose: Michael must be able to look at a
 * whole run, employee by employee, and decide - before anything is recorded.
 * The write path is a later slice and it will start from what this returns.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import {
  computePayRun,
  yearOfDayKey,
  type PayRunContext,
  type PayRunEmployeeInput,
  type PayRunResult,
} from "@/lib/payroll/pay-run-core";
import {
  loadCurrentW4s,
  loadPayFrequencies,
} from "@/lib/payroll/payroll-onboarding-store";
import { toWageOrder, type WageOrderRow } from "@/lib/payroll/garnishment-store";
import { payRunRatesOn, type MissingRate } from "@/lib/payroll/net-pay-ui-core";
import { computeTimesheetForPeriod, loadPayPeriod } from "@/lib/payroll/timesheet-store";
import { loadYtdForEmployee } from "@/lib/payroll/ytd-store";
import { emptyAccumulator } from "@/lib/payroll/ytd-core";
import type { WageOrder } from "@/lib/payroll/garnishment-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * WHAT COMES BACK
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Why the whole run could not be computed.
 *
 * Every code here is a FIRM-WIDE condition. A problem with one employee never
 * produces one of these - it becomes a blocked line inside the result, with
 * that person's name on it.
 */
export type PayRunStoreFailureCode =
  /** No database connection configured on this server. */
  | "NOT_CONFIGURED"
  /** A read failed. Never confused with "the read returned nothing". */
  | "READ_FAILED"
  /** The pay period id does not exist. */
  | "NO_SUCH_PERIOD"
  /** One or more rates have no evidenced row covering the pay date. */
  | "RATES_NOT_ON_FILE";

export type PayRunStoreFailure = {
  readonly ok: false;
  readonly code: PayRunStoreFailureCode;
  /** Plain English. Shown to Michael verbatim. */
  readonly message: string;
  /** The next physical action. Never "contact support". */
  readonly whatToDo: string;
  /** Populated for RATES_NOT_ON_FILE, so the screen can name each gap. */
  readonly missingRates: readonly MissingRate[];
};

export type PayRunLoaded = {
  readonly ok: true;
  readonly periodLabel: string;
  readonly periodStartDate: string;
  readonly periodEndDate: string;
  readonly payDateIso: string;
  readonly periodStatus: "planned" | "approved" | "locked";
  readonly result: PayRunResult;
  /**
   * Employees whose stored W-4 row exists but could not be read, BY NAME.
   *
   * Kept separate from "has no W-4". Those two look identical on a screen and
   * are opposite problems: one is a new hire who needs to fill in a form, the
   * other is a corrupted row that needs a database look. Folding them together
   * would send a corrupted record quietly down the statutory-default path.
   */
  readonly unreadableW4EmployeeIds: readonly string[];
};

export type PayRunLoadResult = PayRunLoaded | PayRunStoreFailure;

const fail = (
  code: PayRunStoreFailureCode,
  message: string,
  whatToDo: string,
  missingRates: readonly MissingRate[] = [],
): PayRunStoreFailure => ({ ok: false, code, message, whatToDo, missingRates });

/* ═══════════════════════════════════════════════════════════════════════════
 * HELPERS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * How many workweeks the pay period covers.
 *
 * NOT a constant, and not `days / 7`. Garnishment ceilings are measured PER
 * WORKWEEK - 15 U.S.C. 1673(a) caps the take at 25% of disposable earnings for
 * a workweek, and the protected floor is a multiple of the weekly minimum wage.
 * Feed the engine the wrong number of workweeks and the ceiling for a biweekly
 * cheque is computed as though it covered one week, which under-protects the
 * employee by half.
 *
 * The timesheet engine already split the period into workweek buckets using
 * Greenway's configured workweek anchor, so the count is READ FROM THOSE
 * BUCKETS rather than derived from the calendar. That way it stays correct when
 * a period boundary cuts a workweek in half, which the buckets flag and a
 * division would not notice.
 *
 * Returns null when there are no buckets to count. The caller refuses; it does
 * not substitute 2 (standing rule 62d).
 */
export function workweeksFromBuckets(bucketCount: number): number | null {
  return bucketCount > 0 ? bucketCount : null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE READ
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Compute an entire pay run for a period, from the real database.
 *
 * Reads nothing it does not need and writes nothing at all.
 */
export async function loadPayRun(periodId: string): Promise<PayRunLoadResult> {
  if (!isSupabaseServiceConfigured) {
    return fail(
      "NOT_CONFIGURED",
      "The database connection is not configured on this server, so no pay run can be read.",
      "This is a server setup problem rather than anything to do with payroll. " +
        "Nothing has been calculated and nothing has been saved.",
    );
  }

  // ── 1. the period ────────────────────────────────────────────────────────
  const periodRes = await loadPayPeriod(periodId);
  if (!periodRes.ok) {
    return fail(
      periodRes.code === "NOT_FOUND" ? "NO_SUCH_PERIOD" : "READ_FAILED",
      periodRes.message,
      "Pick a pay period from the payroll calendar and try again. Nothing was calculated.",
    );
  }
  const period = periodRes.period;
  const payDateIso = period.pay_date;

  /*
   * ── 2. the rates ───────────────────────────────────────────────────────
   *
   * BEFORE the employees, and that ordering is deliberate. If a rate is not on
   * file, no cheque dated this day can be computed for ANYBODY, so reading
   * thirty employees first would be work thrown away - and, worse, it would
   * tempt a future maintainer to show the roster with the rate gap as a footnote
   * underneath it. A firm-wide gap is a stop, not a footnote.
   */
  const { context, missingRates } = payRunRatesOn(payDateIso);
  if (missingRates.length > 0) {
    return fail(
      "RATES_NOT_ON_FILE",
      `${missingRates.length} rate${missingRates.length === 1 ? "" : "s"} needed for a ` +
        `${payDateIso} paycheque ${missingRates.length === 1 ? "is" : "are"} not on file: ` +
        `${missingRates.map((r) => r.label).join(", ")}. No pay can be calculated for this ` +
        `date until each one is entered with the notice it came from. The system refuses ` +
        `rather than reusing last year's figure, because a stale rate produces a paycheque ` +
        `that looks perfectly normal and is wrong.`,
      "Open Payroll → Rates and add each rate above, attaching the agency notice it came " +
        "from. Then come back to this pay period. Nothing has been calculated or saved.",
      missingRates,
    );
  }

  // ── 3. the timesheet: hours and gross, per employee ──────────────────────
  const timesheet = await computeTimesheetForPeriod(periodId);
  if (!timesheet.ok) {
    return fail(
      "READ_FAILED",
      `The hours for this period could not be computed, so no pay can be: ${timesheet.message}`,
      "Fix the problem above on the timesheet screen, then return here. " +
        "Nothing has been calculated or saved.",
    );
  }

  const employeeIds = timesheet.sheets.map((s) => s.employee.employeeId);

  // ── 4. W-4s, pay frequencies, and court orders ───────────────────────────
  const [w4s, frequencies, orders] = await Promise.all([
    loadCurrentW4s(employeeIds),
    loadPayFrequencies(employeeIds),
    loadActiveOrdersByEmployee(employeeIds),
  ]);

  /*
   * A FAILED READ IS NOT AN EMPTY RESULT.
   *
   * This is the single most dangerous confusion available in this file. If a
   * broken W-4 read were treated as "nobody has a W-4", every employee would
   * take the statutory-default path - which is a legal, arithmetically valid
   * calculation - and the run would produce a complete set of confident, wrong
   * paycheques with no error shown anywhere. Standing rule 46.
   */
  for (const [what, why] of [
    ["W-4 records", w4s.readFailed],
    ["pay records", frequencies.readFailed],
    ["wage orders", orders.readFailed],
  ] as const) {
    if (why !== null) {
      return fail(
        "READ_FAILED",
        `The ${what} could not be read, so no pay can be calculated: ${why}`,
        "This is a database problem rather than a payroll one. Nothing has been " +
          "calculated and nothing has been saved.",
      );
    }
  }

  // ── 5. year-to-date, per employee ────────────────────────────────────────
  /*
   * Read one employee at a time because that is the seam ytd-store exposes,
   * and read it for the CALENDAR YEAR OF THE PAY DATE - not the period end.
   * Every ceiling in this domain (the Social Security wage base, the SUTA wage
   * base, the additional-Medicare threshold) is defined on the year wages are
   * PAID. A period that ends 31 December and pays 8 January belongs to the new
   * year, and using the period's year would restart the wage bases a fortnight
   * early and under-withhold every high earner.
   */
  const taxYear = yearOfDayKey(payDateIso);
  const ytdByEmployee = new Map<string, ReturnType<typeof emptyAccumulator>>();
  for (const id of employeeIds) {
    const res = await loadYtdForEmployee(id, taxYear);
    if (!res.ok) {
      return fail(
        "READ_FAILED",
        `The ${taxYear} year-to-date totals could not be read, so no pay can be ` +
          `calculated: ${res.message}`,
        "Year-to-date totals decide when the Social Security wage base stops applying. " +
          "Calculating without them would over-withhold anyone who has already crossed it. " +
          "Nothing has been calculated or saved.",
      );
    }
    ytdByEmployee.set(id, res.value);
  }

  // ── 6. assemble, and let the pure engine decide ──────────────────────────
  const unreadableW4EmployeeIds = [...w4s.unreadable];

  const inputs: PayRunEmployeeInput[] = timesheet.sheets.map((sheet) => {
    const id = sheet.employee.employeeId;
    const hours = sheet.hours;
    const ytd = ytdByEmployee.get(id) ?? emptyAccumulator(id, taxYear);

    /*
     * The workweek count comes from THIS EMPLOYEE'S buckets. It is not shared
     * across the run, because an employee hired mid-period has fewer buckets
     * than one who worked throughout, and their garnishment ceiling is measured
     * over the weeks they actually worked.
     */
    const workweeks = hours === null ? null : workweeksFromBuckets(hours.weeks.length);

    return {
      employeeId: id,
      employeeName: sheet.employee.fullName,
      grossWagesCents: hours?.grossCents ?? null,
      hundredthHours: hours?.totalHundredthHours ?? null,
      // Carried through verbatim. The timesheet engine already explained itself
      // in Michael's language; rewording it here would produce two different
      // sentences for one problem.
      timesheetRefusals: sheet.refusals.map((r) => r.message),
      w4OnFile: w4s.byEmployeeId.get(id) ?? null,
      /*
       * NULL, NEVER "biweekly".
       *
       * The first version of this file wrote `?? "biweekly"` here, directly
       * underneath a comment insisting it did not default. tsc was perfectly
       * happy, because `payFrequency` was typed as non-nullable, so the `??`
       * was REQUIRED to compile - the type was quietly demanding the invention.
       *
       * It matters at Greenway specifically: the staff are biweekly (26) and
       * Michael is paid annually (1). An owner cheque computed on 26 periods
       * annualises his salary twenty-six times over, lands in the top bracket,
       * and withholds an enormous, entirely plausible-looking figure.
       *
       * The fix was to make the ENGINE's field nullable and add the
       * NO_PAY_FREQUENCY refusal, so the type system now forbids the shortcut
       * rather than requiring it.
       */
      payFrequency: frequencies.byEmployeeId.get(id) ?? null,
      ytd: ytd.wages,
      orders: orders.byEmployeeId.get(id) ?? [],
      /*
       * VOLUNTARY DEDUCTIONS ARE EMPTY, AND THAT IS A REAL GAP, NOT A CHOICE.
       *
       * There is no table for them yet. An empty list is the honest reading of
       * "nothing is on file" - Greenway runs none today - but the moment
       * Michael sets up a health-premium or 401(k) deduction, this line becomes
       * a silent omission that overstates take-home pay. It is written down in
       * the owner report as outstanding rather than left to be discovered.
       */
      voluntaryDeductions: [],
      // Refused below by the engine when null, via the NO_HOURS path.
      workweeksInPeriod: workweeks ?? 0,
    };
  });

  const result = computePayRun({ context, employees: inputs });

  return {
    ok: true,
    periodLabel: period.label,
    periodStartDate: period.start_date,
    periodEndDate: period.end_date,
    payDateIso,
    periodStatus: period.status,
    result,
    unreadableW4EmployeeIds,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * COURT ORDERS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Active wage orders for these employees, grouped by employee.
 *
 * Uses `toWageOrder` from garnishment-store - the SAME converter the
 * garnishments screen uses. A second converter here would be a second answer to
 * "how much comes out of this cheque", and the two would surface as the
 * garnishments board and the paycheque disagreeing about somebody's child
 * support. Standing rule 25.
 *
 * SUSPENDED AND TERMINATED ORDERS ARE EXCLUDED, deliberately and for an
 * asymmetric reason: withholding on a released order is a conversion of the
 * employee's wages, and the money has already gone to somebody not entitled to
 * it. That is a worse error than failing to withhold, which is recoverable.
 */
async function loadActiveOrdersByEmployee(employeeIds: readonly string[]): Promise<{
  readonly byEmployeeId: ReadonlyMap<string, readonly WageOrder[]>;
  readonly readFailed: string | null;
}> {
  const empty = { byEmployeeId: new Map<string, readonly WageOrder[]>(), readFailed: null };
  if (employeeIds.length === 0) return empty;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("wage_orders")
    .select(
      "id, employee_id, order_kind, case_number, issuing_authority, order_date, payee_name, " +
        "payee_address, remittance_instructions, amount_cents_per_period, " +
        "percent_of_disposable_basis_points, arrears_cents, arrears_over_twelve_weeks, " +
        "supports_second_family, priority, effective_from, effective_to, status, notes",
    )
    .in("employee_id", employeeIds)
    .eq("status", "active")
    // Priority order matters: 15 U.S.C. 1673(b)(2) pays support before other
    // orders, and the engine applies the ceiling in the order it receives them.
    .order("priority", { ascending: true });

  if (error) {
    return { ...empty, readFailed: `Could not read the wage orders: ${error.message}` };
  }

  const byEmployeeId = new Map<string, WageOrder[]>();
  for (const row of (data ?? []) as unknown as WageOrderRow[]) {
    const order = toWageOrder(row);
    /*
     * `toWageOrder` returns null for an order kind the engine cannot price. It
     * is skipped rather than guessed at - but note that this is exactly the
     * kind of silent exclusion that hides money, so the garnishments board
     * counts and displays those orders separately. A kind the engine does not
     * know is a gap in the engine, and it is visible there rather than here.
     */
    if (order === null) continue;
    const list = byEmployeeId.get(row.employee_id);
    if (list === undefined) byEmployeeId.set(row.employee_id, [order]);
    else list.push(order);
  }
  return { byEmployeeId, readFailed: null };
}

export type { PayRunContext, PayRunResult };
