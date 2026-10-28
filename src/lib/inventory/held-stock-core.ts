/**
 * src/lib/inventory/held-stock-core.ts  (Fix Phase 1.4 — G-44, F-15-6, F-15-7)
 *
 * ONE rule for units that are on hand but must never be sold:
 *   sellable = on_hand_qty − held_qty   (never below 0)
 *
 * Owner basis: D62 ("We will rarely use these features, but they are
 * necessary for our industry so we must have them and do them properly and
 * accurately."); SOP-01 §4.23 (the register's own words: "Product goes to the
 * quarantine bin."). A customer-returned unit marked Destroy is added back to
 * the lot (CCRS Other add-back, so CCRS nets to zero once the Destruction
 * posts) but is HELD: the register, the POS menu and the sellability report
 * never count it. Migration 0308 adds `inventory_lots.held_qty`.
 *
 * Held units are still on hand: the CCRS Inventory file, cycle counts and
 * valuation keep using on_hand_qty (the unit is physically in the sealed
 * destroy bin until it is destroyed).
 *
 * Callers:
 *  - sale-lot-read.ts readSaleLots         → a sale draws only sellable units
 *  - api/pos/menu                          → register stock = sellable
 *  - register-sellability-store.ts         → live stock = sellable
 *  - disposition.ts postReduction          → a disposition never removes held units
 *  - disposition.ts createCustomerReturn   → Destroy return is held, atomically (RPC)
 *  - disposition.ts createVendorReturn     → a vendor return reserves its units until departure (0309; G-42)
 *
 * Pure: no I/O.
 */

/** The single-transaction RPC (migration 0308). */
export const RECORD_CUSTOMER_RETURN_RPC = "record_customer_return";
/** Completes a held destruction: on hand and held both come down together (0308). */
export const CONSUME_LOT_HOLD_RPC = "consume_lot_hold";
/** Releases a hold without changing on hand (owner cancel; 0308). */
export const RELEASE_LOT_HOLD_RPC = "release_lot_hold";

/** Number-ish → finite number ≥ 0 (numeric columns can arrive as strings). */
export function toHeldNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Units the register may sell from a lot: on hand minus held, never below 0. */
export function sellableQty(onHand: unknown, held: unknown): number {
  return Math.max(0, toHeldNumber(onHand) - toHeldNumber(held));
}

/**
 * Does this PostgREST / Postgres error mean migration 0308's held_qty column
 * is not there yet? Readers then retry without it (nothing is held before
 * 0308, so on hand is the sellable figure, exactly the old behaviour).
 */
export function isMissingHeldQtyColumnError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "").toLowerCase();
  const signalled =
    ["42703", "PGRST204"].includes(String(error.code ?? "")) ||
    /column .* does not exist|could not find the .* column/.test(msg);
  return signalled && /held_(qty|quantity)/.test(msg);
}

/**
 * May a disposition (vendor return, destruction of non-held units, other
 * reductions in disposition.ts) remove `qty` from a lot? Held units are
 * reserved for their own destruction and cannot be taken by anything else.
 */
export function evaluateReductionAgainstHold(input: {
  qty: number;
  onHand: unknown;
  held: unknown;
}): { ok: true } | { ok: false; error: string } {
  const onHand = toHeldNumber(input.onHand);
  const held = toHeldNumber(input.held);
  const free = Math.max(0, onHand - held);
  if (input.qty > onHand) {
    return { ok: false, error: `Quantity (${input.qty}) exceeds on-hand (${onHand}).` };
  }
  if (input.qty > free) {
    return {
      ok: false,
      error: `Quantity (${input.qty}) exceeds what is free on this lot (${free}): ${held} unit(s) are held (for a customer-return destruction or a vendor return waiting to depart) and cannot be used for anything else.`,
    };
  }
  return { ok: true };
}

/** The register's words for where a Destroy return goes (SOP-01 §4.23). */
export const DESTROY_RETURN_HELD_NOTE =
  "Held for destruction: counted on hand (and in CCRS) but never sellable until the destruction is completed.";

/** What the owner's cancel of a customer-return destruction does to the held units. */
export function heldReleaseMessage(qty: number): string {
  const n = toHeldNumber(qty);
  return `${n} returned unit(s) released from hold; they now count as sellable stock. Put them back on the shelf only if the package is sealed and unharmed; otherwise schedule a new destruction.`;
}

/** Pre-0308 notice: the return was saved the old way (the unit is not held by the app yet). */
export const HOLD_PENDING_MIGRATION_NOTE =
  "Migration 0308 is not applied yet, so the app could not hold the returned unit: keep it in the sealed destroy bin (SOP-15 §4.7).";

export function __runHeldStockCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`held-stock-core FAIL: ${msg}`);
    }
  };
  ok(sellableQty(10, 0) === 10, "nothing held → all sellable");
  ok(sellableQty(10, 3) === 7, "held subtracts");
  ok(sellableQty(3, 3) === 0, "all held → 0");
  ok(sellableQty(2, 5) === 0, "never below 0");
  ok(sellableQty("4", "1") === 3, "numeric strings");
  ok(sellableQty(5, null) === 5, "null held → 0");
  ok(sellableQty(5, undefined) === 5, "missing held → 0");
  ok(sellableQty(null, null) === 0, "null on hand → 0");
  ok(toHeldNumber(-2) === 0, "negative → 0");
  ok(toHeldNumber("x") === 0, "garbage → 0");
  ok(isMissingHeldQtyColumnError({ code: "42703", message: 'column inventory_lots.held_qty does not exist' }), "pg missing column");
  ok(isMissingHeldQtyColumnError({ code: "PGRST204", message: "Could not find the 'held_quantity' column" }), "postgrest missing column");
  ok(!isMissingHeldQtyColumnError({ code: "42703", message: "column menu_source_variant_id does not exist" }), "other column is not ours");
  ok(!isMissingHeldQtyColumnError({ code: "23505", message: "duplicate key held_qty" }), "other error code");
  ok(!isMissingHeldQtyColumnError(null), "null error");
  const r1 = evaluateReductionAgainstHold({ qty: 2, onHand: 5, held: 3 });
  ok(r1.ok === true, "2 of 2 free ok");
  const r2 = evaluateReductionAgainstHold({ qty: 3, onHand: 5, held: 3 });
  ok(r2.ok === false && /held \(for a customer-return destruction or a vendor return/.test(r2.error), "cannot take held units");
  const r3 = evaluateReductionAgainstHold({ qty: 6, onHand: 5, held: 0 });
  ok(r3.ok === false && /exceeds on-hand \(5\)/.test(r3.error), "on-hand message kept");
  const r4 = evaluateReductionAgainstHold({ qty: 5, onHand: 5, held: null });
  ok(r4.ok === true, "pre-0308 (no held) behaves as before");
  ok(/sealed and unharmed/.test(heldReleaseMessage(1)), "release message tells staff what to do");
  ok(/^1 returned unit/.test(heldReleaseMessage(1)), "release message count");
  ok(/never sellable/.test(DESTROY_RETURN_HELD_NOTE), "held note");
  ok(/0308/.test(HOLD_PENDING_MIGRATION_NOTE) && /§4\.7/.test(HOLD_PENDING_MIGRATION_NOTE), "pending note names migration and SOP");
  ok(RECORD_CUSTOMER_RETURN_RPC === "record_customer_return", "rpc name pinned");
  console.log(`held-stock-core: ${passed} assertions passed, ${failed} failed`);
  return { passed, failed };
}
