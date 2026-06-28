"use client";

/**
 * BarChart — brand-styled vertical bar chart. The app passes plain data + the
 * keys to plot; all colors/axes come from the shared theme.
 *
 *   <BarChart
 *     title="Items by category"
 *     data={[{ name: "Flower", value: 120 }, ...]}
 *     bars={[{ key: "value", label: "Items", color: CHART_COLORS.green }]}
 *   />
 */
import {
  BarChart as RBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import { AXIS_TICK, CHART_COLORS, TOOLTIP_STYLE, paletteAt } from "./theme";

export type BarSeries = { key: string; label?: string; color?: string };

export function BarChart({
  data,
  bars,
  xKey = "name",
  title,
  subtitle,
  height,
  stacked = false,
  showLegend,
}: {
  data: Array<Record<string, string | number>>;
  bars: BarSeries[];
  xKey?: string;
  title?: string;
  subtitle?: string;
  height?: number;
  stacked?: boolean;
  showLegend?: boolean;
}) {
  const isEmpty = !data || data.length === 0;
  const legend = showLegend ?? bars.length > 1;

  return (
    <ChartFrame title={title} subtitle={subtitle} height={height} isEmpty={isEmpty}>
      <RBarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
        <Tooltip {...TOOLTIP_STYLE} />
        {legend && <Legend wrapperStyle={{ fontSize: 12, color: CHART_COLORS.muted }} />}
        {bars.map((b, i) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.label ?? b.key}
            fill={b.color ?? paletteAt(i)}
            radius={[4, 4, 0, 0]}
            stackId={stacked ? "stack" : undefined}
          />
        ))}
      </RBarChart>
    </ChartFrame>
  );
}
