/**
 * src/app/admin/reports/returns/page.tsx  (Slice 21)
 *
 * The "Returns & Voids" tab.
 *
 * Michael, verbatim: "nowhere in the back office can I find anything related
 * to returns or voids, and possibly other important data/ metrics I should
 * have on hand and available to see. It should be in reports and in the main
 * cockpit."
 *
 * He was right, and the gap ran deeper than a missing tab: `reports/sales.ts`
 * has no notion of a refund at all, so every revenue figure in the reporting
 * suite is GROSS. This page is where NET lives, alongside the two events that
 * separate the two.
 *
 * STORE-WIDE, NOT PER-REGISTER. Neither source records which register the
 * money went out of — `customer_returns` has no register column and void
 * audits only name the device in actor_email. `refunds-store.ts` says the same
 * thing in its own header. Rather than invent an attribution, the page states
 * the limitation on screen.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { BarList, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { resolveRange } from "@/lib/reports/range";
import { getSalesReport } from "@/lib/reports/sales";
import { returnsVoidsForRange, type DayRefunds } from "@/lib/admin/returns-metrics-store";
import {
  computeNetSales,
  refundSeverity,
  formatRate,
  type BreakdownRow,
} from "@/lib/admin/refund-metrics-core";

export const dynamic = "force-dynamic";

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
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/70">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs text-white/40">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

const BREAKDOWN_COLUMNS: ReportColumn<BreakdownRow>[] = [
  { key: "label", header: "Reason", render: (r) => r.label },
  { key: "count", header: "Count", align: "right", render: (r) => r.count },
  {
    key: "refundMinor",
    header: "Refunded",
    align: "right",
    render: (r) => formatMinorCurrency(r.refundMinor),
  },
  {
    key: "share",
    header: "Share",
    align: "right",
    render: (r) => `${(r.share * 100).toFixed(1)}%`,
  },
];

const DAY_COLUMNS: ReportColumn<DayRefunds>[] = [
  { key: "day", header: "Day", render: (d) => d.day },
  { key: "voidCount", header: "Voids", align: "right", render: (d) => d.voidCount },
  {
    key: "voidRefundMinor",
    header: "Void value",
    align: "right",
    render: (d) => formatMinorCurrency(d.voidRefundMinor),
  },
  { key: "returnCount", header: "Returns", align: "right", render: (d) => d.returnCount },
  {
    key: "returnRefundMinor",
    header: "Return value",
    align: "right",
    render: (d) => formatMinorCurrency(d.returnRefundMinor),
  },
  {
    key: "refundTotalMinor",
    header: "Total out",
    align: "right",
    render: (d) => formatMinorCurrency(d.refundTotalMinor),
  },
];

export default async function ReturnsReportPage({
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
        Connect Supabase to see returns and voids.
      </div>
    );
  }

  const [refunds, sales] = await Promise.all([
    returnsVoidsForRange(range.fromDate, range.toDate),
    getSalesReport(range.fromISO, range.toISO),
  ]);

  const net = computeNetSales(sales.totalRevenueMinorUnits, refunds.totals);
  const severity = refundSeverity(net);

  // Only days that actually saw a refund are worth a table row; the full
  // zero-seeded series stays available for the chart so the shape of the
  // period is honest.
  const activeDays = refunds.byDay.filter((d) => d.refundTotalMinor > 0 || d.voidCount > 0 || d.returnCount > 0);

  return (
    <div className="space-y-6">
      <DateRangePicker />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Gross revenue"
          value={formatMinorCurrency(net.grossMinor)}
          hint={range.label}
        />
        <StatCard
          label="Refunded out"
          value={formatMinorCurrency(net.refundMinor)}
          hint="Voids + returns"
          accent={severity === "high" ? "orange" : severity === "watch" ? "gold" : "muted"}
        />
        <StatCard
          label="Net revenue"
          value={formatMinorCurrency(net.netMinor)}
          hint="Gross minus refunds"
          accent={net.netMinor < 0 ? "orange" : "green"}
        />
        <StatCard
          label="Refund rate"
          value={formatRate(net.refundRate)}
          hint="Share of gross paid back"
          accent={severity === "high" ? "orange" : severity === "watch" ? "gold" : "muted"}
        />
        <StatCard
          label="Units returned"
          value={refunds.returnedUnits}
          hint={
            refunds.restockShare === null
              ? "Nothing returned"
              : `${formatRate(refunds.restockShare, 0)} of value restocked`
          }
        />
      </div>

      <p className="text-xs text-white/40">
        Store-wide. Neither voids nor customer returns record which register they happened on, so
        these cannot be split per register or per employee without inventing the attribution.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Voids vs returns"
          subtitle="A void unwinds a sale that should not have happened. A return is product coming back."
        >
          <BarList
            data={[
              {
                label: `Voids (${refunds.totals.voidCount})`,
                value: refunds.totals.voidRefundMinor,
              },
              {
                label: `Returns (${refunds.totals.returnCount})`,
                value: refunds.totals.returnRefundMinor,
              },
            ]}
            color={REPORT_COLORS.ORANGE}
            valueFormatter={(v) => formatMinorCurrency(v)}
            emptyLabel="No voids or returns in this range."
          />
        </Section>

        <Section title="Disposition" subtitle="Restocked value is recoverable; destroyed value is not.">
          {refunds.byDisposition.length === 0 ? (
            <p className="text-sm text-white/40">No returns in {range.label.toLowerCase()}.</p>
          ) : (
            <BarList
              data={refunds.byDisposition.map((d) => ({
                label: d.label,
                value: d.refundMinor,
              }))}
              color={REPORT_COLORS.GREEN}
              valueFormatter={(v) => formatMinorCurrency(v)}
            />
          )}
        </Section>
      </div>

      <Section title="Why product came back" subtitle="Return value grouped by the reason recorded at the counter.">
        {refunds.byReason.length === 0 ? (
          <p className="text-sm text-white/40">No returns in {range.label.toLowerCase()}.</p>
        ) : (
          <ReportTable rows={refunds.byReason} columns={BREAKDOWN_COLUMNS} />
        )}
      </Section>

      <Section title="Day by day" subtitle="Only days with a void or a return are listed.">
        {activeDays.length === 0 ? (
          <p className="text-sm text-white/40">
            No voids or returns in {range.label.toLowerCase()}. That is a good thing.
          </p>
        ) : (
          <ReportTable rows={activeDays} columns={DAY_COLUMNS} />
        )}
      </Section>
    </div>
  );
}
