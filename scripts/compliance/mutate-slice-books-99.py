#!/usr/bin/env python3
"""
scripts/compliance/mutate-slice-books-99.py

Rule 13c: a test that cannot fail is worse than no test. This breaks the
books-99 shop-card slice on purpose, one edit at a time, and demands that the
suite NOTICE. A surviving mutation is a hole in the tests, not a win.

WHY THIS SLICE NEEDS ITS OWN PROBE
----------------------------------
D-78 is the most dangerous shape of bug this codebase keeps producing: THE
ENTRY STILL BALANCES. Paying the card bill from checking classified cleanly on
its merchant text and posted a perfectly balanced expense. Debits equalled
credits, the bank reconciled, and every card purchase was counted twice.

Four families of risk, none visible to a balance check:

  * THE GUARD GOING AWAY. If the card bill can reach the classifier again, the
    double count is back exactly as it was. Nothing turns red.

  * THE GUARD BEING TOO GREEDY. If it swallows interest, or ordinary swipes, a
    real deductible expense silently disappears. On a 280E return, where the
    deductible side is already thin, deleting deductions is the more expensive
    direction to be wrong in - and it is invisible, because a missing expense
    leaves no evidence of itself.

  * THE TRANSFER POINTING THE WRONG WAY. Debit and credit swapped still
    balances; it just makes the card balance GROW every time it is paid.

  * THE MIRROR BEING BOOKED. The same payment arrives on both feeds with
    opposite signs. Book both and the liability is paid down twice - the very
    double count, re-entering from the other end.

Rule 133g: at least one mutation must SEVER THE DOOR. The door here is the
category column in the service's SELECT. If the column is not read, the guard
sees `undefined` for every row, and D-78 is fully restored while every unit
test still passes on hand-built inputs. Mutations 13 and 14 cut exactly there.

Rule 137: an ambiguous anchor is not a probe. The harness requires EXACTLY ONE
match for every anchor and FAILS otherwise.

Usage:  python3 scripts/compliance/mutate-slice-books-99.py
"""
import io
import subprocess
import sys

CARD = "src/lib/accounting/card-payment-core.ts"
EXP = "src/lib/accounting/bank-expense-core.ts"
SVC = "src/lib/accounting/bank-expense-service.ts"

TESTS = [
    "tests/compliance/card-payment.test.ts",
    "tests/compliance/bank-expense-core.test.ts",
    # The door. Without this file mutations 13-15 survive: the guard is correct
    # and simply never reached, which is D-78 restored in full.
    "tests/compliance/bank-expense-service-card.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # ── THE GUARD GOING AWAY: D-78 restored ──────────────────────────────────
    ("1  the card bill reaches the classifier again (D-78, verbatim)",
     EXP,
     "  if (isCardPaymentCategory(line.categoryDetailed)) {",
     "  if (false) {",),

    ("2  the guard only stops OUTflows, so the card-side mirror gets expensed",
     EXP,
     "  if (isCardPaymentCategory(line.categoryDetailed)) {",
     "  if (isCardPaymentCategory(line.categoryDetailed) && line.amountCents > 0) {",),

    ("3  the guard refuses but with a code no screen knows",
     EXP,
     '      code: "CARD_PAYMENT_NOT_AN_EXPENSE",',
     '      code: "NOT_AN_OUTFLOW",',),

    ("4  the refusal code is dropped from the exported list",
     EXP,
     '  "CARD_PAYMENT_NOT_AN_EXPENSE",\n] as const;',
     "] as const;",),

    # ── THE GUARD BEING TOO GREEDY: real deductions vanish ───────────────────
    ("5  interest is swallowed as a transfer, deleting a real expense",
     CARD,
     'export const CARD_INTEREST_CATEGORY = "BANK_FEES_INTEREST_CHARGE";',
     'export const CARD_INTEREST_CATEGORY = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";',),

    ("6  the category match becomes a prefix, catching every LOAN_PAYMENTS row",
     CARD,
     "  return categoryDetailed.trim().toUpperCase() === CARD_PAYMENT_CATEGORY;",
     "  return categoryDetailed.trim().toUpperCase().startsWith(\"LOAN_PAYMENTS\");",),

    ("7  a null category is treated as a card payment",
     CARD,
     "  if (categoryDetailed === null || categoryDetailed === undefined) return false;",
     "  if (categoryDetailed === null || categoryDetailed === undefined) return true;",),

    # ── THE TRANSFER POINTING THE WRONG WAY (still balances) ─────────────────
    ("8  the transfer is reversed: paying the bill GROWS the card balance",
     CARD,
     "  const liabilityLedgerCents = -cashLedgerCents;",
     "  const liabilityLedgerCents = cashLedgerCents;\n  const cashLedgerCents2 = -cashLedgerCents;\n  void cashLedgerCents2;",),

    ("9  the transfer credits the ATM account instead of operating",
     CARD,
     'export const OPERATING_ACCOUNT = "10200";',
     'export const OPERATING_ACCOUNT = "10300";',),

    ("10 the transfer hits an expense account, which is the whole bug",
     CARD,
     'export const CARD_LIABILITY_ACCOUNT = "33000";',
     'export const CARD_LIABILITY_ACCOUNT = "76040";',),

    # ── THE MIRROR BEING BOOKED TWICE ────────────────────────────────────────
    ("11 the card-side mirror is booked instead of declined",
     CARD,
     '  if (role === "credit") {',
     "  if (false) {",),

    ("12 money coming IN posts a backwards entry instead of declining",
     CARD,
     "  if (line.amountCents < 0) {",
     "  if (false) {",),

    # ── THE DOOR (rule 133g): the category never leaves the database ─────────
    ("13 DOOR: the service stops selecting the category column",
     SVC,
     '"transaction_id,amount_cents,date,merchant_name,name,pending,personal_finance_category_detailed",',
     '"transaction_id,amount_cents,date,merchant_name,name,pending",',),

    ("14 DOOR: the category is read but never handed to the core",
     SVC,
     "      categoryDetailed: row.personal_finance_category_detailed,",
     "      categoryDetailed: null,",),

    ("15 DOOR: the transfer is planned but never submitted",
     SVC,
     '    if (card.kind === "transfer") {',
     "    if (false) {",),

    # ── SMALLER CUTS THAT STILL COST MONEY ───────────────────────────────────
    ("16 the entry loses its transaction key, so re-running duplicates it",
     CARD,
     "      sourceRef: `card-payment:${line.transactionId}`,",
     "      sourceRef: null,",),

    ("17 a zero-dollar payment posts an empty entry",
     CARD,
     "  if (!Number.isInteger(line.amountCents) || line.amountCents === 0) {",
     "  if (!Number.isInteger(line.amountCents)) {",),

    ("18 fractional cents are allowed through",
     CARD,
     "  if (!Number.isInteger(line.amountCents) || line.amountCents === 0) {",
     "  if (line.amountCents === 0) {",),

    ("19 the transfer lines carry a 280E class they have no business carrying",
     CARD,
     '      costClass: "none",\n      description: "Shop card balance paid down",',
     '      costClass: "nondeductible_280e",\n      description: "Shop card balance paid down",',),

    ("20 the purchase side stops crediting the card liability",
     EXP,
     '  credit: "33000",',
     '  credit: "10200",',),
]


def run_tests() -> bool:
    proc = subprocess.run(
        ["./node_modules/.bin/vitest", "run", *TESTS],
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    caught, survived = 0, []

    for label, path, find, repl in MUTATIONS:
        original = io.open(path, encoding="utf-8").read()
        hits = original.count(find)
        # Rule 137: exactly one, or this is not a probe. Zero means the anchor
        # went stale; more than one means the probe may be cutting somewhere
        # other than where its label claims.
        if hits != 1:
            print(f"  ERROR  {label}")
            print(f"         anchor matched {hits} times in {path}; expected exactly 1")
            print("         FAILING rather than skipping (rules 48, 137).")
            return 2

        io.open(path, "w", encoding="utf-8").write(original.replace(find, repl, 1))
        try:
            if run_tests():
                survived.append(label)
                print(f"  SURVIVED  {label}")
            else:
                caught += 1
                print(f"  caught    {label}")
        finally:
            io.open(path, "w", encoding="utf-8").write(original)

    total = len(MUTATIONS)
    print(f"\n{caught}/{total} mutations caught")
    if survived:
        print("\nSURVIVORS (these are holes in the tests):")
        for s in survived:
            print(f"  - {s}")
        return 1
    print("Every deliberate break was noticed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
