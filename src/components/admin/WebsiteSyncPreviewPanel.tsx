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
import { useCallback, useState, useTransition } from "react";
import { PreviewFrame } from "@/components/admin/PreviewFrame";
import { PREVIEW_PAGES } from "@/components/admin/ContentPreviewPanel";
import { useToast } from "@/components/admin/ux";
import { saveDesignMoveAction, type DesignMoveResult } from "@/app/admin/website-sync/design-actions";
import type { DesignMove } from "@/lib/cms/banner-design-core";

/**
 * R41 S7 "Move mode": when `canMove` (content.edit), a toggle lets the owner
 * drag the text boxes and buttons of any banner that has Custom design turned
 * on, right inside this preview. Each drop is saved as a DRAFT by
 * saveDesignMoveAction (server re-validates + checks permission), then the
 * preview reloads. Nothing goes live until Publish in that banner's editor.
 */
export function WebsiteSyncPreviewPanel({ canMove = false, initialPath }: { canMove?: boolean; initialPath?: string }) {
  const [activePath, setActivePath] = useState<string>(
    PREVIEW_PAGES.some((p) => p.path === initialPath) ? (initialPath as string) : PREVIEW_PAGES[0].path,
  );
  const [moveMode, setMoveMode] = useState(false);
  const [movable, setMovable] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [last, setLast] = useState<DesignMoveResult | null>(null);
  const [saving, startSaving] = useTransition();
  const { toast } = useToast();

  const onDesignMove = useCallback(
    (move: DesignMove & { owner: string }) => {
      startSaving(async () => {
        let res: DesignMoveResult;
        try {
          res = await saveDesignMoveAction({ type: "gw-design-move", ...move });
        } catch {
          res = { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
        }
        setLast(res);
        toast({ tone: res.ok ? "success" : "error", message: res.message });
        setMovable(null);
        setReload((n) => n + 1); // show the saved draft (or snap back on error)
      });
    },
    [toast],
  );

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
              onClick={() => {
                setActivePath(p.path);
                setMovable(null);
              }}
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
      {canMove ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-3 py-2">
          <button
            type="button"
            role="switch"
            aria-checked={moveMode}
            onClick={() => {
              setMoveMode((v) => !v);
              setMovable(null);
            }}
            className={`admin-focus rounded-[var(--admin-radius-sm)] border px-3 py-1.5 text-xs font-semibold transition ${
              moveMode
                ? "border-[var(--admin-accent)] bg-[var(--admin-accent)] text-black"
                : "border-[var(--admin-border-strong)] text-[var(--admin-text)] hover:bg-[var(--admin-surface-hover)]"
            }`}
          >
            ✥ Move mode: {moveMode ? "On" : "Off"}
          </button>
          <p className="min-w-0 flex-1 text-xs text-[var(--admin-text-muted)]" aria-live="polite">
            {saving
              ? "Saving your move as a draft…"
              : !moveMode
                ? "Turn on to drag text and buttons on banners right here. Moves save as drafts — nothing goes live until you Publish."
                : movable === 0
                  ? "Nothing on this page can be moved yet. Open the banner's editor and turn on “Custom design (optional)” first, save, then come back."
                  : movable
                    ? `${movable} movable item${movable === 1 ? "" : "s"} outlined in green. Use the Phone size to move the phone layout separately.`
                    : "Looking for movable items…"}
          </p>
          {last?.ok && last.editorHref ? (
            <a
              href={last.editorHref}
              className="admin-focus text-xs font-semibold text-[var(--admin-accent)] underline underline-offset-2"
            >
              Publish in {last.editorLabel} →
            </a>
          ) : null}
        </div>
      ) : null}
      <PreviewFrame
        path={activePath}
        height={820}
        moveMode={canMove && moveMode}
        onDesignMove={canMove ? onDesignMove : undefined}
        onMoveReady={setMovable}
        reloadSignal={reload}
      />
    </div>
  );
}
