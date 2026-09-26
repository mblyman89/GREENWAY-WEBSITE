/**
 * Leafly webhook body parsing — PURE core (Slice L-5)
 * =========================================================================
 *
 * Turns the raw string Leafly POSTs to us into a typed, checked shape — or into
 * a clear refusal. This module runs AFTER signature verification, so the bytes
 * are authentic; what it guards against is not forgery but SURPRISE: a field
 * Leafly added, a status this build has never seen, a null where we expected a
 * string.
 *
 * ── THE RULE THAT SHAPES EVERYTHING HERE ────────────────────────────────────
 * Leafly's spec, verbatim:
 *
 *   "Unless Leafly's outbound HMAC keys fails your validation, webhook requests
 *    should only be responded to with status codes 200 or 201. These webhook
 *    events are not the place to apply business rules or validations on the
 *    order lifecycle."
 *
 * So parsing must FAIL SOFT, and that is the opposite of the usual instinct. A
 * missing field is not grounds for a 400. Returning 4xx makes Leafly retry and
 * then auto-cancel a real customer's order — punishing the shopper for a schema
 * disagreement between two computers. Every function here therefore returns a
 * verdict with `problems` attached, and the route records the problems and
 * answers 200 anyway.
 *
 * `usable` is the one distinction that matters operationally: it means "we
 * extracted enough to act on this", not "this was perfect".
 *
 * ── WHAT IS REQUIRED, PER THE SPEC ──────────────────────────────────────────
 * `.components.schemas.OrderWebhook.required` = [eventTime, eventType, orderId,
 * orderIntegrationKey], and `OrderSubmissionWebhook` adds `acknowledgeBy`.
 * The integration activation/deactivation webhooks use a DIFFERENT schema and
 * carry no orderId at all — which is why `parseLeaflyWebhook` takes the expected
 * event and does not demand an order id when one is not due.
 *
 * PURITY (house rule 5): no imports, no I/O, no clock.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Leafly's EventType enum, verbatim. */
export const LEAFLY_WEBHOOK_EVENT_TYPES = [
  "order_activate",
  "order_deactivate",
  "order_submit",
  "order_preview",
  "order_cancel",
  "order_status",
] as const;
export type LeaflyWebhookEventType = (typeof LEAFLY_WEBHOOK_EVENT_TYPES)[number];

/**
 * The two events that carry no order.
 *
 * Per the spec these use `IntegrationActivationWebhook` /
 * `IntegrationDeactivationWebhook`, not `OrderWebhook`. Demanding an `orderId`
 * here would reject a perfectly valid Leafly delivery.
 */
export const LEAFLY_EVENTS_WITHOUT_AN_ORDER = ["order_activate", "order_deactivate"] as const;

/**
 * The only event carrying `acknowledgeBy`.
 * `OrderSubmissionWebhook` adds it as required; no other webhook schema has it.
 */
export const LEAFLY_EVENTS_WITH_ACK_DEADLINE = ["order_submit"] as const;

/** Fields `OrderWebhook` marks required, verbatim. */
export const LEAFLY_ORDER_WEBHOOK_REQUIRED_FIELDS = [
  "eventTime",
  "eventType",
  "orderId",
  "orderIntegrationKey",
] as const;

/**
 * Cap on recorded problems per payload.
 *
 * A malformed body could otherwise generate unbounded strings that get written
 * to the database inside a webhook handler. Same reasoning as
 * LEAFLY_RECONCILE_ISSUES_PER_CODE in the L-4 read-back core.
 */
export const LEAFLY_WEBHOOK_MAX_PROBLEMS = 12;

export type WebhookProblemSeverity = "error" | "warning" | "info";

export type WebhookProblem = {
  code: string;
  severity: WebhookProblemSeverity;
  message: string;
};

export type ParsedLeaflyWebhook = {
  /** Did we extract enough to act on? */
  usable: boolean;
  eventType: LeaflyWebhookEventType | null;
  /** The event type exactly as it arrived, even if unrecognised. */
  rawEventType: string | null;
  orderId: string | null;
  orderIntegrationKey: string | null;
  eventTime: string | null;
  /** Only ever populated for order_submit. Leafly's own deadline. */
  acknowledgeBy: string | null;
  /** Leafly's status, when the event carries one. */
  status: string | null;
  cancelationReasonCode: string | null;
  problems: WebhookProblem[];
  /** The parsed object, for storage. Null when the body was not JSON. */
  body: Record<string, unknown> | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isLeaflyWebhookEventType(v: unknown): v is LeaflyWebhookEventType {
  return typeof v === "string" && (LEAFLY_WEBHOOK_EVENT_TYPES as readonly string[]).includes(v);
}

export function leaflyEventCarriesAnOrder(event: string): boolean {
  return (
    isLeaflyWebhookEventType(event) &&
    !(LEAFLY_EVENTS_WITHOUT_AN_ORDER as readonly string[]).includes(event)
  );
}

export function leaflyEventCarriesAckDeadline(event: string): boolean {
  return (LEAFLY_EVENTS_WITH_ACK_DEADLINE as readonly string[]).includes(event);
}

/**
 * Read a string field, treating blanks as absent.
 *
 * Leafly sending `""` for an order id is not meaningfully different from
 * omitting it, and collapsing the two here keeps every caller from having to
 * check both.
 */
function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Is this a plain JSON object (and not an array or null)?
 * `typeof null === "object"` and arrays are objects too, so both need excluding.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Leafly webhook body.
 *
 * `expectedEvent` is the event the ROUTE serves — each of the six events has its
 * own URL, so the route knows what it should be receiving. Passing it lets us
 * detect a mismatch between the URL Leafly used and the eventType in the body,
 * which would mean their webhook destinations are misconfigured. That is a real
 * and quiet failure mode: the orders would keep arriving, at the wrong handler.
 *
 * NEVER THROWS. A webhook route must be able to answer 200.
 */
export function parseLeaflyWebhook(
  rawBody: string,
  expectedEvent: LeaflyWebhookEventType | null,
): ParsedLeaflyWebhook {
  const problems: WebhookProblem[] = [];
  const addProblem = (code: string, severity: WebhookProblemSeverity, message: string) => {
    if (problems.length >= LEAFLY_WEBHOOK_MAX_PROBLEMS) return;
    problems.push({ code, severity, message });
  };

  const empty: ParsedLeaflyWebhook = {
    usable: false,
    eventType: null,
    rawEventType: null,
    orderId: null,
    orderIntegrationKey: null,
    eventTime: null,
    acknowledgeBy: null,
    status: null,
    cancelationReasonCode: null,
    problems,
    body: null,
  };

  if (typeof rawBody !== "string" || rawBody.trim() === "") {
    addProblem(
      "empty_body",
      "error",
      "The webhook body was empty. All six Leafly webhooks declare a required request body.",
    );
    return empty;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    addProblem(
      "unparseable_body",
      "error",
      "The webhook body was not valid JSON, so nothing could be read from it. The raw body is retained in the event log for inspection.",
    );
    return empty;
  }

  if (!isPlainObject(parsed)) {
    addProblem(
      "body_not_an_object",
      "error",
      `The webhook body parsed as ${Array.isArray(parsed) ? "an array" : typeof parsed} rather than a JSON object.`,
    );
    return empty;
  }

  const body = parsed;
  const rawEventType = readString(body, "eventType");
  const eventType = isLeaflyWebhookEventType(rawEventType) ? rawEventType : null;

  if (rawEventType === null) {
    addProblem(
      "missing_event_type",
      "error",
      'Leafly marks "eventType" required on every order webhook, but it was absent.',
    );
  } else if (eventType === null) {
    addProblem(
      "unknown_event_type",
      "error",
      `"${rawEventType}" is not in Leafly's published EventType enum. Recorded verbatim, not translated. If Leafly has added an event, the vendored spec needs re-downloading.`,
    );
  } else if (expectedEvent !== null && eventType !== expectedEvent) {
    // Warning, not error: the delivery is authentic and readable, it just came
    // to the wrong door. We still process it — refusing would lose a real order
    // over a configuration detail.
    addProblem(
      "event_type_mismatch",
      "warning",
      `This endpoint serves "${expectedEvent}" but the body says "${eventType}". The webhook destination URLs configured at Leafly may be crossed. Processed anyway, because the delivery is authentic and dropping it would lose a real order.`,
    );
  }

  const orderIntegrationKey = readString(body, "orderIntegrationKey");
  if (orderIntegrationKey === null) {
    addProblem(
      "missing_order_integration_key",
      "warning",
      'Leafly marks "orderIntegrationKey" required. It identifies which retailer the event is for, so its absence matters for a multi-store integration.',
    );
  }

  const eventTime = readString(body, "eventTime");
  if (eventTime === null) {
    addProblem(
      "missing_event_time",
      "warning",
      'Leafly marks "eventTime" required. Without it we cannot tell an original delivery from a retry.',
    );
  } else if (Number.isNaN(Date.parse(eventTime))) {
    addProblem(
      "unparseable_event_time",
      "warning",
      `"eventTime" ("${eventTime}") is not a readable date-time. Leafly declares it as format: date-time.`,
    );
  }

  // Order id: required only for the four order-bearing events.
  const orderId = readString(body, "orderId");
  const shouldHaveOrder = eventType === null ? true : leaflyEventCarriesAnOrder(eventType);
  if (orderId === null && shouldHaveOrder) {
    addProblem(
      "missing_order_id",
      "error",
      'Leafly marks "orderId" required on order webhooks, but it was absent. Without it the event cannot be attached to an order.',
    );
  }
  if (orderId !== null && eventType !== null && !leaflyEventCarriesAnOrder(eventType)) {
    addProblem(
      "unexpected_order_id",
      "info",
      `"${eventType}" is an integration-level event that Leafly's schema gives no orderId, yet one was present. Recorded, but not relied upon.`,
    );
  }

  // acknowledgeBy: only on order_submit, where it is REQUIRED and load-bearing.
  let acknowledgeBy = readString(body, "acknowledgeBy");
  if (eventType !== null && leaflyEventCarriesAckDeadline(eventType)) {
    if (acknowledgeBy === null) {
      addProblem(
        "missing_acknowledge_by",
        "error",
        'Leafly marks "acknowledgeBy" required on the order submission webhook. It is Leafly\'s own deadline, and without it we cannot show staff how long they have. Do NOT compute it locally — acknowledge the order immediately instead.',
      );
    } else if (Number.isNaN(Date.parse(acknowledgeBy))) {
      addProblem(
        "unparseable_acknowledge_by",
        "error",
        `"acknowledgeBy" ("${acknowledgeBy}") is not a readable date-time, so the acknowledgement deadline is unknown. Acknowledge immediately.`,
      );
    }
  } else if (acknowledgeBy !== null) {
    addProblem(
      "unexpected_acknowledge_by",
      "info",
      `"acknowledgeBy" appeared on a "${eventType ?? "unknown"}" event; Leafly's schema only defines it for order_submit. Ignored.`,
    );
    // Deliberately discarded: keeping it would let a deadline from the wrong
    // schema drive the acknowledgement clock.
    acknowledgeBy = null;
  }

  // Status: present on order_status, and on an Order body inside other events.
  // Read from the top level, then from a nested `status`/`order` object, because
  // the status webhook nests a StatusChange.
  let status = readString(body, "status");
  let cancelationReasonCode = readString(body, "cancelationReasonCode");

  const nestedCandidates = ["statusChange", "order", "status"];
  for (const key of nestedCandidates) {
    const nested = body[key];
    if (!isPlainObject(nested)) continue;
    if (status === null) status = readString(nested, "status");
    if (cancelationReasonCode === null) {
      cancelationReasonCode = readString(nested, "cancelationReasonCode");
    }
  }

  // SLICE L-34. Leafly's OrderCancelWebhook (the vendored spec,
  // docs/leafly-specs/order-api-v1.openapi.json, md5 daab7bcf...) names this
  // field `cancelReason`, and marks it REQUIRED — it is not
  // `cancelationReasonCode`, which is the name used on the Order object and
  // on the status-change body. Before L-34 only the latter was read, so the
  // one webhook that says WHY an order was cancelled (including
  // "order_api_unacknowledged", i.e. we missed the fifteen-minute deadline)
  // had its reason silently dropped. Read as a fallback so an explicit
  // cancelationReasonCode, if both ever appear, still wins.
  if (cancelationReasonCode === null) {
    cancelationReasonCode = readString(body, "cancelReason");
  }

  const hasFatal = problems.some((p) => p.severity === "error");

  return {
    // Usable means: we know what event this is, and we have an order id if one
    // was due. Warnings do not make a payload unusable — that is the whole
    // point of failing soft.
    usable: !hasFatal && eventType !== null && (!shouldHaveOrder || orderId !== null),
    eventType,
    rawEventType,
    orderId,
    orderIntegrationKey,
    eventTime,
    acknowledgeBy,
    status,
    cancelationReasonCode,
    problems,
    body,
  };
}

/**
 * One-line summary for the event log.
 * Separated from parsing so the wording can be tested independently.
 */
export function describeParsedWebhook(parsed: ParsedLeaflyWebhook): string {
  if (!parsed.usable && parsed.body === null) {
    return "Unreadable webhook body — recorded for inspection, acknowledged to Leafly so it will not retry.";
  }
  const what = parsed.eventType ?? parsed.rawEventType ?? "unknown event";
  const who = parsed.orderId ? ` for order ${parsed.orderId}` : "";
  const errors = parsed.problems.filter((p) => p.severity === "error").length;
  const warnings = parsed.problems.filter((p) => p.severity === "warning").length;
  if (errors === 0 && warnings === 0) return `${what}${who} — read cleanly.`;
  const bits: string[] = [];
  if (errors > 0) bits.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings > 0) bits.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  return `${what}${who} — ${bits.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// Self-tests (house rule 5)
// ---------------------------------------------------------------------------

/**
 * May this webhook write its body into `leafly_orders.raw_order`?
 *
 * ONLY `order_submit`. Found by the Online Orders report audit: 14 of 23
 * Leafly orders had no readable total.
 *
 * `raw_order` is the ONLY copy of the real Order we will ever have — the spec
 * says Leafly serves an order "only ... while live, or within twenty four
 * hours of reaching a terminal state". It reaches us in two steps: the
 * `order_submit` envelope is stored first, then `collectLeaflyOrder()`
 * replaces it with the full Order (cart, totals, customer).
 *
 * The upsert used to store EVERY order webhook's body. An `order_status` or
 * `order_cancel` envelope is four or five fields (eventTime, eventType,
 * orderId, orderIntegrationKey, + status / cancelReason) and nothing re-collects
 * after it, so the first status change after collection silently replaced the
 * full Order with the envelope. Every figure that reads the payload then went
 * blank: the report's order value, the detail view, the receipt reprint, the
 * register's Leafly line rebuild.
 *
 * The facts those envelopes DO carry (status, cancel reason, canceled_at) are
 * still written to their own columns, so nothing a status webhook knows is
 * lost by not storing its body. `order_submit` keeps writing, because on the
 * first delivery `raw_order` is empty and the envelope is the placeholder
 * `collectLeaflyOrder` then replaces (and `classifyDetailPayload` recognises it
 * as "never fetched" so the Collect button still appears).
 */
export function webhookMayWriteRawOrder(eventType: string | null | undefined): boolean {
  return eventType === "order_submit";
}

export function __runLeaflyWebhookParseTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[leafly-webhook-parse-core] FAIL: ${label}`);
    }
  };

  // -- Vocabulary ----------------------------------------------------------
  ok(LEAFLY_WEBHOOK_EVENT_TYPES.length === 6, "there are exactly six webhook events");
  ok(LEAFLY_EVENTS_WITHOUT_AN_ORDER.length === 2, "exactly two events carry no order");
  ok(
    LEAFLY_EVENTS_WITH_ACK_DEADLINE.length === 1 &&
      LEAFLY_EVENTS_WITH_ACK_DEADLINE[0] === "order_submit",
    "only order_submit carries an acknowledgement deadline",
  );
  ok(
    LEAFLY_ORDER_WEBHOOK_REQUIRED_FIELDS.length === 4,
    "OrderWebhook declares four required fields",
  );

  ok(isLeaflyWebhookEventType("order_submit"), "order_submit is a known event");
  ok(!isLeaflyWebhookEventType("order_shipped"), "an invented event is not known");
  ok(!isLeaflyWebhookEventType(null), "null is not an event");
  ok(!isLeaflyWebhookEventType(""), "empty string is not an event");

  ok(leaflyEventCarriesAnOrder("order_submit"), "order_submit carries an order");
  ok(leaflyEventCarriesAnOrder("order_status"), "order_status carries an order");
  ok(!leaflyEventCarriesAnOrder("order_activate"), "order_activate carries no order");
  ok(!leaflyEventCarriesAnOrder("order_deactivate"), "order_deactivate carries no order");
  ok(leaflyEventCarriesAckDeadline("order_submit"), "order_submit has the ack deadline");
  ok(!leaflyEventCarriesAckDeadline("order_cancel"), "order_cancel does not");

  // -- The happy path ------------------------------------------------------
  const submit = JSON.stringify({
    eventTime: "2026-09-17T12:00:00Z",
    eventType: "order_submit",
    orderId: "11111111-2222-3333-4444-555555555555",
    orderIntegrationKey: "gw-key",
    acknowledgeBy: "2026-09-17T12:15:00Z",
  });
  const good = parseLeaflyWebhook(submit, "order_submit");
  ok(good.usable, "a well-formed submission parses as usable");
  ok(good.eventType === "order_submit", "the event type is read");
  ok(good.orderId === "11111111-2222-3333-4444-555555555555", "the order id is read");
  ok(good.orderIntegrationKey === "gw-key", "the retailer key is read");
  ok(good.acknowledgeBy === "2026-09-17T12:15:00Z", "Leafly's own deadline is preserved verbatim");
  ok(good.problems.length === 0, "and there are no problems");
  ok(good.body !== null, "the parsed body is returned for storage");

  // -- Fails soft on everything -------------------------------------------
  const emptyBody = parseLeaflyWebhook("", "order_submit");
  ok(!emptyBody.usable, "an empty body is unusable");
  ok(emptyBody.problems.some((p) => p.code === "empty_body"), "and says why");
  ok(emptyBody.body === null, "with no body to store");

  const garbage = parseLeaflyWebhook("{not json", "order_submit");
  ok(!garbage.usable, "unparseable JSON is unusable");
  ok(
    garbage.problems.some((p) => p.code === "unparseable_body" && p.severity === "error"),
    "and is reported as an error",
  );

  for (const notObject of ["[]", '"a string"', "42", "null", "true"]) {
    const r = parseLeaflyWebhook(notObject, "order_submit");
    ok(!r.usable, `${notObject} is not a usable webhook body`);
    ok(
      r.problems.some((p) => p.code === "body_not_an_object" || p.code === "unparseable_body"),
      `${notObject} is reported as the wrong shape`,
    );
  }

  const noEvent = parseLeaflyWebhook(JSON.stringify({ orderId: "x" }), "order_submit");
  ok(!noEvent.usable, "a body with no eventType is unusable");
  ok(noEvent.problems.some((p) => p.code === "missing_event_type"), "and says so");

  const badEvent = parseLeaflyWebhook(
    JSON.stringify({ eventType: "order_teleport", orderId: "x" }),
    "order_submit",
  );
  ok(!badEvent.usable, "an unknown event type is unusable");
  ok(badEvent.rawEventType === "order_teleport", "but the raw value is preserved for the log");
  ok(badEvent.eventType === null, "and is not coerced into a known event");
  ok(
    badEvent.problems.some((p) => p.code === "unknown_event_type"),
    "and is reported as unknown",
  );

  // -- The crossed-wires case ---------------------------------------------
  const crossed = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_cancel",
      orderId: "abc",
      orderIntegrationKey: "k",
      eventTime: "2026-09-17T12:00:00Z",
    }),
    "order_submit",
  );
  ok(
    crossed.problems.some((p) => p.code === "event_type_mismatch"),
    "a body/URL event mismatch is detected",
  );
  ok(
    crossed.problems.find((p) => p.code === "event_type_mismatch")?.severity === "warning",
    "and is a WARNING, not an error — the order must still be processed",
  );
  ok(crossed.usable, "a crossed delivery is still usable (never dropped)");

  // -- Order id is required only when due ---------------------------------
  const activate = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_activate",
      orderIntegrationKey: "k",
      eventTime: "2026-09-17T12:00:00Z",
    }),
    "order_activate",
  );
  ok(
    activate.usable,
    "an activation webhook with NO orderId is usable — its schema has no orderId",
  );
  ok(
    !activate.problems.some((p) => p.code === "missing_order_id"),
    "and is not faulted for the absence",
  );

  const submitNoOrder = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_submit",
      orderIntegrationKey: "k",
      eventTime: "2026-09-17T12:00:00Z",
      acknowledgeBy: "2026-09-17T12:15:00Z",
    }),
    "order_submit",
  );
  ok(!submitNoOrder.usable, "a submission WITHOUT an orderId is unusable");
  ok(
    submitNoOrder.problems.some((p) => p.code === "missing_order_id" && p.severity === "error"),
    "and that is an error",
  );

  const activateWithOrder = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_activate",
      orderId: "surprise",
      orderIntegrationKey: "k",
      eventTime: "2026-09-17T12:00:00Z",
    }),
    "order_activate",
  );
  ok(
    activateWithOrder.problems.some((p) => p.code === "unexpected_order_id"),
    "an unexpected orderId on an integration event is noted",
  );
  ok(
    activateWithOrder.problems.find((p) => p.code === "unexpected_order_id")?.severity === "info",
    "as info only — it is a curiosity, not a fault",
  );
  ok(activateWithOrder.usable, "and does not make the event unusable");

  // -- acknowledgeBy handling ---------------------------------------------
  const submitNoAck = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_submit",
      orderId: "abc",
      orderIntegrationKey: "k",
      eventTime: "2026-09-17T12:00:00Z",
    }),
    "order_submit",
  );
  ok(
    submitNoAck.problems.some((p) => p.code === "missing_acknowledge_by" && p.severity === "error"),
    "a submission with no acknowledgeBy is an ERROR (it is required and load-bearing)",
  );
  ok(submitNoAck.acknowledgeBy === null, "and no deadline is invented");
  ok(
    // `=== true` rather than a bare optional chain: `?.includes(...)` is
    // `boolean | undefined`, and `undefined` is falsy, so a MISSING problem
    // would read as a failed assertion for the wrong reason -- it would look
    // like "the wording is wrong" when the truth is "the problem was never
    // raised". Being explicit keeps the two failures distinguishable.
    submitNoAck.problems
      .find((p) => p.code === "missing_acknowledge_by")
      ?.message.includes("Do NOT compute it locally") === true,
    "and the message warns against computing one locally",
  );

  const badAck = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_submit",
      orderId: "abc",
      orderIntegrationKey: "k",
      eventTime: "2026-09-17T12:00:00Z",
      acknowledgeBy: "tomorrow-ish",
    }),
    "order_submit",
  );
  ok(
    badAck.problems.some((p) => p.code === "unparseable_acknowledge_by" && p.severity === "error"),
    "an unreadable acknowledgeBy is an error",
  );

  const cancelWithAck = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_cancel",
      orderId: "abc",
      orderIntegrationKey: "k",
      eventTime: "2026-09-17T12:00:00Z",
      acknowledgeBy: "2026-09-17T12:15:00Z",
    }),
    "order_cancel",
  );
  ok(
    cancelWithAck.acknowledgeBy === null,
    "acknowledgeBy on a non-submission event is DISCARDED, not used",
  );
  ok(
    cancelWithAck.problems.some((p) => p.code === "unexpected_acknowledge_by"),
    "and the anomaly is noted",
  );

  // -- Status extraction, flat and nested ---------------------------------
  const flatStatus = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_status",
      orderId: "abc",
      orderIntegrationKey: "k",
      eventTime: "2026-09-17T12:00:00Z",
      status: "ready",
    }),
    "order_status",
  );
  ok(flatStatus.status === "ready", "a top-level status is read");

  const nestedStatus = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_status",
      orderId: "abc",
      orderIntegrationKey: "k",
      eventTime: "2026-09-17T12:00:00Z",
      statusChange: { status: "canceled", cancelationReasonCode: "customer" },
    }),
    "order_status",
  );
  ok(nestedStatus.status === "canceled", "a nested status is read");
  ok(
    nestedStatus.cancelationReasonCode === "customer",
    "and the nested cancellation reason with it",
  );

  // SLICE L-34: the spec's own OrderCancelWebhook example, verbatim shape.
  const specCancel = parseLeaflyWebhook(
    JSON.stringify({
      // components.examples.OrderCancelWebhook, copied from the vendored spec.
      eventTime: "2023-08-11T21:47:34.492Z",
      eventType: "order_cancel",
      orderId: "e4dcae37-32d0-4498-ab3d-0c9a93c5f8ea",
      orderIntegrationKey: "iAYK0fC0rjQIGJQKIJvzRnObjElOC40PhLEK9PEUgFFm",
      cancelReason: "order_api_unacknowledged",
    }),
    "order_cancel",
  );
  ok(
    specCancel.cancelationReasonCode === "order_api_unacknowledged",
    "L-34: the spec's cancelReason field on order_cancel is read - it is the " +
      "only place Leafly says an order died because we did not acknowledge it",
  );
  ok(specCancel.status === null, "L-34: ...and the cancel webhook carries no status (spec)");
  const bothReasons = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_cancel",
      orderId: "abc",
      orderIntegrationKey: "k",
      eventTime: "2026-09-17T12:00:00Z",
      cancelReason: "dispensary",
      cancelationReasonCode: "customer",
    }),
    "order_cancel",
  );
  ok(
    bothReasons.cancelationReasonCode === "customer",
    "L-34: an explicit cancelationReasonCode still wins over cancelReason",
  );

  const orderNested = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_cancel",
      orderId: "abc",
      orderIntegrationKey: "k",
      eventTime: "2026-09-17T12:00:00Z",
      order: { status: "canceled" },
    }),
    "order_cancel",
  );
  ok(orderNested.status === "canceled", "a status nested under `order` is read");

  // A top-level status must win over a nested one.
  const both = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_status",
      orderId: "abc",
      orderIntegrationKey: "k",
      eventTime: "2026-09-17T12:00:00Z",
      status: "ready",
      statusChange: { status: "canceled" },
    }),
    "order_status",
  );
  ok(both.status === "ready", "the top-level status takes precedence over a nested one");

  // -- Blank-as-absent -----------------------------------------------------
  const blanks = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_submit",
      orderId: "   ",
      orderIntegrationKey: "",
      eventTime: "2026-09-17T12:00:00Z",
      acknowledgeBy: "2026-09-17T12:15:00Z",
    }),
    "order_submit",
  );
  ok(!blanks.usable, "a whitespace-only order id counts as missing");
  ok(blanks.orderId === null, "and is normalised to null");
  ok(
    blanks.problems.some((p) => p.code === "missing_order_integration_key"),
    "an empty retailer key is reported missing",
  );

  // Non-string types must not be coerced.
  const wrongTypes = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_submit",
      orderId: 12345,
      orderIntegrationKey: { nested: true },
      eventTime: ["array"],
      acknowledgeBy: "2026-09-17T12:15:00Z",
    }),
    "order_submit",
  );
  ok(wrongTypes.orderId === null, "a numeric orderId is not coerced to a string");
  ok(wrongTypes.orderIntegrationKey === null, "an object retailer key is not coerced");
  ok(wrongTypes.eventTime === null, "an array eventTime is not coerced");
  ok(!wrongTypes.usable, "and the payload is unusable");

  // -- Date validation -----------------------------------------------------
  const badTime = parseLeaflyWebhook(
    JSON.stringify({
      eventType: "order_cancel",
      orderId: "abc",
      orderIntegrationKey: "k",
      eventTime: "the day before yesterday",
    }),
    "order_cancel",
  );
  ok(
    badTime.problems.some((p) => p.code === "unparseable_event_time"),
    "an unreadable eventTime is reported",
  );
  ok(
    badTime.usable,
    "but it does not make the payload unusable — it is a warning, so the order still lands",
  );

  // -- Problem cap ---------------------------------------------------------
  ok(LEAFLY_WEBHOOK_MAX_PROBLEMS === 12, "the problem cap is a stated constant");
  const kitchenSink = parseLeaflyWebhook(
    JSON.stringify({ eventType: "nope", acknowledgeBy: "junk", orderId: 1 }),
    "order_submit",
  );
  ok(
    kitchenSink.problems.length <= LEAFLY_WEBHOOK_MAX_PROBLEMS,
    "problems are capped so a hostile body cannot flood the log",
  );

  // -- Every event parses at all ------------------------------------------
  for (const ev of LEAFLY_WEBHOOK_EVENT_TYPES) {
    const payload: Record<string, unknown> = {
      eventType: ev,
      orderIntegrationKey: "k",
      eventTime: "2026-09-17T12:00:00Z",
    };
    if (leaflyEventCarriesAnOrder(ev)) payload.orderId = "abc";
    if (leaflyEventCarriesAckDeadline(ev)) payload.acknowledgeBy = "2026-09-17T12:15:00Z";
    const r = parseLeaflyWebhook(JSON.stringify(payload), ev);
    ok(r.usable, `a minimal valid ${ev} payload is usable`);
    ok(r.problems.length === 0, `a minimal valid ${ev} payload has no problems`);
  }

  // -- Descriptions --------------------------------------------------------
  ok(
    describeParsedWebhook(good).includes("read cleanly"),
    "a clean payload is described as clean",
  );
  ok(
    describeParsedWebhook(garbage).includes("Unreadable"),
    "an unreadable payload says so",
  );
  ok(
    describeParsedWebhook(good).includes("11111111-2222-3333-4444-555555555555"),
    "the description names the order",
  );
  ok(
    describeParsedWebhook(crossed).includes("warning"),
    "a warning is surfaced in the description",
  );
  ok(
    describeParsedWebhook(submitNoAck).includes("error"),
    "an error is surfaced in the description",
  );

  // -- Never throws --------------------------------------------------------
  let threw = false;
  const hostile = [
    "",
    "   ",
    "{",
    "[]",
    "null",
    '{"eventType":null}',
    '{"eventType":{"a":1}}',
    JSON.stringify({ eventType: "order_submit", orderId: null }),
    '{"a":' + "1".repeat(500) + "}",
  ];
  for (const h of hostile) {
    for (const ev of [null, "order_submit" as LeaflyWebhookEventType]) {
      try {
        const r = parseLeaflyWebhook(h, ev);
        describeParsedWebhook(r);
      } catch {
        threw = true;
      }
    }
  }
  ok(!threw, "no hostile body makes the parser throw (a webhook route must answer 200)");

  // Deeply nested input must not blow the stack.
  let deepThrew = false;
  try {
    let deep: Record<string, unknown> = { eventType: "order_submit", orderId: "x" };
    for (let i = 0; i < 200; i += 1) deep = { nested: deep };
    parseLeaflyWebhook(JSON.stringify(deep), "order_submit");
  } catch {
    deepThrew = true;
  }
  ok(!deepThrew, "a deeply nested body does not throw");

  // -- raw_order is written only by order_submit (Online Orders audit) -----
  ok(webhookMayWriteRawOrder("order_submit"), "order_submit may store its body (placeholder until collected)");
  ok(!webhookMayWriteRawOrder("order_status"), "order_status must NOT overwrite the collected Order");
  ok(!webhookMayWriteRawOrder("order_cancel"), "order_cancel must NOT overwrite the collected Order");
  ok(!webhookMayWriteRawOrder("order_preview"), "order_preview must NOT write raw_order");
  ok(!webhookMayWriteRawOrder(null), "an unknown event must NOT write raw_order");
  ok(!webhookMayWriteRawOrder("ORDER_SUBMIT"), "the match is exact (Leafly's enum is lower-case)");

  return { passed, failed };
}
