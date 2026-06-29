/**
 * EmptyState — friendly "nothing here yet" panel (per NN/g guidance).
 *
 * An empty state must: (a) say what this area is, (b) say why it's empty,
 * (c) give a button that starts the obvious next task. Never a blank container.
 *
 * Server-component friendly (no client hooks). Pass a Link or button as `action`.
 *
 * Usage:
 *   <EmptyState
 *     icon="📦"
 *     title="No menu uploaded yet"
 *     description="Upload your POS export to stage your first menu for review."
 *     action={<Link href="...">Upload now</Link>}
 *   />
 */
import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondary,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--admin-radius-lg)] border border-dashed border-[var(--admin-border-strong)] bg-white/[0.02] px-6 py-12 text-center">
      {icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--admin-accent-soft)] text-3xl">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-[var(--admin-text)]">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--admin-text-muted)]">{description}</p>
      )}
      {(action || secondary) && (
        <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row">
          {action}
          {secondary}
        </div>
      )}
    </div>
  );
}
