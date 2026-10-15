#!/usr/bin/env python3
"""scripts/r41/mutate-s10-app.py - R41 S10: test the tests for the obligation
clocks, the Timberland communications log (store, actions), the STOP card /
termination banner layout, the fees card and the go-live wiring.

Each mutant changes ONE thing; then the pure self-tests (run-pure-selftests.ts)
OR the S10 vitest file must FAIL. Files are restored after each mutant and
checked byte-for-byte at the end; a control run must pass first and last. The
test that reads THIS script's log is left out of every run (-t), so a stale
log can never "kill" a mutant.

    python3 scripts/r41/mutate-s10-app.py | tee scripts/r41/mutate-s10-app.last.log
"""
import subprocess
import sys

CORE = "src/lib/payments/timberland-obligations-core.ts"
STORE = "src/lib/payments/timberland-comms-store.ts"
ACT = "src/app/admin/settings/banking/comms-actions.ts"
LAY = "src/app/admin/settings/banking/layout.tsx"
PANEL = "src/app/admin/settings/banking/operations/ClocksPanel.tsx"
GSTORE = "src/lib/payments/timberland-golive-store.ts"
T = [
    "tests/compliance/r41-s10-obligations.test.tsx",
]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- clocks (pure) ---
    ("reversal takes the LATER of the two limits", CORE, "const dueUtc = Date.parse(hours) < Date.parse(dayCut) ? hours : dayCut;", "const dueUtc = Date.parse(hours) > Date.parse(dayCut) ? hours : dayCut;"),
    ("compromise confirmation 2 days", CORE, "COMPROMISE_WRITTEN_CONFIRM_CALENDAR_DAYS * 86_400_000", "(COMPROMISE_WRITTEN_CONFIRM_CALENDAR_DAYS + 1) * 86_400_000"),
    ("reserve counted in calendar days", CORE, "const due = addBankingDays(r.received_on, RESERVE_BANKING_DAYS);", "const due = addCalendarDays(r.received_on, RESERVE_BANKING_DAYS);"),
    ("auth copy one banking day short", CORE, "const due = addBankingDays(r.received_on, AUTH_COPY_BANKING_DAYS);", "const due = addBankingDays(r.received_on, AUTH_COPY_BANKING_DAYS - 1);"),
    ("over-limit lead 1 day", CORE, "const due = subUsableDays(r.effective_on, OVER_LIMIT_REQUEST_LEAD_BANKING_DAYS);", "const due = subUsableDays(r.effective_on, 1);"),
    ("statement window 31 days", CORE, "addCalendarDays(r.received_on, STATEMENT_REVIEW_CALENDAR_DAYS)", "addCalendarDays(r.received_on, STATEMENT_REVIEW_CALENDAR_DAYS + 1)"),
    ("refused NOC window 14 days", CORE, "addCalendarDays(n.received_on, REFUSED_NOC_CALENDAR_DAYS)", "addCalendarDays(n.received_on, REFUSED_NOC_CALENDAR_DAYS - 1)"),
    ("done items still shown", CORE, 'if (r.entry_type === "done" || closed.has(r.id)) continue;', 'if (r.entry_type === "done") continue;'),
    ("termination not red", CORE, 'tone: "danger", action: "Plan every payment after that day by check.', 'tone: "gold", action: "Plan every payment after that day by check.'),
    ("reversal says send a file", CORE, 'const how = DEBITS_ALLOWED ? "Send the reversal file" :', 'const how = !DEBITS_ALLOWED ? "Send the reversal file" :'),
    ("fees miss the per-item charge", CORE, "const totalCents = FEES.serviceMonthly + FEES.perReturnOrNoc * items;", "const totalCents = FEES.serviceMonthly;"),
    ("closed termination still in effect", CORE, '=== "termination_notice" && r.effective_on && !closed.has(r.id))', '=== "termination_notice" && r.effective_on)'),
    # --- store ---
    ("entry not stamped with the actor", STORE, "      created_by: input.actorId,\n", "      created_by: null,\n"),
    ("read failure looks like an empty log", STORE, "  if (error) return { ok: false, error: dbErr(error) };\n  const rows = (data ?? []) as CommsRow[];", "  if (error) return { ok: true, rows: [], capped: false };\n  const rows = (data ?? []) as CommsRow[];"),
    ("read not capped", STORE, "    .limit(COMMS_READ_CAP);", "    ;"),
    ("unknown item still closed", STORE, '  if (!target.data) return { ok: false, error: "That item could not be found. Reload the page." };', ""),
    ("notice count failure is zero", STORE, "  if (!verdict.complete) return null;", "  if (!verdict.complete) return { returns: 0, nocs: 0 };"),
    ("notice count ignores a failed page", STORE, "    return { rows: (data ?? []) as { notice_kind?: string }[], ok: !error };", "    return { rows: (data ?? []) as { notice_kind?: string }[], ok: true };"),
    ("notice count from the wrong month", STORE, '    .gte("received_on", first)', '    .gte("received_on", "2000-01-01")'),
    # --- actions ---
    ("bad form still written", ACT, "  const form = checkCommsForm((k) => fd.get(k) as string | null, pacificToday(), new Date());\n  if (!form.ok) back({ error: form.error });", "  const form = checkCommsForm((k) => fd.get(k) as string | null, pacificToday(), new Date());\n  if (!form.ok) return;"),
    ("redirect away from #clocks", ACT, "redirect(`${OPS}?${p.toString()}#clocks`);", "redirect(`${OPS}?${p.toString()}#files`);"),
    # --- layout / panel / go-live ---
    ("STOP card hidden from staff check skipped", LAY, 'if (!session || !can(session.profile.role, "ach.request")) return <>{children}</>;', "if (!session) return <>{children}</>;"),
    ("no termination banner", LAY, "        {ending ? (", "        {false ? ("),
    ("failed read says nothing is due", PANEL, "        ) : props.comms.ok && props.noticesOk ? (", "        ) : true ? ("),
    ("failed log read turns gates green", GSTORE, "const logged = comms && comms.ok ? loggedFacts(comms.rows) : null;", "const logged = comms && comms.ok ? loggedFacts(comms.rows) : { scheduleGEmail: true, accessReady: true, countersigned: true, dualApprovalOn: true };"),
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
