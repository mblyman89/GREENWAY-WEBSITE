import { requirePermission } from "@/lib/auth/session";
import { MerchSiteEditor, type MerchEditorSearch } from "../MerchSiteEditor";

export const dynamic = "force-dynamic";

/** R73 S3: Website -> Merchandise -> Header & Footer (greenwaymerch.com). */
export default async function MerchHeaderFooterPage({
  searchParams,
}: {
  searchParams: Promise<MerchEditorSearch>;
}) {
  await requirePermission("content.edit");
  return (
    <MerchSiteEditor
      search={await searchParams}
      config={{
        page: "merch-header-footer",
        route: "/admin/merch-site/header-footer",
        title: "Merch Header & Footer",
        subtitle: "The header, announcement bar and footer on every greenwaymerch.com page. Edit a draft, then Publish.",
        crumb: "Header & Footer",
        helpId: "merch-header-footer",
        slotsHint: "Announcement, wordmark, labels, footer note & social links",
      }}
    />
  );
}
