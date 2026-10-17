/**
 * R71 S4 - the Greenway Goods "redirect ad" shown on the CANNABIS website (PURE).
 *
 * Owner direction (R71, verbatim): "The product cards on the customer facing
 * website will be advertisements that redirect to the merch site ... No
 * product details can reach the main site. That's the trick. No data at all.
 * A pure redirect button, that's it."
 *
 * So this block is deliberately POOR in data. It can hold ONLY:
 *   - an on/off switch,
 *   - ONE destination: an https origin + optional path on the separate merch
 *     domain (no query string, no #fragment, no user:pass, never a cannabis
 *     host, never an IP / localhost),
 *   - owner-written marketing words (eyebrow, heading, intro, button label),
 *   - up to MERCH_AD_MAX_TILES pictures with a short caption each.
 * It can NOT hold a price, SKU, size, colour list, variant id, stock level,
 * cart, checkout, product id or per-product link. Captions/words that look
 * like a price or a cart call-to-action are BLOCKERS (publish is refused).
 *
 * The link renders as a plain <a target="_blank" rel="noopener noreferrer"
 * referrerPolicy="no-referrer">: the merch site receives no referrer, no
 * tracking parameters and no customer data from the cannabis site.
 *
 * Default = disabled + blank (seed defaultValue ""), so seeding changes
 * nothing on the live site. Hidden unless enabled AND the URL is valid.
 */

export const MERCH_AD_BLOCK = "merch.ad";
export const MERCH_AD_MAX_TILES = 4;
export const MERCH_AD_LIMITS = { eyebrow: 40, heading: 70, intro: 220, button: 32, caption: 60, image: 500, url: 300 } as const;

export interface MerchAdTile { image: string; caption: string }
export interface MerchAd {
  v: 1;
  enabled: boolean;
  url: string;
  eyebrow: string;
  heading: string;
  intro: string;
  button: string;
  tiles: MerchAdTile[];
}

/** What the public site renders (null = render nothing). */
export interface MerchAdView {
  url: string;
  host: string;
  eyebrow: string;
  heading: string;
  intro: string;
  button: string;
  tiles: MerchAdTile[];
}

export function defaultMerchAd(): MerchAd {
  return { v: 1, enabled: false, url: "", eyebrow: "Greenway Glass & Goods", heading: "Apparel lives on its own shop", intro: "", button: "Visit the apparel shop", tiles: [] };
}

/** Hosts the ad may never point at (the cannabis business's own sites). */
export const CANNABIS_HOST_RE = /(^|\.)greenwaymarijuana\.com$/i;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clean = (v: unknown, max: number): string =>
  (typeof v === "string" ? v : "")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Same rule as brand-kit safeBrandSrc: a site path (/x) or an https URL, else "". */
export function safeAdImage(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (/[\s"'<>\\]/.test(s)) return "";
  return /^(\/(?!\/)|https:\/\/)/.test(s) ? s.slice(0, MERCH_AD_LIMITS.image) : "";
}

/**
 * The ONE destination. Returns the normalized `https://host/path` (no trailing
 * slash on a bare origin) or "" when it is not acceptable. `ownHost` (optional)
 * is the host the cannabis site is being served from - also refused.
 */
export function safeMerchUrl(v: unknown, ownHost?: string | null): string {
  const raw = typeof v === "string" ? v.trim() : "";
  if (!raw || raw.length > MERCH_AD_LIMITS.url || /\s/.test(raw)) return "";
  let u: URL;
  try { u = new URL(raw); } catch { return ""; }
  if (u.protocol !== "https:") return "";
  if (u.username || u.password) return "";
  if (u.search || u.hash || raw.includes("?") || raw.includes("#")) return ""; // no tracking params / data
  if (u.port) return "";
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost")) return "";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return ""; // IP literals
  if (CANNABIS_HOST_RE.test(host)) return "";
  if (ownHost && host === ownHost.toLowerCase().replace(/:\d+$/, "")) return "";
  const path = u.pathname === "/" ? "" : u.pathname;
  return `https://${host}${path}`;
}

/** Text that would turn the ad into a product listing (a price or a cart call). */
const PRICE_RE = /(\$\s?\d)|(\d\s?(usd|dollars?)\b)|(\b\d+[.,]\d{2}\b)/i;
const CART_RE = /\b(add to (cart|bag)|buy now|checkout|check out|in stock|sizes? (s|m|l|xl)\b|sku)\b/i;

export interface MerchAdIssue { level: "blocker" | "warn"; field: string; text: string }

export function normalizeMerchAd(raw: unknown): MerchAd {
  const d = defaultMerchAd();
  if (!isObj(raw)) return d;
  const tiles: MerchAdTile[] = [];
  if (Array.isArray(raw.tiles)) {
    for (const t of raw.tiles) {
      if (tiles.length >= MERCH_AD_MAX_TILES) break;
      if (!isObj(t)) continue;
      const image = safeAdImage(t.image);
      if (!image) continue;
      tiles.push({ image, caption: clean(t.caption, MERCH_AD_LIMITS.caption) });
    }
  }
  return {
    v: 1,
    enabled: raw.enabled === true,
    // Keep what the owner typed (trimmed) so the editor can show WHY it's invalid; render uses safeMerchUrl.
    url: clean(raw.url, MERCH_AD_LIMITS.url).replace(/\s/g, ""),
    eyebrow: typeof raw.eyebrow === "string" ? clean(raw.eyebrow, MERCH_AD_LIMITS.eyebrow) : d.eyebrow,
    heading: typeof raw.heading === "string" ? clean(raw.heading, MERCH_AD_LIMITS.heading) : d.heading,
    intro: clean(raw.intro, MERCH_AD_LIMITS.intro),
    button: clean(raw.button, MERCH_AD_LIMITS.button) || d.button,
    tiles,
  };
}

export function parseMerchAd(stored: string | null | undefined): MerchAd {
  if (!stored || !stored.trim()) return defaultMerchAd();
  try { return normalizeMerchAd(JSON.parse(stored)); } catch { return defaultMerchAd(); }
}

export function serializeMerchAd(ad: MerchAd): string {
  return JSON.stringify(normalizeMerchAd(ad));
}

/** Everything wrong with an ad. Blockers stop publishing while it is enabled. */
export function merchAdIssues(ad: MerchAd, ownHost?: string | null): MerchAdIssue[] {
  const out: MerchAdIssue[] = [];
  if (!ad.url) out.push({ level: ad.enabled ? "blocker" : "warn", field: "url", text: "Add the address of the separate Greenway Goods website (https://...)." });
  else if (!safeMerchUrl(ad.url, ownHost)) out.push({ level: "blocker", field: "url", text: "The address must be https:// on the SEPARATE merch domain - no ?parameters or #tags, no greenwaymarijuana.com, no IP address or port." });
  const words: [string, string][] = [["eyebrow", ad.eyebrow], ["heading", ad.heading], ["intro", ad.intro], ["button", ad.button], ...ad.tiles.map((t, i): [string, string] => [`tile ${i + 1} caption`, t.caption])];
  for (const [field, text] of words) {
    if (PRICE_RE.test(text)) out.push({ level: "blocker", field, text: `"${field}" looks like a price. Prices live only on the merch site - the cannabis site shows no product details.` });
    if (CART_RE.test(text)) out.push({ level: "blocker", field, text: `"${field}" reads like a cart/checkout or product detail. Keep it to a simple invitation ("Visit the apparel shop").` });
  }
  if (!ad.heading) out.push({ level: "warn", field: "heading", text: "A short heading helps customers understand the link leaves this site." });
  if (ad.tiles.length === 0) out.push({ level: "warn", field: "tiles", text: "No pictures yet - the ad will show as a single text card." });
  return out;
}

/** The public render model, or null when the ad must not show. */
export function resolveMerchAd(stored: string | null | undefined, ownHost?: string | null): MerchAdView | null {
  const ad = parseMerchAd(stored);
  if (!ad.enabled) return null;
  const url = safeMerchUrl(ad.url, ownHost);
  if (!url) return null;
  if (merchAdIssues(ad, ownHost).some((i) => i.level === "blocker")) return null;
  return { url, host: new URL(url).hostname, eyebrow: ad.eyebrow, heading: ad.heading, intro: ad.intro, button: ad.button, tiles: ad.tiles };
}

// ---------------------------------------------------------------------------
export function __runMerchAdTests(): { passed: number; failed: number } {
  let passed = 0, failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL merch-ad-core: ${m}`); } };

  // Default: off, blank, renders nothing; seeding "" renders nothing.
  ok(defaultMerchAd().enabled === false && defaultMerchAd().url === "", "default off + blank");
  ok(resolveMerchAd("") === null && resolveMerchAd(null) === null && resolveMerchAd("{bad json") === null, "blank/corrupt -> hidden");

  // URL rules.
  ok(safeMerchUrl("https://greenwaygoods.com") === "https://greenwaygoods.com", "bare https origin");
  ok(safeMerchUrl("https://greenwaygoods.com/") === "https://greenwaygoods.com", "trailing slash dropped");
  ok(safeMerchUrl("https://Shop.GreenwayGoods.com/apparel") === "https://shop.greenwaygoods.com/apparel", "host lowercased, path kept");
  ok(safeMerchUrl("http://greenwaygoods.com") === "", "http refused");
  ok(safeMerchUrl("https://greenwaygoods.com/?utm_source=greenway") === "", "query refused (no data)");
  ok(safeMerchUrl("https://greenwaygoods.com/#x") === "", "fragment refused");
  ok(safeMerchUrl("https://a:b@greenwaygoods.com") === "", "credentials refused");
  ok(safeMerchUrl("https://greenwaygoods.com:8443") === "", "port refused");
  ok(safeMerchUrl("https://www.greenwaymarijuana.com/merch") === "", "cannabis host refused");
  ok(safeMerchUrl("https://shop.greenwaymarijuana.com") === "", "cannabis subdomain refused");
  ok(safeMerchUrl("https://greenwaymarijuana.com.evil.io") === "https://greenwaymarijuana.com.evil.io", "suffix match is exact (not a substring)");
  ok(safeMerchUrl("https://192.168.0.1") === "" && safeMerchUrl("https://localhost") === "" && safeMerchUrl("https://intranet") === "", "ip/localhost/dotless refused");
  ok(safeMerchUrl("javascript:alert(1)") === "" && safeMerchUrl("//greenwaygoods.com") === "" && safeMerchUrl("") === "", "junk refused");
  ok(safeMerchUrl("https://preview.example.com", "preview.example.com") === "", "own host refused");
  ok(safeMerchUrl("https://green way.com") === "", "whitespace refused");

  // Images.
  ok(safeAdImage("/merch/tshirt.webp") === "/merch/tshirt.webp" && safeAdImage("https://cdn.x.com/a.png") === "https://cdn.x.com/a.png", "path + https images");
  ok(safeAdImage("//evil.com/a.png") === "" && safeAdImage("javascript:x") === "" && safeAdImage("http://x.com/a.png") === "" && safeAdImage("/a b.png") === "", "bad images refused");

  // Normalize: caps, strips, keeps only known fields (no product data can ride along).
  const n = normalizeMerchAd({ enabled: true, url: " https://greenwaygoods.com ", heading: "<b>Hi</b>", price: 45, sku: "X", tiles: Array.from({ length: 9 }, () => ({ image: "/merch/hat.webp", caption: "Hat", price: "$30" })) });
  ok(n.tiles.length === MERCH_AD_MAX_TILES, "tiles capped");
  ok(!("price" in n) && !("sku" in n) && !("price" in n.tiles[0]), "unknown fields dropped");
  ok(n.heading === "b Hi /b" || !n.heading.includes("<"), "angle brackets stripped");
  ok(n.url === "https://greenwaygoods.com", "url trimmed");
  ok(normalizeMerchAd({ tiles: [{ image: "javascript:x", caption: "a" }] }).tiles.length === 0, "tile without a safe image dropped");
  ok(parseMerchAd(serializeMerchAd(n)).tiles.length === MERCH_AD_MAX_TILES, "round trip");

  // Issues / resolve.
  const good = normalizeMerchAd({ enabled: true, url: "https://greenwaygoods.com", heading: "Wear the Greenway vibe", button: "Visit the apparel shop", tiles: [{ image: "/merch/tshirt.webp", caption: "Tees and hoodies" }] });
  ok(merchAdIssues(good).filter((i) => i.level === "blocker").length === 0, "good ad has no blockers");
  const view = resolveMerchAd(serializeMerchAd(good));
  ok(view !== null && view.url === "https://greenwaygoods.com" && view.host === "greenwaygoods.com" && view.tiles.length === 1, "good ad renders");
  ok(resolveMerchAd(serializeMerchAd({ ...good, enabled: false })) === null, "disabled -> hidden");
  ok(resolveMerchAd(serializeMerchAd({ ...good, url: "https://www.greenwaymarijuana.com" })) === null, "cannabis url -> hidden");
  const priced = { ...good, tiles: [{ image: "/merch/tshirt.webp", caption: "Tee $29.99" }] };
  ok(merchAdIssues(priced).some((i) => i.level === "blocker" && i.field === "tile 1 caption"), "price caption blocks");
  ok(resolveMerchAd(serializeMerchAd(priced)) === null, "priced ad never renders");
  ok(merchAdIssues({ ...good, button: "Add to cart" }).some((i) => i.level === "blocker"), "cart wording blocks");
  ok(merchAdIssues({ ...good, intro: "Only 29.99 today" }).some((i) => i.level === "blocker"), "bare decimal price blocks");
  ok(merchAdIssues({ ...good, intro: "Open 7 days, est. 2017" }).every((i) => i.level !== "blocker"), "ordinary numbers are fine");
  ok(merchAdIssues({ ...defaultMerchAd() }).every((i) => i.level !== "blocker"), "disabled blank ad: warnings only");
  ok(merchAdIssues({ ...defaultMerchAd(), enabled: true }).some((i) => i.level === "blocker" && i.field === "url"), "enabled without url blocks");
  return { passed, failed };
}
