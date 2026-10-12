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
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
