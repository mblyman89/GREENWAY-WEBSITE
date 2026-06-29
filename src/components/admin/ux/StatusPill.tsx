/**
 * StatusPill — consistent status colors across the whole admin.
 *
 * Brand status semantics (from the UX research):
 *   draft     → orange
 *   published → green
 *   archived  → grey
 *   error     → red
 *   warning   → gold
 *   info      → muted
 *   success   → green
 *   pending   → gold
 *
 * Pass a known `status` for automatic coloring, or an explicit `tone`.
 * Server-component friendly.
 */
import type { ReactNode } from "react";

type Tone = "draft" | "published" | "archived" | "error" | "warning" | "info" | "success" | "pending" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  draft: "bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]",
  published: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
  archived: "bg-white/10 text-[var(--admin-text-faint)]",
  error: "bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
  warning: "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
  info: "bg-white/10 text-[var(--admin-text-muted)]",
  success: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
  pending: "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
  neutral: "bg-white/10 text-[var(--admin-text-muted)]",
};

// Map common raw status strings to a tone so callers can pass DB values directly.
const STATUS_TO_TONE: Record<string, Tone> = {
  draft: "draft",
  staged: "draft",
  scheduled: "pending",
  uploaded: "info",
  processing: "pending",
  published: "published",
  active: "published",
  live: "published",
  archived: "archived",
  superseded: "archived",
  inactive: "archived",
  failed: "error",
  error: "error",
  warning: "warning",
  new: "pending",
  reviewed: "info",
  imported: "success",
  duplicate: "warning",
};

export function StatusPill({
  status,
  tone,
  children,
  className = "",
}: {
  status?: string;
  tone?: Tone;
  children?: ReactNode;
  className?: string;
}) {
  const resolvedTone: Tone =
    tone ?? (status ? STATUS_TO_TONE[status.toLowerCase()] ?? "neutral" : "neutral");
  const label = children ?? status ?? "";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONE_CLASSES[resolvedTone]} ${className}`}
    >
      {label}
    </span>
  );
}
