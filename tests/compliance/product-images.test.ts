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
