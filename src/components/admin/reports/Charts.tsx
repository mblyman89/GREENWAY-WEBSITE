/**
 * Dependency-free chart primitives for the Reports hub. Server-renderable
 * SVG/CSS — no Recharts/Tremor (keeps the bundle + disk footprint tiny). All
 * brand-token colors.
 */
import type { DayPoint, LabeledCount } from "@/lib/reports/analytics";

const GREEN = "#7ed957";
const GOLD = "#ffd700";
const ORANGE = "#ff7f00";

/** Horizontal bar list — good for top products/brands/categories. */
export function BarList({
  data,
  valueFormatter,
  color = GREEN,
  emptyLabel = "No data yet.",
}: {
  data: LabeledCount[];
  valueFormatter?: (v: number) => string;
  color?: string;
  emptyLabel?: string;
}) {
  if (!data.length) return <p className="text-sm text-white/40">{emptyLabel}</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const fmt = valueFormatter ?? ((v: number) => String(v));
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="grid grid-cols-[1fr_auto] items-center gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-xs font-bold text-white/80">{d.label}</span>
              <span className="shrink-0 text-xs font-black text-white/50">{fmt(d.value)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, backgroundColor: color }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Compact vertical bar chart for a day series (e.g. orders/revenue per day). */
export function DayBarChart({
  data,
  color = GREEN,
  valueFormatter,
  height = 120,
}: {
  data: DayPoint[];
  color?: string;
  valueFormatter?: (v: number) => string;
  height?: number;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const fmt = valueFormatter ?? ((v: number) => String(v));
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div>
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {data.map((d) => {
          const h = Math.max(2, (d.value / max) * height);
          return (
            <div
              key={d.date}
              className="group relative flex-1"
              style={{ height }}
              title={`${d.date}: ${fmt(d.value)}`}
            >
              <div
                className="absolute bottom-0 w-full rounded-t-sm opacity-80 transition group-hover:opacity-100"
                style={{ height: h, backgroundColor: color }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-[0.62rem] uppercase tracking-[0.1em] text-white/30">
        <span>{data[0]?.date}</span>
        <span className="text-white/50">Total {fmt(total)}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

/** Segmented bar showing a status breakdown. */
export function StatusBar({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/5">
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.label}
              style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
              title={`${s.label}: ${s.value}`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-white/60">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label} <span className="font-black text-white/80">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export const REPORT_COLORS = { GREEN, GOLD, ORANGE };
