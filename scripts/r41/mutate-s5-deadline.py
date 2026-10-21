#!/usr/bin/env python3
"""scripts/r41/mutate-s5-deadline.py - R41 S5: test the tests for the
Timberland deadline (2 banking days before the effective date, 4:00 pm
Pacific, holidays/weekends move a payday to the PRIOR usable
day; Greenway's own 3:30 pm target). Each mutant changes ONE thing; then the
pure self-tests (run-pure-selftests.ts) OR the S5 / S4 / S3 / R39 vitest
files must FAIL. The plan's (R41-TIMBERLAND-SLICE-PLAN v4 S5) mutants are
here by name: two-to-one, prior-to-next, utc-not-pacific, margin-dropped.
Files are restored after each mutant and checked byte-for-byte at the end; a
control run must pass first and last.

The test that reads THIS script's log is left out of every run (-t), so a
stale log can never "kill" a mutant.

    python3 scripts/r41/mutate-s5-deadline.py | tee scripts/r41/mutate-s5-deadline.last.log
"""
import subprocess
import sys

DC = "src/lib/payments/timberland-deadline-core.ts"
LS = "src/lib/payments/ach-file-ledger-store.ts"
PS = "src/lib/payroll/payroll-store.ts"
VA = "src/app/admin/vendor-payments/actions.ts"
OS = "src/lib/payments/ach-ops-store.ts"
OP = "src/app/admin/settings/banking/operations/page.tsx"
RT = "src/app/api/cron/ach-deadline-1pm/route.ts"
CR = "src/lib/notifications/compliance-reminders.ts"
VJ = "vercel.json"
T = [
    "tests/compliance/r41-s5-deadline.test.ts",
    "tests/compliance/r41-s4-timberland-limits.test.ts",
    "tests/compliance/r41-s3-ach-files.test.ts",
    "tests/compliance/r39-ach-ops-store-behaviour.test.ts",
    "tests/compliance/r39-ach-ops-core.test.ts",
]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- the plan's four ---
    ("two-to-one", DC, "const day = subUsableDays(effective, CREDIT_LEAD_BANKING_DAYS);", "const day = subUsableDays(effective, 1);"),
    ("prior-to-next", DC, "return prevUsableDayOnOrBefore(payday);", "return nextUsableDayOnOrAfter(payday);"),
    ("utc-not-pacific", DC, "const today = pacificDayKey(nowUtc);\n  if (d < today)", "const today = nowUtc.toISOString().slice(0, 10);\n  if (d < today)"),
    ("margin-dropped", DC, "new Date(cutoffUtc.getTime() - SAFETY_MARGIN_MIN * 60_000)", "new Date(cutoffUtc.getTime())"),
    # --- the core's other edges ---
    ("cutoff-gte-to-gt", DC, "if (nowUtc.getTime() >= deadline.cutoffUtc.getTime()) {", "if (nowUtc.getTime() > deadline.cutoffUtc.getTime()) {"),
    ("earliest-at-cutoff", DC, "if (nowUtc.getTime() < latestUploadAndApproval(eff).cutoffUtc.getTime()) return eff;", "if (nowUtc.getTime() <= latestUploadAndApproval(eff).cutoffUtc.getTime()) return eff;"),
    # R41 S12 (Email 3 answer 8, D-7): Q9 Fridays are usable; blocking them again must be caught.
    ("q9-fridays-blocked-again", DC, "  return isFedAchBankingDay(iso);\n}", "  return isFedAchBankingDay(iso) && !isQ9Friday(iso);\n}"),
    ("same-day-allowed", DC, "if (d === today) return { ok: false, rule: \"same_day\"", "if (false) return { ok: false, rule: \"same_day\""),
    # (A UTC day in earliestEffectiveDate / the 1 pm planner is an EQUIVALENT
    # mutant: probed every 15 min, Sep 2026 - Sep 2028, 70,176 instants, 0
    # differences - UTC runs ahead only after 4/5 pm Pacific, past the cutoff,
    # and 1-4 pm Pacific never crosses UTC midnight. Replaced, not counted.)
    # (Starting the search at today+1 is ALSO equivalent: that first candidate's
    # deadline is always a past day, so the loop skips it - run 2 showed it.)
    ("earliest-skips-a-day", DC, "const eff = addUsableDays(today, CREDIT_LEAD_BANKING_DAYS + i);", "const eff = addUsableDays(today, CREDIT_LEAD_BANKING_DAYS + 1 + i);"),
    ("afternoon-noon", DC, "AFTERNOON_REMINDER = { hour: 13, minute: 0 }", "AFTERNOON_REMINDER = { hour: 12, minute: 0 }"),
    ("afternoon-at-cutoff", DC, "nowUtc < from || nowUtc >= dl.cutoffUtc) continue;", "nowUtc < from || nowUtc > dl.cutoffUtc) continue;"),
    ("afternoon-before-1pm", DC, "nowUtc < from || nowUtc >= dl.cutoffUtc) continue;", "nowUtc >= dl.cutoffUtc) continue;"),
    ("afternoon-approved-too", DC, "if (f.status !== \"released\" && f.status !== \"uploaded\") continue;\n    const dl = latestUploadAndApproval(f.effectiveDate);\n    if (dl.day !== today ||", "const dl = latestUploadAndApproval(f.effectiveDate);\n    if (dl.day !== today ||"),
    # --- the store: the one choke point ---
    ("release-deadline-removed", LS, "  if (!deadline.ok) return { ok: false, error: `Timberland deadline: this file was NOT released. ${deadline.error}` };\n", ""),
    ("open-cap-ignored", LS, "if (rows.length > OPEN_FILES_READ_CAP) return", "if (false) return"),
    ("open-odd-row-skipped", LS, "if (!ok) return { ok: false, error: \"An ACH file row", "if (!ok) continue;\n    if (false) return { ok: false, error: \"An ACH file row"),
    ("open-read-error-empty", LS, "  if (error) return { ok: false, error: ledgerDbErrorMessage(error.message) };\n  const rows = (data ?? []) as Record<string, unknown>[];", "  const rows = (data ?? []) as Record<string, unknown>[];"),
    # --- payroll ---
    ("payroll-uses-payday", PS, "const bankEffective = deadline.effective;", "const bankEffective = detail.run.pay_date;"),
    ("payroll-refusal-ignored", PS, "  if (!deadline.check.ok) return { ok: false, error: deadline.line };\n", ""),
    ("reconcile-uses-payday", PS, "payDate: bankDateForReconcile(r.pay_date),", "payDate: r.pay_date,"),
    # --- vendor ---
    ("vendor-check-ignored", VA, "  if (!deadline.ok) {\n    return { problems:", "  if (false) {\n    return { problems:"),
    # --- account-check files ---
    ("check-file-deadline-removed", OS, "  if (!timely.ok) return { ok: false, error: `Timberland deadline: this file was NOT released. ${timely.error}` };\n", ""),
    ("page-release-not-gated", OP, "{!live && effTimely.ok ? (", "{!live ? ("),
    # --- the 1 pm cron ---
    ("claim-not-released", RT, "      await db.from(\"compliance_reminder_log\").delete().eq(\"dedupe_key\", r.dedupeKey);\n", ""),
    ("claim-error-ignored", RT, "    if (claimError) {", "    if (false) {"),
    ("unreadable-ledger-200", RT, "`ACH files could not be read: ${open.error}` }, { status: 500 });", "`ACH files could not be read: ${open.error}` }, { status: 200 });"),
    ("cron-one-tick", VJ, "\"schedule\": \"0 20-21/1 * * *\"", "\"schedule\": \"0 20 * * *\""),
    # --- the daily reminders ---
    ("daily-reminders-dropped", CR, "for (const d of planDeadlineReminders(todayIso, open.files)) {", "for (const d of planDeadlineReminders(todayIso, []).slice(0, 0)) {"),
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
