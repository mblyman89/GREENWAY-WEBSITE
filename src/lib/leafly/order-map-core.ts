/**
 * Leafly ↔ Greenway order status mapping — PURE core (Slice L-5)
 * =========================================================================
 *
 * Two systems describe the same order with different words. This module is the
 * translation, in both directions, and nothing else. It holds no I/O and makes
 * no decisions about whether to accept an order — only about what a status
 * means.
 *
 * GROUND TRUTH — both vocabularies were read out of their authoritative sources,
 * not remembered:
 *
 * LEAFLY (docs/leafly-specs/order-api-v1.openapi.json,
 *         `.components.schemas.OrderStatus.enum`, in the spec's own order):
 *   pending, confirmed, ready, out_for_delivery, arrived_at_customer,
 *   picked_up, canceled, expired
 *
 * GREENWAY (supabase/migrations/0007_slice7_orders.sql, `public.order_status`):
 *   new, acknowledged, preparing, ready, completed, cancelled, no_show
 *
 * ── THE SPELLING TRAP ───────────────────────────────────────────────────────
 * Leafly spells it `canceled` (one L, US). Greenway spells it `cancelled` (two
 * Ls, UK/Commonwealth). These are DIFFERENT STRINGS and no amount of care while
 * typing will make them the same one. A single dropped L silently breaks
 * cancellation — the order sits open, staff keep preparing it, and the customer
 * never arrives. Both spellings are asserted character-by-character against
 * their own sources in the compliance tests, and `LEAFLY_CANCELED_SPELLING` /
 * `GREENWAY_CANCELLED_SPELLING` exist precisely so the difference is impossible
 * to miss while reading this file.
 *
 * ── WHY THE MAPPING IS NOT SYMMETRIC ────────────────────────────────────────
 * It is tempting to write one table and reverse it. That would be wrong, for
 * three independent reasons:
 *
 *   1. **Leafly has statuses we cannot set.** The spec: "Pending and expired are
 *      valid statuses but are not valid values for the status update endpoint."
 *      So `pending` and `expired` are receive-only. A reversed table would
 *      happily try to push them and be rejected by Leafly.
 *
 *   2. **Greenway has statuses Leafly has no word for.** `no_show` is a real
 *      operational outcome for us. Leafly's nearest concept is a cancellation
 *      with reason `not_picked_up` — a status AND a reason, which a
 *      status-to-status table cannot express. That is why
 *      `greenwayToLeaflyStatus` can return a cancellation reason alongside the
 *      status.
 *
 *   3. **Collapsing is lossy in one direction only.** Both `confirmed` and
 *      `preparing`-like states funnel into our `preparing`; going back out we
 *      must pick one, and picking wrongly would make the customer's Leafly page
 *      go backwards. Leafly requires that "Order status updates correspond to an
 *      intuitive, smoothly progressing lifecycle."
 *
 * ── DELIVERY STATUSES ARE DELIBERATELY NOT MAPPED TO A LOCAL STATUS ─────────
 * `out_for_delivery` and `arrived_at_customer` have no Greenway equivalent
 * because Washington State prohibits cannabis delivery, so Greenway does not do
 * it. They are still RECOGNISED (they are real Leafly statuses and we must not
 * choke on one) and are reported with `localStatus: null` plus an explanation,
 * rather than being silently mashed into `preparing`. See risk 6 in the
 * readiness report: `delivery` is required for Leafly's order certification but
 * prohibited here — an unresolved question for Leafly, not something this module
 * may paper over.
 *
 * PURITY (house rule 5): no imports, no I/O, no clock. Time-sensitive decisions
 * take an explicit `now` argument.
 */

// ---------------------------------------------------------------------------
// The two vocabularies, verbatim
// ---------------------------------------------------------------------------

/**
 * Leafly's OrderStatus enum, in the spec's own order.
 *
 * Order is preserved because it encodes the lifecycle, and `isForwardProgress`
 * below depends on the index. Re-sorting this array alphabetically would silently
 * change what counts as progress.
 */
export const LEAFLY_ORDER_STATUS_SEQUENCE = [
  "pending",
  "confirmed",
  "ready",
  "out_for_delivery",
  "arrived_at_customer",
  "picked_up",
  "canceled",
  "expired",
] as const;
export type LeaflyStatus = (typeof LEAFLY_ORDER_STATUS_SEQUENCE)[number];

/** Greenway's `public.order_status` enum, verbatim from migration 0007. */
export const GREENWAY_ORDER_STATUSES = [
  "new",
  "acknowledged",
  "preparing",
  "ready",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type GreenwayStatus = (typeof GREENWAY_ORDER_STATUSES)[number];

/**
 * The two spellings, isolated so the difference is legible.
 * Leafly: one L. Greenway: two Ls. See the file header.
 */
export const LEAFLY_CANCELED_SPELLING = "canceled";
export const GREENWAY_CANCELLED_SPELLING = "cancelled";

/**
 * Statuses Leafly will send us but will NOT accept back.
 * Spec: "Pending and expired are valid statuses but are not valid values for
 * the status update endpoint."
 */
export const LEAFLY_RECEIVE_ONLY_STATUSES = ["pending", "expired"] as const;

/** Spec: both terminal states, named in "Preparing for Production". */
export const LEAFLY_TERMINAL_STATUSES = ["picked_up", "canceled"] as const;

/**
 * Leafly statuses that only occur in a delivery lifecycle.
 * Recognised, never mapped — Washington prohibits cannabis delivery.
 */
export const LEAFLY_DELIVERY_ONLY_STATUSES = [
  "out_for_delivery",
  "arrived_at_customer",
] as const;

/** Leafly's CancelReason enum, verbatim. */
export const LEAFLY_CANCEL_REASONS = [
  "not_picked_up",
  "customer",
  "dispensary",
  "pos",
  "delivery_partner",
  "ecommerce_partner",
  "order_api_unacknowledged",
] as const;
export type LeaflyCancelReason = (typeof LEAFLY_CANCEL_REASONS)[number];

/**
 * The cancel reason that means WE missed the acknowledgement deadline.
 *
 * Kept as a named constant because it is the one reason that indicts our own
 * integration rather than describing a customer or staff decision. It must stay
 * distinguishable in reporting: a rise in this value is an outage, whereas a
 * rise in `customer` is just shopper behaviour.
 */
export const LEAFLY_CANCEL_REASON_WE_MISSED_ACK = "order_api_unacknowledged";

// ---------------------------------------------------------------------------
// Inbound: Leafly → Greenway
// ---------------------------------------------------------------------------

export type InboundStatusMapping = {
  /** Recognised as a real Leafly status? */
  known: boolean;
  /** Our equivalent, or null when there is genuinely none. */
  localStatus: GreenwayStatus | null;
  /** True when Leafly considers the order finished. */
  terminal: boolean;
  /** True for delivery-lifecycle statuses Greenway does not operate. */
  deliveryOnly: boolean;
  /** Plain-English explanation, safe to show staff. */
  explanation: string;
};

/**
 * Translate a status Leafly sent us into ours.
 *
 * Never throws and never guesses: an unrecognised value returns
 * `known: false, localStatus: null` and says so. That matters because Leafly
 * requires webhooks be answered 200/201 — "These webhook events are not the
 * place to apply business rules or validations on the order lifecycle" — so the
 * route must be able to accept a delivery carrying a status this build has never
 * heard of, record it, and move on.
 */
export function leaflyToGreenwayStatus(status: string): InboundStatusMapping {
  switch (status) {
    case "pending":
      // Leafly has it; we have not acknowledged it yet. `new` is exactly that.
      return {
        known: true,
        localStatus: "new",
        terminal: false,
        deliveryOnly: false,
        explanation: "Leafly has taken the order and is waiting for us to acknowledge it.",
      };

    case "confirmed":
      // We acknowledged it. Deliberately `acknowledged` and NOT `preparing`:
      // acknowledging is a promise to Leafly that we received the order, which
      // is not a claim that anyone has started bagging it.
      return {
        known: true,
        localStatus: "acknowledged",
        terminal: false,
        deliveryOnly: false,
        explanation: "We have confirmed the order to Leafly. Staff have not necessarily started it.",
      };

    case "ready":
      return {
        known: true,
        localStatus: "ready",
        terminal: false,
        deliveryOnly: false,
        explanation: "The order is bagged and waiting for the customer.",
      };

    case "picked_up":
      return {
        known: true,
        localStatus: "completed",
        terminal: true,
        deliveryOnly: false,
        explanation: "The customer has collected the order. This is a terminal state.",
      };

    case "canceled":
      // Leafly's spelling on the left, ours on the right. The whole point.
      return {
        known: true,
        localStatus: "cancelled",
        terminal: true,
        deliveryOnly: false,
        explanation: "The order was cancelled. This is a terminal state.",
      };

    case "expired":
      // NOT `cancelled`, and NOT `no_show`. Expired means Leafly timed the order
      // out — most often because nobody acknowledged it. Recording it as
      // `cancelled` would erase the distinction between "we let it lapse" and
      // "somebody cancelled it", which is the difference between an integration
      // fault and normal trade. `no_show` would be worse still: it blames the
      // customer for something they did not do.
      return {
        known: true,
        localStatus: null,
        terminal: true,
        deliveryOnly: false,
        explanation:
          "Leafly expired the order (usually because it was never acknowledged in time). Deliberately NOT recorded as cancelled or no-show, because neither staff nor the customer did this — the integration did.",
      };

    case "out_for_delivery":
    case "arrived_at_customer":
      return {
        known: true,
        localStatus: null,
        terminal: false,
        deliveryOnly: true,
        explanation:
          "This is a delivery-lifecycle status. Greenway is pickup-only (Washington State prohibits cannabis delivery), so there is no local equivalent. Recorded as-is rather than forced into a pickup status.",
      };

    default:
      return {
        known: false,
        localStatus: null,
        terminal: false,
        deliveryOnly: false,
        explanation: `"${status}" is not a status in Leafly's published OrderStatus enum. Recorded verbatim and not translated. If Leafly has added a status, the vendored spec needs re-downloading.`,
      };
  }
}

// ---------------------------------------------------------------------------
// Outbound: Greenway → Leafly
// ---------------------------------------------------------------------------

export type OutboundStatusMapping = {
  /** Can this local status be expressed to Leafly at all? */
  sendable: boolean;
  /** The Leafly status to send, or null when not sendable. */
  leaflyStatus: LeaflyStatus | null;
  /** Required when `leaflyStatus` is a cancellation; null otherwise. */
  cancelationReasonCode: LeaflyCancelReason | null;
  explanation: string;
};

/**
 * Translate one of our statuses into something Leafly accepts.
 *
 * Refuses rather than approximates. `new` is the clearest case: locally it means
 * "just arrived", but sending Leafly `pending` is impossible (receive-only) and
 * sending `confirmed` would be a lie — it would tell Leafly we acknowledged an
 * order we have not acknowledged, and acknowledgement is the thing their
 * 15-minute timer measures.
 */
export function greenwayToLeaflyStatus(status: string): OutboundStatusMapping {
  switch (status) {
    case "new":
      return {
        sendable: false,
        leaflyStatus: null,
        cancelationReasonCode: null,
        explanation:
          'A brand-new order has nothing to report to Leafly yet. Leafly\'s own "pending" is receive-only, and sending "confirmed" would claim an acknowledgement that has not happened. Acknowledge the order first, via the acknowledge endpoint.',
      };

    case "acknowledged":
      return {
        sendable: true,
        leaflyStatus: "confirmed",
        cancelationReasonCode: null,
        explanation: "Tells Leafly we have the order.",
      };

    case "preparing":
      // Leafly has no "being bagged" status. `confirmed` is the honest floor:
      // it is true (we have the order) and it does not overstate progress the
      // way `ready` would. Overstating would put "ready for pickup" in front of
      // a customer who would then arrive to wait.
      return {
        sendable: true,
        leaflyStatus: "confirmed",
        cancelationReasonCode: null,
        explanation:
          'Leafly has no "being prepared" status. Reported as "confirmed", which is true and does not overstate progress — telling a customer "ready" early would have them arrive to wait.',
      };

    case "ready":
      return {
        sendable: true,
        leaflyStatus: "ready",
        cancelationReasonCode: null,
        explanation: "Tells Leafly (and the customer) the order is ready for collection.",
      };

    case "completed":
      return {
        sendable: true,
        leaflyStatus: "picked_up",
        cancelationReasonCode: null,
        explanation: "Terminal. The customer has the order.",
      };

    case "cancelled":
      return {
        sendable: true,
        leaflyStatus: "canceled",
        cancelationReasonCode: "dispensary",
        explanation:
          'Terminal. Reason "dispensary", because a cancellation reaching Leafly from our system is one the shop made. A customer-initiated cancellation arrives as a webhook FROM Leafly and is never pushed back.',
      };

    case "no_show":
      // The case a status-only table cannot express: status AND reason.
      return {
        sendable: true,
        leaflyStatus: "canceled",
        cancelationReasonCode: "not_picked_up",
        explanation:
          'Leafly has no "no show" status. Expressed as a cancellation with reason "not_picked_up", which preserves the distinction from a shop-initiated cancellation.',
      };

    default:
      return {
        sendable: false,
        leaflyStatus: null,
        cancelationReasonCode: null,
        explanation: `"${status}" is not one of Greenway's order statuses, so there is nothing to translate.`,
      };
  }
}

// ---------------------------------------------------------------------------
// Lifecycle rules
// ---------------------------------------------------------------------------

export function isLeaflyStatus(value: unknown): value is LeaflyStatus {
  return typeof value === "string" && (LEAFLY_ORDER_STATUS_SEQUENCE as readonly string[]).includes(value);
}

export function isGreenwayStatus(value: unknown): value is GreenwayStatus {
  return typeof value === "string" && (GREENWAY_ORDER_STATUSES as readonly string[]).includes(value);
}

export function isTerminalLeaflyStatus(value: string): boolean {
  return (LEAFLY_TERMINAL_STATUSES as readonly string[]).includes(value);
}

export function isReceiveOnlyLeaflyStatus(value: string): boolean {
  return (LEAFLY_RECEIVE_ONLY_STATUSES as readonly string[]).includes(value);
}

export function isDeliveryOnlyLeaflyStatus(value: string): boolean {
  return (LEAFLY_DELIVERY_ONLY_STATUSES as readonly string[]).includes(value);
}

/**
 * May we push this status to Leafly's status endpoint?
 *
 * Distinct from `isTerminalLeaflyStatus`: a terminal status is perfectly
 * settable (`picked_up` is how an order finishes), whereas a receive-only one
 * never is.
 */
export function isSettableLeaflyStatus(value: string): boolean {
  return isLeaflyStatus(value) && !isReceiveOnlyLeaflyStatus(value);
}

/**
 * Is moving `from` → `to` forward progress in Leafly's lifecycle?
 *
 * Leafly expects "an intuitive, smoothly progressing lifecycle", and their
 * dashboard becomes read-only once we are live, so a backwards transition is
 * visible to the customer as their order regressing.
 *
 * Cancellation is always allowed from any non-terminal state — an order can be
 * called off at any point. Nothing is allowed out of a terminal state.
 */
export function isForwardLeaflyTransition(from: string, to: string): boolean {
  if (!isLeaflyStatus(from) || !isLeaflyStatus(to)) return false;
  if (from === to) return false;
  if (isTerminalLeaflyStatus(from)) return false;
  if (to === "canceled") return true;
  // `expired` is Leafly's to set, never ours, so it is not "progress" we drive.
  if (to === "expired") return false;
  const fromIdx = LEAFLY_ORDER_STATUS_SEQUENCE.indexOf(from);
  const toIdx = LEAFLY_ORDER_STATUS_SEQUENCE.indexOf(to);
  return toIdx > fromIdx;
}

// ---------------------------------------------------------------------------
// The acknowledgement clock
// ---------------------------------------------------------------------------

/**
 * Leafly's documented acknowledgement window, for reference and display only.
 *
 * Spec: "Orders are acknowledged as having been retrieved in whole by your
 * system within fifteen minutes of receiving an order submission webhook. Any
 * orders not acknowledged by this deadline will be auto canceled."
 *
 * NEVER use this to COMPUTE a deadline. The submission webhook carries
 * `acknowledgeBy`, which is Leafly's own clock, and Leafly's clock is the one
 * that cancels the order. Computing `receivedAt + 15 minutes` locally would
 * drift by however much our clock differs from theirs plus the delivery latency
 * — and the error would always be in the dangerous direction, because our
 * received-at is necessarily LATER than their sent-at, making our deadline look
 * later than the real one.
 */
export const LEAFLY_ACK_WINDOW_MINUTES = 15;

/** How close to the deadline before we call it urgent. */
export const LEAFLY_ACK_URGENT_SECONDS = 300;

export type AckUrgency = "acknowledged" | "expired" | "urgent" | "ok" | "unknown";

export type AckAssessment = {
  urgency: AckUrgency;
  secondsRemaining: number | null;
  message: string;
};

/**
 * How urgent is acknowledging this order?
 *
 * `acknowledgeBy` must be the value Leafly sent. Pass null if it is absent, and
 * this returns `unknown` with an explanation rather than inventing a deadline.
 *
 * FAILS LOUD, not safe — the opposite of the read-back timing check in L-4, and
 * deliberately so. There, an unknown timestamp meant "do not cry wolf about
 * differences". Here, an unknown deadline means a real customer's order may be
 * silently auto-cancelled, so the honest answer is to say we cannot tell and
 * make someone look.
 */
export function assessAcknowledgement(input: {
  acknowledgeBy: string | null;
  acknowledgedAt: string | null;
  now: Date;
}): AckAssessment {
  const { acknowledgeBy, acknowledgedAt, now } = input;

  if (acknowledgedAt) {
    return {
      urgency: "acknowledged",
      secondsRemaining: null,
      message: "Already acknowledged to Leafly.",
    };
  }

  if (!acknowledgeBy) {
    return {
      urgency: "unknown",
      secondsRemaining: null,
      message:
        "Leafly did not supply an acknowledgement deadline for this order, so we cannot tell how long is left. Acknowledge it now: Leafly auto-cancels unacknowledged orders after fifteen minutes, and a deadline we cannot see is one we cannot meet.",
    };
  }

  const deadline = Date.parse(acknowledgeBy);
  if (Number.isNaN(deadline)) {
    return {
      urgency: "unknown",
      secondsRemaining: null,
      message: `Leafly's acknowledgement deadline ("${acknowledgeBy}") could not be read as a date, so the time remaining is unknown. Acknowledge this order now rather than waiting.`,
    };
  }

  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) {
    return {
      urgency: "unknown",
      secondsRemaining: null,
      message: "The current time is unreadable, so the acknowledgement deadline cannot be assessed.",
    };
  }

  const secondsRemaining = Math.floor((deadline - nowMs) / 1000);

  if (secondsRemaining <= 0) {
    return {
      urgency: "expired",
      secondsRemaining,
      message: `Leafly's acknowledgement deadline passed ${Math.abs(secondsRemaining)}s ago. Leafly will have auto-cancelled this order with reason "${LEAFLY_CANCEL_REASON_WE_MISSED_ACK}". Do not prepare it without checking Leafly first.`,
    };
  }

  if (secondsRemaining <= LEAFLY_ACK_URGENT_SECONDS) {
    return {
      urgency: "urgent",
      secondsRemaining,
      message: `Only ${secondsRemaining}s left to acknowledge this order before Leafly auto-cancels it.`,
    };
  }

  return {
    urgency: "ok",
    secondsRemaining,
    message: `${secondsRemaining}s left to acknowledge this order.`,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (house rule 5)
// ---------------------------------------------------------------------------

export function __runLeaflyOrderMapTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[leafly-order-map-core] FAIL: ${label}`);
    }
  };

  // -- Vocabularies --------------------------------------------------------
  ok(LEAFLY_ORDER_STATUS_SEQUENCE.length === 8, "Leafly has exactly 8 statuses");
  ok(GREENWAY_ORDER_STATUSES.length === 7, "Greenway has exactly 7 statuses");
  ok(LEAFLY_CANCEL_REASONS.length === 7, "Leafly has exactly 7 cancel reasons");

  // ADDED after the L-5 mutation sweep: mutation M33 repointed
  // LEAFLY_CANCEL_REASON_WE_MISSED_ACK from "order_api_unacknowledged" to
  // "store_closed" and SURVIVED the entire suite. It slipped through because
  // the only assertion touching the constant checked that the ack-deadline
  // MESSAGE contained its value -- which stays true whatever the constant says,
  // since the message interpolates the constant itself. A test that quotes the
  // thing it is testing cannot detect a change to it.
  //
  // This constant matters more than its size suggests: it is the one cancel
  // reason that indicts OUR integration rather than a customer or staff
  // decision, so it is the value the owner's reporting would key on to tell an
  // outage apart from ordinary shopper behaviour. Pointed at the wrong member,
  // a run of missed acknowledgements would present as "store_closed" and look
  // like normal trading. Pinned three ways: to the literal Leafly enum member,
  // to membership of the enum, and NOT-equal to every other member.
  ok(
    LEAFLY_CANCEL_REASON_WE_MISSED_ACK === "order_api_unacknowledged",
    "the we-missed-the-ack reason is exactly Leafly's 'order_api_unacknowledged' (M33)",
  );
  ok(
    (LEAFLY_CANCEL_REASONS as readonly string[]).includes(LEAFLY_CANCEL_REASON_WE_MISSED_ACK),
    "and it is a real member of Leafly's CancelReason enum, not an invented string",
  );
  ok(
    (LEAFLY_CANCEL_REASONS as readonly string[]).filter(
      (r) => r === LEAFLY_CANCEL_REASON_WE_MISSED_ACK,
    ).length === 1,
    "it matches exactly one enum member, so it cannot be aliased to another reason",
  );
  {
    // Every OTHER reason describes someone else's decision. If the constant
    // ever pointed at one of them, an outage would be indistinguishable from
    // normal trading. Enumerated explicitly so the failure names the culprit.
    const othersItMustNotBe = (LEAFLY_CANCEL_REASONS as readonly string[]).filter(
      (r) => r !== "order_api_unacknowledged",
    );
    ok(
      othersItMustNotBe.length === 6,
      `there are 6 other cancel reasons to stay distinct from (${othersItMustNotBe.length})`,
    );
    for (const other of othersItMustNotBe) {
      ok(
        LEAFLY_CANCEL_REASON_WE_MISSED_ACK !== other,
        `the missed-ack reason is NOT "${other}" (which would hide an outage)`,
      );
    }
  }

  // THE SPELLING TRAP.
  ok(LEAFLY_CANCELED_SPELLING === "canceled", "Leafly spells it with ONE l");
  ok(GREENWAY_CANCELLED_SPELLING === "cancelled", "Greenway spells it with TWO ls");
  ok(
    // Widened to `string` before comparing. Both operands are literal types, so
    // TypeScript resolves `!==` statically and (correctly) calls the comparison
    // unintentional -- it can never be false, so as written it asserts nothing
    // at RUNTIME, which is the only place a bad merge would show up. Comparing
    // as strings keeps the assertion real.
    (LEAFLY_CANCELED_SPELLING as string) !== (GREENWAY_CANCELLED_SPELLING as string),
    "the two spellings are genuinely different strings",
  );
  ok(
    (LEAFLY_ORDER_STATUS_SEQUENCE as readonly string[]).includes(LEAFLY_CANCELED_SPELLING),
    "Leafly's spelling is the one in Leafly's enum",
  );
  ok(
    (GREENWAY_ORDER_STATUSES as readonly string[]).includes(GREENWAY_CANCELLED_SPELLING),
    "Greenway's spelling is the one in Greenway's enum",
  );
  ok(
    !(LEAFLY_ORDER_STATUS_SEQUENCE as readonly string[]).includes(GREENWAY_CANCELLED_SPELLING),
    "Greenway's spelling is NOT a valid Leafly status",
  );
  ok(
    !(GREENWAY_ORDER_STATUSES as readonly string[]).includes(LEAFLY_CANCELED_SPELLING),
    "Leafly's spelling is NOT a valid Greenway status",
  );

  // Sequence order matters — it drives isForwardLeaflyTransition.
  ok(LEAFLY_ORDER_STATUS_SEQUENCE[0] === "pending", "pending is first in the lifecycle");
  ok(
    LEAFLY_ORDER_STATUS_SEQUENCE.indexOf("confirmed") <
      LEAFLY_ORDER_STATUS_SEQUENCE.indexOf("ready"),
    "confirmed precedes ready",
  );
  ok(
    LEAFLY_ORDER_STATUS_SEQUENCE.indexOf("ready") <
      LEAFLY_ORDER_STATUS_SEQUENCE.indexOf("picked_up"),
    "ready precedes picked_up",
  );

  // -- Inbound mapping -----------------------------------------------------
  ok(leaflyToGreenwayStatus("pending").localStatus === "new", "pending → new");
  ok(
    leaflyToGreenwayStatus("confirmed").localStatus === "acknowledged",
    "confirmed → acknowledged (NOT preparing — acknowledging is not starting)",
  );
  ok(leaflyToGreenwayStatus("ready").localStatus === "ready", "ready → ready");
  ok(leaflyToGreenwayStatus("picked_up").localStatus === "completed", "picked_up → completed");
  ok(
    leaflyToGreenwayStatus("canceled").localStatus === "cancelled",
    "canceled (1 l) → cancelled (2 ls) — the spelling bridge works",
  );

  // Expired is the nuanced one.
  const expired = leaflyToGreenwayStatus("expired");
  ok(expired.known, "expired is a recognised Leafly status");
  ok(
    expired.localStatus === null,
    "expired maps to NO local status — not cancelled, not no_show",
  );
  ok(expired.terminal, "expired is terminal");
  ok(
    expired.localStatus !== "cancelled",
    "expired must not be recorded as cancelled (erases who did it)",
  );
  ok(
    expired.localStatus !== "no_show",
    "expired must not be recorded as no_show (blames the customer)",
  );

  // Delivery statuses.
  for (const s of LEAFLY_DELIVERY_ONLY_STATUSES) {
    const m = leaflyToGreenwayStatus(s);
    ok(m.known, `${s} is recognised`);
    ok(m.deliveryOnly, `${s} is flagged delivery-only`);
    ok(m.localStatus === null, `${s} has no local equivalent (WA prohibits delivery)`);
    ok(!m.terminal, `${s} is not terminal`);
  }

  // Unknown input fails soft.
  const unknown = leaflyToGreenwayStatus("teleported");
  ok(!unknown.known, "an unrecognised status is reported unknown");
  ok(unknown.localStatus === null, "and maps to nothing");
  ok(
    unknown.explanation.includes("teleported"),
    "and the explanation quotes the offending value so it can be searched for",
  );

  // Every Leafly status is handled — no silent default.
  for (const s of LEAFLY_ORDER_STATUS_SEQUENCE) {
    ok(leaflyToGreenwayStatus(s).known, `${s} is explicitly handled, not defaulted`);
  }

  // Terminal flags agree with the constant.
  for (const s of LEAFLY_ORDER_STATUS_SEQUENCE) {
    const expectedTerminal = s === "picked_up" || s === "canceled" || s === "expired";
    ok(
      leaflyToGreenwayStatus(s).terminal === expectedTerminal,
      `${s} terminal flag is correct`,
    );
  }

  // -- Outbound mapping ----------------------------------------------------
  const newOut = greenwayToLeaflyStatus("new");
  ok(!newOut.sendable, "a new order is not sendable");
  ok(
    newOut.leaflyStatus !== "confirmed",
    "a new order must NOT be reported as confirmed (that would fake an acknowledgement)",
  );
  ok(newOut.leaflyStatus === null, "and carries no status at all");

  ok(greenwayToLeaflyStatus("acknowledged").leaflyStatus === "confirmed", "acknowledged → confirmed");
  ok(greenwayToLeaflyStatus("preparing").leaflyStatus === "confirmed", "preparing → confirmed");
  ok(
    greenwayToLeaflyStatus("preparing").leaflyStatus !== "ready",
    "preparing must NOT be reported as ready (customer would arrive to wait)",
  );
  ok(greenwayToLeaflyStatus("ready").leaflyStatus === "ready", "ready → ready");
  ok(greenwayToLeaflyStatus("completed").leaflyStatus === "picked_up", "completed → picked_up");

  const cancelledOut = greenwayToLeaflyStatus("cancelled");
  ok(cancelledOut.leaflyStatus === "canceled", "cancelled (2 ls) → canceled (1 l)");
  ok(
    cancelledOut.cancelationReasonCode === "dispensary",
    "a shop-side cancellation carries reason 'dispensary'",
  );

  const noShowOut = greenwayToLeaflyStatus("no_show");
  ok(noShowOut.leaflyStatus === "canceled", "no_show → canceled");
  ok(
    noShowOut.cancelationReasonCode === "not_picked_up",
    "no_show carries reason 'not_picked_up', preserving the distinction",
  );
  ok(
    noShowOut.cancelationReasonCode !== cancelledOut.cancelationReasonCode,
    "no_show and cancelled are NOT collapsed into the same reason",
  );

  // A cancellation always has a reason; a non-cancellation never does.
  for (const s of GREENWAY_ORDER_STATUSES) {
    const m = greenwayToLeaflyStatus(s);
    if (m.leaflyStatus === "canceled") {
      ok(m.cancelationReasonCode !== null, `${s} → canceled supplies a reason code`);
      ok(
        (LEAFLY_CANCEL_REASONS as readonly string[]).includes(m.cancelationReasonCode ?? ""),
        `${s} reason code is in Leafly's enum`,
      );
    } else {
      ok(m.cancelationReasonCode === null, `${s} is not a cancellation, so carries no reason`);
    }
  }

  // Never emit a receive-only status.
  for (const s of GREENWAY_ORDER_STATUSES) {
    const m = greenwayToLeaflyStatus(s);
    if (m.leaflyStatus) {
      ok(
        !isReceiveOnlyLeaflyStatus(m.leaflyStatus),
        `${s} does not map to a receive-only status (${m.leaflyStatus})`,
      );
      ok(isLeaflyStatus(m.leaflyStatus), `${s} maps to a real Leafly status`);
    }
  }

  ok(!greenwayToLeaflyStatus("banana").sendable, "an unknown local status is not sendable");

  // -- Predicates ----------------------------------------------------------
  ok(isLeaflyStatus("pending") && isLeaflyStatus("expired"), "valid Leafly statuses recognised");
  ok(!isLeaflyStatus("cancelled"), "Greenway's spelling is not a Leafly status");
  ok(!isLeaflyStatus(""), "empty string is not a status");
  ok(!isLeaflyStatus(null), "null is not a status");
  ok(!isLeaflyStatus(123), "a number is not a status");
  ok(isGreenwayStatus("no_show"), "no_show is a Greenway status");
  ok(!isGreenwayStatus("canceled"), "Leafly's spelling is not a Greenway status");

  ok(isTerminalLeaflyStatus("picked_up"), "picked_up is terminal");
  ok(isTerminalLeaflyStatus("canceled"), "canceled is terminal");
  ok(!isTerminalLeaflyStatus("ready"), "ready is not terminal");

  ok(isReceiveOnlyLeaflyStatus("pending"), "pending is receive-only");
  ok(isReceiveOnlyLeaflyStatus("expired"), "expired is receive-only");
  ok(!isReceiveOnlyLeaflyStatus("ready"), "ready is settable");

  ok(!isSettableLeaflyStatus("pending"), "pending cannot be set");
  ok(!isSettableLeaflyStatus("expired"), "expired cannot be set");
  ok(isSettableLeaflyStatus("picked_up"), "picked_up CAN be set (terminal ≠ unsettable)");
  ok(isSettableLeaflyStatus("canceled"), "canceled can be set");
  ok(!isSettableLeaflyStatus("nonsense"), "a non-status cannot be set");

  // -- Transitions ---------------------------------------------------------
  ok(isForwardLeaflyTransition("pending", "confirmed"), "pending → confirmed is forward");
  ok(isForwardLeaflyTransition("confirmed", "ready"), "confirmed → ready is forward");
  ok(isForwardLeaflyTransition("ready", "picked_up"), "ready → picked_up is forward");
  ok(!isForwardLeaflyTransition("ready", "confirmed"), "ready → confirmed is backwards");
  ok(!isForwardLeaflyTransition("picked_up", "ready"), "nothing leaves a terminal state");
  ok(!isForwardLeaflyTransition("canceled", "ready"), "nothing leaves cancellation either");
  ok(!isForwardLeaflyTransition("ready", "ready"), "a no-op is not progress");
  ok(isForwardLeaflyTransition("pending", "canceled"), "cancellation is allowed from pending");
  ok(isForwardLeaflyTransition("ready", "canceled"), "cancellation is allowed from ready");
  ok(
    !isForwardLeaflyTransition("ready", "expired"),
    "expired is Leafly's to set, not ours to progress to",
  );
  ok(!isForwardLeaflyTransition("bogus", "ready"), "an unknown source is not a valid transition");
  ok(!isForwardLeaflyTransition("ready", "bogus"), "an unknown target is not a valid transition");
  ok(
    isForwardLeaflyTransition("pending", "picked_up"),
    "skipping ahead is still forward (Leafly forbids ONLY direct-to-picked_up as the sole supported move)",
  );

  // -- The acknowledgement clock -------------------------------------------
  ok(LEAFLY_ACK_WINDOW_MINUTES === 15, "the documented window is fifteen minutes");

  const t0 = new Date("2026-09-17T12:00:00Z");
  const done = assessAcknowledgement({
    acknowledgeBy: "2026-09-17T12:15:00Z",
    acknowledgedAt: "2026-09-17T12:01:00Z",
    now: t0,
  });
  ok(done.urgency === "acknowledged", "an acknowledged order is not urgent");
  ok(done.secondsRemaining === null, "and reports no countdown");

  const plenty = assessAcknowledgement({
    acknowledgeBy: "2026-09-17T12:14:00Z",
    acknowledgedAt: null,
    now: t0,
  });
  ok(plenty.urgency === "ok", "14 minutes out is ok");
  ok(plenty.secondsRemaining === 840, "and the countdown is exact");

  const soon = assessAcknowledgement({
    acknowledgeBy: "2026-09-17T12:02:00Z",
    acknowledgedAt: null,
    now: t0,
  });
  ok(soon.urgency === "urgent", "2 minutes out is urgent");
  ok(soon.secondsRemaining === 120, "with an exact countdown");

  // Boundary: exactly at the urgent threshold IS urgent.
  const boundary = assessAcknowledgement({
    acknowledgeBy: new Date(t0.getTime() + LEAFLY_ACK_URGENT_SECONDS * 1000).toISOString(),
    acknowledgedAt: null,
    now: t0,
  });
  ok(
    boundary.urgency === "urgent",
    "exactly at the urgency threshold counts as urgent (inclusive boundary)",
  );
  const justOutside = assessAcknowledgement({
    acknowledgeBy: new Date(t0.getTime() + (LEAFLY_ACK_URGENT_SECONDS + 1) * 1000).toISOString(),
    acknowledgedAt: null,
    now: t0,
  });
  ok(justOutside.urgency === "ok", "one second past the threshold is not yet urgent");

  const gone = assessAcknowledgement({
    acknowledgeBy: "2026-09-17T11:59:00Z",
    acknowledgedAt: null,
    now: t0,
  });
  ok(gone.urgency === "expired", "a passed deadline is expired");
  ok(gone.secondsRemaining === -60, "and the overshoot is reported as negative");
  ok(
    gone.message.includes(LEAFLY_CANCEL_REASON_WE_MISSED_ACK),
    "the expired message names the cancel reason Leafly will use, so it can be recognised",
  );

  // Exactly at the deadline is expired, not urgent — the safe direction.
  const exactly = assessAcknowledgement({
    acknowledgeBy: "2026-09-17T12:00:00Z",
    acknowledgedAt: null,
    now: t0,
  });
  ok(exactly.urgency === "expired", "exactly at the deadline counts as expired, not urgent");

  // Unknown deadline fails LOUD.
  const noDeadline = assessAcknowledgement({
    acknowledgeBy: null,
    acknowledgedAt: null,
    now: t0,
  });
  ok(noDeadline.urgency === "unknown", "a missing deadline is unknown, never invented");
  ok(noDeadline.secondsRemaining === null, "and has no countdown");
  ok(
    noDeadline.message.toLowerCase().includes("acknowledge it now") ||
      noDeadline.message.toLowerCase().includes("fifteen minutes"),
    "and tells staff to act rather than wait",
  );

  const badDeadline = assessAcknowledgement({
    acknowledgeBy: "not-a-date",
    acknowledgedAt: null,
    now: t0,
  });
  ok(badDeadline.urgency === "unknown", "an unparseable deadline is unknown");
  ok(
    badDeadline.message.includes("not-a-date"),
    "and quotes the bad value so it can be diagnosed",
  );

  const badNow = assessAcknowledgement({
    acknowledgeBy: "2026-09-17T12:15:00Z",
    acknowledgedAt: null,
    now: new Date("invalid"),
  });
  ok(badNow.urgency === "unknown", "an unreadable clock yields unknown rather than a wrong answer");

  // Acknowledged wins even when the deadline is unreadable.
  ok(
    assessAcknowledgement({ acknowledgeBy: "junk", acknowledgedAt: "2026-09-17T12:00:00Z", now: t0 })
      .urgency === "acknowledged",
    "an already-acknowledged order is never reported as at risk",
  );

  // -- Nothing throws ------------------------------------------------------
  let threw = false;
  const hostile = ["", "  ", "PENDING", "Canceled", "null", "0"];
  for (const h of hostile) {
    try {
      leaflyToGreenwayStatus(h);
      greenwayToLeaflyStatus(h);
      isForwardLeaflyTransition(h, h);
      isSettableLeaflyStatus(h);
      assessAcknowledgement({ acknowledgeBy: h, acknowledgedAt: null, now: t0 });
    } catch {
      threw = true;
    }
  }
  ok(!threw, "no hostile status string makes any exported function throw");

  // Case sensitivity: Leafly's enum is lowercase, so uppercase is NOT a match.
  ok(!leaflyToGreenwayStatus("PENDING").known, "status matching is case-sensitive, as the enum is");
  ok(!isLeaflyStatus("Canceled"), "capitalised Canceled is not Leafly's value");

  return { passed, failed };
}
