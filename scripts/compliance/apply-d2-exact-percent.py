#!/usr/bin/env python3
"""
SLICE D2 (part 4) - compute the percent discount with EXACT integer maths.

The D2 test "never generous by more than a single cent per unit" failed on
$1.70 at 30%, and it was right to:

    170 * (1 - 30/100)  ===  118.99999999999999      (not 119)
    Math.floor(...)     ===  118  ->  52c off, when 51c is correct

`1 - 30/100` is not representable in binary floating point, so flooring the
PRICE occasionally drops a whole extra cent. Harmless to a customer, but it
means the engine is not deterministic in the way the till and the receipt need,
and "we round in the customer's favour" quietly became "we sometimes round two
cents in the customer's favour".

The fix is to stop deriving the discount from a floating-point price at all:

    off  = Math.ceil((price * percent) / 100)   // integers until the divide
    unit = price - off

price * percent is an exact integer product (both are integers, and the values
here are far below 2^53), so the single division is the only rounding step and
Math.ceil sends it in the customer's direction by design. This is both EXACT and
customer-favoured, and it makes the one-cent bound a real guarantee rather than
an observation.

Same change in both implementations - the engine and the website cart's
independent copy - so the two cannot disagree at the till.
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENGINE = os.path.join(REPO, "src/lib/promotions/discount-engine-core.ts")
CART = os.path.join(REPO, "src/lib/specials/cart-discount.ts")

EDITS = []

EDITS.append((
    ENGINE,
    """  // SLICE D2: FLOOR the discounted price, do not round it. Math.round() on the
  // PRICE rounds the DISCOUNT down, handing every half-cent to the store -
  // measured at 47.1% of all price/percent combinations under-delivering by up
  // to 0.5c. Flooring the price rounds the discount UP instead, so the
  // advertised rate is always met or beaten. Owner: "if it can't be exact, then
  // we need to round in the customers favor somehow." clampEngineUnit still
  // enforces the statutory and cost floors afterwards.
  const unit = clampEngineUnit(line, Math.floor(line.regularPriceMinorUnits * (1 - p / 100)));""",
    """  // SLICE D2: derive the DISCOUNT with exact integer maths, then subtract.
  //
  // Math.round() on the PRICE (the original) rounded the DISCOUNT down and
  // handed the half-cent to the store - measured at 47.1% of all price/percent
  // combinations under-delivering by up to 0.5c. Owner: "if it can't be exact,
  // then we need to round in the customers favor somehow."
  //
  // Flooring the price is not enough either: 170 * (1 - 30/100) is
  // 118.99999999999999 in IEEE 754, so the floor drops an extra cent. Here
  // price * percent is an exact integer product and the single division is the
  // only rounding step, sent the customer's way by Math.ceil. Exact AND
  // customer-favoured, never more than one cent above the advertised rate.
  const off = Math.ceil((line.regularPriceMinorUnits * p) / 100);
  const unit = clampEngineUnit(line, line.regularPriceMinorUnits - off);""",
    "engine: exact integer percent",
))

EDITS.append((
    CART,
    """  // SLICE D2: FLOOR, not round - the website cart holds its own copy of this
  // arithmetic and must match the register exactly. Rounding the PRICE rounds
  // the DISCOUNT down and gives the half-cent to the store; flooring the price
  // rounds the discount up, in the customer's favour. clampLineUnit still
  // enforces the statutory and cost floors below.
  const raw = Math.floor(line.regularPriceMinorUnits * (1 - cappedPercent / 100));""",
    """  // SLICE D2: exact integer maths, matching discount-engine-core.ts exactly -
  // the website cart holds its own copy of this arithmetic and a one-cent
  // disagreement with the till is a customer-service problem every time.
  // price * percent is an exact integer product; the single division is the
  // only rounding step and Math.ceil sends it the customer's way.
  const raw = line.regularPriceMinorUnits - Math.ceil((line.regularPriceMinorUnits * cappedPercent) / 100);""",
    "cart: exact integer percent",
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
    by_file = {}
    for path, old, new, label in EDITS:
        by_file.setdefault(path, []).append((old, new, label))

    for path, edits in by_file.items():
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        original = text
        for old, new, label in edits:
            text = edit(text, old, new, label)
        if text != original:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
        with open(path, "r", encoding="utf-8") as f:
            assert f.read() == text, f"{path}: disk mismatch"

    with open(ENGINE, "r", encoding="utf-8") as f:
        eng = f.read()
    assert "(1 - p / 100)" not in eng, "the float-derived price survived in the engine"
    assert eng.count("Math.ceil((line.regularPriceMinorUnits * p) / 100)") == 1, (
        "the exact integer discount is not present in the engine"
    )

    with open(CART, "r", encoding="utf-8") as f:
        cart = f.read()
    assert "(1 - cappedPercent / 100)" not in cart, "the float-derived price survived in the cart"
    assert cart.count("Math.ceil((line.regularPriceMinorUnits * cappedPercent) / 100)") == 1, (
        "the exact integer discount is not present in the cart"
    )
    print("Verified on disk.")


if __name__ == "__main__":
    main()
