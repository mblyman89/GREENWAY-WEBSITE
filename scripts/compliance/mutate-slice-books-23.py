#!/usr/bin/env python3
"""
scripts/compliance/mutate-slice-books-23.py

MUTATION HARNESS FOR SLICE books-23 (inventory audits -> the general ledger).

WHY THIS EXISTS
---------------
`tests/compliance/inventory-audit-wiring.test.ts` went green on its first
complete run. Standing rule 38 says that is a SUSPECT, not an achievement: a
test file that reads source text can pass because the guard is real, or because
the assertion is aimed at bytes that are never checked. Three of the assertions
in that file did exactly the latter before this harness existed --

  * one split RAW source, so a COMMENT that mentions `.update(...)` was scored
    as a database write, and it passed only because the same comment quotes
    `.select("id")` further down (standing rule 49: right and wrong agreed);
  * one sliced `COUNT_QUEUE_STATUSES` to the first `]`, which is the `[` of the
    TYPE ANNOTATION `readonly AuditSessionStatus[]`, so the "declaration" under
    test was the empty string;
  * three asserted on `requirePermission("inventory.audit")` AFTER a helper had
    blanked every string literal, i.e. they searched for text they had erased.

None of those three could ever fail, which means none of them could ever have
caught the defect this slice exists to fix. Only mutation found them.

WHAT IT DOES
------------
For each mutation: apply one surgical edit to a SOURCE file, run the named test
files, require a FAILURE, then restore the file and verify it is byte-identical
to what it was before. A mutation that survives is reported as a SURVIVOR and
the harness exits non-zero.

Standing rule 33: the target is 0 SURVIVORS **and** 0 SKIPPED. A mutation that
cannot be applied is NOT a pass -- it is reported as SKIPPED and fails the run,
because a mutation whose anchor text has drifted is testing nothing at all
(standing rule 48: a check that cannot classify its input must fail, never skip).

USAGE
-----
    python3 scripts/compliance/mutate-slice-books-23.py
"""

import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

WIRING = "tests/compliance/inventory-audit-wiring.test.ts"
NAVGATE = "tests/compliance/nav-gate-core.test.ts"
HUBWIRE = "tests/compliance/audit-hub-wiring.test.ts"

# ─────────────────────────────────────────────────────────────────────────────
# Each mutation is (label, file, old, new, tests, why).
#
# `why` states the real-world failure the mutation imitates. A mutation that
# does not correspond to a plausible edit is a straw man: it proves the test can
# fail, but not that it would fail for anything anyone would actually do.
# ─────────────────────────────────────────────────────────────────────────────
MUTATIONS = [
    # ── A) REACHABILITY: the defect that survived eleven slices ─────────────
    (
        "A1 unwire the Post button from the page",
        "src/app/admin/inventory/audits/[id]/page.tsx",
        "<form action={postAuditAction} className=\"mt-4\">",
        "<form className=\"mt-4\">",
        [WIRING],
        "The exact shape of the original defect: the engine exists, the action "
        "exists, and no screen submits to it. An approved audit would never "
        "reach the ledger and nothing else in the suite would notice.",
    ),
    (
        "A2 drop the hidden sessionId the action reads",
        "src/app/admin/inventory/audits/[id]/page.tsx",
        # THREE forms on this page carry name="sessionId" (two moveStatusAction,
        # one postAuditAction), so the input alone is not a unique anchor. Include
        # the enclosing form tag: the mutation must break POSTING specifically,
        # not whichever form happens to appear first.
        "<form action={postAuditAction} className=\"mt-4\">\n"
        "              <input type=\"hidden\" name=\"sessionId\" value={id} />",
        "<form action={postAuditAction} className=\"mt-4\">\n"
        "              <input type=\"hidden\" name=\"auditId\" value={id} />",
        [WIRING],
        "Standing rule 42: two namespaces of similar strings trade places. The "
        "form still submits and the action still runs -- it just reads an empty "
        "field and refuses, at run time, only for whoever clicks.",
    ),
    (
        "A3 stop calling the posting engine",
        "src/app/admin/inventory/audits/actions.ts",
        "const result = await postAuditSession(sessionId, inventoryAccountByCategory());",
        "const result = { ok: true as const, data: { lotsMoved: 0, netCents: 0, "
        "grossCents: 0, journalId: null, journalNo: null, warnings: [] } };",
        [WIRING],
        "A silent plug (standing rule 12): the button reports success, records "
        "an audit row, revalidates the journal page -- and posts nothing. This "
        "is the most dangerous single edit possible in this slice.",
    ),
    # ── B) THE RETIRED PATHS ────────────────────────────────────────────────
    (
        "B1 un-retire applyCycleCount",
        "src/lib/inventory/cycle-counts.ts",
        "\"CYCLE_COUNT_APPLY_RETIRED: applying a cycle count directly has been turned off, \"",
        "\"CYCLE_COUNT_APPLY_DISABLED: applying a cycle count is off for now, \"",
        [WIRING],
        "Renaming a refusal code is the likeliest accidental regression, and it "
        "breaks every caller that matches on the code while the message still "
        "reads plausibly to a human.",
    ),
    (
        "B2 restore the dead Apply button",
        "src/app/admin/inventory/cycle-counts/[id]/page.tsx",
        "        <form action={cancelCycleCountAction.bind(null, id)}>",
        "        <form action={applyCycleCountAction.bind(null, id)}>",
        [WIRING],
        "A revert, a bad merge, or a copy-paste from git history puts the "
        "shelf-moving button back on a page staff can reach.",
    ),
    # ── C) PROSE (rules 44 and 47) ──────────────────────────────────────────
    (
        "C1 re-assert the false CCRS claim",
        "src/app/admin/inventory/cycle-counts/page.tsx",
        "Counting is blind: you will not see the expected quantity",
        "Variances post as audited adjustments. Counting is blind: you will not "
        "see the expected quantity",
        [WIRING],
        "The worst class found in this slice: a screen claiming a posting and a "
        "regulatory export that do not happen. Nothing but a prose test can "
        "catch it, because it compiles and every other test passes.",
    ),
    (
        "C2 let the engine auto-post behind the owner's back",
        "src/lib/inventory/inventory-audit-store.ts",
        "  // `autoPost` IS DELIBERATELY NOT PASSED.",
        "  autoPost: true,\n  // `autoPost` IS DELIBERATELY NOT PASSED.",
        [WIRING],
        "Michael's Q1 verbatim: \"create the draft and await my approval before "
        "auto posting\". This edit posts a live journal entry with no approval, "
        "while the screen still promises him a draft.",
    ),
    # ── D) THE BLIND COUNT ──────────────────────────────────────────────────
    (
        "D1 leak the expected quantity onto the count sheet type",
        "src/lib/inventory/audit-hub-store.ts",
        "export type CountSheetLine = {\n  lotId: string;",
        "export type CountSheetLine = {\n  systemQty: number;\n  lotId: string;",
        [WIRING],
        "Michael's Q3: \"it should be a blind count without cost, variances\". A "
        "counter who can see the target is not counting, and the variance "
        "report becomes worthless without anyone noticing.",
    ),
    (
        "D2 hand counting to the reporting-only analyst",
        "src/lib/auth/roles.ts",
        "\"inventory.count\": [\"owner\", \"admin\", \"manager\", \"staff\"],",
        "\"inventory.count\": [\"owner\", \"admin\", \"manager\", \"staff\", \"readonly\"],",
        [WIRING, NAVGATE],
        "The precise mistake `requireStaff()` would have made. `readonly` is "
        "labelled \"Reporting and exports only\" and must not rewrite the shelf.",
    ),
    (
        "D3 let an admin approve an audit",
        "src/lib/auth/roles.ts",
        "\"inventory.audit\": [\"owner\"],",
        "\"inventory.audit\": [\"owner\", \"admin\"],",
        [WIRING, NAVGATE, HUBWIRE],
        "Michael's Q4: \"I am the only one that can approve an audit... Anything "
        "accounting, bookkeeping, taxes, finance, should be hard gated to me "
        "only.\" This is the widening that must be impossible to do quietly.",
    ),
    # ── E) THE GATES, BOTH DIRECTIONS (rule 34) ─────────────────────────────
    (
        "E1 loosen the owner's review screen to counting",
        "src/app/admin/inventory/audits/[id]/page.tsx",
        "await requirePermission(\"inventory.audit\")",
        "await requirePermission(\"inventory.count\")",
        [WIRING, HUBWIRE],
        "Staff would read cost, variance and materiality on every lot -- and "
        "reach the Post button. The blind count is undone from the far side.",
    ),
    (
        "E2 re-gate the counting queue to managing",
        "src/app/admin/inventory/cycle-counts/page.tsx",
        "  await requirePermission(\"inventory.count\");",
        "  await requirePermission(\"inventory.manage\");",
        [WIRING, NAVGATE],
        "The original D4 defect: the people holding the scanner cannot open the "
        "page they are supposed to work in, so counts get done on paper or "
        "under a manager's login.",
    ),
    # ── F) THE SILENT NO-OP (proposed rule 51) ──────────────────────────────
    (
        "F1 stop asking which rows the status move touched",
        "src/lib/inventory/audit-hub-store.ts",
        "    .update(patch)\n    .eq(\"id\", input.sessionId)\n    .select(\"id\");",
        "    .update(patch)\n    .eq(\"id\", input.sessionId);",
        [WIRING],
        "The silent-no-op class. Under RLS a forbidden UPDATE matches zero rows "
        "and returns NO error, so the screen reports that the owner approved an "
        "audit the database refused to change.",
    ),
    (
        "F2 make the row-count guard unable to detect emptiness",
        "src/lib/inventory/audit-hub-store.ts",
        "  const n = Array.isArray(rows) ? rows.length : 0;\n  if (n === 0) {",
        "  const n = Array.isArray(rows) ? rows.length : 0;\n  if (n < 0) {",
        [WIRING],
        "Standing rule 40: an unreachable guard is an untested guard. The "
        "helper is still called everywhere and can never fire.",
    ),
    # ── G) THE DERIVED CHART OF ACCOUNTS ────────────────────────────────────
    (
        "G1 pass a hand-typed account map instead of the derived one",
        "src/app/admin/inventory/audits/actions.ts",
        "postAuditSession(sessionId, inventoryAccountByCategory())",
        "postAuditSession(sessionId, { flower: \"20140\", edible: \"20150\" })",
        [WIRING],
        "The two-entry fixture that was the only such map before books-23. "
        "\"edible\" is not a real slug and 20140 is concentrate, not flower. "
        "Eighteen accounts in the old Sage file were typo'd GRWNY for GRNWY.",
    ),
    # ── H) THE ORDER OF OPERATIONS (Michael's Q2) ───────────────────────────
    (
        "H1 put unapproved drafts on the employee count queue",
        "src/lib/inventory/audit-hub-store.ts",
        "export const COUNT_QUEUE_STATUSES: readonly AuditSessionStatus[] = [\n  \"scope_approved\",",
        "export const COUNT_QUEUE_STATUSES: readonly AuditSessionStatus[] = [\n  \"draft\",\n  \"scope_approved\",",
        [WIRING],
        "Michael's Q2: \"I approve the scope and push it to the cycle counts "
        "page.\" This lets staff start counting a scope he never agreed to.",
    ),
    (
        "H2 make an empty status filter return every session",
        "src/lib/inventory/audit-hub-store.ts",
        "  if (opts.statuses && opts.statuses.length === 0) {\n    return { ok: true, data: [] };\n  }",
        "  // removed by mutation",
        [WIRING],
        "The inversion: `.in()` is never applied, so \"no statuses are "
        "acceptable\" silently means \"return everything\", opening the queue "
        "instead of closing it.",
    ),
    (
        "H3 hide the approved-but-unposted audits from the owner's hub",
        "src/app/admin/inventory/audits/page.tsx",
        "(s) => s.status === \"approved\" && s.postedAt === null,",
        "(s) => s.status === \"approved\",",
        [WIRING],
        "The group that can sit forever. Mixing posted with unposted removes "
        "the owner's only signal that a ledger entry is still owed.",
    ),
    # ── I) THE NAVIGATION ───────────────────────────────────────────────────
    (
        "I1 advertise Cycle Counts to people who cannot open it",
        "src/components/admin/admin-nav-data.ts",
        "{ label: \"Cycle Counts\", href: \"/admin/inventory/cycle-counts\", permission: \"inventory.count\"",
        "{ label: \"Cycle Counts\", href: \"/admin/inventory/cycle-counts\", permission: \"inventory.manage\"",
        [WIRING, NAVGATE],
        "A menu that disagrees with the page gate either hides a page from the "
        "people who need it or shows a link that refuses on click.",
    ),
    (
        "I2 move counting into an owner-only tab",
        "src/components/admin/admin-nav-data.ts",
        # This file stores the icon as a LITERAL backslash escape sequence -- the
        # eight characters \ud83d\udccb -- while the trailing comment on the same
        # line holds a REAL UTF-8 emoji. Getting this wrong silently matched
        # nothing, which the pre-flight anchor check caught as "found 0 times".
        "permission: \"inventory.count\", icon: \"\\ud83d\\udccb\", group: \"Inventory\" }",
        "permission: \"inventory.count\", icon: \"\\ud83d\\udccb\", group: \"Accounting\" }",
        [WIRING],
        "Neither owner tab renders for staff at all, so the item vanishes for "
        "exactly the people who hold the scanner -- while every permission "
        "assertion in the suite still passes.",
    ),
    # ── J) THE COMPLIANCE NAG (Michael's Q5) ────────────────────────────────
    (
        "J1 nag every employee about the owner's filings again",
        "src/app/admin/page.tsx",
        "canSeeCompliance ? getOverdueComplianceCount() : Promise.resolve(0),",
        "getOverdueComplianceCount(),",
        [WIRING],
        "The original defect: a budtender opening the dashboard is told in red "
        "that the 37% excise filing is past due, and the link refuses them. "
        "Michael's Q5 verbatim -- \"the employees should not be harassed by the "
        "system for my not making a payment or filing a report\".",
    ),
    (
        "J2 keep the fetch guard but render the banner to everyone",
        "src/app/admin/page.tsx",
        "{canSeeCompliance && overdueCompliance > 0 && (",
        "{overdueCompliance > 0 && (",
        [WIRING],
        "Belt without braces. Harmless only while the fetch guard survives, "
        "which is exactly the assumption that rots -- one restored "
        "unconditional fetch and the nag is back with no test failing.",
    ),
    (
        "J3 hand the calendar back to the admin",
        "src/lib/auth/roles.ts",
        '"compliance.calendar": ["owner"],',
        '"compliance.calendar": ["owner", "admin"],',
        [WIRING, NAVGATE],
        "The widening that must be impossible to do quietly. Michael kept this "
        "burden deliberately, and an admin marking the LIQ-1295 filed is a "
        "record of a tax filing signed off by someone who did not make it.",
    ),
    (
        "J4 leave the page on the old permission",
        "src/app/admin/compliance/calendar/page.tsx",
        'await requirePermission("compliance.calendar");',
        'await requirePermission("settings.manage");',
        [WIRING, NAVGATE],
        "A half-done move: nav says owner-only, page still admits the admin. "
        "The menu hides the link and a typed URL still works.",
    ),
    (
        "J5 leave the sign-off action on the old permission",
        "src/app/admin/compliance/calendar/actions.ts",
        'const session = await requirePermission("compliance.calendar");',
        'const session = await requirePermission("settings.manage");',
        [WIRING],
        "Worse than the page: an admin could mark a statutory obligation "
        "complete on a screen they can no longer open, and the calendar would "
        "show a filing signed off by someone with no authority to file it.",
    ),
    (
        "J6 restore the help link to the owner-only calendar",
        "src/lib/admin/help-content.ts",
        '        q: "Where are my recurring licensing deadlines?",',
        '        href: "/admin/compliance/calendar",\n'
        '        q: "Where are my recurring licensing deadlines?",',
        [WIRING],
        "The nag by another route. The help catalogue has no permission field "
        "and is shown to everyone, so a budtender searching \"deadlines\" is "
        "handed a link to a page that refuses them.",
    ),
    (
        "J7 move the calendar back out of the owner's menu",
        "src/components/admin/admin-nav-data.ts",
        'permission: "compliance.calendar", icon: "\\ud83d\\udcc5", group: "Lyman" }',
        'permission: "compliance.calendar", icon: "\\ud83d\\udcc5", group: "Admin" }',
        [WIRING, NAVGATE],
        "Michael asked for it in the Lyman menu. Left in \"Admin\" it is an "
        "owner-only item sitting in a tab built for shared administration, "
        "which is how it ended up on settings.manage in the first place.",
    ),
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


ANSI = re.compile(r"\x1b\[[0-9;]*m")
# vitest summary line, e.g. "Tests  3 failed | 34 passed (37)"
TESTS_LINE = re.compile(r"^\s*Tests\s+(?:(\d+) failed)?", re.M)


def run_tests(tests):
    """
    Run vitest and return (failed_test_count, output).

    THE EXIT CODE IS NOT ENOUGH, and this is standing rule 46 applied to the
    harness itself: a non-zero exit means "something went wrong", which includes
    vitest failing to PARSE the mutated file. A syntax error would then be
    scored as a mutation the suite detected, and the assertion aimed at that
    mutation would never have run at all.

    So the kill is counted from the number of tests that actually FAILED. Zero
    failing tests with a non-zero exit is a CRASH, reported separately, because
    it is evidence of nothing.

    ANSI stripping is required: vitest colourises the summary, so a plain
    substring search for "FAIL" finds nothing and silently reports no evidence.
    """
    proc = subprocess.run(
        ["npx", "vitest", "run", *tests],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=600,
    )
    out = ANSI.sub("", proc.stdout + proc.stderr)
    m = TESTS_LINE.search(out)
    failed = int(m.group(1)) if (m and m.group(1)) else 0
    return failed, out


def preflight_clean_tree() -> bool:
    """
    Refuse to run when the working tree has changes that are not staged/committed
    somewhere recoverable.

    WHY THIS GUARD EXISTS. While building this harness I tested one mutation by
    hand, then undid it with `git checkout -- <file>`. That file also carried a
    REAL, uncommitted change of mine, and the checkout threw it away silently.
    The mutation had "died" only because it was being tested against work that
    then vanished; the full suite caught the loss minutes later, by which point
    the harness had already reported a clean pass.

    A harness that edits source files in place is one interrupted run away from
    eating somebody's work. Printing the dirty files is not paranoia -- it is the
    difference between "restored" and "restored to WHAT".
    """
    proc = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=ROOT, capture_output=True, text=True,
    )
    dirty = [l for l in proc.stdout.splitlines() if l.strip()]
    if dirty:
        print("NOTE: the working tree is not clean. These files carry changes that")
        print("      are only in your working copy. This harness restores files from")
        print("      MEMORY, not from git, so an interrupted run leaves them as they")
        print("      were -- but a stray `git checkout` on one of them would not.")
        for d in dirty:
            print(f"        {d}")
        print()
    return True


def main() -> int:
    killed, survivors, skipped, crashed = [], [], [], []
    preflight_clean_tree()

    print("=" * 78)
    print("MUTATION HARNESS - slice books-23 (inventory audits -> ledger)")
    print(f"{len(MUTATIONS)} mutations; target is 0 survivors AND 0 skipped")
    print("=" * 78)

    for label, rel, old, new, tests, why in MUTATIONS:
        path = ROOT / rel
        print(f"\n[{label}]\n  file  {rel}\n  why   {why}")

        if not path.exists():
            skipped.append((label, "file missing"))
            print("  SKIPPED - file does not exist")
            continue

        original = path.read_text(encoding="utf-8")
        before = sha(path)
        n = original.count(old)
        if n != 1:
            # Rule 48: a check that cannot classify its input must FAIL.
            skipped.append((label, f"anchor found {n} times, expected exactly 1"))
            print(f"  SKIPPED - anchor found {n} times, expected 1 (anchor drifted)")
            continue

        path.write_text(original.replace(old, new), encoding="utf-8")
        try:
            failed, out = run_tests(tests)
        finally:
            path.write_text(original, encoding="utf-8")
            assert sha(path) == before, f"RESTORE FAILED for {rel} - repo is dirty!"

        if failed > 0:
            names = [
                l.strip()[2:].strip()
                for l in out.splitlines()
                if l.strip().startswith("x ") or l.strip().startswith("\u00d7 ")
            ]
            print(f"  KILLED by {failed} failing test(s)")
            for nm in names[:4]:
                print(f"    - {nm[:120]}")
            killed.append((label, failed))
        elif "Error" in out and "Tests" not in out:
            # Non-zero exit with no failing test = vitest could not run the file.
            crashed.append((label, "vitest did not run - see log"))
            print("  *** CRASHED *** vitest could not run; this proves nothing")
        else:
            print("  *** SURVIVOR *** the suite accepted this edit")
            survivors.append(label)

    print("\n" + "=" * 78)
    print(f"KILLED    {len(killed)}/{len(MUTATIONS)}")
    print(f"SURVIVORS {len(survivors)}")
    print(f"SKIPPED   {len(skipped)}")
    print(f"CRASHED   {len(crashed)}")
    for lab in survivors:
        print(f"  SURVIVOR: {lab}")
    for lab, reason in skipped:
        print(f"  SKIPPED : {lab} -- {reason}")
    for lab, reason in crashed:
        print(f"  CRASHED : {lab} -- {reason}")
    # Every kill must be backed by a COUNTED failing test, never by an exit code
    # alone. Printed so the evidence is on the record rather than asserted.
    print("-" * 78)
    for lab, n in killed:
        print(f"  killed by {n} test(s): {lab}")
    print("=" * 78)

    if survivors or skipped or crashed:
        print("RESULT: FAIL - rule 33 requires 0 survivors, 0 skipped, 0 crashed.")
        return 1
    print(f"RESULT: PASS - all {len(killed)} mutations detected by real test failures.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
