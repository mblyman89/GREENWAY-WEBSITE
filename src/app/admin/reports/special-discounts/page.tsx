/**
 * src/app/admin/reports/special-discounts/page.tsx  (SLICE 29)
 *
 * The Special Discounts report — the owner's tracking view for the three
 * person-based courtesy programs (employee / industry / veteran, migration
 * 0133). Answers his three questions for any date window:
 *
 *   WHO gives them   — cashiers ranked by cents given away, plus the
 *                      approving witnesses on employee purchases.
 *   TO WHOM          — buying employees, and industry companies (grouped
 *                      case-insensitively so one vendor is one row).
 *   HOW OFTEN        — totals, per-program split, and a per-Pacific-day
 *                      trend, with a newest-first detail table of every use.
 *
 * Settings live at /admin/settings/special-discounts (admin-only); this
 * report is readable by anyone with reports.view like the rest of the suite.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { BarList, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { ExportButtons } from "@/components/admin/reports/ExportButtons";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { resolveRange } from "@/lib/reports/range";
import { formatBps } from "@/lib/discounts/special-discount-core";
import { getSpecialDiscountSettings } from "@/lib/discounts/special-discount-store";
import { getSpecialDiscountReport } from "@/lib/reports/special-discounts";
import { pacificDayKey } from "@/lib/reports/timezone";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  employee: "Employee",
  industry: "Industry",
  veteran: "Veteran",
};

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

type DisplayRow = Record<string, unknown>;

const PERSON_COLUMNS: ReportColumn<DisplayRow>[] = [
  { key: "name", header: "Employee", align: "left" },
  { key: "uses", header: "Uses", align: "right" },
  { key: "discountLabel", header: "Cents given", align: "right", emphasis: true },
  { key: "lastUsed", header: "Last used", align: "right" },
];

const COMPANY_COLUMNS: ReportColumn<DisplayRow>[] = [
  { key: "name", header: "Company", align: "left" },
  { key: "uses", header: "Visits", align: "right" },
  { key: "discountLabel", header: "Cents given", align: "right", emphasis: true },
  { key: "lastUsed", header: "Last visit", align: "right" },
];

const RECENT_COLUMNS: ReportColumn<DisplayRow>[] = [
  { key: "when", header: "When (PT)", align: "left" },
  { key: "program", header: "Program", align: "left" },
  { key: "recipient", header: "Given to", align: "left" },
  { key: "cashier", header: "Rung by", align: "left" },
  { key: "approver", header: "Approved by", align: "left" },
  { key: "register", header: "Register", align: "left" },
  { key: "discountLabel", header: "Saved", align: "right", emphasis: true },
];

/** "2026-02-10T20:00:00Z" → "2026-02-10" (Pacific), or "—" for blanks. */
function ptDay(iso: string): string {
  return iso && Number.isFinite(Date.parse(iso)) ? pacificDayKey(iso) : "\u2014";
}

export default async function SpecialDiscountsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string; year?: string }>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const range = resolveRange(sp);

  if (!isSupabaseServiceConfigured) {
    return (
      <p className="text-sm text-white/50">Connect Supabase to view the special discounts report.</p>
    );
  }

  const [r, settings] = await Promise.all([
    getSpecialDiscountReport(range.fromISO, range.toISO),
    getSpecialDiscountSettings(),
  ]);
  const s = r.summary;
  const qs = `from=${range.fromISO.slice(0, 10)}&to=${range.toISO.slice(0, 10)}`;

  const personRows = (people: typeof r.byCashier): DisplayRow[] =>
    people.map((p) => ({
      name: p.name,
      uses: p.uses.toLocaleString("en-US"),
      discountLabel: formatMinorCurrency(p.discountMinor),
      lastUsed: ptDay(p.lastUsedAt),
    }));

  const companyRows: DisplayRow[] = s.byCompany.map((c) => ({
    name: c.name,
    uses: c.uses.toLocaleString("en-US"),
    discountLabel: formatMinorCurrency(c.discountMinor),
    lastUsed: ptDay(c.lastUsedAt),
  }));

  const recentRows: DisplayRow[] = r.recentUses.map((u) => ({
    when: ptDay(u.occurredAt),
    program: KIND_LABELS[u.kind] ?? u.kind,
    recipient: u.recipientLabel,
    cashier: u.cashierName,
    approver: u.approverName ?? "\u2014",
    register: u.registerName,
    discountLabel: formatMinorCurrency(u.discountMinor),
  }));

  const kindStat = (kind: "employee" | "industry" | "veteran") =>
    s.byKind.find((k) => k.kind === kind) ?? { uses: 0, discountMinor: 0 };
  const setting = (kind: "employee" | "industry" | "veteran") =>
    settings.find((x) => x.kind === kind);
  const kindHint = (kind: "employee" | "industry" | "veteran") => {
    const cfg = setting(kind);
    const state = cfg?.enabled ? `${formatBps(cfg.percentBps)} \u00b7 on` : "off";
    return `${formatMinorCurrency(kindStat(kind).discountMinor)} given \u00b7 ${state}`;
  };

  return (
    <div className="space-y-5">
      <DateRangePicker />

      {/* HOW OFTEN — the headline */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Special discounts given"
          value={s.totalUses.toLocaleString("en-US")}
          hint={range.label}
          accent="green"
        />
        <StatCard
          label="Total cents given away"
          value={formatMinorCurrency(s.totalDiscountMinor)}
          hint={`On ${formatMinorCurrency(s.totalSubtotalMinor)} of pre-discount sales`}
          accent="orange"
        />
        <StatCard
          label="Average per use"
          value={formatMinorCurrency(s.avgDiscountMinor)}
          accent="gold"
        />
        <StatCard
          label="Companies helped"
          value={s.byCompany.length.toLocaleString("en-US")}
          hint="Industry program, grouped per company"
          accent="muted"
        />
      </div>

      {/* Per-program split with the CURRENT dials for context */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Employee purchases"
          value={kindStat("employee").uses.toLocaleString("en-US")}
          hint={kindHint("employee")}
          accent="green"
        />
        <StatCard
          label="Industry visits"
          value={kindStat("industry").uses.toLocaleString("en-US")}
          hint={kindHint("industry")}
          accent="gold"
        />
        <StatCard
          label="Veteran discounts"
          value={kindStat("veteran").uses.toLocaleString("en-US")}
          hint={kindHint("veteran")}
          accent="orange"
        />
      </div>

      <p className="text-xs text-white/40">
        Program rates and on/off switches live in{" "}
        <Link href="/admin/settings/special-discounts" className="font-bold text-white/70 underline">
          Settings {"\u2192"} Special discounts
        </Link>{" "}
        (owner/admin only). Every use below was recorded automatically at the register.
      </p>

      {/* WHO gives them / HOW OFTEN trend */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Who gives them" subtitle="Cashiers ranked by cents given away.">
          <BarList
            data={r.byCashier.map((p) => ({ label: p.name, value: p.discountMinor }))}
            valueFormatter={(v) => formatMinorCurrency(v)}
            color={REPORT_COLORS.ORANGE}
            emptyLabel="No special discounts in this window."
          />
        </Section>
        <Section title="How often" subtitle="Uses per Pacific day.">
          <BarList
            data={s.byDay.map((d) => ({ label: d.date, value: d.uses }))}
            color={REPORT_COLORS.GREEN}
            emptyLabel="No special discounts in this window."
          />
        </Section>
      </div>

      {/* TO WHOM — employee program */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title={"Employee purchases \u2014 who bought"}
          subtitle="The buying employee on each staff purchase (35% program)."
        >
          <ReportTable
            columns={PERSON_COLUMNS}
            rows={personRows(r.byBeneficiary)}
            emptyLabel="No employee purchases in this window."
          />
        </Section>
        <Section
          title={"Employee purchases \u2014 who approved"}
          subtitle="The SECOND employee whose PIN witnessed each staff purchase."
        >
          <ReportTable
            columns={PERSON_COLUMNS}
            rows={personRows(r.byApprover)}
            emptyLabel="No employee purchases in this window."
          />
        </Section>
      </div>

      {/* TO WHOM — industry companies */}
      <Section
        title="Industry visitors by company"
        subtitle="One row per company (case-insensitive), so repeat visitors are easy to spot."
        exportHref={`/admin/reports/special-discounts/export?${qs}`}
      >
        <ReportTable
          columns={COMPANY_COLUMNS}
          rows={companyRows}
          emptyLabel="No industry discounts in this window."
        />
      </Section>

      {/* Cashier detail table (the bar list above is the visual) */}
      <Section title="Cashier detail" subtitle="Every employee who rang a special discount.">
        <ReportTable
          columns={PERSON_COLUMNS}
          rows={personRows(r.byCashier)}
          emptyLabel="No special discounts in this window."
        />
      </Section>

      {/* The ledger itself */}
      <Section
        title="Recent uses"
        subtitle={"Newest first \u2014 up to 200 shown here; the export carries the same detail."}
      >
        <ReportTable
          columns={RECENT_COLUMNS}
          rows={recentRows}
          emptyLabel="No special discounts in this window."
        />
      </Section>
    </div>
  );
}
