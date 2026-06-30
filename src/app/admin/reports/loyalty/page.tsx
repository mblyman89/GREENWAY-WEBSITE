/**
 * src/app/admin/reports/loyalty/page.tsx — Slice 29
 *
 * Loyalty & discount report: enrollment, points earned/redeemed/outstanding,
 * code redemption discount value, daily earn trend, and top earners.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { BarList, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { resolveRange } from "@/lib/reports/range";
import { getLoyaltyReport } from "@/lib/reports/operations";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>
      {children}
    </section>
  );
}

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

  return (
    <div className="space-y-5">
      <DateRangePicker />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Enrolled members" value={r.enrolledAccounts.toLocaleString("en-US")} accent="green" />
        <StatCard label="Points earned" value={r.pointsEarned.toLocaleString("en-US")} hint={range.label} accent="gold" />
        <StatCard label="Points redeemed" value={r.pointsRedeemed.toLocaleString("en-US")} accent="orange" />
        <StatCard
          label="Points outstanding"
          value={r.pointsOutstanding.toLocaleString("en-US")}
          accent="muted"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Codes issued" value={r.codesIssued.toLocaleString("en-US")} accent="muted" />
        <StatCard label="Codes redeemed" value={r.codesRedeemed.toLocaleString("en-US")} accent="green" />
        <StatCard
          label="Discount value (redeemed)"
          value={formatMinorCurrency(r.discountValueMinor)}
          accent="gold"
        />
      </div>

      <Section title="Daily points earned">
        <BarList
          data={r.dailyEarn.map((d) => ({ label: d.date, value: d.points }))}
          color={REPORT_COLORS.GREEN}
          emptyLabel="No points earned in this window."
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
