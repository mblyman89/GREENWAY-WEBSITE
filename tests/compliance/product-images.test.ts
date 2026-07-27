/**
 * tests/compliance/product-images.test.ts — Slice H9c.
 *
 * Pins the PURE gallery-merge rule in src/lib/ai/kb/product-images-core.ts.
 * Load-bearing invariants for attaching a harvested first-party product image
 * to a kb_products row:
 *
 *  • the FIRST image attached (no primary yet) becomes the cover;
 *  • a later image is appended but never steals the existing primary;
 *  • re-attaching an already-present id is a no-op (alreadyPresent), so a
 *    double-click or a re-harvest can never duplicate a gallery entry;
 *  • existing ids are never removed or reordered (curated order preserved);
 *  • a blank id is ignored (defensive).
 */
import { describe, it, expect } from "vitest";
import { attachImageToGallery } from "@/lib/ai/kb/product-images-core";

describe("attachImageToGallery — H9c", () => {
  it("first image becomes the cover (primary)", () => {
    const r = attachImageToGallery({ image_media_ids: [], primary_media_id: null }, "media-1");
    expect(r.image_media_ids).toEqual(["media-1"]);
    expect(r.primary_media_id).toBe("media-1");
    expect(r.becamePrimary).toBe(true);
    expect(r.alreadyPresent).toBe(false);
  });

  it("later image appends but does not steal the existing primary", () => {
    const r = attachImageToGallery(
      { image_media_ids: ["media-1"], primary_media_id: "media-1" },
      "media-2",
    );
    expect(r.image_media_ids).toEqual(["media-1", "media-2"]);
    expect(r.primary_media_id).toBe("media-1");
    expect(r.becamePrimary).toBe(false);
  });

  it("re-attaching an already-present id is a no-op", () => {
    const r = attachImageToGallery(
      { image_media_ids: ["media-1", "media-2"], primary_media_id: "media-1" },
      "media-2",
    );
    expect(r.alreadyPresent).toBe(true);
    expect(r.image_media_ids).toEqual(["media-1", "media-2"]);
    expect(r.primary_media_id).toBe("media-1");
    expect(r.becamePrimary).toBe(false);
  });

  it("existing ids are preserved in order; only the new id is appended", () => {
    const r = attachImageToGallery(
      { image_media_ids: ["a", "b", "c"], primary_media_id: "b" },
      "d",
    );
    expect(r.image_media_ids).toEqual(["a", "b", "c", "d"]);
    expect(r.primary_media_id).toBe("b");
  });

  it("attaching to a gallery with images but no primary sets the new one as cover", () => {
    // Defensive: a row could have images but a null primary (legacy data).
    const r = attachImageToGallery(
      { image_media_ids: ["a"], primary_media_id: null },
      "b",
    );
    expect(r.image_media_ids).toEqual(["a", "b"]);
    expect(r.primary_media_id).toBe("b");
    expect(r.becamePrimary).toBe(true);
  });

  it("blank id is ignored, gallery untouched", () => {
    const r = attachImageToGallery({ image_media_ids: ["a"], primary_media_id: "a" }, "  ");
    expect(r.image_media_ids).toEqual(["a"]);
    expect(r.primary_media_id).toBe("a");
    expect(r.becamePrimary).toBe(false);
  });

  it("filters out junk (empty) existing ids defensively", () => {
    const r = attachImageToGallery(
      { image_media_ids: ["a", "", "  "], primary_media_id: null },
      "z",
    );
    expect(r.image_media_ids).toEqual(["a", "z"]);
    expect(r.primary_media_id).toBe("z");
  });
});

// ---------------------------------------------------------------------------
// SLICE 71 — explicit gallery edits (remove / set cover / reorder). Mirrors
// __runProductImageEditTests in product-images-core.ts. These are the edits
// the owner asked for: "no way to unselect an image, first one you attach is
// forever stuck attached" — now it isn't.
// ---------------------------------------------------------------------------

import {
  detachImageFromGallery,
  setPrimaryImage,
  moveImageInGallery,
  __runProductImageEditTests,
} from "@/lib/ai/kb/product-images-core";

describe("gallery edits — SLICE 71", () => {
  it("embedded self-tests all pass", () => {
    const r = __runProductImageEditTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(20);
  });

  it("detach removes a non-cover image and keeps the cover", () => {
    const r = detachImageFromGallery({ image_media_ids: ["a", "b", "c"], primary_media_id: "a" }, "b");
    expect(r.changed).toBe(true);
    expect(r.image_media_ids).toEqual(["a", "c"]);
    expect(r.primary_media_id).toBe("a");
  });

  it("detaching the cover promotes the next remaining image", () => {
    const r = detachImageFromGallery({ image_media_ids: ["a", "b"], primary_media_id: "a" }, "a");
    expect(r.image_media_ids).toEqual(["b"]);
    expect(r.primary_media_id).toBe("b");
  });

  it("detaching the LAST image clears the cover to null (nothing stuck forever)", () => {
    const r = detachImageFromGallery({ image_media_ids: ["only"], primary_media_id: "only" }, "only");
    expect(r.image_media_ids).toEqual([]);
    expect(r.primary_media_id).toBeNull();
  });

  it("detach of an unknown id is a no-op (changed=false, no write)", () => {
    const r = detachImageFromGallery({ image_media_ids: ["a"], primary_media_id: "a" }, "ghost");
    expect(r.changed).toBe(false);
  });

  it("setPrimaryImage picks a gallery member as cover without reordering", () => {
    const r = setPrimaryImage({ image_media_ids: ["a", "b", "c"], primary_media_id: "a" }, "c");
    expect(r.changed).toBe(true);
    expect(r.primary_media_id).toBe("c");
    expect(r.image_media_ids).toEqual(["a", "b", "c"]);
  });

  it("setPrimaryImage refuses an id that is not in the gallery", () => {
    const r = setPrimaryImage({ image_media_ids: ["a"], primary_media_id: "a" }, "ghost");
    expect(r.changed).toBe(false);
    expect(r.primary_media_id).toBe("a");
  });

  it("move swaps neighbours; edges are no-ops; cover never changes", () => {
    const right = moveImageInGallery({ image_media_ids: ["a", "b", "c"], primary_media_id: "a" }, "a", "right");
    expect(right.image_media_ids).toEqual(["b", "a", "c"]);
    expect(right.primary_media_id).toBe("a");
    const edge = moveImageInGallery({ image_media_ids: ["a", "b"], primary_media_id: "a" }, "a", "left");
    expect(edge.changed).toBe(false);
  });

  it("inputs are never mutated by any edit", () => {
    const ids = ["a", "b", "c"];
    const s = { image_media_ids: ids, primary_media_id: "a" as string | null };
    detachImageFromGallery(s, "b");
    setPrimaryImage(s, "c");
    moveImageInGallery(s, "a", "right");
    expect(ids).toEqual(["a", "b", "c"]);
    expect(s.primary_media_id).toBe("a");
  });
});
