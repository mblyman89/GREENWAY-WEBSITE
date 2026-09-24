/**
 * src/lib/leafly/lifecycle-core.ts
 *
 * SLICE L-31 — WHERE ARE WE IN THIS ORDER, AND WHAT IS THE ONE NEXT THING?
 *
 * ===========================================================================
 * THE REPORT THIS FILE EXISTS TO ANSWER
 * ===========================================================================
 *   > "I clicked confirm first, then ready for pick up, then picked up. but
 *   >  the order does not change from open to completed and stays visible in
 *   >  the table. I think we need to make it much more obvious which step we
 *   >  are on, and then we will know we are finished because the order with be
 *   >  marked complete and moved to the hidden table."
 *
 * The screenshot that came with it shows FOUR buttons side by side — Confirm
 * order, Mark ready for pickup, Mark picked up, Cancel on Leafly — with
 * nothing on screen saying which of them had already been pressed. That is
 * not a cosmetic complaint. A counter operator under a fifteen-minute Leafly
 * auto-cancel clock cannot be asked to infer their position in a state machine
 * from the absence of feedback.
 *
 * ===========================================================================
 * WHY A SEPARATE PURE FILE
 * ===========================================================================
 * `order-ack-core.ts` already decides what is LEGAL (`planLeaflyOrderActions`,
 * `decideStatusChange`). That is a different question from what is NEXT.
 *
 *   legal  : "Leafly would accept confirmed, ready, picked_up or canceled."
 *   next   : "You are on step 2 of 4. Do this one thing."
 *
 * Conflating them is precisely what produced the four-button screenshot:
 * every legal move was offered with equal weight, so the screen said nothing
 * about progress. This file adds the second question without weakening the
 * first — everything here is DERIVED from the legality decision, never a
 * parallel re-implementation of it. House rule 11.
 *
 * ===========================================================================
 * EVERY FACT BELOW IS FROM THE VENDORED SPEC
 * ===========================================================================
 * `docs/leafly-specs/order-api-v1.openapi.json`, md5
 * `daab7bcf6f77177de85425adf7f805f1`, re-downloaded live during this slice
 * and confirmed byte-identical.
 *
 *   • `OrderStatus` enum (components/schemas/OrderStatus):
 *       pending, confirmed, ready, out_for_delivery, arrived_at_customer,
 *       picked_up, canceled, expired
 *
 *   • POST /{key}/orders/{id}/status — "Move an order along its lifecycle by
 *     advancing its status", with these constraints, verbatim:
 *       - "Updates to order status are only available after an order has been
 *          acknowledged"
 *       - "Order statuses can only be moved forward"
 *       - "Orders cannot be moved from their current status to the same status"
 *       - "Orders cannot be moved out of a terminal status (`picked_up`,
 *          `canceled`, `expired`)"
 *       - "Orders cannot be moved to 'pending' or 'expired' status with this
 *          endpoint"
 *
 *   • And the expectation that governs the SHAPE of this UI:
 *       "Not all statuses are required (as our systems might not have a clear
 *        1:1 status mapping), but for example, supporting only direct movement
 *        to `picked_up` would not be allowed. ... it is expected that the
 *        status updates issued are a best-approximation ... and that they
 *        result in a reasonably smooth and intuitive order lifecycle for the
 *        end shopper."
 *
 * That last clause is why this file does NOT collapse the lifecycle into a
 * single "Complete order" button, even though that would be the simplest
 * possible UI. Leafly explicitly forbids jumping straight to `picked_up`.
 *
 * ===========================================================================
 * THE CUSTOMER-COMMUNICATION QUESTION, ANSWERED HERE BECAUSE IT SHAPES THE UI
 * ===========================================================================
 *   > "the communication from leafly from going through the process only
 *   >  generated one email... surely there is more communication from this
 *   >  process right?"
 *
 * From the spec's Expectations section, verbatim:
 *
 *   "Leafly will be the sole originator of automated consumer facing
 *    communications related to orders placed on the Leafly platform. That is,
 *    Leafly shoppers should receive _no_ automated emails or text messages
 *    from a partner system with regard to order confirmation, status updates,
 *    etc."
 *
 * So the division of labour is unambiguous:
 *
 *   WE send status transitions.  LEAFLY sends the customer's emails.
 *   We are contractually forbidden from emailing the shopper ourselves.
 *
 * Therefore **every status we fail to send is a customer email that never
 * happens.** One email for a whole order is not Leafly being quiet; it is the
 * symptom of transitions that never landed. There is no separate "notify"
 * endpoint to call and none is missing — the status push IS the notification
 * trigger. That is why this file treats a skipped step as a real defect
 * rather than a shortcut, and why `lifecycleStepsFor()` shows the operator
 * which notifications have and have not been sent on their behalf.
 */

import {
  LEAFLY_ORDER_STATUS_SEQUENCE,
  type LeaflyStatus,
} from "./order-map-core";

/* ========================================================================== *
 * 1. THE STEPS A PICKUP ORDER PASSES THROUGH
 * ========================================================================== */

/**
 * The four checkpoints an operator actually experiences, in order.
 *
 * `acknowledged` is a step even though it is not an `OrderStatus`, because it
 * is a distinct thing the human did and a distinct thing Leafly required of
 * us. Hiding it would make the first status jump look like it came from
 * nowhere.
 *
 * The delivery-only statuses (`out_for_delivery`, `arrived_at_customer`) are
 * deliberately NOT here. Washington permits only on-premises retail sale
 * (RCW 69.50.348), so a Washington pickup order never visits them, and
 * padding the progress bar with two steps that can never complete would make
 * a finished order look two-thirds done forever. `lifecycleStepsFor()` takes
 * the fulfilment mechanism so a genuine delivery order still gets them.
 */
export const LEAFLY_PICKUP_STEP_STATUSES = [
  "confirmed",
  "ready",
  "picked_up",
] as const;

export const LEAFLY_DELIVERY_STEP_STATUSES = [
  "confirmed",
  "ready",
  "out_for_delivery",
  "arrived_at_customer",
  "picked_up",
] as const;

/** What a single checkpoint looks like on screen. */
export type LifecycleStep = {
  /** `"acknowledged"`, or a Leafly status value. */
  key: string;
  /** Short label for the progress strip. Never a raw enum. */
  label: string;
  /**
   * `done`    — already happened.
   * `current` — the one thing to do right now.
   * `todo`    — still ahead.
   */
  state: "done" | "current" | "todo";
  /**
   * What the CUSTOMER is told when this step completes, or null when the step
   * sends nothing. Stated in the UI because the operator's mental model —
   * "did the customer hear about this?" — is otherwise invisible, and because
   * the owner asked precisely this question.
   */
  customerEffect: string | null;
};

/** Human wording for each checkpoint. Deliberately customer-centric. */
const STEP_LABELS: Readonly<Record<string, string>> = {
  acknowledged: "Accepted",
  confirmed: "Confirmed",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  arrived_at_customer: "Arrived",
  picked_up: "Picked up",
};

/**
 * What Leafly tells the shopper when each step lands.
 *
 * Phrased as "Leafly tells the customer…" rather than "we email…" because we
 * are forbidden from emailing them, and an operator who believes OUR system
 * sends the mail will debug the wrong system when a customer says they heard
 * nothing.
 *
 * `acknowledged` is null on purpose: the acknowledgement is a machine receipt
 * ("your system has retrieved this order"), not a lifecycle event, and the
 * spec describes no shopper-visible effect for it. Claiming one would be an
 * invention, and inventing customer-facing behaviour is how this integration
 * got into trouble in the first place.
 */
const STEP_CUSTOMER_EFFECT: Readonly<Record<string, string | null>> = {
  acknowledged: null,
  confirmed: "Leafly tells the shopper the store has accepted their order.",
  ready: "Leafly tells the shopper their order is ready at the counter.",
  out_for_delivery: "Leafly tells the shopper their order is on its way.",
  arrived_at_customer: "Leafly tells the shopper the driver has arrived.",
  picked_up: "Leafly closes the order and follows up with the shopper.",
};

/* ========================================================================== *
 * 2. WHERE ARE WE NOW?
 * ========================================================================== */

export type LifecyclePhase =
  | "awaiting_acknowledgement"
  | "in_progress"
  | "complete"
  | "canceled"
  | "expired";

export type LifecycleView = {
  phase: LifecyclePhase;
  /** One short sentence naming the current position. */
  headline: string;
  /** The single next thing to do, or null when there is nothing. */
  nextLabel: string | null;
  /** The status that `nextLabel` would send, or null. */
  nextStatus: LeaflyStatus | null;
  steps: LifecycleStep[];
  /** 0..1 — how far along, for a progress strip. */
  progress: number;
  /** True when the order is finished and belongs in the hidden table. */
  isClosed: boolean;
};

function stepStatusesFor(fulfillmentMechanism: string | null | undefined) {
  return (fulfillmentMechanism ?? "").trim() === "delivery"
    ? LEAFLY_DELIVERY_STEP_STATUSES
    : LEAFLY_PICKUP_STEP_STATUSES;
}

/**
 * Index of a status within the canonical sequence, or -1.
 *
 * Uses the shared sequence rather than a local list so that a status added to
 * the enum upstream cannot silently acquire a different ordering here.
 */
function sequenceIndex(status: string): number {
  return (LEAFLY_ORDER_STATUS_SEQUENCE as readonly string[]).indexOf(status);
}

/**
 * Build the whole "where am I" view from the three facts that determine it.
 *
 * PURE. No dates, no randomness, no I/O — so it is exhaustively testable and
 * so it renders identically on the server and the client. The L-30 lesson
 * applies directly: a rule whose inputs are all plain facts cannot behave
 * one way in a test and another way in front of the owner.
 */
export function lifecycleView(input: {
  acknowledgedAt: string | null | undefined;
  leaflyStatus: string | null | undefined;
  fulfillmentMechanism: string | null | undefined;
  canceledAt?: string | null | undefined;
}): LifecycleView {
  const status = (input.leaflyStatus ?? "").trim();
  const acknowledged = (input.acknowledgedAt ?? "").trim() !== "";
  const canceled = (input.canceledAt ?? "").trim() !== "" || status === "canceled";
  const stepStatuses = stepStatusesFor(input.fulfillmentMechanism);

  const buildSteps = (
    decide: (stepKey: string) => LifecycleStep["state"],
  ): LifecycleStep[] => {
    const keys = ["acknowledged", ...stepStatuses];
    return keys.map((key) => ({
      key,
      label: STEP_LABELS[key] ?? key,
      state: decide(key),
      customerEffect: STEP_CUSTOMER_EFFECT[key] ?? null,
    }));
  };

  // ── Dead ends first. An expired or cancelled order has no next step, and
  //    offering one would be offering a guaranteed refusal.
  if (status === "expired") {
    return {
      phase: "expired",
      headline: "Expired. Leafly cancelled this order before it was accepted.",
      nextLabel: null,
      nextStatus: null,
      steps: buildSteps(() => "todo"),
      progress: 0,
      isClosed: true,
    };
  }

  if (canceled) {
    return {
      phase: "canceled",
      headline: "Cancelled. Leafly has told the shopper.",
      nextLabel: null,
      nextStatus: null,
      steps: buildSteps((k) => (k === "acknowledged" && acknowledged ? "done" : "todo")),
      progress: 0,
      isClosed: true,
    };
  }

  // ── Not accepted yet: exactly one thing to do, and a clock running.
  if (!acknowledged) {
    return {
      phase: "awaiting_acknowledgement",
      headline: "Not accepted yet. Leafly cancels unaccepted orders automatically.",
      nextLabel: "Accept this order",
      nextStatus: null,
      steps: buildSteps((k) => (k === "acknowledged" ? "current" : "todo")),
      progress: 0,
      isClosed: false,
    };
  }

  // ── Finished.
  if (status === "picked_up") {
    return {
      phase: "complete",
      headline: "Complete. This order is finished and closed on Leafly.",
      nextLabel: null,
      nextStatus: null,
      steps: buildSteps(() => "done"),
      progress: 1,
      isClosed: true,
    };
  }

  // ── In progress. The next step is the first step we have not reached.
  const currentIdx = sequenceIndex(status);
  const nextStatus =
    stepStatuses.find((s) => sequenceIndex(s) > currentIdx) ?? null;

  const steps = buildSteps((key) => {
    if (key === "acknowledged") return "done";
    const idx = sequenceIndex(key);
    if (idx <= currentIdx) return "done";
    if (key === nextStatus) return "current";
    return "todo";
  });

  const doneCount = steps.filter((s) => s.state === "done").length;
  const progress = steps.length === 0 ? 0 : doneCount / steps.length;

  return {
    phase: "in_progress",
    headline: headlineFor(status),
    nextLabel: nextStatus ? NEXT_LABELS[nextStatus] ?? `Mark ${nextStatus}` : null,
    nextStatus: (nextStatus as LeaflyStatus) ?? null,
    steps,
    progress,
    isClosed: false,
  };
}

/**
 * The sentence at the top of the card.
 *
 * Written in terms of what the SHOPPER currently believes, because that is
 * the thing the operator cannot see and most needs to know. "Confirmed" alone
 * tells them nothing actionable; "the shopper has been told you are making
 * it" tells them exactly where they stand.
 */
function headlineFor(status: string): string {
  switch (status) {
    case "pending":
      return "Accepted here, but Leafly has not been told you are making it yet.";
    case "confirmed":
      return "The shopper has been told you accepted their order. Build the bag.";
    case "ready":
      return "The shopper has been told their order is waiting at the counter.";
    case "out_for_delivery":
      return "The shopper has been told their order is on its way.";
    case "arrived_at_customer":
      return "The shopper has been told the driver has arrived.";
    default:
      return "In progress.";
  }
}

const NEXT_LABELS: Readonly<Record<string, string>> = {
  confirmed: "Confirm order",
  ready: "Mark ready for pickup",
  out_for_delivery: "Mark out for delivery",
  arrived_at_customer: "Mark arrived at customer",
  picked_up: "Mark picked up",
};

/* ========================================================================== *
 * 3. WHAT THE SUCCESSFUL PUSH MUST WRITE BACK
 * ========================================================================== */

/**
 * SLICE L-31, DEFECT 1 — THE WRITE THAT WAS NEVER THERE.
 *
 * Proven by execution in `scripts/recon/l31-status-persistence-probe.mjs`:
 * `setLeaflyOrderStatus()` called Leafly, recorded an attempt row, and
 * returned. NOTHING wrote `leafly_status` back to `leafly_orders`. Meanwhile
 * `placeLeaflyOrder()` (bridge-core) buckets the board EXCLUSIVELY on that
 * column. So:
 *
 *   push confirmed -> Leafly moves -> our row still says "pending"
 *     -> decideStatusChange(pending -> confirmed) is STILL legal
 *     -> "Confirm order" is offered again
 *     -> all four buttons stay on screen, forever
 *     -> the card never leaves TO BUILD
 *
 * which is exactly the screenshot. And because every call SUCCEEDED, no error
 * was ever shown. The owner pressed three buttons, all three worked, and the
 * screen did not move.
 *
 * ── WHY THE RESPONSE BODY IS THE RIGHT SOURCE, NOT THE REQUESTED STATUS ──
 * The spec declares `POST /status` responds **200 with the full Order**
 * (`responses.OrderResponse` -> `schemas/Order`). That body is Leafly's own
 * post-change truth. Writing back what we ASKED for would re-introduce the
 * same class of bug this slice is fixing: believing our intent instead of
 * their confirmation. If Leafly normalised, clamped or otherwise altered the
 * order, the body says so and the request does not.
 *
 * The requested status is kept only as a FALLBACK for the case where the body
 * is unusable (empty, or not an object). A 200 with an unreadable body still
 * means the transition happened — refusing to record it would leave the row
 * stale for the exact reason we are fixing.
 */
export type StatusWriteback = {
  /** Write this to `leafly_orders.leafly_status`. */
  status: string;
  /** Where it came from — surfaced in logs so a fallback is never silent. */
  source: "response_body" | "requested";
  /**
   * True when the response body was present and usable. False means we fell
   * back, which is worth a log line but is NOT an error.
   */
  usedResponseBody: boolean;
};

/**
 * Decide what to persist after a SUCCESSFUL status push.
 *
 * @param requestedStatus what we asked Leafly to set.
 * @param responseStatus  the `status` field read out of Leafly's 200 body,
 *                        already normalised by `normaliseFetchedOrder`.
 *
 * Deliberately takes the already-extracted string rather than the raw body:
 * parsing belongs to `order-fetch-core`, which owns the Order shape and is
 * tested against the vendored schema. Re-parsing here would be a second,
 * divergent reader of the same contract.
 */
export function decideStatusWriteback(input: {
  requestedStatus: string;
  responseStatus: string | null | undefined;
}): StatusWriteback {
  const fromBody = (input.responseStatus ?? "").trim();
  if (fromBody !== "") {
    return { status: fromBody, source: "response_body", usedResponseBody: true };
  }
  return {
    status: input.requestedStatus.trim(),
    source: "requested",
    usedResponseBody: false,
  };
}

/* ========================================================================== *
 * 4. CLOSING THE GREENWAY ORDER
 * ========================================================================== */

/**
 * SLICE L-31, DEFECT 3 — TWO SETS OF BOOKS, ONE OF WHICH NEVER CLOSED.
 *
 * `bridge-server.ts` exports `onLeaflyOrderArrived`, `onLeaflyOrderAccepted`
 * and `onLeaflyOrderCanceled`. There was no pickup equivalent. So even once
 * `leafly_status` reached `picked_up`, the GREENWAY `orders` row that the
 * bridge created at acceptance stayed open at the register forever.
 *
 * This function decides — purely — whether a Leafly transition should close
 * the local order, and to what.
 *
 * ── WHY `picked_up` MAPS TO `completed` AND NOT TO A SALE ──
 * Leafly does not process payments (spec: "At present Leafly does not process
 * payments for orders placed on its platform"). Money is collected at the
 * counter through the register. `picked_up` therefore means "the customer has
 * their bag", which is Greenway's `completed`, and it must NOT be taken as a
 * signal to fabricate a paid sale. The register's own completion gate
 * (WAC 314-55-095) still governs anything money-shaped.
 */
export type LocalClosePlan = {
  /** Whether the Greenway order should be moved at all. */
  shouldClose: boolean;
  /** The Greenway status to move it to, or null. */
  localStatus: "completed" | "cancelled" | null;
  /** Why — for the audit row and for the operator-facing message. */
  reason: string;
};

export function planLocalClose(input: {
  leaflyStatus: string;
  localOrderId: string | null | undefined;
}): LocalClosePlan {
  const status = input.leaflyStatus.trim();
  const hasLocal = (input.localOrderId ?? "").trim() !== "";

  if (!hasLocal) {
    return {
      shouldClose: false,
      localStatus: null,
      reason: "No register order is linked to this Leafly order.",
    };
  }

  if (status === "picked_up") {
    return {
      shouldClose: true,
      localStatus: "completed",
      reason: "The customer has collected this order on Leafly.",
    };
  }

  if (status === "canceled" || status === "expired") {
    return {
      shouldClose: true,
      localStatus: "cancelled",
      reason: `This order is ${status} on Leafly.`,
    };
  }

  return {
    shouldClose: false,
    localStatus: null,
    reason: `"${status}" is not a closing status.`,
  };
}

/* ========================================================================== *
 * 4b. WHAT THE OPERATOR IS TOLD AFTER A SUCCESSFUL STATUS PUSH (SLICE L-35)
 * ========================================================================== */

/**
 * SLICE L-35 — "Leafly accepted the request (200)" proved too little.
 *
 * The owner pressed Confirm and Mark ready, saw that sentence both times, and
 * received no email either time — only the review request after Picked up. He
 * could not tell whether Leafly had really moved the order or had merely
 * answered 200.
 *
 * Leafly's 200 carries the full Order (spec: `responses.OrderResponse`), so
 * the answer was already in hand and being thrown away at the screen. This
 * function turns it into a sentence that says WHAT LEAFLY NOW SHOWS, and
 * raises a warning in the one case that deserves it: Leafly answered 200 but
 * its own copy of the order does not show the step we sent.
 *
 * It deliberately does NOT promise the shopper got an email. The spec makes
 * Leafly "the sole originator of automated consumer facing communications"
 * and forbids us from sending them; which steps Leafly chooses to email about
 * is Leafly's configuration, not something this system can observe. Claiming
 * otherwise would be exactly the kind of guess the standing rules forbid.
 */
export type StatusPushOutcome = {
  /** "verified": Leafly's body shows the requested status. */
  verdict: "verified" | "mismatch" | "unverifiable";
  /** Sentence for the success banner. Never empty. */
  message: string;
  /** Sentence for the warning banner, or null when nothing is wrong. */
  warning: string | null;
};

export function describeStatusPushOutcome(input: {
  requestedStatus: string;
  responseStatus: string | null | undefined;
  /** Plain-English label for a status; null for an unknown value. */
  label: (status: string) => string | null;
}): StatusPushOutcome {
  const requested = input.requestedStatus.trim();
  const reported = (input.responseStatus ?? "").trim();
  const name = (s: string) => {
    const l = input.label(s);
    return l ? `“${l}”` : `“${s}”`;
  };
  const whoTellsShopper =
    "Any notice to the shopper about this step comes from Leafly, not from us.";

  if (reported === "") {
    return {
      verdict: "unverifiable",
      message:
        `Leafly accepted the change to ${name(requested)} (200), but did not send back ` +
        `its copy of the order, so we could not double-check it. ${whoTellsShopper}`,
      warning: null,
    };
  }
  if (reported === requested) {
    return {
      verdict: "verified",
      message:
        `Done — Leafly now shows this order as ${name(reported)}. ` +
        `(Checked against the order Leafly sent back, not just its 200.) ${whoTellsShopper}`,
      warning: null,
    };
  }
  return {
    verdict: "mismatch",
    message: `Leafly answered 200, and its copy of the order shows ${name(reported)}.`,
    warning:
      `We asked Leafly for ${name(requested)}, but the order Leafly sent back shows ` +
      `${name(reported)}. The board now follows Leafly. If the shopper was expecting ` +
      `an update for this step, this is worth raising with Leafly support ` +
      `(api-support@leafly.com), quoting the order number.`,
  };
}

/* ========================================================================== *
 * 5. SELF-TESTS
 * ========================================================================== */

function eq(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `lifecycle-core self-test failed: ${label}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
  }
}

function ok(label: string, value: boolean): void {
  if (!value) throw new Error(`lifecycle-core self-test failed: ${label}`);
}

/**
 * Exhaustive, deterministic self-tests.
 *
 * Runs in CI via `tests/compliance/leafly-l31-lifecycle.test.ts`. Kept in the
 * source file, beside the rules, so a change to a rule and a change to its
 * proof are never more than a few lines apart.
 */
export function runLifecycleCoreSelfTests(): { passed: number } {
  let passed = 0;
  const t = (label: string, fn: () => void) => {
    fn();
    passed += 1;
  };

  // ── The unacknowledged order: one action, no progress.
  t("unacknowledged -> awaiting_acknowledgement", () => {
    const v = lifecycleView({
      acknowledgedAt: null,
      leaflyStatus: "pending",
      fulfillmentMechanism: "pickup",
    });
    eq("phase", v.phase, "awaiting_acknowledgement");
    eq("next", v.nextLabel, "Accept this order");
    eq("progress", v.progress, 0);
    ok("not closed", !v.isClosed);
    eq(
      "the acknowledge step is current",
      v.steps.find((s) => s.key === "acknowledged")?.state,
      "current",
    );
  });

  // ── THE OWNER'S EXACT BUG. Acknowledged, status still pending.
  t("acknowledged + pending -> next is confirm, and it is the ONLY next", () => {
    const v = lifecycleView({
      acknowledgedAt: "2026-09-24T01:00:00Z",
      leaflyStatus: "pending",
      fulfillmentMechanism: "pickup",
    });
    eq("phase", v.phase, "in_progress");
    eq("next status", v.nextStatus, "confirmed");
    eq("next label", v.nextLabel, "Confirm order");
    eq(
      "acknowledged is done",
      v.steps.find((s) => s.key === "acknowledged")?.state,
      "done",
    );
    eq(
      "confirmed is current",
      v.steps.find((s) => s.key === "confirmed")?.state,
      "current",
    );
    eq(
      "ready is still todo",
      v.steps.find((s) => s.key === "ready")?.state,
      "todo",
    );
    eq(
      "picked_up is still todo",
      v.steps.find((s) => s.key === "picked_up")?.state,
      "todo",
    );
  });

  t("confirmed -> next is ready", () => {
    const v = lifecycleView({
      acknowledgedAt: "x",
      leaflyStatus: "confirmed",
      fulfillmentMechanism: "pickup",
    });
    eq("next", v.nextStatus, "ready");
    eq(
      "confirmed now done",
      v.steps.find((s) => s.key === "confirmed")?.state,
      "done",
    );
    ok("progress advanced", v.progress > 0 && v.progress < 1);
  });

  t("ready -> next is picked_up", () => {
    const v = lifecycleView({
      acknowledgedAt: "x",
      leaflyStatus: "ready",
      fulfillmentMechanism: "pickup",
    });
    eq("next", v.nextStatus, "picked_up");
    eq("label", v.nextLabel, "Mark picked up");
  });

  t("picked_up -> complete, closed, no next action", () => {
    const v = lifecycleView({
      acknowledgedAt: "x",
      leaflyStatus: "picked_up",
      fulfillmentMechanism: "pickup",
    });
    eq("phase", v.phase, "complete");
    eq("next", v.nextStatus, null);
    eq("progress", v.progress, 1);
    ok("closed", v.isClosed);
    ok("every step done", v.steps.every((s) => s.state === "done"));
  });

  t("canceled -> closed with no next action", () => {
    const v = lifecycleView({
      acknowledgedAt: "x",
      leaflyStatus: "canceled",
      fulfillmentMechanism: "pickup",
    });
    eq("phase", v.phase, "canceled");
    eq("next", v.nextStatus, null);
    ok("closed", v.isClosed);
  });

  t("canceledAt set but status not yet canceled -> still canceled", () => {
    const v = lifecycleView({
      acknowledgedAt: "x",
      leaflyStatus: "confirmed",
      fulfillmentMechanism: "pickup",
      canceledAt: "2026-09-24T02:00:00Z",
    });
    eq("phase", v.phase, "canceled");
    ok("closed", v.isClosed);
  });

  t("expired -> closed, and is NOT reported as cancelled", () => {
    const v = lifecycleView({
      acknowledgedAt: null,
      leaflyStatus: "expired",
      fulfillmentMechanism: "pickup",
    });
    eq("phase", v.phase, "expired");
    ok("closed", v.isClosed);
  });

  // ── Washington: a pickup order never shows delivery steps.
  t("pickup orders never show delivery steps", () => {
    const v = lifecycleView({
      acknowledgedAt: "x",
      leaflyStatus: "confirmed",
      fulfillmentMechanism: "pickup",
    });
    ok(
      "no delivery steps",
      !v.steps.some(
        (s) => s.key === "out_for_delivery" || s.key === "arrived_at_customer",
      ),
    );
    eq("four steps exactly", v.steps.length, 4);
  });

  t("a delivery order DOES show delivery steps", () => {
    const v = lifecycleView({
      acknowledgedAt: "x",
      leaflyStatus: "confirmed",
      fulfillmentMechanism: "delivery",
    });
    ok(
      "has out_for_delivery",
      v.steps.some((s) => s.key === "out_for_delivery"),
    );
    eq("next after confirmed is ready", v.nextStatus, "ready");
    eq("six steps", v.steps.length, 6);
  });

  t("an unknown fulfilment mechanism is treated as pickup", () => {
    for (const m of [null, undefined, "", "  ", "curbside", "DELIVERY"]) {
      const v = lifecycleView({
        acknowledgedAt: "x",
        leaflyStatus: "confirmed",
        fulfillmentMechanism: m,
      });
      ok(
        `"${String(m)}" does not unlock delivery steps`,
        !v.steps.some((s) => s.key === "out_for_delivery"),
      );
    }
  });

  // ── Progress is monotonic. A screen that goes backwards is worse than none.
  t("progress never decreases along the lifecycle", () => {
    const seq = ["pending", "confirmed", "ready", "picked_up"];
    let last = -1;
    for (const s of seq) {
      const v = lifecycleView({
        acknowledgedAt: "x",
        leaflyStatus: s,
        fulfillmentMechanism: "pickup",
      });
      ok(`progress at ${s} >= previous`, v.progress >= last);
      last = v.progress;
    }
  });

  // ── Exactly one "current" step, always. Two would reproduce the four-button
  //    ambiguity this slice exists to remove.
  t("there is never more than one current step", () => {
    const states = [
      { a: null as string | null, s: "pending" },
      { a: "x", s: "pending" },
      { a: "x", s: "confirmed" },
      { a: "x", s: "ready" },
      { a: "x", s: "picked_up" },
      { a: "x", s: "canceled" },
      { a: null as string | null, s: "expired" },
    ];
    for (const st of states) {
      for (const m of ["pickup", "delivery"]) {
        const v = lifecycleView({
          acknowledgedAt: st.a,
          leaflyStatus: st.s,
          fulfillmentMechanism: m,
        });
        const currents = v.steps.filter((x) => x.state === "current").length;
        ok(`${st.s}/${m}: at most one current (${currents})`, currents <= 1);
      }
    }
  });

  // ── Every step label is human. A raw enum at a customer-facing counter is
  //    a defect, and it is the one `LEAFLY_STATUS_ACTION_WORDING` exists for.
  t("no step label is a raw enum value", () => {
    const v = lifecycleView({
      acknowledgedAt: "x",
      leaflyStatus: "confirmed",
      fulfillmentMechanism: "delivery",
    });
    for (const s of v.steps) {
      ok(`${s.key} has a human label`, !/_/.test(s.label) && s.label !== s.key);
    }
  });

  // ── The customer-communication answer, pinned.
  t("every status step names its customer effect; acknowledge names none", () => {
    const v = lifecycleView({
      acknowledgedAt: "x",
      leaflyStatus: "pending",
      fulfillmentMechanism: "delivery",
    });
    eq(
      "acknowledged has no customer effect",
      v.steps.find((s) => s.key === "acknowledged")?.customerEffect,
      null,
    );
    for (const s of v.steps.filter((x) => x.key !== "acknowledged")) {
      ok(`${s.key} states a customer effect`, (s.customerEffect ?? "").length > 10);
      ok(
        `${s.key} attributes the message to Leafly, not to us`,
        /Leafly/.test(s.customerEffect ?? ""),
      );
    }
  });

  // ── The writeback rule.
  t("writeback prefers Leafly's own response body", () => {
    const w = decideStatusWriteback({
      requestedStatus: "ready",
      responseStatus: "ready",
    });
    eq("status", w.status, "ready");
    eq("source", w.source, "response_body");
    ok("used body", w.usedResponseBody);
  });

  t("writeback trusts the body even when it disagrees with the request", () => {
    // If Leafly says something other than what we asked, THEIR answer wins.
    const w = decideStatusWriteback({
      requestedStatus: "ready",
      responseStatus: "confirmed",
    });
    eq("status", w.status, "confirmed");
    eq("source", w.source, "response_body");
  });

  t("writeback falls back to the requested status when the body is unusable", () => {
    for (const body of [null, undefined, "", "   "]) {
      const w = decideStatusWriteback({
        requestedStatus: "picked_up",
        responseStatus: body,
      });
      eq(`body=${JSON.stringify(body)} -> requested`, w.status, "picked_up");
      eq("source", w.source, "requested");
      ok("flagged as a fallback", !w.usedResponseBody);
    }
  });

  // ── SLICE L-35: the post-push sentence.
  {
    const label = (s: string) =>
      s === "ready" ? "Ready for pickup" : s === "confirmed" ? "Confirmed" : null;
    t("L-35: body matches request -> verified, names Leafly's status, no warning", () => {
      const o = describeStatusPushOutcome({ requestedStatus: "ready", responseStatus: "ready", label });
      eq("verdict", o.verdict, "verified");
      ok("names the status", o.message.includes("“Ready for pickup”"));
      ok("no warning", o.warning === null);
      ok("does not promise an email", !/email (was|has been) sent/i.test(o.message));
    });
    t("L-35: body disagrees -> mismatch WITH a warning naming both", () => {
      const o = describeStatusPushOutcome({ requestedStatus: "ready", responseStatus: "confirmed", label });
      eq("verdict", o.verdict, "mismatch");
      ok("warns", o.warning !== null);
      ok("names requested", (o.warning ?? "").includes("“Ready for pickup”"));
      ok("names reported", (o.warning ?? "").includes("“Confirmed”"));
    });
    t("L-35: no status in body -> unverifiable, says so, never claims 'Done'", () => {
      for (const body of [null, undefined, "", "  "]) {
        const o = describeStatusPushOutcome({ requestedStatus: "confirmed", responseStatus: body, label });
        eq("verdict", o.verdict, "unverifiable");
        ok("admits it could not check", /could not double-check/.test(o.message));
        ok("not 'Done'", !o.message.startsWith("Done"));
      }
    });
    t("L-35: an unknown status is shown raw, never given an invented name", () => {
      const o = describeStatusPushOutcome({ requestedStatus: "ready", responseStatus: "brand_new", label });
      ok("raw value shown", (o.warning ?? "").includes("“brand_new”"));
    });
  }

  // ── The local-close rule.
  t("picked_up closes the register order as completed", () => {
    const p = planLocalClose({ leaflyStatus: "picked_up", localOrderId: "local-1" });
    ok("closes", p.shouldClose);
    eq("status", p.localStatus, "completed");
  });

  t("canceled and expired close the register order as cancelled", () => {
    for (const s of ["canceled", "expired"]) {
      const p = planLocalClose({ leaflyStatus: s, localOrderId: "local-1" });
      ok(`${s} closes`, p.shouldClose);
      eq(`${s} status`, p.localStatus, "cancelled");
    }
  });

  t("non-terminal statuses never close the register order", () => {
    for (const s of ["pending", "confirmed", "ready", "out_for_delivery", "arrived_at_customer"]) {
      const p = planLocalClose({ leaflyStatus: s, localOrderId: "local-1" });
      ok(`${s} does not close`, !p.shouldClose);
      eq(`${s} status`, p.localStatus, null);
    }
  });

  t("no linked register order -> nothing to close, and it says so", () => {
    for (const id of [null, undefined, "", "  "]) {
      const p = planLocalClose({ leaflyStatus: "picked_up", localOrderId: id });
      ok("does not close", !p.shouldClose);
      ok("explains why", /No register order/i.test(p.reason));
    }
  });

  // ── The spelling trap. Leafly says "canceled"; Greenway says "cancelled".
  t("the two spellings are not confused", () => {
    const p = planLocalClose({ leaflyStatus: "canceled", localOrderId: "l" });
    eq("Greenway spelling has two Ls", p.localStatus, "cancelled");
  });

  return { passed };
}
