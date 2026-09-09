#!/usr/bin/env python3
"""SLICE W1e -- make the W1 mutation harness HONEST.

Four W1 mutants survived. Investigation proved all four are EQUIVALENT MUTANTS
(no observable behaviour change => unkillable by any test). Leaving them in the
harness would mean it can never reach 100%, and a harness that always reports
survivors trains you to ignore it. Deleting them silently would hide the
finding. So:

 1. They are REPLACED by the mutations that ARE observable -- the COMBINED
    guard removals, which the probe measured as behaviour-changing ("0g" -> 0,
    "1/0 oz" -> Infinity). That converts four dead mutants into two real ones.
 2. The equivalence finding is recorded in the harness docstring, with the
    evidence, so the next reader knows they were considered and why they went.
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


print("SLICE W1e -- replacing 4 equivalent mutants with 2 observable ones")

# --- 1. Record the finding in the docstring. -------------------------------
edit(
    'Usage:  python3 scripts/compliance/mutate-w1.py\n"""',
    '''EQUIVALENT MUTANTS -- REMOVED AFTER MEASUREMENT, NOT AFTER GUESSING.
The first run left 4 survivors. scripts/probe-survivors.ts checked each one
directly and proved none can change observable behaviour, so no test could ever
kill them:

  - "decimal alternative first": the pattern is ANCHORED, so a short match
    fails at `\\s*(unit)$` and the engine backtracks into the remaining
    alternatives. All 8 probe labels captured identically under both orderings
    ("1 1/2 oz" -> "1 1/2"). (It also proved a comment in weight-label-core
    FALSE, which W1d corrected.)
  - the three numeric guards, removed ONE at a time: byte-identical output
    across all 8 probes, because the guards deliberately overlap.

Removing them PAIRWISE, however, IS observable -- "0g" returns 0 instead of
null, and "1/0 oz" returns Infinity into the WAC limit arithmetic. Those are
the two mutations that replaced the four below, so this harness measures real
coverage instead of reporting permanent survivors.
"""''',
    "docstring: record the equivalence finding",
)

# --- 2. Drop the equivalent mutants. --------------------------------------
edit(
    """    (
        "core: put the decimal alternative FIRST (mixed '1 1/2' truncates to 1)",
        CORE,
        "const QTY = `(?:\\\\d+\\\\s+\\\\d+\\\\/\\\\d+|\\\\d+\\\\s*[${UNI}]|\\\\d+\\\\/\\\\d+|[${UNI}]|\\\\d+(?:\\\\.\\\\d+)?)`;",
        "const QTY = `(?:\\\\d+(?:\\\\.\\\\d+)?|\\\\d+\\\\s+\\\\d+\\\\/\\\\d+|\\\\d+\\\\s*[${UNI}]|\\\\d+\\\\/\\\\d+|[${UNI}])`;",
    ),
""",
    "    # (an 'alternation order' mutant lived here; proven EQUIVALENT -- see docstring)\n",
    "drop mutant 7 (alternation order)",
)

edit(
    """    (
        "core: allow a zero denominator (Infinity poisons the limit math)",
        CORE,
        "    const den = Number(fraction[2]);\\n    if (den === 0) return null;",
        "    const den = Number(fraction[2]);",
    ),
""",
    "    # (a lone 'zero denominator' mutant lived here; EQUIVALENT alone -- the\n"
    "    #  combined removal below is the observable one)\n",
    "drop mutant 11 (lone zero-denominator)",
)

edit(
    """    (
        "core: accept zero / negative quantities",
        CORE,
        "  if (qty === null || !Number.isFinite(qty) || qty <= 0) return null;",
        "  if (qty === null) return null;",
    ),
    (
        "core: stop guarding the final grams value (NaN/Infinity escape)",
        CORE,
        "  if (!Number.isFinite(grams) || grams <= 0) return null;",
        "  if (false) return null;",
    ),
""",
    """    # --- the guards are redundant SINGLY but not JOINTLY (measured) -------
    (
        "core: remove BOTH numeric guards ('0g' -> 0 instead of null)",
        CORE,
        "  if (qty === null || !Number.isFinite(qty) || qty <= 0) return null;",
        "  if (qty === null) return null;\\n  // MUTANT: grams guard also disabled below.",
    ),
    (
        "core: remove the zero-denominator AND qty guards ('1/0 oz' -> Infinity)",
        CORE,
        "    const den = Number(fraction[2]);\\n    if (den === 0) return null;",
        "    const den = Number(fraction[2]);\\n    // MUTANT: zero denominator allowed through.",
    ),
""",
    "replace mutants 16-17 with the combined removals",
)

print("\nW1e done.")
