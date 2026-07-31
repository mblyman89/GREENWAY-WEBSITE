import { Suspense } from "react";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { InteractiveMenuBrowser } from "@/components/menu/InteractiveMenuBrowser";
import { SectionBanner } from "@/components/home/SectionBanner";
import { ShopBannerCarousel } from "@/components/menu/ShopBannerCarousel";
import { pageMetadata } from "@/lib/seo/seo";
import { loadLiveMenuItems } from "@/lib/pos/live-menu";
import { getPageBanners } from "@/lib/cms/page-sections-store";
import { getShopCarouselForRender, ensureShopCarouselSeeded } from "@/lib/cms/shop-carousel-store";
import { withResolvedImages } from "@/lib/enrichment/image-resolver";
import { withMenuProfile } from "@/lib/menu/strain-terpenes-server";
import { withDisplayKnowledge } from "@/lib/menu/product-knowledge-display";
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
  const menuItems = await withDisplayKnowledge(
    await withResolvedImages(await withMenuProfile(await loadLiveMenuItems())),
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
    weights: firstSearchParamValue(resolvedSearchParams?.weights),
    maxThc: firstSearchParamValue(resolvedSearchParams?.maxThc),
    maxCbd: firstSearchParamValue(resolvedSearchParams?.maxCbd),
    maxPrice: firstSearchParamValue(resolvedSearchParams?.maxPrice),
    sort: firstSearchParamValue(resolvedSearchParams?.sort),
  };
  return (
    <main id="top">
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
        <section className="bg-black px-4 pb-2 md:px-8">
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
          <InteractiveMenuBrowser items={menuItems} initialSearchParams={initialSearchParams} categoryLabels={categoryLabels} />
        </Suspense>
      </section>
      <Footer />
    </main>
  );
}
