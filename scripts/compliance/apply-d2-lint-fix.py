#!/usr/bin/env python3
"""
apply-d2-lint-fix.py  (SLICE D2, part 13)

eslint went 15 -> 16 warnings and the new one was MINE:

  tests/compliance/doobie-tuesday-and-sunday.test.ts
    619:21  warning  'over' is defined but never used

The `cardItem` helper accepted an `over` argument it never spread -- every call
site passes `{}` and then spreads its own fields. That is dead weight AND a
trap: a future caller would pass overrides and silently get none of them.

FIX: drop the unused parameter and make the helper a plain base-item factory,
then simplify every call site to `baseItem(category, price)` so overrides are
explicit and cannot be silently dropped. Behaviour is identical (the spreads
were already doing all the work); the warning and the trap both go away.

Baseline restored to 15 warnings, all pre-existing and in files this round
never touched.
"""

import re
import sys

PATH = "tests/compliance/doobie-tuesday-and-sunday.test.ts"

with open(PATH, encoding="utf-8") as fh:
    original = fh.read()
text = original

OLD_HELPER = """  const cardItem = (over: Record<string, unknown>) =>
    ({
      id: "x",
      slug: "x",
      name: "X",
      brand: "Lifted",
      category: "flower",
      priceMinorUnits: 4000,
    }) as unknown as Parameters<typeof menuCardDiscountForItem>[0] as never;"""

NEW_HELPER = """  // A minimal menu item for card-preview assertions. Category and price are
  // always explicit at the call site so an override can never be silently
  // dropped (an earlier version took an `over` bag it never spread).
  const baseItem = (category: string, priceMinorUnits: number) =>
    ({
      id: "x",
      slug: "x",
      name: "X",
      brand: "Lifted",
      category,
      priceMinorUnits,
    }) as unknown as Parameters<typeof menuCardDiscountForItem>[0];"""

if text.count(NEW_HELPER) == 1:
    print("helper: already applied")
else:
    assert text.count(OLD_HELPER) == 1, f"helper anchor: {text.count(OLD_HELPER)} copies"
    text = text.replace(OLD_HELPER, NEW_HELPER)
    print("helper: applied")

# Rewrite every call site: { ...(cardItem({}) as object), category: X, priceMinorUnits: Y } as never
PATTERN = re.compile(
    r"\{ \.\.\.\(cardItem\(\{\}\) as object\), category(?::\s*(\"[a-z-]+\")|), priceMinorUnits: (\w+) \} as never"
)


def repl(m: re.Match[str]) -> str:
    cat = m.group(1) or "category"
    return f"baseItem({cat}, {m.group(2)})"


text, n = PATTERN.subn(repl, text)
print(f"call sites rewritten: {n}")

if text != original:
    with open(PATH, "w", encoding="utf-8") as fh:
        fh.write(text)

with open(PATH, encoding="utf-8") as fh:
    disk = fh.read()

assert "cardItem" not in disk, "a cardItem reference survives"
assert disk.count("const baseItem = (category: string, priceMinorUnits: number)") == 1, "helper missing"
assert disk.count("baseItem(") >= 8, f"expected >=8 call sites, found {disk.count('baseItem(')}"
assert "as never" not in disk.split("card/cart advertising parity")[1], "stray `as never` in the new block"
print("VERIFIED on disk: unused parameter removed, call sites explicit")
sys.exit(0)
