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
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--admin-text)]">Live preview</h2>
          <p className="text-xs text-[var(--admin-text-muted)]">
            See your draft changes exactly as visitors will. Click{" "}
            <span className="text-[var(--admin-accent)]">✎ Edit</span> on any highlighted
            text or image to jump straight to it below.
          </p>
        </div>
        <div className="flex flex-wrap overflow-hidden rounded-[var(--admin-radius-sm)] border border-[var(--admin-border-strong)]">
          {PREVIEW_PAGES.map((p) => (
            <button
              key={p.path}
              type="button"
              onClick={() => onSelectPath(p.path)}
              className={`admin-focus px-3 py-1.5 text-xs transition ${
                activePath === p.path
                  ? "bg-[var(--admin-accent)] font-semibold text-black"
                  : "text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]"
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
