/**
 * comparison-data.ts (Slice 21) — server. Fetches the baseline days a
 * comparison basis asks for, and turns them into one comparison number.
 *
 * The efficiency point, because it matters at 28 days: `SalesReport` already
 * carries a per-day series (`sales.ts:84` `byDay: DayPoint[]`), and
 * `getSalesReport` builds it by seeding EVERY calendar day in the range and
 * then folding orders into it (`sales.ts:284-285`, using `emptyDaySeries` at
 * `:151`). So one call spanning the oldest baseline day to yesterday returns
 * every day we need. The alternative — one call per baseline day — would be 28
 * round trips for the trailing-28 basis and 12 for a day-of-week average, on
 * the owner's landing page, on every load.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CLOSED-DAY RULE, AND WHY IT IS NOT A DETAIL
 *
 * Because `emptyDaySeries` seeds every day at zero, a day the store was SHUT
 * and a day it was open and sold nothing look identical in `byDay`: both are
 * `{ revenueMinorUnits: 0, orders: 0 }`. Averaging those in as real zeros
 * would be actively misleading in two common situations:
 *
 *   - A store closed on Sundays would show a permanent, enormous Sunday
 *     "win" against a baseline of zeros.
 *   - A 12-week day-of-week average reaching back before this system was in
 *     use would average in weeks of zeros and make every ordinary day today
 *     look like a record.
 *
 * The only honest signal available in the data is the ORDER COUNT. A day with
 * zero orders is treated as NO DATA (null) and dropped from the baseline by
 * `combineBaseline`, rather than counted as $0. A day with at least one order
 * is real data, even if its revenue happens to be small.
 *
 * This is a judgement call and it is written down rather than buried: we would
 * rather show a baseline built from fewer days — and SAY it is thinner, via
 * `baselineQualifier` — than show a confident number built from days the store
 * was never open.
 */
import "server-only";

import { safeData } from "@/lib/safe-data";
import { getSalesReport, EMPTY_SALES_REPORT, type SalesReport } from "@/lib/reports/sales";
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import {
  comparisonWindowFor,
  combineBaseline,
  baselineQualifier,
  type ComparisonBasis,
  type ComparisonWindow,
  type BaselineResult,
} from "@/lib/admin/comparison-basis-core";
import { computeDelta, type Delta } from "@/lib/admin/cockpit-core";

/** The four headline measures the cockpit compares. */
export type MeasureKey = "revenue" | "orders" | "units" | "avgOrder";

/** One measure's worth of comparison, ready to render. */
export type MeasureComparison = {
  /** Today's value. */
  current: number;
  /** The baseline value, or null when no baseline day had data. */
  baseline: number | null;
  delta: Delta;
  /** How many baseline days carried data vs how many were asked for. */
  result: BaselineResult;
  /** "" when the baseline is complete, otherwise an honest caveat. */
  qualifier: string;
};

export type ComparisonBundle = {
  window: ComparisonWindow;
  revenue: MeasureComparison;
  orders: MeasureComparison;
  units: MeasureComparison;
  avgOrder: MeasureComparison;
};

/** A day's worth of headline numbers, or null when the store had no orders. */
type DayValues = {
  revenue: number;
  orders: number;
  units: number;
  avgOrder: number;
} | null;

function zeroComparison(): MeasureComparison {
  const result: BaselineResult = { value: null, daysWithData: 0, daysRequested: 0, partial: false };
  return {
    current: 0,
    baseline: null,
    delta: { change: 0, pct: null, direction: "flat", isNew: false },
    result,
    qualifier: baselineQualifier(result),
  };
}

export function emptyComparisonBundle(
  basis: ComparisonBasis,
  today: string,
): ComparisonBundle {
  return {
    window: comparisonWindowFor(basis, today),
    revenue: zeroComparison(),
    orders: zeroComparison(),
    units: zeroComparison(),
    avgOrder: zeroComparison(),
  };
}

/**
 * Build the per-day lookup from one sales report.
 *
 * `avgOrder` is derived per day rather than averaged from averages: dividing
 * the day's revenue by the day's orders is the actual basket size for that
 * day. Averaging four days' AOVs would weight a 3-order day the same as a
 * 300-order day.
 */
export function indexDays(report: SalesReport): Map<string, DayValues> {
  const map = new Map<string, DayValues>();
  for (const p of report.byDay) {
    if (p.orders <= 0) {
      // See THE CLOSED-DAY RULE above: no orders means no evidence the store
      // traded, so this is absence of data, not a zero.
      map.set(p.date, null);
      continue;
    }
    map.set(p.date, {
      revenue: p.revenueMinorUnits,
      orders: p.orders,
      units: p.units,
      avgOrder: Math.round(p.revenueMinorUnits / p.orders),
    });
  }
  return map;
}

/** Pull one measure out of the day index, preserving null for no-data days. */
function pick(days: Map<string, DayValues>, ymd: string, key: MeasureKey): number | null {
  const d = days.get(ymd);
  if (d === undefined || d === null) return null;
  return d[key];
}

function measure(
  current: number,
  window: ComparisonWindow,
  days: Map<string, DayValues>,
  key: MeasureKey,
): MeasureComparison {
  const values = window.days.map((d) => pick(days, d, key));
  const result = combineBaseline(values, window.mode);
  return {
    current,
    baseline: result.value,
    // No baseline at all → compare against 0, which `computeDelta` reports as
    // `isNew` rather than as a fake percentage. That is the honest rendering:
    // "new activity", not "▲ 100%".
    delta: computeDelta(current, result.value ?? 0),
    result,
    qualifier: baselineQualifier(result),
  };
}

/**
 * Compare today's report against the chosen basis.
 *
 * `today` is passed in (not read from a clock) so the caller owns the notion
 * of the current business day and the whole thing stays testable.
 */
export async function buildComparison(
  basis: ComparisonBasis,
  todayYmd: string,
  todayReport: SalesReport,
): Promise<ComparisonBundle> {
  const window = comparisonWindowFor(basis, todayYmd);
  if (window.days.length === 0) return emptyComparisonBundle(basis, todayYmd);

  // One span covering every baseline day: oldest .. newest. `days` is built
  // most-recent-first by the core, so the oldest is last.
  const sorted = [...window.days].sort();
  const fromISO = pacificWallTimeToUtcISO(sorted[0], "start");
  const toISO = pacificWallTimeToUtcISO(sorted[sorted.length - 1], "end");

  const baselineReport = await safeData(
    () => getSalesReport(fromISO, toISO),
    EMPTY_SALES_REPORT,
  ).then((r) => r.data);

  const days = indexDays(baselineReport);

  return {
    window,
    revenue: measure(todayReport.totalRevenueMinorUnits, window, days, "revenue"),
    orders: measure(todayReport.totalOrders, window, days, "orders"),
    units: measure(todayReport.totalUnits, window, days, "units"),
    avgOrder: measure(todayReport.avgOrderMinorUnits, window, days, "avgOrder"),
  };
}
