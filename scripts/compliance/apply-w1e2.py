#!/usr/bin/env python3
"""SLICE W1e (part 2) -- excise the 3 remaining equivalent mutants by LOCATING
their tuples structurally, rather than by re-typing deeply-escaped literals.

Why this approach: the mutation tuples contain regex source that is escaped
twice (once for Python, once for the TS template literal). Hand-retyping those
literals as anchors failed the count==1 assertion -- correctly. So the tuples
are located by their unique NAME line and removed as whole balanced tuples,
which needs no escaping at all.
"""
import io
import sys

H = "scripts/compliance/mutate-w1.py"

# Unique substrings of the NAME line of each tuple to remove, plus what to
# leave behind in its place.
TARGETS = [
    ("core: put the decimal alternative FIRST",
     "    # (an 'alternation order' mutant lived here; proven EQUIVALENT -- see docstring)\n"),
    ("core: allow a zero denominator",
     "    # (a lone 'zero denominator' mutant lived here; EQUIVALENT alone)\n"),
    ("core: accept zero / negative quantities",
     '''    # --- the guards are redundant SINGLY but not JOINTLY (measured) -------
    (
        "core: remove BOTH numeric guards ('0g' -> 0 instead of null)",
        CORE,
        "  if (qty === null || !Number.isFinite(qty) || qty <= 0) return null;",
        "  if (qty === null) return null;",
    ),
'''),
    ("core: stop guarding the final grams value",
     '''    (
        "core: unguard grams AND accept a zero denominator ('1/0 oz' -> Infinity)",
        CORE,
        "  if (!Number.isFinite(grams) || grams <= 0) return null;",
        "  if (!Number.isFinite(grams)) return null;",
    ),
'''),
]


def remove_tuple(lines, name_fragment, replacement):
    """Find the tuple whose name line contains name_fragment; replace it."""
    idx = [i for i, ln in enumerate(lines) if name_fragment in ln]
    if len(idx) != 1:
        return None, f"expected 1 name line for {name_fragment!r}, found {len(idx)}"
    i = idx[0]
    # The tuple opens on the preceding line that is exactly "    (".
    start = None
    for j in range(i - 1, max(-1, i - 5), -1):
        if lines[j].rstrip() == "    (":
            start = j
            break
    if start is None:
        return None, f"could not find the opening paren for {name_fragment!r}"
    # It closes at the next line that is exactly "    ),".
    end = None
    for j in range(i, min(len(lines), i + 15)):
        if lines[j].rstrip() == "    ),":
            end = j
            break
    if end is None:
        return None, f"could not find the closing paren for {name_fragment!r}"
    return lines[:start] + [replacement] + lines[end + 1:], None


with io.open(H, encoding="utf-8") as f:
    text = f.read()

# Idempotency: decided by the presence of the replacement marker.
if "core: remove BOTH numeric guards" in text:
    print("  = already applied (combined-guard mutants present)")
    sys.exit(0)

lines = text.splitlines(keepends=True)
for frag, repl in TARGETS:
    lines, err = remove_tuple(lines, frag, repl)
    if err:
        print(f"  !! {err}")
        sys.exit(1)
    print(f"  + excised: {frag}")

out = "".join(lines)
with io.open(H, "w", encoding="utf-8") as f:
    f.write(out)

with io.open(H, encoding="utf-8") as f:
    back = f.read()
assert "core: remove BOTH numeric guards" in back, "write did not land"
assert "core: put the decimal alternative FIRST" not in back, "equivalent mutant survived the excision"
assert "core: accept zero / negative quantities" not in back, "excision incomplete"
print("\nverified on disk. Syntax check:")
