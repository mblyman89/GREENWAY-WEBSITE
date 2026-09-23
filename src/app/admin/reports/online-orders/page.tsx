/**
 * src/app/admin/reports/online-orders/page.tsx — SLICE 8 (round L-24)
 *
 * The Online Orders report tab.
 *
 * Every other tab in this suite measures MONEY. This one measures a CONTRACT,
 * and it is arranged so the two questions the owner actually asks are answered
 * before he has to scroll:
 *
 *   1. "Did I lose any orders?"  -> the auto-cancel card, top-left.
 *   2. "Why did my customer not
 *       hear anything?"          -> the lifecycle reach section.
 *
 * The second one is the reason this page is worth building. Leafly's spec
 * makes Leafly the "sole originator of automated consumer facing
 * communications", and Leafly only speaks to the shopper when WE report a
 * status transition. So an order sitting at `confirmed` forever is not a
 * cosmetic data problem — it is a customer who was never told their order was
 * ready. No sales report can show that. This one does, as a number.
 *
 * All arithmetic lives in `online-orders-report-core.ts`. This file is layout.
 */
import { requirePermission } from "@/lib/auth/session";
import { StatCard } from "@/components/admin/StatCard";
import { BarList, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { resolveRange } from "@/lib/reports/range";
import { getOnlineOrdersReport } from "@/lib/leafly/online-orders-report-server";
import {
  formatDuration,
  formatRate,
  formatReportMoney,
  headlineFinding,
  ALERT_FREE_NOTE,
} from "@/lib/leafly/online-orders-report-core";

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
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-white/45">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default async function OnlineOrdersReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string; year?: string }>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const range = resolveRange(sp);

  const { ok, report, notice } = await getOnlineOrdersReport({
    fromISO: range.fromISO,
    toISO: range.toISO,
  });

  const headline = headlineFinding(report);

  return (
    <div className="space-y-5">
      <DateRangePicker />

      {notice ? (
        <div
          className={`rounded-xl border p-4 text-sm ${
            ok
              ? "border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 text-[var(--admin-gold)]"
              : "border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 text-[var(--admin-orange)]"
          }`}
        >
          {notice}
        </div>
      ) : null}

      {/*
        THE HEADLINE. Shown only when there is something to say — a banner that
        appears on every load is a banner nobody reads. `headlineFinding`
        returns null for a clean window, and that silence is the good news.
      */}
      {headline ? (
        <div className="rounded-xl border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 p-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--admin-orange)]">
            Needs attention
          </p>
          <p className="mt-1 text-sm text-white/85">{headline}</p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Online orders" value={String(report.totalOrders)} hint={range.label} />
        <StatCard
          label="Lost to the 15-min clock"
          value={String(report.autoCanceledOrders)}
          accent={report.autoCanceledOrders > 0 ? "orange" : "green"}
          hint="Auto-cancelled by Leafly before we acknowledged"
        />
        <StatCard
          label="Acknowledged on time"
          value={formatRate(report.acknowledgement.onTimeRate)}
          accent="green"
          hint={
            report.acknowledgement.onTimeRate === null
              ? "No orders carried a deadline in this window"
              : `${report.acknowledgement.onTime} of ${
                  report.acknowledgement.onTime + report.acknowledgement.late
                }`
          }
        />
        <StatCard
          label="Order value"
          value={formatReportMoney(report.grossMinorUnits)}
          hint={
            report.averageOrderMinorUnits === null
              ? "No totals on file"
              : `avg ${formatReportMoney(report.averageOrderMinorUnits)} over ${report.ordersWithTotal}`
          }
        />
      </div>

      {/*
        LIFECYCLE REACH — the customer-notification answer, as evidence.
      */}
      <Section
        title="Did the customer ever hear back?"
        subtitle={
          "Leafly is the only system permitted to message the shopper, and it only does so when " +
          "we report a status change. An order that never advances past Confirmed is a customer " +
          "who was never told their order was ready."
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Acknowledged"
            value={String(report.lifecycle.acknowledged)}
            hint="Orders we accepted"
          />
          <StatCard
            label="Reached Confirmed"
            value={formatRate(report.lifecycle.confirmedRate)}
            hint={`${report.lifecycle.reachedConfirmed} orders`}
          />
          <StatCard
            label="Reached Ready"
            value={formatRate(report.lifecycle.readyRate)}
            accent={report.lifecycle.readyRate === 0 ? "orange" : "muted"}
            hint={`${report.lifecycle.reachedReady} orders — this is the notification the shopper cares about`}
          />
          <StatCard
            label="Reached Picked up"
            value={formatRate(report.lifecycle.pickedUpRate)}
            hint={`${report.lifecycle.reachedPickedUp} orders — required for Leafly production access`}
          />
        </div>
        {report.lifecycle.stalledAtConfirmed > 0 ? (
          <p className="mt-4 rounded-lg border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/5 p-3 text-xs text-white/70">
            <strong className="text-[var(--admin-gold)]">
              {report.lifecycle.stalledAtConfirmed}
            </strong>{" "}
            acknowledged order
            {report.lifecycle.stalledAtConfirmed === 1 ? "" : "s"} stopped at Confirmed and never
            moved on. Pressing <em>Ready for pickup</em> on the order board is what makes Leafly
            notify the shopper.
          </p>
        ) : null}
      </Section>

      <Section
        title="How fast do we acknowledge?"
        subtitle="Leafly auto-cancels any order not acknowledged within fifteen minutes."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Median"
            value={formatDuration(report.acknowledgement.medianSeconds)}
            accent="green"
          />
          <StatCard
            label="95th percentile"
            value={formatDuration(report.acknowledgement.p95Seconds)}
            hint="A real observation, not an interpolation"
          />
          <StatCard
            label="Slowest"
            value={formatDuration(report.acknowledgement.slowestSeconds)}
          />
          <StatCard
            label="Typical time to spare"
            value={formatDuration(report.acknowledgement.medianHeadroomSeconds)}
            accent={
              (report.acknowledgement.medianHeadroomSeconds ?? 1) < 0 ? "orange" : "green"
            }
            hint="Left on Leafly's own clock when we acknowledged"
          />
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Order status mix">
          <BarList
            data={report.statusMix.map((s) => ({ label: s.label, value: s.count }))}
            color={REPORT_COLORS.GREEN}
            emptyLabel="No online orders in this window."
          />
        </Section>
        <Section title="Where the orders came from">
          <BarList
            data={report.marketplaceMix.map((s) => ({ label: s.label, value: s.count }))}
            emptyLabel="No online orders in this window."
          />
        </Section>
      </div>

      <Section
        title="Did the shop find out?"
        subtitle={ALERT_FREE_NOTE}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Announced"
            value={`${report.announced} / ${report.totalOrders}`}
            accent={
              report.totalOrders > 0 && report.announced < report.totalOrders ? "orange" : "green"
            }
            hint="Speaker"
          />
          <StatCard
            label="Printed"
            value={`${report.printed} / ${report.totalOrders}`}
            accent={
              report.totalOrders > 0 && report.printed < report.totalOrders ? "orange" : "green"
            }
            hint="Ticket printer"
          />
          <StatCard
            label="Reached the register"
            value={`${report.bridgedToRegister} / ${report.totalOrders}`}
            hint="Became a local order"
          />
          <StatCard
            label="Cancelled by customer"
            value={String(report.otherCanceledOrders)}
            hint="Not our fault — counted separately from the clock"
          />
        </div>
      </Section>

      <Section
        title="Calls we made to Leafly"
        subtitle="Acknowledgements, status pushes and cart updates, with the refusals we declined to send."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Attempts" value={String(report.outbound.total)} />
          <StatCard
            label="Succeeded"
            value={formatRate(report.outbound.successRate)}
            accent="green"
            hint={`${report.outbound.success} of ${report.outbound.total}`}
          />
          <StatCard
            label="Need a retry"
            value={String(report.outbound.retry)}
            accent={report.outbound.retry > 0 ? "gold" : "muted"}
          />
          <StatCard
            label="Need a fix"
            value={String(report.outbound.fixConfig + report.outbound.fixRequest)}
            accent={report.outbound.fixConfig + report.outbound.fixRequest > 0 ? "orange" : "muted"}
            hint="Credentials or request shape"
          />
        </div>
        {report.outbound.topRefusals.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/50">
              Declined before dialling
            </p>
            <BarList
              data={report.outbound.topRefusals.map((r) => ({ label: r.label, value: r.count }))}
            />
          </div>
        ) : null}
      </Section>

      <Section title="Daily volume">
        <BarList
          data={report.dailyVolume.map((d) => ({
            label: d.autoCanceled > 0 ? `${d.date}  (${d.autoCanceled} lost)` : d.date,
            value: d.orders,
          }))}
          emptyLabel="No online orders in this window."
        />
      </Section>
    </div>
  );
}
