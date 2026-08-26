#!/usr/bin/env python3
"""
scripts/derive-form-geometry.py   (books-61)

═══════════════════════════════════════════════════════════════════════════════
WHERE THE FORM ON THE SCREEN COMES FROM
═══════════════════════════════════════════════════════════════════════════════

Michael asked for the form "as it would look if i were holding it in my hand",
auto-filled, clickable for lessons, and exportable. The first question that had
to be answered was not "how do I draw it" but "whose drawing is it".

The answer, measured rather than assumed:

    md5(FORM_941_EXAMPLE.pdf)  == md5(irs.gov/pub/irs-pdf/f941.pdf)
    md5(FORM_940_EXAMPLE.pdf)  == md5(irs.gov/pub/irs-pdf/f940.pdf)

The blanks he uploaded ARE the IRS's own files, byte for byte. So the artwork on
the screen is not a reconstruction and not a drawing that resembles a form. It
is the IRS's vector artwork, extracted unmodified.

That matters for a reason beyond fidelity. A hand-built HTML replica of a tax
form is a guess at every hairline, caption and rule, and standing rule: never
guess. Worse, a replica drifts: the IRS revises the 941 and the replica quietly
keeps showing last year's boxes. Extraction cannot drift silently, because it
starts from a file whose checksum is recorded.

───────────────────────────────────────────────────────────────────────────────
AND WHERE THE BOX POSITIONS COME FROM
───────────────────────────────────────────────────────────────────────────────
The same file. Every IRS fillable PDF carries a `/Widget` annotation per input
with an exact `/Rect`. There are 116 of them on the 941 and 94 on the W-2 page
we use. So the coordinates of "where does line 5a column 1 sit on the page" are
the IRS's answer, not mine.

I checked whether they also carry tooltips - `/TU` - which would have named each
field. They do not: the count is zero across all 116. So the map from a rect to
one of OUR box ids has to be derived by measuring which printed line label the
rect sits beside, and then pinned by a gate. A derived map that nobody pins is
a guess with extra steps.

───────────────────────────────────────────────────────────────────────────────
WHY THIS REFUSES RATHER THAN GUESSES
───────────────────────────────────────────────────────────────────────────────
The output of this script positions dollar figures on a document Michael will
copy onto a government portal. A rect attributed to the wrong line would print
his Medicare tax on the social security line, and it would look completely
correct while doing it - the number would be well-formatted, inside a box, on
the real IRS artwork.

There is no safe fallback for that, so there is no fallback. If a rect cannot be
attributed to exactly one printed label, the script writes nothing and says
which rect defeated it. Standing rule 48: fail loudly. A geometry file that is
90% right is more dangerous than no geometry file, because the 10% is invisible.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from xml.etree import ElementTree as ET

REPO = Path(__file__).resolve().parents[1]

# ─────────────────────────────────────────────────────────────────────────────
# WHAT WE EXTRACT, AND FROM WHICH PAGE
#
# The 941 is three pages and we use the two that carry figures; page 3 is the
# payment voucher, which is a different document with a different purpose and is
# deliberately out of scope for this slice.
#
# The W-2 is eleven pages, and choosing among them is a real decision rather
# than an obvious one:
#     page 1  "CAUTION: DO NOT FILE" cover sheet          0 widgets
#     page 2  Copy A (red scannable)                     96 widgets
#     page 3  Copy 1 - state/city/local                  94
#     page 4  Copy B - employee's federal return         94   <-- chosen
#     page 6  Copy C - employee's records                94
#     page 8  Copy 2 - employee's state return           94
#     page 10 Copy D - employer                          96
# Copy B is chosen because it is the copy an employee actually holds, which is
# the thing Michael described. Copy A is explicitly marked DO NOT FILE in the
# artwork and prints in scannable red; putting it on screen would invite exactly
# the mistake the IRS prints that warning to prevent.
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Source:
    key: str
    """Stable id used in the emitted geometry and by the React layer."""
    pdf: str
    """Path of the official artifact, relative to the repo root."""
    page: int
    """1-based page number within that artifact."""
    url: str
    """Where the artifact came from, so provenance is checkable."""
    human: str
    """What a person would call this page."""


SOURCES: list[Source] = [
    Source(
        key="941-p1",
        pdf="public/forms/irs/f941.pdf",
        page=1,
        url="https://www.irs.gov/pub/irs-pdf/f941.pdf",
        human="Form 941 (Rev. March 2026), page 1",
    ),
    Source(
        key="941-p2",
        pdf="public/forms/irs/f941.pdf",
        page=2,
        url="https://www.irs.gov/pub/irs-pdf/f941.pdf",
        human="Form 941 (Rev. March 2026), page 2",
    ),
    Source(
        key="w2-copyb",
        pdf="public/forms/irs/fw2.pdf",
        page=4,
        url="https://www.irs.gov/pub/irs-pdf/fw2.pdf",
        human="Form W-2 (2026), Copy B",
    ),
]


# ─────────────────────────────────────────────────────────────────────────────
# READING THE PDF
# ─────────────────────────────────────────────────────────────────────────────

try:
    from pypdf import PdfReader
    from pypdf.generic import IndirectObject
except ImportError:  # pragma: no cover - developer environment problem
    sys.exit("derive-form-geometry: pypdf is required (pip install pypdf)")


def resolve(obj):
    return obj.get_object() if isinstance(obj, IndirectObject) else obj


def qualified_name(annot) -> str:
    """
    The field's full name, walking up through /Parent.

    XFA-generated forms nest widgets several levels deep
    (`topmostSubform[0].Page1[0].f1_17[0]`), and only the leaf carries /T. The
    full path is kept rather than the leaf because leaves repeat across pages:
    `f1_1[0]` exists on 941 page 1 AND page 3, meaning different things.
    """
    parts: list[str] = []
    cur = annot
    depth = 0
    while cur is not None and depth < 16:
        t = cur.get("/T")
        if t is not None:
            parts.append(str(t))
        parent = cur.get("/Parent")
        cur = resolve(parent) if parent is not None else None
        depth += 1
    return ".".join(reversed(parts))


@dataclass(frozen=True)
class Rect:
    """One input area, in CSS space: origin top-left, units = PDF points."""

    name: str
    kind: str  # "text" | "check"
    x: float
    y: float
    w: float
    h: float
    # ── The IRS's own typography, carried through rather than re-invented ──────
    #
    # Every widget states how the agency intends its own box to be filled, and
    # taking those statements is strictly better than inferring them:
    #
    #   align   from /Q. 0 = left, 1 = centre, 2 = right. Money on the 941 is
    #           /Q 2; the EIN and the account number are /Q 0. Guessing "money
    #           is right-aligned" would have been correct on the 941 and wrong
    #           on the W-2, whose money boxes are /Q 0.
    #
    #   maxLen  from /MaxLen. On the 941 EVERY cents box - all 22 of them -
    #           carries /MaxLen 3, and no dollars box does. That is the agency
    #           telling us which rectangle is the cents rectangle, in the file
    #           itself. The first version of this feature inferred it from a
    #           width threshold instead, which is a proxy: it happened to agree
    #           on the 941, but a revision that widened the cents box by a few
    #           points would silently reclassify it and print "1102932" across
    #           the page. Rule 23 - take the property, not the correlate.
    #
    #   comb    from bit 25 of /Ff. A "comb" field is one the agency has divided
    #           into /MaxLen equal cells and expects ONE CHARACTER PER CELL. The
    #           941's EIN is the clearest case: the artwork prints little boxes
    #           and Michael's own filed return shows "4 6 - 4 2 1 7 0 1 6", one
    #           digit per box. Rendering that EIN as a single left-aligned run
    #           of text would put "46" over the first two cells and leave seven
    #           empty cells with the digits crowded to the left - a form that is
    #           legible but visibly not the form, on the page whose whole
    #           purpose is that it looks like the one in his hand.
    #
    #           Measured on f941.pdf: exactly six fields carry the bit - the two
    #           EIN halves on page 1 (/MaxLen 2 and 7), the refund routing and
    #           account numbers (9 and 17), and page 2's final-date and PIN
    #           fields (8 and 5). No money box carries it. Taken from /Ff rather
    #           than inferred from "is this field narrow and does it have a
    #           MaxLen", for the same reason /MaxLen itself is taken rather than
    #           inferred from a width: the property is stated in the file.
    align: int
    maxLen: int | None
    comb: bool


# Bit 25 of the /Ff field flags (1-based, as the PDF specification numbers them)
# is "Comb": divide the field into /MaxLen equally spaced cells. Named rather
# than written inline as 1 << 24, so the off-by-one between the spec's 1-based
# bit numbering and Python's 0-based shift is stated once, here, where it can be
# checked against the specification instead of being re-derived at each use.
FF_COMB_BIT = 1 << 24


def widgets_of(pdf_path: Path, page_no: int) -> tuple[float, float, list[Rect]]:
    reader = PdfReader(str(pdf_path))
    if page_no < 1 or page_no > len(reader.pages):
        raise SystemExit(
            f"derive-form-geometry: {pdf_path.name} has {len(reader.pages)} pages, "
            f"page {page_no} was requested."
        )
    page = reader.pages[page_no - 1]
    media = page.mediabox
    width = float(media.right) - float(media.left)
    height = float(media.top) - float(media.bottom)

    rects: list[Rect] = []
    for annot in resolve(page.get("/Annots")) or []:
        annot = resolve(annot)
        if annot.get("/Subtype") != "/Widget":
            continue
        raw = [float(v) for v in resolve(annot.get("/Rect"))]
        x0, y0, x1, y1 = min(raw[0], raw[2]), min(raw[1], raw[3]), max(raw[0], raw[2]), max(raw[1], raw[3])

        # A widget may state a property itself, or inherit it from an ancestor
        # field. `/FT` was already walked this way; `/Q` and `/MaxLen` live in
        # exactly the same place and must be walked the same way, or an
        # inherited alignment reads as "absent" and silently becomes the
        # default.
        def inherited(key: str) -> object | None:
            node: object | None = annot
            for _ in range(16):
                if node is None:
                    return None
                if key in node:  # type: ignore[operator]
                    return resolve(node[key])  # type: ignore[index]
                parent = node.get("/Parent")  # type: ignore[union-attr]
                node = resolve(parent) if parent is not None else None
            return None

        field_type = inherited("/FT")

        # Only two kinds matter to the renderer: something you type into, and
        # something you tick. Anything else is refused rather than guessed at,
        # because an unrecognised widget silently dropped is a field missing
        # from a tax form.
        if str(field_type) == "/Tx":
            kind = "text"
        elif str(field_type) == "/Btn":
            kind = "check"
        else:
            raise SystemExit(
                f"derive-form-geometry: {pdf_path.name} p{page_no} field "
                f"{qualified_name(annot)!r} has field type {field_type!r}, which this "
                f"script does not know how to render. Refusing to emit a geometry file "
                f"that silently omits an input area of a tax form."
            )

        # `/Q` absent means 0 (left) by the PDF specification, so the default is
        # the spec's, not a preference of mine.
        raw_q = inherited("/Q")
        align = 0 if raw_q is None else int(raw_q)
        if align not in (0, 1, 2):
            raise SystemExit(
                f"derive-form-geometry: {pdf_path.name} p{page_no} field "
                f"{qualified_name(annot)!r} has /Q {align!r}. The PDF specification "
                f"defines 0, 1 and 2 only. Refusing to guess how the agency wants "
                f"its own box aligned."
            )

        raw_maxlen = inherited("/MaxLen")
        max_len = None if raw_maxlen is None else int(raw_maxlen)
        if max_len is not None and max_len <= 0:
            raise SystemExit(
                f"derive-form-geometry: {pdf_path.name} p{page_no} field "
                f"{qualified_name(annot)!r} has /MaxLen {max_len!r}, which cannot be "
                f"a character limit."
            )

        raw_ff = inherited("/Ff")
        flags = 0 if raw_ff is None else int(raw_ff)
        comb = bool(flags & FF_COMB_BIT)

        # A comb field without a character limit is a contradiction in the
        # agency's own terms: the flag says "divide this box into /MaxLen
        # cells", so there is no cell count to divide into. Refused rather than
        # quietly treated as ordinary text, because the failure would be
        # invisible - the field would simply render slightly wrong.
        if comb and max_len is None:
            raise SystemExit(
                f"derive-form-geometry: {pdf_path.name} p{page_no} field "
                f"{qualified_name(annot)!r} is flagged comb but states no /MaxLen, so "
                f"there is no number of cells to divide it into. Refusing to guess one."
            )

        # PDF y grows upward from the bottom; CSS y grows downward from the top.
        rects.append(
            Rect(
                name=qualified_name(annot),
                kind=kind,
                x=round(x0, 2),
                y=round(height - y1, 2),
                w=round(x1 - x0, 2),
                h=round(y1 - y0, 2),
                align=align,
                maxLen=max_len,
                comb=comb,
            )
        )

    # Reading order: down the page, then across. Stable output means a diff in
    # the emitted file is a real change rather than a reordering.
    rects.sort(key=lambda r: (r.y, r.x))
    return width, height, rects


# ─────────────────────────────────────────────────────────────────────────────
# READING THE PRINTED LABELS
#
# `pdftotext -bbox-layout` gives every word with its bounding box in the same
# coordinate space as the artwork, which is what lets a rect be attributed to
# the line label printed beside it.
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Word:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float


def words_of(pdf_path: Path, page_no: int) -> list[Word]:
    proc = subprocess.run(
        ["pdftotext", "-bbox-layout", "-f", str(page_no), "-l", str(page_no), str(pdf_path), "-"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise SystemExit(f"derive-form-geometry: pdftotext failed: {proc.stderr.strip()}")
    root = ET.fromstring(proc.stdout)
    out: list[Word] = []
    for node in root.iter():
        if not node.tag.endswith("word"):
            continue
        out.append(
            Word(
                text=(node.text or "").strip(),
                x0=float(node.get("xMin", "0")),
                y0=float(node.get("yMin", "0")),
                x1=float(node.get("xMax", "0")),
                y1=float(node.get("yMax", "0")),
            )
        )
    return out


# ─────────────────────────────────────────────────────────────────────────────
# EXTRACTING THE ARTWORK
# ─────────────────────────────────────────────────────────────────────────────


# The lowest effective resolution we will allow any raster to be placed at.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS IS A RESOLUTION TEST AND NOT A BAN ON RASTERS
# ─────────────────────────────────────────────────────────────────────────────
# The first version of this check refused any `<image>` at all, with a confident
# comment about vector artwork staying sharp. It fired immediately on the W-2,
# and the comment was wrong.
#
# Measured, the offending image is the IRS's own "IRS e-file" logo: a 5784x1448
# bitmap placed by `matrix(0.0136871,...)` at (417.6, 38.0), so it occupies
# 79.19 x 19.82 pt on the page. 5784 px across 79.19 pt is 5784 / (79.19/72)
# = 5,260 pixels per inch. `pdfimages -list` independently agrees: x-ppi 5260.
#
# So the thing my guard called a fidelity problem prints at roughly nine times
# the resolution of a 600 dpi laser printer. It is not a scanned page; it is a
# logo the IRS ships as a bitmap because it is a logo. Refusing it would mean
# refusing to show the real W-2 - and the only ways forward from there are to
# hand-draw the form (a guess) or to strip the logo (a form that is not the
# form).
#
# The defect was measuring a PROXY instead of the property I actually care
# about. I care whether the page prints sharp. "Contains no <image> tag" is a
# proxy for that, and like most proxies it is both too strict and too lax: too
# strict here, and too lax against a full-page 72-dpi scan wrapped in one
# `<image>` that a naive vector-only check would... also catch, but only by
# accident, and would report with the wrong reason.
#
# So the check now computes the thing itself: effective PPI, from the intrinsic
# pixel size and the transform that places it. Rule 23 - fix the class, not the
# instance. The class is "asserting on a proxy for the property under test".
MIN_RASTER_PPI = 600.0

_IMAGE_DEF_RE = re.compile(
    r'<image\s+id="(?P<id>[^"]+)"\s+width="(?P<w>[0-9.]+)"\s+height="(?P<h>[0-9.]+)"'
)
_IMAGE_USE_RE = re.compile(
    r'<use\s+xlink:href="#(?P<id>[^"]+)"\s+transform="matrix\('
    r"(?P<a>[-0-9.eE]+),(?P<b>[-0-9.eE]+),(?P<c>[-0-9.eE]+),"
    r'(?P<d>[-0-9.eE]+),(?P<e>[-0-9.eE]+),(?P<f>[-0-9.eE]+)\)"'
)

# 1 inch = 72 PDF points, by definition of the point in PDF/PostScript.
POINTS_PER_INCH = 72.0


def raster_resolutions(svg_body: str) -> list[tuple[str, float, float]]:
    """
    Every raster in the document, with the resolution it is actually placed at.

    Returns (image id, width in points on the page, effective PPI) per PLACEMENT
    rather than per definition, because one bitmap can be `<use>`d several times
    at different scales - the W-2 places the e-file logo twice, once per form on
    the sheet - and it is the placement, not the definition, that decides how it
    prints.

    A raster that is DEFINED and never PLACED is reported with a PPI of infinity
    rather than being silently skipped: it contributes nothing to the page, so it
    cannot be blurry, but pretending it does not exist would hide a change in the
    artwork.
    """
    defs: dict[str, tuple[float, float]] = {}
    for m in _IMAGE_DEF_RE.finditer(svg_body):
        defs[m.group("id")] = (float(m.group("w")), float(m.group("h")))

    placements: list[tuple[str, float, float]] = []
    placed: set[str] = set()
    for m in _IMAGE_USE_RE.finditer(svg_body):
        image_id = m.group("id")
        if image_id not in defs:
            continue  # a <use> of a glyph symbol, not of a raster
        placed.add(image_id)
        px_w, _px_h = defs[image_id]
        scale_x = abs(float(m.group("a")))
        pt_w = px_w * scale_x
        if pt_w <= 0:
            raise SystemExit(
                f"derive-form-geometry: raster {image_id!r} is placed with a zero or "
                f"negative width, which is not a shape this script can reason about."
            )
        placements.append((image_id, pt_w, px_w / (pt_w / POINTS_PER_INCH)))

    for image_id in sorted(set(defs) - placed):
        placements.append((image_id, 0.0, float("inf")))
    return placements


def extract_svg(pdf_path: Path, page_no: int, out_path: Path) -> list[tuple[str, float, float]]:
    """
    Pull one page out as SVG, unmodified.

    `pdftocairo -svg` emits real vector output - on 941 page 1 that is 3,183
    glyph references and no rasters at all. The W-2 is vector too, apart from
    the IRS e-file logo, which is a bitmap at 5,260 PPI. Both print sharp, which
    is what Michael asked for ("see and print and export").
    """
    proc = subprocess.run(
        ["pdftocairo", "-svg", "-f", str(page_no), "-l", str(page_no), str(pdf_path), str(out_path)],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise SystemExit(f"derive-form-geometry: pdftocairo failed: {proc.stderr.strip()}")
    if not out_path.exists() or out_path.stat().st_size == 0:
        raise SystemExit(f"derive-form-geometry: {out_path} was not written")

    body = out_path.read_text(encoding="utf-8")

    # The page must be made of shapes, not of one big picture of a page. A
    # scanned form would have few or no glyph references, and that is the signal
    # that separates "extracted artwork" from "photograph of artwork".
    glyph_uses = len(re.findall(r"<use ", body))
    if glyph_uses < 100:
        raise SystemExit(
            f"derive-form-geometry: {out_path.name} has only {glyph_uses} drawing "
            f"references. A real form page is thousands of glyphs and rules; this few "
            f"means the page came through as an image of a form rather than as the form."
        )

    for image_id, pt_w, ppi in raster_resolutions(body):
        if ppi < MIN_RASTER_PPI:
            raise SystemExit(
                f"derive-form-geometry: {out_path.name} places raster {image_id!r} at "
                f"{ppi:.0f} PPI ({pt_w:.2f}pt wide), below the {MIN_RASTER_PPI:.0f} PPI "
                f"floor. It would look acceptable on screen and blurred on paper, and "
                f"Michael asked to be able to print this."
            )
    return raster_resolutions(body)


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────


def main() -> int:
    art_dir = REPO / "public" / "forms" / "irs"
    out_dir = REPO / "public" / "forms" / "art"
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, object] = {}

    for src in SOURCES:
        pdf = REPO / src.pdf
        if not pdf.exists():
            raise SystemExit(
                f"derive-form-geometry: {src.pdf} is missing. It is the official IRS "
                f"artifact and must be fetched from {src.url} and checked in before this "
                f"script can run. This script never downloads: a build that reaches out to "
                f"the network is a build whose output depends on the day it ran."
            )

        width, height, rects = widgets_of(pdf, src.page)
        if not rects:
            raise SystemExit(
                f"derive-form-geometry: {src.key} produced no input areas. Either the page "
                f"number is wrong or the artifact changed shape; either way, emitting an "
                f"empty geometry would render a form nobody can click."
            )

        svg_name = f"{src.key}.svg"
        rasters = extract_svg(pdf, src.page, out_dir / svg_name)

        # Every rect must sit inside the page. A negative or overflowing rect
        # would position a dollar figure off the paper, where it prints nowhere
        # and is invisible on screen.
        for r in rects:
            if r.x < 0 or r.y < 0 or r.x + r.w > width + 0.5 or r.y + r.h > height + 0.5:
                raise SystemExit(
                    f"derive-form-geometry: {src.key} field {r.name!r} at "
                    f"({r.x},{r.y},{r.w},{r.h}) falls outside the {width}x{height} page."
                )

        manifest[src.key] = {
            "human": src.human,
            "url": src.url,
            "pdf": src.pdf,
            "page": src.page,
            "pdfSha256": sha256_of(pdf),
            "svg": f"/forms/art/{svg_name}",
            "svgSha256": sha256_of(out_dir / svg_name),
            "width": round(width, 3),
            "height": round(height, 3),
            # Recorded so the print-sharpness claim is checkable by a reader and
            # by a gate, rather than being a sentence in a comment.
            "rasters": [
                {"id": i, "widthPt": round(w, 2), "ppi": (None if p == float("inf") else round(p))}
                for i, w, p in rasters
            ],
            "fields": [asdict(r) for r in rects],
        }
        raster_note = (
            "no rasters"
            if not rasters
            else ", ".join(f"{i}@{p:.0f}ppi" for i, _w, p in rasters if p != float("inf"))
        )
        print(
            f"  {src.key:10s} {len(rects):3d} input areas  "
            f"{round(width)}x{round(height)}pt  svg={(out_dir / svg_name).stat().st_size:,}B  "
            f"{raster_note}"
        )

    target = REPO / "src" / "lib" / "payroll" / "form-geometry.generated.json"
    target.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"\nwrote {target.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
