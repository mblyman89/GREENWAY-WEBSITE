import type { Metadata } from "next";
import { LocationsPreview } from "@/components/location/LocationsPreview";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { greenwayBusiness } from "@/content/business";

export const metadata: Metadata = {
  title: "Location | Greenway Marijuana",
  description: `Visit Greenway Marijuana at ${greenwayBusiness.address.full}. Find store details, hours, contact information, directions, and a map for the Port Orchard dispensary.`,
};

export default function LocationsPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Location" }]} />
      <LocationsPreview />
      <Footer />
    </main>
  );
}
