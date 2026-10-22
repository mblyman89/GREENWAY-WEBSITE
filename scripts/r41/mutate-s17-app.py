#!/usr/bin/env python3
"""scripts/r41/mutate-s17-app.py - R41 S17: test the tests for the notice-email watch
(core, store, actions, page, cron, the operations hint and the tab).

Each mutant changes ONE thing; then the pure self-tests (run-pure-selftests.ts)
OR the S17 vitest file must FAIL. Files are restored after each mutant and
checked byte-for-byte at the end; a control run must pass first and last. The
tests that read a .last.log are left out of every run (-t), so a stale log can
never "kill" a mutant.

    python3 scripts/r41/mutate-s17-app.py | tee scripts/r41/mutate-s17-app.last.log
"""
import subprocess
import sys

CORE = "src/lib/payments/ach-notice-mail-core.ts"
STORE = "src/lib/payments/ach-notice-mail-store.ts"
ACTION = "src/app/admin/settings/banking/notice-email-actions.ts"
PAGE = "src/app/admin/settings/banking/notice-email/page.tsx"
CRON = "src/app/api/cron/ach-notice-mail/route.ts"
OPS = "src/app/admin/settings/banking/operations/page.tsx"
TABS = "src/app/admin/settings/banking/BankingHelpTabs.tsx"
VERCEL = "vercel.json"
T = ["tests/compliance/r41-s17-notice-mail.test.ts"]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- core (pure) ---
    ("quote reworded", CORE, 'fedRetention: "Reports are retained in the portal for 60 calendar days', 'fedRetention: "Reports are kept in the portal for 60 calendar days'),
    ("on by default", CORE, "export const DEFAULT_NOTICE_SETTINGS: NoticeMailSettings = {\n  enabled: false,", "export const DEFAULT_NOTICE_SETTINGS: NoticeMailSettings = {\n  enabled: true,"),
    ("truthy string turns on", CORE, "    enabled: o.enabled === true && uniq.length > 0,", "    enabled: Boolean(o.enabled) && uniq.length > 0,"),
    ("no typed confirmation", CORE, '  if (enabled && (get("confirm") ?? "").trim().toUpperCase() !== "I STILL CHECK THE PORTAL") {', '  if (false && (get("confirm") ?? "").trim().toUpperCase() !== "I STILL CHECK THE PORTAL") {'),
    ("too many senders", CORE, "  if (lines.length > MAX_SENDERS) return", "  if (lines.length > MAX_SENDERS + 1) return"),
    ("lookback in minutes", CORE, "  const after = Math.floor((nowMs - lookbackHours * 3_600_000) / 1000);", "  const after = Math.floor((nowMs - lookbackHours * 60_000) / 1000);"),
    ("look-alike sender matches", CORE, "domain === s || domain.endsWith(`.${s}`)", "domain === s || domain.endsWith(s)"),
    ("user@host trick passes", CORE, '.replace(/^[^@]*@/, "")', ''),
    ("look-alike portal host", CORE, "  return host === FED_PORTAL_DOMAIN || host.endsWith(`.${FED_PORTAL_DOMAIN}`);", "  return host === FED_PORTAL_DOMAIN || host.endsWith(FED_PORTAL_DOMAIN);"),
    ("one good link is enough", CORE, '  return hosts.every(isPortalHost) ? "portal_only" : "other_hosts";', '  return hosts.some(isPortalHost) ? "portal_only" : "other_hosts";'),
    ("dmarc fail ignored", CORE, '  if (/\\bdmarc=fail\\b/.test(all)) return "fail";\n', ''),
    ("spam not flagged", CORE, '    in_spam: m.labelIds.includes("SPAM") || m.labelIds.includes("TRASH"),', '    in_spam: m.labelIds.includes("TRASH"),'),
    ("off still runs", CORE, '  if (!s.enabled) return { run: false, reason: "off",', '  if (s.enabled === null) return { run: false, reason: "off",'),
    ("no key still runs", CORE, '  if (!encryptionKeySet) return { run: false, reason: "no_key",', '  if (encryptionKeySet === null) return { run: false, reason: "no_key",'),
    ("alert claims to read", CORE, '"The site does NOT read the notice. Sign in', '"The site read the notice. Sign in'),
    ("new is a mark", CORE, '  if (st !== "logged" && st !== "not_a_notice") return', '  if (st !== "logged" && st !== "not_a_notice" && st !== "new") return'),
    ("short notes allowed", CORE, "  if (note.length < 10 || note.length > 500) return", "  if (note.length < 3 || note.length > 500) return"),
    ("digits allowed in note", CORE, '  if (/[0-9]{7,}/.test(note.replace(/1-800-562-8761/g, ""))) return', '  if (/[0-9]{17,}/.test(note.replace(/1-800-562-8761/g, ""))) return'),
    # --- store ---
    ("off check after Google config", STORE, '  if (!settings.enabled) return { ...base, reason: "off" };\n  const cfg = mailConfigFromEnv(process.env);', '  const cfg = mailConfigFromEnv(process.env);\n  if (!settings.enabled) return { ...base, reason: "off" };'),
    ("stores in clear", STORE, "        if (!isEncrypted(row.subject_enc) || !isEncrypted(row.body_enc)) throw", "        if (!isEncrypted(row.subject_enc)) throw"),
    ("claim kept on failed email", STORE, '    else await admin.from("compliance_reminder_log").delete().eq("dedupe_key", dedupeKey);', "    else void 0;"),
    ("oldest alerts first", STORE, '.order("fetched_at", { ascending: false })', '.order("fetched_at", { ascending: true })'),
    ("mark twice", STORE, '    .eq("id", i.id)\n    .eq("state", "new")', '    .eq("id", i.id)'),
    # --- actions ---
    ("admin changes settings", ACTION, '  const session = await requirePermission("ach.act");\n  const form = checkSettingsForm', '  const session = await requirePermission("settings.manage");\n  const form = checkSettingsForm'),
    ("admin checks now", ACTION, '  const session = await requirePermission("ach.act");\n  const r = await runNoticeMailTick', '  const session = await requirePermission("settings.manage");\n  const r = await runNoticeMailTick'),
    ("mark not audited", ACTION, '    action: "ach.notice_mail.marked",', '    action: "ach.notice_mail.checked_now",'),
    # --- page ---
    ("admin reads bank mail", PAGE, '  const canRead = can(session.profile.role, "finances.view");', '  const canRead = can(session.profile.role, "settings.manage");'),
    ("staff page", PAGE, '  const session = await requirePermission("settings.manage");', '  const session = await requirePermission("orders.view");'),
    ("links not called text", PAGE, "Link sites (shown as text on purpose, never clickable)", "Link sites"),
    # --- cron ---
    ("cron echoes failures", CRON, "failures: r.failures.length };", "failures: r.failures };"),
    ("cron open without secret", CRON, "  } else if (shouldRefuseWhenSecretMissing(secret)) {", "  } else if (false) {"),
    ("off is an error", CRON, '  if (r.reason === "off") return NextResponse.json({ ok: true, ran: false, reason: "off" });\n', ''),
    ("cron every minute", VERCEL, '"schedule": "50 * * * *"', '"schedule": "* * * * *"'),
    # --- operations and tab ---
    ("ops hint dropped", OPS, '<Link href="/admin/settings/banking/notice-email" className="text-emerald-300 hover:underline">Notice email</Link>', "Notice email"),
    ("tab dropped", TABS, '  { key: "noticemail", href: "/admin/settings/banking/notice-email", label: "Notice email" },\n', ''),
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
