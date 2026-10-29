"""
scripts/compliance/mutate-fix-p2-7c.py

Fix Phase 2.7c (G-11 supply-run screen, owner D17: "Q-02-4- id like the
supply run screen built"; F-02-11). Rule 13c: a test that cannot fail is
worse than no test. This breaks the 2.7c work on purpose, one edit at a
time, and demands that the suite NOTICE.

Rule 133g: several mutations SEVER THE DOOR (the action stops checking the
approver, the settle stops requiring receipt + change = cash taken, the
poster credits 12100 before the advance is in the books, the database stops
refusing a delete).
Rule 137: every anchor must match EXACTLY once or the harness fails.

Usage:  python3 scripts/compliance/mutate-fix-p2-7c.py
"""
import io
import subprocess
import sys

CORE = "src/lib/registers/supply-run-core.ts"
STORE = "src/lib/registers/supply-run-store.ts"
POSTER = "src/lib/accounting/supply-run-posting-service.ts"
ACTIONS = "src/app/admin/registers/supply-runs/actions.ts"
PAGE = "src/app/admin/registers/supply-runs/page.tsx"
REG = "src/app/admin/registers/page.tsx"
SAFE = "src/app/admin/registers/safe/page.tsx"
MIG = "supabase/migrations/0318_supply_runs.sql"
RESET = "src/lib/accounting/factory-reset-core.ts"
CENSUS = "src/lib/accounting/ledger-census-data.ts"

TESTS = [
    "tests/compliance/fix-p2-7c-supply-runs.test.ts",
    "tests/compliance/factory-reset-core.test.ts",
    "tests/compliance/ledger-census.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # pure rules: cash out
    ("parse: sub-cent accepted", CORE, "  if (!/^\\d+(\\.\\d{1,2})?$/.test(s)) return null;", "  if (!/^\\d+(\\.\\d+)?$/.test(s)) return null;"),
    ("cash out: zero accepted", CORE, "  if (amount === null || amount <= 0) {", "  if (amount === null) {"),
    ("cash out: no $1,000 cap", CORE, "  if (amount > MAX_SUPPLY_RUN_MINOR) {", "  if (false) {"),
    ("cash out: blank reason accepted", CORE, '  if (reason === "") {', "  if (false) {"),
    ("cash out: reason not capped", CORE, "  if (reason.length > SUPPLY_TEXT_MAX_LEN) {", "  if (false) {"),
    ("cash out: sales PIN approves (door)", CORE, "  if (!SUPPLY_APPROVER_ROLES.includes(input.approver.role)) {", "  if (false) {"),
    ("cash out: taker approves self (door)", CORE, "  if (input.approver.id === input.taker.id) {", "  if (false) {"),
    ("approver roles: sales added", CORE, 'SUPPLY_APPROVER_ROLES: readonly string[] = ["manager", "lead"];', 'SUPPLY_APPROVER_ROLES: readonly string[] = ["manager", "lead", "sales"];'),
    # pure rules: settle
    ("settle: settled twice", CORE, "  if (input.alreadySettled) {", "  if (false) {"),
    ("settle: receipt > taken accepted", CORE, "  if (receipt > input.amountMinor) {", "  if (false) {"),
    ("settle: receipt + change unchecked (door)", CORE, "  if (receipt + change !== input.amountMinor) {", "  if (false) {"),
    ("settle: no account needed", CORE, "    if (!acct) {\n      return { ok: false, error: \"Pick what", "    if (false) {\n      return { ok: false, error: \"Pick what"),
    ("settle: taker receives own change", CORE, "  if (input.takerId !== null && input.receiver.id === input.takerId) {", "  if (false) {"),
    ("settle: note not capped", CORE, "  if (note.length > SUPPLY_TEXT_MAX_LEN) {", "  if (false) {"),
    ("cost class: unknown account allowed", CORE, "  if (expenseAccount !== null && !acct) return null;", "  if (false) return null;"),
    ("cost class: not applied", CORE, "acct && l.accountCode === acct.code ? { ...l, costClass: acct.costClass }", "false ? { ...l, costClass: acct!.costClass }"),
    ("source ref: advance collides with settle", CORE, "  return `supply-advance:${runId}`;", "  return `supply-settle:${runId}`;"),
    ("open total: settled runs counted", CORE, "  return rows.filter(isOpen).reduce((s, r) => s + r.amountMinor, 0);", "  return rows.reduce((s, r) => s + r.amountMinor, 0);"),
    ("notice: shown with no open runs", CORE, "  if (open.length === 0) return null;", "  if (false) return null;"),
    ("notPosted: settle leg never flagged", CORE, "settle: r.settledAt !== null && r.settleJournalId === null", "settle: false"),
    # poster
    ("poster: settle before advance (door)", POSTER, "  if (run.advanceJournalId === null) {", "  if (false) {"),
    ("poster: unsettled run posted", POSTER, "  if (run.settledAt === null || run.settledDay === null || run.receiptMinor === null) {", "  if (false) {"),
    ("poster: unclassified expense posted", POSTER, "  if (lines === null) {", "  if (false) {"),
    ("poster: advance dated wrong", POSTER, "journalDate: run.businessDay, employeeName: who", "journalDate: \"2000-01-01\", employeeName: who"),
    ("poster: settle dated on cash-out day", POSTER, "    journalDate: run.settledDay,", "    journalDate: run.businessDay,"),
    ("poster: settle uses advance ref", POSTER, "  const sourceRef = settleSourceRef(run.id);", "  const sourceRef = advanceSourceRef(run.id);"),
    ("poster: advance not auto-posted", POSTER, "      autoPost: true,\n    },\n    admin,\n  );\n  if (!result.ok) return { kind: \"failed\", runId, sourceRef, code: result.code, message: result.message };\n\n  let linkError: string | null = null;\n  const journalId = result.journalId ?? null;\n  if (journalId && !run.advanceJournalId)", "      autoPost: false,\n    },\n    admin,\n  );\n  if (!result.ok) return { kind: \"failed\", runId, sourceRef, code: result.code, message: result.message };\n\n  let linkError: string | null = null;\n  const journalId = result.journalId ?? null;\n  if (journalId && !run.advanceJournalId)"),
    # store
    ("store: failed page reads as no runs", STORE, "  if (!read.verdict.complete) return", "  if (false) return"),
    # actions
    ("action: cash out refusal ignored (door)", ACTIONS, "  if (!chk.ok) {\n    await recordAudit({", "  if (false) {\n    await recordAudit({"),
    ("action: cash out not posted", ACTIONS, "  const post = await postAdvanceForRun(saved.id);", "  const post = { kind: \"failed\" as const, runId: saved.id, sourceRef: null, code: \"X\", message: \"\" };"),
    ("action: settle refusal ignored (door)", ACTIONS, "  if (!chk.ok) fail(chk.error);\n  const day = pacificToday();\n  const saved = await saveSettle", "  const day = pacificToday();\n  const saved = await saveSettle"),
    ("action: already-settled not passed", ACTIONS, "    alreadySettled: run.settledAt !== null,", "    alreadySettled: false,"),
    ("action: retry failure shown green", ACTIONS, "  if (post.kind !== \"posted\") fail(describeSupplyPost(post, leg));", ""),
    # migration
    ("db: amount cap lifted", MIG, "  check (amount_minor > 0 and amount_minor <= 100000);", "  check (amount_minor > 0);"),
    ("db: taker may approve", MIG, "  check (taken_by is null or approved_by is null or taken_by <> approved_by);", "  check (true);"),
    ("db: receipt + change unchecked", MIG, "      and receipt_minor + change_minor = amount_minor\n", "\n"),
    ("db: delete allowed (door)", MIG, "  if tg_op = 'DELETE' then\n    raise exception 'SUPPLY_RUN_PERMANENT", "  if false then\n    raise exception 'SUPPLY_RUN_PERMANENT"),
    ("db: guard trigger not created", MIG, "create trigger trg_supply_runs_guard\n", "-- create trigger trg_supply_runs_guard\n"),
    ("db: RLS off", MIG, "alter table public.supply_runs enable row level security;", "-- rls"),
    # screens and wiring
    ("page: owner sign line gone", PAGE, "Checked by (owner)", "Checked"),
    ("registers: button gone", REG, "href={`${BASE}/supply-runs`}", "href={`${BASE}/supply-run`}"),
    ("safe page: open-runs notice dropped", SAFE, "  const supplyNotice = openRunsRes.ok ? openRunsNotice(openRunsRes.runs) : null;", "  const supplyNotice = null as string | null;"),
    ("reset: supply runs wiped", RESET, '  { table: "supply_runs", disposition: "KEEP",', '  { table: "supply_runs", disposition: "WIPE",'),
    ("census: poster unwired", CENSUS, '    poster: "src/lib/accounting/supply-run-posting-service.ts#postAdvanceForRun",', "    poster: null,"),
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
