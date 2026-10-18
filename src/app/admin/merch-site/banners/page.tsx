import { requirePermission } from "@/lib/auth/session";
import { MerchSiteEditor, type MerchEditorSearch } from "../MerchSiteEditor";

export const dynamic = "force-dynamic";

/** R73 S3: Website -> Merchandise -> Banners (attach finished banner images). */
export default async function MerchBannersPage({
  searchParams,
}: {
  searchParams: Promise<MerchEditorSearch>;
}) {
  await requirePermission("content.edit");
  return (
    <MerchSiteEditor
      search={await searchParams}
      config={{
        page: "merch-banners",
        route: "/admin/merch-site/banners",
        title: "Merch Banners",
        subtitle: "Attach a finished banner to the greenwaymerch.com home page or any category page.",
        crumb: "Banners",
        helpId: "merch-banners",
        steps: [
          "Design the banner in Brand → Banners (or any tool) and save it to the Media Library's \"Merch\" folder.",
          "Pick a slot below (Home or a category) and choose the image. Images from the Merch folder are listed first.",
          "Optionally add a phone-sized image, the alt text and a link, then Publish.",
        ],
        help: (
          <p>
            A slot with no image shows nothing, so the page looks exactly as it does today. Links
            can be a merch-site path like <code>/tees</code> or a full <code>https://</code> address.
          </p>
        ),
        slotsHint: "Home + one slot per category (desktop, phone, alt text, link)",
        merchMediaFirst: true,
      }}
    />
  );
}
