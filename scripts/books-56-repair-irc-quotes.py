#!/usr/bin/env python3
"""
books-56 (warning 25): repair three IRC quotations that were EDITORIAL
RECONSTRUCTIONS rather than verbatim text, and which no gate could see.

HOW THEY HID. `sourceFileFor` maps a US Code citation to a corpus file with

    /^26 U\\.S\\.C\\. \u00a7(\\d+[A-Z]?)/

which requires NO SPACE after the section symbol. These three citations are
written "26 U.S.C. \u00a7 6651(a)(1)" WITH a space, so nothing matched, no corpus
file was located, and the verifier filed them under "no local copy to check
against" - while usc-162.txt and usc-6651.txt sat on disk the whole time. One
space made three quotations unverifiable. That is warning 25 in miniature: the
92 "silently skipped" authorities were never all undownloadable sources.

WHAT WAS ACTUALLY WRONG. All three splice a heading onto a body, which is how a
person WRITES a pin cite but not what the statute SAYS:

  \u00a7162(f)(1) - the corpus prints "(f) Fines, penalties, and other amounts." then
  "(1) In general." then the body on its own line. The quote read
  "(f)(1) In general.-Except as provided..." - a subsection label that appears
  nowhere, joined to a heading, joined to the body by a dash the statute does
  not contain.

  \u00a76651(a)(1) - the statute reads "(a) Addition to the tax. In case of failure-"
  and then "(1) to file any return...". The quote read "In case of failure to
  file any return..." which welds the stem to the paragraph and deletes both the
  em-dash and the paragraph number. It reads beautifully. It is not the law.

  \u00a76651(a)(2), (c)(1) - the same splice, plus "(c)(1)" prefixed to a body whose
  heading in the corpus is "(1) Additions under more than one paragraph."

None of this changes what the provisions MEAN, and the soWhat prose was right.
That is exactly why it survived: a reconstruction that is substantively correct
is invisible to a reader and fatal to rule 24/35, which says verbatim or no
feature. Michael's whole reason for the teaching layer is that the lessons rest
on legal text rather than on someone's rendering of it.

The replacements are the corpus's own words, with explicit "..." where a heading
or an intervening paragraph is skipped. Refusal discipline as with the other two
extenders in this slice: nothing is written unless EVERY new quote verifies
segment-by-segment, in order, against its own declared corpus, and every anchor
is located unambiguously in its source file.
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
    """Render a quote as the concatenated string literals this codebase uses.

    Newlines inside the quote become \\n escapes, because the corpus really does
    contain them and the verifier collapses whitespace on both sides.
    """
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
        "usc-162.txt",
        "IRC_162_F_PENALTIES",
        "(f) Fines, penalties, and other amounts.\n(1) In general.\nExcept as provided in the "
        "following paragraphs of this subsection, no deduction otherwise allowable shall be allowed "
        "under this chapter for any amount paid or incurred (whether by suit, agreement, or "
        "otherwise) to, or at the direction of, a government or governmental entity in relation to "
        "the violation of any law or the investigation or inquiry by such government or entity into "
        "the potential violation of any law. ... (4) Exception for taxes due.\nParagraph (1) shall "
        "not apply to any amount paid or incurred as taxes due.",
    ),
    (
        "src/lib/payroll/payroll-tax-authorities.ts",
        "usc-6651.txt",
        "IRC_6651_FAILURE_TO_FILE",
        "(a) Addition to the tax. In case of failure\u2014\n(1)\nto file any return required under "
        "authority of subchapter A of chapter 61 ... on the date prescribed therefor (determined "
        "with regard to any extension of time for filing), unless it is shown that such failure is "
        "due to reasonable cause and not due to willful neglect, there shall be added to the amount "
        "required to be shown as tax on such return 5 percent of the amount of such tax if the "
        "failure is for not more than 1 month, with an additional 5 percent for each additional "
        "month or fraction thereof during which such failure continues, not exceeding 25 percent in "
        "the aggregate;",
    ),
    (
        "src/lib/accounting/tax-penalty-authorities.ts",
        "usc-6651.txt",
        "IRC_6651_C1_INTERACTION",
        "to pay the amount shown as tax on any return specified in paragraph (1) on or before the "
        "date prescribed for payment of such tax ... there shall be added to the amount shown as tax "
        "on such return 0.5 percent of the amount of such tax if the failure is for not more than 1 "
        "month, with an additional 0.5 percent for each additional month or fraction thereof during "
        "which such failure continues, not exceeding 25 percent in the aggregate; or ... (c) "
        "Limitations and special rule.\n(1) Additions under more than one paragraph.\nWith respect "
        "to any return, the amount of the addition under paragraph (1) of subsection (a) shall be "
        "reduced by the amount of the addition under paragraph (2) of subsection (a) for any month "
        "(or fraction thereof) to which an addition to tax applies under both paragraphs (1) and (2).",
    ),
]


def find_quote_block(src: str, const_name: str):
    """Locate the `quote:` block of one exported authority, BY CONST NAME.

    Anchored on the declaration so the edit cannot wander into a neighbouring
    authority: the search begins at `export const <NAME>` and ends at the next
    field key at the same indentation (`\\n  soWhat:` in practice).
    """
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
