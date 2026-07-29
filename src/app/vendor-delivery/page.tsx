import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { VendorDirectory } from "@/components/vendors/VendorDirectory";
import { pageMetadata } from "@/lib/seo/seo";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";
import { getPageBanners } from "@/lib/cms/page-sections-store";
import { buildVendorDirectory, enrichVendorDirectory } from "@/lib/menu/vendor-directory-core";
import { loadLiveMenuAll } from "@/lib/pos/live-menu";
import { listPublicVendorProfiles } from "@/lib/vendors/store";

export const metadata = pageMetadata({
  title: "Vendors & Partners — Washington Cannabis Brands",
  description:
    "Meet the licensed Washington cannabis producers and processors stocking Greenway Marijuana shelves in Port Orchard — and learn how to become a vendor partner.",
  path: "/vendor-delivery",
});

export default async function VendorDeliveryPage() {
  const [copy, preview, banners, menuItems, profiles] = await Promise.all([
    getContentValues(["vendors.outreach.heading"]),
    isPreviewActive(),
    getPageBanners("vendors", ["vendors.grow", "vendors.brands"]),
    loadLiveMenuAll(),
    listPublicVendorProfiles(),
  ]);

  // SLICE 48: vendor directory is now derived live from the menu instead of
  // the retired static vendors.json snapshot. buildVendorDirectory skips
  // hidden items itself, so we hand it the full menu.
  // SLICE 97: fold in the back-office vendor profiles (uploaded logo +
  // about/mission copy) so a logo saved on the vendor detail page shows here.
  const vendors = enrichVendorDirectory(buildVendorDirectory(menuItems), profiles);

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Vendors & Partners" }]} />
      <VendorDirectory
        vendors={vendors}
        content={{
          heading: copy["vendors.outreach.heading"],
          editable: preview,
          grow: banners.byKey["vendors.grow"],
          brands: banners.byKey["vendors.brands"],
          extraSections: banners.extras,
        }}
      />
      <Footer />
    </main>
  );
}
