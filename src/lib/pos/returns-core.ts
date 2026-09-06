/**
 * src/lib/pos/returns-core.ts  (POS Slice B15)
 *
 * PURE policy logic for CUSTOMER RETURNS at the counter. Zero I/O so it is
 * unit-testable directly and safe to import anywhere. The server flow (B16)
 * wires these verdicts into the existing Task Q machinery
 * (`createCustomerReturn` in @/lib/inventory/disposition.ts — CCRS Sale
 * Delete/Update snapshot, positive inventory add-back, restock/destroy).
 *
 * Rule vs policy — verified, never guessed
 * ----------------------------------------
 *  • WAC 314-55-079(12) (scraped app.leg.wa.gov): a cannabis retailer MAY
 *    accept returns of open cannabis products — ALL products, not vape-only —
 *    but ONLY in original packaging with the lot/batch/inventory ID fully
 *    legible. Those attestations are enforced by `validateCustomerReturn`
 *    in @/lib/inventory/disposition-core (Task Q) and are NOT duplicated here.
 *  • CCRS FAQ (scraped lcb.wa.gov/ccrs/faq): a valid customer return =
 *    the sale identifier is DELETED (or Updated for a partial) from CCRS and
 *    the inventory identifier is reported on an InventoryAdjustment as a
 *    return, with details. Handled by the Task Q correction queue.
 *  • STORE POLICY (owner, Task AD — STRICTER than rule, which is allowed):
 *      1. The buyer must be a LOYALTY member — the original sale must carry
 *         orders.customer_id (B14 attaches the member at the register).
 *      2. The customer must present the ORIGINAL RECEIPT — we look the sale
 *         up by its printed receipt number (last 8 hex of the durable sale
 *         client_uuid, uppercase — see receiptNumber() in receipt-core).
 *      3. Returns are accepted up to 15 days from the purchase date,
 *         counted in Pacific calendar days (purchase day = day 0).
 *
 * Money notes
 * -----------
 *  • MINOR UNITS (cents) everywhere; every amount is an integer.
 *  • order_lines.price_minor_units is the FINAL tax-inclusive unit price the
 *    customer actually paid. Medical (tax-exempt) lines were REPRICED at sale
 *    time by medical-pos-core, so `unit price × qty` is always exactly what
 *    the patient paid — no medical special-casing needed at refund time.
 *  • Loyalty clawback is PROPORTIONAL to the refund, floored, and clamped to
 *    the points actually earned on the order — it can never over-claw, and a
 *    full refund claws back every earned point.
 */

import { pacificDayKey } from "@/lib/reports/timezone";

// ---------------------------------------------------------------------------
// Store policy constants (owner-set, Task AD)
// ---------------------------------------------------------------------------

/** Days a customer has to request a return, counting the purchase day as 0. */
export const RETURN_WINDOW_DAYS = 15;

/**
 * The return policy as printed on the customer's receipt (Slice 22b).
 *
 * Generated from RETURN_WINDOW_DAYS rather than typed as prose, so the paper
 * in the customer's hand can never promise a window the returns screen does
 * not actually honour. If the owner shortens the window to 7 days, every
 * receipt printed afterwards says 7 — with no second place to remember.
 *
 * The three sentences mirror, in order, the three store-policy conditions
 * documented at the top of this file: loyalty membership, the original
 * receipt, and the window. The final sentence states the one statutory
 * limit (WAC 314-55-079(12)): product that has left the store can only come
 * back in its original packaging with the lot/batch identifier legible.
 */
export function defaultReturnPolicyText(): string {
  const days = RETURN_WINDOW_DAYS;
  return [
    `Returns accepted within ${days} days of purchase (purchase day counts as day 0).`,
    "Bring this receipt and the loyalty account used for the sale.",
    "Product must be in its original packaging with the lot/batch label legible.",
    "Refunds are issued to the original form of payment.",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Receipt-number contract (original receipt in hand)
// ---------------------------------------------------------------------------

/**
 * Normalize what the manager types from the paper receipt. The printed number
 * is the last 8 hex digits of the sale's client UUID, uppercase (see
 * receiptNumber() in receipt-core). Accepts sloppy input — spaces, dashes,
 * lowercase, a pasted "Receipt " prefix — and returns the canonical 8-char
 * uppercase form, or null when it cannot possibly be a receipt number.
 */
export function normalizeReceiptNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const hex = raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length !== 8) return null;
  return hex;
}

/**
 * Does this durable sale client UUID print as the given (normalized) receipt
 * number? Mirrors receiptNumber() exactly: strip dashes, last 8, uppercase.
 */
export function clientUuidMatchesReceipt(clientUuid: string, receiptNumber8: string): boolean {
  const clean = clientUuid.replace(/-/g, "");
  return clean.slice(-8).toUpperCase() === receiptNumber8;
}

/**
 * The SQL LIKE suffix pattern for the server lookup. A v4 UUID's last 8 hex
 * chars sit inside its final 12-char group, so they are dash-free — matching
 * `client_uuid::text LIKE '%xxxxxxxx'` (lowercase) is exact and index-free
 * safe at our volume. Returns null for un-normalizable input.
 */
export function receiptLookupSuffix(raw: unknown): string | null {
  const n = normalizeReceiptNumber(raw);
  return n ? n.toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// 15-day window (Pacific calendar days — store policy)
// ---------------------------------------------------------------------------

/**
 * Whole Pacific calendar days from `earlierIso` to `laterIso`. Uses the
 * store-timezone day keys (America/Los_Angeles, DST-safe via Intl) and diffs
 * them at UTC noon so the count never wobbles across spring-forward/fall-back.
 */
export function pacificDaysBetween(earlierIso: string, laterIso: string): number {
  const [ay, am, ad] = pacificDayKey(earlierIso).split("-").map(Number);
  const [by, bm, bd] = pacificDayKey(laterIso).split("-").map(Number);
  const a = Date.UTC(ay, am - 1, ad, 12);
  const b = Date.UTC(by, bm - 1, bd, 12);
  return Math.round((b - a) / 86_400_000);
}

export type ReturnWindowVerdict =
  | { ok: true; daysSincePurchase: number; daysRemaining: number }
  | { ok: false; daysSincePurchase: number; error: string };

/**
 * Is the sale still inside the 15-day return window? The purchase day counts
 * as day 0, so a sale completed any time on July 1 is returnable through the
 * end of July 16 Pacific. A sale timestamp in the future (device clock skew)
 * is refused — never silently accepted.
 */
export function returnWindowVerdict(purchasedAtIso: string, nowIso: string): ReturnWindowVerdict {
  const days = pacificDaysBetween(purchasedAtIso, nowIso);
  if (days < 0) {
    return {
      ok: false,
      daysSincePurchase: days,
      error: "This sale is timestamped in the future — check the register clock before processing a return.",
    };
  }
  if (days > RETURN_WINDOW_DAYS) {
    return {
      ok: false,
      daysSincePurchase: days,
      error: `Outside the ${RETURN_WINDOW_DAYS}-day return window — this sale was ${days} days ago (store policy). Refuse the return.`,
    };
  }
  return { ok: true, daysSincePurchase: days, daysRemaining: RETURN_WINDOW_DAYS - days };
}

// ---------------------------------------------------------------------------
// Eligibility (all store-policy gates in one verdict)
// ---------------------------------------------------------------------------

export type ReturnEligibilityInput = {
  /** orders.status — only "completed" sales are returnable (matches Task Q). */
  orderStatus: string;
  /** orders.customer_id — the loyalty member attached at the register (B14). */
  orderCustomerId: string | null;
  /** orders.completed_at, falling back to placed_at when null. */
  purchasedAtIso: string | null;
  /** Current instant (caller supplies for testability). */
  nowIso: string;
};

export type ReturnEligibilityVerdict =
  | { ok: true; daysSincePurchase: number; daysRemaining: number }
  | { ok: false; errors: string[] };

/**
 * Evaluate every store-policy gate for a looked-up sale. Reports ALL failures
 * at once (staff see the complete picture, not a whack-a-mole of errors).
 * WAC 079(12) packaging/legibility attestations are enforced later, per line,
 * by validateCustomerReturn — this verdict covers the SALE-level gates.
 */
export function evaluateReturnEligibility(input: ReturnEligibilityInput): ReturnEligibilityVerdict {
  const errors: string[] = [];

  if (input.orderStatus !== "completed") {
    errors.push(`Only COMPLETED sales can be returned (this sale is "${input.orderStatus}").`);
  }
  if (!input.orderCustomerId || !input.orderCustomerId.trim()) {
    errors.push(
      "No loyalty member is attached to this sale — store policy requires the product to have been purchased by a loyalty customer. Refuse the return.",
    );
  }
  if (!input.purchasedAtIso) {
    errors.push("This sale has no purchase timestamp — cannot verify the return window.");
    return { ok: false, errors };
  }

  const window = returnWindowVerdict(input.purchasedAtIso, input.nowIso);
  if (!window.ok) errors.push(window.error);

  if (errors.length > 0) return { ok: false, errors };
  const w = window as Extract<ReturnWindowVerdict, { ok: true }>;
  return { ok: true, daysSincePurchase: w.daysSincePurchase, daysRemaining: w.daysRemaining };
}

// ---------------------------------------------------------------------------
// Refund math (minor units; tax-inclusive stored prices)
// ---------------------------------------------------------------------------

export type RefundLineInput = {
  /** order_lines.price_minor_units — FINAL tax-inclusive unit price paid. */
  unitPriceMinor: number;
  /** Units the customer is returning on this line. */
  quantity: number;
  /** Units still returnable = sold − already returned (double-return guard). */
  remainingReturnable: number;
};

export type RefundLineVerdict = { ok: true; refundMinor: number } | { ok: false; error: string };

/**
 * Refund for one returned line = stored unit price × returned quantity.
 * Because order_lines.price_minor_units is the exact tax-inclusive amount the
 * customer paid per unit — with medical exemptions already repriced in at
 * sale time — this is precisely their money back, never an estimate.
 */
export function refundForLine(input: RefundLineInput): RefundLineVerdict {
  if (!Number.isInteger(input.unitPriceMinor) || input.unitPriceMinor < 0) {
    return { ok: false, error: "Stored unit price is invalid (must be non-negative integer cents)." };
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return { ok: false, error: "Return quantity must be a positive whole number." };
  }
  if (!Number.isInteger(input.remainingReturnable) || input.remainingReturnable < 1) {
    return { ok: false, error: "Nothing left to return on this line — it has already been fully returned." };
  }
  if (input.quantity > input.remainingReturnable) {
    return {
      ok: false,
      error: `Return quantity (${input.quantity}) exceeds what is still returnable on this line (${input.remainingReturnable}).`,
    };
  }
  return { ok: true, refundMinor: input.unitPriceMinor * input.quantity };
}

/** Sum multiple line refunds; any invalid line fails the whole computation. */
export function refundForLines(lines: RefundLineInput[]): RefundLineVerdict {
  if (lines.length === 0) return { ok: false, error: "Select at least one line to return." };
  let total = 0;
  for (const line of lines) {
    const v = refundForLine(line);
    if (!v.ok) return v;
    total += v.refundMinor;
  }
  return { ok: true, refundMinor: total };
}

// ---------------------------------------------------------------------------
// Loyalty points clawback (proportional, floored, clamped)
// ---------------------------------------------------------------------------

export type PointsClawbackInput = {
  /** Points the order actually EARNED (loyalty_ledger kind='earn' row). */
  earnedPoints: number;
  /** Refund being given now, minor units (tax-inclusive). */
  refundMinor: number;
  /** Original order total, minor units (tax-inclusive) — the earn basis' order. */
  orderTotalMinor: number;
};

/**
 * Points to claw back for a refund. Proportional to the refunded share of the
 * order total, floored (customer-favorable rounding), clamped to [0, earned].
 * A refund covering the whole order claws back every earned point; an order
 * that earned nothing claws back nothing. The B16 flow posts this as a
 * NEGATIVE `adjustPoints` ledger entry with the return id in the note.
 */
export function pointsClawback(input: PointsClawbackInput): number {
  const earned = Math.max(0, Math.floor(input.earnedPoints));
  if (earned === 0) return 0;
  if (!Number.isInteger(input.refundMinor) || input.refundMinor <= 0) return 0;
  if (!Number.isInteger(input.orderTotalMinor) || input.orderTotalMinor <= 0) return 0;
  if (input.refundMinor >= input.orderTotalMinor) return earned;
  return Math.min(earned, Math.floor((earned * input.refundMinor) / input.orderTotalMinor));
}

// ---------------------------------------------------------------------------
// Embedded self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`returns-core self-test failed: ${msg}`);
}

export function __runPosReturnsCoreTests(): void {
  // --- receipt-number contract -------------------------------------------
  ok(normalizeReceiptNumber("14174000") === "14174000", "clean receipt number passes");
  ok(normalizeReceiptNumber("  14 17-40 00 ") === "14174000", "spaces/dashes stripped");
  ok(normalizeReceiptNumber("No. 1417400a") === "1417400A", "hexless prefix stripped, hex uppercased");
  // "Receipt" itself contains hex letters (e,c,e) => pasting the word makes
  // the digit count wrong and the input is safely rejected, never mis-read.
  ok(normalizeReceiptNumber("Receipt 1417400a") === null, "prefix containing hex letters rejects, never mis-reads");
  ok(normalizeReceiptNumber("1417400") === null, "7 hex chars rejected");
  ok(normalizeReceiptNumber("141740001") === null, "9 hex chars rejected");
  ok(normalizeReceiptNumber("1417400g") === null, "8 chars but non-hex leftover shortens => rejected");
  ok(normalizeReceiptNumber(12345678 as unknown) === null, "non-string rejected");
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  ok(clientUuidMatchesReceipt(uuid, "14174000"), "uuid matches its printed receipt number");
  ok(!clientUuidMatchesReceipt(uuid, "14174001"), "wrong number does not match");
  ok(receiptLookupSuffix(" 14-17 40 0A ") === "1417400a", "lookup suffix is normalized lowercase");
  ok(receiptLookupSuffix("zz") === null, "garbage lookup suffix is null");

  // --- Pacific day math ----------------------------------------------------
  // Noon vs 1 PM Pacific on 07-02 (19:00Z/20:00Z in PDT) — same Pacific day.
  ok(pacificDaysBetween("2026-07-02T19:00:00.000Z", "2026-07-02T20:00:00.000Z") === 0, "same Pacific day = 0");
  // 23:30 Pacific 07-01 (06:30Z on 07-02) → 01:00 Pacific 07-02 (08:00Z):
  // only 90 minutes elapsed but Pacific midnight rolled the day.
  ok(pacificDaysBetween("2026-07-02T06:30:00.000Z", "2026-07-02T08:00:00.000Z") === 1, "Pacific midnight rolls the day");
  // DST fall-back (Nov 1 2026, 2am→1am): Oct 30 to Nov 14 is still 15 days.
  ok(pacificDaysBetween("2026-10-30T19:00:00.000Z", "2026-11-14T20:00:00.000Z") === 15, "DST fall-back day count stable");

  // --- 15-day window --------------------------------------------------------
  const day0 = returnWindowVerdict("2026-07-01T19:00:00.000Z", "2026-07-01T21:00:00.000Z");
  ok(day0.ok && day0.daysSincePurchase === 0 && day0.daysRemaining === 15, "purchase day = day 0, 15 remaining");
  const day15 = returnWindowVerdict("2026-07-01T19:00:00.000Z", "2026-07-16T19:00:00.000Z");
  ok(day15.ok && day15.daysRemaining === 0, "day 15 is the last allowed day");
  const day16 = returnWindowVerdict("2026-07-01T19:00:00.000Z", "2026-07-17T19:00:00.000Z");
  ok(!day16.ok && day16.error.includes("15-day"), "day 16 refused with policy message");
  const future = returnWindowVerdict("2026-07-10T19:00:00.000Z", "2026-07-01T19:00:00.000Z");
  ok(!future.ok && future.error.includes("future"), "future-dated sale refused (clock skew)");

  // --- eligibility ----------------------------------------------------------
  const eligible = evaluateReturnEligibility({
    orderStatus: "completed",
    orderCustomerId: "0f5d9e46-6bbd-4cbe-b7a5-1a2b3c4d5e6f",
    purchasedAtIso: "2026-07-01T19:00:00.000Z",
    nowIso: "2026-07-05T19:00:00.000Z",
  });
  ok(eligible.ok && eligible.daysSincePurchase === 4, "clean sale is eligible");
  const anon = evaluateReturnEligibility({
    orderStatus: "completed",
    orderCustomerId: null,
    purchasedAtIso: "2026-07-01T19:00:00.000Z",
    nowIso: "2026-07-05T19:00:00.000Z",
  });
  ok(!anon.ok && anon.errors.some((e) => e.includes("loyalty")), "anonymous sale refused (loyalty gate)");
  const multi = evaluateReturnEligibility({
    orderStatus: "pending",
    orderCustomerId: "   ",
    purchasedAtIso: "2026-06-01T19:00:00.000Z",
    nowIso: "2026-07-05T19:00:00.000Z",
  });
  ok(!multi.ok && multi.errors.length === 3, "all sale-level failures reported at once");
  const noStamp = evaluateReturnEligibility({
    orderStatus: "completed",
    orderCustomerId: "0f5d9e46-6bbd-4cbe-b7a5-1a2b3c4d5e6f",
    purchasedAtIso: null,
    nowIso: "2026-07-05T19:00:00.000Z",
  });
  ok(!noStamp.ok && noStamp.errors.some((e) => e.includes("timestamp")), "missing purchase timestamp refused");

  // --- refund math -----------------------------------------------------------
  const oneLine = refundForLine({ unitPriceMinor: 1463, quantity: 2, remainingReturnable: 2 });
  ok(oneLine.ok && oneLine.refundMinor === 2926, "refund = unit price x qty");
  ok(!refundForLine({ unitPriceMinor: 1463, quantity: 3, remainingReturnable: 2 }).ok, "over-return blocked");
  ok(!refundForLine({ unitPriceMinor: 1463, quantity: 1, remainingReturnable: 0 }).ok, "fully-returned line blocked");
  ok(!refundForLine({ unitPriceMinor: 14.63 as unknown as number, quantity: 1, remainingReturnable: 1 }).ok, "fractional cents blocked");
  ok(!refundForLine({ unitPriceMinor: 1463, quantity: 0, remainingReturnable: 1 }).ok, "zero quantity blocked");
  const sum = refundForLines([
    { unitPriceMinor: 1463, quantity: 1, remainingReturnable: 2 },
    { unitPriceMinor: 2800, quantity: 2, remainingReturnable: 2 },
  ]);
  ok(sum.ok && sum.refundMinor === 7063, "multi-line refund sums");
  ok(!refundForLines([]).ok, "empty selection refused");
  ok(
    !refundForLines([
      { unitPriceMinor: 1463, quantity: 1, remainingReturnable: 1 },
      { unitPriceMinor: 2800, quantity: 5, remainingReturnable: 2 },
    ]).ok,
    "one bad line fails the whole refund",
  );

  // --- points clawback --------------------------------------------------------
  ok(pointsClawback({ earnedPoints: 20, refundMinor: 2926, orderTotalMinor: 2926 }) === 20, "full refund claws all points");
  ok(pointsClawback({ earnedPoints: 20, refundMinor: 1463, orderTotalMinor: 2926 }) === 10, "half refund claws half (floored)");
  ok(pointsClawback({ earnedPoints: 3, refundMinor: 1000, orderTotalMinor: 2926 }) === 1, "proportional floor favors customer");
  ok(pointsClawback({ earnedPoints: 0, refundMinor: 2926, orderTotalMinor: 2926 }) === 0, "no points earned => nothing clawed");
  ok(pointsClawback({ earnedPoints: 20, refundMinor: 0, orderTotalMinor: 2926 }) === 0, "zero refund => nothing clawed");
  ok(pointsClawback({ earnedPoints: 20, refundMinor: 99999, orderTotalMinor: 2926 }) === 20, "clawback clamped to earned");
  ok(pointsClawback({ earnedPoints: 20, refundMinor: 2926, orderTotalMinor: 0 }) === 0, "invalid order total => safe zero");

  console.log("returns-core: all self-tests passed");
}
