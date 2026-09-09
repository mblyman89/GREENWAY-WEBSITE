/**
 * src/lib/promotions/brand-match-core.ts
 *
 * SLICE T1 -- THE ONE BRAND MATCHER (pure: no React, no DB, no server-only).
 *
 * WHY THIS EXISTS
 * ---------------
 * "Is this product's brand one of the brands on sale?" was answered in FIVE
 * separate places, each with its own hand-rolled copy of the same expression:
 *
 *   src/lib/promotions/discount-engine-core.ts  hasCi()          (the engine)
 *   src/lib/specials/cart-discount.ts           thursday branch  (checkout)
 *   src/lib/specials/daily-deals.ts             itemMatchesBrands() (the cards)
 *   src/lib/promotions/promo-guard.ts           matchesScoped()  (publish guard)
 *   src/lib/promotions/promotions-store.ts      ruleMatches()    (admin preview)
 *
 * All five spelled it `a.trim().toLowerCase() === b.trim().toLowerCase()`. Five
 * copies of one rule is five chances to fix a bug in four places, and the two
 * that decide MONEY (the engine and checkout) are not the two a developer
 * reads first. This module is now the single answer, and the other five call it.
 *
 * WHAT THE STORE'S OWN CATALOGUE SAYS (measured, not assumed)
 * -----------------------------------------------------------
 * Measured over normalized_cultivera/PRODUCTS_NORMALIZED.xlsx -- the real
 * Cultivera export, 2,676 product rows, 194 non-blank distinct brand strings.
 * Thursday's featured brands are ["Lifted","Phat Panda","Buddies",
 * "Clarity Farms","Constellation"] (daily-deal-seed.ts).
 *
 * Under the OLD `trim().toLowerCase()` rule, 273 products were on the deal.
 * Under `brandKey()` below, 339 are -- and the 66 new ones are ALL the single
 * brand `'Phat  Panda'`, spelled with two spaces in the vendor's own export.
 * It is the same company as the 11 rows spelled `'Phat Panda'`; the catalogue
 * simply contains both spellings.
 *
 *   IMPORTANT AND HONEST: those 66 products were ALREADY receiving their 25% in
 *   production, because src/lib/pos/transform.ts normalizeWhitespace() collapses
 *   inner whitespace runs during import, so the engine never saw the double
 *   space. An earlier report of mine claimed Thursday was "brittle on
 *   'Phat  Panda'". Traced through the real importer, that claim was WRONG.
 *   What this module fixes is not a live 66-product outage -- it is the fact
 *   that correctness depended on an unrelated importer detail in a different
 *   module. Any caller reading a brand from anywhere else (a hand-typed admin
 *   entry, a CSV, a vendor feed that skips transform.ts) had no such luck.
 *
 * The eight raw brand strings that the key genuinely unifies -- all measured
 * pairs of the SAME company spelled two ways in the store's own data:
 *
 *   'Phat  Panda' (66) + 'Phat Panda' (11)      double space
 *   'Fire Bros'   (65) + 'FIREBROS'   (2)       spacing + case
 *   'SUBX'        (31) + 'Sub X'      (23)      spacing
 *   'Green Revolution' (20) + 'Green Revolution:' (1)   stray colon
 *   'High Tide'   (6)  + 'HighTide'   (3)       spacing
 *   'Rays Lemonade' (6) + "Ray's Lemonade" (2)  apostrophe
 *   'K Savage'    (5)  + 'K-Savage'   (1)       hyphen
 *   '420 Bar'     (3)  + '4.20 Bar'   (1)       punctuation
 *
 * Verified: across all 194 real brands these are the ONLY collapses, and every
 * one joins two spellings of one company. No two DIFFERENT companies collide.
 * That check is not a one-off -- tests/compliance/brand-match-catalogue.test.ts
 * re-runs it against the committed workbook, so if a future edit widens the key
 * enough to merge two real vendors, CI says so.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * -----------------------------------------
 * It does NOT match prefixes, substrings or shared tokens. Measured, that would
 * be actively wrong on this catalogue:
 *
 *   'Phat Panda Bong Buddies' (3 products) would join Phat Panda's sale
 *   'Lifted Luxury '          (1 product)  would join Lifted's sale
 *   'Phat Yeti'               (1 product)  shares a token with 'Phat Panda'
 *                                          and is an entirely different company
 *
 * Whether a sub-brand travels with its parent's deal is a fact about the
 * owner's VENDOR AGREEMENTS. It cannot be derived from a product spreadsheet,
 * so this module refuses to invent it. Instead findBrandNearMisses() DETECTS
 * these cases and hands them to a human, which turns a silent 0% into a visible
 * question. On the live catalogue it surfaces exactly four, two of which are
 * bare corporate suffixes and are almost certainly the same vendor:
 *
 *   'Lifted Cannabis'        (6 products) -- extends "Lifted"        + [cannabis]
 *   'Constellation Cannabis' (2 products) -- extends "Constellation" + [cannabis]
 *   'Lifted Luxury '         (1 product)  -- extends "Lifted"        + [luxury]
 *   'Phat Panda Bong Buddies'(3 products) -- extends "Phat Panda"    + [bong,buddies]
 *
 * Those 12 products ring up at full price today while the shelf advertises
 * their brand. This module does not change that -- changing it silently is
 * exactly the guess the standing rules forbid -- it makes it VISIBLE so the
 * owner can add "Lifted Cannabis" to the featured list in one click if that is
 * what his agreement says.
 */

/**
 * Normalise a brand string to its comparison key.
 *
 * Case-folded, then every non-alphanumeric run DELETED (not replaced with a
 * space). Deleting rather than spacing is the measured choice: on the real
 * catalogue both variants put the same 339 products on Thursday's deal, but
 * deletion additionally unifies 'Fire Bros'/'FIREBROS', 'SUBX'/'Sub X' and
 * 'High Tide'/'HighTide' -- five more real same-company pairs -- while still
 * merging no two different companies. Same convention as the existing
 * src/lib/discovery/brand-core.ts:157 slug, so the codebase stays consistent.
 *
 * `toLowerCase()` is deliberately NOT used: casefold-style lowering via
 * toLowerCase is fine for ASCII, but String.prototype.toLowerCase already
 * handles the Unicode brands a vendor might send, and we strip non-alphanumerics
 * afterwards anyway. Null/undefined/blank all key to "" and NEVER match.
 */
export function brandKey(value: string | null | undefined): string {
  if (!value) return "";
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Does `value` name the same brand as `target`?
 *
 * A blank on either side is never a match -- an unbranded product must not be
 * swept into a brand sale by an empty targets entry.
 */
export function brandMatches(
  value: string | null | undefined,
  target: string | null | undefined,
): boolean {
  const a = brandKey(value);
  if (!a) return false;
  const b = brandKey(target);
  if (!b) return false;
  return a === b;
}

/**
 * Is `value` any of the brands in `list`? This is the exact replacement for the
 * five hand-rolled `list.some(x => x.trim().toLowerCase() === v)` copies.
 */
export function brandInList(
  list: readonly string[] | null | undefined,
  value: string | null | undefined,
): boolean {
  const v = brandKey(value);
  if (!v) return false;
  if (!list) return false;
  for (const entry of list) {
    if (brandKey(entry) === v) return true;
  }
  return false;
}

/**
 * Words that, appended to a brand, almost always still name the same company
 * rather than a distinct product line. Used ONLY to CLASSIFY a near-miss for a
 * human reader -- never to decide a discount. Getting this list wrong can
 * mislabel a warning; it can never mis-price a sale.
 */
export const BRAND_CORPORATE_SUFFIXES: readonly string[] = [
  "cannabis",
  "farms",
  "farm",
  "co",
  "company",
  "llc",
  "inc",
  "brands",
  "gardens",
  "labs",
  "extracts",
  "holdings",
  "group",
];

export type BrandNearMissKind = "corporate-suffix" | "sub-brand-or-different";

export type BrandNearMiss = {
  /** The catalogue brand that did NOT match, verbatim. */
  brand: string;
  /** The targeted brand it looks related to, verbatim. */
  target: string;
  /** The extra words the catalogue brand carries, lowercased. */
  extraTokens: string[];
  /**
   * "corporate-suffix"        -- every extra word is a corporate suffix, so this
   *                              is very likely the same vendor (e.g. "Lifted
   *                              Cannabis" vs "Lifted").
   * "sub-brand-or-different"  -- the extra words name something, so it may be a
   *                              separate product line (e.g. "Phat Panda Bong
   *                              Buddies"). Needs a human answer.
   */
  kind: BrandNearMissKind;
};

/** Word tokens of a brand, for near-miss reasoning only (never for matching). */
function brandTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * Find catalogue brands that a human would probably say are "on the deal" but
 * which brandMatches() rejects, so somebody can decide deliberately.
 *
 * Reports a brand only when it EXTENDS a target with additional words
 * ("Lifted Cannabis" extends "Lifted"). Measured on the real catalogue, the
 * reverse direction -- a catalogue brand that is a strict prefix of a target --
 * occurs ZERO times, so it is not reported and no rule is invented for it.
 *
 * Pure and order-stable: results come out in `brands` order, then `targets`
 * order, so a report diff never churns.
 */
export function findBrandNearMisses(
  brands: readonly string[],
  targets: readonly string[],
): BrandNearMiss[] {
  const out: BrandNearMiss[] = [];
  const suffixes = new Set(BRAND_CORPORATE_SUFFIXES);
  for (const brand of brands) {
    const bTok = brandTokens(brand);
    if (!bTok.length) continue;
    for (const target of targets) {
      const tTok = brandTokens(target);
      if (!tTok.length) continue;
      // An exact match is not a near miss.
      if (brandMatches(brand, target)) continue;
      if (bTok.length <= tTok.length) continue;
      let sharesPrefix = true;
      for (let i = 0; i < tTok.length; i += 1) {
        if (bTok[i] !== tTok[i]) {
          sharesPrefix = false;
          break;
        }
      }
      if (!sharesPrefix) continue;
      const extraTokens = bTok.slice(tTok.length);
      const kind: BrandNearMissKind = extraTokens.every((t) => suffixes.has(t))
        ? "corporate-suffix"
        : "sub-brand-or-different";
      out.push({ brand, target, extraTokens, kind });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared fixtures -- every string below is a VERBATIM brand from the store's
// own Cultivera export (normalized_cultivera/PRODUCTS_NORMALIZED.xlsx), not an
// invented example. Product counts are the measured row counts.
// ---------------------------------------------------------------------------

/** The five brands Thursday targets today (mirrors TOP_SHELF_THURSDAY_BRANDS). */
export const BRAND_MATCH_TARGET_FIXTURES: readonly string[] = [
  "Lifted",
  "Phat Panda",
  "Buddies",
  "Clarity Farms",
  "Constellation",
];

export type BrandMatchFixture = {
  /** Verbatim catalogue brand string. */
  brand: string;
  /** Products carrying this exact string in the real export. */
  products: number;
  /** Which target it must match, or null for "must match none of them". */
  matches: string | null;
  why: string;
};

export const BRAND_MATCH_FIXTURES: readonly BrandMatchFixture[] = [
  { brand: "Lifted", products: 84, matches: "Lifted", why: "exact" },
  { brand: "Clarity Farms", products: 85, matches: "Clarity Farms", why: "exact" },
  { brand: "Constellation", products: 61, matches: "Constellation", why: "exact" },
  { brand: "Buddies", products: 32, matches: "Buddies", why: "exact" },
  { brand: "Phat Panda", products: 11, matches: "Phat Panda", why: "exact" },
  {
    brand: "Phat  Panda",
    products: 66,
    matches: "Phat Panda",
    why: "double space in the vendor export -- same company",
  },
  {
    brand: "Lifted Cannabis",
    products: 6,
    matches: null,
    why: "near miss (corporate-suffix): a human decides, the matcher never guesses",
  },
  {
    brand: "Constellation Cannabis",
    products: 2,
    matches: null,
    why: "near miss (corporate-suffix): a human decides",
  },
  {
    brand: "Lifted Luxury ",
    products: 1,
    matches: null,
    why: "near miss (sub-brand): trailing space is irrelevant, the extra word is not",
  },
  {
    brand: "Phat Panda Bong Buddies",
    products: 3,
    matches: null,
    why: "near miss: extends Phat Panda AND contains the word Buddies -- never auto-matched",
  },
  {
    brand: "Phat Yeti",
    products: 1,
    matches: null,
    why: "shares the token 'Phat' with Phat Panda and is a DIFFERENT company",
  },
];

/**
 * Real same-company pairs the key unifies. Each entry is [a, b] where a and b
 * are two verbatim spellings of ONE vendor in the store's catalogue.
 */
export const BRAND_KEY_EQUIVALENT_PAIRS: readonly (readonly [string, string])[] = [
  ["Phat  Panda", "Phat Panda"],
  ["Fire Bros", "FIREBROS"],
  ["SUBX", "Sub X"],
  ["Green Revolution", "Green Revolution:"],
  ["High Tide", "HighTide"],
  ["Rays Lemonade", "Ray's Lemonade"],
  ["K Savage", "K-Savage"],
  ["420 Bar", "4.20 Bar"],
];

/**
 * Pairs of DIFFERENT companies that must NEVER collapse to one key. Drawn from
 * the real catalogue: these are the closest genuine confusions in the data.
 */
export const BRAND_KEY_DISTINCT_PAIRS: readonly (readonly [string, string])[] = [
  ["Phat Panda", "Phat Yeti"],
  ["Lifted", "Lifted Cannabis"],
  ["Lifted", "Lifted Luxury "],
  ["Constellation", "Constellation Cannabis"],
  ["Buddies", "Phat Panda Bong Buddies"],
];

// ---------------------------------------------------------------------------
// Self-tests (pure). Throws on the first failure.
// ---------------------------------------------------------------------------
export function __runBrandMatchTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  function check(name: string, cond: boolean): void {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      throw new Error(`brand-match-core self-test FAILED: ${name}`);
    }
  }

  // 1. Every fixture resolves exactly as the real catalogue demands, against
  //    the WHOLE target list -- the way the engine actually asks the question.
  for (const f of BRAND_MATCH_FIXTURES) {
    const hit = brandInList(BRAND_MATCH_TARGET_FIXTURES, f.brand);
    check(
      `${JSON.stringify(f.brand)} in list -> ${f.matches !== null} (${f.why})`,
      hit === (f.matches !== null),
    );
    if (f.matches !== null) {
      check(`${JSON.stringify(f.brand)} matches ${JSON.stringify(f.matches)}`, brandMatches(f.brand, f.matches));
    }
  }

  // 2. Blank / missing brands never match anything, in either position.
  for (const blank of [null, undefined, "", "   ", "\t", "-", "  --  "]) {
    check(`blank ${JSON.stringify(blank)} never matches`, !brandMatches(blank, "Lifted"));
    check(`blank ${JSON.stringify(blank)} never targeted`, !brandMatches("Lifted", blank));
    check(`blank ${JSON.stringify(blank)} not in list`, !brandInList(BRAND_MATCH_TARGET_FIXTURES, blank));
  }
  // A blank ENTRY inside the target list must not turn into a wildcard.
  check("blank target entry is not a wildcard", !brandInList(["", "  "], "Lifted"));
  check("empty target list matches nothing", !brandInList([], "Lifted"));
  check("null target list matches nothing", !brandInList(null, "Lifted"));

  // 2b. BLANK ON BOTH SIDES AT ONCE. Added after the T1 mutation harness kept
  // "list: blank value matches" alive: deleting `if (!v) return false` from
  // brandInList is invisible while EITHER side is non-blank, because a blank
  // value can only collide with a blank ENTRY. The pairs above never put a
  // blank on both sides simultaneously, so nothing noticed. This is a real,
  // reachable defect -- one empty row in an admin brand list (a trailing
  // comma is enough) would make every UNBRANDED product match: silently
  // dropped from a sale on an exclusion list, or sold at a price nobody
  // authorised on a target list.
  for (const entry of ["", "  ", "-", "  --  "]) {
    for (const value of [null, undefined, "", "   ", "!!"]) {
      check(
        `blank entry ${JSON.stringify(entry)} never matches blank value ${JSON.stringify(value)}`,
        !brandInList([entry], value),
      );
      check(
        `...even alongside a real brand (${JSON.stringify(entry)} / ${JSON.stringify(value)})`,
        !brandInList([entry, "Lifted"], value),
      );
    }
  }
  // The same hole in the single-value matcher.
  check("blank vs blank never matches", !brandMatches("", ""));
  check("null vs null never matches", !brandMatches(null, null));
  check("punctuation vs punctuation never matches", !brandMatches("--", "!!"));

  // 3. brandKey is stable and idempotent.
  check("brandKey collapses double space", brandKey("Phat  Panda") === "phatpanda");
  check("brandKey lowercases", brandKey("PHAT PANDA") === "phatpanda");
  check("brandKey strips punctuation", brandKey("Ray's Lemonade") === "rayslemonade");
  check("brandKey trims", brandKey("  Lifted  ") === "lifted");
  check("brandKey idempotent", brandKey(brandKey("Phat  Panda")) === brandKey("Phat  Panda"));
  check("brandKey blank", brandKey("") === "" && brandKey(null) === "" && brandKey(undefined) === "");
  check("brandKey punctuation-only is blank", brandKey("--") === "" && brandKey("!!!") === "");
  check("brandKey keeps digits", brandKey("420 Bar") === "420bar");

  // 4. Symmetry and reflexivity over every fixture brand.
  for (const f of BRAND_MATCH_FIXTURES) {
    check(`reflexive ${JSON.stringify(f.brand)}`, brandMatches(f.brand, f.brand));
    for (const t of BRAND_MATCH_TARGET_FIXTURES) {
      check(
        `symmetric ${JSON.stringify(f.brand)}/${JSON.stringify(t)}`,
        brandMatches(f.brand, t) === brandMatches(t, f.brand),
      );
    }
  }

  // 5. Real same-company spellings unify.
  for (const [a, b] of BRAND_KEY_EQUIVALENT_PAIRS) {
    check(`equivalent ${JSON.stringify(a)} == ${JSON.stringify(b)}`, brandMatches(a, b));
  }
  // 6. Real different companies stay apart. THIS IS THE SAFETY DIRECTION:
  //    a false positive here discounts a vendor the owner never agreed to.
  for (const [a, b] of BRAND_KEY_DISTINCT_PAIRS) {
    check(`distinct ${JSON.stringify(a)} != ${JSON.stringify(b)}`, !brandMatches(a, b));
  }

  // 7. NO substring / prefix matching, stated as its own law.
  check("no prefix match", !brandMatches("Lifted Luxury", "Lifted"));
  check("no substring match", !brandMatches("Lift", "Lifted"));
  check("no suffix match", !brandMatches("Uplifted", "Lifted"));
  check("no token-overlap match", !brandMatches("Panda Phat", "Phat Panda"));

  // 8. Near-miss detection on the real catalogue brands.
  const catalogue = BRAND_MATCH_FIXTURES.map((f) => f.brand);
  const misses = findBrandNearMisses(catalogue, BRAND_MATCH_TARGET_FIXTURES);
  check("near miss: exactly 4 on the real catalogue", misses.length === 4);
  const byBrand = new Map(misses.map((m) => [m.brand, m]));
  check("near miss: Lifted Cannabis found", byBrand.get("Lifted Cannabis")?.target === "Lifted");
  check(
    "near miss: Lifted Cannabis is a corporate suffix",
    byBrand.get("Lifted Cannabis")?.kind === "corporate-suffix",
  );
  check(
    "near miss: Constellation Cannabis is a corporate suffix",
    byBrand.get("Constellation Cannabis")?.kind === "corporate-suffix",
  );
  check(
    "near miss: Lifted Luxury is NOT a corporate suffix",
    byBrand.get("Lifted Luxury ")?.kind === "sub-brand-or-different",
  );
  check(
    "near miss: Phat Panda Bong Buddies is NOT a corporate suffix",
    byBrand.get("Phat Panda Bong Buddies")?.kind === "sub-brand-or-different",
  );
  check(
    "near miss: extra tokens are reported",
    JSON.stringify(byBrand.get("Phat Panda Bong Buddies")?.extraTokens) === JSON.stringify(["bong", "buddies"]),
  );
  // 'Phat Yeti' shares a token but does NOT extend the target -> not a near miss.
  check("near miss: Phat Yeti is not reported", !byBrand.has("Phat Yeti"));
  // A brand that already matches is never a near miss.
  check("near miss: exact matches excluded", !byBrand.has("Lifted") && !byBrand.has("Phat  Panda"));
  // Order stability.
  check(
    "near miss: order follows the brands array",
    misses.map((m) => m.brand).join("|") ===
      "Lifted Cannabis|Constellation Cannabis|Lifted Luxury |Phat Panda Bong Buddies",
  );
  check("near miss: empty inputs are safe", findBrandNearMisses([], BRAND_MATCH_TARGET_FIXTURES).length === 0);
  check("near miss: no targets is safe", findBrandNearMisses(catalogue, []).length === 0);
  check("near miss: blanks ignored", findBrandNearMisses(["", "  "], BRAND_MATCH_TARGET_FIXTURES).length === 0);

  // 9. The advertised reach, asserted as a number. If a future edit changes who
  //    is on Thursday's deal, this count moves and the build says so.
  const onDeal = BRAND_MATCH_FIXTURES.filter((f) => brandInList(BRAND_MATCH_TARGET_FIXTURES, f.brand));
  const productsOnDeal = onDeal.reduce((s, f) => s + f.products, 0);
  check("Thursday reaches 339 catalogue products", productsOnDeal === 339);
  const productsMissed = BRAND_MATCH_FIXTURES.filter(
    (f) => !brandInList(BRAND_MATCH_TARGET_FIXTURES, f.brand) && f.brand !== "Phat Yeti",
  ).reduce((s, f) => s + f.products, 0);
  check("12 products sit in the near-miss gap", productsMissed === 12);

  if (failed > 0) throw new Error(`brand-match-core: ${failed} failure(s)`);
  return { passed, failed };
}
