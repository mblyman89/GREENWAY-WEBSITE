/**
 * src/lib/pos/price-override-core.ts  (POS Slice B24)
 *
 * PURE logic for the register's manager-PIN price override (markdown). No
 * React, no DB, no server-only — the same module runs on the iPad and in
 * tests, so the floor math can never drift from what priceCart enforces.
 *
 * Design rules (verified in code, never guessed):
 *  - MARKDOWN ONLY: an override must LOWER the engine-computed unit price.
 *    Raising a price is a menu edit in the back office, not a register move
 *    (charging above the posted price is a consumer-protection problem).
 *  - The floor mirrors priceCart EXACTLY: the statutory cannabis floor
 *    (RCW 69.50.357 — never free cannabis) via MIN_CANNABIS_UNIT_PRICE_MINOR
 *    with isNonCannabisCategory on the PRIMARY category, and the CCRS
 *    acquisition-cost floor via lineCostFloor over the SAME EngineCartLine
 *    shape priceCart builds. A manager PIN cannot take cannabis below cost.
 *  - The approving manager was verified server-side by /api/pos/approve
 *    (scrypt PIN + manager/lead role gate) moments before the override is
 *    applied — this module only carries the RESULT (employees.id + name).
 *    The PIN itself never touches this module or any queue payload.
 *  - STALE-SAFE: an override is approved against a SPECIFIC engine unit
 *    price. If the engine reprices the line (a quantity change can move a
 *    promo tier), the override is DROPPED and reported — it is never
 *    silently applied to a price the manager did not look at.
 *  - The overridden price becomes the line's unitPriceMinor, so the server's
 *    S-2b money recompute (which derives totals FROM stored line prices) and
 *    the stored-price floor check hold without any gate changes; the sync
 *    additionally audits every overridden line (register.price_override).
 */

import {
  lineCostFloor,
  type EngineCartLine,
} from "@/lib/promotions/discount-engine-core";
import {
  computeOrderTotals,
  isNonCannabisCategory,
  MIN_CANNABIS_UNIT_PRICE_MINOR,
  type OrderTotals,
} from "@/lib/orders/order-pricing-core";
import type { PosMenuProduct, PricedSaleLine } from "./sale-flow-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A manager-approved override held in register state, keyed by variantId.
 * `approvedByName` is DISPLAY-ONLY (cart chip); the queue payload carries
 * only the payload-shaped block (original price, reason, approver id).
 */
export type PosLineOverride = {
  /** The overridden (charged) tax-inclusive unit price, minor units. */
  unitPriceMinor: number;
  /** The engine unit price the manager saw when approving, minor units. */
  originalUnitPriceMinor: number;
  /** Why (3–500 chars — same discipline as the no-sale reason). */
  reason: string;
  /** employees.id of the approving manager/lead (server-verified). */
  approvedByEmployeeId: string;
  /** Approver display name — UI only, never enters the payload. */
  approvedByName: string;
};

/** Reason bounds shared with validateSalePayload's override block. */
export const OVERRIDE_REASON_MIN = 3;
export const OVERRIDE_REASON_MAX = 500;

// ---------------------------------------------------------------------------
// Floor — mirrors priceCart line for line
// ---------------------------------------------------------------------------

/**
 * The minimum unit price a manager override may set for this product, in
 * minor units. Mirrors priceCart's floors exactly:
 *  - cannabis: max(statutory positive floor, acquisition-cost floor), and
 *  - merch/accessories: the cost floor alone (a $0 merch markdown stays a
 *    promotions decision, not a register override — see validate below).
 * lineCostFloor already caps at the regular price, so a product whose
 * regular price sits at/below cost can still be sold at regular.
 */
export function overrideFloorMinor(product: PosMenuProduct): number {
  const engineLine: EngineCartLine = {
    lineId: product.variantId,
    regularPriceMinorUnits: product.regularPriceMinor,
    quantity: 1,
    categories: product.categories.length
      ? product.categories.map((c) => c.toLowerCase())
      : [product.category.toLowerCase()],
    brand: product.brand,
    productKey: product.productId,
    variantLabel: product.variantLabel,
    costMinorUnits: product.costMinorUnits,
  };
  const cost = lineCostFloor(engineLine);
  if (isNonCannabisCategory(product.category)) return Math.max(0, cost);
  return Math.max(MIN_CANNABIS_UNIT_PRICE_MINOR, cost);
}

// ---------------------------------------------------------------------------
// Request validation — BEFORE the manager PIN is spent
// ---------------------------------------------------------------------------

export type OverrideRequestCheck = { ok: true } | { ok: false; error: string };

/**
 * Validate an override request against the engine price + floor. Runs BEFORE
 * the /api/pos/approve call so an invalid price never burns a PIN verify.
 */
export function validateOverrideRequest(args: {
  /** The engine-computed unit price currently on the line, minor units. */
  engineUnitMinor: number;
  /** overrideFloorMinor(product). */
  floorMinor: number;
  /** The requested new unit price, minor units. */
  newUnitMinor: number;
  reason: string;
}): OverrideRequestCheck {
  if (!Number.isInteger(args.newUnitMinor) || args.newUnitMinor <= 0) {
    return { ok: false, error: "Enter a valid price above $0.00." };
  }
  if (!Number.isInteger(args.engineUnitMinor) || args.engineUnitMinor <= 0) {
    return { ok: false, error: "This line has no valid engine price to override." };
  }
  if (args.newUnitMinor >= args.engineUnitMinor) {
    return {
      ok: false,
      error: `An override must LOWER the price — the line already charges $${(args.engineUnitMinor / 100).toFixed(2)}. Raise prices in the back office menu, not at the register.`,
    };
  }
  if (args.newUnitMinor < args.floorMinor) {
    return {
      ok: false,
      error: `$${(args.newUnitMinor / 100).toFixed(2)} is below this item's floor of $${(args.floorMinor / 100).toFixed(2)} (statutory cannabis minimum / acquisition cost — RCW 69.50.357, WAC 314-55-155). No PIN can approve it.`,
    };
  }
  const reason = args.reason.trim();
  if (reason.length < OVERRIDE_REASON_MIN) {
    return { ok: false, error: `An override needs a reason (at least ${OVERRIDE_REASON_MIN} characters).` };
  }
  if (reason.length > OVERRIDE_REASON_MAX) {
    return { ok: false, error: `Override reason is too long (max ${OVERRIDE_REASON_MAX} characters).` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Application — after priceCart, before medical repricing
// ---------------------------------------------------------------------------

export type ApplyOverridesResult = {
  lines: PricedSaleLine[];
  /** Totals recomputed from the overridden lines (same computeOrderTotals). */
  totals: OrderTotals;
  /**
   * variantIds whose override was DROPPED because the engine repriced the
   * line since approval (or the stored override went incoherent). The UI
   * clears these from state and tells the cashier — never a silent apply.
   */
  staleVariantIds: string[];
};

/**
 * Apply manager overrides to priceCart's output. A line's override applies
 * ONLY when the engine unit price still equals the price the manager
 * approved against; anything else is stale and reported. The applied line
 * carries the payload-shaped override block (original price, reason,
 * approver id) so buildSalePayload can forward it verbatim.
 */
export function applyPriceOverrides(
  lines: PricedSaleLine[],
  overrides: Record<string, PosLineOverride>,
): ApplyOverridesResult {
  const staleVariantIds: string[] = [];
  const out: PricedSaleLine[] = lines.map((line) => {
    const key = line.variantId ?? "";
    const o = key ? overrides[key] : undefined;
    if (!o) return line;
    const coherent =
      Number.isInteger(o.unitPriceMinor) &&
      o.unitPriceMinor > 0 &&
      o.unitPriceMinor < line.unitPriceMinor &&
      o.originalUnitPriceMinor === line.unitPriceMinor;
    if (!coherent) {
      staleVariantIds.push(key);
      return line;
    }
    return {
      ...line,
      unitPriceMinor: o.unitPriceMinor,
      override: {
        originalUnitPriceMinor: o.originalUnitPriceMinor,
        reason: o.reason.trim(),
        approvedByEmployeeId: o.approvedByEmployeeId,
      },
    };
  });
  const totals = computeOrderTotals(
    out.map((l) => ({
      category: l.category,
      quantity: l.quantity,
      unitPriceMinorUnits: l.unitPriceMinor,
      regularPriceMinorUnits: l.regularPriceMinor,
    })),
  );
  return { lines: out, totals, staleVariantIds };
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

export function __runPriceOverrideCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else { fail += 1; console.log("FAIL:", msg); }
  };

  const U1 = "11111111-1111-4111-8111-111111111111";

  const flower: PosMenuProduct = {
    productId: "prod-flower",
    variantId: "var-flower-35",
    name: "Blue Dream",
    brand: "Greenway Farms",
    category: "flower",
    categories: ["flower"],
    variantLabel: "3.5g",
    regularPriceMinor: 3500,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
  };
  const conc: PosMenuProduct = {
    ...flower,
    productId: "prod-conc",
    variantId: "var-conc-1",
    name: "Live Resin",
    category: "concentrates",
    categories: ["concentrates"],
    variantLabel: "1g",
    regularPriceMinor: 3000,
    costMinorUnits: 800, // pre-tax cost → tax-inclusive floor = ceil(800 × divisor)
  };
  const merch: PosMenuProduct = {
    ...flower,
    productId: "prod-merch",
    variantId: "var-merch-1",
    name: "Logo Tee",
    category: "merch",
    categories: ["merch"],
    variantLabel: null,
    regularPriceMinor: 2000,
    costMinorUnits: null,
  };

  // ── overrideFloorMinor mirrors priceCart's floors ──────────────────────
  ok(overrideFloorMinor(flower) === 1, "cannabis with unknown cost floors at the statutory 1 minor unit");
  const concFloor = overrideFloorMinor(conc);
  ok(concFloor > 800, "known cost lifts the floor above the raw pre-tax cost (tax-inclusive ceil)");
  ok(concFloor < conc.regularPriceMinor, "cost floor sits below the regular price for a healthy margin");
  ok(overrideFloorMinor(merch) === 0, "merch with unknown cost floors at 0 (statutory floor is cannabis-only)");

  // ── validateOverrideRequest ────────────────────────────────────────────
  const base = { engineUnitMinor: 3500, floorMinor: 1, reason: "damaged packaging" };
  ok(validateOverrideRequest({ ...base, newUnitMinor: 3000 }).ok, "valid markdown accepted");
  ok(!validateOverrideRequest({ ...base, newUnitMinor: 3500 }).ok, "equal price refused (must lower)");
  ok(!validateOverrideRequest({ ...base, newUnitMinor: 3600 }).ok, "raise refused (menu edit, not override)");
  ok(!validateOverrideRequest({ ...base, newUnitMinor: 0 }).ok, "zero price refused");
  ok(!validateOverrideRequest({ ...base, newUnitMinor: 29.5 as unknown as number }).ok, "non-integer money refused");
  const belowFloor = validateOverrideRequest({ engineUnitMinor: 3000, floorMinor: concFloor, newUnitMinor: 500, reason: "friend discount" });
  ok(!belowFloor.ok, "below the cost floor refused even with a PIN");
  ok(!belowFloor.ok && belowFloor.error.includes("69.50.357"), "floor refusal cites the statute");
  ok(!validateOverrideRequest({ ...base, newUnitMinor: 3000, reason: "x" }).ok, "short reason refused");
  ok(!validateOverrideRequest({ ...base, newUnitMinor: 3000, reason: "y".repeat(501) }).ok, "over-long reason refused");
  ok(!validateOverrideRequest({ engineUnitMinor: 0, floorMinor: 1, newUnitMinor: 1, reason: "abc" }).ok, "engine price of 0 refused");

  // ── applyPriceOverrides ────────────────────────────────────────────────
  const pricedLine: PricedSaleLine = {
    productId: "prod-flower",
    productName: "Blue Dream (3.5g)",
    category: "flower",
    quantity: 2,
    unitPriceMinor: 3500,
    regularPriceMinor: 3500,
    variantId: "var-flower-35",
    brand: "Greenway Farms",
    variantLabel: "3.5g",
  };
  const goodOverride: PosLineOverride = {
    unitPriceMinor: 3000,
    originalUnitPriceMinor: 3500,
    reason: "damaged packaging",
    approvedByEmployeeId: U1,
    approvedByName: "Mgr M.",
  };

  const applied = applyPriceOverrides([pricedLine], { "var-flower-35": goodOverride });
  ok(applied.lines[0].unitPriceMinor === 3000, "override replaces the charged unit price");
  ok(applied.lines[0].override?.originalUnitPriceMinor === 3500, "payload block records the engine price");
  ok(applied.lines[0].override?.approvedByEmployeeId === U1, "payload block records the approver id");
  ok(!("approvedByName" in (applied.lines[0].override ?? {})), "display name never enters the payload block");
  ok(applied.lines[0].regularPriceMinor === 3500, "regular price untouched (savings math intact)");
  ok(applied.totals.totalMinorUnits === 6000, "totals recomputed from the overridden price (2 × 3000)");
  ok(applied.staleVariantIds.length === 0, "coherent override is not stale");

  // Stale: the engine repriced the line since approval (promo tier moved).
  const repriced = { ...pricedLine, unitPriceMinor: 2800 };
  const stale = applyPriceOverrides([repriced], { "var-flower-35": goodOverride });
  ok(stale.lines[0].unitPriceMinor === 2800, "stale override never applies to a repriced line");
  ok(stale.lines[0].override === undefined, "stale override leaves no payload block");
  ok(stale.staleVariantIds.includes("var-flower-35"), "stale override is reported for UI cleanup");

  // Incoherent: an override at/above the engine price is dropped, not applied.
  const notLower = applyPriceOverrides([pricedLine], {
    "var-flower-35": { ...goodOverride, unitPriceMinor: 3500, originalUnitPriceMinor: 3500 },
  });
  ok(notLower.lines[0].override === undefined && notLower.staleVariantIds.length === 1, "non-markdown override dropped");

  // No override for the line = untouched.
  const untouched = applyPriceOverrides([pricedLine], {});
  ok(untouched.lines[0].unitPriceMinor === 3500 && untouched.staleVariantIds.length === 0, "lines without overrides pass through");

  if (fail > 0) throw new Error(`price-override-core self-tests: ${fail} FAILED (${pass} passed)`);
  console.log(`price-override-core self-tests: ALL PASS (${pass} assertions)`);
}
