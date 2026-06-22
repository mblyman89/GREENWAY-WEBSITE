import { Hero } from "@/components/home/Hero";
import { PromoGrid } from "@/components/home/PromoGrid";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";

export default function Home() {
  return (
    <main>
      <Header />
      <Hero />
      <PromoGrid />
      <Footer />
    </main>
  );
}
