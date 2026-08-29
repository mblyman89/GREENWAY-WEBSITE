#!/usr/bin/env python3
"""
scripts/compliance/mutate-slice-books-95.py

Rule 13c: a test that cannot fail is worse than no test. This breaks the
books-95 deposit-clearing slice on purpose, one edit at a time, and demands
that the suite NOTICE. A surviving mutation is a hole in the tests, not a win.

WHY THIS SLICE NEEDS A PROBE MORE THAN MOST
-------------------------------------------
A wrongly-signed bank match still BALANCES. There is no error, no red screen,
no out-of-balance warning -- the books simply say the opposite of the truth,
and this business has already had backwards card signs once in Sage (rule 19).
The only thing standing between a sign flip and a silently wrong balance sheet
is a test that fails when the sign flips. So the first mutations here flip
signs, swap the two accounts, and delete the negation, and every one of them
must be caught by an assertion about DIRECTION, not merely about balance.

Rule 133g: at least one mutation must SEVER THE DOOR. The door here is the
end-of-day page showing the Undeposited Funds balance. books-93 shipped
builders nobody could reach; cutting the panel out must be loud.

Rule 137: an ambiguous anchor is not a probe. In books-94 a probe cut the
WRONG action's guard because five lines shared its shape, and it "survived"
for a reason that had nothing to do with the test suite. So this harness
requires EXACTLY ONE match for every anchor and fails otherwise.

books-96 UPDATED NINE ANCHORS IN THIS FILE. The code they cut changed shape:
the single lumped credit to 10400 became one credit per business day, and the
scalar `undepositedBalanceMinor` / `oldestUndepositedDate` pair became a list
of days. The RISKS are identical, so the probes were re-pointed rather than
deleted - a probe quietly dropped because its anchor went stale is a hole that
looks like a clean run. The harness fails on a stale anchor for that reason.

Probe 24 changed MEANING, not just shape: clearing cash older than the window
used to be a refusal and is now a warning that posts, by the owner's explicit
decision. Cutting the guard must now be caught by the absence of the WARNING.

Usage:  python3 scripts/compliance/mutate-slice-books-95.py
"""
import io
import subprocess
import sys

CORE = "src/lib/accounting/deposit-clearing-core.ts"
SERVICE = "src/lib/accounting/deposit-clearing-service.ts"
PANEL = "src/app/admin/registers/eod/UndepositedFunds.tsx"
PAGE = "src/app/admin/registers/eod/page.tsx"

# The two journal lines, quoted exactly. This is the sign wall in source form:
# +depositMinor to the bank (a debit), -depositMinor to Undeposited Funds (a
# credit). Everything downstream of these ten lines is commentary.
BANK_LINE = """    {
      lineNo: 1,
      accountCode: BANK_OPERATING_ACCOUNT,
      amountCents: depositMinor,"""

# books-96: the credit is now emitted once per banked day, so the anchor is the
# mapping expression rather than a literal object.
UNDEPOSITED_LINE = """      amountCents: -d.appliedMinor,"""

TESTS = [
    "tests/compliance/deposit-clearing.test.ts",
    "tests/compliance/bank-match-core.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # ── THE SIGN WALL ────────────────────────────────────────────────────────
    ("1  the bank leg is credited instead of debited (deposit reads as a payment)",
     CORE,
     BANK_LINE,
     BANK_LINE.replace("amountCents: depositMinor,", "amountCents: -depositMinor,")),

    ("2  Undeposited Funds is debited instead of credited (the pool grows on a deposit)",
     CORE,
     UNDEPOSITED_LINE,
     "      amountCents: d.appliedMinor,"),

    ("3  the two accounts are swapped (right amounts, wrong places)",
     CORE,
     "      accountCode: BANK_OPERATING_ACCOUNT,\n      amountCents: depositMinor,",
     "      accountCode: UNDEPOSITED_ACCOUNT,\n      amountCents: depositMinor,"),

    ("4  the sanctioned Plaid crossing is skipped, keeping the raw feed sign",
     CORE,
     "  const depositMinor = plaidToLedgerCashCents(row.amountCents);",
     "  const depositMinor = row.amountCents;"),

    # Math.abs() and plaidToLedgerCashCents() return the SAME number here,
    # because the direction guard above has already forced amountCents < 0.
    # So this mutant cannot be caught by any assertion about the journal it
    # produces -- it was a survivor for that reason, not because the arithmetic
    # tests were weak. Rule 138 says replace an equivalent mutant rather than
    # tolerate it, so the risk is guarded STRUCTURALLY instead: the test now
    # asserts the delegation expression itself. The risk is real even though
    # the output is identical today -- a hand-rolled crossing is the exact
    # shape that put backwards card signs into Sage (rule 19), and it stops
    # agreeing with the ledger the moment the guard above it moves.
    ("5  the crossing is hand-rolled instead of delegated (rule 19/25)",
     CORE,
     "  const depositMinor = plaidToLedgerCashCents(row.amountCents);",
     "  const depositMinor = Math.abs(row.amountCents);"),

    # ── INVENTING INCOME ─────────────────────────────────────────────────────
    ("6  a revenue line is added, counting the day's sales twice",
     CORE,
     "  const remaining = allocation.remainingMinor;",
     '  lines.push({ lineNo: 99, accountCode: "40100", amountCents: -depositMinor,\n'
     '    description: "Sales" });\n'
     "  const remaining = allocation.remainingMinor;"),

    ("7  the explanation stops saying the sale was already booked",
     CORE,
     "`the operating account. No income is recorded — the sale was already ` +",
     "`the operating account. ` +"),

    # ── DIRECTION AND SHAPE OF THE BANK ROW ──────────────────────────────────
    ("8  an outflow is accepted as a deposit",
     CORE,
     '  if (bankDirection(row.amountCents) !== "money_in") {',
     "  if (false) {"),

    ("9  the direction test is inverted",
     CORE,
     '  if (bankDirection(row.amountCents) !== "money_in") {',
     '  if (bankDirection(row.amountCents) === "money_in") {'),

    ("10 a zero-dollar row is posted",
     CORE,
     "  if (row.amountCents === 0) {",
     "  if (false) {"),

    ("11 fractional cents are accepted",
     CORE,
     "  if (!Number.isInteger(row.amountCents)) {",
     "  if (false) {"),

    ("12 a pending row is treated as settled",
     CORE,
     "  if (row.pending) {",
     "  if (false) {"),

    ("13 a removed row is still posted",
     CORE,
     "  if (row.removed) {",
     "  if (false) {"),

    ("14 pre-cutover rows are posted into the new books (rule 10)",
     CORE,
     "  if (!isOnOrAfterCutover(row.date)) {",
     "  if (false) {"),

    # ── WHAT THE ROW IS ──────────────────────────────────────────────────────
    ("15 any inflow clears till cash, including own transfers and ATM settlement",
     CORE,
     '  if (input.eventKind !== "deposit_of_sales") {',
     "  if (false) {"),

    ("16 the wrong-kind refusal stops naming the kind it saw",
     CORE,
     '      `That row is recorded as "${input.eventKind}", not a deposit of sales. ` +',
     '      "That row is not a deposit of sales. " +'),

    # ── THE POOL ─────────────────────────────────────────────────────────────
    ("17 a deposit clears an empty pool, inventing cash in transit",
     CORE,
     "  if (poolMinor <= 0) {",
     "  if (false) {"),

    ("18 the pool guard accepts zero (off by one)",
     CORE,
     "  if (poolMinor <= 0) {",
     "  if (poolMinor < 0) {"),

    ("19 a deposit larger than the pool drives 10400 negative",
     CORE,
     "  if (depositMinor > poolMinor) {",
     "  if (false) {"),

    ("20 the over-clear guard is off by one",
     CORE,
     "  if (depositMinor > poolMinor) {",
     "  if (depositMinor > poolMinor + 1) {"),

    ("21 the over-clear refusal stops showing the two figures",
     CORE,
     "      `The bank received ${money(depositMinor)} but only ${money(poolMinor)} ` +",
     '      "The bank received more than was counted. " +'),

    ("22 a non-integer day amount is accepted",
     CORE,
     "    if (!Number.isInteger(d.amountMinor)) {",
     "    if (false) {"),

    # ── TIME ─────────────────────────────────────────────────────────────────
    ("23 an unparseable oldest-date is treated as fine",
     CORE,
     "  if (gap === null) {",
     "  if (false) {"),

    # books-96: this is no longer a refusal. The owner decided aged cash POSTS
    # with a warning, so cutting the guard now means the deposit goes through
    # SILENTLY - which is the actual risk, and worse than a wrong refusal.
    ("24 cash counted a year earlier is banked with no warning at all",
     CORE,
     "  if (gap > MATCH_WINDOW_HARD_DAYS) {",
     "  if (false) {"),

    # ── IDEMPOTENCY ──────────────────────────────────────────────────────────
    ("25 an already-matched row is posted a second time",
     CORE,
     "  if (input.alreadyMatched === true) {",
     "  if (false) {"),

    ("26 the source ref stops carrying the transaction id, so every deposit collides",
     CORE,
     "  return `${DEPOSIT_SOURCE_PREFIX}:${transactionId}`;",
     "  return DEPOSIT_SOURCE_PREFIX;"),

    # ── THE SERVICE: reading the real books ──────────────────────────────────
    ("27 the pool is read from drafts as well as posted journals",
     SERVICE,
     '    .eq("gl_journals.status", "posted")',
     '    .eq("gl_journals.status", "draft")'),

    ("28 the pool is read from every account, not just 10400",
     SERVICE,
     '    .eq("account_code", UNDEPOSITED_ACCOUNT)',
     '    .eq("account_code", BANK_OPERATING_ACCOUNT)'),

    ("29 a failed read is reported as an empty pool (rule 46)",
     SERVICE,
     "  if (error || !data) return null;",
     "  if (error || !data) return { balanceMinor: 0, oldestDate: null,\n"
     "    days: [], negativeDays: [] };",),

    ("30 an unreadable balance is passed to the builder as zero anyway",
     SERVICE,
     "  if (pool === null) {",
     "  if (false) {"),

    ("31 the journal is left as a draft nobody approves",
     SERVICE,
     "      autoPost: true,",
     "      autoPost: false,"),

    ("32 a failed post is reported to the manager as a success",
     SERVICE,
     "  if (!result.ok) {",
     "  if (false) {"),

    # ── THE DOOR (rule 133g) ─────────────────────────────────────────────────
    ("33 DOOR: the panel is removed from the end-of-day page",
     PAGE,
     "        <UndepositedFunds />\n",
     ""),

    ("34 DOOR: the panel shows a hardcoded zero instead of reading the books",
     PANEL,
     "  const pool = await undepositedBalanceMinor();",
     "  const pool = { balanceMinor: 0, oldestDate: null,\n"
     "    days: [], negativeDays: [] };"),

    ("35 DOOR: an unreadable balance renders as a clean $0.00 (rule 46)",
     PANEL,
     "  if (pool === null) {",
     "  if (false && pool === null) {"),

    ("36 DOOR: the panel implies that seeing the number deals with it",
     PANEL,
     "        Showing this figure does not clear it.",
     "        This figure is handled automatically."),
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
