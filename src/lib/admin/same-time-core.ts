/**
 * src/lib/admin/same-time-core.ts  (D245, owner 2026-11-15)
 *
 * Owner, verbatim: "Another small detail that would be really great is for
 * the system to show how we performed at that exact same time when using the
 * compare with options. Right now it compares how we are doing right now with
 * how we did at the end of the comparison day/ period. It would be great to
 * compare both days/ periods at the same time as what we are doing today."
 *
 * PURE: no I/O, no clock, no Next.js. The caller passes the cut-off minute.
 *
 * WHAT THIS DOES
 *
 * Before D245 the cockpit's "Today's sales" tiles compared today SO FAR with
 * each baseline day's WHOLE-DAY total (at 10 am, two hours against twelve).
 * Now every baseline day is cut off at the same Pacific wall-clock minute as
 * "now": at 2:35 PM, today from midnight to 2:35 PM is compared with
 * yesterday from midnight to 2:35 PM (or the average / best of the basis's
 * days, each cut at 2:35 PM).
 *
 * The sales report carries, per Pacific day, one compact entry per completed
 * order (minute of the day, revenue, units, discount): `DayClockSeries`. The
 * cut is taken AFTER the (cached) whole-day report is read, so cache keys
 * still never contain the time of day (cockpit-cache-core rule 5) and a
 * finished day is read once per 10 minutes, not once per minute.
 *
 * THE CLOSED-DAY RULE, KEPT (comparison-data.ts)
 *
 *   - A day with no orders ALL DAY is no data (null): the store was shut or
 *     the system was not in use. It is dropped from the baseline.
 *   - A day that traded, but had no orders yet by the cut-off minute, is a
 *     REAL zero for revenue, orders, units and discounts (the store opened and
 *     had not sold yet by that time). Its average order is null (no basket to
 *     compare), so it is dropped from the average-order baseline only.
 *
 * Money stays in integer cents. Revenue is the same tax-inclusive gross sold
 * figure as everywhere else on the cockpit; "before discounts" adds back the
 * line markdown (regular price minus price charged), the same figure Reports
 * -> Sales calls "Discounts given".
 */

/** Minutes in a Pacific wall-clock day (0 .. 1439). */
export const MINUTES_PER_DAY = 1440;

/**
 * One Pacific day's completed orders in time order. Parallel arrays (not an
 * array of objects) so 12 weeks of orders stay small in the display cache.
 * `min[i]` is the Pacific minute of the day the i-th order was placed.
 */
export type DayClockSeries = {
  date: string;
  min: number[];
  rev: number[];
  units: number[];
  disc: number[];
};

/** One order as the sales report sees it, for building the series. */
export type ClockOrder = {
  date: string;
  minute: number;
  revenue: number;
  units: number;
  discount: number;
};

/** A whole day's figures from `SalesReport.byDay`. */
export type WholeDayIn = {
  date: string;
  revenueMinorUnits: number;
  orders: number;
  units: number;
  discountMinorUnits?: number;
};

/** A baseline day's headline values, or null for the closed-day rule. */
export type SameTimeDayValues = {
  revenue: number;
  orders: number;
  units: number;
  /** null when no order had been placed by the cut-off. */
  avgOrder: number | null;
  discount: number;
  /** revenue + discount: what the same goods would have rung up at regular price. */
  grossBeforeDiscounts: number;
} | null;

/** Clamp to a valid minute of the day; non-finite becomes null. */
export function normalizeMinute(m: number | null | undefined): number | null {
  if (m === null || m === undefined || !Number.isFinite(m)) return null;
  const r = Math.floor(m);
  if (r < 0) return 0;
  if (r > MINUTES_PER_DAY - 1) return MINUTES_PER_DAY - 1;
  return r;
}

/** Pacific hour + minute to a minute of the day. */
export function minuteOfDay(hour: number, minute: number): number {
  return normalizeMinute(hour * 60 + minute) ?? 0;
}

/** "2:35 PM" for minute 875. */
export function formatClockLabel(minute: number): string {
  const m = normalizeMinute(minute) ?? 0;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:${String(mm).padStart(2, "0")} ${period}`;
}

/**
 * Fold orders into one compact series per day, each sorted by minute.
 * Days are returned oldest first.
 */
export function buildClockSeries(orders: readonly ClockOrder[]): DayClockSeries[] {
  const byDate = new Map<string, ClockOrder[]>();
  for (const o of orders) {
    const list = byDate.get(o.date);
    if (list) list.push(o);
    else byDate.set(o.date, [o]);
  }
  const out: DayClockSeries[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const list = [...(byDate.get(date) ?? [])].sort((a, b) => a.minute - b.minute);
    out.push({
      date,
      min: list.map((o) => normalizeMinute(o.minute) ?? 0),
      rev: list.map((o) => Math.round(o.revenue)),
      units: list.map((o) => o.units),
      disc: list.map((o) => Math.max(0, Math.round(o.discount))),
    });
  }
  return out;
}

function values(revenue: number, orders: number, units: number, discount: number): SameTimeDayValues {
  return {
    revenue,
    orders,
    units,
    avgOrder: orders > 0 ? Math.round(revenue / orders) : null,
    discount,
    grossBeforeDiscounts: revenue + discount,
  };
}

/**
 * Per-day values for the baseline, cut at `cutMinute` (inclusive) when it is
 * given AND the report carries the clock series; otherwise whole-day values
 * (the pre-D245 behaviour, kept for callers and old cached reports).
 *
 * Returns the map and whether the cut was actually applied, so the page
 * never claims "same time of day" when it could not do it.
 */
export function baselineDayValues(
  byDay: readonly WholeDayIn[],
  byDayClock: readonly DayClockSeries[] | undefined | null,
  cutMinute: number | null | undefined,
): { days: Map<string, SameTimeDayValues>; sameTime: boolean } {
  const cut = normalizeMinute(cutMinute ?? null);
  const days = new Map<string, SameTimeDayValues>();
  const canCut = cut !== null && Array.isArray(byDayClock);

  if (!canCut) {
    for (const p of byDay) {
      if (p.orders <= 0) {
        days.set(p.date, null);
        continue;
      }
      const v = values(p.revenueMinorUnits, p.orders, p.units, p.discountMinorUnits ?? 0);
      // Whole day with orders: avgOrder is always defined here.
      days.set(p.date, v);
    }
    return { days, sameTime: false };
  }

  const clock = new Map<string, DayClockSeries>();
  for (const s of byDayClock) clock.set(s.date, s);

  for (const p of byDay) {
    const s = clock.get(p.date);
    const tradedAllDay = p.orders > 0 || (s !== undefined && s.min.length > 0);
    if (!tradedAllDay) {
      days.set(p.date, null);
      continue;
    }
    let revenue = 0;
    let orders = 0;
    let units = 0;
    let discount = 0;
    if (s) {
      for (let i = 0; i < s.min.length; i += 1) {
        if (s.min[i] > cut) break; // sorted by minute
        revenue += s.rev[i] ?? 0;
        units += s.units[i] ?? 0;
        discount += s.disc[i] ?? 0;
        orders += 1;
      }
    }
    days.set(p.date, values(revenue, orders, units, discount));
  }
  return { days, sameTime: true };
}

/** Today's tiles: revenue before discounts = revenue + discounts (cents). */
export function revenueBeforeDiscounts(revenueMinor: number, discountMinor: number): number {
  return Math.round(revenueMinor) + Math.max(0, Math.round(discountMinor));
}

// ── Self-tests ────────────────────────────────────────────────────────────

export function __runSameTimeCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const fails: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      fails.push(msg);
    }
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

  // Minutes and labels
  eq(minuteOfDay(14, 35), 875, "2:35 PM is minute 875");
  eq(minuteOfDay(0, 0), 0, "midnight is minute 0");
  eq(minuteOfDay(23, 59), 1439, "11:59 PM is the last minute");
  eq(normalizeMinute(5000), 1439, "over the day clamps to the last minute");
  eq(normalizeMinute(-3), 0, "negative clamps to midnight");
  eq(normalizeMinute(Number.NaN), null, "NaN is no cut");
  eq(normalizeMinute(undefined), null, "undefined is no cut");
  eq(formatClockLabel(875), "2:35 PM", "afternoon label");
  eq(formatClockLabel(0), "12:00 AM", "midnight label");
  eq(formatClockLabel(720), "12:00 PM", "noon label");
  eq(formatClockLabel(545), "9:05 AM", "minutes are two digits");

  // Building the series
  const series = buildClockSeries([
    { date: "2026-11-14", minute: 600, revenue: 5000, units: 2, discount: 500 },
    { date: "2026-11-14", minute: 540, revenue: 3000, units: 1, discount: 0 },
    { date: "2026-11-13", minute: 900, revenue: 7000, units: 3, discount: 1000 },
    { date: "2026-11-14", minute: 900, revenue: 2000, units: 1, discount: -50 },
  ]);
  eq(series.map((s) => s.date), ["2026-11-13", "2026-11-14"], "days oldest first");
  eq(series[1].min, [540, 600, 900], "orders sorted by minute");
  eq(series[1].rev, [3000, 5000, 2000], "revenue follows its order");
  eq(series[1].disc, [0, 500, 0], "a negative discount is never stored");
  eq(buildClockSeries([]), [], "no orders, no series");

  const byDay: WholeDayIn[] = [
    { date: "2026-11-12", revenueMinorUnits: 0, orders: 0, units: 0, discountMinorUnits: 0 },
    { date: "2026-11-13", revenueMinorUnits: 7000, orders: 1, units: 3, discountMinorUnits: 1000 },
    { date: "2026-11-14", revenueMinorUnits: 10000, orders: 3, units: 4, discountMinorUnits: 500 },
  ];

  // The cut: 10:00 AM (minute 600, inclusive)
  const cut = baselineDayValues(byDay, series, 600);
  ok(cut.sameTime, "cut applied when the series is present");
  eq(cut.days.get("2026-11-12"), null, "closed all day stays no data");
  eq(
    cut.days.get("2026-11-14"),
    { revenue: 8000, orders: 2, units: 3, avgOrder: 4000, discount: 500, grossBeforeDiscounts: 8500 },
    "only orders by 10:00 AM count (inclusive of that minute)",
  );
  eq(
    cut.days.get("2026-11-13"),
    { revenue: 0, orders: 0, units: 0, avgOrder: null, discount: 0, grossBeforeDiscounts: 0 },
    "traded later that day: a real zero by 10 AM, no basket yet",
  );

  // Late cut includes everything
  const late = baselineDayValues(byDay, series, 1439);
  eq(late.days.get("2026-11-14")?.revenue, 10000, "end-of-day cut equals the whole day");
  eq(late.days.get("2026-11-13")?.grossBeforeDiscounts, 8000, "gross = revenue + discount");

  // Before opening: everything traded is a zero, never null
  const early = baselineDayValues(byDay, series, 0);
  eq(early.days.get("2026-11-14")?.orders, 0, "before the first sale: zero orders");
  eq(early.days.get("2026-11-14")?.avgOrder, null, "before the first sale: no average order");

  // No cut, or no series: whole-day values, and says so
  const whole = baselineDayValues(byDay, series, null);
  ok(!whole.sameTime, "no cut minute: whole day, not claimed as same time");
  eq(whole.days.get("2026-11-14")?.revenue, 10000, "whole-day revenue");
  eq(whole.days.get("2026-11-14")?.avgOrder, 3333, "whole-day avg order rounds to cents");
  eq(whole.days.get("2026-11-12"), null, "whole-day closed rule");
  const legacy = baselineDayValues(byDay, undefined, 600);
  ok(!legacy.sameTime, "a report without the series is never claimed as same time");
  eq(legacy.days.get("2026-11-13")?.revenue, 7000, "legacy falls back to the whole day");
  const noDisc = baselineDayValues([{ date: "2026-11-01", revenueMinorUnits: 100, orders: 1, units: 1 }], null, null);
  eq(noDisc.days.get("2026-11-01")?.discount, 0, "missing day discount reads as 0");

  // A day in the series but missing from byDay is ignored (byDay drives the window)
  const onlySeries = baselineDayValues([], series, 600);
  eq(onlySeries.days.size, 0, "byDay decides which days exist");

  // A day whose byDay says 0 orders but has series entries is still traded
  const mismatch = baselineDayValues(
    [{ date: "2026-11-14", revenueMinorUnits: 0, orders: 0, units: 0 }],
    series,
    600,
  );
  eq(mismatch.days.get("2026-11-14")?.orders, 2, "series evidence of trade is honoured");

  // Revenue before discounts
  eq(revenueBeforeDiscounts(10000, 2500), 12500, "adds the discount back");
  eq(revenueBeforeDiscounts(10000, -5), 10000, "a negative discount never lowers it");
  eq(revenueBeforeDiscounts(0, 0), 0, "zero day");

  if (failed > 0) throw new Error(`same-time-core: ${failed} failed: ${fails.join("; ")}`);
  return { passed, failed };
}
