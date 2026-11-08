"use client";

/**
 * D210g: the last four weeks.
 *
 *   SalesTrendChart   daily revenue bars (today's partial bar in gold) with
 *                     the 7-trading-day moving average as a line. A closed
 *                     day is a gap, never a $0 bar (closed-day rule).
 *   BasketTrendChart  average order and units per order, two lines.
 *   CustomerMixDonut  new / returning / guest share of today's orders.
 */
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendRow } from "@/lib/admin/cockpit-analytics-core";
import { BLUE, CHART_COLORS, SMALL_TICK, TOOLTIP_STYLE, VIOLET, compactMoney, money } from "./shared";

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow} ${m}/${d}`;
}

export function SalesTrendChart({ rows, height = 240 }: { rows: TrendRow[]; height?: number }) {
  const data = rows.map((r) => ({
    name: dayLabel(r.date),
    revenue: r.revenueMinor,
    ma: r.maRevenueMinor,
    orders: r.orders,
    isToday: r.isToday,
  }));
  if (!rows.some((r) => (r.revenueMinor ?? 0) > 0)) {
    return <p className="flex items-center justify-center text-sm text-[var(--admin-text-faint)]" style={{ height }}>No sales in the last four weeks yet.</p>;
  }
  return (
    <div style={{ height }} role="img" aria-label="Daily revenue, last 28 days, with a 7-day moving average">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="name" tick={SMALL_TICK} axisLine={false} tickLine={false} minTickGap={18} />
          <YAxis tick={SMALL_TICK} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => compactMoney(v)} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(v, name, item) => {
              const p = item?.payload as { orders?: number | null; isToday?: boolean } | undefined;
              if (name === "Revenue") {
                if (v == null) return ["Closed / no sales", name];
                return [`${money(typeof v === "number" ? v : null)} \u00b7 ${p?.orders ?? 0} orders${p?.isToday ? " (so far)" : ""}`, name];
              }
              return [money(typeof v === "number" ? v : null), String(name)];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted }} />
          <Bar dataKey="revenue" name="Revenue" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.isToday ? CHART_COLORS.gold : "rgba(126,217,87,0.6)"} />
            ))}
          </Bar>
          <Line dataKey="ma" name="7-day average" stroke={CHART_COLORS.fg} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BasketTrendChart({ rows, height = 200 }: { rows: TrendRow[]; height?: number }) {
  const data = rows.map((r) => ({
    name: dayLabel(r.date),
    aov: r.avgOrderMinor,
    upo: r.unitsPerOrder,
  }));
  if (!rows.some((r) => r.avgOrderMinor !== null)) {
    return <p className="flex items-center justify-center text-sm text-[var(--admin-text-faint)]" style={{ height }}>No baskets to chart yet.</p>;
  }
  return (
    <div style={{ height }} role="img" aria-label="Average order and units per order, last 28 days">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: -4 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="name" tick={SMALL_TICK} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis yAxisId="m" tick={SMALL_TICK} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => compactMoney(v)} />
          <YAxis yAxisId="u" orientation="right" tick={SMALL_TICK} axisLine={false} tickLine={false} width={28} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(v, name) => (name === "Avg. order" ? [money(typeof v === "number" ? v : null), name] : [v == null ? "\u2014" : String(v), String(name)])}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted }} />
          <Line yAxisId="m" dataKey="aov" name="Avg. order" stroke={CHART_COLORS.gold} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="u" dataKey="upo" name="Units per order" stroke={BLUE} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const MIX_COLORS = [CHART_COLORS.green, CHART_COLORS.gold, VIOLET];

export function CustomerMixDonut({
  rows,
  height = 200,
}: {
  rows: { label: string; orders: number; revenueMinorUnits: number }[];
  height?: number;
}) {
  const data = rows.map((r, i) => ({ name: r.label, value: r.orders, revenue: r.revenueMinorUnits, fill: MIX_COLORS[i % MIX_COLORS.length] }));
  const total = data.reduce((a, d) => a + d.value, 0);
  if (total === 0) {
    return <p className="flex items-center justify-center text-sm text-[var(--admin-text-faint)]" style={{ height }}>No orders yet today.</p>;
  }
  return (
    <div className="relative" style={{ height }} role="img" aria-label="Today's orders by customer type">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2} stroke={CHART_COLORS.charcoal} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(v, n, item) => {
              const r = (item?.payload as { revenue?: number } | undefined)?.revenue ?? 0;
              const c = typeof v === "number" ? v : 0;
              return [`${c} orders (${Math.round((c / total) * 100)}%) \u00b7 ${money(r)}`, String(n)];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
