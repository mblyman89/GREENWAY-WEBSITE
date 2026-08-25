#!/usr/bin/env python3
"""
Mutation harness for the Paid Leave / WA Cares CSV writer and its gate.

Rule 15: a test that cannot fail is not a test. Rule 111: "no tests" is RED.

Lessons already paid for, encoded here so they are not paid for twice:

  • EXACT LITERAL REPLACEMENT ONLY. An earlier bash harness used perl \Q…\E and
    the quoting silently failed, so three mutations never applied and were
    scored as "survived". Here, if the search text is not found, or the file is
    unchanged after replacement, the mutation is reported SKIPPED — never GREEN
    and never RED.

  • A MUTATION MUST TOUCH LIVE CODE. Another earlier mutation replaced a string
    that appears only inside a comment, and a no-op was reported as a survival.
    `--code-only` mutations assert the matched line is not a comment.

  • READ THE `Test Files` LINE, NOT ONLY `Tests`. Renaming an export once made a
    module fail to LOAD; vitest printed "Test Files 1 failed" and "Tests no
    tests", and a harness that read only the second line called it GREEN. Here,
    "no tests" or a failed file with zero counted failures is RED.

  • STRIP ANSI BEFORE PARSING. vitest colourises between "Tests" and the number.

Usage:  python3 scripts/mutate-esd-csv.py
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WRITER = REPO / "src/lib/payroll/esd-paid-leave-csv-core.ts"
GATE = REPO / "tests/compliance/esd-paid-leave-csv.test.ts"
MIRROR = REPO / "docs/authorities/state-wa/esd-paid-leave-csv-plain-text-sample.txt"

ANSI = re.compile(r"\x1b\[[0-9;]*m")


@dataclass
class Mutation:
    ident: str
    target: Path
    find: str
    replace: str
    why: str
    predict_red: bool
    code_only: bool = True


MUTATIONS: list[Mutation] = [
    # ───────────────────────────── the four formatting rules ────────────────
    Mutation(
        "M1-hours-round-half-up",
        WRITER,
        "  return Math.ceil(exactHours);",
        "  return Math.round(exactHours);",
        "ESD demands hours round UP. Half-up under-reports 152.01 as 152.",
        True,
    ),
    Mutation(
        "M2-hours-round-down",
        WRITER,
        "  return Math.ceil(exactHours);",
        "  return Math.floor(exactHours);",
        "Rounding down under-reports every fractional hour.",
        True,
    ),
    Mutation(
        "M3-wages-thousands-separator",
        WRITER,
        '  return `${dollars}.${String(cents).padStart(2, "0")}`;',
        '  return `${dollars.toLocaleString("en-US")}.${String(cents).padStart(2, "0")}`;',
        "toLocaleString inserts the comma the spec forbids, and it is the "
        "obvious way to format money, so the gate must catch it.",
        True,
    ),
    Mutation(
        "M4-wages-one-decimal",
        WRITER,
        '  return `${dollars}.${String(cents).padStart(2, "0")}`;',
        "  return `${dollars}.${cents}`;",
        "Without padStart, 5000.50 becomes 5000.5 and 0.01 becomes 0.1 — a "
        "tenfold error on cents.",
        True,
    ),
    Mutation(
        "M5-ssn-strip-hyphens",
        WRITER,
        '  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;',
        "  return digits;",
        "Writing a bare SSN is spec-legal but drops the leading-zero "
        "protection. The gate pins the hyphenated choice, so it must notice.",
        True,
    ),
    Mutation(
        "M6-dob-slashed",
        WRITER,
        '  return `${m![2]}${m![3]}${m![1]}`;',
        '  return `${m![2]}/${m![3]}/${m![1]}`;',
        "The slashed form is a legal INPUT but not what ESD's finished file "
        "contains. This is the finding the screenshot corrected.",
        True,
    ),
    Mutation(
        "M7-dob-day-month-swapped",
        WRITER,
        '  return `${m![2]}${m![3]}${m![1]}`;',
        '  return `${m![3]}${m![2]}${m![1]}`;',
        "DDMMYYYY instead of MMDDYYYY. Silent for 12 days a month, wrong for "
        "the rest, and it misstates a person's date of birth.",
        True,
    ),
    Mutation(
        "M8-wacares-inverted",
        WRITER,
        '  return exempt ? "Y" : "N";',
        '  return exempt ? "N" : "Y";',
        "Inverting the exemption flag misstates every employee's WA Cares "
        "status — the worst single-character error available here.",
        True,
    ),
    Mutation(
        "M9-wacares-always-blank",
        WRITER,
        '  return exempt ? "Y" : "N";',
        '  return "";',
        "Always blank loses a real Y. Blank is legal for N only.",
        True,
    ),
    # ───────────────────────────── the omission rule ─────────────────────────
    Mutation(
        "M10-omission-or-instead-of-and",
        WRITER,
        "    if (hours === 0 && r.grossWagesCents === 0) {",
        "    if (hours === 0 || r.grossWagesCents === 0) {",
        "THE headline defect. `||` silently deletes a paid employee who has "
        "zero recorded hours from a statutory filing.",
        True,
    ),
    Mutation(
        "M11-omission-on-exact-hours",
        WRITER,
        "    if (hours === 0 && r.grossWagesCents === 0) {",
        "    if (r.exactHours === 0 && r.grossWagesCents === 0) {",
        "Judging omission before rounding is subtler: 0.25 hours rounds up to "
        "1 and must be filed. This mutation keeps it dropped.",
        True,
    ),
    Mutation(
        "M12-no-omission-at-all",
        WRITER,
        "      omitted.push(r.ssn);\n      continue;",
        "      omitted.push(r.ssn);",
        "Recording the omission but writing the row anyway — the failure mode "
        "where a report and reality disagree.",
        True,
    ),
    # ───────────────────────────── the header ────────────────────────────────
    Mutation(
        "M13-header-tidied-spacing",
        WRITER,
        '  "SSN,LastName,FirstName,MiddleInitial,Hours,Wages,WACaresExempt(Y/N),DOB (MMDDYYYY)";',
        '  "SSN,LastName,FirstName,MiddleInitial,Hours,Wages,WACaresExempt (Y/N),DOB(MMDDYYYY)";',
        "The plausible 'improvement': make the two headings consistent. ESD's "
        "own inconsistency is the requirement.",
        True,
    ),
    Mutation(
        "M14-header-omitted",
        WRITER,
        "  const lines: string[] = [PAID_LEAVE_HEADER];",
        "  const lines: string[] = [];",
        "Paid Leave REQUIRES headers; EAMS FORBIDS them. Dropping the header "
        "turns this into the wrong department's file.",
        True,
    ),
    Mutation(
        "M15-eams-column-order-used",
        WRITER,
        '  "SSN,LastName,FirstName,MiddleInitial,Hours,Wages,WACaresExempt(Y/N),DOB (MMDDYYYY)";',
        '  EAMS_COLUMN_ORDER.join(",");',
        "The two-file confusion made concrete: same field count, different "
        "meanings.",
        True,
    ),
    # ───────────────────────────── refusals ──────────────────────────────────
    Mutation(
        "M16-dob-default-instead-of-refusal",
        WRITER,
        '    if (r.dateOfBirth.trim() === "") {',
        "    if (false) {",
        "Rule 62d. A missing DOB must refuse, never default.",
        True,
    ),
    Mutation(
        "M17-comma-check-removed",
        WRITER,
        '      if (value.includes(",")) {',
        "      if (false) {",
        "Without the delimiter check a comma in a name shifts every later "
        "column left — the defect found by asking what the writer does with it.",
        True,
    ),
    Mutation(
        "M18-empty-roster-allowed",
        WRITER,
        "  if (rows.length === 0) {",
        "  if (false) {",
        "An empty roster is a missing report, not an empty one.",
        True,
    ),
    Mutation(
        "M19-field-count-selfcheck-removed",
        WRITER,
        "      line.split(\",\").length === PAID_LEAVE_COLUMN_COUNT,",
        "      true,",
        "Removing the writer's own invariant. PREDICTED GREEN: every other "
        "gate already pins the field count, so this guard is defence in depth "
        "rather than the only guard. Stated in advance so a green is a finding "
        "about redundancy, not a surprise.",
        False,
    ),
    Mutation(
        "M20-integer-cents-check-removed",
        WRITER,
        "    if (!Number.isInteger(r.grossWagesCents)) {",
        "    if (false) {",
        "A float in a money path must be refused, not formatted.",
        True,
    ),
    # ───────────────────────────── the fixture itself ────────────────────────
    Mutation(
        "M21-mirror-sample-corrupted",
        MIRROR,
        "034-35-4567,Smith,Jane,,4,70.00,N,12112000",
        "034-35-4567,Smith,Jane,,4,70.00,N,12/11/2000",
        "If the mirrored fixture is edited, the gate must fail rather than "
        "quietly re-baseline. Proves the gate reads the authority for real.",
        True,
        code_only=False,
    ),
    Mutation(
        "M22-mirror-emptied",
        MIRROR,
        "SSN,LastName,FirstName,MiddleInitial,Hours,Wages,WACaresExempt(Y/N),DOB (MMDDYYYY)",
        "SSN,LastName",
        "A stubbed fixture must be caught by the vacuity guard, not treated as "
        "a passing file.",
        True,
        code_only=False,
    ),
]


def is_comment_line(line: str) -> bool:
    s = line.strip()
    return s.startswith("*") or s.startswith("//") or s.startswith("/*")


def run_gate() -> tuple[bool, str]:
    """Return (passed, summary). Rule 111: 'no tests' is RED."""
    proc = subprocess.run(
        ["npx", "vitest", "run", "tests/compliance/esd-paid-leave-csv.test.ts"],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=900,
    )
    out = ANSI.sub("", proc.stdout + proc.stderr)

    files_line = ""
    tests_line = ""
    for line in out.splitlines():
        st = line.strip()
        if st.startswith("Test Files"):
            files_line = st
        elif st.startswith("Tests "):
            tests_line = st

    summary = f"{files_line} | {tests_line}".strip(" |")

    # Rule 111: a module that fails to load reports "no tests".
    if "no tests" in tests_line or not tests_line:
        return False, (summary or "NO SUMMARY") + "  <<< NO TESTS RAN"
    if "failed" in files_line or "failed" in tests_line:
        return False, summary
    if "passed" in tests_line:
        return True, summary
    return False, summary + "  <<< UNPARSEABLE"


def main() -> int:
    originals = {p: p.read_text(encoding="utf-8") for p in {WRITER, GATE, MIRROR}}

    print("=" * 78)
    print("BASELINE — must be GREEN before any mutation is trusted")
    print("=" * 78)
    ok, summary = run_gate()
    print(f"  {summary}")
    if not ok:
        print("  BASELINE IS RED. Nothing below would mean anything. Stopping.")
        return 1
    print("  baseline green\n")

    results: list[tuple[str, str, bool, str]] = []

    for m in MUTATIONS:
        original = originals[m.target]
        if m.find not in original:
            results.append((m.ident, "SKIPPED", False, "search text not found"))
            print(f"[{m.ident}] SKIPPED — search text not found; mutation never applied")
            continue

        if m.code_only:
            hit = next(
                (ln for ln in original.splitlines() if m.find.splitlines()[0].strip() in ln),
                "",
            )
            if is_comment_line(hit):
                results.append((m.ident, "SKIPPED", False, "matched a comment, not live code"))
                print(f"[{m.ident}] SKIPPED — matched a comment line, not live code")
                continue

        mutated = original.replace(m.find, m.replace, 1)
        if mutated == original:
            results.append((m.ident, "SKIPPED", False, "replacement was a no-op"))
            print(f"[{m.ident}] SKIPPED — replacement produced no change")
            continue

        m.target.write_text(mutated, encoding="utf-8")
        try:
            passed, summary = run_gate()
        finally:
            m.target.write_text(original, encoding="utf-8")

        caught = not passed
        agreed = caught == m.predict_red
        verdict = "RED (caught)" if caught else "GREEN (survived)"
        mark = "as predicted" if agreed else ">>> OPPOSITE TO PREDICTION <<<"
        results.append((m.ident, verdict, agreed, summary))
        print(f"[{m.ident}] {verdict} — {mark}")
        print(f"           predicted {'RED' if m.predict_red else 'GREEN'} because: {m.why}")
        print(f"           {summary}")

    # Restore and re-verify — rule 111d.
    for p, text in originals.items():
        p.write_text(text, encoding="utf-8")

    print("\n" + "=" * 78)
    print("SUMMARY")
    print("=" * 78)
    for ident, verdict, agreed, _ in results:
        flag = "" if agreed or verdict == "SKIPPED" else "   <<< INVESTIGATE"
        print(f"  {ident:38s} {verdict}{flag}")

    skipped = [r for r in results if r[1] == "SKIPPED"]
    surprises = [r for r in results if r[1] != "SKIPPED" and not r[2]]
    print(f"\n  applied: {len(results) - len(skipped)}   skipped: {len(skipped)}")
    print(f"  opposite to prediction: {len(surprises)}")

    print("\nRestored. Re-running baseline (rule 111d):")
    ok, summary = run_gate()
    print(f"  {summary}")
    print("  baseline green again" if ok else "  BASELINE STILL RED — TREE IS DIRTY")

    diff = subprocess.run(
        ["git", "diff", "--stat"], cwd=REPO, capture_output=True, text=True
    ).stdout.strip()
    print("\ngit diff --stat after restore:")
    print(diff if diff else "  (clean — no residue)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
