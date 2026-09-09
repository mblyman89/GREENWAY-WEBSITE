#!/usr/bin/env python3
"""SLICE C1 MUTATION HARNESS -- tests the tests.

C1 is the clearance / vendor-day markdown lock: an item marked down because it
is old or about to expire is OUT of every other sale, and the markdown applies
whether or not it happens to be the deeper number. This is the owner's rule --
"Those items are excluded from any and all other sales/daily deals" -- and it
is the slice that was blocking the 50% clearance from going live.

Every mutation below is a way that rule could plausibly be broken by a careless
edit. A mutation that SURVIVES means the tests would not have noticed the
store either giving away margin it never authorised or advertising a clearance
price it does not honour. When that happens the TESTS get fixed, never the
mutation, and never by deleting it.

Each `edit` is a LIST of (old, new) pairs so a mutation can remove a group of
jointly-redundant guards at once -- a single-edit harness cannot kill
redundancy (learned on SLICE W1, re-confirmed on T1's near-miss guards).

Every edit asserts `count == 1` on its anchor before applying, and the tree is
restored from an in-memory snapshot in a `finally`, so a crash can never leave
the working tree mutated.
"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOCK = ROOT / "src/lib/promotions/markdown-lock-core.ts"
ENGINE = ROOT / "src/lib/promotions/discount-engine-core.ts"
PUB = ROOT / "src/lib/promotions/published-rules-core.ts"

TESTS = [
    "tests/compliance/markdown-lock.test.ts",
    "tests/compliance/pure-selftests.test.ts",
]

MUTATIONS = [
    # ---- isMarkdownRule: what COUNTS as a markdown ------------------------
    # Too loose and ordinary deals start locking lines out of other deals;
    # too tight and clearance stops protecting anything at all.
    ("flag: every rule is a markdown", LOCK, [
        ('  return rule.config?.markdownOnly === true;',
         '  return true;')]),
    ("flag: no rule is ever a markdown (feature off)", LOCK, [
        ('  return rule.config?.markdownOnly === true;',
         '  return false;')]),
    ("flag: truthy instead of === true (jsonb \"false\" locks)", LOCK, [
        ('  return rule.config?.markdownOnly === true;',
         '  return Boolean(rule.config?.markdownOnly);')]),
    ("flag: === false (inverted)", LOCK, [
        ('  return rule.config?.markdownOnly === true;',
         '  return rule.config?.markdownOnly === false;')]),

    # ---- computeMarkdownLock: WHICH lines get locked -----------------------
    ("lock: locks every line, not just matched ones", LOCK, [
        ('      if (matches(rule, line)) lockedLineIds.add(line.lineId);',
         '      lockedLineIds.add(line.lineId);')]),
    ("lock: locks nothing", LOCK, [
        ('      if (matches(rule, line)) lockedLineIds.add(line.lineId);',
         '      if (false) lockedLineIds.add(line.lineId);')]),
    ("lock: ignores the markdown flag when collecting rules", LOCK, [
        ('    if (!isMarkdownRule(rule)) continue;\n    markdownRuleIds.add(rule.id);',
         '    markdownRuleIds.add(rule.id);')]),
    ("lock: records rule ids but never the lines", LOCK, [
        ('      if (matches(rule, line)) lockedLineIds.add(line.lineId);',
         '      if (matches(rule, line)) void line;')]),
    ("lock: hasLock always true (empty sweep freezes the day)", LOCK, [
        ('hasLock: lockedLineIds.size > 0 };',
         'hasLock: true };')]),
    ("lock: hasLock always false (lock never engages)", LOCK, [
        ('hasLock: lockedLineIds.size > 0 };',
         'hasLock: false };')]),
    ("lock: markdownRuleIds left empty (deeper-markdown compare breaks)", LOCK, [
        ('    markdownRuleIds.add(rule.id);', '    void rule.id;')]),

    # ---- linesVisibleToRule: WHO can see a locked line ---------------------
    ("visible: everyone sees everything (no exclusion)", LOCK, [
        ('  if (!lock.hasLock) return lines;\n  if (isMarkdownRule(rule)) return lines;',
         '  return lines;\n  if (isMarkdownRule(rule)) return lines;')]),
    ("visible: markdown rules cannot see their own lines", LOCK, [
        ('  if (isMarkdownRule(rule)) return lines;', '  if (false) return lines;')]),
    ("visible: NON-markdown rules see only the locked lines (inverted)", LOCK, [
        ('  return lines.filter((l) => !lock.lockedLineIds.has(l.lineId));',
         '  return lines.filter((l) => lock.lockedLineIds.has(l.lineId));')]),
    ("visible: returns nothing at all", LOCK, [
        ('  return lines.filter((l) => !lock.lockedLineIds.has(l.lineId));',
         '  return [];')]),

    # ---- the WIRING in the engine -----------------------------------------
    # The lock is worthless if the engine does not consult it.
    ("wiring: main loop ignores the lock", ENGINE, [
        ('    const visible = linesVisibleToRule(rule, lines, markdownLock);',
         '    const visible = lines;')]),
    ("wiring: basket pre-pass ignores the lock", ENGINE, [
        ('      const rivalLines = linesVisibleToRule(rule, lines, markdownLock);',
         '      const rivalLines = lines;')]),
    ("wiring: markdown loses to a deeper ordinary deal (the D defect)", ENGINE, [
        ('      const takeIt = ruleIsMarkdown && !currentIsMarkdown\n        ? true\n        : newSavingsPerUnit > current.unitSavingsMinorUnits;',
         '      const takeIt = newSavingsPerUnit > current.unitSavingsMinorUnits;')]),
    ("wiring: markdown ALWAYS wins, even over a deeper markdown", ENGINE, [
        ('      const takeIt = ruleIsMarkdown && !currentIsMarkdown\n        ? true\n        : newSavingsPerUnit > current.unitSavingsMinorUnits;',
         '      const takeIt = ruleIsMarkdown\n        ? true\n        : newSavingsPerUnit > current.unitSavingsMinorUnits;')]),
    ("wiring: currentIsMarkdown always false (markdown overwrites markdown)", ENGINE, [
        ('      const currentIsMarkdown = current.appliedRuleId != null\n        && markdownLock.markdownRuleIds.has(current.appliedRuleId);',
         '      const currentIsMarkdown = false;')]),
    ("wiring: currentIsMarkdown always true (first markdown sticks)", ENGINE, [
        ('      const currentIsMarkdown = current.appliedRuleId != null\n        && markdownLock.markdownRuleIds.has(current.appliedRuleId);',
         '      const currentIsMarkdown = true;')]),
    # NOTE: "empty-visible short-circuit removed" is a PROVEN EQUIVALENT
    # MUTANT and is listed in EQUIVALENT_MUTANTS below instead of here.
    # `if (visible.length === 0) continue` is a performance guard, not a
    # behavioural one: applyOnePromotion's own first act is
    # `eligible = lines.filter(...); if (eligible.length === 0) return out;`
    # with no side effect before it, so an empty `visible` yields an empty
    # map and the loop body never executes. 105 differential scenarios
    # (scripts/probe-c1-s2b.py) found zero witnesses, matching the proof.

    # ---- the PARSER: the flag has to survive publish -----------------------
    ("parse: markdownOnly never parsed off a published rule", PUB, [
        ('  if (c.markdownOnly === true) out.markdownOnly = true;',
         '  if (false) out.markdownOnly = true;')]),
    ("parse: markdownOnly forced on for every rule", PUB, [
        ('  if (c.markdownOnly === true) out.markdownOnly = true;',
         '  out.markdownOnly = true;')]),
    ("parse: truthy accepted (string \"false\" would lock)", PUB, [
        ('  if (c.markdownOnly === true) out.markdownOnly = true;',
         '  if (c.markdownOnly) out.markdownOnly = true;')]),

    # ---- multi-edit: jointly-redundant guards ------------------------------
    # linesVisibleToRule's two early returns overlap: with hasLock false the
    # filter is a no-op anyway. Remove BOTH so neither can hide the other.
    ("multi: drop BOTH early returns in linesVisibleToRule", LOCK, [
        ('  if (!lock.hasLock) return lines;', '  if (false) return lines;'),
        ('  if (isMarkdownRule(rule)) return lines;', '  if (false) return lines;'),
    ]),
    # Revert the whole engine wiring at once -- the "someone rolled C1 back"
    # scenario. Nothing about the lock module changes, so only an end-to-end
    # test through computePromotions can notice.
    ("multi: revert the ENTIRE engine wiring (lock computed, never used)", ENGINE, [
        ('    const visible = linesVisibleToRule(rule, lines, markdownLock);',
         '    const visible = lines;'),
        ('      const rivalLines = linesVisibleToRule(rule, lines, markdownLock);',
         '      const rivalLines = lines;'),
        ('      const takeIt = ruleIsMarkdown && !currentIsMarkdown\n        ? true\n        : newSavingsPerUnit > current.unitSavingsMinorUnits;',
         '      const takeIt = newSavingsPerUnit > current.unitSavingsMinorUnits;'),
    ]),
]

# ---------------------------------------------------------------------------
# EQUIVALENT MUTANTS -- kept and documented, never scored, never deleted.
#
# An equivalent mutant produces a program that behaves identically on every
# reachable input, so no test can kill it; scoring it would make 100%
# unreachable and would tempt someone to weaken the definition instead.
# ---------------------------------------------------------------------------
EQUIVALENT_MUTANTS = [
    ("wiring: empty-visible short-circuit removed",
     "`if (visible.length === 0) continue` is a performance guard. "
     "applyOnePromotion opens with `eligible = lines.filter(...); if "
     "(eligible.length === 0) return out;` and performs no side effect before "
     "it, so an empty input returns an empty map and the loop body never "
     "runs. 105 differential scenarios found zero witnesses."),
]


def run_tests() -> bool:
    r = subprocess.run(
        ["npx", "vitest", "run", *TESTS],
        cwd=ROOT, capture_output=True, text=True,
    )
    return r.returncode == 0


def main() -> int:
    files = {LOCK, ENGINE, PUB}
    snapshot = {f: f.read_text() for f in files}

    print("Baseline (unmutated) must PASS ...", flush=True)
    if not run_tests():
        print("BASELINE FAILED -- fix the tree before mutating.")
        return 1
    print("  baseline OK\n", flush=True)

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
            print(f"  {i:>2}. SURVIVED  {name}", flush=True)
        else:
            caught += 1
            print(f"  {i:>2}. caught    {name}", flush=True)

    total = len(MUTATIONS)
    print(f"\nC1 mutation score: {caught}/{total} caught")
    print(f"({len(EQUIVALENT_MUTANTS)} further mutation(s) PROVEN EQUIVALENT "
          "and excluded from scoring:)")
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
