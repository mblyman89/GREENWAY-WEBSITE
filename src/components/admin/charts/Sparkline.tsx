"use client";

/**
 * Sparkline — a tiny inline trend line with no axes/labels, for stat cards.
 * Pass an array of numbers (or {value} objects).
 *
 *   <Sparkline data={[3, 5, 4, 8, 7, 10]} />
 */
import {
  AreaChart,
  Area,
  ResponsiveContainer,
} from "recharts";
import { CHART_COLORS } from "./theme";

export function Sparkline({
  data,
  color = CHART_COLORS.green,
  height = 40,
  width,
}: {
  data: Array<number | { value: number }>;
  color?: string;
  height?: number;
  width?: number;
}) {
  const series = data.map((d, i) => ({
    i,
    value: typeof d === "number" ? d : d.value,
  }));

  if (series.length === 0) {
    return <div style={{ height }} aria-hidden />;
  }

  const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <div style={{ width: width ?? "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${id})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
