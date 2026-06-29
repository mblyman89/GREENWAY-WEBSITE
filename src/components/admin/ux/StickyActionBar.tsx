"use client";

/**
 * StickyActionBar — an always-reachable bar pinned to the bottom of the
 * viewport that holds the primary actions for an editing screen
 * (Save draft / Publish / Cancel). On long forms the employee never has to
 * scroll back up to find the buttons.
 *
 * Design principle: "confidence through feedback." The bar can show a small
 * status string (e.g. "Unsaved changes" / "All changes saved") so the user
 * always knows where they stand.
 *
 * Usage:
 *   <StickyActionBar
 *     status={dirty ? "Unsaved changes" : "All changes saved"}
 *     statusTone={dirty ? "warning" : "success"}
 *   >
 *     <button onClick={onCancel}>Cancel</button>
 *     <button onClick={onSaveDraft}>Save draft</button>
 *     <button onClick={onPublish}>Publish</button>
 *   </StickyActionBar>
 *
 * Tip: add `pb-24` (or similar) to the page content so the bar never hides
 * the last form field.
 */
import type { ReactNode } from "react";

type StatusTone = "neutral" | "success" | "warning" | "error";

const STATUS_DOT: Record<StatusTone, string> = {
  neutral: "bg-white/40",
  success: "bg-[#7ed957]",
  warning: "bg-[#ffd700]",
  error: "bg-red-500",
};

const STATUS_TEXT: Record<StatusTone, string> = {
  neutral: "text-white/60",
  success: "text-[#7ed957]",
  warning: "text-[#ffd700]",
  error: "text-red-300",
};

export function StickyActionBar({
  children,
  status,
  statusTone = "neutral",
  align = "end",
}: {
  children: ReactNode;
  status?: string;
  statusTone?: StatusTone;
  align?: "start" | "end" | "between";
}) {
  const justify =
    align === "between"
      ? "justify-between"
      : align === "start"
        ? "justify-start"
        : "justify-end";

  return (
    <div className="sticky bottom-0 left-0 right-0 z-40 -mx-4 mt-8 border-t border-[var(--admin-border)] bg-[var(--admin-surface)]/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        {status && (
          <span className="flex items-center gap-2 text-xs">
            <span
              className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[statusTone]}`}
              aria-hidden
            />
            <span className={STATUS_TEXT[statusTone]}>{status}</span>
          </span>
        )}
        <div className={`flex flex-1 flex-wrap items-center gap-3 ${justify}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
