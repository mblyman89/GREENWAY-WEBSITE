#!/usr/bin/env python3
"""
scripts/r39/gen-vendor-esign-terms.py  (R39 S7, vendor e-sign)

Generates src/lib/payments/vendor-esign-terms.ts from the paper vendor form
GW-ACH-V (/workspace/ach/vendor-fillable.html, outside the repo), so the
e-signed vendor record says exactly what the paper form says (E-SIGN
7001(d)(1)(A) and RCW 1.80.110(1)(a): the record must "accurately reflect"
the agreement).

What is taken, in form order, each as whitespace-collapsed plain text:
  intro         the form sub-title (voluntary, written EFT agreement)
  part3         Part 3 "Credit-only" and "Authorization" call-outs + 3 steps
  wac           Part 4 verbatim WAC 314-55-115 paragraphs + source line
  wacMeans      Part 4 "What this means for you"
  terms         Part 5: intro line, then every h4 (k=h) and p (k=p)
  certification Part 6 vendor certification
  acceptance    Part 6 note on Greenway's countersignature

The output pins ACH_V_TERMS_SHA256 = sha256(canonical JSON). Re-run only
when the form changes (a change is a new form revision).

Usage: python3 scripts/r39/gen-vendor-esign-terms.py [path/to/vendor-fillable.html]
"""
import hashlib
import json
import re
import sys

from bs4 import BeautifulSoup

SRC = sys.argv[1] if len(sys.argv) > 1 else "/workspace/ach/vendor-fillable.html"
OUT = "src/lib/payments/vendor-esign-terms.ts"


def squash(s: str) -> str:
    return re.sub(r"[\s\u00a0]+", " ", s).strip()


def txt(el) -> str:
    return squash(el.get_text(""))


html = open(SRC, encoding="utf-8").read()
soup = BeautifulSoup(html, "html.parser")
for t in soup(["script", "style", "noscript"]):
    t.decompose()

parts = {}
for sec in soup.select("section.part"):
    n = sec.select_one(".ph .n")
    parts[n.get_text().strip()] = sec

formid = txt(soup.select_one(".formid"))  # FORM GW-ACH-V · REV. 10/2026 · VERSION 1.0
m = re.fullmatch(r"FORM (GW-ACH-V) \u00b7 REV\. (\d{2}/\d{4}) \u00b7 VERSION (\d+\.\d+)", formid)
assert m, formid

intro = txt(soup.select_one(".titleblock .sub"))

p3 = parts["3"]
part3 = [txt(c.select_one("p")) for c in p3.select(".call")]
# Each step is "<b>N</b>text": the bold badge number is layout, not words,
# so it is dropped (the list order keeps the numbering).
def step_text(d):
    b = d.find("b", recursive=False)
    if b is not None:
        b.extract()
    return txt(d)
part3 += [step_text(d) for d in p3.select(".steps > div")]

p4 = parts["4"]
wac = [txt(p) for p in p4.select(".law .lb p")]
wac.append(txt(p4.select_one(".law .ls")))
wac_means = txt(p4.select_one(".call.red p"))

p5 = parts["5"]
terms = [{"k": "p", "t": txt(p5.find("p", recursive=False))}]
for el in p5.select_one(".terms").find_all(["h4", "p"], recursive=False):
    terms.append({"k": "h" if el.name == "h4" else "p", "t": txt(el)})

p6 = parts["6"]
certification = txt(p6.select_one(".call.grn p"))
acceptance = txt(p6.select_one(".legalnote"))

data = {
    "formId": m.group(1),
    "formRev": f"Rev. {m.group(2)} v{m.group(3)}",
    "intro": intro,
    "part3": part3,
    "wac": wac,
    "wacMeans": wac_means,
    "terms": terms,
    "certification": certification,
    "acceptance": acceptance,
}


def canon(v):
    if isinstance(v, list):
        return "[" + ",".join(canon(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canon(v[k]) for k in sorted(v)) + "}"
    return json.dumps(v, ensure_ascii=False)


sha = hashlib.sha256(canon(data).encode("utf-8")).hexdigest()
body = json.dumps(data, indent=2, ensure_ascii=False)
ts = f'''/**
 * src/lib/payments/vendor-esign-terms.ts  (R39 S7, PURE, GENERATED)
 *
 * The exact words of vendor form GW-ACH-V ({data["formRev"]}): the intro, Part 3
 * (credit-only authorization), Part 4 (WAC 314-55-115 verbatim), Part 5 terms
 * and the Part 6 certification, extracted from the form source
 * (/workspace/ach/vendor-fillable.html, outside the repo) by
 * scripts/r39/gen-vendor-esign-terms.py. Do not edit by hand: a change to the
 * terms is a new form revision, and ACH_V_TERMS_SHA256 pins this one
 * (tests/compliance/r39-vendor-esign-core.test.ts recomputes it).
 */
export type VendorTermsPara = {{ k: "h" | "p"; t: string }};
export type VendorFormTerms = {{
  formId: string;
  formRev: string;
  intro: string;
  part3: readonly string[];
  wac: readonly string[];
  wacMeans: string;
  terms: readonly VendorTermsPara[];
  certification: string;
  acceptance: string;
}};

export const ACH_V_TERMS: VendorFormTerms = {body};

/** sha256 of the canonical JSON (keys sorted, no spaces) of ACH_V_TERMS. */
export const ACH_V_TERMS_SHA256 = "{sha}";
'''
open(OUT, "w", encoding="utf-8").write(ts)
print(f"source: {SRC}")
print(f"source sha256: {hashlib.sha256(html.encode('utf-8')).hexdigest()}")
print(f"form: {data['formId']} {data['formRev']}")
print(f"part3 {len(part3)} wac {len(wac)} terms {len(terms)} (headings {sum(1 for t in terms if t['k']=='h')})")
print(f"terms sha256: {sha}")
