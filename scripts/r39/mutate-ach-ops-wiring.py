"""R39 S7 part 2 - mutation run on the ACH operations UI wiring (server actions,
check-file route, Operations page, Banking link). Each mutant must make
tests/compliance/r39-ach-ops-wiring.test.ts fail. Every file is restored after
each mutant and checked byte-for-byte at the end."""
import subprocess, sys
A = "src/app/admin/settings/banking/ops-actions.ts"
R = "src/app/admin/settings/banking/operations/check-file/route.ts"
P = "src/app/admin/settings/banking/operations/page.tsx"
B = "src/app/admin/settings/banking/page.tsx"
T = "tests/compliance/r39-ach-ops-wiring.test.ts"
M = [
    # actions: achGate first (R41 S0)
    (A, '  return achGate("ach_notice.log", fd,', '  const session = await requirePermission("settings.manage");\n  void session;\n  return achGate("ach_notice.log", fd,'),
    (A, 'return achGate("annual_review.done", fd,', 'return achGate("legal_hold.set", fd,'),
    (A, '(session) => reviewDoneBody(session, fd));\n}', '(session) => reviewDoneBody(session, fd));\n}\n\nexport async function reviewDoneDirect(fd: FormData): Promise<void> {\n  return reviewDoneBody(await requirePermission("settings.manage"), fd);\n}'),
    (A, 'async function startCheckBody(', 'export async function startCheckBody('),
    (A, 'actorIsOwner: achAuthority(session.profile.role) === "act",', 'actorIsOwner: str(fd, "is_owner") === "yes",'),
    # audit after ok-check
    (A, '  if (!r.ok) back({ error: r.error }, "#holds");\n', ''),
    (A, 'actorId: session.profile.id, actorEmail: session.email, action: "ach.notice.resolved"', 'actorId: str(fd, "actor"), actorEmail: session.email, action: "ach.notice.resolved"'),
    # store mapping
    (A, 'const r = await finishCheck({', 'const r = await startCheck({'),
    # confirm checkbox
    (A, 'if (str(fd, "confirm") !== "yes") back(', 'if (false) back('),
    (A, 'fingerprint: str(fd, "fp")', 'fingerprint: ""'),
    # micro amounts never audited
    (A, 'after: { account_id: accountId, method: r.method }', 'after: { account_id: accountId, method: r.method, micro: true }'),
    # redirect echo
    (A, 'back({ error: "Tick the box to confirm the file was uploaded to Timberland." }, "#checks")', 'back({ error: str(fd, "confirm") }, "#checks")'),
    # mailer / site url
    (A, '    mail: resendOpsMailer(),\n  });\n  if (!r.ok) back({ error: r.error }, "#notices");', '    mail: async () => ({ ok: true }),\n  });\n  if (!r.ok) back({ error: r.error }, "#notices");'),
    (A, '`${opsSiteUrl(process.env)}${OPS}`', '`${process.env.NEXT_PUBLIC_SITE_URL}${OPS}`'),
    # route
    (R, '  const session = await requirePermission("settings.manage");\n  const q = new URL', '  const q = new URL(req.url);\n  const session = await requirePermission("settings.manage");\n  void q;\n  const q2 = new URL'),
    (R, 'if (!/^[0-9a-f]{16}$/.test(fp)) {', 'if (!fp) {'),
    # R41 S3: the route serves the released bytes for exactly this list
    (R, 'checkFileSourceId(method, q.get("effective") ?? "", fp));', 'checkFileSourceId(method, q.get("effective") ?? "", ""));'),
    (R, 'return new Response(res.body, {', 'return new Response(res.body.replace(/\\r\\n/g, "\\n"), {'),
    (R, '{ status: 400, headers: { "Cache-Control": "no-store" } });\n  }\n  const res', '{ status: 400 });\n  }\n  const res'),
    (R, '      "X-Content-Type-Options": "nosniff",\n', ''),
    (R, 'filename: res.row.filename, file_id_modifier', 'filename: res.row.filename, account: res.body, file_id_modifier'),
    (R, 'import { checkFileSourceId } from "@/lib/payments/ach-ops-store";', 'import { checkFileSourceId, buildCheckFile } from "@/lib/payments/ach-ops-store";\nvoid buildCheckFile;'),
    (R, 'const res = await readLiveFileForSource(', 'void releaseCheckFileX;\n  const res = await readLiveFileForSource('),
    (P, 'action={releaseCheckFileAction}', 'action={markCheckFileSentAction}'),
    # page
    (P, 'export const dynamic = "force-dynamic";', ''),
    (P, '<form action={reviewDoneAction}', '<form'),
    (P, '<section id="records"', '<section id="record"'),
    (P, '<input type="hidden" name="fp" value={fp} />', '<input type="hidden" name="fp" value="" />'),
    (P, 'name="confirm" value="yes" required', 'name="confirm" value="yes"'),
    (P, '&fp=${fp}', ''),
    # banking link
    (B, '<Link href="/admin/settings/banking/operations"', '<Link href="/admin/settings/banking"'),
]
files = sorted({f for f, _, _ in M})
orig = {f: open(f).read() for f in files}
surv = []
for i, (f, a, b) in enumerate(M):
    s0 = orig[f]
    if s0.count(a) < 1:
        print(i, "ANCHOR MISSING", a[:60].replace("\n", " "), flush=True)
        surv.append(i)
        continue
    open(f, "w").write(s0.replace(a, b, 1))
    try:
        r = subprocess.run(["timeout", "150", "npx", "vitest", "run", T], capture_output=True, text=True)
    finally:
        open(f, "w").write(s0)
    k = r.returncode != 0
    print(i, "killed" if k else "SURVIVED", f.split("/")[-1], a[:60].replace("\n", " "), flush=True)
    if not k:
        surv.append(i)
for f in files:
    assert open(f).read() == orig[f], f
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv else 0)
