import { requirePermission } from "@/lib/auth/session";
import { MerchSiteEditor, type MerchEditorSearch } from "../MerchSiteEditor";

export const dynamic = "force-dynamic";

/** R73 S3: Website -> Merchandise -> Order Emails (greenwaymerch.com). */
export default async function MerchEmailsPage({
  searchParams,
}: {
  searchParams: Promise<MerchEditorSearch>;
}) {
  await requirePermission("content.edit");
  return (
    <MerchSiteEditor
      search={await searchParams}
      config={{
        page: "merch-emails",
        route: "/admin/merch-site/emails",
        title: "Merch Order Emails",
        subtitle: "The wording of the emails greenwaymerch.com sends customers (shipped, and cancelled outside Washington).",
        crumb: "Order Emails",
        helpId: "merch-emails",
        slotsHint: "Subjects, shipped note & sign-off",
      }}
    />
  );
}
