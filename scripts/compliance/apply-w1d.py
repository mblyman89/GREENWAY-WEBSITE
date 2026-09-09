#!/usr/bin/env python3
"""SLICE W1d -- correct a FALSE comment and pin the redundant guards.

The W1 mutation harness left 4 survivors. Investigation (scripts/probe-survivors.ts)
proved all four are EQUIVALENT MUTANTS -- source edits that cannot change
observable behaviour, so no test can ever kill them. But the investigation also
proved that a comment I wrote in weight-label-core.ts is FALSE, and a false
comment is worse than no comment: it would send the next editor the wrong way.

 - SURVIVOR 1 said alternation order does not matter. My header claimed
   "Alternation order is load-bearing, not cosmetic". MEASURED: with the `$`
   anchor present, the regex engine BACKTRACKS through the remaining
   alternatives, so "1 1/2 oz" captures "1 1/2" under BOTH orderings. All 8
   probe labels captured identically. The claim is wrong -> corrected below,
   and the real safety mechanism (the anchor) is named instead.

 - SURVIVORS 2-4 are the three overlapping numeric guards. MEASURED: removing
   any ONE leaves behaviour byte-identical; removing TWO lets "0g" return 0
   instead of null, and removing all three lets "1/0 oz" return Infinity. That
   is textbook defense in depth, and it is worth KEEPING -- but it must be
   documented as deliberate so a future reader does not "tidy up" what looks
   like dead code, and the harness must assert the COMBINED removal is caught.
"""
import io

CORE = "src/lib/compliance/weight-label-core.ts"


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


print("SLICE W1d -- correcting a false comment, documenting the guards")

# --- 1. THE FALSE COMMENT. -------------------------------------------------
edit(
    CORE,
    """/**
 * Quantity notations, ordered LONGEST-FIRST so "1 1/2" is never truncated to
 * "1". Alternation order is load-bearing, not cosmetic.
 *   1. mixed ascii    "1 1/2"
 *   2. mixed unicode  "1 1/2" written with a vulgar fraction
 *   3. pure fraction  "1/8"
 *   4. bare unicode   a lone vulgar fraction
 *   5. decimal        "3.5", "28"
 */""",
    """/**
 * Quantity notations:
 *   1. mixed ascii    "1 1/2"
 *   2. mixed unicode  "1" + a vulgar fraction
 *   3. pure fraction  "1/8"
 *   4. bare unicode   a lone vulgar fraction
 *   5. decimal        "3.5", "28"
 *
 * ON ALTERNATION ORDER -- MEASURED, AND NOT WHAT I FIRST WROTE. An earlier
 * revision of this comment claimed the longest-first ordering was
 * "load-bearing" and that a decimal-first ordering would truncate "1 1/2" to
 * "1". A mutation test that moved the decimal alternative to the front
 * SURVIVED, so the claim was checked directly: under both orderings all eight
 * probe labels captured identically ("1 1/2 oz" -> "1 1/2", "1/8 oz" -> "1/8",
 * "10 3/4 oz" -> "10 3/4"). The reason is that the pattern is ANCHORED: when a
 * short alternative matches, the trailing `\\s*(unit)$` then fails, and the
 * engine BACKTRACKS into the remaining alternatives rather than accepting the
 * truncation. So the ordering is READABILITY, not correctness.
 *
 * THE ACTUAL SAFETY MECHANISM IS THE `$` ANCHOR on WEIGHT_LABEL_RE. Remove it
 * and "10pk 0.5g" starts parsing as a weight (mutation-tested: caught). The
 * same discipline liquid-volume-core documents for its bare-litre pattern.
 */""",
    "correct the false alternation-order comment",
)

# --- 2. Document the deliberately redundant guards. ------------------------
edit(
    CORE,
    "  const qty = parseQuantityToken(m[1]);\n"
    "  if (qty === null || !Number.isFinite(qty) || qty <= 0) return null;\n"
    "\n"
    '  const grams = m[2].startsWith("g") ? qty : qty * STATUTORY_GRAMS_PER_OUNCE;\n'
    "  if (!Number.isFinite(grams) || grams <= 0) return null;\n"
    "  return round3(grams);",
    "  const qty = parseQuantityToken(m[1]);\n"
    "  // DELIBERATELY REDUNDANT WITH the zero-denominator check inside\n"
    "  // parseQuantityToken and with the grams check below. Mutation testing\n"
    "  // measured this: removing any ONE of the three leaves behaviour\n"
    "  // byte-identical (so each looks like dead code in isolation), while\n"
    "  // removing TWO lets \"0g\" return 0 instead of null, and removing all three\n"
    "  // lets \"1/0 oz\" return Infinity straight into the WAC limit arithmetic.\n"
    "  // This is defense in depth on a license-critical path -- do not tidy it\n"
    "  // away because a coverage tool calls one line redundant.\n"
    "  if (qty === null || !Number.isFinite(qty) || qty <= 0) return null;\n"
    "\n"
    '  const grams = m[2].startsWith("g") ? qty : qty * STATUTORY_GRAMS_PER_OUNCE;\n'
    "  // Second layer: a finite positive qty can still produce a non-finite\n"
    "  // grams if the ounce constant is ever corrupted.\n"
    "  if (!Number.isFinite(grams) || grams <= 0) return null;\n"
    "  return round3(grams);",
    "document the redundant guards",
)

print("\nW1d done.")
