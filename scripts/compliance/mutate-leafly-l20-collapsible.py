#!/usr/bin/env python3
"""
scripts/compliance/mutate-leafly-l20-collapsible.py

SLICE L-20 MUTATION PROBE — "test it, test the tests."

A green suite proves nothing on its own. This script BREAKS the production
code one change at a time and requires the suite to go red. Any mutation that
SURVIVES is a hole in the tests, not a success.

The mutations that matter most here are of two kinds:

  1. DRIFT. The owner asked for a bar "identical" to the speaker guide's.
     Mutations that re-introduce a hand-rolled <details>, or change one bar's
     colour and not the other's, must die — otherwise "identical" decays the
     first time somebody edits one file.

  2. HIDING A PROBLEM. Collapsing a panel is only safe if it never folds away
     the one thing explaining an empty screen. Mutations that force the setup
     panel shut during setup must die, because that silently re-creates the
     M-2 bug ("my order vanished and the page said nothing") behind a nicer
     UI.

The CONTROL mutation at the end is a change that genuinely does not matter
(a comment). It MUST SURVIVE. If the control dies, the suite is failing for
some reason unrelated to the mutation and every other result is meaningless.

Run:  python3 scripts/compliance/mutate-leafly-l20-collapsible.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

CORE = "src/lib/admin/disclosure-core.ts"
PANEL = "src/components/admin/ui/DisclosurePanel.tsx"
SPEAKER = "src/components/admin/orders/AnnouncerSetupGuide.tsx"
LEAFLY = "src/components/admin/orders/LeaflyOrderSetupPanel.tsx"
READINESS = "src/lib/leafly/order-readiness-core.ts"
RUNNER = "scripts/compliance/run-pure-selftests.ts"

TOUCHED = [CORE, PANEL, SPEAKER, LEAFLY, READINESS, RUNNER]

TEST_CMD = [
    "npx", "vitest", "run",
    "tests/compliance/leafly-setup-collapsible.test.ts",
    "tests/compliance/disclosure-panel-render.test.tsx",
    "tests/compliance/leafly-setup-panel-render.test.tsx",
    "tests/compliance/announcer-setup-guide.test.ts",
    "--reporter=dot",
]
SELFTEST_CMD = ["npx", "tsx", RUNNER]


@dataclass
class Mutation:
    name: str
    path: str
    old: str
    new: str
    control: bool = False


MUTATIONS: list[Mutation] = [
    # ── DRIFT: the two bars stop being the same bar ───────────────────────
    Mutation(
        "THE REQUEST: the Leafly panel goes back to a hand-rolled <details>",
        LEAFLY,
        "      <DisclosurePanel",
        '      <details className="mt-3 rounded border border-green-500"><summary>Leafly orders</summary><DisclosurePanel',
    ),
    Mutation(
        "the speaker guide stops using the shared bar (drift re-opens)",
        SPEAKER,
        '    <DisclosurePanel icon="\U0001F4D6" title="Set up a speaker" subtitle="full step-by-step guide">',
        '    <details className="mt-3"><summary>\U0001F4D6 Set up a speaker \u2014 full step-by-step guide</summary>',
    ),
    Mutation(
        "the shared component inlines its own classes instead of the core's",
        PANEL,
        "    <details className={DISCLOSURE_SHELL_CLASS} id={id} open={defaultOpen}>",
        '    <details className="mt-3 rounded-lg border px-3.5 py-3" id={id} open={defaultOpen}>',
    ),
    Mutation(
        "the summary bar stops reading the shared class",
        PANEL,
        "      <summary className={DISCLOSURE_SUMMARY_CLASS}>",
        '      <summary className="cursor-pointer text-sm font-bold">',
    ),
    Mutation(
        "the label grammar is built inline instead of by the shared helper",
        PANEL,
        "          disclosureLabel(icon, title, subtitle)\n        )}",
        "          `${icon} ${title}`\n        )}",
    ),

    # ── The bar stops being GREEN ─────────────────────────────────────────
    Mutation(
        "the green bar turns red (danger token)",
        CORE,
        '  "mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/[0.06] px-3.5 py-3";',
        '  "mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/[0.06] px-3.5 py-3";',
    ),
    Mutation(
        "the border is dropped, so there is no bar at all",
        CORE,
        "border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/[0.06]",
        "bg-[var(--admin-accent)]/[0.06]",
    ),
    Mutation(
        "a token is misspelled, which CSS silently drops (invisible border)",
        CORE,
        "border border-[var(--admin-accent)]/40 bg-",
        "border border-[var(--admin-acent)]/40 bg-",
    ),
    Mutation(
        "the bar stops looking clickable",
        CORE,
        '  "cursor-pointer text-sm font-bold text-[var(--admin-text)]";',
        '  "text-sm font-bold text-[var(--admin-text)]";',
    ),
    Mutation(
        "the bar is no longer bold, so it stops reading as a heading",
        CORE,
        "cursor-pointer text-sm font-bold",
        "cursor-pointer text-sm",
    ),
    Mutation(
        "the declared token list drifts from the classes it describes",
        CORE,
        '  "--admin-radius-lg",\n  "--admin-accent",\n  "--admin-text",',
        '  "--admin-radius-lg",\n  "--admin-accent",',
    ),

    # ── HIDING A PROBLEM: the M-2 regression ──────────────────────────────
    Mutation(
        "THE TRAP: the setup panel folds shut during setup (M-2 returns)",
        CORE,
        "  if (hasEverReceived) return false;\n  return blockingStepsRemaining > 0;",
        "  if (hasEverReceived) return false;\n  return false;",
    ),
    Mutation(
        "the panel is always open, so collapsing never actually happens",
        CORE,
        "  if (hasEverReceived) return false;\n  return blockingStepsRemaining > 0;",
        "  return true;",
    ),
    Mutation(
        "evidence stops outranking the checklist (panel nags a working shop)",
        CORE,
        "  if (hasEverReceived) return false;",
        "  if (false) return false;",
    ),
    Mutation(
        "a nonsense negative step count forces the panel open forever",
        CORE,
        "  return blockingStepsRemaining > 0;",
        "  return blockingStepsRemaining !== 0;",
    ),
    Mutation(
        "the Leafly panel hard-codes itself shut, ignoring the shared rule",
        LEAFLY,
        "        defaultOpen={startOpen}",
        "        defaultOpen={false}",
    ),
    Mutation(
        "the Leafly panel hard-codes itself open",
        LEAFLY,
        "        defaultOpen={startOpen}",
        "        defaultOpen={true}",
    ),
    Mutation(
        "the open/closed decision is re-invented in the component",
        LEAFLY,
        "  const startOpen = shouldStartOpen(remaining, readiness.anyOrderEverReceived);",
        "  const startOpen = remaining > 0;",
    ),

    # ── The badge: knowing whether to open it without opening it ──────────
    Mutation(
        "the step count disappears from the collapsed bar",
        LEAFLY,
        "        badge={\n          remaining > 0 ? (",
        "        badge={\n          false ? (",
    ),
    Mutation(
        "the badge is rendered outside the summary, so it is hidden when collapsed",
        PANEL,
        "            {badge}\n          </span>",
        "          </span>",
    ),
    Mutation(
        "the badge prop is ignored entirely",
        PANEL,
        "        {badge ? (",
        "        {false ? (",
    ),

    # ── The echoed flag ───────────────────────────────────────────────────
    Mutation(
        "anyOrderEverReceived is derived from readiness instead of echoed",
        READINESS,
        "    anyOrderEverReceived: input.anyOrderEverReceived === true,",
        "    anyOrderEverReceived: ready,",
    ),
    Mutation(
        "the echo inverts",
        READINESS,
        "    anyOrderEverReceived: input.anyOrderEverReceived === true,",
        "    anyOrderEverReceived: input.anyOrderEverReceived !== true,",
    ),
    Mutation(
        "the echo is pinned true, so the panel never opens during setup",
        READINESS,
        "    anyOrderEverReceived: input.anyOrderEverReceived === true,",
        "    anyOrderEverReceived: true,",
    ),

    # ── The label ─────────────────────────────────────────────────────────
    Mutation(
        "a hyphen replaces the em dash, so the two bars read differently",
        CORE,
        "  return tail ? `${head} \u2014 ${tail}` : head;",
        "  return tail ? `${head} - ${tail}` : head;",
    ),
    Mutation(
        "an empty subtitle leaves a dangling dash on the bar",
        CORE,
        "  const tail = subtitle?.trim();",
        "  const tail = subtitle;",
    ),
    Mutation(
        "the subtitle is always appended, dash and all",
        CORE,
        "  return tail ? `${head} \u2014 ${tail}` : head;",
        "  return `${head} \u2014 ${tail}`;",
    ),
    Mutation(
        "the speaker guide's title is changed, which the owner would notice",
        SPEAKER,
        'title="Set up a speaker"',
        'title="Speaker setup"',
    ),

    # ── The harness ───────────────────────────────────────────────────────
    Mutation(
        "the self-test floor is dropped to zero",
        RUNNER,
        'assertRan("disclosure-core", __runDisclosureTests(), 30);',
        'assertRan("disclosure-core", __runDisclosureTests(), 0);',
    ),
    Mutation(
        "the self-test floor is quietly halved (nonzero, still useless)",
        RUNNER,
        'assertRan("disclosure-core", __runDisclosureTests(), 30);',
        'assertRan("disclosure-core", __runDisclosureTests(), 8);',
    ),
    Mutation(
        "the core becomes impure by importing React",
        CORE,
        "/** The container: rounded, accent-bordered, faintly accent-tinted. */",
        'import type { ReactNode } from "react";\n/** The container: rounded, accent-bordered, faintly accent-tinted. */',
    ),

    # ── CONTROL — must SURVIVE ────────────────────────────────────────────
    Mutation(
        "CONTROL: reword a comment (must survive)",
        CORE,
        " * SLICE L-20 \u2014 ONE GREEN BAR, DEFINED ONCE.",
        " * SLICE L-20 \u2014 a single green bar, defined in one place.",
        control=True,
    ),
]


def run(cmd: list[str]) -> bool:
    """True when the command exits 0 (suite green)."""
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    return proc.returncode == 0


def suite_green() -> bool:
    return run(TEST_CMD) and run(SELFTEST_CMD)


def preflight(snapshot: Path) -> None:
    """
    Every anchor must resolve to EXACTLY one occurrence.

    An anchor that matches zero times is a mutation that never happened and
    would be reported as "caught" for free. An anchor that matches twice is a
    mutation that changed more than it claimed. Rule 137: an ambiguous anchor
    is not a probe.
    """
    problems: list[str] = []
    for m in MUTATIONS:
        src = (snapshot / m.path.replace("/", "__")).read_text(encoding="utf-8")
        n = src.count(m.old)
        if n != 1:
            problems.append(f"  {m.name}\n    anchor occurs {n} times in {m.path}")
    if problems:
        print("\n  ANCHOR PROBLEMS \u2014 fix before trusting any result:\n")
        print("\n".join(problems))
        sys.exit(2)
    print("  all anchors resolve to exactly one match")


def main() -> int:
    print("L-20 mutation probe \u2014 breaking the code on purpose\n")

    tmp = Path(tempfile.mkdtemp(prefix="l20-mutate-"))
    for rel in TOUCHED:
        shutil.copy(ROOT / rel, tmp / rel.replace("/", "__"))
    print(f"  snapshot saved to {tmp}\n")

    def restore() -> None:
        for rel in TOUCHED:
            shutil.copy(tmp / rel.replace("/", "__"), ROOT / rel)

    try:
        preflight(tmp)

        if not suite_green():
            print("\n  BASELINE IS RED \u2014 fix the suite before mutating.")
            return 2
        print("  baseline is green\n")

        caught = 0
        survived: list[str] = []
        control_survived = None

        for i, m in enumerate(MUTATIONS, 1):
            target = ROOT / m.path
            original = target.read_text(encoding="utf-8")
            target.write_text(original.replace(m.old, m.new, 1), encoding="utf-8")

            green = suite_green()
            restore()

            if m.control:
                control_survived = green
                verdict = "SURVIVED (correct)" if green else "DIED (PROBE IS BROKEN)"
                print(f"  {i:2}. {verdict}  {m.name}")
                continue

            if green:
                survived.append(m.name)
                print(f"  {i:2}. SURVIVED  <-- HOLE IN THE TESTS: {m.name}")
            else:
                caught += 1
                print(f"  {i:2}. caught    {m.name}")

        real = len([m for m in MUTATIONS if not m.control])
        print(f"\n  real mutations : {real}")
        print(f"  caught         : {caught}")
        print(f"  survived       : {len(survived)}")
        print(
            "  control        : "
            + ("SURVIVED (correct)" if control_survived else "DIED \u2014 RESULTS MEANINGLESS")
        )
        for s in survived:
            print(f"    ! {s}")

        return 0 if (caught == real and control_survived) else 1
    finally:
        restore()
        print("\n  all files restored to their original contents")


if __name__ == "__main__":
    sys.exit(main())
