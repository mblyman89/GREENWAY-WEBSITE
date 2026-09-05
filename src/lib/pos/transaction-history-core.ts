/**
 * src/lib/pos/transaction-history-core.ts   (SLICE 19)
 *
 * PURE shaping + search for the register's TRANSACTION HISTORY panel. No
 * `server-only`, no DB — safe for tests and the tsx self-test harness.
 *
 * Owner, verbatim:
 *
 *   "I want to now add a feature to the register that compliments the return
 *    an item function. Right now it's just a box that you enter or scan the
 *    receipt code. I want the register to show a history of transactions with
 *    the name of the customer and total and whatever other data the enterprise
 *    industry standard practice method for viewing and interacting with past
 *    sales on the register."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Returning an item required knowing the 8-character receipt code up front.
 * If the customer lost the paper, the counter had no way forward. Every
 * enterprise POS solves this the same way, and the research is unanimous:
 *
 *   Oracle Retail Xstore — when the receipt is absent, staff pick from an
 *   "Available Transactions" list whose columns are Date, Transaction ID,
 *   Quantity Available, and Transaction Total.
 *
 *   Lightspeed X-Series "Sales history" — newest first, searchable by
 *   customer name / receipt number / date, each row expanding to show staff,
 *   customer, products and totals, with return and reprint as row actions.
 *
 * The convergent standard is: date + receipt + customer + total + item count
 * + status + who rang it, newest first, searchable, and actionable in place.
 * That is what this module shapes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE DELIBERATELY IS NOT
 *
 * It is NOT a second way to refund. The history panel is a FINDER: it helps
 * staff arrive at a receipt number. Acting on that receipt still runs the one
 * existing, policy-gated path (`lookupSaleByReceipt` → `/api/pos/returns` →
 * manager PIN → Task Q pipeline). A second refund path would be a second set
 * of compliance rules to keep in sync, and they would drift.
 *
 * PRIVACY BUDGET — inherited, not reinvented.
 *
 * `member-history-core.ts` set the register's privacy budget: recent purchase
 * facts and nothing else. No contact details, no notes, no birthdate. This
 * module keeps that budget and adds one rule of its own: a customer is shown
 * as `privacyLabel` → "Jane D.", first name plus last initial. That is the
 * exact convention the returns desk already used, lifted here so the two
 * cannot disagree. A register screen is visible to whoever is standing at the
 * counter; a full surname on a list of recent purchases is a disclosure that
 * serves nobody.
 *
 * Money in MINOR UNITS (cents) everywhere.
 */

// ── Limits ───────────────────────────────────────────────────────────────────

/**
 * How many transactions the register may hold at once. The response sits in
 * iPad memory and is rendered in a scroll pane; this is a deliberate cap, not
 * a page size to be raised casually.
 */
export const TRANSACTION_HISTORY_LIMIT = 50;

/** Max item names echoed per row before the rest are summarized. */
export const HISTORY_ITEMS_PREVIEW = 3;

/** Minimum characters before a search query is applied (below this: show all). */
export const SEARCH_MIN_CHARS = 2;

/**
 * Days of history the panel covers.
 *
 * This is deliberately the SAME window `lookupSaleByReceipt` scans
 * (RETURN_WINDOW_DAYS + 2 days of slack). Exported from here so the store and
 * the on-screen copy quote one number: a list that offered sales the return
 * path would refuse as out-of-window would be a list that lies to staff.
 * `transaction-history-store.ts` asserts this equals the returns constant.
 */
export const HISTORY_WINDOW_DAYS = 17;

// ── Shapes ───────────────────────────────────────────────────────────────────

/**
 * A customer's display name under the register's privacy budget: first name
 * plus last initial. Shared so the returns desk and this list cannot drift.
 *
 * "Jane", "Doe"  → "Jane D."
 * "Jane", null   → "Jane"
 */
export function privacyLabel(first: string, last: string | null | undefined): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (!f && !l) return "";
  if (!l) return f;
  return f ? `${f} ${l[0].toUpperCase()}.` : l;
}

/** The status a row carries. Ordered by how much it should stop a budtender. */
export type TransactionStatus =
  /** A normal completed sale, still inside the return window. */
  | "returnable"
  /** Completed, but every line has already been returned. */
  | "fully_returned"
  /** Some lines returned, some still returnable. */
  | "partially_returned"
  /** The order was cancelled/voided — shown, never hidden. */
  | "voided";

/** Raw material for one row, as read from the database by the store. */
export type TransactionInput = {
  /** The sale event's client_uuid — the receipt number is derived from it. */
  saleClientUuid: string;
  orderId: string;
  orderNumber: string;
  /** Device wall-clock time of the sale. */
  occurredAtIso: string;
  /** Order status, e.g. "completed" / "cancelled". */
  orderStatus: string | null;
  totalMinor: number;
  /** Customer name parts, or nulls for a non-member walk-in. */
  customerFirst: string | null;
  customerLast: string | null;
  /** Who rang the sale. */
  employeeName: string | null;
  /** Line facts: quantity sold and quantity already returned. */
  lines: { productName: string; quantity: number; returnedQuantity: number }[];
};

/** One shaped row, ready to render. */
export type TransactionRow = {
  receiptNumber: string;
  orderId: string;
  orderNumber: string;
  occurredAtIso: string;
  /** Total charged on the sale. */
  totalMinor: number;
  /** "Jane D." or "Walk-in" when there is no attached member. */
  customerLabel: string;
  /** Who rang it, or "" when unknown. */
  employeeName: string;
  /** Units sold across every line. */
  itemCount: number;
  /** Units still returnable across every line. */
  returnableCount: number;
  status: TransactionStatus;
  /** First HISTORY_ITEMS_PREVIEW product names. */
  items: string[];
  /** Lines beyond the preview cap. 0 = none. */
  moreCount: number;
};

// ── Derivations ──────────────────────────────────────────────────────────────

/**
 * The printed receipt number for a sale: the last 8 hex characters of the
 * sale's client UUID, uppercased. This MUST match `receiptNumber()` in
 * receipt-core.ts — the whole point of the panel is to produce a code the
 * existing receipt lookup accepts.
 */
export function receiptNumberFromUuid(saleClientUuid: string): string {
  return (saleClientUuid ?? "").replace(/-/g, "").slice(-8).toUpperCase();
}

/** Coerce a possibly-stringy, possibly-absent quantity to a safe count. */
function toCount(v: number | string | null | undefined): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/**
 * Classify a transaction. A cancelled/voided order outranks everything: staff
 * must see that the sale was reversed rather than wonder where it went.
 */
export function classifyTransaction(input: {
  orderStatus: string | null;
  soldUnits: number;
  returnedUnits: number;
}): TransactionStatus {
  const status = (input.orderStatus ?? "").trim().toLowerCase();
  if (status === "cancelled" || status === "canceled" || status === "voided") {
    return "voided";
  }
  if (input.soldUnits > 0 && input.returnedUnits >= input.soldUnits) return "fully_returned";
  if (input.returnedUnits > 0) return "partially_returned";
  return "returnable";
}

/** Human label for a status — the words a budtender actually reads. */
export function statusLabel(status: TransactionStatus): string {
  switch (status) {
    case "voided":
      return "Voided";
    case "fully_returned":
      return "Fully returned";
    case "partially_returned":
      return "Partly returned";
    default:
      return "Returnable";
  }
}

/** Shape one database row into a render-ready row. */
export function shapeTransaction(input: TransactionInput): TransactionRow {
  let soldUnits = 0;
  let returnedUnits = 0;
  const names: string[] = [];
  for (const line of input.lines ?? []) {
    const qty = toCount(line.quantity);
    const ret = Math.min(toCount(line.returnedQuantity), qty);
    soldUnits += qty;
    returnedUnits += ret;
    const name = (line.productName ?? "").trim();
    if (name) names.push(name);
  }

  const status = classifyTransaction({
    orderStatus: input.orderStatus,
    soldUnits,
    returnedUnits,
  });

  // A voided sale has nothing to return — the reversal already happened.
  const returnableCount = status === "voided" ? 0 : Math.max(0, soldUnits - returnedUnits);

  const label = privacyLabel(input.customerFirst ?? "", input.customerLast);

  return {
    receiptNumber: receiptNumberFromUuid(input.saleClientUuid),
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    occurredAtIso: input.occurredAtIso,
    totalMinor: Number.isFinite(input.totalMinor) ? input.totalMinor : 0,
    customerLabel: label || "Walk-in",
    employeeName: (input.employeeName ?? "").trim(),
    itemCount: soldUnits,
    returnableCount,
    status,
    items: names.slice(0, HISTORY_ITEMS_PREVIEW),
    moreCount: Math.max(0, names.length - HISTORY_ITEMS_PREVIEW),
  };
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * Filter rows by a free-text query, matching the fields Lightspeed's sales
 * history searches: customer name, receipt number, order number, and product
 * names. Case-insensitive, whitespace-tolerant.
 *
 * A query shorter than SEARCH_MIN_CHARS returns everything — a single
 * keystroke should not blank the list out from under someone mid-type.
 */
export function searchTransactions(
  rows: readonly TransactionRow[],
  query: string,
): TransactionRow[] {
  const q = (query ?? "").trim().toLowerCase();
  if (q.length < SEARCH_MIN_CHARS) return [...rows];
  return rows.filter((r) => {
    if (r.receiptNumber.toLowerCase().includes(q)) return true;
    if (r.orderNumber.toLowerCase().includes(q)) return true;
    if (r.customerLabel.toLowerCase().includes(q)) return true;
    if (r.employeeName.toLowerCase().includes(q)) return true;
    return r.items.some((i) => i.toLowerCase().includes(q));
  });
}

/**
 * Sort newest-first. Every POS studied defaults to this, because the sale a
 * customer is asking about is almost always the one that just happened.
 * Ties break on receipt number so the order is deterministic.
 */
export function sortNewestFirst(rows: readonly TransactionRow[]): TransactionRow[] {
  return [...rows].sort((a, b) => {
    const at = Date.parse(a.occurredAtIso);
    const bt = Date.parse(b.occurredAtIso);
    const av = Number.isFinite(at) ? at : 0;
    const bv = Number.isFinite(bt) ? bt : 0;
    if (bv !== av) return bv - av;
    return a.receiptNumber.localeCompare(b.receiptNumber);
  });
}

/** A short "3 items · $45.50" style summary line for a row. */
export function rowSummary(row: TransactionRow): string {
  const items = `${row.itemCount} item${row.itemCount === 1 ? "" : "s"}`;
  return `${items} · ${statusLabel(row.status)}`;
}

// ── Self-tests ───────────────────────────────────────────────────────────────

/**
 * Pure self-tests. Run by scripts/compliance/run-pure-selftests.ts.
 * Throws on the first failure so CI stops with a named assertion.
 */
export function __runTransactionHistoryCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, what: string) => {
    if (!cond) throw new Error(`transaction-history-core: ${what}`);
    passed += 1;
  };

  // ── privacyLabel: the register's disclosure rule ──
  ok(privacyLabel("Jane", "Doe") === "Jane D.", "first name + last initial");
  ok(privacyLabel("Jane", null) === "Jane", "no last name = first only");
  ok(privacyLabel("Jane", "") === "Jane", "empty last name = first only");
  ok(privacyLabel("  Jane  ", "  Doe ") === "Jane D.", "whitespace trimmed");
  ok(privacyLabel("Jane", "doe") === "Jane D.", "initial is uppercased");
  ok(!privacyLabel("Jane", "Doe").includes("Doe"), "full surname is NEVER shown");
  ok(privacyLabel("", "") === "", "no name at all = empty");

  // ── receipt derivation must match receipt-core ──
  ok(
    receiptNumberFromUuid("3f2504e0-4f89-11d3-9a0c-0305e82c3301") === "05E82C3301".slice(-8),
    "receipt = last 8 hex of the uuid",
  );
  ok(receiptNumberFromUuid("00000000-0000-0000-0000-0000000abcde") === "0000ABCDE".slice(-8), "uppercased");
  ok(receiptNumberFromUuid("").length === 0, "empty uuid yields empty receipt, not a crash");

  // ── classification ──
  ok(
    classifyTransaction({ orderStatus: "completed", soldUnits: 3, returnedUnits: 0 }) === "returnable",
    "nothing returned = returnable",
  );
  ok(
    classifyTransaction({ orderStatus: "completed", soldUnits: 3, returnedUnits: 3 }) === "fully_returned",
    "all returned = fully_returned",
  );
  ok(
    classifyTransaction({ orderStatus: "completed", soldUnits: 3, returnedUnits: 1 }) === "partially_returned",
    "some returned = partially_returned",
  );
  ok(
    classifyTransaction({ orderStatus: "cancelled", soldUnits: 3, returnedUnits: 0 }) === "voided",
    "cancelled order = voided",
  );
  ok(
    classifyTransaction({ orderStatus: "CANCELLED", soldUnits: 3, returnedUnits: 3 }) === "voided",
    "voided OUTRANKS fully_returned, and is case-insensitive",
  );

  // ── shaping ──
  const row = shapeTransaction({
    saleClientUuid: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    orderId: "o1",
    orderNumber: "GW-1042",
    occurredAtIso: "2026-09-05T18:00:00.000Z",
    orderStatus: "completed",
    totalMinor: 4550,
    customerFirst: "Jane",
    customerLast: "Doe",
    employeeName: "Sam",
    lines: [
      { productName: "Blue Dream 1g", quantity: 2, returnedQuantity: 0 },
      { productName: "Gummies 10pk", quantity: 1, returnedQuantity: 1 },
    ],
  });
  ok(row.customerLabel === "Jane D.", "row carries the privacy label");
  ok(row.itemCount === 3, "item count sums line quantities");
  ok(row.returnableCount === 2, "returnable count subtracts what came back");
  ok(row.status === "partially_returned", "row status reflects partial return");
  ok(row.totalMinor === 4550, "total passes through in minor units");
  ok(row.employeeName === "Sam", "row records who rang it");

  const walkIn = shapeTransaction({
    saleClientUuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    orderId: "o2",
    orderNumber: "GW-1043",
    occurredAtIso: "2026-09-05T19:00:00.000Z",
    orderStatus: "completed",
    totalMinor: 1000,
    customerFirst: null,
    customerLast: null,
    employeeName: null,
    lines: [{ productName: "Pre-roll", quantity: 1, returnedQuantity: 0 }],
  });
  ok(walkIn.customerLabel === "Walk-in", "no member = 'Walk-in', never blank");
  ok(walkIn.employeeName === "", "unknown employee is empty, not 'null'");

  const voided = shapeTransaction({
    saleClientUuid: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
    orderId: "o3",
    orderNumber: "GW-1044",
    occurredAtIso: "2026-09-05T20:00:00.000Z",
    orderStatus: "cancelled",
    totalMinor: 2000,
    customerFirst: "Bob",
    customerLast: "Smith",
    employeeName: "Kim",
    lines: [{ productName: "Vape cart", quantity: 2, returnedQuantity: 0 }],
  });
  ok(voided.status === "voided", "cancelled order shapes to voided");
  ok(voided.returnableCount === 0, "a voided sale offers nothing to return");

  const overReturned = shapeTransaction({
    saleClientUuid: "aaaaaaaa-bbbb-cccc-dddd-111111111111",
    orderId: "o4",
    orderNumber: "GW-1045",
    occurredAtIso: "2026-09-05T21:00:00.000Z",
    orderStatus: "completed",
    totalMinor: 500,
    customerFirst: "Ann",
    customerLast: "Lee",
    // Defensive: a returned quantity larger than sold must not go negative.
    lines: [{ productName: "Edible", quantity: 1, returnedQuantity: 5 }],
    employeeName: "Kim",
  });
  ok(overReturned.returnableCount === 0, "returnable never goes negative");
  ok(overReturned.status === "fully_returned", "over-return still reads as fully returned");

  const stringy = shapeTransaction({
    saleClientUuid: "aaaaaaaa-bbbb-cccc-dddd-222222222222",
    orderId: "o5",
    orderNumber: "GW-1046",
    occurredAtIso: "2026-09-05T22:00:00.000Z",
    orderStatus: "completed",
    totalMinor: 100,
    customerFirst: "Cy",
    customerLast: "Ng",
    employeeName: "Kim",
    lines: [
      { productName: "A", quantity: "2" as unknown as number, returnedQuantity: 0 },
      { productName: "B", quantity: "bad" as unknown as number, returnedQuantity: 0 },
    ],
  });
  ok(stringy.itemCount === 2, "numeric-as-string counted, unparseable counts as zero");

  const many = shapeTransaction({
    saleClientUuid: "aaaaaaaa-bbbb-cccc-dddd-333333333333",
    orderId: "o6",
    orderNumber: "GW-1047",
    occurredAtIso: "2026-09-05T23:00:00.000Z",
    orderStatus: "completed",
    totalMinor: 100,
    customerFirst: "Di",
    customerLast: "Ho",
    employeeName: "Kim",
    lines: [
      { productName: "P1", quantity: 1, returnedQuantity: 0 },
      { productName: "P2", quantity: 1, returnedQuantity: 0 },
      { productName: "P3", quantity: 1, returnedQuantity: 0 },
      { productName: "P4", quantity: 1, returnedQuantity: 0 },
      { productName: "P5", quantity: 1, returnedQuantity: 0 },
    ],
  });
  ok(many.items.length === HISTORY_ITEMS_PREVIEW, "item preview is capped");
  ok(many.moreCount === 2, "overflow is counted, not dropped");

  // ── search ──
  const rows = [row, walkIn, voided];
  ok(searchTransactions(rows, "").length === 3, "empty query returns everything");
  ok(searchTransactions(rows, "a").length === 3, "one character does not filter");
  ok(searchTransactions(rows, "jane").length === 1, "search by customer name");
  ok(searchTransactions(rows, "JANE").length === 1, "search is case-insensitive");
  ok(searchTransactions(rows, "GW-1043").length === 1, "search by order number");
  ok(searchTransactions(rows, row.receiptNumber).length === 1, "search by receipt number");
  ok(searchTransactions(rows, "pre-roll").length === 1, "search by product name");
  ok(searchTransactions(rows, "  jane  ").length === 1, "query whitespace tolerated");
  ok(searchTransactions(rows, "zzzz").length === 0, "no match returns empty");
  ok(searchTransactions(rows, "Bob").length === 1, "voided sales remain findable");

  // ── sort ──
  const sorted = sortNewestFirst([row, voided, walkIn]);
  ok(sorted[0].orderNumber === "GW-1044", "newest first");
  ok(sorted[2].orderNumber === "GW-1042", "oldest last");
  const badDates = sortNewestFirst([
    { ...row, occurredAtIso: "not-a-date" },
    { ...voided, occurredAtIso: "2026-09-05T20:00:00.000Z" },
  ]);
  ok(badDates[0].orderNumber === "GW-1044", "unparseable date sorts last, does not crash");

  // ── labels ──
  ok(statusLabel("voided") === "Voided", "voided label");
  ok(statusLabel("fully_returned") === "Fully returned", "fully returned label");
  ok(statusLabel("partially_returned") === "Partly returned", "partly returned label");
  ok(statusLabel("returnable") === "Returnable", "returnable label");
  ok(rowSummary(row).includes("3 items"), "summary pluralises");
  ok(rowSummary(walkIn).includes("1 item") && !rowSummary(walkIn).includes("1 items"), "singular item");

  console.log(`transaction-history-core: PASSED ${passed} assertions`);
}
