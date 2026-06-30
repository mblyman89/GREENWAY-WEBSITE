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
import {
  forecastDaily,
  buildContiguousSeries,
  type DailyObservation,
  type ForecastResult,
} from "@/lib/reports/forecast-core";

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
  /** Recent daily actuals (for charting), tail of the lookback window. */
  recent: {
    revenue: DailyObservation[];
    orders: DailyObservation[];
    units: DailyObservation[];
  };
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Build daily revenue/orders/units series from non-cancelled orders over the
 * lookback window, bucketed by Pacific calendar day.
 */
async function loadDailySeries(
  lookbackDays: number,
): Promise<{ revenue: DailyObservation[]; orders: DailyObservation[]; units: DailyObservation[] }> {
  const admin = createSupabaseAdminClient();

  const sinceMs = Date.now() - lookbackDays * 86400000;
  const sinceISO = new Date(sinceMs).toISOString();

  const { data: ordersData } = await admin
    .from("orders")
    .select("id, status, placed_at, total_minor_units, item_count")
    .gte("placed_at", sinceISO)
    .order("placed_at", { ascending: true })
    .limit(50000);

  const rows =
    (ordersData as
      | {
          id: string;
          status: string;
          placed_at: string;
          total_minor_units: number | null;
          item_count: number | null;
        }[]
      | null) ?? [];

  const valid = rows.filter((o) => o.status !== "cancelled");

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
    return { hasData: false, lookbackDays, horizon, revenue: empty, orders: empty, units: empty, recent: emptyRecent };
  }

  const series = await loadDailySeries(lookbackDays);
  const revenue = forecastDaily(series.revenue, horizon);
  const orders = forecastDaily(series.orders, horizon);
  const units = forecastDaily(series.units, horizon);

  // Keep the last ~42 days (6 weeks) of contiguous actuals for charting context.
  const tail = (obs: DailyObservation[], n = 42): DailyObservation[] => {
    const contiguous = buildContiguousSeries(obs);
    return contiguous.slice(Math.max(0, contiguous.length - n));
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
