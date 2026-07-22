import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink, Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Field, Textarea, Button } from "@/components/admin/ui";
import { countVendors } from "@/lib/vendors/store";
import { StatCard } from "@/components/admin/StatCard";
import { importVendorsBrandsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function VendorBrandImportPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    entity?: string;
    inserted?: string;
    updated?: string;
    skipped?: string;
    back?: string;
  }>;
}) {
  await requirePermission("vendors.manage");
  const { error, entity, inserted, updated, skipped, back } = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Import vendors & brands" subtitle="Bring in your vendor/brand list." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once setup is complete, importing will be enabled.
          </div>
        </div>
      </div>
    );
  }

  const counts = await countVendors();

  const errorMsg =
    error === "empty"
      ? "Paste your vendor/brand export before importing."
      : error === "unknown"
        ? "Couldn't detect a vendor or brand name column. Make sure the first row is a header with a column like 'Vendor', 'Vendor Name', 'Brand', or 'Name'."
        : error === "norows"
          ? "No vendor/brand rows with a name were found in that paste."
          : error === "save"
            ? "Something went wrong saving. Please try again."
            : null;

  const success =
    inserted != null || updated != null
      ? `Imported ${entity ?? "records"}: ${inserted ?? 0} new, ${updated ?? 0} gap-filled, ${skipped ?? 0} unchanged.`
      : null;

  return (
    <div>
      <AdminPageHeader
        title="Import vendors & brands"
        subtitle="Paste your Cultivera vendor or brand export (CSV). We upsert by slug and only fill in blanks — your existing profiles are never overwritten, so re-importing is always safe."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Vendors & Brands", href: "/admin/vendors" },
              { label: "Import" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="vendor-import"
            title="How vendor/brand import works"
            steps={[
              "Export your vendors (or brands) from Cultivera as CSV, or save the spreadsheet as CSV.",
              "Open it, copy everything including the header row, and paste below.",
              "We auto-detect whether it's a vendor sheet or a brand sheet from the header.",
              "New records are added as drafts; existing ones only get their blank fields filled in.",
            ]}
          >
            <p>
              Import vendors first, then brands — so brands can attach to their
              parent vendor by name. Re-import any time; nothing is duplicated and
              nothing curated is overwritten.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total vendors" value={counts.total} accent="muted" />
          <StatCard label="Published" value={counts.published} accent="green" />
          <StatCard label="Drafts" value={counts.total - counts.published} accent="orange" />
        </div>

        {errorMsg && (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger-soft)] p-4 text-sm text-[var(--admin-danger)]">
            {errorMsg}
          </div>
        )}
        {success && (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] p-4 text-sm text-[var(--admin-accent)]">
            {success}
          </div>
        )}

        <form action={importVendorsBrandsAction} className="space-y-4">
          <Field
            label="Paste CSV (vendors or brands)"
            help="Include the header row. We detect the sheet type automatically."
          >
            <Textarea
              name="csv_text"
              rows={14}
              placeholder={"Vendor,Legal Name,License,Website,Email,Phone,Instagram\nGreenway Growers,Greenway Growers LLC,123456,https://example.com,hi@example.com,360-555-1234,@greenway"}
              className="font-mono text-xs"
            />
          </Field>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary">Import</Button>
            <BackLink
              fallback="/admin/vendors"
              back={back}
              className="text-sm text-[var(--admin-text-faint)] hover:text-white"
            >
              Back to vendors
            </BackLink>
          </div>
        </form>
      </div>
    </div>
  );
}
