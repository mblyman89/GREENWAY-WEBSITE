import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Field, Textarea, Button } from "@/components/admin/ui";
import { countCustomers } from "@/lib/customers/store";
import { StatCard } from "@/components/admin/StatCard";
import { importCustomersAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CustomerImportPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    inserted?: string;
    updated?: string;
    skipped?: string;
  }>;
}) {
  await requirePermission("customers.manage");
  const { error, inserted, updated, skipped } = await searchParams;

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

  const errorMsg =
    error === "empty"
      ? "Paste your customer CSV before importing."
      : error === "norows"
        ? "No customer rows were found in that CSV."
        : error === "save"
          ? "Something went wrong saving the customers."
          : null;

  const success =
    inserted != null || updated != null
      ? `Imported: ${inserted ?? 0} new, ${updated ?? 0} updated, ${skipped ?? 0} skipped.`
      : null;

  return (
    <div>
      <AdminPageHeader
        title="Import customers"
        subtitle="Paste your Cultivera customer export (CSV). We dedupe by Customer ID, then phone, then email — so re-importing is safe and only fills in what's new."
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
              "Export your customers from Cultivera as CSV (or save the spreadsheet as CSV).",
              "Open it, copy everything (including the header row), and paste below.",
              "We map names, phone, email, birthdate, medical flag, spend, and city/state/zip.",
              "Re-import any time — existing customers are updated, not duplicated.",
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

        {errorMsg && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            {errorMsg}
          </div>
        )}
        {success && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            {success}
          </div>
        )}

        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-xs text-[var(--admin-gold)]">
          Large lists: paste in chunks of a few thousand rows (keep the header row each time) if a
          single paste times out. Re-importing is safe — duplicates are merged.
        </div>

        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-4 text-sm font-bold text-[var(--admin-text)]">Paste customer CSV</h2>
          <form action={importCustomersAction} className="space-y-4">
            <Field
              label="Customer CSV"
              help="Include the header row. Recognized columns: Customer ID, First/Last Name, Phone Number, Email, Date Of Birth, IS MEDICAL, Total Spent, City, State, Zip, Last Purchase Date."
              htmlFor="csv_text"
              required
            >
              <Textarea
                id="csv_text"
                name="csv_text"
                rows={12}
                placeholder="Customer ID,First Name,Last Name,Phone Number,Total Spent,..."
              />
            </Field>
            <Button type="submit" variant="save" size="sm">
              Import customers
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
