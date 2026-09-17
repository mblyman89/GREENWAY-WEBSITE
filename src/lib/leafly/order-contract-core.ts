// Leafly Order API v1.0 — THE ORDER + COMMUNICATIONS CONTRACT.
//
// WHY THIS FILE EXISTS
// --------------------
// Slice L-1 proved that a prose document cannot hold a contract: `docs/leafly-menu-api-v2.md`
// claimed "camelCase for all fields", which was false, and eight field defects descended from
// that one sentence. A markdown file cannot fail CI. A constant with a test can.
//
// This file applies the same treatment to the ORDER side, and in particular to the one rule
// that is the easiest to break by accident and the most expensive to break in public:
//
//   > "Leafly will be the sole originator of automated consumer facing communications related
//   >  to orders placed on the Leafly platform. That is, Leafly shoppers should receive _no_
//   >  automated emails or text messages from a partner system with regard to order
//   >  confirmation, status updates, etc."
//   >    — Leafly Order API v1.0, info.description
//   >      (docs/leafly-specs/order-api-v1.openapi.json)
//
// That rule is invisible in code. Greenway already has a working order-confirmation email
// pipeline (`src/lib/orders/notify-*`). The moment slice L-5 lands the `order_submit` webhook,
// the path of least resistance is to reuse that pipeline verbatim — at which point a Leafly
// shopper gets TWO confirmation emails (one from Leafly, one from us), Greenway is in breach
// of the integration agreement, and nothing in CI says a word about it.
//
// So the rule is encoded here as data, and `tests/compliance/leafly-order-contract.test.ts`
// asserts it against the vendored spec. The suppression is audience-scoped, not blanket:
// STAFF alerts must still fire, because the staff alert is the thing that stops a customer
// standing at the counter next to an order nobody knew about.
//
// This module is PURE (no DB, no network, no "server-only"): it is the vocabulary, not the
// handler. Slices L-5 and L-6 implement the webhooks against these constants.
//
// Ground truth: docs/leafly-specs/order-api-v1.openapi.json (see docs/leafly-specs/SOURCES.md)

/* ------------------------------------------------------------------------- *
 * 1. Webhook events, and the paths the owner approved
 * ------------------------------------------------------------------------- */

/**
 * The six webhook events Leafly can send us, named EXACTLY as Leafly's `EventType` enum
 * spells them. The owner approved all six (Q3: "yes, all 6 endpoints please").
 */
export const LEAFLY_ORDER_EVENT_TYPES = [
  "order_activate",
  "order_deactivate",
  "order_submit",
  "order_preview",
  "order_cancel",
  "order_status",
] as const;

export type LeaflyOrderEventType = (typeof LEAFLY_ORDER_EVENT_TYPES)[number];

/**
 * Event -> the route path Greenway will serve it on. Approved verbatim by the owner
 * (Q2: "I approve all paths as recommended").
 *
 * One route per event on purpose. A single fan-out handler would have to branch on a body
 * field to decide its own response shape, and `order_preview` is the odd one out: it is the
 * ONLY event that must return a populated JSON body. Separate routes also keep the
 * latency-critical preview off the same cold-start path as the fire-and-forget events.
 */
export const LEAFLY_ORDER_WEBHOOK_PATHS = {
  order_activate: "/api/webhooks/leafly/order-activate",
  order_deactivate: "/api/webhooks/leafly/order-deactivate",
  order_submit: "/api/webhooks/leafly/order-submit",
  order_preview: "/api/webhooks/leafly/order-preview",
  order_cancel: "/api/webhooks/leafly/order-cancel",
  order_status: "/api/webhooks/leafly/order-status",
} as const satisfies Record<LeaflyOrderEventType, string>;

/**
 * Which events Leafly REQUIRES for production graduation, per the requirement table in
 * `info.description`. Recommended/optional events are still built (owner chose all six),
 * but the distinction matters when triaging a failure: a broken `order_submit` blocks
 * certification, a broken `order_activate` does not.
 */
export const LEAFLY_REQUIRED_ORDER_EVENTS = ["order_submit", "order_cancel"] as const;

/**
 * `order_preview` is the ONLY webhook that answers with a meaningful body; every other
 * webhook answers 200 with an empty body. Getting this backwards is a silent defect —
 * an empty preview response means the shopper sees stale prices at checkout.
 */
export const LEAFLY_ORDER_EVENTS_RETURNING_A_BODY = ["order_preview"] as const;

/**
 * Accepted response codes for a webhook. From the spec: "Unless Leafly's outbound HMAC keys
 * fails your validation, webhook requests should only be responded to with status codes 200
 * or 201. These webhook events are not the place to apply business rules or validations on
 * the order lifecycle."
 *
 * This is the trap: the instinct is to return 4xx when a cart line looks wrong. Doing so
 * makes Leafly retry and then auto-cancel the customer's order. Business complaints belong
 * in the order record and the staff alert, NOT in the HTTP status.
 */
export const LEAFLY_WEBHOOK_OK_STATUS_CODES = [200, 201] as const;

/* ------------------------------------------------------------------------- *
 * 2. Order lifecycle vocabulary
 * ------------------------------------------------------------------------- */

/** Leafly's `OrderStatus` enum, in lifecycle order. */
export const LEAFLY_ORDER_STATUSES = [
  "pending",
  "confirmed",
  "ready",
  "out_for_delivery",
  "arrived_at_customer",
  "picked_up",
  "canceled",
  "expired",
] as const;

export type LeaflyOrderStatus = (typeof LEAFLY_ORDER_STATUSES)[number];

/** The two end states. Everything else is in flight. */
export const LEAFLY_TERMINAL_ORDER_STATUSES = ["picked_up", "canceled"] as const;

/**
 * Valid statuses that are NOT accepted by the status-update endpoint. From the spec:
 * "Pending and expired are valid statuses but are not valid values for the status update
 * endpoint." Leafly owns both — `pending` is the pre-acknowledgement state and `expired`
 * is what Leafly sets when we blow the acknowledgement deadline.
 */
export const LEAFLY_NON_SETTABLE_ORDER_STATUSES = ["pending", "expired"] as const;

/** `FulfillmentMechanism`. Production graduation requires BOTH to work end to end. */
export const LEAFLY_FULFILLMENT_MECHANISMS = ["pickup", "delivery"] as const;

/** `Marketplace` — where the order originated. `uberEats` carries extra restrictions. */
export const LEAFLY_ORDER_MARKETPLACES = ["leafly", "uberEats"] as const;

/**
 * `MedicalStatus`. Note this is the ORDER's designation and is Leafly's to send, unrelated
 * to the menu contract's per-variant `medical` boolean. Greenway is not yet DOH-endorsed
 * (owner, Q5), so a `medical` order is not currently fulfillable here and must be surfaced
 * to staff rather than silently accepted.
 */
export const LEAFLY_ORDER_MEDICAL_STATUSES = ["medical", "recreational"] as const;

/** `PaymentPreference`. Leafly processes no payments; this is a hint only. */
export const LEAFLY_ORDER_PAYMENT_PREFERENCES = ["cash", "debit", "credit"] as const;

/** `CancelReason`. `order_api_unacknowledged` is the one WE cause by missing the deadline. */
export const LEAFLY_ORDER_CANCEL_REASONS = [
  "not_picked_up",
  "customer",
  "dispensary",
  "pos",
  "delivery_partner",
  "ecommerce_partner",
  "order_api_unacknowledged",
] as const;

/* ------------------------------------------------------------------------- *
 * 3. Hard deadlines and access windows
 * ------------------------------------------------------------------------- */

/**
 * "Orders are acknowledged as having been retrieved in whole by your system within fifteen
 * minutes of receiving an order submission webhook. Any orders not acknowledged by this
 * deadline will be auto canceled."
 *
 * Fifteen minutes is a long time for a webhook and a short time for a human. It must be
 * satisfied by the SYSTEM on receipt, never by a budtender noticing a screen.
 */
export const LEAFLY_ORDER_ACK_DEADLINE_MINUTES = 15;

/**
 * "Orders are only available for retrieval while live, or within twenty four hours of
 * reaching a terminal state." Anything we want to keep must be persisted locally.
 */
export const LEAFLY_ORDER_RETRIEVAL_WINDOW_HOURS_AFTER_TERMINAL = 24;

/**
 * "Media associated with an order (e.g., government and medical id images) are only
 * accessible before order acknowledgement and when the order is in pending status."
 *
 * This is a genuine ordering trap: acknowledging FIRST (to beat the 15-minute deadline)
 * permanently revokes our access to the ID images. If we ever want them, they must be
 * fetched in the same handler, BEFORE the acknowledge call.
 */
export const LEAFLY_ORDER_MEDIA_REQUIRES_PRE_ACKNOWLEDGEMENT = true;

/** "Order update operations can only proceed after order acknowledgement." */
export const LEAFLY_ORDER_UPDATES_REQUIRE_ACKNOWLEDGEMENT = true;

/* ------------------------------------------------------------------------- *
 * 4. THE COMMUNICATIONS RULE (the owner's Question 6)
 * ------------------------------------------------------------------------- */

/**
 * Audiences Greenway may email about an order, mirroring
 * `src/lib/orders/notify-outcome-core.ts`'s `EmailAudience`.
 */
export const LEAFLY_EMAIL_AUDIENCES = ["customer", "staff"] as const;
export type LeaflyEmailAudience = (typeof LEAFLY_EMAIL_AUDIENCES)[number];

/**
 * Audiences Greenway must NOT send automated order email/SMS to when the order came from
 * Leafly. Exactly one entry, and it is deliberately a list rather than a boolean so the
 * test can assert what is absent as well as what is present.
 *
 * Leafly owns the shopper relationship for orders placed on leafly.com, and sends the
 * confirmation / ready-for-pickup messages itself. A second confirmation from Greenway is
 * not a harmless duplicate: the two messages can disagree (ours is generated at webhook
 * receipt, Leafly's at its own state change), and a shopper who is told "ready for pickup"
 * by us before the bag is packed walks into the store early.
 */
export const LEAFLY_SUPPRESSED_EMAIL_AUDIENCES = ["customer"] as const;

/**
 * Audiences that MUST still be emailed for a Leafly-origin order. The suppression is
 * audience-scoped for a reason: Leafly does not notify Greenway STAFF through our own
 * system, and the staff alert is the safety net that keeps a pickup order from sitting
 * unnoticed until it auto-cancels at the 15-minute deadline.
 */
export const LEAFLY_PERMITTED_EMAIL_AUDIENCES = ["staff"] as const;

/**
 * Does Greenway send this audience an automated order email for an order of this origin?
 *
 * `origin` is the order's marketplace: `"leafly"` and `"uberEats"` both arrive through the
 * Leafly Order API and are both covered by the rule. `"greenway"` is our own storefront,
 * where Greenway IS the originator of consumer communications and both audiences are sent.
 */
export function mayEmailAudienceForOrderOrigin(
  origin: "greenway" | (typeof LEAFLY_ORDER_MARKETPLACES)[number],
  audience: LeaflyEmailAudience,
): boolean {
  if (origin === "greenway") return true;
  return !(LEAFLY_SUPPRESSED_EMAIL_AUDIENCES as readonly string[]).includes(audience);
}

/**
 * The reason string to record when a customer email is intentionally not sent. Slice L-1's
 * `notify-outcome-core.ts` already treats `"skipped"` as a normal, quiet state — but a skip
 * with no reason is indistinguishable from a misconfiguration at 2am, so the suppression
 * must say so in its own words.
 */
export const LEAFLY_CUSTOMER_EMAIL_SUPPRESSION_REASON =
  "suppressed: Leafly is the sole originator of consumer order communications";

/* ------------------------------------------------------------------------- *
 * 5. Environment / deployment facts
 * ------------------------------------------------------------------------- */

/** Leafly's API roots. Sandbox is `.leafly.io`; production is `.leafly.com`. */
export const LEAFLY_ORDER_API_ROOTS = {
  sandbox: "https://reservations-api-sandbox.leafly.io/v1/order_integration",
  production: "https://reservations-api.leafly.com/v1/order_integration",
} as const;

/**
 * The host Leafly's webhooks will call. Confirmed by the owner (Q1) as correct "for now".
 * It MUST be the stable project alias, never a per-deployment URL: a per-deployment URL
 * changes on every push and would silently strand every webhook after the next deploy.
 */
export const LEAFLY_WEBHOOK_HOST = "greenwaywebsite1.vercel.app";

/**
 * "Shared URL domain for all retailers associated with your system": Leafly does not support
 * per-retailer domains. Retailers are distinguished by `orderIntegrationKey` instead.
 */
export const LEAFLY_ORDER_RETAILER_KEY_FIELD = "orderIntegrationKey";

/**
 * "Dynamic request metadata is not supported": no custom or dynamic IDs, params, or HTTP
 * headers. So a webhook handler may NOT be authenticated by a secret in the query string
 * or a bespoke header — HMAC over the body is the only mechanism available.
 */
export const LEAFLY_SUPPORTS_DYNAMIC_REQUEST_METADATA = false;

/**
 * Enabling the order integration turns the Leafly order dashboard READ-ONLY; Greenway
 * becomes the source of truth for order status and cart totals. Documented for every POS
 * partner Leafly publishes a guide for (Cova, Dutchie, …). This is why the webhooks cannot
 * be half-built: once the toggle flips, the manual fallback is gone.
 */
export const LEAFLY_ORDER_INTEGRATION_MAKES_DASHBOARD_READ_ONLY = true;

/* ------------------------------------------------------------------------- *
 * Helpers
 * ------------------------------------------------------------------------- */

export function isLeaflyOrderEventType(v: string): v is LeaflyOrderEventType {
  return (LEAFLY_ORDER_EVENT_TYPES as readonly string[]).includes(v);
}

export function isLeaflyOrderStatus(v: string): v is LeaflyOrderStatus {
  return (LEAFLY_ORDER_STATUSES as readonly string[]).includes(v);
}

export function isTerminalLeaflyOrderStatus(v: string): boolean {
  return (LEAFLY_TERMINAL_ORDER_STATUSES as readonly string[]).includes(v);
}

/** Can our integration SET this status via the status-update endpoint? */
export function isSettableLeaflyOrderStatus(v: string): boolean {
  return (
    isLeaflyOrderStatus(v) &&
    !(LEAFLY_NON_SETTABLE_ORDER_STATUSES as readonly string[]).includes(v)
  );
}

/** Is an HTTP status code an acceptable webhook acknowledgement? */
export function isAcceptableLeaflyWebhookStatus(code: number): boolean {
  return (LEAFLY_WEBHOOK_OK_STATUS_CODES as readonly number[]).includes(code);
}

/** Must this event's handler answer with a populated JSON body? */
export function leaflyEventReturnsBody(event: LeaflyOrderEventType): boolean {
  return (LEAFLY_ORDER_EVENTS_RETURNING_A_BODY as readonly string[]).includes(event);
}

/** Is this event required for production graduation? */
export function isRequiredLeaflyOrderEvent(event: LeaflyOrderEventType): boolean {
  return (LEAFLY_REQUIRED_ORDER_EVENTS as readonly string[]).includes(event);
}

/** Full absolute URL to hand Leafly for an event. */
export function leaflyWebhookUrl(event: LeaflyOrderEventType): string {
  return `https://${LEAFLY_WEBHOOK_HOST}${LEAFLY_ORDER_WEBHOOK_PATHS[event]}`;
}

/* ------------------------------------------------------------------------- *
 * Self-tests (rule 5: PURE core + __run…Tests())
 * ------------------------------------------------------------------------- */

export function __runLeaflyOrderContractTests(): void {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: ${label}`);
    }
  };

  // --- Events and paths ---------------------------------------------------
  ok("six webhook events", LEAFLY_ORDER_EVENT_TYPES.length === 6);
  ok(
    "every event has an approved path",
    LEAFLY_ORDER_EVENT_TYPES.every(
      (e) => typeof LEAFLY_ORDER_WEBHOOK_PATHS[e] === "string",
    ),
  );
  ok(
    "no two events share a path",
    new Set(Object.values(LEAFLY_ORDER_WEBHOOK_PATHS)).size === 6,
  );
  ok(
    "every path is under /api/webhooks/leafly/",
    Object.values(LEAFLY_ORDER_WEBHOOK_PATHS).every((p) =>
      p.startsWith("/api/webhooks/leafly/"),
    ),
  );
  ok(
    "paths are kebab-case (event underscores become hyphens)",
    LEAFLY_ORDER_EVENT_TYPES.every(
      (e) =>
        LEAFLY_ORDER_WEBHOOK_PATHS[e] ===
        `/api/webhooks/leafly/${e.replace(/_/g, "-")}`,
    ),
  );
  ok("order_submit is required", isRequiredLeaflyOrderEvent("order_submit"));
  ok("order_cancel is required", isRequiredLeaflyOrderEvent("order_cancel"));
  ok("order_preview is NOT required", !isRequiredLeaflyOrderEvent("order_preview"));
  ok("order_activate is NOT required", !isRequiredLeaflyOrderEvent("order_activate"));
  ok("only order_preview returns a body", leaflyEventReturnsBody("order_preview"));
  ok("order_submit returns no body", !leaflyEventReturnsBody("order_submit"));
  ok(
    "exactly one body-returning event",
    LEAFLY_ORDER_EVENTS_RETURNING_A_BODY.length === 1,
  );
  ok("isLeaflyOrderEventType accepts a real event", isLeaflyOrderEventType("order_status"));
  ok(
    "isLeaflyOrderEventType rejects a plausible fake",
    !isLeaflyOrderEventType("order_update"),
  );

  // --- Response codes ----------------------------------------------------
  ok("200 is acceptable", isAcceptableLeaflyWebhookStatus(200));
  ok("201 is acceptable", isAcceptableLeaflyWebhookStatus(201));
  ok("204 is NOT acceptable", !isAcceptableLeaflyWebhookStatus(204));
  ok("400 is NOT acceptable", !isAcceptableLeaflyWebhookStatus(400));
  ok("500 is NOT acceptable", !isAcceptableLeaflyWebhookStatus(500));

  // --- Lifecycle ---------------------------------------------------------
  ok("eight order statuses", LEAFLY_ORDER_STATUSES.length === 8);
  ok("pending is first", LEAFLY_ORDER_STATUSES[0] === "pending");
  ok("picked_up is terminal", isTerminalLeaflyOrderStatus("picked_up"));
  ok("canceled is terminal", isTerminalLeaflyOrderStatus("canceled"));
  ok("expired is NOT terminal for our purposes", !isTerminalLeaflyOrderStatus("expired"));
  ok("ready is not terminal", !isTerminalLeaflyOrderStatus("ready"));
  ok("pending is not settable", !isSettableLeaflyOrderStatus("pending"));
  ok("expired is not settable", !isSettableLeaflyOrderStatus("expired"));
  ok("confirmed is settable", isSettableLeaflyOrderStatus("confirmed"));
  ok("picked_up is settable", isSettableLeaflyOrderStatus("picked_up"));
  ok("a fake status is not settable", !isSettableLeaflyOrderStatus("in_progress"));
  ok(
    "every non-settable status is a real status",
    LEAFLY_NON_SETTABLE_ORDER_STATUSES.every((s) => isLeaflyOrderStatus(s)),
  );
  ok(
    "every terminal status is a real status",
    LEAFLY_TERMINAL_ORDER_STATUSES.every((s) => isLeaflyOrderStatus(s)),
  );
  ok("two fulfillment mechanisms", LEAFLY_FULFILLMENT_MECHANISMS.length === 2);
  ok(
    "marketplaces are leafly and uberEats",
    LEAFLY_ORDER_MARKETPLACES.join(",") === "leafly,uberEats",
  );
  ok(
    "cancel reasons include the one we cause",
    (LEAFLY_ORDER_CANCEL_REASONS as readonly string[]).includes(
      "order_api_unacknowledged",
    ),
  );

  // --- Deadlines ---------------------------------------------------------
  ok("ack deadline is 15 minutes", LEAFLY_ORDER_ACK_DEADLINE_MINUTES === 15);
  ok(
    "retrieval window is 24h",
    LEAFLY_ORDER_RETRIEVAL_WINDOW_HOURS_AFTER_TERMINAL === 24,
  );
  ok("media needs pre-ack fetch", LEAFLY_ORDER_MEDIA_REQUIRES_PRE_ACKNOWLEDGEMENT);
  ok("updates need ack first", LEAFLY_ORDER_UPDATES_REQUIRE_ACKNOWLEDGEMENT);

  // --- THE COMMUNICATIONS RULE (Q6) -------------------------------------
  ok(
    "customer email is suppressed for Leafly orders",
    !mayEmailAudienceForOrderOrigin("leafly", "customer"),
  );
  ok(
    "staff email is PERMITTED for Leafly orders",
    mayEmailAudienceForOrderOrigin("leafly", "staff"),
  );
  ok(
    "customer email is suppressed for uberEats orders too",
    !mayEmailAudienceForOrderOrigin("uberEats", "customer"),
  );
  ok(
    "staff email is permitted for uberEats orders",
    mayEmailAudienceForOrderOrigin("uberEats", "staff"),
  );
  ok(
    "customer email is ALLOWED for our own storefront",
    mayEmailAudienceForOrderOrigin("greenway", "customer"),
  );
  ok(
    "staff email is allowed for our own storefront",
    mayEmailAudienceForOrderOrigin("greenway", "staff"),
  );
  ok(
    "exactly one suppressed audience",
    LEAFLY_SUPPRESSED_EMAIL_AUDIENCES.length === 1,
  );
  ok(
    "staff is NOT in the suppressed list",
    !(LEAFLY_SUPPRESSED_EMAIL_AUDIENCES as readonly string[]).includes("staff"),
  );
  ok(
    "customer is NOT in the permitted list",
    !(LEAFLY_PERMITTED_EMAIL_AUDIENCES as readonly string[]).includes("customer"),
  );
  ok(
    "suppressed and permitted are disjoint",
    LEAFLY_SUPPRESSED_EMAIL_AUDIENCES.every(
      (a) => !(LEAFLY_PERMITTED_EMAIL_AUDIENCES as readonly string[]).includes(a),
    ),
  );
  ok(
    "suppressed + permitted covers every audience",
    LEAFLY_EMAIL_AUDIENCES.every(
      (a) =>
        (LEAFLY_SUPPRESSED_EMAIL_AUDIENCES as readonly string[]).includes(a) ||
        (LEAFLY_PERMITTED_EMAIL_AUDIENCES as readonly string[]).includes(a),
    ),
  );
  ok(
    "suppression reason names Leafly",
    /Leafly/.test(LEAFLY_CUSTOMER_EMAIL_SUPPRESSION_REASON),
  );
  ok(
    "suppression reason is recognisable as a suppression",
    /suppress/i.test(LEAFLY_CUSTOMER_EMAIL_SUPPRESSION_REASON),
  );

  // --- Environment -------------------------------------------------------
  ok(
    "sandbox root is leafly.io",
    LEAFLY_ORDER_API_ROOTS.sandbox.includes("reservations-api-sandbox.leafly.io"),
  );
  ok(
    "production root is leafly.com",
    LEAFLY_ORDER_API_ROOTS.production.includes("reservations-api.leafly.com"),
  );
  ok(
    "sandbox and production roots differ",
    // Widened to `string` deliberately. Compared as literal types, TypeScript proves the
    // two constants can never be equal (TS2367) — which means the assertion could never
    // be false and was a tautology dressed as a test, the exact "equivalent mutant"
    // false-green the CCRS protocol warns about. As strings it is a real runtime check
    // that survives someone editing one root to match the other.
    (LEAFLY_ORDER_API_ROOTS.sandbox as string) !==
      (LEAFLY_ORDER_API_ROOTS.production as string),
  );
  ok(
    "webhook host is the stable alias",
    LEAFLY_WEBHOOK_HOST === "greenwaywebsite1.vercel.app",
  );
  ok(
    "webhook host carries no per-deployment hash",
    !/-[a-z0-9]{6,}-/.test(LEAFLY_WEBHOOK_HOST),
  );
  ok(
    "webhook url is absolute https",
    leaflyWebhookUrl("order_submit") ===
      "https://greenwaywebsite1.vercel.app/api/webhooks/leafly/order-submit",
  );
  ok(
    "retailer key field is orderIntegrationKey",
    LEAFLY_ORDER_RETAILER_KEY_FIELD === "orderIntegrationKey",
  );
  ok(
    "dynamic request metadata is unsupported",
    LEAFLY_SUPPORTS_DYNAMIC_REQUEST_METADATA === false,
  );
  ok(
    "enabling orders makes the Leafly dashboard read-only",
    LEAFLY_ORDER_INTEGRATION_MAKES_DASHBOARD_READ_ONLY,
  );

  console.log(`leafly-order-contract: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} leafly-order-contract test(s) failed`);
}
