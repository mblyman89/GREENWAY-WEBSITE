// ---------------------------------------------------------------------------
// LEGACY STATIC WEEKDAY CART ENGINE — REFERENCE IMPLEMENTATION (Task T / PR 1)
//
// PROMOTIONS HARMONY: production no longer prices with this module. The cart
// (CartProvider), the server reprice (order-pricing.ts), the product cards and
// the register ALL use the data-driven rules engine
// (src/lib/promotions/discount-engine-core.ts) fed by the back office's
// PUBLISHED promotions, with the committed daily-deal seeds as the zero-blank
// fallback. This file remains as the PINNED REFERENCE for the seed deals'
// behaviour: tests/compliance/promotions-harmony-parity.test.ts asserts the
// rules engine (with seed rules) produces IDENTICAL prices to this engine, so
// the storefront migration is provably behaviour-preserving.
//
// The product cards show a best-case "preview" of the day's deal, but the
// AUTHORITATIVE discount is computed at the cart level, because most of
// Greenway's daily deals are threshold-based (weight tiers, quantity tiers,
// spend tiers, or storewide best-item) and CANNOT be determined from a single
// product in isolation.
//
// Example (Ounce Friday — weight tiered):
//   - A single 3.5g bag earns NO discount.
//   - 2 × 3.5g  = 7g  (quarter) -> 15% off the eligible flower.
//   - 4 × 3.5g  = 14g (half)    -> 20% off the eligible flower.
//   - 8 × 3.5g  = 28g (ounce)   -> 30% off the eligible flower.
//
// This module is pure (no React, no DOM) so it can be unit-tested and reused by
// the cart, checkout, and confirmation screens.
// ---------------------------------------------------------------------------

import type { GreenwayCategory } from "@/lib/leafly/types";
import type { StoreWeekday } from "@/lib/specials/daily-deals";
import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";
import {
  munchieMondayCategories,
  ounceFridayCategories,
  topShelfThursdayBrands,
  tuesdayDoobieCategories,
  waxWednesdayCategories,
} from "@/lib/specials/daily-deals";
import {
  clampCannabisUnitPrice,
  isNonCannabisCategory,
  TAX_INCLUSIVE_DIVISOR,
  NON_CANNABIS_TAX_INCLUSIVE_DIVISOR,
} from "@/lib/orders/order-pricing-core";

export type DiscountCartLine = {
  lineId: string;
  /** TRUE regular (pre-discount) per-unit price, tax-inclusive. */
  regularPriceMinorUnits: number;
  quantity: number;
  category: GreenwayCategory;
  /** Synthetic browse categories an item belongs to (preferred for matching). */
  filterCategories?: GreenwayCategory[];
  /** Variant label, e.g. "3.5g", "7g", "1oz" — used for weight-tiered deals. */
  variantLabel?: string;
  brand?: string;
  /**
   * Acquisition cost per unit, PRE-TAX vendor cost in minor units, when known
   * (server reprice attaches the weighted-average lot cost). Drives the CCRS
   * cost floor: "may not discount the sale price below the cost of acquisition"
   * (CCRS Upload User Guide — see docs/PROMOTIONS_COMPLIANCE.md). The client
   * cart preview does not know costs; the below-cost audit in /admin/promotions
   * keeps published deals clear of the floor so the clamp never binds live.
   */
  costMinorUnits?: number | null;
};

export type DiscountedLineResult = {
  lineId: string;
  /** Discounted per-unit price (tax-inclusive). Equals regular when no deal. */
  unitPriceMinorUnits: number;
  regularPriceMinorUnits: number;
  quantity: number;
  /** Per-unit savings (regular - discounted). */
  unitSavingsMinorUnits: number;
  /** Discount label applied to this line, if any (e.g. "Ounce Friday · 30%"). */
  appliedLabel?: string;
  appliedPercent: number;
};

export type CartDiscountResult = {
  lines: DiscountedLineResult[];
  totalRegularMinorUnits: number;
  totalDiscountedMinorUnits: number;
  totalSavingsMinorUnits: number;
};

// ---------------------------------------------------------------------------
// Weight parsing for flower deals
// ---------------------------------------------------------------------------

/** Convert a variant label to grams. "1oz" => 28, "3.5g" => 3.5, "1g" => 1. */
export function gramsForLabel(label?: string): number {
  if (!label) return 0;
  const normalized = label.trim().toLowerCase();
  // Ounce tokens (oz / ounce). 1oz == 28g (WA statutory equivalence, GW-016).
  const ozMatch = normalized.match(/([\d.]+)\s*(oz|ounce)/);
  if (ozMatch) return parseFloat(ozMatch[1]) * STATUTORY_GRAMS_PER_OUNCE;
  // Gram tokens.
  const gMatch = normalized.match(/([\d.]+)\s*g\b/);
  if (gMatch) return parseFloat(gMatch[1]);
  return 0;
}

function lineCategories(line: DiscountCartLine): GreenwayCategory[] {
  return line.filterCategories?.length ? line.filterCategories : [line.category];
}

function matchesCategories(line: DiscountCartLine, categories: GreenwayCategory[]): boolean {
  return lineCategories(line).some((category) => categories.includes(category));
}

function round(value: number): number {
  return Math.round(value);
}

// ---------------------------------------------------------------------------
// Tier helpers
// ---------------------------------------------------------------------------

/** Ounce Friday weight tier (in grams) -> discount percent. Below 7g = 0%. */
function ounceFridayPercentForGrams(totalGrams: number): number {
  if (totalGrams >= 28) return 30; // full ounce
  if (totalGrams >= 14) return 20; // half ounce
  if (totalGrams >= 7) return 15; // quarter ounce
  return 0;
}

// ---------------------------------------------------------------------------
// CCRS COST FLOOR (Task R) — "may not discount the sale price below the cost
// of acquisition" (CCRS Upload User Guide, Sale.csv Discount field).
// Costs are PRE-TAX vendor costs; card prices are tax-INCLUSIVE, so the floor
// on the charged unit price is ceil(cost × divisor) — rounded UP so revenue
// can never round below cost (store-advantaged).
// ---------------------------------------------------------------------------

/** Tax-inclusive floor implied by a pre-tax acquisition cost. 0 when unknown. */
export function costFloorForLine(line: DiscountCartLine): number {
  const cost = line.costMinorUnits;
  if (cost == null || !Number.isFinite(cost) || cost <= 0) return 0;
  const divisor = isNonCannabisCategory(line.category)
    ? NON_CANNABIS_TAX_INCLUSIVE_DIVISOR
    : TAX_INCLUSIVE_DIVISOR;
  // Never raise a price ABOVE regular — a regular price at/below cost is a
  // pricing problem the below-cost audit surfaces; the engine only refuses to
  // discount further.
  return Math.min(Math.ceil(cost * divisor), Math.max(0, line.regularPriceMinorUnits));
}

/** Clamp a discounted unit price to the statutory floor AND the cost floor. */
function clampLineUnit(line: DiscountCartLine, unitPrice: number): number {
  const statutory = clampCannabisUnitPrice(line.category, unitPrice, line.regularPriceMinorUnits);
  if (!isNonCannabisCategory(line.category) && line.regularPriceMinorUnits <= 0) return statutory;
  return Math.max(statutory, costFloorForLine(line));
}

/** Wax Wednesday spend tier (eligible regular spend, minor units) -> percent. */
function waxWednesdayPercentForSpend(spendMinorUnits: number): number {
  if (spendMinorUnits >= 15000) return 30; // $150+
  if (spendMinorUnits >= 10000) return 20; // $100+
  if (spendMinorUnits >= 5000) return 15; // $50+
  return 0;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function noDiscountLine(line: DiscountCartLine): DiscountedLineResult {
  return {
    lineId: line.lineId,
    unitPriceMinorUnits: line.regularPriceMinorUnits,
    regularPriceMinorUnits: line.regularPriceMinorUnits,
    quantity: line.quantity,
    unitSavingsMinorUnits: 0,
    appliedPercent: 0,
  };
}

function applyPercentLine(line: DiscountCartLine, percent: number, label: string): DiscountedLineResult {
  if (percent <= 0) return noDiscountLine(line);
  // GLOBAL CANNABIS PRICE FLOOR (RCW 69.50.357): a cannabis unit can never be
  // discounted to $0. Percent is also capped below 100 for cannabis lines.
  // CCRS COST FLOOR: never below the acquisition cost when the cost is known.
  const cappedPercent = Math.min(percent, 99);
  const raw = round(line.regularPriceMinorUnits * (1 - cappedPercent / 100));
  const discounted = clampLineUnit(line, raw);
  return {
    lineId: line.lineId,
    unitPriceMinorUnits: discounted,
    regularPriceMinorUnits: line.regularPriceMinorUnits,
    quantity: line.quantity,
    unitSavingsMinorUnits: line.regularPriceMinorUnits - discounted,
    appliedLabel: `${label} · ${cappedPercent}% off`,
    appliedPercent: cappedPercent,
  };
}

/**
 * Compute authoritative per-line discounts for the whole cart based on the
 * active weekday's deal rules. Non-cannabis items (merch/accessories) never
 * receive daily-deal discounts.
 */
export function computeCartDiscounts(
  cartLines: DiscountCartLine[],
  weekday: StoreWeekday,
): CartDiscountResult {
  // Default: every line at regular price.
  const resultMap = new Map<string, DiscountedLineResult>();
  for (const line of cartLines) resultMap.set(line.lineId, noDiscountLine(line));

  const isMerchOrAccessory = (line: DiscountCartLine) =>
    matchesCategories(line, ["merch", "accessories", "paraphernalia"]);

  switch (weekday) {
    case "monday": {
      // Munchie Monday: flat 25% off eligible categories (per-item).
      for (const line of cartLines) {
        if (isMerchOrAccessory(line)) continue;
        if (matchesCategories(line, munchieMondayCategories)) {
          resultMap.set(line.lineId, applyPercentLine(line, 25, "Munchie Monday"));
        }
      }
      break;
    }
    case "tuesday": {
      // Doobie Tuesday (Task R, owner-specified): 20% off prerolls & blunts OR
      // buy 4 for the price of 3 mix & match — WHICHEVER SAVES THE CUSTOMER
      // LESS when both qualify (store-advantaged; deterministic and identical
      // for every customer, so it stays "available to all who meet the
      // discount conditions" per the CCRS guide).
      //
      // The 4-for-3 option is COMPLIANT like Sunday: the cheapest unit per
      // full group of 4 sets the savings target, converted to an equivalent
      // whole-number percent (floor) SPREAD across all eligible lines so no
      // unit is ever free or below cost.
      const eligible = cartLines.filter((l) => !isMerchOrAccessory(l) && matchesCategories(l, tuesdayDoobieCategories));
      if (eligible.length === 0) break;

      // Option A — flat 20% (applies from qty 1).
      const flatPercent = 20;
      let flatSavings = 0;
      for (const line of eligible) {
        const d = applyPercentLine(line, flatPercent, "Doobie Tuesday");
        flatSavings += d.unitSavingsMinorUnits * line.quantity;
      }

      // Option B — 4-for-3 mix & match spread (needs 4+ eligible units).
      const units: number[] = [];
      let eligibleTotal = 0;
      for (const line of eligible) {
        eligibleTotal += line.regularPriceMinorUnits * line.quantity;
        for (let i = 0; i < line.quantity; i += 1) units.push(line.regularPriceMinorUnits);
      }
      units.sort((a, b) => a - b);
      const groups = Math.floor(units.length / 4);
      let bundleTarget = 0;
      for (let i = 0; i < groups; i += 1) bundleTarget += units[i];
      const bundlePercent =
        groups > 0 && eligibleTotal > 0
          ? Math.min(99, Math.floor((bundleTarget / eligibleTotal) * 100))
          : 0;
      let bundleSavings = 0;
      if (bundlePercent > 0) {
        for (const line of eligible) {
          const d = applyPercentLine(line, bundlePercent, "Doobie Tuesday");
          bundleSavings += d.unitSavingsMinorUnits * line.quantity;
        }
      }

      // Store-advantaged pick: the SMALLER positive savings wins; a
      // zero-savings option never beats a positive one.
      let percent = 0;
      let bundleChosen = false;
      if (flatSavings > 0 && (bundleSavings <= 0 || flatSavings <= bundleSavings)) {
        percent = flatPercent;
      } else if (bundleSavings > 0) {
        percent = bundlePercent;
        bundleChosen = true;
      }
      if (percent <= 0) break;
      for (const line of eligible) {
        const d = applyPercentLine(line, percent, "Doobie Tuesday");
        resultMap.set(
          line.lineId,
          bundleChosen
            ? { ...d, appliedLabel: `Doobie Tuesday · 4 for 3 (${percent}% spread)` }
            : d,
        );
      }
      break;
    }
    case "wednesday": {
      // Wax Wednesday: spend-tiered across all eligible concentrate/vape lines.
      const eligible = cartLines.filter((l) => !isMerchOrAccessory(l) && matchesCategories(l, waxWednesdayCategories));
      const spend = eligible.reduce((sum, l) => sum + l.regularPriceMinorUnits * l.quantity, 0);
      const percent = waxWednesdayPercentForSpend(spend);
      for (const line of eligible) resultMap.set(line.lineId, applyPercentLine(line, percent, "Wax Wednesday"));
      break;
    }
    case "thursday": {
      // Top Shelf Thursday: flat 25% off featured brands (per-item).
      const brands = topShelfThursdayBrands.map((b) => b.trim().toLowerCase());
      for (const line of cartLines) {
        if (isMerchOrAccessory(line)) continue;
        if (line.brand && brands.includes(line.brand.trim().toLowerCase())) {
          resultMap.set(line.lineId, applyPercentLine(line, 25, "Top Shelf Thursday"));
        }
      }
      break;
    }
    case "friday": {
      // Ounce Friday: weight-tiered across all eligible flower lines.
      const eligible = cartLines.filter((l) => !isMerchOrAccessory(l) && matchesCategories(l, ounceFridayCategories));
      const totalGrams = eligible.reduce((sum, l) => sum + gramsForLabel(l.variantLabel) * l.quantity, 0);
      const percent = ounceFridayPercentForGrams(totalGrams);
      for (const line of eligible) resultMap.set(line.lineId, applyPercentLine(line, percent, "Ounce Friday"));
      break;
    }
    case "saturday": {
      // Super Saturday: 30% off ONE eligible unit + 15% off everything else
      // (storewide cannabis; merch/accessories excluded). STORE-FAVORABLE
      // (owner directive): the 30% headline lands on the single LOWEST-priced
      // eligible unit — never on the most expensive item in a multi-item cart.
      const eligible = cartLines.filter((l) => !isMerchOrAccessory(l));
      // Find the LOWEST-priced eligible unit to receive the 30% headline deal.
      let topLineId: string | null = null;
      let topUnitPrice = Number.POSITIVE_INFINITY;
      for (const line of eligible) {
        if (line.regularPriceMinorUnits < topUnitPrice) {
          topUnitPrice = line.regularPriceMinorUnits;
          topLineId = line.lineId;
        }
      }
      for (const line of eligible) {
        if (line.lineId === topLineId) {
          // Split the line: 1 unit at 30%, the rest at 15% (blended per-unit).
          if (line.quantity <= 1) {
            resultMap.set(line.lineId, applyPercentLine(line, 30, "Super Saturday"));
          } else {
            const oneAt30 = round(line.regularPriceMinorUnits * 0.7);
            const restAt15 = round(line.regularPriceMinorUnits * 0.85);
            const blendedTotal = oneAt30 + restAt15 * (line.quantity - 1);
            const blendedUnit = clampLineUnit(line, round(blendedTotal / line.quantity));
            resultMap.set(line.lineId, {
              lineId: line.lineId,
              unitPriceMinorUnits: blendedUnit,
              regularPriceMinorUnits: line.regularPriceMinorUnits,
              quantity: line.quantity,
              unitSavingsMinorUnits: line.regularPriceMinorUnits - blendedUnit,
              appliedLabel: "Super Saturday · 30% one item + 15%",
              appliedPercent: 15,
            });
          }
        } else {
          resultMap.set(line.lineId, applyPercentLine(line, 15, "Super Saturday"));
        }
      }
      break;
    }
    case "sunday": {
      // Ice Cream Sunday — COMPLIANT "3 for 2 equivalent" (RCW 69.50.357 / WAC
      // 314-55-155): a licensee may not give cannabis away, so instead of
      // making the cheapest unit FREE we convert the same total savings into
      // an equivalent PERCENT spread across the whole eligible basket. Every
      // unit keeps a positive price; the customer pays the same "3 for the
      // price of 2" total.
      const eligible = cartLines.filter((l) => !isMerchOrAccessory(l));
      const units: { price: number }[] = [];
      let eligibleRegularTotal = 0;
      for (const line of eligible) {
        eligibleRegularTotal += line.regularPriceMinorUnits * line.quantity;
        for (let i = 0; i < line.quantity; i += 1) units.push({ price: line.regularPriceMinorUnits });
      }
      units.sort((a, b) => a.price - b.price);
      const groupCount = Math.floor(units.length / 3);
      if (groupCount <= 0 || eligibleRegularTotal <= 0) break;
      let targetSavings = 0;
      for (let i = 0; i < groupCount; i += 1) targetSavings += units[i].price;
      // Equivalent basket-wide percent (capped so no unit ever reaches $0).
      const percent = Math.min(99, Math.floor((targetSavings / eligibleRegularTotal) * 100));
      if (percent <= 0) break;
      for (const line of eligible) {
        const raw = round(line.regularPriceMinorUnits * (1 - percent / 100));
        const discounted = clampLineUnit(line, raw);
        resultMap.set(line.lineId, {
          lineId: line.lineId,
          unitPriceMinorUnits: discounted,
          regularPriceMinorUnits: line.regularPriceMinorUnits,
          quantity: line.quantity,
          unitSavingsMinorUnits: line.regularPriceMinorUnits - discounted,
          appliedLabel: `Ice Cream Sunday · 3-for-2 equivalent (${percent}% off basket)`,
          appliedPercent: percent,
        });
      }
      break;
    }
    default:
      break;
  }

  const lines = cartLines.map((line) => resultMap.get(line.lineId) ?? noDiscountLine(line));
  const totalRegularMinorUnits = lines.reduce((sum, l) => sum + l.regularPriceMinorUnits * l.quantity, 0);
  const totalDiscountedMinorUnits = lines.reduce((sum, l) => sum + l.unitPriceMinorUnits * l.quantity, 0);
  const totalSavingsMinorUnits = Math.max(0, totalRegularMinorUnits - totalDiscountedMinorUnits);

  return { lines, totalRegularMinorUnits, totalDiscountedMinorUnits, totalSavingsMinorUnits };
}
