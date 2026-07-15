/**
 * src/lib/pos/custom-sale-core.ts  (POS Slice B39)
 *
 * PURE math for the register's quick-amount KEYPAD tab (Square's "Keypad"
 * surface, done the cannabis-lawful way).
 *
 * WHY THE RESTRICTION (verified, not guessed): Square lets a cashier ring an
 * arbitrary amount with no item behind it. For an I-502 retailer that is a
 * compliance hole, because every CANNABIS line must map to real inventory
 * (CCRS Sale.csv InventoryExternalIdentifier), carries the 37% excise, and
 * counts against WAC 314-55-095 purchase limits. So custom amounts are
 * restricted to the NON-CANNABIS categories (the same
 * NON_CANNABIS_TAX_CATEGORIES set order-pricing-core uses): merch and
 * accessories. Verified behavior of every gate for these categories:
 *
 *   - assertCannabisLineSellable   -> ok (no cannabis price floor)
 *   - clampCannabisUnitPrice       -> pass-through (no clamp)
 *   - categoryToBucket             -> null (never counts against limits)
 *   - computeOrderTotals           -> NON_CANNABIS_TAX_INCLUSIVE_DIVISOR
 *   - CCRS excise                  -> none (isCannabisCategory false), via
 *                                     the order_lines.category snapshot
 *                                     fallback shipped with this slice
 *
 * Custom lines carry a RESERVED product key ("pos-custom-<category>") so the
 * sync can audit them, the CCRS builder can recognize the category from the
 * line snapshot, and the inventory decrement can skip them (nothing to
 * decrement - they track no stock).
 *
 * Keypad entry works like a cash register: digits shift in from the right
 * ("1","2","5" -> $1.25). Money in MINOR UNITS throughout.
 */

import { NON_CANNABIS_TAX_CATEGORIES } from "@/lib/orders/order-pricing-core";
import type { PosMenuProduct } from "./sale-flow-core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Reserved product-key prefix for keypad lines ("pos-custom-merch", ...). */
export const CUSTOM_PRODUCT_PREFIX = "pos-custom-";

/**
 * The categories a keypad line may use. MUST stay a subset of
 * order-pricing-core's NON_CANNABIS_TAX_CATEGORIES - the guard in the
 * self-tests enforces the invariant at every test run.
 */
export const CUSTOM_SALE_CATEGORIES = ["merch", "accessories"] as const;
export type CustomSaleCategory = (typeof CUSTOM_SALE_CATEGORIES)[number];

/** Keypad amounts cap at $999.99 - fat-finger protection, not a policy. */
export const MAX_CUSTOM_AMOUNT_MINOR = 99_999;

/** Optional note cap (becomes the line's product name on receipt + CCRS). */
export const MAX_CUSTOM_NOTE_LENGTH = 60;

// ---------------------------------------------------------------------------
// Keypad entry math (cash-register style: digits shift in from the right)
// ---------------------------------------------------------------------------

/** Append one digit (0-9). Ignores input that would exceed the cap. */
export function keypadAppend(amountMinor: number, digit: number): number {
  const base = clampAmount(amountMinor);
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return base;
  const next = base * 10 + digit;
  return next > MAX_CUSTOM_AMOUNT_MINOR ? base : next;
}

/** Remove the rightmost digit. */
export function keypadBackspace(amountMinor: number): number {
  return Math.floor(clampAmount(amountMinor) / 10);
}

/** Clear back to $0.00. */
export function keypadClear(): number {
  return 0;
}

function clampAmount(amountMinor: number): number {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) return 0;
  return Math.min(amountMinor, MAX_CUSTOM_AMOUNT_MINOR);
}

// ---------------------------------------------------------------------------
// Custom product construction
// ---------------------------------------------------------------------------

export type CustomLineArgs = {
  category: CustomSaleCategory;
  /** Tax-inclusive amount in minor units (1 .. MAX_CUSTOM_AMOUNT_MINOR). */
  amountMinor: number;
  /** Optional short note ("Lighter", "Rolling tray") - becomes the name. */
  note?: string;
  /**
   * Unique id for this line's variantId (caller passes crypto.randomUUID()).
   * A parameter - not generated here - so the core stays deterministic.
   */
  uid: string;
};

export type CustomLineResult =
  | { ok: true; product: PosMenuProduct }
  | { ok: false; errors: string[] };

const DEFAULT_NAMES: Record<CustomSaleCategory, string> = {
  merch: "Custom merch",
  accessories: "Custom accessory",
};

/**
 * Build the PosMenuProduct a keypad line adds to the cart. It flows through
 * the EXISTING cart -> pricing -> payload -> sync pipeline unchanged; only
 * the reserved product key marks it as a keypad line.
 */
export function buildCustomProduct(args: CustomLineArgs): CustomLineResult {
  const errors: string[] = [];
  if (!(CUSTOM_SALE_CATEGORIES as readonly string[]).includes(args.category)) {
    errors.push("Custom amounts are limited to merch and accessories - cannabis must be rung from the menu.");
  }
  if (!Number.isInteger(args.amountMinor) || args.amountMinor < 1) {
    errors.push("Enter an amount greater than $0.00.");
  } else if (args.amountMinor > MAX_CUSTOM_AMOUNT_MINOR) {
    errors.push(`Custom amounts cap at $${(MAX_CUSTOM_AMOUNT_MINOR / 100).toFixed(2)}.`);
  }
  const note = (args.note ?? "").trim();
  if (note.length > MAX_CUSTOM_NOTE_LENGTH) {
    errors.push(`Keep the note under ${MAX_CUSTOM_NOTE_LENGTH} characters.`);
  }
  const uid = (args.uid ?? "").trim();
  if (!uid) errors.push("Missing line id.");
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    product: {
      productId: `${CUSTOM_PRODUCT_PREFIX}${args.category}`,
      variantId: `${CUSTOM_PRODUCT_PREFIX}${uid}`,
      name: note || DEFAULT_NAMES[args.category],
      brand: null,
      category: args.category,
      categories: [args.category],
      variantLabel: null,
      regularPriceMinor: args.amountMinor,
      costMinorUnits: null,
      inventoryStatus: "in-stock",
      unitsLeft: null,
    },
  };
}

/** Is this order line a keypad custom line? (Used by sync audit + decrement skip.) */
export function isCustomLineProductId(productId: string | null | undefined): boolean {
  return typeof productId === "string" && productId.startsWith(CUSTOM_PRODUCT_PREFIX);
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runCustomSaleCoreTests(): void {
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

  // INVARIANT: every keypad category is non-cannabis in the pricing core.
  // If this ever fails, a keypad line would be treated as cannabis (excise,
  // limits, lot decrement) - the whole B39 design depends on this set.
  for (const c of CUSTOM_SALE_CATEGORIES) {
    ok(NON_CANNABIS_TAX_CATEGORIES.has(c), `"${c}" is a NON_CANNABIS_TAX_CATEGORIES member`);
  }

  // Keypad math - cash-register digit entry.
  ok(keypadAppend(0, 1) === 1, "append first digit");
  ok(keypadAppend(keypadAppend(keypadAppend(0, 1), 2), 5) === 125, "1-2-5 -> $1.25");
  ok(keypadAppend(99_999, 9) === 99_999, "cap: append past max ignored");
  ok(keypadAppend(0, 0) === 0, "leading zero stays zero");
  ok(keypadAppend(5, -1) === 5 && keypadAppend(5, 10) === 5, "bad digit ignored");
  ok(keypadAppend(-50, 3) === 3, "negative state resets before append");
  ok(keypadBackspace(125) === 12, "backspace drops rightmost digit");
  ok(keypadBackspace(1) === 0 && keypadBackspace(0) === 0, "backspace bottoms at 0");
  ok(keypadClear() === 0, "clear -> 0");

  // Custom product construction.
  const good = buildCustomProduct({ category: "merch", amountMinor: 1299, note: "Lighter", uid: "u1" });
  ok(good.ok, "good merch line builds");
  if (good.ok) {
    ok(good.product.productId === "pos-custom-merch", "reserved product key");
    ok(good.product.variantId === "pos-custom-u1", "uid-derived variant id");
    ok(good.product.name === "Lighter", "note becomes the name");
    ok(good.product.regularPriceMinor === 1299, "amount is the price");
    ok(good.product.category === "merch" && good.product.categories[0] === "merch", "category snapshot");
    ok(good.product.unitsLeft === null && good.product.costMinorUnits === null, "no stock/cost tracking");
  }
  const unnamed = buildCustomProduct({ category: "accessories", amountMinor: 500, uid: "u2" });
  ok(unnamed.ok && unnamed.product.name === "Custom accessory", "default name per category");

  ok(!buildCustomProduct({ category: "flower" as CustomSaleCategory, amountMinor: 500, uid: "u3" }).ok, "cannabis category refused");
  ok(!buildCustomProduct({ category: "merch", amountMinor: 0, uid: "u4" }).ok, "zero amount refused");
  ok(!buildCustomProduct({ category: "merch", amountMinor: 12.5 as unknown as number, uid: "u5" }).ok, "fractional cents refused");
  ok(!buildCustomProduct({ category: "merch", amountMinor: MAX_CUSTOM_AMOUNT_MINOR + 1, uid: "u6" }).ok, "over-cap refused");
  ok(!buildCustomProduct({ category: "merch", amountMinor: 500, note: "x".repeat(61), uid: "u7" }).ok, "long note refused");
  ok(!buildCustomProduct({ category: "merch", amountMinor: 500, uid: "  " }).ok, "blank uid refused");

  // Line detection.
  ok(isCustomLineProductId("pos-custom-merch"), "custom key detected");
  ok(!isCustomLineProductId("leafly-123") && !isCustomLineProductId(null), "real keys / null not custom");

  console.log(`custom-sale-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`custom-sale-core self-tests FAILED: ${failures.join("; ")}`);
}
