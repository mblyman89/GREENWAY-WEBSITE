#!/usr/bin/env python3
"""
L5 step 2 — wire the volume gate into the receiving APPROVAL path.

The gate is worthless if it lives only in a pure module. This makes the server
re-derive the assessment (never trusting the form, exactly as SLICE 18-0 does
for otherwise_taken) and REFUSE the approval when an unmeasured liquid has no
human measurement.

Idempotent; each edit asserts exactly one anchor match and reads back off disk.
"""
import io
import sys

DRAFTS = "src/lib/inventory/catalog-drafts.ts"

EDITS = []

# 1. import the new gate alongside the existing one
EDITS.append((
    DRAFTS,
    """  assessReceivingClassification,
  validateReceivingClassificationChoice,""",
    """  assessReceivingClassification,
  validateReceivingClassificationChoice,
  // SLICE L5 — the volume gate. Same module, same fail-closed discipline.
  assessReceivingVolume,
  validateReceivingVolumeChoice,""",
    "assessReceivingVolume,",
))

# 2. accept the raw form values on the classification payload
# 1b. the derivation pair injection already uses (verified: drafts store no volume)
EDITS.append((
    DRAFTS,
    """import {
  assessReceivingClassification,""",
    """import { extractNameFacts } from "@/lib/inventory/fact-extraction-core";
// SLICE L5 — the SAME derivation draft-injection-core.ts runs at injection
// time. catalog_product_drafts stores no net_volume_ml, so the gate must ask
// the question injection would otherwise have answered with silence.
import { deriveNetVolumeMl } from "@/lib/compliance/liquid-volume-derivation-core";
import {
  assessReceivingClassification,""",
    'import { extractNameFacts } from "@/lib/inventory/fact-extraction-core";',
))

EDITS.append((
    DRAFTS,
    """    otherwiseTaken?: string | null;
    unitsPerPackage?: string | null;
    lowThcLiquid?: string | null;
    unitThcMg?: string | null;
  },""",
    """    otherwiseTaken?: string | null;
    unitsPerPackage?: string | null;
    lowThcLiquid?: string | null;
    unitThcMg?: string | null;
    /**
     * SLICE L5: the approver's MEASURED package volume, as raw form strings.
     * Required only when the shelf is metered by volume and SLICE L3 could not
     * derive a size from the product name. Validated server-side and REFUSED
     * rather than coerced — including a bare "oz", which is ambiguous on a
     * liquid and is never guessed at.
     */
    volumeQuantity?: string | null;
    volumeUnit?: string | null;
  },""",
    "volumeQuantity?: string | null;",
))

# 3. run the gate right after the existing compliance gate
EDITS.append((
    DRAFTS,
    """  if (!compliance.ok) {
    return { ok: false, error: compliance.error };
  }""",
    """  if (!compliance.ok) {
    return { ok: false, error: compliance.error };
  }

  // SLICE L5: the VOLUME gate.
  //
  // Assessed against the SAME category the compliance gate used (the human's
  // pick when they made one, the resolver's verdict otherwise), so a product
  // cannot be re-shelved onto a liquid shelf in the very submission that skips
  // the measurement.
  //
  // The DERIVED volume is re-read from the draft row we already loaded, never
  // taken from the form: a client that could assert "L3 already measured this"
  // could switch the gate off for the products that need it most.
  //
  // It is derived HERE with the SAME two calls draft-injection-core.ts makes at
  // injection time (extractNameFacts -> deriveNetVolumeMl), because
  // catalog_product_drafts stores no net_volume_ml — verified against the
  // migrations, not assumed. Using the same pair is what guarantees the gate
  // asks exactly when injection would otherwise have recorded nothing.
  const derivedFacts = extractNameFacts(row?.name ?? null);
  const derivedVolume = deriveNetVolumeMl({
    rawName: row?.name ?? null,
    sizes: derivedFacts.sizes,
    packCount: derivedFacts.packCount,
  });
  const volumeAssessment = assessReceivingVolume({
    resolvedWebsiteCategory: choice.chosenWebsiteCategory ?? resolution.websiteCategory,
    derivedVolumeMl: derivedVolume.netVolumeMl,
  });
  const volume = validateReceivingVolumeChoice({
    assessment: volumeAssessment,
    volumeQuantity: classification?.volumeQuantity ?? null,
    volumeUnit: classification?.volumeUnit ?? null,
  });
  if (!volume.ok) {
    return { ok: false, error: volume.error };
  }""",
    "const volumeAssessment = assessReceivingVolume({",
))

# 4. persist the measured volume when a human gave one
EDITS.append((
    DRAFTS,
    """  if (compliance.unitThcMg !== null) update.chosen_unit_thc_mg = compliance.unitThcMg;""",
    """  if (compliance.unitThcMg !== null) update.chosen_unit_thc_mg = compliance.unitThcMg;
  // SLICE L5 (migration 0224): the measured package volume, written ONLY when a
  // human actually measured. Absent stays absent — inventing a number here
  // would be precisely the failure the gate exists to prevent, because the
  // register would then enforce a statutory limit against a size nobody read
  // off the package.
  if (volume.netVolumeMl !== null) update.chosen_net_volume_ml = volume.netVolumeMl;""",
    "update.chosen_net_volume_ml = volume.netVolumeMl;",
))


def main() -> int:
    for path, old, new, marker in EDITS:
        src = io.open(path, encoding="utf-8").read()
        if marker in src:
            print(f"SKIP  {path}: already applied ({marker[:50]}...)")
            continue
        count = src.count(old)
        assert count == 1, f"{path}: anchor matched {count}x, expected 1\n---\n{old}\n---"
        io.open(path, "w", encoding="utf-8").write(src.replace(old, new, 1))
        back = io.open(path, encoding="utf-8").read()
        assert back.count(new) == 1, f"{path}: new text present {back.count(new)}x"
        print(f"OK    {path}: applied and verified on disk ({marker[:50]}...)")
    print("\nAll L5 server edits verified on disk.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
