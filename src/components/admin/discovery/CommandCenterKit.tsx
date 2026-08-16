"use client";

/**
 * CommandCenterKit — the shared presentation primitives behind BOTH benchmark
 * command centers (statewide, on the CCRS page; local, in Reports).
 *
 * Why this file exists: Slice 8 built these primitives inline for the
 * statewide page. Slice 9 needs the identical behaviour for the local page.
 * Copying them would let the two pages drift — a null rendering as "—" on one
 * screen and "0" on the other, or an export whose rows disagree with the table
 * above it. One definition, imported twice, makes that class of bug
 * impossible.
 *
 * Two rules are enforced here and must never be relaxed:
 *
 *  1. NULL IS NOT ZERO. Every formatter renders null/undefined as an em dash.
 *     "Never measured" and "measured as nothing" are different facts and the
 *     screen must not blur them.
 *  2. EXPORT MATCHES SCREEN. ExportButton serialises exactly the rows handed
 *     to it — already filtered and already sorted — because an export that
 *     silently differs from the view is how two people end up arguing about
 *     the same number.
 */

import { useCallback } from "react";

import { Badge } from "@/components/admin/ui";
import {
  concentrationLabel,
  type Concentration,
  type MixDetail,
  type SortDirection,
} from "@/lib/discovery/statewide-market-core";

// ---------------------------------------------------------------------------
// Formatting. Null ALWAYS renders as an em dash, never as 0.
// ---------------------------------------------------------------------------

export function money(minor: number | null | undefined): string {
  if (minor == null) return "—";
  return `$${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact money for dense table cells: $1.5M, $12.3k. */
export function moneyShort(minor: number | null | undefined): string {
  if (minor == null) return "—";
  const d = minor / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (Math.abs(d) >= 1_000) return `$${(d / 1_000).toFixed(1)}k`;
  return `$${d.toFixed(2)}`;
}

/**
 * Money carrying an explicit sign. Used for gap-versus-benchmark columns where
 * the DIRECTION is the whole point: -$1.40 means this store undercuts its
 * area, +$1.40 means it charges a premium.
 */
export function moneySigned(minor: number | null | undefined): string {
  if (minor == null) return "—";
  const sign = minor > 0 ? "+" : minor < 0 ? "−" : "";
  return `${sign}$${(Math.abs(minor) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function num(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

/** Signed percent, for the same "which way?" columns as moneySigned. */
export function pctSigned(v: number | null | undefined): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${(Math.abs(v) * 100).toFixed(1)}%`;
}

export function index100(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(0);
}

/** mg/g is what WSLCB publishes; 1 mg/g = 0.1%, so divide by 10 for percent. */
export function potency(mgPerG: number | null | undefined): string {
  if (mgPerG == null) return "—";
  return `${(mgPerG / 10).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Table cell classes
// ---------------------------------------------------------------------------

export const TH =
  "px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)] whitespace-nowrap";
export const TD = "px-3 py-2 text-sm text-[var(--admin-text)] whitespace-nowrap";
export const TD_NUM = `${TD} text-right tabular-nums`;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function SortHeader<K extends string>({
  label,
  colKey,
  sortKey,
  dir,
  onSort,
  align = "left",
  title,
}: {
  label: string;
  colKey: K;
  sortKey: K;
  dir: SortDirection;
  onSort: (k: K) => void;
  align?: "left" | "right";
  title?: string;
}) {
  const active = sortKey === colKey;
  return (
    <th
      className={`${TH} ${align === "right" ? "text-right" : ""}`}
      title={title}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(colKey)}
        className={`admin-focus inline-flex items-center gap-1 uppercase tracking-wide ${
          active ? "text-[var(--admin-accent)]" : "hover:text-[var(--admin-text)]"
        }`}
      >
        {label}
        <span aria-hidden="true" className="text-[0.6rem]">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

/** A facet: one filter per aspect, each option showing its own count. */
export function Facet({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; count: number }>;
  selected: string | null;
  onChange: (v: string | null) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`admin-focus rounded-full px-2.5 py-1 text-xs font-semibold transition ${
          selected == null
            ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
            : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
        }`}
      >
        All
      </button>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(selected === o.value ? null : o.value)}
          className={`admin-focus rounded-full px-2.5 py-1 text-xs font-semibold transition ${
            selected === o.value
              ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
              : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
          }`}
        >
          {o.value}
          <span className="ml-1 opacity-60">{o.count}</span>
        </button>
      ))}
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="admin-focus w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-sm text-[var(--admin-text)] placeholder:text-[var(--admin-text-muted)] sm:w-64"
    />
  );
}

/**
 * Extract — Shneiderman's seventh task. Downloads exactly what is on screen
 * (filtered and sorted), because an export that silently differs from the view
 * is how two people end up arguing over the same number.
 */
export function ExportButton({ filename, csv, count }: { filename: string; csv: () => string; count: number }) {
  const onClick = useCallback(() => {
    const blob = new Blob([csv()], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [csv, filename]);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={count === 0}
      className="admin-focus rounded-full bg-[var(--admin-surface-2)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)] transition hover:text-[var(--admin-text)] disabled:opacity-40"
      title="Download the rows exactly as filtered and sorted on screen"
    >
      Export {count > 0 ? `${count} rows` : "CSV"}
    </button>
  );
}

export function EmptyRow({ span, children }: { span: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={span} className="px-3 py-6 text-center text-sm text-[var(--admin-text-muted)]">
        {children}
      </td>
    </tr>
  );
}

/** Level 2 — details-on-demand. The mix behind one expanded row. */
export function MixDetailPanel({ detail, span, note }: { detail: MixDetail; span: number; note?: string }) {
  const hasTypes = detail.types.length > 0;
  const hasProducts = detail.products.length > 0;
  return (
    <tr className="bg-[var(--admin-surface-2)]/50">
      <td colSpan={span} className="px-4 py-4">
        {!hasTypes && !hasProducts ? (
          <p className="text-xs text-[var(--admin-text-muted)]">
            No product mix was measured for this row. Re-upload this month&apos;s zip to capture it — this is
            not the same as selling nothing.
          </p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {hasTypes && (
              <div>
                <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                  By category
                </p>
                <table className="w-full">
                  <tbody>
                    {detail.types.slice(0, 12).map((t) => (
                      <tr key={t.inventoryType} className="border-t border-[var(--admin-border)]/40">
                        <td className="py-1.5 pr-3 text-sm text-[var(--admin-text)]">{t.inventoryType}</td>
                        <td className="py-1.5 pr-3 text-right text-sm tabular-nums text-[var(--admin-text-muted)]">
                          {num(t.units)} u
                        </td>
                        <td className="py-1.5 pr-3 text-right text-sm tabular-nums text-[var(--admin-text)]">
                          {moneyShort(t.revenueMinor)}
                        </td>
                        <td className="py-1.5 text-right text-sm tabular-nums text-[var(--admin-text-muted)]">
                          {money(t.medianUnitPriceMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {hasProducts && (
              <div>
                <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                  Top products
                </p>
                <table className="w-full">
                  <tbody>
                    {detail.products.slice(0, 12).map((p, i) => (
                      <tr key={`${p.productName}-${i}`} className="border-t border-[var(--admin-border)]/40">
                        <td className="py-1.5 pr-3 text-sm text-[var(--admin-text)]">
                          {p.productName}
                          {p.brand ? (
                            <span className="ml-1 text-xs text-[var(--admin-text-muted)]">· {p.brand}</span>
                          ) : null}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-sm tabular-nums text-[var(--admin-text-muted)]">
                          {num(p.units)} u
                        </td>
                        <td className="py-1.5 pr-3 text-right text-sm tabular-nums text-[var(--admin-text)]">
                          {moneyShort(p.revenueMinor)}
                        </td>
                        <td className="py-1.5 text-right text-sm tabular-nums text-[var(--admin-text-muted)]">
                          {money(p.medianUnitPriceMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {note ? <p className="mt-3 text-xs text-[var(--admin-text-muted)]">{note}</p> : null}
      </td>
    </tr>
  );
}

export function ConcentrationBadge({ c }: { c: Concentration }) {
  if (c.hhi == null) return <Badge tone="neutral">Concentration not measured</Badge>;
  const tone = c.band === "highly_concentrated" ? "danger" : c.band === "moderately_concentrated" ? "gold" : "green";
  return (
    <Badge tone={tone}>
      HHI {num(c.hhi)} · {concentrationLabel(c.band)}
    </Badge>
  );
}
