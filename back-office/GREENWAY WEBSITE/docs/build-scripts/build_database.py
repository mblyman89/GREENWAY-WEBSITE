#!/usr/bin/env python3
"""
Greenway Website — Master Folder Database Builder
Builds the organized "GREENWAY WEBSITE" folder tree:
  - vendors/<vendor-slug>/  (logo, mission, about, contact, brands/<brand>/products/<product>/)
  - strains spreadsheet
  - intake/transformer folders
  - manifests (JSON) the website/back office can consume
"""
import pandas as pd
import json
import re
import os
from pathlib import Path
from collections import defaultdict

ROOT = Path("GREENWAY WEBSITE")
DB = ROOT / "database"

def slugify(text):
    text = str(text).strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return re.sub(r"(^-|-$)", "", text) or "unknown"

prod = pd.read_excel("PRODUCTS.xlsx")
inv = pd.read_excel("INVENTORIES.xlsx")

# ---------------------------------------------------------------------------
# 1. Build canonical vendor -> brand -> product structure from INVENTORIES
#    (Inventories has Vendor + Brand + Product; Products has rich metadata)
# ---------------------------------------------------------------------------

# Brand -> vendor (from inventories, most authoritative for vendor link)
brand_vendor = {}
for _, r in inv[["Brand", "Vendor"]].dropna().drop_duplicates().iterrows():
    brand_vendor.setdefault(str(r["Brand"]).strip(), set()).add(str(r["Vendor"]).strip())

# Build a product metadata lookup from PRODUCTS by (brand, product name)
prod_meta = {}
for _, r in prod.iterrows():
    key = (str(r.get("Brand", "")).strip(), str(r.get("Product Name", "")).strip())
    prod_meta[key] = {
        "productName": str(r.get("Product Name", "")).strip(),
        "inventoryType": str(r.get("Inventory Type", "")).strip(),
        "category": str(r.get("Category", "")).strip(),
        "brand": str(r.get("Brand", "")).strip(),
        "strainType": str(r.get("Type", "")).strip(),
        "strain": str(r.get("Strain", "")).strip(),
        "uom": str(r.get("UOM", "")).strip(),
        "packageSize": r.get("Package Size"),
        "price": r.get("Price"),
        "cannabis": str(r.get("Cannabis Y/N", "")).strip(),
        "description": str(r.get("Description", "")).strip(),
    }

# Vendor registry
vendors = defaultdict(lambda: {"brands": defaultdict(list)})

# Iterate products to assign each to brand; resolve vendor via brand_vendor map
unassigned_vendor = "INDEPENDENT / UNLISTED VENDOR"
for _, r in prod.iterrows():
    brand = str(r.get("Brand", "")).strip()
    if not brand or brand.lower() == "nan":
        brand = "UNBRANDED"
    vendor_set = brand_vendor.get(brand)
    vendor = sorted(vendor_set)[0] if vendor_set else unassigned_vendor
    pdata = {
        "productName": str(r.get("Product Name", "")).strip(),
        "inventoryType": str(r.get("Inventory Type", "")).strip(),
        "category": str(r.get("Category", "")).strip(),
        "strainType": str(r.get("Type", "")).strip(),
        "strain": str(r.get("Strain", "")).strip(),
        "packageSize": None if pd.isna(r.get("Package Size")) else r.get("Package Size"),
        "uom": str(r.get("UOM", "")).strip(),
        "price": None if pd.isna(r.get("Price")) else float(r.get("Price")),
        "cannabis": str(r.get("Cannabis Y/N", "")).strip() == "Y",
        "description": str(r.get("Description", "")).strip(),
        "imageFile": "",  # to be filled by back office / media library
    }
    vendors[vendor]["brands"][brand].append(pdata)

print(f"Vendors: {len(vendors)}  | total product rows mapped: {sum(len(p) for v in vendors.values() for p in v['brands'].values())}")

# ---------------------------------------------------------------------------
# 2. Create the folder tree + manifests
# ---------------------------------------------------------------------------
vendor_index = []
for vendor_name, vdata in sorted(vendors.items(), key=lambda x: x[0].lower()):
    vslug = slugify(vendor_name)
    vdir = DB / "vendors" / vslug
    (vdir / "logo").mkdir(parents=True, exist_ok=True)
    (vdir / "brands").mkdir(parents=True, exist_ok=True)

    brand_list = []
    total_products = 0
    for brand_name, products in sorted(vdata["brands"].items(), key=lambda x: x[0].lower()):
        bslug = slugify(brand_name)
        bdir = vdir / "brands" / bslug
        (bdir / "logo").mkdir(parents=True, exist_ok=True)
        (bdir / "products").mkdir(parents=True, exist_ok=True)

        prod_entries = []
        for p in products:
            pslug = slugify(p["productName"])[:80]
            pdir = bdir / "products" / pslug
            pdir.mkdir(parents=True, exist_ok=True)
            (pdir / "images").mkdir(exist_ok=True)
            # product.json
            with open(pdir / "product.json", "w") as f:
                json.dump(p, f, indent=2)
            prod_entries.append({"slug": pslug, "name": p["productName"],
                                 "category": p["category"], "strain": p["strain"]})
        total_products += len(prod_entries)

        # brand.json profile template
        brand_profile = {
            "displayName": brand_name,
            "slug": bslug,
            "vendor": vendor_name,
            "logoFile": "",
            "missionStatement": "",
            "about": "",
            "website": "",
            "instagram": "",
            "productPhilosophy": "",
            "productCount": len(prod_entries),
            "status": "draft",
            "posAliases": [brand_name],
        }
        with open(bdir / "brand.json", "w") as f:
            json.dump(brand_profile, f, indent=2)
        with open(bdir / "products-index.json", "w") as f:
            json.dump(prod_entries, f, indent=2)
        brand_list.append({"slug": bslug, "name": brand_name, "productCount": len(prod_entries)})

    # vendor.json profile template
    vendor_profile = {
        "displayName": vendor_name,
        "slug": vslug,
        "legalName": "",
        "logoFile": "",
        "missionStatement": "",
        "about": "",
        "website": "",
        "email": "",
        "phone": "",
        "instagram": "",
        "facebook": "",
        "internalNotes": "",
        "vendorDayNotes": "",
        "status": "draft",
        "posAliases": [vendor_name],
        "brandCount": len(brand_list),
        "productCount": total_products,
    }
    with open(vdir / "vendor.json", "w") as f:
        json.dump(vendor_profile, f, indent=2)
    with open(vdir / "brands-index.json", "w") as f:
        json.dump(brand_list, f, indent=2)
    vendor_index.append({"slug": vslug, "name": vendor_name,
                         "brandCount": len(brand_list), "productCount": total_products})

# Master vendor index
(DB / "vendors").mkdir(parents=True, exist_ok=True)
with open(DB / "vendors" / "_index.json", "w") as f:
    json.dump(sorted(vendor_index, key=lambda x: -x["productCount"]), f, indent=2)

print(f"Wrote folder tree under {DB/'vendors'}")
print(f"Vendor index entries: {len(vendor_index)}")
