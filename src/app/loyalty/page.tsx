import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { LoyaltySignupForm } from "@/components/loyalty/LoyaltySignupForm";
import { pageMetadata } from "@/lib/seo/seo";

export const metadata = pageMetadata({
  title: "Loyalty Rewards & Sign-Up — Greenway Points",
  description:
    "Join Greenway Marijuana loyalty rewards for exclusive offers, member discounts, birthday deals, and promotional updates. For adults 21+ in Port Orchard, WA.",
  path: "/loyalty",
  image: "/og/loyalty.png",
});

export default function LoyaltyPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Loyalty" }]} />
      <LoyaltySignupForm />
      <Footer />
    </main>
  );
}
