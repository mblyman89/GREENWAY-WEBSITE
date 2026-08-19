#!/usr/bin/env python3
"""
scripts/compliance/mutate-slice-books-08.py

MUTATION TESTING FOR THE CHART OF ACCOUNTS + GENERAL LEDGER SLICE (books-08).

Standing rule 15: EVERY TEST MUST BE PROVEN CAPABLE OF FAILING. A test suite
that has never been shown to fail is a decoration, not a control.

WHAT THIS SLICE IS GUARDING, and why mutation testing is the right tool for it:

This slice fixed two defects that were found by RUNNING the system against
PostgreSQL, not by reading it:

  1. The general ledger's "Balance" column was not a balance. It summed only the
     lines inside the requested window, and the default window began 2026-01-01
     while the cut-over opening balances are dated 2025-12-31 (the only pre-2026
     date the schema permits). Cash that was really +$1,000 displayed as -$3,000.

  2. The trial balance counted "abnormal" accounts over that same truncated
     window, so accounts were reported as sitting on the wrong side purely
     because the opening balance that put them on the right side was excluded.
     And it STILL footed, and STILL certified, because excluding a whole
     balanced journal removes equal debits and credits.

Neither defect crashed. Neither showed up as a stack trace. Both produced a
confident, well-formatted, arithmetically self-consistent report that was wrong.
That is precisely the failure class mutation testing exists to catch: if I break
the fix on purpose and the suite still says PASS, then the suite was never
actually testing the fix.

The mutations below each break exactly ONE guarantee. Every one of them is a
plausible future edit \u2014 a "simplification", a refactor, a tidy-up \u2014 not an
absurdity. That is the point: these are the edits that will actually happen.

Run:  python3 scripts/compliance/mutate-slice-books-08.py
Exit: 0 = every mutation was caught. Non-zero = a guarantee is untested.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CORE = REPO / "src/lib/accounting/books-ledger-guidance-core.ts"
RUNNER = REPO / "scripts/tmp/_mutation-runner-08.ts"

RUNNER_SRC = """import { __runBooksLedgerGuidanceCoreTests } from "../../src/lib/accounting/books-ledger-guidance-core";
__runBooksLedgerGuidanceCoreTests();
console.log("PASS");
"""


@dataclass(frozen=True)
class Mutation:
    name: str
    # What guarantee this breaks, in plain English.
    breaks: str
    old: str
    new: str


MUTATIONS: list[Mutation] = [
    # ---------------------------------------------------------------------
    # THE BALANCE-FORWARD FOLD \u2014 defect 1
    # ---------------------------------------------------------------------
    Mutation(
        name="balance-forward-discarded",
        breaks=(
            "The opening balance stops being carried into the window \u2014 this is "
            "the ORIGINAL defect, restored. Cash reads negative when it is "
            "positive."
        ),
        old="    let running = forward;",
        new="    let running = 0;",
    ),
    Mutation(
        name="fold-boundary-off-by-one",
        breaks=(
            "A line dated exactly on the window start gets folded away instead "
            "of being shown, so the first day of every period silently vanishes "
            "into the opening figure."
        ),
        old="      const beforeWindow = r.journal_date < windowFrom;",
        new="      const beforeWindow = r.journal_date <= windowFrom;",
    ),
    Mutation(
        name="fold-sign-inverted",
        breaks=(
            "Debits and credits swap in the fold, so every carried-forward "
            "balance arrives with the wrong sign \u2014 the owner's real "
            "backwards-card-signs failure, reintroduced."
        ),
        old="      const delta = r.debit_cents - r.credit_cents;",
        new="      const delta = r.credit_cents - r.debit_cents;",
    ),
    Mutation(
        name="fold-bleeds-across-accounts",
        breaks=(
            "The running balance is not reset per account, so one account's "
            "balance leaks into the next \u2014 every figure after the first is wrong."
        ),
        old="    const rows = [...rowsIn].sort((a, b) => {",
        new="    const rows = [...allRows].sort((a, b) => {",
    ),
    Mutation(
        name="row-order-not-normalised",
        breaks=(
            "Rows are no longer sorted, so the running balance depends on the "
            "order the database happened to return \u2014 the same report gives two "
            "different answers."
        ),
        old="""    const rows = [...rowsIn].sort((a, b) => {
      if (a.journal_date !== b.journal_date) return a.journal_date < b.journal_date ? -1 : 1;
      return a.journal_no - b.journal_no;
    });""",
        new="    const rows = [...rowsIn].reverse();",
    ),
    # ---------------------------------------------------------------------
    # PERMANENT vs TEMPORARY \u2014 the FY2027 landmine
    # ---------------------------------------------------------------------
    Mutation(
        name="everything-folds-from-inception",
        breaks=(
            "Income and expense accounts carry prior years forward, so from "
            "2027-01-01 the income statement reports two years of sales as one. "
            "Invisible in 2026 \u2014 which is what makes it dangerous."
        ),
        old='  return nature === "permanent" ? null : fiscalYearStartOf(windowFrom);',
        new="  return null;",
    ),
    Mutation(
        name="everything-treated-as-temporary",
        breaks=(
            "Assets, liabilities and equity stop carrying from inception, so "
            "every balance sheet loses its opening balances again on 1 January."
        ),
        old='  return nature === "permanent" ? null : fiscalYearStartOf(windowFrom);',
        new="  return fiscalYearStartOf(windowFrom);",
    ),
    Mutation(
        name="equity-misclassified-as-temporary",
        breaks=(
            "Retained Earnings is treated as resetting each year, which would "
            "wipe out the accumulated equity of the business every January."
        ),
        old="""  return type === "asset" || type === "liability" || type === "equity"
    ? "permanent"
    : "temporary";""",
        new="""  return type === "asset" || type === "liability"
    ? "permanent"
    : "temporary";""",
    ),
    Mutation(
        name="cogs-misclassified-as-permanent",
        breaks=(
            "Cost of goods sold stops resetting annually. Under 280E, COGS is "
            "the ONLY thing this business can deduct \u2014 overstating it across "
            "years is the single most audit-exposed number on the return."
        ),
        old="""  return type === "asset" || type === "liability" || type === "equity"
    ? "permanent"
    : "temporary";""",
        new="""  return type === "asset" || type === "liability" || type === "equity" || type === "cogs"
    ? "permanent"
    : "temporary";""",
    ),
    Mutation(
        name="unknown-account-defaults-to-temporary",
        breaks=(
            "An account missing from the chart silently loses its opening "
            "balance instead of keeping its history \u2014 the unsafe default."
        ),
        old='    const nature = natures?.get(code) ?? "permanent";',
        new='    const nature = natures?.get(code) ?? "temporary";',
    ),
    Mutation(
        name="fiscal-year-start-drifts",
        breaks=(
            "The fiscal year is taken to start in a month other than January, "
            "so year-to-date figures silently include or exclude a month."
        ),
        old='  return `${isoDate.slice(0, 4)}-01-01`;',
        new='  return `${isoDate.slice(0, 4)}-02-01`;',
    ),
    Mutation(
        name="dropped-prior-year-lines-uncounted",
        breaks=(
            "Prior-year lines are excluded silently instead of being counted, so "
            "the missing-year-end-close check can never fire."
        ),
        old="        dropped += 1;",
        new="        dropped += 0;",
    ),
    # ---------------------------------------------------------------------
    # YEAR-END CLOSE DETECTION
    # ---------------------------------------------------------------------
    Mutation(
        name="close-check-goes-quiet",
        breaks=(
            "The missing year-end closing entry stops being reported, so "
            "Retained Earnings can be understated by a whole year's profit with "
            "nothing on any screen saying so."
        ),
        old="  if (affected.length === 0) return [];",
        new="  if (affected.length >= 0) return [];",
    ),
    Mutation(
        name="close-check-fires-on-permanent-accounts",
        breaks=(
            "Carrying cash forward is reported as a missing close, training the "
            "owner to ignore the warning that actually matters."
        ),
        old='    (s) => s.nature === "temporary" && s.droppedPriorYearLineCount > 0,',
        new="    (s) => s.droppedPriorYearLineCount >= 0,",
    ),
    # ---------------------------------------------------------------------
    # THE TRIAL BALANCE \u2014 defect 2
    # ---------------------------------------------------------------------
    Mutation(
        name="trial-balance-uses-period-activity",
        breaks=(
            "The trial balance reverts to summing only the window, dropping the "
            "opening balances \u2014 defect 2, restored. It still foots, so nothing "
            "warns anyone."
        ),
        old="    const bal = sec.closingBalanceCents;",
        new="    const bal = sec.closingBalanceCents - sec.balanceForwardCents;",
    ),
    Mutation(
        name="zero-balance-accounts-listed",
        breaks=(
            "Accounts that net to zero appear on the trial balance, so it stops "
            "matching the trial balance SQL and the two reports disagree about "
            "which rows exist."
        ),
        old="    if (bal === 0) continue;",
        new="    if (bal === 0 && false) continue;",
    ),
    Mutation(
        name="abnormal-detection-disabled",
        breaks=(
            "Nothing is ever reported as being on the unusual side, so negative "
            "cash and negative inventory pass silently."
        ),
        old="      isAbnormal: f ? isWrongSide(bal, f.normalBalance) : false,",
        new="      isAbnormal: false,",
    ),
    Mutation(
        name="unmapped-account-assumed-normal",
        breaks=(
            "An account the chart cannot explain is silently treated as fine "
            "instead of being named \u2014 the GRWNY/GRNWY typo that once hid "
            "eighteen accounts, including all of payroll."
        ),
        old="    if (!f) unmapped.push(sec.accountCode);",
        new="    if (!f && false) unmapped.push(sec.accountCode);",
    ),
    Mutation(
        name="unmapped-account-money-dropped",
        breaks=(
            "An unexplained account's money is excluded from the totals, so the "
            "trial balance stops footing for a reason nobody can see."
        ),
        old="    const f = byCode.get(sec.accountCode);\n    if (!f) unmapped.push(sec.accountCode);",
        new="    const f = byCode.get(sec.accountCode);\n    if (!f) { unmapped.push(sec.accountCode); continue; }",
    ),
    Mutation(
        name="debit-credit-columns-swapped",
        breaks=(
            "Debits render in the credit column and vice versa \u2014 the owner's "
            "real backwards-signs failure, on the most-read report in the system."
        ),
        old="      debitCents: bal > 0 ? bal : 0,\n      creditCents: bal < 0 ? -bal : 0,",
        new="      debitCents: bal < 0 ? -bal : 0,\n      creditCents: bal > 0 ? bal : 0,",
    ),
    Mutation(
        name="difference-always-zero",
        breaks=(
            "The trial balance claims to foot no matter what, which is exactly "
            "the false certification this slice exists to remove."
        ),
        old="  const differenceCents = totalDebitCents - totalCreditCents;",
        new="  const differenceCents = 0;",
    ),
    # ---------------------------------------------------------------------
    # THE WRONG-SIDE RULE ITSELF
    # ---------------------------------------------------------------------
    Mutation(
        name="zero-balance-called-abnormal",
        breaks=(
            "A closed account that nets to nothing is reported as abnormal, "
            "which contradicts the trial balance SQL and floods the screen with "
            "noise."
        ),
        old="  if (balanceCents === 0) return false;",
        new="  if (balanceCents === 0) return true;",
    ),
    Mutation(
        name="wrong-side-rule-inverted",
        breaks=(
            "Normal balances are reported as abnormal and abnormal ones as "
            "normal \u2014 every finding on the screen becomes exactly backwards."
        ),
        old='  return normal === "debit" ? balanceCents < 0 : balanceCents > 0;',
        new='  return normal === "debit" ? balanceCents > 0 : balanceCents < 0;',
    ),
    # ---------------------------------------------------------------------
    # THE SCANNER'S OWN GUARANTEES (carried from the first build)
    # ---------------------------------------------------------------------
    Mutation(
        name="large-line-threshold-disabled",
        breaks=(
            "Big entries with no explanation stop being questioned \u2014 the "
            "$4,624,697.31 lazy plug walks straight through."
        ),
        old="export const LARGE_LINE_CENTS = 250_000;",
        new="export const LARGE_LINE_CENTS = 999_999_999;",
    ),
    Mutation(
        name="thin-description-accepted",
        breaks="An entry with a one-character description stops being flagged.",
        old="export const THIN_DESCRIPTION_CHARS = 8;",
        new="export const THIN_DESCRIPTION_CHARS = 0;",
    ),
    Mutation(
        name="round-number-check-inverted",
        breaks=(
            "Suspiciously round plug figures stop being flagged and ordinary "
            "fiddly amounts get flagged instead."
        ),
        old="  return cents !== 0 && Math.abs(cents) % 10_000 === 0;",
        new="  return cents !== 0 && Math.abs(cents) % 10_000 !== 0;",
    ),
    Mutation(
        name="severity-order-scrambled",
        breaks=(
            "The most serious finding stops being shown first, so a 'stop' "
            "hides below a page of 'look' items."
        ),
        old='export const SEVERITY_RANK: Record<LedgerSeverity, number> = { stop: 0, check: 1, look: 2 };',
        new='export const SEVERITY_RANK: Record<LedgerSeverity, number> = { stop: 2, check: 1, look: 0 };',
    ),
    Mutation(
        name="scanner-skips-unknown-accounts-silently",
        breaks=(
            "The scanner invents a normal balance for an account it cannot find "
            "instead of skipping it \u2014 guessing, which the standing rules forbid."
        ),
        old="    if (!f) continue; // never invent a normal balance",
        new='    if (!f) { out.push(...scanAccountSection(s, { code: s.accountCode, name: s.accountName, accountType: "asset", normalBalance: "debit" })); continue; }',
    ),
]


def run_tests() -> tuple[bool, str]:
    """Returns (passed, output)."""
    proc = subprocess.run(
        ["npx", "tsx", str(RUNNER)],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=300,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    return ("PASS" in proc.stdout and proc.returncode == 0), out


def main() -> int:
    original = CORE.read_text()
    RUNNER.parent.mkdir(parents=True, exist_ok=True)
    RUNNER.write_text(RUNNER_SRC)

    with tempfile.TemporaryDirectory() as tmp:
        backup = Path(tmp) / "books-ledger-guidance-core.ts"
        shutil.copy2(CORE, backup)

        print("=" * 78)
        print("BASELINE: the suite must PASS before any mutation is meaningful.")
        print("=" * 78)
        passed, out = run_tests()
        if not passed:
            print("BASELINE FAILED \u2014 fix the suite before mutating.\n")
            print(out[-3000:])
            RUNNER.unlink(missing_ok=True)
            return 1
        print("baseline: PASS\n")

        survivors: list[Mutation] = []
        not_applied: list[Mutation] = []

        for i, m in enumerate(MUTATIONS, start=1):
            text = original
            if text.count(m.old) != 1:
                not_applied.append(m)
                print(f"[{i:2d}/{len(MUTATIONS)}] {m.name}: ANCHOR NOT UNIQUE "
                      f"(found {text.count(m.old)}) \u2014 mutation could not be applied")
                continue

            CORE.write_text(text.replace(m.old, m.new))
            try:
                passed, out = run_tests()
            finally:
                shutil.copy2(backup, CORE)

            if passed:
                survivors.append(m)
                print(f"[{i:2d}/{len(MUTATIONS)}] {m.name}: *** SURVIVED *** \u2014 {m.breaks}")
            else:
                first = next(
                    (ln.strip() for ln in out.splitlines() if "FAILED" in ln or "Error:" in ln),
                    "(no message captured)",
                )
                print(f"[{i:2d}/{len(MUTATIONS)}] {m.name}: caught")
                print(f"          breaks   : {m.breaks}")
                print(f"          caught by: {first[:150]}")

        # Restore, and PROVE the restore worked rather than assuming it.
        CORE.write_text(original)
        passed, _ = run_tests()

    RUNNER.unlink(missing_ok=True)

    print()
    print("=" * 78)
    print(f"applied       : {len(MUTATIONS) - len(not_applied)}/{len(MUTATIONS)}")
    print(f"caught        : {len(MUTATIONS) - len(not_applied) - len(survivors)}")
    print(f"SURVIVED      : {len(survivors)}")
    print(f"not applied   : {len(not_applied)}")
    print(f"restored+green: {passed}")
    print("=" * 78)

    if not_applied:
        print("\nMUTATIONS THAT COULD NOT BE APPLIED (anchor text moved \u2014 fix the anchor):")
        for m in not_applied:
            print(f"  - {m.name}")
    if survivors:
        print("\nSURVIVORS \u2014 these are UNTESTED guarantees:")
        for m in survivors:
            print(f"  - {m.name}: {m.breaks}")

    return 0 if (not survivors and not not_applied and passed) else 1


if __name__ == "__main__":
    sys.exit(main())
