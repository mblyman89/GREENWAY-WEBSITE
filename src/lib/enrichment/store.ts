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
import type { CardAttribution, LastManifest } from "./enrichment-manifest-core";
import { describedBy } from "./gap-vector-core";
import { isMissingIdentityColumnError } from "@/lib/catalog/identity-columns-core";
import {
  enrichmentIdentityForItem,
  enrichmentRowHasContent,
  resolveEnrichmentForItem,
  type EnrichmentVia,
} from "./enrichment-identity-core";
import {
  enrichmentFollowsIdentityOn,
  identityForCardKey,
  loadPublishedEnrichmentsByIdentity,
} from "./enrichment-identity-server";

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
 *
 * S20: also stamps product_enrichments.identity_key (0234) from the card's
 * RAW published menu row, so a row is born linked to its PRODUCT:
 *   - on insert, when the identity is known;
 *   - on an existing row whose identity_key is NULL (gap-fill only: a
 *     conditional `identity_key IS NULL` update, so it can never overwrite a
 *     value a backfill or a person set, and a racing writer is harmless).
 * Best effort and fail-closed: flag off, no card, not enough identity, or a
 * database without 0234 -> the row is created exactly as before S20.
 * A pre-0234 row read by `select *` has no identity_key property at all, so
 * no gap-fill is attempted there.
 */
export async function ensureEnrichment(
  posProductKey: string,
  posFacts: { name?: string | null; brand?: string | null; category?: string | null },
  actorId: string | null,
): Promise<ProductEnrichment> {
  const admin = createSupabaseAdminClient();
  const existing = await getEnrichment(posProductKey);
  if (existing) {
    if ("identity_key" in existing && !existing.identity_key) {
      const identity = await identityForCardKey(posProductKey);
      if (identity) {
        const { error } = await admin
          .from("product_enrichments")
          .update({ identity_key: identity })
          .eq("id", existing.id)
          .is("identity_key", null);
        if (!error) return { ...existing, identity_key: identity };
      }
    }
    return existing;
  }
  const base = {
    pos_product_key: posProductKey,
    last_seen_name: posFacts.name ?? null,
    last_seen_brand: posFacts.brand ?? null,
    last_seen_category: posFacts.category ?? null,
    status: "draft",
    created_by: actorId,
    updated_by: actorId,
  };
  const identity = await identityForCardKey(posProductKey);
  let { data, error } = await admin
    .from("product_enrichments")
    .insert(identity ? { ...base, identity_key: identity } : base)
    .select("*")
    .single();
  if (error && identity && isMissingIdentityColumnError("product_enrichments", error)) {
    // Pre-0234 database: create the row exactly as before S20.
    ({ data, error } = await admin.from("product_enrichments").insert(base).select("*").single());
  }
  if (error || !data) throw new Error(`enrichment init failed: ${error?.message}`);
  return data as ProductEnrichment;
}

/** What getEnrichmentForItem resolved, and from where. */
export type ItemEnrichment = {
  /** The row whose copy/images the card serves (own, or the product's published one). */
  row: ProductEnrichment | null;
  via: EnrichmentVia;
  /** The card's OWN row (what the edit form writes), possibly null or blank. */
  own: ProductEnrichment | null;
};

/**
 * S20 (bible S20.2): the enrichment a card SERVES. The card's own row when it
 * has content (Q-03: copy already written on a card key always wins); else
 * the PUBLISHED enrichment of the same product (identity_key), written on an
 * earlier card key; else the own row as-is. Writes still go to the own row.
 * Flag off -> exactly getEnrichment(posKey).
 */
export async function getEnrichmentForItem(item: MenuItemRow): Promise<ItemEnrichment> {
  const own = await getEnrichment(item.source_item_id);
  if (own && enrichmentRowHasContent(own)) return { row: own, via: "pos_key", own };
  const identity = enrichmentFollowsIdentityOn() ? enrichmentIdentityForItem(item) : null;
  const byIdentity = identity
    ? (await loadPublishedEnrichmentsByIdentity<ProductEnrichment>([identity], "*")).get(identity) ?? null
    : null;
  const r = resolveEnrichmentForItem({
    own,
    byIdentity,
    enabled: enrichmentFollowsIdentityOn(),
    hasContent: enrichmentRowHasContent,
  });
  return { row: r.row, via: r.via, own };
}

/**
 * Batch form of getEnrichmentForItem for the products list (one own-key read
 * already done by the caller, plus ONE identity read for the cards whose own
 * row is absent or blank). Returns the served row per card key and the set
 * of keys served via identity.
 */
export async function resolveEnrichmentsForItems(
  items: readonly MenuItemRow[],
  ownByKey: ReadonlyMap<string, ProductEnrichment>,
): Promise<{ byKey: Map<string, ProductEnrichment>; viaIdentity: Set<string> }> {
  const byKey = new Map<string, ProductEnrichment>(ownByKey);
  const viaIdentity = new Set<string>();
  if (!enrichmentFollowsIdentityOn()) return { byKey, viaIdentity };
  const need = new Map<string, string>();
  for (const it of items) {
    const own = ownByKey.get(it.source_item_id) ?? null;
    if (own && enrichmentRowHasContent(own)) continue;
    const id = enrichmentIdentityForItem(it);
    if (id) need.set(it.source_item_id, id);
  }
  if (need.size === 0) return { byKey, viaIdentity };
  const survivors = await loadPublishedEnrichmentsByIdentity<ProductEnrichment>([...need.values()], "*");
  for (const it of items) {
    const id = need.get(it.source_item_id);
    if (!id) continue;
    const r = resolveEnrichmentForItem({
      own: ownByKey.get(it.source_item_id) ?? null,
      byIdentity: survivors.get(id) ?? null,
      enabled: true,
      hasContent: enrichmentRowHasContent,
    });
    if (r.via === "identity" && r.row) {
      byKey.set(it.source_item_id, r.row);
      viaIdentity.add(it.source_item_id);
    }
  }
  return { byKey, viaIdentity };
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
  /**
   * S23: true when the only text on file is the house placeholder sentence
   * (so hasDescription is false although the row is not blank). Optional:
   * literal GapFlags-shaped rows elsewhere predate it.
   */
  descriptionPlaceholder?: boolean;
  hasImage: boolean;
  hasBrandLink: boolean;
  enrichmentStatus: string | null;
  // SLICE 72 — extra worklist signals (additive; existing consumers unaffected).
  /** Tags power site search/filtering; missing tags is a real gap. */
  hasTags: boolean;
  /** POS price in cents — lets the worklist sort by product value. */
  priceMinorUnits: number;
  /** POS stock status (in-stock / low-stock / unavailable) for worklist filtering. */
  inventoryStatus: string;
  // S22 (bible S22.2) - where the card came from. null = not attributed
  // (the lot/manifest read was not made or failed), never a guess.
  /** The card's newest delivery, or the 'Cultivera import' pseudo-manifest. */
  lastManifest: LastManifest | null;
  /** When the card's newest lot was received (ISO); null = unknown. */
  lastReceivedAt: string | null;
};

/**
 * Compute gap flags for a set of menu items merged with their enrichment.
 * Used by the products list + gap dashboard.
 */
export function computeGaps(
  item: MenuItemRow,
  enrichment: ProductEnrichment | null,
  // S22: the lot -> delivery attribution (enrichment-manifest-core.ts
  // attributeCards). Omitted by callers that don't need it.
  attribution?: CardAttribution | null,
): GapFlags {
  // S23 (F-082/F-064): the house placeholder ("<name> from <brand>. Browse
  // current availability...") is NOT a description. Same rule as the detail
  // header's gap vector (gap-vector-core describedBy), so the list counters
  // and the detail page can never disagree.
  const describedFrom = describedBy(enrichment?.description, item.description);
  const hasDescription = describedFrom !== null;
  const descriptionPlaceholder = !hasDescription && String(enrichment?.description || item.description || "").trim() !== "";
  const hasImage = Boolean(enrichment && (enrichment.primary_media_id || enrichment.image_media_ids.length > 0));
  const hasBrandLink = Boolean(enrichment?.brand_id);
  return {
    posKey: item.source_item_id,
    name: enrichment?.display_name || item.name,
    brand: item.brand_name,
    category: item.category,
    hasDescription,
    descriptionPlaceholder,
    hasImage,
    hasBrandLink,
    enrichmentStatus: enrichment?.status ?? null,
    // SLICE 72 — worklist signals.
    hasTags: (enrichment?.tags?.length ?? 0) > 0,
    priceMinorUnits: item.price_minor_units,
    inventoryStatus: item.inventory_status,
    lastManifest: attribution?.lastManifest ?? null,
    lastReceivedAt: attribution?.lastReceivedAt ?? null,
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
  // SLICE 66 (owner D2): a published enrichment's linked brand finally WINS on
  // display. Callers pass a brand_id -> display-name resolver (batched like
  // imageUrlResolver); omitted/unresolved -> the POS row's brand_name stands.
  brandNameResolver?: (brandId: string) => string | null,
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
    brandName: (e?.brand_id && brandNameResolver?.(e.brand_id)) || item.brand_name,
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
