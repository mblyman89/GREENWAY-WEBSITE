#!/usr/bin/env python3
"""scripts/r41/mutate-s13-app.py - R41 S13: test the tests for the three new
Timberland log types (wrong NOC, OFAC notice, bank report), the refuse-by
wording, the 0287 error message and the reversal call sheet (core, route and
the Operations link).

Each mutant changes ONE thing; then the pure self-tests (run-pure-selftests.ts)
OR the S10/S13 vitest files must FAIL. Files are restored after each mutant and
checked byte-for-byte at the end; a control run must pass first and last. The
tests that read a .last.log are left out of every run (-t), so a stale log can
never "kill" a mutant.

    python3 scripts/r41/mutate-s13-app.py | tee scripts/r41/mutate-s13-app.last.log
"""
import subprocess
import sys

CORE = "src/lib/payments/timberland-obligations-core.ts"
SHEET = "src/lib/payments/ach-reversal-sheet-core.ts"
ROUTE = "src/app/admin/settings/banking/files/[id]/reversal-sheet/route.ts"
OPS = "src/app/admin/settings/banking/operations/page.tsx"
T = [
    "tests/compliance/r41-s13-notices.test.ts",
    "tests/compliance/r41-s10-obligations.test.tsx",
]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- clocks (pure) ---
    ("wrong NOC counted in banking days", CORE, "    const due = addCalendarDays(r.received_on, REFUSED_NOC_CALENDAR_DAYS);\n    return { ...base, title: `Reject the wrong correction", "    const due = addBankingDays(r.received_on, REFUSED_NOC_CALENDAR_DAYS);\n    return { ...base, title: `Reject the wrong correction"),
    ("wrong NOC 16 days", CORE, "    const due = addCalendarDays(r.received_on, REFUSED_NOC_CALENDAR_DAYS);\n    return { ...base, title: `Reject the wrong correction", "    const due = addCalendarDays(r.received_on, REFUSED_NOC_CALENDAR_DAYS + 1);\n    return { ...base, title: `Reject the wrong correction"),
    ("wrong NOC has no clock", CORE, '  if (t === "noc_wrong") {', '  if (t === ("x" as string)) {'),
    ("OFAC notice not red", CORE, 'dueText: "No deadline in the agreement: open until Cash Management says it is resolved", tone: "danger"', 'dueText: "No deadline in the agreement: open until Cash Management says it is resolved", tone: "neutral"'),
    ("OFAC notice given a made-up deadline", CORE, '    return { ...base, title: "Possible OFAC match reported by Timberland", dueDate: null,', '    return { ...base, title: "Possible OFAC match reported by Timberland", dueDate: addCalendarDays(r.received_on, 30),'),
    ("bank report 90 days", CORE, "export const FED_REPORT_RETENTION_CALENDAR_DAYS = 60;", "export const FED_REPORT_RETENTION_CALENDAR_DAYS = 90;"),
    ("bank report counted from today", CORE, "    const due = addCalendarDays(r.received_on, FED_REPORT_RETENTION_CALENDAR_DAYS);", "    const due = addCalendarDays(todayIso, FED_REPORT_RETENTION_CALENDAR_DAYS);"),
    ("new type has no Done (spec clock false)", CORE, "    quote: E3(\"Email 3, answer 21 (Q26)\"", "    clock: false as boolean,\n    quote: E3(\"Email 3, answer 21 (Q26)\""),
    ("new type not offered", CORE, '  "statement_received",\n  "noc_wrong",\n  "ofac_notice",\n', '  "statement_received",\n  "noc_wrong",\n'),
    ("refuse line back to in writing", CORE, "action: `If the correction is wrong, contact Timberland Cash Management (${TIMBERLAND_PHONE}) before this date", "action: `If the correction is wrong, tell Timberland in writing (${TIMBERLAND_PHONE}) before this date"),
    ("0287 error not named", CORE, '  [/ach_timberland_comms_entry_type_check/, "This kind of entry is not set up yet: run migration 0287 (docs/MIGRATIONS_TO_RUN.md). Nothing was saved."],\n', ""),
    ("Fed quote reworded", CORE, 'text: "Reports are retained in the portal for 60 calendar days and then automatically deleted." }', 'text: "Reports are kept in the portal for 60 calendar days and then automatically deleted." }'),
    # --- reversal sheet (pure) ---
    ("sheet shows the account field", SHEET, "    out.push({ seq: Number(trace.slice(8)), name: r.slice(54, 76).trim(),", "    out.push({ seq: Number(trace.slice(8)), name: `${r.slice(54, 76).trim()} ${r.slice(12, 29).trim()}`,"),
    ("sheet shows the routing", SHEET, "kindText: KIND_TEXT[code] ?? `transaction code ${code}` });", "kindText: `${KIND_TEXT[code] ?? code} ${r.slice(3, 12)}` });"),
    ("sheet for a released file", SHEET, 'export const SHEET_STATUSES = ["uploaded", "bank_approved"] as const;', 'export const SHEET_STATUSES = ["released", "uploaded", "bank_approved"] as const;'),
    ("sheet ignores a record mismatch", SHEET, "  if (f.facts.entryCount !== row.entry_count || f.facts.totalCreditCents !== Number(row.total_cents) || f.facts.effectiveDate !== row.effective_date || f.facts.modifier !== row.file_id_modifier) {", "  if (false) {"),
    ("sheet amount off by a field", SHEET, "    const amount = r.slice(29, 39);", "    const amount = r.slice(28, 38);"),
    ("sheet upload time in UTC", SHEET, 'timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", year: "numeric"', 'timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric"'),
    ("sheet wrong phone", SHEET, "    `Call Timberland Bank, Cash Management: ${TIMBERLAND_PHONE}`,", "    `Call Timberland Bank, Cash Management: the number on your statement`,"),
    # --- route and link ---
    ("route without permission check", ROUTE, '  const session = await requirePermission("settings.manage");', '  const session = { profile: { id: "x" }, email: "x" };'),
    ("route cached", ROUTE, '      "Cache-Control": "no-store",\n      "X-Content-Type-Options"', '      "Cache-Control": "public, max-age=3600",\n      "X-Content-Type-Options"'),
    ("route skips the sheet check", ROUTE, "  const sheet = reversalSheet(res.body, res.row);", "  const sheet = { ok: true as const, text: res.body };"),
    ("link shown for every file", OPS, '{f.status === "uploaded" || f.status === "bank_approved" ? (\n                            <a href={`/admin/settings/banking/files/${f.id}/reversal-sheet`}', '{true ? (\n                            <a href={`/admin/settings/banking/files/${f.id}/reversal-sheet`}'),
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
