#!/usr/bin/env python3
"""scripts/r41/mutate-s18-app.py - R41 S18: test the tests for the written ACH
policies, the quarterly access review and the yearly key checks (core, store,
action, page, packet and the tab).

Each mutant changes ONE thing; then the pure self-tests (run-pure-selftests.ts)
OR the S18 vitest file must FAIL. Files are restored after each mutant and
checked byte-for-byte at the end; a control run must pass first and last. The
tests that read a .last.log are left out of every run (-t), so a stale log can
never "kill" a mutant.

    python3 scripts/r41/mutate-s18-app.py | tee scripts/r41/mutate-s18-app.last.log
"""
import subprocess
import sys

CORE = "src/lib/payments/ach-policies-core.ts"
STORE = "src/lib/payments/ach-policies-store.ts"
ACTION = "src/app/admin/settings/banking/policies-actions.ts"
PAGE = "src/app/admin/settings/banking/policies/page.tsx"
PACKET = "src/app/admin/settings/banking/policies/packet/route.ts"
TABS = "src/app/admin/settings/banking/BankingHelpTabs.tsx"
T = ["tests/compliance/r41-s18-policies.test.ts"]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- core (pure) ---
    ("quote reworded", CORE, 'text: "Require two people to send ACH payments.', 'text: "Require two staff to send ACH payments.'),
    ("staff role gets powers", CORE, '  admin: ["gather and record ACH information (waits for the owner)", "open the Banking pages"],\n', '  admin: ["gather and record ACH information (waits for the owner)", "open the Banking pages"],\n  staff: ["none"],\n'),
    ("owner not first", CORE, 'a.role === "owner" ? -1 : 1', 'a.role === "owner" ? 1 : -1'),
    ("no-owner not flagged", CORE, "  if (owners.length === 0) findings.push", "  if (owners.length < 0) findings.push"),
    ("never-signed-in not flagged", CORE, "    if (p.daysSinceLogin === null) findings.push({ level: \"warn\", text: `${p.who} (${p.role}) has never signed in.", "    if (p.daysSinceLogin === undefined) findings.push({ level: \"warn\", text: `${p.who} (${p.role}) has never signed in."),
    ("stale threshold off by a lot", CORE, "    else if (p.daysSinceLogin >= STALE_LOGIN_DAYS) findings.push", "    else if (p.daysSinceLogin >= STALE_LOGIN_DAYS * 2) findings.push"),
    ("fingerprint ignores active", CORE, "`${p.id}|${p.role}|${p.active ? 1 : 0}`", "`${p.id}|${p.role}`"),
    ("fingerprint includes sign-in", CORE, "`${p.id}|${p.role}|${p.active ? 1 : 0}`", "`${p.id}|${p.role}|${p.active ? 1 : 0}|${p.lastLogin}`"),
    ("short summary allowed", CORE, "  if (summary.length < 10) return", "  if (summary.length < 3) return"),
    ("digits allowed", CORE, "  return /[0-9]{7,}/.test(s.split(TIMBERLAND_PHONE).join(\"\"));", "  return /[0-9]{17,}/.test(s.split(TIMBERLAND_PHONE).join(\"\"));"),
    ("phone refused", CORE, "  return /[0-9]{7,}/.test(s.split(TIMBERLAND_PHONE).join(\"\"));", "  return /[0-9]{7,}/.test(s.replace(/-/g, \"\"));"),
    ("confirm box ignored", CORE, '  if (get("confirm") !== "1") return', '  if (get("confirm") === "never") return'),
    ("any quarter allowed", CORE, "    if (want !== now && want !== previousQuarterKey(now)) return", "    if (want === \"never\") return"),
    ("future set-on allowed", CORE, "    if (setOnRaw > todayIso) return", "    if (setOnRaw > \"9999\") return"),
    ("quarter of month wrong", CORE, "  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;", "  return `${y}-Q${Math.floor(m / 3) + 1}`;"),
    ("previous of Q1 wrong", CORE, "  return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;", "  return q === 1 ? `${y}-Q4` : `${y}-Q${q - 1}`;"),
    ("wording change ignored", CORE, "  const textChanged = Boolean(adoption && adoption.text_sha256 !== policyFp);", "  const textChanged = false && Boolean(adoption && adoption.text_sha256 !== policyFp);"),
    ("old-year adoption counts", CORE, '  const adoption = latestOf(rows.filter((r) => r.kind === "policy_adoption" && r.period_key === year));', '  const adoption = latestOf(rows.filter((r) => r.kind === "policy_adoption"));'),
    ("fingerprint ignores rules", CORE, "    for (const r of p.rules) lines.push(`- ${r}`);\n", ""),
    ("packet loses title", CORE, '  out.push("GREENWAY - WRITTEN ACH POLICIES");', '  out.push("GREENWAY - ACH");'),
    # --- store ---
    ("unpaged staff read", STORE, '.from("staff_profiles").select("id, email, full_name, role, active, last_login_at").order("id", { ascending: true }).range(from, to);', '.from("staff_profiles").select("id, email, full_name, role, active, last_login_at").limit(1000);'),
    # --- action ---
    ("admin records", ACTION, '  const session = await requirePermission("ach.act");', '  const session = await requirePermission("settings.manage");'),
    ("browser fingerprint", ACTION, "  const fp = fingerprintFor(form.row, staff.ok ? staff.rows : [], today);", '  const fp = String(fd.get("text_sha256") ?? "");'),
    ("not audited", ACTION, "    action: `ach.control.${form.row.kind}`,", '    action: "ach.control",'),
    # --- page ---
    ("staff page", PAGE, '  const session = await requirePermission("settings.manage");', '  const session = await requirePermission("orders.view");'),
    ("admin sees forms", PAGE, '  const isOwner = can(session.profile.role, "ach.act");', '  const isOwner = can(session.profile.role, "settings.manage");'),
    ("forms without records", PAGE, "  const canRecord = isOwner && records.ok;", "  const canRecord = isOwner;"),
    # --- packet ---
    ("staff packet", PACKET, '  const session = await requirePermission("settings.manage");', '  const session = await requirePermission("orders.view");'),
    ("packet not audited", PACKET, '    action: "ach.control.packet",', '    action: "ach.control",'),
    # --- tab ---
    ("tab dropped", TABS, '  { key: "policies", href: "/admin/settings/banking/policies", label: "Policies" },\n', ''),
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
