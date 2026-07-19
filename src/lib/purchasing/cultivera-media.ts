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
import {
  kbIdentityForItem,
  strainImagesToSave,
  type StrainVariantLike,
} from "@/lib/purchasing/cultivera-kb-link-core";
import { writeBackProductFacts } from "@/lib/ai/kb/writeback";

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

/* ------------------------------------------------------------------
 * CV-7 — save a product's IMAGE and bind it to the durable KB backbone.
 * ------------------------------------------------------------------ */

export type SaveItemToKbResult = {
  ok: boolean;
  assetId: string | null;
  deduped: boolean;
  /** True when the image was also bound to the durable kb_products backbone. */
  boundToKb: boolean;
  error: string | null;
};

/**
 * Save ONE product's card/product-line IMAGE into the media library (reusing
 * the exact CV-5 rails: harvest import, item-row link, media_usages), THEN bind
 * that image to the DURABLE product backbone (kb_products) at the STRAIN/PRODUCT
 * level so every size variant of this strain inherits it.
 *
 * This is the owner's "add to KB" on the detail page: one image per strain (the
 * product-card image), tagged "cultivera" + vendor, attached to the vendor and
 * the KB product's natural identity — NOT one image per size variant.
 *
 * The KB write is GF-7-style: gap-fill only (empty -> value, never clobber a
 * human's curated choice), drafts-only, best-effort (a KB failure never fails
 * the media save). Idempotent: a re-save reuses the deduped asset and the
 * writeback upserts onto the same natural identity.
 */
export async function saveCultiveraItemToKb(
  item: CultiveraMenuItemRow,
  vendorLabel: string,
  uploadedBy: string | null,
): Promise<SaveItemToKbResult> {
  const url = item.image_url;
  if (!url) {
    return { ok: false, assetId: null, deduped: false, boundToKb: false, error: "This product has no image to save." };
  }

  try {
    // 1) Reuse the CV-5 image rails: harvest import (dedupe/provenance/license),
    //    link the asset back onto the item row, record a media_usages row.
    const tags = cultiveraMediaTags(vendorLabel, "image");
    let assetId = item.media_asset_id;
    let deduped = false;

    if (assetId) {
      // Already linked to this item — reuse the existing asset for the KB bind.
      deduped = true;
    } else {
      const imported = await importImageFromUrl({
        imageUrl: url,
        usageType: "product",
        title: mediaTitleForItem(item, "image"),
        altText: mediaAltForItem(item, vendorLabel),
        uploadedBy,
        tags,
      });
      assetId = imported.asset.id;
      deduped = imported.deduped;
      await linkItemMedia(item.id, { mediaAssetId: assetId });
      await recordUsage(assetId, "cultivera_menu_item", item.id, "image");
    }

    // 2) CV-7: bind the saved image (and the vendor's description) to the
    //    DURABLE product backbone (kb_products), keyed on the STRAIN/PRODUCT
    //    natural identity (variant_label = "") — so every time this strain
    //    comes in, this image is picked FIRST and its description fills in.
    //    Gap-fill + drafts-only; a human's manual choice always wins.
    let boundToKb = false;
    try {
      const identity = kbIdentityForItem(item);
      await writeBackProductFacts(
        {
          posProductKey: identity.posProductKey,
          // Raw name so writeback's slugifyDashed(...) || "product" reproduces
          // our productSlug exactly (including the empty-name -> "product" case).
          productName: item.name ?? "",
          brandName: item.brand ?? null,
          category: item.category ?? null,
          // Strain-level: empty variant label, matching kbIdentityForItem.
          variantLabel: identity.variantLabel,
          description: item.description ?? null,
          imageMediaIds: [assetId],
          primaryMediaId: assetId,
          source: `crawl:${url}`,
          confidence: null,
        },
        uploadedBy,
      );
      await recordUsage(assetId, "kb_product", identity.posProductKey, "primary_image");
      boundToKb = true;
    } catch {
      /* best-effort: KB association is non-fatal to the media save */
    }

    return { ok: true, assetId, deduped, boundToKb, error: null };
  } catch (err) {
    if (err instanceof HarvestImageError) {
      return { ok: false, assetId: null, deduped: false, boundToKb: false, error: err.message };
    }
    return {
      ok: false,
      assetId: null,
      deduped: false,
      boundToKb: false,
      error: err instanceof Error ? err.message : "Unexpected error saving to the KB.",
    };
  }
}

/* ------------------------------------------------------------------
 * CV-7b — save ONE image per DISTINCT strain on a product-detail page.
 * ------------------------------------------------------------------ */

export type SaveDetailStrainsResult = {
  ok: boolean;
  /** Distinct strains the detail contained (that had a saveable image). */
  strains: number;
  /** Newly imported images this run. */
  saved: number;
  /** Strains whose image was already in the library (dedupe). */
  deduped: number;
  /** Strains successfully bound to the KB backbone. */
  boundToKb: number;
  /** Strains that used the product-card image as a flagged fallback. */
  fallbacks: number;
  /** Strains that failed to save. */
  failed: number;
  error: string | null;
};

/**
 * Save one image per DISTINCT strain found on a Cultivera product-detail page.
 *
 * The owner's rule: "one image for each strain/product, not each size variant."
 * A single detail page (e.g. SUBX "Flower") contains many strains as variants;
 * this collapses the sizes of each strain to ONE image (that strain's own photo
 * when any size has one, else the product-card image, flagged), saves it to the
 * media library (drafts, "cultivera" + vendor tags), and binds it to the
 * durable kb_products backbone at the strain level so every size inherits it.
 *
 * Idempotent (content-hash dedupe + gap-fill KB write) and best-effort per
 * strain — one bad image never aborts the rest. Returns per-strain counts so
 * the UI can report "saved N strain images".
 */
export async function saveCultiveraDetailStrainsToKb(
  variants: StrainVariantLike[],
  line: { brand: string | null; lineImageUrl: string | null; category: string | null },
  vendorLabel: string,
  uploadedBy: string | null,
): Promise<SaveDetailStrainsResult> {
  const plan = strainImagesToSave(variants, { brand: line.brand, lineImageUrl: line.lineImageUrl });
  const result: SaveDetailStrainsResult = {
    ok: true,
    strains: plan.length,
    saved: 0,
    deduped: 0,
    boundToKb: 0,
    fallbacks: 0,
    failed: 0,
    error: null,
  };
  if (plan.length === 0) {
    result.error = "This product's sizes have no strain images to save.";
    return result;
  }

  const tags = cultiveraMediaTags(vendorLabel, "image");

  for (const strain of plan) {
    if (strain.imageIsFallback) result.fallbacks += 1;
    try {
      const { asset, deduped } = await importImageFromUrl({
        imageUrl: strain.imageUrl,
        usageType: "product",
        title: mediaTitleForItem({ name: strain.strainName, brand: line.brand }, "image"),
        altText: mediaAltForItem({ name: strain.strainName, brand: line.brand }, vendorLabel),
        uploadedBy,
        tags,
      });
      if (deduped) result.deduped += 1;
      else result.saved += 1;
      await recordUsage(asset.id, "cultivera_strain", strain.identity.posProductKey, "image");

      // Bind to the durable KB backbone at the strain level (gap-fill).
      try {
        await writeBackProductFacts(
          {
            posProductKey: strain.identity.posProductKey,
            productName: strain.strainName,
            brandName: line.brand,
            category: line.category,
            variantLabel: strain.identity.variantLabel,
            imageMediaIds: [asset.id],
            primaryMediaId: asset.id,
            source: `crawl:${strain.imageUrl}`,
            confidence: null,
          },
          uploadedBy,
        );
        await recordUsage(asset.id, "kb_product", strain.identity.posProductKey, "primary_image");
        result.boundToKb += 1;
      } catch {
        /* best-effort: KB association is non-fatal to the media save */
      }
    } catch (err) {
      result.failed += 1;
      if (!result.error) {
        result.error = err instanceof HarvestImageError ? err.message : "Some strain images could not be saved.";
      }
    }
  }

  result.ok = result.failed === 0;
  return result;
}
