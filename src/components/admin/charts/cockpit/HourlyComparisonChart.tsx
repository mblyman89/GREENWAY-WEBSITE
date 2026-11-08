"use client";

/**
 * D209b: today hour by hour against the comparison basis the owner picked.
 *
 *   "Hour by hour"  today's bars beside the basis's bars (the basis is the
 *                   per-day average for average bases, the one day for single
 *                   bases, the best day for "max").
 *   "Running total" today's cumulative line against the basis's, with a
 *                   dashed projection to close at today's pace.
 *
 * Data is computed server-side by hourlyVsBaseline (pure, self-tested).
 */
import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HourCompareRow } from "@/lib/admin/cockpit-analytics-core";
import { BASIS_FILL, CHART_COLORS, SMALL_TICK, TOOLTIP_STYLE, compactMoney, money } from "./shared";

type Mode = "hourly" | "cumulative";

export function HourlyComparisonChart({
  rows,
  basisLabel,
  hasBaseline,
  height = 260,
}: {
  rows: HourCompareRow[];
  basisLabel: string;
  hasBaseline: boolean;
  height?: number;
}) {
  const [mode, setMode] = useState<Mode>("hourly");
  const nowRow = rows.find((r) => r.isNow);
  const data = rows.map((r) => ({
    name: r.shortLabel,
    label: r.label,
    today: r.isFuture ? null : r.todayMinor,
    basis: r.baselineMinor,
    todayOrders: r.todayOrders,
    basisOrders: r.baselineOrders,
    todayCum: r.todayCumMinor,
    basisCum: r.baselineCumMinor,
    projected: r.projectedCumMinor,
  }));
  const empty = rows.every((r) => r.todayMinor === 0 && (r.baselineMinor ?? 0) === 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Chart view">
        {(
          [
            ["hourly", "Hour by hour"],
            ["cumulative", "Running total"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              mode === m
                ? "bg-[var(--admin-accent)] text-black"
                : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-[var(--admin-text-faint)]">
          {hasBaseline ? `Grey = ${basisLabel}` : "No trading days in this basis yet"}
        </span>
      </div>
      {empty ? (
        <p className="flex items-center justify-center text-sm text-[var(--admin-text-faint)]" style={{ height }}>
          Sales will chart here as orders come through today.
        </p>
      ) : (
        <div style={{ height }} role="img" aria-label={`Revenue by hour today ${basisLabel}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }} barGap={1} barCategoryGap="18%">
              <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
              <XAxis dataKey="name" tick={SMALL_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
              <YAxis tick={SMALL_TICK} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => compactMoney(v)} />
              <Tooltip
                {...TOOLTIP_STYLE}
                labelFormatter={(_l, p) => String((p?.[0]?.payload as { label?: string } | undefined)?.label ?? _l)}
                formatter={(value, name, item) => {
                  const v = typeof value === "number" ? value : null;
                  const pl = (item?.payload ?? {}) as { todayOrders?: number; basisOrders?: number | null };
                  if (name === "Today") return [`${money(v)} \u00b7 ${pl.todayOrders ?? 0} orders`, name];
                  if (name === "Basis") return [`${money(v)}${pl.basisOrders != null ? ` \u00b7 ${pl.basisOrders} orders` : ""}`, basisLabel];
                  return [money(v), String(name)];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted }} />
              {nowRow ? <ReferenceLine x={nowRow.shortLabel} stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" /> : null}
              {mode === "hourly" ? (
                <>
                  {hasBaseline ? <Bar dataKey="basis" name="Basis" fill={BASIS_FILL} radius={[3, 3, 0, 0]} isAnimationActive={false} /> : null}
                  <Bar dataKey="today" name="Today" fill={CHART_COLORS.green} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </>
              ) : (
                <>
                  {hasBaseline ? (
                    <Line dataKey="basisCum" name="Basis running total" stroke="rgba(255,255,255,0.55)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  ) : null}
                  <Line dataKey="todayCum" name="Today running total" stroke={CHART_COLORS.green} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
                  {hasBaseline ? (
                    <Line
                      dataKey="projected"
                      name="Projected at today's pace"
                      stroke={CHART_COLORS.gold}
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
