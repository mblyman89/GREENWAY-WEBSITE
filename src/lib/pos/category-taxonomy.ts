import type { GreenwayCategory } from "@/lib/leafly/types";

export type WebsiteCategoryDefinition = {
  value: GreenwayCategory;
  label: string;
  helper: string;
};

export const websiteCategoryDefinitions = [
  { value: "flower", label: "Flower", helper: "Premium and regular usable marijuana flower categories (popcorn bud excluded)" },
  { value: "paraphernalia", label: "Paraphernalia", helper: "Accessories, devices, glass, pipes, batteries, wraps, and non-cannabis gear" },
  { value: "preroll-pack", label: "Preroll Pack", helper: "Non-infused multi-pack prerolls" },
  { value: "cartridge", label: "Cartridge", helper: "Cartridge categories, including live resin cartridge rows" },
  { value: "disposable-cartridge", label: "Disposable Cartridge", helper: "Disposable vape/cartridge category rows" },
  { value: "edible-solid", label: "Edible (Solid)", helper: "Solid edible categories such as gummies, chocolates, chews, mints, capsules, and candies" },
  { value: "concentrate", label: "Concentrate", helper: "Concentrate family including carts, disposables, rosin, resin, badder, hash, RSO, and related concentrate-for-inhalation categories" },
  { value: "infused-preroll", label: "Infused Preroll", helper: "Single infused prerolls and infused blunt categories" },
  { value: "infused-preroll-pack", label: "Infused Preroll Pack", helper: "Multi-pack infused prerolls and infused blunts" },
  { value: "preroll", label: "Preroll", helper: "Single non-infused prerolls and blunts" },
  { value: "edible-liquid", label: "Edible (Liquid)", helper: "Beverages, shots, soda, tinctures, and other liquid edible rows" },
  { value: "topical", label: "Topical", helper: "Topicals, transdermals, bath salts, balms, lotions, and salves" },
  { value: "popcorn-bud", label: "Popcorn Bud", helper: "Popcorn bud, small bud, and budget flower categories" },
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
