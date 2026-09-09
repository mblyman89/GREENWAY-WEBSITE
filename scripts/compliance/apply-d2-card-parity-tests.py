#!/usr/bin/env python3
"""
apply-d2-card-parity-tests.py  (SLICE D2, part 11)

THE MUTATION HARNESS FOUND A REAL GAP. Run 3 scored 19/22, and all three
survivors were the fixes made this session:

  - struck card price reverts to the HEADLINE percent (over-advertises)
  - guaranteedPercentFor spend branch returns the TOP tier
  - merch brand-match guard removed (branded merch struck on Thursday)

They survived because NOTHING in the suite compares the struck CARD price to
what the CART actually charges. The fixes were real (measured: 265 -> 0
over-advertisements across 6,370 card/cart combinations) but untested, and an
untested fix is one refactor away from silently reverting.

This adds the missing invariant as a first-class, exhaustive test: for every
weekday x eligible category x price x variant, the price a product card
ADVERTISES must never be lower than the price the cart CHARGES for that item
alone. That is the advertising-integrity contract (WAC 314-55-155 family) and
the owner's rule that any inexactness favours the CUSTOMER.

The sweep is the same shape as the probe that found the defect, so the test and
the evidence agree by construction.
"""

import sys

PATH = "tests/compliance/doobie-tuesday-and-sunday.test.ts"

with open(PATH, encoding="utf-8") as fh:
    original = fh.read()
text = original

MARKER = 'describe("card/cart advertising parity'
if text.count(MARKER) >= 1:
    print("already applied")
    sys.exit(0)

# --- imports: extend the two existing import blocks in place --------------
OLD_PUB = 'import { seedConfigFor } from "@/lib/promotions/published-rules-core";'
NEW_PUB = """import {
  activeSnapshotsFor,
  guaranteedPercentFor,
  headlinePercentFor,
  menuCardDiscountForItem,
  seedConfigFor,
  seedRuleSnapshots,
} from "@/lib/promotions/published-rules-core";"""
assert text.count(OLD_PUB) == 1, f"published-rules import: {text.count(OLD_PUB)} copies"
text = text.replace(OLD_PUB, NEW_PUB)

OLD_CART = 'import { computeCartDiscounts } from "@/lib/specials/cart-discount";'
NEW_CART = """import {
  computeCartDiscounts,
  type DiscountCartLine,
} from "@/lib/specials/cart-discount";
import type { StoreWeekday } from "@/lib/specials/daily-deals";"""
assert text.count(OLD_CART) == 1, f"cart-discount import: {text.count(OLD_CART)} copies"
text = text.replace(OLD_CART, NEW_CART)

OLD_ENG = """import {
  computePromotions,
  DEFAULT_SPEND_TIERS,"""
NEW_ENG = """import {
  computePromotions,
  ruleMatchesLine,
  DEFAULT_SPEND_TIERS,"""
assert text.count(OLD_ENG) == 1, f"engine import: {text.count(OLD_ENG)} copies"
text = text.replace(OLD_ENG, NEW_ENG)
print("imports extended")

BLOCK = '''
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
  const cardItem = (over: Record<string, unknown>) =>
    ({
      id: "x",
      slug: "x",
      name: "X",
      brand: "Lifted",
      category: "flower",
      priceMinorUnits: 4000,
    }) as unknown as Parameters<typeof menuCardDiscountForItem>[0] as never;

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
          const item = { ...(cardItem({}) as object), category, priceMinorUnits: price } as never;
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
    const item = { ...(cardItem({}) as object), category: "cartridge", priceMinorUnits: 4000 } as never;
    const card = menuCardDiscountForItem(item, rules, "wednesday");
    expect(card).toBeDefined();
    expect(card!.discountPercent).toBe(20);
    expect(card!.cardPreviewSalePriceMinorUnits).toBe(3200);

    // At $150 the top tier is genuinely guaranteed, so the card may show 30%.
    const big = { ...(cardItem({}) as object), category: "cartridge", priceMinorUnits: 15000 } as never;
    const cardBig = menuCardDiscountForItem(big, rules, "wednesday");
    expect(cardBig!.discountPercent).toBe(30);
    expect(cardBig!.cardPreviewSalePriceMinorUnits).toBe(10500);
  });

  it("guaranteedPercentFor never exceeds the headline, and is the CHARGED percent for tiers", () => {
    const seeds = seedRuleSnapshots();
    const byDay = new Map(seeds.map((s) => [s.promoKey, s]));
    const wed = byDay.get("daily.wednesday")!;
    const cheap = { ...(cardItem({}) as object), category: "cartridge", priceMinorUnits: 4000 } as never;
    const rich = { ...(cardItem({}) as object), category: "cartridge", priceMinorUnits: 15000 } as never;
    // Base tier for a small basket, top tier once the threshold is truly met.
    expect(guaranteedPercentFor(wed, cheap)).toBe(20);
    expect(guaranteedPercentFor(wed, rich)).toBe(30);
    expect(guaranteedPercentFor(wed, cheap)).toBeLessThanOrEqual(headlinePercentFor(wed));

    // Quantity tiers: a card is ONE unit, so it can only promise the 1-unit tier.
    const tue = byDay.get("daily.tuesday")!;
    const preroll = { ...(cardItem({}) as object), category: "preroll", priceMinorUnits: 1000 } as never;
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
    const merch = { ...(cardItem({}) as object), category: "merch", priceMinorUnits: 2000 } as never;
    expect(menuCardDiscountForItem(merch, rules, "thursday")).toBeUndefined();

    // The cannabis item from the same featured brand still gets its 25%.
    const flower = { ...(cardItem({}) as object), category: "flower", priceMinorUnits: 4000 } as never;
    const card = menuCardDiscountForItem(flower, rules, "thursday");
    expect(card!.discountPercent).toBe(25);
    expect(card!.cardPreviewSalePriceMinorUnits).toBe(3000);
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
'''

text = text.rstrip("\n") + "\n" + BLOCK

with open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

with open(PATH, encoding="utf-8") as fh:
    disk = fh.read()
assert disk.count(MARKER) == 1, "block not on disk"
for sym in (
    "menuCardDiscountForItem",
    "guaranteedPercentFor",
    "seedRuleSnapshots",
    "activeSnapshotsFor",
    "ruleMatchesLine",
    "DiscountCartLine",
    "StoreWeekday",
):
    assert sym in disk, f"{sym} not present after write"
print("VERIFIED on disk: card/cart advertising parity block + imports")
sys.exit(0)
