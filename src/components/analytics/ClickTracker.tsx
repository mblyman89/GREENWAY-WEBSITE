"use client";

/**
 * R47-S2 — counts presses on banner buttons (home carousel, shop banners,
 * page banners, specials and loyalty heroes).
 *
 * One document-level listener: when a link inside an element marked with
 * data-gw-place (see clickZoneAttrs) is pressed, it sends a small beacon to
 * /api/clicks and, when GA4 is on, the standard `select_promotion` event.
 *
 * Sends nothing when:
 *   - the browser has Global Privacy Control on;
 *   - the page is a private no-track page (also gated by <NoTrackGate>);
 *   - staff are previewing in Draft Mode (editable hooks on the page), so
 *     the owner's own test clicks do not pad the numbers.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isNoTrackPath } from "@/lib/analytics/no-track-paths";
import { deviceFromWidth } from "@/lib/analytics/click-events-core";

type GtagFn = (command: "event", name: string, params: Record<string, unknown>) => void;

function gpcOn(): boolean {
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

function isStaffPreview(): boolean {
  return !!document.querySelector('[data-gw-editable="true"],[data-gw-design-frame="true"],[data-gw-edit-owner]');
}

export function ClickTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (isNoTrackPath(pathname) || pathname?.startsWith("/admin")) return;
    function onClick(e: MouseEvent) {
      try {
        const target = e.target as Element | null;
        const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!link) return;
        const zone = link.closest("[data-gw-place]") as HTMLElement | null;
        if (!zone) return;
        if (gpcOn() || isStaffPreview()) return;
        const pos = zone.dataset.gwPos;
        const payload = {
          page_path: window.location.pathname,
          placement: zone.dataset.gwPlace,
          slot_key: zone.dataset.gwSlot ?? null,
          slot_label: zone.dataset.gwLabel ?? null,
          slot_position: pos === undefined ? null : Number(pos),
          button_label: (link.innerText || link.getAttribute("aria-label") || "").trim().slice(0, 120),
          target_href: link.getAttribute("href"),
          device: deviceFromWidth(window.innerWidth),
        };
        const body = JSON.stringify(payload);
        // text/plain keeps the beacon CORS-simple (no pre-flight).
        const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
        let sent = false;
        if (typeof navigator.sendBeacon === "function") sent = navigator.sendBeacon("/api/clicks", blob);
        if (!sent) {
          void fetch("/api/clicks", {
            method: "POST",
            body,
            keepalive: true,
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
          }).catch(() => undefined);
        }
        const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
        if (typeof gtag === "function") {
          gtag("event", "select_promotion", {
            creative_name: payload.button_label || undefined,
            creative_slot: [payload.placement, pos].filter(Boolean).join(":"),
            promotion_id: payload.slot_key || undefined,
            promotion_name: payload.slot_label || undefined,
          });
        }
      } catch {
        // Never let analytics break a click.
      }
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [pathname]);

  return null;
}
