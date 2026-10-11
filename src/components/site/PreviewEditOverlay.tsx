"use client";

/**
 * PreviewEditOverlay — runs ONLY on the public site while a staff member is
 * previewing (Draft Mode on). R43 brings back the green "✎ Edit" buttons:
 *
 *   - every `data-gw-block` (a single content field: SiteText, FAQ, hero text…)
 *   - every banner tagged `data-gw-design-owner` / `data-gw-edit-owner`
 *     (custom-design banners, classic section banners, shop slides, Specials hero)
 *   - every named area tagged `data-gw-edit-area` (home carousel, type cards,
 *     weekly deal cards…)
 *
 * gets a small green pill. Clicking it opens `/admin/edit?block|owner|area=…`
 * (built by the import-free edit-link-core so the public bundle stays light);
 * that admin route works out exactly which editor owns the item and lands on
 * the field / card, with a "← Back to preview" pill.
 *
 * Inside the Website Hub preview iframe the click is posted to the parent
 * (PreviewFrame) so the WHOLE admin window navigates, not the iframe. On the
 * live site in preview mode it navigates the tab directly.
 *
 * Pills hide while the hub's "Move mode" is on (so they never block a drag),
 * and can be hidden/shown from the Preview badge (remembered per browser).
 */
import { useEffect, useState } from "react";
import { PreviewDesignDrag } from "./PreviewDesignDrag";
import {
  AREA_BUTTON_LABEL,
  bannerCoversBlock,
  editSpotLabel,
  overlayEditHref,
  type EditSpot,
} from "@/lib/cms/edit-link-core";

type Hotspot = {
  id: string;
  spot: EditSpot;
  text: string;
  label: string;
  top: number;
  left: number;
};

const PILLS_PREF_KEY = "gw-edit-pills";
const BANNER_SEL = "[data-gw-design-owner],[data-gw-edit-owner]";

/** Measure every editable thing on the page (document coordinates). */
function measureSpots(): Hotspot[] {
  const out: Hotspot[] = [];
  const seen = new Set<string>();
  const taken: { top: number; left: number }[] = [];
  const push = (el: HTMLElement, spot: EditSpot, text: string, inset: boolean) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return; // hidden variant (e.g. desktop art on phone)
    let top = r.top + window.scrollY + (inset ? 8 : -12);
    let left = r.left + window.scrollX + (inset ? 8 : 0);
    const id = `${spot.block ?? ""}|${spot.owner ?? ""}|${spot.area ?? ""}|${Math.round(top)}|${Math.round(left)}`;
    if (seen.has(id)) return;
    seen.add(id);
    // Nudge pills that would sit on top of another pill.
    for (let i = 0; i < 6 && taken.some((t) => Math.abs(t.top - top) < 22 && Math.abs(t.left - left) < 120); i++) {
      left += 124;
    }
    if (left > window.scrollX + window.innerWidth - 130) {
      left = Math.max(window.scrollX + 4, r.left + window.scrollX);
      top += 24;
    }
    taken.push({ top, left });
    out.push({ id, spot, text, label: editSpotLabel(spot), top: Math.max(top, 0), left });
  };

  document.querySelectorAll<HTMLElement>("[data-gw-edit-area]").forEach((el) => {
    const area = el.getAttribute("data-gw-edit-area") ?? "";
    if (AREA_BUTTON_LABEL[area]) push(el, { area }, AREA_BUTTON_LABEL[area], true);
  });
  document.querySelectorAll<HTMLElement>(BANNER_SEL).forEach((el) => {
    const owner = el.getAttribute("data-gw-design-owner") || el.getAttribute("data-gw-edit-owner") || "";
    if (owner) push(el, { owner }, "✎ Edit banner", true);
  });
  document.querySelectorAll<HTMLElement>("[data-gw-block]").forEach((el) => {
    const block = el.getAttribute("data-gw-block") ?? "";
    if (!block) return;
    // A surrounding banner's pill already covers these (avoid duplicate pills).
    if (bannerCoversBlock(block) && el.closest(BANNER_SEL)) return;
    push(el, { block }, "✎ Edit", false);
  });
  return out;
}

export function PreviewEditOverlay({ path = "/" }: { path?: string }) {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [moveOn, setMoveOn] = useState(false);
  const [pillsOn, setPillsOn] = useState(true);

  // Remembered show/hide preference (read after mount; deferred so the mount
  // effect never sets state synchronously).
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        if (window.localStorage.getItem(PILLS_PREF_KEY) === "off") setPillsOn(false);
      } catch {
        /* storage blocked: keep default (on) */
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  // The hub's Move mode (same message PreviewDesignDrag listens to).
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const data = e.data as { type?: string; on?: unknown } | null;
      if (data?.type === "gw-move-mode") setMoveOn(data.on === true);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const active = pillsOn && !moveOn;

  // Measure all editable things and (re)compute pill positions.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setHotspots(measureSpots()));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    const t = window.setInterval(measure, 1500); // catch late layout shifts / carousels
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
      window.clearInterval(t);
    };
  }, [active]);

  function togglePills() {
    setPillsOn((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(PILLS_PREF_KEY, next ? "on" : "off");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function edit(spot: EditSpot) {
    // Read the frame relationship at CLICK time (never rendered, so no state).
    const inFrame = window.self !== window.top;
    const target = overlayEditHref(spot, {
      from: inFrame ? "hub" : "site",
      path: window.location.pathname || path,
    });
    if (inFrame && window.parent) {
      // Ask the admin shell (PreviewFrame parent) to open the editor in the
      // whole admin window rather than inside the preview iframe.
      window.parent.postMessage(
        { type: "gw-preview-edit", blockKey: spot.block, target },
        window.location.origin,
      );
    } else {
      // .assign() is a method call (no react-hooks/immutability trip).
      window.location.assign(target);
    }
  }

  return (
    <>
      {/* R41 S7: inert until the Website Sync preview turns "Move mode" on. */}
      <PreviewDesignDrag />
      {/* Preview badge — bottom-right, glowing. Replaces the old full-width top
          banner so it no longer covers the header tabs. Click to expand for the
          Exit control; the glow signals preview mode at a glance. */}
      <div className="fixed bottom-4 right-4 z-[9998] flex flex-col items-end gap-2">
        {badgeOpen && (
          <div className="w-64 rounded-xl border border-[#7ed957]/50 bg-black/90 p-3 text-xs text-white shadow-2xl shadow-black/50 backdrop-blur">
            <p className="font-semibold text-[#7ed957]">👁 Preview mode</p>
            <p className="mt-1 leading-relaxed text-white/70">
              You&apos;re seeing unpublished drafts. Changes here are not live
              until you publish them in the admin.
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={pillsOn}
              onClick={togglePills}
              className="mt-3 block w-full rounded-lg border border-[#7ed957]/60 px-3 py-1.5 text-center text-xs font-semibold text-[#7ed957] transition hover:bg-[#7ed957]/10"
            >
              ✎ Edit buttons: {pillsOn ? "On" : "Off"}
            </button>
            {moveOn ? (
              <p className="mt-1 text-[10px] text-white/50">Hidden while Move mode is on.</p>
            ) : null}
            <a
              href={`/api/admin/preview/disable?path=${encodeURIComponent(path)}`}
              className="mt-3 block rounded-lg bg-[#7ed957] px-3 py-1.5 text-center text-xs font-semibold text-black transition hover:bg-[#94e570]"
            >
              Exit preview
            </a>
            <p className="mt-2 text-center text-[10px] text-white/40">
              To re-enter preview later, open the page from the admin editor.
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => setBadgeOpen((v) => !v)}
          aria-label={badgeOpen ? "Collapse preview badge" : "Preview mode — expand for options"}
          title="Preview mode"
          className="gw-preview-badge flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold text-black transition"
        >
          <span aria-hidden="true">👁</span>
          <span>Preview</span>
          <span
            className={`text-[9px] transition-transform ${badgeOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
      </div>

      {/* R43: green "✎ Edit" pills (hidden in Move mode or when toggled off). */}
      {active &&
        hotspots.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => edit(h.spot)}
            aria-label={h.label}
            title={h.label}
            style={{ position: "absolute", top: h.top, left: h.left, zIndex: 9997 }}
            className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-[#7ed957] bg-black/85 px-2 py-0.5 text-[11px] font-semibold text-[#7ed957] shadow-lg shadow-black/40 transition hover:bg-[#7ed957] hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7ed957]"
          >
            {h.text}
          </button>
        ))}
    </>
  );
}
