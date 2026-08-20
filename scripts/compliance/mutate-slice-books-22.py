#!/usr/bin/env python3
"""
books-22 mutation harness  (standing rule 33)

The slice moved every owner-only screen into two tabs ("Accounting" and
"Lyman"), split the Security Log onto its own owner-only permission, and built
the first test that compares what the MENU ADVERTISES against what the PAGE
ACTUALLY ENFORCES.

That last part is the reason this harness matters more than usual. Before this
slice the only thing protecting the nav/page relationship was a COMMENT. A
comment cannot fail. So the question here is not "does the code work" -- the
suite already says yes -- it is "would the tests notice if somebody quietly
re-opened one of these doors". Each mutant below is a door being re-opened.

Rule 33: ZERO survivors and ZERO skipped. A skipped mutant is not a pass, it is
an unasked question: the anchor no longer matches, so that line stopped being
tested and nobody was told.

Rule 39: the harness self-checks first. It applies a no-op mutation and asserts
the suite still passes, then applies a certainly-fatal one and asserts the suite
fails. A harness that reports "all killed" because it cannot run the suite at
all is worse than no harness.
"""
import subprocess
import shutil
import sys
import os
import tempfile

# Repo root, derived from this file's location: scripts/compliance/ -> ../..
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

TARGETS = {
    "nav": "src/components/admin/admin-nav-data.ts",
    "core": "src/lib/auth/nav-gate-core.ts",
    "roles": "src/lib/auth/roles.ts",
    "auditpage": "src/app/admin/audit/page.tsx",
    "auditactions": "src/app/admin/audit/anomaly-actions.ts",
    "topnav": "src/components/admin/AdminTopNav.tsx",
    "mig": "supabase/migrations/0193_security_log_owner_only.sql",
    "ownergate": "src/lib/auth/owner-gate-core.ts",
}

TESTS = [
    "tests/compliance/nav-gate-core.test.ts",
    "tests/compliance/owner-gate-core.test.ts",
]

# (label, target key, old, new)
MUTANTS = [
    # ================================================================
    # A. THE OWNER'S ACTUAL SENTENCE
    #    "they shouldn't be able to see my personal finances, the plaid
    #     feeds, the crypto, the atm, or the audit log"
    # ================================================================
    ("audit.view re-opened to the admin", "roles",
     '"audit.view": ["owner"],', '"audit.view": ["owner", "admin"],'),
    ("audit.view re-opened to everyone who manages users", "roles",
     '"audit.view": ["owner"],', '"audit.view": ["owner", "admin", "manager"],'),
    ("finances.view re-opened to the admin (plaid, crypto, atm, loans)", "roles",
     '"finances.view": ["owner"],', '"finances.view": ["owner", "admin"],'),
    ("books.view re-opened to the admin (the whole Accounting tab)", "roles",
     '"books.view": ["owner"],', '"books.view": ["owner", "admin"],'),

    # ================================================================
    # B. THE OTHER HALF OF THE SENTENCE
    #    "I am fine with my admin manager to pay employees and vendors"
    #    Over-tightening is a defect too. A slice about locking doors is
    #    exactly when somebody locks one the owner wanted open.
    # ================================================================
    ("over-tightened: the admin loses paying vendors", "roles",
     '"payables.manage": ["owner", "admin", "manager"],', '"payables.manage": ["owner"],'),
    ("over-tightened: the admin loses paying employees", "roles",
     '"staffing.manage": ["owner", "admin", "manager"],', '"staffing.manage": ["owner"],'),
    ("over-tightened: the admin loses user management", "roles",
     '"users.manage": ["owner", "admin"],', '"users.manage": ["owner"],'),

    # ================================================================
    # C. THE PAGE GATES THEMSELVES
    # ================================================================
    ("Security Log page reverts to the shared users.manage gate", "auditpage",
     'requirePermission("audit.view")', 'requirePermission("users.manage")'),
    ("Security Log page downgraded to any-logged-in-staff", "auditpage",
     'requirePermission("audit.view")', 'requireStaff()'),
    ("Security Log server actions revert to users.manage", "auditactions",
     'requirePermission("audit.view")', 'requirePermission("users.manage")'),

    # ================================================================
    # D. THE NAV DATA -- tab membership and advertised permission
    # ================================================================
    ("Security Log advertises a permission the page will refuse", "nav",
     '{ label: "Security Log", href: "/admin/audit", permission: "audit.view"',
     '{ label: "Security Log", href: "/admin/audit", permission: "dashboard.view"'),
    ("Security Log renamed back to the confusing 'Audit Log'", "nav",
     'label: "Security Log", href: "/admin/audit"',
     'label: "Audit Log", href: "/admin/audit"'),
    ("Security Log dragged back out of the Lyman tab", "nav",
     'href: "/admin/audit", permission: "audit.view", icon: "\\ud83d\\udd0e", group: "Lyman"',
     'href: "/admin/audit", permission: "audit.view", icon: "\\ud83d\\udd0e", group: "Admin"'),
    ("the Accounting tab is unregistered, so it silently never renders", "nav",
     '"Accounting",\n  "Lyman",', '"Lyman",'),
    ("the Lyman tab is unregistered, so it silently never renders", "nav",
     '"Accounting",\n  "Lyman",', '"Accounting",'),

    # ================================================================
    # E. THE CHECKER ITSELF (rule 39: a checker nobody checked is not evidence)
    #    If these survive, every mutant above is meaningless.
    # ================================================================
    ("checker: requireStaff is treated as 'no guard' and silently skipped", "core",
     'if (/requireStaff\\s*\\(/.test(code)) return { kind: "staff" };',
     '/* mutant: requireStaff no longer recognised */'),
    ("checker: requireStaff mis-mapped to an owner-only permission", "core",
     'export const STAFF_ONLY_EQUIVALENT_PERMISSION: Permission = "dashboard.view";',
     'export const STAFF_ONLY_EQUIVALENT_PERMISSION: Permission = "books.view";'),
    ("checker: comments are scanned again, so prose counts as a guard", "core",
     "  const code = stripComments(source);", "  const code = source;"),
    ("checker: agreement compares names instead of roles", "core",
     "  const disagreements: string[] = [];",
     "  if (navPermission !== pagePermission) return { agrees: true, reason: \"names differ\" };\n  const disagreements: string[] = [];"),
    ("checker: agreement always says yes", "core",
     "  const disagreements: string[] = [];",
     "  return { agrees: true, reason: \"mutant\" };\n  const disagreements: string[] = [];"),
    ("checker: a page with no guard at all is called fine", "core",
     '        "This page has no guard at all. Every admin page needs one: the nav " +',
     '        (() => { throw new Error("unreachable"); })() +'),
    ("checker: books access mapped to a permission everyone has", "core",
     'export const BOOKS_ACCESS_EQUIVALENT_PERMISSION: Permission = "books.view";',
     'export const BOOKS_ACCESS_EQUIVALENT_PERMISSION: Permission = "dashboard.view";'),
    ("checker: owner-only list hardcoded instead of derived from the matrix", "core",
     "  return ALL_PERMISSIONS.filter((p) => {",
     '  if (true) return ["books.view", "finances.view", "financials.view", "audit.view"] as Permission[];\n  return ALL_PERMISSIONS.filter((p) => {'),
    ("checker: owner-only means 'the owner is among those allowed', not 'only the owner'", "core",
     "export function isOwnerOnlyPermission(permission: Permission): boolean {\n  const roles = rolesForPermission(permission);\n  return roles.length === 1 && roles[0] === \"owner\";",
     "export function isOwnerOnlyPermission(permission: Permission): boolean {\n  const roles = rolesForPermission(permission);\n  return roles.includes(\"owner\");"),
    ("checker: leak detector returns nothing, so no leak is ever found", "core",
     "      leaks.push({ role, label: item.label, href: item.href, permission: item.permission });",
     "      void item; // mutant: the detector finds the leak and says nothing"),
    ("checker: leak detector ignores every role except the owner it skips", "core",
     '    if (role === "owner") continue;', "    continue;"),
    ("checker: leak detector treats every item as a declared exception", "core",
     "      if (ownerTabExceptionFor(item.href)) continue;", "      continue;"),

    # ================================================================
    # F. THE DECLARED EXCEPTION
    #    Exactly one item in an owner tab is not owner-only. An exception
    #    list that can grow silently is not an exception list.
    # ================================================================
    ("a second undeclared exception is smuggled into the Accounting tab", "nav",
     '{ label: "Chart of Accounts", href: "/admin/books/accounts", permission: "books.view",',
     '{ label: "Smuggled", href: "/admin/help", permission: "dashboard.view", icon: "x", group: "Accounting" },\n  { label: "Chart of Accounts", href: "/admin/books/accounts", permission: "books.view",'),
    ("the exception stops explaining itself", "core",
     '    why:', '    why: "" && '),

    # ================================================================
    # G. THE RENDER PATH
    #    A tab can be perfectly configured and still never appear.
    # ================================================================
    ("owner tabs registered as direct links, hiding all but one screen each", "topnav",
     'const DIRECT_LINK_GROUPS = new Set<AdminNavItem["group"]>(["Reports", "CCRS", "Medical"]);',
     'const DIRECT_LINK_GROUPS = new Set<AdminNavItem["group"]>(["Reports", "CCRS", "Medical", "Accounting", "Lyman"]);'),
    ("the nav stops filtering by permission, so every role sees every tab", "topnav",
     "adminNav.filter((item) => can(role, item.permission",
     "adminNav.filter((item) => true || can(role, item.permission"),

    # ================================================================
    # H. THE DATABASE DOOR (migration 0193)
    #    The page gate and the RLS policy must not drift apart again.
    # ================================================================
    ("migration re-opens the Security Log to any admin", "mig",
     "for select using (public.is_owner());", "for select using (public.is_admin());"),
    ("migration re-opens the Security Log to any staff", "mig",
     "for select using (public.is_owner());", "for select using (public.is_staff());"),
    ("migration forgets to drop 0130's policy, leaving TWO permissive reads", "mig",
     "drop policy if exists audit_admin_read on public.audit_logs;\n", ""),
    ("migration forgets to drop 0001's policy, leaving TWO permissive reads", "mig",
     "drop policy if exists audit_staff_read on public.audit_logs;\n", ""),
    ("migration drops the append-only revoke, so history becomes editable", "mig",
     "revoke update, delete on table public.audit_logs from anon, authenticated, service_role;\n\n-- ---",
     "\n-- ---"),
    ("migration loses its out-of-order guard", "mig",
     "  if to_regprocedure('public.is_owner()') is null then",
     "  if false then"),
    ("migration overstates the lock, hiding that readers bypass RLS", "mig",
     "-- ROLE key, which bypasses row-level security entirely. All four were checked",
     "-- ROLE key. All four were checked"),

    # ================================================================
    # I. THE OWNER-GATE REGISTRY (rule 25: extended, not duplicated)
    # ================================================================
    ("the Security Log is dropped from the owner-only oversight registry", "ownergate",
     '    route: "/admin/audit",\n    permission: "audit.view",', '    route: "/admin/audit-REMOVED",\n    permission: "audit.view",'),
    ("the oversight route is quietly re-gated to a shared permission", "ownergate",
     '    route: "/admin/audit",\n    permission: "audit.view",', '    route: "/admin/audit",\n    permission: "users.manage",'),
    ("the banking exception loses the owner's own words", "ownergate",
     '"explicitly kept with admin. RE-CONFIRMED 2026-08-20, in the same " +\n      "sentence that closed the other doors: \\"I am fine with my admin manager " +\n      "',
     '"explicitly kept with admin. RE-CONFIRMED 2026-08-20. " +\n      "'),
    ("banking is swept into the owner gate, breaking vendor and payroll payments", "ownergate",
     '  { route: "/admin/loans", permission: "finances.view" },',
     '  { route: "/admin/loans", permission: "finances.view" },\n  { route: "/admin/settings/banking", permission: "finances.view" },'),
]


def run_suite() -> bool:
    """True if the suite passes."""
    r = subprocess.run(
        ["npx", "vitest", "run", *TESTS, "--reporter=dot"],
        cwd=REPO, capture_output=True, text=True,
    )
    return r.returncode == 0


def main() -> int:
    backups = {}
    for key, rel in TARGETS.items():
        src = os.path.join(REPO, rel)
        bak = os.path.join(tempfile.gettempdir(), f"books22-mut-{key}.bak")
        shutil.copy(src, bak)
        backups[key] = (src, bak)

    def restore_all():
        for src, bak in backups.values():
            shutil.copy(bak, src)

    # ---- RULE 39 SELF-CHECK: prove the harness can see both outcomes ----
    print("=" * 72)
    print("SELF-CHECK (rule 39)")
    print("=" * 72)
    src, bak = backups["core"]
    body = open(bak, encoding="utf-8").read()

    # A no-op mutation. Must stay green.
    open(src, "w", encoding="utf-8").write(body + "\n// mutant: a comment changes nothing\n")
    if not run_suite():
        print("SELF-CHECK FAILED: suite is red before any real mutation.")
        restore_all()
        return 1
    print("  [ok] NO-OP mutation stayed green (harness is not just failing everything)")

    # A certainly-fatal mutation. Must go red.
    open(src, "w", encoding="utf-8").write(
        body.replace("export function extractPageGuard", "export function extractPageGuardXX", 1)
    )
    if run_suite():
        print("SELF-CHECK FAILED: deleting an exported function did NOT fail the suite.")
        restore_all()
        return 1
    print("  [ok] FATAL mutation went red (harness can detect a kill)")
    restore_all()
    print()

    # ---- THE RUN ----
    print("=" * 72)
    print(f"MUTATION RUN: {len(MUTANTS)} mutants")
    print("=" * 72)

    survived, skipped, killed = [], [], []
    for i, (label, key, old, new) in enumerate(MUTANTS, 1):
        src, bak = backups[key]
        body = open(bak, encoding="utf-8").read()
        n = body.count(old)
        if n != 1:
            skipped.append((label, f"anchor matched {n} times"))
            print(f"[{i:2d}/{len(MUTANTS)}] SKIPPED({n})  {label}")
            continue
        open(src, "w", encoding="utf-8").write(body.replace(old, new, 1))
        ok = run_suite()
        shutil.copy(bak, src)
        if ok:
            survived.append(label)
            print(f"[{i:2d}/{len(MUTANTS)}] SURVIVED    {label}")
        else:
            killed.append(label)
            print(f"[{i:2d}/{len(MUTANTS)}] killed      {label}")

    restore_all()

    print()
    print("=" * 72)
    print(f"RESULT: {len(killed)} killed, {len(survived)} survived, {len(skipped)} skipped")
    print("=" * 72)
    for s in survived:
        print(f"  SURVIVOR: {s}")
    for s, why in skipped:
        print(f"  SKIPPED:  {s}  ({why})")

    # Rule 33: zero survivors AND zero skipped.
    if survived or skipped:
        print("\nRULE 33 NOT SATISFIED.")
        return 1
    print("\nRULE 33 SATISFIED: 0 survivors, 0 skipped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
