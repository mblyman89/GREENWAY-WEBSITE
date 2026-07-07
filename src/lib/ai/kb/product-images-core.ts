/**
 * src/lib/ai/kb/product-images-core.ts — Slice H9c, PURE core.
 *
 * The crawler harvests product images from a vendor's OWN first-party pages
 * (research_images). A human then attaches one to a specific kb_products row.
 * kb_products stores a gallery as `image_media_ids uuid[]` with a
 * `primary_media_id`. This module holds the (pure, tsx-testable) rule for
 * merging a newly-imported media asset into that gallery:
 *
 *   • append the asset id if not already present (dedupe by id),
 *   • set it as the primary when the product has no primary yet (the first
 *     attached image becomes the cover), otherwise leave the primary alone,
 *   • never remove or reorder existing ids (curated order is preserved).
 *
 * No imports from server-only modules — the compliance suite pins this rule.
 */

export type ProductImageState = {
  image_media_ids: string[];
  primary_media_id: string | null;
};

export type ProductImageMerge = {
  image_media_ids: string[];
  primary_media_id: string | null;
  /** true when the id was already in the gallery (no write needed). */
  alreadyPresent: boolean;
  /** true when this attach set the product's primary/cover image. */
  becamePrimary: boolean;
};

/**
 * Merge a newly-attached media asset id into a product's image gallery.
 * Pure: returns the new arrays; the caller persists them.
 */
export function attachImageToGallery(
  state: ProductImageState,
  mediaId: string,
): ProductImageMerge {
  const id = (mediaId ?? "").trim();
  const existing = Array.isArray(state.image_media_ids)
    ? state.image_media_ids.filter((v) => typeof v === "string" && v.trim().length > 0)
    : [];
  const currentPrimary = state.primary_media_id ?? null;

  if (!id) {
    return {
      image_media_ids: existing,
      primary_media_id: currentPrimary,
      alreadyPresent: false,
      becamePrimary: false,
    };
  }

  const alreadyPresent = existing.includes(id);
  const image_media_ids = alreadyPresent ? existing : [...existing, id];
  // First image attached (no primary yet) becomes the cover.
  const becamePrimary = !currentPrimary;
  const primary_media_id = currentPrimary ?? id;

  return { image_media_ids, primary_media_id, alreadyPresent, becamePrimary };
}
