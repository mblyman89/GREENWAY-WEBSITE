/**
 * src/lib/enrichment/store.ts
 *
 * Server-side service for the product enrichment (marketing) layer. Keyed by the
 * stable POS product key (menu_items.source_item_id). Enrichment is merged over
 * the published menu item at read time and NEVER overrides POS price/stock.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured, supabaseUrl } from "@/lib/supabase/env";
import type { ProductEnrichment, EnrichedMenuItem } from "./types";
import type { MenuItemRow } from "@/lib/pos/db-types";

const MEDIA_BUCKET = "media";

function publicMediaUrl(storageKey: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${MEDIA_BUCKET}/${storageKey}`;
}

export async function getEnrichment(posProductKey: string): Promise<ProductEnrichment | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("product_enrichments")
    .select("*")
    .eq("pos_product_key", posProductKey)
    .maybeSingle();
  return (data as ProductEnrichment | null) ?? null;
}

/** Fetch enrichments for many POS keys in one query, keyed by pos_product_key. */
export async function getEnrichmentsForKeys(keys: string[]): Promise<Map<string, ProductEnrichment>> {
  const map = new Map<string, ProductEnrichment>();
  if (!isSupabaseServiceConfigured || keys.length === 0) return map;
  const admin = createSupabaseAdminClient();
  const CHUNK = 300;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const { data } = await admin.from("product_enrichments").select("*").in("pos_product_key", slice);
    for (const row of (data as ProductEnrichment[] | null) ?? []) {
      map.set(row.pos_product_key, row);
    }
  }
  return map;
}

/**
 * Create the enrichment row for a POS key if it doesn't exist yet (lazy init
 * when a staff member first opens a product). Stamps last-seen POS facts.
 */
export async function ensureEnrichment(
  posProductKey: string,
  posFacts: { name?: string | null; brand?: string | null; category?: string | null },
  actorId: string | null,
): Promise<ProductEnrichment> {
  const admin = createSupabaseAdminClient();
  const existing = await getEnrichment(posProductKey);
  if (existing) return existing;
  const { data, error } = await admin
    .from("product_enrichments")
    .insert({
      pos_product_key: posProductKey,
      last_seen_name: posFacts.name ?? null,
      last_seen_brand: posFacts.brand ?? null,
      last_seen_category: posFacts.category ?? null,
      status: "draft",
      created_by: actorId,
      updated_by: actorId,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`enrichment init failed: ${error?.message}`);
  return data as ProductEnrichment;
}

export type EnrichmentUpdate = Partial<{
  display_name: string | null;
  description: string | null;
  short_description: string | null;
  image_media_ids: string[];
  primary_media_id: string | null;
  brand_id: string | null;
  vendor_id: string | null;
  tags: string[];
  staff_pick: boolean;
  featured: boolean;
  staff_note: string | null;
  hidden_override: boolean | null;
  hidden_reason: string | null;
  seo_title: string | null;
  seo_description: string | null;
  status: "draft" | "published" | "archived";
}>;

export async function updateEnrichment(
  posProductKey: string,
  update: EnrichmentUpdate,
  actorId: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("product_enrichments")
    .update({ ...update, updated_by: actorId })
    .eq("pos_product_key", posProductKey);
  if (error) throw new Error(error.message);
}

/** Resolve media asset ids to public URLs (only published assets serve publicly). */
export async function mediaUrlsForIds(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!isSupabaseServiceConfigured || ids.length === 0) return map;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("media_assets").select("id, storage_key").in("id", ids);
  for (const row of (data as { id: string; storage_key: string }[] | null) ?? []) {
    map.set(row.id, publicMediaUrl(row.storage_key));
  }
  return map;
}

export type GapFlags = {
  posKey: string;
  name: string;
  brand: string;
  category: string;
  hasDescription: boolean;
  hasImage: boolean;
  hasBrandLink: boolean;
  enrichmentStatus: string | null;
};

/**
 * Compute gap flags for a set of menu items merged with their enrichment.
 * Used by the products list + gap dashboard.
 */
export function computeGaps(item: MenuItemRow, enrichment: ProductEnrichment | null): GapFlags {
  const hasDescription = Boolean(enrichment?.description || (item.description && item.description.trim().length > 0));
  const hasImage = Boolean(enrichment && (enrichment.primary_media_id || enrichment.image_media_ids.length > 0));
  const hasBrandLink = Boolean(enrichment?.brand_id);
  return {
    posKey: item.source_item_id,
    name: enrichment?.display_name || item.name,
    brand: item.brand_name,
    category: item.category,
    hasDescription,
    hasImage,
    hasBrandLink,
    enrichmentStatus: enrichment?.status ?? null,
  };
}

/**
 * Merge a published menu item with its enrichment for PUBLIC display.
 * Only enrichment with status 'published' is applied; POS price/stock are
 * always taken from the menu item and never overridden. `imageUrlResolver`
 * maps media ids to public URLs (caller batches these to avoid N+1).
 */
export function mergeForDisplay(
  item: MenuItemRow,
  enrichment: ProductEnrichment | null,
  imageUrlResolver: (mediaId: string) => string | null,
): EnrichedMenuItem {
  const e = enrichment && enrichment.status === "published" ? enrichment : null;

  const imageIds = e?.image_media_ids ?? [];
  const imageUrls = imageIds.map((id) => imageUrlResolver(id)).filter((u): u is string => Boolean(u));
  const primaryId = e?.primary_media_id ?? imageIds[0] ?? null;
  const primaryImageUrl = primaryId ? imageUrlResolver(primaryId) : null;

  // Visibility: enrichment override wins when set, else POS hidden.
  const hidden = e?.hidden_override === null || e?.hidden_override === undefined ? item.hidden : e.hidden_override;

  return {
    posKey: item.source_item_id,
    priceLabel: item.price_label,
    priceMinorUnits: item.price_minor_units,
    inventoryStatus: item.inventory_status,
    name: e?.display_name || item.name,
    description: e?.description || item.description,
    shortDescription: e?.short_description ?? null,
    brandName: item.brand_name,
    category: item.category,
    tags: e?.tags ?? [],
    staffPick: e?.staff_pick ?? false,
    featured: e?.featured ?? false,
    staffNote: e?.staff_note ?? null,
    primaryImageUrl,
    imageUrls,
    hidden,
    seoTitle: e?.seo_title ?? null,
    seoDescription: e?.seo_description ?? null,
  };
}
