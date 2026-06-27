import pandas as pd
import json

prod = pd.read_excel("PRODUCTS.xlsx")
inv = pd.read_excel("INVENTORIES.xlsx")

def clean(series):
    return sorted([str(x) for x in series.dropna().unique()], key=lambda s: s.lower())

report = {}

# Brands
report["products_brands"] = clean(prod["Brand"])
report["inv_brands"] = clean(inv["Brand"])
report["inv_vendors"] = clean(inv["Vendor"])

# Categories / inventory types
report["products_inventory_types"] = clean(prod["Inventory Type"])
report["products_categories"] = clean(prod["Category"])
report["inv_categories"] = clean(inv["Category"])
report["inv_inventory_types"] = clean(inv["InventoryType"])

# Strain types (Type col in products)
report["products_strain_types"] = clean(prod["Type"])
report["products_strains"] = clean(prod["Strain"])
report["inv_strains"] = clean(inv["Strain"])

print("=== COUNTS ===")
print("PRODUCTS unique brands:", len(report["products_brands"]))
print("INV unique brands:", len(report["inv_brands"]))
print("INV unique vendors:", len(report["inv_vendors"]))
print("PRODUCTS inventory types:", report["products_inventory_types"])
print("PRODUCTS categories count:", len(report["products_categories"]))
print("INV inventory types:", report["inv_inventory_types"])
print("INV categories count:", len(report["inv_categories"]))
print("PRODUCTS strain types:", report["products_strain_types"])
print("PRODUCTS unique strains:", len(report["products_strains"]))
print("INV unique strains:", len(report["inv_strains"]))

# Brand -> Vendor mapping from inventories
bv = inv[["Brand","Vendor"]].dropna().drop_duplicates()
brand_vendor = {}
for _, r in bv.iterrows():
    brand_vendor.setdefault(str(r["Brand"]), set()).add(str(r["Vendor"]))
report["brand_to_vendors"] = {k: sorted(v) for k,v in brand_vendor.items()}

# Image attached stats
img = prod["Image Attached Y/N"].value_counts().to_dict()
report["image_attached_counts"] = {str(k): int(v) for k,v in img.items()}
print("\nIMAGE ATTACHED:", report["image_attached_counts"])

# Description presence
desc_missing = prod["Description"].isna().sum()
print("PRODUCTS missing description:", int(desc_missing), "of", len(prod))

# Category breakdown
print("\n=== PRODUCTS CATEGORIES ===")
print(json.dumps(report["products_categories"], indent=0))

with open("outputs/xlsx_analysis.json","w") as f:
    json.dump(report, f, indent=2)
print("\nSaved outputs/xlsx_analysis.json")
