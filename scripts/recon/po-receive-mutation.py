#!/usr/bin/env python3
"""
scripts/recon/po-receive-mutation.py

MUTATION HARNESS for the defect A + defect B fix in
src/lib/inventory/po-receive-core.ts.

"Test it, test the tests." A green suite only proves the tests RAN. This
proves they BITE: each mutant below breaks the fix in a way a careless future
edit realistically could, and the suite must go RED for every single one. A
mutant that survives is a hole in the net, not a curiosity.

Method
------
For each mutant: apply a precise source edit, run ONLY the two test files that
cover this module (fast), record pass/fail, then restore the original source
from an in-memory snapshot in a `finally` block so an interrupted run can
never leave the tree dirty.

Every anchor is asserted to appear EXACTLY ONCE before it is replaced, so a
silently-missed edit can never masquerade as a surviving mutant.

Run:  python3 -u scripts/recon/po-receive-mutation.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SRC = REPO / "src/lib/inventory/po-receive-core.ts"

TEST_FILES = [
    "tests/compliance/po-receive-core.test.ts",
    "tests/compliance/pure-selftests.test.ts",
]

# Each mutant: (id, description, [(old, new), ...])
MUTANTS: list[tuple[str, str, list[tuple[str, str]]]] = [
    # ---- DEFECT A: the ambiguity refusal itself ----------------------------
    (
        "A1",
        "Delete the refusal entirely — back to the original defect (guess candidates[0])",
        [
            (
                '    if (matchedBy === "name" && candidates.length > 1) {\n'
                '      unmatchedLots.push({ lotId: lot.id, label: lotLabel(lot), qty, reason: "ambiguous-name" });\n'
                "      continue;\n"
                "    }",
                "",
            )
        ],
    ),
    (
        "A2",
        "Refuse only when >2 candidates (off-by-one: the common 2-line collision slips through)",
        [("candidates.length > 1) {", "candidates.length > 2) {")],
    ),
    (
        "A3",
        "Drop the matchedBy guard — now duplicate-KEY lines are wrongly refused too",
        [('if (matchedBy === "name" && candidates.length > 1)', "if (candidates.length > 1)")],
    ),
    (
        "A4",
        "Refuse the KEY path instead of the NAME path (inverted guard)",
        [('if (matchedBy === "name" &&', 'if (matchedBy === "key" &&')],
    ),
    (
        "A5",
        "Refuse but forget to `continue` — falls through and receives anyway",
        [
            (
                '      unmatchedLots.push({ lotId: lot.id, label: lotLabel(lot), qty, reason: "ambiguous-name" });\n'
                "      continue;",
                '      unmatchedLots.push({ lotId: lot.id, label: lotLabel(lot), qty, reason: "ambiguous-name" });',
            )
        ],
    ),
    (
        "A6",
        "Mislabel the refusal reason as no-match (loses the distinction the note relies on)",
        [
            (
                'qty, reason: "ambiguous-name" });\n      continue;',
                'qty, reason: "no-match" });\n      continue;',
            )
        ],
    ),
    (
        "A7",
        "Report qty 0 for the refused lot — human would receive nothing",
        [
            (
                'label: lotLabel(lot), qty, reason: "ambiguous-name"',
                'label: lotLabel(lot), qty: 0, reason: "ambiguous-name"',
            )
        ],
    ),
    (
        "A8",
        "Never surface the refusal in the timeline note (silent refusal)",
        [("  const ambiguousSentence =\n    ambiguous.length > 0", "  const ambiguousSentence =\n    false")],
    ),
    (
        "A9",
        "Lump ambiguous lots back into the 'Not on the PO' sentence (misleading note)",
        [('const noMatch = unmatchedLots.filter((u) => u.reason !== "ambiguous-name");', "const noMatch = unmatchedLots;")],
    ),
    # ---- DEFECT B: the number+unit join ------------------------------------
    (
        "B1",
        "Remove the number/unit join — defect B returns (3.5 g misses 3.5g)",
        [("return base.replace(NAME_UNIT_RE, \"$1$2\");", "return base;")],
    ),
    (
        "B2",
        "Squeeze ALL whitespace instead — the measured real-data regression",
        [
            (
                '  return base.replace(NAME_UNIT_RE, "$1$2");',
                '  return base.replace(/ /g, "");',
            )
        ],
    ),
    (
        "B3",
        "Generalize to any word after a number — joins 'Batch 5 A' into 'batch 5a'",
        [("(${NAME_UNIT_TOKENS.join(\"|\")})", "([a-z]+)")],
    ),
    (
        "B5",
        "Drop the trailing word boundary — 'g' would match inside 'grape' etc.",
        [
            (
                'String.raw`\\b(\\d+) (${NAME_UNIT_TOKENS.join("|")})\\b`',
                'String.raw`\\b(\\d+) (${NAME_UNIT_TOKENS.join("|")})`',
            )
        ],
    ),
    (
        "B6",
        "Shrink the unit list (drop mg/pk/ml) — edible + pre-roll names stop matching",
        [
            (
                'const NAME_UNIT_TOKENS = ["mg", "g", "oz", "ml", "pk", "ct", "pc"] as const;',
                'const NAME_UNIT_TOKENS = ["g", "oz"] as const;',
            )
        ],
    ),
    (
        "B7",
        "Non-global regex — only the FIRST number/unit pair in a name is joined",
        [
            (
                'String.raw`\\b(\\d+) (${NAME_UNIT_TOKENS.join("|")})\\b`, "g")',
                'String.raw`\\b(\\d+) (${NAME_UNIT_TOKENS.join("|")})\\b`)',
            )
        ],
    ),
]

# Mutants PROVEN equivalent — and then designed out of the source entirely.
#
# Both of these survived the first run. Neither was excused: each was proven
# to have no observable effect, and the redundant construct was DELETED from
# po-receive-core.ts, so the mutant no longer exists to test. A defensive line
# that cannot be observed when removed is not defence, it is decoration.
EQUIVALENT_MUTANTS: dict[str, str] = {
    "B4 (removed)": (
        "The number group was `(\\d+(?: \\d+)?)`, meant to span a decimal that "
        "punctuation stripping had split ('3.5 g' -> '3 5 g'). Proven "
        "unnecessary: stripping runs first, so '3.5g' is already '3 5g' and "
        "joining only the trailing '5 g' lands both spellings on '3 5g'. "
        "Compared both regexes over all 2,615 real product names: 0 keys "
        "differ. The optional group was deleted."
    ),
    "B8 (removed)": (
        "`NAME_UNIT_RE.lastIndex = 0` before a .replace(). Proven dead: "
        "String.prototype.replace with a /g regex resets lastIndex itself "
        "(ECMA-262, RegExp.prototype[Symbol.replace]), and the module makes 0 "
        "calls to NAME_UNIT_RE.test()/.exec(). The line was deleted."
    ),
}


def run_tests() -> bool:
    """True if the covering suite PASSES."""
    proc = subprocess.run(
        ["npx", "vitest", "run", *TEST_FILES],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=600,
    )
    return proc.returncode == 0


def main() -> int:
    original = SRC.read_text(encoding="utf-8")

    print("=" * 74)
    print("MUTATION HARNESS — po-receive-core.ts (defects A + B)")
    print("=" * 74)
    print(f"source : {SRC.relative_to(REPO)}")
    print(f"suite  : {', '.join(TEST_FILES)}")
    print(f"mutants: {len(MUTANTS)}")
    print()

    print("Baseline (unmutated source) ... ", end="", flush=True)
    if not run_tests():
        print("FAILED")
        print("\nABORT: the suite is red BEFORE mutation. Fix that first.")
        return 1
    print("green\n")

    killed: list[str] = []
    survived: list[tuple[str, str]] = []

    try:
        for mid, desc, edits in MUTANTS:
            mutated = original
            for old, new in edits:
                count = mutated.count(old)
                assert count == 1, (
                    f"\nMUTANT {mid}: anchor found {count} times, expected exactly 1.\n"
                    f"anchor: {old[:160]!r}"
                )
                mutated = mutated.replace(old, new, 1)

            assert mutated != original, f"MUTANT {mid}: edit produced identical source"

            SRC.write_text(mutated, encoding="utf-8")
            passed = run_tests()
            SRC.write_text(original, encoding="utf-8")

            if passed:
                survived.append((mid, desc))
                print(f"  SURVIVED  {mid}  {desc}")
            else:
                killed.append(mid)
                print(f"  killed    {mid}  {desc}")
    finally:
        # Always restore, even on assert/KeyboardInterrupt/exception.
        SRC.write_text(original, encoding="utf-8")

    total = len(MUTANTS)
    print()
    print("-" * 74)
    print(f"killed   : {len(killed)}/{total}")
    print(f"survived : {len(survived)}/{total}")
    if EQUIVALENT_MUTANTS:
        print(f"equivalent (excluded, proven): {len(EQUIVALENT_MUTANTS)}")
    print("-" * 74)

    if survived:
        print("\nSURVIVING MUTANTS — the tests do NOT cover these:")
        for mid, desc in survived:
            print(f"  {mid}: {desc}")
        print("\nRESULT: FAIL — add tests until every mutant is killed.")
        return 1

    print("\nRESULT: 100% of mutants killed. The tests bite.")
    # Paranoia: prove the tree really is back to the original.
    assert SRC.read_text(encoding="utf-8") == original, "source not restored!"
    print("Source verified byte-identical to the original.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
