/**
 * src/lib/inventory/lot-table-core.ts  (SLICE 50 — inventory table columns)
 *
 * PURE display helpers for the back-office inventory lot table's new columns
 * (owner request): Received date, Type, Size, Sold, Strain.
 *
 *   • Received — the calendar date the lot arrived. The import publisher
 *     backdates each lot's created_at to its POS "Received date" (see
 *     import-service.ts: "created_at is backdated to each lot's Received date
 *     so the sale path's created_at-ordered FIFO consumes genuinely-oldest
 *     stock first"), and intake-created lots get their true creation moment,
 *     so created_at IS the received date for every lot. Rendered as the plain
 *     ISO date (YYYY-MM-DD) — no timezone math, no guessing.
 *   • Type — the lot's stored category (the human product type like
 *     "Live Resin" or "Gummies"), falling back to the LCB inventory_type
 *     ("Usable Marijuana") when no category was stored. Never invented.
 *   • Size — unit_weight + unit_weight_uom exactly as stored ("3.5 g",
 *     "100 mg"); em-dash when the lot has no stored size.
 *   • Sold — received_qty − on_hand_qty, floored at 0 (an upward adjustment
 *     can push on-hand above received; showing negative "sold" would be a
 *     lie). Pure arithmetic on the lot's own columns.
 *   • Strain — strain_name verbatim; em-dash when blank.
 *
 * No I/O, no React — registered in the pure self-test runner.
 */

const EM_DASH = "\u2014";

/** The subset of an inventory lot the table columns read. */
export type LotTableFields = {
  created_at: string;
  category: string | null;
  inventory_type: string | null;
  unit_weight: number | null;
  unit_weight_uom: string | null;
  received_qty: number;
  on_hand_qty: number;
  strain_name: string | null;
};

/** ISO date (YYYY-MM-DD) of the lot's received moment; em-dash if unparsable. */
export function lotReceivedDate(lot: Pick<LotTableFields, "created_at">): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(lot.created_at ?? ""));
  return m ? m[1] : EM_DASH;
}

/** Human product type: stored category first, else the LCB inventory type. */
export function lotTypeLabel(lot: Pick<LotTableFields, "category" | "inventory_type">): string {
  const category = String(lot.category ?? "").trim();
  if (category) return category;
  const invType = String(lot.inventory_type ?? "").trim();
  return invType || EM_DASH;
}

/** Package size from the stored unit weight ("3.5 g", "100 mg"); em-dash when none. */
export function lotSizeLabel(lot: Pick<LotTableFields, "unit_weight" | "unit_weight_uom">): string {
  if (lot.unit_weight == null || !Number.isFinite(lot.unit_weight) || lot.unit_weight <= 0) return EM_DASH;
  const qty = Number.isInteger(lot.unit_weight) ? String(lot.unit_weight) : String(lot.unit_weight);
  const uom = String(lot.unit_weight_uom ?? "").trim();
  return uom ? `${qty} ${uom}` : qty;
}

/**
 * Units sold = received − on hand, never negative. An upward inventory
 * adjustment (found stock, count correction) can push on-hand above the
 * original received quantity; clamping at 0 keeps the column honest.
 */
export function lotSoldQty(lot: Pick<LotTableFields, "received_qty" | "on_hand_qty">): number {
  const received = Number(lot.received_qty ?? 0);
  const onHand = Number(lot.on_hand_qty ?? 0);
  const sold = received - onHand;
  return sold > 0 ? sold : 0;
}

/** Strain name verbatim; em-dash when blank. */
export function lotStrainLabel(lot: Pick<LotTableFields, "strain_name">): string {
  const strain = String(lot.strain_name ?? "").trim();
  return strain || EM_DASH;
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

export function __runLotTableCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL lot-table-core: " + msg);
    passed += 1;
  };

  // Received date: ISO timestamp → plain date; backdated import timestamps too.
  ok(lotReceivedDate({ created_at: "2026-06-17T12:00:00.000Z" }) === "2026-06-17", "received: ISO timestamp yields date");
  ok(lotReceivedDate({ created_at: "2026-07-01" }) === "2026-07-01", "received: bare date passes through");
  ok(lotReceivedDate({ created_at: "" }) === EM_DASH, "received: blank yields em-dash");

  // Type: category first, inventory_type fallback, never invented.
  ok(lotTypeLabel({ category: "Live Resin", inventory_type: "Concentrate for Inhalation" }) === "Live Resin", "type: category preferred");
  ok(lotTypeLabel({ category: "  ", inventory_type: "Usable Marijuana" }) === "Usable Marijuana", "type: falls back to LCB inventory type");
  ok(lotTypeLabel({ category: null, inventory_type: null }) === EM_DASH, "type: nothing stored yields em-dash");

  // Size: stored unit weight verbatim.
  ok(lotSizeLabel({ unit_weight: 3.5, unit_weight_uom: "g" }) === "3.5 g", "size: 3.5 g");
  ok(lotSizeLabel({ unit_weight: 100, unit_weight_uom: "mg" }) === "100 mg", "size: 100 mg");
  ok(lotSizeLabel({ unit_weight: null, unit_weight_uom: null }) === EM_DASH, "size: none stored yields em-dash");
  ok(lotSizeLabel({ unit_weight: 0, unit_weight_uom: "g" }) === EM_DASH, "size: zero weight yields em-dash");
  ok(lotSizeLabel({ unit_weight: 7, unit_weight_uom: "" }) === "7", "size: missing uom shows bare quantity");

  // Sold: received − on hand, floored at 0.
  ok(lotSoldQty({ received_qty: 24, on_hand_qty: 10 }) === 14, "sold: 24 received, 10 on hand = 14 sold");
  ok(lotSoldQty({ received_qty: 5, on_hand_qty: 5 }) === 0, "sold: untouched lot = 0");
  ok(lotSoldQty({ received_qty: 5, on_hand_qty: 8 }) === 0, "sold: upward adjustment never shows negative");

  // Strain.
  ok(lotStrainLabel({ strain_name: "Blue Dream" }) === "Blue Dream", "strain: verbatim");
  ok(lotStrainLabel({ strain_name: "  " }) === EM_DASH, "strain: blank yields em-dash");
  ok(lotStrainLabel({ strain_name: null }) === EM_DASH, "strain: null yields em-dash");

  console.log(`lot-table-core: ${passed} assertions passed`);
}
