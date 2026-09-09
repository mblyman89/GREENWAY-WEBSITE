#!/usr/bin/env python3
"""
SLICE D2 (part 2) - a base tier at threshold 0 must survive an admin save.

Recon finding. Wednesday's base tier is { at: 0, percent: 20 } ("everyone gets
20%, and 30% once you pass $150"). But the admin form parser rejects it:

    if (Number.isFinite(at) && at > 0 && Number.isFinite(percent) && percent > 0) {

`at > 0` silently DROPS any tier whose threshold is zero. So the moment a staff
member opened Wax Wednesday in /admin/promotions and pressed Save - without
changing anything - the 20% base tier would vanish from the saved config and
the deal would collapse back to "nothing below $150". That is the exact class of
silent regression this round exists to eliminate, and it would have been blamed
on the discount engine rather than on the form.

`at >= 0` is the correct predicate: a threshold of zero means "no minimum",
which is a legitimate and useful tier. The percent still has to be positive, so
empty rows are still discarded.

Note the sort is already `(a, b) => a.at - b.at`, so a zero-threshold tier sorts
first, and tierPercent() takes the highest percent whose threshold is met - both
already behave correctly once the tier is allowed through.
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ACTIONS = os.path.join(REPO, "src/app/admin/promotions/actions.ts")

OLD = """    if (Number.isFinite(at) && at > 0 && Number.isFinite(percent) && percent > 0) {"""
NEW = """    // SLICE D2: `at >= 0`, not `at > 0`. A threshold of ZERO means "no minimum"
    // and is a real tier - Wax Wednesday's base rate is { at: 0, percent: 20 }.
    // With `at > 0` the base tier was silently dropped whenever staff saved the
    // promotion, collapsing the deal to "nothing below $150".
    if (Number.isFinite(at) && at >= 0 && Number.isFinite(percent) && percent > 0) {"""


def main():
    with open(ACTIONS, "r", encoding="utf-8") as f:
        text = f.read()

    if text.count(NEW) == 1:
        print("  admin: zero-threshold tiers allowed: already applied")
    else:
        assert text.count(OLD) == 1, f"found {text.count(OLD)} copies of OLD, expected 1"
        text = text.replace(OLD, NEW, 1)
        with open(ACTIONS, "w", encoding="utf-8") as f:
            f.write(text)
        print("  admin: zero-threshold tiers allowed: applied")

    with open(ACTIONS, "r", encoding="utf-8") as f:
        disk = f.read()
    assert disk == text, "disk mismatch"
    assert "at > 0 && Number.isFinite(percent)" not in disk, "the at > 0 rejection survived"
    assert disk.count("at >= 0 && Number.isFinite(percent)") == 1, "the fix is not present"
    print("Verified on disk.")


if __name__ == "__main__":
    main()
