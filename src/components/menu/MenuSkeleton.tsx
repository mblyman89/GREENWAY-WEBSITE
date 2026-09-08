import {
  SHOP_GRID_SHELL,
  SHOP_CARD_GRID,
  CARD_MIN_HEIGHT,
  CARD_IMAGE_HEIGHT,
  HEADER_RESERVE_HEIGHT,
  skeletonCardKeys,
} from "@/lib/menu/menu-skeleton-core";

/**
 * SLICE F1 + F2 — THE ONE SHOP SKELETON, USED IN BOTH PLACES.
 *
 * The shop page needs a placeholder in TWO different situations, and they must
 * look identical or the page will visibly change shape between them:
 *
 *   1. NAVIGATION  — a shopper taps "Shop". Next.js renders the nearest
 *      `loading.tsx` (now `src/app/menu/loading.tsx`) while the route loads.
 *
 *   2. STREAMING   — the route has begun rendering and the shell has flushed,
 *      but the product data is still being read. React shows the `<Suspense>`
 *      fallback inside `src/app/menu/page.tsx`.
 *
 * Before Slice F2 the second case rendered the string "Loading menu filters..."
 * — and in practice never appeared at all, because every `await` in the page
 * completed BEFORE the `return`, so there was nothing left for `<Suspense>` to
 * wait on. The boundary was decorative.
 *
 * Keeping both cases in this one module means a change to the skeleton can
 * never apply to one path and not the other. The geometry itself comes from
 * `menu-skeleton-core`, where each measurement is pinned by a self-test against
 * the real components so the placeholder cannot drift and start causing layout
 * shift.
 *
 * Nothing here reads data. These must render synchronously — the instant a
 * skeleton awaits something it stops being a skeleton.
 */

/**
 * SLICE G — reserve the sticky header's height while the route loads.
 *
 * `loading.tsx` cannot render the real `<Header />`: it is an async server
 * component that awaits `getContentForRender(MEDICAL_HIDE_BLOCK)`, and a
 * skeleton that awaits I/O is not a skeleton. So it rendered nothing at all —
 * and when `page.tsx` took over WITH a header, everything below jumped down
 * 99px (measured live at 412px: banner top 37px → 136px).
 *
 * This reserves the same vertical space with no I/O, so the handoff moves
 * nothing. Heights come from `HEADER_RESERVE_HEIGHT`, which is pinned to
 * live-measured header heights at each breakpoint.
 */
export function ShopHeaderSkeleton() {
  return (
    <div
      aria-hidden="true"
      className={`w-full border-b border-white/10 bg-black/88 ${HEADER_RESERVE_HEIGHT}`}
    />
  );
}

/** Breadcrumb bar placeholder — mirrors <Breadcrumbs> so content starts at the same Y. */
export function ShopBreadcrumbSkeleton() {
  return (
    <nav aria-hidden="true" className="border-b border-white/10 bg-black/80 px-4 py-3 md:px-8">
      <div className="mx-auto flex max-w-[var(--shop-max)] items-center gap-2">
        <div className="h-3 w-12 animate-pulse rounded-full bg-white/15" />
        <div className="h-3 w-3 rounded-full bg-white/5" />
        <div className="h-3 w-16 animate-pulse rounded-full bg-white/20" />
      </div>
    </nav>
  );
}

/**
 * Shop banner placeholder. Matches ShopBannerCarousel's own responsive box:
 * `aspect-[3/1]` below md, `min-h-[8.5rem]` / `md:min-h-[10.5rem]` at md.
 */
export function ShopBannerSkeleton() {
  return (
    <section className="border-b border-white/10 bg-black px-4 py-4 md:px-8 md:py-5">
      <div className="mx-auto max-w-[var(--shop-max)]">
        <div className="relative aspect-[3/1] animate-pulse overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] md:hidden" />
        <div className="relative hidden min-h-[8.5rem] animate-pulse overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] md:block md:min-h-[10.5rem]" />
      </div>
    </section>
  );
}

/**
 * The browser placeholder: filter rail + product grid, on the REAL grid tracks
 * so the swap to the live browser does not move anything.
 */
export function ShopBrowserSkeleton() {
  return (
    <section className={SHOP_GRID_SHELL} aria-busy="true" aria-label="Loading products">
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
        {/* Toolbar: title left, desktop search + sort right. */}
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
              <div className={`${CARD_IMAGE_HEIGHT} w-full animate-pulse bg-white/10`} />
              <div className="mx-auto mt-4 h-4 w-4/5 animate-pulse rounded-full bg-white/15" />
              <div className="mx-auto mt-2 h-4 w-3/5 animate-pulse rounded-full bg-white/10" />
              <div className="mt-4 flex gap-2">
                <div className="h-9 flex-1 animate-pulse rounded-md bg-white/10" />
                <div className="h-9 flex-1 animate-pulse rounded-md bg-white/10" />
              </div>
              <div className="mt-4 h-9 w-full animate-pulse rounded-md bg-white/15" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
