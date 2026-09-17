"""Build the observed upload timeline and test the 'partial commit' hypothesis.

Success times come from the success emails ('Date Submitted').
Failure times come from the returned error CSV file names (…_20260917THHMMSSmmm.csv).
Only observed values are used.
"""
import re, glob, os
from datetime import datetime

import os as _os
# Portable: default to this evidence folder; override with CCRS_EVIDENCE.
WS = _os.environ.get("CCRS_EVIDENCE", _os.path.dirname(_os.path.abspath(__file__)))
ERR = _os.path.join(WS, "errors")

SUCCESS = [  # (file as CCRS reported it, Date Submitted) -- read from successful.txt
    ("Strain_413541_20250615213000_2026917T1252497.csv", "12:52:20"),
    ("Area_413541_20250615213000_2026917T1258161.csv", "12:58:04"),
    ("Product_413541_20250615213000_2026917T137959.csv", "13:06:12"),
    ("Product_413541_20250615213000_2026917T138506.csv", "13:07:18"),
    ("Product_413541_20250615213000_2026917T139174.csv", "13:08:47"),
    ("Inventory_413541_20250615213000_2026917T1313488.csv", "13:12:22"),
    ("Inventory_413541_20250615213000_2026917T1315379.csv", "13:14:36"),
    ("Inventory_413541_20250615213000_2026917T1319595.csv", "13:18:15"),
    ("Sale_413541_20250615213000_2026917T133072.csv", "13:30:06"),
    ("InventoryAdjustment_413541_20250615213000_2026917T1336807.csv", "13:35:44"),
]

events = []
for name, t in SUCCESS:
    typ = name.split("_")[0]
    events.append((datetime.strptime(t, "%H:%M:%S"), typ, "ACCEPTED", name, ""))

import csv as _csv
for p in sorted(glob.glob(os.path.join(ERR, "*2026091*.csv"))):
    base = os.path.basename(p)
    m = re.search(r"_?20260917T(\d{2})(\d{2})(\d{2})", base)
    if not m:
        continue
    typ = base.split("_")[0]
    with open(p, newline="", encoding="utf-8-sig") as fh:
        rows = list(_csv.DictReader(fh))
    msg = ""
    ids = []
    for r in rows:
        msg = msg or (r.get("ErrorMessage") or "").strip()
        ids.append((r.get("ExternalIdentifier") or r.get("Strain") or "?").strip())
    ts = datetime.strptime(f"{m.group(1)}:{m.group(2)}:{m.group(3)}", "%H:%M:%S")
    events.append((ts, typ, "REJECTED", f"{msg}", ",".join(ids)))

events.sort(key=lambda e: e[0])

print(f"{'time':9} {'type':20} {'verdict':9} detail")
print("-" * 110)
prev = None
for ts, typ, verdict, detail, ids in events:
    gap = ""
    if prev:
        d = (ts - prev).total_seconds() / 60.0
        gap = f"(+{d:.1f}m)"
    prev = ts
    d = detail if len(detail) < 58 else detail[:55] + "..."
    print(f"{ts.strftime('%H:%M:%S')} {typ:20} {verdict:9} {d:58} {ids} {gap}")

print()
print("=" * 110)
print("GROUP GAP CHECK (the 10-minute rule [G L0530]):")
g1_last = datetime.strptime("13:08:47", "%H:%M:%S")   # last Group-1 accept (Product)
g2_first = datetime.strptime("13:12:22", "%H:%M:%S")  # first Group-2 accept (Inventory)
print(f"  last accepted Group 1 (Product)  13:08:47")
print(f"  first accepted Group 2 (Inventory) 13:12:22")
print(f"  observed gap = {(g2_first-g1_last).total_seconds()/60:.1f} minutes  << 10 minutes")
print("  -> Inventory was ACCEPTED anyway. The 10-minute wait was NOT enforced on this run.")

g2_last = datetime.strptime("13:18:15", "%H:%M:%S")
g3_first = datetime.strptime("13:30:06", "%H:%M:%S")
print(f"  Group 2 -> Group 3 gap = {(g3_first-g2_last).total_seconds()/60:.1f} minutes (>= 10)")
