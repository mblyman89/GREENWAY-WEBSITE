#!/usr/bin/env python3
"""SLICE W1b -- resolve the now-unused STATUTORY_GRAMS_PER_OUNCE imports.

After W1 delegated all three parsers, `STATUTORY_GRAMS_PER_OUNCE` became unused
in each of them (verified by grep: import line only, no reference). Two
different resolutions, chosen per file on merit rather than uniformly:

 - discount-engine-core.ts / cart-discount.ts: the constant is genuinely no
   longer this layer's concern -- weight-label-core owns the equivalence now.
   DELETE the dead import.

 - variant-grams-core.ts: this file feeds WAC 314-55-095 enforcement, so the
   28 g statutory basis is worth PINNING at this layer too. Keep the import and
   spend it on a real self-test assertion, so that if anyone ever changes the
   shared parser's ounce basis, this compliance-facing module fails as well
   (defense in depth, not a decorative import). This also corrects a comment
   W1 left behind that claimed the import was already used by the self-tests --
   it was not, and a false comment is worse than none.
"""
import io

ENGINE = "src/lib/promotions/discount-engine-core.ts"
CART = "src/lib/specials/cart-discount.ts"
VARIANT = "src/lib/pos/variant-grams-core.ts"


def edit(path: str, old: str, new: str, label: str) -> None:
    with io.open(path, encoding="utf-8") as f:
        text = f.read()
    if text.count(new) == 1:
        print(f"  = already applied: {label}")
        return
    n = text.count(old)
    assert n == 1, f"{label}: expected 1 anchor in {path}, found {n}"
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(text.replace(old, new, 1))
    with io.open(path, encoding="utf-8") as f:
        assert f.read().count(new) == 1, f"{label}: write did not land"
    print(f"  + applied: {label}")


def assert_unused(path: str, symbol: str) -> None:
    """Prove the symbol appears ONLY on its import line before deleting it."""
    with io.open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    uses = [
        ln
        for ln in lines
        if symbol in ln
        and not ln.lstrip().startswith(("import", "*", "//", "/*"))
    ]
    assert not uses, f"{path}: {symbol} still used, refusing to delete: {uses}"
    print(f"  ok  {path}: {symbol} proven unused")


print("SLICE W1b -- dead imports and one false comment")

# --- 1. Prove, then delete, the two dead imports. -------------------------
assert_unused(ENGINE, "STATUTORY_GRAMS_PER_OUNCE")
edit(
    ENGINE,
    'import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";\n'
    "// SLICE W1: the ONE weight-label parse, shared with the WAC limit engine.\n"
    'import { parseWeightLabelGrams } from "@/lib/compliance/weight-label-core";',
    "// SLICE W1: the ONE weight-label parse, shared with the WAC limit engine.\n"
    "// (STATUTORY_GRAMS_PER_OUNCE is no longer imported here -- the ounce\n"
    "// equivalence now lives with the parse, in weight-label-core.)\n"
    'import { parseWeightLabelGrams } from "@/lib/compliance/weight-label-core";',
    "engine: drop dead grams-per-ounce import",
)

assert_unused(CART, "STATUTORY_GRAMS_PER_OUNCE")
edit(
    CART,
    'import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";\n'
    "// SLICE W1: the ONE weight-label parse, shared with the WAC limit engine.\n"
    'import { parseWeightLabelGrams } from "@/lib/compliance/weight-label-core";',
    "// SLICE W1: the ONE weight-label parse, shared with the WAC limit engine.\n"
    "// (STATUTORY_GRAMS_PER_OUNCE is no longer imported here -- the ounce\n"
    "// equivalence now lives with the parse, in weight-label-core.)\n"
    'import { parseWeightLabelGrams } from "@/lib/compliance/weight-label-core";',
    "cart: drop dead grams-per-ounce import",
)

# --- 2. Correct the false comment in variant-grams-core. ------------------
edit(
    VARIANT,
    "// SLICE W1: the shared parse. GRAMS_PER_OUNCE is still imported below for the\n"
    "// self-tests that pin the statutory equivalence at this layer.\n",
    "// SLICE W1: the shared parse. GRAMS_PER_OUNCE is retained and SPENT on the\n"
    "// self-test assertions at the bottom of this file, which pin the 28 g\n"
    "// statutory basis at this compliance-facing layer as well as inside the\n"
    "// shared parser -- so changing the basis breaks BOTH, not just one.\n",
    "variant: correct the import comment",
)

# --- 3. Make the retained import real. ------------------------------------
edit(
    VARIANT,
    '  ok(gramsFromVariantLabel("1oz") === 28, "1oz \u2192 28 (statute equivalence)");',
    '  ok(gramsFromVariantLabel("1oz") === 28, "1oz \u2192 28 (statute equivalence)");\n'
    "  // SLICE W1: assert against the NAMED constant too, not just the literal, so\n"
    "  // a change to the statutory basis cannot pass here by editing one number.\n"
    '  ok(gramsFromVariantLabel("1oz") === GRAMS_PER_OUNCE, "1oz \u2192 STATUTORY_GRAMS_PER_OUNCE");\n'
    '  ok(gramsFromVariantLabel("2oz") === 2 * GRAMS_PER_OUNCE, "2oz \u2192 2x the statutory ounce");\n'
    "  // SLICE W1: fractions are exact arithmetic on the statutory ounce.\n"
    '  ok(gramsFromVariantLabel("1/8 oz") === GRAMS_PER_OUNCE / 8, "1/8 oz \u2192 an EIGHTH (was 224 g in the discount parser)");\n'
    '  ok(gramsFromVariantLabel("1/4 oz") === GRAMS_PER_OUNCE / 4, "1/4 oz \u2192 a quarter");\n'
    '  ok(gramsFromVariantLabel("28 grams") === 28, "spelled-out grams (was 0 g in the discount parser)");',
    "variant: spend the retained import on real assertions",
)

print("\nW1b done.")
