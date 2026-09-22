#!/usr/bin/env python3
"""
scripts/compliance/mutate-leafly-l18-setup-cache.py

SLICE L-18 MUTATION PROBE — "test it, test the tests."

A green suite proves nothing on its own. This script BREAKS the production
code one change at a time and requires the suite to go red. Any mutation that
SURVIVES is a hole in the tests, not a success.

The CONTROL mutation at the end is a change that genuinely does not matter
(a comment). It MUST SURVIVE. If the control dies, the suite is failing for
some reason unrelated to the mutation and every other result is meaningless.

Run:  python3 scripts/compliance/mutate-leafly-l18-setup-cache.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

CORE = "src/lib/leafly/setup-cache-core.ts"
SERVER = "src/lib/leafly/setup-cache-server.ts"
READINESS = "src/lib/leafly/order-readiness-server.ts"
PANEL = "src/components/admin/orders/AnnouncerPanel.tsx"
SAVE_BUTTON = "src/components/admin/orders/SaveButton.tsx"
RUNNER = "scripts/compliance/run-pure-selftests.ts"

# The files whose content this probe rewrites. Snapshotted whole, once, and
# restored in a finally — so an interrupted run cannot leave a mutation behind.
TOUCHED = [CORE, SERVER, READINESS, PANEL, SAVE_BUTTON, RUNNER]

TEST_CMD = [
    "npx", "vitest", "run",
    "tests/compliance/leafly-setup-cache.test.ts",
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
    # ── TRAP 1: the JSON shape guard ─────────────────────────────────────────
    Mutation(
        "shape guard accepts functions (the checkout-breaking bug itself)",
        CORE,
        'if (t === "function") {\n    return `${path} is a function',
        'if (false) {\n    return `${path} is a function',
    ),
    Mutation(
        "shape guard stops recursing into objects",
        CORE,
        "    for (const [k, v] of Object.entries(obj)) {\n      const bad = inspectShape(v, seen, `${path}.${k}`);",
        "    for (const [k, v] of ([] as [string, unknown][])) {\n      const bad = inspectShape(v, seen, `${path}.${k}`);",
    ),
    Mutation(
        "shape guard stops recursing into arrays",
        CORE,
        "      for (let i = 0; i < obj.length; i += 1) {\n        const bad = inspectShape(obj[i], seen, `${path}[${i}]`);",
        "      for (let i = 0; i < 0; i += 1) {\n        const bad = inspectShape(obj[i], seen, `${path}[${i}]`);",
    ),
    Mutation(
        "shape guard allows Maps (silent total data loss)",
        CORE,
        "    if (obj instanceof Map) {",
        "    if (false) {",
    ),
    Mutation(
        "shape guard allows Sets",
        CORE,
        "    if (obj instanceof Set) {",
        "    if (false) {",
    ),
    Mutation(
        "shape guard allows Dates",
        CORE,
        "    if (obj instanceof Date) {",
        "    if (false) {",
    ),
    Mutation(
        "shape guard allows NaN / Infinity",
        CORE,
        "    if (!Number.isFinite(value as number)) {",
        "    if (false) {",
    ),
    Mutation(
        "shape guard allows undefined properties (the key silently vanishes)",
        CORE,
        'if (t === "undefined") {',
        "if (false) {",
    ),
    Mutation(
        "cycle detection removed — infinite recursion or false accept",
        CORE,
        "    if (seen.has(obj)) {",
        "    if (false) {",
    ),
    Mutation(
        "cycle unwind removed — a repeated reference is misread as a cycle",
        CORE,
        "    // Unwind: this object is no longer on the path, so a later sibling that\n    // references it again is a duplicate, not a cycle.\n    seen.delete(obj);\n    return null;",
        "    return null;",
    ),

    # ── TRAP 2: the outcome guard ────────────────────────────────────────────
    Mutation(
        "a failed read becomes cacheable (stale 'menu is empty' for a minute)",
        CORE,
        'return outcome.kind === "counted" || outcome.kind === "empty";',
        "return true;",
    ),
    Mutation(
        "a genuine empty menu is refused, so it is never cached",
        CORE,
        'return outcome.kind === "counted" || outcome.kind === "empty";',
        'return outcome.kind === "counted";',
    ),
    Mutation(
        "a failed load is reported as a real zero",
        CORE,
        "  if (!input.loaded) {\n    return {\n      kind: \"unreadable\",",
        "  if (false) {\n    return {\n      kind: \"unreadable\",",
    ),
    Mutation(
        "could-not-check collapses into zero on screen",
        CORE,
        '    case "unreadable":\n      return null;',
        '    case "unreadable":\n      return 0;',
    ),
    Mutation(
        "a negative or NaN count is accepted as a real number",
        CORE,
        "  if (!Number.isFinite(input.variantCount) || input.variantCount < 0) {",
        "  if (false) {",
    ),

    # ── The surface policy ───────────────────────────────────────────────────
    Mutation(
        "THE MONEY PATH: the preview webhook is marked cacheable",
        CORE,
        'anchor: "src/app/api/webhooks/leafly/order-preview/route.ts:126",\n    cacheable: false,',
        'anchor: "src/app/api/webhooks/leafly/order-preview/route.ts:126",\n    cacheable: true,',
    ),
    Mutation(
        "the preview webhook stops being flagged as money",
        CORE,
        "    cacheable: false,\n    touchesMoney: true,",
        "    cacheable: false,\n    touchesMoney: false,",
    ),
    Mutation(
        "unknown surfaces fail OPEN instead of closed",
        CORE,
        "  return found ? found.cacheable : false;",
        "  return found ? found.cacheable : true;",
    ),

    # ── Cache identity ───────────────────────────────────────────────────────
    Mutation(
        "the cache tag drifts from the live menu, so a publish stops clearing it",
        CORE,
        'export const LEAFLY_SETUP_CACHE_TAG = "live-menu";',
        'export const LEAFLY_SETUP_CACHE_TAG = "leafly-setup";',
    ),
    Mutation(
        "the TTL becomes effectively forever",
        CORE,
        "export const LEAFLY_SETUP_CACHE_TTL_SECONDS = 60;",
        "export const LEAFLY_SETUP_CACHE_TTL_SECONDS = 99999;",
    ),
    Mutation(
        "the options drop the tag, so nothing can invalidate the entry",
        CORE,
        "    tags: [LEAFLY_SETUP_CACHE_TAG],",
        "    tags: [],",
    ),

    # ── The server shell ─────────────────────────────────────────────────────
    Mutation(
        "the shell ignores the gate's verdict and stores everything",
        SERVER,
        "  if (!verdict.store) {\n    throw new UncacheableRead(verdict.outcome);\n  }",
        "  if (false) {\n    throw new UncacheableRead(verdict.outcome);\n  }",
    ),
    Mutation(
        "the shell stops consulting the gate at all",
        SERVER,
        "  const verdict = decideCacheWrite(outcome);",
        "  const verdict = { store: true, outcome, reason: null };",
    ),

    # ── The gate itself. These are the mutations that previously SURVIVED,
    #    because the judgement lived in an I/O shell no test could execute.
    #    It is now a pure function, so each of these must die. ──────────────
    Mutation(
        "the gate stores failed reads after all (TRAP 2 deleted)",
        CORE,
        "  if (!isCacheableOutcome(outcome)) {\n    return { store: false, outcome, reason:",
        "  if (false) {\n    return { store: false, outcome, reason:",
    ),
    Mutation(
        "the gate drops its shape guard (TRAP 1 deleted)",
        CORE,
        "  const shapeProblem = describeUncacheableShape(outcome);\n  if (shapeProblem !== null) {",
        "  const shapeProblem = describeUncacheableShape(outcome);\n  if (false) {",
    ),
    Mutation(
        "the gate refuses even the good reads (fails closed, cache never warms)",
        CORE,
        "  return { store: true, outcome, reason: null };\n}",
        "  return { store: false, outcome, reason: null };\n}",
    ),
    Mutation(
        "a refusal stops explaining itself",
        CORE,
        '    reason: `refusing to cache a value that would not survive JSON: ${shapeProblem}`,\n      },\n      reason: shapeProblem,',
        '    reason: `refusing to cache a value that would not survive JSON: ${shapeProblem}`,\n      },\n      reason: "no",',
    ),
    Mutation(
        "the gate lets unrecognisable junk through",
        CORE,
        "  if (!isVariantCountOutcome(outcome)) {",
        "  if (false && !isVariantCountOutcome(outcome)) {",
    ),
    Mutation(
        "the gate withholds the outcome from the caller on a refusal",
        CORE,
        '    return { store: false, outcome, reason: "the read failed, so there is nothing true to remember" };',
        '    return { store: false, outcome: { kind: "empty" }, reason: "the read failed, so there is nothing true to remember" };',
    ),
    Mutation(
        "the type guard waves through any object with a kind",
        CORE,
        '  return kind === "counted" || kind === "empty" || kind === "unreadable";',
        "  return typeof kind === \"string\";",
    ),

    # ── The wiring ───────────────────────────────────────────────────────────
    Mutation(
        "the setup count goes back to rebuilding the whole menu every render",
        READINESS,
        "  const { loadPublishedVariantCountOutcome } = await import(\"./setup-cache-server\");\n  const { countForDisplay } = await import(\"./setup-cache-core\");\n  return countForDisplay(await loadPublishedVariantCountOutcome());",
        "  try {\n    const { buildLeaflyVariantLookup } = await import(\"./preview-lookup\");\n    const built = await buildLeaflyVariantLookup();\n    if (!built.loaded) return null;\n    return built.variantCount;\n  } catch {\n    return null;\n  }",
    ),

    # ── The save buttons ─────────────────────────────────────────────────────
    Mutation(
        "the save button stops disabling itself (double-submit returns)",
        SAVE_BUTTON,
        "      disabled={pending}",
        "      disabled={false}",
    ),
    Mutation(
        "the save button stops announcing itself to screen readers",
        SAVE_BUTTON,
        "      aria-busy={pending}",
        "      aria-busy={false}",
    ),
    Mutation(
        "the busy label is silently defaulted to the idle one",
        SAVE_BUTTON,
        "  busyLabel,",
        '  busyLabel = "Save",',
    ),
    Mutation(
        "one save form reverts to a plain dead button",
        PANEL,
        '              <SaveButton label="Save settings" busyLabel="Saving settings…" />',
        '              <Button type="submit" variant="save" size="sm">Save settings</Button>',
    ),
    Mutation(
        "a busy label is made identical to its idle label",
        PANEL,
        'label="Save order sounds" busyLabel="Saving order sounds…"',
        'label="Save order sounds" busyLabel="Save order sounds"',
    ),

    # ── Registration ─────────────────────────────────────────────────────────
    Mutation(
        "the self-test floor is dropped to zero",
        RUNNER,
        "    145,\n  );",
        "    0,\n  );",
    ),
    Mutation(
        "the self-test floor is quietly halved (still nonzero, still useless)",
        RUNNER,
        "    145,\n  );",
        "    40,\n  );",
    ),
    Mutation(
        "the live-menu cross-check is no longer injected",
        RUNNER,
        "      liveMenuTag: MENU_CACHE_TAG,",
        "      liveMenuTag: LEAFLY_SETUP_CACHE_TAG_UNUSED ?? undefined,",
    ),

    # ── CONTROL — must SURVIVE ───────────────────────────────────────────────
    Mutation(
        "CONTROL: reword a comment (must survive)",
        SERVER,
        " * ONE JOB: answer",
        " * ONE TASK: answer",
        control=True,
    ),
]


def run(cmd: list[str]) -> bool:
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    return proc.returncode == 0


def suite_green() -> bool:
    """The suite is green only if BOTH the vitest file and the pure self-tests pass."""
    return run(TEST_CMD) and run(SELFTEST_CMD)


def snapshot() -> dict[str, str]:
    return {p: (ROOT / p).read_text() for p in TOUCHED}


def restore(snap: dict[str, str]) -> None:
    for p, text in snap.items():
        (ROOT / p).write_text(text)


def preflight(snap: dict[str, str]) -> bool:
    """Refuse to start unless every anchor is present exactly once and the suite is green."""
    ok = True
    for m in MUTATIONS:
        n = snap[m.path].count(m.old)
        if n != 1:
            print(f"  ANCHOR ERROR ({n} matches) in {m.path}: {m.name}")
            ok = False
    if not ok:
        return False
    print("  all anchors resolve to exactly one match")
    if not suite_green():
        print("  BASELINE IS RED — fix the suite before running the probe")
        return False
    print("  baseline is green")
    return True


def _run(snap: dict[str, str]) -> int:
    real = [m for m in MUTATIONS if not m.control]
    controls = [m for m in MUTATIONS if m.control]
    caught, survived, control_ok = 0, [], True

    for i, m in enumerate(MUTATIONS, 1):
        target = ROOT / m.path
        target.write_text(snap[m.path].replace(m.old, m.new, 1))
        green = suite_green()
        restore(snap)

        if m.control:
            control_ok = green
            print(f"  {i:2d}. {'SURVIVED (correct)' if green else 'DIED (PROBLEM!)'}  {m.name}")
        elif green:
            survived.append(m.name)
            print(f"  {i:2d}. SURVIVED  <-- HOLE IN THE TESTS: {m.name}")
        else:
            caught += 1
            print(f"  {i:2d}. caught    {m.name}")

    print()
    print(f"  real mutations : {len(real)}")
    print(f"  caught         : {caught}")
    print(f"  survived       : {len(survived)}")
    print(f"  control        : {'SURVIVED (correct)' if control_ok else 'DIED (PROBLEM!)'}")
    for s in survived:
        print(f"    ! {s}")

    return 0 if (not survived and control_ok and len(controls) == 1) else 1


def main() -> int:
    print("L-18 mutation probe — breaking the code on purpose\n")
    snap = snapshot()
    tmp = Path(tempfile.mkdtemp(prefix="l18-mutate-"))
    for p in TOUCHED:
        (tmp / p.replace("/", "__")).write_text(snap[p])
    print(f"  snapshot saved to {tmp}\n")
    try:
        if not preflight(snap):
            return 1
        print()
        return _run(snap)
    finally:
        # Whatever happened — exception, Ctrl-C, timeout — put the tree back.
        restore(snap)
        print("\n  all files restored to their original contents")
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
