/**
 * R73 S7 - Merch inventory (PURE).
 *
 * Owner request (verbatim): "I also want a new page to manage all of the
 * merch inventory in a enterprise grade way. We create apparel in the merch
 * studio, save it, publish it, it shows up on the public website, at the same
 * time it's added to the merch inventory management page in the inventory
 * drop down menu."
 *
 * One store, two readers:
 *   - Merch Studio "Publish to greenwaymerch.com" writes the listing package
 *     (listing-package-core) into the catalog below (site_settings key
 *     MERCH_CATALOG_KEY, no migration).
 *   - /admin/inventory/merch lists every item + variant with live Printful
 *     stock, units sold and money from Printful orders, and can hide / show /
 *     remove items or copy Printful's stock onto the website.
 *   - greenwaymerch.com reads ONLY the live items through the secret-gated
 *     /api/merch-catalog (merchFeed below) - never the cannabis website pages
 *     (owner rule R71: "No product details can reach the main site").
 *
 * Print-on-demand: Printful makes each item after a sale, so "stock" here is
 * Printful's blank availability (US region), not shelves. Money is cents.
 */
import { LISTING_FORMAT, LISTING_LIMITS, LISTING_VERSION, centsToPrice, cleanDescription, type ListingPackage, type ListingVariant } from "@/lib/merch-studio/listing-package-core";
import { getBlank, sizesFor } from "@/lib/merch-studio/garment-catalog-core";
import { variantFor } from "@/lib/merch-studio/print-export-core";
import { unitEconomics } from "@/lib/merch-studio/fulfillment-core";

export const MERCH_CATALOG_KEY = "merch_catalog";
export const MERCH_CATALOG_LABEL = "Merch catalog - published greenwaymerch.com products (R73 S7)";
export const MERCH_CATALOG_MAX_ITEMS = 200;
export const MERCH_ITEM_MAX_IMAGES = 8;

export type MerchItemStatus = "live" | "hidden";
export const MERCH_STATUS_LABELS: Record<MerchItemStatus, string> = { live: "Live on greenwaymerch.com", hidden: "Hidden" };

export interface MerchCatalogItem {
  handle: string;
  status: MerchItemStatus;
  /** Product photos (https) shown on the merch site; empty = category photo. */
  images: string[];
  /** D282: per-colour photo sets (colour name -> https urls); the PDP swaps sets when the colour changes. */
  colorImages: Record<string, string[]>;
  publishedAt: string;
  updatedAt: string;
  byEmail: string | null;
  /** Last time Printful stock was copied onto the variants ("" = never). */
  stockSyncedAt: string;
  pkg: ListingPackage;
}
export interface MerchCatalog { v: 1; items: MerchCatalogItem[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v : "").trim().slice(0, max);
export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
/** https only, no spaces / quotes / angle brackets (same bar as the merch site's safeImage). */
export const safeHttpsUrl = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^https:\/\/[^\s"'<>\\]+$/.test(s) && s.length <= 500 ? s : "";
};

/** A stored/submitted package is usable only with the right header and at least one variant. */
export function isListingPackage(v: unknown): v is ListingPackage {
  if (!isObj(v) || v.format !== LISTING_FORMAT || v.v !== LISTING_VERSION) return false;
  const p = isObj(v.product) ? v.product : null;
  return !!p && HANDLE_RE.test(str(p.handle, 60)) && !!str(p.title, 80) && Array.isArray(v.variants) && v.variants.length > 0 && isObj(v.printfulOrderItem);
}

/** D282: media tags that let Publish auto-match saved mockups to a garment + colour. */
export const tagSlug = (v: unknown, max = 40): string => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max);
export function mockupTags(blankId: string, color: string, view: string, design: string): string[] {
  return ["merch-mockup", `blank-${tagSlug(blankId)}`, `color-${tagSlug(color)}`, `view-${tagSlug(view)}`, `design-${tagSlug(design)}`].filter((t) => !/-$/.test(t));
}
/** Clean a colour -> photos map: only listed colours, https only, max 8 each. */
export function cleanColorImages(raw: unknown, colors: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!isObj(raw)) return out;
  for (const c of colors) {
    const list = Array.isArray(raw[c]) ? (raw[c] as unknown[]).map(safeHttpsUrl).filter(Boolean) : [];
    const uniq = Array.from(new Set(list)).slice(0, MERCH_ITEM_MAX_IMAGES);
    if (uniq.length) out[c] = uniq;
  }
  return out;
}
/** Saved media (newest first) -> colour -> photos for one garment (+ design when tagged), oldest-first within a colour. */
export function matchMockups(media: readonly { url: string; tags?: readonly string[] | null }[], blankId: string, colors: readonly string[], design?: string): Record<string, string[]> {
  const blank = `blank-${tagSlug(blankId)}`;
  const want = design ? `design-${tagSlug(design)}` : "";
  const pool = media.filter((m) => (m.tags ?? []).includes("merch-mockup") && (m.tags ?? []).includes(blank));
  const mine = want && pool.some((m) => (m.tags ?? []).includes(want)) ? pool.filter((m) => (m.tags ?? []).includes(want)) : pool;
  const raw: Record<string, string[]> = {};
  for (const c of colors) raw[c] = mine.filter((m) => (m.tags ?? []).includes(`color-${tagSlug(c)}`)).map((m) => m.url).reverse();
  return cleanColorImages(raw, colors);
}

export function emptyCatalog(): MerchCatalog { return { v: 1, items: [] }; }

/** Anything from the database -> a clean catalog (bad rows dropped, duplicates keep the first). */
export function normalizeCatalog(raw: unknown): MerchCatalog {
  const out = emptyCatalog();
  const list = isObj(raw) && Array.isArray(raw.items) ? raw.items : [];
  const seen = new Set<string>();
  for (const r of list) {
    if (!isObj(r) || !isListingPackage(r.pkg)) continue;
    const handle = r.pkg.product.handle;
    if (seen.has(handle)) continue;
    seen.add(handle);
    out.items.push({
      handle,
      status: r.status === "hidden" ? "hidden" : "live",
      images: (Array.isArray(r.images) ? r.images : []).map(safeHttpsUrl).filter(Boolean).slice(0, MERCH_ITEM_MAX_IMAGES),
      colorImages: cleanColorImages(r.colorImages, Array.from(new Set(r.pkg.variants.map((x) => x.color)))),
      publishedAt: str(r.publishedAt, 40),
      updatedAt: str(r.updatedAt, 40),
      byEmail: typeof r.byEmail === "string" ? r.byEmail.slice(0, 254) : null,
      stockSyncedAt: str(r.stockSyncedAt, 40),
      pkg: r.pkg,
    });
    if (out.items.length >= MERCH_CATALOG_MAX_ITEMS) break;
  }
  return out;
}

/**
 * Publish (or re-publish) one package. Re-publishing replaces the package but
 * KEEPS the item's status (a Hidden product stays Hidden) and its last Printful
 * stock copy: variants that were already synced keep their in-stock flag and
 * stockSyncedAt is kept (D232 M-5, G-82 / F-11-7). `prev` is the item it replaced.
 */
export function upsertItem(c: MerchCatalog, input: { pkg: ListingPackage; images: readonly string[]; colorImages?: Record<string, string[]>; byEmail: string | null; nowIso: string }): { ok: true; catalog: MerchCatalog; created: boolean; prev: MerchCatalogItem | null; item: MerchCatalogItem } | { ok: false; error: string } {
  if (!isListingPackage(input.pkg)) return { ok: false, error: "That isn't a complete listing package." };
  const handle = input.pkg.product.handle;
  const prev = c.items.find((i) => i.handle === handle);
  if (!prev && c.items.length >= MERCH_CATALOG_MAX_ITEMS) return { ok: false, error: `The catalog is full (${MERCH_CATALOG_MAX_ITEMS} products). Remove an old one first.` };
  if (prev && prev.pkg.designId && input.pkg.designId && prev.pkg.designId !== input.pkg.designId) {
    return { ok: false, error: `Another design is already published as "${handle}". Change the product title so it gets its own web address.` };
  }
  // G-82: carry the last stock copy onto the new variants (same Printful variant id).
  const synced = prev && prev.stockSyncedAt ? new Map(prev.pkg.variants.map((v) => [v.printfulVariantId, v.inStock])) : null;
  const pkg: ListingPackage = synced ? { ...input.pkg, variants: input.pkg.variants.map((v) => (synced.has(v.printfulVariantId) ? { ...v, inStock: synced.get(v.printfulVariantId)! } : v)) } : input.pkg;
  const item: MerchCatalogItem = {
    handle,
    status: prev?.status ?? "live",
    images: input.images.map(safeHttpsUrl).filter(Boolean).slice(0, MERCH_ITEM_MAX_IMAGES),
    colorImages: cleanColorImages(input.colorImages, Array.from(new Set(pkg.variants.map((x) => x.color)))),
    publishedAt: prev?.publishedAt || input.nowIso,
    updatedAt: input.nowIso,
    byEmail: input.byEmail,
    stockSyncedAt: prev?.stockSyncedAt ?? "",
    pkg,
  };
  const items = prev ? c.items.map((i) => (i.handle === handle ? item : i)) : [...c.items, item];
  return { ok: true, catalog: { v: 1, items }, created: !prev, prev: prev ?? null, item };
}

export function setItemStatus(c: MerchCatalog, handle: string, status: MerchItemStatus, nowIso: string): MerchCatalog | null {
  if (!c.items.some((i) => i.handle === handle)) return null;
  return { v: 1, items: c.items.map((i) => (i.handle === handle ? { ...i, status, updatedAt: nowIso } : i)) };
}

/**
 * D284: edit a published product from Merch Inventory - title, description,
 * retail per size (every colour), and which sizes are offered. A size can be
 * added back when the garment makes it in a listed colour; its Printful cost is
 * the listed colour's cost moved by Printful's size difference. Profit keeps the
 * shipping gap the package was priced with. The web address (handle), print
 * files and colours stay. Returns an error string on a bad edit.
 */
export interface MerchItemEdit { title: string; description: string; sizes: readonly string[]; prices: Readonly<Record<string, number>> }
export function editItem(c: MerchCatalog, handle: string, e: MerchItemEdit, nowIso: string): MerchCatalog | string {
  const item = c.items.find((i) => i.handle === handle);
  if (!item) return "That product isn't in the catalog any more.";
  const title = str(e.title, LISTING_LIMITS.title).replace(/[<>]/g, " ");
  if (!title) return "Add a product title.";
  const b = getBlank(item.pkg.product.blank.id);
  const sizeBase = new Map((b ? sizesFor(b) : []).map((z) => [z[0], z[1]] as const));
  const order = b ? sizesFor(b).map((z) => z[0]) : [...new Set(item.pkg.variants.map((v) => v.size))];
  const want = order.filter((z) => e.sizes.includes(z));
  if (!want.length) return "Keep at least one size.";
  const colors = [...new Set(item.pkg.variants.map((v) => v.color))];
  const variants: ListingVariant[] = [];
  const loss: string[] = [];
  for (const color of colors) {
    const same = item.pkg.variants.filter((v) => v.color === color);
    for (const size of want) {
      const old = same.find((v) => v.size === size);
      let base: ListingVariant | null = old ?? null;
      if (!base && b && same.length) {
        const row = variantFor(b, color, size);
        const ref = same[0];
        if (!row) continue;
        const cost = ref.printfulCents + (sizeBase.get(size) ?? 0) - (sizeBase.get(ref.size) ?? 0);
        base = { ...ref, size, printfulVariantId: row[2], inStock: row[4], printfulCents: Math.max(0, cost) };
      }
      if (!base) continue;
      const ref = old ?? same[0];
      const gap = unitEconomics({ retailCents: ref.retailCents, printfulCents: ref.printfulCents, shippingChargedCents: 0, shippingCostCents: 0 }).profitCents - ref.profitCents;
      const retail = Math.round(e.prices[size] ?? 0) > 0 ? Math.round(e.prices[size]) : base.retailCents;
      const ec = unitEconomics({ retailCents: retail, printfulCents: base.printfulCents, shippingChargedCents: 0, shippingCostCents: 0 });
      const profit = ec.profitCents - Math.max(0, gap);
      if (profit <= 0) loss.push(`${color} ${size}`);
      variants.push({ ...base, retailCents: retail, cardFeeCents: ec.cardFeeCents, profitCents: profit, marginBps: retail > 0 ? Math.round((profit / retail) * 10000) : 0 });
    }
  }
  if (!variants.length) return "Printful doesn't make those sizes in this product's colours.";
  if (loss.length) return `That price sells at a loss for ${loss.slice(0, 4).join(", ")}${loss.length > 4 ? "..." : ""}. Raise it above the Printful cost plus the card fee.`;
  const sv = item.pkg.printfulSyncProduct.sync_variants[0];
  const pkg: ListingPackage = {
    ...item.pkg,
    product: { ...item.pkg.product, title, description: cleanDescription(e.description) },
    variants,
    printfulSyncProduct: { sync_product: { name: title }, sync_variants: variants.map((v) => ({ variant_id: v.printfulVariantId, retail_price: centsToPrice(v.retailCents), files: sv?.files ?? [], options: sv?.options ?? [] })) },
  };
  return { v: 1, items: c.items.map((i) => (i.handle === handle ? { ...i, pkg, updatedAt: nowIso } : i)) };
}

export function removeItem(c: MerchCatalog, handle: string): MerchCatalog | null {
  if (!c.items.some((i) => i.handle === handle)) return null;
  return { v: 1, items: c.items.filter((i) => i.handle !== handle) };
}

/**
 * What greenwaymerch.com receives: live items only, as listing packages with
 * the merch-site's optional `merch` block (images). The Printful sync-product
 * body and notes are left out (the site never uses them).
 */
export function merchFeed(c: MerchCatalog): { name: string; data: Record<string, unknown> }[] {
  return c.items.filter((i) => i.status === "live").map((i) => {
    const { printfulSyncProduct: _s, notes: _n, ...rest } = i.pkg; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { name: `studio-${i.handle}.json`, data: { ...rest, ...(i.images.length || Object.keys(i.colorImages ?? {}).length ? { merch: { images: i.images, ...(Object.keys(i.colorImages ?? {}).length ? { colorImages: i.colorImages } : {}) } } : {}) } };
  });
}

// ---------------------------------------------------------------------------
// Printful stock (GET /products/{id}: variants[].in_stock + availability_status[{region,status}])
// ---------------------------------------------------------------------------
export type StockStatus = "in_stock" | "stocked_on_demand" | "out_of_stock" | "discontinued" | "not_fulfillable" | "unconfirmed" | "unknown";
export const STOCK_LABELS: Record<StockStatus, string> = {
  in_stock: "In stock", stocked_on_demand: "Made to order", out_of_stock: "Out of stock", discontinued: "Discontinued",
  not_fulfillable: "Not fulfillable", unconfirmed: "Printful unsure", unknown: "Not checked",
};
/** D285: only a definite yes sells; Printful's own "unknown" (unconfirmed) is hidden. */
export const stockSellable = (s: StockStatus) => s === "in_stock" || s === "stocked_on_demand";
/** Keys: `${variantId}` (any technique, v1) or `${variantId}:${technique}` (v2). */
export type StockMap = Map<string, StockStatus>;

/** Studio print method -> Printful v2 technique. */
export const pfTechnique = (method: string) => (method === "dtf" ? "dtfilm" : method === "embroidery" ? "embroidery" : "dtg");
/** Distinct Printful techniques a package prints with (dtg when it has no files). */
export function techniquesFor(pkg: { printFiles?: readonly { method: string }[] }): string[] {
  const t = [...new Set((pkg.printFiles ?? []).map((f) => pfTechnique(f.method)))];
  return t.length ? t : ["dtg"];
}
const WORST: StockStatus[] = ["discontinued", "not_fulfillable", "out_of_stock", "unconfirmed", "stocked_on_demand", "in_stock"];
/** The variant's status for these techniques: the worst v2 answer when every technique answered, else the v1 answer. */
export function stockFor(map: ReadonlyMap<string, StockStatus>, variantId: number, techniques: readonly string[]): StockStatus {
  const v2 = techniques.map((t) => map.get(`${variantId}:${t}`));
  if (v2.length && v2.every(Boolean)) return WORST.find((w) => v2.includes(w)) ?? "unknown";
  return map.get(String(variantId)) ?? "unknown";
}

/** Printful product variants -> variantId -> US status (falls back to the in_stock flag). */
export function stockFromPrintful(raw: unknown): StockMap {
  const out: StockMap = new Map();
  const variants = isObj(raw) && Array.isArray(raw.variants) ? raw.variants : [];
  const known: StockStatus[] = ["in_stock", "stocked_on_demand", "out_of_stock", "discontinued"];
  for (const v of variants) {
    if (!isObj(v) || typeof v.id !== "number") continue;
    const us = (Array.isArray(v.availability_status) ? v.availability_status : []).find((a) => isObj(a) && a.region === "US") as Record<string, unknown> | undefined;
    const s = us && known.includes(us.status as StockStatus) ? (us.status as StockStatus) : typeof v.in_stock === "boolean" ? (v.in_stock ? "in_stock" : "out_of_stock") : "unknown";
    out.set(String(v.id), s);
  }
  return out;
}

const V2_STATUS: Record<string, StockStatus> = { "in stock": "in_stock", "out of stock": "out_of_stock", "not fulfillable": "not_fulfillable", unknown: "unconfirmed" };
/**
 * D285: Printful v2 availability rows (GET /v2/catalog-products/{id}/availability
 * or the catalog_stock_updated webhook data[]) -> `${variantId}:${technique}`
 * for the north_america selling region. Unrecognised answers -> unconfirmed.
 */
export function stockFromV2(rows: unknown, region = "north_america"): StockMap {
  const out: StockMap = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!isObj(r) || typeof r.catalog_variant_id !== "number") continue;
    for (const t of Array.isArray(r.techniques) ? r.techniques : []) {
      if (!isObj(t) || typeof t.technique !== "string") continue;
      const sr = (Array.isArray(t.selling_regions) ? t.selling_regions : []).find((x) => isObj(x) && x.name === region) as Record<string, unknown> | undefined;
      if (!sr) continue;
      out.set(`${r.catalog_variant_id}:${t.technique}`, V2_STATUS[String(sr.availability)] ?? "unconfirmed");
    }
  }
  return out;
}

export interface WentOut { handle: string; title: string; color: string; size: string; variantId: number; status: StockStatus }

/** Copy Printful's stock onto every variant's inStock (what the merch site shows). */
export function applyStock(c: MerchCatalog, stock: ReadonlyMap<string, StockStatus>, nowIso: string): { catalog: MerchCatalog; changed: number; checked: number; wentOut: WentOut[] } {
  let changed = 0; let checked = 0;
  const wentOut: WentOut[] = [];
  const items = c.items.map((i) => {
    let touched = false;
    const tech = techniquesFor(i.pkg);
    const variants = i.pkg.variants.map((v) => {
      const s = stockFor(stock, v.printfulVariantId, tech);
      if (s === "unknown") return v;
      checked += 1; touched = true;
      const inStock = stockSellable(s);
      if (inStock === v.inStock) return v;
      changed += 1;
      if (!inStock && i.status === "live") wentOut.push({ handle: i.handle, title: i.pkg.product.title, color: v.color, size: v.size, variantId: v.printfulVariantId, status: s });
      return { ...v, inStock };
    });
    return touched ? { ...i, stockSyncedAt: nowIso, pkg: { ...i.pkg, variants } } : i;
  });
  return { catalog: { v: 1, items }, changed, checked, wentOut };
}

// ---------------------------------------------------------------------------
// D285 nightly cost check (Printful POST /orders/estimate-costs, free, v1)
// ---------------------------------------------------------------------------
/** costs.subtotal ("12.34") of an estimate-costs result -> cents, or null. */
export function estimateSubtotalCents(raw: unknown): number | null {
  const c = isObj(raw) && isObj(raw.costs) ? raw.costs : null;
  const n = c ? Number(c.subtotal) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}
export interface CostCheck { handle: string; title: string; color: string; size: string; variantId: number; retailCents: number; profitCents: number; savedCents: number; nowCents: number }
export interface CostDrift extends CostCheck { deltaCents: number; newProfitCents: number; newMarginBps: number }
/** One probe per live product: its priciest variant (size upcharges show up there). */
export function costProbes(c: MerchCatalog): { handle: string; title: string; v: ListingVariant; files: unknown; options: unknown }[] {
  return c.items.filter((i) => i.status === "live" && i.pkg.variants.length).map((i) => {
    const v = [...i.pkg.variants].sort((a, b) => b.printfulCents - a.printfulCents)[0];
    return { handle: i.handle, title: i.pkg.product.title, v, files: i.pkg.printfulOrderItem?.files ?? [], options: i.pkg.printfulOrderItem?.options ?? [] };
  });
}
/** Printful now charges more (or less) than when published: |delta| >= max(25c, 3%). */
export function costDrifts(checks: readonly CostCheck[]): CostDrift[] {
  return checks.flatMap((c) => {
    const d = c.nowCents - c.savedCents;
    if (Math.abs(d) < Math.max(25, Math.round(c.savedCents * 0.03))) return [];
    const np = c.profitCents - d;
    return [{ ...c, deltaCents: d, newProfitCents: np, newMarginBps: c.retailCents > 0 ? Math.round((np / c.retailCents) * 10000) : 0 }];
  });
}

// ---------------------------------------------------------------------------
// Sales from Printful orders (merch-orders-core MerchOrder, structurally)
// ---------------------------------------------------------------------------
export interface SalesOrderLike { printfulStatus: string; items: { variantId: number | null; quantity: number; retailCents: number | null; costCents: number | null }[] }
export interface VariantSales { units: number; revenueCents: number; costCents: number }
/** Printful statuses that are not a sale. */
export const NOT_A_SALE = new Set(["canceled", "failed"]);

export function salesByVariant(orders: readonly SalesOrderLike[]): Map<number, VariantSales> {
  const out = new Map<number, VariantSales>();
  for (const o of orders) {
    if (NOT_A_SALE.has(o.printfulStatus)) continue;
    for (const it of o.items) {
      if (typeof it.variantId !== "number" || !(it.quantity > 0)) continue;
      const cur = out.get(it.variantId) ?? { units: 0, revenueCents: 0, costCents: 0 };
      cur.units += it.quantity;
      cur.revenueCents += (it.retailCents ?? 0) * it.quantity;
      cur.costCents += (it.costCents ?? 0) * it.quantity;
      out.set(it.variantId, cur);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Page view model
// ---------------------------------------------------------------------------
export interface InventoryVariantRow {
  handle: string; title: string; color: string; size: string; variantId: number;
  retailCents: number; printfulCents: number; profitCents: number; marginBps: number;
  onSite: boolean; stock: StockStatus; stockLabel: string; mismatch: boolean;
  units: number; revenueCents: number;
}
export interface InventoryProductRow {
  handle: string; title: string; status: MerchItemStatus; blank: string; image: string;
  colors: number; sizes: number; variants: number; sellable: number; outOfStock: number; mismatches: number;
  minRetailCents: number; maxRetailCents: number; units: number; revenueCents: number; costCents: number;
  publishedAt: string; updatedAt: string; stockSyncedAt: string; byEmail: string | null;
}
export interface InventoryView {
  products: InventoryProductRow[];
  variants: InventoryVariantRow[];
  totals: { products: number; live: number; hidden: number; variants: number; outOfStock: number; mismatches: number; units: number; revenueCents: number; costCents: number };
}

export function inventoryView(c: MerchCatalog, stock: ReadonlyMap<string, StockStatus>, sales: ReadonlyMap<number, VariantSales>): InventoryView {
  const variants: InventoryVariantRow[] = [];
  const products: InventoryProductRow[] = c.items.map((i) => {
    const tech = techniquesFor(i.pkg);
    const rows = i.pkg.variants.map((v): InventoryVariantRow => {
      const s = stockFor(stock, v.printfulVariantId, tech);
      const sale = sales.get(v.printfulVariantId);
      return {
        handle: i.handle, title: i.pkg.product.title, color: v.color, size: v.size, variantId: v.printfulVariantId,
        retailCents: v.retailCents, printfulCents: v.printfulCents, profitCents: v.profitCents, marginBps: v.marginBps,
        onSite: v.inStock, stock: s, stockLabel: s === "not_fulfillable" || s === "unconfirmed" ? `${STOCK_LABELS[s]} (${tech.join(" + ")})` : STOCK_LABELS[s], mismatch: s !== "unknown" && stockSellable(s) !== v.inStock,
        units: sale?.units ?? 0, revenueCents: sale?.revenueCents ?? 0,
      };
    });
    variants.push(...rows);
    const costCents = i.pkg.variants.reduce((n, v) => n + (sales.get(v.printfulVariantId)?.costCents ?? 0), 0);
    const prices = rows.map((r) => r.retailCents);
    const b = i.pkg.product.blank;
    return {
      handle: i.handle, title: i.pkg.product.title, status: i.status, blank: [b.brand, b.model].filter(Boolean).join(" "), image: i.images[0] ?? "",
      colors: new Set(rows.map((r) => r.color)).size, sizes: new Set(rows.map((r) => r.size)).size, variants: rows.length,
      sellable: rows.filter((r) => (r.stock === "unknown" ? r.onSite : stockSellable(r.stock))).length,
      outOfStock: rows.filter((r) => r.stock !== "unknown" && !stockSellable(r.stock)).length,
      mismatches: rows.filter((r) => r.mismatch).length,
      minRetailCents: prices.length ? Math.min(...prices) : 0, maxRetailCents: prices.length ? Math.max(...prices) : 0,
      units: rows.reduce((n, r) => n + r.units, 0), revenueCents: rows.reduce((n, r) => n + r.revenueCents, 0), costCents,
      publishedAt: i.publishedAt, updatedAt: i.updatedAt, stockSyncedAt: i.stockSyncedAt, byEmail: i.byEmail,
    };
  });
  return {
    products, variants,
    totals: {
      products: products.length, live: products.filter((p) => p.status === "live").length, hidden: products.filter((p) => p.status === "hidden").length,
      variants: variants.length, outOfStock: products.reduce((n, p) => n + p.outOfStock, 0), mismatches: products.reduce((n, p) => n + p.mismatches, 0),
      units: products.reduce((n, p) => n + p.units, 0), revenueCents: products.reduce((n, p) => n + p.revenueCents, 0), costCents: products.reduce((n, p) => n + p.costCents, 0),
    },
  };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // spreadsheet formula injection guard
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const dollars = (c: number) => (c / 100).toFixed(2);

/** One row per variant, ready for Excel / Sheets. */
export function inventoryCsv(v: InventoryView): string {
  const status = new Map(v.products.map((p) => [p.handle, p.status]));
  const head = ["Product", "Handle", "Status", "Colour", "Size", "Printful variant", "Retail", "Printful cost", "Profit / unit", "Margin %", "On website", "Printful stock", "Units sold", "Revenue"];
  const lines = v.variants.map((r) => [r.title, r.handle, status.get(r.handle) ?? "", r.color, r.size, r.variantId, dollars(r.retailCents), dollars(r.printfulCents), dollars(r.profitCents), (r.marginBps / 100).toFixed(1), r.onSite ? "yes" : "no", r.stockLabel, r.units, dollars(r.revenueCents)]);
  return [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Print files for live products (public `media` bucket, merch-print/ prefix)
// ---------------------------------------------------------------------------
export const PRINT_KEY_RE = /^merch-print\/[a-z0-9-]{1,60}\/[a-f0-9]{12}\/[a-z0-9_]{1,40}\.png$/;
export function printKey(handle: string, nonce: string, fileKey: string): string | null {
  const k = `merch-print/${handle}/${nonce}/${String(fileKey).toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40)}.png`;
  return HANDLE_RE.test(handle) && PRINT_KEY_RE.test(k) ? k : null;
}
/** The storage key behind a public media URL we issued, or null. */
export function printKeyFromUrl(url: string, publicPrefix: string): string | null {
  const prefix = publicPrefix.replace(/\/+$/, "") + "/";
  if (!url.startsWith(prefix)) return null;
  const k = url.slice(prefix.length);
  return PRINT_KEY_RE.test(k) ? k : null;
}
/**
 * D232 M-5 (G-93 / F-11-15): after a re-publish is SAVED, the previous print
 * PNGs that the new package no longer uses. Only our own keys under
 * merch-print/<handle>/ are ever returned; a key the new package still uses is kept.
 */
export function stalePrintKeys(prev: MerchCatalogItem | null, next: MerchCatalogItem, publicPrefix: string): string[] {
  if (!prev) return [];
  const keep = new Set(next.pkg.printFiles.map((f) => printKeyFromUrl(f.url, publicPrefix)).filter(Boolean));
  const own = `merch-print/${next.handle}/`;
  return [...new Set(prev.pkg.printFiles.map((f) => printKeyFromUrl(f.url, publicPrefix)).filter((k): k is string => !!k && k.startsWith(own) && !keep.has(k)))];
}
/** G-88: the loser of two catalog writes at the same time. */
export const MERCH_CATALOG_CONFLICT = "Someone else changed the catalog - reload and try again.";

export function __runMerchInventoryTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else failures.push(m); };
  const v = (id: number, color: string, size: string, inStock = true) => ({ color, size, printfulVariantId: id, inStock, printfulCents: 1500, retailCents: 3500, cardFeeCents: 132, profitCents: 1868, marginBps: 5337 });
  const pkg = (handle: string, designId = "ds-1"): ListingPackage => ({
    format: LISTING_FORMAT, v: LISTING_VERSION, generatedAt: "2026-01-01T00:00:00.000Z", catalogSnapshot: "x", seller: "s", payments: "p", designId,
    product: { title: "Logo Tee", handle, description: "", blank: { id: "cc-1717", printfulProductId: 586, brand: "Comfort Colors", model: "1717", title: "Tee", fabric: "" } },
    printFiles: [], variants: [v(1, "Black", "S"), v(2, "Black", "M"), v(3, "White", "S", false)],
    printfulSyncProduct: { sync_product: { name: "x" }, sync_variants: [] }, printfulOrderItem: { files: [], options: [] }, notes: ["n"],
  });
  const now = "2026-02-01T00:00:00.000Z";

  ok(isListingPackage(pkg("logo-tee")), "valid package accepted");
  ok(!isListingPackage({ ...pkg("logo-tee"), format: "x" }) && !isListingPackage(pkg("Bad Handle")) && !isListingPackage(null), "bad packages refused");
  const a = upsertItem(emptyCatalog(), { pkg: pkg("logo-tee"), images: ["https://x.example/a.jpg", "javascript:alert(1)", "http://x/b.jpg"], byEmail: "o@x", nowIso: now });
  ok(a.ok && a.created && a.catalog.items.length === 1 && a.catalog.items[0].status === "live", "publish adds a live item");
  const c1 = a.ok ? a.catalog : emptyCatalog();
  ok(c1.items[0].images.join() === "https://x.example/a.jpg", "only https images kept");
  const hid = setItemStatus(c1, "logo-tee", "hidden", now)!;
  const re = upsertItem(hid, { pkg: pkg("logo-tee"), images: [], byEmail: null, nowIso: "2026-03-01T00:00:00.000Z" });
  ok(re.ok && !re.created && re.catalog.items.length === 1 && re.catalog.items[0].status === "hidden" && re.catalog.items[0].publishedAt === now && re.prev?.status === "hidden", "re-publish replaces, KEEPS Hidden (G-82), keeps first publish date");
  const reLive = upsertItem(c1, { pkg: pkg("logo-tee"), images: [], byEmail: null, nowIso: "2026-03-01T00:00:00.000Z" });
  ok(reLive.ok && reLive.catalog.items[0].status === "live", "re-publish of a live product stays live");
  const clash = upsertItem(c1, { pkg: pkg("logo-tee", "ds-other"), images: [], byEmail: null, nowIso: now });
  ok(!clash.ok, "a different design can't take an existing web address");
  ok(setItemStatus(c1, "nope", "hidden", now) === null && removeItem(c1, "nope") === null, "unknown handle -> null");
  ok(removeItem(c1, "logo-tee")!.items.length === 0, "remove");

  const round = normalizeCatalog(JSON.parse(JSON.stringify({ v: 1, items: [...c1.items, c1.items[0], { pkg: { format: "x" } }, "junk"] })));
  ok(round.items.length === 1 && round.items[0].handle === "logo-tee", "normalize drops junk + duplicates");
  ok(normalizeCatalog(null).items.length === 0 && normalizeCatalog({ items: "x" }).items.length === 0, "normalize tolerates garbage");

  const two = upsertItem(c1, { pkg: pkg("cap", "ds-2"), images: [], byEmail: null, nowIso: now });
  const c2 = setItemStatus(two.ok ? two.catalog : c1, "cap", "hidden", now)!;
  const feed = merchFeed(c2);
  ok(feed.length === 1 && feed[0].name === "studio-logo-tee.json", "feed = live items only");
  ok(!("printfulSyncProduct" in feed[0].data) && !("notes" in feed[0].data) && (feed[0].data.merch as { images: string[] }).images[0] === "https://x.example/a.jpg", "feed strips sync body + notes, carries images");
  ok(feed[0].data.format === LISTING_FORMAT && Array.isArray(feed[0].data.variants), "feed is still a listing package");

  const pf = { variants: [
    { id: 1, in_stock: true, availability_status: [{ region: "EU", status: "out_of_stock" }, { region: "US", status: "in_stock" }] },
    { id: 2, in_stock: true, availability_status: [{ region: "US", status: "discontinued" }] },
    { id: 3, in_stock: true, availability_status: [{ region: "US", status: "stocked_on_demand" }] },
    { id: 4, in_stock: false },
    { id: "x" },
  ] };
  const st = stockFromPrintful(pf);
  ok(st.get("1") === "in_stock" && st.get("2") === "discontinued" && st.get("3") === "stocked_on_demand" && st.get("4") === "out_of_stock" && st.size === 4, "US region status read, in_stock fallback");
  ok(stockFromPrintful(null).size === 0, "no product -> empty");
  const ap = applyStock(c1, st, now);
  const vs = ap.catalog.items[0].pkg.variants;
  ok(ap.checked === 3 && ap.changed === 2 && vs[1].inStock === false && vs[2].inStock === true && ap.catalog.items[0].stockSyncedAt === now, "stock copied onto variants");
  ok(applyStock(c1, new Map(), now).catalog.items[0].stockSyncedAt === "", "nothing checked -> untouched");
  const reg = (a: string) => [{ name: "europe", availability: "in stock" }, { name: "north_america", availability: a }];
  const v2 = stockFromV2([
    { catalog_variant_id: 1, techniques: [{ technique: "dtg", selling_regions: reg("in stock") }, { technique: "embroidery", selling_regions: reg("not fulfillable") }] },
    { catalog_variant_id: 2, techniques: [{ technique: "dtg", selling_regions: reg("unknown") }] },
    { catalog_variant_id: 3, techniques: [{ technique: "dtg", selling_regions: reg("out of stock") }] },
    { catalog_variant_id: 9, techniques: [{ technique: "dtg", selling_regions: [{ name: "europe", availability: "in stock" }] }] }, { bad: 1 },
  ]);
  ok(v2.get("1:dtg") === "in_stock" && v2.get("1:embroidery") === "not_fulfillable" && v2.get("2:dtg") === "unconfirmed" && v2.get("3:dtg") === "out_of_stock" && v2.size === 4, "v2 availability read for north_america per technique");
  ok(pfTechnique("dtf") === "dtfilm" && techniquesFor({ printFiles: [] }).join() === "dtg" && techniquesFor({ printFiles: [{ method: "embroidery" }, { method: "dtg" }, { method: "dtg" }] }).join() === "embroidery,dtg", "studio method -> Printful technique");
  ok(stockFor(v2, 1, ["dtg"]) === "in_stock" && stockFor(v2, 1, ["dtg", "embroidery"]) === "not_fulfillable" && stockFor(new Map([["5", "in_stock"]]), 5, ["dtg"]) === "in_stock" && stockFor(v2, 7, ["dtg"]) === "unknown", "worst technique wins, v1 fallback, missing = not checked");
  const ap2 = applyStock(c1, new Map([["1", "in_stock"], ["2", "unconfirmed"], ["3", "in_stock"]]), now);
  ok(!stockSellable("unconfirmed") && !stockSellable("not_fulfillable") && ap2.catalog.items[0].pkg.variants[1].inStock === false, "Printful unsure / not fulfillable are hidden");
  ok(estimateSubtotalCents({ costs: { subtotal: "13.95", total: "20" } }) === 1395 && estimateSubtotalCents({ costs: {} }) === null && estimateSubtotalCents(null) === null, "estimate-costs subtotal -> cents");
  const base = { handle: "h", title: "T", color: "B", size: "M", variantId: 1, retailCents: 3500, profitCents: 1500 };
  const dr = costDrifts([{ ...base, savedCents: 1300, nowCents: 1400 }, { ...base, savedCents: 1300, nowCents: 1310 }, { ...base, savedCents: 1300, nowCents: 1200 }]);
  ok(dr.length === 2 && dr[0].deltaCents === 100 && dr[0].newProfitCents === 1400 && dr[0].newMarginBps === 4000 && dr[1].deltaCents === -100, "cost drift: rises and drops past 25c/3% flagged, noise ignored");
  ok(costProbes(c1).every((p) => p.v.printfulCents === Math.max(...c1.items.find((i) => i.handle === p.handle)!.pkg.variants.map((v) => v.printfulCents))), "cost probe = priciest variant of each live product");
  ok(ap2.wentOut.length === (c1.items[0].status === "live" && c1.items[0].pkg.variants[1].inStock ? 1 : 0), "live variants that go out are reported");
  const reSynced = upsertItem(ap.catalog, { pkg: pkg("logo-tee"), images: [], byEmail: null, nowIso: "2026-03-01T00:00:00.000Z" });
  ok(reSynced.ok && reSynced.catalog.items[0].stockSyncedAt === now && reSynced.catalog.items[0].pkg.variants[1].inStock === false && reSynced.catalog.items[0].pkg.variants[2].inStock === true, "re-publish keeps the stock copy and its date (G-82)");
  const pubPre = "https://p.example/storage/v1/object/public/media";
  const withFiles = (n: string) => ({ ...pkg("logo-tee"), printFiles: [{ key: "front", fileType: "front", method: "dtg", filename: "f.png", dpi: 300, pxW: 1, pxH: 1, position: { area_width: 1, area_height: 1, width: 1, height: 1, top: 0, left: 0 }, url: `${pubPre}/merch-print/logo-tee/${n}/front.png` }] }) as ListingPackage;
  const o1 = upsertItem(emptyCatalog(), { pkg: withFiles("aaaaaaaaaaaa"), images: [], byEmail: null, nowIso: now });
  const o2 = o1.ok ? upsertItem(o1.catalog, { pkg: withFiles("bbbbbbbbbbbb"), images: [], byEmail: null, nowIso: now }) : o1;
  ok(o2.ok && stalePrintKeys(o2.prev, o2.item, pubPre).join() === "merch-print/logo-tee/aaaaaaaaaaaa/front.png", "old nonce folder is stale after re-publish (G-93)");
  ok(o1.ok && stalePrintKeys(o1.prev, o1.item, pubPre).length === 0, "first publish deletes nothing");
  const o3 = o1.ok ? upsertItem(o1.catalog, { pkg: withFiles("aaaaaaaaaaaa"), images: [], byEmail: null, nowIso: now }) : o1;
  ok(o3.ok && stalePrintKeys(o3.prev, o3.item, pubPre).length === 0, "a key still in use is kept");

  const sales = salesByVariant([
    { printfulStatus: "fulfilled", items: [{ variantId: 1, quantity: 2, retailCents: 3500, costCents: 1500 }, { variantId: null, quantity: 1, retailCents: 1, costCents: 1 }] },
    { printfulStatus: "draft", items: [{ variantId: 1, quantity: 1, retailCents: 3500, costCents: null }] },
    { printfulStatus: "canceled", items: [{ variantId: 2, quantity: 5, retailCents: 3500, costCents: 1500 }] },
  ]);
  ok(sales.get(1)!.units === 3 && sales.get(1)!.revenueCents === 10500 && sales.get(1)!.costCents === 3000 && !sales.has(2), "sales add up, cancelled ignored");

  const view = inventoryView(c1, st, sales);
  ok(view.totals.products === 1 && view.totals.variants === 3 && view.totals.units === 3 && view.totals.revenueCents === 10500, "view totals");
  ok(view.products[0].mismatches === 2 && view.products[0].outOfStock === 1 && view.products[0].sellable === 2, "mismatch + out of stock + sellable counts");
  ok(view.variants[0].stock === "in_stock" && !view.variants[0].mismatch, "row stock");
  const csv = inventoryCsv(view);
  ok(csv.split("\n")[0].startsWith("Product,Handle,Status") && csv.trim().split("\n").length === 4 && csv.includes(",35.00,"), "csv rows");
  ok(csvCell("=HYPERLINK(1)") === "'=HYPERLINK(1)" && csvCell('a,"b"') === '"a,""b"""', "csv escaping + formula guard");

  const k = printKey("logo-tee", "abcdef012345", "Front");
  ok(k === "merch-print/logo-tee/abcdef012345/front.png", "print key built");
  ok(printKey("Bad Handle", "abcdef012345", "front") === null && printKey("x", "zz", "front") === null, "bad print key refused");
  const pre = "https://p.supabase.co/storage/v1/object/public/media";
  ok(printKeyFromUrl(`${pre}/${k}`, pre) === k && printKeyFromUrl(`${pre}/other/a.png`, pre) === null && printKeyFromUrl(`https://evil.example/${k}`, pre) === null, "print url -> key only for our prefix");
  ok(safeHttpsUrl("https://a.b/c d") === "" && safeHttpsUrl("https://a.b/c") === "https://a.b/c", "safe https url");
  { // D284: edit a published product
    const c0 = upsertItem(emptyCatalog(), { pkg: pkg("ed"), images: [], byEmail: null, nowIso: "t" });
    const cat = c0.ok ? c0.catalog : emptyCatalog();
    const e1 = editItem(cat, "ed", { title: "New Tee", description: "\u2022 Soft", sizes: ["S"], prices: { S: 4000 } }, "t2");
    ok(typeof e1 !== "string" && e1.items[0].pkg.product.title === "New Tee" && e1.items[0].pkg.variants.every((x) => x.size === "S" && x.retailCents === 4000) && e1.items[0].pkg.printfulSyncProduct.sync_variants[0].retail_price === "40.00" && e1.items[0].pkg.product.description === "\u2022 Soft", "edit title/description/price, drop sizes");
    ok(editItem(cat, "ed", { title: "X", description: "", sizes: ["S"], prices: { S: 100 } }, "t") === "That price sells at a loss for Black S, White S. Raise it above the Printful cost plus the card fee." && typeof editItem(cat, "ed", { title: "", description: "", sizes: ["S"], prices: {} }, "t") === "string" && typeof editItem(cat, "nope", { title: "X", description: "", sizes: ["S"], prices: {} }, "t") === "string", "edit guards: loss, title, missing");
  }
  // D282: per-colour mockup sets
  const mt = (c: string, v: string, d = "Logo") => mockupTags("cc-1717", c, v, d);
  ok(mt("Blue Jean", "Front").join(",") === "merch-mockup,blank-cc-1717,color-blue-jean,view-front,design-logo", "mockup tags");
  const media = [{ url: "https://m/4", tags: mt("Black", "Back") }, { url: "https://m/3", tags: mt("Black", "Front") }, { url: "https://m/2", tags: mt("White", "Front") }, { url: "https://m/x", tags: mockupTags("other", "Black", "Front", "Logo") }, { url: "https://m/o", tags: mt("Black", "Front", "Old") }];
  const mm = matchMockups(media, "cc-1717", ["Black", "White", "Red"], "Logo");
  ok(mm.Black?.join() === "https://m/3,https://m/4" && mm.White?.join() === "https://m/2" && !mm.Red, "match mockups by garment+colour+design, oldest first");
  ok(Object.keys(cleanColorImages({ Black: ["https://a", "javascript:x", "https://a"], Pink: ["https://b"] }, ["Black"])).join() === "Black" && cleanColorImages({ Black: ["https://a", "https://a"] }, ["Black"]).Black.length === 1, "clean colour images");
  const up = upsertItem(emptyCatalog(), { pkg: pkg("ci"), images: ["https://m/3"], colorImages: { Black: ["https://m/3"], Green: ["https://g"] }, byEmail: null, nowIso: "t" });
  ok(up.ok && Object.keys(up.item.colorImages).join() === "Black" && (merchFeed(up.catalog)[0].data.merch as { colorImages?: Record<string, string[]> }).colorImages?.Black[0] === "https://m/3", "colour images upsert + feed");
  return { passed, failed: failures.length, failures };
}
