/**
 * src/lib/pos/stock-ceiling-core.ts  (SLICE 14)
 *
 * PURE on-hand enforcement for the register cart. No I/O, no React — safe for
 * the tsx self-test harness and vitest.
 *
 * ─── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * The owner reported, from the counter: a tile said "1 LEFT", he tapped it
 * twice, and the register added two. He then used the +/− buttons in the cart
 * and could add as many as he liked. Recon (docs/slice-13-recon-stock-and-reset.md)
 * traced it to two functions that already had the stock number in scope and
 * never read it:
 *
 *   sale-flow-core.addToCart        — clamped only to MAX_LINE_QUANTITY (99)
 *   sale-flow-core.setCartQuantity  — same
 *
 * The overage was ALREADY being computed (low-stock-core.cartStockWarnings)
 * and shown as advisory text. B32's comment said so explicitly: "Warnings
 * only, NEVER blocks." This core is the owner's decision to change that:
 * warnings become a ceiling.
 *
 * ─── WHAT THIS CORE DELIBERATELY DOES NOT DO ───────────────────────────────
 *
 * It does NOT decide policy about unknown stock. `unitsLeft` is null for
 * legitimate, everyday cases that must keep working:
 *
 *   - custom sales           (custom-sale-core.ts:146 sets unitsLeft: null)
 *   - website-order carts    (order-to-cart-core.ts:134 sets unitsLeft: null)
 *   - items sold at the item price with no real variant
 *     (menu/route.ts:174 — `hasRealVariants ? variant.inventoryLevel : null`)
 *   - bundles cached before B32, where the field is `undefined` entirely
 *
 * If "unknown" blocked, custom sales would break outright. So unknown ALWAYS
 * means unlimited here. That is a correctness requirement, not a convenience.
 *
 * ─── THE CACHE IS NOT THE SHELF ────────────────────────────────────────────
 *
 * `unitsLeft` comes from the cached published menu bundle, not a live query.
 * Between refreshes it can lag reality. A budtender physically holding a jar
 * knows more than a cached integer. That is precisely why the owner asked for
 * block + OVERRIDE: this core supplies the ceiling and the honest reason
 * string, and the caller decides whether an override has lifted it. A hard
 * block with no escape would eventually refuse a real, in-hand unit.
 *
 * ─── ROUNDING/CORRUPTION DISCIPLINE ────────────────────────────────────────
 *
 * A non-integer or negative count is corrupt data, not a ceiling of zero.
 * Treating a corrupt −1 as "cannot sell" would silently 86 a live product.
 * Every guard here mirrors the existing, shipped guards at
 * low-stock-core.ts:78 and held-stock-core.ts:88 so the register speaks with
 * one voice about what a trustworthy count looks like.
 */

/** The outer cap that predates this slice (sale-flow-core.MAX_LINE_QUANTITY). */
export const STOCK_CEILING_MAX_LINE_QUANTITY = 99;

/**
 * The trustworthy sellable ceiling for a variant.
 *
 * Returns `null` for "unknown / unlimited" — the caller must treat null as
 * NO stock restriction, falling back to the 99-line cap alone.
 *
 * Accepts only a non-negative safe integer. null, undefined, NaN, Infinity,
 * fractions and negatives are all "unknown" (see the corruption note above).
 */
export function sellableCeiling(unitsLeft: number | null | undefined): number | null {
  if (typeof unitsLeft !== "number") return null;
  if (!Number.isSafeInteger(unitsLeft)) return null; // NaN, Infinity, 2.5 all land here
  if (unitsLeft < 0) return null;
  return unitsLeft;
}

/** Why a requested quantity was reduced (or refused). */
export type StockClampReason = "none" | "out-of-stock" | "stock" | "line-cap";

export type StockClampResult = {
  /** The quantity the cart may actually hold. Never negative. */
  quantity: number;
  /** True when `quantity` is less than what was asked for. */
  clamped: boolean;
  /** The stock ceiling that applied, or null when stock was unknown. */
  ceiling: number | null;
  /** Which rule bit. "none" when nothing was reduced. */
  reason: StockClampReason;
};

/**
 * Clamp a requested line quantity to (a) the on-hand ceiling when known and
 * (b) the pre-existing 99-per-line cap.
 *
 * `override` = the budtender has taken responsibility for selling past the
 * cached count (owner decision: ANY staff member may do this). Override lifts
 * the STOCK ceiling only — the 99 line cap is structural and always applies.
 *
 * Never throws. A corrupt `requested` floors to 0 rather than propagating NaN
 * into React state.
 */
export function clampToStock(
  requested: number,
  unitsLeft: number | null | undefined,
  override: boolean = false,
): StockClampResult {
  const ceiling = sellableCeiling(unitsLeft);

  // Normalise the request first: fractions truncate, corrupt values floor to 0.
  const askedRaw = typeof requested === "number" && Number.isFinite(requested) ? Math.trunc(requested) : 0;
  const asked = Math.max(0, askedRaw);

  // Structural cap always applies, override or not.
  let quantity = Math.min(asked, STOCK_CEILING_MAX_LINE_QUANTITY);
  let reason: StockClampReason = quantity < asked ? "line-cap" : "none";

  if (!override && ceiling !== null && quantity > ceiling) {
    quantity = ceiling;
    reason = ceiling === 0 ? "out-of-stock" : "stock";
  }

  return { quantity, clamped: quantity < asked, ceiling, reason };
}

/**
 * Can one more unit of this variant go in the cart?
 *
 * `currentQty` is what the cart already holds for that variant. Used by the
 * tile grid and the "+" button so the UI can refuse BEFORE mutating state and
 * explain itself, rather than silently doing nothing (a dead button that eats
 * taps is its own bug — the budtender has no idea why it stopped).
 */
export function canAddOne(
  currentQty: number,
  unitsLeft: number | null | undefined,
  override: boolean = false,
): boolean {
  const next = clampToStock(currentQty + 1, unitsLeft, override);
  return next.quantity > currentQty;
}

/**
 * True when the menu says this variant has a known, real count of zero.
 *
 * Drives the greyed-out tile (owner decision Q1). Deliberately narrow:
 * ONLY a trustworthy 0 greys a tile. Unknown stock never greys anything,
 * because hiding or disabling products that might be perfectly sellable
 * makes staff believe the menu is broken.
 */
export function isKnownOutOfStock(unitsLeft: number | null | undefined): boolean {
  return sellableCeiling(unitsLeft) === 0;
}

/**
 * Counter-facing sentence explaining a refusal. Plain English, no jargon, no
 * SDK symbols, no variant ids — this is read out loud to a customer standing
 * at the till.
 *
 * `label` should already be the display name (+ variant label when present).
 */
export function stockRefusalMessage(label: string, unitsLeft: number | null | undefined): string {
  const ceiling = sellableCeiling(unitsLeft);
  if (ceiling === null) return `${label}: stock is not tracked for this item.`;
  if (ceiling === 0) return `${label}: none left in stock.`;
  if (ceiling === 1) return `${label}: only 1 left — that one is already in the cart.`;
  return `${label}: only ${ceiling} left — all ${ceiling} are already in the cart.`;
}

/** A cart line as the blocking check needs it. */
export type StockBlockLine = {
  productName: string;
  variantLabel: string | null;
  quantity: number;
  unitsLeft: number | null | undefined;
};

/**
 * Lines that exceed their known ceiling — the hard gate for the Tender button.
 *
 * Returns [] when nothing is over, so `.length === 0` reads as "safe to
 * tender". Unknown counts are skipped entirely, matching the whole-file rule.
 *
 * This is the LAST line of defence. clampToStock should have prevented an
 * over-quantity ever reaching the cart, but a cart can also go over WITHOUT
 * any cart mutation: a menu refresh can lower unitsLeft underneath a cart that
 * was legal when it was built, and rebuildHeldCart/resume paths re-hydrate
 * lines against a newer bundle. So this must be evaluated from live cart
 * state at tender time, not assumed away because the add path is guarded.
 */
export function stockBlockingLines(lines: StockBlockLine[]): string[] {
  const over: string[] = [];
  for (const line of lines) {
    const ceiling = sellableCeiling(line.unitsLeft);
    if (ceiling === null) continue;
    const qty = typeof line.quantity === "number" && Number.isFinite(line.quantity) ? Math.trunc(line.quantity) : 0;
    if (qty <= ceiling) continue;
    const label = line.variantLabel ? `${line.productName} (${line.variantLabel})` : line.productName;
    over.push(
      ceiling === 0
        ? `${label}: cart has ${qty}, but none are left in stock.`
        : `${label}: cart has ${qty}, but only ${ceiling} ${ceiling === 1 ? "is" : "are"} left in stock.`,
    );
  }
  return over;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runStockCeilingCoreTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) {
      console.log("FAIL:", msg);
      throw new Error(`stock-ceiling-core self-test failed: ${msg}`);
    }
    pass += 1;
  };

  // ── sellableCeiling: what counts as a trustworthy number ──
  ok(sellableCeiling(0) === 0, "0 is a real ceiling, not 'unknown'");
  ok(sellableCeiling(1) === 1, "1 left");
  ok(sellableCeiling(500) === 500, "large counts pass through");
  ok(sellableCeiling(null) === null, "null = unknown (custom sale / no real variant)");
  ok(sellableCeiling(undefined) === null, "undefined = unknown (pre-B32 cached bundle)");
  ok(sellableCeiling(-1) === null, "negative is corrupt = unknown, NOT a zero ceiling");
  ok(sellableCeiling(2.5) === null, "fractional count is corrupt = unknown");
  ok(sellableCeiling(Number.NaN) === null, "NaN = unknown");
  ok(sellableCeiling(Number.POSITIVE_INFINITY) === null, "Infinity = unknown");

  // ── clampToStock: the owner's exact reported scenario ──
  // Tile said "1 LEFT", tapped twice.
  const firstTap = clampToStock(1, 1);
  ok(firstTap.quantity === 1 && !firstTap.clamped, "1 LEFT: first tap adds the unit");
  const secondTap = clampToStock(2, 1);
  ok(secondTap.quantity === 1, "1 LEFT: second tap does NOT reach 2 (the owner's bug)");
  ok(secondTap.clamped && secondTap.reason === "stock", "second tap reports a stock clamp");

  // Exact fit is allowed — never off-by-one against the store's own inventory.
  ok(clampToStock(3, 3).quantity === 3 && !clampToStock(3, 3).clamped, "exact fit allowed");
  ok(clampToStock(4, 3).quantity === 3, "over-by-one clamps to the ceiling");

  // Zero stock.
  const none = clampToStock(1, 0);
  ok(none.quantity === 0 && none.reason === "out-of-stock", "0 left: cannot add at all");

  // Unknown stock must remain unlimited or custom sales break.
  ok(clampToStock(50, null).quantity === 50, "unknown stock does not restrict (custom sale)");
  ok(clampToStock(50, undefined).quantity === 50, "undefined stock does not restrict");
  ok(clampToStock(50, null).reason === "none", "unknown stock reports no clamp");

  // Corrupt counts must not 86 a live product.
  ok(clampToStock(5, -1).quantity === 5, "corrupt negative count does not block a real sale");
  ok(clampToStock(5, 2.5).quantity === 5, "corrupt fractional count does not block a real sale");

  // ── the 99 cap must survive this slice ──
  ok(clampToStock(500, null).quantity === STOCK_CEILING_MAX_LINE_QUANTITY, "99 line cap still applies");
  ok(clampToStock(500, null).reason === "line-cap", "line cap is reported distinctly from stock");
  ok(clampToStock(500, 1000).quantity === STOCK_CEILING_MAX_LINE_QUANTITY, "99 cap beats a huge stock count");

  // ── override: ANY staff (owner decision Q2) ──
  ok(clampToStock(5, 1, true).quantity === 5, "override lifts the stock ceiling");
  ok(clampToStock(1, 0, true).quantity === 1, "override can sell a zero-count item found on the shelf");
  ok(
    clampToStock(500, 1, true).quantity === STOCK_CEILING_MAX_LINE_QUANTITY,
    "override does NOT lift the structural 99 cap",
  );
  ok(clampToStock(5, 1, true).clamped === false, "override reports no clamp");

  // ── requested-value hygiene ──
  ok(clampToStock(0, 5).quantity === 0, "zero request stays zero");
  ok(clampToStock(-3, 5).quantity === 0, "negative request floors to 0, never negative");
  ok(clampToStock(Number.NaN, 5).quantity === 0, "NaN request floors to 0, never leaks into state");
  ok(clampToStock(2.9, 5).quantity === 2, "fractional request truncates");

  // ── canAddOne ──
  ok(canAddOne(0, 1), "0 in cart, 1 left → can add");
  ok(!canAddOne(1, 1), "1 in cart, 1 left → cannot add (the owner's double-tap)");
  ok(!canAddOne(0, 0), "0 left → cannot add");
  ok(canAddOne(1, 1, true), "override allows the second unit");
  ok(canAddOne(99999, null) === false, "99 cap stops runaway adds even with unknown stock");
  ok(canAddOne(5, null), "unknown stock keeps adding below the cap");

  // ── isKnownOutOfStock (drives the greyed-out tile) ──
  ok(isKnownOutOfStock(0), "0 is known out of stock → grey the tile");
  ok(!isKnownOutOfStock(1), "1 left is not out of stock");
  ok(!isKnownOutOfStock(null), "unknown is NOT greyed (never hide a maybe-sellable product)");
  ok(!isKnownOutOfStock(undefined), "undefined is NOT greyed");
  ok(!isKnownOutOfStock(-1), "corrupt count is NOT greyed");

  // ── refusal copy: plain English, no jargon ──
  ok(stockRefusalMessage("Blue Dream", 0) === "Blue Dream: none left in stock.", "zero message");
  ok(stockRefusalMessage("Blue Dream", 1).includes("only 1 left"), "one-left message names the count");
  ok(stockRefusalMessage("Blue Dream", 4).includes("only 4 left"), "n-left message names the count");
  ok(stockRefusalMessage("Blue Dream", null).includes("not tracked"), "unknown stock is described honestly");
  for (const n of [0, 1, 4, null]) {
    const m = stockRefusalMessage("X", n);
    ok(!/unitsLeft|ceiling|variantId|null|undefined|NaN/.test(m), `refusal copy stays plain English (${String(n)})`);
  }

  // ── stockBlockingLines: the tender gate ──
  const line = (o: Partial<StockBlockLine> = {}): StockBlockLine => ({
    productName: "Blue Dream",
    variantLabel: "3.5g",
    quantity: 1,
    unitsLeft: 5,
    ...o,
  });
  ok(stockBlockingLines([line()]).length === 0, "within stock → tender allowed");
  ok(stockBlockingLines([line({ quantity: 5, unitsLeft: 5 })]).length === 0, "exact fit → tender allowed");
  ok(stockBlockingLines([line({ quantity: 6, unitsLeft: 5 })]).length === 1, "over → tender blocked");
  ok(stockBlockingLines([line({ unitsLeft: null })]).length === 0, "unknown stock never blocks tender");
  ok(stockBlockingLines([line({ unitsLeft: undefined })]).length === 0, "undefined stock never blocks tender");
  ok(stockBlockingLines([line({ quantity: 2, unitsLeft: -1 })]).length === 0, "corrupt count never blocks tender");
  ok(
    stockBlockingLines([line({ quantity: 1, unitsLeft: 0 })])[0]?.includes("none are left"),
    "zero-stock line explains itself",
  );
  ok(stockBlockingLines([line({ variantLabel: null, quantity: 9, unitsLeft: 1 })])[0]?.startsWith("Blue Dream:"),
    "no variant label → bare product name, no empty parens");
  ok(
    stockBlockingLines([line({ quantity: 9, unitsLeft: 1 })])[0]?.includes("(3.5g)"),
    "variant label is shown so staff know WHICH size",
  );
  ok(stockBlockingLines([line({ quantity: 3, unitsLeft: 1 }), line({ quantity: 4, unitsLeft: 2 })]).length === 2,
    "every offending line is reported, not just the first");
  ok(stockBlockingLines([]).length === 0, "empty cart is not blocked");

  // Singular/plural grammar — this is read at a counter.
  ok(stockBlockingLines([line({ quantity: 2, unitsLeft: 1 })])[0]?.includes("only 1 is left"), "singular grammar");
  ok(stockBlockingLines([line({ quantity: 3, unitsLeft: 2 })])[0]?.includes("only 2 are left"), "plural grammar");

  // ── the invariant that ties the whole slice together ──
  // Whatever clampToStock allows must never be something the tender gate then
  // rejects. If these two ever disagree, the register traps a budtender in a
  // cart they cannot sell and cannot fix.
  for (const stock of [0, 1, 2, 3, 10, null, undefined, -1] as (number | null | undefined)[]) {
    for (const want of [0, 1, 2, 3, 5, 120]) {
      const c = clampToStock(want, stock);
      const blocked = stockBlockingLines([
        { productName: "P", variantLabel: null, quantity: c.quantity, unitsLeft: stock },
      ]);
      ok(blocked.length === 0, `clamp(${want},${String(stock)})=${c.quantity} must never be tender-blocked`);
    }
  }

  console.log(`stock-ceiling-core self-tests: ALL PASS (${pass} assertions)`);
}
