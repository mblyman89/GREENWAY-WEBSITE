import { requirePermission } from "@/lib/auth/session";
import { MerchSiteEditor, type MerchEditorSearch } from "../MerchSiteEditor";

export const dynamic = "force-dynamic";

/** R73 S3: Website -> Merchandise -> Product Cards (greenwaymerch.com). */
export default async function MerchCardsPage({
  searchParams,
}: {
  searchParams: Promise<MerchEditorSearch>;
}) {
  await requirePermission("content.edit");
  return (
    <MerchSiteEditor
      search={await searchParams}
      config={{
        page: "merch-cards",
        route: "/admin/merch-site/cards",
        title: "Merch Product Cards",
        subtitle: "The wording on greenwaymerch.com product and category cards, plus each category's image and blurb.",
        crumb: "Product Cards",
        helpId: "merch-cards",
        slotsHint: "Card labels + per-category image & blurb",
        merchMediaFirst: true,
      }}
    />
  );
}
