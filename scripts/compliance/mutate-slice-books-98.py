#!/usr/bin/env python3
"""
scripts/compliance/mutate-slice-books-98.py

Rule 13c: a test that cannot fail is worse than no test. This breaks the
books-98 store-safe slice on purpose, one edit at a time, and demands that the
suite NOTICE. A surviving mutation is a hole in the tests, not a win.

WHY THIS SLICE NEEDS ITS OWN PROBE
----------------------------------
books-96's probe guards FIFO ordering. books-98 adds three new families of
risk, and almost all of them leave a journal that BALANCES PERFECTLY:

  * THE SAFE LAYER COLLAPSING BACK. If a till close debits 10400 again instead
    of 10100, every entry still balances and every total is still right - but
    the books claim a deposit was committed hours before anyone counted a bag,
    and the safe never appears at all. This is D-77, and a balance check is
    blind to it.

  * THE BAG LIFECYCLE GOING SOFT. If 'undeclared' can be skipped, or a bag can
    be sealed twice, cash can leave a drawer and enter the safe's total with
    nobody having counted it in between. Nothing is out of balance. Money is
    simply gone, and no entry says so.

  * THE CLOSE BLOCK NAMING TOO LITTLE. A message that stops at the FIRST
    undeclared bag lets the second bag walk out the door while claiming the
    problem was already reported.

  * THE ADVANCE BECOMING AN EXPENSE TOO EARLY. Booking the supply-run cash
    straight to an expense account balances perfectly and is wrong twice: the
    expense is recorded before anything was bought, and 12100 never carries the
    employee's name, so nothing ever asks for the receipt back.

  * THE SHAPE CHECK TURNING INTO A REFUSAL, or nagging on ordinary deposits.
    Either one ends the same way: Michael learns to ignore it.

Rule 133g: at least one mutation must SEVER THE DOOR. The door here is the bag
NUMBER on the sealed entry. A deposit that does not carry its bag id is matched
by date alone, which is the convention books-98 exists to replace with evidence.

Rule 137: an ambiguous anchor is not a probe. The harness requires EXACTLY ONE
match for every anchor and FAILS otherwise.

Usage:  python3 scripts/compliance/mutate-slice-books-98.py
"""
import io
import subprocess
import sys

BAG = "src/lib/accounting/safe-bag-core.ts"
CASH = "src/lib/accounting/register-cash-journal-core.ts"

TESTS = [
    "tests/compliance/safe-bag.test.ts",
    "tests/compliance/register-cash.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # ── THE SAFE LAYER: D-77 crawling back in ────────────────────────────────
    ("1  a till close lands straight in 10400 again, skipping the safe entirely",
     CASH,
     'line(n++, VAULT_ACCOUNT, removedMinor, `Cash from ${input.registerName} to safe`),',
     'line(n++, UNDEPOSITED_ACCOUNT, removedMinor, `Cash from ${input.registerName} to safe`),',),

    ("2  sealing a bag credits the till instead of the safe (safe never empties)",
     CASH,
     'line(2, VAULT_ACCOUNT, -input.amountMinor, `Cash out of safe into bag ${bagNo}`),',
     'line(2, TILLS_ACCOUNT, -input.amountMinor, `Cash out of safe into bag ${bagNo}`),',),

    ("3  sealing a bag debits the safe instead of Undeposited Funds (sign wall)",
     CASH,
     'line(1, UNDEPOSITED_ACCOUNT, input.amountMinor, `Sealed into bag ${bagNo}`),',
     'line(1, VAULT_ACCOUNT, input.amountMinor, `Sealed into bag ${bagNo}`),',),

    # ── DOOR (rule 133g): the bag id stops reaching the ledger ───────────────
    ("4  DOOR: the sealed entry stops carrying the bag number in its memo",
     CASH,
     'memo: `Seal deposit bag ${bagNo}`,',
     'memo: "Seal deposit bag",',),

    ("5  DOOR: the sealed LINES stop carrying the bag number",
     CASH,
     'line(1, UNDEPOSITED_ACCOUNT, input.amountMinor, `Sealed into bag ${bagNo}`),\n        line(2, VAULT_ACCOUNT, -input.amountMinor, `Cash out of safe into bag ${bagNo}`),',
     'line(1, UNDEPOSITED_ACCOUNT, input.amountMinor, "Sealed into bag"),\n        line(2, VAULT_ACCOUNT, -input.amountMinor, "Cash out of safe"),',),

    ("6  a bag with no id is posted anyway, and can never be matched",
     CASH,
     "  if (bagNo === null) {",
     "  if (false) {",),

    # ── THE LIFECYCLE GOING SOFT ─────────────────────────────────────────────
    ("7  'undeclared' can be skipped: cash reaches the safe uncounted",
     BAG,
     '{ from: "available", action: "pull", to: "undeclared" },',
     '{ from: "available", action: "pull", to: "counted" },',),

    ("8  a bag can be sealed twice, double-counting a deposit",
     BAG,
     '{ from: "deposited", action: "return", to: "available" },',
     '{ from: "deposited", action: "seal", to: "deposited" },',),

    ("9  every action is allowed from every state (the matrix stops refusing)",
     BAG,
     "export function applyBagAction(",
     "export function applyBagActionUNUSED(",),

    # ── THE CLOSE BLOCK ──────────────────────────────────────────────────────
    ("10 the close block stops at the FIRST undeclared bag",
     BAG,
     'const open = bags.filter((b) => b.status === "undeclared");',
     'const open = bags.filter((b) => b.status === "undeclared").slice(0, 1);',),

    ("11 the close block never fires: an undeclared bag no longer stops a close",
     BAG,
     "if (open.length === 0) return null;",
     "if (open.length >= 0) return null;",),

    ("12 the close block also accuses bags that were counted correctly",
     BAG,
     'b.status === "undeclared"',
     'b.status !== "deposited"',),

    # ── THE SUPPLY RUN ───────────────────────────────────────────────────────
    ("13 the supply advance is booked as an expense immediately",
     CASH,
     "line(1, EMPLOYEE_ADVANCE_ACCOUNT, input.amountMinor, `Advance to ${who}`),",
     'line(1, "60400", input.amountMinor, `Advance to ${who}`),',),

    ("14 the advance no longer needs a name on it",
     CASH,
     '  if (who === "") {',
     "  if (false) {",),

    ("15 settling the advance forgets to clear 12100 (receivable dangles forever)",
     CASH,
     "  if (input.advancedMinor > 0) {",
     "  if (false) {",),

    ("16 the change is kept out of the safe, so the till stays short",
     CASH,
     'lines.push(line(n++, VAULT_ACCOUNT, changeMinor, "Change returned to safe"));',
     "lines.push(line(n++, VAULT_ACCOUNT, 0, \"Change returned to safe\"));",),

    ("17 a receipt bigger than the advance is silently booked backwards",
     CASH,
     "  if (changeMinor < 0) {",
     "  if (false) {",),

    # ── THE SHAPE CHECK (option C) ───────────────────────────────────────────
    ("18 the shape check nags on ordinary deposits (warning fatigue)",
     BAG,
     "const under = depositMinor < CTR_THRESHOLD_MINOR;",
     "const under = depositMinor < CTR_THRESHOLD_MINOR * 1000;",),

    ("19 the shape check treats exactly $10,000 as 'under' (off-by-one nag)",
     BAG,
     "const under = depositMinor < CTR_THRESHOLD_MINOR;",
     "const under = depositMinor <= CTR_THRESHOLD_MINOR;",),

    ("20 the shape check never fires at all",
     BAG,
     "export function checkDepositShape(",
     "export function checkDepositShapeUNUSED(",),
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
