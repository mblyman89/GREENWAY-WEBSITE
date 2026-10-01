#!/usr/bin/env python3
"""
Round 18 (SLICES S09 + S11) mutation testing - "testing of the tests".

Owner (verbatim): "Follow the standing rules and never guess, never assume.
Test it, test the tests."

Each mutant deliberately BREAKS one rule of S09 (KB-first recall:
fact-memory-core.ts, fact-memory.ts, ai-lookup-actions.ts) or S11 (the
onboarding row: fact-chips-core.ts, FactsPanel.tsx, page.tsx, actions.ts,
attach-facts-core.ts mergeDraftAttachedFacts), and the R18 suites must FAIL.
Same discipline as scripts/r17/mutate.py: every anchor must appear exactly
once, the baseline must be green, and every file is restored afterwards.
"""
import subprocess
import sys

MEM = "src/lib/catalog/fact-memory-core.ts"
MEMS = "src/lib/catalog/fact-memory.ts"
LOOK = "src/lib/inventory/product-lookup-ai.ts"
ONB = "src/app/admin/inventory/drafts/ai-lookup-actions.ts"
CHIPS = "src/lib/catalog/fact-chips-core.ts"
PANEL = "src/components/admin/catalog/FactsPanel.tsx"
PAGE = "src/app/admin/inventory/drafts/page.tsx"
ACT = "src/app/admin/inventory/drafts/actions.ts"
MERGE = "src/lib/catalog/attach-facts-core.ts"
DOOR = "src/lib/catalog/attach-facts.ts"

MUTANTS = [
    # ------------------------------------------------------ S09 recall core --
    ("KB_FIRST_ONBOARDING=off ignored", MEM,
     'export function kbFirstOnboardingEnabled(raw: string | null | undefined): boolean {\n  const v = String(raw ?? "").trim().toLowerCase();\n  return !(v === "off"',
     'export function kbFirstOnboardingEnabled(raw: string | null | undefined): boolean {\n  const v = String(raw ?? "").trim().toLowerCase();\n  return true || !(v === "off"'),
    ("Gemini skipped on a PARTIAL memory", MEM,
     'input.memory !== null && input.memory.complete === true;',
     'input.memory !== null;'),
    ("Refresh from web does not bypass memory", MEM,
     'return input.enabled === true && input.refresh !== true && input.memory',
     'return input.enabled === true && input.memory'),
    ("an unapproved KB draft counts as covered", MEM,
     '  if (kb?.covered) return kb;\n  if (hist?.covered) return hist;',
     '  if (kb) return kb;\n  if (hist?.covered) return hist;'),
    ("blank identity still recalls", MEM,
     '  if (identityKey === "") return null;\n  const history',
     '  const history'),
    ("complete computed wrongly (always true)", MEM,
     'complete: missing.length === 0, lastSeen };',
     'complete: true, lastSeen };'),
    # ---------------------------------------------------- S09 wiring --
    ("lookup ignores the KB_FIRST flag", ONB,
     'const memory = kbFirst && draftId ? await recallForDraft(draftId) : null;',
     'const memory = draftId ? await recallForDraft(draftId) : null;'),
    ("refresh still feeds the already-known block", ONB,
     'alreadyKnown: refresh ? "" : alreadyKnownPromptBlock(memory),',
     'alreadyKnown: alreadyKnownPromptBlock(memory),'),
    ("already-known block dropped from the v2 prompt", LOOK,
     '${input.alreadyKnown ? input.alreadyKnown : ""}',
     ''),
    ("history read error not tolerated (0235 missing)", MEMS,
     '      if (error) {\n        firstError = error;\n        return [];\n      }',
     '      if (error) {\n        throw new Error(error.message);\n      }'),
    # -------------------------------------------------- S11 chips core --
    ("ONBOARDING_V2_ROW=off ignored", CHIPS,
     'export function onboardingV2RowEnabled(raw: string | null | undefined): boolean {\n  const v = String(raw ?? "").trim().toLowerCase();\n  return !(',
     'export function onboardingV2RowEnabled(raw: string | null | undefined): boolean {\n  const v = String(raw ?? "").trim().toLowerCase();\n  return true || !('),
    ("a Gemini guess under 90% is counted", CHIPS,
     'if (source === "gemini") return confidencePct !== null && confidencePct >= ATTACH_AUTO_MIN_CONFIDENCE;',
     'if (source === "gemini") return confidencePct !== null && confidencePct >= 70;'),
    ("an unscored Gemini finding is counted", CHIPS,
     'if (source === "gemini") return confidencePct !== null && confidencePct >= ATTACH_AUTO_MIN_CONFIDENCE;',
     'if (source === "gemini") return confidencePct === null || confidencePct >= ATTACH_AUTO_MIN_CONFIDENCE;'),
    ("survivorship: uncounted beats counted", CHIPS,
     '  if (a.chip.counted !== b.chip.counted) return a.chip.counted;',
     ''),
    ("survivorship: source rank reversed", CHIPS,
     '  if (ra !== rb) return ra < rb;',
     '  if (ra !== rb) return ra > rb;'),
    ("missing list counts uncounted chips as filled", CHIPS,
     'const countedFields = new Set(chips.filter((c) => c.counted).map((c) => c.field));',
     'const countedFields = new Set(chips.map((c) => c.field));'),
    ("shadow note hidden in shadow mode", CHIPS,
     '  if (mode === "act") return null;\n  if (mode === "off") {',
     '  if (mode !== "off") return null;\n  if (mode === "off") {'),
    ("no-vendor identity reported as ok", CHIPS,
     'if (!clean(row.vendor_name) && !clean(row.brand_name)) return { ok: false, text: NO_VENDOR_IDENTITY_COPY };',
     'if (!clean(row.vendor_name) && !clean(row.brand_name)) return { ok: true, text: NO_VENDOR_IDENTITY_COPY };'),
    ("attached_facts entries without a timestamp accepted", CHIPS,
     '    if (typeof e.at !== "string" || e.at.trim() === "") continue;',
     ''),
    ("manifest cell invents a number", CHIPS,
     'return { number: number ? `#${number}` : "No manifest number", date };',
     'return { number: `#${number}`, date };'),
    # ------------------------------------------------------- S11 panel --
    ("panel hides 'not counted'", PANEL,
     '{!c.counted ? <span className="text-[10px] text-[var(--admin-text-faint)]"> \u00b7 not counted</span> : null}',
     '{null}'),
    ("panel drops the missing line", PANEL,
     '      {view.missingLine ? (',
     '      {false ? ('),
    ("panel drops 'Also known from'", PANEL,
     '{c.also.length > 0 ? ` Also known from: ${c.also.join(", ")}.` : ""}',
     '{""}'),
    # ------------------------------------------------- S11 page wiring --
    ("lookup panel stays inside the approve form with v2 on", PAGE,
     '{!v2Row && lookupPanel}',
     '{lookupPanel}'),
    ("in-row error shown on every row", PAGE,
     'const rowError = v2Row && pinned?.id === d.id ? errorText : null;',
     'const rowError = v2Row ? errorText : null;'),
    ("facts column ignores the flag", PAGE,
     '{v2Row && <th className="px-4 py-3">Facts</th>}',
     '<th className="px-4 py-3">Facts</th>'),
    # ----------------------------------------------- S11 redirect anchor --
    ("failure redirect not pinned to the row", ACT,
     'const anchor = failedDraftId && onboardingV2RowOn() ? failedDraftId : null;',
     'const anchor = null;'),
    ("anchor ignores ONBOARDING_V2_ROW=off", ACT,
     'const anchor = failedDraftId && onboardingV2RowOn() ? failedDraftId : null;',
     'const anchor = failedDraftId ? failedDraftId : null;'),
    ("dismiss failure loses the anchor", ACT,
     '  if (!result.ok) {\n    redirect(backTo(formData, { error: "update" }, draftId));\n  }\n  redirect(backTo(formData, { dismissed: "1" }));',
     '  if (!result.ok) {\n    redirect(backTo(formData, { error: "update" }));\n  }\n  redirect(backTo(formData, { dismissed: "1" }));'),
    ("approve SUCCESS pinned too", ACT,
     '  redirect(backTo(formData, { approved: "1" }));',
     '  redirect(backTo(formData, { approved: "1" }, draftId));'),
    # ---------------------------------------- S11 Save -> row refresh --
    ("row revalidated even when nothing attached", ONB,
     'if (res.receipt.attached.length > 0 && onboardingV2RowOn()) {',
     'if (onboardingV2RowOn()) {'),
    ("row revalidate ignores the flag", ONB,
     'if (res.receipt.attached.length > 0 && onboardingV2RowOn()) {',
     'if (res.receipt.attached.length > 0) {'),
    # ------------------------------------------ S11 draft merge (door) --
    ("a machine source overwrites a person's answer", MERGE,
     '    if (cur.source === "human" && l.source !== "human") {',
     '    if (false) {'),
    ("merge accepts a junk confidence", MERGE,
     'if (!isFactFieldKey(l.field) || !isFactSource(l.source) || !isStoredConfidence(l.confidence ?? null)) continue;',
     'if (!isFactFieldKey(l.field) || !isFactSource(l.source)) continue;'),
    ("door never writes the row's fact list", DOOR,
     '        if (merged.patch) {\n          const { error } = await admin.from("catalog_product_drafts").update(merged.patch)',
     '        if (false) {\n          const { error } = await admin.from("catalog_product_drafts").update(merged.patch)'),
]

SUITES = [
    "tests/compliance/s09-kb-first-onboarding.test.ts",
    "tests/compliance/s09-fact-memory-server.test.ts",
    "tests/compliance/s11-onboarding-row.test.ts",
    "tests/compliance/attached-facts-schema.test.ts",
    "tests/compliance/s07-attach-product-facts.test.ts",
]



def read(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def write(p, s):
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(s)


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

if problems:
    print("ABORT - anchors are not unique. Nothing was run:")
    for p in problems:
        print(p)
    sys.exit(1)
print(f"  OK - all {len(MUTANTS)} anchors unique\n")

# ------------------------------------------------------------------- BASELINE
print("BASELINE: the suite must be green before we break anything")
r = subprocess.run(
    ["npx", "vitest", "run", *SUITES],
    capture_output=True, text=True,
)
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
        r = subprocess.run(
            ["npx", "vitest", "run", *SUITES],
            capture_output=True, text=True,
        )
        write(path, originals[path])  # restore immediately
        if r.returncode == 0:
            survivors.append(name)
            print(f"  [{i:2}/{len(MUTANTS)}] SURVIVED  <-- HOLE: {name}")
        else:
            print(f"  [{i:2}/{len(MUTANTS)}] killed    {name}")
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
