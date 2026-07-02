"use client";

/**
 * src/components/admin/ai/AiBusyButton.tsx
 *
 * A submit button for AI server-action forms that shows a spinner + "Working…"
 * label while the action runs, using React's useFormStatus. Prevents
 * double-submits and gives the slow-by-nature AI calls clear feedback.
 *
 * Drop it inside any <form action={serverAction}>:
 *   <AiBusyButton idleLabel="✨ Draft with AI" busyLabel="Drafting…" />
 */
import { useFormStatus } from "react-dom";

export function AiBusyButton({
  idleLabel,
  busyLabel = "Working…",
  variant = "primary",
  className = "",
}: {
  idleLabel: React.ReactNode;
  busyLabel?: string;
  variant?: "primary" | "ghost";
  className?: string;
}) {
  const { pending } = useFormStatus();
  // Solid fills only (no transparent/bordered buttons). AI actions are a
  // positive "go" action, so primary uses brand green; the secondary form uses
  // a solid dark neutral chip.
  const base =
    variant === "primary"
      ? "bg-[var(--admin-accent)] text-black shadow-[var(--admin-shadow-sm)] hover:brightness-110"
      : "bg-[var(--admin-surface-2)] text-[var(--admin-text)] shadow-[var(--admin-shadow-sm)] hover:bg-[var(--admin-surface-hover)]";
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-black uppercase tracking-[0.1em] transition disabled:cursor-not-allowed disabled:opacity-60 ${base} ${className}`}
    >
      {pending ? (
        <>
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {busyLabel}
        </>
      ) : (
        idleLabel
      )}
    </button>
  );
}
