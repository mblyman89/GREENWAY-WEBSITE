/**
 * src/lib/promotions/types.ts
 *
 * Shared types for the Slice 6 Promotions/Specials manager. Mirrors the
 * 0006_slice6_promotions.sql schema. PostStatus is reused from the CMS slice.
 */
import type { PostStatus } from "@/lib/cms/types";
import type { GreenwayCategory } from "@/lib/leafly/types";

export type { PostStatus };

export type DiscountType =
  | "percent"
  | "fixed"
  | "bogo"
  | "threshold_spend"
  | "multi_item_tier"
  | "weight_tier"
  | "basket";

export type PromoScope = "all" | "category" | "brand" | "product";

/** 0 = Sunday … 6 = Saturday (matches Date.getDay()). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

export type PromotionRow = {
  id: string;
  promo_key: string | null;
  title: string;
  description: string | null;
  status: PostStatus;
  discount_type: DiscountType;
  discount_percent: number;
  discount_fixed: number;
  multi_item_percent: number | null;
  config: Record<string, unknown>;
  per_item_sale: boolean;
  bonus_note: string | null;
  weekday: Weekday | null;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
  published_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PromotionTargetRow = {
  id: string;
  promotion_id: string;
  scope: PromoScope;
  value: string | null;
  created_at: string;
};

export type PromotionExclusionRow = {
  id: string;
  promotion_id: string;
  scope: PromoScope;
  value: string | null;
  created_at: string;
};

export type PromotionAuditSnapshotRow = {
  id: string;
  promotion_id: string;
  snapshot: Record<string, unknown>;
  affected_count: number;
  taken_by: string | null;
  taken_at: string;
};

/** A promotion joined with its targets + exclusions (the editable unit). */
export type PromotionWithRules = PromotionRow & {
  targets: PromotionTargetRow[];
  exclusions: PromotionExclusionRow[];
};

/**
 * The shape the public front-end / cart engine consumes for a published
 * promotion — a normalized, framework-agnostic rule object. The static
 * daily-deals fallback is mapped into this same shape so the reader never
 * returns empty.
 */
export type PublishedPromotion = {
  id: string;
  promoKey: string | null;
  title: string;
  description: string | null;
  discountType: DiscountType;
  discountPercent: number;
  discountFixed: number;
  multiItemPercent: number | null;
  perItemSale: boolean;
  bonusNote: string | null;
  weekday: Weekday | null;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  targetCategories: GreenwayCategory[];
  targetBrands: string[];
  targetProductKeys: string[];
  storewide: boolean;
  excludeCategories: GreenwayCategory[];
  excludeBrands: string[];
  excludeProductKeys: string[];
};

export const DISCOUNT_TYPE_LABELS: Record<DiscountType, string> = {
  percent: "Percent off",
  fixed: "Fixed amount off",
  bogo: "BOGO (buy one get one)",
  threshold_spend: "Spend threshold (% off at $X)",
  multi_item_tier: "Multi-item tier (qty)",
  weight_tier: "Weight tier (oz/half/quarter)",
  basket: "Basket deal (e.g. 3 for 2)",
};
