"""
scripts/compliance/mutate-fix-p2-5.py

Fix Phase 2.5 (G-14, F-03-1, F-03-3). Rule 13c: a test that cannot fail is
worse than no test. This breaks the bank-deposit clearing door on purpose, one
edit at a time, and demands that the suite NOTICE.

Rule 133g: several mutations SEVER THE DOOR (the action stops calling the
door, the page stops rendering the panel, the door stops calling the poster).
Rule 137: every anchor must match EXACTLY once or the harness fails.

Usage:  python3 scripts/compliance/mutate-fix-p2-5.py
"""
import io
import subprocess
import sys

DCORE = "src/lib/accounting/bank-deposit-door-core.ts"
DOOR = "src/lib/accounting/bank-deposit-door-service.ts"
ACTION = "src/app/admin/books/bank/actions.ts"
PAGE = "src/app/admin/books/bank/page.tsx"
PANEL = "src/components/admin/books/ClearBankDepositsPanel.tsx"
EOD = "src/app/admin/registers/eod/UndepositedFunds.tsx"
CORE = "src/lib/accounting/deposit-clearing-core.ts"
CENSUS = "src/lib/accounting/ledger-census-data.ts"

TESTS = [
    "tests/compliance/fix-p2-5-cash-to-bank.test.ts",
    "tests/compliance/posting-services-are-reachable.test.ts",
    "tests/compliance/deposit-clearing.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    ("1  an ATM account is accepted as the deposit account",
     DCORE, "  if (r !== DEPOSIT_ACCOUNT_ROLE) {", "  if (false && r !== DEPOSIT_ACCOUNT_ROLE) {"),
    ("2  a blank role is accepted",
     DCORE, '  if (r === "") {', '  if (false && r === "") {'),
    ("3  money OUT is listed as a deposit",
     DCORE, '    if (bankDirection(l.amountCents) !== "money_in") continue;', "    // direction check removed"),
    ("4  pending lines are listed",
     DCORE, "    if (l.pending || l.removed) continue;", "    if (l.removed) continue;"),
    ("5  pre-cutover lines are listed",
     DCORE, "    if (!isOnOrAfterCutover(l.date)) continue;", "    // cutover check removed"),
    ("6  cleared lines are never marked",
     DCORE, "      alreadyCleared: cleared.has(l.transactionId),", "      alreadyCleared: false,"),
    ("7  the deposit amount keeps the Plaid sign",
     DCORE, "      depositMinor: -l.amountCents,", "      depositMinor: l.amountCents,"),
    ("8  the event kind becomes a transfer",
     DCORE, 'export const SALES_DEPOSIT_EVENT_KIND = "deposit_of_sales";', 'export const SALES_DEPOSIT_EVENT_KIND = "own_transfer";'),
    ("9  DOOR: the door stops calling the poster",
     DOOR, "  return clearDepositForBankRow(row, SALES_DEPOSIT_EVENT_KIND, { client: admin });",
     '  return refused("DEPOSIT_DISABLED", "off");'),
    ("10 the door ignores the role refusal",
     DOOR, "  if (roleRefusal !== null) return refused(roleRefusal.code, roleRefusal.message);", "  void roleRefusal;"),
    ("11 a failed line read falls through",
     DOOR, "  if (tErr) {\n    return refused(\"DEPOSIT_LINE_UNREADABLE\"",
     "  if (false && tErr) {\n    return refused(\"DEPOSIT_LINE_UNREADABLE\""),
    ("12 a failed account read falls through to a guess",
     DOOR, "  if (aErr) {", "  if (false && aErr) {"),
    ("13 rule 46: a failed journal read is shown as an empty list",
     DOOR, "  if (jErr || !js) {", "  if (false) {"),
    ("14 rule 46: a failed feed read is shown as an empty list",
     DOOR, "  if (txnErr || !txns) {", "  if (false) {"),
    ("15 a blank id is read anyway",
     DOOR, '  if (id === "") {\n    return refused("DEPOSIT_NO_LINE"', '  if (false) {\n    return refused("DEPOSIT_NO_LINE"'),
    ("16 the amount is taken as positive (sign wall)",
     DOOR, "    amountCents: line.amountCents,", "    amountCents: Math.abs(line.amountCents),"),
    ("17 DOOR: the action stops calling the door",
     ACTION, "  const outcome = await clearBankDepositLine(transactionId);",
     '  const outcome: DepositClearOutcome = { kind: "refused", transactionId, code: "X", message: "off" };'),
    ("18 the action is no longer gated (owner-only lost)",
     ACTION, "}): Promise<{ readonly outcome: DepositClearOutcome; readonly sentence: string }> {\n  const session = await requireBooksAccess();",
     "}): Promise<{ readonly outcome: DepositClearOutcome; readonly sentence: string }> {\n  const session = { userId: null };"),
    ("19 the press is not audited",
     ACTION, '    action: "books.bank_deposit.cleared",', '    action: "books.other",'),
    ("20 DOOR: the page stops rendering the panel",
     PAGE, "          <ClearBankDepositsPanel\n", "          <RecordBankExpensesPanel accounts={[]} /><div\n"),
    ("21 the page hides a failed read",
     PAGE, "            readError={depositList.ok ? null : depositList.error}", "            readError={null}"),
    ("22 DOOR: the panel stops calling the action",
     PANEL, "      const r = await clearBankDepositAction({ transactionId: id });",
     '      const r = { outcome: { kind: "refused" }, sentence: "" }; void id;'),
    ("23 F-03-1 regresses: the panel says a drawer close fills 10400",
     EOD, "Sealing a\n            deposit bag moves cash into it", "A drawer\n            close moves cash into it"),
    ("24 F-03-1 regresses: the refusal blames unreconciled drawers",
     CORE, '"this deposit to clear. Either the deposit bags have not been sealed " +',
     '"this deposit to clear. Either the drawer closes have not been " +'),
    ("25 census: the reachable evidence stops naming the real door",
     CENSUS, '"clearBankDepositAction (requireBooksAccess first) calls " +',
     '"a button (requireBooksAccess first) calls " +'),
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
