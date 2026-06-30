/**
 * src/app/admin/reports/accounting/page.tsx  (Run 4 / Slice 18)
 *
 * The "Accounting (Sage 50)" tab. Builds a daily General Journal CSV for Sage
 * 50 Quantum import, with an editable chart-of-accounts mapping and a
 * human-readable journal preview.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { AccountingSettingsForm } from "@/components/admin/reports/AccountingSettingsForm";
import { resolveRange } from "@/lib/reports/range";
import { buildSage50Journal, getAccountingSettings, type DayJournalSummary } from "@/lib/accounting/sage50";

export const dynamic = "force-dynamic";

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

const summaryColumns: ReportColumn<DayJournalSummary & Record<string, unknown>>[] = [
  { key: "date", header: "Date", emphasis: true },
  { key: "cannabisSalesMinor", header: "Cannabis", align: "right", render: (r) => formatMinorCurrency(r.cannabisSalesMinor) },
  { key: "nonCannabisSalesMinor", header: "Other", align: "right", render: (r) => formatMinorCurrency(r.nonCannabisSalesMinor) },
  { key: "salesTaxMinor", header: "Sales tax", align: "right", render: (r) => formatMinorCurrency(r.salesTaxMinor) },
  { key: "exciseMinor", header: "Excise", align: "right", render: (r) => formatMinorCurrency(r.exciseMinor) },
  { key: "cogsMinor", header: "COGS", align: "right", render: (r) => formatMinorCurrency(r.cogsMinor) },
  { key: "cashCollectedMinor", header: "Cash deposit", align: "right", emphasis: true, render: (r) => formatMinorCurrency(r.cashCollectedMinor) },
];

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string; year?: string }>;
}) {
  const session = await requirePermission("reports.view");
  const canEdit = can(session.profile.role, "settings.manage");
  const sp = await searchParams;
  const range = resolveRange(sp);
  const qs = `from=${range.fromISO.slice(0, 10)}&to=${range.toISO.slice(0, 10)}`;

  const settings = await getAccountingSettings();
  const built = isSupabaseServiceConfigured ? await buildSage50Journal(range.fromISO, range.toISO) : null;

  const totals = (built?.summaries ?? []).reduce(
    (acc, s) => {
      acc.cannabis += s.cannabisSalesMinor;
      acc.other += s.nonCannabisSalesMinor;
      acc.salesTax += s.salesTaxMinor;
      acc.excise += s.exciseMinor;
      acc.cogs += s.cogsMinor;
      acc.cash += s.cashCollectedMinor;
      return acc;
    },
    { cannabis: 0, other: 0, salesTax: 0, excise: 0, cogs: 0, cash: 0 },
  );

  return (
    <div className="space-y-5">
      <DateRangePicker />

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-3 text-xs leading-relaxed text-white/50">
        Sage 50 Quantum imports a General Journal CSV (File ▸ Select Import/Export). This builds one balanced daily
        entry per business day — debit cash/card clearing &amp; COGS, credit sales (by cannabis/non-cannabis), sales tax
        payable, excise payable, and inventory. Map your GL account ids below to match your Sage 50 chart of accounts,
        then download and import. Always review the figures first.
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Journal days" value={(built?.days ?? 0).toLocaleString()} accent="green" />
        <StatCard label="GL lines" value={(built?.lineCount ?? 0).toLocaleString()} accent="muted" />
        <StatCard label="Cash deposits" value={formatMinorCurrency(totals.cash)} accent="gold" />
        <StatCard label="COGS" value={formatMinorCurrency(totals.cogs)} accent="orange" />
      </div>

      {/* Warnings */}
      {built && built.warnings.length > 0 ? (
        <div className="rounded-2xl border border-orange-500/30 bg-orange-500/[0.06] p-4">
          <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-orange-300">Before importing</p>
          <ul className="space-y-1 text-xs text-orange-100/80">
            {built.warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Download */}
      <Section title="Download Sage 50 General Journal" subtitle="One balanced entry per business day for the range.">
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/admin/reports/accounting/export?${qs}`}
              prefetch={false}
              className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90"
            >
              ⬇ Download Sage50_GeneralJournal.csv
            </Link>
            <span className="text-xs text-white/40">Import via File ▸ Select Import/Export ▸ General Journal.</span>
          </div>
        ) : (
          <p className="text-xs text-white/40">Generating the journal requires the “Change settings” permission.</p>
        )}
      </Section>

      {/* GL mapping */}
      <Section title="Sage 50 chart-of-accounts mapping" subtitle="Match each bucket to your Sage 50 GL account id.">
        <AccountingSettingsForm settings={settings} canEdit={canEdit} />
      </Section>

      {/* Journal preview */}
      <Section title="Daily journal preview" subtitle="What will be posted (summarized).">
        <ReportTable
          columns={summaryColumns}
          rows={(built?.summaries ?? []) as (DayJournalSummary & Record<string, unknown>)[]}
          totals={{
            date: "Total",
            cannabisSalesMinor: formatMinorCurrency(totals.cannabis),
            nonCannabisSalesMinor: formatMinorCurrency(totals.other),
            salesTaxMinor: formatMinorCurrency(totals.salesTax),
            exciseMinor: formatMinorCurrency(totals.excise),
            cogsMinor: formatMinorCurrency(totals.cogs),
            cashCollectedMinor: formatMinorCurrency(totals.cash),
          }}
          emptyLabel="No completed orders in range."
        />
      </Section>
    </div>
  );
}
