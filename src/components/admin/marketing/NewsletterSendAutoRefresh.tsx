"use client";

/**
 * D237 N-2 (G-112): while a newsletter broadcast is still going out, the
 * Send Center re-reads its progress every 15 seconds (router.refresh keeps
 * the page in place). It only runs while a send is open and the tab is
 * visible, and the person can pause it. Sending does not depend on this
 * page being open — the server keeps going on its own.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export const NEWSLETTER_REFRESH_MS = 15_000;

export function NewsletterSendAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!active || paused) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, NEWSLETTER_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [active, paused, router]);

  if (!active) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--admin-text-muted)]" data-testid="newsletter-send-autorefresh">
      <span>{paused ? "Updates paused." : "Updates by itself every 15 seconds while this tab is open."}</span>
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        className="rounded border border-[var(--admin-border)] px-1.5 py-0.5 hover:border-[var(--admin-accent)]"
        aria-pressed={paused}
      >
        {paused ? "Resume" : "Pause"}
      </button>
    </p>
  );
}
