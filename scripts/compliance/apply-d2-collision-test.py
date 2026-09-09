#!/usr/bin/env python3
"""
apply-d2-collision-test.py  (SLICE D2, part 14)

Locks in the self-review fix from part 6d with a test that FAILS on the
title-join it replaced.

The card guarantee used to find its rule with `s.title === deal.label`. Nothing
enforces title uniqueness -- staff publish promotions from /admin/promotions and
two rows may share a title -- so a collision could hand the card a guarantee
from a rule that did not produce the deal, re-opening the over-advertisement.

This test publishes TWO active rules that share a title but not a mechanic and
asserts the card still never advertises below what the cart charges. Under the
old title join the guarantee was read from the wrong rule; under the identity
join it is read from the rules that actually match the line.
"""

import sys

PATH = "tests/compliance/doobie-tuesday-and-sunday.test.ts"

with open(PATH, encoding="utf-8") as fh:
    original = fh.read()
text = original

MARKER = "a TITLE COLLISION between two published rules cannot inflate the card"
if MARKER in text:
    print("already applied")
    sys.exit(0)

ANCHOR = """  it("an EXPLICIT merch category target still discounts merch (guard is not a blanket ban)", () => {"""

BLOCK = """  it("a TITLE COLLISION between two published rules cannot inflate the card", () => {
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

"""

assert text.count(ANCHOR) == 1, f"anchor: found {text.count(ANCHOR)} copies"
text = text.replace(ANCHOR, BLOCK + ANCHOR)

with open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

with open(PATH, encoding="utf-8") as fh:
    disk = fh.read()
assert disk.count(MARKER) == 1, "block not on disk"
assert disk.count("db-impostor") == 1, "impostor rule missing"
print("VERIFIED on disk: title-collision test added")
sys.exit(0)
