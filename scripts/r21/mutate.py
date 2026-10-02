#!/usr/bin/env python3
"""
Round 21 mutation testing: testing the tests.

Owner (verbatim): "Follow the standing rules and never guess, never assume."
(standing rule: "Test it, test the tests.")

Each mutant deliberately BREAKS one rule from Round 21, and the R21 suites
must FAIL:
  A   - the batch "Look up all" entry decision + the delivery chooser
  B   - S41 full-width detail row (colSpan from the column list, CSS reveal)
  C   - enrichment "add a photo" starts in the media library
  D   - S34 mastering preview (the wrapper IS the dry run, group sizes, the
        live card's shape, published-only links, panel silence, wiring)
Same discipline as scripts/r20/mutate.py: every anchor must appear exactly
once, the baseline must be green, and every file is restored afterwards.
"""
import signal
import subprocess
import sys

LJ = "src/lib/catalog/lookup-job-core.ts"
OLC = "src/lib/catalog/onboarding-list-core.ts"
DROW = "src/components/admin/catalog/OnboardingDetailRow.tsx"
DPAGE = "src/app/admin/inventory/drafts/page.tsx"
CSS = "src/app/globals.css"
LPC = "src/lib/media/library-picker-core.ts"
LPS = "src/lib/media/library-picker-server.ts"
PICK = "src/app/admin/products/[key]/MediaLibraryPicker.tsx"
MATCH = "src/lib/enrichment/match-core.ts"
IMC = "src/lib/pos/intake-mastering-core.ts"
RPS = "src/lib/inventory/restock-preview-server.ts"
MPC = "src/lib/inventory/mastering-preview-core.ts"
PANEL = "src/components/admin/catalog/MasteringPreviewPanel.tsx"
CDR = "src/lib/inventory/catalog-drafts.ts"
STG = "src/lib/pos/intake-menu-staging.ts"

MUTANTS = [
    # ==================================================================== A ==
    ("unfocused review tab hides the entry instead of offering the chooser", LJ,
     '  if (!i.focused) return { kind: "choose" };',
     '  if (!i.focused) return { kind: "hidden" };'),
    ("the focus check runs before the flag reason", LJ,
     '  if (!i.flagOn) return { kind: "reason", text: LOOKUP_FLAG_OFF_COPY };\n  if (!i.aiOn) return { kind: "reason", text: LOOKUP_AI_OFF_COPY };\n  if (!i.focused) return { kind: "choose" };',
     '  if (!i.focused) return { kind: "choose" };\n  if (!i.flagOn) return { kind: "reason", text: LOOKUP_FLAG_OFF_COPY };\n  if (!i.aiOn) return { kind: "reason", text: LOOKUP_AI_OFF_COPY };'),
    ("an unknown count shows a button", LJ,
     '  if (!e || !Number.isFinite(e.count) || e.count < 0) return { kind: "reason", text: LOOKUP_UNKNOWN_COUNT_COPY };',
     '  if (!e) return { kind: "reason", text: LOOKUP_UNKNOWN_COUNT_COPY };'),
    ("the chooser lists deliveries with nothing in review", LJ,
     "    if (n !== null && n <= 0) continue;",
     "    if (n !== null && n < 0) continue;"),
    ("the chooser invents a count", LJ,
     'countText: n === null ? "count not available" : `${n} in Needs review`',
     'countText: `${n ?? 0} in Needs review`'),
    # ==================================================================== B ==
    ("the detail row spans a fixed 4 columns", DPAGE,
     "                        colSpan={columns.length}",
     "                        colSpan={4}"),
    ("the Facts column is shown on the v1 row", OLC,
     '  if (v2Row) cols.push({ key: "facts", label: "Facts", alignRight: false });',
     '  cols.push({ key: "facts", label: "Facts", alignRight: false });'),
    ("the detail row never reveals when the row opens", CSS,
     "    display: table-row;\n",
     "    display: none;\n"),
    # ==================================================================== C ==
    ("archived photos are pickable", LPC,
     '  if (a.status === "archived") return false;',
     '  if (a.status === "archivedX") return false;'),
    ("the reader asks for archived rows", LPS,
     '      .neq("status", "archived")',
     '      .neq("status", "archivedX")'),
    ("product scope reads every usage type", LPS,
     '    if (scope === "product") q = q.eq("usage_type", "product");',
     "    // scope ignored"),
    ("gallery photos are not marked already added", LPC,
     "      alreadyAdded: gallery.has(a.id.trim()),",
     "      alreadyAdded: false,"),
    ("the attach form forgets source=library", PICK,
     '                    <input type="hidden" name="source" value={LIBRARY_ATTACH_SOURCE} />',
     ""),
    ("guidance drops the library button", MATCH,
     '      label: "Choose from the media library",\n      href: "#library",',
     '      label: "Choose from the media library",\n      href: "#upload",'),
    # ==================================================================== D ==
    ("the wrapper diverges from the dry run (drops vendor ids)", IMC,
     "  return previewMasteringGroups(input).verdicts;",
     "  return previewMasteringGroups({ ...input, vendorIds: undefined }).verdicts;"),
    ("group sizes are not ladder-sorted", IMC,
     "      sizes: [...ladderSort(sized), ...Array.from({ length: unknown }, () => PREVIEW_SIZE_UNKNOWN)],",
     "      sizes: [...sized, ...Array.from({ length: unknown }, () => PREVIEW_SIZE_UNKNOWN)],"),
    ("rows without a size are silently dropped from sizes", IMC,
     "      sizes: [...ladderSort(sized), ...Array.from({ length: unknown }, () => PREVIEW_SIZE_UNKNOWN)],",
     "      sizes: ladderSort(sized),"),
    ("a group copies the verdict instead of sharing it", IMC,
     "      verdict,\n      ...(m.cards.length === 1",
     "      verdict: { ...verdict },\n      ...(m.cards.length === 1"),
    ("on hand is invented when a level is unknown", IMC,
     '  const onHandKnown = levels.length > 0 && levels.every((l) => typeof l === "number" && Number.isFinite(l));',
     "  const onHandKnown = levels.length > 0;"),
    ("the price range ignores the cheapest size", IMC,
     "    priceRangeMinor: prices.length > 0 ? [Math.min(...prices), Math.max(...prices)] : null,",
     "    priceRangeMinor: prices.length > 0 ? [Math.max(...prices), Math.max(...prices)] : null,"),
    ("the server stops reading variant prices", RPS,
     '"menu_item_id, source_variant_id, medical, label, price_minor_units, inventory_level"',
     '"menu_item_id, source_variant_id, medical, label, inventory_level"'),
    ("the server drops the groups", RPS,
     "    return { ok: true, verdicts: dry.verdicts, groups: dry.groups, matchedByVendorId: Boolean(vendorIds) };",
     "    return { ok: true, verdicts: dry.verdicts, groups: [], matchedByVendorId: Boolean(vendorIds) };"),
    ("a NEW card gets a product link", MPC,
     '    lead: `${rows} \\u2192 one NEW card with ${sizes}`,\n    cardName: null,\n    tail: "",\n    link: null,',
     '    lead: `${rows} \\u2192 one NEW card with ${sizes}`,\n    cardName: null,\n    tail: "",\n    link: { href: productPageHref(group.identity), label: "Open" },'),
    ("ambiguous links nowhere", MPC,
     '      link: ctx.manifestId ? { href: matchReviewHref(ctx.manifestId, group.identity, ctx.back), label: "Compare & choose" } : null,',
     "      link: null,"),
    ("stock unknown is shown as 0 on hand", MPC,
     '          card.onHand === null ? "stock unknown" : `${card.onHand} on hand`',
     "          `${card.onHand ?? 0} on hand`"),
    ("the panel renders without a preview", PANEL,
     "  if (!groups || groups.length === 0) return null;",
     "  if (!groups) return null;"),
    ("the page renders the panel from nothing", DPAGE,
     "            groups={previewGroups}",
     "            groups={[]}"),
    ("rows lose their lot size", DPAGE,
     "          size_label: strainSizeLabels.get(d.id) ?? null,",
     "          size_label: null,"),
    ("the lot read stops returning sizes", CDR,
     "      if (size) lotSizeById.set(l.id, size);",
     "      void size;"),
    ("staging goes back to its own inline label", STG,
     "        packageLabel: lotPackageLabel(lot),",
     '        packageLabel: lot && lot.unit_weight != null ? `${lot.unit_weight} ${lot.unit_weight_uom ?? ""}`.trim() : null,'),
]

SUITES = [
    "tests/compliance/r21-s41-batch-entry.test.ts",
    "tests/compliance/r21-media-library-picker.test.tsx",
    "tests/compliance/r21-s34-mastering-preview.test.tsx",
    "tests/compliance/r21-s34-lot-size-read.test.ts",
    "tests/compliance/s19-vendor-identity.test.ts",
    "tests/compliance/s32-merge-review.test.ts",
    "tests/compliance/s10-fact-attach-policy.test.ts",
    "tests/compliance/s11-onboarding-row.test.ts",
    "tests/compliance/s13-lookup-jobs.test.ts",
    "tests/compliance/s14-onboarding-list.test.ts",
    "tests/compliance/enrichment-match-core.test.ts",
    "tests/compliance/s22-enrichment-manifest-filter.test.tsx",
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
