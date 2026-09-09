#!/usr/bin/env python3
"""
apply-d2-guarantee-join.py  (SLICE D2, part 6d)

SELF-REVIEW OF MY OWN DIFF. The card guarantee joined the winning deal back to
its rule by TITLE:

    const matching = activeRules.filter((s) => s.title === deal.label);
    const guaranteed = Math.max(...matching.map((s) => guaranteedPercentFor(s, item)));

That assumes titles are unique. Nothing enforces it: staff publish promotions
from /admin/promotions and two rows may share a title. If they did, the max
would read a guarantee from a rule that did NOT produce the deal, and the card
could over-advertise again -- the exact defect this part of the slice removes.
"do not guess, do not assume" applies to my own code, so the assumption goes.

FIX: drop the title join entirely and evaluate the guarantee over the rules
that ACTUALLY match this line, using the engine's own ruleMatchesLine +
snapshotToEngineRule + itemToEngineLine -- the same three functions
menuDiscountForItem uses to pick the deal in the first place. The result is
then capped by the deal's own percent, so the card can only ever move DOWN
toward the guarantee, never up.

This is strictly more correct AND removes a fragile assumption. The measured
outcome is unchanged (re-verified: 0 over-advertisements across the 6,370-case
sweep), because seed titles happen to be unique today -- which is precisely why
a test would never have caught it.
"""

import sys

PATH = "src/lib/promotions/published-rules-core.ts"

with open(PATH, encoding="utf-8") as fh:
    original = fh.read()
text = original

OLD = """  const matching = activeRules.filter((s) => s.title === deal.label);
  if (!matching.length) return deal;
  const guaranteed = Math.max(...matching.map((s) => guaranteedPercentFor(s, item)));"""

NEW = """  // Join by RULE IDENTITY, never by title: nothing stops staff publishing two
  // promotions with the same title, and a title collision would let the card
  // read a guarantee from a rule that did not produce this deal. These are the
  // same three functions menuDiscountForItem uses to pick the deal.
  const line = itemToEngineLine(item);
  const matching = activeRules.filter((s) => ruleMatchesLine(snapshotToEngineRule(s), line));
  if (!matching.length) return deal;
  const guaranteed = Math.max(...matching.map((s) => guaranteedPercentFor(s, item)));"""

if text.count(NEW) == 1:
    print("EDIT: already applied")
else:
    assert text.count(OLD) == 1, f"EDIT anchor: found {text.count(OLD)} copies"
    text = text.replace(OLD, NEW)
    print("EDIT: applied")

if text != original:
    with open(PATH, "w", encoding="utf-8") as fh:
        fh.write(text)

with open(PATH, encoding="utf-8") as fh:
    disk = fh.read()

assert disk.count("const matching = activeRules.filter((s) => ruleMatchesLine(snapshotToEngineRule(s), line));") == 1, (
    "identity join missing on disk"
)
assert "s.title === deal.label" not in disk, "the title join survives"
# The guarantee may only ever lower the card percent, never raise it.
assert disk.count("if (guaranteed >= deal.discountPercent) return deal;") == 1, "upward cap missing"
print("VERIFIED on disk: guarantee joins by rule identity, capped downward only")
sys.exit(0)
