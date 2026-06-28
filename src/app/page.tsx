import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { HomeDailyDeals } from "@/components/home/HomeDailyDeals";
import { PromoGrid } from "@/components/home/PromoGrid";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { StaffShortcut } from "@/components/site/StaffShortcut";
import { posMenuPreviewItems } from "@/lib/pos/preview-menu";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";

export const metadata: Metadata = {
  // The root layout supplies the default title; we only set the canonical here so
  // the homepage points to the bare domain. We also override the default OG image
  // with the dedicated homepage social-share banner (off-site link previews only).
  alternates: { canonical: "/" },
  openGraph: { images: [{ url: "/og/home.png", alt: "Greenway Marijuana" }] },
  twitter: { images: ["/og/home.png"] },
};

export default async function Home() {
  // Site Content: homepage hero copy (editable from Admin → Site Content).
  const [copy, preview] = await Promise.all([
    getContentValues([
      "home.hero.eyebrow",
      "home.hero.title",
      "home.hero.subtitle",
    ]),
    isPreviewActive(),
  ]);

  return (
    <main>
      <Header />
      <Hero
        content={{
          eyebrow: copy["home.hero.eyebrow"],
          title: copy["home.hero.title"],
          subtitle: copy["home.hero.subtitle"],
          editable: preview,
        }}
      />
      <HomeDailyDeals items={posMenuPreviewItems} />
      <PromoGrid />
      <Footer />
      <StaffShortcut />
    </main>
  );
}
