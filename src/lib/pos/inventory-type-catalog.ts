/**
 * src/lib/pos/inventory-type-catalog.ts  (Slice 57)
 *
 * The canonical catalog of POS inventory TYPES Greenway sees, each mapped to the
 * website category it rolls up to. This is the single source of truth used to
 * PRELOAD the "Inventory Types" tab so it is populated out of the box (BHO,
 * Crumble, Rosin, …) — mirroring how the Website Categories tab is always
 * preloaded from the hardcoded taxonomy.
 *
 * GROUNDED IN FACT: every entry below is taken verbatim from CATEGORY_MAP in
 * src/lib/pos/transform.ts — the authoritative mapping the POS import pipeline
 * uses to route real Cultivera/POS inventory-type strings onto website
 * categories. This module is a PURE, dependency-free copy (transform.ts imports
 * xlsx/crypto, so we don't import it here) kept deliberately in lock-step; a
 * unit test asserts the two never drift.
 *
 * No I/O. tsx-unit-testable.
 */
import { websiteCategoryDefinitions } from "@/lib/pos/category-taxonomy";

export type InventoryTypeCatalogEntry = {
  /** The POS inventory-type label exactly as it arrives (e.g. "BHO"). */
  label: string;
  /** The website category value it maps to (e.g. "concentrate"). */
  websiteCategory: string;
};

/**
 * Canonical inventory-type → website-category catalog.
 *
 * Must stay identical to CATEGORY_MAP in transform.ts. Keys are the POS labels;
 * values are website category `value`s from category-taxonomy.ts.
 */
export const INVENTORY_TYPE_CATALOG: InventoryTypeCatalogEntry[] = [
  { label: "Flower", websiteCategory: "flower" },
  { label: "Pre-roll", websiteCategory: "preroll" },
  { label: "Blunt", websiteCategory: "preroll" },
  { label: "Infused Pre-roll", websiteCategory: "infused-preroll" },
  { label: "Infused Blunt", websiteCategory: "infused-preroll" },
  { label: "Cartridge", websiteCategory: "cartridge" },
  { label: "Disposable Cartridge", websiteCategory: "disposable-cartridge" },
  { label: "Rosin", websiteCategory: "concentrate" },
  { label: "Hash Rosin", websiteCategory: "concentrate" },
  { label: "Live Resin", websiteCategory: "concentrate" },
  { label: "BHO", websiteCategory: "concentrate" },
  { label: "Badder", websiteCategory: "concentrate" },
  { label: "Bubble Hash", websiteCategory: "concentrate" },
  { label: "Hash", websiteCategory: "concentrate" },
  { label: "Shatter", websiteCategory: "concentrate" },
  { label: "Sugar", websiteCategory: "concentrate" },
  { label: "Distillate", websiteCategory: "concentrate" },
  { label: "Moon Rocks", websiteCategory: "infused-flower" },
  { label: "RSO", websiteCategory: "concentrate" },
  { label: "Edible", websiteCategory: "edible-solid" },
  { label: "Gummies", websiteCategory: "edible-solid" },
  { label: "Chocolate", websiteCategory: "edible-solid" },
  { label: "Fruit Chews", websiteCategory: "edible-solid" },
  { label: "Chewees", websiteCategory: "edible-solid" },
  { label: "Mints", websiteCategory: "edible-solid" },
  { label: "Capsule", websiteCategory: "edible-solid" },
  { label: "Beverage", websiteCategory: "edible-liquid" },
  { label: "Shots", websiteCategory: "edible-liquid" },
  { label: "Soda", websiteCategory: "edible-liquid" },
  { label: "Liquid Infused Edible", websiteCategory: "edible-liquid" },
  { label: "Tincture", websiteCategory: "edible-liquid" },
  { label: "Topical", websiteCategory: "topical" },
  { label: "Bath Salts", websiteCategory: "topical" },
  { label: "Roll On", websiteCategory: "topical" },
  { label: "Trim", websiteCategory: "trim" },
  { label: "Popcorn Bud", websiteCategory: "popcorn-bud" },
  { label: "Balls", websiteCategory: "edible-solid" },
  { label: "Bites", websiteCategory: "edible-solid" },
  { label: "Hard Candy", websiteCategory: "edible-solid" },
  { label: "Marmas", websiteCategory: "edible-solid" },
  { label: "Minis", websiteCategory: "edible-solid" },
  { label: "Panda Candies", websiteCategory: "edible-solid" },
  { label: "Peanut Butter Cups", websiteCategory: "edible-solid" },
  { label: "Crumble", websiteCategory: "concentrate" },
  { label: "Diamonds", websiteCategory: "concentrate" },
  { label: "Loud Resin", websiteCategory: "concentrate" },
  { label: "Terp Crystals", websiteCategory: "concentrate" },
  { label: "Terp Sauce", websiteCategory: "concentrate" },
  { label: "THCa", websiteCategory: "concentrate" },
  { label: "Mix Infused Flower", websiteCategory: "infused-flower" },
  { label: "Live Resin Cartridge", websiteCategory: "cartridge" },
  { label: "Pod", websiteCategory: "cartridge" },
  { label: "Other Liquid Edible", websiteCategory: "edible-liquid" },
];

/**
 * Canonicalize a POS label into the matching key used by inventory_types rows.
 *
 * GROUNDED IN FACT: this MUST match the key scheme the rest of the system uses so
 * catalog presets dedupe correctly against real DB rows. Two places define that
 * scheme and both use `lower(trim(...))` (space-preserving, NOT a dash-slug):
 *   - migration 0035 backfill: `lower(trim(category))`
 *   - types-store.normalizeInventoryTypeKey: `raw.trim().toLowerCase()`
 * We deliberately mirror that here (collapsing internal whitespace runs to a
 * single space) so e.g. "Live Resin" → "live resin" and "BHO" → "bho".
 */
export function inventoryTypeKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

export type CatalogGroup = {
  category: string;
  categoryLabel: string;
  types: InventoryTypeCatalogEntry[];
};

/**
 * Group the catalog by website category, ordered by the taxonomy's own order so
 * the table reads top-to-bottom like the public menu. Types are alphabetized
 * within each group. Any category present in the catalog but not in the taxonomy
 * is appended at the end (defensive — should not happen while the test passes).
 */
export function groupCatalogByCategory(
  entries: InventoryTypeCatalogEntry[] = INVENTORY_TYPE_CATALOG,
): CatalogGroup[] {
  const order = websiteCategoryDefinitions.map((c) => c.value as string);
  const labelOf = new Map(websiteCategoryDefinitions.map((c) => [c.value as string, c.label]));
  const byCat = new Map<string, InventoryTypeCatalogEntry[]>();
  for (const e of entries) {
    const list = byCat.get(e.websiteCategory) ?? [];
    list.push(e);
    byCat.set(e.websiteCategory, list);
  }
  const seen = new Set<string>();
  const groups: CatalogGroup[] = [];
  const push = (cat: string) => {
    const types = byCat.get(cat);
    if (!types || seen.has(cat)) return;
    seen.add(cat);
    groups.push({
      category: cat,
      categoryLabel: labelOf.get(cat) ?? cat,
      types: [...types].sort((a, b) => a.label.localeCompare(b.label)),
    });
  };
  for (const cat of order) push(cat);
  for (const cat of byCat.keys()) push(cat); // any stragglers
  return groups;
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE). NOTE: this test cannot import transform.ts
// (it pulls in xlsx), so drift-protection is enforced by a separate script test
// that reads transform.ts as text.
// ---------------------------------------------------------------------------

export function __runInventoryCatalogTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    pass += 1;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  // Known ground-truth entries the owner named explicitly.
  const byLabel = new Map(INVENTORY_TYPE_CATALOG.map((e) => [e.label, e.websiteCategory]));
  eq(byLabel.get("BHO"), "concentrate", "BHO → concentrate");
  eq(byLabel.get("Crumble"), "concentrate", "Crumble → concentrate");
  eq(byLabel.get("Rosin"), "concentrate", "Rosin → concentrate");
  eq(byLabel.get("Flower"), "flower", "Flower → flower");
  eq(byLabel.get("Moon Rocks"), "infused-flower", "Moon Rocks → infused-flower");
  eq(byLabel.get("Live Resin Cartridge"), "cartridge", "LRC → cartridge");

  // No duplicate labels.
  ok(byLabel.size === INVENTORY_TYPE_CATALOG.length, "no duplicate labels");

  // Every mapped category exists in the taxonomy.
  const taxonomy = new Set(websiteCategoryDefinitions.map((c) => c.value as string));
  for (const e of INVENTORY_TYPE_CATALOG) {
    ok(taxonomy.has(e.websiteCategory), `category ${e.websiteCategory} exists in taxonomy`);
  }

  // Keys are canonical + unique.
  const keys = INVENTORY_TYPE_CATALOG.map((e) => inventoryTypeKey(e.label));
  ok(new Set(keys).size === keys.length, "keys unique");
  // Keys mirror the DB scheme lower(trim()) — space-preserving, NOT dash-slug.
  eq(inventoryTypeKey("Live Resin Cartridge"), "live resin cartridge", "key = lower(trim)");
  eq(inventoryTypeKey("Pre-roll"), "pre-roll", "existing hyphen preserved");
  eq(inventoryTypeKey("BHO"), "bho", "uppercase lowered");
  eq(inventoryTypeKey("  Moon   Rocks "), "moon rocks", "whitespace collapsed + trimmed");

  // Grouping: concentrate group is the biggest and alphabetized.
  const groups = groupCatalogByCategory();
  const conc = groups.find((g) => g.category === "concentrate");
  ok(conc !== undefined, "concentrate group present");
  ok((conc?.types.length ?? 0) >= 14, "concentrate has many types");
  const labels = conc?.types.map((t) => t.label) ?? [];
  eq([...labels].sort((a, b) => a.localeCompare(b)), labels, "concentrate alphabetized");

  console.log(`inventory-type-catalog: ${pass} assertions passed`);
}
