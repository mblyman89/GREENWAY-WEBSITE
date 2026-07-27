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
 * SLICE 71 adds the EXPLICIT human edits the attach merge deliberately never
 * performs — each one is a deliberate click on the enrichment editor:
 *
 *   • detachImageFromGallery — remove an image from THIS product only (the
 *     media-library file is untouched); when the removed image was the cover,
 *     the next remaining image is promoted so a stocked gallery always has a
 *     cover, and an emptied gallery clears the cover to null,
 *   • setPrimaryImage — pick which gallery member is the cover (must already
 *     be in the gallery; order is preserved),
 *   • moveImageInGallery — swap an image with its left/right neighbour
 *     (edges are no-ops; the cover never changes on a move).
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

// ---------------------------------------------------------------------------
// SLICE 71 — explicit gallery edits (remove / set cover / reorder).
// Every function below is PURE: it returns the next state and a `changed`
// flag; the caller persists only when changed is true. The media-library
// asset itself is NEVER touched — these edit which images THIS product shows.
// ---------------------------------------------------------------------------

export type ProductImageEdit = {
  image_media_ids: string[];
  primary_media_id: string | null;
  /** true when the state differs from the input (a write is needed). */
  changed: boolean;
};

/** Normalise a stored gallery: strings only, trimmed, blanks dropped. */
function cleanGallery(state: ProductImageState): string[] {
  return Array.isArray(state.image_media_ids)
    ? state.image_media_ids.filter((v) => typeof v === "string" && v.trim().length > 0)
    : [];
}

/**
 * Remove an image from the product's gallery (the "unselect" the editor was
 * missing — the first image is no longer "forever stuck attached").
 *
 *  • unknown/blank id → no-op (changed=false, nothing persisted);
 *  • removing the COVER promotes the first remaining image so a non-empty
 *    gallery always has a cover;
 *  • removing the LAST image clears the cover to null (the live menu then
 *    falls back to the resolver ladder — category fallback / mockup card);
 *  • the relative order of the surviving images is preserved.
 */
export function detachImageFromGallery(
  state: ProductImageState,
  mediaId: string,
): ProductImageEdit {
  const id = (mediaId ?? "").trim();
  const existing = cleanGallery(state);
  const currentPrimary = state.primary_media_id ?? null;

  if (!id || !existing.includes(id)) {
    return { image_media_ids: existing, primary_media_id: currentPrimary, changed: false };
  }

  const image_media_ids = existing.filter((v) => v !== id);
  const primary_media_id =
    currentPrimary === id ? (image_media_ids[0] ?? null) : currentPrimary;

  return { image_media_ids, primary_media_id, changed: true };
}

/**
 * Choose which gallery image is the cover (primary). The id MUST already be
 * in the gallery — the cover can never point at an image the product does
 * not show. Gallery order is untouched.
 */
export function setPrimaryImage(
  state: ProductImageState,
  mediaId: string,
): ProductImageEdit {
  const id = (mediaId ?? "").trim();
  const existing = cleanGallery(state);
  const currentPrimary = state.primary_media_id ?? null;

  if (!id || !existing.includes(id) || currentPrimary === id) {
    return { image_media_ids: existing, primary_media_id: currentPrimary, changed: false };
  }

  return { image_media_ids: existing, primary_media_id: id, changed: true };
}

/**
 * Move an image one slot left ("up") or right ("down") in the curated order.
 * The gallery order drives the storefront gallery AND the `image_media_ids[0]`
 * fallback when no explicit cover is set, so order is meaningful.
 * Edge moves (first image left / last image right) and unknown ids are no-ops.
 * The cover NEVER changes on a move.
 */
export function moveImageInGallery(
  state: ProductImageState,
  mediaId: string,
  direction: "left" | "right",
): ProductImageEdit {
  const id = (mediaId ?? "").trim();
  const existing = cleanGallery(state);
  const currentPrimary = state.primary_media_id ?? null;

  const index = existing.indexOf(id);
  const target = direction === "left" ? index - 1 : index + 1;
  if (!id || index < 0 || target < 0 || target >= existing.length) {
    return { image_media_ids: existing, primary_media_id: currentPrimary, changed: false };
  }

  const image_media_ids = [...existing];
  [image_media_ids[index], image_media_ids[target]] = [image_media_ids[target], image_media_ids[index]];

  return { image_media_ids, primary_media_id: currentPrimary, changed: true };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (SLICE 71) — run by scripts/compliance/run-pure-selftests.ts
// and mirrored in tests/compliance/product-images.test.ts.
// ---------------------------------------------------------------------------

export function __runProductImageEditTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const expect = (name: string, ok: boolean) => {
    if (ok) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`  FAIL: ${name}`);
    }
  };

  const state = (ids: string[], primary: string | null): ProductImageState => ({
    image_media_ids: ids,
    primary_media_id: primary,
  });

  // detach: removing a non-cover image keeps the cover and the order.
  {
    const r = detachImageFromGallery(state(["a", "b", "c"], "a"), "b");
    expect("detach: non-cover removed", r.changed && r.image_media_ids.join(",") === "a,c");
    expect("detach: cover untouched", r.primary_media_id === "a");
  }

  // detach: removing the COVER promotes the first remaining image.
  {
    const r = detachImageFromGallery(state(["a", "b", "c"], "a"), "a");
    expect("detach cover: next image promoted", r.changed && r.primary_media_id === "b");
    expect("detach cover: survivors keep order", r.image_media_ids.join(",") === "b,c");
  }

  // detach: removing the LAST image clears the cover (owner's exact complaint —
  // the first image attached is no longer "forever stuck").
  {
    const r = detachImageFromGallery(state(["only"], "only"), "only");
    expect("detach last: gallery empties", r.changed && r.image_media_ids.length === 0);
    expect("detach last: cover cleared to null", r.primary_media_id === null);
  }

  // detach: unknown id is a no-op (no accidental writes).
  {
    const r = detachImageFromGallery(state(["a"], "a"), "ghost");
    expect("detach unknown: no-op", !r.changed && r.image_media_ids.join(",") === "a" && r.primary_media_id === "a");
  }

  // detach: blank id is a no-op.
  {
    const r = detachImageFromGallery(state(["a"], "a"), "   ");
    expect("detach blank: no-op", !r.changed);
  }

  // set-primary: picks a gallery member as cover, order preserved.
  {
    const r = setPrimaryImage(state(["a", "b", "c"], "a"), "c");
    expect("set-primary: cover moves to c", r.changed && r.primary_media_id === "c");
    expect("set-primary: order untouched", r.image_media_ids.join(",") === "a,b,c");
  }

  // set-primary: id NOT in the gallery is refused (no dangling cover).
  {
    const r = setPrimaryImage(state(["a", "b"], "a"), "ghost");
    expect("set-primary outsider: refused", !r.changed && r.primary_media_id === "a");
  }

  // set-primary: already the cover → no-op (double-click safe).
  {
    const r = setPrimaryImage(state(["a", "b"], "a"), "a");
    expect("set-primary same: no-op", !r.changed);
  }

  // move: swap with the right neighbour; cover never changes.
  {
    const r = moveImageInGallery(state(["a", "b", "c"], "a"), "a", "right");
    expect("move right: swapped", r.changed && r.image_media_ids.join(",") === "b,a,c");
    expect("move right: cover unchanged", r.primary_media_id === "a");
  }

  // move: swap with the left neighbour.
  {
    const r = moveImageInGallery(state(["a", "b", "c"], "a"), "c", "left");
    expect("move left: swapped", r.changed && r.image_media_ids.join(",") === "a,c,b");
  }

  // move: edges are no-ops (first can't go left, last can't go right).
  {
    const l = moveImageInGallery(state(["a", "b"], "a"), "a", "left");
    const rr = moveImageInGallery(state(["a", "b"], "a"), "b", "right");
    expect("move edge left: no-op", !l.changed && l.image_media_ids.join(",") === "a,b");
    expect("move edge right: no-op", !rr.changed && rr.image_media_ids.join(",") === "a,b");
  }

  // move: unknown id is a no-op.
  {
    const r = moveImageInGallery(state(["a", "b"], "a"), "ghost", "right");
    expect("move unknown: no-op", !r.changed);
  }

  // purity/immutability: inputs are never mutated by any edit.
  {
    const ids = ["a", "b", "c"];
    const s = state(ids, "a");
    detachImageFromGallery(s, "b");
    setPrimaryImage(s, "c");
    moveImageInGallery(s, "a", "right");
    expect("inputs never mutated", ids.join(",") === "a,b,c" && s.primary_media_id === "a");
  }

  // round-trip: detach the cover, re-attach it — it appends at the END and
  // does NOT steal the promoted cover (attach rule holds after an edit).
  {
    const afterDetach = detachImageFromGallery(state(["a", "b"], "a"), "a");
    const reattach = attachImageToGallery(
      { image_media_ids: afterDetach.image_media_ids, primary_media_id: afterDetach.primary_media_id },
      "a",
    );
    expect("round-trip: re-attach appends at end", reattach.image_media_ids.join(",") === "b,a");
    expect("round-trip: promoted cover kept", reattach.primary_media_id === "b");
  }

  console.log(`product-image-edit self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
