/**
 * tests/compliance/d244-r9-remove-text.test.ts - D244 round 3, slice R-9.
 *
 * Owner (verbatim): "I need a way to remove text on a product picture. I want
 * to drag a box over the text, then click a button to remove it. Maybe on the
 * product image card in the main enrichment table, that has the attach and
 * attach as cover buttons, add a remove text button. If there is the perfect
 * image for a product, but it has a different name on it, I want the ai to
 * help recommend the name to be removed from the image. Can we use flux for
 * this or is one of the other ai models we use."
 *
 * Proven: boxes → mask (pure), the keep/remove advice, the other-name hint,
 * and the wiring (FLUX Fill removes, vision reads, nothing attaches on its
 * own, the original is never changed, buttons on the tile and the gallery).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

import {
  __runTextEraseCoreTests,
  ERASE_MODEL,
  checkEraseBoxes,
  eraseMaskSvg,
  parseTextFind,
  adviseText,
  otherNameOnPhoto,
  removeTextUrl,
  erasedStatus,
  type EraseProduct,
} from "@/lib/enrichment/text-erase-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const P: EraseProduct = { name: "Phat Panda Blue Dream 3.5g", brand: "Phat Panda", strainName: "Blue Dream", vendor: "Hollingsworth", category: "Flower" };

describe("D244 R-9 remove text — pure core", () => {
  it("all 90 self-tests (R-9 + R-11 + R-17 + R-20 + R-21 + R-22) pass and are registered", () => {
    expect(__runTextEraseCoreTests()).toEqual({ passed: 90, failed: 0 }); // R-11 added 9 queue checks, R-17 added 10, R-20 added 21, R-21 added 3, R-22 added 2
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("text-erase-core", __runTextEraseCoreTests(), 90)');
  });

  it("FLUX Erase is the remover (D244 R-17); the mask is white only inside the boxes", () => {
    expect(ERASE_MODEL).toBe("flux-tools/erase-v1");
    const c = checkEraseBoxes([{ x: 0.2, y: 0.2, w: 0.2, h: 0.1 }]);
    expect(c.ok).toBe(true);
    const svg = eraseMaskSvg(200, 100, c.ok ? c.boxes : []);
    expect(svg).toContain('<rect width="200" height="100" fill="#000"/>');
    expect(svg.match(/fill="#fff"/g)?.length).toBe(1);
    expect(checkEraseBoxes([]).ok).toBe(false);
  });

  it("the AI advises removing a different product's name and keeps this one's", () => {
    const found = parseTextFind(
      JSON.stringify({ texts: [{ text: "GELATO", kind: "product-name", x: 0.1, y: 0.4, w: 0.5, h: 0.1 }, { text: "Blue Dream", kind: "product-name", x: 0.1, y: 0.6, w: 0.5, h: 0.1 }, { text: "WARNING: keep out of reach of children", kind: "warning", x: 0, y: 0.9, w: 1, h: 0.05 }] }),
      P,
    );
    expect(found?.map((f) => f.advice)).toEqual(["remove", "keep", "keep"]);
    expect(adviseText("1g", "size", P).advice).toBe("remove");
  });

  it("a library photo naming another product gets the hint", () => {
    expect(otherNameOnPhoto("PHAT PANDA GELATO", P)).toBe("Gelato");
    expect(otherNameOnPhoto("PHAT PANDA BLUE DREAM", P)).toBeNull();
    expect(removeTextUrl("abc", "m1")).toBe("/admin/products/abc/remove-text?media=m1");
  });

  it("the copy is published only when the original is published with clear rights", () => {
    expect(erasedStatus({ status: "published", license_status: null })).toBe("published");
    expect(erasedStatus({ status: "published", license_status: "pending-review" })).toBe("draft");
  });
});

describe("D244 R-9 remove text — wiring", () => {
  const server = read("src/lib/enrichment/text-erase-server.ts");
  const actions = read("src/app/admin/products/[key]/remove-text/actions.ts");
  const editor = read("src/app/admin/products/[key]/remove-text/RemoveTextEditor.tsx");
  const detail = read("src/app/admin/products/[key]/page.tsx");

  it("vision reads, FLUX Fill removes, the result is a NEW photo; nothing is attached by the AI", () => {
    expect(server).toContain("generateVisionJson");
    expect(server).toContain("submitFluxTask(ERASE_MODEL");
    expect(server).toContain("uploadMedia(");
    expect(server).toContain("erasedSource(original.id)");
    expect(server).not.toMatch(/updateEnrichment|attachImageToGallery|setPrimaryImage|setMediaStatus/);
    expect(actions).not.toMatch(/updateEnrichment|attachImageToGallery|setPrimaryImage/);
  });

  it("every action needs products.enrich and is audited", () => {
    expect(actions.match(/requirePermission\("products\.enrich"\)/g)?.length).toBe(4); // R-22 added Publish
    for (const a of ["product.remove_text_found", "product.remove_text_started", "product.remove_text_saved"]) expect(actions).toContain(a);
  });

  it("the editor drags boxes, asks the AI, polls FLUX and attaches only on a press", () => {
    expect(editor).toContain("onPointerDown");
    expect(editor).toContain("findTextAction");
    expect(editor).toContain("pollEraseAction");
    expect(editor).toContain("<form action={attachMatchedMedia}>");
    expect(editor).toContain('name="source" value="text-removed"');
    expect(editor).toMatch(/data-testid="remove-text-run"[\s\S]{0,200}disabled=/);
  });

  it("Remove text sits on the Recommended tile (beside Attach as cover) and the gallery", () => {
    const tile = detail.indexOf("Attach as cover</Button>");
    const open = detail.indexOf('data-testid="remove-text-open"');
    expect(tile).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(tile);
    expect(detail).toContain('data-testid="gallery-remove-text"');
    expect(detail).toContain("recommend.otherNames[t.id]");
    expect(read("src/lib/enrichment/image-recommend-v3-server.ts")).toContain("otherNameOnPhoto(");
  });

  it("Help explains it", () => {
    expect(read("src/lib/admin/help-content.ts")).toContain("Remove text button");
  });
});
