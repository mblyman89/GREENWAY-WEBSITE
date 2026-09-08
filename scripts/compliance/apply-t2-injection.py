#!/usr/bin/env python3
"""
T2/T3 — measure EVERY product in the ml-metered bucket, not two type strings.

Injection's fact block is gated on MG_FACT_TYPES.has(invType), and the volume
diagnostic on a second hand-maintained list, LIQUID_VOLUME_TYPES. Measured
every inventory type that resolves into the liquid bucket: only "Liquid Edible"
and "Tincture" are in both. Beverage, Soda, Shots, Liquid Infused Edible,
Other Liquid Edible, Topical, Bath Salts, Roll On, Suppository and Transdermal
Patch are in NEITHER -- so injection derives no volume for them at all and the
register falls back to 28 g/unit.

This adds ONE bucket-scoped pass, placed after the `if (exam)` block so it can
see whatever that block already recorded and only fills genuine gaps. Scope is
taken from categoryToBucket(websiteCategory), which is the thing the limit
actually keys on.
"""
import io
import sys

INJ = "src/lib/pos/draft-injection-core.ts"


def patch(path: str, old: str, new: str, label: str) -> None:
    """Apply once, verified on disk.

    The idempotency check must handle the APPEND case, where `old` is a
    substring of `new`. Checking `new in t and old not in t` silently fails
    there and applies the edit a SECOND time -- which is exactly what happened
    on the first run of this script and produced two copies of the pass.
    Counting `new` is the check that actually holds in both shapes.
    """
    t = io.open(path, encoding="utf-8").read()
    if t.count(new) == 1:
        print(f"  {label}: already applied")
        return
    assert t.count(new) == 0, f"{label}: found {t.count(new)} copies of the new text"
    n = t.count(old)
    assert n == 1, f"{label}: anchor matched {n}x (expected 1)"
    io.open(path, "w", encoding="utf-8").write(t.replace(old, new, 1))
    back = io.open(path, encoding="utf-8").read()
    assert back.count(new) == 1, f"{label}: did not land on disk"
    if old not in new:
        assert old not in back, f"{label}: old text survived"
    print(f"  {label}: applied")


ANCHOR = """    // SLICE 63 (owner bugs B2/E1): derive OUR house type (\"Live Resin
    // Cartridge\", \"Gummies\") from the LCB inventory type + product NAME so"""

NEW = """    // ── SLICE T2/T3: MEASURE THE WHOLE BUCKET, NOT TWO TYPE STRINGS ────────
    //
    // Everything above runs only when MG_FACT_TYPES.has(invType). That set was
    // built for POTENCY extraction, and using it to decide who gets MEASURED
    // silently excluded most of the limited shelf. Measured, every inventory
    // type that resolves into the ml-metered bucket:
    //
    //   in both lists : Liquid Edible, Tincture
    //   in NEITHER    : Beverage, Soda, Shots, Liquid Infused Edible,
    //                   Other Liquid Edible, Topical, Bath Salts, Roll On,
    //                   Suppository, Transdermal Patch
    //
    // So an ordinary Soda got no volume even when its name stated one, and the
    // register fell back to DEFAULT_UNIT_GRAMS = 28 g/unit: 72 units passed at
    // exactly the cap. A 12 fl oz soda x 72 = 864 fl oz against a 72 fl oz cap
    // is a 12x oversell -- the very defect the liquids round existed to close,
    // still open on nine of the eleven types that reach the bucket.
    //
    // The scope here is the BUCKET, because the bucket is what the limit keys
    // on. A hand-maintained list of type strings is a second source of truth
    // that drifts the moment anyone adds \"Seltzer\", and it drifted already.
    //
    // This pass only FILLS GAPS: it never overwrites a measure the block above
    // established, so nothing that is already correct can move.
    if (categoryToBucket(websiteCategory) === \"liquid_edible\") {
      const bucketFacts = extractNameFacts(d.name);
      if (netVolumeMl === null) {
        const bucketVol = deriveNetVolumeMl({
          rawName: d.name,
          sizes: bucketFacts.sizes,
          packCount: bucketFacts.packCount,
        });
        if (bucketVol.netVolumeMl !== null && bucketVol.source !== null) {
          netVolumeMl = bucketVol.netVolumeMl;
          factProvenance.net_volume_ml = bucketVol.source;
        }
      }
      if (netWeightGrams === null) {
        // A weight is an EXACT measure in this bucket, not a fallback guess:
        // lineMl() carries an ounce-count across as an ounce-count, so a 2 oz
        // salve meters at exactly 36 units against the 72 oz cap. No density
        // is invented anywhere.
        const bucketGrams = deriveNetWeightGrams(bucketFacts.sizes);
        if (bucketGrams !== null) {
          netWeightGrams = bucketGrams;
          factProvenance.net_weight_grams = \"name\";
        }
      }
      // Silence is what made this bucket dangerous, so an unmeasurable line
      // says so ONCE, here, for every type in the bucket -- rather than only
      // for the two that happened to be on the old list.
      if (netVolumeMl === null && netWeightGrams === null) {
        diagnostics.push({
          severity: \"warning\",
          code: \"net_volume_missing\",
          message:
            \"This product counts against the 72 fluid ounce limit but has no package size, so the limit cannot be measured.\",
          context: {
            draft_id: d.id,
            pos_product_key: key,
            productName: d.name,
            displayName: d.name,
            inventoryType: invType,
            websiteCategory,
          },
        });
      }
    }

    // SLICE 63 (owner bugs B2/E1): derive OUR house type (\"Live Resin
    // Cartridge\", \"Gummies\") from the LCB inventory type + product NAME so"""

patch(INJ, ANCHOR, NEW, "bucket-scoped measurement pass")

# ---- imports ---------------------------------------------------------------
# extractNameFacts: the extractor the bucket pass parses sizes with. Imported
# from the same module the potency path already uses, so there is exactly one
# name parser in this file.
patch(
    INJ,
    'import { crossExamineRow, MG_FACT_TYPES } from "@/lib/inventory/fact-extraction-core";',
    'import {\n'
    '  crossExamineRow,\n'
    '  extractNameFacts,\n'
    '  MG_FACT_TYPES,\n'
    '} from "@/lib/inventory/fact-extraction-core";',
    "extractNameFacts import",
)

# categoryToBucket: the bucket is what the limit keys on, so scope is taken
# from it rather than from a hand-maintained list of inventory-type strings.
patch(
    INJ,
    'import { deriveHouseType, HOUSE_TYPE_MIN_AUTO_CONFIDENCE } from "@/lib/inventory/house-type-core";',
    'import { deriveHouseType, HOUSE_TYPE_MIN_AUTO_CONFIDENCE } from "@/lib/inventory/house-type-core";\n'
    'import { categoryToBucket } from "@/lib/compliance/sales-limits-core";',
    "categoryToBucket import",
)

print("T2/T3 injection: done")
sys.exit(0)
