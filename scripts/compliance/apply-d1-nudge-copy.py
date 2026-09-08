#!/usr/bin/env python3
"""
SLICE D1 (part 3) - restore the "add one more" nudge and correct the copy that
still describes the old store-advantaged either/or pick.

Two things were TRUE only while the engine kept the smaller of the two offers:

  1. estimator-core.ts skipped every eitherOr rule for tier nudges, on the
     stated grounds that "completing the bundle cannot increase the customer's
     savings beyond the flat percent they already get." Once the engine honours
     the BETTER option, completing the bundle genuinely does unlock more, so the
     skip now hides a real saving from the customer.

  2. promotions-advisor.ts told the AI strategist that Tuesday is
     "20% off prerolls/blunts OR 4-for-3, whichever saves less" and that Sunday
     is "spread store-advantaged". Both are now false. An AI briefed on stale
     ground truth will confidently repeat it to the owner.

Note the skip is removed rather than narrowed: the loop below already derives
its nudge from the rule's ACTUAL tiers, and a rule with no tiers produces no
nudge on its own, so eitherOr rules simply fall through harmlessly.
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ESTIMATOR = os.path.join(REPO, "src/lib/checkout/estimator-core.ts")
ADVISOR = os.path.join(REPO, "src/lib/promotions/promotions-advisor.ts")

EDITS = []

# ------------------------------------------------ estimator: doc comment
EDITS.append((
    ESTIMATOR,
    ''' * Either/or rules (e.g. Doobie Tuesday 20% OR 4-for-3) never nudge: the
 * engine takes the SMALLER savings of the two options (store-advantaged), so
 * completing the bundle cannot increase the customer's savings beyond the
 * flat percent they already get.
 */''',
    ''' * SLICE D1: either/or rules used to be skipped entirely here, because the
 * engine took the SMALLER savings of the two options and so completing a
 * bundle could never help. The engine now honours whichever option is BETTER
 * for the customer, which makes "add one more and save more" a real, truthful
 * unlock -- so the skip is gone and these rules nudge like any other.
 */''',
    "estimator: nudge doc",
))

# ------------------------------------------------ estimator: the skip itself
EDITS.append((
    ESTIMATOR,
    '''    const rule = snapshotToEngineRule(snapshot);
    if (rule.config.eitherOr) continue; // store-advantaged min \u2014 no real unlock
    const eligible = lines.filter((l) => ruleMatchesLine(rule, l));''',
    '''    const rule = snapshotToEngineRule(snapshot);
    // SLICE D1: no eitherOr skip. The engine now takes the BETTER option, so
    // completing a bundle is a genuine unlock worth telling the customer about.
    // Rules that carry no tiers still produce no nudge further down.
    const eligible = lines.filter((l) => ruleMatchesLine(rule, l));''',
    "estimator: remove eitherOr skip",
))

# ------------------------------------------------ advisor ground truth
EDITS.append((
    ADVISOR,
    '''  "- The daily deals are SET IN STONE \u2014 never suggest changing Tuesday (20% off prerolls/blunts OR 4-for-3, whichever saves less) or Sunday (3-for-2 storewide, savings spread store-advantaged). You may suggest ways to merchandise them better.",''',
    '''  "- The daily deals are SET IN STONE \u2014 never suggest changing Tuesday (prerolls/blunts/packs: 1\u20133 get 20% off, 4 or more get 25% off, which is the advertised \'4 for the price of 3\') or Sunday (3-for-2 storewide, the cheapest unit per group of 3 spread across the eligible lines to the exact cent). You may suggest ways to merchandise them better.",
  "- \'Store wins\' is a ROUNDING rule (a split cent goes to the store), NOT a deal-selection rule. Never suggest resolving two advertised offers by picking the one that saves the customer less \u2014 an advertised discount is honoured as advertised. Where a discount cannot divide evenly into whole cents, the remainder is rounded in the CUSTOMER\'s favour so the advertised rate is always met or beaten.",''',
    "advisor: Tuesday/Sunday ground truth",
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
        if text == original:
            continue
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        with open(path, "r", encoding="utf-8") as f:
            assert f.read() == text, f"{path}: disk mismatch"

    with open(ESTIMATOR, "r", encoding="utf-8") as f:
        est = f.read()
    assert "if (rule.config.eitherOr) continue" not in est, "the eitherOr nudge skip survived"
    assert "SMALLER savings of the two options (store-advantaged), so" not in est, (
        "the stale nudge doc survived"
    )

    with open(ADVISOR, "r", encoding="utf-8") as f:
        adv = f.read()
    assert "whichever saves less" not in adv, "the advisor still briefs 'whichever saves less'"
    assert "ROUNDING rule" in adv, "the advisor is missing the store-wins clarification"
    print("Verified on disk.")


if __name__ == "__main__":
    main()
