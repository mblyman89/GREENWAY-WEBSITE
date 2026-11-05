/**
 * PERF P3 (owner 2026-11-05: "I want the main admin page to be instant"):
 * the placeholders each cockpit section shows while its own figures stream
 * in. The page header, the banners and every section that is ready paint at
 * once; a slow figure only holds up its own box. Pure markup, no client JS.
 */
export function CockpitSectionSkeleton({
  title,
  tiles = 4,
  tall = false,
}: {
  title?: string;
  tiles?: number;
  tall?: boolean;
}) {
  return (
    <section aria-busy="true" aria-live="polite">
      {title ? (
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--admin-text-muted)]">{title}</h2>
      ) : null}
      <span className="sr-only">Loading{title ? ` ${title}` : ""}…</span>
      <div className={`grid gap-4 ${tiles >= 4 ? "grid-cols-2 lg:grid-cols-4" : tiles === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
        {Array.from({ length: tiles }, (_, i) => (
          <div
            key={i}
            className={`${tall ? "h-56" : "h-24"} animate-pulse rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-white/[0.04]`}
          />
        ))}
      </div>
    </section>
  );
}

/** A single slim bar for a panel that may well render nothing at all. */
export function CockpitPanelSkeleton() {
  return <div aria-hidden="true" className="h-14 animate-pulse rounded-[var(--admin-radius-lg)] bg-white/[0.03]" />;
}
