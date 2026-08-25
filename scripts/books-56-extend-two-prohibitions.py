#!/usr/bin/env python3
"""
books-56: extend the two 941 quotations that stop immediately before the IRS's
own prohibition.

Both were found by measurement, not reading: a candidate rule asked "does this
quote stop immediately before a sentence that OPENS with a prohibition?" and
these two were the only hits across 127 checkable quotations.

  941 line 1  stops at "...Form 941." The corpus continues "Don't include:" and
              then lists the five categories of person who must NOT be counted.
              A lesson about counting employees that omits who not to count
              teaches the wrong number.

  941 line 5a stops at "Enter the amount before payroll deductions." The corpus
              continues "Don't include tips on this line." Tips belong on 5b.
              Greenway is a retailer; tips happen.

Same refusal discipline as books-56-extend-19-quotations.py: nothing is written
unless EVERY job passes every precondition. An extension must be a strict
superset of what it replaces, must appear byte-for-byte in ITS OWN declared
corpus, and its anchor must be unique in the source file.
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# (source file, corpus file, note, old, new)
JOBS = [
    (
        "src/lib/payroll/form-box-lessons-941.ts",
        "docs/authorities/federal/irs-instructions-941-2026.txt",
        "line 1 - who NOT to count",
        "Enter the number of employees on your payroll for the pay\nperiod including March 12, June 12, September 12, or\nDecember 12, for the quarter indicated at the top of Form\n941.",
        "Enter the number of employees on your payroll for the pay\nperiod including March 12, June 12, September 12, or\nDecember 12, for the quarter indicated at the top of Form\n941. Don\u2019t include:\n\u2022 Household employees,\n\u2022 Employees in nonpay status for the pay period,\n\u2022 Farm employees,\n\u2022 Pensioners, or\n\u2022 Active members of the U.S. Armed Forces.",
    ),
    (
        "src/lib/payroll/form-box-lessons-941.ts",
        "docs/authorities/federal/irs-instructions-941-2026.txt",
        "line 5a - tips are not wages here",
        "Enter the amount before payroll deductions.",
        "Enter the amount before payroll deductions. Don\u2019t\ninclude tips on this line.",
    ),
]


def main() -> int:
    corpora: dict[str, str] = {}
    sources: dict[str, str] = {}
    problems: list[str] = []

    for frel, crel, note, old, new in JOBS:
        for rel, store in ((frel, sources), (crel, corpora)):
            if rel not in store:
                p = REPO / rel
                if not p.exists():
                    problems.append(f"{note}: MISSING FILE {rel}")
                    store[rel] = ""
                else:
                    store[rel] = p.read_text(encoding="utf-8")

    for i, (frel, crel, note, old, new) in enumerate(JOBS, 1):
        # 1. An extension only ever ADDS. Never a rewrite.
        if not new.startswith(old):
            problems.append(f"job {i} ({note}): new text is not an extension of old")
        # 2. The extension must be verbatim in ITS OWN declared corpus - not in
        #    "some corpus". The deleted fixer script chose corpora by
        #    trial-and-error and would have spliced a title page into a lesson.
        if new not in corpora.get(crel, ""):
            problems.append(f"job {i} ({note}): extended text is NOT byte-for-byte in {crel}")
        # 3. The anchor must be unique in the source file, because the lesson
        #    gate locates quotes with lastIndexOf and a duplicate anchor would
        #    silently edit the wrong lesson. This is the 941 line 5c defect.
        needle = json.dumps(old, ensure_ascii=False)
        alt = json.dumps(old, ensure_ascii=True)
        src = sources.get(frel, "")
        n = src.count(needle) + (src.count(alt) if alt != needle else 0)
        if n != 1:
            problems.append(
                f"job {i} ({note}): anchor appears {n} times in {frel}, expected exactly 1"
            )

    if problems:
        print("REFUSING - nothing written:")
        for p in problems:
            print("  -", p)
        return 1

    added = 0
    for frel, crel, note, old, new in JOBS:
        p = REPO / frel
        s = p.read_text(encoding="utf-8")
        a = json.dumps(old, ensure_ascii=False)
        b = json.dumps(new, ensure_ascii=False)
        assert s.count(a) == 1, f"{note}: anchor count changed under us"
        p.write_text(s.replace(a, b, 1), encoding="utf-8")
        added += len(new) - len(old)
        print(f"extended: {note}  (+{len(new) - len(old)} chars)")

    print(f"\n2 quotations extended, {added} characters added, 0 removed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
