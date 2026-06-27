#!/usr/bin/env python3
"""Build category database: website categories + POS category mapping reference."""
import pandas as pd, json
from pathlib import Path
from collections import Counter

OUT = Path("GREENWAY WEBSITE/database/categories")
OUT.mkdir(parents=True, exist_ok=True)

prod = pd.read_excel("PRODUCTS.xlsx")
inv = pd.read_excel("INVENTORIES.xlsx")

# Website categories (mirrors src/lib/pos/category-taxonomy.ts)
website_categories = [
    {"value":"flower","label":"Flower"},
    {"value":"popcorn-bud","label":"Popcorn Bud"},
    {"value":"infused-flower","label":"Infused Flower"},
    {"value":"accessories","label":"Accessories"},
    {"value":"merch","label":"Greenway Merch"},
    {"value":"paraphernalia","label":"Paraphernalia"},
    {"value":"preroll","label":"Preroll"},
    {"value":"blunt","label":"Blunt"},
    {"value":"preroll-pack","label":"Preroll Pack"},
    {"value":"infused-preroll","label":"Infused Preroll"},
    {"value":"infused-blunt","label":"Infused Blunt"},
    {"value":"infused-preroll-pack","label":"Infused Preroll Pack"},
    {"value":"cartridge","label":"Cartridge"},
    {"value":"disposable-cartridge","label":"Disposable Cartridge"},
    {"value":"concentrate","label":"Concentrate"},
    {"value":"rso","label":"RSO"},
    {"value":"edible-solid","label":"Edible (Solid)"},
    {"value":"edible-liquid","label":"Edible (Liquid)"},
    {"value":"tincture","label":"Tincture"},
    {"value":"topical","label":"Topical"},
    {"value":"trim","label":"Trim"},
]

# POS category usage counts (so staff see how many products fall in each POS bucket)
pos_cat_counts = Counter(str(c).strip() for c in prod["Category"].dropna())
inv_cat_counts = Counter(str(c).strip() for c in inv["Category"].dropna())

pos_categories = []
for cat, cnt in sorted(pos_cat_counts.items(), key=lambda x:-x[1]):
    pos_categories.append({
        "posCategory": cat,
        "productsCount": cnt,
        "inventoriesCount": inv_cat_counts.get(cat,0),
        "mappedWebsiteCategory": "",  # filled by transformer mapping; staff can review
    })

with open(OUT/"website-categories.json","w") as f:
    json.dump(website_categories, f, indent=2)
with open(OUT/"pos-category-usage.json","w") as f:
    json.dump(pos_categories, f, indent=2)

print("Website categories:", len(website_categories))
print("Distinct POS categories (products):", len(pos_categories))
