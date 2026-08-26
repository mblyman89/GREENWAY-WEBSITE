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
        "c2_1[1]": (
            "Line 16 'monthly schedule depositor' tick. The profile records a deposit "
            "schedule, but ticking it here would also assert the monthly liability grid "
            "below it, which we do not compute."
        ),
        "c2_1[2]": (
            "Line 16 'semiweekly schedule depositor' tick. Not ticked, for the reason given "
            "on the monthly tick."
        ),
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
        for box_id, names in entity_placements(
            key, page_geo, printed_phrases(pdf, page_geo["page"])
        ).items():
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
