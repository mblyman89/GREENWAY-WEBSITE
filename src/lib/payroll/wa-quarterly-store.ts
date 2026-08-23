/**
 * src/lib/payroll/wa-quarterly-store.ts   (books-41)
 *
 * THE JOIN FOR THE WASHINGTON QUARTERLY RETURNS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `wa-quarterly-core.ts` can build all four Washington returns from a list of
 * people, their quarterly wages and their hours. It is pure, it is mutation
 * tested, and it has been proved against a return the State actually accepted.
 * What it cannot do is find out who was paid at Greenway between 1 April and
 * 30 June. That is this file's job.
 *
 * It reads the pay runs whose PAY DATE falls inside the quarter, pulls the
 * Washington columns migration 0199 added to `payroll_run_lines`, and hands all
 * of it to `buildWaQuarter`.
 *
 * It performs NO tax arithmetic of its own. Not a rate, not a cap, not a
 * rounding. If this file did its own sums they would eventually disagree with
 * the engine's, silently, on a form that goes to the State.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS THE PAY DATE, AND WHY THAT IS A DIFFERENT ARGUMENT HERE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The 941 store filters on pay date because federal employment tax follows
 * constructive receipt. Washington reaches the same answer by a different road:
 * WAC 192-310-010 requires the report to cover wages PAID in the quarter, and
 * ESD's own instructions define the quarter by payment date. Same filter, same
 * column, and for the L&I return the hours travel with the wages they were paid
 * in rather than the week they were worked.
 *
 * The consequence is worth stating plainly, because it looks wrong the first
 * time: a pay period running 21 June to 4 July, paid on 10 July, is entirely
 * THIRD quarter for every one of these returns, including the L&I hours that
 * were physically worked in June.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FOUR THINGS THIS FILE REFUSES TO INVENT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   1. THE RATES.  This file supplies none. They come from the rate registry,
 *      which knows what was in force on a date and refuses when it does not.
 *      A rate typed into a store file is a rate nobody will ever revise.
 *
 *   2. THE ESD TAXABLE WAGE CAP.  Whether somebody has crossed the annual
 *      unemployment wage base is a YEAR-to-date fact, and a quarter-shaped
 *      read cannot see it. Where the stored taxable column is null this file
 *      reports the line as unusable rather than defaulting taxable to gross -
 *      that default is invisible, and it silently overstates the tax for every
 *      high earner in Q4.
 *
 *   3. THE PFML EMPLOYER SIZE TEST.  RCW 50A.10.030(4) turns on an average
 *      headcount across the preceding period, which is not a fact about this
 *      quarter's pay runs. It is passed through as `null` when unknown so the
 *      engine can raise PFML_SIZE_UNDETERMINED, rather than guessing "small"
 *      and quietly waiving a premium Greenway might owe.
 *
 *   4. A PRE-0199 LINE'S DETAIL.  The Washington columns are nullable with no
 *      default, deliberately (standing rule 62d) - a line written before that
 *      migration genuinely does not know its own hours. Those lines are counted
 *      and reported as `linesMissingWaDetail`, never silently treated as zero.
 *      Treating a missing hour count as zero would understate the L&I premium,
 *      which is charged per hour and on nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOURS ARE STORED IN HUNDREDTHS AND THE RETURN WANTS WHOLE HOURS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `lni_hundredth_hours` is hundredth-hours: 4000 means 40.00 hours. The L&I
 * return is filed in whole hours, and the engine REFUSES a fractional hour
 * rather than rounding one, so the conversion has to happen here and it has to
 * happen ONCE - on the quarter total, never per line.
 *
 * That ordering is not a style preference. Rounding each of thirteen pay
 * periods and then adding can drift several hours away from rounding the sum,
 * and L&I is charged per hour. Summing first is the only way the figure on the
 * return equals the hours actually worked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE WRITES NOTHING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Reading and filing are separate acts. Nothing here inserts, updates or
 * transmits anything, and the screen above it says so in as many words.
 */

import "server-only";

import {
  buildWaQuarter,
  type WaQuarterRates,
  type WaQuarterResult,
  type WaQuarterSubject,
} from "@/lib/payroll/wa-quarterly-core";
import { quarterDateRange, type QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

/* ═══════════════════════════════════════════════════════════════════════════
 * FAILURES - the shape the rest of the payroll layer already uses
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WaQuarterStoreFailureCode = "NOT_CONFIGURED" | "READ_FAILED" | "RATES_UNAVAILABLE";

export type WaQuarterStoreFailure = {
  readonly ok: false;
  readonly code: WaQuarterStoreFailureCode;
  readonly message: string;
};

const NOT_CONFIGURED =
  "The database connection is not configured in this environment, so the Washington quarterly returns cannot be assembled. Nothing is wrong with your books - this screen simply has nothing to read from here.";

/**
 * The columns the Washington returns need off a pay run line.
 *
 * Named as a constant so every read in this file uses the same list and they
 * cannot drift apart. Standing rule 25.
 */
const RUN_LINE_WA_COLUMNS =
  "run_id, employee_id, employee_name, gross_pay_cents, wa_suta_wages_cents, wa_pfml_wages_cents, lni_hundredth_hours" as const;

type RunRow = {
  readonly id: string;
  readonly pay_date: string;
  readonly status: string;
  readonly label: string | null;
};

type LineRow = {
  readonly run_id: string;
  readonly employee_id: string | null;
  readonly employee_name: string;
  readonly gross_pay_cents: number | null;
  readonly wa_suta_wages_cents: number | null;
  readonly wa_pfml_wages_cents: number | null;
  readonly lni_hundredth_hours: number | null;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE SCREEN GETS BACK
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WaQuarterLoaded = {
  readonly ok: true;
  readonly quarter: QuarterRef;
  /** Whatever the engine said - four finished returns, or a list of refusals. */
  readonly result: WaQuarterResult;
  /** How many pay runs fed this quarter. Zero is a legitimate answer. */
  readonly runCount: number;
  /** The pay dates that fed it, so Michael can tick them off against his diary. */
  readonly payDates: readonly string[];
  /**
   * Lines that predate migration 0199 and therefore do not know their own
   * Washington detail. Excluded from the returns and reported, never zeroed.
   */
  readonly linesMissingWaDetail: number;
  /** Runs excluded because they were voided. Shown so the count reconciles. */
  readonly voidedRunsExcluded: number;
  /**
   * The quarter's hours before conversion, in hundredths.
   *
   * Reported so the screen can show that the whole-hour figure on the return
   * came from summing and then converting, rather than from thirteen separate
   * roundings. When this is not a whole number of hours the engine will have
   * refused, and this is the number that explains why.
   */
  readonly totalHundredthHours: number;
};

export type WaQuarterLoadResult = WaQuarterLoaded | WaQuarterStoreFailure;

/* ═══════════════════════════════════════════════════════════════════════════
 * SMALL HELPERS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Does this line know everything the Washington returns need from it?
 *
 * Gross pay alone is not enough. The unemployment and Paid Leave taxable
 * figures are separate columns because the two programmes have DIFFERENT wage
 * bases, and the hour count is a separate column again because L&I is charged
 * on hours and not on money at all. A line missing any of the three cannot be
 * placed on these returns, and saying so is the whole point.
 */
function usable(line: LineRow): boolean {
  return (
    line.gross_pay_cents !== null &&
    line.wa_suta_wages_cents !== null &&
    line.wa_pfml_wages_cents !== null &&
    line.lni_hundredth_hours !== null
  );
}

/** A value off a column already proved non-null by `usable`. */
function num(v: number | null): number {
  return typeof v === "number" ? v : 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE READ
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Assemble the quarter's Washington returns from what is actually in the
 * database.
 *
 * The steps, in order, and why each one is where it is:
 *
 *   1. Find the runs whose PAY DATE lands in the quarter. Voided runs are
 *      dropped and counted - a voided run is not a correction, it is a run
 *      that never happened, and including it would overstate every line.
 *   2. Read their lines. Lines without the Washington detail are dropped and
 *      counted, never zeroed.
 *   3. Sum per employee - the ONLY arithmetic in this file, and it is addition
 *      of stored figures, not tax computation.
 *   4. Convert the quarter's hours ONCE, after summing.
 *   5. Hand it to the engine and return whatever the engine says.
 *
 * `rates` is a parameter rather than a lookup. The registry is the one thing
 * that knows what was in force on a date, it refuses when it does not know, and
 * a store that quietly reached for a default rate would defeat that refusal.
 */
export async function loadWaQuarter(
  quarter: QuarterRef,
  rates: WaQuarterRates,
  pfml: { employerOwesEmployerShare: boolean; determinedAverageHeadcount: number | null },
): Promise<WaQuarterLoadResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  const admin = createSupabaseAdminClient();
  const range = quarterDateRange(quarter);

  /* ── 1. the runs, BY PAY DATE ─────────────────────────────────────────── */

  const { data: runData, error: runError } = await admin
    .from("payroll_runs")
    .select("id, pay_date, status, label")
    .gte("pay_date", range.start)
    .lte("pay_date", range.end)
    .order("pay_date", { ascending: true });

  if (runError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the pay runs for this quarter: ${runError.message}. The returns cannot be assembled without them, and a partial return is worse than none.`,
    };
  }

  const allRuns = (runData ?? []) as unknown as RunRow[];
  const runs = allRuns.filter((r) => r.status !== "void");
  const voidedRunsExcluded = allRuns.length - runs.length;

  /* ── 2. the lines ─────────────────────────────────────────────────────── */

  const runIds = runs.map((r) => r.id);
  let lines: LineRow[] = [];

  if (runIds.length > 0) {
    const { data: lineData, error: lineError } = await admin
      .from("payroll_run_lines")
      .select(RUN_LINE_WA_COLUMNS)
      .in("run_id", runIds);

    if (lineError) {
      return {
        ok: false,
        code: "READ_FAILED",
        message: `Could not read the pay run lines for this quarter: ${lineError.message}. The returns cannot be assembled without them.`,
      };
    }
    lines = (lineData ?? []) as unknown as LineRow[];
  }

  const usableLines = lines.filter(usable);
  const linesMissingWaDetail = lines.length - usableLines.length;

  /* ── 3. sum per person ────────────────────────────────────────────────── */

  type Bucket = {
    displayName: string;
    wagesCents: number;
    esdTaxableWagesCents: number;
    pfmlTaxableWagesCents: number;
    hundredthHours: number;
  };

  const buckets = new Map<string, Bucket>();

  for (const l of usableLines) {
    const key = l.employee_id ?? l.employee_name;
    const existing = buckets.get(key);
    const add: Bucket = {
      displayName: l.employee_name,
      wagesCents: num(l.gross_pay_cents),
      esdTaxableWagesCents: num(l.wa_suta_wages_cents),
      pfmlTaxableWagesCents: num(l.wa_pfml_wages_cents),
      hundredthHours: num(l.lni_hundredth_hours),
    };
    buckets.set(
      key,
      existing
        ? {
            displayName: existing.displayName,
            wagesCents: existing.wagesCents + add.wagesCents,
            esdTaxableWagesCents: existing.esdTaxableWagesCents + add.esdTaxableWagesCents,
            pfmlTaxableWagesCents: existing.pfmlTaxableWagesCents + add.pfmlTaxableWagesCents,
            hundredthHours: existing.hundredthHours + add.hundredthHours,
          }
        : add,
    );
  }

  /* ── 4. convert hours ONCE, per person, after summing ─────────────────── */

  const totalHundredthHours = [...buckets.values()].reduce((a, b) => a + b.hundredthHours, 0);

  const subjects: WaQuarterSubject[] = [...buckets.entries()].map(([subjectId, b]) => ({
    subjectId,
    displayName: b.displayName,
    wagesCents: b.wagesCents,
    esdTaxableWagesCents: b.esdTaxableWagesCents,
    pfmlTaxableWagesCents: b.pfmlTaxableWagesCents,
    // Divided once, on the person's quarter total. If the result is fractional
    // the engine raises FRACTIONAL_HOURS and Michael is told which timesheet to
    // look at - which is a better outcome than a silently rounded hour on a
    // premium that is assessed per hour.
    hours: b.hundredthHours / 100,
  }));

  /* ── 5. the engine decides ────────────────────────────────────────────── */

  const result = buildWaQuarter({
    quarter,
    subjects,
    rates,
    pfml: {
      employerOwesEmployerShare: pfml.employerOwesEmployerShare,
      determinedAverageHeadcount: pfml.determinedAverageHeadcount,
    },
  });

  return {
    ok: true,
    quarter,
    result,
    runCount: runs.length,
    payDates: runs.map((r) => r.pay_date),
    linesMissingWaDetail,
    voidedRunsExcluded,
    totalHundredthHours,
  };
}
