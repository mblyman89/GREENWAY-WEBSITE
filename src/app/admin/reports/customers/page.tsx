/**
 * src/app/admin/reports/customers/page.tsx  (Run 5 / Slice 19)
 *
 * The "Customers" report tab. Previously this tab existed in the nav but had no
 * page (404). Now it shows: KPI cards (orders, identified customers, new vs
 * returning, AOV, basket size, repeat rate), a new-vs-returning revenue split,
 * RFM-style segments, a daily new-vs-returning trend, and a top-customers table
 * with CSV export. All time buckets are Pacific.
 */
import { ExportButtons } from "@/components/admin/reports/ExportButtons";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { BarList, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { resolveRange } from "@/lib/reports/range";
import { getCustomersReport, type TopCustomerRow, type SegmentRow } from "@/lib/reports/customers";

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
        {exportHref ? <ExportButtons baseHref={exportHref} /> : null}
      </div>
      {children}
    </section>
  );
}

const SEGMENT_HINT: Record<string, string> = {
  Champion: "3+ orders & top-quartile spend",
  Loyal: "2+ orders",
  "Big spender": "1 order, top-quartile spend",
  New: "First order in this window",
  "One-time": "Single ordinary order",
};

const topColumns: ReportColumn<TopCustomerRow & Record<string, unknown>>[] = [
  { key: "label", header: "Customer", emphasis: true, render: (r) => r.label },
  { key: "email", header: "Email", render: (r) => r.email },
  { key: "segment", header: "Segment", render: (r) => r.segment },
  {
    key: "revenueMinorUnits",
    header: "Spend",
    align: "right",
    emphasis: true,
    render: (r) => formatMinorCurrency(r.revenueMinorUnits),
  },
  { key: "orders", header: "Orders", align: "right", render: (r) => r.orders.toLocaleString() },
  {
    key: "avgOrderMinorUnits",
    header: "Avg order",
    align: "right",
    render: (r) => formatMinorCurrency(r.avgOrderMinorUnits),
  },
  { key: "lastOrderDate", header: "Last order", align: "right", render: (r) => r.lastOrderDate },
];

const segmentColumns: ReportColumn<SegmentRow & Record<string, unknown>>[] = [
  {
    key: "label",
    header: "Segment",
    emphasis: true,
    render: (r) => (
      <span>
        {r.label}
        {SEGMENT_HINT[r.label] ? (
          <span className="ml-2 text-[10px] font-normal text-white/30">{SEGMENT_HINT[r.label]}</span>
        ) : null}
      </span>
    ),
  },
  { key: "customers", header: "Customers", align: "right", render: (r) => r.customers.toLocaleString() },
  {
    key: "revenueMinorUnits",
    header: "Revenue",
    align: "right",
    emphasis: true,
    render: (r) => formatMinorCurrency(r.revenueMinorUnits),
  },
];

export default async function CustomersReportPage({
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
        Supabase isn’t configured in this environment, so customer data is unavailable.
      </div>
    );
  }

  const report = await getCustomersReport(range.fromISO, range.toISO);
  const qs = `from=${range.fromISO.slice(0, 10)}&to=${range.toISO.slice(0, 10)}`;

  if (!report.hasData) {
    return (
      <div className="space-y-5">
        <DateRangePicker />
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <p className="text-sm font-bold text-white/70">No customers in {range.label.toLowerCase()}.</p>
          <p className="mt-1 text-xs text-white/40">Adjust the date range above to see results.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <DateRangePicker />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Orders" value={report.totalOrders.toLocaleString()} accent="gold" />
        <StatCard
          label="Identified customers"
          value={report.identifiedCustomers.toLocaleString()}
          hint={`${report.guestOrders.toLocaleString()} guest orders`}
          accent="green"
        />
        <StatCard
          label="New / returning"
          value={`${report.newCustomers.toLocaleString()} / ${report.returningCustomers.toLocaleString()}`}
          hint={`${pct(report.repeatRate)} repeat rate`}
          accent="muted"
        />
        <StatCard label="Revenue" value={formatMinorCurrency(report.totalRevenueMinorUnits)} accent="green" />
        <StatCard label="Avg order value" value={formatMinorCurrency(report.avgOrderMinorUnits)} accent="muted" />
        <StatCard label="Avg basket size" value={`${report.avgBasketSize} items`} accent="muted" />
      </div>

      {/* New vs returning + segments */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Revenue: new vs returning" subtitle="Who drives the dollars.">
          <BarList
            data={report.newVsReturning.map((r) => ({ label: r.label, value: r.revenueMinorUnits }))}
            valueFormatter={formatMinorCurrency}
            color={REPORT_COLORS.GREEN}
          />
        </Section>
        <Section title="Revenue by segment" subtitle="RFM-style customer segments.">
          <BarList
            data={report.segments.map((r) => ({ label: r.label, value: r.revenueMinorUnits }))}
            valueFormatter={formatMinorCurrency}
            color={REPORT_COLORS.GOLD}
            emptyLabel="No segmented customers."
          />
        </Section>
      </div>

      {/* Daily new vs returning trend */}
      <Section title="Daily new vs returning customers" subtitle="Distinct customers per Pacific day.">
        <BarList
          data={report.daily.map((d) => ({
            label: d.date,
            value: d.newCustomers + d.returningCustomers,
          }))}
          valueFormatter={(n) => n.toLocaleString()}
          color={REPORT_COLORS.ORANGE}
          emptyLabel="No daily data."
        />
      </Section>

      {/* Segment detail */}
      <Section title="Segment detail">
        <ReportTable
          columns={segmentColumns}
          rows={report.segments as (SegmentRow & Record<string, unknown>)[]}
          emptyLabel="No segments."
        />
      </Section>

      {/* Top customers */}
      <Section
        title="Top customers"
        subtitle="Top 50 by spend in range."
        exportHref={`/admin/reports/customers/export?${qs}`}
      >
        <ReportTable
          columns={topColumns}
          rows={report.topCustomers as (TopCustomerRow & Record<string, unknown>)[]}
          emptyLabel="No identified customers."
        />
      </Section>
    </div>
  );
}
