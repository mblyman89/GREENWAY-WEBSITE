#!/usr/bin/env python3
"""GW-030 sweep inventory — classify every raw <button> and button-styled
element under src/app/admin + src/components/admin (mapping table:
docs/audit/DESIGN-SYSTEM-SPEC.md §3). Read-only; prints per-file counts."""
import os
import re
import sys
from collections import Counter, defaultdict

ROOTS = ["src/app/admin", "src/components/admin"]
counts: Counter = Counter()
by_file: dict = defaultdict(Counter)

BTN_RE = re.compile(r"<button\b[^>]*className=\{?\"([^\"]*)\"", re.S)

def classify(cls: str) -> str:
    if "bg-[var(--admin-purple)]" in cls:
        return "ok-special"
    if "text-white" in cls and ("bg-[#7ed957]" in cls or "bg-[var(--admin-accent)]" in cls):
        return "white-on-green (GW-031)"
    if "bg-[#7ed957]" in cls or "bg-[var(--admin-accent)]" in cls:
        return "green-solid"
    if "bg-[#ffd700]" in cls or "bg-[var(--admin-gold)]" in cls:
        return "gold-solid"
    if "bg-[#ff7f00]" in cls or "bg-[var(--orange)]" in cls or "bg-[var(--admin-orange)]" in cls:
        return "orange-solid"
    if re.search(r"bg-red-[456]00", cls):
        return "tailwind-red"
    if "bg-sky-" in cls or "bg-[#5ec1ff]" in cls:
        return "sky (special)"
    if "bg-fuchsia-" in cls:
        return "fuchsia (special)"
    if re.search(r"border(-| )", cls) and "bg-" not in cls:
        return "ghost/outline"
    if re.search(r"border-white/\d+", cls) and not re.search(r"bg-\[var\(--admin-surface", cls):
        return "ghost/outline"
    return "other"

for root in ROOTS:
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            if not f.endswith(".tsx"):
                continue
            p = os.path.join(dirpath, f)
            src = open(p, encoding="utf-8").read()
            for m in BTN_RE.finditer(src):
                cat = classify(m.group(1))
                counts[cat] += 1
                by_file[p][cat] += 1

print("== Totals ==")
for cat, n in counts.most_common():
    print(f"  {n:4d}  {cat}")
print(f"  total raw <button> with className: {sum(counts.values())}")
print()
print("== Worst files (flagged categories only) ==")
FLAG = {"white-on-green (GW-031)", "green-solid", "gold-solid", "orange-solid",
        "tailwind-red", "sky (special)", "fuchsia (special)", "ghost/outline"}
rows = []
for p, c in by_file.items():
    flagged = sum(v for k, v in c.items() if k in FLAG)
    if flagged:
        rows.append((flagged, p, dict(c)))
rows.sort(reverse=True)
for flagged, p, c in rows[:40]:
    print(f"  {flagged:3d}  {p}  {c}")
print(f"\nfiles with flagged buttons: {len(rows)}")
