#!/usr/bin/env python3
"""
apply-d2-nudge-tests.py  (SLICE D2, part 9)

Corrects the three tier-nudge tests that pin pre-D1/D2 behaviour. All numbers
MEASURED with scripts/compliance/probe-stale6.ts.

  1/2. Wax Wednesday nudges pointed at the $50 / $100 rungs. Those rungs no
       longer exist (owner: "the deal is 20% off or 30% off over 150 dollars.
       Not the ladder"), so the only thing left to unlock is 30% at $150.
  3.   "Doobie Tuesday (either/or) NEVER nudges" pinned estimator-core's
       `if (rule.config.eitherOr) continue;` skip. That skip existed because
       the either/or mechanic took the SMALLER savings, so telling a customer
       "add 1 more preroll" could have LOWERED their discount -- the nudge
       would have been a lie. D1 removed the inverted selection, so Tuesday now
       has a real, honest tier to unlock: 3 prerolls -> add 1 -> 25% off.
"""

import sys

PATH = "tests/compliance/cart-estimator-core.test.ts"

with open(PATH, encoding="utf-8") as fh:
    original = fh.read()
text = original

EDITS: list[tuple[str, str, str]] = [
    (
        "WED $40 -> unlock 30% at $150",
        """  it("Wax Wednesday: $40 of eligible concentrate \u2192 add $10.00 to unlock 15%", () => {
    const rules = activeSnapshotsFor(SEEDS, "wednesday", WHEN);
    const nudges = tierNudges(
      [engineLine({ categories: ["concentrate"], regularPriceMinorUnits: 4000, variantLabel: "1g" })],
      rules,
    );
    expect(nudges).toHaveLength(1);
    expect(nudges[0].kind).toBe("spend");
    expect(nudges[0].addLabel).toBe("$10.00");
    expect(nudges[0].unlockLabel).toBe("15% off");
  });""",
        """  it("Wax Wednesday: $40 of eligible concentrate \u2192 add $110.00 to unlock 30% (SLICE D2)", () => {
    // SLICE D2: the $50 (15%) and $100 (20%) rungs are GONE \u2014 the deal is
    // "20% off, or 30% off over $150". The $40 concentrate ALREADY has its 20%,
    // so the only thing left to unlock is the 30% tier at $150.
    const rules = activeSnapshotsFor(SEEDS, "wednesday", WHEN);
    const nudges = tierNudges(
      [engineLine({ categories: ["concentrate"], regularPriceMinorUnits: 4000, variantLabel: "1g" })],
      rules,
    );
    expect(nudges).toHaveLength(1);
    expect(nudges[0].kind).toBe("spend");
    expect(nudges[0].addLabel).toBe("$110.00"); // 15000 - 4000
    expect(nudges[0].unlockLabel).toBe("30% off");
    // The nudge never over-promises: 10 extra points on the CURRENT $40 basket.
    expect(nudges[0].estAdditionalSavingsMinor).toBe(400);
  });""",
    ),
    (
        "WED regular-price parity -> $150 tier",
        """  it("spend nudges qualify on REGULAR prices (engine parity)", () => {
    const rules = activeSnapshotsFor(SEEDS, "wednesday", WHEN);
    // Regular $50 exactly \u2192 already at the 15% tier; next nudge is the $100 tier.
    const nudges = tierNudges(
      [engineLine({ categories: ["cartridge"], regularPriceMinorUnits: 5000, variantLabel: "1g" })],
      rules,
    );
    expect(nudges).toHaveLength(1);
    expect(nudges[0].addLabel).toBe("$50.00");
    expect(nudges[0].unlockLabel).toBe("20% off");
  });""",
        """  it("spend nudges qualify on REGULAR prices (engine parity)", () => {
    const rules = activeSnapshotsFor(SEEDS, "wednesday", WHEN);
    // Regular $50 \u2192 already has the universal 20%; the only tier left is 30%
    // at $150, so the nudge asks for the remaining $100.00 of REGULAR price.
    const nudges = tierNudges(
      [engineLine({ categories: ["cartridge"], regularPriceMinorUnits: 5000, variantLabel: "1g" })],
      rules,
    );
    expect(nudges).toHaveLength(1);
    expect(nudges[0].addLabel).toBe("$100.00"); // 15000 - 5000
    expect(nudges[0].unlockLabel).toBe("30% off");
    // A basket already AT the top tier has nothing left to unlock.
    expect(
      tierNudges(
        [engineLine({ categories: ["cartridge"], regularPriceMinorUnits: 15000, variantLabel: "1g" })],
        rules,
      ),
    ).toHaveLength(0);
  });""",
    ),
    (
        "TUE now nudges honestly",
        """  it("Doobie Tuesday (either/or) NEVER nudges \u2014 the engine takes the smaller savings", () => {
    const rules = activeSnapshotsFor(SEEDS, "tuesday", WHEN);
    const nudges = tierNudges(
      [engineLine({ categories: ["preroll"], quantity: 3, regularPriceMinorUnits: 1000 })],
      rules,
    );
    expect(nudges).toHaveLength(0);
  });""",
        """  it("Doobie Tuesday NOW nudges honestly: 3 prerolls \u2192 add 1 \u2192 25% off (SLICE D1)", () => {
    // WHY THIS FLIPPED: estimator-core used to skip either/or rules outright
    // (`if (rule.config.eitherOr) continue;`) because that mechanic took the
    // SMALLER of the two savings \u2014 so "add one more preroll" could have
    // LOWERED the customer's discount, making the nudge a lie. D1 removed the
    // inverted selection and replaced the either/or with real qty tiers
    // (1\u20133 = 20%, 4+ = 25%), so the nudge is now true: the 4th preroll really
    // does move the whole basket to the advertised 25%.
    const rules = activeSnapshotsFor(SEEDS, "tuesday", WHEN);
    const nudges = tierNudges(
      [engineLine({ categories: ["preroll"], quantity: 3, regularPriceMinorUnits: 1000 })],
      rules,
    );
    expect(nudges).toHaveLength(1);
    expect(nudges[0].kind).toBe("qty");
    expect(nudges[0].addLabel).toBe("1 more item");
    expect(nudges[0].unlockLabel).toBe("25% off");
    // 5 extra points on the current $30 of prerolls \u2014 never over-promised.
    expect(nudges[0].estAdditionalSavingsMinor).toBe(150);
    // At 4+ units the basket is already at the top tier: nothing to unlock.
    expect(
      tierNudges(
        [engineLine({ categories: ["preroll"], quantity: 4, regularPriceMinorUnits: 1000 })],
        rules,
      ),
    ).toHaveLength(0);
  });""",
    ),
]

for name, old, new in EDITS:
    if text.count(new) == 1:
        print(f"{name}: already applied")
        continue
    n = text.count(old)
    assert n == 1, f"{name}: found {n} copies of OLD (expected 1)"
    text = text.replace(old, new)
    print(f"{name}: applied")

if text != original:
    with open(PATH, "w", encoding="utf-8") as fh:
        fh.write(text)

with open(PATH, encoding="utf-8") as fh:
    disk = fh.read()
for name, _old, new in EDITS:
    assert disk.count(new) == 1, f"{name}: NOT on disk after write"
print(f"VERIFIED {len(EDITS)} edit(s) on disk")
sys.exit(0)
