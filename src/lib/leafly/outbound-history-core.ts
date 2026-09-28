/**
 * src/lib/leafly/outbound-history-core.ts  (SLICE L-49)
 *
 * "What we sent Leafly, and what Leafly said" — the display and export rules
 * for rows of `public.leafly_outbound_attempts` (migration 0226).
 *
 * WHY: every Order-API call we make (acknowledge, status, cart, fetch, ID
 * images) is written to that table with its request and response bodies, and
 * until this slice NOTHING read them. The owner's five cart refusals on
 * 2026-09-28 each carried Leafly's reply `{"error":"Bad Request","status":400}`
 * in `response_body`, and the only way to see it was SQL.
 *
 * PRIVACY — the one rule this file exists to enforce:
 *   A 2xx reply to cart/status/fetch is a full Leafly `Order`, which carries
 *   firstName, lastName, emailAddress, phoneNumber, dateOfBirth and more
 *   (vendored spec, `Order` schema). So a reply body is shown or exported ONLY
 *   when the HTTP status is >= 400 (an error object, not an order), and even
 *   then it is scanned for customer-data key names and withheld if any appear.
 *   Request bodies are ours (cart: ids, quantities, prices; status: a status
 *   and a reason code) and are scanned the same way, belt and braces.
 *
 * Pure: no I/O, no clock. Self-tests at the bottom (house rule 5).
 */

import { explainLeaflyErrorBody } from "./order-ack-core";

/** The explicit column list read from the table. Never `select("*")`. */
export const OUTBOUND_HISTORY_COLUMNS =
  "attempted_at, leafly_order_id, operation, requested_status, cancelation_reason_code, response_status, disposition, refusal_code, message, request_body, response_body";

export type OutboundHistoryRow = {
  attempted_at: string | null;
  leafly_order_id: string | null;
  operation: string | null;
  requested_status: string | null;
  cancelation_reason_code: string | null;
  response_status: number | null;
  disposition: string | null;
  refusal_code: string | null;
  message: string | null;
  request_body: unknown;
  response_body: unknown;
};

/**
 * Customer-data key names, normalised (lowercase, separators stripped). Kept
 * here rather than imported from evidence-core so this core has one import
 * and cannot form a cycle; evidence-core imports THIS list for its JSON-cell
 * scan, so there is still exactly one copy.
 */
export const OUTBOUND_PII_KEY_NAMES: readonly string[] = [
  "firstname",
  "lastname",
  "emailaddress",
  "email",
  "phonenumber",
  "phone",
  "dateofbirth",
  "dob",
  "medicalcardnumber",
  "medicalcardstate",
  "medicalcardexpiration",
  "deliveryaddress",
  "address",
  "address1",
  "address2",
  "deliveryinstructions",
  "coordinates",
  "customername",
] as const;

function norm(k: string): string {
  return k.toLowerCase().replace(/[_\-\s]/g, "");
}

/**
 * Every object KEY anywhere inside `value` whose normalised name matches a
 * customer-data key. Walks arrays and objects; bounded depth so a hostile
 * body cannot recurse forever. Returns the offending keys (deduplicated).
 */
export function findPiiKeys(value: unknown, depth = 0): string[] {
  if (depth > 12 || value === null || typeof value !== "object") return [];
  const found = new Set<string>();
  if (Array.isArray(value)) {
    for (const v of value) for (const k of findPiiKeys(v, depth + 1)) found.add(k);
    return Array.from(found);
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = norm(k);
    if (OUTBOUND_PII_KEY_NAMES.some((bad) => n === bad || n.endsWith(bad))) found.add(k);
    for (const kk of findPiiKeys(v, depth + 1)) found.add(kk);
  }
  return Array.from(found);
}

const PRETTY_CAP = 4000;

function pretty(value: unknown): string {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
  } catch {
    s = String(value);
  }
  return s.length > PRETTY_CAP ? `${s.slice(0, PRETTY_CAP)}\n… (cut at ${PRETTY_CAP} characters)` : s;
}

export type OutboundHistoryDisplay = {
  when: string | null;
  operation: string;
  httpStatus: number | null;
  outcome: string;
  /** Leafly's own words, when its error body could be read. */
  leaflySaid: string | null;
  /** Our message recorded with the attempt. */
  message: string;
  /** Pretty request JSON, or a sentence saying why it is not shown. */
  sent: string;
  /** Pretty reply JSON (>= 400 only), or a sentence saying why it is not shown. */
  replied: string;
  /** True when `replied` is the actual body (so the UI can render it as code). */
  repliedIsBody: boolean;
  sentIsBody: boolean;
};

export const REPLY_2XX_HIDDEN =
  "Leafly returned the order (not shown here, because it contains the customer's details).";
export const REPLY_NONE = "No reply body was recorded.";
export const REQUEST_NONE = "Nothing was sent (refused on our side before calling Leafly), or no body is recorded for this call.";
export const BODY_PII_WITHHELD = "Withheld: this body contains customer-data fields.";

/** Plain label for an operation code. Unknown codes are shown verbatim, never guessed. */
export function outboundOperationLabel(op: string | null): string {
  switch ((op ?? "").trim()) {
    case "acknowledge":
      return "Acknowledge";
    case "status":
      return "Status change";
    case "cart":
      return "Change items";
    case "fetch_order":
      return "Fetch order";
    case "government_id":
      return "Government ID image";
    case "medical_id":
      return "Medical ID image";
    default:
      return (op ?? "").trim() || "(unknown)";
  }
}

function outcomeLabel(row: OutboundHistoryRow): string {
  if (row.refusal_code) return `Refused by us before sending (${row.refusal_code})`;
  switch (row.disposition) {
    case "success":
      return "Accepted by Leafly";
    case "fix_request":
      return "Refused by Leafly";
    case "fix_config":
      return "Refused: credentials/key problem";
    case "gone":
      return "Leafly has no such order";
    case "retry":
      return row.response_status === null ? "No answer from Leafly" : "Temporary failure";
    default:
      return row.disposition ?? "(not recorded)";
  }
}

/**
 * One attempt, made safe to render. The 2xx rule is the load-bearing line:
 * a success reply is an Order and is never rendered.
 */
export function summarizeOutboundAttemptForDisplay(row: OutboundHistoryRow): OutboundHistoryDisplay {
  const status = typeof row.response_status === "number" ? row.response_status : null;

  let replied: string;
  let repliedIsBody = false;
  if (row.response_body === null || row.response_body === undefined) {
    replied = REPLY_NONE;
  } else if (status === null || status < 400) {
    replied = REPLY_2XX_HIDDEN;
  } else if (findPiiKeys(row.response_body).length > 0) {
    replied = BODY_PII_WITHHELD;
  } else {
    replied = pretty(row.response_body);
    repliedIsBody = true;
  }

  let sent: string;
  let sentIsBody = false;
  if (row.request_body === null || row.request_body === undefined) {
    sent = REQUEST_NONE;
  } else if (findPiiKeys(row.request_body).length > 0) {
    sent = BODY_PII_WITHHELD;
  } else {
    sent = pretty(row.request_body);
    sentIsBody = true;
  }

  return {
    when: row.attempted_at ?? null,
    operation: outboundOperationLabel(row.operation),
    httpStatus: status,
    outcome: outcomeLabel(row),
    leaflySaid: status !== null && status >= 400 && repliedIsBody ? explainLeaflyErrorBody(row.response_body) : null,
    message: (row.message ?? "").trim() || "(no message recorded)",
    sent,
    replied,
    repliedIsBody,
    sentIsBody,
  };
}

/** The flat export row (evidence bundle "Order API calls" sheet). */
export type OutboundExportRow = {
  attemptedAt: string | null;
  operation: string | null;
  leaflyOrderId: string | null;
  requestedStatus: string | null;
  cancelationReasonCode: string | null;
  responseStatus: number | null;
  disposition: string | null;
  refusalCode: string | null;
  message: string | null;
  requestJson: string | null;
  responseJson: string | null;
};

function compactJson(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
  } catch {
    return null;
  }
}

/**
 * Export form. Request bodies only for cart/status (ours, no customer data);
 * reply bodies only for >= 400. Anything that still trips the PII scan is
 * replaced by the withheld sentence.
 */
export function toOutboundExportRow(row: OutboundHistoryRow): OutboundExportRow {
  const status = typeof row.response_status === "number" ? row.response_status : null;
  const op = (row.operation ?? "").trim();
  const reqAllowed = op === "cart" || op === "status";
  const req =
    reqAllowed && row.request_body != null
      ? findPiiKeys(row.request_body).length > 0
        ? BODY_PII_WITHHELD
        : compactJson(row.request_body)
      : null;
  const res =
    status !== null && status >= 400 && row.response_body != null
      ? findPiiKeys(row.response_body).length > 0
        ? BODY_PII_WITHHELD
        : compactJson(row.response_body)
      : null;
  return {
    attemptedAt: row.attempted_at ?? null,
    operation: row.operation ?? null,
    leaflyOrderId: row.leafly_order_id ?? null,
    requestedStatus: row.requested_status ?? null,
    cancelationReasonCode: row.cancelation_reason_code ?? null,
    responseStatus: status,
    disposition: row.disposition ?? null,
    refusalCode: row.refusal_code ?? null,
    message: row.message ?? null,
    requestJson: req,
    responseJson: res,
  };
}

/**
 * Scan serialized JSON cells for customer-data KEY names (as `"key":`).
 * Returns the offending key names. Used by the evidence bundle so a JSON
 * cell cannot smuggle PII past the column-key audit.
 */
export function findPiiKeysInJsonText(text: string | null | undefined): string[] {
  if (typeof text !== "string" || text === "") return [];
  const found = new Set<string>();
  const re = /"([^"\\]{1,80})"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = norm(m[1]!);
    if (OUTBOUND_PII_KEY_NAMES.some((bad) => n === bad || n.endsWith(bad))) found.add(m[1]!);
  }
  return Array.from(found);
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runOutboundHistoryTests(): { passed: number; failed: number } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else failures.push(label);
  };

  const base: OutboundHistoryRow = {
    attempted_at: "2026-09-28T19:59:00Z",
    leafly_order_id: "64dc8d35",
    operation: "cart",
    requested_status: null,
    cancelation_reason_code: null,
    response_status: 400,
    disposition: "fix_request",
    refusal_code: null,
    message: "Bad request",
    request_body: {
      cartItems: [{ id: "1b8e", integratorVariantId: "pos-e7f1-fb04", quantity: 1, packagePrice: 2500 }],
      taxes: [],
      deliveryFee: 0,
    },
    response_body: { error: "Bad Request", status: 400 },
  };

  // The owner's real 400 (2026-09-28) renders both bodies.
  const d = summarizeOutboundAttemptForDisplay(base);
  ok(d.repliedIsBody && d.replied.includes("Bad Request"), "a 400 reply body is shown");
  ok(d.sentIsBody && d.sent.includes("pos-e7f1-fb04"), "the request body is shown");
  ok(d.leaflySaid !== null && d.leaflySaid.includes("Bad Request"), "Leafly's words are extracted");
  ok(d.operation === "Change items", "cart is labelled");
  ok(d.outcome === "Refused by Leafly", "fix_request outcome label");

  // THE PRIVACY RULE: a 2xx reply (an Order) is never rendered.
  const order = { id: "o1", firstName: "Ann", lastName: "B", phoneNumber: "555", cartItems: [] };
  const ok200 = summarizeOutboundAttemptForDisplay({ ...base, response_status: 200, disposition: "success", response_body: order });
  ok(ok200.replied === REPLY_2XX_HIDDEN && !ok200.repliedIsBody, "a 2xx reply body is NEVER shown");
  ok(!ok200.replied.includes("Ann"), "no customer name leaks from a 2xx");
  ok(ok200.leaflySaid === null, "no quote on success");
  // A 204 with a body is still hidden.
  ok(summarizeOutboundAttemptForDisplay({ ...base, response_status: 204, response_body: { x: 1 } }).replied === REPLY_2XX_HIDDEN, "204 hidden");
  // Null status (network failure) with a body: hidden (not provably an error object).
  ok(summarizeOutboundAttemptForDisplay({ ...base, response_status: null, response_body: { x: 1 } }).replied === REPLY_2XX_HIDDEN, "unknown status hidden");
  // A 4xx body that nevertheless contains a customer key is withheld.
  const leaky = summarizeOutboundAttemptForDisplay({ ...base, response_body: { message: "bad", order: { emailAddress: "a@b" } } });
  ok(leaky.replied === BODY_PII_WITHHELD && !leaky.replied.includes("a@b"), "4xx body with PII keys is withheld");
  ok(summarizeOutboundAttemptForDisplay({ ...base, response_body: null }).replied === REPLY_NONE, "null reply sentence");
  ok(summarizeOutboundAttemptForDisplay({ ...base, request_body: null, refusal_code: "variant_not_at_leafly" }).sent === REQUEST_NONE, "local refusal: nothing sent");
  ok(summarizeOutboundAttemptForDisplay({ ...base, refusal_code: "x" }).outcome.includes("Refused by us"), "local refusal outcome");
  ok(summarizeOutboundAttemptForDisplay({ ...base, response_body: "x".repeat(9000) }).replied.length < 4100, "pretty is bounded");
  ok(outboundOperationLabel("weird") === "weird", "unknown op verbatim");

  // findPiiKeys
  ok(findPiiKeys({ a: [{ b: { date_of_birth: 1 } }] }).includes("date_of_birth"), "deep snake-case PII key found");
  ok(findPiiKeys({ customerPhoneNumber: 1 }).length === 1, "suffix match catches customerPhoneNumber");
  ok(findPiiKeys(base.request_body).length === 0, "cart request has no PII");
  ok(findPiiKeys({ error: "Bad Request", status: 400 }).length === 0, "gateway error has no PII");

  // Export
  const ex = toOutboundExportRow(base);
  ok(ex.requestJson !== null && ex.responseJson !== null, "cart 400: both bodies exported");
  const ex200 = toOutboundExportRow({ ...base, response_status: 200, response_body: order });
  ok(ex200.responseJson === null, "2xx reply never exported");
  const exFetch = toOutboundExportRow({ ...base, operation: "fetch_order", request_body: { anything: 1 } });
  ok(exFetch.requestJson === null, "only cart/status request bodies exported");
  ok(toOutboundExportRow({ ...base, response_body: { phone: "1" } }).responseJson === BODY_PII_WITHHELD, "export withholds PII reply");

  // JSON text scan
  ok(findPiiKeysInJsonText('{"firstName":"A"}').includes("firstName"), "json text scan finds firstName");
  ok(findPiiKeysInJsonText(ex.requestJson).length === 0, "exported cart request passes the scan");
  ok(findPiiKeysInJsonText(BODY_PII_WITHHELD).length === 0, "withheld sentence passes the scan");
  ok(findPiiKeysInJsonText(null).length === 0, "null passes");

  if (failures.length > 0) {
    throw new Error(`outbound-history-core self-test failed:\n  - ${failures.join("\n  - ")}`);
  }
  return { passed, failed: 0 };
}
