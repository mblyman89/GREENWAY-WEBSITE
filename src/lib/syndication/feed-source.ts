import "server-only";

import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { buildSyndicationFeed, type FeedSourceItem, type SyndicationItem } from "./menu-feed-core";

/**
 * Load the currently published POS menu version and map it into the channel-agnostic
 * SyndicationItem[] used by Leafly / WeedMaps push modules. Hidden items are filtered
 * out by buildSyndicationFeed. Returns [] if there is no published version.
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
  }));

  return { versionId: version.id, items: buildSyndicationFeed(sourceItems) };
}
