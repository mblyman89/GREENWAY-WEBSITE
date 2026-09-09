#!/usr/bin/env python3
"""SLICE W1f -- teach the harness MULTI-EDIT mutations.

WHY: the two remaining survivors were a HARNESS limitation, not a test gap. The
guards in weight-label-core are redundant singly and observable only jointly
(measured), so killing them requires removing TWO lines AT ONCE. The harness
applied exactly one replacement per mutation, so my "remove BOTH" mutants
removed only one guard -- i.e. they were still the equivalent mutants the probe
had already proven unkillable.

FIX: a mutation's edit field becomes a LIST of (old, new) pairs, all applied
together. The single-edit tuples keep working (they are wrapped transparently),
so this is additive.
"""
import io

H = "scripts/compliance/mutate-w1.py"


def edit(old: str, new: str, label: str) -> None:
    with io.open(H, encoding="utf-8") as f:
        text = f.read()
    if text.count(new) == 1:
        print(f"  = already applied: {label}")
        return
    n = text.count(old)
    assert n == 1, f"{label}: expected 1 anchor, found {n}"
    with io.open(H, "w", encoding="utf-8") as f:
        f.write(text.replace(old, new, 1))
    with io.open(H, encoding="utf-8") as f:
        assert f.read().count(new) == 1, f"{label}: write did not land"
    print(f"  + applied: {label}")


print("SLICE W1f -- multi-edit mutation support")

# --- 1. The two joint mutations, as edit LISTS. ---------------------------
edit(
    """    (
        "core: remove BOTH numeric guards ('0g' -> 0 instead of null)",
        CORE,
        "  if (qty === null || !Number.isFinite(qty) || qty <= 0) return null;",
        "  if (qty === null) return null;",
    ),""",
    """    (
        "core: remove BOTH numeric guards at once ('0g' -> 0 instead of null)",
        CORE,
        [
            (
                "  if (qty === null || !Number.isFinite(qty) || qty <= 0) return null;",
                "  if (qty === null) return null;",
            ),
            (
                "  if (!Number.isFinite(grams) || grams <= 0) return null;",
                "  // MUTANT: grams guard removed too.",
            ),
        ],
    ),""",
    "joint mutant: both numeric guards",
)

edit(
    """    (
        "core: unguard grams AND accept a zero denominator ('1/0 oz' -> Infinity)",
        CORE,
        "  if (!Number.isFinite(grams) || grams <= 0) return null;",
        "  if (!Number.isFinite(grams)) return null;",
    ),""",
    """    (
        "core: unguard grams AND qty AND the zero denominator ('1/0 oz' -> Infinity)",
        CORE,
        [
            (
                "    const den = Number(fraction[2]);\\n    if (den === 0) return null;",
                "    const den = Number(fraction[2]);",
            ),
            (
                "  if (qty === null || !Number.isFinite(qty) || qty <= 0) return null;",
                "  if (qty === null) return null;",
            ),
            (
                "  if (!Number.isFinite(grams) || grams <= 0) return null;",
                "  // MUTANT: all three guards removed.",
            ),
        ],
    ),""",
    "joint mutant: all three guards",
)

# --- 2. The runner: accept a list or a single pair. -----------------------
edit(
    """    caught, survived = 0, []
    for i, (name, path, old, new) in enumerate(MUTATIONS, start=1):
        with io.open(path, encoding="utf-8") as f:
            original = f.read()
        if original.count(old) != 1:
            print(f"[{i:2}/{len(MUTATIONS)}] SKIP (anchor {original.count(old)}x): {name}")
            survived.append(f"{name}  [BAD ANCHOR]")
            continue
        with io.open(path, "w", encoding="utf-8") as f:
            f.write(original.replace(old, new, 1))""",
    """    caught, survived = 0, []
    for i, (name, path, spec, *rest) in enumerate(MUTATIONS, start=1):
        # A mutation carries EITHER a single (old, new) pair -- passed as two
        # trailing fields -- OR a list of pairs applied TOGETHER. Joint edits
        # exist because some guards in this module are redundant singly and
        # observable only in combination (measured, see docstring), so a
        # one-line mutation of them is an unkillable equivalent mutant.
        edits = spec if isinstance(spec, list) else [(spec, rest[0])]
        with io.open(path, encoding="utf-8") as f:
            original = f.read()
        bad = [o for o, _ in edits if original.count(o) != 1]
        if bad:
            print(f"[{i:2}/{len(MUTATIONS)}] SKIP (bad anchor): {name}")
            survived.append(f"{name}  [BAD ANCHOR]")
            continue
        mutated = original
        for o, nw in edits:
            mutated = mutated.replace(o, nw, 1)
        with io.open(path, "w", encoding="utf-8") as f:
            f.write(mutated)""",
    "runner: multi-edit support",
)

print("\nW1f done.")
