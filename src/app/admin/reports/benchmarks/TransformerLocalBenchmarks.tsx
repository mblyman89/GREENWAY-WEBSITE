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
import type { DiscoveryCompetitor, DiscoveryDataset } from "@/lib/discovery/types";
import { listCompetitorStats } from "@/lib/discovery/market-rollups";
import {
  buildLocalBenchmarks,
  type LocalAreaStat,
  type LocalCompetitorStat,
} from "@/lib/discovery/local-benchmarks-core";
import { buildSupplierLeads, type SupplierLead } from "@/lib/discovery/market-leads-core";

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
