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
 */
import Link from "next/link";
import {
  libraryCountText,
  libraryPickerHref,
  LIBRARY_QUERY_MAX,
  LIBRARY_READ_ERROR_COPY,
  type LibraryPickerView,
} from "@/lib/media/library-picker-core";

export const LIBRARY_ATTACH_SOURCE = "library";

export function MediaLibraryPicker({
  productKey,
  back,
  view,
  readOk,
  action,
}: {
  productKey: string;
  back: string | null;
  view: LibraryPickerView;
  readOk: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
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

      <form
        method="get"
        action={`/admin/products/${encodeURIComponent(productKey)}#library`}
        role="search"
        className="mt-3 flex flex-wrap items-center gap-2"
        data-testid="library-search"
      >
        {back ? <input type="hidden" name="back" value={back} /> : null}
        {view.scope === "all" ? <input type="hidden" name="lscope" value="all" /> : null}
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
