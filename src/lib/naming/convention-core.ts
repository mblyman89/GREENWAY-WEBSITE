/**
 * src/lib/naming/convention-core.ts
 *
 * SINGLE SOURCE OF TRUTH for the Greenway product naming convention.
 *
 * Pure, dependency-free (no fs, no DB, no React) so the identical logic runs in:
 *   - the CCRS batch builder (compliance Product.Name — the join key),
 *   - the menu display-name derivation,
 *   - the admin intake hard-block gate + AI "suggest an acceptable name" flow,
 *   - unit tests.
 *
 * Convention (owner-finalized v2 — see docs/PRODUCT_NAMING_CONVENTION.md):
 *
 *   Compliance Name  =  {Vendor} {Brand} {Strain/Flavor} {CannabinoidTag} {Type} [{Size}]
 *
 *   - Vendor at the FRONT (vendors carry multiple brands).
 *   - Drop the Brand token when Brand == Vendor (no "Acme Acme").
 *   - Cannabinoid tag: THC-only => none; ratio => "1:1"/"2:1"; 3+ compounds =>
 *     "THC:CBD:CBN" in the FIXED order THC -> CBD -> CBG -> CBN -> CBC.
 *   - CBD flower gets an explicit "CBD" marker.
 *   - <= 75 chars (CCRS Product.Name cap), no commas (CCRS CSV join key).
 *   - Title Case; disallow  , / & ! # $ @ " |  and control chars.
 *
 * NOTHING here guesses product facts. Cannabinoid tags are DERIVED from measured
 * values passed in; if we don't have the data, we emit no tag (never invent one).
 */

/** CCRS Product.Name hard cap (Upload User Guide 2026-02). */
export const NAME_MAX_LEN = 75;

/** Characters that break CSV / search / the CCRS join. Comma included: the CCRS
 * file is CSV and Name is a join key, so commas must never appear. */
export const DISALLOWED_NAME_CHARS = /[,/&!#$@"|\u0000-\u001f]/;

/** Cannabinoid identifiers we understand (mirror of GreenwayCannabinoid.type). */
export type CannabinoidType =
  | "thc"
  | "thca"
  | "cbd"
  | "cbda"
  | "cbg"
  | "cbn"
  | "cbdv"
  | "cbc";

export type CannabinoidUnit = "%" | "mg";

export type Cannabinoid = {
  type: CannabinoidType;
  value: string | number | null;
  unit: CannabinoidUnit;
};

/** Broad product family — decides tag/size behaviour. */
export type ProductFamily =
  | "flower"
  | "concentrate"
  | "edible"
  | "drink"
  | "topical"
  | "tincture"
  | "other";

export type ComplianceNameParts = {
  vendor?: string | null;
  brand?: string | null;
  /** Strain (flower/concentrate) OR flavor (edible/drink). */
  strainOrFlavor?: string | null;
  /** Human product type/texture token, e.g. "Flower", "Live Resin", "Cart". */
  type?: string | null;
  /** Optional size/dose token appended only to disambiguate, e.g. "3.5g". */
  size?: string | null;
  /** Measured cannabinoids for tag derivation (never guessed upstream). */
  compounds?: Cannabinoid[] | null;
  totalThc?: Cannabinoid | null;
  totalCbd?: Cannabinoid | null;
  family?: ProductFamily;
  /** True when this is CBD-dominant flower whose strain name omits "CBD". */
  isCbdFlower?: boolean;
};

/* ------------------------------------------------------------------ *
 *  Text normalization primitives
 * ------------------------------------------------------------------ */

/** Cannabinoid acronyms that must stay upper-case through Title Case. */
const ACRONYMS = new Set([
  "CBD",
  "THC",
  "CBG",
  "CBN",
  "CBC",
  "CBDV",
  "CBDA",
  "THCA",
  "RSO",
  "CBD:THC",
  "THC:CBD",
]);

/** Title Case that preserves known cannabinoid acronyms and ratio tokens. */
export function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/(\s+)/)
    .map((tok) => {
      if (/^\s+$/.test(tok)) return tok;
      const upper = tok.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      // ratio like "1:1" — leave as-is
      if (/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(tok)) return tok;
      // compound-letter tag like "thc:cbd:cbn" -> upper
      if (/^[a-z]{3}(?::[a-z]{3}){1,4}$/i.test(tok)) return upper;
      // units glued to numbers: 3.5g, 100mg -> keep number, lower unit
      if (/^\d/.test(tok)) return tok;
      return tok.charAt(0).toUpperCase() + tok.slice(1);
    })
    .join("")
    // fix embedded acronyms that Title Case may have split (Cbd -> CBD, etc.)
    .replace(/\bCbd\b/g, "CBD")
    .replace(/\bThc\b/g, "THC")
    .replace(/\bCbg\b/g, "CBG")
    .replace(/\bCbn\b/g, "CBN")
    .replace(/\bCbc\b/g, "CBC")
    .replace(/\bRso\b/g, "RSO");
}

/** Collapse whitespace, convert underscores to spaces, trim. */
export function collapseWhitespace(value: string): string {
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

/** Strip disallowed characters (used by the suggester to auto-clean). */
export function stripDisallowedChars(value: string): string {
  return value.replace(/[,/&!#$@"|\u0000-\u001f]/g, " ");
}

/* ------------------------------------------------------------------ *
 *  Cannabinoid tag derivation (DERIVED, never guessed)
 * ------------------------------------------------------------------ */

function num(v: Cannabinoid["value"]): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Fixed display order for multi-cannabinoid letter tags. */
const TAG_ORDER: CannabinoidType[] = ["thc", "cbd", "cbg", "cbn", "cbc"];
const TAG_LABEL: Partial<Record<CannabinoidType, string>> = {
  thc: "THC",
  cbd: "CBD",
  cbg: "CBG",
  cbn: "CBN",
  cbc: "CBC",
};

/**
 * Derive the cannabinoid tag from MEASURED values.
 *   - THC-only (only thc/thca present) => "" (no tag).
 *   - THC + CBD only => ratio "1:1" / "2:1" (rounded to nearest simple ratio).
 *   - 3+ distinct present compounds => "THC:CBD:CBN" style in fixed order.
 * Returns "" when we cannot ground a tag (never invents one).
 */
export function cannabinoidTag(
  compounds?: Cannabinoid[] | null,
  totalThc?: Cannabinoid | null,
  totalCbd?: Cannabinoid | null,
): string {
  // Merge totals into a presence map keyed by canonical acid-normalized type.
  const present = new Map<CannabinoidType, number>();
  const consider = (c?: Cannabinoid | null) => {
    if (!c) return;
    const n = num(c.value);
    if (n === null || n <= 0) return;
    // fold acid forms into their neutral counterpart for tagging
    const t = (
      { thca: "thc", cbda: "cbd", cbdv: "cbd" } as Record<string, CannabinoidType>
    )[c.type] ?? (c.type as CannabinoidType);
    present.set(t, Math.max(present.get(t) ?? 0, n));
  };
  (compounds ?? []).forEach(consider);
  consider(totalThc);
  consider(totalCbd);

  const keys = TAG_ORDER.filter((k) => present.has(k));
  if (keys.length <= 1) return ""; // THC-only (or nothing) => no tag

  const thc = present.get("thc") ?? 0;
  const cbd = present.get("cbd") ?? 0;

  // Exactly THC + CBD => ratio tag.
  if (keys.length === 2 && present.has("thc") && present.has("cbd") && thc > 0 && cbd > 0) {
    return ratioTag(thc, cbd);
  }

  // 3+ compounds => letters in fixed order.
  return keys.map((k) => TAG_LABEL[k]).join(":");
}

/** Express THC:CBD as a simple ratio like "1:1", "2:1", "5:1", "1:2". */
export function ratioTag(thc: number, cbd: number): string {
  if (thc <= 0 || cbd <= 0) return "";
  const bigger = Math.max(thc, cbd);
  const smaller = Math.min(thc, cbd);
  const r = bigger / smaller;
  // snap to a small set of common ratios
  const candidates = [1, 2, 3, 4, 5, 10, 20];
  let best = candidates[0];
  let bestErr = Infinity;
  for (const c of candidates) {
    const err = Math.abs(r - c);
    if (err < bestErr) {
      bestErr = err;
      best = c;
    }
  }
  return thc >= cbd ? `${best}:1` : `1:${best}`;
}

/* ------------------------------------------------------------------ *
 *  Build the compliance name
 * ------------------------------------------------------------------ */

export type BuildResult = {
  name: string;
  truncated: boolean;
  /** The ordered tokens that produced the name (for debugging/tests). */
  tokens: string[];
};

/**
 * Compose the compliance Product.Name from parts, applying all convention rules.
 * Word-boundary clamps to NAME_MAX_LEN (never mid-word) and reports truncation.
 */
export function buildComplianceName(parts: ComplianceNameParts): BuildResult {
  const vendor = collapseWhitespace(parts.vendor ?? "");
  let brand = collapseWhitespace(parts.brand ?? "");
  const subject = collapseWhitespace(parts.strainOrFlavor ?? "");
  const type = collapseWhitespace(parts.type ?? "");
  const size = collapseWhitespace(parts.size ?? "");

  // Rule: drop brand when it equals vendor (case-insensitive).
  if (brand && vendor && brand.toLowerCase() === vendor.toLowerCase()) {
    brand = "";
  }

  // Derive cannabinoid tag from measured values only.
  let tag = cannabinoidTag(parts.compounds, parts.totalThc, parts.totalCbd);

  // CBD flower explicit marker (owner rule): if flagged and the subject/tag
  // doesn't already say CBD, add a CBD marker.
  const saysCbd =
    /\bcbd\b/i.test(subject) || /cbd/i.test(tag);
  if (parts.isCbdFlower && !saysCbd) {
    tag = tag ? `CBD ${tag}` : "CBD";
  }

  const tokens = [vendor, brand, subject, tag, type, size].filter(Boolean);
  let name = toTitleCase(collapseWhitespace(tokens.join(" ")));
  name = collapseWhitespace(name);

  // Word-boundary clamp to the CCRS cap.
  let truncated = false;
  if (name.length > NAME_MAX_LEN) {
    truncated = true;
    const cut = name.slice(0, NAME_MAX_LEN);
    const lastSpace = cut.lastIndexOf(" ");
    name = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
  }

  return { name, truncated, tokens };
}

/* ------------------------------------------------------------------ *
 *  Validation (hard-block gate) + AI suggestion (draft)
 * ------------------------------------------------------------------ */

export type ValidationIssue = {
  code:
    | "empty"
    | "too_long"
    | "disallowed_char"
    | "leading_symbol"
    | "double_space"
    | "all_caps"
    | "all_lower";
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

/**
 * Validate a candidate Product.Name against the convention. Used as a HARD-BLOCK
 * gate at submit. Returns every failing rule so staff (and the AI suggester) can
 * fix all of them at once.
 */
export function validateName(raw: string | null | undefined): ValidationResult {
  const name = (raw ?? "").trim();
  const issues: ValidationIssue[] = [];

  if (!name) {
    issues.push({ code: "empty", message: "Name is required." });
    return { ok: false, issues };
  }
  if (name.length > NAME_MAX_LEN) {
    issues.push({
      code: "too_long",
      message: `Name is ${name.length} chars; CCRS limit is ${NAME_MAX_LEN}.`,
    });
  }
  if (DISALLOWED_NAME_CHARS.test(name)) {
    issues.push({
      code: "disallowed_char",
      message: 'Contains a disallowed character ( , / & ! # $ @ " | or control char ).',
    });
  }
  if (/^[^A-Za-z0-9]/.test(name)) {
    issues.push({
      code: "leading_symbol",
      message: "Name must start with a letter or number (no leading dash/symbol).",
    });
  }
  if (/\s{2,}/.test(name) || /_/.test(name)) {
    issues.push({
      code: "double_space",
      message: "Collapse repeated spaces / underscores to single spaces.",
    });
  }
  const letters = name.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 4 && letters === letters.toUpperCase()) {
    issues.push({ code: "all_caps", message: "Use Title Case, not ALL CAPS." });
  }
  if (letters.length >= 4 && letters === letters.toLowerCase()) {
    issues.push({ code: "all_lower", message: "Use Title Case, not all lowercase." });
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Produce a cleaned, convention-compliant SUGGESTION from a messy raw name.
 * This is a DRAFT the staff confirm — it never auto-commits. It cleans symbols,
 * removes leading junk, collapses spaces, Title-Cases, and clamps to length.
 */
export function suggestName(raw: string | null | undefined): string {
  let s = collapseWhitespace(stripDisallowedChars((raw ?? "").trim()));
  // strip leading non-alphanumeric junk (e.g. "- 3pk ...", "~EO ...")
  s = s.replace(/^[^A-Za-z0-9]+/, "").trim();
  s = toTitleCase(s);
  s = collapseWhitespace(s);
  if (s.length > NAME_MAX_LEN) {
    const cut = s.slice(0, NAME_MAX_LEN);
    const lastSpace = cut.lastIndexOf(" ");
    s = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
  }
  return s;
}

/**
 * Given messy structured parts, prefer rebuilding from parts (the correct,
 * consistent path); fall back to cleaning the raw string when parts are absent.
 */
export function suggestFromParts(
  parts: ComplianceNameParts,
  rawFallback?: string | null,
): string {
  const built = buildComplianceName(parts);
  if (built.name) return built.name;
  return suggestName(rawFallback);
}

/* ------------------------------------------------------------------ *
 *  Unit tests (tsx-runnable via __runNamingConventionTests())
 * ------------------------------------------------------------------ */
export function __runNamingConventionTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
  };
  const c = (type: CannabinoidType, value: number, unit: CannabinoidUnit = "mg"): Cannabinoid => ({ type, value, unit });

  // toTitleCase preserves acronyms + numbers/units
  assert(toTitleCase("blue dream flower") === "Blue Dream Flower", "title case basic");
  assert(toTitleCase("BLUE DREAM") === "Blue Dream", "all caps -> title");
  assert(toTitleCase("cherry wine cbd flower") === "Cherry Wine CBD Flower", "cbd acronym kept");
  assert(toTitleCase("strawberry lemonade 3.5g") === "Strawberry Lemonade 3.5g", "unit kept");

  // cannabinoidTag: THC-only -> ""
  assert(cannabinoidTag([c("thc", 100)], c("thc", 100), null) === "", "thc-only no tag");
  // THC + CBD equal -> 1:1
  assert(cannabinoidTag([c("thc", 100), c("cbd", 100)]) === "1:1", "1:1 ratio");
  // 2:1
  assert(cannabinoidTag([c("thc", 100), c("cbd", 50)]) === "2:1", "2:1 ratio");
  // 1:2
  assert(cannabinoidTag([c("thc", 50), c("cbd", 100)]) === "1:2", "1:2 ratio");
  // 3 compounds -> letters in fixed order
  assert(cannabinoidTag([c("cbn", 10), c("thc", 100), c("cbd", 100)]) === "THC:CBD:CBN", "3-compound tag order");
  // acid forms fold in
  assert(cannabinoidTag([c("thca", 90, "%"), c("cbda", 5, "%")]) === "1:1" || cannabinoidTag([c("thca", 90, "%"), c("cbda", 5, "%")]) !== "", "acid forms considered");

  // buildComplianceName: vendor==brand drop
  const r1 = buildComplianceName({ vendor: "Acme", brand: "Acme", strainOrFlavor: "Blue Dream", type: "Flower" });
  assert(r1.name === "Acme Blue Dream Flower", "vendor==brand dropped: " + r1.name);

  // full: vendor+brand+flavor+ratio+type
  const r2 = buildComplianceName({ vendor: "Hometown", brand: "Wana", strainOrFlavor: "Strawberry Lemonade", type: "Drink", compounds: [c("thc", 100), c("cbd", 100)] });
  assert(r2.name === "Hometown Wana Strawberry Lemonade 1:1 Drink", "full 1:1 drink: " + r2.name);

  // multi-cannabinoid drink
  const r3 = buildComplianceName({ vendor: "Hometown", brand: "Wana", strainOrFlavor: "Strawberry Lemonade", type: "Drink", compounds: [c("thc", 100), c("cbd", 50), c("cbn", 10)] });
  assert(r3.name === "Hometown Wana Strawberry Lemonade THC:CBD:CBN Drink", "multi tag: " + r3.name);

  // CBD flower marker
  const r4 = buildComplianceName({ vendor: "Greenway", strainOrFlavor: "Cherry Wine", type: "Flower", isCbdFlower: true });
  assert(r4.name === "Greenway Cherry Wine CBD Flower", "cbd flower marker: " + r4.name);
  // don't double-mark if strain already says CBD
  const r5 = buildComplianceName({ vendor: "Greenway", strainOrFlavor: "Cherry Wine CBD", type: "Flower", isCbdFlower: true });
  assert(!/CBD CBD/i.test(r5.name), "no double CBD: " + r5.name);

  // truncation at word boundary
  const long = buildComplianceName({ vendor: "Very Long Vendor Name Here", brand: "Another Long Brand Name", strainOrFlavor: "Super Extended Strain Title Goes On", type: "Live Resin Cartridge", size: "1g" });
  assert(long.name.length <= NAME_MAX_LEN, "clamped <=75: " + long.name.length);

  // validateName: catches the real Cultivera defects
  assert(validateName("- 3pk Lemon Cherry Gelato Cart").ok === false, "leading dash rejected");
  assert(validateName("Cannabis Northwest, Shatter").ok === false, "comma rejected");
  assert(validateName("BLUE DREAM FLOWER").ok === false, "all caps rejected");
  assert(validateName("royal blunt wrap horchata").ok === false, "all lower rejected");
  assert(validateName("JAR_XTRA_DRAGON_BALM_CBD_2oz").ok === false, "underscores rejected");
  assert(validateName("Fairwinds Wedding Cake Live Resin Cart").ok === true, "clean name ok");

  // suggestName cleans messy raw
  assert(suggestName("- 3pk Lemon Cherry Gelato Cart") === "3pk Lemon Cherry Gelato Cart", "suggest strips leading dash: " + suggestName("- 3pk Lemon Cherry Gelato Cart"));
  assert(!DISALLOWED_NAME_CHARS.test(suggestName("Cannabis Northwest, Shatter / Lemon")), "suggest strips symbols");
  assert(validateName(suggestName("JAR_XTRA_DRAGON_BALM_CBD_2oz")).ok === true, "suggest yields valid name");

  console.log("naming/convention-core: all tests passed");
}

// Node/tsx entrypoint guard (no-op in the Next bundle).
declare const require: { main?: unknown } | undefined;
// eslint-disable-next-line @next/next/no-assign-module-variable
declare const module: unknown;
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  __runNamingConventionTests();
}
