/**
 * src/lib/pos/register-availability-core.ts   (SLICE 16)
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS — THE DEFECT, PROVEN, NOT GUESSED
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Owner report, verbatim: "in the register app, I have been trying to scan
 * things that are showing up in the back office inventory page, but shows as
 * unavailable for sale on the register. I tried several to see if it was
 * universal ... but I found some products that do appear in the register side
 * and do work to add them to the cart when scanned."
 *
 * That "some work, some don't" pattern is the fingerprint of TWO STOCK
 * COUNTERS THAT ARE NEVER RECONCILED. The recon proved it:
 *
 *   BACK OFFICE on-hand = `inventory_lots.on_hand_qty`
 *       (src/lib/inventory/store.ts listAllLotsForFiltering — `select("*")`,
 *        NO status filter, fully paged: it shows EVERY lot.)
 *
 *   REGISTER    on-hand = `menu_variants.inventory_level`, summed into
 *       `menu_items.inventory_status` on the ONE published `menu_versions`
 *        snapshot (src/lib/pos/live-menu.ts -> loadLiveMenuAll).
 *
 * The two are joined only by `inventory_lots.pos_product_key` ->
 * `menu_items.source_item_id` (migration 0023_pos_inventory_lots.sql:96).
 *
 * WHO WRITES WHICH COUNTER (counted across the repo — this is the evidence):
 *
 *   file                              on_hand_qty   inventory_level
 *   ────────────────────────────────  ───────────   ───────────────
 *   inventory/cycle-counts.ts              yes            NO
 *   inventory/disposition.ts               yes            NO
 *   inventory/intake-store.ts              yes            NO
 *   inventory/sale-decrement.ts            yes            yes
 *   pos/void-store.ts                      yes            yes
 *
 * So a sale and a void keep both numbers in step. EVERY OTHER DOOR — a cycle
 * count correction, a disposition reversal, an intake adjustment, a bulk fill
 * — moves the back-office number and leaves the register's number frozen at
 * whatever it was when the product was imported or staged.
 *
 * THE CASCADE that follows a frozen `inventory_level` of 0:
 *
 *   inventory_level 0  ->  inventory_status "unavailable"
 *                          (intake-menu-staging-core.ts:311, and the identical
 *                           thresholds in sale-decrement-core.ts:137-141 and
 *                           transform.ts:590-594)
 *     -> /api/pos/menu:  `if (item.inventoryStatus === "unavailable") continue`
 *     -> the card never enters `products`
 *     -> its key never enters `sellableKeys`
 *     -> buildBarcodeIndex drops the lot (`!sellableKeys.has(key)`)
 *     -> resolveScan returns "none"
 *     -> the register prints: Barcode "X" matched nothing on the menu
 *        (src/app/(site)/pos/SaleFlow.tsx:2399)
 *
 * Real cannabis, sitting on the shelf, present and correct in the back office,
 * that the register refuses to sell — and no message anywhere explaining why.
 *
 * It compounds two more ways, both proven:
 *
 *   • CARRIED FORWARD FOREVER. `carryForward()` copies `inventory_status` and
 *     `inventory_level` verbatim into each new staged snapshot
 *     (intake-menu-staging-core.ts:313-371), so once a card is wrongly
 *     "unavailable" every future publish re-copies the wrongness. The only
 *     wake-up in the codebase is `applyMergeToCarried()`, which fires ONLY
 *     when a brand-new lot for that product passes through intake mastering.
 *
 *   • THE 86 BUTTON IS ONE-WAY. /api/pos/stock-flag sets "unavailable"
 *     (route.ts:79) and NOTHING in src/app/admin ever writes it back to
 *     "in-stock". A cashier tapping "Shelf is empty? Mark out of stock"
 *     (SaleFlow.tsx:3729) kills that product at the register permanently,
 *     even after it is restocked.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT THIS CORE DOES
 * ═════════════════════════════════════════════════════════════════════════
 *
 * It reconciles the register's cached availability flag against LIVE LOT
 * TRUTH at bundle-build time. `inventory_lots` is the table the owner is
 * actually looking at in the back office, so it is the right authority for
 * the question "is there stock?".
 *
 * No migration is required (the owner applies migrations by hand, one at a
 * time), no backfill is required, and it is self-healing: the very next menu
 * download repairs every stale card at once.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE ONE-WAY SAFETY INVARIANT  (the most important rule in this file)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Reconciliation may only ever ADD sellability. It must NEVER remove it.
 *
 * The owner asked for the full back-office list to become sellable. A change
 * that also started hiding products would be a new outage wearing a fix's
 * clothes — and lot data is imperfect (merch and non-cannabis SKUs have no
 * lot rows at all), so "I found no lots" must mean "I have no evidence",
 * never "there is no stock". Absence of evidence is not evidence of absence.
 *
 * `reconcileRegisterAvailability` therefore returns `sellable: true` for every
 * card the snapshot already considered sellable, unconditionally. The pure
 * self-tests and the behavioural tests both pin this invariant directly.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * COMPLIANCE GATES THIS CORE DELIBERATELY DOES NOT TOUCH
 * ═════════════════════════════════════════════════════════════════════════
 *
 *   • AN-7 RECALL HOLD. A recalled product or a recalled lot stays blocked,
 *     even with on-hand stock. Recalled cannabis must not be sold
 *     (WAC 314-55-215 recall procedures). Stock is exactly what a recall
 *     expects to find, so on-hand quantity is NEVER a reason to override it.
 *
 *   • LOT STATUS. Only lots with a register-sellable status (active,
 *     sold_out, and since register-sell-everything-fix-later quarantine)
 *     count as stock. `recalled`, `destroyed` and a destruction hold
 *     (`scheduled_destruction`) never do, no matter what on hand says.
 *
 *   • HIDDEN CARDS. `hidden` is a human's decision (or a reviewer rejection —
 *     fact-review-store.ts:196). This core reports it in plain English so the
 *     owner can see and undo it, and never silently overrides it.
 *
 * PURE: no I/O, no React, no Supabase. Fully unit-testable.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The only lot lifecycle value whose stock may be sold (migration 0023). */
export const SELLABLE_LOT_STATUS = "active";

/**
 * register-sell-sold-out-stock - the owner, verbatim: "The register needs to
 * stop rejecting it and allow it ... These items are not in active status
 * even though the detail page shows them as active. I need to sell these
 * products right now."
 *
 * The Oct-30 Cultivera count import (R50) wrote 465 lots down to 0 and the
 * database flipped them `sold_out`, while the packages are still on the
 * shelf. `sold_out` is a COUNT outcome, not a compliance hold: nobody took
 * the product off the floor. So the register now treats `active` AND
 * `sold_out` lots as the product's sellable lots. A `sold_out` / zero-count
 * lot keeps its card and its barcode on the register; the count is shown as
 * unknown so the cashier can ring it, and the sale's stock draw records the
 * shortfall for the oversold report (it never invents units).
 *
 * register-sell-everything-fix-later - the owner, verbatim: "Everything must
 * sell. No exceptions. We will fix it all later. We need to sell everything
 * we have stock of. No matter what." A lot still in `quarantine` from intake
 * (no COA from Cultivera, manifest not finalized) is on the shelf, so it
 * sells too and goes on the back office Fix later list. A lot quarantined
 * because a DESTRUCTION is scheduled is relabelled `scheduled_destruction`
 * by the menu route before it gets here (register-fix-later-core
 * withDestructionHolds), so it never sells.
 *
 * Still NEVER sellable: `recalled` (WAC 314-55-215), `destroyed` (reported
 * to CCRS), `scheduled_destruction`, trade samples, held units.
 */
export const REGISTER_SELLABLE_LOT_STATUSES: ReadonlySet<string> = new Set(["active", "sold_out", "quarantine"]);

/** True when a lot's status lets the register ring it up (active, sold_out or quarantine). */
export function isRegisterSellableLotStatus(status: string | null | undefined): boolean {
  return REGISTER_SELLABLE_LOT_STATUSES.has((status ?? "").trim().toLowerCase());
}

/** Inventory status vocabulary shared with the menu pipeline. */
export type InventoryStatusSlug = "in-stock" | "low-stock" | "unavailable";

/**
 * The identical thresholds used by transform.ts:590-594,
 * sale-decrement-core.ts:137-141 and intake-menu-staging-core.ts:311. Kept
 * here so a restored card is described with the SAME words the rest of the
 * system would have used, rather than a second opinion that could drift.
 */
export function statusForUnits(units: number): InventoryStatusSlug {
  if (!Number.isFinite(units) || units <= 0) return "unavailable";
  if (units <= 3) return "low-stock";
  return "in-stock";
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One live row from `inventory_lots` — the back office's own truth. */
export type LiveLotFact = {
  /** inventory_lots.id (for reporting only). */
  id: string;
  /** inventory_lots.pos_product_key -> menu_items.source_item_id. */
  posProductKey: string | null;
  /** inventory_lots.status: active | quarantine | recalled | sold_out | destroyed. */
  status: string | null;
  /** inventory_lots.on_hand_qty (numeric in Postgres, so it can arrive as a string). */
  onHandQty: number | string | null;
  /** inventory_lots.product_name — used only for owner-facing messages. */
  productName?: string | null;
  /** inventory_lots.lot_code — used only for owner-facing messages. */
  lotCode?: string | null;
};

/** One card from the published snapshot, as `/api/pos/menu` sees it. */
export type SnapshotCard = {
  /** menu_items.source_item_id. */
  productId: string;
  /**
   * Every lot key this card can sell under: its own product key plus each
   * variant's encoded lot key (`${lotKey}-onboarded`). A mastered card's lots
   * carry the LOT's key, not the card's, so both must be considered.
   */
  lotKeys: string[];
  /** menu_items.inventory_status from the published snapshot. */
  inventoryStatus: InventoryStatusSlug;
  /** menu_items.hidden. */
  hidden: boolean;
  /**
   * register-sell-all-back-office-stock: true ONLY when `hidden` is the
   * Cultivera importer's own website hide (no_product_master / no_inventory)
   * on a mapped, priced cannabis card that has live active stock - decided by
   * register-coverage-core `classifyHiddenCard` + the caller's live-stock
   * check. Such a card is rung up at the register (never shown on the
   * website). A PERSON's hide never sets this. Absent = false.
   */
  registerEligible?: boolean;
  /** True when an AN-7 recall hold covers this card or one of its lots. */
  recalled: boolean;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type AvailabilityReasonCode =
  /** The snapshot already said sellable — nothing was changed. */
  | "snapshot_sellable"
  /** THE FIX: snapshot said unavailable, live active lots hold real stock. */
  | "restored_from_live_stock"
  /** Snapshot said unavailable and no live active lot holds stock. */
  | "no_live_stock"
  /** register-sell-sold-out-stock: an Active/Sold out lot exists but counts 0 - sold anyway. */
  | "sell_anyway_zero_count"
  /** Snapshot said unavailable and this card has no lot rows to judge by. */
  | "no_lot_evidence"
  /** AN-7 recall hold — never overridden. */
  | "recall_hold"
  /** A human hid this card. Reported, never silently overridden. */
  | "hidden_card";

export type CardAvailability = {
  productId: string;
  /** Whether `/api/pos/menu` should include this card in the bundle. */
  sellable: boolean;
  /** True only when this core CHANGED the snapshot's answer. */
  restored: boolean;
  reason: AvailabilityReasonCode;
  /** Live sellable units found across active lots (0 when none/unknown). */
  liveUnits: number;
  /** Status implied by live stock, for a restored card's badges. */
  liveStatus: InventoryStatusSlug;
  /** Plain-English explanation an owner can act on. */
  message: string;
};

export type ReconcileResult = {
  cards: CardAvailability[];
  /** How many cards this core rescued — the number worth logging. */
  restoredCount: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Postgres `numeric` arrives as a string over PostgREST. Garbage -> 0. */
export function toQty(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/** Trim a key; blank/whitespace-only becomes null so it can never match. */
export function normalizeKey(raw: string | null | undefined): string | null {
  const k = (raw ?? "").trim();
  return k.length > 0 ? k : null;
}

/**
 * Index live lots by their POS product key, keeping only ACTIVE lots that
 * actually hold stock. Returns units-on-hand per key.
 *
 * Lots with no key cannot be matched to any card and are excluded here; the
 * back-office diagnosis (`diagnoseLot`) is what surfaces them to the owner.
 */
export function indexLiveStock(lots: readonly LiveLotFact[]): Map<string, number> {
  const byKey = new Map<string, number>();
  for (const lot of lots) {
    const key = normalizeKey(lot.posProductKey);
    if (!key) continue;
    if (!isRegisterSellableLotStatus(lot.status)) continue;
    const qty = toQty(lot.onHandQty);
    if (qty <= 0) continue;
    byKey.set(key, (byKey.get(key) ?? 0) + qty);
  }
  return byKey;
}

/**
 * Every key that has ANY lot row at all, regardless of status or quantity.
 * This is how we tell "no stock" (we looked, there is none) apart from
 * "no evidence" (this product has no lots — merch, non-cannabis, import-only).
 * Conflating those two is precisely how a fix becomes an outage.
 */
export function keysWithAnyLot(lots: readonly LiveLotFact[]): Set<string> {
  const seen = new Set<string>();
  for (const lot of lots) {
    const key = normalizeKey(lot.posProductKey);
    if (key) seen.add(key);
  }
  return seen;
}

/**
 * register-sell-sold-out-stock: every key with at least one lot the register
 * may ring up (active or sold_out), REGARDLESS of quantity. A zero count is
 * not proof the shelf is empty (the owner is holding the package), so such a
 * card stays on the register with an unknown count.
 */
export function keysWithSellableLot(lots: readonly LiveLotFact[]): Set<string> {
  const seen = new Set<string>();
  for (const lot of lots) {
    const key = normalizeKey(lot.posProductKey);
    if (key && isRegisterSellableLotStatus(lot.status)) seen.add(key);
  }
  return seen;
}

/** Sum live stock across every key a card can sell under, without double counting. */
function liveUnitsForCard(card: SnapshotCard, stockByKey: Map<string, number>): number {
  let total = 0;
  const counted = new Set<string>();
  for (const raw of card.lotKeys) {
    const key = normalizeKey(raw);
    if (!key || counted.has(key)) continue;
    counted.add(key);
    total += stockByKey.get(key) ?? 0;
  }
  return total;
}

function cardHasAnyLot(card: SnapshotCard, withLots: Set<string>): boolean {
  for (const raw of card.lotKeys) {
    const key = normalizeKey(raw);
    if (key && withLots.has(key)) return true;
  }
  return false;
}

function formatUnits(units: number): string {
  const rounded = Math.round(units * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  return `${text} unit${rounded === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// THE RECONCILER
// ---------------------------------------------------------------------------

/**
 * Decide, for every published card, whether the register may sell it —
 * repairing cards whose cached `inventory_status` has gone stale against the
 * live lot table.
 *
 * ONE-WAY INVARIANT: a card the snapshot already considered sellable is
 * ALWAYS returned sellable. This function can only ever add availability.
 * (Compliance gates — recall, hidden — are evaluated first and are the sole
 * source of a not-sellable answer, exactly as they are today.)
 */
export function reconcileRegisterAvailability(inputs: {
  cards: readonly SnapshotCard[];
  lots: readonly LiveLotFact[];
}): ReconcileResult {
  const stockByKey = indexLiveStock(inputs.lots);
  const withLots = keysWithAnyLot(inputs.lots);
  const withSellableLot = keysWithSellableLot(inputs.lots);

  const cards: CardAvailability[] = [];
  let restoredCount = 0;

  for (const card of inputs.cards) {
    const liveUnits = liveUnitsForCard(card, stockByKey);
    const liveStatus = statusForUnits(liveUnits);

    // ── Compliance gates first. Stock NEVER overrides these. ──────────────
    // A recall expects to find stock; finding some is not permission to sell.
    if (card.recalled) {
      cards.push({
        productId: card.productId,
        sellable: false,
        restored: false,
        reason: "recall_hold",
        liveUnits,
        liveStatus,
        message:
          "Blocked by a recall hold. Recalled product cannot be sold even though stock is on hand — clear the recall in the back office first.",
      });
      continue;
    }

    // A human took this card off the menu. Say so out loud; never override it.
    // (An importer-only website hide proven safe upstream is NOT a human hide.)
    if (card.hidden && card.registerEligible !== true) {
      cards.push({
        productId: card.productId,
        sellable: false,
        restored: false,
        reason: "hidden_card",
        liveUnits,
        liveStatus,
        message:
          "Hidden on the menu, so the register does not show it. Un-hide the product in the back office to sell it.",
      });
      continue;
    }

    // ── The one-way invariant: already sellable stays sellable, always. ───
    if (card.inventoryStatus !== "unavailable") {
      cards.push({
        productId: card.productId,
        sellable: true,
        restored: false,
        reason: "snapshot_sellable",
        liveUnits,
        liveStatus,
        message: "Available on the register.",
      });
      continue;
    }

    // ── The snapshot says unavailable. Is that still true? ────────────────
    if (liveUnits > 0) {
      // THE FIX. Real stock, in an active lot, that the register was refusing
      // to sell because a cached counter never caught up.
      restoredCount += 1;
      cards.push({
        productId: card.productId,
        sellable: true,
        restored: true,
        reason: "restored_from_live_stock",
        liveUnits,
        liveStatus,
        message: `Restored to the register: inventory shows ${formatUnits(liveUnits)} on hand in active lots, but the published menu still had it marked unavailable.`,
      });
      continue;
    }

    if (cardHasAnyLot(card, withSellableLot)) {
      // register-sell-sold-out-stock: the lot is Active or Sold out but its
      // count says 0 (e.g. the Oct-30 count import zeroed it while the
      // package is on the shelf). The owner: "I want to sell it anyways."
      // Served with an UNKNOWN count; the sale records the shortfall.
      restoredCount += 1;
      cards.push({
        productId: card.productId,
        sellable: true,
        restored: true,
        reason: "sell_anyway_zero_count",
        liveUnits: 0,
        liveStatus: "low-stock",
        message:
          "On the register even though the back office count is 0 (lot Active or Sold out). Ring it up; the sale is logged as a shortfall so the count can be corrected.",
      });
      continue;
    }

    if (!cardHasAnyLot(card, withLots)) {
      // No lot rows exist for this product at all (merch, non-cannabis, or an
      // import-only card). We have no evidence either way, so we leave the
      // snapshot's answer alone rather than inventing stock.
      cards.push({
        productId: card.productId,
        sellable: false,
        restored: false,
        reason: "no_lot_evidence",
        liveUnits: 0,
        liveStatus: "unavailable",
        message:
          "Marked unavailable on the published menu, and there are no inventory lots for it to check against. Receive stock, or fix the product link, to bring it back.",
      });
      continue;
    }

    cards.push({
      productId: card.productId,
      sellable: false,
      restored: false,
      reason: "no_live_stock",
      liveUnits: 0,
      liveStatus: "unavailable",
      message:
        "Not sellable: every lot for this product is quarantined, recalled or destroyed.",
    });
  }

  return { cards, restoredCount };
}

// ---------------------------------------------------------------------------
// BACK-OFFICE DIAGNOSIS — "why can't I sell this lot?"
// ---------------------------------------------------------------------------

/**
 * The owner had to find this fault by scanning items at the counter one at a
 * time. That is the real failure, and a code fix alone does not repair it.
 * These helpers let the back office answer the question directly, per lot, in
 * plain English, with no guessing.
 */
export type LotSellableCode =
  | "sellable"
  | "no_product_link"
  | "lot_not_active"
  | "lot_empty"
  | "no_menu_card"
  | "recall_hold"
  | "hidden_card";

export type LotDiagnosis = {
  lotId: string;
  label: string;
  sellable: boolean;
  code: LotSellableCode;
  /**
   * SLICE 20 - the lot's POS product key, normalized, or null when it has
   * none. The back office needs this to send the owner to the PRODUCT page
   * (where hiding is controlled) rather than to the lot, which has no
   * visibility control at all. Null is a real answer here: `no_product_link`
   * means there is genuinely no key to follow.
   */
  productKey: string | null;
  /** What is wrong, in the owner's language. */
  message: string;
  /** The single next action that fixes it, or null when nothing is wrong. */
  fix: string | null;
};

/** Human label for a lot in a message: product name, else lot code, else id. */
export function lotLabel(lot: LiveLotFact): string {
  return normalizeKey(lot.productName) ?? normalizeKey(lot.lotCode) ?? lot.id;
}

/**
 * Explain whether ONE back-office lot can be sold at the register, given the
 * published cards. Ordered most-blocking first so the owner is always told
 * the thing that must be fixed FIRST, not a downstream symptom.
 */
export function diagnoseLot(
  lot: LiveLotFact,
  cardsByKey: Map<string, SnapshotCard>,
): LotDiagnosis {
  const label = lotLabel(lot);
  const key = normalizeKey(lot.posProductKey);

  if (!key) {
    return {
      lotId: lot.id,
      label,
      sellable: false,
      code: "no_product_link",
      productKey: null,
      message:
        "This lot is not linked to a product, so there is nothing for the register to ring up and nothing for a scan to match.",
      fix: "Open the lot and link it to a POS product, or onboard it from Product Onboarding.",
    };
  }

  const status = (lot.status ?? "").trim().toLowerCase();
  if (!isRegisterSellableLotStatus(status)) {
    return {
      lotId: lot.id,
      label,
      sellable: false,
      code: "lot_not_active",
      productKey: key,
      message: `This lot's status is “${status || "unset"}”, so its stock is not sellable.`,
      fix: "Return the lot to active in the back office once it is cleared for sale.",
    };
  }

  if (toQty(lot.onHandQty) <= 0) {
    return {
      lotId: lot.id,
      label,
      sellable: false,
      code: "lot_empty",
      productKey: key,
      message: "This lot is active but has no units on hand, so there is nothing to sell.",
      fix: "Receive stock against it, or run a cycle count if the shelf disagrees.",
    };
  }

  const card = cardsByKey.get(key);
  if (!card) {
    return {
      lotId: lot.id,
      label,
      sellable: false,
      code: "no_menu_card",
      productKey: key,
      // register-sell-everything-fix-later: the register still SELLS this
      // lot (a register-only line built from the lot itself); it is listed
      // here and on Fix later so the menu product gets made properly.
      message:
        "No product on the published menu uses this lot's product key. The register still sells it from the lot itself (Fix later), but the website does not show it.",
      fix: "Approve it in Product Onboarding, then publish the menu.",
    };
  }

  if (card.recalled) {
    return {
      lotId: lot.id,
      label,
      sellable: false,
      code: "recall_hold",
      productKey: key,
      message: "A recall hold covers this product, so it cannot be sold.",
      fix: "Clear the recall once the product is cleared for sale.",
    };
  }

  if (card.hidden && card.registerEligible !== true) {
    return {
      lotId: lot.id,
      label,
      sellable: false,
      code: "hidden_card",
      productKey: key,
      message: "The menu product for this lot is hidden, so the register does not list it.",
      fix: "Un-hide the product in the back office.",
    };
  }

  return {
    lotId: lot.id,
    label,
    sellable: true,
    code: "sellable",
    productKey: key,
    message: "Sellable at the register.",
    fix: null,
  };
}

export type SellabilitySummary = {
  total: number;
  sellable: number;
  blocked: number;
  /** Blocked counts per code, so the back office can show a real breakdown. */
  byCode: Record<LotSellableCode, number>;
  /** One-line plain-English headline, or null when nothing is blocked. */
  headline: string | null;
};

/**
 * Roll a set of lot diagnoses into the summary a back-office banner shows.
 * Only lots that HOLD STOCK are counted as blocked — an empty or destroyed
 * lot is not a problem to nag the owner about, it is just history.
 */
export function summarizeSellability(
  diagnoses: readonly LotDiagnosis[],
): SellabilitySummary {
  const byCode: Record<LotSellableCode, number> = {
    sellable: 0,
    no_product_link: 0,
    lot_not_active: 0,
    lot_empty: 0,
    no_menu_card: 0,
    recall_hold: 0,
    hidden_card: 0,
  };
  for (const d of diagnoses) byCode[d.code] += 1;

  const total = diagnoses.length;
  const sellable = byCode.sellable;
  // `lot_empty` and `lot_not_active` are expected states, not faults.
  // register-sell-everything-fix-later: a lot with no menu card still SELLS
  // at the register (a register-only line from the lot), so it is not
  // "blocked"; it is reported separately as needing a fix later.
  const blocked = byCode.no_product_link + byCode.recall_hold + byCode.hidden_card;
  const fixLater = byCode.no_menu_card;

  if (blocked === 0 && fixLater === 0) {
    return { total, sellable, blocked: 0, byCode, headline: null };
  }

  const fixLaterLine =
    fixLater > 0
      ? `${fixLater} ${fixLater === 1 ? "lot is" : "lots are"} not on the published menu; the register sells ${fixLater === 1 ? "it" : "them"} from the lot (Fix later).`
      : "";
  if (blocked === 0) {
    return { total, sellable, blocked: 0, byCode, headline: fixLaterLine };
  }

  const parts: string[] = [];
  if (byCode.no_product_link > 0) parts.push(`${byCode.no_product_link} not linked to a product`);
  if (byCode.hidden_card > 0) parts.push(`${byCode.hidden_card} hidden`);
  if (byCode.recall_hold > 0) parts.push(`${byCode.recall_hold} under a recall hold`);

  const plural = blocked === 1 ? "lot" : "lots";
  const head = `${blocked} ${plural} with stock on hand cannot be sold at the register — ${parts.join(", ")}.`;
  return {
    total,
    sellable,
    blocked,
    byCode,
    headline: fixLaterLine ? `${head} ${fixLaterLine}` : head,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runRegisterAvailabilityCoreTests(): void {
  let passed = 0;
  function ok(cond: boolean, msg: string): void {
    if (!cond) throw new Error(`register-availability-core self-test failed: ${msg}`);
    passed += 1;
  }

  const lot = (over: Partial<LiveLotFact> = {}): LiveLotFact => ({
    id: over.id ?? "lot-1",
    posProductKey: over.posProductKey !== undefined ? over.posProductKey : "KEY-A",
    status: over.status !== undefined ? over.status : "active",
    onHandQty: over.onHandQty !== undefined ? over.onHandQty : 10,
    productName: over.productName,
    lotCode: over.lotCode,
  });

  const card = (over: Partial<SnapshotCard> = {}): SnapshotCard => ({
    productId: over.productId ?? "KEY-A",
    lotKeys: over.lotKeys ?? [over.productId ?? "KEY-A"],
    inventoryStatus: over.inventoryStatus ?? "unavailable",
    hidden: over.hidden ?? false,
    recalled: over.recalled ?? false,
    ...(over.registerEligible !== undefined ? { registerEligible: over.registerEligible } : {}),
  });

  // ── statusForUnits mirrors the pipeline thresholds exactly ──────────────
  ok(statusForUnits(0) === "unavailable", "0 units -> unavailable");
  ok(statusForUnits(-5) === "unavailable", "negative units -> unavailable");
  ok(statusForUnits(Number.NaN) === "unavailable", "NaN units -> unavailable");
  ok(statusForUnits(1) === "low-stock", "1 unit -> low-stock");
  ok(statusForUnits(3) === "low-stock", "3 units -> low-stock (boundary)");
  ok(statusForUnits(4) === "in-stock", "4 units -> in-stock (boundary)");

  // ── toQty tolerates PostgREST numeric-as-string ─────────────────────────
  ok(toQty("12.5") === 12.5, "numeric string parsed");
  ok(toQty(null) === 0, "null -> 0");
  ok(toQty("abc") === 0, "garbage -> 0");
  ok(toQty(-3) === 0, "negative clamps to 0");
  ok(toQty("  7 ") === 7, "whitespace tolerated");

  // ── normalizeKey ────────────────────────────────────────────────────────
  ok(normalizeKey("  K ") === "K", "key trimmed");
  ok(normalizeKey("   ") === null, "whitespace-only key -> null");
  ok(normalizeKey(null) === null, "null key -> null");

  // ═══ THE HEADLINE FIX ═══════════════════════════════════════════════════
  {
    const r = reconcileRegisterAvailability({ cards: [card()], lots: [lot()] });
    ok(r.cards[0].sellable, "stale unavailable card WITH live stock is restored");
    ok(r.cards[0].restored, "restoration is reported as a change");
    ok(r.cards[0].reason === "restored_from_live_stock", "restore reason code");
    ok(r.cards[0].liveUnits === 10, "live units carried through");
    ok(r.cards[0].liveStatus === "in-stock", "live status derived from live units");
    ok(r.restoredCount === 1, "restored count");
    ok(r.cards[0].message.includes("10 units"), "message states the real on-hand figure");
  }

  // ── THE ONE-WAY INVARIANT: never removes sellability ────────────────────
  for (const status of ["in-stock", "low-stock"] as InventoryStatusSlug[]) {
    // No lots at all, zero-qty lots, destroyed lots — none of it may matter.
    for (const lots of [
      [] as LiveLotFact[],
      [lot({ onHandQty: 0 })],
      [lot({ status: "destroyed" })],
      [lot({ posProductKey: null })],
    ]) {
      const r = reconcileRegisterAvailability({ cards: [card({ inventoryStatus: status })], lots });
      ok(r.cards[0].sellable, `one-way: ${status} card stays sellable regardless of lot data`);
      ok(r.cards[0].reason === "snapshot_sellable", `one-way: reason for ${status}`);
      ok(!r.cards[0].restored, "already-sellable card is not counted as restored");
    }
  }

  // ── Compliance gates are never overridden by stock ──────────────────────
  {
    const r = reconcileRegisterAvailability({
      cards: [card({ recalled: true, inventoryStatus: "in-stock" })],
      lots: [lot({ onHandQty: 500 })],
    });
    ok(!r.cards[0].sellable, "recall hold beats a sellable snapshot AND 500 units");
    ok(r.cards[0].reason === "recall_hold", "recall reason code");
    ok(r.restoredCount === 0, "a recall is never a restoration");
  }
  {
    const r = reconcileRegisterAvailability({
      cards: [card({ hidden: true, inventoryStatus: "in-stock" })],
      lots: [lot({ onHandQty: 99 })],
    });
    ok(!r.cards[0].sellable, "hidden card stays hidden despite stock");
    ok(r.cards[0].reason === "hidden_card", "hidden reason code");
  }
  {
    // Recall outranks hidden — the owner must be told the blocking reason.
    const r = reconcileRegisterAvailability({
      cards: [card({ hidden: true, recalled: true })],
      lots: [lot()],
    });
    ok(r.cards[0].reason === "recall_hold", "recall outranks hidden in reporting");
  }
  {
    // register-sell-all-back-office-stock: an importer-only website hide that
    // was proven safe upstream is sold; the snapshot/restore rules still apply.
    const r = reconcileRegisterAvailability({
      cards: [card({ hidden: true, registerEligible: true, inventoryStatus: "unavailable" })],
      lots: [lot({ onHandQty: 4 })],
    });
    ok(r.cards[0].sellable, "register-eligible importer-hidden card with stock is sellable");
    ok(r.cards[0].reason === "restored_from_live_stock", "register-eligible card goes through live-stock restore");
    const r2 = reconcileRegisterAvailability({
      cards: [card({ hidden: true, registerEligible: true, recalled: true })],
      lots: [lot({ onHandQty: 4 })],
    });
    ok(!r2.cards[0].sellable && r2.cards[0].reason === "recall_hold", "recall still beats register-eligible");
    const r3 = reconcileRegisterAvailability({
      cards: [card({ hidden: true, registerEligible: false, inventoryStatus: "in-stock" })],
      lots: [lot({ onHandQty: 4 })],
    });
    ok(r3.cards[0].reason === "hidden_card", "registerEligible=false is still a hidden card");
    ok(
      diagnoseLot(lot(), new Map([["KEY-A", card({ hidden: true, registerEligible: true })]])).sellable,
      "register-eligible hidden card's lot diagnoses sellable",
    );
  }

  // ── Non-active / empty lots are not stock ───────────────────────────────
  for (const status of ["scheduled_destruction", "recalled", "destroyed", "", null]) {
    const r = reconcileRegisterAvailability({
      cards: [card()],
      lots: [lot({ status })],
    });
    ok(!r.cards[0].sellable, `lot status ${status ?? "null"} is not sellable stock`);
    ok(r.cards[0].reason === "no_live_stock", `lot status ${status ?? "null"} -> no_live_stock`);
  }
  {
    // register-sell-sold-out-stock: a Sold out lot that holds units is stock.
    const r = reconcileRegisterAvailability({ cards: [card()], lots: [lot({ status: "sold_out", onHandQty: 3 })] });
    ok(r.cards[0].sellable && r.cards[0].reason === "restored_from_live_stock", "sold_out lot with units is sellable");
    ok(r.cards[0].liveUnits === 3, "sold_out units counted");
  }
  {
    // register-sell-sold-out-stock: a zero count on an Active or Sold out lot
    // keeps the card on the register (unknown count; sell anyway).
    for (const status of ["active", "sold_out"]) {
      const r = reconcileRegisterAvailability({ cards: [card()], lots: [lot({ status, onHandQty: 0 })] });
      ok(r.cards[0].sellable, `zero-count ${status} lot still sells`);
      ok(r.cards[0].reason === "sell_anyway_zero_count", `zero-count ${status} -> sell_anyway_zero_count`);
    }
    // register-sell-everything-fix-later: Quarantine sells (fix later); a
    // destruction hold (relabelled scheduled_destruction) never does.
    const q = reconcileRegisterAvailability({ cards: [card()], lots: [lot({ status: "quarantine", onHandQty: 0 })] });
    ok(q.cards[0].sellable, "zero-count quarantine lot still sells (fix later)");
    const qd = reconcileRegisterAvailability({ cards: [card()], lots: [lot({ status: "scheduled_destruction", onHandQty: 4 })] });
    ok(!qd.cards[0].sellable, "a lot held for destruction stays off");
    const rec = reconcileRegisterAvailability({ cards: [card({ recalled: true })], lots: [lot({ status: "sold_out", onHandQty: 0 })] });
    ok(!rec.cards[0].sellable && rec.cards[0].reason === "recall_hold", "recall still beats a sold_out lot");
    ok(isRegisterSellableLotStatus(" Sold_Out ") && isRegisterSellableLotStatus("quarantine") && !isRegisterSellableLotStatus("scheduled_destruction"), "status helper");
  }
  {
    // Status is compared case-insensitively and whitespace-tolerantly.
    const r = reconcileRegisterAvailability({ cards: [card()], lots: [lot({ status: " ACTIVE " })] });
    ok(r.cards[0].sellable, "lot status matching is case/space tolerant");
  }

  // ── "No evidence" is distinct from "no stock" ───────────────────────────
  {
    const r = reconcileRegisterAvailability({ cards: [card({ productId: "MERCH-1", lotKeys: ["MERCH-1"] })], lots: [lot()] });
    ok(r.cards[0].reason === "no_lot_evidence", "card with no lots at all -> no_lot_evidence");
    ok(!r.cards[0].sellable, "no evidence leaves the snapshot's answer untouched");
  }

  // ── Mastered cards: stock may hang off a VARIANT's lot key ──────────────
  {
    const r = reconcileRegisterAvailability({
      cards: [card({ productId: "CARD-1", lotKeys: ["CARD-1", "LOT-X", "LOT-Y"] })],
      lots: [lot({ id: "l1", posProductKey: "LOT-X", onHandQty: 2 }), lot({ id: "l2", posProductKey: "LOT-Y", onHandQty: 5 })],
    });
    ok(r.cards[0].sellable, "mastered card restored from its variants' lot keys");
    ok(r.cards[0].liveUnits === 7, "units summed across variant lot keys");
  }
  {
    // A duplicated key must not be counted twice.
    const r = reconcileRegisterAvailability({
      cards: [card({ productId: "K", lotKeys: ["K", "K", " K "] })],
      lots: [lot({ posProductKey: "K", onHandQty: 4 })],
    });
    ok(r.cards[0].liveUnits === 4, "duplicate lot keys are not double counted");
  }
  {
    // Several lots under ONE key sum together.
    const r = reconcileRegisterAvailability({
      cards: [card()],
      lots: [lot({ id: "a", onHandQty: 1 }), lot({ id: "b", onHandQty: 2 })],
    });
    ok(r.cards[0].liveUnits === 3, "multiple lots on one key sum");
    ok(r.cards[0].liveStatus === "low-stock", "summed units drive the live status");
  }

  // ── Empty input is not a crash ──────────────────────────────────────────
  {
    const r = reconcileRegisterAvailability({ cards: [], lots: [] });
    ok(r.cards.length === 0 && r.restoredCount === 0, "empty inputs are safe");
  }

  // ═══ BACK-OFFICE DIAGNOSIS ══════════════════════════════════════════════
  const cards = new Map<string, SnapshotCard>([["KEY-A", card({ inventoryStatus: "in-stock" })]]);

  ok(diagnoseLot(lot(), cards).sellable, "linked, active, stocked, listed lot is sellable");
  ok(diagnoseLot(lot(), cards).code === "sellable", "sellable code");
  ok(diagnoseLot(lot(), cards).fix === null, "nothing to fix when sellable");

  {
    const d = diagnoseLot(lot({ posProductKey: null }), cards);
    ok(d.code === "no_product_link", "null key diagnosed");
    ok(d.fix !== null && d.fix.length > 0, "no_product_link has an actionable fix");
  }
  ok(diagnoseLot(lot({ posProductKey: "   " }), cards).code === "no_product_link", "blank key diagnosed");
  ok(diagnoseLot(lot({ status: "recalled" }), cards).code === "lot_not_active", "recalled lot diagnosed");
  ok(diagnoseLot(lot({ status: "quarantine" }), cards).sellable, "quarantine lot with a card sells (fix later)");
  ok(diagnoseLot(lot({ onHandQty: 0 }), cards).code === "lot_empty", "empty lot diagnosed");
  ok(diagnoseLot(lot({ posProductKey: "GHOST" }), cards).code === "no_menu_card", "unlisted key diagnosed");

  // SLICE 20 - the diagnosis must carry the key the back office links with.
  ok(
    diagnoseLot(lot({ posProductKey: "GHOST" }), cards).productKey === "GHOST",
    "diagnosis carries the product key",
  );
  ok(
    diagnoseLot(lot({ posProductKey: null }), cards).productKey === null,
    "an unlinked lot reports a null key, never a fake one",
  );
  ok(
    diagnoseLot(lot({ posProductKey: "  SPACED  " }), cards).productKey === "SPACED",
    "the key is normalized, so links cannot carry stray whitespace",
  );
  ok(
    diagnoseLot(lot(), new Map([["KEY-A", card({ recalled: true })]])).code === "recall_hold",
    "recall diagnosed",
  );
  ok(
    diagnoseLot(lot(), new Map([["KEY-A", card({ hidden: true })]])).code === "hidden_card",
    "hidden diagnosed",
  );

  // Ordering: the MOST blocking cause is reported, not a downstream symptom.
  ok(
    diagnoseLot(lot({ posProductKey: null, status: "destroyed", onHandQty: 0 }), cards).code === "no_product_link",
    "missing link outranks status and quantity",
  );
  ok(
    diagnoseLot(lot({ status: "destroyed", onHandQty: 0 }), cards).code === "lot_not_active",
    "status outranks emptiness",
  );

  // Labels degrade gracefully.
  ok(lotLabel(lot({ productName: "Blue Dream" })) === "Blue Dream", "product name label");
  ok(lotLabel(lot({ productName: null, lotCode: "LC-9" })) === "LC-9", "lot code label fallback");
  ok(lotLabel(lot({ id: "xyz", productName: null, lotCode: null })) === "xyz", "id label fallback");

  // ── Summary ─────────────────────────────────────────────────────────────
  {
    const s = summarizeSellability([diagnoseLot(lot(), cards)]);
    ok(s.headline === null, "all-clear produces no nag");
    ok(s.sellable === 1 && s.blocked === 0, "all-clear counts");
  }
  {
    const s = summarizeSellability([
      diagnoseLot(lot({ id: "1", posProductKey: null }), cards),
      diagnoseLot(lot({ id: "2", posProductKey: "GHOST" }), cards),
      diagnoseLot(lot({ id: "3", onHandQty: 0 }), cards),
      diagnoseLot(lot({ id: "4" }), cards),
    ]);
    ok(s.total === 4, "summary total");
    // register-sell-everything-fix-later: the no-card lot sells (Fix later).
    ok(s.blocked === 1, "empty lots and no-card lots are NOT counted as blocked");
    ok(s.sellable === 1, "summary sellable count");
    ok(s.byCode.lot_empty === 1, "empty lots still counted by code");
    ok(s.headline !== null && s.headline.includes("1 lot "), "headline counts blocked lots");
    ok(s.headline !== null && s.headline.includes("Fix later"), "headline says the no-card lot sells (fix later)");
    ok(s.headline !== null && s.headline.includes("not linked"), "headline names the link gap");
    ok(s.headline !== null && s.headline.includes("not on the published menu"), "headline names the menu gap");
  }
  {
    const s = summarizeSellability([diagnoseLot(lot({ posProductKey: null }), cards)]);
    ok(s.headline !== null && s.headline.includes("1 lot ") , "singular headline wording");
  }

  console.log(`register-availability-core: PASSED ${passed} assertions`);
}
