#!/usr/bin/env python3
"""
scripts/recon/receiving-name-key-measure.py

Ground the Defect A + Defect B fix in FACT before writing a line of it.

Defect B is the tempting one to get wrong. The obvious "fix" for
"Blue Dream 1g" != "Blue Dream 1 g" is to squeeze all whitespace out, the way
brandKey() does. That is EXACTLY the change that would turn a safe MISS into a
dangerous MERGE, because product names carry SIZE and size is identity:

    squeeze("Rosin - SOUR FRUIT - 1g")   -> rosinsourfruit1g
    squeeze("Rosin - SOUR FRUIT - 1 g")  -> rosinsourfruit1g   <- wanted
    but also, potentially, two different SKUs colliding.

So this script measures, against the 2,615 REAL product records in the
back-office database, exactly what each candidate normalizer does:

  1. current  - normalizeProductName (po-receive-core.ts:74)
  2. squeeze  - the naive brandKey-style fix (all whitespace removed)
  3. unitfix  - the PROPOSED fix: join a bare number to a following unit token
                ONLY ("1 g" -> "1g"), leaving all other spacing alone.

For each: how many DISTINCT real products collapse onto a shared key. Any
collision count above the current baseline is a regression that would let
auto-receive book stock against the wrong PO line, which is the very bug we
are fixing. The proposed fix must show ZERO new collisions.
"""
import json
import os
import re
import subprocess
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
VENDORS = os.path.join(ROOT, "back-office", "GREENWAY WEBSITE", "database", "vendors")


# --- the three normalizers -------------------------------------------------

def norm_current(s):
    """po-receive-core.ts:74, verbatim port."""
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_squeeze(s):
    """The naive fix. brandKey-style: remove ALL whitespace."""
    return re.sub(r"\s+", "", norm_current(s))


# The unit tokens that may follow a bare number. Cannabis retail packaging.
UNITS = ("mg", "g", "oz", "ml", "pk", "ct", "pc")
_UNIT_RE = re.compile(r"\b(\d+(?: \d+)?) (" + "|".join(UNITS) + r")\b")


def norm_unitfix(s):
    """
    PROPOSED. Same as current, then join a bare number to a following unit
    token. Deliberately narrow: only digits + a known unit word close up.
    Everything else keeps its spacing, so size stays identity.

    Note "3.5g" is already "3 5g" after punctuation stripping, so the number
    group tolerates one internal space ("3 5 g" -> "3 5g").
    """
    return _UNIT_RE.sub(r"\1\2", norm_current(s))


CANDIDATES = [("current", norm_current), ("squeeze", norm_squeeze), ("unitfix", norm_unitfix)]


# --- real product names ----------------------------------------------------

def product_names():
    out = []
    finder = subprocess.run(
        ["find", VENDORS, "-name", "product.json"], capture_output=True, text=True
    )
    for path in finder.stdout.strip().splitlines():
        try:
            with open(path, encoding="utf-8") as fh:
                d = json.load(fh)
        except Exception:
            continue
        nm = d.get("displayName") or d.get("name") or d.get("productName")
        if isinstance(nm, str) and nm.strip():
            out.append(nm.strip())
    return out


names = product_names()
distinct = sorted(set(names))

print("=" * 74)
print("GROUNDING THE DEFECT A + B FIX ON REAL PRODUCT DATA")
print("=" * 74)
print("product.json records read : %d" % len(names))
print("distinct product names    : %d" % len(distinct))
print()

# --- 1) collisions per normalizer -----------------------------------------
print("=" * 74)
print("1) COLLISIONS - do two DIFFERENT real products share one key?")
print("   (a collision is what lets auto-receive pick the wrong PO line)")
print("=" * 74)
results = {}
for label, fn in CANDIDATES:
    buckets = defaultdict(set)
    for n in distinct:
        buckets[fn(n)].add(n)
    collided = {k: v for k, v in buckets.items() if len(v) > 1}
    merged_products = sum(len(v) for v in collided.values())
    results[label] = collided
    print("   %-8s keys=%-6d colliding keys=%-4d products caught up=%d"
          % (label, len(buckets), len(collided), merged_products))
print()

base = len(results["current"])
for label in ("squeeze", "unitfix"):
    delta = len(results[label]) - base
    verdict = "REGRESSION" if delta > 0 else ("no new collisions" if delta == 0 else "fewer")
    print("   %-8s vs current: %+d colliding keys -> %s" % (label, delta, verdict))
print()

print("   Collisions introduced by 'squeeze' that 'current' did NOT have:")
new_sq = set(results["squeeze"]) - {norm_squeeze(list(v)[0]) for v in results["current"].values()}
shown = 0
for k in sorted(results["squeeze"]):
    v = results["squeeze"][k]
    if len({norm_current(x) for x in v}) > 1:  # current kept them apart
        print("      %-44r <- %s" % (k, sorted(v)[:3]))
        shown += 1
        if shown >= 12:
            break
if shown == 0:
    print("      (none)")
print()

print("   Collisions introduced by 'unitfix' that 'current' did NOT have:")
shown = 0
for k in sorted(results["unitfix"]):
    v = results["unitfix"][k]
    if len({norm_current(x) for x in v}) > 1:
        print("      %-44r <- %s" % (k, sorted(v)[:3]))
        shown += 1
        if shown >= 12:
            break
if shown == 0:
    print("      (none)  <-- REQUIRED for the fix to be safe")
print()

# --- 2) does unitfix actually FIX the spacing misses? ---------------------
print("=" * 74)
print("2) DOES 'unitfix' ACTUALLY CLOSE THE SPACING GAP?")
print("   Real names, respelled the way a vendor's PO would spell them")
print("   (a space before the unit). current MISSES; unitfix should MATCH.")
print("=" * 74)
SPACED = re.compile(r"\b(\d)(" + "|".join(UNITS) + r")\b")
checked = fixed_by_unitfix = still_missing = 0
samples = []
for n in distinct:
    spaced = SPACED.sub(r"\1 \2", n)
    if spaced == n:
        continue
    checked += 1
    cur_ok = norm_current(n) == norm_current(spaced)
    fix_ok = norm_unitfix(n) == norm_unitfix(spaced)
    if not cur_ok and fix_ok:
        fixed_by_unitfix += 1
        if len(samples) < 8:
            samples.append((n, spaced))
    elif not cur_ok and not fix_ok:
        still_missing += 1
print("   names with a unit suffix to respace : %d" % checked)
print("   currently MISS, fixed by unitfix    : %d" % fixed_by_unitfix)
print("   still missing after unitfix         : %d" % still_missing)
for a, b in samples:
    print("      %-46r vs %r" % (a[:44], b[:44]))
print()

# --- 3) sizes must STAY APART ---------------------------------------------
print("=" * 74)
print("3) THE SAFETY PROPERTY - different SIZES must NEVER merge")
print("=" * 74)
SIZE_PAIRS = [
    ("Rosin - SOUR FRUIT - 1g", "Rosin - SOUR FRUIT - 3.5g"),
    ("Blue Dream 1g", "Blue Dream 3.5g"),
    ("Gummies 10pk", "Gummies 20pk"),
    ("Tincture 100mg", "Tincture 10mg"),
    ("Flower 7g", "Flower 14g"),
    ("Pre-Rolls 1.5g (3x0.5g)", "Pre-Rolls 1.0g (2x0.5g)"),
]
bad = 0
for a, b in SIZE_PAIRS:
    row = []
    for label, fn in CANDIDATES:
        same = fn(a) == fn(b)
        if same and label != "current":
            bad += 1
        row.append("%s=%s" % (label, "MERGED!!" if same else "apart"))
    print("   %-26r vs %-26r %s" % (a[:24], b[:24], "  ".join(row)))
print()
print("   size merges introduced by a candidate: %d" % bad)
print()

print("=" * 74)
print("VERDICT INPUTS")
print("=" * 74)
print("  distinct real products ............. %d" % len(distinct))
print("  current colliding keys ............. %d" % len(results["current"]))
print("  squeeze colliding keys ............. %d" % len(results["squeeze"]))
print("  unitfix colliding keys ............. %d" % len(results["unitfix"]))
print("  spacing misses closed by unitfix ... %d" % fixed_by_unitfix)
print("  size merges introduced ............. %d" % bad)
