import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { SiteBackground } from "@/components/site/SiteBackground";
import { VendorDirectory } from "@/components/vendors/VendorDirectory";
import { pageMetadata } from "@/lib/seo/seo";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";
import { getPageBanners } from "@/lib/cms/page-sections-store";
import { buildVendorDirectory, enrichVendorDirectory } from "@/lib/menu/vendor-directory-core";
import { loadLiveMenuAllCached } from "@/lib/pos/live-menu";
import { listPublicVendorProfiles } from "@/lib/vendors/store";
import {
  resolveVendorChannels,
  VENDOR_EDITABLE_CONTENT_KEYS,
  VENDOR_OUTREACH_SUBJECT,
  VENDOR_OUTREACH_SUBJECT_KEY,
} from "@/lib/vendors/vendor-relations-core";

export const metadata = pageMetadata({
  title: "Vendors & Partners — Washington Cannabis Brands",
  description:
    "Meet the licensed Washington cannabis producers and processors stocking Greenway Marijuana shelves in Port Orchard — and learn how to become a vendor partner.",
  path: "/vendor-delivery",
});

export default async function VendorDeliveryPage() {
  const [copy, preview, banners, menuItems, profiles] = await Promise.all([
    // SLICE 99: the outreach paragraph joins the heading as editable copy.
    // SLICE 114: also fetch the editable outreach subject + the five channel
    // cards' title/blurb/email/subject so Michael can set them manually.
    getContentValues([
      "vendors.outreach.heading",
      "vendors.outreach.body",
      ...VENDOR_EDITABLE_CONTENT_KEYS,
    ]),
    isPreviewActive(),
    getPageBanners("vendors", ["vendors.grow", "vendors.brands"]),
    loadLiveMenuAllCached(),
    listPublicVendorProfiles(),
  ]);

  // SLICE 48: vendor directory is now derived live from the menu instead of
  // the retired static vendors.json snapshot. buildVendorDirectory skips
  // hidden items itself, so we hand it the full menu.
  // SLICE 97: fold in the back-office vendor profiles (uploaded logo +
  // about/mission copy) so a logo saved on the vendor detail page shows here.
  const vendors = enrichVendorDirectory(buildVendorDirectory(menuItems), profiles);

  // SLICE 114: overlay any published channel edits onto the byte-identical
  // defaults (blank edits fall back), and resolve the outreach subject.
  const channels = resolveVendorChannels(copy);
  const outreachSubject =
    (copy[VENDOR_OUTREACH_SUBJECT_KEY] ?? "").trim() || VENDOR_OUTREACH_SUBJECT;

  return (
    <main id="top" className="min-h-screen text-white">
      <SiteBackground />
      <Header />
      <Breadcrumbs items={[{ label: "Vendors & Partners" }]} />
      <VendorDirectory
        vendors={vendors}
        content={{
          heading: copy["vendors.outreach.heading"],
          body: copy["vendors.outreach.body"],
          editable: preview,
          grow: banners.byKey["vendors.grow"],
          brands: banners.byKey["vendors.brands"],
          extraSections: banners.extras,
          channels,
          outreachSubject,
        }}
      />
      <Footer />
    </main>
  );
}
