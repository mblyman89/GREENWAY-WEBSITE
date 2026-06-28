"use client";

/**
 * ContentPreviewPanel — wraps PreviewFrame for the Site Content editor.
 *
 * Lets the editor pick which public page to preview, and when they click an
 * "✎ Edit" hotspot inside the preview, scrolls the editor to that block's form
 * and flashes it. Bridges the iframe's postMessage to the editor DOM.
 */
import { useCallback, useState } from "react";
import { PreviewFrame } from "@/components/admin/PreviewFrame";

const PAGES = [
  { label: "Homepage", path: "/" },
  { label: "Menu", path: "/menu" },
  { label: "Loyalty", path: "/loyalty" },
  { label: "Specials", path: "/specials" },
];

export function ContentPreviewPanel() {
  const [path, setPath] = useState(PAGES[0].path);

  const handleEditBlock = useCallback((blockKey: string) => {
    const el = document.getElementById(`block-${blockKey}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Brief highlight so the user sees which field opened.
    el.classList.add("ring-2", "ring-[#7ed957]");
    const ta = el.querySelector("textarea");
    if (ta) (ta as HTMLTextAreaElement).focus();
    setTimeout(() => {
      el.classList.remove("ring-2", "ring-[#7ed957]");
    }, 2000);
  }, []);

  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Live preview</h2>
          <p className="text-xs text-white/50">
            See your draft changes exactly as visitors will. Click{" "}
            <span className="text-[#7ed957]">✎ Edit</span> on any highlighted
            text to jump to it.
          </p>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-white/15">
          {PAGES.map((p) => (
            <button
              key={p.path}
              type="button"
              onClick={() => setPath(p.path)}
              className={`px-3 py-1.5 text-xs transition ${
                path === p.path
                  ? "bg-[#7ed957] text-black"
                  : "text-white/60 hover:bg-white/5"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <PreviewFrame path={path} onEditBlock={handleEditBlock} height={560} />
    </div>
  );
}
