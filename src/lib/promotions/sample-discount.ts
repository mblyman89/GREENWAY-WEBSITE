/**
 * src/lib/promotions/sample-discount.ts
 *
 * Pure, presentational helpers for the admin promotion previews. These compute
 * an ILLUSTRATIVE discounted price purely so staff can see what a sale badge
 * will look like on a product card. This is NOT the authoritative cart engine
 * (complex tiers/BOGO/baskets are resolved at checkout) — for those types we
 * show the rule label rather than a fake single-item number.
 */
import type { DiscountType } from "./types";

export type SampleDiscount = {
  /** Whether a simple per-item discounted price can be shown. */
  showsPrice: boolean;
  /** Discounted price in minor units (only when showsPrice). */
  saleMinorUnits: number;
  /** Short badge text, e.g. "20% OFF" or "BOGO". */
  badge: string;
};

export function sampleDiscount(
  priceMinorUnits: number,
  opts: { discountType: DiscountType; discountPercent: number; discountFixed: number; multiItemPercent: number | null },
): SampleDiscount {
  const { discountType, discountPercent, discountFixed, multiItemPercent } = opts;

  switch (discountType) {
    case "percent": {
      const pct = Math.max(0, Math.min(100, discountPercent));
      const sale = Math.round(priceMinorUnits * (1 - pct / 100));
      return { showsPrice: pct > 0, saleMinorUnits: sale, badge: pct > 0 ? `${pct}% OFF` : "SALE" };
    }
    case "fixed": {
      const off = Math.max(0, discountFixed);
      const sale = Math.max(0, priceMinorUnits - off);
      return { showsPrice: off > 0, saleMinorUnits: sale, badge: "SALE" };
    }
    case "bogo":
      return { showsPrice: false, saleMinorUnits: priceMinorUnits, badge: "BOGO" };
    case "threshold_spend":
      return { showsPrice: false, saleMinorUnits: priceMinorUnits, badge: discountPercent > 0 ? `${discountPercent}% AT THRESHOLD` : "SPEND DEAL" };
    case "multi_item_tier":
      return {
        showsPrice: false,
        saleMinorUnits: priceMinorUnits,
        badge: multiItemPercent ? `${multiItemPercent}% MULTI-BUY` : "MULTI-BUY",
      };
    case "weight_tier":
      return { showsPrice: false, saleMinorUnits: priceMinorUnits, badge: "WEIGHT DEAL" };
    case "basket":
      return { showsPrice: false, saleMinorUnits: priceMinorUnits, badge: "BASKET DEAL" };
    default:
      return { showsPrice: false, saleMinorUnits: priceMinorUnits, badge: "SALE" };
  }
}
