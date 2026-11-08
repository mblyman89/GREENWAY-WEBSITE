"use client";

/**
 * D210c: hourly foot traffic vs sales vs labor.
 *
 * Bars: today's revenue by hour (left axis). Lines (right axis): orders
 * (transactions = foot traffic that bought), labor hours on the clock, and
 * the basis's orders for the same hour (the rush to staff for). Where the
 * orders line runs far above the labor line the floor is stretched; where
 * labor sits high over few orders, the schedule is heavy.
 */
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrafficLaborRow } from "@/lib/admin/cockpit-analytics-core";
import { BLUE, CHART_COLORS, SMALL_TICK, TOOLTIP_STYLE, compactMoney, money } from "./shared";

export function TrafficLaborChart({
  rows,
  basisLabel,
  showLabor,
  height = 260,
}: {
  rows: TrafficLaborRow[];
  basisLabel: string;
  /** False when the viewer may not see staffing (labor lines hidden). */
  showLabor: boolean;
  height?: number;
}) {
  const data = rows.map((r) => ({
    name: r.shortLabel,
    label: r.label,
    revenue: r.revenueMinor,
    orders: r.orders,
    labor: showLabor ? r.laborHours : null,
    staff: showLabor ? r.headcount : null,
    basisOrders: r.baselineOrders,
    splh: showLabor ? r.splhMinor : null,
    opl: showLabor ? r.ordersPerLaborHour : null,
  }));
  const hasBasis = rows.some((r) => r.baselineOrders !== null);
  const empty = rows.every((r) => r.orders === 0 && r.laborHours === 0 && (r.baselineOrders ?? 0) === 0);
  if (empty) {
    return (
      <p className="flex items-center justify-center text-sm text-[var(--admin-text-faint)]" style={{ height }}>
        Traffic and labor will chart here once the day gets going.
      </p>
    );
  }
  return (
    <div style={{ height }} role="img" aria-label="Hourly revenue, transactions and labor hours">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: -4 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="name" tick={SMALL_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
          <YAxis yAxisId="money" tick={SMALL_TICK} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => compactMoney(v)} />
          <YAxis yAxisId="count" orientation="right" tick={SMALL_TICK} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
          <Tooltip
            {...TOOLTIP_STYLE}
            labelFormatter={(_l, p) => {
              const pl = p?.[0]?.payload as { label?: string; splh?: number | null; opl?: number | null; staff?: number | null } | undefined;
              const bits = [pl?.label ?? String(_l)];
              if (pl?.staff) bits.push(`${pl.staff} on the clock`);
              if (pl?.splh != null) bits.push(`${money(pl.splh)} per labor hour`);
              if (pl?.opl != null) bits.push(`${pl.opl} orders per labor hour`);
              return bits.join(" \u00b7 ");
            }}
            formatter={(value, name) => {
              if (name === "Revenue") return [money(typeof value === "number" ? value : null), name];
              return [value == null ? "\u2014" : String(value), String(name)];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted }} />
          <Bar yAxisId="money" dataKey="revenue" name="Revenue" fill="rgba(126,217,87,0.55)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Line yAxisId="count" dataKey="orders" name="Transactions" stroke={CHART_COLORS.gold} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          {hasBasis ? (
            <Line
              yAxisId="count"
              dataKey="basisOrders"
              name={`Transactions (${basisLabel.replace(/^vs /, "")})`}
              stroke="rgba(255,255,255,0.45)"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          {showLabor ? (
            <Line yAxisId="count" type="stepAfter" dataKey="labor" name="Labor hours" stroke={BLUE} strokeWidth={2} dot={false} isAnimationActive={false} />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
