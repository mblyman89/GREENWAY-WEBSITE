import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Card — the one panel surface used across the back office.
 *
 * Replaces the five ad-hoc card backgrounds (#050505/#0a0a0a/#0d0d0d/#0f0f0f/
 * #0f1a10) with a single token-driven surface. Pass `interactive` for the
 * hover-lift used on clickable cards, or `href` to make the whole card a link.
 * Server-component friendly.
 */

export type CardPadding = "none" | "sm" | "md" | "lg";

const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6 sm:p-7",
};

export function Card({
  children,
  className = "",
  padding = "md",
  interactive = false,
  raised = false,
  href,
  accent,
}: {
  children: ReactNode;
  className?: string;
  padding?: CardPadding;
  interactive?: boolean;
  /** use the slightly lighter raised surface (nested panels) */
  raised?: boolean;
  href?: string;
  /** optional left accent stripe */
  accent?: "green" | "gold" | "orange";
}) {
  const accentBorder =
    accent === "green"
      ? "border-l-2 border-l-[var(--admin-accent)]"
      : accent === "gold"
        ? "border-l-2 border-l-[var(--admin-gold)]"
        : accent === "orange"
          ? "border-l-2 border-l-[var(--admin-orange)]"
          : "";

  const cls = [
    "rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]",
    raised ? "bg-[var(--admin-surface-2)]" : "bg-[var(--admin-surface)]",
    interactive || href ? "admin-card-interactive" : "",
    accentBorder,
    PADDING[padding],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (href) {
    return (
      <Link href={href} className={`block ${cls}`}>
        {children}
      </Link>
    );
  }
  return <div className={cls}>{children}</div>;
}

/** CardHeader — title row inside a Card, with optional action slot. */
export function CardHeader({
  title,
  subtitle,
  action,
  icon,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 ${className}`}
    >
      <div className="flex items-start gap-3">
        {icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--admin-radius)] bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]">
            {icon}
          </span>
        ) : null}
        <div>
          <h3 className="text-sm font-semibold text-[var(--admin-text)]">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-[var(--admin-text-faint)]">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
