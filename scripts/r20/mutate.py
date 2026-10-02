#!/usr/bin/env python3
"""
Round 20 mutation testing: testing the tests.

Owner (verbatim): "Please continue, follow the standing rules and never guess,
never assume. Go above and beyond. Test it, test the tests."

Each mutant deliberately BREAKS one rule from Round 20, and the R20 suites
must FAIL:
  S20 - enrichment follows the PRODUCT, not the lot key (the flag, the
        survivorship order, the read ladder, the shared identity read, the
        stamping on create, the backfill, the image rung, the KB rung 3b,
        restock suggestions filed on the card key)
  S23 - per-field gap vector; the placeholder sentence counts as missing
        (describedBy, n/a rules, chips only on filled fields, the provenance
        read's keys/limit/fail-closed, computeGaps, the page wiring)
Same discipline as scripts/r19/mutate.py: every anchor must appear exactly
once, the baseline must be green, and every file is restored afterwards.
"""
import signal
import subprocess
import sys

IDC = "src/lib/enrichment/enrichment-identity-core.ts"
IDS = "src/lib/enrichment/enrichment-identity-server.ts"
STORE = "src/lib/enrichment/store.ts"
IMG = "src/lib/enrichment/image-resolver.ts"
ATT = "src/lib/catalog/attach-facts.ts"
KBC = "src/lib/ai/kb/product-knowledge-batch-core.ts"
LOOK = "src/lib/ai/kb/product-lookup.ts"
CC = "src/lib/enrichment/command-center.ts"
ACTS = "src/app/admin/products/actions.ts"
LIST = "src/app/admin/products/page.tsx"
DETAIL = "src/app/admin/products/[key]/page.tsx"
GRID = "src/components/admin/products/ProductGrid.tsx"
GVC = "src/lib/enrichment/gap-vector-core.ts"
GVS = "src/lib/enrichment/gap-vector-server.ts"
LEDGER = "docs/INTAKE_PIPELINE_ENV_LEDGER.md"

MUTANTS = [
    # ================================================================== S20 ==
    # --- the flag ---------------------------------------------------------------
    ("ENRICHMENT_FOLLOWS_IDENTITY=off ignored", IDC,
     '  return !(v === "off" || v === "0" || v === "false" || v === "no" || v === "disabled");',
     '  return !(v === "0" || v === "false" || v === "no" || v === "disabled");'),
    ("the flag is read from the wrong env name", IDC,
     'export const ENRICHMENT_IDENTITY_ENV = "ENRICHMENT_FOLLOWS_IDENTITY";',
     'export const ENRICHMENT_IDENTITY_ENV = "ENRICHMENT_FOLLOW_IDENTITY";'),
    ("the ledger row for the flag disappears", LEDGER,
     "| `ENRICHMENT_FOLLOWS_IDENTITY` | S20 | on |",
     "| `ENRICHMENT_FOLLOWS_IDENTITYX` | S20 | on |"),
    # --- survivorship (S20.8) ---------------------------------------------------
    ("a draft outranks a published record", IDC,
     '  if (status === "published") return 0;\n  if (status === "draft") return 1;',
     '  if (status === "published") return 1;\n  if (status === "draft") return 0;'),
    ("the OLDEST record wins instead of the newest", IDC,
     "  if (ta !== tb) return tb > ta ? 1 : -1;",
     "  if (ta !== tb) return tb > ta ? -1 : 1;"),
    ("an archived record can win", IDC,
     "  const eligible = sorted.filter((r) => statusRank(r.status) < 9);",
     "  const eligible = sorted;"),
    ("duplicates are never flagged for merge", IDC,
     "    duplicate: eligible.length > 1,",
     "    duplicate: false,"),
    ("a draft record may be borrowed by another card", IDC,
     '    const published = g.filter((r) => r.status === "published");',
     "    const published = g;"),
    # --- the read ladder --------------------------------------------------------
    ("the product's record beats the card's own copy (Q-03 broken)", IDC,
     '  if (own && hasContent(own)) return { row: own, via: "pos_key" };\n  if (\n    enabled &&',
     '  if (\n    enabled &&'),
    ("the ladder borrows with the flag off", IDC,
     "    enabled &&\n    byIdentity &&",
     "    byIdentity &&"),
    ("the ladder borrows a non-published record", IDC,
     '    byIdentity.status === "published" &&',
     ''),
    ("the ladder 'borrows' the card's own row from itself", IDC,
     "    (!own || byIdentity.pos_product_key !== own.pos_product_key) &&",
     ''),
    ("an EMPTY product record is borrowed", IDC,
     "    hasContent(byIdentity)\n  ) {",
     "    true\n  ) {"),
    ("an image-only record does not count as content", IDC,
     "      (row.image_media_ids?.length ?? 0) > 0 ||",
     ''),
    # --- suggestions on the card key -------------------------------------------
    ("restock suggestions still go to the lot key", IDC,
     "  if (input.enabled && card) return card;",
     ''),
    ("restock suggestions go to the card key with the flag off", IDC,
     "  if (input.enabled && card) return card;",
     "  if (card) return card;"),
    ("attach door files suggestions on the lot key", ATT,
     "      entity_id: sf.suggestionKey,",
     "      entity_id: sf.posProductKey,"),
    ("attach door dedupes against the lot key", ATT,
     '      .eq("entity_id", sf.suggestionKey)',
     '      .eq("entity_id", sf.posProductKey)'),
    ("attach door never reads the restock hint", ATT,
     "      restockOfCardKey: d.restock_of_card_key ?? null,",
     "      restockOfCardKey: null,"),
    # --- backfill ---------------------------------------------------------------
    ("backfill overwrites a stored identity", IDC,
     "    if (stored) {\n      plan.alreadyStamped += 1;",
     "    if (stored && false) {\n      plan.alreadyStamped += 1;"),
    ("backfill writes are not conditional (can overwrite a racer)", IDS,
     '        .eq("id", u.id)\n        .is("identity_key", null)\n        .select("id");',
     '        .eq("id", u.id)\n        .select("id");'),
    ("backfill plans on a partial menu read", IDS,
     "    if (!menu.verdict.complete) {",
     "    if (false) {"),
    ("backfill stamps a key with conflicting menu rows", IDC,
     "    if (identityByKey.has(key) && identityByKey.get(key) !== id) identityByKey.set(key, null);\n    else identityByKey.set(key, id);",
     "    identityByKey.set(key, id);"),
    ("backfill counts a racer's stamp as ours", IDS,
     "      else if (Array.isArray(data) && data.length > 0) stamped += 1;",
     "      else stamped += 1;"),
    # --- the shared identity read ----------------------------------------------
    ("the identity read ignores the flag", IDS,
     "  const out = new Map<string, T>();\n  if (!enrichmentFollowsIdentityOn()) return out;",
     "  const out = new Map<string, T>();"),
    ("the identity read includes drafts on the wire", IDS,
     '          .in("identity_key", chunk)\n          .eq("status", "published")',
     '          .in("identity_key", chunk)'),
    ("'*' gets the survivorship columns appended", IDS,
     '  const columns = contentColumns.trim() === "*" ? "*" : mergeColumns(contentColumns, SURVIVORSHIP_COLUMNS);',
     "  const columns = mergeColumns(contentColumns, SURVIVORSHIP_COLUMNS);"),
    ("a read error throws instead of failing toward pre-S20", IDS,
     '    console.error("[enrichment-identity] identity read failed:", err instanceof Error ? err.message : err);\n    return new Map();',
     "    throw err;"),
    # --- stamping on create -----------------------------------------------------
    ("new rows are born unlinked", STORE,
     "    .insert(identity ? { ...base, identity_key: identity } : base)",
     "    .insert(base)"),
    ("pre-0234 insert is not retried", STORE,
     "  if (error && identity && isMissingIdentityColumnError(\"product_enrichments\", error)) {",
     "  if (false) {"),
    ("gap-fill update is unconditional", STORE,
     '          .eq("id", existing.id)\n          .is("identity_key", null);',
     '          .eq("id", existing.id);'),
    ("a stamped row is re-stamped", STORE,
     '    if ("identity_key" in existing && !existing.identity_key) {',
     '    if ("identity_key" in existing) {'),
    # --- per-item and batch ladder ---------------------------------------------
    ("detail page never borrows (identity skipped)", STORE,
     "  const identity = enrichmentFollowsIdentityOn() ? enrichmentIdentityForItem(item) : null;",
     "  const identity = null as string | null;"),
    ("list page never borrows", STORE,
     "    if (r.via === \"identity\" && r.row) {\n      byKey.set(it.source_item_id, r.row);",
     "    if (false && r.row) {\n      byKey.set(it.source_item_id, r.row);"),
    ("list page asks about cards that already have content", STORE,
     "    if (own && enrichmentRowHasContent(own)) continue;\n    const id = enrichmentIdentityForItem(it);",
     "    const id = enrichmentIdentityForItem(it);"),
    # --- images -----------------------------------------------------------------
    ("batch images never borrow the product's photo", IMG,
     "  for (const [k, url] of borrowed) exactByKey.set(k, url);",
     ''),
    ("the card's own image row is borrowed from itself", IMG,
     "    if (!row || row.pos_product_key === it.posKey) continue;",
     "    if (!row) continue;"),
    ("the menu items drop their identity on the way to the resolver", IMG,
     "      identityKey: it.identityKey ?? null,",
     "      identityKey: null,"),
    # --- KB ladder rung 3b ------------------------------------------------------
    ("KB batch never borrows by identity", KBC,
     "  if (borrowed) return fromEnrichmentPure(borrowed);",
     ''),
    ("KB borrow re-borrows the card's own row", KBC,
     "  if (query.posProductKey && row.pos_product_key === query.posProductKey) return null;",
     ''),
    ("per-item KB lookup skips rung 3b", LOOK,
     "    if (borrowed) return fromEnrichmentPure(borrowed);\n  }\n\n  // 4",
     "  }\n\n  // 4"),
    # --- the owner's button -----------------------------------------------------
    ("backfill button skips the permission check", ACTS,
     '  const session = await requirePermission("products.enrich");\n  const result = await runIdentityBackfill();',
     '  const session = { userId: null, email: null };\n  const result = await runIdentityBackfill();'),
    ("backfill is not audited", ACTS,
     '    action: "product.enrichment_identity_backfill",',
     '    action: "product.enrichment_update",'),
    ("the detail page hides 'served from this product's record'", DETAIL,
     '{center.enrichmentVia === "identity" && center.enrichment && (',
     '{false && center.enrichment && ('),
    # ================================================================== S23 ==
    # --- the description rule --------------------------------------------------
    ("the placeholder sentence counts as a real description", GVC,
     "export function isRealDescription(text: string | null | undefined): boolean {\n  return !isBoilerplateDescription(text);",
     "export function isRealDescription(text: string | null | undefined): boolean {\n  return String(text ?? \"\").trim() !== \"\";"),
    ("the menu row's real copy is ignored", GVC,
     '  if (isRealDescription(itemDescription)) return "menu";',
     ''),
    ("the menu row outranks the enrichment row", GVC,
     '  if (isRealDescription(enrichmentDescription)) return "enrichment";\n  if (isRealDescription(itemDescription)) return "menu";',
     '  if (isRealDescription(itemDescription)) return "menu";\n  if (isRealDescription(enrichmentDescription)) return "enrichment";'),
    ("computeGaps goes back to the old truthy rule", STORE,
     "  const hasDescription = describedFrom !== null;",
     "  const hasDescription = Boolean(enrichment?.description || (item.description && item.description.trim().length > 0));"),
    ("computeGaps never flags the placeholder", STORE,
     '  const descriptionPlaceholder = !hasDescription && String(enrichment?.description || item.description || "").trim() !== "";',
     "  const descriptionPlaceholder = false;"),
    ("computeGaps flags a BLANK card as a placeholder", STORE,
     '  const descriptionPlaceholder = !hasDescription && String(enrichment?.description || item.description || "").trim() !== "";',
     "  const descriptionPlaceholder = !hasDescription;"),
    # --- n/a and strain rules ---------------------------------------------------
    ("a topical is asked for a strain type", GVC,
     'const NO_STRAIN_TYPE: ReadonlySet<string> = new Set(["topical", "paraphernalia", "accessories", "merch"]);',
     'const NO_STRAIN_TYPE: ReadonlySet<string> = new Set(["paraphernalia", "accessories", "merch"]);'),
    ("an 'unknown' strain type counts as filled", GVC,
     '  return canonicalStrainType(raw) !== "unknown";',
     '  return String(raw ?? "").trim() !== "";'),
    ("merch is asked for effects/terpenes", GVC,
     "        if (nonCannabis) return [\"not_applicable\", null];\n        const list =",
     "        const list ="),
    ("lineage claimed missing when it cannot be seen", GVC,
     '        return provFor(f) ? ["filled", "provenance"] : ["unchecked", null];\n      case "category":',
     '        return provFor(f) ? ["filled", "provenance"] : ["missing", null];\n      case "category":'),
    ("a borrowed image counts as the card's own", GVC,
     '        if (e && (text(e.primary_media_id) || nonEmptyList(e.image_media_ids))) return ["filled", "enrichment"];\n        return ["missing", null];',
     '        return ["filled", "enrichment"];'),
    # --- chips ------------------------------------------------------------------
    ("a chip on a MISSING field (claims it was attached)", GVC,
     '    const p = state === "filled" ? provFor(field) : null;',
     "    const p = provFor(field);"),
    ("a provenance row with an empty value earns a chip", GVC,
     "    (r) => r && typeof r.field === \"string\" && isFactSource(r.source) && !isEmptyFactValue(r.value_json),",
     "    (r) => r && typeof r.field === \"string\" && isFactSource(r.source),"),
    ("confidence shown on a 0..1 scale (\"Gemini 1%\")", GVC,
     "  return n * 100;\n}",
     "  return n;\n}"),
    ("image provenance looked up under the wrong field name", GVC,
     '  image: "images",\n  brand_link: null,',
     '  image: "image",\n  brand_link: null,'),
    ("borrowed KB copy shown although the card has its own", GVC,
     '        field === "description" && state === "missing" && k && k.source !== "none" && isRealDescription(k.description)',
     '        field === "description" && k && k.source !== "none" && isRealDescription(k.description)'),
    # --- copy -------------------------------------------------------------------
    ("the header drops the 'Still missing' half", GVC,
     "  if (m) parts.push(`Still missing: ${m}.`);",
     ''),
    ("the header drops the 'Attached at onboarding' half", GVC,
     "  if (a) parts.push(`Attached at onboarding: ${a}.`);",
     ''),
    ("an unread history is not admitted", GVC,
     '  if (!v.provenanceRead) parts.push("The onboarding history could not be read, so no field shows where it came from.");',
     ''),
    ("an unread history pretends nothing was attached", GVC,
     "    provenanceRead: input.provenance !== null,",
     "    provenanceRead: true,"),
    # --- the provenance read ----------------------------------------------------
    ("history read only by identity (lot-key facts lost)", GVS,
     '    const [byIdentity, byPos] = await Promise.all([read("identity_key", identityKeys), read("pos_product_key", posKeys)]);',
     '    const [byIdentity, byPos] = await Promise.all([read("identity_key", identityKeys), read("pos_product_key", [])]);'),
    ("history read is unbounded", GVS,
     "        .limit(GAP_PROVENANCE_LIMIT);",
     ";"),
    ("history read returns oldest first", GVS,
     '        .order("created_at", { ascending: false })',
     '        .order("created_at", { ascending: true })'),
    ("history read not filtered to gap fields", GVS,
     '        .in("field", [...GAP_PROVENANCE_FIELDS])',
     ''),
    ("a half history is served when one read fails", GVS,
     "    const error = byIdentity.error ?? byPos.error;",
     "    const error = byIdentity.error;"),
    ("a row found by both keys is listed twice", GVS,
     "        if (seen.has(id)) continue;",
     ''),
    ("a thrown read crashes the page", GVS,
     '    console.error("[gap-vector] fact history read threw (header shows no chips):", String(err).slice(0, 200));\n    return null;',
     "    throw err;"),
    # --- wiring -----------------------------------------------------------------
    ("command center reads history by the identity only", CC,
     "      loadGapProvenance({ identityKeys: [identityKey], posKeys: lotKeys }).catch(() => null),",
     "      loadGapProvenance({ identityKeys: [identityKey], posKeys: [] }).catch(() => null),"),
    ("command center builds the vector from no history", CC,
     "    knowledge,\n    provenance,\n  });",
     "    knowledge,\n    provenance: null,\n  });"),
    ("the detail page drops the gap header sentence", DETAIL,
     "            {gapHeadline(center.gapVector)}",
     ''),
    ("the detail page drops the red Missing chips", DETAIL,
     "                  Missing: {g.label}",
     "                  {g.label}"),
    ("the list hint about placeholders disappears", LIST,
     "hint={placeholderDesc > 0 ? `${placeholderDesc} only have the placeholder sentence` : undefined}",
     "hint={undefined}"),
    ("the grid card loses the placeholder reason", GRID,
     'why={c.descriptionPlaceholder ? "only the placeholder sentence" : undefined}',
     "why={undefined}"),
]

SUITES = [
    "tests/compliance/s20-enrichment-identity.test.ts",
    "tests/compliance/s23-gap-vector.test.ts",
    "tests/compliance/s07-attach-product-facts.test.ts",
    "tests/compliance/s24-kb-ladder-identity.test.ts",
    "tests/compliance/s22-enrichment-manifest-filter.test.tsx",
    "tests/compliance/intake-env-ledger.test.ts",
    "tests/compliance/menu-knowledge-batch.test.ts",
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


def run_suites(timeout=240):
    try:
        return subprocess.run(["npx", "vitest", "run", *SUITES], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        subprocess.run(["pkill", "-f", "vitest"], capture_output=True)
        return Hung()


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

# ------------------------------------------------------------------- BASELINE
print("BASELINE: the suites must be green before we break anything")
r = run_suites()
if r.returncode != 0:
    print("ABORT - baseline is already failing.")
    print(r.stdout[-3000:])
    sys.exit(1)
print("  OK - baseline green\n")


# ------------------------------------------------------------------- MUTATE
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
print(f"ALL {ran} MUTANTS KILLED" + (f" (filtered: {ran} of {len(MUTANTS)} run)" if ran != len(MUTANTS) else ""))
