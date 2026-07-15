/**
 * POS Slice B36 — sale-screen product grid helpers (pure).
 *
 * The sale screen shows products as a Square/Shopify-style TILE GRID with a
 * category filter row (Toast's menu groups). Two things must be deterministic
 * and shared so every register looks identical:
 *
 *  - Category → color: a stable hash so "flower" is ALWAYS the same color on
 *    every device, every session, with no server round-trip and no config to
 *    maintain. New categories get a color automatically.
 *  - Category chips + filtering: which chips show, in what order, and how the
 *    chip + search query combine.
 *
 * Pure: no imports, no I/O — self-tested below and mirrored in vitest.
 */

import { searchProducts, type PosMenuProduct } from "./sale-flow-core";

/**
 * Number of distinct chip colors the UI defines. The UI maps each index to a
 * Tailwind class set (border/text/dot). Keep in sync with CATEGORY_TILE_STYLES
 * in SaleFlow.tsx — the self-tests pin this value so a mismatch fails loudly.
 */
export const CATEGORY_COLOR_COUNT = 8;

/**
 * Deterministic category → palette index. djb2 over the trimmed, lowercased
 * slug: stable across sessions/devices, well-spread for short strings, and
 * intentionally NOT locale-sensitive. Blank input maps to 0.
 */
export function categoryColorIndex(category: string, paletteSize: number = CATEGORY_COLOR_COUNT): number {
  const size = Number.isInteger(paletteSize) && paletteSize > 0 ? paletteSize : CATEGORY_COLOR_COUNT;
  const slug = category.trim().toLowerCase();
  if (!slug) return 0;
  let hash = 5381;
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash << 5) + hash + slug.charCodeAt(i)) | 0; // hash * 33 + c, 32-bit
  }
  return Math.abs(hash) % size;
}

export type CategoryChip = {
  /** The category value as it appears on products (original casing of the first occurrence). */
  category: string;
  /** How many sellable menu entries carry it (chips sort by this, busiest first). */
  count: number;
};

/**
 * The filter chips for a menu: unique categories with counts, busiest first
 * (ties alphabetical) — the categories a budtender reaches for most sit
 * closest to "All". Categories are matched case-insensitively; the first
 * occurrence's casing is displayed. Blank categories are skipped.
 */
export function menuCategoryChips(products: PosMenuProduct[]): CategoryChip[] {
  const byKey = new Map<string, CategoryChip>();
  for (const p of products) {
    const raw = (p.category ?? "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const hit = byKey.get(key);
    if (hit) hit.count += 1;
    else byKey.set(key, { category: raw, count: 1 });
  }
  return [...byKey.values()].sort(
    (a, b) => b.count - a.count || a.category.localeCompare(b.category),
  );
}

/**
 * Combine the search query with the active category chip. Category matches
 * case-insensitively against the product's primary category; null = "All".
 * Search semantics are EXACTLY the existing searchProducts (every token must
 * hit name/brand/category/variant) so scanning/search behavior is unchanged.
 */
export function filterMenuProducts(
  products: PosMenuProduct[],
  query: string,
  category: string | null,
): PosMenuProduct[] {
  const searched = searchProducts(products, query);
  if (!category) return searched;
  const key = category.trim().toLowerCase();
  if (!key) return searched;
  return searched.filter((p) => (p.category ?? "").trim().toLowerCase() === key);
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runSaleGridCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const check = (name: string, cond: boolean) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.error(`  FAIL sale-grid-core: ${name}`);
    }
  };

  const prod = (over: Partial<PosMenuProduct>): PosMenuProduct => ({
    productId: "p1",
    variantId: "v1",
    name: "Blue Dream",
    brand: "Farm",
    category: "flower",
    categories: ["flower"],
    variantLabel: "3.5g",
    regularPriceMinor: 3000,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
    ...over,
  });

  // categoryColorIndex — deterministic, case/whitespace-insensitive, in range.
  check("color: deterministic", categoryColorIndex("flower") === categoryColorIndex("flower"));
  check("color: case-insensitive", categoryColorIndex("Flower") === categoryColorIndex("flower"));
  check("color: trims", categoryColorIndex("  flower  ") === categoryColorIndex("flower"));
  check("color: blank -> 0", categoryColorIndex("") === 0 && categoryColorIndex("   ") === 0);
  const cats = ["flower", "pre-rolls", "vapor", "edibles", "concentrates", "topicals", "tinctures", "cbd", "accessories", "beverages"];
  check(
    "color: always in range",
    cats.every((c) => {
      const i = categoryColorIndex(c);
      return Number.isInteger(i) && i >= 0 && i < CATEGORY_COLOR_COUNT;
    }),
  );
  check(
    "color: spreads (>=4 distinct over 10 common categories)",
    new Set(cats.map((c) => categoryColorIndex(c))).size >= 4,
  );
  check("color: bad palette size falls back", categoryColorIndex("flower", 0) === categoryColorIndex("flower"));
  check("color: custom palette respected", categoryColorIndex("flower", 3) >= 0 && categoryColorIndex("flower", 3) < 3);

  // menuCategoryChips — unique, counted, busiest-first, blanks skipped.
  const menu = [
    prod({ variantId: "a", category: "flower" }),
    prod({ variantId: "b", category: "Flower" }),
    prod({ variantId: "c", category: "vapor" }),
    prod({ variantId: "d", category: "edibles" }),
    prod({ variantId: "e", category: "edibles" }),
    prod({ variantId: "f", category: "edibles" }),
    prod({ variantId: "g", category: "  " }),
  ];
  const chips = menuCategoryChips(menu);
  check("chips: unique case-insensitive", chips.length === 3);
  check("chips: busiest first", chips[0]?.category === "edibles" && chips[0]?.count === 3);
  check("chips: merged casing counts", chips[1]?.category === "flower" && chips[1]?.count === 2);
  check("chips: blank skipped", chips.every((c) => c.category.trim().length > 0));
  check(
    "chips: tie breaks alphabetical",
    (() => {
      const tied = menuCategoryChips([prod({ variantId: "x", category: "zed" }), prod({ variantId: "y", category: "alpha" })]);
      return tied[0]?.category === "alpha" && tied[1]?.category === "zed";
    })(),
  );
  check("chips: empty menu -> none", menuCategoryChips([]).length === 0);

  // filterMenuProducts — chip + query combine; search semantics unchanged.
  check("filter: null category = all", filterMenuProducts(menu, "", null).length === 7);
  check("filter: category narrows", filterMenuProducts(menu, "", "edibles").length === 3);
  check("filter: category case-insensitive", filterMenuProducts(menu, "", "FLOWER").length === 2);
  check("filter: blank category = all", filterMenuProducts(menu, "", "  ").length === 7);
  check(
    "filter: query + category combine",
    (() => {
      const m = [
        prod({ variantId: "a", name: "Blue Dream", category: "flower" }),
        prod({ variantId: "b", name: "Blue Razz Gummy", category: "edibles" }),
      ];
      const hits = filterMenuProducts(m, "blue", "edibles");
      return hits.length === 1 && hits[0]?.variantId === "b";
    })(),
  );
  check("filter: no match -> empty", filterMenuProducts(menu, "zzzznope", null).length === 0);

  console.log(`sale-grid-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`sale-grid-core: ${fail} failure(s)`);
}
