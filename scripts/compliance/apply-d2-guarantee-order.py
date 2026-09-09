#!/usr/bin/env python3
"""
apply-d2-guarantee-order.py  (SLICE D2, part 6c)

MY OWN NEW TEST CAUGHT THIS:

  card/cart advertising parity (SLICE D2)
    > guaranteedPercentFor never exceeds the headline...
  AssertionError: expected 30 to be +0

GROUND TRUTH (daily-deal-seed.ts:127-138): Super Saturday is
`discountType: "basket"` with an AUTHORED `discountPercent: 30` (the headline
"30% off one item + 15% off everything else"). guaranteedPercentFor's first
branch returns any authored discountPercent, so Saturday returned 30 -- but a
BASKET mechanic guarantees a LONE item nothing at all: Saturday's 30% lands on
exactly ONE unit in a multi-item basket, and an item on its own may only earn
the 15% rest-rate, or nothing.

The basket check existed but sat BELOW the authored-percent early return, so it
was unreachable for Saturday. Ordering bug, caught by the net, not by me.

FIX: test the basket mechanics FIRST -- a basket-dependent deal can never
guarantee a single carded item anything, whatever headline it authors. Also
gate on discountType === "basket" so a basket deal with no config still
resolves to 0 rather than falling through to its headline.

Sunday already returned 0 (it authors discountPercent: 0), so this only
tightens Saturday. Both days are additionally hidden by
CARD_DISCOUNT_HIDDEN_WEEKDAYS, so no user-visible price changes -- but the
function is now correct in isolation, which is what the mutation net tests.
"""

import sys

PATH = "src/lib/promotions/published-rules-core.ts"

with open(PATH, encoding="utf-8") as fh:
    original = fh.read()
text = original

OLD = """export function guaranteedPercentFor(s: PublishedRuleSnapshot, item: GreenwayMenuItem): number {
  if (s.discountPercent > 0 && !s.config.qtyTiers?.length && !s.config.spendTiers?.length) {
    return s.discountPercent;
  }
  const c = s.config;
  // Either/or: the flat leg is the floor the customer always gets.
  if (c.eitherOr) return c.eitherOr.flatPercent;"""

NEW = """export function guaranteedPercentFor(s: PublishedRuleSnapshot, item: GreenwayMenuItem): number {
  const c = s.config;
  // BASKET MECHANICS FIRST. A basket deal guarantees a LONE item nothing: Super
  // Saturday's 30% lands on exactly ONE unit of a multi-item basket (an item by
  // itself may only earn the 15% rest-rate, or nothing), and Ice Cream Sunday's
  // 3-for-2 needs three units to exist at all. Saturday AUTHORS
  // discountPercent: 30 as its headline, so this check must outrank the
  // authored-percent branch below -- it previously sat underneath it and was
  // unreachable, which returned a guaranteed 30% for a single item.
  if (s.discountType === "basket" || c.basketTopItem || c.basketNforM) return 0;
  if (s.discountPercent > 0 && !c.qtyTiers?.length && !c.spendTiers?.length) {
    return s.discountPercent;
  }
  // Either/or: the flat leg is the floor the customer always gets.
  if (c.eitherOr) return c.eitherOr.flatPercent;"""

if text.count(NEW) == 1:
    print("EDIT 1: already applied")
else:
    assert text.count(OLD) == 1, f"EDIT 1 anchor: found {text.count(OLD)} copies"
    text = text.replace(OLD, NEW)
    print("EDIT 1: applied")

# Remove the now-dead duplicate basket check further down.
OLD_2 = """  // Basket mechanics guarantee a single item nothing at all.
  if (c.basketTopItem || c.basketNforM) return 0;
  return s.discountPercent > 0 ? s.discountPercent : 0;"""
NEW_2 = """  // (Basket mechanics are handled at the top of this function.)
  return s.discountPercent > 0 ? s.discountPercent : 0;"""

if text.count(NEW_2) == 1:
    print("EDIT 2: already applied")
else:
    assert text.count(OLD_2) == 1, f"EDIT 2 anchor: found {text.count(OLD_2)} copies"
    text = text.replace(OLD_2, NEW_2)
    print("EDIT 2: applied")

if text != original:
    with open(PATH, "w", encoding="utf-8") as fh:
        fh.write(text)

with open(PATH, encoding="utf-8") as fh:
    disk = fh.read()

assert disk.count('if (s.discountType === "basket" || c.basketTopItem || c.basketNforM) return 0;') == 1, (
    "basket-first guard missing on disk"
)
# Prove the old unreachable copy is gone (exactly one basket check remains).
assert disk.count("if (c.basketTopItem || c.basketNforM) return 0;") == 0, "dead basket check survives"
# `const c = s.config;` must be declared before first use, exactly once here.
fn = disk.split("export function guaranteedPercentFor")[1].split("\n}")[0]
assert fn.count("const c = s.config;") == 1, "config alias duplicated or missing"
assert fn.index("const c = s.config;") < fn.index('s.discountType === "basket"'), "alias declared after use"

print("VERIFIED on disk: basket mechanics evaluated first")
sys.exit(0)
