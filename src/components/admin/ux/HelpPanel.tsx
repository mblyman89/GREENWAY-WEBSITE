"use client";

/**
 * HelpPanel — a collapsible "How this works" panel for the top of complex pages.
 *
 * Plain-language explanation of what a section does and the typical workflow,
 * written for a non-technical user. Collapsed by default (remembers per-page via
 * localStorage so a power user isn't nagged), expandable with one click.
 *
 * Usage:
 *   <HelpPanel
 *     id="menu-imports"
 *     title="How menu uploads work"
 *     steps={["Export the two files from your POS", "Upload them here", "Review", "Publish"]}
 *   />
 */
import { useEffect, useState, type ReactNode } from "react";

export function HelpPanel({
  id,
  title = "How this works",
  children,
  steps,
  defaultOpen = false,
}: {
  id: string;
  title?: string;
  children?: ReactNode;
  steps?: string[];
  defaultOpen?: boolean;
}) {
  const storageKey = `gw-help-${id}`;
  const [open, setOpen] = useState(defaultOpen);

  // Restore remembered open/closed state on mount.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved !== null) setOpen(saved === "1");
    } catch {
      // localStorage may be unavailable; fall back to defaultOpen.
    }
  }, [storageKey]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // ignore storage write failures
      }
      return next;
    });
  }

  return (
    <div className="rounded-xl border border-[#7ed957]/20 bg-[#7ed957]/[0.04]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-[#7ed957]">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#7ed957]/40 text-xs">
            i
          </span>
          {title}
        </span>
        <span className="text-xs text-[#7ed957]/70">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4 text-sm leading-relaxed text-white/70">
          {children}
          {steps && steps.length > 0 && (
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#7ed957]/15 text-xs font-bold text-[#7ed957]">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
