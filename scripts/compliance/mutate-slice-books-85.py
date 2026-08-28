#!/usr/bin/env python3
"""
mutate-slice-books-85.py -- does the books-85 suite actually catch anything?

Standing rule 13c/13d: a test that cannot fail is worse than no test, because
it buys confidence without paying for it. So every slice breaks its own code on
purpose and checks the suite notices.

Each mutation below is a MISTAKE A REAL PERSON WOULD MAKE, not a random
character swap. The two that matter most are #4 and #5: they remove the
exemption logic, which is the difference between a working approval path and
D-67 reintroduced in a costume that looks like a feature.

Usage:  cd repo && python3 scripts/compliance/mutate-slice-books-85.py
"""

import io
import re
import subprocess
import sys

CORE = "src/lib/accounting/approval-core.ts"
SVC = "src/lib/accounting/approval-service.ts"
TESTS = [
    "tests/compliance/approval-core.test.ts",
    "tests/compliance/bank-expense-core.test.ts",
]

# (file, description, old, new)
MUTATIONS = [
    (
        CORE,
        "let a non-owner through the permission gate",
        "  if (!actor.isOwner) {",
        "  if (false) {",
    ),
    (
        CORE,
        "accept an anonymous approver (the exact thing gl_approve_journal refuses)",
        '  if (actor.actorId === null || actor.actorId.trim() === "") {',
        "  if (false) {",
    ),
    (
        CORE,
        "allow a posted entry to be posted again",
        '  if (draft.status !== "draft") {',
        "  if (false) {",
    ),
    (
        CORE,
        "DROP THE EXEMPTIONS -- approve everything, stranding POS sales and reversals",
        "  if (isApprovalExempt(draft.sourceKind)) {",
        "  if (false) {",
    ),
    (
        CORE,
        "exempt 'manual' too -- posts a judgement call with no signature",
        '  "bank",\n  "reversal",\n] as const;',
        '  "bank",\n  "reversal",\n  "manual",\n] as const;',
    ),
    (
        CORE,
        "flip the threshold comparison to > so an entry exactly at $5,000 skips approval",
        "  if (draft.totalCents < policy.thresholdCents) {",
        "  if (draft.totalCents <= policy.thresholdCents) {",
    ),
    (
        CORE,
        "let a missing approval policy pass instead of failing closed",
        "  if (policy === null) {",
        "  if (false) {",
    ),
    (
        CORE,
        "permit self-approval regardless of policy",
        "  if (isAuthor && !policy.allowSelfApproval) {",
        "  if (false) {",
    ),
    (
        CORE,
        "re-approve an already-approved entry, overwriting who signed it",
        '  if (draft.approvedBy !== null && draft.approvedBy.trim() !== "") {',
        "  if (false) {",
    ),
    (
        CORE,
        "accept a one-line 'entry' -- not double-entry at all",
        "  if (draft.lineCount < 2) {",
        "  if (false) {",
    ),
    (
        CORE,
        "round a fractional cent instead of refusing it",
        "    if (!Number.isSafeInteger(a)) {",
        "    if (false) {",
    ),
    (
        CORE,
        "use the full sum instead of half -- doubles every entry's measured size",
        "  return Math.trunc(sum / 2);",
        "  return Math.trunc(sum);",
    ),
    (
        SVC,
        "reach for the admin client, so auth.uid() is null and approval is anonymous",
        'import { createBooksClient } from "@/lib/supabase/books-client";',
        'import { createSupabaseAdminClient } from "@/lib/supabase/admin";\n'
        'import { createBooksClient } from "@/lib/supabase/books-client";',
    ),
    (
        SVC,
        "delete the drafts reader the screen depends on",
        "export async function listDraftJournals(",
        "async function listDraftJournals(",
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
