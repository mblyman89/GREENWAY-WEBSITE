import { LocationsContent } from "@/components/location/LocationsContent";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { JsonLd } from "@/components/seo/JsonLd";
import { greenwayBusiness } from "@/content/business";
import { pageMetadata, storeSchema } from "@/lib/seo/seo";

export const metadata = pageMetadata({
  title: "Location, Hours & Directions — Port Orchard, WA",
  description: `Visit Greenway Marijuana at ${greenwayBusiness.address.full}. Store hours, phone, directions, and map for our Port Orchard cannabis dispensary — open daily 8am-11pm.`,
  path: "/locations",
});

export default function LocationsPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <JsonLd data={storeSchema()} id="locations" />
      <Header />
      <Breadcrumbs items={[{ label: "Location", href: "/locations" }]} />
      <LocationsContent />
      <Footer />
    </main>
  );
}
