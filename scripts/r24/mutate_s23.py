#!/usr/bin/env python3
"""
Round 24 mutation testing for the S23 follow-up: transform.ts
genericDescription delegates to golden-record-core boilerplateDescription().

Owner (verbatim): "Follow the standing rules and never guess, never assume.
Test it, test the tests."

Each mutant BREAKS one rule; the suites must FAIL:
  A - transform.ts delegation (args swapped, brand dropped, inline drift,
      fallback bypassed, the real copy no longer preferred)
  B - golden-record-core placeholder (tail wording, " from " joiner, blank
      brand handling, recogniser)
Same discipline as scripts/r24/mutate.py: every anchor appears exactly once,
the baseline must be green, and every file is restored afterwards.
"""
import signal
import subprocess
import sys

TR = "src/lib/pos/transform.ts"
GR = "src/lib/catalog/golden-record-core.ts"
DELEG = "function genericDescription(group: ProductGroup) { return boilerplateDescription(group.displayName, group.brand); }"

MUTANTS = [
    # ==================================================================== A ==
    ("transform: args swapped", TR, DELEG, DELEG.replace("(group.displayName, group.brand)", "(group.brand, group.displayName)")),
    ("transform: brand dropped", TR, DELEG, DELEG.replace("(group.displayName, group.brand)", "(group.displayName, null)")),
    ("transform: strain name instead of display name", TR, DELEG, DELEG.replace("(group.displayName,", "(group.strainName,")),
    ("transform: inline copy drifts back", TR, DELEG,
     "function genericDescription(group: ProductGroup) { return `${group.displayName} by ${group.brand}. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.`; }"),
    ("transform: inline copy, same words (one source broken)", TR, DELEG,
     "function genericDescription(group: ProductGroup) { return `${group.displayName} from ${group.brand}. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.`; }"),
    ("transform: fallback bypassed (empty description)", TR,
     "description: group.descriptions.sort((a, b) => b.length - a.length)[0] ?? genericDescription(group),",
     "description: group.descriptions.sort((a, b) => b.length - a.length)[0] ?? \"\","),
    ("transform: placeholder beats real copy", TR,
     "description: group.descriptions.sort((a, b) => b.length - a.length)[0] ?? genericDescription(group),",
     "description: genericDescription(group),"),
    # ==================================================================== B ==
    ("golden: tail wording drifts", GR,
     '  ". Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.";',
     '  ". Browse current availability, package options and pricing at Greenway Marijuana in Port Orchard.";'),
    ("golden: joiner 'by' not 'from'", GR, "${b ? ` from ${b}` : \"\"}", "${b ? ` by ${b}` : \"\"}"),
    ("golden: brand not trimmed", GR, "  const b = String(brand ?? \"\").trim();\n  return `${display}", "  const b = String(brand ?? \"\");\n  return `${display}"),
    ("golden: recogniser says nothing is boilerplate", GR,
     "  return t.endsWith(BOILERPLATE_TAIL.trim());", "  return false;"),
]

SUITES = [
    "tests/compliance/r24-s23-transform-boilerplate.test.ts",
    "tests/compliance/s23-gap-vector.test.ts",
    "tests/compliance/s12-golden-record.test.ts",
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

print("BASELINE: the suites must be green before we break anything")
r = run_suites()
if r.returncode != 0:
    print("ABORT - baseline is already failing.")
    print(r.stdout[-3000:])
    sys.exit(1)
print("  OK - baseline green\n")


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
        write(path, originals[path])
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
