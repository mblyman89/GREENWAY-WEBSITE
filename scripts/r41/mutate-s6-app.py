#!/usr/bin/env python3
"""scripts/r41/mutate-s6-app.py - R41 S6: test the tests for the app layer of
"approval at Timberland, modelled honestly" (Mark uploaded / Mark approved,
the grey dual-approval line, the checklist, the honest wording, the Guide's
Timberland setup). Each mutant changes ONE thing; then the pure self-tests
(run-pure-selftests.ts) OR the S6 / S0 / R40 vitest files must FAIL. Files are
restored after each mutant and checked byte-for-byte at the end; a control run
must pass first and last.

The test that reads THIS script's log is left out of every run (-t), so a
stale log can never "kill" a mutant.

    python3 scripts/r41/mutate-s6-app.py | tee scripts/r41/mutate-s6-app.last.log
"""
import subprocess
import sys

STEPS = "src/lib/payments/timberland-bank-steps-core.ts"
STORE = "src/lib/payments/ach-file-ledger-store.ts"
LCORE = "src/lib/payments/ach-file-ledger-core.ts"
ACT = "src/app/admin/settings/banking/file-actions.ts"
PAGE = "src/app/admin/settings/banking/operations/page.tsx"
AUTH = "src/lib/auth/ach-authority-core.ts"
GATE = "src/lib/payments/ach-gate-core.ts"
APPR = "src/app/admin/settings/banking/approvals/actions.ts"
GUIDE = "src/lib/payments/ach-guide-core.ts"
GSTORE = "src/lib/payments/ach-guide-store.ts"
CAL = "src/lib/payments/ach-calendar-core.ts"
T = [
    "tests/compliance/r41-s6-bank-steps.test.ts",
    "tests/compliance/r41-s0-owner-authority.test.ts",
    "tests/compliance/r40-ach-guide-calendar.test.ts",
    "tests/compliance/r41-s3-ach-files.test.ts",
]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- store: the right function, the right arguments, never a false success ---
    ("rpc-names-swapped", STORE, '  uploaded: "ach_file_mark_uploaded",\n  bank_approved: "ach_file_mark_bank_approved",', '  uploaded: "ach_file_mark_bank_approved",\n  bank_approved: "ach_file_mark_uploaded",'),
    ("bad-id-reaches-db", STORE, '  if (!/^[0-9a-f-]{36}$/i.test(input.fileId)) return { ok: false, error: ledgerDbErrorMessage("ACH_FILE_NOT_FOUND") };\n  const { data, error } = await createSupabaseAdminClient().rpc(fn,', '  const { data, error } = await createSupabaseAdminClient().rpc(fn,'),
    ("empty-reply-ok", STORE, '  if (!["payroll", "vendor", "prenote", "micro_entry"].includes(kind)) return { ok: false, error: "The database did not confirm the bank step. Reload the page." };', ""),
    ("stamp-cols-dropped", STORE, "voided_reason, uploaded_by, uploaded_at, approved_at_bank_by, approved_at_bank_at\";", "voided_reason\";"),
    # --- error words ---
    ("final-shadowed-by-step", LCORE, '  [/ACH_BANK_STEP_FINAL/, "Who uploaded or approved this file at Timberland, and when, is already recorded and never changes."],\n', ""),
    ("missing-0274-says-0273", LCORE, '  [/ach_file_mark_(uploaded|bank_approved).*does not exist|Could not find the function public\\.ach_file_mark_/, "The Timberland bank steps are not set up yet: run migration 0274 (docs/MIGRATIONS_TO_RUN.md). Nothing was changed."],\n', ""),
    # --- owner authority ---
    ("upload-kind-is-stop", AUTH, '"ach_file.mark_uploaded": { cls: "live",', '"ach_file.mark_uploaded": { cls: "stop",'),
    ("approve-spec-unversioned", GATE, '  "ach_file.mark_bank_approved": { targetType: "ach_file", idField: "file_id", version: { table: "ach_files", key: "id", cols: ["status"] } },', '  "ach_file.mark_bank_approved": { targetType: "ach_file", idField: "file_id", version: null },'),
    ("replay-dropped", APPR, '  "ach_file.mark_bank_approved": (fd) => files.markAchFileBankApprovedAction(fd),\n', ""),
    ("approve-action-wrong-step", ACT, '(session) => markBankStepBody(session, fd, "bank_approved"));', '(session) => markBankStepBody(session, fd, "uploaded"));'),
    ("confirm-box-skipped", ACT, '  if (str(fd, "confirm") !== "yes") {\n    back({\n      error:\n        step === "uploaded"', '  if (false) {\n    back({\n      error:\n        step === "uploaded"'),
    ("dismiss-not-owner-only", ACT, '  if (session.profile.role !== "owner") back({ error: "Only the owner can hide this note." });\n', ""),
    ("dismiss-not-logged", ACT, '    action: "ach.dual_approval_note.dismissed",', '    action: "ach.calendar.done",'),
    # --- buttons and the grey line ---
    ("button-on-approved", STEPS, '  if (status === "uploaded") {', '  if (status === "uploaded" || status === "bank_approved") {'),
    ("admin-button-says-mark", STEPS, 'label: isOwner ? "Mark uploaded" : "Ask the owner to mark uploaded",', 'label: "Mark uploaded",'),
    ("dismiss-forever", STEPS, "  return dismiss.year !== todayIso.slice(0, 4);", "  return false;"),
    ("note-shown-when-dual-on", STEPS, "  if (dualApprovalOn) return false;\n", ""),
    ("utc-dates", STEPS, 'timeZone: "America/Los_Angeles"', 'timeZone: "UTC"'),
    ("grey-line-turns-amber", PAGE, 'border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/55', 'border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-100'),
    ("page-ignores-dismiss", PAGE, "  const showDualNote = dualNoteVisible(dualNote.dismiss, today);", "  const showDualNote = dualNoteVisible(null, today);"),
    ("page-button-always-owner", PAGE, "const b = bankStepButton(f.status, isOwner);", "const b = bankStepButton(f.status, true);"),
    # --- honest wording ---
    ("old-claim-back", CAL, "Remove anyone who should not be there. Check the phone number", "Remove anyone who should not be there. Confirm dual control is still on. Check the phone number"),
    ("banned-list-shrinks", STEPS, '  "the other owner",\n];', "];"),
    # --- Guide: Timberland setup ---
    ("dual-step-counts", GUIDE, '      status: "optional",\n      href: GUIDE_LINKS.files,\n      hrefLabel: "Open released files",\n    },\n    {\n      id: "tb-match",', '      status: st(t.dualApprovalOn),\n      href: GUIDE_LINKS.files,\n      hrefLabel: "Open released files",\n    },\n    {\n      id: "tb-match",'),
    ("unread-stamp-is-done", GUIDE, "      status: st(t.matchConfirmed === true),", "      status: st(t.matchConfirmed !== false),"),
    ("journey-dropped", GUIDE, "  return [setup, timberland, employees, vendors, payday];", "  return [setup, employees, vendors, payday];"),
    ("store-prenote-any-status", GSTORE, '.eq("method", "prenote").eq("status", "passed")', '.eq("method", "prenote")'),
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
