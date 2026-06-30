/**
 * DistributionBars — a compact horizontal-bar breakdown of a categorical
 * distribution (e.g. products by category / strain type / stock status).
 * Server-component friendly; pure CSS widths, no chart library needed.
 *
 * Part of POS Slice 1 page insight upgrade.
 */
export function DistributionBars({
  title,
  rows,
  max,
}: {
  title: string;
  rows: { label: string; count: number }[];
  /** Optional explicit max for the bar scale (defaults to the largest row). */
  max?: number;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--admin-text-faint)]">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--admin-text-faint)]">No data.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const pct = Math.round((r.count / top) * 100);
            return (
              <li key={r.label} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-xs text-[var(--admin-text-muted)]" title={r.label}>
                  {r.label}
                </span>
                <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/5">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-[var(--admin-accent)]/70"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right text-xs font-semibold text-[var(--admin-text)]">
                  {r.count}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
