/**
 * D242 — Budalerts fetcher, PURE core (no I/O, no Date.now, no env).
 *
 * Owner request (verbatim in docs/sop-program/00-OWNER-REQUEST-VERBATIM.md,
 * "D242 (build)"): Budalerts gave permission to use brand photos,
 * descriptions and prices for the brands Greenway carries, INTERNAL USE
 * ONLY — never advertise or sell the data. Build a respectful fetcher for
 * the vendors we cannot get from Cultivera / GrowFlow / LeafLink; show it
 * on the same Vendor Menus page; vendors move from "Still need a menu" to a
 * done table once their data is gathered.
 *
 * What the public pages carry (verified on the live site, fixtures under
 * tests/fixtures/budalerts/):
 *   - brand page /brands/{slug}/washington[/{category}]: JSON-LD ItemList of
 *     up to 24 Products (name, url, category, offers.price, seller, image)
 *     + visible cards (size "1/4oz", "$4.23/g", "40% below similar
 *     listings", seller link) + header facts (in-stock listings,
 *     dispensaries, "Checked N days ago", category counts).
 *   - No paging: ?page / ?offset return the same 24, so coverage grows by
 *     also reading the per-category pages (each its own 24).
 *   - product page /products/{id}: Brand, Category, Weight, Strain, store,
 *     address, "Seen N days ago". NO description text on any public page
 *     (product, brand, strain) — the description column is kept and filled
 *     only when a page actually carries one. Never invented.
 *
 * Respect rules (robots.txt: Allow / ; Disallow /alerts /favorites
 * /settings /compare /browse /buy-again /api/ /config.js): we only ever
 * request https://budalerts.com/brands/…, /products/… and /sitemaps/…;
 * one request at a time, ≥ 3 s apart, 20 s timeout, 2 MB cap, a clear
 * User-Agent, a per-run request budget, and a 7-day cache per brand.
 *
 * Money is minor units (cents). Self-tests: __runBudalertsCoreTests().
 */

/* ------------------------------------------------------------------
 * Politeness constants
 * ------------------------------------------------------------------ */

export const BUDALERTS_ORIGIN = "https://budalerts.com";
export const BUDALERTS_HOST = "budalerts.com";
export const BUDALERTS_STATE = "washington";
export const BUDALERTS_USER_AGENT =
  "GreenwayMarijuanaMenuBot/1.0 (+https://greenwaymarijuana.com; internal vendor records with Budalerts' permission; dev@greenwaymarijuana.com)";
/** Minimum gap between two requests to budalerts.com. */
export const BUDALERTS_MIN_GAP_MS = 3_000;
export const BUDALERTS_TIMEOUT_MS = 20_000;
export const BUDALERTS_MAX_BYTES = 2_000_000;
/** Hard cap on requests in one fetch run (one click or one cron tick). */
export const BUDALERTS_RUN_BUDGET = 40;
/** A brand fetched within this many days is served from what we saved. */
export const BUDALERTS_CACHE_DAYS = 7;
/** The site shows at most this many listings per page (no paging). */
export const BUDALERTS_PAGE_CAP = 24;

export const BUDALERTS_CATEGORIES = [
  "flower",
  "pre-rolls",
  "vaporizers",
  "concentrates",
  "edibles",
  "tinctures",
  "topicals",
  "accessories",
] as const;

export const BUDALERTS_INTERNAL_NOTE =
  "Internal use only — Budalerts gave permission for our own records. Never advertise, publish, syndicate or sell this data.";

/** robots.txt Disallow list (checked 2026, kept literal). */
export const BUDALERTS_DISALLOWED_PREFIXES = [
  "/alerts",
  "/favorites",
  "/settings",
  "/compare",
  "/browse",
  "/buy-again",
  "/api/",
  "/config.js",
] as const;

/** The only paths this fetcher ever asks for. */
const ALLOWED_PATH = /^\/(?:brands\/[a-z0-9-]+\/washington(?:\/[a-z0-9-]+)?|products\/[a-z0-9]+|sitemaps\/brands-washington\.xml)$/;

/* ------------------------------------------------------------------
 * URLs
 * ------------------------------------------------------------------ */

export function isValidBrandSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/.test(slug);
}

export function isValidProductId(id: string | null | undefined): boolean {
  return typeof id === "string" && /^[a-z0-9]{8,64}$/.test(id);
}

/**
 * True only for https://budalerts.com URLs on our allow-list that robots.txt
 * does not disallow (no query string, no fragment, no credentials, no port).
 */
export function isAllowedBudalertsUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.hostname !== BUDALERTS_HOST) return false;
  if (u.port || u.username || u.password || u.search || u.hash) return false;
  const p = u.pathname;
  if (BUDALERTS_DISALLOWED_PREFIXES.some((d) => p === d || p.startsWith(d.endsWith("/") ? d : `${d}/`) || p === d.replace(/\/$/, ""))) {
    return false;
  }
  return ALLOWED_PATH.test(p);
}

export function brandPageUrl(slug: string, category: string | null = null): string | null {
  if (!isValidBrandSlug(slug)) return null;
  if (category !== null && !isValidBrandSlug(category)) return null;
  const url = `${BUDALERTS_ORIGIN}/brands/${slug}/${BUDALERTS_STATE}${category ? `/${category}` : ""}`;
  return isAllowedBudalertsUrl(url) ? url : null;
}

export function productPageUrl(id: string): string | null {
  if (!isValidProductId(id)) return null;
  return `${BUDALERTS_ORIGIN}/products/${id}`;
}

export const BUDALERTS_BRAND_SITEMAP_URL = `${BUDALERTS_ORIGIN}/sitemaps/brands-washington.xml`;

/** Product id from "https://budalerts.com/products/{id}" or "/products/{id}". */
export function productIdFromUrl(raw: string | null | undefined): string | null {
  const m = /\/products\/([a-z0-9]+)(?:[/?#]|$)/.exec(raw ?? "");
  return m && isValidProductId(m[1]) ? m[1] : null;
}

/* ------------------------------------------------------------------
 * Politeness helpers
 * ------------------------------------------------------------------ */

/** How long to wait before the next request (0 = go now). */
export function politeWaitMs(lastRequestAtMs: number | null, nowMs: number, gapMs = BUDALERTS_MIN_GAP_MS): number {
  if (lastRequestAtMs === null || !Number.isFinite(lastRequestAtMs)) return 0;
  return Math.max(0, lastRequestAtMs + Math.max(gapMs, BUDALERTS_MIN_GAP_MS) - nowMs);
}

/** True when a saved brand pull is older than the cache window (or missing). */
export function isBrandDue(fetchedAtIso: string | null | undefined, nowMs: number, days = BUDALERTS_CACHE_DAYS): boolean {
  if (!fetchedAtIso) return true;
  const t = Date.parse(fetchedAtIso);
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= days * 86_400_000;
}

/** Back-off after an HTTP status: 429/503 stop the whole run. */
export function shouldStopRun(status: number): boolean {
  return status === 429 || status === 503 || status === 403;
}

/* ------------------------------------------------------------------
 * Text helpers
 * ------------------------------------------------------------------ */

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z0-9]+);/gi, (whole, code: string) => {
    const c = code.toLowerCase();
    if (c.startsWith("#x")) {
      const n = parseInt(c.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    if (c.startsWith("#")) {
      const n = parseInt(c.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return NAMED[c] ?? whole;
  });
}

/** Icons are inline <svg>; their <path> tags would look like <p> to a regex. */
export function stripSvg(html: string): string {
  return html.replace(/<svg[\s\S]*?<\/svg>/gi, "");
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** "$1,234.50" / "10.00" / 10 → minor units; anything else → null. */
export function priceToMinor(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) : null;
  const t = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

function parseIntLoose(raw: string | null | undefined): number | null {
  const t = (raw ?? "").replace(/[,\s]/g, "");
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** Slug the way Budalerts builds them: "Bacon's Buds" → "bacon-s-buds". */
export function budalertsSlug(name: string | null | undefined): string {
  return (name ?? "")
    .replace(/[\u2122\u00ae\u00a9]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ------------------------------------------------------------------
 * Sitemap
 * ------------------------------------------------------------------ */

export type SitemapBrand = { slug: string; categories: string[] };

/** brands-washington.xml → one entry per brand slug with its category pages. */
export function parseWaBrandSitemap(xml: string): SitemapBrand[] {
  const by = new Map<string, Set<string>>();
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const loc = decodeEntities(m[1]);
    const mm = /^https:\/\/budalerts\.com\/brands\/([a-z0-9-]+)\/washington(?:\/([a-z0-9-]+))?\/?$/.exec(loc);
    if (!mm || !isValidBrandSlug(mm[1])) continue;
    const set = by.get(mm[1]) ?? new Set<string>();
    if (mm[2]) set.add(mm[2]);
    by.set(mm[1], set);
  }
  return [...by.entries()]
    .map(([slug, cats]) => ({ slug, categories: [...cats].sort() }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/* ------------------------------------------------------------------
 * Brand page parser
 * ------------------------------------------------------------------ */

export type BudalertsItem = {
  productId: string;
  name: string;
  productUrl: string;
  brandName: string | null;
  category: string | null;
  priceMinor: number | null;
  pricePerGramMinor: number | null;
  sizeLabel: string | null;
  belowSimilarPct: number | null;
  availability: string | null;
  sellerName: string | null;
  sellerUrl: string | null;
  imageUrl: string | null;
  /** Only when a page actually carries one — none do today. */
  description: string | null;
  strain: string | null;
  /** Which brand/category page(s) listed it. */
  seenOn: string[];
};

export type BudalertsCategoryCount = { slug: string; label: string; count: number | null };

export type BudalertsBrandPage = {
  brandName: string | null;
  listingCount: number | null;
  dispensaryCount: number | null;
  checkedText: string | null;
  lowestPriceMinor: number | null;
  logoUrl: string | null;
  categories: BudalertsCategoryCount[];
  items: BudalertsItem[];
  /** Items read from the visible card only (the JSON-LD list carries ~half). */
  cardOnlyCount: number;
  warnings: string[];
};

type JsonObj = Record<string, unknown>;

function asObj(v: unknown): JsonObj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObj) : null;
}
function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      /* a broken block is skipped, never guessed */
    }
  }
  return out;
}

function imageOf(v: unknown): string | null {
  if (typeof v === "string") return safeImageUrl(v);
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = imageOf(x);
      if (s) return s;
    }
    return null;
  }
  const o = asObj(v);
  return o ? safeImageUrl(asStr(o.url) ?? asStr(o.contentUrl)) : null;
}

/** Only absolute https image URLs are kept. */
export function safeImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(decodeEntities(raw.trim()));
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function safeHttpsUrl(raw: string | null | undefined): string | null {
  return safeImageUrl(raw);
}

function emptyItem(productId: string, name: string, seenOn: string): BudalertsItem {
  return {
    productId,
    name,
    productUrl: `${BUDALERTS_ORIGIN}/products/${productId}`,
    brandName: null,
    category: null,
    priceMinor: null,
    pricePerGramMinor: null,
    sizeLabel: null,
    belowSimilarPct: null,
    availability: null,
    sellerName: null,
    sellerUrl: null,
    imageUrl: null,
    description: null,
    strain: null,
    seenOn: [seenOn],
  };
}

function productFromLd(p: JsonObj, seenOn: string): BudalertsItem | null {
  const url = asStr(p.url);
  const id = productIdFromUrl(url);
  const name = asStr(p.name);
  if (!id || !name) return null;
  const it = emptyItem(id, decodeEntities(name), seenOn);
  it.category = asStr(p.category);
  const brand = asObj(p.brand);
  it.brandName = brand ? asStr(brand.name) : asStr(p.brand);
  it.imageUrl = imageOf(p.image);
  const desc = asStr(p.description);
  it.description = desc ? decodeEntities(desc) : null;
  const offers = Array.isArray(p.offers) ? asObj(p.offers[0]) : asObj(p.offers);
  if (offers) {
    const price = offers.price;
    it.priceMinor = priceToMinor(typeof price === "number" || typeof price === "string" ? price : null);
    const av = asStr(offers.availability);
    it.availability = av ? av.replace(/^https?:\/\/schema\.org\//, "") : null;
    const seller = asObj(offers.seller);
    it.sellerName = seller ? asStr(seller.name) : null;
  }
  return it;
}

/** Visible card facts the JSON-LD lacks: size, $/g, % below similar, seller link. */
type CardFacts = {
  name: string | null;
  priceMinor: number | null;
  pricePerGramMinor: number | null;
  sizeLabel: string | null;
  belowSimilarPct: number | null;
  sellerName: string | null;
  sellerUrl: string | null;
  imageUrl: string | null;
};

export function parseCards(rawHtml: string): Map<string, CardFacts> {
  const html = stripSvg(rawHtml);
  const out = new Map<string, CardFacts>();
  const parts = html.split(/data-product-id="/).slice(1);
  for (const part of parts) {
    const idm = /^([a-z0-9]+)"/.exec(part);
    if (!idm || !isValidProductId(idm[1])) continue;
    const end = part.indexOf("</li>");
    const card = end >= 0 ? part.slice(0, end) : part.slice(0, 20_000);
    const nameM = /<h2[^>]*id="[a-z0-9]+-title"[^>]*>([\s\S]*?)<\/h2>/.exec(card);
    const priceM = /<span[^>]*class="[^"]*font-heading[^"]*"[^>]*>\s*(\$[\d,]+(?:\.\d{1,2})?)\s*<\/span>/.exec(card);
    const ppgM = />\s*(\$[\d,]+(?:\.\d{1,2})?)\/g\s*</.exec(card);
    const belowM = />\s*(\d{1,3})% below similar listings\s*</.exec(card);
    const sizeM = /<p\s[^>]*aria-label="Details"[^>]*>([\s\S]*?)<\/p>/.exec(card);
    const sellerM = /<a[^>]*href="(https:\/\/[^"]+)"[^>]*target="_blank"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<\/a>/.exec(card);
    const imgM = /<img[^>]*src="([^"]+)"/.exec(card);
    const sizeParts = sizeM ? [...sizeM[1].matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map((x) => decodeEntities(x[1]).trim()).filter(Boolean) : [];
    out.set(idm[1], {
      name: nameM ? stripTags(nameM[1]) : null,
      priceMinor: priceM ? priceToMinor(priceM[1]) : null,
      pricePerGramMinor: ppgM ? priceToMinor(ppgM[1]) : null,
      sizeLabel: sizeParts.length ? sizeParts.join(" · ") : null,
      belowSimilarPct: belowM ? Number(belowM[1]) : null,
      sellerName: sellerM ? stripTags(sellerM[2]) : null,
      sellerUrl: sellerM ? safeHttpsUrl(sellerM[1]) : null,
      imageUrl: imgM ? safeImageUrl(imgM[1]) : null,
    });
  }
  return out;
}

function headerFact(html: string, label: string): { first: string | null; second: string | null } {
  const re = new RegExp(`<dt[^>]*>\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>(?:\\s*<dd[^>]*>([\\s\\S]*?)</dd>)?`, "i");
  const m = re.exec(html);
  return { first: m ? stripTags(m[1]) : null, second: m && m[2] ? stripTags(m[2]) : null };
}

/**
 * Parse one brand (or brand + category) page. `seenOn` is a short label of
 * which page it was ("all", "flower", …) kept on each item.
 */
export function parseBrandPage(html: string, seenOn = "all"): BudalertsBrandPage {
  const warnings: string[] = [];
  const items = new Map<string, BudalertsItem>();
  let brandName: string | null = null;
  for (const block of extractJsonLd(html)) {
    const o = asObj(block);
    if (!o) continue;
    if (o["@type"] === "BreadcrumbList" && Array.isArray(o.itemListElement)) {
      const crumbs = o.itemListElement.map(asObj).filter((x): x is JsonObj => !!x);
      const brandCrumb = crumbs.find((c) => /\/brands\/[a-z0-9-]+$/.test(asStr(c.item) ?? ""));
      if (brandCrumb) brandName = asStr(brandCrumb.name);
    }
    if (o["@type"] === "ItemList" && Array.isArray(o.itemListElement)) {
      for (const el of o.itemListElement) {
        const li = asObj(el);
        const p = li ? asObj(li.item) : null;
        if (!p) continue;
        const it = productFromLd(p, seenOn);
        if (it && !items.has(it.productId)) items.set(it.productId, it);
      }
    }
  }
  const cards = parseCards(html);
  let cardOnly = 0;
  for (const [id, c] of cards) {
    let it = items.get(id);
    if (!it) {
      if (!c.name) continue;
      // The JSON-LD list carries only part of the cards (12 of 24 on the
      // live page); the rest are read from the visible card. Normal.
      it = emptyItem(id, c.name, seenOn);
      if (seenOn !== "all") it.category = categoryLabelFromSlug(seenOn);
      items.set(id, it);
      cardOnly += 1;
    }
    it.pricePerGramMinor = it.pricePerGramMinor ?? c.pricePerGramMinor;
    it.sizeLabel = it.sizeLabel ?? c.sizeLabel;
    it.belowSimilarPct = it.belowSimilarPct ?? c.belowSimilarPct;
    it.sellerUrl = it.sellerUrl ?? c.sellerUrl;
    it.sellerName = it.sellerName ?? c.sellerName;
    it.imageUrl = it.imageUrl ?? c.imageUrl;
    if (it.priceMinor === null) it.priceMinor = c.priceMinor;
    else if (c.priceMinor !== null && c.priceMinor !== it.priceMinor) {
      warnings.push(`${id}: card price ${c.priceMinor} differs from JSON-LD ${it.priceMinor}; kept JSON-LD`);
    }
  }
  if (!brandName) {
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    const t = h1 ? stripTags(h1[1]) : "";
    const m = /^(.*) in Washington$/.exec(t);
    brandName = m ? m[1].trim() : null;
  }
  const listings = headerFact(html, "In-stock listings");
  const disp = headerFact(html, "Dispensaries");
  const lowest = headerFact(html, "Lowest listed price");
  let listingCount = parseIntLoose(listings.first);
  if (listingCount === null) {
    const meta = /Compare ([\d,]+) in-stock /.exec(html);
    listingCount = meta ? parseIntLoose(meta[1]) : null;
  }
  const categories: BudalertsCategoryCount[] = [];
  const catRe = /<a[^>]*href="\/brands\/[a-z0-9-]+\/washington\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let cm: RegExpExecArray | null;
  while ((cm = catRe.exec(html))) {
    if (categories.some((c) => c.slug === cm![1])) continue;
    const spans = [...cm[2].matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map((x) => decodeEntities(x[1]).trim());
    const num = spans.find((s) => /^[\d,]+$/.test(s));
    const label = spans.find((s) => !/^[\d,]+$/.test(s)) ?? cm[1];
    categories.push({ slug: cm[1], label, count: num ? parseIntLoose(num) : null });
  }
  const logoM = /<img[^>]*src="(https:\/\/leafly-public\.imgix\.net\/brands\/logos\/[^"]+)"/.exec(html);
  if (items.size === 0) warnings.push("no listings found on the page");
  return {
    brandName: brandName ? decodeEntities(brandName) : null,
    listingCount,
    dispensaryCount: parseIntLoose(disp.first),
    checkedText: listings.second,
    lowestPriceMinor: priceToMinor(lowest.first),
    logoUrl: logoM ? safeImageUrl(logoM[1]) : null,
    categories,
    items: [...items.values()],
    cardOnlyCount: cardOnly,
    warnings,
  };
}

/* ------------------------------------------------------------------
 * Product page parser (fills strain / weight / store detail)
 * ------------------------------------------------------------------ */

export type BudalertsProductPage = {
  productId: string | null;
  name: string | null;
  imageUrl: string | null;
  priceMinor: number | null;
  brandName: string | null;
  category: string | null;
  weight: string | null;
  strain: string | null;
  storeName: string | null;
  storeAddress: string | null;
  seenText: string | null;
  outboundUrl: string | null;
  description: string | null;
};

export function parseProductPage(rawHtml: string): BudalertsProductPage {
  const html = stripSvg(rawHtml);
  const dd = (label: string): string | null => {
    const m = new RegExp(`<dt[^>]*>\\s*${label}\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`, "i").exec(html);
    return m ? stripTags(m[1]) || null : null;
  };
  const og = (prop: string): string | null => {
    const m = new RegExp(`<meta[^>]*property="${prop}"[^>]*content="([^"]*)"`, "i").exec(html);
    return m ? decodeEntities(m[1]) : null;
  };
  const art = /<article[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(art);
  const img = /<img[^>]*src="([^"]+)"/.exec(art);
  const price = /<section[^>]*aria-label="Price"[^>]*>[\s\S]*?(\$[\d,]+(?:\.\d{1,2})?)/.exec(art);
  const loc = /<section[^>]*aria-label="Location"[^>]*>([\s\S]*?)<\/section>/.exec(art);
  let storeName: string | null = null;
  let seen: string | null = null;
  let address: string | null = null;
  if (loc) {
    const sn = /<span[^>]*>([^<]+)<\/span>/.exec(loc[1]);
    storeName = sn ? decodeEntities(sn[1]).trim() : null;
    for (const p of [...loc[1].matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)].map((x) => stripTags(x[1]))) {
      if (/^Seen /i.test(p)) seen = p;
      else if (p) address = p;
    }
  }
  const out = /<a[^>]*href="(https:\/\/[^"]+)"[^>]*>\s*Open link\s*<\/a>/.exec(art);
  // A real description section if one ever appears (none today).
  const descSec = /<section[^>]*aria-label="Description"[^>]*>([\s\S]*?)<\/section>/i.exec(html);
  return {
    productId: productIdFromUrl(og("og:url")),
    name: h1 ? stripTags(h1[1]) : null,
    imageUrl: img ? safeImageUrl(img[1]) : safeImageUrl(og("og:image")),
    priceMinor: price ? priceToMinor(price[1]) : null,
    brandName: dd("Brand"),
    category: dd("Category"),
    weight: dd("Weight"),
    strain: dd("Strain"),
    storeName,
    storeAddress: address,
    seenText: seen,
    outboundUrl: out ? safeHttpsUrl(out[1]) : null,
    description: descSec ? stripTags(descSec[1]) || null : null,
  };
}

/* ------------------------------------------------------------------
 * Fetch plan + merge
 * ------------------------------------------------------------------ */

/**
 * After the "all products" page: which category pages are worth asking for.
 * A category is only read when the page says it has more listings than the
 * main page could show (or its count is unknown) — never more than budget.
 */
/** "pre-rolls" → "Pre-Rolls" (only used for card-only items on a category page). */
export function categoryLabelFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join("-");
}

export function planCategoryPages(
  slug: string,
  main: Pick<BudalertsBrandPage, "categories" | "listingCount" | "items">,
  budget: number,
): { category: string; url: string }[] {
  if (budget <= 0) return [];
  if ((main.listingCount ?? Infinity) <= main.items.length) return [];
  const out: { category: string; url: string }[] = [];
  for (const c of main.categories) {
    if (c.count === 0) continue;
    const url = brandPageUrl(slug, c.slug);
    if (!url) continue;
    out.push({ category: c.slug, url });
    if (out.length >= budget) break;
  }
  return out;
}

/** Merge item lists by product id; first one wins, blanks are filled, seenOn unions. */
export function mergeItems(lists: readonly (readonly BudalertsItem[])[]): BudalertsItem[] {
  const by = new Map<string, BudalertsItem>();
  for (const list of lists) {
    for (const it of list) {
      const prev = by.get(it.productId);
      if (!prev) {
        by.set(it.productId, { ...it, seenOn: [...it.seenOn] });
        continue;
      }
      for (const k of Object.keys(it) as (keyof BudalertsItem)[]) {
        if (k === "seenOn") continue;
        if (prev[k] === null && it[k] !== null) (prev as Record<string, unknown>)[k] = it[k];
      }
      for (const s of it.seenOn) if (!prev.seenOn.includes(s)) prev.seenOn.push(s);
    }
  }
  return [...by.values()];
}

/** Fill strain / weight / description from a product page (never overwrites). */
export function applyProductPage(item: BudalertsItem, page: BudalertsProductPage): BudalertsItem {
  return {
    ...item,
    strain: item.strain ?? page.strain,
    sizeLabel: item.sizeLabel ?? page.weight,
    description: item.description ?? page.description,
    imageUrl: item.imageUrl ?? page.imageUrl,
    category: item.category ?? page.category,
  };
}

/** Distinct images (an item list often repeats one image for many store listings). */
export function distinctImages(items: readonly Pick<BudalertsItem, "imageUrl" | "name" | "productId">[]): { imageUrl: string; name: string; productId: string }[] {
  const seen = new Set<string>();
  const out: { imageUrl: string; name: string; productId: string }[] = [];
  for (const it of items) {
    if (!it.imageUrl || seen.has(it.imageUrl)) continue;
    seen.add(it.imageUrl);
    out.push({ imageUrl: it.imageUrl, name: it.name, productId: it.productId });
  }
  return out;
}

/** Snapshot status from what one run got. */
export function snapshotStatus(itemCount: number, requestErrors: number, stopped: boolean): "fetched" | "partial" | "empty" | "error" {
  if (itemCount > 0) return requestErrors > 0 || stopped ? "partial" : "fetched";
  return requestErrors > 0 || stopped ? "error" : "empty";
}

/* ------------------------------------------------------------------
 * Brand ↔ vendor linking (person confirms; exact slugs only suggested)
 * ------------------------------------------------------------------ */

export type SlugSuggestion = { slug: string; from: string; how: "vendor name" | "brand name" };

/**
 * Suggest Budalerts slugs for one vendor from its names and its brand names.
 * Only EXACT slug matches against the sitemap list are suggested — never a
 * fuzzy guess. Linking is still a person's click.
 */
export function suggestSlugs(
  vendorNames: readonly (string | null | undefined)[],
  brandNames: readonly (string | null | undefined)[],
  knownSlugs: ReadonlySet<string>,
): SlugSuggestion[] {
  const out: SlugSuggestion[] = [];
  const add = (name: string | null | undefined, how: SlugSuggestion["how"]) => {
    if (!name) return;
    const base = budalertsSlug(name);
    const variants = [base, base.replace(/-(llc|inc|co|company|corp|ltd)$/g, ""), base.replace(/-(cannabis|farms?|gardens?|brands?|extracts?)$/g, "")];
    for (const s of variants) {
      if (s && knownSlugs.has(s) && !out.some((o) => o.slug === s)) out.push({ slug: s, from: name, how });
    }
  };
  for (const n of brandNames) add(n, "brand name");
  for (const n of vendorNames) add(n, "vendor name");
  return out;
}

/* ------------------------------------------------------------------
 * Done table rule
 * ------------------------------------------------------------------ */

export type BudalertsLinkRow = { vendorId: string; slug: string };
export type BudalertsSnapshotRow = {
  id: string;
  slug: string;
  status: string;
  itemCount: number;
  fetchedAt: string;
  brandName: string | null;
  listingCount: number | null;
  imageCount: number;
};

export function isUsableBudalerts(s: Pick<BudalertsSnapshotRow, "status" | "itemCount">): boolean {
  const st = s.status.toLowerCase();
  return (st === "fetched" || st === "partial") && s.itemCount > 0;
}

/** Newest snapshot per slug. */
export function latestBySlug(snaps: readonly BudalertsSnapshotRow[]): Map<string, BudalertsSnapshotRow> {
  const m = new Map<string, BudalertsSnapshotRow>();
  for (const s of snaps) {
    const prev = m.get(s.slug);
    if (!prev || Date.parse(s.fetchedAt) > Date.parse(prev.fetchedAt)) m.set(s.slug, s);
  }
  return m;
}

export type BudalertsVendorState = {
  vendorId: string;
  slugs: string[];
  /** Newest pull per linked slug (may be missing when never fetched). */
  latest: BudalertsSnapshotRow[];
  /** Newest usable pull per linked slug. */
  usable: BudalertsSnapshotRow[];
  itemCount: number;
  imageCount: number;
  lastFetchedAt: string | null;
  done: boolean;
};

/**
 * Per vendor: linked slugs + their latest pulls. A vendor is DONE when at
 * least one linked brand has a usable pull (the owner's "after having
 * gathered their data").
 */
export function budalertsStateByVendor(
  links: readonly BudalertsLinkRow[],
  snaps: readonly BudalertsSnapshotRow[],
): Map<string, BudalertsVendorState> {
  const newest = latestBySlug(snaps);
  const newestUsable = latestBySlug(snaps.filter(isUsableBudalerts));
  const out = new Map<string, BudalertsVendorState>();
  for (const l of links) {
    const st = out.get(l.vendorId) ?? { vendorId: l.vendorId, slugs: [], latest: [], usable: [], itemCount: 0, imageCount: 0, lastFetchedAt: null, done: false };
    if (st.slugs.includes(l.slug)) continue;
    st.slugs.push(l.slug);
    const n = newest.get(l.slug);
    if (n) st.latest.push(n);
    const u = newestUsable.get(l.slug);
    if (u) {
      st.usable.push(u);
      st.itemCount += u.itemCount;
      st.imageCount += u.imageCount;
      if (!st.lastFetchedAt || Date.parse(u.fetchedAt) > Date.parse(st.lastFetchedAt)) st.lastFetchedAt = u.fetchedAt;
      st.done = true;
    }
    out.set(l.vendorId, st);
  }
  return out;
}

/** Split the "Still need a menu" rows: done-by-Budalerts move to their own table. */
export function splitNeededByBudalerts<R extends { vendor: { id: string } }>(
  needed: readonly R[],
  state: ReadonlyMap<string, BudalertsVendorState>,
): { stillNeeded: R[]; done: (R & { budalerts: BudalertsVendorState })[] } {
  const stillNeeded: R[] = [];
  const done: (R & { budalerts: BudalertsVendorState })[] = [];
  for (const r of needed) {
    const st = state.get(r.vendor.id);
    if (st?.done) done.push({ ...r, budalerts: st });
    else stillNeeded.push(r);
  }
  return { stillNeeded, done };
}

/** Which linked slugs a background run should fetch next (never-fetched first, then oldest). */
export function pickDueSlugs(
  links: readonly BudalertsLinkRow[],
  snaps: readonly BudalertsSnapshotRow[],
  nowMs: number,
  max: number,
): string[] {
  const newest = latestBySlug(snaps);
  const slugs = [...new Set(links.map((l) => l.slug))].filter((s) => isValidBrandSlug(s));
  const due = slugs.filter((s) => isBrandDue(newest.get(s)?.fetchedAt, nowMs));
  due.sort((a, b) => {
    const ta = newest.get(a) ? Date.parse(newest.get(a)!.fetchedAt) : -Infinity;
    const tb = newest.get(b) ? Date.parse(newest.get(b)!.fetchedAt) : -Infinity;
    return ta - tb || a.localeCompare(b);
  });
  return due.slice(0, Math.max(0, max));
}

/* ------------------------------------------------------------------
 * Media labels (pure) — what a saved Budalerts photo is called
 * ------------------------------------------------------------------ */

export const BUDALERTS_CREDIT = "Budalerts (internal use only)";

/** Library tags: always "budalerts" + "product-image" + "internal-only", then the brand. */
export function budalertsMediaTags(brandLabel: string | null | undefined): string[] {
  const tags = ["budalerts", "product-image", "internal-only"];
  const b = budalertsSlug(brandLabel ?? "");
  if (b && !tags.includes(b)) tags.push(b);
  return tags;
}

/** "Wedding Sunset — Phat Panda (Budalerts)". */
export function budalertsMediaTitle(item: { name: string; brand: string | null }): string {
  const name = (item.name || "Product").trim().slice(0, 160);
  return item.brand ? `${name} — ${item.brand.trim()} (Budalerts)` : `${name} (Budalerts)`;
}

/** "Phat Panda Wedding Sunset, Flower, 1/4oz". */
export function budalertsMediaAlt(item: { name: string; brand: string | null; category: string | null; size_label: string | null }): string {
  const head = [item.brand, item.name].filter(Boolean).join(" ").trim() || "Product photo";
  return [head, item.category, item.size_label].filter(Boolean).join(", ").slice(0, 300);
}

/** The library's menu-row reference for a saved photo. */
export function budalertsMenuItemRef(itemId: string): string {
  return `budalerts:${itemId}`;
}

/* ------------------------------------------------------------------
 * Per-row board (pure) — what each "Still need a menu" row shows
 * ------------------------------------------------------------------ */

export type BudalertsLinkedBrand = {
  slug: string;
  brandName: string | null;
  /** Newest pull for this slug, any status (null = never fetched). */
  latestId: string | null;
  latestStatus: string | null;
  latestAt: string | null;
  /** Newest USABLE pull (what "View listings" opens). */
  usableId: string | null;
  itemCount: number;
  imageCount: number;
};

export type BudalertsRowInfo = {
  linked: BudalertsLinkedBrand[];
  /** Exact-slug suggestions not already linked. */
  suggestions: SlugSuggestion[];
};

export function buildBudalertsRowInfo(
  vendorIds: readonly string[],
  links: readonly (BudalertsLinkRow & { brandName?: string | null })[],
  snaps: readonly BudalertsSnapshotRow[],
  vendorNames: ReadonlyMap<string, readonly (string | null | undefined)[]>,
  brandNames: ReadonlyMap<string, readonly (string | null | undefined)[]>,
  knownSlugs: ReadonlySet<string>,
): Map<string, BudalertsRowInfo> {
  const newest = latestBySlug(snaps);
  const newestUsable = latestBySlug(snaps.filter(isUsableBudalerts));
  const out = new Map<string, BudalertsRowInfo>();
  for (const id of vendorIds) {
    const mine = links.filter((l) => l.vendorId === id);
    const linked: BudalertsLinkedBrand[] = [];
    for (const l of mine) {
      if (linked.some((x) => x.slug === l.slug)) continue;
      const n = newest.get(l.slug) ?? null;
      const u = newestUsable.get(l.slug) ?? null;
      linked.push({
        slug: l.slug,
        brandName: u?.brandName ?? n?.brandName ?? l.brandName ?? null,
        latestId: n?.id ?? null,
        latestStatus: n?.status ?? null,
        latestAt: n?.fetchedAt ?? null,
        usableId: u?.id ?? null,
        itemCount: u?.itemCount ?? 0,
        imageCount: u?.imageCount ?? 0,
      });
    }
    const taken = new Set(linked.map((x) => x.slug));
    const suggestions = suggestSlugs(vendorNames.get(id) ?? [], brandNames.get(id) ?? [], knownSlugs).filter((s) => !taken.has(s.slug));
    out.set(id, { linked, suggestions });
  }
  return out;
}

/** "fetched 3 days ago" style status words for a linked brand (no clock inside). */
export function linkedBrandStatusLabel(b: Pick<BudalertsLinkedBrand, "latestStatus" | "usableId" | "itemCount">): string {
  if (!b.latestStatus) return "not fetched yet";
  if (b.usableId && b.latestStatus !== "fetched" && b.latestStatus !== "partial") return `last try ${b.latestStatus}; ${b.itemCount} listings on file`;
  if (b.latestStatus === "empty") return "no listings on Budalerts";
  if (b.latestStatus === "error") return "last fetch failed";
  return `${b.itemCount} listings`;
}

/* ------------------------------------------------------------------
 * Self-tests
 * ------------------------------------------------------------------ */

const T_BRAND_HTML = `<html><head><meta name="description" content="Compare 744 in-stock Phat Panda listings from 12 dispensaries in Washington.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Budalerts","item":"https://budalerts.com/"},{"@type":"ListItem","position":3,"name":"Phat Panda","item":"https://budalerts.com/brands/phat-panda"},{"@type":"ListItem","position":4,"name":"Washington","item":"https://budalerts.com/brands/phat-panda/washington"}]}</script>
<script type="application/ld+json">{"@type":"ItemList","numberOfItems":2,"itemListElement":[{"@type":"ListItem","position":1,"item":{"@type":"Product","name":"Wedding Sunset","url":"https://budalerts.com/products/m9702zvp5cxet796xmq8kkrwmh8hy7gx","category":"Flower","offers":{"@type":"Offer","availability":"https://schema.org/InStock","seller":{"@type":"Organization","name":"The Herbery  - St. Johns"},"price":"30.00"},"brand":{"@type":"Brand","name":"Phat Panda"},"image":"https://product-assets.iheartjane.com/photos/aa.jpeg"}},{"@type":"ListItem","position":2,"item":{"@type":"Product","name":"Biscuits &amp; Gravy","url":"https://budalerts.com/products/m9763gy7m9weqqags8g49vg9698hzn1z","category":"Concentrates","offers":{"price":"10.00"},"brand":{"@type":"Brand","name":"Phat Panda"},"image":"https://product-assets.iheartjane.com/photos/aa.jpeg"}}]}</script>
<script type="application/ld+json">{broken</script></head><body>
<h1 class="x">Phat Panda in Washington</h1>
<dl><div><dt>In-stock listings</dt><dd>744</dd><dd>Checked 3 days ago</dd></div><div><dt>Dispensaries</dt><dd>12</dd></div><div><dt>Lowest listed price</dt><dd>$10.00</dd></div></dl>
<img src="https://leafly-public.imgix.net/brands/logos/pp.png" alt="">
<a href="/brands/phat-panda/washington/pre-rolls"><span><img src="x"/><span>241</span></span><span><span>Pre-Rolls</span></span></a>
<a href="/brands/phat-panda/washington/edibles"><span><span>0</span></span><span><span>Edibles</span></span></a>
<ul><li><div data-slot="card" data-product-id="m9702zvp5cxet796xmq8kkrwmh8hy7gx"><img src="https://product-assets.iheartjane.com/photos/aa.jpeg"/>
<h2 id="m9702zvp5cxet796xmq8kkrwmh8hy7gx-title"><a href="/products/m9702zvp5cxet796xmq8kkrwmh8hy7gx">Wedding Sunset</a></h2>
<div><p><span class="font-heading text-xl">$30.00</span><span class="text-xs">$4.23/g</span></p><p>40% below similar listings</p></div>
<p aria-label="Details"><span><span>1/4oz</span></span></p>
<div><a href="https://www.leafly.com/dispensary-info/the-herbery" target="_blank" rel="nofollow noopener"><svg class="lucide"><path d="M1 1"></path></svg><span class="truncate">The Herbery  - St. Johns</span></a></div></div></li>
<li><div data-slot="card" data-product-id="m97aaaaaaaaaaaaaaaaaaaaaaaaaaaaa"><h2 id="m97aaaaaaaaaaaaaaaaaaaaaaaaaaaaa-title"><a href="/products/m97aaaaaaaaaaaaaaaaaaaaaaaaaaaaa">Card Only</a></h2>
<p><span class="font-heading">$15.50</span></p></div></li></ul></body></html>`;

const T_PRODUCT_HTML = `<meta property="og:url" content="https://budalerts.com/products/m9700r4rzw07t0ssnxqbbfz7f58hy09e"><main><article><div><img src="https://product-assets.iheartjane.com/photos/4f.jpeg" alt="Jack Herer"/></div><div><header><h1>Jack Herer</h1></header><section aria-label="Price"><p><span>$10.00</span></p></section><dl><a><dt>Brand</dt><dd>Phat Panda</dd></a><a><dt>Category</dt><dd>Concentrates</dd></a><a><dt>Weight</dt><dd>g</dd></a><a><dt>Strain</dt><dd>Jack Herer</dd></a></dl><section><a href="https://www.leafly.com/dispensary-info/x/p/1/jack-herer" rel="nofollow noopener" target="_blank">Open link</a></section><section aria-label="Location"><a><span>The Herbery  - St. Johns</span></a><p>Seen 3 days ago</p><p>6018 NE St Johns Rd, Vancouver, WA, 98661</p></section></div></article></main>`;

export function __runBudalertsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`budalerts-core FAIL: ${msg}`);
    }
  };

  // URL guard — robots.txt + allow-list
  ok(isAllowedBudalertsUrl("https://budalerts.com/brands/phat-panda/washington"), "brand page allowed");
  ok(isAllowedBudalertsUrl("https://budalerts.com/brands/phat-panda/washington/flower"), "category page allowed");
  ok(isAllowedBudalertsUrl("https://budalerts.com/products/m9700r4rzw07t0ssnxqbbfz7f58hy09e"), "product page allowed");
  ok(isAllowedBudalertsUrl(BUDALERTS_BRAND_SITEMAP_URL), "sitemap allowed");
  ok(!isAllowedBudalertsUrl("https://budalerts.com/browse?brand=Phat+Panda"), "browse disallowed");
  ok(!isAllowedBudalertsUrl("https://budalerts.com/api/products"), "api disallowed");
  ok(!isAllowedBudalertsUrl("https://budalerts.com/alerts/new"), "alerts disallowed");
  ok(!isAllowedBudalertsUrl("https://budalerts.com/compare"), "compare disallowed");
  ok(!isAllowedBudalertsUrl("https://budalerts.com/config.js"), "config.js disallowed");
  ok(!isAllowedBudalertsUrl("http://budalerts.com/brands/phat-panda/washington"), "http refused");
  ok(!isAllowedBudalertsUrl("https://evil.com/brands/phat-panda/washington"), "other host refused");
  ok(!isAllowedBudalertsUrl("https://budalerts.com.evil.com/brands/x/washington"), "lookalike host refused");
  ok(!isAllowedBudalertsUrl("https://budalerts.com/brands/phat-panda/washington?page=2"), "query refused");
  ok(!isAllowedBudalertsUrl("https://budalerts.com/brands/phat-panda/oregon"), "other state refused");
  ok(!isAllowedBudalertsUrl("https://budalerts.com/brands/../api/washington"), "traversal refused");
  ok(!isAllowedBudalertsUrl("https://budalerts-convex.fly.dev/api/query"), "convex backend refused");
  ok(!isAllowedBudalertsUrl(null) && !isAllowedBudalertsUrl("not a url"), "junk refused");
  ok(brandPageUrl("phat-panda") === "https://budalerts.com/brands/phat-panda/washington", "brandPageUrl");
  ok(brandPageUrl("phat-panda", "flower") === "https://budalerts.com/brands/phat-panda/washington/flower", "brandPageUrl category");
  ok(brandPageUrl("Phat Panda") === null && brandPageUrl("-x") === null && brandPageUrl("a", "../x") === null, "bad slugs refused");
  ok(productPageUrl("m9700r4rzw07t0ssnxqbbfz7f58hy09e") !== null && productPageUrl("../x") === null, "productPageUrl");
  ok(productIdFromUrl("https://budalerts.com/products/m9700r4rzw07t0ssnxqbbfz7f58hy09e") === "m9700r4rzw07t0ssnxqbbfz7f58hy09e", "productIdFromUrl abs");
  ok(productIdFromUrl("/products/abc") === null, "productIdFromUrl too short");

  // politeness
  ok(politeWaitMs(null, 1000) === 0, "first request goes now");
  ok(politeWaitMs(10_000, 11_000) === 2_000, "waits the rest of 3 s");
  ok(politeWaitMs(10_000, 14_000) === 0, "after 3 s no wait");
  ok(politeWaitMs(10_000, 10_500, 500) === 2_500, "gap never below 3 s");
  ok(BUDALERTS_MIN_GAP_MS >= 3_000 && BUDALERTS_TIMEOUT_MS <= 30_000 && BUDALERTS_MAX_BYTES <= 5_000_000 && BUDALERTS_RUN_BUDGET <= 60, "politeness bounds");
  ok(/Greenway/.test(BUDALERTS_USER_AGENT) && /permission/.test(BUDALERTS_USER_AGENT), "UA names us");
  const NOW = Date.parse("2026-11-13T20:00:00Z");
  ok(isBrandDue(null, NOW) && isBrandDue("junk", NOW), "never fetched is due");
  ok(!isBrandDue("2026-11-10T20:00:00Z", NOW), "3 days old not due");
  ok(isBrandDue("2026-11-06T20:00:00Z", NOW), "7 days old due");
  ok(shouldStopRun(429) && shouldStopRun(503) && shouldStopRun(403) && !shouldStopRun(404) && !shouldStopRun(200), "stop statuses");

  // text + money
  ok(priceToMinor("10.00") === 1000 && priceToMinor("$1,234.5") === 123450 && priceToMinor("$4.23") === 423, "priceToMinor strings");
  ok(priceToMinor(12.345) === 1235 && priceToMinor("abc") === null && priceToMinor("-1") === null && priceToMinor(null) === null, "priceToMinor edge");
  ok(decodeEntities("Biscuits &amp; Gravy &#39;x&#x27;") === "Biscuits & Gravy 'x'", "decodeEntities");
  ok(budalertsSlug("Bacon's Buds") === "bacon-s-buds" && budalertsSlug("Phat Panda™") === "phat-panda" && budalertsSlug("Café X") === "cafe-x", "slugify");

  // sitemap
  const sm = parseWaBrandSitemap(`<urlset><url><loc>https://budalerts.com/brands/phat-panda/washington</loc></url><url><loc>https://budalerts.com/brands/phat-panda/washington/flower</loc></url><url><loc>https://budalerts.com/brands/1988/washington/</loc></url><url><loc>https://budalerts.com/brands/x/oregon</loc></url><url><loc>https://other.com/brands/y/washington</loc></url></urlset>`);
  ok(sm.length === 2 && sm[0].slug === "1988" && sm[1].slug === "phat-panda" && sm[1].categories.join() === "flower", "sitemap parse");

  // brand page
  const bp = parseBrandPage(T_BRAND_HTML, "all");
  ok(bp.brandName === "Phat Panda", "brand name from breadcrumb");
  ok(bp.listingCount === 744 && bp.dispensaryCount === 12 && bp.checkedText === "Checked 3 days ago" && bp.lowestPriceMinor === 1000, "header facts");
  ok(bp.logoUrl === "https://leafly-public.imgix.net/brands/logos/pp.png", "logo url");
  ok(bp.categories.length === 2 && bp.categories[0].slug === "pre-rolls" && bp.categories[0].count === 241 && bp.categories[0].label === "Pre-Rolls", "category counts");
  ok(bp.categories[1].count === 0, "zero category kept");
  ok(bp.items.length === 3, "2 JSON-LD + 1 card-only");
  const ws = bp.items.find((i) => i.name === "Wedding Sunset");
  ok(!!ws && ws.priceMinor === 3000 && ws.pricePerGramMinor === 423 && ws.sizeLabel === "1/4oz" && ws.belowSimilarPct === 40, "card facts merged");
  ok(!!ws && ws.sellerName === "The Herbery  - St. Johns" && ws.sellerUrl === "https://www.leafly.com/dispensary-info/the-herbery", "seller");
  ok(!!ws && ws.category === "Flower" && ws.brandName === "Phat Panda" && ws.availability === "InStock" && ws.imageUrl === "https://product-assets.iheartjane.com/photos/aa.jpeg", "ld facts");
  ok(!!ws && ws.description === null, "no description invented");
  ok(bp.items.some((i) => i.name === "Biscuits & Gravy" && i.priceMinor === 1000 && i.sizeLabel === null), "entity decoded, missing size stays null");
  const co = bp.items.find((i) => i.name === "Card Only");
  ok(!!co && co.priceMinor === 1550 && bp.cardOnlyCount === 1 && bp.warnings.length === 0, "card-only kept and counted");
  ok(parseBrandPage("<html></html>").items.length === 0 && parseBrandPage("<html></html>").warnings.length === 1, "empty page warns");

  // plan
  const plan = planCategoryPages("phat-panda", bp, 10);
  ok(plan.length === 1 && plan[0].category === "pre-rolls", "plan skips zero categories");
  ok(planCategoryPages("phat-panda", bp, 0).length === 0, "plan respects budget");
  ok(planCategoryPages("phat-panda", { ...bp, listingCount: 3 }, 10).length === 0, "plan skips when all shown");

  // merge
  const a = [{ ...bp.items[0], sizeLabel: null, seenOn: ["all"] }];
  const b = [{ ...bp.items[0], sizeLabel: "1g", priceMinor: 9999, seenOn: ["flower"] }];
  const mm = mergeItems([a, b]);
  ok(mm.length === 1 && mm[0].sizeLabel === "1g" && mm[0].priceMinor === bp.items[0].priceMinor && mm[0].seenOn.join() === "all,flower", "merge fills blanks, first wins");
  ok(distinctImages(bp.items).length === 1, "distinct images");

  // product page
  const pp = parseProductPage(T_PRODUCT_HTML);
  ok(pp.productId === "m9700r4rzw07t0ssnxqbbfz7f58hy09e" && pp.name === "Jack Herer" && pp.priceMinor === 1000, "product basics");
  ok(pp.brandName === "Phat Panda" && pp.category === "Concentrates" && pp.weight === "g" && pp.strain === "Jack Herer", "product dl");
  ok(pp.storeName === "The Herbery  - St. Johns" && pp.seenText === "Seen 3 days ago" && pp.storeAddress === "6018 NE St Johns Rd, Vancouver, WA, 98661", "product location");
  ok(pp.outboundUrl === "https://www.leafly.com/dispensary-info/x/p/1/jack-herer" && pp.description === null, "outbound + no description");
  const ap = applyProductPage({ ...bp.items[0], strain: null }, pp);
  ok(ap.strain === "Jack Herer" && ap.sizeLabel === "1/4oz", "applyProductPage fills, never overwrites");

  ok(snapshotStatus(5, 0, false) === "fetched" && snapshotStatus(5, 1, false) === "partial" && snapshotStatus(0, 0, false) === "empty" && snapshotStatus(0, 2, true) === "error", "snapshotStatus");

  // suggestions
  const known = new Set(["phat-panda", "bacon-s-buds", "fire-bros", "dank-czar"]);
  const sug = suggestSlugs(["Phat Panda LLC", "Grow Op Farms"], ["Bacon's Buds", "Unknown Brand"], known);
  ok(sug.length === 2 && sug[0].slug === "bacon-s-buds" && sug[0].how === "brand name" && sug[1].slug === "phat-panda", "exact slug suggestions only");
  ok(suggestSlugs(["Dank"], [], known).length === 0, "no fuzzy partials");

  // done rule
  const snaps: BudalertsSnapshotRow[] = [
    { id: "s1", slug: "phat-panda", status: "fetched", itemCount: 80, fetchedAt: "2026-11-10T00:00:00Z", brandName: "Phat Panda", listingCount: 744, imageCount: 40 },
    { id: "s2", slug: "phat-panda", status: "error", itemCount: 0, fetchedAt: "2026-11-12T00:00:00Z", brandName: null, listingCount: null, imageCount: 0 },
    { id: "s3", slug: "dank-czar", status: "empty", itemCount: 0, fetchedAt: "2026-11-12T00:00:00Z", brandName: null, listingCount: null, imageCount: 0 },
  ];
  ok(isUsableBudalerts(snaps[0]) && !isUsableBudalerts(snaps[1]) && isUsableBudalerts({ status: "PARTIAL", itemCount: 1 }), "usable rule");
  ok(latestBySlug(snaps).get("phat-panda")?.id === "s2", "latest by slug");
  const st = budalertsStateByVendor([{ vendorId: "v1", slug: "phat-panda" }, { vendorId: "v1", slug: "phat-panda" }, { vendorId: "v2", slug: "dank-czar" }, { vendorId: "v3", slug: "fire-bros" }], snaps);
  ok(st.get("v1")?.done === true && st.get("v1")?.itemCount === 80 && st.get("v1")?.slugs.length === 1, "v1 done via last usable pull");
  ok(st.get("v2")?.done === false && st.get("v3")?.done === false && st.get("v3")?.latest.length === 0, "empty / never fetched not done");
  const split = splitNeededByBudalerts([{ vendor: { id: "v1" } }, { vendor: { id: "v2" } }, { vendor: { id: "v9" } }], st);
  ok(split.done.length === 1 && split.done[0].vendor.id === "v1" && split.done[0].budalerts.itemCount === 80 && split.stillNeeded.length === 2, "split needed/done");

  const due = pickDueSlugs([{ vendorId: "v1", slug: "phat-panda" }, { vendorId: "v2", slug: "dank-czar" }, { vendorId: "v3", slug: "fire-bros" }, { vendorId: "v4", slug: "Bad Slug" }], snaps, NOW, 5);
  ok(due[0] === "fire-bros" && !due.includes("Bad Slug") && !due.includes("dank-czar") && !due.includes("phat-panda"), "pickDueSlugs: never-fetched first, cache honoured");
  ok(pickDueSlugs([{ vendorId: "v3", slug: "fire-bros" }], [], NOW, 0).length === 0, "pickDueSlugs max 0");

  // media labels
  ok(budalertsMediaTags("Phat Panda").join(",") === "budalerts,product-image,internal-only,phat-panda", "media tags");
  ok(budalertsMediaTags(null).length === 3, "media tags without brand");
  ok(budalertsMediaTitle({ name: "Wedding Sunset", brand: "Phat Panda" }) === "Wedding Sunset — Phat Panda (Budalerts)", "media title");
  ok(budalertsMediaAlt({ name: "Wedding Sunset", brand: "Phat Panda", category: "Flower", size_label: "1/4oz" }) === "Phat Panda Wedding Sunset, Flower, 1/4oz", "media alt");
  ok(budalertsMenuItemRef("abc") === "budalerts:abc" && BUDALERTS_CREDIT.includes("internal"), "menu item ref + credit");

  // row board
  const board = buildBudalertsRowInfo(
    ["v1", "v2", "v3"],
    [{ vendorId: "v1", slug: "phat-panda", brandName: "Phat Panda" }, { vendorId: "v2", slug: "dank-czar" }],
    snaps,
    new Map([["v3", ["Fire Bros LLC"]], ["v1", ["Phat Panda"]]]),
    new Map([["v2", ["Bacon's Buds"]]]),
    known,
  );
  const b1 = board.get("v1");
  ok(b1?.linked.length === 1 && b1.linked[0].usableId === "s1" && b1.linked[0].latestId === "s2" && b1.linked[0].itemCount === 80 && b1.suggestions.length === 0, "board: linked slug not re-suggested");
  ok(board.get("v2")?.linked[0].latestStatus === "empty" && board.get("v2")?.suggestions[0]?.slug === "bacon-s-buds", "board: empty pull + brand suggestion");
  ok(board.get("v3")?.linked.length === 0 && board.get("v3")?.suggestions[0]?.slug === "fire-bros", "board: suggestion from vendor name");
  ok(linkedBrandStatusLabel(b1!.linked[0]) === "last try error; 80 listings on file", "status label: failed retry keeps data");
  ok(linkedBrandStatusLabel({ latestStatus: null, usableId: null, itemCount: 0 }) === "not fetched yet" && linkedBrandStatusLabel({ latestStatus: "empty", usableId: null, itemCount: 0 }) === "no listings on Budalerts", "status label: never / empty");

  return { passed, failed };
}
