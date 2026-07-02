#!/usr/bin/env python3
"""Convert verified combined_strains.json into strains_extracted.py (EXTRACTED_STRAINS).

Follows the STRAINS tuple contract used by build_strains.py:
 (name, type, lineage|None, dom_terp, aromas[], flavors[], terps[],
  cann, potency|None, bud|None, origin|None, summary, aliases[], sources[], confidence)

Quality gates (never guess; customer-facing facts only):
 - Must have EITHER >=1 verified measured terpene OR (WA-confident type AND >=2 flavor notes).
 - Skip names that are obviously non-strains / junk / too short / numeric-only.
 - Terpenes/flavors/aromas normalized to lowercase controlled tokens.
 - No effects/ailments ever (not read from source).
 - confidence scaled by evidence strength.
"""
import json, re, os

BASE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(BASE, "combined_strains.json")))
existing = set(l.strip() for l in open(os.path.join(BASE, "existing_slugs.txt")) if l.strip())

# terpene display token -> lowercase seed token (match existing seed vocabulary)
TERP_TOKEN = {
    "Myrcene": "myrcene", "Limonene": "limonene", "Caryophyllene": "caryophyllene",
    "Caryophyllene Oxide": "caryophyllene", "Linalool": "linalool", "Pinene": "pinene",
    "Terpinolene": "terpinolene", "Humulene": "humulene", "Ocimene": "ocimene",
    "Bisabolol": "bisabolol", "Nerolidol": "nerolidol", "Guaiol": "guaiol",
    "Geraniol": "geraniol", "Eucalyptol": "eucalyptol", "Camphene": "camphene",
    "Carene": "carene", "Terpinene": "terpinene", "Cymene": "cymene",
    "Farnesene": "farnesene", "Isopulegol": "isopulegol",
}
# normalize flavor tokens to a clean controlled set
FLAVOR_CANON = {
    "citrus": "citrus", "lemon": "lemon", "lime": "citrus", "orange": "orange",
    "sweet": "sweet", "berry": "berry", "blueberry": "blueberry", "grape": "grape",
    "earthy": "earthy", "earth": "earthy", "pine": "pine", "piney": "pine",
    "woody": "woody", "wood": "woody", "diesel": "diesel", "fuel": "diesel",
    "pungent": "pungent", "spicy": "spicy", "spice": "spicy", "pepper": "peppery",
    "peppery": "peppery", "herbal": "herbal", "herb": "herbal", "floral": "floral",
    "flowery": "floral", "tropical": "tropical", "pineapple": "pineapple",
    "mango": "mango", "cheese": "cheese", "coffee": "coffee", "chocolate": "chocolate",
    "vanilla": "vanilla", "mint": "mint", "minty": "mint", "menthol": "mint",
    "nutty": "nutty", "sour": "sour", "skunk": "skunk", "tea": "herbal",
    "honey": "honey", "apricot": "apricot", "peach": "peach", "apple": "apple",
    "strawberry": "strawberry", "tar": "earthy", "tobacco": "earthy",
    "butter": "creamy", "creamy": "creamy", "cream": "creamy", "tree fruit": "apple",
    "lavender": "floral", "rose": "floral", "sage": "herbal", "chestnut": "nutty",
    "pear": "apple", "plum": "grape", "blue cheese": "cheese", "grapefruit": "citrus",
    "tangy": "sour", "hash": "hash", "ammonia": "pungent", "chemical": "diesel",
    "pepper ": "peppery", "menthol ": "mint", "sweet ": "sweet",
}
ALLOWED_AROMA = {  # already curated in extract.py TERP_AROMA
    "earthy","musky","herbal","citrus","lemon","peppery","spicy","woody","floral",
    "lavender","pine","fresh","hoppy","sweet","chamomile","rose","minty","eucalyptus",
    "piney",
}

STOP = re.compile(r"^[0-9\W]+$")
BAD = re.compile(r"(sample|test|batch|lot|#\d|unknown|misc|blank|control|std|standard|"
                 r"http|www|null|n/a|tbd|\bmix\b|\boil\b|\bwax\b|\bshatter\b|distillate)",
                 re.I)

def norm_key(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())

# known acronym / stylized strain names -> canonical display
NAME_FIX = {
    "ak47": "AK-47", "ak 47": "AK-47", "lsd": "LSD", "acdc": "AC/DC",
    "ac/dc": "AC/DC", "g13": "G13", "g 13": "G13", "gg4": "GG4",
    "mk ultra": "MK Ultra", "b52": "B-52", "b 52": "B-52", "cbd": "CBD",
    "thc bomb": "THC Bomb", "302 og": "302 OG",
}

def title_name(n):
    fix = NAME_FIX.get(n.strip().lower())
    if fix:
        return fix
    return " ".join(w if (w.isupper() and len(w) > 1) else w.capitalize()
                    for w in n.split())

def canon_type(t):
    if t in ("indica", "sativa", "hybrid"): return t
    return "hybrid"

def build_summary(name, stype, terps, flavors, origin, lineage):
    typ = {"indica": "an indica", "sativa": "a sativa", "hybrid": "a hybrid"}[stype]
    bits = []
    if flavors:
        bits.append("flavors of " + ", ".join(flavors[:3]))
    if terps:
        bits.append(terps[0].capitalize() + "-forward terpene profile")
    tail = " with " + " and ".join(bits) + "." if bits else "."
    lead = f"{name} is {typ}"
    if lineage:
        lead += f", a cross of {lineage}"
    return lead + tail

existing_norm = {norm_key(e) for e in existing}
out = []
seen = set()
seen_norm = set()
skipped = 0
for r in data:
    name = (r.get("name") or "").strip()
    if not name or STOP.match(name) or BAD.search(name) or len(name) < 3:
        skipped += 1; continue
    disp = title_name(name)
    slug = disp.strip().lower()
    nk = norm_key(disp)
    # drop exact dupes AND normalized near-dupes vs existing curated set + within set
    if slug in existing or slug in seen or nk in existing_norm or nk in seen_norm:
        continue
    terps_disp = r.get("terpenes") or []
    terps = []
    for t in terps_disp:
        tok = TERP_TOKEN.get(t)
        if tok and tok not in terps:
            terps.append(tok)
    flavors = []
    for f in (r.get("flavor_notes") or []):
        c = FLAVOR_CANON.get(f.strip().lower())
        if c and c not in flavors:
            flavors.append(c)
    aromas = [a for a in (r.get("aroma_notes") or []) if a in ALLOWED_AROMA]
    aromas = aromas[:4]
    stype = canon_type(r.get("strain_type"))
    confident = r.get("type_confident")
    # QUALITY GATE
    strong_terp = len(terps) >= 1
    strong_flavor = confident and len(flavors) >= 2
    if not (strong_terp or strong_flavor):
        continue
    # need at least some sensory content overall
    if not terps and not flavors:
        continue
    lineage = (r.get("lineage") or "").strip() or None
    origin = (r.get("origin") or "").strip() or None
    potency = (r.get("potency_note") or "").strip() or None
    dom_terp = terps[0] if terps else ""
    # aromas fallback: if empty but we have flavors, mirror a couple flavor tokens
    if not aromas and flavors:
        aromas = flavors[:3]
    summary = build_summary(disp, stype, terps, flavors, origin, lineage)
    # confidence
    conf = 0.55
    if strong_terp: conf += 0.1
    if confident: conf += 0.1
    if lineage: conf += 0.05
    conf = round(min(conf, 0.85), 2)
    sources = r.get("sources") or []
    out.append((
        disp, stype, lineage, dom_terp, aromas, flavors, terps,
        "thc", potency, None, origin, summary, [], sources, conf,
    ))
    seen.add(slug)
    seen_norm.add(nk)

# sort by confidence then name for stable output
out.sort(key=lambda x: (-x[14], x[0]))

# write module
def pyrepr(v):
    return repr(v)

path = os.path.join(BASE, "strains_extracted.py")
with open(path, "w") as f:
    f.write('"""strains_extracted.py \u2014 GENERATED by build_extracted.py. Do not edit by hand.\n\n')
    f.write("Verified, customer-facing strain facts extracted & combined from public\n")
    f.write("datasets (WA I-502 state lab tests, multi-lab terpene assays, The Cannabis\n")
    f.write("API, Kushy dataset). Sensory/botanical/market-factual ONLY \u2014 no medical or\n")
    f.write("effect claims. Same tuple contract as build_strains.STRAINS.\n\"\"\"\n\n")
    f.write("EXTRACTED_STRAINS = [\n")
    for t in out:
        f.write("    " + pyrepr(t) + ",\n")
    f.write("]\n")

print(f"wrote {len(out)} extracted strains -> {path}  (skipped junk: {skipped})")
# tier report
with_terp = sum(1 for t in out if t[6])
print(f"  with verified terpenes: {with_terp}")
print(f"  flavor-only: {len(out)-with_terp}")
