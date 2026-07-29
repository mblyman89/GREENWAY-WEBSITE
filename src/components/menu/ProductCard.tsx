"use client";

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { menuCardDiscountForItem } from "@/lib/promotions/published-rules-core";
import { menuCardBadgeForItem } from "@/lib/promotions/deal-badge-core";
import { useActiveDealRules } from "@/components/promotions/PublishedRulesProvider";
import { useStoreWeekday } from "@/lib/specials/useStoreWeekday";
import { ProductCardVisual } from "./ProductCardVisual";

export function ProductCard({ item }: { item: GreenwayMenuItem }) {
  // PROMOTIONS HARMONY (Task T / PR 1): the card preview derives from the back
  // office's PUBLISHED promotion rules (seed fallback) — the same rules the
  // cart and the register charge with.
  //
  // SLICE 40 (owner directive): Friday/Saturday/Sunday deals are basket-
  // dependent (weight tiers / one-item split / 3-for-2), so cards show the
  // REGULAR price those days and the cart reveals the savings once the basket
  // qualifies. Monday–Thursday keep the struck card price (clean category /
  // featured-brand deals). menuCardDiscountForItem applies that policy; the
  // cart engine itself is untouched.
  const activeRules = useActiveDealRules();
  const weekday = useStoreWeekday();
  const activeDiscount = menuCardDiscountForItem(item, activeRules, weekday);
  // SLICE 96 (owner directive): every card shows the deal BADGE whenever an
  // active published rule is relevant to the item — Mon edibles+drinks, Tue
  // prerolls/blunts incl. infused, Wed carts/concentrates, Thu featured
  // brands, Fri flower, Sat+Sun storewide, plus any flash sale staff publish.
  // The badge is an honest advertisement of the deal, independent of the
  // struck price (which SLICE 40 still hides Fri/Sat/Sun — basket-dependent).
  const badge = menuCardBadgeForItem(item, activeRules, weekday);
  return (
    <ProductCardVisual
      item={item}
      salePriceMinorUnits={activeDiscount?.cardPreviewSalePriceMinorUnits}
      saleBadgeLabel={badge}
    />
  );
}
