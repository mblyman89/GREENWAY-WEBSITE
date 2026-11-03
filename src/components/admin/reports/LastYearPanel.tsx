/**
 * CVB-10 - "Same period last year" panel for Reports → Overview and Sales (decision CVB-D17).
 * Every figure says which system it came from; a Cultivera figure carries the gold "Cultivera (imported)" badge.
 */
import { formatMinorCurrency } from "@/lib/leafly/format";
import { CULTIVERA_LABEL } from "@/lib/reports/cultivera-history-core";
import type { LastYearComparison } from "@/lib/reports/last-year-core";

function Badge({ source }: { source: "greenway" | "cultivera" }) {
  return source === "cultivera" ? (
    <span className="rounded-full border border-[var(--admin-gold)]/50 bg-[var(--admin-gold)]/15 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-gold)]">
      {CULTIVERA_LABEL}
    </span>
  ) : (
    <span className="rounded-full border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-accent)]">
      Greenway
    </span>
  );
}

const fmt = (key: string, v: number) => (key === "revenue" ? formatMinorCurrency(v) : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));

export function LastYearPanel({ comparison, error }: { comparison: LastYearComparison | null; error: string | null }) {
  if (error) {
    return (
      <section data-testid="last-year" className="rounded-2xl border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/5 p-4 text-xs text-[var(--admin-gold)]">
        Same period last year could not be shown: {error}
      </section>
    );
  }
  if (!comparison) return null;
  const c = comparison;
  return (
    <section data-testid="last-year" className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/70">Same period last year</h2>
        <span className="text-xs text-white/45">
          {c.period.from} to {c.period.to} vs {c.lastYear.from} to {c.lastYear.to} (completed orders, tax included)
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {c.metrics.map((m) => (
          <div key={m.key} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-white/45">{m.label}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lg font-black text-white">{fmt(m.key, m.now)}</span>
              {m.changePct !== null && (
                <span className={`text-xs font-bold ${m.changePct > 0 ? "text-[var(--admin-accent)]" : m.changePct < 0 ? "text-orange-400" : "text-white/50"}`}>
                  {m.changePct > 0 ? "+" : ""}
                  {m.changePct}%
                </span>
              )}
            </div>
            <div className="mt-1 text-[0.7rem] text-white/45">
              Last year: {m.then === null ? "not shown" : fmt(m.key, m.then)}
            </div>
          </div>
        ))}
      </div>
      <ul className="mt-3 space-y-1 text-xs text-white/60">
        {c.parts.map((p) => (
          <li key={`${p.segment.source}-${p.segment.from}`} className="flex flex-wrap items-center gap-2">
            <Badge source={p.segment.source} />
            <span>
              {p.segment.from} to {p.segment.to}:{" "}
              {p.hidden
                ? "owner only"
                : p.totals === null
                  ? "could not be read"
                  : `${formatMinorCurrency(p.totals.revenueMinor)} · ${p.totals.orders.toLocaleString()} orders · ${p.totals.units.toLocaleString("en-US", { maximumFractionDigits: 1 })} units`}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[0.7rem] text-white/40">This period: Greenway figures. {c.note}</p>
    </section>
  );
}
