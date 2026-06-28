import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { LoyaltySignupForm } from "@/components/loyalty/LoyaltySignupForm";
import { pageMetadata } from "@/lib/seo/seo";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";

export const metadata = pageMetadata({
  title: "Loyalty Rewards & Sign-Up — Greenway Points",
  description:
    "Join Greenway Marijuana loyalty rewards for exclusive offers, member discounts, birthday deals, and promotional updates. For adults 21+ in Port Orchard, WA.",
  path: "/loyalty",
  image: "/og/loyalty.png",
});

export default async function LoyaltyPage() {
  const [copy, preview] = await Promise.all([
    getContentValues(["loyalty.hero.title", "loyalty.hero.subtitle"]),
    isPreviewActive(),
  ]);

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Loyalty" }]} />
      <LoyaltySignupForm
        content={{
          title: copy["loyalty.hero.title"],
          subtitle: copy["loyalty.hero.subtitle"],
          editable: preview,
        }}
      />
      <Footer />
    </main>
  );
}
