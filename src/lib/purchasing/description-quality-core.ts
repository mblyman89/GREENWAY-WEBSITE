/**
 * src/lib/purchasing/description-quality-core.ts
 *
 * PR-D2 — the SMART description picker's brain. A vendor's per-product
 * "description" is sometimes genuinely useful prose, but on many menus it is
 * really just the product's NAME (or a slightly reworded version of it) — e.g.
 * a product called "Blue Dream 3.5g" whose description reads "Blue Dream" or
 * "Blue Dream 3.5g Indica". In those cases the CATEGORY description (which
 * accurately describes every product in that category) is the better thing to
 * show and save.
 *
 * This module decides, for one description relative to its product name,
 * whether the description is:
 *   • "good"       — real, product-useful prose; keep it.
 *   • "name_echo"  — just the name, or a trivial variant of the name.
 *   • "low_value"  — too short / no real prose to be useful (e.g. "3.5g",
 *                    "Indica", a single word), even if it isn't the name.
 *
 * The classifier is deliberately CONSERVATIVE: when in doubt it returns
 * "good", so a genuinely useful description is never discarded. The stand-in
 * only kicks in on a clear name-echo / clearly-empty verdict.
 *
 * 100% pure (no I/O, no Date.now, no DOM). Self-tested in the pure runner and
 * mirrored in vitest.
 */

/** The verdict for a single description relative to its product name. */
export type DescriptionVerdict = "good" | "name_echo" | "low_value";

export type DescriptionQuality = {
  verdict: DescriptionVerdict;
  /** Normalized description (lowercased, tags/size/punct stripped, ws collapsed). */
  normalizedDescription: string;
  /** Normalized product name (same normalization). */
  normalizedName: string;
  /** Plain-English reason, for audit trails and tooltips. */
  reason: string;
};

/**
 * Minimum number of "real" words a description needs before it can count as
 * good prose on its own. One or two bare words (e.g. "Indica", "Blue Dream")
 * carry no product-useful information beyond the name.
 */
const MIN_PROSE_WORDS = 3;

/** Bracketed tags Cultivera/LeafLink append: "[3.5g]", "[Indica]", "[D.O.H. COMPLIANT]". */
const BRACKET_TAG_RE = /\[[^\]]*\]/g;

/** Bare size / weight tokens: "3.5g", "1g", "100mg", "1 oz", "3.5 g", "1/8". */
const SIZE_TOKEN_RE =
  /\b\d+(?:\.\d+)?\s*(?:g|mg|kg|oz|ml|l|gram|grams|milligram|milligrams|ounce|ounces|pack|pk|ct|count)\b|\b\d+\/\d+\b/gi;

/** Strain-type / compliance words that are labels, not prose. */
const LABEL_WORDS = new Set([
  "indica",
  "sativa",
  "hybrid",
  "doh",
  "compliant",
  "cbd",
  "thc",
  "preroll",
  "prerolls",
  "pre-roll",
  "flower",
  "cartridge",
  "cart",
  "vape",
  "edible",
  "edibles",
  "concentrate",
]);

/**
 * Normalize a piece of text for comparison: lowercase, strip bracket tags,
 * strip bare size/weight tokens, drop punctuation, collapse whitespace.
 * Returns "" for null/blank input.
 */
export function normalizeForCompare(input: string | null | undefined): string {
  return String(input ?? "")
    .toLowerCase()
    .replace(BRACKET_TAG_RE, " ")
    .replace(SIZE_TOKEN_RE, " ")
    // keep letters, numbers, and spaces; everything else becomes a space
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Split normalized text into word tokens (empty string -> []). */
function words(normalized: string): string[] {
  return normalized.length === 0 ? [] : normalized.split(" ");
}

/**
 * The "content" words of a text: normalized words with pure label words
 * (indica/sativa/hybrid/doh/compliant/…) removed. This is what tells us whether
 * a description says anything BEYOND the name + its labels.
 */
function contentWords(normalized: string, nameSet: Set<string>): string[] {
  return words(normalized).filter((w) => !LABEL_WORDS.has(w) && !nameSet.has(w));
}

/**
 * Classify a description relative to its product name.
 *
 * Order of checks (conservative — only demote on a CLEAR signal):
 *   1. Empty / whitespace description                 -> low_value ("empty")
 *   2. Normalized desc == normalized name             -> name_echo ("exact")
 *   3. Desc adds NOTHING beyond the name + labels     -> name_echo ("no content beyond name")
 *   4. Desc has fewer than MIN_PROSE_WORDS real words -> low_value ("too short")
 *   5. Otherwise                                       -> good
 *
 * `productName` may be null/blank; then only the length/emptiness checks apply
 * (we can't compare to a name we don't have) — so we never wrongly flag prose
 * as a name echo when there's no name to echo.
 */
export function classifyDescriptionQuality(
  description: string | null | undefined,
  productName: string | null | undefined,
): DescriptionQuality {
  const normalizedDescription = normalizeForCompare(description);
  const normalizedName = normalizeForCompare(productName);

  // 1 — genuinely empty (after stripping tags/size/punct).
  if (normalizedDescription.length === 0) {
    return {
      verdict: "low_value",
      normalizedDescription,
      normalizedName,
      reason: "The description is empty once tags and sizes are removed.",
    };
  }

  const nameSet = new Set(words(normalizedName));

  // 2 — exact name echo (identical after normalization).
  if (normalizedName.length > 0 && normalizedDescription === normalizedName) {
    return {
      verdict: "name_echo",
      normalizedDescription,
      normalizedName,
      reason: "The description is just the product's name.",
    };
  }

  // Words that carry meaning: not labels (indica/doh/…) and not part of the name.
  const extra = contentWords(normalizedDescription, nameSet);

  // 3 — name echo: it DOES reuse the name and adds nothing but labels
  //     (e.g. "Blue Dream Indica" for a product named "Blue Dream"). Requires
  //     that at least one name word actually appears, otherwise it isn't an
  //     "echo" of the name — it's just label soup (handled by check 4).
  const reusesName =
    normalizedName.length > 0 && words(normalizedDescription).some((w) => nameSet.has(w));
  if (reusesName && extra.length === 0) {
    return {
      verdict: "name_echo",
      normalizedDescription,
      normalizedName,
      reason: "The description repeats the name (and labels) without adding anything.",
    };
  }

  // 4 — too short to be real prose. Count CONTENT words (drop labels AND name
  //     words) so "Indica hybrid flower" or a bare "3.5g Indica" is low_value.
  if (extra.length < MIN_PROSE_WORDS) {
    return {
      verdict: "low_value",
      normalizedDescription,
      normalizedName,
      reason: `The description is too short to be useful (${extra.length} meaningful word${extra.length === 1 ? "" : "s"}).`,
    };
  }

  // 5 — real, product-useful prose.
  return {
    verdict: "good",
    normalizedDescription,
    normalizedName,
    reason: "The description is real, product-useful prose.",
  };
}

/** True when the description should NOT stand on its own (name echo or low value). */
export function isWeakDescription(
  description: string | null | undefined,
  productName: string | null | undefined,
): boolean {
  return classifyDescriptionQuality(description, productName).verdict !== "good";
}

/* --------------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`description-quality-core self-test failed: ${msg}`);
}

export function __runDescriptionQualityCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };
  const verdict = (d: string | null, name: string | null) =>
    classifyDescriptionQuality(d, name).verdict;

  // --- GOOD: real prose is always kept. ---
  ok(
    verdict("A smooth, uplifting hybrid with notes of berry and citrus.", "Blue Dream") === "good",
    "real prose is good",
  );
  ok(
    verdict("Hand-trimmed indoor flower grown in living soil for a clean, terpene-rich smoke.", "Blue Dream 3.5g") ===
      "good",
    "long prose with a label word is still good",
  );
  ok(
    verdict("Ten tangy watermelon gummies, 10mg THC each, made with real fruit.", "Watermelon Gummies") === "good",
    "prose that shares a name word but adds content is good",
  );

  // --- NAME ECHO: description is just the name (or a trivial variant). ---
  ok(verdict("Blue Dream", "Blue Dream") === "name_echo", "exact name echo");
  ok(verdict("blue dream", "Blue Dream") === "name_echo", "case-insensitive name echo");
  ok(verdict("Blue Dream 3.5g", "Blue Dream") === "name_echo", "name + size tag echo");
  ok(verdict("Blue Dream [3.5g] [Indica]", "Blue Dream") === "name_echo", "name + bracket tags echo");
  ok(verdict("Blue Dream Indica", "Blue Dream") === "name_echo", "name + label word echo");
  ok(
    verdict("Blue Dream 3.5g [D.O.H. COMPLIANT]", "Blue Dream 3.5g") === "name_echo",
    "name with size + compliance tag echo",
  );

  // --- LOW VALUE: not the name, but no real prose. ---
  ok(verdict("3.5g", "Blue Dream") === "low_value", "bare size is low value");
  ok(verdict("Indica", "Blue Dream") === "low_value", "bare label is low value");
  ok(verdict("Indica hybrid flower", "Blue Dream") === "low_value", "all-label phrase is low value");
  ok(verdict("   ", "Blue Dream") === "low_value", "whitespace is low value (empty)");
  ok(verdict("[3.5g] [Indica]", "Blue Dream") === "low_value", "only tags -> empty -> low value");

  // --- NO NAME: can't name-echo; only emptiness/length apply. ---
  ok(verdict("Blue Dream", null) === "low_value", "two words, no name -> too short (low value)");
  ok(verdict("A crisp, citrus-forward daytime strain.", null) === "good", "prose with no name is good");
  ok(verdict("", null) === "low_value", "empty with no name is low value");

  // --- isWeakDescription helper. ---
  ok(isWeakDescription("Blue Dream", "Blue Dream") === true, "name echo is weak");
  ok(isWeakDescription("3.5g", "Blue Dream") === true, "low value is weak");
  ok(
    isWeakDescription("A smooth, uplifting hybrid with berry notes.", "Blue Dream") === false,
    "good prose is not weak",
  );

  // --- normalizeForCompare pins. ---
  // Bracket tags (incl. their contents) and bare sizes are stripped entirely.
  ok(normalizeForCompare("Blue Dream [3.5g] [Indica]!") === "blue dream", "normalize strips bracket tags + punct");
  ok(normalizeForCompare("Blue Dream 3.5g Indica") === "blue dream indica", "normalize strips bare size, keeps loose words");
  ok(normalizeForCompare(null) === "", "normalize null -> empty");
  ok(normalizeForCompare("  MANY   spaces  ") === "many spaces", "normalize collapses whitespace");

  console.log(`description-quality-core: ${n} self-tests passed`);
}
