import { PageBuilderBanners } from "@/components/site/PageBuilderBanners";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { PriceMatchContent } from "@/components/price-match/PriceMatchContent";
import { pageMetadata } from "@/lib/seo/seo";
import { withSeoOverride } from "@/lib/seo/seo-entries-server";

const baseMetadata = pageMetadata({
  title: "Price Match Promise — Local Cannabis Pricing",
  description:
    "Greenway Marijuana's price match promise for loyalty members shopping regularly priced cannabis products against local Port Orchard competitors.",
  path: "/price-match",
});

// R46-S2: the SEO Editor (/admin/content/seo) can override title, description,
// canonical, no-index and share image; the values above are the defaults.
export async function generateMetadata() {
  return withSeoOverride(baseMetadata, "/price-match");
}

export default function PriceMatchPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Price Match" }]} />
      <PriceMatchContent />
      {/* R42 Q3: optional banners from Admin → Pages (price-match); renders nothing when none are published. */}
      <PageBuilderBanners pageSlug="price-match" />
      <Footer />
    </main>
  );
}
