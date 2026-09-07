import { Suspense } from "react";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { SiteBackground } from "@/components/site/SiteBackground";
import { InteractiveMenuBrowser } from "@/components/menu/InteractiveMenuBrowser";
import { SectionBanner } from "@/components/home/SectionBanner";
import { ShopBannerCarousel } from "@/components/menu/ShopBannerCarousel";
import { pageMetadata } from "@/lib/seo/seo";
import { loadLiveMenuItemsCached } from "@/lib/pos/live-menu";
import { getPageBanners } from "@/lib/cms/page-sections-store";
import { getShopCarouselForRender, ensureShopCarouselSeeded } from "@/lib/cms/shop-carousel-store";
import { collectShopSaleFilters } from "@/lib/cms/shop-carousel-core";
import { getShopPromotionTitleMap } from "@/lib/cms/shop-promotion-choices";
import { withResolvedImages } from "@/lib/enrichment/image-resolver";
import { withMenuProfile } from "@/lib/menu/strain-terpenes-server";
import { withDisplayKnowledge } from "@/lib/menu/product-knowledge-display";
import { withDohCompliance } from "@/lib/menu/menu-doh-server";
// Option A: owner's per-product website-category overrides (migration 0150).
// Read-time overlay; degrades to identity pre-migration / unconfigured.
import { withCategoryOverride } from "@/lib/menu/menu-category-override-server";
// SLICE 78: the DB-backed category registry — renames/additions made at
// /admin/settings/types propagate to the customer menu through this map.
import { loadCategoryLabelMap } from "@/lib/pos/category-registry";
// SLICE E: trim fields the grid never renders before they are serialized to
// every shopper. Verified unread by the menu client tree; the PDP is unaffected.
import { toMenuGridItems } from "@/lib/menu/menu-grid-projection-core";

/**
 * SLICE E — THE SHOP PAGE COULD NEVER BE REUSED.
 *
 * This route had NO segment config at all, and it reads `searchParams` at the
 * top level. Next.js documents exactly what that costs:
 *
 *   "`searchParams` is a Request-time API whose values cannot be known ahead
 *    of time. Using it will opt the page into dynamic rendering at request
 *    time."
 *   — nextjs.org/docs/app/api-reference/file-conventions/page
 *
 * So every shopper rebuilt this page from scratch. That is the SAME condition
 * the home page was in before Slice D, and removing it is precisely why the
 * home page is now instant. The absence of `searchParams` was the only
 * structural difference between the two routes.
 *
 * `revalidate = 60` matches MENU_CACHE_TTL_SECONDS, so the page cache and the
 * menu data cache expire on the same schedule instead of fighting each other.
 * Publishing stays INSTANT regardless of this number: `/menu` is listed in
 * PUBLIC_MENU_SURFACES, so `revalidatePublicMenuSurfaces()` clears the data tag
 * and then calls `revalidatePath("/menu")` in the same action.
 *
 * The filters keep working. `InteractiveMenuBrowser` resolves them from the
 * LIVE browser URL (`resolveInitialParams`, InteractiveMenuBrowser.tsx:630) and
 * the live URL takes precedence over anything the server passed, so a shopper
 * arriving on a deep link still lands on the right filtered view.
 */
export const revalidate = 60;

export const metadata = pageMetadata({
  title: "Shop Cannabis Menu — Flower, Vapes, Edibles & More",
  description:
    "Shop Greenway Marijuana's full Port Orchard cannabis menu: flower, prerolls, cartridges, concentrates, edibles, tinctures, topicals, and accessories with live prices and stock.",
  path: "/menu",
  image: "/og/menu.png",
});

type MenuPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function MenuPage({ searchParams }: MenuPageProps) {
  const resolvedSearchParams = await searchParams;
  // DF-3: attach resolved product images (exact → brand/vendor → category →
  // inventory → global). Non-throwing; falls back to the stylized mockup.
  // Attach curated terpenes (from the KB strain) so the menu can filter by
  // terpene. Sensory/descriptive only; degrades to no terpenes when unmatched.
  // 7b.2: KB-first curated copy + terpene fallback, compliance-filtered, batched
  // (one resolve for the whole menu \u2014 no per-card DB reads). Non-throwing.
  // SLICE D (SHOP-4): overlay the DOH-compliant flag (+ WAC 246-70 category)
  // from the durable medical_product_registry (migration 0113), keyed by the
  // item id. Outermost so it runs on the fully-enriched items; degrades to
  // "no DOH" pre-migration / unconfigured. (Badge render = Slice F.)
  const enrichedMenuItems = await withCategoryOverride(
    await withDohCompliance(
      await withDisplayKnowledge(
        await withResolvedImages(await withMenuProfile(await loadLiveMenuItemsCached())),
      ),
    ),
  );
  // SLICE E: drop what the grid never renders before this array is serialized
  // into the response for every shopper. `description` is unread by the entire
  // menu client tree (the product DETAIL page loads its own item, so it still
  // shows the full copy) and `hiddenReason` is dead weight because hidden items
  // are already filtered out. Measured on a realistic catalog with unique
  // descriptions: ~56 KB less compressed on every shop page load. The item type
  // is unchanged, so no card component is affected.
  const menuItems = toMenuGridItems(enrichedMenuItems);
  // SLICE D (performance) — THESE READS NO LONGER QUEUE BEHIND EACH OTHER.
  //
  // Each of the following was its own `await` on its own line, so the page sat
  // through category labels, THEN banners, THEN the carousel, THEN the
  // promotion titles, one after another. None of them depends on any of the
  // others, so the waiting was pure latency stacked in series. Vercel's Active
  // CPU guide calls this out directly: "Use the preloading pattern to start
  // independent I/O together."
  //
  // The one real ordering constraint is kept: the carousel seed must finish
  // before the carousel is read, so those two stay chained inside their own
  // branch of the Promise.all rather than being flattened alongside it.
  const [categoryLabels, banners, shopSlides, promotionTitles] = await Promise.all([
    // SLICE 78: owner-managed category labels (value → label). Serializable, so
    // the client menu can render the owner's names; empty map = old behavior.
    loadCategoryLabelMap(),
    // Pages-builder banners for /menu: any EXTRA banners staff add render under
    // the top carousel. (The primary top banner is now the Shop banner carousel,
    // edited at Admin → Content → Shop Banner — see below.)
    getPageBanners("menu", ["menu.hero"]),
    // SLICE A (SHOP-1): the Shop top banner is now a staff-managed CAROUSEL (up
    // to ten "special" slides). Resolve them draft-aware; the store falls back
    // to a single default slide (matching the old static banner) pre-migration /
    // when empty, so this never blanks. Seed is idempotent + no-ops
    // pre-migration, and MUST complete before the read below.
    ensureShopCarouselSeeded().then(() => getShopCarouselForRender()),
    getShopPromotionTitleMap(),
  ]);
  // SLICE C (SHOP-3): the one-off SALE filters a slide links (SLICE B) become
  // dynamic sidebar checkboxes. Collect them here (server) from the SAME slides
  // the carousel renders, using the promotion titles for any unnamed filter, and
  // hand the plain {id,name,promotionId} list to the browser. Degrades to an
  // empty list pre-migration / when nothing is linked (the sidebar then shows
  // just the two built-in lanes). Pure — no I/O — so it stays out of the batch.
  const saleFilters = collectShopSaleFilters(shopSlides, promotionTitles);
  const initialSearchParams = {
    search: firstSearchParamValue(resolvedSearchParams?.search),
    category: firstSearchParamValue(resolvedSearchParams?.category),
    brand: firstSearchParamValue(resolvedSearchParams?.brand),
    special: firstSearchParamValue(resolvedSearchParams?.special),
    // Richer persisted filter params (Task G) so server + client agree and the
    // menu restores the shopper's exact state when returning from a product page.
    categories: firstSearchParamValue(resolvedSearchParams?.categories),
    strains: firstSearchParamValue(resolvedSearchParams?.strains),
    brands: firstSearchParamValue(resolvedSearchParams?.brands),
    // PR 3: additive by-vendor filter (Home vendor cards deep-link ?vendors=<vendor>).
    vendors: firstSearchParamValue(resolvedSearchParams?.vendors),
    weights: firstSearchParamValue(resolvedSearchParams?.weights),
    maxThc: firstSearchParamValue(resolvedSearchParams?.maxThc),
    maxCbd: firstSearchParamValue(resolvedSearchParams?.maxCbd),
    maxPrice: firstSearchParamValue(resolvedSearchParams?.maxPrice),
    sort: firstSearchParamValue(resolvedSearchParams?.sort),
    // SLICE E (SHOP-5): the DOH lane, so a shared /menu?doh=... link renders
    // already-filtered on the server instead of flashing the full grid.
    doh: firstSearchParamValue(resolvedSearchParams?.doh),
    // SLICE 18B: same for the sales-limit classification lane, so
    // /menu?classification=low-thc is shareable and deep-linkable (the back
    // office links straight to it).
    classification: firstSearchParamValue(resolvedSearchParams?.classification),
  };
  return (
    <main id="top">
      <SiteBackground />
      <Header />

      {/* Breadcrumb sits ABOVE the hero, consistent with every other page.
          (BreadcrumbList JSON-LD is emitted automatically by <Breadcrumbs>.) */}
      <Breadcrumbs
        items={[{ label: "Shop", href: "/menu" }]}
        maxWidthClassName="max-w-[var(--shop-max)]"
      />

      {/* SLICE A (SHOP-1): the top banner is now a staff-managed CAROUSEL of up
          to ten "special" slides (Admin → Content → Shop Banner). Falls back to
          a single default slide matching the old static banner, so the page is
          effectively unchanged until staff edit + publish. */}
      <ShopBannerCarousel slides={shopSlides} />

      {/* Extra banners staff added in the Pages builder render here. */}
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
        <Suspense fallback={<div className="mx-auto max-w-[var(--shop-max)] px-4 py-10 text-sm font-bold text-zinc-400 md:px-8">Loading menu filters...</div>}>
          <InteractiveMenuBrowser items={menuItems} initialSearchParams={initialSearchParams} categoryLabels={categoryLabels} saleFilters={saleFilters} />
        </Suspense>
      </section>
      <Footer />
    </main>
  );
}
