import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { PriceMatchContent } from "@/components/price-match/PriceMatchContent";
import { pageMetadata } from "@/lib/seo/seo";

export const metadata = pageMetadata({
  title: "Price Match Promise — Local Cannabis Pricing",
  description:
    "Greenway Marijuana's price match promise for loyalty members shopping regularly priced cannabis products against local Port Orchard competitors.",
  path: "/price-match",
});

export default function PriceMatchPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Price Match" }]} />
      <PriceMatchContent />
      <Footer />
    </main>
  );
}
