import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { listVendors } from "@/lib/vendors/store";
import { findDuplicateGroups, type MergeCandidate } from "@/lib/vendors/merge-core";
import { MergeGroupCard } from "@/components/admin/vendors/MergeGroupCard";
import { mergeVendorsAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * /admin/vendors/merge — Task F (combine duplicate vendors).
 *
 * Many WA producer-processors hold multiple LCB licenses, so the statewide
 * import created 2–3 cards for the same business. This page finds likely
 * duplicate groups (identical business name, or identical website), and lets
 * the owner review each group: pick the card to keep, see a plain-language
 * preview of exactly what will move over, confirm, and merge. The merge runs
 * atomically in the database (migration 0104) and ARCHIVES the duplicates —
 * nothing is ever deleted.
 */

const REASON_LABELS: Record<string, string> = {
  "same-name": "Same business name",
  "same-website": "Same website",
};

/** Strip a Vendor down to the serializable fields the client card needs. */
function toCandidate(v: MergeCandidate): MergeCandidate {
  return {
    id: v.id,
    display_name: v.display_name,
    legal_name: v.legal_name ?? null,
    license_number: v.license_number ?? null,
    website: v.website ?? null,
    status: v.status,
    product_count: v.product_count ?? 0,
    brand_count: v.brand_count ?? 0,
    mission_statement: v.mission_statement ?? null,
    about: v.about ?? null,
    product_philosophy: v.product_philosophy ?? null,
    email: v.email ?? null,
    phone: v.phone ?? null,
    vendor_day_notes: v.vendor_day_notes ?? null,
    vendor_number: v.vendor_number ?? null,
    dba: v.dba ?? null,
    shipping_address1: v.shipping_address1 ?? null,
    billing_address1: v.billing_address1 ?? null,
    sage_vendor_id: v.sage_vendor_id ?? null,
    logo_media_id: v.logo_media_id ?? null,
    hero_media_id: v.hero_media_id ?? null,
  };
}

export default async function VendorMergePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; note?: string }>;
}) {
  await requirePermission("vendors.manage");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Combine duplicate vendors" subtitle="Merge duplicate vendor cards into one." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once your administrator finishes the one-time
            setup, duplicate detection will appear here.
          </div>
        </div>
      </div>
    );
  }

  const all = await listVendors();
  const groups = findDuplicateGroups(all.map(toCandidate));

  return (
    <div>
      <AdminPageHeader
        title="Combine duplicate vendors"
        subtitle="Producer-processors often hold two or three licenses, which created separate cards for the same business. Review each group and combine them into one card."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Vendors & Brands", href: "/admin/vendors" },
              { label: "Combine duplicates" },
            ]}
          />
        }
        action={
          <Link
            href="/admin/vendors"
            className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[#7ed957] hover:text-white"
          >
            ← All vendors
          </Link>
        }
        help={
          <HelpPanel
            id="vendor-merge"
            title="How combining works"
            steps={[
              "Each group below looks like ONE business with multiple cards.",
              "Pick the card to KEEP (usually the most complete one — pre-selected for you).",
              "Tick the duplicate cards to merge in, read the preview, then confirm.",
              "Everything moves to the kept card; every license number is preserved.",
            ]}
          >
            <p>
              Merging never deletes anything: the duplicate cards are archived with a note pointing
              at the surviving card, and all their brands, products, purchase orders, manifests,
              and drafts move over. Fields already filled in on the kept card are never overwritten.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-4 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.saved && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">
            {sp.note ? decodeURIComponent(sp.note) : "Merged."}
          </div>
        )}

        {groups.length === 0 ? (
          <EmptyState
            icon="✅"
            title="No likely duplicates found"
            description="No two active vendor cards share a business name or website. If you spot a duplicate we missed, rename one card to match the other exactly and it will appear here."
          />
        ) : (
          <>
            <p className="text-sm text-[var(--admin-text-faint)]">
              {groups.length} likely duplicate group{groups.length === 1 ? "" : "s"} found. Nothing
              merges automatically — you review and confirm each one.
            </p>
            {groups.map((g) => (
              <MergeGroupCard
                key={g.key}
                vendors={g.vendors}
                suggestedSurvivorId={g.suggestedSurvivorId}
                reasonLabel={REASON_LABELS[g.reason] ?? g.reason}
                mergeAction={mergeVendorsAction}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
