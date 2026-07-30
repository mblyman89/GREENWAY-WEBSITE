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
import {
  LOYALTY_CONTENT_KEYS,
  resolveLoyaltyValue,
} from "@/lib/loyalty/loyalty-content-core";

export const metadata = pageMetadata({
  title: "Loyalty Rewards & Sign-Up — Greenway Points",
  description:
    "Join Greenway Marijuana loyalty rewards for exclusive offers, member discounts, birthday deals, and promotional updates. For adults 21+ in Port Orchard, WA.",
  path: "/loyalty",
  image: "/og/loyalty.png",
});

// SLICE 108: the page now surfaces editable content blocks + the LIVE loyalty
// config/tiers, so render on demand (matching /specials and /medical) — a
// published edit or a program-number change shows on the very next load.
export const dynamic = "force-dynamic";

export default async function LoyaltyPage() {
  const [copy, preview, banners, loyaltyConfig, loyaltyTiers] = await Promise.all([
    getContentValues([
      "loyalty.hero.title",
      "loyalty.hero.subtitle",
      "loyalty.hero.image",
      "loyalty.hero.image_mobile",
      // SLICE 108 — editable friendly copy (signup form + program terms).
      ...LOYALTY_CONTENT_KEYS,
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
          // SLICE 108 — friendly copy (byte-identical fallback until edited).
          birthdayHelp: resolveLoyaltyValue("loyalty.form.birthday_help", copy),
          submitLabel: resolveLoyaltyValue("loyalty.form.submit_label", copy),
          successTitle: resolveLoyaltyValue("loyalty.form.success_title", copy),
        }}
      />
      <LoyaltyProgramTerms
        terms={loyaltyTermsSummary(loyaltyConfig)}
        tiers={tierDisplayRows(loyaltyTiers)}
        copy={{
          eyebrow: resolveLoyaltyValue("loyalty.terms.eyebrow", copy),
          title: resolveLoyaltyValue("loyalty.terms.title", copy),
          tiersHeading: resolveLoyaltyValue("loyalty.terms.tiers_heading", copy),
        }}
      />
      <Footer />
    </main>
  );
}
