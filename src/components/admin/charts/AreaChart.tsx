"use client";

/**
 * AreaChart — brand-styled area chart (filled trend). Good for cumulative or
 * volume-over-time visuals.
 */
import {
  AreaChart as RAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import { AXIS_TICK, CHART_COLORS, TOOLTIP_STYLE, paletteAt } from "./theme";

export type AreaSeries = { key: string; label?: string; color?: string };

export function AreaChart({
  data,
  areas,
  xKey = "name",
  title,
  subtitle,
  height,
  stacked = false,
  showLegend,
}: {
  data: Array<Record<string, string | number>>;
  areas: AreaSeries[];
  xKey?: string;
  title?: string;
  subtitle?: string;
  height?: number;
  stacked?: boolean;
  showLegend?: boolean;
}) {
  const isEmpty = !data || data.length === 0;
  const legend = showLegend ?? areas.length > 1;

  return (
    <ChartFrame title={title} subtitle={subtitle} height={height} isEmpty={isEmpty}>
      <RAreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
        <defs>
          {areas.map((a, i) => {
            const color = a.color ?? paletteAt(i);
            return (
              <linearGradient key={a.key} id={`grad-${a.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
        <Tooltip {...TOOLTIP_STYLE} />
        {legend && <Legend wrapperStyle={{ fontSize: 12, color: CHART_COLORS.muted }} />}
        {areas.map((a, i) => {
          const color = a.color ?? paletteAt(i);
          return (
            <Area
              key={a.key}
              type="monotone"
              dataKey={a.key}
              name={a.label ?? a.key}
              stroke={color}
              strokeWidth={2}
              fill={`url(#grad-${a.key})`}
              stackId={stacked ? "stack" : undefined}
            />
          );
        })}
      </RAreaChart>
    </ChartFrame>
  );
}
