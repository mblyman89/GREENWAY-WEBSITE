"use client";

/**
 * LocalCommandCenter — the neighbourhood war room.
 *
 * The statewide page answers "what is Washington doing?". This page answers
 * the only question that actually sets a shelf price in Port Orchard: "what
 * are the stores I compete with, on my street, doing right now?"
 *
 * STRUCTURE — Shneiderman (1996), "Overview first, zoom and filter, then
 * details-on-demand", and Nielsen's rule that progressive disclosure stays at
 * TWO levels:
 *
 *   Level 0  The headline strip. Home-area median, tracked stores, who is
 *            cheapest, who is priciest, how concentrated local revenue is.
 *   Level 1  ONE lens at a time — Stores / Areas / Vendors / Opportunities.
 *            Faceted, searchable, sortable, exportable. All filtering is
 *            client-side so it lands well under 100ms.
 *   Level 2  Click a row to expand its mix. That is the floor; there is no
 *            third level to get lost in.
 *
 * The predecessor stacked TEN sections and three tables vertically, so the
 * important number was always somewhere below the fold. Everything it showed
 * is still here — it is now reachable by choosing a lens instead of by
 * scrolling past nine things you did not ask for.
 *
 * NEVER GUESS. Every figure is rendered by the pure layer in
 * `local-market-core.ts`, which returns null when a thing was not measured.
 * Null prints as an em dash and exports as an empty cell. A store that sold
 * nothing and a store whose data never arrived must never look identical.
 */

import { Fragment, useCallback, useMemo, useState } from "react";

import { Badge, Card, CardHeader, Section } from "@/components/admin/ui";
import { StatCard } from "@/components/admin/StatCard";
import {
  ConcentrationBadge,
  EmptyRow,
  ExportButton,
  Facet,
  MixDetailPanel,
  SearchBox,
  SortHeader,
  TD,
  TD_NUM,
  TH,
  index100,
  money,
  moneyShort,
  moneySigned,
  num,
  pct,
  pctSigned,
} from "@/components/admin/discovery/CommandCenterKit";
import {
  LOCAL_AREA_CSV_COLUMNS,
  LOCAL_STORE_CSV_COLUMNS,
  LOCAL_VENDOR_CSV_COLUMNS,
  type LocalAreaRow,
  type LocalHeadline,
  type LocalStoreRow,
  type LocalVendorRow,
} from "@/lib/discovery/local-market-core";
import {
  buildFacet,
  matchesQuery,
  rowsToCsv,
  sortRows,
  type SortDirection,
} from "@/lib/discovery/statewide-market-core";

// ---------------------------------------------------------------------------
// Lens selection
// ---------------------------------------------------------------------------

export type LocalLens = "stores" | "areas" | "vendors" | "opportunities";

const LENSES: Array<{ id: LocalLens; label: string; blurb: string }> = [
  { id: "stores", label: "Stores", blurb: "Every tracked competitor, priced against its own area" },
  { id: "areas", label: "Areas", blurb: "How each neighbourhood prices and how much it sells" },
  { id: "vendors", label: "Vendors", blurb: "Who supplies your competitors — and who supplies several" },
  { id: "opportunities", label: "Opportunities", blurb: "Menu gaps, new suppliers, and switching" },
];

// ---------------------------------------------------------------------------
// Supporting row shapes owned by the server component
// ---------------------------------------------------------------------------

export type GapRowLike = {
  productName: string;
  inventoryType: string | null;
  brand: string | null;
  units: number;
  revenueMinor: number;
  medianUnitPriceMinor: number | null;
  p25UnitPriceMinor: number | null;
  status: string;
  statusLabel: string;
};

export type NewSupplierRowLike = {
  displayName: string;
  licenseNumber: string | null;
  lineCount: number;
  revenueMinor: number;
  distinctBuyers: number;
  trackedBuyers: number;
};

export type SwitchRowLike = {
  competitor: string;
  supplier: string;
  direction: "gained" | "lost";
  spendMinor: number | null;
  prevSpendMinor: number | null;
};

export type StatewideSupplierRowLike = {
  displayName: string;
  licenseNumber: string | null;
  revenueMinor: number | null;
  lineCount: number | null;
  p25Minor: number | null;
  medianMinor: number | null;
  p75Minor: number | null;
  distinctBuyers: number | null;
  trackedBuyers: number | null;
};

export type LocalCommandCenterProps = {
  headline: LocalHeadline;
  stores: LocalStoreRow[];
  areas: LocalAreaRow[];
  vendors: LocalVendorRow[];
  statewideSuppliers: StatewideSupplierRowLike[];
  gaps: GapRowLike[];
  gapSummary: { carried: number; brandCarried: number; notCarried: number; menuItems: number } | null;
  newSuppliers: NewSupplierRowLike[];
  newSupplierNote: string | null;
  switches: SwitchRowLike[];
  switchNote: string | null;
  homeAreaLabel: string;
  monthLabel: string;
  areaLabels: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Level 0 — the ten-second read
// ---------------------------------------------------------------------------

function Headline({ h, homeAreaLabel }: { h: LocalHeadline; homeAreaLabel: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label={`${homeAreaLabel} market median`}
        value={money(h.homeAreaMedianMinor)}
        hint={
          h.homeAreaStoreCount != null
            ? `Across ${num(h.homeAreaStoreCount)} tracked ${h.homeAreaStoreCount === 1 ? "store" : "stores"} — the number that sets your shelf`
            : "No store in your area reported a price this month"
        }
        accent="gold"
      />
      <StatCard
        label="Tracked competitors seen"
        value={num(h.storeCount)}
        hint="Roster stores with retail activity in this month's drop"
        accent="green"
      />
      <StatCard
        label="Cheapest tracked store"
        value={h.cheapestStore ? money(h.cheapestStore.medianMinor) : "—"}
        hint={h.cheapestStore ? h.cheapestStore.tradename : "No median price measured"}
        accent="orange"
      />
      <StatCard
        label="Competitor retail revenue"
        value={moneyShort(h.totalRevenueMinor)}
        hint={
          h.totalWholesaleSpendMinor != null
            ? `They spent ${moneyShort(h.totalWholesaleSpendMinor)} wholesale`
            : "Wholesale spend not measured this month"
        }
        accent="muted"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lens 1 — Stores
// ---------------------------------------------------------------------------

type StoreSortKey =
  | "tradename"
  | "area"
  | "units"
  | "revenue"
  | "share"
  | "p25"
  | "median"
  | "p75"
  | "vsArea"
  | "perLine"
  | "types"
  | "velocity"
  | "fairShare"
  | "wholesale"
  | "gap"
  | "suppliers";

const STORE_COLS = 17;

function StoreLens({
  rows,
  areaLabels,
  monthLabel,
}: {
  rows: LocalStoreRow[];
  areaLabels: Record<string, string>;
  monthLabel: string;
}) {
  const [sortKey, setSortKey] = useState<StoreSortKey>("revenue");
  const [dir, setDir] = useState<SortDirection>("desc");
  const [area, setArea] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const onSort = useCallback((k: StoreSortKey) => {
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
    (r: LocalStoreRow, k: StoreSortKey): string | number | null => {
      switch (k) {
        case "tradename":
          return r.tradename;
        case "area":
          return areaLabels[r.area] ?? r.area;
        case "units":
          return r.units;
        case "revenue":
          return r.revenueMinor;
        case "share":
          return r.revenueShare;
        case "p25":
          return r.p25Minor;
        case "median":
          return r.medianMinor;
        case "p75":
          return r.p75Minor;
        case "vsArea":
          return r.vsAreaMinor;
        case "perLine":
          return r.revenuePerLineMinor;
        case "types":
          return r.typesCarried;
        case "velocity":
          return r.velocityMinor;
        case "fairShare":
          return r.fairShareIndex;
        case "wholesale":
          return r.wholesaleSpendMinor;
        case "gap":
          return r.buySellGapMinor;
        case "suppliers":
          return r.supplierCount;
        default:
          return null;
      }
    },
    [areaLabels],
  );

  const areaFacet = useMemo(
    () => buildFacet(rows, (r) => areaLabels[r.area] ?? r.area),
    [rows, areaLabels],
  );

  const filtered = useMemo(() => {
    const base = rows.filter((r) => {
      if (area != null && (areaLabels[r.area] ?? r.area) !== area) return false;
      if (!matchesQuery(query, [r.tradename, r.licenseNumber, r.city])) return false;
      return true;
    });
    return sortRows(base, (r) => accessor(r, sortKey), dir);
  }, [rows, area, query, sortKey, dir, accessor, areaLabels]);

  const csv = useCallback(() => rowsToCsv(filtered, LOCAL_STORE_CSV_COLUMNS), [filtered]);

  return (
    <Card>
      <CardHeader
        title="Tracked competitors"
        subtitle="Each store priced against its OWN area median — a Tacoma store undercutting Port Orchard is not competition. Click any row for its category and product mix."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={query} onChange={setQuery} placeholder="Search store, license, city…" />
            <ExportButton filename={`local-stores-${monthLabel}.csv`} csv={csv} count={filtered.length} />
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Facet label="Area" options={areaFacet} selected={area} onChange={setArea} />
        <span className="text-xs text-[var(--admin-text-muted)]">
          {filtered.length} of {rows.length} stores
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr className="border-b border-[var(--admin-border)]">
              <th className={TH} />
              <SortHeader label="Store" colKey="tradename" sortKey={sortKey} dir={dir} onSort={onSort} />
              <SortHeader label="Area" colKey="area" sortKey={sortKey} dir={dir} onSort={onSort} />
              <SortHeader label="Units" colKey="units" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="Revenue" colKey="revenue" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader
                label="Share"
                colKey="share"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="This store's share of measured retail revenue across the stores in view"
              />
              <SortHeader label="Low (p25)" colKey="p25" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="Median" colKey="median" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="High (p75)" colKey="p75" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader
                label="vs area"
                colKey="vsArea"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="This store's median minus its OWN area's median. Negative = cheaper than its neighbourhood."
              />
              <SortHeader
                label="$/line"
                colKey="perLine"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Revenue per sale line — a basket-size proxy"
              />
              <SortHeader label="Types" colKey="types" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader
                label="Velocity"
                colKey="velocity"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Revenue per category carried (NielsenIQ velocity)"
              />
              <SortHeader
                label="Fair share"
                colKey="fairShare"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="100 = par. Above 100 means this store earns more revenue share than its assortment breadth would predict."
              />
              <SortHeader
                label="Wholesale"
                colKey="wholesale"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="Buy/sell gap"
                colKey="gap"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
                title="Observed retail revenue minus observed wholesale spend. NOT profit — the two sides do not line up unit for unit."
              />
              <SortHeader
                label="Vendors"
                colKey="suppliers"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <EmptyRow span={STORE_COLS}>
                No tracked store matches these filters. Clear them, or re-upload this month&apos;s zip if you
                expected data here.
              </EmptyRow>
            ) : (
              filtered.map((r) => {
                const isOpen = open === r.licenseNumber;
                return (
                  <Fragment key={r.licenseNumber}>
                    <tr
                      className="cursor-pointer border-b border-[var(--admin-border)]/40 transition hover:bg-[var(--admin-surface-2)]/60"
                      onClick={() => setOpen(isOpen ? null : r.licenseNumber)}
                    >
                      <td className={`${TD} w-6 text-[var(--admin-text-muted)]`} aria-hidden="true">
                        {isOpen ? "▾" : "▸"}
                      </td>
                      <td className={TD}>
                        <span className="font-medium">{r.tradename}</span>
                        {r.city ? (
                          <span className="ml-1 text-xs text-[var(--admin-text-muted)]">· {r.city}</span>
                        ) : null}
                      </td>
                      <td className={`${TD} text-[var(--admin-text-muted)]`}>{areaLabels[r.area] ?? r.area}</td>
                      <td className={TD_NUM}>{num(r.units)}</td>
                      <td className={TD_NUM}>{moneyShort(r.revenueMinor)}</td>
                      <td className={TD_NUM}>{pct(r.revenueShare)}</td>
                      <td className={TD_NUM}>{money(r.p25Minor)}</td>
                      <td className={`${TD_NUM} font-semibold`}>{money(r.medianMinor)}</td>
                      <td className={TD_NUM}>{money(r.p75Minor)}</td>
                      <td
                        className={`${TD_NUM} ${
                          r.vsAreaMinor == null
                            ? ""
                            : r.vsAreaMinor < 0
                              ? "text-[var(--admin-success,#16a34a)]"
                              : r.vsAreaMinor > 0
                                ? "text-[var(--admin-warning,#d97706)]"
                                : ""
                        }`}
                        title={r.vsAreaPct != null ? `${pctSigned(r.vsAreaPct)} vs its area median` : undefined}
                      >
                        {moneySigned(r.vsAreaMinor)}
                      </td>
                      <td className={TD_NUM}>{money(r.revenuePerLineMinor)}</td>
                      <td className={TD_NUM}>{num(r.typesCarried)}</td>
                      <td className={TD_NUM}>{moneyShort(r.velocityMinor)}</td>
                      <td className={TD_NUM}>{index100(r.fairShareIndex)}</td>
                      <td className={TD_NUM}>{moneyShort(r.wholesaleSpendMinor)}</td>
                      <td className={TD_NUM}>{moneyShort(r.buySellGapMinor)}</td>
                      <td className={TD_NUM}>{num(r.supplierCount)}</td>
                    </tr>
                    {isOpen ? (
                      <>
                        <MixDetailPanel
                          detail={r.detail}
                          span={STORE_COLS}
                          note="Top products are what this store actually moved this month, with the median price it sold them at — undercut candidates."
                        />
                        {r.suppliers.length > 0 ? (
                          <tr className="bg-[var(--admin-surface-2)]/50">
                            <td colSpan={STORE_COLS} className="px-4 pb-4">
                              <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                                Who {r.tradename} buys from
                              </p>
                              <table className="w-full">
                                <tbody>
                                  {r.suppliers.map((s, i) => (
                                    <tr
                                      key={`${s.licenseNumber ?? s.name}-${i}`}
                                      className="border-t border-[var(--admin-border)]/40"
                                    >
                                      <td className="py-1.5 pr-3 text-sm text-[var(--admin-text)]">
                                        {s.name}
                                        {s.licenseNumber ? (
                                          <span className="ml-1 text-xs text-[var(--admin-text-muted)]">
                                            · {s.licenseNumber}
                                          </span>
                                        ) : null}
                                      </td>
                                      <td className="py-1.5 pr-3 text-right text-sm tabular-nums text-[var(--admin-text-muted)]">
                                        {num(s.lineCount)} lines
                                      </td>
                                      <td className="py-1.5 text-right text-sm tabular-nums text-[var(--admin-text)]">
                                        {moneyShort(s.spendMinor)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
                                Real seller-to-buyer transfers from the CCRS drop, never inferred. Top vendors by
                                spend only.
                              </p>
                            </td>
                          </tr>
                        ) : null}
                      </>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
        Greenway&apos;s own numbers are structurally excluded — the transformer never aggregates your license, so
        your figures live in your POS reports where they belong. An em dash means never measured, which is not the
        same as zero.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lens 2 — Areas
// ---------------------------------------------------------------------------

type AreaSortKey = "area" | "stores" | "units" | "revenue" | "share" | "perStore" | "median" | "avg";

const AREA_COLS = 8;

function AreaLens({
  rows,
  areaLabels,
  monthLabel,
  homeArea,
}: {
  rows: LocalAreaRow[];
  areaLabels: Record<string, string>;
  monthLabel: string;
  homeArea: string;
}) {
  const [sortKey, setSortKey] = useState<AreaSortKey>("revenue");
  const [dir, setDir] = useState<SortDirection>("desc");

  const onSort = useCallback((k: AreaSortKey) => {
    setSortKey((prev) => {
      if (prev === k) {
        setDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setDir("desc");
      return k;
    });
  }, []);

  const sorted = useMemo(
    () =>
      sortRows(
        rows,
        (r) => {
          switch (sortKey) {
            case "area":
              return areaLabels[r.area] ?? r.area;
            case "stores":
              return r.storeCount;
            case "units":
              return r.units;
            case "revenue":
              return r.revenueMinor;
            case "share":
              return r.revenueShare;
            case "perStore":
              return r.revenuePerStoreMinor;
            case "median":
              return r.medianMinor;
            case "avg":
              return r.avgMinor;
            default:
              return null;
          }
        },
        dir,
      ),
    [rows, sortKey, dir, areaLabels],
  );

  const csv = useCallback(() => rowsToCsv(sorted, LOCAL_AREA_CSV_COLUMNS), [sorted]);

  return (
    <Card>
      <CardHeader
        title="Area benchmarks"
        subtitle="Median competitor retail price by area. Each area median is the median of each store's median — a labeled proxy, never a pooled figure."
        action={<ExportButton filename={`local-areas-${monthLabel}.csv`} csv={csv} count={sorted.length} />}
      />
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr className="border-b border-[var(--admin-border)]">
              <SortHeader label="Area" colKey="area" sortKey={sortKey} dir={dir} onSort={onSort} />
              <SortHeader label="Stores" colKey="stores" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="Units" colKey="units" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="Revenue" colKey="revenue" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader label="Share" colKey="share" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              <SortHeader
                label="Rev / store"
                colKey="perStore"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="Median retail"
                colKey="median"
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                align="right"
              />
              <SortHeader label="Avg retail" colKey="avg" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <EmptyRow span={AREA_COLS}>No area rollups in this month&apos;s drop.</EmptyRow>
            ) : (
              sorted.map((r) => {
                const home = r.area === homeArea;
                return (
                  <tr
                    key={r.area}
                    className={`border-b border-[var(--admin-border)]/40 ${
                      home ? "bg-[var(--admin-accent-soft)]/40" : ""
                    }`}
                  >
                    <td className={TD}>
                      <span className={home ? "font-semibold" : ""}>{areaLabels[r.area] ?? r.area}</span>
                      {home ? (
                        <Badge tone="gold" className="ml-2">
                          Your area
                        </Badge>
                      ) : null}
                    </td>
                    <td className={TD_NUM}>{num(r.storeCount)}</td>
                    <td className={TD_NUM}>{num(r.units)}</td>
                    <td className={TD_NUM}>{moneyShort(r.revenueMinor)}</td>
                    <td className={TD_NUM}>{pct(r.revenueShare)}</td>
                    <td className={TD_NUM}>{moneyShort(r.revenuePerStoreMinor)}</td>
                    <td className={`${TD_NUM} font-semibold`}>{money(r.medianMinor)}</td>
                    <td className={TD_NUM}>{money(r.avgMinor)}</td>
                  </tr>
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
// Lens 3 — Vendors
// ---------------------------------------------------------------------------

type VendorSortKey = "name" | "buyers" | "spend" | "share" | "perBuyer" | "lines";

const VENDOR_COLS = 7;

function VendorLens({
  rows,
  statewide,
  monthLabel,
}: {
  rows: LocalVendorRow[];
  statewide: StatewideSupplierRowLike[];
  monthLabel: string;
}) {
  const [sortKey, setSortKey] = useState<VendorSortKey>("buyers");
  const [dir, setDir] = useState<SortDirection>("desc");
  const [query, setQuery] = useState("");
  const [multiOnly, setMultiOnly] = useState(false);

  const onSort = useCallback((k: VendorSortKey) => {
    setSortKey((prev) => {
      if (prev === k) {
        setDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setDir("desc");
      return k;
    });
  }, []);

  const filtered = useMemo(() => {
    const base = rows.filter((r) => {
      if (multiOnly && !r.multiCompetitor) return false;
      if (!matchesQuery(query, [r.name, r.licenseNumber, ...r.buyerNames])) return false;
      return true;
    });
    return sortRows(
      base,
      (r) => {
        switch (sortKey) {
          case "name":
            return r.name;
          case "buyers":
            return r.buyerCount;
          case "spend":
            return r.spendMinor;
          case "share":
            return r.spendShare;
          case "perBuyer":
            return r.spendPerBuyerMinor;
          case "lines":
            return r.lineCount;
          default:
            return null;
        }
      },
      dir,
    );
  }, [rows, query, multiOnly, sortKey, dir]);

  const csv = useCallback(() => rowsToCsv(filtered, LOCAL_VENDOR_CSV_COLUMNS), [filtered]);
  const multiCount = useMemo(() => rows.filter((r) => r.multiCompetitor).length, [rows]);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title="Who your competitors buy from"
          subtitle="Vendors shipping to your tracked competitors this month. Those serving two or more stores are proven local demand — the first calls to make."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox value={query} onChange={setQuery} placeholder="Search vendor or buyer…" />
              <ExportButton filename={`local-vendors-${monthLabel}.csv`} csv={csv} count={filtered.length} />
            </div>
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <button
            type="button"
            onClick={() => setMultiOnly((v) => !v)}
            className={`admin-focus rounded-full px-2.5 py-1 text-xs font-semibold transition ${
              multiOnly
                ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
                : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
            }`}
          >
            Multi-competitor only
            <span className="ml-1 opacity-60">{multiCount}</span>
          </button>
          <span className="text-xs text-[var(--admin-text-muted)]">
            {filtered.length} of {rows.length} vendors
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="border-b border-[var(--admin-border)]">
                <SortHeader label="Supplier" colKey="name" sortKey={sortKey} dir={dir} onSort={onSort} />
                <SortHeader
                  label="Tracked buyers"
                  colKey="buyers"
                  sortKey={sortKey}
                  dir={dir}
                  onSort={onSort}
                  align="right"
                />
                <th className={TH}>Who they supply</th>
                <SortHeader
                  label="Observed spend"
                  colKey="spend"
                  sortKey={sortKey}
                  dir={dir}
                  onSort={onSort}
                  align="right"
                />
                <SortHeader label="Share" colKey="share" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
                <SortHeader
                  label="$/buyer"
                  colKey="perBuyer"
                  sortKey={sortKey}
                  dir={dir}
                  onSort={onSort}
                  align="right"
                  title="Average observed spend per buying store — how deep each account runs"
                />
                <SortHeader label="Lines" colKey="lines" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <EmptyRow span={VENDOR_COLS}>
                  No vendor matches these filters. Wholesale rows appear once a month&apos;s zip has been processed.
                </EmptyRow>
              ) : (
                filtered.map((r) => (
                  <tr key={r.licenseeId} className="border-b border-[var(--admin-border)]/40">
                    <td className={TD}>
                      <span className="font-medium">{r.name}</span>
                      {r.licenseNumber ? (
                        <span className="ml-1 text-xs text-[var(--admin-text-muted)]">· {r.licenseNumber}</span>
                      ) : null}
                      {r.multiCompetitor ? (
                        <Badge tone="green" className="ml-2">
                          Priority
                        </Badge>
                      ) : null}
                    </td>
                    <td className={TD_NUM}>{num(r.buyerCount)}</td>
                    <td className={`${TD} max-w-xs truncate text-[var(--admin-text-muted)]`} title={r.buyerNames.join(", ")}>
                      {r.buyerNames.join(", ") || "—"}
                    </td>
                    <td className={TD_NUM}>{moneyShort(r.spendMinor)}</td>
                    <td className={TD_NUM}>{pct(r.spendShare)}</td>
                    <td className={TD_NUM}>{moneyShort(r.spendPerBuyerMinor)}</td>
                    <td className={TD_NUM}>{num(r.lineCount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
          Coverage: each competitor rollup keeps only its top vendors by spend, so a vendor sitting eleventh at every
          store is invisible here. Buyer counts are a floor, not a census.
        </p>
      </Card>

      {statewide.length > 0 ? (
        <Card>
          <CardHeader
            title="Statewide supplier benchmarks"
            subtitle="The state's biggest wholesale suppliers this month. A supplier's median line price across ALL their accounts is your reference point before you negotiate — and 'Your competitors' shows how many of your tracked stores they already serve."
          />
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="border-b border-[var(--admin-border)]">
                  <th className={TH}>Supplier</th>
                  <th className={`${TH} text-right`}>Revenue (statewide)</th>
                  <th className={`${TH} text-right`}>Lines</th>
                  <th className={`${TH} text-right`}>Line price (p25 / median / p75)</th>
                  <th className={`${TH} text-right`}>Buyers (statewide)</th>
                  <th className={`${TH} text-right`}>Your competitors</th>
                </tr>
              </thead>
              <tbody>
                {statewide.map((s, i) => (
                  <tr key={`${s.licenseNumber ?? s.displayName}-${i}`} className="border-b border-[var(--admin-border)]/40">
                    <td className={TD}>
                      <span className="font-medium">{s.displayName}</span>
                      {s.licenseNumber ? (
                        <span className="ml-1 text-xs text-[var(--admin-text-muted)]">· {s.licenseNumber}</span>
                      ) : null}
                    </td>
                    <td className={TD_NUM}>{moneyShort(s.revenueMinor)}</td>
                    <td className={TD_NUM}>{num(s.lineCount)}</td>
                    <td className={TD_NUM}>
                      {money(s.p25Minor)} / <span className="font-semibold">{money(s.medianMinor)}</span> /{" "}
                      {money(s.p75Minor)}
                    </td>
                    <td className={TD_NUM}>{num(s.distinctBuyers)}</td>
                    <td className={TD_NUM}>{num(s.trackedBuyers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lens 4 — Opportunities
// ---------------------------------------------------------------------------

function OpportunityLens({
  gaps,
  gapSummary,
  newSuppliers,
  newSupplierNote,
  switches,
  switchNote,
}: {
  gaps: GapRowLike[];
  gapSummary: { carried: number; brandCarried: number; notCarried: number; menuItems: number } | null;
  newSuppliers: NewSupplierRowLike[];
  newSupplierNote: string | null;
  switches: SwitchRowLike[];
  switchNote: string | null;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const statusFacet = useMemo(() => buildFacet(gaps, (g) => g.statusLabel), [gaps]);

  const filteredGaps = useMemo(
    () =>
      gaps.filter((g) => {
        if (status != null && g.statusLabel !== status) return false;
        if (!matchesQuery(query, [g.productName, g.brand, g.inventoryType])) return false;
        return true;
      }),
    [gaps, status, query],
  );

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title="Assortment gaps — statewide movers vs your menu"
          subtitle="What the rest of Washington sells hard that you may not stock. 'Not carried' with a high revenue figure is a purchase-order candidate."
          action={<SearchBox value={query} onChange={setQuery} placeholder="Search product or brand…" />}
        />
        {gapSummary ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--admin-text-muted)]">
            <Badge tone="green">On our menu: {num(gapSummary.carried)}</Badge>
            <Badge tone="gold">Brand carried: {num(gapSummary.brandCarried)}</Badge>
            <Badge tone="orange">Not carried: {num(gapSummary.notCarried)}</Badge>
            <span>compared against {num(gapSummary.menuItems)} published menu items</span>
          </div>
        ) : null}
        <div className="mb-3">
          <Facet label="Status" options={statusFacet} selected={status} onChange={setStatus} />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="border-b border-[var(--admin-border)]">
                <th className={TH}>Statewide mover</th>
                <th className={TH}>Type</th>
                <th className={`${TH} text-right`}>Units</th>
                <th className={`${TH} text-right`}>Revenue</th>
                <th className={`${TH} text-right`}>Median unit price</th>
                <th className={TH}>On our menu?</th>
              </tr>
            </thead>
            <tbody>
              {filteredGaps.length === 0 ? (
                <EmptyRow span={6}>
                  No statewide movers to compare. This needs both a processed month and a published menu.
                </EmptyRow>
              ) : (
                filteredGaps.map((g, i) => (
                  <tr key={`${g.productName}-${i}`} className="border-b border-[var(--admin-border)]/40">
                    <td className={TD}>
                      <span className="font-medium">{g.productName}</span>
                      {g.brand ? (
                        <span className="ml-1 text-xs text-[var(--admin-text-muted)]">· {g.brand}</span>
                      ) : null}
                    </td>
                    <td className={`${TD} text-[var(--admin-text-muted)]`}>{g.inventoryType ?? "—"}</td>
                    <td className={TD_NUM}>{num(g.units)}</td>
                    <td className={TD_NUM}>{moneyShort(g.revenueMinor)}</td>
                    <td className={TD_NUM}>{money(g.medianUnitPriceMinor)}</td>
                    <td className={TD}>
                      <Badge
                        tone={g.status === "carried" ? "green" : g.status === "brand_carried" ? "gold" : "orange"}
                      >
                        {g.statusLabel}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="New suppliers this month"
            subtitle="Licensees appearing in your uploads for the first time — new entrants, or vendors who just got big enough to show up."
          />
          {newSupplierNote ? (
            <p className="mb-3 text-xs text-[var(--admin-text-muted)]">{newSupplierNote}</p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="border-b border-[var(--admin-border)]">
                  <th className={TH}>Supplier</th>
                  <th className={`${TH} text-right`}>Lines</th>
                  <th className={`${TH} text-right`}>Revenue</th>
                  <th className={`${TH} text-right`}>Buyers</th>
                  <th className={`${TH} text-right`}>Your competitors</th>
                </tr>
              </thead>
              <tbody>
                {newSuppliers.length === 0 ? (
                  <EmptyRow span={5}>No first-appearance suppliers detected.</EmptyRow>
                ) : (
                  newSuppliers.map((s, i) => (
                    <tr key={`${s.licenseNumber ?? s.displayName}-${i}`} className="border-b border-[var(--admin-border)]/40">
                      <td className={TD}>
                        <span className="font-medium">{s.displayName}</span>
                        {s.licenseNumber ? (
                          <span className="ml-1 text-xs text-[var(--admin-text-muted)]">· {s.licenseNumber}</span>
                        ) : null}
                      </td>
                      <td className={TD_NUM}>{num(s.lineCount)}</td>
                      <td className={TD_NUM}>{moneyShort(s.revenueMinor)}</td>
                      <td className={TD_NUM}>{num(s.distinctBuyers)}</td>
                      <td className={TD_NUM}>{num(s.trackedBuyers)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Supplier switching — month over month"
            subtitle="Vendors that entered or left a competitor's top-supplier list. A 'lost' vendor is a supplier with capacity to sell; a 'gained' vendor is a relationship forming."
          />
          {switchNote ? <p className="mb-3 text-xs text-[var(--admin-text-muted)]">{switchNote}</p> : null}
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="border-b border-[var(--admin-border)]">
                  <th className={TH}>Store</th>
                  <th className={TH}>Supplier</th>
                  <th className={TH}>Change</th>
                  <th className={`${TH} text-right`}>Spend (prev → now)</th>
                </tr>
              </thead>
              <tbody>
                {switches.length === 0 ? (
                  <EmptyRow span={4}>
                    Nothing to compare yet — supplier switching needs two processed months.
                  </EmptyRow>
                ) : (
                  switches.map((s, i) => (
                    <tr key={`${s.competitor}-${s.supplier}-${i}`} className="border-b border-[var(--admin-border)]/40">
                      <td className={TD}>{s.competitor}</td>
                      <td className={TD}>{s.supplier}</td>
                      <td className={TD}>
                        <Badge tone={s.direction === "gained" ? "green" : "orange"}>
                          {s.direction === "gained" ? "Gained" : "Lost"}
                        </Badge>
                      </td>
                      <td className={TD_NUM}>
                        {moneyShort(s.prevSpendMinor)} → {moneyShort(s.spendMinor)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function LocalCommandCenter({
  headline,
  stores,
  areas,
  vendors,
  statewideSuppliers,
  gaps,
  gapSummary,
  newSuppliers,
  newSupplierNote,
  switches,
  switchNote,
  homeAreaLabel,
  monthLabel,
  areaLabels,
}: LocalCommandCenterProps) {
  const [lens, setLens] = useState<LocalLens>("stores");
  const homeArea = useMemo(() => {
    const entry = Object.entries(areaLabels).find(([, label]) => label === homeAreaLabel);
    return entry ? entry[0] : "port_orchard";
  }, [areaLabels, homeAreaLabel]);

  const active = LENSES.find((l) => l.id === lens) ?? LENSES[0];

  return (
    <Section
      title="Local benchmarks"
      description={`Your neighbourhood, ${monthLabel}. Start with the headline, pick a lens, then click a row for the detail behind it.`}
    >
      <div className="grid gap-4">
        <Headline h={headline} homeAreaLabel={homeAreaLabel} />

        <div className="flex flex-wrap items-center gap-2">
          <ConcentrationBadge c={headline.concentration} />
          <Badge tone={headline.multiCompetitorVendorCount > 0 ? "green" : "neutral"}>
            {num(headline.multiCompetitorVendorCount)} multi-competitor {headline.multiCompetitorVendorCount === 1 ? "vendor" : "vendors"}
          </Badge>
          {headline.priciestStore ? (
            <Badge tone="outline">
              Priciest: {headline.priciestStore.tradename} at {money(headline.priciestStore.medianMinor)}
            </Badge>
          ) : null}
        </div>

        <div>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Local benchmark lenses">
            {LENSES.map((l) => (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={lens === l.id}
                onClick={() => setLens(l.id)}
                className={`admin-focus rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                  lens === l.id
                    ? "bg-[var(--admin-accent)] text-[var(--admin-on-accent,#0b0b0b)]"
                    : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--admin-text-muted)]">{active.blurb}</p>
        </div>

        {lens === "stores" ? (
          <StoreLens rows={stores} areaLabels={areaLabels} monthLabel={monthLabel} />
        ) : null}
        {lens === "areas" ? (
          <AreaLens rows={areas} areaLabels={areaLabels} monthLabel={monthLabel} homeArea={homeArea} />
        ) : null}
        {lens === "vendors" ? (
          <VendorLens rows={vendors} statewide={statewideSuppliers} monthLabel={monthLabel} />
        ) : null}
        {lens === "opportunities" ? (
          <OpportunityLens
            gaps={gaps}
            gapSummary={gapSummary}
            newSuppliers={newSuppliers}
            newSupplierNote={newSupplierNote}
            switches={switches}
            switchNote={switchNote}
          />
        ) : null}
      </div>
    </Section>
  );
}
