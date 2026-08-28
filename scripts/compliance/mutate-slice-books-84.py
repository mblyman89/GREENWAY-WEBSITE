#!/usr/bin/env python3
"""
Mutation probe for books-84 (the bank-feed expense wire, D-56 / D-37).

A test that cannot fail is worse than no test (standing rule 13c/13d). This
breaks the logic on purpose, one defect at a time, and asserts the suite
NOTICES. Every mutation below is a mistake a competent person could actually
make -- and, critically, every one of them still BALANCES, which is why the
suite is the only thing that would catch it.

Usage:  python3 scripts/compliance/mutate-slice-books-84.py
"""

import re
import shutil
import subprocess
import sys

CORE = "src/lib/accounting/bank-expense-core.ts"
SERVICE = "src/lib/accounting/bank-expense-service.ts"
SUITE = "tests/compliance/bank-expense-core.test.ts"

# (label, file, old, new, why it matters)
MUTATIONS = [
    (
        "M1: treat a NEGATIVE Plaid amount as the expense (sign inverted)",
        CORE,
        "  if (line.amountCents < 0) {",
        "  if (line.amountCents > 0 && false) {",
        "Every refund and deposit books as an expense. Still balances.",
    ),
    (
        "M2: flip the two lines (credit the expense, debit the cash)",
        CORE,
        "    amountCents: line.amountCents,\n    costClass: classification.costClass,",
        "    amountCents: -line.amountCents,\n    costClass: classification.costClass,",
        "Expenses become negative. Debits still equal credits.",
    ),
    (
        "M3: default an unmapped role to the operating account",
        CORE,
        '  const mapped = ROLE_TO_CASH_ACCOUNT[role];\n  if (!mapped) {',
        '  const mapped = ROLE_TO_CASH_ACCOUNT[role] ?? "10200";\n  if (!mapped) {',
        "A typed custom role silently funds from Timberland operating.",
    ),
    (
        "M4: default an UNASSIGNED role instead of refusing",
        CORE,
        '  if (!role) {\n    return {\n      ok: false,\n      code: "CASH_ACCOUNT_UNASSIGNED",',
        '  if (false) {\n    return {\n      ok: false,\n      code: "CASH_ACCOUNT_UNASSIGNED",',
        "An unconfigured account posts anyway.",
    ),
    (
        "M5: put the 280E class on the balance-sheet line too",
        CORE,
        '    costClass: "none",\n    description: merchant,',
        "    costClass: classification.costClass,\n    description: merchant,",
        "Migration 0172 check (7) refuses the post; caught locally instead.",
    ),
    (
        "M6: post pending rows",
        CORE,
        "  if (line.pending) {",
        "  if (line.pending && false) {",
        "Books an amount that is about to change, then duplicates on settle.",
    ),
    (
        "M7: allow a personal charge on a business account",
        CORE,
        '  if (classification.entity === "personal" && cash.accountCode !== "33000") {',
        '  if (false && classification.entity === "personal") {',
        "Personal spend lands on a 280E return as a business expense.",
    ),
    (
        "M8: ignore the chart's entity restriction on the funding account",
        CORE,
        "  if (allowed && !allowed.includes(classification.entity)) {",
        "  if (false && allowed) {",
        "Landholding expense funded from the ATM vault account.",
    ),
    (
        "M9: swallow the classifier's refusal and post anyway",
        CORE,
        "  if (!classification.ok) {",
        "  if (!classification.ok && false) {",
        "An unknown merchant would post to undefined. No fallback is correct.",
    ),
    (
        "M10: use a non-stable source ref (breaks idempotency)",
        CORE,
        "    sourceRef: line.transactionId,",
        "    sourceRef: `${line.transactionId}-${line.date}`,",
        "A re-run double-books everything. Each entry balances.",
    ),
    (
        "M11: post as 'manual' instead of 'bank'",
        SERVICE,
        "        sourceKind: BANK_SOURCE_KIND,",
        '        sourceKind: "manual",',
        "0172 check (6) refuses every entry: GL_CONTROL_ACCOUNT.",
    ),
    (
        "M12: stop calling the ledger (import stays, call goes)",
        SERVICE,
        "    const result = await submitJournal(",
        "    const result = await Promise.resolve(FAKE_OK); void submitJournal; void (",
        "The exact shape of D-56/D-37: finished code, never invoked.",
    ),
]


def run_suite():
    out = subprocess.run(
        ["npx", "vitest", "run", SUITE],
        capture_output=True, text=True,
    )
    combined = out.stdout + out.stderr
    m = re.search(r"Tests\s+(.*)", combined)
    return out.returncode, (m.group(1).strip() if m else "NO TEST LINE FOUND")


def main():
    print("baseline")
    rc, line = run_suite()
    if rc != 0:
        print(f"  ABORT: suite is not green before mutating -> {line}")
        return 1
    print(f"  green: {line}\n")

    caught, survived = 0, []
    for label, path, old, new, why in MUTATIONS:
        backup = path + ".bak"
        shutil.copyfile(path, backup)
        try:
            src = open(path).read()
            if src.count(old) != 1:
                print(f"{label}\n  SKIP-FAIL: anchor found {src.count(old)}x, expected 1")
                survived.append(label + " (anchor drift)")
                continue
            open(path, "w").write(src.replace(old, new))
            rc, line = run_suite()
            if rc != 0:
                caught += 1
                print(f"{label}\n  CAUGHT  ({line})\n  why: {why}")
            else:
                survived.append(label)
                print(f"{label}\n  *** SURVIVED *** ({line})\n  why: {why}")
        finally:
            shutil.move(backup, path)

    # Prove we restored cleanly.
    rc, line = run_suite()
    print(f"\nrestored: rc={rc} {line}")
    if rc != 0:
        print("  ERROR: suite not green after restore -- files may be dirty")
        return 1

    print(f"\n{caught}/{len(MUTATIONS)} caught")
    if survived:
        print("SURVIVORS:")
        for s in survived:
            print(f"  - {s}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
