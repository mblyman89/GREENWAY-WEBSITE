/**
 * SLICE C (SHOP-3) — the Shop sidebar "Specials" filters are now FULLY DYNAMIC.
 *
 * Michael's directive: no more hardcoded "50% Off" checkbox pointing at an empty
 * clearanceItemIds list, and no more one-off booleans. Every Specials option is
 * derived from the live menu + the back office's published promotions, plus the
 * one-off sale links a carousel slide carries (SLICE B). This pure model is the
 * single matcher the client browser, the server page, and vitest all share.
 *
 * NEVER GUESS — these pins lock the contract so a future refactor can't silently
 * regress the Specials sidebar:
 *   - the two built-in lanes keep their identity/order (clearance "50% Off" with
 *     a 50 threshold, then "Daily Deals"),
 *   - resolveMenuSpecialFilters merges built-ins + dynamic sale filters, drops a
 *     sale filter with no linked promotion, blanks fall back to "Sale",
 *     de-dupes by id (a dynamic filter can't clobber a built-in), and caps the
 *     whole list at MAX_MENU_SPECIAL_FILTERS,
 *   - includeBuiltIns:false yields a promotions-only list,
 *   - itemMatchesSpecialFilter agrees with the promotions engine: clearance =
 *     best ACTIVE deal >= threshold, daily-deals = any active deal, promotion =
 *     targeted by THAT promotion AND active today (an inactive/unknown promo
 *     matches nothing),
 *   - findMenuSpecialFilter looks a filter up by id (null-safe).
 */
import { describe, expect, it } from "vitest";

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import type { PublishedRuleSnapshot } from "@/lib/promotions/published-rules-core";
import {
  CLEARANCE_FILTER_ID,
  CLEARANCE_THRESHOLD_PERCENT,
  DAILY_DEALS_FILTER_ID,
  MAX_MENU_SPECIAL_FILTERS,
  builtInMenuSpecialFilters,
  findMenuSpecialFilter,
  itemMatchesSpecialFilter,
  resolveMenuSpecialFilters,
  type MenuSpecialFilter,
  type MenuSpecialFilterContext,
} from "@/lib/menu/menu-special-filters-core";

/** Minimal snapshot factory (only the fields the matchers read). */
const snap = (
  over: Partial<PublishedRuleSnapshot> & { id: string },
): PublishedRuleSnapshot => ({
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
});

/** Minimal menu item factory. */
const item = (over: Partial<GreenwayMenuItem> & { id: string }): GreenwayMenuItem =>
  ({
    name: "Test Item",
    brand: "Test Brand",
    category: "flower",
    priceMinorUnits: 3000,
    ...over,
  }) as GreenwayMenuItem;

describe("menu special filters: the built-in lanes", () => {
  it("exposes exactly two built-ins in a stable order", () => {
    const b = builtInMenuSpecialFilters();
    expect(b).toHaveLength(2);
    expect(b[0].id).toBe(CLEARANCE_FILTER_ID);
    expect(b[0].kind).toBe("clearance");
    expect(b[0].name).toBe("50% Off");
    expect(b[0].threshold).toBe(CLEARANCE_THRESHOLD_PERCENT);
    expect(b[1].id).toBe(DAILY_DEALS_FILTER_ID);
    expect(b[1].kind).toBe("daily-deals");
    expect(b[1].name).toBe("Daily Deals");
  });
});

describe("resolveMenuSpecialFilters: built-ins + dynamic sale filters", () => {
  it("merges built-ins first, then dynamic sale filters in order", () => {
    const out = resolveMenuSpecialFilters([
      { id: "alpha-sale", name: "Alpha Sale", promotionId: "promo-a" },
      { id: "beta-sale", name: "Beta Sale", promotionId: "promo-b" },
    ]);
    expect(out.map((f) => f.kind)).toEqual(["clearance", "daily-deals", "promotion", "promotion"]);
    expect(out[2].id).toBe("alpha-sale");
    expect(out[2].promotionId).toBe("promo-a");
    expect(out[3].id).toBe("beta-sale");
  });

  it("drops a sale filter with no linked promotion", () => {
    const out = resolveMenuSpecialFilters([
      { id: "ghost", name: "Ghost", promotionId: "" },
      { id: "real", name: "Real", promotionId: "promo-x" },
    ]);
    expect(out.map((f) => f.id)).toEqual([CLEARANCE_FILTER_ID, DAILY_DEALS_FILTER_ID, "real"]);
  });

  it("blank dynamic name falls back to 'Sale'", () => {
    const out = resolveMenuSpecialFilters([{ id: "s", name: "   ", promotionId: "p" }]);
    expect(out[2].name).toBe("Sale");
  });

  it("de-dupes by id so a dynamic filter can't clobber a built-in", () => {
    const out = resolveMenuSpecialFilters([
      { id: CLEARANCE_FILTER_ID, name: "Impostor", promotionId: "p" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("clearance");
    expect(out[0].name).toBe("50% Off");
  });

  it("includeBuiltIns:false yields a promotions-only list", () => {
    const out = resolveMenuSpecialFilters(
      [{ id: "s", name: "Sale", promotionId: "p" }],
      { includeBuiltIns: false },
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("promotion");
  });

  it("caps the whole list at MAX_MENU_SPECIAL_FILTERS", () => {
    const out = resolveMenuSpecialFilters(
      Array.from({ length: 20 }, (_, i) => ({ id: `s-${i}`, name: `S ${i}`, promotionId: `p-${i}` })),
    );
    expect(out).toHaveLength(MAX_MENU_SPECIAL_FILTERS);
    // Two built-ins first, then dynamic in order.
    expect(out[0].kind).toBe("clearance");
    expect(out[2].id).toBe("s-0");
  });
});

describe("itemMatchesSpecialFilter: agrees with the promotions engine", () => {
  const flower = item({ id: "f1", category: "flower", brand: "Acme", priceMinorUnits: 4000 });
  const edible = item({ id: "e1", category: "edible-solid", brand: "Sweets", priceMinorUnits: 2000 });
  const untargeted = item({ id: "n1", category: "accessories", brand: "None" });

  const bigDeal = snap({ id: "promo-a", title: "Alpha", discountPercent: 60, targetCategories: ["flower"] });
  const smallDeal = snap({ id: "promo-b", title: "Beta", discountPercent: 20, targetCategories: ["edible-solid"] });
  const active = [bigDeal, smallDeal];
  const ctx: MenuSpecialFilterContext = { allRules: active, activeRules: active };

  const [clearance, daily] = builtInMenuSpecialFilters();

  it("clearance = best ACTIVE deal >= threshold (50%)", () => {
    expect(itemMatchesSpecialFilter(flower, clearance, ctx)).toBe(true); // 60% off
    expect(itemMatchesSpecialFilter(edible, clearance, ctx)).toBe(false); // only 20% off
  });

  it("daily-deals = eligible for ANY active deal", () => {
    expect(itemMatchesSpecialFilter(flower, daily, ctx)).toBe(true);
    expect(itemMatchesSpecialFilter(edible, daily, ctx)).toBe(true);
    expect(itemMatchesSpecialFilter(untargeted, daily, ctx)).toBe(false);
  });

  it("promotion = targeted by THAT promotion (and active today)", () => {
    const promoA: MenuSpecialFilter = { id: "a", name: "Alpha", kind: "promotion", promotionId: "promo-a" };
    expect(itemMatchesSpecialFilter(flower, promoA, ctx)).toBe(true);
    expect(itemMatchesSpecialFilter(edible, promoA, ctx)).toBe(false);
  });

  it("an inactive/unknown promotion matches nothing", () => {
    const promoZ: MenuSpecialFilter = { id: "z", name: "Z", kind: "promotion", promotionId: "promo-z" };
    expect(itemMatchesSpecialFilter(flower, promoZ, ctx)).toBe(false);
    // Present in allRules but NOT in activeRules -> still no match (must be active today).
    const parked: MenuSpecialFilter = { id: "p", name: "Parked", kind: "promotion", promotionId: "promo-parked" };
    const ctx2: MenuSpecialFilterContext = {
      allRules: [...active, snap({ id: "promo-parked", discountPercent: 90, targetCategories: ["flower"] })],
      activeRules: active,
    };
    expect(itemMatchesSpecialFilter(flower, parked, ctx2)).toBe(false);
  });

  it("a promotion filter with no promotionId never matches", () => {
    const broken = { id: "b", name: "B", kind: "promotion" } as MenuSpecialFilter;
    expect(itemMatchesSpecialFilter(flower, broken, ctx)).toBe(false);
  });
});

describe("findMenuSpecialFilter: null-safe id lookup", () => {
  const resolved = resolveMenuSpecialFilters([
    { id: "alpha-sale", name: "Alpha Sale", promotionId: "promo-a" },
  ]);

  it("finds a filter by id", () => {
    expect(findMenuSpecialFilter(resolved, "alpha-sale")?.promotionId).toBe("promo-a");
    expect(findMenuSpecialFilter(resolved, CLEARANCE_FILTER_ID)?.kind).toBe("clearance");
  });

  it("returns null for null/undefined/missing ids", () => {
    expect(findMenuSpecialFilter(resolved, null)).toBeNull();
    expect(findMenuSpecialFilter(resolved, undefined)).toBeNull();
    expect(findMenuSpecialFilter(resolved, "nope")).toBeNull();
  });
});
