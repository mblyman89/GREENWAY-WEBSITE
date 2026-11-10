/**
 * Round 21 (C) — "Choose from your media library".
 *
 * Library first, upload second (the WordPress Media Library tab / DAM picker
 * pattern). A server component with zero client JS:
 *   • search + scope travel as GET params (lq, lscope) through a plain GET
 *     form, and the #library fragment brings the browser back here;
 *   • each tile is its OWN small form posting { key, mediaId, source } to the
 *     existing attachMatchedMedia action (the same path the "Suggested
 *     matches" Attach button uses: audit row, usage record, first image
 *     becomes the cover). It sits OUTSIDE the editor's multipart form, so no
 *     nested forms and no formAction name/value loss;
 *   • a photo already on this product shows "Already added" instead of a
 *     button.
 * Every decision (what is pickable, the search, the order, the copy) comes
 * from src/lib/media/library-picker-core.ts.
 *
 * D221 M6: "Search in" chips (This vendor / This brand / Everything, GET
 * param lv) and a "Find similar" link on every tile (GET param lsim) run the
 * recommender-v2 search; the hits render above the grid with short "why"
 * chips. Attaching is still one human click per picture.
 */
import Link from "next/link";
import {
  libraryCountText,
  libraryPickerHref,
  LIBRARY_QUERY_MAX,
  LIBRARY_READ_ERROR_COPY,
  type LibraryPickerView,
} from "@/lib/media/library-picker-core";
import type { ImageRecommendation, ImageSearchScope } from "@/lib/catalog/image-recommend-core";

/** D221 M6: the recommender-v2 search block (null = not searching). */
export type PickerImageSearch = {
  scope: ImageSearchScope;
  similarTo: string | null;
  items: ImageRecommendation[];
  note: string | null;
};

export const LIBRARY_ATTACH_SOURCE = "library";

export function MediaLibraryPicker({
  productKey,
  back,
  view,
  readOk,
  action,
  search = null,
  hasVendor = false,
  hasBrand = false,
}: {
  productKey: string;
  back: string | null;
  view: LibraryPickerView;
  readOk: boolean;
  action: (formData: FormData) => void | Promise<void>;
  search?: PickerImageSearch | null;
  hasVendor?: boolean;
  hasBrand?: boolean;
}) {
  const searchChip = (lv: ImageSearchScope, text: string, enabled: boolean) => {
    const active = Boolean(search && !search.similarTo && search.scope === lv);
    if (!enabled) {
      return (
        <span
          data-testid={`library-search-in-${lv}`}
          aria-disabled="true"
          title="This product has no card for that yet"
          className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/25"
        >
          {text}
        </span>
      );
    }
    return (
      <Link
        href={libraryPickerHref(productKey, { query: view.query, scope: view.scope, back, searchIn: lv })}
        aria-current={active ? "true" : undefined}
        data-testid={`library-search-in-${lv}`}
        className={`rounded-full border px-3 py-1 text-xs ${
          active
            ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]"
            : "border-white/15 text-white/60 hover:text-white"
        }`}
      >
        {text}
      </Link>
    );
  };
  const similarHref = (id: string) => libraryPickerHref(productKey, { scope: view.scope, back, similarTo: id });
  const scopeLink = (scope: "product" | "all", text: string) => (
    <Link
      href={libraryPickerHref(productKey, { query: view.query, scope, back })}
      aria-current={view.scope === scope ? "true" : undefined}
      data-testid={`library-scope-${scope}`}
      className={`rounded-full border px-3 py-1 text-xs ${
        view.scope === scope
          ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]"
          : "border-white/15 text-white/60 hover:text-white"
      }`}
    >
      {text}
    </Link>
  );
  const count = libraryCountText(view);

  return (
    <section
      id="library"
      aria-labelledby="library-title"
      data-testid="media-library-picker"
      className="scroll-mt-24 rounded-xl border border-white/10 bg-[#0a0a0a] p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="library-title" className="text-sm font-semibold text-white">
          Choose from your media library
        </h2>
        <div className="flex gap-2" role="group" aria-label="Which images">
          {scopeLink("product", "Product photos")}
          {scopeLink("all", "All images")}
        </div>
        <Link href="/admin/media" className="ml-auto text-xs text-white/50 underline-offset-2 hover:text-white hover:underline">
          Open the Media Library page →
        </Link>
      </div>
      <p className="mt-1 text-xs text-white/50">
        Every photo you have uploaded or imported lives here. Pick one to add it to this product; the first photo
        becomes the cover. Nothing is removed from the library.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Search in" data-testid="library-search-in">
        <span className="text-[11px] text-white/45">Search in:</span>
        {searchChip("vendor", "This vendor", hasVendor)}
        {searchChip("brand", "This brand", hasBrand)}
        {searchChip("all", "Everything", true)}
      </div>

      <form
        method="get"
        action={`/admin/products/${encodeURIComponent(productKey)}#library`}
        role="search"
        className="mt-3 flex flex-wrap items-center gap-2"
        data-testid="library-search"
      >
        {back ? <input type="hidden" name="back" value={back} /> : null}
        {view.scope === "all" ? <input type="hidden" name="lscope" value="all" /> : null}
        {search && !search.similarTo ? <input type="hidden" name="lv" value={search.scope} /> : null}
        <label htmlFor="library-q" className="sr-only">
          Search the media library
        </label>
        <input
          id="library-q"
          type="search"
          name="lq"
          defaultValue={view.query}
          maxLength={LIBRARY_QUERY_MAX}
          placeholder="Search by title, file name, alt text or tag"
          className="min-w-[16rem] flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
        />
        <button
          type="submit"
          className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/80 hover:border-[var(--admin-accent)] hover:text-white"
        >
          Search
        </button>
        {view.query ? (
          <Link href={libraryPickerHref(productKey, { scope: view.scope, back })} className="text-xs text-white/50 hover:text-white">
            Clear
          </Link>
        ) : null}
        {count ? (
          <span className="text-xs text-white/45" data-testid="library-count" aria-live="polite">
            {count}
          </span>
        ) : null}
      </form>

      {search ? (
        <div data-testid="library-search-results" className="mt-3 rounded-lg border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-white">
              {search.similarTo ? "Pictures like that one" : "Search results"}
            </p>
            <Link href={libraryPickerHref(productKey, { query: view.query, scope: view.scope, back })} className="ml-auto text-[11px] text-white/50 hover:text-white">
              Close
            </Link>
          </div>
          {search.note ? (
            <p data-testid="library-search-note" className="mt-1 text-[11px] text-white/55">
              {search.note}
            </p>
          ) : null}
          {search.items.length > 0 ? (
            <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {search.items.map((r) => (
                <li key={r.id} data-testid="library-search-tile" data-media-id={r.id} className="overflow-hidden rounded-lg border border-white/10 bg-black">
                  <div className="relative aspect-square bg-[#050505]">
                    {r.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.url} alt={r.alt} loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-white/35">No preview</div>
                    )}
                  </div>
                  <div className="space-y-1 border-t border-white/10 p-2">
                    <p className="truncate text-xs text-white/80" title={r.label}>
                      {r.label}
                    </p>
                    {r.chips.length > 0 ? (
                      <div className="flex flex-wrap gap-1" data-testid="library-search-chips">
                        {r.chips.slice(0, 4).map((c) => (
                          <span key={c} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">
                            {c}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {r.attached ? (
                      <p className="text-[11px] font-semibold text-[var(--admin-accent)]">✓ Already added</p>
                    ) : (
                      <form action={action}>
                        <input type="hidden" name="key" value={productKey} />
                        <input type="hidden" name="mediaId" value={r.id} />
                        <input type="hidden" name="source" value={LIBRARY_ATTACH_SOURCE} />
                        <button
                          type="submit"
                          data-testid="library-search-add"
                          aria-label={`Add ${r.label} to this product`}
                          className="w-full rounded bg-[var(--admin-accent)] px-2 py-1 text-[11px] font-semibold text-black hover:brightness-110"
                        >
                          Add to product
                        </button>
                      </form>
                    )}
                    <Link href={similarHref(r.id)} data-testid="library-find-similar" className="block text-center text-[10px] text-white/50 hover:text-white">
                      Find similar
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {!readOk ? (
        <p role="alert" data-testid="library-read-error" className="mt-3 text-xs text-[var(--admin-orange)]">
          {LIBRARY_READ_ERROR_COPY}
        </p>
      ) : view.emptyText ? (
        <p data-testid="library-empty" className="mt-3 text-xs text-white/50">
          {view.emptyText}
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" data-testid="library-grid">
          {view.tiles.map((t) => (
            <li key={t.id} data-testid="library-tile" data-media-id={t.id} className="overflow-hidden rounded-lg border border-white/10 bg-black">
              <div className="relative aspect-square bg-[#050505]">
                {t.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.url} alt={t.alt} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-white/35">No preview</div>
                )}
                <div className="absolute left-1 top-1 flex flex-wrap gap-1">
                  {t.draft ? (
                    <span className="rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white/70" title="Still a draft in the media library">
                      Draft
                    </span>
                  ) : null}
                  {t.rightsPending ? (
                    <span
                      className="rounded bg-[var(--admin-gold)] px-1.5 py-0.5 text-[10px] font-semibold text-black"
                      title="Imported from a vendor or the web; its usage rights have not been reviewed yet"
                    >
                      Rights check
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="space-y-1 border-t border-white/10 p-2">
                <p className="truncate text-xs text-white/80" title={t.label}>
                  {t.label}
                </p>
                {t.sub ? (
                  <p className="truncate text-[10px] text-white/40" title={t.sub}>
                    {t.sub}
                  </p>
                ) : null}
                {t.alreadyAdded ? (
                  <p data-testid="library-already" className="text-[11px] font-semibold text-[var(--admin-accent)]">
                    ✓ Already added
                  </p>
                ) : (
                  <form action={action}>
                    <input type="hidden" name="key" value={productKey} />
                    <input type="hidden" name="mediaId" value={t.id} />
                    <input type="hidden" name="source" value={LIBRARY_ATTACH_SOURCE} />
                    <button
                      type="submit"
                      data-testid="library-add"
                      aria-label={`Add ${t.label} to this product`}
                      className="w-full rounded bg-[var(--admin-accent)] px-2 py-1 text-[11px] font-semibold text-black hover:brightness-110"
                    >
                      Add to product
                    </button>
                  </form>
                )}
                <Link href={similarHref(t.id)} data-testid="library-find-similar" className="block text-center text-[10px] text-white/50 hover:text-white">
                  Find similar
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-white/40">
        Not in the library?{" "}
        <a href="#upload" className="text-white/60 underline underline-offset-2 hover:text-white">
          Upload a new photo from your computer
        </a>{" "}
        in the Images panel below. It is saved to the media library too.
      </p>
    </section>
  );
}
