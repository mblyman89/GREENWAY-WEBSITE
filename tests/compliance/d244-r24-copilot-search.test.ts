/**
 * tests/compliance/d244-r24-copilot-search.test.ts - D244 round 11, slice R-24.
 *
 * Owner (verbatim): "sometimes, the recommendations miss the vendors other
 * brands. so, in addition to the main section of recommendations and the
 * every other image from this vendor, I need a search bar that is very smart,
 * lets me enter any text and the system does its best to show me something
 * based on that text. these images need to be included in the text removal
 * feature."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LibraryPickerAsset } from "@/lib/media/library-picker-core";

vi.mock("server-only", () => ({}));

const st = vi.hoisted(() => ({
  vendors: [] as { id: string; display_name: string }[],
  brands: [] as { id: string; display_name: string; vendor_id: string | null }[],
  whole: [] as unknown[],
  wholeChips: new Map<string, string[]>(),
  plans: new Map<string, unknown[]>(),
  vendorShelf: new Map<string, unknown[]>(),
  brandShelf: new Map<string, unknown[]>(),
  calls: [] as string[],
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (t: string) => ({
      select: () => ({ range: async () => ({ data: t === "vendors" ? st.vendors : st.brands, error: null }) }),
    }),
  }),
}));
vi.mock("@/lib/media/library-picker-server", () => ({
  readImageSearch: async (req: { query?: string; scope: string; vendorId?: string; brandId?: string }) => {
    st.calls.push(`${req.scope}:${req.query ?? req.vendorId ?? req.brandId}`);
    if (req.query) return { ok: true, assets: st.whole, chips: st.wholeChips, note: null };
    if (req.scope === "vendor") return { ok: true, assets: st.vendorShelf.get(req.vendorId ?? "") ?? [], chips: new Map(), note: null };
    return { ok: true, assets: st.brandShelf.get(req.brandId ?? "") ?? [], chips: new Map(), note: null };
  },
  readSearchHitAssets: async (q: string) => {
    st.calls.push(`plan:${q}`);
    return st.plans.get(q) ?? [];
  },
}));

import {
  COPILOT_SEARCH_LIMIT,
  __runCopilotSearchTests,
  cleanCopilotQuery,
  copilotSearchPlans,
  matchNamed,
  rankCopilotSearch,
} from "@/lib/enrichment/copilot-search-core";
import { searchCopilotPhotos } from "@/lib/enrichment/copilot-search-server";
import { __runCopilotCoreTests, copilotUrl } from "@/lib/enrichment/copilot-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const A = (id: string, extra: Partial<LibraryPickerAsset> = {}): LibraryPickerAsset => ({
  id, filename: null, title: null, alt_text: null, tags: [], usage_type: "product", status: "published",
  mime_type: "image/jpeg", license_status: null, created_at: null, url: `u/${id}`, ...extra,
});

describe("D244 R-24 the smart search (pure)", () => {
  it("self-tests pass and are registered", () => {
    expect(__runCopilotSearchTests().failed).toBe(0);
    expect(__runCopilotCoreTests().failed).toBe(0);
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertRan("copilot-search-core", __runCopilotSearchTests(), 28)');
    expect(runner).toContain('assertRan("copilot-core", __runCopilotCoreTests(), 59)');
  });
  it("any text: cleaned, each word, joined and split spellings", () => {
    expect(cleanCopilotQuery("  Phat\tPanda \u0000 ")).toBe("Phat Panda");
    expect(copilotSearchPlans("Phat Panda pre-roll")).toEqual(expect.arrayContaining(["phat", "panda", "pre", "roll", "pre roll", "preroll"]));
  });
  it("a typed vendor or brand is found, even joined or one letter off", () => {
    const list = [{ id: "v1", name: "Phat Panda" }, { id: "b1", name: "Sticky Frog" }];
    expect(matchNamed("phat panda cart", list)[0]).toMatchObject({ id: "v1", strength: 3 });
    expect(matchNamed("phatpanda", list)[0]?.id).toBe("v1");
    expect(matchNamed("stiky frog", list).map((m) => m.id)).toContain("b1");
  });
  it("the order: every word first, with why chips; card photos and archived left out", () => {
    const assets = new Map([
      ["a", A("a", { product_name: "Grandpa's Breath 1g" })],
      ["b", A("b", { product_name: "Grandpa's Breath 3.5g", vendor_id: "v1" })],
      ["c", A("c", { product_name: "Breath mint", status: "archived" })],
      ["d", A("d", { product_name: "Grandpas Breath", vendor_id: "v1" })],
    ]);
    const out = rankCopilotSearch({ query: "grandpas breath", assets, lists: [["a", "c", "b", "d"]], cardVendorId: "v1", excludeIds: new Set(["d"]) });
    expect(out.map((p) => p.id)).toEqual(["b", "a"]);
    expect(out[0]!.chips).toEqual(expect.arrayContaining(["All words", "This vendor"]));
    expect(out[0]!.score).toBe(100);
    expect(COPILOT_SEARCH_LIMIT).toBe(60);
  });
  it("the search text stays on the same card", () => {
    expect(copilotUrl({ vendor: "v", key: "k", q: "phat panda" })).toBe("/admin/products/copilot?vendor=v&key=k&q=phat%20panda");
  });
});

describe("D244 R-24 the server search", () => {
  beforeEach(() => {
    st.calls.length = 0;
    st.vendors = [{ id: "v1", display_name: "Phat Panda" }];
    st.brands = [
      { id: "b1", display_name: "Phat Panda", vendor_id: "v1" },
      { id: "b2", display_name: "Grow Op Farms", vendor_id: "v1" },
      { id: "b3", display_name: "Somebody Else", vendor_id: null },
    ];
    st.whole = [A("w1", { product_name: "Phat Panda Blue Dream", vendor_id: "v1" })];
    st.wholeChips = new Map([["m1", ["Matches by meaning"]]]);
    st.plans = new Map();
    st.vendorShelf = new Map([["v1", [A("w1", { product_name: "Phat Panda Blue Dream", vendor_id: "v1" })]]]);
    st.brandShelf = new Map([["b2", [A("g1", { product_name: "Grow Op Farms Gelato", brand_id: "b2" })]]]);
  });
  it("a typed vendor brings its OTHER brands' photos (owner: the vendors other brands)", async () => {
    const r = await searchCopilotPhotos({ query: "phat panda", cardVendorId: "v1" });
    expect(r.note).toBeNull();
    const ids = r.photos.map((p) => p.id);
    expect(ids).toContain("w1");
    expect(ids).toContain("g1");
    expect(r.photos.find((p) => p.id === "g1")!.chips).toContain("Brand: Grow Op Farms");
    expect(st.calls).toEqual(expect.arrayContaining(["all:phat panda", "vendor:v1", "brand:b2", "plan:phat", "plan:panda", "plan:phatpanda"]));
    expect(st.calls).not.toContain("brand:b3");
    expect(r.summary).toContain("every photo of vendor Phat Panda");
  });
  it("each word is searched on its own, so one wrong word does not hide the rest", async () => {
    st.whole = [];
    st.vendorShelf = new Map();
    st.brandShelf = new Map();
    st.plans = new Map([["gelato", [A("x1", { product_name: "Gelato 41" })]]]);
    const r = await searchCopilotPhotos({ query: "gelato zqxv" });
    expect(r.photos.map((p) => p.id)).toEqual(["x1"]);
    expect(r.photos[0]!.chips[0]).toBe("1 of 2 words");
  });
  it("too short, empty and nothing-found all say so in plain words", async () => {
    expect((await searchCopilotPhotos({ query: "" })).photos).toEqual([]);
    expect((await searchCopilotPhotos({ query: "x" })).note).toBe("Type at least two letters.");
    st.whole = [];
    st.vendorShelf = new Map();
    st.brandShelf = new Map();
    expect((await searchCopilotPhotos({ query: "zzz nothing" })).summary).toMatch(/^Nothing in the library matches/);
  });
  it("photos already on the card are left out", async () => {
    const r = await searchCopilotPhotos({ query: "phat panda", excludeIds: ["w1"] });
    expect(r.photos.map((p) => p.id)).not.toContain("w1");
  });
});

describe("D244 R-24 the Copilot page", () => {
  const page = read("src/app/admin/products/copilot/page.tsx");
  it("has the search box after the recommendations and every other vendor photo", () => {
    const more = page.indexOf('data-testid="copilot-more-photos"');
    const search = page.indexOf('data-testid="copilot-photo-search"');
    const queue = page.indexOf("<RemoveTextQueue");
    expect(more).toBeGreaterThan(0);
    expect(search).toBeGreaterThan(more);
    expect(queue).toBeGreaterThan(search);
    expect(page).toContain('name="q"');
    expect(page).toContain("searchCopilotPhotos({ query: q, cardVendorId: s.vendorId, excludeIds: c.photos.map((x) => x.id) })");
  });
  it("results attach with a click through the same audited action", () => {
    const block = page.slice(page.indexOf('data-testid="copilot-photo-search-results"'));
    expect(block.slice(0, 600)).toContain("action={copilotAttachPhotoAction}");
  });
  it("results are in the Remove text list (owner: included in the text removal feature)", () => {
    expect(page).toContain("...searchPhotos.map((x) => ({ id: x.id, url: x.url, label: `Search: ${x.label}` }))");
    expect(page).toContain("...(q ? { q } : {})");
  });
  it("the actions keep the search on the same card only", () => {
    const actions = read("src/app/admin/products/copilot/actions.ts");
    expect(actions).toContain('q: cleanCopilotQuery(formData.get("q"))');
    expect(actions).toContain("const same = Boolean(c.q) && key === c.key;");
  });
  it("read-only: no migration, no writes in the search", () => {
    const srv = read("src/lib/enrichment/copilot-search-server.ts");
    expect(srv).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(srv).toContain('import "server-only";');
  });
});

describe("D244 R-24 docs", () => {
  it("SOP-10 v1.9 4.19, Concierge fact, strategy row", () => {
    const sop = read("docs/sop/SOP-10-product-enrichment.md");
    expect(sop).toMatch(/\| \*\*Version\*\* \| 1\.9 \(D244 R-24;.*1\.8 was D244 R-23/);
    expect(sop).toContain("### 4.19 Search for any photo on the Copilot (D244 R-24)");
    expect(sop).toMatch(/\| 1\.9 \| D244 R-24 \|/);
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Search for any photo on the Copilot (D244 R-24, owner:");
    expect(read("docs/sop-program/D244-enrichment-powerhouse-strategy.md")).toMatch(/\| R-24 \| (#\d+|R24_PR) \|/);
  });
});
