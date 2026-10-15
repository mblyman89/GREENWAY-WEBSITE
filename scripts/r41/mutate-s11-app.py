#!/usr/bin/env python3
"""scripts/r41/mutate-s11-app.py - R41 S11: test the tests for OFAC sanctions
screening (the pure core, the download/store, the actions, the cron route and
the panel), and the Round 12 "Vendors to follow up" search and collapse.

Each mutant changes ONE thing; then the pure self-tests (run-pure-selftests.ts)
OR the S11 vitest file must FAIL. Files are restored after each mutant and
checked byte-for-byte at the end; a control run must pass first and last. The
test that reads THIS script's log is left out of every run (-t), so a stale
log can never "kill" a mutant.

    python3 scripts/r41/mutate-s11-app.py | tee scripts/r41/mutate-s11-app.last.log
"""
import subprocess
import sys

CORE = "src/lib/payments/ofac-screening-core.ts"
STORE = "src/lib/payments/ofac-screening-store.ts"
ACT = "src/app/admin/settings/banking/screening-actions.ts"
CRON = "src/app/api/cron/ofac-screening/route.ts"
PANEL = "src/app/admin/settings/banking/screening/ScreeningPanel.tsx"
ENROLL = "src/lib/payments/vendor-ach-enrollment-core.ts"
FOLLOW = "src/app/admin/settings/banking/VendorFollowUpSection.tsx"
T = [
    "tests/compliance/r41-s11-ofac.test.tsx",
]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- core: parse, score, review rules ---
    ("missing end-of-file mark accepted", CORE, "  if (!text.endsWith(`\\r\\n${EOF_MARK}`)) {\n", "  if (false) {\n"),
    ("wrong field count accepted", CORE, "    if (rec.length !== fieldCount) {\n", "    if (rec.length < 2) {\n"),
    ("non-ASCII accepted", CORE, "    if (bytes[i] > 127) return", "    if (bytes[i] > 255) return"),
    ("score keeps the LOWER of the two techniques", CORE, "    const score = Math.max(composite, whole);", "    const score = Math.min(composite, whole);"),
    ("threshold off by one point", CORE, "export const MATCH_THRESHOLD = 0.85;", "export const MATCH_THRESHOLD = 0.95;"),
    ("vessels screened", CORE, '      const skip = type === "vessel" || type === "aircraft";', '      const skip = type === "aircraft";'),
    ("aliases dropped", CORE, '  const err = addPrimary("SDN.CSV", "SDN") ?? addPrimary("CONS_PRIM.CSV", "CONS") ?? addAlt("ALT.CSV", "SDN") ?? addAlt("CONS_ALT.CSV", "CONS");', '  const err = addPrimary("SDN.CSV", "SDN") ?? addPrimary("CONS_PRIM.CSV", "CONS");'),
    ("Consolidated list dropped", CORE, '?? addPrimary("CONS_PRIM.CSV", "CONS") ??', "??"),
    ("payee with no name silently passed", CORE, "    if (names.length === 0) {\n      unscreenable.push(p);\n      continue;\n    }", "    if (names.length === 0) {\n      continue;\n    }"),
    ("true match clears on a later review", CORE, "  const trueMatch = mine.find((v) => v.decision === \"true_match\");\n  if (trueMatch) return", "  const trueMatch = mine.find((v) => v.decision === \"true_match\" && v.resultId === r.id);\n  if (trueMatch) return"),
    ("partial review covers a new match", CORE, "    .find((v) => keys.every((k) => v.matchKeys.includes(k)));", "    .find((v) => keys.some((k) => v.matchKeys.includes(k)));"),
    ("note shorter than 20 accepted", CORE, "  if (note.length < 20) return", "  if (note.length < 5) return"),
    ("digits in note accepted", CORE, "  if (/\\d{7,}/.test(note)) return", "  if (/\\d{70,}/.test(note)) return"),
    ("email says payments are blocked", CORE, "Nothing is blocked: payroll and vendor payments run as usual. ", "Payments are on hold until you review. "),
    ("weekly reminder key never changes", CORE, "  return `w${Math.floor(days / 7)}`;", "  return \"w\";"),
    ("stale after 30 days", CORE, "export const STALE_AFTER_DAYS = 3;", "export const STALE_AFTER_DAYS = 30;"),
    # --- store ---
    ("no User-Agent sent", STORE, '  const headers = { "User-Agent": OFAC_USER_AGENT };', "  const headers = {} as Record<string, string>;"),
    ("digest mismatch ignored", STORE, "      if (published !== sdnSha) {", "      if (false) {"),
    ("HTTP error accepted", STORE, "    if (!res.ok) return { ok: false, error: `${file}: OFAC's server answered", "    if (false) return { ok: false, error: `${file}: OFAC's server answered"),
    ("partial payee read screens part of the list", STORE, "  if (!verdict.complete) return { ok: false, error: `The ${table", "  if (false) return { ok: false, error: `The ${table"),
    ("payees not paged by id", STORE, '.select(cols).order("id", { ascending: true }).range(from, to);', ".select(cols).range(from, to);"),
    ("terminated employees screened", STORE, '    if (e.employment_status === "terminated" && e.active !== true) continue;\n', ""),
    ("bank-record names not screened", STORE, "  for (const r of vbd.rows) add(`vendor:${str(r.vendor_id)}`, r.vendor_name);\n", ""),
    ("failed run not recorded", STORE, "  const fail = async (error: string): Promise<RunOutcome> => ({ ok: false, error, recorded: await recordFailure(input.trigger, actor, error) });", "  const fail = async (error: string): Promise<RunOutcome> => ({ ok: false, error, recorded: false });"),
    ("cron run stamped with an actor", STORE, '  const actor = input.trigger === "manual" ? input.actorId : null;', "  const actor = input.actorId;"),
    ("earlier reviews ignored", STORE, "    const st = resultStatus({ ...r, id: \"(new)\", runId: \"(new)\" }, prior.reviews);", "    const st = resultStatus({ ...r, id: \"(new)\", runId: \"(new)\" }, []);"),
    ("review not stamped with the actor", STORE, "      created_by: input.actorId,\n", "      created_by: null,\n"),
    ("clear result reviewable", STORE, '  if (r.result !== "possible_match" || r.matches.length === 0) return', "  if (false) return"),
    # --- actions / cron / panel ---
    ("bad review form still written", ACT, "  if (!form.ok) back({ error: form.error });", "  if (!form.ok) return;"),
    ("screen now redirects to the wrong anchor", ACT, 'function back(qs: { msg?: string; error?: string }, anchor = "matches"): never {', 'function back(qs: { msg?: string; error?: string }, anchor = "status"): never {'),
    ("cron email claim not removed on failure", CRON, '      await db.from("compliance_reminder_log").delete().eq("dedupe_key", planned.dedupeKey);\n', ""),
    ("cron failure answers 200", CRON, "  const okAll = r.ok && emailError === null;", "  const okAll = true;"),
    ("cron failure email every run", CRON, "dedupeKey: `ofac-screening:failed:${day}`", "dedupeKey: `ofac-screening:failed:${Date.now()}`"),
    ("panel loses the never-blocks line", PANEL, "<strong>Screening never blocks a payment.</strong>", "<strong>Screening results.</strong>"),
    ("admin sees Record decision", PANEL, '{isOwner ? "Record decision" : "Send to Michael for approval"}', '{"Record decision"}'),
    ("true match shows a form", PANEL, '{item.status.status === "needs_review" ? (', '{item.status.status !== "clear" ? ('),
    # --- Round 12: vendors to follow up (search + collapse) ---
    ("search matches ANY word", ENROLL, "    return words.every((w) => hay.includes(w));", "    return words.some((w) => hay.includes(w));"),
    ("search is case-sensitive", ENROLL, '    .toLowerCase()\n    .replace(/[\'\\u2019]/g, "")', '    .replace(/[\'\\u2019]/g, "")'),
    ("search ignores the status label", ENROLL, "foldForSearch([r.label, r.nextStep, ...r.warnings].join(\" \"))", "foldForSearch([r.nextStep, ...r.warnings].join(\" \"))"),
    ("blank search hides every row", ENROLL, "  if (words.length === 0) return [...rows];", "  if (words.length === 0) return [];"),
    ("section opens by default", FOLLOW, '      ref={detailsRef}', '      ref={detailsRef}\n      open'),
    ("list not filtered", FOLLOW, "  const shown = filterVendorFollowUp(rows, query);", "  const shown = filterVendorFollowUp(rows, \"\");"),
    ("no search box", FOLLOW, '                type="search"', '                type="hidden"'),
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
