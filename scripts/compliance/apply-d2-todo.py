#!/usr/bin/env python3
"""
apply-d2-todo.py  (SLICE D2, part 12)

Appends the second half of D2 to the tracker: the legacy-suite reconciliation
and the two advertising-parity defects that only surfaced because the mutation
harness refused to accept an untested fix.
"""

import sys

PATH = "todo-discounts.md"

with open(PATH, encoding="utf-8") as fh:
    original = fh.read()
text = original

MARKER = "## D2 (part 2) \u2014 legacy suites + card/cart advertising parity"
if MARKER in text:
    print("already applied")
    sys.exit(0)

BLOCK = """
## D2 (part 2) \u2014 legacy suites + card/cart advertising parity

Correcting the four legacy suites that still encoded the OLD behaviour turned
into a defect hunt. Every number below was MEASURED with throwaway probes
before any test was touched \u2014 the discipline is that a red test is a question,
not an instruction, and the answer is only ever "the test pinned the bug" or
"I broke something real". Both answers turned up.

- [x] `cart-discount-parity` \u2014 three tests pinned bugs, corrected from measured
      values: Tuesday's "the SMALLER savings wins", Wednesday's 15/20/30 ladder,
      and Sunday's floored 33% (which charged $20.10 for three $10 units, 10\u00a2
      MORE than "pay for 2" advertises).
- [x] `promotions-harmony-parity` \u2014 Tuesday/Wednesday are tiered now, not
      either/or, so `config.eitherOr` is gone and the offer labels read
      "20\u201325% off" / "20\u201330% off".
- [x] `deal-badge-core` \u2014 Tuesday badge copy now states the percent the register
      charges at 4+ units: "20% off \u00b7 or 4 for 3 (25%)".
- [x] `cart-estimator-core` \u2014 Wednesday nudges point at the only remaining tier
      (30% at $150). Doobie Tuesday now nudges HONESTLY: the old code skipped
      either/or rules outright because "add one more preroll" could have LOWERED
      the discount, which would have been a lie. D1 removed the inverted
      selection, so the nudge is now true.
- [x] Full suite green: **600 files / 15,291 tests**. tsc 0. eslint 0 errors.
- [x] `mutate-d1.py` extended to 22 mutations across 6 suites \u2014 **22/22 caught**.

### Bugs D2 part 2 found

- **The product card advertised a price the register would not honour.**
  `headlinePercentFor` returns the BEST case (top tier), and the struck card
  price used it directly. On Wax Wednesday that meant a $40 cartridge card
  showed **$28.00** (30% off) while the cart charged **$32.00** (20%) \u2014 a $4.00
  over-advertisement on every sub-$150 card. Fixed with `guaranteedPercentFor`:
  the percent a single unit is CERTAIN to earn on its own, evaluated through the
  engine's own `tierPercent` so the card cannot drift from the register. The
  BADGE copy still states the full offer ("20% off \u00b7 30% at $150+"), because
  that is honest advertising of the deal \u2014 only the PRICE, which is a promise
  about one item right now, was tightened.
- **Branded merch was struck on Top Shelf Thursday.** `ruleMatchesLine` matched
  non-storewide rules on BRAND alone, and merch carries a brand \u2014 so a
  Lifted-branded t-shirt showed 25% off on its card while the cart charged full
  price (`cart-discount.ts` skips merch in its thursday branch). The storewide
  branch one line above already encoded the right intent ("never touch
  merch/accessories unless explicitly targeted"); the brand/key branch never
  got the same guard. Pre-existing, not introduced by D1/D2.
- **Measured impact:** card-vs-cart over-advertisements across 6,370
  weekday \u00d7 category \u00d7 price \u00d7 variant combinations went **265 \u2192 0**. The 884
  remaining disagreements are all UNDER-advertisements \u2014 the intended
  Fri/Sat/Sun policy where the card shows the regular price because a lone item
  cannot know the basket.
- **The mutation harness earned its keep.** Run 3 scored **19/22**, and all three
  survivors were the fixes above \u2014 proving the fixes were real but *untested*,
  because nothing in the suite compared the card price to the charged price.
  Closed with an exhaustive sweep asserting the card never advertises below what
  the cart charges. An untested fix is one refactor from silently reverting.
- **My own new test then caught an ordering bug in the fix.**
  `guaranteedPercentFor` returned any authored `discountPercent` before checking
  basket mechanics, so Super Saturday (`discountType: "basket"` with an authored
  headline of 30%) claimed a lone item was guaranteed 30% \u2014 when Saturday's 30%
  lands on exactly ONE unit of a multi-item basket. The basket check existed but
  sat below the early return and was unreachable. Basket mechanics are now
  evaluated first.
- **`tsc` caught a field I had assumed existed.** I wrote
  `item.variantLabel`; `GreenwayMenuItem` has no such property \u2014
  `itemToEngineLine` hardcodes `variantLabel: null`. Corrected to read the label
  off the engine line, which is the single definition of what the engine sees,
  so the card tracks it automatically if variant data is ever attached.

### Process notes worth keeping

- Two apply scripts aborted on a wrong anchor and **wrote nothing** \u2014 the
  `assert count == 1` guard doing exactly its job. One was a Python `re` call
  missing `re.DOTALL`; one was an anchor guessed instead of read.
- Idempotency is still decided on `count(new) == 1` ALONE. Testing
  `count(old) == 0` as well misfires whenever NEW contains OLD as a substring.
"""

text = text.rstrip("\n") + "\n" + BLOCK

with open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

with open(PATH, encoding="utf-8") as fh:
    disk = fh.read()
assert disk.count(MARKER) == 1, "block not on disk"
assert disk.count("22/22 caught") == 1, "mutation score not recorded"
assert disk.count("265 \u2192 0") == 1, "measured impact not recorded"
print("VERIFIED on disk: D2 part 2 tracker section appended")
sys.exit(0)
