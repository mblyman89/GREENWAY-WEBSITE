#!/usr/bin/env python3
"""
scripts/derive-form-box-map.py   (books-61)

═══════════════════════════════════════════════════════════════════════════════
WHICH RECTANGLE ON THE PAPER IS "LINE 5a"?
═══════════════════════════════════════════════════════════════════════════════

`derive-form-geometry.py` answers "where are the input areas" using the IRS's
own `/Rect` values. It cannot answer "which of them is line 5a", because the IRS
does not say: I checked, and the tooltip (`/TU`) count across all 116 widgets of
the 941 is zero. The field names are machine-generated - `f1_19[0]` - and carry
no meaning.

So the map from OUR box ids to the IRS's rectangles has to be derived, and this
is the script that derives it. It works the way a person does: it reads the line
number printed in the left margin, takes the horizontal band that number sits
in, and claims the input areas inside that band.

───────────────────────────────────────────────────────────────────────────────
THE SUBTLETY THAT WOULD HAVE PUT THE RIGHT NUMBER IN THE WRONG BOX
───────────────────────────────────────────────────────────────────────────────
Lines 5a to 5d of the 941 print TWO columns. Column 1 is the wage base; column 2
is the tax on it. The form itself prints the arithmetic between them:

    5a  Taxable social security wages [ column 1 ] x 0.124 = [ column 2 ]

Our engine's line "5a" is NOT the wage base. Measured from
`form-941-core.ts`, its caption is "Taxable social security wages x 0.124" and
its `amountCents` is `line5a`, the product - the tax. The wage base appears only
inside the derivation sentence.

If this script had assigned box "5a" to the leftmost rectangle on the row - the
obvious reading, and the one I would have written without looking - Greenway's
social security TAX would print in the column reserved for social security
WAGES. On a form Michael copies onto a government portal, that is a number that
is individually plausible, correctly formatted, and wrong. Nothing downstream
would catch it, because every figure would still be a real figure.

So money boxes on two-column rows are bound to the LAST money slot in the band -
the total, the thing our engine actually computed - and the columns the engine
does not model are left empty rather than filled with something that looks
right. Standing rule: never guess. A blank column is honest; a plausible wrong
number is not.

───────────────────────────────────────────────────────────────────────────────
WHAT THIS REFUSES TO DO
───────────────────────────────────────────────────────────────────────────────
Every box we model must land somewhere, or be listed as deliberately unplaced
WITH a reason. There is no third outcome: a box that quietly fails to appear is
a line missing from a tax form, and the page would look complete without it.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

REPO = Path(__file__).resolve().parents[1]
GEOMETRY = REPO / "src" / "lib" / "payroll" / "form-geometry.generated.json"
OUT = REPO / "src" / "lib" / "payroll" / "form-box-map.generated.json"


# ─────────────────────────────────────────────────────────────────────────────
# THE 941: READ THE LINE NUMBER IN THE LEFT MARGIN
# ─────────────────────────────────────────────────────────────────────────────
#
# Measured: on page 1 the line labels are printed at x = 40.95 (two-character
# labels like "10") or x = 45.67 (single characters like "2"). Nothing else on
# the page begins that far left, which is what makes the margin a reliable
# signal rather than a lucky one.
LEFT_MARGIN_MAX_X = 48.0

# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS SAYS [a-z] AND NOT [a-e]
# ─────────────────────────────────────────────────────────────────────────────
# The first version said `[a-e]`, written from looking at lines 5a-5e and
# assuming the alphabet stopped there. Running it, three of our twenty-seven
# boxes failed to place: 5f, 15b and 15d.
#
# Measured, they turned out to be two DIFFERENT problems wearing one symptom,
# which is exactly why "just widen it until the count matches" would have been
# the wrong repair:
#
#   5f  IS printed in the left margin, at x=45.67 - the same column as 5a..5e.
#       It was rejected purely because my character class stopped at "e". That
#       is my bug, and widening the class is the correct fix.
#
#   15b IS NOT in the left margin. It is printed at x=390.30, mid-line, because
#   15d on the paper 15b and 15d are continuations of the 15a row rather than
#       rows of their own ("15b Check one:", "15d Type:"). No margin scan can
#       find them, and pretending otherwise by loosening the x threshold would
#       start swallowing body text that happens to look like a label.
#
# So the class is widened here, and 15b/15d are handled by the separate
# mid-line pass below - named for what they are instead of being forced through
# a scan that was never going to see them.
LINE_LABEL_RE = re.compile(r"^1?[0-9][a-z]?$")

# Labels the form prints INSIDE a row rather than in the left margin.
#
# Deliberately a short, explicit list rather than a general "scan the whole page
# for anything label-shaped" rule. A general rule would match "12" inside the
# sentence "Subtract line 11 from line 10", and a mis-attributed rect is the one
# failure mode this whole script exists to prevent. Each entry is a measured
# position, and the gate downstream checks that every one of them was found.
MIDLINE_LABELS: dict[str, list[str]] = {
    # x measured at 390.30 and 284.80 respectively on page 1.
    "941-p1": ["15b", "15d"],
}


# ─────────────────────────────────────────────────────────────────────────────
# THE PART OF THE 941 THAT HAS NO LINE NUMBER
#
# ═══ THE DEFECT THIS SECTION EXISTS TO FIX ═══
#
# The margin scan above finds "line 1", "line 5a", "line 16". It cannot find the
# EIN, the business name, the trade name or the address, because THOSE BOXES
# HAVE NO LINE NUMBER - the paper labels them with words. So they matched no
# band, hit the `continue`, and were dropped silently.
#
# Measured before any of this was written, by partitioning every rect on the
# page into placed and unplaced:
#
#     941-p1   70 rects   52 placed   18 UNPLACED
#     941-p2   35 rects    3 placed   32 UNPLACED
#
# The 18 on page 1 are the entire entity area plus the quarter and
# aggregate-filer tick boxes. The 32 on page 2 are the name/EIN header that
# repeats at the top of the page, the whole of line 16's monthly-liability grid,
# and the signature block.
#
# A 941 with no EIN and no business name on it is not a return. It is a sheet of
# arithmetic that the IRS cannot match to a taxpayer, and it fails the exact job
# Michael named for these pages: "It's meant to be a part of the process for
# bookkeeping and taxes, not just informative."
#
# This is the SAME defect that was found on the W-2 an hour earlier, on the same
# day, in the same shape - money placed, identity missing. It was found on the
# 941 only because the W-2 one prompted the question "where else is this true?"
# rather than "let me check the thing I just fixed". Rule 23: fix the class.
#
# ═══ WHY THESE BINDINGS ARE MEASURED AND NOT TYPED FROM MEMORY ═══
#
# Each entry below states the caption the IRS PRINTS beside the rectangle, and
# the script REQUIRES that caption to be present on the page at a position
# consistent with the rect before it will accept the binding. So this table is
# not a list of assertions about field names - it is a list of claims the script
# then checks against the artwork. If the IRS moves the trade-name box, the
# build stops instead of quietly labelling the address as the trade name.
#
# The field names themselves (`f1_1` .. `f1_11`) carry no meaning - the agency
# generates them - which is exactly why the caption is the evidence and the
# field name is only the address.
#
# Corroborated independently against Michael's own filed return,
# `2ND_QTR_FORM_941.pdf`, which prints:
#
#     Employer identification number (EIN)   4 6 - 4 2 1 7 0 1 6
#     Name (not your trade name)             LYMAN'S MARIJUANA
#     Trade name (if any)                    GREENWAY MARIJUANA
#     Address                                4851 GEIGER RD SE
#     City / State / ZIP                     PORT ORCHARD  WA  98366
#
# Two independent sources agree: the blank form's captions, and a real filed
# return produced by different software. That is the standard the W-2 two-up
# finding was held to and it is the standard applied here.
# ─────────────────────────────────────────────────────────────────────────────

# Our box id -> (IRS field names in reading order, the caption that must be
# printed nearby, how far ABOVE or beside the rect that caption may sit).
#
# The captions are quoted from the artwork exactly as `pdftotext` reads them.
NINE41_ENTITY: dict[str, dict] = {
    "941-p1": {
        # Two rectangles, because the paper splits the EIN across a 2-cell comb
        # and a 7-cell comb with the hyphen printed on the artwork between them.
        # Both are claimed by ONE box id, so a reader clicking either half gets
        # the same lesson - the EIN is one fact, not two.
        "ein": {
            "fields": ["Header[0].EntityArea[0].f1_1[0]", "Header[0].EntityArea[0].f1_2[0]"],
            "caption": "Employer identification number (EIN)",
        },
        "name": {
            "fields": ["Header[0].EntityArea[0].f1_3[0]"],
            "caption": "Name (not your trade name)",
        },
        "tradeName": {
            "fields": ["Header[0].EntityArea[0].f1_4[0]"],
            "caption": "Trade name (if any)",
        },
        "address": {
            "fields": ["Header[0].EntityArea[0].f1_5[0]"],
            "caption": "Address",
        },
        # City, state and ZIP are three separate rectangles on one row with
        # three separate printed captions. They are ONE box to us because they
        # are one fact - where the business is - and because a reader clicking
        # the state field wants the same explanation as one clicking the city.
        "cityStateZip": {
            "fields": [
                "Header[0].EntityArea[0].f1_6[0]",
                "Header[0].EntityArea[0].f1_7[0]",
                "Header[0].EntityArea[0].f1_8[0]",
            ],
            "caption": "City",
        },
    },
    "941-p2": {
        # Page 2 repeats the name and EIN at the top. The IRS gives these two
        # their own read-order names - `Name_ReadOrder` and `EIN_Number` - which
        # is the agency's own statement of what they are, and better evidence
        # than any position.
        "name": {
            "fields": ["Name_ReadOrder[0].f1_3[0]"],
            "caption": "Name (not your trade name)",
        },
        "ein": {
            "fields": ["EIN_Number[0].f1_1[0]", "EIN_Number[0].f1_2[0]"],
            "caption": "Employer identification number (EIN)",
        },
    },
}

# How far the printed caption may sit from the rect it names, vertically.
#
# ═══ MEASURED IN BOTH DIRECTIONS, BECAUSE THE TWO PAGES DISAGREE ═══
#
# Every one of the seven captions was located and its offset from its rect's top
# edge recorded, rather than a plausible tolerance being chosen:
#
#     PAGE 1 - caption printed BELOW the top of the rect (positive offset)
#       "Employer identification number (EIN)"   rect y  66.00   offset  +8.17
#       "Name (not your trade name)"             rect y  90.00   offset  +7.17
#       "Trade name (if any)"                    rect y 114.00   offset  +7.17
#       "Address"                                rect y 138.00   offset  +9.17
#       "City"                                   rect y 168.00   offset +18.57
#
#     PAGE 2 - caption printed ABOVE the rect (NEGATIVE offset)
#       "Name (not your trade name)"             rect y  58.00   offset  -9.83
#       "Employer identification number (EIN)"   rect y  58.00   offset  -9.83
#
# So the 941 puts its entity captions under the entry line on page 1 and over it
# on page 2. Had this been written from page 1 alone with a one-sided test, page
# 2's header would have failed to bind and the name and EIN would have gone
# missing from the second sheet - which is precisely the class of silent gap
# this section exists to close. The comparison is therefore on the ABSOLUTE
# offset.
#
# 24pt covers the widest measured case (City, +18.57, whose row carries the
# "City / State / ZIP code" sub-captions between the rect and its label) without
# reaching the next labelled row, the nearest of which is 30pt away.
ENTITY_CAPTION_SLACK_PT = 24.0


# ─────────────────────────────────────────────────────────────────────────────
# THE RECTANGLES WE DELIBERATELY DO NOT FILL, AND WHY
#
# "Unclaimed" must never mean "unnoticed". Every rectangle on both 941 pages is
# either bound to a box above or listed here with a reason that survives being
# read aloud to Michael.
#
# Three different kinds of reason appear below, and the difference matters:
#
#   A. A CHOICE ONLY HE CAN MAKE. Which quarter, which type of aggregate filer,
#      whether to allow a third-party designee. Software that ticked these
#      would be putting words in his mouth on a signed return. (Note the
#      quarter tick boxes ARE knowable - the page already knows which quarter it
#      is rendering - but see the note on REPORT_FOR_QUARTER below.)
#
#   B. A FIGURE THE ENGINE DOES NOT COMPUTE. Line 16's monthly liability grid is
#      the important case: `Form941Return` carries no monthly breakdown at all,
#      and there is no way to derive one from a quarterly total. Printing three
#      numbers there that add to line 12 would be inventing a deposit history.
#      The IRS's own caution, quoted in our line-16 lesson, is that these
#      amounts are "a summary of your monthly tax liability, not a summary of
#      deposits you made" - so they cannot be reconstructed from deposits
#      either.
#
#   C. A SIGNATURE. Part 5 is a declaration made under penalties of perjury.
#      The company profile does hold `signer_name` and `signer_title`, and his
#      filed return prints MICHAEL LYMAN / OWNER there - but this product does
#      not sign returns, and pre-printing a name under a perjury declaration is
#      the single worst place to be helpful. Left blank, deliberately, and
#      surfaced in the owner report so the omission is his decision to overrule
#      rather than my omission to discover.
#
# Matching is by the field-name suffix, because the IRS's generated names are
# stable within a revision and the qualified prefix is noise.
# ─────────────────────────────────────────────────────────────────────────────
NINE41_UNCLAIMED: dict[str, dict[str, str]] = {
    "941-p1": {
        # ── A: choices only he can make ──────────────────────────────────────
        #
        # REPORT_FOR_QUARTER. The renderer KNOWS the quarter - it is in the URL.
        # It is still not ticked, and that is a deliberate decision rather than
        # an oversight: this page renders a facsimile of a return for review and
        # printing, and a tick mark is the one thing on the paper that is a
        # declaration rather than a computation. If a later slice fills these,
        # it should be because Michael asked for it, with the quarter shown
        # beside the tick so a wrong one is visible.
        "Header[0].ReportForQuarter[0].c1_1[0]": (
            "Quarter 1 tick box. Not ticked: a tick on a return is a declaration, and this "
            "page draws the return rather than making declarations on it."
        ),
        "Header[0].ReportForQuarter[0].c1_1[1]": (
            "Quarter 2 tick box. Not ticked, for the reason given on the quarter 1 box."
        ),
        "Header[0].ReportForQuarter[0].c1_1[2]": (
            "Quarter 3 tick box. Not ticked, for the reason given on the quarter 1 box."
        ),
        "Header[0].ReportForQuarter[0].c1_1[3]": (
            "Quarter 4 tick box. Not ticked, for the reason given on the quarter 1 box."
        ),
        "Header[0].AggregateReturn[0].c1_2[0]": (
            "Section 3504 Agent. Greenway files its own return for its own employees, so no "
            "aggregate-filer type applies. Never ticked by software in any case."
        ),
        "Header[0].AggregateReturn[0].c1_2[1]": (
            "Certified Professional Employer Organization. Does not apply to Greenway."
        ),
        "Header[0].AggregateReturn[0].c1_2[2]": (
            "Other Third Party. Does not apply to Greenway."
        ),
        # ── The foreign address block ────────────────────────────────────────
        #
        # Left blank because Greenway's address is in Port Orchard, Washington,
        # and his filed return leaves all three blank. This is NOT the same as
        # "we do not model it": the company profile has no foreign-address
        # fields at all, so there is nothing that could be printed here.
        "Header[0].EntityArea[0].f1_9[0]": (
            "Foreign country name. Blank on a correct return for a Washington business, and "
            "the company profile holds no foreign address to print."
        ),
        "Header[0].EntityArea[0].f1_10[0]": (
            "Foreign province/county. Blank for the reason given on the foreign country box."
        ),
        "Header[0].EntityArea[0].f1_11[0]": (
            "Foreign postal code. Blank for the reason given on the foreign country box."
        ),
    },
    "941-p2": {
        # ── B: figures the engine does not compute ───────────────────────────
        "f2_1[0]": (
            "Line 16 month 1 tax liability, dollars. The engine computes a QUARTERLY return "
            "and carries no monthly breakdown, and a monthly liability cannot be derived "
            "from a quarterly total. Three invented figures that happened to add up to line "
            "12 would be a fabricated deposit history on a signed return."
        ),
        "f2_2[0]": "Line 16 month 1 tax liability, cents. See the month 1 dollars box.",
        "f2_3[0]": "Line 16 month 2 tax liability, dollars. See the month 1 dollars box.",
        "f2_4[0]": "Line 16 month 2 tax liability, cents. See the month 1 dollars box.",
        "f2_5[0]": "Line 16 month 3 tax liability, dollars. See the month 1 dollars box.",
        "f2_6[0]": "Line 16 month 3 tax liability, cents. See the month 1 dollars box.",
        "f2_7[0]": (
            "Line 16 total liability for the quarter, dollars. This one IS known - the paper "
            "says it must equal line 12 - but it is the total of three figures above that we "
            "are refusing to invent, and printing a total under three blank rows would look "
            "like the rows had been missed rather than declined."
        ),
        "f2_8[0]": "Line 16 total liability for the quarter, cents. See the total dollars box.",
        # ── A: choices only he can make ──────────────────────────────────────
        # NOTE: line 16's monthly and semiweekly ticks used to sit here as
        # "not ticked". They are now PLACED under box "16" by
        # NINE41_LINE16_TICKS, so a reader can click either one. See D-06.
        "f2_9[0]": (
            "Line 17 final date wages were paid. Only entered when the business has closed, "
            "which is a fact about the business that no payroll figure implies."
        ),
        "f2_10[0]": (
            "Line 18 third-party designee name. Whether to let somebody else discuss the "
            "return with the IRS is his decision, not a computation."
        ),
        "f2_11[0]": "Third-party designee phone number. See the designee name box.",
        "c2_4[0]": "Third-party designee 'Yes' tick. His decision, not a computation.",
        "c2_4[1]": "Third-party designee 'No' tick. His decision, not a computation.",
        "f2_12[0]": (
            "Third-party designee five-digit PIN. A credential, chosen by him; software that "
            "invented one would be creating an IRS authentication factor."
        ),
        # ── C: the signature block ───────────────────────────────────────────
        "f2_13[0]": (
            "Print your name here. Part 5 is signed under penalties of perjury. The company "
            "profile holds signer_name, and this deliberately does not print it: pre-filling "
            "a name under a perjury declaration is the worst possible place to be helpful."
        ),
        "f2_14[0]": "Print your title here. Left blank for the reason given on the name box.",
        "f2_15[0]": (
            "Best daytime phone. Part of the signature block, left to be completed by hand "
            "with the rest of it."
        ),
        # ── The paid preparer block ──────────────────────────────────────────
        #
        # Greenway prepares its own return - his filed 941 leaves every one of
        # these blank - and this product is not a paid preparer.
        "c2_5[0]": "Paid preparer 'check if self-employed'. Greenway uses no paid preparer.",
        "f2_16[0]": "Paid preparer's name. Greenway uses no paid preparer.",
        "f2_17[0]": "Paid preparer's PTIN. Greenway uses no paid preparer.",
        "f2_18[0]": "Paid preparer's firm name. Greenway uses no paid preparer.",
        "f2_19[0]": "Paid preparer's EIN. Greenway uses no paid preparer.",
        "f2_20[0]": "Paid preparer's address. Greenway uses no paid preparer.",
        "f2_21[0]": "Paid preparer's phone. Greenway uses no paid preparer.",
        "f2_22[0]": "Paid preparer's city. Greenway uses no paid preparer.",
        "f2_23[0]": "Paid preparer's state. Greenway uses no paid preparer.",
        "f2_24[0]": "Paid preparer's ZIP code. Greenway uses no paid preparer.",
    },
}


def nine41_unclaimed_reason(key: str, field_name: str) -> str | None:
    """
    The recorded reason this rectangle is left blank, or None if there isn't one.

    None stops the build. That is the whole point: a rectangle nobody has
    thought about must not be indistinguishable from one that was considered and
    declined.
    """
    for suffix, reason in NINE41_UNCLAIMED.get(key, {}).items():
        if field_name.endswith(suffix):
            return reason
    return None

# A rect belongs to a label when the rect's vertical centre falls within the
# label's own printed height, widened by this much. Measured need: the 941's
# line-5d label is two lines tall and its rects sit slightly below the first
# line of text, and line 13's label likewise. 8pt covers the observed spread
# without letting a rect reach the NEXT line, whose labels are 19-20pt apart.
BAND_SLACK_PT = 8.0

# Two-column rows: any money slot left of this x is column 1 (the base), and
# our engine does not model those. Measured from the geometry: column 1 rects
# start at x=216.0 and x=288.0; column 2 at x=352.8 and x=424.8; single-column
# rows all start at x=446.4.
COLUMN_TWO_MIN_X = 340.0


def words_of(pdf: Path, page: int) -> list[dict]:
    proc = subprocess.run(
        ["pdftotext", "-bbox-layout", "-f", str(page), "-l", str(page), str(pdf), "-"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"derive-form-box-map: pdftotext failed: {proc.stderr.strip()}")
    root = ET.fromstring(proc.stdout)
    out = []
    for node in root.iter():
        if node.tag.endswith("word"):
            out.append(
                {
                    "t": (node.text or "").strip(),
                    "x0": float(node.get("xMin", "0")),
                    "y0": float(node.get("yMin", "0")),
                    "x1": float(node.get("xMax", "0")),
                    "y1": float(node.get("yMax", "0")),
                }
            )
    return out


def margin_labels(words: list[dict]) -> dict[str, tuple[float, float]]:
    """
    Line number -> the vertical band it labels.

    A label printed twice would make the band ambiguous, so that is refused
    rather than resolved by picking one. (Measured: it does not happen on the
    pages we use, but "it does not happen today" is not a reason to accept it
    silently tomorrow.)
    """
    found: dict[str, tuple[float, float]] = {}
    for w in words:
        if w["x0"] < LEFT_MARGIN_MAX_X and LINE_LABEL_RE.fullmatch(w["t"]):
            if w["t"] in found:
                sys.exit(
                    f"derive-form-box-map: line label {w['t']!r} is printed twice in the "
                    f"left margin, so the band it names is ambiguous. Refusing to pick one."
                )
            found[w["t"]] = (w["y0"], w["y1"])
    return found


def printed_phrases(pdf: Path, page_no: int) -> list[dict]:
    """
    Whole printed LINES with their bounding boxes.

    `words_of` splits on spaces, which is right for finding a line number in the
    margin and useless for finding "Employer identification number (EIN)". The
    captions on the 941's entity area are phrases, so they are matched as
    phrases - assembling them from adjacent words would mean re-implementing
    pdftotext's own layout analysis and then trusting my version of it.
    """
    out: list[dict] = []
    for words in w2_lines(pdf, page_no):
        out.append(
            {
                "t": " ".join(w["t"] for w in words),
                "x0": min(w["x0"] for w in words),
                "y0": min(w["y0"] for w in words),
                "x1": max(w["x1"] for w in words),
                "y1": max(w["y1"] for w in words),
            }
        )
    return out


def entity_placements(key: str, page_geo: dict, words: list[dict]) -> dict[str, list[str]]:
    """
    Bind the 941's word-labelled boxes - EIN, name, trade name, address - to
    their rectangles, CHECKING each binding against the printed caption.

    The margin scan cannot reach these: they have no line number. But they are
    not therefore unknowable, and leaving them out is what put a 941 on screen
    with no taxpayer on it. See the long note above NINE41_ENTITY.

    Every claim in the table is verified here rather than trusted:

      1. the named rectangle must EXIST in the geometry, and
      2. the caption the table says is printed beside it must actually be
         printed on the page, exactly once, within ENTITY_CAPTION_SLACK_PT of
         the rectangle.

    Any failure stops the build. The alternative - binding by field name alone -
    would keep working after a revision moved the boxes, and would print the
    trade name where the IRS expects the legal name. On a signed return that is
    a false statement, made by software, that nobody would see.
    """
    by_name = {f["name"]: f for f in page_geo["fields"]}
    out: dict[str, list[str]] = {}

    for box_id, spec in NINE41_ENTITY.get(key, {}).items():
        names: list[str] = []
        for fragment in spec["fields"]:
            matches = [n for n in by_name if n.endswith(fragment)]
            if len(matches) != 1:
                sys.exit(
                    f"derive-form-box-map: {key} entity box {box_id!r} names the field "
                    f"ending {fragment!r}, which matches {len(matches)} rectangles "
                    f"{sorted(matches)[:4]}. Exactly one is required - a form field that "
                    f"has moved or been renamed must stop the build, not be guessed at."
                )
            names.append(matches[0])

        # The caption is the evidence. The field name is only the address.
        caption = spec["caption"]
        tops = sorted(r["y"] for r in (by_name[n] for n in names))
        rect_top = tops[0]
        hits = [
            w
            for w in words
            if w["t"] == caption and abs(w["y0"] - rect_top) <= ENTITY_CAPTION_SLACK_PT
        ]
        if len(hits) != 1:
            sys.exit(
                f"derive-form-box-map: {key} entity box {box_id!r} expects the caption "
                f"{caption!r} printed within {ENTITY_CAPTION_SLACK_PT}pt of y={rect_top}, "
                f"and found {len(hits)}. Either the artwork has been revised or this "
                f"binding was wrong. Refusing to fill a box whose label cannot be "
                f"confirmed on the paper."
            )

        out[box_id] = names

    return out


# Line 16's three ticks, bound by the sentence the IRS prints beside each.
#
# D-06: only c2_1[0] was placed, so the two ticks that decide whether Schedule B
# is required at all were unreachable on the page. Michael is a semiweekly
# filer, so the tick that matters most was the one nobody could click.
#
# Bound by CAPTION, not by index: c2_1[1] and c2_1[2] are indistinguishable by
# name, and swapping them would mark a semiweekly depositor as monthly.
NINE41_LINE16_TICKS: dict[str, str] = {
    "c2_1[0]": "Line 12 on this return is less than $2,500 or line 12 on the return for the prior quarter was less than $2,500,",
    "c2_1[1]": "You were a monthly schedule depositor for the entire quarter. Enter your tax liability for each month and total",
    "c2_1[2]": "You were a semiweekly schedule depositor for any part of this quarter. Complete Schedule B (Form 941),",
}

# A line-16 tick's caption starts on the tick's own printed row. Measured: all
# three sit within 3pt of their sentence's top.
LINE16_CAPTION_SLACK_PT = 6.0


def line16_tick_placements(key: str, page_geo: dict, phrases: list[dict]) -> list[str]:
    """Rect names for line 16's ticks, in printed order, each caption confirmed."""
    if key != "941-p2":
        return []
    by_name = {f["name"]: f for f in page_geo["fields"]}
    out: list[str] = []
    for fragment, caption in NINE41_LINE16_TICKS.items():
        matches = [n for n in by_name if n.endswith(fragment)]
        if len(matches) != 1:
            sys.exit(
                f"derive-form-box-map: {key} line 16 tick {fragment!r} matches "
                f"{len(matches)} rectangles; exactly one is required."
            )
        rect = by_name[matches[0]]
        centre = rect["y"] + rect["h"] / 2
        hits = [
            p
            for p in phrases
            if p["t"] == caption and abs((p["y0"] + p["y1"]) / 2 - centre) <= LINE16_CAPTION_SLACK_PT
        ]
        if len(hits) != 1:
            sys.exit(
                f"derive-form-box-map: {key} line 16 tick {fragment!r} expects the caption "
                f"{caption[:40]!r}... printed beside it and found {len(hits)}. Ticking the "
                f"wrong one would tell the IRS a semiweekly depositor is a monthly one."
            )
        out.append(matches[0])
    return out


def midline_label_positions(words: list[dict], wanted: list[str]) -> dict[str, tuple[float, float, float]]:
    """
    Locate the row-internal labels (15b, 15d) by their printed text.

    Returns label -> (x of the label, band top, band bottom). The x matters here
    in a way it does not for margin labels: 15a, 15b share one horizontal band,
    so "which row" is not enough to tell their rects apart and the rects must be
    split by which label they sit to the right of.

    Every wanted label must be found exactly once. Not found, or found twice, is
    a refusal - if the artwork moved these captions, the safe outcome is a build
    that stops, not a form with two boxes silently sharing one set of rects.
    """
    out: dict[str, tuple[float, float, float]] = {}
    for name in wanted:
        hits = [w for w in words if w["t"] == name]
        if len(hits) != 1:
            sys.exit(
                f"derive-form-box-map: expected exactly one printed {name!r} on the page, "
                f"found {len(hits)}. The artwork has moved; refusing to guess which one "
                f"labels the input areas."
            )
        w = hits[0]
        out[name] = (w["x0"], w["y0"], w["y1"])
    return out


# ─────────────────────────────────────────────────────────────────────────────
# THE W-2 IS A DIFFERENT PROBLEM, AND PRETENDING OTHERWISE WOULD BREAK IT
#
# The 941 is a column of numbered lines, so "read the label in the left margin,
# take the band" works. The W-2 is a GRID: box 1 and box 2 sit side by side on
# the same row, as do 3/4, 5/6, 7/8, 9/10 and 15/16/17/18/19/20. A band scan
# would hand every rect on the row to whichever label it met first, so box 2's
# federal income tax withheld would print under box 1's wages.
#
# Two further facts, both measured on page 4 of fw2.pdf rather than assumed:
#
#   1. ONE SHEET CARRIES TWO FORMS. The 94 widgets divide into `CopyB_Top` (47)
#      and `CopyB_Bottom` (47) - the same W-2 printed twice so the employee can
#      keep one and file one. Filling both from one employee's figures would
#      hand Michael a sheet that looks like two different filings. Only the top
#      form is filled; the bottom is left as the blank second copy it is.
#
#   2. THE IRS NAMES SOME FIELDS AND NOT OTHERS. `Box1_ReadOrder`,
#      `Box3_ReadOrder`, `Box10_ReadOrder`, `Box16_ReadOrder` and friends are
#      the agency's own accessibility read-order names, and where one exists it
#      is AUTHORITATIVE - far better evidence than anything I could infer from
#      position. But they are not complete: box 2 has no name, it is simply the
#      field that follows Box1_ReadOrder on the row.
#
# So the W-2 map is derived in two passes: take the IRS's own names first, then
# fill the unnamed gaps by reading the printed labels ACROSS the row, left to
# right, exactly as a person's eye does. Every rect that ends up unclaimed is
# reported, never silently dropped.
#
# The vertical "C o d e" glyphs beside boxes 12a-12d are a trap: `pdftotext`
# reports each letter as its own word, and a bare `[a-f]` label test matches the
# "d" and the "e". They are told apart by HEIGHT - the real labels are 8.35pt
# tall and these are 4.43pt - which is a property of the thing itself rather
# than a coordinate that a revision could shift.
# ─────────────────────────────────────────────────────────────────────────────

# Only the top form on the sheet is filled. See note 1 above.
W2_FILLED_SUBFORM = "CopyB_Top"

# Measured on page 4 of fw2.pdf: real box labels are 8.35pt tall. The vertical
# "C o d e" letters printed sideways beside boxes 12a-12d are 4.43pt, and
# pdftotext reports each letter as its own word - so a bare [a-f] test matches
# the "d" and the "e" and invents two labels that are not labels. The threshold
# sits between the two MEASURED heights rather than on either of them.
W2_MIN_LABEL_HEIGHT_PT = 6.0

# Below this the sheet has left the boxed grid and is into the "Form W-2 / 2026
# / Department of the Treasury" footer, which holds no input areas.
W2_GRID_BOTTOM_PT = 340.0

W2_LABEL_RE = re.compile(r"^([a-f]|[0-9]{1,2}[a-d]?)$")

# How far a label may sit to the RIGHT of the rect it heads.
#
# Measured, not chosen: the IRS insets each label from its cell's left edge
# while the input area starts flush, so the label is consistently a few points
# right of the rect. The widest case on this page is box 3, whose label is at
# x=338.70 and whose rect starts at x=332.20 - a gap of 6.5pt. 10pt gives that
# margin some room without reaching the next column, whose nearest neighbour is
# over 100pt away.
W2_LABEL_INSET_SLACK_PT = 10.0

# ─────────────────────────────────────────────────────────────────────────────
# WHAT THE PAPER CALLS A BOX vs WHAT WE CALL IT
#
# 2026 SPLITS BOX 14 IN TWO, AND WE MODEL ONE BOX.
#
# The 2026 W-2 prints "14a Other" and "14b Treasury Tipped Occupation Code(s)".
# Our engine models a single box "14" whose caption is "Other" - which is 14a.
#
# So box 14 is bound to 14a, and 14b is deliberately left unclaimed. That is the
# honest outcome for Greenway, which has no tipped occupations and would report
# nothing in 14b either way; and leaving it blank is the same answer a correct
# filing gives. What would NOT be honest is binding our "14" to whichever of the
# two rects happened to be found first, which is what any positional rule that
# did not know about the split would have done.
#
# This is recorded rather than silently handled: it is surfaced in the owner
# report so Michael knows the paper has a box the software does not model.
# ─────────────────────────────────────────────────────────────────────────────
W2_LABEL_TO_BOX: dict[str, str] = {
    "14a": "14",
}

# Printed labels that exist on the paper but correspond to no box we model.
# Listed WITH the reason, so "unclaimed" never means "unnoticed".
W2_LABELS_NOT_MODELLED: dict[str, str] = {
    "14b": (
        "2026 splits box 14 into 14a Other and 14b Treasury Tipped Occupation "
        "Code(s). The engine models 14a only. Greenway has no tipped "
        "occupations, so 14b is blank on a correct filing either way."
    ),
    "12a": "The four box-12 slots are one box to us; their rects are claimed by name.",
    "12b": "The four box-12 slots are one box to us; their rects are claimed by name.",
    "12c": "The four box-12 slots are one box to us; their rects are claimed by name.",
    "12d": "The four box-12 slots are one box to us; their rects are claimed by name.",
}


def w2_lines(pdf: Path, page_no: int) -> list[list[dict]]:
    """Printed words grouped into the lines pdftotext lays them out in."""
    proc = subprocess.run(
        ["pdftotext", "-bbox-layout", "-f", str(page_no), "-l", str(page_no), str(pdf), "-"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"derive-form-box-map: pdftotext failed: {proc.stderr.strip()}")
    root = ET.fromstring(proc.stdout)
    out: list[list[dict]] = []
    for node in root.iter():
        if not node.tag.endswith("line"):
            continue
        words = [
            {
                "t": (w.text or "").strip(),
                "x0": float(w.get("xMin", "0")),
                "y0": float(w.get("yMin", "0")),
                "x1": float(w.get("xMax", "0")),
                "y1": float(w.get("yMax", "0")),
            }
            for w in node.iter()
            if w.tag.endswith("word")
        ]
        if words:
            out.append(words)
    return out


def w2_labels(pdf: Path, page_no: int) -> dict[str, tuple[float, float, float]]:
    """
    Every printed box label on the top W-2, as {label: (x, y0, y1)}.

    ONLY THE FIRST WORD OF A PRINTED LINE COUNTS.

    Box 12's caption reads "12a See instructions for box 12", so the bare token
    "12" appears on this page as ordinary prose at x=547.70. Accepting every
    matching word would turn that prose into a label sitting in the far right
    column, where it could out-claim the real "20 Locality name" for any rect
    below it. A label heads its line; prose does not.
    """
    found: dict[str, tuple[float, float, float]] = {}
    for words in w2_lines(pdf, page_no):
        w = words[0]
        if w["y0"] >= W2_GRID_BOTTOM_PT:
            continue
        if (w["y1"] - w["y0"]) < W2_MIN_LABEL_HEIGHT_PT:
            continue  # a sideways "C o d e" letter, not a box label
        if not W2_LABEL_RE.match(w["t"]):
            continue
        if w["t"] in found:
            sys.exit(
                f"derive-form-box-map: {pdf.name} p{page_no} prints label {w['t']!r} at "
                f"the head of two different lines. One of them is not a label, and "
                f"guessing which would attribute an employee's figures to the wrong box."
            )
        found[w["t"]] = (w["x0"], w["y0"], w["y1"])
    return found


def copy_partition(page_geo: dict) -> tuple[int, float, dict[str, str]]:
    """
    How many copies of the same form are printed on this page, and which rect
    corresponds to which across them?

    ═══ RULE 123. ASK THE PAGE. DO NOT ASSUME ONE FORM PER SHEET. ═══

    The IRS W-2 Copy B page is TWO W-2s, one above the other, and I rendered it
    three times without noticing because every screenshot I took was cropped to
    the top one. Half the paper was going unfilled and it looked finished.

    So this asks a purely NUMERIC question of every page, with no reference to
    any field name: do the rectangles partition into N groups that are exact
    translations of one another by `height / N`? A page of one form answers no
    for every N and is reported as a single copy.

    Measured:

        941-p1     70 rects  ->  1 copy
        941-p2     35 rects  ->  1 copy
        w2-copyb   94 rects  ->  2 copies, pitch 396.0pt, 47 rects each

    On the W-2 the bijection is exact and total - 47 rects match 47 with zero
    unmatched and zero collisions - and the agency's own subform names agree
    independently: `CopyB_Top` and `CopyB_Bottom`. Two sources, one answer,
    which is what rule 123(b) requires before a page's shape is believed.

    Returns (copies, pitch, name of rect in copy 0 -> name in copy 1...) as a
    flat mapping from every rect to its counterpart one copy DOWN, so callers
    can translate a whole placement by composing it.
    """
    rects = page_geo["fields"]
    height = float(page_geo["height"])

    for n in (4, 3, 2):
        if len(rects) % n:
            continue
        pitch = height / n
        # Signature of a rect within its copy: position modulo the pitch. Two
        # rects with the same signature are the same rect of different copies.
        groups: dict[tuple, list[dict]] = {}
        for r in rects:
            sig = (
                round(r["x"], 3),
                round(r["y"] % pitch, 3),
                round(r["w"], 3),
                round(r["h"], 3),
            )
            groups.setdefault(sig, []).append(r)

        if len(groups) != len(rects) // n or any(len(g) != n for g in groups.values()):
            continue

        # An exact, total bijection. Order each group top to bottom so that
        # index 0 is the topmost copy, and hand back the successor mapping.
        successor: dict[str, str] = {}
        for members in groups.values():
            members.sort(key=lambda r: r["y"])
            for a, b in zip(members, members[1:]):
                successor[a["name"]] = b["name"]
        return n, pitch, successor

    return 1, height, {}


def derive_w2(key: str, page_geo: dict, pdf: Path) -> dict:
    fields = [f for f in page_geo["fields"] if W2_FILLED_SUBFORM in f["name"]]
    if not fields:
        sys.exit(
            f"derive-form-box-map: {key} has no fields under {W2_FILLED_SUBFORM!r}. "
            f"The W-2 sheet holds two copies of the form and this script fills only "
            f"the top one; if the IRS renamed the subform, filling nothing would look "
            f"like a form that failed to load rather than like a bug."
        )

    labels = w2_labels(pdf, page_geo["page"])
    placed: dict[str, list[str]] = {}
    named: set[str] = set()

    # ── PASS 1 ── The IRS's own read-order names. Authoritative where present.
    #
    # These are the agency's accessibility names for its own fields, so where
    # one exists it is better evidence than any measurement I could take.
    # `Boxes15_ReadOrder` (plural) is the group holding box 15's state code AND
    # its employer state-ID number, both of which our single box 15 covers.
    for f in fields:
        # `Box(?:es)?`, NOT `Boxes?`. The second is "Boxe" with an optional
        # "s" - it does not match "Box12_ReadOrder" at all. Written the wrong
        # way first, this pass matched only `Boxes15_ReadOrder`, and boxes 10,
        # 12, 17 and 19 fell through to the positional pass, where box 17's
        # state income tax was attributed to box 16's state wages. The map was
        # complete, plausible and wrong. The gate below now pins the count of
        # authoritatively-named boxes so this cannot regress quietly.
        m = re.search(r"Box(?:es)?([0-9]{1,2})_ReadOrder", f["name"])
        if m is not None:
            placed.setdefault(m.group(1), []).append(f["name"])
            named.add(f["name"])
            continue
        # Box 13's ticks are named by what they ARE, not by box number.
        #
        # The IRS names only TWO of the three: `Statutory_ReadOrder` and
        # `Retirement_ReadOrder`. The third-party sick pay tick has no
        # read-order name at all, and it cannot be recovered positionally
        # either - it sits at x=420.6 while the "13" label is printed at
        # x=335.2, so a rule that requires the heading to overlap the rect
        # (which is what stops box 11 being swallowed by box e) correctly
        # refuses to claim it.
        #
        # So it is claimed by the ONE fact that is true of it and nothing else:
        # it is a tick box on box 13's row. Ticks are rare on this form - three
        # in total, all of them box 13's - and the row is fixed by the two the
        # IRS did name. The count is asserted below, so if a future revision
        # adds a fourth tick to this row this stops rather than absorbing it.
        if re.search(r"(Statutory|Retirement)_ReadOrder", f["name"]):
            placed.setdefault("13", []).append(f["name"])
            named.add(f["name"])
            continue
        if re.search(r"(FirstName|LastName)_ReadOrder", f["name"]):
            placed.setdefault("e", []).append(f["name"])
            named.add(f["name"])
            continue
        if re.search(r"BoxA_ReadOrder", f["name"]):
            placed.setdefault("a", []).append(f["name"])
            named.add(f["name"])

    # ── PASS 1b ── the unnamed third tick of box 13. See the note above.
    box13 = placed.get("13")
    if box13 is None:
        sys.exit(
            f"derive-form-box-map: {key} found no Statutory/Retirement read-order "
            f"fields, so box 13's row cannot be located. Refusing to guess where the "
            f"checkbox row is."
        )
    tick_rows = {round(f["y"], 1) for f in fields if f["name"] in box13}
    strays = [
        f
        for f in fields
        if f["name"] not in named
        and f["kind"] == "check"
        and any(abs(f["y"] - row) <= BAND_SLACK_PT for row in tick_rows)
    ]
    if len(strays) != 1:
        sys.exit(
            f"derive-form-box-map: {key} box 13's row has {len(strays)} unnamed tick "
            f"boxes; exactly one was measured (third-party sick pay, which the IRS "
            f"leaves unnamed). A different count means the row changed, and silently "
            f"folding them all into box 13 would tick a question nobody answered."
        )
    placed["13"].append(strays[0]["name"])
    named.add(strays[0]["name"])

    rest = [f for f in fields if f["name"] not in named]
    unclaimed: list[str] = []
    # Rect name -> why it is deliberately blank. Mirrors the 941's
    # `unclaimedReasons` so both forms answer "why is this box empty?" the same
    # way. Rule 123: unclaimed must never be able to mean unnoticed.
    unclaimed_why: dict[str, str] = {}

    # ── PASS 2a ── The left column: pair by reading order.
    #
    # The right column can be read positionally because every label sits above
    # its input area. THE LEFT COLUMN CANNOT: box f is printed
    # "f Employee's address and ZIP code" BELOW the area you write the address
    # in - measured, the label is at y=277.17 and its rect spans y=206..276. A
    # "nearest label above" rule silently hands that rect to box e, putting the
    # employee's address where their name belongs.
    #
    # So the left column is paired the way the form is read: the remaining
    # rects top to bottom against the remaining letters in order. The counts
    # must match exactly - if they do not, the layout is not what was measured
    # and this refuses rather than pairing a shifted sequence, which would
    # misattribute EVERY remaining box rather than one.
    left = sorted([f for f in rest if "Col_Left" in f["name"]], key=lambda f: (f["y"], f["x"]))
    letters = [c for c in "abcdef" if c not in placed]

    # A rect on the same row as an already-named rect belongs with it: the
    # "Suff." box shares box e's row with the first and last name fields.
    rows_named = {
        round(f["y"], 1)
        for f in fields
        if f["name"] in named and "Col_Left" in f["name"]
    }
    joined = [f for f in left if round(f["y"], 1) in rows_named]
    for f in joined:
        owner = next(
            (b for b, ns in placed.items()
             if any(round(o["y"], 1) == round(f["y"], 1) for o in fields if o["name"] in ns)),
            None,
        )
        if owner is None:
            unclaimed.append(f["name"])
            unclaimed_why[f["name"]] = (
                "A left-column input area on a row where no named box was found, so "
                "there is no box to bind it to. Recorded rather than bound to a "
                "neighbour, because guessing an owner would print a figure in the "
                "wrong box on a filed form."
            )
            continue
        placed[owner].append(f["name"])
        named.add(f["name"])

    left = [f for f in left if f["name"] not in named]
    if len(left) != len(letters):
        sys.exit(
            f"derive-form-box-map: {key} left column has {len(left)} unnamed input "
            f"areas but {len(letters)} unclaimed letter labels {letters}. These are "
            f"paired in reading order, so a count mismatch means the pairing would be "
            f"shifted and EVERY identity box - name, address, EIN - would be "
            f"attributed to the wrong one."
        )
    for f, letter in zip(left, letters):
        placed.setdefault(letter, []).append(f["name"])
        named.add(f["name"])

    # ── PASS 2b ── Everything else: the label heading this rect's own column.
    #
    # ═══ THE RULE THIS REPLACED, AND WHY IT WAS WRONG ═══
    #
    # The first version took "the lowest label at or above the rect, anywhere to
    # its left". That is how you read a LIST, and the right-hand side of the W-2
    # is not a list, it is a column of cells beside a completely separate column
    # of cells. So a left-margin letter printed slightly lower on the page
    # out-ranked the heading printed directly above the rect:
    #
    #   * box 11's input area went to box "e", so an employee's nonqualified
    #     plans would have printed under their name, and box 11 vanished from
    #     the map entirely - a whole line missing from the form;
    #   * the two 14b occupation-code areas went to box "f", the address.
    #
    # Both looked right in a coloured overlay, because every rect was tinted
    # SOMETHING. Only dumping box -> rect coordinates as numbers showed it.
    #
    # The rule now says what "heading" actually means: a label heads a rect when
    # it sits ABOVE it and OVERLAPS IT HORIZONTALLY. A label in another column
    # cannot claim the rect however close it is vertically. Among the labels
    # that qualify, the nearest one above wins, which is the closest cell
    # heading - exactly what the eye does.
    for f in rest:
        if f["name"] in named:
            continue
        left_edge = f["x"] - W2_LABEL_INSET_SLACK_PT
        right_edge = f["x"] + f["w"]
        claimants = [
            (ly0, name)
            for name, (lx, ly0, _ly1) in labels.items()
            if ly0 <= f["y"] + BAND_SLACK_PT and left_edge <= lx <= right_edge
        ]
        if not claimants:
            unclaimed.append(f["name"])
            unclaimed_why[f["name"]] = (
                "No printed label sits above this rect within the measured band, so "
                "nothing on the paper says what it is for. Left blank and recorded "
                "rather than guessed from position alone."
            )
            continue
        label = max(claimants)[1]
        if label in W2_LABELS_NOT_MODELLED:
            unclaimed.append(f["name"])
            # Record the reason against the RECT NAME, not just the label.
            #
            # `notModelled` already carried the prose, but keyed by the printed
            # label ("14b"), while the 941 keys its reasons by rect name. A
            # reader - or a gate - holding an unfilled rect could therefore ask
            # the 941 why it was blank and get an answer, and ask the W-2 the
            # same question and get nothing. Same question, same shape of
            # answer, or the coverage gate can only be enforced on one form.
            unclaimed_why[f["name"]] = W2_LABELS_NOT_MODELLED[label]
            continue
        placed.setdefault(W2_LABEL_TO_BOX.get(label, label), []).append(f["name"])

    for names in placed.values():
        names.sort()

    # ── THE SECOND COPY ────────────────────────────────────────────────────
    #
    # Everything above derived the TOP form, by reading printed labels. The
    # bottom form is not derived again: it is the same form, and its rects are
    # an exact translation of the top one's (see `copy_partition`). So the
    # placement is TRANSLATED rather than re-measured.
    #
    # Deriving it twice would be the worse choice even though it sounds more
    # rigorous - it would let the two copies disagree, and a W-2 whose bottom
    # half attributes box 17 differently from its top half is a defect nobody
    # would ever see. Translating makes them provably identical by construction.
    copies, pitch, successor = copy_partition(page_geo)
    per_copy: list[dict[str, list[str]]] = [placed]
    for index in range(1, copies):
        previous = per_copy[index - 1]
        this: dict[str, list[str]] = {}
        for box, names in previous.items():
            moved = []
            for n in names:
                nxt = successor.get(n)
                if nxt is None:
                    sys.exit(
                        f"derive-form-box-map: {key} copy {index}: field {n!r} of the copy "
                        f"above has no counterpart one pitch down, though the page measured "
                        f"as {copies} identical copies. Placing some boxes on the second form "
                        f"and not others would fill half a form, which reads as a form that "
                        f"failed to load."
                    )
                moved.append(nxt)
            this[box] = sorted(moved)
        per_copy.append(this)

    translated_unclaimed = list(unclaimed)
    for index in range(1, copies):
        for n in unclaimed:
            hop = n
            for _ in range(index):
                nxt = successor.get(hop)
                if nxt is None:
                    break
                hop = nxt
            if hop != n:
                translated_unclaimed.append(hop)
                # The SECOND copy's blank rect is blank for the same reason as
                # the first's. Without this, the lower W-2 on the sheet would
                # have unexplained gaps while the upper one was fully accounted
                # for - which is precisely the two-up defect this slice found.
                if n in unclaimed_why:
                    unclaimed_why[hop] = unclaimed_why[n]

    covered = {n for c in per_copy for names in c.values() for n in names}
    covered |= set(translated_unclaimed)
    missing = sorted(f["name"] for f in page_geo["fields"] if f["name"] not in covered)
    if missing:
        sys.exit(
            f"derive-form-box-map: {key} has {len(missing)} rect(s) that are neither placed "
            f"nor recorded as unclaimed on any copy: {missing[:6]}. Rule 123 - every rect on "
            f"the page must be accounted for, or half the paper goes unfilled and looks fine."
        )

    return {
        "labels": sorted(labels),
        "midline": [],
        # Copy 0 stays under `placed` so every existing reader is unchanged.
        "placed": placed,
        # The full picture: one placement per form printed on the sheet.
        "copies": per_copy,
        "copyPitchPt": round(pitch, 3),
        "unclaimed": sorted(translated_unclaimed),
        # Same key as the 941 emits, so one gate can check both forms.
        "unclaimedReasons": unclaimed_why,
        "notModelled": W2_LABELS_NOT_MODELLED,
    }


SCHEDULE_B_LABELLED: dict[str, dict] = {
    # The EIN is NINE separate one-character rectangles here, not the 941's two
    # combs. Bound as one box because the EIN is one fact.
    "ein": {"fields": [f"Entity[0].f1_{n:02d}[0]" for n in range(1, 10)]},
    "name": {"fields": ["Entity[0].f1_10[0]"]},
    # Calendar year: four one-character rectangles.
    "calendarYear": {"fields": [f"Entity[0].f1_{n}[0]" for n in (11, 12, 13, 14)]},
    "m1Total": {"fields": ["Page1[0].f1_77[0]", "Page1[0].f1_78[0]"]},
    "m2Total": {"fields": ["Page1[0].f1_141[0]", "Page1[0].f1_142[0]"]},
    "m3Total": {"fields": ["Page1[0].f1_205[0]", "Page1[0].f1_206[0]"]},
    "quarterTotal": {"fields": ["Page1[0].f1_207[0]", "Page1[0].f1_208[0]"]},
}

# The four quarter ticks. Not filled, for the reason `checkSlots` gives: we
# compute figures, we do not tick boxes on a signed return. Recorded so a
# reader can see the tick exists and that we deliberately left it.
SCHEDULE_B_UNCLAIMED: dict[str, str] = {
    "c1_1[0]": (
        "Schedule B 'Report for this Quarter' tick, quarter 1. The quarter is printed in "
        "the page heading and in the calendar-year box, both filled from the period being "
        "viewed. Ticking a box on a schedule filed under penalties of perjury is his "
        "signature, not our computation."
    ),
    "c1_1[1]": "Quarter 2 tick. Same reason as quarter 1.",
    "c1_1[2]": "Quarter 3 tick. Same reason as quarter 1.",
    "c1_1[3]": "Quarter 4 tick. Same reason as quarter 1.",
}


def schedule_b_unclaimed_reason(field_name: str) -> str | None:
    for suffix, reason in SCHEDULE_B_UNCLAIMED.items():
        if field_name.endswith(suffix):
            return reason
    return None


"""
SCHEDULE B (FORM 941) - 93 DAY CELLS, BOUND TO THE DAY THE IRS PRINTS

Every cell is bound to the NUMBER PRINTED BESIDE IT, not to its position in the
column order. The columns run down-then-across (1-8, 9-16, 17-24, 25-31), which
is not the order a reader assumes, and a schedule whose liability lands on the
wrong day is a late-deposit penalty (D-05).
"""

# Rightmost edge of a day label may sit this far left of its cell, and this far
# off its vertical centre. Measured: all 93 bind uniquely inside these bounds.
SB_LABEL_MAX_GAP_PT = 28.0
SB_LABEL_MAX_DY_PT = 7.0

# The three month blocks, split at the y of the "Month 2" and "Month 3"
# headings. Measured from the printed headings rather than hard-coded.
SB_MONTH_HEADING = "Month"


def derive_schedule_b(key: str, page_geo: dict, pdf: Path) -> dict:
    words = words_of(pdf, page_geo["page"])
    fields = page_geo["fields"]
    by_name = {f["name"]: f for f in fields}

    # Where each month block starts, from the printed headings.
    #
    # "Month" appears EIGHT times on this page: three block headings at the left
    # margin, three "Tax liability for Month N" labels at x=505, and twice in
    # the footer sentence "(Month 1 + Month 2 + Month 3)". Only the left-margin
    # ones head a block, and that is the property matched - measured, not
    # counted off. The gate below caught the naive version.
    bands = sorted(
        round(w["y0"], 1)
        for w in words
        if w["t"] == SB_MONTH_HEADING and w["x0"] < LEFT_MARGIN_MAX_X
    )
    if len(bands) != 3:
        sys.exit(
            f"derive-form-box-map: {key} found {len(bands)} 'Month' headings, expected 3. "
            f"The month a liability lands in decides its deposit due date, so a mis-split "
            f"grid is a penalty, not a cosmetic error."
        )

    # The day cells: dollar halves (no /MaxLen) inside the grid's x columns.
    col_x = sorted({round(f["x"], 1) for f in fields if f["maxLen"] is None and f["kind"] != "check"})
    grid_x = [x for x in col_x if x < 440.0]
    grid = [
        f
        for f in fields
        if f["maxLen"] is None
        and f["kind"] != "check"
        and round(f["x"], 1) in grid_x
        and bands[0] <= f["y"] < 700
    ]

    day_words = [w for w in words if w["t"].isdigit() and 1 <= int(w["t"]) <= 31]

    placed: dict[str, list[str]] = {}
    for f in grid:
        centre = f["y"] + f["h"] / 2
        hits = [
            w
            for w in day_words
            if w["x1"] <= f["x"] + 1
            and f["x"] - w["x1"] < SB_LABEL_MAX_GAP_PT
            and abs((w["y0"] + w["y1"]) / 2 - centre) < SB_LABEL_MAX_DY_PT
        ]
        if len(hits) != 1:
            sys.exit(
                f"derive-form-box-map: {key} cell {f['name']!r} at x={f['x']} y={f['y']} has "
                f"{len(hits)} day numbers printed beside it. Exactly one is required - "
                f"guessing which day a liability belongs to is guessing a deposit due date."
            )
        day = int(hits[0]["t"])
        month = 1 if f["y"] < bands[1] else (2 if f["y"] < bands[2] else 3)
        box_id = f"m{month}d{day}"

        # The cents half sits immediately right of the dollars half on the same
        # row. Paired by geometry, so a revision that moves them cannot leave a
        # figure split across two different days' boxes.
        cents = [
            c
            for c in fields
            if c["maxLen"] is not None
            and c["kind"] != "check"
            and abs(c["y"] - f["y"]) < 1.5
            and 0 <= c["x"] - (f["x"] + f["w"]) <= 12
        ]
        if len(cents) != 1:
            sys.exit(
                f"derive-form-box-map: {key} cell {f['name']!r} has {len(cents)} cents boxes "
                f"beside it, expected 1. Printing dollars without their cents understates a "
                f"tax liability by up to 99 cents - see D-03."
            )
        if box_id in placed:
            sys.exit(
                f"derive-form-box-map: {key} box {box_id!r} claimed twice. Two cells for one "
                f"day means one day's liability would overwrite another's."
            )
        placed[box_id] = [f["name"], cents[0]["name"]]

    if len(placed) != 93:
        sys.exit(
            f"derive-form-box-map: {key} bound {len(placed)} day cells, expected 93 "
            f"(31 days x 3 months). A missing day is a payday with nowhere to land."
        )

    # ── The four totals and the header ────────────────────────────────────────
    #
    # Bound by the caption the IRS prints beside each, exactly as the 941's
    # entity boxes are, because the field names carry no meaning.
    for box_id, spec in SCHEDULE_B_LABELLED.items():
        names: list[str] = []
        for fragment in spec["fields"]:
            matches = [n for n in by_name if n.endswith(fragment)]
            if len(matches) != 1:
                sys.exit(
                    f"derive-form-box-map: {key} box {box_id!r} names the field ending "
                    f"{fragment!r}, which matches {len(matches)} rectangles. Exactly one is "
                    f"required."
                )
            names.append(matches[0])
        if box_id in placed:
            sys.exit(f"derive-form-box-map: {key} box {box_id!r} was claimed twice.")
        placed[box_id] = names

    claimed = {n for names in placed.values() for n in names}
    unclaimed: dict[str, str] = {}
    for f in fields:
        if f["name"] in claimed:
            continue
        reason = schedule_b_unclaimed_reason(f["name"])
        if reason is None:
            sys.exit(
                f"derive-form-box-map: {key} rectangle {f['name']!r} at x={f['x']} "
                f"y={f['y']} is neither placed nor listed as deliberately unclaimed. "
                f"Rule 123."
            )
        unclaimed[f["name"]] = reason

    copies, pitch, _succ = copy_partition(page_geo)
    if copies != 1:
        sys.exit(
            f"derive-form-box-map: {key} measured as {copies} copies on one page. "
            f"Schedule B has always been one form per page."
        )

    # ── D-04: the cents /MaxLen is a fact about THIS form ─────────────────────
    #
    # Schedule B uses 2; both 941 pages use 3; the W-2 does not split money at
    # all. A single global constant would have left all 97 of this form's cents
    # boxes empty. Measured here, carried in the data.
    # Measured over the MONEY boxes only. The EIN and calendar-year cells also
    # carry a /MaxLen (1, one character per printed square) and including them
    # would make this look ambiguous when it is not.
    money_boxes = [b for b in placed if b.startswith("m") or b == "quarterTotal"]
    cents_lens = {
        by_name[n]["maxLen"]
        for b in money_boxes
        for n in placed[b]
        if by_name[n]["maxLen"] is not None
    }
    if len(cents_lens) != 1:
        sys.exit(
            f"derive-form-box-map: {key} cents boxes report /MaxLen {sorted(cents_lens)}. "
            f"One value is required - see D-04."
        )

    return {
        "labels": sorted(placed),
        "midline": [],
        "placed": placed,
        "copies": [placed],
        "copyPitchPt": round(pitch, 3),
        "unclaimed": sorted(unclaimed),
        "unclaimedReasons": dict(sorted(unclaimed.items())),
        "centsMaxLen": cents_lens.pop(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# FORM 940 — A 941 THAT WRAPS, AND TWO LABELS THE 941'S SCAN CANNOT READ
#
# ═══ WHY THE 941'S OWN SCAN IS NOT REUSED WHOLESALE ═══
#
# The 940 looks like the 941: numbered lines down a left margin, money in the
# right. Two MEASURED differences broke the 941's scanner when it was pointed at
# this form, and both were found by running it rather than by reading it.
#
#   1. THE 940 PRINTS SOME LABELS AS TWO GLYPH RUNS. `pdftotext` reports line
#      1b as the words "1" and "b", and line 15a as "15" and "a", because the
#      artwork sets the digits and the letter as separate runs sitting flush
#      against each other. The 941 does not do this on any line.
#
#      Fed to the 941's scanner, that produced labels "1" and "15" - two lines
#      THAT DO NOT EXIST ON THE FORM - and lost 1b and 15a entirely. Line 15a
#      is the overpayment. A form that cannot place its overpayment box is a
#      form that silently drops a refund.
#
#      Runs are therefore re-joined when they sit on one baseline with no gap
#      between them. Verified against the 941 as well: joining changes NOTHING
#      on either 941 page (same 22 and 3 labels before and after), so this is
#      an addition to what the scanner can read, not a change to what it does.
#
#   2. THE 940'S ROWS WRAP, SO A LABEL'S BAND IS NOT ITS LABEL'S HEIGHT. Line
#      14 reads "Balance due. If line 12 is more than line 13..." and continues
#      over two more printed lines of bullets before line 15a starts. Its money
#      rects sit on the LAST of those lines, 17pt below the label - well outside
#      the 941's 8pt band, which is why line 14's two rects were unplaced.
#
#      So a label's band here runs from the label down to THE NEXT STOP: the
#      next margin label, or the next "Part N:" heading. That is how the paper
#      itself is divided, and it leaves no gaps for a rect to fall through.
#
# ═══ WHY THAT BAND RULE IS NOT RETRO-FITTED TO THE 941 ═══
#
# Measured: applying it to 941 page 2 makes line 16's band swallow the entire
# monthly-liability grid, which this product deliberately leaves BLANK because
# `Form941Return` carries no monthly breakdown (see NINE41_UNCLAIMED, and D-06).
# The wider rule is right for the 940 and wrong for the 941, so each form keeps
# the rule that its own artwork justifies.
# ─────────────────────────────────────────────────────────────────────────────

# Measured: the 940's margin labels print at x=38.47 ("17") through x=57.62
# ("16a" on page 2, indented because it is a sub-line of 16). The 941's 48pt
# cut-off would drop every one of 16a..16d, which are the four quarterly
# liabilities the engine computes.
NINE40_MARGIN_MAX_X = 60.0

# Where the margin scan STOPS on a page that has one.
#
# Measured: page 2 prints "Page 2" in the footer as the runs "Page" (x=36.00,
# y=698.47) and "2" (x=54.02, y=695.39). Different baselines, so they are not
# joined - and a bare "2" inside the margin is label-shaped. Left alone it
# invented a "line 2" on a page whose lines are 16 and 17.
#
# Rather than special-case a footer, the scan stops where the form stops asking
# for figures: "Part 6:" opens the third-party designee block and "Part 7:" the
# signature block, and this product fills neither (same stance as the 941 - see
# NINE41_UNCLAIMED categories A and C). Page 1 prints no Part 6, so nothing is
# cut there and line 15e at y=727 still places.
NINE40_LABEL_FLOOR_HEADING = "Part 6:"

# Line 4's five exempt-payment ticks, bound by the caption the IRS prints beside
# each one.
#
# ═══ WHY CAPTION AND NOT THE "4a" TOKEN ═══
#
# The obvious route is the mid-line label pass used for the 941's 15b/15d: find
# the printed "4a", claim the rects to its right. MEASURED, IT MISBINDS. The
# five ticks sit on two rows 12pt apart while the labels are ~10pt tall, so with
# any workable slack row 1's band overlaps row 2's, and 4a and 4b both claim
# both ticks. The rightmost-label tie-break cannot separate them either: 4a and
# 4b are printed at the SAME x (144.00).
#
# The captions do separate them, because each names one thing and is printed
# once. This is D-06's lesson applied before it could bite: bind a tick by the
# words next to it, never by its index or its neighbourhood.
NINE40_EXEMPT_TICKS: dict[str, str] = {
    "4a": "Fringe benefits",
    "4b": "Group-term life insurance",
    "4c": "Retirement/Pension",
    "4d": "Dependent care",
    "4e": "Other",
}

# Measured gap from a tick's RIGHT edge to the start of its caption: 5.2, 5.2,
# 3.6, 3.6 and 3.2pt. 12pt covers all five without reaching the next tick,
# whose nearest neighbour is over 130pt away.
NINE40_TICK_CAPTION_GAP_PT = 12.0

# A tick and its caption share a printed row. Measured: all five within 0.2pt.
NINE40_TICK_ROW_SLACK_PT = 6.0

# Mid-line labels, as on the 941: "15b Check one:" and "15d Type:" are
# continuations of the 15a and 15c rows rather than rows of their own.
# Measured at x=414.36 and x=284.80 on page 1.
NINE40_MIDLINE: dict[str, list[str]] = {
    "940-p1": ["15b", "15d"],
}

# Mid-line bands use the label's OWN printed height with NO slack.
#
# Measured, and the reason is specific: 15b's band is y=697.28..707.42 and the
# two ticks it owns are centred at y=701. Line 15a's money rects are centred at
# y=699 - also inside that band - and are kept out only by the x test, which is
# what the rightmost-label rule is for. Adding the 941's 8pt slack would pull
# 15d's "Checking/Savings" ticks (centred y=717) into 15b's reach as well, and
# then the deposit-type answer would land under the apply-or-refund question.
NINE40_MIDLINE_SLACK_PT = 0.0

# The 940's word-labelled boxes, in the same verified-against-the-caption form
# as NINE41_ENTITY. Corroborated against Michael's own filed return,
# `2025_FORM_940_-_SAGE.pdf`.
#
# NOTE THE TWO PAGES DISAGREE ABOUT THE EIN CAPTION, and it is measured rather
# than assumed: page 1 sets it over two printed lines, so the line beside the
# rect reads "Employer identification number" with "(EIN)" underneath, while
# page 2 sets the whole thing on one line. Written from page 1 alone, page 2's
# EIN would not have bound; written from page 2 alone, page 1's would not.
NINE40_ENTITY: dict[str, dict] = {
    "940-p1": {
        "ein": {
            "fields": ["EntityArea[0].f1_1[0]", "EntityArea[0].f1_2[0]"],
            "caption": "Employer identification number",
        },
        "name": {
            "fields": ["EntityArea[0].f1_3[0]"],
            "caption": "Name (not your trade name)",
        },
        "tradeName": {
            "fields": ["EntityArea[0].f1_4[0]"],
            "caption": "Trade name (if any)",
        },
        "address": {
            "fields": ["EntityArea[0].f1_5[0]"],
            "caption": "Address",
        },
        "cityStateZip": {
            "fields": [
                "EntityArea[0].f1_6[0]",
                "EntityArea[0].f1_7[0]",
                "EntityArea[0].f1_8[0]",
            ],
            "caption": "City",
        },
    },
    "940-p2": {
        "name": {
            "fields": ["Page2[0].f1_3[0]"],
            "caption": "Name (not your trade name)",
        },
        "ein": {
            "fields": ["Page2[0].f1_1[0]", "Page2[0].f1_2[0]"],
            "caption": "Employer identification number (EIN)",
        },
    },
}

# Rectangles deliberately left blank, each with a reason that survives being
# read aloud. Same three categories as the 941: a choice only Michael can make,
# a figure the engine does not compute, or a signature.
NINE40_UNCLAIMED: dict[str, dict[str, str]] = {
    "940-p1": {
        # ── A: choices only he can make ──────────────────────────────────────
        "TypeReturn[0].c1_1[0]": (
            "'a. Amended'. Whether this return corrects an earlier one is a statement about "
            "his filing history, not a figure. Ticking it for him would tell the IRS a return "
            "already on file was wrong."
        ),
        "TypeReturn[0].c1_2[0]": (
            "'b. Successor employer'. True only if he took over another employer's business "
            "during the year. Nothing in the books can establish that, and it changes how the "
            "$7,000 wage base is applied."
        ),
        "TypeReturn[0].c1_3[0]": (
            "'c. No payments to employees'. The engine can see that wages WERE paid, so this "
            "box is correctly blank - but it is left to him rather than argued from data, "
            "because a year with no payroll is a year with no 940 rows to read."
        ),
        "TypeReturn[0].c1_4[0]": (
            "'d. Final: Business closed or stopped paying wages'. A declaration that Greenway "
            "has ceased paying wages. Ticking this on his behalf would close his account with "
            "the IRS."
        ),
        "AggregateReturn[0].c1_5[0]": (
            "'Section 3504 Agent'. Aggregate filers only. Greenway files for itself, so all "
            "three of these are correctly blank."
        ),
        "AggregateReturn[0].c1_5[1]": (
            "'Certified Professional Employer Organization (CPEO)'. Aggregate filers only; "
            "Greenway is not one."
        ),
        "AggregateReturn[0].c1_5[2]": (
            "'Other Third Party'. Aggregate filers only; Greenway is not one."
        ),
        # ── B: figures the engine does not hold ──────────────────────────────
        "EntityArea[0].f1_9[0]": (
            "'Foreign country name'. Greenway's address is in Port Orchard, Washington, and "
            "the paper asks for a foreign address INSTEAD of a domestic one, not as well as. "
            "Correctly blank on every return Greenway will ever file."
        ),
        "EntityArea[0].f1_10[0]": "'Foreign province/county'. See the foreign country note above.",
        "EntityArea[0].f1_11[0]": "'Foreign postal code'. See the foreign country note above.",
    },
    "940-p2": {
        # ── A: a choice only he can make ─────────────────────────────────────
        "Page2[0].f2_11[0]": (
            "Part 6, the third-party designee's name. Naming someone who may discuss the "
            "return with the IRS is an authorisation, and software cannot grant it."
        ),
        "Page2[0].f2_12[0]": "Part 6, the designee's phone number. See the designee note above.",
        "Page2[0].f2_13[0]": (
            "Part 6, the 5-digit PIN the designee would use with the IRS. A credential, and "
            "one this product neither holds nor should invent."
        ),
        "Page2[0].c2_1[0]": (
            "Part 6 'Yes'. Whether to allow a third party to discuss the return is his "
            "decision to make and sign for."
        ),
        "Page2[0].c2_1[1]": "Part 6 'No'. See the note on the 'Yes' tick above.",
        # ── C: a signature under penalties of perjury ────────────────────────
        "Page2[0].f2_14[0]": (
            "Part 7, 'Print your name here'. The company profile does hold a signer name, and "
            "his filed 940 prints MICHAEL LYMAN here - but this sits under a declaration made "
            "under penalties of perjury, and pre-filling a perjury block is the worst possible "
            "place for software to be helpful. Left blank deliberately, and surfaced in the "
            "owner report so the omission is his to overrule."
        ),
        "Page2[0].f2_15[0]": "Part 7, 'Print your title here'. See the perjury note above.",
        "Page2[0].f2_16[0]": "Part 7, 'Best daytime phone'. Part of the signature block.",
        "Page2[0].c2_2[0]": (
            "Paid Preparer 'Check if you are self-employed'. A statement about a preparer this "
            "product is not."
        ),
        "Page2[0].f2_17[0]": (
            "Paid Preparer's name. Greenway's 940 is prepared in-house; the whole preparer "
            "block is correctly blank, and it is listed rather than dropped so a reader can "
            "see the boxes exist."
        ),
        "Page2[0].f2_18[0]": "Paid Preparer's PTIN. See the preparer note above.",
        "Page2[0].f2_19[0]": "Paid Preparer's firm name. See the preparer note above.",
        "Page2[0].f2_20[0]": "Paid Preparer's firm EIN. See the preparer note above.",
        "Page2[0].f2_21[0]": "Paid Preparer's address. See the preparer note above.",
        "Page2[0].f2_22[0]": "Paid Preparer's phone. See the preparer note above.",
        "Page2[0].f2_23[0]": "Paid Preparer's city. See the preparer note above.",
        "Page2[0].f2_24[0]": "Paid Preparer's state. See the preparer note above.",
        "Page2[0].f2_25[0]": "Paid Preparer's ZIP code. See the preparer note above.",
    },
}

# MEASURED from f940.pdf: the cents half of every money pair is /MaxLen 2, on
# both pages. The 941 uses 3 and Schedule B uses 2 - see D-04, which is why
# this is read off the artwork per form instead of shared.
#
# Page 1 has fifteen /MaxLen 2 rectangles and only thirteen of them are cents:
# the other two are the EIN's leading 2-digit comb and the 2-letter state. Both
# are identity boxes, which take the identity path in `slotsFor` and never reach
# the cents logic, so the collision is real but harmless. Recorded here so the
# next person does not have to rediscover it.
NINE40_CENTS_MAX_LEN = 2


def glue_runs(words: list[dict]) -> list[dict]:
    """
    Re-join glyph runs the artwork sets flush against each other on one baseline.

    "1" + "b" -> "1b". Necessary because the 940 sets some of its own line
    numbers as two runs; see difference 1 in the note above. Verified to be a
    no-op on both 941 pages.
    """
    ws = sorted((w for w in words if w["t"].strip()), key=lambda w: (round(w["y0"], 1), w["x0"]))
    out: list[dict] = []
    i = 0
    while i < len(ws):
        t, x0, x1 = ws[i]["t"], ws[i]["x0"], ws[i]["x1"]
        y0, y1 = ws[i]["y0"], ws[i]["y1"]
        j = i + 1
        # Same baseline (within half a point) and no gap (within one point).
        while j < len(ws) and abs(ws[j]["y0"] - y0) < 0.5 and abs(ws[j]["x0"] - x1) < 1.0:
            t += ws[j]["t"]
            x1 = ws[j]["x1"]
            y1 = max(y1, ws[j]["y1"])
            j += 1
        out.append({"t": t, "x0": x0, "y0": y0, "x1": x1, "y1": y1})
        i = j
    return out


def nine40_bands(key: str, pdf: Path, page_no: int) -> dict[str, tuple[float, float]]:
    """Line number -> the band running from its label down to the next stop."""
    words = words_of(pdf, page_no)
    glued = glue_runs(words)

    parts = [p for p in printed_phrases(pdf, page_no) if re.match(r"^Part \d+:", p["t"])]
    floor = min(
        (p["y0"] for p in parts if p["t"].startswith(NINE40_LABEL_FLOOR_HEADING)),
        default=float("inf"),
    )

    tops: dict[str, float] = {}
    for w in glued:
        if w["x0"] >= NINE40_MARGIN_MAX_X or not LINE_LABEL_RE.fullmatch(w["t"]):
            continue
        if w["y0"] >= floor:
            continue
        if w["t"] in tops:
            sys.exit(
                f"derive-form-box-map: {key} line label {w['t']!r} is printed twice in the "
                f"left margin above the signature block, so the band it names is ambiguous. "
                f"Refusing to pick one."
            )
        tops[w["t"]] = w["y0"]

    if not tops:
        sys.exit(
            f"derive-form-box-map: {key} found no line labels in the left margin. The 940 is "
            f"a column of numbered lines; finding none means the scan is looking in the wrong "
            f"place, and every money box would silently go unplaced."
        )

    # A band ends at the next thing that starts a new row: another label, or a
    # Part heading. Both are stops, so no rect can fall between two bands.
    stops = sorted([*tops.values(), *(p["y0"] for p in parts), floor])
    return {
        name: (top, next((s for s in stops if s > top + 0.5), float("inf")))
        for name, top in tops.items()
    }


def nine40_exempt_tick_placements(
    key: str, page_geo: dict, phrases: list[dict]
) -> dict[str, list[str]]:
    """Line 4's five exempt-payment ticks, each bound by its printed caption."""
    if key != "940-p1":
        return {}
    checks = [f for f in page_geo["fields"] if f["kind"] == "check"]
    out: dict[str, list[str]] = {}
    for box_id, caption in NINE40_EXEMPT_TICKS.items():
        hits = [p for p in phrases if p["t"] == caption]
        if len(hits) != 1:
            sys.exit(
                f"derive-form-box-map: {key} expects the caption {caption!r} printed exactly "
                f"once beside line 4's tick boxes and found {len(hits)}. Refusing to guess "
                f"which exemption a tick claims."
            )
        cap = hits[0]
        cap_centre = (cap["y0"] + cap["y1"]) / 2
        near = [
            f
            for f in checks
            if abs(f["y"] + f["h"] / 2 - cap_centre) <= NINE40_TICK_ROW_SLACK_PT
            and f["x"] + f["w"] <= cap["x0"]
            and cap["x0"] - (f["x"] + f["w"]) <= NINE40_TICK_CAPTION_GAP_PT
        ]
        if len(near) != 1:
            sys.exit(
                f"derive-form-box-map: {key} box {box_id!r} expects exactly one tick box "
                f"immediately left of the caption {caption!r} and found {len(near)}. A "
                f"mis-bound tick here claims an exemption from FUTA that was never taken."
            )
        out[box_id] = [near[0]["name"]]
    return out


def derive_940(key: str, page_geo: dict, pdf: Path) -> dict:
    bands = nine40_bands(key, pdf, page_geo["page"])
    phrases = printed_phrases(pdf, page_geo["page"])
    midline = midline_label_positions(
        glue_runs(words_of(pdf, page_geo["page"])), NINE40_MIDLINE.get(key, [])
    )

    placed: dict[str, list[str]] = {}
    for field in page_geo["fields"]:
        centre = field["y"] + field["h"] / 2
        hits = [name for name, (top, bottom) in bands.items() if top <= centre < bottom]
        if len(hits) > 1:
            sys.exit(
                f"derive-form-box-map: {key} field {field['name']!r} sits in the bands of "
                f"lines {sorted(hits)}. Bands run label-to-next-stop and cannot overlap, so "
                f"this means the artwork changed."
            )
        if not hits:
            continue
        owner = hits[0]

        # A mid-line label steals the rects to its right - the same rule the 941
        # uses for 15b/15d, and for the same reason: one printed row carries two
        # different questions.
        claimants = [
            (lx, name)
            for name, (lx, ly0, ly1) in midline.items()
            if ly0 - NINE40_MIDLINE_SLACK_PT <= centre <= ly1 + NINE40_MIDLINE_SLACK_PT
            and field["x"] >= lx
        ]
        if claimants:
            owner = max(claimants)[1]

        placed.setdefault(owner, []).append(field["name"])

    # Line 4's ticks land in line 4's band by position; re-home them onto the
    # five boxes the paper actually labels, each confirmed by caption.
    for box_id, names in nine40_exempt_tick_placements(key, page_geo, phrases).items():
        for n in names:
            for owner, owned in placed.items():
                if n in owned and owner != box_id:
                    owned.remove(n)
        placed.setdefault(box_id, []).extend(names)

    for box_id, names in entity_placements_940(key, page_geo, phrases).items():
        if box_id in placed:
            sys.exit(
                f"derive-form-box-map: {key} box {box_id!r} was claimed by both the margin "
                f"scan and the entity table. Two sources disagreeing about one box is exactly "
                f"the ambiguity this script refuses to resolve silently."
            )
        placed[box_id] = names

    # Rule 123: every rectangle placed, or listed with a reason.
    claimed = {n for names in placed.values() for n in names}
    unclaimed: dict[str, str] = {}
    for field in page_geo["fields"]:
        if field["name"] in claimed:
            continue
        reason = next(
            (r for suffix, r in NINE40_UNCLAIMED.get(key, {}).items() if field["name"].endswith(suffix)),
            None,
        )
        if reason is None:
            sys.exit(
                f"derive-form-box-map: {key} rectangle {field['name']!r} at x={field['x']} "
                f"y={field['y']} is neither placed nor listed as deliberately unclaimed. "
                f"Rule 123 - every rect on the page must be accounted for, or part of a tax "
                f"form goes unfilled and looks fine."
            )
        unclaimed[field["name"]] = reason

    copies, pitch, _ = copy_partition(page_geo)
    if copies != 1:
        sys.exit(
            f"derive-form-box-map: {key} measured as {copies} copies of the form on one page. "
            f"The 940 has always been one form per page; if that changed, the placement below "
            f"fills only the first of them."
        )

    return {
        "labels": sorted(bands),
        "midline": sorted(midline),
        "placed": {k: sorted(v) for k, v in placed.items()},
        "copies": [{k: sorted(v) for k, v in placed.items()}],
        "copyPitchPt": round(pitch, 3),
        "unclaimed": sorted(unclaimed),
        "unclaimedReasons": dict(sorted(unclaimed.items())),
        "centsMaxLen": NINE40_CENTS_MAX_LEN,
    }


def entity_placements_940(key: str, page_geo: dict, phrases: list[dict]) -> dict[str, list[str]]:
    """
    The 940's word-labelled boxes, each verified against its printed caption.

    Same contract as `entity_placements`: the rect must exist, and the caption
    the table claims is printed beside it must be found on the page within
    ENTITY_CAPTION_SLACK_PT of it. Matched against whole printed LINES rather
    than single words, because page 1's EIN caption wraps.
    """
    by_name = {f["name"]: f for f in page_geo["fields"]}
    out: dict[str, list[str]] = {}

    for box_id, spec in NINE40_ENTITY.get(key, {}).items():
        names: list[str] = []
        for fragment in spec["fields"]:
            matches = [n for n in by_name if n.endswith(fragment)]
            if len(matches) != 1:
                sys.exit(
                    f"derive-form-box-map: {key} entity box {box_id!r} names the field ending "
                    f"{fragment!r}, which matches {len(matches)} rectangles "
                    f"{sorted(matches)[:4]}. Exactly one is required."
                )
            names.append(matches[0])

        caption = spec["caption"]
        rect_top = min(by_name[n]["y"] for n in names)
        hits = [
            p
            for p in phrases
            if p["t"] == caption and abs(p["y0"] - rect_top) <= ENTITY_CAPTION_SLACK_PT
        ]
        if len(hits) != 1:
            sys.exit(
                f"derive-form-box-map: {key} entity box {box_id!r} expects the caption "
                f"{caption!r} printed within {ENTITY_CAPTION_SLACK_PT}pt of y={rect_top}, and "
                f"found {len(hits)}. Refusing to fill a box whose label cannot be confirmed "
                f"on the paper."
            )
        out[box_id] = names

    return out


# ─────────────────────────────────────────────────────────────────────────────
# FORM W-3 — THE W-2'S GRID, ONE COPY, AND MONEY THAT DOES NOT SPLIT
#
# The W-3 is laid out like the W-2: a boxed grid, letters down the left and
# numbers on the right, each label printed ABOVE the area it heads. So the
# W-2's reading rules apply, with three measured differences.
#
#   1. ONE COPY, NOT TWO. `fw3.pdf` page 2 carries 46 widgets and no
#      `CopyB_Top`/`CopyB_Bottom` split - the transmittal is filed once.
#      `derive_w2` refuses this page outright, which is the correct behaviour
#      for a function whose first act is to select the top of two copies.
#
#   2. MONEY DOES NOT SPLIT. MEASURED /MaxLen distribution across all 46
#      widgets: 28 unset, 15 at 16, 2 at 10, 1 at 2. Every money box is a
#      SINGLE 152.8pt field of /MaxLen 16 - there is no cents rectangle
#      anywhere on the form, and the lone /MaxLen 2 field is box 15's
#      two-letter state code. So no `centsMaxLen` is emitted, exactly as for
#      the W-2, and `slotsFor` prints the whole figure including cents. D-04 is
#      the reason this is measured per form: had 2 been inherited from the 940,
#      the state code would have been treated as a cents box.
#
#   3. PAGE 1 IS NOT THE FORM. It is the SSA's "Attention" notice and carries
#      zero widgets. The transmittal is page 2 - recorded in the geometry
#      script, and worth repeating here because "page 1" is the natural guess
#      and it yields an empty form rather than an error.
# ─────────────────────────────────────────────────────────────────────────────

# Box b is three separate questions sharing one letter, and our lessons treat
# them as three boxes because a reader clicking "941" wants the payer lesson,
# not the employer-type lesson. The IRS's own subform names carry the split, so
# this routes on the agency's naming rather than on position.
#
# Order matters: `c1_3` is nested UNDER `bKindOfEmployer_ReadOrder` but is the
# third-party sick pay tick printed far to the right, so it must be tested
# before the employer-checkbox group that encloses it.
W3_CHECK_GROUPS: list[tuple[str, str, int]] = [
    ("bKindOfEmployer_ReadOrder[0].c1_3[0]", "b-third-party-sick-pay", 1),
    ("EmployerCheckboxes", "b-kind-of-employer", 5),
    ("bKind_ReadOrder", "b-kind-of-payer", 7),
]

W3_LABEL_RE = re.compile(r"^([a-h]|[0-9]{1,2}[a-d]?)$")

# Below this the sheet has left the boxed grid and is into the signature block
# and the SSA's instructions. Measured: the last grid row is y=312 and the
# contact block begins at y=336.
W3_GRID_BOTTOM_PT = 400.0

# How far a label may sit RIGHT of the rect it heads, and how far ABOVE it.
# Measured across all 24 label-bound rects: insets 0.0-9.0pt, drops 2.6-3.0pt.
W3_LABEL_INSET_SLACK_PT = 10.0
W3_LABEL_DROP_MAX_PT = 12.0

# Boxes whose label is NOT above their rect, each bound by caption instead.
#
# Box g is the same trap as the W-2's box f: "g Employer's address and ZIP code"
# is printed BELOW the area you write the address in (label y=240.68, rect spans
# y=204..240.01). A nearest-label-above rule hands that rect to box f - the
# employer's NAME - and prints the address where the name belongs.
#
# The contact block's four fields are inset 11-14pt from their captions, wider
# than the grid's 10pt. Widening the general slack to reach them would let a
# label reach into the next column, so they are named here instead.
W3_CAPTIONED: dict[str, dict] = {
    "g": {
        "fields": ["BoxesC-H[0].f1_06[0]"],
        "captions": ["g Employer\u2019s address and ZIP code"],
    },
    "contact": {
        "fields": ["Page1[0].f1_29[0]", "Page1[0].f1_30[0]", "Page1[0].f1_31[0]", "Page1[0].f1_32[0]"],
        "captions": [
            "Employer\u2019s contact person",
            "Employer\u2019s telephone number",
            "Employer\u2019s fax number",
            "Employer\u2019s email address",
        ],
    },
}

W3_CAPTION_SLACK_PT = 24.0

W3_UNCLAIMED: dict[str, str] = {
    "Page1[0].f1_33[0]": (
        "The 'Title:' field in the signature block. The W-3 is signed under penalties of "
        "perjury - 'I declare that I have examined this return... they are true, correct, and "
        "complete' - and this product does not sign returns. The company profile does hold a "
        "signer title, and his filed W-3 prints OWNER here, but pre-filling a perjury block is "
        "the one place software must not be helpful. Left blank deliberately. Note the "
        "Signature and Date lines carry no widget at all: the SSA expects those in ink."
    ),
}


def derive_w3(key: str, page_geo: dict, pdf: Path) -> dict:
    fields = page_geo["fields"]
    words = words_of(pdf, page_geo["page"])
    phrases = printed_phrases(pdf, page_geo["page"])
    by_name = {f["name"]: f for f in fields}

    placed: dict[str, list[str]] = {}
    named: set[str] = set()

    # ── PASS 1 ── The 13 ticks, by the IRS's own subform names.
    for f in fields:
        if f["kind"] != "check":
            continue
        for fragment, box_id, _ in W3_CHECK_GROUPS:
            if fragment in f["name"]:
                placed.setdefault(box_id, []).append(f["name"])
                named.add(f["name"])
                break
        else:
            sys.exit(
                f"derive-form-box-map: {key} tick box {f['name']!r} belongs to none of the "
                f"three groups box b is made of. An unrouted tick on a transmittal is a "
                f"question about the kind of payer or employer that nobody can answer."
            )
    for _, box_id, expected in W3_CHECK_GROUPS:
        got = len(placed.get(box_id, []))
        if got != expected:
            sys.exit(
                f"derive-form-box-map: {key} box {box_id!r} collected {got} tick boxes; "
                f"{expected} were measured on the artwork. A different count means the "
                f"question changed, and folding a new tick into an old group would answer it."
            )

    # ── PASS 2 ── Boxes named by caption, because their label is not above them.
    for box_id, spec in W3_CAPTIONED.items():
        names: list[str] = []
        for fragment, caption in zip(spec["fields"], spec["captions"], strict=True):
            matches = [n for n in by_name if n.endswith(fragment)]
            if len(matches) != 1:
                sys.exit(
                    f"derive-form-box-map: {key} box {box_id!r} names the field ending "
                    f"{fragment!r}, which matches {len(matches)} rectangles. One is required."
                )
            rect = by_name[matches[0]]
            hits = [
                p
                for p in phrases
                if p["t"] == caption
                and min(abs(p["y0"] - rect["y"]), abs(p["y0"] - (rect["y"] + rect["h"])))
                <= W3_CAPTION_SLACK_PT
            ]
            if len(hits) != 1:
                sys.exit(
                    f"derive-form-box-map: {key} box {box_id!r} expects the caption "
                    f"{caption!r} printed within {W3_CAPTION_SLACK_PT}pt of the rectangle at "
                    f"y={rect['y']} and found {len(hits)}. Refusing to fill a box whose label "
                    f"cannot be confirmed on the paper."
                )
            names.append(matches[0])
            named.add(matches[0])
        placed[box_id] = names

    # ── PASS 3 ── The grid: each label heads the area printed below it.
    labels: dict[str, tuple[float, float, float]] = {}
    for w in glue_runs(words):
        if not W3_LABEL_RE.fullmatch(w["t"]):
            continue
        if w["y1"] - w["y0"] < W2_MIN_LABEL_HEIGHT_PT or w["y0"] > W3_GRID_BOTTOM_PT:
            continue
        if w["t"] in labels:
            sys.exit(
                f"derive-form-box-map: {key} label {w['t']!r} is printed twice inside the "
                f"grid, so the area it heads is ambiguous. Refusing to pick one."
            )
        labels[w["t"]] = (w["x0"], w["y0"], w["y1"])

    for f in sorted(fields, key=lambda f: (f["y"], f["x"])):
        if f["name"] in named or f["kind"] == "check":
            continue
        owners = [
            box
            for box, (lx, _ly0, ly1) in labels.items()
            if abs(lx - f["x"]) <= W3_LABEL_INSET_SLACK_PT and 0 <= f["y"] - ly1 <= W3_LABEL_DROP_MAX_PT
        ]
        if len(owners) > 1:
            sys.exit(
                f"derive-form-box-map: {key} rectangle {f['name']!r} sits under labels "
                f"{sorted(owners)}. Two boxes cannot share one input area."
            )
        if owners:
            placed.setdefault(owners[0], []).append(f["name"])
            named.add(f["name"])

    # ── PASS 4 ── A rect with no label of its own joins the box to its LEFT on
    # the same row. Measured need: box 15 is "15 State | Employer's state ID
    # number" - two rectangles, one label, and our box 15 covers both.
    for f in sorted(fields, key=lambda f: (f["y"], f["x"])):
        if f["name"] in named or f["kind"] == "check":
            continue
        left = [
            (o["x"], box)
            for box, owned in placed.items()
            for o in (by_name[n] for n in owned)
            if round(o["y"], 1) == round(f["y"], 1) and o["x"] < f["x"]
        ]
        if left:
            placed[max(left)[1]].append(f["name"])
            named.add(f["name"])

    unclaimed: dict[str, str] = {}
    for f in fields:
        if f["name"] in named:
            continue
        reason = next(
            (r for suffix, r in W3_UNCLAIMED.items() if f["name"].endswith(suffix)), None
        )
        if reason is None:
            sys.exit(
                f"derive-form-box-map: {key} rectangle {f['name']!r} at x={f['x']} y={f['y']} "
                f"is neither placed nor listed as deliberately unclaimed. Rule 123."
            )
        unclaimed[f["name"]] = reason

    copies, pitch, _ = copy_partition(page_geo)
    if copies != 1:
        sys.exit(
            f"derive-form-box-map: {key} measured as {copies} copies on one page. The W-3 is "
            f"a transmittal filed once; if that changed, only the first would be filled."
        )

    if any(f.get("maxLen") == 3 for f in fields):
        sys.exit(
            f"derive-form-box-map: {key} now has a /MaxLen 3 rectangle. The W-3 was measured "
            f"as a form that does NOT split money, so no centsMaxLen is emitted and the "
            f"default of 3 would start splitting figures into a box that is not a cents box."
        )

    return {
        "labels": sorted(labels),
        "midline": [],
        "placed": {k: sorted(v) for k, v in placed.items()},
        "copies": [{k: sorted(v) for k, v in placed.items()}],
        "copyPitchPt": round(pitch, 3),
        "unclaimed": sorted(unclaimed),
        "unclaimedReasons": dict(sorted(unclaimed.items())),
    }


def main() -> int:
    if not GEOMETRY.exists():
        sys.exit("derive-form-box-map: run derive-form-geometry.py first")
    geometry = json.loads(GEOMETRY.read_text())

    result: dict[str, dict] = {}

    # ── FORM 941 ────────────────────────────────────────────────────────────
    for key in ("941-p1", "941-p2"):
        page_geo = geometry[key]
        pdf = REPO / page_geo["pdf"]
        words = words_of(pdf, page_geo["page"])
        labels = margin_labels(words)
        midline = midline_label_positions(words, MIDLINE_LABELS.get(key, []))

        placed: dict[str, list[str]] = {}
        for field in page_geo["fields"]:
            centre = field["y"] + field["h"] / 2
            hits = [
                name
                for name, (y0, y1) in labels.items()
                if y0 - BAND_SLACK_PT <= centre <= y1 + BAND_SLACK_PT
            ]
            if len(hits) > 1:
                sys.exit(
                    f"derive-form-box-map: {key} field {field['name']!r} sits in the bands "
                    f"of lines {sorted(hits)}. A rect that belongs to two lines would print "
                    f"one line's figure against another's label."
                )
            if not hits:
                continue
            owner = hits[0]

            # A mid-line label sitting in the SAME band steals the rects to its
            # right. On the 941 that is line 15a's band, which the paper shares
            # between "15a Overpayment [amount]" and "15b Check one: [ ] [ ]" -
            # one row, two different questions. Attributing all four rects to
            # 15a would put the overpayment figure and the apply/refund
            # checkboxes under one heading, and a reader clicking the checkbox
            # would be shown the lesson about overpayment amounts.
            #
            # `max` rather than "the first match": with several mid-line labels
            # in one band, a rect belongs to the RIGHTMOST label it sits after,
            # exactly as a person reads left to right.
            claimants = [
                (lx, name)
                for name, (lx, ly0, ly1) in midline.items()
                if ly0 - BAND_SLACK_PT <= centre <= ly1 + BAND_SLACK_PT and field["x"] >= lx
            ]
            if claimants:
                owner = max(claimants)[1]

            placed.setdefault(owner, []).append(field["name"])

        # ── The boxes with no line number: EIN, name, trade name, address ────
        #
        # Added after measuring that 18 rects on page 1 and 32 on page 2 were
        # being dropped by the `continue` above - among them every box that says
        # WHO the return is for. Each binding is verified against the caption
        # the IRS prints beside it; see NINE41_ENTITY.
        phrases = printed_phrases(pdf, page_geo["page"])

        # Line 16's monthly/semiweekly ticks, added to the box the margin scan
        # already found. See D-06 and NINE41_LINE16_TICKS.
        for name in line16_tick_placements(key, page_geo, phrases):
            if name not in placed.get("16", []):
                placed.setdefault("16", []).append(name)

        for box_id, names in entity_placements(key, page_geo, phrases).items():
            if box_id in placed:
                sys.exit(
                    f"derive-form-box-map: {key} box {box_id!r} was claimed by both the "
                    f"margin scan and the entity table. Two sources disagreeing about one "
                    f"box is exactly the ambiguity this script refuses to resolve silently."
                )
            placed[box_id] = names

        # ── Rule 123: account for EVERY rectangle, or say why not ────────────
        #
        # The W-2 path has had this check since the two-up defect. The 941 path
        # did not, which is the only reason 50 unplaced rectangles could sit
        # there unnoticed across two pages while the page looked finished.
        #
        # What is DELIBERATELY not placed is listed with a reason, in
        # NINE41_UNCLAIMED, and the reason has to survive being read aloud.
        # Anything else stops the build.
        claimed = {n for names in placed.values() for n in names}
        unclaimed: dict[str, str] = {}
        for field in page_geo["fields"]:
            if field["name"] in claimed:
                continue
            reason = nine41_unclaimed_reason(key, field["name"])
            if reason is None:
                sys.exit(
                    f"derive-form-box-map: {key} rectangle {field['name']!r} at "
                    f"x={field['x']} y={field['y']} is neither placed nor listed as "
                    f"deliberately unclaimed. Rule 123 - every rect on the page must be "
                    f"accounted for, or part of a tax form goes unfilled and looks fine."
                )
            unclaimed[field["name"]] = reason

        # Rule 123: ask this page too, rather than only the one I suspected.
        # Both 941 pages measure as a single copy, and that is recorded as a
        # measurement rather than left as an assumption - so the day the IRS
        # prints something two-up, this notices instead of filling half of it.
        copies_941, pitch_941, _succ = copy_partition(page_geo)
        if copies_941 != 1:
            sys.exit(
                f"derive-form-box-map: {key} measured as {copies_941} copies of the same "
                f"form on one page. The 941 has always been one form per page; if that has "
                f"changed, the placement below fills only the first of them."
            )

        result[key] = {
            "labels": sorted(labels),
            "midline": sorted(midline),
            "placed": placed,
            "copies": [placed],
            "copyPitchPt": round(pitch_941, 3),
            # Sorted, so the emitted file diffs cleanly and a new blank
            # rectangle shows up as an addition rather than a reshuffle.
            "unclaimed": sorted(unclaimed),
            "unclaimedReasons": dict(sorted(unclaimed.items())),
        }
        print(
            f"  {key}: {len(labels)} margin labels + {len(midline)} mid-line, "
            f"{len(placed)} boxes received rects, {copies_941} copy on the page, "
            f"{len(claimed)} of {len(page_geo['fields'])} rects filled, "
            f"{len(unclaimed)} blank with a recorded reason"
        )

    # ── SCHEDULE B (FORM 941) ────────────────────────────────────────────────
    for key in ("941sb",):
        page_geo = geometry[key]
        derived = derive_schedule_b(key, page_geo, REPO / page_geo["pdf"])
        result[key] = derived
        print(
            f"  {key}: {len(derived['placed'])} boxes ("
            f"{sum(1 for b in derived['placed'] if b.startswith('m') and 'd' in b)} day cells), "
            f"{len(derived['unclaimed'])} blank with a recorded reason, "
            f"cents /MaxLen {derived['centsMaxLen']}"
        )

    # ── FORM 940 ─────────────────────────────────────────────────────────────
    for key in ("940-p1", "940-p2"):
        page_geo = geometry[key]
        derived = derive_940(key, page_geo, REPO / page_geo["pdf"])
        result[key] = derived
        print(
            f"  {key}: {len(derived['labels'])} margin labels + "
            f"{len(derived['midline'])} mid-line, {len(derived['placed'])} boxes received "
            f"rects, {sum(len(v) for v in derived['placed'].values())} of "
            f"{len(page_geo['fields'])} rects filled, {len(derived['unclaimed'])} blank with "
            f"a recorded reason, cents /MaxLen {derived['centsMaxLen']}"
        )

    # ── FORM W-3 ─────────────────────────────────────────────────────────────
    for key in ("w3",):
        page_geo = geometry[key]
        derived = derive_w3(key, page_geo, REPO / page_geo["pdf"])
        result[key] = derived
        print(
            f"  {key}: {len(derived['labels'])} labels, {len(derived['placed'])} boxes "
            f"received rects, {sum(len(v) for v in derived['placed'].values())} of "
            f"{len(page_geo['fields'])} rects filled, {len(derived['unclaimed'])} blank with "
            f"a recorded reason, money does not split"
        )

    # ── FORM W-2 ─────────────────────────────────────────────────────────────
    for key in ("w2-copyb",):
        page_geo = geometry[key]
        pdf = REPO / page_geo["pdf"]
        derived = derive_w2(key, page_geo, pdf)
        result[key] = derived
        print(
            f"  {key}: {len(derived['labels'])} labels, "
            f"{len(derived['placed'])} boxes received rects, "
            f"{len(derived['unclaimed'])} unclaimed, "
            f"{len(derived['copies'])} copies on the page "
            f"at {derived['copyPitchPt']}pt pitch"
        )
        for box, names in sorted(derived["placed"].items(), key=lambda kv: kv[0]):
            print(f"      {box:4s} {len(names)} rect(s)")
        for n in derived["unclaimed"]:
            print(f"      UNCLAIMED {n}")

    OUT.write_text(json.dumps(result, indent=1, sort_keys=True) + "\n")
    print(f"\nwrote {OUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
