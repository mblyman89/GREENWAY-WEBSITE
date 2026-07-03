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
 * Timeliness/Trust). Shows average completeness per domain plus how many records
 * still need attention, so a steward always knows what to improve next.
 */
export function KbHealthStrip({ health }: { health: KbHealth }) {
  const needs = health.strainsNeedingAttention + health.brandsNeedingAttention;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Meter
        label="Strain completeness"
        pct={health.strainCompleteness}
        hint={`${health.sampled.strains.toLocaleString()} strains`}
      />
      <Meter
        label="Brand completeness"
        pct={health.brandCompleteness}
        hint={`${health.sampled.brands.toLocaleString()} brands`}
      />
      <Meter
        label="Product completeness"
        pct={health.productCompleteness}
        hint={`${health.sampled.products.toLocaleString()} published`}
      />
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
        <span className="text-xs font-medium text-[var(--admin-text-muted)]">Needs attention</span>
        <div className="mt-1 text-2xl font-bold tabular-nums text-[var(--admin-text)]">{needs}</div>
        <p className="mt-1 text-[11px] text-[var(--admin-text-faint)]">
          records below a good quality score
        </p>
      </div>
    </div>
  );
}
