import { vendorOfDayReminder } from "@/lib/inventory/count-generators-core";
import { vendorCountPlannedToday } from "@/lib/inventory/count-generators-store";
import { fullCountReminder } from "@/lib/inventory/full-count-core";
import { hasFullCountForYear } from "@/lib/inventory/full-count-store";
import { formatHourLabel, pacificParts, pacificToday } from "@/lib/reports/timezone";
import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Section } from "@/components/admin/ui/Section";
import { Card, CardHeader } from "@/components/admin/ui/Card";
import { Button } from "@/components/admin/ui/Button";
import { cockpitLowStock, cockpitOps, cockpitRefunds, cockpitSales } from "@/lib/admin/cockpit-data";
import { CockpitPanelSkeleton, CockpitSectionSkeleton } from "@/components/admin/perf/CockpitSkeletons";
import { getSetupStatus } from "@/lib/admin/setup-status";
import { WorkspaceTour } from "@/components/admin/WorkspaceTour";
import {
  formatMoneyMinor,
  peakHour,
  buildAttentionFlags,
  type Delta,
} from "@/lib/admin/cockpit-core";
import { ComparisonBasisPicker } from "@/components/admin/ComparisonBasisPicker";
import { formatRate } from "@/lib/admin/refund-metrics-core";
import type { MeasureComparison } from "@/lib/admin/comparison-data";
import { can } from "@/lib/auth/roles";
import { getWorkQueueInputs } from "@/lib/catalog/hub";
import { emptyWorkQueueInputs, workQueueAttentionFlags } from "@/lib/catalog/work-queue-core";
import { missingWebhookSecrets } from "@/lib/security/fail-closed";
import { isAtRestEncryptionConfigured } from "@/lib/security/at-rest-crypto";
import { getOverdueComplianceCount } from "@/lib/compliance/compliance-calendar-store";
import { listAuditSessions } from "@/lib/inventory/audit-hub-store";
import { loadCockpitLeafly, loadCockpitTaxes } from "@/lib/admin/cockpit-extras-server";
import { leaflyTile } from "@/lib/admin/cockpit-extras-core";
import { describeElapsed } from "@/lib/leafly/schedule-core";
import { GuidedCashPanel } from "@/components/admin/registers/GuidedCashPanel";
import { MorningReportPanel } from "@/components/admin/registers/MorningReportPanel";
import { MyDayHomePanel } from "@/components/admin/registers/MyDayPanel";
import { canReadBooks } from "@/lib/accounting/books-view-core";
import {
  categoryMixVsBaseline,
  dailyTrend,
  hourlyVsBaseline,
  trafficVsLabor,
  weekHourHeatmap,
} from "@/lib/admin/cockpit-analytics-core";
import { cockpitAtm, cockpitLabor, cockpitOnShift, cockpitTrend } from "@/lib/admin/cockpit-analytics-server";
import { HourlyComparisonChart } from "@/components/admin/charts/cockpit/HourlyComparisonChart";
import { TrafficLaborChart } from "@/components/admin/charts/cockpit/TrafficLaborChart";
import { CategoryMixExplorer } from "@/components/admin/charts/cockpit/CategoryMixExplorer";
import { BasketTrendChart, CustomerMixDonut, SalesTrendChart } from "@/components/admin/charts/cockpit/TrendCharts";
import { AtmDepletionChart, AtmDispenseChart, AtmWeekdayChart } from "@/components/admin/charts/cockpit/AtmCharts";
import { WeekHourHeatmap } from "@/components/admin/charts/cockpit/WeekHourHeatmap";
import { OnShiftBoard } from "@/components/admin/charts/cockpit/OnShiftBoard";

export const dynamic = "force-dynamic";

/** Accent for a delta pill: green up, orange down, muted flat. */
/**
 * SLICE 21 — the hint under a KPI.
 *
 * Says WHAT it is comparing against (the basis label), and, when the baseline
 * turned out thinner than the basis advertises, says so. A "last 12 Sundays"
 * average built from 3 Sundays is still useful, but it must not be presented
 * with the same confidence as a full one.
 */
function measureHint(m: MeasureComparison, comparisonLabel: string, isMoney: boolean): string {
  if (m.baseline === null) {
    return `No baseline data ${comparisonLabel.replace(/^vs /, "for ")}`;
  }
  const arrow = m.delta.direction === "up" ? "\u25b2" : m.delta.direction === "down" ? "\u25bc" : "\u25ac";
  const pct = m.delta.pct === null ? "\u2014" : `${Math.abs(Math.round(m.delta.pct))}%`;
  const base = isMoney ? formatMoneyMinor(m.baseline) : String(m.baseline);
  const qual = m.qualifier ? ` (${m.qualifier})` : "";
  return `${arrow} ${pct} ${comparisonLabel} \u00b7 ${base}${qual}`;
}

function deltaAccent(d: Delta): "green" | "orange" | "muted" {
  if (d.isNew || d.direction === "up") return "green";
  if (d.direction === "down") return "orange";
  return "muted";
}


/*
 * PERF P3 (owner 2026-11-05, verbatim: "I need my back office to be lightning
 * fast" ... "I want the main admin page to be instant").
 *
 * BEFORE: the page awaited ONE Promise.all of every read (sales today,
 * yesterday and the baseline; taxes; returns; the order board; registers; the
 * low-stock walk over every lot; the intake queue; Leafly; setup; audits)
 * and only then sent its first byte. The slowest read decided when anything
 * at all appeared.
 *
 * NOW: the header, the banners that need no data and every section's frame
 * are sent at once. Each section below is its own async component inside its
 * own <Suspense>, and paints the moment ITS figures are ready. Reads shared
 * between sections are made once per request (React cache in
 * cockpit-data.ts), and the heavy figures are shared for a few seconds across
 * staff (cockpit-cache-core.ts: display only, failed reads never stored).
 * tests/compliance/perf-p3-cockpit-instant.test.ts pins all of this.
 */

/* ── Compliance + setup banners (books-23: the compliance count is the owner's alone) ── */
async function CockpitBanners({ canSeeCompliance }: { canSeeCompliance: boolean }) {
  const [setup, overdueCompliance] = await Promise.all([
    getSetupStatus(),
    canSeeCompliance ? getOverdueComplianceCount() : Promise.resolve(0),
  ]);
  const setupComplete = setup.completed >= setup.total;
  return (
    <>
      {/* ── S-18: overdue compliance-calendar obligations (books-23: owner only) ──
          The permission is re-checked here as well as at the fetch. That is not
          redundancy for its own sake: the fetch guard protects the QUERY and the
          render guard protects the SCREEN, and a future edit that reinstates an
          unconditional fetch would otherwise silently start nagging staff again.
          The link target refuses non-owners, so showing it would advertise a
          door that does not open. */}
      {canSeeCompliance && overdueCompliance > 0 && (
        <Link
          href="/admin/compliance/calendar"
          className="admin-card-interactive block rounded-[var(--admin-radius-lg)] border border-red-500/40 bg-red-500/[0.08] px-5 py-4"
        >
          <p className="text-sm font-semibold text-red-300">
            {overdueCompliance} compliance obligation{overdueCompliance === 1 ? " is" : "s are"} past due
          </p>
          <p className="mt-1 text-xs text-red-200/90">
            Open the compliance calendar to see what&apos;s overdue (LIQ-1295, weekly CCRS,
            CCTV retention check, …) and sign it off once done.
          </p>
        </Link>
      )}


      {/* ── Setup progress nudge (only until fully set up) ─────────────────
          Links straight to the next incomplete step's page (the checks in
          setup-status carry their own href). Disappears once every real
          setup check reads done. */}
      {!setupComplete && (
        <Link
          href={setup.nextAction?.href ?? "/admin/help"}
          className="admin-card-interactive flex flex-wrap items-center gap-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/[0.06] px-5 py-4"
        >
          <span className="text-2xl" aria-hidden="true">
            🧭
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--admin-text)]">
              Finish setting up your store
            </p>
            <p className="text-xs text-[var(--admin-text-muted)]">
              {setup.completed} of {setup.total} steps done
              {setup.nextAction ? ` · next: ${setup.nextAction.label}` : ""}
            </p>
          </div>
          <div className="hidden w-40 sm:block">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[var(--admin-accent)]"
                style={{
                  width: `${Math.round((setup.completed / Math.max(setup.total, 1)) * 100)}%`,
                }}
              />
            </div>
          </div>
          <span className="shrink-0 text-sm font-medium text-[var(--admin-accent)]">
            Continue setup →
          </span>
        </Link>
      )}
    </>
  );
}

/* ── Needs your attention: every flag source, owner-only reads gated at the fetch ── */
async function CockpitAttention({
  basis,
  canWorkIntake,
  canReviewAudits,
  todayPacific,
  wantsFullCountCheck,
}: {
  basis?: string;
  canWorkIntake: boolean;
  canReviewAudits: boolean;
  todayPacific: string;
  wantsFullCountCheck: boolean;
}) {
  const [ops, refunds, lowStockCount, intakeInputs, auditsInReview, vendorToday, fullCountPlanned] = await Promise.all([
    cockpitOps(),
    cockpitRefunds(basis),
    cockpitLowStock(),
    canWorkIntake ? getWorkQueueInputs() : Promise.resolve(emptyWorkQueueInputs()),
    canReviewAudits ? listAuditSessions({ statuses: ["review"], limit: 20 }) : Promise.resolve(null),
    // Fix Phase 4.4c (G-40): the vendor-of-the-day reminder, owner only.
    canReviewAudits ? vendorCountPlannedToday().catch(() => null) : Promise.resolve(null),
    wantsFullCountCheck
      ? hasFullCountForYear(Number(todayPacific.slice(0, 4))).catch(() => null)
      : Promise.resolve(null),
  ]);
  const snap = { ...ops, ...refunds, lowStockCount };
  const yearEndReminder =
    fullCountPlanned === null ? null : fullCountReminder({ todayPacific, hasCountForYear: fullCountPlanned });
  const vendorReminder = vendorToday
    ? vendorOfDayReminder({ started: vendorToday.started, plannedToday: vendorToday.planned })
    : null;
  // W3: the product-intake pipeline surfaces its work here too — same verified
  // counts, same priority order, and same copy as the hub's work queue.
  const flags = [
    ...buildAttentionFlags({
      activeOrders: snap.activeOrders,
      lowStockCount: snap.lowStockCount ?? 0,
      drawers: snap.drawers,
      publishedItems: snap.publishedItems,
      refunds: {
        severity: snap.refundSeverityToday,
        refundMinor: snap.netToday.refundMinor,
        ratePct: formatRate(snap.netToday.refundRate),
      },
      auditsAwaitingReview:
        auditsInReview && auditsInReview.ok
          ? auditsInReview.data.map((a) => ({ id: a.id, label: a.label }))
          : [],
    }),
    ...workQueueAttentionFlags(intakeInputs),
    ...(vendorReminder
      ? [{ severity: "info" as const, text: vendorReminder, href: "/admin/inventory/audits/new?gen=vendor" }]
      : []),
    ...(yearEndReminder
      ? [{ severity: "info" as const, text: yearEndReminder, href: "/admin/inventory/audits/full-count" }]
      : []),
  ];
  return (
    <>
      {/* ── Needs your attention ─────────────────────────────────────── */}
      {flags.length > 0 && (
        <Section title="Needs your attention">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {flags.map((f, i) => {
              const tone =
                f.severity === "critical"
                  ? "border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 text-[var(--admin-danger)]"
                  : f.severity === "warning"
                    ? "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]"
                    : "border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]";
              const inner = (
                <div className={`flex items-start gap-2 rounded-[var(--admin-radius)] border px-3 py-2.5 text-sm ${tone}`}>
                  <span>
                    {f.severity === "critical" ? "🚨" : f.severity === "warning" ? "⚠️" : "ℹ️"}
                  </span>
                  <span className="text-[var(--admin-text)]">{f.text}</span>
                </div>
              );
              return f.href ? (
                <Link key={i} href={f.href} className="admin-focus">
                  {inner}
                </Link>
              ) : (
                <div key={i}>{inner}</div>
              );
            })}
          </div>
        </Section>
      )}
    </>
  );
}

/* ── Today's sales KPIs (vs the chosen basis) ── */
async function CockpitSalesSection({ basis }: { basis?: string }) {
  const snap = await cockpitSales(basis);
  return (
    <>
      {/* ── Today's sales KPIs (vs the chosen basis) ────────────────────── */}
      <Section
        title="Today's sales"
        description={`${snap.comparison.window.comparisonLabel.replace(/^vs /, "Compared with ")}. ${snap.comparison.window.paceNote}`}
      >
        <div className="mb-4">
          <ComparisonBasisPicker active={snap.basis} />
        </div>
        {/* Rule 135: an unreadable day is said out loud, never shown as a quiet $0. */}
        {!snap.todayReadable ? (
          <p role="status" className="mb-3 text-xs text-[var(--admin-gold)]">
            Today&apos;s sales could not be read just now, so these tiles show zero. Refresh in a moment.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Revenue"
            value={formatMoneyMinor(snap.today.totalRevenueMinorUnits)}
            hint={measureHint(snap.comparison.revenue, snap.comparison.window.comparisonLabel, true)}
            accent={deltaAccent(snap.comparison.revenue.delta)}
            icon="💵"
          />
          <StatCard
            label="Orders"
            value={snap.today.totalOrders}
            hint={measureHint(snap.comparison.orders, snap.comparison.window.comparisonLabel, false)}
            accent={deltaAccent(snap.comparison.orders.delta)}
            icon="🧾"
          />
          <StatCard
            label="Units sold"
            value={snap.today.totalUnits}
            hint={measureHint(snap.comparison.units, snap.comparison.window.comparisonLabel, false)}
            accent={deltaAccent(snap.comparison.units.delta)}
            icon="📦"
          />
          <StatCard
            label="Avg. order"
            value={formatMoneyMinor(snap.today.avgOrderMinorUnits)}
            hint={measureHint(snap.comparison.avgOrder, snap.comparison.window.comparisonLabel, true)}
            accent={deltaAccent(snap.comparison.avgOrder.delta)}
            icon="🛒"
          />
        </div>
      </Section>
    </>
  );
}

/* ── CVB-D18: today's taxes ── */
async function CockpitTaxSection() {
  // CVB-D18: today's excise / sales tax / after-tax sales, the Reports -> Tax engine. null = unreadable.
  const taxes = await loadCockpitTaxes();
  return (
    <>
      {/* ── CVB-D18: today's taxes and after-tax sales ──────────────────────────────────
          Owner: "I want to see excise tax, sales tax, and after tax sales figures." Same engine and
          basis as Reports -> Tax (completed orders, 37% excise on cannabis, 9.3% sales tax, medical
          exemptions honoured). Unreadable = "Unavailable", never $0.00. */}
      <Section
        title="Today's taxes"
        description="Completed sales today, worked out the same way as Reports → Tax. After-tax sales is what the store keeps once excise and sales tax are set aside."
      >
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="After-tax sales"
            value={taxes ? formatMoneyMinor(taxes.afterTaxMinor) : "Unavailable"}
            hint={taxes ? `${taxes.orders} completed order${taxes.orders === 1 ? "" : "s"} · ${formatMoneyMinor(taxes.withTaxMinor)} with tax` : "The tax figures could not be read"}
            accent={taxes ? "green" : "orange"}
            href="/admin/reports/tax"
            icon="🧾"
          />
          <StatCard
            label="Excise tax (37%)"
            value={taxes ? formatMoneyMinor(taxes.exciseMinor) : "Unavailable"}
            hint="Cannabis lines only · owed to the WSLCB"
            accent={taxes ? "gold" : "orange"}
            href="/admin/reports/excise"
            icon="🏛️"
          />
          <StatCard
            label="Sales tax"
            value={taxes ? formatMoneyMinor(taxes.salesTaxMinor) : "Unavailable"}
            hint="State + local · owed to the DOR"
            accent={taxes ? "gold" : "orange"}
            href="/admin/reports/tax"
            icon="📋"
          />
          <StatCard
            label="Total tax"
            value={taxes ? formatMoneyMinor(taxes.exciseMinor + taxes.salesTaxMinor) : "Unavailable"}
            hint={
              taxes && taxes.medicalExemptLines > 0
                ? `${taxes.medicalExemptLines} medical-exempt line${taxes.medicalExemptLines === 1 ? "" : "s"} not taxed`
                : "Excise + sales tax"
            }
            accent={taxes ? "muted" : "orange"}
            href="/admin/reports/tax"
            icon="∑"
          />
        </div>
      </Section>
    </>
  );
}

/* ── SLICE 21: returns, voids and net ── */
async function CockpitRefundsSection({ basis }: { basis?: string }) {
  const snap = await cockpitRefunds(basis);
  return (
    <>
      {/* ── SLICE 21: returns, voids and NET ─────────────────────────────
          Michael: "nowhere in the back office can I find anything related to
          returns or voids". The facts were recorded all along (voids in
          audit_logs, returns in customer_returns) but only the register's
          X/Z slip ever read them. Revenue above is GROSS — this is what the
          business actually kept. */}
      <Section
        title="Returns, voids & net"
        description="Today, store-wide. Neither voids nor returns record which register they happened on, so these are not per-register numbers."
      >
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Net revenue"
            value={formatMoneyMinor(snap.netToday.netMinor)}
            hint={`Gross ${formatMoneyMinor(snap.netToday.grossMinor)} − refunds ${formatMoneyMinor(snap.netToday.refundMinor)}`}
            accent={snap.netToday.netMinor < 0 ? "orange" : "green"}
            icon="💰"
          />
          <StatCard
            label="Refunded out"
            value={formatMoneyMinor(snap.netToday.refundMinor)}
            hint={`${formatRate(snap.netToday.refundRate)} of gross`}
            accent={
              snap.refundSeverityToday === "high"
                ? "orange"
                : snap.refundSeverityToday === "watch"
                  ? "gold"
                  : "muted"
            }
            icon="↩️"
          />
          <StatCard
            label="Voids"
            value={snap.refundsToday.totals.voidCount}
            hint={`${formatMoneyMinor(snap.refundsToday.totals.voidRefundMinor)} reversed`}
            accent={snap.refundsToday.totals.voidCount > 0 ? "gold" : "muted"}
            icon="❌"
          />
          <StatCard
            label="Returns"
            value={snap.refundsToday.totals.returnCount}
            hint={`${formatMoneyMinor(snap.refundsToday.totals.returnRefundMinor)} refunded`}
            accent={snap.refundsToday.totals.returnCount > 0 ? "gold" : "muted"}
            icon="🔁"
          />
        </div>
        {snap.refundsToday.byReason.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {snap.refundsToday.byReason.map((r) => (
              <span
                key={r.key}
                className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold text-white/65"
              >
                {r.label}: {r.count} · {formatMoneyMinor(r.refundMinor)}
              </span>
            ))}
            {snap.refundsToday.restockShare !== null && (
              <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold text-white/65">
                Restocked: {formatRate(snap.refundsToday.restockShare, 0)} of returned value
              </span>
            )}
          </div>
        )}
        <p className="mt-3 text-[11px] text-white/40">
          <Link href="/admin/reports/returns" className="text-[var(--admin-accent)] hover:underline">
            Full returns &amp; voids report →
          </Link>
        </p>
      </Section>
    </>
  );
}

/* ── Hourly sales + top sellers ── */
/*
 * D210b (owner 2026-11-07: "add more details to the bar chart, have it show
 * more based on the selection of the top comparisons ... A line chart to
 * compliment the bar chart"): today's hours against the SAME basis the picker
 * chose, hour by hour (bars) or as running totals with a projection to close
 * (lines). The baseline is built from the basis's own days (closed days
 * skipped; "max" = the best whole day), by hourlyVsBaseline (pure).
 * CVB-D19's hourWindow still sets the drawn hours (8 AM to midnight, widened
 * to any hour that sold) through the same 8/24 defaults.
 */
async function CockpitHourlySection({ basis }: { basis?: string }) {
  const snap = await cockpitSales(basis);
  const now = pacificParts(new Date());
  const hourly = hourlyVsBaseline({
    todayByHour: snap.today.byHour,
    baselineByDay: snap.baseline.byDay,
    baselineByDayHour: snap.baseline.byDayHour,
    windowDays: snap.comparison.window.days,
    mode: snap.comparison.window.mode,
    nowHour: now.hour,
    nowMinute: now.minute,
  });
  const peak = peakHour(snap.today.byHour);
  const topSellers = snap.today.byProduct.slice(0, 6);
  const label = snap.comparison.window.comparisonLabel;
  const hasBaseline = hourly.baseline.days.length > 0;
  const pacePct = hourly.pace !== null ? Math.round((hourly.pace - 1) * 100) : null;
  return (
    <>
      {/* ── Hourly sales + top sellers ─────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" padding="none">
          <CardHeader
            className="p-5 pb-0"
            title="Sales by hour (today)"
            subtitle={
              peak
                ? `Busiest so far: ${peak.label} (${formatMoneyMinor(peak.revenueMinorUnits)}) \u00b7 ${label}${
                    hourly.baseline.partial && hasBaseline ? ` (${hourly.baseline.days.length} of ${hourly.baseline.requested} days traded)` : ""
                  }`
                : `No sales recorded yet today \u00b7 ${label}`
            }
          />
          <div className="p-5 pt-3">
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Today so far" value={formatMoneyMinor(hourly.todaySoFarMinor)} />
              <MiniStat
                label="Basis by now"
                value={hourly.baselineSoFarMinor !== null ? formatMoneyMinor(hourly.baselineSoFarMinor) : "\u2014"}
                hint={label.replace(/^vs /, "")}
              />
              <MiniStat
                label="Pace"
                value={pacePct === null ? "\u2014" : `${pacePct >= 0 ? "+" : ""}${pacePct}%`}
                tone={pacePct === null ? "muted" : pacePct >= 0 ? "green" : "orange"}
                hint={pacePct === null ? "No basis at this hour" : pacePct >= 0 ? "ahead of the basis" : "behind the basis"}
              />
              <MiniStat
                label="Projected close"
                value={hourly.projectedDayMinor !== null ? formatMoneyMinor(hourly.projectedDayMinor) : "\u2014"}
                hint={
                  hourly.baselinePeakHour !== null
                    ? `Basis rush: ${formatHourLabel(hourly.baselinePeakHour)}`
                    : hourly.baselineDayMinor !== null
                      ? `Basis day ${formatMoneyMinor(hourly.baselineDayMinor)}`
                      : undefined
                }
              />
            </div>
            <HourlyComparisonChart rows={hourly.rows} basisLabel={label} hasBaseline={hasBaseline} />
          </div>
        </Card>

        <Card padding="none">
          <CardHeader className="p-5 pb-0" title="Top sellers (today)" />
          <div className="p-5 pt-0">
            {topSellers.length > 0 ? (
              <ol className="space-y-2">
                {topSellers.map((p, i) => (
                  <li key={p.label} className="text-sm">
                    <div className="flex items-center gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--admin-surface-2)] text-xs font-bold text-[var(--admin-text-muted)]">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[var(--admin-text)]">{p.label}</span>
                      <span className="shrink-0 text-xs text-[var(--admin-text-muted)]">
                        {p.units}\u00d7 \u00b7 {formatMoneyMinor(p.revenueMinorUnits)}
                      </span>
                    </div>
                    <div className="ml-9 mt-1 h-1 overflow-hidden rounded-full bg-[var(--admin-surface-2)]">
                      <div
                        className="h-full rounded-full bg-[var(--admin-accent)]/70"
                        style={{ width: `${Math.max(3, Math.round((p.revenueMinorUnits / Math.max(1, topSellers[0].revenueMinorUnits)) * 100))}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="py-6 text-center text-sm text-[var(--admin-text-faint)]">
                No products sold yet today.
              </p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

/** A small figure for the cockpit chart headers. */
function MiniStat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "green" | "orange" | "muted";
}) {
  const color =
    tone === "green"
      ? "text-[var(--admin-accent)]"
      : tone === "orange"
        ? "text-orange-400"
        : tone === "muted"
          ? "text-[var(--admin-text-muted)]"
          : "text-[var(--admin-text)]";
  return (
    <div className="rounded-[var(--admin-radius)] bg-[var(--admin-surface-2)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--admin-text-faint)]">{label}</div>
      <div className={`text-base font-bold tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="truncate text-[10px] text-[var(--admin-text-faint)]">{hint}</div> : null}
    </div>
  );
}

/* ── D210c: hourly foot traffic vs sales vs labor ── */
/*
 * Owner 2026-11-07: "an hourly foot traffic vs sales ... overlaying labor
 * hours or transactions over the hourly sales. This helps you visually
 * optimize budtender scheduling to match peak rush times." Labor (time
 * punches) is drawn only for staffing.manage / reports.view; everyone else
 * sees revenue and transactions against the basis.
 */
async function CockpitTrafficSection({ basis, showLabor }: { basis?: string; showLabor: boolean }) {
  const [snap, labor] = await Promise.all([cockpitSales(basis), showLabor ? cockpitLabor() : Promise.resolve(null)]);
  const now = pacificParts(new Date());
  const hourly = hourlyVsBaseline({
    todayByHour: snap.today.byHour,
    baselineByDay: snap.baseline.byDay,
    baselineByDayHour: snap.baseline.byDayHour,
    windowDays: snap.comparison.window.days,
    mode: snap.comparison.window.mode,
    nowHour: now.hour,
    nowMinute: now.minute,
  });
  const tl = trafficVsLabor({ hourly, labor: labor?.labor ?? [] });
  const label = snap.comparison.window.comparisonLabel;
  const laborShown = showLabor && labor !== null;
  return (
    <Section
      title="Traffic, sales & labor by hour"
      description={
        laborShown
          ? "Bars are revenue; lines are transactions, the basis's transactions for the same hour, and labor hours on the clock. Where transactions run well above labor, the floor is stretched."
          : "Bars are revenue; lines are transactions today and on the basis for the same hour."
      }
    >
      {laborShown && !labor!.ok ? (
        <p role="status" className="mb-3 text-xs text-[var(--admin-gold)]">
          Time punches could not be read just now, so the labor line is missing. Refresh in a moment.
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-4">
        <Card className="lg:col-span-3" padding="none">
          <div className="p-5">
            <TrafficLaborChart rows={tl.rows} basisLabel={label} showLabor={laborShown} />
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <MiniStat label="Transactions today" value={String(snap.today.totalOrders)} hint={label.replace(/^vs /, "Basis: ")} />
          {laborShown ? (
            <>
              <MiniStat label="Labor hours so far" value={tl.noLabor ? "\u2014" : String(tl.totalLaborHours)} hint={tl.noLabor ? "No punches recorded today" : undefined} />
              <MiniStat
                label="Sales per labor hour"
                value={tl.splhMinor !== null ? formatMoneyMinor(tl.splhMinor) : "\u2014"}
                hint="Revenue \u00f7 hours on the clock"
              />
              <MiniStat
                label="Most stretched"
                value={tl.mostStretchedHour !== null ? formatHourLabel(tl.mostStretchedHour) : "\u2014"}
                hint={
                  tl.idleStaffedHours.length > 0
                    ? `Staffed, no sales: ${tl.idleStaffedHours.map((h) => formatHourLabel(h)).join(", ")}`
                    : "Most orders per labor hour"
                }
                tone={tl.mostStretchedHour !== null ? "orange" : "muted"}
              />
            </>
          ) : (
            <MiniStat
              label="Basis rush"
              value={hourly.baselinePeakHour !== null ? formatHourLabel(hourly.baselinePeakHour) : "\u2014"}
              hint="Busiest hour on the basis"
            />
          )}
        </div>
      </div>
    </Section>
  );
}

/* ── D210d: who on the clock is selling ── */
async function CockpitOnShiftSection() {
  const r = await cockpitOnShift();
  return (
    <Section
      title="On the clock now"
      description={r.board.leaderName ? `${r.board.leaderName} has rung the most sales today among people on the clock.` : "Who is on the clock and what they have rung today."}
    >
      {!r.ok ? (
        <p role="status" className="mb-3 text-xs text-[var(--admin-gold)]">
          Time punches or register sales could not be read just now, so this board may be incomplete.
        </p>
      ) : null}
      <Card>
        <OnShiftBoard board={r.board} />
      </Card>
    </Section>
  );
}

/* ── D210e: categories and the types inside them ── */
async function CockpitMixSection({ basis }: { basis?: string }) {
  const snap = await cockpitSales(basis);
  const mix = categoryMixVsBaseline({
    today: snap.today.byTypeWithinCategory,
    baselineByDay: snap.baseline.byDay,
    baselineByDayCategoryType: snap.baseline.byDayCategoryType,
    windowDays: snap.comparison.window.days,
    mode: snap.comparison.window.mode,
  });
  const label = snap.comparison.window.comparisonLabel;
  const bits: string[] = [];
  if (mix.topGainer) bits.push(`${mix.topGainer} is gaining share`);
  if (mix.topLoser) bits.push(`${mix.topLoser} is losing share`);
  return (
    <Section
      title="Category & type mix"
      description={`Today's revenue by category and the types inside each, ${label}.${bits.length ? ` ${bits.join("; ")}.` : ""}`}
    >
      <Card>
        <CategoryMixExplorer
          categories={mix.categories}
          basisLabel={label}
          hasBaseline={mix.baseline.days.length > 0}
          todayTotalMinor={mix.todayTotalMinor}
        />
      </Card>
    </Section>
  );
}

/* ── D210g: the last four weeks ── */
async function CockpitTrendSection({ basis }: { basis?: string }) {
  const [trend, snap] = await Promise.all([cockpitTrend(), cockpitSales(basis)]);
  const today = snap.todayYmd;
  const t = dailyTrend(
    trend.history.byDay,
    { date: today, revenueMinorUnits: snap.today.totalRevenueMinorUnits, orders: snap.today.totalOrders, units: snap.today.totalUnits },
    today,
  );
  const heat = weekHourHeatmap(trend.history.byDay, trend.history.byDayHour);
  const [y, m, d] = today.split("-").map(Number);
  const todayDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (
    <Section
      title="Last four weeks"
      description={`Daily revenue with its 7-day average (today in gold, so far), the basket, and when the rush really comes.${
        t.avgDayMinor !== null ? ` Average trading day: ${formatMoneyMinor(t.avgDayMinor)}.` : ""
      }${t.bestDay ? ` Best: ${t.bestDay.date} (${formatMoneyMinor(t.bestDay.revenueMinor)}).` : ""}`}
    >
      {!trend.ok ? (
        <p role="status" className="mb-3 text-xs text-[var(--admin-gold)]">
          The last four weeks could not be read just now. Refresh in a moment.
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" padding="none">
          <CardHeader className="p-5 pb-0" title="Daily revenue" subtitle={`${t.tradingDays} trading days \u00b7 closed days are gaps, not $0`} />
          <div className="p-5 pt-3">
            <SalesTrendChart rows={t.rows} />
          </div>
        </Card>
        <Card padding="none">
          <CardHeader className="p-5 pb-0" title="Who is buying (today)" subtitle="Orders by customer type" />
          <div className="p-5 pt-3">
            <CustomerMixDonut rows={snap.today.byCustomerType} />
          </div>
        </Card>
        <Card className="lg:col-span-2" padding="none">
          <CardHeader className="p-5 pb-0" title="When the rush comes" subtitle="Average orders by weekday and hour, last 28 days. Today's row is outlined." />
          <div className="p-5 pt-3">
            <WeekHourHeatmap heat={heat} todayDow={todayDow} />
          </div>
        </Card>
        <Card padding="none">
          <CardHeader className="p-5 pb-0" title="The basket" subtitle="Average order and units per order" />
          <div className="p-5 pt-3">
            <BasketTrendChart rows={t.rows} />
          </div>
        </Card>
      </div>
    </Section>
  );
}

/* ── D210f: the ATM, what it dispenses and when it runs empty (owner only) ── */
async function CockpitAtmSection() {
  const atm = await cockpitAtm();
  if (!atm.configured) return null;
  const f = atm.forecast;
  const st = atm.stats;
  const sourceLine =
    atm.currentCashSource === "live"
      ? `Read live from the machine${atm.capturedAt ? ` (${new Date(atm.capturedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" })})` : ""}`
      : atm.currentCashSource === "estimate"
        ? `Estimated: last load minus settled withdrawals through ${atm.dispensedThroughDate ?? "the last settlement"}${atm.sameDayLoadCaveat ? " (a high estimate: load-day withdrawals are not split out)" : ""}`
        : "No cash reading yet";
  const emptyValue = !f.hasForecast
    ? "\u2014"
    : f.likelyEmptyDate === null
      ? `${f.horizonDays}+ days`
      : f.likelyDaysLeft === 0
        ? "Today"
        : `${f.likelyDaysLeft} day${f.likelyDaysLeft === 1 ? "" : "s"}`;
  const rangeHint =
    f.hasForecast && f.likelyEmptyDate
      ? `Likely ${f.likelyEmptyDate}; range ${f.earlyEmptyDate ?? "?"} to ${f.lateEmptyDate ?? `${f.horizonDays}+ days`}`
      : f.reason ?? undefined;
  return (
    <Section
      title="ATM cash"
      description="What the machine dispenses and when it is likely to run empty, from settled days and the weekday pattern. A planning range, not a guarantee."
      action={
        <Button href="/admin/atm" variant="neutral" size="sm">
          Open ATM
        </Button>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MiniStat label="Cash in machine" value={atm.currentCashCents !== null ? formatMoneyMinor(atm.currentCashCents) : "\u2014"} hint={sourceLine} />
        <MiniStat
          label="Runs empty in"
          value={emptyValue}
          hint={rangeHint}
          tone={f.urgent || (f.likelyDaysLeft !== null && f.likelyDaysLeft <= 2) ? "orange" : "default"}
        />
        <MiniStat
          label="Avg. dispensed / day"
          value={st.avgDailyCents !== null ? formatMoneyMinor(st.avgDailyCents) : "\u2014"}
          hint={`${st.daysObserved} settled days of the last ${st.windowDays}${st.trendPct !== null ? ` \u00b7 ${st.trendPct >= 0 ? "+" : ""}${st.trendPct}% week on week` : ""}`}
        />
        <MiniStat
          label="Avg. withdrawal"
          value={st.avgWithdrawalCents !== null ? formatMoneyMinor(st.avgWithdrawalCents) : "\u2014"}
          hint={st.avgWithdrawalsPerDay !== null ? `${st.avgWithdrawalsPerDay} withdrawals a day` : undefined}
        />
        <MiniStat
          label="PAI says"
          value={atm.paiDaysUntilCashOut !== null ? `${atm.paiDaysUntilCashOut} days` : "\u2014"}
          hint="PAI's own days-until-cash-out, for comparison"
          tone="muted"
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card padding="none">
          <CardHeader className="p-5 pb-0" title="Cash left, projected" subtitle="Likely path and the early-to-late range" />
          <div className="p-5 pt-3">
            {f.hasForecast && f.startCents !== null ? (
              <AtmDepletionChart points={f.points} startCents={f.startCents} startLabel="Now" thresholdCents={f.thresholdCents} />
            ) : (
              <p className="py-10 text-center text-sm text-[var(--admin-text-faint)]">{f.reason ?? "No forecast yet."}</p>
            )}
          </div>
        </Card>
        <Card padding="none">
          <CardHeader className="p-5 pb-0" title="Dispensed per day" subtitle="Last 30 days, settled" />
          <div className="p-5 pt-3">
            <AtmDispenseChart rows={atm.history} />
          </div>
        </Card>
        <Card padding="none">
          <CardHeader className="p-5 pb-0" title="By weekday" subtitle="Average and typical range, last 12 weeks" />
          <div className="p-5 pt-3">
            <AtmWeekdayChart weekdays={st.weekdays} />
          </div>
        </Card>
      </div>
    </Section>
  );
}

/* ── Open orders board + live registers ── */
async function CockpitOrdersSection() {
  const snap = await cockpitOps();
  return (
    <>
      {/* ── Open orders board + live registers ───────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card padding="none">
          <CardHeader
            className="p-5 pb-0"
            title="Open orders"
            subtitle={`${snap.activeOrders} awaiting fulfillment`}
            action={
              <Button href="/admin/orders" variant="neutral" size="sm">
                Manage
              </Button>
            }
          />
          <div className="grid grid-cols-2 gap-3 p-5 pt-0 sm:grid-cols-4">
            {snap.orderBoard.map((o) => (
              <Link
                key={o.status}
                href={`/admin/orders?status=${o.status}`}
                className="admin-card-interactive rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-center"
              >
                <div className="text-2xl font-bold text-[var(--admin-text)]">{o.count}</div>
                <div className="mt-0.5 text-[11px] text-[var(--admin-text-muted)]">{o.label}</div>
              </Link>
            ))}
          </div>
        </Card>

        <Card padding="none">
          <CardHeader
            className="p-5 pb-0"
            title="Register Activity"
            subtitle={
              snap.registers.length > 0
                ? `${snap.drawers.openCount} open · ${snap.drawers.verifiedCount} verified`
                : "No registers configured"
            }
            action={
              <Button href="/admin/registers" variant="neutral" size="sm">
                View activity
              </Button>
            }
          />
          <div className="p-5 pt-0">
            {snap.registers.length > 0 ? (
              <ul className="space-y-2">
                {snap.registers.map((r) => {
                  const s = r.openSession;
                  return (
                    <li
                      key={r.register.id}
                      className="flex items-center gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm"
                    >
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${s ? "bg-[var(--admin-accent)]" : "bg-white/20"}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-[var(--admin-text)]">
                        {r.register.name}
                      </span>
                      <span className="shrink-0 text-xs text-[var(--admin-text-muted)]">
                        {s
                          ? `${s.status} · drops ${formatMoneyMinor(r.dropsMinor)}`
                          : "Closed"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-[var(--admin-text-faint)]">
                Set up a register to track cash drawers.
              </p>
            )}
            {snap.drawers.needsAttention > 0 && (
              <p className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-3 py-2 text-xs text-[var(--admin-danger)]">
                {snap.drawers.needsAttention} drawer{snap.drawers.needsAttention === 1 ? "" : "s"} need review (closed blind or over/short).
              </p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ── Operations status strip ── */
async function CockpitOpsSection({ basis, canOpenLeafly }: { basis?: string; canOpenLeafly: boolean }) {
  const [ops, lowStockCount, sales, leafly] = await Promise.all([
    cockpitOps(),
    cockpitLowStock(),
    cockpitSales(basis),
    // CVB-D20: the Leafly verdict the Leafly page shows. null = could not be worked out.
    loadCockpitLeafly(),
  ]);
  const snap = { ...ops, lowStockCount };
  const leaflyCard = leaflyTile(leafly?.verdict ?? null, leafly?.lastCheckIso ?? null, (iso) =>
    describeElapsed(iso, leafly?.nowIso ?? new Date().toISOString()),
  );
  const topCategories = sales.today.byCategory.slice(0, 5);
  return (
    <>
      {/* ── Operations status strip ──────────────────────────────────── */}
      <Section title="Operations">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Live menu items"
            value={snap.publishedItems ?? "—"}
            hint={snap.publishedItems !== null ? "Currently published" : "No menu published"}
            accent="green"
            href="/admin/menu-imports"
            icon="🌿"
          />
          <StatCard
            label="Low stock"
            value={snap.lowStockCount ?? "Unavailable"}
            hint={
              snap.lowStockCount === null
                ? "Stock levels could not be read just now"
                : snap.lowStockCount > 0
                  ? "At/below reorder point"
                  : "All above reorder point"
            }
            accent={snap.lowStockCount === null || snap.lowStockCount > 0 ? "orange" : "muted"}
            href="/admin/purchasing"
            icon="📉"
          />
          {/* CVB-D20: the one-time menu upload is done, so this tile is now Leafly's: the same verdict as
              Integrations -> Leafly, when Leafly last got the menu, and the last automatic check. */}
          <StatCard
            label="Leafly"
            value={leaflyCard.value}
            hint={leaflyCard.hint}
            accent={leaflyCard.accent}
            href={canOpenLeafly ? "/admin/integrations/leafly" : undefined}
            icon="🍃"
          />
          <StatCard
            label="Loyalty signups"
            value={snap.loyaltySignups}
            hint="New — awaiting review"
            accent="gold"
            href="/admin/loyalty-signups"
            icon="⭐"
          />
        </div>

        {/* Top categories inline (only when there's data) */}
        {topCategories.length > 0 && (
          <div className="mt-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-white/40">
              Today&apos;s revenue by category
            </p>
            <div className="space-y-2">
              {topCategories.map((c) => (
                <div key={c.label} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-sm capitalize text-[var(--admin-text)]">
                    {c.label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[var(--admin-accent)]"
                      style={{ width: `${Math.round(c.revenueShare * 100)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs text-[var(--admin-text-muted)]">
                    {formatMoneyMinor(c.revenueMinorUnits)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ basis?: string; denied?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireStaff();
  const role = session.profile.role;
  // W3: intake work-queue flags only for people who can act on them — every
  // queue target requires inventory.manage, so gate the fetch the same way.
  const canWorkIntake = can(session.profile.role, "inventory.manage");
  /*
   * books-23: THE COMPLIANCE NAG IS THE OWNER'S ALONE.
   *
   * Michael, verbatim: "I want it to be for me alone too, the employees should
   * not be harassed by the system for my not making a payment or filing a
   * report etc. I'll keep that burden for myself."
   *
   * The COUNT IS NOT FETCHED for anyone else, rather than fetched and then not
   * rendered. Two reasons, and the second is the one that matters:
   *
   *   1. It is a database read of the owner's filing history that a budtender
   *      has no business causing.
   *   2. A value that exists in scope is one careless JSX edit away from being
   *      displayed again. A value that is 0 for everyone but the owner cannot
   *      come back by accident -- and `0` is exactly what the banner condition
   *      below already treats as "nothing to say".
   *
   * This is the same shape as canWorkIntake above, deliberately: one idiom on
   * this page instead of two.
   */
  const canSeeCompliance = can(session.profile.role, "compliance.calendar");
  // Fix Phase 4.1 (D55): finished counts waiting for the owner. Fetched only
  // for the owner (inventory.audit), the same idiom as canSeeCompliance.
  const canReviewAudits = can(session.profile.role, "inventory.audit");
  // Fix Phase 4.4d (G-41): in December only, remind the owner if this year's
  // full count is not planned. Looked up only in December, owner only.
  const todayPacific = pacificToday();
  const wantsFullCountCheck = canReviewAudits && todayPacific.slice(5, 7) === "12";
  const canOpenLeafly = can(session.profile.role, "settings.manage");
  // D181: every staff login sees the cash jobs (drop now, morning duties).
  const canSeeCash = can(session.profile.role, "orders.manage");
  // D210d/g: per-person and staffing figures (and the four-week trend) for
  // people who run the floor or read reports; the ATM panel is the owner's
  // (finances.view), the same gate as /admin/atm's money.
  const canSeeStaffing = can(session.profile.role, "staffing.manage") || can(session.profile.role, "reports.view");
  const canSeeAtm = can(session.profile.role, "finances.view");

  // S-9: surface unset webhook secrets loudly. In production those endpoints
  // now refuse (fail closed), so this banner tells the owner exactly which env
  // vars to set to bring the surfaces back online.
  const missingSecrets = missingWebhookSecrets();
  // S-10: nag until at-rest encryption for banking/credentials is keyed.
  const encryptionKeyMissing = !isAtRestEncryptionConfigured();

  const firstName =
    (session.profile.full_name ?? session.email).split(/[\s@]/)[0] || "there";
  const isOwner = canReadBooks(role);
  const basis = sp.basis;

  return (
    <div>
      <AdminPageHeader
        title={`Welcome back, ${firstName}`}
        subtitle={`Point-of-sale cockpit · signed in as ${ROLE_LABELS[session.profile.role]}.`}
        action={
          <div className="flex gap-2">
            <Button href="/admin/help" variant="neutral" size="sm">
              Help & FAQ
            </Button>
            <Button href="/" external variant="neutral" size="sm">
              View live site ↗
            </Button>
          </div>
        }
      />

      <div className="space-y-10 px-5 py-6 sm:px-8">
        {/* S31: requirePermission redirects here with ?denied=1 and
            requireBooksAccess with ?denied=books (session.ts, books-access.ts).
            The dashboard used to drop the flag, so a blocked click looked like
            a random jump back home. Neutral, one line, no data exposed. */}
        {sp.denied ? (
          <div role="status" className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm text-[var(--admin-text-muted)]">
            {sp.denied === "books"
              ? "The books are owner-only, so you were brought back to the dashboard."
              : "Your role doesn\u2019t have access to that page, so you were brought back to the dashboard. Ask the owner if you need it."}
          </div>
        ) : null}
        {/* ── S-9: missing webhook secrets (fail-closed surfaces offline) ── */}
        {missingSecrets.length > 0 && (
          <div className="rounded-[var(--admin-radius-lg)] border border-amber-500/30 bg-amber-500/[0.06] px-5 py-4">
            <p className="text-sm font-semibold text-amber-300">
              Webhook secrets missing — those endpoints refuse traffic in production
            </p>
            <ul className="mt-1 list-inside list-disc text-xs text-amber-200/90">
              {missingSecrets.map((m) => (
                <li key={m.envVar}>
                  {m.surface}: set <code className="font-mono">{m.envVar}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Suspense fallback={null}>
          <CockpitBanners canSeeCompliance={canSeeCompliance} />
        </Suspense>

        {/* ── S-10: at-rest encryption key not set ── */}
        {encryptionKeyMissing && (
          <div className="rounded-[var(--admin-radius-lg)] border border-amber-500/30 bg-amber-500/[0.06] px-5 py-4">
            <p className="text-sm font-semibold text-amber-300">
              At-rest encryption is off — banking details and API secrets are stored unencrypted
            </p>
            <p className="mt-1 text-xs text-amber-200/90">
              Set <code className="font-mono">DATA_ENCRYPTION_KEY</code> (any long random string) in the
              server environment. New saves of employee banking, the ACH funding account, and
              integration secrets are then encrypted automatically.
            </p>
          </div>
        )}
        {/* ── D181: cash jobs (drop now, morning duties, a bag every day). Each streams on its own. ── */}
        <Suspense fallback={canSeeCash ? <CockpitPanelSkeleton /> : null}>
          {canSeeCash ? <MyDayHomePanel isOwner={isOwner} /> : null}
        </Suspense>
        <Suspense fallback={canSeeCash ? <CockpitPanelSkeleton /> : null}>
          {canSeeCash ? <MorningReportPanel isOwner={isOwner} compact /> : null}
        </Suspense>
        <Suspense fallback={canSeeCash ? <CockpitPanelSkeleton /> : null}>
          {canSeeCash ? <GuidedCashPanel isOwner={isOwner} compact /> : null}
        </Suspense>

        <Suspense fallback={null}>
          <CockpitAttention
            basis={basis}
            canWorkIntake={canWorkIntake}
            canReviewAudits={canReviewAudits}
            todayPacific={todayPacific}
            wantsFullCountCheck={wantsFullCountCheck}
          />
        </Suspense>

        <Suspense fallback={<CockpitSectionSkeleton title="Today's sales" />}>
          <CockpitSalesSection basis={basis} />
        </Suspense>

        <Suspense fallback={<CockpitSectionSkeleton title="Today's taxes" />}>
          <CockpitTaxSection />
        </Suspense>

        <Suspense fallback={<CockpitSectionSkeleton title="Returns, voids & net" />}>
          <CockpitRefundsSection basis={basis} />
        </Suspense>

        <Suspense fallback={<CockpitSectionSkeleton tiles={3} tall />}>
          <CockpitHourlySection basis={basis} />
        </Suspense>

        <Suspense fallback={<CockpitSectionSkeleton title="Traffic, sales & labor by hour" tiles={2} tall />}>
          <CockpitTrafficSection basis={basis} showLabor={canSeeStaffing} />
        </Suspense>

        <Suspense fallback={canSeeStaffing ? <CockpitSectionSkeleton title="On the clock now" tiles={2} /> : null}>
          {canSeeStaffing ? <CockpitOnShiftSection /> : null}
        </Suspense>

        <Suspense fallback={<CockpitSectionSkeleton title="Category & type mix" tiles={2} tall />}>
          <CockpitMixSection basis={basis} />
        </Suspense>

        <Suspense fallback={canSeeStaffing ? <CockpitSectionSkeleton title="Last four weeks" tiles={3} tall /> : null}>
          {canSeeStaffing ? <CockpitTrendSection basis={basis} /> : null}
        </Suspense>

        <Suspense fallback={canSeeAtm ? <CockpitSectionSkeleton title="ATM cash" tiles={3} tall /> : null}>
          {canSeeAtm ? <CockpitAtmSection /> : null}
        </Suspense>

        <Suspense fallback={<CockpitSectionSkeleton tiles={2} tall />}>
          <CockpitOrdersSection />
        </Suspense>

        <Suspense fallback={<CockpitSectionSkeleton title="Operations" />}>
          <CockpitOpsSection basis={basis} canOpenLeafly={canOpenLeafly} />
        </Suspense>

        {/* ── Explore your back office (quick navigation) ────────────────────
            A compact launcher to every workspace, role-filtered. Best-in-class
            POS homes offer fast "jump back in" navigation beyond the KPIs. */}
        <Section
          title="Explore your back office"
          description="Jump straight into any area."
          action={
            <Button href="/admin/sop" variant="neutral" size="sm">
              Printable SOPs
            </Button>
          }
        >
          <WorkspaceTour role={role} variant="compact" />
        </Section>
      </div>
    </div>
  );
}
