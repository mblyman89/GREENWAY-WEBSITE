import {
  SHOP_GRID_SHELL,
  SHOP_CARD_GRID,
  CARD_MIN_HEIGHT,
  CARD_IMAGE_HEIGHT,
  skeletonCardKeys,
} from "@/lib/menu/menu-skeleton-core";

/**
 * SLICE F1 — THE SHOP PAGE'S OWN SKELETON.
 *
 * Before this file existed, `/menu` inherited `src/app/loading.tsx` — the ROOT
 * skeleton, shaped like the HOME page (film-strip hero + three promo cards).
 * Shoppers tapping "Shop" stared at a picture of the home page for ~2.3s.
 * Verified by dumping the raw first chunk off the wire and matching it
 * byte-for-byte to the root loading file.
 *
 * Next.js resolves `loading.js` by walking UP from the requested segment, so
 * placing this file at `src/app/menu/` stops that walk here. `/menu` now falls
 * back to a SHOP-shaped skeleton; every other route is untouched.
 *
 * The geometry comes from `menu-skeleton-core`, where each measurement is
 * pinned by a self-test against the real component. That is deliberate: a
 * skeleton whose size differs from the thing that replaces it causes a visible
 * jump (Cumulative Layout Shift). Matching the real grid means the placeholder
 * cards and the real cards occupy the SAME space, so the swap is seamless.
 *
 * No data is read here. This file must render instantly — the moment it awaits
 * anything it stops being a skeleton and becomes part of the problem.
 */
export default function MenuLoading() {
  return (
    <main className="min-h-screen bg-black text-white">
      {/* Breadcrumb bar — mirrors <Breadcrumbs> (border-b, same padding) so the
          content below starts at the same Y offset as the real page. */}
      <nav aria-hidden="true" className="border-b border-white/10 bg-black/80 px-4 py-3 md:px-8">
        <div className="mx-auto flex max-w-[var(--shop-max)] items-center gap-2">
          <div className="h-3 w-12 animate-pulse rounded-full bg-white/15" />
          <div className="h-3 w-3 rounded-full bg-white/5" />
          <div className="h-3 w-16 animate-pulse rounded-full bg-white/20" />
        </div>
      </nav>

      {/* Shop banner carousel placeholder — matches ShopBannerCarousel's own
          responsive box: aspect-[3/1] on mobile, min-h-[8.5rem]/[10.5rem] at md. */}
      <section className="border-b border-white/10 bg-black px-4 py-4 md:px-8 md:py-5">
        <div className="mx-auto max-w-[var(--shop-max)]">
          <div className="relative aspect-[3/1] animate-pulse overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] md:hidden" />
          <div className="relative hidden min-h-[8.5rem] animate-pulse overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] md:block md:min-h-[10.5rem]" />
        </div>
      </section>

      {/* The browser shell: sidebar + product grid, on the real grid tracks. */}
      <section className={SHOP_GRID_SHELL}>
        {/* Mobile search + sort row (hidden at lg, exactly like the real one). */}
        <div className="flex flex-row items-center gap-2.5 lg:hidden">
          <div className="h-11 min-w-0 flex-1 animate-pulse rounded-full border border-white/10 bg-zinc-950" />
          <div className="h-11 w-[8.5rem] shrink-0 animate-pulse rounded-full border border-white/10 bg-zinc-950" />
        </div>

        {/* Mobile "Filters & Categories" dropdown placeholder. */}
        <div className="lg:hidden">
          <div className="h-12 w-full animate-pulse rounded-full border border-white/10 bg-zinc-950" />
        </div>

        {/* Desktop filter rail — the 280px track. */}
        <aside className="hidden rounded-3xl border border-white/10 bg-zinc-950 p-5 lg:col-start-1 lg:row-start-2 lg:row-span-2 lg:block lg:self-start">
          <div className="space-y-6">
            {["categories", "strains", "terpenes", "brands", "price"].map((group) => (
              <div key={group}>
                <div className="h-3 w-24 animate-pulse rounded-full bg-white/20" />
                <div className="mt-3 space-y-2">
                  <div className="h-3 w-full animate-pulse rounded-full bg-white/10" />
                  <div className="h-3 w-4/5 animate-pulse rounded-full bg-white/10" />
                  <div className="h-3 w-3/5 animate-pulse rounded-full bg-white/10" />
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Content column. */}
        <div className="lg:col-start-2 lg:row-start-2 lg:space-y-6">
          {/* Toolbar: title on the left, desktop search + sort on the right. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="h-8 w-56 animate-pulse rounded-full bg-white/20 md:h-9" />
            <div className="hidden flex-row items-center gap-2.5 sm:shrink-0 sm:gap-3 lg:flex">
              <div className="h-11 w-full animate-pulse rounded-full border border-white/10 bg-zinc-950 sm:w-[18rem] lg:w-[22rem]" />
              <div className="h-11 w-[8.5rem] shrink-0 animate-pulse rounded-full border border-white/10 bg-zinc-950 sm:w-[11rem]" />
            </div>
          </div>

          {/* Product card placeholders on the real card grid. */}
          <div className={`mt-5 lg:mt-0 ${SHOP_CARD_GRID}`}>
            {skeletonCardKeys().map((key) => (
              <div
                key={key}
                className={`flex ${CARD_MIN_HEIGHT} min-w-0 flex-col justify-between overflow-hidden border border-white/10 bg-zinc-950 p-4`}
              >
                {/* Image well — same height as the real card's. */}
                <div className={`${CARD_IMAGE_HEIGHT} w-full animate-pulse bg-white/10`} />
                {/* Product name (two clamped lines in the real card). */}
                <div className="mx-auto mt-4 h-4 w-4/5 animate-pulse rounded-full bg-white/15" />
                <div className="mx-auto mt-2 h-4 w-3/5 animate-pulse rounded-full bg-white/10" />
                {/* Cannabinoid pill row. */}
                <div className="mt-4 flex gap-2">
                  <div className="h-9 flex-1 animate-pulse rounded-md bg-white/10" />
                  <div className="h-9 flex-1 animate-pulse rounded-md bg-white/10" />
                </div>
                {/* Price + add-to-cart. */}
                <div className="mt-4 h-9 w-full animate-pulse rounded-md bg-white/15" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
