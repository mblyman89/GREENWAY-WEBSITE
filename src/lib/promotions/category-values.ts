/**
 * src/lib/promotions/category-values.ts
 *
 * The concrete list of GreenwayCategory values for the promotion targeting UI.
 * Kept as a runtime array (the type is a union, which doesn't exist at runtime)
 * and asserted against the type so it stays in sync.
 */
import type { GreenwayCategory } from "@/lib/leafly/types";

export const GREENWAY_CATEGORY_VALUES: GreenwayCategory[] = [
  "flower",
  "popcorn-bud",
  "infused-flower",
  "blunt",
  "infused-blunt",
  "tincture",
  "rso",
  "paraphernalia",
  "accessories",
  "merch",
  "preroll-pack",
  "cartridge",
  "disposable-cartridge",
  "edible-solid",
  "concentrate",
  "infused-preroll",
  "infused-preroll-pack",
  "preroll",
  "edible-liquid",
  "topical",
  "trim",
];
