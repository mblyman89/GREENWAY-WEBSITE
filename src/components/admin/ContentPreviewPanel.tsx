"use client";

/**
 * ContentPreviewPanel — wraps PreviewFrame for the Site Content editor.
 *
 * Lets the editor pick which public page to preview. The selected page is
 * CONTROLLED by the parent shell so it stays in sync with the editor's page
 * filter below — that's what makes "click ✎ Edit in the preview → jump to the
 * field" work reliably regardless of which page was showing in the list.
 */
import { PreviewFrame } from "@/components/admin/PreviewFrame";

export type PreviewPage = { label: string; path: string; page: string };

/** Public pages that have editable content, mapped to their content `page` key. */
export const PREVIEW_PAGES: PreviewPage[] = [
  { label: "Homepage", path: "/", page: "home" },
  { label: "Menu", path: "/menu", page: "menu" },
  { label: "Loyalty", path: "/loyalty", page: "loyalty" },
  { label: "Specials", path: "/specials", page: "specials" },
  { label: "Vendors", path: "/vendor-delivery", page: "vendors" },
  { label: "FAQ", path: "/faq", page: "faq" },
];

export function ContentPreviewPanel({
  activePath,
  onSelectPath,
  onEditBlock,
}: {
  activePath: string;
  onSelectPath: (path: string) => void;
  onEditBlock: (blockKey: string) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Live preview</h2>
          <p className="text-xs text-white/50">
            See your draft changes exactly as visitors will. Click{" "}
            <span className="text-[#7ed957]">✎ Edit</span> on any highlighted
            text or image to jump straight to it below.
          </p>
        </div>
        <div className="flex flex-wrap overflow-hidden rounded-lg border border-white/15">
          {PREVIEW_PAGES.map((p) => (
            <button
              key={p.path}
              type="button"
              onClick={() => onSelectPath(p.path)}
              className={`px-3 py-1.5 text-xs transition ${
                activePath === p.path
                  ? "bg-[#7ed957] text-black"
                  : "text-white/60 hover:bg-white/5"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <PreviewFrame path={activePath} onEditBlock={onEditBlock} height={560} />
    </div>
  );
}
