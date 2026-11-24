/**
 * src/lib/menu/purchase-panel-projection-core.ts — USAGE-9f (2026-11-26)
 *
 * WHY: the product page handed its FULL menu item to ProductDetailPurchasePanel
 * (a client component), so description, identityKey, a dozen null facts and
 * false flags were serialized into every product page's RSC (~1.9 KB row).
 * The panel now receives the same `toMenuGridItems` projection the shop grid
 * sends to cards, saving about 600 bytes per product page. The page itself
 * still renders the full description from the untouched item.
 *
 * DUE CARE (the add-to-cart + deal-price path): PANEL_FIELDS lists every field
 * ProductDetailPurchasePanel, its deal/badge helpers and its cart `addItem`
 * read. The self-test proves each one is kept with an identical value. The
 * exception is null facts, which become absent, and the panel reads those as
 * `item.x ?? null`, so the cart receives the same null. The deal price uses
 * id, category, filterCategories, brand, priceMinorUnits and variants, all kept.
 */
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { toMenuGridItems } from "./menu-grid-projection-core";

/** Every field the purchase panel (and what it calls) reads. */
export const PANEL_FIELDS = [
  "id",
  "name",
  "brand",
  "category",
  "filterCategories",
  "strainType",
  "priceLabel",
  "priceMinorUnits",
  "variants",
] as const;

/** Read by the panel as `item.x ?? null`: absent and null are the same. */
export const PANEL_NULLISH_FIELDS = ["lowThcLiquid", "unitThcMg", "otherwiseTaken", "unitsPerPackage", "netVolumeMl"] as const;

export function purchasePanelItem(item: GreenwayMenuItem): GreenwayMenuItem {
  return toMenuGridItems([item])[0]!;
}

export function __runPurchasePanelProjectionTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`purchase-panel-projection-core FAIL: ${name}`);
    }
  };
  const full = {
    id: "pos-1", name: "Grape Taffy", brand: "Pastime", category: "cartridge",
    filterCategories: ["cartridge", "concentrate"], strainType: "unknown", priceLabel: "$25.00 1g",
    priceMinorUnits: 2500, variants: [{ id: "v", label: "1g", priceMinorUnits: 2500, inventoryLevel: 1 }],
    lowThcLiquid: null, unitThcMg: null, otherwiseTaken: true, unitsPerPackage: 10, netVolumeMl: null,
    description: "long copy", identityKey: "k", hidden: false, dohCompliant: false,
  } as unknown as GreenwayMenuItem;
  const src = full as unknown as Record<string, unknown>;
  const p = purchasePanelItem(full) as unknown as Record<string, unknown>;
  ok(PANEL_FIELDS.every((f) => JSON.stringify(p[f]) === JSON.stringify(src[f])), "every panel field kept, same value");
  ok(PANEL_NULLISH_FIELDS.every((f) => (p[f] ?? null) === (src[f] ?? null)), "nullish facts read the same (?? null)");
  ok(p.otherwiseTaken === true && p.unitsPerPackage === 10, "set facts kept (cart meter units)");
  ok(p.description === "" && !("identityKey" in p), "description blanked, identityKey dropped");
  ok(src.description === "long copy" && src.identityKey === "k", "the page's own item is untouched");
  ok(JSON.stringify(p).length < JSON.stringify(full).length, "smaller");
  if (failed > 0) throw new Error(`purchase-panel-projection-core: ${failed} failed`);
  return { passed, failed };
}
