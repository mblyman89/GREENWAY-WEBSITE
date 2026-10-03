#!/usr/bin/env python3
"""
Round 25 B mutation testing: every Knowledge Base form writes DASHED slugs
(brand, product type, FAQ); legacy exact rows keep updating themselves.

Owner (verbatim): "I also would like you to build the brand form use dashes
and other types of things like using dashes. ... Test it, test the tests."

Same discipline as scripts/r24/mutate_s20.py.
"""
import signal
import subprocess
import sys

CORE = "src/lib/catalog/kb-slug-input-core.ts"
ST = "src/lib/ai/kb/store.ts"
ACT = "src/app/admin/knowledge-base/actions.ts"
RUN = "scripts/compliance/run-pure-selftests.ts"

MUTANTS = [
    ("core: legacy exact ignored", CORE, "  if (typed && input.existingExact) {", "  if (typed && input.existingExact && false) {"),
    ("core: legacy match on blank typed", CORE, "  if (typed && input.existingExact) {", "  if (input.existingExact) {"),
    ("core: typed kept raw", CORE, "    const slug = dashedSlug(typed);\n", "    const slug = typed.toLowerCase();\n"),
    ("core: typed spaced", CORE, "    const slug = dashedSlug(typed);\n", "    const slug = typed.toLowerCase().replace(/\\s+/g, \" \");\n"),
    ("core: punctuation typed falls to name", CORE, "    if (!slug) {\n      return { ok: false, reason: `The slug", "    if (!slug && false) {\n      return { ok: false, reason: `The slug"),
    ("core: changed flag wrong", CORE, "via: \"typed_dashed\", changed: slug !== typed }", "via: \"typed_dashed\", changed: false }"),
    ("core: name not dashed", CORE, "  const slug = dashedSlug(input.fallbackName);", "  const slug = String(input.fallbackName ?? \"\").trim().toLowerCase();"),
    ("core: blank name allowed", CORE, "  if (!slug) {\n    return { ok: false, reason: \"Please enter", "  if (false) {\n    return { ok: false, reason: \"Please enter"),
    ("core: drift detector inverted", CORE, "  return s !== dashedSlug(s);", "  return s === dashedSlug(s);"),
    ("core: typed not trimmed", CORE, "  return String(typed ?? \"\").trim();", "  return String(typed ?? \"\");"),
    ("store: read error treated as no row", ST, "    if (error) {\n      return { ok: false, reason: `Couldn't check the existing slug", "    if (error && false) {\n      return { ok: false, reason: `Couldn't check the existing slug"),
    ("store: existence read not exact", ST, ".select(\"slug\").eq(\"slug\", t).limit(1);", ".select(\"slug\").eq(\"slug\", dashedSlug(t)).limit(1);"),
    ("store: never reads", ST, "  if (t) {\n    const { data, error } = await admin.from(table)", "  if (false) {\n    const { data, error } = await admin.from(table)"),
    ("store: brand slug old rule", ST, "      slug: slugPlan.slug,\n      name: input.name.trim(),\n      known_for", "      slug: input.slug.trim().toLowerCase() || slugPlan.slug,\n      name: input.name.trim(),\n      known_for"),
    ("store: brand refusal ignored", ST, "  if (!slugPlan.ok) throw new Error(slugPlan.reason);", "  if (!slugPlan.ok) return { slug: \"\", via: \"x\", changed: false };"),
    ("store: brand wrong table", ST, "resolveDashedKbSlug(admin, \"kb_brands\", input.slug, input.name)", "resolveDashedKbSlug(admin, \"kb_faqs\", input.slug, input.name)"),
    ("store: category old rule", ST, "  const slug = slugPlan.slug;\n  const row = {", "  const slug = input.slug?.trim() || slugPlan.slug;\n  const row = {"),
    ("store: category refusal ignored", ST, "  if (!slugPlan.ok) return { ok: false, message: slugPlan.reason };\n  const slug = slugPlan.slug;\n  const row", "  if (!slugPlan.ok) return { ok: true };\n  const slug = slugPlan.slug;\n  const row"),
    ("store: faq old rule", ST, "    const slug = slugPlan.slug;\n    const { error } = await admin.from(\"kb_faqs\")", "    const slug = input.slug.trim().toLowerCase();\n    const { error } = await admin.from(\"kb_faqs\")"),
    ("action: spaced slug back", ACT, "  const typedSlug = String(formData.get(\"slug\") ?? \"\").trim();", "  const typedSlug = (String(formData.get(\"slug\") ?? \"\").trim() || name).toLowerCase().replace(/\\s+/g, \" \");"),
    ("action: refusal swallowed", ACT, "    back(e instanceof Error ? e.message : \"Couldn't save the brand.\", false);", "    saved = { slug: \"\", via: \"\", changed: false }; void e;"),
    ("action: audit loses typed slug", ACT, "after: { slug: saved.slug, typed_slug: typedSlug || null, slug_via: saved.via },", "after: { slug: saved.slug },"),
    ("action: no saved-as message", ACT, "  back(saved.changed ? `Saved brand facts for \"${name}\" (slug saved as \"${saved.slug}\").` : `Saved brand facts for \"${name}\".`);", "  back(`Saved brand facts for \"${name}\".`);"),
    ("runner: floor lowered", RUN, 'assertRan("kb-slug-input-core", __runKbSlugInputCoreTests(), 38);', 'assertRan("kb-slug-input-core", __runKbSlugInputCoreTests(), 37);'),
]

SUITES = [
    "tests/compliance/r25-kb-slug-dashes.test.ts",
    "tests/compliance/r24-s20-slug-core-brand.test.ts",
    "tests/compliance/s03-product-identity-core.test.ts",
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
