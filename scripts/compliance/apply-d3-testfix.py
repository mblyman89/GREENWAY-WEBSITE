#!/usr/bin/env python3
"""SLICE D3 - correct MY OWN test's tolerance, not the engine.

The sweep asserted `|pct - 30| < 0.001`, but exact-cent maths deliberately
rounds the DISCOUNT UP (ceil) so the customer is never short-changed. A 4002c
line therefore saves 1201c = 30.0100%, not exactly 30%. The engine is right;
my assertion was too tight. Verified by inspecting real failing baskets:

  l3 regular=4002 charged=2801 pct=30.0100 label=Super Saturday - 30% off

The correct assertion is "at least the advertised 30%, and never wildly above"
-- one cent of over-delivery per unit is the intended, owner-directed behaviour.
"""
import io
import sys

PATH = "tests/compliance/saturday-headline.test.ts"
with io.open(PATH, encoding="utf-8") as f:
    text = f.read()
orig = text

# A shared helper documenting WHY the tolerance is one-sided.
OLD_HELPER = "const savedPercent = (regular: number, unit: number) => ((regular - unit) / regular) * 100;"
NEW_HELPER = """const savedPercent = (regular: number, unit: number) => ((regular - unit) / regular) * 100;

/**
 * Did this line receive AT LEAST the advertised percent?
 *
 * Exact-cent maths rounds the DISCOUNT up (Math.ceil) so a customer is never
 * short-changed, which means a "30% off" line lands a shade ABOVE 30 -- a
 * 4002c item saves 1201c = 30.0100%. An equality assertion would therefore
 * fail on honest behaviour. One unit's worth of over-delivery is the ceiling.
 */
const receivedAtLeast = (regular: number, unit: number, percent: number): boolean => {
  const actual = savedPercent(regular, unit);
  const oneCentOfSlack = (1 / regular) * 100;
  return actual >= percent - 1e-9 && actual <= percent + oneCentOfSlack + 1e-9;
};"""
if text.count(NEW_HELPER) == 1:
    print("helper: already applied")
else:
    assert text.count(OLD_HELPER) == 1, f"helper anchor: {text.count(OLD_HELPER)}"
    text = text.replace(OLD_HELPER, NEW_HELPER)
    print("helper: applied")

REPLACEMENTS = [
    (
        """    const anyoneAt30 = r.lines.some(
      (l) => Math.abs(savedPercent(l.regularPriceMinorUnits, l.unitPriceMinorUnits) - 30) < 0.001,
    );
    expect(anyoneAt30).toBe(true);""",
        """    const anyoneAt30 = r.lines.some((l) =>
      receivedAtLeast(l.regularPriceMinorUnits, l.unitPriceMinorUnits, 30),
    );
    expect(anyoneAt30).toBe(true);""",
    ),
    (
        """      const anyoneAt30 = r.lines.some(
        (l) => Math.abs(savedPercent(l.regularPriceMinorUnits, l.unitPriceMinorUnits) - 30) < 0.001,
      );
      if (!anyoneAt30) missing += 1;""",
        """      const anyoneAt30 = r.lines.some((l) =>
        receivedAtLeast(l.regularPriceMinorUnits, l.unitPriceMinorUnits, 30),
      );
      if (!anyoneAt30) missing += 1;""",
    ),
    (
        """    expect(savedPercent(4000, by("mid").unitPriceMinorUnits)).toBeCloseTo(30, 5);""",
        """    expect(receivedAtLeast(4000, by("mid").unitPriceMinorUnits, 30)).toBe(true);""",
    ),
]

for i, (old, new) in enumerate(REPLACEMENTS, start=1):
    if text.count(new) == 1:
        print(f"REPLACEMENT {i}: already applied")
        continue
    assert text.count(old) == 1, f"REPLACEMENT {i} anchor: {text.count(old)} copies"
    text = text.replace(old, new)
    print(f"REPLACEMENT {i}: applied")

if text == orig:
    print("no changes needed")
    sys.exit(0)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(text)
with io.open(PATH, encoding="utf-8") as f:
    disk = f.read()
assert disk.count(NEW_HELPER) == 1, "read-back helper failed"
for i, (_, new) in enumerate(REPLACEMENTS, start=1):
    assert disk.count(new) == 1, f"read-back REPLACEMENT {i} failed"
print("VERIFIED on disk")
