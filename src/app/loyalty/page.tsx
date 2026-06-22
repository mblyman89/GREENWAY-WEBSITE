import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { LoyaltySignupPreview } from "@/components/loyalty/LoyaltySignupPreview";

export const metadata: Metadata = {
  title: "Loyalty Signup | Greenway Marijuana",
  description:
    "Sign up for Greenway Marijuana loyalty offers, discounts, birthday offers, and promotional updates for adults 21+.",
};

export default function LoyaltyPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Loyalty" }]} />
      <LoyaltySignupPreview />
      <Footer />
    </main>
  );
}
