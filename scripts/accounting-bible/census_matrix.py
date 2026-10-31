#!/usr/bin/env python3
"""Extract the six-layer ledger census matrix from ledger-census-data.ts.

Read-only. Prints a markdown table: key | line | exists | reachable | correct |
accepted | idempotent | married. Run from the repo root:
    python3 scripts/accounting-bible/census_matrix.py
"""
import re

PATH = "src/lib/accounting/ledger-census-data.ts"
LAYERS = ["exists", "reachable", "correct", "accepted", "idempotent", "married"]

lines = open(PATH, encoding="utf-8").read().split("\n")
rows = []
cur = None
pending_layer = None
for i, ln in enumerate(lines, 1):
    m = re.match(r'\s*key:\s*"([^"]+)"', ln)
    if m:
        cur = {"key": m.group(1), "line": i}
        rows.append(cur)
        pending_layer = None
        continue
    if cur is None:
        continue
    lm = re.match(r'\s*(' + "|".join(LAYERS) + r'):\s*\{(.*)', ln)
    if lm:
        pending_layer = lm.group(1)
        rest = lm.group(2)
        sm = re.search(r'status:\s*"([A-Z_]+)"', rest)
        if sm:
            cur.setdefault(pending_layer, sm.group(1))
            pending_layer = None
        continue
    if pending_layer:
        sm = re.search(r'status:\s*"([A-Z_]+)"', ln)
        if sm:
            cur.setdefault(pending_layer, sm.group(1))
            pending_layer = None

print("| # | census key | line | " + " | ".join(LAYERS) + " |")
print("|---|---|---|" + "---|" * len(LAYERS))
for n, r in enumerate(rows, 1):
    print(f"| {n} | `{r['key']}` | :{r['line']} | " +
          " | ".join(r.get(l, "?") for l in LAYERS) + " |")
