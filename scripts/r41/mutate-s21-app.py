#!/usr/bin/env python3
"""scripts/r41/mutate-s21-app.py - R41 S21: test the tests for the Test day
runbook (core, read-only store, page, sheet route, tab).

Each mutant changes ONE thing; then the pure self-tests (run-pure-selftests.ts)
OR the S21 vitest file must FAIL. Files are restored after each mutant and
checked byte-for-byte at the end; a control run must pass first and last. The
tests that read a .last.log are left out of every run (-t), so a stale log can
never "kill" a mutant.

    python3 scripts/r41/mutate-s21-app.py | tee scripts/r41/mutate-s21-app.last.log
"""
import subprocess
import sys

CORE = "src/lib/payments/ach-test-day-core.ts"
STORE = "src/lib/payments/ach-test-day-store.ts"
PAGE = "src/app/admin/settings/banking/test-day/page.tsx"
SHEET = "src/app/admin/settings/banking/test-day/sheet/route.ts"
TABS = "src/app/admin/settings/banking/BankingHelpTabs.tsx"
T = ["tests/compliance/r41-s21-test-day.test.ts"]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- steps follow the records ---
    ("originator unreadable counts as ready", CORE, "add(s.originator?.ready === true, {", "add(s.originator?.ready !== false, {"),
    ("account listed from files alone dropped", CORE, "const listed = checks.length > 0 || files.length > 0;", "const listed = checks.length > 0;"),
    ("a test credit counts as a prenote", CORE, 'const prenoteOpen = checks.filter((c) => c.open?.method === "prenote");', "const prenoteOpen = checks.filter((c) => c.open !== null);"),
    ("voided file counts", CORE, 'const live = (f: readonly TestDayFile[]) => f.filter((x) => x.status !== "voided");', "const live = (f: readonly TestDayFile[]) => f.filter(() => true);"),
    ("upload done from release alone", CORE, "add(sent.length > 0 || anyUploaded || gateOpen, {", "add(files.length > 0 || anyUploaded || gateOpen, {"),
    ("uploaded from released", CORE, 'const anyUploaded = files.some((f) => f.status === "uploaded" || f.status === "bank_approved");', 'const anyUploaded = files.some((f) => f.status !== "voided");'),
    ("approved from uploaded", CORE, 'const anyApproved = files.some((f) => f.status === "bank_approved");', 'const anyApproved = files.some((f) => f.status === "bank_approved" || f.status === "uploaded");'),
    ("pass done when gate unreadable", CORE, "add(gateOpen, {", "add(gateOpen || s.gate === null, {"),
    ("two nows", CORE, "      nowSeen = true;\n", ""),
    ("later shown as now", CORE, "    } else state = \"later\";", "    } else state = \"now\";"),
    ("next ignores now", CORE, 'return steps.find((s) => s.state === "now") ?? null;', 'return steps.find((s) => s.state !== "done") ?? steps[0] ?? null;'),
    ("wrong button label", CORE, 'button: "Release the file",', 'button: "Release file",'),
    ("e-sign advice dropped", CORE, "(your employee page: e-sign, or Documents to review)", "(your employee page)"),
    ("old-fields warning dropped", CORE, " The old bank fields on the employee record are not used for ACH.", ""),
    ("wait words dropped", CORE, "        ? `Wait until ${shortDate(eligible)} (${PRENOTE_WAIT_WORDS}).", "        ? `Wait until ${shortDate(eligible)}."),
    # --- timeline ---
    ("effective from today", CORE, "  const effective = earliestEffectiveDate(nowUtc);", "  const effective = latestUploadAndApproval(earliestEffectiveDate(nowUtc)).day;"),
    ("live from settlement", CORE, "  const liveFrom = prenoteLiveUploadDay(settlement);", "  const liveFrom = settlement;"),
    # --- what Brenda sees, questions, sheet ---
    ("prenote code wrong", CORE, 'transactionCode({ accountType: "checking", prenote: true })', 'transactionCode({ accountType: "checking", prenote: false })'),
    ("PPD dropped", CORE, "standard entry class PPD,", "standard entry class CCD,"),
    ("dual asked again", CORE, 'BANK_CHECKLIST.filter((i) => i.status === "ask" && i.ask.length > 0)', "BANK_CHECKLIST.filter((i) => i.ask.length > 0 || i.id === \"dual\")"),
    ("sheet digit guard dropped", CORE, '  if (hasLongDigitRun(text)) throw new Error("testDaySheet: a run of 7+ digits would be printed");\n', ""),
    ("sheet tick inverted", CORE, '[${st.state === "done" ? "x" : " "}]', '[${st.state === "now" ? "x" : " "}]'),
    ("sheet portal notes dropped", CORE, "  for (const n of PORTAL_NOTES) out.push(`  [ ] ${n}`);\n", ""),
    # --- store: read only, unreadable is null ---
    ("store: errored ops view used", STORE, "view && view.ready && !view.error", "view"),
    ("store: errored ledger used", STORE, "files && files.tableReady && !files.error", "files"),
    ("store: all file kinds", STORE, '.filter((f) => f.kind === "prenote")', ".filter(() => true)"),
    ("store: gate failure not null", STORE, "gate: gate && gate.ok ? {", "gate: gate ? {"),
    # --- page, sheet route, tab ---
    ("staff page", PAGE, '  await requirePermission("settings.manage");', '  await requirePermission("orders.view");'),
    ("page unknown shown as ready", PAGE, '{r.ok === null ? "unknown" : r.ok ? "ready" : "fix"}', '{r.ok === null ? "ready" : r.ok ? "ready" : "fix"}'),
    ("page encryption check dropped", PAGE, "{ ok: keySet,", "{ ok: true,"),
    ("staff sheet", SHEET, '  const session = await requirePermission("settings.manage");', '  const session = await requirePermission("orders.view");'),
    ("sheet cached", SHEET, '      "Cache-Control": "no-store",', '      "Cache-Control": "max-age=3600",'),
    ("sheet not audited", SHEET, '    action: "ach.test_day.sheet",', '    action: "ach.test_day",'),
    ("tab dropped", TABS, '  { key: "testday", href: "/admin/settings/banking/test-day", label: "Test day" },\n', ""),
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
