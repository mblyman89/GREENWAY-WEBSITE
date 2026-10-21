#!/usr/bin/env python3
"""scripts/r41/mutate-s14-app.py - R41 S14: test the tests for the yearly
Nacha fraud-procedure review (core, store, action, page, packet route, the
help tab and the calendar link).

Each mutant changes ONE thing; then the pure self-tests (run-pure-selftests.ts)
OR the S14 vitest file must FAIL. Files are restored after each mutant and
checked byte-for-byte at the end; a control run must pass first and last. The
tests that read a .last.log are left out of every run (-t), so a stale log can
never "kill" a mutant.

    python3 scripts/r41/mutate-s14-app.py | tee scripts/r41/mutate-s14-app.last.log
"""
import subprocess
import sys

CORE = "src/lib/payments/ach-yearly-review-core.ts"
STORE = "src/lib/payments/ach-yearly-review-store.ts"
ACTION = "src/app/admin/settings/banking/yearly-review-actions.ts"
PAGE = "src/app/admin/settings/banking/yearly-review/page.tsx"
ROUTE = "src/app/admin/settings/banking/yearly-review/packet/route.ts"
TABS = "src/app/admin/settings/banking/BankingHelpTabs.tsx"
CAL = "src/lib/payments/ach-calendar-core.ts"
T = ["tests/compliance/r41-s14-yearly.test.ts"]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- core (pure) ---
    ("quote reworded", CORE, 'annual: "review (at least annually) these processes', 'annual: "review (at least yearly) these processes'),
    ("risk row points past the procedure", CORE, "    procedureItems: [10, 12],", "    procedureItems: [10, 13],"),
    ("bank change not higher risk", CORE, '    id: "bank-change",\n    payment: "Any payment after a payee\'s routing number, account number or account type changed",\n    level: "higher",', '    id: "bank-change",\n    payment: "Any payment after a payee\'s routing number, account number or account type changed",\n    level: "lower",'),
    ("future year accepted", CORE, '  if (reviewYear > thisYear) return { ok: false, error: "A review cannot be for a future year." };\n', ""),
    ("two years back accepted", CORE, "  if (reviewYear < thisYear - 1) return", "  if (reviewYear < thisYear - 2) return"),
    ("digits allowed in summary", CORE, "  if (/[0-9]{7,}/.test(summary)) return", "  if (/[0-9]{17,}/.test(summary)) return"),
    ("sod box not required", CORE, '  if (get("sod_reviewed") !== "1") return', '  if (get("sod_reviewed") === "x") return'),
    ("oldest correction stands", CORE, "  const current = corrections.length ? corrections[corrections.length - 1] : original;", "  const current = corrections.length ? corrections[0] : original;"),
    ("year window in UTC", CORE, 'return { fromIso: pacificWallTimeToUtcISO(`${year}-01-01`, "start"),', 'return { fromIso: `${year}-01-01T00:00:00.000Z`,'),
    ("non-ACH actions counted", CORE, "    if (!isAchAction(a.action) || !inYear(a.created_at)) continue;", "    if (!inYear(a.created_at)) continue;"),
    ("manager action not flagged", CORE, "    else if (!PRIVILEGED.has(p.role))\n", "    else if (false)\n"),
    ("packet always has section 5", CORE, "  const s = input.sod;\n  if (s) {", "  const s = input.sod ?? buildSodReport({ year: input.year, staff: [], audit: [], requests: [], stopReviews: [] });\n  if (s) {"),
    ("owner-only db error reworded", CORE, 'return "Only the owner records the yearly review.";', 'return "Not allowed.";'),
    # --- store ---
    ("audit read not checked complete", STORE, "  if (!audit.verdict.complete) return", "  if (false) return"),
    # --- action ---
    ("admin can record", ACTION, '  const session = await requirePermission("ach.act");', '  const session = await requirePermission("settings.manage");'),
    ("calendar ticked for last year too", ACTION, "  if (form.row.reviewYear === Number(today.slice(0, 4))) {", "  if (form.row.reviewYear >= 2026) {"),
    # --- page ---
    ("admin sees who-did-what", PAGE, '  const seesLog = can(session.profile.role, "audit.view");', '  const seesLog = can(session.profile.role, "settings.manage");'),
    ("page without a guard", PAGE, '  const session = await requirePermission("settings.manage");', '  const session = await requirePermission("dashboard.view");'),
    # --- route ---
    ("route cached", ROUTE, '      "Cache-Control": "no-store",\n      "X-Content-Type-Options"', '      "Cache-Control": "public, max-age=3600",\n      "X-Content-Type-Options"'),
    ("route hands out a packet after a partial read", ROUTE, "  if (sodIn && !sodIn.ok) return refuse(sodIn.error);", ""),
    ("route shows who-did-what to admins", ROUTE, '  const seesLog = can(session.profile.role, "audit.view");', "  const seesLog = true;"),
    # --- tab and calendar ---
    ("tab missing", TABS, '  { key: "yearly", href: "/admin/settings/banking/yearly-review", label: "Yearly review" },\n', ""),
    ("calendar task back to the calendar", CAL, '    href: "/admin/settings/banking/yearly-review#record",', '    href: "/admin/settings/banking/calendar#fraud-procedure",'),
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
