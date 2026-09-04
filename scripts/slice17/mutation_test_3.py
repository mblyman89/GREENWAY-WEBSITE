#!/usr/bin/env python3
"""SLICE 17 — MUTATION TESTING, ROUND 3 (the remainder).

Round 2 killed 10 of 11 and was hard-killed by the sandbox supervisor during
mutant 11. This round runs ONLY the outstanding mutant plus the two intake
mutants that round 1 covered before the parser was rebuilt, so that every
assertion in the slice has a proven kill after the file recovery.

Uses the same crash-safe sentinel + backup machinery as round 2.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FACTS = "src/lib/pos/fact-review-core.ts"

MUTANTS: list[tuple[str, str, str, str, str]] = [
    (
        "intake accepts YES with no unit count",
        FACTS,
        '    if (typeof facts.unitsPerPackage !== "number") {',
        "    if (false) {",
        "A flagged item with no count cannot be counted. The engine would "
        "qualify the line and multiply by a default of 1, reading a box of six "
        "as ONE unit and undercounting the statutory limit six-fold.",
    ),
    (
        "intake accepts a fractional unit count",
        FACTS,
        "    if (!Number.isInteger(n)) {",
        "    if (false) {",
        "Half a suppository is not an individual consumable item "
        "(RCW 69.50.101).",
    ),
    (
        "intake infers the flag from the presence of a count",
        FACTS,
        '  } else if (flag === "no") {',
        "  } else if (flag === \"no\" || facts.unitsPerPackage != null) {",
        "Inferring classification from a stray number would let a reviewer who "
        "typed a count but never answered the question silently mark a product "
        "as NOT otherwise-taken.",
    ),
]

SENTINEL = ROOT / ".mutation-in-progress"


def write_sentinel(label: str, rel: str, find: str, replace: str) -> None:
    backup = SENTINEL.with_suffix(".bak")
    backup.write_text((ROOT / rel).read_text(encoding="utf-8"), encoding="utf-8")
    SENTINEL.write_text(
        f"A mutation is currently applied to:\n  {rel}\nmutant: {label}\n\n"
        f"RESTORE FROM THE BACKUP, NOT FROM GIT:\n"
        f"  cp {backup.name} {rel}\n  rm {SENTINEL.name} {backup.name}\n\n"
        f"DO NOT run `git checkout -- {rel}` — the file may contain uncommitted\n"
        f"work that git cannot give back.\n\n"
        f"--- was ---\n{find}\n--- became ---\n{replace}\n",
        encoding="utf-8",
    )


def clear_sentinel() -> None:
    SENTINEL.with_suffix(".bak").unlink(missing_ok=True)
    SENTINEL.unlink(missing_ok=True)


def run_suite() -> bool:
    r = subprocess.run(
        ["npx", "vitest", "run", "tests/compliance/", "--no-file-parallelism"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=900,
    )
    return r.returncode == 0


def main() -> int:
    if SENTINEL.exists():
        print("REFUSING TO RUN — stale sentinel:\n")
        print(SENTINEL.read_text(encoding="utf-8"))
        return 3

    print(f"Pre-flight: checking {len(MUTANTS)} anchors...", flush=True)
    bad = 0
    for label, rel, find, _r, _w in MUTANTS:
        n = (ROOT / rel).read_text(encoding="utf-8").count(find)
        if n != 1:
            print(f"  ANCHOR-FAIL {label}: matched {n}x", flush=True)
            bad += 1
    if bad:
        print(f"\nABORTED: {bad} anchor(s) bad.", flush=True)
        return 2
    print("  all anchors match exactly once.\n", flush=True)

    killed, survived = [], []
    for i, (label, rel, find, replace, why) in enumerate(MUTANTS, 1):
        path = ROOT / rel
        original = path.read_text(encoding="utf-8")
        print(f"[{i}/{len(MUTANTS)}] {label} ...", flush=True)
        try:
            write_sentinel(label, rel, find, replace)
            path.write_text(original.replace(find, replace, 1), encoding="utf-8")
            try:
                passed = run_suite()
            except subprocess.TimeoutExpired:
                print("    killed (TIMEOUT)", flush=True)
                killed.append(label)
                continue
            if passed:
                print("    SURVIVED  <-- HOLE IN THE TESTS", flush=True)
                survived.append((label, rel, why))
            else:
                print("    killed", flush=True)
                killed.append(label)
        finally:
            path.write_text(original, encoding="utf-8")
            clear_sentinel()

    total = len(killed) + len(survived)
    print("\n" + "=" * 70, flush=True)
    print(f"ROUND 3 MUTATION SCORE: {len(killed)}/{total} killed", flush=True)
    if survived:
        for label, rel, why in survived:
            print(f"  - {label} [{rel}]\n      {why}", flush=True)
        return 1
    print("All round-3 mutants killed.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
