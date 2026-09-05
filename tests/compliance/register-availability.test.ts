/**
 * tests/compliance/register-availability.test.ts   (SLICE 16)
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT THESE TESTS ARE FOR
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Owner report, verbatim: "in the register app, I have been trying to scan
 * things that are showing up in the back office inventory page, but shows as
 * unavailable for sale on the register ... but I found some products that do
 * appear in the register side and do work to add them to the cart when
 * scanned."
 *
 * THE PROVEN CAUSE: two stock counters that only sales and voids keep in
 * step. The back office reads `inventory_lots.on_hand_qty`; the register
 * reads `menu_variants.inventory_level` rolled into
 * `menu_items.inventory_status` on the published snapshot. A cycle count, a
 * disposition reversal or an intake adjustment moves the first and leaves the
 * second frozen — and a frozen 0 cascades all the way to
 * `Barcode "X" matched nothing on the menu`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * HOW THESE TESTS ARE BUILT  (the SLICE 14 lesson, applied)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * A test that greps source text proves only that a string exists. It cannot
 * fail when the behaviour breaks, which is the only time a test is worth
 * anything. So NOTHING here matches on file contents.
 *
 * Instead these tests DRIVE THE REAL `GET /api/pos/menu` HANDLER against a
 * fake Supabase and a fake published menu, and assert on the BUNDLE THE
 * REGISTER WOULD ACTUALLY RECEIVE — which products it can ring, which
 * barcodes resolve, and what a scan does. Every fix below was additionally
 * mutation-verified: the fix was re-broken by hand and these tests were
 * confirmed to go RED.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  reconcileRegisterAvailability,
  diagnoseLot,
  summarizeSellability,
  indexLiveStock,
  type LiveLotFact,
  type SnapshotCard,
} from "@/lib/pos/register-availability-core";
import { resolveScan } from "@/lib/pos/scan-to-cart-core";

// ───────────────────────────────────────────────────────────────────────────
// The fake world the real route runs against.
// ───────────────────────────────────────────────────────────────────────────

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

// ═══════════════════════════════════════════════════════════════════════════
describe("SLICE 16 — the owner's defect, end to end through the real route", () => {
  it("sells a product whose published status went stale while the lot has stock", async () => {
    // EXACTLY the owner's situation: the back office shows 12 on hand, the
    // published snapshot still says "unavailable" because a cycle count moved
    // on_hand_qty and never touched inventory_level.
    menuItems = [item()];
    lotRows = [lotRow()];

    const bundle = await getBundle();

    // BEFORE this slice this array was EMPTY — the product simply did not
    // exist as far as the register was concerned.
    expect(bundle.products.map((p) => p.productId)).toContain("KEY-A");
  });

  it("ships the restored card with a SELLABLE status, not the stale one", async () => {
    // If the card arrived still labelled "unavailable" it would be dropped
    // again downstream by order-to-cart-core.ts:75 and
    // register-polish-core.ts:165 — fixed in one place, broken in two others.
    menuItems = [item()];
    lotRows = [lotRow({ on_hand_qty: 12 })];

    const bundle = await getBundle();
    const p = bundle.products.find((x) => x.productId === "KEY-A");

    expect(p?.inventoryStatus).toBe("in-stock");
    expect(p?.inventoryStatus).not.toBe("unavailable");
  });

  it("reports low-stock honestly when only a few units remain", async () => {
    menuItems = [item()];
    lotRows = [lotRow({ on_hand_qty: 2 })];

    const bundle = await getBundle();

    expect(bundle.products[0]?.inventoryStatus).toBe("low-stock");
  });

  it("never paints a fake '0 left' badge on a restored card", async () => {
    // The restored card's cached variant levels are stale BY DEFINITION —
    // that staleness is why it was wrongly unavailable. Shipping them would
    // put "0 left" on a product with twelve units on the shelf. null means
    // "unknown", which the B32 badge already handles.
    menuItems = [
      item({
        variants: [
          { id: "KEY-A-onboarded", label: "3.5g", priceMinorUnits: 4000, inventoryLevel: 0, medical: false },
        ],
      }),
    ];
    lotRows = [lotRow({ on_hand_qty: 12 })];

    const bundle = await getBundle();

    expect(bundle.products[0]?.unitsLeft).toBeNull();
  });

  it("THE SCAN NOW WORKS: the restored product's barcode resolves to the cart", async () => {
    // This is the owner's actual physical action — scanning the package.
    // The barcode index is built only from SELLABLE keys, so while the card
    // was excluded its barcode was dropped too and the scan hit nothing.
    menuItems = [item()];
    lotRows = [lotRow({ lot_code: "LOTCODE-1111", on_hand_qty: 12 })];

    const bundle = await getBundle();

    expect(bundle.barcodes["lotcode-1111"]).toBe("KEY-A");

    // Drive the REAL on-device resolver the register uses.
    const resolved = resolveScan(
      bundle.products as never,
      bundle.barcodes,
      "LOTCODE-1111",
    );
    expect(resolved.status).toBe("add");
  });

  it("reproduces the owner's 'some work, some do not' pattern and fixes only the broken half", async () => {
    // Two products. One has live stock (was wrongly dead). One genuinely has
    // none. A correct fix rescues the first and leaves the second alone.
    menuItems = [
      item({ id: "HAS-STOCK" }),
      item({ id: "TRULY-EMPTY" }),
    ];
    lotRows = [
      lotRow({ id: "l1", pos_product_key: "HAS-STOCK", lot_code: "AAAA-1111", on_hand_qty: 9 }),
      lotRow({ id: "l2", pos_product_key: "TRULY-EMPTY", lot_code: "BBBB-2222", on_hand_qty: 0 }),
    ];

    const bundle = await getBundle();
    const ids = bundle.products.map((p) => p.productId);

    expect(ids).toContain("HAS-STOCK");
    expect(ids).not.toContain("TRULY-EMPTY");
    // And the empty product's barcode must NOT become scannable.
    expect(bundle.barcodes["bbbb-2222"]).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("SLICE 16 — compliance gates are never widened", () => {
  it("keeps a RECALLED product off the register even with stock on hand", async () => {
    // A recall expects to find stock. Finding some is not permission to sell.
    menuItems = [item({ inventoryStatus: "in-stock" })];
    lotRows = [lotRow({ on_hand_qty: 500 })];
    recalledKeys = new Set(["KEY-A"]);

    const bundle = await getBundle();

    expect(bundle.products.map((p) => p.productId)).not.toContain("KEY-A");
    expect(Object.values(bundle.barcodes)).not.toContain("KEY-A");
  });

  it("keeps a recalled LOT's size off a mastered card", async () => {
    menuItems = [
      item({
        inventoryStatus: "in-stock",
        variants: [
          { id: "LOT-OK-onboarded", label: "1g", priceMinorUnits: 1200, inventoryLevel: 5, medical: false },
          { id: "LOT-BAD-onboarded", label: "3.5g", priceMinorUnits: 3500, inventoryLevel: 5, medical: false },
        ],
      }),
    ];
    lotRows = [lotRow({ on_hand_qty: 10 })];
    recalledKeys = new Set(["LOT-BAD"]);

    const bundle = await getBundle();
    const variantIds = bundle.products.map((p) => p.variantId);

    expect(variantIds).toContain("LOT-OK-onboarded");
    expect(variantIds).not.toContain("LOT-BAD-onboarded");
  });

  it("keeps a HIDDEN product off the register even with stock on hand", async () => {
    // `hidden` is a human's decision (or a reviewer rejection). Stock is not
    // permission to overrule a person.
    menuItems = [item({ hidden: true, inventoryStatus: "in-stock" })];
    lotRows = [lotRow({ on_hand_qty: 99 })];

    const bundle = await getBundle();

    expect(bundle.products).toHaveLength(0);
  });

  it("does not treat quarantined, recalled, destroyed or sold_out lots as stock", async () => {
    for (const status of ["quarantine", "recalled", "destroyed", "sold_out"]) {
      menuItems = [item()];
      lotRows = [lotRow({ status })];

      const bundle = await getBundle();

      expect(bundle.products, `lot status ${status} must not resurrect a card`).toHaveLength(0);
    }
  });

  it("does not resurrect a card from a lot with no units on hand", async () => {
    menuItems = [item()];
    lotRows = [lotRow({ on_hand_qty: 0 })];

    const bundle = await getBundle();

    expect(bundle.products).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("SLICE 16 — the one-way invariant: this can only ADD availability", () => {
  it("never removes a product that the published snapshot already sold", async () => {
    // The riskiest possible regression: a 'fix' that starts HIDING products.
    // Merch and non-cannabis SKUs have no lot rows at all, so 'no lots found'
    // must mean 'no evidence', never 'no stock'.
    for (const lots of [
      [] as Record<string, unknown>[],
      [lotRow({ on_hand_qty: 0 })],
      [lotRow({ status: "destroyed" })],
      [lotRow({ pos_product_key: null })],
    ]) {
      menuItems = [item({ inventoryStatus: "in-stock" })];
      lotRows = lots;

      const bundle = await getBundle();

      expect(
        bundle.products.map((p) => p.productId),
        "an already-sellable card must survive any lot data",
      ).toContain("KEY-A");
    }
  });

  it("leaves an already-sellable card's real unit counts intact", async () => {
    // Only RESTORED cards get null units. An untouched card must keep the
    // honest count it already had, or every low-stock badge would disappear.
    menuItems = [
      item({
        inventoryStatus: "in-stock",
        variants: [
          { id: "v1", label: "3.5g", priceMinorUnits: 4000, inventoryLevel: 7, medical: false },
        ],
      }),
    ];
    lotRows = [lotRow()];

    const bundle = await getBundle();

    expect(bundle.products[0]?.unitsLeft).toBe(7);
  });

  it("degrades safely when the lot read fails entirely", async () => {
    // Best-effort contract: a database hiccup must never blank the register.
    menuItems = [item({ inventoryStatus: "in-stock" })];
    lotRows = [lotRow()];
    lotReadFails = true;

    const bundle = await getBundle();

    expect(bundle.products.map((p) => p.productId)).toContain("KEY-A");
    expect(bundle.barcodes).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("SLICE 16 — the 1,000-row cap that hid lots past the first page", () => {
  it("restores a product whose lot sits far beyond PostgREST's 1,000-row ceiling", async () => {
    // `inventory_lots` is the biggest table in the system (SLICE 3 proved
    // 4,179 rows). A read that does not page would never see this lot, and
    // the product would stay dead with no error anywhere to explain it.
    const filler = Array.from({ length: 2500 }, (_, i) => ({
      ...lotRow(),
      id: `filler-${String(i).padStart(5, "0")}`,
      pos_product_key: `FILLER-${i}`,
      lot_code: `FILL-${i}`,
    }));
    lotRows = [
      ...filler,
      lotRow({ id: "zzz-target", pos_product_key: "KEY-A", lot_code: "DEEP-9999", on_hand_qty: 6 }),
    ];
    menuItems = [item()];

    const bundle = await getBundle();

    expect(bundle.products.map((p) => p.productId)).toContain("KEY-A");
    expect(bundle.barcodes["deep-9999"]).toBe("KEY-A");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("SLICE 16 — the pure core's own guarantees", () => {
  const card = (over: Partial<SnapshotCard> = {}): SnapshotCard => ({
    productId: "KEY-A",
    lotKeys: ["KEY-A"],
    inventoryStatus: "unavailable",
    hidden: false,
    recalled: false,
    ...over,
  });
  const lot = (over: Partial<LiveLotFact> = {}): LiveLotFact => ({
    id: "l1",
    posProductKey: "KEY-A",
    status: "active",
    onHandQty: 10,
    ...over,
  });

  it("counts only active, stocked lots as sellable stock", () => {
    const idx = indexLiveStock([
      lot({ id: "a", onHandQty: 5 }),
      lot({ id: "b", onHandQty: 0 }),
      lot({ id: "c", status: "quarantine", onHandQty: 100 }),
      lot({ id: "d", posProductKey: null, onHandQty: 100 }),
    ]);
    expect(idx.get("KEY-A")).toBe(5);
  });

  it("tolerates PostgREST returning numeric columns as strings", () => {
    // A real, boring production failure mode: `numeric` arrives as "12.5".
    // Treating that as 0 would silently defeat the entire fix.
    const r = reconcileRegisterAvailability({
      cards: [card()],
      lots: [lot({ onHandQty: "12.5" as unknown as number })],
    });
    expect(r.cards[0].sellable).toBe(true);
    expect(r.cards[0].liveUnits).toBe(12.5);
  });

  it("distinguishes 'no stock' from 'no evidence' — they are not the same fact", () => {
    const noStock = reconcileRegisterAvailability({ cards: [card()], lots: [lot({ onHandQty: 0 })] });
    expect(noStock.cards[0].reason).toBe("no_live_stock");

    const noEvidence = reconcileRegisterAvailability({ cards: [card()], lots: [] });
    expect(noEvidence.cards[0].reason).toBe("no_lot_evidence");
  });

  it("explains every blocked lot in language the owner can act on", () => {
    const cards = new Map<string, SnapshotCard>([["KEY-A", card({ inventoryStatus: "in-stock" })]]);

    const unlinked = diagnoseLot(lot({ posProductKey: null }), cards);
    expect(unlinked.code).toBe("no_product_link");
    expect(unlinked.fix).toBeTruthy();

    const ghost = diagnoseLot(lot({ posProductKey: "GHOST" }), cards);
    expect(ghost.code).toBe("no_menu_card");
    expect(ghost.fix).toBeTruthy();
  });

  it("does not nag about empty lots — only about stock that cannot be sold", () => {
    const cards = new Map<string, SnapshotCard>([["KEY-A", card({ inventoryStatus: "in-stock" })]]);
    const s = summarizeSellability([
      diagnoseLot(lot({ id: "1", onHandQty: 0 }), cards),
      diagnoseLot(lot({ id: "2" }), cards),
    ]);
    expect(s.blocked).toBe(0);
    expect(s.headline).toBeNull();
  });

  it("headlines real blockage with counts the owner can verify", () => {
    const cards = new Map<string, SnapshotCard>([["KEY-A", card({ inventoryStatus: "in-stock" })]]);
    const s = summarizeSellability([
      diagnoseLot(lot({ id: "1", posProductKey: null }), cards),
      diagnoseLot(lot({ id: "2", posProductKey: "GHOST" }), cards),
    ]);
    expect(s.blocked).toBe(2);
    expect(s.headline).toContain("2 lots");
  });
});
