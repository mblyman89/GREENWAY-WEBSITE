/**
 * Does the below-cost guard already assume 25% for Doobie Tuesday, or would a
 * tier change quietly weaken it? The strategy report must not guess.
 */
import { worstCaseDiscountPercent } from "@/lib/promotions/promo-guard-core";

const mk = (o: Record<string, unknown>) =>
  ({
    discountType: "multi_item_tier",
    discountPercent: 20,
    discountFixed: 0,
    config: {},
    ...o,
  }) as never;

console.log(
  "today  (eitherOr 20 / 4-for-3) :",
  worstCaseDiscountPercent(mk({ config: { eitherOr: { flatPercent: 20, bundle: { n: 4, m: 3 } } } })),
  "%",
);
console.log(
  "proposed (qtyTiers 1->20, 4->25):",
  worstCaseDiscountPercent(
    mk({ config: { qtyTiers: [{ at: 1, percent: 20 }, { at: 4, percent: 25 }] } }),
  ),
  "%",
);
console.log(
  "bare multi_item_tier (defaults) :",
  worstCaseDiscountPercent(mk({ config: {} })),
  "%",
);
