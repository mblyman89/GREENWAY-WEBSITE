/**
 * src/app/admin/reports/cogs/page.tsx  (Run 4 / Slice 15)
 *
 * The "Inventory & COGS" tab. Cost of goods sold by category/vendor/brand with
 * margin, plus current inventory valuation and expiry aging.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { BarList, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { resolveRange } from "@/lib/reports/range";
import {
  getCogsReport,
  type CogsGroupRow,
  type InventoryValuationRow,
  type AgingBucketRow,
  type MissingCostRow,
} from "@/lib/reports/cogs";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";

export const dynamic = "force-dynamic";

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function Section({
  title,
  subtitle,
  exportHref,
  children,
}: {
  title: string;
  subtitle?: string;
  exportHref?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-white/40">{subtitle}</p> : null}
        </div>
        {exportHref ? (
          <Link
            href={exportHref}
            className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:border-white/25 hover:text-white"
          >
            ⬇ CSV
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const cogsColumns = (
  labelHeader: string,
  prettify?: (s: string) => string,
): ReportColumn<CogsGroupRow & Record<string, unknown>>[] => [
  { key: "label", header: labelHeader, render: (r) => (prettify ? prettify(r.label) : r.label), emphasis: true },
  { key: "revenueMinorUnits", header: "Revenue", align: "right", render: (r) => formatMinorCurrency(r.revenueMinorUnits) },
  { key: "cogsMinorUnits", header: "COGS", align: "right", render: (r) => formatMinorCurrency(r.cogsMinorUnits) },
  {
    key: "grossProfitMinorUnits",
    header: "Gross profit",
    align: "right",
    emphasis: true,
    render: (r) => formatMinorCurrency(r.grossProfitMinorUnits),
  },
  { key: "margin", header: "Margin", align: "right", render: (r) => pct(r.margin) },
  { key: "units", header: "Units", align: "right", render: (r) => r.units.toLocaleString() },
];

const valuationColumns: ReportColumn<InventoryValuationRow & Record<string, unknown>>[] = [
  { key: "label", header: "Category", render: (r) => formatWebsiteCategory(r.label), emphasis: true },
  { key: "costValueMinorUnits", header: "Value at cost", align: "right", emphasis: true, render: (r) => formatMinorCurrency(r.costValueMinorUnits) },
  { key: "onHandUnits", header: "On-hand units", align: "right", render: (r) => r.onHandUnits.toLocaleString() },
  { key: "lots", header: "Lots", align: "right", render: (r) => r.lots.toLocaleString() },
];

const missingCostColumns: ReportColumn<MissingCostRow & Record<string, unknown>>[] = [
  { key: "productName", header: "Product", emphasis: true, render: (r) => r.productName },
  { key: "productId", header: "Product key", render: (r) => r.productId },
  { key: "units", header: "Units sold", align: "right", render: (r) => r.units.toLocaleString() },
  {
    key: "revenueMinorUnits",
    header: "Revenue",
    align: "right",
    render: (r) => formatMinorCurrency(r.revenueMinorUnits),
  },
  { key: "reason", header: "Why no cost", render: (r) => r.reason },
];

const agingColumns: ReportColumn<AgingBucketRow & Record<string, unknown>>[] = [
  { key: "label", header: "Expiry window", emphasis: true },
  { key: "costValueMinorUnits", header: "Value at cost", align: "right", emphasis: true, render: (r) => formatMinorCurrency(r.costValueMinorUnits) },
  { key: "onHandUnits", header: "On-hand units", align: "right", render: (r) => r.onHandUnits.toLocaleString() },
  { key: "lots", header: "Lots", align: "right", render: (r) => r.lots.toLocaleString() },
];

export default async function CogsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string; year?: string }>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const range = resolveRange(sp);

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/50">
        Supabase isn’t configured in this environment, so COGS data is unavailable.
      </div>
    );
  }

  const report = await getCogsReport(range.fromISO, range.toISO);
  const qs = `from=${range.fromISO.slice(0, 10)}&to=${range.toISO.slice(0, 10)}`;

  return (
    <div className="space-y-5">
      <DateRangePicker />

      {/* Profit KPIs (range) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Revenue" value={formatMinorCurrency(report.totalRevenueMinorUnits)} accent="green" />
        <StatCard label="COGS" value={formatMinorCurrency(report.totalCogsMinorUnits)} accent="orange" />
        <StatCard
          label="Gross profit"
          value={formatMinorCurrency(report.totalGrossProfitMinorUnits)}
          hint={`${pct(report.overallMargin)} margin`}
          accent="gold"
        />
        <StatCard label="Units sold" value={report.unitsSold.toLocaleString()} accent="muted" />
      </div>

      {/* Inventory snapshot KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="Inventory value (cost)"
          value={formatMinorCurrency(report.inventoryCostValueMinorUnits)}
          accent="green"
        />
        <StatCard label="On-hand units" value={report.inventoryOnHandUnits.toLocaleString()} accent="muted" />
        <StatCard label="Active lots" value={report.inventoryLots.toLocaleString()} accent="muted" />
      </div>

      {/* Gross profit by category + margin chart */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Gross profit by category" exportHref={`/admin/reports/cogs/export?group=category&${qs}`}>
          <BarList
            data={report.byCategory.slice(0, 10).map((r) => ({
              label: formatWebsiteCategory(r.label),
              value: r.grossProfitMinorUnits,
            }))}
            valueFormatter={formatMinorCurrency}
            color={REPORT_COLORS.GREEN}
            emptyLabel="No sales in range."
          />
        </Section>
        <Section title="Gross profit by vendor" exportHref={`/admin/reports/cogs/export?group=vendor&${qs}`}>
          <BarList
            data={report.byVendor.slice(0, 10).map((r) => ({ label: r.label, value: r.grossProfitMinorUnits }))}
            valueFormatter={formatMinorCurrency}
            color={REPORT_COLORS.GOLD}
            emptyLabel="No sales in range."
          />
        </Section>
      </div>

      {/* Detailed COGS tables */}
      <Section title="COGS & margin by category" exportHref={`/admin/reports/cogs/export?group=category&${qs}`}>
        <ReportTable
          columns={cogsColumns("Category", formatWebsiteCategory)}
          rows={report.byCategory as (CogsGroupRow & Record<string, unknown>)[]}
          totals={{
            label: "Total",
            revenueMinorUnits: formatMinorCurrency(report.totalRevenueMinorUnits),
            cogsMinorUnits: formatMinorCurrency(report.totalCogsMinorUnits),
            grossProfitMinorUnits: formatMinorCurrency(report.totalGrossProfitMinorUnits),
            margin: pct(report.overallMargin),
            units: report.unitsSold.toLocaleString(),
          }}
          emptyLabel="No sales in range."
        />
      </Section>

      <Section title="COGS & margin by vendor" exportHref={`/admin/reports/cogs/export?group=vendor&${qs}`}>
        <ReportTable
          columns={cogsColumns("Vendor")}
          rows={report.byVendor as (CogsGroupRow & Record<string, unknown>)[]}
          emptyLabel="No sales in range."
        />
      </Section>

      <Section title="COGS & margin by brand" exportHref={`/admin/reports/cogs/export?group=brand&${qs}`}>
        <ReportTable
          columns={cogsColumns("Brand")}
          rows={report.byBrand as (CogsGroupRow & Record<string, unknown>)[]}
          emptyLabel="No sales in range."
        />
      </Section>

      {/* Missing-cost diagnostic — explains $0 COGS */}
      {report.missingCost.length > 0 ? (
        <section className="rounded-2xl border border-orange-400/30 bg-orange-400/[0.04] p-5">
          <div className="mb-3">
            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-orange-200/90">
              ⚠ Sold items with no cost ({report.missingCost.length})
            </h2>
            <p className="mt-1 text-xs text-white/50">
              These lines counted {formatMinorCurrency(report.missingCostRevenueMinorUnits)} in revenue but $0.00
              COGS because no unit cost could be resolved. Margins above are overstated by that amount until cost is
              captured. Fix by receiving the product through Intake with a unit cost, or by setting the lot’s cost so
              its <code className="text-white/70">pos_product_key</code> matches the sold{" "}
              <code className="text-white/70">product_id</code>.
            </p>
          </div>
          <ReportTable
            columns={missingCostColumns}
            rows={report.missingCost as (MissingCostRow & Record<string, unknown>)[]}
            emptyLabel="None — every sold item has a cost."
          />
        </section>
      ) : null}

      {/* Inventory valuation + aging */}
      <Section title="Inventory valuation by category" subtitle="Current on-hand at cost (not range-bound).">
        <ReportTable
          columns={valuationColumns}
          rows={report.valuationByCategory as (InventoryValuationRow & Record<string, unknown>)[]}
          totals={{
            label: "Total",
            costValueMinorUnits: formatMinorCurrency(report.inventoryCostValueMinorUnits),
            onHandUnits: report.inventoryOnHandUnits.toLocaleString(),
            lots: report.inventoryLots.toLocaleString(),
          }}
          emptyLabel="No active inventory."
        />
      </Section>

      <Section title="Inventory aging by expiry" subtitle="How close on-hand lots are to expiring.">
        <ReportTable
          columns={agingColumns}
          rows={report.aging as (AgingBucketRow & Record<string, unknown>)[]}
          emptyLabel="No active inventory."
        />
      </Section>
    </div>
  );
}
