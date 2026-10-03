#!/usr/bin/env python3
"""
Round 24 mutation testing: testing the tests.

Owner (verbatim): "Follow the standing rules and never guess, never assume.
Test it, test the tests."

Each mutant deliberately BREAKS one rule from S36 (Suggestions v2 - explainable
match scores, remembered rejections), and the S36 suites must FAIL:
  A - match-weights-core: weights, levels, bands, prior, tolerances
  B - match-weights-core: fingerprint, pair keys, blocking, grouping rules
  C - match-weights-core: evidence reader, text, 0243 detectors
  D - masters-cluster toMatchRecord
  E - masters-store: generation (suppression, AI tie-break only, no-op safety)
  F - masters-store: reject (pair rows FIRST, honest failure)
  G - actions + page (banners, waterfall, reject help)
  H - migration 0243 + schema wiring
Same discipline as scripts/r23/mutate.py: every anchor must appear exactly
once, the baseline must be green, and every file is restored afterwards.
"""
import signal
import subprocess
import sys

CORE = "src/lib/products/match-weights-core.ts"
CLU = "src/lib/products/masters-cluster.ts"
MST = "src/lib/products/masters-store.ts"
MAC = "src/app/admin/products/masters/actions.ts"
MPG = "src/app/admin/products/masters/page.tsx"
MIG = "supabase/migrations/0243_master_suggestions_v2.sql"
FRC = "src/lib/accounting/factory-reset-core.ts"

MUTANTS = [
    # ==================================================================== A ==
    ("vendor agreement no longer adds (m == u)", CORE,
     '    agree: { m: 0.95, u: 0.3, note: "same vendor" },',
     '    agree: { m: 0.3, u: 0.3, note: "same vendor" },'),
    ("vendor disagreement no longer subtracts", CORE,
     '    disagree: { m: 0.05, u: 0.7, note: "different vendor" },',
     '    disagree: { m: 0.7, u: 0.7, note: "different vendor" },'),
    ("brand disagreement no longer subtracts", CORE,
     '    disagree: { m: 0.03, u: 0.65, note: "different brand" },',
     '    disagree: { m: 0.65, u: 0.65, note: "different brand" },'),
    ("verified strain weighs the same as unverified", CORE,
     '    verified: { m: 0.8, u: 0.01, note: "same strain (verified)" },',
     '    verified: { m: 0.15, u: 0.02, note: "same strain (verified)" },'),
    ("different market is positive evidence", CORE,
     '    disagree: { m: 0.001, u: 0.15, note: "different market" },',
     '    disagree: { m: 0.15, u: 0.001, note: "different market" },'),
    ("same size twice adds instead of subtracting", CORE,
     '    shared: { m: 0.1, u: 0.6, note: "same size twice" },',
     '    shared: { m: 0.6, u: 0.1, note: "same size twice" },'),
    ("prior is 50/50 instead of 1%", CORE,
     "export const PRIOR_LAMBDA = 0.01;",
     "export const PRIOR_LAMBDA = 0.5;"),
    ("Strong boundary is exclusive", CORE,
     '  if (probability >= BAND_STRONG) return "strong";',
     '  if (probability > BAND_STRONG) return "strong";'),
    ("Likely boundary moved to 0.85", CORE,
     "export const BAND_LIKELY = 0.8;",
     "export const BAND_LIKELY = 0.85;"),
    ("Review boundary is exclusive", CORE,
     '  if (probability >= BAND_REVIEW) return "review";',
     '  if (probability > BAND_REVIEW) return "review";'),
    ("Review band floor dropped to 0.3 (shows weak pairs)", CORE,
     "export const BAND_REVIEW = 0.5;",
     "export const BAND_REVIEW = 0.3;"),
    ("probability formula inverted for negative weights", CORE,
     "  const t = Math.pow(2, weight);\n  return t / (1 + t);",
     "  const t = Math.pow(2, -weight);\n  return t / (1 + t);"),
    ("prior left out of the total", CORE,
     "  const weight = contributions.reduce((s, c) => s + c.weight, PRIOR_WEIGHT);",
     "  const weight = contributions.reduce((s, c) => s + c.weight, 0);"),
    ("a blank vendor counts as disagreement (null level not 0)", CORE,
     '  if (blank(a) || blank(b)) return unknown(field, `${field === "family" ? "product type" : field} unknown`);',
     '  if (blank(a) && blank(b)) return unknown(field, `${field === "family" ? "product type" : field} unknown`);'),
    ("one unverified side still scores verified", CORE,
     "  return a.strainVerified && b.strainVerified ? from(\"strain\", w.verified, true)",
     "  return a.strainVerified || b.strainVerified ? from(\"strain\", w.verified, true)"),
    ("THC tolerance exclusive", CORE,
     "  return Math.abs(a.thcPct - b.thcPct) <= THC_BAND_POINTS ?",
     "  return Math.abs(a.thcPct - b.thcPct) < THC_BAND_POINTS ?"),
    ("price-per-gram ratio exclusive", CORE,
     "  return ratio <= PRICE_PER_GRAM_MAX_RATIO ?",
     "  return ratio < PRICE_PER_GRAM_MAX_RATIO ?"),
    ("strain type ignored", CORE,
     '    compareStrainType(a, b),\n',
     ''),
    # ==================================================================== B ==
    ("fingerprint forgets the vendor", CORE,
     '  return [r.key, r.vendor, r.brand, r.strain, r.market, sizes].join("|");',
     '  return [r.key, r.brand, r.strain, r.market, sizes].join("|");'),
    ("fingerprint forgets the sizes", CORE,
     '  return [r.key, r.vendor, r.brand, r.strain, r.market, sizes].join("|");',
     '  return [r.key, r.vendor, r.brand, r.strain, r.market].join("|");'),
    ("fingerprint depends on argument order", CORE,
     "  const [x, y] = compareKeys(a.key, b.key) <= 0 ? [a, b] : [b, a];",
     "  const [x, y] = [a, b];"),
    ("compareKeys uses locale order, not collate C", CORE,
     "    const d = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0);\n    if (d !== 0) return d < 0 ? -1 : 1;",
     "    const d = x[i].toLowerCase().localeCompare(y[i].toLowerCase());\n    if (d !== 0) return d < 0 ? -1 : 1;"),
    ("orderPairKeys keeps a reversed pair", CORE,
     "  return c < 0 ? [a, b] : [b, a];",
     "  return [a, b];"),
    ("no brand+family fallback block", CORE,
     "    if (!blank(r.brand)) add(`b\\u0000${r.brand}\\u0000${r.family}`, r);",
     ""),
    ("oversized blocks are not skipped", CORE,
     "    if (block.length > maxBlock) {",
     "    if (false) {"),
    ("market hard rule removed (cross-market pairs score)", CORE,
     "    if (a.market !== b.market || opts.isSuppressed?.(a, b, fingerprint)) {",
     "    if (opts.isSuppressed?.(a, b, fingerprint)) {"),
    ("suppression ignored", CORE,
     "    if (a.market !== b.market || opts.isSuppressed?.(a, b, fingerprint)) {",
     "    if (a.market !== b.market) {"),
    ("a rejected pair can be pulled in through a third card", CORE,
     "        if (!crossOk(x, y)) {\n          ok = false;",
     "        if (false) {\n          ok = false;"),
    ("headline is the strongest pair, not the weakest", CORE,
     "    const headline = memberPairs.reduce((w, p) => (p.score.weight < w.score.weight ? p : w));",
     "    const headline = memberPairs.reduce((w, p) => (p.score.weight > w.score.weight ? p : w));"),
    ("Likely/Review pass lets a card join two pairs", CORE,
     "    if (used.has(p.a) || used.has(p.b)) continue;",
     "    if (used.has(p.a) && used.has(p.b)) continue;"),
    ("hidden pairs become suggestions", CORE,
     '    if (p.score.band === "hidden" || p.score.band === "strong") continue;',
     '    if (p.score.band === "strong") continue;'),
    # ==================================================================== C ==
    ("readEvidence accepts any version", CORE,
     "  if (e.v !== EVIDENCE_VERSION) return null;",
     ""),
    ("readEvidence accepts a hidden band", CORE,
     '  if (e.band !== "strong" && e.band !== "likely" && e.band !== "review") return null;',
     ""),
    ("badge shows the raw fraction", CORE,
     "  return `${BAND_LABEL[band]} \u00b7 ${Math.round(probability * 100)}%`;",
     "  return `${BAND_LABEL[band]} \u00b7 ${probability}%`;"),
    ("negative lines lose their minus sign", CORE,
     '  return `${w > 0 ? "+" : "\\u2212"}${Math.abs(w).toFixed(1)} ${c.note}`;',
     '  return `${w > 0 ? "+" : ""}${Math.abs(w).toFixed(1)} ${c.note}`;'),
    ("missing-table detector trusts any 42P01", CORE,
     '  return tableSignal && word(msg, "product_master_pair_decisions");',
     "  return tableSignal;"),
    ("missing-column detector trusts any 42703", CORE,
     '  return colSignal && word(msg, "evidence_json");',
     "  return colSignal;"),
    # ==================================================================== D ==
    ("licence suffix not stripped from vendor", CLU,
     '    vendor: normalizeVendorKey(stripLicenseSuffix(item.vendor ?? "")),',
     '    vendor: normalizeVendorKey(item.vendor ?? ""),'),
    ("unknown-brand counts as a real brand", CLU,
     '    brand: id.brandIdentity === "unknown-brand" ? "" : id.brandIdentity,',
     "    brand: id.brandIdentity,"),
    ("variant sizes ignored (name only)", CLU,
     "    item.sizes && item.sizes.length > 0\n      ? item.sizes",
     "    false && item.sizes && item.sizes.length > 0\n      ? item.sizes!"),
    # ==================================================================== E ==
    ("unreadable decisions do not stop generation", MST,
     "  if (!decisions.ok) {\n    // Never propose",
     "  if (false) {\n    // Never propose"),
    ("missing decisions table is treated as a failure", MST,
     "  if (missing) return { ok: true, migrated: false, byPair };",
     "  if (missing) return { ok: false, migrated: false, byPair };"),
    ("suppression compares keys only, not the fingerprint", MST,
     "      const hit = decisions.byPair.get(pairId(a.key, b.key)) === fingerprint;",
     "      const hit = decisions.byPair.has(pairId(a.key, b.key));"),
    ("suppressed pairs are not counted", MST,
     "      if (hit) suppressed += 1;\n",
     ""),
    ("rejected sets keep blocking after 0243 (no re-open on change)", MST,
     '      .filter((s) => !(s.status === "rejected" && decisions.migrated && readEvidence(s.evidence_json)))',
     "      .filter(() => true)"),
    ("confidence is a constant again", MST,
     "      confidence: evidence.probability,",
     "      confidence: 0.97,"),
    ("AI is asked about Strong rows too", MST,
     '    if (g.band === "review") reviewRows.push({ row, members, evidence });',
     "    reviewRows.push({ row, members, evidence });"),
    ("AI note is not saved", MST,
     "        r.evidence.ai = { agrees: !!result.should_group, note };\n",
     ""),
    ("AI note can flip the band", MST,
     "        r.row.model = \"ai-tiebreak\";",
     "        r.row.model = \"ai-tiebreak\";\n        if (result.should_group) r.evidence.band = \"likely\";"),
    ("pre-0243 insert is not retried without evidence", MST,
     "    if (error && isMissingEvidenceColumn(error)) {",
     "    if (false) {"),
    ("a real insert error is swallowed", MST,
     "    } else if (error) {\n      throw new Error(error.message);\n    }",
     "    }"),
    # ==================================================================== F ==
    ("reject writes the suggestion status even when the pair write fails", MST,
     '        return { ok: false, remembered: 0, migrated: true, error: "The rejection could not be saved. Nothing changed; try again." };',
     "        migrated = false;"),
    ("reject before 0243 fails instead of rejecting", MST,
     "      if (!isMissingPairDecisionsTable(error)) {",
     "      if (true) {"),
    ("reject keeps reversed pair keys", MST,
     "    rows.push({ key_a: o[0], key_b: o[1], decision",
     "    rows.push({ key_a: p.a, key_b: p.b, decision"),
    ("reject inserts instead of upserting", MST,
     '.upsert(rows, { onConflict: "key_a,key_b" });',
     ".insert(rows);"),
    ("reject of an already-reviewed suggestion is allowed", MST,
     '  if (suggestion.status !== "pending") return { ok: false, remembered: 0, migrated: true, error: "Suggestion already reviewed." };\n\n  const evidence',
     "\n  const evidence"),
    # ==================================================================== G ==
    ("reject failure redirects as success", MAC,
     "  if (!result.ok) {\n    redirect(",
     "  if (false) {\n    redirect("),
    ("reject redirect drops remembered/unmigrated", MAC,
     '  redirect(`${BASE}?tab=suggestions&rejected=1${result.migrated ? `&remembered=${result.remembered}` : "&unmigrated=1"}`);',
     "  redirect(`${BASE}?tab=suggestions&rejected=1`);"),
    ("suppressed count not passed to the page", MAC,
     '    const extra = `${result.suppressed ? `&suppressed=${result.suppressed}` : ""}${result.migrated === false ? "&unmigrated=1" : ""}`;',
     '    const extra = `${result.migrated === false ? "&unmigrated=1" : ""}`;'),
    ("rejected banner never mentions 0243", MPG,
     "            {sp.unmigrated\n              ? \"Suggestion rejected. It is not remembered yet: run migration 0243 so rejected pairs stay hidden.\"",
     "            {false\n              ? \"Suggestion rejected. It is not remembered yet: run migration 0243 so rejected pairs stay hidden.\""),
    ("waterfall not sorted by weight", MPG,
     "  const lines = [...ev.contributions].sort((a, b) => b.weight - a.weight);",
     "  const lines = [...ev.contributions];"),
    ("reject help text removed", MPG,
     "                {REJECT_HELP}\n",
     ""),
    # ==================================================================== H ==
    ("migration lets a reversed pair in", MIG,
     'key_a < key_b collate "C"',
     'key_a <> key_b'),
    ("factory reset wipes the owner's rejections", FRC,
     '{ table: "product_master_pair_decisions", disposition: "KEEP"',
     '{ table: "product_master_pair_decisions", disposition: "WIPE"'),
]

SUITES = [
    "tests/compliance/s36-suggestions-v2.test.tsx",
    "tests/compliance/page-tabs.test.tsx",
    "tests/compliance/r23-masters-filter.test.tsx",
    "tests/compliance/s35-mastered-menu.test.tsx",
    "tests/compliance/factory-reset-core.test.ts",
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
