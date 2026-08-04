/**
 * src/lib/inventory/price-correction-core.ts  (T-324)
 *
 * PURE logic for the Inventory Detail "correct the after-tax price" feature.
 * Zero I/O, zero React, zero server-only — the same module runs in the server
 * action, in the (client-safe) formula display, and in tsx self-tests, so the
 * tax + floor math can NEVER drift from what the cart/menu enforce.
 *
 * WHY THIS EXISTS (verified, never guessed): a lot's SELL price lives on its
 * menu VARIANT (`menu_variants.price_minor_units`), keyed
 * `source_variant_id = "${lot.pos_product_key}-onboarded"` (see
 * variant-lot-core.ts + draft-injection-core.ts). Card/menu prices are
 * tax-INCLUSIVE ("out-the-door"). The owner edits the OUT-THE-DOOR price; we
 * back out the pre-tax base for display and enforce the statutory floor.
 *
 * THE MATH (mirrors the cart/menu exactly — same divisors as
 * order-pricing-core.ts, same helper as inventory/pricing.ts):
 *   divisor        = 1.463 cannabis / 1.093 merch+accessories
 *   base (pre-tax) = afterTax / divisor
 *   afterTax       = base × divisor
 *
 * THE FLOOR (HYPER-CRITICAL — RCW 69.50.357 / WAC 314-55-155, CCRS/LCB):
 * a product may NEVER be priced below acquisition cost + tax. The floor is
 * `ceil(cost × divisor)` — the SAME costFloorMinorUnits the register's price
 * override and priceCart enforce. We HARD-BLOCK any edit below it.
 */

import {
  TAX_INCLUSIVE_DIVISOR,
  NON_CANNABIS_TAX_INCLUSIVE_DIVISOR,
  isNonCannabisCategory,
} from "@/lib/orders/order-pricing-core";

/** The tax-inclusive divisor for a category (1.463 cannabis / 1.093 merch). */
export function divisorForCategory(category: string | null | undefined): number {
  return isNonCannabisCategory(category)
    ? NON_CANNABIS_TAX_INCLUSIVE_DIVISOR
    : TAX_INCLUSIVE_DIVISOR;
}

/**
 * Back out the pre-tax BASE (minor units) from an after-tax / out-the-door
 * price. Rounds to the nearest cent for display (the authoritative value we
 * STORE is always the after-tax price the owner typed — the base is derived,
 * never stored, so this rounding is display-only and cannot drift the charge).
 */
export function baseFromAfterTax(
  afterTaxMinor: number,
  category: string | null | undefined,
): number {
  if (!Number.isFinite(afterTaxMinor) || afterTaxMinor <= 0) return 0;
  return Math.round(afterTaxMinor / divisorForCategory(category));
}

/**
 * The statutory tax-inclusive price floor implied by acquisition cost:
 * ceil(cost × divisor) = 1× cost + tax. Returns null when cost is unknown
 * (we can't enforce a floor we can't compute — the caller allows the edit but
 * says so). Mirrors costFloorMinorUnits in discount-engine-core EXACTLY.
 */
export function afterTaxFloorMinor(
  costMinor: number | null | undefined,
  category: string | null | undefined,
): number | null {
  if (costMinor == null || !Number.isFinite(costMinor) || costMinor <= 0) return null;
  return Math.ceil(costMinor * divisorForCategory(category));
}

/** Format minor units as USD ("$15.00"). Shared display helper. */
export function fmtUsd(minor: number | null | undefined): string {
  if (minor == null || !Number.isFinite(minor)) return "—";
  return `$${(minor / 100).toFixed(2)}`;
}

export type PriceCorrectionInput = {
  /** The raw after-tax dollars string the owner typed (e.g. "15" or "15.00"). */
  afterTaxDollars: string | null | undefined;
  /** Acquisition cost in minor units (from the lot). Null = unknown. */
  costMinor: number | null | undefined;
  /** The product's category (drives the tax divisor + floor). */
  category: string | null | undefined;
};

export type PriceCorrectionResult =
  | {
      ok: true;
      /** The validated after-tax (out-the-door) price we will STORE, minor units. */
      afterTaxMinor: number;
      /** The derived pre-tax base, minor units (display only). */
      baseMinor: number;
      /** The divisor used (1.463 / 1.093). */
      divisor: number;
      /** The enforced floor, or null when cost is unknown. */
      floorMinor: number | null;
    }
  | { ok: false; error: string };

/**
 * Parse + validate an after-tax price correction. HARD-BLOCKS (ok:false with a
 * plain-English reason) on: empty/non-numeric input, non-positive price, and —
 * the hyper-critical one — any price below the cost+tax floor. On success it
 * returns the exact minor-unit price to store plus the derived base for the
 * audit trail. Never trusts the form; the same validation runs server-side.
 */
export function parsePriceCorrection(input: PriceCorrectionInput): PriceCorrectionResult {
  const raw = (input.afterTaxDollars ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (raw === "") {
    return { ok: false, error: "Enter an after-tax price (the out-the-door price the customer pays)." };
  }
  const dollars = Number(raw);
  if (!Number.isFinite(dollars)) {
    return { ok: false, error: `"${input.afterTaxDollars}" isn't a valid price. Enter a dollar amount like 15.00.` };
  }
  // Store money in cents; round the typed dollars to whole cents.
  const afterTaxMinor = Math.round(dollars * 100);
  if (afterTaxMinor <= 0) {
    return { ok: false, error: "The after-tax price must be greater than $0.00." };
  }

  const divisor = divisorForCategory(input.category);
  const floorMinor = afterTaxFloorMinor(input.costMinor, input.category);

  // HYPER-CRITICAL FLOOR (CCRS/LCB): never below acquisition cost + tax.
  if (floorMinor != null && afterTaxMinor < floorMinor) {
    const merch = isNonCannabisCategory(input.category);
    const taxLabel = merch ? "9.3% sales tax" : "37% excise + 9.3% sales tax";
    return {
      ok: false,
      error:
        `Blocked: ${fmtUsd(afterTaxMinor)} is below the legal minimum of ${fmtUsd(floorMinor)}. ` +
        `Washington law (RCW 69.50.357 / WAC 314-55-155) forbids selling below acquisition cost. ` +
        `This lot cost ${fmtUsd(input.costMinor ?? 0)}; with ${taxLabel} folded in, the out-the-door price ` +
        `can never be under ${fmtUsd(floorMinor)}. Enter ${fmtUsd(floorMinor)} or higher.`,
    };
  }

  return {
    ok: true,
    afterTaxMinor,
    baseMinor: baseFromAfterTax(afterTaxMinor, input.category),
    divisor,
    floorMinor,
  };
}

/**
 * Build the crystal-clear formula string for the product-details row, e.g.
 * "Base $10.25 × 1.463 tax = $15.00 out-the-door". Cannabis uses ×1.463,
 * merch/accessories ×1.093. Base is the derived pre-tax amount.
 */
export function priceFormulaLabel(
  afterTaxMinor: number | null | undefined,
  category: string | null | undefined,
): string {
  if (afterTaxMinor == null || !Number.isFinite(afterTaxMinor) || afterTaxMinor <= 0) {
    return "No price set yet.";
  }
  const divisor = divisorForCategory(category);
  const base = baseFromAfterTax(afterTaxMinor, category);
  return `Base ${fmtUsd(base)} × ${divisor} tax = ${fmtUsd(afterTaxMinor)} out-the-door`;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPriceCorrectionCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    passed++;
  };

  // divisorForCategory — cannabis 1.463, merch/accessories 1.093.
  ok(divisorForCategory("flower") === 1.463, "cannabis divisor 1.463");
  ok(divisorForCategory("preroll") === 1.463, "unknown cannabis-ish divisor 1.463");
  ok(divisorForCategory("merch") === 1.093, "merch divisor 1.093");
  ok(divisorForCategory("accessories") === 1.093, "accessories divisor 1.093");
  ok(divisorForCategory(null) === 1.463, "null category defaults to cannabis divisor");

  // baseFromAfterTax — reverse math, rounded to the nearest cent.
  ok(baseFromAfterTax(1463, "flower") === 1000, "cannabis $14.63 backs out to $10.00 base");
  ok(baseFromAfterTax(1500, "flower") === Math.round(1500 / 1.463), "cannabis $15.00 backs out consistently");
  ok(baseFromAfterTax(1093, "merch") === 1000, "merch $10.93 backs out to $10.00 base");
  ok(baseFromAfterTax(0, "flower") === 0, "zero after-tax => zero base");
  ok(baseFromAfterTax(-5, "flower") === 0, "negative after-tax => zero base");

  // afterTaxFloorMinor — ceil(cost × divisor); null when cost unknown.
  ok(afterTaxFloorMinor(1000, "flower") === 1463, "cannabis cost $10 floors at $14.63");
  ok(afterTaxFloorMinor(999, "flower") === Math.ceil(999 * 1.463), "cannabis floor ceils up");
  ok(afterTaxFloorMinor(1000, "merch") === 1093, "merch cost $10 floors at $10.93");
  ok(afterTaxFloorMinor(null, "flower") === null, "unknown cost => null floor");
  ok(afterTaxFloorMinor(0, "flower") === null, "zero cost => null floor");

  // parsePriceCorrection — happy path.
  const good = parsePriceCorrection({ afterTaxDollars: "15.00", costMinor: 1000, category: "flower" });
  ok(good.ok === true, "valid $15.00 accepted (cost $10, floor $14.63)");
  if (good.ok) {
    ok(good.afterTaxMinor === 1500, "stores 1500 minor units");
    ok(good.baseMinor === Math.round(1500 / 1.463), "base derived");
    ok(good.floorMinor === 1463, "floor reported as 1463");
  }

  // parsePriceCorrection — strips "$" and commas.
  const withSign = parsePriceCorrection({ afterTaxDollars: "$1,500.00", costMinor: null, category: "flower" });
  ok(withSign.ok === true && withSign.afterTaxMinor === 150000, "strips $ and commas ($1,500.00)");

  // parsePriceCorrection — HARD BLOCK below the cost+tax floor.
  const tooLow = parsePriceCorrection({ afterTaxDollars: "14.00", costMinor: 1000, category: "flower" });
  ok(tooLow.ok === false, "below-floor price hard-blocked ($14 < $14.63 floor)");
  if (!tooLow.ok) {
    ok(/legal minimum/i.test(tooLow.error), "block message cites the legal minimum");
    ok(tooLow.error.includes("$14.63"), "block message states the exact floor");
  }

  // At-floor is allowed (>=, not >).
  const atFloor = parsePriceCorrection({ afterTaxDollars: "14.63", costMinor: 1000, category: "flower" });
  ok(atFloor.ok === true, "exactly at floor is allowed");

  // No cost => no floor => any positive price allowed.
  const noCost = parsePriceCorrection({ afterTaxDollars: "1.00", costMinor: null, category: "flower" });
  ok(noCost.ok === true, "no cost known => positive price allowed (no floor to enforce)");

  // Invalid / non-positive input.
  ok(parsePriceCorrection({ afterTaxDollars: "", costMinor: 1000, category: "flower" }).ok === false, "empty blocked");
  ok(parsePriceCorrection({ afterTaxDollars: "abc", costMinor: 1000, category: "flower" }).ok === false, "non-numeric blocked");
  ok(parsePriceCorrection({ afterTaxDollars: "0", costMinor: 1000, category: "flower" }).ok === false, "zero blocked");
  ok(parsePriceCorrection({ afterTaxDollars: "-5", costMinor: 1000, category: "flower" }).ok === false, "negative blocked");

  // priceFormulaLabel — crystal-clear math string.
  ok(
    priceFormulaLabel(1500, "flower") === `Base ${fmtUsd(baseFromAfterTax(1500, "flower"))} × 1.463 tax = $15.00 out-the-door`,
    "formula label shape (cannabis)",
  );
  ok(priceFormulaLabel(1093, "merch").includes("× 1.093 tax = $10.93 out-the-door"), "formula label shape (merch)");
  ok(priceFormulaLabel(null, "flower") === "No price set yet.", "formula label handles missing price");

  console.log(`price-correction-core: all ${passed} tests passed`);
}
