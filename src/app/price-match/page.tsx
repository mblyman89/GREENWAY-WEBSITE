import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { PriceMatchPreview } from "@/components/price-match/PriceMatchPreview";

export const metadata: Metadata = {
  title: "Price Match | Greenway Marijuana",
  description:
    "Greenway Marijuana price match promise details for loyalty members shopping regularly priced products from Port Orchard competitors.",
};

export default function PriceMatchPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Price Match" }]} />
      <PriceMatchPreview />
      <Footer />
    </main>
  );
}
