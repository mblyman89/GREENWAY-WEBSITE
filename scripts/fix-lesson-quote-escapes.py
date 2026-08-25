#!/usr/bin/env python3
"""
scripts/fix-lesson-quote-escapes.py

books-60 repair. A previous append wrote lesson `quote:` literals by pasting
corpus text straight into a TypeScript double-quoted string. The corpus wraps
lines, so the pasted text carried LITERAL newlines, which is a parse error --
"Unterminated string". The suite caught it loudly, which is the correct
behaviour (rule 48), but the REPAIR must not repeat the mistake: if a human
re-types the escape sequences, the same class of defect is one keystroke away.

So this script does three things, in order, and refuses to write unless all
three succeed:

  1. Finds every `quote: "` literal whose content runs past the end of its
     physical line -- i.e. every broken one. It does NOT touch valid literals.
  2. Takes the raw bytes it finds and re-emits them with json.dumps(), so the
     escaping is produced by a machine that cannot typo.
  3. Proves the resulting text is present VERBATIM in the mirrored IRS corpus
     before it is allowed to be written. A quote that is not in the corpus is a
     defect, not a formatting problem, and this script will not paper over it.

Rule 15: this is provably failable. Point CORPUS at the wrong file and every
quote fails step 3 and nothing is written.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

TARGET = Path("src/lib/payroll/form-box-lessons-941.ts")
CORPUS = Path("docs/authorities/federal/irs-instructions-941-2026.txt")

# A broken literal opens with `quote: "` and does not close on the same line.
OPEN = re.compile(r'^(?P<indent>\s*)quote: "(?P<first>.*)$')

# The pasted text is a MIXTURE: some characters arrived as raw UTF-8 (a real
# U+2019 byte sequence) and some as a literal backslash-u escape that a paste
# turned into six ASCII characters. Python's "unicode_escape" codec cannot
# handle that mixture -- it is latin-1 based and blows up on the raw bytes. So
# decode the escapes ourselves and leave every other character untouched.
_ESCAPE = re.compile(r"\\u([0-9a-fA-F]{4})|\\n|\\t|\\r|\\\\|\\\"")


def unescape(raw: str) -> str:
    def sub(m: re.Match[str]) -> str:
        whole = m.group(0)
        if whole.startswith("\\u"):
            return chr(int(m.group(1), 16))
        return {
            "\\n": "\n",
            "\\t": "\t",
            "\\r": "\r",
            "\\\\": "\\",
            '\\"': '"',
        }[whole]

    return _ESCAPE.sub(sub, raw)


def main() -> int:
    if not TARGET.exists():
        print(f"DEFECT: {TARGET} not found")
        return 1
    if not CORPUS.exists():
        print(f"DEFECT: corpus {CORPUS} not found")
        return 1

    corpus = CORPUS.read_text(encoding="utf8")
    lines = TARGET.read_text(encoding="utf8").split("\n")

    out: list[str] = []
    i = 0
    repaired = 0
    failures: list[str] = []

    while i < len(lines):
        line = lines[i]
        m = OPEN.match(line)
        if m is None:
            out.append(line)
            i += 1
            continue

        first = m.group("first")
        # Does it terminate on this line? A terminated literal ends with `",`
        # or `"` and has no unescaped quote left dangling. Count unescaped ".
        unescaped = len(re.findall(r'(?<!\\)"', first))
        if unescaped >= 1:
            # Closes on its own line. Valid already -- leave it exactly alone.
            out.append(line)
            i += 1
            continue

        # Broken. Gather physical lines until we find the closing quote.
        chunk = [first]
        j = i + 1
        closed = False
        while j < len(lines):
            nxt = lines[j]
            if re.search(r'(?<!\\)"', nxt):
                # The closing quote is on this line. Everything before it is
                # still quote content.
                k = re.search(r'(?<!\\)"', nxt)
                assert k is not None
                chunk.append(nxt[: k.start()])
                closed = True
                break
            chunk.append(nxt)
            j += 1

        if not closed:
            failures.append(f"line {i + 1}: literal never closes")
            out.append(line)
            i += 1
            continue

        # The raw text as it was pasted: physical lines rejoined with the
        # newline that broke the literal in the first place. Unescape only the
        # sequences a paste could plausibly have carried.
        raw = "\n".join(chunk)
        text = unescape(raw)

        # STEP 3: it must be in the corpus, verbatim, or we refuse.
        if text not in corpus:
            failures.append(
                f"line {i + 1}: repaired text NOT verbatim in corpus:\n---\n{text}\n---"
            )
            out.append(line)
            i += 1
            continue

        out.append(f'{m.group("indent")}quote: {json.dumps(text, ensure_ascii=False)},')
        repaired += 1
        i = j + 1

    if failures:
        print(f"REFUSING TO WRITE. {len(failures)} failure(s):")
        for f in failures:
            print("  " + f)
        return 1

    if repaired == 0:
        print("No broken literals found. Nothing written.")
        return 0

    TARGET.write_text("\n".join(out), encoding="utf8")
    print(f"Repaired {repaired} quote literal(s); each proved verbatim against the corpus.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
