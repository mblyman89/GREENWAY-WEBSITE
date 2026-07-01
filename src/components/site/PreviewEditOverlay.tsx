"use client";

/**
 * PreviewEditOverlay — runs ONLY on the public site while a staff member is
 * previewing (Draft Mode on). It finds every element tagged with
 * `data-gw-block` (rendered by <SiteText>) and overlays a small "✎ Edit"
 * affordance. Clicking it deep-links to the exact field in the admin content
 * editor.
 *
 * It also renders a slim top banner so the previewer always knows they're in
 * preview mode and can exit back to the published site.
 *
 * Communicates with a parent admin window (the PreviewFrame) via postMessage so
 * "Edit" can open the editor in the admin shell rather than navigating the
 * iframe.
 */
import { useEffect, useState } from "react";

type Hotspot = {
  key: string;
  top: number;
  left: number;
  width: number;
};

const ADMIN_EDIT_BASE = "/admin/content";

export function PreviewEditOverlay({ path = "/" }: { path?: string }) {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [inFrame, setInFrame] = useState(false);
  const [badgeOpen, setBadgeOpen] = useState(false);

  useEffect(() => {
    setInFrame(window.self !== window.top);
  }, []);

  // Measure all editable blocks and (re)compute hotspot positions.
  useEffect(() => {
    function measure() {
      const els = Array.from(
        document.querySelectorAll<HTMLElement>("[data-gw-block]"),
      );
      const spots: Hotspot[] = els.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          key: el.getAttribute("data-gw-block") ?? "",
          top: r.top + window.scrollY,
          left: r.left + window.scrollX,
          width: r.width,
        };
      });
      setHotspots(spots);
    }

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    const t = setInterval(measure, 1500); // catch late layout shifts
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
      clearInterval(t);
    };
  }, []);

  function edit(blockKey: string) {
    const target = `${ADMIN_EDIT_BASE}?block=${encodeURIComponent(blockKey)}`;
    if (inFrame && window.parent) {
      // Ask the admin shell (PreviewFrame parent) to open the editor.
      window.parent.postMessage(
        { type: "gw-preview-edit", blockKey, target },
        window.location.origin,
      );
    } else {
      window.location.href = target;
    }
  }

  return (
    <>
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

      {/* Edit hotspots */}
      {hotspots.map((spot) => (
        <button
          key={spot.key}
          type="button"
          onClick={() => edit(spot.key)}
          aria-label={`Edit ${spot.key}`}
          style={{
            position: "absolute",
            top: spot.top - 12,
            left: spot.left,
            zIndex: 9999,
          }}
          className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-[#7ed957] bg-black/85 px-2 py-0.5 text-[11px] font-semibold text-[#7ed957] shadow-lg shadow-black/40 transition hover:bg-[#7ed957] hover:text-black"
        >
          ✎ Edit
        </button>
      ))}
    </>
  );
}
