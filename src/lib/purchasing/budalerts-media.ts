/**
 * src/lib/purchasing/budalerts-media.ts
 *
 * D242 — save Budalerts product photos into the media library, then link the
 * saved asset back onto the listing row.
 *
 * INTERNAL USE ONLY (owner's permission from Budalerts):
 *   - Saved with provenance platform "other", so the library's auto-publish
 *     rule (vendor-source platforms only) never fires: every photo stays a
 *     DRAFT until a person decides. Tagged "budalerts" + "internal-only" and
 *     credited "Budalerts (internal use only)".
 *   - Unlike the LeafLink/GrowFlow savers, nothing is written to the product
 *     knowledge base (kb_products): that feeds customer-facing text, and
 *     Budalerts material must not reach the public site on its own.
 *   - Images go through the shipped harvest rails (importImageFromUrl):
 *     http(s) only, private-host refusal, image-MIME check, 5 MB cap, sha256
 *     dedupe — so re-saves and the same photo on many listings are one asset.
 */
import "server-only";

import { importImageFromUrl, HarvestImageError } from "@/lib/media/harvest";
import { recordUsage } from "@/lib/media/store";
import { resolveMediaVendorId } from "@/lib/media/vendor-resolve-server";
import type { MediaProvenance } from "@/lib/media/provenance-core";
import {
  BUDALERTS_CREDIT,
  budalertsMediaAlt,
  budalertsMediaTags,
  budalertsMediaTitle,
  budalertsMenuItemRef,
} from "@/lib/purchasing/budalerts-core";
import { linkBudalertsItemMedia, type BudalertsMenuItemRow } from "@/lib/purchasing/budalerts-store";

export type SaveBudalertsImageResult = {
  ok: boolean;
  itemId: string;
  assetId: string | null;
  deduped: boolean;
  error: string | null;
};

/** Save ONE listing's photo. Never throws for expected failures (bulk runs keep going). */
export async function saveBudalertsItemImage(
  item: BudalertsMenuItemRow,
  uploadedBy: string | null,
  vendorIdHint: string | null = null,
): Promise<SaveBudalertsImageResult> {
  if (!item.image_url) return { ok: false, itemId: item.id, assetId: null, deduped: false, error: "This listing has no photo." };
  if (item.media_asset_id) return { ok: true, itemId: item.id, assetId: item.media_asset_id, deduped: true, error: null };
  try {
    const vendorId = vendorIdHint ?? (await resolveMediaVendorId(item.brand ?? null).catch(() => null));
    const provenance: MediaProvenance = {
      platform: "other",
      vendorId,
      productName: item.name,
      strainName: item.strain,
      category: item.category,
      packSize: item.size_label,
      menuItemRef: budalertsMenuItemRef(item.id),
      sourceUrl: item.image_url,
      sourcePageUrl: item.product_url,
      role: "product",
      creditText: BUDALERTS_CREDIT,
    };
    const { asset, deduped } = await importImageFromUrl({
      imageUrl: item.image_url,
      usageType: "product",
      title: budalertsMediaTitle(item),
      altText: budalertsMediaAlt(item),
      uploadedBy,
      tags: budalertsMediaTags(item.brand),
      provenance,
    });
    await linkBudalertsItemMedia(item.id, asset.id);
    await recordUsage(asset.id, "budalerts_menu_item", item.id, "image");
    return { ok: true, itemId: item.id, assetId: asset.id, deduped, error: null };
  } catch (err) {
    const msg = err instanceof HarvestImageError || err instanceof Error ? err.message : "Unexpected error saving the photo.";
    return { ok: false, itemId: item.id, assetId: null, deduped: false, error: msg };
  }
}

/** Link a listing to a photo already saved in this run (same image URL) — no second download. */
export async function linkBudalertsItemToAsset(item: BudalertsMenuItemRow, assetId: string): Promise<SaveBudalertsImageResult> {
  try {
    await linkBudalertsItemMedia(item.id, assetId);
    await recordUsage(assetId, "budalerts_menu_item", item.id, "image");
    return { ok: true, itemId: item.id, assetId, deduped: true, error: null };
  } catch (err) {
    return { ok: false, itemId: item.id, assetId: null, deduped: false, error: err instanceof Error ? err.message : "Linking failed." };
  }
}
