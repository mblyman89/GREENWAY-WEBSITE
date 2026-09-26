/**
 * Leafly order -> register cart: the EMPTY-CART bug, actually run.
 *
 * Owner report: "When I load the order into the register cart, it loads
 * empty ... a message says something about the item is not on the menu.
 * Our own online orders work fine."
 *
 * Cause (read from the code, not assumed): the register rebuilds a loaded
 * order against its menu bundle by VARIANT id (order-to-cart-core). A Leafly
 * order's local lines were saved with NO product_id / variant_id (bridge
 * insert + L-48 rebuild), so every line was dropped as "no longer on the
 * menu".
 *
 * Everything below runs the REAL loadOrderIntoRegister, the REAL
 * leafly-register-lines-core and the REAL rebuildOrderCart. Only the edges
 * are faked: the database, the order read, audit and loyalty.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rebuildOrderCart, UNMATCHED_LINE_REASON } from "@/lib/pos/order-to-cart-core";
import type { PosMenuProduct } from "@/lib/pos/sale-flow-core";

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));

// ── Database fake: records every leafly_orders read ────────────────────────
let rawOrder: unknown = null;
let leaflyReadError: string | null = null;
const leaflyReads: [string, unknown][][] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const q: Record<string, unknown> = {};
      const self = () => q;
      q.select = self;
      q.eq = (col: string, val: unknown) => {
        filters.push([col, val]);
        return q;
      };
      q.limit = self;
      q.maybeSingle = async () => {
        if (table === "leafly_orders") {
          leaflyReads.push(filters);
          if (leaflyReadError) return { data: null, error: { message: leaflyReadError } };
          return { data: rawOrder === undefined ? null : { raw_order: rawOrder }, error: null };
        }
        // orders.customer_id lookup -> no linked customer.
        return { data: null, error: null };
      };
      return q;
    },
  }),
}));

type Line = { product_id: string | null; variant_id: string | null; product_name: string; variant_label: string | null; quantity: number };
let order: Record<string, unknown> | null = null;
vi.mock("@/lib/orders/orders-store", () => ({
  listOrders: async () => [],
  getOrder: async () => order,
  setOrderStatus: async () => ({ ok: true }),
}));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("@/lib/loyalty/loyalty-store", () => ({ getAccountByCustomer: async () => null, listTiers: async () => [] }));

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

function makeOrder(origin: string, lines: Line[]) {
  return {
    id: ORDER_ID,
    order_number: "GWY-000077",
    status: "acknowledged",
    staff_note: origin === "leafly" ? "Leafly order LF-ABC123 — accepted from Leafly." : null,
    origin,
    customer_first_name: "Jamie",
    customer_last_name: "R",
    customer_note: null,
    lines,
  };
}

/** How the bridge saved Leafly lines BEFORE this fix: no ids at all. */
const legacyLeaflyLines: Line[] = [
  { product_id: null, variant_id: null, product_name: "Blue Dream", variant_label: "3.5g", quantity: 2 },
  { product_id: null, variant_id: null, product_name: "House Pre-roll", variant_label: null, quantity: 1 },
];

/** Leafly's own stored copy (spec CartItemOutgoing field names). */
const leaflyPayload = {
  id: "ord-1",
  status: "confirmed",
  cartItems: [
    { id: "ci-1", name: "Blue Dream", integratorVariantId: "pos-bd-onboarded", packageSize: "3.5", packageUnit: "g", quantity: 2, priceCents: 6000, discountedPriceCents: 6000 },
    { id: "ci-2", name: "House Pre-roll", integratorVariantId: "pos-pr-default", quantity: 1, priceCents: 800, discountedPriceCents: 800 },
  ],
};

const product = (over: Partial<PosMenuProduct>): PosMenuProduct => ({
  productId: "p",
  variantId: "v",
  name: "x",
  brand: null,
  category: "flower",
  categories: ["flower"],
  variantLabel: null,
  regularPriceMinor: 1000,
  costMinorUnits: null,
  inventoryStatus: "in-stock",
  unitsLeft: null,
  strainType: null,
  thc: null,
  cbd: null,
  ...over,
});
/** The register bundle: same variant ids api/pos/menu publishes. */
const bundle: PosMenuProduct[] = [
  product({ productId: "pos-bd", variantId: "pos-bd-onboarded", name: "Blue Dream", variantLabel: "3.5g" }),
  product({ productId: "pos-pr", variantId: "pos-pr-default", name: "House Pre-roll" }),
];

async function load() {
  vi.resetModules();
  const mod = await import("@/lib/pos/pickup-store");
  return mod.loadOrderIntoRegister({ orderId: ORDER_ID, deviceName: "Front iPad", employeeName: "Sam" });
}

beforeEach(() => {
  rawOrder = leaflyPayload;
  leaflyReadError = null;
  leaflyReads.length = 0;
  order = makeOrder("leafly", legacyLeaflyLines);
});

describe("the bug, reproduced against the real rebuild", () => {
  it("lines with no ids (how Leafly orders were saved) all drop -> the empty cart the owner saw", () => {
    const r = rebuildOrderCart(
      legacyLeaflyLines.map((l) => ({ productId: l.product_id, variantId: l.variant_id, productName: l.product_name, quantity: l.quantity })),
      bundle,
    );
    expect(r.cart).toHaveLength(0);
    expect(r.dropped).toHaveLength(2);
  });
  it("...and the message no longer falsely claims the items left the menu", () => {
    const r = rebuildOrderCart([{ productId: null, variantId: null, productName: "Blue Dream", quantity: 1 }], bundle);
    expect(r.dropped[0]).toBe(`Blue Dream (${UNMATCHED_LINE_REASON})`);
    expect(r.dropped[0]).not.toMatch(/no longer on the menu/);
  });
});

describe("loadOrderIntoRegister — Leafly orders", () => {
  it("an EXISTING Leafly order (saved without ids) now loads every item into the cart", async () => {
    const r = await load();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.isMarketplace).toBe(true);
    expect(r.lines).toEqual([
      { productId: null, variantId: "pos-bd-onboarded", productName: "Blue Dream (3.5g)", quantity: 2 },
      { productId: "pos-pr", variantId: "pos-pr-default", productName: "House Pre-roll", quantity: 1 },
    ]);
    const rebuilt = rebuildOrderCart(r.lines, bundle);
    expect(rebuilt.dropped).toEqual([]);
    expect(rebuilt.cart.map((e) => [e.product.variantId, e.quantity])).toEqual([
      ["pos-bd-onboarded", 2],
      ["pos-pr-default", 1],
    ]);
  });

  it("reads Leafly's copy by THIS order's local id (never another order's)", async () => {
    await load();
    expect(leaflyReads).toEqual([[["local_order_id", ORDER_ID]]]);
  });

  it("the webhook envelope shape { order: {...} } loads too", async () => {
    rawOrder = { order: leaflyPayload };
    const r = await load();
    expect(r.ok && r.lines.map((l) => l.variantId)).toEqual(["pos-bd-onboarded", "pos-pr-default"]);
  });

  it("a genuinely vanished product still drops honestly as 'no longer on the menu'", async () => {
    const r = await load();
    if (!r.ok) throw new Error("load failed");
    const rebuilt = rebuildOrderCart(r.lines, [bundle[1]!]);
    expect(rebuilt.cart).toHaveLength(1);
    expect(rebuilt.dropped).toEqual(["Blue Dream (3.5g) (no longer on the menu)"]);
  });

  it("no stored Leafly copy -> falls back to the local lines (never invents)", async () => {
    rawOrder = undefined;
    const r = await load();
    expect(r.ok && r.lines.every((l) => l.variantId === null)).toBe(true);
  });

  it("a Leafly read error -> falls back to the local lines", async () => {
    leaflyReadError = "boom";
    const r = await load();
    expect(r.ok && r.lines.map((l) => l.productName)).toEqual(["Blue Dream (3.5g)", "House Pre-roll"]);
  });

  it("a NEW Leafly order (ids now saved on its lines) loads even with no stored copy", async () => {
    rawOrder = undefined;
    order = makeOrder("leafly", [
      { product_id: null, variant_id: "pos-bd-onboarded", product_name: "Blue Dream", variant_label: "3.5g", quantity: 2 },
    ]);
    const r = await load();
    if (!r.ok) throw new Error("load failed");
    expect(rebuildOrderCart(r.lines, bundle).cart).toHaveLength(1);
  });
});

describe("loadOrderIntoRegister — website orders are unchanged", () => {
  it("uses the order's own lines and never reads leafly_orders", async () => {
    order = makeOrder("greenway", [
      { product_id: "pos-pr", variant_id: "pos-pr-default", product_name: "House Pre-roll", variant_label: null, quantity: 3 },
    ]);
    const r = await load();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.isMarketplace).toBe(false);
    expect(r.lines).toEqual([{ productId: "pos-pr", variantId: "pos-pr-default", productName: "House Pre-roll", quantity: 3 }]);
    expect(leaflyReads).toHaveLength(0);
  });
});

describe("forward fix: new Leafly lines are SAVED with their ids", () => {
  const src = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
  it("the bridge insert writes product_id and variant_id", () => {
    const s = src("src/lib/leafly/bridge-server.ts");
    const at = s.indexOf('.from("order_lines")');
    const block = s.slice(at, at + 900);
    expect(block).toContain("product_id: l.productId");
    expect(block).toContain("variant_id: l.variantId");
  });
  it("the L-48 rebuild insert writes product_id and variant_id", () => {
    const s = src("src/lib/leafly/order-cart-server.ts");
    const at = s.indexOf(".insert(\n        d.lines.map");
    expect(at).toBeGreaterThan(0);
    const block = s.slice(at, at + 700);
    expect(block).toContain("product_id: l.productId");
    expect(block).toContain("variant_id: l.variantId");
  });
  it("the real draft reader carries integratorVariantId onto every line", async () => {
    const { readLeaflyOrderPayload } = await import("@/lib/leafly/bridge-core");
    const d = readLeaflyOrderPayload({ ...leaflyPayload, subtotal: 6800, total: 6800, taxes: [] });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.draft.lines.map((l) => [l.variantId, l.productId])).toEqual([
      ["pos-bd-onboarded", null],
      ["pos-pr-default", "pos-pr"],
    ]);
  });
});
