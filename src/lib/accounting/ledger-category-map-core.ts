/**
 * ledger-category-map-core.ts -- the LEDGER's own Cultivera-category to
 * inventory-account map.
 *
 * WHY THIS FILE EXISTS. `src/lib/pos/transform.ts#CATEGORY_MAP` was written for
 * the STOREFRONT MENU, where grouping blunts with prerolls is good
 * merchandising. D-50 measured four categories where the menu map routes to a
 * LESS SPECIFIC account than Michael's chart already provides. Michael decided
 * the question, verbatim:
 *
 *   "the ledger should use its own accounts and not the website map."
 *
 * So the ledger owns this map. It does NOT import the website map, and a test
 * asserts the two are allowed to diverge in exactly the four measured places
 * and nowhere else -- so a future edit to either one cannot quietly drift.
 *
 * PURITY CONTRACT: zero imports, no I/O, no clock, no randomness. Every value
 * in and out is a plain integer, string, or literal. This file is a leaf.
 *
 * MEASUREMENT PROVENANCE. The category names below are not remembered, they are
 * the distinct `Category` values measured out of Michael's real Cultivera export
 * `INVENTORIES.xlsx` (3,917 rows). That measurement returned **52** distinct
 * categories. This map holds **53** keys, and the extra one is stated rather
 * than hidden: `Trim` carries **zero rows** in this export but is a real house
 * category (`20040`) that the website map also carries, so it is mapped in
 * advance instead of becoming a CATEGORY_UNKNOWN refusal the first time Michael
 * receives trim. `MEASURED_CATEGORY_COUNT` and `UNSTOCKED_MAPPED_CATEGORIES`
 * below record this, and the self-test pins both numbers.
 *
 * THE RULE THAT MUST HOLD, AND IS ENFORCED HERE RATHER THAN COMMENTED.
 * `Category` wins over `InventoryType`. `Infused Pre-roll` carries
 * `InventoryType = Concentrate for Inhalation` on 532 of its 617 rows. An
 * infused pre-roll is not a concentrate. Keying on `InventoryType` would post
 * $19,547.49 to 20140 instead of 20080 and every report would still balance --
 * which is exactly why this is enforced by a refusal code and not a warning.
 */

/* ------------------------------------------------------------------ *
 * Account numbering. Duplicated deliberately, then drift-tested.
 * ------------------------------------------------------------------ */

/**
 * Inventory accounts live in block 2. A slot becomes the four digits after the
 * block digit, zero-padded: slot 140 in block 2 is "2" + "0140" = "20140".
 *
 * These 21 slots are asserted equal to `coa-core.INVENTORY_CATEGORIES` and to
 * `cutover-inventory-core.CUTOVER_CATEGORY_SLOTS` by the second gate. They are
 * restated rather than imported ONLY to keep this file a zero-import leaf; the
 * drift test is what makes that safe.
 */
export const LEDGER_CATEGORY_SLOTS: readonly { slug: string; slot: number }[] = [
  { slug: "flower", slot: 10 },
  { slug: "popcorn-bud", slot: 20 },
  { slug: "infused-flower", slot: 30 },
  { slug: "trim", slot: 40 },
  { slug: "preroll", slot: 50 },
  { slug: "preroll-pack", slot: 60 },
  { slug: "blunt", slot: 70 },
  { slug: "infused-preroll", slot: 80 },
  { slug: "infused-preroll-pack", slot: 90 },
  { slug: "infused-blunt", slot: 100 },
  { slug: "cartridge", slot: 120 },
  { slug: "disposable-cartridge", slot: 130 },
  { slug: "concentrate", slot: 140 },
  { slug: "rso", slot: 150 },
  { slug: "edible-solid", slot: 160 },
  { slug: "edible-liquid", slot: 170 },
  { slug: "tincture", slot: 180 },
  { slug: "topical", slot: 190 },
  { slug: "accessories", slot: 200 },
  { slug: "paraphernalia", slot: 210 },
  { slug: "merch", slot: 220 },
] as const;

const pad4 = (n: number): string => {
  let s = String(n);
  while (s.length < 4) s = "0" + s;
  return s;
};

/** The 5-digit inventory account for a house slug, or null if the slug is unknown. */
export function ledgerAccountForSlug(slug: string | null): string | null {
  if (slug === null) return null;
  for (const row of LEDGER_CATEGORY_SLOTS) {
    if (row.slug === slug) return "2" + pad4(row.slot);
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The map itself: 52 measured Cultivera categories.
 * ------------------------------------------------------------------ */

/**
 * Cultivera `Category` -> Greenway house slug, FOR THE BOOKS.
 *
 * Keys are the exact strings measured in the export. Four entries differ from
 * the website menu map on purpose; see LEDGER_ONLY_OVERRIDES below.
 */
/** Distinct `Category` values measured in INVENTORIES.xlsx (3,917 rows). */
export const MEASURED_CATEGORY_COUNT = 52;

/**
 * Categories this map covers that had ZERO rows in the measured export. Mapped
 * deliberately so their first appearance posts instead of refusing. Anything
 * added here must be a real chart category, and the self-test proves it has an
 * account.
 */
export const UNSTOCKED_MAPPED_CATEGORIES: readonly string[] = ["Trim"] as const;

export const LEDGER_CATEGORY_MAP: Readonly<Record<string, string>> = {
  // ---- flower family
  "Flower": "flower",
  "Popcorn Bud": "popcorn-bud",
  "Moon Rocks": "infused-flower",
  "Mix Infused Flower": "infused-flower",
  "Trim": "trim",

  // ---- preroll family. Blunt is its OWN account in the books (override 4).
  "Pre-roll": "preroll",
  "Blunt": "blunt",
  "Infused Pre-roll": "infused-preroll",
  "Infused Blunt": "infused-blunt",

  // ---- vape hardware
  "Cartridge": "cartridge",
  "Live Resin Cartridge": "cartridge",
  "Pod": "cartridge",
  "Disposable Cartridge": "disposable-cartridge",

  // ---- concentrates. RSO is its OWN account in the books (override 1).
  "Rosin": "concentrate",
  "Hash Rosin": "concentrate",
  "Live Resin": "concentrate",
  "Loud Resin": "concentrate",
  "BHO": "concentrate",
  "Badder": "concentrate",
  "Bubble Hash": "concentrate",
  "Hash": "concentrate",
  "Shatter": "concentrate",
  "Sugar": "concentrate",
  "Crumble": "concentrate",
  "Diamonds": "concentrate",
  "Distillate": "concentrate",
  "Terp Crystals": "concentrate",
  "Terp Sauce": "concentrate",
  "THCa": "concentrate",
  "RSO": "rso",

  // ---- solid edibles
  "Edible": "edible-solid",
  "Gummies": "edible-solid",
  "Chocolate": "edible-solid",
  "Fruit Chews": "edible-solid",
  "Chewees": "edible-solid",
  "Mints": "edible-solid",
  "Capsule": "edible-solid",
  "Balls": "edible-solid",
  "Bites": "edible-solid",
  "Hard Candy": "edible-solid",
  "Marmas": "edible-solid",
  "Minis": "edible-solid",
  "Panda Candies": "edible-solid",
  "Peanut Butter Cups": "edible-solid",

  // ---- liquid edibles. Tincture is its OWN account in the books (override 2).
  "Beverage": "edible-liquid",
  "Shots": "edible-liquid",
  "Soda": "edible-liquid",
  "Liquid Infused Edible": "edible-liquid",
  "Other Liquid Edible": "edible-liquid",
  "Tincture": "tincture",

  // ---- topicals
  "Topical": "topical",
  "Bath Salts": "topical",
  "Roll On": "topical",
};

/**
 * The four places the ledger map INTENTIONALLY diverges from the website menu
 * map, with the value measured in D-50. The second gate asserts that the set of
 * actual divergences equals this list exactly -- no more, no fewer -- so
 * neither map can drift without a test failing and naming it.
 */
export const LEDGER_ONLY_OVERRIDES: readonly {
  category: string;
  websiteSlug: string;
  ledgerSlug: string;
  rows: number;
  valueCents: number;
}[] = [
  { category: "RSO", websiteSlug: "concentrate", ledgerSlug: "rso", rows: 47, valueCents: 268069 },
  { category: "Tincture", websiteSlug: "edible-liquid", ledgerSlug: "tincture", rows: 32, valueCents: 248478 },
  { category: "Infused Blunt", websiteSlug: "infused-preroll", ledgerSlug: "infused-blunt", rows: 44, valueCents: 95178 },
  { category: "Blunt", websiteSlug: "preroll", ledgerSlug: "blunt", rows: 24, valueCents: 78282 },
] as const;

/* ------------------------------------------------------------------ *
 * Resolution, with refusals that a caller can actually reach.
 * ------------------------------------------------------------------ */

export type LedgerCategoryRefusalCode =
  /** The category cell was absent, empty, or only whitespace. */
  | "CATEGORY_MISSING"
  /** A real category string this map has never seen. Named, never absorbed. */
  | "CATEGORY_UNKNOWN"
  /** Case-folding matched two entries that disagree on the target slug. */
  | "CATEGORY_AMBIGUOUS"
  /** Caller supplied only InventoryType. It is not a key. Rule: Category wins. */
  | "INVENTORY_TYPE_IS_NOT_A_KEY"
  /** The map resolved to a slug that has no inventory account. */
  | "SLUG_HAS_NO_ACCOUNT";

export type LedgerCategoryResolution =
  | {
      ok: true;
      /** The exact map key that matched, for evidence. */
      matchedKey: string;
      slug: string;
      accountCode: string;
      /** True when the match required case-folding rather than an exact hit. */
      foldedCase: boolean;
    }
  | { ok: false; code: LedgerCategoryRefusalCode; message: string };

/** Trim and collapse interior runs of whitespace. No case change. */
function normalizeCategory(raw: string): string {
  return raw.replace(/[\s\u00a0]+/g, " ").trim();
}

/**
 * Resolve a Cultivera `Category` to a house slug and inventory account.
 *
 * Case-folding is allowed because Cultivera exports have shown casing drift,
 * but it REFUSES rather than picks when folding is ambiguous.
 */
export function resolveLedgerCategory(rawCategory: string | null | undefined): LedgerCategoryResolution {
  return resolveLedgerCategoryIn(LEDGER_CATEGORY_MAP, rawCategory);
}

/**
 * The real resolver, parameterised by the map it reads.
 *
 * WHY THIS IS EXPORTED. Two guards below -- CATEGORY_AMBIGUOUS and
 * SLUG_HAS_NO_ACCOUNT -- cannot fire against the SHIPPED map, because that map
 * has no case-folding collision and no dangling slug. A mutation campaign
 * proved it: mutants that broke both guards SURVIVED, because no input could
 * reach them. Under standing rule 43 -- "a refusal code that no code path emits
 * is not protection, it is decoration" -- correct-but-unreachable code is not
 * yet protection.
 *
 * The guards are real protection for the map's FUTURE, though: the moment
 * someone adds "rso"/"RSO" with different slugs, or points a category at a slug
 * with no account, they must refuse rather than silently pick. So the resolver
 * takes the map as an argument, the shipped path passes the shipped map, and the
 * tests pass hostile maps to reach both guards. The code that runs in production
 * is the identical function.
 */
export function resolveLedgerCategoryIn(
  map: Readonly<Record<string, string>>,
  rawCategory: string | null | undefined,
): LedgerCategoryResolution {
  if (rawCategory === null || rawCategory === undefined) {
    return { ok: false, code: "CATEGORY_MISSING", message: "Category was null or undefined." };
  }
  const name = normalizeCategory(rawCategory);
  if (name.length === 0) {
    return { ok: false, code: "CATEGORY_MISSING", message: "Category was empty or whitespace only." };
  }

  const exact = Object.prototype.hasOwnProperty.call(map, name) ? map[name] : undefined;

  let slug: string | undefined = exact;
  let matchedKey = name;
  let foldedCase = false;

  if (slug === undefined) {
    const lower = name.toLowerCase();
    const hits: { key: string; slug: string }[] = [];
    for (const key of Object.keys(map)) {
      if (key.toLowerCase() === lower) hits.push({ key, slug: map[key] });
    }
    if (hits.length === 0) {
      return {
        ok: false,
        code: "CATEGORY_UNKNOWN",
        message:
          'Category "' +
          name +
          '" is not in the ledger category map. It is named and refused, never routed to a fallback account.',
      };
    }
    const distinct = new Set(hits.map((h) => h.slug));
    if (distinct.size > 1) {
      const listed = hits.map((h) => h.key + " -> " + h.slug).join("; ");
      return {
        ok: false,
        code: "CATEGORY_AMBIGUOUS",
        message: 'Category "' + name + '" case-folds onto disagreeing entries: ' + listed + ".",
      };
    }
    slug = hits[0].slug;
    matchedKey = hits[0].key;
    foldedCase = true;
  }

  const accountCode = ledgerAccountForSlug(slug);
  if (accountCode === null) {
    return {
      ok: false,
      code: "SLUG_HAS_NO_ACCOUNT",
      message: 'Category "' + name + '" maps to slug "' + slug + '", which has no inventory account.',
    };
  }

  return { ok: true, matchedKey, slug, accountCode, foldedCase };
}

/**
 * Resolve a lot using the ONLY legal key.
 *
 * This is the executable form of "Category wins over InventoryType". If
 * `category` is unusable the lot is REFUSED even when `inventoryType` is
 * present and looks helpful. `inventoryType` is accepted as a parameter purely
 * so callers cannot claim the rule was hidden from them -- it is never read as
 * a routing key.
 */
export function resolveLedgerLotCategory(input: {
  category: string | null | undefined;
  inventoryType?: string | null;
}): LedgerCategoryResolution {
  const byCategory = resolveLedgerCategory(input.category);
  // Category wins. Full stop. `inventoryType` is never consulted on this path,
  // and the returned object is the Category result UNCHANGED.
  if (byCategory.ok) return byCategory;

  const it = typeof input.inventoryType === "string" ? normalizeCategory(input.inventoryType) : "";
  if (byCategory.code === "CATEGORY_MISSING" && it.length > 0) {
    return {
      ok: false,
      code: "INVENTORY_TYPE_IS_NOT_A_KEY",
      message:
        'Category is missing and InventoryType "' +
        it +
        '" was supplied, but InventoryType is not a routing key. Infused Pre-roll carries ' +
        "InventoryType 'Concentrate for Inhalation' on 532 of 617 rows; routing by it would post to " +
        "20140 instead of 20080 and still balance. Refusing.",
    };
  }
  return byCategory;
}

/** Every distinct account this map can produce, sorted, for reporting. */
export function ledgerMapTargetAccounts(): string[] {
  const out = new Set<string>();
  for (const key of Object.keys(LEDGER_CATEGORY_MAP)) {
    const code = ledgerAccountForSlug(LEDGER_CATEGORY_MAP[key]);
    if (code !== null) out.add(code);
  }
  return Array.from(out).sort();
}

/* ------------------------------------------------------------------ *
 * Self-tests. Run by scripts/compliance/run-pure-selftests.ts.
 * ------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("ledger-category-map-core self-test: " + msg);
}

export function __runLedgerCategoryMapCoreTests(): void {
  assert(LEDGER_CATEGORY_SLOTS.length === 21, "21 house categories");
  assert(MEASURED_CATEGORY_COUNT === 52, "52 categories measured in the export");
  assert(UNSTOCKED_MAPPED_CATEGORIES.length === 1, "exactly one mapped-but-unstocked category");
  assert(
    Object.keys(LEDGER_CATEGORY_MAP).length === MEASURED_CATEGORY_COUNT + UNSTOCKED_MAPPED_CATEGORIES.length,
    "map size must equal measured + unstocked, got " + Object.keys(LEDGER_CATEGORY_MAP).length,
  );
  for (const cat of UNSTOCKED_MAPPED_CATEGORIES) {
    const r = resolveLedgerCategory(cat);
    assert(r.ok, "unstocked category " + cat + " still resolves");
  }

  // Account arithmetic.
  assert(ledgerAccountForSlug("flower") === "20010", "flower -> 20010");
  assert(ledgerAccountForSlug("concentrate") === "20140", "concentrate -> 20140");
  assert(ledgerAccountForSlug("merch") === "20220", "merch -> 20220");
  assert(ledgerAccountForSlug("nope") === null, "unknown slug -> null");
  assert(ledgerAccountForSlug(null) === null, "null slug -> null");

  // The four decided overrides actually route to the dedicated accounts.
  const four: [string, string][] = [
    ["RSO", "20150"],
    ["Tincture", "20180"],
    ["Infused Blunt", "20100"],
    ["Blunt", "20070"],
  ];
  for (const [cat, code] of four) {
    const r = resolveLedgerCategory(cat);
    assert(r.ok, cat + " must resolve");
    if (r.ok) assert(r.accountCode === code, cat + " -> " + code + ", got " + r.accountCode);
  }

  // Every map value must have an account. No dangling slugs.
  for (const key of Object.keys(LEDGER_CATEGORY_MAP)) {
    assert(ledgerAccountForSlug(LEDGER_CATEGORY_MAP[key]) !== null, "slug for " + key + " has an account");
  }

  // Whitespace tolerance and case folding.
  const ws = resolveLedgerCategory("  Infused   Pre-roll ");
  assert(ws.ok, "whitespace-collapsed category resolves");
  if (ws.ok) {
    assert(ws.accountCode === "20080", "infused pre-roll -> 20080");
    assert(ws.foldedCase === false, "exact match after normalize is not a case fold");
  }
  const folded = resolveLedgerCategory("flower");
  assert(folded.ok, "lowercase flower resolves");
  if (folded.ok) {
    assert(folded.foldedCase === true, "lowercase flower is a case fold");
    assert(folded.matchedKey === "Flower", "case fold reports the real key");
  }

  // Refusals must be reachable. Rule 43.
  const missing = resolveLedgerCategory(null);
  assert(!missing.ok && missing.code === "CATEGORY_MISSING", "null -> CATEGORY_MISSING");
  const blank = resolveLedgerCategory("   ");
  assert(!blank.ok && blank.code === "CATEGORY_MISSING", "blank -> CATEGORY_MISSING");
  const unknown = resolveLedgerCategory("Space Waffles");
  assert(!unknown.ok && unknown.code === "CATEGORY_UNKNOWN", "unseen -> CATEGORY_UNKNOWN");
  if (!unknown.ok) assert(unknown.message.indexOf("Space Waffles") >= 0, "unknown names the category");

  // Category wins over InventoryType, enforced.
  const it = resolveLedgerLotCategory({ category: "", inventoryType: "Concentrate for Inhalation" });
  assert(!it.ok && it.code === "INVENTORY_TYPE_IS_NOT_A_KEY", "InventoryType alone is refused");
  const both = resolveLedgerLotCategory({ category: "Infused Blunt", inventoryType: "Concentrate for Inhalation" });
  assert(both.ok, "a real category resolves despite a misleading InventoryType");
  if (both.ok) assert(both.accountCode === "20100", "Category beat InventoryType: 20100 not 20140");
  const stillUnknown = resolveLedgerLotCategory({ category: "Space Waffles", inventoryType: "Flower" });
  assert(
    !stillUnknown.ok && stillUnknown.code === "CATEGORY_UNKNOWN",
    "an unknown category is not rescued by InventoryType",
  );

  // The two guards that the shipped map cannot reach, reached through hostile
  // maps via the exported resolver. Rule 43: not decoration.
  const ambiguousMap = { "RSO": "rso", "rso": "concentrate" };
  const amb = resolveLedgerCategoryIn(ambiguousMap, "RsO");
  assert(!amb.ok && amb.code === "CATEGORY_AMBIGUOUS", "hostile map reaches CATEGORY_AMBIGUOUS");
  if (!amb.ok) {
    assert(amb.message.indexOf("rso") >= 0, "ambiguity names the disagreeing entries");
  }
  const danglingMap = { "Ghost": "not-a-real-slug" };
  const dang = resolveLedgerCategoryIn(danglingMap, "Ghost");
  assert(!dang.ok && dang.code === "SLUG_HAS_NO_ACCOUNT", "hostile map reaches SLUG_HAS_NO_ACCOUNT");
  if (!dang.ok) {
    assert(dang.message.indexOf("not-a-real-slug") >= 0, "dangling slug is named");
  }
  // The shipped map must behave identically through both entry points.
  // M15b/M29c guards: first-key determinism, and the wrapper adding nothing.
  const agreeing = resolveLedgerCategoryIn({ RSO: "rso", rso: "rso" }, "RsO");
  assert(agreeing.ok, "agreeing case-fold resolves");
  if (agreeing.ok) assert(agreeing.matchedKey === "RSO", "first declared key wins, got " + agreeing.matchedKey);
  const intruder = resolveLedgerCategory("Ghost");
  assert(!intruder.ok && intruder.code === "CATEGORY_UNKNOWN", "wrapper adds no keys to the shipped map");

  const viaWrapper = resolveLedgerCategory("Blunt");
  const viaInner = resolveLedgerCategoryIn(LEDGER_CATEGORY_MAP, "Blunt");
  assert(JSON.stringify(viaWrapper) === JSON.stringify(viaInner), "wrapper and inner agree");

  // The override table must describe real divergences.
  assert(LEDGER_ONLY_OVERRIDES.length === 4, "4 decided overrides");
  for (const o of LEDGER_ONLY_OVERRIDES) {
    assert(o.websiteSlug !== o.ledgerSlug, o.category + " is a real divergence");
    assert(LEDGER_CATEGORY_MAP[o.category] === o.ledgerSlug, o.category + " map agrees with override table");
    assert(o.rows > 0 && o.valueCents > 0, o.category + " carries measured rows and value");
  }
  const sum = LEDGER_ONLY_OVERRIDES.reduce((a, o) => a + o.valueCents, 0);
  assert(sum === 690007, "the four overrides total $6,900.07, got " + sum);

  // Nothing routes to the quarantine account.
  const targets = ledgerMapTargetAccounts();
  assert(targets.indexOf("20890") === -1, "no route to 20890 quarantine");
  assert(targets.length === 16, "16 distinct target accounts, got " + targets.length);
  for (const code of targets) {
    assert(/^2\d{4}$/.test(code), "target " + code + " is a block-2 inventory account");
  }
}
