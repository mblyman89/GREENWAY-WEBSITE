#!/usr/bin/env python3
"""
MUTATION CAMPAIGN for slice books-05 (bank matching).

Standing rule 15: EVERY TEST MUST BE PROVEN CAPABLE OF FAILING.
Standing rule 16: PROVE THE GATE IS WIRED.

This script breaks src/lib/accounting/bank-match-core.ts on purpose, one change
at a time, and requires BOTH gates to notice:

    gate A - the module's own __runBankMatchCoreTests()
    gate B - tests/compliance/bank-match-core.test.ts under vitest

A mutant that dies only in gate A is a warning that the vitest mirror has gone
decorative, and vice versa. Two gates that fail together on everything are one
gate wearing a disguise, so the report distinguishes them.

Every mutation is VERIFIED to have actually changed the file before its result
is believed. A substitution that matches nothing is reported as NO-OP and fails
the campaign - a mutation that does not mutate is not evidence of anything, but
on screen it reads exactly like a pass. (The first version of this campaign,
written in bash with perl, produced three such phantom "survivors".)
"""
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
TARGET = ROOT / "src/lib/accounting/bank-match-core.ts"
BACKUP = pathlib.Path("/tmp/bank-match-core.campaign.bak")

# (label, find, replace, why_it_matters)
MUTANTS = [
    # --- the sign wall ----------------------------------------------------
    ("S1  sign bridge stops negating (the backwards-card-signs defect)",
     "  if (plaidAmountCents === 0) return 0; // never -0\n  return -plaidAmountCents;",
     "  if (plaidAmountCents === 0) return 0; // never -0\n  return plaidAmountCents;",
     "every matched row posts backwards; the journal still balances"),

    ("S2  sign bridge lets negative zero through",
     "  if (plaidAmountCents === 0) return 0; // never -0\n  return -plaidAmountCents;",
     "  return -plaidAmountCents;",
     "-0 formats and compares in ways that hide a sign error"),

    ("S3  fractional cents are silently rounded instead of refused",
     "if (!Number.isInteger(plaidAmountCents)) {",
     "if (false && !Number.isInteger(plaidAmountCents)) {",
     "float contamination in a money path (standing rule 13)"),

    # --- the refusals -----------------------------------------------------
    ("R1  the sign-disagreement block is disarmed",
     '      code: "BANK_SIGN_DISAGREES",',
     '      code: "BANK_AMOUNT_MISMATCH",',
     "the single most important refusal in the slice"),

    ("R2  the already-matched block is disarmed (defect D2 returns)",
     "if (req.bankRowAlreadyMatched === true) {",
     "if (false && req.bankRowAlreadyMatched === true) {",
     "one bank line could fund two entries; income doubles"),

    ("R3  the cross-entity block is disarmed",
     '      code: "BANK_ENTITY_MISMATCH",',
     '      code: "BANK_UNCLASSIFIED",',
     "shop money leaks into the land books and breaks CHAMP separation"),

    ("R4  the pre-cut-over block is disarmed",
     '      code: "BANK_PRE_CUTOVER",',
     '      code: "BANK_UNCLASSIFIED",',
     "creates a second contradictory record of a filed period"),

    ("R5  hard blocks stop blocking",
     "const postable = findings.every((f) => !f.hardBlock);",
     "const postable = true;",
     "the gate reports problems and then posts anyway"),

    # --- 280E / CHAMP -----------------------------------------------------
    ("T1  interest is hardcoded disallowed again (defect D4 returns)",
     'export function interestCostClassFor(entityCode: EntityCode): CostClass {',
     'export function interestCostClassFor(entityCode: EntityCode): CostClass {\n  if (true) return "nondeductible_280e";',
     "overpays tax on the mortgage every month, invisibly"),

    ("T2  the mortgage interest becomes a shop expense",
     'export function interestCostClassFor(entityCode: EntityCode): CostClass {',
     'export function interestCostClassFor(entityCode: EntityCode): CostClass {\n  if (true) return "separate_business";',
     "understates disallowed 280E costs on the shop's own debt"),

    # --- reconciliation: D1 and D8 ---------------------------------------
    ("D1  reconciliation stops adjusting the bank side",
     "  const adjustedBankCents = input.statementClosingCents + inBooksNotBankCents;",
     "  const adjustedBankCents = input.statementClosingCents;",
     "invents a gap out of clean books; trains the owner to ignore warnings"),

    ("D8a complete collapses back into ties (the D8 defect returns)",
     "  const complete = ties && unrecordedItemCount === 0;",
     "  const complete = ties;",
     "a month with a missing expense reports itself as finished"),

    ("D8b unrecorded items stop being counted",
     "    unrecordedItemCount += 1;",
     "    unrecordedItemCount += 0;",
     "the count that gates sign-off always reads zero"),

    ("D8c readyToSignOff decouples from complete",
     "  const readyToSignOff = complete;",
     "  const readyToSignOff = ties;",
     "the green light returns while work remains"),

    ("D8d the narrative declares victory on ties alone",
     "  if (complete) {",
     "  if (ties) {",
     "the words say 'safe to sign off' while an expense is missing"),

    # --- structuring ------------------------------------------------------
    ("F1  structuring compares signed values, so deposits are never seen",
     "    const magnitude = Math.abs(d.amountCents);",
     "    const magnitude = d.amountCents;",
     "surveillance that surveils nothing, silently"),

    ("F2  the CTR threshold drifts",
     "export const CTR_THRESHOLD_CENTS = 1000000;",
     "export const CTR_THRESHOLD_CENTS = 2000000;",
     "the statutory $10,000 line stops matching the statute"),

    # --- dates ------------------------------------------------------------
    ("C1  the match window widens without anyone noticing",
     "export const MATCH_WINDOW_HARD_DAYS = 30;",
     "export const MATCH_WINDOW_HARD_DAYS = 3000;",
     "two unrelated transactions that share an amount get married"),

    ("C2  the line in the sand moves",
     'export const LINE_IN_THE_SAND = "2026-01-01";',
     'export const LINE_IN_THE_SAND = "2020-01-01";',
     "backdating into years the accountant has already filed"),
]

EQUIVALENT_NOTE = {}


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kw)


def gate_a() -> bool:
    r = run(["npx", "tsx", "-e",
             "require('./src/lib/accounting/bank-match-core').__runBankMatchCoreTests()"])
    return r.returncode == 0


def gate_b() -> bool:
    r = run(["npx", "vitest", "run", "tests/compliance/bank-match-core.test.ts",
             "--silent"])
    return r.returncode == 0


def main() -> int:
    shutil.copy(TARGET, BACKUP)
    original = TARGET.read_text(encoding="utf-8")

    print("=== mutation campaign: slice books-05 (bank matching) ===\n")

    if not (gate_a() and gate_b()):
        print("BASELINE IS RED - the campaign would prove nothing.")
        TARGET.write_text(original, encoding="utf-8")
        return 1
    print("baseline: BOTH GATES GREEN\n")

    killed = survived = noop = 0
    single_gate = []

    for label, find, repl, why in MUTANTS:
        mutated = original.replace(find, repl, 1)
        if mutated == original:
            print(f"  NO-OP     {label}")
            print(f"            the mutation matched nothing - NO EVIDENCE")
            noop += 1
            continue

        TARGET.write_text(mutated, encoding="utf-8")
        a_ok, b_ok = gate_a(), gate_b()
        TARGET.write_text(original, encoding="utf-8")

        if a_ok and b_ok:
            print(f"  SURVIVED  {label}")
            print(f"            <-- REAL HOLE. Consequence: {why}")
            survived += 1
        else:
            dead_in = []
            if not a_ok:
                dead_in.append("self-tests")
            if not b_ok:
                dead_in.append("vitest")
            print(f"  killed    {label}")
            print(f"            caught by: {' + '.join(dead_in)}")
            killed += 1
            if len(dead_in) == 1:
                single_gate.append((label, dead_in[0]))

    TARGET.write_text(original, encoding="utf-8")

    print()
    print(f"killed: {killed}   survived: {survived}   no-op: {noop}")
    if single_gate:
        print("\nCaught by ONE gate only (not a failure - worth knowing):")
        for label, g in single_gate:
            print(f"  - {label}  [{g}]")

    if survived or noop:
        print("\nCAMPAIGN FAILED")
        return 1
    print("\nCAMPAIGN PASSED - every mutation was real, and every one was caught")
    return 0


if __name__ == "__main__":
    sys.exit(main())
