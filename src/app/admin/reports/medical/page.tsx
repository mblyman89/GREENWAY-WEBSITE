/**
 * src/app/admin/reports/medical/page.tsx — Slice 29
 *
 * Medical report: patient/card counts, cards expiring soon, and the tax
 * exempted (sales + 37% excise) per WAC 314-55-090. Pacific days.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { BarList, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { resolveRange } from "@/lib/reports/range";
import { getMedicalReport } from "@/lib/reports/operations";

export const dynamic = "force-dynamic";

export default async function MedicalReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string; year?: string }>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const range = resolveRange(sp);

  if (!isSupabaseServiceConfigured) {
    return <p className="text-sm text-white/50">Connect Supabase to view the medical report.</p>;
  }

  const r = await getMedicalReport(range.fromDate, range.toDate);

  return (
    <div className="space-y-5">
      <DateRangePicker />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Medical patients" value={r.patients.toLocaleString("en-US")} accent="gold" />
        <StatCard label="Active cards" value={r.activeCards.toLocaleString("en-US")} accent="green" />
        <StatCard
          label="Expiring ≤ 30 days"
          value={r.expiringSoon.toLocaleString("en-US")}
          accent={r.expiringSoon > 0 ? "orange" : "muted"}
        />
        <StatCard label="Exempt sales" value={r.exemptSales.toLocaleString("en-US")} hint={range.label} accent="muted" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Sales tax exempted (est.)"
          value={formatMinorCurrency(r.salesTaxExemptedMinor)}
          hint="9.3% on exempt sales"
          accent="green"
        />
        <StatCard
          label="Excise exempted (37%)"
          value={formatMinorCurrency(r.exciseExemptedMinor)}
          hint="DOH-compliant product"
          accent="gold"
        />
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-white/80">
          Daily excise exempted
        </h2>
        <BarList
          data={r.dailyExcise.map((d) => ({ label: d.date, value: d.minor }))}
          valueFormatter={(v) => formatMinorCurrency(v)}
          color={REPORT_COLORS.GOLD}
          emptyLabel="No excise-exempt sales in this window."
        />
      </section>

      <p className="text-xs text-white/40">
        Records retained five years per WAC 314-55-090(2). Full per-sale records (UPID, card dates, SKU, price)
        are on the Medical page.
      </p>
    </div>
  );
}
