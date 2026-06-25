import { Hero } from "@/components/home/Hero";
import { HomeDailyDeals } from "@/components/home/HomeDailyDeals";
import { PromoGrid } from "@/components/home/PromoGrid";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { posMenuPreviewItems } from "@/lib/pos/preview-menu";

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
