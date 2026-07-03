import Link from "next/link";
import type { ReactNode } from "react";

/**
 * KbNavCard — a single entity/area tile on the Knowledge Base command-center hub.
 *
 * Progressive disclosure (NN/g): the hub shows only the few most-important entry
 * points; each card is a clearly-labelled door with strong "information scent"
 * (a count + one-line description) into a focused sub-page. The heavy editors
 * live behind these doors, not on the hub itself.
 */
export function KbNavCard({
  href,
  title,
  description,
  count,
  accent = "muted",
  badge,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  count?: number | null;
  accent?: "green" | "gold" | "orange" | "muted";
  /** Optional attention badge, e.g. "3 to review". */
  badge?: string | null;
  icon?: ReactNode;
}) {
  const accentColor =
    accent === "green"
      ? "var(--admin-accent)"
      : accent === "gold"
        ? "var(--admin-gold, #c9a227)"
        : accent === "orange"
          ? "var(--admin-orange)"
          : "var(--admin-text-muted)";

  return (
    <Link
      href={href}
      className="group relative flex flex-col rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-[var(--admin-shadow-sm)] transition-colors hover:border-[var(--admin-accent)]/50"
    >
      <span
        aria-hidden
        className="absolute left-0 top-5 h-6 w-1 rounded-r"
        style={{ background: accentColor }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon ? <span className="text-[var(--admin-text-muted)]">{icon}</span> : null}
          <h3 className="text-sm font-semibold text-[var(--admin-text)]">{title}</h3>
        </div>
        {typeof count === "number" ? (
          <span className="shrink-0 text-lg font-semibold tabular-nums text-[var(--admin-text)]">
            {count.toLocaleString()}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--admin-text-muted)]">{description}</p>
      <div className="mt-3 flex items-center justify-between">
        {badge ? (
          <span className="rounded-full border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--admin-text)]">
            {badge}
          </span>
        ) : (
          <span />
        )}
        <span className="text-xs font-medium text-[var(--admin-accent)] opacity-0 transition-opacity group-hover:opacity-100">
          Open →
        </span>
      </div>
    </Link>
  );
}
