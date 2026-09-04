import { Suspense } from "react";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { SiteBackground } from "@/components/site/SiteBackground";
import { InteractiveMenuBrowser } from "@/components/menu/InteractiveMenuBrowser";
import { SectionBanner } from "@/components/home/SectionBanner";
import { ShopBannerCarousel } from "@/components/menu/ShopBannerCarousel";
import { pageMetadata } from "@/lib/seo/seo";
import { loadLiveMenuItems } from "@/lib/pos/live-menu";
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
  const menuItems = await withCategoryOverride(
    await withDohCompliance(
      await withDisplayKnowledge(
        await withResolvedImages(await withMenuProfile(await loadLiveMenuItems())),
      ),
    ),
  );
  // SLICE 78: owner-managed category labels (value → label). Serializable, so
  // the client menu can render the owner's names; empty map = old behavior.
  const categoryLabels = await loadCategoryLabelMap();
  // Pages-builder banners for /menu: any EXTRA banners staff add render under
  // the top carousel. (The primary top banner is now the Shop banner carousel,
  // edited at Admin → Content → Shop Banner — see below.)
  const banners = await getPageBanners("menu", ["menu.hero"]);
  // SLICE A (SHOP-1): the Shop top banner is now a staff-managed CAROUSEL (up to
  // ten "special" slides). Resolve them draft-aware; the store falls back to a
  // single default slide (matching the old static banner) pre-migration / when
  // empty, so this never blanks. Seed is idempotent + no-ops pre-migration.
  await ensureShopCarouselSeeded();
  const shopSlides = await getShopCarouselForRender();
  // SLICE C (SHOP-3): the one-off SALE filters a slide links (SLICE B) become
  // dynamic sidebar checkboxes. Collect them here (server) from the SAME slides
  // the carousel renders, using the promotion titles for any unnamed filter, and
  // hand the plain {id,name,promotionId} list to the browser. Degrades to an
  // empty list pre-migration / when nothing is linked (the sidebar then shows
  // just the two built-in lanes).
  const saleFilters = collectShopSaleFilters(shopSlides, await getShopPromotionTitleMap());
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
