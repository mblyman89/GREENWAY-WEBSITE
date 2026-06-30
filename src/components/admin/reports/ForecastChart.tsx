"use client";

/**
 * ForecastChart — history + forecast with a shaded prediction band (Slice 45).
 *
 * Renders the recent actuals as a solid line and the forecast as a dashed line
 * sitting inside an 80% prediction band (shaded). Built on Recharts directly
 * (the band needs a stacked transparent base + visible span, which the shared
 * AreaChart wrapper doesn't express). Client-only; data is pre-computed server
 * side and passed in.
 */
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

export type ForecastChartRow = {
  date: string; // YYYY-MM-DD
  actual?: number; // historical value (major units / counts)
  forecast?: number; // forecast mean
  lo80?: number; // lower 80 (for band base)
  band80?: number; // upper80 - lower80 (band height)
};

function shortDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
}

export function ForecastChart({
  rows,
  title,
  subtitle,
  forecastStartDate,
  valuePrefix = "",
  height = 300,
}: {
  rows: ForecastChartRow[];
  title: string;
  subtitle?: string;
  forecastStartDate?: string;
  valuePrefix?: string;
  height?: number;
}) {
  const data = rows.map((r) => ({ ...r, name: shortDay(r.date) }));
  const fmt = (v: number | string) =>
    `${valuePrefix}${typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v}`;

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
      <div className="mb-1 text-sm font-black uppercase tracking-[0.14em] text-white/70">{title}</div>
      {subtitle && <div className="mb-3 text-xs text-white/45">{subtitle}</div>}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -6 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => fmt(v)} />
            <Tooltip
              contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, fontSize: 12 }}
              labelStyle={{ color: "#fff" }}
              formatter={(value, name) => {
                if (name === "_lo" || name === "80% range") return ["", ""];
                const num = typeof value === "number" ? value : Number(value);
                return [fmt(Number.isFinite(num) ? num : 0), String(name)];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }} />
            {/* Prediction band: transparent base + shaded span (hidden from legend/tooltip labels). */}
            <Area dataKey="lo80" stackId="band" stroke="none" fill="transparent" name="_lo" legendType="none" isAnimationActive={false} />
            <Area dataKey="band80" stackId="band" stroke="none" fill="rgba(255,215,0,0.16)" name="80% range" legendType="none" isAnimationActive={false} />
            {forecastStartDate && (
              <ReferenceLine x={shortDay(forecastStartDate)} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" />
            )}
            <Line dataKey="actual" name="Actual" stroke="#7ed957" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="forecast" name="Forecast" stroke="#ffd700" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
