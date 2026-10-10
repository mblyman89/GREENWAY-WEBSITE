#!/usr/bin/env python3
"""
scripts/r39/verify-vendor-esign-terms.py  (R39 S7)

Independent check of the GENERATED src/lib/payments/vendor-esign-terms.ts:
every paragraph of ACH_V_TERMS must appear VERBATIM in the whole-page text of
the paper vendor form GW-ACH-V (vendor-fillable.html), and the form id/rev
line must match. It does not reuse the generator's element selection: it
flattens the WHOLE page (text nodes joined with no separator, whitespace runs
collapsed) and searches it, so a generator bug that invented, reordered
inside, or trimmed a paragraph is caught.

Output is kept in verify-vendor-esign-terms.last.log; the vitest file
r39-vendor-esign-core.test.ts checks the log covers the CURRENT terms hash.

Usage: python3 scripts/r39/verify-vendor-esign-terms.py [path/to/vendor-fillable.html]
"""
import hashlib
import json
import re
import subprocess
import sys

from bs4 import BeautifulSoup

SRC = sys.argv[1] if len(sys.argv) > 1 else "/workspace/ach/vendor-fillable.html"


def squash(s: str) -> str:
    return re.sub(r"[\s\u00a0]+", " ", s).strip()


html = open(SRC, encoding="utf-8").read()
soup = BeautifulSoup(html, "html.parser")
for t in soup(["script", "style", "noscript"]):
    t.decompose()
form = squash(soup.get_text(""))

js = subprocess.run(
    ["npx", "tsx", "-e",
     "import('./src/lib/payments/vendor-esign-terms.ts').then(r=>{const m=r.ACH_V_TERMS?r:r.default;process.stdout.write(JSON.stringify({t:m.ACH_V_TERMS,h:m.ACH_V_TERMS_SHA256}))})"],
    capture_output=True, text=True, check=True, timeout=120,
)
data = json.loads(js.stdout[js.stdout.index("{"):])
terms, pinned = data["t"], data["h"]

paras = [("intro", terms["intro"])]
paras += [("part3", p) for p in terms["part3"]]
paras += [("wac", p) for p in terms["wac"]]
paras.append(("wacMeans", terms["wacMeans"]))
paras += [(p["k"], p["t"]) for p in terms["terms"]]
paras.append(("certification", terms["certification"]))
paras.append(("acceptance", terms["acceptance"]))

missing = [(k, squash(t)[:90]) for k, t in paras if squash(t) not in form or len(squash(t)) < 3]

# Order: each paragraph must start after the previous one in the page.
pos, out_of_order = -1, []
for k, t in paras:
    s = squash(t)
    if s not in form:
        continue  # already reported as missing
    i = form.find(s, pos + 1)
    if i < 0:  # present, but only BEFORE the previous paragraph
        out_of_order.append((k, s[:60]))
        continue
    pos = i

print(f"source: {SRC}")
print(f"source sha256: {hashlib.sha256(html.encode('utf-8')).hexdigest()}")
print(f"terms sha256 (pinned): {pinned}")
m = re.fullmatch(r"Rev\. (\d{2}/\d{4}) v(\d+\.\d+)", terms["formRev"])
rev_ok = bool(m) and re.search(
    r"FORM " + re.escape(terms["formId"]) + r" \u00b7 REV\. " + re.escape(m.group(1)) + r" \u00b7 VERSION " + re.escape(m.group(2)), form) is not None
print(f"form id/rev line in source: {rev_ok}")
headings = [t for k, t in paras if k == "h"]
want = [f"{n}." for n in range(1, 23)]
heads_ok = [h.split(" ", 1)[0] for h in headings] == want
print(f"term headings 1..22 in order: {heads_ok}")
print(f"paragraphs: {len(paras)} checked, {len(paras) - len(missing)} found verbatim, {len(missing)} missing, {len(out_of_order)} out of order")
for k, s in missing:
    print(f"  MISSING [{k}] {s}")
for k, s in out_of_order:
    print(f"  ORDER [{k}] {s}")
ok = not missing and not out_of_order and rev_ok and heads_ok
print("RESULT: PASS" if ok else "RESULT: FAIL")
sys.exit(0 if ok else 1)
