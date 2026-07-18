/**
 * src/lib/purchasing/cultivera-media.ts
 *
 * CV-5 — save Cultivera menu media (product images + COA documents) into the
 * media library, then link the created asset back onto the menu-item row.
 *
 *   • Images reuse the shipped harvest pipeline (importImageFromUrl):
 *     http(s)-only, 5 MB cap, image-MIME check, private-host refusal, sha256
 *     content dedupe, drafts-only with `source: crawl:<url>` provenance and
 *     license pending-review.
 *   • COAs are PDFs, saved through importDocumentFromUrl (same rails, PDF MIME,
 *     10 MB = the library's manual-upload ceiling), usage_type "document".
 *   • Every save records a media_usages row (entity cultivera_menu_item) and
 *     writes the asset id back via cultivera-store.linkItemMedia(), so both
 *     sides know about each other and re-saves are no-ops.
 */
import "server-only";
import {
  importImageFromUrl,
  importDocumentFromUrl,
  HarvestImageError,
} from "@/lib/media/harvest";
import { recordUsage } from "@/lib/media/store";
import { linkItemMedia, type CultiveraMenuItemRow } from "@/lib/purchasing/cultivera-store";
import {
  cultiveraMediaTags,
  mediaTitleForItem,
  mediaAltForItem,
  type MediaSaveKind,
} from "@/lib/purchasing/cultivera-media-core";

export type SaveItemMediaResult = {
  ok: boolean;
  kind: MediaSaveKind;
  assetId: string | null;
  deduped: boolean;
  error: string | null;
};

/**
 * Save ONE menu item's image or COA into the library, link it back to the
 * item, and record a media_usages row. Never throws for expected failures —
 * returns {ok:false, error} so bulk runs keep going.
 */
export async function saveItemMedia(
  item: CultiveraMenuItemRow,
  kind: MediaSaveKind,
  vendorLabel: string,
  uploadedBy: string | null,
): Promise<SaveItemMediaResult> {
  const url = kind === "image" ? item.image_url : item.coa_url;
  if (!url) {
    return { ok: false, kind, assetId: null, deduped: false, error: "No URL on this item." };
  }
  const alreadyLinked = kind === "image" ? item.media_asset_id : item.coa_media_asset_id;
  if (alreadyLinked) {
    return { ok: true, kind, assetId: alreadyLinked, deduped: true, error: null };
  }

  try {
    const tags = cultiveraMediaTags(vendorLabel, kind);
    const { asset, deduped } =
      kind === "image"
        ? await importImageFromUrl({
            imageUrl: url,
            usageType: "product",
            title: mediaTitleForItem(item, "image"),
            altText: mediaAltForItem(item, vendorLabel),
            uploadedBy,
            tags,
          })
        : await importDocumentFromUrl({
            imageUrl: url,
            usageType: "document",
            title: mediaTitleForItem(item, "coa"),
            altText: mediaTitleForItem(item, "coa"),
            uploadedBy,
            tags,
          });

    await linkItemMedia(
      item.id,
      kind === "image" ? { mediaAssetId: asset.id } : { coaMediaAssetId: asset.id },
    );
    await recordUsage(asset.id, "cultivera_menu_item", item.id, kind);

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
