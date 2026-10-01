#!/usr/bin/env python3
"""
Round 17 (SLICE S07) mutation testing - "testing of the tests".

Owner (verbatim): "For the onboarding and other receiving intake pipeline work,
I want testing done and testing of the tests. The intake pipeline needs to be
perfect."

Each mutant deliberately BREAKS one survivorship / honesty rule of the single
write door (attach-plan-core.ts, attach-facts.ts) or its wiring, and the S07
suite must FAIL. Same pre-flight discipline as scripts/slice180/mutate.py:
every anchor must appear exactly once, the baseline must be green, and every
file is restored afterwards.
"""
import subprocess
import sys

CORE = "src/lib/catalog/attach-plan-core.ts"
DOOR = "src/lib/catalog/attach-facts.ts"
ONB = "src/app/admin/inventory/drafts/ai-lookup-actions.ts"
ENR = "src/app/admin/products/ai-lookup-actions.ts"

MUTANTS = [
    # ---------------------------------------------------------- planner --
    ("strain keyed by the PRODUCT name (F-012 regression)", CORE,
     'const strainName = input.strainWriteDisabled || blocked ? "" : (input.strainName ?? "").replace(/\\s+/g, " ").trim();',
     'const strainName = input.strainWriteDisabled || blocked ? "" : (input.productLabel ?? "").replace(/\\s+/g, " ").trim();'),
    ("a new strain is created published", CORE,
     '          status: "draft",\n          source: "enrichment",',
     '          status: "published",\n          source: "enrichment",'),
    ("shadow mode attaches live", CORE,
     'if (act && v.decision === "attach") attachedSet.add(f);',
     'if (v.decision === "attach") attachedSet.add(f);'),
    ("a populated strain summary is overwritten", CORE,
     '          if (isBlank(ex[f])) {',
     '          if (true) {'),
    ("existing strain lists replaced instead of unioned", CORE,
     '        const next = unionList(cur, val(f) as string[]);',
     '        const next = cleanList(val(f));'),
    ("a populated product description is overwritten", CORE,
     '      if ((f === "description" || f === "short_description") && ep && !isBlank(ep[f])) {',
     '      if (false) {'),
    ("review-band fields reach an existing strain", CORE,
     '      if (!ex || exIsStaging) return true;\n      return attachedSet.has(f);',
     '      return true;'),
    ("strain type written without the attach bar", CORE,
     '      if (f === "strain_type") return attachedSet.has(f);',
     '      if (f === "strain_type") return true;'),
    ("kb_products written when the key is unknown", CORE,
     '  if (act && input.kbProductKeyKnown) {',
     '  if (act) {'),
    ("dedupe against pending suggestions removed", CORE,
     '    if (pendingKeys.has(k) || plannedKeys.has(k)) {',
     '    if (plannedKeys.has(k)) {'),
    ("re-save of identical prose queues a duplicate", CORE,
     '        if (normalizeForDedupe(ep[f]) === normalizeForDedupe(v as string)) productKept.add(f);',
     ''),
    ("unchecked strain box gives the misleading 'no strain' reason", CORE,
     'const noStrainReason = blocked || (input.strainWriteDisabled ? SKIP.strain_unchecked : SKIP.no_strain);',
     'const noStrainReason = blocked || SKIP.no_strain;'),
    ("category/size/ratio get a confidence (could auto-attach)", CORE,
     '    { field: "category", value: safe.category, confidence: null },',
     '    { field: "category", value: safe.category, confidence: 99 },'),
    ("junk confidence accepted from the client", CORE,
     '    { field: "summary", value: safe.summary, confidence: policyConfidence(fc.summary) },',
     '    { field: "summary", value: safe.summary, confidence: Number(fc.summary) || null },'),
    ("read-back: compliance strip reported as 'kept'", CORE,
     '    (got === "" ? blocked : missing).push(f);',
     '    missing.push(f);'),
    ("read-back: a missing row counts as success", CORE,
     '  if (!readBack) {\n    return [{',
     '  if (!readBack) {\n    return []; [{'),
    ("reconcile: failures ignored", CORE,
     '  if (failures.length === 0) return receipt;',
     '  return receipt;'),
    # ------------------------------------------------------------- door --
    ("door passes a strain name to the full-row writer", DOOR,
     '          strainName: null,\n          variantLabel: sf.kb.variantLabel,',
     '          strainName: sf.strainName,\n          variantLabel: sf.kb.variantLabel,'),
    ("door overwrites kb_products confidence", DOOR,
     '          confidence: null,\n          source: "enrichment",',
     '          confidence: 0.9,\n          source: "enrichment",'),
    ("door skips the read-your-write check", DOOR,
     '          failures.push(...verifyKbProductWrite(plan.kbProduct, back as Record<string, unknown> | null));',
     '          void verifyKbProductWrite;'),
    ("door treats a failed writer as success", DOOR,
     '      if (!wb.wroteProduct) {',
     '      if (false) {'),
    ("door ignores an unreadable strain library", DOOR,
     '    if (!r.ok) strainBlockedReason = "The strain library could not be read just now, so the strain was not touched. Try again.";',
     '    if (!r.ok) strainBlockedReason = null;'),
    ("door creates a strain without 0085 columns", DOOR,
     '    else if (!r.cols.provenance && !r.row) {',
     '    else if (false) {'),
    ("door lists suggestions after a failed pending read", DOOR,
     '    if (pendingReadFailed) {',
     '    if (false) {'),
    ("door hides the 23505 race", DOOR,
     '        if (error) {\n          failures.push({\n            target: "strain library",',
     '        if (false) {\n          failures.push({\n            target: "strain library",'),
    ("door writes provenance for fields that did not land", DOOR,
     '    if (!landed.has(`${p.field}\\u001f${p.to}`)) continue;',
     ''),
    ("door ignores the 'save strain' checkbox", DOOR,
     'const strainWriteDisabled = input.context.kind === "product" && !input.context.saveStrain;',
     'const strainWriteDisabled = false;'),
    ("door skips the audit row", DOOR,
     '  await recordAudit({\n    actorId: input.actor.userId,',
     '  void ({\n    actorId: input.actor.userId,'),
    ("door uses the raw reconcile-less plan receipt", DOOR,
     '  const receipt = reconcileReceipt(plan.receipt, failures);',
     '  const receipt = plan.receipt;'),
    # ----------------------------------------------------------- wiring --
    ("onboarding save bypasses the door", ONB,
     '  if (attachFactsV2Enabled()) {\n    if (!draftId)',
     '  if (false) {\n    if (!draftId)'),
    ("enrichment save bypasses the door", ENR,
     '  if (attachFactsV2Enabled()) {\n    try {',
     '  if (false) {\n    try {'),
]

SUITES = [
    "tests/compliance/s07-attach-product-facts.test.ts",
    "tests/compliance/s10-fact-attach-policy.test.ts",
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
