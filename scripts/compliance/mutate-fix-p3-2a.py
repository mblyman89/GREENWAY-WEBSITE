"""
scripts/compliance/mutate-fix-p3-2a.py

Fix Phase 3.2a (G-17, F-04-4): every manifest email reaches the table.
Owner, verbatim:
  "In addition to a notice when an email fails, please add a refetch button,
   or some intelligent way to manually ask the fetcher to look again ...
   I need a way to ask the system to grab the ones it missed or failed to
   get. Make it enterprise grade. ... I want this table to receive every
   manifest, no exceptions."

Rule 13c: a test that cannot fail is worse than no test. Rule 137: every
anchor must match EXACTLY once or the harness fails.

Usage:  python3 scripts/compliance/mutate-fix-p3-2a.py
"""
import io
import subprocess
import sys

CORE = "src/lib/inbound-email/inbound-reconcile-core.ts"
STORE = "src/lib/inbound-email/inbound-reconcile-store.ts"
ACT = "src/app/admin/inventory/intake/actions.ts"
CRON = "src/app/api/cron/inbound-reconcile/route.ts"
PAGE = "src/app/admin/inventory/intake/page.tsx"

TESTS = [
    "tests/compliance/fix-p3-2a-inbound-reconcile.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # --- the pure rules
    ("core: no grace period (a webhook still landing is pulled twice)", CORE,
     "    if (Number.isFinite(t) && input.nowMs - t < grace) {", "    if (false) {"),
    ("core: an email already on the table is pulled again", CORE,
     "    if (matchSourceToLog(s, input.logs)) {\n      onTable += 1;", "    if (false) {\n      onTable += 1;"),
    ("core: the same email in Gmail and Resend pulled twice", CORE,
     "    if (mid && seenMid.has(mid)) {", "    if (false) {"),
    ("core: no per-run cap", CORE,
     "ingest: missing.slice(0, max),", "ingest: missing,"),
    ("core: a fresh claim counts as stuck", CORE,
     "    if (Number.isFinite(t) && nowMs - t < STUCK_AFTER_MS) return null;", "    // fresh claim rule removed"),
    ("core: a non-intake email needs attention", CORE,
     "  if (row.to_intake === false) return null;", "  // non-intake rule removed"),
    ("core: a fetch failure counts as permanent", CORE,
     "    if (noteShowsFetchFailure(row.note)) {", "    if (false) {"),
    ("core: auto-retry has no cap", CORE,
     "  if (n >= MAX_AUTO_RETRIES) return false;\n  return nowMs - baseTimeMs(row) >= AUTO_RETRY_BACKOFF_MS[n];",
     "  return nowMs - baseTimeMs(row) >= (AUTO_RETRY_BACKOFF_MS[n] ?? 0);"),
    ("core: auto-retry has no backoff", CORE,
     "  return nowMs - baseTimeMs(row) >= AUTO_RETRY_BACKOFF_MS[n];", "  return true;"),
    ("core: a resolved row can be fetched again", CORE,
     '  if (row.resolved_at) return { ok: false, reason: "This email was marked Resolved. It is closed." };', "  // resolved rule removed"),
    ("core: a staged row can be fetched again", CORE,
     '  if (disp === "staged") return { ok: false,', '  if (disp === "x-staged") return { ok: false,'),
    ("core: alerts repeat", CORE,
     "    .filter((i) => i.person && !alreadyAlerted.has(failAlertKey(i.row.id)))", "    .filter((i) => i.person)"),
    ("core: alerts are not capped", CORE,
     "    .slice(0, Math.max(0, max));", "    .slice(0);"),
    # --- the store
    ("store: alert sent without claiming the key first", STORE,
     '    if (error) return error.code === "23505" ? "taken" : "error";', "    // claim check removed"),
    ("store: a failed refetch loses the intake identity", STORE,
     "      return { ok: true, outcome: await routeAndStage(keepIntakeIdentity(email, s), null, note, logId, ingestSource), skipped: null };",
     "      return { ok: true, outcome: await routeAndStage(email, null, note, logId, ingestSource), skipped: null };"),
    ("store: retry loses the intake identity", STORE,
     "    const out = await routeAndStage(keepIntakeIdentity(email, source), null,",
     "    const out = await routeAndStage(email, null,"),
    ("store: intake identity drops the mailbox", STORE,
     "    to: email.to.length > 0 ? email.to : [intakeMailbox()],", "    to: email.to,"),
    ("store: no race guard on Try again (retry_count)", STORE,
     '  const cas = await q.eq("retry_count", n).select("id");', '  const cas = await q.select("id");'),
    ("store: no race guard on Try again (disposition)", STORE,
     '    .eq("disposition", row.disposition ?? "")\n    .is("resolved_at", null);\n',
     '    .is("resolved_at", null);\n'),
    ("store: Try again ignores eligibility", STORE,
     "  const can = retryEligibility(row, nowMs);", "  const can = { ok: true as const } as { ok: true } | { ok: false; reason: string };"),
    ("store: Resolved has no race guard", STORE,
     '.update(after).eq("id", logId).is("resolved_at", null).select("id");', '.update(after).eq("id", logId).select("id");'),
    ("store: Resolved accepts any reason", STORE,
     "  const v = validateResolve(reason, note);\n  if (!v.ok) return { ok: false, error: v.error };",
     '  const v = { ok: true as const, reason: String(reason) as never, note: null as string | null };'),
    ("store: no claim before pulling an email", STORE,
     '  if (claim.kind === "duplicate") return { ok: true, outcome: null, skipped: "already_claimed" };', "  // claim check removed"),
    ("store: Gmail fetch failure is not recorded", STORE,
     "      await logInboundEmail({\n        email: placeholderEmail(s),",
     "      void ({\n        email: placeholderEmail(s),"),
    ("store: a throw keeps the claim forever", STORE,
     "    if (logId) await releaseInboundDelivery(logId);", "    // release removed"),
    ("store: mail for other addresses is pulled in", STORE,
     ".filter((x): x is SourceEmail => !!x && addressedTo(x, intake));", ".filter((x): x is SourceEmail => !!x);"),
    ("store: Check now waits the full 15 minute grace", STORE,
     'graceMs: opts.trigger === "manual" ? MANUAL_GRACE_MS : undefined,', "graceMs: undefined,"),
    ("store: no automatic retries", STORE,
     '        const res = await retryInboundEmail(r.id, null, "reconcile", Date.now());\n        if (res.ok) out.autoRetried += 1;',
     "        void r;"),
    ("store: no alerts", STORE,
     '        if (a && (await sendInboundAlert(admin, a)) === "sent") out.alertsSent += 1;', "        void a;"),
    ("store: no heartbeat", STORE,
     "  if (shouldWriteHeartbeat(prev, hb, nowMs)) await writeHeartbeat(admin, hb);", "  void writeHeartbeat;"),
    ("store: no health alert", STORE,
     '  if (health && (await sendInboundAlert(admin, health)) === "sent") out.alertsSent += 1;', "  void health;"),
    # --- the wiring
    ("actions: Check now without permission", ACT,
     'export async function checkMailboxNowAction() {\n  const session = await requirePermission("inventory.manage");',
     'export async function checkMailboxNowAction() {\n  const session = { userId: "x" };'),
    ("actions: Try again without permission", ACT,
     'export async function retryInboundEmailAction(logId: string) {\n  const session = await requirePermission("inventory.manage");',
     'export async function retryInboundEmailAction(logId: string) {\n  const session = { userId: "x" };'),
    ("actions: Resolved without permission", ACT,
     'export async function resolveInboundEmailAction(logId: string, formData: FormData) {\n  const session = await requirePermission("inventory.manage");',
     'export async function resolveInboundEmailAction(logId: string, formData: FormData) {\n  const session = { userId: "x" };'),
    ("actions: Find without permission", ACT,
     'export async function findInboundEmailAction(formData: FormData) {\n  const session = await requirePermission("inventory.manage");',
     'export async function findInboundEmailAction(formData: FormData) {\n  const session = { userId: "x" };'),
    ("cron: does not run the check", CRON,
     '  const r = await runReconcile({ trigger: "cron" });', '  const r = await runReconcile({ trigger: "manual" });'),
    ("page: panel not shown", PAGE,
     "        <InboundAttentionPanel\n", "        <InboundAttentionPanelGone\n"),
]


def run_tests() -> bool:
    proc = subprocess.run(
        ["./node_modules/.bin/vitest", "run", *TESTS],
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    caught, survived = 0, []

    for label, path, find, repl in MUTATIONS:
        original = io.open(path, encoding="utf-8").read()
        hits = original.count(find)
        # Rule 137: exactly one, or this is not a probe.
        if hits != 1:
            print(f"  ERROR  {label}")
            print(f"         anchor matched {hits} times in {path}; expected exactly 1")
            print("         FAILING rather than skipping (rules 48, 137).")
            return 2

        io.open(path, "w", encoding="utf-8").write(original.replace(find, repl, 1))
        try:
            if run_tests():
                survived.append(label)
                print(f"  SURVIVED  {label}", flush=True)
            else:
                caught += 1
                print(f"  caught    {label}", flush=True)
        finally:
            io.open(path, "w", encoding="utf-8").write(original)

    total = len(MUTATIONS)
    print(f"\n{caught}/{total} mutations caught")
    if survived:
        print("\nSURVIVORS (these are holes in the tests):")
        for s in survived:
            print(f"  - {s}")
        return 1
    print("Every deliberate break was noticed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
