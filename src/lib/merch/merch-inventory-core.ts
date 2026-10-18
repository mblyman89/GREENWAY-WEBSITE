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
import { LISTING_FORMAT, LISTING_VERSION, type ListingPackage } from "@/lib/merch-studio/listing-package-core";

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

/** Publish (or re-publish) one package. Re-publishing replaces it and puts it live again. */
export function upsertItem(c: MerchCatalog, input: { pkg: ListingPackage; images: readonly string[]; byEmail: string | null; nowIso: string }): { ok: true; catalog: MerchCatalog; created: boolean } | { ok: false; error: string } {
  if (!isListingPackage(input.pkg)) return { ok: false, error: "That isn't a complete listing package." };
  const handle = input.pkg.product.handle;
  const prev = c.items.find((i) => i.handle === handle);
  if (!prev && c.items.length >= MERCH_CATALOG_MAX_ITEMS) return { ok: false, error: `The catalog is full (${MERCH_CATALOG_MAX_ITEMS} products). Remove an old one first.` };
  if (prev && prev.pkg.designId && input.pkg.designId && prev.pkg.designId !== input.pkg.designId) {
    return { ok: false, error: `Another design is already published as "${handle}". Change the product title so it gets its own web address.` };
  }
  const item: MerchCatalogItem = {
    handle,
    status: "live",
    images: input.images.map(safeHttpsUrl).filter(Boolean).slice(0, MERCH_ITEM_MAX_IMAGES),
    publishedAt: prev?.publishedAt || input.nowIso,
    updatedAt: input.nowIso,
    byEmail: input.byEmail,
    stockSyncedAt: "",
    pkg: input.pkg,
  };
  const items = prev ? c.items.map((i) => (i.handle === handle ? item : i)) : [...c.items, item];
  return { ok: true, catalog: { v: 1, items }, created: !prev };
}

export function setItemStatus(c: MerchCatalog, handle: string, status: MerchItemStatus, nowIso: string): MerchCatalog | null {
  if (!c.items.some((i) => i.handle === handle)) return null;
  return { v: 1, items: c.items.map((i) => (i.handle === handle ? { ...i, status, updatedAt: nowIso } : i)) };
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
    return { name: `studio-${i.handle}.json`, data: { ...rest, ...(i.images.length ? { merch: { images: i.images } } : {}) } };
  });
}

// ---------------------------------------------------------------------------
// Printful stock (GET /products/{id}: variants[].in_stock + availability_status[{region,status}])
// ---------------------------------------------------------------------------
export type StockStatus = "in_stock" | "stocked_on_demand" | "out_of_stock" | "discontinued" | "unknown";
export const STOCK_LABELS: Record<StockStatus, string> = {
  in_stock: "In stock", stocked_on_demand: "Made to order", out_of_stock: "Out of stock", discontinued: "Discontinued", unknown: "Not checked",
};
export const stockSellable = (s: StockStatus) => s === "in_stock" || s === "stocked_on_demand";

/** Printful product variants -> variantId -> US status (falls back to the in_stock flag). */
export function stockFromPrintful(raw: unknown): Map<number, StockStatus> {
  const out = new Map<number, StockStatus>();
  const variants = isObj(raw) && Array.isArray(raw.variants) ? raw.variants : [];
  const known: StockStatus[] = ["in_stock", "stocked_on_demand", "out_of_stock", "discontinued"];
  for (const v of variants) {
    if (!isObj(v) || typeof v.id !== "number") continue;
    const us = (Array.isArray(v.availability_status) ? v.availability_status : []).find((a) => isObj(a) && a.region === "US") as Record<string, unknown> | undefined;
    const s = us && known.includes(us.status as StockStatus) ? (us.status as StockStatus) : typeof v.in_stock === "boolean" ? (v.in_stock ? "in_stock" : "out_of_stock") : "unknown";
    out.set(v.id, s);
  }
  return out;
}

/** Copy Printful's stock onto every variant's inStock (what the merch site shows). */
export function applyStock(c: MerchCatalog, stock: ReadonlyMap<number, StockStatus>, nowIso: string): { catalog: MerchCatalog; changed: number; checked: number } {
  let changed = 0; let checked = 0;
  const items = c.items.map((i) => {
    let touched = false;
    const variants = i.pkg.variants.map((v) => {
      const s = stock.get(v.printfulVariantId);
      if (!s || s === "unknown") return v;
      checked += 1; touched = true;
      const inStock = stockSellable(s);
      if (inStock === v.inStock) return v;
      changed += 1;
      return { ...v, inStock };
    });
    return touched ? { ...i, stockSyncedAt: nowIso, pkg: { ...i.pkg, variants } } : i;
  });
  return { catalog: { v: 1, items }, changed, checked };
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
  onSite: boolean; stock: StockStatus; mismatch: boolean;
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

export function inventoryView(c: MerchCatalog, stock: ReadonlyMap<number, StockStatus>, sales: ReadonlyMap<number, VariantSales>): InventoryView {
  const variants: InventoryVariantRow[] = [];
  const products: InventoryProductRow[] = c.items.map((i) => {
    const rows = i.pkg.variants.map((v): InventoryVariantRow => {
      const s = stock.get(v.printfulVariantId) ?? "unknown";
      const sale = sales.get(v.printfulVariantId);
      return {
        handle: i.handle, title: i.pkg.product.title, color: v.color, size: v.size, variantId: v.printfulVariantId,
        retailCents: v.retailCents, printfulCents: v.printfulCents, profitCents: v.profitCents, marginBps: v.marginBps,
        onSite: v.inStock, stock: s, mismatch: s !== "unknown" && stockSellable(s) !== v.inStock,
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
      outOfStock: rows.filter((r) => r.stock === "out_of_stock" || r.stock === "discontinued").length,
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
  const lines = v.variants.map((r) => [r.title, r.handle, status.get(r.handle) ?? "", r.color, r.size, r.variantId, dollars(r.retailCents), dollars(r.printfulCents), dollars(r.profitCents), (r.marginBps / 100).toFixed(1), r.onSite ? "yes" : "no", STOCK_LABELS[r.stock], r.units, dollars(r.revenueCents)]);
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
  ok(re.ok && !re.created && re.catalog.items.length === 1 && re.catalog.items[0].status === "live" && re.catalog.items[0].publishedAt === now, "re-publish replaces, goes live, keeps first publish date");
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
  ok(st.get(1) === "in_stock" && st.get(2) === "discontinued" && st.get(3) === "stocked_on_demand" && st.get(4) === "out_of_stock" && st.size === 4, "US region status read, in_stock fallback");
  ok(stockFromPrintful(null).size === 0, "no product -> empty");
  const ap = applyStock(c1, st, now);
  const vs = ap.catalog.items[0].pkg.variants;
  ok(ap.checked === 3 && ap.changed === 2 && vs[1].inStock === false && vs[2].inStock === true && ap.catalog.items[0].stockSyncedAt === now, "stock copied onto variants");
  ok(applyStock(c1, new Map(), now).catalog.items[0].stockSyncedAt === "", "nothing checked -> untouched");

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
  return { passed, failed: failures.length, failures };
}
