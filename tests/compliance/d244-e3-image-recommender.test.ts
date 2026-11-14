/**
 * D244 E-3 — image recommender v3 on the Enrichment detail page.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  __runImageRecommendV3Tests,
  RECOMMEND_PANEL_LIMIT,
  recommendSearchWords,
  orderRecommendPanel,
  parseCoverIntent,
} from "@/lib/enrichment/image-recommend-v3-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("D244 E-3 pure core", () => {
  it("self-test runs", () => {
    const r = __runImageRecommendV3Tests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(33);
  });
  it("12 tiles, per-word searches skip brand words", () => {
    expect(RECOMMEND_PANEL_LIMIT).toBe(12);
    expect(recommendSearchWords({ name: "Phat Panda Blue Dream 3.5g", brand: "Phat Panda" })).toEqual(["dream", "blue"]);
  });
  it("remembered beats a higher-scored stranger; attached goes last", () => {
    const base = { url: null, label: "", alt: "", band: "high" as const, reasons: [], chips: [], onRecord: false, draft: false, rightsPending: false };
    const p = orderRecommendPanel(
      {
        items: [
          { ...base, id: "a", confidence: 99, remembered: false, attached: true },
          { ...base, id: "b", confidence: 88, remembered: false, attached: false },
          { ...base, id: "c", confidence: 60, remembered: true, attached: false },
        ],
        considered: 3,
        matched: 3,
        emptyText: null,
      },
      [],
      "x",
    );
    expect(p.tiles.map((t) => t.id)).toEqual(["c", "b", "a"]);
  });
  it("cover intent is strict", () => {
    expect(parseCoverIntent("1")).toBe(true);
    expect(parseCoverIntent("0")).toBe(false);
  });
  it("registered in the selftest runner", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("image-recommend-v3-core", __runImageRecommendV3Tests(), 33)');
  });
});

describe("D244 E-3 wiring", () => {
  const server = read("src/lib/enrichment/image-recommend-v3-server.ts");
  const page = read("src/app/admin/products/[key]/page.tsx");
  const actions = read("src/app/admin/products/actions.ts");
  it("the loader uses memory, on-record, the vendor shelf and word searches over the whole library", () => {
    expect(server).toContain('import "server-only"');
    expect(server).toContain("loadImageMemory(keys)");
    expect(server).toContain("loadOnRecordImageIds(keys)");
    expect(server).toContain('readLibraryPickerAssets("all", { vendorIds: [vendorId], brandIds: [enrichment?.brand_id] })');
    expect(server).toContain("wordQs.map((w) => readSearchHitAssets(w, 40))");
    expect(server).toContain("resolveCardVendor(");
    expect(server).toContain("readLibraryAssetsByIds([...rememberedIds, ...onRecordIds])");
  });
  it("the page shows ONE recommended panel, outside every form, and says when reads failed", () => {
    expect(page).toContain('data-testid="recommended-photos"');
    expect(page).toContain("loadRecommendPanel({ item, enrichment: e })");
    expect(page).toContain("Recommendations could not be read just now.");
    expect(page).toContain("The media library could not be fully read, so this list may be short.");
    expect(page).not.toContain("From the media library</p>");
    const panel = page.indexOf('data-testid="recommended-photos"');
    const editor = page.indexOf("<form action={updateProductEnrichment}");
    expect(panel).toBeGreaterThan(0);
    expect(panel).toBeLessThan(editor);
    expect(page).toContain('<input type="hidden" name="cover" value="1" />');
  });
  it("attach remembers the pick and can set the cover", () => {
    const fn = actions.slice(actions.indexOf("export async function attachMatchedMedia"), actions.indexOf("export async function importVendorImage"));
    expect(fn).toContain('parseCoverIntent(formData.get("cover"))');
    expect(fn).toContain("setPrimaryImage(merge, mediaId)");
    expect(fn).toContain("rememberImageAttach({ identityKey, mediaId, posProductKey: key, source: \"library\", actorId: session.userId })");
    expect(fn).toContain('recordUsage(mediaId, "product", key, "image")');
  });
});
