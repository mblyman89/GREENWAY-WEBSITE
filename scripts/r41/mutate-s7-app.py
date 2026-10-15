#!/usr/bin/env python3
"""scripts/r41/mutate-s7-app.py - R41 S7: test the tests for the app layer of
Timberland's prenote wait (section 6: "at least 6 banking days following the
settlement date of the prenotification Entry") and the first-file gate.

The plan's named mutants (R41-TIMBERLAND-SLICE-PLAN v4, S7): 6 changed to 3;
calendar days instead of banking days; the first-file gate bypassed. Plus the
gate's stages, the backwards plan, the Guide wiring and the error words.

Each mutant changes ONE thing; then the pure self-tests (run-pure-selftests.ts)
OR the S7 / S3 / ops vitest files must FAIL. Files are restored after each
mutant and checked byte-for-byte at the end; a control run must pass first and
last. The test that reads THIS script's log is left out of every run (-t), so
a stale log can never "kill" a mutant.

    python3 scripts/r41/mutate-s7-app.py | tee scripts/r41/mutate-s7-app.last.log
"""
import subprocess
import sys

PCORE = "src/lib/payments/timberland-prenote-core.ts"
STORE = "src/lib/payments/ach-file-ledger-store.ts"
OPS = "src/lib/payments/ach-ops-core.ts"
COMP = "src/components/admin/payments/FirstFileToTimberland.tsx"
PAGE = "src/app/admin/settings/banking/guide/page.tsx"
T = [
    "tests/compliance/r41-s7-prenote-wait.test.ts",
    "tests/compliance/r41-s3-ach-files.test.ts",
    "tests/compliance/r39-ach-ops-core.test.ts",
]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- section 6: 6, banking days, from settlement ---
    ("six-to-three", PCORE, "  return addUsableDays(settlement, PRENOTE_WAIT_BANKING_DAYS);", "  return addUsableDays(settlement, 3);"),
    ("calendar-days", PCORE, "  return addUsableDays(settlement, PRENOTE_WAIT_BANKING_DAYS);", "  return new Date(Date.parse(`${settlement}T00:00:00Z`) + PRENOTE_WAIT_BANKING_DAYS * 86_400_000).toISOString().slice(0, 10);"),
    ("fed-days-not-usable", PCORE, "  return addUsableDays(settlement, PRENOTE_WAIT_BANKING_DAYS);", "  return addBankingDays(settlement, PRENOTE_WAIT_BANKING_DAYS);"),
    ("five-days", PCORE, "  return addUsableDays(settlement, PRENOTE_WAIT_BANKING_DAYS);", "  return addUsableDays(settlement, PRENOTE_WAIT_BANKING_DAYS - 1);"),
    ("ops-sends-nacha-day", OPS, 'const eligible = method === "prenote" ? prenoteLiveUploadDay(settlement) : addCalendarDays(settlement, 1);', 'const eligible = method === "prenote" ? addCalendarDays(settlement, 5) : addCalendarDays(settlement, 1);'),
    ("floor-constant-7", PCORE, "export const PRENOTE_DB_FLOOR_CALENDAR_DAYS = 8;", "export const PRENOTE_DB_FLOOR_CALENDAR_DAYS = 7;"),
    # --- the backwards plan ---
    ("plan-wait-short", PCORE, "  const prenoteSettleBy = subUsableDays(liveUploadBy, PRENOTE_WAIT_BANKING_DAYS);", "  const prenoteSettleBy = subUsableDays(liveUploadBy, 3);"),
    ("plan-upload-is-settle", PCORE, "  const prenoteUploadBy = latestUploadAndApproval(prenoteSettleBy).day;", "  const prenoteUploadBy = prenoteSettleBy;"),
    ("too-late-not-refused", PCORE, "  if (plan.prenoteSettleBy < earliestPrenoteEffective) {", "  if (false) {"),
    # --- the first-file gate (core) ---
    ("gate-any-status", PCORE, '    if (f.status !== "bank_approved") continue;\n', ""),
    ("gate-no-wait", PCORE, "    if (todayIso >= openedOn && passedOn.has(f.effectiveDate)) {", "    if (passedOn.has(f.effectiveDate)) {"),
    ("gate-no-pass-needed", PCORE, "    if (todayIso >= openedOn && passedOn.has(f.effectiveDate)) {", "    if (todayIso >= openedOn) {"),
    ("gate-counts-voided", PCORE, '  const live = files.filter((f) => f.status !== "voided").slice()', "  const live = files.slice()"),
    ("gate-day-early", PCORE, "    if (todayIso >= openedOn && passedOn.has(f.effectiveDate)) {", "    if (todayIso >= subUsableDays(openedOn, 1) && passedOn.has(f.effectiveDate)) {"),
    # --- the first-file gate (store and wiring) ---
    ("gate-bypassed", STORE, '  if (input.kind !== "prenote") {\n    const gate = await readFirstFileGate(fileDate);', '  if (false) {\n    const gate = await readFirstFileGate(fileDate);'),
    ("gate-payroll-only", STORE, '  if (input.kind !== "prenote") {\n    const gate', '  if (input.kind === "payroll") {\n    const gate'),
    ("gate-read-error-opens", STORE, "    if (!gate.ok) return gate;\n    if (!gate.gate.open)", "    if (gate.ok && !gate.gate.open)"),
    ("gate-reads-any-verification", STORE, '.eq("method", "prenote").eq("status", "passed").limit(GATE_READ_CAP + 1)', '.eq("method", "prenote").limit(GATE_READ_CAP + 1)'),
    ("gate-reads-any-file", STORE, '.select("id, status, effective_date, filename").eq("kind", "prenote")', '.select("id, status, effective_date, filename")'),
    ("odd-row-skipped", STORE, '    if (typeof r.id !== "string" || typeof r.status !== "string" || typeof r.filename !== "string" || !eff) return { ok: false, error: FIRST_FILE_READ_FAILED };', '    if (typeof r.id !== "string" || typeof r.status !== "string" || typeof r.filename !== "string" || !eff) continue;'),
    # --- words and the Guide ---
    ("error-unmapped", OPS, "  [/ACH_VERIFICATION_TIMBERLAND_WAIT/,", "  [/ACH_VERIFICATION_TIMBERLAND_WAIT_NEVER/,"),
    ("guide-section-dropped", PAGE, "        <FirstFileToTimberland today={today} firstPayday={sp.firstPayday} now={new Date()} />\n", ""),
    ("guide-anchor-renamed", COMP, '<section id="first-payroll"', '<section id="first-file"'),
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
