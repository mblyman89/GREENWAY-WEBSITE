/**
 * tests/compliance/markdown-lock.test.ts  (SLICE C1)
 *
 * Clearance / vendor-day markdowns, proven THROUGH THE REAL ENGINE rather than
 * against the lock module in isolation. The lock decides; computePromotions is
 * what actually charges the customer, so that is what is asserted here.
 *
 * Owner's rule, verbatim: clearance and vendor-day items are "excluded from any
 * and all other sales/ daily deals", and "the general rule is, discounts don't
 * stack".
 *
 * Every number below was measured against the engine before being written down.
 */
import { describe, it, expect } from "vitest";
import {
  computePromotions,
  type EngineRule,
  type EngineCartLine,
} from "@/lib/promotions/discount-engine-core";
import { __runMarkdownLockTests } from "@/lib/promotions/markdown-lock-core";
import { parseEngineConfig } from "@/lib/promotions/published-rules-core";

const rule = (o: Partial<EngineRule>): EngineRule => ({
  id: "r",
  title: "r",
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
  ...o,
});

const markdown = (o: Partial<EngineRule>): EngineRule =>
  rule({ ...o, config: { ...(o.config ?? {}), markdownOnly: true } });

const line = (o: Partial<EngineCartLine>): EngineCartLine => ({
  lineId: "l",
  regularPriceMinorUnits: 4000,
  quantity: 1,
  categories: ["flower"],
  brand: "Lifted",
  productKey: "KEY",
  variantLabel: "3.5g",
  costMinorUnits: null,
  ...o,
});

/** The line the store has marked down, and an ordinary line beside it. */
const cleared = line({ lineId: "clr1", productKey: "KEY" });
const normal = line({ lineId: "norm", productKey: "OTHER" });

const monday = rule({
  id: "mon",
  title: "Munchie Monday",
  discountPercent: 25,
  targetCategories: ["flower"],
  priority: 10,
});

const find = (r: ReturnType<typeof computePromotions>, id: string) =>
  r.lines.find((l) => l.lineId === id)!;

describe("SLICE C1: clearance markdowns are excluded from all other deals", () => {
  it("runs the lock module's own self-tests", () => {
    const r = __runMarkdownLockTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });

  it("DEFECT D (fixed): a markdown SHALLOWER than the day's deal still applies", () => {
    // Measured BEFORE this slice: charged 3000 with the label "Munchie Monday
    // - 25% off". The 10% clearance -- the reason the item is on the shelf at
    // that price at all -- was silently discarded because 25% saved more.
    const clearance = markdown({
      id: "clr",
      title: "Clearance 10%",
      discountPercent: 10,
      targetProductKeys: ["KEY"],
      priority: 1,
    });
    const r = computePromotions([cleared], [clearance, monday]);
    const l = find(r, "clr1");
    expect(l.unitPriceMinorUnits).toBe(3600);
    expect(l.appliedPercent).toBe(10);
    expect(l.appliedLabel).toBe("Clearance 10% · 10% off");
    expect(l.appliedRuleId).toBe("clr");
  });

  it("DEFECT E (unchanged on purpose): never-discount still outranks a markdown", () => {
    // never-discount means "no promotion, ever" and is a STRONGER statement
    // than "put it on clearance". It must keep winning, and it must keep
    // charging full price.
    const clearance = markdown({
      id: "clr",
      title: "Clearance 50%",
      discountPercent: 50,
      targetProductKeys: ["KEY"],
      priority: 1,
    });
    const r = computePromotions([cleared, normal], [clearance, monday], ["KEY"]);
    const l = find(r, "clr1");
    expect(l.unitPriceMinorUnits).toBe(4000);
    expect(l.appliedPercent).toBe(0);
    expect(l.appliedLabel).toBeUndefined();
    // ...and the protection is surgical: the other line keeps Monday.
    expect(find(r, "norm").appliedPercent).toBe(25);
  });

  it("a deeper markdown keeps behaving as it always did", () => {
    const clearance = markdown({
      id: "clr",
      title: "Clearance 50%",
      discountPercent: 50,
      targetProductKeys: ["KEY"],
      priority: 1,
    });
    const r = computePromotions([cleared, normal], [clearance, monday]);
    expect(find(r, "clr1").unitPriceMinorUnits).toBe(2000);
    expect(find(r, "clr1").appliedLabel).toBe("Clearance 50% · 50% off");
  });

  it("a markdown never freezes the day's deal for OTHER customers' items", () => {
    const clearance = markdown({
      id: "clr",
      title: "Clearance 50%",
      discountPercent: 50,
      targetProductKeys: ["KEY"],
      priority: 1,
    });
    const r = computePromotions([cleared, normal], [clearance, monday]);
    expect(find(r, "norm").appliedPercent).toBe(25);
    expect(find(r, "norm").appliedLabel).toBe("Munchie Monday · 25% off");
  });

  it("between TWO markdowns the deeper one wins (still exactly one deal)", () => {
    const clearance = markdown({
      id: "clr",
      title: "Clearance 50%",
      discountPercent: 50,
      targetProductKeys: ["KEY"],
      priority: 1,
    });
    const vendorDay = markdown({
      id: "ven",
      title: "Vendor Day 40%",
      discountPercent: 40,
      targetBrands: ["Lifted"],
      priority: 5,
    });
    const r = computePromotions([cleared], [clearance, vendorDay]);
    const l = find(r, "clr1");
    expect(l.unitPriceMinorUnits).toBe(2000);
    expect(l.appliedRuleId).toBe("clr");
    // No stacking: 50% and 40% never compound to 70%.
    expect(l.appliedPercent).toBe(50);
  });

  it("order of the two markdowns does not change the outcome", () => {
    const deep = markdown({
      id: "deep",
      title: "Clearance 50%",
      discountPercent: 50,
      targetProductKeys: ["KEY"],
      priority: 1,
    });
    const shallow = markdown({
      id: "shallow",
      title: "Vendor Day 40%",
      discountPercent: 40,
      targetProductKeys: ["KEY"],
      priority: 1,
    });
    const a = find(computePromotions([cleared], [deep, shallow]), "clr1");
    const b = find(computePromotions([cleared], [shallow, deep]), "clr1");
    expect(a.unitPriceMinorUnits).toBe(b.unitPriceMinorUnits);
    expect(a.unitPriceMinorUnits).toBe(2000);
  });

  it("a markdown honours its OWN exclusions", () => {
    // An item the clearance sweep explicitly excludes is not locked, so it is
    // still free to take the day's deal.
    const sweep = markdown({
      id: "clr",
      title: "Clearance 50%",
      discountPercent: 50,
      targetCategories: ["flower"],
      excludeProductKeys: ["KEY"],
      priority: 1,
    });
    const r = computePromotions([cleared], [sweep, monday]);
    const l = find(r, "clr1");
    expect(l.appliedPercent).toBe(25);
    expect(l.appliedLabel).toBe("Munchie Monday · 25% off");
  });

  it("an empty clearance sweep does not freeze anything", () => {
    const sweep = markdown({
      id: "clr",
      title: "Clearance",
      discountPercent: 50,
      targetProductKeys: ["NOTHING-MATCHES"],
      priority: 1,
    });
    const r = computePromotions([cleared, normal], [sweep, monday]);
    expect(find(r, "clr1").appliedPercent).toBe(25);
    expect(find(r, "norm").appliedPercent).toBe(25);
  });

  it("a clearance line does not absorb a Saturday basket spread", () => {
    // Super Saturday spreads "30% off one item + 15% off the rest" across the
    // eligible basket. A locked line must be OUT of that basket entirely,
    // otherwise it soaks up savings it can never receive.
    const saturday = rule({
      id: "sat",
      title: "Super Saturday",
      discountType: "basket",
      storewide: true,
      priority: 10,
      config: { basketTopItem: { topPercent: 30, restPercent: 15 } },
    });
    const clearance = markdown({
      id: "clr",
      title: "Clearance 50%",
      discountPercent: 50,
      targetProductKeys: ["KEY"],
      priority: 1,
    });
    const other = line({ lineId: "o2", productKey: "O2" });
    const withMarkdown = computePromotions([cleared, normal, other], [saturday, clearance]);
    // The clearance line keeps its markdown...
    expect(find(withMarkdown, "clr1").appliedRuleId).toBe("clr");
    expect(find(withMarkdown, "clr1").unitPriceMinorUnits).toBe(2000);
    // ...and the two remaining lines are discounted as a two-item Saturday
    // basket, identical to a cart that never contained the clearance item.
    const without = computePromotions([normal, other], [saturday]);
    expect(find(withMarkdown, "norm").unitPriceMinorUnits).toBe(
      find(without, "norm").unitPriceMinorUnits,
    );
    expect(find(withMarkdown, "o2").unitPriceMinorUnits).toBe(
      find(without, "o2").unitPriceMinorUnits,
    );
  });

  it("carts with NO markdown are bit-for-bit unchanged", () => {
    // The regression guard for every existing promotion in the store.
    //
    // 8775 is a MEASURED value, not a hand-derived one: it was read out of the
    // engine as it stands on origin/main (scripts/probe-c1-parity.ts diffed the
    // pre-slice engine against this one across 40 cart/rule/never-discount
    // combinations covering Monday, Thursday, Saturday, Sunday and a Monday +
    // Saturday overlap, and found ZERO differences). An earlier draft of this
    // test asserted a number I had worked out in my head instead; it was wrong,
    // and this assertion is the reason that was caught.
    const saturday = rule({
      id: "sat",
      title: "Super Saturday",
      discountType: "basket",
      storewide: true,
      priority: 10,
      config: { basketTopItem: { topPercent: 30, restPercent: 15 } },
    });
    const lines = [
      cleared,
      normal,
      line({ lineId: "x", regularPriceMinorUnits: 1234, quantity: 3, productKey: "X" }),
    ];
    const r = computePromotions(lines, [saturday, monday]);
    expect(r.totalDiscountedMinorUnits).toBe(8775);
    expect(r.lines.every((l) => l.appliedRuleId != null)).toBe(true);
  });

  it("the markdown flag survives the jsonb config parser, strictly", () => {
    expect(parseEngineConfig({ markdownOnly: true }).markdownOnly).toBe(true);
    // A stray truthy value must NOT lock a product out of every daily deal.
    expect(parseEngineConfig({ markdownOnly: "true" }).markdownOnly).toBeUndefined();
    expect(parseEngineConfig({ markdownOnly: 1 }).markdownOnly).toBeUndefined();
    expect(parseEngineConfig({ markdownOnly: false }).markdownOnly).toBeUndefined();
    expect(parseEngineConfig({}).markdownOnly).toBeUndefined();
    expect(parseEngineConfig(null).markdownOnly).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // The five tests below were added AFTER the C1 mutation harness
  // (scripts/compliance/mutate-c1.py) scored 22/27 on its first run. Each one
  // closes a specific survivor, and each asserts a witness scenario that was
  // MEASURED against the mutated engine (scripts/probe-c1-mutants*.py) rather
  // than reasoned about. Without them a careless edit could revert the slice
  // and the suite would still have gone green.
  // -------------------------------------------------------------------------

  it("a markdown line does not inflate an AGGREGATE rule's tier for the rest of the cart", () => {
    // KILLS survivor "wiring: basket pre-pass ignores the lock".
    //
    // Why the earlier tests missed it: every one of them used FLAT-PERCENT day
    // deals, and a flat percent is computed per line -- removing the locked
    // line from its input cannot change what the other lines get. The lock is
    // only observable through a rule whose percent depends on the WHOLE
    // eligible basket. If a $100 clearance item is left in the spend total, a
    // $52 cart tiers as though it were $152 and the store hands out a discount
    // the real basket never earned.
    //
    // Measured witness (probe-c1-mutants2/s2b): rest=$52.00, clearance=$100.00.
    const spendTiers = [
      { at: 5000, percent: 20 },
      { at: 15000, percent: 30 },
    ];
    const clearance = markdown({
      id: "clr",
      title: "Clearance 50%",
      discountPercent: 50,
      targetProductKeys: ["CLR"],
      priority: 1,
    });
    const spend = rule({
      id: "spend",
      title: "Spend",
      discountType: "threshold_spend",
      storewide: true,
      priority: 8,
      config: { spendTiers },
    });
    const saturday = rule({
      id: "sat",
      title: "Saturday",
      discountType: "basket",
      storewide: true,
      priority: 5,
      config: { basketTopItem: { topPercent: 30, restPercent: 15 } },
    });
    const lines = [
      line({ lineId: "clr", productKey: "CLR", regularPriceMinorUnits: 10000 }),
      line({ lineId: "a", productKey: "A", regularPriceMinorUnits: 2600 }),
      line({ lineId: "b", productKey: "B", regularPriceMinorUnits: 2600 }),
    ];
    const r = computePromotions(lines, [clearance, spend, saturday]);
    // The clearance line keeps its markdown.
    expect(find(r, "clr").unitPriceMinorUnits).toBe(5000);
    expect(find(r, "clr").appliedRuleId).toBe("clr");
    // The rest of the cart is a $52.00 basket, so the spend rule gives 20% --
    // and the Saturday headline is still available to the cheapest line,
    // because 20% does not beat 30%. With the pre-pass reading the UNFILTERED
    // cart the headline was measured away and 'a' fell to 20%.
    expect(find(r, "a").appliedPercent).toBe(30);
    expect(find(r, "a").appliedLabel).toBe("Saturday · 30% off");
    expect(find(r, "b").appliedPercent).toBe(20);
    // Ties break on lineId, so the outcome does not depend on cart order.
    const shuffled = computePromotions([lines[2], lines[0], lines[1]], [saturday, spend, clearance]);
    expect(find(shuffled, "a").appliedPercent).toBe(30);
    expect(find(shuffled, "b").appliedPercent).toBe(20);
  });

  it("an aggregate day deal tiers on the UNLOCKED basket only", () => {
    // The same mechanism seen without any basket rule, so the main loop is
    // isolated from the Saturday pre-pass. A $48.00 real basket must NOT reach
    // the $50 tier just because a $100 clearance item is in the same cart.
    const spendTiers = [{ at: 5000, percent: 20 }];
    const clearance = markdown({
      id: "clr",
      title: "Clearance 50%",
      discountPercent: 50,
      targetProductKeys: ["CLR"],
      priority: 1,
    });
    const spend = rule({
      id: "spend",
      title: "Spend",
      discountType: "threshold_spend",
      storewide: true,
      priority: 8,
      config: { spendTiers },
    });
    const r = computePromotions(
      [
        line({ lineId: "clr", productKey: "CLR", regularPriceMinorUnits: 10000 }),
        line({ lineId: "a", productKey: "A", regularPriceMinorUnits: 2400 }),
        line({ lineId: "b", productKey: "B", regularPriceMinorUnits: 2400 }),
      ],
      [clearance, spend],
    );
    expect(find(r, "clr").appliedRuleId).toBe("clr");
    // $48.00 < $50.00, so no tier is met and the other lines pay full price.
    expect(find(r, "a").appliedPercent).toBe(0);
    expect(find(r, "b").appliedPercent).toBe(0);
    // Sanity: one more dollar of REAL basket does reach the tier, proving the
    // zeros above are the lock and not a dead rule.
    const r2 = computePromotions(
      [
        line({ lineId: "clr", productKey: "CLR", regularPriceMinorUnits: 10000 }),
        line({ lineId: "a", productKey: "A", regularPriceMinorUnits: 2500 }),
        line({ lineId: "b", productKey: "B", regularPriceMinorUnits: 2500 }),
      ],
      [clearance, spend],
    );
    expect(find(r2, "a").appliedPercent).toBe(20);
  });

  it("a locked line does not lend its UNITS to a bundle deal", () => {
    // KILLS survivor "wiring: main loop ignores the lock" on the quantity
    // mechanism: an either/or bundle counts eligible UNITS, so a marked-down
    // line left in the basket can push the rest of the cart into a 4-for-3 it
    // never earned. Measured witness: clearance qty 1 + normal qty 3 charged
    // 750 (25%, "4 for 3") with the lock bypassed, versus 800 (20%) correctly.
    const clearance = markdown({
      id: "clr",
      title: "Clearance 50%",
      discountPercent: 50,
      targetProductKeys: ["CLR"],
      priority: 1,
    });
    const eitherOr = rule({
      id: "eo",
      title: "Doobie Tuesday",
      storewide: true,
      priority: 8,
      config: { eitherOr: { flatPercent: 20, bundle: { n: 4, m: 3 } } },
    });
    const r = computePromotions(
      [
        line({ lineId: "clr", productKey: "CLR", regularPriceMinorUnits: 1000, quantity: 1 }),
        line({ lineId: "norm", productKey: "N", regularPriceMinorUnits: 1000, quantity: 3 }),
      ],
      [clearance, eitherOr],
    );
    expect(find(r, "clr").unitPriceMinorUnits).toBe(500);
    // Three real units: the flat 20%, not the 4-for-3.
    expect(find(r, "norm").unitPriceMinorUnits).toBe(800);
    expect(find(r, "norm").appliedPercent).toBe(20);
    // A genuine fourth unit DOES earn the bundle, proving the rule is live.
    const r2 = computePromotions(
      [
        line({ lineId: "clr", productKey: "CLR", regularPriceMinorUnits: 1000, quantity: 1 }),
        line({ lineId: "norm", productKey: "N", regularPriceMinorUnits: 1000, quantity: 4 }),
      ],
      [clearance, eitherOr],
    );
    expect(find(r2, "norm").appliedPercent).toBe(25);
  });

  it("a markdown clamped to the cost floor still wins the line", () => {
    // KILLS survivors "wiring: markdown loses to a deeper ordinary deal" and
    // "wiring: currentIsMarkdown always true".
    //
    // The subtle case, and the reason the earlier tests could not see it. The
    // markdown exemption is normally invisible because a locked line is not
    // shown to other rules at all -- so the two guards are jointly redundant
    // in ordinary carts. They separate only when the markdown's saving is
    // clamped to ZERO by the CCRS cost floor: with the exemption removed,
    // `newSavingsPerUnit > current.unitSavingsMinorUnits` is `0 > 0` = false,
    // the markdown is dropped, and the line reports NO deal at all.
    //
    // Measured witness: price 4000, cost 3000 -> floor ceil(3000 * 1.463) =
    // 4389, which exceeds the price, so a 50% markdown saves nothing. The line
    // must still read as the clearance rule (the customer is told the truth
    // about why the price is what it is), not as an undiscounted line.
    const clearance = markdown({
      id: "clr",
      title: "Clearance 50%",
      discountPercent: 50,
      targetProductKeys: ["KEY"],
      priority: 1,
    });
    const day = rule({
      id: "day",
      title: "Day Deal",
      discountPercent: 25,
      storewide: true,
      priority: 10,
    });
    const clamped = line({ lineId: "clr1", productKey: "KEY", costMinorUnits: 3000 });
    const r = computePromotions([clamped], [clearance, day]);
    const l = find(r, "clr1");
    expect(Math.ceil(3000 * 1.463)).toBeGreaterThan(4000); // the floor really binds
    expect(l.unitPriceMinorUnits).toBe(4000);
    expect(l.unitSavingsMinorUnits).toBe(0);
    expect(l.appliedRuleId).toBe("clr");
    expect(l.appliedPercent).toBe(50);
    expect(l.appliedLabel).toBe("Clearance 50% · 50% off");
  });

  it("two markdowns on a cost-floored line: the deeper one is still reported", () => {
    // The companion to the test above, aimed squarely at
    // "wiring: currentIsMarkdown always true". Both markdowns clamp to a zero
    // saving, so the deeper-wins comparison cannot separate them by money;
    // only the markdown-vs-markdown branch can. Measured: the 50% is reported.
    const shallow = markdown({
      id: "m10",
      title: "Clearance 10%",
      discountPercent: 10,
      storewide: true,
      priority: 1,
    });
    const deep = markdown({
      id: "m50",
      title: "Clearance 50%",
      discountPercent: 50,
      storewide: true,
      priority: 10,
    });
    const clamped = line({ lineId: "clr1", productKey: "KEY", costMinorUnits: 3000 });
    const r = computePromotions([clamped], [shallow, deep]);
    expect(find(r, "clr1").appliedRuleId).toBe("m50");
    expect(find(r, "clr1").appliedPercent).toBe(50);
    // Order must not matter.
    const flipped = computePromotions([clamped], [deep, shallow]);
    expect(find(flipped, "clr1").appliedRuleId).toBe("m50");
  });

  it("a markdown still respects the cost floor (CCRS: never below cost)", () => {
    // A 90% clearance on an item costing $20.00 pre-tax cannot sell below the
    // tax-inclusive acquisition floor, markdown or not.
    const expensive = line({ lineId: "cost", productKey: "KEY", costMinorUnits: 2000 });
    const deep = markdown({
      id: "clr",
      title: "Clearance 90%",
      discountPercent: 90,
      targetProductKeys: ["KEY"],
      priority: 1,
    });
    const r = computePromotions([expensive], [deep]);
    const l = find(r, "cost");
    expect(l.unitPriceMinorUnits).toBe(Math.ceil(2000 * 1.463));
    expect(l.atCostFloor).toBe(true);
  });
});
