/**
 * src/app/admin/reports/forecast/page.tsx  (Slice 45)
 *
 * AI Forecaster tab. A professional-grade demand forecast built on a classical
 * trend + weekly-seasonality decomposition (forecast-core.ts), with prediction
 * intervals and an honest accuracy backtest, plus an AI outlook that turns the
 * numbers into a staffing/ordering/promotion plan.
 *
 * Read-only / advisory. Money in minor units.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { isAiConfigured } from "@/lib/reports/forecast-ai";
import { getForecastBundle, describeWeeklyPattern, DOW_FULL } from "@/lib/reports/forecast";
import { ForecastChart, type ForecastChartRow } from "@/components/admin/reports/ForecastChart";
import { ForecastInsightsPanel } from "@/components/admin/reports/ForecastInsightsPanel";
import type { ForecastResult } from "@/lib/reports/forecast-core";
import type { DailyObservation } from "@/lib/reports/forecast-core";

export const dynamic = "force-dynamic";

const HORIZONS = [
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

const GRADE_LABEL: Record<string, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  weak: "Weak",
  "insufficient-data": "Not enough data",
};

/** Build chart rows: recent actuals (major units) then forecast mean + 80% band. */
function buildRows(
  recent: DailyObservation[],
  result: ForecastResult,
  toMajor: (v: number) => number,
): { rows: ForecastChartRow[]; forecastStart?: string } {
  const rows: ForecastChartRow[] = recent.map((o) => ({ date: o.date, actual: toMajor(o.value) }));
  // Bridge: repeat the last actual as the first forecast point so the dashed
  // line connects to the solid one.
  const last = recent[recent.length - 1];
  const forecastStart = result.points[0]?.date;
  if (last && result.points.length) {
    rows[rows.length - 1] = { ...rows[rows.length - 1], forecast: toMajor(last.value) };
  }
  for (const p of result.points) {
    rows.push({
      date: p.date,
      forecast: toMajor(p.mean),
      lo80: toMajor(p.lower80),
      band80: toMajor(p.upper80 - p.lower80),
    });
  }
  return { rows, forecastStart };
}

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<{ horizon?: string }>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const horizon = [7, 14, 30].includes(Number(sp.horizon)) ? Number(sp.horizon) : 14;

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
        The database isn&apos;t fully set up yet. Once the store has a few weeks of orders, the AI
        forecaster will appear here automatically.
      </div>
    );
  }

  const bundle = await getForecastBundle(horizon);

  if (!bundle.hasData) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-bold uppercase tracking-[0.1em] text-white/40">Horizon:</span>
          {HORIZONS.map((h) => (
            <Link
              key={h.days}
              href={`/admin/reports/forecast?horizon=${h.days}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition ${
                horizon === h.days
                  ? "border-[#ffd700]/60 bg-[#ffd700]/15 text-[#ffd700]"
                  : "border-white/15 bg-white/5 text-white/60 hover:text-white"
              }`}
            >
              {h.label}
            </Link>
          ))}
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-6 text-sm text-white/60">
          <p className="font-bold text-white/80">Not enough history to forecast yet.</p>
          <p className="mt-1">
            The forecaster needs at least about three weeks of daily sales to learn the store&apos;s
            weekly rhythm. {bundle.revenue.note ?? ""} It will switch on automatically as orders
            accumulate.
          </p>
        </div>
      </div>
    );
  }

  const rev = bundle.revenue;
  const ord = bundle.orders;
  const uni = bundle.units;

  const revChart = buildRows(bundle.recent.revenue, rev, (v) => Math.round(v) / 100);
  const ordChart = buildRows(bundle.recent.orders, ord, (v) => v);
  const uniChart = buildRows(bundle.recent.units, uni, (v) => v);

  const pattern = rev.hasForecast ? describeWeeklyPattern(rev.dowIndex) : null;
  const trendWord = rev.trendPerDay > 0 ? "Rising" : rev.trendPerDay < 0 ? "Declining" : "Flat";
  const trendAccent = rev.trendPerDay > 0 ? "green" : rev.trendPerDay < 0 ? "orange" : "muted";

  return (
    <div className="space-y-5">
      {/* Horizon selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-bold uppercase tracking-[0.1em] text-white/40">Horizon:</span>
          {HORIZONS.map((h) => (
            <Link
              key={h.days}
              href={`/admin/reports/forecast?horizon=${h.days}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition ${
                horizon === h.days
                  ? "border-[#ffd700]/60 bg-[#ffd700]/15 text-[#ffd700]"
                  : "border-white/15 bg-white/5 text-white/60 hover:text-white"
              }`}
            >
              {h.label}
            </Link>
          ))}
        </div>
        <span className="text-xs text-white/40">
          Model: trend + weekly seasonality decomposition · {bundle.lookbackDays}-day lookback
        </span>
      </div>

      {/* AI outlook */}
      <ForecastInsightsPanel horizon={horizon} aiEnabled={isAiConfigured} />

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={`Projected revenue (next ${horizon}d)`}
          value={formatMinorCurrency(Math.round(rev.horizonTotal))}
          hint={`80% range ${formatMinorCurrency(Math.round(rev.points.reduce((a, p) => a + p.lower80, 0)))}–${formatMinorCurrency(
            Math.round(rev.points.reduce((a, p) => a + p.upper80, 0)),
          )}`}
          accent="gold"
        />
        <StatCard
          label={`Projected orders (next ${horizon}d)`}
          value={Math.round(ord.horizonTotal).toLocaleString()}
          hint={`≈${(ord.horizonTotal / horizon).toFixed(1)} / day`}
          accent="green"
        />
        <StatCard label="Revenue trend" value={trendWord} hint="Deseasonalized direction" accent={trendAccent} />
        <StatCard
          label="Forecast accuracy"
          value={GRADE_LABEL[rev.accuracy.grade] ?? rev.accuracy.grade}
          hint={rev.accuracy.mape !== null ? `MAPE ${(rev.accuracy.mape * 100).toFixed(0)}% (backtest)` : "From backtest"}
          accent="muted"
        />
      </div>

      {/* Weekly pattern callout */}
      {pattern && (
        <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
          <div className="mb-3 text-sm font-black uppercase tracking-[0.14em] text-white/70">Weekly rhythm</div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-1 items-end gap-1.5">
              {rev.dowIndex.map((idx, i) => {
                const h = Math.max(6, Math.round(idx * 60));
                return (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-[#ffd700]/50"
                      style={{ height: `${h}px` }}
                      title={`${DOW_FULL[i]}: ${(idx * 100).toFixed(0)}% of average`}
                    />
                    <span className="text-[0.65rem] text-white/45">{DOW_FULL[i].slice(0, 3)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="mt-3 text-xs text-white/55">
            Busiest day is <span className="font-bold text-white/80">{pattern.busiest}</span>; quietest is{" "}
            <span className="font-bold text-white/80">{pattern.quietest}</span>. Bars show each day&apos;s
            typical share of an average day (100% = average).
          </p>
        </div>
      )}

      {/* Forecast charts */}
      <ForecastChart
        rows={revChart.rows}
        forecastStartDate={revChart.forecastStart}
        title="Revenue forecast"
        subtitle={`Last 6 weeks of actuals (green) and the next ${horizon} days (dashed) with an 80% prediction band.`}
        valuePrefix="$"
        height={320}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <ForecastChart
          rows={ordChart.rows}
          forecastStartDate={ordChart.forecastStart}
          title="Orders forecast"
          subtitle={`Daily orders, next ${horizon} days.`}
          height={260}
        />
        <ForecastChart
          rows={uniChart.rows}
          forecastStartDate={uniChart.forecastStart}
          title="Units forecast"
          subtitle={`Daily units sold, next ${horizon} days.`}
          height={260}
        />
      </div>

      <p className="text-[0.7rem] leading-relaxed text-white/35">
        How this works: we decompose your daily history into a trend and a repeating weekly pattern
        (day-of-week seasonality), project them forward, and shade the range we&apos;d expect 80% of
        the time. The accuracy grade comes from a backtest — we hide the most recent stretch of real
        sales, forecast it, and measure the error (MAPE). A forecast is a planning aid, not a
        promise; the wider the band, the more uncertain the day.
      </p>
    </div>
  );
}
