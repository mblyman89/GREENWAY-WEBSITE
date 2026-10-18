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
        steps: [
          "Edit a subject line, the shipped note or the sign-off.",
          "Use {order} for the order number and {site} for the store name; they fill in automatically.",
          "Publish. The next email sent uses the new wording.",
        ],
        help: (
          <p>
            The order details, tracking link and refund facts are always added automatically, so a
            customer can never get an email missing them.
          </p>
        ),
        slotsHint: "Subjects, shipped note & sign-off",
      }}
    />
  );
}
