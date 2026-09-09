#!/usr/bin/env python3
"""
scripts/recon/receiving-sweep-part3.py

Part 3 of the receiving sweep. Part 2 measured that normalizeProductName
MISSES on spacing ("Blue Dream 1g" vs "Blue Dream 1 g"). A miss is safe:
buildAutoReceivePlan pushes the lot to unmatchedLots and a human receives it
by hand.

The dangerous direction is the OTHER one: does normalizeProductName MERGE two
DIFFERENT products? That direction writes. buildAutoReceivePlan calls
receivePoLine(lineId, qty) for real, so a wrong name match books stock against
the wrong PO line with no human in the loop.

Measured against the 1,707 real strain names in STRAINS_MASTER.csv, expanded
into realistic retail product names the way vendors actually spell them.
"""
import csv
import os
import re
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
STRAINS = os.path.join(
    ROOT, "back-office", "GREENWAY WEBSITE", "database", "strains", "STRAINS_MASTER.csv"
)


def norm_product_name(s):  # po-receive-core.ts:74 (verbatim port)
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def strains():
    out = []
    with open(STRAINS, encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            nm = (row.get("Strain Name") or "").strip()
            if nm:
                out.append(nm)
    return out


names = strains()
print("=" * 74)
print("PART 3 - can normalizeProductName MERGE two DIFFERENT products?")
print("=" * 74)
print("real strain names loaded: %d" % len(names))
print()

# --- 1) Do the raw strain names themselves collide? ------------------------
buckets = defaultdict(set)
for n in names:
    buckets[norm_product_name(n)].add(n)
collide = {k: v for k, v in buckets.items() if len(v) > 1}
print("A) raw strain names that normalize to the SAME key: %d" % len(collide))
for k, v in sorted(collide.items())[:25]:
    print("   %-34r <- %s" % (k, sorted(v)))
print()

# --- 2) Size suffixes: the part that MUST stay apart -----------------------
SIZES = ["1g", "2g", "3.5g", "7g", "14g", "28g", "0.5g", "10pk", "20pk", "100mg", "10mg"]
print("B) does a size suffix ever collapse into a DIFFERENT size?")
size_keys = defaultdict(set)
for s in SIZES:
    size_keys[norm_product_name("X " + s)].add(s)
bad = {k: v for k, v in size_keys.items() if len(v) > 1}
for k, v in sorted(size_keys.items()):
    flag = "!! MERGED" if len(v) > 1 else "ok"
    print("   %-6s %-14r <- %s" % (flag, k, sorted(v)))
print("   size merges: %d" % len(bad))
print()

# --- 3) The real risk: full product names on one PO ------------------------
print("C) FULL product names as a PO would list them (strain + size),")
print("   checking whether two DIFFERENT SKUs share a normalized key:")
full = defaultdict(set)
for n in names:
    for s in ("1g", "3.5g", "7g"):
        for tmpl in ("%s %s", "%s (%s)", "%s - %s"):
            full[norm_product_name(tmpl % (n, s))].add((n, s))
merged = {k: v for k, v in full.items() if len(v) > 1}
print("   distinct normalized keys: %d" % len(full))
print("   keys covering MORE THAN ONE (strain,size) pair: %d" % len(merged))
for k, v in sorted(merged.items())[:25]:
    print("      %-40r <- %s" % (k, sorted(v)))
print()

# --- 4) Punctuation-only spelling drift on real names ----------------------
print("D) punctuation drift on REAL strain names - do the vendor's spelling")
print("   and ours still link? (a MISS here = safe manual fallback)")
drift_miss = 0
checked = 0
samples = []
for n in names:
    if not re.search(r"[^A-Za-z0-9 ]", n):
        continue
    checked += 1
    plain = re.sub(r"[^A-Za-z0-9 ]+", "", n)  # vendor drops the punctuation
    if norm_product_name(n) != norm_product_name(plain):
        drift_miss += 1
        if len(samples) < 12:
            samples.append((n, plain, norm_product_name(n), norm_product_name(plain)))
print("   strain names containing punctuation: %d" % checked)
print("   of those, spellings that FAIL to link: %d" % drift_miss)
for a, b, ka, kb in samples:
    print("      %-26r vs %-26r -> %r / %r" % (a, b, ka, kb))
print()

print("=" * 74)
print("VERDICT INPUTS (facts only - judgement goes in the report)")
print("=" * 74)
print("  raw-name collisions .......... %d" % len(collide))
print("  size merges .................. %d" % len(bad))
print("  full-SKU merges .............. %d" % len(merged))
print("  punctuation-drift misses ..... %d of %d" % (drift_miss, checked))
