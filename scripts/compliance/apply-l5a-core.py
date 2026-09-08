#!/usr/bin/env python3
"""
L5a step 1 — add the shared per-unit volume RESOLVER to the pure core.

WHY: three call sites independently wrote
    item.netVolumeMl ?? volumeMlFromLabel(variant.label)
which prefers the CARD-level measured volume over the VARIANT label. Because
groupingIdentity() excludes package size, ONE card can carry 750 ml and 1.5 L
variants while netVolumeMl is taken from `firstAvailable` alone. Buying the
1.5 L variant then measured 750 ml -- a 50% UNDER-count of a compliance limit.

Idempotent: re-running is a no-op. Asserts exactly one anchor match and reads
the file back off disk to prove the edit landed.
"""
import io
import sys

PATH = "src/lib/compliance/liquid-volume-core.ts"

ANCHOR = """/** Render millilitres for a human, with the fluid-ounce equivalent. */"""

ADDITION = '''/**
 * Resolve the per-UNIT millilitres for one sellable variant, from the two
 * sources the system actually has.
 *
 * PRECEDENCE IS THE WHOLE POINT, and it is the opposite of the obvious one.
 *
 * `variantLabel` describes THE THING BEING SOLD ("1.5L"). `cardNetVolumeMl` is
 * the menu CARD's measured net volume, and a card is a GROUP of variants:
 * src/lib/pos/transform.ts `groupingIdentity()` keys on brand + category +
 * strain + medical and DELIBERATELY omits package size, so one card routinely
 * holds a 750 ml and a 1.5 L lot. That card's netVolumeMl is taken from
 * `firstAvailable` -- the first variant WITH STOCK -- so it describes only one
 * of them. Preferring it would measure a 1.5 L bottle as 750 ml and let a
 * shopper buy 2 (3000 ml) against a 2129.292 ml cap while the meter read
 * "1500 ml, fine". Verified by probe before this function existed.
 *
 * So: an explicit, parsed VARIANT label wins. The card measure is the fallback
 * that covers the case the label cannot -- `transform.ts` maps the package
 * label "each" to the EMPTY STRING, and mg/pack labels ("100mg", "4pk") carry
 * no volume at all, which is precisely when the measured intake figure is the
 * only truth available.
 *
 * Returns null when NEITHER source knows. null means UNKNOWN, never zero, so
 * the caller can fall back to the weight-carried basis instead of reading an
 * unmeasured bottle as free of the limit. No density is ever assumed.
 */
export function resolveUnitVolumeMl(
  variantLabel: string | null | undefined,
  cardNetVolumeMl: number | null | undefined,
): number | null {
  const fromLabel = volumeMlFromLabel(variantLabel);
  if (fromLabel !== null) return fromLabel;
  if (
    typeof cardNetVolumeMl === "number" &&
    Number.isFinite(cardNetVolumeMl) &&
    cardNetVolumeMl > 0
  ) {
    return cardNetVolumeMl;
  }
  return null;
}

'''

TEST_ANCHOR = """  // --- volumeMlFromLabel: MUST return null (no invented densities) --------"""

TEST_ADDITION = '''  // --- resolveUnitVolumeMl: the VARIANT label outranks the CARD measure ---
  // The regression this exists to stop: one card holds 750 ml and 1.5 L lots
  // (groupingIdentity omits package size) and its netVolumeMl comes from
  // firstAvailable, so card-first measured a 1.5 L bottle as 750 ml.
  near(resolveUnitVolumeMl("1.5L", 750), 1500, "variant label BEATS the card measure");
  near(resolveUnitVolumeMl("750ml", 1500), 750, "...and in the other direction too");
  near(resolveUnitVolumeMl("12 fl oz", 750), 354.882, "fl oz label beats card measure");
  // The fallback that earns the card measure its place: labels that carry no
  // volume at all. transform.ts maps the package label "each" -> "".
  near(resolveUnitVolumeMl("", 750), 750, 'empty label ("each") falls back to the card');
  near(resolveUnitVolumeMl("100mg", 750), 750, "mg-dosed label falls back to the card");
  near(resolveUnitVolumeMl("4pk", 750), 750, "pack label falls back to the card");
  near(resolveUnitVolumeMl("12oz", 750), 750, "bare-ounce label falls back to the card");
  near(resolveUnitVolumeMl(null, 750), 750, "null label falls back to the card");
  near(resolveUnitVolumeMl(undefined, 750), 750, "undefined label falls back to the card");
  // UNKNOWN stays unknown -- never 0, which would read as "free of the limit".
  ok(resolveUnitVolumeMl("", null) === null, "no label + no card measure -> null");
  ok(resolveUnitVolumeMl("100mg", undefined) === null, "no volume anywhere -> null");
  ok(resolveUnitVolumeMl("", 0) === null, "card measure of 0 is not a size -> null");
  ok(resolveUnitVolumeMl("", -5) === null, "negative card measure -> null");
  ok(resolveUnitVolumeMl("", Number.NaN) === null, "NaN card measure -> null");
  ok(resolveUnitVolumeMl("", Number.POSITIVE_INFINITY) === null, "Infinite card measure -> null");
  // A parsed label wins even when the card measure is junk.
  near(resolveUnitVolumeMl("750ml", Number.NaN), 750, "label wins over a NaN card measure");
  near(resolveUnitVolumeMl("750ml", 0), 750, "label wins over a zero card measure");

'''


def main() -> int:
    src = io.open(PATH, encoding="utf-8").read()

    if "export function resolveUnitVolumeMl" in src:
        print("SKIP: resolveUnitVolumeMl already present")
    else:
        assert src.count(ANCHOR) == 1, f"anchor count = {src.count(ANCHOR)}"
        src = src.replace(ANCHOR, ADDITION + ANCHOR, 1)

    if "variant label BEATS the card measure" in src:
        print("SKIP: self-tests already present")
    else:
        assert src.count(TEST_ANCHOR) == 1, f"test anchor count = {src.count(TEST_ANCHOR)}"
        src = src.replace(TEST_ANCHOR, TEST_ADDITION + TEST_ANCHOR, 1)

    io.open(PATH, "w", encoding="utf-8").write(src)

    # Read BACK off disk -- never trust the in-memory string.
    back = io.open(PATH, encoding="utf-8").read()
    assert back.count("export function resolveUnitVolumeMl") == 1, "function not on disk"
    assert back.count("variant label BEATS the card measure") == 1, "tests not on disk"
    print("OK: resolveUnitVolumeMl + self-tests verified on disk")
    return 0


if __name__ == "__main__":
    sys.exit(main())
