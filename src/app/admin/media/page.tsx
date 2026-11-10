import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { countMedia, publicUrlForKey } from "@/lib/media/store";
import { listAllMedia, buildMediaUses, loadMediaUseSources } from "@/lib/media/folders-server";
import { mediaMatchesQuery } from "@/lib/media/provenance-core";
import { folderIndex, buildFolderTree, folderTrail, safeFolderId, type FolderNode } from "@/lib/media/folders-core";
import { MediaFolderTree } from "@/components/admin/media/MediaFolderTree";
import type { MediaAsset } from "@/lib/supabase/types";
import { MediaDropzone } from "@/components/admin/media/MediaDropzone";
import { MEDIA_PURPOSES } from "@/lib/media/taxonomy";
import { pickListParams, withListParams } from "@/lib/media/return-state-core";
import { bulkDeleteMediaAction } from "./actions";
import { bulkOrganizeMediaAction } from "./organize-actions";
import { Button } from "@/components/admin/ui/Button";
import { Input, Select } from "@/components/admin/ui/Field";
import { EmptyState } from "@/components/admin/ux";
import { MediaGrid } from "@/components/admin/media/MediaGrid";
import { MediaAiPanel } from "@/components/admin/media/MediaAiPanel";
import { loadDescribePanel } from "@/lib/media/media-describe-store";
import { startDescribeRunAction, setDescribeRunStatusAction, retryFailedDescribesAction } from "./ai-actions";
import { setAutoPublishAction, bulkLibraryV2Action } from "./library-actions";
import { MediaHealthDashboard } from "@/components/admin/media/MediaHealthDashboard";
import { parseLibraryFilters, applyLibraryFilters, buildFacets, LIBRARY_FILTER_KEYS, type LibraryFilters } from "@/lib/media/library-v2-core";
import { loadCollections, loadCollectionMemberIds, loadSearchSummary, loadVendorNames, logMediaSearch } from "@/lib/media/library-v2-server";

export const dynamic = "force-dynamic";

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; usage?: string; folder?: string; sort?: string; page?: string; saved?: string; deleted?: string; note?: string; error?: string; vendor?: string; platform?: string; role?: string; category?: string; review?: string; seo?: string; ai?: string; coll?: string } & LibraryFilters>;
}) {
  const session = await requirePermission("media.manage");
  const sp = await searchParams;
  const { q, status, usage, folder: rawFolder, sort: rawSort, page: rawPage, saved, deleted, note, error } = sp;
  // D221 M7: the facet filters (vendor, came from, what it is, category, review, SEO, AI, collection).
  const facetFilters = parseLibraryFilters(sp);
  const folder = safeFolderId(rawFolder);
  const sort = ["oldest", "name", "largest"].includes(rawSort ?? "") ? (rawSort as string) : "newest";
  // H12d: the active filters travel with every grid link so the detail page
  // can send the owner back to this exact filtered view.
  const listParams = pickListParams({ q, status, usage, folder: folder === "all" ? "" : folder, sort: sort === "newest" ? "" : sort, page: rawPage, ...facetFilters });

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Digital Assets" subtitle="Upload and manage logos, banners, and images." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once your administrator
            finishes the one-time setup, your media library will appear here.
          </div>
        </div>
      </div>
    );
  }

  // R65: load EVERY asset (the old page only ever showed the newest 200),
  // work out where each is used, then file them into smart folders.
  // PERF-S10: counts, the asset list and the 11 usage-source reads all run in
  // PARALLEL (they used to be three serial steps).
  const sourcesPromise = loadMediaUseSources();
  sourcesPromise.catch(() => undefined);
  const [counts, everything, aiPanel, vendorRead, collRead, searchSummary, members] = await Promise.all([
    countMedia(),
    listAllMedia(),
    loadDescribePanel(),
    loadVendorNames(),
    loadCollections(),
    loadSearchSummary(30),
    facetFilters.coll ? loadCollectionMemberIds(facetFilters.coll) : Promise.resolve({ ids: new Set<string>(), error: null }),
  ]);
  const uses = await buildMediaUses(everything, sourcesPromise);
  const index = folderIndex(everything, uses);
  const tree = buildFolderTree(index);
  const ql = (q ?? "").trim().toLowerCase();
  const preFacet = everything
    .filter((m) => folder === "all" || (index.get(m.id) ?? []).includes(folder))
    .filter((m) => !usage || m.usage_type === usage)
    .filter((m) => !status || m.status === status)
    // D221 M1: every word must match, across the 0352 fields too (product
    // name from the menu, package text, AI caption, vendor credit).
    .filter((m) => !ql || mediaMatchesQuery(m, ql));
  // D221 M7: facets count over what the other filters leave.
  const facets = buildFacets(preFacet, facetFilters, vendorRead.names, members.ids);
  const filtered = applyLibraryFilters(preFacet, facetFilters, members.ids)
    .sort((a, b) =>
      sort === "oldest"
        ? a.created_at.localeCompare(b.created_at)
        : sort === "name"
          ? (a.title || a.filename || "").localeCompare(b.title || b.filename || "")
          : sort === "largest"
            ? (b.size_bytes ?? 0) - (a.size_bytes ?? 0)
            : b.created_at.localeCompare(a.created_at),
    );
  // D221 M7: log the search (only page 1 so paging does not count twice; best effort).
  if (ql && (Number.parseInt(rawPage ?? "1", 10) || 1) === 1) await logMediaSearch("library", q, { folder: folder === "all" ? "" : folder, status: status ?? "", usage: usage ?? "", ...facetFilters }, filtered.length, session.userId);
  const facetHref = (key: (typeof LIBRARY_FILTER_KEYS)[number], value: string | undefined) =>
    withListParams("/admin/media", { ...listParams, page: undefined, [key]: value });
  const activeFacets = (Object.entries(facetFilters) as [(typeof LIBRARY_FILTER_KEYS)[number], string][]).filter(([, v]) => v);
  const collectionName = new Map(collRead.collections.map((c) => [c.id, c.name]));
  const PER_PAGE = 120;
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageNo = Math.min(pages, Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1));
  const shown = filtered.slice((pageNo - 1) * PER_PAGE, pageNo * PER_PAGE);
  const baseParams = { ...listParams, page: undefined };
  const folderHref = (id: string) => withListParams("/admin/media", { ...baseParams, folder: id === "all" ? undefined : id });
  const pageHref = (n: number) => withListParams("/admin/media", { ...baseParams, page: n > 1 ? String(n) : undefined });
  const trail = folderTrail(folder);
  const findNode = (list: FolderNode[], id: string): FolderNode | null => {
    for (const n of list) {
      if (n.id === id) return n;
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
    return null;
  };
  const current = folder === "all" ? null : findNode(tree, folder);
  const subfolders = folder === "all" ? tree : current?.children ?? [];

  return (
    <div>
      <AdminPageHeader
        title="Digital Assets"
        subtitle="One home for every logo, banner, and image. Upload, tag, and publish — published assets serve publicly."
        breadcrumbs={<Breadcrumbs items={[{ label: "Digital Assets" }]} />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* D221 M5-M8: always-visible way into the review queue (its page has a way back). */}
            <Link href="/admin/media/review" data-testid="media-review-queue-button">
              <Button variant="confirm">🔎 Review queue ({Number(aiPanel.health?.needs_review ?? 0)})</Button>
            </Link>
            <Link href="/admin/media/collections">
              <Button variant="neutral">🗂️ Collections</Button>
            </Link>
            <Link href="/admin/marketing/midjourney">
              <Button variant="neutral">🎨 Midjourney prompt builder</Button>
            </Link>
          </div>
        }
        help={
          <HelpPanel
            id="media"
            title="How the media library works"
            steps={[
              "Upload images (logos, banners, product photos).",
              "Add a short tag or description so they're easy to find.",
              "Publish an image to use it on the public site.",
              "Reuse the same image anywhere — no need to upload twice.",
            ]}
          >
            <p>
              Keeping images here means you upload once and reuse everywhere.
              Before deleting an image, we&apos;ll warn you if it&apos;s in use.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {saved && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            {saved === "1" ? "Saved." : `Uploaded ${saved} file(s).`}
          </div>
        )}
        {deleted && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-white/5 px-4 py-2 text-sm text-[var(--admin-text-muted)]">
            {note && note.trim() ? note : "Asset deleted."}
          </div>
        )}
        {error && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-4 py-2 text-sm text-[var(--admin-orange)]">{error}</div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total assets" value={counts.total} accent="muted" />
          <StatCard label="Published" value={counts.published} accent="green" />
          <StatCard label="Drafts" value={counts.total - counts.published} accent="orange" />
        </div>

        {/* D221 M4: the AI closer look run + the M3 review queue link */}
        <MediaAiPanel panel={aiPanel} startAction={startDescribeRunAction} statusAction={setDescribeRunStatusAction} retryAction={retryFailedDescribesAction} />

        {/* D221 M5 + M7: health dashboard, undo auto-publish, top searches */}
        <MediaHealthDashboard health={aiPanel.health} searches={searchSummary.rows} autoPublishAction={setAutoPublishAction} returnTo={withListParams("/admin/media", listParams)} />
        {(vendorRead.error || collRead.error || searchSummary.error || members.error) && (
          <p className="text-xs text-[var(--admin-orange)]">{vendorRead.error || collRead.error || searchSummary.error || members.error}</p>
        )}

        {/* Upload (drag & drop) */}
        <MediaDropzone />

        {counts.total > 0 && (
          <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
            {/* R65: smart-folder tree — assets file themselves by source, page and use. */}
            <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2">
              <p className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">Smart folders</p>
              <MediaFolderTree tree={tree} total={everything.length} active={folder} hrefFor={folderHref} />
              <p className="mt-2 px-1.5 text-[11px] leading-snug text-[var(--admin-text-faint)]">
                Folders fill themselves from where each file came from and where it&apos;s used — nothing to drag. One file can sit in several folders.
              </p>

              {/* D221 M7: facets. Each count = what you would see after clicking it. */}
              <div data-testid="media-facets" className="mt-3 space-y-3 border-t border-[var(--admin-border)] px-1.5 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">Narrow down</p>
                {collRead.collections.length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-[var(--admin-text-muted)]">Collection</p>
                    <ul className="space-y-0.5 text-xs">
                      {collRead.collections.slice(0, 20).map((c) => (
                        <li key={c.id}>
                          <Link href={facetHref("coll", facetFilters.coll === c.id ? undefined : c.id)} className={facetFilters.coll === c.id ? "font-semibold text-[var(--admin-accent)]" : "text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"}>
                            {c.kind === "brand-kit" ? "🎨 " : "🗂️ "}{c.name} <span className="text-[var(--admin-text-faint)]">({c.items})</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {facets.map((f) => (
                  <div key={f.key}>
                    <p className="mb-1 text-[11px] font-semibold text-[var(--admin-text-muted)]">{f.label}</p>
                    <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs">
                      {f.options.map((o) => {
                        const on = facetFilters[f.key] === o.value;
                        return (
                          <li key={o.value}>
                            <Link href={facetHref(f.key, on ? undefined : o.value)} className={on ? "font-semibold text-[var(--admin-accent)]" : "text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"}>
                              {on ? "✓ " : ""}{o.label} <span className="text-[var(--admin-text-faint)]">({o.count})</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </aside>

            <div className="min-w-0 space-y-4">
              {/* Breadcrumb + folder summary */}
              <div className="flex flex-wrap items-center gap-1 text-sm">
                <Link href={folderHref("all")} className="text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]">🗂️ Everything</Link>
                {trail.map((c) => (
                  <span key={c.id} className="flex items-center gap-1">
                    <span className="text-[var(--admin-text-faint)]">›</span>
                    <Link href={folderHref(c.id)} className={c.id === folder ? "font-semibold text-[var(--admin-text)]" : "text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"}>{c.label}</Link>
                  </span>
                ))}
                <span className="ml-2 text-xs text-[var(--admin-text-faint)]">{filtered.length} file(s){current?.hint ? ` · ${current.hint}` : ""}</span>
              </div>

              {/* Sub-folder tiles (like opening a folder on a computer) */}
              {subfolders.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                  {subfolders.map((n) => (
                    <Link key={n.id} href={folderHref(n.id)} title={n.hint} className="admin-card-interactive flex items-center gap-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2">
                      <span className="text-xl" aria-hidden>{n.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[var(--admin-text)]">{n.label}</span>
                        <span className="block text-[11px] text-[var(--admin-text-faint)]">{n.count} file(s){n.children.length ? ` · ${n.children.length} folder(s)` : ""}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}

              {/* D221 M7: active facet chips (click to remove) */}
              {activeFacets.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {activeFacets.map(([k, v]) => {
                    const facet = facets.find((f) => f.key === k);
                    const label = k === "coll" ? collectionName.get(v) ?? "Collection" : facet?.options.find((o) => o.value === v)?.label ?? v;
                    return (
                      <Link key={k} href={facetHref(k, undefined)} className="rounded-full border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-2 py-0.5 text-[var(--admin-accent)]">
                        {facet?.label ?? (k === "coll" ? "Collection" : k)}: {label} ✕
                      </Link>
                    );
                  })}
                  <Link href={withListParams("/admin/media", { q, status, usage, folder: folder === "all" ? undefined : folder })} className="text-[var(--admin-text-faint)] hover:text-[var(--admin-accent)]">Clear all</Link>
                </div>
              )}

              {/* Filters (inside the open folder) */}
              <form className="flex flex-wrap items-center gap-2" method="get">
                {folder !== "all" && <input type="hidden" name="folder" value={folder} />}
                {activeFacets.map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
                <Input name="q" defaultValue={q ?? ""} placeholder={folder === "all" ? "Search everything — product, vendor, package text, title, tags…" : "Search in this folder…"} className="min-w-48 flex-1" />
                <Select name="usage" defaultValue={usage ?? ""} className="w-auto">
                  <option value="">All purposes</option>
                  {MEDIA_PURPOSES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
                <Select name="status" defaultValue={status ?? ""} className="w-auto">
                  <option value="">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </Select>
                <Select name="sort" defaultValue={sort} className="w-auto">
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="name">Name A–Z</option>
                  <option value="largest">Largest first</option>
                </Select>
                <Button type="submit" variant="neutral">
                  Apply
                </Button>
              </form>

              {shown.length > 0 && (
                <MediaGrid
                  returnTo={withListParams("/admin/media", listParams)}
                  bulkDeleteAction={bulkDeleteMediaAction}
                  organizeAction={bulkOrganizeMediaAction}
                  bulkV2Action={bulkLibraryV2Action}
                  vendors={[...vendorRead.names.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))}
                  collections={collRead.collections.map((c) => ({ id: c.id, name: c.name }))}
                  items={shown.map((m: MediaAsset) => ({
                    asset: m,
                    url: publicUrlForKey(m.storage_key),
                    href: withListParams(`/admin/media/${m.id}`, listParams),
                  }))}
                />
              )}
              {pages > 1 && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {pageNo > 1 && <Link href={pageHref(pageNo - 1)} className="rounded border border-[var(--admin-border)] px-2 py-1 hover:text-[var(--admin-accent)]">← Previous</Link>}
                  <span className="text-[var(--admin-text-muted)]">Page {pageNo} of {pages}</span>
                  {pageNo < pages && <Link href={pageHref(pageNo + 1)} className="rounded border border-[var(--admin-border)] px-2 py-1 hover:text-[var(--admin-accent)]">Next →</Link>}
                </div>
              )}
              {filtered.length === 0 && <p className="text-sm text-[var(--admin-text-muted)]">No files here{q || usage || status || activeFacets.length ? " match your filter" : " yet"}.</p>}
            </div>
          </div>
        )}

        {counts.total === 0 && (
          <EmptyState
            icon="🖼️"
            title="No media yet"
            description="Upload logos and banners above. Vendor and brand logos you add from the Vendors editor will also show up here automatically."
          />
        )}
      </div>
    </div>
  );
}
