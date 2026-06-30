import Link from "next/link";
import type { GapInsight } from "@/lib/insight/products";

/**
 * MissingInsight — a ranked "what's still missing" panel. Each row shows a
 * count, a plain-language label, and (optionally) a deep link to a filtered
 * view that fixes it. Server-component friendly; no client JS.
 *
 * Part of POS Slice 1 page insight upgrade.
 */
export function MissingInsight({
  title = "What's missing",
  subtitle,
  noun,
  gaps,
}: {
  title?: string;
  subtitle?: string;
  /** Singular noun for the items, e.g. "product", "vendor", "brand". */
  noun: string;
  gaps: GapInsight[];
}) {
  if (gaps.length === 0) {
    return (
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-4 text-sm text-[var(--admin-accent)]">
        🎉 Nothing missing — every {noun} has its key details filled in.
      </div>
    );
  }

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-[var(--admin-text)]">{title}</h2>
        {subtitle && <p className="text-xs text-[var(--admin-text-faint)]">{subtitle}</p>}
      </div>
      <ul className="space-y-1.5">
        {gaps.map((g) => {
          const row = (
            <div className="flex items-center gap-3 rounded-[var(--admin-radius)] px-2 py-1.5 transition hover:bg-white/5">
              <span
                className={`inline-flex min-w-9 shrink-0 justify-center rounded-md px-2 py-0.5 text-xs font-bold ${
                  g.weight >= 3
                    ? "bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]"
                    : "bg-white/10 text-[var(--admin-text-muted)]"
                }`}
              >
                {g.count}
              </span>
              <span className="flex-1 text-sm text-[var(--admin-text-muted)]">
                {noun}
                {g.count === 1 ? "" : "s"} {g.label}
              </span>
              {g.href && <span className="text-xs font-semibold text-[var(--admin-accent)]">Fix →</span>}
            </div>
          );
          return (
            <li key={g.key}>
              {g.href ? (
                <Link href={g.href} className="block">
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
