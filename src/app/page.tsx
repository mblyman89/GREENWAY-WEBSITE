import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { HomeDailyDeals } from "@/components/home/HomeDailyDeals";
import { PromoGrid } from "@/components/home/PromoGrid";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { SiteBackground } from "@/components/site/SiteBackground";
import { StaffShortcut } from "@/components/site/StaffShortcut";
import { loadLiveMenuItemsCached } from "@/lib/pos/live-menu";
import { withMenuProfile } from "@/lib/menu/strain-terpenes-server";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";
import { getCarouselForRender } from "@/lib/cms/carousel-store";
import { getSectionsForRender } from "@/lib/cms/page-sections-store";
import {
  buildVendorDirectory,
  enrichVendorDirectory,
} from "@/lib/menu/vendor-directory-core";
import { listPublicVendorProfiles } from "@/lib/vendors/store";
import {
  readHomeCardCount,
  readLaneImages,
  DAILY_DEALS_COUNT_KEY,
  BRAND_COUNT_KEY,
} from "@/lib/cms/home-section-settings-core";

export const metadata: Metadata = {
  // The root layout supplies the default title; we only set the canonical here so
  // the homepage points to the bare domain. We also override the default OG image
  // with the dedicated homepage social-share banner (off-site link previews only).
  alternates: { canonical: "/" },
  openGraph: { images: [{ url: "/og/home.png", alt: "Greenway Marijuana" }] },
  twitter: { images: ["/og/home.png"] },
};

// The home page shows live product cards (daily deals + brand grid) sourced from
// the published DB menu, so it must not be frozen at build time. It is also the
// first thing every customer loads, so it must not be rebuilt from scratch for
// every one of them either.
//
// SLICE D (performance) — WHY THIS IS NO LONGER `force-dynamic`.
//
// `force-dynamic` does not mean "reads fresh data"; it means "this page may
// never be reused". Next.js implements it by forcing `cache: 'no-store'` and
// `revalidate: 0` onto the whole render, so every visitor paid for a complete
// server render of the deal grid and the vendor directory — the same render,
// repeated, several seconds each. That is the measured home-page cost.
//
// `revalidate = 60` keeps the page live while letting visitors within the same
// minute share one render. Freshness is unchanged in the way that actually
// matters, because the TTL is the FLOOR, not the mechanism:
//
//   * Publishing from the back office calls revalidatePublicMenuSurfaces()
//     (src/lib/site/public-surfaces.ts), whose PUBLIC_MENU_SURFACES list starts
//     with "/" — this page — and which clears the live-menu data tag FIRST and
//     then the page. A publish is still visible immediately.
//   * Staff preview is unaffected: Draft Mode bypasses the route cache by
//     design, so isPreviewActive() below still sees drafts on demand.
//   * 60 s matches MENU_CACHE_TTL_SECONDS, the TTL the menu data cache has used
//     since Slice A. One number, one meaning, both layers.
//
// The bounded risk is the same one that policy already accepts and documents:
// for at most a minute a card can advertise something that just sold out. The
// register is not cached, and order pricing rejects a stale line with the
// existing 409. We can show a stale card; we can never take stale money.
export const revalidate = 60;

export default async function Home() {
  // Hero slides come from the staff-managed Home Carousel (draft-aware).
  // Section-banner copy/images are editable from Admin → Site Content.
  const [slides, copy, sections, preview, dealItems, vendorProfiles] = await Promise.all([
    getCarouselForRender(),
    getContentValues([
      "home.category.image",
      "home.category.eyebrow",
      "home.category.title",
      "home.category.subtitle",
      "home.brand.image",
      "home.brand.eyebrow",
      "home.brand.title",
      "home.brand.subtitle",
    ]),
    // New per-page sections (Pages → Home → Sections). When present, these are
    // the source of truth for the Category + Brand banners; otherwise we fall
    // back to the legacy content_blocks copy, then to hardcoded defaults.
    getSectionsForRender("home"),
    isPreviewActive(),
    // Overlay the KB strain profile so home deal cards match the menu (leaning
    // hybrids + terpenes). No-op when no KB/curated match. Menu now comes from
    // the PUBLISHED DB version (dynamic), not a static snapshot.
    loadLiveMenuItemsCached().then((items) => withMenuProfile(items)),
    // PR 2: back-office vendor profiles (logo + copy) for the "Shop by Brand"
    // section, which now shows VENDOR cards. Defensive (empty when off).
    listPublicVendorProfiles(),
  ]);

  // PR 2 (owner Option B): the "Shop by Brand" section now groups by VENDOR —
  // the same pipeline the public Vendors page uses — so the homepage shows one
  // card per producer (fixing the old bug where free-text `brand` grouping
  // surfaced only a single card when the menu carried several vendors).
  // buildVendorDirectory skips hidden items; enrichVendorDirectory folds in the
  // real logo/description from the vendors table.
  const vendors = enrichVendorDirectory(
    buildVendorDirectory(dealItems),
    vendorProfiles,
  );

  // Map the new page_sections rows (by section_key) onto the banner content.
  const category = sections.find((s) => s.key === "home.category");
  const brand = sections.find((s) => s.key === "home.brand");
  // SLICE 112: owner-controlled card counts live in page_sections.settings JSON.
  // The daily-deal highlights count is stored on the dedicated (locked)
  // home.settings section; the brand-grid count on the home.brand section.
  // Both fall back to 16 (the count the homepage shipped with) when unset.
  const homeSettings = sections.find((s) => s.key === "home.settings");
  const dailyDealsCount = readHomeCardCount(
    homeSettings?.settings,
    DAILY_DEALS_COUNT_KEY,
  );
  const brandCount = readHomeCardCount(brand?.settings, BRAND_COUNT_KEY);
  // Per-lane category-tile images (owner-uploaded via the Home Sections editor).
  // Unset lanes resolve to "" so the tile renders its clean text-only fallback.
  const laneImages = readLaneImages(category?.settings);

  return (
    <main>
      <SiteBackground />
      <Header />
      <Hero slides={slides} />
      <HomeDailyDeals items={dealItems} count={dailyDealsCount} />
      <PromoGrid
        vendors={vendors}
        brandCount={brandCount}
        laneImages={laneImages}
        content={{
          categoryImage: category?.image || copy["home.category.image"],
          categoryEyebrow: category?.eyebrow || copy["home.category.eyebrow"],
          categoryTitle: category?.title || copy["home.category.title"],
          categorySubtitle:
            category?.subtitle || copy["home.category.subtitle"],
          brandImage: brand?.image || copy["home.brand.image"],
          brandEyebrow: brand?.eyebrow || copy["home.brand.eyebrow"],
          brandTitle: brand?.title || copy["home.brand.title"],
          brandSubtitle: brand?.subtitle || copy["home.brand.subtitle"],
          editable: preview,
        }}
      />
      <Footer />
      <StaffShortcut />
    </main>
  );
}
