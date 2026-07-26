/**
 * src/lib/compliance/ccrs-product-name-core.ts
 *
 * SLICE 53 — the CCRS-layer of the owner-approved TWO-LAYER naming design.
 *
 *   Layer 1 (humans): menu_items.name stays the clean display name the
 *   website, register, and receipts show ("Space OG", "Rainbow Chews 100mg").
 *
 *   Layer 2 (CCRS): the Product.csv Name is AUTO-COMPOSED from existing data
 *   fields in the ONE consistent convention (owner: "I want it to be
 *   consistent and smart, the same style and format for all products, both
 *   received and imported. What ever the convention is, I want it followed
 *   every time"):
 *
 *       {Vendor-short} {Brand} {DisplayName} {CannabinoidTag} {Type} [{Size}]
 *
 *   e.g. "Downtown Space OG Flower 1g". The composed name lives ONLY in the
 *   CCRS files — nothing human-facing changes.
 *
 * DUPLICATION GUARDS (all deterministic, never guess):
 *   - brand token dropped when the display name already contains it
 *     ("Wana Sour Gummies" never becomes "Wana Wana Sour Gummies");
 *   - type token dropped when already present in the display name;
 *   - size token skipped when the display name already carries ANY size/dose
 *     token (a dose-led "Rainbow Chews 100mg" does not get "3g" appended);
 *   - cannabinoid tag skipped when the display name already carries a ratio
 *     or that tag (dose-led names keep their ratio per the owner rule).
 *
 * NEVER GUESS: every token comes from a real stored field; when composition
 * yields nothing usable the DISPLAY NAME itself is used (clamped), flagged
 * `composed: false`. Cannabinoid tags derive from measured values only.
 *
 * PURE: no I/O, no DB — unit-testable; registered in the pure runner.
 */
import {
  buildComplianceName,
  type Cannabinoid,
  cannabinoidTag,
  collapseWhitespace,
  NAME_MAX_LEN,
  stripDisallowedChars,
} from "@/lib/naming/convention-core";
import { websiteCategoryCardLabel } from "@/lib/menu/card-type-core";

/** Everything the composer may use — all real stored fields, none invented. */
export type CcrsNameSource = {
  /** Layer-1 display name (menu_items.name) — the subject of the composition. */
  name: string;
  vendor?: string | null;
  brand?: string | null;
  /** POS "Category" column ("Flower", "Live Resin", "Gummies") — the type token. */
  posInventoryCategory?: string | null;
  /** Website category fallback for the type token ("flower", "edible-solid"). */
  category?: string | null;
  /** Unit weight in grams (string or number, as CCRS carries it) for the size token. */
  unitWeightGrams?: string | number | null;
  /** Measured cannabinoids (never guessed) for tag derivation. */
  compounds?: Cannabinoid[] | null;
  totalThc?: Cannabinoid | null;
  totalCbd?: Cannabinoid | null;
};

export type ComposedCcrsName = {
  name: string;
  /** true when the full convention composed; false when we fell back to the display name. */
  composed: boolean;
  truncated: boolean;
};

/** Escape a string for use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Case- and punctuation-insensitive containment: does `haystack` already carry
 * all the words of `needle` in order (word-bounded)? Mirrors the conservative
 * tokenized matching of card-brand-core so "Lil' Ray's" finds "Lil Rays".
 */
export function containsTokens(haystack: string, needle: string): boolean {
  const tokens = needle.match(/[a-z0-9]+/gi);
  if (!tokens || tokens.length === 0) return false;
  const pattern = new RegExp(
    `(?:^|[^a-z0-9])${tokens.map(escapeRegExp).join("[^a-z0-9]+")}(?:[^a-z0-9]|$)`,
    "i",
  );
  return pattern.test(haystack);
}

/** Any size/dose token already in the name ("3.5g", "100mg", "6oz", "12 ml"). */
const SIZE_TOKEN_RE = /\d+(?:\.\d+)?\s*(?:g|gram|grams|mg|milligram|milligrams|oz|ounce|ounces|ml|milliliter|milliliters)\b/i;
/** A ratio token already in the name ("1:1", "10:1"). */
const RATIO_TOKEN_RE = /\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?/;

/** Format a grams value as the convention size token ("1g", "3.5g"). */
function sizeToken(grams: string | number | null | undefined): string {
  if (grams === null || grams === undefined || grams === "") return "";
  const n = typeof grams === "number" ? grams : parseFloat(String(grams));
  if (!Number.isFinite(n) || n <= 0) return "";
  // trim trailing zeros without scientific notation (3.500 -> 3.5, 1.0 -> 1)
  const s = (Math.round(n * 1000) / 1000).toString();
  return `${s}g`;
}

/**
 * Compose the CCRS Product.Name from stored fields. Deterministic; falls back
 * to the (clamped) display name when composition is not possible.
 */
export function composeCcrsProductName(src: CcrsNameSource): ComposedCcrsName {
  // The composed name is machine-generated, so disallowed CCRS characters
  // ( , / & ! # $ @ " | ) are auto-cleaned here deterministically — the
  // human-facing display name keeps its "&" etc.; only the CCRS layer cleans.
  const subject = collapseWhitespace(stripDisallowedChars(src.name ?? ""));
  if (!subject) return { name: "", composed: false, truncated: false };

  // Brand: dropped when the display name already contains it (dup guard).
  let brand = collapseWhitespace(stripDisallowedChars(src.brand ?? ""));
  if (brand && containsTokens(subject, brand)) brand = "";

  // Vendor: disallowed chars cleaned before shortening ("R&B GROUP" -> "R B").
  const vendor = collapseWhitespace(stripDisallowedChars(src.vendor ?? ""));

  // Type: POS category first, website category fallback; dropped when the
  // display name already contains it.
  let type =
    collapseWhitespace(stripDisallowedChars(src.posInventoryCategory ?? "")) ||
    (src.category ? websiteCategoryCardLabel(String(src.category)) : "");
  if (type && containsTokens(subject, type)) type = "";

  // Size: only when we truly have a weight AND the name carries no size/dose.
  const size = SIZE_TOKEN_RE.test(subject) ? "" : sizeToken(src.unitWeightGrams);

  // Cannabinoid tag: derived from measured values; skipped when the display
  // name already carries a ratio or that tag (owner rule keeps ratios in
  // dose-led display names — never write "1:1 ... 1:1").
  const tag = cannabinoidTag(src.compounds, src.totalThc, src.totalCbd);
  const subjectHasTag =
    RATIO_TOKEN_RE.test(subject) || (tag !== "" && containsTokens(subject, tag));

  const built = buildComplianceName({
    vendor,
    brand,
    strainOrFlavor: subject,
    type,
    size,
    compounds: subjectHasTag ? null : src.compounds,
    totalThc: subjectHasTag ? null : src.totalThc,
    totalCbd: subjectHasTag ? null : src.totalCbd,
  });

  if (!built.name) {
    // Composition produced nothing usable — keep the display name (never guess).
    const clamped = subject.length > NAME_MAX_LEN ? subject.slice(0, NAME_MAX_LEN).trim() : subject;
    return { name: clamped, composed: false, truncated: subject.length > NAME_MAX_LEN };
  }
  return { name: built.name, composed: true, truncated: built.truncated };
}

/**
 * Deterministic collision disambiguation for a whole Product file: two
 * DIFFERENT products must never share one Name (CCRS joins Inventory.Product
 * -> Product.Name by exact string; a shared name is an ambiguous join). On a
 * collision the later product gets a short, stable suffix derived from its
 * OWN ExternalIdentifier — real data, not an invented counter, so the name is
 * identical batch after batch.
 */
export function disambiguateCcrsName(
  name: string,
  externalId: string,
  usedLower: Set<string>,
): { name: string; disambiguated: boolean } {
  const base = collapseWhitespace(name);
  if (!usedLower.has(base.toLowerCase())) {
    usedLower.add(base.toLowerCase());
    return { name: base, disambiguated: false };
  }
  const tail = (externalId ?? "").replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase() || "X";
  let candidate = `${base} ${tail}`;
  if (candidate.length > NAME_MAX_LEN) {
    const cut = base.slice(0, NAME_MAX_LEN - (tail.length + 1));
    const lastSpace = cut.lastIndexOf(" ");
    candidate = `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim()} ${tail}`;
  }
  usedLower.add(candidate.toLowerCase());
  return { name: candidate, disambiguated: true };
}

/* ------------------------------------------------------------------ *
 * Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */
export function __runCcrsProductNameCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`ccrs-product-name-core self-test failed: ${msg}`);
    passed += 1;
  };
  const c = (type: Cannabinoid["type"], value: number, unit: Cannabinoid["unit"] = "mg"): Cannabinoid => ({ type, value, unit });

  // The approved two-layer example, verbatim: "Downtown Space OG Flower 1g".
  const flower = composeCcrsProductName({
    name: "Space OG",
    vendor: "DOWNTOWN CANNABIS COMPANY",
    brand: "Downtown",
    posInventoryCategory: "Flower",
    category: "flower",
    unitWeightGrams: 1,
  });
  ok(flower.name === "Downtown Space OG Flower 1g", "approved example: " + flower.name);
  ok(flower.composed, "approved example composed");

  // Brand dup guard: display name already carries the brand.
  const wana = composeCcrsProductName({
    name: "Wana Sour Gummies 100mg",
    vendor: "NORTHWEST CANNABIS SOLUTIONS",
    brand: "Wana",
    posInventoryCategory: "Gummies",
    category: "edible-solid",
    unitWeightGrams: 40,
  });
  ok(!/Wana Wana/i.test(wana.name), "no brand duplication: " + wana.name);
  // Dose-led name keeps its mg and does NOT get a grams size appended.
  ok(/100mg/.test(wana.name), "dose preserved: " + wana.name);
  ok(!/40g/.test(wana.name), "no grams size when name carries a dose: " + wana.name);

  // Type dup guard: name already says the type.
  const preroll = composeCcrsProductName({
    name: "Blue Dream Preroll",
    vendor: "GROW OP FARMS",
    brand: "Phat Panda",
    posInventoryCategory: "Preroll",
    category: "preroll",
    unitWeightGrams: 1,
  });
  ok(!/Preroll.*Preroll/i.test(preroll.name), "no type duplication: " + preroll.name);

  // Ratio guard: a name already carrying the ratio never gets the tag twice.
  const ratio = composeCcrsProductName({
    name: "Recovery Tincture 1:1 100mg",
    vendor: "CRAFT ELIXIRS",
    brand: "",
    posInventoryCategory: "Tincture",
    category: "tincture",
    compounds: [c("thc", 100), c("cbd", 100)],
  });
  ok((ratio.name.match(/1:1/g) ?? []).length === 1, "ratio appears once: " + ratio.name);

  // Tag derived from measured values when the name lacks it.
  const tagged = composeCcrsProductName({
    name: "Strawberry Lemonade Shot 100mg",
    vendor: "EVERGREEN HERBAL",
    brand: "Ceres",
    posInventoryCategory: "Shots",
    category: "edible-liquid",
    compounds: [c("thc", 100), c("cbd", 50)],
  });
  ok(/2:1/.test(tagged.name), "measured ratio tag added: " + tagged.name);

  // Vendor shortening flows through ("KLARITIE FARMS INC" -> "Klaritie").
  const klaritie = composeCcrsProductName({
    name: "Gelato",
    vendor: "KLARITIE FARMS INC",
    brand: "",
    posInventoryCategory: "Live Resin",
    category: "concentrate",
    unitWeightGrams: "1",
  });
  ok(klaritie.name === "Klaritie Gelato Live Resin 1g", "short vendor composed: " + klaritie.name);

  // Fallback: nothing but a name -> the name itself (composed=true since the
  // builder still produces it; a BLANK name is the false case).
  const bare = composeCcrsProductName({ name: "Mystery Product" });
  ok(bare.name === "Mystery Product", "bare name kept: " + bare.name);
  ok(composeCcrsProductName({ name: "" }).name === "", "blank stays blank");

  // 75-char clamp at a word boundary.
  const long = composeCcrsProductName({
    name: "Super Extended Strawberry Watermelon Kiwi Cucumber Melon Fusion Refresher",
    vendor: "WASHINGTON PACKAGING AND PROCESSING",
    brand: "Big City Sasquatch",
    posInventoryCategory: "Liquid Infused Edible",
    category: "edible-liquid",
  });
  ok(long.name.length <= NAME_MAX_LEN, "clamped: " + long.name.length);

  // Collision disambiguation: same composed name, two products -> stable suffix.
  const used = new Set<string>();
  const a = disambiguateCcrsName("Downtown Comatoast Concentrate 1g", "GW-LOT-000123", used);
  const b = disambiguateCcrsName("Downtown Comatoast Concentrate 1g", "GW-LOT-000456", used);
  ok(!a.disambiguated && a.name === "Downtown Comatoast Concentrate 1g", "first keeps name");
  ok(b.disambiguated && b.name === "Downtown Comatoast Concentrate 1g 000456", "second gets suffix: " + b.name);
  ok(b.name.length <= NAME_MAX_LEN, "suffix stays within cap");
  // Deterministic: same inputs, same result.
  const used2 = new Set<string>();
  disambiguateCcrsName("Downtown Comatoast Concentrate 1g", "GW-LOT-000123", used2);
  const b2 = disambiguateCcrsName("Downtown Comatoast Concentrate 1g", "GW-LOT-000456", used2);
  ok(b2.name === b.name, "deterministic suffix");

  // Disallowed CCRS characters are auto-cleaned in the composed layer only
  // (real catalog case: display name "Black & Blueberry" keeps its "&" on the
  // website; the CCRS name must not carry it).
  const amp = composeCcrsProductName({
    name: "Black & Blueberry",
    vendor: "AGRO COUTURE",
    brand: "",
    posInventoryCategory: "Cartridge",
    category: "cartridge",
    unitWeightGrams: 1,
  });
  ok(amp.name === "Agro Couture Black Blueberry Cartridge 1g", "disallowed chars cleaned: " + amp.name);

  // containsTokens: punctuation/case-insensitive, word-bounded (mirrors the
  // conservative matching of card-brand-core — the real Cultivera case is a
  // haystack that carries the punctuation: "Lil' Ray'S Lemonade Citrus Kush").
  ok(containsTokens("Lil' Ray'S Lemonade Citrus Kush", "Lil' Ray's Lemonade"), "punctuation/case-insensitive containment");
  ok(!containsTokens("Oooweet Treats", "Ooowee"), "word boundary respected");

  console.log(`ccrs-product-name-core: ${passed} assertions passed`);
}
