/**
 * tests/compliance/d244-r22-erased-rank.test.ts - D244 round 9, slice R-22.
 *
 * Owner (verbatim): "give me the ability to publish the draft from removing
 * the text so it can be suggested on the copilot page. I need every product
 * image I remove text from to be the second highest suggested item behind
 * exact matches. ... Please also expand the list of suggestions on the
 * copilot page to be every image from that vendor."
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COPILOT_PANEL_LIMIT,
  EXACT_MATCH_MIN,
  RECOMMEND_PANEL_LIMIT,
  TEXT_REMOVED_CHIP,
  __runImageRecommendV3Tests,
  genericTierFits,
  orderRecommendPanel,
  recommendExtras,
} from "@/lib/enrichment/image-recommend-v3-core";
import { erasedPublishStep } from "@/lib/enrichment/text-erase-core";
import { copilotMorePhotos, copilotPhotoChoices } from "@/lib/enrichment/copilot-core";
import type { ImageRecommendation } from "@/lib/catalog/image-recommend-core";
import type { LibraryPickerAsset } from "@/lib/media/library-picker-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const A = (id: string, extra: Partial<LibraryPickerAsset> = {}): LibraryPickerAsset => ({
  id, filename: null, title: null, alt_text: null, tags: null, usage_type: "product", status: "published",
  mime_type: "image/jpeg", license_status: null, created_at: null, url: `u/${id}`, ...extra,
});
const R = (id: string, confidence: number, f: Partial<ImageRecommendation> = {}): ImageRecommendation => ({
  id, url: null, label: id, alt: id, confidence, band: confidence >= 80 ? "high" : confidence >= 55 ? "medium" : "low",
  reasons: [], chips: [], remembered: false, onRecord: false, attached: false, draft: false, rightsPending: false, ...f,
});
const TR = ["text-removed", "flux-fill"];

describe("D244 R-22 publish the text-removed draft", () => {
  it("a person's press publishes only a text-removed photo", () => {
    const s = erasedPublishStep({ tags: TR, source: "text-removed:o1", status: "draft" }, "u1", "2025-01-01T00:00:00Z");
    expect(s.kind).toBe("patch");
    expect(erasedPublishStep({ tags: ["vendor"], source: "upload", status: "draft" }, "u1", "t").kind).toBe("refuse");
    expect(erasedPublishStep({ tags: TR, source: null, status: "published" }, "u1", "t").kind).toBe("skip");
  });
  it("both result panels have the Publish button, wired to audited actions", () => {
    const q = read("src/components/admin/products/RemoveTextQueue.tsx");
    const e = read("src/app/admin/products/[key]/remove-text/RemoveTextEditor.tsx");
    expect(q).toContain('data-testid="queue-publish"');
    expect(q).toContain("disabled={s.publishing}");
    expect(e).toContain('data-testid="remove-text-publish"');
    expect(e).toContain("disabled={publishing}");
    for (const f of ["src/components/admin/products/remove-text-queue-actions.ts", "src/app/admin/products/[key]/remove-text/actions.ts"]) {
      const s = read(f);
      expect(s).toContain("publishErasedPhoto(m, session.userId)");
      expect(s).toContain('"product.remove_text_published"');
      expect(s).toContain('requirePermission("products.enrich")');
    }
    expect(read("src/lib/enrichment/text-erase-server.ts")).toContain("erasedPublishStep(");
  });
});

describe("D244 R-22 text-removed photos rank second, behind exact matches", () => {
  const prod = { vendorId: "v1", brandId: null };
  it("exact matches first, then published text-removed, then the rest", () => {
    const view = { items: [R("rest", 70), R("tr", 15), R("exact", EXACT_MATCH_MIN), R("mem", 40, { remembered: true })], considered: 4, matched: 4, emptyText: null };
    const p = orderRecommendPanel(view, [A("tr", { tags: TR, vendor_id: "v1" })], "x", 12, prod);
    expect(p.tiles.map((t) => t.id)).toEqual(["mem", "exact", "tr", "rest"]);
    expect(p.tiles[2]!.chips[0]).toBe(TEXT_REMOVED_CHIP);
    expect(p.tiles[2]!.confidence).toBe(15);
  });
  it("a draft waits for Publish; another vendor's never lifts", () => {
    expect(genericTierFits(A("d", { tags: TR, vendor_id: "v1", status: "draft" }), 90, prod)).toBe(false);
    expect(genericTierFits(A("o", { tags: TR, vendor_id: "v2" }), 90, prod)).toBe(false);
  });
  it("self-tests pass and are registered", () => {
    expect(__runImageRecommendV3Tests()).toEqual({ passed: 47, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("image-recommend-v3-core", __runImageRecommendV3Tests(), 47)');
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("copilot-core", __runCopilotCoreTests(), 57)');
  });
});

describe("D244 R-22 the Copilot lists every photo of the vendor", () => {
  it("extras: every vendor photo on the Copilot, only published text-removed elsewhere", () => {
    const pool = [A("a", { vendor_id: "v1" }), A("b", { tags: TR, vendor_id: "v1" }), A("c", { vendor_id: "v2" })];
    expect(recommendExtras(pool, { items: [] }, { vendorId: "v1" }, true).map((x) => x.id)).toEqual(["a", "b"]);
    expect(recommendExtras(pool, { items: [] }, { vendorId: "v1" }, false).map((x) => x.id)).toEqual(["b"]);
  });
  it("numbered 1-9 stay; every other photo is listed after them", () => {
    const tiles = Array.from({ length: 25 }, (_, i) => ({ id: `t${i}`, url: null, label: `T${i}`, confidence: 40, chips: [], attached: false }));
    expect(copilotPhotoChoices(tiles)).toHaveLength(9);
    expect(copilotMorePhotos(tiles)).toHaveLength(16);
    expect(COPILOT_PANEL_LIMIT).toBeGreaterThan(RECOMMEND_PANEL_LIMIT);
  });
  it("wiring: the Copilot asks for the whole vendor; the product page keeps 12", () => {
    const cs = read("src/lib/enrichment/copilot-server.ts");
    expect(cs.match(/loadRecommendPanel\(\{ item, enrichment, wholeVendor: true \}\)/g)).toHaveLength(2);
    const srv = read("src/lib/enrichment/image-recommend-v3-server.ts");
    expect(srv).toContain("recommendExtras(pool, view, ref, Boolean(input.wholeVendor))");
    expect(srv).toContain("input.wholeVendor ? COPILOT_PANEL_LIMIT : RECOMMEND_PANEL_LIMIT");
    expect(read("src/app/admin/products/[key]/page.tsx")).toContain("loadRecommendPanel({ item, enrichment: e })");
    const page = read("src/app/admin/products/copilot/page.tsx");
    expect(page).toContain('data-testid="copilot-more-photos"');
    expect(page).toContain("copilotMorePhotos(c.recommend.tiles)");
  });
  it("docs: SOP-10 v1.7, Concierge fact, strategy row", () => {
    const sop = read("docs/sop/SOP-10-product-enrichment.md");
    expect(sop).toMatch(/\| \*\*Version\*\* \| 1\.[7-9] \(D244 R-\d+/);
    expect(sop).toContain("### 4.17 Publish a text-removed photo");
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("(D244 R-22, owner:");
    expect(read("docs/sop-program/D244-enrichment-powerhouse-strategy.md")).toMatch(/\| R-22 \| #\d+ \| merged \|/);
  });
});
