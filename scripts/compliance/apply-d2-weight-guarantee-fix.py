#!/usr/bin/env python3
"""
apply-d2-weight-guarantee-fix.py  (SLICE D2, part 6b)

tsc caught a field I had assumed existed:

  src/lib/promotions/published-rules-core.ts(441,43): error TS2339:
    Property 'variantLabel' does not exist on type 'GreenwayMenuItem'.

GROUND TRUTH (read from itemToEngineLine, published-rules-core.ts:357): a menu
item carries NO variant label at all -- itemToEngineLine hardcodes
`variantLabel: null`. A product card therefore has no weight information, so a
weight-tiered deal (Ounce Friday) guarantees a lone carded item NOTHING, and
saying otherwise would be exactly the over-advertisement this slice removes.

FIX: derive the label from itemToEngineLine(item) -- the SAME line the engine
matches and prices with -- instead of reaching for a field on the item. Today
that yields null -> 0 grams -> 0% guaranteed, which is the honest answer; and
if variant data is ever attached to the engine line, the card guarantee starts
tracking it automatically with no further code change. Friday is additionally
hidden by CARD_DISCOUNT_HIDDEN_WEEKDAYS, so this is belt and braces.
"""

import sys

PATH = "src/lib/promotions/published-rules-core.ts"

with open(PATH, encoding="utf-8") as fh:
    original = fh.read()
text = original

OLD = """  if (s.discountType === "weight_tier") {
    const tiers = c.weightTiers?.length ? c.weightTiers : DEFAULT_WEIGHT_TIERS;
    return tierPercent(gramsForLabel(item.variantLabel), tiers);
  }"""

NEW = """  if (s.discountType === "weight_tier") {
    const tiers = c.weightTiers?.length ? c.weightTiers : DEFAULT_WEIGHT_TIERS;
    // Read the label off the ENGINE LINE, never off the item: itemToEngineLine
    // is the single definition of what the engine sees, and it carries no
    // variant label today (null), so a lone carded item is guaranteed 0% by a
    // weight tier. That is the honest answer -- a card cannot know the basket's
    // total weight -- and it tracks itemToEngineLine automatically if variant
    // data is ever attached.
    return tierPercent(gramsForLabel(itemToEngineLine(item).variantLabel), tiers);
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

assert disk.count("gramsForLabel(itemToEngineLine(item).variantLabel)") == 1, "fix missing on disk"
assert "item.variantLabel" not in disk, "an item.variantLabel reference survives"
print("VERIFIED on disk: weight guarantee reads the engine line")
sys.exit(0)
