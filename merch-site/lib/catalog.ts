/**
 * Server-side catalog.
 *
 * Two sources, merged (Studio first, so a Studio re-publish wins a handle):
 *  1. R73 S7: products published from the back office's Merch Studio, read
 *     from GET <main site>/api/merch-catalog with the shared secret
 *     MERCH_CATALOG_TOKEN (server-to-server; never sent to a browser). Pages
 *     refresh it every 60 s (ISR); checkout / cart / the Stripe webhook read
 *     it fresh. If the back office can't be reached, the last good copy this
 *     server saw is used, so an outage never empties the shop.
 *  2. The build-time JSON (scripts/build-catalog.mjs from catalog/*.json).
 * Full products (with print files) stay on the server; pages pass only
 * `toCard()` data to the browser.
 */
import { cache } from "react";
import data from "./catalog-data.json";
import { buildCatalog, MERCH_CATEGORIES, toCard, type MerchProduct, type MerchProductCard } from "./catalog-core";
import { MAIN_SITE_URL, siteUrl } from "./site";

export const CATALOG_REVALIDATE = 60;
const files = data as { name: string; data: unknown }[];

export const catalogSourceUrl = () => ((process.env.MERCH_CATALOG_URL ?? "").trim() || `${MAIN_SITE_URL}/api/merch-catalog`);
const catalogToken = () => (process.env.MERCH_CATALOG_TOKEN ?? "").trim();

let lastGood: { name: string; data: unknown }[] = [];

async function studioFiles(fresh: boolean): Promise<{ name: string; data: unknown }[]> {
  const url = catalogSourceUrl();
  const token = catalogToken();
  if (token.length < 32 || !/^https:\/\//.test(url)) return [];
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
      ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: CATALOG_REVALIDATE } }),
    });
    if (!res.ok) return lastGood;
    const body = (await res.json()) as { products?: unknown } | null;
    if (!Array.isArray(body?.products)) return lastGood;
    lastGood = body.products.filter((p): p is { name: string; data: unknown } => !!p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string");
    return lastGood;
  } catch {
    return lastGood;
  }
}

async function load(fresh: boolean): Promise<MerchProduct[]> {
  return buildCatalog([...(await studioFiles(fresh)), ...files], siteUrl()).products;
}

/** Pages / sitemap / feed (cached 60 s, de-duplicated per request). */
export const allProducts = cache((): Promise<MerchProduct[]> => load(false));
/** Money paths (checkout, cart preview, Stripe webhook): always the current catalog. */
export const freshProducts = (): Promise<MerchProduct[]> => load(true);

export const allCards = async (): Promise<MerchProductCard[]> => (await allProducts()).map(toCard);
export const cardsIn = async (category: string): Promise<MerchProductCard[]> => (await allCards()).filter((p) => p.category === category);
export const findProduct = async (handle: string): Promise<MerchProduct | null> => (await allProducts()).find((p) => p.handle === handle) ?? null;

/** Category -> how many products are live (for the shop-page cards). */
export async function categoryCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = Object.fromEntries(MERCH_CATEGORIES.map((c) => [c.slug, 0]));
  for (const p of await allProducts()) out[p.category] = (out[p.category] ?? 0) + 1;
  return out;
}
