import Link from "next/link";
import type { ReactNode } from "react";

type Accent = "green" | "gold" | "orange" | "muted";

const ACCENTS: Record<Accent, string> = {
  green: "text-[var(--admin-accent)]",
  gold: "text-[var(--admin-gold)]",
  orange: "text-[var(--admin-orange)]",
  muted: "text-[var(--admin-text)]",
};

const ICON_BG: Record<Accent, string> = {
  green: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
  gold: "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
  orange: "bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]",
  muted: "bg-white/10 text-[var(--admin-text-muted)]",
};

/**
 * StatCard — a single at-a-glance metric tile. Token-driven surface, optional
 * leading icon, optional link. Server-component friendly.
 */
export function StatCard({
  label,
  value,
  hint,
  accent = "muted",
  href,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: Accent;
  href?: string;
  icon?: ReactNode;
}) {
  const inner = (
    <div
      className={`rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 ${
        href ? "admin-card-interactive" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
          {label}
        </p>
        {icon ? (
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-[var(--admin-radius)] text-sm ${ICON_BG[accent]}`}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className={`mt-3 text-3xl font-bold tracking-tight ${ACCENTS[accent]}`}>
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-[var(--admin-text-faint)]">{hint}</p>
      ) : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}
