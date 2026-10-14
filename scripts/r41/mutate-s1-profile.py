#!/usr/bin/env python3
"""scripts/r41/mutate-s1-profile.py - R41 S1: test the tests for the Timberland
profile and its verbatim mirrors. Each mutant changes ONE thing (a value, a
quote, a mirror line, a check, or a redaction). The R41 S1 vitest file OR the
pure self-test (timberland-profile-core, floor 42) must then FAIL. Files are
restored after each mutant and checked byte-for-byte at the end; a control run
must pass both.

    python3 scripts/r41/mutate-s1-profile.py

Long digit runs used below are built at run time so this public file never
holds a 9+ digit literal other than the routing number.
"""
import subprocess
import sys

P = "src/lib/payments/timberland-profile-core.ts"
AG = "docs/authorities/ach/timberland-ach-agreement-2026-10-09.redacted.txt"
BR = "docs/authorities/ach/timberland-brenda-2026-10.txt"
MF = "docs/authorities/MANIFEST.tsv"
RD = "docs/authorities/ach/README.md"
RS = "scripts/compliance/run-pure-selftests.ts"
T = ["tests/compliance/r41-s1-timberland-profile.test.ts"]
SELF = ["npx", "tsx", "-e",
        "import {__runTimberlandProfileCoreTests as t} from './src/lib/payments/timberland-profile-core';"
        "const r=t(); console.log(JSON.stringify(r)); if (r.failed>0 || r.passed<42) process.exit(1);"]
FAKE_ACCT = "12345" * 2 + "6048"

M = [
    # plan section S1 required mutants
    ("lead-2-to-1", P, "    value: 2,\n    kind: \"bank\",\n    label: \"A credit file must reach",
     "    value: 1,\n    kind: \"bank\",\n    label: \"A credit file must reach"),
    ("holiday-prior-to-next", P, 'value: "prior" as "prior" | "next",', 'value: "next" as "prior" | "next",'),
    ("quote-letter-changed", P, 'quote: "Cutoff time is 4 pm daily to have a file processed next day."',
     'quote: "Cutoff time is 4 pm daily to have a file processed nest day."'),
    ("daily-limit-plus-1-cent", P, "    value: 5_000_000,\n    kind: \"bank\",\n    label: \"No more than $50,000 of credit files",
     "    value: 5_000_001,\n    kind: \"bank\",\n    label: \"No more than $50,000 of credit files"),
    # more values
    ("per-file-limit-drift", P, "    value: 5_000_000,\n    kind: \"bank\",\n    label: \"No single file (ACH Batch)",
     "    value: 4_999_999,\n    kind: \"bank\",\n    label: \"No single file (ACH Batch)"),
    ("monthly-limit-drift", P, "    value: 10_000_000,", "    value: 10_000_100,"),
    ("routing-drift", P, '    value: "325170754",', '    value: "325170755",'),
    ("last4-drift", P, '    value: "6048",', '    value: "6049",'),
    ("same-day-allowed", P, "Yes [X] No", "Yes [X] Nx"),
    ("ctx-allowed", P, 'value: ["PPD", "CCD"] as readonly string[],', 'value: ["PPD", "CCD", "CTX"] as readonly string[],'),
    ("cutoff-5pm", P, "{ hour: 16, minute: 0, tz:", "{ hour: 17, minute: 0, tz:"),
    ("funding-10am", P, "{ hour: 9, minute: 0, tz:", "{ hour: 10, minute: 0, tz:"),
    ("return-fee-drift", P, "perReturnOrNoc: 500,", "perReturnOrNoc: 550,"),
    ("phone-drift", P, '    value: "1-800-562-8761",', '    value: "1-800-562-8762",'),
    ("margin-made-bank-rule", P, '    value: 30,\n    kind: "greenway_policy",', '    value: 30,\n    kind: "bank",'),
    ("q14-dropped", P, '    id: "Q14",', '    id: "Q15",'),
    # the checks themselves
    ("daily-check-removed", P, '  need(q("limitDailyInProcessCents")[0]!.endsWith(`$ ${centsToUsdText(p.limitDailyInProcessCents.value)}`), "daily limit not in its quote");\n', ""),
    ("long-digit-scan-off", P, "  return (text.match(/\\d{9,}/g) ?? []).filter((m) => !allowed.includes(m));",
     "  return (text.match(/\\d{19,}/g) ?? []).filter((m) => !allowed.includes(m));"),
    ("flatten-noop", P, "export function flattenWs(", "export function flattenWsX("),
    # mirrors
    ("mirror-cutoff-edited", BR, "Cutoff time is 4 pm daily", "Cutoff time is 5 pm daily"),
    ("mirror-limit-edited", AG, "Maximum daily aggregate limit of all credit files", "Maximum daily aggregate limit of all credit file"),
    ("mirror-account-leak", AG, "[ACCOUNT ENDING 6048] maintained at Timberland Bank", FAKE_ACCT + " maintained at Timberland Bank"),
    ("mirror-email-leak", BR, "Cutoff time is 4 pm daily", "Write to someone@example.com. Cutoff time is 4 pm daily"),
    ("mirror-phone-leak", BR, "Cutoff time is 4 pm daily", "Call 360-555-0142. Cutoff time is 4 pm daily"),
    # provenance
    ("manifest-bytes-wrong", MF, "\t48973\t721\t12", "\t48974\t721\t12"),
    ("readme-row-dropped", RD, "timberland-ach-agreement-2026-10-09.redacted.txt", "timberland-agreement.txt"),
    # registration
    ("selftest-floor-lowered", RS, 'assertRan("timberland-profile-core", __runTimberlandProfileCoreTests(), 42)',
     'assertRan("timberland-profile-core", __runTimberlandProfileCoreTests(), 1)'),
]

files = sorted({m[1] for m in M})
orig = {f: open(f).read() for f in files}


def run_all():
    v = subprocess.run(["timeout", "300", "npx", "vitest", "run", *T], capture_output=True, text=True)
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
