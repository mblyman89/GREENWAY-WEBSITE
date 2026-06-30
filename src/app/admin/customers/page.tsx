import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Button } from "@/components/admin/ui";
import { listCustomers, countCustomers } from "@/lib/customers/store";

export const dynamic = "force-dynamic";

function fmtMoney(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePermission("customers.manage");
  const { q } = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Customers" subtitle="Customer & patient records." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once your administrator finishes the one-time
            setup (and migration 0022 is applied), customers will appear here.
          </div>
        </div>
      </div>
    );
  }

  const [customers, counts] = await Promise.all([listCustomers({ q }), countCustomers()]);

  return (
    <div>
      <AdminPageHeader
        title="Customers"
        subtitle="Build customer & patient profiles — the foundation for loyalty, history, and (later) purchase-limit enforcement at the register."
        breadcrumbs={<Breadcrumbs items={[{ label: "Customers" }]} />}
        action={
          <div className="flex gap-2">
            <Button href="/admin/customers/import" variant="subtle" size="sm">
              ⬆ Import
            </Button>
            <Button href="/admin/customers/new" variant="save" size="sm">
              + New customer
            </Button>
          </div>
        }
        help={
          <HelpPanel
            id="customers"
            title="How customer records work"
            steps={[
              "Add a customer with their name and (optionally) contact + birthdate.",
              "Mark medical patients and capture their authorization on the profile.",
              "Respect marketing consent / do-not-contact flags.",
              "Later slices link sales history + enforce purchase limits automatically.",
            ]}
          >
            <p>
              Customer data is private and staff-only. Birthdate powers the 21+ age check at the
              register in a later slice.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total customers" value={counts.total} accent="muted" />
          <StatCard label="Medical patients" value={counts.medical} accent="green" />
          <StatCard label="Marketing consent" value={counts.consented} accent="gold" />
        </div>

        <form className="flex flex-wrap items-center gap-3" method="get">
          <div className="min-w-48 flex-1">
            <Input name="q" defaultValue={q ?? ""} placeholder="Search name, email, or phone…" />
          </div>
          <Button type="submit" variant="subtle">
            Search
          </Button>
        </form>

        {counts.total === 0 && (
          <EmptyState
            icon="👤"
            title="No customers yet"
            description="Add your first customer with the “New customer” button, or link them from loyalty signups in a later step."
          />
        )}

        {customers.length > 0 && (
          <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3 text-center">Medical</th>
                  <th className="px-4 py-3 text-right">Visits</th>
                  <th className="px-4 py-3 text-right">Lifetime spend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border)]">
                {customers.map((c) => (
                  <tr key={c.id} className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/customers/${c.id}`}
                        className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                      >
                        {c.first_name} {c.last_name ?? ""}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                      {c.email || c.phone || "—"}
                      {c.do_not_contact && (
                        <span className="ml-2 rounded bg-[var(--admin-orange-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-orange)]">
                          Do not contact
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">{c.is_medical_patient ? "🩺" : "—"}</td>
                    <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">{c.visit_count}</td>
                    <td className="px-4 py-3 text-right font-medium text-[var(--admin-text)]">
                      {fmtMoney(c.lifetime_spend_minor_units)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {customers.length === 0 && counts.total > 0 && (
          <p className="text-sm text-white/50">No customers match your search.</p>
        )}
      </div>
    </div>
  );
}
