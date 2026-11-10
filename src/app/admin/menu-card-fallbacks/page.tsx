/**
 * D224 — Admin → Menu Card Fallbacks.
 *
 * Owner: "I want to be able to set a fallback image to be used for products
 * when one isn't specifically set to that products menu card yet. There
 * should be one image per website category, when set, automatically shows on
 * all cards in that category without a product image set."
 *
 * One row per website category (the 21 the shop lists). Each row shows the
 * current picture, how many live cards it is covering right now, and three
 * ways to change it: upload a new picture, choose one from the media library,
 * or remove it. A server component with no client JS: the library search
 * travels as GET params (pick, lq, lscope) and each picture tile is its own
 * small form, the same pattern as the product editor's library picker.
 *
 * D225 (owner): "I want to be able to add many fallback images to the
 * categories, so that the menu has a variety of images used ... the cards
 * with fallback images, should rotate images." Each row now holds a strip of
 * pictures (up to MAX_FALLBACKS_PER_CATEGORY) with move up / move down /
 * remove on each, a multi-file upload, and the library picker adds to the
 * list. Neighbouring cards start on different pictures and every fallback
 * card cross-fades through the list (reduced motion and the shopper pause
 * control are honoured, WCAG 2.2.2).
 *
 * Where it shows: shop grid, category pages, home rails, specials, product
 * pages (and their related rail), the register info card, and the admin
 * product page preview. Always with the "Representative image" badge, never
 * in the image sitemap or the product-page ImageObject.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { KbFlash } from "../knowledge-base/KbFlash";
import { loadLiveMenuItemsCached } from "@/lib/pos/live-menu";
import { withResolvedImages } from "@/lib/enrichment/image-resolver";
import { withCategoryOverride } from "@/lib/menu/menu-category-override-server";
import { readMenuCardFallbacksForAdmin } from "@/lib/menu/menu-card-fallback-server";
import {
  MENU_CARD_FALLBACK_PAGE,
  coverageByCategory,
  fallbackPageRows,
  parseFallbackCategory,
  FALLBACK_UPLOAD_MIME,
  MAX_FALLBACKS_PER_CATEGORY,
  ROTATION_DWELL_MS,
  type CategoryCoverage,
} from "@/lib/menu/menu-card-fallback-core";
import { readLibraryPickerAssets } from "@/lib/media/library-picker-server";
import {
  libraryPickerView,
  libraryCountText,
  parseLibraryQuery,
  parseLibraryScope,
  LIBRARY_QUERY_MAX,
  LIBRARY_READ_ERROR_COPY,
} from "@/lib/media/library-picker-core";
import { MEDIA_UPLOAD_MAX_BYTES } from "@/lib/media/gif-core";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";
import {
  uploadFallbackAction,
  pickFallbackAction,
  clearFallbackAction,
  removeFallbackPictureAction,
  moveFallbackAction,
} from "./actions";

export const dynamic = "force-dynamic";

/** Live cards per category, measured BEFORE any fallback is applied. */
async function readCoverage(): Promise<Map<string, CategoryCoverage> | null> {
  try {
    const items = await withCategoryOverride(await withResolvedImages(await loadLiveMenuItemsCached()));
    return coverageByCategory(items);
  } catch {
    return null;
  }
}

function pickHref(category: string, query?: string, scope?: "product" | "all"): string {
  const p = new URLSearchParams();
  p.set("pick", category);
  if (query) p.set("lq", query);
  if (scope === "all") p.set("lscope", "all");
  return `${MENU_CARD_FALLBACK_PAGE}?${p.toString()}#library`;
}

export default async function MenuCardFallbacksPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string; pick?: string; lq?: string; lscope?: string }>;
}) {
  await requirePermission("products.enrich");
  const sp = await searchParams;
  const picking = parseFallbackCategory(sp.pick);
  const query = parseLibraryQuery(sp.lq);
  const scope = parseLibraryScope(sp.lscope);

  const [read, coverage, library] = await Promise.all([
    readMenuCardFallbacksForAdmin(),
    readCoverage(),
    picking ? readLibraryPickerAssets(scope, { query }) : Promise.resolve(null),
  ]);

  const rows = fallbackPageRows(read.rows, read.media, coverage);
  const migrated = read.schema !== "none";
  const multi = read.schema === "multi";
  const setCount = rows.filter((r) => r.pictures.length > 0).length;
  const pictureCount = rows.reduce((n, r) => n + r.pictures.length, 0);
  const uncovered = coverage
    ? rows.reduce((n, r) => n + (r.pictures.length > 0 ? 0 : r.coverage?.withoutOwnPhoto ?? 0), 0)
    : null;
  const pickingRow = picking ? rows.find((r) => r.category === picking) ?? null : null;
  const view = library
    ? libraryPickerView({
        assets: library.assets,
        query,
        scope,
        galleryIds: pickingRow ? pickingRow.pictures.map((p) => p.mediaId) : [],
        productName: picking ? formatWebsiteCategory(picking) : "",
      })
    : null;
  const maxMb = (MEDIA_UPLOAD_MAX_BYTES / (1024 * 1024)).toFixed(0);

  return (
    <div>
      <AdminPageHeader
        title="Menu Card Fallbacks"
        subtitle="Pictures for each website category, shown (and rotated) on every menu card in that category that has no photo of its own"
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin" }, { label: "Menu Card Fallbacks" }]} />}
      />
      <div className="space-y-6 px-5 py-6 sm:px-8" data-testid="menu-card-fallbacks">
        <KbFlash msg={sp.msg} error={sp.error} />

        {!migrated ? (
          <div role="alert" data-testid="fallback-migration-missing" className="rounded-xl border border-[var(--admin-gold)]/50 bg-[var(--admin-gold)]/10 p-4 text-sm text-white/85">
            Migration <strong>0355_menu_card_fallback_images</strong> has not been applied yet. Apply it in Supabase (see
            docs/MIGRATIONS_TO_RUN.md), then reload this page. Until then nothing can be saved here and cards keep their
            current pictures.
          </div>
        ) : null}
        {read.schema === "single" ? (
          <div role="alert" data-testid="fallback-0356-missing" className="rounded-xl border border-[var(--admin-gold)]/50 bg-[var(--admin-gold)]/10 p-4 text-sm text-white/85">
            Migration <strong>0356_menu_card_fallback_many</strong> has not been applied yet, so each category can hold only
            one picture (adding one replaces it). Apply it in Supabase (see docs/MIGRATIONS_TO_RUN.md) to add many pictures
            per category. The picture you already set stays.
          </div>
        ) : null}
        {!read.ok ? (
          <p role="alert" className="text-sm text-[var(--admin-orange)]">
            Could not read the saved fallbacks: {read.message}
          </p>
        ) : null}

        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5 text-sm text-white/70">
          <p>
            When a product has no photo of its own, its menu card shows a picture you set here for its website category.
            The moment a product gets its own photo, that photo wins. These cards always carry the small{" "}
            <em>Representative image</em> badge, and they are never sent to Google as the product photo.
          </p>
          <p className="mt-2">
            Add up to {MAX_FALLBACKS_PER_CATEGORY} pictures per category. Cards next to each other start on different
            pictures, so the menu looks varied, and each card gently cross-fades to the next picture about every{" "}
            {Math.round(ROTATION_DWELL_MS / 1000)} seconds. Shoppers can stop the rotation with the pause button on the
            menu, and it never runs for anyone who has asked their device to reduce motion.
          </p>
          <p className="mt-2 text-xs text-white/50">
            Order used for a card: its own photo, then this page, then the older generic fallbacks on{" "}
            <Link href="/admin/knowledge-base/images" className="underline underline-offset-2 hover:text-white">
              Knowledge Base → Fallback images
            </Link>
            , then the built-in mockup.
          </p>
          <p className="mt-3 text-xs text-white/60" data-testid="fallback-summary">
            {setCount} of {rows.length} categories set, {pictureCount} picture{pictureCount === 1 ? "" : "s"} in total.
            {uncovered !== null ? ` ${uncovered} live card${uncovered === 1 ? "" : "s"} without a photo sit in categories with no fallback yet.` : ""}
          </p>
        </section>

        {picking && view ? (
          <section id="library" aria-labelledby="library-title" data-testid="fallback-library" className="scroll-mt-24 rounded-xl border border-[var(--admin-accent)]/40 bg-[#0a0a0a] p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="library-title" className="text-sm font-semibold text-white">
                Add a picture to {formatWebsiteCategory(picking)}
              </h2>
              <div className="flex gap-2" role="group" aria-label="Which images">
                {(["product", "all"] as const).map((s) => (
                  <Link
                    key={s}
                    href={pickHref(picking, query, s)}
                    aria-current={view.scope === s ? "true" : undefined}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      view.scope === s
                        ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]"
                        : "border-white/15 text-white/60 hover:text-white"
                    }`}
                  >
                    {s === "product" ? "Product photos" : "All images"}
                  </Link>
                ))}
              </div>
              <Link href={`${MENU_CARD_FALLBACK_PAGE}#cat-${picking}`} className="ml-auto text-xs text-white/50 hover:text-white">
                Close
              </Link>
            </div>
            <form method="get" action={`${MENU_CARD_FALLBACK_PAGE}#library`} role="search" className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="pick" value={picking} />
              {view.scope === "all" ? <input type="hidden" name="lscope" value="all" /> : null}
              <label htmlFor="fallback-library-q" className="sr-only">
                Search the media library
              </label>
              <input
                id="fallback-library-q"
                type="search"
                name="lq"
                defaultValue={view.query}
                maxLength={LIBRARY_QUERY_MAX}
                placeholder="Search by title, file name, alt text or tag"
                className="min-w-[16rem] flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
              />
              <button type="submit" className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/80 hover:border-[var(--admin-accent)] hover:text-white">
                Search
              </button>
              {libraryCountText(view) ? <span className="text-xs text-white/45">{libraryCountText(view)}</span> : null}
            </form>
            {library && !library.ok ? (
              <p role="alert" className="mt-3 text-xs text-[var(--admin-orange)]">
                {LIBRARY_READ_ERROR_COPY}
              </p>
            ) : view.emptyText ? (
              <p className="mt-3 text-xs text-white/50">{view.emptyText}</p>
            ) : (
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" data-testid="fallback-library-grid">
                {view.tiles.map((t) => (
                  <li key={t.id} data-media-id={t.id} className="overflow-hidden rounded-lg border border-white/10 bg-black">
                    <div className="relative aspect-square bg-[#050505]">
                      {t.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.url} alt={t.alt} loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-white/35">No preview</div>
                      )}
                      {t.draft ? (
                        <span className="absolute left-1 top-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white/70">Draft</span>
                      ) : null}
                    </div>
                    <div className="space-y-1 border-t border-white/10 p-2">
                      <p className="truncate text-xs text-white/80" title={t.label}>
                        {t.label}
                      </p>
                      {t.alreadyAdded ? (
                        <p className="text-[11px] font-semibold text-[var(--admin-accent)]">✓ In use here</p>
                      ) : (
                        <form action={pickFallbackAction}>
                          <input type="hidden" name="category" value={picking} />
                          <input type="hidden" name="mediaId" value={t.id} />
                          <button
                            type="submit"
                            data-testid="fallback-library-use"
                            disabled={multi && !(pickingRow?.canAdd ?? true)}
                            aria-label={`Add ${t.label} to ${formatWebsiteCategory(picking)}`}
                            className="w-full rounded bg-[var(--admin-accent)] px-2 py-1 text-[11px] font-semibold text-black hover:brightness-110 disabled:opacity-40"
                          >
                            {multi ? "Add this picture" : "Use this picture"}
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <ul className="grid gap-4 lg:grid-cols-2" data-testid="fallback-rows">
          {rows.map((r) => (
            <li
              key={r.category}
              id={`cat-${r.category}`}
              data-testid="fallback-row"
              data-category={r.category}
              className={`scroll-mt-24 rounded-xl border bg-[#0a0a0a] p-4 ${picking === r.category ? "border-[var(--admin-accent)]/60" : "border-white/10"}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-sm font-semibold text-white">{r.label}</h2>
                  <span className="text-[11px] text-white/45" data-testid="fallback-count">
                    {r.pictures.length} of {multi ? MAX_FALLBACKS_PER_CATEGORY : 1} picture{(multi ? MAX_FALLBACKS_PER_CATEGORY : 1) === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-white/40" title={r.helper}>
                  {r.helper}
                </p>
                <p className="mt-2 text-xs text-white/70" data-testid="fallback-effect">
                  {r.effect}
                </p>
              </div>

              {r.pictures.length > 0 ? (
                <ol className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="fallback-pictures" aria-label={`${r.label} pictures, in rotation order`}>
                  {r.pictures.map((p, i) => (
                    <li key={p.mediaId} data-testid="fallback-picture" data-media-id={p.mediaId} className="overflow-hidden rounded-lg border border-white/10 bg-[#050505]">
                      <div className="relative aspect-square">
                        {p.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.url} alt={`${r.label} fallback ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] text-white/35">No preview</div>
                        )}
                        <span className="absolute left-1 top-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white/80">{i + 1}</span>
                      </div>
                      <div className="space-y-1 border-t border-white/10 p-1.5">
                        {p.title ? (
                          <p className="truncate text-[10px] text-white/50" title={p.title}>
                            {p.title}
                          </p>
                        ) : null}
                        {p.statusNote ? <p className="text-[10px] leading-tight text-[var(--admin-gold)]">{p.statusNote}</p> : null}
                        <div className="flex items-center gap-1">
                          {multi ? (
                            <>
                              <form action={moveFallbackAction}>
                                <input type="hidden" name="category" value={r.category} />
                                <input type="hidden" name="mediaId" value={p.mediaId} />
                                <input type="hidden" name="direction" value="up" />
                                <button
                                  type="submit"
                                  disabled={i === 0}
                                  data-testid="fallback-move-up"
                                  aria-label={`Move ${r.label} picture ${i + 1} earlier`}
                                  className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/70 hover:text-white disabled:opacity-30"
                                >
                                  &larr;
                                </button>
                              </form>
                              <form action={moveFallbackAction}>
                                <input type="hidden" name="category" value={r.category} />
                                <input type="hidden" name="mediaId" value={p.mediaId} />
                                <input type="hidden" name="direction" value="down" />
                                <button
                                  type="submit"
                                  disabled={i === r.pictures.length - 1}
                                  data-testid="fallback-move-down"
                                  aria-label={`Move ${r.label} picture ${i + 1} later`}
                                  className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/70 hover:text-white disabled:opacity-30"
                                >
                                  &rarr;
                                </button>
                              </form>
                            </>
                          ) : null}
                          <Link
                            href={`/admin/media/${p.mediaId}`}
                            aria-label={`Open ${r.label} picture ${i + 1} in the media library`}
                            className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/60 hover:text-white"
                          >
                            Open
                          </Link>
                          <form action={removeFallbackPictureAction} className="ml-auto">
                            <input type="hidden" name="category" value={r.category} />
                            <input type="hidden" name="mediaId" value={p.mediaId} />
                            <button
                              type="submit"
                              data-testid="fallback-remove-one"
                              aria-label={`Remove ${r.label} picture ${i + 1}`}
                              className="rounded border border-[var(--admin-orange)]/40 px-1.5 py-0.5 text-[10px] text-[var(--admin-orange)] hover:bg-[var(--admin-orange)]/10"
                            >
                              Remove
                            </button>
                          </form>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-white/10 p-4 text-center text-[11px] text-white/35">No fallback set</div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                <form action={uploadFallbackAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="category" value={r.category} />
                  <label className="sr-only" htmlFor={`file-${r.category}`}>
                    Upload pictures for {r.label}
                  </label>
                  <input
                    id={`file-${r.category}`}
                    type="file"
                    name="file"
                    required
                    multiple={multi}
                    accept={FALLBACK_UPLOAD_MIME.join(",")}
                    disabled={!migrated || (multi && !r.canAdd)}
                    className="max-w-[13rem] text-[11px] text-white/60 file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-[11px] file:text-white"
                  />
                  <button
                    type="submit"
                    disabled={!migrated || (multi && !r.canAdd)}
                    data-testid="fallback-upload"
                    className="rounded bg-[var(--admin-accent)] px-3 py-1 text-[11px] font-semibold text-black hover:brightness-110 disabled:opacity-40"
                  >
                    Upload
                  </button>
                </form>
                <Link
                  href={pickHref(r.category)}
                  aria-disabled={!migrated || (multi && !r.canAdd) ? "true" : undefined}
                  data-testid="fallback-choose"
                  className="rounded border border-white/15 px-3 py-1 text-[11px] text-white/80 hover:border-[var(--admin-accent)] hover:text-white"
                >
                  {multi ? "Add from library" : "Choose from library"}
                </Link>
                {r.pictures.length > 1 ? (
                  <form action={clearFallbackAction} className="ml-auto">
                    <input type="hidden" name="category" value={r.category} />
                    <button
                      type="submit"
                      data-testid="fallback-remove"
                      className="rounded border border-[var(--admin-orange)]/40 px-3 py-1 text-[11px] text-[var(--admin-orange)] hover:bg-[var(--admin-orange)]/10"
                    >
                      Remove all
                    </button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-white/40">
          PNG, JPG, WEBP or GIF, up to {maxMb} MB each. You can choose several files at once. A square picture works best.
          Uploads are saved to the media library too. The order above is the order the cards rotate in.
        </p>
      </div>
    </div>
  );
}
