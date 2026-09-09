/**
 * tests/compliance/brand-match-wiring.test.ts  (SLICE T1 — wiring)
 *
 * WHY THIS FILE EXISTS — it was written to close a proven hole, not to pad the
 * suite. The T1 mutation harness (scripts/compliance/mutate-t1.py) scored 19/28
 * on its first run and FOUR of the nine survivors were wiring reverts:
 *
 *     wiring: engine brand target reverts to old hasCi        SURVIVED
 *     wiring: engine brand EXCLUSION reverts to old hasCi     SURVIVED
 *     wiring: checkout reverts to its own copy                SURVIVED
 *     wiring: menu card reverts to its own copy               SURVIVED
 *     multi:  revert engine AND checkout AND card together    SURVIVED
 *
 * They survived because every other T1 test calls the core matcher DIRECTLY.
 * That proves the matcher is correct; it does not prove the register, the
 * checkout and the shop card actually USE it — which is the entire point of
 * the slice. Someone could have reverted all three call sites and the suite
 * would still have gone green. That is a test defect, so the tests were fixed.
 *
 * These are not equivalent mutants: scripts/probe-t1-wired.ts measured the
 * three surfaces before and after the rewire and 'phat-panda' moved from 0%
 * to 25%. The assertions below pin exactly that measured behaviour.
 *
 * WHAT "AGREEMENT" MEANS HERE. Three independent code paths answer the same
 * business question — "is this product on Top Shelf Thursday?":
 *   1. the ENGINE (discount-engine-core) — what the register CHARGES,
 *   2. the CHECKOUT estimator (cart-discount) — what the cart PREVIEWS,
 *   3. the MENU CARD (daily-deals) — what the shop ADVERTISES.
 * When they disagree a customer sees "25% off" on a card and is then charged
 * full price at the counter. Each test drives the REAL exported function; no
 * matcher logic is re-implemented in this file.
 */
import { describe, expect, it } from "vitest";
import {
  computePromotions,
  type EngineCartLine,
  type EngineRule,
} from "@/lib/promotions/discount-engine-core";
import {
  computeCartDiscounts,
  type DiscountCartLine,
} from "@/lib/specials/cart-discount";
import {
  isTopShelfThursdayItem,
  getActiveMenuDiscount,
  topShelfThursdayBrands,
} from "@/lib/specials/daily-deals";
import { TOP_SHELF_THURSDAY_BRANDS } from "@/lib/promotions/daily-deal-seed";
import type { GreenwayMenuItem } from "@/lib/leafly/types";

// ---------------------------------------------------------------------------
// The spellings. Every one of these is a real-world way a POS/import can spell
// a brand: a doubled space (the raw Cultivera value), an all-caps import, a
// hyphenated slug. The last two are the CONTROL group — they must NOT match,
// because a matcher that says "yes" to everything also passes an agreement
// test. "Lifted Cannabis" is a DIFFERENT vendor from "Lifted", and "Phat Yeti"
// merely shares a first word with "Phat Panda".
// ---------------------------------------------------------------------------
const ON_DEAL = ["Phat  Panda", "Phat Panda", "PHAT PANDA", "phat-panda", "Lifted"] as const;
const OFF_DEAL = ["Lifted Cannabis", "Phat Yeti"] as const;

const PRICE = 4000;
/** 25% of 4000 = 1000 exactly, so no rounding rule can blur the comparison. */
const ON_DEAL_PRICE = 3000;

const thursdayRule = (over: Partial<EngineRule> = {}): EngineRule => ({
  id: "thu",
  title: "Top Shelf Thursday",
  discountType: "percent",
  discountPercent: 25,
  discountFixed: 0,
  priority: 10,
  storewide: false,
  targetCategories: [],
  targetBrands: [...TOP_SHELF_THURSDAY_BRANDS],
  targetProductKeys: [],
  excludeCategories: [],
  excludeBrands: [],
  excludeProductKeys: [],
  config: {},
  ...over,
});

const engineLine = (lineId: string, brand: string): EngineCartLine => ({
  lineId,
  regularPriceMinorUnits: PRICE,
  quantity: 1,
  categories: ["flower"],
  brand,
});

const cartLine = (lineId: string, brand: string): DiscountCartLine => ({
  lineId,
  regularPriceMinorUnits: PRICE,
  quantity: 1,
  category: "flower",
  brand,
});

const menuItem = (id: string, brand: string): GreenwayMenuItem =>
  ({
    id,
    name: `Item ${id}`,
    brand,
    category: "flower",
    priceMinorUnits: PRICE,
    variants: [],
  }) as unknown as GreenwayMenuItem;

/** ENGINE: percent actually charged for a single-brand cart. */
function enginePercent(brand: string, rule: EngineRule = thursdayRule()): number {
  const out = computePromotions([engineLine("L1", brand)], [rule]);
  return out.lines[0].appliedPercent;
}

/** CHECKOUT: percent the cart estimator previews on a Thursday. */
function checkoutPercent(brand: string): number {
  const out = computeCartDiscounts([cartLine("L1", brand)], "thursday");
  return out.lines[0].appliedPercent;
}

/** CARD: percent the shop advertises on a Thursday (0 when no badge). */
function cardPercent(brand: string): number {
  const d = getActiveMenuDiscount(menuItem("i1", brand), "thursday");
  return d?.discountPercent ?? 0;
}

describe("SLICE T1 wiring — engine, checkout and menu card share ONE matcher", () => {
  it("the three surfaces are reading the same brand list", () => {
    // If this drifts, the agreement tests below would be comparing surfaces
    // that legitimately target different brands, and their agreement would
    // mean nothing. Pin the shared source first.
    expect(topShelfThursdayBrands).toBe(TOP_SHELF_THURSDAY_BRANDS);
    expect(TOP_SHELF_THURSDAY_BRANDS).toContain("Phat Panda");
    expect(TOP_SHELF_THURSDAY_BRANDS).toContain("Lifted");
    // The control brands must genuinely be absent from the list, otherwise
    // the negative cases below would be vacuous.
    expect(TOP_SHELF_THURSDAY_BRANDS).not.toContain("Lifted Cannabis");
    expect(TOP_SHELF_THURSDAY_BRANDS).not.toContain("Phat Yeti");
  });

  it.each(ON_DEAL)("%j is on deal on ALL THREE surfaces (25%%)", (brand) => {
    // KILLS: "wiring: engine brand target reverts to old hasCi",
    //        "wiring: checkout reverts to its own copy",
    //        "wiring: menu card reverts to its own copy",
    //        "multi: revert engine AND checkout AND card together".
    // The old trim+lowercase copies answer NO for 'Phat  Panda' (doubled
    // space) and 'phat-panda' (hyphen), so any revert flips these to 0.
    expect(enginePercent(brand)).toBe(25);
    expect(checkoutPercent(brand)).toBe(25);
    expect(cardPercent(brand)).toBe(25);
    expect(isTopShelfThursdayItem(menuItem("i1", brand))).toBe(true);
  });

  it.each(OFF_DEAL)("%j is off deal on ALL THREE surfaces (0%%)", (brand) => {
    // The other half of the proof: a matcher that was loosened to
    // startsWith/includes would sweep these in. Different vendor, no sale.
    expect(enginePercent(brand)).toBe(0);
    expect(checkoutPercent(brand)).toBe(0);
    expect(cardPercent(brand)).toBe(0);
    expect(isTopShelfThursdayItem(menuItem("i1", brand))).toBe(false);
  });

  it("charges the same money on every surface, not merely the same percent", () => {
    // A percent can agree while the money does not (rounding, cost floor,
    // struck-price policy). Thursday is a clean flat per-item deal, so the
    // engine, the cart and the card preview must land on the same integer.
    for (const brand of ON_DEAL) {
      const engine = computePromotions([engineLine("L1", brand)], [thursdayRule()]);
      const cart = computeCartDiscounts([cartLine("L1", brand)], "thursday");
      const card = getActiveMenuDiscount(menuItem("i1", brand), "thursday");
      expect(engine.lines[0].unitPriceMinorUnits).toBe(ON_DEAL_PRICE);
      expect(cart.lines[0].unitPriceMinorUnits).toBe(ON_DEAL_PRICE);
      // Thursday is perItemSalePrice=true, so the card commits to a real price.
      expect(card?.salePriceMinorUnits).toBe(ON_DEAL_PRICE);
    }
  });

  it("a MIXED cart prices each line by brand, and the two cart paths agree", () => {
    // Single-brand carts can hide a matcher that returns a constant. A mixed
    // basket forces a per-line decision on both cart implementations at once.
    const brands = [...ON_DEAL, ...OFF_DEAL];
    const engine = computePromotions(
      brands.map((b, i) => engineLine(`L${i}`, b)),
      [thursdayRule()],
    );
    const cart = computeCartDiscounts(
      brands.map((b, i) => cartLine(`L${i}`, b)),
      "thursday",
    );
    const expected = brands.map((b) => (ON_DEAL.includes(b as never) ? ON_DEAL_PRICE : PRICE));
    expect(engine.lines.map((l) => l.unitPriceMinorUnits)).toEqual(expected);
    expect(cart.lines.map((l) => l.unitPriceMinorUnits)).toEqual(expected);
    // 5 discounted lines x 1000 saved.
    expect(engine.totalSavingsMinorUnits).toBe(5 * 1000);
    expect(cart.totalSavingsMinorUnits).toBe(5 * 1000);
  });

  it("EXCLUSIONS use the shared matcher too — a differently-spelled exclusion still excludes", () => {
    // KILLS: "wiring: engine brand EXCLUSION reverts to old hasCi".
    // This is the dangerous direction. If the exclusion list is compared with
    // the old trim+lowercase copy, an exclusion typed 'phat-panda' silently
    // FAILS TO EXCLUDE and the product goes on sale anyway — the store gives
    // away margin it explicitly said not to give away.
    const storewide = thursdayRule({
      id: "storewide",
      storewide: true,
      targetBrands: [],
      excludeBrands: ["phat-panda"],
    });
    // The excluded brand pays full price, in every spelling of it.
    for (const brand of ["Phat  Panda", "Phat Panda", "PHAT PANDA", "phat-panda"]) {
      expect(enginePercent(brand, storewide)).toBe(0);
    }
    // ...while a brand that is NOT excluded still gets the storewide deal,
    // proving the rule itself works and the zeros above are the exclusion.
    expect(enginePercent("Lifted", storewide)).toBe(25);
    // And a mere prefix neighbour is NOT swept into the exclusion.
    expect(enginePercent("Phat Yeti", storewide)).toBe(25);
  });

  it("exclusion beats target when both name the same brand differently", () => {
    // Exclusions win in the engine ("exclusions win" — ruleMatchesLine). If
    // either side stopped using the shared matcher, the two lists would stop
    // referring to the same brand and the exclusion would lose.
    const rule = thursdayRule({
      targetBrands: ["Phat Panda"],
      excludeBrands: ["PHAT  PANDA"],
    });
    // Every phat-panda spelling is BOTH targeted and excluded -> exclusion wins.
    for (const brand of ["Phat  Panda", "Phat Panda", "PHAT PANDA", "phat-panda"]) {
      expect(enginePercent(brand, rule)).toBe(0);
    }
    // 'Lifted' is simply not targeted by this narrowed rule.
    expect(enginePercent("Lifted", rule)).toBe(0);
  });

  it("blank and missing brands are never swept onto a brand deal", () => {
    // The engine must not treat "no brand" as "matches the first blank entry".
    // This is the reachable defect survivor S2 described, seen end-to-end.
    const rule = thursdayRule({ targetBrands: ["", "  ", "Phat Panda"] });
    for (const brand of ["", "   ", "-"]) {
      expect(enginePercent(brand, rule)).toBe(0);
      expect(checkoutPercent(brand)).toBe(0);
      expect(cardPercent(brand)).toBe(0);
    }
    // The real brand in that same list still works, so the rule is live.
    expect(enginePercent("Phat  Panda", rule)).toBe(25);
  });

  it("a blank ENTRY in an exclusion list does not exclude unbranded products", () => {
    // Same defect, the expensive direction: a stray empty row in the admin
    // exclusion list must not quietly drop every unbranded product out of a
    // storewide sale.
    const storewide = thursdayRule({
      id: "storewide",
      storewide: true,
      targetBrands: [],
      excludeBrands: ["", "Phat Panda"],
    });
    expect(enginePercent("", storewide)).toBe(25);
    expect(enginePercent("Buddies", storewide)).toBe(25);
    expect(enginePercent("PHAT PANDA", storewide)).toBe(0);
  });
});
