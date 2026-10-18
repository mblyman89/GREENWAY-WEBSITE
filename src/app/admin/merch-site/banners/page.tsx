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
        slotsHint: "Home + one slot per category (desktop, phone, alt text, link)",
        merchMediaFirst: true,
      }}
    />
  );
}
