/**
 * tests/compliance/receiving-volume-gate.test.ts  (SLICE L5)
 *
 * THE GAP THIS CLOSES, stated exactly as it was found in source:
 *
 * SLICE L3 already derives a package volume at receiving
 * (draft-injection-core.ts) and writes net_volume_ml. When it derives NOTHING
 * it pushes a `net_volume_missing` diagnostic at severity "warning" — and
 * grepping every caller showed that nothing gates on it.
 *
 * So an unmeasured liquid onboarded anyway. The limit engine then had no volume
 * to measure, fell back to DEFAULT_UNIT_GRAMS["edible-liquid"] = 28 g, and
 * EXACTLY 72 packages of any size fit the 72 fl oz cap — a 1.5 L bottle counted
 * the same as a 30 ml tincture. That is the owner's original bug arriving
 * through the door every product uses after the Cultivera cutover.
 *
 * A warning nobody is required to read is not a gate.
 *
 * WHY IT BLOCKS RATHER THAN PROMPTS. Migration 0217 set the house rule: does
 * silence DISABLE a statutory limit? For volume it does — so this gate refuses
 * the approval, exactly as otherwise_taken does. `promptsLowThcLiquid`, whose
 * silence only ever costs us a lawful sale, still merely asks. These tests pin
 * that asymmetry so it can never be mistaken for an oversight and "tidied".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assessReceivingVolume,
  validateReceivingVolumeChoice,
  volumePickerPlaceholder,
  assessReceivingClassification,
  RECEIVING_CLASSIFICATION_PROVENANCE,
} from "../../src/lib/inventory/receiving-classification-core";
import { extractNameFacts } from "../../src/lib/inventory/fact-extraction-core";
import { deriveNetVolumeMl } from "../../src/lib/compliance/liquid-volume-derivation-core";
import {
  ML_PER_FLUID_OUNCE,
  REC_LIQUID_ML,
} from "../../src/lib/compliance/liquid-volume-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const GATED = { needsVolumePick: true } as const;
const UNGATED = { needsVolumePick: false } as const;

/** Derive a volume from a product name the way receiving actually does. */
function derivedFor(name: string): number | null {
  const facts = extractNameFacts(name);
  return deriveNetVolumeMl({
    rawName: name,
    sizes: facts.sizes,
    packCount: facts.packCount,
  }).netVolumeMl;
}

describe("L5 — when the gate fires", () => {
  it("REQUIRES a measurement for a liquid whose name states no size", () => {
    const a = assessReceivingVolume({
      resolvedWebsiteCategory: "edible-liquid",
      derivedVolumeMl: derivedFor("Ray's Lemonade"),
    });
    expect(a.isVolumeMeteredShelf).toBe(true);
    expect(a.derivedVolumeMl).toBeNull();
    expect(a.needsVolumePick).toBe(true);
  });

  it("does NOT re-ask when the name already stated the size", () => {
    // Real names, run through the real extractor — not hand-fed numbers.
    for (const name of [
      "Fairwinds Sleepy Time Tincture 30ml",
      "Happy Apple Cider 1L",
      "Ceres Quencher Lemonade 12 fl oz",
      "Ray's Lemonade 4 x 50ml",
    ]) {
      const derived = derivedFor(name);
      expect(derived).not.toBeNull();
      expect(
        assessReceivingVolume({
          resolvedWebsiteCategory: "edible-liquid",
          derivedVolumeMl: derived,
        }).needsVolumePick,
      ).toBe(false);
    }
  });

  it("stays silent on shelves a volume answer could not affect", () => {
    for (const category of ["flower", "concentrate", "edible-solid", "cartridge", "merch", null]) {
      expect(
        assessReceivingVolume({ resolvedWebsiteCategory: category, derivedVolumeMl: null })
          .needsVolumePick,
      ).toBe(false);
    }
  });

  it("covers every shelf the limit engine meters in millilitres", () => {
    // If a category is ever added to the liquid bucket, it must land in the
    // gate automatically — this is why the gate asks categoryToBucket rather
    // than keeping its own list.
    for (const category of ["edible-liquid", "tincture", "topical"]) {
      expect(
        assessReceivingVolume({ resolvedWebsiteCategory: category, derivedVolumeMl: null })
          .needsVolumePick,
      ).toBe(true);
    }
  });

  it("treats a junk derived volume as no measurement at all", () => {
    // 0 is the dangerous one: the engine would read it as free of the limit.
    for (const junk of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const a = assessReceivingVolume({
        resolvedWebsiteCategory: "edible-liquid",
        derivedVolumeMl: junk,
      });
      expect(a.derivedVolumeMl).toBeNull();
      expect(a.needsVolumePick).toBe(true);
    }
  });

  it("ignores surrounding whitespace on the category", () => {
    expect(
      assessReceivingVolume({ resolvedWebsiteCategory: "  edible-liquid  ", derivedVolumeMl: null })
        .needsVolumePick,
    ).toBe(true);
  });
});

describe("L5 — the gate refuses rather than coerces", () => {
  it("blocks an approval that skips the measurement", () => {
    const r = validateReceivingVolumeChoice({ assessment: GATED });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("volume_required");
      // The message has to tell the receiver what to DO, not just that they failed.
      expect(r.error).toMatch(/volume printed on the package/i);
    }
  });

  it("blocks a quantity with no unit, and a unit with no quantity", () => {
    // MUTATION M10 (`||` -> `&&`) proved this needed more than `.ok === false`.
    // Measured, not assumed: with `&&` the mutant STILL refuses all three
    // partial cases, so nothing over-sells -- but it refuses them as
    // "volume_unit_required" / "volume_invalid", losing the one message that
    // tells the receiver what to DO. A half-answered gate is the SAME failure
    // as an unanswered one, so it must be reported as the same failure.
    const partials: Array<[string, string | null, string | null]> = [
      ["quantity with no unit", "750", null],
      ["unit with no quantity", null, "ml"],
      ["neither", null, null],
    ];
    for (const [label, volumeQuantity, volumeUnit] of partials) {
      const r = validateReceivingVolumeChoice({
        assessment: GATED,
        volumeQuantity,
        volumeUnit,
      });
      expect(r.ok, label).toBe(false);
      if (!r.ok) {
        expect(r.code, label).toBe("volume_required");
        expect(r.error, label).toMatch(/volume printed on the package/i);
      }
    }
  });

  it("REFUSES a bare ounce instead of guessing a density", () => {
    for (const unit of ["oz", "OZ", "ounce", "ounces"]) {
      const r = validateReceivingVolumeChoice({
        assessment: GATED,
        volumeQuantity: "12",
        volumeUnit: unit,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("volume_unit_ambiguous");
        // It must explain WHY, or the receiver will simply try again.
        expect(r.error).toMatch(/FLUID ounce/);
        expect(r.error).toMatch(/WEIGHT ounce/);
      }
    }
  });

  it("refuses junk quantities rather than parsing something out of them", () => {
    for (const bad of ["abc", "12abc", "-5", "1e3", "1,5", ".", "..", "0", "0.0", " ", "١٢"]) {
      const r = validateReceivingVolumeChoice({
        assessment: GATED,
        volumeQuantity: bad,
        volumeUnit: "ml",
      });
      expect(r.ok).toBe(false);
    }
  });

  it("refuses an unrecognised unit", () => {
    for (const unit of ["gal", "g", "mg", "cups", "litres!", "fl"]) {
      expect(
        validateReceivingVolumeChoice({
          assessment: GATED,
          volumeQuantity: "12",
          volumeUnit: unit,
        }).ok,
      ).toBe(false);
    }
  });
});

describe("L5 — what the gate accepts, and in what unit", () => {
  it("stores millilitres as millilitres", () => {
    const r = validateReceivingVolumeChoice({
      assessment: GATED,
      volumeQuantity: "750",
      volumeUnit: "ml",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.netVolumeMl).toBe(750);
      expect(r.provenance).toBe(RECEIVING_CLASSIFICATION_PROVENANCE.human);
    }
  });

  it("converts litres and FLUID ounces with the statutory constants", () => {
    const litre = validateReceivingVolumeChoice({
      assessment: GATED,
      volumeQuantity: "1.5",
      volumeUnit: "l",
    });
    expect(litre.ok && litre.netVolumeMl).toBe(1500);

    const floz = validateReceivingVolumeChoice({
      assessment: GATED,
      volumeQuantity: "12",
      volumeUnit: "floz",
    });
    // 12 x 29.5735 = 354.882 — NOT 12 x 28. This is the owner's Q1 decision.
    expect(floz.ok && floz.netVolumeMl).toBeCloseTo(12 * ML_PER_FLUID_OUNCE, 6);
    expect(floz.ok && floz.netVolumeMl).not.toBeCloseTo(12 * 28, 1);
  });

  it("accepts 'fl oz' written with a space", () => {
    const r = validateReceivingVolumeChoice({
      assessment: GATED,
      volumeQuantity: "2",
      volumeUnit: "fl oz",
    });
    expect(r.ok && r.netVolumeMl).toBeCloseTo(2 * ML_PER_FLUID_OUNCE, 6);
  });

  it("is case-insensitive about the unit", () => {
    const r = validateReceivingVolumeChoice({
      assessment: GATED,
      volumeQuantity: "1",
      volumeUnit: "L",
    });
    expect(r.ok && r.netVolumeMl).toBe(1000);
  });

  it("produces a figure the SALES limit can actually be measured against", () => {
    // The whole point: one measured bottle, metered against the real cap.
    const r = validateReceivingVolumeChoice({
      assessment: GATED,
      volumeQuantity: "1.5",
      volumeUnit: "l",
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.netVolumeMl !== null) {
      // A single 1.5 L bottle is already most of a recreational limit, and two
      // are over it. Before L5 this product had NO volume and 72 of them sold.
      expect(r.netVolumeMl).toBeLessThan(REC_LIQUID_ML);
      expect(r.netVolumeMl * 2).toBeGreaterThan(REC_LIQUID_ML);
    }
  });
});

describe("L5 — the ungated path invents nothing", () => {
  it("stores no volume and says plainly that nobody was asked", () => {
    const r = validateReceivingVolumeChoice({ assessment: UNGATED });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.netVolumeMl).toBeNull();
      expect(r.provenance).toBe(RECEIVING_CLASSIFICATION_PROVENANCE.unanswered);
    }
  });

  it("still honours a volunteered measurement", () => {
    const r = validateReceivingVolumeChoice({
      assessment: UNGATED,
      volumeQuantity: "30",
      volumeUnit: "ml",
    });
    expect(r.ok && r.netVolumeMl).toBe(30);
  });

  it("holds a volunteered measurement to exactly the same rules", () => {
    // A value nobody had to give is still a value the register will enforce.
    expect(
      validateReceivingVolumeChoice({
        assessment: UNGATED,
        volumeQuantity: "12",
        volumeUnit: "oz",
      }).ok,
    ).toBe(false);
    expect(
      validateReceivingVolumeChoice({
        assessment: UNGATED,
        volumeQuantity: "abc",
        volumeUnit: "ml",
      }).ok,
    ).toBe(false);
  });
});

describe("L5 — the asymmetry between the three gates is deliberate", () => {
  it("volume BLOCKS, low-THC only PROMPTS, on the very same product", () => {
    const category = "edible-liquid";
    const classification = assessReceivingClassification({
      productName: "Ray's Lemonade",
      inventoryType: "Liquid Edible",
      resolvedWebsiteCategory: category,
    });
    const volume = assessReceivingVolume({
      resolvedWebsiteCategory: category,
      derivedVolumeMl: null,
    });

    // Silence about volume DISABLES the 72 fl oz cap -> it must block.
    expect(volume.needsVolumePick).toBe(true);
    expect(validateReceivingVolumeChoice({ assessment: volume }).ok).toBe(false);

    // Silence about low-THC only keeps the TIGHTER bucket -> it must not block.
    expect(classification.promptsLowThcLiquid).toBe(true);
    expect(classification.needsOtherwiseTakenPick).toBe(true);
  });

  it("the placeholder tells the truth about what leaving it alone means", () => {
    expect(volumePickerPlaceholder({ needsVolumePick: true })).toMatch(/required/i);
    expect(volumePickerPlaceholder({ needsVolumePick: false })).not.toMatch(/required/i);
  });
});

describe("L5 — the wiring, without which the gate is decoration", () => {
  it("the approval path runs the gate and refuses on failure", () => {
    const src = read("src/lib/inventory/catalog-drafts.ts");
    expect(src).toContain("assessReceivingVolume({");
    expect(src).toContain("validateReceivingVolumeChoice({");
    expect(src).toMatch(/if \(!volume\.ok\) \{\s*return \{ ok: false, error: volume\.error \};/);
  });

  it("the approval path derives the volume SERVER-SIDE, never from the form", () => {
    const src = read("src/lib/inventory/catalog-drafts.ts");
    // It must use the same pair injection uses, on the row it already loaded.
    expect(src).toContain("const derivedFacts = extractNameFacts(row?.name ?? null);");
    expect(src).toContain("deriveNetVolumeMl({");
    // MUTATION M15: deriving the volume and then not USING it is the same as
    // never deriving it -- a hardcoded truthy value makes the server believe
    // every liquid is already measured, so the gate never fires and the whole
    // slice becomes decoration. The derived result must be what is assessed.
    expect(src).toContain("derivedVolumeMl: derivedVolume.netVolumeMl,");
    expect(src).toMatch(
      /const volumeAssessment = assessReceivingVolume\(\{[\s\S]*?derivedVolumeMl: derivedVolume\.netVolumeMl,[\s\S]*?\}\);/,
    );
    // The form's own idea of the derived volume must never be consulted.
    expect(src).not.toMatch(/derivedVolumeMl: classification\?\./);
  });

  it("the measured volume is persisted only when a human gave one", () => {
    const src = read("src/lib/inventory/catalog-drafts.ts");
    expect(src).toContain(
      "if (volume.netVolumeMl !== null) update.chosen_net_volume_ml = volume.netVolumeMl;",
    );
  });

  it("injection carries the measurement to the menu and prefers the human", () => {
    const src = read("src/lib/pos/draft-injection-core.ts");
    expect(src).toContain("const measured = d.chosen_net_volume_ml;");
    expect(src).toContain('factProvenance.net_volume_ml = "human";');
    // The human branch must come FIRST, or the name derivation would win.
    expect(src.indexOf('factProvenance.net_volume_ml = "human";')).toBeLessThan(
      src.indexOf("factProvenance.net_volume_ml = vol.source;"),
    );
  });

  it("injection actually SELECTS the column, or it would always be undefined", () => {
    expect(read("src/lib/pos/draft-injection.ts")).toContain(", chosen_net_volume_ml");
  });

  it("the receiver has a way to answer, and the action forwards it", () => {
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page).toContain('name="net_volume_quantity"');
    expect(page).toContain('name="net_volume_unit"');
    expect(page).toContain("va?.needsVolumePick");
    const actions = read("src/app/admin/inventory/drafts/actions.ts");
    expect(actions).toContain('formData.get("net_volume_quantity")');
    expect(actions).toContain('formData.get("net_volume_unit")');
    expect(actions).toMatch(/volumeQuantity,\s*volumeUnit,/);
  });

  it("migration 0224 adds the column, nullable and without a backfill", () => {
    const sql = read("supabase/migrations/0224_receiving_volume_gate.sql");
    expect(sql).toContain("add column if not exists chosen_net_volume_ml numeric(12,3)");
    expect(sql).not.toMatch(/\bupdate\s+public\.catalog_product_drafts\b/i);
    expect(sql).not.toMatch(/not null/i);
  });
});
