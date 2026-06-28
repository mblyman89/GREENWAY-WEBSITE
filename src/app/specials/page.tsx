import { SpecialsContent } from "@/components/specials/SpecialsContent";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { pageMetadata } from "@/lib/seo/seo";
import { getThursdayBrands } from "@/lib/promotions/storefront-bridge";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";

export const metadata = pageMetadata({
  title: "Cannabis Specials & Daily Deals — Port Orchard",
  description:
    "See Greenway Marijuana's cannabis specials: daily discounts, top-shelf deals, and 50% off clearance on flower, vapes, edibles, and more in Port Orchard, WA.",
  path: "/specials",
  image: "/og/specials.png",
});

export default async function SpecialsPage() {
  // DB-published Thursday brands (back-office promotions) with static fallback.
  const [thursdayBrands, copy, preview] = await Promise.all([
    getThursdayBrands(),
    getContentValues([
      "specials.hero.eyebrow",
      "specials.hero.title",
      "specials.hero.subtitle",
    ]),
    isPreviewActive(),
  ]);

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Specials" }]} />
      <SpecialsContent
        thursdayBrands={thursdayBrands}
        content={{
          eyebrow: copy["specials.hero.eyebrow"],
          title: copy["specials.hero.title"],
          subtitle: copy["specials.hero.subtitle"],
          editable: preview,
        }}
      />
      <Footer />
    </main>
  );
}
