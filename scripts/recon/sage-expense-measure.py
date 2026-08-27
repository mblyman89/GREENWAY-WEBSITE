#!/usr/bin/env python3
"""
books-73 recon: measure Michael's real Sage chart of accounts and his four
COA-tagged expense exports.

Rule 1: measure, never guess. Rule 48: a check that cannot classify must fail,
never skip. Money is parsed with Decimal and converted to integer cents with
ROUND_HALF_UP, never float.

Run from repo root:
    python3 scripts/recon/sage-expense-measure.py
"""
import csv
import io
import os
from collections import Counter, defaultdict
from decimal import Decimal, ROUND_HALF_UP

WS = ".."

COA = "Chart_of_Accounts_From_Sage.csv"
EXPENSE_FILES = [
    "ACCT_6048_ELECTRONIC_PURCHASES_1.12.26-4.3.26.csv",
    "ACCT_6048_ELECTRONIC_PURCHASES_8.20.25-12.19.25.csv",
    "MASTER_CARD_X7977_2025.csv",
    "MASTER_CARD_X7977_2024.csv",
    "X6048_3.20.24-1.17.25.csv",
]


def cents(raw):
    """Money -> integer cents, or None if unparseable. Never guesses."""
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


def rows(path):
    with io.open(os.path.join(WS, path), encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


# ------------------------------------------------------------------ the chart
print("=" * 72)
print("SAGE CHART OF ACCOUNTS")
print("=" * 72)
coa = rows(COA)
print(f"rows: {len(coa)}")
hdr = list(coa[0].keys())
print(f"columns: {hdr}")

EXPECT = ["Account ID", "Account Description", "Active?", "Account Type"]
if hdr != EXPECT:
    print("HEADER DRIFT -- refusing to interpret. Rule 48.")
    raise SystemExit(1)

by_type = Counter()
suffixes = Counter()
inactive = 0
accounts = {}
for r in coa:
    aid = (r["Account ID"] or "").strip()
    if not aid:
        continue
    by_type[(r["Account Type"] or "").strip()] += 1
    if (r["Active?"] or "").strip().lower() != "yes":
        inactive += 1
    if "-" in aid:
        suffixes[aid.rsplit("-", 1)[1]] += 1
    else:
        suffixes["(none)"] += 1
    accounts[aid] = {
        "desc": (r["Account Description"] or "").strip(),
        "type": (r["Account Type"] or "").strip(),
        "active": (r["Active?"] or "").strip(),
    }

print(f"distinct account IDs: {len(accounts)}")
print(f"inactive: {inactive}")
print("\nENTITY SUFFIXES (this is how Sage separates the entities):")
for s, n in suffixes.most_common():
    print(f"  {s:<12} {n}")
print("\nACCOUNT TYPES:")
for t, n in by_type.most_common():
    print(f"  {t:<28} {n}")

# ------------------------------------------------------------ expense exports
print()
print("=" * 72)
print("EXPENSE EXPORTS")
print("=" * 72)

gl_totals = defaultdict(int)
gl_counts = Counter()
vendor_totals = defaultdict(int)
cash_accounts = Counter()
unparseable = []
grand = 0
grand_rows = 0
dates = []

for path in EXPENSE_FILES:
    rs = rows(path)
    # Header case differs between files (VENDOR ID vs Vendor ID). Normalise by
    # lowercasing keys, and REFUSE if a required column is absent.
    total = 0
    bad = 0
    for i, r in enumerate(rs, start=2):
        low = {(k or "").strip().lower(): v for k, v in r.items()}
        for req in ("g/l account", "amount", "date"):
            if req not in low:
                print(f"  {path}: MISSING COLUMN '{req}' -- refusing. Rule 48.")
                raise SystemExit(1)
        amt = cents(low["amount"])
        if amt is None:
            bad += 1
            unparseable.append((path, i, low.get("amount")))
            continue
        gl = (low["g/l account"] or "").strip()
        if gl == "":
            bad += 1
            unparseable.append((path, i, "BLANK G/L"))
            continue
        gl_totals[gl] += amt
        gl_counts[gl] += 1
        vendor_totals[(low.get("vendor name") or "").strip()] += amt
        cash_accounts[(low.get("cash account") or "").strip()] += 1
        d = (low["date"] or "").strip()
        if d:
            dates.append(d)
        total += amt
    grand += total
    grand_rows += len(rs)
    print(f"{path}")
    print(f"    data rows {len(rs):>4}   total {money(total):>14}   unparseable {bad}")

print(f"\nGRAND TOTAL {money(grand)} across {grand_rows} rows")
if unparseable:
    print(f"UNPARSEABLE ROWS: {len(unparseable)}")
    for u in unparseable[:10]:
        print("   ", u)
else:
    print("every row parsed: 0 unparseable")

# ------------------------------------------------------- the mapping question
print()
print("=" * 72)
print("DISTINCT G/L ACCOUNTS USED (this is the mapping surface)")
print("=" * 72)
print(f"distinct G/L accounts: {len(gl_totals)}")
print()
print(f"{'sage acct':<16}{'n':>5}  {'total':>13}  description (from the chart)")
for gl in sorted(gl_totals, key=lambda g: -abs(gl_totals[g])):
    known = accounts.get(gl)
    desc = f"{known['desc']} [{known['type']}]" if known else "*** NOT IN CHART ***"
    print(f"{gl:<16}{gl_counts[gl]:>5}  {money(gl_totals[gl]):>13}  {desc}")

missing = [g for g in gl_totals if g not in accounts]
print(f"\nG/L accounts used but NOT in the chart: {len(missing)}")
for m in missing:
    print(f"   {m}  ({gl_counts[m]} rows, {money(gl_totals[m])})")

# ---------------------------------------------------------------- cash side
print()
print("=" * 72
      )
print("CASH / CARD ACCOUNTS THESE WERE PAID FROM")
print("=" * 72)
for a, n in cash_accounts.most_common():
    known = accounts.get(a)
    desc = f"{known['desc']} [{known['type']}]" if known else "*** NOT IN CHART ***"
    print(f"  {a:<16}{n:>5}  {desc}")

# ---------------------------------------------------------------- top vendors
print()
print("=" * 72)
print("TOP 20 VENDORS BY SPEND")
print("=" * 72)
for v, c in sorted(vendor_totals.items(), key=lambda kv: -abs(kv[1]))[:20]:
    print(f"  {money(c):>13}  {v}")

print()
print("date strings seen:", len(dates), "| earliest/latest by string sort:",
      min(dates) if dates else "-", "/", max(dates) if dates else "-")
print("(string sort is NOT chronological for M/D/YYYY -- stated, not relied on)")
