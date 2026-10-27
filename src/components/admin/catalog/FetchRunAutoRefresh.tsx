"use client";

/**
 * R50 S9: refreshes the fetch-run page while the harvest runs (router.refresh
 * re-renders the server component; no client state, no secrets in the browser).
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function FetchRunAutoRefresh({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    // PERF-S12: skip the server re-render while the tab is hidden; catch up
    // with one refresh when the tab becomes visible again.
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, everyMs, router]);
  return null;
}
