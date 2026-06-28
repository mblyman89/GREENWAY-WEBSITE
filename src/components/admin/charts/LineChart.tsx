"use client";

/**
 * LineChart — brand-styled multi-series line chart for trends over time.
 */
import {
  LineChart as RLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import { AXIS_TICK, CHART_COLORS, TOOLTIP_STYLE, paletteAt } from "./theme";

export type LineSeries = { key: string; label?: string; color?: string };

export function LineChart({
  data,
  lines,
  xKey = "name",
  title,
  subtitle,
  height,
  showLegend,
}: {
  data: Array<Record<string, string | number>>;
  lines: LineSeries[];
  xKey?: string;
  title?: string;
  subtitle?: string;
  height?: number;
  showLegend?: boolean;
}) {
  const isEmpty = !data || data.length === 0;
  const legend = showLegend ?? lines.length > 1;

  return (
    <ChartFrame title={title} subtitle={subtitle} height={height} isEmpty={isEmpty}>
      <RLineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
        <Tooltip {...TOOLTIP_STYLE} />
        {legend && <Legend wrapperStyle={{ fontSize: 12, color: CHART_COLORS.muted }} />}
        {lines.map((l, i) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            name={l.label ?? l.key}
            stroke={l.color ?? paletteAt(i)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </RLineChart>
    </ChartFrame>
  );
}
