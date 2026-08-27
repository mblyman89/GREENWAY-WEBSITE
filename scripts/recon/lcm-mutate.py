#!/usr/bin/env python3
"""
Mutation campaign for ledger-category-map-core.ts.

Written with the safety rails that last session's corruption incident earned.
The failure then: a blocking command reported a timeout WITHOUT killing the
process, a second copy was started, both raced on the same file and the same
.bak, and the second captured an ALREADY-MUTATED file as its "original" and
restored that. Two mutants were baked into the file AND the backup, and two
more silently failed to apply while the run still printed a clean sweep.

The five rails, each aimed at one part of that failure:

  1. LOCKFILE, exclusive create. A second copy cannot start at all.
  2. PATTERN PRE-VALIDATION. Every pattern must match EXACTLY ONCE against the
     pristine original before any mutation is applied. A pattern that matches
     0 or 2+ times aborts the whole run. "NOT APPLIED" can never be silent.
  3. BASELINE MUST BE GREEN. If the tests do not pass before mutating, the run
     aborts -- otherwise every mutant "dies" for the wrong reason.
  4. SHA256-VERIFIED RESTORE. The original's hash is taken once, and after
     every single restore the file's hash must equal it or the run halts.
  5. FINAL HASH CHECK. The file must be byte-identical to the original at exit.
"""

import hashlib
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TARGET = os.path.join(REPO, "src", "lib", "accounting", "ledger-category-map-core.ts")
TEST = "tests/compliance/ledger-category-map-core.test.ts"
LOCK = os.path.join(REPO, "tmp-lcm-mutate.lock")

# (id, description, old, new)
MUTANTS = [
    # --- account arithmetic
    ("M1", "zero-padding removed: 20010 becomes 210",
     'while (s.length < 4) s = "0" + s;', 'while (s.length < 0) s = "0" + s;'),
    ("M2", "block digit changed from 2 to 1",
     'return "2" + pad4(row.slot);', 'return "1" + pad4(row.slot);'),
    ("M3", "unknown slug returns an account instead of null",
     '  return null;\n}\n\n/* ------------------------------------------------------------------ *\n * The map itself',
     '  return "20890";\n}\n\n/* ------------------------------------------------------------------ *\n * The map itself'),
    ("M4", "null slug silently becomes flower",
     'if (slug === null) return null;', 'if (slug === null) return "20010";'),

    # --- the four decided overrides: each reverted to the website map
    ("M5", "RSO reverted to the website grouping (concentrate)",
     '  "RSO": "rso",', '  "RSO": "concentrate",'),
    ("M6", "Tincture reverted to the website grouping (edible-liquid)",
     '  "Tincture": "tincture",', '  "Tincture": "edible-liquid",'),
    ("M7", "Infused Blunt reverted to the website grouping (infused-preroll)",
     '  "Infused Blunt": "infused-blunt",', '  "Infused Blunt": "infused-preroll",'),
    ("M8", "Blunt reverted to the website grouping (preroll)",
     '  "Blunt": "blunt",', '  "Blunt": "preroll",'),

    # --- the override table lies about itself
    ("M9", "override table drops one entry",
     '  { category: "Blunt", websiteSlug: "preroll", ledgerSlug: "blunt", rows: 24, valueCents: 78282 },\n', ''),
    ("M10", "override table value corrupted so the $6,900.07 total breaks",
     'rows: 47, valueCents: 268069', 'rows: 47, valueCents: 268060'),
    ("M11", "override table claims a divergence that is not one",
     '{ category: "RSO", websiteSlug: "concentrate", ledgerSlug: "rso"',
     '{ category: "RSO", websiteSlug: "rso", ledgerSlug: "rso"'),

    # --- refusals turned into silent fallbacks (the whole point of the module)
    ("M12", "unknown category falls back to concentrate instead of refusing",
     '''      return {
        ok: false,
        code: "CATEGORY_UNKNOWN",''',
     '''      return {
        ok: true,
        matchedKey: name,
        slug: "concentrate",
        accountCode: "20140",
        foldedCase: false,
      } as unknown as LedgerCategoryResolution;
      return {
        ok: false,
        code: "CATEGORY_UNKNOWN",'''),
    ("M13", "empty category accepted instead of refused",
     'if (name.length === 0) {', 'if (name.length === -1) {'),
    ("M14", "null category accepted instead of refused",
     'if (rawCategory === null || rawCategory === undefined) {',
     'if (rawCategory === undefined && rawCategory === null) {'),
    ("M15", "ambiguous case-fold picks the first hit instead of refusing",
     'if (distinct.size > 1) {', 'if (distinct.size > 99) {'),
    ("M15b", "ambiguity refusal downgraded to a silent pick of the last hit",
     '    slug = hits[0].slug;\n    matchedKey = hits[0].key;',
     '    slug = hits[hits.length - 1].slug;\n    matchedKey = hits[hits.length - 1].key;'),
    ("M15c", "the ambiguity message no longer lists the disagreeing entries",
     'const listed = hits.map((h) => h.key + " -> " + h.slug).join("; ");',
     'const listed = "";'),
    ("M16", "unknown category message no longer names the category",
     '''          'Category "' +
          name +
          '" is not in the ledger category map.''',
     '''          'Category "' +
          "" +
          '" is not in the ledger category map.'''),

    # --- InventoryType rule: Category must win
    ("M17", "InventoryType becomes a routing key when Category is missing",
     '  const byCategory = resolveLedgerCategory(input.category);',
     '''  const byCategory = resolveLedgerCategory(input.category);
  if (!byCategory.ok && typeof input.inventoryType === "string" && input.inventoryType.length > 0) {
    const alt = resolveLedgerCategory(input.inventoryType);
    if (alt.ok) return alt;
  }'''),
    ("M18", "InventoryType overrides a perfectly good Category",
     '  if (byCategory.ok) return byCategory;',
     '''  if (byCategory.ok && typeof input.inventoryType !== "string") return byCategory;
  if (byCategory.ok) {
    const alt = resolveLedgerCategory(input.inventoryType);
    return alt.ok ? alt : byCategory;
  }'''),
    ("M19", "the InventoryType refusal message loses the account numbers",
     "'" + '" was supplied, but InventoryType is not a routing key. Infused Pre-roll carries ' + "'",
     "'" + '" was supplied. Refusing. ' + "'"),
    ("M20", "InventoryType refusal downgraded to CATEGORY_MISSING",
     'code: "INVENTORY_TYPE_IS_NOT_A_KEY",', 'code: "CATEGORY_MISSING",'),

    # --- normalization
    ("M21", "whitespace normalization stops collapsing interior runs",
     'return raw.replace(/[\\s\\u00a0]+/g, " ").trim();', 'return raw.trim();'),
    ("M22", "case folding removed entirely",
     'if (key.toLowerCase() === lower) hits.push({ key, slug: map[key] });',
     'if (key === lower) hits.push({ key, slug: map[key] });'),
    ("M23", "foldedCase always reports false",
     '    foldedCase = true;', '    foldedCase = false;'),
    ("M24", "matchedKey reports the caller's string instead of the real key",
     '    matchedKey = hits[0].key;', '    matchedKey = lower;'),
    ("M25", "prototype keys become reachable via bracket access",
     'const exact = Object.prototype.hasOwnProperty.call(map, name) ? map[name] : undefined;',
     'const exact = map[name] as string | undefined;'),

    # --- slot table drift
    ("M26", "a slot number drifts, breaking parity with coa-core",
     '{ slug: "rso", slot: 150 },', '{ slug: "rso", slot: 155 },'),
    ("M27", "a slug is renamed, breaking parity with coa-core",
     '{ slug: "infused-blunt", slot: 100 },', '{ slug: "infused-blunts", slot: 100 },'),
    ("M28", "a slot row is dropped entirely",
     '  { slug: "tincture", slot: 180 },\n', ''),
    ("M29", "SLUG_HAS_NO_ACCOUNT guard made unreachable",
     '  if (accountCode === null) {', '  if (accountCode === null && slug === "\\u0000never") {'),
    ("M29b", "a dangling slug posts the concentrate account instead of refusing",
     '''      code: "SLUG_HAS_NO_ACCOUNT",''',
     '''      code: "CATEGORY_UNKNOWN",'''),
    ("M29c", "resolveLedgerCategory ignores its map argument and always reads the shipped map",
     '  return resolveLedgerCategoryIn(LEDGER_CATEGORY_MAP, rawCategory);',
     '  return resolveLedgerCategoryIn({ ...LEDGER_CATEGORY_MAP, Ghost: "nope" }, rawCategory);'),
    ("M29d", "the parameterised resolver secretly reads the module map instead of its argument",
     '    for (const key of Object.keys(map)) {\n      if (key.toLowerCase() === lower) hits.push({ key, slug: map[key] });',
     '    for (const key of Object.keys(LEDGER_CATEGORY_MAP)) {\n      if (key.toLowerCase() === lower) hits.push({ key, slug: LEDGER_CATEGORY_MAP[key] });'),

    # --- honest counts
    ("M30", "the measured-count constant is falsified",
     'export const MEASURED_CATEGORY_COUNT = 52;', 'export const MEASURED_CATEGORY_COUNT = 53;'),
    ("M31", "the unstocked-category disclosure is emptied",
     'export const UNSTOCKED_MAPPED_CATEGORIES: readonly string[] = ["Trim"] as const;',
     'export const UNSTOCKED_MAPPED_CATEGORIES: readonly string[] = [] as const;'),
    ("M32", "target-account collection silently skips unmapped slugs",
     '    if (code !== null) out.add(code);', '    if (code !== null && code !== "20150") out.add(code);'),
    ("M33", "a real category is quietly dropped from the map",
     '  "Infused Pre-roll": "infused-preroll",\n', ''),
    ("M34", "a category is aliased to the quarantine-adjacent wrong family",
     '  "Moon Rocks": "infused-flower",', '  "Moon Rocks": "flower",'),
]


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def run_tests():
    r = subprocess.run(
        ["npx", "vitest", "run", TEST, "--reporter=dot"],
        cwd=REPO, capture_output=True, text=True, timeout=600,
    )
    return r.returncode == 0


def run_selftests():
    r = subprocess.run(
        ["npx", "tsx", "scripts/compliance/run-pure-selftests.ts"],
        cwd=REPO, capture_output=True, text=True, timeout=900,
    )
    return r.returncode == 0


def main():
    # RAIL 1: lockfile.
    try:
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
    except FileExistsError:
        print("LOCKFILE EXISTS -- another campaign may be running. Refusing to start.")
        print("If you are certain none is, delete " + LOCK)
        return 1

    try:
        with open(TARGET, "r") as f:
            original = f.read()
        original_hash = sha(TARGET)
        print("original sha256: " + original_hash)

        # RAIL 2: pattern pre-validation, ALL of them, before anything changes.
        print("\n--- validating %d patterns against the pristine original" % len(MUTANTS))
        bad = []
        seen = set()
        for mid, desc, old, new in MUTANTS:
            if mid in seen:
                bad.append((mid, "DUPLICATE MUTANT ID"))
            seen.add(mid)
            n = original.count(old)
            if n != 1:
                bad.append((mid, "pattern matches %d times, need exactly 1" % n))
            if old == new:
                bad.append((mid, "mutation is a no-op"))
        if bad:
            print("PATTERN VALIDATION FAILED -- refusing to run. Rule 48.")
            for mid, why in bad:
                print("   %-5s %s" % (mid, why))
            return 1
        print("all %d patterns match exactly once." % len(MUTANTS))

        # RAIL 3: baseline must be green.
        print("\n--- baseline")
        if not run_tests():
            print("BASELINE IS RED -- refusing to run a campaign. Every mutant would 'die' for the wrong reason.")
            return 1
        if not run_selftests():
            print("BASELINE SELF-TESTS ARE RED -- refusing to run.")
            return 1
        print("baseline green (vitest + pure self-tests).")

        dead, survivors = [], []
        for i, (mid, desc, old, new) in enumerate(MUTANTS, 1):
            mutated = original.replace(old, new, 1)
            if mutated == original:
                print("HALT: %s produced no change at apply time." % mid)
                return 1
            with open(TARGET, "w") as f:
                f.write(mutated)

            killed_by = None
            if not run_tests():
                killed_by = "vitest"
            elif not run_selftests():
                killed_by = "self-tests"

            # RAIL 4: sha256-verified restore, every single time.
            with open(TARGET, "w") as f:
                f.write(original)
            if sha(TARGET) != original_hash:
                print("HALT: restore did not reproduce the original after %s." % mid)
                return 1

            if killed_by:
                dead.append((mid, desc, killed_by))
                print("[%2d/%d] %-5s DEAD (%-10s) %s" % (i, len(MUTANTS), mid, killed_by, desc))
            else:
                survivors.append((mid, desc))
                print("[%2d/%d] %-5s *** SURVIVED ***  %s" % (i, len(MUTANTS), mid, desc))

        # RAIL 5: final hash.
        if sha(TARGET) != original_hash:
            print("HALT: final file does not match the original.")
            return 1

        print("\n" + "=" * 72)
        print("RESULT: %d mutants, %d dead, %d survivors" % (len(MUTANTS), len(dead), len(survivors)))
        print("final sha256 matches original: %s" % (sha(TARGET) == original_hash))
        if survivors:
            print("\nSURVIVORS -- each is either untested behaviour or decoration (rule 43):")
            for mid, desc in survivors:
                print("   %-5s %s" % (mid, desc))
        print("=" * 72)
        return 0 if not survivors else 2
    finally:
        if os.path.exists(LOCK):
            os.remove(LOCK)


if __name__ == "__main__":
    sys.exit(main())
