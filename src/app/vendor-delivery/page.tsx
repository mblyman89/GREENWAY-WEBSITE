import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { VendorDirectory } from "@/components/vendors/VendorDirectory";
import { pageMetadata } from "@/lib/seo/seo";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";

export const metadata = pageMetadata({
  title: "Vendors & Partners — Washington Cannabis Brands",
  description:
    "Meet the licensed Washington cannabis producers and processors stocking Greenway Marijuana shelves in Port Orchard — and learn how to become a vendor partner.",
  path: "/vendor-delivery",
});

export default async function VendorDeliveryPage() {
  const [copy, preview] = await Promise.all([
    getContentValues(["vendors.outreach.heading"]),
    isPreviewActive(),
  ]);

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Vendors & Partners" }]} />
      <VendorDirectory
        content={{
          heading: copy["vendors.outreach.heading"],
          editable: preview,
        }}
      />
      <Footer />
    </main>
  );
}
