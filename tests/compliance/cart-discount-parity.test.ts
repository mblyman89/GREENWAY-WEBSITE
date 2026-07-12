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

  it("Doobie Tuesday: 20% off OR 4-for-3 — the SMALLER savings wins (store-advantaged)", () => {
    // qty 1: only the flat 20% option can qualify.
    const one = computeCartDiscounts([line({ lineId: "p", category: "preroll", regularPriceMinorUnits: 1000 })], "tuesday");
    expect(one.lines[0].appliedPercent).toBe(20);
    expect(one.lines[0].unitPriceMinorUnits).toBe(800);

    // 4 similar-priced units: flat 20% saves LESS than 4-for-3 → flat wins.
    // Flat: 20% of $44.00 = $8.80. Bundle: cheapest unit $10 → 22% spread ≈ $9.68.
    const four = computeCartDiscounts(
      [
        line({ lineId: "p1", category: "preroll", regularPriceMinorUnits: 1000, quantity: 2 }),
        line({ lineId: "p2", category: "infused-preroll", regularPriceMinorUnits: 1200, quantity: 2 }),
      ],
      "tuesday",
    );
    expect(four.lines.every((l) => l.appliedPercent === 20)).toBe(true);
    expect(four.totalSavingsMinorUnits).toBe(880);

    // Skewed basket (3×$20 + 1×$2): bundle target = cheapest unit $2 → 3% spread
    // (floor) saves far less than flat 20% → the 4-for-3 spread wins.
    const skew = computeCartDiscounts(
      [
        line({ lineId: "big", category: "preroll", regularPriceMinorUnits: 2000, quantity: 3 }),
        line({ lineId: "small", category: "blunt", regularPriceMinorUnits: 200, quantity: 1 }),
      ],
      "tuesday",
    );
    expect(skew.lines.every((l) => l.appliedPercent === 3)).toBe(true);
    expect(skew.lines[0].appliedLabel).toContain("4 for 3");
    // Store-advantaged: spread savings (≤ $2.00 target) instead of $12.40 flat.
    expect(skew.totalSavingsMinorUnits).toBeLessThan(200);
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

  it("Wax Wednesday: spend tiers ($50=15%, $100=20%, $150=30%)", () => {
    const at = (spendMinor: number) =>
      computeCartDiscounts(
        [line({ lineId: "c", category: "concentrate", regularPriceMinorUnits: spendMinor })],
        "wednesday",
      ).lines[0].appliedPercent;
    expect(at(4999)).toBe(0);
    expect(at(5000)).toBe(15);
    expect(at(10000)).toBe(20);
    expect(at(15000)).toBe(30);
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

  it("Super Saturday: 30% on the top unit, 15% on the rest; blended when qty>1", () => {
    const r = computeCartDiscounts(
      [
        line({ lineId: "top", regularPriceMinorUnits: 5000 }),
        line({ lineId: "rest", regularPriceMinorUnits: 1000 }),
      ],
      "saturday",
    );
    expect(r.lines.find((l) => l.lineId === "top")!.unitPriceMinorUnits).toBe(3500); // 30% off
    expect(r.lines.find((l) => l.lineId === "rest")!.unitPriceMinorUnits).toBe(850); // 15% off
    // Blended: qty 2 top line = one unit at 30%, one at 15%, averaged per-unit.
    const blended = computeCartDiscounts(
      [line({ lineId: "top", regularPriceMinorUnits: 5000, quantity: 2 })],
      "saturday",
    );
    const expected = Math.round((Math.round(5000 * 0.7) + Math.round(5000 * 0.85)) / 2);
    expect(blended.lines[0].unitPriceMinorUnits).toBe(expected);
  });
});

describe("Ice Cream Sunday — COMPLIANT 3-for-2 equivalent (never a free unit)", () => {
  it("3 identical units: total ≈ price of 2, every unit stays positive", () => {
    const r = computeCartDiscounts(
      [line({ lineId: "s", regularPriceMinorUnits: 1000, quantity: 3 })],
      "sunday",
    );
    const l = r.lines[0];
    // 33% (floor of 1000/3000 × 100) off each unit — same total as paying for 2.
    expect(l.appliedPercent).toBe(33);
    expect(l.unitPriceMinorUnits).toBe(670);
    expect(l.unitPriceMinorUnits).toBeGreaterThan(0);
    expect(r.totalDiscountedMinorUnits).toBe(2010); // ≈ 2000, spread not free
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
