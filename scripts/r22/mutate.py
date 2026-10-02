#!/usr/bin/env python3
"""
Round 22 mutation testing: testing the tests.

Owner (verbatim): "Follow the standing rules and never guess. Never assume.
Test it, test the tests."

Each mutant deliberately BREAKS one rule from Round 22, and the R22 suites
must FAIL:
  A   - S37 lot-link pure core (eligibility, key parsing, evidence, COA view)
  B   - S37 guarded writes + fail-closed reads (lot-link-store)
  C   - S37 server actions (refusals, race, audit, anchors)
  D   - S35 mastered-menu pure core (cards, stats, filters, hrefs, members)
  E   - S35 store + page + components (honest failure, identity, paging)
Same discipline as scripts/r21/mutate.py: every anchor must appear exactly
once, the baseline must be green, and every file is restored afterwards.
"""
import signal
import subprocess
import sys

LLC = "src/lib/inventory/lot-link-core.ts"
LLS = "src/lib/inventory/lot-link-store.ts"
ACT = "src/app/admin/inventory/actions.ts"
BSF = "src/lib/inventory/blocked-stock-fix-core.ts"
MMC = "src/lib/products/mastered-menu-core.ts"
MST = "src/lib/products/masters-store.ts"
MPG = "src/app/admin/products/masters/page.tsx"
MAC = "src/app/admin/products/masters/actions.ts"
MCC = "src/components/admin/products/MasteredCards.tsx"
TABS = "src/lib/admin/page-tab-sets.ts"

MUTANTS = [
    # ==================================================================== A ==
    ("a destroyed lot may be linked to a product", LLC,
     '  if (isDestroyed(lot)) return { ok: false, reason: "destroyed" };\n  if (!lotHasNoProductKey(lot)) return { ok: false, reason: "key_already_set" };',
     '  if (!lotHasNoProductKey(lot)) return { ok: false, reason: "key_already_set" };'),
    ("a lot that already has a key may be re-linked", LLC,
     '  if (!lotHasNoProductKey(lot)) return { ok: false, reason: "key_already_set" };',
     '  if (false) return { ok: false, reason: "key_already_set" };'),
    ("a whitespace-only key counts as set", LLC,
     '  return !(lot.pos_product_key ?? "").trim();',
     '  return !(lot.pos_product_key ?? "");'),
    ("a COA may overwrite an existing COA", LLC,
     '  if (lot.lab_result_id != null && String(lot.lab_result_id).trim() !== "") {',
     '  if (false) {'),
    ("a size id (-onboarded) is accepted as a product key", LLC,
     "  if (v.endsWith(SIZE_ID_SUFFIX)) {\n    const lotKey",
     "  if (false) {\n    const lotKey"),
    ("a dismissed-only key is accepted", LLC,
     '  if (statuses.has("dismissed")) {\n    return {\n      ok: false,',
     '  if (statuses.has("dismissed")) {\n    return {\n      ok: true, where: "onboarding_draft" as const,'),
    ("an approved draft does not count as evidence", LLC,
     '  if (statuses.has("approved")) return { ok: true, where: "onboarding_approved" };\n',
     ''),
    ("a published size wins over nothing - dropped", LLC,
     '  if (e.publishedSize) return { ok: true, where: "published_size" };\n',
     ''),
    ("a failed lab result carries no warning", LLC,
     '  if (row.passed === false) {\n    warnings.push(',
     '  if (row.passed === null) {\n    warnings.push('),
    ("an expired COA carries no warning", LLC,
     "  if (row.coa_expire_date && row.coa_expire_date < today) {",
     "  if (row.coa_expire_date && row.coa_expire_date > today) {"),
    ("a COA linked to other lots is not flagged", LLC,
     "  if (linkedLots != null && linkedLots > 0) {",
     "  if (linkedLots != null && linkedLots > 1) {"),
    ("an over-long Lab test ID is accepted", LLC,
     "  if (v.length > MAX_LABTEST_ID) {",
     "  if (v.length > MAX_LABTEST_ID * 10) {"),
    ("a non-UUID lab result id is accepted", LLC,
     '  if (!UUID_RE.test(v)) return { ok: false, error: "That lab result id is not valid." };\n',
     ''),
    ("undated lab results sort first", LLC,
     "      if (!ta) return 1;\n      if (!tb) return -1;",
     "      if (!ta) return -1;\n      if (!tb) return 1;"),
    ("dismissed drafts are offered as key suggestions", LLC,
     '    if (status !== "draft" && status !== "approved") continue;\n',
     ''),
    ("size ids are offered as key suggestions", LLC,
     "    if (key.endsWith(SIZE_ID_SUFFIX)) continue;\n",
     ''),
    ("the COA search href loses its anchor", LLC,
     "?coaSearch=${encodeURIComponent(term)}#${COA_ANCHOR}`",
     "?coaSearch=${encodeURIComponent(term)}`"),
    ("the blocked-stock fix link no longer opens the Product link form", BSF,
     "      return {\n        href: `/admin/inventory/${lotId}#product-link`,",
     "      return {\n        href: `/admin/inventory/${lotId}`,"),
    ("the hidden-without-key fix link no longer opens the Product link form", BSF,
     "            href: `/admin/inventory/${lotId}#product-link`,",
     "            href: `/admin/inventory/${lotId}`,"),
    # ==================================================================== B ==
    ("the key write drops the destroyed guard (null pass)", LLS,
     '    .neq("status", "destroyed")\n    .is("pos_product_key", null)',
     '    .is("pos_product_key", null)'),
    ("the key write overwrites any existing key (null pass)", LLS,
     '    .neq("status", "destroyed")\n    .is("pos_product_key", null)',
     '    .neq("status", "destroyed")'),
    ("the key write skips the empty-string pass", LLS,
     '  if (((first.data as { id: string }[] | null) ?? []).length > 0) return { ok: true, linked: true };',
     '  return { ok: true, linked: ((first.data as { id: string }[] | null) ?? []).length > 0 };'),
    ("the empty-string pass overwrites any key", LLS,
     '    .neq("status", "destroyed")\n    .eq("pos_product_key", "")',
     '    .neq("status", "destroyed")'),
    ("a write error on the first pass is ignored", LLS,
     "  if (first.error) return { ok: false, error: first.error.message };\n",
     ''),
    ("the COA write overwrites an existing COA", LLS,
     '    .neq("status", "destroyed")\n    .is("lab_result_id", null)',
     '    .neq("status", "destroyed")'),
    ("the COA write ignores destroyed lots", LLS,
     '    .neq("status", "destroyed")\n    .is("lab_result_id", null)',
     '    .is("lab_result_id", null)'),
    ("evidence: a menu-card read error is treated as 'not found'", LLS,
     "    if (card.error) return { ok: false, error: `Could not check the published menu: ${card.error.message}` };\n",
     ''),
    ("evidence: a size on a DRAFT version counts as published", LLS,
     '        evidence.publishedSize = ((owners.data as { id: string }[] | null) ?? []).length > 0;',
     '        evidence.publishedSize = true;'),
    ("evidence: a drafts read error is treated as 'not found'", LLS,
     "  if (drafts.error) return { ok: false, error: `Could not check Product Onboarding: ${drafts.error.message}` };\n",
     ''),
    ("the linked-lot count is reported even when incomplete", LLS,
     "    if (!used.verdict.complete) return { ok: false, error: `Could not count the lots using these lab results: ${used.verdict.message}` };\n",
     ''),
    ("labResultExists says yes for anything", LLS,
     '  return { ok: true, exists: ((data as { id: string }[] | null) ?? []).length > 0 };',
     '  return { ok: true, exists: true };'),
    # ==================================================================== C ==
    ("action: a lost race is reported as success", ACT,
     '  if (!result.linked) lotErr(lotId, PRODUCT_LINK_ANCHOR, refusalMessage("key_already_set"));\n',
     ''),
    ("action: an unresolved key is written anyway", ACT,
     "  if (!resolved.ok) lotErr(lotId, PRODUCT_LINK_ANCHOR, resolved.error);\n",
     ''),
    ("action: the lot eligibility gate is skipped", ACT,
     "  if (!gate.ok) lotErr(lotId, PRODUCT_LINK_ANCHOR, refusalMessage(gate.reason));\n",
     ''),
    ("action: the key link is not audited", ACT,
     '    action: "inventory_lot.product_linked",',
     '    action: "inventory_lot.updated",'),
    ("action: the audit records the wrong key source", ACT,
     '      pos_product_key_source: "owner_entered",',
     '      pos_product_key_source: "pos_import",'),
    ("action: the key success redirect loses its anchor", ACT,
     "  redirect(`/admin/inventory/${lotId}?saved=1#${PRODUCT_LINK_ANCHOR}`);",
     "  redirect(`/admin/inventory/${lotId}?saved=1`);"),
    ("action: a missing lab result is attached anyway", ACT,
     '  if (!exists.exists) lotErr(lotId, COA_ANCHOR, "That lab result no longer exists. Search again.");\n',
     ''),
    ("action: a lost COA race is reported as success", ACT,
     '  if (!result.linked) lotErr(lotId, COA_ANCHOR, refusalMessage("coa_already_linked"));\n',
     ''),
    ("action: the COA link is not audited", ACT,
     '    action: "inventory_lot.coa_linked",',
     '    action: "inventory_lot.updated",'),
    # ==================================================================== D ==
    ("hidden cards show on the Live cards tab", MMC,
     "    .filter((i) => i.hidden !== true)\n",
     ''),
    ("cards are not sorted most-sizes first", MMC,
     "        b.sizes.length - a.sizes.length ||\n",
     ''),
    ("a stored 0 on hand is shown as unknown", MMC,
     '  return typeof v === "number" && Number.isFinite(v) ? v : null;',
     '  return typeof v === "number" && Number.isFinite(v) && v !== 0 ? v : null;'),
    ("an unknown size makes a partial total instead of unknown", MMC,
     "    sizes.length > 0 && sizes.every((s) => s.onHand !== null)",
     "    sizes.length > 0 && sizes.some((s) => s.onHand !== null)"),
    ("a POS size id is treated as a lot", MMC,
     "  if (!s.endsWith(ONBOARDED_SUFFIX)) return null;",
     "  if (!s.endsWith(ONBOARDED_SUFFIX)) return clean(s);"),
    ("a mixed card is called medical only", MMC,
     '  if (med === sizes.length) return "medical";',
     '  if (med > 0) return "medical";'),
    ("multi-size counts single-size cards", MMC,
     "    if (r.sizes.length >= 2) multiSize += 1;",
     "    if (r.sizes.length >= 1) multiSize += 1;"),
    ("the product name is ignored for the card title", MMC,
     "    name: clean(item.product_name) ?? clean(item.name) ?? item.source_item_id,",
     "    name: clean(item.name) ?? item.source_item_id,"),
    ("the multi filter includes single-size cards", MMC,
     '  if (f === "multi") return rows.filter((r) => r.sizes.length >= 2);',
     '  if (f === "multi") return rows.filter((r) => r.sizes.length >= 1);'),
    ("an unknown ?show= value filters instead of showing all", MMC,
     '  return s === "multi" || s === "single" ? s : "all";',
     '  return s === "single" ? s : "multi";'),
    ("the Live cards href drops the tab", MMC,
     '  const qs = new URLSearchParams({ tab: "live" });',
     '  const qs = new URLSearchParams();'),
    ("the Live cards href drops the back link", MMC,
     '  if (b) qs.set("back", b);',
     ''),
    ("page 1 is written into the href", MMC,
     '  if (page > 1) qs.set("page", String(page));',
     '  if (page > 0) qs.set("page", String(page));'),
    ("members are not ordered by sort_order", MMC,
     "a.sort_order - b.sort_order || ",
     ''),
    ("the lot search link is not encoded", MMC,
     "  return `/admin/inventory?q=${encodeURIComponent(lotKey.trim())}`;",
     "  return `/admin/inventory?q=${lotKey.trim()}`;"),
    ("unknown stock is shown as 0 on hand", MMC,
     '  return n === null ? "Stock unknown" : `${n} on hand`;',
     '  return `${n ?? 0} on hand`;'),
    # ==================================================================== E ==
    ("an unreadable live menu is shown as empty", MST,
     "  if (items.length === 0 && (version.item_count ?? 0) > 0) {",
     "  if (false) {"),
    ("the identity read is unbounded", MST,
     '    .in("source_item_id", [...keys])\n    .limit(keys.length);',
     '    .in("source_item_id", [...keys]);'),
    ("the identity read ignores the published version", MST,
     '    .eq("menu_version_id", versionId)\n    .in("source_item_id", [...keys])',
     '    .in("source_item_id", [...keys])'),
    ("an incomplete members read is reported complete", MST,
     "  return { members: rows, complete: verdict.complete };",
     "  return { members: rows, complete: true };"),
    ("the Masters page defaults to the Masters tab", MPG,
     '  const tab = resolveTab(MASTERS_PAGE_TABS, { tab: sp.tab }, "live");',
     '  const tab = resolveTab(MASTERS_PAGE_TABS, { tab: sp.tab }, "masters");'),
    ("Live cards are not paged", MPG,
     "  const pageCards = filtered.slice(win.from, win.to + 1);",
     "  const pageCards = filtered;"),
    ("the Live cards filter is ignored", MPG,
     "  const filtered = filterCards(cards, show);",
     "  const filtered = filterCards(cards, \"all\");"),
    ("a partial members read is not warned about", MPG,
     "      {(!membersComplete || !menuReadOk) && masters.length > 0 && (",
     "      {false && masters.length > 0 && ("),
    ("a manual-master error redirect lands on Live cards", MAC,
     '  if (!display) redirect(`${BASE}?tab=masters&error=` + encodeURIComponent("A name is required."));',
     '  if (!display) redirect(`${BASE}?error=` + encodeURIComponent("A name is required."));'),
    ("a lot size is shown as a POS import", MCC,
     "              {s.lotKey ? (",
     "              {false ? ("),
    ("a member off the live menu is not flagged", MCC,
     '              <span className="text-[var(--admin-orange)]">Not on the live menu</span>',
     ''),
    ("the Live cards tab is not first", TABS,
     '  { key: "live", label: "Live cards", blurb: "Every card on your live menu with its sizes, prices, stock and the lots that feed it." },\n',
     ''),
]

SUITES = [
    "tests/compliance/s37-lot-link.test.tsx",
    "tests/compliance/s35-mastered-menu.test.tsx",
    "tests/compliance/inventory-fix-contract.test.ts",
    "tests/compliance/blocked-stock-fix-links.test.ts",
    "tests/compliance/pipeline-fix-links-connected.test.ts",
    "tests/compliance/page-tabs.test.tsx",
    "tests/compliance/product-identity-schema.test.ts",
    "tests/compliance/slice5c-cap-relevant-reads.test.ts",
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
