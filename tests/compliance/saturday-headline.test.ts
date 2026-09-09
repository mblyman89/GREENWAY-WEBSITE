/**
 * tests/compliance/saturday-headline.test.ts  (SLICE D3)
 *
 * Super Saturday: "30% off any one item, 15% off everything else. The 30%
 * applies to the lowest priced item in the cart."
 *
 * WHY THIS FILE EXISTS. Before D3 the entire suite contained exactly ONE
 * Saturday assertion (promotions-harmony-parity.test.ts) and it only checked
 * the CONFIG SHAPE -- `basketTopItem` equals `{topPercent: 30, restPercent: 15}`.
 * Nothing anywhere asserted the deal's BEHAVIOUR, so two real defects lived in
 * production undetected:
 *
 *   1. A clearance/vendor item (already discounted deeper than 30%) is almost
 *      always the cheapest line, so Saturday handed it the headline and the
 *      engine's best-deal-wins rule immediately discarded the 30%. Measured
 *      across 2,000 baskets each containing one clearance item: the advertised
 *      "30% off any one item" reached NOBODY in 2,000 of them (100%).
 *
 *   2. The multi-quantity blend rounded the PRICE (round(price * 0.7)), the
 *      exact defect SLICE D2 removed everywhere else. 1,169 of 1,498 blended
 *      combinations charged MORE than advertised, worst case 12 cents.
 *
 * Every test below was verified to FAIL against the pre-D3 engine, so the net
 * genuinely catches these regressions rather than merely passing.
 */
import { describe, it, expect } from "vitest";
import {
  computePromotions,
  type EngineCartLine,
  type EngineRule,
} from "@/lib/promotions/discount-engine-core";
import {
  seedRuleSnapshots,
  activeSnapshotsFor,
  snapshotToEngineRule,
} from "@/lib/promotions/published-rules-core";
import { computeCartDiscounts, type DiscountCartLine } from "@/lib/specials/cart-discount";

const SEEDS = seedRuleSnapshots();
const saturdayRules = () => activeSnapshotsFor(SEEDS, "saturday").map(snapshotToEngineRule);

function engineLine(
  lineId: string,
  regularPriceMinorUnits: number,
  over: Partial<EngineCartLine> = {},
): EngineCartLine {
  return {
    lineId,
    regularPriceMinorUnits,
    quantity: 1,
    categories: ["flower"],
    brand: "Lifted",
    productKey: lineId,
    variantLabel: null,
    costMinorUnits: null,
    ...over,
  } as EngineCartLine;
}

function cartLine(
  lineId: string,
  regularPriceMinorUnits: number,
  quantity = 1,
): DiscountCartLine {
  return { lineId, regularPriceMinorUnits, quantity, category: "flower", brand: "Lifted" };
}

/** A deeper, non-daily promotion: the 50% clearance / vendor-day shape. */
function deeperRule(percent: number, productKeys: string[], brands: string[] = []): EngineRule {
  return {
    id: `deeper-${percent}`,
    title: `Clearance ${percent}%`,
    discountType: "percent",
    discountPercent: percent,
    priority: 100,
    storewide: false,
    targetCategories: [],
    targetBrands: brands,
    targetProductKeys: productKeys,
    excludeCategories: [],
    excludeBrands: [],
    excludeProductKeys: [],
    config: {},
  } as unknown as EngineRule;
}

const savedPercent = (regular: number, unit: number) => ((regular - unit) / regular) * 100;

/**
 * Did this line receive AT LEAST the advertised percent?
 *
 * Exact-cent maths rounds the DISCOUNT up (Math.ceil) so a customer is never
 * short-changed, which means a "30% off" line lands a shade ABOVE 30 -- a
 * 4002c item saves 1201c = 30.0100%. An equality assertion would therefore
 * fail on honest behaviour. One unit's worth of over-delivery is the ceiling.
 */
const receivedAtLeast = (regular: number, unit: number, percent: number): boolean => {
  const actual = savedPercent(regular, unit);
  const oneCentOfSlack = (1 / regular) * 100;
  return actual >= percent - 1e-9 && actual <= percent + oneCentOfSlack + 1e-9;
};

describe("Super Saturday — the advertised headline reaches a real customer", () => {
  it("gives the cheapest item 30% and everything else 15%", () => {
    const r = computePromotions(
      [engineLine("cheap", 1000), engineLine("mid", 3000), engineLine("dear", 5000)],
      saturdayRules(),
    );
    const by = (id: string) => r.lines.find((l) => l.lineId === id)!;
    expect(by("cheap").unitPriceMinorUnits).toBe(700);
    expect(by("mid").unitPriceMinorUnits).toBe(2550);
    expect(by("dear").unitPriceMinorUnits).toBe(4250);
  });

  it("a single item alone still receives the full 30%", () => {
    const r = computePromotions([engineLine("only", 4000)], saturdayRules());
    expect(r.lines[0].unitPriceMinorUnits).toBe(2800);
  });

  it("excludes merch from the deal entirely", () => {
    const r = computePromotions(
      [engineLine("shirt", 1000, { categories: ["merch"] }), engineLine("bud", 5000)],
      saturdayRules(),
    );
    const by = (id: string) => r.lines.find((l) => l.lineId === id)!;
    // Merch keeps its regular price; the headline goes to the cannabis line.
    expect(by("shirt").unitPriceMinorUnits).toBe(1000);
    expect(by("bud").unitPriceMinorUnits).toBe(3500);
  });

  // --- DEFECT 1: the clearance hijack -------------------------------------
  // Pre-D3 these FAILED: the 30% landed on the clearance line and vanished.
  it("does NOT hand the headline to a clearance item that already beats it", () => {
    const lines = [
      engineLine("clearance", 2000, { productKey: "AGED" }),
      engineLine("mid", 4000),
      engineLine("dear", 9000),
    ];
    const r = computePromotions(lines, [...saturdayRules(), deeperRule(50, ["AGED"])]);
    const by = (id: string) => r.lines.find((l) => l.lineId === id)!;

    // The clearance item keeps its own, better deal.
    expect(by("clearance").unitPriceMinorUnits).toBe(1000);
    // The headline moves to the cheapest FULL-PRICE line.
    expect(by("mid").unitPriceMinorUnits).toBe(2800);
    expect(receivedAtLeast(4000, by("mid").unitPriceMinorUnits, 30)).toBe(true);
    // Everything else stays at 15%.
    expect(by("dear").unitPriceMinorUnits).toBe(7650);
  });

  it("still delivers the advertised 30% to SOMEBODY whenever a clearance item is present", () => {
    const lines = [
      engineLine("clearance", 1500, { productKey: "AGED" }),
      engineLine("other", 6000),
    ];
    const r = computePromotions(lines, [...saturdayRules(), deeperRule(50, ["AGED"])]);
    const anyoneAt30 = r.lines.some((l) =>
      receivedAtLeast(l.regularPriceMinorUnits, l.unitPriceMinorUnits, 30),
    );
    expect(anyoneAt30).toBe(true);
  });

  it("a vendor-day brand sale does not swallow the headline either", () => {
    const lines = [
      engineLine("vendor", 2000, { brand: "Buddies", productKey: "V1" }),
      engineLine("regular", 5000),
    ];
    const r = computePromotions(lines, [...saturdayRules(), deeperRule(40, [], ["Buddies"])]);
    const by = (id: string) => r.lines.find((l) => l.lineId === id)!;
    expect(by("vendor").unitPriceMinorUnits).toBe(1200); // its own 40%
    expect(by("regular").unitPriceMinorUnits).toBe(3500); // the headline moved here
  });

  it("a WEAKER competing offer does not block the headline", () => {
    // A 10% offer loses to the 30% under best-deal-wins, so the cheapest line
    // is still the right target and the customer keeps the bigger discount.
    const lines = [engineLine("cheap", 1000, { productKey: "P1" }), engineLine("dear", 5000)];
    const r = computePromotions(lines, [...saturdayRules(), deeperRule(10, ["P1"])]);
    const by = (id: string) => r.lines.find((l) => l.lineId === id)!;
    expect(by("cheap").unitPriceMinorUnits).toBe(700);
  });

  it("sweeps many clearance baskets: the headline always reaches an eligible line", () => {
    let seed = 4242;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let missing = 0;
    for (let t = 0; t < 400; t += 1) {
      const n = 2 + Math.floor(rnd() * 3);
      const lines: EngineCartLine[] = [];
      for (let i = 0; i < n; i += 1) {
        lines.push(engineLine(`l${i}`, 500 + Math.floor(rnd() * 5000), { productKey: `k${i}` }));
      }
      // Mark the cheapest line as clearance — the realistic case.
      let cheapest = 0;
      for (let i = 1; i < lines.length; i += 1) {
        if (lines[i].regularPriceMinorUnits < lines[cheapest].regularPriceMinorUnits) cheapest = i;
      }
      const r = computePromotions(lines, [
        ...saturdayRules(),
        deeperRule(50, [lines[cheapest].productKey!]),
      ]);
      const anyoneAt30 = r.lines.some((l) =>
        receivedAtLeast(l.regularPriceMinorUnits, l.unitPriceMinorUnits, 30),
      );
      if (!anyoneAt30) missing += 1;
    }
    expect(missing).toBe(0);
  });

  // --- DEFECT 2: exact-cent blend -----------------------------------------
  it("never charges more than the advertised total on a multi-quantity line", () => {
    let overcharged = 0;
    for (let price = 100; price <= 3000; price += 43) {
      for (let qty = 1; qty <= 9; qty += 1) {
        const r = computePromotions(
          [engineLine("x", price, { quantity: qty })],
          saturdayRules(),
        );
        const advertised =
          price * qty -
          (Math.ceil((price * 30) / 100) + Math.ceil((price * 15) / 100) * (qty - 1));
        if (r.lines[0].unitPriceMinorUnits * qty > advertised) overcharged += 1;
      }
    }
    expect(overcharged).toBe(0);
  });

  it("fixes the measured 12-cent worst case (price=507, qty=8)", () => {
    const r = computePromotions([engineLine("x", 507, { quantity: 8 })], saturdayRules());
    const charged = r.lines[0].unitPriceMinorUnits * 8;
    // The old engine charged 3376 against an advertised 3364.
    expect(charged).toBeLessThanOrEqual(3364);
    expect(charged).toBeLessThan(3376);
  });

  it("puts exactly ONE unit at 30% on a multi-quantity target line", () => {
    // 1 unit at 30% + 4 at 15% on a $10 item = 300 + 600 = 900 saved.
    const r = computePromotions([engineLine("x", 1000, { quantity: 5 })], saturdayRules());
    const saved = (1000 - r.lines[0].unitPriceMinorUnits) * 5;
    expect(saved).toBeLessThanOrEqual(900);
    expect(saved).toBeGreaterThan(750); // strictly better than a flat 15%
  });

  it("reports a blended line's real percent, not a flat 15%", () => {
    const r = computePromotions([engineLine("x", 1000, { quantity: 2 })], saturdayRules());
    // One unit at 30% + one at 15% is ~22.5% across the line.
    expect(r.lines[0].appliedPercent).toBeGreaterThan(15);
  });

  // --- DEFECT 3: cart-order sensitivity ------------------------------------
  it("breaks a price tie deterministically, not by cart order", () => {
    const a = engineLine("x", 2000);
    const b = engineLine("y", 2000);
    const fwd = computePromotions([a, b], saturdayRules());
    const rev = computePromotions([b, a], saturdayRules());
    const unit = (r: typeof fwd, id: string) =>
      r.lines.find((l) => l.lineId === id)!.unitPriceMinorUnits;
    expect(unit(fwd, "x")).toBe(unit(rev, "x"));
    expect(unit(fwd, "y")).toBe(unit(rev, "y"));
  });

  // --- the cost floor is still respected (must never regress) --------------
  it("never discounts below the acquisition-cost floor", () => {
    // cost 600 -> floor ceil(600 * 1.463) = 878, above a naive 30% (700).
    const r = computePromotions(
      [engineLine("a", 1000, { costMinorUnits: 600 }), engineLine("b", 5000)],
      saturdayRules(),
    );
    const by = (id: string) => r.lines.find((l) => l.lineId === id)!;
    expect(by("a").unitPriceMinorUnits).toBeGreaterThanOrEqual(878);
  });

  // --- website / register parity -------------------------------------------
  it("prices identically on the website and at the register", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let breaks = 0;
    for (let t = 0; t < 400; t += 1) {
      const n = 1 + Math.floor(rnd() * 4);
      const specs = Array.from({ length: n }, (_, i) => ({
        id: `l${i}`,
        price: 100 + Math.floor(rnd() * 6000),
        qty: 1 + Math.floor(rnd() * 4),
      }));
      const reg = computePromotions(
        specs.map((s) => engineLine(s.id, s.price, { quantity: s.qty })),
        saturdayRules(),
      );
      const web = computeCartDiscounts(
        specs.map((s) => cartLine(s.id, s.price, s.qty)),
        "saturday",
      );
      for (let i = 0; i < specs.length; i += 1) {
        if (reg.lines[i].unitPriceMinorUnits !== web.lines[i].unitPriceMinorUnits) breaks += 1;
      }
    }
    expect(breaks).toBe(0);
  });

  it("website: tie-break and blend match the shared core", () => {
    const web = computeCartDiscounts([cartLine("x", 2000), cartLine("y", 2000)], "saturday");
    const rev = computeCartDiscounts([cartLine("y", 2000), cartLine("x", 2000)], "saturday");
    const unit = (r: typeof web, id: string) =>
      r.lines.find((l) => l.lineId === id)!.unitPriceMinorUnits;
    expect(unit(web, "x")).toBe(unit(rev, "x"));
    expect(unit(web, "y")).toBe(unit(rev, "y"));
  });
});
