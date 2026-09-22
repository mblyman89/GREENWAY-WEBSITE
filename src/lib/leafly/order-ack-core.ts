/**
 * src/lib/leafly/order-ack-core.ts
 *
 * SLICE L-6 — TALKING BACK TO LEAFLY.
 *
 * PURE. No I/O, no database, no network, no clock, no `process.env`. Every
 * function takes what it needs and returns a value, so the rules Leafly imposes
 * on OUTBOUND calls can be proven in CI without a Leafly account, without a
 * sandbox key, and without sending a single byte to anybody.
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE FILE FROM order-map-core.ts
 * ===========================================================================
 * `order-map-core.ts` (slice L-5) is the VOCABULARY: the status enum in
 * lifecycle order, the `canceled`/`cancelled` spelling trap, the cancel-reason
 * enum, the acknowledgement clock, and `isForwardLeaflyTransition` — which
 * already encodes four of Leafly's five transition rules correctly. House rule
 * 11 says never re-implement a rule that has a shared core, so this file
 * DELEGATES to those functions rather than restating them. It has been checked
 * by reading them, not by assuming they exist.
 *
 * What this file adds is the part L-5 had no reason to know about, because L-5
 * only ever RECEIVED: the rules that apply when WE are the caller.
 *
 * ===========================================================================
 * THE BIG ASYMMETRY — AND WHY L-5's INSTINCTS ARE WRONG HERE
 * ===========================================================================
 * L-5 built six webhook receivers. For all six, the vendored spec documents
 * exactly ONE response code: 200. There is no documented way to tell Leafly
 * "that was malformed". That forced a fail-SOFT posture: answer 200, log
 * everything, never throw.
 *
 * These outbound endpoints are the mirror image. The vendored spec documents
 * real failure codes for both of them:
 *
 *     POST /{key}/orders/{id}/acknowledge   -> 204, 401, 403, 404
 *     POST /{key}/orders/{id}/status        -> 200, 400, 401, 403, 404
 *
 * So here we CAN distinguish "your credentials are wrong" from "that order does
 * not exist" from "that transition is illegal", and a retry policy is a
 * meaningful thing to have. Carrying L-5's fail-soft reflex across would be a
 * genuine defect: it would swallow a 403 (a credential problem a human must
 * fix) as though it were a transient blip, and retry it forever.
 *
 * Same integration, opposite posture, because the documented contract is
 * opposite. That is the single most important idea in this file.
 *
 * ===========================================================================
 * GROUND TRUTH — every rule below is quoted from the vendored spec
 * ===========================================================================
 * Source: docs/leafly-specs/order-api-v1.openapi.json
 *         ("Leafly Order API", info.version "1.0")
 *
 * 1. acknowledgeOrder, description, VERBATIM:
 *      "This endpoint confirms that your system has retrieved all necessary
 *       details regarding an order, including any associated media (e.g.
 *       government and medical id images).
 *       - Acknowledgement of order receipt is required before any changes can
 *         be made to that order through other API operations
 *       - Once an order has been acknowledged, access to an order's associated
 *         media is revoked."
 *
 *    Two consequences, both load-bearing:
 *      (a) a status update before an acknowledgement is illegal — orderable in
 *          pure logic, so this file refuses it rather than letting Leafly 4xx;
 *      (b) acknowledging DESTROYS our access to the customer's ID images. It is
 *          a ONE-WAY DOOR. A UI that presents it as an ordinary "mark as seen"
 *          button is actively misleading, so this file returns the warning text
 *          rather than leaving each call site to remember it.
 *
 * 2. acknowledgeOrder has `requestBody: null` and success `204`.
 *    Measured, not assumed. So:
 *      - the request body must be ABSENT, not `{}`;
 *      - success is 204, NOT 200. A handler written to expect 200 would report
 *        every successful acknowledgement as a failure. This is exactly the
 *        sort of off-by-one-status-code bug that only shows up against the real
 *        service, which we are not allowed to call, so it is pinned here.
 *
 * 3. updateOrder, description, VERBATIM:
 *      "- Updates to order status are only available after an order has been
 *         acknowledged
 *       - Order statuses can only be moved forward
 *       - Orders cannot be moved from their current status to the same status
 *       - Orders cannot be moved out of a terminal status (`picked_up`,
 *         `canceled`, `expired`)
 *       - Orders cannot be moved to 'pending' or 'expired' status with this
 *         endpoint"
 *
 * 4. updateOrder, description, VERBATIM — the cancel-reason asymmetry:
 *      "This endpoint will accept all cancelation reason codes described in
 *       this document with the exception of `order_api_unacknowledged`. If no
 *       reason is provided the value of `cancelationReasonCode` will default to
 *       `dispensary`."
 *
 *    `CancelReason` has SEVEN members. Exactly SIX are legal outbound. L-5
 *    stores `order_api_unacknowledged` as an INBOUND fact — it is Leafly
 *    telling us we blew the 15-minute window — and sending it back is a 400.
 *    The legal set therefore DIFFERS BY DIRECTION, which is why there is no
 *    single shared "is this a valid cancel reason" helper: one would be right
 *    in one direction and wrong in the other.
 *
 * 5. servers, VERBATIM:
 *      sandbox    "https://reservations-api-sandbox.leafly.io/v1/order_integration"
 *      production "https://reservations-api.leafly.com/v1/order_integration"
 *
 *    ⚠ THIS IS NOT THE MENU HOST. Measured by diffing the two vendored specs:
 *
 *      Menu Integration API v2 : api-sandbox.leafly.io/v2/menu_integration
 *                                api.leafly.com/v2/menu_integration
 *      Order API v1            : reservations-api-sandbox.leafly.io/v1/order_integration
 *                                reservations-api.leafly.com/v1/order_integration
 *
 *    Different subdomain, different version segment, different path segment.
 *    `config.ts`'s `getLeaflyBaseUrl()` returns the MENU host, and reusing it
 *    here would send every acknowledgement to a service that has never heard of
 *    orders. The token URL, by contrast, IS genuinely shared between the two
 *    specs (`sso.leafly.com/token`), so that one is reused. Rule 11 says reuse
 *    what exists — it does not say assume two things are the same because they
 *    have similar names.
 */

import {
  LEAFLY_CANCEL_REASONS,
  LEAFLY_CANCEL_REASON_WE_MISSED_ACK,
  LEAFLY_DELIVERY_ONLY_STATUSES,
  LEAFLY_ORDER_STATUS_SEQUENCE,
  isForwardLeaflyTransition,
  isLeaflyStatus,
  isSettableLeaflyStatus,
  type LeaflyCancelReason,
  type LeaflyStatus,
} from "./order-map-core";

// ============================================================================
// 1. WHERE THE ORDER API LIVES
// ============================================================================

/** The two environments Leafly publishes, named as the spec names them. */
export type LeaflyEnvironment = "sandbox" | "production";

/**
 * Base URL for the Order API, verbatim from the vendored spec's `servers`.
 *
 * Deliberately NOT derived from `getLeaflyBaseUrl`, and deliberately not
 * assembled from parts: assembling it would invite a future edit to "simplify"
 * the menu and order hosts into one template, which is the bug this constant
 * exists to prevent. Two literal strings cannot be accidentally unified.
 */
export const LEAFLY_ORDER_API_BASE_URLS: Readonly<Record<LeaflyEnvironment, string>> = {
  sandbox: "https://reservations-api-sandbox.leafly.io/v1/order_integration",
  production: "https://reservations-api.leafly.com/v1/order_integration",
};

/**
 * The MENU host, recorded here ONLY so the self-tests can prove the two are
 * different. Nothing in this module builds a request from it.
 *
 * A constant whose only purpose is to be asserted against looks redundant right
 * up until someone "tidies" the order host to match the menu host, at which
 * point it is the only thing standing between us and every acknowledgement
 * going to the wrong service.
 */
export const LEAFLY_MENU_API_BASE_URLS: Readonly<Record<LeaflyEnvironment, string>> = {
  sandbox: "https://api-sandbox.leafly.io/v2/menu_integration",
  production: "https://api.leafly.com/v2/menu_integration",
};

export function leaflyOrderApiBaseUrl(environment: LeaflyEnvironment): string {
  return LEAFLY_ORDER_API_BASE_URLS[environment];
}

/**
 * Build the acknowledge URL.
 *
 * Both path segments are percent-encoded. The integration key is owner-entered
 * and the order id arrives from a webhook payload, so neither is ours to trust:
 * an unencoded `/` or `?` in either would silently retarget the request at a
 * different endpoint. Encoding is cheap; diagnosing that is not.
 */
export function leaflyAcknowledgeUrl(
  environment: LeaflyEnvironment,
  orderIntegrationKey: string,
  leaflyOrderId: string,
): string {
  const base = leaflyOrderApiBaseUrl(environment);
  return `${base}/${encodeURIComponent(orderIntegrationKey)}/orders/${encodeURIComponent(leaflyOrderId)}/acknowledge`;
}

/** Build the status URL. Same encoding reasoning as above. */
export function leaflyStatusUrl(
  environment: LeaflyEnvironment,
  orderIntegrationKey: string,
  leaflyOrderId: string,
): string {
  const base = leaflyOrderApiBaseUrl(environment);
  return `${base}/${encodeURIComponent(orderIntegrationKey)}/orders/${encodeURIComponent(leaflyOrderId)}/status`;
}

// ============================================================================
// 2. THE SUCCESS CODES, WHICH ARE NOT THE SAME FOR BOTH ENDPOINTS
// ============================================================================

/**
 * `acknowledge` succeeds with 204 (No Content). `status` succeeds with 200.
 *
 * Measured from the spec's `responses` maps, not assumed. These are separate
 * constants rather than one `isOk(status)` helper precisely BECAUSE they
 * differ: a shared helper would have to accept both, and would then report a
 * 200 from `acknowledge` as success even though the spec never promises one.
 */
export const LEAFLY_ACK_SUCCESS_STATUS = 204;
export const LEAFLY_STATUS_SUCCESS_STATUS = 200;

// ============================================================================
// 3. WHICH CANCEL REASONS MAY WE SEND?
// ============================================================================

/**
 * The cancel reasons that are legal on an OUTBOUND status update: all of
 * Leafly's reasons EXCEPT `order_api_unacknowledged`.
 *
 * Derived from `LEAFLY_CANCEL_REASONS` by filtering, rather than retyped as a
 * fresh list. If Leafly adds a reason in a future spec version, L-5's enum
 * grows and this list grows with it automatically. A hand-copied list would
 * silently go stale — and the failure would be a 400 from a real customer's
 * cancellation, which is the worst possible place to discover it.
 */
export const LEAFLY_OUTBOUND_CANCEL_REASONS = LEAFLY_CANCEL_REASONS.filter(
  (reason) => reason !== LEAFLY_CANCEL_REASON_WE_MISSED_ACK,
) as readonly LeaflyCancelReason[];

/**
 * Leafly's documented default when we send `canceled` with no reason:
 * "If no reason is provided the value of `cancelationReasonCode` will default
 * to `dispensary`."
 *
 * Recorded so the UI can TELL the user what Leafly will record, rather than
 * leaving the field blank and letting the shop discover later that every
 * uncategorised cancellation was blamed on them. Rule 3: never silently invent
 * a value — but equally, never silently omit one whose default has consequences.
 */
export const LEAFLY_DEFAULT_OUTBOUND_CANCEL_REASON: LeaflyCancelReason = "dispensary";

export function isOutboundCancelReason(value: unknown): value is LeaflyCancelReason {
  return (
    typeof value === "string" &&
    (LEAFLY_OUTBOUND_CANCEL_REASONS as readonly string[]).includes(value)
  );
}

// ============================================================================
// 4. THE ONE-WAY DOOR
// ============================================================================

/**
 * The warning a human must see BEFORE acknowledging.
 *
 * Kept here, in the pure layer, for one reason: a warning that lives in a React
 * component is a warning that exists on exactly one screen. If the second
 * screen that acknowledges an order (the register, a bulk action, a future
 * mobile view) forgets it, nothing fails and nobody notices — the customer's ID
 * images are simply gone. Pinning it in the core means the self-tests can
 * assert that it still mentions the irreversible part.
 *
 * Wording note: this is written for a budtender mid-shift, not for an engineer.
 * "Revoked" is the spec's word; "you will not be able to see them again" is what
 * it means to the person holding the tablet.
 */
export const LEAFLY_ACK_IRREVERSIBLE_WARNING =
  "Acknowledging tells Leafly we have everything we need for this order. " +
  "Leafly then permanently revokes our access to the customer's government ID " +
  "and medical ID images — you will not be able to see them again, and there is " +
  "no way to undo this. Open and check any ID you need BEFORE acknowledging. " +
  "This also tells Leafly we are making the order, so the customer stops seeing " +
  "it as pending, and it puts the order on the register's pickup list.";

// ============================================================================
// 5. MAY WE ACKNOWLEDGE THIS ORDER?
// ============================================================================

export type AckDecision = {
  /** May the call be made at all? */
  allowed: boolean;
  /** Stable machine code, safe to branch on and to store. */
  code:
    | "ready"
    | "already_acknowledged"
    | "missing_order_id"
    | "missing_integration_key"
    | "terminal";
  /** Plain-English reason, safe to show a human. Never empty. */
  reason: string;
  /** The irreversible-action warning, present only when the call is allowed. */
  warning: string | null;
};

/**
 * Decide whether to acknowledge, WITHOUT calling anything.
 *
 * `alreadyAcknowledged` is refused rather than silently repeated. The spec does
 * not describe a second acknowledgement as an error, but it does say the first
 * one revokes media access, so a duplicate is at best pointless and at worst
 * masks a bug where we lost track of our own state. Refusing makes that
 * visible; and because this is pure, the refusal is provable.
 *
 * A terminal order is refused too: acknowledging an order that is already
 * picked up or cancelled cannot achieve anything, and the attempt would burn a
 * request against a rate limit for no benefit.
 */
export function decideAcknowledgement(input: {
  leaflyOrderId: string | null | undefined;
  orderIntegrationKey: string | null | undefined;
  acknowledgedAt: string | null | undefined;
  leaflyStatus: string | null | undefined;
}): AckDecision {
  const orderId = (input.leaflyOrderId ?? "").trim();
  const key = (input.orderIntegrationKey ?? "").trim();

  // Order of checks matters, and it is not arbitrary. The two "we cannot even
  // build a URL" cases come first, because reporting "already acknowledged" for
  // a record with no order id would be a confident answer to the wrong
  // question.
  if (orderId === "") {
    return {
      allowed: false,
      code: "missing_order_id",
      reason:
        "This record has no Leafly order id, so there is nothing to acknowledge. " +
        "That points at a storage problem on our side rather than anything to do with Leafly.",
      warning: null,
    };
  }
  if (key === "") {
    return {
      allowed: false,
      code: "missing_integration_key",
      reason:
        "No Leafly order integration key is saved, so we cannot prove which store " +
        "this is. Enter it on the Integrations page first.",
      warning: null,
    };
  }
  if ((input.acknowledgedAt ?? "").trim() !== "") {
    return {
      allowed: false,
      code: "already_acknowledged",
      reason:
        "This order has already been acknowledged. Acknowledging twice achieves nothing, " +
        "and the ID images were already revoked by the first acknowledgement.",
      warning: null,
    };
  }
  // A terminal status is checked LAST of the refusals, so that an unacknowledged
  // order which Leafly has since auto-cancelled still reports the honest reason
  // (terminal) rather than being mistaken for a storage fault.
  const status = (input.leaflyStatus ?? "").trim();
  if (status !== "" && isLeaflyStatus(status) && isTerminalForOutbound(status)) {
    return {
      allowed: false,
      code: "terminal",
      reason:
        `This order is already ${status}, which is final. There is nothing left to ` +
        "acknowledge — if it reads as auto-cancelled, the 15-minute window was missed.",
      warning: null,
    };
  }

  return {
    allowed: true,
    code: "ready",
    reason: "Ready to acknowledge.",
    warning: LEAFLY_ACK_IRREVERSIBLE_WARNING,
  };
}

// ============================================================================
// 6. TERMINAL, FOR OUTBOUND PURPOSES
// ============================================================================

/**
 * Leafly's terminal statuses AS THE updateOrder ENDPOINT DEFINES THEM:
 * "Orders cannot be moved out of a terminal status (`picked_up`, `canceled`,
 * `expired`)" — THREE statuses.
 *
 * L-5's `LEAFLY_TERMINAL_STATUSES` contains TWO (`picked_up`, `canceled`),
 * which is correct for what L-5 uses it for: `expired` is a state Leafly puts
 * an order into, never one we drive, so for inbound mapping it is not "one of
 * our terminals".
 *
 * Both are right for their own direction, and that is precisely why this is a
 * separate constant with its own name rather than an edit to L-5's. Widening
 * L-5's list to three would change inbound behaviour that has 149 passing
 * assertions built on it; narrowing this one to two would let us try to move an
 * expired order and eat a documented 400.
 *
 * The self-tests below assert the DIFFERENCE explicitly, so a future reader who
 * finds two similar constants does not have to guess which is which.
 */
export const LEAFLY_OUTBOUND_TERMINAL_STATUSES = [
  "picked_up",
  "canceled",
  "expired",
] as const;

export function isTerminalForOutbound(value: string): boolean {
  return (LEAFLY_OUTBOUND_TERMINAL_STATUSES as readonly string[]).includes(value);
}

// ============================================================================
// 7. MAY WE MOVE THIS ORDER TO THIS STATUS?
// ============================================================================

export type StatusChangeDecision = {
  allowed: boolean;
  code:
    | "ready"
    | "not_acknowledged"
    | "unknown_status"
    | "not_settable"
    | "same_status"
    | "from_terminal"
    | "backwards"
    | "illegal_cancel_reason";
  reason: string;
  /** The exact JSON body to send, or null when the call is refused. */
  body: { status: LeaflyStatus; cancelationReasonCode?: LeaflyCancelReason } | null;
  /**
   * What Leafly will record as the cancel reason if we send this body, INCLUDING
   * their documented default. Null when not a cancellation. Lets the UI say
   * "Leafly will record this as `dispensary`" instead of leaving it a surprise.
   */
  effectiveCancelReason: LeaflyCancelReason | null;
};

/**
 * Decide whether a status change is legal, and if so produce the exact body.
 *
 * All five of Leafly's documented rules are enforced. Four of them are
 * delegated to L-5's `isForwardLeaflyTransition` / `isSettableLeaflyStatus`,
 * which already implement them and are already proven. What this function adds
 * is the acknowledgement precondition (which L-5 had no reason to model) and
 * the outbound cancel-reason restriction — plus, importantly, a DISTINCT code
 * for each refusal.
 *
 * Distinct codes are not decoration. `isForwardLeaflyTransition` correctly
 * returns false for "same status", "out of terminal" and "backwards" alike, so
 * delegating alone would collapse three different operator situations into one
 * unhelpful message. "That order is already marked ready" and "that order was
 * cancelled an hour ago" call for completely different next actions, so the
 * checks are re-asked here in a deliberate order to name which one fired.
 */
export function decideStatusChange(input: {
  acknowledgedAt: string | null | undefined;
  currentStatus: string | null | undefined;
  nextStatus: string;
  cancelationReasonCode?: string | null;
}): StatusChangeDecision {
  const refuse = (
    code: StatusChangeDecision["code"],
    reason: string,
  ): StatusChangeDecision => ({
    allowed: false,
    code,
    reason,
    body: null,
    effectiveCancelReason: null,
  });

  // RULE 1 — "Updates to order status are only available after an order has
  // been acknowledged." Checked FIRST, because it is the only refusal whose
  // remedy is another API call rather than a different choice of status.
  if ((input.acknowledgedAt ?? "").trim() === "") {
    return refuse(
      "not_acknowledged",
      "Leafly requires an order to be acknowledged before its status can change. " +
        "Acknowledge it first, then set the status.",
    );
  }

  const from = (input.currentStatus ?? "").trim();
  const to = input.nextStatus.trim();

  if (!isLeaflyStatus(to)) {
    return refuse(
      "unknown_status",
      `"${to}" is not a status Leafly recognises, so the request would be rejected.`,
    );
  }

  // RULE 5 — "Orders cannot be moved to 'pending' or 'expired' status with this
  // endpoint." L-5's `isSettableLeaflyStatus` already encodes exactly this.
  if (!isSettableLeaflyStatus(to)) {
    return refuse(
      "not_settable",
      `Leafly does not accept "${to}" on this endpoint — that status is Leafly's to set, not ours.`,
    );
  }

  // RULE 3 — "Orders cannot be moved from their current status to the same
  // status." Named separately so the operator is told the order is ALREADY
  // where they are trying to put it, which usually means someone else got there
  // first rather than that anything is wrong.
  if (from !== "" && from === to) {
    return refuse("same_status", `This order is already "${to}", so there is nothing to change.`);
  }

  // RULE 4 — "Orders cannot be moved out of a terminal status." Uses the
  // THREE-member outbound terminal set (see section 6), not L-5's two-member
  // inbound one.
  if (from !== "" && isLeaflyStatus(from) && isTerminalForOutbound(from)) {
    return refuse(
      "from_terminal",
      `This order is "${from}", which is final. Leafly does not allow it to be moved again.`,
    );
  }

  // RULE 2 — "Order statuses can only be moved forward." Delegated, so the
  // lifecycle order lives in exactly one place.
  if (from !== "" && !isForwardLeaflyTransition(from, to)) {
    return refuse(
      "backwards",
      `Leafly only accepts forward progress, and "${from}" → "${to}" moves backwards. ` +
        "The customer would see their order regress.",
    );
  }

  // The cancel-reason restriction (spec item 4). Only meaningful when
  // cancelling, so it is checked here rather than up top — a reason supplied
  // alongside a non-cancellation is ignored by Leafly and ignoring it here
  // matches that, rather than inventing an error Leafly does not have.
  const rawReason = (input.cancelationReasonCode ?? "").trim();
  if (to === "canceled" && rawReason !== "" && !isOutboundCancelReason(rawReason)) {
    const why =
      rawReason === LEAFLY_CANCEL_REASON_WE_MISSED_ACK
        ? `"${rawReason}" is reserved for Leafly to tell US that we missed the ` +
          "15-minute acknowledgement window. Leafly rejects it on the way back."
        : `"${rawReason}" is not one of Leafly's cancellation reasons.`;
    return refuse("illegal_cancel_reason", why);
  }

  const body: StatusChangeDecision["body"] =
    to === "canceled" && rawReason !== ""
      ? { status: to, cancelationReasonCode: rawReason as LeaflyCancelReason }
      : { status: to };

  return {
    allowed: true,
    code: "ready",
    reason: `Ready to move this order to "${to}".`,
    body,
    // When cancelling with no reason, report Leafly's DOCUMENTED default rather
    // than null, so the UI can show what will actually be recorded.
    effectiveCancelReason:
      to === "canceled"
        ? rawReason !== ""
          ? (rawReason as LeaflyCancelReason)
          : LEAFLY_DEFAULT_OUTBOUND_CANCEL_REASON
        : null,
  };
}

// ============================================================================
// 8. WHAT DO WE DO WITH THE RESPONSE?
// ============================================================================

/**
 * How a caller should react to an outbound HTTP status.
 *
 * - `success`     — done.
 * - `retry`       — transient; try again with backoff.
 * - `fix_config`  — a human must change a credential or a key. Retrying is
 *                   pointless and, worse, hides the problem behind noise.
 * - `fix_request` — the call itself was wrong (illegal transition, bad body).
 *                   Retrying sends the identical wrong request.
 * - `gone`        — the order is not there. Per the spec, orders are retrievable
 *                   only while live or within 24 hours of a terminal state, so
 *                   404 is an expected end state, not a malfunction.
 */
export type OutboundDisposition =
  | "success"
  | "retry"
  | "fix_config"
  | "fix_request"
  | "gone";

export type OutboundAssessment = {
  disposition: OutboundDisposition;
  /** Should the caller try this exact request again? */
  retryable: boolean;
  /** Plain-English explanation, safe to store and to show. Never empty. */
  message: string;
  /** True when the status is one the spec documents for this endpoint. */
  documented: boolean;
};

/**
 * Classify an outbound response.
 *
 * `expectedSuccess` is a PARAMETER rather than a hard-coded 200 because the two
 * endpoints genuinely differ — acknowledge returns 204, status returns 200.
 * Hard-coding either one would make this function silently wrong for the other
 * endpoint, and the symptom would be "acknowledgement always reports failure
 * even though Leafly accepted it", which is very hard to diagnose from logs
 * alone.
 *
 * 401 is classified `retry` rather than `fix_config`, once, deliberately: the
 * existing menu client (`push.ts`) already treats a single 401 as a possibly
 * expired token and retries after clearing its cache, and that is the correct
 * reading of an OAuth bearer flow. A 401 that survives a fresh token IS a
 * config problem, but the disposition cannot tell the difference — the CALLER
 * knows whether it has already refreshed. So the message says so explicitly
 * rather than pretending the distinction does not exist.
 */
export function assessOutboundResponse(
  httpStatus: number,
  expectedSuccess: number,
): OutboundAssessment {
  if (httpStatus === expectedSuccess) {
    return {
      disposition: "success",
      retryable: false,
      message: `Leafly accepted the request (${httpStatus}).`,
      documented: true,
    };
  }

  if (httpStatus === 401) {
    return {
      disposition: "retry",
      retryable: true,
      message:
        "Unauthorized (401): the access token is missing, invalid or expired. " +
        "Worth one retry with a fresh token; if it persists, the client id or secret is wrong.",
      documented: true,
    };
  }

  if (httpStatus === 403) {
    return {
      disposition: "fix_config",
      retryable: false,
      message:
        "Forbidden (403): the credentials are valid but not authorised for this order " +
        "integration key. Retrying will not help — check the key, and that Leafly has " +
        "enabled Order API access for this store.",
      documented: true,
    };
  }

  if (httpStatus === 404) {
    return {
      disposition: "gone",
      retryable: false,
      message:
        "Not found (404): Leafly has no such order. Orders are only retrievable while " +
        "live or within 24 hours of finishing, so this is expected for an old order — " +
        "and for a NEW one it means the order id or the integration key is wrong.",
      documented: true,
    };
  }

  if (httpStatus === 400) {
    return {
      disposition: "fix_request",
      retryable: false,
      message:
        "Bad request (400): Leafly rejected the body. Usually an illegal status " +
        "transition, or a cancellation reason Leafly does not accept on this endpoint. " +
        "Retrying sends the same rejected request.",
      documented: true,
    };
  }

  if (httpStatus === 429) {
    return {
      disposition: "retry",
      retryable: true,
      message: "Rate limited (429): back off and retry.",
      // Honest: 429 is NOT in either endpoint's documented response list. It is
      // classified because any HTTP service may emit it, but saying it is
      // "documented" would be a small lie that a future reader could build on.
      documented: false,
    };
  }

  if (httpStatus >= 500) {
    return {
      disposition: "retry",
      retryable: true,
      message: `Leafly server error (${httpStatus}): their end, not ours. Retry with backoff.`,
      documented: false,
    };
  }

  // Anything else. Rule 3: surface a precise warning rather than guessing at a
  // meaning. An undocumented 2xx is deliberately NOT treated as success — the
  // spec promises one specific code, and quietly accepting a different one is
  // how "it worked in sandbox" becomes "it silently did nothing in production".
  return {
    disposition: "fix_request",
    retryable: false,
    message:
      `Leafly returned ${httpStatus}, which its specification does not document for this ` +
      `endpoint (expected ${expectedSuccess}). Treated as a failure rather than guessed at.`,
    documented: false,
  };
}

// ============================================================================
// 9. THE ACKNOWLEDGEMENT CLOCK
// ============================================================================

/**
 * Leafly's own words, from the Order API specification:
 *
 *   "Orders are acknowledged as having been retrieved in whole by your system
 *    within fifteen minutes of receiving an order submission webhook. Any
 *    orders not acknowledged by this deadline will be auto canceled."
 *
 * Fifteen minutes is recorded here as a DOCUMENTED CONSTANT, and it is
 * deliberately NOT used to compute anything. The deadline that matters is
 * `acknowledgeBy`, which Leafly sends on the submission webhook and which L-5
 * stores verbatim in leafly_orders.acknowledge_by. Their clock decides whether
 * a real customer's order is auto-cancelled, so ours must never be asked.
 *
 * The constant exists only so the UI can EXPLAIN the deadline ("Leafly allows
 * fifteen minutes") without a magic number in a JSX file, and so that the
 * distinction between "documented policy" and "the actual deadline for this
 * order" is visible in the code rather than living in someone's memory.
 */
export const LEAFLY_ACK_WINDOW_MINUTES = 15;

export type AckUrgency = "none" | "comfortable" | "soon" | "urgent" | "expired" | "unknown";

export type AckClock = {
  urgency: AckUrgency;
  /** Whole minutes left. Negative once the deadline has passed. Null if unknown. */
  minutesRemaining: number | null;
  /** Plain-English countdown, safe to render. Never empty. */
  label: string;
  /** True when a human should be looking at this right now. */
  needsAttention: boolean;
};

/**
 * Turn Leafly's deadline into something a person can act on.
 *
 * The thresholds (5 and 10 minutes) are OUR operational choice, not Leafly's,
 * and they are named here rather than inlined so that is unambiguous. Leafly
 * documents only the fifteen-minute window and the auto-cancel consequence.
 *
 * `now` is a parameter, not `Date.now()`, for the usual reason: a function that
 * reads the clock internally cannot be tested at a boundary, and every
 * interesting case here IS a boundary.
 *
 * "unknown" is a distinct outcome from "none". If Leafly sent no acknowledgeBy,
 * or sent something unparseable, the honest answer is that we do not know how
 * long is left -- and the UI must say so rather than render a confident "15
 * minutes" that it invented. Guessing here would be guessing about whether a
 * customer's order is about to be cancelled.
 */
export function assessAckClock(input: {
  acknowledgedAt: string | null | undefined;
  acknowledgeBy: string | null | undefined;
  now: Date;
}): AckClock {
  // Already acknowledged: the clock is irrelevant and must not be shown ticking.
  if ((input.acknowledgedAt ?? "").trim() !== "") {
    return {
      urgency: "none",
      minutesRemaining: null,
      label: "Acknowledged — Leafly's deadline no longer applies.",
      needsAttention: false,
    };
  }

  const raw = (input.acknowledgeBy ?? "").trim();
  if (raw === "") {
    return {
      urgency: "unknown",
      minutesRemaining: null,
      label:
        "Leafly did not send an acknowledgement deadline for this order. " +
        `Their documented window is ${LEAFLY_ACK_WINDOW_MINUTES} minutes from submission — ` +
        "treat it as urgent and acknowledge now.",
      needsAttention: true,
    };
  }

  const deadline = new Date(raw);
  // NaN check via getTime, because `new Date("nonsense")` does not throw.
  if (Number.isNaN(deadline.getTime())) {
    return {
      urgency: "unknown",
      minutesRemaining: null,
      label:
        "Leafly's acknowledgement deadline for this order could not be read. " +
        "Treat it as urgent and acknowledge now.",
      needsAttention: true,
    };
  }

  const msLeft = deadline.getTime() - input.now.getTime();
  // Floor, not round: with 90 seconds left, "1 minute" is the truth and
  // "2 minutes" is a lie in the dangerous direction.
  const minutesRemaining = Math.floor(msLeft / 60_000);

  if (msLeft <= 0) {
    return {
      urgency: "expired",
      minutesRemaining,
      label:
        "Leafly's acknowledgement deadline has PASSED. Leafly auto-cancels orders that " +
        "are not acknowledged in time, so this order may already be cancelled on their " +
        "side with the reason `order_api_unacknowledged`. Check before promising the " +
        "customer anything.",
      needsAttention: true,
    };
  }

  const plural = minutesRemaining === 1 ? "" : "s";
  // `<=`, not `<`. Written with `<` first, and the self-tests caught it: with
  // exactly five minutes left the strict version reported "soon" rather than
  // "urgent", because 5 < 5 is false. Five minutes to acknowledge an order
  // before Leafly auto-cancels it IS urgent, so the boundary belongs INSIDE
  // the more serious band. The same reasoning applies to the ten-minute
  // boundary below. This is exactly the kind of error that survives review --
  // both versions read correctly -- and only shows up when a real order sits
  // at the boundary during a busy evening.
  if (minutesRemaining <= ACK_URGENT_MINUTES) {
    return {
      urgency: "urgent",
      minutesRemaining,
      label: `${minutesRemaining} minute${plural} left to acknowledge — do this now or Leafly will auto-cancel it.`,
      needsAttention: true,
    };
  }
  if (minutesRemaining <= ACK_SOON_MINUTES) {
    return {
      urgency: "soon",
      minutesRemaining,
      label: `${minutesRemaining} minutes left to acknowledge.`,
      needsAttention: true,
    };
  }
  return {
    urgency: "comfortable",
    minutesRemaining,
    label: `${minutesRemaining} minutes left to acknowledge.`,
    needsAttention: false,
  };
}

/**
 * Our operational thresholds, not Leafly's. Named constants because the numbers
 * are a judgement call and a reader deserves to see that they are ours.
 */
const ACK_URGENT_MINUTES = 5;
const ACK_SOON_MINUTES = 10;

// ============================================================================
// 10. WHAT SHOULD THE SCREEN OFFER?
// ============================================================================

/**
 * WHY THE BUTTON LIST IS COMPUTED HERE AND NOT IN THE COMPONENT
 * ---------------------------------------------------------------------------
 * The obvious way to build this screen is to render a button per status and let
 * the server action refuse the illegal ones. That "works", and it is wrong.
 *
 * Leafly's dashboard becomes read-only once we are live -- "your software system
 * will become the source of truth for order statuses" -- so this screen is the
 * only place a real customer's order can be moved. A button that looks live but
 * is refused on click teaches staff that the screen lies to them, and the moment
 * they stop trusting it is the moment they stop reading the acknowledgement
 * countdown too.
 *
 * So the plan is computed in pure code, and every action it offers is put
 * through the SAME decision function the server will use before it is allowed
 * into the list. The self-tests then assert the invariant directly: for a large
 * matrix of order states, everything offered is accepted and nothing accepted
 * is withheld. That invariant is not expressible at all if the list is built in
 * JSX.
 */

export type PlannedActionKind = "acknowledge" | "status";

export type PlannedAction = {
  kind: PlannedActionKind;
  /** The Leafly status to send. Null for an acknowledgement, which sends none. */
  status: LeaflyStatus | null;
  /** Button text. Plain English, never a raw enum value. */
  label: string;
  /**
   * What the button says WHILE the request to Leafly is in flight.
   *
   * SLICE L-17. The owner reported the acknowledge button "sits waiting
   * forever stuck". Half of that was a genuinely unbounded fetch (now fixed
   * in `deadline-fetch.ts`); the other half was that the button looked
   * identical before, during and after the press, so a slow-but-working
   * request and a hung one were indistinguishable.
   *
   * The busy wording lives HERE, beside the idle label, for the reason
   * already stated above the wording table: the words are part of the
   * decision. "Acknowledging..." has to carry the same weight as
   * "Acknowledge to Leafly", and a component-local participle table would
   * drift from the labels it is supposed to shadow -- and would do it
   * silently, because nobody reviews a string that is only visible for two
   * seconds under load.
   *
   * Always present, always distinct from `label`, both asserted in CI.
   */
  busyLabel: string;
  /** One sentence explaining what pressing it does. Never empty. */
  hint: string;
  /**
   * True when the action cannot be taken back. Acknowledgement destroys our
   * access to the customer's ID images; the terminal statuses end the order.
   * The UI is expected to confirm before any action carrying this flag.
   */
  irreversible: boolean;
  /**
   * Visual weight. Exactly one action in a plan may be `primary` -- see the
   * house rule documented in components/admin/ui/Button.tsx about at most one
   * solid emphasis per page region.
   */
  emphasis: "primary" | "normal" | "danger";
};

export type OutboundActionPlan = {
  actions: PlannedAction[];
  /**
   * Why the list is empty, in language safe to show a human. Empty string when
   * actions were produced. Never a bare code: "nothing to do" with no reason is
   * indistinguishable from a broken page.
   */
  blockedReason: string;
};

/**
 * The statuses this screen will ever offer, in the order they should appear.
 *
 * Derived from Leafly's lifecycle sequence rather than retyped, so a change to
 * the sequence cannot leave this list stale. Filtered to the SETTABLE ones,
 * because `pending` and `expired` are Leafly's to set and offering them would
 * be offering a guaranteed 400.
 */
export const LEAFLY_OFFERABLE_STATUSES: readonly LeaflyStatus[] =
  LEAFLY_ORDER_STATUS_SEQUENCE.filter((s) => isSettableLeaflyStatus(s));

/**
 * Human wording for each status we can push, and what it means to the shopper.
 *
 * Kept next to the planner rather than in the component because the words are
 * part of the decision: "Mark picked up" is irreversible and the label has to
 * carry that weight. A component-local label table would drift from the rules.
 */
/**
 * The label on the acknowledge button, in exactly one place.
 *
 * Exported because the Leafly helper/handbook quotes this button by name. A
 * handbook that hard-codes "Acknowledge" while the button says "Acknowledge to
 * Leafly" teaches staff to look for a control that does not exist, which is
 * worst precisely when it matters most: inside a fifteen-minute clock.
 */
export const LEAFLY_ACK_ACTION_LABEL = "Acknowledge to Leafly";

/**
 * What the acknowledge button says while the request is in flight.
 *
 * Exported next to the label it shadows, for the same reason the label is
 * exported: the Leafly helper quotes these controls by name, and a handbook
 * that describes a state the button never enters is a handbook that teaches
 * staff to distrust the screen.
 *
 * "Sending to Leafly..." rather than "Acknowledging..." is deliberate. It
 * states what is happening on the WIRE, which is the thing that is actually
 * uncertain while the spinner turns. "Acknowledging" reads as though the
 * acknowledgement is already a fact, and the one guarantee this slice makes
 * is that we never claim an outcome we do not have.
 */
export const LEAFLY_ACK_ACTION_BUSY_LABEL = "Sending to Leafly…";

export const LEAFLY_STATUS_ACTION_WORDING: Readonly<
  Record<string, { label: string; hint: string; busyLabel: string }>
> = {
  confirmed: {
    label: "Confirm order",
    busyLabel: "Confirming…",
    hint: "Tells the Leafly shopper you have accepted their order and are working on it.",
  },
  ready: {
    label: "Mark ready for pickup",
    busyLabel: "Marking ready…",
    hint: "Tells the Leafly shopper their order is waiting for them at the counter.",
  },
  out_for_delivery: {
    label: "Mark out for delivery",
    busyLabel: "Marking out for delivery…",
    hint: "Delivery orders only. Washington does not permit cannabis delivery, so this should not normally appear.",
  },
  arrived_at_customer: {
    label: "Mark arrived at customer",
    busyLabel: "Marking arrived…",
    hint: "Delivery orders only. Washington does not permit cannabis delivery, so this should not normally appear.",
  },
  picked_up: {
    label: "Mark picked up",
    busyLabel: "Closing the order…",
    hint: "Closes the order on Leafly. This is final — Leafly does not allow an order to be moved again afterwards.",
  },
  canceled: {
    label: "Cancel on Leafly",
    busyLabel: "Cancelling…",
    hint: "Cancels the order on Leafly and tells the shopper. This is final and cannot be undone.",
  },
};

/**
 * Decide what a human may do to this order right now.
 *
 * Deliberately takes the order's fields rather than a row type, so it stays
 * pure and so a caller cannot accidentally pass a row that has been mutated
 * since it was read.
 */
export function planLeaflyOrderActions(input: {
  leaflyOrderId: string | null | undefined;
  /** Whether the Integrations page has an order integration key saved. */
  orderIntegrationKeyPresent: boolean;
  acknowledgedAt: string | null | undefined;
  leaflyStatus: string | null | undefined;
  fulfillmentMechanism: string | null | undefined;
}): OutboundActionPlan {
  // ── Phase 1: can we address this order at all? ──────────────────────────
  // Asked through the real acknowledgement decision, not by re-checking the
  // fields here, so the wording an operator sees is identical whether the
  // refusal happens on this screen or inside the server call.
  const ack = decideAcknowledgement({
    leaflyOrderId: input.leaflyOrderId,
    orderIntegrationKey: input.orderIntegrationKeyPresent ? "present" : "",
    acknowledgedAt: input.acknowledgedAt,
    leaflyStatus: input.leaflyStatus,
  });

  if (
    ack.code === "missing_order_id" ||
    ack.code === "missing_integration_key" ||
    ack.code === "terminal"
  ) {
    return { actions: [], blockedReason: ack.reason };
  }

  // ── Phase 2: not acknowledged yet -> exactly one thing to do ────────────
  // Spec: "Acknowledgement of order receipt is required before any changes can
  // be made to that order through other API operations." Offering status
  // buttons here would offer six guaranteed refusals, so the plan is a single
  // action and the screen becomes unambiguous under time pressure.
  if (ack.code === "ready") {
    return {
      actions: [
        {
          kind: "acknowledge",
          status: null,
          label: LEAFLY_ACK_ACTION_LABEL,
          busyLabel: LEAFLY_ACK_ACTION_BUSY_LABEL,
          hint:
            "Confirms to Leafly that you have this order. Required before anything " +
            "else can be sent, and it permanently ends your access to the customer's " +
            "ID images — so open the order and read what you need FIRST.",
          irreversible: true,
          emphasis: "primary",
        },
      ],
      blockedReason: "",
    };
  }

  // Any other refusal code from the acknowledgement decision that is not
  // "already acknowledged" is reported rather than silently ignored. Written as
  // an explicit check instead of an `else` so that a NEW code added to
  // AckDecision surfaces here as a visible block instead of falling through
  // into the status list.
  if (ack.code !== "already_acknowledged") {
    return { actions: [], blockedReason: ack.reason };
  }

  // ── Phase 3: acknowledged -> offer every legal forward move ─────────────
  // Washington prohibits cannabis delivery (RCW 69.50.348 permits only
  // on-premises retail sale), so the two delivery-lifecycle statuses are
  // withheld unless Leafly itself told us this order is a delivery. The test is
  // `=== "delivery"` rather than `!== "pickup"` on purpose: an absent or
  // unrecognised mechanism must NOT unlock delivery actions.
  const isDelivery = (input.fulfillmentMechanism ?? "").trim() === "delivery";

  const actions: PlannedAction[] = [];
  for (const status of LEAFLY_OFFERABLE_STATUSES) {
    if (
      !isDelivery &&
      (LEAFLY_DELIVERY_ONLY_STATUSES as readonly string[]).includes(status)
    ) {
      continue;
    }

    // THE INVARIANT. Nothing reaches the screen without the server's own
    // decision function approving it first.
    const decision = decideStatusChange({
      acknowledgedAt: input.acknowledgedAt,
      currentStatus: input.leaflyStatus,
      nextStatus: status,
    });
    if (!decision.allowed) continue;

    const wording = LEAFLY_STATUS_ACTION_WORDING[status];
    // Never render a raw enum. If wording is somehow missing, say so plainly
    // rather than printing `out_for_delivery` at a customer-facing counter.
    const label = wording ? wording.label : `Set status: ${status}`;
    const hint = wording
      ? wording.hint
      : `Sends the status "${status}" to Leafly.`;
    // The fallback busy label is generic on purpose. It must never be empty
    // (the UI would render a bare spinner with no explanation) and it must
    // never be the idle label (the button would appear not to have reacted),
    // which is the exact defect this field exists to prevent. Both
    // properties are asserted for every offerable status in the self-tests.
    const busyLabel = wording ? wording.busyLabel : "Sending to Leafly…";

    const terminal = isTerminalForOutbound(status);
    actions.push({
      kind: "status",
      status,
      label,
      busyLabel,
      hint,
      irreversible: terminal,
      emphasis:
        status === "canceled" ? "danger" : terminal ? "normal" : "normal",
    });
  }

  if (actions.length === 0) {
    return {
      actions: [],
      blockedReason:
        "There is no forward move Leafly will accept for this order right now.",
    };
  }

  // Exactly one primary: the first non-cancel action, which is the natural next
  // step in the lifecycle. Cancellation is never the highlighted default.
  const firstForward = actions.find((a) => a.status !== "canceled");
  if (firstForward) firstForward.emphasis = "primary";

  return { actions, blockedReason: "" };
}

// ============================================================================
// 11. WORDS FOR THINGS LEAFLY SENDS US
// ============================================================================

/**
 * WHY EVEN THE LABELS ARE PURE
 * ---------------------------------------------------------------------------
 * Leafly's values are snake_case machine tokens: `out_for_delivery`,
 * `order_api_unacknowledged`, `arrived_at_customer`. Rendering those directly
 * on a screen that a budtender reads across a counter, next to a customer, is
 * not acceptable — and `order_api_unacknowledged` in particular is the one a
 * staff member is MOST likely to have to explain out loud, because it means
 * Leafly cancelled a real person's order because we were too slow.
 *
 * Putting the words here rather than in the component buys two things:
 * they are asserted in CI (every status Leafly can send has words, proven by
 * iterating Leafly's own enum), and there is one place to fix a wording
 * complaint instead of three.
 *
 * `null` is returned for unknown values rather than a guess. An unrecognised
 * status means Leafly has added something we have not read the spec for yet,
 * and inventing a friendly name for it would hide exactly the event that
 * should prompt someone to go and look.
 */

/** Plain-English name for a Leafly order status. Null if not a known status. */
export function leaflyStatusLabel(value: string | null | undefined): string | null {
  switch ((value ?? "").trim()) {
    case "pending":
      return "Waiting on us";
    case "confirmed":
      return "Confirmed";
    case "ready":
      return "Ready for pickup";
    case "out_for_delivery":
      return "Out for delivery";
    case "arrived_at_customer":
      return "Arrived at customer";
    case "picked_up":
      return "Picked up";
    case "canceled":
      return "Cancelled";
    case "expired":
      return "Expired";
    default:
      return null;
  }
}

/**
 * Plain-English name for a Leafly cancellation reason. Null if unknown.
 *
 * Note `order_api_unacknowledged`. Leafly's token says nothing to a human; the
 * wording here says what actually happened and whose fault it was, because the
 * alternative is a staff member telling a customer "it says order api
 * unacknowledged" and neither of them being any the wiser.
 */
export function leaflyCancelReasonLabel(
  value: string | null | undefined,
): string | null {
  switch ((value ?? "").trim()) {
    case "not_picked_up":
      return "Not picked up";
    case "customer":
      return "Cancelled by the customer";
    case "dispensary":
      return "Cancelled by us";
    case "pos":
      return "Cancelled by the point of sale";
    case "delivery_partner":
      return "Cancelled by the delivery partner";
    case "ecommerce_partner":
      return "Cancelled by the ecommerce partner";
    case LEAFLY_CANCEL_REASON_WE_MISSED_ACK:
      return "Auto-cancelled by Leafly — we did not acknowledge it in time";
    default:
      return null;
  }
}

/**
 * How a status should be tinted on the board.
 *
 * Returns a semantic tone, NOT a CSS class. The core stays free of styling —
 * it has no business knowing which custom property the admin theme uses — but
 * the JUDGEMENT of which states are alarming is a domain decision and belongs
 * with the rules, where it is testable.
 */
export type LeaflyStatusTone = "waiting" | "progress" | "done" | "bad" | "unknown";

export function leaflyStatusTone(value: string | null | undefined): LeaflyStatusTone {
  const v = (value ?? "").trim();
  if (v === "pending") return "waiting";
  if (v === "confirmed" || v === "ready" || v === "out_for_delivery" || v === "arrived_at_customer") {
    return "progress";
  }
  if (v === "picked_up") return "done";
  // `canceled` and `expired` are both bad outcomes, and `expired` is the worse
  // of the two because it is the one we caused by missing the deadline.
  if (v === "canceled" || v === "expired") return "bad";
  return "unknown";
}

// ============================================================================
// 12. SELF-TESTS
// ============================================================================

/**
 * Embedded self-tests (house rule 5). Run in CI two ways: through
 * `scripts/compliance/run-pure-selftests.ts` under tsx, and through
 * `tests/compliance/pure-selftests.test.ts` under vitest.
 *
 * Both runners matter. Slice L-5 learned this the expensive way: a structural
 * assertion passed under tsx and failed under vitest because tsx minifies and
 * strips comments while vitest preserves them. Anything here that inspects
 * source text must therefore normalise first.
 */
export function __runLeaflyOrderAckTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`  ✗ leafly-order-ack: ${label}`);
    }
  };

  // --- 1. THE HOST TRAP ----------------------------------------------------
  // The single most dangerous confusion in this slice, so it is asserted from
  // several angles rather than once.
  ok(
    leaflyOrderApiBaseUrl("sandbox") ===
      "https://reservations-api-sandbox.leafly.io/v1/order_integration",
    "the sandbox order host matches the vendored spec verbatim",
  );
  ok(
    leaflyOrderApiBaseUrl("production") ===
      "https://reservations-api.leafly.com/v1/order_integration",
    "the production order host matches the vendored spec verbatim",
  );
  ok(
    leaflyOrderApiBaseUrl("sandbox") !== leaflyOrderApiBaseUrl("production"),
    "the two environments are different hosts (a shared one would leak sandbox traffic to production)",
  );
  for (const env of ["sandbox", "production"] as const) {
    ok(
      LEAFLY_ORDER_API_BASE_URLS[env] !== LEAFLY_MENU_API_BASE_URLS[env],
      `the ${env} ORDER host differs from the ${env} MENU host (the L-6 host trap)`,
    );
    ok(
      LEAFLY_ORDER_API_BASE_URLS[env].includes("reservations-api"),
      `the ${env} order host is on reservations-api, as the Order API spec declares`,
    );
    ok(
      !LEAFLY_ORDER_API_BASE_URLS[env].includes("menu_integration"),
      `the ${env} order host does NOT point at menu_integration`,
    );
    ok(
      LEAFLY_ORDER_API_BASE_URLS[env].includes("/v1/order_integration"),
      `the ${env} order host carries the /v1/order_integration path segment`,
    );
    ok(
      LEAFLY_MENU_API_BASE_URLS[env].includes("/v2/menu_integration"),
      `the ${env} menu host carries the /v2/menu_integration path segment (proving the versions differ too)`,
    );
  }
  // Sandbox is .io, production is .com, in BOTH specs. Worth pinning: a
  // copy-paste that lands production on .io would fail closed in an obvious
  // way, but one that lands sandbox on .com would send test traffic to the
  // live service, which is the direction that actually hurts.
  ok(
    LEAFLY_ORDER_API_BASE_URLS.sandbox.includes("leafly.io"),
    "the sandbox order host is on leafly.io",
  );
  ok(
    LEAFLY_ORDER_API_BASE_URLS.production.includes("leafly.com"),
    "the production order host is on leafly.com",
  );

  // --- 2. URL BUILDING -----------------------------------------------------
  const ackUrl = leaflyAcknowledgeUrl("sandbox", "key-123", "ord-abc");
  ok(
    ackUrl ===
      "https://reservations-api-sandbox.leafly.io/v1/order_integration/key-123/orders/ord-abc/acknowledge",
    "the acknowledge URL is assembled exactly as the spec's path template describes",
  );
  const stUrl = leaflyStatusUrl("sandbox", "key-123", "ord-abc");
  ok(
    stUrl ===
      "https://reservations-api-sandbox.leafly.io/v1/order_integration/key-123/orders/ord-abc/status",
    "the status URL is assembled exactly as the spec's path template describes",
  );
  ok(ackUrl !== stUrl, "acknowledge and status are different URLs");
  ok(ackUrl.endsWith("/acknowledge"), "the acknowledge URL ends with /acknowledge");
  ok(stUrl.endsWith("/status"), "the status URL ends with /status");
  // Encoding. A key containing a slash must not be able to change the path.
  ok(
    leaflyAcknowledgeUrl("sandbox", "a/b", "c d").includes("a%2Fb"),
    "a slash in the integration key is percent-encoded, so it cannot retarget the path",
  );
  ok(
    leaflyAcknowledgeUrl("sandbox", "a/b", "c d").includes("c%20d"),
    "a space in the order id is percent-encoded",
  );
  ok(
    !leaflyAcknowledgeUrl("sandbox", "a/b", "ord").includes("/a/b/"),
    "the raw unencoded slash does NOT survive into the path",
  );
  ok(
    leaflyAcknowledgeUrl("sandbox", "k", "../../escape").includes("..%2F..%2Fescape"),
    "a path-traversal attempt in the order id is encoded rather than honoured",
  );

  // --- 3. SUCCESS CODES DIFFER --------------------------------------------
  ok(LEAFLY_ACK_SUCCESS_STATUS === 204, "acknowledge succeeds with 204, per the spec");
  ok(LEAFLY_STATUS_SUCCESS_STATUS === 200, "status succeeds with 200, per the spec");
  ok(
    (LEAFLY_ACK_SUCCESS_STATUS as number) !== (LEAFLY_STATUS_SUCCESS_STATUS as number),
    "the two success codes are NOT the same (a single shared isOk() would be wrong)",
  );

  // --- 4. OUTBOUND CANCEL REASONS -----------------------------------------
  ok(
    LEAFLY_CANCEL_REASONS.length === 7,
    "Leafly documents 7 cancel reasons in total (guards the count below)",
  );
  ok(
    LEAFLY_OUTBOUND_CANCEL_REASONS.length === 6,
    "exactly 6 of the 7 are legal outbound",
  );
  ok(
    !isOutboundCancelReason(LEAFLY_CANCEL_REASON_WE_MISSED_ACK),
    "order_api_unacknowledged is REFUSED outbound (the spec's single explicit exception)",
  );
  ok(
    (LEAFLY_CANCEL_REASONS as readonly string[]).includes(LEAFLY_CANCEL_REASON_WE_MISSED_ACK),
    "…while still being a reason Leafly may send US inbound (the sets differ by direction)",
  );
  for (const reason of ["not_picked_up", "customer", "dispensary", "pos", "delivery_partner", "ecommerce_partner"] as const) {
    ok(isOutboundCancelReason(reason), `"${reason}" is legal outbound`);
  }
  ok(!isOutboundCancelReason("made_up"), "an invented reason is refused");
  ok(!isOutboundCancelReason(""), "an empty reason is not a valid reason value");
  ok(!isOutboundCancelReason(null), "null is refused rather than coerced");
  ok(!isOutboundCancelReason(undefined), "undefined is refused rather than coerced");
  ok(
    LEAFLY_DEFAULT_OUTBOUND_CANCEL_REASON === "dispensary",
    "Leafly's documented default reason is `dispensary` — recorded so the UI can say so",
  );
  // The filter must DERIVE from L-5's list, not duplicate it. If someone
  // replaces the filter with a hand-written array, this catches the drift.
  ok(
    LEAFLY_OUTBOUND_CANCEL_REASONS.every((r) =>
      (LEAFLY_CANCEL_REASONS as readonly string[]).includes(r),
    ),
    "every outbound reason is drawn from L-5's canonical enum (no hand-copied list)",
  );
  ok(
    LEAFLY_CANCEL_REASONS.filter((r) => !isOutboundCancelReason(r)).length === 1,
    "exactly ONE reason is inbound-only",
  );

  // --- 5. OUTBOUND TERMINAL SET IS THREE, NOT TWO -------------------------
  ok(
    LEAFLY_OUTBOUND_TERMINAL_STATUSES.length === 3,
    "the outbound terminal set has 3 members, as updateOrder documents",
  );
  ok(isTerminalForOutbound("picked_up"), "picked_up is terminal outbound");
  ok(isTerminalForOutbound("canceled"), "canceled is terminal outbound");
  ok(
    isTerminalForOutbound("expired"),
    "expired is terminal OUTBOUND — this is the member L-5's inbound list omits",
  );
  ok(!isTerminalForOutbound("pending"), "pending is not terminal");
  ok(!isTerminalForOutbound("ready"), "ready is not terminal");
  ok(
    !isTerminalForOutbound("cancelled"),
    "the British spelling is NOT recognised (L-5's spelling trap still applies here)",
  );

  // --- 6. ACKNOWLEDGEMENT DECISIONS ---------------------------------------
  const readyAck = decideAcknowledgement({
    leaflyOrderId: "ord-1",
    orderIntegrationKey: "key-1",
    acknowledgedAt: null,
    leaflyStatus: "pending",
  });
  ok(readyAck.allowed, "a fresh pending order may be acknowledged");
  ok(readyAck.code === "ready", "…with code `ready`");
  ok(readyAck.warning !== null, "…and it carries the irreversible-action warning");
  ok(
    readyAck.warning?.includes("revokes") === true,
    "…the warning names the revocation explicitly",
  );

  const noId = decideAcknowledgement({
    leaflyOrderId: "  ",
    orderIntegrationKey: "key-1",
    acknowledgedAt: null,
    leaflyStatus: "pending",
  });
  ok(!noId.allowed, "a whitespace-only order id is refused");
  ok(noId.code === "missing_order_id", "…with the storage-fault code, not a Leafly code");
  ok(noId.warning === null, "…and a refusal carries NO warning (nothing is about to happen)");

  const noKey = decideAcknowledgement({
    leaflyOrderId: "ord-1",
    orderIntegrationKey: "",
    acknowledgedAt: null,
    leaflyStatus: "pending",
  });
  ok(!noKey.allowed, "a missing integration key is refused");
  ok(noKey.code === "missing_integration_key", "…named as a key problem");
  ok(
    noKey.reason.includes("Integrations"),
    "…and the reason points at the page where the key is entered",
  );

  const dupe = decideAcknowledgement({
    leaflyOrderId: "ord-1",
    orderIntegrationKey: "key-1",
    acknowledgedAt: "2026-01-01T00:00:00Z",
    leaflyStatus: "confirmed",
  });
  ok(!dupe.allowed, "an already-acknowledged order is refused rather than re-acknowledged");
  ok(dupe.code === "already_acknowledged", "…with the duplicate code");

  const term = decideAcknowledgement({
    leaflyOrderId: "ord-1",
    orderIntegrationKey: "key-1",
    acknowledgedAt: null,
    leaflyStatus: "canceled",
  });
  ok(!term.allowed, "an unacknowledged but already-cancelled order is refused");
  ok(term.code === "terminal", "…as terminal, not as a storage fault");
  // Ordering proof: a record with BOTH no id AND a terminal status must report
  // the id problem, because that is the one we can actually act on.
  const both = decideAcknowledgement({
    leaflyOrderId: "",
    orderIntegrationKey: "",
    acknowledgedAt: "2026-01-01T00:00:00Z",
    leaflyStatus: "canceled",
  });
  ok(
    both.code === "missing_order_id",
    "when several refusals apply, the un-buildable-URL one is reported first",
  );
  // An unknown status must not be mistaken for terminal.
  const weird = decideAcknowledgement({
    leaflyOrderId: "ord-1",
    orderIntegrationKey: "key-1",
    acknowledgedAt: null,
    leaflyStatus: "who_knows",
  });
  ok(
    weird.allowed,
    "an unrecognised status does not block acknowledgement (we must not invent a terminal state)",
  );

  // --- 7. STATUS-CHANGE DECISIONS -----------------------------------------
  // RULE 1: acknowledgement first.
  const unack = decideStatusChange({
    acknowledgedAt: null,
    currentStatus: "pending",
    nextStatus: "confirmed",
  });
  ok(!unack.allowed, "a status change before acknowledgement is refused");
  ok(unack.code === "not_acknowledged", "…named as the acknowledgement precondition");
  ok(unack.body === null, "…and produces no body at all");
  ok(
    unack.reason.toLowerCase().includes("acknowledge"),
    "…and tells the operator to acknowledge first",
  );

  const ACK = "2026-01-01T00:00:00Z";

  const fwd = decideStatusChange({
    acknowledgedAt: ACK,
    currentStatus: "pending",
    nextStatus: "confirmed",
  });
  ok(fwd.allowed, "pending → confirmed is allowed once acknowledged");
  ok(
    JSON.stringify(fwd.body) === JSON.stringify({ status: "confirmed" }),
    "…and the body is exactly { status } with no extra keys (StatusChangeIncoming)",
  );
  ok(
    fwd.effectiveCancelReason === null,
    "…and a non-cancellation reports no effective cancel reason",
  );

  // RULE 5: pending and expired are not settable.
  for (const bad of ["pending", "expired"] as const) {
    const r = decideStatusChange({
      acknowledgedAt: ACK,
      currentStatus: "confirmed",
      nextStatus: bad,
    });
    ok(!r.allowed, `"${bad}" is refused — the spec forbids it on this endpoint`);
    ok(r.code === "not_settable", `…with the not-settable code for "${bad}"`);
  }

  // RULE 3: same status.
  const same = decideStatusChange({
    acknowledgedAt: ACK,
    currentStatus: "ready",
    nextStatus: "ready",
  });
  ok(!same.allowed, "moving an order to the status it already has is refused");
  ok(
    same.code === "same_status",
    "…with its OWN code, not collapsed into a generic backwards error",
  );

  // RULE 4: out of terminal — including `expired`, the outbound-only member.
  for (const from of ["picked_up", "canceled", "expired"] as const) {
    const r = decideStatusChange({
      acknowledgedAt: ACK,
      currentStatus: from,
      nextStatus: "ready",
    });
    ok(!r.allowed, `an order in "${from}" cannot be moved`);
    ok(r.code === "from_terminal", `…reported as from_terminal for "${from}"`);
  }

  // RULE 2: backwards.
  const back = decideStatusChange({
    acknowledgedAt: ACK,
    currentStatus: "ready",
    nextStatus: "confirmed",
  });
  ok(!back.allowed, "ready → confirmed is refused as backwards");
  ok(back.code === "backwards", "…with the backwards code");
  ok(
    back.reason.includes("regress"),
    "…and the reason explains the customer-visible consequence",
  );

  // Unknown status.
  const unknown = decideStatusChange({
    acknowledgedAt: ACK,
    currentStatus: "pending",
    nextStatus: "shipped",
  });
  ok(!unknown.allowed, "a status Leafly does not define is refused");
  ok(unknown.code === "unknown_status", "…as unknown rather than as backwards");

  // Cancellation is legal from any non-terminal state.
  const cancel = decideStatusChange({
    acknowledgedAt: ACK,
    currentStatus: "ready",
    nextStatus: "canceled",
  });
  ok(cancel.allowed, "an order can be cancelled from a later state (not 'backwards')");
  ok(
    cancel.effectiveCancelReason === "dispensary",
    "…and with no reason given, Leafly's documented default `dispensary` is reported",
  );
  ok(
    cancel.body !== null && !("cancelationReasonCode" in (cancel.body as object)),
    "…while the BODY still omits the key, so Leafly applies its own default rather than us guessing",
  );

  const cancelWithReason = decideStatusChange({
    acknowledgedAt: ACK,
    currentStatus: "ready",
    nextStatus: "canceled",
    cancelationReasonCode: "customer",
  });
  ok(cancelWithReason.allowed, "a cancellation with a legal reason is allowed");
  ok(
    JSON.stringify(cancelWithReason.body) ===
      JSON.stringify({ status: "canceled", cancelationReasonCode: "customer" }),
    "…and the reason is carried in the body verbatim",
  );
  ok(
    cancelWithReason.effectiveCancelReason === "customer",
    "…and the effective reason is the one supplied",
  );

  const illegalReason = decideStatusChange({
    acknowledgedAt: ACK,
    currentStatus: "ready",
    nextStatus: "canceled",
    cancelationReasonCode: LEAFLY_CANCEL_REASON_WE_MISSED_ACK,
  });
  ok(
    !illegalReason.allowed,
    "cancelling with order_api_unacknowledged is refused BEFORE Leafly can 400 it",
  );
  ok(illegalReason.code === "illegal_cancel_reason", "…with the illegal-reason code");
  ok(
    illegalReason.reason.includes("15-minute"),
    "…and the message explains WHY that code is Leafly's, not ours",
  );

  // A reason alongside a non-cancellation is ignored, matching Leafly.
  const reasonOnNonCancel = decideStatusChange({
    acknowledgedAt: ACK,
    currentStatus: "pending",
    nextStatus: "ready",
    cancelationReasonCode: "customer",
  });
  ok(
    reasonOnNonCancel.allowed,
    "a stray cancel reason on a non-cancellation does not invent an error",
  );
  ok(
    reasonOnNonCancel.body !== null &&
      !("cancelationReasonCode" in (reasonOnNonCancel.body as object)),
    "…and is dropped from the body rather than sent where it has no meaning",
  );

  // An empty current status (we have not seen one yet) must not be treated as
  // a backwards move — there is nothing to move back from.
  const noCurrent = decideStatusChange({
    acknowledgedAt: ACK,
    currentStatus: null,
    nextStatus: "confirmed",
  });
  ok(noCurrent.allowed, "with no known current status, a forward move is still allowed");

  // --- 8. RESPONSE CLASSIFICATION -----------------------------------------
  const ack204 = assessOutboundResponse(204, LEAFLY_ACK_SUCCESS_STATUS);
  ok(ack204.disposition === "success", "204 on acknowledge is success");
  ok(!ack204.retryable, "…and is not retried");
  // The bug this pins: 200 is NOT success for acknowledge.
  const ack200 = assessOutboundResponse(200, LEAFLY_ACK_SUCCESS_STATUS);
  ok(
    ack200.disposition !== "success",
    "200 on ACKNOWLEDGE is NOT success — the spec promises 204, and guessing hides real failure",
  );
  const st200 = assessOutboundResponse(200, LEAFLY_STATUS_SUCCESS_STATUS);
  ok(st200.disposition === "success", "200 on status IS success");
  const st204 = assessOutboundResponse(204, LEAFLY_STATUS_SUCCESS_STATUS);
  ok(st204.disposition !== "success", "204 on STATUS is not the documented success code");

  const r401 = assessOutboundResponse(401, 200);
  ok(r401.disposition === "retry", "401 is worth exactly one retry with a fresh token");
  ok(r401.retryable, "…so it is marked retryable");
  ok(r401.documented, "…and it is a documented response for these endpoints");

  const r403 = assessOutboundResponse(403, 200);
  ok(r403.disposition === "fix_config", "403 needs a human, not a retry");
  ok(!r403.retryable, "…so it is NOT retryable");
  ok(
    r403.message.includes("Retrying will not help"),
    "…and says so, so nobody builds a retry loop around it",
  );

  const r404 = assessOutboundResponse(404, 200);
  ok(r404.disposition === "gone", "404 means the order is not there");
  ok(!r404.retryable, "…and is not retryable");
  ok(
    r404.message.includes("24 hours"),
    "…and explains the spec's retention window, so an old order does not look like a bug",
  );

  const r400 = assessOutboundResponse(400, 200);
  ok(r400.disposition === "fix_request", "400 means the request was wrong");
  ok(!r400.retryable, "…and retrying would send the identical bad request");

  const r429 = assessOutboundResponse(429, 200);
  ok(r429.disposition === "retry", "429 is retryable");
  ok(
    !r429.documented,
    "…but is honestly marked UNdocumented, because neither endpoint lists it",
  );

  const r500 = assessOutboundResponse(500, 200);
  ok(r500.disposition === "retry", "5xx is retryable");
  ok(r500.retryable, "…and marked so");
  const r503 = assessOutboundResponse(503, 200);
  ok(r503.disposition === "retry", "503 is retryable too");

  const weirdCode = assessOutboundResponse(418, 200);
  ok(
    weirdCode.disposition === "fix_request",
    "an undocumented code is surfaced as a failure rather than guessed at",
  );
  ok(!weirdCode.documented, "…and flagged as undocumented");
  // An undocumented 2xx must NOT be accepted as success.
  const odd2xx = assessOutboundResponse(202, 200);
  ok(
    odd2xx.disposition !== "success",
    "an undocumented 2xx (202) is NOT treated as success — 'nearly right' is still wrong",
  );

  // Every message must be non-empty and every assessment self-consistent:
  // `retryable` must agree with `disposition`. A mismatch would mean the caller
  // and the human read two different stories from the same record.
  for (const code of [200, 204, 400, 401, 403, 404, 418, 429, 500, 503]) {
    for (const expected of [200, 204]) {
      const a = assessOutboundResponse(code, expected);
      ok(a.message.trim().length > 0, `assessment ${code}/${expected} has a real message`);
      ok(
        a.retryable === (a.disposition === "retry"),
        `assessment ${code}/${expected}: retryable agrees with disposition`,
      );
    }
  }

  // --- 9. CROSS-CHECK AGAINST L-5 -----------------------------------------
  // These pin the RELATIONSHIP between the two cores. If a future edit widens
  // L-5's inbound terminal list to include `expired`, inbound mapping changes
  // silently; this assertion makes that edit announce itself.
  ok(
    isSettableLeaflyStatus("confirmed") && !isSettableLeaflyStatus("pending"),
    "L-5's settable-status rule is the one being delegated to (not reimplemented here)",
  );
  ok(
    isForwardLeaflyTransition("pending", "ready") &&
      !isForwardLeaflyTransition("ready", "pending"),
    "L-5's forward-transition rule is the one being delegated to",
  );

  // --------------------------------------------------------------------------
  // SECTION 10 — the acknowledgement clock
  //
  // Every case here is a BOUNDARY, which is the reason assessAckClock takes
  // `now` as a parameter instead of reading the system clock. A function that
  // reads its own clock can only be tested for "roughly right".
  // --------------------------------------------------------------------------
  const T0 = new Date("2026-09-18T12:00:00.000Z");
  const at = (minutesFromT0: number) =>
    new Date(T0.getTime() + minutesFromT0 * 60_000).toISOString();

  // Leafly's documented window, asserted as the documented number so a future
  // edit to the constant cannot silently change what the UI tells staff.
  ok(LEAFLY_ACK_WINDOW_MINUTES === 15, "Leafly's documented ack window is 15 minutes");

  const ackedClock = assessAckClock({
    acknowledgedAt: at(-3),
    acknowledgeBy: at(12),
    now: T0,
  });
  ok(ackedClock.urgency === "none", "already acknowledged -> no clock");
  ok(!ackedClock.needsAttention, "already acknowledged -> no attention needed");
  ok(
    ackedClock.minutesRemaining === null,
    "already acknowledged -> no countdown shown (it would be meaningless)",
  );

  // MISSING deadline must be "unknown", NOT a computed 15 minutes. This is the
  // assertion that stops a future edit from inventing a deadline Leafly never
  // sent -- which would be guessing about whether a customer's order is about
  // to be auto-cancelled.
  const noDeadline = assessAckClock({ acknowledgedAt: null, acknowledgeBy: null, now: T0 });
  ok(noDeadline.urgency === "unknown", "missing acknowledgeBy -> unknown, not invented");
  ok(noDeadline.minutesRemaining === null, "missing acknowledgeBy -> no fabricated countdown");
  ok(noDeadline.needsAttention, "missing acknowledgeBy fails TOWARDS urgency, not away from it");
  ok(
    noDeadline.label.includes(String(LEAFLY_ACK_WINDOW_MINUTES)),
    "the unknown-deadline message explains Leafly's documented window",
  );

  const blankDeadline = assessAckClock({ acknowledgedAt: null, acknowledgeBy: "   ", now: T0 });
  ok(blankDeadline.urgency === "unknown", "whitespace acknowledgeBy is treated as missing");

  // `new Date("nonsense")` does not throw -- it yields an Invalid Date whose
  // getTime() is NaN. Every comparison against NaN is false, so without the
  // explicit check this would fall through to "comfortable" and report a
  // reassuring countdown for an order with no readable deadline at all.
  const garbage = assessAckClock({
    acknowledgedAt: null,
    acknowledgeBy: "not-a-timestamp",
    now: T0,
  });
  ok(garbage.urgency === "unknown", "unparseable acknowledgeBy -> unknown, not 'comfortable'");
  ok(garbage.needsAttention, "unparseable acknowledgeBy fails towards urgency");

  ok(
    assessAckClock({ acknowledgedAt: null, acknowledgeBy: at(14), now: T0 }).urgency ===
      "comfortable",
    "14 minutes out -> comfortable",
  );
  ok(
    assessAckClock({ acknowledgedAt: null, acknowledgeBy: at(10), now: T0 }).urgency === "soon",
    "exactly 10 minutes -> soon (the boundary is inclusive of the lower band)",
  );
  ok(
    assessAckClock({ acknowledgedAt: null, acknowledgeBy: at(11), now: T0 }).urgency ===
      "comfortable",
    "11 minutes -> still comfortable",
  );
  ok(
    assessAckClock({ acknowledgedAt: null, acknowledgeBy: at(5), now: T0 }).urgency === "urgent",
    "exactly 5 minutes -> urgent",
  );
  ok(
    assessAckClock({ acknowledgedAt: null, acknowledgeBy: at(6), now: T0 }).urgency === "soon",
    "6 minutes -> soon, not yet urgent",
  );
  ok(
    assessAckClock({ acknowledgedAt: null, acknowledgeBy: at(1), now: T0 }).urgency === "urgent",
    "1 minute -> urgent",
  );

  // FLOOR, not round. With 90 seconds left the honest answer is 1 minute; 2
  // would be a lie in the dangerous direction, and Math.round would tell it.
  const ninetySeconds = assessAckClock({
    acknowledgedAt: null,
    acknowledgeBy: new Date(T0.getTime() + 90_000).toISOString(),
    now: T0,
  });
  ok(
    ninetySeconds.minutesRemaining === 1,
    "90 seconds left reports 1 minute (floored), never 2 (rounded up)",
  );
  ok(ninetySeconds.urgency === "urgent", "90 seconds left is urgent");

  // The exact moment of expiry counts as expired, not as "0 minutes left".
  const atDeadline = assessAckClock({
    acknowledgedAt: null,
    acknowledgeBy: T0.toISOString(),
    now: T0,
  });
  ok(atDeadline.urgency === "expired", "exactly at the deadline -> expired");
  const past = assessAckClock({ acknowledgedAt: null, acknowledgeBy: at(-2), now: T0 });
  ok(past.urgency === "expired", "past the deadline -> expired");
  ok(
    (past.minutesRemaining ?? 0) < 0,
    "an expired clock reports a NEGATIVE countdown, so 'how late' is answerable",
  );
  ok(past.needsAttention, "an expired deadline still needs attention");
  ok(
    past.label.includes(LEAFLY_CANCEL_REASON_WE_MISSED_ACK),
    "the expired message names the cancel reason Leafly will use, so it can be recognised",
  );

  // Every urgency value must produce a non-empty label. A blank label renders
  // as an empty box, which reads as "nothing to worry about".
  for (const probe of [
    { acknowledgedAt: at(-1), acknowledgeBy: at(5) },
    { acknowledgedAt: null, acknowledgeBy: null },
    { acknowledgedAt: null, acknowledgeBy: "junk" },
    { acknowledgedAt: null, acknowledgeBy: at(14) },
    { acknowledgedAt: null, acknowledgeBy: at(8) },
    { acknowledgedAt: null, acknowledgeBy: at(2) },
    { acknowledgedAt: null, acknowledgeBy: at(-5) },
  ]) {
    const c = assessAckClock({ ...probe, now: T0 });
    ok(c.label.trim().length > 0, `clock label is never empty (${c.urgency})`);
  }

  // --- 10. THE ACTION PLANNER ---------------------------------------------
  // The planner exists so the screen cannot offer a refused button. That claim
  // is only worth making if it is asserted, so it is asserted two ways: once
  // per interesting case, and once exhaustively over a matrix.

  const ACK_AT = "2026-09-17T18:00:00.000Z";

  // A plan with no order id is blocked, with a reason, not an empty screen.
  const planNoId = planLeaflyOrderActions({
    leaflyOrderId: "",
    orderIntegrationKeyPresent: true,
    acknowledgedAt: null,
    leaflyStatus: "pending",
    fulfillmentMechanism: "pickup",
  });
  ok(planNoId.actions.length === 0, "an order with no Leafly id offers no actions");
  ok(
    planNoId.blockedReason.trim().length > 0,
    "a blocked plan always explains itself (an empty screen with no reason reads as a bug)",
  );

  // Missing key: the remedy is on the Integrations page, and the message must
  // point there rather than reporting a Leafly failure we never attempted.
  const planNoKey = planLeaflyOrderActions({
    leaflyOrderId: "ord-1",
    orderIntegrationKeyPresent: false,
    acknowledgedAt: null,
    leaflyStatus: "pending",
    fulfillmentMechanism: "pickup",
  });
  ok(planNoKey.actions.length === 0, "no integration key means no actions are offered");
  ok(
    planNoKey.blockedReason.trim().length > 0,
    "the missing-key plan explains itself rather than showing an empty toolbar",
  );

  // Unacknowledged: EXACTLY one action, and it is the acknowledgement.
  // The acknowledge button's two labels, pinned by name. The helper and the
  // handbook quote this control, so a silent rename must fail CI.
  ok(
    LEAFLY_ACK_ACTION_LABEL === "Acknowledge to Leafly",
    `the acknowledge idle label is stable (got "${LEAFLY_ACK_ACTION_LABEL}")`,
  );
  ok(
    LEAFLY_ACK_ACTION_BUSY_LABEL === "Sending to Leafly\u2026",
    `the acknowledge busy label is stable (got "${LEAFLY_ACK_ACTION_BUSY_LABEL}")`,
  );
  ok(
    !/acknowledg/i.test(LEAFLY_ACK_ACTION_BUSY_LABEL),
    "the acknowledge busy label does not claim the acknowledgement happened",
  );
  // Every entry in the wording table carries all three strings. A status
  // added with a label and a hint but no busy label would otherwise fall
  // back to the generic sentence and nobody would notice.
  for (const status of LEAFLY_OFFERABLE_STATUSES) {
    const w = LEAFLY_STATUS_ACTION_WORDING[status];
    ok(Boolean(w), `\u201c${status}\u201d has wording at all`);
    if (!w) continue;
    ok(w.label.trim().length > 0, `\u201c${status}\u201d has a label`);
    ok(w.hint.trim().length > 0, `\u201c${status}\u201d has a hint`);
    ok(w.busyLabel.trim().length > 0, `\u201c${status}\u201d has a busy label`);
    ok(w.busyLabel !== w.label, `\u201c${status}\u201d busy differs from idle`);
    ok(w.busyLabel.endsWith("\u2026"), `\u201c${status}\u201d busy is open-ended`);
  }

  const fresh = planLeaflyOrderActions({
    leaflyOrderId: "ord-1",
    orderIntegrationKeyPresent: true,
    acknowledgedAt: null,
    leaflyStatus: "pending",
    fulfillmentMechanism: "pickup",
  });
  ok(
    fresh.actions.length === 1,
    "an unacknowledged order offers exactly ONE action (six refusals would be worse than none)",
  );
  ok(fresh.actions[0].kind === "acknowledge", "that one action is the acknowledgement");
  ok(
    fresh.actions[0].irreversible,
    "the acknowledgement is flagged irreversible so the UI must confirm it",
  );
  ok(
    fresh.actions[0].hint.toLowerCase().includes("id images"),
    "the acknowledge hint warns that ID-image access ends (the one-way door)",
  );
  ok(
    fresh.actions[0].emphasis === "primary",
    "the acknowledgement is the primary action when the clock is running",
  );
  ok(fresh.blockedReason === "", "a plan with actions carries no blocked reason");

  // Acknowledged pickup order, still pending on Leafly's side.
  const ackedPending = planLeaflyOrderActions({
    leaflyOrderId: "ord-1",
    orderIntegrationKeyPresent: true,
    acknowledgedAt: ACK_AT,
    leaflyStatus: "pending",
    fulfillmentMechanism: "pickup",
  });
  ok(
    ackedPending.actions.length > 0,
    "an acknowledged order offers at least one status action",
  );
  ok(
    ackedPending.actions.every((a) => a.kind === "status"),
    "an acknowledged order offers no second acknowledgement",
  );
  ok(
    !ackedPending.actions.some((a) => a.status === "pending"),
    "`pending` is never offered (Leafly refuses it on this endpoint)",
  );
  ok(
    !ackedPending.actions.some((a) => a.status === "expired"),
    "`expired` is never offered (Leafly's to set, not ours)",
  );
  ok(
    !ackedPending.actions.some((a) => a.status === "out_for_delivery"),
    "a PICKUP order is never offered out_for_delivery (Washington prohibits delivery)",
  );
  ok(
    !ackedPending.actions.some((a) => a.status === "arrived_at_customer"),
    "a PICKUP order is never offered arrived_at_customer",
  );
  ok(
    ackedPending.actions.filter((a) => a.emphasis === "primary").length === 1,
    "exactly one action is primary (the Button.tsx one-solid-emphasis rule)",
  );
  ok(
    ackedPending.actions.find((a) => a.emphasis === "primary")?.status !== "canceled",
    "cancellation is never the highlighted default action",
  );
  ok(
    ackedPending.actions.find((a) => a.status === "canceled")?.emphasis === "danger",
    "cancellation is styled as the destructive action",
  );
  ok(
    ackedPending.actions.find((a) => a.status === "picked_up")?.irreversible === true,
    "picked_up is flagged irreversible (Leafly will not move it again)",
  );
  ok(
    ackedPending.actions.find((a) => a.status === "confirmed")?.irreversible === false,
    "confirmed is NOT flagged irreversible (over-warning trains people to click through)",
  );
  ok(
    ackedPending.actions.every((a) => a.label.trim().length > 0),
    "every offered action has a label",
  );
  ok(
    ackedPending.actions.every((a) => a.hint.trim().length > 0),
    "every offered action explains what it does",
  );
  ok(
    ackedPending.actions.every((a) => !a.label.includes("_")),
    "no label leaks a raw snake_case enum value to a counter screen",
  );

  // A delivery order DOES get the delivery statuses -- the withholding is
  // driven by Leafly's own field, not hardcoded away.
  const delivery = planLeaflyOrderActions({
    leaflyOrderId: "ord-1",
    orderIntegrationKeyPresent: true,
    acknowledgedAt: ACK_AT,
    leaflyStatus: "ready",
    fulfillmentMechanism: "delivery",
  });
  ok(
    delivery.actions.some((a) => a.status === "out_for_delivery"),
    "a DELIVERY order is offered out_for_delivery",
  );
  // The asymmetry proven in both directions, so the pickup assertions above
  // cannot be passing for the wrong reason (e.g. the status being filtered out
  // by the forward-transition rule instead of by the delivery check).
  const pickupReady = planLeaflyOrderActions({
    leaflyOrderId: "ord-1",
    orderIntegrationKeyPresent: true,
    acknowledgedAt: ACK_AT,
    leaflyStatus: "ready",
    fulfillmentMechanism: "pickup",
  });
  ok(
    !pickupReady.actions.some((a) => a.status === "out_for_delivery"),
    "the same 'ready' order withholds out_for_delivery when it is a PICKUP",
  );
  // An unknown/absent mechanism must fail CLOSED, not open.
  for (const mech of [null, undefined, "", "Delivery", "curbside"]) {
    const amb = planLeaflyOrderActions({
      leaflyOrderId: "ord-1",
      orderIntegrationKeyPresent: true,
      acknowledgedAt: ACK_AT,
      leaflyStatus: "ready",
      fulfillmentMechanism: mech,
    });
    ok(
      !amb.actions.some(
        (a) =>
          a.status === "out_for_delivery" || a.status === "arrived_at_customer",
      ),
      `an unrecognised fulfillment mechanism (${JSON.stringify(mech)}) does NOT unlock delivery statuses`,
    );
  }

  // Terminal orders offer nothing, and say why.
  for (const termStatus of LEAFLY_OUTBOUND_TERMINAL_STATUSES) {
    const done = planLeaflyOrderActions({
      leaflyOrderId: "ord-1",
      orderIntegrationKeyPresent: true,
      acknowledgedAt: ACK_AT,
      leaflyStatus: termStatus,
      fulfillmentMechanism: "pickup",
    });
    ok(done.actions.length === 0, `a "${termStatus}" order offers no actions`);
    ok(
      done.blockedReason.trim().length > 0,
      `a "${termStatus}" order explains why there is nothing to do`,
    );
  }

  // THE INVARIANT, exhaustively. For every combination of acknowledgement
  // state, current status and fulfillment mechanism, the planner and the
  // decision functions must agree in BOTH directions:
  //   * nothing offered may be refused  (no lying buttons)
  //   * nothing accepted may be withheld (no hidden capability)
  // The second half is the one that is easy to forget, and it is what would
  // catch an over-eager filter quietly removing a legal action.
  let offeredTotal = 0;
  for (const acknowledged of [null, ACK_AT]) {
    for (const current of LEAFLY_ORDER_STATUS_SEQUENCE) {
      for (const mech of ["pickup", "delivery"] as const) {
        const plan = planLeaflyOrderActions({
          leaflyOrderId: "ord-1",
          orderIntegrationKeyPresent: true,
          acknowledgedAt: acknowledged,
          leaflyStatus: current,
          fulfillmentMechanism: mech,
        });

        // Direction 1: everything offered is accepted.
        for (const action of plan.actions) {
          offeredTotal += 1;

          // SLICE L-17 -- the busy wording, checked on EVERY action the
          // planner can ever emit rather than on a hand-picked sample.
          //
          // These three properties are the whole contract, and each one maps
          // to a way the owner's original complaint could come back:
          //
          //   non-empty      -> a spinner with no words is a button that has
          //                     stopped explaining itself.
          //   !== label      -> if the busy text equals the idle text, the
          //                     button looks unchanged while it works, which
          //                     is EXACTLY the defect being fixed
          //                     (AnnouncerPanel.tsx:175 documents the same
          //                     bug class in this folder).
          //   no success claim -> the request is still in flight; wording
          //                     that reads as a completed fact would be the
          //                     one thing this slice refuses to do.
          ok(
            typeof action.busyLabel === "string" && action.busyLabel.trim().length > 0,
            `every offered action has busy wording (${action.label})`,
          );
          ok(
            action.busyLabel !== action.label,
            `busy wording differs from the idle label (${action.label})`,
          );
          ok(
            !/\backnowledged\b|\bconfirmed\b|\bsent\b|\bdone\b|\bcomplete\b/i.test(
              action.busyLabel,
            ),
            `busy wording claims nothing (${action.label})`,
          );
          // Trailing ellipsis: the shop's convention for "still working",
          // used by AnnouncerTestButton ("Sending...") and AiBusyButton
          // ("Working..."). Asserted so a new status cannot arrive with
          // wording that reads as finished.
          ok(
            action.busyLabel.trim().endsWith("\u2026"),
            `busy wording is open-ended (${action.label})`,
          );

          if (action.kind === "acknowledge") {
            const d = decideAcknowledgement({
              leaflyOrderId: "ord-1",
              orderIntegrationKey: "present",
              acknowledgedAt: acknowledged,
              leaflyStatus: current,
            });
            ok(
              d.allowed,
              `offered acknowledge is accepted (${current}/${mech}/acked=${acknowledged !== null})`,
            );
          } else {
            const d = decideStatusChange({
              acknowledgedAt: acknowledged,
              currentStatus: current,
              nextStatus: action.status as string,
            });
            ok(
              d.allowed,
              `offered "${action.status}" is accepted (from ${current}/${mech})`,
            );
          }
        }

        // Direction 2: nothing accepted is withheld -- except the two delivery
        // statuses on a pickup order, which are withheld on WASHINGTON LAW
        // grounds rather than Leafly grounds. That exception is named
        // explicitly so it cannot widen unnoticed.
        if (acknowledged !== null) {
          for (const candidate of LEAFLY_OFFERABLE_STATUSES) {
            const d = decideStatusChange({
              acknowledgedAt: acknowledged,
              currentStatus: current,
              nextStatus: candidate,
            });
            if (!d.allowed) continue;
            const deliveryOnly = (
              LEAFLY_DELIVERY_ONLY_STATUSES as readonly string[]
            ).includes(candidate);
            const expectOffered = mech === "delivery" || !deliveryOnly;
            const wasOffered = plan.actions.some((a) => a.status === candidate);
            ok(
              wasOffered === expectOffered,
              `"${candidate}" from "${current}" on a ${mech} order: offered=${wasOffered}, expected=${expectOffered}`,
            );
          }
        }
      }
    }
  }
  // Guard against the matrix passing vacuously. If the loops above ever stop
  // producing actions -- a refactor that breaks the planner outright -- the
  // per-case assertions would all pass by iterating zero times, and the whole
  // invariant would read as verified while checking nothing. This is the same
  // class of vacuous pass that the 0226 migration harness hit.
  ok(
    offeredTotal > 20,
    `the invariant matrix actually exercised actions (offered ${offeredTotal}, expected > 20)`,
  );

  // The offerable list is DERIVED, not retyped. Asserted structurally so that
  // adding a status to the lifecycle cannot leave this list stale.
  ok(
    LEAFLY_OFFERABLE_STATUSES.length === LEAFLY_ORDER_STATUS_SEQUENCE.length - 2,
    "the offerable list is the full lifecycle minus exactly the two Leafly-only statuses",
  );
  ok(
    LEAFLY_OFFERABLE_STATUSES.every((s) => isSettableLeaflyStatus(s)),
    "every offerable status is settable per L-5's shared rule",
  );
  ok(
    LEAFLY_OFFERABLE_STATUSES.every((s) => LEAFLY_STATUS_ACTION_WORDING[s] !== undefined),
    "every offerable status has human wording (no raw enum can reach the screen)",
  );

  // --- 11. HUMAN WORDING ---------------------------------------------------
  // Asserted by iterating LEAFLY'S OWN enums, not a retyped list. That is the
  // only version of this test that keeps working when Leafly adds a value: a
  // hand-written list of eight statuses would still pass while the ninth
  // rendered as raw snake_case at the counter.
  for (const status of LEAFLY_ORDER_STATUS_SEQUENCE) {
    const label = leaflyStatusLabel(status);
    ok(label !== null, `every Leafly status has human wording ("${status}")`);
    ok(
      (label ?? "").trim().length > 0,
      `the wording for "${status}" is not blank`,
    );
    ok(
      !(label ?? "_").includes("_"),
      `the wording for "${status}" contains no snake_case leakage`,
    );
    ok(
      leaflyStatusTone(status) !== "unknown",
      `every Leafly status has a tone ("${status}")`,
    );
  }
  for (const reason of LEAFLY_CANCEL_REASONS) {
    const label = leaflyCancelReasonLabel(reason);
    ok(label !== null, `every Leafly cancel reason has human wording ("${reason}")`);
    ok(
      !(label ?? "_").includes("_"),
      `the wording for cancel reason "${reason}" contains no snake_case leakage`,
    );
  }
  // Unknown values must return null, NOT a guess. This is the assertion that
  // stops a future "friendly fallback" from hiding a spec change.
  ok(leaflyStatusLabel("brand_new_status") === null, "an unknown status yields no invented label");
  ok(leaflyStatusLabel(null) === null, "a null status yields no invented label");
  ok(leaflyStatusLabel("") === null, "a blank status yields no invented label");
  ok(
    leaflyCancelReasonLabel("brand_new_reason") === null,
    "an unknown cancel reason yields no invented label",
  );
  ok(leaflyStatusTone("brand_new_status") === "unknown", "an unknown status has the unknown tone");
  // The one label that matters most operationally: the reason that means WE
  // were too slow must read as OUR fault, not as a neutral event.
  const missedLabel = leaflyCancelReasonLabel(LEAFLY_CANCEL_REASON_WE_MISSED_ACK) ?? "";
  ok(
    missedLabel.toLowerCase().includes("we did not acknowledge"),
    "the auto-cancel reason says plainly that WE missed it, rather than hiding behind Leafly's token",
  );
  ok(
    (leaflyCancelReasonLabel("dispensary") ?? "") !== missedLabel,
    "'cancelled by us' and 'auto-cancelled because we were late' are different sentences",
  );
  // Tone grouping: the two bad outcomes share a tone, and neither is confused
  // with the successful one.
  ok(leaflyStatusTone("canceled") === "bad", "canceled is toned as bad");
  ok(leaflyStatusTone("expired") === "bad", "expired is toned as bad");
  ok(leaflyStatusTone("picked_up") === "done", "picked_up is toned as done");
  ok(
    (leaflyStatusTone("picked_up") as string) !== (leaflyStatusTone("canceled") as string),
    "a completed order is never toned the same as a cancelled one",
  );
  ok(leaflyStatusTone("pending") === "waiting", "pending is toned as waiting on us");

  if (failed === 0) {
    console.log(`leafly-order-ack: ${passed} assertions passed, 0 failed`);
  } else {
    console.error(`leafly-order-ack: ${passed} passed, ${failed} FAILED`);
  }
  return { passed, failed };
}
