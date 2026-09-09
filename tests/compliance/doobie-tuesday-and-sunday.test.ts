/**
 * tests/compliance/doobie-tuesday-and-sunday.test.ts  (SLICE D1)
 *
 * The behaviour net for the discounts round. These tests are written against
 * the deals AS THE OWNER STATES THEM, not against the code's current output,
 * so they fail if the implementation ever drifts back:
 *
 *   Tuesday  "the tiers are, 1-3 prerolls are 20%, 4+ are 25% off. this should
 *             apply to any preroll including infused, blunts and packs."
 *   Sunday   "buy 3 for the price of 2, storewide mix & match." + "Sunday needs
 *             to be exact."
 *   Rounding "if it can't be exact, then we need to round in the customers
 *             favor somehow... I'm fine with giving the customer the benefit of
 *             the doubt so we can honor discounts as advertised."
 *   Policy   "'store wins' is more for rounding issues" - a ROUNDING rule, NOT
 *             a deal-selection rule.
 *
 * The one rule that outranks all of the above is the law: a unit may never be
 * sold below the cost of acquisition (RCW 69.50.357 / CCRS). Where the cost
 * floor bites, under-delivering the advert is the correct, legal outcome.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  computePromotions,
  ruleMatchesLine,
  DEFAULT_SPEND_TIERS,
  type EngineCartLine,
  type EngineRule,
} from "@/lib/promotions/discount-engine-core";
import {
  apportionBundleSavings,
  bundleTargetMinorUnits,
} from "@/lib/promotions/bundle-apportionment-core";
import {
  computeCartDiscounts,
  type DiscountCartLine,
} from "@/lib/specials/cart-discount";
import type { StoreWeekday } from "@/lib/specials/daily-deals";
import {
  activeSnapshotsFor,
  guaranteedPercentFor,
  headlinePercentFor,
  menuCardDiscountForItem,
  seedConfigFor,
  seedRuleSnapshots,
} from "@/lib/promotions/published-rules-core";
import { DAILY_DEAL_SEEDS } from "@/lib/promotions/daily-deal-seed";

function rule(over: Partial<EngineRule>): EngineRule {
  return {
    id: "r1",
    title: "Deal",
    discountType: "percent",
    discountPercent: 0,
    discountFixed: 0,
    priority: 10,
    storewide: false,
    targetCategories: [],
    targetBrands: [],
    targetProductKeys: [],
    excludeCategories: [],
    excludeBrands: [],
    excludeProductKeys: [],
    config: {},
    ...over,
  } as EngineRule;
}

const TUESDAY = rule({
  discountType: "multi_item_tier",
  targetCategories: ["preroll", "blunt", "preroll-pack", "infused-preroll", "infused-blunt", "infused-preroll-pack"],
  config: { qtyTiers: [{ at: 1, percent: 20 }, { at: 4, percent: 25 }] },
});

const SUNDAY = rule({ discountType: "basket", storewide: true, config: { basketNforM: { n: 3, m: 2 } } });

// ---------------------------------------------------------------------------
// Doobie Tuesday
// ---------------------------------------------------------------------------

describe("Doobie Tuesday: 1-3 = 20%, 4+ = 25%", () => {
  it("never dips below the advertised rate at ANY quantity (the sawtooth is gone)", () => {
    // The defect produced 20,20,20,20,20,16,14,20,20,20,18,20 across qty 1-12:
    // the 4-for-3 was discarded whenever it HELPED and chosen only where the
    // floored percent happened to be worse than a flat 20%.
    for (let q = 1; q <= 24; q += 1) {
      const r = computePromotions(
        [{ lineId: "p", regularPriceMinorUnits: 1000, quantity: q, categories: ["preroll"] }],
        [TUESDAY],
      );
      const effective = (r.totalSavingsMinorUnits / (1000 * q)) * 100;
      const advertised = q >= 4 ? 25 : 20;
      expect(effective, `qty ${q} effective percent`).toBeGreaterThanOrEqual(advertised - 1e-9);
    }
  });

  it("is exactly 20% for 1-3 and exactly 25% for 4+", () => {
    const at = (q: number) =>
      computePromotions(
        [{ lineId: "p", regularPriceMinorUnits: 1000, quantity: q, categories: ["preroll"] }],
        [TUESDAY],
      ).totalSavingsMinorUnits;
    expect(at(1)).toBe(200);
    expect(at(2)).toBe(400);
    expect(at(3)).toBe(600);
    expect(at(4)).toBe(1000); // the advertised "4 for the price of 3"
    expect(at(5)).toBe(1250);
    expect(at(8)).toBe(2000);
  });

  it("savings never DECREASE when the customer adds another preroll", () => {
    let prev = -1;
    for (let q = 1; q <= 24; q += 1) {
      const s = computePromotions(
        [{ lineId: "p", regularPriceMinorUnits: 1000, quantity: q, categories: ["preroll"] }],
        [TUESDAY],
      ).totalSavingsMinorUnits;
      expect(s, `qty ${q} vs ${q - 1}`).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("applies to infused prerolls, blunts and packs, not just plain prerolls", () => {
    for (const cat of ["preroll", "blunt", "preroll-pack", "infused-preroll", "infused-blunt", "infused-preroll-pack"]) {
      const r = computePromotions(
        [{ lineId: "p", regularPriceMinorUnits: 1000, quantity: 4, categories: [cat] }],
        [TUESDAY],
      );
      expect(r.totalSavingsMinorUnits, `${cat} at qty 4`).toBe(1000);
    }
  });

  it("counts units ACROSS lines: 4 different single prerolls still reach 25%", () => {
    const lines: EngineCartLine[] = [1, 2, 3, 4].map((i) => ({
      lineId: `p${i}`,
      regularPriceMinorUnits: 1000,
      quantity: 1,
      categories: ["preroll"],
    }));
    const r = computePromotions(lines, [TUESDAY]);
    expect(r.totalSavingsMinorUnits).toBe(1000);
  });

  it("the website cart agrees with the engine (no second, drifting copy)", () => {
    // cart-discount.ts holds an INDEPENDENT implementation. Divergence between
    // the two is what let the register and the website quote different prices.
    for (const q of [1, 2, 3, 4, 5, 6, 7, 8, 11, 12]) {
      const cart = computeCartDiscounts(
        [{ lineId: "p", regularPriceMinorUnits: 1000, quantity: q, category: "preroll" }],
        "tuesday",
      );
      const cartSavings = cart.totalSavingsMinorUnits;
      const engine = computePromotions(
        [{ lineId: "p", regularPriceMinorUnits: 1000, quantity: q, categories: ["preroll"] }],
        [TUESDAY],
      ).totalSavingsMinorUnits;
      expect(cartSavings, `qty ${q}: website vs engine`).toBe(engine);
    }
  });

  it("the seed is the single source of truth for the tiers", () => {
    // seedConfigFor() must DERIVE the tiers from the seed row, not restate them,
    // so the two can never silently diverge.
    const seed = DAILY_DEAL_SEEDS.find((s) => s.promoKey === "daily.tuesday");
    expect(seed?.qtyTiers).toEqual([
      { at: 1, percent: 20 },
      { at: 4, percent: 25 },
    ]);
    expect(seedConfigFor("daily.tuesday").qtyTiers).toEqual(seed?.qtyTiers);
  });

  it("no longer resolves Tuesday through a store-advantaged either/or", () => {
    expect(seedConfigFor("daily.tuesday").eitherOr).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Either/or, wherever it is still authored
// ---------------------------------------------------------------------------

describe("either/or honours the advertising, not the store", () => {
  const EO = rule({
    discountType: "multi_item_tier",
    targetCategories: ["preroll"],
    config: { eitherOr: { flatPercent: 20, bundle: { n: 4, m: 3 } } },
  });

  it("takes the BETTER of the two options for the customer", () => {
    const four = computePromotions(
      [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: 4, categories: ["preroll"] }],
      [EO],
    );
    expect(four.totalSavingsMinorUnits).toBe(1000); // bundle beats flat $8
  });

  it("keeps the flat rate when the bundle is worth less", () => {
    const mixed = computePromotions(
      [
        { lineId: "a", regularPriceMinorUnits: 2000, quantity: 3, categories: ["preroll"] },
        { lineId: "b", regularPriceMinorUnits: 200, quantity: 1, categories: ["preroll"] },
      ],
      [EO],
    );
    expect(mixed.totalSavingsMinorUnits).toBe(1240); // flat beats the $2 bundle
  });

  it("is never worse than the weaker of the two options", () => {
    for (let q = 1; q <= 16; q += 1) {
      const r = computePromotions(
        [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: q, categories: ["preroll"] }],
        [EO],
      );
      expect(r.totalSavingsMinorUnits, `qty ${q}`).toBeGreaterThanOrEqual(Math.floor(1000 * q * 0.2));
    }
  });
});

// ---------------------------------------------------------------------------
// Ice Cream Sunday
// ---------------------------------------------------------------------------

describe("Ice Cream Sunday: buy 3, pay for 2 - exact", () => {
  it("delivers the owner's example EXACTLY ($150 + $20 + $15 -> $15.00)", () => {
    const r = computePromotions(
      [
        { lineId: "half", regularPriceMinorUnits: 15000, quantity: 1, categories: ["flower"] },
        { lineId: "j1", regularPriceMinorUnits: 2000, quantity: 1, categories: ["preroll"] },
        { lineId: "j2", regularPriceMinorUnits: 1500, quantity: 1, categories: ["preroll"] },
      ],
      [SUNDAY],
    );
    expect(r.totalSavingsMinorUnits).toBe(1500);
  });

  it("never delivers LESS than the advertised cheapest-unit value", () => {
    // The old floored percent lost up to 80c on a $20 target. Sweep a wide set
    // of baskets and assert the advert is always met or beaten.
    const prices = [199, 500, 733, 1000, 1250, 1999, 2500, 4999];
    let checked = 0;
    for (const a of prices) {
      for (const b of prices) {
        for (const c of prices) {
          const lines: EngineCartLine[] = [
            { lineId: "a", regularPriceMinorUnits: a, quantity: 1, categories: ["flower"] },
            { lineId: "b", regularPriceMinorUnits: b, quantity: 1, categories: ["edible-solid"] },
            { lineId: "c", regularPriceMinorUnits: c, quantity: 1, categories: ["preroll"] },
          ];
          const target = bundleTargetMinorUnits(
            lines.map((l) => ({
              lineId: l.lineId,
              regularPriceMinorUnits: l.regularPriceMinorUnits,
              quantity: l.quantity,
              floorMinorUnits: 0,
            })),
            3,
            2,
          );
          const r = computePromotions(lines, [SUNDAY]);
          expect(r.totalSavingsMinorUnits, `${a}/${b}/${c}`).toBeGreaterThanOrEqual(target);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(prices.length ** 3);
  });

  it("rounds in the CUSTOMER's favour when exactness is impossible", () => {
    // One line of quantity 3 can only move in 3-cent steps, so a $10.00 target
    // is unreachable. The engine must overshoot to $10.02, never undershoot to
    // $9.99. Owner: "take a penny extra out of one".
    const r = computePromotions(
      [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: 3, categories: ["edible-solid"] }],
      [SUNDAY],
    );
    expect(r.totalSavingsMinorUnits).toBeGreaterThanOrEqual(1000);
    expect(r.totalSavingsMinorUnits).toBe(1002);
  });

  it("the overshoot is always the SMALLEST reachable one (never generous by accident)", () => {
    for (let q = 3; q <= 30; q += 3) {
      for (const price of [333, 500, 999, 1000, 1777]) {
        const r = computePromotions(
          [{ lineId: "a", regularPriceMinorUnits: price, quantity: q, categories: ["edible-solid"] }],
          [SUNDAY],
        );
        const target = (q / 3) * price;
        // A single line of quantity q can only express multiples of q cents.
        const smallestReachable = Math.ceil(target / q) * q;
        expect(r.totalSavingsMinorUnits, `${q} x ${price}`).toBe(smallestReachable);
      }
    }
  });

  it("spreads across every eligible line rather than zeroing one item", () => {
    const r = computePromotions(
      [
        { lineId: "a", regularPriceMinorUnits: 3000, quantity: 2, categories: ["flower"] },
        { lineId: "b", regularPriceMinorUnits: 900, quantity: 1, categories: ["preroll"] },
      ],
      [SUNDAY],
    );
    expect(r.lines.every((l) => l.unitSavingsMinorUnits > 0)).toBe(true);
    expect(r.totalSavingsMinorUnits).toBe(900);
    expect(r.lines.every((l) => l.unitPriceMinorUnits > 0)).toBe(true);
  });

  it("no unit is ever free, even on a rock-bottom basket", () => {
    const r = computePromotions(
      [{ lineId: "a", regularPriceMinorUnits: 100, quantity: 3, categories: ["flower"] }],
      [rule({ discountType: "basket", storewide: true, config: { basketNforM: { n: 3, m: 0 } } })],
    );
    expect(r.lines[0].unitPriceMinorUnits).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Wax Wednesday (SLICE D2)
// ---------------------------------------------------------------------------

describe("Wax Wednesday: 20% off, 30% at $150+", () => {
  const wednesdayRule = rule({
    discountType: "threshold_spend",
    promoKey: "daily.wednesday",
    targetCategories: ["cartridge", "disposable-cartridge", "concentrate", "rso"],
    config: seedConfigFor("daily.wednesday"),
  } as Partial<EngineRule>);

  it("is exactly two tiers - no $50 or $100 rung", () => {
    // Owner: "the deal is 20% off or 30% off over 150 dollars. Not the ladder."
    expect(seedConfigFor("daily.wednesday").spendTiers).toEqual([
      { at: 0, percent: 20 },
      { at: 15000, percent: 30 },
    ]);
  });

  it("gives 20% off even on a small basket (the advertised base rate)", () => {
    // Before D2 this paid 0%: the ladder started at $50. A customer buying one
    // $40 cartridge was promised 20% off and charged full price.
    for (const spend of [500, 1000, 3999, 4999]) {
      const r = computePromotions(
        [{ lineId: "a", regularPriceMinorUnits: spend, quantity: 1, categories: ["concentrate"] }],
        [wednesdayRule],
      );
      // At least 20%, and never more than a cent above it: a price like $39.99
      // cannot divide evenly, so the spare cent goes to the CUSTOMER (20.005%).
      expect(r.totalSavingsMinorUnits, `$${spend / 100}`).toBeGreaterThanOrEqual(
        Math.ceil(spend * 0.2),
      );
      expect(r.totalSavingsMinorUnits, `$${spend / 100} overshoot`).toBeLessThanOrEqual(
        Math.ceil(spend * 0.2),
      );
    }
  });

  it("steps to 30% at exactly $150 and never before", () => {
    const pct = (spend: number) => {
      const r = computePromotions(
        [{ lineId: "a", regularPriceMinorUnits: spend, quantity: 1, categories: ["concentrate"] }],
        [wednesdayRule],
      );
      return (r.totalSavingsMinorUnits / spend) * 100;
    };
    // $149.99 at 20% is $29.998 -> the customer gets $30.00, i.e. 20.0013%.
    expect(pct(14999)).toBeGreaterThanOrEqual(20);
    expect(pct(14999)).toBeLessThan(20.01);
    expect(pct(15000)).toBeCloseTo(30, 6);
    expect(pct(20000)).toBeCloseTo(30, 6);
  });

  it("never pays less than the rate advertised on /specials", () => {
    for (let spend = 100; spend <= 30000; spend += 137) {
      const r = computePromotions(
        [{ lineId: "a", regularPriceMinorUnits: spend, quantity: 1, categories: ["concentrate"] }],
        [wednesdayRule],
      );
      const advertised = spend >= 15000 ? 30 : 20;
      const effective = (r.totalSavingsMinorUnits / spend) * 100;
      expect(effective, `$${(spend / 100).toFixed(2)}`).toBeGreaterThanOrEqual(advertised - 1e-6);
    }
  });

  it("the website cart agrees with the engine at every threshold", () => {
    for (const spend of [500, 4999, 5000, 9999, 10000, 14999, 15000, 25000]) {
      const cart = computeCartDiscounts(
        [{ lineId: "a", regularPriceMinorUnits: spend, quantity: 1, category: "concentrate" }],
        "wednesday",
      );
      const engine = computePromotions(
        [{ lineId: "a", regularPriceMinorUnits: spend, quantity: 1, categories: ["concentrate"] }],
        [wednesdayRule],
      );
      expect(cart.totalSavingsMinorUnits, `$${spend / 100}: website vs engine`).toBe(
        engine.totalSavingsMinorUnits,
      );
    }
  });

  it("a zero-threshold base tier survives an admin save", () => {
    // parseTierRows rejected `at > 0`, so simply opening Wax Wednesday in
    // /admin/promotions and pressing Save silently deleted the 20% base tier,
    // collapsing the deal back to "nothing below $150".
    const seed = DAILY_DEAL_SEEDS.find((s) => s.promoKey === "daily.wednesday");
    expect(seed?.spendTiers?.some((t) => t.at === 0 && t.percent === 20)).toBe(true);

    // parseTierRows lives inside a "use server" module and cannot be imported
    // here, so assert on the source. A source assertion is a weak test in
    // general, but this predicate is a one-character change that silently
    // deletes a live tier, and leaving it unguarded is worse.
    const src = readFileSync(
      resolve(__dirname, "../../src/app/admin/promotions/actions.ts"),
      "utf-8",
    );
    expect(src, "parseTierRows must accept a zero threshold").toContain(
      "at >= 0 && Number.isFinite(percent)",
    );
    expect(src, "parseTierRows must not reject at === 0").not.toContain(
      "at > 0 && Number.isFinite(percent)",
    );
  });

  it("leaves the GENERIC spend-tier fallback alone", () => {
    // DEFAULT_SPEND_TIERS backs staff-created threshold_spend promotions, not
    // Wednesday. Rewriting it would silently re-price unrelated deals.
    expect(DEFAULT_SPEND_TIERS).toEqual([
      { at: 5000, percent: 15 },
      { at: 10000, percent: 20 },
      { at: 15000, percent: 30 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The law outranks the advert
// ---------------------------------------------------------------------------

describe("cost floor outranks the advertised target", () => {
  it("under-delivers rather than selling below acquisition cost", () => {
    const r = computePromotions(
      [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: 3, categories: ["flower"], costMinorUnits: 500 }],
      [SUNDAY],
    );
    // ceil(500 x 1.463) = 732 is the tax-inclusive floor.
    expect(r.lines[0].unitPriceMinorUnits).toBe(732);
    expect(r.lines[0].unitPriceMinorUnits).toBeGreaterThanOrEqual(732);
    expect(r.totalSavingsMinorUnits).toBeLessThan(1000); // legally short of the advert
  });

  it("Tuesday's 25% also yields to the cost floor", () => {
    const r = computePromotions(
      [{ lineId: "p", regularPriceMinorUnits: 1000, quantity: 4, categories: ["preroll"], costMinorUnits: 600 }],
      [TUESDAY],
    );
    const floor = Math.ceil(600 * 1.463);
    expect(r.lines[0].unitPriceMinorUnits).toBeGreaterThanOrEqual(floor);
  });
});

// ---------------------------------------------------------------------------
// The rounding policy, across every deal
// ---------------------------------------------------------------------------

describe("rounding always favours the customer (owner policy)", () => {
  it("a flat percent NEVER delivers less than advertised, at any price", () => {
    // Before D2 this failed for 47.1% of price/percent combinations, by up to
    // half a cent, because Math.round() was applied to the PRICE - rounding the
    // price up rounds the discount down. Measured over 79,604 combinations.
    for (let price = 100; price <= 5000; price += 7) {
      for (const pct of [15, 20, 25, 30]) {
        const r = computePromotions(
          [{ lineId: "a", regularPriceMinorUnits: price, quantity: 1, categories: ["concentrate"] }],
          [rule({ discountType: "percent", discountPercent: pct, targetCategories: ["concentrate"] })],
        );
        expect(r.totalSavingsMinorUnits, `$${price / 100} @ ${pct}%`).toBeGreaterThanOrEqual(
          (price * pct) / 100,
        );
      }
    }
  });

  it("but is never generous by more than a single cent per unit", () => {
    for (let price = 100; price <= 5000; price += 7) {
      for (const pct of [15, 20, 25, 30]) {
        const r = computePromotions(
          [{ lineId: "a", regularPriceMinorUnits: price, quantity: 1, categories: ["concentrate"] }],
          [rule({ discountType: "percent", discountPercent: pct, targetCategories: ["concentrate"] })],
        );
        expect(r.totalSavingsMinorUnits, `$${price / 100} @ ${pct}%`).toBeLessThanOrEqual(
          Math.ceil((price * pct) / 100),
        );
      }
    }
  });

  it("the website cart rounds identically to the register", () => {
    // Two independent implementations; a one-cent disagreement between the
    // website quote and the till is a customer-service problem every time.
    for (let price = 137; price <= 4000; price += 53) {
      const cart = computeCartDiscounts(
        [{ lineId: "a", regularPriceMinorUnits: price, quantity: 1, category: "concentrate" }],
        "wednesday",
      );
      const engine = computePromotions(
        [{ lineId: "a", regularPriceMinorUnits: price, quantity: 1, categories: ["concentrate"] }],
        [
          rule({
            discountType: "threshold_spend",
            promoKey: "daily.wednesday",
            targetCategories: ["concentrate"],
            config: seedConfigFor("daily.wednesday"),
          } as Partial<EngineRule>),
        ],
      );
      expect(cart.totalSavingsMinorUnits, `$${price / 100}`).toBe(engine.totalSavingsMinorUnits);
    }
  });
});

// ---------------------------------------------------------------------------
// The apportionment core's own contract
// ---------------------------------------------------------------------------

describe("bundle apportionment: whole cents, customer-favoured", () => {
  it("places the exact target whenever the line shape allows it", () => {
    const lines = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, floorMinorUnits: 0 },
      { lineId: "b", regularPriceMinorUnits: 700, quantity: 1, floorMinorUnits: 0 },
      { lineId: "c", regularPriceMinorUnits: 300, quantity: 1, floorMinorUnits: 0 },
    ];
    const r = apportionBundleSavings(lines, 300);
    expect(r.placedMinorUnits).toBe(300);
    expect(r.varianceMinorUnits).toBe(0);
  });

  it("never places less than the target while headroom remains", () => {
    for (let target = 1; target <= 400; target += 7) {
      const lines = [
        { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, floorMinorUnits: 0 },
        { lineId: "b", regularPriceMinorUnits: 700, quantity: 2, floorMinorUnits: 0 },
      ];
      const r = apportionBundleSavings(lines, target);
      expect(r.placedMinorUnits, `target ${target}`).toBeGreaterThanOrEqual(target);
    }
  });

  it("respects per-line floors and reports when it is floor-bound", () => {
    const lines = [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, floorMinorUnits: 900 }];
    const r = apportionBundleSavings(lines, 500);
    expect(r.placedMinorUnits).toBeLessThanOrEqual(100);
    expect(r.floorBound).toBe(true);
  });

  it("REDISTRIBUTES around a floor-bound line instead of silently losing the savings", () => {
    // Regression found by scripts/compliance/mutate-d1.py: the cost floor is
    // enforced in two places (here, and again by clampEngineUnit afterwards),
    // so dropping it HERE looked harmless - apportionment still reported the
    // full target placed. It is not harmless: it hands savings to a line that
    // cannot legally absorb them, the later clamp truncates the excess, and the
    // basket quietly under-delivers. Measured: a $5.00 target collapsed to
    // $2.60. Apportionment must know each line's floor so it can push the
    // remainder onto lines with headroom.
    const lines = [
      { lineId: "cheap", regularPriceMinorUnits: 1000, quantity: 1, floorMinorUnits: 990 },
      { lineId: "rich", regularPriceMinorUnits: 1000, quantity: 1, floorMinorUnits: 0 },
    ];
    const r = apportionBundleSavings(lines, 500);
    expect(r.placedMinorUnits).toBe(500);
    // The floor-bound line may give at most 10c; everything else goes to "rich".
    expect(r.perUnitOff.get("cheap") ?? 0).toBeLessThanOrEqual(10);
    expect(r.perUnitOff.get("rich") ?? 0).toBeGreaterThanOrEqual(490);
    // No line may ever be pushed below its floor.
    for (const l of lines) {
      const off = r.perUnitOff.get(l.lineId) ?? 0;
      expect(l.regularPriceMinorUnits - off).toBeGreaterThanOrEqual(l.floorMinorUnits);
    }
  });

  it("end-to-end: a floor-bound Sunday basket still delivers the full advertised value", () => {
    // The same defect, through the real engine: one line pinned near its cost
    // floor must not cost the customer the rest of the discount.
    const r = computePromotions(
      [
        { lineId: "pinned", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"], costMinorUnits: 670 },
        { lineId: "free", regularPriceMinorUnits: 4000, quantity: 1, categories: ["flower"] },
        { lineId: "free2", regularPriceMinorUnits: 4000, quantity: 1, categories: ["flower"] },
      ],
      [SUNDAY],
    );
    // Cheapest of three units is $10.00 -> that is the advertised value.
    expect(r.totalSavingsMinorUnits).toBeGreaterThanOrEqual(1000);
    const pinned = r.lines.find((l) => l.lineId === "pinned")!;
    expect(pinned.unitPriceMinorUnits).toBeGreaterThanOrEqual(Math.ceil(670 * 1.463));
  });

  it("computes the N-for-M target from the CHEAPEST units", () => {
    const lines = [
      { lineId: "a", regularPriceMinorUnits: 5000, quantity: 2, floorMinorUnits: 0 },
      { lineId: "b", regularPriceMinorUnits: 100, quantity: 1, floorMinorUnits: 0 },
    ];
    // 3 units, one group of 3, one free unit -> the cheapest ($1.00).
    expect(bundleTargetMinorUnits(lines, 3, 2)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// SLICE D2 - CARD/CART ADVERTISING PARITY
//
// Added because the mutation harness scored 19/22: the three surviving
// mutations were all "make the product card advertise a discount the register
// will not honour", and no test noticed. The struck card price is a PROMISE
// about one item, alone, right now -- so it may never be lower than what the
// cart charges for exactly that item.
//
// MEASURED at the time of writing: 0 over-advertisements across 6,370
// weekday x category x price x variant combinations (down from 265).
// ---------------------------------------------------------------------------
describe("card/cart advertising parity (SLICE D2)", () => {
  // A minimal menu item for card-preview assertions. Category and price are
  // always explicit at the call site so an override can never be silently
  // dropped (an earlier version took an `over` bag it never spread).
  const baseItem = (category: string, priceMinorUnits: number) =>
    ({
      id: "x",
      slug: "x",
      name: "X",
      brand: "Lifted",
      category,
      priceMinorUnits,
    }) as unknown as Parameters<typeof menuCardDiscountForItem>[0];

  const ALL_DAYS: StoreWeekday[] = [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  ];
  const SWEEP_CATEGORIES = [
    "flower", "preroll", "infused-preroll", "blunt", "preroll-pack", "concentrate",
    "cartridge", "disposable-cartridge", "edible-solid", "edible-liquid", "rso",
    "tincture", "topical", "merch",
  ];
  const SWEEP_PRICES = [100, 500, 1000, 2500, 3999, 4000, 5000, 9999, 10000, 14999, 15000, 20000, 50000];

  it("a product card NEVER advertises a price lower than the cart charges", () => {
    const seeds = seedRuleSnapshots();
    const offenders: string[] = [];
    let checked = 0;
    for (const day of ALL_DAYS) {
      const rules = activeSnapshotsFor(seeds, day);
      for (const category of SWEEP_CATEGORIES) {
        for (const price of SWEEP_PRICES) {
          const item = baseItem(category, price);
          const card = menuCardDiscountForItem(item, rules, day);
          const advertised = card?.cardPreviewSalePriceMinorUnits ?? price;
          const charged = computeCartDiscounts(
            [
              {
                lineId: "x",
                regularPriceMinorUnits: price,
                quantity: 1,
                category: category as DiscountCartLine["category"],
                brand: "Lifted",
              },
            ],
            day,
          ).lines[0].unitPriceMinorUnits;
          checked += 1;
          if (advertised < charged) {
            offenders.push(`${day}/${category}/$${price}: card=${advertised} cart=${charged}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(offenders).toEqual([]);
  });

  it("Wax Wednesday: a $40 cartridge card shows 20% off, exactly what it is charged", () => {
    // The measured defect: card previewed $28.00 (30%) and the register
    // charged $32.00 (20%) -- a $4.00 over-advertisement on every sub-$150 card.
    const seeds = seedRuleSnapshots();
    const rules = activeSnapshotsFor(seeds, "wednesday");
    const item = baseItem("cartridge", 4000);
    const card = menuCardDiscountForItem(item, rules, "wednesday");
    expect(card).toBeDefined();
    expect(card!.discountPercent).toBe(20);
    expect(card!.cardPreviewSalePriceMinorUnits).toBe(3200);

    // At $150 the top tier is genuinely guaranteed, so the card may show 30%.
    const big = baseItem("cartridge", 15000);
    const cardBig = menuCardDiscountForItem(big, rules, "wednesday");
    expect(cardBig!.discountPercent).toBe(30);
    expect(cardBig!.cardPreviewSalePriceMinorUnits).toBe(10500);
  });

  it("guaranteedPercentFor never exceeds the headline, and is the CHARGED percent for tiers", () => {
    const seeds = seedRuleSnapshots();
    const byDay = new Map(seeds.map((s) => [s.promoKey, s]));
    const wed = byDay.get("daily.wednesday")!;
    const cheap = baseItem("cartridge", 4000);
    const rich = baseItem("cartridge", 15000);
    // Base tier for a small basket, top tier once the threshold is truly met.
    expect(guaranteedPercentFor(wed, cheap)).toBe(20);
    expect(guaranteedPercentFor(wed, rich)).toBe(30);
    expect(guaranteedPercentFor(wed, cheap)).toBeLessThanOrEqual(headlinePercentFor(wed));

    // Quantity tiers: a card is ONE unit, so it can only promise the 1-unit tier.
    const tue = byDay.get("daily.tuesday")!;
    const preroll = baseItem("preroll", 1000);
    expect(guaranteedPercentFor(tue, preroll)).toBe(20);

    // Basket mechanics guarantee a lone item nothing at all.
    const sun = byDay.get("daily.sunday")!;
    const sat = byDay.get("daily.saturday")!;
    expect(guaranteedPercentFor(sun, preroll)).toBe(0);
    expect(guaranteedPercentFor(sat, preroll)).toBe(0);
  });

  it("Top Shelf Thursday never strikes a price on BRANDED MERCH (cart skips merch)", () => {
    // ruleMatchesLine matched merch through the BRAND dimension, so a
    // Lifted-branded t-shirt was struck 25% off while the cart charged full
    // price. Merch is only ever discounted by an EXPLICIT merch category target.
    const seeds = seedRuleSnapshots();
    const rules = activeSnapshotsFor(seeds, "thursday");
    const merch = baseItem("merch", 2000);
    expect(menuCardDiscountForItem(merch, rules, "thursday")).toBeUndefined();

    // The cannabis item from the same featured brand still gets its 25%.
    const flower = baseItem("flower", 4000);
    const card = menuCardDiscountForItem(flower, rules, "thursday");
    expect(card!.discountPercent).toBe(25);
    expect(card!.cardPreviewSalePriceMinorUnits).toBe(3000);
  });

  it("a TITLE COLLISION between two published rules cannot inflate the card", () => {
    // SELF-REVIEW FIX (part 6d): the guarantee used to be joined to its rule by
    // TITLE. Nothing enforces title uniqueness -- staff publish promotions from
    // /admin/promotions -- and a collision would let the card read a guarantee
    // from a rule that did not produce the deal. The join is now by rule
    // IDENTITY (ruleMatchesLine), so this basket of two same-titled rules is
    // resolved correctly.
    const seeds = seedRuleSnapshots();
    const wed = seeds.find((s) => s.promoKey === "daily.wednesday")!;
    // A second ACTIVE rule sharing Wax Wednesday's title, targeting a category
    // the cartridge does NOT belong to, and offering a fat flat percent.
    const impostor = {
      ...wed,
      id: "db-impostor",
      promoKey: "custom.impostor",
      discountType: "percent",
      discountPercent: 60,
      config: {},
      targetCategories: ["edible-solid"],
      storewide: false,
    } as unknown as typeof wed;

    const item = baseItem("cartridge", 4000);
    const card = menuCardDiscountForItem(item, [wed, impostor], "wednesday");
    // The cartridge is only ever eligible for the 20% base tier of Wax
    // Wednesday; the impostor cannot lend it a 60% guarantee.
    expect(card).toBeDefined();
    expect(card!.discountPercent).toBe(20);
    expect(card!.cardPreviewSalePriceMinorUnits).toBe(3200);

    // And the invariant itself: the card still never beats the register.
    const charged = computeCartDiscounts(
      [
        {
          lineId: "x",
          regularPriceMinorUnits: 4000,
          quantity: 1,
          category: "cartridge",
          brand: "Lifted",
        },
      ],
      "wednesday",
    ).lines[0].unitPriceMinorUnits;
    expect(card!.cardPreviewSalePriceMinorUnits).toBeGreaterThanOrEqual(charged);
  });

  it("an EXPLICIT merch category target still discounts merch (guard is not a blanket ban)", () => {
    // The merch BOGO depends on this: targetCategories includes "merch", so
    // catMatch is true and the guard lets it through.
    const rule = {
      id: "r1",
      storewide: false,
      targetCategories: ["merch"],
      targetBrands: [],
      targetProductKeys: [],
      excludeCategories: [],
      excludeBrands: [],
      excludeProductKeys: [],
    } as unknown as Parameters<typeof ruleMatchesLine>[0];
    const merchLine = {
      lineId: "m",
      regularPriceMinorUnits: 2000,
      quantity: 1,
      categories: ["merch"],
      brand: "Lifted",
      productKey: "m",
      variantLabel: null,
      costMinorUnits: null,
    } as unknown as Parameters<typeof ruleMatchesLine>[1];
    expect(ruleMatchesLine(rule, merchLine)).toBe(true);

    // ...but a BRAND-only cannabis rule does NOT sweep the same merch in.
    const brandRule = {
      ...(rule as object),
      targetCategories: ["flower"],
      targetBrands: ["Lifted"],
    } as unknown as Parameters<typeof ruleMatchesLine>[0];
    expect(ruleMatchesLine(brandRule, merchLine)).toBe(false);
  });
});
