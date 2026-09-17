"""Correlate the 23 PREprod probes against observed CCRS results.

Facts only:
  - successes read from successful_test_uploads.pdf (10 'Processing Successful' emails)
  - failures read from the 13 returned error CSVs (ErrorMessage column)
No inference about a test we did not observe.
"""
import csv, glob, os, re

import os as _os
# Portable: default to this evidence folder; override with CCRS_EVIDENCE.
WS = _os.environ.get("CCRS_EVIDENCE", _os.path.dirname(_os.path.abspath(__file__)))
ERR = _os.path.join(WS, "errors")

# --- observed successes: parse the file names out of the success email text ---
succ_txt = open(os.path.join(WS, "success-emails-2026-09-17.txt"), encoding="utf-8").read()
succ_files = re.findall(r"The file (\S+\.csv) you submitted has been processed", succ_txt)

# --- observed failures: each returned CSV, with its ErrorMessage values ---
fails = []
for p in sorted(glob.glob(os.path.join(ERR, "*__2026*.csv"))) + sorted(glob.glob(os.path.join(ERR, "Strain_2026*.csv"))):
    base = os.path.basename(p)
    with open(p, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    msgs = []
    for r in rows:
        m = (r.get("ErrorMessage") or "").strip()
        if m and m not in msgs:
            msgs.append(m)
    ext = [(r.get("ExternalIdentifier") or r.get("Strain") or "").strip() for r in rows]
    fails.append((base, len(rows), msgs, ext))

print("=" * 78)
print("OBSERVED SUCCESS EMAILS:", len(succ_files))
for f in succ_files:
    print("   ", f)

print()
print("=" * 78)
print("OBSERVED ERROR FILES:", len(fails))
for base, n, msgs, ext in fails:
    print(f"\n  {base}")
    print(f"    rows returned: {n}   ids: {ext}")
    for m in msgs:
        print(f"    ERROR: {m}")

# --- distinct error vocabulary, which is the real deliverable ---
print()
print("=" * 78)
print("DISTINCT CCRS ERROR STRINGS (verbatim, for the triage table):")
seen = []
for _, _, msgs, _ in fails:
    for m in msgs:
        if m not in seen:
            seen.append(m)
for i, m in enumerate(seen, 1):
    print(f"  {i:2d}. {m}")
print(f"\n  total distinct = {len(seen)}")

# --- returned-column shape per type: does CCRS echo our columns or reorder? ---
print()
print("=" * 78)
print("RETURNED HEADER SHAPE (error files):")
for p in sorted(glob.glob(os.path.join(ERR, "*2026*.csv"))):
    base = os.path.basename(p)
    with open(p, newline="", encoding="utf-8-sig") as fh:
        hdr = next(csv.reader(fh))
    print(f"\n  {base}")
    print(f"    {hdr}")
