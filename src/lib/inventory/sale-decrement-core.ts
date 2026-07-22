/**
 * src/lib/inventory/sale-decrement-core.ts  (POS Slice B19)
 *
 * PURE planning math for decrementing store inventory when a sale COMPLETES.
 * Zero I/O — the server wrapper (sale-decrement.ts) loads rows, calls these
 * planners, and applies the returned updates.
 *
 * WHY THIS EXISTS (verified gap): until B19, NOTHING reduced stock at sale.
 * `menu_variants.inventory_level` was only written by menu imports / intake /
 * draft-injection, and `inventory_lots.on_hand_qty` only by dispositions and
 * cycle counts — migration 0023's own comment promised on-hand would be
 * "maintained by adjustments + the sell flow in a later slice". B19 is that
 * slice. Note the `inventory_adjustments` reason vocabulary deliberately
 * excludes sales ("Every change to on-hand that ISN'T a sale"), so sales
 * update on-hand directly; the order's own lines are the audit trail.
 *
 * TWO LAYERS OF TRUTH, BOTH DECREMENTED:
 *   1. PUBLISHED MENU (menu_variants.inventory_level + the item-level
 *      inventory_status that gates card visibility on the site and in the
 *      register bundle). Matched per line by variant.
 *   2. INVENTORY LOTS (inventory_lots.on_hand_qty, keyed by pos_product_key =
 *      order_lines.product_id) consumed FIFO — oldest active lot first. The
 *      lot layer feeds CCRS identifiers, purchasing, and COGS.
 *
 * MATCHING (defensive, never guesses):
 *   - line.variantId (menu_variants.source_variant_id) when present — online
 *     orders always have it; POS lines have it from B19 onward.
 *   - else, if the item has EXACTLY ONE variant, that variant.
 *   - else, the trailing "(label)" the register bakes into productName
 *     ("Blue Dream (3.5g)") matched against variant labels, case-insensitive.
 *   - else the line is reported UNMATCHED (menu layer skipped for it; the lot
 *     layer still decrements by product key, which needs no variant).
 *
 * STATUS RECOMPUTE GUARD: an item's inventory_status is recomputed from the
 * summed post-plan variant levels using the IDENTICAL thresholds the import
 * pipeline uses (<=0 unavailable, <=3 low-stock, else in-stock — see
 * transform.ts statusForInventory), but ONLY when the item tracked stock
 * BEFORE the sale (pre-plan total > 0). Items whose variants all sat at 0
 * while staff sold them anyway are untracked — flipping them to "unavailable"
 * would wrongly hide live products, so their status is left alone.
 *
 * OVERSELL: levels are clamped at 0 (never stored negative — the syndication
 * feed and status math treat <=0 as out) and every clamp is reported so the
 * completion hook can leave a visible note for cycle counts to reconcile.
 *
 * Quantities are integer sellable units throughout; money never appears here.
 */

// Pure variant → lot-key resolution (Product Mastering Slice 1). No cycle:
// variant-lot-core imports nothing.
import { lotKeyForSaleLine } from "@/lib/pos/variant-lot-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SaleLineForDecrement = {
  /** order_lines.id — used only for human-readable notes. */
  lineId: string;
  /** order_lines.product_id = menu_items.source_item_id (nullable snapshot). */
  productId: string | null;
  /** order_lines.variant_id = menu_variants.source_variant_id (nullable). */
  variantId: string | null;
  productName: string;
  quantity: number;
};

export type VariantForDecrement = {
  /** menu_variants.id (row PK — what the UPDATE targets). */
  rowId: string;
  /** menu_variants.menu_item_id. */
  menuItemRowId: string;
  /** menu_variants.source_variant_id (what order_lines.variant_id stores). */
  sourceVariantId: string;
  label: string;
  inventoryLevel: number;
};

export type ItemForDecrement = {
  /** menu_items.id (row PK). */
  rowId: string;
  /** menu_items.source_item_id (what order_lines.product_id stores). */
  sourceItemId: string;
  inventoryStatus: string;
};

export type VariantDecrementPlan = {
  /**
   * newLevel = the plan's clamped absolute (legacy/pre-0129 fallback write);
   * delta    = the RAW units sold (negative), for the atomic DB delta —
   *            under concurrency deltas COMBINE where absolutes overwrite
   *            (GW-012).
   */
  variantUpdates: { rowId: string; newLevel: number; delta: number }[];
  itemStatusUpdates: { rowId: string; newStatus: InventoryStatusSlug }[];
  /** Human notes: lines that sold more than the tracked level (clamped to 0). */
  oversold: string[];
  /** Human notes: lines no variant could be resolved for (menu layer skipped). */
  unmatched: string[];
};

export type LotForDecrement = {
  /** inventory_lots.id. */
  id: string;
  /** inventory_lots.pos_product_key (= order_lines.product_id). */
  posProductKey: string;
  onHandQty: number;
  /**
   * The lot's canonical CCRS InventoryExternalIdentifier (POS B20) — the
   * caller derives it via deriveInventoryExternalId. Optional; when present
   * the plan reports which id each product key consumed FIRST so the sale
   * lines can be stamped for a precise "line"-source CCRS Sale.csv.
   */
  ccrsExternalId?: string | null;
};

export type LotDecrementPlan = {
  /** newOnHand = legacy absolute; delta = raw units consumed (negative) for
   *  the atomic DB write (GW-012 — deltas combine, absolutes overwrite). */
  lotUpdates: { id: string; posProductKey: string; newOnHand: number; soldOut: boolean; delta: number }[];
  /**
   * POS B20: product key → the CCRS external id of the FIRST (oldest) lot the
   * sale consumed. Used to stamp order_lines.ccrs_inventory_external_id so the
   * weekly Sale.csv resolves source "line" (exact), not "product_key".
   */
  lineExternalIds: Map<string, string>;
  /** Human notes: demand that exceeded ALL active lots for a product key. */
  shortfalls: string[];
};

export type InventoryStatusSlug = "in-stock" | "low-stock" | "unavailable";

// ---------------------------------------------------------------------------
// Status thresholds — MUST stay identical to transform.ts statusForInventory
// ---------------------------------------------------------------------------

export function statusForLevelTotal(total: number): InventoryStatusSlug {
  if (total <= 0) return "unavailable";
  if (total <= 3) return "low-stock";
  return "in-stock";
}

// ---------------------------------------------------------------------------
// Variant-label fallback: the register bakes "(label)" into productName
// ---------------------------------------------------------------------------

/** Extract the trailing parenthesized label from "Name (3.5g)" → "3.5g". */
export function trailingLabel(productName: string): string | null {
  const m = /\(([^()]+)\)\s*$/.exec(productName);
  const label = m?.[1]?.trim() ?? "";
  return label ? label : null;
}

// ---------------------------------------------------------------------------
// Menu-layer plan
// ---------------------------------------------------------------------------

export function buildVariantDecrementPlan(
  lines: SaleLineForDecrement[],
  items: ItemForDecrement[],
  variants: VariantForDecrement[],
): VariantDecrementPlan {
  const itemBySource = new Map(items.map((i) => [i.sourceItemId, i]));
  const variantsByItemRow = new Map<string, VariantForDecrement[]>();
  for (const v of variants) {
    const list = variantsByItemRow.get(v.menuItemRowId) ?? [];
    list.push(v);
    variantsByItemRow.set(v.menuItemRowId, list);
  }

  // Working levels so several lines hitting one variant accumulate correctly.
  const workingLevel = new Map<string, number>(
    variants.map((v) => [v.rowId, Math.trunc(Number(v.inventoryLevel) || 0)]),
  );
  // GW-012: raw units sold per variant — the atomic-delta path sends THIS to
  // the database (deltas combine under concurrency; absolutes overwrite).
  const soldByVariant = new Map<string, number>();
  const touchedVariantRows = new Set<string>();
  const touchedItemRows = new Set<string>();
  const oversold: string[] = [];
  const unmatched: string[] = [];

  for (const line of lines) {
    const qty = Math.max(0, Math.trunc(Number(line.quantity) || 0));
    if (qty <= 0) continue;
    const item = line.productId ? itemBySource.get(line.productId) : undefined;
    if (!item) {
      unmatched.push(`"${line.productName}" — no published menu item for key ${line.productId ?? "(none)"}.`);
      continue;
    }
    const candidates = variantsByItemRow.get(item.rowId) ?? [];
    let variant: VariantForDecrement | undefined;
    if (line.variantId) {
      variant = candidates.find((v) => v.sourceVariantId === line.variantId);
    }
    if (!variant && candidates.length === 1) variant = candidates[0];
    if (!variant) {
      const label = trailingLabel(line.productName);
      if (label) {
        const lower = label.toLowerCase();
        variant = candidates.find((v) => v.label.trim().toLowerCase() === lower);
      }
    }
    if (!variant) {
      unmatched.push(
        `"${line.productName}" — item found but none of its ${candidates.length} variant(s) matched.`,
      );
      continue;
    }
    const before = workingLevel.get(variant.rowId) ?? 0;
    const after = before - qty;
    if (after < 0) {
      oversold.push(
        `"${line.productName}" — sold ${qty}, only ${Math.max(0, before)} tracked (level clamped to 0; cycle count to reconcile).`,
      );
    }
    workingLevel.set(variant.rowId, Math.max(0, after));
    soldByVariant.set(variant.rowId, (soldByVariant.get(variant.rowId) ?? 0) + qty);
    touchedVariantRows.add(variant.rowId);
    touchedItemRows.add(item.rowId);
  }

  const variantUpdates = [...touchedVariantRows].map((rowId) => ({
    rowId,
    newLevel: workingLevel.get(rowId) ?? 0,
    delta: -(soldByVariant.get(rowId) ?? 0),
  }));

  // Item status recompute — guarded to items that TRACKED stock pre-sale.
  const itemStatusUpdates: { rowId: string; newStatus: InventoryStatusSlug }[] = [];
  const itemByRow = new Map(items.map((i) => [i.rowId, i]));
  for (const rowId of touchedItemRows) {
    const item = itemByRow.get(rowId);
    if (!item) continue;
    const siblings = variantsByItemRow.get(rowId) ?? [];
    const preTotal = siblings.reduce((s, v) => s + Math.trunc(Number(v.inventoryLevel) || 0), 0);
    if (preTotal <= 0) continue; // untracked — never flip status on a sale
    const postTotal = siblings.reduce((s, v) => s + (workingLevel.get(v.rowId) ?? 0), 0);
    const newStatus = statusForLevelTotal(postTotal);
    if (newStatus !== item.inventoryStatus) itemStatusUpdates.push({ rowId, newStatus });
  }

  return { variantUpdates, itemStatusUpdates, oversold, unmatched };
}

// ---------------------------------------------------------------------------
// Lot-layer plan (FIFO — caller supplies lots oldest-first)
// ---------------------------------------------------------------------------

export function buildLotDecrementPlan(
  lines: SaleLineForDecrement[],
  lotsFifo: LotForDecrement[],
): LotDecrementPlan {
  // Aggregate demand per LOT key — the variant's own encoded lot key when
  // present (mastered cards carry one lot per size variant), else the line's
  // product_id snapshot (single-lot cards: the two keys coincide, so this is
  // byte-for-byte the pre-mastering behaviour). See variant-lot-core.ts.
  const demand = new Map<string, number>();
  for (const line of lines) {
    const key = lotKeyForSaleLine(line);
    if (!key) continue;
    const qty = Math.max(0, Math.trunc(Number(line.quantity) || 0));
    if (qty <= 0) continue;
    demand.set(key, (demand.get(key) ?? 0) + qty);
  }

  const lotUpdates: { id: string; posProductKey: string; newOnHand: number; soldOut: boolean; delta: number }[] = [];
  const lineExternalIds = new Map<string, string>();
  const shortfalls: string[] = [];

  for (const [key, qtyNeeded] of demand) {
    let remaining = qtyNeeded;
    for (const lot of lotsFifo) {
      if (remaining <= 0) break;
      if (lot.posProductKey !== key) continue;
      const onHand = Math.max(0, Math.trunc(Number(lot.onHandQty) || 0));
      if (onHand <= 0) continue;
      const take = Math.min(onHand, remaining);
      remaining -= take;
      const newOnHand = onHand - take;
      lotUpdates.push({ id: lot.id, posProductKey: key, newOnHand, soldOut: newOnHand === 0, delta: -take });
      // POS B20: the FIRST (oldest) consumed lot's canonical CCRS id stamps
      // the sale lines for this product key — matching the FIFO consumption.
      const extId = (lot.ccrsExternalId ?? "").trim();
      if (extId && !lineExternalIds.has(key)) lineExternalIds.set(key, extId);
    }
    if (remaining > 0) {
      shortfalls.push(
        `Product key ${key}: ${remaining} unit(s) had no active lot to consume (lots exhausted or never intaken).`,
      );
    }
  }

  return { lotUpdates, lineExternalIds, shortfalls };
}

// ---------------------------------------------------------------------------
// Summary line for the order_events note (idempotency marker + human trail)
// ---------------------------------------------------------------------------

export function summarizeDecrement(opts: {
  variantPlan: VariantDecrementPlan;
  lotPlan: LotDecrementPlan;
  lineCount: number;
}): string {
  const parts: string[] = [
    `Inventory decremented for ${opts.lineCount} line(s): ${opts.variantPlan.variantUpdates.length} menu variant(s), ${opts.lotPlan.lotUpdates.length} lot touch(es).`,
  ];
  if (opts.variantPlan.itemStatusUpdates.length) {
    parts.push(`${opts.variantPlan.itemStatusUpdates.length} item status change(s).`);
  }
  if (opts.variantPlan.oversold.length) parts.push(`OVERSOLD: ${opts.variantPlan.oversold.join(" ")}`);
  if (opts.variantPlan.unmatched.length) parts.push(`UNMATCHED: ${opts.variantPlan.unmatched.join(" ")}`);
  if (opts.lotPlan.shortfalls.length) parts.push(`LOT SHORTFALL: ${opts.lotPlan.shortfalls.join(" ")}`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runSaleDecrementCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // Status thresholds mirror transform.ts statusForInventory exactly.
  ok(statusForLevelTotal(0) === "unavailable", "0 → unavailable");
  ok(statusForLevelTotal(-2) === "unavailable", "negative → unavailable");
  ok(statusForLevelTotal(3) === "low-stock", "3 → low-stock");
  ok(statusForLevelTotal(4) === "in-stock", "4 → in-stock");

  // Trailing label extraction.
  ok(trailingLabel("Blue Dream (3.5g)") === "3.5g", "extracts trailing label");
  ok(trailingLabel("Plain Name") === null, "no parens → null");
  ok(trailingLabel("Weird (a) middle") === null, "non-trailing parens ignored");
  ok(trailingLabel("Nested (outer (1g)") === "1g", "innermost trailing group wins");

  const items: ItemForDecrement[] = [
    { rowId: "item-row-1", sourceItemId: "prod-1", inventoryStatus: "in-stock" },
    { rowId: "item-row-2", sourceItemId: "prod-2", inventoryStatus: "in-stock" },
    { rowId: "item-row-3", sourceItemId: "prod-3", inventoryStatus: "in-stock" },
  ];
  const variants: VariantForDecrement[] = [
    { rowId: "v-1", menuItemRowId: "item-row-1", sourceVariantId: "var-1", label: "3.5g", inventoryLevel: 5 },
    { rowId: "v-2", menuItemRowId: "item-row-1", sourceVariantId: "var-2", label: "7g", inventoryLevel: 2 },
    { rowId: "v-3", menuItemRowId: "item-row-2", sourceVariantId: "var-3", label: "1g", inventoryLevel: 1 },
    { rowId: "v-4", menuItemRowId: "item-row-3", sourceVariantId: "var-4", label: "each", inventoryLevel: 0 },
  ];

  // 1) Explicit variantId match decrements and drops item to low-stock.
  const p1 = buildVariantDecrementPlan(
    [{ lineId: "l1", productId: "prod-1", variantId: "var-1", productName: "Blue Dream (3.5g)", quantity: 4 }],
    items,
    variants,
  );
  ok(p1.variantUpdates.length === 1 && p1.variantUpdates[0].rowId === "v-1" && p1.variantUpdates[0].newLevel === 1, "explicit variant decremented 5→1");
  ok(p1.variantUpdates[0].delta === -4, "GW-012: raw delta carried for the atomic DB write");
  ok(p1.itemStatusUpdates.length === 1 && p1.itemStatusUpdates[0].newStatus === "low-stock", "item recomputed to low-stock (1+2=3)");
  ok(p1.oversold.length === 0 && p1.unmatched.length === 0, "clean plan has no notes");

  // 2) Label fallback (no variantId) + accumulation over two lines.
  const p2 = buildVariantDecrementPlan(
    [
      { lineId: "l1", productId: "prod-1", variantId: null, productName: "Blue Dream (7g)", quantity: 1 },
      { lineId: "l2", productId: "prod-1", variantId: null, productName: "Blue Dream (7g)", quantity: 1 },
    ],
    items,
    variants,
  );
  ok(p2.variantUpdates.length === 1 && p2.variantUpdates[0].newLevel === 0, "label fallback accumulates 2→0");
  ok(p2.itemStatusUpdates.length === 0, "post total 5+0=5 stays in-stock — unchanged status emits no update");

  // 3) Single-variant fallback + oversell clamp + status flip to unavailable.
  const p3 = buildVariantDecrementPlan(
    [{ lineId: "l1", productId: "prod-2", variantId: null, productName: "Solo Gram", quantity: 3 }],
    items,
    variants,
  );
  ok(p3.variantUpdates[0]?.newLevel === 0, "oversell clamped at 0");
  ok(p3.variantUpdates[0]?.delta === -3, "GW-012: oversell delta stays RAW (DB clamps, absolutes don't combine)");
  ok(p3.oversold.length === 1, "oversell reported");
  ok(p3.itemStatusUpdates[0]?.newStatus === "unavailable", "tracked item flips to unavailable");

  // 4) Untracked item (all levels 0) never flips status.
  const p4 = buildVariantDecrementPlan(
    [{ lineId: "l1", productId: "prod-3", variantId: "var-4", productName: "Untracked (each)", quantity: 1 }],
    items,
    variants,
  );
  ok(p4.itemStatusUpdates.length === 0, "untracked item status untouched");
  ok(p4.variantUpdates[0]?.newLevel === 0, "untracked variant stays clamped at 0");
  ok(p4.oversold.length === 1, "untracked oversell still reported");

  // 5) Unknown product key + unmatched multi-variant line.
  const p5 = buildVariantDecrementPlan(
    [
      { lineId: "l1", productId: "ghost", variantId: null, productName: "Ghost", quantity: 1 },
      { lineId: "l2", productId: "prod-1", variantId: null, productName: "No Label Here", quantity: 1 },
    ],
    items,
    variants,
  );
  ok(p5.unmatched.length === 2 && p5.variantUpdates.length === 0, "unknown key + unresolvable variant both reported, nothing changed");

  // 6) Zero/negative quantities are ignored.
  const p6 = buildVariantDecrementPlan(
    [{ lineId: "l1", productId: "prod-1", variantId: "var-1", productName: "Blue Dream (3.5g)", quantity: 0 }],
    items,
    variants,
  );
  ok(p6.variantUpdates.length === 0 && p6.unmatched.length === 0, "zero qty is a no-op");

  // Lot FIFO plan.
  const lots: LotForDecrement[] = [
    { id: "lot-a", posProductKey: "prod-1", onHandQty: 2, ccrsExternalId: "LOT-A-CCRS" },
    { id: "lot-b", posProductKey: "prod-1", onHandQty: 5, ccrsExternalId: "LOT-B-CCRS" },
    { id: "lot-c", posProductKey: "prod-2", onHandQty: 1 },
  ];
  const lp1 = buildLotDecrementPlan(
    [{ lineId: "l1", productId: "prod-1", variantId: null, productName: "BD", quantity: 3 }],
    lots,
  );
  ok(lp1.lotUpdates.length === 2, "FIFO spans two lots");
  ok(lp1.lotUpdates[0].id === "lot-a" && lp1.lotUpdates[0].newOnHand === 0 && lp1.lotUpdates[0].soldOut, "oldest lot drained first and marked sold out");
  ok(lp1.lotUpdates[1].id === "lot-b" && lp1.lotUpdates[1].newOnHand === 4 && !lp1.lotUpdates[1].soldOut, "second lot partially consumed");
  ok(lp1.lotUpdates[0].delta === -2 && lp1.lotUpdates[1].delta === -1, "GW-012: per-lot deltas match the FIFO takes");
  ok(lp1.shortfalls.length === 0, "no shortfall when lots cover demand");
  ok(lp1.lineExternalIds.get("prod-1") === "LOT-A-CCRS", "B20: FIRST consumed lot's CCRS id stamps the key");

  const lp2 = buildLotDecrementPlan(
    [{ lineId: "l1", productId: "prod-2", variantId: null, productName: "SG", quantity: 4 }],
    lots,
  );
  ok(lp2.lotUpdates.length === 1 && lp2.lotUpdates[0].newOnHand === 0, "short lot drained");
  ok(lp2.shortfalls.length === 1 && lp2.shortfalls[0].includes("3 unit(s)"), "shortfall reports the uncovered remainder");

  const lp3 = buildLotDecrementPlan(
    [{ lineId: "l1", productId: null, variantId: null, productName: "No Key", quantity: 2 }],
    lots,
  );
  ok(lp3.lotUpdates.length === 0 && lp3.shortfalls.length === 0, "keyless line skips the lot layer silently");

  // Demand aggregation across lines of the same key.
  const lp4 = buildLotDecrementPlan(
    [
      { lineId: "l1", productId: "prod-1", variantId: null, productName: "BD (3.5g)", quantity: 2 },
      { lineId: "l2", productId: "prod-1", variantId: null, productName: "BD (7g)", quantity: 5 },
    ],
    lots,
  );
  ok(lp4.lotUpdates.reduce((s, u) => s + u.newOnHand, 0) === 0 && lp4.lotUpdates.length === 2, "aggregated demand drains both lots exactly");
  ok(lp4.shortfalls.length === 0, "7 demanded, 7 available — no shortfall");

  // ── Mastering Slice 1: variant-encoded lot keys ────────────────────────
  // A mastered card ("card-1") whose two size variants each carry their own
  // lot's key: LOT-A (1g) and LOT-B (3.5g).
  const masteredLots: LotForDecrement[] = [
    { id: "lot-A", posProductKey: "LOT-A", onHandQty: 4, ccrsExternalId: "CCRS-A" },
    { id: "lot-B", posProductKey: "LOT-B", onHandQty: 4, ccrsExternalId: "CCRS-B" },
    { id: "lot-card", posProductKey: "card-1", onHandQty: 9, ccrsExternalId: "CCRS-CARD" },
  ];
  const mp1 = buildLotDecrementPlan(
    [
      { lineId: "l1", productId: "card-1", variantId: "LOT-A-onboarded", productName: "BD (1g)", quantity: 2 },
      { lineId: "l2", productId: "card-1", variantId: "LOT-B-onboarded", productName: "BD (3.5g)", quantity: 1 },
    ],
    masteredLots,
  );
  ok(mp1.lotUpdates.length === 2, "mastered: each size consumed ITS OWN lot");
  ok(
    mp1.lotUpdates.some((u) => u.id === "lot-A" && u.newOnHand === 2) &&
      mp1.lotUpdates.some((u) => u.id === "lot-B" && u.newOnHand === 3),
    "mastered: exact per-lot quantities",
  );
  ok(
    !mp1.lotUpdates.some((u) => u.id === "lot-card"),
    "mastered: the card-keyed lot is NEVER touched when variants carry their own keys",
  );
  ok(
    mp1.lineExternalIds.get("LOT-A") === "CCRS-A" && mp1.lineExternalIds.get("LOT-B") === "CCRS-B",
    "mastered: CCRS ids stamp per LOT key, not per card",
  );
  // Pre-mastering single-lot card: variant id encodes the SAME key as the
  // product id — behaviour identical to a bare product_id line.
  const mp2 = buildLotDecrementPlan(
    [{ lineId: "l1", productId: "prod-1", variantId: "prod-1-onboarded", productName: "SG", quantity: 3 }],
    lots,
  );
  ok(
    mp2.lotUpdates.length === 2 && mp2.lotUpdates[0].id === "lot-a" && mp2.lotUpdates[0].newOnHand === 0,
    "single-lot card: -onboarded variant resolves to the same key (FIFO unchanged)",
  );
  // Non-intake variant ids (bulk import hashes) fall back to product_id.
  const mp3 = buildLotDecrementPlan(
    [{ lineId: "l1", productId: "prod-2", variantId: "pos-x-y", productName: "SG", quantity: 1 }],
    lots,
  );
  ok(mp3.lotUpdates.length === 1 && mp3.lotUpdates[0].id === "lot-c", "bulk-import variant id falls back to product_id");

  // Summary composition.
  const summary = summarizeDecrement({ variantPlan: p3, lotPlan: lp2, lineCount: 1 });
  ok(summary.includes("OVERSOLD") && summary.includes("LOT SHORTFALL"), "summary carries oversell + shortfall notes");
  const cleanSummary = summarizeDecrement({ variantPlan: p1, lotPlan: lp1, lineCount: 1 });
  ok(!cleanSummary.includes("OVERSOLD") && !cleanSummary.includes("UNMATCHED"), "clean summary omits warning sections");

  if (fail > 0) throw new Error(`sale-decrement-core: ${fail} failure(s)`);
  console.log(`sale-decrement-core: ${pass} assertions passed`);
}
