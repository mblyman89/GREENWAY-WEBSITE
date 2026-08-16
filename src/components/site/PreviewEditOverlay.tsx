"use client";

/**
 * PreviewEditOverlay — runs ONLY on the public site while a staff member is
 * previewing (Draft Mode on). It finds every element tagged with
 * `data-gw-block` (rendered by <SiteText>) and overlays a small "✎ Edit"
 * affordance. Clicking it deep-links to the exact field in the admin content
 * editor.
 *
 * NOTE (MIG-7 PR-B): the "✎ Edit" pencils are currently TURNED OFF via the
 * `HOTSPOTS_ENABLED` flag below -- their only jump target (the Site Content
 * page) was retired and there is no per-editor jump-to-field surface yet. The
 * feature is left fully intact (flip the flag to switch it back on). The
 * preview-mode badge / Exit control is unaffected.
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

/**
 * "Edit this field" jump-to hotspots are TURNED OFF for now (MIG-7 PR-B).
 *
 * The only place these pencils could jump to was the old Site Content page,
 * whose editor list is being retired. There is no per-editor "focus this exact
 * field" surface yet, so the pencils have nowhere meaningful to land. Rather
 * than delete the feature, we gate it behind this flag: the measuring effect,
 * the postMessage plumbing and the `edit()` navigation all stay intact and can
 * be switched back on (set to `true`) when we build the dedicated jump-to-field
 * feature on the individual editors. The Preview-mode badge (below) is NOT
 * affected -- staff still see they are in preview and can exit.
 */
const HOTSPOTS_ENABLED = false;

export function PreviewEditOverlay({ path = "/" }: { path?: string }) {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [badgeOpen, setBadgeOpen] = useState(false);

  // Measure all editable blocks and (re)compute hotspot positions.
  useEffect(() => {
    if (!HOTSPOTS_ENABLED) return; // pencils turned off (MIG-7 PR-B)
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
    // Read the frame relationship at CLICK time rather than mirroring it into
    // state from an effect. It is only ever needed inside this handler (never
    // rendered), so state + an effect would be pure overhead -- and setting
    // state from an effect is what react-hooks/set-state-in-effect flags.
    const inFrame = window.self !== window.top;
    if (inFrame && window.parent) {
      // Ask the admin shell (PreviewFrame parent) to open the editor.
      window.parent.postMessage(
        { type: "gw-preview-edit", blockKey, target },
        window.location.origin,
      );
    } else {
      // .assign() is a method call, not a property mutation, so it does not
      // trip react-hooks/immutability. Behavior is identical to setting
      // location.href (same-document navigation, adds a history entry).
      window.location.assign(target);
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

      {/* Edit hotspots -- OFF for now (HOTSPOTS_ENABLED=false, MIG-7 PR-B).
          Kept intact so the jump-to-field feature can be switched back on. */}
      {HOTSPOTS_ENABLED &&
        hotspots.map((spot) => (
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
