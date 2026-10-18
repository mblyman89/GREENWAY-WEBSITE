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
        steps: [
          "Edit a block below (the announcement bar, the wordmark, the footer note or a social link). Nothing goes live yet.",
          "Click Publish (or 'Publish all drafts'). greenwaymerch.com picks it up within about a minute.",
          "Every publish is saved, so you can roll back from a block's history.",
        ],
        help: (
          <p>
            Leave the <strong>announcement</strong> blank to hide the bar. Social links must start
            with <code>https://</code>; a blank one simply hides that button. The legal lines
            (seller name, Washington-only shipping) are fixed and always show.
          </p>
        ),
        slotsHint: "Announcement, wordmark, labels, footer note & social links",
      }}
    />
  );
}
