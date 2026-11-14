/**
 * D244 E-3 — the reads behind the detail page's "Recommended photos" panel.
 *
 * One call, never throws. Pool (see image-recommend-v3-core.ts):
 *   remembered + on-record pictures by id, the full-name search, one search
 *   per own name word, the vendor's / brand's shelf and the newest pictures
 *   of the whole library. The vendor is the enrichment's own vendor card,
 *   else the same resolution the worklist uses (brand's vendor, POS vendor
 *   name) — never a guess beyond those links.
 */
import "server-only";
import { readLibraryAssetsByIds, readLibraryPickerAssets, readSearchHitAssets } from "@/lib/media/library-picker-server";
import { loadImageMemory, loadOnRecordImageIds } from "@/lib/catalog/image-memory-server";
import { recommendImages } from "@/lib/catalog/image-recommend-core";
import { enrichmentIdentityForItem } from "./enrichment-identity-core";
import { readWorklistVendorData } from "./worklist-server";
import { resolveCardVendor } from "./worklist-core";
import {
  RECOMMEND_WIDE_LIMIT,
  mergeRecommendPools,
  orderRecommendPanel,
  recommendFullQuery,
  recommendSearchWords,
  type RecommendPanel,
} from "./image-recommend-v3-core";

export type RecommendPanelRead = RecommendPanel & {
  libraryOk: boolean;
  memoryMissing: boolean;
  /** The identity key an Attach remembers under ("" = not enough identity). */
  identityKey: string;
  vendorId: string | null;
};

export type RecommendPanelInput = {
  item: { name: string; product_name: string | null; brand_name: string | null; vendor_name: string | null; category: string };
  enrichment: {
    vendor_id?: string | null;
    brand_id?: string | null;
    identity_key?: string | null;
    image_media_ids?: string[] | null;
  } | null;
};

/** Identity keys for a card: the stored key first, then the computed one. */
export function cardIdentityKeys(input: RecommendPanelInput): string[] {
  const keys = [(input.enrichment?.identity_key ?? "").trim(), (enrichmentIdentityForItem(input.item) ?? "").trim()];
  return keys.filter((k, i) => k.length >= 3 && keys.indexOf(k) === i);
}

export async function loadRecommendPanel(input: RecommendPanelInput): Promise<RecommendPanelRead> {
  const { item, enrichment } = input;
  const name = item.product_name?.trim() || item.name;
  const keys = cardIdentityKeys(input);
  const empty = (libraryOk: boolean): RecommendPanelRead => ({
    tiles: [], considered: 0, matched: 0, emptyText: null, libraryOk, memoryMissing: false, identityKey: keys[0] ?? "", vendorId: null,
  });
  try {
    let vendorId = (enrichment?.vendor_id ?? "").trim() || null;
    if (!vendorId) {
      const lookups = await readWorklistVendorData().catch(() => null);
      if (lookups) {
        vendorId = resolveCardVendor(
          { ownVendorId: null, attrVendorIds: [], brandName: item.brand_name, posVendorName: item.vendor_name },
          lookups,
        ).vendorId;
      }
    }
    const product = {
      name,
      brand: item.brand_name ?? null,
      vendor: item.vendor_name ?? null,
      category: item.category ?? null,
      vendorId,
      brandId: enrichment?.brand_id ?? null,
    };
    const full = recommendFullQuery(name);
    const wordQs = recommendSearchWords(product);
    const [memory, onRecord, shelf, fullHits, ...wordHits] = await Promise.all([
      loadImageMemory(keys),
      loadOnRecordImageIds(keys),
      readLibraryPickerAssets("all", { vendorIds: [vendorId], brandIds: [enrichment?.brand_id] }),
      full ? readSearchHitAssets(full) : Promise.resolve([]),
      ...wordQs.map((w) => readSearchHitAssets(w, 40)),
    ]);
    const rememberedIds = memory.rows.map((r) => r.media_asset_id);
    const onRecordIds = keys.flatMap((k) => onRecord.get(k) ?? []);
    const picked = await readLibraryAssetsByIds([...rememberedIds, ...onRecordIds]);
    const pool = mergeRecommendPools([picked, fullHits, ...wordHits, shelf.assets]);
    const view = recommendImages({
      assets: pool,
      product,
      memory: memory.rows,
      onRecordIds,
      galleryIds: enrichment?.image_media_ids ?? [],
      limit: RECOMMEND_WIDE_LIMIT,
    });
    const panel = orderRecommendPanel(view, pool, name);
    return { ...panel, libraryOk: shelf.ok, memoryMissing: memory.missing, identityKey: keys[0] ?? "", vendorId };
  } catch {
    return empty(false);
  }
}
