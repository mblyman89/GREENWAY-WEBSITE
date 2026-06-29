import { SpecialsContent } from "@/components/specials/SpecialsContent";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { pageMetadata } from "@/lib/seo/seo";
import { getThursdayBrands } from "@/lib/promotions/storefront-bridge";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";
import { getPageBanners } from "@/lib/cms/page-sections-store";

export const metadata = pageMetadata({
  title: "Cannabis Specials & Daily Deals — Port Orchard",
  description:
    "See Greenway Marijuana's cannabis specials: daily discounts, top-shelf deals, and 50% off clearance on flower, vapes, edibles, and more in Port Orchard, WA.",
  path: "/specials",
  image: "/og/specials.png",
});

export default async function SpecialsPage() {
  // DB-published Thursday brands (back-office promotions) with static fallback.
  const [thursdayBrands, copy, preview, banners] = await Promise.all([
    getThursdayBrands(),
    getContentValues([
      "specials.hero.eyebrow",
      "specials.hero.title",
      "specials.hero.subtitle",
    ]),
    isPreviewActive(),
    getPageBanners("specials", ["specials.hero"]),
  ]);

  // Pages-builder hero (specials.hero) is the source of truth when present;
  // otherwise fall back to the content-block copy (live look unchanged).
  const hero = banners.byKey["specials.hero"];

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Specials" }]} />
      <SpecialsContent
        thursdayBrands={thursdayBrands}
        content={{
          eyebrow: hero?.eyebrow || copy["specials.hero.eyebrow"],
          title: hero?.title || copy["specials.hero.title"],
          subtitle: hero?.subtitle || copy["specials.hero.subtitle"],
          buttons: hero?.buttons,
          extraSections: banners.extras,
          editable: preview,
        }}
      />
      <Footer />
    </main>
  );
}
