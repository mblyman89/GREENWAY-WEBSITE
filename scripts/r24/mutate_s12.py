#!/usr/bin/env python3
"""
Round 24 mutation testing for the S12 follow-up: the approve path goes
through the attach door (attachOnApproval) and makes the kb_products row.

Owner (verbatim): "Follow the standing rules and never guess, never assume.
Test it, test the tests."

Each mutant BREAKS one rule; the suites must FAIL:
  A - approve-attach-core: strain verdict (human vs machine, 90 bar, junk pick)
  B - approve-attach-core: strain write plan (create row shape, patch shape)
  C - approve-attach-core: counted facts only, no placeholder, list hygiene
  D - attach-facts attachOnApproval: strain read/write, kb row, read-back,
      fill-only links, pre-0234, audit, catch
  E - catalog-drafts wiring (flag, rollback, pick)
Same discipline as scripts/r24/mutate.py: every anchor appears exactly once,
the baseline must be green, and every file is restored afterwards.
"""
import signal
import subprocess
import sys

CORE = "src/lib/catalog/approve-attach-core.ts"
DOOR = "src/lib/catalog/attach-facts.ts"
CD = "src/lib/inventory/catalog-drafts.ts"

MUTANTS = [
    # ==================================================================== A ==
    ("junk pick falls through to the machine", CORE,
     '    if (c === "unknown") return null;\n    return { value: c, source: "human" };',
     '    if (c === "unknown") return { value: "hybrid", source: "auto" };\n    return { value: c, source: "human" };'),
    ("human pick is recorded as auto (could never flip)", CORE,
     '    return { value: c, source: "human" };',
     '    return { value: c, source: "auto" };'),
    ("below-bar machine hint becomes a verdict", CORE,
     "  if (!s || s.confidence < STRAIN_TYPE_AUTO_MIN_CONFIDENCE || s.source === \"strain library\") return null;",
     "  if (!s || s.source === \"strain library\") return null;"),
    ("strain library's own value is re-saved", CORE,
     "  if (!s || s.confidence < STRAIN_TYPE_AUTO_MIN_CONFIDENCE || s.source === \"strain library\") return null;",
     "  if (!s || s.confidence < STRAIN_TYPE_AUTO_MIN_CONFIDENCE) return null;"),
    ("human pick ignored", CORE,
     '  const pick = String(input.humanPick ?? "").trim();',
     '  const pick = "";'),
    # ==================================================================== B ==
    ("no strain name still plans a write", CORE,
     "  if (!name) return null;\n  const slug = strainSlug(name);",
     "  const slug = strainSlug(name);"),
    ("no verdict creates anyway", CORE,
     '  if (!input.verdict) return { action: "skip", slug, reason: "no strain type to save (no pick, and no machine verdict at 90% or more)" };',
     '  if (!input.verdict) return { action: "create", slug, verdict: { value: "hybrid", source: "auto" }, reason: "x", row: { slug, name } };'),
    ("created strain row is inactive", CORE,
     "        active: true,\n        created_by: input.actorId,",
     "        active: false,\n        created_by: input.actorId,"),
    ("created strain row loses created_by", CORE,
     "        active: true,\n        created_by: input.actorId,",
     "        active: true,\n        created_by: null,"),
    ("patch drops updated_by", CORE,
     "    patch: { strain_type: input.verdict.value, updated_by: input.actorId },",
     "    patch: { strain_type: input.verdict.value },"),
    ("decider told every verdict is human", CORE,
     "    source: input.verdict.source,\n  });",
     '    source: "human",\n  });'),
    # ==================================================================== C ==
    ("placeholder description saved as copy", CORE,
     "    if (!t || isBoilerplateDescription(t)) continue;",
     "    if (!t) continue;"),
    ("uncounted (below-bar) description saved", CORE,
     "    const c = countedAttachedFact(attachedFacts, f);\n    if (!c || typeof c.value !== \"string\") continue;",
     "    const raw = (attachedFacts as Record<string, { value: unknown }> | null)?.[f];\n    const c = raw ? { value: raw.value } : null;\n    if (!c || typeof c.value !== \"string\") continue;"),
    ("uncounted list facts saved", CORE,
     "    const c = countedAttachedFact(attachedFacts, field);\n    if (!c) continue;",
     "    const raw = (attachedFacts as Record<string, { value: unknown }> | null)?.[field];\n    const c = raw ? { value: raw.value } : null;\n    if (!c) continue;"),
    ("lists are not de-duplicated", CORE,
     "    if (!t || seen.has(t.toLowerCase())) continue;",
     "    if (!t) continue;"),
    ("aroma goes to flavor_notes", CORE,
     '    ["aroma", "aroma_notes"],',
     '    ["aroma", "flavor_notes"],'),
    # ==================================================================== D ==
    ("unreadable strain library is written blind", DOOR,
     "      if (sErr) {\n        // Cannot see the row",
     "      if (false) {\n        // Cannot see the row"),
    ("strain update hits every row (no id filter)", DOOR,
     '              : await admin.from("kb_strains").update(w.patch).eq("id", existing!.id);',
     '              : await admin.from("kb_strains").update(w.patch).neq("id", "");'),
    ("strain audit dropped", DOOR,
     "            result.strainWritten = true;\n            await recordAudit({",
     "            result.strainWritten = true;\n            if (false) await recordAudit({"),
    ("kb write sees no attached facts", DOOR,
     "      const facts = approvalKbFacts(attached);",
     "      const facts = approvalKbFacts(null);"),
    ("door decides the strain twice (writer gets the name)", DOOR,
     "          // The strain is decided ONCE, above.\n          strainName: null,",
     "          // The strain is decided ONCE, above.\n          strainName: sf.strainName,"),
    ("missing table reported as failed", DOOR,
     '        result.kb = wb.skippedReason && /not available/i.test(wb.skippedReason) ? "unavailable" : "failed";',
     '        result.kb = "failed";'),
    ("read-back skipped: receipt claims every fact", DOOR,
     "          result.facts = facts.fields.filter((f) => !notLanded.has(f));",
     "          result.facts = facts.fields;"),
    ("draft link overwrites an existing link", DOOR,
     '        .eq("id", input.draftId)\n        .is("kb_product_id", null)\n        .select("id");',
     '        .eq("id", input.draftId)\n        .select("id");'),
    ("lot link overwrites an existing link", DOOR,
     '          .eq("id", sf.lotId)\n          .is("kb_product_id", null)\n          .select("id");',
     '          .eq("id", sf.lotId)\n          .select("id");'),
    ("pre-0234 draft link reported as a failure", DOOR,
     '        if (isMissingIdentityColumnError("catalog_product_drafts", dErr)) result.linked.preMigration = true;',
     '        if (false) result.linked.preMigration = true;'),
    ("lot never linked", DOOR,
     "      if (sf.lotId && !result.linked.preMigration) {",
     "      if (false) {"),
    ("door audit not marked as the approval", DOOR,
     '      after: {\n        via: "approve",\n        identityKey: sf.identityKey || null,',
     '      after: {\n        via: "save",\n        identityKey: sf.identityKey || null,'),
    ("door audit dropped", DOOR,
     "    // ---- 4. Audit (the door's action, marked as the approval) ----------------\n    await recordAudit({",
     "    // ---- 4. Audit (the door's action, marked as the approval) ----------------\n    if (false) await recordAudit({"),
    ("thrown error escapes the door", DOOR,
     "  } catch (err) {\n    result.ok = false;\n    result.error = err instanceof Error ? err.message : String(err);\n    result.note = `The approval's",
     "  } catch (err) {\n    throw err;\n    result.error = err instanceof Error ? err.message : String(err);\n    result.note = `The approval's"),
    # ==================================================================== E ==
    ("door ignores the flag (rollback impossible)", CD,
     "    if (goldenRecordOn()) {",
     "    if (true) {"),
    ("human pick not passed to the door", CD,
     "        humanStrainPick: strainChoice.value,",
     "        humanStrainPick: null,"),
]

SUITES = [
    "tests/compliance/r24-s12-approve-door.test.ts",
]


def read(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def write(p, s):
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(s)


class Hung:
    """A mutant that makes the suite hang is caught: a hang is a failure, never a pass."""
    returncode = 124
    stdout = "TIMEOUT"


def run_suites(timeout=300):
    try:
        return subprocess.run(["npx", "vitest", "run", *SUITES], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        subprocess.run(["pkill", "-f", "vitest"], capture_output=True)
        return Hung()


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
names = [m[0] for m in MUTANTS]
for dup in sorted({n for n in names if names.count(n) > 1}):
    problems.append(f"  duplicate mutant name: {dup}")
if problems:
    print("ABORT - anchors are not unique. Nothing was run:")
    for p in problems:
        print(p)
    sys.exit(1)
print(f"  OK - all {len(MUTANTS)} anchors unique\n")
if "--preflight" in sys.argv:
    sys.exit(0)

print("BASELINE: the suites must be green before we break anything")
r = run_suites()
if r.returncode != 0:
    print("ABORT - baseline is already failing.")
    print(r.stdout[-3000:])
    sys.exit(1)
print("  OK - baseline green\n")


def _restore_and_exit(signum, frame):
    for path, src in originals.items():
        write(path, src)
    print("\nsignal: all files restored")
    sys.exit(130)


signal.signal(signal.SIGTERM, _restore_and_exit)
signal.signal(signal.SIGINT, _restore_and_exit)
only = [a for a in sys.argv[1:] if not a.startswith("--")]
survivors = []
ran = 0
try:
    for i, (name, path, old, new) in enumerate(MUTANTS, 1):
        if only and not any(o in name for o in only):
            continue
        ran += 1
        write(path, originals[path].replace(old, new))
        r = run_suites()
        write(path, originals[path])
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
print(f"ALL {ran} MUTANTS KILLED" + (f" (filtered: {ran} of {len(MUTANTS)} run)" if ran != len(MUTANTS) else ""))
