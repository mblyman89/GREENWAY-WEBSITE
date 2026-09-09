#!/usr/bin/env python3
"""
apply-d2-stale-tests.py  (SLICE D2, part 8)

Corrects the legacy suites that PIN THE OLD BUGS. Every replacement number in
here was MEASURED with scripts/compliance/probe-stale*.ts against the new code
-- none is predicted. Each edit records what the old assertion asserted and why
the new value is the advertised, honest one.

The three defects these tests were protecting:
  1. Doobie Tuesday "the SMALLER savings wins" -- the store-wins ROUNDING rule
     had been promoted into a DEAL-SELECTION rule, so a 4-preroll basket got
     20% (or a 3% sawtooth) instead of the advertised 25%.
  2. Wax Wednesday's 15/20/30 ladder at $50/$100/$150 -- /specials advertises
     "20% off, 30% at $150+", so a $40 cartridge was promised 20% and charged
     full price.
  3. Ice Cream Sunday's floored percent -- 33% off three $10 units pays $20.10,
     which is 10c MORE than "buy 3, pay for 2" advertises.
"""

import sys

EDITS: list[tuple[str, str, str, str]] = []


def edit(path: str, name: str, old: str, new: str) -> None:
    EDITS.append((path, name, old, new))


# ===========================================================================
# tests/compliance/cart-discount-parity.test.ts
# ===========================================================================
P1 = "tests/compliance/cart-discount-parity.test.ts"

edit(
    P1,
    "Doobie Tuesday: advertised percent wins",
    """  it("Doobie Tuesday: 20% off OR 4-for-3 \u2014 the SMALLER savings wins (store-advantaged)", () => {
    // qty 1: only the flat 20% option can qualify.
    const one = computeCartDiscounts([line({ lineId: "p", category: "preroll", regularPriceMinorUnits: 1000 })], "tuesday");
    expect(one.lines[0].appliedPercent).toBe(20);
    expect(one.lines[0].unitPriceMinorUnits).toBe(800);

    // 4 similar-priced units: flat 20% saves LESS than 4-for-3 \u2192 flat wins.
    // Flat: 20% of $44.00 = $8.80. Bundle: cheapest unit $10 \u2192 22% spread \u2248 $9.68.
    const four = computeCartDiscounts(
      [
        line({ lineId: "p1", category: "preroll", regularPriceMinorUnits: 1000, quantity: 2 }),
        line({ lineId: "p2", category: "infused-preroll", regularPriceMinorUnits: 1200, quantity: 2 }),
      ],
      "tuesday",
    );
    expect(four.lines.every((l) => l.appliedPercent === 20)).toBe(true);
    expect(four.totalSavingsMinorUnits).toBe(880);

    // Skewed basket (3\u00d7$20 + 1\u00d7$2): bundle target = cheapest unit $2 \u2192 3% spread
    // (floor) saves far less than flat 20% \u2192 the 4-for-3 spread wins.
    const skew = computeCartDiscounts(
      [
        line({ lineId: "big", category: "preroll", regularPriceMinorUnits: 2000, quantity: 3 }),
        line({ lineId: "small", category: "blunt", regularPriceMinorUnits: 200, quantity: 1 }),
      ],
      "tuesday",
    );
    expect(skew.lines.every((l) => l.appliedPercent === 3)).toBe(true);
    expect(skew.lines[0].appliedLabel).toContain("4 for 3");
    // Store-advantaged: spread savings (\u2264 $2.00 target) instead of $12.40 flat.
    expect(skew.totalSavingsMinorUnits).toBeLessThan(200);
  });""",
    """  it("Doobie Tuesday: 1\u20133 prerolls = 20%, 4+ = the advertised 25% (SLICE D1)", () => {
    // OWNER CORRECTION (SLICE D1): "if a discount specifically states 4 or more
    // prerolls is 25% off, then its 25% off, whether the store wants to win or
    // not." The store-wins policy is a ROUNDING rule (half-cent to the store),
    // NOT a deal-selection rule. This test previously pinned the inverted
    // behaviour ("the SMALLER savings wins"), which produced a SAWTOOTH of
    // 20,20,20,20,20,16,14,... across quantities 1..12 \u2014 measured \u2014 and paid a
    // 4-preroll basket 20% when 25% was advertised.
    // qty 1: below the 4-unit tier, so the advertised 20% applies.
    const one = computeCartDiscounts([line({ lineId: "p", category: "preroll", regularPriceMinorUnits: 1000 })], "tuesday");
    expect(one.lines[0].appliedPercent).toBe(20);
    expect(one.lines[0].unitPriceMinorUnits).toBe(800);

    // 4 units across two lines: the advertised 25% ("buy 4 for the price of 3")
    // applies to EVERY unit. $44.00 basket \u2192 exactly $11.00 off.
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

    // Skewed basket (3\u00d7$20 + 1\u00d7$2) still earns the advertised 25% \u2014 the old
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
  });""",
)

edit(
    P1,
    "Wax Wednesday: two advertised tiers",
    """  it("Wax Wednesday: spend tiers ($50=15%, $100=20%, $150=30%)", () => {
    const at = (spendMinor: number) =>
      computeCartDiscounts(
        [line({ lineId: "c", category: "concentrate", regularPriceMinorUnits: spendMinor })],
        "wednesday",
      ).lines[0].appliedPercent;
    expect(at(4999)).toBe(0);
    expect(at(5000)).toBe(15);
    expect(at(10000)).toBe(20);
    expect(at(15000)).toBe(30);
  });""",
    """  it("Wax Wednesday: 20% off, or 30% at $150+ (SLICE D2 \u2014 exactly as advertised)", () => {
    // OWNER CORRECTION (verbatim): "the deal is 20% off or 30% off over 150
    // dollars. Not the ladder nor 20% to 25%." This test previously pinned a
    // 15/20/30 ladder at $50/$100/$150 \u2014 under which a customer buying a single
    // $40 cartridge was advertised 20% off on /specials and charged FULL PRICE.
    const at = (spendMinor: number) =>
      computeCartDiscounts(
        [line({ lineId: "c", category: "concentrate", regularPriceMinorUnits: spendMinor })],
        "wednesday",
      ).lines[0].appliedPercent;
    expect(at(1)).toBe(20); // no minimum spend \u2014 the base tier is universal
    expect(at(4000)).toBe(20); // the $40 cartridge that used to get nothing
    expect(at(4999)).toBe(20);
    expect(at(5000)).toBe(20); // the old $50 rung is GONE
    expect(at(10000)).toBe(20); // the old $100 rung is GONE
    expect(at(14999)).toBe(20);
    expect(at(15000)).toBe(30); // $150 exactly \u2014 the advertised threshold
    expect(at(20000)).toBe(30);
    // Only TWO tiers exist, so the percent is always one of 20 or 30.
    for (const spend of [1, 999, 4000, 7500, 14999, 15000, 15001, 99999]) {
      expect([20, 30]).toContain(at(spend));
    }
  });""",
)

edit(
    P1,
    "Ice Cream Sunday: exact 3-for-2",
    """  it("3 identical units: total \u2248 price of 2, every unit stays positive", () => {
    const r = computeCartDiscounts(
      [line({ lineId: "s", regularPriceMinorUnits: 1000, quantity: 3 })],
      "sunday",
    );
    const l = r.lines[0];
    // 33% (floor of 1000/3000 \u00d7 100) off each unit \u2014 same total as paying for 2.
    expect(l.appliedPercent).toBe(33);
    expect(l.unitPriceMinorUnits).toBe(670);
    expect(l.unitPriceMinorUnits).toBeGreaterThan(0);
    expect(r.totalDiscountedMinorUnits).toBe(2010); // \u2248 2000, spread not free
  });""",
    """  it("3 identical units: total \u2264 price of 2, every unit stays positive", () => {
    const r = computeCartDiscounts(
      [line({ lineId: "s", regularPriceMinorUnits: 1000, quantity: 3 })],
      "sunday",
    );
    const l = r.lines[0];
    // SLICE D1: the old floored percent (33% of $10 = $6.70/unit) charged
    // $20.10 for three $10 units \u2014 10c MORE than the advertised "pay for 2".
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
  });""",
)

# ===========================================================================
# tests/compliance/promotions-harmony-parity.test.ts
# ===========================================================================
P2 = "tests/compliance/promotions-harmony-parity.test.ts"

edit(
    P2,
    "seed snapshots: tiers replace eitherOr",
    """    expect(byDay.get(2)?.config.eitherOr).toEqual({ flatPercent: 20, bundle: { n: 4, m: 3 } });
    expect(byDay.get(6)?.config.basketTopItem).toEqual({ topPercent: 30, restPercent: 15 });
    expect(byDay.get(0)?.config.basketNforM).toEqual({ n: 3, m: 2 });""",
    """    // SLICE D1/D2: Tuesday and Wednesday are now TIERED, not either/or. The
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
    expect(byDay.get(0)?.config.basketNforM).toEqual({ n: 3, m: 2 });""",
)

edit(
    P2,
    "headline + offer label copy",
    """    expect(headlinePercentFor(byDay.get(1)!)).toBe(25); // Munchie Monday
    expect(headlinePercentFor(byDay.get(2)!)).toBe(20); // Doobie (either/or flat)
    expect(headlinePercentFor(byDay.get(6)!)).toBe(30); // Saturday top item
    expect(offerLabelFor(byDay.get(2)!)).toBe("20% off \u00b7 or 4 for 3");
    expect(offerLabelFor(byDay.get(6)!)).toBe("15\u201330% off");
    expect(offerLabelFor(byDay.get(0)!)).toBe("3 for 2");""",
    """    expect(headlinePercentFor(byDay.get(1)!)).toBe(25); // Munchie Monday
    expect(headlinePercentFor(byDay.get(2)!)).toBe(20); // Doobie: authored headline
    expect(headlinePercentFor(byDay.get(3)!)).toBe(30); // Wax Wednesday best case
    expect(headlinePercentFor(byDay.get(6)!)).toBe(30); // Saturday top item
    // SLICE D1/D2: the tier ranges now render the honest span of each offer.
    expect(offerLabelFor(byDay.get(2)!)).toBe("20\u201325% off");
    expect(offerLabelFor(byDay.get(3)!)).toBe("20\u201330% off");
    expect(offerLabelFor(byDay.get(6)!)).toBe("15\u201330% off");
    expect(offerLabelFor(byDay.get(0)!)).toBe("3 for 2");""",
)

# ===========================================================================
# tests/compliance/deal-badge-core.test.ts
# ===========================================================================
P3 = "tests/compliance/deal-badge-core.test.ts"

edit(
    P3,
    "Tuesday badge copy (test file)",
    """    // The EXACT badge Michael saw on the rail card \u2014 now on every Tuesday preroll/blunt.
    expect(menuCardBadgeForItem(mk("p", { category: "preroll" }), rulesFor("tuesday"), "tuesday")).toBe(
      "Doobie Tuesday \u00b7 20% off \u00b7 or 4 for 3",
    );
    expect(
      menuCardBadgeForItem(mk("ib", { category: "infused-blunt" }), rulesFor("tuesday"), "tuesday"),
    ).toBe("Doobie Tuesday \u00b7 20% off \u00b7 or 4 for 3");""",
    """    // The badge Michael saw on the rail card \u2014 now on every Tuesday
    // preroll/blunt, and SLICE D1 spells out that "4 for 3" IS 25% so the copy
    // states the percent the register actually charges at 4+ units.
    expect(menuCardBadgeForItem(mk("p", { category: "preroll" }), rulesFor("tuesday"), "tuesday")).toBe(
      "Doobie Tuesday \u00b7 20% off \u00b7 or 4 for 3 (25%)",
    );
    expect(
      menuCardBadgeForItem(mk("ib", { category: "infused-blunt" }), rulesFor("tuesday"), "tuesday"),
    ).toBe("Doobie Tuesday \u00b7 20% off \u00b7 or 4 for 3 (25%)");""",
)

# ===========================================================================
# src/lib/promotions/deal-badge-core.ts (embedded self-test)
# ===========================================================================
P4 = "src/lib/promotions/deal-badge-core.ts"

edit(
    P4,
    "Tuesday badge self-test",
    """  ok(
    menuCardBadgeForItem(preroll, tue, "tuesday") === "Doobie Tuesday \\u00b7 20% off \\u00b7 or 4 for 3",
    "Tuesday preroll badge matches the one Michael saw",
  );
  ok(
    menuCardBadgeForItem(infusedBlunt, tue, "tuesday") === "Doobie Tuesday \\u00b7 20% off \\u00b7 or 4 for 3",
    "Tuesday infused blunt badge",
  );""",
    """  ok(
    menuCardBadgeForItem(preroll, tue, "tuesday") ===
      "Doobie Tuesday \\u00b7 20% off \\u00b7 or 4 for 3 (25%)",
    "Tuesday preroll badge matches the one Michael saw",
  );
  ok(
    menuCardBadgeForItem(infusedBlunt, tue, "tuesday") ===
      "Doobie Tuesday \\u00b7 20% off \\u00b7 or 4 for 3 (25%)",
    "Tuesday infused blunt badge",
  );""",
)

edit(
    P4,
    "Tuesday badge doc comment",
    """ *     highest percent, then highest priority) \u2014 e.g. Tuesday preroll cards say
 *     "Doobie Tuesday \u00b7 20% off \u00b7 or 4 for 3".""",
    """ *     highest percent, then highest priority) \u2014 e.g. Tuesday preroll cards say
 *     "Doobie Tuesday \u00b7 20% off \u00b7 or 4 for 3 (25%)".""",
)

# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------
by_path: dict[str, list[tuple[str, str, str]]] = {}
for path, name, old, new in EDITS:
    by_path.setdefault(path, []).append((name, old, new))

for path, edits in by_path.items():
    with open(path, encoding="utf-8") as fh:
        original = fh.read()
    text = original
    for name, old, new in edits:
        if text.count(new) == 1:
            print(f"{path} :: {name}: already applied")
            continue
        n = text.count(old)
        assert n == 1, f"{path} :: {name}: found {n} copies of OLD (expected 1)"
        text = text.replace(old, new)
        print(f"{path} :: {name}: applied")
    if text != original:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
    # verify from disk
    with open(path, encoding="utf-8") as fh:
        disk = fh.read()
    for name, _old, new in edits:
        assert disk.count(new) == 1, f"{path} :: {name}: NOT on disk after write"
    print(f"{path}: VERIFIED {len(edits)} edit(s) on disk")

sys.exit(0)
