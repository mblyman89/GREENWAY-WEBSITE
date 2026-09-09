#!/usr/bin/env python3
"""
scripts/recon/receiving-sweep-measure.py

RECEIVING PIPELINE SWEEP — measure whether the identity rules at the receiving
door agree with each other, the same way scripts/recon/receiving-brand-gap.py
measured brands.

Standing rule 11 says receiving intake is the real pipeline. Rule 4 says do not
assume something doesn't exist — verify. So this MEASURES the four vendor-name
normalizers and the product-name normalizer against the store's own 106 vendor
records, instead of reasoning about regexes.

Faithful mirrors of the real implementations (read from the repo, quoted in the
comment above each):
  A) vendor-resolve-core.normalizeVendorKey   (the canonical one, used by
     receiving vendor resolution + the customer-facing card identity)
  B) po-match-core.normalizeVendorName        (PO <-> manifest linking)
  C) unified-search-core.normalizeVendorKey   (purchasing search / platform map)
  D) po-receive-core.normalizeProductName     (PO line <-> lot matching)

No network. No assumptions.
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
VENDORS = os.path.join(ROOT, "back-office", "GREENWAY WEBSITE", "database", "vendors")


# --- A) src/lib/inventory/vendor-resolve-core.ts -----------------------------
#   .toLowerCase()
#   .replace(/&/g, " and ")
#   .replace(/['\u2019\u2018]/g, "")   // apostrophes vanish
#   .replace(/[^a-z0-9]+/g, " ")
#   .replace(/\s+/g, " ").trim()
def norm_vendor_key(raw):
    if not isinstance(raw, str):
        return ""
    s = raw.lower()
    s = s.replace("&", " and ")
    s = re.sub(r"['\u2019\u2018]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


# --- B) src/lib/inventory/po-match-core.ts -----------------------------------
#   .toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()
def norm_vendor_name(s):
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


# --- C) src/lib/purchasing/unified-search-core.ts ----------------------------
#   .toLowerCase().replace(/\s+/g, " ").trim()      <- PUNCTUATION KEPT
def norm_unified(name):
    if not isinstance(name, str):
        return ""
    return re.sub(r"\s+", " ", name.lower()).strip()


# --- D) src/lib/inventory/po-receive-core.ts ---------------------------------
#   identical text to (B), applied to PRODUCT names
def norm_product_name(s):
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def collect_vendors():
    out = []
    if not os.path.isdir(VENDORS):
        print("FATAL: vendor database not found at %s" % VENDORS)
        sys.exit(2)
    for slug in sorted(os.listdir(VENDORS)):
        path = os.path.join(VENDORS, slug, "vendor.json")
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as fh:
            try:
                doc = json.load(fh)
            except Exception as exc:
                print("  ! unreadable %s: %s" % (path, exc))
                continue
        nm = doc.get("displayName") or doc.get("display_name") or doc.get("name")
        if isinstance(nm, str) and nm.strip():
            out.append((slug, nm.strip(), doc.get("posAliases") or []))
    return out


def variants(name):
    """Spellings a vendor/manifest realistically sends for the SAME company."""
    v = {}
    if " " in name:
        v["double space"] = name.replace(" ", "  ", 1)
        v["hyphenated"] = name.replace(" ", "-")
        v["no space"] = name.replace(" ", "")
    v["upper"] = name.upper()
    v["lower"] = name.lower()
    v["trailing space"] = name + " "
    v["comma llc"] = name + ", LLC"
    v["period"] = name + "."
    return {k: x for k, x in v.items() if x and x != name}


def main():
    vendors = collect_vendors()
    print("=" * 74)
    print("RECEIVING PIPELINE SWEEP - identity rules, measured on real data")
    print("=" * 74)
    print("vendor records read : %d" % len(vendors))
    names = [n for _, n, _ in vendors]
    print("distinct displayName: %d" % len(set(names)))
    print()

    # ---- 1. Do the FOUR vendor normalizers agree with each other? ----------
    print("--- 1. do the vendor-name normalizers AGREE? -------------------------")
    disagree_ab = disagree_ac = 0
    examples = []
    total = 0
    for _, name, _ in vendors:
        for label, variant in sorted(variants(name).items()):
            total += 1
            a_same = norm_vendor_key(variant) == norm_vendor_key(name)
            b_same = norm_vendor_name(variant) == norm_vendor_name(name)
            c_same = norm_unified(variant) == norm_unified(name)
            if a_same != b_same:
                disagree_ab += 1
            if a_same != c_same:
                disagree_ac += 1
                if len(examples) < 10:
                    examples.append((name, label, variant, a_same, c_same))
    print("realistic spellings tested                  : %d" % total)
    print("A(canonical) vs B(po-match)   disagreements : %d" % disagree_ab)
    print("A(canonical) vs C(unified)    disagreements : %d" % disagree_ac)
    print()
    if examples:
        print("examples where the CANONICAL matcher links a vendor and")
        print("unified-search does NOT (same company, different verdict):")
        for name, label, variant, a, c in examples:
            print("   %-26s %-14s canonical=%-5s unified=%-5s %r"
                  % (name[:26], label, a, c, variant))
    print()

    # ---- 2. Does '&' vs 'and' matter in the real data? ---------------------
    print("--- 2. the '&' -> ' and ' rule (only A has it) -----------------------")
    amp = [n for n in names if "&" in n]
    print("vendors whose real name contains '&' : %d" % len(amp))
    for n in amp:
        print("   %-34s A=%-24r B=%r" % (n, norm_vendor_key(n), norm_vendor_name(n)))
    if amp:
        print()
        print("   -> for these vendors, a manifest spelling 'and' instead of '&'")
        print("      LINKS under the canonical matcher and MISSES under po-match.")
    print()

    # ---- 3. Apostrophes: A deletes them, B turns them into a space --------
    print("--- 3. apostrophes: A deletes, B splits the word ---------------------")
    apo = [n for n in names if "'" in n or "\u2019" in n]
    print("vendors whose real name contains an apostrophe : %d" % len(apo))
    for n in apo:
        print("   %-30s A=%-22r B=%r" % (n, norm_vendor_key(n), norm_vendor_name(n)))
    print()

    # ---- 4. Vendor key COLLISIONS: would any rule merge two companies? ----
    print("--- 4. would any normalizer MERGE two different vendors? -------------")
    for label, fn in (("A canonical", norm_vendor_key),
                      ("B po-match ", norm_vendor_name),
                      ("C unified  ", norm_unified)):
        buckets = {}
        for _, name, _ in vendors:
            buckets.setdefault(fn(name), set()).add(name)
        merges = {k: v for k, v in buckets.items() if len(v) > 1}
        print("   %s : %d distinct keys, %d merges" % (label, len(buckets), len(merges)))
        for k, v in sorted(merges.items()):
            print("        !! %-24s %s" % (k, sorted(v)))
    print()

    # ---- 5. posAliases: does the canonical key already unify them? -------
    print("--- 5. posAliases vs displayName under the canonical matcher ---------")
    alias_rows = mismatch = 0
    shown = 0
    for _, name, aliases in vendors:
        for al in aliases:
            if not isinstance(al, str) or not al.strip():
                continue
            alias_rows += 1
            if norm_vendor_key(al) != norm_vendor_key(name):
                mismatch += 1
                if shown < 10:
                    shown += 1
                    print("   alias %-30r != display %-30r" % (al, name))
    print("   posAliases checked : %d" % alias_rows)
    print("   alias not equal to displayName under canonical key : %d" % mismatch)
    print()

    # ---- 6. PRODUCT-name normalizer: the size-token trap ------------------
    print("--- 6. product-name normalizer (po-receive-core) ---------------------")
    print("   It is the SAME text as po-match's vendor rule, applied to products.")
    print("   Punctuation -> space, so size/pack tokens SURVIVE. Consequence:")
    cases = [
        ("Blue Dream 1g", "Blue Dream 1 g"),
        ("Blue Dream 3.5g", "Blue Dream 3.5 g"),
        ("Blue Dream 1g", "Blue Dream 1G"),
        ("Blue Dream (1g)", "Blue Dream 1g"),
        ("Blue Dream - 1g", "Blue Dream 1g"),
        ("Blue Dream 1g", "Blue Dream 3.5g"),
    ]
    for a, b in cases:
        same = norm_product_name(a) == norm_product_name(b)
        print("   %-22r vs %-22r -> %s   (%r / %r)"
              % (a, b, "MATCH" if same else "differ", norm_product_name(a), norm_product_name(b)))
    print()
    print("   '3.5g' becomes '3 5g' (the period turns into a space), so a PO line")
    print("   spelled '3.5g' and a lot spelled '3.5 g' both land on '3 5 g'-ish")
    print("   forms only if spacing agrees. Different SIZES correctly stay apart,")
    print("   which is what we want for receiving - do NOT copy brandKey here.")


if __name__ == "__main__":
    main()
