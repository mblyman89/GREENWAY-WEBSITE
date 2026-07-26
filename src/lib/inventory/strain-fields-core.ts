/**
 * src/lib/inventory/strain-fields-core.ts  (PROGRAM 3 / SLICE 54)
 *
 * PURE "right box, right fact" splitter for the strain field
 * (docs/data-governance.md, Rule 1.4).
 *
 * Vendor data (e.g. the Grow Op Farms invoice, several Cultivera rows) stuffs
 * the strain TYPE into the strain NAME: "Chocolate Turtle Sativa",
 * "Cinnamon (Sativa)", or the whole value is just "Hybrid". The database has
 * a dedicated strain_type box — this module moves the fact into it AT THE
 * DOOR so pollution never spreads.
 *
 * Deliberate NEVER-GUESS boundaries (mirrors migration 0138 exactly):
 *   • Only the words indica / sativa / hybrid are treated as type words.
 *     "CBD" is NOT: real strain names legitimately carry it ("Xtra Dragon
 *     CBD", "Watermelon CBD") and stripping it would corrupt genuine names.
 *   • Word-bounded matching only — "Sativai Kush" or "Hybridge" are left
 *     alone.
 *   • The FIRST type word found becomes the type; ALL occurrences are
 *     stripped from the name; whitespace and leftover separators are tidied.
 *   • A caller-provided existing type always wins (we never overwrite a
 *     stated fact with a derived one).
 *
 * No I/O, no React — registered in the pure self-test runner.
 */

export type SplitStrain = {
  /** Cleaned strain name; null when nothing remains after the type word is removed. */
  strainName: string | null;
  /** "indica" | "sativa" | "hybrid" | null — derived only when the text carries a type word. */
  strainType: "indica" | "sativa" | "hybrid" | null;
};

const TYPE_WORD_RE = /\b(indica|sativa|hybrid)\b/i;
const TYPE_WORD_ALL_RE = /\b(indica|sativa|hybrid)\b/gi;
const PAREN_TYPE_RE = /\(\s*(indica|sativa|hybrid)\s*\)/gi;

/**
 * Split a raw strain-field value into { strainName, strainType }.
 * `existingType` (when a real type is already known from its own column)
 * short-circuits derivation but the name is still cleaned.
 */
export function splitStrainField(
  raw: string | null | undefined,
  existingType?: string | null,
): SplitStrain {
  const text = String(raw ?? "").trim();
  const known = normalizeStrainTypeWord(existingType);
  if (!text) return { strainName: null, strainType: known };

  const m = TYPE_WORD_RE.exec(text);
  if (!m) return { strainName: text, strainType: known };

  const derived = m[1].toLowerCase() as "indica" | "sativa" | "hybrid";
  const cleaned = text
    .replace(PAREN_TYPE_RE, " ")
    .replace(TYPE_WORD_ALL_RE, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—(),]+|[\s\-–—(),]+$/g, "")
    .trim();

  return {
    strainName: cleaned.length > 0 ? cleaned : null,
    strainType: known ?? derived,
  };
}

/** Normalize an externally-stated strain type to our vocabulary; null when unknown/blank. */
export function normalizeStrainTypeWord(raw: string | null | undefined): "indica" | "sativa" | "hybrid" | null {
  const t = String(raw ?? "").trim().toLowerCase();
  if (t === "indica" || t === "sativa" || t === "hybrid") return t;
  // WA manifest bracket convention (pdf-manifest-core.ts): H / I / S.
  if (t === "i") return "indica";
  if (t === "s") return "sativa";
  if (t === "h") return "hybrid";
  return null;
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — pinned on REAL polluted values from the
// owner's Cultivera export (scripts audit, July 2026) — registered in runner
// ---------------------------------------------------------------------------

export function __runStrainFieldsCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL strain-fields-core: " + msg);
    passed += 1;
  };
  const eq = (a: SplitStrain, name: string | null, type: SplitStrain["strainType"], msg: string) =>
    ok(a.strainName === name && a.strainType === type, `${msg} — got ${JSON.stringify(a)}`);

  // Bare type-only values (8x "Hybrid", 6x "Sativa", 5x "Indica" in real data).
  eq(splitStrainField("Hybrid"), null, "hybrid", "bare Hybrid");
  eq(splitStrainField("Sativa"), null, "sativa", "bare Sativa");
  eq(splitStrainField("  Indica  "), null, "indica", "bare Indica with spaces");

  // Embedded type words — real rows.
  eq(splitStrainField("Chocolate Turtle Sativa"), "Chocolate Turtle", "sativa", "trailing Sativa");
  eq(splitStrainField("Chocolate Caramel Indica"), "Chocolate Caramel", "indica", "trailing Indica");
  eq(splitStrainField("Sativa Dragon Balls"), "Dragon Balls", "sativa", "leading Sativa");
  eq(splitStrainField("Indica Milk Chocolate"), "Milk Chocolate", "indica", "leading Indica");
  eq(splitStrainField("Cinnamon (Sativa)"), "Cinnamon", "sativa", "parenthesized Sativa");
  eq(splitStrainField("Sour Watermelon Live Resin Indica"), "Sour Watermelon Live Resin", "indica", "long name trailing Indica");
  eq(splitStrainField("Assorted Indica Chews 100mg"), "Assorted Chews 100mg", "indica", "mid-name Indica");
  eq(splitStrainField("Guava Hybrid"), "Guava", "hybrid", "trailing Hybrid");
  eq(splitStrainField("Live Hybrid"), "Live", "hybrid", "Live Hybrid keeps Live");
  eq(splitStrainField("Indica PM 2:1"), "PM 2:1", "indica", "ratio preserved after strip");
  eq(splitStrainField("Marionberry Indica 2:1 THC/CBN"), "Marionberry 2:1 THC/CBN", "indica", "cannabinoids preserved");

  // NEVER-GUESS boundaries: CBD is not a type word; real names keep it.
  eq(splitStrainField("Xtra Dragon CBD"), "Xtra Dragon CBD", null, "CBD not stripped");
  eq(splitStrainField("Watermelon CBD"), "Watermelon CBD", null, "Watermelon CBD untouched");
  eq(splitStrainField("Raspberry 60:1 CBD:THC"), "Raspberry 60:1 CBD:THC", null, "ratio strain untouched");

  // Word boundaries: no substring mangling.
  eq(splitStrainField("Sativai Kush"), "Sativai Kush", null, "Sativai not a type word");
  eq(splitStrainField("Hybridge"), "Hybridge", null, "Hybridge not a type word");

  // Clean names pass through untouched.
  eq(splitStrainField("Blue Dream"), "Blue Dream", null, "clean name untouched");
  eq(splitStrainField(""), null, null, "blank");
  eq(splitStrainField(null), null, null, "null");

  // Existing stated type wins; name still cleaned.
  eq(splitStrainField("Mango Indica", "sativa"), "Mango", "sativa", "stated type wins over derived");
  eq(splitStrainField("Blue Dream", "hybrid"), "Blue Dream", "hybrid", "stated type carried on clean name");

  // normalizeStrainTypeWord: vocabulary + WA bracket letters.
  ok(normalizeStrainTypeWord("Indica") === "indica", "normalize Indica");
  ok(normalizeStrainTypeWord("H") === "hybrid", "normalize H");
  ok(normalizeStrainTypeWord("S") === "sativa", "normalize S");
  ok(normalizeStrainTypeWord("I") === "indica", "normalize I");
  ok(normalizeStrainTypeWord("cbd") === null, "cbd is not a strain type");
  ok(normalizeStrainTypeWord("") === null, "blank normalizes to null");

  console.log(`strain-fields-core: ${passed} assertions passed`);
}
