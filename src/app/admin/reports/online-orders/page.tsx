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
 * REBUILT (online-orders-report-all-channels): the page now reports on BOTH
 * online channels — our own website orders and Leafly orders — with a
 * side-by-side comparison, charts, product mix and customer overlap, ABOVE the
 * Leafly contract sections (which are kept, relabelled "Leafly …"). The old
 * page read only `leafly_orders` and multiplied Leafly's integer-cents totals
 * by 100 (see docs/online-orders-report.md).
 *
 * All arithmetic lives in `online-orders-report-core.ts` (Leafly contract) and
 * `src/lib/reports/online-orders-channels-core.ts` (both channels). This file
 * is layout.
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
import {
  CHANNEL_LABEL,
  ONLINE_CHANNELS,
  ORDER_OUTCOMES,
  OUTCOME_LABEL,
  type ComparisonRow,
  type OnlineChannel,
} from "@/lib/reports/online-orders-channels-core";
import {
  OnlineOrdersDailyCharts,
  OnlineOrdersOutcomeChart,
  OnlineOrdersShareDonuts,
  OnlineOrdersTimingCharts,
} from "@/components/admin/reports/OnlineOrdersChannelCharts";

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

/** Format one comparison cell by the row's declared format. */
function formatComparison(format: ComparisonRow["format"], v: number | null): string {
  if (v === null) return "—";
  switch (format) {
    case "count":
      return v.toLocaleString("en-US");
    case "money":
      return formatReportMoney(v);
    case "rate":
      return formatRate(v);
    case "duration":
      return formatDuration(v);
    case "decimal":
      return v.toFixed(1);
  }
}

const CHANNEL_DOT: Record<OnlineChannel, string> = {
  website: "bg-[var(--admin-accent)]",
  leafly: "bg-[#b07cff]",
};

function ChannelTag({ channel }: { channel: OnlineChannel }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${CHANNEL_DOT[channel]}`} />
      {CHANNEL_LABEL[channel]}
    </span>
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

  const { ok, report, channels, notice } = await getOnlineOrdersReport({
    fromISO: range.fromISO,
    toISO: range.toISO,
    fromDate: range.fromDate,
    toDate: range.toDate,
  });
  const web = channels.channels.website;
  const lfy = channels.channels.leafly;
  const all = channels.all;
  const src = channels.leaflyValueSources;

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

      {/* ================= ALL ONLINE ORDERS (website + Leafly) ================= */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="All online orders"
          value={all.orders.toLocaleString("en-US")}
          accent="green"
          hint={`${web.orders} website · ${lfy.orders} Leafly · ${range.label}`}
        />
        <StatCard
          label="Online order value"
          value={formatReportMoney(all.placedValueMinor)}
          hint={
            all.orders === 0
              ? "No online orders in this window"
              : `${all.valueKnown} of ${all.orders} orders have a known total`
          }
        />
        <StatCard
          label="Average online order"
          value={formatReportMoney(all.averageOrderMinor)}
          hint={
            all.medianOrderMinor === null
              ? "No totals on file"
              : `median ${formatReportMoney(all.medianOrderMinor)} · largest ${formatReportMoney(all.largestOrderMinor)}`
          }
        />
        <StatCard
          label="Picked up"
          value={formatRate(all.pickupRate)}
          accent={all.pickupRate !== null && all.pickupRate < 0.8 ? "orange" : "green"}
          hint={`${all.outcomes.fulfilled} of ${all.finished} finished orders · ${all.outcomes.open} still open`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Value picked up"
          value={formatReportMoney(all.fulfilledValueMinor)}
          accent="green"
          hint="Known totals of orders the customer collected"
        />
        <StatCard
          label="Unique online customers"
          value={all.uniqueCustomers.toLocaleString("en-US")}
          hint={
            all.customersKnown === 0
              ? "No contact details on file"
              : `${all.repeatCustomers} ordered more than once · ${channels.crossChannelCustomers} used both channels`
          }
        />
        <StatCard
          label="Items per order"
          value={all.averageItems === null ? "—" : all.averageItems.toFixed(1)}
          hint={`${all.units.toLocaleString("en-US")} units across ${all.itemsKnown} orders with item counts`}
        />
        <StatCard
          label="Cancelled / no-show"
          value={`${all.outcomes.cancelled} / ${all.outcomes.no_show}`}
          accent={all.outcomes.cancelled + all.outcomes.no_show > 0 ? "gold" : "muted"}
          hint={`${all.outcomes.lost_to_clock} lost to Leafly's 15-minute clock (counted separately)`}
        />
      </div>

      {channels.insights.length > 0 ? (
        <Section title="What stands out" subtitle="Plain-English findings computed from the numbers below.">
          <ul className="space-y-2 text-sm text-white/80">
            {channels.insights.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--admin-gold)]" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* ================= PER-CHANNEL CARDS ================= */}
      <div className="grid gap-5 lg:grid-cols-2">
        {ONLINE_CHANNELS.map((ch) => {
          const s = channels.channels[ch];
          return (
            <Section
              key={ch}
              title={`${CHANNEL_LABEL[ch]} orders`}
              subtitle={
                ch === "website"
                  ? "Orders placed on greenwaymarijuana.com (register sales excluded)."
                  : "Orders placed through Leafly and delivered to us by webhook."
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <StatCard
                  label="Orders"
                  value={s.orders.toLocaleString("en-US")}
                  accent={ch === "website" ? "green" : "muted"}
                  hint={`${formatRate(s.shareOfOrders)} of all online orders`}
                />
                <StatCard
                  label="Order value"
                  value={formatReportMoney(s.placedValueMinor)}
                  hint={`${s.valueKnown} of ${s.orders} totals known · ${formatRate(s.shareOfValue)} of online value`}
                />
                <StatCard
                  label="Average order"
                  value={formatReportMoney(s.averageOrderMinor)}
                  hint={s.medianOrderMinor === null ? "No totals on file" : `median ${formatReportMoney(s.medianOrderMinor)}`}
                />
                <StatCard
                  label="Picked up"
                  value={formatRate(s.pickupRate)}
                  hint={`${s.outcomes.fulfilled} of ${s.finished} finished`}
                />
              </div>
            </Section>
          );
        })}
      </div>

      {/* ================= HEAD-TO-HEAD ================= */}
      <Section
        title="Website vs Leafly — head to head"
        subtitle="The highlighted cell is the channel doing better on that row. Rates are out of finished orders (picked up + cancelled + no-show + lost to the clock); open orders are left out until they finish."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/50">
                <th className="py-2 pr-4 font-bold">Measure</th>
                <th className="py-2 pr-4 text-right font-bold">
                  <ChannelTag channel="website" />
                </th>
                <th className="py-2 text-right font-bold">
                  <ChannelTag channel="leafly" />
                </th>
              </tr>
            </thead>
            <tbody>
              {channels.comparison.map((row) => (
                <tr key={row.key} className="border-b border-white/5">
                  <td className="py-2 pr-4 text-white/70">{row.label}</td>
                  {ONLINE_CHANNELS.map((ch) => {
                    const lead = row.leader === ch;
                    return (
                      <td
                        key={ch}
                        className={`py-2 text-right tabular-nums ${ch === "website" ? "pr-4" : ""} ${
                          lead ? "font-black text-[var(--admin-accent)]" : "text-white/85"
                        }`}
                      >
                        {formatComparison(row.format, row[ch])}
                        {lead ? " ▲" : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ================= CHARTS ================= */}
      <Section title="Trend" subtitle="Every day in the range is shown, including days with no orders.">
        <OnlineOrdersDailyCharts daily={channels.daily} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Channel share">
          <OnlineOrdersShareDonuts
            websiteOrders={web.orders}
            leaflyOrders={lfy.orders}
            websiteValueMinor={web.placedValueMinor}
            leaflyValueMinor={lfy.placedValueMinor}
          />
        </Section>
        <Section title="Outcomes">
          <OnlineOrdersOutcomeChart
            outcomes={ORDER_OUTCOMES.map((o) => ({
              outcome: OUTCOME_LABEL[o],
              website: web.outcomes[o],
              leafly: lfy.outcomes[o],
            }))}
          />
        </Section>
      </div>

      <Section title="When customers order">
        <OnlineOrdersTimingCharts
          byHour={channels.byHour}
          byWeekday={channels.byWeekday.map((d) => ({ label: d.label, website: d.website, leafly: d.leafly }))}
        />
      </Section>

      {/* ================= PRODUCTS ================= */}
      <div className="grid gap-5 lg:grid-cols-2">
        {ONLINE_CHANNELS.map((ch) => (
          <Section
            key={ch}
            title={`Top products — ${CHANNEL_LABEL[ch]}`}
            subtitle="By units ordered in this window"
          >
            <BarList
              data={channels.topProducts[ch].map((p) => ({
                label: p.valueMinor === null ? p.name : `${p.name}  (${formatReportMoney(p.valueMinor)})`,
                value: p.units,
              }))}
              color={ch === "website" ? REPORT_COLORS.GREEN : "#b07cff"}
              emptyLabel="No line items on file for this channel."
            />
          </Section>
        ))}
      </div>

      {/* ================= MONEY DETAIL ================= */}
      <Section
        title="Discounts, loyalty, tips and tax"
        subtitle="Summed over orders whose amounts we know."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Discounts given"
            value={formatReportMoney(all.discountMinor)}
            hint={`Website ${formatReportMoney(web.discountMinor)} · Leafly ${formatReportMoney(lfy.discountMinor)}`}
          />
          <StatCard
            label="Loyalty redeemed online"
            value={formatReportMoney(all.loyaltyDiscountMinor)}
            hint="Website orders (Leafly has no Greenway loyalty)"
          />
          <StatCard
            label="Tips on Leafly"
            value={formatReportMoney(lfy.tipMinor)}
            hint="Not collected by the register — shown for context only"
          />
          <StatCard
            label="Tax on online orders"
            value={formatReportMoney(all.taxMinor)}
            hint={`Website ${formatReportMoney(web.taxMinor)} · Leafly ${formatReportMoney(lfy.taxMinor)}`}
          />
        </div>
        {lfy.orders > 0 ? (
          <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-white/60">
            <strong className="text-white/80">Where Leafly totals come from:</strong>{" "}
            {src.payload} from the order Leafly sent us, {src.registerCopy} from the copy rung up
            at the register, {src.unknown} unknown. Unknown totals are left out of every money
            figure rather than guessed. Leafly money is in cents; the register collects the
            order total, not the tip.
          </p>
        ) : null}
      </Section>

      {/* ================= LEAFLY CONTRACT (kept) ================= */}
      <div className="pt-2">
        <h2 className="text-base font-black uppercase tracking-[0.14em] text-[#b07cff]">
          Leafly integration health
        </h2>
        <p className="mt-0.5 text-xs text-white/45">
          The sections below are about Leafly only — how well we keep Leafly&apos;s ordering
          contract.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Leafly orders" value={String(report.totalOrders)} hint={range.label} />
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
          label="Leafly order value"
          value={formatReportMoney(report.grossMinorUnits)}
          hint={
            report.averageOrderMinorUnits === null
              ? "No totals on file"
              : `avg ${formatReportMoney(report.averageOrderMinorUnits)} over ${report.ordersWithTotal} with the order on file`
          }
        />
      </div>

      {/*
        LIFECYCLE REACH — the customer-notification answer, as evidence.
      */}
      <Section
        title="Did the Leafly customer ever hear back?"
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
            hint={`Leafly orders we accepted, of ${report.totalOrders}`}
          />
          <StatCard
            label="Reached Confirmed"
            value={formatRate(report.lifecycle.confirmedRate)}
            hint={`${report.lifecycle.reachedConfirmed} of ${report.lifecycle.acknowledged} acknowledged`}
          />
          <StatCard
            label="Reached Ready"
            value={formatRate(report.lifecycle.readyRate)}
            accent={report.lifecycle.readyRate === 0 ? "orange" : "muted"}
            hint={`${report.lifecycle.reachedReady} of ${report.lifecycle.acknowledged} acknowledged — this is the notification the shopper cares about`}
          />
          <StatCard
            label="Reached Picked up"
            value={formatRate(report.lifecycle.pickedUpRate)}
            hint={`${report.lifecycle.reachedPickedUp} of ${report.lifecycle.acknowledged} acknowledged — required for Leafly production access`}
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
        <Section title="Leafly order status mix">
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

      <Section title="Leafly daily volume">
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
