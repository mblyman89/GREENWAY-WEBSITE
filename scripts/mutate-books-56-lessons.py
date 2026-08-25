#!/usr/bin/env python3
"""
MUTATION CAMPAIGN FOR THE books-56 LESSONS AND SPECIMEN CHANGES.

Rule 15: a gate must be PROVEN capable of failing. Rule 111: "no tests ran" is
RED, not green. Rule 112: a surviving mutant is a finding about the test's NAME
before it is a hole in the gate — investigate it, do not explain it away.

Each mutation states `predict_red` BEFORE it runs. A prediction that turns out
wrong is the interesting result and is reported as such rather than quietly
reconciled.

Every mutation is an exact literal string replacement, applied to a pristine
copy of the file and reverted afterwards. The harness refuses a mutation that
changes nothing (that would prove the gate green against an unmutated tree) and
refuses to run at all if the working tree is dirty.
"""

import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

ADAPTERS = "src/lib/payroll/form-box-adapters.ts"
TEACHING = "src/lib/payroll/form-box-teaching-core.ts"
LESSONS_W2 = "src/lib/payroll/form-box-lessons-w2.ts"
LESSONS_WA = "src/lib/payroll/form-box-lessons-wa.ts"
AUTH_WA = "src/lib/payroll/wa-quarterly-authorities.ts"

# ══════════════════════════════════════════════════════════════════════════════
#  WHY THIS HARNESS RUNS THE WHOLE SUITE AND NOT A CHOSEN LIST OF GATES
# ══════════════════════════════════════════════════════════════════════════════
#
# It used to run a hand-written list of eight files:
#
#     GATES = ["tests/compliance/form-box-adapters.test.ts", ... ]   # 8 entries
#
# described in the comment above it as "the gates that should be able to see
# these mutations". That list was the harness's own rule 39 defect: a verifier
# that cannot see something approves it.
#
# HOW IT WAS CAUGHT. M16 (the employee's NAME classified as money) was closed by
# tests/compliance/identifier-boxes-are-never-money.test.ts, and that gate was
# proved RED by applying M16's substitution to the real adapters file by hand:
# exit code 1, naming box e. Then this harness was re-run and reported
#
#     M16: GREEN     (predicted RED)   <== AGAINST PREDICTION
#
# Both results were correct. The mutation IS caught; this harness simply was not
# looking at the file that catches it. Measured at the time: the repository had
# 459 test files and this list named 8 of them, so 451 files - including all
# three gates written during books-56 - could not contribute a verdict.
#
# That is worse than a missing test. A missing test is silent; this printed
# "GREEN" with authority, and "GREEN" from a mutation harness is a positive
# claim that no gate anywhere objects. Acting on it would have meant deleting a
# gate that works, or - the direction that nearly happened - concluding M16 was
# an equivalent mutant and writing that conclusion into a document.
#
# WHY THE FIX IS NOT "ADD THE THREE FILES". That repeats the defect with a
# longer list, and the next gate written is invisible again. The class defect is
# the hand-maintained list itself (rule 23), so it is gone. `run_gates` now runs
# the ENTIRE suite, which is the only set that cannot fall behind, and asserts a
# floor on how many files it saw so that a collapsing suite is RED rather than
# quietly small (rule 111).
#
# COST, MEASURED, not estimated: the full suite is 459 files / 11,227 tests /
# 102 seconds on this 2-core sandbox, so 20 mutations plus two baselines is
# about 37 minutes. A mutation campaign is not something run on every commit,
# and a fast answer that can say GREEN when a gate exists and works is worth
# nothing.

# The floor below is deliberately far under the real count (459 at the time of
# writing) so that adding or removing a few test files never trips it, while a
# vitest filter typo or a collapsed config - the failure that produced this
# whole investigation - cannot be reported as GREEN.
MIN_TEST_FILES = 400

# (id, file, find, replace, predict_red, what_it_simulates)
MUTATIONS = [
    # ── The six lettered boxes: remove them, one axis at a time ──────────
    ("M1", ADAPTERS,
     '  a: {\n    whose: "not_money",\n    why:\n      "The employee\'s Social Security number, copied from their card. An identifier, not an " +',
     '  a_REMOVED: {\n    whose: "not_money",\n    why:\n      "The employee\'s Social Security number, copied from their card. An identifier, not an " +',
     True, "box a vanishes from the ownership table"),

    ("M2", TEACHING,
     '    box: "a",\n    caption: "Employee\'s SSN",',
     '    box: "a_GONE",\n    caption: "Employee\'s SSN",',
     True, "box a vanishes from the teaching specimen"),

    ("M3", LESSONS_W2,
     '    box: "a",\n    headline: "The Social Security number',
     '    box: "a_GONE",\n    headline: "The Social Security number',
     True, "the lesson for box a no longer matches any box"),

    ("M4", LESSONS_W2,
     '    box: "e",\n    headline: "The employee\'s name',
     '    box: "e_GONE",\n    headline: "The employee\'s name',
     True, "the lesson for box e - the SSA-matched name - goes missing"),

    # ── The tie that found the whole gap ────────────────────────────────
    ("M5", LESSONS_WA,
     '        formId: "form_w2",\n        box: "e",\n        why:\n          "The same name and number appear on that person\'s W-2.',
     '        formId: "form_w2",\n        box: "zzz",\n        why:\n          "The same name and number appear on that person\'s W-2.',
     True, "the 5208B tie points at a box that does not exist (the original defect)"),

    ("M6", LESSONS_WA,
     '        formId: "form_w2",\n        box: "e",\n        why:\n          "The same name and number appear on that person\'s W-2.',
     '        formId: "form_zzz",\n        box: "e",\n        why:\n          "The same name and number appear on that person\'s W-2.',
     True, "the tie points at a FORM that does not exist"),

    # ── Verbatim quotes: the silent-alteration class ─────────────────────
    ("M7", LESSONS_W2,
     '"Caution: Do not auto-populate an ITIN into box a."',
     '"Caution: Do not auto-populate an ITIN into Box a."',
     True, "one letter case changed in a quote - the exact class of defect found in wa-quarterly-authorities"),

    ("M8", LESSONS_W2,
     '"Box d\\u2014Control number. You may use this box to\\nidentify individual Forms W-2. You do not have to use this\\nbox."',
     '"Box d\\u2014Control number. You may use this box to identify individual Forms W-2. You do not have to use this box."',
     True, "a quote is 'tidied' by reflowing the IRS's line breaks into spaces"),

    ("M9", LESSONS_W2,
     '"It is especially important to report the exact last\\nname of the employee."',
     '"It is especially important to report the exact last\\nname of the employees."',
     True, "one character added to a quote"),

    ("M10", LESSONS_W2,
     '"Separate parts of a compound name with either a\\nhyphen or a blank space. Do not join them into a single\\nword."',
     '"Separate parts of a compound name with either a\\nhyphen or a blank space."',
     True, "a quote is TRUNCATED, dropping the prohibition it exists to teach. "
           "Was GREEN against prediction until books-56: it survived because the verbatim "
           "verifier cannot see a SHORTER quote and quote-truncation.test.ts only hunts "
           "MID-sentence cuts, while this one stops at a clean full stop. Now caught by "
           "tests/compliance/quote-stops-before-a-prohibition.test.ts, which reads the "
           "sentence the corpus continues with. Closing it found two real defects: 941 line 1 "
           "omitted the IRS's list of who NOT to count, and 941 line 5a omitted "
           "\"Don't include tips on this line.\""),

    ("M11", AUTH_WA,
     '"Termination of business. Each employer who stops doing business or whose account is closed " +',
     '"Each employer who stops doing business or whose account is closed " +',
     False, "drops a titled subject phrase. EQUIVALENT MUTANT - investigated three times, "
            "see docs/books-56-m11-investigation.md. 24 correct authorities legitimately omit "
            "a subject like 'In general.', so no rule can condemn this without condemning them"),

    ("M12", AUTH_WA,
     '"quarter which covers tax payments due on the date the account is closed; and (3)(e)(ii) A " +',
     '"quarter which covers tax payments due on the date the account is closed; and (ii) A " +',
     True, "re-introduces the silent renumbering half of that defect"),

    # ── The drift gate taught about colliding letters ────────────────────
    ("M13", ADAPTERS,
     '    a: "W-2 box a is the employee\'s SSN; W-3 box a is an optional control number.",',
     '    a: "short",',
     True, "an exclusion reason decays to a stub"),

    ("M14", ADAPTERS,
     '    e: "W-2 box e is the employee\'s name; W-3 box e is the employer\'s EIN.",',
     '    e: "W-2 box e is the employee\'s name; W-3 box e is the employer\'s EIN.",\n    "1": "a numbered box smuggled into the letters-only exclusion list, which must be refused outright",',
     True, "a NUMBERED box is smuggled into the letters-only exclusion list"),

    ("M15", ADAPTERS,
     '    f: "W-2 box f is the employee\'s address; W-3 box f is the employer\'s name.",',
     '    f: "W-2 box f is the employee\'s address; W-3 box f is the employer\'s name.",\n    zz: "a letter that is not on either form, so it excuses a comparison that never happens at all",',
     True, "an exclusion names a box that is on neither form"),

    # ── The whose-money classification ──────────────────────────────────
    ("M16", ADAPTERS,
     '  e: {\n    whose: "not_money",\n    why:\n      "The employee\'s name as shown on their social security card.',
     '  e: {\n    whose: "employee_money",\n    why:\n      "The employee\'s name as shown on their social security card.',
     True, "the employee's NAME is classified as money, which would money-format it on screen"),

    # ── The measured counts in the living roadmap ────────────────────────
    ("M17", "docs/ROADMAP-forms-and-lessons.md",
     "| `form-box-lessons-w2.ts` | 26 | 20 | 20 / 13 |",
     "| `form-box-lessons-w2.ts` | 20 | 20 | 20 / 13 |",
     True, "the roadmap understates the W-2 lesson count"),

    ("M18", "docs/ROADMAP-forms-and-lessons.md",
     "| **total** | **115** | **110** | **103 / 96** |",
     "| **total** | **115** | **111** | **103 / 96** |",
     True, "the roadmap total ties drifts by one"),

    # ── The dated-pin corrections ───────────────────────────────────────
    ("M19", "tests/compliance/owner-report-books-54.test.ts",
     "    expect(lessonsFor5208b).toHaveLength(4);",
     "    expect(lessonsFor5208b.length).toBeGreaterThan(0);",
     False, "the 5208B pin is loosened from exact to non-zero - EQUIVALENT while 4 lessons exist"),

    ("M20", LESSONS_WA,
     '    box: "employee",\n    headline: "Name and Social Security number',
     '    box: "employee_GONE",\n    headline: "Name and Social Security number',
     True, "the 5208B employee lesson stops matching its box"),
]


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, shell=True, **kw)


def tree_is_clean():
    return run("git status --porcelain").stdout.strip() == ""


# ══════════════════════════════════════════════════════════════════════════════
#  CRASH SAFETY: `finally` DOES NOT RUN IF THE PROCESS IS KILLED
# ══════════════════════════════════════════════════════════════════════════════
#
# This harness deliberately edits REAL source files and relies on try/finally to
# put them back. That is sound for an exception and useless for a kill.
#
# It happened. A sibling probe running these same mutations against the full
# suite was killed by a command timeout partway through M12, and it left
#
#     M src/lib/payroll/wa-quarterly-authorities.ts
#
# on disk with the mutated subsection numbering in it - the very defect M12
# exists to simulate, sitting in the working tree looking like authored work. It
# was recovered with `git checkout --` and the leftover .mutbak was byte-identical
# to the committed copy, so nothing was lost. But the next person to hit that has
# no reason to know a mutation is why the file changed, and on this sandbox
# - which crashes often, and is the reason rule 110 exists - a kill mid-mutation
# is a routine event rather than a remote one.
#
# So two things, neither of which relies on this process staying alive:
#
#   1. A LEFTOVER BACKUP IS A REFUSAL TO START. If a .mutbak exists, a previous
#      run died holding a mutation. The harness will not add a second layer of
#      edits on top of an unknown state; it says exactly which file to restore.
#
#   2. THE BACKUP IS NAMED SO IT CANNOT BE MISTAKEN FOR WORK. `.mutbak` sitting
#      beside a modified source file is the signal that the modification is a
#      mutation, not a change someone made on purpose.
#
# The recovery instruction is `git checkout -- <file>` rather than "move the
# .mutbak back", because git's copy is the authority and the .mutbak may itself
# have been written by a half-finished run.
def refuse_if_a_previous_run_died():
    leftovers = sorted(str(p.relative_to(REPO)) for p in REPO.rglob("*.mutbak"))
    if not leftovers:
        return False
    print("REFUSING TO RUN: a previous mutation run left backup files behind, which means")
    print("it was killed while a source file was MUTATED. The working tree may contain a")
    print("deliberate defect that looks like authored code. Restore before running again:")
    print()
    for rel in leftovers:
        print(f"    git checkout -- {rel[: -len('.mutbak')]}")
        print(f"    rm {rel}")
    print()
    print("Verify with `git status --porcelain` before re-running.")
    return True


ANSI = re.compile(r"\x1b\[[0-9;]*m")


def run_gates():
    """Run the WHOLE suite. Return 'RED', 'GREEN', 'NO-TESTS' or 'TOO-FEW'.

    Rule 111: no tests is RED. TOO-FEW is the same idea one step earlier - a run
    that saw a fraction of the suite must not be able to say GREEN, because that
    is exactly how the eight-file GATES list reported M16 as uncaught while the
    gate that catches it sat on disk, passing, unread.
    """
    r = run("npx vitest run")
    out = ANSI.sub("", r.stdout + r.stderr)
    if "No test files found" in out:
        return "NO-TESTS", out
    mfiles = re.search(r"^\s*Test Files\s+(.*)$", out, re.M)
    mtests = re.search(r"^\s*Tests\s+(.*)$", out, re.M)
    if not mfiles or not mtests:
        return "NO-TESTS", out
    if "failed" in mfiles.group(1) or "failed" in mtests.group(1):
        return "RED", out

    # GREEN is only allowed to mean "nothing objected" if enough was asked.
    # Count every file total vitest reports, passed or otherwise.
    seen = sum(int(n) for n in re.findall(r"(\d+)\s+(?:passed|failed|skipped)", mfiles.group(1)))
    if seen < MIN_TEST_FILES:
        return "TOO-FEW", out + f"\n\nHARNESS: only {seen} test files ran, expected >= {MIN_TEST_FILES}"
    return "GREEN", out


def main():
    if refuse_if_a_previous_run_died():
        return 2

    if not tree_is_clean():
        print("REFUSING TO RUN: working tree is dirty. Commit first.")
        return 2

    print("Baseline ...", flush=True)
    verdict, _ = run_gates()
    if verdict != "GREEN":
        print(f"REFUSING TO RUN: baseline is {verdict}, not GREEN.")
        return 2
    print("Baseline GREEN.\n")

    results = []
    for mid, relpath, find, repl, predict_red, what in MUTATIONS:
        path = REPO / relpath
        original = path.read_text(encoding="utf-8")

        if find not in original:
            print(f"{mid}: LITERAL NOT FOUND in {relpath} -- harness bug, not a result")
            results.append((mid, "NOT-FOUND", predict_red, what))
            continue

        mutated = original.replace(find, repl, 1)
        if mutated == original:
            print(f"{mid}: NO-OP mutation, refused")
            results.append((mid, "NO-OP", predict_red, what))
            continue

        backup = path.with_suffix(path.suffix + ".mutbak")
        shutil.copy2(path, backup)
        try:
            path.write_text(mutated, encoding="utf-8")
            verdict, _ = run_gates()
        finally:
            shutil.move(str(backup), str(path))

        # TOO-FEW is neither a caught mutation nor a surviving one: it means this
        # harness did not ask the question. Counting it either way would launder a
        # tooling fault into a result about the code, which is the precise mistake
        # the old GATES list made. Stop instead (rule 48 - fail loudly).
        if verdict == "TOO-FEW":
            print(
                f"{mid}: TOO-FEW test files ran -- this is a HARNESS fault, not a result.\n"
                f"Refusing to continue: a partial run cannot be reported as caught or survived.\n"
                f"The file has already been restored; check the vitest invocation."
            )
            return 2

        caught = verdict in ("RED", "NO-TESTS")
        agree = caught == predict_red
        flag = "" if agree else "   <== AGAINST PREDICTION"
        print(f"{mid}: {verdict:9s} (predicted {'RED' if predict_red else 'GREEN'}){flag}  {what}")
        results.append((mid, verdict, predict_red, what))

    print("\n" + "=" * 72)
    red = sum(1 for _, v, _, _ in results if v in ("RED", "NO-TESTS"))
    green = sum(1 for _, v, _, _ in results if v == "GREEN")
    surprises = [r for r in results if (r[1] in ("RED", "NO-TESTS")) != r[2]]
    print(f"{len(results)} mutations: {red} caught, {green} survived")
    if surprises:
        print("\nAGAINST PREDICTION -- each must be investigated, not explained away (rule 112):")
        for mid, v, p, what in surprises:
            print(f"  {mid}: {v} but predicted {'RED' if p else 'GREEN'} -- {what}")

    print(f"\nTree clean after run: {tree_is_clean()}")
    verdict, _ = run_gates()
    print(f"Baseline re-check: {verdict}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
