import "server-only";

import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { resolveProductImagesBatch } from "@/lib/enrichment/image-resolver";
import { buildSyndicationFeed, type FeedSourceItem, type SyndicationItem } from "./menu-feed-core";

/**
 * Load the currently published POS menu version and map it into the channel-agnostic
 * SyndicationItem[] used by Leafly / WeedMaps push modules. Hidden items are filtered
 * out by buildSyndicationFeed. Returns [] if there is no published version.
 *
 * Task X: also batch-resolves each product's EXACT enrichment photo (never a
 * representative substitute — third-party menus must show honest imagery) and
 * attaches it as `imageUrl` so the channel builders can transmit it.
 */
export async function loadSyndicationFeed(): Promise<{
  versionId: string | null;
  items: SyndicationItem[];
}> {
  const version = await getPublishedVersion();
  if (!version) {
    return { versionId: null, items: [] };
  }

  const rows = await getVersionItems(version.id);

  // Batch-resolve exact photos (one pass, no N+1). We deliberately pass ONLY
  // the posKey so the resolver can't fall back to brand/category substitutes,
  // and we still filter on `source === "exact"` as a belt-and-suspenders check.
  let exactImageByKey = new Map<string, string>();
  try {
    const resolved = await resolveProductImagesBatch(
      rows.map((row) => ({ posKey: row.source_item_id })),
    );
    exactImageByKey = new Map(
      Array.from(resolved.entries())
        .filter(([, img]) => img.source === "exact" && !img.isFallback)
        .map(([key, img]) => [key, img.url]),
    );
  } catch {
    // Image resolution is enrichment, never a blocker — feed still loads.
    exactImageByKey = new Map();
  }

  const sourceItems: FeedSourceItem[] = rows.map((row) => ({
    source_item_id: row.source_item_id,
    name: row.product_name || row.name,
    brand_name: row.brand_name ?? null,
    category: row.category,
    strain_type: row.strain_type ?? null,
    strain_name: row.strain_name ?? null,
    thc: row.thc ?? null,
    cbd: row.cbd ?? null,
    description: row.description ?? null,
    price_minor_units: row.price_minor_units,
    inventory_status: row.inventory_status ?? null,
    hidden: Boolean(row.hidden),
    variants: (row.variants ?? []).map((v) => ({
      source_variant_id: v.source_variant_id,
      label: v.label,
      price_minor_units: v.price_minor_units,
      inventory_level: v.inventory_level,
    })),
    image_url: exactImageByKey.get(row.source_item_id) ?? null,
  }));

  return { versionId: version.id, items: buildSyndicationFeed(sourceItems) };
}
