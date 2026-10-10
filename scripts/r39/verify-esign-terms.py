#!/usr/bin/env python3
"""
scripts/r39/verify-esign-terms.py  (R39 S6)

Proves that every paragraph of ACH_E_TERMS (src/lib/payments/ach-esign-terms.ts)
appears VERBATIM in the paper form source GW-ACH-E (employee-fillable.html),
so the e-signed record says exactly what the paper form says (E-SIGN
7001(d)(1)(A): the record must "accurately reflect" the agreement).

The form source lives outside the repo (/workspace/ach/employee-fillable.html),
so CI cannot run this; it is run by hand whenever the form or the terms file
changes, and its output is kept in verify-esign-terms.last.log (the vitest
file r39-ach-esign.test.ts reads that log and checks it covered every
paragraph of the CURRENT terms hash).

Comparison: HTML -> text (BeautifulSoup, scripts/styles dropped), then both
sides whitespace-collapsed (runs of spaces / NBSP / newlines -> one space).
Nothing else is normalised: punctuation, quotes and case must match.

Usage: python3 scripts/r39/verify-esign-terms.py [path/to/employee-fillable.html]
"""
import hashlib
import json
import re
import subprocess
import sys

from bs4 import BeautifulSoup

SRC = sys.argv[1] if len(sys.argv) > 1 else "/workspace/ach/employee-fillable.html"


def squash(s: str) -> str:
    return re.sub(r"[\s\u00a0]+", " ", s).strip()


html = open(SRC, encoding="utf-8").read()
soup = BeautifulSoup(html, "html.parser")
for t in soup(["script", "style", "noscript"]):
    t.decompose()
# Text nodes joined with NO separator, so the HTML's own spacing is kept
# exactly (a separator would put spaces inside "<b>Authorization</b>" quotes).
# Then whitespace runs (incl. NBSP and newlines) collapse to one space.
form = squash(soup.get_text(""))

# Load ACH_E_TERMS by running the TS module through tsx (single source of truth).
js = subprocess.run(
    ["npx", "tsx", "-e",
     "import('./src/lib/payments/ach-esign-terms.ts').then(r=>{const m=r.ACH_E_TERMS?r:r.default;process.stdout.write(JSON.stringify({t:m.ACH_E_TERMS,h:m.ACH_E_TERMS_SHA256}))})"],
    capture_output=True, text=True, check=True, timeout=120,
)
data = json.loads(js.stdout[js.stdout.index("{"):])
terms, pinned = data["t"], data["h"]

paras = []
for w in terms["wac"]:
    paras.append(("wac", w))
for p in terms["terms"]:
    paras.append((p["k"], p["t"]))
paras.append(("ack", terms["acknowledgment"]))

missing = []
for kind, text in paras:
    s = squash(text)
    # Headings on the form carry their number in a separate span: "1." + "Title".
    if s not in form:
        missing.append((kind, s[:90]))

print(f"source: {SRC}")
print(f"source sha256: {hashlib.sha256(html.encode('utf-8')).hexdigest()}")
print(f"terms sha256 (pinned): {pinned}")
# formRev "Rev. 10/2026 v1.0" is our short label for the form's own line
# "FORM GW-ACH-E \u00b7 REV. 10/2026 \u00b7 VERSION 1.0"; check the parts.
m = re.fullmatch(r"Rev\. (\d{2}/\d{4}) v(\d+\.\d+)", terms["formRev"])
rev_ok = bool(m) and re.search(
    r"FORM " + re.escape(terms["formId"]) + r" \u00b7 REV\. " + re.escape(m.group(1)) + r" \u00b7 VERSION " + re.escape(m.group(2)), form) is not None
print(f"form id/rev line in source: {rev_ok}")
print(f"paragraphs: {len(paras)} checked, {len(paras) - len(missing)} found verbatim, {len(missing)} missing")
for kind, s in missing:
    print(f"  MISSING [{kind}] {s}")
ok = not missing and rev_ok
print("TERMS VERBATIM: PASS" if ok else "TERMS VERBATIM: FAIL")
sys.exit(0 if ok else 1)
