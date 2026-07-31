import { SpecialsContent } from "@/components/specials/SpecialsContent";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { pageMetadata } from "@/lib/seo/seo";
import { getThursdayBrands } from "@/lib/promotions/storefront-bridge";
import { loadPublishedRuleSnapshots } from "@/lib/promotions/discount-engine";
import { weeklyDealSummaries } from "@/lib/promotions/published-rules-core";
import { getContentValues, getContentForRender, isPreviewActive } from "@/lib/cms/render-content";
import { getPageBanners } from "@/lib/cms/page-sections-store";
import { resolveSpecialsPresentation } from "@/lib/specials/specials-presentation-core";
import { loadLiveMenuItems } from "@/lib/pos/live-menu";
import { withMenuProfile } from "@/lib/menu/strain-terpenes-server";

// Menu is dynamic (published DB version), so specials render on demand.
export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  title: "Cannabis Specials & Daily Deals — Port Orchard",
  description:
    "See Greenway Marijuana's cannabis specials: daily discounts, top-shelf deals, and 50% off clearance on flower, vapes, edibles, and more in Port Orchard, WA.",
  path: "/specials",
  image: "/og/specials.png",
});

export default async function SpecialsPage() {
  // DB-published promotions (back-office) with static seed fallback: the
  // Thursday brand list AND the full weekly deals grid copy (Task T / PR 1).
  const [thursdayBrands, ruleSnapshots, copy, preview, banners, menuItems, presentationJson] =
    await Promise.all([
      getThursdayBrands(),
      loadPublishedRuleSnapshots(),
      getContentValues([
        "specials.hero.eyebrow",
        "specials.hero.title",
        "specials.hero.subtitle",
      ]),
      isPreviewActive(),
      getPageBanners("specials", ["specials.hero"]),
      // SLICE 40: overlay the KB strain profile (same as home + shop) so the
      // specials cards show the strain type instead of the raw POS value.
      loadLiveMenuItems().then((items) => withMenuProfile(items)),
      // SLICE 106: how the weekly-deal grid is PRESENTED (draft-aware). The
      // SEED_DEFAULTS fallback is the live-look-safe default, so pre-seed and
      // pre-migration this is identical to today.
      getContentForRender("specials.deals.presentation"),
    ]);
  const presentation = resolveSpecialsPresentation(presentationJson);

  // Pages-builder hero (specials.hero) is the source of truth when present;
  // otherwise fall back to the content-block copy (live look unchanged).
  const hero = banners.byKey["specials.hero"];

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Specials" }]} />
      <SpecialsContent
        thursdayBrands={thursdayBrands}
        weeklyDeals={weeklyDealSummaries(ruleSnapshots)}
        menuItems={menuItems}
        presentation={presentation}
        content={{
          eyebrow: hero?.eyebrow || copy["specials.hero.eyebrow"],
          title: hero?.title || copy["specials.hero.title"],
          subtitle: hero?.subtitle || copy["specials.hero.subtitle"],
          // SLICE 122 (SET-3): the TOP hero image now lives in THIS page's own
          // presentation editor (moved out of the retired Pages builder). Prefer
          // it; fall back to the legacy Pages-builder value so anything already
          // set there keeps working until re-saved. Blank on both => gradient-
          // only hero (today's default look).
          image: presentation.heroBannerImage || hero?.image || undefined,
          imageFocus: hero?.imageFocus,
          buttons: hero?.buttons,
          extraSections: banners.extras,
          editable: preview,
        }}
      />
      <Footer />
    </main>
  );
}
