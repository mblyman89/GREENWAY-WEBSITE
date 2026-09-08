#!/usr/bin/env python3
"""
L5 — the RECEIVING VOLUME GATE.

Grounded, not assumed:
  * L3 already derives volume at receiving (draft-injection-core.ts:439) and
    writes net_volume_ml (:579). L5 does NOT re-derive anything.
  * inventory_lots.net_volume_ml and menu_items.net_volume_ml already exist
    (migration 0138). NO new migration.
  * The gap: when derivation yields nothing, draft-injection pushes a
    `net_volume_missing` diagnostic at severity "warning" (:474) and NOTHING
    gates on it (grepped every caller). The liquid onboards unmeasured, the
    register falls back to DEFAULT_UNIT_GRAMS["edible-liquid"] = 28, and 72
    packages of ANY size sell. A warning nobody must read is not a gate.

Adds to the existing pure core, mirroring needsOtherwiseTakenPick exactly.
Idempotent; asserts one anchor match and reads back off disk.
"""
import io
import sys

PATH = "src/lib/inventory/receiving-classification-core.ts"

IMPORT_OLD = '''import {
  categoryToBucket,
  suspectsOtherwiseTaken,
  LOW_THC_UNIT_MAX_MG,
} from "@/lib/compliance/sales-limits-core";'''

IMPORT_NEW = '''import {
  categoryToBucket,
  suspectsOtherwiseTaken,
  LOW_THC_UNIT_MAX_MG,
} from "@/lib/compliance/sales-limits-core";
// SLICE L5 — the volume gate reuses the SAME unit conversions the sales-limit
// engine measures against, so a receiver's answer and the register's cap can
// never be denominated differently. toMl() is the only conversion in the
// building; nothing here re-declares 29.5735.
import { toMl, type VolumeUnit } from "@/lib/compliance/liquid-volume-core";'''

GATE_ANCHOR = """export type ReceivingClassificationChoiceResult ="""

GATE = '''/**
 * SLICE L5 — THE RECEIVING VOLUME GATE.
 *
 * WHY A THIRD GATE, AND WHY IT BLOCKS
 * -----------------------------------
 * SLICE L3 already derives a package volume from the product name at receiving
 * (draft-injection-core.ts) and writes `net_volume_ml`. When that derivation
 * finds nothing it pushes a `net_volume_missing` diagnostic at severity
 * "warning" — and nothing in the building gates on it. Verified by grepping
 * every caller before this was written.
 *
 * So an unmeasured liquid onboards anyway. The limit engine then has no volume
 * to measure, falls back to DEFAULT_UNIT_GRAMS["edible-liquid"] = 28 g, and
 * EXACTLY 72 packages of any size fit the 72 fl oz cap — a 1.5 L bottle counts
 * the same as a 30 ml tincture. That is the owner's original bug, arriving
 * through the door that every future product now uses.
 *
 * Silence therefore does not fail closed. Silence DISABLES a statutory limit.
 * That is the same test migration 0217 applied to otherwise_taken, and it is
 * why this gate BLOCKS rather than prompts — while `promptsLowThcLiquid`, whose
 * silence only ever costs us a lawful sale, still merely asks. The asymmetry is
 * applied consistently, not case by case.
 *
 * WHY IT IS NARROW
 * ----------------
 * It fires ONLY when the shelf is metered by volume AND no volume was derived.
 * A liquid whose name already stated its size is not re-asked; neither is any
 * non-liquid shelf, where the answer could not change a limit in either
 * direction. Gates that ask when the answer cannot matter are the gates staff
 * learn to click through.
 */
export type ReceivingVolumeAssessment = {
  /** True when this shelf's limit is measured in millilitres. */
  isVolumeMeteredShelf: boolean;
  /** The volume L3 already derived, in ml. Null = nothing was derivable. */
  derivedVolumeMl: number | null;
  /**
   * True when a human MUST supply a measured volume before this lot can be
   * onboarded: a volume-metered shelf with no derivable volume.
   */
  needsVolumePick: boolean;
};

/**
 * Decide whether a received lot must be measured before it can be onboarded.
 *
 * Pure, and deliberately given the ALREADY-DERIVED volume rather than deriving
 * one itself — L3 owns that derivation, and two derivations that could drift
 * apart is precisely the failure this codebase keeps designing out.
 */
export function assessReceivingVolume(input: {
  resolvedWebsiteCategory: string | null;
  derivedVolumeMl?: number | null;
}): ReceivingVolumeAssessment {
  const resolved = input.resolvedWebsiteCategory?.trim() || null;
  const isVolumeMeteredShelf = categoryToBucket(resolved) === "liquid_edible";
  // A volume is only a volume if it is a usable positive number. 0, NaN and
  // Infinity are "unknown" wearing a number's clothes, and treating any of
  // them as measured is how an unmeasured bottle would slip through the gate.
  const raw = input.derivedVolumeMl;
  const derivedVolumeMl =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
  return {
    isVolumeMeteredShelf,
    derivedVolumeMl,
    needsVolumePick: isVolumeMeteredShelf && derivedVolumeMl === null,
  };
}

export type ReceivingVolumeChoiceResult =
  | {
      ok: true;
      /** Millilitres in ONE package. Null only when the gate did not fire. */
      netVolumeMl: number | null;
      /** How the value came to exist, for `fact_provenance.net_volume_ml`. */
      provenance: ReceivingClassificationProvenance;
    }
  | {
      ok: false;
      code:
        | "volume_required"
        | "volume_invalid"
        | "volume_unit_required"
        | "volume_unit_ambiguous";
      error: string;
    };

/**
 * Validate the receiver's measured volume.
 *
 * REFUSES rather than coerces, every time. Each rejection below is a way a
 * receiver could otherwise have silently disabled or mis-scaled the 72 fl oz
 * cap: a blank that defaults to "unlimited", a typo that parses as a number, a
 * bare "oz" that is a fluid ounce on a soda and a weight ounce on a salve.
 *
 * The bare-ounce refusal is the one worth stating plainly: this module does not
 * know a liquid's density and will not invent one, so it asks the receiver to
 * say which ounce they mean instead of guessing and being wrong by ~4%.
 */
export function validateReceivingVolumeChoice(input: {
  assessment: Pick<ReceivingVolumeAssessment, "needsVolumePick">;
  volumeQuantity?: string | null;
  volumeUnit?: string | null;
}): ReceivingVolumeChoiceResult {
  const qtyRaw = raw(input.volumeQuantity);
  const unitRaw = raw(input.volumeUnit).toLowerCase();

  // The gate did not fire: nothing to store, and no answer is invented.
  if (!input.assessment.needsVolumePick) {
    if (qtyRaw === "" && unitRaw === "") {
      return {
        ok: true,
        netVolumeMl: null,
        provenance: RECEIVING_CLASSIFICATION_PROVENANCE.unanswered,
      };
    }
    // A volunteered measurement is still a human assertion and is kept — but it
    // must survive exactly the same validation as a required one.
  } else if (qtyRaw === "" || unitRaw === "") {
    return {
      ok: false,
      code: "volume_required",
      error:
        "This liquid has no package volume, so the 72 fluid ounce limit cannot be measured. " +
        "Enter the volume printed on the package (and its unit) before onboarding it.",
    };
  }

  if (qtyRaw === "" && unitRaw === "") {
    return {
      ok: true,
      netVolumeMl: null,
      provenance: RECEIVING_CLASSIFICATION_PROVENANCE.unanswered,
    };
  }

  if (unitRaw === "") {
    return {
      ok: false,
      code: "volume_unit_required",
      error: "Pick the unit the volume is measured in (ml, L, or fl oz).",
    };
  }

  // A bare ounce is genuinely ambiguous on a liquid shelf; refuse it by name so
  // the receiver knows WHY, rather than seeing a generic validation error.
  if (unitRaw === "oz" || unitRaw === "ounce" || unitRaw === "ounces") {
    return {
      ok: false,
      code: "volume_unit_ambiguous",
      error:
        'A bare "oz" is ambiguous on a liquid — it is a FLUID ounce on a drink and a ' +
        "WEIGHT ounce on a salve, and the two are not the same amount. Pick fl oz for a " +
        "fluid ounce, or enter the volume in ml.",
    };
  }

  const unit: VolumeUnit | null =
    unitRaw === "ml"
      ? "ml"
      : unitRaw === "l"
        ? "l"
        : unitRaw === "floz" || unitRaw === "fl oz"
          ? "floz"
          : null;
  if (unit === null) {
    return {
      ok: false,
      code: "volume_unit_required",
      error: "Unit must be ml, L, or fl oz.",
    };
  }

  // Number() would read "" as 0 and " 12 " as 12; neither is a measurement a
  // person typed on purpose, so the shape is checked before the value.
  if (!/^\\d+(\\.\\d+)?$/.test(qtyRaw)) {
    return {
      ok: false,
      code: "volume_invalid",
      error: "Volume must be a positive number, for example 750 or 1.5.",
    };
  }
  const qty = Number(qtyRaw);
  // toMl() itself refuses <= 0 and non-finite values, so this delegates rather
  // than re-implementing the rule in a second place that could drift.
  const ml = toMl(qty, unit);
  if (ml === null) {
    return {
      ok: false,
      code: "volume_invalid",
      error: "Volume must be a positive number, for example 750 or 1.5.",
    };
  }

  return {
    ok: true,
    netVolumeMl: ml,
    provenance: RECEIVING_CLASSIFICATION_PROVENANCE.human,
  };
}

/**
 * Label for the volume field. States what leaving it alone MEANS (the SLICE 91
 * rule): when the gate fires there is no safe default to fall back to, and the
 * label has to say so rather than imply an answer.
 */
export function volumePickerPlaceholder(input: { needsVolumePick: boolean }): string {
  if (input.needsVolumePick) return "Measure the package \\u2014 required";
  return "Volume already known";
}

'''

TEST_ANCHOR = """export function __runReceivingClassificationTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL receiving-classification-core: " + msg);
    passed += 1;
  };
"""

TEST_ADD = '''
  // ── SLICE L5: the receiving VOLUME gate ─────────────────────────────────
  // Fires only where an answer can change a limit.
  ok(
    assessReceivingVolume({ resolvedWebsiteCategory: "edible-liquid", derivedVolumeMl: null })
      .needsVolumePick,
    "an unmeasured liquid MUST be measured before onboarding",
  );
  ok(
    assessReceivingVolume({ resolvedWebsiteCategory: "tincture", derivedVolumeMl: null })
      .needsVolumePick,
    "tinctures are metered by volume too",
  );
  ok(
    !assessReceivingVolume({ resolvedWebsiteCategory: "edible-liquid", derivedVolumeMl: 750 })
      .needsVolumePick,
    "a liquid L3 already measured is NOT re-asked",
  );
  ok(
    !assessReceivingVolume({ resolvedWebsiteCategory: "flower", derivedVolumeMl: null })
      .needsVolumePick,
    "flower is not metered by volume, so the gate stays silent",
  );
  ok(
    !assessReceivingVolume({ resolvedWebsiteCategory: null, derivedVolumeMl: null })
      .needsVolumePick,
    "an unmapped category cannot be volume-metered",
  );
  // Zero/NaN/Infinity are "unknown" wearing a number's clothes.
  for (const junk of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    ok(
      assessReceivingVolume({ resolvedWebsiteCategory: "edible-liquid", derivedVolumeMl: junk })
        .needsVolumePick,
      `a derived volume of ${String(junk)} is NOT a measurement`,
    );
  }

  const gated = { needsVolumePick: true };
  const ungated = { needsVolumePick: false };

  // Refuses rather than coerces.
  ok(
    validateReceivingVolumeChoice({ assessment: gated }).ok === false,
    "a required volume cannot be skipped",
  );
  {
    const r = validateReceivingVolumeChoice({ assessment: gated });
    ok(!r.ok && r.code === "volume_required", "skipping is reported as volume_required");
  }
  {
    const r = validateReceivingVolumeChoice({
      assessment: gated,
      volumeQuantity: "12",
      volumeUnit: "oz",
    });
    ok(
      !r.ok && r.code === "volume_unit_ambiguous",
      "a bare ounce is REFUSED, never guessed at a density",
    );
  }
  for (const bad of ["abc", "", "  ", "12abc", "-5", "1e3", "1,5", "."]) {
    const r = validateReceivingVolumeChoice({
      assessment: gated,
      volumeQuantity: bad,
      volumeUnit: "ml",
    });
    ok(!r.ok, `"${bad}" is refused, not coerced`);
  }
  {
    const r = validateReceivingVolumeChoice({
      assessment: gated,
      volumeQuantity: "0",
      volumeUnit: "ml",
    });
    ok(!r.ok && r.code === "volume_invalid", "zero ml is not a volume");
  }
  // Accepts, and converts through the ONE conversion in the building.
  {
    const r = validateReceivingVolumeChoice({
      assessment: gated,
      volumeQuantity: "750",
      volumeUnit: "ml",
    });
    ok(r.ok && r.netVolumeMl === 750, "750 ml is stored as 750 ml");
    ok(
      r.ok && r.provenance === RECEIVING_CLASSIFICATION_PROVENANCE.human,
      "a measured volume is a HUMAN assertion",
    );
  }
  {
    const r = validateReceivingVolumeChoice({
      assessment: gated,
      volumeQuantity: "1.5",
      volumeUnit: "l",
    });
    ok(r.ok && r.netVolumeMl === 1500, "1.5 L becomes 1500 ml");
  }
  {
    const r = validateReceivingVolumeChoice({
      assessment: gated,
      volumeQuantity: "12",
      volumeUnit: "floz",
    });
    ok(
      r.ok && r.netVolumeMl !== null && Math.abs(r.netVolumeMl - 354.882) < 1e-6,
      "12 fl oz becomes 354.882 ml (the statutory conversion, not 12 x 28)",
    );
  }
  // The ungated path invents nothing.
  {
    const r = validateReceivingVolumeChoice({ assessment: ungated });
    ok(r.ok && r.netVolumeMl === null, "an ungated lot stores no volume");
    ok(
      r.ok && r.provenance === RECEIVING_CLASSIFICATION_PROVENANCE.unanswered,
      "and says plainly that nobody was asked",
    );
  }
  {
    // A volunteered measurement is still kept, and still validated.
    const r = validateReceivingVolumeChoice({
      assessment: ungated,
      volumeQuantity: "30",
      volumeUnit: "ml",
    });
    ok(r.ok && r.netVolumeMl === 30, "a volunteered volume is honoured");
    const bad = validateReceivingVolumeChoice({
      assessment: ungated,
      volumeQuantity: "30",
      volumeUnit: "oz",
    });
    ok(!bad.ok, "...and is held to the SAME rules as a required one");
  }
  ok(
    volumePickerPlaceholder({ needsVolumePick: true }).includes("required"),
    "the placeholder tells the truth about a required pick",
  );
'''


def main() -> int:
    src = io.open(PATH, encoding="utf-8").read()

    if "SLICE L5 — the volume gate reuses" in src:
        print("SKIP: import already present")
    else:
        assert src.count(IMPORT_OLD) == 1, f"import anchor = {src.count(IMPORT_OLD)}"
        src = src.replace(IMPORT_OLD, IMPORT_NEW, 1)

    if "export function assessReceivingVolume" in src:
        print("SKIP: gate already present")
    else:
        assert src.count(GATE_ANCHOR) == 1, f"gate anchor = {src.count(GATE_ANCHOR)}"
        src = src.replace(GATE_ANCHOR, GATE + GATE_ANCHOR, 1)

    if "SLICE L5: the receiving VOLUME gate" in src:
        print("SKIP: self-tests already present")
    else:
        assert src.count(TEST_ANCHOR) == 1, f"test anchor = {src.count(TEST_ANCHOR)}"
        src = src.replace(TEST_ANCHOR, TEST_ANCHOR + TEST_ADD, 1)

    io.open(PATH, "w", encoding="utf-8").write(src)

    back = io.open(PATH, encoding="utf-8").read()
    for needle in [
        "export function assessReceivingVolume",
        "export function validateReceivingVolumeChoice",
        "export function volumePickerPlaceholder",
        "SLICE L5: the receiving VOLUME gate",
    ]:
        assert back.count(needle) == 1, f"{needle} count = {back.count(needle)} on disk"
    print("OK: L5 gate + self-tests verified on disk")
    return 0


if __name__ == "__main__":
    sys.exit(main())
