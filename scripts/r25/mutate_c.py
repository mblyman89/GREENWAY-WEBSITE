#!/usr/bin/env python3
"""
Round 25 C mutation testing: the menu item linked to its knowledge-base
product (menu_items.kb_product_id stamped at build time + owner backfill).

Owner (verbatim): "Please work on the product menu item linked to its
knowledge base. ... Test it, test the tests."

Same discipline as scripts/r25/mutate_b.py.
"""
import signal
import subprocess
import sys

CORE = "src/lib/catalog/menu-kb-link-core.ts"
SRV = "src/lib/catalog/menu-kb-link-server.ts"
STG = "src/lib/pos/intake-menu-staging.ts"
DRF = "src/lib/pos/draft-injection.ts"
IMP = "src/lib/pos/import-service.ts"
ACT = "src/app/admin/products/actions.ts"
PAGE = "src/app/admin/products/page.tsx"
KEYP = "src/app/admin/products/[key]/page.tsx"
CC = "src/lib/enrichment/command-center.ts"
RUN = "scripts/compliance/run-pure-selftests.ts"

MUTANTS = [
    ("core: uuid regex loosened", CORE, "const UUID_RE = /^[0-9a-f]{8}-", "const UUID_RE = /[0-9a-f]{8}-"),
    ("core: id not lower-cased", CORE, "  const t = v.trim().toLowerCase();\n  return UUID_RE", "  const t = v.trim();\n  return UUID_RE"),
    ("core: refused lots counted", CORE, "    if (!isPromotableLot(l.status, l.disposition)) continue;", "    if (false) continue;"),
    ("core: conflict picks first", CORE, "    if (ids.size > 1) return { kbProductId: null, reason: \"conflict\"", "    if (ids.size > 99) return { kbProductId: null, reason: \"conflict\""),
    ("core: last key wins", CORE, "    at = i;\n    break;", "    at = i;"),
    ("core: prior ignored", CORE, "  if (keep) return { kbProductId: keep, via: \"prior\" };", "  if (keep && false) return { kbProductId: keep, via: \"prior\" };"),
    ("core: conflict resolved stamped", CORE, "  const fresh = resolved && resolved.reason === \"linked\" ?", "  const fresh = resolved ?"),
    ("core: variant keys dropped", CORE, "    variants: (c.variantIds ?? []).map((id) => ({ source_variant_id: String(id ?? \"\") })),", "    variants: [],"),
    ("core: needing-lots includes priors", CORE, "  return cards.filter((c) => !cleanKbProductId(c.prior));", "  return cards.filter(() => true);"),
    ("core: summary conflict as noLink", CORE, "    else if (resolved?.reason === \"conflict\") summary.conflicts += 1;", "    else if (false) summary.conflicts += 1;"),
    ("core: null key always added", CORE, "  return id ? { ...row, kb_product_id: id } : row;", "  return { ...row, kb_product_id: id ?? null };"),
    ("core: backfill overwrites linked", CORE, "    if (cleanKbProductId(c.kb_product_id)) {\n      plan.alreadyLinked += 1;\n      continue;", "    if (false) {\n      plan.alreadyLinked += 1;\n      continue;"),
    ("core: backfill conflict counted noLink", CORE, "      if (r.reason === \"conflict\") plan.conflicts += 1;", "      if (false) plan.conflicts += 1;"),
    ("core: message hides failed", CORE, "  if (r.failed > 0) parts.push(", "  if (r.failed > 1e9) parts.push("),
    ("srv: lot read error swallowed", SRV, "        if (error) {\n          failed = true;\n          return [];\n        }\n        return (data as unknown as MenuKbLinkLot[]", "        if (error) {\n          return [];\n        }\n        return (data as unknown as MenuKbLinkLot[]"),
    ("srv: lot read wrong column", SRV, "          .in(\"pos_product_key\", chunk)", "          .in(\"lot_code\", chunk)"),
    ("srv: lotReadFailed always false", SRV, "lotReadFailed: lots === null };", "lotReadFailed: false };"),
    ("srv: no retry on missing column", SRV, "  if (first.error && anyLink && isMissingIdentityColumnError(\"menu_items\", first.error)) {", "  if (false) {"),
    ("srv: retry on any error", SRV, "  if (first.error && anyLink && isMissingIdentityColumnError(\"menu_items\", first.error)) {", "  if (first.error) {"),
    ("srv: retry keeps the link", SRV, "    const stripped: Record<string, unknown>[] = linked.map((r) => withoutIdentityColumns(\"menu_items\", r));", "    const stripped: Record<string, unknown>[] = linked;"),
    ("srv: retry flag false", SRV, "      retriedWithoutLink: true,", "      retriedWithoutLink: false,"),
    ("srv: log loses lot-fail note", SRV, "      (plan.lotReadFailed ? \" (lot read failed", "      (false ? \" (lot read failed"),
    ("srv: no-version allowed", SRV, "    if (!version) return { ok: false, error: \"No published menu yet", "    if (!version && false) return { ok: false, error: \"No published menu yet"),
    ("srv: backfill every version", SRV, "          .eq(\"menu_version_id\", version.id)\n", "\n"),
    ("srv: missing column not named", SRV, "    if (missingColumn) {\n      return", "    if (missingColumn && false) {\n      return"),
    ("srv: partial menu read accepted", SRV, "    if (!menu.verdict.complete) {", "    if (false) {"),
    ("srv: variant failure ignored", SRV, "    if (variantFailed) return { ok: false", "    if (false) return { ok: false"),
    ("srv: lot failure ignored", SRV, "    if (lots === null) return { ok: false, error: \"Could not read the inventory lots.", "    if (false) return { ok: false, error: \"Could not read the inventory lots."),
    ("srv: update not fill-only", SRV, "          .is(\"kb_product_id\", null)\n          .select(\"id\");", "          .select(\"id\");"),
    ("srv: failed chunk counted stamped", SRV, "        if (error) failed += chunk.length;", "        if (error) stamped += chunk.length;"),
    ("srv: stamped counts asked not returned", SRV, "        else stamped += Array.isArray(data) ? data.length : 0;", "        else stamped += chunk.length;"),
    ("stg: prior links not carried", STG, "      priorKbLinks = carry.priorKbLinks;", "      void carry.priorKbLinks;"),
    ("stg: prior not passed to plan", STG, "      prior: priorKbLinks.get(it.source_item_id) ?? null,", "      prior: null,"),
    ("stg: insert without link", STG, "    const { data: inserted, error } = await insertMenuItemsWithKbLink(admin, rows, kbPlan.links);\n    if (error || !inserted) {\n      throw new Error(`Failed to insert staged", "    const { data: inserted, error } = await admin.from(\"menu_items\").insert(rows).select(\"id, source_item_id\");\n    if (error || !inserted) {\n      throw new Error(`Failed to insert staged"),
    ("drf: insert without link", DRF, "await insertMenuItemsWithKbLink(admin, rows, kbPlan.links);", "await insertMenuItemsWithKbLink(admin, rows, new Map());"),
    ("imp: insert without link", IMP, "await insertMenuItemsWithKbLink(admin, rows, kbPlan.links);", "await admin.from(\"menu_items\").insert(rows).select(\"id, source_item_id\");"),
    ("act: no permission gate", ACT, "export async function linkMenuCardsToKbAction(): Promise<void> {\n  const session = await requirePermission(\"products.enrich\");", "export async function linkMenuCardsToKbAction(): Promise<void> {\n  const session = { userId: \"x\", email: \"x\" };"),
    ("act: audit action changed", ACT, "    action: MENU_KB_LINK_BACKFILL_AUDIT_ACTION,", "    action: \"menu_items.other\","),
    ("page: button removed", PAGE, "          action={linkMenuCardsToKbAction}", "          action={linkEnrichmentsToProducts}"),
    ("keyp: badge removed", KEYP, "data-testid=\"menu-card-kb-badge\"", "data-testid=\"menu-card-kb\""),
    ("cc: card link never exposed", CC, "    menuCardKb: menuCardKbRow\n", "    menuCardKb: null && menuCardKbRow\n"),
    ("runner: floor lowered", RUN, "assertRan(\"menu-kb-link-core\", __runMenuKbLinkCoreTests(), 39);", "assertRan(\"menu-kb-link-core\", __runMenuKbLinkCoreTests(), 38);"),
]

SUITES = [
    "tests/compliance/r25-menu-kb-link.test.ts",
    "tests/compliance/s17-batch-staging.test.ts",
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
