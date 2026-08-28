#!/usr/bin/env python3
"""
scripts/compliance/mutate-slice-books-93.py

Rule 13c: a test that cannot fail is worse than no test. This breaks the
books-93 register-cash work on purpose, one edit at a time, and demands that
the suite NOTICE. A surviving mutation is a hole in the tests, not a win.

Rule 133g: at least one mutation must SEVER THE DOOR — cut the path from the
screen Michael actually looks at back to the code that decides — and still be
caught. Here the door is the EOD page rendering the specimen panel: a builder
nobody can see is the exact shape of D-39.

Usage:  python3 scripts/compliance/mutate-slice-books-93.py
"""
import io
import subprocess
import sys

CORE = "src/lib/accounting/register-cash-journal-core.ts"
SPEC = "src/lib/accounting/register-cash-specimen-core.ts"
PANEL = "src/app/admin/registers/eod/RegisterCashSpecimen.tsx"
PAGE = "src/app/admin/registers/eod/page.tsx"
RUNNER = "scripts/compliance/run-pure-selftests.ts"

TESTS = ["tests/compliance/register-cash.test.ts"]

# (label, file, find, replace)
MUTATIONS = [
    # ── the close: signs and amounts ────────────────────────────────────────
    ("1  over/short sign flipped: a short drawer would post as a gain",
     CORE,
     "  const overShortMinor = input.countedMinor - expectedMinor;",
     "  const overShortMinor = expectedMinor - input.countedMinor;"),

    ("2  50920 posted with the wrong sign (over becomes a debit)",
     CORE,
     "        overShortMinor > 0\n          ? `${input.registerName} over by",
     "        overShortMinor < 0\n          ? `${input.registerName} over by"),

    ("2b the 50920 line amount stops being negated",
     CORE,
     "        -overShortMinor,\n        overShortMinor > 0",
     "        overShortMinor,\n        overShortMinor > 0"),

    ("3  mid-shift drops ignored: every dropping drawer looks short",
     CORE,
     "input.openingFloatMinor + input.cashSalesMinor - input.dropsMinor;",
     "input.openingFloatMinor + input.cashSalesMinor;"),

    ("4  cash sales dropped from expected: every drawer looks wildly over",
     CORE,
     "input.openingFloatMinor + input.cashSalesMinor - input.dropsMinor;",
     "input.openingFloatMinor - input.dropsMinor;"),

    ("5  float removed even when it stays in the drawer",
     CORE,
     "  const removedMinor = input.floatStaysInDrawer\n    ? input.countedMinor - input.openingFloatMinor\n    : input.countedMinor;",
     "  const removedMinor = input.countedMinor;"),

    ("6  float never removed even when the whole drawer goes to the safe",
     CORE,
     "  const removedMinor = input.floatStaysInDrawer\n    ? input.countedMinor - input.openingFloatMinor\n    : input.countedMinor;",
     "  const removedMinor = input.countedMinor - input.openingFloatMinor;"),

    ("7  the till is relieved of the takings only, so the entry stops balancing",
     CORE,
     "  const tillCredit = removedMinor - overShortMinor;",
     "  const tillCredit = removedMinor;"),

    ("8  the till relief absorbs the shortage twice",
     CORE,
     "  const tillCredit = removedMinor - overShortMinor;",
     "  const tillCredit = removedMinor + overShortMinor;"),

    ("9  the close debits the vault instead of Undeposited Funds",
     CORE,
     "      line(n++, UNDEPOSITED_ACCOUNT, removedMinor,",
     "      line(n++, VAULT_ACCOUNT, removedMinor,"),

    ("10 the close credits the vault instead of the till",
     CORE,
     "    lines.push(line(n++, TILLS_ACCOUNT, -tillCredit,",
     "    lines.push(line(n++, VAULT_ACCOUNT, -tillCredit,"),

    ("11 a perfectly counted drawer still writes a zero over/short line",
     CORE,
     "  if (overShortMinor !== 0) {",
     "  if (true) {"),

    ("12 a drawer counted below its float is booked instead of escalated",
     CORE,
     "  if (removedMinor < 0) {",
     "  if (false) {"),

    # ── the open ────────────────────────────────────────────────────────────
    ("13 opening debits the vault and credits the till (backwards)",
     CORE,
     "        line(1, TILLS_ACCOUNT, input.floatMinor, `Float into ${input.registerName}`),\n        line(2, VAULT_ACCOUNT, -input.floatMinor, \"Float out of vault\"),",
     "        line(1, VAULT_ACCOUNT, input.floatMinor, `Float into ${input.registerName}`),\n        line(2, TILLS_ACCOUNT, -input.floatMinor, \"Float out of vault\"),"),

    ("14 a float that never left the drawer posts a phantom transfer",
     CORE,
     "  if (!input.fromVault) {",
     "  if (false) {"),

    ("15 the 'float stayed put' answer goes silent (rule 134)",
     CORE,
     '        `The ${input.registerName} drawer kept its own float of ` +',
     '        "" + `` +'),

    ("16 a negative opening float is accepted",
     CORE,
     "  if (!Number.isInteger(input.floatMinor) || input.floatMinor < 0) {",
     "  if (false) {"),

    ("17 a zero float is refused instead of answered with no_entry (rule 135)",
     CORE,
     '      code: "TILL_OPEN_NO_FLOAT",',
     '      code: "TILL_OPEN_NO_FLOAT_X",'),

    # ── denomination reconciliation ─────────────────────────────────────────
    ("18 the reconciler always agrees (Michael's 90-nickel error slips through)",
     CORE,
     "  return { agrees: differenceMinor === 0, countedMinor, differenceMinor };",
     "  return { agrees: true, countedMinor, differenceMinor };"),

    ("19 the reconciler rounds a difference away",
     CORE,
     "  const differenceMinor = countedMinor - Math.round(statedTotalMinor);",
     "  const differenceMinor = Math.round((countedMinor - statedTotalMinor) / 100) * 100;"),

    ("20 a mismatched opening count is booked anyway",
     CORE,
     "    const rec = reconcileDenominations(input.counts, input.floatMinor);\n    if (!rec.agrees) {",
     "    const rec = reconcileDenominations(input.counts, input.floatMinor);\n    if (false) {"),

    ("21 a mismatched closing count is booked anyway",
     CORE,
     "    const rec = reconcileDenominations(input.counts, input.countedMinor);\n    if (!rec.agrees) {",
     "    const rec = reconcileDenominations(input.counts, input.countedMinor);\n    if (false) {"),

    ("22 the recount instruction disappears from the close refusal",
     CORE,
     "`${fmt(Math.abs(rec.differenceMinor))}. Recount before closing: a close ` +",
     "`${fmt(Math.abs(rec.differenceMinor))}. A close ` +"),

    # ── the swap ────────────────────────────────────────────────────────────
    ("23 an unequal 'swap' is waved through as value-neutral",
     CORE,
     "    if (g !== r) {",
     "    if (false) {"),

    ("24 the swap starts posting an entry",
     CORE,
     '    kind: "no_entry",\n    code: "SWAP_NO_ACCOUNTING_EFFECT",',
     '    kind: "refused",\n    code: "SWAP_NO_ACCOUNTING_EFFECT",'),

    ("25 the swap stops stating the amount it did not book",
     CORE,
     "`No journal entry, and none is needed. Trading ${fmt(input.amountMinor)} of ` +",
     "`No journal entry, and none is needed. Trading some money ` +"),

    # ── Q4 / cross-file agreement ───────────────────────────────────────────
    ("26 the till account drifts away from the one sale-journal-core debits",
     CORE,
     'export const TILLS_ACCOUNT = "10110";',
     'export const TILLS_ACCOUNT = "10115";'),

    ("27 the sales answer is inverted",
     CORE,
     "export const SALES_POST_PER_SALE = true;",
     "export const SALES_POST_PER_SALE = false;"),

    ("28 the sales explanation drops the double-count warning",
     CORE,
     '  "10110 Cash on Hand \u2014 Tills for the cash taken. There is no second entry at " +',
     '  "10110 Cash on Hand \u2014 Tills for the cash taken. Also " +'),

    # ── the specimen ────────────────────────────────────────────────────────
    ("29 the specimen till mix is edited away from what Michael stated",
     SPEC,
     "  tens: 5, fives: 10, ones: 50,",
     "  tens: 5, fives: 10, ones: 49,"),

    ("30 the master till reverts to the uncorrected 90 nickels",
     SPEC,
     "quarters: 95, dimes: 120, nickels: 100, pennies: 125,",
     "quarters: 95, dimes: 120, nickels: 90, pennies: 125,"),

    ("31 the specimen close is made to balance perfectly, hiding 50920",
     SPEC,
     "export const SPECIMEN_SHORTAGE_MINOR = 400;",
     "export const SPECIMEN_SHORTAGE_MINOR = 0;"),

    ("32 the specimen total stops counting all three drawers",
     SPEC,
     "  const totalFloatMinor = SPECIMEN_TILL_COUNT * tillFloatMinor + masterFloatMinor;",
     "  const totalFloatMinor = tillFloatMinor + masterFloatMinor;"),

    ("33 the 'these are not your books' notice is removed",
     SPEC,
     '  "A worked example using your own float. These are not your books \u2014 no entry " +',
     '  "A worked example. " +'),

    ("34 the specimen open is switched to the no-move case, hiding the entry",
     SPEC,
     "    counts: SPECIMEN_TILL_COUNTS,\n    fromVault: true,\n    sourceRef: \"specimen:open\",",
     "    counts: SPECIMEN_TILL_COUNTS,\n    fromVault: false,\n    sourceRef: \"specimen:open\","),

    # ── DOOR-SEVERING (rule 133g) ───────────────────────────────────────────
    ("35 DOOR: the EOD page stops rendering the panel on the normal path",
     PAGE,
     "        <RegisterCashSpecimen />\n      </div>\n    </div>",
     "      </div>\n    </div>"),

    ("36 DOOR: the unconfigured branch stops rendering the panel",
     PAGE,
     '        <RegisterCashSpecimen />\n      </div>\n    );\n  }',
     "      </div>\n    );\n  }"),

    ("37 DOOR: the page stops importing the panel entirely",
     PAGE,
     'import { RegisterCashSpecimen } from "./RegisterCashSpecimen";\n',
     ""),

    ("38 DOOR: the panel renders journals but swallows every no_entry answer",
     PANEL,
     '        {result.kind === "no_entry" ? "No journal entry" : "Refused"}',
     '        {result.kind === "no_entry" ? "" : "Refused"}'),

    ("39 DOOR: the panel stops showing the not-your-books notice",
     PANEL,
     "        {s.notice}",
     "        {\"\"}"),

    ("40 DOOR: the panel hard-codes the float instead of computing it",
     PANEL,
     "<span className=\"font-semibold\">{formatCents(s.totalFloatMinor)}</span> of cash",
     "<span className=\"font-semibold\">$1,502.50</span> of cash"),

    ("41 DOOR: Q3's heading is dropped, so one question goes unanswered on screen",
     PANEL,
     "          3. Is there an entry for swapping large bills for small?",
     "          3. Change exchanges",
     ),

    ("42 DOOR: the specimen builder is no longer registered in the self-test runner",
     RUNNER,
     "  __runRegisterCashSpecimenTests();",
     "  // __runRegisterCashSpecimenTests();"),
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
        if original.count(find) < 1:
            print(f"  ERROR  {label}\n         anchor not found in {path}")
            print("         The probe is stale. FAILING rather than skipping (rule 48).")
            return 2

        mutated = original.replace(find, repl, 1)
        io.open(path, "w", encoding="utf-8").write(mutated)
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
