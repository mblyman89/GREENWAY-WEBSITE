/**
 * TransformerLocalBenchmarks — the Reports → Benchmarks body for datasets
 * produced by the monthly CCRS zip transformer (Task H, S6;
 * ingest_kind='monthly_zip').
 *
 * Server component. Renders the local competitor & area intelligence from the
 * persisted per-competitor rollups (`discovery_competitor_stats`, migration
 * 0106) joined to the verified WSLCB roster (`discovery_competitors`):
 *
 *  - Area benchmarks (median of each store's median — the same labeled proxy
 *    the legacy view uses).
 *  - Per-competitor table: price bands (p25/median/p75/avg), volume, revenue.
 *  - Per-competitor top products (what each store actually moves, with the
 *    median price they sell it at).
 *  - S7: who competitors BUY from — per-competitor top wholesale suppliers
 *    (migration 0107) and the shared suppliers serving several tracked stores.
 *    Wholesale SaleHeaders carry both sides of the transfer (seller LicenseeId
 *    → buyer SoldToLicenseeId), so supplier attribution is exact for every
 *    wholesale line in the drop. (This corrects the earlier S6 footnote that
 *    called sourcing "not derivable from a monthly delta" — the identities ARE
 *    in the file; only PRODUCT-level joins are delta-limited.)
 *
 * NEVER GUESS: missing price bands render "—"; the transformer's stats are
 * competitor-only by construction (the aggregator structurally excludes the
 * owner's license — the POS owns Greenway's own numbers). Suppliers a header
 * couldn't name stay uncounted rather than invented.
 */
import { formatMinorCurrency } from "@/lib/leafly/format";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { StatCard } from "@/components/admin/StatCard";
import { areaLabel } from "@/lib/discovery/competitors";
import type {
  DiscoveryCompetitor,
  DiscoveryDataset,
  DiscoverySupplierStatRow,
} from "@/lib/discovery/types";
import {
  listCompetitorStats,
  listMarketSignals,
  listSupplierStats,
  listTransformerDatasets,
} from "@/lib/discovery/market-rollups";
import { loadCandidateItems } from "@/lib/products/masters-store";
import {
  buildAssortmentGapReport,
  type AssortmentGapReport,
  type AssortmentGapRow,
  type AssortmentGapStatus,
} from "@/lib/discovery/assortment-gap-core";
import {
  buildSupplierHistoryReport,
  type NewSupplierRow,
  type SupplierHistoryReport,
} from "@/lib/discovery/supplier-history-core";
import {
  buildLocalBenchmarks,
  type LocalAreaStat,
  type LocalCompetitorStat,
} from "@/lib/discovery/local-benchmarks-core";
import { buildSupplierLeads, type SupplierLead } from "@/lib/discovery/market-leads-core";
import {
  buildSupplierSwitchReport,
  type CompetitorSwitchReport,
  type SupplierMomentum,
  type SupplierSwitchReport,
} from "@/lib/discovery/supplier-switching-core";

function money(minor: number | null | undefined): string {
  if (minor == null) return "—";
  return formatMinorCurrency(minor);
}
function num(v: number | null | undefined): string {
  if (v == null) return "—";
  return Math.round(v).toLocaleString();
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs text-white/40">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function AreaTable({ areas }: { areas: LocalAreaStat[] }) {
  const columns: ReportColumn<LocalAreaStat & Record<string, unknown>>[] = [
    { key: "area", header: "Area", emphasis: true, render: (r) => areaLabel(r.area) },
    { key: "storeCount", header: "Stores", align: "right", render: (r) => r.storeCount.toLocaleString() },
    { key: "retailMedianMinor", header: "Median retail", align: "right", emphasis: true, render: (r) => money(r.retailMedianMinor) },
    { key: "retailAvgMinor", header: "Avg retail", align: "right", render: (r) => money(r.retailAvgMinor) },
    { key: "retailUnits", header: "Units", align: "right", render: (r) => num(r.retailUnits) },
    { key: "retailRevenueMinor", header: "Revenue", align: "right", render: (r) => money(r.retailRevenueMinor) },
    { key: "retailLineCount", header: "Retail lines", align: "right", render: (r) => num(r.retailLineCount) },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={areas as Array<LocalAreaStat & Record<string, unknown>>}
      emptyLabel="No competitor activity in this drop."
    />
  );
}

function CompetitorTable({ competitors, showArea }: { competitors: LocalCompetitorStat[]; showArea?: boolean }) {
  const columns: ReportColumn<LocalCompetitorStat & Record<string, unknown>>[] = [
    {
      key: "tradename",
      header: "Store",
      emphasis: true,
      render: (r) => (
        <span>
          {r.tradename}
          <span className="ml-1 text-white/30">{r.licenseNumber}</span>
        </span>
      ),
    },
    ...(showArea
      ? [{ key: "area", header: "Area", render: (r: LocalCompetitorStat) => areaLabel(r.area) } as ReportColumn<LocalCompetitorStat & Record<string, unknown>>]
      : []),
    { key: "priceP25Minor", header: "Low (p25)", align: "right", render: (r) => money(r.priceP25Minor) },
    { key: "priceMedianMinor", header: "Median retail", align: "right", emphasis: true, render: (r) => money(r.priceMedianMinor) },
    { key: "priceP75Minor", header: "High (p75)", align: "right", render: (r) => money(r.priceP75Minor) },
    { key: "retailUnits", header: "Units", align: "right", render: (r) => num(r.retailUnits) },
    { key: "retailRevenueMinor", header: "Revenue", align: "right", render: (r) => money(r.retailRevenueMinor) },
    { key: "priceSampleSize", header: "n", align: "right", render: (r) => num(r.priceSampleSize) },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={competitors as Array<LocalCompetitorStat & Record<string, unknown>>}
      emptyLabel="No competitor activity in this drop."
    />
  );
}

function TopProductsBlocks({ competitors }: { competitors: LocalCompetitorStat[] }) {
  const withProducts = competitors.filter((c) => c.topProducts.length > 0);
  if (withProducts.length === 0) {
    return <p className="text-sm text-white/40">No attributed product detail for these stores in this drop.</p>;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {withProducts.map((c) => (
        <div key={c.licenseNumber} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-bold text-white/90">{c.tradename}</span>
            <span className="text-xs text-white/40">{areaLabel(c.area)}</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[0.65rem] uppercase tracking-wide text-white/40">
                <th className="py-1.5 pr-2">Product</th>
                <th className="px-2 py-1.5 text-right">Units</th>
                <th className="px-2 py-1.5 text-right">Revenue</th>
                <th className="py-1.5 pl-2 text-right">Median price</th>
              </tr>
            </thead>
            <tbody>
              {c.topProducts.slice(0, 8).map((p, i) => (
                <tr key={`${p.productName}-${i}`} className="border-b border-white/5">
                  <td className="max-w-[14rem] truncate py-1.5 pr-2 text-white/80" title={p.productName}>
                    {p.productName}
                    {p.inventoryType ? <span className="ml-1 text-[10px] text-white/30">{p.inventoryType}</span> : null}
                  </td>
                  <td className="px-2 py-1.5 text-right text-white/55">{num(p.units)}</td>
                  <td className="px-2 py-1.5 text-right text-white/80">{money(p.revenueMinor)}</td>
                  <td className="py-1.5 pl-2 text-right font-semibold text-[#7ed957]">{money(p.medianUnitPriceMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function SupplierBlocks({ competitors }: { competitors: LocalCompetitorStat[] }) {
  const withSuppliers = competitors.filter((c) => c.topSuppliers.length > 0);
  if (withSuppliers.length === 0) {
    return (
      <p className="text-sm text-white/40">
        No wholesale purchases attributed to these stores in this drop. (Datasets uploaded before the
        sourcing update need a re-upload of the monthly zip to backfill suppliers.)
      </p>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {withSuppliers.map((c) => (
        <div key={c.licenseNumber} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-bold text-white/90">{c.tradename}</span>
            <span className="text-xs text-white/40">
              {money(c.wholesaleSpendMinor)} wholesale · {num(c.wholesaleLineCount)} lines
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[0.65rem] uppercase tracking-wide text-white/40">
                <th className="py-1.5 pr-2">Supplier</th>
                <th className="px-2 py-1.5 text-right">Lines</th>
                <th className="py-1.5 pl-2 text-right">Spend</th>
              </tr>
            </thead>
            <tbody>
              {c.topSuppliers.map((s) => (
                <tr key={s.licenseeId} className="border-b border-white/5">
                  <td className="max-w-[16rem] truncate py-1.5 pr-2 text-white/80" title={s.displayName}>
                    {s.displayName}
                    {s.licenseNumber ? (
                      <span className="ml-1 text-[10px] text-white/30">{s.licenseNumber}</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 text-right text-white/55">{num(s.lineCount)}</td>
                  <td className="py-1.5 pl-2 text-right font-semibold text-[#7ed957]">{money(s.spendMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function SharedSuppliersTable({ suppliers }: { suppliers: SupplierLead[] }) {
  const columns: ReportColumn<SupplierLead & Record<string, unknown>>[] = [
    {
      key: "displayName",
      header: "Supplier",
      emphasis: true,
      render: (r) => (
        <span>
          {r.displayName}
          {r.licenseNumber ? <span className="ml-1 text-white/30">{r.licenseNumber}</span> : null}
        </span>
      ),
    },
    { key: "buyerCount", header: "Stores supplied", align: "right", emphasis: true, render: (r) => r.buyerCount.toLocaleString() },
    { key: "buyerNames", header: "Who they supply", render: (r) => r.buyerNames.slice(0, 5).join(", ") },
    { key: "totalLineCount", header: "Lines", align: "right", render: (r) => num(r.totalLineCount) },
    { key: "totalSpendMinor", header: "Observed spend", align: "right", render: (r) => money(r.totalSpendMinor) },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={suppliers as Array<SupplierLead & Record<string, unknown>>}
      emptyLabel="No suppliers serving multiple tracked stores in this drop."
    />
  );
}

/**
 * S9: supplier switching — per-competitor entered/exited top-supplier lists
 * and per-supplier tracked-buyer momentum, current month vs the previous
 * READY transformer dataset. Honest framing everywhere: the persisted lists
 * are TOP-10-by-spend, so "exited" means "no longer a top supplier", never
 * "stopped buying".
 */
function SwitchCompetitorBlocks({ reports }: { reports: CompetitorSwitchReport[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {reports.map((r) => (
        <div key={r.licenseNumber} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-bold text-white/90">{r.competitorName}</span>
            <span className="text-xs text-white/40">
              {r.entered.length} entered · {r.exited.length} left
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[0.65rem] uppercase tracking-wide text-white/40">
                <th className="py-1.5 pr-2">Change</th>
                <th className="px-2 py-1.5">Supplier</th>
                <th className="py-1.5 pl-2 text-right">Spend (prev → now)</th>
              </tr>
            </thead>
            <tbody>
              {r.entered.map((c) => (
                <tr key={`in-${c.supplierKey}`} className="border-b border-white/5">
                  <td className="py-1.5 pr-2 font-semibold text-[#7ed957]">Entered</td>
                  <td className="max-w-[14rem] truncate px-2 py-1.5 text-white/80" title={c.displayName}>
                    {c.displayName}
                    {c.licenseNumber ? <span className="ml-1 text-[10px] text-white/30">{c.licenseNumber}</span> : null}
                  </td>
                  <td className="py-1.5 pl-2 text-right text-white/70">— → {money(c.currSpendMinor)}</td>
                </tr>
              ))}
              {r.exited.map((c) => (
                <tr key={`out-${c.supplierKey}`} className="border-b border-white/5">
                  <td className="py-1.5 pr-2 font-semibold text-amber-400/90">Left top list</td>
                  <td className="max-w-[14rem] truncate px-2 py-1.5 text-white/80" title={c.displayName}>
                    {c.displayName}
                    {c.licenseNumber ? <span className="ml-1 text-[10px] text-white/30">{c.licenseNumber}</span> : null}
                  </td>
                  <td className="py-1.5 pl-2 text-right text-white/70">{money(c.prevSpendMinor)} → —</td>
                </tr>
              ))}
              {r.continued.slice(0, 3).map((c) => (
                <tr key={`ct-${c.supplierKey}`} className="border-b border-white/5">
                  <td className="py-1.5 pr-2 text-white/40">Continued</td>
                  <td className="max-w-[14rem] truncate px-2 py-1.5 text-white/60" title={c.displayName}>
                    {c.displayName}
                  </td>
                  <td className="py-1.5 pl-2 text-right text-white/55">
                    {money(c.prevSpendMinor)} → {money(c.currSpendMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function SupplierMomentumTable({ momentum }: { momentum: SupplierMomentum[] }) {
  const columns: ReportColumn<SupplierMomentum & Record<string, unknown>>[] = [
    {
      key: "displayName",
      header: "Supplier",
      emphasis: true,
      render: (r) => (
        <span>
          {r.displayName}
          {r.licenseNumber ? <span className="ml-1 text-white/30">{r.licenseNumber}</span> : null}
        </span>
      ),
    },
    {
      key: "buyerDelta",
      header: "Tracked buyers",
      align: "right",
      emphasis: true,
      render: (r) => (
        <span className={r.buyerDelta > 0 ? "text-[#7ed957]" : "text-amber-400/90"}>
          {r.prevBuyerCount} → {r.currBuyerCount} ({r.buyerDelta > 0 ? "+" : ""}
          {r.buyerDelta})
        </span>
      ),
    },
    { key: "gainedBuyers", header: "Gained", render: (r) => (r.gainedBuyers.length ? r.gainedBuyers.slice(0, 4).join(", ") : "—") },
    { key: "lostBuyers", header: "Lost", render: (r) => (r.lostBuyers.length ? r.lostBuyers.slice(0, 4).join(", ") : "—") },
    {
      key: "currSpendMinor",
      header: "Spend (prev → now)",
      align: "right",
      render: (r) => `${money(r.prevSpendMinor)} → ${money(r.currSpendMinor)}`,
    },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={momentum as Array<SupplierMomentum & Record<string, unknown>>}
      emptyLabel="No supplier gained or lost a tracked buyer between these months."
    />
  );
}

/**
 * S10: statewide wholesale supplier benchmarks — negotiation leverage. Every
 * number is the supplier's observed statewide wholesale activity in THIS
 * month's drop: line volume, revenue, per-line price band, and buyer reach.
 */
function StatewideSupplierTable({ suppliers }: { suppliers: DiscoverySupplierStatRow[] }) {
  const columns: ReportColumn<DiscoverySupplierStatRow & Record<string, unknown>>[] = [
    {
      key: "name",
      header: "Supplier",
      emphasis: true,
      render: (r) => (
        <span>
          {r.dba?.trim() || r.name?.trim() || `Licensee ${r.licensee_id}`}
          {r.license_number ? <span className="ml-1 text-white/30">{r.license_number}</span> : null}
        </span>
      ),
    },
    { key: "revenue_minor", header: "Wholesale revenue", align: "right", emphasis: true, render: (r) => money(r.revenue_minor) },
    { key: "line_count", header: "Lines", align: "right", render: (r) => num(r.line_count) },
    {
      key: "price_median_minor",
      header: "Line price (p25 / median / p75)",
      align: "right",
      render: (r) =>
        r.price_sample_size > 0
          ? `${money(r.price_p25_minor)} / ${money(r.price_median_minor)} / ${money(r.price_p75_minor)}`
          : "—",
    },
    { key: "distinct_buyers", header: "Buyers (statewide)", align: "right", render: (r) => num(r.distinct_buyers) },
    {
      key: "tracked_buyers",
      header: "Your competitors",
      align: "right",
      render: (r) =>
        r.tracked_buyers > 0 ? (
          <span className="font-semibold text-[#7ed957]">{num(r.tracked_buyers)}</span>
        ) : (
          "—"
        ),
    },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={suppliers as Array<DiscoverySupplierStatRow & Record<string, unknown>>}
      emptyLabel="No statewide supplier benchmarks in this drop."
    />
  );
}

/**
 * S12: assortment gaps — statewide top movers crossed against Greenway's own
 * PUBLISHED menu. Matching is conservative (exact after lowercase/trim/
 * whitespace-collapse only), so brand match is the primary signal; a CCRS
 * product name rarely equals a retail menu name verbatim.
 */
function GapStatusBadge({ status, brandItemCount }: { status: AssortmentGapStatus; brandItemCount: number }) {
  if (status === "carried") {
    return (
      <span className="rounded-full border border-[#7ed957]/40 bg-[#7ed957]/10 px-2 py-0.5 text-xs font-semibold text-[#7ed957]">
        Carried
      </span>
    );
  }
  if (status === "brand_carried") {
    return (
      <span className="rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-2 py-0.5 text-xs font-semibold text-[#d4af37]">
        Brand carried ({brandItemCount} item{brandItemCount === 1 ? "" : "s"})
      </span>
    );
  }
  return (
    <span className="rounded-full border border-white/20 bg-white/[0.06] px-2 py-0.5 text-xs font-semibold text-white/80">
      Not carried
    </span>
  );
}

function AssortmentGapTable({ rows }: { rows: AssortmentGapRow[] }) {
  const columns: ReportColumn<AssortmentGapRow & Record<string, unknown>>[] = [
    {
      key: "productName",
      header: "Statewide mover",
      emphasis: true,
      render: (r) => (
        <span>
          {r.productName}
          {r.brand ? <span className="ml-1 text-white/30">{r.brand}</span> : null}
        </span>
      ),
    },
    { key: "inventoryType", header: "Type", render: (r) => r.inventoryType ?? "—" },
    { key: "units", header: "Units (statewide)", align: "right", render: (r) => num(r.units) },
    { key: "revenueMinor", header: "Revenue (statewide)", align: "right", emphasis: true, render: (r) => money(r.revenueMinor) },
    { key: "medianUnitPriceMinor", header: "Median unit price", align: "right", render: (r) => money(r.medianUnitPriceMinor) },
    {
      key: "status",
      header: "On our menu?",
      render: (r) => <GapStatusBadge status={r.status} brandItemCount={r.brandItemCount} />,
    },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={rows as Array<AssortmentGapRow & Record<string, unknown>>}
      emptyLabel="No statewide movers in this drop."
    />
  );
}

function AssortmentGapSection({ report }: { report: AssortmentGapReport }) {
  return (
    <Section
      title="Assortment gaps — statewide movers vs your menu"
      subtitle={`The state's top-selling products this month, checked against your ${num(report.menuItemCount)} published menu items. Matching is deliberately conservative — exact name match only (case/whitespace-insensitive), no fuzzy matching — and CCRS product names rarely equal retail menu names verbatim, so "Brand carried" is the primary signal: you already stock the brand, just not (under) that exact name. "Not carried" means neither the exact name nor the brand appears on your menu — a real assortment gap to evaluate.`}
    >
      {report.menuItemCount === 0 ? (
        <p className="text-sm text-white/40">
          No published menu to compare against. Publish a menu version and this section will cross the
          state&apos;s top movers against your live assortment — nothing is compared until real menu data
          exists.
        </p>
      ) : (
        <div className="space-y-3">
          <AssortmentGapTable rows={report.rows} />
          <p className="text-xs text-white/30">
            {num(report.moverCount)} statewide movers considered: {num(report.carriedCount)} carried,{" "}
            {num(report.brandCarriedCount)} brand-carried, {num(report.notCarriedCount)} not carried
            {report.rows.length < report.moverCount ? ` (showing top ${num(report.rows.length)} by revenue)` : ""}.
            Movers without a brand can only be name-matched, so some &ldquo;Not carried&rdquo; rows may be
            products you stock under a different menu name — the table never guesses a match.
          </p>
        </div>
      )}
    </Section>
  );
}

/**
 * S13: new-vendor early detection — suppliers whose first appearance in the
 * UPLOADED history is this drop. Honest framing baked into the copy: "first
 * appearance in your uploads" is NOT "new to the market" (unuploaded months
 * and the top-100 rollup cap both hide history).
 */
function NewSupplierTable({ rows }: { rows: NewSupplierRow[] }) {
  const columns: ReportColumn<NewSupplierRow & Record<string, unknown>>[] = [
    {
      key: "displayName",
      header: "Supplier",
      emphasis: true,
      render: (r) => (
        <span>
          {r.displayName}
          {r.licenseNumber ? <span className="ml-1 text-white/30">{r.licenseNumber}</span> : null}
        </span>
      ),
    },
    { key: "revenueMinor", header: "Wholesale revenue", align: "right", emphasis: true, render: (r) => money(r.revenueMinor) },
    { key: "lineCount", header: "Lines", align: "right", render: (r) => num(r.lineCount) },
    { key: "distinctBuyers", header: "Buyers (statewide)", align: "right", render: (r) => num(r.distinctBuyers) },
    {
      key: "trackedBuyers",
      header: "Your competitors",
      align: "right",
      render: (r) =>
        r.trackedBuyers > 0 ? (
          <span className="font-semibold text-[#7ed957]">{num(r.trackedBuyers)}</span>
        ) : (
          "—"
        ),
    },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={rows as Array<NewSupplierRow & Record<string, unknown>>}
      emptyLabel="No first-appearance suppliers this month."
    />
  );
}

function NewSuppliersSection({ report }: { report: SupplierHistoryReport }) {
  return (
    <Section
      title="New suppliers this month — first appearance in your uploads"
      subtitle={`Suppliers in this drop's statewide benchmarks that don't appear in any prior uploaded month with supplier data (${report.priorWithSupplierData.length} month${report.priorWithSupplierData.length === 1 ? "" : "s"} compared). HONEST LIMITS: "first appearance in your uploads" is not "new to the market" — months you haven't uploaded and suppliers below a prior month's top-100 rollup cap are invisible to this comparison. Treat these as call-first candidates to verify, not certainties.`}
    >
      <div className="space-y-3">
        <NewSupplierTable rows={report.newSuppliers} />
        {report.newSupplierCount > report.newSuppliers.length ? (
          <p className="text-xs text-white/30">
            Showing top {num(report.newSuppliers.length)} of {num(report.newSupplierCount)}{" "}
            first-appearance suppliers by revenue.
          </p>
        ) : null}
        {report.priorWithoutSupplierData.length > 0 ? (
          <p className="text-xs text-white/30">
            Not compared (no supplier data — uploaded before the statewide supplier update):{" "}
            {report.priorWithoutSupplierData.slice(0, 8).join(", ")}
            {report.priorWithoutSupplierData.length > 8 ? "…" : ""}. Re-upload those monthly zips to
            backfill and tighten this detection.
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function SupplierSwitchingSection({
  report,
  prevLabel,
}: {
  report: SupplierSwitchReport;
  prevLabel: string;
}) {
  const hasAny = report.competitors.length > 0 || report.momentum.length > 0;
  return (
    <Section
      title="Supplier switching — month over month"
      subtitle={`Current drop vs "${prevLabel}". "Entered/left" means a vendor moved on or off a store's TOP-10-by-spend supplier list — a vendor below the top 10 still supplies the store. Losing a big account can make a vendor negotiable; a new account signals a product line winning nearby.`}
    >
      {hasAny ? (
        <div className="space-y-5">
          {report.momentum.length > 0 ? <SupplierMomentumTable momentum={report.momentum} /> : null}
          {report.competitors.length > 0 ? <SwitchCompetitorBlocks reports={report.competitors} /> : null}
        </div>
      ) : (
        <p className="text-sm text-white/40">
          No top-supplier changes between these two months for stores with sourcing data in both.
        </p>
      )}
      {report.missingPrevData.length > 0 ? (
        <p className="mt-3 text-xs text-white/30">
          No previous-month sourcing data for: {report.missingPrevData.slice(0, 8).join(", ")}
          {report.missingPrevData.length > 8 ? "…" : ""} (datasets uploaded before the sourcing update
          need a re-upload to backfill suppliers — those stores are excluded, never guessed).
        </p>
      ) : null}
    </Section>
  );
}

export async function TransformerLocalBenchmarks({
  dataset,
  roster,
}: {
  dataset: DiscoveryDataset;
  roster: DiscoveryCompetitor[];
}) {
  const stats = await listCompetitorStats(dataset.id);
  const { competitors, areas } = buildLocalBenchmarks(stats, roster);
  // S7: shared suppliers — vendors serving 2+ tracked competitors this month.
  const sharedSuppliers = buildSupplierLeads(stats, roster).filter(
    (s) => s.suppliesMultipleCompetitors,
  );

  // S10: statewide supplier benchmarks (migration 0109). Best-effort — a
  // pre-0109 database or a pre-S10 dataset simply has no rows.
  let supplierStats: DiscoverySupplierStatRow[] = [];
  try {
    supplierStats = await listSupplierStats(dataset.id);
  } catch {
    supplierStats = [];
  }

  // S12: assortment gaps — statewide movers vs the published menu. Best-effort
  // on BOTH sides: a dataset without market signals or a store without a
  // published menu simply yields no section / an honest empty state.
  let gapReport: AssortmentGapReport | null = null;
  try {
    const [movers, menuItems] = await Promise.all([
      listMarketSignals(dataset.id, "statewide_mover"),
      loadCandidateItems(),
    ]);
    if (movers.length > 0) {
      gapReport = buildAssortmentGapReport(
        movers,
        menuItems.map((i) => ({ name: i.name, brand: i.brand })),
      );
    }
  } catch {
    gapReport = null; // section simply doesn't render; nothing is guessed
  }

  // S9: previous READY transformer dataset (by period, falling back to list
  // order) → supplier-switching report. Best-effort: one month = no section.
  // S13: the SAME dataset list feeds new-vendor detection — this dataset's
  // supplier stats vs every OLDER uploaded month's. Prior months without
  // supplier rows (pre-0109 uploads) are excluded from the comparison inside
  // the pure core (missing data ≠ absence) and surfaced as a re-upload prompt.
  let switchReport: SupplierSwitchReport | null = null;
  let prevLabel: string | null = null;
  let historyReport: SupplierHistoryReport | null = null;
  try {
    const all = await listTransformerDatasets(); // newest period first
    const idx = all.findIndex((d) => d.id === dataset.id);
    const prev = idx >= 0 ? (all[idx + 1] ?? null) : null;
    if (prev) {
      const prevStats = await listCompetitorStats(prev.id);
      switchReport = buildSupplierSwitchReport(stats, prevStats, roster);
      prevLabel = prev.label;
    }
    // S13: only meaningful when THIS drop has supplier stats and older months
    // exist. detectable=false (no prior supplier data anywhere) → no section.
    const older = idx >= 0 ? all.slice(idx + 1) : [];
    if (supplierStats.length > 0 && older.length > 0) {
      const priorDatasets = await Promise.all(
        older.map(async (d) => ({
          label: d.label,
          suppliers: await listSupplierStats(d.id),
        })),
      );
      const report = buildSupplierHistoryReport(supplierStats, priorDatasets);
      historyReport = report.detectable ? report : null;
    }
  } catch {
    switchReport = null; // sections simply don't render; nothing is guessed
    historyReport = null;
  }

  const portOrchard = competitors.filter((c) => c.area === "port_orchard");
  const poArea = areas.find((a) => a.area === "port_orchard") ?? null;
  const totalRevenue = competitors.reduce((a, c) => a + c.retailRevenueMinor, 0);

  if (competitors.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/60">
        This monthly drop (&ldquo;{dataset.label}&rdquo;) has no retail activity for the tracked competitor
        licenses. The transformer only stores rollups for stores it actually saw in the month&apos;s file.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Headline */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Port Orchard market median"
          value={money(poArea?.retailMedianMinor)}
          hint={`${num(poArea?.storeCount)} competitor stores`}
          accent="gold"
        />
        <StatCard label="Tracked competitors seen" value={num(competitors.length)} hint="with retail activity this month" accent="green" />
        <StatCard label="Competitor retail revenue" value={money(totalRevenue)} hint="tracked stores, this drop" accent="muted" />
        <StatCard
          label="Top competitor"
          value={competitors[0]?.tradename ?? "—"}
          hint={`${money(competitors[0]?.retailRevenueMinor)} revenue`}
          accent="muted"
        />
      </div>

      {/* Area benchmarks */}
      <Section
        title="Area benchmarks"
        subtitle="Median competitor retail price by area. Area medians are the median of each store's median (labeled proxy)."
      >
        <AreaTable areas={areas} />
      </Section>

      {/* Port Orchard head-to-head */}
      <Section
        title="Port Orchard head-to-head"
        subtitle="Each direct Port Orchard competitor's price bands and volume this month. Greenway's own numbers live in your POS reports — the transformer structurally excludes your license."
      >
        <CompetitorTable competitors={portOrchard} />
      </Section>

      {/* All competitors */}
      <Section
        title="All tracked competitors"
        subtitle="Every roster store the monthly drop contained retail activity for, across all areas."
      >
        <CompetitorTable competitors={competitors} showArea />
      </Section>

      {/* Top products per competitor */}
      <Section
        title="What competitors sell most"
        subtitle="Each store's top products by revenue this month, with the median price they sell at — undercut candidates feed the Leads page automatically."
      >
        <TopProductsBlocks competitors={competitors} />
      </Section>

      {/* S7: who competitors buy from */}
      <Section
        title="Who competitors buy from"
        subtitle="Each store's top wholesale suppliers by spend this month — real seller-to-buyer transfers from the CCRS drop, never inferred."
      >
        <SupplierBlocks competitors={competitors} />
      </Section>

      {sharedSuppliers.length > 0 ? (
        <Section
          title="Shared suppliers — priority vendor leads"
          subtitle="Vendors selling to two or more of your tracked competitors this month. Proven local demand: these are the first calls to make. The AI leads advisor flags them automatically."
        >
          <SharedSuppliersTable suppliers={sharedSuppliers} />
        </Section>
      ) : null}

      {/* S10: statewide supplier benchmarks (needs migration 0109 + re-upload) */}
      {supplierStats.length > 0 ? (
        <Section
          title="Statewide supplier benchmarks"
          subtitle="The state's biggest wholesale suppliers this month: observed revenue, per-line price bands, and buyer reach. Use before vendor negotiations — a supplier's median line price across all their accounts is your reference point, and 'Your competitors' shows how many tracked stores they already serve."
        >
          <StatewideSupplierTable suppliers={supplierStats.slice(0, 40)} />
        </Section>
      ) : null}

      {/* S13: new suppliers this month (needs 0109 data in 2+ months) */}
      {historyReport ? <NewSuppliersSection report={historyReport} /> : null}

      {/* S12: assortment gaps (statewide movers vs published menu) */}
      {gapReport ? <AssortmentGapSection report={gapReport} /> : null}

      {/* S9: supplier switching (needs two months of transformer data) */}
      {switchReport && prevLabel ? (
        <SupplierSwitchingSection report={switchReport} prevLabel={prevLabel} />
      ) : null}

      <p className="text-xs text-white/30">
        Derived from the monthly CCRS drop &ldquo;{dataset.label}&rdquo; — computed in your browser at
        upload; only rollups are stored. Product-level detail covers lines whose joins resolved inside
        the same monthly file (a monthly drop is a delta); totals count every line, and nothing is
        guessed to fill gaps. Supplier attribution comes straight from each wholesale transfer&apos;s
        seller and buyer licensees, which the monthly file carries in full — but it reflects only this
        month&apos;s reported wholesale activity, not a competitor&apos;s all-time vendor list. Public
        Records data is for internal buying/pricing decisions only (RCW 42.56.070(8)).
      </p>
    </div>
  );
}
