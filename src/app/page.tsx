import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { HomeDailyDeals } from "@/components/home/HomeDailyDeals";
import { PromoGrid } from "@/components/home/PromoGrid";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { StaffShortcut } from "@/components/site/StaffShortcut";
import { posMenuPreviewItems } from "@/lib/pos/preview-menu";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";
import { getCarouselForRender } from "@/lib/cms/carousel-store";

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
  const [slides, copy, preview] = await Promise.all([
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
    isPreviewActive(),
  ]);

  return (
    <main>
      <Header />
      <Hero slides={slides} />
      <HomeDailyDeals items={posMenuPreviewItems} />
      <PromoGrid
        content={{
          categoryImage: copy["home.category.image"],
          categoryEyebrow: copy["home.category.eyebrow"],
          categoryTitle: copy["home.category.title"],
          categorySubtitle: copy["home.category.subtitle"],
          brandImage: copy["home.brand.image"],
          brandEyebrow: copy["home.brand.eyebrow"],
          brandTitle: copy["home.brand.title"],
          brandSubtitle: copy["home.brand.subtitle"],
          editable: preview,
        }}
      />
      <Footer />
      <StaffShortcut />
    </main>
  );
}
