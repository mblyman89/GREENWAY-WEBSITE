/**
 * src/lib/pos/low-stock-core.ts
 *
 * PURE low-stock signaling for the register (Slice B32). No I/O, no React —
 * safe for the tsx self-test harness and vitest.
 *
 * Ground truth (verified, never guessed):
 *  - `inventoryStatus` is ITEM-level, set by the menu transform:
 *    level <= 0 → "unavailable", <= 3 → "low-stock", else "in-stock"
 *    (src/lib/pos/transform.ts statusForInventory). Unavailable items never
 *    reach the bundle (menu route filters them).
 *  - `unitsLeft` is the VARIANT-level count shipped in the bundle from the
 *    published menu's variant.inventoryLevel. It is null for items sold at
 *    the item price without explicit variants (their synthetic variant has
 *    no real count) and undefined on bundles cached before B32 — both are
 *    treated as "unknown", falling back to the item-level status.
 *
 * Register discipline: warnings only, NEVER blocks. The cached menu can be
 * stale, and the authoritative inventory decrement (B19) plus the server
 * completion gate run at sync. A budtender holding the last jar knows more
 * than a cached count — the register informs, the human decides.
 */

/** How the register flags a product tile / cart line. */
export type StockSignal = {
  severity: "low" | "last-units";
  /** Short badge text: "LOW STOCK", "2 LEFT", "LAST ONE". */
  badge: string;
};

const LAST_UNITS_THRESHOLD = 3; // variant-level: "N LEFT" badges kick in

/**
 * Compute the stock signal for a product tile. Precedence: an exact
 * variant-level count (when known) beats the item-level status. Returns
 * null when the product doesn't warrant a flag.
 */
export function stockSignal(
  inventoryStatus: "in-stock" | "low-stock" | "unavailable",
  unitsLeft: number | null | undefined,
): StockSignal | null {
  if (typeof unitsLeft === "number" && Number.isInteger(unitsLeft) && unitsLeft >= 0) {
    if (unitsLeft === 0) {
      // Variant shows zero but the ITEM is still sellable (another variant
      // carries the stock, or the count lags). Flag hard, never hide.
      return { severity: "last-units", badge: "MAY BE OUT" };
    }
    if (unitsLeft === 1) return { severity: "last-units", badge: "LAST ONE" };
    if (unitsLeft <= LAST_UNITS_THRESHOLD) {
      return { severity: "last-units", badge: `${unitsLeft} LEFT` };
    }
    // A healthy variant count clears the item-level flag: the item may be
    // "low" overall while THIS variant has plenty.
    return null;
  }
  if (inventoryStatus === "low-stock") return { severity: "low", badge: "LOW STOCK" };
  return null;
}

/** A cart line's stock facts, as the warning builder needs them. */
export type CartStockLine = {
  productName: string;
  variantLabel: string | null;
  quantity: number;
  inventoryStatus: "in-stock" | "low-stock" | "unavailable";
  unitsLeft: number | null | undefined;
};

/**
 * Cart-level awareness: name every line whose quantity meets or exceeds
 * what the cached menu says is left. Warnings only — checkout is never
 * blocked (the cache can be stale; B19 + the completion gate are the
 * authority at sync).
 */
export function cartStockWarnings(lines: CartStockLine[]): string[] {
  const warnings: string[] = [];
  for (const line of lines) {
    if (typeof line.unitsLeft !== "number" || !Number.isInteger(line.unitsLeft) || line.unitsLeft < 0) {
      continue; // unknown count — the tile-level badge already covers it
    }
    const label = line.variantLabel ? `${line.productName} · ${line.variantLabel}` : line.productName;
    if (line.quantity > line.unitsLeft) {
      warnings.push(
        `${label}: cart has ${line.quantity}, menu shows only ${line.unitsLeft} left — check the shelf before promising.`,
      );
    } else if (line.quantity === line.unitsLeft) {
      warnings.push(`${label}: this takes the last ${line.unitsLeft === 1 ? "one" : `${line.unitsLeft}`} in stock.`);
    }
  }
  return warnings;
}

/**
 * Count the distinct low/last-units products in a bundle — the home-screen
 * heads-up number ("6 items running low"). Counts PRODUCTS (variant rows
 * collapse by productId) so one flower item with three low variants is one
 * item to restock, not three.
 */
export function lowStockCount(
  products: {
    productId: string;
    inventoryStatus: "in-stock" | "low-stock" | "unavailable";
    unitsLeft?: number | null;
  }[],
): number {
  const flagged = new Set<string>();
  for (const p of products) {
    if (stockSignal(p.inventoryStatus, p.unitsLeft) !== null) flagged.add(p.productId);
  }
  return flagged.size;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runLowStockCoreTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) {
      console.log("FAIL:", msg);
      throw new Error(`low-stock-core self-test failed: ${msg}`);
    }
    pass += 1;
  };

  // stockSignal — variant counts beat item status
  ok(stockSignal("in-stock", 1)?.badge === "LAST ONE", "1 left → LAST ONE");
  ok(stockSignal("in-stock", 2)?.badge === "2 LEFT", "2 left → 2 LEFT");
  ok(stockSignal("in-stock", 3)?.badge === "3 LEFT", "3 left → 3 LEFT");
  ok(stockSignal("in-stock", 4) === null, "4 left → no flag");
  ok(stockSignal("in-stock", 0)?.badge === "MAY BE OUT", "0 left on a sellable item → MAY BE OUT (flag, never hide)");
  ok(stockSignal("low-stock", 10) === null, "healthy variant count clears the item-level low flag");
  ok(stockSignal("low-stock", 2)?.severity === "last-units", "low item + known count → count wins");

  // stockSignal — unknown counts fall back to item status
  ok(stockSignal("low-stock", null)?.badge === "LOW STOCK", "low item, unknown count → LOW STOCK");
  ok(stockSignal("low-stock", undefined)?.badge === "LOW STOCK", "pre-B32 cached bundle (undefined) → LOW STOCK");
  ok(stockSignal("in-stock", null) === null, "in-stock, unknown count → no flag");
  ok(stockSignal("low-stock", -1)?.badge === "LOW STOCK", "negative count treated as unknown");
  ok(stockSignal("low-stock", 2.5)?.badge === "LOW STOCK", "fractional count treated as unknown");

  // cartStockWarnings
  const warn1 = cartStockWarnings([
    { productName: "Blue Dream 3.5g", variantLabel: null, quantity: 3, inventoryStatus: "low-stock", unitsLeft: 2 },
  ]);
  ok(warn1.length === 1 && warn1[0].includes("cart has 3") && warn1[0].includes("only 2 left"), "over-cache quantity named");
  const warn2 = cartStockWarnings([
    { productName: "Sour Gummies", variantLabel: "10pk", quantity: 2, inventoryStatus: "in-stock", unitsLeft: 2 },
  ]);
  ok(warn2.length === 1 && warn2[0].includes("last 2"), "taking the last units named");
  ok(warn2[0].startsWith("Sour Gummies · 10pk"), "variant label in the warning");
  const warn3 = cartStockWarnings([
    { productName: "Preroll", variantLabel: null, quantity: 1, inventoryStatus: "in-stock", unitsLeft: 1 },
  ]);
  ok(warn3.length === 1 && warn3[0].includes("last one"), "singular phrasing for the last one");
  ok(
    cartStockWarnings([
      { productName: "Plenty", variantLabel: null, quantity: 2, inventoryStatus: "in-stock", unitsLeft: 50 },
    ]).length === 0,
    "healthy stock → no warning",
  );
  ok(
    cartStockWarnings([
      { productName: "Unknown", variantLabel: null, quantity: 5, inventoryStatus: "low-stock", unitsLeft: null },
    ]).length === 0,
    "unknown count → no cart warning (tile badge covers it)",
  );
  ok(cartStockWarnings([]).length === 0, "empty cart → no warnings");

  // lowStockCount — collapses by product
  const count = lowStockCount([
    { productId: "a", inventoryStatus: "low-stock", unitsLeft: null },
    { productId: "a", inventoryStatus: "low-stock", unitsLeft: 2 }, // same product, second variant
    { productId: "b", inventoryStatus: "in-stock", unitsLeft: 1 },
    { productId: "c", inventoryStatus: "in-stock", unitsLeft: 10 },
    { productId: "d", inventoryStatus: "in-stock", unitsLeft: null },
  ]);
  ok(count === 2, "low-stock count collapses variants by product (a + b = 2)");
  ok(lowStockCount([]) === 0, "empty bundle → 0");

  console.log(`low-stock-core self-tests: ALL PASS (${pass} assertions)`);
}
