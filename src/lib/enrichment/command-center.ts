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
import { getEnrichmentForItem, computeGaps, type GapFlags } from "@/lib/enrichment/store";
// S23: the per-field gap vector + its one read (the onboarding fact history).
import { buildGapVector, latestProvenance, type GapVector } from "@/lib/enrichment/gap-vector-core";
// R23 (fixes 3 + 10): the sensory gap-fill layer (after the ladder, before the vector).
import {
  factsToAdd,
  fillSensory,
  kbMatchAction,
  sensoryFromAcceptedSuggestions,
  sensoryFromProvenance,
  SENSORY_FIELDS,
  type SensoryField,
  type SensoryLayer,
} from "@/lib/enrichment/sensory-fill-core";
import { strainSlug } from "@/lib/catalog/product-identity-core";
import { loadGapProvenance } from "@/lib/enrichment/gap-vector-server";
import { enrichmentIdentityForItem, type EnrichmentVia } from "@/lib/enrichment/enrichment-identity-core";
import type { MenuItemRow, MenuVariantRow } from "@/lib/pos/db-types";
import { cardLotKeys } from "@/lib/inventory/vendor-identity-core";
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
  /**
   * S24: optionally with its variants (the page passes getItemBySourceKey's
   * MenuItemWithVariants) so the KB ladder can use the card's lots and
   * first variant label. Absent -> the pre-S24 query, unchanged.
   */
  item: MenuItemRow & { variants?: readonly Pick<MenuVariantRow, "label" | "source_variant_id">[] };
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
  /** R23 (fix 10): the row's button - linked already / use its facts / link it. */
  action: { kind: "linked" | "use" | "link"; label: string };
};

/** R23: the KB row a human linked to this card (enrichment.kb_product_id). */
export type LinkedKb = { id: string; displayName: string; status: string };

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
  /**
   * The row SERVED for this card (S20): its own row when it has content,
   * else the product's published survivor (borrowed via identity_key).
   */
  enrichment: ProductEnrichment | null;
  /** S20: how `enrichment` was found ("pos_key" | "identity" | "none"). */
  enrichmentVia: EnrichmentVia;
  /** S20: the card's S03 identity (raw menu row); null = not enough identity. */
  identityKey: string | null;
  gaps: GapFlags;
  /**
   * S23: the per-field gap vector for the detail header ("Still missing: ...
   * Attached at onboarding: ..."). Boilerplate description counts as missing.
   */
  gapVector: GapVector;
  /**
   * KB ladder result for this product (source, copy, sensory, image hint).
   * R23: its four sensory lists are GAP-FILLED (sensory-fill-core) from the
   * linked KB row, accepted suggestions, onboarding-attached facts and the
   * strain library; `sensoryOrigins` names where each filled list came from.
   */
  knowledge: ProductKnowledge;
  sensoryOrigins: Partial<Record<SensoryField, string>>;
  /** R23: the KB row linked to this card by "Use these facts", or null. */
  linkedKb: LinkedKb | null;
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
// R23 (fixes 3 + 10): the sensory fill-layer reads. Each fails soft to
// "no layer" (never throws, never worse than before R23).
// ---------------------------------------------------------------------------

/** Accepted sensory/effects suggestions for the card, newest first. */
async function loadAcceptedSensory(keys: string[]): Promise<{ field_key: string; suggested_value: string }[]> {
  if (!isSupabaseServiceConfigured || keys.length === 0) return [];
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("ai_suggestions")
      .select("field_key, suggested_value, created_at")
      .eq("entity_type", "product")
      .in("entity_id", keys)
      .eq("status", "accepted")
      .in("field_key", ["sensory", "effects"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (error || !data) return [];
    return data as { field_key: string; suggested_value: string }[];
  } catch {
    return [];
  }
}

type LinkedKbRow = {
  id: string;
  display_name: string;
  status: string;
  aroma_notes: string[] | null;
  flavor_notes: string[] | null;
  terpenes: string[] | null;
  effects: string[] | null;
};

/** The kb_products row a human linked to this card. */
async function loadKbById(id: string): Promise<LinkedKbRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("kb_products")
      .select("id, display_name, status, aroma_notes, flavor_notes, terpenes, effects")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return data as LinkedKbRow;
  } catch {
    return null;
  }
}

/**
 * The ACTIVE strain-library row for the card's real strain name (the same
 * rule as ladder rung 4). effects (0071) is read separately so a database
 * without it still gets aroma/flavor/terpenes.
 */
async function loadActiveStrain(strainName: string | null): Promise<Omit<SensoryLayer, "label"> | null> {
  const slug = strainSlug(strainName);
  if (!slug || !isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_strains")
      .select("aroma_notes, flavor_notes, terpenes")
      .eq("slug", slug)
      .eq("active", true)
      .maybeSingle();
    if (error || !data) return null;
    let effects: unknown[] = [];
    const eff = await admin.from("kb_strains").select("effects").eq("slug", slug).eq("active", true).maybeSingle();
    if (!eff.error && eff.data) effects = ((eff.data as { effects?: unknown[] | null }).effects ?? []) as unknown[];
    const row = data as { aroma_notes: unknown[] | null; flavor_notes: unknown[] | null; terpenes: unknown[] | null };
    return { aromaNotes: row.aroma_notes, flavorNotes: row.flavor_notes, terpenes: row.terpenes, effects };
  } catch {
    return null;
  }
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

  const identityKey = enrichmentIdentityForItem(item);
  const lotKeys = cardLotKeys({
    source_item_id: posKey ?? "",
    variants: (item.variants ?? []).map((v) => ({ source_variant_id: v.source_variant_id })),
  });
  const [served, knowledge, kbRows, mediaRows, vendorRows, liveImage, substitute, provenance] =
    await Promise.all([
      getEnrichmentForItem(item).catch(() => ({ row: null, via: "none" as EnrichmentVia, own: null })),
      lookupProductKnowledge({
        productName: pos.name,
        brandName: pos.brand,
        posProductKey: posKey,
        // S20: rung 3b borrows the product's published copy for a new lot.
        identityKey,
        strainName: item.strain_name ?? null,
        // S24 (F-083): same writer-identity inputs the public menu passes.
        menuVariantLabel: item.variants?.[0]?.label ?? null,
        lotKeys,
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
        identityKey,
        brandSlug: pos.brand,
        category: item.pos_inventory_category ?? pos.category,
        inventoryType: item.pos_inventory_type ?? null,
      }).catch(() => null),
      resolveSubstituteFor(
        item.pos_inventory_category ?? pos.category,
        item.pos_inventory_type ?? null,
      ).catch(() => null),
      // S23: the onboarding fact history, by the card's identity AND its lot
      // keys (the S07 door stamps the draft's identity + lot key). null = not read.
      loadGapProvenance({ identityKeys: [identityKey], posKeys: lotKeys }).catch(() => null),
    ]);

  const enrichment = served.row;
  const gaps = computeGaps(item, enrichment);

  // R23 (fixes 3 + 10): the ladder stops at its first rung, and the
  // enrichment rung carries no sensory lists, so a card with its own copy
  // read "Still missing: effects, terpenes, aroma, flavor" even when those
  // facts were on file. Gap-fill each EMPTY list (never replace one) from,
  // in order: facts accepted on this card, the KB row a human linked,
  // facts attached at onboarding (provenance = landed), the strain library.
  const linkedId = typeof enrichment?.kb_product_id === "string" ? enrichment.kb_product_id.trim() : "";
  const suggestionKeys = Array.from(
    new Set([posKey, enrichment?.pos_product_key].filter((k): k is string => typeof k === "string" && k.trim() !== "")),
  );
  const [acceptedRows, linkedRow, strainRow] = await Promise.all([
    loadAcceptedSensory(suggestionKeys),
    linkedId ? loadKbById(linkedId) : Promise.resolve(null),
    loadActiveStrain(item.strain_name ?? null),
  ]);
  const layers: SensoryLayer[] = [
    { label: "Accepted here", ...sensoryFromAcceptedSuggestions(acceptedRows) },
  ];
  if (linkedRow) {
    layers.push({
      label: "Linked KB",
      effects: linkedRow.effects,
      terpenes: linkedRow.terpenes,
      aromaNotes: linkedRow.aroma_notes,
      flavorNotes: linkedRow.flavor_notes,
    });
  }
  layers.push({ label: "Attached at onboarding", ...sensoryFromProvenance(latestProvenance(provenance)) });
  if (strainRow) layers.push({ label: "Strain library", ...strainRow });
  const filled = fillSensory(knowledge, layers);
  const filledKnowledge: ProductKnowledge = {
    ...knowledge,
    effects: filled.lists.effects,
    terpenes: filled.lists.terpenes,
    aromaNotes: filled.lists.aromaNotes,
    flavorNotes: filled.lists.flavorNotes,
  };

  const gapVector = buildGapVector({
    item: { description: item.description, strain_type: item.strain_type, category: item.category },
    enrichment,
    knowledge: { ...filledKnowledge, sensoryOrigins: filled.origins },
    provenance,
  });

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
    const kbLists = {
      aromaNotes: row?.aroma_notes ?? [],
      flavorNotes: row?.flavor_notes ?? [],
      terpenes: row?.terpenes ?? [],
      effects: row?.effects ?? [],
    };
    const proseAdds: string[] = [];
    if (!enrichment?.description?.trim() && row?.description?.trim()) proseAdds.push("description");
    if (!enrichment?.short_description?.trim() && row?.short_description?.trim()) proseAdds.push("short description");
    return {
      ...m,
      description: row?.description ?? null,
      shortDescription: row?.short_description ?? null,
      ...kbLists,
      primaryMediaId: imgId,
      imageUrl: imgId ? urlMap.get(imgId) ?? null : null,
      action: kbMatchAction({
        linked: linkedId !== "" && linkedId === m.candidate.id,
        adds: [...factsToAdd(filledKnowledge, kbLists), ...proseAdds],
      }),
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
  // R23 (fix 3): plus a "Sensory facts" row measured by the SAME gap vector
  // as the red header, so the two can never disagree again. Hidden when the
  // fields do not apply (non-cannabis: all four not_applicable).
  const sensoryEntries = gapVector.entries.filter((x) => (SENSORY_FIELDS as readonly string[]).includes(x.field));
  const sensoryApplies = sensoryEntries.some((x) => x.state !== "not_applicable");
  const checklist = buildEnrichmentChecklist({
    hasDescription: gaps.hasDescription,
    hasImage: gaps.hasImage,
    hasBrandLink: gaps.hasBrandLink,
    hasTags: gaps.hasTags,
    sensoryMissing: sensoryApplies ? sensoryEntries.filter((x) => x.state === "missing").map((x) => x.label) : undefined,
  });

  return {
    enrichment,
    enrichmentVia: served.via,
    identityKey,
    gaps,
    gapVector,
    knowledge: filledKnowledge,
    sensoryOrigins: filled.origins,
    linkedKb: linkedRow ? { id: linkedRow.id, displayName: linkedRow.display_name, status: linkedRow.status } : null,
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
