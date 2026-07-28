/**
 * src/lib/enrichment/command-center.ts — SLICE 38 (Enrichment Powerhouse).
 *
 * The READ-ONLY aggregator behind the Product Enrichment command center. For
 * ONE POS product it gathers, in parallel and defensively (never throws,
 * every source degrades to empty):
 *
 *   • the KB knowledge ladder result (lookupProductKnowledge — previously
 *     only wired to the public menu, now finally surfaced to the enricher),
 *   • ranked kb_products candidates (validated copy + image galleries),
 *   • ranked media-library candidates (listMedia product images),
 *   • ranked vendor menu-line candidates (Cultivera + GrowFlow snapshots,
 *     with importable image_url / already-saved media_asset_id),
 *   • what the LIVE MENU will actually render for this product right now
 *     (resolveProductImage with full ladder provenance),
 *   • the approved substitute image available for this category/type
 *     (the "use a fallback image instead?" offer),
 *   • plain-English guidance on HOW to get assets when nothing matches.
 *
 * All scoring is the pure, conservative token-overlap engine in
 * src/lib/enrichment/match-core.ts. This module only reads; applying a match
 * is a separate explicit server action the human clicks.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { ilikeContains } from "@/lib/supabase/postgrest-escape";
import { getEnrichment, computeGaps, type GapFlags } from "@/lib/enrichment/store";
import type { MenuItemRow } from "@/lib/pos/db-types";
import type { ProductEnrichment } from "@/lib/enrichment/types";
import { resolveProductImage, type ResolvedImage } from "@/lib/enrichment/image-resolver";
import { lookupProductKnowledge, type ProductKnowledge } from "@/lib/ai/kb/product-lookup";
import { listKbProducts } from "@/lib/ai/kb/store";
import { resolveSubstituteFor } from "@/lib/ai/kb/image-substitutes";
import { listMedia, resolveMediaUrls } from "@/lib/media/store";
import {
  buildAssetGuidance,
  buildEnrichmentChecklist,
  buildGuidanceActions,
  type ChecklistItem,
  type GuidanceAction,
  rankMatches,
  scoreKbCandidate,
  scoreMediaCandidate,
  scoreVendorCandidate,
  tokenizeEnrichment,
  type KbCandidate,
  type MediaCandidate,
  type PosProductSignals,
  type ScoredMatch,
  type VendorItemCandidate,
} from "@/lib/enrichment/match-core";

// ---------------------------------------------------------------------------
// Input + output shapes
// ---------------------------------------------------------------------------

export type CommandCenterQuery = {
  /** The published menu item being enriched (source of the POS facts). */
  item: MenuItemRow;
};

/** A ranked KB suggestion with its gallery preview resolved. */
export type KbSuggestion = ScoredMatch<KbCandidate> & {
  description: string | null;
  shortDescription: string | null;
  aromaNotes: string[];
  flavorNotes: string[];
  terpenes: string[];
  effects: string[];
  primaryMediaId: string | null;
  imageUrl: string | null;
};

/** A ranked media-library suggestion with its URL resolved. */
export type MediaSuggestion = ScoredMatch<MediaCandidate> & {
  url: string | null;
};

/** A ranked vendor menu-line suggestion. */
export type VendorSuggestion = ScoredMatch<VendorItemCandidate> & {
  /** URL of the already-imported asset when media_asset_id is set. */
  savedMediaUrl: string | null;
};

export type EnrichmentCommandCenter = {
  enrichment: ProductEnrichment | null;
  gaps: GapFlags;
  /** KB ladder result for this product (source, copy, sensory, image hint). */
  knowledge: ProductKnowledge;
  kbSuggestions: KbSuggestion[];
  mediaSuggestions: MediaSuggestion[];
  vendorSuggestions: VendorSuggestion[];
  /** What the live menu resolves for this product RIGHT NOW (null = mockup). */
  liveImage: ResolvedImage | null;
  /** Approved fallback for this category/type, offered when no exact image. */
  substitute: { url: string; scope: string; key: string } | null;
  /** Plain-English "how to get assets" checklist (empty = fully enriched). */
  guidance: string[];
  /** SLICE 73 — jump-to buttons that take you WHERE each guidance step happens. */
  guidanceActions: GuidanceAction[];
  /** SLICE 75 — permanent ✓/○ scorecard (photo/description/brand/tags). */
  checklist: ChecklistItem[];
};

// ---------------------------------------------------------------------------
// Vendor menu-line search (Cultivera + GrowFlow snapshots).
// ---------------------------------------------------------------------------

/**
 * Find vendor menu lines whose name shares the product's two strongest tokens.
 * Tolerant of either table being missing (pre-migration) — returns [].
 */
async function findVendorCandidates(pos: PosProductSignals): Promise<VendorItemCandidate[]> {
  if (!isSupabaseServiceConfigured) return [];
  const tokens = tokenizeEnrichment(pos.name).slice(0, 2);
  const likes = tokens.map((t) => ilikeContains(t)).filter((v): v is string => Boolean(v));
  if (likes.length === 0) return [];
  const orExpr = likes.map((like) => `name.ilike.${like}`).join(",");

  const admin = createSupabaseAdminClient();
  const cols = "id, name, brand, category, image_url, media_asset_id, description";
  const out: VendorItemCandidate[] = [];

  for (const [table, platform] of [
    ["cultivera_menu_items", "cultivera"],
    ["growflow_menu_items", "growflow"],
  ] as const) {
    try {
      const { data, error } = await admin
        .from(table)
        .select(cols)
        .or(orExpr)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error || !data) continue;
      for (const r of data as {
        id: string;
        name: string | null;
        brand: string | null;
        category: string | null;
        image_url: string | null;
        media_asset_id: string | null;
        description: string | null;
      }[]) {
        out.push({ ...r, platform });
      }
    } catch {
      // Table not migrated / transient error → skip this platform.
    }
  }

  // De-dupe identical vendor lines across snapshots (same name+brand+platform,
  // keep the freshest — data is already newest-first per platform).
  const seen = new Set<string>();
  return out.filter((v) => {
    const k = `${v.platform}|${(v.name ?? "").toLowerCase()}|${(v.brand ?? "").toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// The aggregator
// ---------------------------------------------------------------------------

const SUGGESTION_LIMIT = 5;

export async function getEnrichmentCommandCenter(
  q: CommandCenterQuery,
): Promise<EnrichmentCommandCenter> {
  const item = q.item;
  const posKey = item.source_item_id;
  const pos: PosProductSignals = {
    name: item.product_name?.trim() || item.name,
    brand: item.brand_name || null,
    category: item.category || null,
  };

  const [enrichment, knowledge, kbRows, mediaRows, vendorRows, liveImage, substitute] =
    await Promise.all([
      getEnrichment(posKey).catch(() => null),
      lookupProductKnowledge({
        productName: pos.name,
        brandName: pos.brand,
        posProductKey: posKey,
        strainName: item.strain_name ?? null,
      }).catch(
        (): ProductKnowledge => ({
          source: "none",
          displayName: null,
          description: null,
          shortDescription: null,
          aromaNotes: [],
          flavorNotes: [],
          terpenes: [],
          effects: [],
          imageMediaIds: [],
          primaryMediaId: null,
          imageHint: "online",
          needsOnline: true,
        }),
      ),
      listKbProducts("all", 500).catch(() => []),
      listMedia({ usageType: "product", limit: 400 }).catch(() => []),
      findVendorCandidates(pos),
      resolveProductImage({
        posKey,
        brandSlug: pos.brand,
        category: item.pos_inventory_category ?? pos.category,
        inventoryType: item.pos_inventory_type ?? null,
      }).catch(() => null),
      resolveSubstituteFor(
        item.pos_inventory_category ?? pos.category,
        item.pos_inventory_type ?? null,
      ).catch(() => null),
    ]);

  const gaps = computeGaps(item, enrichment);

  // --- Rank KB products -----------------------------------------------------
  const kbRanked = rankMatches(
    kbRows.map((k) =>
      scoreKbCandidate(pos, {
        id: k.id,
        display_name: k.display_name,
        brand_slug: k.brand_slug,
        variant_label: k.variant_label,
        category: k.category,
        status: k.status,
        hasImage: Boolean(k.primary_media_id) || (k.image_media_ids?.length ?? 0) > 0,
        hasDescription: Boolean(k.description),
      }),
    ),
    SUGGESTION_LIMIT,
  );
  const kbById = new Map(kbRows.map((k) => [k.id, k]));
  const kbImageIds = kbRanked
    .map((m) => kbById.get(m.candidate.id)?.primary_media_id || kbById.get(m.candidate.id)?.image_media_ids?.[0] || null)
    .filter((id): id is string => Boolean(id));

  // --- Rank media assets ----------------------------------------------------
  const mediaRanked = rankMatches(
    mediaRows.map((m) =>
      scoreMediaCandidate(pos, {
        id: m.id,
        title: m.title,
        alt_text: m.alt_text,
        tags: m.tags ?? [],
        usage_type: m.usage_type,
        status: m.status,
      }),
    ),
    SUGGESTION_LIMIT,
  );

  // --- Rank vendor lines ----------------------------------------------------
  const vendorRanked = rankMatches(
    vendorRows.map((v) => scoreVendorCandidate(pos, v)),
    SUGGESTION_LIMIT,
  );
  const vendorSavedIds = vendorRanked
    .map((m) => m.candidate.media_asset_id)
    .filter((id): id is string => Boolean(id));

  // --- Resolve all preview URLs in one batch --------------------------------
  const urlMap = await resolveMediaUrls([
    ...kbImageIds,
    ...mediaRanked.map((m) => m.candidate.id),
    ...vendorSavedIds,
  ]).catch(() => new Map<string, string>());

  const kbSuggestions: KbSuggestion[] = kbRanked.map((m) => {
    const row = kbById.get(m.candidate.id);
    const imgId = row?.primary_media_id || row?.image_media_ids?.[0] || null;
    return {
      ...m,
      description: row?.description ?? null,
      shortDescription: row?.short_description ?? null,
      aromaNotes: row?.aroma_notes ?? [],
      flavorNotes: row?.flavor_notes ?? [],
      terpenes: row?.terpenes ?? [],
      effects: row?.effects ?? [],
      primaryMediaId: imgId,
      imageUrl: imgId ? urlMap.get(imgId) ?? null : null,
    };
  });

  const mediaSuggestions: MediaSuggestion[] = mediaRanked.map((m) => ({
    ...m,
    url: urlMap.get(m.candidate.id) ?? null,
  }));

  const vendorSuggestions: VendorSuggestion[] = vendorRanked.map((m) => ({
    ...m,
    savedMediaUrl: m.candidate.media_asset_id
      ? urlMap.get(m.candidate.media_asset_id) ?? null
      : null,
  }));

  const guidance = buildAssetGuidance({
    hasDescription: gaps.hasDescription,
    hasImage: gaps.hasImage,
    kbMatches: kbSuggestions.length,
    mediaMatches: mediaSuggestions.length,
    vendorMatches: vendorSuggestions.length,
    substituteAvailable: Boolean(substitute),
    brand: pos.brand,
  });

  // SLICE 73 — jump-to buttons mirroring the guidance, with the media-library
  // search pre-filled from the product's name tokens (same tokens the vendor
  // candidate finder uses, so the search lands on the right shelf).
  const guidanceActions = buildGuidanceActions({
    hasDescription: gaps.hasDescription,
    hasImage: gaps.hasImage,
    kbMatches: kbSuggestions.length,
    mediaMatches: mediaSuggestions.length,
    vendorMatches: vendorSuggestions.length,
    substituteAvailable: Boolean(substitute),
    brand: pos.brand,
    hasBrandLink: gaps.hasBrandLink,
    hasTags: gaps.hasTags,
    searchQuery: tokenizeEnrichment(pos.name).slice(0, 3).join(" ") || pos.name,
  });

  // SLICE 75 — the permanent ✓/○ scorecard (the panel never disappears now).
  const checklist = buildEnrichmentChecklist({
    hasDescription: gaps.hasDescription,
    hasImage: gaps.hasImage,
    hasBrandLink: gaps.hasBrandLink,
    hasTags: gaps.hasTags,
  });

  return {
    enrichment,
    gaps,
    knowledge,
    kbSuggestions,
    mediaSuggestions,
    vendorSuggestions,
    liveImage,
    substitute,
    guidance,
    guidanceActions,
    checklist,
  };
}
