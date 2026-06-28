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
  const base =
    variant === "primary"
      ? "bg-[#7ed957] text-black hover:brightness-110"
      : "border border-white/20 text-white/80 hover:border-[#7ed957] hover:text-white";
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${base} ${className}`}
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
