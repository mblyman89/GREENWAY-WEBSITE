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
 * It also honours a `?block=<key>` URL param so deep links from the standalone
 * (new-tab) preview land on the right field too.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ContentPreviewPanel,
  PREVIEW_PAGES,
} from "@/components/admin/ContentPreviewPanel";
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
};

export function ContentEditorShell({
  blocks,
  aiEnabled,
  mediaChoices,
  saveDraftAction,
  publishAction,
  restoreAction,
}: Props) {
  // Map block_key -> page so we can switch the filter to the right page.
  const pageForBlock = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of blocks) m.set(b.block_key, b.page);
    return m;
  }, [blocks]);

  // Single source of truth. "all" shows everything; a page key filters.
  const [pageFilter, setPageFilter] = useState<string>("all");
  const [previewPath, setPreviewPath] = useState<string>(PREVIEW_PAGES[0].path);

  // Pending block to focus once it's rendered (after a filter switch).
  const focusKeyRef = useRef<string | null>(null);

  const focusBlock = useCallback((blockKey: string) => {
    const el = document.getElementById(`block-${blockKey}`);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-[#7ed957]");
    const focusable =
      el.querySelector("textarea") ?? el.querySelector("input[type='text']");
    if (focusable) (focusable as HTMLElement).focus();
    setTimeout(() => el.classList.remove("ring-2", "ring-[#7ed957]"), 2200);
    return true;
  }, []);

  // The core fix: switch page filter → then focus the block on next paint.
  const handleEditBlock = useCallback(
    (blockKey: string) => {
      const page = pageForBlock.get(blockKey);
      if (page) {
        setPageFilter((current) => (current === page ? current : page));
        // Also align the preview to the same page for a coherent view.
        const previewPage = PREVIEW_PAGES.find((p) => p.page === page);
        if (previewPage) setPreviewPath(previewPage.path);
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

  // Honour a deep link like /admin/content?block=home.hero.title on first load.
  // Defer to a microtask so the state update happens after the initial commit
  // (keeps the mount effect free of synchronous setState cascades).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("block");
    if (!key) return;
    queueMicrotask(() => handleEditBlock(key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the editor switches the PREVIEW page manually, mirror it to the list
  // filter so the two panels stay coherent.
  const handleSelectPreviewPath = useCallback((path: string) => {
    setPreviewPath(path);
    const match = PREVIEW_PAGES.find((p) => p.path === path);
    if (match) setPageFilter(match.page);
  }, []);

  return (
    <>
      <ContentPreviewPanel
        activePath={previewPath}
        onSelectPath={handleSelectPreviewPath}
        onEditBlock={handleEditBlock}
      />
      <ContentBlocksBrowser
        blocks={blocks}
        aiEnabled={aiEnabled}
        mediaChoices={mediaChoices}
        saveDraftAction={saveDraftAction}
        publishAction={publishAction}
        restoreAction={restoreAction}
        pageFilter={pageFilter}
        onPageFilterChange={setPageFilter}
      />
    </>
  );
}
