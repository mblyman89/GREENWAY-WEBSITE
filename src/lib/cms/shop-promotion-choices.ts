/**
 * src/lib/cms/shop-promotion-choices.ts  (SLICE B / SHOP-2)
 *
 * Thin server helper that turns the back office's PUBLISHED promotions into the
 * plain-object list the Shop Banner editor shows in its "Link a sale" picker,
 * plus a promotion-id → title map used to name a sidebar sale filter when the
 * owner leaves the filter name blank.
 *
 * Reuses the existing promotions reader (getPublishedPromotions), which already
 * degrades gracefully to the committed daily-deal seeds when the DB is empty or
 * unconfigured — so the picker is never blank and this needs NO migration.
 */
import "server-only";
import { getPublishedPromotions } from "@/lib/promotions/promotions-store";
import { WEEKDAY_LABELS, DISCOUNT_TYPE_LABELS } from "@/lib/promotions/types";

/** One selectable promotion in the Shop Banner "Link a sale" dropdown. */
export type ShopPromotionChoice = {
  id: string;
  /** The promotion's own title (used as the sale-filter name fallback). */
  title: string;
  /** A short, human hint shown next to the title (e.g. "Tuesday · Percent off"). */
  hint: string;
};

/**
 * Build a friendly one-line hint from a promotion's weekday + discount type, so
 * the owner can tell two similarly-named sales apart in the dropdown.
 */
function promotionHint(weekday: number | null, discountType: string): string {
  const parts: string[] = [];
  if (weekday !== null && weekday >= 0 && weekday <= 6) {
    parts.push(WEEKDAY_LABELS[weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6]);
  }
  const typeLabel = (DISCOUNT_TYPE_LABELS as Record<string, string>)[discountType];
  if (typeLabel) parts.push(typeLabel);
  return parts.join(" · ");
}

/**
 * The published promotions as editor choices, newest-priority first (that is
 * the order getPublishedPromotions already returns).
 */
export async function listShopPromotionChoices(): Promise<ShopPromotionChoice[]> {
  const promos = await getPublishedPromotions();
  return promos.map((p) => ({
    id: p.id,
    title: p.title,
    hint: promotionHint(p.weekday, p.discountType),
  }));
}

/** A promotion-id → title map for naming sale filters when the owner leaves the name blank. */
export async function getShopPromotionTitleMap(): Promise<Record<string, string>> {
  const promos = await getPublishedPromotions();
  const map: Record<string, string> = {};
  for (const p of promos) map[p.id] = p.title;
  return map;
}
