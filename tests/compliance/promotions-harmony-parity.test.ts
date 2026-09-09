/**
 * tests/compliance/promotions-harmony-parity.test.ts  (Task T / PR 1)
 *
 * PROMOTIONS HARMONY — the migration proof. PR 1 switched every storefront
 * pricing surface (client cart, server reprice, card previews) from the
 * legacy static weekday engine (src/lib/specials/cart-discount.ts) to the
 * data-driven rules engine (discount-engine-core.ts) fed by the back
 * office's PUBLISHED promotions, with the committed daily-deal seeds as the
 * zero-blank fallback.
 *
 * Advertising integrity (WAC 314-55-155 family) requires the advertised
 * price to equal the charged price, and the owner requires the migration to
 * be provably behaviour-preserving. So this suite pins:
 *
 *  1. SEED PARITY: for every weekday and a battery of carts (tier
 *     boundaries, mixed categories, merch exclusion, price-floor edges), the
 *     rules engine evaluating the SEED snapshots produces IDENTICAL per-line
 *     unit prices and totals to the legacy static engine.
 *  2. SNAPSHOT MECHANICS: activeSnapshotsFor weekday/window resolution,
 *     seed fallback wiring, and engine-rule conversion.
 *  3. CARD PREVIEW PARITY: menuDiscountForItem mirrors the legacy
 *     getActiveMenuDiscount for every weekday (badge presence, preview
 *     price, per-item vs informational).
 */
import { describe, it, expect } from "vitest";
import {
  computeCartDiscounts,
  type DiscountCartLine,
} from "@/lib/specials/cart-discount";
import { getActiveMenuDiscount } from "@/lib/specials/daily-deals";
import type { StoreWeekday } from "@/lib/specials/daily-deals";
import type { GreenwayCategory, GreenwayMenuItem } from "@/lib/leafly/types";
import { computePromotions } from "@/lib/promotions/discount-engine-core";
import {
  activeSnapshotsFor,
  seedRuleSnapshots,
  snapshotToEngineRule,
  menuDiscountForItem,
  headlinePercentFor,
  offerLabelFor,
  weeklyDealSummaries,
  dealPresentationFor,
  selectOnDealItems,
  STORE_WEEKDAY_TO_INDEX,
} from "@/lib/promotions/published-rules-core";

const WEEKDAYS: StoreWeekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

// ---------------------------------------------------------------------------
// Cart-line helpers: the legacy engine takes DiscountCartLine; the rules
// engine takes EngineCartLine. Both are built from the SAME source values,
// exactly like CartProvider/order-pricing build them.
// ---------------------------------------------------------------------------

type SrcLine = {
  lineId: string;
  regularPriceMinorUnits: number;
  quantity: number;
  category: GreenwayCategory;
  filterCategories?: GreenwayCategory[];
  variantLabel?: string;
  brand?: string;
  costMinorUnits?: number | null;
};

const legacyLine = (l: SrcLine): DiscountCartLine => ({
  lineId: l.lineId,
  regularPriceMinorUnits: l.regularPriceMinorUnits,
  quantity: l.quantity,
  category: l.category,
  filterCategories: l.filterCategories,
  variantLabel: l.variantLabel,
  brand: l.brand,
  costMinorUnits: l.costMinorUnits,
});

const engineLine = (l: SrcLine) => ({
  lineId: l.lineId,
  regularPriceMinorUnits: l.regularPriceMinorUnits,
  quantity: l.quantity,
  categories: (l.filterCategories?.length ? l.filterCategories : [l.category]).map((c) =>
    String(c).toLowerCase(),
  ),
  brand: l.brand ?? null,
  productKey: l.lineId,
  variantLabel: l.variantLabel ?? null,
  costMinorUnits: l.costMinorUnits ?? null,
});

function rulesResultFor(cart: SrcLine[], weekday: StoreWeekday) {
  const active = activeSnapshotsFor(seedRuleSnapshots(), weekday);
  return computePromotions(cart.map(engineLine), active.map(snapshotToEngineRule));
}

function legacyResultFor(cart: SrcLine[], weekday: StoreWeekday) {
  return computeCartDiscounts(cart.map(legacyLine), weekday);
}

/** Assert identical money on every line + totals for a cart on a weekday. */
function expectParity(cart: SrcLine[], weekday: StoreWeekday) {
  const legacy = legacyResultFor(cart, weekday);
  const rules = rulesResultFor(cart, weekday);
  expect(rules.totalRegularMinorUnits).toBe(legacy.totalRegularMinorUnits);
  expect(rules.totalDiscountedMinorUnits).toBe(legacy.totalDiscountedMinorUnits);
  expect(rules.totalSavingsMinorUnits).toBe(legacy.totalSavingsMinorUnits);
  const legacyById = new Map(legacy.lines.map((l) => [l.lineId, l]));
  for (const line of rules.lines) {
    const ref = legacyById.get(line.lineId)!;
    expect(ref).toBeDefined();
    expect(line.unitPriceMinorUnits).toBe(ref.unitPriceMinorUnits);
    expect(line.unitSavingsMinorUnits).toBe(ref.unitSavingsMinorUnits);
  }
}

// A broad cart battery hitting every seed mechanic + its boundaries.
const CARTS: Record<string, SrcLine[]> = {
  "single flower eighth": [
    { lineId: "a", regularPriceMinorUnits: 3500, quantity: 1, category: "flower", variantLabel: "3.5g" },
  ],
  "quarter ounce boundary (2×3.5g)": [
    { lineId: "a", regularPriceMinorUnits: 3500, quantity: 2, category: "flower", variantLabel: "3.5g" },
  ],
  "half ounce boundary (4×3.5g)": [
    { lineId: "a", regularPriceMinorUnits: 3500, quantity: 4, category: "flower", variantLabel: "3.5g" },
  ],
  "full ounce (8×3.5g)": [
    { lineId: "a", regularPriceMinorUnits: 3500, quantity: 8, category: "flower", variantLabel: "3.5g" },
  ],
  "edibles + merch": [
    { lineId: "e", regularPriceMinorUnits: 2500, quantity: 2, category: "edible-solid" },
    { lineId: "m", regularPriceMinorUnits: 2000, quantity: 1, category: "merch" },
  ],
  "prerolls qty 1": [
    { lineId: "p", regularPriceMinorUnits: 1000, quantity: 1, category: "preroll" },
  ],
  "prerolls 4-for-3 similar prices": [
    { lineId: "p1", regularPriceMinorUnits: 1000, quantity: 2, category: "preroll" },
    { lineId: "p2", regularPriceMinorUnits: 1200, quantity: 2, category: "infused-preroll" },
  ],
  "prerolls 4-for-3 skewed prices": [
    { lineId: "big", regularPriceMinorUnits: 2000, quantity: 3, category: "preroll" },
    { lineId: "small", regularPriceMinorUnits: 200, quantity: 1, category: "blunt" },
  ],
  "concentrate spend below tier": [
    { lineId: "c", regularPriceMinorUnits: 4500, quantity: 1, category: "concentrate" },
  ],
  "concentrate spend $100 tier": [
    { lineId: "c", regularPriceMinorUnits: 5000, quantity: 2, category: "cartridge" },
  ],
  "concentrate spend $150 tier": [
    { lineId: "c1", regularPriceMinorUnits: 6000, quantity: 2, category: "concentrate" },
    { lineId: "c2", regularPriceMinorUnits: 4000, quantity: 1, category: "cartridge" },
  ],
  "thursday brand + non-brand": [
    { lineId: "b1", regularPriceMinorUnits: 4200, quantity: 1, category: "flower", brand: "Phat Panda" },
    { lineId: "b2", regularPriceMinorUnits: 3900, quantity: 1, category: "flower", brand: "Some Other Farm" },
  ],
  "saturday mixed basket": [
    { lineId: "top", regularPriceMinorUnits: 9000, quantity: 1, category: "concentrate" },
    { lineId: "rest", regularPriceMinorUnits: 2500, quantity: 3, category: "edible-solid" },
    { lineId: "merch", regularPriceMinorUnits: 3000, quantity: 1, category: "merch" },
  ],
  "saturday top line qty>1 (blended)": [
    { lineId: "top", regularPriceMinorUnits: 8000, quantity: 3, category: "flower", variantLabel: "3.5g" },
    { lineId: "other", regularPriceMinorUnits: 1500, quantity: 1, category: "preroll" },
  ],
  "sunday 3-for-2 exact group": [
    { lineId: "a", regularPriceMinorUnits: 3000, quantity: 1, category: "flower", variantLabel: "3.5g" },
    { lineId: "b", regularPriceMinorUnits: 3200, quantity: 1, category: "edible-solid" },
    { lineId: "c", regularPriceMinorUnits: 2800, quantity: 1, category: "preroll" },
  ],
  "sunday below group size": [
    { lineId: "a", regularPriceMinorUnits: 3000, quantity: 2, category: "flower", variantLabel: "3.5g" },
  ],
  "sunday multiple groups + merch": [
    { lineId: "a", regularPriceMinorUnits: 1000, quantity: 4, category: "preroll" },
    { lineId: "b", regularPriceMinorUnits: 4500, quantity: 2, category: "concentrate" },
    { lineId: "m", regularPriceMinorUnits: 2500, quantity: 2, category: "merch" },
  ],
  "penny cannabis price-floor edge": [
    { lineId: "a", regularPriceMinorUnits: 1, quantity: 3, category: "preroll" },
    { lineId: "b", regularPriceMinorUnits: 2, quantity: 1, category: "flower", variantLabel: "1g" },
  ],
  "filter-categories matching (RSO via filterCategories)": [
    {
      lineId: "r",
      regularPriceMinorUnits: 5500,
      quantity: 1,
      category: "concentrate",
      filterCategories: ["rso"] as GreenwayCategory[],
    },
  ],
  "owner example: $150 half + $20 joint + $15 joint": [
    { lineId: "half", regularPriceMinorUnits: 15000, quantity: 1, category: "flower", variantLabel: "14g" },
    { lineId: "j1", regularPriceMinorUnits: 2000, quantity: 1, category: "preroll" },
    { lineId: "j2", regularPriceMinorUnits: 1500, quantity: 1, category: "preroll" },
  ],
  "cost floor clamps identically": [
    {
      lineId: "a",
      regularPriceMinorUnits: 3000,
      quantity: 1,
      category: "edible-solid",
      costMinorUnits: 1900, // floor ceil(1900×1.463)=2780 > 25%-off 2250 → clamp
    },
  ],
};

describe("PROMOTIONS HARMONY — seed rules == legacy static engine (every weekday)", () => {
  for (const [name, cart] of Object.entries(CARTS)) {
    it(`cart parity: ${name}`, () => {
      for (const weekday of WEEKDAYS) expectParity(cart, weekday);
    });
  }

  it("STORE-FAVORABLE (owner directive): Saturday headline 30% lands on the LOWEST-priced item in both engines", () => {
    const cart: SrcLine[] = [
      { lineId: "half", regularPriceMinorUnits: 15000, quantity: 1, category: "flower", variantLabel: "14g" },
      { lineId: "j1", regularPriceMinorUnits: 2000, quantity: 1, category: "preroll" },
      { lineId: "j2", regularPriceMinorUnits: 1500, quantity: 1, category: "preroll" },
    ];
    for (const result of [legacyResultFor(cart, "saturday"), rulesResultFor(cart, "saturday")]) {
      const byId = new Map(result.lines.map((l) => [l.lineId, l]));
      // Cheapest item ($15 joint) gets the 30% headline; the rest get 15%.
      expect(byId.get("j2")!.unitPriceMinorUnits).toBe(1050); // 30% off 1500
      expect(byId.get("j1")!.unitPriceMinorUnits).toBe(1700); // 15% off 2000
      expect(byId.get("half")!.unitPriceMinorUnits).toBe(12750); // 15% off 15000
      // The highest-priced item NEVER receives the biggest percent.
      const pctOf = (id: string) =>
        (byId.get(id)!.unitSavingsMinorUnits / byId.get(id)!.regularPriceMinorUnits) * 100;
      expect(pctOf("half")).toBeLessThanOrEqual(pctOf("j2"));
      expect(pctOf("half")).toBeLessThanOrEqual(pctOf("j1"));
    }
  });

  it("STORE-FAVORABLE (owner directive): Sunday 3-for-2 on $150+$20+$15 saves at most the $15 item in both engines", () => {
    const cart: SrcLine[] = [
      { lineId: "half", regularPriceMinorUnits: 15000, quantity: 1, category: "flower", variantLabel: "14g" },
      { lineId: "j1", regularPriceMinorUnits: 2000, quantity: 1, category: "preroll" },
      { lineId: "j2", regularPriceMinorUnits: 1500, quantity: 1, category: "preroll" },
    ];
    for (const result of [legacyResultFor(cart, "sunday"), rulesResultFor(cart, "sunday")]) {
      // The deal's value is the LOWEST-priced item ($15.00 = 1500) — never more.
      expect(result.totalSavingsMinorUnits).toBeGreaterThan(0);
      expect(result.totalSavingsMinorUnits).toBeLessThanOrEqual(1500);
      // Spread as an equal percent — the $150 item never gets a bigger percent.
      const pcts = result.lines.map((l) => l.appliedPercent);
      for (const p of pcts) expect(p).toBe(pcts[0]);
    }
  });

  it("no active rules (weekday unresolved) prices everything at regular", () => {
    const cart = [
      { lineId: "a", regularPriceMinorUnits: 3500, quantity: 2, category: "flower" as GreenwayCategory },
    ];
    const r = computePromotions(cart.map(engineLine), []);
    expect(r.totalSavingsMinorUnits).toBe(0);
    expect(r.lines[0].unitPriceMinorUnits).toBe(3500);
  });
});

describe("snapshot mechanics", () => {
  it("seedRuleSnapshots covers all 7 weekdays with engine configs attached", () => {
    const seeds = seedRuleSnapshots();
    expect(seeds).toHaveLength(7);
    const byDay = new Map(seeds.map((s) => [s.weekday, s]));
    for (let d = 0 as 0 | 1 | 2 | 3 | 4 | 5 | 6; d <= 6; d++) {
      expect(byDay.get(d as 0)).toBeDefined();
    }
    // SLICE D1/D2: Tuesday and Wednesday are now TIERED, not either/or. The
    // either/or mechanic picked the option with the SMALLER savings, so a
    // 4-preroll basket got 20% when 25% was advertised; the tiers deliver the
    // advertised percent at every quantity. The seed is the single source of
    // truth (seedConfigFor derives these from DAILY_DEAL_SEEDS).
    expect(byDay.get(2)?.config.eitherOr).toBeUndefined();
    expect(byDay.get(2)?.config.qtyTiers).toEqual([
      { at: 1, percent: 20 },
      { at: 4, percent: 25 },
    ]);
    expect(byDay.get(3)?.config.spendTiers).toEqual([
      { at: 0, percent: 20 },
      { at: 15000, percent: 30 },
    ]);
    expect(byDay.get(6)?.config.basketTopItem).toEqual({ topPercent: 30, restPercent: 15 });
    expect(byDay.get(0)?.config.basketNforM).toEqual({ n: 3, m: 2 });
  });

  it("activeSnapshotsFor picks exactly the weekday's rule from the seeds", () => {
    const seeds = seedRuleSnapshots();
    for (const weekday of WEEKDAYS) {
      const active = activeSnapshotsFor(seeds, weekday);
      expect(active).toHaveLength(1);
      expect(active[0].weekday).toBe(STORE_WEEKDAY_TO_INDEX[weekday]);
    }
  });

  it("activeSnapshotsFor handles date-window and always-on rules", () => {
    const base = seedRuleSnapshots()[0];
    const now = new Date("2026-07-15T12:00:00-07:00");
    const windowed = {
      ...base,
      id: "db-1",
      weekday: null,
      startsAt: "2026-07-01T00:00:00Z",
      endsAt: "2026-07-31T23:59:59Z",
    };
    const expired = { ...windowed, id: "db-2", endsAt: "2026-07-10T00:00:00Z" };
    const alwaysOn = { ...base, id: "db-3", weekday: null, startsAt: null, endsAt: null };
    const active = activeSnapshotsFor([windowed, expired, alwaysOn], "wednesday", now);
    expect(active.map((s) => s.id)).toEqual(["db-1", "db-3"]);
  });
});

// ---------------------------------------------------------------------------
// Card preview parity vs the legacy getActiveMenuDiscount
// ---------------------------------------------------------------------------

function menuItem(over: Partial<GreenwayMenuItem> & { id: string }): GreenwayMenuItem {
  return {
    name: over.id,
    brand: "",
    category: "flower",
    strainType: "hybrid",
    thc: null,
    cbd: null,
    totalThc: null,
    totalCbd: null,
    compounds: [],
    description: "",
    priceLabel: "$35.00",
    priceMinorUnits: 3500,
    inventoryStatus: "in-stock",
    variants: [],
    ...over,
  } as GreenwayMenuItem;
}

const PREVIEW_ITEMS: GreenwayMenuItem[] = [
  menuItem({ id: "edible", category: "edible-solid", priceMinorUnits: 2500 }),
  menuItem({ id: "preroll", category: "preroll", priceMinorUnits: 1000 }),
  menuItem({ id: "cart", category: "cartridge", priceMinorUnits: 4500 }),
  menuItem({ id: "brand-flower", category: "flower", brand: "Buddies", priceMinorUnits: 4200 }),
  menuItem({ id: "plain-flower", category: "flower", brand: "Nobody Farms", priceMinorUnits: 3900 }),
  menuItem({ id: "rso-filter", category: "concentrate", filterCategories: ["rso"], priceMinorUnits: 5500 }),
  menuItem({ id: "merch", category: "merch", priceMinorUnits: 2000 }),
];

// INTENTIONAL FIX (documented divergence): the LEGACY Saturday card preview
// applied the storewide badge to merch/accessories too, but the cart engine
// NEVER discounted merch — an advertised price that would not be charged
// (advertising-integrity bug). The rules engine excludes merch from storewide
// deals on cards AND in the cart consistently (ruleMatchesLine), so merch is
// exempted from the legacy comparison below.
function isMerchPreviewItem(item: GreenwayMenuItem): boolean {
  const cats = item.filterCategories?.length ? item.filterCategories : [item.category];
  return cats.some((c) => ["merch", "accessories", "paraphernalia"].includes(String(c)));
}

describe("card preview parity — menuDiscountForItem == getActiveMenuDiscount", () => {
  const seeds = seedRuleSnapshots();
  for (const weekday of WEEKDAYS) {
    it(`weekday: ${weekday}`, () => {
      const active = activeSnapshotsFor(seeds, weekday);
      for (const item of PREVIEW_ITEMS) {
        const next = menuDiscountForItem(item, active);
        if (isMerchPreviewItem(item)) {
          // Merch never carries a cannabis daily-deal badge (fix, see above).
          expect(next).toBeUndefined();
          continue;
        }
        const legacy = getActiveMenuDiscount(item, weekday);
        if (!legacy) {
          expect(next).toBeUndefined();
          continue;
        }
        expect(next).toBeDefined();
        expect(next!.cardPreviewSalePriceMinorUnits).toBe(legacy.cardPreviewSalePriceMinorUnits);
        expect(next!.perItemSalePrice).toBe(legacy.perItemSalePrice);
        expect(next!.salePriceMinorUnits).toBe(legacy.salePriceMinorUnits);
        expect(next!.discountPercent).toBe(legacy.discountPercent);
      }
    });
  }

  it("selectOnDealItems mirrors the legacy on-deal filter (badge presence)", () => {
    for (const weekday of WEEKDAYS) {
      const active = activeSnapshotsFor(seeds, weekday);
      const nextIds = selectOnDealItems(PREVIEW_ITEMS, active, { limit: 99 }).map((i) => i.id);
      const legacyIds = PREVIEW_ITEMS.filter(
        (i) => !isMerchPreviewItem(i) && getActiveMenuDiscount(i, weekday) !== undefined,
      ).map((i) => i.id);
      expect(nextIds).toEqual(legacyIds);
    }
  });
});

describe("presentation derivation", () => {
  const seeds = seedRuleSnapshots();

  it("dealPresentationFor falls back to the static presentation for seeds", () => {
    for (const weekday of WEEKDAYS) {
      const view = dealPresentationFor(seeds, weekday);
      expect(view.fromDatabase).toBe(false);
      expect(view.title.length).toBeGreaterThan(0);
      expect(view.menuHref.startsWith("/menu")).toBe(true);
    }
  });

  it("weeklyDealSummaries yields 7 rows Mon→Sun with offer labels", () => {
    const rows = weeklyDealSummaries(seeds);
    expect(rows.map((r) => r.weekday)).toEqual(WEEKDAYS);
    for (const row of rows) expect(row.fromDatabase).toBe(false);
  });

  it("headlinePercentFor + offerLabelFor derive honest copy from configs", () => {
    const byDay = new Map(seeds.map((s) => [s.weekday, s]));
    expect(headlinePercentFor(byDay.get(1)!)).toBe(25); // Munchie Monday
    expect(headlinePercentFor(byDay.get(2)!)).toBe(20); // Doobie: authored headline
    expect(headlinePercentFor(byDay.get(3)!)).toBe(30); // Wax Wednesday best case
    expect(headlinePercentFor(byDay.get(6)!)).toBe(30); // Saturday top item
    // SLICE D1/D2: the tier ranges now render the honest span of each offer.
    expect(offerLabelFor(byDay.get(2)!)).toBe("20–25% off");
    expect(offerLabelFor(byDay.get(3)!)).toBe("20–30% off");
    expect(offerLabelFor(byDay.get(6)!)).toBe("15–30% off");
    expect(offerLabelFor(byDay.get(0)!)).toBe("3 for 2");
  });
});
