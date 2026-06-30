/**
 * src/app/admin/reports/tax/page.tsx  (Run 4 / Slice 16)
 *
 * The "Tax" tab — WSLCB excise (37% cannabis-only) + DOR retail sales tax
 * (state 6.5% + local 2.8% = 9.3%). Monthly summary, per-category breakdown,
 * and a printable / CSV export for filing.
 */
import { ExportButtons } from "@/components/admin/reports/ExportButtons";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { resolveRange } from "@/lib/reports/range";
import {
  getWaTaxReport,
  type WaTaxMonthRow,
  type WaTaxCategoryRow,
  type WaTaxTypeRow,
} from "@/lib/reports/wa-tax";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";

export const dynamic = "force-dynamic";

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
        {exportHref ? <ExportButtons baseHref={exportHref} /> : null}
      </div>
      {children}
    </section>
  );
}

const monthColumns: ReportColumn<WaTaxMonthRow & Record<string, unknown>>[] = [
  { key: "label", header: "Month", emphasis: true },
  { key: "cannabisBaseMinor", header: "Cannabis sales", align: "right", render: (r) => formatMinorCurrency(r.cannabisBaseMinor) },
  { key: "nonCannabisBaseMinor", header: "Non-cannabis sales", align: "right", render: (r) => formatMinorCurrency(r.nonCannabisBaseMinor) },
  { key: "salesTaxMinor", header: "Sales tax", align: "right", render: (r) => formatMinorCurrency(r.salesTaxMinor) },
  { key: "exciseTaxMinor", header: "Excise (37%)", align: "right", emphasis: true, render: (r) => formatMinorCurrency(r.exciseTaxMinor) },
  { key: "totalTaxMinor", header: "Total tax", align: "right", emphasis: true, render: (r) => formatMinorCurrency(r.totalTaxMinor) },
];

const catColumns: ReportColumn<WaTaxCategoryRow & Record<string, unknown>>[] = [
  { key: "category", header: "Category", emphasis: true, render: (r) => formatWebsiteCategory(r.category) },
  { key: "isCannabis", header: "Cannabis?", render: (r) => (r.isCannabis ? "Yes" : "No") },
  { key: "baseMinor", header: "Taxable sales", align: "right", render: (r) => formatMinorCurrency(r.baseMinor) },
  { key: "salesTaxMinor", header: "Sales tax", align: "right", render: (r) => formatMinorCurrency(r.salesTaxMinor) },
  { key: "exciseTaxMinor", header: "Excise", align: "right", emphasis: true, render: (r) => formatMinorCurrency(r.exciseTaxMinor) },
  { key: "units", header: "Units", align: "right", render: (r) => r.units.toLocaleString() },
];

const typeColumns: ReportColumn<WaTaxTypeRow & Record<string, unknown>>[] = [
  { key: "type", header: "Type", emphasis: true },
  { key: "isCannabis", header: "Cannabis?", render: (r) => (r.isCannabis ? "Yes" : "No") },
  { key: "baseMinor", header: "Taxable sales", align: "right", render: (r) => formatMinorCurrency(r.baseMinor) },
  { key: "salesTaxMinor", header: "Sales tax", align: "right", render: (r) => formatMinorCurrency(r.salesTaxMinor) },
  { key: "exciseTaxMinor", header: "Excise", align: "right", emphasis: true, render: (r) => formatMinorCurrency(r.exciseTaxMinor) },
  { key: "units", header: "Units", align: "right", render: (r) => r.units.toLocaleString() },
];

// Non-cannabis-only category rows for the dedicated taxable non-cannabis section.
const nonCannabisCatColumns: ReportColumn<WaTaxCategoryRow & Record<string, unknown>>[] = [
  { key: "category", header: "Category", emphasis: true, render: (r) => formatWebsiteCategory(r.category) },
  { key: "baseMinor", header: "Taxable sales", align: "right", render: (r) => formatMinorCurrency(r.baseMinor) },
  { key: "salesTaxMinor", header: "Sales tax (9.3%)", align: "right", emphasis: true, render: (r) => formatMinorCurrency(r.salesTaxMinor) },
  { key: "units", header: "Units", align: "right", render: (r) => r.units.toLocaleString() },
];

export default async function TaxReportPage({
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
        Supabase isn’t configured in this environment, so tax data is unavailable.
      </div>
    );
  }

  const report = await getWaTaxReport(range.fromISO, range.toISO);
  const qs = `from=${range.fromISO.slice(0, 10)}&to=${range.toISO.slice(0, 10)}`;

  return (
    <div className="space-y-5">
      <DateRangePicker />

      {/* Rate banner */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-3 text-xs text-white/50">
        Rates in effect: <span className="font-bold text-white/80">{report.exciseRatePct.toFixed(2)}%</span> cannabis
        excise · <span className="font-bold text-white/80">{report.combinedSalesRatePct.toFixed(2)}%</span> retail sales
        tax (state {(report.settings.stateSalesRateBps / 100).toFixed(2)}% + local{" "}
        {(report.settings.localSalesRateBps / 100).toFixed(2)}%)
        {report.settings.medicalEndorsement ? " · medical endorsement: ON" : ""}
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Cannabis excise (37%)"
          value={formatMinorCurrency(report.exciseTaxMinor)}
          hint="WSLCB excise return"
          accent="green"
        />
        <StatCard
          label="Retail sales tax"
          value={formatMinorCurrency(report.salesTaxMinor)}
          hint="DOR return"
          accent="gold"
        />
        <StatCard label="Total tax collected" value={formatMinorCurrency(report.totalTaxMinor)} accent="orange" />
        <StatCard
          label="Taxable cannabis sales"
          value={formatMinorCurrency(report.cannabisBaseMinor)}
          hint={`${formatMinorCurrency(report.nonCannabisBaseMinor)} non-cannabis`}
          accent="muted"
        />
      </div>

      {/* State / local split */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="State sales tax (6.5%)" value={formatMinorCurrency(report.stateSalesTaxMinor)} accent="muted" />
        <StatCard label="Local sales tax (2.8%)" value={formatMinorCurrency(report.localSalesTaxMinor)} accent="muted" />
        <StatCard label="Orders in range" value={report.orders.toLocaleString()} accent="muted" />
      </div>

      {/* Monthly summary */}
      <Section
        title="Monthly tax summary"
        subtitle="Bucketed by calendar month — use for filing periods."
        exportHref={`/admin/reports/tax/export?view=month&${qs}`}
      >
        <ReportTable
          columns={monthColumns}
          rows={report.byMonth as (WaTaxMonthRow & Record<string, unknown>)[]}
          totals={{
            label: "Total",
            cannabisBaseMinor: formatMinorCurrency(report.cannabisBaseMinor),
            nonCannabisBaseMinor: formatMinorCurrency(report.nonCannabisBaseMinor),
            salesTaxMinor: formatMinorCurrency(report.salesTaxMinor),
            exciseTaxMinor: formatMinorCurrency(report.exciseTaxMinor),
            totalTaxMinor: formatMinorCurrency(report.totalTaxMinor),
          }}
          emptyLabel="No taxable sales in range."
        />
      </Section>

      {/* Category breakdown */}
      <Section
        title="Tax by category"
        subtitle="Shows which categories carry excise (cannabis) vs sales tax only."
        exportHref={`/admin/reports/tax/export?view=category&${qs}`}
      >
        <ReportTable
          columns={catColumns}
          rows={report.byCategory as (WaTaxCategoryRow & Record<string, unknown>)[]}
          totals={{
            category: "Total",
            baseMinor: formatMinorCurrency(report.totalBaseMinor),
            salesTaxMinor: formatMinorCurrency(report.salesTaxMinor),
            exciseTaxMinor: formatMinorCurrency(report.exciseTaxMinor),
          }}
          emptyLabel="No taxable sales in range."
        />
      </Section>

      {/* Tax by type (detailed POS type) */}
      <Section
        title="Tax by type"
        subtitle="Detailed POS product types — same granularity as the Sales and COGS tabs."
        exportHref={`/admin/reports/tax/export?view=type&${qs}`}
      >
        <ReportTable
          columns={typeColumns}
          rows={report.byType as (WaTaxTypeRow & Record<string, unknown>)[]}
          totals={{
            type: "Total",
            baseMinor: formatMinorCurrency(report.totalBaseMinor),
            salesTaxMinor: formatMinorCurrency(report.salesTaxMinor),
            exciseTaxMinor: formatMinorCurrency(report.exciseTaxMinor),
          }}
          emptyLabel="No taxable sales in range."
        />
      </Section>

      {/* Dedicated taxable non-cannabis section */}
      <section className="rounded-2xl border border-[#8ab4f8]/25 bg-[#8ab4f8]/[0.04] p-5">
        <div className="mb-4">
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#8ab4f8]">Taxable non-cannabis sales</h2>
          <p className="mt-1 text-xs text-white/50">
            Non-cannabis retail goods (accessories, apparel, etc.) carry retail{" "}
            <span className="font-bold text-white/75">sales tax only</span> — no 37% excise. Reported separately so you
            can reconcile the non-cannabis portion of your DOR return.
          </p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Non-cannabis taxable sales"
            value={formatMinorCurrency(report.nonCannabisBaseMinor)}
            accent="muted"
          />
          <StatCard
            label="Sales tax on non-cannabis"
            value={formatMinorCurrency(report.nonCannabisSalesTaxMinor)}
            hint={`${report.combinedSalesRatePct.toFixed(2)}% retail rate`}
            accent="gold"
          />
          <StatCard label="Non-cannabis units" value={report.nonCannabisUnits.toLocaleString()} accent="muted" />
        </div>

        <ReportTable
          columns={nonCannabisCatColumns}
          rows={report.byCategory.filter((c) => !c.isCannabis) as (WaTaxCategoryRow & Record<string, unknown>)[]}
          totals={{
            category: "Total",
            baseMinor: formatMinorCurrency(report.nonCannabisBaseMinor),
            salesTaxMinor: formatMinorCurrency(report.nonCannabisSalesTaxMinor),
            units: report.nonCannabisUnits.toLocaleString(),
          }}
          emptyLabel="No non-cannabis taxable sales in range."
        />
      </section>

      <p className="px-1 text-[0.7rem] leading-relaxed text-white/30">
        Excise is charged on cannabis products only; sales tax applies to all retail goods. Medical sales with a valid
        card are exempt from both taxes when the store holds the medical endorsement. These figures are computed from
        completed online orders and should be reconciled against your POS and CCRS submissions before filing.
      </p>
    </div>
  );
}
