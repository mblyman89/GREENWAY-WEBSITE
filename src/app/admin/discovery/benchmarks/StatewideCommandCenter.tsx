"use client";

/**
 * StatewideCommandCenter — the statewide CCRS benchmarks surface (Slice 8).
 *
 * Structure follows Shneiderman's Visual Information-Seeking Mantra (1996):
 * "Overview first, zoom and filter, then details-on-demand." That is exactly
 * TWO levels of progressive disclosure, which is Nielsen's recommended maximum:
 *
 *   Level 1 — the overview: headline tiles + one wide, sortable table per lens.
 *   Level 2 — details-on-demand: click any row to expand its mix inline.
 *
 * There is no third level. Every filter runs CLIENT-SIDE against data already
 * in memory, so a keystroke re-renders in well under 100ms — the threshold at
 * which a control stops feeling like a query and starts feeling like direct
 * manipulation.
 *
 * Facets (Whitenton, NN/g) carry their own counts so the control teaches the
 * shape of the data before it is touched.
 *
 * NEVER GUESS: every number comes from statewide-market-core, and anything
 * that was never measured renders "—". A dash is not a zero, and the
 * difference decides real purchase orders.
 */

import { Fragment, useCallback, useMemo, useState } from "react";

import { Badge, Card, CardHeader, Section } from "@/components/admin/ui";
import { StatCard } from "@/components/admin/StatCard";
import {
  buildFacet,
  concentrationLabel,
  matchesQuery,
  rowsToCsv,
  sortRows,
  DOH_CSV_COLUMNS,
  MARKET_CSV_COLUMNS,
  PRODUCER_CSV_COLUMNS,
  RETAILER_CSV_COLUMNS,
  type Concentration,
  type DohSellerRow,
  type DohVerdict,
  type MarketRow,
  type MixDetail,
  type ProducerRow,
  type RetailerRow,
  type SortDirection,
} from "@/lib/discovery/statewide-market-core";

// ---------------------------------------------------------------------------
// Formatting. Null ALWAYS renders as an em dash, never as 0.
// ---------------------------------------------------------------------------

function money(minor: number | null | undefined): string {
  if (minor == null) return "—";
  return `$${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact money for dense table cells: $1.5M, $12.3k. */
function moneyShort(minor: number | null | undefined): string {
  if (minor == null) return "—";
  const d = minor / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (Math.abs(d) >= 1_000) return `$${(d / 1_000).toFixed(1)}k`;
  return `$${d.toFixed(2)}`;
}

function num(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function index100(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(0);
}

/** mg/g is what WSLCB publishes; 1 mg/g = 0.1%, so divide by 10 for percent. */
function potency(mgPerG: number | null | undefined): string {
  if (mgPerG == null) return "—";
  return `${(mgPerG / 10).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Small primitives
// ---------------------------------------------------------------------------

const TH =
  "px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)] whitespace-nowrap";
const TD = "px-3 py-2 text-sm text-[var(--admin-text)] whitespace-nowrap";
const TD_NUM = `${TD} text-right tabular-nums`;

function SortHeader<K extends string>({
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
    <th className={`${TH} ${align === "right" ? "text-right" : ""}`} title={title} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
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
function Facet({
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

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
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
function ExportButton({ filename, csv, count }: { filename: string; csv: () => string; count: number }) {
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

function EmptyRow({ span, children }: { span: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={span} className="px-3 py-6 text-center text-sm text-[var(--admin-text-muted)]">
        {children}
      </td>
    </tr>
  );
}

/** Level 2 — details-on-demand. The mix behind one expanded row. */
function MixDetailPanel({ detail, span, note }: { detail: MixDetail; span: number; note?: string }) {
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

function ConcentrationBadge({ c }: { c: Concentration }) {
  if (c.hhi == null) return <Badge tone="neutral">Concentration not measured</Badge>;
  const tone = c.band === "highly_concentrated" ? "danger" : c.band === "moderately_concentrated" ? "gold" : "green";
  return (
    <Badge tone={tone}>
      HHI {num(c.hhi)} · {concentrationLabel(c.band)}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Lens 1 — the market table (categories)
// ---------------------------------------------------------------------------

type MarketSortKey =
  | "key"
  | "units"
  | "revenue"
  | "share"
  | "retailMedian"
  | "wholesaleMedian"
  | "margin"
  | "marginPct"
  | "ppg"
  | "wsPpg"
  | "medicalShare"
  | "dohShare"
  | "thc"
  | "cbd";

/**
 * The three lenses the state's own taxonomy supports. Switching scope keeps
 * the same columns and the same definitions — only the grain changes, which is
 * a zoom, not a new screen.
 */
export type MarketScope = "type" | "brand" | "strain";

const SCOPE_LABEL: Record<MarketScope, string> = {
  type: "Category",
  brand: "Brand",
  strain: "Strain",
};

function MarketLens({
  byScope,
  detailFor,
  monthLabel,
}: {
  byScope: Record<MarketScope, MarketRow[]>;
  /** Level 2 payload for a row, resolved by scope + key. */
  detailFor: (scope: MarketScope, key: string) => MixDetail;
  monthLabel: string;
}) {
  const [scope, setScope] = useState<MarketScope>("type");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<MarketSortKey>("revenue");
  const [dir, setDir] = useState<SortDirection>("desc");
  const [open, setOpen] = useState<string | null>(null);
  // Facet: only show rows where the retailer actually captures a spread.
  const [spreadOnly, setSpreadOnly] = useState(false);

  const rows = byScope[scope];

  const onSort = useCallback((k: MarketSortKey) => {
    setSortKey((prev) => {
      if (prev === k) {
        setDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setDir("desc");
      return k;
    });
  }, []);

  const accessor = useCallback(
    (r: MarketRow): number | string | null => {
      switch (sortKey) {
        case "key":
          return r.key;
        case "units":
          return r.retail.units;
        case "revenue":
          return r.retail.revenueMinor;
        case "share":
          return r.revenueShare;
        case "retailMedian":
          return r.retail.medianUnitPriceMinor;
        case "wholesaleMedian":
          return r.wholesale.medianUnitPriceMinor;
        case "margin":
          return r.marginMinor;
        case "marginPct":
          return r.marginPct;
        case "ppg":
          return r.retail.medianPpgMinor;
        case "wsPpg":
          return r.wholesale.medianPpgMinor;
        case "medicalShare":
          return r.medicalShare;
        case "dohShare":
          return r.dohShare;
        case "thc":
          return r.totalThcMgPerG;
        case "cbd":
          return r.totalCbdMgPerG;
        default:
          return null;
      }
    },
    [sortKey],
  );

  const visible = useMemo(() => {
    const filtered = rows.filter(
      (r) => matchesQuery(query, [r.key]) && (!spreadOnly || (r.marginMinor != null && r.marginMinor > 0)),
    );
    return sortRows(filtered, accessor, dir);
  }, [rows, query, spreadOnly, accessor, dir]);

  const COLS = 15;

  return (
    <Card>
      <CardHeader
        title={`The market, by ${SCOPE_LABEL[scope].toLowerCase()}`}
        subtitle="Shelf price, buying price, and the spread between them — on one screen."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={query} onChange={setQuery} placeholder={`Filter ${SCOPE_LABEL[scope].toLowerCase()}s…`} />
            <ExportButton
              filename={`statewide-market-${scope}-${monthLabel.replace(/\s+/g, "-").toLowerCase()}.csv`}
              csv={() => rowsToCsv(visible, MARKET_CSV_COLUMNS)}
              count={visible.length}
            />
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--admin-border)] px-4 py-2.5">
        <div className="inline-flex rounded-full bg-[var(--admin-surface-2)] p-0.5">
          {(["type", "brand", "strain"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setScope(s);
                setOpen(null);
              }}
              className={`admin-focus rounded-full px-3 py-1 text-xs font-semibold transition ${
                scope === s ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "text-[var(--admin-text-muted)]"
              }`}
            >
              {SCOPE_LABEL[s]}
              <span className="ml-1 opacity-60">{byScope[s].length}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSpreadOnly((v) => !v)}
          className={`admin-focus rounded-full px-2.5 py-1 text-xs font-semibold transition ${
            spreadOnly
              ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
              : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
          }`}
          title="Show only rows where both a retail and a wholesale median were measured and the retail price is higher"
        >
          Measurable spread only
        </button>
        <span className="text-xs text-[var(--admin-text-muted)]">
          {visible.length} of {rows.length}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-[var(--admin-border)]">
            <tr>
              <SortHeader label={SCOPE_LABEL[scope]} colKey="key" sortKey={sortKey} dir={dir} onSort={onSort} />
              <SortHeader label="Units" colKey="units" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="Revenue" colKey="revenue" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="Share" colKey="share" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader
                label="Retail med."
                colKey="retailMedian"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Median retail unit price"
              />
              <SortHeader
                label="Wholesale med."
                colKey="wholesaleMedian"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Median wholesale unit price"
              />
              <SortHeader
                label="Spread"
                colKey="margin"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Retail median minus wholesale median — the gross dollars a retailer keeps on a typical unit"
              />
              <SortHeader label="Spread %" colKey="marginPct" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader
                label="$/g retail"
                colKey="ppg"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Median retail price per gram — normalized across pack sizes so grains are comparable"
              />
              <SortHeader
                label="$/g wholesale"
                colKey="wsPpg"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Median wholesale price per gram — your normalized buying benchmark"
              />
              <SortHeader
                label="Medical"
                colKey="medicalShare"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Share of this category's retail revenue sold on a medical (RecreationalMedical) sale"
              />
              <SortHeader
                label="DOH"
                colKey="dohShare"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Share of this category's retail revenue from DOH-compliant product (chapter 246-70 WAC)"
              />
              <SortHeader
                label="THC"
                colKey="thc"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Median lab-tested Total THC, converted from the mg/g the state publishes"
              />
              <SortHeader
                label="CBD"
                colKey="cbd"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Median lab-tested Total CBD, converted from the mg/g the state publishes"
              />
              <th className={TH} />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]/50">
            {visible.length === 0 ? (
              <EmptyRow span={COLS}>
                {rows.length === 0
                  ? "Nothing was measured at this grain for this month."
                  : "No rows match this filter."}
              </EmptyRow>
            ) : (
              visible.map((r) => {
                const isOpen = open === r.key;
                return (
                  <Fragment key={r.key}>
                    <tr
                      className="cursor-pointer transition hover:bg-[var(--admin-surface-2)]/60"
                      onClick={() => setOpen(isOpen ? null : r.key)}
                    >
                      <td className={`${TD} font-medium`}>{r.key}</td>
                      <td className={TD_NUM}>{num(r.retail.units)}</td>
                      <td className={TD_NUM}>{moneyShort(r.retail.revenueMinor)}</td>
                      <td className={TD_NUM}>{pct(r.revenueShare)}</td>
                      <td className={TD_NUM}>{money(r.retail.medianUnitPriceMinor)}</td>
                      <td className={TD_NUM}>{money(r.wholesale.medianUnitPriceMinor)}</td>
                      <td className={`${TD_NUM} ${r.marginMinor != null && r.marginMinor > 0 ? "text-[var(--admin-accent)]" : ""}`}>
                        {money(r.marginMinor)}
                      </td>
                      <td className={TD_NUM}>{pct(r.marginPct)}</td>
                      <td className={TD_NUM}>{money(r.retail.medianPpgMinor)}</td>
                      <td className={TD_NUM}>{money(r.wholesale.medianPpgMinor)}</td>
                      <td className={TD_NUM}>{pct(r.medicalShare)}</td>
                      <td className={TD_NUM}>{pct(r.dohShare)}</td>
                      <td className={TD_NUM}>{potency(r.totalThcMgPerG)}</td>
                      <td className={TD_NUM}>{potency(r.totalCbdMgPerG)}</td>
                      <td className={`${TD} text-right text-xs text-[var(--admin-text-muted)]`}>{isOpen ? "▲" : "▼"}</td>
                    </tr>
                    {isOpen ? (
                      <MixDetailPanel
                        span={COLS}
                        detail={detailFor(scope, r.key)}
                        note="The state's best-selling products at this grain, with the vendor behind each where the manifest could verify it."
                      />
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lens 2 — retailers
// ---------------------------------------------------------------------------

type RetailerSortKey =
  | "name"
  | "city"
  | "units"
  | "revenue"
  | "share"
  | "median"
  | "perLine"
  | "types"
  | "velocity"
  | "fairShare"
  | "spend";

function RetailerLens({ rows, concentration, monthLabel }: { rows: RetailerRow[]; concentration: Concentration; monthLabel: string }) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<RetailerSortKey>("revenue");
  const [dir, setDir] = useState<SortDirection>("desc");
  const [open, setOpen] = useState<string | null>(null);

  const cities = useMemo(() => buildFacet(rows, (r) => r.city).slice(0, 14), [rows]);

  const onSort = useCallback((k: RetailerSortKey) => {
    setSortKey((prev) => {
      if (prev === k) {
        setDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setDir("desc");
      return k;
    });
  }, []);

  const accessor = useCallback(
    (r: RetailerRow): number | string | null => {
      switch (sortKey) {
        case "name":
          return r.name;
        case "city":
          return r.city;
        case "units":
          return r.units;
        case "revenue":
          return r.revenueMinor;
        case "share":
          return r.revenueShare;
        case "median":
          return r.medianUnitPriceMinor;
        case "perLine":
          return r.revenuePerLineMinor;
        case "types":
          return r.typesCarried;
        case "velocity":
          return r.velocityMinor;
        case "fairShare":
          return r.fairShareIndex;
        case "spend":
          return r.wholesaleSpendMinor;
        default:
          return null;
      }
    },
    [sortKey],
  );

  const visible = useMemo(() => {
    const filtered = rows.filter(
      (r) => matchesQuery(query, [r.name, r.licenseNumber, r.city]) && (city == null || r.city === city),
    );
    return sortRows(filtered, accessor, dir);
  }, [rows, query, city, accessor, dir]);

  const COLS = 12;

  return (
    <Card>
      <CardHeader
        title="Stores"
        subtitle="Who is winning, and whether they earn it on price, breadth, or basket size."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={query} onChange={setQuery} placeholder="Search stores…" />
            <ExportButton
              filename={`statewide-stores-${monthLabel.replace(/\s+/g, "-").toLowerCase()}.csv`}
              csv={() => rowsToCsv(visible, RETAILER_CSV_COLUMNS)}
              count={visible.length}
            />
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--admin-border)] px-4 py-2.5">
        <Facet label="City" options={cities} selected={city} onChange={setCity} />
        <ConcentrationBadge c={concentration} />
        <span className="text-xs text-[var(--admin-text-muted)]">
          {visible.length} of {rows.length} stores
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-[var(--admin-border)]">
            <tr>
              <SortHeader label="Store" colKey="name" sortKey={sortKey} dir={dir} onSort={onSort} />
              <SortHeader label="City" colKey="city" sortKey={sortKey} dir={dir} onSort={onSort} />
              <SortHeader label="Units" colKey="units" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="Revenue" colKey="revenue" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="Share" colKey="share" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="Med. price" colKey="median" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader
                label="$/line"
                colKey="perLine"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Revenue per sale line — a basket-size proxy"
              />
              <SortHeader label="Cats." colKey="types" sortKey={sortKey} dir={dir} onSort={onSort} align="right" title="Distinct categories carried" />
              <SortHeader
                label="Velocity"
                colKey="velocity"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Revenue per category carried — how hard each category works"
              />
              <SortHeader
                label="Fair share"
                colKey="fairShare"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="100 = par. Above 100 means the store earns more than its breadth of assortment would predict."
              />
              <SortHeader label="Wholesale spend" colKey="spend" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <th className={TH} />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]/50">
            {visible.length === 0 ? (
              <EmptyRow span={COLS}>No stores match this filter.</EmptyRow>
            ) : (
              visible.map((r) => {
                const isOpen = open === r.licenseNumber;
                return (
                  <Fragment key={r.licenseNumber}>
                    <tr
                      className="cursor-pointer transition hover:bg-[var(--admin-surface-2)]/60"
                      onClick={() => setOpen(isOpen ? null : r.licenseNumber)}
                    >
                      <td className={`${TD} font-medium`}>
                        {r.name}
                        <span className="ml-2 text-xs text-[var(--admin-text-muted)]">{r.licenseNumber}</span>
                      </td>
                      <td className={TD}>{r.city ?? "—"}</td>
                      <td className={TD_NUM}>{num(r.units)}</td>
                      <td className={TD_NUM}>{moneyShort(r.revenueMinor)}</td>
                      <td className={TD_NUM}>{pct(r.revenueShare)}</td>
                      <td className={TD_NUM}>{money(r.medianUnitPriceMinor)}</td>
                      <td className={TD_NUM}>{money(r.revenuePerLineMinor)}</td>
                      <td className={TD_NUM}>{num(r.typesCarried)}</td>
                      <td className={TD_NUM}>{moneyShort(r.velocityMinor)}</td>
                      <td
                        className={`${TD_NUM} ${
                          r.fairShareIndex == null
                            ? ""
                            : r.fairShareIndex >= 100
                              ? "text-[var(--admin-accent)]"
                              : "text-[var(--admin-text-muted)]"
                        }`}
                      >
                        {index100(r.fairShareIndex)}
                      </td>
                      <td className={TD_NUM}>{moneyShort(r.wholesaleSpendMinor)}</td>
                      <td className={`${TD} text-right text-xs text-[var(--admin-text-muted)]`}>{isOpen ? "▲" : "▼"}</td>
                    </tr>
                    {isOpen ? <MixDetailPanel span={COLS} detail={r.detail} /> : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lens 3 — producers / processors (two signals, side by side, never summed)
// ---------------------------------------------------------------------------

type ProducerSortKey =
  | "name"
  | "units"
  | "revenue"
  | "share"
  | "lines"
  | "median"
  | "points"
  | "velocity"
  | "fairShare"
  | "topType"
  | "doh";

function ProducerLens({
  sellIn,
  sellThrough,
  sellInConcentration,
  monthLabel,
  sampleLines,
  retailLines,
}: {
  sellIn: ProducerRow[];
  sellThrough: ProducerRow[];
  sellInConcentration: Concentration;
  monthLabel: string;
  sampleLines: number | null;
  retailLines: number | null;
}) {
  const [signal, setSignal] = useState<"sell_in" | "sell_through">("sell_in");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<ProducerSortKey>("revenue");
  const [dir, setDir] = useState<SortDirection>("desc");
  const [open, setOpen] = useState<string | null>(null);

  const rows = signal === "sell_in" ? sellIn : sellThrough;
  const types = useMemo(() => buildFacet(rows, (r) => r.topType).slice(0, 12), [rows]);

  const onSort = useCallback((k: ProducerSortKey) => {
    setSortKey((prev) => {
      if (prev === k) {
        setDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setDir("desc");
      return k;
    });
  }, []);

  const accessor = useCallback(
    (r: ProducerRow): number | string | null => {
      switch (sortKey) {
        case "name":
          return r.name;
        case "units":
          return r.units;
        case "revenue":
          return r.revenueMinor;
        case "share":
          return r.revenueShare;
        case "lines":
          return r.lineCount;
        case "median":
          return r.medianUnitPriceMinor;
        case "points":
          return r.distributionPoints;
        case "velocity":
          return r.velocityMinor;
        case "fairShare":
          return r.fairShareIndex;
        case "topType":
          return r.topType;
        case "doh":
          return r.dohLineCount;
        default:
          return null;
      }
    },
    [sortKey],
  );

  const visible = useMemo(() => {
    const filtered = rows.filter(
      (r) => matchesQuery(query, [r.name, r.licenseNumber, r.topType]) && (type == null || r.topType === type),
    );
    return sortRows(filtered, accessor, dir);
  }, [rows, query, type, accessor, dir]);

  const isSellIn = signal === "sell_in";
  const COLS = 12;
  const sampleShare = sampleLines != null && retailLines != null && retailLines > 0 ? sampleLines / retailLines : null;

  return (
    <Card>
      <CardHeader
        title="Producers & processors"
        subtitle="What they actually move — the input for purchase-order decisions."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={query} onChange={setQuery} placeholder="Search producers…" />
            <ExportButton
              filename={`statewide-producers-${signal}-${monthLabel.replace(/\s+/g, "-").toLowerCase()}.csv`}
              csv={() => rowsToCsv(visible, PRODUCER_CSV_COLUMNS)}
              count={visible.length}
            />
          </div>
        }
      />
      {/* The signal switch is the most important control on this card: the two
          measurements have different coverage and must never be added. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--admin-border)] px-4 py-2.5">
        <div className="inline-flex rounded-full bg-[var(--admin-surface-2)] p-0.5">
          <button
            type="button"
            onClick={() => {
              setSignal("sell_in");
              setType(null);
              setOpen(null);
            }}
            className={`admin-focus rounded-full px-3 py-1 text-xs font-semibold transition ${
              isSellIn ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "text-[var(--admin-text-muted)]"
            }`}
          >
            Shipped to stores ({sellIn.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setSignal("sell_through");
              setType(null);
              setOpen(null);
            }}
            className={`admin-focus rounded-full px-3 py-1 text-xs font-semibold transition ${
              !isSellIn ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "text-[var(--admin-text-muted)]"
            }`}
          >
            Bought by customers ({sellThrough.length})
          </button>
        </div>
        <Facet label="Top category" options={types} selected={type} onChange={setType} />
        {isSellIn ? <ConcentrationBadge c={sellInConcentration} /> : null}
        <span className="text-xs text-[var(--admin-text-muted)]">
          {visible.length} of {rows.length}
        </span>
      </div>
      <div className="border-b border-[var(--admin-border)] bg-[var(--admin-surface-2)]/40 px-4 py-2.5">
        {isSellIn ? (
          <p className="text-xs text-[var(--admin-text-muted)]">
            <Badge tone="green">Near-complete</Badge> Wholesale invoices — what each producer shipped into
            stores, and at what price. This is the sell-in side: it tells you what they cost.
          </p>
        ) : (
          <p className="text-xs text-[var(--admin-text-muted)]">
            <Badge tone="gold">Sample</Badge> Retail lines traced back to their maker through the manifest
            origin join
            {sampleLines != null ? (
              <>
                {" "}
                — {num(sampleLines)}
                {retailLines != null ? <> of {num(retailLines)}</> : null} retail lines
                {sampleShare != null ? <> ({pct(sampleShare)})</> : null}
              </>
            ) : null}
            . Directionally reliable for ranking, but <strong>never add these dollars to the shipped
            figures</strong> — they measure different things at different scales.
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-[var(--admin-border)]">
            <tr>
              <SortHeader label="Producer" colKey="name" sortKey={sortKey} dir={dir} onSort={onSort} />
              <SortHeader label="Units" colKey="units" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader
                label={isSellIn ? "Wholesale $" : "Retail $"}
                colKey="revenue"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
              />
              <SortHeader label="Share" colKey="share" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="Lines" colKey="lines" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader
                label="Med. price"
                colKey="median"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title={isSellIn ? "Median wholesale unit price — what it costs you" : "Median shelf price — what it sells for"}
              />
              <SortHeader
                label={isSellIn ? "Buyers" : "Stores"}
                colKey="points"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Distribution points — how many stores"
              />
              <SortHeader
                label="Velocity"
                colKey="velocity"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Revenue per store — a wide-but-thin vendor scores low, a narrow-but-deep one scores high"
              />
              <SortHeader
                label="Fair share"
                colKey="fairShare"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="100 = par against distribution breadth"
              />
              <SortHeader label="Top category" colKey="topType" sortKey={sortKey} dir={dir} onSort={onSort} />
              <SortHeader
                label={isSellIn ? "Unmatched" : "DOH lines"}
                colKey="doh"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title={
                  isSellIn
                    ? "Wholesale lines whose lot never resolved to a product — the honest denominator on the mix"
                    : "How many of this vendor's retail lines were DOH-compliant lots"
                }
              />
              <th className={TH} />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]/50">
            {visible.length === 0 ? (
              <EmptyRow span={COLS}>
                {rows.length === 0
                  ? "Not measured for this month. Re-upload the monthly zip to capture producer detail."
                  : "No producers match this filter."}
              </EmptyRow>
            ) : (
              visible.map((r) => {
                const isOpen = open === r.id;
                return (
                  <Fragment key={`${r.signal}-${r.id}`}>
                    <tr
                      className="cursor-pointer transition hover:bg-[var(--admin-surface-2)]/60"
                      onClick={() => setOpen(isOpen ? null : r.id)}
                    >
                      <td className={`${TD} font-medium`}>
                        {r.name}
                        {r.licenseNumber ? (
                          <span className="ml-2 text-xs text-[var(--admin-text-muted)]">{r.licenseNumber}</span>
                        ) : null}
                      </td>
                      <td className={TD_NUM}>{num(r.units)}</td>
                      <td className={TD_NUM}>{moneyShort(r.revenueMinor)}</td>
                      <td className={TD_NUM}>{pct(r.revenueShare)}</td>
                      <td className={TD_NUM}>{num(r.lineCount)}</td>
                      <td className={TD_NUM}>{money(r.medianUnitPriceMinor)}</td>
                      <td className={TD_NUM}>{num(r.distributionPoints)}</td>
                      <td className={TD_NUM}>{moneyShort(r.velocityMinor)}</td>
                      <td
                        className={`${TD_NUM} ${
                          r.fairShareIndex == null
                            ? ""
                            : r.fairShareIndex >= 100
                              ? "text-[var(--admin-accent)]"
                              : "text-[var(--admin-text-muted)]"
                        }`}
                      >
                        {index100(r.fairShareIndex)}
                      </td>
                      <td className={TD}>
                        {r.topType ?? "—"}
                        {r.topTypeShare != null ? (
                          <span className="ml-1 text-xs text-[var(--admin-text-muted)]">{pct(r.topTypeShare)}</span>
                        ) : null}
                      </td>
                      <td className={TD_NUM}>{num(isSellIn ? r.unattributedLines : r.dohLineCount)}</td>
                      <td className={`${TD} text-right text-xs text-[var(--admin-text-muted)]`}>{isOpen ? "▲" : "▼"}</td>
                    </tr>
                    {isOpen ? (
                      <MixDetailPanel
                        span={COLS}
                        detail={r.detail}
                        note={
                          isSellIn
                            ? "Wholesale sell-in: what this producer shipped, and what you would pay."
                            : "Retail sell-through from the manifest-origin sample — what customers actually bought."
                        }
                      />
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lens 4 — DOH / the medical-endorsement question
// ---------------------------------------------------------------------------

type DohSortKey = "name" | "units" | "revenue" | "share" | "lines" | "median" | "perLine";

function DohLens({ rows, verdict, monthLabel }: { rows: DohSellerRow[]; verdict: DohVerdict; monthLabel: string }) {
  const [query, setQuery] = useState("");
  const [rosterOnly, setRosterOnly] = useState(false);
  const [sortKey, setSortKey] = useState<DohSortKey>("revenue");
  const [dir, setDir] = useState<SortDirection>("desc");

  const onSort = useCallback((k: DohSortKey) => {
    setSortKey((prev) => {
      if (prev === k) {
        setDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setDir("desc");
      return k;
    });
  }, []);

  const accessor = useCallback(
    (r: DohSellerRow): number | string | null => {
      switch (sortKey) {
        case "name":
          return r.name;
        case "units":
          return r.units;
        case "revenue":
          return r.revenueMinor;
        case "share":
          return r.revenueShare;
        case "lines":
          return r.lineCount;
        case "median":
          return r.medianUnitPriceMinor;
        case "perLine":
          return r.revenuePerLineMinor;
        default:
          return null;
      }
    },
    [sortKey],
  );

  const visible = useMemo(() => {
    const filtered = rows.filter(
      (r) => matchesQuery(query, [r.name, r.licenseNumber]) && (!rosterOnly || r.tracked || r.isSelf),
    );
    return sortRows(filtered, accessor, dir);
  }, [rows, query, rosterOnly, accessor, dir]);

  const COLS = 8;

  return (
    <Card>
      <CardHeader
        title="DOH-compliant product — is the medical endorsement worth it?"
        subtitle="Who sells DOH product, how much of it, and whether it carries a price premium."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={query} onChange={setQuery} placeholder="Search DOH sellers…" />
            <ExportButton
              filename={`statewide-doh-${monthLabel.replace(/\s+/g, "-").toLowerCase()}.csv`}
              csv={() => rowsToCsv(visible, DOH_CSV_COLUMNS)}
              count={visible.length}
            />
          </div>
        }
      />
      <div className="grid gap-4 border-b border-[var(--admin-border)] px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
            DOH price premium
          </p>
          <p
            className={`text-2xl font-black tabular-nums ${
              verdict.premiumPct == null
                ? "text-[var(--admin-text-muted)]"
                : verdict.premiumPct > 0
                  ? "text-[var(--admin-accent)]"
                  : "text-[var(--admin-orange)]"
            }`}
          >
            {verdict.premiumPct == null ? "—" : `${verdict.premiumPct > 0 ? "+" : ""}${(verdict.premiumPct * 100).toFixed(1)}%`}
          </p>
          <p className="text-xs text-[var(--admin-text-muted)]">
            {money(verdict.dohMedianUnitPriceMinor)} DOH vs {money(verdict.retailMedianUnitPriceMinor)} overall
          </p>
        </div>
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
            DOH revenue
          </p>
          <p className="text-2xl font-black tabular-nums text-[var(--admin-text)]">{moneyShort(verdict.revenueMinor)}</p>
          <p className="text-xs text-[var(--admin-text-muted)]">{num(verdict.unitsTotal)} units</p>
        </div>
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
            Share of readable lines
          </p>
          <p className="text-2xl font-black tabular-nums text-[var(--admin-text)]">{pct(verdict.dohLineShare)}</p>
          <p className="text-xs text-[var(--admin-text-muted)]">lines with a readable DOH answer only</p>
        </div>
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
            Sellers
          </p>
          <p className="text-2xl font-black tabular-nums text-[var(--admin-text)]">{num(verdict.sellerCount)}</p>
          <p className="text-xs text-[var(--admin-text-muted)]">
            {num(verdict.trackedSellerCount)} on your roster
            {verdict.selfPresent ? " · you are selling DOH" : " · you are not"}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--admin-border)] px-4 py-2.5">
        <button
          type="button"
          onClick={() => setRosterOnly((v) => !v)}
          className={`admin-focus rounded-full px-2.5 py-1 text-xs font-semibold transition ${
            rosterOnly
              ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
              : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
          }`}
        >
          My roster only
        </button>
        <ConcentrationBadge c={verdict.concentration} />
        <span className="text-xs text-[var(--admin-text-muted)]">
          {visible.length} of {rows.length} sellers
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-[var(--admin-border)]">
            <tr>
              <SortHeader label="Store" colKey="name" sortKey={sortKey} dir={dir} onSort={onSort} />
              <SortHeader label="DOH units" colKey="units" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="DOH revenue" colKey="revenue" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="Share" colKey="share" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="Lines" colKey="lines" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="Med. price" colKey="median" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="$/line" colKey="perLine" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <th className={TH} />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]/50">
            {visible.length === 0 ? (
              <EmptyRow span={COLS}>
                {rows.length === 0
                  ? "No DOH activity was measured for this month. Re-upload the monthly zip to capture it."
                  : "No sellers match this filter."}
              </EmptyRow>
            ) : (
              visible.map((r) => (
                <tr
                  key={`${r.licenseNumber ?? r.name}`}
                  className={r.isSelf ? "bg-[var(--admin-accent-soft)]/30" : undefined}
                >
                  <td className={`${TD} font-medium`}>
                    {r.name}
                    {r.isSelf ? (
                      <Badge tone="green" className="ml-2">
                        You
                      </Badge>
                    ) : r.tracked ? (
                      <Badge tone="gold" className="ml-2">
                        Roster
                      </Badge>
                    ) : null}
                  </td>
                  <td className={TD_NUM}>{num(r.units)}</td>
                  <td className={TD_NUM}>{moneyShort(r.revenueMinor)}</td>
                  <td className={TD_NUM}>{pct(r.revenueShare)}</td>
                  <td className={TD_NUM}>{num(r.lineCount)}</td>
                  <td className={TD_NUM}>{money(r.medianUnitPriceMinor)}</td>
                  <td className={TD_NUM}>{money(r.revenuePerLineMinor)}</td>
                  <td className={TD} />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The shell — Level 1 overview, then the lenses
// ---------------------------------------------------------------------------

export type StatewideCommandCenterProps = {
  monthLabel: string;
  market: Record<MarketScope, MarketRow[]>;
  /**
   * Named-product leaderboards keyed `${scope}\u0001${key}` — the level-2
   * payload for a market row. A key that is absent was never measured, which
   * the panel says out loud rather than rendering an empty table.
   */
  marketDetail: Record<string, MixDetail>;
  retailers: RetailerRow[];
  sellIn: ProducerRow[];
  sellThrough: ProducerRow[];
  dohSellers: DohSellerRow[];
  dohVerdict: DohVerdict;
  retailerConcentration: Concentration;
  sellInConcentration: Concentration;
  headline: {
    retailMedianMinor: number | null;
    wholesaleMedianMinor: number | null;
    retailPpgMedianMinor: number | null;
    retailUnits: number | null;
    retailRevenueMinor: number | null;
    spreadMinor: number | null;
    spreadPct: number | null;
    retailLines: number | null;
    attributedShare: number | null;
    vendorSampleLines: number | null;
  };
};

type Lens = "market" | "stores" | "producers" | "doh";

export function StatewideCommandCenter(props: StatewideCommandCenterProps) {
  const { headline, monthLabel } = props;
  const [lens, setLens] = useState<Lens>("market");

  const detailFor = useCallback(
    (scope: MarketScope, key: string): MixDetail =>
      props.marketDetail[`${scope}\u0001${key}`] ?? { types: [], products: [] },
    [props.marketDetail],
  );

  const LENSES: Array<{ id: Lens; label: string; count: number }> = [
    { id: "market", label: "Market", count: props.market.type.length },
    { id: "stores", label: "Stores", count: props.retailers.length },
    { id: "producers", label: "Producers", count: props.sellIn.length + props.sellThrough.length },
    { id: "doh", label: "DOH / medical", count: props.dohSellers.length },
  ];

  return (
    <div className="space-y-6">
      {/* LEVEL 1 — the ten-second read. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Median shelf price"
          value={money(headline.retailMedianMinor)}
          hint={`$/gram ${money(headline.retailPpgMedianMinor)}`}
        />
        <StatCard
          label="Median wholesale"
          value={money(headline.wholesaleMedianMinor)}
          hint="what stores pay producers"
        />
        <StatCard
          label="Gross spread"
          value={money(headline.spreadMinor)}
          hint={headline.spreadPct == null ? "retail minus wholesale" : `${pct(headline.spreadPct)} of shelf price`}
          accent="green"
        />
        <StatCard
          label="Retail volume"
          value={num(headline.retailUnits)}
          hint={`revenue ${moneyShort(headline.retailRevenueMinor)}`}
        />
      </div>

      <p className="text-xs text-[var(--admin-text-muted)]">
        <Badge tone="neutral">Monthly drop</Badge> {monthLabel} · product detail resolved for{" "}
        {pct(headline.attributedShare)} of {num(headline.retailLines)} retail lines. A monthly WSLCB drop is a
        delta file: lines whose product joins did not resolve inside it are counted, never guessed.
      </p>

      {/* Lens switch — zoom. One lens at a time keeps the page to two levels. */}
      <div className="flex flex-wrap gap-1.5">
        {LENSES.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setLens(l.id)}
            className={`admin-focus rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-[0.1em] transition ${
              lens === l.id
                ? "bg-[var(--admin-accent)] text-[var(--admin-bg)]"
                : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
            }`}
          >
            {l.label}
            <span className="ml-1.5 opacity-70">{l.count}</span>
          </button>
        ))}
      </div>

      <Section>
        {lens === "market" ? (
          <MarketLens byScope={props.market} detailFor={detailFor} monthLabel={monthLabel} />
        ) : null}
        {lens === "stores" ? (
          <RetailerLens rows={props.retailers} concentration={props.retailerConcentration} monthLabel={monthLabel} />
        ) : null}
        {lens === "producers" ? (
          <ProducerLens
            sellIn={props.sellIn}
            sellThrough={props.sellThrough}
            sellInConcentration={props.sellInConcentration}
            monthLabel={monthLabel}
            sampleLines={headline.vendorSampleLines}
            retailLines={headline.retailLines}
          />
        ) : null}
        {lens === "doh" ? <DohLens rows={props.dohSellers} verdict={props.dohVerdict} monthLabel={monthLabel} /> : null}
      </Section>
    </div>
  );
}
