/**
 * src/lib/menu/menu-category-override-core.ts
 *
 * PURE core for the live-menu per-product category override overlay (Option A).
 *
 * When the owner re-files ONE product's website category from the Inventory
 * Detail corrections section, that choice is stored in
 * product_classification_overrides (migration 0150) and must win on the public
 * menu too — otherwise the card would keep the auto-resolved category. This
 * core does the read-time swap on an already-built GreenwayMenuItem list:
 *
 *   - only a VALID GreenwayCategory override is applied (unknown values are
 *     ignored, so a stale/foreign value can never break the menu);
 *   - a no-op override (same as the current category) leaves the item as-is;
 *   - when the category changes, filterCategories is recomputed with the SAME
 *     fan-out rules the import transform uses (transform.ts filterCategoriesFor)
 *     so the menu's category filter treats the re-filed card consistently.
 *
 * NEVER touches CCRS/LCB fields (posInventoryType / posInventoryCategory are
 * read-only inputs to the fan-out, never mutated). Server-free + deterministic.
 */
import type { GreenwayCategory, GreenwayMenuItem } from "@/lib/leafly/types";
import { websiteCategories } from "@/lib/pos/category-taxonomy";

const VALID = new Set<string>(websiteCategories);

/** True when `value` is a real website category value. */
export function isValidWebsiteCategory(value: string | null | undefined): value is GreenwayCategory {
  return typeof value === "string" && VALID.has(value);
}

/**
 * Recompute filterCategories for an item whose primary category is `category`.
 * Mirrors transform.ts `filterCategoriesFor`: the primary category plus the
 * cross-listing fan-out (carts→concentrate, packs→singles, popcorn/infused→
 * flower, and the raw-POS-category extras). posInventoryCategory is the raw LCB
 * label and is only READ.
 */
export function filterCategoriesForOverride(
  category: GreenwayCategory,
  posInventoryCategory?: string | null,
): GreenwayCategory[] {
  const cats = new Set<GreenwayCategory>([category]);
  const rawCategory = (posInventoryCategory ?? "").replace(/\s+/g, " ").trim();
  if (category === "cartridge" || category === "disposable-cartridge") cats.add("concentrate");
  if (category === "preroll-pack") cats.add("preroll");
  if (category === "popcorn-bud") cats.add("flower");
  if (category === "infused-flower") {
    cats.add("concentrate");
    cats.add("flower");
  }
  if (rawCategory === "Blunt") cats.add("blunt");
  if (rawCategory === "Infused Blunt") cats.add("infused-blunt");
  if (rawCategory === "Tincture") cats.add("tincture");
  if (rawCategory === "RSO") cats.add("rso");
  return [...cats];
}

/**
 * Apply per-product category overrides to a menu-item list. `overrides` maps
 * item.id (= pos_product_key = source_item_id) → the raw override category
 * value (may be null/invalid). Returns a NEW array; unchanged items are
 * referentially identical so React/serialization stay cheap.
 */
export function applyCategoryOverrides(
  items: GreenwayMenuItem[],
  overrides: Map<string, string | null>,
): GreenwayMenuItem[] {
  if (overrides.size === 0) return items;
  return items.map((item) => {
    const raw = overrides.get(item.id);
    if (!isValidWebsiteCategory(raw)) return item; // no / invalid override
    if (raw === item.category) return item; // no-op
    return {
      ...item,
      category: raw,
      filterCategories: filterCategoriesForOverride(raw, item.posInventoryCategory),
    };
  });
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

export function __runMenuCategoryOverrideCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL menu-category-override-core: " + msg);
    passed += 1;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  const base: GreenwayMenuItem = {
    id: "SKU-1",
    name: "Test Item",
    brand: "Test Brand",
    category: "concentrate",
    strainType: "hybrid",
    thc: null,
    cbd: null,
    totalThc: null,
    totalCbd: null,
    variants: [],
    inventoryStatus: "in-stock",
  } as unknown as GreenwayMenuItem;

  // Empty override map → same array reference.
  const noop = applyCategoryOverrides([base], new Map());
  ok(noop[0] === base, "empty overrides → identity");

  // Valid override changes category AND recomputes filterCategories.
  const changed = applyCategoryOverrides([base], new Map([["SKU-1", "cartridge"]]));
  ok(changed[0] !== base, "override → new object");
  eq(changed[0].category, "cartridge", "override applied");
  eq(
    [...(changed[0].filterCategories ?? [])].sort(),
    ["cartridge", "concentrate"].sort(),
    "cartridge cross-lists to concentrate",
  );

  // Invalid override value is ignored (menu can never break).
  const bad = applyCategoryOverrides([base], new Map([["SKU-1", "not-a-real-category"]]));
  ok(bad[0] === base, "invalid override ignored");

  // Null override ignored.
  const nul = applyCategoryOverrides([base], new Map([["SKU-1", null]]));
  ok(nul[0] === base, "null override ignored");

  // No-op override (same category) leaves the item referentially identical.
  const same = applyCategoryOverrides([base], new Map([["SKU-1", "concentrate"]]));
  ok(same[0] === base, "same-value override → identity");

  // Only the targeted item changes; others pass through untouched.
  const other = { ...base, id: "SKU-2" } as GreenwayMenuItem;
  const mixed = applyCategoryOverrides([base, other], new Map([["SKU-2", "flower"]]));
  ok(mixed[0] === base, "untargeted item untouched");
  eq(mixed[1].category, "flower", "targeted item changed");

  // filterCategories fan-out rules.
  eq(
    filterCategoriesForOverride("preroll-pack").sort(),
    ["preroll", "preroll-pack"].sort(),
    "preroll-pack → +preroll",
  );
  eq(
    filterCategoriesForOverride("popcorn-bud").sort(),
    ["flower", "popcorn-bud"].sort(),
    "popcorn-bud → +flower",
  );
  eq(
    filterCategoriesForOverride("infused-flower").sort(),
    ["concentrate", "flower", "infused-flower"].sort(),
    "infused-flower → +concentrate,+flower",
  );
  eq(
    filterCategoriesForOverride("flower", "Blunt").sort(),
    ["blunt", "flower"].sort(),
    "raw POS Blunt cross-lists",
  );
  eq(filterCategoriesForOverride("flower").sort(), ["flower"], "plain flower → self only");

  return { passed };
}
