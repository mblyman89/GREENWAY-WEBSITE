/**
 * src/app/admin/reports/medical/page.tsx — Slice 53 (enriched)
 *
 * Medical report: store endorsement / excise-exemption compliance status, the
 * patient-authorization pipeline (status + 30/60/90-day expiry buckets), and the
 * WAC 314-55-090 excise-exempt sale activity (unique patients, exempt value,
 * sales-tax + 37% excise exempted, product mix, and a card-validity compliance
 * audit). Pacific days. Money in minor units. CSV/XLSX export.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { BarList, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { ExportButtons } from "@/components/admin/reports/ExportButtons";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { resolveRange } from "@/lib/reports/range";
import { getMedicalReport } from "@/lib/reports/operations";

export const dynamic = "force-dynamic";

type ProductRow = Record<string, unknown>;
type IssueRow = Record<string, unknown>;

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
  const exportHref = `/admin/reports/medical/export?from=${range.fromDate}&to=${range.toDate}`;

  // Endorsement / exemption status framing
  const exemptionSoon = r.daysUntilExemptionEnds !== null && r.daysUntilExemptionEnds <= 365;
  const exemptionAccent = !r.exemptionUntil ? "muted" : exemptionSoon ? "orange" : "green";

  const productColumns: ReportColumn<ProductRow>[] = [
    { key: "name", header: "Product" },
    { key: "sku", header: "SKU" },
    { key: "units", header: "Units", align: "right" },
    { key: "salesMinor", header: "Exempt sales", align: "right", emphasis: true },
    { key: "exciseExemptMinor", header: "Excise exempted", align: "right" },
  ];
  const productRows: ProductRow[] = r.topExemptProducts.map((p) => ({
    name: p.name,
    sku: p.sku,
    units: p.units.toLocaleString("en-US"),
    salesMinor: formatMinorCurrency(p.salesMinor),
    exciseExemptMinor: formatMinorCurrency(p.exciseExemptMinor),
  }));

  const issueColumns: ReportColumn<IssueRow>[] = [
    { key: "saleDate", header: "Sale date" },
    { key: "upid", header: "UPID" },
    { key: "productName", header: "Product" },
    { key: "cardExpiresOn", header: "Card expired on" },
    { key: "salesPriceMinor", header: "Sale price", align: "right", emphasis: true },
  ];
  const issueRows: IssueRow[] = r.cardValidityIssues.map((i) => ({
    saleDate: i.saleDate,
    upid: i.upid,
    productName: i.productName,
    cardExpiresOn: i.cardExpiresOn ?? "—",
    salesPriceMinor: formatMinorCurrency(i.salesPriceMinor),
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <DateRangePicker />
        <ExportButtons baseHref={exportHref} />
      </div>

      {/* Compliance / endorsement status band */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Medical endorsement"
          value={r.isEndorsed ? "Endorsed" : "Not endorsed"}
          hint={r.endorsementNumber ? `No. ${r.endorsementNumber}` : "RCW 69.50.375"}
          accent={r.isEndorsed ? "green" : "orange"}
        />
        <StatCard
          label="Excise exemption ends"
          value={r.exemptionUntil ?? "—"}
          hint={
            r.daysUntilExemptionEnds !== null
              ? `${r.daysUntilExemptionEnds.toLocaleString("en-US")} days left (WAC 314-55-090(6))`
              : "Not configured"
          }
          accent={exemptionAccent}
        />
        <StatCard
          label="Cards in DOH database"
          value={r.inDohDatabase.toLocaleString("en-US")}
          hint={`of ${r.activeCards.toLocaleString("en-US")} active`}
          accent="muted"
        />
      </div>

      {/* Patient / card headline */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Medical patients" value={r.patients.toLocaleString("en-US")} accent="gold" />
        <StatCard label="Active cards" value={r.activeCards.toLocaleString("en-US")} accent="green" />
        <StatCard
          label="Expiring ≤ 30 days"
          value={r.expiringSoon.toLocaleString("en-US")}
          accent={r.expiringSoon > 0 ? "orange" : "muted"}
        />
        <StatCard
          label="Unique patients served"
          value={r.uniquePatients.toLocaleString("en-US")}
          hint={range.label}
          accent="muted"
        />
      </div>

      {/* Exempt-sale value band */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Exempt sales" value={r.exemptSales.toLocaleString("en-US")} hint="line items" accent="muted" />
        <StatCard
          label="Exempt sales value"
          value={formatMinorCurrency(r.exemptSalesMinor)}
          hint={`avg basket ${formatMinorCurrency(r.avgExemptBasketMinor)}`}
          accent="gold"
        />
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

      {/* Authorization pipeline */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Cards by status" subtitle="Every authorization on file">
          <BarList
            data={r.authByStatus.map((s) => ({ label: s.label, value: s.count }))}
            valueFormatter={(v) => v.toLocaleString("en-US")}
            color={REPORT_COLORS.GREEN}
            emptyLabel="No authorizations on file."
          />
        </Section>
        <Section title="Active-card expiry outlook" subtitle="Renewal pipeline for active cards">
          <BarList
            data={r.expiryBuckets.map((b) => ({ label: b.label, value: b.count }))}
            valueFormatter={(v) => v.toLocaleString("en-US")}
            color={REPORT_COLORS.ORANGE}
            emptyLabel="No active cards."
          />
        </Section>
      </div>

      {/* Card-validity compliance audit */}
      <Section
        title="Card-validity audit"
        subtitle="Excise-exempt sales where the recognition card had expired on the sale date — review these for WAC 314-55-090 compliance"
      >
        {issueRows.length === 0 ? (
          <div className="rounded-xl border border-[#7ed957]/20 bg-[#7ed957]/[0.04] p-6 text-center text-sm text-[#9be870]">
            ✓ No expired-card exempt sales in this window.
          </div>
        ) : (
          <ReportTable columns={issueColumns} rows={issueRows} />
        )}
      </Section>

      {/* Top exempt products */}
      <Section title="Top exempt products" subtitle="Highest exempt-sales value in this window">
        <ReportTable
          columns={productColumns}
          rows={productRows}
          emptyLabel="No excise-exempt sales in this window."
        />
      </Section>

      {/* Daily excise trend */}
      <Section title="Daily excise exempted" subtitle="37% excise not collected per day">
        <BarList
          data={r.dailyExcise.map((d) => ({ label: d.date, value: d.minor }))}
          valueFormatter={(v) => formatMinorCurrency(v)}
          color={REPORT_COLORS.GOLD}
          emptyLabel="No excise-exempt sales in this window."
        />
      </Section>

      <p className="text-xs text-white/40">
        Records retained five years per WAC 314-55-090(2). Full per-sale records (UPID, card dates, SKU, price)
        are on the Medical page. Sales-tax figures are estimated at 9.3% of exempt sales; excise exemptions use the
        recorded exempt amount.
      </p>
    </div>
  );
}
