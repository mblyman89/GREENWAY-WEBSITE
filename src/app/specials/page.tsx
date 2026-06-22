import type { Metadata } from "next";
import { SpecialsPreview } from "@/components/specials/SpecialsPreview";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";

export const metadata: Metadata = {
  title: "Specials | Greenway Marijuana",
  description:
    "Greenway Marijuana cannabis specials, daily discounts, and 50% off clearance deals in Port Orchard.",
};

export default function SpecialsPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Specials" }]} />
      <SpecialsPreview />
      <Footer />
    </main>
  );
}
