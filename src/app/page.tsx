import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { HomeDailyDeals } from "@/components/home/HomeDailyDeals";
import { PromoGrid } from "@/components/home/PromoGrid";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { posMenuPreviewItems } from "@/lib/pos/preview-menu";

export const metadata: Metadata = {
  // The root layout supplies the default title; we only set the canonical here so
  // the homepage points to the bare domain. We also override the default OG image
  // with the dedicated homepage social-share banner (off-site link previews only).
  alternates: { canonical: "/" },
  openGraph: { images: [{ url: "/og/home.png", alt: "Greenway Marijuana" }] },
  twitter: { images: ["/og/home.png"] },
};

export default function Home() {
  return (
    <main>
      <Header />
      <Hero />
      <HomeDailyDeals items={posMenuPreviewItems} />
      <PromoGrid />
      <Footer />
    </main>
  );
}
