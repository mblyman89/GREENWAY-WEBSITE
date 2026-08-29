#!/usr/bin/env python3
"""
scripts/compliance/mutate-slice-books-101.py

Rule 13c: a test that cannot fail is worse than no test. This breaks the
books-101 account-classification slice on purpose, one edit at a time, and
demands that the suite NOTICE. A surviving mutation is a hole in the tests.

WHY THIS SLICE NEEDS ITS OWN PROBE
----------------------------------
D-80 is the quietest defect this codebase has produced. Nothing on a Plaid
account said whose it was, so the ENTITY of a posted expense came from the
merchant rule alone: classifyExpense({merchant:'AMAZON'}) returns entity
'greenway' whoever swiped. Alyssa's Amazon order posted into a 280E business,
the entry balanced, the bank reconciled, and nothing anywhere looked wrong.

Michael's instruction was the opposite: "I want to make sure we are very
deliberate and clear about what accounts are for business and which ones are my
wife and my personal accounts."

Five families of risk, none visible to a balance check:

  * THE GATE GOING AWAY. If a personal charge can reach the classifier again,
    D-80 is back exactly as it was. Nothing turns red.

  * THE GATE FAILING OPEN. An unclassified, blank, or unrecognised books tag
    treated as "assume business" is the same defect wearing a default. This is
    the likeliest way for it to come back, because "be lenient" always reads
    like a kindness.

  * PERSONAL BEING FOLDED INTO AN ERROR. If a personal account reports the same
    thing as an unclassified one, the obvious way to silence the warning is to
    tag the personal card as Greenway -- D-80, re-entered by hand.

  * THE OWNER LEAKING INTO THE ENTITY. Reading ownerCode when deciding the
    entity pushes Michael's Citi Mastercard into the personal pile. The card
    "stays with me always and is only used for greenway marijuana purchases",
    so it is his card and Greenway's books; any code that conflates the two
    gets this backwards.

  * D-79 REGRESSING. If role uniqueness comes back for every role, the second
    credit card becomes unenterable again and the only way to make the screen
    accept it is to untag the first -- which silently stops that card posting.

Rule 133g: at least one mutation must SEVER THE DOOR. The door here is
`books_entity` in the service's SELECT and its journey into the funding
account. Mutations 15-18 cut exactly there: the gate stays perfectly correct
and is simply never given anything to judge, which restores D-80 in full while
every unit test passes on hand-built inputs.

Rule 137: an ambiguous anchor is not a probe. The harness requires EXACTLY ONE
match for every anchor and FAILS otherwise.

Usage:  python3 scripts/compliance/mutate-slice-books-101.py
"""
import io
import subprocess
import sys

CLS = "src/lib/plaid/account-classification-core.ts"
EXP = "src/lib/accounting/bank-expense-core.ts"
SVC = "src/lib/accounting/bank-expense-service.ts"
UI = "src/lib/plaid/plaid-ui-core.ts"

TESTS = [
    "tests/compliance/account-classification.test.ts",
    "tests/compliance/bank-expense-core.test.ts",
    "tests/compliance/plaid-ui-core.test.ts",
    # The door. Without this file mutations 15-18 survive: the gate is correct
    # and simply never reached, which is D-80 restored in full.
    "tests/compliance/bank-expense-service-books.test.ts",
    # The READING door -- recordBankExpenses, which builds the funding account
    # from plaid_accounts. Mutations 16, 17 and 18 all survived the first probe
    # run without it, because the file above is handed an account already built.
    "tests/compliance/bank-expense-service-books-door.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # ── THE GATE GOING AWAY: D-80 restored ──────────────────────────────────
    ("1  a personal account posts to the business ledger again (D-80, verbatim)",
     EXP,
     '  if (booksDecision.kind === "personal") {',
     "  if (false) {",),

    ("2  an unclassified account posts instead of refusing",
     EXP,
     '  if (booksDecision.kind === "unclassified") {',
     "  if (false) {",),

    ("3  the account no longer outranks the merchant when they disagree",
     EXP,
     '  if (classification.entity !== "personal" && classification.entity !== booksDecision.entity) {',
     "  if (false) {",),

    # ── THE GATE FAILING OPEN: a default is the defect wearing a kindness ───
    ("4  an absent books tag is assumed to be the business",
     EXP,
     '  if (key === "") return null;',
     '  if (key === "") return "greenway";',),

    ("5  an unrecognised books tag falls back to the business",
     EXP,
     "  return BOOKS_ENTITY_CODES.find((c) => c === key) ?? null;",
     '  return BOOKS_ENTITY_CODES.find((c) => c === key) ?? "greenway";',),

    ("6  personal counts as a business, so personal spend posts",
     CLS,
     '  return entity !== "personal";',
     "  return true;",),

    ("7  the decision treats a missing books tag as greenway",
     CLS,
     "  if (c.booksEntity === null) {",
     "  if (false) {",),

    # ── PERSONAL FOLDED INTO AN ERROR ───────────────────────────────────────
    ("8  a personal account reports as unclassified, inviting a wrong retag",
     CLS,
     '      kind: "personal",',
     '      kind: "unclassified",\n      missing: "books",',),

    # ── THE OWNER LEAKING INTO THE ENTITY ───────────────────────────────────
    ("9  the owner decides the books, so Michael's Citi card goes personal",
     CLS,
     "  if (!isBusinessBooks(c.booksEntity)) {",
     '  if (!isBusinessBooks(c.booksEntity) || c.ownerCode === "michael") {',),

    ("10 'joint' quietly becomes an owner nobody decided the meaning of",
     CLS,
     'export const OWNER_CODES = ["michael", "alyssa"] as const;',
     'export const OWNER_CODES = ["michael", "alyssa", "joint"] as const;',),

    ("11 an unknown name is coerced to Michael instead of refused",
     CLS,
     "  if (isOwnerCode(v)) return { ok: true, owner: v };",
     '  if (isOwnerCode(v)) return { ok: true, owner: v };\n  return { ok: true, owner: "michael" };',),

    # ── THE BOOKS VOCABULARY DRIFTING FROM THE LEDGER ───────────────────────
    ("12 books gets its own vocabulary, a second source of truth",
     CLS,
     "export const BOOKS_ENTITY_CODES: readonly EntityCode[] = ENTITY_CODES;",
     'export const BOOKS_ENTITY_CODES: readonly EntityCode[] = ["greenway", "atm", "landholding"];',),

    # ── D-79 REGRESSING ─────────────────────────────────────────────────────
    ("13 every role is unique again, so the second credit card is unenterable",
     CLS,
     'export const UNIQUE_ROLES: readonly string[] = ["main"] as const;',
     'export const UNIQUE_ROLES: readonly string[] = ["main", "atm", "credit", "savings", "reserve", "mortgage", "loan", "personal"] as const;',),

    ("14 main stops being unique, so a personal account can shadow the operating one",
     CLS,
     'export const UNIQUE_ROLES: readonly string[] = ["main"] as const;',
     "export const UNIQUE_ROLES: readonly string[] = [] as const;",),

    # ── THE DOOR (rule 133g): the gate is correct and never consulted ───────
    ("15 the service stops SELECTing books_entity, so every account reads blank",
     SVC,
     '.select("account_id,role,books_entity,active")',
     '.select("account_id,role,active")',),

    ("16 the service reads the column and passes null anyway",
     SVC,
     "      ? acct.books_entity\n      : null;",
     "      ? null\n      : null;",),

    ("17 the funding account is built without its books",
     SVC,
     "  return recordBankExpenseLines(lines, { accountId: plaidAccountId, role, booksEntity }, admin);",
     "  return recordBankExpenseLines(lines, { accountId: plaidAccountId, role }, admin);",),

    ("18 the gate is moved AFTER the classifier, so a refusal masks it",
     EXP,
     "  const booksDecision = decideEntityForAccount({",
     "  if (!classification.ok) return { ok: false, code: \"NOT_CLASSIFIED\", underlyingCode: classification.code, message: classification.message };\n  const booksDecision = decideEntityForAccount({",),

    # ── THE REFUSAL CODES GOING MISSING FROM THE LIST ───────────────────────
    ("19 a refusal code the door can emit is dropped from the exported list",
     EXP,
     '  "ACCOUNT_BOOKS_ARE_PERSONAL",\n',
     "",),

    ("20 the personal refusal borrows a code that means something else",
     EXP,
     '      code: "ACCOUNT_BOOKS_ARE_PERSONAL",',
     '      code: "PERSONAL_ON_BUSINESS_ACCOUNT",',),

    ("21 the uniqueness check is bypassed entirely in the UI guard",
     UI,
     "  if (!roleMustBeUnique(role)) return { ok: true, role };",
     "  return { ok: true, role };",),
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
