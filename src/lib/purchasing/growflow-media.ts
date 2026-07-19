/**
 * src/lib/purchasing/growflow-media.ts
 *
 * GF-6 — save GrowFlow menu media (product images + COA documents) into the
 * media library, then link the created asset back onto the menu-item row.
 * Mirrors cultivera-media.ts one-for-one:
 *
 *   • Images reuse the shipped harvest pipeline (importImageFromUrl):
 *     http(s)-only, 5 MB cap, image-MIME check, private-host refusal, sha256
 *     content dedupe, drafts-only with `source: crawl:<url>` provenance and
 *     license pending-review. GrowFlow serves images from Azure blob storage
 *     (growflowweb.blob.core.windows.net) — public https, same rails apply.
 *   • COAs go through importDocumentFromUrl (same rails, PDF MIME, 10 MB).
 *   • Every save records a media_usages row (entity growflow_menu_item) and
 *     writes the asset id back via growflow-store.linkGrowflowItemMedia(), so
 *     both sides know about each other and re-saves are no-ops.
 */
import "server-only";
import {
  importImageFromUrl,
  importDocumentFromUrl,
  HarvestImageError,
} from "@/lib/media/harvest";
import { recordUsage } from "@/lib/media/store";
import { linkGrowflowItemMedia, type GrowflowMenuItemRow } from "@/lib/purchasing/growflow-store";
import type { MediaSaveKind } from "@/lib/purchasing/cultivera-media-core";
import {
  growflowMediaTags,
  growflowMediaTitleForItem,
  growflowMediaAltForItem,
} from "@/lib/purchasing/growflow-media-core";

export type SaveGrowflowItemMediaResult = {
  ok: boolean;
  kind: MediaSaveKind;
  assetId: string | null;
  deduped: boolean;
  error: string | null;
};

/**
 * Save ONE GrowFlow menu item's image or COA into the library, link it back
 * to the item, and record a media_usages row. Never throws for expected
 * failures — returns {ok:false, error} so bulk runs keep going.
 */
export async function saveGrowflowItemMedia(
  item: GrowflowMenuItemRow,
  kind: MediaSaveKind,
  vendorLabel: string,
  uploadedBy: string | null,
): Promise<SaveGrowflowItemMediaResult> {
  const url = kind === "image" ? item.image_url : item.coa_url;
  if (!url) {
    return { ok: false, kind, assetId: null, deduped: false, error: "No URL on this item." };
  }
  const alreadyLinked = kind === "image" ? item.media_asset_id : item.coa_media_asset_id;
  if (alreadyLinked) {
    return { ok: true, kind, assetId: alreadyLinked, deduped: true, error: null };
  }

  try {
    const tags = growflowMediaTags(vendorLabel, kind);
    const { asset, deduped } =
      kind === "image"
        ? await importImageFromUrl({
            imageUrl: url,
            usageType: "product",
            title: growflowMediaTitleForItem(item, "image"),
            altText: growflowMediaAltForItem(item, vendorLabel),
            uploadedBy,
            tags,
          })
        : await importDocumentFromUrl({
            imageUrl: url,
            usageType: "document",
            title: growflowMediaTitleForItem(item, "coa"),
            altText: growflowMediaTitleForItem(item, "coa"),
            uploadedBy,
            tags,
          });

    await linkGrowflowItemMedia(
      item.id,
      kind === "image" ? { mediaAssetId: asset.id } : { coaMediaAssetId: asset.id },
    );
    await recordUsage(asset.id, "growflow_menu_item", item.id, kind);

    return { ok: true, kind, assetId: asset.id, deduped, error: null };
  } catch (err) {
    if (err instanceof HarvestImageError) {
      return { ok: false, kind, assetId: null, deduped: false, error: err.message };
    }
    return {
      ok: false,
      kind,
      assetId: null,
      deduped: false,
      error: err instanceof Error ? err.message : "Unexpected error saving media.",
    };
  }
}
