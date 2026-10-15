/**
 * src/app/admin/reports/ach-payments/page.tsx — ACH Payments report.
 * R41 round 9. OWNER AND ADMIN ONLY.
 *
 * The reports layout lets reports.view in (that includes managers and
 * read-only logins), so this page checks "ach.request" itself (owner + admin,
 * src/lib/auth/roles.ts). The tab link is hidden for everyone else
 * (ReportTabs, ACH_REPORT_TAB) and the export route checks the same
 * permission.
 *
 * What it shows: who was paid, when and how much; the exact bank transactions
 * (Plaid feed of the Timberland Main account) each file or payment matched;
 * files still in process at Timberland, with deadlines; what is still owed
 * (aged); draft payroll; and the money that must be in the account by 9:00
 * a.m. on each settlement date (agreement section 14).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificToday } from "@/lib/reports/timezone";
import { StatCard } from "@/components/admin/StatCard";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { BarList, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { ExportButtons } from "@/components/admin/reports/ExportButtons";
import { TimberlandRoomLeft } from "@/components/admin/payments/TimberlandRoomLeft";
import { resolveRange } from "@/lib/reports/range";
import { loadAchReportInputs } from "@/lib/reports/ach-payments-report-store";
import {
  buildAchReport,
  usd,
  FILE_STAGE_LABEL,
  PAYMENT_STATUS_LABEL,
  type BankMatch,
  type FileRow,
  type OutstandingRow,
  type PayeeRow,
  type PaymentRow,
} from "@/lib/reports/ach-payments-report-core";

export const dynamic = "force-dynamic";

function Section({ title, subtitle, exportHref, id, children }: { title: string; subtitle?: string; exportHref?: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
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

const STAGE_TONE: Record<string, string> = {
  cleared: "text-[var(--admin-accent)]",
  off: "text-[var(--admin-gold)]",
  missing: "text-red-300",
  built: "text-white/70",
  uploaded: "text-white/70",
  approved: "text-sky-300",
  voided: "text-white/40",
  no_money: "text-white/40",
  processing: "text-sky-300",
  file_voided: "text-red-300",
  outside_bank: "text-white/50",
};

type Row<T> = T & Record<string, unknown>;

const fileCols: ReportColumn<Row<FileRow>>[] = [
  { key: "effectiveDate", header: "Effective", render: (r) => r.effectiveDate },
  { key: "kind", header: "Type", render: (r) => (r.kind === "micro_entry" ? "micro-entry" : r.kind) },
  { key: "filename", header: "File", emphasis: true, render: (r) => r.filename },
  { key: "entryCount", header: "Entries", align: "right", render: (r) => String(r.entryCount) },
  { key: "totalCents", header: "Amount", align: "right", render: (r) => usd(r.totalCents) },
  {
    key: "stage",
    header: "Where it is",
    render: (r) => (
      <span className={STAGE_TONE[r.stage]}>
        {FILE_STAGE_LABEL[r.stage]}
        {r.overdue ? " · deadline passed" : r.dueToday ? " · due today 4 pm" : ""}
      </span>
    ),
  },
  { key: "deadlineDay", header: "Upload + approve by", render: (r) => (r.stage === "built" || r.stage === "uploaded" ? `${r.deadlineDay ?? "—"} 4:00 pm` : "—") },
  { key: "match", header: "Bank debit", render: (r) => (r.match ? `${r.match.bankDate} · ${usd(r.match.bankCents)}` : r.stage === "voided" ? (r.voidedReason ?? "") : `expected ${r.windowEarliest}–${r.windowLatest}`) },
];

const paymentCols: ReportColumn<Row<PaymentRow>>[] = [
  { key: "date", header: "Date", render: (r) => r.date },
  { key: "payee", header: "Paid to", emphasis: true, render: (r) => r.payee },
  { key: "payeeKind", header: "Who", render: (r) => (r.payeeKind === "employee" ? "Employee" : "Vendor") },
  { key: "amountCents", header: "Amount", align: "right", render: (r) => usd(r.amountCents) },
  { key: "method", header: "How", render: (r) => r.method.toUpperCase() },
  { key: "detail", header: "For", render: (r) => r.detail },
  { key: "status", header: "Status", render: (r) => <span className={STAGE_TONE[r.status]}>{PAYMENT_STATUS_LABEL[r.status]}</span> },
  { key: "bankDate", header: "Bank posted", render: (r) => r.bankDate ?? "—" },
];

const payeeCols: ReportColumn<Row<PayeeRow>>[] = [
  { key: "payee", header: "Payee", emphasis: true, render: (r) => r.payee },
  { key: "payeeKind", header: "Who", render: (r) => (r.payeeKind === "employee" ? "Employee" : "Vendor") },
  { key: "payments", header: "Payments", align: "right", render: (r) => String(r.payments) },
  { key: "totalCents", header: "Total paid", align: "right", render: (r) => usd(r.totalCents) },
  { key: "clearedCents", header: "Cleared at bank", align: "right", render: (r) => usd(r.clearedCents) },
  { key: "processingCents", header: "Processing", align: "right", render: (r) => usd(r.processingCents) },
  { key: "lastDate", header: "Last paid", align: "right", render: (r) => r.lastDate },
];

const matchCols: ReportColumn<Row<BankMatch>>[] = [
  { key: "bankDate", header: "Bank date", render: (r) => `${r.bankDate}${r.pending ? " (pending)" : ""}` },
  { key: "bankDescription", header: "Bank description", render: (r) => r.bankDescription ?? "—" },
  { key: "bankCents", header: "Bank amount", align: "right", emphasis: true, render: (r) => usd(r.bankCents) },
  { key: "expectedCents", header: "Expected", align: "right", render: (r) => usd(r.expectedCents) },
  { key: "differenceCents", header: "Difference", align: "right", render: (r) => <span className={r.differenceCents === 0 ? "" : "text-[var(--admin-gold)]"}>{usd(r.differenceCents)}</span> },
  { key: "matchedTo", header: "Matched to", render: (r) => r.matchedTo },
  { key: "basis", header: "How matched", render: (r) => (r.basis === "file_total" ? "File total" : r.basis === "per_payment" ? "One payment" : "Payroll run") },
];

const owedCols: ReportColumn<Row<OutstandingRow>>[] = [
  { key: "vendorName", header: "Vendor", emphasis: true, render: (r) => r.vendorName },
  { key: "documentNumber", header: "Bill", render: (r) => r.documentNumber },
  { key: "sinceDate", header: "Since", render: (r) => r.sinceDate ?? "—" },
  { key: "ageDays", header: "Age (days)", align: "right", render: (r) => (r.ageDays === null ? "—" : String(r.ageDays)) },
  { key: "owedCents", header: "Bill total", align: "right", render: (r) => usd(r.owedCents) },
  { key: "paidCents", header: "Paid", align: "right", render: (r) => usd(r.paidCents) },
  { key: "remainingCents", header: "Still owed", align: "right", render: (r) => usd(r.remainingCents) },
];

export default async function AchPaymentsReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; range?: string; year?: string }> }) {
  // Owner and admin only: reports.view (the layout) is not enough.
  await requirePermission("ach.request");
  const sp = await searchParams;
  const range = resolveRange(sp);

  if (!isSupabaseServiceConfigured) {
    return <p className="text-sm text-white/50">Connect Supabase to view the ACH payments report.</p>;
  }

  const today = pacificToday();
  const load = await loadAchReportInputs();
  const r = buildAchReport({ ...load.input, todayIso: today, fromDate: range.fromDate, toDate: range.toDate });
  const qs = `from=${range.fromDate}&to=${range.toDate}`;
  const s = r.summary;

  return (
    <div className="space-y-5">
      <p className="text-xs text-white/50">
        Owner and admin only. Bank matches come from the Plaid feed of {load.mainAccountNames.length > 0 ? load.mainAccountNames.join(", ") : "your Main account"}. Dates are Pacific.
      </p>
      <DateRangePicker />

      {load.problems.length > 0 ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-200">
          <p className="font-bold">Some data did not load. Totals below may be short:</p>
          <ul className="mt-1 list-disc pl-5">
            {load.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {!load.tableReady ? <p className="rounded-xl border border-white/10 p-4 text-sm text-white/60">The ACH file ledger (migration 0273) is not applied yet, so only payments and bills are shown.</p> : null}

      {r.attention.length > 0 ? (
        <Section title="Needs your attention" subtitle="Most serious first.">
          <ul className="space-y-1.5 text-sm text-[var(--admin-gold)]">
            {r.attention.map((a) => (
              <li key={a}>• {a}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sent by ACH" value={usd(s.sentCents)} hint={`${range.label} · payroll ${usd(s.sentPayrollCents)}, vendors ${usd(s.sentVendorCents)}`} accent="green" />
        <StatCard label="Cleared at the bank" value={usd(s.clearedCents)} hint="Of the money sent in this range" accent="green" />
        <StatCard label="Still processing" value={usd(s.processingCents)} hint={`${s.processingFiles} file(s) not cleared yet (any date)`} accent="gold" />
        <StatCard label="Still owed to vendors" value={usd(s.outstandingCents)} hint={`${s.outstandingBills} open bill(s)`} accent="orange" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Draft payroll (not sent)" value={usd(s.draftPayrollCents)} hint={`${r.draftRuns.length} draft run(s)`} accent="muted" />
        <StatCard label="Must be funded" value={usd(s.fundingNeededCents)} hint="Files settling today or later, by 9:00 a.m. on each date" accent="muted" />
        <StatCard label="Built, not uploaded" value={String(s.stageCounts.built)} hint={`${s.stageCounts.uploaded} uploaded, not approved`} accent="muted" />
        <StatCard label="No bank debit found" value={String(s.stageCounts.missing)} hint={`${s.stageCounts.off} cleared with a different amount`} accent={s.stageCounts.missing > 0 ? "orange" : "muted"} />
      </div>

      <Section title="Timberland room left">
        <TimberlandRoomLeft today={today} />
      </Section>

      <Section id="files" title="ACH files" subtitle="Every file released here, newest first: where it is at Timberland and the bank debit it matched." exportHref={`/admin/reports/ach-payments/export?${qs}`}>
        <ReportTable columns={fileCols} rows={r.files as Row<FileRow>[]} emptyLabel="No ACH files yet." />
        <p className="mt-2 text-xs text-white/40">
          Upload, approve and void files on <Link className="underline" href="/admin/settings/banking/operations#files">Banking operations</Link>.
        </p>
      </Section>

      <Section title="Bank transactions matched" subtitle="The exact Main-account debits tied to your files and payments. Each debit is used once.">
        <ReportTable columns={matchCols} rows={r.bankMatches as Row<BankMatch>[]} emptyLabel={load.input.hasMainAccount ? "No ACH debits matched yet." : "Tag your Timberland account as Main in Finances to match bank debits."} />
        <p className="mt-2 text-xs text-white/40">
          The agreement (section 16) lets Timberland debit the account &ldquo;in the amount of each file&rdquo;. We first look for one debit per file; if a vendor file posts one debit per payment, each payment is matched on its own.
        </p>
      </Section>

      <Section title="Who was paid" subtitle={`Every payment with a date in ${range.label}.`}>
        <ReportTable columns={paymentCols} rows={r.payments as Row<PaymentRow>[]} emptyLabel="No payments in this range." />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="By payee" subtitle="Totals for the range.">
          <ReportTable columns={payeeCols} rows={r.payees as Row<PayeeRow>[]} emptyLabel="No payees in this range." />
        </Section>
        <Section title="By month" subtitle="ACH money by effective month.">
          <BarList data={r.months.map((m) => ({ label: `${m.month} payroll`, value: m.payrollCents }))} valueFormatter={usd} color={REPORT_COLORS.GREEN} emptyLabel="No payroll files in range." />
          <div className="mt-3" />
          <BarList data={r.months.map((m) => ({ label: `${m.month} vendors`, value: m.vendorCents }))} valueFormatter={usd} color={REPORT_COLORS.GOLD} emptyLabel="No vendor files in range." />
        </Section>
      </div>

      <Section title="Still owed to vendors" subtitle="Open bills, oldest first. Today, not limited by the date range.">
        <div className="mb-3 grid gap-3 sm:grid-cols-5">
          {(["0-30", "31-60", "61-90", "90+", "unknown"] as const).map((b) => (
            <StatCard key={b} label={b === "unknown" ? "No date" : `${b} days`} value={usd(s.agingCents[b])} accent={b === "90+" && s.agingCents[b] > 0 ? "orange" : "muted"} />
          ))}
        </div>
        <ReportTable columns={owedCols} rows={r.outstanding as Row<OutstandingRow>[]} emptyLabel="Nothing owed." />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Money needed by date" subtitle="Funds must be in the account by 9:00 a.m. on the settlement date (agreement section 14).">
          <BarList data={r.funding.map((d) => ({ label: `${d.date} (${d.files} file${d.files === 1 ? "" : "s"})`, value: d.cents }))} valueFormatter={usd} color={REPORT_COLORS.ORANGE} emptyLabel="Nothing waiting to settle." />
          {load.input.mainAvailableCents !== null ? <p className="mt-2 text-xs text-white/50">Main account available (last Plaid refresh): {usd(load.input.mainAvailableCents)}</p> : null}
        </Section>
        <Section title="Draft payroll runs" subtitle="Started but no file yet.">
          {r.draftRuns.length === 0 ? (
            <p className="text-sm text-white/40">No draft runs.</p>
          ) : (
            <ul className="space-y-1 text-sm text-white/70">
              {r.draftRuns.map((d) => (
                <li key={d.runId}>
                  <Link className="underline" href={`/admin/payroll/${d.runId}`}>
                    {d.label ?? `Pay date ${d.payDate}`}
                  </Link>{" "}
                  · pay date {d.payDate} · {usd(d.totalNetCents)}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
