import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { countCustomers } from "@/lib/customers/store";
import { StatCard } from "@/components/admin/StatCard";
import { CustomerImportDropzone } from "@/components/admin/customers/CustomerImportDropzone";
import { pacificToday } from "@/lib/reports/timezone";

export const dynamic = "force-dynamic";

// G-73 (owner message 15): the file is read in the browser and sent in small
// batches, so no single request is large or long; 60 s covers a slow batch.
export const maxDuration = 60;

export default async function CustomerImportPage() {
  await requirePermission("customers.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Import customers" subtitle="Bring in your customer list." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Apply migrations 0022 and 0029 to enable import.
          </div>
        </div>
      </div>
    );
  }

  const counts = await countCustomers();

  return (
    <div>
      <AdminPageHeader
        title="Import customers"
        subtitle="Drop your Cultivera customer export. We match by Customer ID, so importing the same file again updates customers and never duplicates them."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Customers", href: "/admin/customers" },
              { label: "Import" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="customer-import"
            title="How customer import works"
            steps={[
              "In Cultivera, export Customers. You get a file like 82BB4F__November-01-2026_Customers.xlsx.",
              "Drag that file onto the box below (or click the box and choose it). Do not open or change it first.",
              "Read the preview: how many customers, and what was left blank and why (half-typed phones, placeholder birthdays like 11/11/1999).",
              "Press Import and keep the page open until it says Done. If it stops, press Continue; nothing is duplicated.",
            ]}
          >
            <p>
              Going forward, capture a phone <em>and</em> email for every customer who wants deals.
              That&apos;s how we get truly data-driven and stop flying blind.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Customers" value={counts.total} accent="muted" />
          <StatCard label="Medical" value={counts.medical} accent="muted" />
          <StatCard label="Consented" value={counts.consented} accent="green" />
        </div>

        <CustomerImportDropzone today={pacificToday()} />
      </div>
    </div>
  );
}
