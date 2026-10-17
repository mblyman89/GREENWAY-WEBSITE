/**
 * Server-side catalog: the build-time JSON (scripts/build-catalog.mjs) turned
 * into products once per server instance. Full products (with print files)
 * stay on the server; pages pass only `toCard()` data to the browser.
 */
import data from "./catalog-data.json";
import { buildCatalog, MERCH_CATEGORIES, toCard, type MerchProduct, type MerchProductCard } from "./catalog-core";
import { siteUrl } from "./site";

let cache: MerchProduct[] | null = null;

export function allProducts(): MerchProduct[] {
  if (!cache) cache = buildCatalog(data as { name: string; data: unknown }[], siteUrl()).products;
  return cache;
}

export const allCards = (): MerchProductCard[] => allProducts().map(toCard);
export const cardsIn = (category: string): MerchProductCard[] => allCards().filter((p) => p.category === category);
export const findProduct = (handle: string): MerchProduct | null => allProducts().find((p) => p.handle === handle) ?? null;

/** Category -> how many products are live (for the shop-page cards). */
export function categoryCounts(): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(MERCH_CATEGORIES.map((c) => [c.slug, 0]));
  for (const p of allProducts()) out[p.category] = (out[p.category] ?? 0) + 1;
  return out;
}
