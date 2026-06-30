/**
 * src/app/admin/reports/sales/page.tsx  (Run 4 / Slice 14)
 *
 * The "Sales" tab. Rich breakdowns the owner asked for: by category, vendor,
 * brand, product, day, hour, and customer type — with KPI cards, bar charts,
 * sortable-looking tables, and a CSV export for every breakdown.
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
import { getSalesReport, type SalesGroupRow } from "@/lib/reports/sales";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";

export const dynamic = "force-dynamic";

function pct(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
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

const groupColumns = (labelHeader: string, prettify?: (s: string) => string): ReportColumn<SalesGroupRow & Record<string, unknown>>[] => [
  {
    key: "label",
    header: labelHeader,
    render: (r) => (prettify ? prettify(r.label) : r.label),
    emphasis: true,
  },
  {
    key: "revenueMinorUnits",
    header: "Revenue",
    align: "right",
    emphasis: true,
    render: (r) => formatMinorCurrency(r.revenueMinorUnits),
  },
  { key: "units", header: "Units", align: "right", render: (r) => r.units.toLocaleString() },
  { key: "orders", header: "Orders", align: "right", render: (r) => r.orders.toLocaleString() },
  {
    key: "discountMinorUnits",
    header: "Discounts",
    align: "right",
    render: (r) => (r.discountMinorUnits > 0 ? `−${formatMinorCurrency(r.discountMinorUnits)}` : "—"),
  },
  { key: "revenueShare", header: "Share", align: "right", render: (r) => pct(r.revenueShare) },
];

export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string }>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const range = resolveRange(sp);

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/50">
        Supabase isn’t configured in this environment, so live sales data is unavailable.
      </div>
    );
  }

  const report = await getSalesReport(range.fromISO, range.toISO);
  const qs = `from=${range.fromISO.slice(0, 10)}&to=${range.toISO.slice(0, 10)}`;

  if (!report.hasData) {
    return (
      <div className="space-y-5">
        <DateRangePicker />
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <p className="text-sm font-bold text-white/70">No sales in {range.label.toLowerCase()}.</p>
          <p className="mt-1 text-xs text-white/40">Adjust the date range above to see results.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <DateRangePicker />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Revenue" value={formatMinorCurrency(report.totalRevenueMinorUnits)} accent="green" />
        <StatCard label="Orders" value={report.totalOrders.toLocaleString()} accent="gold" />
        <StatCard label="Units sold" value={report.totalUnits.toLocaleString()} accent="muted" />
        <StatCard
          label="Avg order"
          value={formatMinorCurrency(report.avgOrderMinorUnits)}
          hint={`${report.avgUnitsPerOrder} items/order`}
          accent="muted"
        />
        <StatCard
          label="Discounts given"
          value={formatMinorCurrency(report.totalDiscountMinorUnits)}
          accent="orange"
        />
      </div>

      {/* Category + Vendor charts side by side */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Revenue by category" exportHref={`/admin/reports/sales/export?group=category&${qs}`}>
          <BarList
            data={report.byCategory.slice(0, 10).map((r) => ({
              label: formatWebsiteCategory(r.label),
              value: r.revenueMinorUnits,
            }))}
            valueFormatter={formatMinorCurrency}
            color={REPORT_COLORS.GREEN}
          />
        </Section>
        <Section title="Revenue by vendor" exportHref={`/admin/reports/sales/export?group=vendor&${qs}`}>
          <BarList
            data={report.byVendor.slice(0, 10).map((r) => ({ label: r.label, value: r.revenueMinorUnits }))}
            valueFormatter={formatMinorCurrency}
            color={REPORT_COLORS.GOLD}
          />
        </Section>
      </div>

      {/* Brand chart + Hour chart */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Revenue by brand" exportHref={`/admin/reports/sales/export?group=brand&${qs}`}>
          <BarList
            data={report.byBrand.slice(0, 10).map((r) => ({ label: r.label, value: r.revenueMinorUnits }))}
            valueFormatter={formatMinorCurrency}
            color={REPORT_COLORS.ORANGE}
          />
        </Section>
        <Section title="Revenue by hour of day" subtitle="When your customers buy (Pacific time).">
          <BarList
            data={report.byHour
              .filter((h) => h.revenueMinorUnits > 0)
              .map((h) => ({ label: h.label, value: h.revenueMinorUnits }))}
            valueFormatter={formatMinorCurrency}
            color={REPORT_COLORS.GREEN}
            emptyLabel="No hourly data yet."
          />
        </Section>
      </div>

      {/* Customer type */}
      <Section title="Sales by customer type" subtitle="New vs returning (matched by email).">
        <BarList
          data={report.byCustomerType.map((r) => ({ label: r.label, value: r.revenueMinorUnits }))}
          valueFormatter={formatMinorCurrency}
          color={REPORT_COLORS.GOLD}
        />
      </Section>

      {/* Detailed tables */}
      <Section
        title="Category detail"
        exportHref={`/admin/reports/sales/export?group=category&${qs}`}
      >
        <ReportTable
          columns={groupColumns("Category", formatWebsiteCategory)}
          rows={report.byCategory as (SalesGroupRow & Record<string, unknown>)[]}
          totals={{
            label: "Total",
            revenueMinorUnits: formatMinorCurrency(report.totalRevenueMinorUnits),
            units: report.totalUnits.toLocaleString(),
            orders: report.totalOrders.toLocaleString(),
            discountMinorUnits: `−${formatMinorCurrency(report.totalDiscountMinorUnits)}`,
            revenueShare: "100%",
          }}
          emptyLabel="No category sales."
        />
      </Section>

      <Section title="Vendor detail" exportHref={`/admin/reports/sales/export?group=vendor&${qs}`}>
        <ReportTable
          columns={groupColumns("Vendor")}
          rows={report.byVendor as (SalesGroupRow & Record<string, unknown>)[]}
          emptyLabel="No vendor sales."
        />
      </Section>

      <Section title="Top products" subtitle="Top 25 by revenue." exportHref={`/admin/reports/sales/export?group=product&${qs}`}>
        <ReportTable
          columns={groupColumns("Product")}
          rows={report.byProduct as (SalesGroupRow & Record<string, unknown>)[]}
          emptyLabel="No product sales."
        />
      </Section>
    </div>
  );
}
