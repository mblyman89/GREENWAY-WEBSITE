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
import { can } from "@/lib/auth/roles";
import { FORECAST_SOURCES, parseForecastSource, type ForecastSource, type SourceInfo, type TaggedObs } from "@/lib/reports/forecast-source-core";
import { CULTIVERA_LABEL } from "@/lib/reports/cultivera-history-core";

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

/**
 * Build chart rows: recent actuals (major units) then forecast mean + 80% band. CVB-9: a Cultivera day goes on its
 * own line ("cultivera"), so imported figures are never drawn as ours; the day before a switch carries both values
 * so the two lines meet.
 */
function buildRows(
  recent: TaggedObs[],
  result: ForecastResult,
  toMajor: (v: number) => number,
): { rows: ForecastChartRow[]; forecastStart?: string } {
  const rows: ForecastChartRow[] = recent.map((o, i) => {
    const v = toMajor(o.value);
    const next = recent[i + 1];
    const row: ForecastChartRow = o.source === "cultivera" ? { date: o.date, cultivera: v } : { date: o.date, actual: v };
    if (next && next.source !== o.source) {
      if (next.source === "cultivera") row.cultivera = v;
      else row.actual = v;
    }
    return row;
  });
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
  searchParams: Promise<{ horizon?: string; source?: string }>;
}) {
  const session = await requirePermission("reports.view");
  const sp = await searchParams;
  const horizon = [7, 14, 30].includes(Number(sp.horizon)) ? Number(sp.horizon) : 14;
  // CVB-9: the Cultivera choices are owner-only (cultivera.benchmark); everyone else sees Greenway only.
  const canUseCultivera = can(session.profile.role, "cultivera.benchmark");
  const source = parseForecastSource(sp.source, canUseCultivera);
  const hrefFor = (h: number, s: ForecastSource) => `/admin/reports/forecast?horizon=${h}${s === "greenway" ? "" : `&source=${s}`}`;

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
        The database isn&apos;t fully set up yet. Once the store has a few weeks of orders, the AI
        forecaster will appear here automatically.
      </div>
    );
  }

  const bundle = await getForecastBundle(horizon, 180, source);
  const sourceBar = canUseCultivera ? <SourcePicker horizon={horizon} source={source} hrefFor={hrefFor} /> : null;

  if (!bundle.hasData) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-bold uppercase tracking-[0.1em] text-white/40">Horizon:</span>
          {HORIZONS.map((h) => (
            <Link
              key={h.days}
              href={hrefFor(h.days, source)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition ${
                horizon === h.days
                  ? "border-[var(--admin-gold)] bg-[var(--admin-gold)] text-black"
                  : "border-white/15 bg-white/5 text-white/60 hover:text-white"
              }`}
            >
              {h.label}
            </Link>
          ))}
        </div>
        {sourceBar}
        <SourceNote info={bundle.source} />
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
              href={hrefFor(h.days, source)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition ${
                horizon === h.days
                  ? "border-[var(--admin-gold)] bg-[var(--admin-gold)] text-black"
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

      {sourceBar}
      <SourceNote info={bundle.source} />

      {/* AI outlook */}
      <ForecastInsightsPanel horizon={horizon} aiEnabled={isAiConfigured} source={bundle.source.source} />

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
                      className="w-full rounded-t bg-[var(--admin-gold)]/50"
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
        subtitle={
          bundle.source.cultiveraDays > 0
            ? `Last 6 weeks of actuals (green = Greenway, orange = ${CULTIVERA_LABEL}) and the next ${horizon} days (dashed) with an 80% prediction band.`
            : `Last 6 weeks of actuals (green) and the next ${horizon} days (dashed) with an 80% prediction band.`
        }
        valuePrefix="$"
        height={320}
        cutoverDate={bundle.source.cutover ?? undefined}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <ForecastChart
          rows={ordChart.rows}
          forecastStartDate={ordChart.forecastStart}
          title="Orders forecast"
          subtitle={`Daily orders, next ${horizon} days.`}
          height={260}
          cutoverDate={bundle.source.cutover ?? undefined}
        />
        <ForecastChart
          rows={uniChart.rows}
          forecastStartDate={uniChart.forecastStart}
          title="Units forecast"
          subtitle={`Daily units sold, next ${horizon} days.`}
          height={260}
          cutoverDate={bundle.source.cutover ?? undefined}
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

/** CVB-9: owner-only data source switch. */
function SourcePicker({ horizon, source, hrefFor }: { horizon: number; source: ForecastSource; hrefFor: (h: number, s: ForecastSource) => string }) {
  return (
    <div data-testid="forecast-source" className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-bold uppercase tracking-[0.1em] text-white/40">Data source:</span>
      {FORECAST_SOURCES.map((s) => (
        <Link
          key={s.key}
          href={hrefFor(horizon, s.key)}
          className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition ${
            source === s.key
              ? s.key === "greenway"
                ? "border-[var(--admin-accent)] bg-[var(--admin-accent)] text-black"
                : "border-[var(--admin-gold)] bg-[var(--admin-gold)] text-black"
              : "border-white/15 bg-white/5 text-white/60 hover:text-white"
          }`}
        >
          {s.label}
        </Link>
      ))}
      <span className="text-[0.7rem] text-white/35">Owner only</span>
    </div>
  );
}

/** CVB-9: says which system fed the forecast; a gold badge whenever Cultivera figures are in it. */
function SourceNote({ info }: { info: SourceInfo }) {
  return (
    <div data-testid="forecast-source-note" className="space-y-2">
      <p className="flex flex-wrap items-center gap-2 text-xs text-white/60">
        {info.cultiveraDays > 0 && (
          <span className="rounded-full border border-[var(--admin-gold)]/50 bg-[var(--admin-gold)]/15 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-gold)]">
            {CULTIVERA_LABEL}
          </span>
        )}
        <span>{info.note}</span>
      </p>
      {info.warning && (
        <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-3 py-2 text-xs text-[var(--admin-gold)]">{info.warning}</div>
      )}
    </div>
  );
}
