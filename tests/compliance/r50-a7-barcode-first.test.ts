/**
 * tests/compliance/r50-a7-barcode-first.test.ts  (R50 A7)
 *
 * Barcode-first matching: a delivery line whose barcode (inventory_lots.lot_code)
 * is already a lot on ONE live card joins that card before any name rule.
 *
 *   1. self-tests pinned (barcode-match-core, planner) + registered in the runner.
 *   2. loadBarcodeInputs against the REAL postgrest-js client (FakePostgrest):
 *      the two bounded reads, own-lot exclusion, flag off / nothing live /
 *      no lot ids / failed read / missing table -> undefined (never partial).
 *   3. end to end: loader output -> planner joins the Cultivera card.
 *   4. the chip copy + publish-guard entry (owner words).
 *   5. wiring pins: staging + preview pass the SAME inputs; the drafts page
 *      sends lot_id; refresh mode never reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient: PC } = await import("@supabase/postgrest-js");
  return { createSupabaseAdminClient: () => new PC("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }) };
});

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const BC = "WA413287.INUN16";

const cult = {
  source_item_id: "pos-0123456789ab",
  name: "Blue Dream",
  brand_name: "Fairwinds",
  vendor_name: "Fairwinds LLC",
  category: "flower",
  strain_name: "Blue Dream",
  hidden: false,
  variants: [{ source_variant_id: "pos-0123456789ab-1", medical: false }],
};

async function admin() {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  return createSupabaseAdminClient();
}

beforeEach(() => {
  st.db = new FakePostgrest();
  delete process.env.INTAKE_BARCODE_FIRST;
  st.db.rows("inventory_lots").push(
    // the delivery's own lot (re-delivered barcode, key = barcode)
    { id: "lot-new", pos_product_key: BC, lot_code: BC, vendor_id: "V1" },
    // the same barcode, already selling on the Cultivera card
    { id: "lot-old", pos_product_key: "pos-0123456789ab", lot_code: BC, vendor_id: "v1" },
    // unrelated
    { id: "lot-x", pos_product_key: "pos-ffffffffffff", lot_code: "OTHER00001", vendor_id: null },
  );
});

describe("R50 A7 - self-tests", () => {
  it("cores pass with pinned counts and are in the pure runner", async () => {
    const { __runBarcodeMatchCoreTests } = await import("@/lib/pos/barcode-match-core");
    const { __runIntakeMasteringCoreTests } = await import("@/lib/pos/intake-mastering-core");
    expect(__runBarcodeMatchCoreTests().passed).toBe(34);
    expect(__runIntakeMasteringCoreTests().passed).toBe(327);
    const runner = src("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runBarcodeMatchCoreTests } from "../../src/lib/pos/barcode-match-core";');
    expect(runner).toMatch(/assertRan\("barcode-match-core", __runBarcodeMatchCoreTests\(\), 34\)/);
  });
});

describe("R50 A7 - loadBarcodeInputs (real postgrest-js)", () => {
  it("reads the drafts' own lots by id, then the lots carrying those barcodes; excludes the own lot", async () => {
    const { loadBarcodeInputs } = await import("@/lib/inventory/restock-preview-server");
    const res = await loadBarcodeInputs(await admin(), { drafts: [{ pos_product_key: BC, lot_id: "lot-new" }], liveCards: [cult] });
    expect(res).toBeDefined();
    expect(res!.barcodeByLotKey.get(BC)).toBe(BC);
    expect(res!.vendorIdByLotKey.get(BC)).toBe("v1");
    expect(res!.liveByBarcode.get(BC)).toEqual([{ cardKey: "pos-0123456789ab", vendorId: "v1" }]);
    const gets = st.db.log.filter((r) => r.method === "GET" && r.table === "inventory_lots");
    expect(gets).toHaveLength(2);
    expect(gets[0].url.searchParams.get("select")).toBe("id, pos_product_key, lot_code, vendor_id".replace(/ /g, ""));
    expect(gets[0].url.searchParams.get("id")).toBe("in.(lot-new)");
    expect(decodeURIComponent(gets[1].url.searchParams.get("lot_code") ?? "")).toBe(`in.(${BC})`);
    for (const g of gets) expect(g.url.searchParams.get("order")).toBe("id.asc");
  });

  it("flag off / nothing live / no lot ids / no barcode -> undefined with zero or one read", async () => {
    const { loadBarcodeInputs } = await import("@/lib/inventory/restock-preview-server");
    process.env.INTAKE_BARCODE_FIRST = "off";
    expect(await loadBarcodeInputs(await admin(), { drafts: [{ pos_product_key: BC, lot_id: "lot-new" }], liveCards: [cult] })).toBeUndefined();
    delete process.env.INTAKE_BARCODE_FIRST;
    expect(await loadBarcodeInputs(await admin(), { drafts: [{ pos_product_key: BC, lot_id: "lot-new" }], liveCards: [] })).toBeUndefined();
    expect(await loadBarcodeInputs(await admin(), { drafts: [{ pos_product_key: BC, lot_id: null }], liveCards: [cult] })).toBeUndefined();
    expect(st.db.log).toHaveLength(0);
    st.db.rows("inventory_lots").push({ id: "lot-junk", pos_product_key: "K", lot_code: "1", vendor_id: null });
    expect(await loadBarcodeInputs(await admin(), { drafts: [{ pos_product_key: "K", lot_id: "lot-junk" }], liveCards: [cult] })).toBeUndefined();
    expect(st.db.log).toHaveLength(1);
  });

  it("any failed read -> undefined (never a partial set)", async () => {
    const { loadBarcodeInputs } = await import("@/lib/inventory/restock-preview-server");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    st.db.before = () => {
      n += 1;
      if (n === 2) return { status: 500, body: { message: "boom", code: "XX000" } };
    };
    expect(await loadBarcodeInputs(await admin(), { drafts: [{ pos_product_key: BC, lot_id: "lot-new" }], liveCards: [cult] })).toBeUndefined();
    st.db.before = () => ({ status: 500, body: { message: "boom", code: "XX000" } });
    expect(await loadBarcodeInputs(await admin(), { drafts: [{ pos_product_key: BC, lot_id: "lot-new" }], liveCards: [cult] })).toBeUndefined();
    st.db.before = null;
    st.db.missing.add("inventory_lots");
    expect(await loadBarcodeInputs(await admin(), { drafts: [{ pos_product_key: BC, lot_id: "lot-new" }], liveCards: [cult] })).toBeUndefined();
    spy.mockRestore();
  });

  it("a PARTIAL draft read (one chunk of several failed) is never used", async () => {
    const { loadBarcodeInputs } = await import("@/lib/inventory/restock-preview-server");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // 250 drafts -> two id chunks (200 + 50); only the SECOND chunk fails, so
    // the first chunk's lots (incl. lot-new) were read fine.
    const drafts = [{ pos_product_key: BC, lot_id: "lot-new" }];
    for (let i = 0; i < 249; i++) {
      const id = `lot-f${String(i).padStart(3, "0")}`;
      st.db.rows("inventory_lots").push({ id, pos_product_key: `KF${i}`, lot_code: `FILL${String(i).padStart(6, "0")}`, vendor_id: null });
      drafts.push({ pos_product_key: `KF${i}`, lot_id: id });
    }
    let n = 0;
    st.db.before = (req) => {
      if (req.method !== "GET") return;
      n += 1;
      if (n === 2) return { status: 500, body: { message: "boom", code: "XX000" } };
    };
    expect(await loadBarcodeInputs(await admin(), { drafts, liveCards: [cult] })).toBeUndefined();
    expect(n).toBe(2); // stopped after the id reads - never went on to the barcode read
    spy.mockRestore();
  });

  it("more than 1,000 distinct barcodes -> undefined, no barcode read at all", async () => {
    const { loadBarcodeInputs } = await import("@/lib/inventory/restock-preview-server");
    const { BARCODE_LOOKUP_CAP } = await import("@/lib/pos/barcode-match-core");
    expect(BARCODE_LOOKUP_CAP).toBe(1000);
    const drafts = [{ pos_product_key: BC, lot_id: "lot-new" }];
    for (let i = 0; i < BARCODE_LOOKUP_CAP; i++) {
      const id = `lot-c${String(i).padStart(4, "0")}`;
      st.db.rows("inventory_lots").push({ id, pos_product_key: `KC${i}`, lot_code: `CAP${String(i).padStart(7, "0")}`, vendor_id: null });
      drafts.push({ pos_product_key: `KC${i}`, lot_id: id });
    }
    expect(await loadBarcodeInputs(await admin(), { drafts, liveCards: [cult] })).toBeUndefined();
    const gets = st.db.log.filter((r) => r.method === "GET");
    expect(gets.every((g) => g.url.searchParams.has("id"))).toBe(true);
    expect(gets.some((g) => g.url.searchParams.has("lot_code"))).toBe(false);
  });

  it("end to end: the loader's inputs make the planner join the Cultivera card", async () => {
    const { loadBarcodeInputs } = await import("@/lib/inventory/restock-preview-server");
    const { buildIntakeMasteringPlan, previewMasteringGroups } = await import("@/lib/pos/intake-mastering-core");
    const barcodes = await loadBarcodeInputs(await admin(), { drafts: [{ pos_product_key: BC, lot_id: "lot-new" }], liveCards: [cult] });
    const draft = {
      id: "d1",
      pos_product_key: BC,
      name: "Renamed Product 1g",
      brand_name: "Fairwinds",
      vendor_name: "Fairwinds LLC",
      strain_name: "Renamed",
      thc_pct: 20,
      cbd_pct: 0,
      total_thc_pct: 22,
      potency_json: null,
      price_minor_units: 1500,
      updated_at: "2026-10-20T00:00:00Z",
    };
    const enrich = new Map([["d1", { websiteCategory: "flower", strainType: "hybrid", onHandQty: 4, packageLabel: "1g" }]]);
    const plain = buildIntakeMasteringPlan({ drafts: [draft], existingKeys: new Set(), enrichmentByDraftId: enrich, liveCards: [cult] });
    expect(plain.newCards).toHaveLength(1);
    const plan = buildIntakeMasteringPlan({ drafts: [draft], existingKeys: new Set(), enrichmentByDraftId: enrich, liveCards: [cult], barcodes });
    expect(plan.newCards).toHaveLength(0);
    expect(plan.mergesByCardKey.get("pos-0123456789ab")?.map((v) => v.source_variant_id)).toEqual([`${BC}-onboarded`]);
    const pv = previewMasteringGroups({
      drafts: [{ id: "d1", pos_product_key: BC, lot_id: "lot-new", name: draft.name, brand_name: "Fairwinds", vendor_name: "Fairwinds LLC", strain_name: "Renamed", category: "flower" }],
      liveCards: [cult],
      barcodes,
    });
    expect(pv.verdicts.get("d1")).toMatchObject({ kind: "joins", cardKey: "pos-0123456789ab", byBarcode: BC });
  });
});

describe("R50 A7 - owner words", () => {
  it("chip copy names the barcode; other joins unchanged", async () => {
    const { restockChipCopy, restockChipDetail } = await import("@/lib/inventory/vendor-identity-core");
    const base = { kind: "joins" as const, cardKey: "pos-0123456789ab", cardName: "Blue Dream", fromCultivera: true, matchedBy: "name" as const, vendorRecordDiffers: false };
    expect(restockChipCopy({ ...base, byBarcode: BC })).toBe("Restock \u2192 joins live card 'Blue Dream' (same barcode)");
    expect(restockChipDetail({ ...base, byBarcode: BC })).toContain(`because its barcode ${BC} is already a lot on that card`);
    expect(restockChipCopy(base)).toBe("Restock \u2192 joins live card 'Blue Dream' (from Cultivera import)");
    expect(restockChipDetail(base)).not.toContain("barcode");
  });

  it("publish guard explains the unused-barcode note as informational", async () => {
    const { explainDiagnostic } = await import("@/lib/pos/publish-guard-core");
    const x = explainDiagnostic("intake_master_barcode_unused", "raw");
    expect(x.title).toBe("Same barcode on the menu, matched by name instead");
    expect(x.informational).toBe(true);
    expect(x.fixHref).toBeNull();
  });
});

describe("R50 A7 - wiring pins", () => {
  it("staging reads barcodes (not in refresh mode) and passes them to BOTH plans", () => {
    const s = src("src/lib/pos/intake-menu-staging.ts");
    expect(s).toContain('import { loadBarcodeInputs, loadVendorIdInputs } from "@/lib/inventory/restock-preview-server";');
    expect(s).toMatch(/const barcodes =\s*\n\s*!refreshMode && publishedItems\.length > 0\s*\n\s*\? await loadBarcodeInputs\(admin,/);
    expect(s).toContain("drafts: drafts.map((d) => ({ pos_product_key: d.pos_product_key, lot_id: d.lot_id })),");
    expect((s.match(/^\s+barcodes,$/gm) ?? []).length).toBe(2);
    const core = src("src/lib/pos/intake-menu-staging-core.ts");
    expect(core).toContain("barcodes: inputs.barcodes,");
  });

  it("preview reads barcodes alongside vendor ids and re-uses them for the alias pass", () => {
    const s = src("src/lib/inventory/restock-preview-server.ts");
    expect(s).toContain("loadBarcodeInputs(admin, { drafts, liveCards }),");
    expect(s).toContain("previewMasteringGroups({ drafts, liveCards, vendorIds, barcodes })");
    expect(s).toContain("previewMasteringGroups({ drafts, liveCards, vendorIds, cardAliases, barcodes })");
    expect(s).toContain('export const LOT_BARCODE_COLUMNS = "id, pos_product_key, lot_code, vendor_id";');
    expect(src("src/app/admin/inventory/drafts/page.tsx")).toContain("lot_id: d.lot_id,");
  });

  it("the planner checks the barcode AFTER already-live and BEFORE the vendor/name rules", () => {
    const s = src("src/lib/pos/intake-mastering-core.ts");
    const body = s.slice(s.indexOf("export function buildIntakeMasteringPlan"));
    const live = body.indexOf('code: "intake_lot_already_live"');
    const bc = body.indexOf("barcodeTarget(live, inputs.barcodes, it.source_item_id, it.category)");
    const vendor = body.indexOf('code: "intake_master_no_vendor"');
    const match = body.indexOf("matchLiveCards(live,");
    expect(live).toBeGreaterThan(0);
    expect(bc).toBeGreaterThan(live);
    expect(vendor).toBeGreaterThan(bc);
    expect(match).toBeGreaterThan(bc);
  });
});
