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
import { describe, it, expect } from "vitest";
import {
  computePromotions,
  type EngineCartLine,
  type EngineRule,
} from "@/lib/promotions/discount-engine-core";
import {
  apportionBundleSavings,
  bundleTargetMinorUnits,
} from "@/lib/promotions/bundle-apportionment-core";
import { computeCartDiscounts } from "@/lib/specials/cart-discount";
import { seedConfigFor } from "@/lib/promotions/published-rules-core";
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
