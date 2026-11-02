#!/usr/bin/env python3
"""scripts/r41/mutate-ach-report.py - R41 round 9: test the tests for the
owner/admin-only ACH Payments report (Reports > ACH Payments). Each mutant
changes ONE thing; then the pure self-tests (run-pure-selftests.ts) OR the
report / report-tab vitest files must FAIL. Files are restored after each
mutant and checked byte-for-byte at the end; a control run must pass first
and last.

The test that reads THIS script's log is left out of every run (-t), so a
stale log can never "kill" a mutant.

    python3 scripts/r41/mutate-ach-report.py | tee scripts/r41/mutate-ach-report.last.log
"""
import subprocess
import sys

CORE = "src/lib/reports/ach-payments-report-core.ts"
STORE = "src/lib/reports/ach-payments-report-store.ts"
PAGE = "src/app/admin/reports/ach-payments/page.tsx"
EXPORT = "src/app/admin/reports/ach-payments/export/route.ts"
TABS = "src/components/admin/reports/ReportTabs.tsx"
LAYOUT = "src/app/admin/reports/layout.tsx"
T = [
    "tests/compliance/r41-ach-report.test.ts",
    "tests/compliance/page-tabs.test.tsx",
    "tests/compliance/cockpit-comparisons-and-refunds.test.ts",
    "tests/compliance/r34-expiration-rules.test.ts",
]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- owner/admin only ---
    ("page-reports-view", PAGE, 'await requirePermission("ach.request");', 'await requirePermission("reports.view");'),
    ("export-reports-view", EXPORT, 'await requirePermission("ach.request");', 'await requirePermission("reports.view");'),
    # CVB-6 reshaped reportTabsFor (an owner-only Cultivera Benchmark tab sits before ACH); same two mutants.
    ("tab-always", TABS, "...(showAchTab ? [ACH_REPORT_TAB] : [])", "...[ACH_REPORT_TAB]"),
    ("layout-passes-true", LAYOUT, "<ReportTabs showAchTab={showAchTab} showCultiveraTab={showCultiveraTab} />", "<ReportTabs showAchTab={true} showCultiveraTab={showCultiveraTab} />"),
    # --- bank matching ---
    ("window-wider", CORE, "export const FILE_WINDOW_MAX_DAYS = 2;", "export const FILE_WINDOW_MAX_DAYS = 3;"),
    ("voided-matched", CORE, '    if (f.status === "voided") {\n      row.stage = "voided";\n    } else if', "    if (false) {\n      row.stage = \"voided\";\n    } else if"),
    ("exact-not-preferred", CORE, "  if (exact) return { w: exact, exact: true };\n", ""),
    ("debit-reused", CORE, "      if (pick) {\n        pick.w.used = true;\n", "      if (pick) {\n"),
    ("off-called-cleared", CORE, 'row.stage = pick.exact ? "cleared" : "off";', 'row.stage = "cleared";'),
    # --- deadlines ---
    ("overdue-on-deadline-day", CORE, "overdue: notApproved && deadlineDay !== null && todayIso > deadlineDay,", "overdue: notApproved && deadlineDay !== null && todayIso >= deadlineDay,"),
    # --- money owed / funding ---
    ("aging-30-edge", CORE, 'if (ageDays <= 30) return "0-30";', 'if (ageDays < 30) return "0-30";'),
    ("funding-includes-past", CORE, "    if (r.effectiveDate < todayIso) continue;\n", ""),
    ("voided-payment-counted", CORE, '  for (const p of inWindow) {\n    if (p.status === "file_voided") continue;\n', "  for (const p of inWindow) {\n"),
    ("shortfall-warning-dropped", CORE, "if (input.mainAvailableCents !== null && fundingNeededCents > input.mainAvailableCents) {", "if (false) {"),
    ("no-main-warning-dropped", CORE, '  if (!input.hasMainAccount) attention.push("No bank account', '  if (false) attention.push("No bank account'),
    # --- the store never fails quietly ---
    ("read-error-silent", STORE, '    else problems.push("The ACH file list could not be read, so files in process are not shown.");\n', ""),
    ("plaid-error-silent", STORE, '    problems.push("The bank accounts (Plaid) could not be read, so nothing is matched to the bank.");\n', ""),
    ("cap-not-reported", STORE, "    if (n > cap) problems.push(", "    if (false) problems.push("),
]

files = sorted({m[1] for m in M})
orig = {f: open(f).read() for f in files}


def run():
    a = subprocess.run(PURE, capture_output=True, text=True)
    if a.returncode != 0 or "ALL PURE SELF-TESTS PASSED" not in a.stdout + a.stderr:
        return 1
    return subprocess.run(VIT, capture_output=True, text=True).returncode


c0 = run()
print("control (before)", "pass" if c0 == 0 else f"FAILED {c0}", flush=True)
if c0 != 0:
    sys.exit(2)
surv = []
for name, f, a, b in M:
    s0 = orig[f]
    if s0.count(a) != 1:
        print(f"ANCHOR count={s0.count(a)} {name}", flush=True)
        surv.append(name)
        continue
    open(f, "w").write(s0.replace(a, b, 1))
    try:
        rc = run()
    finally:
        open(f, "w").write(s0)
    k = rc != 0
    print(f"{'killed  ' if k else 'SURVIVED'} {name}", flush=True)
    if not k:
        surv.append(name)
for f in files:
    assert open(f).read() == orig[f], f
c1 = run()
print("control (after)", "pass" if c1 == 0 else f"FAILED {c1}")
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv or c1 != 0 else 0)
