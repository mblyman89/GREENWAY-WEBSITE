import "server-only";

/**
 * src/lib/pos/transaction-history-store.ts   (SLICE 19)
 *
 * The read side of the register's transaction history panel.
 *
 * Owner: "I want the register to show a history of transactions with the name
 * of the customer and total and whatever other data the enterprise industry
 * standard practice method for viewing and interacting with past sales."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT READS
 *
 * The same ledger the receipt lookup already trusts: processed `sale` events
 * in `pos_sale_events` that materialized an order. It then joins the orders,
 * their lines, prior returns, the attached customer and the employee who rang
 * it, and hands the raw facts to the pure `shapeTransaction`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE WINDOW MATCHES THE RETURN WINDOW
 *
 * `lookupSaleByReceipt` scans back LOOKUP_WINDOW_DAYS (RETURN_WINDOW_DAYS + 2).
 * This panel uses the SAME window on purpose. A list that showed sales the
 * return path would then refuse as out-of-window would be a list that lies:
 * staff would tap a row and get a policy rejection they could not have
 * predicted. Sharing the constant makes the two agree by construction rather
 * than by memory.
 *
 * READ-ONLY. This module writes nothing. Acting on a row still goes through
 * the existing `/api/pos/returns` path with its manager PIN and Task Q
 * pipeline — the panel only helps staff arrive at a receipt number.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { RETURN_WINDOW_DAYS } from "@/lib/pos/returns-core";
import {
  shapeTransaction,
  searchTransactions,
  SEARCH_MIN_CHARS,
  sortNewestFirst,
  TRANSACTION_HISTORY_LIMIT,
  type TransactionRow,
  type TransactionInput,
} from "@/lib/pos/transaction-history-core";

/**
 * Same window the receipt lookup uses (returns-store.ts): the return window
 * plus two days of slack, so a sale on the edge is still findable.
 *
 * Derived from RETURN_WINDOW_DAYS rather than restated, so changing the store
 * policy moves this automatically. HISTORY_WINDOW_DAYS is the copy the UI
 * quotes; the test suite asserts the two are equal, so a future change to the
 * return window cannot silently leave the on-screen number wrong.
 */
const LOOKUP_WINDOW_DAYS = RETURN_WINDOW_DAYS + 2;

/**
 * How many recent sale events to consider before shaping. The panel shows
 * TRANSACTION_HISTORY_LIMIT rows; scanning a wider slice first means a busy
 * day still surfaces the newest rows after voided/unmatched events drop out.
 */
const EVENT_SCAN_LIMIT = 400;

/**
 * How many events to scan when the user is SEARCHING rather than browsing.
 *
 * Browsing shows the newest 50 rows, so scanning 400 events is plenty. Search
 * is a different question — "find the sale for the customer who came in on
 * Tuesday" — and answering it from the newest 400 events silently reports
 * "Nothing matches" for a sale that is well inside the return window and
 * perfectly returnable. That is the worst kind of bug: a confident wrong
 * answer at the counter.
 *
 * The whole window is bounded anyway (LOOKUP_WINDOW_DAYS = 17), so this is a
 * safety ceiling rather than a page size. When it is hit we say so instead of
 * pretending the result is complete — see `scanTruncated`.
 */
const SEARCH_EVENT_SCAN_LIMIT = 5000;

export type TransactionHistoryResult =
  | {
      ok: true;
      transactions: TransactionRow[];
      /**
       * True when the event scan hit its ceiling, so older sales in the window
       * were never examined. The UI must say so rather than let "no results"
       * read as "this sale does not exist".
       */
      scanTruncated: boolean;
    }
  | { ok: false; error: string };

type EventRow = {
  client_uuid: string;
  order_id: string | null;
  occurred_at: string;
  employee_id: string | null;
};

type OrderRow = {
  id: string;
  order_number: string;
  status: string | null;
  customer_id: string | null;
  total_minor_units: number | null;
};

type LineRow = {
  id: string;
  order_id: string;
  product_name: string | null;
  quantity: number | string | null;
};

/**
 * Recent register transactions, newest first, shaped for the history panel.
 *
 * Every failure is reported honestly. An empty list means "no sales in the
 * window"; it never means "the read failed" — those are different answers and
 * a budtender deserves to know which one they are looking at.
 */
export async function listRecentTransactions(
  query?: string | null,
): Promise<TransactionHistoryResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database not configured — cannot load history." };
  }

  // A real search widens the scan across the whole return window; plain
  // browsing keeps the cheap newest-400 read. Short queries are not searches
  // (SEARCH_MIN_CHARS) — they must not trigger the expensive path.
  const q = (query ?? "").trim();
  const searching = q.length >= SEARCH_MIN_CHARS;
  const scanLimit = searching ? SEARCH_EVENT_SCAN_LIMIT : EVENT_SCAN_LIMIT;

  const admin = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - LOOKUP_WINDOW_DAYS * 86_400_000).toISOString();

  // ── The sale events, exactly as the receipt lookup selects them ───────────
  const { data: eventData, error: eventError } = await admin
    .from("pos_sale_events")
    .select("client_uuid, order_id, occurred_at, employee_id")
    .eq("event_type", "sale")
    .eq("status", "processed")
    .not("order_id", "is", null)
    .gte("occurred_at", cutoff)
    .order("occurred_at", { ascending: false })
    .limit(scanLimit);

  if (eventError) {
    return { ok: false, error: "Could not read the sales ledger — try again in a moment." };
  }
  const events = (eventData as EventRow[] | null) ?? [];
  // Hitting the ceiling exactly means there may be more we never looked at.
  const scanTruncated = events.length >= scanLimit;
  if (events.length === 0) {
    return { ok: true, transactions: [], scanTruncated: false };
  }

  const orderIds = Array.from(
    new Set(events.map((e) => e.order_id).filter((id): id is string => !!id)),
  );

  // ── Orders behind those events ───────────────────────────────────────────
  const { data: orderData, error: orderError } = await admin
    .from("orders")
    .select("id, order_number, status, customer_id, total_minor_units")
    .in("id", orderIds);
  if (orderError) {
    return { ok: false, error: "Could not read the orders behind these sales — try again." };
  }
  const orders = new Map<string, OrderRow>();
  for (const o of (orderData as OrderRow[] | null) ?? []) orders.set(o.id, o);

  // ── Lines, prior returns, customers and employees ────────────────────────
  const [
    { data: lineData, error: lineError },
    { data: returnData, error: returnError },
  ] = await Promise.all([
    admin.from("order_lines").select("id, order_id, product_name, quantity").in("order_id", orderIds),
    admin.from("customer_returns").select("order_line_id, quantity").in("order_id", orderIds),
  ]);
  if (lineError || returnError) {
    return { ok: false, error: "Could not read the items on these sales — try again." };
  }

  const returnedByLine = new Map<string, number>();
  for (const r of (returnData as { order_line_id: string | null; quantity: number | string | null }[] | null) ?? []) {
    if (!r.order_line_id) continue;
    const qty = Number(r.quantity ?? 0);
    returnedByLine.set(r.order_line_id, (returnedByLine.get(r.order_line_id) ?? 0) + (Number.isFinite(qty) ? qty : 0));
  }

  const linesByOrder = new Map<string, LineRow[]>();
  for (const l of (lineData as LineRow[] | null) ?? []) {
    const bucket = linesByOrder.get(l.order_id);
    if (bucket) bucket.push(l);
    else linesByOrder.set(l.order_id, [l]);
  }

  // Customer names for the attached members only. A read failure here must not
  // fail the whole panel: the rows are still useful, they just say "Walk-in".
  const customerIds = Array.from(
    new Set(
      orderIds
        .map((id) => orders.get(id)?.customer_id ?? null)
        .filter((id): id is string => !!id),
    ),
  );
  const customers = new Map<string, { first: string | null; last: string | null }>();
  if (customerIds.length > 0) {
    const { data: custData } = await admin
      .from("customers")
      .select("id, first_name, last_name")
      .in("id", customerIds);
    for (const c of (custData as { id: string; first_name: string | null; last_name: string | null }[] | null) ?? []) {
      customers.set(c.id, { first: c.first_name, last: c.last_name });
    }
  }

  const employeeIds = Array.from(
    new Set(events.map((e) => e.employee_id).filter((id): id is string => !!id)),
  );
  const employees = new Map<string, string>();
  if (employeeIds.length > 0) {
    // NOTE: `employees` stores a single `full_name` column (migration 0037),
    // NOT first_name/last_name like `customers`. Verified against the schema.
    const { data: empData } = await admin
      .from("employees")
      .select("id, full_name")
      .in("id", employeeIds);
    for (const e of (empData as { id: string; full_name: string | null }[] | null) ?? []) {
      const name = (e.full_name ?? "").trim();
      if (name) employees.set(e.id, name);
    }
  }

  // ── Shape ────────────────────────────────────────────────────────────────
  const rows: TransactionRow[] = [];
  for (const ev of events) {
    if (!ev.order_id) continue;
    const order = orders.get(ev.order_id);
    // An event whose order has been deleted is not a transaction anyone can
    // act on. Skipping is correct; inventing a placeholder row would not be.
    if (!order) continue;

    const cust = order.customer_id ? customers.get(order.customer_id) ?? null : null;
    const lines = (linesByOrder.get(order.id) ?? []).map((l) => ({
      productName: l.product_name ?? "",
      quantity: (l.quantity ?? 0) as number,
      returnedQuantity: returnedByLine.get(l.id) ?? 0,
    }));

    const input: TransactionInput = {
      saleClientUuid: ev.client_uuid,
      orderId: order.id,
      orderNumber: order.order_number,
      occurredAtIso: ev.occurred_at,
      orderStatus: order.status,
      totalMinor: Number(order.total_minor_units ?? 0),
      customerFirst: cust?.first ?? null,
      customerLast: cust?.last ?? null,
      employeeName: ev.employee_id ? employees.get(ev.employee_id) ?? null : null,
      lines,
    };
    rows.push(shapeTransaction(input));
  }

  // ORDER MATTERS. Filter FIRST, then cap.
  //
  // The old code capped at 50 and let the client filter what survived, so a
  // search only ever saw the newest 50 sales — roughly half a day at this
  // shop's volume. A customer from yesterday came back "Nothing matches" even
  // though the sale was returnable. Matching before the cap means the 50 rows
  // are the 50 newest MATCHES, which is what a person means by "search".
  const sorted = sortNewestFirst(rows);
  const matched = searching ? searchTransactions(sorted, q) : sorted;
  return {
    ok: true,
    transactions: matched.slice(0, TRANSACTION_HISTORY_LIMIT),
    scanTruncated,
  };
}
