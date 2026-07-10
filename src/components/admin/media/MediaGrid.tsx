"use client";

/**
 * src/components/admin/media/MediaGrid.tsx — Task B (bulk media delete).
 *
 * A client wrapper around the Media Library grid that adds a multi-select mode
 * with per-card checkboxes and a "Delete selected" action bar. When NOT in
 * select mode the cards behave exactly as before (each is a Link into the
 * detail page, carrying the active filters). In select mode, clicking a card
 * toggles its checkbox instead of navigating, so the owner can quickly pick
 * several items and delete them in one action.
 *
 * The actual deletion runs server-side (bulkDeleteMediaAction), which guards
 * every asset the same way the single delete does — anything still in use is
 * skipped, never force-deleted.
 */

import { useState } from "react";
import Link from "next/link";
import type { MediaAsset } from "@/lib/supabase/types";
import { Button } from "@/components/admin/ui/Button";
import { purposeLabel } from "@/lib/media/taxonomy";

function isImage(mime: string | null): boolean {
  return Boolean(mime && mime.startsWith("image/"));
}

function prettyBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export type MediaGridItem = {
  asset: MediaAsset;
  /** Public URL for the storage key (or null). Computed server-side. */
  url: string | null;
  /** Detail-page href with filters already appended. Computed server-side. */
  href: string;
};

export function MediaGrid({
  items,
  returnTo,
  bulkDeleteAction,
}: {
  items: MediaGridItem[];
  /** The current (filtered) library URL to return to after a bulk delete. */
  returnTo: string;
  bulkDeleteAction: (formData: FormData) => void | Promise<void>;
}) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function selectAll() {
    setSelected(new Set(items.map((i) => i.asset.id)));
  }

  const count = selected.size;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={selectMode ? "primary" : "neutral"}
            size="sm"
            onClick={() => {
              setSelectMode((v) => !v);
              clearSelection();
            }}
          >
            {selectMode ? "Done" : "Select"}
          </Button>
          {selectMode && (
            <>
              <button
                type="button"
                onClick={selectAll}
                className="text-xs font-medium text-[var(--admin-text-muted)] underline-offset-2 hover:underline"
              >
                Select all ({items.length})
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="text-xs font-medium text-[var(--admin-text-muted)] underline-offset-2 hover:underline"
              >
                Clear
              </button>
            </>
          )}
        </div>

        {selectMode && (
          <form action={bulkDeleteAction}>
            <input type="hidden" name="returnTo" value={returnTo} />
            {Array.from(selected).map((id) => (
              <input key={id} type="hidden" name="ids" value={id} />
            ))}
            <Button
              type="submit"
              variant="danger"
              size="sm"
              disabled={count === 0}
              title={
                count === 0
                  ? "Select one or more items first"
                  : `Delete ${count} selected item(s). Items still in use are skipped.`
              }
            >
              🗑 Delete selected{count > 0 ? ` (${count})` : ""}
            </Button>
          </form>
        )}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map(({ asset: m, url, href }) => {
          const isSelected = selected.has(m.id);
          const cardInner = (
            <>
              <div className="relative flex aspect-square items-center justify-center bg-black p-2">
                {isImage(m.mime_type) && url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={m.alt_text ?? ""} className="h-full w-full object-contain" />
                ) : (
                  <span className="text-4xl">{m.mime_type === "application/pdf" ? "📄" : "🗂"}</span>
                )}
                {selectMode && (
                  <span
                    className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded border text-[11px] font-bold ${
                      isSelected
                        ? "border-[var(--admin-accent)] bg-[var(--admin-accent)] text-black"
                        : "border-white/60 bg-black/40 text-transparent"
                    }`}
                    aria-hidden
                  >
                    ✓
                  </span>
                )}
                <span
                  className={`absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                    m.status === "published"
                      ? "bg-[var(--admin-accent)]/20 text-[var(--admin-accent)]"
                      : m.status === "archived"
                        ? "bg-white/10 text-[var(--admin-text-faint)]"
                        : "bg-[var(--admin-orange)]/20 text-[var(--admin-orange)]"
                  }`}
                >
                  {m.status}
                </span>
                {m.width && m.height ? (
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--admin-text)] backdrop-blur">
                    {m.width}×{m.height}
                  </span>
                ) : null}
              </div>
              <div className="p-2">
                <p className="truncate text-xs font-medium text-[var(--admin-text)] group-hover:text-[var(--admin-accent)]">
                  {m.title || m.filename}
                </p>
                <p className="text-[10px] text-[var(--admin-text-faint)]">
                  {purposeLabel(m.usage_type)} · {prettyBytes(m.size_bytes)}
                  {m.width && m.height ? ` · ${m.width}×${m.height}px` : ""}
                </p>
              </div>
            </>
          );

          const cardClass = `group admin-card-interactive overflow-hidden rounded-[var(--admin-radius-lg)] border bg-[var(--admin-surface)] ${
            selectMode && isSelected
              ? "border-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]"
              : "border-[var(--admin-border)]"
          }`;

          // In select mode the card toggles selection; otherwise it links to
          // the detail page (carrying the active filters).
          return selectMode ? (
            <button
              key={m.id}
              type="button"
              onClick={() => toggle(m.id)}
              className={`${cardClass} text-left`}
              aria-pressed={isSelected}
            >
              {cardInner}
            </button>
          ) : (
            <Link key={m.id} href={href} className={cardClass}>
              {cardInner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
