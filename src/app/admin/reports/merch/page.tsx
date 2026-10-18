/**
 * R73 S8 - Reports > Merch: greenwaymerch.com traffic, sales and WA sales tax.
 *
 * Michael, verbatim: "The reports page should have a new tab for merch data,
 * everything merch related including website traffic stats, sales stats for
 * merch, tax info."
 *
 * Sales + tax: Printful orders (the merch order record). Traffic: Vercel Web
 * Analytics on the greenwaymerch.com project. Shapes and maths live in
 * src/lib/merch/merch-reports-core.ts (pure, self-tested).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { StatCard } from "@/components/admin/StatCard";
import { BarList, DayBarChart, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { ExportButtons } from "@/components/admin/reports/ExportButtons";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { resolveRange } from "@/lib/reports/range";
import { MERCH_BOARD_PAGES, MERCH_PAGE_LIMIT, merchStatusLabel } from "@/lib/orders/merch-orders-core";
import { conversionPct, daySpan, fillDays, merchSalesReport, type TaxMonthRow, type TaxPlaceRow } from "@/lib/merch/merch-reports-core";
import { loadMerchSales, loadMerchTraffic } from "@/lib/merch/merch-reports-server";

export const dynamic = "force-dynamic";

function Section({ title, subtitle, exportHref, children }: { title: string; subtitle?: string; exportHref?: string; children: React.ReactNode }) {
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

function Notice({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  const cls = tone === "warn" ? "border-amber-400/30 bg-amber-400/10 text-amber-100" : "border-white/10 bg-white/[0.02] text-white/60";
  return <div className={`rounded-2xl border px-5 py-3 text-xs ${cls}`}>{children}</div>;
}

const money = (c: number) => formatMinorCurrency(c);

const monthCols: ReportColumn<TaxMonthRow & Record<string, unknown>>[] = [
  { key: "month", header: "Month", emphasis: true },
  { key: "orders", header: "Orders", align: "right" },
  { key: "grossCents", header: "Sales before tax", align: "right", render: (r) => money(r.grossCents) },
  { key: "taxCents", header: "Sales tax collected", align: "right", emphasis: true, render: (r) => money(r.taxCents) },
  { key: "totalCents", header: "Customer paid", align: "right", render: (r) => money(r.totalCents) },
];

const placeCols: ReportColumn<TaxPlaceRow & Record<string, unknown>>[] = [
  { key: "place", header: "Delivered to (city)", emphasis: true },
  { key: "zip", header: "ZIP" },
  { key: "state", header: "State" },
  { key: "orders", header: "Orders", align: "right" },
  { key: "grossCents", header: "Sales before tax", align: "right", render: (r) => money(r.grossCents) },
  { key: "taxCents", header: "Sales tax collected", align: "right", emphasis: true, render: (r) => money(r.taxCents) },
];

export default async function MerchReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; range?: string; year?: string }> }) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const range = resolveRange(sp);
  const [board, traffic] = await Promise.all([loadMerchSales(), loadMerchTraffic(range.fromDate, range.toDate)]);
  const r = merchSalesReport(board.orders, range);
  const t = r.totals;
  const days = daySpan(range.fromDate, range.toDate);
  const visitsByDay = fillDays(traffic.days, days);
  const pageviews = visitsByDay.reduce((s, d) => s + d.pageviews, 0);
  const visitors = visitsByDay.reduce((s, d) => s + d.visitors, 0);
  const conv = conversionPct(t.orders, visitors);
  const qs = `from=${range.fromDate}&to=${range.toDate}`;
  const capped = board.orders.length >= MERCH_BOARD_PAGES * MERCH_PAGE_LIMIT;
  const asCount = (rows: { label: string; pageviews: number }[]) => rows.map((x) => ({ label: x.label, value: x.pageviews }));

  return (
    <div className="space-y-5">
      <DateRangePicker />

      <Notice tone="info">
        greenwaymerch.com - Greenway Merchandising LLC (dba Greenway Glass &amp; Goods). {range.label}. Sales and tax come from
        Printful orders placed by greenwaymerch.com; cancelled and failed orders are left out. Manage orders at{" "}
        <Link href="/admin/orders" className="font-bold text-[var(--admin-accent)] hover:underline">Orders</Link> and products at{" "}
        <Link href="/admin/inventory/merch" className="font-bold text-[var(--admin-accent)] hover:underline">Merch Inventory</Link>.
      </Notice>

      {!board.configured ? (
        <Notice tone="warn">Printful isn&apos;t connected, so there are no sales to show. Add PRINTFUL_API_TOKEN in Vercel (the same token Merch Studio uses).</Notice>
      ) : null}
      {board.problem ? <Notice tone="warn">{board.problem}</Notice> : null}
      {capped ? (
        <Notice tone="warn">Only the newest {MERCH_BOARD_PAGES * MERCH_PAGE_LIMIT} Printful orders are read. Older orders in this range may be missing; use a shorter or more recent range.</Notice>
      ) : null}

      {/* Sales KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Merch orders" value={t.orders.toLocaleString()} hint={`${t.units.toLocaleString()} items`} accent="green" />
        <StatCard label="Customers paid" value={money(t.totalCents)} hint={`Avg order ${money(t.avgOrderCents)}`} accent="green" />
        <StatCard label="Sales tax collected" value={money(t.taxCents)} hint="File with WA DOR" accent="gold" />
        <StatCard
          label="Margin after Printful"
          value={money(t.marginCents)}
          hint={t.costUnknown ? `${t.costUnknown} order(s) not priced by Printful yet` : `Printful charged ${money(t.printfulCostCents)}`}
          accent="orange"
        />
      </div>

      <Section title="Merch sales by day" subtitle="What customers paid (including shipping and tax), Pacific days." exportHref={`/admin/reports/merch/export?${qs}`}>
        <DayBarChart data={r.byDay} valueFormatter={money} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Top merch items" subtitle="By units sold (product / size / colour as sent to Printful).">
          <BarList data={r.topProducts.map((p) => ({ label: `${p.label} - ${money(p.revenueCents)}`, value: p.units }))} valueFormatter={(v) => `${v} sold`} emptyLabel="No merch sales in this range." />
        </Section>
        <Section title="Breakdown" subtitle="Where the money went, plus order status at Printful.">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-white/50">Items</dt><dd className="text-right font-bold">{money(t.subtotalCents)}</dd>
            <dt className="text-white/50">Discounts</dt><dd className="text-right font-bold">-{money(t.discountCents)}</dd>
            <dt className="text-white/50">Shipping charged</dt><dd className="text-right font-bold">{money(t.shippingCents)}</dd>
            <dt className="text-white/50">Sales tax</dt><dd className="text-right font-bold">{money(t.taxCents)}</dd>
            <dt className="text-white/70">Customers paid</dt><dd className="text-right font-black">{money(t.totalCents)}</dd>
            <dt className="text-white/50">Cancelled / failed (not counted)</dt><dd className="text-right font-bold">{r.cancelled}</dd>
          </dl>
          {r.byStatus.length ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {r.byStatus.map((s) => (
                <span key={s.status} className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/70">{merchStatusLabel(s.status)}: {s.count}</span>
              ))}
            </div>
          ) : null}
        </Section>
      </div>

      {/* Tax */}
      <Section
        title="Washington sales tax"
        subtitle="Tax charged to customers at checkout (Stripe), read back from each Printful order. Greenway Merchandising LLC files this with WA DOR; Printful does not collect or remit it."
        exportHref={`/admin/reports/merch/export?${qs}`}
      >
        {t.taxUnknown ? <p className="mb-3 text-xs text-amber-200">{t.taxUnknown} order(s) have no tax amount from Printful, so they are counted as $0 tax here. Check them in Orders.</p> : null}
        {r.outOfState ? <p className="mb-3 text-xs text-amber-200">{r.outOfState} order(s) were delivered outside Washington. The site sells to WA only, so check these in Orders.</p> : null}
        <ReportTable columns={monthCols} rows={r.taxByMonth as (TaxMonthRow & Record<string, unknown>)[]} emptyLabel="No taxable merch sales in this range." />
        <h3 className="mb-2 mt-6 text-xs font-black uppercase tracking-[0.14em] text-white/60">By delivery location</h3>
        <p className="mb-3 text-xs text-white/40">Washington sales tax is based on where the order is delivered. Use the city and ZIP to match WA DOR location codes when filing.</p>
        <ReportTable columns={placeCols} rows={r.taxByPlace as (TaxPlaceRow & Record<string, unknown>)[]} emptyLabel="No deliveries in this range." />
      </Section>

      {/* Traffic */}
      <Section title="greenwaymerch.com traffic" subtitle="Vercel Web Analytics: page views and visitors (cookieless; visitors are a hash discarded after 24 hours).">
        {!traffic.configured ? (
          <div className="space-y-2 text-sm text-white/60">
            <p>Traffic isn&apos;t connected yet. Three steps, all in Vercel:</p>
            <ol className="list-decimal space-y-1 pl-5 text-xs">
              <li>In the greenwaymerch.com project, open Analytics and press Enable (Web Analytics).</li>
              <li>Create an access token: Account Settings &gt; Tokens.</li>
              <li>In THIS project (Greenway Marijuana) add VERCEL_ANALYTICS_TOKEN (the token), MERCH_VERCEL_PROJECT (the merch project id or name) and, if the project is in a team, VERCEL_TEAM_ID. Then redeploy.</li>
            </ol>
          </div>
        ) : (
          <div className="space-y-5">
            {traffic.problem ? <Notice tone="warn">{traffic.problem}</Notice> : null}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Page views" value={pageviews.toLocaleString()} accent="green" />
              <StatCard label="Visitors" value={visitors.toLocaleString()} accent="green" />
              <StatCard label="Orders per 100 visitors" value={conv === null ? "-" : `${conv}%`} hint="Merch orders / visitors" accent="gold" />
              <StatCard label="Pages per visitor" value={visitors ? (pageviews / visitors).toFixed(1) : "-"} accent="muted" />
            </div>
            <DayBarChart data={visitsByDay.map((d) => ({ date: d.label, value: d.visitors }))} color={REPORT_COLORS.GOLD} valueFormatter={(v) => `${v} visitors`} />
            <div className="grid gap-5 lg:grid-cols-2">
              <div><h3 className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-white/60">Top pages</h3><BarList data={asCount(traffic.pages)} valueFormatter={(v) => `${v} views`} /></div>
              <div><h3 className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-white/60">Where visitors came from</h3><BarList data={asCount(traffic.referrers)} valueFormatter={(v) => `${v} views`} /></div>
              <div><h3 className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-white/60">Devices</h3><BarList data={asCount(traffic.devices)} valueFormatter={(v) => `${v} views`} /></div>
              <div><h3 className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-white/60">Countries</h3><BarList data={asCount(traffic.countries)} valueFormatter={(v) => `${v} views`} /></div>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
