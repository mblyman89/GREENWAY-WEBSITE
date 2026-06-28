"use client";

/**
 * ChartFrame — consistent card + title + empty state around any chart.
 * Wrappers render their chart inside a ResponsiveContainer of `height`.
 */
import type { ReactNode } from "react";
import { ResponsiveContainer } from "recharts";

export function ChartFrame({
  title,
  subtitle,
  height = 260,
  isEmpty,
  emptyLabel = "No data to show yet.",
  children,
}: {
  title?: string;
  subtitle?: string;
  height?: number;
  isEmpty?: boolean;
  emptyLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
      {(title || subtitle) && (
        <div className="mb-4">
          {title && <h3 className="text-sm font-semibold text-white">{title}</h3>}
          {subtitle && <p className="text-xs text-white/50">{subtitle}</p>}
        </div>
      )}
      {isEmpty ? (
        <div
          className="flex items-center justify-center rounded-lg border border-dashed border-white/10 text-sm text-white/40"
          style={{ height }}
        >
          {emptyLabel}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          {children as React.ReactElement}
        </ResponsiveContainer>
      )}
    </div>
  );
}
