#!/usr/bin/env python3
"""
Build the master STRAINS spreadsheet:
 - Every unique strain found across PRODUCTS + INVENTORIES
 - Strain type (indica/sativa/hybrid) resolved from PRODUCTS 'Type'
 - A description column (blank where unknown) to be filled from trusted sources
 - A 'Source' column to cite where a backfilled description came from
 - Reference effects/flavor columns for enrichment
"""
import pandas as pd
import re
from pathlib import Path
from collections import defaultdict

ROOT = Path("GREENWAY WEBSITE")
DB = ROOT / "database" / "strains"
DB.mkdir(parents=True, exist_ok=True)

prod = pd.read_excel("PRODUCTS.xlsx")
inv = pd.read_excel("INVENTORIES.xlsx")

# Resolve strain -> type from PRODUCTS (most common type per strain)
strain_types = defaultdict(lambda: defaultdict(int))
for _, r in prod[["Strain", "Type"]].dropna().iterrows():
    s = str(r["Strain"]).strip()
    t = str(r["Type"]).strip().lower()
    if s and t:
        strain_types[s][t] += 1

# Collect all strains from both files
all_strains = set()
for s in prod["Strain"].dropna():
    all_strains.add(str(s).strip())
for s in inv["Strain"].dropna():
    all_strains.add(str(s).strip())
all_strains = {s for s in all_strains if s and s.lower() != "nan"}

# Pull a sample description per strain from PRODUCTS (vendor-provided) when present
strain_desc = {}
for _, r in prod[["Strain", "Description"]].dropna().iterrows():
    s = str(r["Strain"]).strip()
    d = str(r["Description"]).strip()
    if s and d and s not in strain_desc:
        strain_desc[s] = d

rows = []
for s in sorted(all_strains, key=lambda x: x.lower()):
    types = strain_types.get(s, {})
    stype = max(types, key=types.get) if types else ""
    rows.append({
        "Strain Name": s,
        "Strain Type": stype.capitalize() if stype else "",
        "Vendor Description (from PRODUCTS)": strain_desc.get(s, ""),
        "Trusted Description (fill gaps)": "",
        "Description Source / Citation": "",
        "Dominant Terpenes": "",
        "Common Effects": "",
        "Flavor / Aroma": "",
        "Lineage / Genetics": "",
        "Notes": "",
    })

df = pd.DataFrame(rows)
out_xlsx = DB / "STRAINS_MASTER.xlsx"
with pd.ExcelWriter(out_xlsx, engine="xlsxwriter") as writer:
    df.to_excel(writer, index=False, sheet_name="Strains")
    ws = writer.sheets["Strains"]
    widths = [28, 14, 60, 60, 30, 22, 26, 26, 28, 30]
    for i, w in enumerate(widths):
        ws.set_column(i, i, w)

df.to_csv(DB / "STRAINS_MASTER.csv", index=False)

filled = sum(1 for r in rows if r["Strain Type"])
print(f"Total unique strains: {len(rows)}")
print(f"Strains with a resolved type: {filled}")
print(f"Strains with a vendor description: {sum(1 for r in rows if r['Vendor Description (from PRODUCTS)'])}")
print(f"Wrote {out_xlsx}")
