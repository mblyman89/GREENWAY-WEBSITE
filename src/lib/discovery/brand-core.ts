/**
 * src/lib/discovery/brand-core.ts
 *
 * Task I (I3): brand extraction from CCRS product names — v2, shared by the
 * monthly transformer (ccrs-extract/aggregate.ts) and the legacy CSV path
 * (ccrs.ts) so the two can never drift.
 *
 * VERIFIED against 300k real product names from the May-2026 delivery
 * (never guessed):
 *  - The dominant convention is a brand prefix before a separator:
 *      "Phat Panda | Grape Ape 3.5g", "Fairwinds - Flow CBD Gel",
 *      "Torus: Mint Milkshake - 3.5g", "Regulator Classic - Berry Gelato".
 *  - A common second convention is "<strain/product> by <brand>":
 *      "Gelato x Dosidos by Mt Baker Homegrown - 14g".
 *  - The v1 prefix-only heuristic leaked junk into the brand benchmark:
 *      '3.5g' (712 hits), 'Flower' (642), '100mg', '2pk', '1g Preroll', …
 *
 * CONSERVATIVE by rule: when unsure, return null — a missing brand folds into
 * "(unattributed)" honestly; a wrong brand poisons the benchmark. Note that
 * ALL-NUMERIC prefixes are NOT blocked: '2727' is a real WA brand (1,311 hits).
 */

/** Pure weight/size token: 3.5g, 100mg, 1oz, 30ml, .5g, 1.0 g, 14grams … */
const WEIGHT_RE = /^\.?\d+(?:\.\d+)?\s*(?:g|mg|kg|oz|ml|l|gram|grams|ounce|ounces|liter|liters)\.?$/i;

/** Pure count/pack token: 2pk, 10 pk, 5ct, 2pack, 3pc, 100pcs, x2 … */
const COUNT_RE = /^(?:\d+\s*(?:pk|pack|packs|ct|cnt|count|pc|pcs|piece|pieces|x)|x\s*\d+)\.?$/i;

/**
 * Generic cannabis category/descriptor words that are never a brand on their
 * own. Only ever compared against WHOLE candidate tokens (so "Regulator Sugar
 * Wax (2.0)" — a real product line — is untouched; a candidate is blocked only
 * when EVERY token is generic/weight/count junk).
 */
const GENERIC_WORDS = new Set([
  "flower",
  "flowers",
  "preroll",
  "prerolls",
  "pre",
  "roll",
  "rolls",
  "joint",
  "joints",
  "blunt",
  "blunts",
  "cart",
  "carts",
  "cartridge",
  "cartridges",
  "vape",
  "vapes",
  "disposable",
  "edible",
  "edibles",
  "gummy",
  "gummies",
  "chocolate",
  "cookie",
  "cookies",
  "beverage",
  "drink",
  "concentrate",
  "concentrates",
  "wax",
  "shatter",
  "dab",
  "dabs",
  "badder",
  "budder",
  "crumble",
  "sugar",
  "sauce",
  "rosin",
  "resin",
  "live",
  "distillate",
  "cured",
  "topical",
  "topicals",
  "tincture",
  "tinctures",
  "capsule",
  "capsules",
  "sample",
  "samples",
  "jar",
  "infused",
  "indica",
  "sativa",
  "hybrid",
  "thc",
  "cbd",
  "cbn",
  "cbg",
  "bulk",
  "lot",
  "unlotted",
  "usable",
  "cannabis",
  "marijuana",
  "mix",
  "each",
  "unit",
  "units",
]);

/**
 * Merge "number unit" pairs ("10 ct" → "10ct", "3.5 g" → "3.5g") so spaced
 * variants of the same junk are recognized. A BARE number never merges — it
 * stays a plain token, so all-numeric real brands like '2727' pass through.
 */
const NUM_UNIT_RE =
  /(\d(?:\.\d+)?)\s+(g|mg|kg|oz|ml|l|gram|grams|ounce|ounces|liter|liters|pk|pack|packs|ct|cnt|count|pc|pcs|piece|pieces)\b/gi;

/** True when a candidate is junk: every token is a weight, count, or generic word. */
export function isJunkBrandCandidate(candidate: string): boolean {
  const tokens = candidate
    .replace(NUM_UNIT_RE, "$1$2")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every(
    (t) => WEIGHT_RE.test(t) || COUNT_RE.test(t) || GENERIC_WORDS.has(t.toLowerCase()),
  );
}

/** The v1 prefix-before-separator match (separators: " | ", ": ", " – ", " - "). */
const PREFIX_RE = /^\s*([^|:\u2013-]{2,40}?)\s*[|:\u2013-]\s+/;

/**
 * "<something> by <brand>" — the brand runs from after the LAST " by " up to
 * the next separator or end of name. Case-insensitive on the "by" itself.
 */
const BY_RE = /\sby\s+([^|:\u2013-]{2,40}?)\s*(?:[|:\u2013-]\s|$)/i;

/**
 * Extract a brand from a CCRS product name. Conservative: null when unsure.
 *
 *  1. Prefix before a separator (dominant convention) — unless the prefix is
 *     junk (pure weight/size/count/generic tokens).
 *  2. "… by <brand>" (verified common convention) — wins when the prefix
 *     itself contains " by " (e.g. "Gelato x Dosidos by Mt Baker Homegrown -
 *     14g" is a strain-by-brand, not a brand prefix), or when the prefix was
 *     junk.
 *  3. Otherwise null — never guessed.
 */
export function extractBrand(name: string | null | undefined): string | null {
  if (!name) return null;

  const prefixMatch = name.match(PREFIX_RE);
  const prefix = prefixMatch && prefixMatch[1].trim().length >= 2 ? prefixMatch[1].trim() : null;

  // "… by <brand>" beats a prefix that is itself a "<strain> by <brand>" run.
  const byMatch = name.match(BY_RE);
  const byBrand = byMatch && byMatch[1].trim().length >= 2 ? byMatch[1].trim() : null;

  if (prefix && !/\sby\s/i.test(prefix) && !isJunkBrandCandidate(prefix)) return prefix;
  if (byBrand && !isJunkBrandCandidate(byBrand)) return byBrand;
  return null;
}
