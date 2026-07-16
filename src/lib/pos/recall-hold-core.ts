/**
 * recall-hold-core.ts (Task AN-7)
 *
 * PURE recall-hold math for the sale path. No I/O (its only import is the
 * equally pure variant-lot-core) — the server wrapper (recall-hold-store.ts)
 * loads lot rows and the two enforcement points (the POS menu bundle and the
 * completion gate) call these helpers.
 *
 * WHY THIS EXISTS (verified gap): `inventory_lots.status` has carried a
 * `recalled` lifecycle state since migration 0023, and the admin inventory
 * page lets a manager set it — but NOTHING in the sell flow ever read it.
 * A recalled product stayed on the register menu and completed sales
 * server-side without complaint. An LCB recall requires the licensee to
 * segregate affected product and STOP SELLING it immediately; this module is
 * that stop, with the same discipline as the DOH high-THC gate (statutory,
 * hard block, NO override).
 *
 * WHAT HOLDS — `recalled` ONLY, deliberately NOT `quarantine`:
 *   - Every intake lot STARTS as `quarantine` until the manifest is accepted
 *     (intake-store.ts), and the destruction pipeline parks customer-return
 *     lots in `quarantine` during the 72h WAC hold (disposition.ts). Both are
 *     routine states that coexist with ACTIVE sellable stock of the SAME
 *     product — holding on quarantine would false-block a product the moment
 *     a restock delivery arrives. Quarantined lots are already unsellable at
 *     the lot layer (B19 FIFO consumes active lots; the B23 barcode index is
 *     active-only).
 *
 * SCOPE — the ENTIRE product key is held while ANY of its lots is recalled:
 *   order lines carry no lot identity (B19 decrements FIFO after the fact),
 *   so "sell the active lot's units, hold the recalled lot's" cannot be
 *   proven safe at the register. Conservative by design: the hold clears
 *   when the recalled lot leaves `recalled` (destroyed, or released back to
 *   active after the LCB clears it).
 *
 * NEVER GUESS: rows with a blank/missing product key or a non-string status
 * are skipped — they can never hold (or un-hold) anything.
 */

// Pure variant → lot-key extraction (Mastering Slice 1). No cycle:
// variant-lot-core imports nothing.
import { lotKeyFromVariantId } from "@/lib/pos/variant-lot-core";

/** The lot lifecycle status that places its product key on sale hold. */
export const HOLD_LOT_STATUS = "recalled";

export type LotStatusRow = {
  /** inventory_lots.pos_product_key (= order_lines.product_id = bundle productId). */
  posProductKey: string | null;
  /** inventory_lots.status. */
  status: string | null;
};

/** Product keys currently under recall hold. Garbage rows are skipped. */
export function buildRecallHoldIndex(rows: LotStatusRow[]): Set<string> {
  const held = new Set<string>();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.posProductKey !== "string") continue;
    const key = r.posProductKey.trim();
    if (!key) continue;
    if (r.status === HOLD_LOT_STATUS) held.add(key);
  }
  return held;
}

export type HoldLineInput = {
  /** order_lines.product_id (nullable snapshot — null lines can't match a hold). */
  productId: string | null;
  /**
   * order_lines.variant_id (nullable). Mastering Slice 1: intake variants
   * encode their own lot's pos_product_key (`${lotKey}-onboarded`), so a
   * recalled lot must hold the SIZE that lot is — even when the card's
   * product_id is a different (mastered) key. Optional so existing callers
   * keep compiling; absent = product-key check only, exactly as before.
   */
  variantId?: string | null;
  productName: string;
};

/**
 * Names of the held products among an order's lines, deduped, in line order.
 * A line is held when EITHER its product key OR its variant's own encoded
 * lot key is under recall. Lines without any key are skipped (they cannot be
 * proven held — but they also cannot be proven safe; the money/limit gates
 * own those cases).
 */
export function findHeldLines(lines: HoldLineInput[], held: Set<string>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of Array.isArray(lines) ? lines : []) {
    if (!line) continue;
    const productKey = typeof line.productId === "string" ? line.productId : null;
    const variantLotKey = lotKeyFromVariantId(line.variantId);
    const matched =
      (productKey && held.has(productKey) ? productKey : null) ??
      (variantLotKey && held.has(variantLotKey) ? variantLotKey : null);
    if (!matched) continue;
    if (seen.has(matched)) continue;
    seen.add(matched);
    names.push(line.productName || matched);
  }
  return names;
}

/**
 * The hard-block refusal message. Null when nothing is held (caller pattern
 * mirrors the completion gate: null = may proceed).
 */
export function recallHoldRefusal(heldNames: string[]): string | null {
  if (!Array.isArray(heldNames) || heldNames.length === 0) return null;
  const names = heldNames.map((n) => `"${n}"`).join(", ");
  const isAre = heldNames.length === 1 ? "is" : "are";
  return (
    `Sale blocked: ${names} ${isAre} under an active RECALL hold — recalled product must be ` +
    `segregated and may NOT be sold. Remove the item${heldNames.length === 1 ? "" : "s"} from the sale. ` +
    `There is no override for this rule; the hold clears only when a manager releases or destroys ` +
    `the recalled lot in Admin → Inventory.`
  );
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts).
// ---------------------------------------------------------------------------
export function __runRecallHoldCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    passed++;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  // buildRecallHoldIndex — only 'recalled' holds; garbage skipped
  const held = buildRecallHoldIndex([
    { posProductKey: "p1", status: "recalled" },
    { posProductKey: "p2", status: "active" },
    { posProductKey: "p3", status: "quarantine" }, // routine intake state — never holds
    { posProductKey: "p4", status: "destroyed" },
    { posProductKey: "  ", status: "recalled" }, // blank key skipped
    { posProductKey: null, status: "recalled" }, // null key skipped
    { posProductKey: "p5", status: null }, // null status skipped
  ]);
  eq([...held].sort(), ["p1"], "only recalled lots hold");
  eq(buildRecallHoldIndex([]).size, 0, "empty rows → empty index");

  // A product with BOTH an active and a recalled lot is held (whole key).
  const mixed = buildRecallHoldIndex([
    { posProductKey: "p9", status: "active" },
    { posProductKey: "p9", status: "recalled" },
  ]);
  ok(mixed.has("p9"), "any recalled lot holds the whole product key");

  // findHeldLines — dedupe, order, null keys skipped
  const lines = [
    { productId: "p1", productName: "Blue Dream 3.5g" },
    { productId: "p2", productName: "Fine Product" },
    { productId: "p1", productName: "Blue Dream 3.5g" }, // duplicate line
    { productId: null, productName: "Pre-B20 legacy line" },
  ];
  eq(findHeldLines(lines, held), ["Blue Dream 3.5g"], "held names deduped, in order");
  eq(findHeldLines(lines, new Set()), [], "nothing held → empty");
  eq(
    findHeldLines([{ productId: "p1", productName: "" }], held),
    ["p1"],
    "blank name falls back to the product key",
  );

  // Mastering Slice 1 — variant-encoded lot keys also trip the hold.
  eq(
    findHeldLines(
      [{ productId: "mastered-card", variantId: "p1-onboarded", productName: "BD (3.5g)" }],
      held,
    ),
    ["BD (3.5g)"],
    "recalled lot holds ITS size on a mastered card (variant key match)",
  );
  eq(
    findHeldLines(
      [{ productId: "mastered-card", variantId: "safe-lot-onboarded", productName: "BD (1g)" }],
      held,
    ),
    [],
    "sibling size from a safe lot is NOT held",
  );
  eq(
    findHeldLines(
      [{ productId: "p1", variantId: "pos-abc-hash", productName: "Bulk Card" }],
      held,
    ),
    ["Bulk Card"],
    "product-key match still holds when the variant id encodes nothing",
  );
  eq(
    findHeldLines(
      [
        { productId: "card", variantId: "p1-onboarded", productName: "Size A" },
        { productId: "p1", variantId: null, productName: "Legacy card" }, // same held key
      ],
      held,
    ),
    ["Size A"],
    "variant-key and product-key hits on the SAME held key dedupe",
  );

  // recallHoldRefusal
  eq(recallHoldRefusal([]), null, "no held names → null (may proceed)");
  const one = recallHoldRefusal(["Blue Dream 3.5g"]);
  ok(one != null && one.includes('"Blue Dream 3.5g" is under an active RECALL hold'), "singular refusal");
  ok(one!.includes("no override"), "refusal states no override exists");
  const two = recallHoldRefusal(["A", "B"]);
  ok(two != null && two.includes('"A", "B" are under an active RECALL hold'), "plural refusal");
  ok(two!.includes("items"), "plural remove-items wording");

  console.log(`recall-hold-core: PASSED ${passed} assertions`);
}
