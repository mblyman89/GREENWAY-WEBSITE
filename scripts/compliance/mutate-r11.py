#!/usr/bin/env python3
"""
scripts/compliance/mutate-r11.py

TEST THE TESTS for standing rule 11 (receiving intake is the real pipeline).

A green suite proves nothing until you prove it can go red. Each mutation below
breaks the receiving brand resolver — or reverts it to the pre-fix behaviour —
and the suite MUST catch every one. A survivor is a hole in the tests.

Method (identical to mutate-t1.py / mutate-c1.py):
  * every anchor is asserted to appear EXACTLY once before it is replaced, so a
    mutation can never silently no-op and be scored as "killed";
  * `edit` is a LIST of (old, new) pairs, because a single edit cannot kill
    jointly-redundant guards;
  * the tree is restored from an IN-MEMORY snapshot in a `finally` block.

Run:  python3 -u scripts/compliance/mutate-r11.py
"""
import io
import subprocess
import sys

CORE = "src/lib/inventory/brand-resolve-core.ts"
STORE = "src/lib/inventory/intake-store.ts"
AGENTS = "AGENTS.md"
DOC = "docs/RECEIVING-IS-THE-REAL-PIPELINE.md"
CULTI = "src/lib/purchasing/cultivera-menu-core.ts"

TESTS = [
    "tests/compliance/receiving-is-the-real-pipeline.test.ts",
    "tests/compliance/pure-selftests.test.ts",
]

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- the squeezed path: the entire point of the fix -------------------
    ("core: squeezed path removed (revert to ILIKE-only)", [
        (CORE, "  if (hits.length === 1) {", "  if (false as boolean) {"),
    ]),
    ("core: squeeze uses raw lowercase instead of brandKey", [
        (CORE, "    const rowKey = brandKey(row.display_name);",
               "    const rowKey = (row.display_name ?? '').toLowerCase();"),
        (CORE, "  const key = brandKey(raw);", "  const key = raw.toLowerCase();"),
    ]),
    ("core: brandKey replaced by trim/lowercase (the OLD five-copy rule)", [
        (CORE, "  const key = brandKey(raw);", "  const key = raw.trim().toLowerCase();"),
        (CORE, "    const rowKey = brandKey(row.display_name);",
               "    const rowKey = (row.display_name ?? '').trim().toLowerCase();"),
    ]),
    # ---- the ambiguity guard: protects inventory ownership ---------------
    ("core: ambiguous squeeze silently takes the first hit", [
        (CORE, "  if (hits.length === 1) {", "  if (hits.length >= 1) {"),
    ]),
    ("core: ambiguity reported but id still guessed", [
        (CORE, "  return outcome.kind === \"exact\" || outcome.kind === \"squeezed\" ? outcome.brandId : null;",
               "  return outcome.kind === \"exact\" || outcome.kind === \"squeezed\" ? outcome.brandId : (outcome.kind === \"ambiguous\" ? outcome.candidates[0].id : null);"),
    ]),
    ("core: ambiguous reason loses the AMBIGUOUS marker", [
        (CORE, "      return `AMBIGUOUS: \"${outcome.label}\" squeezes to",
               "      return `note: \"${outcome.label}\" squeezes to"),
    ]),
    ("core: ambiguous reason stops naming the candidates", [
        (CORE, "        .map((c) => `${c.display_name ?? \"?\"}`)", "        .map(() => \"?\")"),
    ]),
    ("core: distinct-id collapse dropped (dup rows become ambiguous)", [
        (CORE, "    if (byId.size === 1) {", "    if (false as boolean) {"),
    ]),
    # ---- blank / junk handling -------------------------------------------
    ("core: blank label no longer short-circuits", [
        (CORE, "  if (!raw) return { kind: \"no-label\" };", "  if (false) return { kind: \"no-label\" };"),
    ]),
    ("core: punctuation-only label allowed to match", [
        (CORE, "  if (!key) return { kind: \"miss\", label: raw };", "  if (false) return { kind: \"miss\", label: raw };"),
    ]),
    ("core: blank brand rows allowed to match", [
        (CORE, "    return rowKey !== \"\" && rowKey === key;", "    return rowKey === key;"),
    ]),
    # ---- the exact fast path must not regress ----------------------------
    ("core: ilikeExact becomes case-SENSITIVE", [
        (CORE, "  return a.toLowerCase() === b.toLowerCase();", "  return a === b;"),
    ]),
    ("core: ilikeExact accepts null", [
        (CORE, "  if (a == null || b == null) return false;", "  if (a == null && b == null) return true;"),
    ]),
    ("core: exact fast path removed (ambiguous pair breaks)", [
        (CORE, "    if (ilikeExact(row.display_name, raw)) {", "    if (false as boolean) {"),
    ]),
    ("core: exact path returns the wrong row", [
        (CORE, "      return { kind: \"exact\", brandId: row.id, matched: row.display_name ?? raw };",
               "      return { kind: \"exact\", brandId: rows[0].id, matched: rows[0].display_name ?? raw };"),
    ]),
    # ---- the WIRING: does receiving actually use the core? ---------------
    ("wiring: intake-store reverts to the bare ILIKE resolver", [
        (STORE, "  return (await resolveBrandIdDetailed(admin, label, vendorId)).brandId;",
                "  if (!label) return null;\n  let q0 = admin.from(\"brands\").select(\"id, display_name, vendor_id\").ilike(\"display_name\", label).limit(1);\n  if (vendorId) q0 = q0.eq(\"vendor_id\", vendorId);\n  const { data: d0 } = await q0;\n  return ((d0 as { id: string }[] | null)?.[0])?.id ?? null;"),
    ]),
    # NOTE: an earlier version of this mutation merely RE-ALIASED the same
    # imports (`resolveBrandDecision as _rbd; const resolveBrandDecision = _rbd`)
    # and survived — correctly, because it was behaviourally IDENTICAL. That was
    # a defective mutation on my part, not a hole in the tests. Replaced with
    # one that genuinely stops delegating to the shared core.
    ("wiring: intake-store stops delegating to the shared core", [
        (STORE, "  const outcome = resolveBrandDecision(clean, rows);",
                "  const localHit = rows.find((r) => (r.display_name ?? '').toLowerCase() === clean.toLowerCase());\n  const outcome: BrandResolveOutcome = localHit ? { kind: \"exact\", brandId: localHit.id, matched: localHit.display_name ?? clean } : { kind: \"miss\", label: clean };"),
    ]),
    ("wiring: the complete paged scan is removed", [
        (STORE, "  const { rows, verdict } = await pagedAllChecked<BrandCandidate>(",
                "  const { rows, verdict } = await pagedAllCheckedRemoved<BrandCandidate>("),
    ]),
    ("wiring: an INCOMPLETE read is treated as a confident miss", [
        (STORE, "  if (!verdict.complete) {", "  if (false as boolean) {"),
    ]),
    ("wiring: an INCOMPLETE read is downgraded to a plain miss", [
        (STORE, "      kind: \"read-incomplete\",", "      kind: \"miss\" as \"read-incomplete\","),
    ]),
    ("core: read-incomplete stops denying it is a miss", [
        (CORE, "      return `READ INCOMPLETE while resolving", "      return `no brand matched"),
    ]),
    # ---- the written rule, in every required place -----------------------
    ("docs: standing rule 11 deleted from AGENTS.md", [
        (AGENTS, "**🔴 RECEIVING INTAKE IS THE ONLY WAY PRODUCTS ENTER GREENWAY.",
                 "**Receiving notes.** ONLY WAY PRODUCTS ENTER (softened).  "),
    ]),
    ("docs: rule 11 stops saying Cultivera is one-time", [
        (AGENTS, "THE CULTIVERA MENU IMPORT IS A ONE-TIME EVENT THAT WILL NEVER BE USED AGAIN.**",
                 "The Cultivera menu import is one of our pipelines.**"),
    ]),
    ("docs: the living reference loses its measured evidence", [
        (DOC, "    resolved by ILIKE (receiving intake today)   : 318  (41.2%)",
              "    resolved by ILIKE (receiving intake today)   : some"),
    ]),
    ("docs: the living reference loses the 453 number", [
        (DOC, "    MISSED by receiving, caught by brandKey      : 453",
              "    MISSED by receiving, caught by brandKey      : a few"),
    ]),
    ("docs: the reference stops naming receiving as the only door", [
        (DOC, "**RECEIVING INTAKE IS THE ONLY WAY PRODUCTS ENTER GREENWAY.** Permanently.",
              "Receiving intake is one way products enter Greenway."),
    ]),
    ("docs: a Cultivera module loses its ONE-TIME banner", [
        (CULTI, " * ONE-TIME IMPORT ONLY — THIS IS NOT HOW PRODUCTS ENTER GREENWAY.",
                " * Cultivera vendor-menu import."),
    ]),
    ("docs: intake-store loses its REAL PIPELINE banner", [
        (STORE, " * THIS IS THE REAL PIPELINE. PRODUCTS ENTER GREENWAY THROUGH RECEIVING INTAKE.",
                " * Manifest persistence."),
    ]),
    ("docs: brand-resolve-core loses its rule-11 banner", [
        (CORE, " * RECEIVING INTAKE IS THE REAL PIPELINE. CULTIVERA IS A ONE-TIME IMPORT.",
               " * Brand resolution helper."),
    ]),
]

# Mutations PROVEN to be behaviourally identical. Excluded from scoring, NEVER
# deleted (see docs/MUTATION-SURVIVOR-ANALYSIS-T1-C1.md for the precedent).
#
# "core: blank brand rows allowed to match" — PROVEN EQUIVALENT.
#   `rowKey !== ""` in the squeeze filter is JOINTLY REDUNDANT with the
#   `if (!key) return miss` early return above it. Once `key` is guaranteed
#   non-empty, `rowKey === key` can never hold for `rowKey === ""`.
#   scripts/probe-r11-s1.ts compared both versions across 3,888 scenarios that
#   actually REACH the filter: 0 differences. The same probe shows the guard
#   DOES become live in 3 scenarios if the `!key` early return is removed —
#   which is why the guard stays in the code, and why the mutation that removes
#   the early return ("core: punctuation-only label allowed to match") is
#   scored and KILLED.
EQUIVALENT_MUTANTS: list[str] = [
    "core: blank brand rows allowed to match",
]


def run_tests() -> bool:
    """True = suite GREEN (mutant survived). False = RED (mutant killed)."""
    proc = subprocess.run(
        ["npx", "vitest", "run", *TESTS],
        capture_output=True, text=True,
    )
    return proc.returncode == 0


def main() -> int:
    files = sorted({f for _, edits in MUTATIONS for f, _, _ in edits})
    snapshot = {f: io.open(f, encoding="utf-8").read() for f in files}

    print("baseline: running the suite on a CLEAN tree ...")
    if not run_tests():
        print("FATAL: the suite is RED before any mutation. Fix that first.")
        return 2
    print("baseline GREEN.\n")

    killed, survived = [], []
    try:
        for name, edits in MUTATIONS:
            if name in EQUIVALENT_MUTANTS:
                print(f"  SKIP (proven equivalent) {name}")
                continue
            # apply
            for path, old, new in edits:
                text = snapshot[path]
                count = text.count(old)
                assert count == 1, (
                    f"anchor appears {count}x (expected exactly 1) in {path} "
                    f"for mutation {name!r}:\n  {old[:110]!r}"
                )
                io.open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
            green = run_tests()
            verdict = "SURVIVED  <-- HOLE IN THE TESTS" if green else "killed"
            (survived if green else killed).append(name)
            print(f"  {verdict:34s} {name}")
            # restore before the next mutation
            for path in {f for f, _, _ in edits}:
                io.open(path, "w", encoding="utf-8").write(snapshot[path])
    finally:
        for path, text in snapshot.items():
            io.open(path, "w", encoding="utf-8").write(text)
        print("\ntree restored from in-memory snapshot.")

    scored = len(MUTATIONS) - len(EQUIVALENT_MUTANTS)
    print(f"\nMUTATION SCORE: {len(killed)}/{scored} killed")
    if EQUIVALENT_MUTANTS:
        print(f"excluded as proven-equivalent: {len(EQUIVALENT_MUTANTS)}")
    if survived:
        print("\nSURVIVORS (each is a real gap until proven equivalent):")
        for s in survived:
            print(f"  - {s}")
        return 1
    print("every mutant killed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
