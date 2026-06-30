/**
 * src/lib/purchasing/po-core.ts
 *
 * PURE purchasing / reorder logic for the AI-baked Purchase Order builder
 * (Slice 38). No `server-only`, no DB — safe to import from tsx test harnesses.
 *
 * Reorder math is grounded in the standard, widely-published formula
 * (inFlow "Reorder Point Formula and Safety Stock", among others):
 *
 *   reorder point = (avg daily unit sales × lead time in days) + safety stock
 *   safety stock  = (max daily sales × max lead time) − (avg daily sales × avg lead time)
 *   suggested qty = target days of supply × avg daily sales − on_hand − on_order,
 *                   then rounded UP to the vendor minimum order quantity (MOQ).
 *
 * Money is in MINOR UNITS (cents).
 */

export type VelocityInput = {
  /** Total units sold across the window. */
  unitsSold: number;
  /** Number of days in the window (e.g. 30). */
  windowDays: number;
  /** Highest units sold in any single day of the window (for safety stock). */
  maxDailyUnits?: number;
};

/** Average daily unit sales = units sold / window days. Never negative. */
export function avgDailySales(v: VelocityInput): number {
  if (v.windowDays <= 0) return 0;
  const a = v.unitsSold / v.windowDays;
  return a > 0 ? a : 0;
}

/**
 * Safety stock = (max daily sales × max lead time) − (avg daily sales × avg lead time).
 * When max values aren't known, fall back to `avgDaily × safetyDays`.
 */
export function safetyStock(params: {
  avgDaily: number;
  avgLeadDays: number;
  maxDaily?: number;
  maxLeadDays?: number;
  fallbackSafetyDays?: number;
}): number {
  const { avgDaily, avgLeadDays, maxDaily, maxLeadDays, fallbackSafetyDays } = params;
  if (
    typeof maxDaily === "number" &&
    typeof maxLeadDays === "number" &&
    maxDaily > 0 &&
    maxLeadDays > 0
  ) {
    const ss = maxDaily * maxLeadDays - avgDaily * avgLeadDays;
    return ss > 0 ? ss : 0;
  }
  const days = fallbackSafetyDays ?? 7;
  const ss = avgDaily * days;
  return ss > 0 ? ss : 0;
}

/** Reorder point = (avg daily sales × lead time) + safety stock. */
export function reorderPoint(params: {
  avgDaily: number;
  leadDays: number;
  safety: number;
}): number {
  const rp = params.avgDaily * params.leadDays + params.safety;
  return rp > 0 ? rp : 0;
}

/**
 * Suggested order quantity to bring stock up to the target days of supply,
 * net of what's on hand and already on order, rounded UP to the MOQ.
 * Returns 0 when nothing is needed.
 */
export function suggestedOrderQty(params: {
  avgDaily: number;
  targetDaysOfSupply: number;
  onHand: number;
  onOrder?: number;
  moq?: number;
}): number {
  const { avgDaily, targetDaysOfSupply, onHand } = params;
  const onOrder = params.onOrder ?? 0;
  const moq = params.moq && params.moq > 0 ? params.moq : 1;
  const target = avgDaily * targetDaysOfSupply;
  const need = target - onHand - onOrder;
  if (need <= 0) return 0;
  // round up to the nearest MOQ multiple
  return Math.ceil(need / moq) * moq;
}

export type ReorderInputs = {
  onHand: number;
  onOrder?: number;
  velocity: VelocityInput;
  leadDays: number;
  targetDaysOfSupply: number;
  fallbackSafetyDays?: number;
  maxLeadDays?: number;
  moq?: number;
};

export type ReorderResult = {
  avgDaily: number;
  safety: number;
  reorderPoint: number;
  suggestedQty: number;
  /** True when on_hand has dropped to/below the reorder point. */
  belowReorderPoint: boolean;
  /** Estimated days of supply left at current velocity (Infinity if no sales). */
  daysOfSupplyLeft: number;
};

/** Run the full reorder computation for one product. */
export function computeReorder(input: ReorderInputs): ReorderResult {
  const avgDaily = avgDailySales(input.velocity);
  const safety = safetyStock({
    avgDaily,
    avgLeadDays: input.leadDays,
    maxDaily: input.velocity.maxDailyUnits,
    maxLeadDays: input.maxLeadDays,
    fallbackSafetyDays: input.fallbackSafetyDays,
  });
  const rp = reorderPoint({ avgDaily, leadDays: input.leadDays, safety });
  const qty = suggestedOrderQty({
    avgDaily,
    targetDaysOfSupply: input.targetDaysOfSupply,
    onHand: input.onHand,
    onOrder: input.onOrder,
    moq: input.moq,
  });
  const daysLeft = avgDaily > 0 ? input.onHand / avgDaily : Infinity;
  return {
    avgDaily,
    safety,
    reorderPoint: rp,
    suggestedQty: qty,
    belowReorderPoint: input.onHand <= rp,
    daysOfSupplyLeft: daysLeft,
  };
}

// ---------------------------------------------------------------------------
// Include / exclude filtering (the user's "include/exclude products / categories
// / types / brands / vendors" requirement). Pure set logic.
// ---------------------------------------------------------------------------
export type CandidateRow = {
  posProductKey: string | null;
  productName: string;
  brand: string | null;
  category: string | null;
  vendorId: string | null;
  vendorName: string | null;
};

export type PoFilter = {
  /** When set, only vendors in this list pass. */
  includeVendorIds?: string[];
  excludeVendorIds?: string[];
  includeCategories?: string[];
  excludeCategories?: string[];
  includeBrands?: string[];
  excludeBrands?: string[];
  /** Product-level include/exclude by pos_product_key. */
  includeProductKeys?: string[];
  excludeProductKeys?: string[];
};

function has(list: string[] | undefined, value: string | null): boolean {
  if (!list || list.length === 0) return false;
  if (value == null) return false;
  return list.some((x) => x.toLowerCase() === value.toLowerCase());
}

/** Returns true if a candidate passes the include/exclude filter. */
export function passesFilter(row: CandidateRow, f: PoFilter): boolean {
  // Excludes always win.
  if (has(f.excludeVendorIds, row.vendorId)) return false;
  if (has(f.excludeCategories, row.category)) return false;
  if (has(f.excludeBrands, row.brand)) return false;
  if (has(f.excludeProductKeys, row.posProductKey)) return false;

  // Includes: if an include list is set for a dimension, the row must match it.
  if (f.includeVendorIds && f.includeVendorIds.length > 0 && !has(f.includeVendorIds, row.vendorId)) {
    return false;
  }
  if (f.includeCategories && f.includeCategories.length > 0 && !has(f.includeCategories, row.category)) {
    return false;
  }
  if (f.includeBrands && f.includeBrands.length > 0 && !has(f.includeBrands, row.brand)) {
    return false;
  }
  if (f.includeProductKeys && f.includeProductKeys.length > 0 && !has(f.includeProductKeys, row.posProductKey)) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// PO line + total math
// ---------------------------------------------------------------------------
export function lineTotalMinor(orderQty: number, unitCostMinor: number): number {
  return Math.round(orderQty * unitCostMinor);
}

export function poSubtotalMinor(lines: { order_qty: number; unit_cost_minor_units: number }[]): number {
  return lines.reduce((sum, l) => sum + lineTotalMinor(l.order_qty, l.unit_cost_minor_units), 0);
}

/** Format minor units as "$12.34". */
export function formatMoneyMinor(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  return `${sign}$${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// PO number generator (deterministic from a sequence + date)
// ---------------------------------------------------------------------------
export function makePoNumber(seq: number, date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  return `PO-${y}${m}-${seq.toString().padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Plain-text PO rendering (for email body / export)
// ---------------------------------------------------------------------------
export type PoRenderLine = {
  product_name: string;
  brand: string | null;
  order_qty: number;
  unit: string;
  unit_cost_minor_units: number;
};

export function renderPoText(params: {
  poNumber: string;
  vendorName: string | null;
  expectedDate: string | null;
  note: string | null;
  lines: PoRenderLine[];
  storeName?: string;
}): string {
  const out: string[] = [];
  out.push(`PURCHASE ORDER  ${params.poNumber}`);
  out.push(`From: ${params.storeName ?? "Greenway Marijuana"}`);
  out.push(`To:   ${params.vendorName ?? "Vendor"}`);
  if (params.expectedDate) out.push(`Requested delivery: ${params.expectedDate}`);
  out.push("");
  out.push("Qty   Item                                   Unit cost   Line total");
  out.push("----------------------------------------------------------------------");
  let subtotal = 0;
  for (const l of params.lines) {
    const lt = lineTotalMinor(l.order_qty, l.unit_cost_minor_units);
    subtotal += lt;
    const qty = `${l.order_qty}${l.unit === "each" ? "" : l.unit}`.padEnd(5);
    const name = `${l.product_name}${l.brand ? ` (${l.brand})` : ""}`.slice(0, 38).padEnd(38);
    const cost = formatMoneyMinor(l.unit_cost_minor_units).padStart(10);
    const tot = formatMoneyMinor(lt).padStart(12);
    out.push(`${qty} ${name} ${cost} ${tot}`);
  }
  out.push("----------------------------------------------------------------------");
  out.push(`${"SUBTOTAL".padStart(56)} ${formatMoneyMinor(subtotal).padStart(12)}`);
  if (params.note && params.note.trim()) {
    out.push("");
    out.push(`Note: ${params.note.trim()}`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
export function __runPoCoreTests(): void {
  let passed = 0;
  let failed = 0;
  function expect(name: string, cond: boolean) {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL: ${name}`);
    }
  }
  function near(a: number, b: number, eps = 1e-6) {
    return Math.abs(a - b) < eps;
  }

  // avgDailySales
  expect("avg 500/31", near(avgDailySales({ unitsSold: 500, windowDays: 31 }), 500 / 31));
  expect("avg zero days", avgDailySales({ unitsSold: 5, windowDays: 0 }) === 0);
  expect("avg never negative", avgDailySales({ unitsSold: -5, windowDays: 10 }) === 0);

  // safetyStock with max known: (4×10)-(2×6)=28 (the article's basketball example)
  expect("safety basketball 28", near(safetyStock({ avgDaily: 2, avgLeadDays: 6, maxDaily: 4, maxLeadDays: 10 }), 28));
  // safety fallback: avgDaily 2 × 7 days = 14
  expect("safety fallback 14", near(safetyStock({ avgDaily: 2, avgLeadDays: 5, fallbackSafetyDays: 7 }), 14));
  expect("safety never negative", safetyStock({ avgDaily: 1, avgLeadDays: 100, maxDaily: 1, maxLeadDays: 1 }) === 0);

  // reorderPoint: (2×5)+28 = 38 (article example)
  expect("rop 38", near(reorderPoint({ avgDaily: 2, leadDays: 5, safety: 28 }), 38));

  // suggestedOrderQty
  expect("qty cover 21 days", suggestedOrderQty({ avgDaily: 2, targetDaysOfSupply: 21, onHand: 10 }) === 32);
  expect("qty nothing needed", suggestedOrderQty({ avgDaily: 1, targetDaysOfSupply: 10, onHand: 50 }) === 0);
  expect("qty respects MOQ round up", suggestedOrderQty({ avgDaily: 1, targetDaysOfSupply: 10, onHand: 0, moq: 6 }) === 12);
  expect("qty subtract onOrder", suggestedOrderQty({ avgDaily: 2, targetDaysOfSupply: 21, onHand: 10, onOrder: 32 }) === 0);

  // computeReorder end-to-end
  const r = computeReorder({
    onHand: 10,
    velocity: { unitsSold: 60, windowDays: 30, maxDailyUnits: 4 },
    leadDays: 6,
    targetDaysOfSupply: 21,
    maxLeadDays: 10,
  });
  expect("compute avgDaily 2", near(r.avgDaily, 2));
  expect("compute safety 28", near(r.safety, 28));
  expect("compute rop 40", near(r.reorderPoint, 2 * 6 + 28));
  expect("compute below rop true", r.belowReorderPoint === true);
  expect("compute daysLeft 5", near(r.daysOfSupplyLeft, 5));

  const rNoSales = computeReorder({
    onHand: 5,
    velocity: { unitsSold: 0, windowDays: 30 },
    leadDays: 7,
    targetDaysOfSupply: 21,
  });
  expect("no sales suggests 0", rNoSales.suggestedQty === 0);
  expect("no sales infinite supply", rNoSales.daysOfSupplyLeft === Infinity);

  // passesFilter
  const row: CandidateRow = {
    posProductKey: "k1",
    productName: "Blue Dream",
    brand: "Acme",
    category: "flower",
    vendorId: "v1",
    vendorName: "Acme Farms",
  };
  expect("filter passes empty", passesFilter(row, {}) === true);
  expect("filter exclude brand", passesFilter(row, { excludeBrands: ["Acme"] }) === false);
  expect("filter include brand match", passesFilter(row, { includeBrands: ["Acme"] }) === true);
  expect("filter include brand miss", passesFilter(row, { includeBrands: ["Other"] }) === false);
  expect("filter include vendor match", passesFilter(row, { includeVendorIds: ["v1"] }) === true);
  expect("filter exclude vendor wins over include", passesFilter(row, { includeVendorIds: ["v1"], excludeVendorIds: ["v1"] }) === false);
  expect("filter include category miss", passesFilter(row, { includeCategories: ["edible"] }) === false);
  expect("filter exclude product key", passesFilter(row, { excludeProductKeys: ["k1"] }) === false);
  expect("filter case-insensitive", passesFilter(row, { includeBrands: ["acme"] }) === true);

  // line / subtotal math
  expect("lineTotal", lineTotalMinor(3, 1000) === 3000);
  expect("subtotal", poSubtotalMinor([
    { order_qty: 2, unit_cost_minor_units: 1500 },
    { order_qty: 1, unit_cost_minor_units: 1000 },
  ]) === 4000);

  // money + po number
  expect("money", formatMoneyMinor(123456) === "$1234.56");
  expect("poNumber", makePoNumber(7, new Date("2024-03-15T00:00:00Z")) === "PO-202403-0007");

  // render
  const txt = renderPoText({
    poNumber: "PO-202403-0001",
    vendorName: "Acme Farms",
    expectedDate: "2024-03-20",
    note: "Deliver before noon",
    lines: [
      { product_name: "Blue Dream 3.5g", brand: "Acme", order_qty: 24, unit: "each", unit_cost_minor_units: 900 },
    ],
  });
  expect("render has PO number", txt.includes("PO-202403-0001"));
  expect("render has vendor", txt.includes("Acme Farms"));
  expect("render has subtotal", txt.includes("SUBTOTAL"));
  expect("render has line total $216.00", txt.includes("$216.00"));
  expect("render has note", txt.includes("Deliver before noon"));

  console.log(`po-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`po-core tests failed: ${failed}`);
}
