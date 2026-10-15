"""R39 S7 - mutation run on src/lib/payments/ach-ops-core.ts.
Each mutant must make tests/compliance/r39-ach-ops-core.test.ts fail (it also
runs the core's own self-tests). The source is restored after every mutant and
checked byte-for-byte at the end."""
import subprocess, shutil, sys
F = "src/lib/payments/ach-ops-core.ts"
T = "tests/compliance/r39-ach-ops-core.test.ts"
M = [
    # effective date
    ('return nextBankingDayOnOrAfter(addCalendarDays(todayIso, 1));', 'return nextBankingDayOnOrAfter(todayIso);'),
    ('if (d <= todayIso) return', 'if (d < todayIso) return'),
    ('if (!isFedAchBankingDay(d)) return', 'if (false) return'),
    ('if (daysBetween(todayIso, d) > MAX_EFFECTIVE_DAYS_AHEAD) return', 'if (false) return'),
    ('new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) {', 'false) {'),
    # file plan
    ('if (checks.length === 0) return', 'if (false) return'),
    ('if (c.method !== method) return', 'if (false) return'),
    ('if (c.status !== "planned") return', 'if (false) return'),
    ('if (seen.has(c.verificationId)) return', 'if (false) return'),
    ('if (!isValidRouting(c.routing)) return { ok: false, error: `${c.payeeName}: the routing', 'if (false) return { ok: false, error: `${c.payeeName}: the routing'),
    ('if (!v.ok) return { ok: false, error: `${c.payeeName}: ${v.error}` };', ''),
    ('} else if (c.microCents !== null) {', '} else if (false) {'),
    ('amountCents: method === "prenote" ? 0 : (c.microCents as number),', 'amountCents: method === "prenote" ? 1 : (c.microCents as number),'),
    ('prenote: method === "prenote",\n', 'prenote: false,\n'),
    ('companyEntryDescription: method === "prenote" ? PAYROLL_DESCRIPTION : MICRO_ENTRY_DESCRIPTION,', 'companyEntryDescription: PAYROLL_DESCRIPTION,'),
    ('companyEntryDescription: method === "prenote" ? PAYROLL_DESCRIPTION : MICRO_ENTRY_DESCRIPTION,', 'companyEntryDescription: MICRO_ENTRY_DESCRIPTION,'),
    ('const eligible = method === "prenote" ? prenoteLiveUploadDay(settlement) : addCalendarDays(settlement, 1);', 'const eligible = method === "prenote" ? addCalendarDays(settlement, 3) : addCalendarDays(settlement, 1);'),
    ('const eligible = method === "prenote" ? prenoteLiveUploadDay(settlement) : addCalendarDays(settlement, 1);', 'const eligible = method === "prenote" ? prenoteLiveUploadDay(settlement) : settlement;'),
    ('ids: checks.map((c) => c.verificationId),', 'ids: checks.slice(1).map((c) => c.verificationId),'),
    ('const c = 1 + randomBelow(99);', 'const c = randomBelow(100);'),
    ('if (!Number.isInteger(c) || c < 1 || c > 99) throw', 'if (false) throw'),
    # next step
    ('return todayIso >= r.eligible_on\n      ? { kind: "pass_prenote"', 'return todayIso > r.eligible_on\n      ? { kind: "pass_prenote"'),
    ('return todayIso >= r.eligible_on\n    ? { kind: "ask_amount"', 'return todayIso > r.eligible_on\n    ? { kind: "ask_amount"'),
    ('if (r.method === "voided_check_callback") return { kind: "call"', 'if (false) return { kind: "call"'),
    # confirmed cents / finish
    ("if (/^\\d{1,2}$/.test(s)) return Number(s);", "if (/^\\d{1,3}$/.test(s)) return Number(s);"),
    ("const m = /^0?\\.(\\d{2})$/.exec(s);", "const m = /^\\d?\\.(\\d{2})$/.exec(s);"),
    ('if (cents === null || cents < 1) return', 'if (false) return'),
    ('if (i.method === "voided_check_callback" && note.length < MIN_CALLBACK_NOTE_CHARS) {', 'if (false) {'),
    ('} else if (note.length < 5) {', '} else if (note.length < 1) {'),
    ('if (i.outcome !== "passed" && i.outcome !== "failed" && i.outcome !== "cancelled") return', 'if (false) return'),
    # release
    ('if (!(CALLBACK_METHODS as readonly string[]).includes(method)) return', 'if (false) return'),
    ('if (note.length < MIN_CALLBACK_NOTE_CHARS) return { ok: false, error: `Write who confirmed', 'if (false) return { ok: false, error: `Write who confirmed'),
    # R41 S0 (D-6): owner only, no solo reason
    ('if (!i.actorIsOwner) return { ok: false, error: "Only Michael', 'if (false) return { ok: false, error: "Only Michael'),
    ('if (!i.actorIsOwner) return { ok: false, error: "Only Michael', 'if (!i.actorIsOwner && reason.length < 20) return { ok: false, error: "Only Michael'),
    ('[/ACH_OWNER_ONLY/, ', '[/ACH_OWNER_ONLYX/, '),
    ('for (const t of [note, reason]) if', 'for (const t of [reason]) if'),
    # review
    ('if (r.state !== "active") continue;', ''),
    ('if (days < 0) out.push', 'if (days < -1) out.push'),
    ('else if (days <= REVIEW_SOON_DAYS) out.push', 'else if (days < REVIEW_SOON_DAYS) out.push'),
    ('const rank = { missing_date: 0, overdue: 1, due_soon: 2 } as const;', 'const rank = { missing_date: 2, overdue: 1, due_soon: 0 } as const;'),
    ("if (note.length < 10) return { ok: false, error: 'Say what was checked", "if (note.length < 2) return { ok: false, error: 'Say what was checked"),
    # legal hold / retention
    ('if (reason.length < 10) return { ok: false, error: "Give the reason', 'if (reason.length < 2) return { ok: false, error: "Give the reason'),
    ('const v: RetentionVerdict = retentionVerdict({ signedOn: i.signedOn, endedOn: i.endedOn, legalHold: i.legalHold, today: i.todayIso });', 'const v: RetentionVerdict = retentionVerdict({ signedOn: i.signedOn, endedOn: i.endedOn, legalHold: false, today: i.todayIso });'),
    # monitor
    ('r.method === "micro_entry" && r.status !== "planned"', 'r.method === "micro_entry"'),
    ('&& !(r.status === "cancelled" && !r.result_code)', ''),
    ('const d30 = addCalendarDays(todayIso, -30);', 'const d30 = addCalendarDays(todayIso, -31);'),
    ('const in30 = micro.filter((r) => r.on > d30 && r.on <= todayIso);', 'const in30 = micro.filter((r) => r.on >= d30 && r.on <= todayIso);'),
    ('const busy = [...perAcct.values()].filter((n) => n > MAX_TESTS_PER_ACCOUNT).length;', 'const busy = [...perAcct.values()].filter((n) => n > MAX_TESTS_PER_ACCOUNT + 1).length;'),
    ('const shared = [...payeesByAcct.values()].filter((s) => s.size > 1).length;', 'const shared = 0;'),
    ('for (const r of rows) {\n    const s = payeesByAcct', 'for (const r of micro) {\n    const s = payeesByAcct'),
    ('returned30: in30.filter(returned).length', 'returned30: 0'),
    # errors
    ("if (OPS_FUNCTIONS.test(m) && /does not exist|Could not find|PGRST20[25]|42P01|42883|42703/.test(m)) {", "if (false) {"),
    ('[/ACH_VERIFICATION_EARLY/, ', '[/ACH_VERIFICATION_EARLYX/, '),
    ('[/ACH_RELEASE_SOLO/, ', '[/ACH_RELEASE_SOLOX/, '),
    ('[/ach_ver_one_open_per_account/, ', '[/ach_ver_one_open_per_accountX/, '),
    ('[/ACH_NOTICE_FINAL/, ', '[/ACH_NOTICE_FINALX/, '),
    ('[/ACH_AUTH_TRANSITION|ach_auth_guard/, ', '[/ach_auth_guard/, '),
    ('[/ACH_VERIFICATION_NOTE|ach_ver_note_shape/, ', '[/ACH_VERIFICATION_NOTE/, '),
]
s0 = open(F).read()
shutil.copy(F, "/tmp/mops.bak")
surv = []
for i, (a, b) in enumerate(M):
    if s0.count(a) < 1:
        print(i, "ANCHOR MISSING", a[:60].replace("\n", " "), flush=True)
        surv.append(i)
        continue
    open(F, "w").write(s0.replace(a, b, 1))
    r = subprocess.run(["timeout", "150", "npx", "vitest", "run", T], capture_output=True, text=True)
    open(F, "w").write(s0)
    k = r.returncode != 0
    print(i, "killed" if k else "SURVIVED", a[:70].replace("\n", " "), flush=True)
    if not k:
        surv.append(i)
assert open(F).read() == s0
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv else 0)
