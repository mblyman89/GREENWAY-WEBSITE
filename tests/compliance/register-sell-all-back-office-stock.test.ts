/**
 * tests/compliance/register-sell-all-back-office-stock.test.ts
 *
 * Owner, verbatim: "i am finding several products that we are unable to find
 * on the front register, despite them being active, with quantity available
 * and such, so they should be sellable. please help me fix this so all the
 * items in my back office inventory table are sellable on the register ...
 * we need to be able to sell everything, especially if it can be found in the
 * back office inventory."
 *
 * These tests DRIVE THE REAL `GET /api/pos/menu` HANDLER (same fake Supabase
 * harness as register-availability.test.ts) and assert on the bundle the
 * register would receive. Nothing here greps source text.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { resolveScan } from "@/lib/pos/scan-to-cart-core";
import { searchProducts, addToCart, type PosMenuProduct } from "@/lib/pos/sale-flow-core";
import { canAddOne } from "@/lib/pos/stock-ceiling-core";
import { diagnoseLot, type SnapshotCard } from "@/lib/pos/register-availability-core";

/** Rows the fake `inventory_lots` table will serve. Mutated per test. */
let lotRows: Record<string, unknown>[] = [];
/** Items the fake published menu will serve. Mutated per test. */
let menuItems: GreenwayMenuItem[] = [];
/** Product keys under an AN-7 recall hold. Mutated per test. */
let recalledKeys = new Set<string>();
/** Set true to make the lot read fail, proving the best-effort contract. */
let lotReadFails = false;

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));

/**
 * A minimal PostgREST-shaped fake. It honours `.range()` so the route's real
 * pagination runs for real — that matters, because `inventory_lots` is the
 * table that actually exceeds PostgREST's 1,000-row cap in production.
 */
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ["select", "eq", "gt", "is", "neq", "lt", "in", "order", "limit"]) {
        builder[m] = chain;
      }
      builder.range = async (from: number, to: number) => {
        if (table !== "inventory_lots") return { data: [], error: null };
        if (lotReadFails) return { data: null, error: { message: "boom" } };
        return { data: lotRows.slice(from, to + 1), error: null };
      };
      builder.maybeSingle = async () => ({ data: null, error: null });
      builder.single = async () => ({ data: null, error: null });
      return builder;
    },
  }),
}));

// Device auth always succeeds — not what is under test here.
vi.mock("@/lib/pos/sync-store", () => ({
  authenticateDevice: async () => ({
    ok: true,
    device: { id: "dev-1", register_id: "reg-1" },
  }),
}));

vi.mock("@/lib/pos/live-menu", () => ({ loadLiveMenuAll: async () => menuItems }));
vi.mock("@/lib/pos/recall-hold-store", () => ({ recalledProductKeys: async () => recalledKeys }));

// Everything else the bundle needs, stubbed to boring defaults.
vi.mock("@/lib/promotions/discount-engine", () => ({
  loadActiveRules: async () => [],
  loadProductCosts: async () => new Map(),
}));
vi.mock("@/lib/compliance/sales-limits", () => ({
  getSalesLimitSettings: async () => ({
    enforce: true, hardBlock: true, rec: {}, med: {}, unitGrams: {},
  }),
}));
vi.mock("@/lib/compliance/sales-hours-store", () => ({
  getSalesHoursWindow: async () => ({ open: "08:00", close: "23:00" }),
}));
vi.mock("@/lib/medical/store", () => ({
  getMedTaxSettings: async () => ({ medicallyEndorsed: false }),
  getEndorsementConfig: async () => null,
}));
vi.mock("@/lib/medical/sale-store", () => ({ listMedicalRegistry: async () => [] }));
vi.mock("@/lib/pos/receipt-config-store", () => ({ getPosReceiptConfig: async () => ({}) }));
vi.mock("@/lib/pos/cash-rounding-store", () => ({ getPosCashRoundingConfig: async () => ({}) }));
vi.mock("@/lib/pos/scan-required-store", () => ({ getPosScanRequiredConfig: async () => ({}) }));
vi.mock("@/lib/loyalty/loyalty-store", () => ({
  getConfig: async () => ({ pointsPerDollar: 1, pointValueMinor: 1, minRedeemPoints: 100 }),
}));
vi.mock("@/lib/discounts/special-discount-store", () => ({
  getSpecialDiscountSettings: async () => [],
}));
vi.mock("@/lib/pos/cors", () => ({
  posPreflightResponse: () => new Response(null, { status: 204 }),
  withPosCors: (_req: unknown, res: Response) => res,
}));

// ───────────────────────────────────────────────────────────────────────────
// Builders
// ───────────────────────────────────────────────────────────────────────────

function item(over: Partial<GreenwayMenuItem> = {}): GreenwayMenuItem {
  return {
    id: "KEY-A",
    name: "Blue Dream",
    brand: "House",
    category: "flower",
    filterCategories: ["flower"],
    strainType: "hybrid",
    thc: null,
    cbd: null,
    totalThc: null,
    totalCbd: null,
    compounds: [],
    description: "",
    priceLabel: "$40.00",
    priceMinorUnits: 4000,
    // The DEFAULT is the bug's fingerprint: the published snapshot says
    // unavailable while the shelf (and the back office) says otherwise.
    inventoryStatus: "unavailable",
    hidden: false,
    variants: [],
    ...over,
  } as GreenwayMenuItem;
}

function lotRow(over: Record<string, unknown> = {}) {
  return {
    id: "lot-1",
    lot_code: "LOTCODE-1111",
    pos_product_key: "KEY-A",
    ccrs_inventory_external_id: null,
    status: "active",
    on_hand_qty: 12,
    product_name: "Blue Dream",
    ...over,
  };
}

type Bundle = {
  products: {
    productId: string;
    variantId: string;
    inventoryStatus: string;
    unitsLeft: number | null;
    searchText?: string;
    name: string;
    regularPriceMinor: number;
  }[];
  barcodes: Record<string, string>;
};

/** Drive the REAL route handler and return the bundle a register would get. */
async function getBundle(): Promise<Bundle> {
  vi.resetModules();
  const { GET } = await import("@/app/api/pos/menu/route");
  const req = new Request("https://example.test/api/pos/menu", {
    headers: { "x-pos-device-id": "dev-1", "x-pos-device-key": "key-1" },
  });
  const res = await GET(req as never);
  expect(res.status).toBe(200);
  return (await res.json()) as Bundle;
}

beforeEach(() => {
  lotRows = [];
  menuItems = [];
  recalledKeys = new Set();
  lotReadFails = false;
  vi.restoreAllMocks();
});


/** A card the Cultivera import hid from the website (no Products master). */
function importerHidden(over: Partial<GreenwayMenuItem> = {}): GreenwayMenuItem {
  return item({
    hidden: true,
    hiddenReason: "no_product_master",
    posInventoryCategory: "Flower",
    inventoryStatus: "unavailable",
    ...over,
  } as Partial<GreenwayMenuItem>);
}

// ═══════════════════════════════════════════════════════════════════════════
describe("importer-hidden back-office stock is sellable at the register", () => {
  it("rings up a no_product_master flower card with live stock, and its barcode scans", async () => {
    menuItems = [importerHidden()];
    lotRows = [lotRow({ on_hand_qty: 9 })];

    const bundle = await getBundle();

    expect(bundle.products.map((p) => p.productId)).toEqual(["KEY-A"]);
    expect(bundle.products[0].unitsLeft).toBe(9);
    expect(bundle.products[0].regularPriceMinor).toBe(4000);
    expect(Object.values(bundle.barcodes)).toContain("KEY-A");
    const scan = resolveScan(bundle.products as unknown as PosMenuProduct[], bundle.barcodes, "LOTCODE-1111");
    expect(scan.status).toBe("add");
  });

  it("also sells a no_inventory card once a lot holds stock", async () => {
    menuItems = [importerHidden({ hiddenReason: "no_inventory" })];
    lotRows = [lotRow({ on_hand_qty: 3 })];
    const bundle = await getBundle();
    expect(bundle.products.map((p) => p.productId)).toEqual(["KEY-A"]);
  });

  it("does NOT serve an importer-hidden card whose only lots are recalled/destroyed", async () => {
    // register-sell-everything-fix-later: Quarantine lots now sell (fix later).
    menuItems = [importerHidden({ inventoryStatus: "in-stock" })];
    lotRows = [
      lotRow({ id: "lot-2", status: "recalled", on_hand_qty: 5 }),
      lotRow({ id: "lot-3", status: "destroyed", on_hand_qty: 0 }),
    ];
    const bundle = await getBundle();
    expect(bundle.products).toEqual([]);
  });

  it("register-sell-sold-out-stock: serves a hidden card whose lot is Sold out at a 0 count", async () => {
    menuItems = [importerHidden({ inventoryStatus: "unavailable" })];
    lotRows = [lotRow({ status: "sold_out", on_hand_qty: 0 })];
    const bundle = await getBundle();
    expect(bundle.products.map((p) => p.productId)).toEqual(["KEY-A"]);
  });

  it("sells EVERY hidden card with live stock - person hides and category holds included (owner: no exceptions)", async () => {
    const cases: Partial<GreenwayMenuItem>[] = [
      { hiddenReason: "owner" },
      { hiddenReason: "owner_override_hide:" },
      { hiddenReason: "owner_override_hide:2024-01-01" },
      { hiddenReason: "reviewer_rejected" },
      { hiddenReason: undefined },
      { hiddenReason: "needs_category" },
      { posInventoryCategory: "Mystery Stuff" },
      { posInventoryCategory: undefined },
    ];
    for (const over of cases) {
      menuItems = [importerHidden(over)];
      lotRows = [lotRow({ on_hand_qty: 20 })];
      const bundle = await getBundle();
      expect(bundle.products.map((p) => p.productId), JSON.stringify(over)).toEqual(["KEY-A"]);
      expect(Object.values(bundle.barcodes), JSON.stringify(over)).toContain("KEY-A");
    }
  });

  it("still keeps a hidden card off when the sale itself would be wrong (non-cannabis category, no price)", async () => {
    const cases: Partial<GreenwayMenuItem>[] = [
      { category: "paraphernalia" as GreenwayMenuItem["category"], posInventoryCategory: "Flower" },
      { priceMinorUnits: 0, priceLabel: "" },
    ];
    for (const over of cases) {
      menuItems = [importerHidden(over)];
      lotRows = [lotRow({ on_hand_qty: 20 })];
      const bundle = await getBundle();
      expect(bundle.products, JSON.stringify(over)).toEqual([]);
    }
  });

  it("drops an importer-hidden card's $0 sizes but sells its priced ones", async () => {
    menuItems = [
      importerHidden({
        variants: [
          { id: "KEY-A-onboarded", label: "3.5g", priceMinorUnits: 3500, inventoryLevel: 0, medical: false },
          { id: "v-free", label: "1g", priceMinorUnits: 0, inventoryLevel: 0, medical: false },
        ],
      }),
    ];
    lotRows = [lotRow({ on_hand_qty: 6 })];
    const bundle = await getBundle();
    expect(bundle.products.map((p) => p.variantId)).toEqual(["KEY-A-onboarded"]);
    expect(bundle.products[0].unitsLeft).toBe(6);
  });

  it("never lets an importer hide bypass a RECALL", async () => {
    menuItems = [importerHidden()];
    lotRows = [lotRow({ on_hand_qty: 9 })];
    recalledKeys = new Set(["KEY-A"]);
    const bundle = await getBundle();
    expect(bundle.products).toEqual([]);
    expect(bundle.barcodes).toEqual({});
  });

  it("never counts trade samples as the stock that unlocks a hidden card", async () => {
    menuItems = [importerHidden()];
    lotRows = [lotRow({ on_hand_qty: 9, is_sample: true })];
    const bundle = await getBundle();
    expect(bundle.products).toEqual([]);
  });

  it("does not count units held for destruction", async () => {
    menuItems = [importerHidden()];
    lotRows = [lotRow({ on_hand_qty: 4, held_qty: 4 })];
    const bundle = await getBundle();
    // register-sell-sold-out-stock: the card stays (sell anyway) but the 4
    // held units are never shown or counted as register stock.
    for (const p of bundle.products as unknown as PosMenuProduct[]) expect(p.unitsLeft ?? 0).toBe(0);
  });
});

describe("a stale cached 0 no longer hides real stock", () => {
  it("replaces a stale '0 left' on a sellable card with the live lot count", async () => {
    menuItems = [
      item({
        inventoryStatus: "in-stock",
        variants: [{ id: "v1", label: "3.5g", priceMinorUnits: 4000, inventoryLevel: 0, medical: false }],
      }),
    ];
    lotRows = [lotRow({ on_hand_qty: 5 })];
    const bundle = await getBundle();
    const p = bundle.products[0] as unknown as PosMenuProduct;
    expect(p.unitsLeft).toBe(5);
    // The scan now really lands in the cart instead of clamping to nothing.
    expect(canAddOne(0, p.unitsLeft, false)).toBe(true);
    expect(addToCart([], p)).toHaveLength(1);
  });

  it("pins units to the lot's linked size (0294) on a multi-size card", async () => {
    menuItems = [
      item({
        inventoryStatus: "in-stock",
        variants: [
          { id: "v-1g", label: "1g", priceMinorUnits: 1500, inventoryLevel: 0, medical: false },
          { id: "v-35", label: "3.5g", priceMinorUnits: 4000, inventoryLevel: 0, medical: false },
        ],
      }),
    ];
    lotRows = [lotRow({ on_hand_qty: 8, menu_source_variant_id: "v-35" })];
    const bundle = await getBundle();
    const byVariant = Object.fromEntries(bundle.products.map((p) => [p.variantId, p.unitsLeft]));
    expect(byVariant["v-35"]).toBe(8);
    // Both counters agree the 1g size is empty.
    expect(byVariant["v-1g"]).toBe(0);
  });
});

describe("search finds what the back office table shows", () => {
  it("matches the lot's own product name and the strain, not just the card name", async () => {
    menuItems = [
      item({
        name: "SPR - House Flower",
        strainName: "Sour Diesel",
        inventoryStatus: "in-stock",
        variants: [{ id: "v1", label: "3.5g", priceMinorUnits: 4000, inventoryLevel: 3, medical: false }],
      } as Partial<GreenwayMenuItem>),
    ];
    lotRows = [lotRow({ product_name: "Sungrown Premium Rec Sour D 3.5g" })];
    const bundle = await getBundle();
    const products = bundle.products as unknown as PosMenuProduct[];
    expect(bundle.products[0].searchText).toContain("Sungrown Premium Rec Sour D 3.5g");
    expect(searchProducts(products, "sungrown premium")).toHaveLength(1);
    expect(searchProducts(products, "sour diesel")).toHaveLength(1);
    expect(searchProducts(products, "nothing like this")).toHaveLength(0);
  });
});

describe("back-office banner agrees with the register", () => {
  it("diagnoses a register-eligible importer-hidden lot as sellable, a person's hide as hidden", () => {
    const base: SnapshotCard = { productId: "KEY-A", lotKeys: ["KEY-A"], inventoryStatus: "unavailable", hidden: true, recalled: false };
    const lot = { id: "l1", posProductKey: "KEY-A", status: "active", onHandQty: 5 };
    expect(diagnoseLot(lot, new Map([["KEY-A", { ...base, registerEligible: true }]])).sellable).toBe(true);
    expect(diagnoseLot(lot, new Map([["KEY-A", base]])).code).toBe("hidden_card");
  });
});

describe("GUARDRAIL: every sellable back-office lot reaches the register", () => {
  it("serves every active, stocked, non-sample, non-recalled lot whose card is visible or hidden (any reason)", async () => {
    const keys = ["K1", "K2", "K3", "K4", "K5", "K6"];
    menuItems = [
      item({ id: "K1", inventoryStatus: "in-stock" }),
      item({ id: "K2", inventoryStatus: "unavailable" }),
      importerHidden({ id: "K3" }),
      importerHidden({ id: "K4", hiddenReason: "no_inventory", posInventoryCategory: "Pre-roll", category: "preroll" as GreenwayMenuItem["category"] }),
      item({ id: "K5", inventoryStatus: "in-stock", variants: [{ id: "v5", label: "1g", priceMinorUnits: 2000, inventoryLevel: 0, medical: false }] }),
      item({ id: "K6", hidden: true, hiddenReason: "owner" } as Partial<GreenwayMenuItem>),
    ];
    lotRows = keys.map((k, i) => lotRow({ id: `lot-${i}`, pos_product_key: k, lot_code: `CODE-${k}`, on_hand_qty: 4 }));
    const bundle = await getBundle();
    const served = new Set(bundle.products.map((p) => p.productId));
    // register-sell-hidden-and-held-stock: a person's website hide no longer
    // keeps stocked product off the register (owner: "no exceptions").
    for (const k of keys) expect(served.has(k), k).toBe(true);
    for (const p of bundle.products) expect(p.unitsLeft === null || p.unitsLeft > 0, p.productId).toBe(true);
    for (const k of keys) {
      const r = resolveScan(bundle.products as unknown as PosMenuProduct[], bundle.barcodes, `CODE-${k}`);
      expect(r.status, k).toBe("add");
    }
  });
});
