/**
 * SLICE C (SHOP-3) — the pure model behind the Shop sidebar "Specials" filters.
 *
 * Michael's directive: the Specials filter checkboxes must be FULLY DYNAMIC and
 * data-driven — no more hardcoded "50% Off" placeholder (which pointed at an
 * empty clearanceItemIds list) and no more one-off booleans. Every Specials
 * option is derived from the live menu + the back office's published
 * promotions, PLUS the one-off sale links a slide carries (SLICE B).
 *
 * This module is PURE (no "server-only", no React) so the client browser, the
 * server page, and vitest all share one matcher — the same discipline as the
 * rest of the promotions engine. It leans entirely on the EXISTING engine
 * primitives (never re-implements matching):
 *   - itemToEngineLine + ruleMatchesLine decide whether ONE rule targets an item,
 *   - snapshotToEngineRule adapts a published snapshot to that rule,
 *   - menuDiscountForItem gives the best active deal (percent) for an item,
 * so a "50% Off" filter simply means "an active deal takes >= 50% off this item"
 * and a per-promotion filter means "this item is targeted by THAT promotion,
 * and that promotion is active today".
 */
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  itemToEngineLine,
  menuDiscountForItem,
  snapshotToEngineRule,
  type PublishedRuleSnapshot,
} from "@/lib/promotions/published-rules-core";
import { ruleMatchesLine } from "@/lib/promotions/discount-engine-core";
import { collectShopSaleFilters } from "@/lib/cms/shop-carousel-core";

/**
 * The clearance ("50% Off") lane threshold. An item qualifies when its best
 * ACTIVE deal takes at least this percent off. Data-driven — no item-id list.
 */
export const CLEARANCE_THRESHOLD_PERCENT = 50;

/**
 * Hard cap on how many Specials checkboxes render. The two built-ins plus up to
 * MAX_SHOP_CAROUSEL_SLIDES (10) one-off sale filters; capped here so a
 * misconfigured back office can never flood the sidebar.
 */
export const MAX_MENU_SPECIAL_FILTERS = 12;

/** Stable ids for the two always-available built-in lanes. */
export const CLEARANCE_FILTER_ID = "clearance";
export const DAILY_DEALS_FILTER_ID = "daily-deals";

export type MenuSpecialFilterKind = "clearance" | "daily-deals" | "promotion";

/** One Specials checkbox, fully described as data. */
export type MenuSpecialFilter = {
  /** Stable id (checkbox key + URL token). */
  id: string;
  /** Display label on the checkbox. */
  name: string;
  kind: MenuSpecialFilterKind;
  /** For kind === "promotion": the promotion this filter selects. */
  promotionId?: string;
  /** For kind === "clearance": the min percent-off to qualify. */
  threshold?: number;
};

/** A one-off sale link surfaced from the carousel (SLICE B bridge output). */
export type ShopSaleFilterInput = {
  id: string;
  name: string;
  promotionId: string;
};

/** The live rule context a matcher needs (all rules + today's active subset). */
export type MenuSpecialFilterContext = {
  /** Every published snapshot (all weekdays/windows) — seed fallback upstream. */
  allRules: PublishedRuleSnapshot[];
  /** The snapshots active for the store's current weekday. */
  activeRules: PublishedRuleSnapshot[];
};

/** The two built-in Specials lanes, as data (order: clearance, then daily). */
export function builtInMenuSpecialFilters(): MenuSpecialFilter[] {
  return [
    { id: CLEARANCE_FILTER_ID, name: "50% Off", kind: "clearance", threshold: CLEARANCE_THRESHOLD_PERCENT },
    { id: DAILY_DEALS_FILTER_ID, name: "Daily Deals", kind: "daily-deals" },
  ];
}

/**
 * Merge the two built-in lanes with the dynamic one-off sale filters into the
 * ordered list the sidebar renders. Sale filters keep their carousel order and
 * their owner-chosen names; any that collide with a built-in id (or each other)
 * are de-duplicated by id (first wins), and the whole list is capped.
 *
 * `opts.includeBuiltIns` defaults true; pass false to render ONLY the dynamic
 * sale filters (e.g. if the owner ever wants a promotions-only sidebar).
 */
export function resolveMenuSpecialFilters(
  saleFilters: ShopSaleFilterInput[],
  opts?: { includeBuiltIns?: boolean },
): MenuSpecialFilter[] {
  const includeBuiltIns = opts?.includeBuiltIns ?? true;
  const out: MenuSpecialFilter[] = [];
  const seen = new Set<string>();
  const push = (f: MenuSpecialFilter) => {
    if (seen.has(f.id)) return;
    if (out.length >= MAX_MENU_SPECIAL_FILTERS) return;
    seen.add(f.id);
    out.push(f);
  };
  if (includeBuiltIns) {
    for (const b of builtInMenuSpecialFilters()) push(b);
  }
  for (const s of saleFilters) {
    const name = (s.name ?? "").trim();
    const promotionId = (s.promotionId ?? "").trim();
    if (!promotionId) continue;
    push({ id: s.id, name: name || "Sale", kind: "promotion", promotionId });
  }
  return out;
}

/** The best active percent-off for an item (0 when nothing targets it). */
function bestActivePercent(item: GreenwayMenuItem, activeRules: PublishedRuleSnapshot[]): number {
  const deal = menuDiscountForItem(item, activeRules);
  return deal ? deal.discountPercent : 0;
}

/**
 * True when a menu item belongs to a given Specials filter. Pure over the
 * supplied rule context so the client and any server caller agree exactly.
 *
 *  - clearance:   the item's best ACTIVE deal is >= the filter threshold (50%).
 *  - daily-deals: the item is eligible for ANY active deal today.
 *  - promotion:   the item is targeted by the ONE promotion this filter points
 *                 at AND that promotion is active today (so an out-of-window or
 *                 wrong-weekday sale simply matches nothing — the sidebar shows
 *                 the honest empty state rather than stale items).
 */
export function itemMatchesSpecialFilter(
  item: GreenwayMenuItem,
  filter: MenuSpecialFilter,
  ctx: MenuSpecialFilterContext,
): boolean {
  switch (filter.kind) {
    case "clearance": {
      const min = filter.threshold ?? CLEARANCE_THRESHOLD_PERCENT;
      return bestActivePercent(item, ctx.activeRules) >= min;
    }
    case "daily-deals":
      return menuDiscountForItem(item, ctx.activeRules) !== undefined;
    case "promotion": {
      if (!filter.promotionId) return false;
      // The promotion must be ACTIVE today (present in activeRules) to match.
      const snap = ctx.activeRules.find((s) => s.id === filter.promotionId);
      if (!snap) return false;
      return ruleMatchesLine(snapshotToEngineRule(snap), itemToEngineLine(item));
    }
    default:
      return false;
  }
}

/** Look up a filter by id in a resolved list (client convenience). */
export function findMenuSpecialFilter(
  filters: MenuSpecialFilter[],
  id: string | null | undefined,
): MenuSpecialFilter | null {
  if (!id) return null;
  return filters.find((f) => f.id === id) ?? null;
}

// ───────────────────────────────────────────────────────────────────────────
// Pure self-tests (throw on failure). Registered in the pure-selftest runner so
// the whole battery guards this matcher, mirroring shop-carousel-core.
// ───────────────────────────────────────────────────────────────────────────

/** Minimal snapshot factory for the self-tests (only the fields matchers read). */
function testSnapshot(over: Partial<PublishedRuleSnapshot> & { id: string }): PublishedRuleSnapshot {
  return {
    promoKey: null,
    title: "Test",
    description: null,
    discountType: "percent",
    discountPercent: 0,
    discountFixed: 0,
    perItemSale: true,
    bonusNote: null,
    weekday: null,
    startsAt: null,
    endsAt: null,
    priority: 0,
    storewide: false,
    targetCategories: [],
    targetBrands: [],
    targetProductKeys: [],
    excludeCategories: [],
    excludeBrands: [],
    excludeProductKeys: [],
    config: {},
    ...over,
  };
}

/** Minimal menu item factory for the self-tests. */
function testItem(over: Partial<GreenwayMenuItem> & { id: string }): GreenwayMenuItem {
  return {
    name: "Test Item",
    brand: "Test Brand",
    category: "flower",
    priceMinorUnits: 3000,
    ...over,
  } as GreenwayMenuItem;
}

export function __runMenuSpecialFiltersTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`menu-special-filters-core: ${msg}`);
    passed += 1;
  };

  // Built-ins + resolver shape.
  const builtins = builtInMenuSpecialFilters();
  ok(builtins.length === 2, "two built-in lanes");
  ok(builtins[0].id === CLEARANCE_FILTER_ID && builtins[0].kind === "clearance", "first built-in is clearance");
  ok(builtins[0].threshold === 50, "clearance threshold is 50");
  ok(builtins[1].id === DAILY_DEALS_FILTER_ID && builtins[1].kind === "daily-deals", "second built-in is daily-deals");

  const resolved = resolveMenuSpecialFilters([
    { id: "alpha-sale", name: "Alpha Sale", promotionId: "promo-a" },
    { id: "beta-sale", name: "", promotionId: "promo-b" },
    { id: "no-link", name: "Ghost", promotionId: "" }, // dropped (no promo)
  ]);
  ok(resolved.length === 4, "resolver = 2 built-ins + 2 valid dynamic (the no-link is dropped)");
  ok(resolved[0].kind === "clearance" && resolved[1].kind === "daily-deals", "built-ins come first");
  ok(resolved[2].id === "alpha-sale" && resolved[2].promotionId === "promo-a", "first dynamic kept in order");
  ok(resolved[3].name === "Sale", "blank dynamic name falls back to 'Sale'");

  // includeBuiltIns:false -> only dynamic.
  const dynOnly = resolveMenuSpecialFilters([{ id: "x", name: "X", promotionId: "p" }], { includeBuiltIns: false });
  ok(dynOnly.length === 1 && dynOnly[0].kind === "promotion", "includeBuiltIns:false = dynamic only");

  // De-dupe by id (a sale filter that reuses a built-in id can't clobber it).
  const deduped = resolveMenuSpecialFilters([{ id: CLEARANCE_FILTER_ID, name: "Nope", promotionId: "p" }]);
  ok(deduped.length === 2 && deduped[0].kind === "clearance", "dupe id can't clobber the clearance built-in");

  // Cap.
  const many = resolveMenuSpecialFilters(
    Array.from({ length: 20 }, (_, i) => ({ id: `s-${i}`, name: `S ${i}`, promotionId: `p-${i}` })),
  );
  ok(many.length === MAX_MENU_SPECIAL_FILTERS, "resolver caps the total");

  // Matching. Build items + rules.
  const flower = testItem({ id: "f1", category: "flower", brand: "Acme", priceMinorUnits: 4000 });
  const edible = testItem({ id: "e1", category: "edible-solid", brand: "Sweets", priceMinorUnits: 2000 });

  const bigDeal = testSnapshot({ id: "promo-a", title: "Alpha", discountPercent: 60, targetCategories: ["flower"] });
  const smallDeal = testSnapshot({ id: "promo-b", title: "Beta", discountPercent: 20, targetCategories: ["edible-solid"] });
  const active = [bigDeal, smallDeal];
  const ctx: MenuSpecialFilterContext = { allRules: active, activeRules: active };

  const clearance = builtins[0];
  ok(itemMatchesSpecialFilter(flower, clearance, ctx) === true, "flower with 60% off qualifies for 50% clearance");
  ok(itemMatchesSpecialFilter(edible, clearance, ctx) === false, "edible with only 20% off does NOT hit 50% clearance");

  const daily = builtins[1];
  ok(itemMatchesSpecialFilter(flower, daily, ctx) === true, "flower is daily-deal eligible");
  ok(itemMatchesSpecialFilter(edible, daily, ctx) === true, "edible is daily-deal eligible (any active deal)");
  const nothing = testItem({ id: "n1", category: "accessories", brand: "None" });
  ok(itemMatchesSpecialFilter(nothing, daily, ctx) === false, "untargeted item is NOT daily-deal eligible");

  const promoA: MenuSpecialFilter = { id: "alpha", name: "Alpha", kind: "promotion", promotionId: "promo-a" };
  ok(itemMatchesSpecialFilter(flower, promoA, ctx) === true, "flower matches promo-a (targets flower)");
  ok(itemMatchesSpecialFilter(edible, promoA, ctx) === false, "edible does NOT match promo-a");

  // An inactive promotion (not in activeRules) matches nothing.
  const promoInactive: MenuSpecialFilter = { id: "z", name: "Z", kind: "promotion", promotionId: "promo-z" };
  ok(itemMatchesSpecialFilter(flower, promoInactive, ctx) === false, "inactive/unknown promotion matches nothing");

  // findMenuSpecialFilter.
  ok(findMenuSpecialFilter(resolved, "alpha-sale")?.promotionId === "promo-a", "findMenuSpecialFilter by id");
  ok(findMenuSpecialFilter(resolved, null) === null, "findMenuSpecialFilter(null) is null");

  // collectShopSaleFilters is re-exported through here for callers (bridge sanity).
  ok(typeof collectShopSaleFilters === "function", "collectShopSaleFilters bridge is importable");

  return { passed };
}
