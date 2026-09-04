#!/usr/bin/env python3
"""SLICE 17 — MUTATION TESTING, ROUND 2.

WHY THERE IS A ROUND 2
----------------------
Round 1 reported "7/10 killed" with three SURVIVORS. Reading the log carefully,
none of the three was a test hole — all three were ANCHOR failures ("matched 2x",
"matched 0x"), meaning the mutation was never actually applied to the file. A
mutant that was never injected is not a mutant that survived; it is a mutant
that was never RUN. Reporting it as a survivor is noise, but silently skipping
it would have been far worse: it looks like coverage that does not exist.

Round 1 also carried a placeholder at MUTANTS[0] whose `find` and `replace` were
identical, so the loop's `if find == replace: continue` skipped it outright.
That skipped mutant was the medical-tripling one — the single most important
legal finding in this slice.

So round 2 re-runs every mutant round 1 could not, using anchors verified to
match EXACTLY ONCE against the real bytes on disk first. It also adds the
flooring mutant, which round 1 could not express because the flooring code did
not exist yet: writing these tests found that `clampLimitProfile`'s comment
promised "floored to an integer" while the code did no such thing.

Every mutation is reverted in a `finally` block, so an interrupted run cannot
leave a mutant in the tree.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

CORE = "src/lib/compliance/sales-limits-core.ts"
FLOW = "src/lib/pos/sale-flow-core.ts"
METER = "src/lib/menu/cart-limit-meter-core.ts"
PUBLIC = "src/lib/medical/purchase-limit-display-core.ts"
FACTS = "src/lib/pos/fact-review-core.ts"

# (label, file, find, replace, why it matters)
MUTANTS: list[tuple[str, str, str, str, str]] = [
    (
        "MEDICAL tripled to 30 units",
        CORE,
        "  otherwise_taken: 10,\n};\n",
        "  otherwise_taken: 30,\n};\n",
        "THE central legal finding of SLICE 17. WAC 314-55-095(2)(d) enumerates "
        "five categories and 'otherwise taken into the body' is ABSENT, so the "
        "recreational ten stands for patients too. Tripling by analogy would "
        "authorise a 20-unit over-sale on every medical transaction.",
    ),
    (
        "RECREATIONAL limit raised 10 -> 11",
        CORE,
        "  otherwise_taken: 10, // 10 UNITS",
        "  otherwise_taken: 11, // 10 UNITS",
        "An off-by-one authorises a sale the statute forbids. (Round 1 could "
        "not run this: its anchor matched both the rec and med profiles.)",
    ),
    (
        "clamp no longer floors a fractional cap",
        CORE,
        "    return floored >= 1 ? floored : max;",
        "    return clamp(v, max);",
        "A fractional ceiling renders a COUNT of physical items as a fraction "
        "and makes the boundary ambiguous on screen.",
    ),
    (
        "clamp ROUNDS instead of flooring",
        CORE,
        "    const floored = Math.floor(clamp(v, max));",
        "    const floored = Math.round(clamp(v, max));",
        "Rounding 9.99 up to 10 hands back a unit the owner deliberately took "
        "away — the one direction a clamp may never move.",
    ),
    (
        "a sub-1 cap is allowed to collapse to zero",
        CORE,
        "    return floored >= 1 ? floored : max;",
        "    return floored;",
        "A cap of zero is not a strict limit, it is an outage: it blocks every "
        "suppository sale in the shop.",
    ),
    (
        "units formatted as ounces",
        CORE,
        '    return `${n} ${n === 1 ? "unit" : "units"}`;',
        "    return `${gramsToOunces(amount)} oz`;",
        "States a COUNT as a WEIGHT — ten units would print as '0.353 oz', "
        "which is meaningless and teaches the customer a false rule.",
    ),
    (
        "suspectsOtherwiseTaken never fires",
        CORE,
        "export function suspectsOtherwiseTaken(input: {",
        "export function suspectsOtherwiseTaken(_ignored: {",
        "The warning heuristic is the only thing standing between an unflagged "
        "suppository and the effectively-unlimited liquid bucket. If it stops "
        "firing, the limit silently never applies to anything.",
    ),
    (
        "the register drops the flag off the sale line",
        FLOW,
        "      otherwiseTaken: l.otherwiseTaken ?? null,",
        "      otherwiseTaken: null,",
        "Michael asked for the block on BOTH surfaces. If the register drops "
        "the flag, the engine is correct and the till still over-sells.",
    ),
    (
        "the website cart meter drops the flag",
        METER,
        "      otherwiseTaken: item.otherwiseTaken ?? null,",
        "      otherwiseTaken: null,",
        "The same defect on the customer-facing surface: the order sails "
        "through online and blows up (or does not) at pickup.",
    ),
    (
        "the public /medical table renders units through the gram formatter",
        PUBLIC,
        '      recreational: formatLimitAmount("otherwise_taken", RECREATIONAL_LIMITS.otherwise_taken),',
        '      recreational: formatLimitAmount("liquid_edible", RECREATIONAL_LIMITS.otherwise_taken),',
        "Publishing a count as a weight is a factual misstatement of the law "
        "on a public page.",
    ),
    (
        "intake accepts YES with no unit count",
        FACTS,
        '    if (typeof facts.unitsPerPackage !== "number") {',
        "    if (false) {",
        "A flagged item with no count cannot be counted; it stores a product "
        "the engine is unable to evaluate.",
    ),
]


def run_suite() -> bool:
    """True when the suite PASSES.

    A per-mutant TIMEOUT is essential. Without one, a mutation that sends the
    engine into a pathological path (or a runner that hangs) stalls the whole
    round with a live mutant sitting in the working tree. A timeout is treated
    as "the suite did not pass", i.e. the mutant is killed — but it is reported
    separately so it can never masquerade as a clean assertion failure.
    """
    r = subprocess.run(
        ["npx", "vitest", "run", "tests/compliance/", "--no-file-parallelism"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=600,
    )
    return r.returncode == 0


# ── CRASH SAFETY ───────────────────────────────────────────────────────────
#
# The `finally` block below restores the original file. That is enough for a
# clean exit or an exception, but NOT for SIGKILL: a hard kill (an external
# supervisor, an OOM, a sandbox wall-clock cap) skips `finally` entirely and
# leaves a deliberately-broken source file in the working tree. That very thing
# happened on the first attempt at this round: the runner was SIGKILLed mid-
# mutant and left `otherwise_taken: 30` — a fake legal rule — sitting in
# sales-limits-core.ts.
#
# So we also drop a SENTINEL file next to the repo before each mutation and
# remove it after. If the script starts and finds a stale sentinel, it knows a
# previous run died mid-mutation and refuses to proceed until the tree is
# restored, printing the exact command to do it.
SENTINEL = ROOT / ".mutation-in-progress"


def write_sentinel(label: str, rel: str, find: str, replace: str) -> None:
    """Record the mutation AND a full backup of the pristine file.

    ORIGINAL SIN, RECORDED SO IT IS NOT REPEATED
    --------------------------------------------
    The first version of this sentinel told the reader to recover with:

        git checkout -- <file>

    That advice was WRONG and following it destroyed roughly 127 lines of
    UNCOMMITTED work. The mutated file also held the slice's in-progress
    feature code, so reverting to HEAD removed the deliberate bug AND the
    feature, and `git` had no copy of the latter to give back. Recovery took a
    transcript-mining script.

    A recovery instruction must never discard uncommitted work. So the sentinel
    now carries the exact pristine bytes of the file in a sibling `.bak`, and
    the instruction is to restore FROM THAT BACKUP — never from git.
    """
    backup = SENTINEL.with_suffix(".bak")
    backup.write_text((ROOT / rel).read_text(encoding="utf-8"), encoding="utf-8")
    SENTINEL.write_text(
        f"A mutation is currently applied to:\n  {rel}\n"
        f"mutant: {label}\n\n"
        f"If this file exists and no mutation run is active, the run died mid-\n"
        f"mutation and the file above contains a DELIBERATE BUG.\n\n"
        f"RESTORE FROM THE BACKUP, NOT FROM GIT:\n"
        f"  cp {backup.name} {rel}\n"
        f"  rm {SENTINEL.name} {backup.name}\n\n"
        f"DO NOT run `git checkout -- {rel}`. The file may contain uncommitted\n"
        f"work that git cannot give back; the backup beside this file is the\n"
        f"pristine pre-mutation copy, including that work.\n\n"
        f"The single mutated hunk, for reference:\n"
        f"--- was ---\n{find}\n--- became ---\n{replace}\n",
        encoding="utf-8",
    )


def clear_sentinel() -> None:
    SENTINEL.with_suffix(".bak").unlink(missing_ok=True)
    SENTINEL.unlink(missing_ok=True)


def check_stale_sentinel() -> bool:
    """True when it is safe to proceed."""
    if not SENTINEL.exists():
        return True
    print("REFUSING TO RUN — a previous mutation round died mid-mutation.\n")
    print(SENTINEL.read_text(encoding="utf-8"))
    print("Restore the file above, delete the sentinel, then re-run.")
    return False


def main() -> int:
    killed: list[str] = []
    survived: list[tuple[str, str, str]] = []
    timed_out: list[str] = []

    if not check_stale_sentinel():
        return 3

    # PRE-FLIGHT: verify every anchor matches exactly once BEFORE mutating
    # anything. Round 1's whole problem was discovering this mid-run.
    print(f"Pre-flight: checking {len(MUTANTS)} anchors...", flush=True)
    bad = 0
    for label, rel, find, _replace, _why in MUTANTS:
        n = (ROOT / rel).read_text(encoding="utf-8").count(find)
        if n != 1:
            print(f"  ANCHOR-FAIL {label}: matched {n}x in {rel}", flush=True)
            bad += 1
    if bad:
        print(f"\nABORTED: {bad} anchor(s) do not match exactly once.", flush=True)
        return 2
    print("  all anchors match exactly once.\n", flush=True)

    for i, (label, rel, find, replace, why) in enumerate(MUTANTS, 1):
        path = ROOT / rel
        original = path.read_text(encoding="utf-8")
        print(f"[{i}/{len(MUTANTS)}] {label} ...", flush=True)
        try:
            write_sentinel(label, rel, find, replace)
            path.write_text(original.replace(find, replace), encoding="utf-8")
            try:
                passed = run_suite()
            except subprocess.TimeoutExpired:
                print("    killed (suite TIMED OUT)", flush=True)
                timed_out.append(label)
                killed.append(label)
                continue
            if passed:
                print("    SURVIVED  <-- TESTS DID NOT CATCH THIS", flush=True)
                survived.append((label, rel, why))
            else:
                print("    killed", flush=True)
                killed.append(label)
        finally:
            # Restore FIRST, then clear the sentinel. If the process dies
            # between the two, the sentinel remains and the next run refuses
            # to start — which is the safe direction to fail.
            path.write_text(original, encoding="utf-8")
            clear_sentinel()

    total = len(killed) + len(survived)
    print("\n" + "=" * 70, flush=True)
    print(f"ROUND 2 MUTATION SCORE: {len(killed)}/{total} killed", flush=True)
    if timed_out:
        # A timeout counts as a kill, but it is NOT evidence that an assertion
        # caught the bug, so it is called out rather than blended in.
        print(
            "\nNOTE — killed by TIMEOUT rather than by a failing assertion "
            f"({len(timed_out)}): {', '.join(timed_out)}",
            flush=True,
        )
    if survived:
        print("\nSURVIVORS (holes in the tests):", flush=True)
        for label, rel, why in survived:
            print(f"  - {label} [{rel}]\n      {why}", flush=True)
        return 1
    print("All round-2 mutants killed. The tests have teeth.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
