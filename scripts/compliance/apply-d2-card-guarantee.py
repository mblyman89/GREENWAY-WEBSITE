#!/usr/bin/env python3
"""
apply-d2-card-guarantee.py  (SLICE D2, part 6)

MEASURED DEFECT (probe-stale3.ts, this session):

    price=4000 (a $40 cartridge, Wednesday)
      CARD = { pct: 30, preview: 2800 }   <- card struck price says $28.00
      CART = 20%        -> charges 3200   <- register charges $32.00

The card ADVERTISED $28.00 and the register CHARGED $32.00. That is a
$4.00 over-advertisement on every sub-$150 Wednesday cartridge card, and
advertising integrity (WAC 314-55-155 family) requires the advertised price to
equal the charged price. The owner's rule is the opposite direction: if we
cannot be exact we round in the CUSTOMER's favour -- we never advertise a price
we will not honour.

ROOT CAUSE: headlinePercentFor() returns the BEST-CASE percent (the top tier).
That is correct for BADGE copy ("20% off - 30% at $150+" is honest advertising
of the whole offer). It is wrong for the struck PRICE, which is a promise about
THIS item, alone, right now. A $40 cartridge alone can only reach the base
tier: 20%.

FIX: add guaranteedPercentFor() -- the percent a single unit of this item is
CERTAIN to earn with nothing else in the basket -- and use it for the struck
card price. For tiered mechanics it evaluates the item's own value against its
own tiers via the SAME tierPercent() the engine charges with (spend tiers vs
the item price; qty tiers vs quantity 1; weight tiers vs the item's grams).
Explicit authored percents and flat percent deals are unchanged.

SLICE 40's weekday gate (Fri/Sat/Sun show no struck price at all) is untouched
and still runs first. headlinePercentFor / menuDiscountForItem / the badge path
are all untouched -- only the struck price tightens.
"""

import re
import sys

PATH = "src/lib/promotions/published-rules-core.ts"

with open(PATH, encoding="utf-8") as fh:
    original = fh.read()
text = original

# ---------------------------------------------------------------------------
# EDIT 1: add guaranteedPercentFor right after headlinePercentFor.
# ---------------------------------------------------------------------------
OLD_1 = """  if (tiers?.length) return Math.max(...tiers.map((t) => t.percent));
  if (c.basketTopItem) return Math.max(c.basketTopItem.topPercent, c.basketTopItem.restPercent);
  return 0;
}
"""

NEW_1 = """  if (tiers?.length) return Math.max(...tiers.map((t) => t.percent));
  if (c.basketTopItem) return Math.max(c.basketTopItem.topPercent, c.basketTopItem.restPercent);
  return 0;
}

/**
 * The percent a SINGLE unit of this item is GUARANTEED to earn with nothing
 * else in the basket -- the only percent a struck-through card price may
 * promise (SLICE D2).
 *
 * WHY THIS EXISTS (measured defect): headlinePercentFor returns the BEST case
 * (top tier). On Wax Wednesday the tiers are 20% base / 30% at $150+, so a $40
 * cartridge card previewed $28.00 (30% off) while the register charged $32.00
 * (20%). The card advertised a price we would not honour. Advertising
 * integrity (WAC 314-55-155 family) requires advertised == charged, and the
 * owner's standing rule is that any inexactness must favour the CUSTOMER --
 * never a promise we break at the till.
 *
 * The best case is still honest as BADGE COPY ("20% off - 30% at $150+"
 * describes the whole offer), so headlinePercentFor and the badge path are
 * deliberately unchanged. Only the struck PRICE tightens, because a price is a
 * promise about THIS item, alone, right now.
 *
 * Tier evaluation reuses the engine's own tierPercent() against the item's own
 * value, so the card cannot drift from the register: spend tiers see the item
 * price, quantity tiers see quantity 1, weight tiers see the item's grams.
 */
export function guaranteedPercentFor(s: PublishedRuleSnapshot, item: GreenwayMenuItem): number {
  if (s.discountPercent > 0 && !s.config.qtyTiers?.length && !s.config.spendTiers?.length) {
    return s.discountPercent;
  }
  const c = s.config;
  // Either/or: the flat leg is the floor the customer always gets.
  if (c.eitherOr) return c.eitherOr.flatPercent;
  if (s.discountType === "threshold_spend") {
    const tiers = c.spendTiers?.length ? c.spendTiers : DEFAULT_SPEND_TIERS;
    return tierPercent(item.priceMinorUnits, tiers);
  }
  if (s.discountType === "multi_item_tier") {
    const tiers = c.qtyTiers?.length ? c.qtyTiers : DEFAULT_QTY_TIERS;
    return tierPercent(1, tiers); // one unit on the card = quantity 1
  }
  if (s.discountType === "weight_tier") {
    const tiers = c.weightTiers?.length ? c.weightTiers : DEFAULT_WEIGHT_TIERS;
    return tierPercent(gramsForLabel(item.variantLabel), tiers);
  }
  // Basket mechanics guarantee a single item nothing at all.
  if (c.basketTopItem || c.basketNforM) return 0;
  return s.discountPercent > 0 ? s.discountPercent : 0;
}
"""

if text.count(NEW_1) == 1:
    print("EDIT 1: already applied")
else:
    assert text.count(OLD_1) == 1, f"EDIT 1 anchor: found {text.count(OLD_1)} copies"
    text = text.replace(OLD_1, NEW_1)
    print("EDIT 1: applied")

# ---------------------------------------------------------------------------
# EDIT 2: gate the struck card price on the guaranteed percent.
# ---------------------------------------------------------------------------
OLD_2 = """  if (!activeRules || !weekday) return undefined;
  if (!weekdayShowsCardDiscounts(weekday)) return undefined;
  return menuDiscountForItem(item, activeRules);
}
"""

NEW_2 = """  if (!activeRules || !weekday) return undefined;
  if (!weekdayShowsCardDiscounts(weekday)) return undefined;
  const deal = menuDiscountForItem(item, activeRules);
  if (!deal) return undefined;
  // SLICE D2: the struck price may only promise what THIS item, alone, is
  // guaranteed to earn. See guaranteedPercentFor -- a $40 Wednesday cartridge
  // previewed 30% off and was charged 20%. When the guaranteed percent is
  // lower than the headline we re-price the preview down to the guarantee;
  // when nothing is guaranteed the card shows the regular price and the CART
  // reveals the real savings (same shape as the Fri/Sat/Sun policy above).
  const matching = activeRules.filter((s) => s.title === deal.label);
  if (!matching.length) return deal;
  const guaranteed = Math.max(...matching.map((s) => guaranteedPercentFor(s, item)));
  if (guaranteed >= deal.discountPercent) return deal;
  if (guaranteed <= 0) return undefined;
  const preview = discountPreviewPrice(item.priceMinorUnits, Math.min(guaranteed, 99));
  if (preview >= item.priceMinorUnits) return undefined;
  return {
    ...deal,
    discountPercent: guaranteed,
    cardPreviewSalePriceMinorUnits: preview,
    salePriceMinorUnits: deal.perItemSalePrice ? preview : item.priceMinorUnits,
  };
}
"""

if text.count(NEW_2) == 1:
    print("EDIT 2: already applied")
else:
    assert text.count(OLD_2) == 1, f"EDIT 2 anchor: found {text.count(OLD_2)} copies"
    text = text.replace(OLD_2, NEW_2)
    print("EDIT 2: applied")

# ---------------------------------------------------------------------------
# EDIT 3: make sure tierPercent + gramsForLabel are imported.
# ---------------------------------------------------------------------------
for name in ("tierPercent", "gramsForLabel"):
    # Look inside the import block from discount-engine-core.
    m = re.search(
        r"import \{\n(.*?)\n\} from \"\./discount-engine-core\";", text, flags=re.DOTALL
    )
    assert m, "could not locate the discount-engine-core import block"
    block = m.group(1)
    if re.search(rf"^\s*{name},\s*$", block, flags=re.MULTILINE):
        print(f"EDIT 3 ({name}): already imported")
        continue
    new_block = block + f"\n  {name},"
    text = text.replace(m.group(0), m.group(0).replace(block, new_block), 1)
    print(f"EDIT 3 ({name}): imported")

if text != original:
    with open(PATH, "w", encoding="utf-8") as fh:
        fh.write(text)

# --- verify from DISK -------------------------------------------------------
with open(PATH, encoding="utf-8") as fh:
    disk = fh.read()

assert disk.count("export function guaranteedPercentFor") == 1, "guaranteedPercentFor missing on disk"
assert disk.count("const guaranteed = Math.max(...matching.map((s) => guaranteedPercentFor(s, item)));") == 1, (
    "card gate missing on disk"
)
imp = re.search(
    r"import \{\n(.*?)\n\} from \"\./discount-engine-core\";", disk, flags=re.DOTALL
).group(1)
assert re.search(r"^\s*tierPercent,\s*$", imp, flags=re.MULTILINE), "tierPercent not imported"
assert re.search(r"^\s*gramsForLabel,\s*$", imp, flags=re.MULTILINE), "gramsForLabel not imported"
# The regex `s` (dotAll) flag is a compile error under the root tsconfig target
# (CI gotcha) -- assert we never emitted one into TS source.
assert "/s\n" not in disk, "unexpected dotAll regex"

print("VERIFIED on disk: guaranteedPercentFor + card gate + imports")
sys.exit(0)
