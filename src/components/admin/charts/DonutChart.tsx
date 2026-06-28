"use client";

/**
 * DonutChart / PieChart — brand-styled categorical breakdown. Pass `innerRadius`
 * 0 for a full pie, or a positive value (default) for a donut with a center
 * total label.
 */
import {
  PieChart as RPieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import { CHART_COLORS, TOOLTIP_STYLE, paletteAt } from "./theme";

export type DonutDatum = { name: string; value: number; color?: string };

export function DonutChart({
  data,
  title,
  subtitle,
  height = 260,
  innerRadius = 60,
  outerRadius = 90,
  showLegend = true,
}: {
  data: DonutDatum[];
  title?: string;
  subtitle?: string;
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  showLegend?: boolean;
}) {
  const isEmpty = !data || data.length === 0 || data.every((d) => d.value === 0);

  return (
    <ChartFrame title={title} subtitle={subtitle} height={height} isEmpty={isEmpty}>
      <RPieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          paddingAngle={2}
          stroke={CHART_COLORS.charcoal}
        >
          {data.map((d, i) => (
            <Cell key={d.name} fill={d.color ?? paletteAt(i)} />
          ))}
        </Pie>
        <Tooltip {...TOOLTIP_STYLE} />
        {showLegend && (
          <Legend wrapperStyle={{ fontSize: 12, color: CHART_COLORS.muted }} />
        )}
      </RPieChart>
    </ChartFrame>
  );
}

/** Alias so callers can ask for a full pie explicitly. */
export function PieChart(props: Omit<Parameters<typeof DonutChart>[0], "innerRadius">) {
  return <DonutChart {...props} innerRadius={0} />;
}
