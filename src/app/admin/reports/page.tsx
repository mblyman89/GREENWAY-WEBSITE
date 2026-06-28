import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { BarList, StatusBar, REPORT_COLORS } from "@/components/admin/reports/Charts";
import {
  OrdersTrendChart,
  LoyaltyTrendChart,
  StatusDonut,
} from "@/components/admin/reports/InteractiveReportCharts";
import {
  getOrdersReport,
  getLoyaltyReport,
  getInventoryHealthReport,
  getPromotionsReport,
} from "@/lib/reports/analytics";
import { isAiConfigured } from "@/lib/reports/ai-insights";
import { ReportInsightsPanel } from "@/components/admin/reports/ReportInsightsPanel";

export const dynamic = "force-dynamic";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/70">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.range)) ? Number(sp.range) : 30;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Reports & Analytics" subtitle="Sales, loyalty, inventory health, and promotions." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-xl border border-[#ffd700]/30 bg-[#ffd700]/5 p-5 text-sm text-[#ffd700]">
            Supabase is not configured yet. Once the database is connected and orders, loyalty, and
            a published menu exist, live reports will render here.
          </div>
        </div>
      </div>
    );
  }

  const [orders, loyalty, inventory, promos] = await Promise.all([
    getOrdersReport(days),
    getLoyaltyReport(days),
    getInventoryHealthReport(),
    getPromotionsReport(),
  ]);

  return (
    <div>
      <AdminPageHeader
        title="Reports & Analytics"
        subtitle="Sales, loyalty, inventory health, and promotions."
        breadcrumbs={<Breadcrumbs items={[{ label: "Reports" }]} />}
        help={
          <HelpPanel
            id="reports"
            title="How to read your reports"
            steps={[
              "Pick a date range at the top.",
              "Charts show inventory health, loyalty, and sales-style summaries.",
              "Hover any chart to see exact numbers.",
              "Use Export to download the data as a CSV for spreadsheets.",
            ]}
          >
            <p>
              These charts update from your live menu and orders. If a chart is
              empty, you likely just need to publish a menu or wait for activity.
            </p>
          </HelpPanel>
        }
        action={
          <a
            href={`/admin/reports/export?range=${days}`}
            className="rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/10"
          >
            Export CSV
          </a>
        }
      />

      <div className="space-y-5 px-5 py-6 sm:px-8">
        {/* Date range filter */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-bold uppercase tracking-[0.1em] text-white/40">Range:</span>
          {RANGES.map((r) => (
            <Link
              key={r.days}
              href={`/admin/reports?range=${r.days}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition ${
                days === r.days
                  ? "border-[#7ed957]/60 bg-[#7ed957]/15 text-[#7ed957]"
                  : "border-white/15 bg-white/5 text-white/60 hover:text-white"
              }`}
            >
              {r.label}
            </Link>
          ))}
        </div>

        {/* AI insights briefing */}
        <ReportInsightsPanel days={days} aiEnabled={isAiConfigured} />

        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Orders" value={orders.totalOrders} hint={`Last ${days} days`} />
          <StatCard
            label="Gross (non-cancelled)"
            value={formatMinorCurrency(orders.grossMinorUnits)}
            accent="green"
          />
          <StatCard label="Avg order (AOV)" value={formatMinorCurrency(orders.avgOrderMinorUnits)} accent="gold" />
          <StatCard label="Avg items / order" value={orders.avgItemsPerOrder} />
        </div>

        {/* Orders charts — interactive Recharts time-series */}
        <OrdersTrendChart
          ordersByDay={orders.ordersByDay}
          revenueByDayMajor={orders.revenueByDay.map((p) => ({ date: p.date, value: p.value / 100 }))}
        />

        <Section title="Order status breakdown">
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <StatusBar
              segments={[
                { label: "New", value: orders.statusCounts.new, color: REPORT_COLORS.ORANGE },
                { label: "Acknowledged", value: orders.statusCounts.acknowledged, color: REPORT_COLORS.GOLD },
                { label: "Preparing", value: orders.statusCounts.preparing, color: "#9ad97f" },
                { label: "Ready", value: orders.statusCounts.ready, color: REPORT_COLORS.GREEN },
                { label: "Completed", value: orders.statusCounts.completed, color: "#4b7a52" },
                { label: "Cancelled", value: orders.cancelledOrders, color: "#b34b4b" },
                { label: "No-show", value: orders.noShowOrders, color: "#7a3b3b" },
              ]}
            />
            <StatusDonut
              segments={[
                { name: "New", value: orders.statusCounts.new, color: REPORT_COLORS.ORANGE },
                { name: "Acknowledged", value: orders.statusCounts.acknowledged, color: REPORT_COLORS.GOLD },
                { name: "Preparing", value: orders.statusCounts.preparing, color: "#9ad97f" },
                { name: "Ready", value: orders.statusCounts.ready, color: REPORT_COLORS.GREEN },
                { name: "Completed", value: orders.statusCounts.completed, color: "#4b7a52" },
                { name: "Cancelled", value: orders.cancelledOrders, color: "#b34b4b" },
                { name: "No-show", value: orders.noShowOrders, color: "#7a3b3b" },
              ]}
            />
          </div>
        </Section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Top products (by units)">
            <BarList data={orders.topProducts} color={REPORT_COLORS.GREEN} />
          </Section>
          <Section title="Top brands (by units sold)">
            <BarList data={orders.topBrands} color={REPORT_COLORS.GOLD} />
          </Section>
        </div>

        {/* Loyalty */}
        <Section
          title="Loyalty signups"
          action={
            <Link href="/admin/loyalty-signups" className="text-xs font-bold text-[#7ed957] hover:underline">
              Open queue →
            </Link>
          }
        >
          <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <LoyaltyTrendChart signupsByDay={loyalty.signupsByDay} />
            <div className="space-y-3">
              <StatusBar
                segments={[
                  { label: "New", value: loyalty.newCount, color: REPORT_COLORS.GOLD },
                  { label: "Entered", value: loyalty.enteredCount, color: REPORT_COLORS.GREEN },
                  { label: "Duplicate", value: loyalty.duplicateCount, color: REPORT_COLORS.ORANGE },
                  { label: "Archived", value: loyalty.archivedCount, color: "#555" },
                ]}
              />
              <p className="text-xs text-white/50">
                {loyalty.total} signups · {loyalty.dedupeFlagged} flagged as possible duplicates
              </p>
            </div>
          </div>
        </Section>

        {/* Inventory health */}
        <Section
          title="Inventory health (published menu)"
          action={
            <Link href="/admin/menu-imports" className="text-xs font-bold text-[#7ed957] hover:underline">
              Menu imports →
            </Link>
          }
        >
          {!inventory.hasPublishedMenu ? (
            <p className="text-sm text-white/40">No published menu version yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Mini label="Items" value={inventory.totalItems} />
                <Mini label="Out of stock" value={inventory.outOfStock} warn={inventory.outOfStock > 0} />
                <Mini label="Low stock" value={inventory.lowStock} warn={inventory.lowStock > 0} />
                <Mini label="Zero price" value={inventory.zeroPrice} warn={inventory.zeroPrice > 0} />
                <Mini label="No description" value={inventory.missingDescription} warn={inventory.missingDescription > 0} />
                <Mini label="Susp. potency" value={inventory.suspiciousPotency} warn={inventory.suspiciousPotency > 0} />
              </div>
              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-white/40">
                    Items per category
                  </p>
                  <BarList data={inventory.topCategoriesByCount} color={REPORT_COLORS.GREEN} />
                </div>
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-white/40">
                    Items per brand (top 10)
                  </p>
                  <BarList data={inventory.topBrandsByCount} color={REPORT_COLORS.GOLD} />
                </div>
              </div>
            </>
          )}
        </Section>

        {/* Promotions */}
        <Section
          title="Promotions"
          action={
            <Link href="/admin/promotions" className="text-xs font-bold text-[#7ed957] hover:underline">
              Manage →
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Published" value={promos.published} />
            <Mini label="Scheduled" value={promos.scheduled} />
            <Mini label="Draft" value={promos.draft} />
            <Mini label="Archived" value={promos.archived} />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Mini({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        warn ? "border-[#ff7f00]/40 bg-[#ff7f00]/5" : "border-white/10 bg-black/30"
      }`}
    >
      <p className="text-[0.62rem] font-bold uppercase tracking-[0.1em] text-white/40">{label}</p>
      <p className={`mt-1 text-2xl font-black ${warn ? "text-[#ff7f00]" : "text-white"}`}>{value}</p>
    </div>
  );
}
