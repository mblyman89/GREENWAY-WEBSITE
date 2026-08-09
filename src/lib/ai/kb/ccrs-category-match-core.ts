/**
 * src/lib/ai/kb/ccrs-category-match-core.ts  (KB↔CCRS link, Slice 1)
 *
 * PURE brain for resolving a raw CCRS/LCB inventory-type string onto a KB
 * product category (`kb_product_categories`).
 *
 * WHY THIS EXISTS (owner, Michael): products are created by the vendor in CCRS
 * and enter receiving with a CCRS inventory type attached (e.g. "Usable
 * Marijuana", "Concentrate for Inhalation", "Solid Marijuana Infused Edible").
 * The website type/category is DERIVED from that CCRS type + the product. The KB
 * is meant to be the source of truth, and each KB category already carries the
 * exact CCRS names it corresponds to in `wa_inventory_types[]` — but nothing
 * used that field as a join key, so the intake→KB link (writeback.ts) silently
 * missed: it matched the raw CCRS text only against a category's slug/name
 * ("Concentrate for Inhalation" is neither the slug `concentrate` nor the name
 * "Concentrate"), so `product_category_id` came back null.
 *
 * This module makes the **CCRS name the stable join key** while PRESERVING the
 * existing precedence (slug first, then name, then CCRS membership), so nothing
 * that already resolved changes — we only ADD the CCRS path that used to miss.
 *
 * PURE + deterministic (no I/O, no server-only): the async DB loader lives in
 * writeback.ts and just feeds this the category rows. tsx-unit-testable and
 * safe in the pure self-test harness.
 */

/** The minimal category shape the matcher needs (subset of KbProductCategoryRow). */
export type CcrsMatchCategory = {
  id: string;
  slug: string;
  name: string;
  /** The CCRS/LCB inventory-type names this KB category corresponds to. */
  wa_inventory_types: string[] | null | undefined;
  /** Optional ordering for a stable, deterministic tie-break. */
  sort_order?: number | null;
};

/** Where a resolved category id came from (audit / debugging / tests). */
export type CcrsMatchSource = "slug" | "name" | "ccrs" | "none";

export type CcrsCategoryMatch = {
  /** The matched category id, or null when nothing matched. */
  id: string | null;
  /** The matched category (full row), or null. */
  category: CcrsMatchCategory | null;
  /** How the match was made. */
  source: CcrsMatchSource;
};

/**
 * Canonicalize any type string (CCRS name, slug, or free text) for comparison:
 * trim, lower-case, and collapse internal whitespace. This is intentionally
 * conservative — we do NOT strip punctuation or "marijuana/cannabis" synonyms
 * here (that could create false matches). Synonym handling, if ever wanted, is
 * a deliberate future step, not a silent guess.
 */
export function normalizeCcrsType(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Dashed slug form of a value (mirrors writeback.ts slugifyDashed). PURE. */
export function slugifyDashedPure(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Deterministic ordering so ties always resolve the same way. */
function stableSort(cats: CcrsMatchCategory[]): CcrsMatchCategory[] {
  return [...cats].sort((a, b) => {
    const sa = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const sb = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return String(a.slug).localeCompare(String(b.slug));
  });
}

/**
 * Match a raw type string against KB categories by CCRS `wa_inventory_types`
 * membership (case-insensitive, whitespace-normalized). Returns the first match
 * in a deterministic (sort_order, then slug) order, or null. PURE.
 */
export function matchCategoryByCcrsType(
  rawType: string | null | undefined,
  categories: readonly CcrsMatchCategory[],
): CcrsMatchCategory | null {
  const needle = normalizeCcrsType(rawType);
  if (!needle) return null;
  const ordered = stableSort([...categories]);
  for (const cat of ordered) {
    for (const w of cat.wa_inventory_types ?? []) {
      if (normalizeCcrsType(w) === needle) return cat;
    }
  }
  return null;
}

/**
 * Resolve a raw type string onto a KB category using the SAME precedence the
 * intake→KB writeback intends, now with the CCRS path added LAST so it only
 * ever fills in a match that slug/name would have missed:
 *
 *   1. slug   — the value slugified equals a category slug (e.g. "concentrate")
 *   2. name   — the value equals a category name, case-insensitively
 *   3. ccrs   — the value is one of a category's wa_inventory_types (CCRS name)
 *   4. none   — no confident match (caller leaves product_category_id null;
 *               never guesses)
 *
 * Keeping slug/name FIRST guarantees anything that resolved before still
 * resolves identically; we purely add the previously-missing CCRS join. PURE.
 */
export function resolveCategoryForType(
  rawType: string | null | undefined,
  categories: readonly CcrsMatchCategory[],
): CcrsCategoryMatch {
  const value = normalizeCcrsType(rawType);
  if (!value) return { id: null, category: null, source: "none" };
  const ordered = stableSort([...categories]);

  // 1. slug
  const slug = slugifyDashedPure(rawType);
  if (slug) {
    const bySlug = ordered.find((c) => normalizeCcrsType(c.slug) === normalizeCcrsType(slug));
    if (bySlug) return { id: bySlug.id, category: bySlug, source: "slug" };
  }

  // 2. name (case-insensitive)
  const byName = ordered.find((c) => normalizeCcrsType(c.name) === value);
  if (byName) return { id: byName.id, category: byName, source: "name" };

  // 3. CCRS name (the stable join key that used to be missed)
  const byCcrs = matchCategoryByCcrsType(rawType, ordered);
  if (byCcrs) return { id: byCcrs.id, category: byCcrs, source: "ccrs" };

  // 4. no confident match
  return { id: null, category: null, source: "none" };
}

// ---------------------------------------------------------------------------
// Pure self-tests. Bare console.log is intentional here (self-test core file).
// ---------------------------------------------------------------------------
export function __runCcrsCategoryMatchCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`ccrs-category-match-core self-test FAILED: ${msg}`);
    passed++;
  };

  // A small, realistic slice of KB categories (values verbatim from
  // product-categories-data.ts so the test reflects real CCRS names).
  const cats: CcrsMatchCategory[] = [
    { id: "flower", slug: "flower", name: "Flower", sort_order: 0, wa_inventory_types: ["Flower Lot", "Marijuana Mix", "Marijuana Mix Packaged"] },
    { id: "pre-roll", slug: "pre-roll", name: "Pre-Rolls", sort_order: 1, wa_inventory_types: ["Marijuana Mix Infused"] },
    { id: "wax", slug: "wax", name: "Wax", sort_order: 2, wa_inventory_types: ["Hydrocarbon Wax"] },
    { id: "shatter", slug: "shatter", name: "Shatter", sort_order: 3, wa_inventory_types: ["Food Grade Solvent Extract"] },
    { id: "cart", slug: "vape-cartridge", name: "Vape Cartridge", sort_order: 4, wa_inventory_types: ["Marijuana Extract for Inhalation"] },
    { id: "edible-solid", slug: "gummies", name: "Gummies", sort_order: 5, wa_inventory_types: ["Solid Marijuana Infused Edible"] },
  ];

  // normalizeCcrsType basics.
  assert(normalizeCcrsType("  Hydrocarbon   Wax ") === "hydrocarbon wax", "normalize trims/collapses/lowers");
  assert(normalizeCcrsType(null) === "", "normalize null → empty");

  // CCRS name membership matches (the whole point).
  assert(matchCategoryByCcrsType("Hydrocarbon Wax", cats)?.id === "wax", "CCRS Hydrocarbon Wax → wax");
  assert(
    matchCategoryByCcrsType("marijuana extract for inhalation", cats)?.id === "cart",
    "CCRS match is case-insensitive",
  );
  assert(
    matchCategoryByCcrsType("Food Grade Solvent Extract", cats)?.id === "shatter",
    "CCRS Food Grade Solvent Extract → shatter",
  );
  assert(matchCategoryByCcrsType("Nonexistent Type", cats) === null, "unknown CCRS type → null (never guess)");

  // resolveCategoryForType precedence.
  // 1. slug wins first.
  const bySlug = resolveCategoryForType("flower", cats);
  assert(bySlug.source === "slug" && bySlug.id === "flower", "slug precedence");
  // 2. name when slug misses (slug of "Wax" is "wax" which IS a slug here, so
  //    use a category whose NAME differs from its slug: "Pre-Rolls"/pre-roll).
  const byName = resolveCategoryForType("Pre-Rolls", cats);
  assert(byName.source === "name" && byName.id === "pre-roll", "name precedence when slug misses");
  // 3. CCRS when slug+name both miss — the previously-missing link.
  const byCcrs = resolveCategoryForType("Marijuana Extract for Inhalation", cats);
  assert(byCcrs.source === "ccrs" && byCcrs.id === "cart", "CCRS join fills the gap slug/name missed");
  // 4. none — honest miss.
  const none = resolveCategoryForType("Totally Unknown", cats);
  assert(none.source === "none" && none.id === null, "no confident match → none");
  // empty input → none.
  assert(resolveCategoryForType("", cats).source === "none", "empty → none");

  // Deterministic tie-break: two categories sharing a CCRS name resolve to the
  // lower sort_order (stable, never flaky).
  const dupeCats: CcrsMatchCategory[] = [
    { id: "b", slug: "b-cat", name: "B", sort_order: 9, wa_inventory_types: ["Shared Type"] },
    { id: "a", slug: "a-cat", name: "A", sort_order: 1, wa_inventory_types: ["Shared Type"] },
  ];
  assert(matchCategoryByCcrsType("Shared Type", dupeCats)?.id === "a", "tie-break by lowest sort_order");

  // slugifyDashedPure mirrors the writeback slugifier.
  assert(slugifyDashedPure("Vape Cartridge") === "vape-cartridge", "slugifyDashedPure");

  console.log(`ccrs-category-match-core self-tests: ${passed} passed`);
  return { passed };
}
