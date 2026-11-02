/**
 * src/app/admin/reports/cultivera-benchmark/page.tsx - Reports -> Cultivera Benchmark (CVB-6). OWNER ONLY.
 *
 * Michael, 2026-11-01: "I would like to have a new tab added to reports called Cultivera Benchmark ... compare
 * how well we're doing with our system vs Cultivera ... Total build was 40k ... We just now today from switching
 * saved 5500 ... This will be owner only access."
 *
 * The reports layout lets reports.view in, so this page checks "cultivera.benchmark" itself (owner only,
 * src/lib/auth/roles.ts); the tab is hidden for everyone else (ReportTabs, CULTIVERA_BENCHMARK_TAB) and both
 * actions check the same permission.
 *
 * What it shows: the payback meter ($40,000 build cost less every saving and outperformance credit), our period
 * beside Cultivera's same calendar days one year earlier (pre-tax, cents, Pacific days; a metric that cannot be
 * matched exactly says so instead of showing a number), the ledger, and the two owner actions.
 */
import { requirePermission } from "@/lib/auth/session";
import { StatCard } from "@/components/admin/StatCard";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { Button } from "@/components/admin/ui";
import { resolveRange } from "@/lib/reports/range";
import { formatCents, outperformCredit, paybackSummary, type CompareStatus } from "@/lib/reports/cultivera-benchmark-core";
import { PAYBACK_METRIC, creditOverlap, meterWidth } from "@/lib/reports/cultivera-benchmark-report-core";
import { paybackEntries, type StoredPaybackEntry } from "@/lib/reports/cultivera-benchmark-store";
import { buildBenchmark, type Benchmark } from "@/lib/reports/cultivera-benchmark-report-store";
import { creditOutperformAction, recordSavingAction } from "./actions";

export const dynamic = "force-dynamic";
// A long period reads every completed order and its lines.
export const maxDuration = 120;

const STATUS: Record<CompareStatus, { label: string; tone: string }> = {
  ahead: { label: "ahead", tone: "text-[var(--admin-accent)]" },
  behind: { label: "behind", tone: "text-red-300" },
  even: { label: "even", tone: "text-white/70" },
  info: { label: "for information", tone: "text-white/50" },
  not_comparable: { label: "not comparable", tone: "text-white/40" },
};

const KIND_LABEL: Record<string, string> = { build_cost: "Build cost", saving: "Saving", outperform: "Outperformance", adjustment: "Adjustment" };

export default async function CultiveraBenchmarkPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string; year?: string; error?: string; saved?: string; already?: string; credited?: string }>;
}) {
  await requirePermission("cultivera.benchmark");
  const sp = await searchParams;
  const range = resolveRange(sp);
  const from = range.fromDate;
  const to = range.toDate;

  let entries: StoredPaybackEntry[] = [];
  let b: Benchmark | null = null;
  let loadError: string | null = null;
  try {
    [entries, b] = await Promise.all([paybackEntries(), buildBenchmark(from, to)]);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load the benchmark.";
  }
  const pay = paybackSummary(entries);
  const credit = b?.cmp ? outperformCredit(b.cmp, PAYBACK_METRIC, b.today) : "there is no Cultivera period to compare with";
  const clash = typeof credit === "string" ? null : creditOverlap(entries, credit.basis.from, credit.basis.to);

  return (
    <div className="space-y-5">
      <DateRangePicker />

      {(sp.error || loadError) && (
        <div data-testid="cvb-error" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {sp.error ?? loadError}
        </div>
      )}
      {sp.saved && <Note tone="green">Saving recorded. The amount left to pay back went down.</Note>}
      {sp.credited && <Note tone="green">Outperformance of {formatCents(Number(sp.credited))} credited.</Note>}
      {sp.already && <Note tone="gold">That was already recorded, so nothing changed.</Note>}

      {/* Payback meter */}
      <section data-testid="cvb-payback" className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">Build cost payback</h2>
        <p className="mt-0.5 text-xs text-white/45">
          The {formatCents(pay.buildCostMinor)} build goes down with every saving you record and every period our gross profit beats Cultivera&apos;s.
        </p>
        <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-[var(--admin-accent)]" style={{ width: `${meterWidth(pay.pctPaidBack)}%` }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Build cost" value={formatCents(pay.buildCostMinor)} accent="muted" />
          <StatCard label="Savings" value={formatCents(pay.savingsMinor)} accent="green" />
          <StatCard label="Outperformance" value={formatCents(pay.outperformMinor)} accent="green" />
          <StatCard
            label="Left to pay back"
            value={formatCents(pay.remainingMinor)}
            hint={pay.paidBackOn ? `paid back on ${pay.paidBackOn}` : pay.pctPaidBack !== null ? `${pay.pctPaidBack}% paid back` : undefined}
            accent={pay.remainingMinor === 0 ? "green" : "gold"}
          />
          <StatCard label="Ahead by" value={formatCents(pay.aheadByMinor)} hint={pay.adjustmentsMinor ? `adjustments ${formatCents(pay.adjustmentsMinor)}` : undefined} accent="muted" />
        </div>
        {pay.rejected.length > 0 && (
          <p data-testid="cvb-rejected" className="mt-3 text-xs text-red-300">
            Ledger rows left out of the total: {pay.rejected.join("; ")}.
          </p>
        )}
      </section>

      {/* Comparison */}
      {b && (
        <section data-testid="cvb-compare" className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">
            Us {from} to {to} vs Cultivera {b.theirsRange ? `${b.theirsRange.from} to ${b.theirsRange.to}` : "(no period)"}
          </h2>
          <p className="mt-0.5 text-xs text-white/45">
            Same calendar days one year earlier. Pre-tax, Pacific days.{" "}
            {b.cutover ? `Our system started ${b.cutover}.` : "The cut-over date is not set (Books settings), so our side is not shown."}{" "}
            We have {b.ours.daysWithData} of {b.ours.daysInPeriod} days; Cultivera has {b.cmp?.theirs.daysWithData ?? 0} of {b.cmp?.theirs.daysInPeriod ?? 0}.
            {b.cmp && !b.cmp.complete && " A period with missing days on either side is shown but cannot win or lose."}
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-white/45">
                  <th className="py-2 pr-4">Metric</th>
                  <th className="py-2 pr-4 text-right">Us</th>
                  <th className="py-2 pr-4 text-right">Cultivera</th>
                  <th className="py-2 pr-4 text-right">Difference</th>
                  <th className="py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {(b.cmp?.metrics ?? []).map((m) => (
                  <tr key={m.key} data-testid={`cvb-metric-${m.key}`} className="border-t border-white/5">
                    <td className="py-2 pr-4 text-white/80">{m.label}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCents(m.oursMinor)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCents(m.theirsMinor)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {m.diffMinor === null ? "\u2014" : `${formatCents(m.diffMinor)}${m.pct === null ? "" : ` (${m.pct > 0 ? "+" : ""}${m.pct}%)`}`}
                    </td>
                    <td className={`py-2 text-xs font-bold ${STATUS[m.status].tone}`}>{STATUS[m.status].label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {b.ours.notes.length > 0 && (
            <ul data-testid="cvb-notes" className="mt-3 list-disc space-y-1 pl-5 text-xs text-white/50">
              {b.ours.notes.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          {b.ids.breaks.length > 0 && (
            <p className="mt-2 text-xs text-white/40">Cultivera rows that broke its own formulas: {b.ids.breaks.join("; ")}.</p>
          )}
          <p className="mt-2 text-xs text-white/40">
            Our side: {b.ours.orders.toLocaleString("en-US")} completed orders, {b.ours.returns.toLocaleString("en-US")} returns. Cultivera&apos;s side comes
            from its own daily sales report, stored by Admin {"\u2192"} Lyman {"\u2192"} Cultivera Archive.
          </p>
        </section>
      )}

      {/* Owner actions */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">Credit this period</h2>
          <p data-testid="cvb-credit-line" className="mt-1 text-xs text-white/55">
            {typeof credit === "string"
              ? `Not creditable: ${credit}.`
              : clash
                ? `Not creditable: ${clash}.`
                : `Our gross profit beat Cultivera's by ${formatCents(credit.amountMinor)}. Crediting takes that off the amount left to pay back.`}
          </p>
          {typeof credit !== "string" && !clash && (
            <form action={creditOutperformAction} className="mt-3">
              <input type="hidden" name="from" value={from} />
              <input type="hidden" name="to" value={to} />
              <Button type="submit" variant="confirm">Credit {formatCents(credit.amountMinor)}</Button>
            </form>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">Record a saving</h2>
          <p className="mt-1 text-xs text-white/55">A saving from switching that you can state (for example a Cultivera bill that no longer comes).</p>
          <form action={recordSavingAction} className="mt-3 grid gap-2 sm:grid-cols-3">
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <input name="dollars" required inputMode="decimal" placeholder="Amount, e.g. 550.00" className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm" />
            <input name="date" required type="date" defaultValue={b?.today ?? ""} className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm" />
            <input name="note" required maxLength={1000} placeholder="What was saved" className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm" />
            <div className="sm:col-span-3">
              <Button type="submit" variant="primary">Record saving</Button>
            </div>
          </form>
        </section>
      </div>

      {/* Ledger */}
      <section data-testid="cvb-ledger" className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">Payback ledger</h2>
        <p className="mt-0.5 text-xs text-white/45">Every row is kept; nothing is edited or deleted.</p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-white/45">
              <th className="py-2 pr-4">Date</th>
              <th className="py-2 pr-4">Kind</th>
              <th className="py-2 pr-4 text-right">Amount</th>
              <th className="py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.entryKey} className="border-t border-white/5">
                <td className="py-2 pr-4 tabular-nums">{e.entryDate}</td>
                <td className="py-2 pr-4">{KIND_LABEL[e.kind] ?? e.kind}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{formatCents(e.amountMinor)}</td>
                <td className="py-2 text-white/70">{e.note}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-xs text-white/45">No ledger rows yet (migration 0337 seeds the build cost and the first saving).</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Note({ tone, children }: { tone: "green" | "gold"; children: React.ReactNode }) {
  const c = tone === "green" ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]" : "border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 text-[var(--admin-gold)]";
  return <div className={`rounded-lg border px-4 py-3 text-sm ${c}`}>{children}</div>;
}
