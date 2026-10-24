"use client";

/**
 * R66: keeps the onboarding page's batch lookup progress current without the
 * refresh button. router.refresh() re-renders the server component in place:
 * client state (an open AI Lookup panel, typed edits) is kept, nothing is
 * sent to the browser that the page did not already show.
 *
 * It only re-reads while the job is open, the tab is visible and nobody is
 * typing in a field (lookup-progress-core shouldAutoRefresh), and the person
 * can pause it. It stops by itself when the job finishes (the refreshed page
 * renders active=false).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BATCH_REFRESH_MS,
  BATCH_REFRESH_ON_COPY,
  BATCH_REFRESH_PAUSED_COPY,
  isEditingTag,
  shouldAutoRefresh,
} from "@/lib/catalog/lookup-progress-core";

export function BatchLookupAutoRefresh({ active, everyMs = BATCH_REFRESH_MS }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!active || paused) return;
    const id = window.setInterval(() => {
      const el = document.activeElement as HTMLElement | null;
      const go = shouldAutoRefresh({
        active,
        paused,
        visible: document.visibilityState === "visible",
        editing: isEditingTag(el?.tagName, el?.isContentEditable ?? false),
      });
      if (go) router.refresh();
    }, everyMs);
    return () => window.clearInterval(id);
  }, [active, paused, everyMs, router]);

  if (!active) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--admin-text-muted)]" data-testid="batch-lookup-autorefresh">
      <span>{paused ? BATCH_REFRESH_PAUSED_COPY : everyMs === BATCH_REFRESH_MS ? BATCH_REFRESH_ON_COPY : `Updates by itself every ${Math.round(everyMs / 60_000) || 1} min while this tab is open.`}</span>
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
