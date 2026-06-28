"use client";

/**
 * ContentBlocksBrowser — the searchable, filterable list of content blocks.
 *
 * Wraps all the ContentBlockEditor cards and adds the "fun to use" layer:
 *   - instant search across label / key / current text
 *   - quick filters: All · Needs attention (unpublished drafts) · SEO · by page
 *   - friendly counts + a calm empty state when a filter matches nothing
 *   - a "jump to block" picker so staff can find a field fast
 *
 * Pure client; all editing still flows through the permission-gated server
 * actions passed straight through to each card.
 */
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/admin/ux";
import {
  ContentBlockEditor,
  type EditableBlock,
} from "@/components/admin/ContentBlockEditor";
import type { RevisionItem } from "@/components/admin/ContentRevisionHistory";
import type { MediaChoice } from "@/components/admin/ContentImageField";

export type BlockVM = EditableBlock & {
  page: string;
  status: string;
  last_edited_by: string | null;
  updated_at: string;
  publicPath: string | null;
  revisions: RevisionItem[];
};

type Props = {
  blocks: BlockVM[];
  aiEnabled: boolean;
  saveDraftAction: (formData: FormData) => void;
  publishAction: (formData: FormData) => void;
  restoreAction: (formData: FormData) => void;
  /** Published media library images for image-block pickers. */
  mediaChoices?: MediaChoice[];
  /** Controlled page filter (synced with the live preview selector). */
  pageFilter?: string;
  onPageFilterChange?: (page: string) => void;
};

type Filter = "all" | "attention" | "seo" | string; // string = a page name

function isDirty(b: BlockVM): boolean {
  return (
    (b.draft_value ?? "") !== (b.published_value ?? "") ||
    b.status !== "published"
  );
}

export function ContentBlocksBrowser({
  blocks,
  aiEnabled,
  saveDraftAction,
  publishAction,
  restoreAction,
  mediaChoices = [],
  pageFilter,
  onPageFilterChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [internalFilter, setInternalFilter] = useState<Filter>("all");
  // When a parent controls the page filter (to sync with the live preview),
  // honour it; otherwise fall back to local state.
  const filter: Filter = pageFilter ?? internalFilter;
  const setFilter = (next: Filter) => {
    setInternalFilter(next);
    // Only page filters are mirrored to the parent (preview selector).
    if (
      onPageFilterChange &&
      next !== "attention" &&
      next !== "seo"
    ) {
      onPageFilterChange(next);
    }
  };

  const pages = useMemo(
    () => Array.from(new Set(blocks.map((b) => b.page))),
    [blocks],
  );
  const attentionCount = useMemo(
    () => blocks.filter(isDirty).length,
    [blocks],
  );
  const seoCount = useMemo(
    () => blocks.filter((b) => b.seo_impact).length,
    [blocks],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return blocks.filter((b) => {
      // Filter chip.
      if (filter === "attention" && !isDirty(b)) return false;
      if (filter === "seo" && !b.seo_impact) return false;
      if (filter !== "all" && filter !== "attention" && filter !== "seo") {
        if (b.page !== filter) return false;
      }
      // Search.
      if (!q) return true;
      const hay = `${b.label} ${b.block_key} ${b.draft_value ?? ""} ${b.published_value ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [blocks, query, filter]);

  // Group the filtered set by page for display.
  const byPage = useMemo(() => {
    const map = new Map<string, BlockVM[]>();
    for (const b of filtered) {
      const arr = map.get(b.page) ?? [];
      arr.push(b);
      map.set(b.page, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const chip = (key: Filter, label: string, count?: number, tone?: "warn") => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold transition ${
        filter === key
          ? "border-[#7ed957] bg-[#7ed957] text-black"
          : tone === "warn" && (count ?? 0) > 0
            ? "border-[#ff7f00]/40 bg-[#ff7f00]/10 text-[#ff7f00] hover:bg-[#ff7f00]/20"
            : "border-white/15 text-white/60 hover:bg-white/10"
      }`}
    >
      {label}
      {typeof count === "number" && (
        <span className="ml-1.5 opacity-70">{count}</span>
      )}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1 md:max-w-sm">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35">
              🔍
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search content… (headline, page, words on the page)"
              className="w-full rounded-lg border border-white/15 bg-black py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-[#7ed957]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {chip("all", "All", blocks.length)}
            {chip("attention", "Needs attention", attentionCount, "warn")}
            {chip("seo", "SEO", seoCount)}
          </div>
        </div>
        {/* Page filter row */}
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/5 pt-2">
          <span className="text-[0.65rem] uppercase tracking-wide text-white/35">
            Pages:
          </span>
          {pages.map((p) => chip(p, p))}
        </div>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="🔎"
          title="No content matches"
          description={
            query
              ? `Nothing matches “${query}”. Try a different word or clear the search.`
              : "No blocks match this filter."
          }
          action={
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
              className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-bold text-black hover:bg-[#6bc746]"
            >
              Clear filters
            </button>
          }
        />
      ) : (
        byPage.map(([page, items]) => (
          <div key={page}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#7ed957]">
              {page}
              <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[0.6rem] font-semibold text-white/40">
                {items.length}
              </span>
            </h2>
            <div className="space-y-4">
              {items.map((b) => (
                <ContentBlockEditor
                  key={b.block_key}
                  block={{
                    block_key: b.block_key,
                    label: b.label,
                    field_type: b.field_type,
                    help_text: b.help_text,
                    seo_impact: b.seo_impact,
                    draft_value: b.draft_value,
                    published_value: b.published_value,
                  }}
                  aiEnabled={aiEnabled}
                  saveDraftAction={saveDraftAction}
                  publishAction={publishAction}
                  publicPath={b.publicPath}
                  revisions={b.revisions}
                  restoreAction={restoreAction}
                  mediaChoices={mediaChoices}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
