import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { CustomerForm } from "@/components/admin/customers/CustomerForm";
import { getCustomerById, listPatientAuthorizations, isAtLeast21 } from "@/lib/customers/store";
import { can } from "@/lib/auth/roles";
import { LoyaltyPanel } from "@/components/admin/loyalty/LoyaltyPanel";
import { updateCustomerAction } from "../actions";

export const dynamic = "force-dynamic";

function fmtMoney(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; created?: string; error?: string }>;
}) {
  const session = await requirePermission("customers.manage");
  const { id } = await params;
  const canManageLoyalty = can(session.profile.role, "loyalty.manage");
  const { saved, created, error } = await searchParams;

  const customer = await getCustomerById(id);
  if (!customer) notFound();

  const auths = await listPatientAuthorizations(id);
  const ageOk = isAtLeast21(customer.birthdate);

  // Bind the id into the update action.
  const updateAction = updateCustomerAction.bind(null, id);

  return (
    <div>
      <AdminPageHeader
        title={`${customer.first_name} ${customer.last_name ?? ""}`.trim()}
        subtitle="Customer profile"
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Customers", href: "/admin/customers" }, { label: customer.first_name }]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {(saved || created) && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            {created ? "Customer created." : "Changes saved."}
          </div>
        )}
        {error === "name" && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            A first name is required.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Visits" value={customer.visit_count} accent="muted" />
          <StatCard label="Lifetime spend" value={fmtMoney(customer.lifetime_spend_minor_units)} accent="green" />
          <StatCard
            label="21+ verified"
            value={ageOk == null ? "No DOB" : ageOk ? "Yes" : "Under 21"}
            accent={ageOk == null ? "muted" : ageOk ? "green" : "orange"}
          />
          <StatCard label="Medical" value={customer.is_medical_patient ? "Patient" : "—"} accent={customer.is_medical_patient ? "gold" : "muted"} />
        </div>

        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-4 text-sm font-bold text-[var(--admin-text)]">Edit profile</h2>
          <CustomerForm customer={customer} action={updateAction} submitLabel="Save changes" />
        </div>

        <LoyaltyPanel customerId={id} canManage={canManageLoyalty} />

        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-3 text-sm font-bold text-[var(--admin-text)]">Patient authorizations</h2>
          {auths.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-faint)]">
              No medical authorization on file. (Authorization capture UI arrives with the register slice.)
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {auths.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2">
                  <span className="text-[var(--admin-text-muted)]">
                    {a.authorization_id ?? "(no id)"} · expires {a.expires_on ?? "—"}
                  </span>
                  <span className="text-xs uppercase text-[var(--admin-text-faint)]">{a.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
