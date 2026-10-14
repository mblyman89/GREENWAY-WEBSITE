#!/usr/bin/env python3
"""scripts/r41/mutate-s0-gate.py - R41 S0: test the tests for the owner-authority
gate. Each mutant weakens ONE rule (owner decisions D-4..D-8). The R41 S0
vitest file must then FAIL. Files are restored after each mutant and checked
byte-for-byte at the end; a control run must pass.

    python3 scripts/r41/mutate-s0-gate.py
"""
import subprocess
import sys

G = "src/lib/payments/ach-gate.ts"
A = "src/lib/auth/ach-authority-core.ts"
AP = "src/app/admin/settings/banking/approvals/actions.ts"
OPS = "src/app/admin/settings/banking/ops-actions.ts"
VP = "src/app/admin/vendor-payments/actions.ts"
VJ = "vercel.json"
T = ["tests/compliance/r41-s0-owner-authority.test.ts"]

M = [
    # routing (D-6)
    ("admin-acts-directly", A, 'return classifyAchAction(kind) === "stop" ? { route: "run", receipt: false, review: true } : { route: "request" };',
     'return { route: "run", receipt: false, review: classifyAchAction(kind) === "stop" };'),
    ("manager-is-admin", A, '  if (who === "none") return { route: "refuse", refusal: REFUSE_NO_ACH_ROLE };', '  if (who === "none") return { route: "request" };'),
    ("owner-no-receipt", A, '  if (who === "act") return { route: "run", receipt: true, review: false };', '  if (who === "act") return { route: "run", receipt: false, review: false };'),
    ("stop-no-review", A, '{ route: "run", receipt: false, review: true }', '{ route: "run", receipt: false, review: false }'),
    # request path
    ("request-runs-body", G, '    if (!ins.ok) return opts.reply({ ok: false, message: ins.error });',
     '    if (!ins.ok) return opts.reply({ ok: false, message: ins.error });\n    await run(session);'),
    ("plaintext-stored", G, '    if (!payloadEnc.startsWith("encv1:")) return opts.reply({ ok: false, message: NO_KEY_REFUSAL });', ''),
    ("no-stale-version", G, '    const version = await readTargetVersion(kind, targetId);\n    if (!version.ok) return opts.reply({ ok: false, message: version.error });',
     '    const version = { ok: true as const, version: null };'),
    ("request-no-mail", G, '    const mailed = await mailMichael(\n      requestArrivedEmail({', '    const mailed = true || await mailMichael(\n      requestArrivedEmail({'),
    ("requester-from-form", G, '      requestedBy: session.profile.id,', '      requestedBy: String(fd.get("requested_by") ?? session.profile.id),'),
    # run path
    ("receipt-on-failure", G, '  if (outcome.ok) {\n    const label', '  if (true) {\n    const label'),
    ("no-supersede", G, '      if (targetId) await supersedePendingFor(', '      if (false) await supersedePendingFor('),
    ("swallow-errors", G, '    if (redirectUrl === null) throw e; // a real error', '    if (redirectUrl === null) return opts.reply({ ok: false, message: "x" }); // a real error'),
    ("stop-no-suffix", G, '      if (redirectUrl !== null) redirect(withOutcomeSuffix(redirectUrl, suffix));', ''),
    ("review-fail-hidden", G, '            : "The review item for Michael could NOT be saved: tell him yourself now.";', '            : STOP_DONE_SUFFIX;'),
    # replay
    ("replay-any-kind", G, ' || !replayMatches(replay, { kind, targetId })) {', ') {'),
    ("replay-any-owner", G, ' || session.profile.id !== replay.ownerId || ', ' || '),
    ("replay-admin", G, '    if (achAuthority(session.profile.role) !== "act" || session.profile.id', '    if (session.profile.id'),
    # stop list
    ("third-stop-kind", A, '  "employee_hold.release": { cls: "live",', '  "employee_hold.release": { cls: "stop",'),
    # wiring
    ("ops-bypass", OPS, '  return achGate("ach_notice.resolve", fd,', '  return resolveNoticeBody(await (await import("@/lib/auth/session")).requirePermission("settings.manage"), fd);\n  return achGate("ach_notice.resolveX", fd,'),
    ("replay-gap", AP, '  "annual_review.done": (fd) => ops.reviewDoneAction(fd),\n', ''),
    ("approve-not-owner", AP, 'ApprovalState> {\n  const session = await requirePermission("ach.act");\n  if (achAuthority(session.profile.role) !== "act") return { ok: false, message: "Only Michael (the owner) approves', 'ApprovalState> {\n  const session = await requirePermission("ach.request");\n  if (achAuthority(session.profile.role) !== "act") return { ok: false, message: "Only Michael (the owner) approves'),
    ("build-ungated", VP, 'return achGate("vendor_ach.build", formData, { reply: buildReply, outcomeOf: vendorBuildOutcome }', 'return achGate("vendor_ach.build", formData, { reply: buildReply }'),
    ("cron-twice", VJ, '"path": "/api/cron/ach-approvals-reminder",\n      "schedule": "0 15 * * *"', '"path": "/api/cron/ach-approvals-reminder",\n      "schedule": "0 */12 * * *"'),
]

files = sorted({m[1] for m in M})
orig = {f: open(f).read() for f in files}
surv = []
for name, f, a, b in M:
    s0 = orig[f]
    if s0.count(a) != 1:
        print(f"ANCHOR {s0.count(a)} {name}", flush=True)
        surv.append(name)
        continue
    open(f, "w").write(s0.replace(a, b, 1))
    try:
        r = subprocess.run(["timeout", "240", "npx", "vitest", "run", *T], capture_output=True, text=True)
    finally:
        open(f, "w").write(s0)
    k = r.returncode != 0
    print(f"{'killed  ' if k else 'SURVIVED'} {name}", flush=True)
    if not k:
        surv.append(name)
for f in files:
    assert open(f).read() == orig[f], f
ctl = subprocess.run(["timeout", "240", "npx", "vitest", "run", *T], capture_output=True, text=True)
print("control", "pass" if ctl.returncode == 0 else "FAILED")
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv or ctl.returncode != 0 else 0)
