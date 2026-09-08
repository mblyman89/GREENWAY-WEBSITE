#!/usr/bin/env python3
"""
SLICE L3 seam edits, applied with assertions.

Two str_replace edits SILENTLY FAILED earlier in this workstream (L2), and one
of them (REAL_MEASURE_UNITS never receiving "l") would have shipped had a test
not caught it. So every edit here asserts the anchor appears EXACTLY once and
verifies the file actually changed on disk.
"""
import sys

EDITS = []


def edit(path, old, new, label):
    EDITS.append((path, old, new, label))


# ── SEAM 1: draft-injection-core.ts — derive the volume at the fact site ────
P1 = "src/lib/pos/draft-injection-core.ts"

edit(
    P1,
    'import { crossExamineRow, MG_FACT_TYPES } from "@/lib/inventory/fact-extraction-core";',
    'import { crossExamineRow, MG_FACT_TYPES } from "@/lib/inventory/fact-extraction-core";\n'
    'import {\n'
    '  deriveNetVolumeMl,\n'
    '  deriveNetWeightGrams,\n'
    '} from "@/lib/compliance/liquid-volume-derivation-core";',
    "S1a import",
)

edit(
    P1,
    """  ratio_label: string | null;
  fact_provenance: Record<string, string>;
  /**
   * SLICE 18-0: the compliance-limit flags (migrations 0216 / 0217 columns on""",
    """  ratio_label: string | null;
  /**
   * SLICE L3: the physical package measure (migration 0138 columns on
   * menu_items AND inventory_lots).
   *
   * net_volume_ml is the one the SLICE L4 limit engine measures against the
   * 72 fl oz cap, and before this slice receiving produced NOTHING for it --
   * intake-menu-staging-core.ts hardcoded `net_volume_ml: null`, so every
   * received liquid reached the register with an unknown size and fell back
   * to the 28 g category default. A 1.5 L bottle then counted as one ounce.
   *
   * PER PACKAGE, not per unit: a "4 x 50ml" carton is 200, not 50. null means
   * "nobody knows" and NEVER "zero" -- the SLICE L5 receiving gate asks a
   * human, and the register stays fail-closed until it is answered.
   */
  net_weight_grams: number | null;
  net_volume_ml: number | null;
  fact_provenance: Record<string, string>;
  /**
   * SLICE 18-0: the compliance-limit flags (migrations 0216 / 0217 columns on""",
    "S1b PlannedInjectedItem fields",
)

edit(
    P1,
    """    let ratioLabel: string | null = null;
    const invType = (d.inventory_type ?? "").trim();""",
    """    let ratioLabel: string | null = null;
    let netWeightGrams: number | null = null;
    let netVolumeMl: number | null = null;
    const invType = (d.inventory_type ?? "").trim();""",
    "S1c locals",
)

edit(
    P1,
    """      if (exam.ratioLabel?.value) {
        ratioLabel = exam.ratioLabel.value;
        factProvenance.ratio_label = exam.ratioLabel.source;
      }
    }""",
    """      if (exam.ratioLabel?.value) {
        ratioLabel = exam.ratioLabel.value;
        factProvenance.ratio_label = exam.ratioLabel.source;
      }

      // SLICE L3: the physical package measure. The name extractor already
      // found the sizes (SLICE 55, litres added in L2); nothing was reading
      // them, so `net_volume_ml` was null on every received liquid and the
      // limit engine fell back to a 28 g guess.
      //
      // deriveNetVolumeMl is NOT `sizes[0]`: measured against the live
      // extractor, "4 x 50ml" reports a single 50 ml size with NO pack count,
      // so the naive read records a 200 ml carton as 50 ml and the register
      // allows four times the legal volume. See the module header.
      //
      // Ambiguous derivations still record their fail-closed (larger) number
      // AND a diagnostic, because a bigger recorded volume can only ever
      // allow FEWER packages -- an unanswered question must never be the
      // thing that lets an oversell through.
      const vol = deriveNetVolumeMl({
        rawName: d.name,
        sizes: exam.name.sizes,
        packCount: exam.name.packCount,
      });
      netWeightGrams = deriveNetWeightGrams(exam.name.sizes);
      if (netWeightGrams !== null) factProvenance.net_weight_grams = "name";
      if (vol.netVolumeMl !== null && vol.source !== null) {
        netVolumeMl = vol.netVolumeMl;
        factProvenance.net_volume_ml = vol.source;
        if (vol.confidence === "ambiguous") {
          diagnostics.push({
            severity: "warning",
            code: "net_volume_needs_confirmation",
            message:
              "The package volume was derived from the product name and needs a human to confirm it.",
            context: {
              draft_id: d.id,
              pos_product_key: key,
              productName: d.name,
              displayName: d.name,
              inventoryType: invType,
              netVolumeMl: vol.netVolumeMl,
              perUnitMl: vol.perUnitMl,
              packCount: vol.packCount,
              reasons: vol.reasons,
            },
          });
        }
      } else if (LIQUID_VOLUME_TYPES.has(invType)) {
        // A liquid with NO derivable volume is the case that broke the limit.
        // Surface it so the dock can measure the bottle instead of letting
        // the register invent a size.
        diagnostics.push({
          severity: "warning",
          code: "net_volume_missing",
          message: "This liquid has no package volume, so the 72 fl oz limit cannot be measured.",
          context: {
            draft_id: d.id,
            pos_product_key: key,
            productName: d.name,
            displayName: d.name,
            inventoryType: invType,
            reasons: vol.reasons,
          },
        });
      }
    }""",
    "S1d derivation + diagnostics",
)

edit(
    P1,
    """      ratio_label: ratioLabel,
      fact_provenance: factProvenance,""",
    """      ratio_label: ratioLabel,
      net_weight_grams: netWeightGrams,
      net_volume_ml: netVolumeMl,
      fact_provenance: factProvenance,""",
    "S1e assembly",
)

# ── SEAM 2: intake-mastering-core.ts — carry onto the lot fact bundle ──────
P2 = "src/lib/pos/intake-mastering-core.ts"

edit(
    P2,
    """  ratio_label: string | null;
  fact_provenance: Record<string, string>;
};""",
    """  ratio_label: string | null;
  /**
   * SLICE L3: the physical package measure reaches inventory_lots too, so the
   * golden record and the menu row agree. Grouped cards keep only the base
   * item's fields, which is exactly why this bundle exists.
   */
  net_weight_grams: number | null;
  net_volume_ml: number | null;
  fact_provenance: Record<string, string>;
};""",
    "S2a LotFactBundle",
)

edit(
    P2,
    """      it.package_cbd_mg !== null ||
      it.ratio_label !== null
    ) {""",
    """      it.package_cbd_mg !== null ||
      it.ratio_label !== null ||
      // SLICE L3: a bottle whose ONLY fact is its size still has a fact worth
      // keeping -- and it is the fact the sales limit is measured from.
      it.net_weight_grams !== null ||
      it.net_volume_ml !== null
    ) {""",
    "S2b gate condition",
)

edit(
    P2,
    """        ratio_label: it.ratio_label,
        fact_provenance: it.fact_provenance,
      });""",
    """        ratio_label: it.ratio_label,
        net_weight_grams: it.net_weight_grams,
        net_volume_ml: it.net_volume_ml,
        fact_provenance: it.fact_provenance,
      });""",
    "S2c bundle assembly",
)

# ── SEAM 3: intake-menu-staging-core.ts — the hardcoded nulls ──────────────
P3 = "src/lib/pos/intake-menu-staging-core.ts"

edit(
    P3,
    """    ratio_label: it.ratio_label,
    net_weight_grams: null,
    net_volume_ml: null,
    fact_provenance: it.fact_provenance,""",
    """    ratio_label: it.ratio_label,
    // SLICE L3: these two were hardcoded null -- the SAME defect class as the
    // "SLICE 18G (DEFECT 3)" note below, and with the same silent blast
    // radius. The carry-forward mapper ~90 lines down maps them correctly, so
    // a CARRIED card kept its volume while a NEWLY RECEIVED one lost it, and
    // the register measured the new bottle against a 28 g category default.
    // Carried straight through; never re-derived here.
    net_weight_grams: it.net_weight_grams ?? null,
    net_volume_ml: it.net_volume_ml ?? null,
    fact_provenance: it.fact_provenance,""",
    "S3 masteredToSnapshot",
)

# ── SEAM 4: intake-menu-staging.ts — persist onto inventory_lots ───────────
P4 = "src/lib/pos/intake-menu-staging.ts"

edit(
    P4,
    """            ratio_label: facts.ratio_label,
            fact_provenance: facts.fact_provenance,""",
    """            ratio_label: facts.ratio_label,
            // SLICE L3: the package measure on the golden record.
            net_weight_grams: facts.net_weight_grams,
            net_volume_ml: facts.net_volume_ml,
            fact_provenance: facts.fact_provenance,""",
    "S4 lot persistence",
)

# ── SEAM 5: live-menu.ts — map the column onto the register/website item ───
P5 = "src/lib/pos/live-menu.ts"

edit(
    P5,
    """    otherwiseTaken: row.otherwise_taken ?? null,
    unitsPerPackage: row.units_per_package ?? null,""",
    """    otherwiseTaken: row.otherwise_taken ?? null,
    unitsPerPackage: row.units_per_package ?? null,
    // SLICE L3 -- the physical package measure. menu-version.ts selects "*",
    // so the column was ALREADY arriving here and was simply never mapped;
    // the register therefore had no volume to measure and fell back to the
    // 28 g liquid default (a 1.5 L bottle counted as one ounce).
    // `?? null` keeps a pre-0138 database reading as "unknown", never zero.
    netWeightGrams: row.net_weight_grams ?? null,
    netVolumeMl: row.net_volume_ml ?? null,""",
    "S5 live-menu mapping",
)

# ── SEAM 6: leafly/types.ts — the shared item shape ────────────────────────
P6 = "src/lib/leafly/types.ts"

edit(
    P6,
    """  /** SLICE 17 \u2014 individual consumable items per package (RCW 69.50.101). */
  unitsPerPackage?: number | null;""",
    """  /** SLICE 17 \u2014 individual consumable items per package (RCW 69.50.101). */
  unitsPerPackage?: number | null;
  /**
   * SLICE L3 \u2014 the PHYSICAL package measure (migration 0138), normalised.
   *
   * netVolumeMl is what the liquid sales limit is measured against: the cap is
   * 72 FLUID ounces (2129.3 ml), so a volume in ml is the only basis that can
   * enforce it. Before L3 nothing populated it and the engine substituted a
   * 28 g category default for every liquid regardless of bottle size.
   *
   * PER PACKAGE, not per unit. Absent/null = not measured = the register must
   * fail closed rather than assume a size.
   */
  netWeightGrams?: number | null;
  netVolumeMl?: number | null;""",
    "S6 GreenwayMenuItem",
)


def main():
    changed = []
    for path, old, new, label in EDITS:
        with open(path, "r", encoding="utf-8") as fh:
            src = fh.read()
        n = src.count(old)
        if n != 1:
            print(f"ABORT [{label}] {path}: anchor found {n} times, expected exactly 1")
            sys.exit(1)
        out = src.replace(old, new, 1)
        if out == src:
            print(f"ABORT [{label}] {path}: replacement was a no-op")
            sys.exit(1)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(out)
        # verify on disk
        with open(path, "r", encoding="utf-8") as fh:
            back = fh.read()
        if back != out:
            print(f"ABORT [{label}] {path}: disk content does not match")
            sys.exit(1)
        changed.append(label)
        print(f"OK   [{label}] {path}")
    print(f"\n{len(changed)}/{len(EDITS)} edits applied and verified on disk.")


if __name__ == "__main__":
    main()
