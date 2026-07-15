/**
 * POS Slice B43 — out-of-stock quick-flag (pure core).
 *
 * Toast's "Quick Edit / 86 it" from the register: the budtender sees the
 * shelf is empty but the menu still shows the item, taps "Mark out of
 * stock", and the item leaves EVERY register's menu and the website —
 * without walking to the back office.
 *
 * Design decisions (verified against this codebase, not guessed):
 *  - ONE-WAY at the register: flags can only take an item OUT. Bringing it
 *    back means stock arrived, and stock arrives through the back office
 *    (intake/receiving) — a register can kill a phantom listing but can
 *    never invent inventory.
 *  - The server flips menu_items.inventory_status → "unavailable" on the
 *    PUBLISHED version — the SAME field the B19 sale-decrement writes when
 *    a decrement empties an item, so every downstream consumer (POS menu
 *    route excludes unavailable; website card gating) already honors it.
 *  - ONLINE-ONLY + audited: an offline register can't change the shared
 *    menu, and every flag records who/what/when.
 *  - Optimistic local apply: the register removes the item from its OWN
 *    cached bundle immediately (mirroring the menu route's exclusion of
 *    unavailable items) so the tile disappears without waiting for the
 *    next full refresh.
 *
 * Pure: no I/O, no React. Self-tested below (registered in
 * scripts/compliance/run-pure-selftests.ts) and mirrored in vitest.
 */

import type { PosMenuBundle, PosMenuProduct } from "./sale-flow-core";

/** Reasons the register offers (audit context; free text deliberately not allowed — fast taps, clean reports). */
export const STOCK_FLAG_REASONS = ["shelf empty", "damaged / unsellable", "wrong listing"] as const;
export type StockFlagReason = (typeof STOCK_FLAG_REASONS)[number];

export function isStockFlagReason(v: unknown): v is StockFlagReason {
  return typeof v === "string" && (STOCK_FLAG_REASONS as readonly string[]).includes(v);
}

export type StockFlagRequest = {
  productId: string;
  reason: StockFlagReason;
};

/**
 * Validate an untrusted flag request (register form or API body). Returns
 * the normalized request or an error string — never throws.
 */
export function validateStockFlag(raw: unknown): { ok: true; request: StockFlagRequest } | { ok: false; error: string } {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const o = raw as Record<string, unknown>;
  const productId = typeof o.productId === "string" ? o.productId.trim() : "";
  if (!productId) return { ok: false, error: "productId is required." };
  if (!isStockFlagReason(o.reason)) {
    return { ok: false, error: `reason must be one of: ${STOCK_FLAG_REASONS.join(", ")}.` };
  }
  return { ok: true, request: { productId, reason: o.reason } };
}

/**
 * Optimistic local apply: remove EVERY variant of the flagged product from
 * the cached bundle — exactly what the next menu download would do (the
 * menu route skips unavailable items). Returns a NEW bundle (React state
 * identity); unknown productId returns the products unchanged.
 */
export function applyLocalStockFlag(bundle: PosMenuBundle, productId: string): PosMenuBundle {
  const id = productId.trim();
  if (!id) return { ...bundle };
  return { ...bundle, products: bundle.products.filter((p) => p.productId !== id) };
}

/**
 * Can this product be flagged from the register? One-way: anything the
 * register can still see is flaggable (the bundle never contains
 * unavailable items) — EXCEPT B39 keypad lines, which aren't catalog
 * products at all.
 */
export function canFlagOutOfStock(product: Pick<PosMenuProduct, "productId">): boolean {
  return !product.productId.startsWith("pos-custom-");
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runStockFlagCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  // validateStockFlag
  ok(!validateStockFlag(null).ok, "null body rejected");
  ok(!validateStockFlag("x").ok, "string body rejected");
  ok(!validateStockFlag([]).ok, "array body rejected");
  ok(!validateStockFlag({}).ok, "missing productId rejected");
  ok(!validateStockFlag({ productId: "  " , reason: "shelf empty" }).ok, "blank productId rejected");
  ok(!validateStockFlag({ productId: "p1" }).ok, "missing reason rejected");
  ok(!validateStockFlag({ productId: "p1", reason: "because" }).ok, "free-text reason rejected");
  const good = validateStockFlag({ productId: " p1 ", reason: "shelf empty" });
  ok(good.ok && good.request.productId === "p1" && good.request.reason === "shelf empty", "good request normalized (id trimmed)");
  for (const r of STOCK_FLAG_REASONS) {
    ok(validateStockFlag({ productId: "p1", reason: r }).ok, `reason "${r}" accepted`);
  }

  // applyLocalStockFlag
  const product = (productId: string, variantId: string): PosMenuProduct => ({
    productId,
    variantId,
    name: productId,
    brand: null,
    category: "flower",
    categories: ["flower"],
    variantLabel: null,
    regularPriceMinor: 1000,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
  });
  const bundle = {
    products: [product("p1", "v1"), product("p1", "v2"), product("p2", "v3")],
    rules: [],
    limits: { enforce: true, hardBlock: true, rec: {}, med: {}, unitGrams: {} },
    hours: { openHour: 8, closeHour: 23 },
    fetchedAt: "2026-01-01T00:00:00Z",
  } as unknown as PosMenuBundle;
  const after = applyLocalStockFlag(bundle, "p1");
  ok(after.products.length === 1 && after.products[0].productId === "p2", "flag removes EVERY variant of the product");
  ok(bundle.products.length === 3, "original bundle not mutated");
  ok(after !== bundle, "new bundle identity");
  ok(applyLocalStockFlag(bundle, "missing").products.length === 3, "unknown productId leaves products unchanged");
  ok(applyLocalStockFlag(bundle, "  ").products.length === 3, "blank productId leaves products unchanged");
  ok(applyLocalStockFlag(bundle, "p1").fetchedAt === bundle.fetchedAt, "bundle metadata carried over");

  // canFlagOutOfStock
  ok(canFlagOutOfStock({ productId: "prod-1" }) === true, "catalog product flaggable");
  ok(canFlagOutOfStock({ productId: "pos-custom-abc" }) === false, "B39 keypad line never flaggable");

  console.log(`stock-flag-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`stock-flag-core self-tests failed: ${failures.join("; ")}`);
  }
}
