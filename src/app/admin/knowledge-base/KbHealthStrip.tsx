import type { KbHealth } from "@/lib/ai/kb/health";

function bar(pct: number): string {
  if (pct >= 85) return "var(--admin-accent)";
  if (pct >= 65) return "var(--admin-gold)";
  if (pct >= 40) return "var(--admin-orange)";
  return "var(--admin-danger, #d9534f)";
}

function Meter({ label, pct, hint }: { label: string; pct: number; hint?: string }) {
  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-[var(--admin-text-muted)]">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-[var(--admin-text)]">{pct}%</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--admin-bg)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: bar(pct) }} />
      </div>
      {hint ? <p className="mt-1.5 text-[11px] text-[var(--admin-text-faint)]">{hint}</p> : null}
    </div>
  );
}

/**
 * KbHealthStrip — the golden-record signals at a glance (MDM: Completeness +
 * Timeliness/Trust). Each meter shows the average completeness of that domain and
 * the TRUE record count as its denominator (8b: exact totals, not the sampled
 * page). "Needs attention" spells out exactly what it counts so it's not vague.
 */
export function KbHealthStrip({ health }: { health: KbHealth }) {
  const needs =
    health.strainsNeedingAttention +
    health.brandsNeedingAttention +
    health.vendorsNeedingAttention;

  // If we only scored a sample of a much larger set, say so honestly.
  const strainHint =
    health.totals.strains > health.sampled.strains
      ? `${health.totals.strains.toLocaleString()} strains · scored a ${health.sampled.strains.toLocaleString()} sample`
      : `${health.totals.strains.toLocaleString()} strains`;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <Meter label="Strain completeness" pct={health.strainCompleteness} hint={strainHint} />
      <Meter
        label="Brand completeness"
        pct={health.brandCompleteness}
        hint={`${health.totals.brands.toLocaleString()} brand${health.totals.brands === 1 ? "" : "s"}`}
      />
      <Meter
        label="Vendor completeness"
        pct={health.vendorCompleteness}
        hint={`${health.totals.vendors.toLocaleString()} vendor${health.totals.vendors === 1 ? "" : "s"}`}
      />
      <Meter
        label="Product completeness"
        pct={health.productCompleteness}
        hint={`${health.totals.products.toLocaleString()} published`}
      />
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
        <span className="text-xs font-medium text-[var(--admin-text-muted)]">Needs attention</span>
        <div className="mt-1 text-2xl font-bold tabular-nums text-[var(--admin-text)]">{needs}</div>
        <p className="mt-1 text-[11px] text-[var(--admin-text-faint)]">
          strains, brands &amp; vendors missing enough facts to describe them well
        </p>
      </div>
    </div>
  );
}
