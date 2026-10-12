"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { priorityVisibleCount } from "@/lib/site/priority-nav-core";

/**
 * PriorityNav — R49 S4 "Priority+" desktop navigation (see priority-nav-core).
 *
 * Renders the server-built nav links as-is, then hides the trailing links that
 * do not fit the space left between the logo and the Search / Cart / Menu
 * cluster. Every link stays reachable via the ☰ Menu button (visible at every
 * width). Re-measured on every resize (ResizeObserver) and once web fonts
 * finish loading, so it is correct on any screen, zoom level or font.
 *
 * Belt and braces: the container is `min-w-0 flex-1` (it can shrink to zero,
 * so it can never push the Cart button), items are `shrink-0 whitespace-nowrap`
 * (a link never squashes or wraps — it is shown whole or hidden), and until
 * the first measurement the nav is `overflow-x-clip`, so the server-rendered
 * HTML can never paint links over the Cart button before hydration. After
 * measuring, `data-fitted` lifts the clip so the hover dropdown panels (wider
 * than their link) are never cut off.
 */
export function PriorityNav({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  // Natural width of each item, cached while it is visible (a hidden item has
  // no width to measure).
  const widths = useRef<number[]>([]);

  useLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    let frame = 0;

    const fit = () => {
      const items = Array.from(nav.children) as HTMLElement[];
      items.forEach((el, i) => {
        if (el.style.display !== "none") widths.current[i] = el.getBoundingClientRect().width;
      });
      const style = getComputedStyle(nav);
      const gap = parseFloat(style.columnGap || style.gap || "0") || 0;
      const visible = priorityVisibleCount(widths.current.slice(0, items.length), gap, nav.clientWidth);
      items.forEach((el, i) => {
        const hide = i >= visible;
        el.style.display = hide ? "none" : "";
        if (hide) el.setAttribute("aria-hidden", "true");
        else el.removeAttribute("aria-hidden");
      });
      // Measured: nothing overflows any more, so lift the pre-hydration clip
      // (the hover dropdown panels are wider than their link and must not be cut).
      nav.dataset.fitted = "true";
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };

    fit();
    const observer = new ResizeObserver(schedule);
    observer.observe(nav);
    // Web fonts change link widths once loaded.
    document.fonts?.ready.then(() => {
      // Re-measure from scratch with every item visible.
      Array.from(nav.children).forEach((el) => ((el as HTMLElement).style.display = ""));
      fit();
    }).catch(() => undefined);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <nav ref={ref} className={className} aria-label="Primary navigation">
      {children}
    </nav>
  );
}
