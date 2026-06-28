/**
 * ErrorState — a friendly, plain-language error card (never a crash screen).
 *
 * Shows what went wrong in human terms, what to do next, and an optional retry.
 * Server-component friendly. Pair with the SafeData pattern: when a DB read
 * fails, render this instead of letting the page throw.
 *
 * Usage:
 *   <ErrorState
 *     title="We couldn't load your menu history"
 *     detail={error}
 *     hint="This is usually a brief connection hiccup. Try reloading."
 *   />
 */
import type { ReactNode } from "react";

export function ErrorState({
  title = "Something needs attention",
  hint,
  detail,
  action,
  tone = "warning",
}: {
  title?: string;
  hint?: ReactNode;
  detail?: string | null;
  action?: ReactNode;
  tone?: "warning" | "error";
}) {
  const palette =
    tone === "error"
      ? "border-red-500/30 bg-red-500/[0.06] text-red-300"
      : "border-[#ffd700]/30 bg-[#ffd700]/[0.05] text-[#ffd700]";

  return (
    <div className={`rounded-xl border p-5 ${palette}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg" aria-hidden="true">
          {tone === "error" ? "⚠️" : "ℹ️"}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          {hint && <p className="mt-1 text-sm opacity-80">{hint}</p>}
          {detail && (
            <p className="mt-2 break-words rounded bg-black/30 px-2 py-1 font-mono text-xs opacity-70">
              {detail}
            </p>
          )}
          {action && <div className="mt-4">{action}</div>}
        </div>
      </div>
    </div>
  );
}
