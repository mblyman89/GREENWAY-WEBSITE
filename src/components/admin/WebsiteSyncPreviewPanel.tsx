"use client";

/**
 * WebsiteSyncPreviewPanel — the standalone "Live preview" panel for the
 * Website Sync page's Preview tab (MIG-7 PR-A).
 *
 * This is a self-contained copy of the old Site Content preview: it wraps
 * PreviewFrame and lets staff pick which public page to preview, with desktop /
 * tablet / phone toggles and an "open in a new tab" link (all provided by
 * PreviewFrame). It reuses the SAME public preview page list (PREVIEW_PAGES)
 * that the Site Content editor used, so nothing about what-you-can-preview
 * changes.
 *
 * IMPORTANT — why there is no "✎ Edit → jump to a field" wiring here:
 * On the old Site Content page the preview sat directly above the editable
 * block list, so clicking a ✎ Edit hotspot could scroll/focus the matching
 * field. Website Sync is a read-only harmony dashboard with NO editable block
 * list next to it, so that jump would have nowhere to land. We therefore render
 * the preview WITHOUT an onEditBlock handler (PreviewFrame simply ignores the
 * ✎ Edit messages when none is passed). The preview itself — viewing every
 * public page exactly as visitors will, at any device size — is fully intact.
 */
import { useState } from "react";
import { PreviewFrame } from "@/components/admin/PreviewFrame";
import { PREVIEW_PAGES } from "@/components/admin/ContentPreviewPanel";

export function WebsiteSyncPreviewPanel() {
  const [activePath, setActivePath] = useState<string>(PREVIEW_PAGES[0].path);

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--admin-text)]">Live preview</h2>
          <p className="text-xs text-[var(--admin-text-muted)]">
            See every public page exactly as visitors will — including any
            unpublished draft changes. Pick a page, switch device sizes, or open
            it in a new tab.
          </p>
        </div>
        <div className="flex flex-wrap overflow-hidden rounded-[var(--admin-radius-sm)] border border-[var(--admin-border-strong)]">
          {PREVIEW_PAGES.map((p) => (
            <button
              key={p.path}
              type="button"
              onClick={() => setActivePath(p.path)}
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
      <PreviewFrame path={activePath} height={820} />
    </div>
  );
}
