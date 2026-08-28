#!/usr/bin/env python3
"""
mutate-slice-books-86.py -- does the books-86 suite actually catch anything?

Standing rule 13c/13d: a test that cannot fail is worse than no test, because it
buys confidence without paying for it. So the slice breaks its own code on
purpose and checks the suite notices.

books-86 wires the payroll journal to the ledger (D-38). The mutations that
matter most are the ones that would still BALANCE while being wrong:

  #1  posting a run with no lines            -> a journal entry recording nothing
  #6  resolving an ambiguous time split      -> guessed wages inside inventory
  #7  ignoring an unmapped voluntary deduction -> net pay credited short, still balances
  #12 defaulting cost_class to "none"        -> the 280E label quietly disappears
  #14 admin client instead of books client   -> auth.uid() null, is_owner() false

Every anchor below was READ out of the file, not remembered.

Usage:  cd repo && python3 scripts/compliance/mutate-slice-books-86.py
"""

import io
import re
import subprocess
import sys

CORE = "src/lib/accounting/payroll-posting-core.ts"
SVC = "src/lib/accounting/payroll-posting-service.ts"
TESTS = [
    "tests/compliance/payroll-posting-core.test.ts",
]

# (file, description, old, new)
MUTATIONS = [
    (
        CORE,
        "post an empty journal -- an entry that records that nothing happened",
        "  if (journal.lines.length === 0) {",
        "  if (false) {",
    ),
    (
        CORE,
        "let a non-owner write payroll into the ledger",
        "  if (!isOwner) {",
        "  if (false) {",
    ),
    (
        CORE,
        "post a pay period with nobody on it",
        "  if (run.lines.length === 0) {",
        "  if (false) {",
    ),
    (
        CORE,
        "book a run the payroll engine said was not payable",
        "  if (!run.canPay) {",
        "  if (false) {",
    ),
    (
        CORE,
        "trust an allocation with no written basis -- the Harborside fact pattern",
        "    if (undocumented.length > 0) {",
        "    if (false) {",
    ),
    (
        CORE,
        "RESOLVE THE AMBIGUOUS SPLIT instead of refusing it -- guessed wages in inventory",
        "  if (roleOnFile.cogsSplitBasisPoints > 0 && roleOnFile.cogsSplitBasisPoints < 10_000) {",
        "  if (false) {",
    ),
    (
        CORE,
        "IGNORE AN UNMAPPED VOLUNTARY DEDUCTION -- credits net pay short and still balances",
        "  if (line.voluntaryDeductionCents !== 0) {",
        "  if (false) {",
    ),
    (
        CORE,
        "accept a labor role that is not in the closed taxonomy",
        "      if (!findLaborRole(a.roleCode)) {",
        "      if (false) {",
    ),
    (
        CORE,
        "accept an employee with no labor role on file at all",
        "  if (!roleOnFile || roleOnFile.laborRoleCode.trim().length === 0) {",
        "  if (false) {",
    ),
    (
        CORE,
        "book a paycheque the engine never managed to calculate",
        "  if (!line.computed) {",
        "  if (false) {",
    ),
    (
        CORE,
        "substitute zero for a figure that was never calculated",
        "    line.grossWagesCents === null ||",
        "    false ||",
    ),
    (
        CORE,
        'DEFAULT cost_class TO "none" -- the 280E label disappears and the entry still balances',
        "    cost_class: l.costClass,",
        '    cost_class: l.costClass ?? "none",',
    ),
    (
        CORE,
        "send the whole sum as p_expected_cents instead of just the debits",
        "  return journal.lines.reduce((s, l) => (l.amountCents > 0 ? s + l.amountCents : s), 0);",
        "  return journal.lines.reduce((s, l) => s + l.amountCents, 0);",
    ),
    (
        SVC,
        "reach for the admin client, so auth.uid() is null and is_owner() refuses",
        'import { createBooksClient } from "@/lib/supabase/books-client";',
        'import { createSupabaseAdminClient } from "@/lib/supabase/admin";',
    ),
    (
        SVC,
        "stop sending the fingerprint, so the database cannot notice a changed run",
        "    p_content_fingerprint: plan.contentFingerprint,",
        '    p_content_fingerprint: "",',
    ),
    (
        SVC,
        "delete the preview the pay-run screen depends on",
        "export async function previewPayrollPosting(",
        "async function previewPayrollPosting(",
    ),
]


def run_tests():
    out = subprocess.run(
        ["npx", "vitest", "run", *TESTS],
        capture_output=True,
        text=True,
    )
    return (out.stdout or "") + (out.stderr or "")


def summarise(out):
    # NOTE: `grep -E "Tests +[0-9]"` does NOT match vitest's ANSI output.
    m = re.search(r"Tests\s+(.*)", out)
    return m.group(1).strip() if m else "(no Tests line -- suite did not run)"


def main():
    caught = 0
    missed = []

    for i, (path, why, old, new) in enumerate(MUTATIONS, start=1):
        original = io.open(path, encoding="utf8").read()
        if original.count(old) != 1:
            print(
                "MUTATION %d SKIPPED (anchor appears %d times, must be exactly 1): %s"
                % (i, original.count(old), why)
            )
            missed.append((i, why, "anchor not unique"))
            continue

        io.open(path, "w", encoding="utf8").write(original.replace(old, new, 1))
        try:
            out = run_tests()
            failed = "failed" in summarise(out).lower()
        finally:
            io.open(path, "w", encoding="utf8").write(original)

        status = "CAUGHT " if failed else "MISSED "
        print("%s mutation %2d: %s" % (status, i, why))
        print("           %s" % summarise(out))
        if failed:
            caught += 1
        else:
            missed.append((i, why, "suite stayed green"))

    print("\n%d/%d mutations caught." % (caught, len(MUTATIONS)))
    if missed:
        print("\nSURVIVORS -- each one is a real hole in the suite:")
        for i, why, how in missed:
            print("  %2d  %s  (%s)" % (i, why, how))
        sys.exit(1)
    print("Every deliberate break was detected.")


if __name__ == "__main__":
    main()
