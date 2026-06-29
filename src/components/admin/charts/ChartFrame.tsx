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
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      {(title || subtitle) && (
        <div className="mb-4">
          {title && <h3 className="text-sm font-semibold text-[var(--admin-text)]">{title}</h3>}
          {subtitle && <p className="text-xs text-[var(--admin-text-faint)]">{subtitle}</p>}
        </div>
      )}
      {isEmpty ? (
        <div
          className="flex items-center justify-center rounded-[var(--admin-radius-sm)] border border-dashed border-[var(--admin-border)] text-sm text-[var(--admin-text-faint)]"
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
