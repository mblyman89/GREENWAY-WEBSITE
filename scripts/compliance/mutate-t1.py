#!/usr/bin/env python3
"""SLICE T1 MUTATION HARNESS -- tests the tests.

Each mutation deliberately breaks the brand matcher in a way a careless edit
really could, then runs the T1 suites. A mutation that survives means the tests
would NOT have noticed that breakage, and the tests are the thing that needs
fixing -- never the mutation.

Each `edit` is a LIST of (old, new) pairs so a mutation can remove a group of
deliberately-redundant guards at once. A single-edit-only harness cannot kill
jointly-observable redundancy (learned on SLICE W1).

Every edit asserts `count == 1` before applying and restores from an in-memory
snapshot afterwards, so a crash can never leave the tree mutated.
"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CORE = ROOT / "src/lib/promotions/brand-match-core.ts"
ENGINE = ROOT / "src/lib/promotions/discount-engine-core.ts"
CART = ROOT / "src/lib/specials/cart-discount.ts"
DEALS = ROOT / "src/lib/specials/daily-deals.ts"

TESTS = [
    "tests/compliance/brand-match-catalogue.test.ts",
    "tests/compliance/brand-match-wiring.test.ts",
    "tests/compliance/pure-selftests.test.ts",
]

MUTATIONS = [
    # ---- brandKey: the normalisation itself -------------------------------
    ("key: stop stripping punctuation", CORE, [
        ('return value.toLowerCase().replace(/[^a-z0-9]+/g, "");',
         'return value.toLowerCase();')]),
    ("key: stop lowercasing", CORE, [
        ('return value.toLowerCase().replace(/[^a-z0-9]+/g, "");',
         'return value.replace(/[^a-z0-9]+/g, "");')]),
    ("key: strip digits too (420 Bar collides)", CORE, [
        ('return value.toLowerCase().replace(/[^a-z0-9]+/g, "");',
         'return value.toLowerCase().replace(/[^a-z]+/g, "");')]),
    ("key: single char class (only first punct run)", CORE, [
        ('return value.toLowerCase().replace(/[^a-z0-9]+/g, "");',
         'return value.toLowerCase().replace(/[^a-z0-9]/, "");')]),
    # NOTE: the polite form of this mutation -- swapping the guard for a
    # defensive `String(value ?? "")` -- is an EQUIVALENT MUTANT, proven with
    # scripts/probe-survivors-t1.ts: null/undefined/"" all key to "" either
    # way, and for any non-empty string the guard is not taken. It is listed
    # in EQUIVALENT_MUTANTS below rather than scored. What a careless edit
    # ACTUALLY does is delete the line, which throws on a null brand -- and
    # null brands are real (published-rules-core maps `item.brand || null`).
    ("key: blank guard deleted (null brand throws)", CORE, [
        ('  if (!value) return "";\n  return value.toLowerCase()',
         '  return value.toLowerCase()')]),

    # ---- brandMatches: the safety directions ------------------------------
    ("match: empty value becomes a wildcard", CORE, [
        ('  const a = brandKey(value);\n  if (!a) return false;',
         '  const a = brandKey(value);\n  if (!a) return true;')]),
    ("match: empty target becomes a wildcard", CORE, [
        ('  const b = brandKey(target);\n  if (!b) return false;',
         '  const b = brandKey(target);\n  if (!b) return true;')]),
    ("match: equality -> startsWith (sweeps in sub-brands)", CORE, [
        ('  return a === b;\n}', '  return a.startsWith(b);\n}')]),
    ("match: equality -> includes (substring)", CORE, [
        ('  return a === b;\n}', '  return a.includes(b);\n}')]),
    ("match: always true", CORE, [
        ('  return a === b;\n}', '  return true;\n}')]),
    ("match: always false", CORE, [
        ('  return a === b;\n}', '  return false;\n}')]),

    # ---- brandInList ------------------------------------------------------
    ("list: blank value matches", CORE, [
        ('  const v = brandKey(value);\n  if (!v) return false;\n  if (!list) return false;',
         '  const v = brandKey(value);\n  if (!list) return false;')]),
    ("list: compares raw entry instead of key", CORE, [
        ('    if (brandKey(entry) === v) return true;',
         '    if (entry === v) return true;')]),
    ("list: returns true on first iteration", CORE, [
        ('    if (brandKey(entry) === v) return true;',
         '    return true;')]),
    ("list: never matches", CORE, [
        ('    if (brandKey(entry) === v) return true;',
         '    if (false) return true;')]),

    # ---- near-miss detector ----------------------------------------------
    ("nearmiss: drops the prefix requirement", CORE, [
        ('      if (!sharesPrefix) continue;', '      if (false) continue;')]),
    ("nearmiss: every extra token is a corporate suffix", CORE, [
        ('      const kind: BrandNearMissKind = extraTokens.every((t) => suffixes.has(t))',
         '      const kind: BrandNearMissKind = extraTokens.every(() => true)')]),
    ("nearmiss: NO extra token is a corporate suffix", CORE, [
        ('      const kind: BrandNearMissKind = extraTokens.every((t) => suffixes.has(t))',
         '      const kind: BrandNearMissKind = extraTokens.every(() => false)')]),
    ("nearmiss: reports nothing at all", CORE, [
        ('      out.push({ brand, target, extraTokens, kind });', '      void kind;')]),
    ("nearmiss: extra tokens off by one", CORE, [
        ('      const extraTokens = bTok.slice(tTok.length);',
         '      const extraTokens = bTok.slice(tTok.length + 1);')]),

    # ---- the WIRING: the matcher must actually be used --------------------
    ("wiring: engine brand target reverts to old hasCi", ENGINE, [
        ('  const brandMatch = brandInList(rule.targetBrands, line.brand);',
         '  const brandMatch = hasCi(rule.targetBrands, line.brand);')]),
    ("wiring: engine brand EXCLUSION reverts to old hasCi", ENGINE, [
        ('  if (brandInList(rule.excludeBrands, line.brand)) return false;',
         '  if (hasCi(rule.excludeBrands, line.brand)) return false;')]),
    ("wiring: checkout reverts to its own copy", CART, [
        ('        if (brandInList(topShelfThursdayBrands, line.brand)) {',
         '        if (line.brand && topShelfThursdayBrands.map((b) => b.trim().toLowerCase()).includes(line.brand.trim().toLowerCase())) {')]),
    ("wiring: menu card reverts to its own copy", DEALS, [
        ('  return brandInList(brands, item.brand);',
         '  return !item.brand ? false : brands.some((b) => b.trim().toLowerCase() === item.brand.trim().toLowerCase());')]),

    # ---- multi-edit: revert the WHOLE slice at once ------------------------
    ("multi: revert engine AND checkout AND card together", None, [
        (ENGINE, '  const brandMatch = brandInList(rule.targetBrands, line.brand);',
         '  const brandMatch = hasCi(rule.targetBrands, line.brand);'),
        (CART, '        if (brandInList(topShelfThursdayBrands, line.brand)) {',
         '        if (line.brand && topShelfThursdayBrands.map((b) => b.trim().toLowerCase()).includes(line.brand.trim().toLowerCase())) {'),
        (DEALS, '  return brandInList(brands, item.brand);',
         '  return !item.brand ? false : brands.some((b) => b.trim().toLowerCase() === item.brand.trim().toLowerCase());'),
    ]),
    # ---- multi-edit: the JOINTLY-REDUNDANT near-miss guards ----------------
    # Individually these two are equivalent mutants and can never be killed
    # (proof in SURVIVOR-ANALYSIS-T1.md): the exact-match guard is unreachable
    # while the length guard stands, and vice versa, because brandKey is just
    # the concatenation of brandTokens. Removing BOTH is observable -- every
    # target starts reporting itself as a near miss -- so it is scored as one
    # mutation, exactly the SLICE W1 lesson.
    ("multi: drop BOTH near-miss guards (targets self-report)", None, [
        (CORE, '      if (brandMatches(brand, target)) continue;',
         '      if (false) continue;'),
        (CORE, '      if (bTok.length <= tTok.length) continue;',
         '      if (bTok.length < tTok.length) continue;'),
    ]),
    # ---- multi-edit: weaken the key AND the fixture that pins it -----------
    ("multi: weaken key AND relax the 339 reach assertion", None, [
        (CORE, 'return value.toLowerCase().replace(/[^a-z0-9]+/g, "");',
         'return value.trim().toLowerCase();'),
        (CORE, 'check("Thursday reaches 339 catalogue products", productsOnDeal === 339);',
         'check("Thursday reaches 339 catalogue products", productsOnDeal > 0);'),
    ]),
]

# ---------------------------------------------------------------------------
# EQUIVALENT MUTANTS -- kept, never scored, never silently dropped.
#
# Each was a survivor of run 1 and each was PROVEN equivalent with
# scripts/probe-survivors-t1.ts rather than assumed. An equivalent mutant
# produces a program that behaves identically on every reachable input, so no
# test can kill it and demanding 100% while it is scored would be a lie.
# Full reasoning: SURVIVOR-ANALYSIS-T1.md.
# ---------------------------------------------------------------------------
EQUIVALENT_MUTANTS = [
    ("key: blank guard swapped for String(value ?? '')",
     "null/undefined/'' all key to '' both ways; for non-empty strings the "
     "guard is not taken. No distinguishing input exists."),
    ("nearmiss: reports exact matches too",
     "Unreachable while the length guard stands: a strict token-prefix "
     "extension has a strictly longer key, so brandMatches is already false. "
     "Scored jointly as 'multi: drop BOTH near-miss guards'."),
    ("nearmiss: allows equal-length",
     "Unreachable while the exact-match guard stands: equal token count plus "
     "a passing prefix loop means identical tokens, hence equal keys, hence "
     "already skipped. Scored jointly as above."),
]


def run_tests() -> bool:
    r = subprocess.run(
        ["npx", "vitest", "run", *TESTS],
        cwd=ROOT, capture_output=True, text=True,
    )
    return r.returncode == 0


def main() -> int:
    files = {CORE, ENGINE, CART, DEALS}
    snapshot = {f: f.read_text() for f in files}

    print("Baseline (unmutated) must PASS ...", flush=True)
    if not run_tests():
        print("BASELINE FAILED -- fix the tree before mutating.")
        return 1
    print("  baseline OK\n")

    caught = 0
    survived = []
    for i, (name, default_file, edits) in enumerate(MUTATIONS, 1):
        try:
            for edit in edits:
                if default_file is None:
                    path, old, new = edit
                else:
                    path, (old, new) = default_file, edit
                text = path.read_text()
                n = text.count(old)
                assert n == 1, f"{name}: anchor x{n} in {path.name}"
                path.write_text(text.replace(old, new, 1))
            ok = run_tests()
        finally:
            for f, original in snapshot.items():
                f.write_text(original)
        if ok:
            survived.append(name)
            print(f"  {i:>2}. SURVIVED  {name}")
        else:
            caught += 1
            print(f"  {i:>2}. caught    {name}")

    total = len(MUTATIONS)
    print(f"\nT1 mutation score: {caught}/{total} caught")
    print(f"({len(EQUIVALENT_MUTANTS)} further mutations are PROVEN EQUIVALENT "
          "and excluded from scoring -- see SURVIVOR-ANALYSIS-T1.md:)")
    for name, why in EQUIVALENT_MUTANTS:
        print(f"  = {name}\n      {why}")
    if survived:
        print("SURVIVORS (investigate -- never delete):")
        for s in survived:
            print(f"  - {s}")
        return 1

    # Paranoia: prove the tree really is back to baseline.
    assert all(f.read_text() == snapshot[f] for f in files), "tree not restored!"
    print("tree restored; baseline re-verified below")
    return 0 if run_tests() else 1


if __name__ == "__main__":
    sys.exit(main())
