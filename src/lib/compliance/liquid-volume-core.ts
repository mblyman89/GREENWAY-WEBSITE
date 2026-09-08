/**
 * src/lib/compliance/liquid-volume-core.ts  (SLICE L1)
 *
 * THE one home for liquid VOLUME in the sales-limit domain.
 *
 * WHY THIS MODULE EXISTS
 * ---------------------
 * WAC 314-55-095(1)(d)(i)(E) caps cannabis-infused liquid at "Seventy-two
 * ounces". Until this slice the engine expressed that cap in GRAMS as
 * `72 * STATUTORY_GRAMS_PER_OUNCE = 2016`, and the per-unit size came from
 * `gramsFromVariantLabel()`, whose regex matches only
 * `g|gram|grams|oz|ounce|ounces`.
 *
 * That combination is subtly and severely wrong, and it is worth being precise
 * about WHY, because the obvious reading of the bug is not the real one:
 *
 *   For an OUNCE-labelled liquid the grams basis is numerically CORRECT.
 *     engine:  2016 / (q * 28)            = 72 / q
 *     statute: (72 * 29.5735) / (q * 29.5735) = 72 / q
 *   The 28 cancels. `1oz -> 72`, `16oz -> 4`, `32oz -> 2` all enforce correctly
 *   today. Changing the 2016 constant alone would therefore fix NOTHING.
 *
 *   The defect is that `ml`, `fl oz` and `L` are absent from that regex, so
 *   they return null and the caller falls back to the category default of
 *   28 g/unit -- i.e. EXACTLY 72 units are allowed no matter the true size:
 *
 *     12 fl oz can    ->  72 allowed,   6 legal   12x OVERSELL
 *     500 ml bottle   ->  72 allowed,   4 legal   18x OVERSELL
 *     1.5 L bottle    ->  72 allowed,   1 legal   72x OVERSELL
 *     10 ml tincture  ->  72 allowed, 212 legal   UNDER-sells (refuses legal sales)
 *
 *   The same physical can spelled "12oz" enforces at 6 and spelled "12 fl oz"
 *   enforces at 72. That is the proof the unit BASIS is broken, not the number.
 *
 * OWNER DECISION (recorded, not inferred)
 * ---------------------------------------
 * The statute says "ounces", not "fluid ounces", and the text alone does not
 * disambiguate. Asked directly, the owner ruled: FLUID ounces, giving a
 * 2129.3 ml recreational cap -- "I want fluid ounces, so the 2129.3 ml cap.
 * I like consistency."
 *
 * WHY 29.5735 AND NOT 29.5735295625
 * ---------------------------------
 * 29.5735 is already the value hand-copied in transform.ts, card-cannabinoids.ts
 * and weight-display-core.ts. The true value changes the cap by 0.0021 ml
 * (1e-4 %). The owner reviewed the difference and ruled it immaterial, so this
 * module matches the existing convention rather than introducing a fourth
 * distinct constant. Named here so there is ONE arithmetic basis for the cap.
 *
 * SCOPE -- WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * --------------------------------------------------
 *  - It does NOT cover TOPICALS. Statute (E) does reach product "applied
 *    topically to the skin", and `categoryToBucket` currently routes `topical`
 *    into `liquid_edible` -- but a 2 oz salve jar is 2 ounces BY WEIGHT and
 *    converting it to ml needs a density we do not have. Owner decision:
 *    "I want to do the industry standard practice for topicals... Let's
 *    completely fix liquid edibles first, then we will fix topicals." Topicals
 *    keep the weight basis until that separate slice.
 *  - It does NOT cover LOW-THC liquids. Those are carved out by
 *    WAC 314-55-095(1)(d)(i)(F) into a 200 mg active-delta-9-THC bucket and are
 *    measured in mg, never in volume. Slice 16 owns that and stays untouched.
 *  - It returns null for unknown rather than defaulting. A silent default is
 *    precisely how the 28 g fallback caused a 72x oversell; this module will
 *    not repeat that mistake. Callers decide the fail-closed policy.
 *
 * PURE module -- no imports, no DOM, no I/O. Safe in client, server and tsx.
 */

// ---------------------------------------------------------------------------
// Statutory constants
// ---------------------------------------------------------------------------

/**
 * 1 US fluid ounce = 29.5735 ml.
 *
 * Matches the value already used by transform.ts, card-cannabinoids.ts and
 * weight-display-core.ts so the codebase has a single figure for fl oz -> ml.
 */
export const ML_PER_FLUID_OUNCE = 29.5735;

/** 1 litre = 1000 ml. */
export const ML_PER_LITRE = 1000;

/**
 * Recreational liquid cap: 72 FLUID ounces.
 * WAC 314-55-095(1)(d)(i)(E) -- "Seventy-two ounces of cannabis-infused
 * product in liquid form for oral ingestion or applied topically to the skin,
 * unless the product is packaged in individual units containing no more than
 * four milligrams of active delta-9 THC per unit".
 *
 * = 2129.292 ml. Derived from the constant, never hand-typed, so the cap and
 * the per-unit conversion can never drift apart.
 */
export const REC_LIQUID_FLUID_OUNCES = 72;
export const REC_LIQUID_ML = REC_LIQUID_FLUID_OUNCES * ML_PER_FLUID_OUNCE;

/**
 * Medical (DOH-recognised patient) liquid cap: 216 FLUID ounces.
 * WAC 314-55-095(2)(d) -- "...216 ounces of cannabis-infused product in liquid
 * form meant to be eaten or swallowed...". Exactly 3x the recreational figure,
 * which is the ratio every other bucket uses.
 *
 * NOTE the deliberate contrast with low-THC liquid, where the medical figure is
 * NOT tripled (it stays 200 mg). Do not "regularise" that one to match this.
 */
export const MED_LIQUID_FLUID_OUNCES = 216;
export const MED_LIQUID_ML = MED_LIQUID_FLUID_OUNCES * ML_PER_FLUID_OUNCE;

// ---------------------------------------------------------------------------
// Volume parsing
// ---------------------------------------------------------------------------

/**
 * A volume unit this module can normalise to ml.
 *
 * `oz` is ABSENT on purpose. A bare "oz" on a liquid is ambiguous -- it is a
 * fluid ounce on a beverage and a weight ounce on a salve -- and this module
 * refuses to guess which. `volumeMlFromLabel` therefore returns null for bare
 * ounces; see the note on that function.
 */
export type VolumeUnit = "ml" | "l" | "floz";

/** Convert a recognised volume quantity to millilitres. */
export function toMl(quantity: number, unit: VolumeUnit): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  switch (unit) {
    case "ml":
      return quantity;
    case "l":
      return quantity * ML_PER_LITRE;
    case "floz":
      return quantity * ML_PER_FLUID_OUNCE;
    default:
      return null;
  }
}

/**
 * `ml` / `milliliter(s)` / `millilitre(s)`.
 * Anchored with \b on both sides so "ml" inside a word cannot match.
 */
const ML_RE = /^(\d+(?:\.\d+)?)\s*(?:ml|milliliters?|millilitres?)$/i;

/**
 * `fl oz` / `fl. oz` / `floz` / `fluid ounce(s)`.
 * MUST be tried before any bare-ounce handling so "1.7 fl oz" is never read as
 * a weight ounce -- the same precedence discipline fact-extraction-core.ts
 * already documents at its stage 8.
 */
const FLOZ_RE = /^(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz|floz|fluid\s*ounces?)$/i;

/**
 * `l` / `L` / `liter(s)` / `litre(s)`.
 *
 * The bare `l` alternative is the risky one, so it is anchored (`$`) and the
 * whole label is matched end-to-end rather than searched. Verified against real
 * product wording -- "2 Lb", "5 Lot", "2 lbs", "XL Gummy" do NOT match, while
 * "1L", "1.5 L", "1 Liter", "2 Litre" do. ML_RE is tried first regardless, so
 * "750 mL" can never fall through to here.
 */
const LITRE_RE = /^(\d+(?:\.\d+)?)\s*(?:l|liters?|litres?)$/i;

/**
 * Parse a package-size label into millilitres, or null when the label carries
 * no unambiguous VOLUME.
 *
 * Returns null -- never a default -- for:
 *   - weight labels ("3.5g", "1oz"): grams are not volume
 *   - BARE ounces ("12oz"): ambiguous between fluid and weight. The liquid
 *     SIZE is still enforced correctly today through the existing grams path
 *     (see the cancellation proof in the file header), so returning null here
 *     is not a regression -- it is a refusal to invent a density.
 *   - pack/each labels ("4pk", "each"), empty, or unparseable input
 *
 * A null result is the caller's cue to apply its fail-closed policy, NOT to
 * substitute a category default.
 */
export function volumeMlFromLabel(label: string | null | undefined): number | null {
  if (typeof label !== "string") return null;
  const s = label.trim().replace(/\s+/g, " ");
  if (s === "") return null;

  // NOTE ON ORDERING -- measured, not assumed.
  // All three patterns are anchored end-to-end (^...$), which makes them
  // MUTUALLY EXCLUSIVE: LITRE_RE does not match "750 mL" and ML_RE does not
  // match "1L". Verified by probe. So this sequence is a readability choice,
  // NOT a correctness guard, and reordering it is a no-op.
  //
  // The actual safety mechanism is the `$` ANCHOR on LITRE_RE. Drop it and the
  // bare `l` alternative starts eating real product wording -- "5 Lot",
  // "2 Lb", "3 Large" and "1 Lid" all parse as litres. That is the edit to
  // fear, and tests/compliance/liquid-volume-core.test.ts pins it directly.
  const ml = ML_RE.exec(s);
  if (ml) return toMl(Number(ml[1]), "ml");

  const floz = FLOZ_RE.exec(s);
  if (floz) return toMl(Number(floz[1]), "floz");

  const litre = LITRE_RE.exec(s);
  if (litre) return toMl(Number(litre[1]), "l");

  return null;
}

/**
 * Total millilitres for a cart line: per-unit volume x quantity.
 * Returns null when either input is unusable, so "unknown" propagates rather
 * than silently becoming 0 (which would read as "free of the limit").
 */
export function lineVolumeMl(
  perUnitMl: number | null | undefined,
  quantity: number,
): number | null {
  if (typeof perUnitMl !== "number" || !Number.isFinite(perUnitMl) || perUnitMl <= 0) return null;
  if (!Number.isFinite(quantity)) return null;
  const q = Math.max(0, Math.round(quantity));
  if (q === 0) return 0;
  return perUnitMl * q;
}

/**
 * Resolve the per-UNIT millilitres for one sellable variant, from the two
 * sources the system actually has.
 *
 * PRECEDENCE IS THE WHOLE POINT, and it is the opposite of the obvious one.
 *
 * `variantLabel` describes THE THING BEING SOLD ("1.5L"). `cardNetVolumeMl` is
 * the menu CARD's measured net volume, and a card is a GROUP of variants:
 * src/lib/pos/transform.ts `groupingIdentity()` keys on brand + category +
 * strain + medical and DELIBERATELY omits package size, so one card routinely
 * holds a 750 ml and a 1.5 L lot. That card's netVolumeMl is taken from
 * `firstAvailable` -- the first variant WITH STOCK -- so it describes only one
 * of them. Preferring it would measure a 1.5 L bottle as 750 ml and let a
 * shopper buy 2 (3000 ml) against a 2129.292 ml cap while the meter read
 * "1500 ml, fine". Verified by probe before this function existed.
 *
 * So: an explicit, parsed VARIANT label wins. The card measure is the fallback
 * that covers the case the label cannot -- `transform.ts` maps the package
 * label "each" to the EMPTY STRING, and mg/pack labels ("100mg", "4pk") carry
 * no volume at all, which is precisely when the measured intake figure is the
 * only truth available.
 *
 * Returns null when NEITHER source knows. null means UNKNOWN, never zero, so
 * the caller can fall back to the weight-carried basis instead of reading an
 * unmeasured bottle as free of the limit. No density is ever assumed.
 */
export function resolveUnitVolumeMl(
  variantLabel: string | null | undefined,
  cardNetVolumeMl: number | null | undefined,
): number | null {
  const fromLabel = volumeMlFromLabel(variantLabel);
  if (fromLabel !== null) return fromLabel;
  if (
    typeof cardNetVolumeMl === "number" &&
    Number.isFinite(cardNetVolumeMl) &&
    cardNetVolumeMl > 0
  ) {
    return cardNetVolumeMl;
  }
  return null;
}

/** Render millilitres for a human, with the fluid-ounce equivalent. */
export function formatMl(ml: number): string {
  if (!Number.isFinite(ml)) return "0 ml";
  const oz = ml / ML_PER_FLUID_OUNCE;
  const mlText = Number.isInteger(ml) ? String(ml) : ml.toFixed(1);
  return `${mlText} ml (${oz.toFixed(1)} fl oz)`;
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE).
// ---------------------------------------------------------------------------

export function __runLiquidVolumeTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      pass += 1;
    } else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };
  const near = (a: number | null, b: number, msg: string) =>
    ok(a !== null && Math.abs(a - b) < 1e-6, msg);

  // --- constants: LOAD-BEARING, pin them ----------------------------------
  ok(ML_PER_FLUID_OUNCE === 29.5735, "fl oz = 29.5735 ml (matches existing codebase convention)");
  ok(ML_PER_LITRE === 1000, "1 L = 1000 ml");
  ok(REC_LIQUID_FLUID_OUNCES === 72, "rec cap = 72 FLUID oz (WAC 314-55-095(1)(d)(i)(E))");
  ok(MED_LIQUID_FLUID_OUNCES === 216, "med cap = 216 FLUID oz (WAC 314-55-095(2)(d))");
  near(REC_LIQUID_ML, 2129.292, "rec cap = 2129.292 ml (owner decision: fluid ounces)");
  near(MED_LIQUID_ML, 6387.876, "med cap = 6387.876 ml");
  // The medical figure is exactly 3x recreational (unlike low-THC, which is not
  // tripled). If someone edits one number this catches the divergence.
  near(MED_LIQUID_ML, REC_LIQUID_ML * 3, "med is exactly 3x rec");
  // Guard the owner's decision against a silent revert to the grams basis:
  // 2016 was the OLD (weight-ounce) cap and must no longer be the answer.
  ok(Math.abs(REC_LIQUID_ML - 2016) > 100, "rec cap is NOT the old 2016 weight-gram figure");

  // --- toMl ---------------------------------------------------------------
  near(toMl(30, "ml"), 30, "30 ml -> 30");
  near(toMl(1, "l"), 1000, "1 L -> 1000 ml");
  near(toMl(1.5, "l"), 1500, "1.5 L -> 1500 ml");
  near(toMl(1, "floz"), 29.5735, "1 fl oz -> 29.5735 ml");
  near(toMl(12, "floz"), 354.882, "12 fl oz -> 354.882 ml");
  ok(toMl(0, "ml") === null, "zero quantity -> null");
  ok(toMl(-5, "ml") === null, "negative quantity -> null");
  ok(toMl(Number.NaN, "ml") === null, "NaN quantity -> null");
  ok(toMl(Number.POSITIVE_INFINITY, "ml") === null, "Infinity quantity -> null");

  // --- volumeMlFromLabel: the labels that were silently oversold ----------
  near(volumeMlFromLabel("30ml"), 30, "30ml");
  near(volumeMlFromLabel("30 ml"), 30, "30 ml (space)");
  near(volumeMlFromLabel("30ML"), 30, "30ML (case)");
  near(volumeMlFromLabel("750ml"), 750, "750ml");
  near(volumeMlFromLabel("750 mL"), 750, "750 mL -- must be ml, NOT litres");
  near(volumeMlFromLabel("100 milliliters"), 100, "100 milliliters");
  near(volumeMlFromLabel("100 millilitres"), 100, "100 millilitres (British)");
  near(volumeMlFromLabel("1L"), 1000, "1L");
  near(volumeMlFromLabel("1 L"), 1000, "1 L");
  near(volumeMlFromLabel("1.5L"), 1500, "1.5L -- the 72x oversell case");
  near(volumeMlFromLabel("1 liter"), 1000, "1 liter");
  near(volumeMlFromLabel("2 litres"), 2000, "2 litres");
  near(volumeMlFromLabel("2 fl oz"), 59.147, "2 fl oz -- the 2x oversell case");
  near(volumeMlFromLabel("12 fl oz"), 354.882, "12 fl oz -- the 12x oversell case");
  near(volumeMlFromLabel("12fl oz"), 354.882, "12fl oz (no space)");
  near(volumeMlFromLabel("1.7 fl. oz"), 50.27495, "1.7 fl. oz (period)");
  near(volumeMlFromLabel("8 floz"), 236.588, "8 floz (joined)");
  near(volumeMlFromLabel("16 fluid ounces"), 473.176, "16 fluid ounces (spelled)");
  near(volumeMlFromLabel("1 fluid ounce"), 29.5735, "1 fluid ounce (singular)");
  near(volumeMlFromLabel("  500 ml  "), 500, "whitespace trimmed");

  // --- resolveUnitVolumeMl: the VARIANT label outranks the CARD measure ---
  // The regression this exists to stop: one card holds 750 ml and 1.5 L lots
  // (groupingIdentity omits package size) and its netVolumeMl comes from
  // firstAvailable, so card-first measured a 1.5 L bottle as 750 ml.
  near(resolveUnitVolumeMl("1.5L", 750), 1500, "variant label BEATS the card measure");
  near(resolveUnitVolumeMl("750ml", 1500), 750, "...and in the other direction too");
  near(resolveUnitVolumeMl("12 fl oz", 750), 354.882, "fl oz label beats card measure");
  // The fallback that earns the card measure its place: labels that carry no
  // volume at all. transform.ts maps the package label "each" -> "".
  near(resolveUnitVolumeMl("", 750), 750, 'empty label ("each") falls back to the card');
  near(resolveUnitVolumeMl("100mg", 750), 750, "mg-dosed label falls back to the card");
  near(resolveUnitVolumeMl("4pk", 750), 750, "pack label falls back to the card");
  near(resolveUnitVolumeMl("12oz", 750), 750, "bare-ounce label falls back to the card");
  near(resolveUnitVolumeMl(null, 750), 750, "null label falls back to the card");
  near(resolveUnitVolumeMl(undefined, 750), 750, "undefined label falls back to the card");
  // UNKNOWN stays unknown -- never 0, which would read as "free of the limit".
  ok(resolveUnitVolumeMl("", null) === null, "no label + no card measure -> null");
  ok(resolveUnitVolumeMl("100mg", undefined) === null, "no volume anywhere -> null");
  ok(resolveUnitVolumeMl("", 0) === null, "card measure of 0 is not a size -> null");
  ok(resolveUnitVolumeMl("", -5) === null, "negative card measure -> null");
  ok(resolveUnitVolumeMl("", Number.NaN) === null, "NaN card measure -> null");
  ok(resolveUnitVolumeMl("", Number.POSITIVE_INFINITY) === null, "Infinite card measure -> null");
  // A parsed label wins even when the card measure is junk.
  near(resolveUnitVolumeMl("750ml", Number.NaN), 750, "label wins over a NaN card measure");
  near(resolveUnitVolumeMl("750ml", 0), 750, "label wins over a zero card measure");

  // --- volumeMlFromLabel: MUST return null (no invented densities) --------
  ok(volumeMlFromLabel("3.5g") === null, "3.5g -> null (weight, not volume)");
  ok(volumeMlFromLabel("1oz") === null, "1oz -> null (bare ounce is AMBIGUOUS)");
  ok(volumeMlFromLabel("12oz") === null, "12oz -> null (bare ounce is AMBIGUOUS)");
  ok(volumeMlFromLabel("16 ounces") === null, "16 ounces -> null (ambiguous)");
  ok(volumeMlFromLabel("100mg") === null, "100mg -> null (potency, not volume)");
  ok(volumeMlFromLabel("4pk") === null, "4pk -> null (count, not volume)");
  ok(volumeMlFromLabel("each") === null, "each -> null");
  ok(volumeMlFromLabel("") === null, "empty -> null");
  ok(volumeMlFromLabel("   ") === null, "blank -> null");
  ok(volumeMlFromLabel(null) === null, "null -> null");
  ok(volumeMlFromLabel(undefined) === null, "undefined -> null");
  ok(volumeMlFromLabel("ml") === null, "unit with no number -> null");
  ok(volumeMlFromLabel("abc") === null, "garbage -> null");
  ok(volumeMlFromLabel("0ml") === null, "0ml -> null (zero is not a size)");
  ok(volumeMlFromLabel("-5ml") === null, "-5ml -> null");
  // Anchored end-to-end, so a volume buried in prose is NOT accepted here.
  // (Name-level extraction is fact-extraction-core's job, not this parser's.)
  ok(volumeMlFromLabel("Tonic 750ml Bottle") === null, "prose -> null (anchored parser)");

  // --- the litre false-positive probe: real wording that must NOT match ---
  // A bare `l` alternative is the one genuinely dangerous pattern in this file.
  for (const notLitres of ["2 Lb", "2 lbs", "5 Lot", "XL", "3 Large", "1 Lid"]) {
    ok(volumeMlFromLabel(notLitres) === null, `"${notLitres}" is NOT litres`);
  }

  // --- lineVolumeMl -------------------------------------------------------
  near(lineVolumeMl(354.882, 6), 2129.292, "6 x 12 fl oz = exactly the rec cap");
  near(lineVolumeMl(30, 2), 60, "2 x 30 ml");
  ok(lineVolumeMl(30, 0) === 0, "quantity 0 -> 0 (not null)");
  ok(lineVolumeMl(null, 5) === null, "unknown per-unit -> null (propagates unknown)");
  ok(lineVolumeMl(undefined, 5) === null, "undefined per-unit -> null");
  ok(lineVolumeMl(0, 5) === null, "zero per-unit -> null, NOT 0");
  ok(lineVolumeMl(-1, 5) === null, "negative per-unit -> null");
  ok(lineVolumeMl(30, Number.NaN) === null, "NaN quantity -> null");
  near(lineVolumeMl(30, 2.4), 60, "fractional quantity rounds to 2");

  // --- the oversell table from the recon, as executable assertions --------
  // Each row: per-unit label, and the number of units the STATUTE allows.
  // These are the numbers the old grams path got wrong; they are the oracle
  // for the whole slice.
  const capUnits = (label: string): number | null => {
    const per = volumeMlFromLabel(label);
    return per === null ? null : Math.floor(REC_LIQUID_ML / per);
  };
  ok(capUnits("2 fl oz") === 36, "2 fl oz -> 36 units (old system allowed 72)");
  ok(capUnits("12 fl oz") === 6, "12 fl oz -> 6 units (old system allowed 72)");
  ok(capUnits("100ml") === 21, "100ml -> 21 units (old system allowed 72)");
  ok(capUnits("500ml") === 4, "500ml -> 4 units (old system allowed 72)");
  ok(capUnits("750ml") === 2, "750ml -> 2 units (old system allowed 72)");
  ok(capUnits("1L") === 2, "1L -> 2 units (old system allowed 72)");
  ok(capUnits("1.5L") === 1, "1.5L -> 1 unit (old system allowed 72 -- 72x oversell)");
  // The UNDER-sell direction matters too: small tinctures were being refused.
  ok(capUnits("10ml") === 212, "10ml -> 212 units (old system allowed only 72)");

  // --- formatMl -----------------------------------------------------------
  ok(formatMl(2129.292) === "2129.3 ml (72.0 fl oz)", "cap renders as 72.0 fl oz");
  ok(formatMl(30) === "30 ml (1.0 fl oz)", "integer ml renders without decimal");
  ok(formatMl(0) === "0 ml (0.0 fl oz)", "zero renders");
  ok(formatMl(Number.NaN) === "0 ml", "NaN renders safely");

  if (fail > 0) {
    throw new Error(`liquid-volume self-tests: ${fail} FAILED (${pass} passed)`);
  }
  console.log(`liquid-volume: ${pass} self-tests passed`);
}
