import { requireStaff } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { HelpSearch } from "@/components/admin/HelpSearch";

export const dynamic = "force-dynamic";

export default async function AdminHelpPage() {
  await requireStaff();

  return (
    <div>
      <AdminPageHeader
        title="Help & FAQ"
        subtitle="Plain-language answers for everything in the back office."
        breadcrumbs={<Breadcrumbs items={[{ label: "Help" }]} />}
      />
      <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8">
        <HelpSearch />
      </div>
    </div>
  );
}
