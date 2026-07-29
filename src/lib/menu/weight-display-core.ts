/**
 * weight-display-core.ts — SLICE 98 (owner: Michael)
 *
 * OWNER'S VERBATIM ASK: "the topicals, edibles, liquids, are listed/shown
 * using grams as its weight rather than in ounces like I'd prefer it be."
 *
 * Verified live before building (never guessed): a topical card rendered
 * "$26.00/96.4 g" — the RAW POS variant label. The WAC 314-55-105 net-weight
 * companion line on the same card already leads with ounces ("3.4 oz
 * (96.4 g)", card-cannabinoids.deriveNetWeightLine), so the price unit was
 * the one surface still speaking grams for these categories.
 *
 * WHAT THIS MODULE DOES
 * ---------------------
 * `displayVariantLabel(label, category)` converts a variant/package label to
 * the customer-preferred unit for OUNCE-DISPLAY categories only:
 *
 *   topical, edible-solid, edible-liquid, tincture
 *
 *   • gram labels ("96.4 g", "100g")  → avoirdupois ounces ("3.4 oz")
 *   • milliliter labels ("355ml")     → fluid ounces ("12 fl oz")
 *   • labels already in oz / fl oz    → unchanged
 *   • potency ("100mg"), packs ("10pk"), "each", free text → unchanged
 *
 * Every OTHER category returns the label UNCHANGED — flower, popcorn bud,
 * prerolls, blunts, concentrates, cartridges and RSO stay in grams (grams are
 * the honest industry unit there, and Michael's ask named only topicals,
 * edibles and liquids).
 *
 * STRICTLY DISPLAY-ONLY — WHY THE STORED LABEL MUST NOT CHANGE
 * ------------------------------------------------------------
 *   • The cart engine converts variant labels to grams for ounce-tier deals
 *     (specials/cart-discount.ts) and the WAC 314-55-095 limit math parses
 *     per-unit weight from the label (variant-grams-core) — both need the
 *     RAW POS label.
 *   • The register (POS SaleFlow) matches cart lines by productId +
 *     variantLabel — the raw label is an identity there.
 *   • Order lines persist the server-resolved variant label (order-pricing) —
 *     the official receipt label stays the register's label.
 * So callers convert at RENDER time only; nothing written anywhere changes.
 *
 * CONVERSIONS (GW-016: real measured weights use the true avoirdupois value
 * from the shared compliance module — never the statutory 28):
 *   grams → oz : ÷ AVOIRDUPOIS_GRAMS_PER_OUNCE (28.3495)
 *   ml → fl oz : ÷ 29.5735   (same value deriveNetWeightLine uses)
 * Rounded to 2 decimals with trailing zeros trimmed — identical formatting to
 * the existing net-weight line, so "96.4 g" and the companion line both read
 * "3.4 oz". If a conversion would round to "0" (a sub-0.005 oz label), the
 * original label is kept — never display a zero weight.
 *
 * All functions are pure; self-tests run via __runWeightDisplayCoreTests().
 */

import { AVOIRDUPOIS_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";

/** Milliliters per US fluid ounce (matches deriveNetWeightLine). */
const ML_PER_FL_OZ = 29.5735;

/**
 * Categories whose package labels display in ounces for customers.
 * Michael's ask: topicals, edibles, liquids (tinctures are dropper liquids).
 * Deliberately EXCLUDES flower/popcorn-bud/preroll/blunt/concentrate/
 * cartridge/RSO — grams stay grams there.
 */
export const OUNCE_DISPLAY_CATEGORIES: ReadonlySet<string> = new Set([
  "topical",
  "edible-solid",
  "edible-liquid",
  "tincture",
]);

/** Trim a trailing ".00"/".0" so "12.00" reads "12" but "3.53" is preserved. */
function trimZeros(value: number): string {
  const fixed = value.toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/**
 * Convert a variant/package label to the customer display unit for the given
 * website category. Returns the label UNCHANGED for non-ounce categories, for
 * labels already in oz / fl oz, and for anything that is not a real weight or
 * volume (potency mg, packs, "each", blanks, free text).
 */
export function displayVariantLabel(
  label: string | null | undefined,
  category: string | null | undefined,
): string {
  const raw = typeof label === "string" ? label : "";
  if (!raw) return raw;
  const cat = typeof category === "string" ? category.trim().toLowerCase() : "";
  if (!OUNCE_DISPLAY_CATEGORIES.has(cat)) return raw;

  const s = raw.trim().toLowerCase();

  // Already ounces (weight or fluid) — leave the label exactly as-is.
  if (/^[\d.]+\s*(?:fl\.?\s*oz|floz|oz)$/.test(s)) return raw;

  // Milliliters → fluid ounces.
  const ml = s.match(/^([\d.]+)\s*ml$/);
  if (ml) {
    const n = Number(ml[1]);
    if (!Number.isFinite(n) || n <= 0) return raw;
    const flOz = trimZeros(n / ML_PER_FL_OZ);
    return flOz === "0" ? raw : `${flOz} fl oz`;
  }

  // Grams → avoirdupois ounces. (mg is potency, never a package weight here.)
  const g = s.match(/^([\d.]+)\s*g$/);
  if (g) {
    const n = Number(g[1]);
    if (!Number.isFinite(n) || n <= 0) return raw;
    const oz = trimZeros(n / AVOIRDUPOIS_GRAMS_PER_OUNCE);
    return oz === "0" ? raw : `${oz} oz`;
  }

  return raw;
}

/* ------------------------------------------------------------------ *
 *  Self-tests  (run via scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runWeightDisplayCoreTests(): void {
  let passed = 0;
  const check = (name: string, cond: boolean, detail?: unknown) => {
    if (!cond) {
      throw new Error(`weight-display-core self-test failed: ${name} -> ${JSON.stringify(detail)}`);
    }
    passed += 1;
  };
  const d = displayVariantLabel;

  // 1) The owner's live case: topical "96.4 g" (raw POS label, space and all).
  check("topical 96.4 g -> 3.4 oz", d("96.4 g", "topical") === "3.4 oz", d("96.4 g", "topical"));
  // Matches the existing net-weight line's formatting exactly (2dp trimmed).
  check("topical 100g -> 3.53 oz", d("100g", "topical") === "3.53 oz", d("100g", "topical"));

  // 2) Edibles (solid) convert too — per the ask ("edibles").
  check("edible-solid 3.5g -> 0.12 oz", d("3.5g", "edible-solid") === "0.12 oz", d("3.5g", "edible-solid"));

  // 3) Liquids: ml -> fl oz (beverages, tinctures).
  check("edible-liquid 355ml -> 12 fl oz", d("355ml", "edible-liquid") === "12 fl oz", d("355ml", "edible-liquid"));
  check("tincture 30ml -> 1.01 fl oz", d("30ml", "tincture") === "1.01 fl oz", d("30ml", "tincture"));

  // 4) Already-ounce labels stay byte-identical (no reformat churn).
  check("topical 1oz unchanged", d("1oz", "topical") === "1oz", d("1oz", "topical"));
  check("edible-liquid 2 fl oz unchanged", d("2 fl oz", "edible-liquid") === "2 fl oz", d("2 fl oz", "edible-liquid"));

  // 5) FLOWER AND EVERYTHING ELSE STAYS GRAMS — the license-critical guard.
  check("flower 3.5g unchanged", d("3.5g", "flower") === "3.5g", d("3.5g", "flower"));
  check("flower 28g unchanged", d("28g", "flower") === "28g", d("28g", "flower"));
  check("popcorn-bud 7g unchanged", d("7g", "popcorn-bud") === "7g", d("7g", "popcorn-bud"));
  check("preroll 1g unchanged", d("1g", "preroll") === "1g", d("1g", "preroll"));
  check("concentrate 1g unchanged", d("1g", "concentrate") === "1g", d("1g", "concentrate"));
  check("rso 1g unchanged (grams are the honest RSO unit)", d("1g", "rso") === "1g", d("1g", "rso"));
  check("cartridge 0.5g unchanged", d("0.5g", "cartridge") === "0.5g", d("0.5g", "cartridge"));

  // 6) Non-weight labels never convert, even in ounce categories.
  check("edible-solid 100mg unchanged (potency)", d("100mg", "edible-solid") === "100mg", d("100mg", "edible-solid"));
  check("edible-solid 10pk unchanged", d("10pk", "edible-solid") === "10pk", d("10pk", "edible-solid"));
  check("topical each unchanged", d("each", "topical") === "each", d("each", "topical"));
  check("topical blank unchanged", d("", "topical") === "", JSON.stringify(d("", "topical")));
  check("null label -> empty string", d(null, "topical") === "", JSON.stringify(d(null, "topical")));
  check("null category unchanged", d("96.4 g", null) === "96.4 g", d("96.4 g", null));

  // 7) Never display a zero weight — sub-0.005 oz keeps the raw label.
  check("topical 0.1g keeps raw (would round to 0 oz)", d("0.1g", "topical") === "0.1g", d("0.1g", "topical"));
  check("topical 0g keeps raw", d("0g", "topical") === "0g", d("0g", "topical"));

  // 8) Category matching is trim/case-insensitive (cart carries plain strings).
  check("category ' Topical ' converts", d("96.4 g", " Topical ") === "3.4 oz", d("96.4 g", " Topical "));

  console.log(`weight-display-core self-tests: ${passed} passed`);
}
