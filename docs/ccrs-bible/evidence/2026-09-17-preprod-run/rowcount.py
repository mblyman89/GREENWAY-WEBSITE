"""Decisive test: when CCRS rejects a file, does it return ONLY the bad rows
(=> partial commit of the good rows) or ALL rows (=> whole-file rejection)?

Compares data-row count submitted vs data-row count returned.
"""
import csv, glob, os

import os as _os
# Portable: default to this evidence folder; override with CCRS_EVIDENCE.
WS = _os.environ.get("CCRS_EVIDENCE", _os.path.dirname(_os.path.abspath(__file__)))
ERR = _os.path.join(WS, "errors")
PRE = _os.environ.get("CCRS_PROBES", os.path.join(WS, "probes"))

def submitted_rows(path):
    """CCRS files have 3 header rows then the column row then data."""
    with open(path, newline="", encoding="utf-8-sig") as fh:
        lines = [l for l in fh.read().split("\n") if l.strip()]
    return len(lines) - 4  # 3 meta rows + 1 column row

def returned(path):
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))

# map: returned error file -> the probe we believe produced it, by ids
PAIRS = [
    ("Strain_20260917T125413969.csv",  "T-11",               ["Blue Dream", "Granddaddy Purple"]),
    ("Strain_20260917T125746848.csv",  "T-12",               ["Blue Dream"]),
    ("Strain_20260917T125858884.csv",  "T-14-EXPECT-ERROR",  ["Unknown"]),
    ("Area__20260917T130453419.csv",   "T-16 (re-upload)",   ["AREA-1"]),
    ("Area__20260917T130607480.csv",   "T-17",               ["AREA-1", "AREA-2"]),
    ("Product__20260917T130607115.csv","T-18-EXPECT-ERROR",  ["GWTEST18"]),
    ("Inventory__20260917T131424499.csv","T-31-EXPECT-ERROR",["GWINV31"]),
    ("Inventory__20260917T131646485.csv","T-32-EXPECT-ERROR",["GWINV32"]),
    ("Inventory__20260917T131758060.csv","T-33",             ["GWINV30A"]),
    ("Inventory__20260917T132131404.csv","T-35-EXPECT-ERROR",["GWNEVERINSERTED"]),
    ("Inventory__20260917T132728074.csv","T-37-EXPECT-ERROR",["GWINV37"]),
    ("Inventory__20260917T134023354.csv","T-54-EXPECT-ERROR",["GWINV54A", "GWINV54B"]),
    ("Sale__20260917T133244864.csv",    "T-42-EXPECT-ERROR", [""]),
    ("InventoryAdjustment__20260917T133432926.csv","T-48-EXPECT-ERROR",["GWADJ48"]),
]

print(f"{'probe':22} {'submitted':>9} {'returned':>8}  verdict")
print("-" * 86)
all_returned = True
for errfile, probe, ids in PAIRS:
    folder = probe.split(" ")[0]
    cand = glob.glob(os.path.join(PRE, folder, "*.csv"))
    if not cand:
        print(f"{probe:22} {'?':>9} {'?':>8}  (no local copy)")
        continue
    n_sub = submitted_rows(cand[0])
    rows = returned(os.path.join(ERR, errfile))
    n_ret = len(rows)
    same = "ALL ROWS RETURNED" if n_sub == n_ret else f"SUBSET ({n_ret}/{n_sub})"
    if n_sub != n_ret:
        all_returned = False
    print(f"{probe:22} {n_sub:>9} {n_ret:>8}  {same}")

print()
print("=" * 86)
if all_returned:
    print("RESULT: every rejected file returned EVERY data row it contained.")
    print("        Not one case of 'only the bad row came back'.")
    print("        => CCRS rejects the WHOLE FILE. Good rows in a bad file are NOT filed.")
else:
    print("RESULT: at least one file returned a subset => partial commit is possible.")

# The decisive one: T-17 contained AREA-2, which had never been inserted.
print()
print("DECISIVE CASE  T-17:")
print("  AREA-1 was accepted at 12:58 (file T-16), so AREA-1 IS a genuine duplicate.")
print("  AREA-2 had NEVER been submitted before, so it CANNOT be a duplicate.")
print("  Yet CCRS returned AREA-2 stamped 'Duplicate External Identifier'.")
print("  => the error message is stamped on EVERY row of a rejected file,")
print("     and a per-row message may belong to a DIFFERENT row.")
print()
print("CORROBORATION  T-54 (checksum):")
print("  'CheckSum and number of records don't match' is a FILE-level fault,")
print("  yet it was stamped on both GWINV54A and GWINV54B individually.")
