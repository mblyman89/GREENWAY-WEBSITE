// ---------------------------------------------------------------------------
// SMART CART DISCOUNT ENGINE
//
// The product cards show a best-case "preview" of the day's deal, but the
// AUTHORITATIVE discount is computed HERE, at the cart level, because most of
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
import {
  munchieMondayCategories,
  ounceFridayCategories,
  topShelfThursdayBrands,
  tuesdayDoobieCategories,
  waxWednesdayCategories,
} from "@/lib/specials/daily-deals";

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
  // Ounce tokens (oz / ounce). 1oz == 28g (industry standard cannabis ounce).
  const ozMatch = normalized.match(/([\d.]+)\s*(oz|ounce)/);
  if (ozMatch) return parseFloat(ozMatch[1]) * 28;
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

/** Doobie Tuesday qty tier -> percent. 1 item = 0%, 2-3 = 15%, 4+ = 25%. */
function doobieTuesdayPercentForQty(totalQty: number): number {
  if (totalQty >= 4) return 25;
  if (totalQty >= 2) return 15;
  return 0;
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
  const discounted = round(line.regularPriceMinorUnits * (1 - percent / 100));
  return {
    lineId: line.lineId,
    unitPriceMinorUnits: discounted,
    regularPriceMinorUnits: line.regularPriceMinorUnits,
    quantity: line.quantity,
    unitSavingsMinorUnits: line.regularPriceMinorUnits - discounted,
    appliedLabel: `${label} · ${percent}% off`,
    appliedPercent: percent,
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
      // Doobie Tuesday: quantity-tiered across all eligible preroll lines.
      const eligible = cartLines.filter((l) => !isMerchOrAccessory(l) && matchesCategories(l, tuesdayDoobieCategories));
      const totalQty = eligible.reduce((sum, l) => sum + l.quantity, 0);
      const percent = doobieTuesdayPercentForQty(totalQty);
      for (const line of eligible) resultMap.set(line.lineId, applyPercentLine(line, percent, "Doobie Tuesday"));
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
      // Super Saturday: 30% off the single most-expensive eligible UNIT,
      // 15% off everything else (storewide cannabis). Merch/accessories excluded.
      const eligible = cartLines.filter((l) => !isMerchOrAccessory(l));
      // Find the most expensive eligible unit to receive the 30% headline deal.
      let topLineId: string | null = null;
      let topUnitPrice = -1;
      for (const line of eligible) {
        if (line.regularPriceMinorUnits > topUnitPrice) {
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
            const blendedUnit = round(blendedTotal / line.quantity);
            resultMap.set(line.lineId, {
              lineId: line.lineId,
              unitPriceMinorUnits: blendedUnit,
              regularPriceMinorUnits: line.regularPriceMinorUnits,
              quantity: line.quantity,
              unitSavingsMinorUnits: line.regularPriceMinorUnits - blendedUnit,
              appliedLabel: "Super Saturday · 30% top item + 15%",
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
      // Ice Cream Sunday: buy 3 for the price of 2 (cheapest free) per group of
      // 3 across all eligible cannabis units. Distribute the savings per line.
      const eligible = cartLines.filter((l) => !isMerchOrAccessory(l));
      // Expand into per-unit prices, ascending so the cheapest are made free.
      const units: { lineId: string; price: number }[] = [];
      for (const line of eligible) {
        for (let i = 0; i < line.quantity; i += 1) units.push({ lineId: line.lineId, price: line.regularPriceMinorUnits });
      }
      units.sort((a, b) => a.price - b.price);
      const freeCount = Math.floor(units.length / 3);
      const savingsByLine = new Map<string, number>();
      for (let i = 0; i < freeCount; i += 1) {
        const freeUnit = units[i];
        savingsByLine.set(freeUnit.lineId, (savingsByLine.get(freeUnit.lineId) ?? 0) + freeUnit.price);
      }
      for (const line of eligible) {
        const lineSavings = savingsByLine.get(line.lineId) ?? 0;
        if (lineSavings <= 0) continue;
        const regularLineTotal = line.regularPriceMinorUnits * line.quantity;
        const discountedLineTotal = Math.max(0, regularLineTotal - lineSavings);
        const blendedUnit = round(discountedLineTotal / line.quantity);
        resultMap.set(line.lineId, {
          lineId: line.lineId,
          unitPriceMinorUnits: blendedUnit,
          regularPriceMinorUnits: line.regularPriceMinorUnits,
          quantity: line.quantity,
          unitSavingsMinorUnits: line.regularPriceMinorUnits - blendedUnit,
          appliedLabel: "Ice Cream Sunday · 3 for 2",
          appliedPercent: 0,
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
