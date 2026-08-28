/**
 * src/lib/accounting/receipt-category-core.ts   (books-81)
 *
 * PURE. One import (the chart of accounts vocabulary). No I/O.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `buildReceiptJournal` takes a `categorySlug` from the accounting vocabulary.
 * The database stores something else entirely: `inventory_lots.category` is
 * FREE TEXT (added by migration 0024 as `text`, backfilled in 0035 from
 * "any distinct POS strings already in the data"). Nothing in the repository
 * translated one into the other, so the receipt builder could not be wired to
 * a real lot. This module is that translation, and it REFUSES rather than
 * guesses.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A NEW MAPPER, WHEN `pos/transform.ts` ALREADY MAPS CATEGORIES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * That was the first thing checked, because a second mapper is a liability if
 * an existing one will do. It will not, for two independent reasons, both
 * measured against the real file:
 *
 * 1. IT GUESSES. `categoryWithFallback()` ends with `return "concentrate"` for
 *    any string it does not recognise, after a substring sweep. For a menu
 *    label that is a reasonable default — a shopper sees a slightly wrong tab.
 *    For the books it is money in the wrong account: every one of the 21
 *    categories carries a DISTINCT slot, so 21 distinct inventory accounts
 *    (20010..20220). Worse, `accessories`, `paraphernalia` and `merch` are the
 *    only three with `isCannabis: false`. A silent fallback can therefore move
 *    a non-cannabis purchase into a cannabis account and flip its §280E
 *    consequence — a tax error that balances perfectly and audits badly.
 *
 * 2. IT COLLAPSES DISTINCTIONS THE LEDGER PAYS FOR. Measured in
 *    `CATEGORY_MAP`: "RSO" → concentrate, "Tincture" → edible-liquid,
 *    "Blunt" → preroll, "Infused Blunt" → infused-preroll. The chart of
 *    accounts has SEPARATE accounts for rso (20150), tincture (20180), blunt
 *    (20070) and infused-blunt (20100). Reusing that map would post to an
 *    account the owner did not intend and quietly make four of his twenty-one
 *    inventory lines permanently unusable.
 *
 * The POS map is not wrong; it is answering a different question ("which menu
 * tab?"). This module answers "which ledger account?", and the two questions
 * have different right answers. Standing rule 1: never guess.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DESIGN RULE: NO DEFAULT BRANCH EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `mapReceiptCategory` has no `?? "concentrate"` and no final fallback. An
 * unrecognised string returns a refusal that NAMES the string, so intake can
 * show the owner exactly what to add. This is the same shape as books-80's
 * factory reset: where guessing either way causes a different real-world
 * injury, the function must refuse and hand the decision to a human
 * (standing rule 48 — a check that cannot classify must FAIL, not skip).
 *
 * A null/blank category is treated differently from an unrecognised one, and
 * deliberately so. Blank means intake never captured it — an honest unknown,
 * which routes to quarantine 20890 downstream via a null slug. A non-empty
 * string nobody recognises means somebody typed something new, which is a
 * different problem with a different fix, so it gets its own refusal code.
 * Collapsing the two would hide new vendor vocabulary inside quarantine.
 */

import { INVENTORY_CATEGORIES } from "./coa-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) THE OUTCOME
 * ═══════════════════════════════════════════════════════════════════════════ */

export const CATEGORY_REFUSAL_CODES = ["UNRECOGNISED_CATEGORY"] as const;
export type CategoryRefusalCode = (typeof CATEGORY_REFUSAL_CODES)[number];

export type CategoryMapping =
  | {
      readonly kind: "mapped";
      /** A slug guaranteed to exist in INVENTORY_CATEGORIES. */
      readonly slug: string;
      /** The raw text this came from, normalised. For the audit trail. */
      readonly matchedOn: string;
    }
  | {
      readonly kind: "unknown";
      /**
       * Intake never captured a category. Downstream this becomes a null slug
       * and the cost lands in quarantine 20890 — a to-do list, not a balance.
       */
      readonly reason: string;
    }
  | {
      readonly kind: "refused";
      readonly code: CategoryRefusalCode;
      /** The offending text, verbatim, so the message can name it. */
      readonly rawCategory: string;
      readonly explanation: string;
      readonly resolution: string;
    };

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) THE TABLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Keys are normalised (lowercased, punctuation and whitespace folded) so
 * "Pre-Roll", "pre roll" and "PREROLL" are one entry rather than three.
 *
 * Every VALUE is asserted against the real chart of accounts by the self-tests
 * below, so a typo here is a failing build rather than a wrong account.
 *
 * The vocabulary is drawn from the strings actually present in the codebase:
 * `pos/transform.ts#CATEGORY_MAP` (the real POS category names) and the
 * `inventory_types` seed in migration 0035. Where the POS map collapses two
 * ledger accounts into one, THIS table keeps them apart — see "RSO" and
 * "Tincture" and "Blunt" below, each of which is the whole reason this file
 * exists.
 */

/** Fold a raw category into a lookup key. Exported for the self-tests. */
export function normaliseCategoryKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const CATEGORY_TABLE: Readonly<Record<string, string>> = {
  // ── flower family ──────────────────────────────────────────────────────
  flower: "flower",
  "popcorn bud": "popcorn-bud",
  popcorn: "popcorn-bud",
  "smalls": "popcorn-bud",
  "infused flower": "infused-flower",
  "mix infused flower": "infused-flower",
  "moon rocks": "infused-flower",
  trim: "trim",
  shake: "trim",
  "mix flower": "trim",

  // ── preroll family ─────────────────────────────────────────────────────
  // The ledger separates preroll / preroll-pack / blunt and their infused
  // counterparts into six accounts. The POS map folds blunts into prerolls;
  // this one does not.
  preroll: "preroll",
  "pre roll": "preroll",
  "preroll pack": "preroll-pack",
  "pre roll pack": "preroll-pack",
  "preroll multi pack": "preroll-pack",
  blunt: "blunt",
  "infused preroll": "infused-preroll",
  "infused pre roll": "infused-preroll",
  "infused preroll pack": "infused-preroll-pack",
  "infused pre roll pack": "infused-preroll-pack",
  "infused blunt": "infused-blunt",

  // ── vape ───────────────────────────────────────────────────────────────
  cartridge: "cartridge",
  cart: "cartridge",
  "live resin cartridge": "cartridge",
  pod: "cartridge",
  "disposable cartridge": "disposable-cartridge",
  disposable: "disposable-cartridge",

  // ── concentrate ────────────────────────────────────────────────────────
  concentrate: "concentrate",
  rosin: "concentrate",
  "hash rosin": "concentrate",
  "live resin": "concentrate",
  "loud resin": "concentrate",
  bho: "concentrate",
  badder: "concentrate",
  batter: "concentrate",
  budder: "concentrate",
  "bubble hash": "concentrate",
  hash: "concentrate",
  shatter: "concentrate",
  sugar: "concentrate",
  distillate: "concentrate",
  crumble: "concentrate",
  diamonds: "concentrate",
  "terp crystals": "concentrate",
  "terp sauce": "concentrate",
  sauce: "concentrate",
  thca: "concentrate",
  wax: "concentrate",
  kief: "concentrate",

  // RSO has its OWN account (20150). The POS map sends it to concentrate.
  rso: "rso",
  "rick simpson oil": "rso",
  feco: "rso",

  // ── edibles ────────────────────────────────────────────────────────────
  "edible solid": "edible-solid",
  edible: "edible-solid",
  edibles: "edible-solid",
  gummies: "edible-solid",
  gummy: "edible-solid",
  chocolate: "edible-solid",
  "fruit chews": "edible-solid",
  chewees: "edible-solid",
  chews: "edible-solid",
  mints: "edible-solid",
  capsule: "edible-solid",
  capsules: "edible-solid",
  balls: "edible-solid",
  bites: "edible-solid",
  "hard candy": "edible-solid",
  marmas: "edible-solid",
  minis: "edible-solid",
  "panda candies": "edible-solid",
  "peanut butter cups": "edible-solid",
  cookies: "edible-solid",
  brownie: "edible-solid",
  caramels: "edible-solid",
  taffy: "edible-solid",

  "edible liquid": "edible-liquid",
  beverage: "edible-liquid",
  beverages: "edible-liquid",
  drink: "edible-liquid",
  shots: "edible-liquid",
  soda: "edible-liquid",
  seltzer: "edible-liquid",
  "liquid infused edible": "edible-liquid",
  "other liquid edible": "edible-liquid",
  syrup: "edible-liquid",

  // Tincture has its OWN account (20180). The POS map sends it to
  // edible-liquid, which would make account 20180 permanently unreachable.
  tincture: "tincture",
  tinctures: "tincture",

  // ── topical ────────────────────────────────────────────────────────────
  topical: "topical",
  topicals: "topical",
  "bath salts": "topical",
  "roll on": "topical",
  balm: "topical",
  lotion: "topical",
  salve: "topical",
  transdermal: "topical",
  patch: "topical",

  // ── the three NON-CANNABIS accounts (isCannabis: false) ────────────────
  // These are the §280E-exempt lines. Getting one of these wrong does not
  // merely misfile the cost, it changes the tax owed, which is why the
  // fallback this module refuses to have would have been so expensive.
  accessories: "accessories",
  accessory: "accessories",
  battery: "accessories",
  batteries: "accessories",
  lighter: "accessories",
  grinder: "accessories",
  paraphernalia: "paraphernalia",
  pipe: "paraphernalia",
  "glass": "paraphernalia",
  bong: "paraphernalia",
  "rolling papers": "paraphernalia",
  papers: "paraphernalia",
  merch: "merch",
  merchandise: "merch",
  apparel: "merch",
  "t shirt": "merch",
  hat: "merch",
  sticker: "merch",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) THE MAPPER
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Translate a raw `inventory_lots.category` into an accounting slug.
 *
 * Three outcomes, never a guess:
 *   - mapped   → a slug that exists in the chart of accounts
 *   - unknown  → nothing was captured; caller sends a null slug to quarantine
 *   - refused  → somebody typed something new; a human decides where it goes
 */
export function mapReceiptCategory(raw: string | null | undefined): CategoryMapping {
  if (raw === null || raw === undefined || raw.trim().length === 0) {
    return {
      kind: "unknown",
      reason:
        "This lot has no product category recorded, so its cost cannot be filed " +
        "against a product line. It goes to quarantine until somebody says what it is.",
    };
  }

  const key = normaliseCategoryKey(raw);
  if (key.length === 0) {
    // e.g. "---" or "///" — punctuation only. Nothing was really captured.
    return {
      kind: "unknown",
      reason:
        `The category "${raw}" contains no letters or digits, so nothing was ` +
        "actually recorded. It goes to quarantine until somebody says what it is.",
    };
  }

  const slug = CATEGORY_TABLE[key];
  if (slug !== undefined) {
    return { kind: "mapped", slug, matchedOn: key };
  }

  return {
    kind: "refused",
    code: "UNRECOGNISED_CATEGORY",
    rawCategory: raw,
    explanation:
      `"${raw}" is not a product category the books recognise. Nothing was ` +
      "posted, because each category has its own inventory account and three " +
      "of them are non-cannabis — putting this in the wrong one would change " +
      "the tax you owe, not just the label.",
    resolution:
      `Add "${raw}" to the category table in receipt-category-core.ts, mapped ` +
      "to whichever of the 21 product lines it belongs to, then receive the " +
      "delivery again. Nothing is lost by waiting.",
  };
}

/** Every slug this table can produce. Used by the self-tests and the census. */
export function mappableSlugs(): readonly string[] {
  return Array.from(new Set(Object.values(CATEGORY_TABLE))).sort();
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4) SELF-TESTS
 * ═══════════════════════════════════════════════════════════════════════════ */

function expect(label: string, cond: boolean): void {
  if (!cond) throw new Error(`receipt-category-core self-test FAILED: ${label}`);
}

export function __runReceiptCategoryCoreTests(): void {
  const known = new Set(INVENTORY_CATEGORIES.map((c) => c.slug));

  // Every value in the table is a REAL account slug. A typo here would post
  // money to an account that does not exist.
  for (const [key, slug] of Object.entries(CATEGORY_TABLE)) {
    expect(`"${key}" maps to a real chart-of-accounts slug (got "${slug}")`, known.has(slug));
    // Keys must already be normalised, or they can never be matched.
    expect(`table key "${key}" is stored in normalised form`, normaliseCategoryKey(key) === key);
  }

  // The four distinctions that justify this module existing at all. If any of
  // these regress to the POS map's answer, an inventory account goes dark.
  const mustSeparate: ReadonlyArray<readonly [string, string]> = [
    ["RSO", "rso"],
    ["Tincture", "tincture"],
    ["Blunt", "blunt"],
    ["Infused Blunt", "infused-blunt"],
  ];
  for (const [raw, want] of mustSeparate) {
    const m = mapReceiptCategory(raw);
    expect(`"${raw}" maps to its own account, not the POS map's answer`, m.kind === "mapped" && m.slug === want);
  }

  // The non-cannabis three must be reachable, because they are the §280E
  // exemption and an unreachable one silently taxes exempt purchases.
  for (const [raw, want] of [["Accessories", "accessories"], ["Paraphernalia", "paraphernalia"], ["Merch", "merch"]] as const) {
    const m = mapReceiptCategory(raw);
    expect(`${raw} reaches the non-cannabis account`, m.kind === "mapped" && m.slug === want);
  }

  // Normalisation really folds spelling variants together.
  for (const v of ["Pre-Roll", "pre roll", "PREROLL", "  Preroll  "]) {
    const m = mapReceiptCategory(v);
    expect(`"${v}" folds to preroll`, m.kind === "mapped" && m.slug === "preroll");
  }

  // THE CENTRAL GUARANTEE: an unrecognised string REFUSES. It does not become
  // concentrate, and it does not become quarantine.
  const bogus = mapReceiptCategory("Sparkling Unicorn Extract");
  expect("an unrecognised category refuses", bogus.kind === "refused");
  expect(
    "the refusal names the offending text so intake can act on it",
    bogus.kind === "refused" && bogus.rawCategory === "Sparkling Unicorn Extract",
  );
  expect(
    "the refusal is not silently 'concentrate' (the POS map's fallback)",
    bogus.kind !== "mapped",
  );

  // Blank is an HONEST unknown and must NOT be confused with a refusal.
  for (const v of [null, undefined, "", "   "]) {
    expect(`blank (${JSON.stringify(v)}) is unknown, not refused`, mapReceiptCategory(v).kind === "unknown");
  }
  expect("punctuation-only is unknown, not refused", mapReceiptCategory("---").kind === "unknown");

  // A mapped result must never carry a slug outside the chart of accounts.
  for (const s of mappableSlugs()) {
    expect(`mappable slug "${s}" is real`, known.has(s));
  }
}
