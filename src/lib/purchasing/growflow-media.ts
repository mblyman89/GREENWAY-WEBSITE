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
import { kbIdentityForItem } from "@/lib/purchasing/growflow-kb-link-core";
import { writeBackProductFacts } from "@/lib/ai/kb/writeback";

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

    // GF-7: bind a saved IMAGE (and the vendor's description) to the DURABLE
    // product backbone (kb_products), keyed by the product's natural identity
    // — so every time this product comes in, this image is picked FIRST and its
    // description fills in. Best-effort + gap-fill: writeBackProductFacts only
    // sets primary_media_id / description when the KB row hasn't already got one
    // (a human's manual choice always wins), and never auto-publishes (drafts
    // only). A failure here must not fail the media save, so it's swallowed.
    if (kind === "image") {
      try {
        const identity = kbIdentityForItem(item);
        // Pass the RAW name/brand + our normalized variant: writeBackProductFacts
        // re-slugifies brandName/productName with the SAME rule kbIdentityForItem
        // uses, so both agree on (brand_slug, product_slug, variant_label). The
        // fallback sentinels ("unknown-brand"/"product") also match, so a nameless
        // row still upserts onto the identity our recordUsage key points at.
        await writeBackProductFacts(
          {
            posProductKey: identity.posProductKey,
            // Raw name so writeback's slugifyDashed(...) || "product" reproduces
            // our productSlug exactly (including the empty-name -> "product" case).
            productName: item.name ?? "",
            brandName: item.brand ?? null,
            category: item.category ?? null,
            variantLabel: identity.variantLabel,
            description: item.description ?? null,
            imageMediaIds: [asset.id],
            primaryMediaId: asset.id,
            source: `crawl:${url}`,
            confidence: null,
          },
          uploadedBy,
        );
        await recordUsage(asset.id, "kb_product", identity.posProductKey, "primary_image");
      } catch {
        /* best-effort: KB association is non-fatal to the media save */
      }
    }

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
