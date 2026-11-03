import "server-only";

/**
 * src/lib/reports/forecast.ts  (Slice 45)
 *
 * Server-side data layer for the AI demand forecaster. Pulls the store's daily
 * history (revenue, orders, units) in Pacific time and runs the pure
 * decomposition model in forecast-core.ts to produce point forecasts with
 * prediction intervals and an honest accuracy backtest.
 *
 * Read-only. Money in minor units (cents). Counts as integers.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificDayKey } from "@/lib/reports/timezone";
import { isRevenueOrder } from "@/lib/reports/revenue-basis";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import {
  forecastDaily,
  buildContiguousSeries,
  type DailyObservation,
  type ForecastResult,
} from "@/lib/reports/forecast-core";
import { combineSeries, type ForecastSource, type SourceInfo, type TaggedObs } from "@/lib/reports/forecast-source-core";
import { cutoverDate } from "@/lib/reports/cultivera-benchmark-report-store";
import { historyDays } from "@/lib/reports/cultivera-history-store";
import { addPacificDays, pacificToday } from "@/lib/reports/timezone";

export type ForecastMetric = "revenue" | "orders" | "units";

export type ForecastBundle = {
  hasData: boolean;
  /** How many days of raw order history we looked back over. */
  lookbackDays: number;
  /** Forecast horizon in days. */
  horizon: number;
  revenue: ForecastResult; // minor units
  orders: ForecastResult; // count
  units: ForecastResult; // count
  /** Recent daily actuals (for charting), tail of the lookback window; each day names its system (CVB-9). */
  recent: {
    revenue: TaggedObs[];
    orders: TaggedObs[];
    units: TaggedObs[];
  };
  /** CVB-9: which system(s) fed this forecast, the cut-over and a plain note (also given to the AI). */
  source: SourceInfo;
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * SLICE 5C — memory ceiling for the order-history scan. NOT a row cap:
 * reaching it is REPORTED as an incomplete read, never silently accepted.
 */
const FORECAST_SCAN_MAX_ROWS = 200_000;
export const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Build daily revenue/orders/units series from COMPLETED orders (revenue-basis,
 * GW-015) over the lookback window, bucketed by Pacific calendar day.
 */
async function loadDailySeries(
  lookbackDays: number,
): Promise<{ revenue: DailyObservation[]; orders: DailyObservation[]; units: DailyObservation[] }> {
  const admin = createSupabaseAdminClient();

  const sinceMs = Date.now() - lookbackDays * 86400000;
  const sinceISO = new Date(sinceMs).toISOString();

  // SLICE 5C — `.limit(50000)` cannot exceed PostgREST's 1,000-row cap
  // (chunked-in.ts:13-14). Worse than a plain truncation: this read is ordered
  // by `placed_at` ASCENDING, so the 1,000 rows that survived were always the
  // OLDEST in the window and every recent order was silently discarded. A
  // 180-day revenue forecast was being computed from stale history with
  // nothing on screen to say so. Paged completely.
  type OrderRow = {
    id: string;
    status: string;
    placed_at: string;
    total_minor_units: number | null;
    item_count: number | null;
  };
  const { rows, verdict } = await pagedAllChecked<OrderRow>(
    async (from, to) => {
      const { data, error } = await admin
        .from("orders")
        .select("id, status, placed_at, total_minor_units, item_count")
        .gte("placed_at", sinceISO)
        .order("placed_at", { ascending: true })
        // Unique tiebreak — `placed_at` is not unique, and without it paging
        // can repeat or skip orders that share a timestamp.
        .order("id", { ascending: true })
        .range(from, to);
      if (error) return { rows: [], ok: false };
      return { rows: (data as OrderRow[] | null) ?? [], ok: true };
    },
    { maxRows: FORECAST_SCAN_MAX_ROWS },
  );
  if (!verdict.complete) {
    // Advisory surface: the forecast still renders, but the incompleteness is
    // recorded rather than hidden behind a confident-looking curve.
    console.warn(`[forecast] order history may be incomplete — ${verdict.message}`);
  }

  const valid = rows.filter((o) => isRevenueOrder(o.status));

  const rev = new Map<string, number>();
  const ord = new Map<string, number>();
  const uni = new Map<string, number>();

  for (const o of valid) {
    const day = pacificDayKey(o.placed_at);
    rev.set(day, (rev.get(day) ?? 0) + (o.total_minor_units ?? 0));
    ord.set(day, (ord.get(day) ?? 0) + 1);
    uni.set(day, (uni.get(day) ?? 0) + (o.item_count ?? 0));
  }

  const toObs = (m: Map<string, number>): DailyObservation[] =>
    [...m.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));

  return { revenue: toObs(rev), orders: toObs(ord), units: toObs(uni) };
}

/**
 * Produce the full forecast bundle. Looks back `lookbackDays` (default 180 ≈ 6
 * months, enough for stable weekly seasonality) and forecasts `horizon` days
 * ahead (default 14).
 */
export async function getForecastBundle(
  horizon = 14,
  lookbackDays = 180,
  source: ForecastSource = "greenway",
): Promise<ForecastBundle> {
  const empty: ForecastResult = {
    hasForecast: false,
    dowIndex: new Array(7).fill(1),
    trendPerDay: 0,
    level: 0,
    sigma: 0,
    points: [],
    horizonTotal: 0,
    accuracy: { mape: null, mae: null, bias: null, holdoutDays: 0, grade: "insufficient-data" },
    historyDays: 0,
  };

  const emptyRecent = { revenue: [], orders: [], units: [] };
  if (!isSupabaseServiceConfigured) {
    const info: SourceInfo = {
      source: "greenway", cutover: null, greenwayDays: 0, cultiveraDays: 0, firstCultivera: null, lastCultivera: null,
      note: "Data source: Greenway figures only (our completed orders).", warning: null,
    };
    return { hasData: false, lookbackDays, horizon, revenue: empty, orders: empty, units: empty, recent: emptyRecent, source: info };
  }

  const ours = await loadDailySeries(lookbackDays);
  // CVB-9: Cultivera history only when the owner chose it, only before the cut-over (never guessed).
  let cutover: string | null = null;
  let cult: Awaited<ReturnType<typeof historyDays>> = [];
  let historyError: string | null = null;
  const today = pacificToday();
  if (source !== "greenway") {
    try {
      cutover = await cutoverDate();
      if (cutover) {
        const before = addPacificDays(cutover, -1);
        cult = await historyDays(source === "blend" ? addPacificDays(today, -lookbackDays) : "2000-01-01", before);
      }
    } catch (e) {
      historyError = e instanceof Error ? e.message : "unreadable";
    }
  }
  const combined = combineSeries({ source, ours, cultivera: cult, cutover, today, lookbackDays, historyError });
  const series = combined.series;
  const revenue = forecastDaily(series.revenue, horizon);
  const orders = forecastDaily(series.orders, horizon);
  const units = forecastDaily(series.units, horizon);

  // Keep the last ~42 days (6 weeks) of contiguous actuals for charting context. A filled (no-sale) day takes
  // the system of the day before it, so every charted day still names its source.
  const tail = (obs: TaggedObs[], n = 42): TaggedObs[] => {
    const src = new Map(obs.map((o) => [o.date, o.source]));
    const contiguous = buildContiguousSeries(obs);
    let prev: TaggedObs["source"] = obs[0]?.source ?? "greenway";
    const tagged = contiguous.map((o) => {
      prev = src.get(o.date) ?? prev;
      return { ...o, source: prev };
    });
    return tagged.slice(Math.max(0, tagged.length - n));
  };

  return {
    hasData: revenue.hasForecast || orders.hasForecast || units.hasForecast,
    lookbackDays,
    horizon,
    revenue,
    orders,
    units,
    recent: {
      revenue: tail(series.revenue),
      orders: tail(series.orders),
      units: tail(series.units),
    },
    source: combined.info,
  };
}

/** Short DOW label for a 0..6 index. */
export function dowLabel(i: number): string {
  return DOW_LABELS[i] ?? "?";
}

/**
 * Compact, human-friendly description of the day-of-week pattern (busiest /
 * quietest days) from a forecast's indices.
 */
export function describeWeeklyPattern(dowIndex: number[]): { busiest: string; quietest: string } {
  let maxI = 0;
  let minI = 0;
  for (let i = 1; i < 7; i++) {
    if (dowIndex[i] > dowIndex[maxI]) maxI = i;
    if (dowIndex[i] < dowIndex[minI]) minI = i;
  }
  return { busiest: DOW_FULL[maxI], quietest: DOW_FULL[minI] };
}
