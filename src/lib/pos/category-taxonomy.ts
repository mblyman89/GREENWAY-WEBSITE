import type { GreenwayCategory } from "@/lib/leafly/types";

export type WebsiteCategoryDefinition = {
  value: GreenwayCategory;
  label: string;
  helper: string;
};

export const websiteCategoryDefinitions = [
  { value: "flower", label: "Flower", helper: "Premium and regular usable marijuana flower categories (popcorn bud and infused flower excluded)" },
  { value: "popcorn-bud", label: "Popcorn Bud", helper: "Popcorn bud, small bud, b-bud, snappers, bong buddies, and budget flower categories" },
  { value: "infused-flower", label: "Infused Flower", helper: "Moon rocks, caviar, THC Iceberg, and other infused/coated flower products" },
  { value: "accessories", label: "Accessories", helper: "Browse broad accessory sections like glass, rolling gear, batteries, dab tools, and lighters" },
  { value: "merch", label: "Greenway Merch", helper: "Official Greenway apparel and gear — tees, hoodies, hats, beanies, socks, and lanyards" },
  { value: "paraphernalia", label: "Paraphernalia", helper: "POS-sourced accessories, devices, glass, pipes, batteries, wraps, and non-cannabis gear" },
  { value: "preroll", label: "Preroll", helper: "Single non-infused prerolls" },
  { value: "blunt", label: "Blunt", helper: "Raw POS Blunt rows, kept separate from standard prerolls for focused browsing" },
  { value: "preroll-pack", label: "Preroll Pack", helper: "Non-infused multi-pack prerolls" },
  { value: "infused-preroll", label: "Infused Preroll", helper: "Single infused prerolls" },
  { value: "infused-blunt", label: "Infused Blunt", helper: "Raw POS Infused Blunt rows, kept separate from standard infused prerolls" },
  { value: "infused-preroll-pack", label: "Infused Preroll Pack", helper: "Multi-pack infused prerolls and infused blunts" },
  { value: "cartridge", label: "Cartridge", helper: "Cartridge categories, including live resin cartridge rows" },
  { value: "disposable-cartridge", label: "Disposable Cartridge", helper: "Disposable vape/cartridge category rows" },
  { value: "concentrate", label: "Concentrate", helper: "Concentrate family including carts, disposables, rosin, resin, badder, hash, RSO, and related concentrate-for-inhalation categories" },
  { value: "rso", label: "RSO", helper: "Raw POS RSO rows, also available inside the broader concentrate family" },
  { value: "edible-solid", label: "Edible (Solid)", helper: "Solid edible categories such as gummies, chocolates, chews, mints, capsules, and candies" },
  { value: "edible-liquid", label: "Edible (Liquid)", helper: "Beverages, shots, soda, and other liquid edible rows" },
  { value: "tincture", label: "Tincture", helper: "Raw POS Tincture rows, also available inside liquid edibles" },
  { value: "topical", label: "Topical", helper: "Topicals, transdermals, bath salts, balms, lotions, and salves" },
  { value: "trim", label: "Trim", helper: "Trim, shake, and mix flower categories" },
] as const satisfies readonly WebsiteCategoryDefinition[];

export const websiteCategories = websiteCategoryDefinitions.map((category) => category.value);

export const websiteCategoryLabels = Object.fromEntries(
  websiteCategoryDefinitions.map((category) => [category.value, category.label]),
) as Record<GreenwayCategory, string>;

export function formatWebsiteCategory(category: string) {
  return websiteCategoryLabels[category as GreenwayCategory] ?? category
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
