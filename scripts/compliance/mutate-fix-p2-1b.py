"""
scripts/compliance/mutate-fix-p2-1b.py

Fix Phase 2.1b / 2.1c / 2.9. Owner, message 6, verbatim: "please completely
finish G-05 (2.1), the per cashier print out"; "an employee tip tracker
with a new page in the employee drop down menu"; "the top button bar, is
cutoff".

Rule 13c: a test that cannot fail is worse than no test. Rule 137: every
anchor must match EXACTLY once or the harness fails.

Usage:  python3 scripts/compliance/mutate-fix-p2-1b.py
"""
import io
import subprocess
import sys

CASH = "src/lib/registers/cashier-report-core.ts"
CPAGE = "src/app/admin/registers/cashiers/page.tsx"
CCSV = "src/app/admin/registers/cashiers/csv/route.ts"
TIPS = "src/lib/staffing/tips-core.ts"
TSTORE = "src/lib/staffing/tips-store.ts"
TACT = "src/app/admin/staffing/tips/actions.ts"
TPAGE = "src/app/admin/staffing/tips/page.tsx"
NAV = "src/components/admin/admin-nav-data.ts"
HEAD = "src/components/admin/AdminPageHeader.tsx"

TESTS = [
    "tests/compliance/fix-p2-1b-cashier-report.test.ts",
    "tests/compliance/fix-p2-1c-tip-tracker.test.ts",
    "tests/compliance/fix-p2-9-register-toolbar.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    ('cashier: exceptions counted as money', CASH, '    if (e.status !== "processed") continue;', '    if (e.status === "never") continue;'),
    ('cashier: refunds not traced to the seller', CASH, '    if (e.eventType === "sale" && e.orderId) saleCashier.set(e.orderId, e.employeeId);', '    if (false) saleCashier.set(e.orderId as string, e.employeeId);'),
    ('cashier: range cap removed', CASH, '  if (n > CASHIER_REPORT_MAX_DAYS) {', '  if (n > 100000) {'),
    ('cashier: DOOR - page ungated', CPAGE, '  await requirePermission("inventory.manage");', '  await requirePermission("timeclock.use");'),
    ('cashier: CSV ships an incomplete read', CCSV, '  if (loaded.warnings.length > 0) return bad(', '  if (false) return bad('),
    ('tips: open drawers counted', TIPS, '  const closed = input.sessions.filter((s) => s.status !== "open");', '  const closed = input.sessions.filter(() => true);'),
    ('tips: open drawer correction allowed', TIPS, '  if (input.status === "open") return { ok: false,', '  if (input.status === "never") return { ok: false,'),
    ('tips: reason not required', TIPS, '  if (reason.length < TIP_CORRECTION_REASON_MIN) return', '  if (reason.length < 0) return'),
    ('tips store: no compare-and-swap', TSTORE, '  q = opts.expectedOld === null ? q.is("tips_minor", null) : q.eq("tips_minor", opts.expectedOld);', '  // CAS removed'),
    ('tips store: correction not audited', TSTORE, '  await recordAudit({', '  void ({'),
    ('tips: DOOR - staff can correct', TACT, '  const session = await requirePermission("staffing.manage");', '  const session = await requirePermission("timeclock.use");'),
    ('tips: DOOR - staff see everyone', TPAGE, '    ownId = await employeeIdForStaff(session.userId);', '    ownId = null;'),
    ('nav: Tip Tracker leaves the Employee menu', NAV, '{ label: "Tip Tracker", href: "/admin/staffing/tips", permission: "timeclock.use"', '{ label: "Tip Tracker", href: "/admin/staffing/tips", permission: "staffing.manage"'),
    ('toolbar: stops wrapping', HEAD, 'className="flex flex-wrap items-center gap-2 px-5 pb-3 sm:px-8"', 'className="flex items-center gap-2 px-5 pb-3 sm:px-8 overflow-hidden"'),
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
        # Rule 137: exactly one, or this is not a probe.
        if hits != 1:
            print(f"  ERROR  {label}")
            print(f"         anchor matched {hits} times in {path}; expected exactly 1")
            print("         FAILING rather than skipping (rules 48, 137).")
            return 2

        io.open(path, "w", encoding="utf-8").write(original.replace(find, repl, 1))
        try:
            if run_tests():
                survived.append(label)
                print(f"  SURVIVED  {label}", flush=True)
            else:
                caught += 1
                print(f"  caught    {label}", flush=True)
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
