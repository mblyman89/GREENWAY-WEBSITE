#!/usr/bin/env python3
"""
mutate-slice-books-87.py  --  can the books-87 tests actually fail?

Standing rule 13c: a test that cannot fail is worse than no test. Passing tests
prove nothing on their own; they only prove something if a WRONG version of the
code makes them go red. So this breaks the slice on purpose, one small edit at a
time, and reports any mutation the suite fails to notice.

Each mutation is a mistake a real person could plausibly make - a loosened
filter, a dropped clause, an `and` typed as `or`, a "helpful" staff_id. Nothing
here is exotic; the point is coverage of the ordinary.

Usage:  python3 scripts/compliance/mutate-slice-books-87.py
Exit 0 only if EVERY mutation is caught.
"""
import io
import re
import subprocess
import sys

TESTS = [
    "tests/compliance/logins-are-not-employees.test.ts",
    "tests/compliance/rls-coverage.test.ts",
    "tests/compliance/factory-reset-core.test.ts",
    "tests/compliance/migration-execution-gate.test.ts",
    "tests/compliance/payroll-onboarding-store.test.ts",
]

STORE = "src/lib/payroll/payroll-onboarding-store.ts"
M0210 = "supabase/migrations/0210_separate_logins_from_employees.sql"
PAGE = "src/app/admin/books/payroll-setup/page.tsx"
FORM = "src/components/admin/payroll/AddPersonToPayrollForm.tsx"
ACTIONS = "src/app/admin/books/payroll-setup/actions.ts"
RESET = "src/lib/accounting/factory-reset-core.ts"

MUTATIONS = [
    # ---- the core of the slice: no staff_id on a new employee ----------------
    (
        "the new-employee insert links the creating user's login (0037 all over again)",
        STORE,
        '      full_name: fullName,\n      active: true,\n      employment_status: "active",',
        '      full_name: fullName,\n      staff_id: input.actorId ?? null,\n      active: true,\n      employment_status: "active",',
    ),
    (
        "the new employee is created inactive, so they never reach the roster",
        STORE,
        '      full_name: fullName,\n      active: true,',
        '      full_name: fullName,\n      active: false,',
    ),
    # ---- the roster filter ---------------------------------------------------
    (
        "the payroll roster stops filtering terminated people",
        STORE,
        '    .eq("active", true)\n    .neq("employment_status", "terminated")\n    .order("full_name", { ascending: true });',
        '    .order("full_name", { ascending: true });',
    ),
    (
        "the payroll roster keeps inactive people",
        STORE,
        '    .eq("active", true)\n    .neq("employment_status", "terminated")\n    .order("full_name"',
        '    .neq("employment_status", "terminated")\n    .order("full_name"',
    ),
    # ---- name handling -------------------------------------------------------
    (
        "normalisePersonName stops collapsing internal whitespace",
        STORE,
        'return raw.replace(/\\s+/g, " ").trim();',
        "return raw.trim();",
    ),
    (
        "normalisePersonName lower-cases the name that will print on a W-2",
        STORE,
        'return raw.replace(/\\s+/g, " ").trim();',
        'return raw.replace(/\\s+/g, " ").trim().toLowerCase();',
    ),
    # ---- refusals ------------------------------------------------------------
    (
        "a blank name is accepted instead of refused",
        STORE,
        '  if (fullName.length === 0) {\n    return {\n      ok: false,\n      code: "no_name",',
        '  if (false) {\n    return {\n      ok: false,\n      code: "no_name",',
    ),
    (
        "the duplicate refusal no longer says nobody was added",
        STORE,
        "        `${fullName} is already on the payroll list, so nobody was added. If this is a ` +",
        "        `${fullName} is already on the payroll list. If this is a ` +",
    ),
    (
        "the duplicate check ignores whether the match is still employed",
        STORE,
        '    .select("id, full_name")\n    .eq("active", true)\n    .neq("employment_status", "terminated")\n    .ilike("full_name", fullName);',
        '    .select("id, full_name")\n    .ilike("full_name", fullName);',
    ),
    (
        "the audit row is written before the insert is known to have worked",
        STORE,
        "  const employeeId = (data as { id: string }).id;\n\n  await recordAudit({",
        "  const employeeId = (data as { id: string }).id;\n\n  await Promise.resolve({",
    ),
    # ---- migration 0210: the quarantine --------------------------------------
    (
        "the discriminator drops the hire_date check, catching real hires",
        M0210,
        "       and e.hire_date is null\n       and not exists (select 1 from public.employee_w4",
        "       and not exists (select 1 from public.employee_w4",
    ),
    (
        "the discriminator drops the W-4 check",
        M0210,
        "       and not exists (select 1 from public.employee_w4  w where w.employee_id = e.id)\n",
        "",
    ),
    (
        "the discriminator drops the time-punch check, retiring people who clocked in",
        M0210,
        "       and not exists (select 1 from public.time_punches t where t.employee_id = e.id)\n       and not exists (select 1 from public.shifts       s where s.employee_id = e.id);\n  else",
        "       and not exists (select 1 from public.shifts       s where s.employee_id = e.id);\n  else",
    ),
    (
        "an `and` becomes an `or` in the payroll-aware branch",
        M0210,
        "       and e.hire_date is null\n       and not exists (select 1 from public.employee_w4",
        "       or e.hire_date is null\n       and not exists (select 1 from public.employee_w4",
    ),
    (
        "an `and` becomes an `or` in the pre-0195 branch (the OTHER half)",
        M0210,
        "       and e.hire_date is null\n       and not exists (select 1 from public.time_punches t where t.employee_id = e.id)\n       and not exists (select 1 from public.shifts       s where s.employee_id = e.id);\n  end if;",
        "       or e.hire_date is null\n       and not exists (select 1 from public.time_punches t where t.employee_id = e.id)\n       and not exists (select 1 from public.shifts       s where s.employee_id = e.id);\n  end if;",
    ),
    (
        "the quarantine deletes the rows instead of retiring them",
        M0210,
        "  if v_has_payroll then\n    update public.employees e",
        "  if v_has_payroll then\n    delete from public.employees e where e.staff_id is not null and e.hire_date is null;\n    update public.employees e",
    ),
    (
        "the pre-0195 branch leaves the clock PIN in place (the OTHER half)",
        M0210,
        "           clock_pin          = null,\n           termination_reason = coalesce(\n             nullif(e.termination_reason, ''),\n             'Not an employee. Created automatically",
        "           termination_reason = coalesce(\n             nullif(e.termination_reason, ''),\n             'Not an employee. Created automatically",
    ),
    (
        "the pre-0195 branch clobbers an existing termination reason (the OTHER half)",
        M0210,
        "           termination_reason = coalesce(\n             nullif(e.termination_reason, ''),\n             'Not an employee. Created automatically",
        "           termination_reason = (\n             \n             'Not an employee. Created automatically",
    ),
    (
        "the second ordering guard (0117's column) is downgraded to a notice",
        M0210,
        "    raise exception\n      'MIGRATION_OUT_OF_ORDER: 0210 needs employees.employment_status",
        "    raise notice\n      'ORDER_NOTE: 0210 needs employees.employment_status",
    ),
    (
        "the quarantine leaves the clock PIN in place",
        M0210,
        "           clock_pin          = null,\n           termination_reason = coalesce(\n             nullif(e.termination_reason, ''),\n             'Not an employee. This row was created",
        "           termination_reason = coalesce(\n             nullif(e.termination_reason, ''),\n             'Not an employee. This row was created",
    ),
    (
        "the quarantine overwrites a reason a human already wrote",
        M0210,
        "           termination_reason = coalesce(\n             nullif(e.termination_reason, ''),\n             'Not an employee. This row was created",
        "           termination_reason = (\n             \n             'Not an employee. This row was created",
    ),
    # ---- migration 0210: structure -------------------------------------------
    (
        "the out-of-order guard is removed, so it can half-apply",
        M0210,
        "    raise exception\n      'MIGRATION_OUT_OF_ORDER: 0210 separates logins from employees",
        "    raise notice\n      'ORDER_NOTE: 0210 separates logins from employees",
    ),
    (
        "the new policy table loses RLS and is published to the anon key",
        M0210,
        "alter table public.employee_provisioning_policy enable row level security;",
        "-- alter table public.employee_provisioning_policy enable row level security;",
    ),
    (
        "the policy record becomes writable through the API",
        M0210,
        "create policy employee_provisioning_policy_mgr_read on public.employee_provisioning_policy\n  for select using (public.is_manager());",
        "create policy employee_provisioning_policy_mgr_read on public.employee_provisioning_policy\n  for all using (public.is_manager());",
    ),
    (
        "logins_create_employees defaults back to true",
        M0210,
        "logins_create_employees boolean not null default false,",
        "logins_create_employees boolean not null default true,",
    ),
    (
        "the view lets terminated people back onto payroll",
        M0210,
        "   where e.active = true\n     and coalesce(e.employment_status, 'active') <> 'terminated';",
        "   where e.active = true;",
    ),
    # ---- factory reset -------------------------------------------------------
    (
        "a factory reset wipes the owner's decision, letting 0037's behaviour return",
        RESET,
        '{ table: "employee_provisioning_policy", disposition: "KEEP"',
        '{ table: "employee_provisioning_policy", disposition: "WIPE"',
    ),
    # ---- the screen ----------------------------------------------------------
    (
        "the add-person form is dropped from the payroll setup page",
        PAGE,
        "          <AddPersonToPayrollForm />",
        "          <p>Coming soon.</p>",
    ),
    (
        "the form quietly grants a back-office role as well",
        FORM,
        "const [name, setName] = useState(\"\");",
        "const [name, setName] = useState(\"\");\n  const role = \"manager\";",
    ),
    (
        "the create action loses its owner gate",
        ACTIONS,
        "export async function addPersonAction(input: { fullName: string }): Promise<AddPersonResult> {\n  const session = await requireBooksAccess();",
        "export async function addPersonAction(input: { fullName: string }): Promise<AddPersonResult> {\n  const session = { userId: null as string | null };",
    ),
    (
        "the action stops refreshing the roster, so the new person seems not to exist",
        ACTIONS,
        'revalidatePath("/admin/books/payroll-setup");\n    revalidatePath("/admin/staffing/employees");',
        "// revalidatePath removed",
    ),
]


def run_tests():
    p = subprocess.run(
        ["npx", "vitest", "run", *TESTS],
        capture_output=True,
        text=True,
    )
    out = p.stdout + p.stderr
    m = re.search(r"Tests\s+(.*)", out)
    return p.returncode, (m.group(1).strip() if m else "no summary line")


def typecheck_only(path):
    """A mutation in a .tsx/.ts file may be caught by tsc rather than vitest."""
    return path.endswith((".ts", ".tsx"))


def main():
    print("books-87 mutation probe")
    print("=" * 72)

    code, summary = run_tests()
    if code != 0:
        print(f"BASELINE IS ALREADY RED: {summary}")
        return 1
    print(f"baseline green: {summary}\n")

    survivors = []
    for i, (label, path, old, new) in enumerate(MUTATIONS, 1):
        src = io.open(path, encoding="utf-8").read()
        n = src.count(old)
        if n != 1:
            print(f"[{i:2}/{len(MUTATIONS)}] HARNESS BUG: anchor appears {n}x in {path}")
            print(f"          {label}")
            survivors.append(f"{label} (anchor {n}x)")
            continue

        io.open(path, "w", encoding="utf-8").write(src.replace(old, new))
        try:
            code, summary = run_tests()
        finally:
            io.open(path, "w", encoding="utf-8").write(src)

        if code == 0:
            print(f"[{i:2}/{len(MUTATIONS)}] SURVIVED  {label}")
            survivors.append(label)
        else:
            print(f"[{i:2}/{len(MUTATIONS)}] caught    {label}")

    print("=" * 72)
    caught = len(MUTATIONS) - len(survivors)
    print(f"{caught}/{len(MUTATIONS)} caught")
    if survivors:
        print("\nSURVIVORS - the suite cannot tell these apart from correct code:")
        for s in survivors:
            print(f"  - {s}")
        return 1
    print("every mutation was caught.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
