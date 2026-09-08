#!/usr/bin/env python3
"""
SLICE D1 (part 5) - the either/or self-tests encoded the bug as the contract.

Two assertions REQUIRED the customer to receive the worse of two advertised
offers:

    expect("eitherOr equal prices picks flat",  four.totalSavingsMinorUnits === 800);
    expect("eitherOr cheap-unit picks bundle",  mixed.totalSavingsMinorUnits < 1240);

On four $10 prerolls the advertised "4 for the price of 3" is worth $10.00; the
suite demanded $8.00. On 3x$20 + 1x$2 the flat 20% is worth $12.40; the suite
demanded strictly LESS than that. The owner's ruling:

  "if a discount specifically states 4 or more prerolls is 25% off, then its
   25% off, whether the store wants to win or not."
  "'store wins' is more for rounding issues" - it is a ROUNDING rule, not a
  deal-selection rule.

Values below were MEASURED from the corrected engine
(scripts/compliance/probe-eitheror.ts):
    qty1        -> unit 800, savings 200   (unchanged; only flat qualifies)
    4 x $10     -> savings 1000            (was 800)
    3x$20+1x$2  -> savings 1240            (was 200)
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENGINE = os.path.join(REPO, "src/lib/promotions/discount-engine-core.ts")

OLD = '''  // EITHER/OR (Doobie Tuesday): 20% flat OR 4-for-3, the SMALLER savings wins.
  {'''
NEW = '''  // EITHER/OR (SLICE D1): 20% flat OR 4-for-3 \u2014 the option BETTER FOR THE
  // CUSTOMER wins. These assertions previously required the WORSE option and
  // so encoded the defect as the contract: four $10 prerolls returned $8.00
  // when the advertised "4 for the price of 3" is worth $10.00.
  {'''

OLD2 = '''    // 4 equal $10 prerolls: flat 20% saves $8; 4-for-3 saves $10 \u2192 flat (store wins).
    const four = computePromotions(
      [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: 4, categories: ["preroll"] }],
      [rule],
    );
    expect("eitherOr equal prices picks flat", four.totalSavingsMinorUnits === 800);'''
NEW2 = '''    // 4 equal $10 prerolls: flat 20% saves $8; 4-for-3 saves $10 \u2192 the BUNDLE,
    // because that is what the sign in the window promises.
    const four = computePromotions(
      [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: 4, categories: ["preroll"] }],
      [rule],
    );
    expect("eitherOr picks the better option for the customer", four.totalSavingsMinorUnits === 1000);
    expect("eitherOr never delivers less than the flat rate", four.totalSavingsMinorUnits >= 800);'''

OLD3 = '''    // 3 \u00d7 $20 + 1 \u00d7 $2: flat saves $12.40; bundle saves $2 (cheapest) \u2192 bundle.
    const mixed = computePromotions(
      [
        { lineId: "a", regularPriceMinorUnits: 2000, quantity: 3, categories: ["preroll"] },
        { lineId: "b", regularPriceMinorUnits: 200, quantity: 1, categories: ["preroll"] },
      ],
      [rule],
    );
    // Bundle: target $2 of $62 \u2192 floor(3.22%) = 3% spread: a\u21921940 (\u00d73), b\u2192194.
    expect("eitherOr cheap-unit picks bundle", mixed.totalSavingsMinorUnits < 1240);'''
NEW3 = '''    // 3 \u00d7 $20 + 1 \u00d7 $2: flat saves $12.40; the bundle's free unit is the $2 one,
    // so the bundle is worth only $2 \u2192 the FLAT rate wins. The old assertion
    // demanded strictly less than $12.40, i.e. it required the $2 outcome.
    const mixed = computePromotions(
      [
        { lineId: "a", regularPriceMinorUnits: 2000, quantity: 3, categories: ["preroll"] },
        { lineId: "b", regularPriceMinorUnits: 200, quantity: 1, categories: ["preroll"] },
      ],
      [rule],
    );
    expect("eitherOr keeps the flat rate when the bundle is worth less", mixed.totalSavingsMinorUnits === 1240);
    expect("eitherOr never picks the weaker offer", mixed.totalSavingsMinorUnits >= 200);'''

EDITS = [
    (OLD, NEW, "eitherOr: header comment"),
    (OLD2, NEW2, "eitherOr: equal prices picks the bundle"),
    (OLD3, NEW3, "eitherOr: cheap unit keeps the flat rate"),
]


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
    for old, new, label in EDITS:
        text = edit(text, old, new, label)
    if text != original:
        with open(ENGINE, "w", encoding="utf-8") as f:
            f.write(text)

    with open(ENGINE, "r", encoding="utf-8") as f:
        disk = f.read()
    assert disk == text, "disk mismatch"
    assert "the SMALLER savings wins" not in disk, "the stale either/or comment survived"
    assert 'expect("eitherOr equal prices picks flat"' not in disk, "the 800 pin survived"
    assert 'expect("eitherOr cheap-unit picks bundle"' not in disk, "the < 1240 pin survived"
    print("Verified on disk.")


if __name__ == "__main__":
    main()
