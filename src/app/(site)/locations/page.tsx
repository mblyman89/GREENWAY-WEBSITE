import { PageBuilderBanners } from "@/components/site/PageBuilderBanners";
import { LocationsContent } from "@/components/location/LocationsContent";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { SiteBackground } from "@/components/site/SiteBackground";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { JsonLd } from "@/components/seo/JsonLd";
import { greenwayBusiness } from "@/content/business";
import { pageMetadata, storeSchema } from "@/lib/seo/seo";
import { getStoreSchemaInput } from "@/lib/seo/store-hours-server";
import { withSeoOverride } from "@/lib/seo/seo-entries-server";

const baseMetadata = pageMetadata({
  title: "Location, Hours & Directions — Port Orchard, WA",
  description: `Visit Greenway Marijuana at ${greenwayBusiness.address.full}. Store hours, phone, directions, and map for our Port Orchard cannabis dispensary — open daily 8am-11pm.`,
  path: "/locations",
  image: "/og/locations.png",
});

// R46-S2: the SEO Editor (/admin/content/seo) can override title, description,
// canonical, no-index and share image; the values above are the defaults.
export async function generateMetadata() {
  return withSeoOverride(baseMetadata, "/locations");
}

export default async function LocationsPage() {
  // R47: the owner's weekly + holiday hours from Admin → Google Store Listing.
  const [storeHours, storeToday] = await getStoreSchemaInput();
  return (
    <main id="top" className="min-h-screen text-white">
      <SiteBackground />
      <JsonLd data={storeSchema(storeHours, storeToday)} id="locations" />
      <Header />
      <Breadcrumbs items={[{ label: "Location", href: "/locations" }]} />
      <LocationsContent />
      {/* R42 Q3: optional banners from Admin → Pages (locations); renders nothing when none are published. */}
      <PageBuilderBanners pageSlug="locations" />
      <Footer />
    </main>
  );
}
