#!/usr/bin/env python3
"""
books-73 recon, second pass: the entity suffixes, and cross-entity payments.

Two things the first pass surfaced and would not interpret without measuring:
  1. GRNWY (127) and GRWNY (18) both appear. One is very likely a transposition
     typo of the other, but "likely" is not measurement, so this prints both
     lists in full and lets the reader see.
  2. Accounts suffixed LYMAN are being paid out of a GREENWAY cash account.
     That is a cross-entity payment and it is exactly the open D-41 question.

Run from repo root:
    python3 scripts/recon/sage-suffix-check.py
"""
import csv
import io
import os
from collections import Counter, defaultdict
from decimal import Decimal, ROUND_HALF_UP

WS = ".."
EXPENSE_FILES = [
    "ACCT_6048_ELECTRONIC_PURCHASES_1.12.26-4.3.26.csv",
    "ACCT_6048_ELECTRONIC_PURCHASES_8.20.25-12.19.25.csv",
    "MASTER_CARD_X7977_2025.csv",
    "MASTER_CARD_X7977_2024.csv",
    "X6048_3.20.24-1.17.25.csv",
]


def cents(raw):
    s = (raw or "").strip().replace("$", "").replace(",", "")
    if s == "":
        return None
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1]
    try:
        d = Decimal(s)
    except Exception:
        return None
    if neg:
        d = -d
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def money(c):
    return f"${c / 100:,.2f}"


def rows(p):
    with io.open(os.path.join(WS, p), encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


coa = rows("Chart_of_Accounts_From_Sage.csv")
by_suffix = defaultdict(list)
for r in coa:
    aid = (r["Account ID"] or "").strip()
    if not aid:
        continue
    suf = aid.rsplit("-", 1)[1] if "-" in aid else "(none)"
    by_suffix[suf].append((aid, (r["Account Description"] or "").strip(),
                           (r["Account Type"] or "").strip()))

print("=" * 72)
print("THE TWO SIMILAR SUFFIXES, PRINTED IN FULL")
print("=" * 72)
for suf in ("GRNWY", "GRWNY", "GRWYE", "LYMAN", "(none)"):
    lst = by_suffix.get(suf, [])
    print(f"\n--- {suf}  ({len(lst)} accounts)")
    if suf == "GRNWY":
        print("    (127 accounts -- showing numeric-prefix ranges only)")
        pref = Counter(a.split("-")[0][:2] for a, _, _ in lst)
        for p, n in sorted(pref.items()):
            print(f"      {p}xxx  {n}")
        continue
    for aid, desc, typ in lst:
        print(f"      {aid:<16} {desc:<38} [{typ}]")

# Do the numeric prefixes of GRWNY collide with GRNWY? If the same number
# exists under both suffixes, they are DIFFERENT accounts in Sage even though
# one is probably a typo -- and that matters for mapping.
grnwy_nums = {a.split("-")[0] for a, _, _ in by_suffix.get("GRNWY", [])}
grwny_nums = {a.split("-")[0] for a, _, _ in by_suffix.get("GRWNY", [])}
print()
print("=" * 72)
print("DO THE NUMBERS COLLIDE?")
print("=" * 72)
print(f"GRNWY account numbers: {len(grnwy_nums)}")
print(f"GRWNY account numbers: {len(grwny_nums)}")
both = sorted(grnwy_nums & grwny_nums)
print(f"numbers present under BOTH suffixes: {len(both)}")
for n in both:
    g = next(d for a, d, _ in by_suffix["GRNWY"] if a.split("-")[0] == n)
    w = next(d for a, d, _ in by_suffix["GRWNY"] if a.split("-")[0] == n)
    print(f"   {n}:  GRNWY='{g}'   GRWNY='{w}'")
if not both:
    print("   none -- the two suffixes hold DISJOINT account numbers.")

# ------------------------------------------------- cross-entity cash movement
print()
print("=" * 72)
print("CROSS-ENTITY PAYMENTS: whose expense, paid from whose cash")
print("=" * 72)
pairs = defaultdict(lambda: [0, 0])  # (cash_suffix, gl_suffix) -> [n, cents]
lyman_detail = defaultdict(lambda: [0, 0])
for path in EXPENSE_FILES:
    for r in rows(path):
        low = {(k or "").strip().lower(): v for k, v in r.items()}
        amt = cents(low.get("amount"))
        gl = (low.get("g/l account") or "").strip()
        cash = (low.get("cash account") or "").strip()
        if amt is None or not gl or not cash:
            continue
        gs = gl.rsplit("-", 1)[1] if "-" in gl else "(none)"
        cs = cash.rsplit("-", 1)[1] if "-" in cash else "(none)"
        k = (cs, gs)
        pairs[k][0] += 1
        pairs[k][1] += amt
        if gs == "LYMAN":
            lyman_detail[gl][0] += 1
            lyman_detail[gl][1] += amt

print(f"{'cash entity':<14}{'expense entity':<16}{'n':>5}  {'total':>14}")
for (cs, gs), (n, c) in sorted(pairs.items(), key=lambda kv: -abs(kv[1][1])):
    flag = "  <-- CROSS-ENTITY" if cs != gs else ""
    print(f"{cs:<14}{gs:<16}{n:>5}  {money(c):>14}{flag}")

print()
print("The LYMAN-suffixed expenses paid from Greenway cash, by account:")
tot = 0
for gl, (n, c) in sorted(lyman_detail.items(), key=lambda kv: -abs(kv[1][1])):
    desc = next((d for a, d, _ in by_suffix.get("LYMAN", []) if a == gl), "?")
    print(f"   {gl:<16}{n:>4}  {money(c):>13}  {desc}")
    tot += c
print(f"   {'TOTAL':<16}{'':>4}  {money(tot):>13}")

# --------------------------------------------- how Sage classifies owner money
print()
print("=" * 72)
print("HOW SAGE ALREADY CLASSIFIES OWNER MONEY (the D-41 evidence)")
print("=" * 72)
for aid, desc, typ in sorted(by_suffix.get("GRNWY", [])):
    n = aid.split("-")[0]
    if n.startswith("41") or n.startswith("36") or n.startswith("40"):
        print(f"   {aid:<16} {desc:<38} [{typ}]")
