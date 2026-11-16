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

/**
 * D246 — apply the owner's saved re-files (product_classification_overrides
 * rows) to a menu list in ONE step: category first (it decides the fan-out
 * base), then the type label. This is the single function BOTH the public
 * overlay (withCategoryOverride) and the register / order-pricing loader
 * (live-menu.ts loadLiveMenuAll) use, so a product re-filed in the back office
 * reads the same on the website, on the register, and in the legal-limit
 * check. Before D246 only the website applied it: a full-flower 20-pack the
 * owner re-filed from "infused-preroll" to "preroll" still rang up on the
 * register as a 7 g concentrate.
 */
export type OverrideRowLike = {
  pos_product_key: string;
  website_category: string | null;
  house_type: string | null;
};
export function applyClassificationOverrideRows(
  items: GreenwayMenuItem[],
  rows: Iterable<OverrideRowLike>,
): GreenwayMenuItem[] {
  const cats = new Map<string, string | null>();
  const types = new Map<string, string | null>();
  for (const r of rows) {
    if (!r || typeof r.pos_product_key !== "string" || !r.pos_product_key.trim()) continue;
    cats.set(r.pos_product_key, r.website_category);
    types.set(r.pos_product_key, r.house_type);
  }
  if (cats.size === 0) return items;
  return applyHouseTypeOverrides(applyCategoryOverrides(items, cats), types);
}

/**
 * D246 — where the register's category for a product comes from, in words the
 * back office can show next to the legal-limit bucket. Pure.
 */
export type RegisterCategorySource = "override" | "menu" | "none";
export function registerCategoryFor(input: {
  menuCategory: string | null | undefined;
  overrideCategory: string | null | undefined;
}): { category: string | null; source: RegisterCategorySource } {
  if (isValidWebsiteCategory(input.overrideCategory)) return { category: input.overrideCategory, source: "override" };
  const m = (input.menuCategory ?? "").trim();
  if (m) return { category: m, source: "menu" };
  return { category: null, source: "none" };
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------
/**
 * R33 — the owner's per-product TYPE override (product_classification_overrides
 * .house_type, set from the lot page's "Website Type & Category" section) on
 * the live menu. Before R33 the override was saved, audited and shown back in
 * the admin, but nothing on the customer site ever read it: the card and the
 * product page kept the type stamped at onboarding.
 *
 * A house type is a merchandising LABEL ("Live Resin", "Popcorn Bud") that
 * onboarding already writes into menu_items.pos_inventory_category
 * (draft-injection-core: `pos_inventory_category: houseType`) and that
 * cardTypeLabel / the menu's type filters read. So the override lands on the
 * same field, read-time only (the database row is never written here).
 *
 * Rules: a blank / null override is "no override" (the onboarding type
 * stays); same text (trimmed) is a no-op that keeps the item referentially
 * identical; a real change recomputes filterCategories with the same fan-out
 * as a category override, because the raw-label cross-listings (Blunt, RSO,
 * Tincture ...) depend on this label. Labels are capped at 80 chars.
 */
export function applyHouseTypeOverrides(
  items: GreenwayMenuItem[],
  overrides: Map<string, string | null>,
): GreenwayMenuItem[] {
  if (overrides.size === 0) return items;
  return items.map((item) => {
    const raw = (overrides.get(item.id) ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!raw) return item;
    if (raw === (item.posInventoryCategory ?? "").trim()) return item;
    return {
      ...item,
      posInventoryCategory: raw,
      filterCategories: filterCategoriesForOverride(item.category, raw),
    };
  });
}

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

  // R33: house-type overrides (the TYPE half of the owner's re-file).
  const typed = { ...base, category: "flower", posInventoryCategory: "Flower", filterCategories: ["flower"] } as GreenwayMenuItem;
  ok(applyHouseTypeOverrides([typed], new Map())[0] === typed, "R33 empty type map → identity");
  const popcorn = applyHouseTypeOverrides([typed], new Map([["SKU-1", "Popcorn Bud"]]));
  eq(popcorn[0].posInventoryCategory, "Popcorn Bud", "R33 type override lands on posInventoryCategory");
  eq(popcorn[0].category, "flower", "R33 type override never changes the website category");
  ok(applyHouseTypeOverrides([typed], new Map([["SKU-1", null]]))[0] === typed, "R33 null type = no override");
  ok(applyHouseTypeOverrides([typed], new Map([["SKU-1", "   "]]))[0] === typed, "R33 blank type = no override");
  ok(applyHouseTypeOverrides([typed], new Map([["SKU-1", " Flower "]]))[0] === typed, "R33 same type (trimmed) = no-op");
  ok(applyHouseTypeOverrides([typed], new Map([["OTHER", "Shake"]]))[0] === typed, "R33 other id untouched");
  const blunt = applyHouseTypeOverrides([typed], new Map([["SKU-1", "Blunt"]]));
  eq([...(blunt[0].filterCategories ?? [])].sort(), ["blunt", "flower"], "R33 type change recomputes the raw-label fan-out");
  eq(applyHouseTypeOverrides([typed], new Map([["SKU-1", "x".repeat(200)]]))[0].posInventoryCategory?.length, 80, "R33 label capped at 80");
  eq(applyHouseTypeOverrides([typed], new Map([["SKU-1", "Live   Resin"]]))[0].posInventoryCategory, "Live Resin", "R33 whitespace collapsed");

  // D246: one-step row overlay (register + website share it).
  const pre = { ...base, id: "21575412712446329", category: "infused-preroll", posInventoryCategory: "Infused Pre-roll", filterCategories: ["infused-preroll"] } as GreenwayMenuItem;
  const fixedRows = applyClassificationOverrideRows([pre], [{ pos_product_key: "21575412712446329", website_category: "preroll", house_type: null }]);
  eq(fixedRows[0].category, "preroll", "D246 row overlay re-files infused-preroll -> preroll");
  eq(fixedRows[0].posInventoryCategory, "Infused Pre-roll", "D246 null house_type keeps the type label");
  ok(applyClassificationOverrideRows([pre], [])[0] === pre, "D246 no rows -> identity");
  ok(applyClassificationOverrideRows([pre], [{ pos_product_key: "OTHER", website_category: "preroll", house_type: null }])[0] === pre, "D246 other key untouched");
  ok(applyClassificationOverrideRows([pre], [{ pos_product_key: "21575412712446329", website_category: "not-a-cat", house_type: null }])[0] === pre, "D246 invalid category ignored");
  const both = applyClassificationOverrideRows([pre], [{ pos_product_key: "21575412712446329", website_category: "preroll-pack", house_type: "Pre-roll Pack" }]);
  eq([both[0].category, both[0].posInventoryCategory], ["preroll-pack", "Pre-roll Pack"], "D246 category + type together");
  ok(applyClassificationOverrideRows([pre], [{ pos_product_key: "  ", website_category: "preroll", house_type: null }])[0] === pre, "D246 blank key skipped");
  eq(registerCategoryFor({ menuCategory: "infused-preroll", overrideCategory: "preroll" }), { category: "preroll", source: "override" }, "D246 override wins");
  eq(registerCategoryFor({ menuCategory: "infused-preroll", overrideCategory: "bogus" }), { category: "infused-preroll", source: "menu" }, "D246 invalid override -> menu");
  eq(registerCategoryFor({ menuCategory: null, overrideCategory: null }), { category: null, source: "none" }, "D246 nothing -> none");

  return { passed };
}
