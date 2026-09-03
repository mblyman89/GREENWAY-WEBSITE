#!/usr/bin/env python3
"""
SLICE 16 — MUTATION TEST #2: the intake guard and the truth surfaces.

Michael: "Test it and the tests before shipping."

A passing test suite proves the code does something. It does NOT prove the
tests would notice if the code did the WRONG thing. The only way to know that
is to deliberately break the code and check the suite goes red.

The first mutation run (mutation_test.py, the sales-limit engine) found TWO
REAL GAPS in tests that were already green. This second run applies the same
scrutiny to everything built since: the intake validator, the DB adapter, the
AI concierge prose, and the public medical table.

Each mutant below is a plausible wrong implementation — the kind of thing a
future maintainer (or a future me) writes in good faith. If the suite stays
green for any of them, that test file has a hole and the hole gets closed.

Every mutant is applied, tested, and REVERTED. The working tree is restored
even if the run fails.
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

# Fail loudly if this file is ever moved without updating the depth above.
# A silently-wrong repo root would make every mutant "survive" for the wrong
# reason and turn this verification asset into a liar.
if not (ROOT / "package.json").is_file():
    raise SystemExit(
        f"repo root resolution is wrong: {ROOT} has no package.json. "
        "This script moved directories - update the parents[N] depth."
    )

CORE = "src/lib/pos/fact-review-core.ts"
SEED = "src/lib/ai/kb/seed.ts"
MEDPAGE = "src/lib/medical/purchase-limit-display-core.ts"
SURFACE = "src/lib/regulatory/compliance-surface.ts"

TEST_FILES = [
    "tests/compliance/low-thc-liquid-intake.test.ts",
    "tests/compliance/low-thc-liquid-truth-surfaces.test.ts",
    "tests/compliance/public-surfaces-core.test.ts",
    "tests/compliance/low-thc-liquid-limit.test.ts",
]

# (name, file, find, replace, why-this-matters)
MUTANTS = [
    (
        "intake: per-container ceiling removed entirely",
        CORE,
        "    if (mg > LOW_THC_UNIT_MAX_MG) {",
        "    if (false) {",
        "The 16 mg bottle would be accepted as low-THC. 200/4 = 50 bottles "
        "x 16 mg = 800 mg sold against a 200 mg cap.",
    ),
    (
        "intake: ceiling becomes exclusive (rejects a legitimate 4 mg can)",
        CORE,
        "    if (mg > LOW_THC_UNIT_MAX_MG) {",
        "    if (mg >= LOW_THC_UNIT_MAX_MG) {",
        "The statute says 'no more than four milligrams' \u2014 4 mg qualifies. "
        "This would refuse the single most common product in the category.",
    ),
    (
        "intake: ceiling retyped as a literal that drifts from the statute",
        CORE,
        "    if (mg > LOW_THC_UNIT_MAX_MG) {",
        "    if (mg > 10) {",
        "A 10 mg can would be flagged. This is the exact drift that importing "
        "the constant instead of retyping it is meant to prevent.",
    ),
    (
        "intake: mg no longer required when flagging",
        CORE,
        "    if (typeof mg !== \"number\") {",
        "    if (false) {",
        "A flagged line with no mg figure. The register counts 0 mg per can "
        "and never reaches the cap \u2014 unlimited cans.",
    ),
    (
        "intake: zero/negative milligrams accepted",
        CORE,
        "    if (!Number.isFinite(mg) || mg <= 0) {",
        "    if (!Number.isFinite(mg)) {",
        "0 mg per can means the cap is mathematically unreachable.",
    ),
    (
        "intake: non-numeric input coerced instead of refused",
        CORE,
        "    if (!Number.isFinite(mg) || mg <= 0) {",
        "    if (false) {",
        "'four' becomes NaN and slips through as a stored fact.",
    ),
    (
        "intake: blank silently means 'no' (checkbox semantics)",
        CORE,
        "  } else if (lowThc === \"no\") {\n    facts.lowThcLiquid = false;\n  }",
        "  } else {\n    facts.lowThcLiquid = false;\n  }",
        "Breaks the screen's 'only fields you fill in are changed' contract and "
        "makes every untouched product a reviewed 'no'.",
    ),
    (
        "intake: the select accepts any truthy-looking string",
        CORE,
        "  if (lowThc !== \"\" && lowThc !== \"yes\" && lowThc !== \"no\") {",
        "  if (false) {",
        "'true'/'1'/'YES' would fall through to the else-branch and be recorded "
        "as a 'no', quietly discarding the reviewer's actual intent.",
    ),
    (
        "adapter: NULL collapses to false",
        CORE,
        "    lowThcLiquid: row.low_thc_liquid,",
        "    lowThcLiquid: row.low_thc_liquid === true,",
        "'Nobody has classified this' becomes 'reviewed and rejected', which "
        "erases the entire review queue.",
    ),
    (
        "adapter: numeric string not coerced",
        CORE,
        "    unitThcMg: num(row.unit_thc_mg),",
        "    unitThcMg: row.unit_thc_mg as number | null,",
        "PostgREST returns numeric as a STRING. \"4\" fails the register's "
        "typeof === number guard and silently un-classifies the product.",
    ),
    (
        "public page: medical figure tripled like every other row",
        MEDPAGE,
        "      medical: `${MEDICAL_LIMITS.low_thc_liquid} mg THC`,",
        "      medical: `${MEDICAL_LIMITS.low_thc_liquid * 3} mg THC`,",
        "Advertises 600 mg to every patient reading the public /medical page. "
        "WAC 314-55-095(2)(d) says 200. This is the single most seductive bug "
        "in the whole slice.",
    ),
    (
        "public page: mg cap rendered as a weight",
        MEDPAGE,
        "      recreational: `${RECREATIONAL_LIMITS.low_thc_liquid} mg THC`,",
        "      recreational: `${RECREATIONAL_LIMITS.low_thc_liquid} oz`,",
        "The '7.143 oz' class of bug: milligrams of THC presented as ounces of "
        "product. Meaningless and misleading to a customer.",
    ),
    (
        "public page: the low-THC row dropped from the table",
        MEDPAGE,
        "      category: `Low-THC beverages (units of ${LOW_THC_UNIT_MAX_MG} mg THC or less)`,",
        "      category: `Concentrates (duplicate)`,",
        "The public page stops telling customers the limit exists.",
    ),
    (
        "concierge: KB prose reverts to the blocked 'N mg per unit' phrasing",
        SEED,
        "`individual units of ${LOW_THC_UNIT_MG} mg of active delta-9 THC or less follow a separate `",
        "`individual units of ${LOW_THC_UNIT_MG} mg per unit of active delta-9 THC follow a separate `",
        "Trips the I-502 dosing-advice gate. The rule is silently suppressed "
        "and the customer is told only the 72 oz figure. Invisible without a test.",
    ),
    (
        "concierge: the medical anti-tripling sentence removed",
        SEED,
        "`too — it is the one limit that does not increase with a card.`",
        "`too.`",
        "A patient reads '200 mg' next to four tripled figures and reasonably "
        "assumes 600. The sentence is the whole point.",
    ),
    (
        "concierge: general purchase-limit rule loses the carve-out",
        SEED,
        "`allowance instead: up to ${REC_LOW_THC_MG} mg of active delta-9 THC in one transaction.`",
        "`allowance instead.`",
        "A customer asking the broad question gets a silently incomplete answer.",
    ),
    (
        "analyst: surface map stops mentioning the mg bucket",
        SURFACE,
        "and 200 mg active delta-9 THC for low-THC infused beverages packaged in units of 4 mg or less",
        "and other buckets",
        "The Regulatory Watch AI proposes roadmaps against a map that no longer "
        "matches the code it is advising on.",
    ),
]


def run_tests() -> bool:
    """True if the suite is GREEN."""
    proc = subprocess.run(
        ["npx", "vitest", "run", *TEST_FILES],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    print("SLICE 16 \u2014 MUTATION TEST #2 (intake guard + truth surfaces)")
    print("=" * 72)

    originals = {rel: (ROOT / rel).read_text(encoding="utf-8") for rel in {m[1] for m in MUTANTS}}

    print("\nBaseline: the suite must be GREEN before we start breaking things.")
    if not run_tests():
        for rel, text in originals.items():
            (ROOT / rel).write_text(text, encoding="utf-8")
        print("  FAIL \u2014 baseline is already red. Fix that first.")
        return 1
    print("  ok \u2014 baseline green.\n")

    survivors = []
    try:
        for i, (name, rel, find, repl, why) in enumerate(MUTANTS, start=1):
            src = originals[rel]
            n = src.count(find)
            if n != 1:
                survivors.append((name, f"ANCHOR MATCHED {n}x \u2014 mutant never applied", why))
                print(f"[{i:2d}/{len(MUTANTS)}] {name}\n         !! anchor matched {n}x, NOT APPLIED")
                continue

            (ROOT / rel).write_text(src.replace(find, repl, 1), encoding="utf-8")
            green = run_tests()
            (ROOT / rel).write_text(src, encoding="utf-8")

            if green:
                survivors.append((name, "SURVIVED \u2014 suite stayed green", why))
                print(f"[{i:2d}/{len(MUTANTS)}] {name}\n         \u2717 SURVIVED \u2014 TEST GAP")
            else:
                print(f"[{i:2d}/{len(MUTANTS)}] {name}\n         \u2713 killed")
    finally:
        # Always restore, even on Ctrl-C or an exception.
        for rel, text in originals.items():
            (ROOT / rel).write_text(text, encoding="utf-8")

    print("\n" + "=" * 72)
    killed = len(MUTANTS) - len(survivors)
    print(f"RESULT: {killed}/{len(MUTANTS)} mutants killed.")
    if survivors:
        print("\nSURVIVORS \u2014 each is a real hole in the test suite:\n")
        for name, status, why in survivors:
            print(f"  \u2717 {name}\n      {status}\n      WHY IT MATTERS: {why}\n")
        return 1

    print("\nEvery plausible wrong implementation is caught. The tests have teeth.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
