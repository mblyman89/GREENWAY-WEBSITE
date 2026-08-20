#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import subprocess
import sys
from markdown_it import MarkdownIt

md = MarkdownIt("commonmark", {"html": True}).enable("table")
if len(sys.argv) < 2:
    sys.exit("usage: build-owner-report-pdf.py <report.md>\nRefusing to guess which report you meant.")
SRC = sys.argv[1]
body = md.render(open(SRC, encoding="utf-8").read())

html = """<!doctype html>
<html><head><meta charset="utf-8"><style>
@page { size: Letter; margin: 22mm 20mm; }
body { font-family: Georgia, "Times New Roman", serif; font-size: 11.5pt;
       line-height: 1.55; color: #1a1a1a; }
h1 { font-size: 21pt; border-bottom: 3px solid #2d6a4f; padding-bottom: 8px;
     color: #1b4332; margin-bottom: 4px; }
h2 { font-size: 15pt; color: #2d6a4f; margin-top: 26px;
     border-bottom: 1px solid #d8e3dc; padding-bottom: 4px; }
h3 { font-size: 12.5pt; color: #40916c; margin-top: 18px; }
table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 10.5pt; }
th { background: #2d6a4f; color: #fff; text-align: left; padding: 7px 9px; }
td { border-bottom: 1px solid #dde5e0; padding: 6px 9px; vertical-align: top; }
tr:nth-child(even) td { background: #f6faf8; }
strong { color: #14332a; }
hr { border: none; border-top: 1px solid #cfdad4; margin: 22px 0; }
code { background: #eef4f1; padding: 1px 4px; font-size: 10pt; }
blockquote { border-left: 3px solid #95d5b2; margin-left: 0; padding-left: 14px;
             color: #33513f; font-style: italic; }
ul, ol { margin: 8px 0 8px 4px; }
li { margin: 4px 0; }
</style></head><body>
""" + body + "</body></html>"

open("/tmp/m21.html", "w", encoding="utf-8").write(html)
subprocess.run(["wkhtmltopdf", "--quiet", "--enable-local-file-access",
                "--footer-center", "[page]", "--footer-font-size", "8",
                "/tmp/m21.html", SRC.replace(".md", ".pdf")], check=True)
print("PDF written")
