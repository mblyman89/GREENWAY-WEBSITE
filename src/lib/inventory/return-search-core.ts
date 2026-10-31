/**
 * src/lib/inventory/return-search-core.ts  (slice R-RET, owner message 10)
 *
 * PURE: how the back-office customer-return search reads what staff type.
 *
 * WHY. The owner, verbatim: "the back office keeps saying "⚠ No completed
 * sales matched. Only completed orders can be returned."" for a sale rung on
 * the register a few minutes earlier.
 *
 * The search only looked at orders.order_number / customer_first_name /
 * customer_last_name / customer_phone. A register sale is saved as
 * customer "Walk-in" with no phone (src/lib/pos/sync-store.ts orderInsertRow),
 * and its GWY- order number is never printed. What IS printed is the 8-character
 * receipt number (last 8 hex of the sale's client UUID, receipt-core.ts
 * receiptNumber) and, when the pool is on, a fun name (orders.display_name).
 * A loyalty member's name lives on public.customers (orders.customer_id), not
 * on the order. So nothing on the paper in the customer's hand could be found.
 *
 * This module decides, from the raw text, which lookups to run:
 *   - receipt   : 8 hex characters (spaces/dashes allowed, "#" allowed) ->
 *                 the register sale whose client UUID ends with them;
 *   - order #   : GWY-XXXXXX (with or without the dash) -> exact order number;
 *   - text      : always (order #, fun name, names, phone on the order);
 *   - member    : loyalty member first/last name (one or two words);
 *   - phone     : 7+ digits -> phone on the order (digits only, any format).
 * It also writes the "nothing found" message so it tells staff what to type.
 */

import { normalizeReceiptNumber } from "@/lib/pos/returns-core";

export interface ReturnSearchPlan {
  /** The trimmed input. */
  raw: string;
  /** 8 uppercase hex chars when the input can be a printed receipt number. */
  receipt: string | null;
  /** "GWY-XXXXXX" when the input looks like an order number. */
  orderNumber: string | null;
  /** Free-text term for the ilike search (null when too short). */
  text: string | null;
  /** Loyalty member name parts: one word -> first OR last; two -> first AND last. */
  member: { first: string; last: string | null } | null;
  /** Digits for a phone search when 7+ digits were typed. */
  phoneDigits: string | null;
}

/** Order numbers come from 0007: "GWY-" + 6 chars of an unambiguous alphabet. */
const ORDER_NUMBER_RE = /^#?\s*GWY-?\s*([A-Z0-9]{6})$/i;

/** Build the lookup plan for what staff typed. Never throws. */
export function planReturnSearch(input: unknown): ReturnSearchPlan {
  const raw = typeof input === "string" ? input.trim() : "";
  const empty: ReturnSearchPlan = { raw, receipt: null, orderNumber: null, text: null, member: null, phoneDigits: null };
  if (raw.length < 2) return empty;

  // Receipt: the printed code is 8 hex characters. Staff may type "#1417 400A"
  // or scan the QR. Only treat it as a receipt when the input has nothing but
  // hex, spaces, dashes or a leading "#" -- so a name like "Dead Beef" (8 hex
  // letters plus a space) is still tried as a receipt AND as a name, while
  // "Abe" never is.
  const receiptish = /^#?[0-9a-f\s-]+$/i.test(raw);
  const receipt = receiptish ? normalizeReceiptNumber(raw.replace(/^#/, "")) : null;

  const om = ORDER_NUMBER_RE.exec(raw);
  const orderNumber = om ? `GWY-${om[1].toUpperCase()}` : null;

  const digits = raw.replace(/\D/g, "");
  const phoneDigits = digits.length >= 7 && /^[\d\s().+-]+$/.test(raw) ? digits : null;

  // Member names: letters, apostrophes, hyphens and spaces only.
  let member: ReturnSearchPlan["member"] = null;
  if (/^[\p{L}' -]+$/u.test(raw)) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length === 1 && words[0].length >= 2) member = { first: words[0], last: null };
    else if (words.length >= 2) member = { first: words[0], last: words.slice(1).join(" ") };
  }

  return { raw, receipt, orderNumber, text: raw, member, phoneDigits };
}

/** Phone match on digits only: "(555) 123-4567", "555.123.4567" and "+1 555 123 4567" are the same number. */
export function phoneDigitsMatch(stored: string | null | undefined, digits: string): boolean {
  if (!stored || !digits) return false;
  return stored.replace(/\D/g, "").endsWith(digits.length > 10 ? digits.slice(-10) : digits);
}

/** The message for an empty result: what was tried, and what to type instead. */
export function noMatchMessage(plan: ReturnSearchPlan, extra?: { receiptFoundButNotCompleted?: string | null }): string {
  if (extra?.receiptFoundButNotCompleted) {
    return (
      `Receipt ${plan.receipt} was found, but that sale is "${extra.receiptFoundButNotCompleted}", not completed, ` +
      "so it cannot be returned yet. Check Registers -> Sync exceptions for it."
    );
  }
  const tried: string[] = [];
  if (plan.receipt) tried.push(`receipt number ${plan.receipt}`);
  if (plan.orderNumber) tried.push(`order ${plan.orderNumber}`);
  tried.push(`"${plan.raw}" in order numbers, fun receipt names, customer names and phones`);
  if (plan.member) tried.push("loyalty member names");
  return (
    `No completed sale matched (searched ${tried.join("; ")}). ` +
    "Type the 8-character receipt number printed on the receipt (for example 1A2B3C4D), the fun name on the receipt, " +
    "the GWY- order number, or the loyalty member's name or phone. Register sales are saved as \"Walk-in\" unless a member was attached."
  );
}

// ---------------------------------------------------------------------------
// Self-tests (PURE)
// ---------------------------------------------------------------------------

export function __runReturnSearchCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log("FAIL:", msg);
    }
  };

  // Receipt numbers, the way they are printed and typed.
  ok(planReturnSearch("1A2B3C4D").receipt === "1A2B3C4D", "printed receipt number");
  ok(planReturnSearch("1a2b 3c4d").receipt === "1A2B3C4D", "lowercase with a space");
  ok(planReturnSearch("#1A2B-3C4D").receipt === "1A2B3C4D", "leading # and a dash");
  ok(planReturnSearch("1A2B3C4").receipt === null, "7 chars is not a receipt");
  ok(planReturnSearch("1A2B3C4D5").receipt === null, "9 chars is not a receipt");
  ok(planReturnSearch("Purple Otter").receipt === null, "fun name is not a receipt");
  ok(planReturnSearch("GWY-4F9C2A").receipt === null, "order number is not a receipt");
  ok(planReturnSearch("Dead Beef").receipt === "DEADBEEF", "hex-only words are tried as a receipt");
  ok(planReturnSearch("Dead Beef").member?.first === "Dead", "... and as a name");

  // Order numbers.
  ok(planReturnSearch("GWY-4F9C2A").orderNumber === "GWY-4F9C2A", "order number");
  ok(planReturnSearch("gwy4f9c2a").orderNumber === "GWY-4F9C2A", "order number without dash, lowercase");
  ok(planReturnSearch("#GWY-4F9C2A").orderNumber === "GWY-4F9C2A", "order number with #");
  ok(planReturnSearch("GWY-4F9C2").orderNumber === null, "short order number refused");

  // Names.
  const one = planReturnSearch("Lyman");
  ok(one.member?.first === "Lyman" && one.member.last === null, "one word -> first or last");
  const two = planReturnSearch("Michael  Lyman");
  ok(two.member?.first === "Michael" && two.member.last === "Lyman", "two words -> first and last");
  const three = planReturnSearch("Mary Ann O'Neil-Smith");
  ok(three.member?.first === "Mary" && three.member.last === "Ann O'Neil-Smith", "apostrophes, hyphens, 3 words");
  ok(planReturnSearch("José").member?.first === "José", "accented names");
  ok(planReturnSearch("GWY-4F9C2A").member === null, "order number is not a name");
  ok(planReturnSearch("555-123-4567").member === null, "phone is not a name");

  // Phones.
  ok(planReturnSearch("(555) 123-4567").phoneDigits === "5551234567", "formatted phone");
  ok(planReturnSearch("123-4567").phoneDigits === "1234567", "7-digit phone");
  ok(planReturnSearch("12345").phoneDigits === null, "5 digits is not a phone");
  ok(planReturnSearch("1A2B3C4D").phoneDigits === null, "receipt is not a phone");
  ok(phoneDigitsMatch("+1 (555) 123-4567", "5551234567"), "stored with country code matches");
  ok(phoneDigitsMatch("555.123.4567", "1234567"), "last 7 digits match");
  ok(!phoneDigitsMatch("555.123.4567", "9999999"), "different phone does not match");
  ok(!phoneDigitsMatch(null, "5551234567"), "no stored phone");

  // Text is always searched; empty and 1-char input searches nothing.
  ok(planReturnSearch("Purple Otter").text === "Purple Otter", "fun name searched as text");
  ok(planReturnSearch(" x ").text === null && planReturnSearch(" x ").receipt === null, "1 char -> nothing");
  ok(planReturnSearch(null).text === null, "non-string -> nothing");
  ok(planReturnSearch(42).raw === "", "number input -> empty raw");

  // The empty-result message says what to type.
  const msg = noMatchMessage(planReturnSearch("1A2B3C4D"));
  ok(msg.includes("receipt number 1A2B3C4D"), "message says the receipt was tried");
  ok(msg.includes("8-character receipt number"), "message says what to type");
  ok(msg.includes("Walk-in"), "message explains Walk-in");
  ok(!msg.includes("Only completed orders can be returned."), "old dead-end sentence is gone");
  const notDone = noMatchMessage(planReturnSearch("1A2B3C4D"), { receiptFoundButNotCompleted: "ready" });
  ok(notDone.includes("\"ready\"") && notDone.includes("Sync exceptions"), "found-but-not-completed says why and where");
  ok(noMatchMessage(planReturnSearch("Lyman")).includes("loyalty member names"), "member search listed");

  console.log(`return-search-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
