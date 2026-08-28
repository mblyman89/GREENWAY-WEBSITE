#!/usr/bin/env python3
"""
mutate-slice-books-88.py  --  can the books-88 tests actually fail?

Standing rule 13c: a test that cannot fail is worse than no test. This slice is
unusually exposed to that rule, because the whole defect it fixes (D-70) WAS a
suite full of passing tests around a feature nobody could reach. So the probe
matters more here than usual, and it deliberately includes the one mutation
that the old gate could not see:

    "nothing calls recordBankExpenses"

If that one survives, this slice has re-created D-70 with extra steps.

Usage:  python3 scripts/compliance/mutate-slice-books-88.py
Exit 0 only if EVERY mutation is caught.
"""
import io
import re
import subprocess
import sys

TESTS = [
    "tests/compliance/posting-services-are-reachable.test.ts",
    "tests/compliance/bank-expense-core.test.ts",
    "tests/compliance/ledger-census.test.ts",
]

ACTION = "src/app/admin/books/bank/actions.ts"
PAGE = "src/app/admin/books/bank/page.tsx"
PANEL = "src/components/admin/books/RecordBankExpensesPanel.tsx"
TRAP = "tests/compliance/posting-services-are-reachable.test.ts"
CENSUS = "src/lib/accounting/ledger-census-data.ts"

MUTATIONS = [
    # ---- THE D-70 MUTATION ITSELF -------------------------------------------
    # Sever the door. This is the exact state the codebase was in before this
    # slice, and the books-84 suite was fully green in that state.
    (
        "the door is severed again -- nothing calls recordBankExpenses (this IS D-70)",
        ACTION,
        "  const result = await recordBankExpenses(accountId);",
        "  const result = { ok: true, scanned: 0, recorded: 0, duplicates: 0, "
        "refused: 0, outcomes: [], error: null };",
    ),
    # ---- the owner gate ------------------------------------------------------
    (
        "the books-access gate is removed entirely, so any signed-in user can write",
        ACTION,
        "  const session = await requireBooksAccess();",
        '  const session = { userId: "anonymous" };',
    ),
    (
        "the gate runs AFTER the write, logging the break-in instead of stopping it",
        ACTION,
        "  const session = await requireBooksAccess();\n\n  const accountId",
        "  const accountId",
    ),
    # ---- the blank-account refusal ------------------------------------------
    (
        "a blank account id is accepted, scanning whatever the service defaults to",
        ACTION,
        '  if (accountId === "") {',
        "  if (false) {",
    ),
    (
        "the blank-account refusal stops promising nothing was written",
        ACTION,
        '"No account was chosen, so nothing was read and nothing was written."',
        '"No account was chosen."',
    ),
    # ---- the audit trail -----------------------------------------------------
    (
        "the run is no longer audited",
        ACTION,
        '    action: "books.bank_expenses.recorded",',
        '    action: "books.bank_expenses.touched",',
    ),
    # ---- the page ------------------------------------------------------------
    (
        "the panel is imported but never rendered (the unused-import defect shape)",
        PAGE,
        "          <RecordBankExpensesPanel accounts={bankChoices} />",
        "          <div />",
    ),
    (
        "the screen stops reading the engine's role map and hard-codes the roles",
        PAGE,
        "        Object.prototype.hasOwnProperty.call(ROLE_TO_CASH_ACCOUNT, "
        "a.role.trim().toLowerCase()),",
        '        (a.role === "main" || a.role === "atm"),',
    ),
    # ---- the panel -----------------------------------------------------------
    (
        "refusals are dropped from the screen, so unmapped vendors vanish silently",
        PANEL,
        '  const refusals = (result?.outcomes ?? []).filter((o) => o.kind === "refused");',
        "  const refusals: typeof result.outcomes = [];",
    ),
    (
        "the owner is no longer pointed at the approvals screen",
        PANEL,
        '              href="/admin/books/drafts"',
        '              href="/admin/books"',
    ),
    # ---- the trap's own guards (a guard that cannot fail is decoration) ------
    (
        "the trap stops excluding the census, so `poster:` strings count as callers",
        TRAP,
        'const NOT_A_CALLER = "src/lib/accounting/ledger-census-data.ts";',
        'const NOT_A_CALLER = "src/lib/accounting/ledger-census-data-RENAMED.ts";',
    ),
    (
        "the trap's source walk is crippled, making 'no caller' unprovable",
        TRAP,
        "const ALL_SOURCE = walk(\"src\");",
        'const ALL_SOURCE = walk("src/lib/atm");',
    ),
    # ---- the census ----------------------------------------------------------
    (
        "the census reverts to naming a poster that no longer exists",
        CENSUS,
        'poster: "src/lib/accounting/bank-expense-service.ts#recordBankExpenses",',
        'poster: "src/lib/accounting/bank-expense-service.ts#recordBankExpensesZZZ",',
    ),
]


def run_tests():
    p = subprocess.run(
        ["npx", "vitest", "run", *TESTS],
        capture_output=True,
        text=True,
    )
    out = p.stdout + p.stderr
    m = re.search(r"Tests\s+(.*)", out)
    return p.returncode, (m.group(1).strip() if m else "no summary line")


def main():
    print("books-88 mutation probe")
    print("=" * 72)

    code, summary = run_tests()
    if code != 0:
        print(f"BASELINE IS ALREADY RED: {summary}")
        return 1
    print(f"baseline green: {summary}\n")

    survivors = []
    for i, (label, path, old, new) in enumerate(MUTATIONS, 1):
        src = io.open(path, encoding="utf-8").read()
        n = src.count(old)
        if n != 1:
            print(f"[{i:2}/{len(MUTATIONS)}] HARNESS BUG: anchor appears {n}x in {path}")
            print(f"          {label}")
            survivors.append(f"{label} (anchor {n}x)")
            continue

        io.open(path, "w", encoding="utf-8").write(src.replace(old, new))
        try:
            code, summary = run_tests()
        finally:
            io.open(path, "w", encoding="utf-8").write(src)

        if code == 0:
            print(f"[{i:2}/{len(MUTATIONS)}] SURVIVED  {label}")
            survivors.append(label)
        else:
            print(f"[{i:2}/{len(MUTATIONS)}] caught    {label}")

    print("=" * 72)
    caught = len(MUTATIONS) - len(survivors)
    print(f"{caught}/{len(MUTATIONS)} caught")
    if survivors:
        print("\nSURVIVORS - the suite cannot tell these apart from correct code:")
        for s in survivors:
            print(f"  - {s}")
        return 1
    print("every mutation was caught.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
