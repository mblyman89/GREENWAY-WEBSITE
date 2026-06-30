import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { CustomerForm } from "@/components/admin/customers/CustomerForm";
import { createCustomerAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("customers.manage");
  const { error } = await searchParams;

  return (
    <div>
      <AdminPageHeader
        title="New customer"
        subtitle="Add a customer or patient record."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Customers", href: "/admin/customers" }, { label: "New" }]} />
        }
      />
      <div className="max-w-2xl px-5 py-6 sm:px-8">
        {error === "name" && (
          <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            A first name is required.
          </div>
        )}
        <CustomerForm action={createCustomerAction} submitLabel="Create customer" />
      </div>
    </div>
  );
}
