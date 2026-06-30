/**
 * src/lib/inventory/catalog-drafts.ts
 *
 * POS Slice 8 — when a received lot doesn't match a product in the published
 * menu, we seed a DRAFT catalog product (from the transfer JSON + COA) so an
 * employee can validate and later publish it. Standing rule: machine output is
 * never auto-live — drafts must be approved by a human.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion, getItemBySourceKey } from "@/lib/pos/menu-version";

export type CatalogDraft = {
  id: string;
  pos_product_key: string | null;
  source_item_id: string | null;
  name: string;
  brand_name: string | null;
  vendor_name: string | null;
  category: string | null;
  inventory_type: string | null;
  strain_name: string | null;
  thc_pct: number | null;
  cbd_pct: number | null;
  total_thc_pct: number | null;
  total_cannabinoids_pct: number | null;
  potency_json: Record<string, number> | null;
  manifest_id: string | null;
  lot_id: string | null;
  lab_result_id: string | null;
  status: string; // draft | approved | dismissed
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type LotForMatch = {
  id: string;
  pos_product_key: string | null;
  product_name: string | null;
  brand_id: string | null;
  vendor_id: string | null;
  category: string | null;
  inventory_type: string | null;
  strain_name: string | null;
  lab_result_id: string | null;
};

/**
 * Result of checking a manifest's lots against the published catalog.
 */
export type CatalogMatchResult = {
  matched: number;
  unmatched: number;
  /** Whether a published menu version exists to match against. */
  hasPublishedMenu: boolean;
};

/**
 * For each lot on a manifest, check if its pos_product_key matches a
 * source_item_id in the published menu. For unmatched lots, seed a draft.
 * Returns counts for the UI. Idempotent: a partial unique index prevents
 * piling up duplicate open drafts for the same POS key.
 */
export async function seedDraftsForManifest(
  manifestId: string,
  actorId: string | null,
): Promise<CatalogMatchResult> {
  const empty: CatalogMatchResult = { matched: 0, unmatched: 0, hasPublishedMenu: false };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();

  const published = await getPublishedVersion();
  const hasPublishedMenu = Boolean(published);

  const { data: lotsData } = await admin
    .from("inventory_lots")
    .select(
      "id, pos_product_key, product_name, brand_id, vendor_id, category, inventory_type, strain_name, lab_result_id",
    )
    .eq("manifest_id", manifestId)
    .neq("status", "destroyed");
  const lots = (lotsData as LotForMatch[] | null) ?? [];

  // Cache vendor/brand name lookups so we don't refetch per lot.
  const vendorNames = new Map<string, string | null>();
  const brandNames = new Map<string, string | null>();
  const labCache = new Map<
    string,
    {
      thc_pct: number | null;
      cbd_pct: number | null;
      total_thc_pct: number | null;
      total_cannabinoids_pct: number | null;
      potency_json: Record<string, number> | null;
    }
  >();

  let matched = 0;
  let unmatched = 0;

  for (const lot of lots) {
    // Match against the published menu by POS key.
    if (published && lot.pos_product_key) {
      const hit = await getItemBySourceKey(published.id, lot.pos_product_key);
      if (hit) {
        matched += 1;
        continue;
      }
    }
    unmatched += 1;

    // Resolve display names (best-effort).
    let vendorName: string | null = null;
    if (lot.vendor_id) {
      if (!vendorNames.has(lot.vendor_id)) {
        const { data } = await admin
          .from("vendors")
          .select("display_name")
          .eq("id", lot.vendor_id)
          .maybeSingle();
        vendorNames.set(lot.vendor_id, (data as { display_name: string } | null)?.display_name ?? null);
      }
      vendorName = vendorNames.get(lot.vendor_id) ?? null;
    }
    let brandName: string | null = null;
    if (lot.brand_id) {
      if (!brandNames.has(lot.brand_id)) {
        const { data } = await admin
          .from("brands")
          .select("display_name")
          .eq("id", lot.brand_id)
          .maybeSingle();
        brandNames.set(lot.brand_id, (data as { display_name: string } | null)?.display_name ?? null);
      }
      brandName = brandNames.get(lot.brand_id) ?? null;
    }

    // Carry potency from the lab result.
    let lab = {
      thc_pct: null as number | null,
      cbd_pct: null as number | null,
      total_thc_pct: null as number | null,
      total_cannabinoids_pct: null as number | null,
      potency_json: null as Record<string, number> | null,
    };
    if (lot.lab_result_id) {
      if (!labCache.has(lot.lab_result_id)) {
        const { data } = await admin
          .from("lab_results")
          .select("thc_pct, cbd_pct, total_thc_pct, total_cannabinoids_pct, potency_json")
          .eq("id", lot.lab_result_id)
          .maybeSingle();
        const d = data as typeof lab | null;
        labCache.set(lot.lab_result_id, d ?? lab);
      }
      lab = labCache.get(lot.lab_result_id) ?? lab;
    }

    // Upsert by open POS key (the partial unique index makes this idempotent).
    await admin
      .from("catalog_product_drafts")
      .upsert(
        {
          pos_product_key: lot.pos_product_key,
          source_item_id: lot.pos_product_key,
          name: lot.product_name ?? "",
          brand_name: brandName,
          vendor_name: vendorName,
          category: lot.category,
          inventory_type: lot.inventory_type,
          strain_name: lot.strain_name,
          thc_pct: lab.thc_pct,
          cbd_pct: lab.cbd_pct,
          total_thc_pct: lab.total_thc_pct,
          total_cannabinoids_pct: lab.total_cannabinoids_pct,
          potency_json: lab.potency_json,
          manifest_id: manifestId,
          lot_id: lot.id,
          lab_result_id: lot.lab_result_id,
          status: "draft",
          created_by: actorId,
          updated_by: actorId,
        },
        { onConflict: "pos_product_key", ignoreDuplicates: true },
      );
  }

  return { matched, unmatched, hasPublishedMenu };
}

/** List drafts, optionally filtered by status. */
export async function listCatalogDrafts(status = "draft"): Promise<CatalogDraft[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("catalog_product_drafts")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(500);
  return (data as CatalogDraft[] | null) ?? [];
}

export async function countCatalogDrafts(): Promise<{ draft: number; approved: number; dismissed: number }> {
  const empty = { draft: 0, approved: 0, dismissed: 0 };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("catalog_product_drafts").select("status").limit(5000);
  const rows = (data as { status: string }[] | null) ?? [];
  const counts = { ...empty };
  for (const r of rows) {
    if (r.status === "draft") counts.draft += 1;
    else if (r.status === "approved") counts.approved += 1;
    else if (r.status === "dismissed") counts.dismissed += 1;
  }
  return counts;
}

/** Mark a draft approved (validated by an employee) or dismissed. */
export async function setCatalogDraftStatus(
  draftId: string,
  status: "approved" | "dismissed" | "draft",
  actorId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("catalog_product_drafts")
    .update({ status, updated_by: actorId })
    .eq("id", draftId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
