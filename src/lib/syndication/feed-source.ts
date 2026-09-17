import "server-only";

import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { resolveProductImagesBatch } from "@/lib/enrichment/image-resolver";
import { getMedicalRegistryForKeys } from "@/lib/medical/sale-store";
import type { DohCategory } from "@/lib/medical/medical-sale-core";
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

  // SLICE L-3: the durable DOH registry (migration 0113), keyed by the SAME
  // stable POS product key the public menu and the register use, so all three
  // surfaces agree by construction rather than by coincidence.
  //
  // WHY THIS READ FAILS CLOSED AND THE IMAGE READ ABOVE FAILS OPEN. An image
  // is enrichment: losing it costs a photo. This read decides whether a
  // WAC 246-70 High-THC product — which by statute may be sold ONLY to a
  // recognition-card holder, with no override — gets published to Leafly as
  // orderable. If the registry read fails and we treated the result as "no
  // restrictions", we would publish exactly the products we must never offer.
  //
  // So a genuine failure THROWS and the sync does not happen. A stale menu is
  // recoverable; a card-only product sitting in a stranger's Leafly cart is
  // not. Note `getMedicalRegistryForKeys` already returns an EMPTY map (not an
  // error) when Supabase is unconfigured or migration 0113 is unapplied, so
  // this does not break a pre-migration build — an empty map simply means
  // "nothing is DOH-verified", which is the truth on such a build.
  const dohByKey: ReadonlyMap<string, DohCategory> = await getMedicalRegistryForKeys(
    rows.map((row) => row.source_item_id),
  );

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
    doh_category: dohByKey.get(row.source_item_id) ?? null,
  }));

  return { versionId: version.id, items: buildSyndicationFeed(sourceItems) };
}
