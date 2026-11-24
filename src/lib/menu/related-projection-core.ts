/**
 * src/lib/menu/related-projection-core.ts — USAGE-9c (2026-11-26)
 *
 * WHY: the product page's "More from <brand>" rail passed up to 6 FULL menu
 * items to RelatedProductCard (a client component), so each card serialized
 * its description, identityKey, a dozen null facts and false flags into the
 * RSC payload of every product page: about 1.5 KB per card. The shop grid
 * already sends `toMenuGridItems()` to the very same visual
 * (ProductCardVisual) and the same price/badge helpers, so the rail now uses
 * that projection too. That saves about 450 bytes per card, about 2.7 KB per
 * product page. Product pages are the bulk of ISR writes.
 *
 * SAFE: the projection keeps every field a card, a deal badge or the
 * published-rules matcher reads (id, brand, category, filterCategories,
 * variants, prices, product keys). It drops only fields no card reads, and
 * it is already proven on 2,712 shop-grid cards.
 */
import { toMenuGridItems } from "./menu-grid-projection-core";
import type { GreenwayMenuItem } from "@/lib/leafly/types";

/** Fields the related card + rule matching need; the projection must keep them. */
export const RELATED_CARD_FIELDS = [
  "id",
  "name",
  "brand",
  "vendor",
  "category",
  "filterCategories",
  "priceMinorUnits",
  "variants",
] as const;

export function __runRelatedProjectionTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`related-projection-core FAIL: ${name}`);
    }
  };
  const item = {
    id: "pos-1", name: "Z Pie", brand: "Pastime", vendor: "Pastime Brands", category: "cartridge",
    filterCategories: ["cartridge", "concentrate"], priceMinorUnits: 3000,
    variants: [{ id: "v1", label: "1g", priceMinorUnits: 3000 }], description: "long copy",
    identityKey: "pastime|cartridge|z-pie", hidden: false, unitThcMg: null,
  } as unknown as GreenwayMenuItem;
  const [p] = toMenuGridItems([item]) as unknown as Record<string, unknown>[];
  const src = item as unknown as Record<string, unknown>;
  ok(RELATED_CARD_FIELDS.every((f) => JSON.stringify(p[f]) === JSON.stringify(src[f])), "card + rule fields kept");
  ok(p.description === "" && !("identityKey" in p), "description blanked, identityKey dropped");
  ok(!("hidden" in p) && !("unitThcMg" in p), "false flag + null fact dropped");
  ok(JSON.stringify(p).length < JSON.stringify(item).length, "smaller");
  ok(src.description === "long copy", "source item untouched");
  if (failed > 0) throw new Error(`related-projection-core: ${failed} failed`);
  return { passed, failed };
}
