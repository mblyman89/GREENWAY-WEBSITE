#!/usr/bin/env python3
"""scripts/r41/mutate-s4-limits.py - R41 S4: test the tests for Timberland's
limits as hard blocks (timberland-limits-core, the ledger read and the check
inside releaseLoop, the room-left bar, the 80% notes). Each mutant changes ONE
thing; then the pure self-tests (run-pure-selftests.ts) OR the S4 / S3 / R39
ops vitest files must FAIL. The plan's three (R41-TIMBERLAND-SLICE-PLAN v4
S4): `>` changed to `>=`, the overlap window off by one day, prenotes
counted. Files are restored after each mutant and checked byte-for-byte at
the end; a control run must pass first and last.

The test that reads THIS script's log is left out of every run (-t), so a
stale log can never "kill" a mutant.

    python3 scripts/r41/mutate-s4-limits.py | tee scripts/r41/mutate-s4-limits.last.log
"""
import subprocess
import sys

LC = "src/lib/payments/timberland-limits-core.ts"
LS = "src/lib/payments/ach-file-ledger-store.ts"
PS = "src/lib/payroll/payroll-store.ts"
VA = "src/app/admin/vendor-payments/actions.ts"
VP = "src/app/admin/vendor-payments/page.tsx"
T = [
    "tests/compliance/r41-s4-timberland-limits.test.ts",
    "tests/compliance/r41-s3-ach-files.test.ts",
    "tests/compliance/r39-ach-ops-store-behaviour.test.ts",
]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "200", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- the plan's three ---
    ("file-limit-gte", LC, "if (newFile.totalCents > LIMIT_PER_FILE_CENTS)", "if (newFile.totalCents >= LIMIT_PER_FILE_CENTS)"),
    ("window-ends-day-early", LC, "f.fileDate <= day && day <= settlementOf(f)", "f.fileDate <= day && day < settlementOf(f)"),
    ("prenotes-counted", LC, 'if (f.kind === "prenote") return PRENOTES_COUNT;', 'if (f.kind === "prenote") return true;'),
    # --- the other boundaries ---
    ("entry-limit-gte", LC, "(a) => a > LIMIT_PER_ENTRY_CENTS", "(a) => a >= LIMIT_PER_ENTRY_CENTS"),
    ("daily-limit-gte", LC, "worstDay.total > LIMIT_DAILY_IN_PROCESS_CENTS", "worstDay.total >= LIMIT_DAILY_IN_PROCESS_CENTS"),
    ("monthly-limit-gte", LC, "if (total > LIMIT_MONTHLY_CENTS)", "if (total >= LIMIT_MONTHLY_CENTS)"),
    ("window-starts-day-late", LC, "f.fileDate <= day && day <= settlementOf(f)", "f.fileDate < day && day <= settlementOf(f)"),
    ("warn-strictly-over-80", LC, "total * 100 >= limit * WARN_AT_PERCENT", "total * 100 > limit * WARN_AT_PERCENT"),
    # --- what counts ---
    ("voided-counted", LC, '  if (f.status === "voided") return false;\n  if (f.kind === "prenote")', '  if (f.kind === "prenote")'),
    ("test-credits-free", LC, 'if (f.kind === "prenote") return PRENOTES_COUNT;', 'if (f.kind === "prenote") return PRENOTES_COUNT;\n  if (f.kind === "micro_entry") return false;'),
    ("weekend-effective-not-moved", LC, "return f.settlementDate ?? nextBankingDayOnOrAfter(f.effectiveDate);", "return f.settlementDate ?? f.effectiveDate;"),
    ("stored-settlement-ignored", LC, "return f.settlementDate ?? nextBankingDayOnOrAfter(f.effectiveDate);", "return nextBankingDayOnOrAfter(f.effectiveDate);"),
    ("month-upload-only-ledger", LC, "(monthKey(f.fileDate) === month || monthKey(f.effectiveDate) === month)", "monthKey(f.fileDate) === month"),
    ("month-upload-only-new-file", LC, "[...new Set([monthKey(newFile.fileDate), monthKey(newFile.effectiveDate)])]", "[monthKey(newFile.fileDate)]"),
    ("window-start-month-only", LC, "return back < first ? back : first;", "return first;"),
    # --- earliest fit / higher-limit lead ---
    ("fit-lead-one-day", LC, "const minEffective = addBankingDays(upload, CREDIT_LEAD_BANKING_DAYS);", "const minEffective = addBankingDays(upload, 1);"),
    ("higher-limit-lead-one-day", LC, "addBankingDays(newFile.fileDate, OVER_LIMIT_REQUEST_LEAD_BANKING_DAYS)", "addBankingDays(newFile.fileDate, 1)"),
    # --- the store: the one choke point ---
    ("check-not-enforced", LS, "    if (!limits.ok) return { ok: false, error: limitRefusalMessage(limits) };\n", ""),
    ("read-failure-empty-ledger", LS, "const ledger = await readLedgerForLimits(fileDate);\n    if (!ledger.ok) return ledger;", "const ledger0 = await readLedgerForLimits(fileDate);\n    const ledger = ledger0.ok ? ledger0 : { ok: true as const, ledger: [] };"),
    ("read-includes-voided", LS, '    .neq("status", "voided")\n    .or(', "    .or("),
    ("read-by-file-date-only", LS, ".or(`file_date.gte.${start},effective_date.gte.${start},settlement_date.gte.${start}`)", ".gte(\"file_date\", start)"),
    ("read-cap-ignored", LS, "if (data.length > LIMITS_READ_CAP) return", "if (false) return"),
    ("null-amount-as-number", LS, "if (!Number.isSafeInteger(cents) || cents < 0) return null;", "if (cents < 0) return null;"),
    ("entries-not-read", LS, "entryAmountsCents: entryAmountsFromFile(built.file)", "entryAmountsCents: []"),
    ("warnings-dropped", LS, "limitWarnings: limits.warnings.map((x) => x.message)", "limitWarnings: []"),
    ("room-bar-misread", LS, "return { ok: true, room: roomLeft(r.ledger, today) };", "return { ok: true, room: roomLeft([], today) };"),
    # --- the people see it ---
    ("payroll-notes-dropped", PS, "notes: [...notes, ...released.limitWarnings]", "notes"),
    ("vendor-notes-dropped", VA, "    limitWarnings: released.limitWarnings,\n    file: released.body,", "    file: released.body,"),
    ("vendor-bar-removed", VP, "        <TimberlandRoomLeft today={pacificToday()} />\n", ""),
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
