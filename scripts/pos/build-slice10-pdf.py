#!/usr/bin/env python3
"""
Rebuild the printable SLICE 10 owner document.

Michael reads these on paper and on an iPad at the counter, not in a code
editor, so the output is a PDF with real margins, readable type, and code
blocks that do not run off the edge of the page.

    python3 scripts/pos/build-slice10-pdf.py

Markdown -> HTML (python-markdown) -> PDF (wkhtmltopdf). Both are already
present in this repo's toolchain; nothing new to install on the Mac.
"""

import pathlib
import subprocess
import sys
import tempfile

import markdown

REPO = pathlib.Path(__file__).resolve().parents[2]
SRC = REPO / "docs" / "MICHAEL-slice10-receipt-printer-and-app-store.md"
OUT = REPO / "docs" / "MICHAEL-slice10-receipt-printer-and-app-store.pdf"

CSS = """
@page { size: Letter; margin: 20mm 18mm; }
body {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 11.5pt;
  line-height: 1.55;
  color: #1a1a1a;
}
h1 {
  font-size: 20pt; color: #14532d; border-bottom: 2px solid #14532d;
  padding-bottom: 5px; margin-top: 26px; page-break-after: avoid;
}
h2 {
  font-size: 15pt; color: #166534; margin-top: 22px;
  page-break-after: avoid;
}
h3 { font-size: 12.5pt; color: #166534; page-break-after: avoid; }
code {
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 9.5pt; background: #f4f4f5; padding: 1px 4px;
  border-radius: 3px;
}
pre {
  background: #f7f7f8; border: 1px solid #d9d9de; border-left: 4px solid #166534;
  padding: 9px 11px; border-radius: 4px;
  font-size: 9pt; line-height: 1.4;
  white-space: pre-wrap; word-wrap: break-word;
  page-break-inside: avoid;
}
pre code { background: none; padding: 0; font-size: 9pt; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 10.5pt; }
th, td { border: 1px solid #c9c9cf; padding: 5px 9px; text-align: left; }
th { background: #14532d; color: #fff; }
tr:nth-child(even) { background: #f6f6f7; }
blockquote {
  border-left: 4px solid #9ca3af; margin-left: 0; padding-left: 14px;
  color: #374151; font-style: italic;
}
hr { border: none; border-top: 1px solid #d1d5db; margin: 26px 0; }
strong { color: #14532d; }
a { color: #166534; }
"""


def main() -> int:
    if not SRC.exists():
        print(f"missing {SRC}", file=sys.stderr)
        return 1

    html_body = markdown.markdown(
        SRC.read_text(encoding="utf-8"),
        extensions=["fenced_code", "tables", "sane_lists", "toc"],
    )
    page = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<style>{CSS}</style></head><body>{html_body}</body></html>"
    )

    with tempfile.NamedTemporaryFile(
        "w", suffix=".html", delete=False, encoding="utf-8"
    ) as fh:
        fh.write(page)
        tmp = fh.name

    proc = subprocess.run(
        [
            "wkhtmltopdf",
            "--quiet",
            "--page-size", "Letter",
            "--enable-local-file-access",
            "--footer-center", "[page] of [topage]",
            "--footer-font-size", "8",
            "--footer-spacing", "6",
            tmp,
            str(OUT),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        return proc.returncode

    print(f"wrote {OUT}  ({OUT.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
