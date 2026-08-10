/**
 * src/app/admin/reports/net-income/page.tsx  (P6c)
 *
 * The "Net income" tab — a plain-English operating roll-up for a date range:
 *   Gross revenue − COGS = Gross profit; + ATM surcharge − Payroll = Operating
 *   result. Built from figures the app can actually verify (COGS report,
 *   completed payroll runs, ATM settlements). It is honest about what it does
 *   NOT include (rent, taxes remitted, vendor payments, etc.).
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { resolveRange } from "@/lib/reports/range";
import { getNetIncomeInputs } from "@/lib/reports/net-income-store";
import {
  buildNetIncome,
  netIncomeHeadline,
  formatRatioPct,
  type NetIncomeLine,
} from "@/lib/reports/net-income-core";

export const dynamic = "force-dynamic";

/** Signed money: green when it adds, muted/red when it subtracts. */
function SignedMoney({ cents }: { cents: number }) {
  const isNeg = cents < 0;
  return (
    <span className={`tabular-nums ${isNeg ? "text-[var(--admin-orange)]" : "text-white"}`}>
      {isNeg ? "−" : ""}
      {formatMinorCurrency(Math.abs(cents))}
    </span>
  );
}

function LineRow({ line }: { line: NetIncomeLine }) {
  const emphasized = line.kind === "subtotal" || line.kind === "total";
  const isTotal = line.kind === "total";
  return (
    <div
      className={`flex items-start justify-between gap-4 px-4 py-3 ${
        emphasized ? "bg-white/[0.03]" : ""
      } ${isTotal ? "border-t-2 border-white/20" : "border-t border-white/5"}`}
    >
      <div>
        <p className={`text-sm ${emphasized ? "font-bold text-white" : "font-medium text-white/85"}`}>
          {line.label}
        </p>
        {line.note ? <p className="mt-0.5 text-xs text-white/40">{line.note}</p> : null}
      </div>
      <p className={`text-sm ${isTotal ? "text-base font-black" : emphasized ? "font-bold" : ""}`}>
        <SignedMoney cents={line.amountCents} />
      </p>
    </div>
  );
}

export default async function NetIncomeReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string; year?: string }>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const range = resolveRange(sp);

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/50">
        Supabase isn&apos;t configured in this environment, so net-income data is unavailable.
      </div>
    );
  }

  const inputs = await getNetIncomeInputs({
    fromISO: range.fromISO,
    toISO: range.toISO,
    fromDate: range.fromDate,
    toDate: range.toDate,
  });
  const report = buildNetIncome(inputs);
  const headline = netIncomeHeadline(report, inputs.revenueCents);

  const bannerCls =
    headline.tone === "green"
      ? "border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/[0.06]"
      : headline.tone === "orange"
        ? "border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/[0.06]"
        : "border-white/10 bg-white/[0.02]";
  const bannerTitleCls =
    headline.tone === "green"
      ? "text-[var(--admin-accent)]"
      : headline.tone === "orange"
        ? "text-[var(--admin-orange)]"
        : "text-white";

  return (
    <div className="space-y-5">
      <DateRangePicker />

      {/* Verdict banner — the bottom line in one glance. */}
      <div className={`rounded-2xl border p-5 ${bannerCls}`}>
        <h2 className={`text-lg font-black ${bannerTitleCls}`}>{headline.title}</h2>
        <p className="mt-1 text-sm text-white/70">{headline.detail}</p>
        <p className="mt-1 text-xs text-white/40">Range: {range.label}</p>
      </div>

      {/* Headline KPIs. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Gross revenue" value={formatMinorCurrency(inputs.revenueCents)} accent="green" />
        <StatCard
          label="Gross profit"
          value={formatMinorCurrency(report.grossProfitCents)}
          hint={`${formatRatioPct(report.grossMarginRatio)} margin`}
          accent="gold"
        />
        <StatCard label="ATM surcharge" value={formatMinorCurrency(inputs.atmSurchargeCents)} accent="muted" />
        <StatCard
          label="Operating result"
          value={formatMinorCurrency(report.operatingResultCents)}
          hint={`${formatRatioPct(report.operatingMarginRatio)} operating margin`}
          accent={report.isProfitable ? "green" : "orange"}
        />
      </div>

      {/* The roll-up statement. */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-3">
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">Operating roll-up</h2>
          <p className="mt-1 text-xs text-white/40">
            Every figure below is pulled from what the app can verify — your sales, product cost, ATM settlements, and
            payroll that actually cleared the bank. Nothing is estimated.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-white/10">
          {report.lines.map((line) => (
            <LineRow key={line.key} line={line} />
          ))}
        </div>
      </section>

      {/* Honesty note — what this bottom line does NOT include. */}
      <section className="rounded-2xl border border-[var(--admin-gold)]/25 bg-[var(--admin-gold)]/[0.04] p-5">
        <h2 className="mb-1 text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-gold)]">
          Not yet included in this number
        </h2>
        <p className="mb-3 text-xs text-white/50">
          This is an <span className="font-semibold text-white/70">operating</span> roll-up, not your final bottom-line
          profit. So the number is never misread, here&apos;s what it deliberately leaves out — because the app has no
          verified ledger for these yet:
        </p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {report.notIncluded.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-white/70">
              <span className="mt-0.5 text-[var(--admin-gold)]">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
