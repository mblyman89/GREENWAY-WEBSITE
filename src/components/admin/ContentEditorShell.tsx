"use client";

/**
 * ContentEditorShell — the client glue for the Site Content editor.
 *
 * Holds the SHARED state that fixes the long-standing "click ✎ Edit in the
 * preview but nothing happens" bug. Previously the preview panel and the block
 * list each tracked their own page independently, so clicking Edit on a block
 * that wasn't currently listed (because the list was filtered to another page)
 * did nothing.
 *
 * Now a single source of truth (`activePage`) drives BOTH:
 *   - which public page the live preview shows, and
 *   - which page the block list is filtered to.
 *
 * When the editor clicks ✎ Edit on a hotspot in the preview, we:
 *   1. look up which page that block belongs to,
 *   2. switch the list filter to that page (so the block is rendered),
 *   3. then scroll to + highlight + focus the field.
 *
 * It also honours a `?block=<key>` URL param so deep links land on the right
 * field. R43: the green ✎ Edit preview hotspots are back ON (PreviewEditOverlay
 * + edit-target-core), and they deep-link here with ?block=<key>.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ContentBlocksBrowser,
  type BlockVM,
} from "@/components/admin/ContentBlocksBrowser";
import type { MediaChoice } from "@/components/admin/ContentImageField";

type Props = {
  blocks: BlockVM[];
  aiEnabled: boolean;
  mediaChoices: MediaChoice[];
  saveDraftAction: (formData: FormData) => void;
  publishAction: (formData: FormData) => void;
  restoreAction: (formData: FormData) => void;
  /**
   * Admin route the content actions return to (with their flash param). Passed
   * straight through to the block editors. Shared across editors since the old
   * Site Content page was retired (MIG-7); each host page passes its own route.
   */
  returnTo?: string;
  /**
   * R64: the big embedded "Live preview" iframe is gone from every editor —
   * the Website Hub's Live preview tab is the one place to preview. Pass the
   * public path to show a compact "Preview in Website Hub ↗" link instead.
   */
  previewPath?: string;
};

export function ContentEditorShell({
  blocks,
  aiEnabled,
  mediaChoices,
  saveDraftAction,
  publishAction,
  restoreAction,
  returnTo,
  previewPath,
}: Props) {
  // Map block_key -> page so we can switch the filter to the right page.
  const pageForBlock = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of blocks) m.set(b.block_key, b.page);
    return m;
  }, [blocks]);

  // Single source of truth. "all" shows everything; a page key filters.
  const [pageFilter, setPageFilter] = useState<string>("all");

  // Pending block to focus once it's rendered (after a filter switch).
  const focusKeyRef = useRef<string | null>(null);

  const focusBlock = useCallback((blockKey: string) => {
    const el = document.getElementById(`block-${blockKey}`);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-[var(--admin-accent)]");
    // Cards are collapsed by default; ask the card to expand itself. The
    // card's own `gw-expand` listener opens it and focuses the first field
    // once it is in the DOM (a collapsed card has no textarea to focus).
    el.dispatchEvent(new CustomEvent("gw-expand"));
    setTimeout(
      () => el.classList.remove("ring-2", "ring-[var(--admin-accent)]"),
      2200,
    );
    return true;
  }, []);

  // The core fix: switch page filter → then focus the block on next paint.
  const handleEditBlock = useCallback(
    (blockKey: string) => {
      const page = pageForBlock.get(blockKey);
      if (page) {
        setPageFilter((current) => (current === page ? current : page));
      }
      // Try now; if the block isn't in the DOM yet (filter just changed),
      // queue it for after the re-render.
      if (!focusBlock(blockKey)) {
        focusKeyRef.current = blockKey;
      }
    },
    [pageForBlock, focusBlock],
  );

  // After a filter change re-renders the list, focus any queued block.
  useEffect(() => {
    if (!focusKeyRef.current) return;
    const key = focusKeyRef.current;
    const id = window.setTimeout(() => {
      if (focusBlock(key)) focusKeyRef.current = null;
    }, 60);
    return () => window.clearTimeout(id);
  }, [pageFilter, focusBlock]);

  // Honour a deep link like ?block=home.hero.title on first load (R43: produced
  // by the green ✎ Edit hotspots in the Website Hub preview / live preview).
  // Defer to a microtask so the state update happens after the initial commit
  // (keeps the mount effect free of synchronous setState cascades).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("block");
    if (!key) return;
    queueMicrotask(() => handleEditBlock(key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {previewPath ? (
        <p className="text-sm text-[var(--admin-text-muted)]">
          <a
            href={`/admin/website-sync?tab=preview&path=${encodeURIComponent(previewPath)}`}
            className="font-medium text-[var(--admin-accent)] underline-offset-2 hover:underline"
          >
            Preview in Website Hub ↗
          </a>{" "}
          to see your drafts on the real page before you publish.
        </p>
      ) : null}
      <ContentBlocksBrowser
        blocks={blocks}
        aiEnabled={aiEnabled}
        mediaChoices={mediaChoices}
        saveDraftAction={saveDraftAction}
        publishAction={publishAction}
        restoreAction={restoreAction}
        pageFilter={pageFilter}
        onPageFilterChange={setPageFilter}
        returnTo={returnTo}
      />
    </>
  );
}
