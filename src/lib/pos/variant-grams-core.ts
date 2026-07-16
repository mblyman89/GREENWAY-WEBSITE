/**
 * POS Slice AN-1 — per-variant grams for the WAC 314-55-095 limit engine
 * (pure core).
 *
 * THE GAP (verified, not guessed): `lineGrams()` in sales-limits-core honors
 * an explicit `line.grams`, but NO caller ever passed it — the register meter
 * (`limitLinesFor`), the website placement soft-check, and the completion
 * hard gate all built `{category, quantity}` lines, so EVERY unit fell back
 * to the DEFAULT_UNIT_GRAMS category default (a 7 g flower jar counted as
 * 3.5 g; a 1 oz jar counted as 3.5 g). That is the store's only quantitative
 * WAC 314-55-095 gap.
 *
 * THE FIX: the variant LABEL is a normalized artifact of the same package
 * parse that computes gramsEquivalent at transform time
 * (src/lib/pos/transform.ts parsePackageSize: unit "g" → quantity,
 * unit "oz" → quantity × 28, everything else → undefined). The label
 * vocabulary is closed and machine-generated: "3.5g", "7g", "14g", "1oz",
 * "Xg", "Xoz", "Xfl oz", "Xmg", "Xml", "Xpk", "each", "N each", or "".
 * Parsing grams back OUT of the label therefore reproduces gramsEquivalent
 * exactly, works for menus ALREADY published (no re-import needed), and
 * degrades safely: any label that isn't a plain weight (mg doses, ml, fl oz,
 * packs, "each") returns null and the engine keeps its conservative
 * category default.
 *
 * Pure: no I/O, no React. Self-tested below (registered in
 * scripts/compliance/run-pure-selftests.ts) and mirrored in vitest.
 */

/** Statute equivalence used by the transform and sales-limits-core alike. */
const GRAMS_PER_OUNCE = 28;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Parse the grams ONE unit of a variant weighs from its label.
 *
 * Returns a positive number for plain weight labels ("3.5g" → 3.5,
 * "1oz" → 28, "0.5 g" → 0.5) and null for everything else — mg/ml/fl oz
 * doses, pack counts, "each", blanks, or free text. Null means "unknown":
 * the limit engine falls back to the owner's per-category default, exactly
 * as before AN-1. Never throws.
 */
export function gramsFromVariantLabel(label: string | null | undefined): number | null {
  if (typeof label !== "string") return null;
  const s = label.trim().toLowerCase();
  if (!s) return null;
  // Only whitespace may sit between the number and the unit, so "1fl oz",
  // "100mg", "30ml", "2pk", "5 each" all fail the match by design.
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(g|gram|grams|oz|ounce|ounces)$/);
  if (!m) return null;
  const qty = Number(m[1]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const grams = m[2].startsWith("g") ? qty : qty * GRAMS_PER_OUNCE;
  return round3(grams);
}

/**
 * Normalize an untrusted per-unit grams value (a queued sale payload, a DB
 * row) into either a usable positive number or null. Postgres `numeric` can
 * arrive as a JSON number OR a string depending on the client, so plain
 * numeric strings are accepted; everything else (NaN, negatives, zero,
 * free text) is kept out of the limit math.
 */
export function normalizeUnitGrams(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && value.trim() !== "" && /^\d+(\.\d+)?$/.test(value.trim())) {
    n = Number(value.trim());
  } else return null;
  if (!Number.isFinite(n) || n <= 0) return null;
  return round3(n);
}

/**
 * The whole-line grams to hand `LimitCartLine.grams` (sales-limits-core
 * treats an explicit grams value as the TOTAL for the line, verified against
 * lineGrams: `if (grams > 0) return line.grams` — no quantity multiply).
 * Null when the per-unit weight is unknown (falls back to category defaults).
 */
export function lineGramsFromUnit(unitGrams: number | null | undefined, quantity: number): number | null {
  const perUnit = normalizeUnitGrams(unitGrams);
  if (perUnit === null) return null;
  const qty = Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
  if (qty === 0) return null;
  return round3(perUnit * qty);
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runVariantGramsCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  // The transform's exact label vocabulary — weights parse…
  ok(gramsFromVariantLabel("3.5g") === 3.5, "3.5g → 3.5");
  ok(gramsFromVariantLabel("7g") === 7, "7g → 7");
  ok(gramsFromVariantLabel("14g") === 14, "14g → 14");
  ok(gramsFromVariantLabel("1oz") === 28, "1oz → 28 (statute equivalence)");
  ok(gramsFromVariantLabel("2oz") === 56, "2oz → 56");
  ok(gramsFromVariantLabel("0.5g") === 0.5, "0.5g → 0.5");
  ok(gramsFromVariantLabel("28g") === 28, "28g → 28");
  ok(gramsFromVariantLabel(" 3.5 G ") === 3.5, "whitespace + case tolerated");
  ok(gramsFromVariantLabel("1 gram") === 1, "spelled-out gram");
  ok(gramsFromVariantLabel("2 ounces") === 56, "spelled-out ounces");

  // …and NON-weights all return null (fall back to category defaults).
  ok(gramsFromVariantLabel("100mg") === null, "mg dose → null (not a package weight)");
  ok(gramsFromVariantLabel("30ml") === null, "ml → null");
  ok(gramsFromVariantLabel("1fl oz") === null, "fl oz → null (liquid volume, not weight)");
  ok(gramsFromVariantLabel("2pk") === null, "pack count → null");
  ok(gramsFromVariantLabel("each") === null, "each → null");
  ok(gramsFromVariantLabel("5 each") === null, "N each → null");
  ok(gramsFromVariantLabel("") === null, "blank → null");
  ok(gramsFromVariantLabel(null) === null, "null → null");
  ok(gramsFromVariantLabel(undefined) === null, "undefined → null");
  ok(gramsFromVariantLabel("0g") === null, "zero weight → null");
  ok(gramsFromVariantLabel("-3g") === null, "negative → null");
  ok(gramsFromVariantLabel("premium flower") === null, "free text → null");

  // normalizeUnitGrams — garbage never reaches the limit math.
  ok(normalizeUnitGrams(3.5) === 3.5, "valid grams pass");
  ok(normalizeUnitGrams(0) === null, "zero → null");
  ok(normalizeUnitGrams(-1) === null, "negative → null");
  ok(normalizeUnitGrams(NaN) === null, "NaN → null");
  ok(normalizeUnitGrams(Infinity) === null, "Infinity → null");
  ok(normalizeUnitGrams("3.5") === 3.5, "numeric string accepted (pg numeric arrives as text)");
  ok(normalizeUnitGrams("abc") === null, "free-text string → null");
  ok(normalizeUnitGrams("-3") === null, "negative string → null");
  ok(normalizeUnitGrams(null) === null, "null → null");
  ok(normalizeUnitGrams(3.0000004) === 3, "rounded to 3 decimals");

  // lineGramsFromUnit — whole-line total (lineGrams treats grams as the
  // line total, NOT per-unit — verified against sales-limits-core).
  ok(lineGramsFromUnit(3.5, 2) === 7, "2 × 3.5 g = 7 g line total");
  ok(lineGramsFromUnit(7, 4) === 28, "4 × 7 g = 28 g line total");
  ok(lineGramsFromUnit(null, 3) === null, "unknown unit grams → null");
  ok(lineGramsFromUnit(3.5, 0) === null, "zero quantity → null");
  ok(lineGramsFromUnit(-2, 3) === null, "garbage unit grams → null");
  ok(lineGramsFromUnit(1.1, 3) === 3.3, "floating point rounded (3 × 1.1 = 3.3)");

  if (failed > 0) {
    throw new Error(`variant-grams-core self-tests FAILED (${failed}): ${failures.join("; ")}`);
  }
  console.log(`variant-grams-core self-tests: ${passed} passed`);
}
