import type { ReactNode } from "react";

/**
 * Section — a consistent titled block for grouping content on admin pages
 * (e.g. "Today at a glance", "Quick links"). Standardizes the small uppercase
 * section heading + optional action that pages currently re-type by hand.
 * Server-component friendly.
 */
export function Section({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            {title ? (
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--admin-text-muted)]">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-sm text-[var(--admin-text-faint)]">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}
