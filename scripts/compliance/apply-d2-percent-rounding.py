#!/usr/bin/env python3
"""
SLICE D2 (part 3) - round the PERCENT discount in the customer's favour too.

Found while writing the Wax Wednesday tests: a $2.37 cartridge advertised at
20% off was paying 19.83%. Not a Wednesday bug - this is every flat-percent
deal, every day of the week.

    const unit = clampEngineUnit(line, round(line.regularPriceMinorUnits * (1 - p / 100)));

Math.round() is applied to the PRICE. Rounding a price UP rounds the DISCOUNT
DOWN, so any half-cent lands with the store. Measured across every price from
$1.00 to $200.00 at 15/20/25/30% (79,604 combinations):

    exact                    15.0%
    over-delivered           37.9%
    UNDER-delivered          47.1%   worst 0.5c   <- the customer loses
    under-delivered with Math.floor on the price: 0

Math.floor on the unit price makes the discount round UP every time, which is
what the owner asked for:

    "if it can't be exact, then we need to round in the customers favor
     somehow... I'm fine with giving the customer the benefit of the doubt so we
     can honor discounts as advertised."

Cost: at most 1 cent per line, and only on lines that do not divide evenly.
clampEngineUnit still applies afterwards, so the statutory and cost floors are
untouched - the floor still outranks the advert.

This is the SAME correction already made for N-for-M apportionment in D1;
applying it here makes the rounding policy consistent across the whole engine
instead of exact in one mechanic and store-favoured in the rest.
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENGINE = os.path.join(REPO, "src/lib/promotions/discount-engine-core.ts")
CART = os.path.join(REPO, "src/lib/specials/cart-discount.ts")

EDITS = []

EDITS.append((
    ENGINE,
    "  const unit = clampEngineUnit(line, round(line.regularPriceMinorUnits * (1 - p / 100)));",
    """  // SLICE D2: FLOOR the discounted price, do not round it. Math.round() on the
  // PRICE rounds the DISCOUNT down, handing every half-cent to the store -
  // measured at 47.1% of all price/percent combinations under-delivering by up
  // to 0.5c. Flooring the price rounds the discount UP instead, so the
  // advertised rate is always met or beaten. Owner: "if it can't be exact, then
  // we need to round in the customers favor somehow." clampEngineUnit still
  // enforces the statutory and cost floors afterwards.
  const unit = clampEngineUnit(line, Math.floor(line.regularPriceMinorUnits * (1 - p / 100)));""",
    "engine: percent rounds to the customer",
))

EDITS.append((
    CART,
    "  const raw = round(line.regularPriceMinorUnits * (1 - cappedPercent / 100));",
    """  // SLICE D2: FLOOR, not round - the website cart holds its own copy of this
  // arithmetic and must match the register exactly. Rounding the PRICE rounds
  // the DISCOUNT down and gives the half-cent to the store; flooring the price
  // rounds the discount up, in the customer's favour. clampLineUnit still
  // enforces the statutory and cost floors below.
  const raw = Math.floor(line.regularPriceMinorUnits * (1 - cappedPercent / 100));""",
    "cart: percent rounds to the customer",
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
    # The website cart has its own percent maths; locate and correct it too.
    with open(CART, "r", encoding="utf-8") as f:
        cart = f.read()
    import re
    hits = re.findall(r".*Math\.round\(.*1 - .*/ 100.*", cart)
    print("cart percent-rounding sites found:", len(hits))
    for h in hits:
        print("   ", h.strip())

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
    assert "round(line.regularPriceMinorUnits * (1 - p / 100))" not in eng, (
        "the store-favoured percent rounding survived"
    )
    assert eng.count("Math.floor(line.regularPriceMinorUnits * (1 - p / 100))") == 1, (
        "the customer-favoured rounding is not present"
    )

    with open(CART, "r", encoding="utf-8") as f:
        cart2 = f.read()
    assert "round(line.regularPriceMinorUnits * (1 - cappedPercent / 100))" not in cart2 or (
        "Math.floor(line.regularPriceMinorUnits * (1 - cappedPercent / 100))" in cart2
    ), "the website cart still rounds against the customer"
    assert cart2.count("Math.floor(line.regularPriceMinorUnits * (1 - cappedPercent / 100))") == 1, (
        "the website cart was not corrected"
    )
    print("Verified on disk.")


if __name__ == "__main__":
    main()
