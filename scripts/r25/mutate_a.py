#!/usr/bin/env python3
"""
Round 25 A mutation testing: intake lots get the manifest received date and
the approver's strain-type pick.

Owner (verbatim): "Follow the standing rules and never guess, never assume.
Test it, test the tests."

Each mutant BREAKS one rule; the suites must FAIL. Same discipline as
scripts/r24/mutate_s20.py: every anchor appears exactly once, the baseline
must be green, and every file is restored afterwards. The SQL side (0244 +
rollback) has its own harness: scripts/r25/mutate_a_sql.py.
"""
import signal
import subprocess
import sys

CORE = "src/lib/inventory/intake-lot-facts-core.ts"
IS = "src/lib/inventory/intake-store.ts"
CD = "src/lib/inventory/catalog-drafts.ts"
RUN = "scripts/compliance/run-pure-selftests.ts"

MUTANTS = [
    # --- core: received date
    ("core: UTC day not Pacific", CORE, "  const day = pacificDayKey(new Date(t));", "  const day = new Date(t).toISOString().slice(0, 10);"),
    ("core: no floor", CORE, "  if (day < RECEIVED_DATE_FLOOR) return null;", ""),
    ("core: no future cap", CORE, "  if (day > addPacificDays(todayPacific, 1)) return null;", ""),
    ("core: wrong source", CORE, "      received_on_source: MANIFEST_RECEIVED_SOURCE,", "      received_on_source: \"owner_entered\" as typeof MANIFEST_RECEIVED_SOURCE,"),
    ("core: set_by not null", CORE, "      received_on_set_by: null,", "      received_on_set_by: \"system\" as unknown as null,"),
    ("core: lot ids not de-duplicated", CORE, "    new Set(input.lotIds.map(", "    (input.lotIds.map("),
    ("core: missing-col any column", CORE, "&& /received_on/i.test(err.message ?? \"\")", ""),
    # --- core: strain mirror
    ("core: unknown pick written", CORE, "  if (pick === \"unknown\") {\n    return { write: false, code: \"no_pick\"", "  if (pick === \"never\") {\n    return { write: false, code: \"no_pick\""),
    ("core: already_set ignores provenance", CORE, "    before.trim().toLowerCase() === pick &&\n    prov.strain_type === LOT_STRAIN_TYPE_HUMAN_PROVENANCE", "    before.trim().toLowerCase() === pick"),
    ("core: other provenance dropped", CORE, "fact_provenance: { ...prov, strain_type: LOT_STRAIN_TYPE_HUMAN_PROVENANCE }", "fact_provenance: { strain_type: LOT_STRAIN_TYPE_HUMAN_PROVENANCE }"),
    ("core: provenance word", CORE, "export const LOT_STRAIN_TYPE_HUMAN_PROVENANCE = \"reviewer\" as const;", "export const LOT_STRAIN_TYPE_HUMAN_PROVENANCE = \"human\" as const;"),
    # --- finalize wiring
    ("finalize: held lots not stamped", IS, "          heldLotIds.push(lot.id);\n", ""),
    ("finalize: rejected lots stamped", IS, "lotIds: [...activatedLotIds, ...heldLotIds],", "lotIds: [...activatedLotIds, ...heldLotIds, ...rejectedLotIds],"),
    ("finalize: overwrites existing dates", IS, ".in(\"id\", receivedStamp.lotIds)\n        .is(\"received_on\", null);", ".in(\"id\", receivedStamp.lotIds);"),
    ("finalize: error swallowed", IS, "      if (recErr) {\n        await logManifestEvent(", "      if (recErr && false) {\n        await logManifestEvent("),
    ("finalize: stamp skipped", IS, "  if (receivedStamp.write) {\n    try {", "  if (receivedStamp.write && false) {\n    try {"),
    ("finalize: wrong instant", IS, "    acceptedAtIso: nowIso,\n    todayPacific", "    acceptedAtIso: \"2026-01-01T12:00:00Z\",\n    todayPacific"),
    # --- mirror wiring
    ("mirror: not called", CD, "  await mirrorStrainTypePickToLot(admin, {\n    draftId,", "  void (() => mirrorStrainTypePickToLot)(), void ({\n    draftId,"),
    ("mirror: writes blind on read error", CD, "        result = { written: false, code: \"lot_read_failed\" };", "        lot = { strain_type: null, fact_provenance: {} };"),
    ("mirror: no audit", CD, "    action: LOT_STRAIN_TYPE_MIRROR_AUDIT_ACTION,\n    entityType: \"inventory_lot\",\n    entityId: input.lotId ?? input.draftId,", "    action: \"x\",\n    entityType: \"inventory_lot\",\n    entityId: input.lotId ?? input.draftId,"),
    ("mirror: write error reported as written", CD, "        if (wErr) {\n          outcome = { lot_row_write_failed: wErr.message };", "        if (wErr && false) {\n          outcome = { lot_row_write_failed: wErr.message };"),
    ("mirror: updated_by dropped", CD, ".update({ ...plan.patch, updated_by: input.actorId })", ".update({ ...plan.patch })"),
    ("mirror: throws out", CD, "    result = { written: false, code: \"threw\" };\n  }", "    throw err;\n  }"),
    # --- runner
    ("runner: floor lowered", RUN, 'assertRan("intake-lot-facts-core", __runIntakeLotFactsCoreTests(), 44);', 'assertRan("intake-lot-facts-core", __runIntakeLotFactsCoreTests(), 43);'),
]

SUITES = [
    "tests/compliance/r25-intake-lot-facts.test.ts",
    "tests/compliance/finalize-speed.test.ts",
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
