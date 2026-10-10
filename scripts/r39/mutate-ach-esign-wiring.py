"""R39 S6 - mutation run on the e-sign UI files. Each mutant must make
tests/compliance/r39-ach-esign-wiring.test.ts fail. Files are restored after each."""
import subprocess, sys
D = "src/app/admin/staffing/employees/[id]/esign/"
A, P, R = D + "actions.ts", D + "page.tsx", D + "record/route.ts"
C = "src/app/admin/staffing/employees/[id]/EmployeeAchCard.tsx"
T = "tests/compliance/r39-ach-esign-wiring.test.ts"
M = [
    (A, 'export async function cancelEsignAction(fd: FormData): Promise<void> {\n  const session = await requirePermission("settings.manage");', 'export async function cancelEsignAction(fd: FormData): Promise<void> {\n  const session = await requirePermission("staffing.manage");'),
    (A, 'if (!s || s.employee_id !== employeeId) back(', 'if (!s) back('),
    (A, 'if (str(fd, "id_seen") !== "on") back(', 'if (false) back('),
    (A, '?done=${encodeURIComponent(s.id)}&ok=', '?ok='),
    (A, 'action: "ach_esign.cancel"', 'action: "ach_esign.cancelled_x"'),
    (A, 'to: [book.stephen.email, book.michael.email, book.store.email]', 'to: [book.store.email]'),
    (A, '  const s = await sessionFor(fd, employeeId);\n  const res = await sendEsignCode(', '  const s = (await getEsignSession(str(fd, "session_id")))!;\n  const res = await sendEsignCode('),
    (A, 'after: { state: "cancelled", reason: reason.slice(0, 500) },', 'after: { state: "cancelled", reason: reason.slice(0, 500), email: str(fd, "email") },'),
    (P, 'await requirePermission("settings.manage");', 'await requirePermission("staffing.view");'),
    (P, 'done && done.employee_id === employeeId ? done : null', 'done'),
    (P, '<input type="hidden" name="disclosure_sha256" value={currentDisclosureSha256()} />', '<input type="hidden" name="disclosure_sha256" value="" />'),
    (P, '<AccountRow i={3} />', ''),
    (P, 'name={`a${i}_acct2`}', 'name={`a${i}_acct_again`}'),
    (P, 'name="typed_name"', 'name="signature"'),
    (P, '{ACH_E_TERMS.terms.map(', '{ACH_E_TERMS.terms.slice(0, 3).map('),
    (R, '"Cache-Control": "no-store, private"', '"Cache-Control": "private, max-age=3600"'),
    (R, 'if (!s || s.employee_id !== employeeId) return new Response("Not found.", { status: 404 });', 'if (!s) return new Response("Not found.", { status: 404 });'),
    (R, 'await requirePermission("settings.manage");', 'await requirePermission("staffing.view");'),
    (R, '"X-Content-Type-Options": "nosniff",\n', ''),
    (C, 'Sign electronically (in person)', 'E-sign'),
]
surv = []
for i, (f, a, b) in enumerate(M):
    s0 = open(f).read()
    if s0.count(a) < 1:
        print(i, "ANCHOR MISSING", f, a[:50].replace("\n", " "), flush=True)
        surv.append(i)
        continue
    open(f, "w").write(s0.replace(a, b, 1))
    try:
        r = subprocess.run(["timeout", "120", "npx", "vitest", "run", T], capture_output=True, text=True)
    finally:
        open(f, "w").write(s0)
    k = r.returncode != 0
    print(i, "killed" if k else "SURVIVED", f.split("/")[-1], a[:60].replace("\n", " "), flush=True)
    if not k:
        surv.append(i)
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv else 0)
