#!/usr/bin/env python3
"""scripts/r41/mutate-s16-app.py - R41 S16: test the tests for the bank watch
(core, store, actions, page, cron, the operations funding hint and the tab).

Each mutant changes ONE thing; then the pure self-tests (run-pure-selftests.ts)
OR the S16 vitest file must FAIL. Files are restored after each mutant and
checked byte-for-byte at the end; a control run must pass first and last. The
tests that read a .last.log are left out of every run (-t), so a stale log can
never "kill" a mutant.

    python3 scripts/r41/mutate-s16-app.py | tee scripts/r41/mutate-s16-app.last.log
"""
import subprocess
import sys

CORE = "src/lib/payments/ach-bank-watch-core.ts"
STORE = "src/lib/payments/ach-bank-watch-store.ts"
ACTION = "src/app/admin/settings/banking/bank-watch-actions.ts"
PAGE = "src/app/admin/settings/banking/bank-watch/page.tsx"
CRON = "src/app/api/cron/ach-bank-watch/route.ts"
OPS = "src/app/admin/settings/banking/operations/page.tsx"
TABS = "src/app/admin/settings/banking/BankingHelpTabs.tsx"
T = ["tests/compliance/r41-s16-bank-watch.test.ts"]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- core (pure) ---
    ("quote reworded", CORE, '  trialCalls: "API calls against your existing connected Items are not capped",', '  trialCalls: "API calls against your connected Items are not capped",'),
    ("window 90 days", CORE, "export const WATCH_DAYS = 60;", "export const WATCH_DAYS = 90;"),
    ("stale after 5 days", CORE, "export const STALE_SYNC_DAYS = 2;", "export const STALE_SYNC_DAYS = 5;"),
    ("pending lines alarmed", CORE, "  const unexplained = outLines.filter((l) => l.explanation === null && !l.pending);", "  const unexplained = outLines.filter((l) => l.explanation === null);"),
    ("money in counted as out", CORE, "    if (t.amountCents <= 0) continue;\n    let explanation", "    if (t.amountCents === 0) continue;\n    let explanation"),
    ("other accounts read", CORE, "  const inWindow = input.txns.filter((t) => mainIds.has(t.accountId) && t.date >= windowFrom", "  const inWindow = input.txns.filter((t) => t.date >= windowFrom"),
    ("over-limit rule explains", CORE, "        if (r.maxCents !== null && t.amountCents > r.maxCents) {", "        if (r.maxCents !== null && t.amountCents > r.maxCents + 1) {"),
    ("retired rules still live", CORE, "  const liveRules = input.rules.filter((r) => !r.retired);", "  const liveRules = input.rules;"),
    ("oldest review stands", CORE, "  for (const r of [...input.reviews].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) latest.set", "  for (const r of [...input.reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) latest.set"),
    ("return before the payment", CORE, "p.amountCents !== amt || p.date > t.date ||", "p.amountCents !== amt ||"),
    ("payment reused", CORE, "    usedPay.add(best);\n", ""),
    ("notices never close a return", CORE, "      usedNotice.add(i);\n      logged = true;", "      usedNotice.add(i);\n      logged = false;"),
    ("fee gap counts notices twice", CORE, "gap: Math.max(0, f.returnFeeDebits - f.noticesLogged)", "gap: Math.max(0, f.returnFeeDebits - 2 * f.noticesLogged)"),
    ("wrong last four only a warning", CORE, '    else if (a.mask !== input.agreementLast4) health.push({ level: "bad",', '    else if (a.mask !== input.agreementLast4) health.push({ level: "warn",'),
    ("slots warn too late", CORE, '    level: left <= 1 ? "warn" : "ok",', '    level: left <= 0 ? "warn" : "ok",'),
    ("email drops the bank phone", CORE, '    parts.push("If you do not recognise one, call Timberland Cash Management at 1-800-562-8761 the same day.");\n', ""),
    ("stale hint after 48h", CORE, '  if (ageH === null || ageH > 24) return { tone: "stale"', '  if (ageH === null || ageH > 48) return { tone: "stale"'),
    ("unknown time is fresh", CORE, '  if (ageH === null || ageH > 24) return { tone: "stale"', '  if (ageH !== null && ageH > 24) return { tone: "stale"'),
    ("digits allowed in review note", CORE, "  if (SEVEN_DIGITS.test(note)) return { ok: false, error: \"No account or routing numbers (no run of 7 or more digits). 1-800-562-8761 is fine.\" };\n", ""),
    ("zero limit accepted", CORE, "    if (maxCents <= 0) return", "    if (maxCents < 0) return"),
    # --- store ---
    ("review on any account", STORE, '  if (a.error || (a.data as { role?: string } | null)?.role !== "main") return', "  if (a.error) return"),
    ("missing 0289 not reported", STORE, '  if (!tablesReady) problems.push("Migration 0289 is not applied yet', '  if (false) problems.push("Migration 0289 is not applied yet'),
    # --- actions ---
    ("admin adds rules", ACTION, '  const session = await requirePermission("ach.act");\n  const form = checkRuleForm', '  const session = await requirePermission("settings.manage");\n  const form = checkRuleForm'),
    ("admin retires rules", ACTION, '  const session = await requirePermission("ach.act");\n  const id = String', '  const session = await requirePermission("settings.manage");\n  const id = String'),
    ("review not audited", ACTION, '    action: "ach.bank_watch.reviewed",', '    action: "ach.bank_watch.rule_added",'),
    # --- page ---
    ("page open to admins", PAGE, '  const session = await requirePermission("finances.view");', '  const session = await requirePermission("settings.manage");'),
    ("admin sees rule forms", PAGE, '  const isOwner = can(session.profile.role, "ach.act");', '  const isOwner = can(session.profile.role, "finances.view");'),
    # --- cron ---
    ("cron syncs every item", CRON, '.select("item_id, role, active").eq("role", "main")', '.select("item_id, role, active")'),
    ("failed read reads as all clear", CRON, "Nothing was checked, so this is NOT an all clear.", "Nothing new."),
    ("email every day", CRON, "dedupeKey: `ach-bank-watch:${report.findingsKey.slice(0, 24)}:${weekKeyOf(day)}`", "dedupeKey: `ach-bank-watch:${report.findingsKey.slice(0, 24)}:${day}`"),
    ("claim kept after a failed send", CRON, '      await db.from("compliance_reminder_log").delete().eq("dedupe_key", planned.dedupeKey);\n', ""),
    # --- operations and tab ---
    ("balance shown to admins", OPS, '    can(session.profile.role, "finances.view") ? readMainBalances() : Promise.resolve([]),', "    readMainBalances(),"),
    ("tab missing", TABS, '  { key: "bankwatch", href: "/admin/settings/banking/bank-watch", label: "Bank watch" },\n', ""),
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
