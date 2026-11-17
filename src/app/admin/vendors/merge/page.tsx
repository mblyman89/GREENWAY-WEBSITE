import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink, Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { listVendors } from "@/lib/vendors/store";
import { findDuplicateGroups, type MergeCandidate } from "@/lib/vendors/merge-core";
import { MergeGroupCard } from "@/components/admin/vendors/MergeGroupCard";
import { mergeVendorsAction } from "../actions";
import { ManualMergePicker } from "@/components/admin/vendors/ManualMergePicker";
import { MANUAL_MERGE_MAX_CARDS, parsePickedIds, searchVendorsForMerge } from "@/lib/vendors/merge-brand-absorb-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
  "same-license": "Same license number",
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
  searchParams: Promise<{ error?: string; saved?: string; note?: string; back?: string; q?: string; pick?: string | string[] }>;
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

  // D247: hand-picked merge - search any vendor, pick 2-5 cards (kept in the URL).
  const pickIds = parsePickedIds(sp.pick).filter((id) => all.some((v) => v.id === id && v.status !== "archived"));
  const q = String(sp.q ?? "").slice(0, 80);
  const hits = q ? searchVendorsForMerge(all, q, pickIds) : [];
  const urlFor = (ids: string[], query = q) => {
    const u = new URLSearchParams();
    if (query) u.set("q", query);
    if (ids.length) u.set("pick", ids.join(","));
    const qs = u.toString();
    return `/admin/vendors/merge${qs ? `?${qs}` : ""}#pick`;
  };
  // Live brand counts for the picks (the stored vendors.brand_count can lag).
  const liveBrands = new Map<string, number>();
  if (pickIds.length) {
    const { data } = await createSupabaseAdminClient().from("brands").select("vendor_id").in("vendor_id", pickIds);
    for (const r of (data as { vendor_id: string }[] | null) ?? []) liveBrands.set(r.vendor_id, (liveBrands.get(r.vendor_id) ?? 0) + 1);
  }
  const picked = pickIds
    .map((id) => all.find((v) => v.id === id))
    .filter((v): v is NonNullable<typeof v> => Boolean(v))
    .map((v) => ({ ...toCandidate(v), brand_count: liveBrands.get(v.id) ?? 0 }));
  const removeHref = Object.fromEntries(pickIds.map((id) => [id, urlFor(pickIds.filter((x) => x !== id))]));

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
          <BackLink
            fallback="/admin/vendors"
            back={sp.back}
            className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[var(--admin-accent)] hover:text-white"
          >
            ← All vendors
          </BackLink>
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
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            {sp.note ? decodeURIComponent(sp.note) : "Merged."}
          </div>
        )}

        {/* D247: pick any two or more cards by hand (brands filed as their own vendor). */}
        <section id="pick" className="space-y-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4" data-testid="manual-merge">
          <div>
            <h2 className="text-sm font-semibold text-white">Pick cards to merge by hand</h2>
            <p className="text-xs text-[var(--admin-text-muted)]">
              For a vendor whose brands were filed as their own vendor cards. Search, add two to {MANUAL_MERGE_MAX_CARDS} cards, choose the one to keep. Each merged-in card can become a
              brand on the kept card.
            </p>
          </div>
          <form method="get" action="/admin/vendors/merge#pick" className="flex flex-wrap items-center gap-2">
            {pickIds.length > 0 && <input type="hidden" name="pick" value={pickIds.join(",")} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Vendor name, DBA, license or website"
              className="min-w-[16rem] flex-1 rounded-[var(--admin-radius)] border border-white/15 bg-black/30 px-3 py-1.5 text-sm text-white"
            />
            <button type="submit" className="rounded-full border border-white/15 px-4 py-1.5 text-xs text-white/80 hover:border-[var(--admin-accent)] hover:text-white">
              Search
            </button>
            {(pickIds.length > 0 || q) && (
              <Link href="/admin/vendors/merge#pick" className="text-xs text-white/50 underline-offset-2 hover:text-white hover:underline">
                Start over
              </Link>
            )}
          </form>
          {q && (
            <ul className="divide-y divide-white/5 rounded-[var(--admin-radius)] border border-white/10" data-testid="manual-merge-hits">
              {hits.length === 0 && <li className="px-3 py-2 text-xs text-white/50">No active vendor matches “{q}”.</li>}
              {hits.map((v) => (
                <li key={v.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-white">
                    {v.display_name}
                    <span className="ml-2 text-xs text-white/40">
                      {v.license_number ? `Lic ${v.license_number}` : "No license #"} · {v.status}
                    </span>
                  </span>
                  {pickIds.length < MANUAL_MERGE_MAX_CARDS ? (
                    <Link href={urlFor([...pickIds, v.id])} className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/80 hover:border-[var(--admin-accent)] hover:text-white">
                      + Add
                    </Link>
                  ) : (
                    <span className="text-xs text-white/40">{MANUAL_MERGE_MAX_CARDS} picked (the most per merge)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {picked.length > 0 && <ManualMergePicker key={pickIds.join(",")} picked={picked} removeHref={removeHref} mergeAction={mergeVendorsAction} />}
        </section>

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
