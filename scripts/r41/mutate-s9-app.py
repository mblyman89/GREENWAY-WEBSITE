#!/usr/bin/env python3
"""scripts/r41/mutate-s9-app.py - R41 S9: test the tests for the "get rolling"
helpers: the funding helper (Timberland section 14, 9:00 a.m. on the
settlement date; the $50 Schedule B fee line; at least the file total), the
8 am settlement-day reminder cron, the confirm-funding store call, the file
checker's audit (fingerprint and rule ids only) and the go-live board's strict
reads (unread is never green).

Each mutant changes ONE thing; then the pure self-tests (run-pure-selftests.ts)
OR the S9 vitest file must FAIL. Files are restored after each mutant and
checked byte-for-byte at the end; a control run must pass first and last. The
test that reads THIS script's log is left out of every run (-t), so a stale
log can never "kill" a mutant.

    python3 scripts/r41/mutate-s9-app.py | tee scripts/r41/mutate-s9-app.last.log
"""
import subprocess
import sys

FCORE = "src/lib/payments/timberland-funding-core.ts"
STORE = "src/lib/payments/ach-file-ledger-store.ts"
CRON = "src/app/api/cron/ach-funding-8am/route.ts"
GCORE = "src/lib/payments/timberland-golive-core.ts"
GSTORE = "src/lib/payments/timberland-golive-store.ts"
CHK = "src/app/admin/settings/banking/checker/actions.ts"
T = [
    "tests/compliance/r41-s9-get-rolling.test.ts",
]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- funding helper (pure) ---
    ("deadline 9:00 -> 10:00", FCORE, "h: FUNDING_DEADLINE.hour, m:", "h: FUNDING_DEADLINE.hour + 1, m:"),
    ("monthly fee line dropped to 0", FCORE, "cents: FEES.serviceMonthly },", "cents: 0 },"),
    ("form accepts less than the file total", FCORE, "if (cents < i.totalCents) {", "if (cents < 0) {"),
    ("reminder window opens before 8 am", FCORE, "nowUtc < from || nowUtc >= plan.deadlineUtc", "nowUtc >= plan.deadlineUtc"),
    ("reminder sent after the 9:00 deadline", FCORE, "nowUtc < from || nowUtc >= plan.deadlineUtc", "nowUtc < from"),
    ("bank-approved files get no reminder", FCORE, 'f.status !== "uploaded" && f.status !== "bank_approved") continue;', 'f.status !== "uploaded") continue;'),
    ("reminder hour 8 -> 7", FCORE, "export const FUNDING_REMINDER = { hour: 8, minute: 0 }", "export const FUNDING_REMINDER = { hour: 7, minute: 0 }"),
    # --- store and cron ---
    ("store sends the wrong amount", STORE, "p_amount_cents: input.amountCents,", "p_amount_cents: input.amountCents + 1,"),
    ("reminder read misses today's files", STORE, '.lte("effective_date", todayIso)', '.lt("effective_date", todayIso)'),
    ("unreadable ledger is silent", CRON, "[fundingReadFailedReminder(now, read.error)]", "[]"),
    ("failed email keeps the claim", CRON, 'await db.from("compliance_reminder_log").delete().eq("dedupe_key", r.dedupeKey);', "void 0;"),
    # --- checker audit ---
    ("checker audits the raw text", CHK, "after: { sha256: fingerprints(t.raw).exact,", "after: { raw: t.raw, sha256: fingerprints(t.raw).exact,"),
    # --- go-live board ---
    ("staff read error counts as no staff", GSTORE, "if (error || !Array.isArray(data) || data.length > STAFF_READ_CAP) return null;", "if (error || !Array.isArray(data)) return [];"),
    ("inbox read error counts as zero", GSTORE, "if (p.error || r.error || !Array.isArray(p.data) || !Array.isArray(r.data)) return null;", "if (p.error || r.error || !Array.isArray(p.data) || !Array.isArray(r.data)) return { pending: 0, toReview: 0 };"),
    ("broken staff row accepted", GSTORE, 'typeof r.active !== "boolean" || ', ""),
    ("unreadable match card counts as confirmed", GSTORE, "matchConfirmed: t ? t.matchConfirmed : null,", "matchConfirmed: t ? t.matchConfirmed : true,"),
    ("two owners accepted", GCORE, "if (owners.length !== 1) {", "if (owners.length < 1) {"),
    ("a third ACH role accepted", GCORE, "achRoles.length === 2 && ", ""),
    ("passed deadline not red", GCORE, 'tone: left === "passed" ? "red" : "info",', 'tone: "info",'),
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
