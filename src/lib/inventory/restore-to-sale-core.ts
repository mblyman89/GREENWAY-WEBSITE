/**
 * src/lib/inventory/restore-to-sale-core.ts  (SLICE 18)
 *
 * PURE policy for UNDOING an "86" — putting a product the register killed
 * back on sale.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `/api/pos/stock-flag` lets a budtender pull a phantom listing off the menu
 * from the register ("86 it"). Its own header says the quiet part out loud:
 *
 *     "ONE-WAY by design — the register can kill a phantom listing but can
 *      never invent inventory; bringing an item back is a back-office action
 *      (intake/receiving or menu edit)."
 *
 * The one-way design is right. The problem, found during slice 16 recon, is
 * that the back-office action it promises DOES NOT EXIST. A repo-wide grep
 * proved nothing under src/app/admin ever writes `inventory_status` back to
 * an available value. So every press of that button was permanent, and the
 * only cure was a full intake/mastering run. Slice 16 documented it as
 * Defect C and deliberately left it open rather than bundle a UI surface
 * into a read-time fix. This is that slice.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE RULE THAT MAKES THIS SAFE
 *
 * Restoring must NEVER invent inventory. That is precisely the property the
 * one-way design was protecting, and it is worth keeping. So a restore here
 * does not set "in-stock"; it RECOMPUTES the status from the live lot units
 * that actually exist right now, using the very same `statusForUnits`
 * thresholds the intake pipeline, the sale decrement and the menu transform
 * all use (register-availability-core.ts, slice 16).
 *
 * The consequence is the important bit: if the item genuinely has no stock,
 * pressing "restore" recomputes to "unavailable" and truthfully reports that
 * nothing changed. The button cannot conjure a sellable product out of an
 * empty shelf — it can only clear a stale flag that live stock contradicts.
 *
 * Slice 16's reader already heals the common case automatically (a flagged
 * card with real units is restored on the next menu download). This closes
 * the remaining gap: it repairs the stored snapshot itself, so the back
 * office, the website and every report agree with the register instead of
 * relying on a read-time correction forever.
 *
 * No React, no DB, no `server-only` — safe for the tsx self-test harness.
 */
import { statusForUnits, toQty, SELLABLE_LOT_STATUS, type InventoryStatusSlug } from "@/lib/pos/register-availability-core";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One lot row as read for the restore decision. */
export type RestoreLotFact = {
  /** `inventory_lots.status` — only SELLABLE_LOT_STATUS ("active") counts. */
  status: string | null | undefined;
  /** `inventory_lots.on_hand_qty` — PostgREST may hand numerics back as text. */
  onHandQty: number | string | null | undefined;
};

export type RestoreDecisionInput = {
  /** The published card's CURRENT `inventory_status`. */
  currentStatus: string | null | undefined;
  /** Every lot mapped to this product key. May legitimately be empty. */
  lots: readonly RestoreLotFact[];
  /** True when the card is under an AN-7 recall hold. */
  recalled: boolean;
  /** True when the card is deliberately hidden from the menu. */
  hidden: boolean;
};

export type RestoreRefusalCode =
  | "not_flagged"
  | "recall_hold"
  | "hidden_card"
  | "no_live_stock";

export type RestoreDecision =
  | {
      restore: true;
      /** The status to WRITE — computed from live units, never assumed. */
      nextStatus: InventoryStatusSlug;
      /** Sellable units backing that status (for the audit record). */
      units: number;
    }
  | { restore: false; code: RestoreRefusalCode; reason: string };

/**
 * Sellable units for a product: ACTIVE lots only, quantities coerced
 * defensively. Anything unparseable counts as zero — an unreadable quantity
 * is not evidence of stock.
 */
export function sellableUnits(lots: readonly RestoreLotFact[]): number {
  let total = 0;
  for (const lot of lots) {
    if ((lot.status ?? "").trim().toLowerCase() !== SELLABLE_LOT_STATUS) continue;
    total += toQty(lot.onHandQty);
  }
  return total;
}

/**
 * Decide whether an 86'd card may be put back on sale, and at what status.
 *
 * Order matters and is deliberate:
 *   1. not flagged      — nothing to undo; never rewrite a healthy card.
 *   2. recall hold      — AN-7 outranks stock, always. A recalled product
 *                         with a full shelf stays off.
 *   3. hidden           — an intentional merchandising decision; restoring
 *                         stock must not silently un-hide a card.
 *   4. no live stock    — the honest refusal. This is the case that keeps
 *                         the original one-way promise intact.
 */
export function decideRestore(input: RestoreDecisionInput): RestoreDecision {
  const current = (input.currentStatus ?? "").trim().toLowerCase();

  if (current !== "unavailable") {
    return {
      restore: false,
      code: "not_flagged",
      reason: "That product is already available on the register — nothing to restore.",
    };
  }

  // AN-7 first: a recall is never overridden by inventory, in either
  // direction. Slice 16 pins the same ordering on the read side.
  if (input.recalled) {
    return {
      restore: false,
      code: "recall_hold",
      reason: "That product is under a recall hold — it cannot be put back on sale until the hold is lifted.",
    };
  }

  if (input.hidden) {
    return {
      restore: false,
      code: "hidden_card",
      reason: "That product is hidden from the menu — unhide it first; restoring stock will not reveal a hidden card.",
    };
  }

  const units = sellableUnits(input.lots);
  const nextStatus = statusForUnits(units);

  // The whole safety property in one branch: the recomputed status decides,
  // not the operator's intention. No stock -> no restore.
  if (nextStatus === "unavailable") {
    return {
      restore: false,
      code: "no_live_stock",
      reason:
        input.lots.length === 0
          ? "No inventory lots are linked to that product, so there is no stock to put back on sale. Receive it in, or link the lot's product key."
          : "Every lot for that product is empty or not active, so there is nothing to sell. Receive stock in and it returns on its own.",
    };
  }

  return { restore: true, nextStatus, units };
}

/** One-line audit/toast summary. Never claims more than was actually done. */
export function restoreSummary(productName: string, decision: RestoreDecision): string {
  if (!decision.restore) return decision.reason;
  const unitWord = decision.units === 1 ? "unit" : "units";
  return `${productName} is back on sale (${decision.units} ${unitWord} on hand — ${decision.nextStatus}).`;
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

export function __runRestoreToSaleCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  const active = (qty: number | string) => ({ status: "active", onHandQty: qty });

  // ── sellableUnits: only ACTIVE lots, defensive coercion ─────────────────
  ok(sellableUnits([active(10), active(5)]) === 15, "active lots sum");
  ok(sellableUnits([active(10), { status: "quarantined", onHandQty: 99 }]) === 10, "quarantined lot excluded");
  ok(sellableUnits([active(10), { status: "destroyed", onHandQty: 99 }]) === 10, "destroyed lot excluded");
  ok(sellableUnits([active("12")]) === 12, "PostgREST numeric-as-string is counted");
  ok(sellableUnits([active("garbage")]) === 0, "unparseable qty counts as zero, not as stock");
  ok(sellableUnits([active(-5)]) === 0, "negative qty counts as zero");
  ok(sellableUnits([{ status: "ACTIVE", onHandQty: 7 }]) === 7, "status match is case-insensitive");
  ok(sellableUnits([{ status: " active ", onHandQty: 7 }]) === 7, "status match tolerates whitespace");
  ok(sellableUnits([]) === 0, "no lots -> zero units");

  // ── The happy path: a real 86 undo ──────────────────────────────────────
  const good = decideRestore({ currentStatus: "unavailable", lots: [active(48)], recalled: false, hidden: false });
  ok(good.restore === true, "flagged card with real stock is restored");
  ok(good.restore && good.nextStatus === "in-stock", "48 units -> in-stock");
  ok(good.restore && good.units === 48, "units are reported for the audit record");

  // Low stock is restored AS low-stock, not silently promoted.
  const low = decideRestore({ currentStatus: "unavailable", lots: [active(2)], recalled: false, hidden: false });
  ok(low.restore && low.nextStatus === "low-stock", "2 units -> low-stock, not in-stock");
  const boundary = decideRestore({ currentStatus: "unavailable", lots: [active(3)], recalled: false, hidden: false });
  ok(boundary.restore && boundary.nextStatus === "low-stock", "3 units -> low-stock (boundary)");
  const boundary4 = decideRestore({ currentStatus: "unavailable", lots: [active(4)], recalled: false, hidden: false });
  ok(boundary4.restore && boundary4.nextStatus === "in-stock", "4 units -> in-stock (boundary)");

  // ── THE SAFETY PROPERTY: restore can never invent inventory ─────────────
  const empty = decideRestore({ currentStatus: "unavailable", lots: [active(0)], recalled: false, hidden: false });
  ok(!empty.restore && empty.code === "no_live_stock", "an empty lot cannot be restored");
  const noLots = decideRestore({ currentStatus: "unavailable", lots: [], recalled: false, hidden: false });
  ok(!noLots.restore && noLots.code === "no_live_stock", "no lots at all cannot be restored");
  ok(!noLots.restore && noLots.reason.includes("No inventory lots are linked"), "the no-lot refusal explains the link gap");
  const inactiveOnly = decideRestore({
    currentStatus: "unavailable",
    lots: [{ status: "quarantined", onHandQty: 500 }],
    recalled: false,
    hidden: false,
  });
  ok(!inactiveOnly.restore && inactiveOnly.code === "no_live_stock", "500 quarantined units are NOT sellable stock");

  // ── Compliance gates outrank stock, in both directions ──────────────────
  const recalled = decideRestore({ currentStatus: "unavailable", lots: [active(500)], recalled: true, hidden: false });
  ok(!recalled.restore && recalled.code === "recall_hold", "a recall is never overridden by stock");
  const hidden = decideRestore({ currentStatus: "unavailable", lots: [active(500)], recalled: false, hidden: true });
  ok(!hidden.restore && hidden.code === "hidden_card", "a hidden card is not un-hidden by restoring");
  // Recall is checked BEFORE hidden, so a recalled+hidden card reports the
  // more serious reason.
  const both = decideRestore({ currentStatus: "unavailable", lots: [active(9)], recalled: true, hidden: true });
  ok(!both.restore && both.code === "recall_hold", "recall outranks hidden in the message");

  // ── Never rewrite a card that was not flagged ───────────────────────────
  const healthy = decideRestore({ currentStatus: "in-stock", lots: [active(10)], recalled: false, hidden: false });
  ok(!healthy.restore && healthy.code === "not_flagged", "an in-stock card is left alone");
  const lowHealthy = decideRestore({ currentStatus: "low-stock", lots: [active(2)], recalled: false, hidden: false });
  ok(!lowHealthy.restore && lowHealthy.code === "not_flagged", "a low-stock card is left alone");
  const blank = decideRestore({ currentStatus: null, lots: [active(10)], recalled: false, hidden: false });
  ok(!blank.restore && blank.code === "not_flagged", "a null status is not treated as flagged");
  const cased = decideRestore({ currentStatus: "UNAVAILABLE", lots: [active(10)], recalled: false, hidden: false });
  ok(cased.restore === true, "the flag match is case-insensitive");

  // ── Summaries never overstate ───────────────────────────────────────────
  ok(restoreSummary("Blue Dream 1g", good).includes("back on sale"), "success summary says what happened");
  ok(restoreSummary("Blue Dream 1g", good).includes("48 units"), "success summary carries the real count");
  ok(!empty.restore && restoreSummary("X", empty) === empty.reason, "a refusal summary is the honest refusal reason");
  const one = decideRestore({ currentStatus: "unavailable", lots: [active(1)], recalled: false, hidden: false });
  ok(restoreSummary("X", one).includes("1 unit on hand"), "singular unit is not pluralised");
  ok(!restoreSummary("X", one).includes("1 units"), "singular never reads '1 units'");

  if (fail > 0) throw new Error(`restore-to-sale-core: ${fail} assertion(s) failed`);
  console.log(`restore-to-sale-core: PASSED ${pass} assertions`);
}
