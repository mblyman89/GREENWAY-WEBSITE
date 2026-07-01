/**
 * src/app/admin/reports/loyalty/page.tsx — Slice 29, enriched in Slice 51
 *
 * Loyalty & discount report. Slice 51 adds the professional program-economics
 * layer on top of the original enrollment/points view:
 *   • Outstanding-points LIABILITY (points valued at cash) + breakage.
 *   • Redemption rate (points redeemed ÷ earned) + avg earn basis.
 *   • Points composition by ledger kind (organic earn vs bonuses vs adjust).
 *   • Tier distribution (members + outstanding points per tier).
 *   • Discount-code funnel (issued → redeemed → outstanding → expired) with
 *     redemption rate, avg days-to-redeem, and code liability.
 *   • Enrollment trend + daily earn/redeem, and CSV/XLSX export.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { BarList, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { ExportButtons } from "@/components/admin/reports/ExportButtons";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { resolveRange } from "@/lib/reports/range";
import { getLoyaltyReport } from "@/lib/reports/operations";

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
          {subtitle ? <p className="mt-0.5 text-xs text-white/45">{subtitle}</p> : null}
        </div>
        {exportHref ? <ExportButtons baseHref={exportHref} /> : null}
      </div>
      {children}
    </section>
  );
}

type TierDisplayRow = Record<string, unknown>;
type CodeDisplayRow = Record<string, unknown>;

const TIER_COLUMNS: ReportColumn<TierDisplayRow>[] = [
  { key: "name", header: "Tier", align: "left" },
  { key: "discountLabel", header: "Standing discount", align: "right" },
  { key: "members", header: "Members", align: "right" },
  { key: "outstandingPoints", header: "Outstanding pts", align: "right" },
  { key: "lifetimePoints", header: "Lifetime pts", align: "right" },
];

const CODE_COLUMNS: ReportColumn<CodeDisplayRow>[] = [
  { key: "label", header: "Stage", align: "left" },
  { key: "count", header: "Codes", align: "right" },
  { key: "valueLabel", header: "Cash value", align: "right" },
];

export default async function LoyaltyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string; year?: string }>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const range = resolveRange(sp);

  if (!isSupabaseServiceConfigured) {
    return <p className="text-sm text-white/50">Connect Supabase to view the loyalty report.</p>;
  }

  const r = await getLoyaltyReport(range.fromISO, range.toISO);
  const qs = `from=${range.fromISO.slice(0, 10)}&to=${range.toISO.slice(0, 10)}`;

  const tierRows: TierDisplayRow[] = r.tiers.map((t) => ({
    name: t.name,
    discountLabel: t.discountBps > 0 ? `${(t.discountBps / 100).toFixed(0)}%` : "—",
    members: t.members.toLocaleString("en-US"),
    outstandingPoints: t.outstandingPoints.toLocaleString("en-US"),
    lifetimePoints: t.lifetimePoints.toLocaleString("en-US"),
  }));

  const codeRows: CodeDisplayRow[] = r.codeFunnel.map((c) => ({
    label: c.label,
    count: c.count.toLocaleString("en-US"),
    valueLabel: formatMinorCurrency(c.valueMinor),
  }));

  return (
    <div className="space-y-5">
      <DateRangePicker />

      {/* Membership + points headline */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Enrolled members"
          value={r.enrolledAccounts.toLocaleString("en-US")}
          hint={`${r.activeAccounts.toLocaleString("en-US")} active · +${r.newEnrollments.toLocaleString("en-US")} new`}
          accent="green"
        />
        <StatCard label="Points earned" value={r.pointsEarned.toLocaleString("en-US")} hint={range.label} accent="gold" />
        <StatCard
          label="Points redeemed"
          value={r.pointsRedeemed.toLocaleString("en-US")}
          hint={`${pct(r.redemptionRate)} redemption rate`}
          accent="orange"
        />
        <StatCard
          label="Points outstanding"
          value={r.pointsOutstanding.toLocaleString("en-US")}
          accent="muted"
        />
      </div>

      {/* Program economics — the professional layer */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Points liability"
          value={formatMinorCurrency(r.liabilityMinor)}
          hint="Outstanding points valued at cash"
          accent="orange"
        />
        <StatCard
          label="Redeemed value"
          value={formatMinorCurrency(r.redeemedValueMinor)}
          hint="Cash value of points redeemed"
          accent="green"
        />
        <StatCard
          label="Breakage"
          value={formatMinorCurrency(r.breakageMinor)}
          hint={`${r.breakagePoints.toLocaleString("en-US")} points expired`}
          accent="muted"
        />
        <StatCard
          label="Avg earn basis"
          value={formatMinorCurrency(r.avgEarnBasisMinor)}
          hint="Avg pretax spend per earn event"
          accent="muted"
        />
      </div>

      {/* Discount code economics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Codes issued" value={r.codesIssued.toLocaleString("en-US")} accent="muted" />
        <StatCard
          label="Codes redeemed"
          value={r.codesRedeemed.toLocaleString("en-US")}
          hint={`${pct(r.codeRedemptionRate)} redemption rate`}
          accent="green"
        />
        <StatCard
          label="Discount value (redeemed)"
          value={formatMinorCurrency(r.discountValueMinor)}
          hint={`Avg ${r.avgDaysToRedeem} days to redeem`}
          accent="gold"
        />
        <StatCard
          label="Outstanding code value"
          value={formatMinorCurrency(r.outstandingCodeValueMinor)}
          hint={`${r.codesOutstanding.toLocaleString("en-US")} codes live`}
          accent="orange"
        />
      </div>

      {/* Points composition + tier distribution */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Points by source" subtitle="How points enter and leave the program.">
          <BarList
            data={r.pointsByKind.map((k) => ({ label: k.label, value: k.points }))}
            color={REPORT_COLORS.GREEN}
            emptyLabel="No point activity in this window."
          />
        </Section>
        <Section title="Members by tier" subtitle="Standing-discount distribution.">
          <BarList
            data={r.tiers.map((t) => ({ label: t.name, value: t.members }))}
            color={REPORT_COLORS.GOLD}
            emptyLabel="No tiers configured."
          />
        </Section>
      </div>

      {/* Tier detail table */}
      <Section title="Tier detail" exportHref={`/admin/reports/loyalty/export?${qs}`}>
        <ReportTable columns={TIER_COLUMNS} rows={tierRows} emptyLabel="No tiers configured." />
      </Section>

      {/* Discount code funnel */}
      <Section title="Discount code funnel" subtitle="Issued → redeemed → outstanding, with cash value at each stage.">
        <ReportTable columns={CODE_COLUMNS} rows={codeRows} emptyLabel="No codes issued in this window." />
      </Section>

      {/* Trends */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Daily points earned">
          <BarList
            data={r.dailyEarn.map((d) => ({ label: d.date, value: d.points }))}
            color={REPORT_COLORS.GREEN}
            emptyLabel="No points earned in this window."
          />
        </Section>
        <Section title="Daily points redeemed">
          <BarList
            data={r.dailyRedeem.map((d) => ({ label: d.date, value: d.points }))}
            color={REPORT_COLORS.ORANGE}
            emptyLabel="No points redeemed in this window."
          />
        </Section>
      </div>

      <Section title="Enrollment trend" subtitle="New loyalty members per Pacific day.">
        <BarList
          data={r.enrollmentTrend.map((d) => ({ label: d.date, value: d.count }))}
          color={REPORT_COLORS.GOLD}
          emptyLabel="No new members in this window."
        />
      </Section>

      <Section title="Top earners">
        <BarList
          data={r.topEarners.map((d) => ({ label: d.label, value: d.points }))}
          color={REPORT_COLORS.GOLD}
          emptyLabel="No earners yet."
        />
      </Section>
    </div>
  );
}
