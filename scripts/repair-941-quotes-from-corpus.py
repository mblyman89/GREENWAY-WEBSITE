#!/usr/bin/env python3
"""
scripts/repair-941-quotes-from-corpus.py

books-60. Three of the four lesson quotes I appended for Form 941 were NOT
verbatim -- fix-lesson-quote-escapes.py refused to write and printed them. The
mistakes were not typos in the escaping; they were mistakes in the TEXT:

  * line 5e  -- I broke the line after "Add" instead of after "Add the", and I
                dropped the closing sentence "Enter the result on line 5e."
  * line 6   -- I invented a heading "6. Total taxes before adjustments." with a
                trailing period. The IRS prints a section HEADING, title-cased
                and with no period: "6. Total Taxes Before Adjustments".
  * line 10  -- same class of error: invented "10. Total taxes after
                adjustments." for a heading that reads "10. Total Taxes After
                Adjustments".

That is precisely the failure rules 24/35 exist to catch: authority-shaped text
that is wrong. The repair therefore never re-types the words. It names a LINE
RANGE in the mirrored corpus, slices it, and emits the slice. The only thing a
human supplies is the range, and if the range is wrong the verbatim assertion
still holds (it is a slice of the file) but the CONTENT check below catches it:
each range must start with the box marker it claims.

Rule 15: provably failable. Change a range's expected prefix and it refuses.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

TARGET = Path("src/lib/payroll/form-box-lessons-941.ts")
CORPUS = Path("docs/authorities/federal/irs-instructions-941-2026.txt")

# (1-based inclusive start, 1-based inclusive end, prefix the slice must start
# with). The prefix is the guard: it proves the range still points at the box we
# mean even if the mirrored file is ever re-extracted and the lines shift.
RANGES: list[tuple[int, int, str]] = [
    (1212, 1214, "5e. Total social security and Medicare taxes."),
    (1241, 1246, "6. Total Taxes Before Adjustments"),
    (1261, 1269, "7. Current quarter\u2019s adjustment for fractions of"),
    (1313, 1315, "10. Total Taxes After Adjustments"),
]

# NOTE ON ORDER: the ranges are consumed in the order the broken literals appear
# in the TARGET file, which is 5e, 6, 7, 10 -- the same order the boxes are
# appended. Box 7's pasted text happened to be correct, but it was still broken
# ESCAPING, so it is repaired here too rather than left as the one hand-typed
# literal among four machine-emitted ones.

OPEN = re.compile(r'^(?P<indent>\s*)quote: "(?P<first>.*)$')


def main() -> int:
    corpus_lines = CORPUS.read_text(encoding="utf8").split("\n")
    corpus = "\n".join(corpus_lines)

    slices: list[str] = []
    for start, end, prefix in RANGES:
        text = "\n".join(corpus_lines[start - 1 : end])
        if not text.startswith(prefix):
            print(f"REFUSING: lines {start}-{end} do not start with {prefix!r}")
            print(f"  they start with: {text[:80]!r}")
            return 1
        if text not in corpus:
            print(f"REFUSING: slice {start}-{end} is not present in the corpus")
            return 1
        slices.append(text)

    lines = TARGET.read_text(encoding="utf8").split("\n")
    out: list[str] = []
    i = 0
    used = 0

    while i < len(lines):
        m = OPEN.match(lines[i])
        if m is None:
            out.append(lines[i])
            i += 1
            continue
        if len(re.findall(r'(?<!\\)"', m.group("first"))) >= 1:
            # Terminates on its own line: a valid literal. Untouched.
            out.append(lines[i])
            i += 1
            continue

        # Broken literal. Find where it ends so we can drop the whole span.
        j = i + 1
        while j < len(lines) and re.search(r'(?<!\\)"', lines[j]) is None:
            j += 1
        if j >= len(lines):
            print(f"REFUSING: literal at line {i + 1} never closes")
            return 1

        if used >= len(slices):
            print(f"REFUSING: more broken literals than supplied ranges (at line {i + 1})")
            return 1

        out.append(f'{m.group("indent")}quote: {json.dumps(slices[used], ensure_ascii=False)},')
        used += 1
        i = j + 1

    if used != len(slices):
        print(f"REFUSING: repaired {used} literal(s) but {len(slices)} ranges were supplied")
        return 1

    TARGET.write_text("\n".join(out), encoding="utf8")
    print(f"Repaired {used} quote literal(s), each a verbatim slice of {CORPUS}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
