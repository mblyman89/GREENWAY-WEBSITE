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
import { siteUrl } from "./site";
import { describeFeedAnswer, feedUrl, type FeedStatus } from "./feed-core";

export const CATALOG_REVALIDATE = 60;
const files = data as { name: string; data: unknown }[];

/** D232 M-1: www by default; a bare greenwaymarijuana.com env value is moved to www (feed-core). */
export const catalogSourceUrl = () => feedUrl(process.env.MERCH_CATALOG_URL, "/api/merch-catalog");
const catalogToken = () => (process.env.MERCH_CATALOG_TOKEN ?? "").trim();

let lastGood: { name: string; data: unknown }[] = [];
let lastFeed: FeedStatus | null = null;
// D232 M-7 (Q-11-7): the back-office auto-confirm switch, from the last feed answer.
let lastAutoConfirm = false;
/**
 * Is the back-office auto-confirm switch on? Only when the LAST feed read
 * worked and said so: a failed read means off (orders wait as drafts).
 * Call after freshProducts() so it reflects right now.
 */
export const feedAutoConfirm = (): boolean => lastFeed?.ok === true && lastAutoConfirm;
/** What this server last saw from the catalog feed (null = not fetched yet). */
export const lastFeedStatus = (): FeedStatus | null => lastFeed;
const note = (s: Omit<FeedStatus, "at">) => {
  lastFeed = { at: new Date().toISOString(), ...s };
  if (!s.ok) console.error(`[merch-catalog] ${s.problem}`);
};

async function studioFiles(fresh: boolean): Promise<{ name: string; data: unknown }[]> {
  const url = catalogSourceUrl();
  const token = catalogToken();
  if (token.length < 32 || !/^https:\/\//.test(url)) {
    note({ ok: false, status: 0, products: 0, problem: token.length < 32 ? "MERCH_CATALOG_TOKEN is missing or shorter than 32 characters, so the shop does not ask the back office." : "MERCH_CATALOG_URL is not an https:// address." });
    return [];
  }
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
      // D232 M-1: never follow a redirect - it would drop the token. Report it.
      redirect: "manual",
      ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: CATALOG_REVALIDATE } }),
    });
    const answer = describeFeedAnswer(res.status, res.headers.get("location"));
    if (!answer.ok) { lastAutoConfirm = false; note({ ok: false, status: res.status, products: lastGood.length, problem: answer.problem }); return lastGood; }
    const body = (await res.json()) as { products?: unknown; autoConfirm?: unknown } | null;
    lastAutoConfirm = body?.autoConfirm === true;
    if (!Array.isArray(body?.products)) { note({ ok: false, status: res.status, products: lastGood.length, problem: "The back office answered, but not with a product list." }); return lastGood; }
    lastGood = body.products.filter((p): p is { name: string; data: unknown } => !!p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string");
    note({ ok: true, status: res.status, products: lastGood.length, problem: "" });
    return lastGood;
  } catch (e) {
    note({ ok: false, status: 0, products: lastGood.length, problem: (e as { name?: string })?.name === "TimeoutError" ? "The back office did not answer within 5 seconds." : "Could not reach the back office (network error)." });
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
