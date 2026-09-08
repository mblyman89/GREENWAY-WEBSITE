/**
 * tests/compliance/liquid-litre-parsing.test.ts  (SLICE L2)
 *
 * Litres were invisible to EVERY size parser in the codebase, and a bottle is
 * the biggest liquid we sell -- so the invisible unit was also the most
 * expensive one.
 *
 * WHAT WAS BROKEN (measured during recon, not recalled)
 * ----------------------------------------------------
 * Three independent parsers, none of which had a litre branch:
 *
 *   1. transform.ts parsePackageSize      -- the one-time Cultivera import
 *   2. transform.ts packageFromParts      -- name-derived sizes
 *   3. fact-extraction-core extractNameFacts -- our own receiving pipeline
 *
 * In (1) a "1L" package size fell through every `.replace()` and landed in the
 * `each` branch, so the register received the product with NO size at all. The
 * limit engine then applied its 28 g/unit default and allowed 72 litre bottles
 * -- 72,000 ml against a 2,129 ml cap.
 *
 * (3) is the one that matters going forward: the owner's ruling is that the
 * Cultivera import is a one-time migration and "all products will enter the
 * system through receiving", so a litre hole in OUR extractor would have
 * outlived the migration it was found in. Both are fixed here.
 *
 * A SEPARATE BUG FOUND WHILE FIXING THIS
 * --------------------------------------
 * packageFromParts mapped `fl oz -> "oz"`. Its sibling parsePackageSize, 30
 * lines above in the same file, mapped it to `"floz"`. So a name-derived
 * "12 fl oz" beverage was recorded as TWELVE WEIGHT OUNCES (336 g of net
 * weight) with no volume at all, while the identical product read from the
 * Package Size column was recorded correctly. Two normalisers, one file,
 * opposite answers. Pinned below so they can never diverge again.
 *
 * THE BARE `l` HAZARD
 * -------------------
 * `l` is a real unit and also the first letter of "lb", "lbs", "lot", "large"
 * and "lid". Every pattern added in this slice is fenced -- anchored, or
 * followed by a non-letter assertion -- and the strings below are the actual
 * shapes of cannabis product wording that must NOT parse as litres.
 */
import { describe, expect, it } from "vitest";
import { extractNameFacts } from "../../src/lib/inventory/fact-extraction-core";
import {
  ML_PER_FLUID_OUNCE,
  ML_PER_LITRE,
  REC_LIQUID_ML,
} from "../../src/lib/compliance/liquid-volume-core";

/** Convenience: the size list extractNameFacts found, as a compact string. */
const sizesOf = (name: string) =>
  extractNameFacts(name).sizes.map((s) => `${s.quantity}${s.unit}`);

describe("SLICE L2 -- extractNameFacts now sees litres", () => {
  it("reads a litre bottle, which previously extracted NOTHING", () => {
    expect(sizesOf("Tonic 1L Bottle")).toContain("1l");
    expect(sizesOf("Lemonade 1.5 L")).toContain("1.5l");
    expect(sizesOf("Big Bottle 1 Liter")).toContain("1l");
    expect(sizesOf("Elixir 2 Litre")).toContain("2l");
    expect(sizesOf("Elixir 2 Litres")).toContain("2l");
  });

  it("still reads every unit it read before (no regression)", () => {
    expect(sizesOf("Shot 750ml")).toContain("750ml");
    expect(sizesOf("Tincture 30ml")).toContain("30ml");
    expect(sizesOf("Hi-Fi Hops 12 fl oz")).toContain("12floz");
    expect(sizesOf("Drops 1.7 oz")).toContain("1.7oz");
    expect(sizesOf("Cookie 3.5g")).toContain("3.5g");
  });

  it("does NOT read 'mL' as litres -- ml is consumed first", () => {
    // If LITRE_RE ran before ML_RE, "750 mL" would become 750 LITRES and the
    // product would be recorded as 750,000 ml. This ordering is load-bearing
    // in this file (unlike liquid-volume-core, whose patterns are anchored).
    const s = sizesOf("Shot 750 mL");
    expect(s).toContain("750ml");
    expect(s).not.toContain("750l");
  });

  it("does NOT read pounds, lots, sizes or lids as litres", () => {
    // The real-wording probe. Each of these would be a silent mis-measure.
    for (const name of [
      "Blue Dream 2 Lb",
      "Blue Dream 2 lbs",
      "Sour 5 Lot",
      "Gummy 3 Large",
      "Jar 1 Lid",
      "XL Gummy 10mg",
    ]) {
      const s = extractNameFacts(name).sizes;
      expect(s.some((x) => x.unit === "l")).toBe(false);
    }
  });

  it("keeps milligram potency out of the size list", () => {
    // A bare mg figure is a DOSE, never a package measure. Guarding this here
    // because the litre pattern sits immediately after the ml pattern, and a
    // greedy edit could start eating "10mg".
    expect(extractNameFacts("XL Gummy 10mg").sizes).toHaveLength(0);
  });
});

describe("SLICE L2 -- the litre volume is worth the right number of units", () => {
  // These are the numbers that were wrong. The old system allowed 72 of each.
  it("a 1 L bottle is 1000 ml, so only 2 fit in the cap", () => {
    expect(1 * ML_PER_LITRE).toBe(1000);
    expect(Math.floor(REC_LIQUID_ML / 1000)).toBe(2);
  });

  it("a 1.5 L bottle allows exactly 1 -- the 72x over-sale case", () => {
    expect(Math.floor(REC_LIQUID_ML / (1.5 * ML_PER_LITRE))).toBe(1);
  });

  it("a 12 fl oz can allows 6, not 72", () => {
    expect(Math.floor(REC_LIQUID_ML / (12 * ML_PER_FLUID_OUNCE))).toBe(6);
  });
});

describe("SLICE L2 -- the two normalisers in transform.ts must agree", () => {
  /**
   * parsePackageSize and packageFromParts are both private to transform.ts, so
   * they are tested through the SOURCE rather than by calling them. That is
   * deliberate: exporting them purely for tests would widen the surface of the
   * one-time-migration module, and the owner's standing instruction is that
   * receiving -- not the importer -- is the durable path.
   *
   * A source assertion is weaker than a behavioural one, so each check below
   * targets the exact token that carried the bug.
   */
  const SRC = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    return fs.readFileSync("src/lib/pos/transform.ts", "utf8");
  })();

  it("packageFromParts no longer flattens fl oz into weight ounces", () => {
    // THE BUG: `.replace(/fluid\s*ounces?|fluidounce|fl\.?\s*oz/, "oz")`.
    // A name-derived "12 fl oz" became 12 weight ounces = 336 g.
    const fn = SRC.slice(SRC.indexOf("function packageFromParts"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain('fl\\.?\\s*oz/, "floz"');
    expect(body).not.toContain('fl\\.?\\s*oz/, "oz"');
  });

  it("both normalisers recognise litres", () => {
    // Two occurrences: one per normaliser.
    const litreRules = SRC.match(/\^\(\?:liters\?\|litres\?\|l\)\$/g) ?? [];
    expect(litreRules.length).toBeGreaterThanOrEqual(2);
  });

  it("the litre rule is anchored so 'lb' and 'lot' cannot match", () => {
    // An unanchored /l/ replace would rewrite the first letter of any unit.
    expect(SRC).toContain('.replace(/^(?:liters?|litres?|l)$/, "l")');
  });

  it("millilitres are normalised BEFORE litres in both normalisers", () => {
    // Otherwise "milliliters" would be shortened to "l".
    const mlRules = SRC.match(/milliliters\?\|millilitres\?\/, "ml"/g) ?? [];
    expect(mlRules.length).toBeGreaterThanOrEqual(2);
    for (const fnName of ["function parsePackageSize", "function packageFromParts"]) {
      const fn = SRC.slice(SRC.indexOf(fnName));
      const body = fn.slice(0, fn.indexOf("\n}"));
      expect(body.indexOf('"ml"')).toBeLessThan(body.indexOf('litres?|l)$/, "l"'));
    }
  });

  it("litres reach net_volume_ml, CONVERTED, using the shared constant", () => {
    // The derivation previously had no litre branch, and used a hand-copied
    // 29.5735 for fl oz. Both now come from liquid-volume-core.
    //
    // Asserting `toContain("ML_PER_LITRE")` alone is NOT enough: the mutation
    // harness proved that dropping the multiplication (recording a 1 L bottle
    // as 1 ml) still left the identifier present elsewhere in the file and the
    // test passed. So pin the whole multiplying expression.
    expect(SRC).toContain('else if (pkgMeasure.unit === "l") netVolumeMl = pkgMeasure.quantity * ML_PER_LITRE;');
    expect(SRC).toContain('else if (pkgMeasure.unit === "floz") netVolumeMl = pkgMeasure.quantity * ML_PER_FLUID_OUNCE;');
    // A bare `= pkgMeasure.quantity` for either volume unit means an
    // unconverted figure, which is a 1000x under-count for litres.
    expect(SRC).not.toMatch(/unit === "l"\) netVolumeMl = pkgMeasure\.quantity;/);
    expect(SRC).not.toMatch(/unit === "floz"\) netVolumeMl = pkgMeasure\.quantity;/);
    expect(SRC).not.toContain("pkgMeasure.quantity * 29.5735");
  });

  it("the name-level volume regex reads litres and is not shadowed by ml", () => {
    // M14/M15 from the mutation harness: the earlier version of this suite
    // never touched the name-level regex, so deleting litres from it -- or
    // reordering the alternation so the bare `l` matched the start of
    // "milliliters" -- both went undetected.
    //
    // The regex is extracted from source and executed here, which makes this a
    // real behavioural test of a function that is private to the module.
    const m = SRC.match(/const volume = name\.match\((\/[^\n]+\/i)\);/);
    expect(m).not.toBeNull();
    const re = Function(`"use strict"; return (${m![1]});`)() as RegExp;

    // litres must be readable...
    expect("Tonic 1L".match(re)?.[2]?.toLowerCase()).toBe("l");
    expect("Tonic 1.5 L".match(re)?.[2]?.toLowerCase()).toBe("l");
    expect("Tonic 2 Litre".match(re)?.[2]?.toLowerCase()).toBe("litre");
    // ...and millilitres must NOT be captured as a bare litre.
    expect("Shot 750ml".match(re)?.[2]?.toLowerCase()).toBe("ml");
    expect("Shot 100 milliliters".match(re)?.[2]?.toLowerCase()).toBe("milliliters");
    // fl oz keeps its own identity rather than degrading to oz.
    expect("Hops 12 fl oz".match(re)?.[2]?.toLowerCase()).toBe("fl oz");
  });

  it("a litre package is treated as a REAL physical measure", () => {
    // REAL_MEASURE_UNITS decides whether the Package Size column outranks a
    // name-derived guess. Omitting "l" would let a name potency win over a
    // real litre column.
    expect(SRC).toContain('new Set(["g", "oz", "floz", "ml", "l"])');
  });

  it("a litre package renders an uppercase L label", () => {
    // volumeMlFromLabel() parses "1L", so the label the importer writes has to
    // round-trip back through the limit engine.
    expect(SRC).toContain('label = `${formatNumber(quantity)}L`');
  });
});
