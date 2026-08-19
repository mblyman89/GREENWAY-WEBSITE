#!/usr/bin/env python3
"""
MUTATION CAMPAIGN FOR SLICE books-12 (THE AUDITING HUB UI)
==========================================================

Standing rule 15: EVERY TEST MUST BE PROVEN CAPABLE OF FAILING.

tests/compliance/audit-hub-wiring.test.ts is a STRUCTURAL test. It reads the
source text of the hub's routes, components and server actions and asserts
things about how they are wired. That style of test is unusually easy to write
badly, because a regex that never matches anything looks exactly like a regex
that matches everything: both are green.

So for every wiring guarantee, this script BREAKS the product on purpose, runs
the suite, and demands that the suite notice. If the suite stays green while
the product is broken, the guarantee was decorative and is reported as such.

Each mutation must also fail for the RIGHT REASON. A mutation that makes the
file stop parsing would fail every test at once and prove nothing, so each case
carries an `expect` fragment that must appear in the failure output.

After every case the file is restored from git (tracked) or from an in-memory
snapshot (untracked - most of this slice is new files, and `git checkout` on an
untracked path is a silent no-op, which has bitten this project before), and
the restore is verified against .mut/books12-ui.md5 by checksum.

Run:  python3 scripts/compliance/mutate-slice-books-12.py
"""

from __future__ import annotations

import hashlib
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SUITE = "tests/compliance/audit-hub-wiring.test.ts"
CHECKSUMS = REPO / ".mut" / "books12-ui.md5"

AUD = "src/app/admin/inventory/audits"


# ---------------------------------------------------------------------------
# The mutations.
#
# (label, relative path, find, replace, expected fragment of the failure)
#
# `find` must appear EXACTLY ONCE in the file. If it appears zero times the
# mutation is vacuous and the case is reported as BROKEN, not as a pass -
# a mutation that does not mutate cannot prove anything.
# ---------------------------------------------------------------------------
MUTATIONS: list[tuple[str, str, str, str, str]] = [
    (
        "M1: ungate the count sheet route",
        f"{AUD}/[id]/count/page.tsx",
        'await requirePermission("inventory.manage")',
        "await Promise.resolve()",
        "each route calls requirePermission",
    ),
    (
        "M2: swap in the wrong gate (requireBooksAccess) on the hub landing",
        f"{AUD}/page.tsx",
        'await requirePermission("inventory.manage")',
        "await requireBooksAccess()",
        "no page uses requireBooksAccess",
    ),
    (
        "M3: let the review page be cached",
        f"{AUD}/[id]/page.tsx",
        'export const dynamic = "force-dynamic";',
        "",
        "force-dynamic",
    ),
    (
        "M4: drop the re-gate from ONE server action, leaving the others gated",
        f"{AUD}/actions.ts",
        # Renaming an action does NOT ungate it - the original version of this
        # mutation did exactly that and then blamed the test for not caring.
        # Delete the gate from ONE action instead, leaving the other three
        # gated, which is the realistic regression: a copy-paste that drops a
        # line. `saveReasonAction` writes reason_code, a TAX field.
        """export async function saveReasonAction(form: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");""",
        """export async function saveReasonAction(form: FormData): Promise<void> {
  const session = await getSessionUnchecked_MUTANT();""",
        "server action calls requirePermission",
    ),
    (
        "M5: take the approver from the submitted form instead of the session",
        f"{AUD}/actions.ts",
        "approvedBy: session.profile.id",
        'approvedBy: String(formData.get("approvedBy") ?? "")',
        "approver is taken from the session",
    ),
    (
        "M6: treat a blank quantity as zero",
        f"{AUD}/actions.ts",
        "BLANK_IS_NOT_ZERO",
        "QTY_DEFAULTED_TO_ZERO",
        "blank quantity is refused",
    ),
    (
        "M7: leak the book quantity onto the blind count sheet",
        f"{AUD}/AuditCountSheet.tsx",
        "export type SheetLine = {",
        "export type SheetLine = {\n  systemQty: number;",
        "never references a system or expected quantity",
    ),
    (
        "M8: hardcode captureMethod so hand-typed counts claim to be scanned",
        f"{AUD}/AuditCountSheet.tsx",
        'name="captureMethod"',
        'name="captureMethod" value="scan"',
        "records HOW a number arrived",
    ),
    (
        "M9: hand-roll the variance reason list instead of using the guidance core",
        f"{AUD}/AuditVarianceReview.tsx",
        "{VARIANCE_REASONS.map(",
        "{LOCAL_REASONS_MUTANT.map(",
        "variance reason list comes from the guidance core",
    ),
    (
        "M10: pre-select a variance reason for the owner",
        f"{AUD}/AuditVarianceReview.tsx",
        'type="radio"',
        'type="radio" defaultChecked',
        "no pre-selected default",
    ),
    (
        "M11: stop printing what the count does NOT prove",
        f"{AUD}/[id]/export/page.tsx",
        "doesNotProve",
        "provesOnly_MUTANT",
        "does NOT prove",
    ),
    (
        "M12: misspell the entity on the work paper (rule 19 typo)",
        f"{AUD}/[id]/export/page.tsx",
        "LYMAN'S MARIJUANA, Inc. dba Greenway Marijuana",
        "LYMAN'S MARIJUANA, Inc. dba GRWNY Marijuana",
        "spells the entity name correctly",
    ),
    (
        "M13: unregister the hub from the navigation, orphaning every route",
        "src/components/admin/admin-nav-data.ts",
        '"/admin/inventory/audits"',
        '"/admin/inventory/audits-ORPHANED"',
        "navigation registers the hub",
    ),
    (
        "M14: point the hub at /admin/audit, the security log",
        f"{AUD}/page.tsx",
        '<Button href="/admin/inventory/audits/new" variant="primary">',
        '<Button href="/admin/audit/new" variant="primary">',
        "does NOT squat on /admin/audit",
    ),
    (
        "M15: hide the gross figure on the hub list, leaving only net",
        f"{AUD}/page.tsx",
        "{formatCents(s.grossVarianceCents)}",
        "{formatCents(s.netVarianceCents)}",
        "surface the gross figure",
    ),
    (
        "M16: replace a specific refusal with 'something went wrong'",
        f"{AUD}/actions.ts",
        "SCOPE_RATIONALE_TOO_THIN",
        "something went wrong",
        "refusals are redirected",
    ),
]


def sh(cmd: list[str], cwd: Path = REPO) -> tuple[int, str]:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


EXPECTED_TEST_COUNT = 21


def run_suite() -> tuple[bool, str]:
    """
    True if the suite PASSED.

    THIS FUNCTION IS THE ORACLE, AND THE FIRST VERSION OF IT WAS WRONG.

    It originally passed `--reporter=basic`, which does not exist in vitest 4.
    Vitest crashed while loading the reporter, BEFORE RUNNING A SINGLE TEST, and
    printed no " failed" anywhere. The old string-sniffing verdict therefore read
    that crash as "the suite passed", and the campaign cheerfully reported all
    sixteen guarantees as DECORATIVE - including one I had watched fail with my
    own eyes minutes earlier.

    That is the same trap as defect D2: a check whose two sides both come from
    one assumption agrees with itself and proves nothing. So the verdict now
    rests on the process EXIT CODE, and separately insists the suite actually
    executed the expected number of tests. A crash, a typo'd path, or a renamed
    file can no longer masquerade as success.
    """
    rc, out = sh(["npx", "vitest", "run", SUITE])

    # Strip ANSI so counts can be parsed regardless of colour.
    plain = re.sub(r"\x1b\[[0-9;]*m", "", out)

    m = re.search(r"Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed\s+\((\d+)\)", plain)
    if m is None:
        return False, out + "\n\n[ORACLE] could not find a test count: the suite did not run."

    total = int(m.group(3))
    if total != EXPECTED_TEST_COUNT:
        return False, out + (
            f"\n\n[ORACLE] expected {EXPECTED_TEST_COUNT} tests, saw {total}. "
            "A mutation must break an ASSERTION, not the suite itself."
        )

    return rc == 0, out


def verify_restore() -> bool:
    rc, out = sh(["md5sum", "-c", str(CHECKSUMS.relative_to(REPO))])
    if rc != 0:
        print("    !! RESTORE VERIFICATION FAILED")
        print("    " + out.strip().replace("\n", "\n    "))
    return rc == 0


def main() -> int:
    if not CHECKSUMS.exists():
        print(f"FATAL: {CHECKSUMS} missing. Generate baseline checksums first.")
        return 2

    print("=" * 78)
    print("BASELINE: the suite must be GREEN before any mutation is meaningful.")
    print("=" * 78)
    ok, out = run_suite()
    if not ok:
        print("FATAL: baseline is already red. Fix that before mutating.")
        print(out[-3000:])
        return 2
    print("  baseline GREEN\n")

    if not verify_restore():
        print("FATAL: baseline checksums do not match the working tree.")
        return 2

    results: list[tuple[str, str, str]] = []

    for label, rel, find, repl, expect in MUTATIONS:
        path = REPO / rel
        print("-" * 78)
        print(label)

        if not path.exists():
            results.append((label, "BROKEN", f"file missing: {rel}"))
            print(f"  BROKEN: file missing: {rel}")
            continue

        original = path.read_text()
        count = original.count(find)
        if count != 1:
            results.append(
                (label, "BROKEN", f"anchor appears {count}x (need exactly 1): {find!r}")
            )
            print(f"  BROKEN: anchor appears {count}x, need exactly 1 -> {find!r}")
            continue

        path.write_text(original.replace(find, repl, 1))
        try:
            passed, out = run_suite()
            if passed:
                results.append((label, "DECORATIVE", "suite stayed GREEN while broken"))
                print("  *** DECORATIVE *** the suite did not notice this break.")
            elif expect.lower() in out.lower():
                results.append((label, "PROVEN", expect))
                print(f"  PROVEN: suite failed, and named it -> {expect!r}")
            else:
                results.append(
                    (label, "WRONG-REASON", f"failed, but never mentioned {expect!r}")
                )
                print(f"  WRONG REASON: failed but did not mention {expect!r}")
                print("  " + out[-1200:].replace("\n", "\n  "))
        finally:
            path.write_text(original)
            if md5(path) != dict(
                (l.split("  ", 1)[1], l.split("  ", 1)[0])
                for l in CHECKSUMS.read_text().strip().splitlines()
            ).get(rel, ""):
                print("  !! checksum mismatch after restore")
            if not verify_restore():
                print("  ABORTING: working tree is not clean.")
                return 2

    print()
    print("=" * 78)
    print("MUTATION CAMPAIGN RESULT")
    print("=" * 78)
    proven = sum(1 for _, s, _ in results if s == "PROVEN")
    bad = [r for r in results if r[1] != "PROVEN"]
    for label, status, note in results:
        print(f"  [{status:12}] {label}")
        if status != "PROVEN":
            print(f"                 -> {note}")
    print()
    print(f"  {proven}/{len(MUTATIONS)} guarantees proven capable of failing.")

    ok, _ = run_suite()
    print(f"  suite restored to GREEN: {ok}")
    print(f"  checksums verified:      {verify_restore()}")

    return 0 if (not bad and ok) else 1


if __name__ == "__main__":
    sys.exit(main())
