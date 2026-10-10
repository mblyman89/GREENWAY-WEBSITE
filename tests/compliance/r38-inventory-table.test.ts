/**
 * R38 — the inventory table: every column connected, enterprise columns,
 * page sizes + numbered pager top and bottom, and an intelligent export.
 *
 * S1 (this block). Owner: "The inventory table has a blank for the website
 * category column for some reason. I want you to make sure all columns are
 * properly connected."
 *
 *   A. lot-website-category-core at its floor + precedence cases.
 *   B. loadMenuCategoriesForKeys is PAGED per chunk (a 300-key chunk that
 *      matches > 1,000 rows used to lose the tail silently).
 *   C. attachLotWebsiteCategories end-to-end over the real postgrest-js client
 *      against FakePostgrest: override > live menu > pick > type map >
 *      heuristic > unmapped, and a failure is reported, not hidden.
 *   D. the facet and the sort read the EFFECTIVE value.
 *   E. page pins: the cell, the source chip, the incomplete notice.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type FakeRequest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  published: { id: "v1" } as { id: string } | null,
  types: [] as Array<{ key: string; website_category: string | null }>,
  typesThrow: false,
  customCats: [] as Array<{ value: string; label: string }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
  supabaseUrl: "https://x.supabase.co",
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () =>
      new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});
vi.mock("@/lib/pos/menu-version", () => ({ getPublishedVersion: async () => st.published }));
vi.mock("@/lib/pos/types-store", () => ({
  listInventoryTypes: async () => {
    if (st.typesThrow) throw new Error("types down");
    return st.types;
  },
  listWebsiteCategoryTypes: async () => st.customCats,
}));

const core = await import("@/lib/inventory/lot-website-category-core");
const resolverServer = await import("@/lib/inventory/website-category-resolver-server");
const catServer = await import("@/lib/inventory/lot-website-category-server");
const filterCore = await import("@/lib/inventory/inventory-filter-core");
const sortCore = await import("@/lib/inventory/inventory-sort-core");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/** PostgREST's db-max-rows: silently clamp every read to 1,000 rows. */
function clampAt1000(req: FakeRequest) {
  if (req.method !== "GET") return;
  const lim = req.url.searchParams.get("limit");
  if (lim === null || Number(lim) > 1000) req.url.searchParams.set("limit", "1000");
}

beforeEach(() => {
  st.db = new FakePostgrest();
  st.db.before = clampAt1000;
  st.published = { id: "v1" };
  st.types = [];
  st.typesThrow = false;
  st.customCats = [];
});

// ─── A. pure core ───────────────────────────────────────────────────────────
describe("R38 S1 A - effective website category core", () => {
  it("self-tests pass at their floor", () => {
    const r = core.__runLotWebsiteCategoryTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(21);
  });

  it("precedence: override > menu > pick > type map > heuristic > unmapped", () => {
    const L = (v: string) => v.toUpperCase();
    const res = (source: "override" | "menu_item" | "inventory_type" | "heuristic" | "unmapped", v: string | null) => ({
      websiteCategory: v,
      label: v ? L(v) : "raw",
      raw: "raw",
      source,
      unmapped: v === null,
    });
    expect(core.effectiveLotWebsiteCategory(res("override", "a"), "p", L).value).toBe("a");
    expect(core.effectiveLotWebsiteCategory(res("menu_item", "b"), "p", L).value).toBe("b");
    expect(core.effectiveLotWebsiteCategory(res("inventory_type", "c"), "p", L).value).toBe("p");
    expect(core.effectiveLotWebsiteCategory(res("heuristic", "d"), "p", L).value).toBe("p");
    expect(core.effectiveLotWebsiteCategory(res("inventory_type", "c"), null, L)).toMatchObject({ value: "c", source: "inventory_type" });
    expect(core.effectiveLotWebsiteCategory(res("heuristic", "d"), null, L)).toMatchObject({ value: "d", source: "heuristic" });
    expect(core.effectiveLotWebsiteCategory(res("unmapped", null), null, L)).toMatchObject({ value: null, label: null, unmapped: true });
  });
});

// ─── B. paged menu read ─────────────────────────────────────────────────────
describe("R38 S1 B - loadMenuCategoriesForKeys never truncates", () => {
  it("reads every key even when a 300-key chunk matches more than 1,000 rows", async () => {
    const rows = st.db.rows("menu_items");
    const keys: string[] = [];
    for (let k = 0; k < 300; k++) {
      const key = `K${String(k).padStart(4, "0")}`;
      keys.push(key);
      // 4 rows per key (e.g. re-imported cards) → 1,200 rows in ONE chunk.
      for (let d = 0; d < 4; d++) {
        rows.push({ id: `${key}-${d}`, menu_version_id: "v1", source_item_id: key, category: d === 0 ? "flower" : "vape" });
      }
    }
    // Another version's rows never leak in.
    rows.push({ id: "other", menu_version_id: "v0", source_item_id: "K0000", category: "edible" });
    const out = await resolverServer.loadMenuCategoriesForKeys(keys);
    expect(out.size).toBe(300);
    // The LAST key (only reachable past row 1,000) is present.
    expect(out.has("K0299")).toBe(true);
    // Deterministic: ordered by source_item_id then id → the "-0" row wins.
    expect(out.get("K0000")).toBe("flower");
    expect(out.get("K0299")).toBe("flower");
    const gets = st.db.log.filter((q) => q.table === "menu_items");
    expect(gets.length).toBeGreaterThanOrEqual(2);
  });

  it("no published version → empty map, no menu read", async () => {
    st.published = null;
    const out = await resolverServer.loadMenuCategoriesForKeys(["K1"]);
    expect(out.size).toBe(0);
    expect(st.db.log.filter((q) => q.table === "menu_items")).toHaveLength(0);
  });
});

// ─── C. end-to-end attach ───────────────────────────────────────────────────
describe("R38 S1 C - every lot gets the category the website uses", () => {
  const lot = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    pos_product_key: null as string | null,
    product_name: null as string | null,
    inventory_type: null as string | null,
    category: null as string | null,
    ...over,
  });

  it("resolves all six sources with the right labels and chips", async () => {
    st.db.rows("menu_items").push({ id: "m1", menu_version_id: "v1", source_item_id: "MENU", category: "edible-solid" });
    st.db.rows("menu_items").push({ id: "m2", menu_version_id: "v1", source_item_id: "OVR", category: "edible-solid" });
    st.db.rows("product_classification_overrides").push({ pos_product_key: "OVR", website_category: "preroll", house_type: null, note: null });
    st.types = [{ key: "BHO", website_category: "concentrate" }];
    const lots = [
      lot("ovr", { pos_product_key: "OVR", inventory_type: "BHO" }),
      lot("menu", { pos_product_key: "MENU", inventory_type: "BHO" }),
      lot("pick", { inventory_type: "BHO" }),
      lot("type", { inventory_type: "BHO" }),
      lot("name", { inventory_type: "Usable Marijuana", product_name: "Blue Dream Pre-Roll 1g" }),
      lot("none", { inventory_type: "Mystery Thing", product_name: "zzqx" }),
    ];
    const drafts = new Map([["pick", { id: "d", lot_id: "pick", status: "approved", chosen_website_category: "cartridge" }]]);
    const out = await catServer.attachLotWebsiteCategories(lots, drafts);
    expect(out.complete).toBe(true);
    const by = Object.fromEntries(out.lots.map((l) => [l.id, l]));
    expect([by.ovr.website_category_value, by.ovr.website_category_source]).toEqual(["preroll", "override"]);
    expect([by.menu.website_category_value, by.menu.website_category_source]).toEqual(["edible-solid", "menu_item"]);
    expect([by.pick.website_category_value, by.pick.website_category_source]).toEqual(["cartridge", "onboarding"]);
    expect([by.type.website_category_value, by.type.website_category_source]).toEqual(["concentrate", "inventory_type"]);
    expect(by.name.website_category_source).toBe("heuristic");
    expect(by.name.website_category_value).toBe("preroll");
    expect(by.pick.website_category).toBe("Cartridge");
    expect(by.menu.website_category).toBe("Edible (Solid)");
    expect([by.none.website_category, by.none.website_category_source]).toEqual([null, "unmapped"]);
    // Labels are human, not raw values.
    expect(by.type.website_category).not.toBe("concentrate");
    expect(by.type.website_category?.toLowerCase()).toContain("concentrate");
    expect(out.liveKeys.has("MENU")).toBe(true);
    // The blank-column bug: a never-onboarded, type-mapped lot is NOT blank.
    expect(by.type.website_category).toBeTruthy();
  });

  it("an owner-created category (Settings → Types) resolves with its own label", async () => {
    st.customCats = [{ value: "functional", label: "Functional Gummies" }];
    st.types = [{ key: "Wellness Chew", website_category: "functional" }];
    const out = await catServer.attachLotWebsiteCategories([lot("c", { inventory_type: "Wellness Chew" })], new Map());
    expect(out.lots[0]).toMatchObject({
      website_category_value: "functional",
      website_category: "Functional Gummies",
      website_category_source: "inventory_type",
    });
  });

  it("an empty lot list makes no reads", async () => {
    const out = await catServer.attachLotWebsiteCategories([], new Map());
    expect(out.lots).toEqual([]);
    expect(st.db.log).toHaveLength(0);
  });
});

// ─── D. facet + sort read the effective value ───────────────────────────────
describe("R38 S1 D - filter + sort use the effective category", () => {
  it("fShelf reads website_category (falls back to the onboarding pick) and fShelfSource exists", () => {
    const f = filterCore.INVENTORY_FACETS.find((x) => x.param === "fShelf")!;
    expect(f.label).toBe("Website category");
    expect(f.get({ website_category: "Vape", onboarding_shelf: "Flower" } as never)).toBe("Vape");
    expect(f.get({ website_category: null, onboarding_shelf: "Flower" } as never)).toBe("Flower");
    expect(f.get({} as never)).toBeNull();
    const s = filterCore.INVENTORY_FACETS.find((x) => x.param === "fShelfSource")!;
    expect(s.get({ website_category_source: "unmapped" } as never)).toBe("Unmapped");
    expect(s.get({ website_category_source: "menu_item" } as never)).toBe("Live menu");
    expect(s.get({} as never)).toBeNull();
    // Append-only URL contract: R32's pair stays in order, R38's comes after.
    const params = filterCore.INVENTORY_FACETS.map((x) => x.param);
    expect(params.indexOf("fShelfSource")).toBe(params.length - 1);
    expect(params.indexOf("fOnboarded")).toBe(params.indexOf("fShelf") + 1);
  });

  it("the shelf sort reads the effective value", () => {
    const def = sortCore.columnSortDef("shelf")!;
    expect(def.text!({ website_category: "Vape", onboarding_shelf: "Flower" } as never)).toBe("Vape");
    expect(def.text!({ onboarding_shelf: "Flower" } as never)).toBe("Flower");
  });
});

// ─── E. page pins ───────────────────────────────────────────────────────────
describe("R38 S1 E - the inventory page shows the connected category", () => {
  const inv = read("src/app/admin/inventory/page.tsx");
  it("joins the effective category onto every lot before filtering", () => {
    expect(inv).toContain("await attachLotWebsiteCategories(onboardedLots, onboardingIndex.byLot)");
    expect(inv).toContain("const joinedLots = categorized.lots;");
    expect(inv.indexOf("attachLotWebsiteCategories(onboardedLots")).toBeLessThan(inv.indexOf("buildInventoryPage({"));
  });
  it("the cell shows the value, Unmapped in orange, and the source chip", () => {
    expect(inv).toContain('data-testid="inventory-website-category"');
    expect(inv).toContain('data-testid="inventory-website-category-source"');
    expect(inv).toContain("{l.website_category_info.sourceText}");
    expect(inv).toContain("l.website_category_info.unmapped ?");
    expect(inv).not.toContain("{l.onboarding_shelf ?? ");
    expect(inv).toContain('data-testid="inventory-website-category-incomplete"');
    expect(inv).toContain("{!categorized.complete && (");
  });
});
