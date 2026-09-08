/**
 * src/lib/promotions/published-rules-core.ts  (Task T / PR 1 — Promotions Harmony)
 *
 * PURE bridge between the back office's published promotions and EVERY surface
 * that prices or previews a deal (no React, no DB, no server-only) — closing
 * gap G-1 (the split-brain where the register priced carts with the DB rules
 * engine while the website priced with the static weekday engine).
 *
 * The design: the server serialises published promotions (rules + parsed
 * configs + presentation fields) into JSON-safe PublishedRuleSnapshot[] once
 * per render (see loadPublishedRuleSnapshots in discount-engine.ts). The
 * snapshot travels to the client, where these pure helpers
 *
 *  - resolve which rules are ACTIVE for the store's current weekday
 *    (activeSnapshotsFor), and
 *  - feed the SAME pure engine the register uses (computePromotions in
 *    discount-engine-core.ts) for cart pricing, and
 *  - derive the per-product card preview (menuDiscountForItem) that replaces
 *    the hard-coded getActiveMenuDiscount weekday switch.
 *
 * ZERO-BLANK GUARANTEE: seedRuleSnapshots() maps the committed daily-deal
 * seeds (daily-deal-seed.ts + the seed engine configs) so every consumer has
 * an authorable fallback when the DB is empty or unconfigured — behaviour is
 * identical to the legacy static engine until staff publish an override
 * (parity is pinned in tests/compliance/promotions-harmony-parity.test.ts).
 *
 * This module also owns the pure promotion helpers that used to live in the
 * server-only discount-engine.ts (parseEngineConfig, promotionToRule,
 * isActiveNow, seedConfigFor) so the client may share them; discount-engine.ts
 * re-exports everything for existing importers.
 */
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import type { PublishedPromotion, Weekday } from "./types";
import type { DiscountType } from "./types";
import { storeWeekday } from "@/lib/reports/timezone";
import type { StoreWeekday } from "@/lib/specials/daily-deals";
import {
  getDailyDealPresentation,
  type DailyDealPresentation,
} from "@/lib/specials/daily-deal-presentation";
import { DAILY_DEAL_SEEDS } from "./daily-deal-seed";
import {
  ruleMatchesLine,
  DEFAULT_QTY_TIERS,
  DEFAULT_SPEND_TIERS,
  DEFAULT_WEIGHT_TIERS,
  type EngineCartLine,
  type EngineConfig,
  type EngineRule,
  type Tier,
} from "./discount-engine-core";

// ---------------------------------------------------------------------------
// Weekday mapping (0=Sunday … 6=Saturday  <->  store weekday strings)
// ---------------------------------------------------------------------------

export const STORE_WEEKDAY_TO_INDEX: Record<StoreWeekday, Weekday> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export const INDEX_TO_STORE_WEEKDAY: Record<Weekday, StoreWeekday> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

// ---------------------------------------------------------------------------
// Config parsing (moved from discount-engine.ts — pure, shared client/server)
// ---------------------------------------------------------------------------

/** Safely coerce an unknown JSON value into a Tier[]. */
function parseTiers(value: unknown): Tier[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tiers: Tier[] = [];
  for (const t of value) {
    if (t && typeof t === "object") {
      const at = Number((t as Record<string, unknown>).at);
      const percent = Number((t as Record<string, unknown>).percent);
      if (Number.isFinite(at) && Number.isFinite(percent)) tiers.push({ at, percent });
    }
  }
  return tiers.length ? tiers : undefined;
}

/** Parse a promotion's raw config jsonb into the typed EngineConfig. */
export function parseEngineConfig(config: Record<string, unknown> | null | undefined): EngineConfig {
  const c = config ?? {};
  const out: EngineConfig = {};
  out.qtyTiers = parseTiers(c.qtyTiers);
  out.weightTiers = parseTiers(c.weightTiers);
  out.spendTiers = parseTiers(c.spendTiers);

  if (c.bogo && typeof c.bogo === "object") {
    const b = c.bogo as Record<string, unknown>;
    out.bogo = {
      buyQty: Number(b.buyQty) || 1,
      getQty: Number(b.getQty) || 1,
      getPercent: Number(b.getPercent) || 100,
    };
  }
  if (c.basketNforM && typeof c.basketNforM === "object") {
    const n = c.basketNforM as Record<string, unknown>;
    out.basketNforM = { n: Number(n.n) || 3, m: Number(n.m) || 2 };
  }
  if (c.basketTopItem && typeof c.basketTopItem === "object") {
    const t = c.basketTopItem as Record<string, unknown>;
    out.basketTopItem = { topPercent: Number(t.topPercent) || 0, restPercent: Number(t.restPercent) || 0 };
  }
  if (c.eitherOr && typeof c.eitherOr === "object") {
    const e = c.eitherOr as Record<string, unknown>;
    const bundle = (e.bundle && typeof e.bundle === "object" ? e.bundle : {}) as Record<string, unknown>;
    const flatPercent = Number(e.flatPercent) || 0;
    const n = Number(bundle.n) || 0;
    const m = Number(bundle.m);
    if (flatPercent > 0 && n >= 2 && Number.isFinite(m) && m >= 0 && m < n) {
      out.eitherOr = { flatPercent, bundle: { n, m } };
    }
  }
  // NOTE: legacy `stackable` configs are intentionally IGNORED — discount
  // stacking is hard-blocked (owner directive; see docs/PROMOTIONS_COMPLIANCE.md).
  return out;
}

/** Engine config for the committed daily-deal seeds (DB-empty fallback). */
export function seedConfigFor(promoKey: string | null): EngineConfig {
  switch (promoKey) {
    case "daily.tuesday": {
      // Doobie Tuesday (SLICE D1): 1-3 prerolls 20%, 4+ 25%. This replaces an
      // eitherOr config that resolved to whichever option saved the customer
      // LESS, which made the advertised 4-for-3 unreachable and dropped a
      // 6-preroll cart to 16%.
      //
      // DERIVED from the seed row rather than restated here: seedRuleSnapshots()
      // builds config from this function and ignores the seed's own fields, so
      // hand-writing the tiers in both places would let them silently diverge.
      // The seed is the single source of truth; this reads it.
      const tiers = DAILY_DEAL_SEEDS.find((s) => s.promoKey === "daily.tuesday")?.qtyTiers;
      return tiers?.length ? { qtyTiers: tiers.map((t) => ({ ...t })) } : {};
    }
    case "daily.saturday":
      return { basketTopItem: { topPercent: 30, restPercent: 15 } };
    case "daily.sunday":
      return { basketNforM: { n: 3, m: 2 } };
    default:
      return {};
  }
}

/**
 * Map a PublishedPromotion into an EngineRule. PublishedPromotion does NOT carry
 * the raw `config` jsonb, so the config starts empty here; loadActiveRules
 * re-attaches the parsed config from the DB for active rows.
 */
export function promotionToRule(p: PublishedPromotion, config: EngineConfig = {}): EngineRule {
  return {
    id: p.id,
    title: p.title,
    discountType: p.discountType,
    discountPercent: p.discountPercent,
    discountFixed: p.discountFixed,
    priority: p.priority,
    storewide: p.storewide,
    targetCategories: p.targetCategories,
    targetBrands: p.targetBrands,
    targetProductKeys: p.targetProductKeys,
    excludeCategories: p.excludeCategories,
    excludeBrands: p.excludeBrands,
    excludeProductKeys: p.excludeProductKeys,
    config,
  };
}

/** Is a published promotion active at `when`? (weekday recurring OR date window) */
export function isActiveNow(p: PublishedPromotion, when: Date): boolean {
  if (p.weekday != null) {
    // S-12: weekday recurring promos follow the STORE's (Pacific) weekday.
    // Server-local getDay() drifts ~7-8h/day on UTC hosts, making the
    // advertised deal differ from the charged deal in the evening.
    return p.weekday === (storeWeekday(when) as Weekday);
  }
  const startsOk = !p.startsAt || new Date(p.startsAt).getTime() <= when.getTime();
  const endsOk = !p.endsAt || new Date(p.endsAt).getTime() >= when.getTime();
  // A promo with neither a weekday nor a window is treated as always-on.
  if (!p.startsAt && !p.endsAt) return true;
  return startsOk && endsOk;
}

// ---------------------------------------------------------------------------
// The serialisable snapshot — a published promotion + its parsed engine config
// + the presentation fields the storefront shows (JSON-safe, client-friendly).
// ---------------------------------------------------------------------------

export type PublishedRuleSnapshot = {
  id: string;
  promoKey: string | null;
  title: string;
  description: string | null;
  discountType: DiscountType;
  discountPercent: number;
  discountFixed: number;
  perItemSale: boolean;
  bonusNote: string | null;
  weekday: Weekday | null;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  storewide: boolean;
  targetCategories: string[];
  targetBrands: string[];
  targetProductKeys: string[];
  excludeCategories: string[];
  excludeBrands: string[];
  excludeProductKeys: string[];
  config: EngineConfig;
};

/** Build a snapshot from a PublishedPromotion + its parsed engine config. */
export function snapshotFromPublished(
  p: PublishedPromotion,
  config: EngineConfig,
): PublishedRuleSnapshot {
  return {
    id: p.id,
    promoKey: p.promoKey,
    title: p.title,
    description: p.description,
    discountType: p.discountType,
    discountPercent: p.discountPercent,
    discountFixed: p.discountFixed,
    perItemSale: p.perItemSale,
    bonusNote: p.bonusNote,
    weekday: p.weekday,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    priority: p.priority,
    storewide: p.storewide,
    targetCategories: p.targetCategories,
    targetBrands: p.targetBrands,
    targetProductKeys: p.targetProductKeys,
    excludeCategories: p.excludeCategories,
    excludeBrands: p.excludeBrands,
    excludeProductKeys: p.excludeProductKeys,
    config,
  };
}

/** A snapshot as the EngineRule the pure engine consumes. */
export function snapshotToEngineRule(s: PublishedRuleSnapshot): EngineRule {
  return {
    id: s.id,
    title: s.title,
    discountType: s.discountType,
    discountPercent: s.discountPercent,
    discountFixed: s.discountFixed,
    priority: s.priority,
    storewide: s.storewide,
    targetCategories: s.targetCategories,
    targetBrands: s.targetBrands,
    targetProductKeys: s.targetProductKeys,
    excludeCategories: s.excludeCategories,
    excludeBrands: s.excludeBrands,
    excludeProductKeys: s.excludeProductKeys,
    config: s.config,
  };
}

/** True when the snapshot came from a DB-published promotion (vs the seeds). */
export function snapshotFromDatabase(s: PublishedRuleSnapshot): boolean {
  return !s.id.startsWith("seed-");
}

/**
 * The committed daily-deal seeds as snapshots — the DB-empty fallback that
 * keeps the storefront's deals identical to the legacy static engine.
 * Mirrors promotions-store.ts seedsToPublished() + seedConfigFor().
 */
export function seedRuleSnapshots(): PublishedRuleSnapshot[] {
  return DAILY_DEAL_SEEDS.map((s) => ({
    id: `seed-${s.promoKey}`,
    promoKey: s.promoKey,
    title: s.title,
    description: s.description,
    discountType: s.discountType,
    discountPercent: s.discountPercent,
    discountFixed: 0,
    perItemSale: s.perItemSale,
    bonusNote: s.bonusNote ?? null,
    weekday: s.weekday,
    startsAt: null,
    endsAt: null,
    priority: s.priority,
    storewide: Boolean(s.storewide),
    targetCategories: (s.targetCategories ?? []) as string[],
    targetBrands: s.targetBrands ?? [],
    targetProductKeys: [],
    excludeCategories: [],
    excludeBrands: [],
    excludeProductKeys: [],
    config: seedConfigFor(s.promoKey),
  }));
}

/**
 * Filter a snapshot list down to the rules active for a given STORE weekday
 * (weekday recurring promos) or date window (scheduled promos). This is the
 * CLIENT counterpart of isActiveNow() — the client already resolves the
 * store's Pacific weekday via useStoreWeekday, so weekday matching takes the
 * resolved value instead of re-deriving it.
 */
export function activeSnapshotsFor(
  snapshots: PublishedRuleSnapshot[],
  weekday: StoreWeekday,
  when: Date = new Date(),
): PublishedRuleSnapshot[] {
  const dayIndex = STORE_WEEKDAY_TO_INDEX[weekday];
  return snapshots.filter((s) => {
    if (s.weekday != null) return s.weekday === dayIndex;
    const startsOk = !s.startsAt || new Date(s.startsAt).getTime() <= when.getTime();
    const endsOk = !s.endsAt || new Date(s.endsAt).getTime() >= when.getTime();
    if (!s.startsAt && !s.endsAt) return true; // always-on
    return startsOk && endsOk;
  });
}

// ---------------------------------------------------------------------------
// Menu item -> engine line (single source for card previews + menu filters)
// ---------------------------------------------------------------------------

const MERCH_TOKENS = ["merch", "accessories", "paraphernalia"];

/** Lowercased category tokens for a menu item (filter categories preferred). */
export function itemCategoryTokens(item: GreenwayMenuItem): string[] {
  const cats = item.filterCategories?.length ? item.filterCategories : [item.category];
  return cats.map((c) => String(c).toLowerCase());
}

/** A single menu item as a qty-1 engine line (for matching/preview only). */
export function itemToEngineLine(item: GreenwayMenuItem): EngineCartLine {
  return {
    lineId: item.id,
    regularPriceMinorUnits: item.priceMinorUnits,
    quantity: 1,
    categories: itemCategoryTokens(item),
    brand: item.brand || null,
    productKey: item.id,
    variantLabel: null,
    costMinorUnits: null,
  };
}

function isMerchItem(item: GreenwayMenuItem): boolean {
  return itemCategoryTokens(item).some((c) => MERCH_TOKENS.includes(c));
}

// ---------------------------------------------------------------------------
// Card preview (replaces the hard-coded getActiveMenuDiscount weekday switch)
// ---------------------------------------------------------------------------

/**
 * The HEADLINE (best-case) percent a rule advertises. The authored
 * discount_percent is the explicit headline; when it is 0 we derive an honest
 * best case from the mechanic's config. Basket N-for-M intentionally yields 0
 * (its savings depend on the whole basket — the legacy static engine showed
 * NO card badge on Ice Cream Sunday for the same reason).
 */
export function headlinePercentFor(s: PublishedRuleSnapshot): number {
  if (s.discountPercent > 0) return s.discountPercent;
  const c = s.config;
  if (c.eitherOr) return c.eitherOr.flatPercent;
  const tiers =
    s.discountType === "multi_item_tier"
      ? c.qtyTiers ?? DEFAULT_QTY_TIERS
      : s.discountType === "weight_tier"
        ? c.weightTiers ?? DEFAULT_WEIGHT_TIERS
        : s.discountType === "threshold_spend"
          ? c.spendTiers ?? DEFAULT_SPEND_TIERS
          : undefined;
  if (tiers?.length) return Math.max(...tiers.map((t) => t.percent));
  if (c.basketTopItem) return Math.max(c.basketTopItem.topPercent, c.basketTopItem.restPercent);
  return 0;
}

/**
 * Shape mirror of ActiveMenuDiscount (src/lib/specials/daily-deals.ts) so the
 * existing card components swap engines without visual changes.
 */
export type MenuItemDeal = {
  label: string;
  discountPercent: number;
  bonusNote?: string;
  /** Clean per-item deal (honest struck price) vs basket/tier informational. */
  perItemSalePrice: boolean;
  /** Exact per-item sale price for clean per-item deals; regular otherwise. */
  salePriceMinorUnits: number;
  /** Best-case (headline) discounted price for CARD display. */
  cardPreviewSalePriceMinorUnits: number;
};

/** Round a headline preview price (matches daily-deals.ts discountPrice). */
export function discountPreviewPrice(priceMinorUnits: number, percent: number): number {
  return Math.round(priceMinorUnits * (1 - percent / 100));
}

/**
 * The best-case deal preview for ONE menu item across the ACTIVE rules —
 * the DB-driven replacement for getActiveMenuDiscount(item, weekday).
 * Returns undefined when no active rule targets the item (no badge), matching
 * the legacy behaviour (e.g. no badges on Ice Cream Sunday).
 */
export function menuDiscountForItem(
  item: GreenwayMenuItem,
  activeRules: PublishedRuleSnapshot[],
): MenuItemDeal | undefined {
  if (!activeRules.length) return undefined;
  const line = itemToEngineLine(item);
  let best: { s: PublishedRuleSnapshot; percent: number; preview: number } | null = null;
  for (const s of activeRules) {
    if (!ruleMatchesLine(snapshotToEngineRule(s), line)) continue;
    let percent = headlinePercentFor(s);
    let preview = percent > 0 ? discountPreviewPrice(item.priceMinorUnits, Math.min(percent, 99)) : item.priceMinorUnits;
    // Fixed-amount deals: derive the preview from the amount off.
    if (s.discountType === "fixed" && s.discountFixed > 0 && percent <= 0) {
      const floor = isMerchItem(item) ? 0 : 1; // cannabis is never free (RCW 69.50.357)
      preview = Math.max(floor, item.priceMinorUnits - s.discountFixed);
      percent =
        item.priceMinorUnits > 0
          ? Math.round(((item.priceMinorUnits - preview) / item.priceMinorUnits) * 100)
          : 0;
    }
    if (percent <= 0 || preview >= item.priceMinorUnits) continue;
    if (
      !best ||
      percent > best.percent ||
      (percent === best.percent && s.priority > best.s.priority)
    ) {
      best = { s, percent, preview };
    }
  }
  if (!best) return undefined;
  return {
    label: best.s.title,
    discountPercent: best.percent,
    bonusNote: best.s.bonusNote ?? undefined,
    perItemSalePrice: best.s.perItemSale,
    cardPreviewSalePriceMinorUnits: best.preview,
    // salePriceMinorUnits keeps the legacy meaning: the EXACT per-item charge
    // for clean per-item deals only (basket/tier deals finalize in the cart).
    salePriceMinorUnits: best.s.perItemSale ? best.preview : item.priceMinorUnits,
  };
}

// ---------------------------------------------------------------------------
// Card-display policy (SLICE 40 — owner directive)
// ---------------------------------------------------------------------------

/**
 * Weekdays whose deals do NOT show a discounted price on product cards.
 * OWNER RULE: Friday (Ounce Friday — weight tiers), Saturday (Super Saturday —
 * one-item + storewide split) and Sunday (Ice Cream Sunday — 3-for-2 bundle)
 * are basket-dependent: a single item on the card may earn nothing by itself,
 * so a struck "before" price would overpromise. Those days the card shows the
 * regular price and the CART reveals the real savings once the basket
 * qualifies. Monday–Thursday keep their card discounts (clean category/brand
 * deals — including the Thursday featured-brand picks from the back office).
 */
export const CARD_DISCOUNT_HIDDEN_WEEKDAYS: ReadonlySet<StoreWeekday> = new Set<StoreWeekday>([
  "friday",
  "saturday",
  "sunday",
]);

/** True when product cards may show a struck-through discount for `weekday`. */
export function weekdayShowsCardDiscounts(weekday: StoreWeekday | null | undefined): boolean {
  if (!weekday) return false;
  return !CARD_DISCOUNT_HIDDEN_WEEKDAYS.has(weekday);
}

/**
 * The discount a PRODUCT CARD may display for an item — menuDiscountForItem
 * gated by the weekday card policy above. Friday/Saturday/Sunday return
 * undefined (regular price on the card; the cart still applies the real deal —
 * the cart/checkout engine is untouched by this display policy). Returns
 * undefined while the weekday is still resolving on the client (first paint),
 * matching useStoreWeekday's hydration-safe contract.
 */
export function menuCardDiscountForItem(
  item: GreenwayMenuItem,
  activeRules: PublishedRuleSnapshot[] | undefined,
  weekday: StoreWeekday | undefined,
): MenuItemDeal | undefined {
  if (!activeRules || !weekday) return undefined;
  if (!weekdayShowsCardDiscounts(weekday)) return undefined;
  return menuDiscountForItem(item, activeRules);
}

/** Card badge text — mirrors formatActiveDiscountBadge in daily-deals.ts. */
export function formatMenuDealBadge(deal: MenuItemDeal): string {
  if (!deal.perItemSalePrice) {
    return deal.bonusNote ? `${deal.label} · ${deal.bonusNote}` : deal.label;
  }
  return `${deal.label} · ${deal.discountPercent}% off`;
}

/**
 * The items eligible for any ACTIVE rule (the rules-driven replacement for
 * selectDailyDealItems). Deterministic by default; pass an order map for a
 * fresh shuffle each visit.
 */
export function selectOnDealItems(
  items: GreenwayMenuItem[],
  activeRules: PublishedRuleSnapshot[],
  options: { limit?: number; order?: Record<string, number> } = {},
): GreenwayMenuItem[] {
  const { limit = 16, order } = options;
  const eligible = items.filter((item) => menuDiscountForItem(item, activeRules) !== undefined);
  const ordered = order
    ? [...eligible].sort((a, b) => (order[a.id] ?? 0) - (order[b.id] ?? 0))
    : eligible;
  return ordered.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Customer-facing offer label (specials page weekly grid, DB-published rows)
// ---------------------------------------------------------------------------

function tierRangeLabel(tiers: Tier[]): string {
  const percents = tiers.map((t) => t.percent).filter((p) => p > 0);
  if (!percents.length) return "";
  const min = Math.min(...percents);
  const max = Math.max(...percents);
  return min === max ? `${max}% off` : `${min}–${max}% off`;
}

/** Menu "lane" link that pre-filters the shop to a rule's targets. */
export function menuHrefFor(s: PublishedRuleSnapshot): string {
  if (s.targetBrands.length > 0) {
    return `/menu?brands=${s.targetBrands.map((b) => encodeURIComponent(b)).join(",")}`;
  }
  if (s.targetCategories.length > 0) {
    return `/menu?categories=${s.targetCategories.join(",")}`;
  }
  return "/menu";
}

/**
 * The deal presentation (title/subtitle/menu lane) for ONE store weekday,
 * preferring the highest-priority published rule for that day and falling
 * back to the static presentation map — the PURE, snapshot-driven successor
 * of storefront-bridge's getActiveDealView()/getWeeklyDealViews() usable on
 * both server and client.
 */
export function dealPresentationFor(
  snapshots: PublishedRuleSnapshot[],
  weekday: StoreWeekday,
): DailyDealPresentation & { fromDatabase: boolean } {
  const dayIndex = STORE_WEEKDAY_TO_INDEX[weekday];
  const match = snapshots
    .filter((s) => s.weekday === dayIndex)
    .sort((a, b) => b.priority - a.priority)[0];
  const fallback = getDailyDealPresentation(weekday);
  if (!match) return { ...fallback, fromDatabase: false };
  return {
    weekday,
    title: match.title || fallback.title,
    subtitle: match.description || match.bonusNote || fallback.subtitle,
    menuHref: menuHrefFor(match),
    fromDatabase: snapshotFromDatabase(match),
  };
}

/** A full week (Mon→Sun) of deal presentations, DB-preferred per day. */
export function weeklyDealPresentations(
  snapshots: PublishedRuleSnapshot[],
): (DailyDealPresentation & { fromDatabase: boolean })[] {
  const order: StoreWeekday[] = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  return order.map((day) => dealPresentationFor(snapshots, day));
}

/**
 * One row of the specials page's "Weekly Cannabis Deals" grid: the day's
 * highest-priority published rule reduced to customer-facing copy. When the
 * day's rule came from the DB (staff edited it in /admin/promotions) the grid
 * overrides the static card copy; seed days keep the committed presentation.
 */
export type WeeklyDealSummary = {
  weekday: StoreWeekday;
  title: string;
  /** Short offer line derived from the rule's actual mechanics ("25% off"). */
  offerLabel: string;
  /** Longer customer-facing description (rule description / bonus note). */
  description: string | null;
  menuHref: string;
  fromDatabase: boolean;
};

/** The week's deals (Mon→Sun) as customer-facing summaries. */
export function weeklyDealSummaries(snapshots: PublishedRuleSnapshot[]): WeeklyDealSummary[] {
  const order: StoreWeekday[] = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  return order.map((weekday) => {
    const dayIndex = STORE_WEEKDAY_TO_INDEX[weekday];
    const match = snapshots
      .filter((s) => s.weekday === dayIndex)
      .sort((a, b) => b.priority - a.priority)[0];
    const fallback = getDailyDealPresentation(weekday);
    if (!match) {
      return {
        weekday,
        title: fallback.title,
        offerLabel: "",
        description: fallback.subtitle,
        menuHref: fallback.menuHref,
        fromDatabase: false,
      };
    }
    return {
      weekday,
      title: match.title || fallback.title,
      offerLabel: offerLabelFor(match),
      description: match.description || match.bonusNote || fallback.subtitle,
      menuHref: menuHrefFor(match),
      fromDatabase: snapshotFromDatabase(match),
    };
  });
}

/** Short customer-facing offer line derived from a rule's actual mechanics. */
export function offerLabelFor(s: PublishedRuleSnapshot): string {
  const c = s.config;
  if (c.eitherOr) {
    return `${c.eitherOr.flatPercent}% off · or ${c.eitherOr.bundle.n} for ${c.eitherOr.bundle.m}`;
  }
  if (c.basketTopItem) {
    const lo = Math.min(c.basketTopItem.topPercent, c.basketTopItem.restPercent);
    const hi = Math.max(c.basketTopItem.topPercent, c.basketTopItem.restPercent);
    return lo === hi ? `${hi}% off` : `${lo}–${hi}% off`;
  }
  if (c.basketNforM) return `${c.basketNforM.n} for ${c.basketNforM.m}`;
  if (c.bogo) {
    const pct = Math.min(99, c.bogo.getPercent);
    return pct >= 99 ? `Buy ${c.bogo.buyQty} get ${c.bogo.getQty}` : `Buy ${c.bogo.buyQty}, ${pct}% off ${c.bogo.getQty}`;
  }
  if (s.discountType === "multi_item_tier" && c.qtyTiers?.length) return tierRangeLabel(c.qtyTiers);
  if (s.discountType === "weight_tier" && c.weightTiers?.length) return tierRangeLabel(c.weightTiers);
  if (s.discountType === "threshold_spend" && c.spendTiers?.length) return tierRangeLabel(c.spendTiers);
  if (s.discountType === "fixed" && s.discountFixed > 0) return `$${(s.discountFixed / 100).toFixed(2)} off`;
  if (s.discountPercent > 0) return `${s.discountPercent}% off`;
  const headline = headlinePercentFor(s);
  return headline > 0 ? `up to ${headline}% off` : "";
}
