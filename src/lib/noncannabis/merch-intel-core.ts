/**
 * src/lib/noncannabis/merch-intel-core.ts
 *
 * Pure intelligence core for NON-CANNABIS merchandise (glass, lighters,
 * papers, grinders, …). Dependency-free and fully self-tested.
 *
 * The professional playbook this encodes (Task M research):
 *
 *  1. DUAL-IDENTIFIER STRATEGY — the industry-standard answer for a catalog
 *     where SOME items carry manufacturer barcodes (lighters, papers) and
 *     most do NOT (pipes, bongs, hand-blown glass):
 *       • item HAS a manufacturer UPC/EAN  -> scan that code at the register;
 *         no label needed. Validate the check digit so typos never enter the
 *         catalog.
 *       • item has NO barcode              -> print an in-house Code128 SKU
 *         label on the equipment-page label printer. Every sellable item ends
 *         up scannable either way.
 *
 *  2. REORDER POINTS (min/max) — each product carries a reorder_point (min)
 *     and reorder_qty (how many to order). The page surfaces a "reorder now"
 *     list: OUT (qty 0) first, then BELOW min, then NEAR min (within 25%).
 *
 *  3. ABC BY RETAIL VALUE — same 80/95 cumulative-value technique as the
 *     cannabis side so attention goes where the money is.
 *
 *  4. SHRINK TELEMETRY — negative adjustments grouped by reason and valued at
 *     COST, so undocumented disappearance is visible. Non-cannabis has no
 *     CCRS hoops, but documented reductions are still how a pro runs a store.
 *
 * NOTHING here guesses: barcode validation implements the standard GS1
 * modulo-10 check-digit algorithm (UPC-A 12, EAN-13 13, EAN-8 8 digits).
 */

/* ------------------------------------------------------------------ *
 *  Retail barcode (UPC/EAN) validation — GS1 mod-10 check digit
 * ------------------------------------------------------------------ */

export type BarcodeKind = "upc_a" | "ean_13" | "ean_8";

export type BarcodeCheck =
  | { ok: true; kind: BarcodeKind; normalized: string }
  | { ok: false; error: string };

/** Strip spaces/dashes; keep digits only. */
export function normalizeBarcodeInput(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^0-9]/g, "");
}

/**
 * GS1 check-digit test. Digits are weighted right-to-left starting at the
 * check digit: positions at odd offset (1,3,5,…) from the right get ×3,
 * even offsets ×1; total must be ≡ 0 (mod 10). This single rule covers
 * UPC-A (12), EAN-13 (13) and EAN-8 (8).
 */
export function gs1CheckDigitOk(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 2) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const fromRight = digits.length - 1 - i; // 0 for the check digit itself
    const d = digits.charCodeAt(i) - 48;
    sum += fromRight % 2 === 1 ? d * 3 : d;
  }
  return sum % 10 === 0;
}

/**
 * Validate a manufacturer retail barcode. Accepts UPC-A (12 digits),
 * EAN-13 (13) or EAN-8 (8) with a correct check digit. Anything else is
 * rejected with a plain-language error — mistyped codes never enter the
 * catalog.
 */
export function validateRetailBarcode(raw: string | null | undefined): BarcodeCheck {
  const digits = normalizeBarcodeInput(raw);
  if (!digits) return { ok: false, error: "Barcode is empty." };
  const kind: BarcodeKind | null =
    digits.length === 12 ? "upc_a" : digits.length === 13 ? "ean_13" : digits.length === 8 ? "ean_8" : null;
  if (!kind) {
    return {
      ok: false,
      error: `Barcode must be 12 (UPC-A), 13 (EAN-13) or 8 (EAN-8) digits — got ${digits.length}.`,
    };
  }
  if (!gs1CheckDigitOk(digits)) {
    return { ok: false, error: "Check digit doesn't match — the barcode was mistyped or misread." };
  }
  return { ok: true, kind, normalized: digits };
}

/* ------------------------------------------------------------------ *
 *  Product shape used by the pure functions (subset of the DB row)
 * ------------------------------------------------------------------ */

export type MerchItem = {
  id: string;
  sku: string;
  name: string;
  type: string;
  status: "draft" | "active" | "archived";
  qtyOnHand: number;
  priceMinorUnits: number;
  costMinorUnits: number;
  barcode: string | null;
  reorderPoint: number;
  reorderQty: number;
};

/** Which identifier gets scanned at the register for this item. */
export function scanIdentity(p: Pick<MerchItem, "barcode" | "sku">): {
  mode: "manufacturer_barcode" | "inhouse_sku_label";
  code: string;
} {
  const bc = (p.barcode ?? "").trim();
  return bc
    ? { mode: "manufacturer_barcode", code: bc }
    : { mode: "inhouse_sku_label", code: p.sku };
}

/* ------------------------------------------------------------------ *
 *  Reorder points
 * ------------------------------------------------------------------ */

export type ReorderStatus = "out" | "below" | "near" | "ok" | "untracked";

/** Within 25% above the reorder point counts as "near". */
export const NEAR_REORDER_FACTOR = 1.25;

export function reorderStatusOf(p: Pick<MerchItem, "qtyOnHand" | "reorderPoint">): ReorderStatus {
  const min = Math.max(0, Math.floor(p.reorderPoint));
  const qty = Math.max(0, Math.floor(p.qtyOnHand));
  if (min <= 0) return qty === 0 ? "out" : "untracked";
  if (qty === 0) return "out";
  if (qty <= min) return "below";
  if (qty <= Math.ceil(min * NEAR_REORDER_FACTOR)) return "near";
  return "ok";
}

export type ReorderLine = {
  id: string;
  sku: string;
  name: string;
  type: string;
  qtyOnHand: number;
  reorderPoint: number;
  suggestedQty: number;
  status: ReorderStatus;
};

const REORDER_URGENCY: Record<ReorderStatus, number> = {
  out: 0,
  below: 1,
  near: 2,
  ok: 3,
  untracked: 4,
};

/**
 * Build the "reorder now" list from ACTIVE items: out first, then below,
 * then near — each group sorted by name. suggestedQty = reorder_qty when
 * set, else enough to reach 2× the reorder point (a sane min/max default).
 */
export function buildReorderList(items: MerchItem[]): ReorderLine[] {
  const lines: ReorderLine[] = [];
  for (const p of items) {
    if (p.status !== "active") continue;
    const status = reorderStatusOf(p);
    if (status !== "out" && status !== "below" && status !== "near") continue;
    const min = Math.max(0, Math.floor(p.reorderPoint));
    const suggested =
      p.reorderQty > 0
        ? Math.floor(p.reorderQty)
        : Math.max(1, min * 2 - Math.max(0, Math.floor(p.qtyOnHand)));
    lines.push({
      id: p.id,
      sku: p.sku,
      name: p.name,
      type: p.type,
      qtyOnHand: Math.max(0, Math.floor(p.qtyOnHand)),
      reorderPoint: min,
      suggestedQty: suggested,
      status,
    });
  }
  lines.sort(
    (a, b) => REORDER_URGENCY[a.status] - REORDER_URGENCY[b.status] || a.name.localeCompare(b.name),
  );
  return lines;
}

/* ------------------------------------------------------------------ *
 *  Valuation + ABC by retail value
 * ------------------------------------------------------------------ */

export type MerchValuation = {
  activeItems: number;
  totalUnits: number;
  retailValueMinor: number;
  costValueMinor: number;
  marginMinor: number;
  /** Items with no manufacturer barcode (need an in-house SKU label). */
  needsLabel: number;
};

export function valuateMerch(items: MerchItem[]): MerchValuation {
  let activeItems = 0;
  let totalUnits = 0;
  let retail = 0;
  let cost = 0;
  let needsLabel = 0;
  for (const p of items) {
    if (p.status !== "active") continue;
    activeItems += 1;
    const qty = Math.max(0, Math.floor(p.qtyOnHand));
    totalUnits += qty;
    retail += qty * Math.max(0, p.priceMinorUnits);
    cost += qty * Math.max(0, p.costMinorUnits);
    if (!(p.barcode ?? "").trim()) needsLabel += 1;
  }
  return {
    activeItems,
    totalUnits,
    retailValueMinor: retail,
    costValueMinor: cost,
    marginMinor: retail - cost,
    needsLabel,
  };
}

export type AbcClass = "A" | "B" | "C";

/** Cumulative retail-value breakpoints (standard 80/95 technique). */
export const MERCH_ABC_BREAKPOINTS = { a: 0.8, b: 0.95 } as const;

/**
 * Classify ACTIVE items A/B/C by retail value on hand (price × qty).
 * The single highest-value item is always A; zero-value items are C.
 */
export function classifyMerchAbc(items: MerchItem[]): Map<string, AbcClass> {
  const out = new Map<string, AbcClass>();
  const valued = items
    .filter((p) => p.status === "active")
    .map((p) => ({
      id: p.id,
      value: Math.max(0, Math.floor(p.qtyOnHand)) * Math.max(0, p.priceMinorUnits),
    }))
    .sort((a, b) => b.value - a.value);
  const total = valued.reduce((s, v) => s + v.value, 0);
  if (total <= 0) {
    for (const v of valued) out.set(v.id, "C");
    return out;
  }
  let running = 0;
  for (let i = 0; i < valued.length; i++) {
    const v = valued[i];
    running += v.value;
    const share = running / total;
    if (v.value <= 0) out.set(v.id, "C");
    else if (i === 0 || share <= MERCH_ABC_BREAKPOINTS.a) out.set(v.id, "A");
    else if (share <= MERCH_ABC_BREAKPOINTS.b) out.set(v.id, "B");
    else out.set(v.id, "C");
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Adjustment vocabulary + shrink telemetry
 * ------------------------------------------------------------------ */

/** Controlled adjustment reasons (plain retail — no CCRS hoops). */
export const MERCH_ADJUSTMENT_REASONS = [
  { value: "received", label: "Received stock", sign: +1 },
  { value: "return", label: "Customer return to stock", sign: +1 },
  { value: "count", label: "Count correction", sign: 0 },
  { value: "damaged", label: "Damaged / broken", sign: -1 },
  { value: "theft", label: "Theft / loss", sign: -1 },
  { value: "promo", label: "Promo / giveaway", sign: -1 },
  { value: "sold_correction", label: "Sale not rung correctly", sign: -1 },
  { value: "other", label: "Other", sign: 0 },
] as const;

export type MerchAdjustmentReason = (typeof MERCH_ADJUSTMENT_REASONS)[number]["value"];

const REASON_SET = new Set<string>(MERCH_ADJUSTMENT_REASONS.map((r) => r.value));

export function isMerchAdjustmentReason(v: string): v is MerchAdjustmentReason {
  return REASON_SET.has(v);
}

/**
 * Validate an adjustment before it posts. Rules:
 *  • reason must be in the vocabulary
 *  • delta must be a non-zero integer
 *  • theft and other REQUIRE a note (what happened)
 *  • the result may not take on-hand below zero
 */
export function validateMerchAdjustment(input: {
  reason: string;
  qtyDelta: number;
  note?: string | null;
  currentQty: number;
}): { ok: true } | { ok: false; error: string } {
  if (!isMerchAdjustmentReason(input.reason)) {
    return { ok: false, error: "Pick a valid reason." };
  }
  const delta = input.qtyDelta;
  if (!Number.isInteger(delta) || delta === 0) {
    return { ok: false, error: "Quantity change must be a non-zero whole number." };
  }
  if ((input.reason === "theft" || input.reason === "other") && !(input.note ?? "").trim()) {
    return { ok: false, error: "A note is required for theft/other — say what happened." };
  }
  const next = Math.max(0, Math.floor(input.currentQty)) + delta;
  if (next < 0) {
    return { ok: false, error: `That would take on-hand below zero (${input.currentQty} on hand).` };
  }
  return { ok: true };
}

export type MerchAdjustmentRow = {
  productId: string;
  qtyDelta: number;
  reason: string;
};

export type MerchShrinkSummary = {
  /** Units removed (absolute) per reason, negative deltas only. */
  unitsByReason: Map<string, number>;
  /** Cost value (minor units) removed per reason. */
  valueByReasonMinor: Map<string, number>;
  totalUnitsRemoved: number;
  totalValueRemovedMinor: number;
};

/**
 * Summarize negative adjustments (shrink) valued at COST. Positive deltas
 * (receiving, returns) are excluded — this is the "what left the shelves
 * outside a sale" view.
 */
export function summarizeMerchShrink(
  adjustments: MerchAdjustmentRow[],
  costByProductMinor: Map<string, number>,
): MerchShrinkSummary {
  const unitsByReason = new Map<string, number>();
  const valueByReasonMinor = new Map<string, number>();
  let totalUnits = 0;
  let totalValue = 0;
  for (const a of adjustments) {
    if (a.qtyDelta >= 0) continue;
    const units = Math.abs(a.qtyDelta);
    const cost = Math.max(0, costByProductMinor.get(a.productId) ?? 0);
    const value = units * cost;
    unitsByReason.set(a.reason, (unitsByReason.get(a.reason) ?? 0) + units);
    valueByReasonMinor.set(a.reason, (valueByReasonMinor.get(a.reason) ?? 0) + value);
    totalUnits += units;
    totalValue += value;
  }
  return {
    unitsByReason,
    valueByReasonMinor,
    totalUnitsRemoved: totalUnits,
    totalValueRemovedMinor: totalValue,
  };
}

/* ------------------------------------------------------------------ *
 *  Embedded self-tests
 * ------------------------------------------------------------------ */

export function __runMerchIntelTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
  };

  // --- barcode validation (known-good real-world codes) ---
  // UPC-A: 036000291452 is the canonical GS1 example (check digit 2).
  assert(validateRetailBarcode("036000291452").ok, "valid UPC-A accepted");
  assert(!validateRetailBarcode("036000291453").ok, "bad UPC-A check digit rejected");
  // EAN-13: 4006381333931 is the canonical example (check digit 1).
  const ean = validateRetailBarcode("4006381333931");
  assert(ean.ok && ean.kind === "ean_13", "valid EAN-13 accepted");
  // EAN-8: 96385074 (check digit 4).
  const e8 = validateRetailBarcode("9638-5074");
  assert(e8.ok && e8.kind === "ean_8" && e8.normalized === "96385074", "EAN-8 + normalization");
  assert(!validateRetailBarcode("12345").ok, "wrong length rejected");
  assert(!validateRetailBarcode("").ok, "empty rejected");

  // --- scan identity ---
  assert(
    scanIdentity({ barcode: "036000291452", sku: "LTR-0001" }).mode === "manufacturer_barcode",
    "barcode wins",
  );
  assert(
    scanIdentity({ barcode: null, sku: "BONG-0001" }).code === "BONG-0001",
    "sku label fallback",
  );

  // --- reorder ---
  assert(reorderStatusOf({ qtyOnHand: 0, reorderPoint: 5 }) === "out", "out");
  assert(reorderStatusOf({ qtyOnHand: 5, reorderPoint: 5 }) === "below", "below at min");
  assert(reorderStatusOf({ qtyOnHand: 6, reorderPoint: 5 }) === "near", "near (<=125%)");
  assert(reorderStatusOf({ qtyOnHand: 20, reorderPoint: 5 }) === "ok", "ok");
  assert(reorderStatusOf({ qtyOnHand: 3, reorderPoint: 0 }) === "untracked", "no min = untracked");
  assert(reorderStatusOf({ qtyOnHand: 0, reorderPoint: 0 }) === "out", "zero qty always out");

  const mk = (over: Partial<MerchItem>): MerchItem => ({
    id: over.id ?? "x",
    sku: over.sku ?? "SKU",
    name: over.name ?? "Item",
    type: over.type ?? "pipe",
    status: over.status ?? "active",
    qtyOnHand: over.qtyOnHand ?? 0,
    priceMinorUnits: over.priceMinorUnits ?? 0,
    costMinorUnits: over.costMinorUnits ?? 0,
    barcode: over.barcode ?? null,
    reorderPoint: over.reorderPoint ?? 0,
    reorderQty: over.reorderQty ?? 0,
  });

  const list = buildReorderList([
    mk({ id: "a", name: "Bic Lighter", qtyOnHand: 0, reorderPoint: 24, reorderQty: 50 }),
    mk({ id: "b", name: "Raw Papers", qtyOnHand: 10, reorderPoint: 12 }),
    mk({ id: "c", name: "Glass Pipe", qtyOnHand: 100, reorderPoint: 5 }),
    mk({ id: "d", name: "Archived Thing", status: "archived", qtyOnHand: 0, reorderPoint: 5 }),
  ]);
  assert(list.length === 2, "reorder list: out + below only, actives only");
  assert(list[0].id === "a" && list[0].status === "out", "out first");
  assert(list[0].suggestedQty === 50, "explicit reorder_qty used");
  assert(list[1].id === "b" && list[1].suggestedQty === 12 * 2 - 10, "2x-min default suggestion");

  // --- valuation ---
  const val = valuateMerch([
    mk({ id: "a", qtyOnHand: 10, priceMinorUnits: 500, costMinorUnits: 200, barcode: "036000291452" }),
    mk({ id: "b", qtyOnHand: 2, priceMinorUnits: 2500, costMinorUnits: 1000 }),
    mk({ id: "c", status: "draft", qtyOnHand: 99, priceMinorUnits: 100 }),
  ]);
  assert(val.activeItems === 2 && val.totalUnits === 12, "valuation counts actives only");
  assert(val.retailValueMinor === 10 * 500 + 2 * 2500, "retail value");
  assert(val.costValueMinor === 10 * 200 + 2 * 1000, "cost value");
  assert(val.marginMinor === val.retailValueMinor - val.costValueMinor, "margin");
  assert(val.needsLabel === 1, "needs-label counts items without barcode");

  // --- ABC ---
  const abc = classifyMerchAbc([
    mk({ id: "big", qtyOnHand: 100, priceMinorUnits: 10000 }), // dominant
    mk({ id: "mid", qtyOnHand: 10, priceMinorUnits: 2000 }),
    mk({ id: "tiny", qtyOnHand: 1, priceMinorUnits: 100 }),
    mk({ id: "zero", qtyOnHand: 0, priceMinorUnits: 5000 }),
  ]);
  assert(abc.get("big") === "A", "dominant is A");
  assert(abc.get("zero") === "C", "zero value is C");

  // --- adjustment validation ---
  assert(
    validateMerchAdjustment({ reason: "damaged", qtyDelta: -2, currentQty: 5 }).ok,
    "damaged -2 ok",
  );
  assert(
    !validateMerchAdjustment({ reason: "theft", qtyDelta: -1, currentQty: 5 }).ok,
    "theft requires note",
  );
  assert(
    validateMerchAdjustment({ reason: "theft", qtyDelta: -1, note: "smash and grab", currentQty: 5 }).ok,
    "theft with note ok",
  );
  assert(
    !validateMerchAdjustment({ reason: "damaged", qtyDelta: -9, currentQty: 5 }).ok,
    "below zero blocked",
  );
  assert(
    !validateMerchAdjustment({ reason: "damaged", qtyDelta: 0, currentQty: 5 }).ok,
    "zero delta blocked",
  );
  assert(
    !validateMerchAdjustment({ reason: "nope", qtyDelta: -1, currentQty: 5 }).ok,
    "unknown reason blocked",
  );
  assert(
    validateMerchAdjustment({ reason: "received", qtyDelta: 24, currentQty: 0 }).ok,
    "receive ok",
  );

  // --- shrink ---
  const shrink = summarizeMerchShrink(
    [
      { productId: "a", qtyDelta: -3, reason: "damaged" },
      { productId: "a", qtyDelta: -1, reason: "theft" },
      { productId: "b", qtyDelta: 12, reason: "received" },
    ],
    new Map([
      ["a", 200],
      ["b", 100],
    ]),
  );
  assert(shrink.totalUnitsRemoved === 4, "shrink units");
  assert(shrink.totalValueRemovedMinor === 4 * 200, "shrink value at cost");
  assert(shrink.unitsByReason.get("damaged") === 3, "by reason");
  assert(!shrink.unitsByReason.has("received"), "positive deltas excluded");

  console.log("noncannabis/merch-intel-core: all tests passed");
}
