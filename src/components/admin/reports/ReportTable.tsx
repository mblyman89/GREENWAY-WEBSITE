/**
 * src/components/admin/reports/ReportTable.tsx
 *
 * A clean, reusable data table for the reporting suite. Server-rendered (no client
 * JS) so it stays fast. Supports right-aligned numeric columns, a totals row, and
 * an empty state.
 */
import type { ReactNode } from "react";

export type ReportColumn<Row> = {
  key: string;
  header: string;
  align?: "left" | "right";
  /** Render a cell. Defaults to String(row[key]). */
  render?: (row: Row) => ReactNode;
  /** Optional emphasis for the column (e.g. money). */
  emphasis?: boolean;
};

export function ReportTable<Row extends Record<string, unknown>>({
  columns,
  rows,
  totals,
  emptyLabel = "No data for this range.",
  caption,
}: {
  columns: ReportColumn<Row>[];
  rows: Row[];
  totals?: Partial<Record<string, ReactNode>>;
  emptyLabel?: string;
  caption?: string;
}) {
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/30 p-6 text-center text-sm text-white/40">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full border-collapse text-sm">
        {caption ? (
          <caption className="px-4 py-2 text-left text-xs font-bold uppercase tracking-[0.1em] text-white/40">
            {caption}
          </caption>
        ) : null}
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03]">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-4 py-2.5 text-[0.68rem] font-black uppercase tracking-[0.08em] text-white/50 ${
                  c.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-2.5 ${c.align === "right" ? "text-right tabular-nums" : "text-left"} ${
                    c.emphasis ? "font-bold text-white" : "text-white/80"
                  }`}
                >
                  {c.render ? c.render(row) : String(row[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals ? (
          <tfoot>
            <tr className="border-t border-white/15 bg-white/[0.04]">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-2.5 font-black text-white ${
                    c.align === "right" ? "text-right tabular-nums" : "text-left"
                  }`}
                >
                  {totals[c.key] ?? ""}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
