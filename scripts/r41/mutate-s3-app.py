#!/usr/bin/env python3
"""scripts/r41/mutate-s3-app.py - R41 S3: test the tests for the ACH file
ledger (ach-file-ledger-store), the download routes and the builders that
now take their File ID Modifier from the ledger. Each mutant changes ONE
thing; the S3 / R39 ops vitest files must then FAIL. The plan's three
(R41-TIMBERLAND-SLICE-PLAN-v2 S3): a download calls generate, a constant
modifier, the duplicate check removed. Files are restored after each mutant
and checked byte-for-byte at the end; a control run must pass first and last.

The tests that read THIS script's log are left out of every run (-t), so a
stale log can never "kill" a mutant.

    python3 scripts/r41/mutate-s3-app.py

The SQL side (0273) is mutated by scripts/r41/mutate-0273-sql.py.
"""
import subprocess
import sys

LS = "src/lib/payments/ach-file-ledger-store.ts"
LC = "src/lib/payments/ach-file-ledger-core.ts"
OC = "src/lib/payments/ach-ops-core.ts"
PS = "src/lib/payroll/payroll-store.ts"
VA = "src/app/admin/vendor-payments/actions.ts"
PR = "src/app/admin/payroll/[id]/download/route.ts"
FR = "src/app/admin/settings/banking/files/[id]/download/route.ts"
CR = "src/app/admin/settings/banking/operations/check-file/route.ts"
T = [
    "tests/compliance/r41-s3-ach-files.test.ts",
    "tests/compliance/r39-ach-ops-store-behaviour.test.ts",
    "tests/compliance/r39-ach-ops-wiring.test.ts",
]
RUN = ["timeout", "400", "npx", "vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- the plan's three ---
    ("download-calls-generate", PR, 'import { readLiveFileForSource } from "@/lib/payments/ach-file-ledger-store";',
     'import { readLiveFileForSource } from "@/lib/payments/ach-file-ledger-store";\nimport { generatePayrollNacha } from "@/lib/payroll/payroll-store";\nvoid generatePayrollNacha;'),
    ("constant-modifier", LS, "const built = input.build(next.modifier);", 'const built = input.build("A");'),
    ("duplicate-key-order-sensitive", LS, "entrySetHmac: hmac(entrySetKey(body))", "entrySetHmac: hmac(body)"),
    # --- serving ---
    ("sha-check-skipped", LS, "const c = checkStoredBody(body, row.sha256);\n  if (!c.ok) return c;", "const c = checkStoredBody(body, row.sha256);\n  void c;"),
    ("row-facts-not-rechecked", LS, "if (problems.length) return { ok: false, error: `The stored ACH file does not match its record", "if (false) return { ok: false, error: `The stored ACH file does not match its record"),
    ("voided-served-by-id", LS, 'if (row.status === "voided") return', "if (false) return"),
    ("voided-served-by-source", LS, '.neq("status", "voided")\n    .maybeSingle();\n  if (error) return', '.maybeSingle();\n  if (error) return'),
    ("voided-found-live", LS, '.neq("status", "voided")\n    .maybeSingle();\n  if (error || !data) return null;', '.maybeSingle();\n  if (error || !data) return null;'),
    # --- sealing ---
    ("key-check-removed", LS, "  if (!isAtRestEncryptionConfigured()) return { ok: false, error: LEDGER_NO_KEY };\n  const fileDate", "  const fileDate"),
    ("roundtrip-removed", LS, 'if (!bodyEnc.startsWith("encv1:") || decryptSecret(bodyEnc) !== body) return', "if (false) return"),
    ("built-not-checked", LS, "if (problems.length) return { ok: false, error: `The built file does not match", "if (false) return { ok: false, error: `The built file does not match"),
    ("no-crlf", LS, "const body = toCrlf(file);", "const body = file;"),
    ("utc-day", LS, "const fileDate = pacificDayKey(input.now);", "const fileDate = input.now.toISOString().slice(0, 10);"),
    ("used-letters-all-days", LS, '.select("file_id_modifier").eq("file_date", fileDate);', '.select("file_id_modifier");'),
    ("no-retry", LS, "if (!w.message.includes(MODIFIER_TAKEN_CONSTRAINT)) return", "if (true) return"),
    ("one-try", LS, "export const MODIFIER_RETRIES = 3;", "export const MODIFIER_RETRIES = 1;"),
    ("payroll-via-insert", LS, 'if (input.kind === "payroll") return { ok: false, error: "Payroll files are released with releasePayrollAchFile." };', ""),
    ("payroll-wrong-sha", LS, "p_sha256: s.sha256,", "p_sha256: s.entrySetHmac,"),
    ("hmac-purpose", LS, 'keyedHasher("achFileEntrySet")', 'keyedHasher("achAccountKey")'),
    ("void-reason-unchecked", LS, "const c = checkVoidReason(input.reason);\n  if (!c.ok) return c;\n  if (!/^[0-9a-f-]{36}$/i.test(input.fileId))",
     'const c = { ok: true as const, reason: String(input.reason ?? "") };\n  if (!/^[0-9a-f-]{36}$/i.test(input.fileId))'),
    ("constraint-name-drift", LC, "[/ach_files_no_duplicate_entries/,", "[/ach_files_no_duplicates/,"),
    # --- builders take the ledger's letter ---
    ("check-file-fixed-letter", OC, "    fileIdModifier: input.fileIdModifier,", '    fileIdModifier: input.method === "prenote" ? "P" : "M",'),
    ("payroll-clock-not-release-time", PS, "        createdAt: now,\n        fileIdModifier,", "        createdAt: new Date(),\n        fileIdModifier,"),
    ("vendor-records-on-failure", VA, "if (!released.ok || !built) {", "if (false) {"),
    # --- routes ---
    ("payroll-route-wrong-kind", PR, 'readLiveFileForSource("payroll", id)', 'readLiveFileForSource("vendor", id)'),
    ("files-route-no-nosniff", FR, '      "X-Content-Type-Options": "nosniff",\n', ""),
    ("check-route-builds", CR, 'import { checkFileSourceId } from "@/lib/payments/ach-ops-store";', 'import { checkFileSourceId, buildCheckFile } from "@/lib/payments/ach-ops-store";\nvoid buildCheckFile;'),
]

files = sorted({m[1] for m in M})
orig = {f: open(f).read() for f in files}


def run():
    return subprocess.run(RUN, capture_output=True, text=True).returncode


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
print("control", "pass" if c1 == 0 else f"FAILED {c1}")
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv or c1 != 0 else 0)
