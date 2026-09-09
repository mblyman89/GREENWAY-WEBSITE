#!/usr/bin/env python3
"""
scripts/recon/receiving-sweep-part2.py

Part 2 of the receiving sweep: quantify the TWO candidate defects part 1
surfaced, and check the third rule (strain type) for the same duplicate-copy
disease. Measured, not assumed.
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
VENDORS = os.path.join(ROOT, "back-office", "GREENWAY WEBSITE", "database", "vendors")


def norm_vendor_key(raw):          # A: vendor-resolve-core (canonical)
    if not isinstance(raw, str):
        return ""
    s = raw.lower().replace("&", " and ")
    s = re.sub(r"['\u2019\u2018]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_vendor_name(s):           # B: po-match-core
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_product_name(s):          # D: po-receive-core
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def vendors():
    out = []
    for slug in sorted(os.listdir(VENDORS)):
        p = os.path.join(VENDORS, slug, "vendor.json")
        if not os.path.isfile(p):
            continue
        with open(p, encoding="utf-8") as fh:
            d = json.load(fh)
        nm = d.get("displayName")
        if isinstance(nm, str) and nm.strip():
            out.append(nm.strip())
    return out


print("=" * 74)
print("DEFECT 1 - the '&' / 'and' swap at the PO-to-manifest link")
print("=" * 74)
names = vendors()
amp = [n for n in names if "&" in n]
print("vendors with '&' in the real name: %d -> %s" % (len(amp), amp))
print()
print("A manifest/PO pair spelling the SAME company two ways:")
hits = 0
for n in amp:
    for spoken in [n.replace("&", "and"), n.replace("&", " and "), n.replace("& ", "and ")]:
        a = norm_vendor_key(spoken) == norm_vendor_key(n)
        b = norm_vendor_name(spoken) == norm_vendor_name(n)
        if a != b:
            hits += 1
            print("   %-22r vs %-22r canonical=%-5s po-match=%-5s" % (n, spoken, a, b))
print()
print("pairs where canonical LINKS and po-match MISSES: %d" % hits)
print("IMPACT: suggestPoMatches() would not offer the PO for that manifest, so a")
print("        human links it by hand (vendorMatch falls back to 'none'). It is a")
print("        MISSED SUGGESTION, not a wrong link - po_id is only ever set by a")
print("        human pressing the button. Severity: LOW. Correctness: still a")
print("        second copy of a rule that already has a canonical home.")
print()

print("=" * 74)
print("DEFECT 2 - product-name matching for AUTO-RECEIVE (po-receive-core)")
print("=" * 74)
print("buildAutoReceivePlan matches a LOT to a PO LINE on normalizeProductName.")
print("Punctuation collapses to a space but SPACING is then significant, so the")
print("same product spelled two normal ways does NOT match:")
print()
pairs = [
    ("Blue Dream 1g",        "Blue Dream 1 g"),
    ("Blue Dream 3.5g",      "Blue Dream 3.5 g"),
    ("Dawg Walker 7g",       "Dawg Walker 7 G"),
    ("Blue Dream 1g",        "Blue  Dream 1g"),
    ("Blue Dream (1g)",      "Blue Dream 1g"),
    ("Blue Dream - 1g",      "Blue Dream 1g"),
    ("Blue Dream 1g",        "BLUE DREAM 1G"),
]
miss = 0
for a, b in pairs:
    same = norm_product_name(a) == norm_product_name(b)
    if not same:
        miss += 1
    print("   %-8s %-22r vs %-22r -> %r / %r"
          % ("MISS" if not same else "match", a, b, norm_product_name(a), norm_product_name(b)))
print()
print("spacing-only mismatches out of %d realistic pairs: %d" % (len(pairs), miss))
print()
print("AND THE IMPORTANT HALF - different SIZES must NOT merge:")
for a, b in [("Blue Dream 1g", "Blue Dream 3.5g"), ("Gummies 10pk", "Gummies 20pk")]:
    same = norm_product_name(a) == norm_product_name(b)
    print("   %-22r vs %-22r -> %s" % (a, b, "!! MERGED" if same else "correctly apart"))
print()
print("IMPACT: buildAutoReceivePlan falls back to a manual pick. Let me be exact")
print("        about the blast radius - read the code path before judging.")
print()

print("=" * 74)
print("DEFECT 3 - is the STRAIN-TYPE rule duplicated too?")
print("=" * 74)
import subprocess
os.chdir(ROOT)
out = subprocess.run(
    ["grep", "-rn", "indica", "--include=*.ts", "-l", "src/lib/"],
    capture_output=True, text=True).stdout.strip().splitlines()
print("modules that mention 'indica' (candidate strain-type parsers):")
for line in out:
    print("   " + line)
