"use client";
/**
 * DismissibleBanner  (Fix Phase 3.4 · F-04-25)
 *
 * Owner, verbatim: "i want to be able to dismiss the warnings and other
 * banners at the top of the page."
 *
 * Wraps any banner with an × button. A result banner (one page load) hides
 * for this view. A standing warning passes `rememberKey` (e.g. "overdue:3"):
 * dismissing it is remembered in this browser until the key changes - a NEW
 * overdue manifest or a new failed email shows the banner again, so a fresh
 * problem is never hidden by an old dismissal.
 */
import { useEffect, useState, type ReactNode } from "react";

const PREFIX = "gw.dismissed.";

export function DismissibleBanner({
  children,
  rememberKey,
  className,
  testId,
}: {
  children: ReactNode;
  rememberKey?: string;
  className: string;
  testId?: string;
}) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!rememberKey) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of localStorage after hydration (not available on the server)
      if (window.localStorage.getItem(PREFIX + rememberKey) === "1") setHidden(true);
    } catch {
      /* storage blocked: the banner just shows */
    }
  }, [rememberKey]);
  if (hidden) return null;
  return (
    <div data-testid={testId} className={`relative pr-9 ${className}`}>
      {children}
      <button
        type="button"
        aria-label="Dismiss"
        title={rememberKey ? "Dismiss (comes back if something new happens)" : "Dismiss"}
        data-testid="banner-dismiss"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (rememberKey) {
            try {
              window.localStorage.setItem(PREFIX + rememberKey, "1");
            } catch {
              /* ignore */
            }
          }
          setHidden(true);
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 text-base leading-none opacity-70 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

/**
 * A section that starts COLLAPSED and opens itself when the page is reached
 * through its #anchor (the "Open Needs attention" banner link).
 */
export function CollapsedUntilLinked({
  id,
  summary,
  children,
  className,
  testId,
}: {
  id: string;
  summary: ReactNode;
  children: ReactNode;
  className: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => {
      if (window.location.hash === `#${id}`) setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [id]);
  return (
    <details
      id={id}
      data-testid={testId}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className={className}
    >
      <summary className="cursor-pointer list-none">{summary}</summary>
      {children}
    </details>
  );
}
