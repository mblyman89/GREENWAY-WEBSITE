/**
 * src/app/admin/reports/expiration/page.tsx  (R34)
 *
 * The "Expiration" report tab. Every number comes from ONE pure function,
 * buildExpiryReport (src/lib/inventory/expiry-rules-core.ts), over the same
 * lot read the Expiration rules page uses - so the report, the rules page and
 * the export can never disagree.
 *
 *   - KPIs: on-hand lots, date coverage, value at risk (expired + 0-30 days),
 *     active rules.
 *   - Aging buckets (lots + value), 12-month expiry forecast.
 *   - Where dates come from (manifest / COA / POS / owner / rule / none).
 *   - By category (labels follow Settings -> Types renames), coverage gaps.
 *   - Rule usage (how many lots each rule dated, at-risk counts).
 *   - 90-day watchlist with lot links.
 *
 * Fail-closed: if every lot can't be read, the page says so instead of
 * showing partial numbers (loadExpiryLots uses pagedAllChecked).
 * Money: integer minor units throughout, formatted only at render.
 */
import Link from "next/link";
import { ExportButtons } from "@/components/admin/reports/ExportButtons";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { BarList, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { pacificToday } from "@/lib/reports/timezone";
import { buildExpiryReport, monthLabel, type ExpiryReport } from "@/lib/inventory/expiry-rules-core";
import { listExpiryRules, loadExpiryLots } from "@/lib/inventory/expiry-rules-store";

export const dynamic = "force-dynamic";

const EXPIRATION_EXPORT_HREF = "/admin/reports/expiration/export";
const RULES_HREF = "/admin/inventory/expiration-rules";

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

function daysText(d: number): string {
  if (d < 0) return `${Math.abs(d)} day${d === -1 ? "" : "s"} ago`;
  if (d === 0) return "today";
  return `in ${d} day${d === 1 ? "" : "s"}`;
}

type WatchRowT = ExpiryReport["watch"][number] & Record<string, unknown>;
type RuleRowT = ExpiryReport["rules"][number] & Record<string, unknown>;
type CatRowT = ExpiryReport["stats"]["byCategory"][number] & { label: string } & Record<string, unknown>;
type GapRowT = ExpiryReport["gaps"][number] & Record<string, unknown>;

const watchColumns: ReportColumn<WatchRowT>[] = [
  {
    key: "lotCode",
    header: "Lot",
    emphasis: true,
    render: (r) => (
      <Link href={`/admin/inventory/${r.id}`} className="underline hover:text-white">
        {r.lotCode || r.id.slice(0, 8)}
      </Link>
    ),
  },
  { key: "productName", header: "Product", render: (r) => r.productName || "-" },
  { key: "categoryLabel", header: "Category" },
  { key: "expiresOn", header: "Date", render: (r) => r.expiresOn },
  {
    key: "days",
    header: "When",
    render: (r) => <span className={r.tone === "expired" ? "font-bold text-[#ff8a65]" : r.tone === "soon" ? "text-[#f5c451]" : ""}>{daysText(r.days)}</span>,
  },
  { key: "sourceLabel", header: "Date source" },
  { key: "onHand", header: "On hand", align: "right", render: (r) => r.onHand.toLocaleString() },
  {
    key: "valueMinor",
    header: "Value at cost",
    align: "right",
    emphasis: true,
    render: (r) => (r.costKnown ? formatMinorCurrency(r.valueMinor) : "No cost"),
  },
];

const ruleColumns: ReportColumn<RuleRowT>[] = [
  { key: "label", header: "Rule", emphasis: true, render: (r) => (r.enabled || r.scope === "deleted" ? r.label : `${r.label} (off)`) },
  { key: "describe", header: "What it does" },
  { key: "lots", header: "Lots dated", align: "right", render: (r) => r.lots.toLocaleString() },
  { key: "onHandLots", header: "On hand", align: "right", render: (r) => r.onHandLots.toLocaleString() },
  { key: "expired", header: "Expired", align: "right", render: (r) => r.expired.toLocaleString() },
  { key: "soon", header: "0-30 days", align: "right", render: (r) => r.soon.toLocaleString() },
  { key: "valueMinor", header: "On-hand value", align: "right", emphasis: true, render: (r) => formatMinorCurrency(r.valueMinor) },
];

const catColumns: ReportColumn<CatRowT>[] = [
  { key: "label", header: "Category", emphasis: true },
  { key: "lots", header: "On-hand lots", align: "right", render: (r) => r.lots.toLocaleString() },
  {
    key: "dated",
    header: "Dated",
    align: "right",
    render: (r) => `${r.dated.toLocaleString()} (${r.lots ? Math.round((r.dated / r.lots) * 100) : 0}%)`,
  },
  { key: "expired", header: "Expired", align: "right", render: (r) => r.expired.toLocaleString() },
  { key: "soon", header: "0-30 days", align: "right", render: (r) => r.soon.toLocaleString() },
  { key: "valueAtRiskMinor", header: "Value at risk", align: "right", emphasis: true, render: (r) => formatMinorCurrency(r.valueAtRiskMinor) },
];

const gapColumns: ReportColumn<GapRowT>[] = [
  { key: "label", header: "Category", emphasis: true },
  { key: "undated", header: "Undated on-hand lots", align: "right", render: (r) => r.undated.toLocaleString() },
  { key: "onHandLots", header: "Of on-hand lots", align: "right", render: (r) => r.onHandLots.toLocaleString() },
  {
    key: "hasCategoryRule",
    header: "Next step",
    render: (r) =>
      r.category === "unmapped" ? (
        <span className="text-white/50">File these under a category first (Settings &rarr; Types)</span>
      ) : r.hasCategoryRule ? (
        <Link href={`${RULES_HREF}?preview=1`} className="underline hover:text-white">
          Rule exists - preview &amp; apply
        </Link>
      ) : (
        <Link href={`${RULES_HREF}?suggest=category:${encodeURIComponent(r.category)}`} className="underline hover:text-white">
          Set a rule
        </Link>
      ),
  },
];

export default async function ExpirationReportPage() {
  await requirePermission("reports.view");

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/50">
        Supabase isn&rsquo;t configured in this environment, so expiration data is unavailable.
      </div>
    );
  }

  const today = pacificToday();
  const [lotsRead, rulesRead] = await Promise.all([loadExpiryLots(), listExpiryRules()]);
  if (!lotsRead.ok) {
    return (
      <div className="rounded-2xl border border-[#ff8a65]/30 bg-white/[0.02] p-6 text-sm text-white/70" data-testid="expiry-report-unavailable">
        <p className="font-bold text-white">Expiration report unavailable</p>
        <p className="mt-1">{lotsRead.error}</p>
        <p className="mt-1 text-white/40">No partial numbers are shown - a report on part of the inventory would be misleading.</p>
      </div>
    );
  }
  const rules = rulesRead.ok ? rulesRead.rules : [];
  const report = buildExpiryReport(lotsRead.lots, rules, today);
  const { stats } = report;
  const risk = stats.buckets.filter((b) => b.key === "expired" || b.key === "d0_30");
  const uncostedAtRisk = risk.reduce((n, b) => n + b.uncostedLots, 0);
  const ruleDated = stats.bySource.find((s) => s.key === "rule")?.lots ?? 0;
  const catRows: CatRowT[] = stats.byCategory.map((c) => ({ ...c, label: report.categoryLabels[c.category] ?? c.category }));
  const forecastTotal = report.forecast.reduce((n, m) => n + m.valueMinor, 0);

  return (
    <div className="space-y-5" data-testid="expiry-report">
      {!rulesRead.ok ? (
        <div className="rounded-2xl border border-[#f5c451]/30 bg-white/[0.02] p-4 text-sm text-white/70">
          Rules could not be read ({rulesRead.error}). Lot dates below are complete; rule names are not.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-white/40">
          On-hand stock as of {today} (Pacific). Value is on-hand quantity &times; unit cost.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={RULES_HREF}
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-bold text-white/70 transition hover:border-white/25 hover:text-white"
          >
            Expiration rules &rarr;
          </Link>
          <ExportButtons baseHref={`${EXPIRATION_EXPORT_HREF}?sheet=all`} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="On-hand lots" value={stats.onHandLots.toLocaleString()} accent="muted" />
        <StatCard
          label="Have a date"
          value={`${stats.coveragePct}%`}
          hint={`${stats.dated.toLocaleString()} dated \u00b7 ${(stats.onHandLots - stats.dated).toLocaleString()} without`}
          accent={stats.coveragePct >= 90 ? "green" : stats.coveragePct >= 50 ? "gold" : "orange"}
          href={stats.onHandLots - stats.dated > 0 ? RULES_HREF : undefined}
        />
        <StatCard
          label="Value at risk"
          value={formatMinorCurrency(stats.valueAtRiskMinor)}
          hint={`Expired + next 30 days${uncostedAtRisk ? ` \u00b7 ${uncostedAtRisk} lots have no cost` : ""}`}
          accent={stats.valueAtRiskMinor > 0 ? "orange" : "green"}
        />
        <StatCard
          label="Active rules"
          value={report.rulesActive.toLocaleString()}
          hint={`${ruleDated.toLocaleString()} on-hand lots dated by a rule`}
          accent="gold"
          href={RULES_HREF}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Aging - lots" subtitle="On-hand lots by how soon they expire." exportHref={`${EXPIRATION_EXPORT_HREF}?sheet=buckets`}>
          <BarList
            data={stats.buckets.map((b) => ({ label: b.label, value: b.lots }))}
            valueFormatter={(v) => `${v.toLocaleString()} lots`}
            color={REPORT_COLORS.GOLD}
            emptyLabel="No on-hand lots."
          />
        </Section>
        <Section title="Aging - value" subtitle="On-hand value at cost by bucket (uncosted lots count as $0).">
          <BarList
            data={stats.buckets.map((b) => ({ label: b.label, value: b.valueMinor }))}
            valueFormatter={(v) => formatMinorCurrency(v)}
            color={REPORT_COLORS.ORANGE}
            emptyLabel="No on-hand lots."
          />
        </Section>
      </div>

      <Section
        title="12-month forecast"
        subtitle={`On-hand value reaching its date each month (${formatMinorCurrency(forecastTotal)} total). Already-expired stock is in the Expired bucket, not here.`}
        exportHref={`${EXPIRATION_EXPORT_HREF}?sheet=forecast`}
      >
        <BarList
          data={report.forecast.map((m) => ({ label: `${monthLabel(m.month)} \u00b7 ${m.lots} lots`, value: m.valueMinor }))}
          valueFormatter={(v) => formatMinorCurrency(v)}
          color={REPORT_COLORS.GREEN}
        />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Where dates come from" subtitle="Document dates (manifest / COA / POS) are never changed by rules." exportHref={`${EXPIRATION_EXPORT_HREF}?sheet=sources`}>
          <BarList
            data={stats.bySource.map((s) => ({ label: s.label, value: s.lots }))}
            valueFormatter={(v) => `${v.toLocaleString()} lots`}
            color={REPORT_COLORS.GREEN}
            emptyLabel="No on-hand lots."
          />
        </Section>
        <Section title="Coverage gaps" subtitle="Categories with on-hand stock that has no date yet." exportHref={`${EXPIRATION_EXPORT_HREF}?sheet=gaps`}>
          <ReportTable columns={gapColumns} rows={report.gaps as GapRowT[]} emptyLabel="Every on-hand lot has a date." />
        </Section>
      </div>

      <Section title="By category" subtitle="Category names follow Settings → Types." exportHref={`${EXPIRATION_EXPORT_HREF}?sheet=categories`}>
        <ReportTable columns={catColumns} rows={catRows} emptyLabel="No on-hand lots." />
      </Section>

      <Section title="Rule usage" subtitle="Lots each rule has dated (destroyed lots excluded)." exportHref={`${EXPIRATION_EXPORT_HREF}?sheet=rules`}>
        <ReportTable columns={ruleColumns} rows={report.rules as RuleRowT[]} emptyLabel="No lot has been dated by a rule yet." />
      </Section>

      <Section
        title="Watchlist - next 90 days"
        subtitle="On-hand lots that are expired or expire within 90 days, soonest first. Pull, discount or return these."
        exportHref={`${EXPIRATION_EXPORT_HREF}?sheet=watchlist`}
      >
        <ReportTable columns={watchColumns} rows={report.watch as WatchRowT[]} emptyLabel="Nothing expires in the next 90 days." />
      </Section>
    </div>
  );
}
