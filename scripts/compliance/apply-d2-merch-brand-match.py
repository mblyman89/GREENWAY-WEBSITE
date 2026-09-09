#!/usr/bin/env python3
"""
apply-d2-merch-brand-match.py  (SLICE D2, part 7)

MEASURED DEFECT (probe-stale4.ts, this session) -- PRE-EXISTING, not introduced
by D1/D2. After the card-guarantee fix took card/cart disagreements from 265 to
65, every one of the 65 survivors was the SAME case:

    OVER  thursday/merch  price=100  advertised=75  charged=100

A Lifted-branded MERCH item (t-shirt, lighter, grinder) on Top Shelf Thursday:
  - the product CARD struck 25% off, because ruleMatchesLine matches a
    non-storewide rule on BRAND alone, and merch carries a brand;
  - the CART charged full price, because cart-discount.ts's thursday branch
    does `if (isMerchOrAccessory(line)) continue;`.

So the card advertised $0.75 and the register charged $1.00. Advertised !=
charged is exactly the integrity problem D2 exists to close (WAC 314-55-155
family), and the owner's standing rule is that inexactness must favour the
CUSTOMER -- never a promise broken at the till.

WHICH SIDE IS RIGHT: the CART is. Top Shelf Thursday is "25% off featured
top-shelf brands" -- a cannabis flower promotion. Merch was deliberately
excluded from the charging path. The storewide branch of ruleMatchesLine
already encodes precisely this intent one line earlier ("Storewide cannabis
deals never touch merch/accessories unless explicitly targeted"). The
brand/key branch simply never got the same guard.

FIX: apply the SAME "unless explicitly targeted" rule to the brand/product-key
dimensions. Merch may still be discounted when a rule explicitly TARGETS a
merch category (that is how the merch BOGO works -- targetCategories:
["merch"], which must keep passing), but a cannabis brand deal no longer drags
branded merch in through the brand dimension alone.

Category matching is untouched, so explicit merch targeting is preserved.
"""

import sys

PATH = "src/lib/promotions/discount-engine-core.ts"

with open(PATH, encoding="utf-8") as fh:
    original = fh.read()
text = original

OLD = """  // Otherwise must match at least one target dimension.
  const catMatch = line.categories.some((c) => hasCi(rule.targetCategories, c));
  const brandMatch = hasCi(rule.targetBrands, line.brand);
  const keyMatch = hasCi(rule.targetProductKeys, line.productKey);
  return catMatch || brandMatch || keyMatch;
}"""

NEW = """  // Otherwise must match at least one target dimension.
  const catMatch = line.categories.some((c) => hasCi(rule.targetCategories, c));
  // SLICE D2: merch/accessories are only ever swept in by an EXPLICIT merch
  // category target -- the same "unless explicitly targeted" rule the
  // storewide branch above already applies. WHY: a branded t-shirt matched
  // Top Shelf Thursday through the BRAND dimension, so the product card struck
  // 25% off while the cart (which skips merch in its thursday branch) charged
  // full price -- advertised != charged. Category matching is untouched, so a
  // rule that targets ["merch"] (e.g. the merch BOGO) still matches.
  if (isMerch(line) && !catMatch) return false;
  const brandMatch = hasCi(rule.targetBrands, line.brand);
  const keyMatch = hasCi(rule.targetProductKeys, line.productKey);
  return catMatch || brandMatch || keyMatch;
}"""

if text.count(NEW) == 1:
    print("EDIT: already applied")
else:
    assert text.count(OLD) == 1, f"EDIT anchor: found {text.count(OLD)} copies"
    text = text.replace(OLD, NEW)
    print("EDIT: applied")

if text != original:
    with open(PATH, "w", encoding="utf-8") as fh:
        fh.write(text)

with open(PATH, encoding="utf-8") as fh:
    disk = fh.read()

assert disk.count("if (isMerch(line) && !catMatch) return false;") == 1, "guard missing on disk"
# The merch BOGO relies on explicit category targeting -- prove the self-test
# that covers it is still present so a regression cannot pass silently.
assert 'targetCategories: ["merch"]' in disk, "explicit merch-target self-test vanished"

print("VERIFIED on disk: merch brand-match guard present")
sys.exit(0)
