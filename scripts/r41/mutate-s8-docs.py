#!/usr/bin/env python3
"""scripts/r41/mutate-s8-docs.py - R41 S8: test the tests for the docs slice.

Each mutant changes ONE thing:
  - Q14 constant;
  - an open question;
  - a calendar task (cadence, quote, link, law id);
  - a library agreement entry (kind, source, quote, protection wording, link);
  - the library page;
  - the help text;
  - the test plan;
  - the roadmap;
  - the FR mirror.
Then the pure self-tests OR the S8 / R40 library / R40 calendar vitest files
must FAIL.

The library file is generated, so the library mutants edit the GENERATOR's
output file directly. The R40 idempotence test also catches them, by design.
Files are restored after each mutant and checked byte-for-byte at the end. A
control run must pass first and last. The test that reads THIS log is left
out of every run (-t), so a stale log can never "kill" a mutant.

    python3 scripts/r41/mutate-s8-docs.py | tee scripts/r41/mutate-s8-docs.last.log
"""
import subprocess
import sys

NACHA = "src/lib/payments/nacha-core.ts"
PROF = "src/lib/payments/timberland-profile-core.ts"
CAL = "src/lib/payments/ach-calendar-core.ts"
LIB = "src/lib/payments/ach-legal-library.ts"
PAGE = "src/app/admin/settings/banking/library/page.tsx"
HELP = "src/lib/admin/help-content.ts"
KB = "src/lib/admin/concierge-kb.ts"
PLAN = "docs/audit/TEST-PLAN.md"
ROAD = "docs/roadmap/R41-TIMBERLAND.md"
FR = "docs/authorities/ach/fr-2017-19135-prenote-three-banking-days.txt"
T = [
    "tests/compliance/r41-s8-docs.test.ts",
    "tests/compliance/r40-legal-library.test.ts",
    "tests/compliance/r40-ach-guide-calendar.test.ts",
]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- Q14 and the open questions ---
    ("q14-payroll-in-discretionary", NACHA, 'export const PAYROLL_BATCH_DISCRETIONARY_DATA: string = "";', 'export const PAYROLL_BATCH_DISCRETIONARY_DATA: string = "PAYROLL";'),
    ("q14-applies-to-ccd-too", NACHA, 'alpha(secCode === "PPD" && companyEntryDescription === "PAYROLL" ? PAYROLL_BATCH_DISCRETIONARY_DATA : "", 20)', 'alpha(PAYROLL_BATCH_DISCRETIONARY_DATA, 20)'),
    ("q18-default-lenient", PROF, '    strictDefault: "Test credits COUNT toward the daily and monthly limits (the stricter reading).",', '    strictDefault: "Test credits are ignored by the daily and monthly limits.",'),
    ("q20-id-renamed", PROF, '    id: "Q20",', '    id: "Q19",'),
    # --- calendar tasks ---
    ("task-cadence-once", CAL, '    id: "timberland_agreement_reread",\n    cadence: "annual",', '    id: "timberland_agreement_reread",\n    cadence: "once",'),
    ("task-quote-altered", CAL, '      text: "Maximum monthly aggregate limit of all credit files .......... $100,000.00",', '      text: "Maximum monthly aggregate limit of all credit files .......... $150,000.00",'),
    ("task-link-dead-anchor", CAL, '    href: "/admin/settings/banking/library#timberland",\n    hrefLabel: "Read Schedule F",', '    href: "/admin/settings/banking/library#timberland-f",\n    hrefLabel: "Read Schedule F",'),
    ("task-law-id-unknown", CAL, '    lawIds: ["timberland-schedule-f-notice"],', '    lawIds: ["timberland-schedule-g-notice"],'),
    ("task-dropped", CAL, '  {\n    id: "timberland_name_id_reconfirm",', '  {\n    id: "timberland_name_id_reconfirm_old",'),
    # --- library agreement entries ---
    ("lib-kind-statute", LIB, '    id: "timberland-s25-liability",\n    kind: "agreement",', '    id: "timberland-s25-liability",\n    kind: "statute",'),
    ("lib-source-url", LIB, '    source: "private: the owner\'s signed copy (not public); text mirrored, redacted, with its sha256",\n    quote: "25. Liability.', '    source: "https://www.timberlandbank.com/",\n    quote: "25. Liability.'),
    ("lib-quote-char", LIB, "shall be liable only for its gross negligence or willful misconduct", "shall be liable only for its negligence or willful misconduct"),
    ("lib-protect-dishonest", LIB, "cannot pull back a file already uploaded", "can pull back a file already uploaded"),
    # --- page, help, plan, roadmap, mirror ---
    ("page-section-renamed", PAGE, '<section id="timberland" className="space-y-4">', '<section id="agreement" className="space-y-4">'),
    ("page-private-source-linked", PAGE, '          <span data-private-source>{e.source.replace(/^private:\\s*/, "")}. The repository mirror is {e.sourceFile}.</span>', '          <a href={e.source}>{e.source}</a>'),
    ("page-agreement-in-laws", PAGE, 'const laws = ACH_LEGAL_LIBRARY.filter((e) => e.kind !== "case" && e.kind !== "agreement");', 'const laws = ACH_LEGAL_LIBRARY.filter((e) => e.kind !== "case");'),
    ("help-dropped", HELP, "Its last section, 'Your Timberland agreement', quotes", "Its last section quotes"),
    ("kb-link-dropped", KB, "(/admin/settings/banking/library#timberland)", "(/admin/settings/banking/library)"),
    ("plan-t360-dropped", PLAN, "- **T-360 (Four yearly Timberland tasks", "- **T-36O (Four yearly Timberland tasks"),
    ("roadmap-pr-dropped", ROAD, "| S7 | Section 6 prenote wait (6 banking days from settlement) and the first-file gate | #1381 |", "| S7 | Section 6 prenote wait (6 banking days from settlement) and the first-file gate | (pending) |"),
    ("fr-quote-altered", FR, "as soon as the third Banking Day", "as soon as the second Banking Day"),
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
