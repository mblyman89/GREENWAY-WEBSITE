"use client";

/**
 * R59-S4 — measures real page speed (Core Web Vitals) in the shopper's own
 * browser and sends ONE small beacon per page view to /api/vitals when the
 * page is hidden (tab switched, closed or navigated away), as Google
 * recommends — so INP and CLS are final.
 *
 * Sends nothing when Global Privacy Control is on, on admin / no-track pages
 * (also gated by <NoTrackGate>), or from staff previews (Draft Mode hooks).
 * Client-side navigations start a new batch for the new page.
 */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { isNoTrackPath } from "@/lib/analytics/no-track-paths";

/** `sent`: each metric goes once per page view (a later re-report after the tab comes back is ignored, no double counting). */
type Batch = { page_path: string; nav_type?: string; metrics: Map<string, number>; sent: Set<string> };

const off = (path: string | null) =>
  !path ||
  isNoTrackPath(path) ||
  path.startsWith("/admin") ||
  (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true ||
  !!document.querySelector('[data-gw-editable="true"],[data-gw-design-frame="true"],[data-gw-edit-owner]');

function send(b: Batch | null) {
  if (!b || !b.metrics.size) return;
  const body = JSON.stringify({
    page_path: b.page_path,
    device_width: window.innerWidth,
    nav_type: b.nav_type,
    metrics: [...b.metrics].map(([name, value]) => ({ name, value })),
  });
  for (const k of b.metrics.keys()) b.sent.add(k);
  b.metrics.clear();
  try {
    const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
    if (navigator.sendBeacon?.("/api/vitals", blob)) return;
    void fetch("/api/vitals", { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain;charset=UTF-8" } }).catch(() => undefined);
  } catch {
    /* never let analytics break the page */
  }
}

export function VitalsReporter() {
  const pathname = usePathname();
  const batch = useRef<Batch | null>(null);

  useReportWebVitals((m) => {
    if (!["LCP", "INP", "CLS", "FCP", "TTFB"].includes(m.name)) return;
    const path = window.location.pathname;
    if (off(path)) return;
    if (!batch.current || batch.current.page_path !== path) {
      send(batch.current);
      batch.current = { page_path: path, nav_type: m.navigationType, metrics: new Map(), sent: new Set() };
    }
    if (!batch.current.sent.has(m.name)) batch.current.metrics.set(m.name, m.value);
  });

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") send(batch.current);
    };
    const onLeave = () => send(batch.current);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onLeave);
    };
  }, []);

  // Leaving a page inside the app: send what that page collected.
  useEffect(() => {
    if (batch.current && batch.current.page_path !== pathname) {
      send(batch.current);
      batch.current = null;
    }
  }, [pathname]);

  return null;
}
