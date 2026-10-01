#!/usr/bin/env python3
"""
Round 19 mutation testing: testing the tests.

Owner (verbatim): "Please follow the standing rules and never guess, never
assume. ... Test it, test the tests."

Each mutant deliberately BREAKS one rule from Round 19, and the R19 suites
must FAIL:
  fix A  - quiet Accounting (no auto-jump; an attention glow on the tab)
  S12    - golden record on approve (the survivorship gate)
  defect - the Product Onboarding approve path reads the compliance columns
  S13    - the batch manifest lookup (lease / claim / orphan compare-and-swap,
           the finish guard, the budget stop, cost accounting, chunk size,
           the time budget, the enqueue lock, the flag)
Same discipline as scripts/r18/mutate.py: every anchor must appear exactly
once, the baseline must be green, and every file is restored afterwards.
"""
import subprocess
import sys

TABS = "src/lib/admin/page-tabs-core.ts"
PT = "src/components/admin/ui/PageTabs.tsx"
MPAGE = "src/app/admin/inventory/intake/[id]/page.tsx"
LABELS = "src/lib/inventory/manifest-event-labels-core.ts"
CSS = "src/app/globals.css"
GOLD = "src/lib/catalog/golden-record-core.ts"
STAGE = "src/lib/pos/intake-menu-staging.ts"
INJ = "src/lib/pos/draft-injection.ts"
SRV = "src/lib/catalog/lookup-job-server.ts"
CORE = "src/lib/catalog/lookup-job-core.ts"
ROUTE = "src/app/api/cron/lookup-jobs/route.ts"
ACT = "src/app/admin/inventory/drafts/actions.ts"

MUTANTS = [
    # ---------------------------------------------------------------- fix A --
    ("a books refusal jumps to Accounting again", MPAGE,
     "resolveTab(MANIFEST_PAGE_TABS, { tab, held: manifestHeldAutoOpen(held) }, \"delivery\")",
     "resolveTab(MANIFEST_PAGE_TABS, { tab, held: manifestHeldAutoOpen(held), booksError }, \"delivery\")"),
    ("attention ignores a fresh refusal on the URL", LABELS,
     "  return typeof booksError === \"string\" && booksError.trim().length > 0;\n}",
     "  return false;\n}"),
    ("attention cue dropped from the tab markup", PT,
     "data-attention={attention ? \"true\" : undefined}",
     "data-attention={undefined}"),
    ("the glow runs forever (WCAG 2.2.2)", CSS,
     "animation: gw-tab-attention-glow 2s ease-in-out 2;",
     "animation: gw-tab-attention-glow 2s ease-in-out infinite;"),
    ("screen readers not told the tab needs attention", TABS,
     "return attention === true ? `${base}, needs attention` : base;",
     "return base;"),
    ("the Accounting link drops its own result params", TABS,
     "  const extra = tab.keepParams ?? [];\n  if (extra.length === 0) return allow;",
     "  const extra: readonly string[] = [];\n  if (extra.length === 0) return allow;"),
    # ------------------------------------------------------------------ S12 --
    ("GOLDEN_RECORD_ON_APPROVE=off ignored", GOLD,
     "export function goldenRecordEnabled(raw: string | null | undefined): boolean {\n  const v = String(raw ?? \"\").trim().toLowerCase();\n  return !(",
     "export function goldenRecordEnabled(raw: string | null | undefined): boolean {\n  const v = String(raw ?? \"\").trim().toLowerCase();\n  return true || !("),
    ("a Gemini fact under 90% reaches the menu", GOLD,
     "    if (Math.round(c * 10000) / 100 < ATTACH_AUTO_MIN_CONFIDENCE) return null;",
     "    if (Math.round(c * 10000) / 100 < 50) return null;"),
    ("the placeholder sentence counts as real copy", GOLD,
     "    if (!text || isBoilerplateDescription(text)) continue;",
     "    if (!text) continue;"),
    ("an AI strain type beats the approver's pick", GOLD,
     "  if (chosen) return { value: chosen, source: \"human\" };",
     "  if (chosen && !input.attached) return { value: chosen, source: \"human\" };"),
    ("staging ignores the golden record", STAGE,
     "        ...(goldenByDraftId.get(d.id) ?? {}),",
     ""),
    ("draft injection ignores the golden record", INJ,
     "        ...(goldenByDraftId.get(d.id) ?? {}),",
     ""),
    # --------------------------------------------------------------- defect --
    ("approve path drops the compliance columns again", STAGE,
     ".select(DRAFT_COLS + \", chosen_website_category, chosen_house_type, chosen_strain_type\" + COMPLIANCE_COLS)",
     ".select(DRAFT_COLS + \", chosen_website_category, chosen_house_type, chosen_strain_type\")"),
    # ------------------------------------------------------------------ S13 --
    ("flag off still reads the database", SRV,
     "  if (!lookupJobsOn()) return { ok: true, skipped: \"flag_off\", ...EMPTY };\n",
     ""),
    ("ATTACH_FACTS_V2=off ignored by the tick", SRV,
     "  if (!attachFactsV2Enabled()) return { ok: true, skipped: \"attach_v2_off\", ...EMPTY };\n",
     ""),
    ("a live lease is not respected", SRV,
     "    if (!leaseIsFree(job.lease_until, t0)) return { ...out, skipped: \"leased\" };\n",
     ""),
    ("lease taken without compare-and-swap", SRV,
     "    claim = job.lease_token === null ? claim.is(\"lease_token\", null) : claim.eq(\"lease_token\", job.lease_token);\n",
     ""),
    ("losing the lease CAS still runs", SRV,
     "    if (((won as { id: string }[] | null) ?? []).length !== 1) return { ...out, skipped: \"leased\" };",
     ""),
    ("item claimed without the attempts CAS", SRV,
     "        .eq(\"status\", \"queued\")\n        .eq(\"attempts\", attempts)\n        .select(\"id\");",
     "        .eq(\"status\", \"queued\")\n        .select(\"id\");"),
    ("a missed claim still runs the product", SRV,
     "        claimMisses += 1; // someone else has it, or the write failed\n        if (claimMisses >= 3) break;\n        continue;",
     "        claimMisses += 1; // someone else has it, or the write failed"),
    ("claim misses spin forever (no break)", SRV,
     "        if (claimMisses >= 3) break;\n",
     ""),
    ("orphan sweep without the attempts CAS", SRV,
     "        .eq(\"status\", \"running\")\n        .eq(\"attempts\", o.attempts ?? 0)\n        .select(\"id\");",
     "        .eq(\"status\", \"running\")\n        .select(\"id\");"),
    ("orphans never fail (endless requeue)", CORE,
     "  return n >= LOOKUP_MAX_ATTEMPTS ? \"fail\" : \"requeue\";",
     "  return \"requeue\";"),
    ("a lost lease keeps writing", SRV,
     "      if (((stillOurs as { id: string }[] | null) ?? []).length !== 1) return { ...out, error: \"lease lost\" };",
     ""),
    ("heartbeat not guarded by our token", SRV,
     "        .eq(\"id\", job.id)\n        .eq(\"lease_token\", token)\n        .select(\"id\");",
     "        .eq(\"id\", job.id)\n        .select(\"id\");"),
    ("release clears someone else's lease", SRV,
     "      .eq(\"id\", job.id)\n      .eq(\"lease_token\", token);",
     "      .eq(\"id\", job.id);"),
    ("Stop overwritten by done (finish not status-guarded)", SRV,
     "        .update({ status: \"done\", finished_at: at, updated_at: at })\n        .eq(\"id\", job.id)\n        .in(\"status\", [\"queued\", \"running\"])",
     "        .update({ status: \"done\", finished_at: at, updated_at: at })\n        .eq(\"id\", job.id)"),
    ("budget cap does not stop the job", SRV,
     "          if (stopsWholeJob(err)) stopAll = itemErrorText(err);",
     ""),
    ("a paid failure is not counted in the cost", SRV,
     "      (err as { aiCalls?: number }).aiCalls = isNoSpendError(err) ? 0 : 1;",
     "      (err as { aiCalls?: number }).aiCalls = 0;"),
    ("a budget refusal is billed as a paid lookup", CORE,
     "  return name === \"AiBudgetExceededError\" || name === \"AiNotConfiguredError\";\n}\n\n/** The budget cap stops",
     "  return name === \"AiNotConfiguredError\";\n}\n\n/** The budget cap stops"),
    ("a product that left review is looked up anyway", SRV,
     "  if (d.status !== \"draft\") throw new SkipItem(LEFT_REVIEW_COPY);",
     ""),
    ("a skipped product is reported as a failure", SRV,
     "        if (err instanceof SkipItem) {",
     "        if (err instanceof SkipItem && false) {"),
    ("LOOKUP_ITEMS_PER_TICK ignored", SRV,
     "    while (canStartItem({ elapsedMs: now() - t0, startedThisTick: out.started, maxPerTick })) {",
     "    while (canStartItem({ elapsedMs: now() - t0, startedThisTick: out.started })) {"),
    ("time budget ignored (a lookup can outrun maxDuration)", CORE,
     "  return elapsed + LOOKUP_ITEM_WORST_MS <= LOOKUP_TICK_BUDGET_MS;",
     "  return true;"),
    ("enqueue doubles an active job", SRV,
     "    if (active.id) return { ok: true, kind: \"exists\", jobId: active.id };",
     ""),
    ("the 23505 race returns an error instead of the winner", SRV,
     "        if (again.id) return { ok: true, kind: \"exists\", jobId: again.id };",
     ""),
    ("an empty job is left blocking the button", SRV,
     "      await admin.from(LOOKUP_JOBS_TABLE).update({ status: \"canceled\", finished_at: new Date().toISOString() }).eq(\"id\", jobId);",
     ""),
    ("earlier batches are looked up again", SRV,
     "      .in(\"job_id\", jobIds)\n      .eq(\"status\", \"done\")",
     "      .in(\"job_id\", jobIds)\n      .eq(\"status\", \"never\")"),
    ("cancel also cancels finished items", SRV,
     "      .eq(\"job_id\", jobId)\n      .eq(\"status\", \"queued\");\n    await recordAudit",
     "      .eq(\"job_id\", jobId);\n    await recordAudit"),
    ("route maxDuration drifts from the core", ROUTE,
     "export const maxDuration = 800;",
     "export const maxDuration = 300;"),
    ("lookupAllAction skips the permission check", ACT,
     "export async function lookupAllAction(manifestId: string, formData?: FormData) {\n  const session = await requirePermission(\"inventory.manage\");",
     "export async function lookupAllAction(manifestId: string, formData?: FormData) {\n  const session = { userId: null, email: null };"),
]

SUITES = [
    "tests/compliance/r19-quiet-accounting.test.tsx",
    "tests/compliance/s29-accounting-tab.test.tsx",
    "tests/compliance/page-tabs.test.tsx",
    "tests/compliance/s12-golden-record.test.ts",
    "tests/compliance/s13-lookup-jobs.test.ts",
    "tests/compliance/intake-env-ledger.test.ts",
]


def read(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def write(p, s):
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(s)


def run_suites():
    return subprocess.run(["npx", "vitest", "run", *SUITES], capture_output=True, text=True)


# ---------------------------------------------------------------- PRE-FLIGHT
print("PRE-FLIGHT: verifying every anchor matches exactly once")
originals = {}
problems = []
for name, path, old, new in MUTANTS:
    if path not in originals:
        originals[path] = read(path)
    n = originals[path].count(old)
    if n != 1:
        problems.append(f"  {name}: anchor appears {n}x in {path}")
    if old == new:
        problems.append(f"  {name}: mutant is identical to the original")

if problems:
    print("ABORT - anchors are not unique. Nothing was run:")
    for p in problems:
        print(p)
    sys.exit(1)
print(f"  OK - all {len(MUTANTS)} anchors unique\n")

# ------------------------------------------------------------------- BASELINE
print("BASELINE: the suites must be green before we break anything")
r = run_suites()
if r.returncode != 0:
    print("ABORT - baseline is already failing.")
    print(r.stdout[-3000:])
    sys.exit(1)
print("  OK - baseline green\n")

# ------------------------------------------------------------------- MUTATE
survivors = []
try:
    for i, (name, path, old, new) in enumerate(MUTANTS, 1):
        write(path, originals[path].replace(old, new))
        r = run_suites()
        write(path, originals[path])  # restore immediately
        if r.returncode == 0:
            survivors.append(name)
            print(f"  [{i:2}/{len(MUTANTS)}] SURVIVED  <-- HOLE: {name}", flush=True)
        else:
            print(f"  [{i:2}/{len(MUTANTS)}] killed    {name}", flush=True)
finally:
    for path, src in originals.items():
        write(path, src)
    print("\nall files restored")

print()
if survivors:
    print(f"{len(survivors)} MUTANT(S) SURVIVED - the tests do not cover:")
    for s in survivors:
        print("  - " + s)
    sys.exit(1)
print(f"ALL {len(MUTANTS)} MUTANTS KILLED")
