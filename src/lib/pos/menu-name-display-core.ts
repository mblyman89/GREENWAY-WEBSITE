/**
 * src/lib/pos/menu-name-display-core.ts  (POS Bug 2 — register display cleanup)
 *
 * PURE, DISPLAY-ONLY name cleanup for the register menu. No React, no DB, no
 * stored-data mutation.
 *
 * THE BUG (owner report): some product CARD names carry a baked-in package
 * size — e.g. "SPR - Sour Diesel -7g" — while the card's variant chips show
 * the REAL sizes ("3.5 g", "1 g", …). On the register the name and the size
 * then disagree ("SPR - Sour Diesel -7g · 3.5 g"). The back office inventory
 * and the public website are correct; only the register's rolled-up card name
 * still has the leftover size token from the draft it was first mastered from
 * (intake-mastering-core keeps a singleton card's draft name VERBATIM, and
 * when later sizes join as new variants the card NAME is never rewritten).
 *
 * THE FIX (owner-confirmed "display cleanup" method): strip a TRAILING size /
 * pack token from the displayed card name so the name reads clean and the
 * size lives only in the variant chip beside it. Stored data is untouched and
 * the transform is reversible (we only ever remove a recognized trailing size
 * token — never rename or re-map anything).
 *
 * Deliberately CONSERVATIVE:
 *   - Only the END of the name is trimmed (a strain name that legitimately
 *     contains a number in the MIDDLE — "Girl Scout Cookies", "AK-47",
 *     "9 Pound Hammer" — is never touched).
 *   - Only a recognized size/pack unit is stripped (grams/oz/ml/mg + pack
 *     counts), optionally preceded by a "-", "·", ":" or "|" separator.
 *   - We NEVER strip down to nothing: if the whole name is just a size, or
 *     removal would leave < 2 chars, the original name is returned unchanged.
 *   - When a `variantLabel` is supplied and the trailing token DOES NOT look
 *     like a package size at all, nothing is stripped.
 */

// A trailing package-size token: an optional separator, then a number with an
// optional decimal, then a size/pack unit, anchored to the END of the string.
// Mirrors the unit vocabulary intake-mastering-core.familyFromName strips.
const TRAILING_SIZE_RE =
  /\s*[-·:|/]?\s*\d+(?:\.\d+)?\s*(?:g|gram|grams|mg|milligram|milligrams|oz|ounce|ounces|ml|milliliter|milliliters|fl\.?\s*oz|fluid\s*ounce|fluidounce|pk|pack|packs)\b\.?\s*$/i;

// SLICE 49 (owner rule): dose-led categories keep the mg dose in the customer
// name — the transform and intake mastering now deliberately PRESERVE it there
// ("Const Moonshot Grape 100mg"), so the register cleanup must not strip it
// back off. Same vocabulary as transform.ts DOSE_LED_CATEGORIES /
// intake-mastering-core DOSE_LED_CATEGORIES.
const DOSE_LED_CATEGORIES = new Set(["edible-solid", "edible-liquid", "topical", "tincture", "rso"]);

// Dose-preserving variant of TRAILING_SIZE_RE: identical except the mg
// vocabulary is EXCLUDED, so "… 100mg" survives while "… 3.5g" still strips.
const TRAILING_SIZE_NO_MG_RE =
  /\s*[-·:|/]?\s*\d+(?:\.\d+)?\s*(?:g|gram|grams|oz|ounce|ounces|ml|milliliter|milliliters|fl\.?\s*oz|fluid\s*ounce|fluidounce|pk|pack|packs)\b\.?\s*$/i;

// A trailing bare pack/count word with no number ("… 2-pack" already caught
// above; this catches "… single", "… each", "… pouch" style trailers).
const TRAILING_FORM_RE = /\s*[-·:|/]?\s*(?:single|each|pouch|jar|tin|unit)\s*$/i;

function collapse(value: unknown): string {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Clean a register card's DISPLAY name by removing a trailing package-size or
 * pack/form token. Pure and idempotent. Returns the original (collapsed) name
 * when there is nothing safe to strip.
 *
 * `variantLabel` is optional context: when it is a real size chip the cleanup
 * is exactly what we want (the size belongs on the chip, not in the name); it
 * is not required for the strip to run, because a trailing size token in a
 * card name is noise regardless.
 */
export function cleanCardDisplayName(name: string, variantLabel?: string | null, category?: string | null): string {
  const original = collapse(name);
  if (!original) return original;

  // SLICE 49: dose-led categories (edibles/liquids/topicals/tinctures/RSO)
  // keep a trailing mg dose — it is part of the product's identity, not a
  // package-size leftover. Grams/oz/ml/pack trailers still strip.
  const sizeRe = category && DOSE_LED_CATEGORIES.has(String(category).toLowerCase()) ? TRAILING_SIZE_NO_MG_RE : TRAILING_SIZE_RE;

  let s = original;
  // Strip AT MOST a couple of trailing tokens ("… 7g single" → "…"): loop a
  // small bounded number of times so we never spin on pathological input.
  for (let i = 0; i < 3; i += 1) {
    let next = s.replace(sizeRe, "");
    next = next.replace(TRAILING_FORM_RE, "");
    next = next.replace(/[\s\-·:|/]+$/, "").trim();
    if (next === s) break;
    s = next;
  }

  // Never strip to nothing (or near-nothing): a card whose whole name is just
  // a size keeps its original name rather than becoming blank/ambiguous.
  if (s.length < 2) return original;
  // Avoid over-collapsing to something that lost all letters (e.g. a name that
  // was only numbers + unit): require at least one letter to remain.
  if (!/[a-z]/i.test(s)) return original;

  // `variantLabel` intentionally unused as a gate (a trailing size in a card
  // name is noise whether or not a chip is present); referenced here so the
  // signature documents the caller's context without an eslint unused warning.
  void variantLabel;
  return s;
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

export function __runMenuNameDisplayCoreTests(): void {
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

  // The owner's exact report: a "-7g" baked into the card name.
  ok(cleanCardDisplayName("SPR - Sour Diesel -7g", "3.5 g") === "SPR - Sour Diesel", "strips trailing -7g");
  ok(cleanCardDisplayName("Blue Dream 3.5g") === "Blue Dream", "strips trailing 3.5g (no separator)");
  ok(cleanCardDisplayName("Fairwinds Healing Balm 300mg") === "Fairwinds Healing Balm", "strips trailing 300mg");
  ok(cleanCardDisplayName("Wana Gummies 10pk") === "Wana Gummies", "strips trailing 10pk");
  ok(cleanCardDisplayName("Vaseline 1 oz") === "Vaseline", "strips trailing 1 oz with space");
  ok(cleanCardDisplayName("Tincture 30 ml") === "Tincture", "strips trailing 30 ml");
  ok(cleanCardDisplayName("Blue Dream 3.5g single") === "Blue Dream", "strips size + trailing form word");
  ok(cleanCardDisplayName("Sour Diesel · 7 g") === "Sour Diesel", "strips middot-separated size");

  // Must NOT touch legitimate names.
  ok(cleanCardDisplayName("Girl Scout Cookies") === "Girl Scout Cookies", "keeps a clean strain name");
  ok(cleanCardDisplayName("AK-47") === "AK-47", "keeps AK-47 (number is the identity)");
  ok(cleanCardDisplayName("9 Pound Hammer") === "9 Pound Hammer", "keeps leading/middle number");
  ok(cleanCardDisplayName("Blue Dream") === "Blue Dream", "no size -> unchanged");
  // "Runtz" has no trailing size — untouched.
  ok(cleanCardDisplayName("Runtz") === "Runtz", "short clean name unchanged");

  // Never strip to nothing.
  ok(cleanCardDisplayName("3.5g") === "3.5g", "whole-name-is-size stays unchanged");
  ok(cleanCardDisplayName("7 g") === "7 g", "bare size stays unchanged");
  ok(cleanCardDisplayName("") === "", "empty stays empty");

  // Idempotent: cleaning a cleaned name is a no-op.
  const once = cleanCardDisplayName("SPR - Sour Diesel -7g");
  ok(cleanCardDisplayName(once) === once, "idempotent");

  // Whitespace is collapsed.
  ok(cleanCardDisplayName("  Blue   Dream   3.5g  ") === "Blue Dream", "collapses whitespace + strips");

  // SLICE 49: dose-led categories keep the trailing mg dose (owner rule).
  ok(cleanCardDisplayName("Const Moonshot Grape 100mg", "each", "edible-liquid") === "Const Moonshot Grape 100mg", "dose-led: mg dose preserved");
  ok(cleanCardDisplayName("Fairwinds Healing Balm 300mg", null, "topical") === "Fairwinds Healing Balm 300mg", "dose-led topical: mg preserved");
  ok(cleanCardDisplayName("Wana Gummies 100mg 10pk", null, "edible-solid") === "Wana Gummies 100mg", "dose-led: pack strips, mg stays");
  ok(cleanCardDisplayName("Blaze POG Can 100mg", null, "edible-liquid") === "Blaze POG Can 100mg", "dose-led beverage: mg preserved");
  // Non-dose categories keep the ORIGINAL behavior byte-for-byte.
  ok(cleanCardDisplayName("Fairwinds Healing Balm 300mg", null, "flower") === "Fairwinds Healing Balm", "non-dose category still strips mg");
  ok(cleanCardDisplayName("Blue Dream 3.5g", null, "edible-solid") === "Blue Dream", "dose-led: grams still strip (package size, not dose)");

  if (failed > 0) {
    throw new Error(`menu-name-display-core self-tests: ${failed} failed (${passed} passed): ${failures.join("; ")}`);
  }
  console.log(`menu-name-display-core self-tests: ${passed} passed`);
}
