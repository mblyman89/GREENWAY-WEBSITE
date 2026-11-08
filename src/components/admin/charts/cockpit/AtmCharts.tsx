"use client";

/**
 * D209f: the ATM.
 *
 *   AtmDispenseChart   what the machine dispensed each settled day (last 30
 *                      days) with the 7-day average. A day with no settlement
 *                      is a gap (unknown), never $0.
 *   AtmWeekdayChart    the weekday profile: mean per weekday with the
 *                      25th-75th percentile range (whiskers via a stacked band).
 *   AtmDepletionChart  the balance walked forward: likely path plus the
 *                      early/late planning range, with the empty line.
 */
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ErrorBar,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DepletionPoint, DispenseHistoryRow, WeekdayStat } from "@/lib/atm/atm-forecast-core";
import { BLUE, CHART_COLORS, SMALL_TICK, TOOLTIP_STYLE, compactMoney, money } from "./shared";

export function AtmDispenseChart({ rows, height = 200 }: { rows: DispenseHistoryRow[]; height?: number }) {
  const data = rows.map((r) => ({ name: r.label, dispensed: r.dispensedCents, ma: r.ma7Cents, w: r.withdrawals }));
  if (!rows.some((r) => r.dispensedCents !== null)) {
    return <p className="flex items-center justify-center text-sm text-[var(--admin-text-faint)]" style={{ height }}>No settled ATM days in the last 30 days.</p>;
  }
  return (
    <div style={{ height }} role="img" aria-label="ATM cash dispensed per day, last 30 days">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="name" tick={SMALL_TICK} axisLine={false} tickLine={false} minTickGap={14} />
          <YAxis tick={SMALL_TICK} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => compactMoney(v)} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(v, name, item) => {
              const w = (item?.payload as { w?: number | null } | undefined)?.w;
              if (name === "Dispensed") return v == null ? ["No settlement", name] : [`${money(typeof v === "number" ? v : null)}${w != null ? ` \u00b7 ${w} withdrawals` : ""}`, name];
              return [money(typeof v === "number" ? v : null), String(name)];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted }} />
          <Bar dataKey="dispensed" name="Dispensed" fill="rgba(79,163,255,0.6)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Line dataKey="ma" name="7-day average" stroke={CHART_COLORS.fg} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AtmWeekdayChart({ weekdays, height = 200 }: { weekdays: WeekdayStat[]; height?: number }) {
  const data = weekdays.map((w) => ({
    name: w.label,
    mean: w.observations > 0 ? w.meanCents : null,
    range: w.observations >= 2 ? [Math.max(0, w.meanCents - w.p25Cents), Math.max(0, w.p75Cents - w.meanCents)] : [0, 0],
    n: w.observations,
    p25: w.p25Cents,
    p75: w.p75Cents,
  }));
  if (!weekdays.some((w) => w.observations > 0)) {
    return <p className="flex items-center justify-center text-sm text-[var(--admin-text-faint)]" style={{ height }}>Not enough settled days for a weekday profile.</p>;
  }
  return (
    <div style={{ height }} role="img" aria-label="Average ATM cash dispensed by weekday">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="name" tick={SMALL_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={SMALL_TICK} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => compactMoney(v)} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(v, _n, item) => {
              const p = item?.payload as { n?: number; p25?: number; p75?: number } | undefined;
              if (!p?.n) return ["No data", "Average"];
              return [`${money(typeof v === "number" ? v : null)} (typical ${money(p.p25 ?? 0)} to ${money(p.p75 ?? 0)}, ${p.n} days)`, "Average"];
            }}
          />
          <Bar dataKey="mean" name="Average" fill={BLUE} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            <ErrorBar dataKey="range" width={6} strokeWidth={1.5} stroke="rgba(255,255,255,0.6)" direction="y" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AtmDepletionChart({
  points,
  startCents,
  startLabel,
  thresholdCents,
  height = 220,
}: {
  points: DepletionPoint[];
  startCents: number;
  startLabel: string;
  thresholdCents: number;
  height?: number;
}) {
  const data = [
    { name: startLabel, likely: startCents, base: startCents, band: 0, early: startCents, late: startCents },
    ...points.map((p) => ({
      name: p.label,
      likely: p.likelyCents,
      base: p.earlyCents,
      band: Math.max(0, p.lateCents - p.earlyCents),
      early: p.earlyCents,
      late: p.lateCents,
    })),
  ];
  return (
    <div style={{ height }} role="img" aria-label="Projected ATM cash by day">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="name" tick={SMALL_TICK} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis tick={SMALL_TICK} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => compactMoney(v)} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(v, name, item) => {
              if (name === "_base") return ["", ""];
              if (name === "Planning range") {
                const p = item?.payload as { early?: number; late?: number } | undefined;
                return [`${money(p?.early ?? 0)} to ${money(p?.late ?? 0)}`, name];
              }
              return [money(typeof v === "number" ? v : null), String(name)];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted }} />
          <Area dataKey="base" stackId="band" stroke="none" fill="transparent" name="_base" legendType="none" isAnimationActive={false} />
          <Area dataKey="band" stackId="band" stroke="none" fill="rgba(255,215,0,0.16)" name="Planning range" isAnimationActive={false} />
          <ReferenceLine y={thresholdCents} stroke={CHART_COLORS.orange} strokeDasharray="4 3" label={{ value: "Empty", fill: CHART_COLORS.orange, fontSize: 10, position: "insideBottomRight" }} />
          <Line dataKey="likely" name="Likely cash left" stroke={CHART_COLORS.gold} strokeWidth={2.5} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
