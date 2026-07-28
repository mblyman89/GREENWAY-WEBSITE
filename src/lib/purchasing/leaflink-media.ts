/**
 * src/lib/purchasing/leaflink-media.ts
 *
 * SLICE 84 — save LeafLink menu media (product images + COA documents) into
 * the media library, then link the created asset back onto the menu-item row.
 * Mirrors growflow-media.ts one-for-one:
 *
 *   • Images reuse the shipped harvest pipeline (importImageFromUrl):
 *     http(s)-only, 5 MB cap, image-MIME check, private-host refusal, sha256
 *     content dedupe, drafts-only with `source: crawl:<url>` provenance and
 *     license pending-review. LeafLink serves images from CloudFront
 *     (d34jggf3nqwbvj.cloudfront.net) — public https, same rails apply.
 *   • COAs go through importDocumentFromUrl (same rails, PDF MIME, 10 MB).
 *   • Every save records a media_usages row (entity leaflink_menu_item) and
 *     writes the asset id back via leaflink-store.linkLeaflinkItemMedia(), so
 *     both sides know about each other and re-saves are no-ops.
 *   • Saved images (and the vendor's description) are also bound to the
 *     DURABLE product backbone (kb_products) via writeBackProductFacts —
 *     gap-fill only, drafts only, best-effort.
 */
import "server-only";
import {
  importImageFromUrl,
  importDocumentFromUrl,
  HarvestImageError,
} from "@/lib/media/harvest";
import { recordUsage } from "@/lib/media/store";
import { linkLeaflinkItemMedia, type LeaflinkMenuItemRow } from "@/lib/purchasing/leaflink-store";
import type { MediaSaveKind } from "@/lib/purchasing/cultivera-media-core";
import {
  leaflinkMediaTags,
  leaflinkMediaTitleForItem,
  leaflinkMediaAltForItem,
} from "@/lib/purchasing/leaflink-media-core";
import { leaflinkKbIdentityForItem } from "@/lib/purchasing/leaflink-kb-link-core";
import { leaflinkCategoryDescription } from "@/lib/purchasing/leaflink-menu-core";
import { resolveMenuDescription } from "@/lib/purchasing/menu-description-core";
import { writeBackProductFacts } from "@/lib/ai/kb/writeback";

export type SaveLeaflinkItemMediaResult = {
  ok: boolean;
  kind: MediaSaveKind;
  assetId: string | null;
  deduped: boolean;
  /** SLICE 85 — true when the KB description saved was the category stand-in. */
  descriptionWasFallback: boolean;
  error: string | null;
};

/**
 * Save ONE LeafLink menu item's image or COA into the library, link it back
 * to the item, and record a media_usages row. Never throws for expected
 * failures — returns {ok:false, error} so bulk runs keep going.
 */
export async function saveLeaflinkItemMedia(
  item: LeaflinkMenuItemRow,
  kind: MediaSaveKind,
  vendorLabel: string,
  uploadedBy: string | null,
): Promise<SaveLeaflinkItemMediaResult> {
  const url = kind === "image" ? item.image_url : item.coa_url;
  if (!url) {
    return { ok: false, kind, assetId: null, deduped: false, descriptionWasFallback: false, error: "No URL on this item." };
  }
  const alreadyLinked = kind === "image" ? item.media_asset_id : item.coa_media_asset_id;
  if (alreadyLinked) {
    return { ok: true, kind, assetId: alreadyLinked, deduped: true, descriptionWasFallback: false, error: null };
  }

  try {
    const tags = leaflinkMediaTags(vendorLabel, kind);
    const { asset, deduped } =
      kind === "image"
        ? await importImageFromUrl({
            imageUrl: url,
            usageType: "product",
            title: leaflinkMediaTitleForItem(item, "image"),
            altText: leaflinkMediaAltForItem(item, vendorLabel),
            uploadedBy,
            tags,
          })
        : await importDocumentFromUrl({
            imageUrl: url,
            usageType: "document",
            title: leaflinkMediaTitleForItem(item, "coa"),
            altText: leaflinkMediaTitleForItem(item, "coa"),
            uploadedBy,
            tags,
          });

    await linkLeaflinkItemMedia(
      item.id,
      kind === "image" ? { mediaAssetId: asset.id } : { coaMediaAssetId: asset.id },
    );
    await recordUsage(asset.id, "leaflink_menu_item", item.id, kind);

    // Bind a saved IMAGE (and the vendor's description) to the DURABLE
    // product backbone (kb_products), keyed by the product's natural identity
    // — so every time this product comes in, this image is picked FIRST and
    // its description fills in. Best-effort + gap-fill: writeBackProductFacts
    // only sets primary_media_id / description when the KB row hasn't already
    // got one (a human's manual choice always wins), and never auto-publishes
    // (drafts only). A failure here must not fail the media save.
    let descriptionWasFallback = false;
    if (kind === "image") {
      try {
        const identity = leaflinkKbIdentityForItem(item);
        // SLICE 85 — the product's OWN description first; when it has none,
        // the pinned category description (rides in raw.category.description)
        // stands in and is FLAGGED, mirroring the image-fallback pattern.
        const resolvedDescription = resolveMenuDescription(
          item.description ?? null,
          leaflinkCategoryDescription(item.raw),
        );
        descriptionWasFallback = resolvedDescription.isFallback;
        await writeBackProductFacts(
          {
            posProductKey: identity.posProductKey,
            // Raw name so writeback's slugifyDashed(...) || "product" reproduces
            // our productSlug exactly (including the empty-name -> "product" case).
            productName: item.name ?? "",
            brandName: item.brand ?? null,
            category: item.category ?? null,
            variantLabel: identity.variantLabel,
            description: resolvedDescription.text,
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

    return { ok: true, kind, assetId: asset.id, deduped, descriptionWasFallback, error: null };
  } catch (err) {
    if (err instanceof HarvestImageError) {
      return { ok: false, kind, assetId: null, deduped: false, descriptionWasFallback: false, error: err.message };
    }
    return {
      ok: false,
      kind,
      assetId: null,
      deduped: false,
      descriptionWasFallback: false,
      error: err instanceof Error ? err.message : "Unexpected error saving media.",
    };
  }
}
