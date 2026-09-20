/**
 * src/lib/leafly/selection-core.ts  (SLICE L-18 — the item picker)
 *
 * PURE selection logic for "push only these items to Leafly". No DB, no
 * network, no `server-only` — provable with tsx in CI.
 *
 * WHY THIS EXISTS
 * ---------------
 * The owner is about to make the FIRST menu push his own system has ever sent
 * to Leafly, into a sandbox that already holds 1,876 items from a previous POS
 * integration. Sending all 2,562 items as the first act tests the data and the
 * mechanism simultaneously, and if it comes back wrong there is no way to tell
 * which one failed. A small, deliberate selection makes every difference in the
 * read-back attributable.
 *
 * Until now there was no way to express "only these". The push sent the whole
 * feed. This file is the missing vocabulary.
 *
 * ===========================================================================
 * THE THREE HAZARDS THIS FILE EXISTS TO PREVENT
 * ===========================================================================
 *
 * These are not hypothetical. Each one is a real property of the existing code
 * that would destroy the live sandbox menu if a subset were naively fed into
 * the current push path.
 *
 * HAZARD 1 — A PARTIAL **POST** IS A MENU WIPE.
 *
 *   `push.ts` line 17, verified against the vendored spec:
 *       POST /{key}/menu/items -> full sync (deletes items missing from payload)
 *
 *   POST does not mean "send these". It means "this is now the entire menu".
 *   A ten-item POST against a menu of 1,876 deletes 1,866 products. The owner
 *   explicitly chose POST for routine syncing, and that choice is correct —
 *   it is how a sold-out product disappears — but it is catastrophic for a
 *   subset.
 *
 *   So `planSelectionPush` REFUSES to emit POST for a partial selection. Not
 *   "defaults to PUT" — refuses. A default is a suggestion that a future
 *   caller can override by passing the wrong argument; a refusal computed in
 *   the core is a guarantee that holds no matter who calls it. The refusal is
 *   `selectionMethod()` below and it is covered by a mutation test.
 *
 *   The one case where POST is permitted is a selection that provably contains
 *   the ENTIRE feed, because then "full sync" is exactly what it is.
 *
 * HAZARD 2 — A TARGETED PUSH MUST NOT WRITE SYNC STATE.
 *
 *   `pushLeaflyMenu` records `saveSyncState(channel, hashes, versionId)` — the
 *   hash map meaning "this is what Leafly currently has". If a ten-item push
 *   wrote that map, the stored state would assert Leafly holds ten items. The
 *   next routine sync would compute `deletes` for the 2,552 "missing" ones and
 *   the delta plan would be built on a lie.
 *
 *   This core therefore marks every partial plan `writesSyncState: false`, and
 *   the server path honours it. The consequence is deliberate and good: after a
 *   targeted push the next full sync still re-sends those items, because as far
 *   as the delta engine is concerned nothing was ever confirmed.
 *
 * HAZARD 3 — A TARGETED PUSH MUST NEVER ISSUE **DELETE**.
 *
 *   The PUT arm of `pushLeaflyMenu` follows its upsert with an explicit DELETE
 *   of `plan.deletes` (ids present in the previous state but absent from the
 *   current payload) — correct for a full sync, since PUT alone never removes
 *   anything. Under a subset, "absent from the current payload" describes every
 *   item the owner simply did not pick. The delete arm would remove them all:
 *   the same wipe as hazard 1, by a different road.
 *
 *   `emitsDeletes` is therefore `false` on every plan this file produces, and
 *   the targeted push is a SEPARATE function rather than a flag on the existing
 *   one. A boolean parameter threaded through a function that already deletes
 *   is one `if` away from disaster; a function that contains no DELETE call at
 *   all cannot issue one.
 *
 * ===========================================================================
 *
 * WHAT IS DELIBERATELY *NOT* HERE
 * -------------------------------
 * No fetching, no auth, no `SyndicationItem` construction. This file takes
 * items it is handed and answers questions about them. That is what lets the
 * whole picker — every filter, every safety refusal, the sampler, the coverage
 * report — be tested in CI without a database, credentials, or a network.
 */

import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";

// ---------------------------------------------------------------------------
// Filter vocabulary
// ---------------------------------------------------------------------------

/** Stock posture a filter can demand. */
export type StockFilter = "any" | "in-stock" | "out-of-stock";

/** Tri-state for "does the item have X?" filters. */
export type TriState = "any" | "yes" | "no";

/**
 * A complete description of "which items". Every field is optional; an empty
 * spec means "everything", which is the honest reading of "I have not filtered".
 */
export type SelectionSpec = {
  /** Free-text search over name, brand, strain name, and id. Case-insensitive. */
  search?: string;
  /** Categories to include (empty/absent = all). Compared case-insensitively. */
  categories?: string[];
  /** Brands to include (empty/absent = all). Compared case-insensitively. */
  brands?: string[];
  /** Strain types to include (indica/sativa/hybrid/cbd/unknown). */
  strainTypes?: string[];
  /** Stock posture. */
  stock?: StockFilter;
  /** Minimum price in minor units (inclusive), applied to the item's base price. */
  priceMinMinorUnits?: number;
  /** Maximum price in minor units (inclusive). */
  priceMaxMinorUnits?: number;
  /** Minimum parsed THC percentage (inclusive). Items with unparseable THC are excluded when set. */
  thcMinPercent?: number;
  /** Maximum parsed THC percentage (inclusive). */
  thcMaxPercent?: number;
  /** Require (or forbid) an exact product photo. */
  hasImage?: TriState;
  /** Require (or forbid) a non-empty description. */
  hasDescription?: TriState;
  /** Require (or forbid) more than one variant — the field mapping most worth testing. */
  hasMultipleVariants?: TriState;
  /** Require (or forbid) a DOH medical category. */
  isDohRestricted?: TriState;
  /**
   * Explicit ids to include. When non-empty this is a UNION with the filter
   * result, not an intersection — "everything matching, plus these by name".
   */
  includeIds?: string[];
  /**
   * Explicit ids to exclude. Always wins over every other rule, including
   * `includeIds`. Exclusion is the one instruction that must never be
   * overridden: a person removing an item from a live push has a reason, and
   * the system guessing otherwise is how the wrong product ships.
   */
  excludeIds?: string[];
};

/** How to order the matched items. */
export type SelectionSort =
  | "relevance"
  | "name"
  | "brand"
  | "category"
  | "price-asc"
  | "price-desc"
  | "thc-desc";

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function nonEmpty(list: readonly string[] | undefined): string[] {
  if (!list) return [];
  return list.map((v) => norm(v)).filter((v) => v.length > 0);
}

/**
 * Parse a THC/CBD string into a percentage number.
 *
 * The feed carries these as free text ("22%", "22.5 %", "THC: 18%", "—", null)
 * because that is what the POS exports. Returning `null` for anything that is
 * not confidently a number is the point: a filter that silently treated an
 * unparseable potency as 0 would quietly hide every product whose lab data is
 * formatted unusually, and the owner would never know they were missing.
 */
export function parsePercent(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const match = String(value).match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

/** True when the item has at least one variant that is in stock. */
export function hasSellableVariant(item: SyndicationItem): boolean {
  return item.variants.some((v) => v.inStock);
}

function matchesTriState(state: TriState | undefined, actual: boolean): boolean {
  if (!state || state === "any") return true;
  return state === "yes" ? actual : !actual;
}

// ---------------------------------------------------------------------------
// Search + relevance
// ---------------------------------------------------------------------------

/**
 * Relevance score for a search term against an item. Higher is better; 0 means
 * no match at all.
 *
 * The weighting is not decoration. Someone typing "blue dream" into a picker
 * that is about to send real products to a public menu is looking for a
 * specific product, so an exact name match outranks a brand that merely
 * contains the word. Ranking by name alphabetically — the obvious cheap option
 * — would bury the thing they typed under everything that happens to start
 * with "A".
 */
export function relevanceScore(item: SyndicationItem, rawTerm: string): number {
  const term = norm(rawTerm);
  if (!term) return 0;

  const name = norm(item.name);
  const brand = norm(item.brand);
  const strain = norm(item.strainName);
  const id = norm(item.id);

  // An id match is an exact-identity match: someone pasting a product key wants
  // that product and nothing else.
  if (id === term) return 1000;
  if (name === term) return 900;
  if (strain === term) return 800;
  if (name.startsWith(term)) return 700;
  if (strain.startsWith(term)) return 600;
  if (brand === term) return 500;
  if (name.includes(term)) return 400;
  if (strain.includes(term)) return 300;
  if (brand.includes(term)) return 200;
  if (id.includes(term)) return 100;
  return 0;
}

/**
 * Multi-word search: every word must match somewhere, and the score is the sum.
 *
 * Requiring ALL words (rather than any) is what makes a two-word search useful.
 * "blue dream" matching everything blue *or* dreamy would return a list nobody
 * can act on.
 */
export function searchScore(item: SyndicationItem, rawSearch: string): number {
  const words = norm(rawSearch).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  let total = 0;
  for (const word of words) {
    const score = relevanceScore(item, word);
    if (score === 0) return 0;
    total += score;
  }
  return total;
}

// ---------------------------------------------------------------------------
// The filter engine
// ---------------------------------------------------------------------------

/** Does this item satisfy every constraint in the spec (ignoring include/exclude ids)? */
export function matchesFilters(item: SyndicationItem, spec: SelectionSpec): boolean {
  const categories = nonEmpty(spec.categories);
  if (categories.length > 0 && !categories.includes(norm(item.category))) return false;

  const brands = nonEmpty(spec.brands);
  if (brands.length > 0 && !brands.includes(norm(item.brand))) return false;

  const strainTypes = nonEmpty(spec.strainTypes);
  if (strainTypes.length > 0 && !strainTypes.includes(norm(item.strainType))) return false;

  if (spec.stock === "in-stock" && !item.inStock) return false;
  if (spec.stock === "out-of-stock" && item.inStock) return false;

  if (typeof spec.priceMinMinorUnits === "number" && item.priceMinorUnits < spec.priceMinMinorUnits) {
    return false;
  }
  if (typeof spec.priceMaxMinorUnits === "number" && item.priceMinorUnits > spec.priceMaxMinorUnits) {
    return false;
  }

  // Potency filters exclude unparseable values rather than treating them as 0.
  // See parsePercent for why.
  if (typeof spec.thcMinPercent === "number" || typeof spec.thcMaxPercent === "number") {
    const thc = parsePercent(item.thc);
    if (thc === null) return false;
    if (typeof spec.thcMinPercent === "number" && thc < spec.thcMinPercent) return false;
    if (typeof spec.thcMaxPercent === "number" && thc > spec.thcMaxPercent) return false;
  }

  if (!matchesTriState(spec.hasImage, Boolean(item.imageUrl))) return false;
  if (!matchesTriState(spec.hasDescription, norm(item.description).length > 0)) return false;
  if (!matchesTriState(spec.hasMultipleVariants, item.variants.length > 1)) return false;
  if (!matchesTriState(spec.isDohRestricted, Boolean(item.dohCategory))) return false;

  if (spec.search && spec.search.trim().length > 0 && searchScore(item, spec.search) === 0) {
    return false;
  }

  return true;
}

/** Comparator for a given sort mode. */
function compareBy(
  sort: SelectionSort,
  scores: Map<string, number>,
): (a: SyndicationItem, b: SyndicationItem) => number {
  const byName = (a: SyndicationItem, b: SyndicationItem) =>
    norm(a.name).localeCompare(norm(b.name)) || a.id.localeCompare(b.id);

  switch (sort) {
    case "relevance":
      return (a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || byName(a, b);
    case "brand":
      return (a, b) => norm(a.brand).localeCompare(norm(b.brand)) || byName(a, b);
    case "category":
      return (a, b) => norm(a.category).localeCompare(norm(b.category)) || byName(a, b);
    case "price-asc":
      return (a, b) => a.priceMinorUnits - b.priceMinorUnits || byName(a, b);
    case "price-desc":
      return (a, b) => b.priceMinorUnits - a.priceMinorUnits || byName(a, b);
    case "thc-desc":
      return (a, b) => (parsePercent(b.thc) ?? -1) - (parsePercent(a.thc) ?? -1) || byName(a, b);
    case "name":
    default:
      return byName;
  }
}

/**
 * Apply a spec to a feed and return the matching items, ordered.
 *
 * Ordering is always fully deterministic (every comparator falls through to
 * name then id). A picker whose list reshuffles between the preview and the
 * push is a picker nobody should trust with live data.
 */
export function selectItems(
  items: readonly SyndicationItem[],
  spec: SelectionSpec,
  sort: SelectionSort = "relevance",
): SyndicationItem[] {
  const excluded = new Set(nonEmpty(spec.excludeIds));
  const forced = new Set(nonEmpty(spec.includeIds));

  const chosen = items.filter((item) => {
    const id = norm(item.id);
    // Exclusion always wins — including over an explicit include. See the
    // SelectionSpec comment.
    if (excluded.has(id)) return false;
    if (forced.has(id)) return true;
    return matchesFilters(item, spec);
  });

  const scores = new Map<string, number>();
  if (spec.search && spec.search.trim().length > 0) {
    for (const item of chosen) scores.set(item.id, searchScore(item, spec.search));
  }

  // Sorting a copy: mutating the caller's array would be a surprising side
  // effect in a function whose whole contract is "answer a question".
  return [...chosen].sort(compareBy(sort, scores));
}

// ---------------------------------------------------------------------------
// Facets — what can be picked from
// ---------------------------------------------------------------------------

export type FacetValue = { value: string; label: string; count: number };

export type SelectionFacets = {
  categories: FacetValue[];
  brands: FacetValue[];
  strainTypes: FacetValue[];
  priceMinMinorUnits: number;
  priceMaxMinorUnits: number;
  totalItems: number;
  inStockCount: number;
  withImageCount: number;
  withDescriptionCount: number;
  multiVariantCount: number;
  dohRestrictedCount: number;
};

/**
 * Summarise a feed into the choices a picker can offer, with counts.
 *
 * Counts matter more than they look. A dropdown listing "concentrate" without
 * saying it holds 3 items invites the owner to filter to it and find an empty
 * grid, with nothing to distinguish "no such category" from "I mistyped".
 */
export function computeFacets(items: readonly SyndicationItem[]): SelectionFacets {
  const categories = new Map<string, { label: string; count: number }>();
  const brands = new Map<string, { label: string; count: number }>();
  const strainTypes = new Map<string, { label: string; count: number }>();

  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  let inStockCount = 0;
  let withImageCount = 0;
  let withDescriptionCount = 0;
  let multiVariantCount = 0;
  let dohRestrictedCount = 0;

  for (const item of items) {
    const catKey = norm(item.category);
    if (catKey) {
      const row = categories.get(catKey) ?? { label: item.category, count: 0 };
      row.count += 1;
      categories.set(catKey, row);
    }
    const brandKey = norm(item.brand);
    if (brandKey) {
      const row = brands.get(brandKey) ?? { label: item.brand ?? brandKey, count: 0 };
      row.count += 1;
      brands.set(brandKey, row);
    }
    const strainKey = norm(item.strainType);
    if (strainKey) {
      const row = strainTypes.get(strainKey) ?? { label: item.strainType, count: 0 };
      row.count += 1;
      strainTypes.set(strainKey, row);
    }

    if (item.priceMinorUnits < min) min = item.priceMinorUnits;
    if (item.priceMinorUnits > max) max = item.priceMinorUnits;
    if (item.inStock) inStockCount += 1;
    if (item.imageUrl) withImageCount += 1;
    if (norm(item.description).length > 0) withDescriptionCount += 1;
    if (item.variants.length > 1) multiVariantCount += 1;
    if (item.dohCategory) dohRestrictedCount += 1;
  }

  const toFacets = (map: Map<string, { label: string; count: number }>): FacetValue[] =>
    Array.from(map.entries())
      .map(([value, row]) => ({ value, label: row.label, count: row.count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return {
    categories: toFacets(categories),
    brands: toFacets(brands),
    strainTypes: toFacets(strainTypes),
    priceMinMinorUnits: Number.isFinite(min) ? min : 0,
    priceMaxMinorUnits: max,
    totalItems: items.length,
    inStockCount,
    withImageCount,
    withDescriptionCount,
    multiVariantCount,
    dohRestrictedCount,
  };
}

// ---------------------------------------------------------------------------
// Coverage — what a selection actually exercises
// ---------------------------------------------------------------------------

export type CoverageGap = {
  code:
    | "no-multi-variant"
    | "no-image"
    | "no-description"
    | "single-category"
    | "no-potency"
    | "no-in-stock"
    | "all-same-brand";
  /** Plain-language description of what will NOT be tested by this push. */
  message: string;
};

export type SelectionCoverage = {
  itemCount: number;
  variantCount: number;
  categories: string[];
  brands: string[];
  strainTypes: string[];
  withImage: number;
  withDescription: number;
  withMultipleVariants: number;
  withPotency: number;
  inStock: number;
  dohRestricted: number;
  /** Field mappings this selection will NOT exercise. */
  gaps: CoverageGap[];
};

/**
 * Describe what a selection will and will not prove.
 *
 * WHY A PICKER SHOULD GRADE ITS OWN SELECTION. The entire reason for pushing a
 * subset is to verify the mapping before trusting it with 2,562 items. A subset
 * of ten flower products with no photos verifies flower products with no
 * photos, and a clean read-back would be read as "the integration works" when
 * it in fact demonstrated nothing about images, edibles, or multi-size
 * variants. This function makes the difference visible BEFORE the push, which
 * is the only time it is useful.
 *
 * Note these are GAPS, not errors. A deliberate single-category push is a
 * perfectly good test of that category. The report informs; it never blocks.
 */
export function computeCoverage(items: readonly SyndicationItem[]): SelectionCoverage {
  const categories = new Set<string>();
  const brands = new Set<string>();
  const strainTypes = new Set<string>();

  let variantCount = 0;
  let withImage = 0;
  let withDescription = 0;
  let withMultipleVariants = 0;
  let withPotency = 0;
  let inStock = 0;
  let dohRestricted = 0;

  for (const item of items) {
    if (item.category) categories.add(item.category);
    if (item.brand) brands.add(item.brand);
    if (item.strainType) strainTypes.add(item.strainType);
    variantCount += item.variants.length;
    if (item.imageUrl) withImage += 1;
    if (norm(item.description).length > 0) withDescription += 1;
    if (item.variants.length > 1) withMultipleVariants += 1;
    if (parsePercent(item.thc) !== null) withPotency += 1;
    if (item.inStock) inStock += 1;
    if (item.dohCategory) dohRestricted += 1;
  }

  const gaps: CoverageGap[] = [];
  if (items.length > 0) {
    if (withMultipleVariants === 0) {
      gaps.push({
        code: "no-multi-variant",
        message:
          "Nothing here has more than one size, so this push will not prove that variants map correctly.",
      });
    }
    if (withImage === 0) {
      gaps.push({
        code: "no-image",
        message: "No item here has a photo, so image handling will not be tested.",
      });
    }
    if (withDescription === 0) {
      gaps.push({
        code: "no-description",
        message: "No item here has a description, so description handling will not be tested.",
      });
    }
    if (categories.size <= 1) {
      gaps.push({
        code: "single-category",
        message:
          "Everything here is one category, so only that category's field mapping gets tested.",
      });
    }
    if (withPotency === 0) {
      gaps.push({
        code: "no-potency",
        message:
          "No item here has a readable THC figure, so total_thc will not be tested — and that is one of the fields most worth checking.",
      });
    }
    if (inStock === 0) {
      gaps.push({
        code: "no-in-stock",
        message:
          "Nothing here is in stock, so inventory levels and orderability will not be tested.",
      });
    }
    if (brands.size <= 1 && items.length > 1) {
      gaps.push({
        code: "all-same-brand",
        message: "Everything here is one brand, so brand handling gets a narrow test.",
      });
    }
  }

  const sorted = (set: Set<string>) => Array.from(set).sort();

  return {
    itemCount: items.length,
    variantCount,
    categories: sorted(categories),
    brands: sorted(brands),
    strainTypes: sorted(strainTypes),
    withImage,
    withDescription,
    withMultipleVariants,
    withPotency,
    inStock,
    dohRestricted,
    gaps,
  };
}

// ---------------------------------------------------------------------------
// The representative sampler
// ---------------------------------------------------------------------------

/**
 * Build a small selection that exercises as many DIFFERENT field mappings as
 * possible.
 *
 * WHY THIS IS NOT "TAKE THE FIRST TEN". The first ten items of an
 * alphabetically-ordered feed are, in a real dispensary catalogue, ten
 * near-identical flower eighths from the same brand. Pushing them proves one
 * mapping ten times over. This picks for DIFFERENCE: a new category beats a
 * second of the same, a multi-variant item beats a single, an item with a photo
 * and a description and a potency figure beats a bare one.
 *
 * The scoring is greedy and deterministic: at each step, take the item that
 * adds the most that is new, breaking every tie by id so two runs on the same
 * feed always produce the same sample. A sampler that returned a different set
 * each time would make a failed read-back impossible to reproduce.
 *
 * In-stock items are preferred because an out-of-stock item cannot exercise
 * orderability or inventory levels — but out-of-stock items are NOT excluded,
 * because if the whole category is out of stock a sample of nothing teaches
 * nothing.
 */
export function buildRepresentativeSample(
  items: readonly SyndicationItem[],
  limit: number,
): SyndicationItem[] {
  const cap = Math.max(0, Math.floor(limit));
  if (cap === 0 || items.length === 0) return [];

  const pool = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const picked: SyndicationItem[] = [];

  const seenCategories = new Set<string>();
  const seenBrands = new Set<string>();
  const seenStrainTypes = new Set<string>();
  let haveMultiVariant = false;
  let haveImage = false;
  let haveDescription = false;
  let havePotency = false;
  let haveInStock = false;

  const noveltyOf = (item: SyndicationItem): number => {
    let score = 0;
    if (item.category && !seenCategories.has(norm(item.category))) score += 100;
    if (item.variants.length > 1 && !haveMultiVariant) score += 60;
    if (item.strainType && !seenStrainTypes.has(norm(item.strainType))) score += 40;
    if (item.imageUrl && !haveImage) score += 30;
    if (parsePercent(item.thc) !== null && !havePotency) score += 30;
    if (norm(item.description).length > 0 && !haveDescription) score += 20;
    if (item.brand && !seenBrands.has(norm(item.brand))) score += 15;
    if (item.inStock && !haveInStock) score += 50;

    // Mild standing preference for items that are richer and sellable, used to
    // break ties once the novelty bonuses are exhausted.
    if (item.inStock) score += 5;
    if (item.imageUrl) score += 2;
    if (norm(item.description).length > 0) score += 2;
    if (item.variants.length > 1) score += 2;
    return score;
  };

  const remaining = new Map(pool.map((item) => [item.id, item]));

  while (picked.length < cap && remaining.size > 0) {
    let best: SyndicationItem | null = null;
    let bestScore = -1;
    // Iterating the id-sorted pool (not the Map) keeps tie-breaking stable.
    for (const item of pool) {
      if (!remaining.has(item.id)) continue;
      const score = noveltyOf(item);
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    if (!best) break;

    picked.push(best);
    remaining.delete(best.id);
    if (best.category) seenCategories.add(norm(best.category));
    if (best.brand) seenBrands.add(norm(best.brand));
    if (best.strainType) seenStrainTypes.add(norm(best.strainType));
    if (best.variants.length > 1) haveMultiVariant = true;
    if (best.imageUrl) haveImage = true;
    if (norm(best.description).length > 0) haveDescription = true;
    if (parsePercent(best.thc) !== null) havePotency = true;
    if (best.inStock) haveInStock = true;
  }

  return picked;
}

// ---------------------------------------------------------------------------
// Safety: the push plan
// ---------------------------------------------------------------------------

/**
 * The largest selection still treated as "targeted".
 *
 * This is not a performance limit. It is the line past which a person is no
 * longer testing and is doing a real menu publish, which belongs on the main
 * push button with its full-sync semantics — not on a picker whose whole
 * premise is that it does not touch anything it did not name.
 */
export const TARGETED_PUSH_MAX_ITEMS = 250;

export type SelectionRefusal = {
  code: "empty-selection" | "too-many-items" | "post-would-delete";
  message: string;
};

export type SelectionPlan = {
  /** Ids in the order they will be sent. */
  ids: string[];
  itemCount: number;
  /** Total items available in the feed this selection came from. */
  feedCount: number;
  /** True when the selection provably covers the WHOLE feed. */
  isWholeFeed: boolean;
  /** The HTTP method that may safely be used. */
  method: "POST" | "PUT";
  /** Whether the caller asked for something that had to be overruled. */
  methodWasCoerced: boolean;
  /** Always false for a partial push — see HAZARD 2. */
  writesSyncState: boolean;
  /** Always false for a partial push — see HAZARD 3. */
  emitsDeletes: boolean;
  /** Non-empty means the push must not proceed. */
  refusals: SelectionRefusal[];
  /** Safe to transmit? */
  ok: boolean;
  /** One-line plain-language summary for the UI and the audit log. */
  summary: string;
};

/**
 * Decide which method a selection may use.
 *
 * THIS IS HAZARD 1'S GUARD and it is intentionally the smallest, dullest
 * function in the file — three lines with no configuration, so there is nothing
 * to get subtly wrong and nowhere for a future caller to pass a flag that
 * turns it off.
 */
export function selectionMethod(input: {
  requested: "POST" | "PUT";
  selectedCount: number;
  feedCount: number;
}): { method: "POST" | "PUT"; coerced: boolean } {
  const isWholeFeed = input.feedCount > 0 && input.selectedCount >= input.feedCount;
  if (input.requested === "POST" && !isWholeFeed) {
    return { method: "PUT", coerced: true };
  }
  return { method: input.requested, coerced: false };
}

/**
 * Turn a chosen set of items into a transmission plan, or refuse.
 *
 * Refusals are returned rather than thrown. The picker needs to render "you
 * have selected 300 items, which is above the targeted limit" next to the
 * button; an exception would replace the screen the owner is working on.
 */
export function planSelectionPush(input: {
  selected: readonly SyndicationItem[];
  feedCount: number;
  requestedMethod: "POST" | "PUT";
}): SelectionPlan {
  const ids = input.selected.map((item) => item.id);
  const itemCount = ids.length;
  const isWholeFeed = input.feedCount > 0 && itemCount >= input.feedCount;

  const { method, coerced } = selectionMethod({
    requested: input.requestedMethod,
    selectedCount: itemCount,
    feedCount: input.feedCount,
  });

  const refusals: SelectionRefusal[] = [];
  if (itemCount === 0) {
    refusals.push({
      code: "empty-selection",
      message: "Nothing is selected, so there is nothing to send.",
    });
  }
  if (itemCount > TARGETED_PUSH_MAX_ITEMS) {
    refusals.push({
      code: "too-many-items",
      message:
        `A targeted push is capped at ${TARGETED_PUSH_MAX_ITEMS} items and ${itemCount} are selected. ` +
        "Past that it is a real menu publish, not a test — use the full sync button, which is built for it.",
    });
  }

  const summary = (() => {
    if (itemCount === 0) return "Nothing selected.";
    const noun = itemCount === 1 ? "item" : "items";
    if (isWholeFeed) {
      return `All ${itemCount} ${noun} — this is the whole menu, so it is a normal full sync.`;
    }
    return (
      `${itemCount} ${noun} of ${input.feedCount}, sent as ${method} so nothing else is touched. ` +
      "Items you did not pick are left exactly as they are."
    );
  })();

  return {
    ids,
    itemCount,
    feedCount: input.feedCount,
    isWholeFeed,
    method,
    methodWasCoerced: coerced,
    // HAZARD 2 and HAZARD 3: a partial push records nothing and deletes nothing.
    writesSyncState: isWholeFeed,
    emitsDeletes: false,
    refusals,
    ok: refusals.length === 0,
    summary,
  };
}

/**
 * Human-readable explanation of a method coercion, for the UI.
 *
 * Returning null when nothing was coerced is what keeps this honest: a banner
 * that always appears is wallpaper, and the owner stops reading it exactly when
 * it finally matters.
 */
export function describeMethodCoercion(plan: SelectionPlan): string | null {
  if (!plan.methodWasCoerced) return null;
  return (
    "Sent as PUT instead of POST. POST means \"this is the entire menu\" to Leafly, " +
    `so posting ${plan.itemCount} of ${plan.feedCount} items would delete the other ` +
    `${Math.max(0, plan.feedCount - plan.itemCount)}. PUT adds and updates only.`
  );
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type SelectionPreset = {
  id: string;
  label: string;
  description: string;
  spec: SelectionSpec;
  sort: SelectionSort;
};

/**
 * Ready-made selections for the jobs an operator actually has.
 *
 * Each one exists because it answers a question someone asked out loud, not to
 * fill a dropdown. "First-push sample" is the owner's current task; "fix one
 * product" is the job that recurs forever afterwards, when a single price is
 * wrong and re-syncing 2,562 items to correct it is absurd.
 */
export const SELECTION_PRESETS: readonly SelectionPreset[] = [
  {
    id: "first-push-sample",
    label: "First-push sample",
    description:
      "A small spread across categories, sizes and photos — the safest possible first transmission.",
    spec: { stock: "in-stock" },
    sort: "category",
  },
  {
    id: "in-stock",
    label: "Everything in stock",
    description: "Only products a customer could actually buy right now.",
    spec: { stock: "in-stock" },
    sort: "name",
  },
  {
    id: "multi-variant",
    label: "Multi-size products",
    description: "Products with more than one size — the field mapping most worth proving.",
    spec: { hasMultipleVariants: "yes", stock: "in-stock" },
    sort: "name",
  },
  {
    id: "with-photos",
    label: "Has a real photo",
    description: "Products with their own approved image, never a stand-in.",
    spec: { hasImage: "yes", stock: "in-stock" },
    sort: "name",
  },
  {
    id: "missing-description",
    label: "Missing a description",
    description: "Products with no description — worth fixing before they reach a public menu.",
    spec: { hasDescription: "no" },
    sort: "name",
  },
  {
    id: "missing-photo",
    label: "Missing a photo",
    description: "Products with no exact image of their own.",
    spec: { hasImage: "no" },
    sort: "name",
  },
  {
    id: "doh-restricted",
    label: "DOH medical products",
    description:
      "WAC 246-70 verified products. These can never be offered for online ordering, and this is how you check what Leafly is being told about them.",
    spec: { isDohRestricted: "yes" },
    sort: "name",
  },
];

// ---------------------------------------------------------------------------
// Self-tests (pure, run by the compliance suite)
// ---------------------------------------------------------------------------

function makeItem(over: Partial<SyndicationItem> & { id: string }): SyndicationItem {
  return {
    id: over.id,
    name: over.name ?? `Item ${over.id}`,
    brand: over.brand ?? "Acme",
    category: over.category ?? "flower",
    strainType: over.strainType ?? "hybrid",
    strainName: over.strainName ?? null,
    thc: over.thc ?? "20%",
    cbd: over.cbd ?? null,
    description: over.description ?? "A description.",
    priceMinorUnits: over.priceMinorUnits ?? 3500,
    inStock: over.inStock ?? true,
    variants: over.variants ?? [
      { id: `${over.id}-v1`, label: "3.5g", priceMinorUnits: 3500, inStock: true, inventoryLevel: 5 },
    ],
    imageUrl: over.imageUrl,
    dohCategory: over.dohCategory,
  };
}

export function __runLeaflySelectionTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  [selection-core] FAIL: ${label}`);
    }
  };

  // ---- parsePercent ----
  check("parsePercent reads a plain number", parsePercent("22") === 22);
  check("parsePercent reads a percent sign", parsePercent("22%") === 22);
  check("parsePercent reads a decimal", parsePercent("22.5%") === 22.5);
  check("parsePercent reads a labelled value", parsePercent("THC: 18%") === 18);
  check("parsePercent refuses a dash", parsePercent("—") === null);
  check("parsePercent refuses null", parsePercent(null) === null);
  check("parsePercent refuses empty", parsePercent("") === null);

  // ---- relevance ----
  const blueDream = makeItem({ id: "p1", name: "Blue Dream", strainName: "Blue Dream", brand: "Acme" });
  const blueBrand = makeItem({ id: "p2", name: "Sunset Sherbet", brand: "Blue Co" });
  check("exact id beats everything", relevanceScore(blueDream, "p1") === 1000);
  check("exact name scores high", relevanceScore(blueDream, "blue dream") === 900);
  check("name match outranks brand match", relevanceScore(blueDream, "blue") > relevanceScore(blueBrand, "blue"));
  check("no match scores zero", relevanceScore(blueDream, "zzz") === 0);
  check("search is case-insensitive", relevanceScore(blueDream, "BLUE DREAM") === 900);
  check("multi-word search requires all words", searchScore(blueDream, "blue zzz") === 0);
  check("multi-word search sums matches", searchScore(blueDream, "blue dream") > 0);

  // ---- filters ----
  const feed = [
    makeItem({ id: "a", category: "flower", brand: "Acme", inStock: true, priceMinorUnits: 1000, thc: "10%" }),
    makeItem({ id: "b", category: "edible-solid", brand: "Bravo", inStock: false, priceMinorUnits: 2000, thc: "20%" }),
    makeItem({ id: "c", category: "cartridge", brand: "Acme", inStock: true, priceMinorUnits: 3000, thc: "30%" }),
  ];
  check("empty spec matches everything", selectItems(feed, {}).length === 3);
  check("category filter works", selectItems(feed, { categories: ["flower"] }).length === 1);
  check(
    "category filter is case-insensitive",
    selectItems(feed, { categories: ["FLOWER"] }).length === 1,
  );
  check("brand filter works", selectItems(feed, { brands: ["acme"] }).length === 2);
  check("in-stock filter works", selectItems(feed, { stock: "in-stock" }).length === 2);
  check("out-of-stock filter works", selectItems(feed, { stock: "out-of-stock" }).length === 1);
  check("price min works", selectItems(feed, { priceMinMinorUnits: 2000 }).length === 2);
  check("price max works", selectItems(feed, { priceMaxMinorUnits: 2000 }).length === 2);
  check(
    "price range works",
    selectItems(feed, { priceMinMinorUnits: 1500, priceMaxMinorUnits: 2500 }).length === 1,
  );
  check("thc min works", selectItems(feed, { thcMinPercent: 20 }).length === 2);
  check("thc max works", selectItems(feed, { thcMaxPercent: 20 }).length === 2);

  // Unparseable potency is excluded, not treated as zero.
  const noThc = [makeItem({ id: "x", thc: "—" }), makeItem({ id: "y", thc: "15%" })];
  check("unparseable thc is excluded by a min filter", selectItems(noThc, { thcMinPercent: 0 }).length === 1);
  check(
    "unparseable thc is excluded by a max filter",
    selectItems(noThc, { thcMaxPercent: 100 }).length === 1,
  );

  // Tri-states.
  const triFeed = [
    makeItem({ id: "img", imageUrl: "https://example.com/a.jpg" }),
    makeItem({ id: "noimg" }),
  ];
  check("hasImage yes", selectItems(triFeed, { hasImage: "yes" }).length === 1);
  check("hasImage no", selectItems(triFeed, { hasImage: "no" }).length === 1);
  check("hasImage any", selectItems(triFeed, { hasImage: "any" }).length === 2);
  check("absent tri-state matches all", selectItems(triFeed, {}).length === 2);

  const descFeed = [makeItem({ id: "d1", description: "" }), makeItem({ id: "d2", description: "Hi" })];
  check("hasDescription no", selectItems(descFeed, { hasDescription: "no" })[0]?.id === "d1");
  check(
    "whitespace-only description counts as missing",
    selectItems([makeItem({ id: "w", description: "   " })], { hasDescription: "no" }).length === 1,
  );

  const varFeed = [
    makeItem({ id: "single" }),
    makeItem({
      id: "multi",
      variants: [
        { id: "v1", label: "1g", priceMinorUnits: 1000, inStock: true, inventoryLevel: 2 },
        { id: "v2", label: "3.5g", priceMinorUnits: 3000, inStock: true, inventoryLevel: 4 },
      ],
    }),
  ];
  check("hasMultipleVariants yes", selectItems(varFeed, { hasMultipleVariants: "yes" })[0]?.id === "multi");

  const dohFeed = [makeItem({ id: "n" }), makeItem({ id: "r", dohCategory: "high_thc" as never })];
  check("doh filter yes", selectItems(dohFeed, { isDohRestricted: "yes" })[0]?.id === "r");
  check("doh filter no", selectItems(dohFeed, { isDohRestricted: "no" })[0]?.id === "n");

  // ---- include / exclude ----
  check(
    "includeIds adds an item the filters rejected",
    selectItems(feed, { categories: ["flower"], includeIds: ["b"] }).length === 2,
  );
  check(
    "excludeIds removes a matching item",
    selectItems(feed, { excludeIds: ["a"] }).length === 2,
  );
  check(
    "exclude beats include",
    selectItems(feed, { includeIds: ["a"], excludeIds: ["a"] }).length === 0 ||
      selectItems(feed, { includeIds: ["a"], excludeIds: ["a"] }).every((i) => i.id !== "a"),
  );
  check(
    "exclude beats include exactly",
    !selectItems(feed, { includeIds: ["a"], excludeIds: ["a"] }).some((i) => i.id === "a"),
  );

  // ---- combined filters are AND ----
  check(
    "filters combine with AND",
    selectItems(feed, { brands: ["acme"], stock: "in-stock", categories: ["flower"] }).length === 1,
  );

  // ---- sorting determinism ----
  const sortFeed = [
    makeItem({ id: "z", name: "Zeta", priceMinorUnits: 100 }),
    makeItem({ id: "a", name: "Alpha", priceMinorUnits: 300 }),
    makeItem({ id: "m", name: "Mu", priceMinorUnits: 200 }),
  ];
  check("name sort", selectItems(sortFeed, {}, "name").map((i) => i.id).join(",") === "a,m,z");
  check("price-asc sort", selectItems(sortFeed, {}, "price-asc").map((i) => i.id).join(",") === "z,m,a");
  check("price-desc sort", selectItems(sortFeed, {}, "price-desc").map((i) => i.id).join(",") === "a,m,z");
  check(
    "sorting is stable across runs",
    selectItems(sortFeed, {}, "name").map((i) => i.id).join(",") ===
      selectItems(sortFeed, {}, "name").map((i) => i.id).join(","),
  );
  check(
    "selectItems does not mutate the input array",
    (() => {
      const original = [...sortFeed].map((i) => i.id).join(",");
      selectItems(sortFeed, {}, "price-asc");
      return sortFeed.map((i) => i.id).join(",") === original;
    })(),
  );
  // Relevance genuinely reorders: "Zeta" must win over an alphabetically
  // earlier item when it is what was searched for.
  check(
    "relevance sort puts the searched item first",
    selectItems(sortFeed, { search: "Zeta" }, "relevance")[0]?.id === "z",
  );

  // ---- facets ----
  const facets = computeFacets(feed);
  check("facets count categories", facets.categories.length === 3);
  check("facets count brands", facets.brands.length === 2);
  check("facets find the top brand first", facets.brands[0]?.value === "acme");
  check("facets report min price", facets.priceMinMinorUnits === 1000);
  check("facets report max price", facets.priceMaxMinorUnits === 3000);
  check("facets report total", facets.totalItems === 3);
  check("facets report in-stock count", facets.inStockCount === 2);
  check("facets on an empty feed do not report Infinity", computeFacets([]).priceMinMinorUnits === 0);

  // ---- coverage ----
  const narrow = computeCoverage([makeItem({ id: "only", imageUrl: undefined, description: "" })]);
  check("coverage flags no multi-variant", narrow.gaps.some((g) => g.code === "no-multi-variant"));
  check("coverage flags no image", narrow.gaps.some((g) => g.code === "no-image"));
  check("coverage flags no description", narrow.gaps.some((g) => g.code === "no-description"));
  check("coverage flags single category", narrow.gaps.some((g) => g.code === "single-category"));

  // NEGATIVE CONTROL: a broad selection must produce NO gaps. Advice that always
  // fires is nagging, not diagnosis.
  const broad = computeCoverage([
    makeItem({
      id: "g1",
      category: "flower",
      brand: "Acme",
      imageUrl: "https://example.com/1.jpg",
      description: "Good",
      thc: "20%",
      inStock: true,
      variants: [
        { id: "v1", label: "1g", priceMinorUnits: 1000, inStock: true, inventoryLevel: 2 },
        { id: "v2", label: "3.5g", priceMinorUnits: 3000, inStock: true, inventoryLevel: 4 },
      ],
    }),
    makeItem({
      id: "g2",
      category: "edible-solid",
      brand: "Bravo",
      imageUrl: "https://example.com/2.jpg",
      description: "Also good",
      thc: "10%",
      inStock: true,
    }),
  ]);
  check("NEGATIVE CONTROL: a broad selection reports no gaps", broad.gaps.length === 0);
  check("coverage counts variants", broad.variantCount === 3);
  check("coverage lists categories sorted", broad.categories.join(",") === "edible-solid,flower");
  check("coverage on an empty selection reports no gaps", computeCoverage([]).gaps.length === 0);
  check(
    "coverage flags no-potency when THC is unreadable",
    computeCoverage([makeItem({ id: "np", thc: "n/a" })]).gaps.some((g) => g.code === "no-potency"),
  );
  check(
    "coverage flags nothing in stock",
    computeCoverage([makeItem({ id: "oos", inStock: false })]).gaps.some((g) => g.code === "no-in-stock"),
  );
  check(
    "coverage does not flag same-brand for a single item",
    !computeCoverage([makeItem({ id: "one" })]).gaps.some((g) => g.code === "all-same-brand"),
  );

  // ---- sampler ----
  const sampleFeed = [
    makeItem({ id: "f1", category: "flower", brand: "Acme" }),
    makeItem({ id: "f2", category: "flower", brand: "Acme" }),
    makeItem({ id: "f3", category: "flower", brand: "Acme" }),
    makeItem({ id: "e1", category: "edible-solid", brand: "Bravo" }),
    makeItem({ id: "c1", category: "cartridge", brand: "Cobalt" }),
  ];
  const sample = buildRepresentativeSample(sampleFeed, 3);
  check("sampler respects the limit", sample.length === 3);
  check(
    "sampler spans categories rather than taking the first three",
    new Set(sample.map((i) => i.category)).size === 3,
  );
  check(
    "sampler is deterministic",
    buildRepresentativeSample(sampleFeed, 3).map((i) => i.id).join(",") ===
      buildRepresentativeSample(sampleFeed, 3).map((i) => i.id).join(","),
  );
  check("sampler handles limit 0", buildRepresentativeSample(sampleFeed, 0).length === 0);
  check("sampler handles a negative limit", buildRepresentativeSample(sampleFeed, -5).length === 0);
  check("sampler handles an empty feed", buildRepresentativeSample([], 5).length === 0);
  check(
    "sampler never exceeds the feed size",
    buildRepresentativeSample(sampleFeed, 99).length === sampleFeed.length,
  );
  check(
    "sampler returns no duplicates",
    (() => {
      const got = buildRepresentativeSample(sampleFeed, 5);
      return new Set(got.map((i) => i.id)).size === got.length;
    })(),
  );
  check(
    "sampler prefers a multi-size product",
    buildRepresentativeSample(
      [
        makeItem({ id: "s1", category: "flower" }),
        makeItem({
          id: "s2",
          category: "flower",
          variants: [
            { id: "a", label: "1g", priceMinorUnits: 100, inStock: true, inventoryLevel: 1 },
            { id: "b", label: "2g", priceMinorUnits: 200, inStock: true, inventoryLevel: 1 },
          ],
        }),
      ],
      1,
    )[0]?.id === "s2",
  );
  check(
    "sampler prefers an in-stock product over an out-of-stock one",
    buildRepresentativeSample(
      [makeItem({ id: "oos", inStock: false }), makeItem({ id: "ins", inStock: true })],
      1,
    )[0]?.id === "ins",
  );
  check(
    "sampler still returns something when everything is out of stock",
    buildRepresentativeSample([makeItem({ id: "o1", inStock: false })], 1).length === 1,
  );

  // ---- HAZARD 1: method coercion ----
  check(
    "POST on a partial selection is coerced to PUT",
    selectionMethod({ requested: "POST", selectedCount: 10, feedCount: 100 }).method === "PUT",
  );
  check(
    "the coercion is reported",
    selectionMethod({ requested: "POST", selectedCount: 10, feedCount: 100 }).coerced === true,
  );
  check(
    "POST on the whole feed is allowed",
    selectionMethod({ requested: "POST", selectedCount: 100, feedCount: 100 }).method === "POST",
  );
  check(
    "POST on the whole feed is not reported as coerced",
    selectionMethod({ requested: "POST", selectedCount: 100, feedCount: 100 }).coerced === false,
  );
  check(
    "PUT is never coerced",
    selectionMethod({ requested: "PUT", selectedCount: 10, feedCount: 100 }).coerced === false,
  );
  check(
    "a single item out of many is coerced",
    selectionMethod({ requested: "POST", selectedCount: 1, feedCount: 2562 }).method === "PUT",
  );
  // An empty feed must not be mistaken for "whole feed" — 0 >= 0 is true and
  // would wrongly authorise POST.
  check(
    "an empty feed does not authorise POST",
    selectionMethod({ requested: "POST", selectedCount: 0, feedCount: 0 }).method === "PUT",
  );

  // ---- plans ----
  const partial = planSelectionPush({
    selected: feed.slice(0, 2),
    feedCount: 2562,
    requestedMethod: "POST",
  });
  check("partial plan is ok", partial.ok === true);
  check("partial plan uses PUT", partial.method === "PUT");
  check("partial plan reports the coercion", partial.methodWasCoerced === true);
  check("HAZARD 2: partial plan does not write sync state", partial.writesSyncState === false);
  check("HAZARD 3: partial plan never deletes", partial.emitsDeletes === false);
  check("partial plan carries the ids", partial.ids.join(",") === "a,b");
  check("partial plan is not whole-feed", partial.isWholeFeed === false);
  check("partial plan explains itself", partial.summary.includes("2 items of 2562"));
  check("coercion description is produced", (describeMethodCoercion(partial) ?? "").includes("PUT"));
  check(
    "coercion description names the number that would be deleted",
    (describeMethodCoercion(partial) ?? "").includes("2560"),
  );

  const wholeFeedPlan = planSelectionPush({
    selected: feed,
    feedCount: 3,
    requestedMethod: "POST",
  });
  check("whole-feed plan keeps POST", wholeFeedPlan.method === "POST");
  check("whole-feed plan is marked whole", wholeFeedPlan.isWholeFeed === true);
  check("whole-feed plan writes sync state", wholeFeedPlan.writesSyncState === true);
  check(
    "NEGATIVE CONTROL: no coercion banner on a whole-feed push",
    describeMethodCoercion(wholeFeedPlan) === null,
  );

  const emptyPlan = planSelectionPush({ selected: [], feedCount: 100, requestedMethod: "PUT" });
  check("empty plan is refused", emptyPlan.ok === false);
  check("empty plan names the reason", emptyPlan.refusals[0]?.code === "empty-selection");

  const tooMany = planSelectionPush({
    selected: Array.from({ length: TARGETED_PUSH_MAX_ITEMS + 1 }, (_, i) =>
      makeItem({ id: `big-${i}` }),
    ),
    feedCount: 5000,
    requestedMethod: "PUT",
  });
  check("oversized plan is refused", tooMany.ok === false);
  check("oversized plan names the reason", tooMany.refusals[0]?.code === "too-many-items");
  check(
    "oversized refusal points at the full sync button",
    (tooMany.refusals[0]?.message ?? "").includes("full sync"),
  );
  const atLimit = planSelectionPush({
    selected: Array.from({ length: TARGETED_PUSH_MAX_ITEMS }, (_, i) => makeItem({ id: `ok-${i}` })),
    feedCount: 5000,
    requestedMethod: "PUT",
  });
  check("NEGATIVE CONTROL: exactly at the limit is allowed", atLimit.ok === true);

  // ---- presets ----
  check("presets exist", SELECTION_PRESETS.length >= 5);
  check("preset ids are unique", new Set(SELECTION_PRESETS.map((p) => p.id)).size === SELECTION_PRESETS.length);
  check("every preset has a description", SELECTION_PRESETS.every((p) => p.description.length > 10));
  check(
    "every preset spec is applicable without throwing",
    SELECTION_PRESETS.every((p) => Array.isArray(selectItems(feed, p.spec, p.sort))),
  );

  console.log(`leafly selection-core self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
