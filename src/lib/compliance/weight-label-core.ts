/**
 * src/lib/compliance/weight-label-core.ts  (SLICE W1)
 *
 * THE one home for "how many grams does this variant label describe?".
 *
 * THE PROBLEM (measured over 37 label shapes, not assumed). Two independent
 * regexes answered this question and DISAGREED on 14 of them:
 *
 *   label        discount parser        limit parser
 *   ---------    -------------------    ---------------
 *   "1/8 oz"     224 g  (!!)            null
 *   "1/4 oz"     112 g  (!!)            null
 *   "3/4 oz"     112 g  (!!)            null
 *   "28 grams"   0 g    (!!)            28 g
 *   "1 gram"     0 g    (!!)            1 g
 *   "1 oz jar"   28 g                   null
 *
 *  - The DISCOUNT copies (`gramsForLabel`, duplicated byte-for-byte in
 *    discount-engine-core.ts and specials/cart-discount.ts) used UNANCHORED
 *    patterns: `/([\d.]+)\s*(oz|ounce)/`. On "1/8 oz" that happily matches the
 *    "8 oz" SUBSTRING and reports 224 g -- a full-ounce tier (30% off) awarded
 *    to an eighth. Their gram branch used `\bg\b`, so the spelled-out
 *    "28 grams" matched nothing and reported 0 g -- no tier at all.
 *  - The LIMIT parser (`gramsFromVariantLabel`, which feeds WAC 314-55-095
 *    enforcement) was ANCHORED `^...$` and so returned null on anything odd --
 *    correct and conservative, but a DIFFERENT answer from the discount side
 *    for the same string.
 *
 * REACHABILITY -- STATED HONESTLY. `parsePackageSize` (pos/transform.ts) is the
 * only writer of `variant.label`, and it BUILDS labels arithmetically as
 * `${formatNumber(qty)}${unit}`, so it can never emit a fraction. Fed the raw
 * text "1/8 oz" its own regex stops at "1", finds no letter unit, falls back to
 * `each`, and emits the label "each" (verified by probe, qty=1 unit="ea").
 * So the 224 g misread is NOT reachable through today's import path. This
 * module is DEFENSE IN DEPTH and drift elimination -- one parser instead of
 * three -- not the repair of a live money leak. Free text DOES reach the limit
 * parser from vendor feeds (cultivera-menu-core.ts pickText -> size_label),
 * but that call site computes only a sort key.
 *
 * THE TRAP THAT SHAPED THIS DESIGN: the two engines want OPPOSITE ambiguity
 * handling.
 *
 *   - DISCOUNT: over-reporting grams => a bigger discount => the store loses
 *     money on every basket.
 *   - COMPLIANCE: under-reporting grams => an over-sale => LICENSE risk.
 *
 * "Be generous when unsure" is therefore unsafe for BOTH. The only posture
 * that serves both is to return a weight ONLY when the label is unambiguous
 * and to DECLINE otherwise -- null here, which the discount side reads as
 * 0 g (no tier) and the limit side reads as "unknown, use the conservative
 * per-category default". Declining is the safe direction on both sides.
 *
 * A DESIGN I CONSIDERED AND REJECTED: allowing a trailing descriptor after a
 * leading weight ("1 oz jar" -> 28 g) to be friendlier to free text. That
 * would have been a COMPLIANCE LOOSENING. Counter-example that killed it:
 * "10pk 0.5g" and "1g 10pk" would parse as 0.5 g and 1 g PER UNIT, silently
 * under-reporting a ten-pack whose category default is 5 g. Strict anchoring
 * for both engines instead; "1 oz jar" is not machine-emittable anyway.
 *
 * WHY FRACTIONS PARSE AT ALL, given "never guess": "1/8 oz" is not a guess,
 * it is exact arithmetic -- 1/8 x 28 = 3.5 g. An exactly-parsed real weight
 * beating a per-category guess is the pre-existing, reviewed design of
 * variant-grams-core (its header: "Parsing grams back OUT of the label
 * reproduces gramsEquivalent exactly"). This module keeps that rule and adds
 * the notations a human or a vendor feed actually writes.
 *
 * PURE: one import (the statutory equivalence). No I/O, no React, no DOM.
 */

/**
 * GW-016: the LICENSE-CRITICAL equivalence, 1 oz usable = 28 g exactly. Do not
 * "improve" this to 28.35 here -- read grams-per-ounce.ts before touching it;
 * the limit engine that consumes this value must stay conservative.
 */
import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";

/** Vulgar-fraction code points, spelled as escapes so the source stays ASCII. */
const UNICODE_FRACTION_VALUE: Record<string, number> = {
  "\u00BC": 1 / 4,
  "\u00BD": 1 / 2,
  "\u00BE": 3 / 4,
  "\u2150": 1 / 7,
  "\u2151": 1 / 9,
  "\u2152": 1 / 10,
  "\u2153": 1 / 3,
  "\u2154": 2 / 3,
  "\u2155": 1 / 5,
  "\u2156": 2 / 5,
  "\u2157": 3 / 5,
  "\u2158": 4 / 5,
  "\u2159": 1 / 6,
  "\u215A": 5 / 6,
  "\u215B": 1 / 8,
  "\u215C": 3 / 8,
  "\u215D": 5 / 8,
  "\u215E": 7 / 8,
};

/** The same code points as a regex character-class body. */
const UNI = "\\u00BC\\u00BD\\u00BE\\u2150-\\u215E";

/**
 * Quantity notations:
 *   1. mixed ascii    "1 1/2"
 *   2. mixed unicode  "1" + a vulgar fraction
 *   3. pure fraction  "1/8"
 *   4. bare unicode   a lone vulgar fraction
 *   5. decimal        "3.5", "28"
 *
 * ON ALTERNATION ORDER -- MEASURED, AND NOT WHAT I FIRST WROTE. An earlier
 * revision of this comment claimed the longest-first ordering was
 * "load-bearing" and that a decimal-first ordering would truncate "1 1/2" to
 * "1". A mutation test that moved the decimal alternative to the front
 * SURVIVED, so the claim was checked directly: under both orderings all eight
 * probe labels captured identically ("1 1/2 oz" -> "1 1/2", "1/8 oz" -> "1/8",
 * "10 3/4 oz" -> "10 3/4"). The reason is that the pattern is ANCHORED: when a
 * short alternative matches, the trailing `\s*(unit)$` then fails, and the
 * engine BACKTRACKS into the remaining alternatives rather than accepting the
 * truncation. So the ordering is READABILITY, not correctness.
 *
 * THE ACTUAL SAFETY MECHANISM IS THE `$` ANCHOR on WEIGHT_LABEL_RE. Remove it
 * and "10pk 0.5g" starts parsing as a weight (mutation-tested: caught). The
 * same discipline liquid-volume-core documents for its bare-litre pattern.
 */
const QTY = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\s*[${UNI}]|\\d+\\/\\d+|[${UNI}]|\\d+(?:\\.\\d+)?)`;

/**
 * Weight units ONLY. `mg` is a dose, `ml`/`L` a volume, `fl oz` a volume, `pk`
 * a count -- none is a package weight, and because the whole pattern is
 * anchored they cannot match here even as a prefix ("1fl oz" and "100mg" both
 * fail outright). That is what keeps a 12 fl oz beverage from being read as
 * twelve WEIGHT ounces (the SLICE L2 conflation).
 */
const WEIGHT_LABEL_RE = new RegExp(`^(${QTY})\\s*(g|gram|grams|oz|ounce|ounces)$`);

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Parse one already-trimmed, already-lowercased quantity token. */
function parseQuantityToken(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  // "1 1/2" (ascii mixed) -- integer part plus a proper fraction.
  const mixedAscii = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedAscii) {
    const den = Number(mixedAscii[3]);
    if (den === 0) return null;
    return Number(mixedAscii[1]) + Number(mixedAscii[2]) / den;
  }

  // "1" + a vulgar fraction.
  const mixedUnicode = s.match(new RegExp(`^(\\d+)\\s*([${UNI}])$`));
  if (mixedUnicode) {
    const frac = UNICODE_FRACTION_VALUE[mixedUnicode[2]];
    if (frac === undefined) return null;
    return Number(mixedUnicode[1]) + frac;
  }

  // "1/8". A zero denominator would yield Infinity, so it is refused.
  const fraction = s.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const den = Number(fraction[2]);
    if (den === 0) return null;
    return Number(fraction[1]) / den;
  }

  // A lone vulgar fraction.
  const uni = UNICODE_FRACTION_VALUE[s];
  if (uni !== undefined) return uni;

  // Plain decimal / integer.
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);

  return null;
}

/**
 * The grams ONE unit of a variant weighs, or null when the label does not
 * unambiguously state a weight.
 *
 * Returns a positive number for plain weight labels -- "3.5g" -> 3.5,
 * "1oz" -> 28, "1/8 oz" -> 3.5, "28 grams" -> 28 -- and null for everything
 * else: mg doses, ml/L/fl oz volumes, pack counts, "each", blanks, free text,
 * zero and negative quantities. Null means UNKNOWN, and both consumers treat
 * unknown in their own safe direction (no discount tier / conservative
 * category default). Never throws.
 */
export function parseWeightLabelGrams(label: string | null | undefined): number | null {
  if (typeof label !== "string") return null;
  // Collapse runs of whitespace so "3.5  g" and a tab behave like "3.5 g",
  // without ever letting whitespace bridge two separate tokens.
  const s = label.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;

  const m = s.match(WEIGHT_LABEL_RE);
  if (!m) return null;

  const qty = parseQuantityToken(m[1]);
  // DELIBERATELY REDUNDANT WITH the zero-denominator check inside
  // parseQuantityToken and with the grams check below. Mutation testing
  // measured this: removing any ONE of the three leaves behaviour
  // byte-identical (so each looks like dead code in isolation), while
  // removing TWO lets "0g" return 0 instead of null, and removing all three
  // lets "1/0 oz" return Infinity straight into the WAC limit arithmetic.
  // This is defense in depth on a license-critical path -- do not tidy it
  // away because a coverage tool calls one line redundant.
  if (qty === null || !Number.isFinite(qty) || qty <= 0) return null;

  const grams = m[2].startsWith("g") ? qty : qty * STATUTORY_GRAMS_PER_OUNCE;
  // Second layer: a finite positive qty can still produce a non-finite
  // grams if the ounce constant is ever corrupted.
  if (!Number.isFinite(grams) || grams <= 0) return null;
  return round3(grams);
}

/**
 * The shared fixture table. Both the discount parser and the limit parser are
 * asserted against THIS list, so the two can never drift apart again: a label
 * added here is automatically exercised on both sides. `grams: null` means
 * "must decline".
 */
export const WEIGHT_LABEL_FIXTURES: ReadonlyArray<{ label: string; grams: number | null; why: string }> = [
  // --- the machine vocabulary parsePackageSize actually emits ---------------
  { label: "3.5g", grams: 3.5, why: "eighth, the store's commonest flower label" },
  { label: "7g", grams: 7, why: "quarter" },
  { label: "14g", grams: 14, why: "half" },
  { label: "1oz", grams: 28, why: "ounce at the statutory 28 g equivalence" },
  { label: "2oz", grams: 56, why: "two ounces" },
  { label: "28g", grams: 28, why: "an ounce written in grams" },
  { label: "1g", grams: 1, why: "single gram" },
  { label: "0.5g", grams: 0.5, why: "half gram" },
  { label: "2g", grams: 2, why: "two grams" },
  // --- non-weights: every one of these MUST decline ------------------------
  { label: "100mg", grams: null, why: "a DOSE, not a package weight" },
  { label: "30ml", grams: null, why: "volume" },
  { label: "1l", grams: null, why: "volume (SLICE L2: a litre is not 1 g)" },
  { label: "1fl oz", grams: null, why: "fluid ounce is VOLUME -- never a weight ounce" },
  { label: "12fl oz", grams: null, why: "the SLICE L2 conflation: not 336 g" },
  { label: "2pk", grams: null, why: "pack count" },
  { label: "10pk", grams: null, why: "pack count" },
  { label: "each", grams: null, why: "countable unit, no weight" },
  { label: "5 each", grams: null, why: "countable units" },
  { label: "", grams: null, why: "blank" },
  // --- formatting tolerance ------------------------------------------------
  { label: " 3.5 G ", grams: 3.5, why: "surrounding space + upper case" },
  { label: "3.5  g", grams: 3.5, why: "doubled inner space" },
  { label: "1 OZ", grams: 28, why: "upper case unit" },
  { label: "1 gram", grams: 1, why: "spelled singular" },
  { label: "28 grams", grams: 28, why: "spelled plural -- was 0 g on the discount side" },
  { label: "7 grams", grams: 7, why: "spelled plural" },
  { label: "1 ounce", grams: 28, why: "spelled singular ounce" },
  { label: "2 ounces", grams: 56, why: "spelled plural ounces" },
  // --- fractions: THE 1/8 OZ FIX ------------------------------------------
  { label: "1/8 oz", grams: 3.5, why: "THE FIX -- was 224 g (matched the '8 oz' substring)" },
  { label: "1/8oz", grams: 3.5, why: "unspaced eighth -- was 224 g" },
  { label: "1/4 oz", grams: 7, why: "quarter -- was 112 g" },
  { label: "1/2 oz", grams: 14, why: "half -- was 56 g" },
  { label: "3/4 oz", grams: 21, why: "three quarters -- was 112 g" },
  { label: "1 1/2 oz", grams: 42, why: "mixed number, integer part NOT truncated" },
  { label: "1/8 ounce", grams: 3.5, why: "fraction + spelled unit" },
  { label: "\u215B oz", grams: 3.5, why: "vulgar-fraction eighth" },
  { label: "\u00BD oz", grams: 14, why: "vulgar-fraction half" },
  { label: "1\u00BD oz", grams: 42, why: "mixed vulgar fraction" },
  { label: "1/2 g", grams: 0.5, why: "fractional grams" },
  // --- refusals that protect BOTH engines ---------------------------------
  { label: "0g", grams: null, why: "zero weight is not a weight" },
  { label: "-3g", grams: null, why: "negative" },
  { label: "0/8 oz", grams: null, why: "fraction evaluating to zero" },
  { label: "1/0 oz", grams: null, why: "zero denominator must not become Infinity" },
  { label: "premium flower", grams: null, why: "free text" },
  { label: "1 oz jar", grams: null, why: "trailing descriptor -- strict anchor (see header)" },
  { label: "10pk 0.5g", grams: null, why: "THE REJECTED DESIGN: would under-report a 10-pack" },
  { label: "1g 10pk", grams: null, why: "leading weight + count is still ambiguous" },
  { label: "oz", grams: null, why: "unit with no quantity" },
  { label: "3.5", grams: null, why: "quantity with no unit" },
  { label: "2 lbs", grams: null, why: "pounds are not a supported unit" },
  { label: "5 lot", grams: null, why: "must not match the bare-litre or oz rules" },
  { label: "xl gummy", grams: null, why: "free text containing a unit-ish letter" },
];

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE).
// ---------------------------------------------------------------------------

export function __runWeightLabelTests(): void {
  let passed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else failures.push(name);
  };

  // Every shared fixture, through the single parser.
  for (const f of WEIGHT_LABEL_FIXTURES) {
    const got = parseWeightLabelGrams(f.label);
    ok(got === f.grams, `${JSON.stringify(f.label)} -> ${f.grams} (${f.why}) but got ${got}`);
  }

  // Nullish input never throws.
  ok(parseWeightLabelGrams(null) === null, "null -> null");
  ok(parseWeightLabelGrams(undefined) === null, "undefined -> null");
  ok(parseWeightLabelGrams(123 as unknown as string) === null, "non-string -> null");

  // THE REGRESSION THAT STARTED THIS SLICE: the unanchored ounce pattern read
  // "1/8 oz" as its "8 oz" substring. Assert the arithmetic, not just non-224.
  ok(parseWeightLabelGrams("1/8 oz") === 3.5, "1/8 oz is an EIGHTH (3.5 g), not 224 g");
  ok(parseWeightLabelGrams("1/8 oz") !== 224, "1/8 oz must never read 224 g again");

  // Fractions are exact against the statutory ounce, not approximated.
  ok(parseWeightLabelGrams("1/4 oz") === 7, "1/4 oz = 7 g exactly");
  ok(parseWeightLabelGrams("1/2 oz") === 14, "1/2 oz = 14 g exactly");
  ok(parseWeightLabelGrams("1/8 oz") === STATUTORY_GRAMS_PER_OUNCE / 8, "eighth = 28/8");

  // Repeating fractions round to 3 dp rather than carrying float noise.
  ok(parseWeightLabelGrams("1/3 oz") === 9.333, "1/3 oz -> 9.333 (3 dp)");

  // A fraction can never out-rank a whole ounce: monotonicity of the parse.
  const eighth = parseWeightLabelGrams("1/8 oz") ?? 0;
  const quarter = parseWeightLabelGrams("1/4 oz") ?? 0;
  const half = parseWeightLabelGrams("1/2 oz") ?? 0;
  const full = parseWeightLabelGrams("1 oz") ?? 0;
  ok(eighth < quarter && quarter < half && half < full, "eighth < quarter < half < ounce");

  // VOLUME MUST NEVER BECOME WEIGHT (the SLICE L2 lesson, re-pinned here).
  for (const v of ["1fl oz", "12 fl oz", "1.7 fl. oz", "750ml", "1.5l", "1 liter", "12 floz"]) {
    ok(parseWeightLabelGrams(v) === null, `volume declined: ${v}`);
  }

  // Doses and counts must never become weight either.
  for (const d of ["100mg", "500 mg", "10pk", "2 pk", "each", "12 each"]) {
    ok(parseWeightLabelGrams(d) === null, `non-weight declined: ${d}`);
  }

  // No fixture may claim a non-positive weight (guards the table itself).
  ok(
    WEIGHT_LABEL_FIXTURES.every((f) => f.grams === null || f.grams > 0),
    "fixture table declares only positive weights or null",
  );
  // And the table must actually cover both outcomes, so a truncated table
  // cannot silently pass as "all decline".
  ok(
    WEIGHT_LABEL_FIXTURES.some((f) => f.grams !== null) &&
      WEIGHT_LABEL_FIXTURES.some((f) => f.grams === null),
    "fixture table covers both weights and refusals",
  );

  if (failures.length > 0) {
    throw new Error(`weight-label-core self-tests FAILED (${failures.length}): ${failures.join("; ")}`);
  }
  console.log(`weight-label-core self-tests: ${passed} passed`);
}
