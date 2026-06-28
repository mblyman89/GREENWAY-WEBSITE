"use client";

/**
 * Route-level error boundary for the entire /admin section.
 *
 * Next.js renders this (instead of a blank crash screen) whenever a server or
 * client component under /admin throws during render. We show a calm, branded,
 * plain-language card with a "Try again" button (calls reset()) and a link back
 * to the dashboard — never a scary stack trace.
 *
 * STALE SERVER ACTION HARDENING
 * -----------------------------
 * After a new deployment ships, Next.js gives every Server Action a brand-new
 * internal ID. A browser tab that was left open *before* the deploy still holds
 * the OLD ids, so the first save/publish click throws:
 *   "Failed to find Server Action … was not found on the server …"
 * Nothing is actually broken — the tab is just stale. When we detect that exact
 * error we transparently reload the page once (which pulls the fresh action ids)
 * instead of showing the snag card. A one-shot sessionStorage guard prevents a
 * reload loop if something is genuinely wrong.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

const STALE_ACTION_SIGNATURES = [
  "Server Action",
  "was not found on the server",
  "Failed to find Server Action",
];

const RELOAD_GUARD_KEY = "gw-admin-stale-action-reloaded";

function looksLikeStaleAction(message?: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    (lower.includes("server action") &&
      (lower.includes("not found") || lower.includes("was not found"))) ||
    STALE_ACTION_SIGNATURES.every((sig) => message.includes(sig))
  );
}

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Decide ONCE during render (lazy initializer) whether this is a stale-action
  // error that we should silently auto-recover from. Computing it here — rather
  // than via setState inside an effect — keeps the render pure and avoids the
  // cascading-render lint rule. We also flip the one-shot sessionStorage guard
  // at the same time so a reload loop can't happen.
  const [autoRecovering] = useState(() => {
    if (!looksLikeStaleAction(error?.message)) return false;
    try {
      if (window.sessionStorage.getItem(RELOAD_GUARD_KEY) === "1") return false;
      window.sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
    } catch {
      // sessionStorage unavailable (private mode) → fall back to the card.
      return false;
    }
    return true;
  });

  useEffect(() => {
    // Log for debugging; the user only ever sees the friendly card/splash.
    console.error("[admin] route error:", error);

    if (autoRecovering) {
      // Small delay so the splash paints, then hard-reload to fetch the fresh
      // server-action ids from the newly-deployed build.
      const timer = window.setTimeout(() => {
        window.location.reload();
      }, 900);
      return () => window.clearTimeout(timer);
    }

    // Rendered the card (recovered or non-stale error) — clear the guard so a
    // genuinely-stale tab later can still auto-recover once.
    try {
      window.sessionStorage.removeItem(RELOAD_GUARD_KEY);
    } catch {
      /* ignore */
    }
  }, [error, autoRecovering]);

  if (autoRecovering) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-[#7ed957]/30 bg-[#7ed957]/[0.05] p-8 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[#7ed957]/30 border-t-[#7ed957]" />
          <h1 className="mt-5 text-lg font-semibold text-white">
            Refreshing the editor…
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-white/70">
            A newer version of the back office just shipped. We&apos;re loading
            it now — nothing was lost. This only takes a moment.
          </p>
        </div>
      </div>
    );
  }

  const staleHint = looksLikeStaleAction(error?.message);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-[#ffd700]/30 bg-[#ffd700]/[0.04] p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[#ffd700]/40 bg-[#ffd700]/10 text-2xl">
          ℹ️
        </div>
        <h1 className="mt-5 text-xl font-semibold text-white">
          This page hit a snag
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          {staleHint
            ? "A newer version of the back office is live. Click “Reload page” to pick it up — your live website is fine and nothing was lost."
            : "Don't worry — nothing was lost and your live website is fine. This is usually a brief hiccup. Try loading the page again, and if it keeps happening, head back to the dashboard."}
        </p>

        {error?.message && (
          <p className="mt-4 break-words rounded-lg bg-black/40 px-3 py-2 text-left font-mono text-xs text-white/50">
            {error.message}
            {error.digest ? ` (ref: ${error.digest})` : ""}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              try {
                window.sessionStorage.removeItem(RELOAD_GUARD_KEY);
              } catch {
                /* ignore */
              }
              if (staleHint) {
                window.location.reload();
              } else {
                reset();
              }
            }}
            className="rounded-lg bg-[#7ed957] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[#94e570]"
          >
            {staleHint ? "Reload page" : "Try again"}
          </button>
          <Link
            href="/admin"
            className="rounded-lg border border-white/15 px-5 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/5"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
