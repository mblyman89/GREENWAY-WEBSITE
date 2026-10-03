#!/usr/bin/env python3
"""
Round 24 mutation testing for the S20 follow-up (F-053): one pure slug-core
for every KB slug site, and the menu card brand label follows the product
identity (own link first, published survivor second, never itself).

Owner (verbatim): "Follow the standing rules and never guess, never assume.
Test it, test the tests."

Each mutant BREAKS one rule; the suites must FAIL:
  A - slug-core dashed rule (lowercase, collapse, edge strip, charset)
  B - slug-core spaced strain rule (trim, collapse, lowercase, null, not dashed)
  C - every former private copy drifting back to its own body
  D - resolveCardBrandIds / identityKeysNeedingBrand ladder
  E - card-identity.ts wiring and the runner floors
Same discipline as scripts/r24/mutate.py: every anchor appears exactly once,
the baseline must be green, and every file is restored afterwards.
"""
import signal
import subprocess
import sys

SC = "src/lib/catalog/slug-core.ts"
CC = "src/lib/menu/card-identity-core.ts"
CI = "src/lib/menu/card-identity.ts"
RUN = "scripts/compliance/run-pure-selftests.ts"
DRIFT_DASH = 'return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");'
DELEG = "return dashedSlug(value);"

DASH = """    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");"""
SPACED = 'return String(value ?? "").trim().toLowerCase().replace(/\\s+/g, " ");'

MUTANTS = [
    # ==================================================================== A ==
    ("dashed: case kept", SC, DASH, DASH.replace("    .toLowerCase()\n", "")),
    ("dashed: runs not collapsed", SC, DASH, DASH.replace("[^a-z0-9]+/g", "[^a-z0-9]/g")),
    ("dashed: edges not stripped", SC, DASH, DASH.replace('\n    .replace(/^-+|-+$/g, "");', ";")),
    ("dashed: only leading dashes stripped", SC, DASH, DASH.replace("/^-+|-+$/g", "/^-+/g")),
    ("dashed: underscores kept", SC, DASH, DASH.replace("[^a-z0-9]+", "[^a-z0-9_]+")),
    ("dashed: separator is underscore", SC, DASH, DASH.replace('/g, "-")', '/g, "_")')),
    # ==================================================================== B ==
    ("strain: not trimmed", SC, SPACED, SPACED.replace(".trim()", "")),
    ("strain: whitespace not collapsed", SC, SPACED, SPACED.replace("\\s+/g", "\\s/g")),
    ("strain: case kept", SC, SPACED, SPACED.replace(".toLowerCase()", "")),
    ("strain: 'fixed' to dashed", SC, SPACED, SPACED.replace('/g, " ")', '/g, "-")')),
    ("strain: null becomes 'null'", SC, SPACED, SPACED.replace("String(value ?? \"\")", "String(value)")),
]

DASH_FILES = [
    "src/lib/ai/kb/writeback.ts", "src/lib/ai/kb/intake.ts", "src/lib/ai/kb/retrieval.ts",
    "src/lib/kb/enrich-from-discovery.ts", "src/lib/ai/kb/store.ts",
    "src/lib/ai/kb/product-knowledge-batch-core.ts", "src/lib/ai/kb/ccrs-category-match-core.ts",
    "src/lib/purchasing/growflow-kb-link-core.ts", "src/lib/purchasing/cultivera-kb-link-core.ts",
]
# ======================================================================== C ==
for f in DASH_FILES:
    MUTANTS.append((f"drift: {f.split('/')[-1]} dashed copy", f, DELEG, DRIFT_DASH))
MUTANTS += [
    ("drift: writeback strain copy", "src/lib/ai/kb/writeback.ts", "return sharedStrainSlug(value);",
     'return String(value ?? "").trim().toLowerCase().replace(/\\s+/g, "-");'),
    ("drift: store strain slug", "src/lib/ai/kb/store.ts", "const slug = strainSlug(input.slug?.trim() || name);",
     "const slug = dashedSlug(input.slug?.trim() || name);"),
    ("drift: batch-core strain slug", "src/lib/ai/kb/product-knowledge-batch-core.ts", "const slug = sharedStrainSlug(strainName);",
     "const slug = dashedSlug(strainName);"),
    ("drift: product-lookup strain slug", "src/lib/ai/kb/product-lookup.ts", "const slug = strainSlug(query.strainName);",
     "const slug = query.strainName.toLowerCase();"),
    ("drift: catalog-drafts saveStrainTypeToKb slug", "src/lib/inventory/catalog-drafts.ts", "const slug = strainSlug(name);",
     "const slug = name.toLowerCase();"),
]
for f in ["src/lib/inventory/catalog-drafts.ts", "src/lib/pos/draft-injection.ts", "src/lib/pos/intake-menu-staging.ts"]:
    MUTANTS.append((f"drift: {f.split('/')[-1]} strain read map", f, ".map((d) => strainSlug(d.strain_name))",
                    '.map((d) => (d.strain_name ?? "").toLowerCase())'))
    MUTANTS.append((f"drift: {f.split('/')[-1]} strain read single", f, "const slug = strainSlug(d.strain_name);",
                    'const slug = (d.strain_name ?? "").toLowerCase();'))
MUTANTS += [
    ("product-identity-core re-export dropped", "src/lib/catalog/product-identity-core.ts",
     "export { dashedSlug, strainSlug };",
     "export const dashedSlug = (v: string | null | undefined): string => String(v ?? \"\").toLowerCase();\nexport { strainSlug };"),
    # ==================================================================== D ==
    ("ladder: own link ignored", CC, "    if (own) {\n      out.set(it.id, { brandId: own, via: \"own\" });",
     "    if (own && false) {\n      out.set(it.id, { brandId: own, via: \"own\" });"),
    ("ladder: own link not trimmed", CC, "    const own = (ownBrandIdByKey.get(it.id) ?? \"\").trim();",
     "    const own = ownBrandIdByKey.get(it.id) ?? \"\";"),
    ("ladder: card borrows from itself", CC, "    if (!row || row.pos_product_key === it.id) continue;", "    if (!row) continue;"),
    ("ladder: unknown identity is a wildcard", CC, "    if (!identity) continue;\n    const row", "    const row"),
    ("ladder: identity not trimmed", CC, "    const identity = (it.identityKey ?? \"\").trim();\n    if (!identity) continue;\n    const row",
     "    const identity = it.identityKey ?? \"\";\n    if (!identity) continue;\n    const row"),
    ("ladder: blank brand lends", CC, "    if (borrowed) out.set(it.id", "    if (row.brand_id !== null) out.set(it.id"),
    ("ladder: borrowed labelled own", CC, "{ brandId: borrowed, via: \"identity\" }", "{ brandId: borrowed, via: \"own\" }"),
    ("need: cards with own link still ask", CC, "    if ((ownBrandIdByKey.get(it.id) ?? \"\").trim()) continue;\n", ""),
    ("need: blank identity asked", CC, "    if (identity) keys.add(identity);", "    keys.add(identity);"),
    ("need: not de-duplicated", CC, "  return [...keys];\n}", "  return [...keys, ...keys];\n}"),
    # ==================================================================== E ==
    ("wiring: survivors ignored", CI, "resolveCardBrandIds(items, ownBrandIdByKey, survivors)",
     "resolveCardBrandIds(items, ownBrandIdByKey, new Map<string, BrandSurvivor>())"),
    ("wiring: every card asks", CI, "identityKeysNeedingBrand(items, ownBrandIdByKey)", "identityKeysNeedingBrand(items, new Map())"),
    ("wiring: wrong column", CI, "(needIdentity, \"brand_id\", admin)", "(needIdentity, \"description\", admin)"),
    ("wiring: identity read even with nothing to ask", CI, "    needIdentity.length > 0\n", "    true\n"),
    ("runner: slug-core floor", RUN, 'assertRan("slug-core", __runSlugCoreTests(), 30);', 'assertRan("slug-core", __runSlugCoreTests(), 29);'),
    ("runner: card-identity-core floor", RUN, 'assertRan("card-identity-core", __runCardIdentityCoreTests(), 34);',
     'assertRan("card-identity-core", __runCardIdentityCoreTests(), 1);'),
]

SUITES = [
    "tests/compliance/r24-s20-slug-core-brand.test.ts",
    "tests/compliance/s03-product-identity-core.test.ts",
    "tests/compliance/slice3-public-menu-gate.test.ts",
    "tests/compliance/slice-d-menu-performance.test.ts",
    "tests/compliance/card-identity-core.test.ts",
    "tests/compliance/s24-kb-ladder-identity.test.ts",
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
