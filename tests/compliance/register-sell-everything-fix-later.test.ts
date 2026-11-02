/**
 * tests/compliance/register-sell-everything-fix-later.test.ts
 *
 * Owner, verbatim: "Are all others sellable, not just the ones in the
 * screenshots? Some of them wouldn't let me sell them because we could get
 * the coa from Cultivera. I need to sell these products too. Please give me
 * more peace of mind this will work. I need ways of fixing a lot from the
 * register, let the system fix it for me so it can be sold, then set that
 * item aside so I can fix it properly. Everything must sell. No exceptions.
 * We will fix it all later. We need to sell everything we have stock of. No
 * matter what."
 *
 * Drives the REAL GET /api/pos/menu handler (fake Supabase) and the pure
 * register-fix-later-core, and pins the Fix & sell wiring.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { resolveScan } from "@/lib/pos/scan-to-cart-core";
import type { PosMenuBundle, PosMenuProduct } from "@/lib/pos/sale-flow-core";
import {
  __runRegisterFixLaterCoreTests,
  addFixLaterProduct,
  decideFixAndSell,
  stockCoverage,
  coverageSentence,
  looksLikePackageCode,
  type FixLaterLot,
} from "@/lib/pos/register-fix-later-core";
import { SALE_DRAW_LOT_STATUSES } from "@/lib/inventory/sale-lot-read";

let lotRows: Record<string, unknown>[] = [];
let menuItems: GreenwayMenuItem[] = [];
let recalledKeys = new Set<string>();
let destructionRows: { lot_id: string }[] = [];
let labRows: { id: string; passed: boolean | null }[] = [];

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ["select", "eq", "gt", "is", "neq", "lt", "in", "order", "limit", "abortSignal", "insert"]) builder[m] = chain;
      const rowsFor = () =>
        table === "destruction_events" ? destructionRows : table === "lab_results" ? labRows : [];
      builder.range = async (from: number, to: number) => {
        if (table !== "inventory_lots") return { data: [], error: null };
        return { data: lotRows.slice(from, to + 1), error: null };
      };
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: rowsFor(), error: null });
      builder.maybeSingle = async () => ({ data: null, error: null });
      builder.single = async () => ({ data: null, error: null });
      return builder;
    },
  }),
}));

vi.mock("@/lib/pos/sync-store", () => ({
  authenticateDevice: async () => ({ ok: true, device: { id: "dev-1", register_id: "reg-1" } }),
}));
vi.mock("@/lib/pos/live-menu", () => ({ loadLiveMenuAll: async () => menuItems }));
vi.mock("@/lib/pos/recall-hold-store", () => ({ recalledProductKeys: async () => recalledKeys }));
vi.mock("@/lib/promotions/discount-engine", () => ({
  loadActiveRules: async () => [],
  loadProductCosts: async () => new Map(),
}));
vi.mock("@/lib/compliance/sales-limits", () => ({
  getSalesLimitSettings: async () => ({ enforce: true, hardBlock: true, rec: {}, med: {}, unitGrams: {} }),
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
vi.mock("@/lib/discounts/special-discount-store", () => ({ getSpecialDiscountSettings: async () => [] }));
vi.mock("@/lib/pos/cors", () => ({
  posPreflightResponse: () => new Response(null, { status: 204 }),
  withPosCors: (_req: unknown, res: Response) => res,
}));

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
    inventoryStatus: "in-stock",
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
    unit_weight: null,
    unit_weight_uom: null,
    is_medical: null,
    unit_cost_minor_units: null,
    category: null,
    inventory_type: null,
    lab_result_id: null,
    is_sample: false,
    ...over,
  };
}

type Bundle = { products: PosMenuProduct[]; barcodes: Record<string, string> };

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
  destructionRows = [];
  labRows = [];
});

describe("pure core self-tests", () => {
  it("passes every register-fix-later-core self-test", () => {
    const r = __runRegisterFixLaterCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(60);
  });
});

describe("everything with stock sells at the register", () => {
  it("a Quarantine lot on a published card sells and scans", async () => {
    menuItems = [item()];
    lotRows = [lotRow({ status: "quarantine", on_hand_qty: 4 })];
    const bundle = await getBundle();
    expect(bundle.products.map((p) => p.productId)).toContain("KEY-A");
    expect(resolveScan(bundle.products, bundle.barcodes, "LOTCODE-1111").status).toBe("add");
  });

  it("a stocked lot with NO menu product (no COA) sells from the lot itself and scans", async () => {
    menuItems = [];
    lotRows = [
      lotRow({
        id: "lot-m",
        lot_code: "GF41918905566984",
        pos_product_key: "KEY-MIMOSA",
        product_name: "HTE HONEY - Mimosa - .7g",
        status: "quarantine",
        on_hand_qty: 6,
        unit_cost_minor_units: 1000,
        inventory_type: "Concentrate for Inhalation",
      }),
    ];
    const bundle = await getBundle();
    const line = bundle.products.find((p) => p.productId === "KEY-MIMOSA");
    expect(line).toBeTruthy();
    expect(line?.fixLater).toBe(true);
    expect(line?.regularPriceMinor).toBeGreaterThan(0);
    expect(resolveScan(bundle.products, bundle.barcodes, "GF41918905566984").status).toBe("add");
  });

  it("a Quarantine lot scheduled for destruction does NOT sell", async () => {
    menuItems = [item()];
    lotRows = [lotRow({ status: "quarantine", on_hand_qty: 4 })];
    destructionRows = [{ lot_id: "lot-1" }];
    const bundle = await getBundle();
    expect(resolveScan(bundle.products, bundle.barcodes, "LOTCODE-1111").status).not.toBe("add");
  });

  it("a recalled lot with no menu product does NOT get a register line", async () => {
    lotRows = [lotRow({ pos_product_key: "KEY-R", on_hand_qty: 3 })];
    recalledKeys = new Set(["KEY-R"]);
    const bundle = await getBundle();
    expect(bundle.products.find((p) => p.productId === "KEY-R")).toBeUndefined();
  });

  it("a FAILED lab lot with no menu product does NOT get a register line", async () => {
    lotRows = [lotRow({ pos_product_key: "KEY-F", lab_result_id: "lab-1", on_hand_qty: 3 })];
    labRows = [{ id: "lab-1", passed: false }];
    const bundle = await getBundle();
    expect(bundle.products.find((p) => p.productId === "KEY-F")).toBeUndefined();
  });

  it("the sale draws stock from Quarantine lots too", () => {
    expect([...SALE_DRAW_LOT_STATUSES]).toEqual(["active", "sold_out", "quarantine"]);
  });
});

describe("Fix & sell", () => {
  const lot: FixLaterLot = {
    id: "lot-x",
    posProductKey: "KEY-X",
    lotCode: "PKG123456",
    productName: "Mystery Cart - 1g",
    status: "quarantine",
    onHandQty: 2,
    hasLabResult: false,
  };

  it("builds a sellable line from a lot with no COA and no menu product", () => {
    const d = decideFixAndSell([lot], "PKG123456");
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.product.fixLater).toBe(true);
      const bundle = { products: [], barcodes: {} } as unknown as PosMenuBundle;
      const next = addFixLaterProduct(bundle, d.product, "PKG123456");
      expect(resolveScan(next.products, next.barcodes ?? {}, "PKG123456").status).toBe("add");
    }
  });

  it("refuses only the real stops", () => {
    expect(decideFixAndSell([{ ...lot, recalled: true }], "PKG123456").ok).toBe(false);
    expect(decideFixAndSell([{ ...lot, labPassed: false }], "PKG123456").ok).toBe(false);
    expect(decideFixAndSell([{ ...lot, scheduledForDestruction: true }], "PKG123456").ok).toBe(false);
    expect(decideFixAndSell([{ ...lot, isSample: true }], "PKG123456").ok).toBe(false);
    expect(decideFixAndSell([], "PKG123456").ok).toBe(false);
  });

  it("package codes are recognised, product searches are not", () => {
    expect(looksLikePackageCode("GF41918905566984")).toBe(true);
    expect(looksLikePackageCode("blue dream")).toBe(false);
  });

  it("the coverage sentence says when every stocked lot sells", () => {
    const cov = stockCoverage([lot, { ...lot, id: "lot-y", status: "active", hasLabResult: true }]);
    expect(cov.sellingLots).toBe(2);
    expect(coverageSentence(cov)).toMatch(/^All 2 lots with stock/);
  });

  it("wiring: the route, the register button and the back office list exist", () => {
    const route = readFileSync("src/app/api/pos/fix-and-sell/route.ts", "utf8");
    expect(route).toContain("decideFixAndSell");
    expect(route).toContain("REGISTER_FIX_AND_SELL_AUDIT_ACTION");
    expect(route).not.toMatch(/status:\s*"active"/);
    const sale = readFileSync("src/app/(site)/pos/SaleFlow.tsx", "utf8");
    expect(sale).toContain('data-testid="pos-fix-and-sell"');
    const shell = readFileSync("src/app/(site)/pos/RegisterShell.tsx", "utf8");
    expect(shell).toContain('"/api/pos/fix-and-sell"');
    expect(shell).toContain("addFixLaterProduct");
    const page = readFileSync("src/app/admin/inventory/fix-later/page.tsx", "utf8");
    expect(page).toContain("readFixLaterCoverage");
    const inv = readFileSync("src/app/admin/inventory/page.tsx", "utf8");
    expect(inv).toContain('href="/admin/inventory/fix-later"');
  });
});
