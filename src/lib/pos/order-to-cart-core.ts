/**
 * src/lib/pos/order-to-cart-core.ts  (Task AM-D)
 *
 * PURE logic for loading a WEBSITE ORDER into the register cart ("the
 * customer is here — pull their online order up and add to it"). No
 * `server-only`, no DB — safe for the tsx self-test harness and vitest.
 *
 * Why the register re-rings instead of completing the order as-is (B28):
 * the owner wants to ADD items when the customer arrives. A register sale
 * is its own payload → its own materialized order at sync, so the website
 * order MUST be superseded (cancelled with a loud note) the moment it is
 * loaded — otherwise both could complete: double inventory decrement,
 * double loyalty accrual, two CCRS sales. The server does the supersede
 * (pickup-store); this module only rebuilds the cart lines against the
 * CURRENT menu bundle, exactly like a resumed hold (register-polish-core):
 * fresh prices from the live promotion engine, vanished/out-of-stock lines
 * dropped AND reported, quantities clamped.
 *
 * Variant matching: website cart lines carry the SAME variant ids the POS
 * menu bundle publishes — real variant uuids, or the synthetic
 * `${productId}-default` id both sides derive for single-price items
 * (ProductCardPriceSelector / api/pos/menu). Legacy lines with a null
 * variant_id fall back to that synthetic default key.
 *
 * Money in MINOR UNITS (cents) everywhere — though nothing here touches
 * money: the register reprices every line from the live bundle. The
 * website order's prices are advisory history, not a pricing source.
 */
import { MAX_LINE_QUANTITY, type PosCartEntry, type PosMenuProduct } from "./sale-flow-core";

// ---------------------------------------------------------------------------
// Rebuild
// ---------------------------------------------------------------------------

/** One order line as the load endpoint returns it (ids + display facts). */
export type LoadedOrderLine = {
  productId: string | null;
  variantId: string | null;
  productName: string;
  quantity: number;
};

/** Why a line with NO product/variant id was dropped (shown to staff). */
export const UNMATCHED_LINE_REASON = "not linked to a menu item - add it by hand";

export type RebuiltOrderCart = {
  /** Lines matched to the CURRENT bundle (fresh prices/promotions apply). */
  cart: PosCartEntry[];
  /** Product names that could not be restored, with why (shown to staff). */
  dropped: string[];
};

/**
 * Rebuild a website order's lines against the CURRENT menu bundle. Items
 * that vanished from the menu or went unavailable are dropped and reported —
 * a loaded order can never resurrect a product the store can no longer
 * sell. Duplicate lines for the same variant merge; quantities clamp to the
 * same MAX_LINE_QUANTITY the live cart enforces.
 */
export function rebuildOrderCart(lines: LoadedOrderLine[], products: PosMenuProduct[]): RebuiltOrderCart {
  const byVariant = new Map(products.map((p) => [p.variantId, p]));
  const cart: PosCartEntry[] = [];
  const dropped: string[] = [];

  for (const line of lines) {
    const quantity = Math.floor(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    // Real variant id first; legacy null falls back to the synthetic default
    // key both the website cart and the POS bundle derive for single-price
    // items.
    const key = line.variantId ?? (line.productId ? `${line.productId}-default` : null);
    if (!key) {
      // No id at all: the line cannot be looked up, which is NOT the same as
      // "no longer on the menu" - saying so sent the owner checking a menu
      // that was fine (Leafly empty-cart bug). Say what is actually true.
      dropped.push(`${line.productName} (${UNMATCHED_LINE_REASON})`);
      continue;
    }
    const product = byVariant.get(key);
    if (!product) {
      dropped.push(`${line.productName} (no longer on the menu)`);
      continue;
    }
    if (product.inventoryStatus === "unavailable") {
      dropped.push(`${product.name} (out of stock)`);
      continue;
    }

    const existing = cart.find((e) => e.product.variantId === product.variantId);
    if (existing) {
      existing.quantity = Math.min(MAX_LINE_QUANTITY, existing.quantity + quantity);
    } else {
      cart.push({ product, quantity: Math.min(MAX_LINE_QUANTITY, quantity) });
    }
  }

  return { cart, dropped };
}

// ---------------------------------------------------------------------------
// Supersede note (single writing so the order timeline reads consistently)
// ---------------------------------------------------------------------------

/**
 * The order_events note the supersede-cancel writes. States WHY loudly:
 * this order must never be fulfilled separately once its items ride a
 * register sale.
 */
export function supersedeNote(deviceName: string, employeeName: string): string {
  return (
    `SUPERSEDED — loaded into a register sale at ${deviceName} by ${employeeName}. ` +
    `The items are being rung at the register (fresh pricing; more items may be added); ` +
    `this website order must NOT be fulfilled separately.`
  );
}

// ---------------------------------------------------------------------------
// Embedded self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runOrderToCartCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  const product = (over: Partial<PosMenuProduct>): PosMenuProduct => ({
    productId: "p1",
    variantId: "v1",
    name: "Blue Dream 3.5g",
    brand: null,
    category: "flower",
    categories: ["flower"],
    variantLabel: "3.5g",
    regularPriceMinor: 3500,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
    unitsLeft: null,
    strainType: null,
    thc: null,
    cbd: null,
    ...over,
  });

  const menu = [
    product({}),
    product({ productId: "p2", variantId: "p2-default", name: "Preroll Single", variantLabel: null }),
    product({ productId: "p3", variantId: "v3", name: "Gone Gummies", inventoryStatus: "unavailable" }),
  ];

  // -- happy path: real variant id matches, price comes from the bundle ------
  const r1 = rebuildOrderCart(
    [{ productId: "p1", variantId: "v1", productName: "Blue Dream 3.5g", quantity: 2 }],
    menu,
  );
  ok(r1.cart.length === 1 && r1.cart[0].quantity === 2 && r1.cart[0].product.variantId === "v1", "real variant id matches");
  ok(r1.dropped.length === 0, "nothing dropped on the happy path");

  // -- legacy null variant id falls back to the synthetic default key --------
  const r2 = rebuildOrderCart(
    [{ productId: "p2", variantId: null, productName: "Preroll Single", quantity: 1 }],
    menu,
  );
  ok(r2.cart.length === 1 && r2.cart[0].product.variantId === "p2-default", "null variant id → synthetic default key");

  // -- vanished and unavailable lines drop with a reason ---------------------
  const r3 = rebuildOrderCart(
    [
      { productId: "px", variantId: "vx", productName: "Discontinued Bar", quantity: 1 },
      { productId: "p3", variantId: "v3", productName: "Gone Gummies", quantity: 1 },
    ],
    menu,
  );
  ok(r3.cart.length === 0 && r3.dropped.length === 2, "vanished + unavailable both dropped");
  ok(r3.dropped[0].includes("no longer on the menu"), "vanished reason named");
  ok(r3.dropped[1].includes("out of stock"), "unavailable reason named");

  // -- null productId AND null variantId can never match ---------------------
  const r4 = rebuildOrderCart([{ productId: null, variantId: null, productName: "Mystery", quantity: 1 }], menu);
  ok(r4.cart.length === 0 && r4.dropped.length === 1, "no ids → dropped, never a guess");
  ok(r4.dropped[0] === `Mystery (${UNMATCHED_LINE_REASON})`, "no ids → honest reason, not 'no longer on the menu'");
  ok(!r4.dropped[0].includes("no longer on the menu"), "no ids never claims the item left the menu");

  // -- duplicate lines merge; quantities clamp -------------------------------
  const r5 = rebuildOrderCart(
    [
      { productId: "p1", variantId: "v1", productName: "Blue Dream 3.5g", quantity: 60 },
      { productId: "p1", variantId: "v1", productName: "Blue Dream 3.5g", quantity: 60 },
    ],
    menu,
  );
  ok(r5.cart.length === 1 && r5.cart[0].quantity === MAX_LINE_QUANTITY, "duplicates merge and clamp to MAX_LINE_QUANTITY");

  // -- zero/negative/fractional quantities are skipped, never dropped noise --
  const r6 = rebuildOrderCart(
    [
      { productId: "p1", variantId: "v1", productName: "Blue Dream 3.5g", quantity: 0 },
      { productId: "p1", variantId: "v1", productName: "Blue Dream 3.5g", quantity: -3 },
      { productId: "p1", variantId: "v1", productName: "Blue Dream 3.5g", quantity: 1.9 },
    ],
    menu,
  );
  ok(r6.cart.length === 1 && r6.cart[0].quantity === 1 && r6.dropped.length === 0, "bad quantities skipped; 1.9 floors to 1");

  // -- supersede note names device, employee, and the no-double-fulfill rule -
  const note = supersedeNote("Front iPad", "Casey");
  ok(note.includes("SUPERSEDED") && note.includes("Front iPad") && note.includes("Casey"), "note names who/where");
  ok(note.includes("NOT be fulfilled separately"), "note forbids double fulfillment");

  if (fail > 0) throw new Error(`order-to-cart-core self-tests: ${fail} FAILED (${pass} passed)`);
  console.log(`order-to-cart-core self-tests: ALL PASS (${pass} assertions)`);
}
