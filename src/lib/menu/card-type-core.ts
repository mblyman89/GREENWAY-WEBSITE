/**
 * src/lib/menu/card-type-core.ts
 *
 * SLICE 49 (owner card-layout request) — the product TYPE line shown directly
 * under the brand/vendor label at the top of every product card (and mirrored
 * on the product detail page).
 *
 * Owner's layout: brand/vendor at top, product TYPE below it, picture, simple
 * name, strain type, cannabinoids, price box (weight lives in the price box).
 * The type used to be appended to the END of the display name ("Marker
 * Cartridge"); it now gets its own line so the name stays simple.
 *
 * Source of the label (verified in transform.ts):
 *   - `posInventoryCategory` carries the POS "Category" column — the human
 *     product type ("Live Resin", "Gummies", "Flower", "Cartridge").
 *   - When that is blank we fall back to the WEBSITE category formatted for
 *     humans, via the same aliases the card mockup uses ("Vape", "Edible",
 *     "Drink") so both labels always agree.
 *
 * PURE: no I/O, no React — tsx-unit-testable and registered in the pure
 * self-test runner.
 */
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";

/** Item shape needed to derive the type line (subset of GreenwayMenuItem). */
export type CardTypeSource = {
  posInventoryCategory?: string | null;
  category: string;
};

/**
 * Friendly aliases for website categories — IDENTICAL to the card mockup's
 * `categoryAliases` in ProductCardVisual.tsx so the fallback label matches the
 * label printed on the mockup packaging. Kept here (pure) as the single copy;
 * ProductCardVisual imports it from this module.
 */
export const CARD_CATEGORY_ALIASES: Record<string, string> = {
  "preroll-pack": "Preroll",
  preroll: "Preroll",
  "infused-preroll": "Preroll",
  "infused-preroll-pack": "Preroll",
  "disposable-cartridge": "Vape",
  cartridge: "Vape",
  "edible-solid": "Edible",
  "edible-liquid": "Drink",
  paraphernalia: "Accessory",
};

/** Website-category fallback label ("Vape", "Edible", "Flower"). */
export function websiteCategoryCardLabel(category: string): string {
  return CARD_CATEGORY_ALIASES[category] ?? formatWebsiteCategory(category);
}

/**
 * The product-type line for the card. Prefers the descriptive POS category
 * ("Live Resin", "Gummies"); falls back to the website category label. Never
 * empty — every product has a website category, so every card gets a type.
 */
export function cardTypeLabel(item: CardTypeSource): string {
  const raw = (item.posInventoryCategory ?? "").trim();
  if (raw) return raw;
  return websiteCategoryCardLabel(item.category);
}

/* ------------------------------------------------------------------ *
 * Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */
export function __runCardTypeCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`card-type-core self-test failed: ${msg}`);
    passed += 1;
  };

  // POS category wins when present (real values from the owner's catalog).
  ok(cardTypeLabel({ posInventoryCategory: "Live Resin", category: "concentrate" }) === "Live Resin", "POS category preferred");
  ok(cardTypeLabel({ posInventoryCategory: "Gummies", category: "edible-solid" }) === "Gummies", "edible POS category preferred");
  ok(cardTypeLabel({ posInventoryCategory: "Flower", category: "flower" }) === "Flower", "flower shows its type too (no special-casing)");
  ok(cardTypeLabel({ posInventoryCategory: "  BHO  ", category: "concentrate" }) === "BHO", "whitespace trimmed");

  // Blank/missing POS category falls back to the aliased website category.
  ok(cardTypeLabel({ posInventoryCategory: "", category: "cartridge" }) === "Vape", "blank falls back to alias");
  ok(cardTypeLabel({ posInventoryCategory: null, category: "edible-liquid" }) === "Drink", "null falls back to alias");
  ok(cardTypeLabel({ category: "paraphernalia" }) === "Accessory", "paraphernalia alias");
  ok(cardTypeLabel({ posInventoryCategory: "   ", category: "preroll-pack" }) === "Preroll", "whitespace-only falls back");

  // Unaliased website categories format through the taxonomy.
  const flowerFallback = cardTypeLabel({ category: "flower" });
  ok(flowerFallback.length > 0, "unaliased category still yields a label");

  console.log(`card-type-core: ${passed} assertions passed`);
}
