/**
 * src/lib/noncannabis/pos-catalog-core.ts
 *
 * Fix Phase 4 (plan rows 5.1/5.2; G-29 / G-30 / G-32; owner D45:
 * "Q-05b-1- yes, and any other upgrade, enhancement and such needed to fully
 * utilize non cannabis goods in the system and on the register and on the
 * menu.").
 *
 * PURE (zero I/O). The one place that decides how an Other Inventory
 * (noncannabis_products) row becomes a register line, how a sold line maps
 * back to its catalog row, what it cost, and how its stock moves.
 *
 *  - The register key is `nc-<product uuid>` (productId = variantId). It can
 *    never collide with a cannabis key (menu ids / lot keys never start with
 *    "nc-"), so a non-cannabis scan never falls through to cannabis, and the
 *    cannabis lot / CCRS paths filter these lines out by key.
 *  - Category: Apparel / Merch -> "merch", everything else -> "accessories".
 *    Both are NON_CANNABIS_TAX_CATEGORIES (9.3% sales tax, no 37% excise) and
 *    categoryToBucket() = null (no WAC 314-55-095 limit).
 *  - Cost of goods = quantity x the item's unit cost (weighted average, kept
 *    current by the paper-invoice receiving RPC). Integer cents.
 */

import type { PosMenuProduct } from "@/lib/pos/sale-flow-core";

export const NC_KEY_PREFIX = "nc-";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The register / order_lines key of a catalog row. */
export function ncProductKey(productId: string): string {
  return `${NC_KEY_PREFIX}${productId}`;
}

/** True when an order_lines.product_id / variant_id is a catalog (Other Inventory) key. */
export function isNonCannabisProductId(key: string | null | undefined): boolean {
  return typeof key === "string" && key.startsWith(NC_KEY_PREFIX) && UUID_RE.test(key.slice(NC_KEY_PREFIX.length));
}

/** The noncannabis_products.id behind a key, or null when it is not one. */
export function ncIdFromKey(key: string | null | undefined): string | null {
  return isNonCannabisProductId(key) ? (key as string).slice(NC_KEY_PREFIX.length).toLowerCase() : null;
}

/** Register category for a catalog type (both are non-cannabis tax categories). */
export function ncRegisterCategory(type: string | null | undefined): "merch" | "accessories" {
  return (type ?? "").trim().toLowerCase() === "apparel" ? "merch" : "accessories";
}

/** The catalog fields the register needs. */
export type NcCatalogRow = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  type: string;
  price_minor_units: number;
  cost_minor_units: number;
  qty_on_hand: number;
  status: string;
  barcode: string | null;
  reorder_point: number | null;
};

/** Why a row is not on the register (shown on the Other Inventory page). */
export function ncRegisterBlocker(row: Pick<NcCatalogRow, "status" | "price_minor_units">): string | null {
  if (row.status !== "active") return "not active (Confirm it first)";
  if (!Number.isSafeInteger(row.price_minor_units) || row.price_minor_units <= 0) return "no price (set a price first)";
  return null;
}

/**
 * A catalog row as a register product, or null when it may not be sold
 * (draft / archived / no price). Out-of-stock items still ship (unitsLeft 0)
 * so a scan says "none left" with the existing Sell anyway override instead
 * of "not found".
 */
export function toPosMenuProduct(row: NcCatalogRow): PosMenuProduct | null {
  if (ncRegisterBlocker(row) !== null) return null;
  const key = ncProductKey(row.id);
  const qty = Math.max(0, Math.floor(Number(row.qty_on_hand) || 0));
  const reorder = Math.max(0, Math.floor(Number(row.reorder_point) || 0));
  const category = ncRegisterCategory(row.type);
  const cost = Number.isSafeInteger(row.cost_minor_units) && row.cost_minor_units > 0 ? row.cost_minor_units : null;
  return {
    productId: key,
    variantId: key,
    name: row.name,
    brand: row.brand,
    category,
    categories: [category, "non-cannabis"],
    variantLabel: row.sku,
    regularPriceMinor: row.price_minor_units,
    costMinorUnits: cost,
    inventoryStatus: qty <= 0 ? "unavailable" : reorder > 0 && qty <= reorder ? "low-stock" : "in-stock",
    unitsLeft: qty,
  };
}

/**
 * Add each item's manufacturer barcode and SKU label to the scan index.
 * A code the cannabis index already owns, or two items share, is dropped
 * (poisoned) - an ambiguous code falls to search, never a guess.
 * Returns the merged index and the codes dropped.
 */
export function mergeNcBarcodes(
  cannabis: Record<string, string>,
  rows: Pick<NcCatalogRow, "id" | "sku" | "barcode">[],
  normalize: (raw: string) => string,
): { index: Record<string, string>; dropped: string[] } {
  const index: Record<string, string> = { ...cannabis };
  const owner = new Map<string, string>();
  const poisoned = new Set<string>();
  for (const r of rows) {
    const key = ncProductKey(r.id);
    for (const raw of [r.barcode, r.sku]) {
      const code = normalize(raw ?? "");
      if (code.length < 4) continue;
      if (poisoned.has(code)) continue;
      if (code in cannabis) {
        poisoned.add(code);
        continue;
      }
      const prev = owner.get(code);
      if (prev && prev !== key) {
        poisoned.add(code);
        owner.delete(code);
        delete index[code];
        continue;
      }
      owner.set(code, key);
      index[code] = key;
    }
  }
  return { index, dropped: [...poisoned].sort() };
}

/* ------------------------------------------------------------------ *
 *  Sale / void / return stock moves and cost
 * ------------------------------------------------------------------ */

export type NcSaleLine = { lineId: string; productId: string | null; variantId?: string | null; quantity: number };

/** Split order lines into catalog lines (with their row id) and the rest. */
export function splitNcLines<T extends { productId: string | null }>(lines: readonly T[]): {
  nc: (T & { ncId: string })[];
  other: T[];
} {
  const nc: (T & { ncId: string })[] = [];
  const other: T[] = [];
  for (const l of lines) {
    const id = ncIdFromKey(l.productId);
    if (id) nc.push({ ...l, ncId: id });
    else other.push(l);
  }
  return { nc, other };
}

/** Cost per catalog line = quantity x unit cost; null when the cost is unknown ($0 or missing). */
export function ncLineCosts(
  lines: readonly { lineId: string; ncId: string; quantity: number }[],
  unitCostById: ReadonlyMap<string, number | null>,
): { costByLineId: Map<string, number | null>; unknown: string[] } {
  const costByLineId = new Map<string, number | null>();
  const unknown: string[] = [];
  for (const l of lines) {
    const unit = unitCostById.get(l.ncId);
    const qty = Math.floor(Number(l.quantity) || 0);
    if (unit === null || unit === undefined || !Number.isSafeInteger(unit) || unit <= 0 || qty <= 0) {
      costByLineId.set(l.lineId, null);
      unknown.push(l.lineId);
    } else {
      costByLineId.set(l.lineId, unit * qty);
    }
  }
  return { costByLineId, unknown };
}

/* ------------------------------------------------------------------ *
 *  Receiving: weighted-average cost
 * ------------------------------------------------------------------ */

/**
 * New unit cost after receiving `addQty` at `addCost` onto `oldQty` at
 * `oldCost` (moving weighted average, rounded half-up to whole cents).
 * Unknown old cost ($0) or nothing on hand -> the received cost.
 */
export function weightedAverageCost(oldQty: number, oldCost: number, addQty: number, addCost: number): number {
  const q0 = Math.max(0, Math.floor(oldQty));
  const c0 = Math.max(0, Math.floor(oldCost));
  const q1 = Math.max(0, Math.floor(addQty));
  const c1 = Math.max(0, Math.floor(addCost));
  if (q1 <= 0) return c0;
  if (q0 <= 0 || c0 <= 0) return c1;
  return Math.round((q0 * c0 + q1 * c1) / (q0 + q1));
}

/* ------------------------------------------------------------------ *
 *  G-32 item 3: direction fixed by reason
 * ------------------------------------------------------------------ */

/** Reasons the app writes itself (never picked on the form). */
export const NC_SYSTEM_REASONS = ["sale", "void", "return_restock", "invoice_received"] as const;

/**
 * The signed delta for a manual adjustment: received / return add, damaged /
 * theft / promo / sold_correction remove, count / other take the direction
 * the user chose. `qty` is the positive amount typed.
 */
export function signedDeltaForReason(
  reason: string,
  qty: number,
  chosenDirection: "add" | "remove" | null,
): { ok: true; delta: number } | { ok: false; error: string } {
  const n = Math.floor(Number(qty));
  if (!Number.isSafeInteger(n) || n <= 0) return { ok: false, error: "Type how many units, a whole number above zero." };
  const fixed: Record<string, 1 | -1> = { received: 1, return: 1, damaged: -1, theft: -1, promo: -1, sold_correction: -1 };
  if (reason in fixed) return { ok: true, delta: fixed[reason] * n };
  if (reason === "count" || reason === "other") {
    if (chosenDirection !== "add" && chosenDirection !== "remove") {
      return { ok: false, error: "For a count correction or other, choose Add or Remove." };
    }
    return { ok: true, delta: chosenDirection === "add" ? n : -n };
  }
  return { ok: false, error: "Pick a valid reason." };
}

/* ------------------------------------------------------------------ *
 *  G-30: price / cost change
 * ------------------------------------------------------------------ */

export function validatePriceCostChange(input: {
  field: "price" | "cost";
  oldMinor: number;
  newMinor: number | null;
  reason: string;
}): { ok: true } | { ok: false; error: string } {
  const label = input.field === "price" ? "price" : "cost";
  if (input.newMinor === null || !Number.isSafeInteger(input.newMinor)) {
    return { ok: false, error: `Type the new ${label} in dollars and cents.` };
  }
  if (input.newMinor <= 0) {
    return {
      ok: false,
      error: input.field === "price" ? "A price of $0.00 is refused. Type the shelf price." : "A cost of $0.00 is refused. Type what one unit cost.",
    };
  }
  if (input.newMinor > 10_000_000) return { ok: false, error: `That ${label} is over $100,000. Check the number.` };
  if (input.newMinor === input.oldMinor) return { ok: false, error: `The new ${label} is the same as the current one.` };
  if (input.reason.trim().length < 3) return { ok: false, error: "Type a reason for the change (for example: vendor raised the price)." };
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 *  G-29 item 8: report
 * ------------------------------------------------------------------ */

export type NcSoldLine = { productId: string | null; productName: string; quantity: number; priceMinorUnits: number; costMinorUnits: number | null };

export type NcItemSales = {
  ncId: string;
  name: string;
  units: number;
  /** Tax-INCLUSIVE paid (what the register stored). */
  paidMinor: number;
  /** Pre-tax revenue at 9.3% (paid / 1.093, rounded). */
  revenueMinor: number;
  costMinor: number;
  marginMinor: number;
  costKnown: boolean;
};

/** Per-item sales, revenue (pre-tax), cost and margin. */
export function summarizeNcSales(lines: readonly NcSoldLine[], salesRateBps = 930): NcItemSales[] {
  const by = new Map<string, NcItemSales>();
  for (const l of lines) {
    const id = ncIdFromKey(l.productId);
    if (!id) continue;
    const qty = Math.floor(Number(l.quantity) || 0);
    const paid = (Number(l.priceMinorUnits) || 0) * qty;
    const cur = by.get(id) ?? { ncId: id, name: l.productName, units: 0, paidMinor: 0, revenueMinor: 0, costMinor: 0, marginMinor: 0, costKnown: true };
    cur.units += qty;
    cur.paidMinor += paid;
    if (l.costMinorUnits === null || l.costMinorUnits <= 0) cur.costKnown = false;
    else cur.costMinor += l.costMinorUnits * qty;
    by.set(id, cur);
  }
  const out = [...by.values()];
  for (const r of out) {
    r.revenueMinor = Math.round((r.paidMinor * 10_000) / (10_000 + salesRateBps));
    r.marginMinor = r.revenueMinor - r.costMinor;
  }
  return out.sort((a, b) => b.revenueMinor - a.revenueMinor || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ *
 *  Self-tests
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  G-29 item 7: website "In store" list (display only)
 * ------------------------------------------------------------------ */

export type NcInStoreCard = { id: string; name: string; brand: string | null; priceMinor: number; category: "merch" | "accessories" };

/**
 * What the public website may show: ACTIVE, priced, IN-STOCK items only —
 * name, brand and shelf price. Never cost, quantity, SKU or barcode. Display
 * only: there is no add-to-cart (pickup orders are cannabis-only).
 */
export function toInStoreCards(rows: readonly NcCatalogRow[], max = 48): NcInStoreCard[] {
  return rows
    .filter((r) => ncRegisterBlocker(r) === null && Math.floor(Number(r.qty_on_hand) || 0) > 0)
    .map((r) => ({
      id: r.id,
      name: r.name,
      brand: (r.brand ?? "").trim() || null,
      priceMinor: r.price_minor_units,
      category: ncRegisterCategory(r.type),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, Math.max(0, max));
}

export function __runNcPosCatalogTests(): number {
  let n = 0;
  const ok = (c: boolean, msg: string) => {
    if (!c) throw new Error(`FAIL: nc-pos-catalog: ${msg}`);
    n += 1;
  };
  const id = "11111111-2222-3333-4444-555555555555";
  const key = ncProductKey(id);
  ok(key === `nc-${id}`, "key");
  ok(isNonCannabisProductId(key), "is nc");
  ok(!isNonCannabisProductId("nc-abc"), "nc- needs a uuid");
  ok(!isNonCannabisProductId("pos-custom-1"), "keypad is not nc");
  ok(!isNonCannabisProductId(null), "null");
  ok(ncIdFromKey(key) === id, "id from key");
  ok(ncIdFromKey("blue-dream") === null, "cannabis key -> null");
  ok(ncRegisterCategory("apparel") === "merch", "apparel -> merch");
  ok(ncRegisterCategory("bong") === "accessories", "bong -> accessories");
  const row: NcCatalogRow = { id, sku: "BONG-0001", name: "Glass Bong 12in", brand: null, type: "bong", price_minor_units: 4999, cost_minor_units: 2000, qty_on_hand: 3, status: "active", barcode: "012345678905", reorder_point: 2 };
  const p = toPosMenuProduct(row)!;
  ok(p.productId === key && p.variantId === key, "product key");
  ok(p.category === "accessories" && p.regularPriceMinor === 4999, "category + price");
  ok(p.unitsLeft === 3 && p.inventoryStatus === "in-stock", "stock");
  ok(p.costMinorUnits === 2000, "cost");
  ok(toPosMenuProduct({ ...row, qty_on_hand: 2 })!.inventoryStatus === "low-stock", "at reorder point = low");
  ok(toPosMenuProduct({ ...row, qty_on_hand: 0 })!.inventoryStatus === "unavailable", "0 = unavailable but shipped");
  ok(toPosMenuProduct({ ...row, status: "draft" }) === null, "draft not sold");
  ok(toPosMenuProduct({ ...row, price_minor_units: 0 }) === null, "$0 not sold");
  ok(toPosMenuProduct({ ...row, cost_minor_units: 0 })!.costMinorUnits === null, "$0 cost = unknown");
  const norm = (s: string) => s.trim().toLowerCase();
  const m = mergeNcBarcodes({ "lot-1": "flower-a" }, [row, { id: "22222222-2222-3333-4444-555555555555", sku: "LOT-1", barcode: null }], norm);
  ok(m.index["012345678905"] === key && m.index["bong-0001"] === key, "barcode + sku indexed");
  ok(m.index["lot-1"] === "flower-a" && m.dropped.includes("lot-1"), "cannabis code wins, nc dropped");
  const dup = mergeNcBarcodes({}, [row, { id: "33333333-2222-3333-4444-555555555555", sku: "X-0001", barcode: "012345678905" }], norm);
  ok(!("012345678905" in dup.index) && dup.dropped.includes("012345678905"), "shared barcode poisoned");
  const split = splitNcLines([{ productId: key, lineId: "a" }, { productId: "flower-a", lineId: "b" }, { productId: "pos-custom-1", lineId: "c" }]);
  ok(split.nc.length === 1 && split.nc[0].ncId === id && split.other.length === 2, "split");
  const costs = ncLineCosts([{ lineId: "a", ncId: id, quantity: 2 }, { lineId: "b", ncId: "x", quantity: 1 }], new Map([[id, 2000]]));
  ok(costs.costByLineId.get("a") === 4000 && costs.costByLineId.get("b") === null && costs.unknown.length === 1, "costs");
  ok(weightedAverageCost(10, 1000, 10, 2000) === 1500, "wac");
  ok(weightedAverageCost(0, 1000, 5, 1200) === 1200, "nothing on hand -> received cost");
  ok(weightedAverageCost(4, 0, 6, 900) === 900, "unknown old cost -> received cost");
  ok(weightedAverageCost(3, 333, 1, 334) === 333, "rounded");
  ok(weightedAverageCost(5, 700, 0, 100) === 700, "zero received keeps cost");
  const d1 = signedDeltaForReason("damaged", 2, "add");
  ok(d1.ok && d1.delta === -2, "damaged always removes");
  const d2 = signedDeltaForReason("received", 3, "remove");
  ok(d2.ok && d2.delta === 3, "received always adds");
  const d3 = signedDeltaForReason("count", 4, "remove");
  ok(d3.ok && d3.delta === -4, "count chooses");
  ok(!signedDeltaForReason("count", 4, null).ok, "count needs direction");
  ok(!signedDeltaForReason("sale", 1, "add").ok, "system reason refused");
  ok(!signedDeltaForReason("theft", 0, null).ok, "zero refused");
  ok(!validatePriceCostChange({ field: "price", oldMinor: 100, newMinor: 0, reason: "x reason" }).ok, "$0 price refused");
  ok(!validatePriceCostChange({ field: "cost", oldMinor: 100, newMinor: 100, reason: "same thing" }).ok, "same refused");
  ok(!validatePriceCostChange({ field: "cost", oldMinor: 100, newMinor: 120, reason: "" }).ok, "reason required");
  ok(validatePriceCostChange({ field: "cost", oldMinor: 100, newMinor: 120, reason: "vendor raise" }).ok, "valid");
  const s = summarizeNcSales([
    { productId: key, productName: "Glass Bong 12in", quantity: 2, priceMinorUnits: 1093, costMinorUnits: 400 },
    { productId: "flower-a", productName: "Flower", quantity: 1, priceMinorUnits: 5000, costMinorUnits: 10 },
  ]);
  const cards = toInStoreCards([
    row,
    { ...row, id: "22222222-2222-4222-8222-222222222222", qty_on_hand: 0 },
    { ...row, id: "33333333-3333-4333-8333-333333333333", status: "draft" },
  ]);
  ok(cards.length === 1 && !("cost" in cards[0]) && cards[0].priceMinor === row.price_minor_units, "in-store cards: in stock + active only, no cost");
  ok(s.length === 1 && s[0].units === 2 && s[0].revenueMinor === 2000 && s[0].costMinor === 800 && s[0].marginMinor === 1200, "sales summary");
  return n;
}
