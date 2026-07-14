/**
 * src/lib/pos/void-sale-core.ts  (POS Slice B27)
 *
 * PURE rules for voiding a register sale at the counter. Zero I/O.
 *
 * A VOID is not a RETURN. The returns desk (B15/B16, returns-core.ts) exists
 * for a customer bringing product back later: loyalty-member requirement,
 * original receipt, 15-day window, restock/destroy disposition, CCRS sale
 * correction + inventory add-back "as a return, with details".
 *
 * A void corrects a MISTAKE moments after the sale: wrong item rung, customer
 * changed their mind before leaving, tender entered wrong. The product never
 * left the counter, so:
 *
 *   - the WHOLE sale reverses (no partial voids — a partial correction of a
 *     mistake is "void, then re-ring correctly"),
 *   - the cash goes back to the customer from the drawer,
 *   - inventory is restocked in full,
 *   - loyalty points earned by the sale are clawed back in full,
 *   - the order is CANCELLED through the S-15 reasoned-reversal lifecycle
 *     (completed → ready is the only legal reopen; then ready → cancelled),
 *     never deleted — the audit trail keeps everything.
 *
 * POLICY (encoded here so the register and server agree exactly):
 *   - manager/lead PIN approval required (same /api/pos/approve as B21/B24);
 *   - only TODAY's sales are voidable (same-business-day, Pacific): anything
 *     older is a customer return and belongs at the returns desk;
 *   - only PROCESSED sales are voidable (a queued/offline sale is simply
 *     removed from the queue — nothing durable exists yet);
 *   - a sale can be voided ONCE, and a sale with any prior partial return
 *     cannot be voided (money would double-refund) — returns desk instead;
 *   - a written reason (3–500 chars) is required and rides the audit.
 *
 * Money in MINOR UNITS (cents) throughout.
 */

/** Same Pacific-day convention as returns-core's pacificDaysBetween. */
function pacificDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export const VOID_REASON_MIN = 3;
export const VOID_REASON_MAX = 500;

/** Preset reasons shown on the register (free text always allowed). */
export const VOID_REASON_PRESETS = [
  "Wrong item rung up",
  "Customer changed mind before leaving",
  "Wrong quantity entered",
  "Duplicate ring-up",
  "Tender entered incorrectly",
] as const;

export type VoidEligibilityInput = {
  /** Order status right now (must be "completed"). */
  orderStatus: string;
  /** When the sale completed (ISO). */
  completedAtIso: string | null;
  /** "Now" on the server (ISO). */
  nowIso: string;
  /** Sum of quantities already returned on any line of this order. */
  priorReturnQuantity: number;
  /** True when a void of this order has already been recorded. */
  alreadyVoided: boolean;
};

export type VoidEligibilityVerdict = { ok: true } | { ok: false; errors: string[] };

/**
 * Every gate, evaluated together so the manager sees the complete picture
 * (matches evaluateReturnEligibility's contract).
 */
export function evaluateVoidEligibility(input: VoidEligibilityInput): VoidEligibilityVerdict {
  const errors: string[] = [];
  if (input.alreadyVoided) {
    errors.push("This sale has already been voided.");
  }
  if (input.orderStatus !== "completed") {
    errors.push(`Only COMPLETED sales can be voided (this order is "${input.orderStatus}").`);
  }
  if (input.priorReturnQuantity > 0) {
    errors.push(
      "Part of this sale was already returned at the returns desk — voiding now would refund the same items twice. Process the rest as a return instead.",
    );
  }
  if (!input.completedAtIso) {
    errors.push("The sale has no completion timestamp — void it from the back office instead.");
  } else if (pacificDay(input.completedAtIso) !== pacificDay(input.nowIso)) {
    errors.push(
      "Voids are same-day only (Pacific business day). For an earlier sale, use the returns desk — it handles the 15-day policy, restock/destroy, and CCRS corrections.",
    );
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export type VoidRequestInput = {
  reason: string;
  /** Manager approval from /api/pos/approve (employees.id). */
  approvedByEmployeeId: string;
};

export type VoidRequestVerdict = { ok: true; reason: string } | { ok: false; error: string };

/** Validate the manager's void request (reason + approval present). */
export function validateVoidRequest(input: VoidRequestInput): VoidRequestVerdict {
  const reason = input.reason.trim();
  if (reason.length < VOID_REASON_MIN) {
    return { ok: false, error: `Give a reason (at least ${VOID_REASON_MIN} characters) — it is logged to the audit trail.` };
  }
  if (reason.length > VOID_REASON_MAX) {
    return { ok: false, error: `Keep the reason under ${VOID_REASON_MAX} characters.` };
  }
  if (!input.approvedByEmployeeId.trim()) {
    return { ok: false, error: "A manager or lead must approve the void (PIN)." };
  }
  return { ok: true, reason };
}

/**
 * The cash to hand back: the exact order total the customer paid. Pure echo
 * with integer guards — the value comes from orders.total_minor_units, never
 * manual entry.
 */
export function voidRefundMinor(orderTotalMinor: number): { ok: true; refundMinor: number } | { ok: false; error: string } {
  if (!Number.isInteger(orderTotalMinor) || orderTotalMinor < 0) {
    return { ok: false, error: "Order total must be a non-negative integer (cents)." };
  }
  return { ok: true, refundMinor: orderTotalMinor };
}

// ---------------------------------------------------------------------------
// Void slip (the paper record that goes in the till with the cash movement)
// ---------------------------------------------------------------------------

export type VoidSlipInput = {
  /** 8-char receipt number of the voided sale. */
  receiptNumber: string;
  orderNumber: string;
  voidedAtIso: string;
  reason: string;
  approvedByName: string;
  processedByName: string;
  refundMinor: number;
  lines: { productName: string; quantity: number }[];
  headerText?: string | null;
  addressLines?: string[];
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

/**
 * Build the void slip HTML — same 576px PassPRNT family as the sale and
 * refund receipts so one print path handles all register paper.
 */
export function buildVoidSlipHtml(input: VoidSlipInput): string {
  const rows = input.lines.map((l) => `<tr><td class="n">${l.quantity}x ${esc(l.productName)}</td></tr>`);
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8">',
    '<meta name="format-detection" content="telephone=no">',
    "<style>",
    "body{width:576px;margin:0;padding:8px 4px;font-family:'Helvetica Neue',Arial,sans-serif;color:#000;}",
    "h1{font-size:34px;text-align:center;margin:0 0 4px;}",
    ".addr{font-size:22px;text-align:center;margin:0 0 2px;}",
    ".banner{font-size:26px;font-weight:bold;text-align:center;border:3px solid #000;padding:6px;margin:8px 0;}",
    ".sub{font-size:24px;text-align:center;margin:0 0 8px;}",
    "table{width:100%;border-collapse:collapse;font-size:26px;}",
    "td{padding:4px 0;vertical-align:top;}",
    "td.n{text-align:left;}",
    "tr.t td{font-size:32px;font-weight:bold;border-top:3px solid #000;padding-top:8px;}",
    ".meta{font-size:22px;margin:2px 0;}",
    "hr{border:none;border-top:2px dashed #000;margin:10px 0;}",
    "@media print{body{width:auto;}}",
    "</style></head><body>",
    `<h1>${esc((input.headerText ?? "GREENWAY MARIJUANA").trim())}</h1>`,
    ...(input.addressLines ?? [])
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `<p class="addr">${esc(l)}</p>`),
    '<p class="banner">SALE VOIDED</p>',
    `<p class="sub">Original receipt ${esc(input.receiptNumber)} &middot; Order ${esc(input.orderNumber)}</p>`,
    "<table><tbody>",
    ...rows,
    `<tr class="t"><td class="n">CASH RETURNED &nbsp; ${money(input.refundMinor)}</td></tr>`,
    "</tbody></table>",
    "<hr>",
    `<p class="meta">Reason: ${esc(input.reason)}</p>`,
    `<p class="meta">Approved by: ${esc(input.approvedByName)}</p>`,
    `<p class="meta">Processed by: ${esc(input.processedByName)}</p>`,
    `<p class="meta">${esc(new Date(input.voidedAtIso).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }))}</p>`,
    "</body></html>",
  ].join("");
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

export function __runVoidSaleCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  const NOW = "2026-02-10T20:00:00Z"; // 12:00 Pacific
  const SAME_DAY = "2026-02-10T17:00:00Z"; // 09:00 Pacific same day
  const YESTERDAY = "2026-02-09T20:00:00Z";

  // Happy path: completed today, no prior returns, not yet voided.
  const good = evaluateVoidEligibility({
    orderStatus: "completed",
    completedAtIso: SAME_DAY,
    nowIso: NOW,
    priorReturnQuantity: 0,
    alreadyVoided: false,
  });
  ok(good.ok, "same-day completed sale is voidable");

  // Yesterday's sale → returns desk.
  const old = evaluateVoidEligibility({
    orderStatus: "completed",
    completedAtIso: YESTERDAY,
    nowIso: NOW,
    priorReturnQuantity: 0,
    alreadyVoided: false,
  });
  ok(!old.ok && old.errors.some((e) => e.includes("same-day")), "prior-day sale refused → returns desk");

  // Pacific midnight boundary: 6:59 UTC is STILL the prior Pacific day (23:59
  // PST), 8:01 UTC is the next Pacific day (00:01 PST).
  const boundary = evaluateVoidEligibility({
    orderStatus: "completed",
    completedAtIso: "2026-02-10T06:59:00Z", // Feb 9, 22:59 Pacific
    nowIso: "2026-02-10T08:01:00Z", // Feb 10, 00:01 Pacific
    priorReturnQuantity: 0,
    alreadyVoided: false,
  });
  ok(!boundary.ok, "Pacific midnight rolls the business day (UTC date alone would allow)");

  // Already voided / partial return / wrong status: complete error list.
  const multi = evaluateVoidEligibility({
    orderStatus: "cancelled",
    completedAtIso: SAME_DAY,
    nowIso: NOW,
    priorReturnQuantity: 1,
    alreadyVoided: true,
  });
  ok(!multi.ok && multi.errors.length === 3, "all failing gates reported together");
  ok(!multi.ok && multi.errors.some((e) => e.includes("already been voided")), "double-void named");
  ok(!multi.ok && multi.errors.some((e) => e.includes("returned")), "prior partial return named");

  // Missing completion timestamp.
  const noTs = evaluateVoidEligibility({
    orderStatus: "completed",
    completedAtIso: null,
    nowIso: NOW,
    priorReturnQuantity: 0,
    alreadyVoided: false,
  });
  ok(!noTs.ok && noTs.errors.some((e) => e.includes("timestamp")), "missing completed_at refused");

  // Request validation.
  ok(validateVoidRequest({ reason: "Wrong item rung up", approvedByEmployeeId: "emp-1" }).ok, "valid request passes");
  ok(!validateVoidRequest({ reason: "x", approvedByEmployeeId: "emp-1" }).ok, "too-short reason refused");
  ok(!validateVoidRequest({ reason: "x".repeat(501), approvedByEmployeeId: "emp-1" }).ok, "over-long reason refused");
  ok(!validateVoidRequest({ reason: "Wrong item", approvedByEmployeeId: " " }).ok, "missing approver refused");
  const trimmed = validateVoidRequest({ reason: "  Duplicate ring-up  ", approvedByEmployeeId: "emp-1" });
  ok(trimmed.ok && trimmed.reason === "Duplicate ring-up", "reason trimmed");

  // Refund echo guards.
  const refund = voidRefundMinor(4550);
  ok(refund.ok && refund.refundMinor === 4550, "refund = exact order total");
  ok(!voidRefundMinor(45.5).ok, "fractional cents refused");
  ok(!voidRefundMinor(-1).ok, "negative total refused");
  ok(voidRefundMinor(0).ok, "zero-total order voidable (fully discounted sale)");

  // Slip: escapes HTML, shows money, both names, reason.
  const slip = buildVoidSlipHtml({
    receiptNumber: "AB12CD34",
    orderNumber: "GW-1042",
    voidedAtIso: NOW,
    reason: 'Wrong item <script>"x"</script>',
    approvedByName: "Casey M.",
    processedByName: "Jordan T.",
    refundMinor: 4550,
    lines: [{ productName: "Blue Dream 3.5g <b>", quantity: 2 }],
  });
  ok(slip.includes("SALE VOIDED"), "slip banner present");
  ok(slip.includes("$45.50"), "slip shows the cash returned");
  ok(!slip.includes("<script>") && slip.includes("&lt;script&gt;"), "reason HTML escaped");
  ok(!slip.includes("<b>"), "line name HTML escaped");
  ok(slip.includes("Casey M.") && slip.includes("Jordan T."), "both names printed");
  ok(slip.includes("AB12CD34") && slip.includes("GW-1042"), "receipt + order numbers printed");

  // Presets are all valid reasons.
  ok(
    VOID_REASON_PRESETS.every((r) => validateVoidRequest({ reason: r, approvedByEmployeeId: "e" }).ok),
    "every preset passes validation",
  );

  if (fail > 0) throw new Error(`void-sale-core self-tests: ${fail} FAILED (${pass} passed)`);
  console.log(`void-sale-core self-tests: ALL PASS (${pass} assertions)`);
}
