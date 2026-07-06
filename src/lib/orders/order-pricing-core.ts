/**
 * src/lib/orders/order-pricing-core.ts
 *
 * PURE order money math — single source of truth for the tax model and the
 * statutory cannabis price floor (GAP H-3 / RCW 69.50.357: a licensee may not
 * give away cannabis product). No React, no DB, no server-only, so the cart
 * (client), the checkout API (server), and the completion gate (server action)
 * all compute money IDENTICALLY.
 *
 * Tax model (verified against the live cart):
 *   Card prices are tax-INCLUSIVE out-the-door prices.
 *   - Cannabis goods include the 37% WSLCB excise (RCW 69.50.535) + 9.3% local
 *     retail sales tax  => back-out divisor 1.463.
 *   - Non-cannabis goods (merch/accessories/paraphernalia) include only the
 *     9.3% local retail sales tax => divisor 1.093.
 *   total     = Σ (discounted unit price × qty)
 *   subtotal  = round( Σ lineTotal / divisor(category) )   (single rounding)
 *   tax       = total − subtotal                            (exact by construction)
 */

export const CANNABIS_EXCISE_TAX_RATE = 0.37; // WSLCB excise (RCW 69.50.535)
export const LOCAL_SALES_TAX_RATE = 0.093; // WA state + Port Orchard local
export const COMBINED_INCLUSIVE_TAX_RATE = CANNABIS_EXCISE_TAX_RATE + LOCAL_SALES_TAX_RATE; // 0.463
/** Back-out divisor: cannabis card price (tax-inclusive) / 1.463 => pre-tax subtotal. */
export const TAX_INCLUSIVE_DIVISOR = 1 + COMBINED_INCLUSIVE_TAX_RATE; // 1.463
/** Non-cannabis goods carry ONLY the local retail sales tax. */
export const NON_CANNABIS_TAX_INCLUSIVE_DIVISOR = 1 + LOCAL_SALES_TAX_RATE; // 1.093

/** Categories NOT subject to the WSLCB cannabis excise tax (and NOT cannabis product). */
export const NON_CANNABIS_TAX_CATEGORIES: ReadonlySet<string> = new Set([
  "merch",
  "accessories",
  "accessory",
  "paraphernalia",
]);

export function isNonCannabisCategory(category: string | null | undefined): boolean {
  return NON_CANNABIS_TAX_CATEGORIES.has((category ?? "").trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// GLOBAL CANNABIS PRICE FLOOR (GAP H-3, RCW 69.50.357 / WAC 314-55-155)
// ---------------------------------------------------------------------------
// A cannabis line may NEVER sell for $0 — no BOGO-100%, no "free" basket unit,
// no loyalty redemption that zeroes a cannabis item. The floor is a positive
// minor-unit price. True freebies are restricted to merch/accessories.
//
// NOTE: WAC 314-55-155 additionally prohibits selling below acquisition cost;
// lot-cost linkage is a later slice (the helper accepts a configurable floor
// so the acquisition cost can be passed where it is known).

/** Absolute minimum sellable unit price for cannabis product, in minor units. */
export const MIN_CANNABIS_UNIT_PRICE_MINOR = 1;

export type SellableLine = {
  category: string | null | undefined;
  /** Final (post-discount) per-unit price in minor units. */
  unitPriceMinorUnits: number;
};

export type SellableCheck = { ok: true } | { ok: false; reason: string };

/**
 * The ONE shared floor check (S-3). Cannabis lines must carry a positive unit
 * price (>= floorMinor, default 1 minor unit). Non-cannabis lines are exempt.
 */
export function assertCannabisLineSellable(
  line: SellableLine,
  floorMinor: number = MIN_CANNABIS_UNIT_PRICE_MINOR,
): SellableCheck {
  if (isNonCannabisCategory(line.category)) return { ok: true };
  if (!Number.isFinite(line.unitPriceMinorUnits) || line.unitPriceMinorUnits < floorMinor) {
    return {
      ok: false,
      reason: `Cannabis items cannot be sold for less than $${(floorMinor / 100).toFixed(2)} (RCW 69.50.357 — no free cannabis).`,
    };
  }
  return { ok: true };
}

/**
 * Clamp a discounted cannabis unit price to the floor. Used by the discount
 * engines so no promotion mechanic can produce a $0 cannabis unit.
 */
export function clampCannabisUnitPrice(
  category: string | null | undefined,
  unitPriceMinorUnits: number,
  regularPriceMinorUnits: number,
  floorMinor: number = MIN_CANNABIS_UNIT_PRICE_MINOR,
): number {
  if (isNonCannabisCategory(category)) return Math.max(0, unitPriceMinorUnits);
  // A cannabis item whose REGULAR price is already zero is unsellable data —
  // leave it and let assertCannabisLineSellable refuse the sale.
  if (regularPriceMinorUnits <= 0) return unitPriceMinorUnits;
  return Math.max(floorMinor, unitPriceMinorUnits);
}

// ---------------------------------------------------------------------------
// Totals (identical math to the cart provider)
// ---------------------------------------------------------------------------

export type TotalsLine = {
  category: string | null | undefined;
  quantity: number;
  /** Final (post-discount) per-unit price in minor units (tax-inclusive). */
  unitPriceMinorUnits: number;
  /** Pre-discount per-unit price in minor units (tax-inclusive). */
  regularPriceMinorUnits: number;
};

export type OrderTotals = {
  totalMinorUnits: number;
  subtotalMinorUnits: number;
  estimatedTaxMinorUnits: number;
  savingsMinorUnits: number;
};

/**
 * Compute the authoritative order totals from priced lines. Mirrors the cart:
 * total is the straight sum of tax-inclusive line totals; the pre-tax subtotal
 * is backed out per line with the category-correct divisor and rounded ONCE.
 */
export function computeOrderTotals(lines: TotalsLine[]): OrderTotals {
  let total = 0;
  let regularTotal = 0;
  let subtotalFloat = 0;
  for (const line of lines) {
    const qty = Math.max(0, Math.round(line.quantity));
    const lineTotal = line.unitPriceMinorUnits * qty;
    total += lineTotal;
    regularTotal += line.regularPriceMinorUnits * qty;
    const divisor = isNonCannabisCategory(line.category)
      ? NON_CANNABIS_TAX_INCLUSIVE_DIVISOR
      : TAX_INCLUSIVE_DIVISOR;
    subtotalFloat += lineTotal / divisor;
  }
  const subtotal = Math.round(subtotalFloat);
  return {
    totalMinorUnits: total,
    subtotalMinorUnits: subtotal,
    estimatedTaxMinorUnits: total - subtotal,
    savingsMinorUnits: Math.max(0, regularTotal - total),
  };
}

/**
 * Are two money amounts equal within a small rounding tolerance? The client
 * and server run the SAME pure math, so drift should be zero; the tolerance
 * only absorbs legacy floating-point edge cases, never tampering.
 */
export function moneyMatches(a: number, b: number, toleranceMinor = 2): boolean {
  return Math.abs(a - b) <= toleranceMinor;
}

// ---------------------------------------------------------------------------
// Self-tests (pure; run via a tsx scratch file or the compliance harness)
// ---------------------------------------------------------------------------
export function __runOrderPricingTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // Floor: cannabis at $0 refused; merch at $0 allowed.
  ok(!assertCannabisLineSellable({ category: "flower", unitPriceMinorUnits: 0 }).ok, "flower $0 refused");
  ok(!assertCannabisLineSellable({ category: "preroll", unitPriceMinorUnits: -5 }).ok, "negative refused");
  ok(assertCannabisLineSellable({ category: "flower", unitPriceMinorUnits: 1 }).ok, "flower 1c ok");
  ok(assertCannabisLineSellable({ category: "merch", unitPriceMinorUnits: 0 }).ok, "merch $0 ok");
  ok(assertCannabisLineSellable({ category: "accessories", unitPriceMinorUnits: 0 }).ok, "accessories $0 ok");

  // Clamp: BOGO-100% cannabis unit clamps to the floor; merch may be free.
  ok(clampCannabisUnitPrice("flower", 0, 1000) === MIN_CANNABIS_UNIT_PRICE_MINOR, "clamp flower 0 -> floor");
  ok(clampCannabisUnitPrice("merch", 0, 1000) === 0, "merch not clamped");
  ok(clampCannabisUnitPrice("flower", 500, 1000) === 500, "no clamp above floor");

  // Totals: cannabis divisor 1.463, merch divisor 1.093, tax = total - subtotal.
  {
    const t = computeOrderTotals([
      { category: "flower", quantity: 2, unitPriceMinorUnits: 1463, regularPriceMinorUnits: 1463 },
    ]);
    ok(t.totalMinorUnits === 2926, "total straight sum");
    ok(t.subtotalMinorUnits === 2000, "cannabis back-out 1.463");
    ok(t.estimatedTaxMinorUnits === 926, "tax = total - subtotal");
    ok(t.savingsMinorUnits === 0, "no savings");
  }
  {
    const t = computeOrderTotals([
      { category: "merch", quantity: 1, unitPriceMinorUnits: 1093, regularPriceMinorUnits: 1200 },
    ]);
    ok(t.subtotalMinorUnits === 1000, "merch back-out 1.093");
    ok(t.savingsMinorUnits === 107, "savings = regular - discounted");
  }
  {
    // Mixed cart matches the cart provider's single-rounding behaviour.
    const t = computeOrderTotals([
      { category: "flower", quantity: 1, unitPriceMinorUnits: 999, regularPriceMinorUnits: 999 },
      { category: "merch", quantity: 1, unitPriceMinorUnits: 555, regularPriceMinorUnits: 555 },
    ]);
    const expected = Math.round(999 / 1.463 + 555 / 1.093);
    ok(t.subtotalMinorUnits === expected, "mixed single rounding");
    ok(t.totalMinorUnits === 1554, "mixed total");
    ok(t.estimatedTaxMinorUnits === 1554 - expected, "mixed tax");
  }

  ok(moneyMatches(100, 101), "tolerance 1");
  ok(!moneyMatches(100, 105), "beyond tolerance");

  console.log(`order-pricing-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} order-pricing-core tests failed`);
}
