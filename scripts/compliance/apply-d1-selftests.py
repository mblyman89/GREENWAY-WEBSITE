#!/usr/bin/env python3
"""
SLICE D1 (part 4) - correct the engine self-tests that PINNED the shortfall.

These assertions did not merely tolerate the bug, they REQUIRED it:

    expect("basket 3for2 spread percent", r.lines[0].appliedPercent === 33);
    expect("basket 3for2 savings",        r.totalSavingsMinorUnits === 990);

A true 3-for-2 on three $10 items is $10.00 of savings. The suite demanded
$9.90 and would have failed the fix. Every replacement value below was MEASURED
from the corrected engine (scripts/compliance/probe-d1-selftest.ts), not
predicted, and each is checked against the arithmetic it should satisfy.

Measured, post-fix:
  A  1000 x3            -> savings 1002, unit 666   (target 1000 unreachable at
                           qty 3; 1002 is the nearest reachable value ABOVE it,
                           i.e. rounded in the CUSTOMER's favour, per the owner)
  B  15000/2000/1500    -> savings 1500 EXACTLY (was short)
  C  3000 x2 + 900      -> savings 900 EXACTLY   (was floor 13% = short)
  E  1000 x3 cost 500   -> unit 732, savings 804 (cost floor still clamps)

Note the deliberate asymmetry in the new assertions: savings are pinned with
>= target where the target is reachable-with-overshoot, and the OVERSHOOT is
separately bounded, so a future regression that silently under-delivers fails
loudly while a legitimate one-cent customer-favour rounding does not.
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENGINE = os.path.join(REPO, "src/lib/promotions/discount-engine-core.ts")

EDITS = []

# ---------------------------------------------------------------- case A
EDITS.append((
    ENGINE,
    '''    const r = computePromotions(lines, [rule]);
    // Target savings 1000 of 3000 \u2192 33% spread \u2192 unit 670 \u2192 savings 990.
    expect("basket 3for2 spread percent", r.lines[0].appliedPercent === 33);
    expect("basket 3for2 savings", r.totalSavingsMinorUnits === 990);
    expect("basket 3for2 unit never $0", r.lines[0].unitPriceMinorUnits > 0);''',
    '''    const r = computePromotions(lines, [rule]);
    // SLICE D1: a true 3-for-2 on three $10 items is $10.00 of savings. The old
    // assertion PINNED $9.90 (a floored 33% spread) and would have failed this
    // fix. One line of quantity 3 can only move in 3-cent steps, so $10.00 is
    // not reachable; the engine rounds to the nearest reachable value ABOVE the
    // target ($10.02) so the customer is never short-changed, per the owner:
    // "if it can't be exact, then we need to round in the customers favor".
    expect("basket 3for2 never under-delivers", r.totalSavingsMinorUnits >= 1000);
    expect("basket 3for2 overshoot is minimal", r.totalSavingsMinorUnits - 1000 < 3);
    expect("basket 3for2 savings", r.totalSavingsMinorUnits === 1002);
    expect("basket 3for2 unit never $0", r.lines[0].unitPriceMinorUnits > 0);''',
    "selftest A: 3for2 no longer pins 990",
))

# ---------------------------------------------------------------- case B
EDITS.append((
    ENGINE,
    '''    expect("owner Sunday example: savings \u2264 $15", r.totalSavingsMinorUnits <= 1500);
    expect("owner Sunday example: some savings applied", r.totalSavingsMinorUnits > 0);''',
    '''    expect("owner Sunday example: savings \u2264 $15", r.totalSavingsMinorUnits <= 1500);
    expect("owner Sunday example: some savings applied", r.totalSavingsMinorUnits > 0);
    // SLICE D1: it is now EXACTLY $15.00, not merely "\u2264 and > 0". The owner:
    // "Sunday needs to be exact." Previously the floored percent delivered
    // less than the advertised cheapest-item value.
    expect("owner Sunday example: exactly $15", r.totalSavingsMinorUnits === 1500);''',
    "selftest B: Sunday is exact",
))

# ---------------------------------------------------------------- case C
EDITS.append((
    ENGINE,
    '''    const r = computePromotions(lines, [rule]);
    // Target 900 of 6900 \u2192 floor(13.04) = 13% on every line.
    expect("3for2 spread hits every line", r.lines.every((l) => l.unitSavingsMinorUnits > 0));
    expect("3for2 store-advantaged floor pct", r.lines[0].appliedPercent === 13);''',
    '''    const r = computePromotions(lines, [rule]);
    // SLICE D1: the advertised value is the cheapest unit ($9.00) and the
    // customer now receives all of it. The old assertion locked in
    // floor(13.04%) = 13%, which quietly delivered less than the advert.
    expect("3for2 spread hits every line", r.lines.every((l) => l.unitSavingsMinorUnits > 0));
    expect("3for2 delivers the advertised cheapest unit", r.totalSavingsMinorUnits === 900);''',
    "selftest C: exact cheapest-unit value",
))

# ---------------------------------------------------------------- case E
EDITS.append((
    ENGINE,
    '''    const r = computePromotions(lines, [rule]);
    // Floor = ceil(500 \u00d7 1.463) = 732 > 670 spread price \u2192 clamped to 732.
    expect("3for2 cost floor clamps", r.lines[0].unitPriceMinorUnits === 732);''',
    '''    const r = computePromotions(lines, [rule]);
    // Floor = ceil(500 \u00d7 1.463) = 732 \u2192 the spread price is clamped up to it.
    // The cost floor OUTRANKS the advertised target: we may legally deliver
    // less than the advert rather than sell below acquisition cost
    // (RCW 69.50.357). Savings are therefore 804, not the 1000 target.
    expect("3for2 cost floor clamps", r.lines[0].unitPriceMinorUnits === 732);
    expect("3for2 cost floor outranks the target", r.totalSavingsMinorUnits === 804);
    expect("3for2 cost floor never breached", r.lines[0].unitPriceMinorUnits >= 732);''',
    "selftest E: cost floor outranks target",
))


def edit(text, old, new, label):
    if text.count(new) == 1:
        print(f"  {label}: already applied")
        return text
    assert text.count(old) == 1, f"{label}: found {text.count(old)} copies of OLD, expected 1"
    out = text.replace(old, new, 1)
    assert out != text, f"{label}: no-op"
    print(f"  {label}: applied")
    return out


def main():
    with open(ENGINE, "r", encoding="utf-8") as f:
        text = f.read()
    original = text
    for _, old, new, label in EDITS:
        text = edit(text, old, new, label)
    if text != original:
        with open(ENGINE, "w", encoding="utf-8") as f:
            f.write(text)
        with open(ENGINE, "r", encoding="utf-8") as f:
            assert f.read() == text, "engine: disk mismatch"

    with open(ENGINE, "r", encoding="utf-8") as f:
        eng = f.read()
    assert 'expect("basket 3for2 savings", r.totalSavingsMinorUnits === 990)' not in eng, (
        "the 990 shortfall is still pinned"
    )
    assert 'expect("3for2 store-advantaged floor pct"' not in eng, (
        "the floored-percent assertion is still pinned"
    )
    # The BOGO 990 is a different, legitimate number (99% cap) and must remain.
    assert 'expect("bogo savings", r.totalSavingsMinorUnits === 990)' in eng, (
        "the BOGO 99%-cap assertion was removed by mistake"
    )
    print("Verified on disk.")


if __name__ == "__main__":
    main()
