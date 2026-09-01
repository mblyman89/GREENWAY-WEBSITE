/**
 * SLICE 66 — server plumbing for the card identity overlay (D1/D2/D3).
 *
 * The public site renders through live-menu's menuRowToGreenwayItem, which
 * copies the menu row's brand_name/vendor_name verbatim — so a brand linked
 * in Product Enrichment (product_enrichments.brand_id) was stored but never
 * displayed, and auto-created vendors showed their manifest header verbatim
 * ("CERES - 435011"). This module batches the two lookups and hands them to
 * the PURE applyCardIdentity (card-identity-core.ts):
 *
 *   1. pos_product_key → PUBLISHED enrichment brand display name
 *      (product_enrichments.brand_id → brands.display_name) — D2.
 *   2. normalizeVendorKey(vendors.display_name) → vendorShortLabel
 *      (dba preferred, license suffix stripped) — D1/D3.
 *
 * DISPLAY-ONLY: nothing is written; the stored menu rows keep their full
 * brand/vendor text for search, admin, carts, receipts, and CCRS reporting.
 * Reads degrade gracefully — any failure returns the items unchanged (the
 * pure license-strip fallback still applies when the maps load).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
// SLICE 3: PostgREST truncates at db.max_rows (1,000) without an error.
import { pagedAll, chunkedIn } from "@/lib/supabase/chunked-in";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { normalizeVendorKey } from "@/lib/inventory/vendor-resolve-core";
import {
  applyCardIdentity,
  vendorShortLabel,
  type CardIdentityItem,
} from "@/lib/menu/card-identity-core";

/** Overlay display identity (enriched brand, short vendor) onto menu items. */
export async function withCardIdentity<T extends CardIdentityItem>(items: T[]): Promise<T[]> {
  if (!isSupabaseServiceConfigured || items.length === 0) return items;
  try {
    const [brandByKey, vendorShortByKey] = await Promise.all([
      loadPublishedEnrichmentBrands(items.map((i) => i.id)),
      items.some((i) => (i.vendor ?? "").trim()) ? loadVendorShortLabels() : Promise.resolve(new Map<string, string>()),
    ]);
    return applyCardIdentity(items, brandByKey, vendorShortByKey);
  } catch {
    return items;
  }
}

/** pos_product_key → brands.display_name for PUBLISHED enrichments with a brand link. */
async function loadPublishedEnrichmentBrands(posKeys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const keys = Array.from(new Set(posKeys.filter(Boolean)));
  if (keys.length === 0) return out;
  const admin = createSupabaseAdminClient();

  // 1) Published enrichment rows that carry a brand link.
  //
  // SLICE 3: chunked AND paged. Chunking the id list keeps the request URL
  // short, but a 300-key chunk can still match more than PostgREST's 1,000-row
  // ceiling, and the server truncates silently. chunkedIn() pages inside each
  // chunk, so a product late in the list can no longer lose its brand link and
  // silently fall back to the raw POS brand text on the customer's card.
  const brandIdByKey = new Map<string, string>();
  const CHUNK = 300;
  const enrichmentRows = await chunkedIn<string, { pos_product_key: string; brand_id: string | null }>(
    keys,
    async (chunk, from, to) => {
      const { data } = await admin
        .from("product_enrichments")
        .select("pos_product_key, brand_id")
        .in("pos_product_key", chunk)
        .eq("status", "published")
        .not("brand_id", "is", null)
        .order("pos_product_key", { ascending: true })
        .range(from, to);
      return (data as { pos_product_key: string; brand_id: string | null }[] | null) ?? [];
    },
    { chunkSize: CHUNK },
  );
  for (const r of enrichmentRows) {
    if (r.brand_id) brandIdByKey.set(r.pos_product_key, r.brand_id);
  }
  if (brandIdByKey.size === 0) return out;

  // 2) Resolve the linked brand ids to display names.
  const nameById = new Map<string, string>();
  const ids = Array.from(new Set(brandIdByKey.values()));
  const brandRows = await chunkedIn<string, { id: string; display_name: string | null }>(
    ids,
    async (chunk, from, to) => {
      const { data } = await admin
        .from("brands")
        .select("id, display_name")
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      return (data as { id: string; display_name: string | null }[] | null) ?? [];
    },
    { chunkSize: CHUNK },
  );
  for (const b of brandRows) {
    const name = (b.display_name ?? "").trim();
    if (name) nameById.set(b.id, name);
  }
  for (const [posKey, brandId] of brandIdByKey) {
    const name = nameById.get(brandId);
    if (name) out.set(posKey, name);
  }
  return out;
}

/** normalizeVendorKey(display_name) → short customer label (dba, license-stripped). */
async function loadVendorShortLabels(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const admin = createSupabaseAdminClient();
  // SLICE 3: `.limit(2000)` did NOT raise PostgREST's 1,000-row ceiling — it
  // can only lower it — so vendor 1,001 onward silently lost its short label
  // and customers saw the raw "CERES - 435011" style text instead of "CERES".
  const data = await pagedAll<{ display_name: string | null; dba: string | null }>(
    async (from, to) => {
      const { data: page } = await admin
        .from("vendors")
        .select("display_name, dba")
        .order("display_name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      return (page as { display_name: string | null; dba: string | null }[] | null) ?? [];
    },
  );
  for (const v of (data as { display_name: string | null; dba: string | null }[] | null) ?? []) {
    const key = normalizeVendorKey(v.display_name);
    if (!key) continue;
    const short = vendorShortLabel(v);
    if (short) out.set(key, short);
  }
  return out;
}
