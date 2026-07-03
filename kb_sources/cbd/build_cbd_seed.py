#!/usr/bin/env python3
"""Build a CBD-strain seed from VERIFIED WA state lab data (DoltHub
cannabis-testing-wa), cross-referenced with Cannabis API for factual
aroma/flavor tags. FACTS ONLY — no verbatim descriptions.

Grounding:
- CBD relevance = modal strain chemotype 2 (balanced THC:CBD) or 3 (CBD-dominant)
  from real WA lab tests, with >= 5 tests (drops one-off outliers).
- avg_cbd / avg_thc are averaged lab measurements (facts).
- strain_category = the lab dataset's own indica/sativa/hybrid classification.
- aroma/flavor tags: only the structured Flavor list from Cannabis API (factual
  descriptors like "Earthy, Pine"); we do NOT copy any prose Description.

Output: idempotent UPDATE/INSERT-guarded SQL migration for owner MANUAL apply.
All rows carry source + a conservative confidence and are drafts for review.
"""
import csv
import json
import re

CHEMO_LABELS = {2: "balanced (Type II)", 3: "CBD-dominant (Type III)"}


def slugify(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    s = re.sub(r"\s+", " ", s)
    return s


# --- Load verified WA lab CBD strains -------------------------------------
cbd_rows = []
with open("wa_cbd_chemotype.csv") as fh:
    for r in csv.DictReader(fh):
        cbd_rows.append(r)

# --- Load Cannabis API for factual flavor tags (keyed by normalized name) --
api_flavor = {}
api_type = {}
try:
    data = json.load(open("../strain_sources/cannabis_api/cannabis.json"))
    strains = data if isinstance(data, list) else data.get("strains", data)
    for s in strains:
        nm = slugify(str(s.get("Strain", "")).replace("-", " "))
        fl = s.get("Flavor")
        if isinstance(fl, list):
            api_flavor[nm] = [str(x).strip().lower() for x in fl if str(x).strip()]
        elif isinstance(fl, str) and fl.strip():
            api_flavor[nm] = [x.strip().lower() for x in re.split(r"[,/]", fl) if x.strip()]
        api_type[nm] = str(s.get("Type", "")).strip().lower()
except Exception as e:
    print("WARN: could not load Cannabis API:", e)


def cat_to_type(cat: str) -> str:
    c = (cat or "").strip().lower()
    if c == "indica":
        return "indica"
    if c == "sativa":
        return "sativa"
    if c == "hybrid":
        return "hybrid"
    return "unknown"


rows_out = []
for r in cbd_rows:
    leafly = r["leafly_strain"].strip()
    # Leafly slugs are hyphenated; make a display name + our slug.
    display = leafly.replace("-", " ").title()
    # Fix common casing (CBD, ACDC, Tsu)
    display = re.sub(r"\bAcdc\b", "ACDC", display)
    display = re.sub(r"\bCbd\b", "CBD", display)
    display = re.sub(r"\bTsu\b", "Tsu", display)
    slug = slugify(leafly.replace("-", " "))
    chemo = int(r["strain_chemo"])
    avg_cbd = float(r["avg_cbd"])
    avg_thc = float(r["avg_thc"])
    tests = int(r["tests"])
    stype = cat_to_type(r.get("strain_category", ""))
    flavors = api_flavor.get(slug, [])

    # dominant_cannabinoid fact: CBD-dominant => cbd; balanced => balanced
    dom = "cbd" if chemo == 3 else "balanced"
    potency = (f"WA lab avg ~{avg_cbd:g}% CBD / ~{avg_thc:g}% THC "
               f"({tests} tests, {CHEMO_LABELS[chemo]})")

    rows_out.append({
        "slug": slug,
        "name": display,
        "strain_type": stype,
        "dominant_cannabinoid": dom,
        "flavor_notes": flavors,
        "potency_note": potency,
        "avg_cbd": avg_cbd,
        "avg_thc": avg_thc,
        "chemo": chemo,
        "tests": tests,
        "source": "dolthub/cannabis-testing-wa (WA state lab tests)",
        # Confidence scales with test volume; capped conservatively (secondary,
        # AI-drafted). >=100 tests => 0.75, >=20 => 0.65, else 0.55.
        "confidence": 0.75 if tests >= 100 else (0.65 if tests >= 20 else 0.55),
    })

with open("cbd_strains.json", "w") as fh:
    json.dump(rows_out, fh, indent=2)

print(f"Built {len(rows_out)} CBD strain records.")
print("CBD-dominant (chemotype 3):",
      sum(1 for r in rows_out if r["chemo"] == 3))
print("Balanced (chemotype 2):",
      sum(1 for r in rows_out if r["chemo"] == 2))
print("With flavor tags from API:",
      sum(1 for r in rows_out if r["flavor_notes"]))
print("\nSample:")
for r in rows_out[:8]:
    print(f"  {r['name']:24} [{r['strain_type']}/{r['dominant_cannabinoid']}] "
          f"{r['potency_note']}  flavors={r['flavor_notes']}")
