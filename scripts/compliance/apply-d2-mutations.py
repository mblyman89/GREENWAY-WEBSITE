#!/usr/bin/env python3
"""
apply-d2-mutations.py  (SLICE D2, part 10)

Extends scripts/compliance/mutate-d1.py to cover the two defects found and
fixed AFTER the first mutation run, plus the suites that guard them. A fix with
no mutation proving the test net catches it is an untested fix.

New mutations:
  18. The struck card price reverts to the HEADLINE percent -> a $40 Wednesday
      cartridge card advertises $28.00 while the register charges $32.00.
  19. guaranteedPercentFor's spend-tier branch returns the top tier -> same
      over-advertisement by a different route.
  20. The merch brand-match guard is removed -> branded merch is struck 25% off
      on Top Shelf Thursday while the cart charges full price.
  21. Wednesday's base spend tier reverts to a $50 threshold -> the sub-$50
      cartridge silently gets nothing again.
  22. Tuesday's 4+ tier reverts to 20% -> the advertised 25% is not honoured.
"""

import sys

PATH = "scripts/compliance/mutate-d1.py"

with open(PATH, encoding="utf-8") as fh:
    original = fh.read()
text = original

# --- EDIT 1: add the parity suites that guard the new fixes ----------------
OLD_SUITES = """SUITES = [
    "tests/compliance/doobie-tuesday-and-sunday.test.ts",
    "tests/compliance/pure-selftests.test.ts",
]"""

NEW_SUITES = """SUITES = [
    "tests/compliance/doobie-tuesday-and-sunday.test.ts",
    "tests/compliance/pure-selftests.test.ts",
    # SLICE D2: these guard the card/cart advertising parity fixes (the struck
    # card price and the merch brand-match guard).
    "tests/compliance/cart-discount-parity.test.ts",
    "tests/compliance/promotions-harmony-parity.test.ts",
    "tests/compliance/deal-badge-core.test.ts",
    "tests/compliance/cart-estimator-core.test.ts",
]"""

if text.count(NEW_SUITES) == 1:
    print("EDIT 1 (suites): already applied")
else:
    assert text.count(OLD_SUITES) == 1, f"EDIT 1 anchor: {text.count(OLD_SUITES)} copies"
    text = text.replace(OLD_SUITES, NEW_SUITES)
    print("EDIT 1 (suites): applied")

# --- EDIT 2: append the new mutations --------------------------------------
# Anchor on the end of the MUTATIONS list: the last ")," before "]".
ANCHOR = """]


def run_suites():"""

NEW_MUTATIONS = """    # ---- SLICE D2: card/cart advertising parity -------------------------
    (
        "struck card price reverts to the HEADLINE percent (over-advertises)",
        PUBLISHED,
        "  const guaranteed = Math.max(...matching.map((s) => guaranteedPercentFor(s, item)));",
        "  const guaranteed = Math.max(...matching.map((s) => headlinePercentFor(s)));",
    ),
    (
        "guaranteedPercentFor spend branch returns the TOP tier",
        PUBLISHED,
        "    return tierPercent(item.priceMinorUnits, tiers);",
        "    return Math.max(...tiers.map((t) => t.percent));",
    ),
    (
        "merch brand-match guard removed (branded merch struck on Thursday)",
        ENGINE,
        "  if (isMerch(line) && !catMatch) return false;",
        "  if (false && isMerch(line) && !catMatch) return false;",
    ),
    (
        "Wednesday base spend tier reverts to a $50 threshold",
        SEED,
        "      { at: 0, percent: 20 },\\n      { at: 15000, percent: 30 },",
        "      { at: 5000, percent: 20 },\\n      { at: 15000, percent: 30 },",
    ),
    (
        "Tuesday 4+ tier reverts to 20% (advertised 25% not honoured)",
        SEED,
        "      { at: 1, percent: 20 },\\n      { at: 4, percent: 25 },",
        "      { at: 1, percent: 20 },\\n      { at: 4, percent: 20 },",
    ),
]


def run_suites():"""

if text.count(NEW_MUTATIONS) == 1:
    print("EDIT 2 (mutations): already applied")
else:
    assert text.count(ANCHOR) == 1, f"EDIT 2 anchor: {text.count(ANCHOR)} copies"
    text = text.replace(ANCHOR, NEW_MUTATIONS)
    print("EDIT 2 (mutations): applied")

if text != original:
    with open(PATH, "w", encoding="utf-8") as fh:
        fh.write(text)

with open(PATH, encoding="utf-8") as fh:
    disk = fh.read()

assert disk.count("cart-discount-parity.test.ts") == 1, "parity suite not registered"
assert disk.count("struck card price reverts to the HEADLINE percent") == 1, "mutation 18 missing"
assert disk.count("merch brand-match guard removed") == 1, "mutation 20 missing"
assert disk.count("Tuesday 4+ tier reverts to 20%") == 1, "mutation 22 missing"
print("VERIFIED on disk: 5 new mutations + 4 new suites")
sys.exit(0)
