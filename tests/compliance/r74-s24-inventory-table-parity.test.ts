/**
 * tests/compliance/r74-s24-inventory-table-parity.test.ts   (R74 S24, owner round 11)
 *
 * "On the inventory page, the table does not show all of the data in the
 *  columns even though it exists in the detail. I am referring to the price
 *  column. ... Please make sure all details from the product detail pages
 *  finds its way onto the inventory table."
 *
 * Proves: the table's price is the lot page's live menu variant price
 * (same resolveLotVariant rule; -onboarded first, single-variant card next,
 * several sizes = no guess), onboarding is the labelled fallback; margin,
 * pre-tax base, floor, sorts, totals and export all read that one price;
 * menu-row compliance flags win like on the lot page; THCA/CBDA is a column;
 * a failed price read shows a notice and the export refuses (503).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const st = vi.hoisted(() => ({
  pricesComplete: true as boolean | undefined,
  audits: 0,
}));

vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => ({ userId: "u1", email: "m@x", profile: { role: "owner" } }),
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async () => {
    st.audits += 1;
  },
}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
}));
vi.mock("@/lib/inventory/inventory-table-server", () => ({
  loadInventoryTableLots: async () => ({
    lots: [],
    leafly: { keys: new Set<string>(), title: "On Leafly" },
    onboardingComplete: true,
    categoriesComplete: true,
    pricesComplete: st.pricesComplete,
  }),
}));

const core = await import("@/lib/inventory/lot-live-price-core");
const { afterTaxFloorMinor, baseFromAfterTax } = await import("@/lib/inventory/price-correction-core");
const { lotMarginPct } = await import("@/lib/inventory/lot-onboarding-core");
const tableCore = await import("@/lib/inventory/inventory-table-core");
const sortCore = await import("@/lib/inventory/inventory-sort-core");
const metricsCore = await import("@/lib/inventory/inventory-metrics-core");
const { GET: exportGET } = await import("@/app/admin/inventory/export/route");

const read = (p: string) => readFileSync(p, "utf8");

describe("R74 S24 A — pure self-tests", () => {
  it("runs exactly 36 self-tests, all passing, pinned in the runner", () => {
    const r = core.__runLotLivePriceCoreTests();
    expect(r).toEqual({ passed: 36, failed: 0 });
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toMatch(/__runLotLivePriceCoreTests\(\);\s*if \(r\.failed > 0 \|\| r\.passed < 36\)/);
  });
  it("core is pure (no env, no DB)", () => {
    const src = read("src/lib/inventory/lot-live-price-core.ts");
    expect(src).not.toContain("process" + ".env");
    expect(src).not.toMatch(/supabase/);
  });
});

describe("R74 S24 B — the lot page's price rule", () => {
  const cards = [
    { id: "c1", source_item_id: "K1" },
    { id: "c2", source_item_id: "K2" },
    { id: "c3", source_item_id: "K3" },
    { id: "c4", source_item_id: "K4" },
  ];
  const variants = [
    { id: "v1", menu_item_id: "c1", source_variant_id: "K1-a", price_minor_units: 2500 },
    { id: "v2a", menu_item_id: "c2", source_variant_id: "K2-a", price_minor_units: 1000 },
    { id: "v2b", menu_item_id: "c2", source_variant_id: "K2-b", price_minor_units: 1800 },
    { id: "v3a", menu_item_id: "c3", source_variant_id: "K3-a", price_minor_units: 1000 },
    { id: "v3o", menu_item_id: "c3", source_variant_id: "K3-onboarded", price_minor_units: 3300 },
    { id: "v4", menu_item_id: "c4", source_variant_id: "K4-a", price_minor_units: 0 },
    { id: "v5o", menu_item_id: "cX", source_variant_id: "K5-onboarded", price_minor_units: 4400 },
  ];
  const idx = core.buildLivePriceIndex(["K1", "K2", "K3", "K4", "K5", "K6", " K1 ", null], cards, variants);

  it("single-variant card -> its price", () => {
    expect(idx.get("K1")).toEqual({ kind: "single-card", priceMinor: 2500 });
  });
  it("several sizes, no -onboarded -> ambiguous, never a guessed price", () => {
    expect(idx.get("K2")).toEqual({ kind: "ambiguous", variantCount: 2 });
  });
  it("-onboarded variant wins over the card's other variants (even on a sibling's card)", () => {
    expect(idx.get("K3")).toEqual({ kind: "onboarded", priceMinor: 3300 });
    expect(idx.get("K5")).toEqual({ kind: "onboarded", priceMinor: 4400 });
  });
  it("no usable price (0) and not on the menu -> absent", () => {
    expect(idx.has("K4")).toBe(false);
    expect(idx.has("K6")).toBe(false);
  });
  it("live menu beats onboarding; onboarding is the labelled fallback", () => {
    expect(core.effectiveShelfPrice(9999, { kind: "single-card", priceMinor: 2500 })).toEqual({ priceMinor: 2500, source: "menu", ambiguous: false });
    expect(core.effectiveShelfPrice(9999, { kind: "ambiguous", variantCount: 2 })).toEqual({ priceMinor: 9999, source: "onboarding", ambiguous: true });
    expect(core.effectiveShelfPrice(null, null)).toEqual({ priceMinor: null, source: null, ambiguous: false });
    expect(core.shelfPriceSourceLabel({ source: "menu", ambiguous: false })).toBe("live menu");
    expect(core.shelfPriceSourceLabel({ source: "onboarding", ambiguous: true })).toBe("onboarding (menu card has several sizes)");
    expect(core.shelfPriceSourceLabel({ source: null, ambiguous: true })).toBe("menu card has several sizes");
  });
  it("attaches margin, pre-tax and floor from the shown price (website category first)", () => {
    const [lot] = core.attachLotShelfPrice(
      [{ pos_product_key: "K1", onboarding_price_minor: null, unit_cost_minor_units: 800, category: "Flower", website_category_value: "merch" }],
      idx,
    );
    expect(lot.shelf_price_minor).toBe(2500);
    expect(lot.shelf_price_source).toBe("menu");
    expect(lot.shelf_margin_pct).toBe(lotMarginPct(2500, 800, "merch"));
    expect(lot.shelf_pre_tax_minor).toBe(baseFromAfterTax(2500, "merch"));
    expect(lot.shelf_floor_minor).toBe(afterTaxFloorMinor(800, "merch"));
    // the website category decides the tax (merch: sales tax only), not the raw POS category
    expect(lot.shelf_floor_minor).not.toBe(afterTaxFloorMinor(800, "Flower"));
  });
  it("menu-row compliance flags win; a null menu value keeps the lot's answer", () => {
    const flags = new Map([["K1", { otherwiseTaken: true, unitsPerPackage: null, lowThcLiquid: false, unitThcMg: 5 }]]);
    const [l] = core.attachMenuComplianceFlags(
      [{ pos_product_key: "K1", otherwise_taken: false, units_per_package: 10, low_thc_liquid: true, unit_thc_mg: 10 }],
      flags,
    );
    expect(l).toMatchObject({ otherwise_taken: true, units_per_package: 10, low_thc_liquid: false, unit_thc_mg: 5 });
  });
  it("THCA/CBDA: COA first, else the Cultivera figure", () => {
    expect(core.lotAcidFigures({ lab: { thca_pct: 22.5, cbda_pct: null }, pos_thca: 1, pos_cbda: 2 })).toEqual({ thca: 22.5, cbda: null, source: "coa" });
    expect(core.lotAcidFigures({ lab: null, pos_thca: 18, pos_cbda: null })).toEqual({ thca: 18, cbda: null, source: "pos" });
    expect(core.lotAcidFigures({})).toEqual({ thca: null, cbda: null, source: null });
  });
});

describe("R74 S24 C — table, sorts and totals read the shown price", () => {
  it("registry: Price carries source / pre-tax / floor; THCA·CBDA column after CBD; lab preset", () => {
    const price = tableCore.tableColumn("price")!;
    expect(price.fields.map((f) => f.key)).toEqual(["price", "price_source", "price_pre_tax", "price_floor"]);
    const acids = tableCore.tableColumn("acids")!;
    expect(acids.fields.map((f) => f.key)).toEqual(["thca", "cbda", "acid_source"]);
    expect(acids.sortKey).toBe("thca");
    const ids = tableCore.TABLE_COLUMN_IDS;
    expect(ids.indexOf("acids")).toBe(ids.indexOf("cbd") + 1);
    const lab = tableCore.COLUMN_PRESETS.find((p) => p.key === "lab")!;
    expect(lab.ids).toContain("acids");
  });
  it("price/margin helpers prefer the shelf fields when joined", () => {
    expect(tableCore.shelfPriceOf({ shelf_price_minor: 2500, onboarding_price_minor: 999 })).toBe(2500);
    expect(tableCore.shelfPriceOf({ shelf_price_minor: null, onboarding_price_minor: 999 })).toBeNull();
    expect(tableCore.shelfPriceOf({ onboarding_price_minor: 999 })).toBe(999);
    expect(tableCore.shelfMarginOf({ shelf_margin_pct: 40, onboarding_margin_pct: 10 })).toBe(40);
    expect(tableCore.shelfMarginOf({ onboarding_margin_pct: 10 })).toBe(10);
  });
  it("Price and Margin sorts use the shelf price; THCA sort exists", () => {
    const price = sortCore.columnSortDef("price")!;
    const margin = sortCore.columnSortDef("margin")!;
    const thca = sortCore.columnSortDef("thca")!;
    const lot = { shelf_price_minor: 2500, onboarding_price_minor: 999, shelf_margin_pct: 40, onboarding_margin_pct: 10, pos_thca: 18 } as never;
    expect(price.number!(lot)).toBe(2500);
    expect(margin.number!(lot)).toBe(40);
    expect(thca.number!(lot)).toBe(18);
    expect(price.number!({ onboarding_price_minor: 999 } as never)).toBe(999);
  });
  it("Ext. retail uses the shelf price (a Cultivera lot with no onboarding price is no longer blank)", () => {
    const ctx = { today: "2025-01-10", liveKeys: new Set<string>() };
    const m = metricsCore.computeInventoryMetrics(
      { id: "L1", on_hand_qty: 4, received_qty: 4, unit_cost_minor_units: 800, onboarding_price_minor: null, shelf_price_minor: 2500 } as never,
      ctx,
    );
    expect(m.extRetailMinor).toBe(10000);
    const old = metricsCore.computeInventoryMetrics(
      { id: "L1", on_hand_qty: 4, received_qty: 4, unit_cost_minor_units: 800, onboarding_price_minor: 1000 } as never,
      ctx,
    );
    expect(old.extRetailMinor).toBe(4000);
  });
});

describe("R74 S24 D — wiring and fail-closed", () => {
  beforeEach(() => {
    st.pricesComplete = true;
    st.audits = 0;
  });
  it("export refuses (503, no audit) when live menu prices did not load", async () => {
    st.pricesComplete = false;
    const res = await exportGET(new Request("http://x/admin/inventory/export?format=csv"));
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/live menu prices/);
    expect(st.audits).toBe(0);
  });
  it("export still works when prices loaded", async () => {
    const res = await exportGET(new Request("http://x/admin/inventory/export?format=csv"));
    expect(res.status).toBe(200);
  });
  it("page and export loader apply the same parity join; page shows the notice + cells", () => {
    const page = read("src/app/admin/inventory/page.tsx");
    const server = read("src/lib/inventory/inventory-table-server.ts");
    for (const src of [page, server]) {
      expect(src).toContain("loadLotLivePrices(");
      expect(src).toContain("getMenuClassificationFlags(");
      expect(src).toMatch(/attachLotParity\(categorizedRaw, livePrices\.index, menuFlags\)/);
    }
    expect(server).toContain("pricesComplete: livePrices.complete");
    expect(page).toContain('data-testid="inventory-live-price-incomplete"');
    expect(page).toContain('data-testid="inventory-price"');
    expect(page).toContain('data-testid="inventory-price-source"');
    expect(page).toContain('data-testid="inventory-acids"');
    expect(page).toContain("fmtLotMoney(l.shelf_price_minor)");
  });
  it("loader is chunked + paged and reports completeness", () => {
    const src = read("src/lib/inventory/lot-live-price-server.ts");
    expect(src).toContain("chunkedIn");
    expect(src).not.toMatch(/\.limit\(/);
    expect(src).toMatch(/if \(failed\) return \{ index: new Map\(\), complete: false \}/);
    expect(src).toContain('.eq("menu_version_id", published.id)');
  });
});
