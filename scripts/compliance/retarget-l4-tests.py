#!/usr/bin/env python3
"""
SLICE L4 — retarget the tests that pinned the GRAMS basis for liquid_edible.

RETARGET, NOT WEAKEN. Every assertion below stays exact-equality and keeps (or
gains) a stated reason. Where a number changes, the new number is derived from
the statute independently in the test file (72 fl oz x 29.5735) rather than
copied from the implementation, and the OLD number is kept in a comment with
the arithmetic that connects them, so a future reader can tell a deliberate
rebase from a drifted expectation.
"""
import sys

SL = "tests/compliance/sales-limits.test.ts"
LT = "tests/compliance/low-thc-liquid-limit.test.ts"
EDITS = []


def edit(path, old, new, label):
    EDITS.append((path, old, new, label))


# ── sales-limits.test.ts : the statutory profile assertions ───────────────
edit(
    SL,
    """    expect(RECREATIONAL_LIMITS.liquid_edible).toBe(72 * GRAMS_PER_OUNCE); // 72 oz""",
    """    // SLICE L4 \u2014 REBASED to millilitres. Was `72 * GRAMS_PER_OUNCE` (2016 g).
    // The statute caps this bucket at 72 FLUID ounces, and a volume cap cannot
    // be enforced on a weight basis: ml / fl oz / L labels produced no
    // per-unit weight at all, so every liquid fell back to the 28 g default
    // and 72 packages of ANY size fit (a 1.5 L bottle counted as 1 oz).
    // Derived here from the statute, NOT imported, so this test still fails if
    // the implementation's constant drifts.
    expect(RECREATIONAL_LIMITS.liquid_edible).toBeCloseTo(72 * 29.5735, 6); // 72 fl oz = 2129.292 ml""",
    "SL rec cap",
)

edit(
    SL,
    """    expect(MEDICAL_LIMITS.liquid_edible).toBe(216 * GRAMS_PER_OUNCE); // 216 oz""",
    """    // SLICE L4 \u2014 REBASED. Was `216 * GRAMS_PER_OUNCE` (6048 g).
    expect(MEDICAL_LIMITS.liquid_edible).toBeCloseTo(216 * 29.5735, 6); // 216 fl oz = 6387.876 ml""",
    "SL med cap",
)

# ── low-thc-liquid-limit.test.ts ─────────────────────────────────────────
edit(
    LT,
    """    expect(bucketOf(v, "liquid_edible").used).toBe(355);""",
    """    // SLICE L4 \u2014 the liquid bucket now accumulates MILLILITRES. This line
    // states 355 GRAMS and no volume, so the weight is carried across at its
    // ounce-count (355 / 28 * 29.5735 = 374.95 ml). That carry-across is what
    // keeps every weight-labelled liquid and topical behaving exactly as
    // before: the ounce-count is preserved, and NO density is assumed.
    expect(bucketOf(v, "liquid_edible").used).toBeCloseTo((355 / 28) * 29.5735, 3);""",
    "LT 355g line",
)

edit(
    LT,
    """    expect(bucketOf(v, "liquid_edible").usedGrams).toBe(28);
    expect(v.blocked).toBe(false);""",
    """    // SLICE L4 \u2014 one unmeasured liquid unit: the 28 g category default,
    // carried across at its ounce-count = 29.574 ml. Same one ounce of the
    // statute's 72 as before the rebase.
    expect(bucketOf(v, "liquid_edible").usedGrams).toBeCloseTo(29.574, 3);
    expect(v.blocked).toBe(false);""",
    "LT 28g default",
)

edit(
    LT,
    """    expect(formatLimitAmount("liquid_edible", 2016)).toBe("72 oz");""",
    """    // SLICE L4 \u2014 the bucket speaks MILLILITRES in, FLUID OUNCES out. Passing
    // the old 2016 figure would now render "68.167 fl oz", which is precisely
    // the kind of unit mix-up this assertion exists to catch.
    expect(formatLimitAmount("liquid_edible", 72 * 29.5735)).toBe("72 fl oz");""",
    "LT formatLimitAmount",
)

edit(
    LT,
    """    expect(RECREATIONAL_LIMITS.liquid_edible).toBe(2016);""",
    """    // SLICE L4 \u2014 deliberately rebased: 2016 g -> 2129.292 ml (72 fl oz).
    // The other three buckets below are UNCHANGED, which is the point of this
    // regression test: only the liquid bucket moved.
    expect(RECREATIONAL_LIMITS.liquid_edible).toBeCloseTo(72 * 29.5735, 6);""",
    "LT regression rec",
)

edit(
    LT,
    """    expect(MEDICAL_LIMITS.liquid_edible).toBe(6048);""",
    """    expect(MEDICAL_LIMITS.liquid_edible).toBeCloseTo(216 * 29.5735, 6);""",
    "LT regression med",
)

edit(
    LT,
    """    expect(LIMIT_BUCKET_UNITS.liquid_edible).toBe("g");""",
    """    // SLICE L4 \u2014 "ml", not "g". A formatter that still assumes grams here
    // renders the 2129.292 cap as "76.046 oz".
    expect(LIMIT_BUCKET_UNITS.liquid_edible).toBe("ml");""",
    "LT bucket unit",
)


def main():
    for path, old, new, label in EDITS:
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        n = src.count(old)
        if n != 1:
            print(f"ABORT [{label}] {path}: anchor found {n} times, expected 1")
            sys.exit(1)
        out = src.replace(old, new, 1)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(out)
        with open(path, encoding="utf-8") as fh:
            if fh.read() != out:
                print(f"ABORT [{label}] {path}: write did not stick")
                sys.exit(1)
        print(f"OK   [{label}]")
    print(f"\n{len(EDITS)}/{len(EDITS)} retargeted.")


if __name__ == "__main__":
    main()
