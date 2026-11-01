/**
 * tests/compliance/register-scan-exact-size.test.ts
 *
 * Owner, verbatim: "when I scan a product, it will pull on screen all of the
 * products of the same type but the different size variants. for example, if
 * we stock 3.5g, 7g, and 28g options, scanning the 3.5g bag pulls on screen
 * all three options, where I then have to select one of the three. this will
 * cause major issues with inventory discrepancies if the budtenders push the
 * wrong one. if I scan something, and it knows what it is I just scanned, that
 * product alone needs to be added to the cart with out needing to select a
 * variant size."
 *
 * These tests DRIVE THE REAL `GET /api/pos/menu` HANDLER and feed the bundle
 * it returns through the REAL `resolveScan` the iPad register runs, exactly as
 * SaleFlow.tsx does. Nothing here greps source text.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { resolveScan, scanPickPrompt } from "@/lib/pos/scan-to-cart-core";
import type { PosMenuProduct } from "@/lib/pos/sale-flow-core";

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


function item(over: Partial<GreenwayMenuItem> = {}): GreenwayMenuItem {
  return {
    id: "KEY-OG",
    name: "OG Kush",
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
    priceLabel: "$35.00",
    priceMinorUnits: 3500,
    inventoryStatus: "in-stock",
    hidden: false,
    variants: [
      { id: "v-35", label: "3.5g", priceMinorUnits: 3500, inventoryLevel: 0, medical: false },
      { id: "v-7", label: "7g", priceMinorUnits: 6000, inventoryLevel: 0, medical: false },
      { id: "v-28", label: "28g", priceMinorUnits: 18000, inventoryLevel: 0, medical: false },
    ],
    ...over,
  } as GreenwayMenuItem;
}

function lotRow(over: Record<string, unknown> = {}) {
  return {
    id: "lot-1",
    lot_code: "LOT-35-0001",
    pos_product_key: "KEY-OG",
    ccrs_inventory_external_id: null,
    status: "active",
    on_hand_qty: 10,
    product_name: "OG Kush",
    unit_weight: null,
    unit_weight_uom: null,
    is_medical: false,
    ...over,
  };
}

/** The 3.5g / 7g / 28g shelf from the owner's example, each lot size-linked. */
function ownersShelf() {
  return [
    lotRow({ id: "lot-35", lot_code: "LOT-35-0001", menu_source_variant_id: "v-35" }),
    lotRow({ id: "lot-7", lot_code: "LOT-07-0002", menu_source_variant_id: "v-7" }),
    lotRow({ id: "lot-28", lot_code: "LOT-28-0003", menu_source_variant_id: "v-28" }),
  ];
}

type Bundle = {
  products: PosMenuProduct[];
  barcodes: Record<string, string>;
  barcodeSizes?: Record<string, string[]>;
  barcodeRefusals?: Record<string, string>;
};

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

/** Scan exactly the way SaleFlow.tsx does (tryScan / handleGlobalScan). */
function scan(bundle: Bundle, code: string) {
  return resolveScan(bundle.products, bundle.barcodes, code, {
    sizes: bundle.barcodeSizes,
    refusals: bundle.barcodeRefusals,
  });
}

beforeEach(() => {
  lotRows = [];
  menuItems = [];
  recalledKeys = new Set();
  lotReadFails = false;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the owner's example: scanning a 3.5g bag adds the 3.5g, nothing else", () => {
  it("each size's bag adds ITS OWN size straight to the cart, no size picker", async () => {
    menuItems = [item()];
    lotRows = ownersShelf();
    const bundle = await getBundle();
    expect(bundle.products.map((p) => p.variantId).sort()).toEqual(["v-28", "v-35", "v-7"]);
    for (const [code, want] of [
      ["LOT-35-0001", "v-35"],
      ["LOT-07-0002", "v-7"],
      ["LOT-28-0003", "v-28"],
    ] as const) {
      const r = scan(bundle, code);
      expect(r.status, code).toBe("add");
      if (r.status === "add") expect(r.product.variantId, code).toBe(want);
    }
  });

  it("works from the CCRS external id printed on the package too", async () => {
    menuItems = [item()];
    lotRows = [lotRow({ lot_code: null, ccrs_inventory_external_id: "9988776655", menu_source_variant_id: "v-7" })];
    const bundle = await getBundle();
    const r = scan(bundle, "9988776655");
    expect(r.status).toBe("add");
    if (r.status === "add") expect(r.product.variantId).toBe("v-7");
  });

  it("uses the package weight when the lot has no size link yet", async () => {
    menuItems = [item()];
    lotRows = [
      lotRow({ id: "a", lot_code: "WEIGHT-7G", unit_weight: 7, unit_weight_uom: "g" }),
      lotRow({ id: "b", lot_code: "WEIGHT-1OZ", unit_weight: 1, unit_weight_uom: "oz" }),
    ];
    const bundle = await getBundle();
    const r7 = scan(bundle, "WEIGHT-7G");
    const r28 = scan(bundle, "WEIGHT-1OZ");
    expect(r7.status === "add" && r7.product.variantId).toBe("v-7");
    expect(r28.status === "add" && r28.product.variantId).toBe("v-28");
  });
});

describe("never adds the wrong size", () => {
  it("REFUSES a package whose proven size is not on sale, instead of offering the other sizes", async () => {
    menuItems = [
      item({
        // An importer-hidden card: the register drops its unpriced sizes.
        hidden: true,
        hiddenReason: "no_product_master",
        posInventoryCategory: "Flower",
        variants: [
          { id: "v-35", label: "3.5g", priceMinorUnits: 3500, inventoryLevel: 0, medical: false },
          { id: "v-7", label: "7g", priceMinorUnits: 6000, inventoryLevel: 0, medical: false },
          // No verified price: the register never sells this size.
          { id: "v-28", label: "28g", priceMinorUnits: 0, inventoryLevel: 0, medical: false },
        ],
      } as Partial<GreenwayMenuItem>),
    ];
    lotRows = ownersShelf();
    const bundle = await getBundle();
    expect(bundle.products.map((p) => p.variantId)).not.toContain("v-28");
    const r = scan(bundle, "LOT-28-0003");
    expect(r.status).toBe("refused");
    if (r.status === "refused") expect(r.message).toMatch(/Nothing was added/);
    // The other bags still add their own size.
    const r35 = scan(bundle, "LOT-35-0001");
    expect(r35.status === "add" && r35.product.variantId).toBe("v-35");
  });

  it("one barcode shared by lots of DIFFERENT sizes is never guessed", async () => {
    menuItems = [item()];
    lotRows = [
      lotRow({ id: "a", lot_code: "SHARED-CODE", menu_source_variant_id: "v-35" }),
      lotRow({ id: "b", lot_code: "SHARED-CODE", menu_source_variant_id: "v-7" }),
    ];
    const bundle = await getBundle();
    expect(scan(bundle, "SHARED-CODE").status).not.toBe("add");
  });

  it("an unproven lot still asks (never guesses), and says how to fix it for good", async () => {
    menuItems = [item()];
    lotRows = [lotRow({ lot_code: "NO-EVIDENCE" })];
    const bundle = await getBundle();
    const r = scan(bundle, "NO-EVIDENCE");
    expect(r.status).toBe("pick");
    if (r.status === "pick") {
      expect(r.reason).toBe("unknown_size");
      expect(scanPickPrompt("OG Kush", r.reason)).toMatch(/Which size is this lot\?/);
    }
  });

  it("an OLD cached bundle without the size index keeps the previous behaviour (asks)", async () => {
    menuItems = [item()];
    lotRows = ownersShelf();
    const bundle = await getBundle();
    const r = resolveScan(bundle.products, bundle.barcodes, "LOT-35-0001");
    expect(r.status).toBe("pick");
  });

  it("typing the product (card) key still asks: it names a product, not a package", async () => {
    menuItems = [item()];
    lotRows = ownersShelf();
    const bundle = await getBundle();
    const r = scan(bundle, "KEY-OG");
    expect(r.status).toBe("pick");
    if (r.status === "pick") expect(r.reason).toBe("card");
  });

  it("a recalled card's barcodes add nothing", async () => {
    menuItems = [item()];
    lotRows = ownersShelf();
    recalledKeys = new Set(["KEY-OG"]);
    const bundle = await getBundle();
    expect(scan(bundle, "LOT-35-0001").status).toBe("none");
  });

  it("a failed lot read ships an empty size index, never a broken menu", async () => {
    menuItems = [item()];
    lotRows = ownersShelf();
    lotReadFails = true;
    const bundle = await getBundle();
    expect(bundle.barcodeSizes ?? {}).toEqual({});
    expect(bundle.barcodeRefusals ?? {}).toEqual({});
  });
});
