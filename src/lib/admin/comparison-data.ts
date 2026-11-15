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
import {
  baselineDayValues,
  formatClockLabel,
  normalizeMinute,
  revenueBeforeDiscounts,
  type SameTimeDayValues,
} from "@/lib/admin/same-time-core";

/**
 * The headline measures the cockpit compares. D245 added
 * `grossBeforeDiscounts` (revenue + discounts) and `discount`.
 */
export type MeasureKey = "revenue" | "orders" | "units" | "avgOrder" | "grossBeforeDiscounts" | "discount";

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
  /** D245: revenue before discounts (revenue + discounts). Optional for old fixtures. */
  grossBeforeDiscounts?: MeasureComparison;
  /** D245: total discounts given (regular price minus price charged). */
  discount?: MeasureComparison;
  /**
   * D245: the Pacific minute of the day each baseline day was cut at, or null
   * when the baseline is whole days (no cut asked for, or no clock data).
   */
  cutMinute?: number | null;
  /** D245: "2:35 PM" when cut, else "". */
  cutLabel?: string;
};

/** A day's worth of headline numbers, or null when the store had no orders. */
type DayValues = SameTimeDayValues;

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
    grossBeforeDiscounts: zeroComparison(),
    discount: zeroComparison(),
    cutMinute: null,
    cutLabel: "",
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
export function indexDays(report: SalesReport): Map<string, { revenue: number; orders: number; units: number; avgOrder: number } | null> {
  const map = new Map<string, { revenue: number; orders: number; units: number; avgOrder: number } | null>();
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

/**
 * D245: the baseline day values cut at the same Pacific minute of the day as
 * now (same-time-core.ts). A traded day with nothing sold yet by that minute
 * is a real zero; a day with no orders all day stays no data. Falls back to
 * whole days (and says so through `sameTime`) when no cut is asked for or the
 * report has no clock series.
 */
export function indexDaysAt(
  report: SalesReport,
  cutMinute: number | null | undefined,
): { days: Map<string, DayValues>; sameTime: boolean } {
  return baselineDayValues(report.byDay ?? [], report.byDayClock, cutMinute);
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
/**
 * PERF2 round 4: the ONE query span a basis needs (oldest .. newest baseline
 * day), or null when the basis has no baseline days. Exposed so the cockpit
 * can start the baseline read at the same time as today's report instead of
 * after it, and can tell when the span is exactly yesterday's.
 */
export function comparisonSpan(
  basis: ComparisonBasis,
  todayYmd: string,
): { fromISO: string; toISO: string } | null {
  const window = comparisonWindowFor(basis, todayYmd);
  if (window.days.length === 0) return null;
  // `days` is built most-recent-first by the core, so sort for oldest..newest.
  const sorted = [...window.days].sort();
  return {
    fromISO: pacificWallTimeToUtcISO(sorted[0], "start"),
    toISO: pacificWallTimeToUtcISO(sorted[sorted.length - 1], "end"),
  };
}

/** Start (do not await) the baseline read for a basis. Never rejects. */
export function fetchComparisonBaseline(
  basis: ComparisonBasis,
  todayYmd: string,
): Promise<SalesReport> {
  const span = comparisonSpan(basis, todayYmd);
  if (!span) return Promise.resolve(EMPTY_SALES_REPORT);
  return safeData(
    () => getSalesReport(span.fromISO, span.toISO),
    EMPTY_SALES_REPORT,
  ).then((r) => r.data);
}

export async function buildComparison(
  basis: ComparisonBasis,
  todayYmd: string,
  todayReport: SalesReport,
  /**
   * PERF2 round 4: an already-started baseline read (see
   * fetchComparisonBaseline). Omitted = read it now, exactly as before.
   */
  baseline?: Promise<SalesReport>,
  /**
   * D245 (owner: "compare both days/ periods at the same time as what we are
   * doing today"): the current Pacific minute of the day (0..1439). Each
   * baseline day is cut at this minute. Omitted/null = whole days (pre-D245).
   */
  cutMinute?: number | null,
): Promise<ComparisonBundle> {
  const window = comparisonWindowFor(basis, todayYmd);
  if (window.days.length === 0) return emptyComparisonBundle(basis, todayYmd);

  // One span covering every baseline day: oldest .. newest.
  const baselineReport = await (baseline ?? fetchComparisonBaseline(basis, todayYmd));

  const { days, sameTime } = indexDaysAt(baselineReport, cutMinute);
  const cut = sameTime ? normalizeMinute(cutMinute ?? null) : null;
  const todayDiscount = todayReport.totalDiscountMinorUnits ?? 0;

  return {
    window,
    revenue: measure(todayReport.totalRevenueMinorUnits, window, days, "revenue"),
    orders: measure(todayReport.totalOrders, window, days, "orders"),
    units: measure(todayReport.totalUnits, window, days, "units"),
    avgOrder: measure(todayReport.avgOrderMinorUnits, window, days, "avgOrder"),
    grossBeforeDiscounts: measure(
      revenueBeforeDiscounts(todayReport.totalRevenueMinorUnits, todayDiscount),
      window,
      days,
      "grossBeforeDiscounts",
    ),
    discount: measure(todayDiscount, window, days, "discount"),
    cutMinute: cut,
    cutLabel: cut === null ? "" : formatClockLabel(cut),
  };
}
