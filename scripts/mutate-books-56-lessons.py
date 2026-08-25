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

# The gates that should be able to see these mutations.
GATES = [
    "tests/compliance/form-box-adapters.test.ts",
    "tests/compliance/form-box-teaching-core.test.ts",
    "tests/compliance/form-box-lessons-w2.test.ts",
    "tests/compliance/form-box-lessons-wa.test.ts",
    "tests/compliance/forms-roadmap-tracker.test.ts",
    "tests/compliance/owner-report-books-53.test.ts",
    "tests/compliance/owner-report-books-54.test.ts",
    "tests/compliance/authority-routing-completeness.test.ts",
]

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
     True, "a quote is TRUNCATED, dropping the prohibition it exists to teach"),

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


ANSI = re.compile(r"\x1b\[[0-9;]*m")


def run_gates():
    """Return 'RED', 'GREEN', or 'NO-TESTS'. Rule 111: no tests is RED."""
    r = run(f"npx vitest run {' '.join(GATES)}")
    out = ANSI.sub("", r.stdout + r.stderr)
    if "No test files found" in out:
        return "NO-TESTS", out
    mfiles = re.search(r"^\s*Test Files\s+(.*)$", out, re.M)
    mtests = re.search(r"^\s*Tests\s+(.*)$", out, re.M)
    if not mfiles or not mtests:
        return "NO-TESTS", out
    if "failed" in mfiles.group(1) or "failed" in mtests.group(1):
        return "RED", out
    return "GREEN", out


def main():
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
