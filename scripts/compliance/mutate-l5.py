#!/usr/bin/env python3
"""
L5 mutation harness — TEST THE TESTS.

Breaks the receiving volume gate one edit at a time and demands the suite
notice. A survivor is a hole in the tests, not a curiosity.

Usage:  python3 scripts/compliance/mutate-l5.py
"""
import io
import os
import shutil
import subprocess
import sys
import tempfile

CORE = "src/lib/inventory/receiving-classification-core.ts"
DRAFTS = "src/lib/inventory/catalog-drafts.ts"
INJ_CORE = "src/lib/pos/draft-injection-core.ts"
INJ = "src/lib/pos/draft-injection.ts"
PAGE = "src/app/admin/inventory/drafts/page.tsx"
ACTIONS = "src/app/admin/inventory/drafts/actions.ts"
SQL = "supabase/migrations/0224_receiving_volume_gate.sql"

SUITES = [
    "tests/compliance/receiving-volume-gate.test.ts",
    "tests/compliance/otherwise-taken-receiving.test.ts",
    "tests/compliance/receiving-classification-parity.test.ts",
    "tests/compliance/liquid-volume-plumbing.test.ts",
]

MUTATIONS = [
    # ---- when the gate fires ----------------------------------------------
    ("M01", CORE,
     "    needsVolumePick: isVolumeMeteredShelf && derivedVolumeMl === null,",
     "    needsVolumePick: false,",
     "the gate never fires — unmeasured liquids onboard again, 72 of any size"),
    ("M02", CORE,
     "    needsVolumePick: isVolumeMeteredShelf && derivedVolumeMl === null,",
     "    needsVolumePick: isVolumeMeteredShelf,",
     "re-asks for bottles whose size the name already stated (gate fatigue)"),
    ("M03", CORE,
     "    needsVolumePick: isVolumeMeteredShelf && derivedVolumeMl === null,",
     "    needsVolumePick: derivedVolumeMl === null,",
     "asks on flower/concentrate, where the answer cannot change any limit"),
    ("M04", CORE,
     '  const isVolumeMeteredShelf = categoryToBucket(resolved) === "liquid_edible";',
     '  const isVolumeMeteredShelf = resolved === "edible-liquid";',
     "tinctures and topicals fall out of the gate"),
    ("M05", CORE,
     "    typeof raw === \"number\" && Number.isFinite(raw) && raw > 0 ? raw : null;",
     "    typeof raw === \"number\" && Number.isFinite(raw) && raw >= 0 ? raw : null;",
     "a derived 0 counts as measured -> engine reads it as free of the limit"),
    ("M06", CORE,
     "    typeof raw === \"number\" && Number.isFinite(raw) && raw > 0 ? raw : null;",
     "    typeof raw === \"number\" && raw > 0 ? raw : null;",
     "NaN/Infinity count as a measurement"),
    # ---- what the gate refuses --------------------------------------------
    ("M07", CORE,
     '  if (unitRaw === "oz" || unitRaw === "ounce" || unitRaw === "ounces") {',
     "  if (false) {",
     "a bare ounce is silently converted — ~4% wrong on a statutory limit"),
    ("M08", CORE,
     "  if (!/^\\d+(\\.\\d+)?$/.test(qtyRaw)) {",
     "  if (false) {",
     "junk quantities parse instead of being refused"),
    ("M09", CORE,
     "      code: \"volume_required\",",
     "      code: \"volume_skipped\",",
     "the refusal code changes and callers keying on it break silently"),
    ("M10", CORE,
     "  } else if (qtyRaw === \"\" || unitRaw === \"\") {",
     "  } else if (qtyRaw === \"\" && unitRaw === \"\") {",
     "a quantity with no unit (or vice versa) slips through the gate"),
    ("M11", CORE,
     "  const ml = toMl(qty, unit);",
     "  const ml = qty;",
     "litres and fl oz are stored as if they were millilitres"),
    ("M12", CORE,
     "    provenance: RECEIVING_CLASSIFICATION_PROVENANCE.human,",
     "    provenance: RECEIVING_CLASSIFICATION_PROVENANCE.unanswered,",
     "a human measurement is recorded as never having been answered"),
    ("M23", CORE,
     '          ? "floz"',
     '          ? "ml"',
     "fl oz is stored as millilitres -- a 12 fl oz can reads as 12 ml, ~30x under"),
    # ---- the server wiring -------------------------------------------------
    ("M13", DRAFTS,
     "  if (!volume.ok) {\n    return { ok: false, error: volume.error };\n  }",
     "  if (!volume.ok) {\n    // no-op\n  }",
     "the approval no longer refuses — the gate becomes decoration"),
    ("M14", DRAFTS,
     "  if (volume.netVolumeMl !== null) update.chosen_net_volume_ml = volume.netVolumeMl;",
     "  if (false) update.chosen_net_volume_ml = volume.netVolumeMl;",
     "the measurement is taken and then never stored"),
    ("M15", DRAFTS,
     "    derivedVolumeMl: derivedVolume.netVolumeMl,",
     "    derivedVolumeMl: 1,",
     "the server always believes a volume exists, so it never asks"),
    # ---- injection ---------------------------------------------------------
    ("M16", INJ_CORE,
     "      const measured = d.chosen_net_volume_ml;",
     "      const measured = null;",
     "injection discards the human measurement; net_volume_ml stays null"),
    ("M17", INJ_CORE,
     '        factProvenance.net_volume_ml = "human";',
     '        factProvenance.net_volume_ml = "name";',
     "a human measurement is attributed to the name parser"),
    ("M18", INJ,
     '      ", chosen_net_volume_ml";',
     '      "";',
     "the column is never selected, so the measurement is always undefined"),
    # ---- the receiver's way to answer --------------------------------------
    ("M19", PAGE,
     'name="net_volume_quantity"',
     'name="net_volume_quantity_x"',
     "the field name stops matching the action — an unanswerable gate"),
    ("M20", ACTIONS,
     '  const volumeQuantity = (formData.get("net_volume_quantity") as string | null) ?? null;',
     "  const volumeQuantity = null;",
     "the action drops the answer the receiver typed"),
    ("M21", ACTIONS,
     "    volumeQuantity,\n    volumeUnit,\n  });",
     "  });",
     "the answer never reaches the approval gate"),
    # ---- the migration -----------------------------------------------------
    ("M22", SQL,
     "add column if not exists chosen_net_volume_ml numeric(12,3)",
     "add column if not exists chosen_net_volume_ml_x numeric(12,3)",
     "the column the code writes does not exist"),
]


def run_suites(cwd: str) -> bool:
    env = dict(os.environ, NODE_OPTIONS="--max-old-space-size=3000")
    proc = subprocess.run(
        ["npx", "vitest", "run", *SUITES],
        cwd=cwd, env=env, capture_output=True, text=True, timeout=1800,
    )
    return proc.returncode == 0


def main() -> int:
    repo = os.getcwd()
    caught, survived = [], []

    for mid, path, old, new, meaning in MUTATIONS:
        full = os.path.join(repo, path)
        original = io.open(full, encoding="utf-8").read()
        count = original.count(old)
        if count != 1:
            print(f"{mid}  ERROR: anchor matched {count}x in {path} (expected 1)")
            survived.append((mid, path, meaning, f"anchor {count}x"))
            continue

        backup = tempfile.mktemp(suffix=".bak")
        shutil.copy2(full, backup)
        try:
            io.open(full, "w", encoding="utf-8").write(original.replace(old, new, 1))
            assert new in io.open(full, encoding="utf-8").read(), f"{mid} did not land"
            if run_suites(repo):
                survived.append((mid, path, meaning, "SUITES STILL PASSED"))
                print(f"{mid}  SURVIVED  <-- HOLE IN THE TESTS: {meaning}")
            else:
                caught.append(mid)
                print(f"{mid}  caught    ({meaning})")
        finally:
            shutil.copy2(backup, full)
            os.unlink(backup)
            assert io.open(full, encoding="utf-8").read() == original, f"{mid}: RESTORE FAILED"

    print("\n" + "=" * 70)
    print(f"L5 MUTATION RESULT: {len(caught)}/{len(MUTATIONS)} caught, {len(survived)} survived")
    if survived:
        print("\nSURVIVORS (each is a hole to close or to justify in writing):")
        for mid, path, meaning, why in survived:
            print(f"  {mid} {path}\n      {meaning}\n      {why}")
        return 1
    print("Every mutation was caught.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
