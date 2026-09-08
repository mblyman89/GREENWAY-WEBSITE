import { Suspense } from "react";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { SiteBackground } from "@/components/site/SiteBackground";
import { InteractiveMenuBrowser } from "@/components/menu/InteractiveMenuBrowser";
import { SectionBanner } from "@/components/home/SectionBanner";
import { ShopBannerCarousel } from "@/components/menu/ShopBannerCarousel";
import { loadLiveMenuItemsCached } from "@/lib/pos/live-menu";
import { getPageBanners } from "@/lib/cms/page-sections-store";
import { getShopCarouselForRender, ensureShopCarouselSeeded } from "@/lib/cms/shop-carousel-store";
import { collectShopSaleFilters } from "@/lib/cms/shop-carousel-core";
import { getShopPromotionTitleMap } from "@/lib/cms/shop-promotion-choices";
import { withResolvedImages } from "@/lib/enrichment/image-resolver";
import { withMenuProfile } from "@/lib/menu/strain-terpenes-server";
import { withDisplayKnowledge } from "@/lib/menu/product-knowledge-display";
import { withDohCompliance } from "@/lib/menu/menu-doh-server";
import { withCategoryOverride } from "@/lib/menu/menu-category-override-server";
import { loadCategoryLabelMap } from "@/lib/pos/category-registry";
import { toMenuGridItems } from "@/lib/menu/menu-grid-projection-core";
import { ShopBannerSkeleton, ShopBrowserSkeleton } from "@/components/menu/MenuSkeleton";

/**
 * SLICE H — ONE SHOP RENDERER, TWO ROUTES.
 *
 * `/menu` and `/menu/[category]` must look and behave identically; the only
 * difference is which category the grid opens on and what the breadcrumb says.
 * Copying the page into a second file would guarantee they drift — a banner fix
 * applied to one and not the other, a skeleton updated in one place.
 *
 * So the entire shop render lives here once and both routes call it.
 *
 * WHY THIS IS SAFE TO CACHE
 * ─────────────────────────
 * Nothing in this component reads a request-time API. There is no
 * `searchParams`, no `cookies()`, no `headers()`. The category arrives as a
 * plain string argument, which the caller derives from a ROUTE SEGMENT — known
 * at build time — rather than from a query string, which is not.
 *
 * `draftMode()` IS still reached, through `getShopCarouselForRender` and
 * `getPageBanners`. That is deliberate and proven safe: the home page calls
 * `draftMode()` the same way through `getSectionsForRender` and caches as
 * `STALE`. Draft Mode was suspected as the cache blocker three separate times
 * across earlier slices and measurement cleared it every time.
 *
 * THE STREAMING SHAPE IS PRESERVED (Slice F2)
 * ───────────────────────────────────────────
 * `ShopPage` awaits NOTHING before its `return`. All catalog I/O stays inside
 * `<ShopContent>` below the Suspense boundary, so the shell — background,
 * header, breadcrumbs — still flushes in the first chunk while the catalog is
 * read. Losing that would undo Slice F2.
 */

export type ShopPageProps = {
  /**
   * The category this route opens on, or `undefined` for the full menu.
   *
   * Comes from a route segment, never from a query string. That distinction is
   * the entire point of this slice: a segment is statically known, so the route
   * can be prerendered; a query string is request-time, so it cannot.
   */
  initialCategory?: string;
  /** Breadcrumb trail, built by the caller from the pure facet core. */
  breadcrumbs: Array<{ label: string; href: string }>;
  /**
   * Optional visible heading for a category route. The full menu passes
   * nothing and keeps the browser's own default heading.
   */
  heading?: string;
  /** Optional sub-heading, sourced from the category taxonomy's helper text. */
  subheading?: string;
};

/**
 * The expensive half. Every catalog read lives here, below the boundary, so the
 * shell can flush before any of it resolves.
 */
async function ShopContent({ initialCategory }: { initialCategory?: string }) {
  // DF-3 / 7b.2 / SLICE D: the enrichment chain, unchanged. Image resolution,
  // curated terpenes, KB display copy, DOH compliance overlay, then the owner's
  // per-product category overrides on the fully-enriched items.
  const enrichedMenuItems = await withCategoryOverride(
    await withDohCompliance(
      await withDisplayKnowledge(
        await withResolvedImages(await withMenuProfile(await loadLiveMenuItemsCached())),
      ),
    ),
  );
  // SLICE E: drop fields the grid never renders before this array is serialized
  // into the response for every shopper.
  const menuItems = toMenuGridItems(enrichedMenuItems);

  // SLICE D: independent reads start together instead of queueing in series.
  // The one real ordering constraint — seed before read — stays chained inside
  // its own branch rather than being flattened alongside the others.
  const [categoryLabels, banners, shopSlides, promotionTitles] = await Promise.all([
    loadCategoryLabelMap(),
    getPageBanners("menu", ["menu.hero"]),
    ensureShopCarouselSeeded().then(() => getShopCarouselForRender()),
    getShopPromotionTitleMap(),
  ]);

  // SLICE C (SHOP-3): sale filters collected from the same slides the carousel
  // renders. Pure — no I/O — so it stays out of the batch above.
  const saleFilters = collectShopSaleFilters(shopSlides, promotionTitles);

  return (
    <>
      <ShopBannerCarousel slides={shopSlides} />

      {banners.extras.length ? (
        <section className="px-4 pb-2 md:px-8">
          <div className="mx-auto max-w-[var(--shop-max)] space-y-4 md:space-y-6">
            {banners.extras.map((s) => (
              <SectionBanner
                key={s.key}
                imageSrc={s.image}
                imageAlt={s.imageAlt}
                eyebrow={s.eyebrow}
                title={s.title}
                subtitle={s.subtitle}
                buttons={s.buttons}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section id="products">
        {/*
          SLICE H: the category now arrives from the ROUTE, not the query string.
          `InteractiveMenuBrowser` already merges whatever it is given with the
          live browser URL (`resolveInitialParams`), and the live URL wins — so
          a shopper who lands on /menu/flower and then ticks extra filters keeps
          working exactly as before, and every long-tail filter stays client-side.
        */}
        <InteractiveMenuBrowser
          items={menuItems}
          initialSearchParams={initialCategory ? { category: initialCategory } : {}}
          categoryLabels={categoryLabels}
          saleFilters={saleFilters}
        />
      </section>
    </>
  );
}

/**
 * The shop shell. Returns immediately so the first chunk carries real markup.
 */
export function ShopPage({ initialCategory, breadcrumbs, heading, subheading }: ShopPageProps) {
  return (
    <main id="top">
      <SiteBackground />
      <Header />

      <Breadcrumbs items={breadcrumbs} maxWidthClassName="max-w-[var(--shop-max)]" />

      {heading ? (
        <section className="px-3 pt-4 sm:px-4 md:px-8">
          <div className="mx-auto max-w-[var(--shop-max)]">
            <h1 className="text-2xl font-black uppercase tracking-tight text-white md:text-3xl">
              {heading}
            </h1>
            {subheading ? (
              <p className="mt-1.5 max-w-3xl text-sm text-white/60">{subheading}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <Suspense
        fallback={
          <>
            <ShopBannerSkeleton />
            <ShopBrowserSkeleton />
          </>
        }
      >
        <ShopContent initialCategory={initialCategory} />
      </Suspense>

      <Footer />
    </main>
  );
}
