import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { HomeDailyDeals } from "@/components/home/HomeDailyDeals";
import { PromoGrid } from "@/components/home/PromoGrid";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { StaffShortcut } from "@/components/site/StaffShortcut";
import { posMenuPreviewItems } from "@/lib/pos/preview-menu";
import { withMenuProfile } from "@/lib/menu/strain-terpenes-server";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";
import { getCarouselForRender } from "@/lib/cms/carousel-store";
import { getSectionsForRender } from "@/lib/cms/page-sections-store";

export const metadata: Metadata = {
  // The root layout supplies the default title; we only set the canonical here so
  // the homepage points to the bare domain. We also override the default OG image
  // with the dedicated homepage social-share banner (off-site link previews only).
  alternates: { canonical: "/" },
  openGraph: { images: [{ url: "/og/home.png", alt: "Greenway Marijuana" }] },
  twitter: { images: ["/og/home.png"] },
};

export default async function Home() {
  // Hero slides come from the staff-managed Home Carousel (draft-aware).
  // Section-banner copy/images are editable from Admin → Site Content.
  const [slides, copy, sections, preview, dealItems] = await Promise.all([
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
    // hybrids + terpenes). No-op when no KB/curated match.
    withMenuProfile(posMenuPreviewItems),
  ]);

  // Map the new page_sections rows (by section_key) onto the banner content.
  const category = sections.find((s) => s.key === "home.category");
  const brand = sections.find((s) => s.key === "home.brand");

  return (
    <main>
      <Header />
      <Hero slides={slides} />
      <HomeDailyDeals items={dealItems} />
      <PromoGrid
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
