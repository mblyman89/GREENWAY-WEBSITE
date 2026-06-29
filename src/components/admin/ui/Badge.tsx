import type { ReactNode } from "react";

/**
 * Badge — small, neutral/informational label (counts, "Soon", "locked",
 * category tags). For lifecycle status (draft/published/etc.) use StatusPill
 * from @/components/admin/ux instead. Server-component friendly.
 */

export type BadgeTone =
  | "neutral"
  | "green"
  | "gold"
  | "orange"
  | "danger"
  | "outline";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-white/10 text-[var(--admin-text-muted)]",
  green: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
  gold: "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
  orange: "bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]",
  danger: "bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
  outline:
    "border border-[var(--admin-border-strong)] text-[var(--admin-text-muted)]",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[var(--admin-radius-sm)] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
