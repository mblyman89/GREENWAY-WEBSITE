/**
 * tests/compliance/cart-discount-parity.test.ts  (S-14 / GAP M-11)
 *
 * Client/server parity for the daily-deal cart engine. The SAME pure function
 * (computeCartDiscounts) runs in the browser CartProvider AND in the server
 * reprice (order-pricing.ts) — advertising integrity (WAC 314-55-155 family)
 * requires the advertised price to equal the charged price. These tests pin:
 *  1. determinism (same cart ⇒ byte-identical result, i.e. client == server),
 *  2. every weekday mechanic including the Sunday 3-for-2 EQUIVALENT,
 *  3. the global cannabis price floor inside every mechanic (RCW 69.50.357).
 */
import { describe, it, expect } from "vitest";
import {
  computeCartDiscounts,
  gramsForLabel,
  type DiscountCartLine,
} from "@/lib/specials/cart-discount";
import type { StoreWeekday } from "@/lib/specials/daily-deals";
import { MIN_CANNABIS_UNIT_PRICE_MINOR } from "@/lib/orders/order-pricing-core";

const line = (over: Partial<DiscountCartLine> & { lineId: string }): DiscountCartLine => ({
  regularPriceMinorUnits: 3500,
  quantity: 1,
  category: "flower",
  ...over,
});

const WEEKDAYS: StoreWeekday[] = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

describe("client/server parity — determinism", () => {
  it("the same cart yields a deep-equal result on repeated runs (all 7 weekdays)", () => {
    const cart: DiscountCartLine[] = [
      line({ lineId: "a", category: "flower", variantLabel: "3.5g", quantity: 2 }),
      line({ lineId: "b", category: "preroll", regularPriceMinorUnits: 800, quantity: 3 }),
      line({ lineId: "c", category: "concentrate", regularPriceMinorUnits: 4500 }),
      line({ lineId: "d", category: "edible-solid", regularPriceMinorUnits: 2500 }),
      line({ lineId: "e", category: "merch", regularPriceMinorUnits: 2000 }),
    ];
    for (const day of WEEKDAYS) {
      const clientRun = computeCartDiscounts(cart, day);
      const serverRun = computeCartDiscounts(cart, day);
      expect(serverRun).toEqual(clientRun);
    }
  });

  it("line order does not change per-line outcomes", () => {
    const cart = [
      line({ lineId: "a", regularPriceMinorUnits: 5000 }),
      line({ lineId: "b", regularPriceMinorUnits: 1000 }),
    ];
    const fwd = computeCartDiscounts(cart, "saturday");
    const rev = computeCartDiscounts([...cart].reverse(), "saturday");
    const byId = (r: typeof fwd, id: string) => r.lines.find((l) => l.lineId === id)!;
    expect(byId(rev, "a").unitPriceMinorUnits).toBe(byId(fwd, "a").unitPriceMinorUnits);
    expect(byId(rev, "b").unitPriceMinorUnits).toBe(byId(fwd, "b").unitPriceMinorUnits);
  });
});

describe("weekday mechanics", () => {
  it("Munchie Monday: 25% off eligible categories only", () => {
    const r = computeCartDiscounts(
      [
        line({ lineId: "edible", category: "edible-solid", regularPriceMinorUnits: 2000 }),
        line({ lineId: "merch", category: "merch", regularPriceMinorUnits: 2000 }),
      ],
      "monday",
    );
    const edible = r.lines.find((l) => l.lineId === "edible")!;
    expect(edible.unitPriceMinorUnits).toBe(1500);
    const merch = r.lines.find((l) => l.lineId === "merch")!;
    expect(merch.unitPriceMinorUnits).toBe(2000); // never discounted
  });

  it("Doobie Tuesday: 1–3 prerolls = 20%, 4+ = the advertised 25% (SLICE D1)", () => {
    // OWNER CORRECTION (SLICE D1): "if a discount specifically states 4 or more
    // prerolls is 25% off, then its 25% off, whether the store wants to win or
    // not." The store-wins policy is a ROUNDING rule (half-cent to the store),
    // NOT a deal-selection rule. This test previously pinned the inverted
    // behaviour ("the SMALLER savings wins"), which produced a SAWTOOTH of
    // 20,20,20,20,20,16,14,... across quantities 1..12 — measured — and paid a
    // 4-preroll basket 20% when 25% was advertised.
    // qty 1: below the 4-unit tier, so the advertised 20% applies.
    const one = computeCartDiscounts([line({ lineId: "p", category: "preroll", regularPriceMinorUnits: 1000 })], "tuesday");
    expect(one.lines[0].appliedPercent).toBe(20);
    expect(one.lines[0].unitPriceMinorUnits).toBe(800);

    // 4 units across two lines: the advertised 25% ("buy 4 for the price of 3")
    // applies to EVERY unit. $44.00 basket → exactly $11.00 off.
    const four = computeCartDiscounts(
      [
        line({ lineId: "p1", category: "preroll", regularPriceMinorUnits: 1000, quantity: 2 }),
        line({ lineId: "p2", category: "infused-preroll", regularPriceMinorUnits: 1200, quantity: 2 }),
      ],
      "tuesday",
    );
    expect(four.lines.every((l) => l.appliedPercent === 25)).toBe(true);
    expect(four.totalSavingsMinorUnits).toBe(1100); // exactly 25% of 4400
    expect(four.totalSavingsMinorUnits).toBe(Math.round(4400 * 0.25));

    // Skewed basket (3×$20 + 1×$2) still earns the advertised 25% — the old
    // code paid a 3% "spread" here (under $2.00 of savings on a $62 basket).
    const skew = computeCartDiscounts(
      [
        line({ lineId: "big", category: "preroll", regularPriceMinorUnits: 2000, quantity: 3 }),
        line({ lineId: "small", category: "blunt", regularPriceMinorUnits: 200, quantity: 1 }),
      ],
      "tuesday",
    );
    expect(skew.lines.every((l) => l.appliedPercent === 25)).toBe(true);
    expect(skew.totalSavingsMinorUnits).toBe(1550); // exactly 25% of 6200
    // Monotonic in quantity: adding prerolls never LOWERS the percent (no sawtooth).
    let prev = 0;
    for (let q = 1; q <= 12; q += 1) {
      const r = computeCartDiscounts(
        [line({ lineId: "p", category: "preroll", regularPriceMinorUnits: 1000, quantity: q })],
        "tuesday",
      );
      expect(r.lines[0].appliedPercent).toBeGreaterThanOrEqual(prev);
      prev = r.lines[0].appliedPercent;
    }
    expect(prev).toBe(25);
  });

  it("Doobie Tuesday: the CCRS cost floor clamps the 20% option", () => {
    // $10.00 preroll costing $6.00 pre-tax → floor = ceil(600 × 1.463) = 878.
    // 20% off would be 800 — below the floor — so the unit clamps to 878.
    const r = computeCartDiscounts(
      [line({ lineId: "p", category: "preroll", regularPriceMinorUnits: 1000, costMinorUnits: 600 })],
      "tuesday",
    );
    expect(r.lines[0].unitPriceMinorUnits).toBe(878);
  });

  it("Wax Wednesday: 20% off, or 30% at $150+ (SLICE D2 — exactly as advertised)", () => {
    // OWNER CORRECTION (verbatim): "the deal is 20% off or 30% off over 150
    // dollars. Not the ladder nor 20% to 25%." This test previously pinned a
    // 15/20/30 ladder at $50/$100/$150 — under which a customer buying a single
    // $40 cartridge was advertised 20% off on /specials and charged FULL PRICE.
    const at = (spendMinor: number) =>
      computeCartDiscounts(
        [line({ lineId: "c", category: "concentrate", regularPriceMinorUnits: spendMinor })],
        "wednesday",
      ).lines[0].appliedPercent;
    expect(at(1)).toBe(20); // no minimum spend — the base tier is universal
    expect(at(4000)).toBe(20); // the $40 cartridge that used to get nothing
    expect(at(4999)).toBe(20);
    expect(at(5000)).toBe(20); // the old $50 rung is GONE
    expect(at(10000)).toBe(20); // the old $100 rung is GONE
    expect(at(14999)).toBe(20);
    expect(at(15000)).toBe(30); // $150 exactly — the advertised threshold
    expect(at(20000)).toBe(30);
    // Only TWO tiers exist, so the percent is always one of 20 or 30.
    for (const spend of [1, 999, 4000, 7500, 14999, 15000, 15001, 99999]) {
      expect([20, 30]).toContain(at(spend));
    }
  });

  it("Ounce Friday: weight tiers via gramsForLabel (7g=15%, 14g=20%, 28g=30%)", () => {
    expect(gramsForLabel("1oz")).toBe(28);
    expect(gramsForLabel("3.5g")).toBe(3.5);
    const r = computeCartDiscounts(
      [line({ lineId: "f", category: "flower", variantLabel: "1oz" })],
      "friday",
    );
    expect(r.lines[0].appliedPercent).toBe(30);
    const half = computeCartDiscounts(
      [line({ lineId: "f", category: "flower", variantLabel: "14g" })],
      "friday",
    );
    expect(half.lines[0].appliedPercent).toBe(20);
  });

  it("Super Saturday (store-favorable): 30% on the LOWEST-priced unit, 15% on the rest; blended when qty>1", () => {
    // Owner directive: never award the biggest discount to the highest-priced
    // item in a multi-item cart — the 30% headline lands on the cheapest unit.
    const r = computeCartDiscounts(
      [
        line({ lineId: "pricey", regularPriceMinorUnits: 5000 }),
        line({ lineId: "cheap", regularPriceMinorUnits: 1000 }),
      ],
      "saturday",
    );
    expect(r.lines.find((l) => l.lineId === "pricey")!.unitPriceMinorUnits).toBe(4250); // 15% off
    expect(r.lines.find((l) => l.lineId === "cheap")!.unitPriceMinorUnits).toBe(700); // 30% off
    // Blended: qty 2 single line = one unit at 30%, one at 15%, averaged per-unit.
    const blended = computeCartDiscounts(
      [line({ lineId: "only", regularPriceMinorUnits: 5000, quantity: 2 })],
      "saturday",
    );
    const expected = Math.round((Math.round(5000 * 0.7) + Math.round(5000 * 0.85)) / 2);
    expect(blended.lines[0].unitPriceMinorUnits).toBe(expected);
  });
});

describe("Ice Cream Sunday — COMPLIANT 3-for-2 equivalent (never a free unit)", () => {
  it("3 identical units: total ≤ price of 2, every unit stays positive", () => {
    const r = computeCartDiscounts(
      [line({ lineId: "s", regularPriceMinorUnits: 1000, quantity: 3 })],
      "sunday",
    );
    const l = r.lines[0];
    // SLICE D1: the old floored percent (33% of $10 = $6.70/unit) charged
    // $20.10 for three $10 units — 10c MORE than the advertised "pay for 2".
    // Owner: "Sunday needs to be exact", and where a line's single unit price
    // cannot express the target exactly, round in the CUSTOMER's favour.
    expect(l.unitPriceMinorUnits).toBeGreaterThan(0);
    expect(r.totalDiscountedMinorUnits).toBeLessThanOrEqual(2000); // never MORE than 2 units
    expect(r.totalDiscountedMinorUnits).toBe(1998); // 2c to the customer (measured)
    expect(l.unitPriceMinorUnits).toBe(666);
    // The advertised savings are the price of one unit; we never pay less than that.
    expect(r.totalSavingsMinorUnits).toBeGreaterThanOrEqual(1000);
    // ...and the overshoot is minimal: strictly under one unit's worth of cents.
    expect(r.totalSavingsMinorUnits - 1000).toBeLessThan(3);
  });
  it("fewer than 3 eligible units ⇒ no discount", () => {
    const r = computeCartDiscounts(
      [line({ lineId: "s", regularPriceMinorUnits: 1000, quantity: 2 })],
      "sunday",
    );
    expect(r.lines[0].appliedPercent).toBe(0);
  });
  it("the percent is capped so no unit can reach $0 even with extreme price spread", () => {
    const r = computeCartDiscounts(
      [
        line({ lineId: "cheap", regularPriceMinorUnits: 1, quantity: 3 }),
        line({ lineId: "exp", regularPriceMinorUnits: 100000 }),
      ],
      "sunday",
    );
    for (const l of r.lines) {
      expect(l.unitPriceMinorUnits).toBeGreaterThanOrEqual(MIN_CANNABIS_UNIT_PRICE_MINOR);
    }
  });
});

describe("global cannabis floor inside every mechanic (RCW 69.50.357)", () => {
  it("a 1-cent cannabis item never discounts to $0 on any weekday", () => {
    for (const day of WEEKDAYS) {
      const r = computeCartDiscounts(
        [
          line({ lineId: "penny", regularPriceMinorUnits: 1, quantity: 3, variantLabel: "1oz" }),
          line({ lineId: "big", regularPriceMinorUnits: 20000, category: "concentrate" }),
        ],
        day,
      );
      for (const l of r.lines) {
        expect(l.unitPriceMinorUnits, `${day}/${l.lineId}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it("merch and accessories are excluded from every daily deal", () => {
    for (const day of WEEKDAYS) {
      const r = computeCartDiscounts(
        [
          line({ lineId: "m", category: "merch", regularPriceMinorUnits: 2000, quantity: 3 }),
          line({ lineId: "a", category: "accessories", regularPriceMinorUnits: 1500, quantity: 3 }),
        ],
        day,
      );
      for (const l of r.lines) {
        expect(l.appliedPercent, `${day}/${l.lineId}`).toBe(0);
        expect(l.unitPriceMinorUnits).toBe(l.regularPriceMinorUnits);
      }
    }
  });
});

describe("cart totals", () => {
  it("totals reconcile: regular − discounted = savings", () => {
    const r = computeCartDiscounts(
      [
        line({ lineId: "a", regularPriceMinorUnits: 5000 }),
        line({ lineId: "b", regularPriceMinorUnits: 1000, quantity: 2 }),
      ],
      "saturday",
    );
    expect(r.totalRegularMinorUnits).toBe(7000);
    expect(r.totalRegularMinorUnits - r.totalDiscountedMinorUnits).toBe(r.totalSavingsMinorUnits);
  });
});
