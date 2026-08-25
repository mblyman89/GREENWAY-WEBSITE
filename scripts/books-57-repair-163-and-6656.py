#!/usr/bin/env python3
"""
books-57: repair the §163(h) and §6656 quotations, which were EDITORIAL
RECONSTRUCTIONS, and delete the now-paid debt entry for IRC_163_A_INTEREST.

WHY THESE TWO SURFACED ONLY NOW. Their cites are written "26 U.S.C. § 163(a)"
and "26 U.S.C. § 6656(a)" WITH a space after the section sign, and both routers
in verify-verbatim-quotes.ts demanded `§` with none. So neither was ever looked
for: they were filed under "no local copy to check against" while nobody had
ever tried to find a copy. Fixing the routers turned that silence into rule
48's LOUD failure ("in a corpus we MIRROR, but no file was found"), the files
were then fetched, and the comparison finally ran for the first time.

Both failed, in the same way as §162(f) and §6651 before them:

  §163 - the corpus prints "(a) General rule." on its own line, a blank line,
  then the body. The quote read "(a) General rule.—There shall be allowed..."
  with an em-dash the statute does not contain, and did the same at (h)(1).

  §6656 - the quote opened "(a) In the case of any failure by any person to
  deposit ... on the date prescribed therefor", which deletes the heading
  "Underpayment of deposits.", and then elided the parenthetical "(as required
  by this title or by regulations of the Secretary under this title)". It also
  rendered the applicable-percentage tiers with a bare "(b)(1)(A) ... the term
  'applicable percentage' means —" using straight quotes where the corpus has
  curly ones, and an em-dash placed where the statute has none.

THE PATTERN, NOW SEEN FIVE TIMES. Every one of these reads better than the
statute. That is exactly why they survive review: a fluent reconstruction that
is substantively correct is invisible to a reader and fatal to rule 24/35,
which says verbatim or no feature. Michael's entire reason for the teaching
layer is that the lessons rest on legal text and not on someone's rendering of
it - "I want true accuracy, not taking my bad form filling and calling it
source material."

WHAT IS NOT CHANGED. No soWhat prose. The meanings were right; only the
transcriptions were wrong, and rewriting the explanations would bury that
distinction.

Refusal discipline, as with the other repairs in this line of work: nothing is
written unless EVERY new quote verifies segment-by-segment, in order, against
its own declared corpus, and every quote block is locatable by const name.
"""
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
AUTH = REPO / "docs" / "authorities" / "federal"
MIN_SEGMENT_CHARS = 40


def normalise(text: str) -> str:
    """Mirror of the verifier's `normalise`, used only to CHECK before writing.
    The TypeScript verifier remains the authority and is run immediately after."""
    t = re.sub(r"\n\s*\n\s*\d{1,4}\s*\n?\f", "\n", text)
    t = re.sub(r"\.\d(?=\n)", ".", t)
    t = t.replace("\u2014", "-").replace("\u2019", "'")
    t = t.replace("\u201c", '"').replace("\u201d", '"')
    t = re.sub(r"\[\s*(?:ARB|FAS|FIN|ASU|EITF|SOP|APB|CON)[^\]]*\]", " ", t)
    t = re.sub(r"[\[\]]", " ", t)
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"\s*-\s*", " - ", t)
    return t.strip()


def as_ts_literal(text: str, indent: str = "    ") -> str:
    """Render a quote as the concatenated string literals this codebase uses."""
    flat = text.replace("\n", "\\n")
    words = flat.split(" ")
    lines: list[str] = []
    cur = ""
    for w in words:
        candidate = w if not cur else cur + " " + w
        if len(candidate) > 96 and cur:
            lines.append(cur + " ")
            cur = w
        else:
            cur = candidate
    if cur:
        lines.append(cur)
    out = []
    for i, ln in enumerate(lines):
        esc = ln.replace('"', '\\"')
        suffix = " +" if i < len(lines) - 1 else ","
        out.append(f'{indent}"{esc}"{suffix}')
    return "\n".join(out)


# (source file, corpus file, authority const name, new verbatim quote)
JOBS = [
    (
        "src/lib/accounting/tax-penalty-authorities.ts",
        "usc-163.txt",
        "IRC_163_H_PERSONAL_INTEREST",
        "(a) General rule.\nThere shall be allowed as a deduction all interest paid or accrued "
        "within the taxable year on indebtedness. ... (h) Disallowance of deduction for personal "
        "interest.\n(1) In general.\nIn the case of a taxpayer other than a corporation, no "
        "deduction shall be allowed under this chapter for personal interest paid or accrued "
        "during the taxable year.",
    ),
    (
        "src/lib/payroll/payroll-tax-authorities.ts",
        "usc-6656.txt",
        "IRC_6656_DEPOSIT_PENALTY",
        "(a) Underpayment of deposits.\nIn the case of any failure by any person to deposit (as "
        "required by this title or by regulations of the Secretary under this title) on the date "
        "prescribed therefor any amount of tax imposed by this title in such government depository "
        "as is authorized under section 6302(c) to receive such deposit, unless it is shown that "
        "such failure is due to reasonable cause and not due to willful neglect, there shall be "
        "imposed upon such person a penalty equal to the applicable percentage of the amount of the "
        "underpayment.\n(b) Definitions. For purposes of subsection (a)\u2014\n(1) Applicable "
        "percentage.\n(A) In general. Except as provided in subparagraph (B), the term "
        "\u201capplicable percentage\u201d means\u2014\n(i)\n2 percent if the failure is for not "
        "more than 5 days,\n(ii)\n5 percent if the failure is for more than 5 days but not more "
        "than 15 days, and\n(iii)\n10 percent if the failure is for more than 15 days.",
    ),
]


def find_quote_block(src: str, const_name: str):
    """Locate the `quote:` block of one exported authority, BY CONST NAME."""
    decl = re.search(rf"export const {re.escape(const_name)}\s*:", src)
    if not decl:
        return None
    tail = src[decl.end():]
    qm = re.search(r"\n  quote:\n", tail)
    if not qm:
        return None
    start = decl.end() + qm.start()
    after = decl.end() + qm.end()
    nxt = re.search(r"\n  [a-zA-Z]+:", src[after:])
    if not nxt:
        return None
    return start, after + nxt.start()


def main() -> int:
    problems: list[str] = []
    corpora: dict[str, str] = {}
    sources: dict[str, str] = {}

    for frel, crel, const_name, new in JOBS:
        if crel not in corpora:
            p = AUTH / crel
            if not p.exists():
                problems.append(f"{const_name}: MISSING CORPUS {crel}")
                corpora[crel] = ""
            else:
                corpora[crel] = normalise(p.read_text(encoding="utf-8"))
        if frel not in sources:
            p = REPO / frel
            if not p.exists():
                problems.append(f"{const_name}: MISSING SOURCE {frel}")
                sources[frel] = ""
            else:
                sources[frel] = p.read_text(encoding="utf-8")

    for frel, crel, const_name, new in JOBS:
        hay = corpora.get(crel, "")
        segs = [s.strip() for s in re.split(r"\s*\.\.\.\s*", normalise(new)) if s.strip()]
        if len(segs) > 1 and any(len(s) < MIN_SEGMENT_CHARS for s in segs):
            problems.append(f"{const_name}: an elided segment is under {MIN_SEGMENT_CHARS} chars")
        cursor = 0
        for i, s in enumerate(segs, 1):
            at = hay.find(s, cursor)
            if at < 0:
                problems.append(
                    f"{const_name}: segment {i}/{len(segs)} NOT verbatim in {crel}: {s[:100]!r}"
                )
                break
            cursor = at + len(s)
        if find_quote_block(sources.get(frel, ""), const_name) is None:
            problems.append(f"{const_name}: could not locate its quote block in {frel}")

    if problems:
        print("REFUSING - nothing written:")
        for p in problems:
            print("  -", p)
        return 1

    for frel, crel, const_name, new in JOBS:
        p = REPO / frel
        src = p.read_text(encoding="utf-8")
        span = find_quote_block(src, const_name)
        assert span is not None, const_name
        start, end = span
        block = "\n  quote:\n" + as_ts_literal(new)
        p.write_text(src[:start] + block + src[end:], encoding="utf-8")
        print(f"repaired: {const_name} in {frel}")

    print(f"\n{len(JOBS)} quotations replaced with the corpus's actual words.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
