/**
 * R72 S5 - greenwaymerch.com catalog (PURE: no fs, no fetch, no React).
 *
 * The merch site is a SEPARATE Next.js app (Vercel project root = merch-site/)
 * run by Greenway Merchandising LLC (dba Greenway Glass & Goods). It has no
 * database. Products are the "listing package" JSON files the owner downloads
 * from the cannabis back office's Merch Studio (Publish & Ads tab) and drops
 * into merch-site/catalog/. This module turns those files into storefront
 * products, and prices carts SERVER-SIDE (the browser never sets a price).
 *
 * Owner direction (R72, verbatim): "We only need the one shop page with all
 * the main types of categories cards that opens up the catalogue page ( new
 * page I would guess), then picking something from there opens the detail
 * page".  So: /  ->  /<category>  ->  /<category>/<product>.
 *
 * Money is integer cents everywhere.
 */

// ---------------------------------------------------------------------------
// Categories (the cards on the shop page = the catalogue pages)
// ---------------------------------------------------------------------------
import { MERCH_BANNER_CATEGORIES, merchDefaults } from "./site-content-core";
export interface MerchCategory {
  slug: string;
  label: string;
  blurb: string;
  /** Blank-garment photo from Printful's public catalog (no logos). */
  image: string;
}

export const MERCH_CATEGORIES: readonly MerchCategory[] = [
  { slug: "tees", label: "Tees", blurb: "Heavyweight and everyday tees, printed to order.", image: "/categories/tees.webp" },
  { slug: "long-sleeves", label: "Long Sleeves", blurb: "Garment-dyed long sleeves for in-between weather.", image: "/categories/long-sleeves.webp" },
  { slug: "hoodies", label: "Hoodies", blurb: "Heavyweight pullover hoodies for cold Washington mornings.", image: "/categories/hoodies.webp" },
  { slug: "sweatshirts", label: "Sweatshirts", blurb: "Classic garment-dyed crewneck sweatshirts.", image: "/categories/sweatshirts.webp" },
  { slug: "zip-hoodies", label: "Zip Hoodies", blurb: "Full-zip hoodies you can layer over anything.", image: "/categories/zip-hoodies.webp" },
  { slug: "jackets", label: "Jackets", blurb: "Lightweight zip windbreakers.", image: "/categories/jackets.webp" },
  { slug: "hats", label: "Hats", blurb: "Snapbacks, dad hats and truckers with embroidered logos.", image: "/categories/hats.webp" },
  { slug: "beanies", label: "Beanies", blurb: "Cuffed knit beanies, embroidered.", image: "/categories/beanies.webp" },
];

export const CATEGORY_SLUGS = MERCH_CATEGORIES.map((c) => c.slug);
export const getCategory = (slug: string): MerchCategory | null => MERCH_CATEGORIES.find((c) => c.slug === slug) ?? null;

/**
 * Old/likely spellings -> the real page (owner examples: "/sweatshirts, or
 * /tees, or /hoodie, or /hats"). Used as permanent redirects in next.config.ts
 * so a link typed either way lands on the right catalogue.
 */
export const CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  tee: "tees", "t-shirt": "tees", "t-shirts": "tees", tshirt: "tees", tshirts: "tees", shirts: "tees", shirt: "tees",
  "long-sleeve": "long-sleeves", longsleeve: "long-sleeves", longsleeves: "long-sleeves",
  hoodie: "hoodies", pullovers: "hoodies",
  sweatshirt: "sweatshirts", crew: "sweatshirts", crewneck: "sweatshirts", crewnecks: "sweatshirts",
  "zip-hoodie": "zip-hoodies", zips: "zip-hoodies", "full-zip": "zip-hoodies",
  jacket: "jackets", windbreaker: "jackets", windbreakers: "jackets",
  hat: "hats", caps: "hats", cap: "hats", snapbacks: "hats", "dad-hats": "hats", truckers: "hats",
  beanie: "beanies", knit: "beanies",
};

/** Merch Studio blank id -> catalogue page (mirrors garment-catalog-core BLANKS). */
export const BLANK_CATEGORY: Readonly<Record<string, string>> = {
  "cc-1717": "tees", "bc-3001": "tees", "cc-6014": "long-sleeves", "ind-4000": "hoodies", "cc-1566": "sweatshirts",
  "l7-14003": "zip-hoodies", "ind-exp54": "jackets", "yp-6089m": "hats", "yp-6245cm": "hats", "rch-112": "hats", "yp-1501kc": "beanies",
};

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export interface PrintfulPositionBox { area_width: number; area_height: number; width: number; height: number; top: number; left: number; limit_to_print_area?: boolean }
export interface OrderItemFile { type: string; url: string; position?: PrintfulPositionBox; options?: { id: string; value: unknown }[] }
export interface OrderItemTemplate { files: OrderItemFile[]; options: { id: string; value: unknown }[] }

export interface MerchVariant { id: number; color: string; size: string; priceCents: number; inStock: boolean }
export interface MerchProduct {
  handle: string;
  title: string;
  description: string;
  category: string;
  blankLabel: string;
  fabric: string;
  images: string[];
  colors: string[];
  sizes: string[];
  variants: MerchVariant[];
  minPriceCents: number;
  maxPriceCents: number;
  /** Printful order-item template (files with exact print position + options). Server use only. */
  orderItem: OrderItemTemplate;
  designId: string;
  order: number;
}

/** What the browser gets (no print files, no Printful options). */
export type MerchProductCard = Omit<MerchProduct, "orderItem" | "designId">;
export const toCard = ({ orderItem: _o, designId: _d, ...card }: MerchProduct): MerchProductCard => card; // eslint-disable-line @typescript-eslint/no-unused-vars

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v : "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, max);
const posInt = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0);
export const safeHandle = (v: unknown) => { const s = str(v, 60).toLowerCase(); return /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(s) ? s : ""; };
/** A site path (/x) or an https URL with no spaces/quotes. */
export const safeImage = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return !/[\s"'<>\\]/.test(s) && /^(\/(?!\/)|https:\/\/)/.test(s) ? s.slice(0, 500) : ""; };
const safeFileName = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return /^[a-z0-9][a-z0-9._-]{0,120}\.png$/i.test(s) ? s : ""; };

export interface NormalizeOptions { siteUrl: string; order: number }
export interface NormalizeResult { product: MerchProduct | null; issues: string[] }

/**
 * One listing package (+ optional `merch` block the owner may add:
 * {"active": false} to hide, {"category": "hats"}, {"images": ["/products/x.jpg"]})
 * -> a storefront product, or null with the reasons.
 */
export function normalizeListing(raw: unknown, o: NormalizeOptions): NormalizeResult {
  const issues: string[] = [];
  if (!isObj(raw) || raw.format !== "greenway-goods-listing" || raw.v !== 1) return { product: null, issues: ["Not a Greenway Goods listing package (format/v)."] };
  const merch = isObj(raw.merch) ? raw.merch : {};
  if (merch.active === false) return { product: null, issues: ["Hidden (merch.active is false)."] };
  const p = isObj(raw.product) ? raw.product : {};
  const blank = isObj(p.blank) ? p.blank : {};
  const title = str(p.title, 80);
  const handle = safeHandle(p.handle);
  if (!title || !handle) return { product: null, issues: ["Missing product title or handle."] };
  const category = typeof merch.category === "string" && getCategory(merch.category) ? merch.category : BLANK_CATEGORY[str(blank.id, 40)] ?? "";
  if (!category) return { product: null, issues: [`Unknown garment "${str(blank.id, 40)}" - add "merch": {"category": "..."}.`] };

  const seen = new Set<number>();
  const variants: MerchVariant[] = [];
  for (const v of Array.isArray(raw.variants) ? raw.variants : []) {
    if (!isObj(v)) continue;
    const id = posInt(v.printfulVariantId);
    const priceCents = posInt(v.retailCents);
    const color = str(v.color, 40);
    const size = str(v.size, 12);
    if (!id || !priceCents || !color || !size || seen.has(id)) continue;
    seen.add(id);
    variants.push({ id, color, size, priceCents, inStock: v.inStock !== false });
  }
  if (!variants.length) return { product: null, issues: ["No usable variants (colour/size/price)."] };

  const printFiles = Array.isArray(raw.printFiles) ? raw.printFiles.filter(isObj) : [];
  const oi = isObj(raw.printfulOrderItem) ? raw.printfulOrderItem : {};
  const site = o.siteUrl.replace(/\/+$/, "");
  const files: OrderItemFile[] = [];
  for (const f of Array.isArray(oi.files) ? oi.files : []) {
    if (!isObj(f)) continue;
    const type = str(f.type, 40);
    if (!type) continue;
    let url = typeof f.url === "string" && /^https:\/\/\S+$/.test(f.url) ? f.url : "";
    if (!url) {
      const name = safeFileName(printFiles.find((pf) => pf.fileType === type)?.filename);
      if (name && /^https:\/\//.test(site)) url = `${site}/print/${name}`;
    }
    if (!url) issues.push(`Print file for "${type}" has no URL - put the PNG in merch-site/public/print/.`);
    const out: OrderItemFile = { type, url };
    if (isObj(f.position)) out.position = f.position as unknown as PrintfulPositionBox;
    if (Array.isArray(f.options)) out.options = f.options.filter(isObj).map((x) => ({ id: str(x.id, 40), value: x.value }));
    files.push(out);
  }
  if (!files.length) issues.push("No print files - Printful would have nothing to print.");
  const options = (Array.isArray(oi.options) ? oi.options : []).filter(isObj).map((x) => ({ id: str(x.id, 40), value: x.value }));

  const cat = getCategory(category)!;
  const images = (Array.isArray(merch.images) ? merch.images : []).map(safeImage).filter(Boolean).slice(0, 8);
  const colors = [...new Set(variants.map((v) => v.color))];
  const sizes = [...new Set(variants.map((v) => v.size))];
  const prices = variants.map((v) => v.priceCents);
  return {
    product: {
      handle, title, category,
      description: str(p.description, 1000),
      blankLabel: [str(blank.brand, 40), str(blank.model, 20), str(blank.title, 60)].filter(Boolean).join(" "),
      fabric: str(blank.fabric, 200),
      images: images.length ? images : [cat.image],
      colors, sizes, variants,
      minPriceCents: Math.min(...prices), maxPriceCents: Math.max(...prices),
      orderItem: { files, options },
      designId: str(raw.designId, 60),
      order: o.order,
    },
    issues,
  };
}

/** Many packages -> products (later duplicate handles are dropped with an issue). */
export function buildCatalog(files: readonly { name: string; data: unknown }[], siteUrl: string): { products: MerchProduct[]; issues: string[] } {
  const products: MerchProduct[] = [];
  const issues: string[] = [];
  files.forEach((f, i) => {
    const r = normalizeListing(f.data, { siteUrl, order: i });
    for (const m of r.issues) issues.push(`${f.name}: ${m}`);
    if (!r.product) return;
    if (products.some((p) => p.handle === r.product!.handle)) { issues.push(`${f.name}: duplicate product handle "${r.product.handle}" - skipped.`); return; }
    products.push(r.product);
  });
  return { products, issues };
}

// ---------------------------------------------------------------------------
// Browse helpers (shared by server pages and the client browser)
// ---------------------------------------------------------------------------
export type SortKey = "featured" | "price-asc" | "price-desc" | "name";
export const SORT_OPTIONS: readonly { value: SortKey; label: string }[] = [
  { value: "featured", label: "Featured" }, { value: "price-asc", label: "Price: Low" }, { value: "price-desc", label: "Price: High" }, { value: "name", label: "Name" },
];
export interface BrowseFilters { query: string; colors: string[]; sizes: string[]; sort: SortKey }

export function browse<T extends MerchProductCard>(products: readonly T[], f: BrowseFilters): T[] {
  const q = f.query.trim().toLowerCase();
  const out = products.filter((p) => {
    if (q && !`${p.title} ${p.description} ${p.blankLabel} ${p.colors.join(" ")}`.toLowerCase().includes(q)) return false;
    if (f.colors.length && !p.variants.some((v) => v.inStock && f.colors.includes(v.color))) return false;
    if (f.sizes.length && !p.variants.some((v) => v.inStock && f.sizes.includes(v.size))) return false;
    return true;
  });
  const by: Record<SortKey, (a: T, b: T) => number> = {
    featured: (a, b) => a.order - b.order,
    "price-asc": (a, b) => a.minPriceCents - b.minPriceCents || a.order - b.order,
    "price-desc": (a, b) => b.minPriceCents - a.minPriceCents || a.order - b.order,
    name: (a, b) => a.title.localeCompare(b.title),
  };
  return out.sort(by[f.sort] ?? by.featured);
}

/** Facet options with counts, Printful size order preserved. */
const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "One size"];
export function facetCounts(products: readonly MerchProductCard[], key: "color" | "size"): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const p of products) for (const v of new Set(p.variants.filter((x) => x.inStock).map((x) => x[key]))) m.set(v, (m.get(v) ?? 0) + 1);
  const rank = (s: string) => { const i = SIZE_ORDER.indexOf(s); return i < 0 ? 99 : i; };
  return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => (key === "size" ? rank(a.value) - rank(b.value) : 0) || a.value.localeCompare(b.value));
}

export const formatCents = (c: number) => `$${(Math.round(c) / 100).toFixed(2)}`;
export const priceLabel = (p: Pick<MerchProduct, "minPriceCents" | "maxPriceCents">) => (p.minPriceCents === p.maxPriceCents ? formatCents(p.minPriceCents) : `From ${formatCents(p.minPriceCents)}`);

// ---------------------------------------------------------------------------
// Cart (browser keeps {handle, variantId, qty}; the SERVER prices it)
// ---------------------------------------------------------------------------
export const CART_MAX_LINES = 20;
export const CART_MAX_QTY = 10;
export interface CartLine { handle: string; variantId: number; qty: number }
export interface PricedLine { product: MerchProduct; variant: MerchVariant; qty: number; unitCents: number; lineCents: number }

export function cleanCart(raw: unknown): CartLine[] {
  const out: CartLine[] = [];
  for (const l of Array.isArray(raw) ? raw : []) {
    if (!isObj(l)) continue;
    const handle = safeHandle(l.handle);
    const variantId = posInt(l.variantId);
    const qty = Math.min(CART_MAX_QTY, posInt(l.qty));
    if (!handle || !variantId || !qty) continue;
    const same = out.find((x) => x.handle === handle && x.variantId === variantId);
    if (same) same.qty = Math.min(CART_MAX_QTY, same.qty + qty);
    else if (out.length < CART_MAX_LINES) out.push({ handle, variantId, qty });
  }
  return out;
}

export function priceCart(lines: readonly CartLine[], products: readonly MerchProduct[]): { lines: PricedLine[]; subtotalCents: number; problems: string[] } {
  const out: PricedLine[] = [];
  const problems: string[] = [];
  for (const l of cleanCart(lines)) {
    const product = products.find((p) => p.handle === l.handle);
    const variant = product?.variants.find((v) => v.id === l.variantId);
    if (!product || !variant) { problems.push("An item in your cart is no longer available and was removed."); continue; }
    if (!variant.inStock) { problems.push(`${product.title} (${variant.color} / ${variant.size}) is out of stock and was removed.`); continue; }
    out.push({ product, variant, qty: l.qty, unitCents: variant.priceCents, lineCents: variant.priceCents * l.qty });
  }
  return { lines: out, subtotalCents: out.reduce((s, l) => s + l.lineCents, 0), problems };
}

/** Our order reference: also the Printful external_id (<=32 chars, [A-Za-z0-9_-]). */
export function makeOrderRef(nowMs: number, rand: string): string {
  return `gm-${nowMs.toString(36)}-${rand.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8)}`.slice(0, 32);
}
export const isOrderRef = (s: unknown): s is string => typeof s === "string" && /^gm-[a-z0-9]{6,12}-[a-z0-9]{1,8}$/.test(s);

/** Compact cart for Stripe metadata (values <= 500 chars each): "handle~variant~qty|...". */
export function encodeCartMeta(lines: readonly CartLine[]): Record<string, string> {
  const parts = cleanCart(lines).map((l) => `${l.handle}~${l.variantId}~${l.qty}`);
  const out: Record<string, string> = {};
  let cur = "";
  let n = 0;
  for (const p of parts) {
    if (cur && cur.length + 1 + p.length > 500) { out[`cart_${n++}`] = cur; cur = ""; }
    cur = cur ? `${cur}|${p}` : p;
  }
  if (cur) out[`cart_${n}`] = cur;
  return out;
}
export function decodeCartMeta(meta: Readonly<Record<string, string>> | null | undefined): CartLine[] {
  if (!meta) return [];
  const keys = Object.keys(meta).filter((k) => /^cart_\d+$/.test(k)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  const raw = keys.flatMap((k) => String(meta[k]).split("|")).map((s) => { const [handle, v, q] = s.split("~"); return { handle, variantId: Number(v), qty: Number(q) }; });
  return cleanCart(raw);
}

// ---------------------------------------------------------------------------
export function __runMerchCatalogTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL merch-site catalog-core: ${m}`); } };
  const pkg = {
    format: "greenway-goods-listing", v: 1, designId: "ds-1",
    product: { title: "Logo Tee", handle: "logo-tee", description: "Heavy <b>tee</b>.", blank: { id: "cc-1717", brand: "Comfort Colors", model: "1717", title: "Garment-Dyed Heavyweight Tee", fabric: "100% cotton" } },
    printFiles: [{ key: "front", fileType: "front", filename: "logo-tee-front-dtg.png" }],
    variants: [
      { color: "Black", size: "S", printfulVariantId: 101, inStock: true, retailCents: 3500 },
      { color: "Black", size: "2XL", printfulVariantId: 102, inStock: true, retailCents: 3700 },
      { color: "White", size: "S", printfulVariantId: 103, inStock: false, retailCents: 3500 },
      { color: "White", size: "S", printfulVariantId: 103, inStock: true, retailCents: 1 },
      { color: "", size: "M", printfulVariantId: 104, retailCents: 3500 },
    ],
    printfulOrderItem: { files: [{ type: "front", url: "", position: { area_width: 1800, area_height: 2400, width: 1800, height: 1800, top: 0, left: 0, limit_to_print_area: true } }], options: [] },
  };
  const r = normalizeListing(pkg, { siteUrl: "https://greenwaymerch.com/", order: 0 });
  const p = r.product!;
  ok(!!p && p.category === "tees" && p.handle === "logo-tee", "package -> tees product");
  ok(p.variants.length === 3, "duplicate + incomplete variants dropped");
  ok(p.minPriceCents === 3500 && p.maxPriceCents === 3700 && priceLabel(p) === "From $35.00", "price range");
  ok(p.orderItem.files[0].url === "https://greenwaymerch.com/print/logo-tee-front-dtg.png" && !!p.orderItem.files[0].position, "empty print url filled from /print/ + position kept");
  ok(!p.description.includes("<"), "angle brackets stripped");
  ok(p.images[0] === "/categories/tees.webp", "falls back to the category photo");
  ok(normalizeListing({ ...pkg, merch: { active: false } }, { siteUrl: "", order: 0 }).product === null, "merch.active false hides");
  ok(normalizeListing({ ...pkg, merch: { category: "hats", images: ["/products/a.jpg", "javascript:x"] } }, { siteUrl: "", order: 0 }).product!.category === "hats", "category override");
  ok(normalizeListing({ ...pkg, merch: { images: ["/products/a.jpg", "javascript:x"] } }, { siteUrl: "", order: 0 }).product!.images.join() === "/products/a.jpg", "unsafe images dropped");
  ok(normalizeListing({ ...pkg, format: "x" }, { siteUrl: "", order: 0 }).product === null, "wrong format refused");
  ok(normalizeListing(pkg, { siteUrl: "", order: 0 }).issues.some((i) => i.includes("no URL")), "no site url -> print-file issue");
  ok(!("orderItem" in toCard(p)) && !("designId" in toCard(p)), "card has no print data");
  const cat = buildCatalog([{ name: "a.json", data: pkg }, { name: "b.json", data: pkg }], "https://greenwaymerch.com");
  ok(cat.products.length === 1 && cat.issues.some((i) => i.includes("duplicate")), "duplicate handle skipped");
  ok(MERCH_CATEGORIES.every((c) => !CATEGORY_ALIASES[c.slug]) && Object.values(CATEGORY_ALIASES).every((s) => CATEGORY_SLUGS.includes(s)), "aliases point at real pages, never shadow one");
  ok(Object.values(BLANK_CATEGORY).every((s) => CATEGORY_SLUGS.includes(s)), "every blank maps to a page");
  ok(["tees", "hoodies", "sweatshirts", "zip-hoodies", "hats", "beanies"].every((s) => CATEGORY_SLUGS.includes(s)), "cannabis-site standard ad cards all land on real pages");

  // browse
  const p2 = { ...p, handle: "b", title: "Alpha Hoodie", minPriceCents: 5000, order: 1, colors: ["Red"], variants: [{ id: 9, color: "Red", size: "M", priceCents: 5000, inStock: true }] };
  ok(browse([p, p2], { query: "", colors: [], sizes: [], sort: "price-desc" })[0].handle === "b", "sort price-desc");
  ok(browse([p, p2], { query: "alpha", colors: [], sizes: [], sort: "featured" }).length === 1, "search");
  ok(browse([p, p2], { query: "", colors: ["White"], sizes: [], sort: "featured" }).length === 0, "colour filter ignores out-of-stock");
  ok(facetCounts([p, p2], "size").map((x) => x.value).join() === "S,M,2XL", "size facet in garment order");

  // cart
  ok(cleanCart([{ handle: "logo-tee", variantId: 101, qty: 4 }, { handle: "logo-tee", variantId: 101, qty: 9 }, { handle: "BAD HANDLE", variantId: 1, qty: 1 }, { handle: "x", variantId: 2, qty: 0 }]).map((l) => l.qty).join() === "10", "cart merges + clamps + drops junk");
  const priced = priceCart([{ handle: "logo-tee", variantId: 102, qty: 2 }, { handle: "logo-tee", variantId: 103, qty: 1 }, { handle: "gone", variantId: 1, qty: 1 }], [p]);
  ok(priced.subtotalCents === 7400 && priced.lines.length === 1 && priced.problems.length === 2, "server pricing ignores client prices, drops OOS/missing");
  const ref = makeOrderRef(1760000000000, "Ab3$xyz12345");
  ok(isOrderRef(ref) && ref.length <= 32, "order ref is a valid Printful external_id");
  const many = Array.from({ length: 20 }, (_, i) => ({ handle: `a-very-long-product-handle-number-${i}`, variantId: 100000 + i, qty: 3 }));
  const meta = encodeCartMeta(many);
  ok(Object.values(meta).every((v) => v.length <= 500) && Object.keys(meta).length > 1, "cart metadata chunks under Stripe's 500-char limit");
  ok(JSON.stringify(decodeCartMeta(meta)) === JSON.stringify(cleanCart(many)), "cart metadata round trip");
  // R73 S3: the admin's banner + card editors list exactly these catalogues with the same blurbs.
  ok(JSON.stringify(MERCH_BANNER_CATEGORIES.map((c) => [c.slug, c.label])) === JSON.stringify(MERCH_CATEGORIES.map((c) => [c.slug, c.label])), "editor categories = MERCH_CATEGORIES");
  const defaults = merchDefaults();
  ok(MERCH_CATEGORIES.every((c) => defaults[`merch.card.category.${c.slug}.blurb`] === c.blurb), "seeded blurbs = shipped blurbs");
  return { passed, failed };
}
