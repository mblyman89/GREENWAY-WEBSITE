/**
 * src/app/admin/reports/excise/page.tsx  (Run 6 / Slice 32)
 *
 * The "Excise Tax (LIQ-1295)" tab. Pick a reporting month, preview the computed
 * boxes, and download the filled LIQ-1295 .xlsx to email to cannabistaxes@lcb.wa.gov.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { computeExciseReturnForMonth, listExciseReturnBatches } from "@/lib/compliance/excise-return";

export const dynamic = "force-dynamic";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs text-white/40">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function fmt(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function ExcisePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const session = await requirePermission("reports.view");
  const canEdit = can(session.profile.role, "settings.manage");
  const sp = await searchParams;

  // Default to the previous month (the one you'd be filing for).
  const now = new Date();
  const defMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth(); // prev month (1-12)
  const defYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const month = Number(sp.month) >= 1 && Number(sp.month) <= 12 ? Number(sp.month) : defMonth;
  const year = Number(sp.year) >= 2014 ? Number(sp.year) : defYear;

  const data = isSupabaseServiceConfigured ? await computeExciseReturnForMonth(month, year) : null;
  const batches = await listExciseReturnBatches(12);

  const years = [defYear + 1, defYear, defYear - 1, defYear - 2];
  const qs = `month=${month}&year=${year}`;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-3 text-xs leading-relaxed text-white/50">
        The <span className="font-bold text-white/80">LIQ-1295</span> is WSLCB&apos;s monthly Cannabis Retailer Sales &amp;
        Excise Tax return. It&apos;s required every month (even with no sales) and is due by the{" "}
        <span className="font-bold text-white/80">20th</span> of the following month. This tool fills the official Excel
        form from your completed sales — 37% excise on taxable cannabis, less qualifying medical-exempt sales. Email the
        file to <code className="text-white/70">cannabistaxes@lcb.wa.gov</code> and pay via CCRS ACH. Always review the
        figures before filing.
      </div>

      {/* Period picker */}
      <Section title="Reporting period">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-white/60">
            Month
            <select
              name="month"
              defaultValue={month}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white"
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/60">
            Year
            <select
              name="year"
              defaultValue={year}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-bold text-white/80 hover:bg-white/[0.08]"
          >
            Preview
          </button>
        </form>
        {data ? (
          <p className="mt-3 text-xs text-white/40">
            Due date for {MONTHS[month - 1]} {year}: <span className="font-bold text-white/70">{data.dueDate}</span> ·{" "}
            {data.orderCount} completed orders · {data.exemptRecordCount} exempt medical sales aggregated.
          </p>
        ) : null}
      </Section>

      {/* Box preview */}
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Box 1 · Cannabis sales" value={fmt(data.boxes.box1_cannabisSales)} accent="green" />
            <StatCard label="Box 2 · Less medical" value={fmt(data.boxes.box2_lessMedical)} accent="gold" />
            <StatCard label="Box 3 · Taxable" value={fmt(data.boxes.box3_taxable)} accent="muted" />
            <StatCard label="Box 5 · Excise (37%)" value={fmt(data.boxes.box5_calculatedExcise)} accent="orange" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Box 6 · Additional excise" value={fmt(data.boxes.box6_additionalExcise)} accent="muted" />
            <StatCard label="Box 7 · Subtotal excise" value={fmt(data.boxes.box7_subtotalExcise)} accent="muted" />
            <StatCard label="Box 9 · Approved credits" value={fmt(data.boxes.box9_approvedCredits)} accent="muted" />
            <StatCard label="Box 10 · Amount to pay" value={fmt(data.boxes.box10_amountToPay)} accent="green" />
          </div>

          {data.warnings.length > 0 ? (
            <div className="rounded-2xl border border-orange-500/30 bg-orange-500/[0.06] p-4">
              <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-orange-300">Review before filing</p>
              <ul className="space-y-1 text-xs text-orange-100/80">
                {data.warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-sm text-white/50">
          Connect Supabase to compute the return from live sales.
        </div>
      )}

      {/* Generate */}
      <Section title="Generate the LIQ-1295" subtitle="Downloads the official Excel form, pre-filled and ready to email to the LCB.">
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/admin/reports/compliance/excise-export?${qs}`}
              prefetch={false}
              className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90"
            >
              ⬇ Download filled LIQ-1295 (.xlsx)
            </Link>
            <span className="text-xs text-white/40">
              Add additional over-collected excise, penalties, or approved credits by editing boxes 6/8/9 in the
              downloaded sheet, or pass <code className="text-white/60">&amp;extra=</code> /{" "}
              <code className="text-white/60">&amp;penalty=</code> / <code className="text-white/60">&amp;credits=</code>.
            </span>
          </div>
        ) : (
          <p className="text-xs text-white/40">Generating the regulatory file requires the “Change settings” permission.</p>
        )}
      </Section>

      {/* Recent returns */}
      {batches.length > 0 ? (
        <Section title="Recent excise returns">
          <ul className="divide-y divide-white/5 text-sm">
            {batches.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                <span className="font-mono text-xs text-white/70">{b.file_name}</span>
                <span className="text-xs text-white/40">
                  {MONTHS[b.report_month - 1]} {b.report_year} · pay {fmt(Number(b.amount_to_pay))}
                  {b.no_sales ? " · no sales" : ""} · {new Date(b.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
