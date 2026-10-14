#!/usr/bin/env python3
"""scripts/r41/mutate-s2-originator.py - R41 S2: test the tests for the
Timberland originator validator, its wiring, and the "what Timberland sees"
preview. Each mutant changes ONE thing. The S2 vitest files OR one of the pure
self-tests (timberland-originator-core 68, nacha-core 87 (R41 S3),
timberland-preview-core 19) must then FAIL. Files are restored after each
mutant and checked byte-for-byte at the end; a control run must pass.

    python3 scripts/r41/mutate-s2-originator.py

The SQL side (0272) is mutated by scripts/r41/mutate-0272-sql.py.
"""
import subprocess
import sys

OC = "src/lib/payments/timberland-originator-core.ts"
NC = "src/lib/payments/nacha-core.ts"
PV = "src/lib/payments/timberland-preview-core.ts"
BA = "src/app/admin/settings/banking/actions.ts"
PS = "src/lib/payroll/payroll-store.ts"
VA = "src/app/admin/vendor-payments/actions.ts"
OS = "src/lib/payments/ach-ops-store.ts"
GS = "src/lib/payments/ach-guide-store.ts"
PP = "src/app/admin/payroll/page.tsx"
PI = "src/app/admin/payroll/[id]/page.tsx"
VP = "src/app/admin/vendor-payments/page.tsx"
BP = "src/app/admin/settings/banking/page.tsx"
AP = "src/app/admin/settings/banking/approvals/actions.ts"
RS = "scripts/compliance/run-pure-selftests.ts"
T = [
    "tests/compliance/r41-s2-originator.test.ts",
    "tests/compliance/r41-s0-owner-authority.test.ts",
    "tests/compliance/r39-ach-ops-store-behaviour.test.ts",
    "tests/compliance/r39-nacha-prenote.test.ts",
]
SELF = ["npx", "tsx", "-e",
        "import {__runTimberlandOriginatorCoreTests as a} from './src/lib/payments/timberland-originator-core';"
        "import {__runNachaCoreTests as b} from './src/lib/payments/nacha-core';"
        "import {__runTimberlandPreviewCoreTests as c} from './src/lib/payments/timberland-preview-core';"
        "const r=[a(),b(),c()]; const f=[68,87,19]; console.log(JSON.stringify(r));"
        "if (r.some((x,i)=>x.failed>0||x.passed<f[i])) process.exit(1);"]

M = [
    # --- the validator (Brenda answers 1-3, agreement section 1) ---
    ("ein-check-off", OC, "  if (ein && v !== expectedCompanyId(ein)) {", "  if (false && ein && v !== expectedCompanyId(ein)) {"),
    ("accept-9-digit-id", OC, "  if (/^\\d{9}$/.test(v)) {\n    return { field, message: `${label} \"${v}\" is only 9 digits.",
     "  if (false) {\n    return { field, message: `${label} \"${v}\" is only 9 digits."),
    ("id-prefix-any-digit", OC, "  if (!/^1\\d{9}$/.test(v)) {", "  if (!/^\\d{10}$/.test(v)) {"),
    ("routing-check-off", OC, "  if (routing !== TIMBERLAND_ROUTING) {", "  if (false) {"),
    ("odfi-check-off", OC, "  if (odfi !== TIMBERLAND_ODFI) {", "  if (false) {"),
    ("name-check-off", OC, "  if (alpha(name, 16) !== BATCH_COMPANY_NAME) {", "  if (false) {"),
    ("ein-missing-ok", OC, "  if (!einRaw) {\n    out.push({", "  if (false) {\n    out.push({"),
    ("allow-ctx", OC, "  if (ALLOWED_SEC.includes(sec)) return null;", "  if (ALLOWED_SEC.includes(sec) || sec === \"CTX\") return null;"),
    ("readiness-ignores-problems", OC, "  const ready = fileProblems.length === 0;", "  const ready = true;"),
    ("account-last4-ignored", OC, "  else if (last4 !== ACCOUNT_LAST4) accountProblems.push(", "  else if (false) accountProblems.push("),
    # --- the after-build shape check ---
    ("shape-name-off", OC, "    if (b.slice(4, 20) !== BATCH_COMPANY_NAME) bad.push(", "    if (false) bad.push("),
    ("shape-odfi-off", OC, "    if (b.slice(79, 87) !== TIMBERLAND_ODFI) bad.push(", "    if (false) bad.push("),
    ("shape-debit-off", OC, "    if (c.slice(20, 32) !== \"0\".repeat(12)) bad.push(\"a batch has a debit total\");", ""),
    # --- the builder ---
    ("builder-skips-sec", NC, "  if (secProblem) return { ok: false, error: secProblem };", ""),
    ("builder-skips-originator", NC, "  if (originatorProblem) return { ok: false, error: originatorProblem };", ""),
    ("builder-skips-shape", NC, "  if (shape.length) return { ok: false, error:", "  if (false) return { ok: false, error:"),
    # --- preview must be the builder's own records ---
    ("preview-wrong-batch-desc", PV, "  const bh = batchHeaderRecord(originator, secCode, ", "  const bh = \"5\" + batchHeaderRecord(originator, secCode, "),
    # --- wiring: save, confirm, pages, stores ---
    ("save-validation-removed", BA, "  if (problems.length) {\n    redirect(", "  if (false) {\n    redirect("),
    ("save-ein-filter-widened", BA, ".filter((p) => p.field !== \"companyEin\")", ".filter((p) => p.field === \"destinationName\")"),
    ("confirm-ungated", BA, "    \"timberland_setup.confirm\",\n    formData,", "    \"banking_settings.save\",\n    formData,"),
    ("confirm-no-stamp-check", BA, "  if (problem) redirect(`${ROOT}?tab=company&error=", "  if (false) redirect(`${ROOT}?tab=company&error="),
    ("confirm-not-audited", BA, "    action: \"banking.timberland.confirm\",", "    action: \"banking.settings.save\","),
    ("replay-drops-kind", AP, "\"timberland_setup.confirm\"", "\"timberland_setup.confirmx\""),
    ("payroll-page-old-check", PP, "  const originatorReady = readiness.ready;", "  const originatorReady = Boolean(readiness.originator || readiness.problems.length < 99);"),
    ("payroll-id-page-old-check", PI, "  const originatorReady = readiness.ready;", "  const originatorReady = true;"),
    ("vendor-page-old-check", VP, "  const originatorReady = readiness.ready;", "  const originatorReady = !!readiness;"),
    ("banking-page-complete-ready", BP, "  const achComplete = readiness.complete;", "  const achComplete = readiness.ready;"),
    ("ops-store-bypass", OS, "  const { readiness } = await getOriginatorReadiness();\n  if (!readiness.originator) {",
     "  const { readiness, settings } = await getOriginatorReadiness();\n  if (!settings) {"),
    ("guide-old-fields", GS, "  const companyMissing = [...originatorReadiness(settings, ein).problems];", "  const companyMissing: string[] = [];"),
    # --- registration ---
    ("floor-lowered", RS, "__runTimberlandOriginatorCoreTests(), 68)", "__runTimberlandOriginatorCoreTests(), 1)"),
]

files = sorted({m[1] for m in M})
orig = {f: open(f).read() for f in files}


def run_all():
    v = subprocess.run(["timeout", "400", "npx", "vitest", "run", *T], capture_output=True, text=True)
    s = subprocess.run(["timeout", "120", *SELF], capture_output=True, text=True)
    return v.returncode, s.returncode


surv = []
for name, f, a, b in M:
    s0 = orig[f]
    if s0.count(a) != 1:
        print(f"ANCHOR count={s0.count(a)} {name}", flush=True)
        surv.append(name)
        continue
    open(f, "w").write(s0.replace(a, b, 1))
    try:
        vr, sr = run_all()
    finally:
        open(f, "w").write(s0)
    k = vr != 0 or sr != 0
    by = ",".join(x for x, c in (("vitest", vr), ("selftest", sr)) if c != 0) or "-"
    print(f"{'killed  ' if k else 'SURVIVED'} {name}  (failed: {by})", flush=True)
    if not k:
        surv.append(name)
for f in files:
    assert open(f).read() == orig[f], f
vr, sr = run_all()
ctl = vr == 0 and sr == 0
print("control", "pass" if ctl else f"FAILED vitest={vr} selftest={sr}")
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv or not ctl else 0)
