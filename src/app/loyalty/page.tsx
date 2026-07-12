import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { LoyaltySignupForm } from "@/components/loyalty/LoyaltySignupForm";
import { LoyaltyProgramTerms } from "@/components/loyalty/LoyaltyProgramTerms";
import { pageMetadata } from "@/lib/seo/seo";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";
import { getPageBanners } from "@/lib/cms/page-sections-store";
import { getConfig, listTiers } from "@/lib/loyalty/loyalty-store";
import { loyaltyTermsSummary, tierDisplayRows } from "@/lib/loyalty/program-terms-core";

export const metadata = pageMetadata({
  title: "Loyalty Rewards & Sign-Up — Greenway Points",
  description:
    "Join Greenway Marijuana loyalty rewards for exclusive offers, member discounts, birthday deals, and promotional updates. For adults 21+ in Port Orchard, WA.",
  path: "/loyalty",
  image: "/og/loyalty.png",
});

export default async function LoyaltyPage() {
  const [copy, preview, banners, loyaltyConfig, loyaltyTiers] = await Promise.all([
    getContentValues([
      "loyalty.hero.title",
      "loyalty.hero.subtitle",
      "loyalty.hero.image",
      "loyalty.hero.image_mobile",
    ]),
    isPreviewActive(),
    getPageBanners("loyalty", ["loyalty.hero"]),
    // Live program terms — the SAME config/tiers the register pays with, so the
    // public page can never advertise different numbers (Task T / PR 3).
    getConfig(),
    listTiers(),
  ]);

  // The Loyalty hero is image-led (distinct from a SectionBanner), so the
  // builder section just supplies title/subtitle copy when present; the image
  // stays driven by the loyalty.hero.image* content blocks. Live look unchanged.
  const hero = banners.byKey["loyalty.hero"];

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Loyalty" }]} />
      <LoyaltySignupForm
        content={{
          title: hero?.title || copy["loyalty.hero.title"],
          subtitle: hero?.subtitle || copy["loyalty.hero.subtitle"],
          heroImage: copy["loyalty.hero.image"],
          heroImageMobile: copy["loyalty.hero.image_mobile"],
          editable: preview,
        }}
      />
      <LoyaltyProgramTerms
        terms={loyaltyTermsSummary(loyaltyConfig)}
        tiers={tierDisplayRows(loyaltyTiers)}
      />
      <Footer />
    </main>
  );
}
