/**
 * src/lib/leafly/order-ack-server.ts
 *
 * SLICE L-6 — the server side of talking BACK to Leafly.
 *
 * This file does the three things a pure core cannot: it reads credentials, it
 * makes network calls, and it writes to the database. Every DECISION it needs
 * has already been made in `order-ack-core.ts`, which is pure and proven by 169
 * assertions. Nothing here re-decides anything, and that separation is not
 * decoration — it is the only reason the rules in this slice are testable
 * without a Leafly account.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * Leafly's Order API v1 (vendored at docs/leafly-specs/order-api-v1.openapi.json,
 * md5 daab7bcf6f77177de85425adf7f805f1) exposes three outbound endpoints. Two of
 * them are implemented here:
 *
 *   POST /{order_integration_key}/orders/{id}/acknowledge  -> 204 on success
 *   POST /{order_integration_key}/orders/{id}/status        -> 200 on success
 *
 * The third, POST .../cart, is deliberately NOT implemented in this slice. It
 * revises cart contents and totals after a short pick, and doing it properly
 * needs a picking UI that does not exist yet. Shipping a half-built version of
 * it would put wrong money in front of a shopper on Leafly's site. It is its own
 * slice, and the migration's `operation` CHECK already accepts 'cart' so that
 * slice needs no schema change.
 *
 * THE THREE THINGS MOST LIKELY TO GO WRONG, AND WHERE EACH IS HANDLED
 * -------------------------------------------------------------------
 * 1. THE WRONG HOST. The Order API is on
 *    reservations-api(-sandbox).leafly.(com|io)/v1/order_integration. The Menu
 *    API — which this codebase has been calling since slice L-2 — is on
 *    api(-sandbox).leafly.(com|io)/v2/menu_integration. The OAuth token URL is
 *    shared between them, which makes it very easy to believe the base URL is
 *    shared too. It is not. This file therefore calls
 *    `leaflyOrderApiBaseUrl()` from the core and NEVER `getLeaflyBaseUrl()`
 *    from config.ts. Getting this wrong produces a 404, which reads like
 *    "Leafly does not have that order" rather than "we asked the wrong
 *    server" — a wrong answer that is easy to act on incorrectly.
 *
 * 2. ACKNOWLEDGING TOO EARLY. Per the spec, acknowledgement is the precondition
 *    for everything else AND it permanently revokes our access to the
 *    customer's ID images. There is no un-acknowledge call. So the decision to
 *    acknowledge is taken by `decideAcknowledgement()` in the core, which
 *    refuses duplicates and terminal orders, and the irreversibility warning
 *    travels with the decision rather than living in a UI string that a second
 *    screen could forget to show.
 *
 * 3. SILENCE. L-5's inbound webhook handlers must fail SOFT, because Leafly's
 *    spec permits only a 200 response; a parsing bug there has to be swallowed.
 *    These outbound endpoints are the exact opposite: Leafly documents
 *    400/401/403/404 for all of them, so every rejection is a real, named,
 *    actionable event. Swallowing one here would be the bug. Hence every
 *    attempt — including every attempt the core REFUSED to make — is written to
 *    leafly_outbound_attempts before this file returns.
 *
 * WHY REFUSALS ARE LOGGED AT ALL
 * ------------------------------
 * A log that only records calls that reached the network is silent about the
 * most common class of operator mistake: pressing "ready" on an order that was
 * never acknowledged, or "confirmed" on one that is already picked up. Those
 * produce no HTTP traffic, so they would leave no trace, and the operator would
 * have nothing to show anyone. Leafly also certifies "by review of logged
 * activity", so the log is evidence rather than debug noise.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getLeaflyConfig } from "./config";
import { refreshLeaflyConfig } from "./runtime";
import { getLeaflyAccessToken, resetLeaflyTokenCache } from "./token";
import { loadLeaflyOrderIntegrationKey } from "./webhook-server";
import {
  LEAFLY_ACK_SUCCESS_STATUS,
  LEAFLY_STATUS_SUCCESS_STATUS,
  assessOutboundResponse,
  decideAcknowledgement,
  decideStatusChange,
  leaflyAcknowledgeUrl,
  leaflyStatusUrl,
  type AckDecision,
  type OutboundAssessment,
  type StatusChangeDecision,
} from "./order-ack-core";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Which endpoint an attempt was aimed at. Mirrors the migration's CHECK. */
export type OutboundOperation = "acknowledge" | "status" | "cart";

export type OutboundResult = {
  ok: boolean;
  /** True when no HTTP request was made because the pure core refused. */
  refused: boolean;
  /** The core's decision code, whichever core decided. Always present. */
  code: string;
  /** Plain-English outcome, safe to show a human. Never empty. */
  message: string;
  /** Raw HTTP status, or null when nothing was sent. */
  httpStatus: number | null;
  /** The classifier's verdict, or null when nothing was sent. */
  assessment: OutboundAssessment | null;
  /**
   * The irreversibility warning, carried through from the core on a successful
   * acknowledgement so a caller can surface what just happened permanently.
   */
  warning: string | null;
};

/** What the order row must supply for a decision to be made about it. */
export type LeaflyOrderSnapshot = {
  leafly_order_id: string | null;
  leafly_status: string | null;
  acknowledged_at: string | null;
};

// ---------------------------------------------------------------------------
// The attempt log
// ---------------------------------------------------------------------------

type AttemptRow = {
  leaflyOrderId: string | null;
  orderIntegrationKey: string | null;
  operation: OutboundOperation;
  requestedStatus?: string | null;
  cancelationReasonCode?: string | null;
  requestBody?: unknown;
  responseStatus?: number | null;
  responseBody?: unknown;
  disposition?: OutboundAssessment["disposition"] | null;
  refusalCode?: string | null;
  message: string;
  createdBy?: string | null;
};

/**
 * Record one outbound attempt. Best-effort by design.
 *
 * This deliberately does NOT throw. If the log write fails, the operator still
 * needs to learn what Leafly said about their customer's order — losing the
 * audit row is bad, but converting it into a thrown error that hides the actual
 * API result would be worse. The failure is console-logged so it is not silent,
 * which is the same posture recordSyndicationLog() takes.
 *
 * Note the integration key is COPIED into each row rather than joined at read
 * time. The key can be re-entered or corrected on the Integrations page, and a
 * joined audit log would then retroactively claim historical attempts used a
 * key they never used. An audit log that mutates is not an audit log.
 */
async function recordAttempt(row: AttemptRow): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("leafly_outbound_attempts").insert({
      leafly_order_id: row.leaflyOrderId,
      order_integration_key: row.orderIntegrationKey,
      operation: row.operation,
      requested_status: row.requestedStatus ?? null,
      cancelation_reason_code: row.cancelationReasonCode ?? null,
      request_body: row.requestBody ?? null,
      response_status: row.responseStatus ?? null,
      response_body: row.responseBody ?? null,
      disposition: row.disposition ?? null,
      refusal_code: row.refusalCode ?? null,
      message: row.message,
      created_by: row.createdBy ?? null,
    });
    if (error) {
      console.error("[leafly/outbound] attempt log insert failed:", error.message);
    }
  } catch (err) {
    console.error("[leafly/outbound] attempt log threw:", err);
  }
}

// ---------------------------------------------------------------------------
// The authorized POST
// ---------------------------------------------------------------------------

type RawResponse = {
  status: number | null;
  body: unknown;
  /** Set when the request never completed (DNS, TLS, timeout, offline). */
  networkError: string | null;
};

/**
 * POST to the ORDER API with a bearer token, retrying a 401 exactly once.
 *
 * The single 401 retry mirrors what push.ts already does for the Menu API, and
 * it is the correct reading of an OAuth bearer flow: the most likely cause of a
 * first 401 is a token that expired or was rotated between mint and use. It is
 * attempted ONCE and only once, because a 401 that survives a freshly minted
 * token is a configuration problem, and retrying that in a loop would turn a
 * clear diagnosis into a rate-limit incident.
 *
 * 429/5xx are NOT retried here, deliberately, and this is where this client
 * differs from the menu client on purpose. A menu push is idempotent and
 * unattended, so backing off and retrying is free. An acknowledgement is
 * IRREVERSIBLE and sits inside Leafly's fifteen-minute window with a human
 * watching; silently burning seconds on backoff is the wrong trade when the
 * operator could be told immediately and decide for themselves. The classifier
 * still reports `retryable: true` for those statuses, so the retry decision is
 * surfaced rather than removed — it is just made by a person or by an explicit
 * caller, not buried in this function.
 */
async function orderApiPost(
  url: string,
  body: unknown | undefined,
): Promise<RawResponse> {
  let didRetryAuth = false;

  for (;;) {
    let res: Response;
    try {
      const token = await getLeaflyAccessToken();
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          // Sent even when there is no body. The acknowledge endpoint takes no
          // request body at all per the spec, and a Content-Type on an empty
          // POST is harmless; omitting it conditionally would be one more
          // branch for no benefit.
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // A thrown fetch never produced a status. Returning status: null keeps
      // that distinguishable from a real HTTP error, because "Leafly refused
      // us" and "we never reached Leafly" need different responses.
      return {
        status: null,
        body: null,
        networkError: err instanceof Error ? err.message : "Network request failed.",
      };
    }

    const text = await res.text().catch(() => "");
    let parsed: unknown = text === "" ? null : text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (res.status === 401 && !didRetryAuth) {
      didRetryAuth = true;
      resetLeaflyTokenCache();
      continue;
    }

    return { status: res.status, body: parsed, networkError: null };
  }
}

/**
 * Resolve the environment and the per-retailer order integration key.
 *
 * `refreshLeaflyConfig()` is awaited first so that credentials typed into the
 * back office are visible to the synchronous getters — the same sequence
 * push.ts uses. The order integration key is loaded through L-5's
 * `loadLeaflyOrderIntegrationKey()` rather than read from the config object,
 * because that function is already the single place this value is resolved and
 * decrypted, and house rule 11 says not to re-implement a rule that has a
 * shared owner.
 */
async function resolveOrderApiContext(): Promise<{
  environment: "sandbox" | "production";
  orderIntegrationKey: string | null;
}> {
  await refreshLeaflyConfig();
  const config = getLeaflyConfig();
  const orderIntegrationKey = await loadLeaflyOrderIntegrationKey();
  return {
    environment: config.environment === "production" ? "production" : "sandbox",
    orderIntegrationKey,
  };
}

// ---------------------------------------------------------------------------
// Acknowledge
// ---------------------------------------------------------------------------

/**
 * Acknowledge a Leafly order — the one-way door.
 *
 * Sequence, and every step is in this order for a reason:
 *   1. Resolve credentials.
 *   2. Ask the PURE CORE whether this is allowed. If not, log the refusal and
 *      return without touching the network.
 *   3. POST (no body — the spec defines none for this endpoint).
 *   4. Classify the response against 204, NOT 200.
 *   5. On success, stamp acknowledged_at via L-5's existing store function.
 *   6. Log the attempt either way.
 *
 * Step 5 uses `markLeaflyOrderAcknowledged` from webhook-server.ts rather than
 * writing the column here, so there is exactly one place that stamps this
 * field. Two writers would eventually disagree about the timestamp's meaning.
 */
export async function acknowledgeLeaflyOrder(input: {
  order: LeaflyOrderSnapshot;
  staffId?: string | null;
}): Promise<OutboundResult> {
  const { environment, orderIntegrationKey } = await resolveOrderApiContext();

  const decision: AckDecision = decideAcknowledgement({
    leaflyOrderId: input.order.leafly_order_id,
    orderIntegrationKey,
    acknowledgedAt: input.order.acknowledged_at,
    leaflyStatus: input.order.leafly_status,
  });

  if (!decision.allowed) {
    await recordAttempt({
      leaflyOrderId: input.order.leafly_order_id,
      orderIntegrationKey,
      operation: "acknowledge",
      refusalCode: decision.code,
      message: decision.reason,
      createdBy: input.staffId ?? null,
    });
    return {
      ok: false,
      refused: true,
      code: decision.code,
      message: decision.reason,
      httpStatus: null,
      assessment: null,
      warning: null,
    };
  }

  // Non-null by construction: decideAcknowledgement refuses a blank order id
  // and a blank key before it can return allowed: true. Narrowed explicitly
  // rather than asserted with `!`, so that if the core's contract ever changed
  // this would be a compile error instead of a runtime "undefined" in a URL.
  const orderId = (input.order.leafly_order_id ?? "").trim();
  const key = (orderIntegrationKey ?? "").trim();
  const url = leaflyAcknowledgeUrl(environment, key, orderId);

  // NOTE: no request body. The spec defines no requestBody for the acknowledge
  // operation, so none is sent. Sending `{}` would also probably work, and that
  // is precisely why it is worth being explicit: "probably works" is how an
  // undocumented dependency gets created.
  const raw = await orderApiPost(url, undefined);

  if (raw.status === null) {
    const message = `Could not reach Leafly to acknowledge this order: ${raw.networkError ?? "network error"}. The order is NOT acknowledged; Leafly's fifteen-minute window is still running.`;
    await recordAttempt({
      leaflyOrderId: orderId,
      orderIntegrationKey: key,
      operation: "acknowledge",
      disposition: "retry",
      message,
      createdBy: input.staffId ?? null,
    });
    return {
      ok: false,
      refused: false,
      code: "network_error",
      message,
      httpStatus: null,
      assessment: null,
      warning: null,
    };
  }

  // 204, not 200. Passed as a parameter so the classifier cannot quietly be
  // wrong for one of the two endpoints.
  const assessment = assessOutboundResponse(raw.status, LEAFLY_ACK_SUCCESS_STATUS);
  const ok = assessment.disposition === "success";

  // Set when the acknowledgement succeeded at Leafly but the order did not make
  // it onto the shop floor. Appended to the success warning rather than turning
  // the result into a failure, because the acknowledgement genuinely DID
  // succeed and is irreversible -- see the block below.
  let bridgeWarning: string | null = null;

  if (ok) {
    const { markLeaflyOrderAcknowledged } = await import("./webhook-server");
    // Pinned rather than left to a default, because this exact instant is used
    // twice: once to stamp the row, and once to build the post-acknowledgement
    // snapshot handed to the status push below. Two separate `new Date()` calls
    // could land either side of a second boundary and disagree.
    const acknowledgedAt = new Date();
    const stamped = await markLeaflyOrderAcknowledged(orderId, acknowledgedAt);
    if (!stamped.ok) {
      // Leafly HAS accepted the acknowledgement and the ID images are already
      // gone. Failing to record that locally does not undo it, so this must
      // never be reported as a failed acknowledgement — that would invite a
      // second press of the button against a door that is already closed.
      console.error(
        `[leafly/outbound] acknowledged ${orderId} at Leafly but could not stamp acknowledged_at: ${stamped.error}`,
      );
    }

    // ── SLICE L-10, STAGE TWO: the order reaches the shop floor ──────────────
    //
    //   > "I think the leafly order should become floor visible once the order
    //   >  has been accepted by us."
    //
    // This is that moment, and it is the line that closes the gap the L-9
    // recon found: before this slice, nothing in the codebase ever wrote an
    // `orders` row for a Leafly order, so a Leafly order was structurally
    // incapable of appearing at the register no matter how it was configured.
    //
    // WHY HERE AND NOT EARLIER: `ok` is true only when Leafly returned the
    // documented 204. We create the local order only once Leafly has agreed
    // the order is ours; an order we put on the floor's work list before that
    // could still auto-cancel underneath them, and they would have built a bag
    // for nobody.
    //
    // WHY AFTER markLeaflyOrderAcknowledged: the bridge reads `acknowledged_at`
    // and `leafly_status` off the row to decide what to do, so the stamp has to
    // land first.
    //
    // NEVER ALLOWED TO FAIL THE ACKNOWLEDGEMENT. Leafly has already accepted
    // it by this point, and the ID images are already gone -- the acceptance is
    // irreversible. Reporting failure here would invite staff to press accept
    // again against a door that is already closed. So the outcome is logged and
    // the acknowledgement is still reported as the success it was; a missing
    // register row is recoverable by hand, an order nobody believes was
    // accepted is not.
    try {
      const { onLeaflyOrderAccepted } = await import("./bridge-server");
      const bridged = await onLeaflyOrderAccepted(orderId);
      if (!bridged.ok) {
        console.error(`[leafly/outbound] ${bridged.summary}`);
        // Surfaced to the person who just pressed the button, via the
        // `warning` field that already renders as `leaflyWarn` on the orders
        // page. NOT written as a second `leafly_outbound_attempts` row: that
        // table is the audit log of what we sent to LEAFLY, one row per HTTP
        // attempt, and a second row for one acknowledgement would make the
        // history claim we called Leafly twice. (It would also violate the
        // table's own CHECK constraint -- `disposition` is restricted to
        // success | retry | fix_config | fix_request | gone, verified in
        // migration 0226 -- so the insert would have been rejected anyway and
        // the operator would have been told nothing at all.)
        bridgeWarning = `Leafly has accepted this order, but it did not reach the register: ${bridged.summary}. DO NOT acknowledge it again -- that door is closed. Build the order from the printed ticket and tell the owner.`;
      } else {
        console.log(`[leafly/outbound] ${bridged.summary}`);
      }
    } catch (err) {
      // onLeaflyOrderAccepted is written not to throw, but this is the one
      // call site where a throw would corrupt a decision that has already been
      // made at Leafly. Belt and braces.
      console.error(
        `[leafly/outbound] acknowledged ${orderId} but the floor bridge threw:`,
        err,
      );
      bridgeWarning =
        "Leafly has accepted this order, but we could not confirm it reached the register. DO NOT acknowledge it again. Check the register's pickup queue, and build from the printed ticket if it is not there.";
    }

    // ── SLICE L-14: TELL LEAFLY WE ARE MAKING IT ─────────────────────────────
    //
    // THE CORRECTION. Leafly's spec draws a line this codebase did not:
    //
    //   acknowledge  = "confirms that your system has retrieved all necessary
    //                   details regarding an order". A RECEIPT. It says we have
    //                   the data. It is not a business decision, and Leafly
    //                   forces it within fifteen minutes or auto-cancels.
    //
    //   status=confirmed = "Move an order along its lifecycle." THE BUSINESS
    //                   ACCEPTANCE -- the store agreeing to make the order.
    //
    // This is the EDI 997-vs-855 distinction, which is the long-standing
    // enterprise standard for exactly this situation: the functional
    // acknowledgment confirms technical receipt and syntax only and explicitly
    // does NOT confirm that the business transaction was accepted, while the
    // purchase order acknowledgment carries acceptance, rejection or change.
    //
    // Until now we sent ONLY the receipt. The shopper's Leafly order therefore
    // sat at `pending` forever -- the customer was never told the store had
    // confirmed it -- even though a human here had decided to make it and the
    // order was on the floor being built. Leafly asks that status updates "are
    // a best-approximation ... and that they result in a reasonably smooth and
    // intuitive order lifecycle for the end shopper"; leaving it at pending is
    // neither.
    //
    // WHY HERE: this is the point where a HUMAN pressed Accept. That is the
    // business decision, and it is the moment the order becomes floor-visible.
    //
    // NEVER ALLOWED TO FAIL THE ACKNOWLEDGEMENT, for the same reason as the
    // bridge above: Leafly has already taken the acknowledgement and the ID
    // images are already gone. A failed status push is recoverable (it can be
    // re-sent); an acknowledgement nobody believes happened is not.
    try {
      const confirmed = await setLeaflyOrderStatus({
        order: {
          ...input.order,
          // NOT cosmetic, and the reason this block works at all.
          // `setLeaflyOrderStatus` re-derives legality from the snapshot it is
          // given, and `decideStatusChange` RULE 1 -- "Updates to order status
          // are only available after an order has been acknowledged" -- refuses
          // outright when `acknowledged_at` is blank. `input.order` is the row
          // as it was read BEFORE this function ran, so its `acknowledged_at`
          // is null by definition: that is exactly why `decideAcknowledgement`
          // permitted the acknowledgement. Passing it unchanged would make
          // every confirmed push refuse with `not_acknowledged`, write a
          // refusal row, send nothing, and leave the shopper looking at
          // `pending` forever -- while the log insisted we had tried.
          acknowledged_at: acknowledgedAt.toISOString(),
          // Corrected in the same breath so the snapshot is not fresh in one
          // field and stale in another. We have just acknowledged, so whatever
          // Leafly showed a moment ago, `pending` is the state we are moving
          // forward from.
          leafly_status: "pending",
        },
        nextStatus: "confirmed",
        staffId: input.staffId ?? null,
      });
      if (!confirmed.ok) {
        console.error(
          `[leafly/outbound] acknowledged ${orderId} but could not set status=confirmed: ${confirmed.message}`,
        );
        // Appended rather than overwriting: a bridge failure and a status
        // failure are different problems and a budtender may be looking at
        // both. Overwriting would hide whichever happened first.
        const note =
          "Leafly was not told we confirmed this order, so the customer may still see it as pending. The order IS accepted here \u2014 do not accept it again.";
        // Template-literal form so the right-hand side begins with a string,
        // per the L-13 wiring guard: a bridgeWarning assignment must never be
        // something that CAN evaluate to nothing. `note` is a non-empty
        // constant, so this is always a real message, and `bridgeWarning ?? ""`
        // preserves any earlier warning rather than overwriting it.
        bridgeWarning = `${bridgeWarning ?? ""} ${note}`.trim();
      }
    } catch (err) {
      console.error(
        `[leafly/outbound] acknowledged ${orderId} but the status push threw:`,
        err,
      );
      const note =
        "Leafly was not told we confirmed this order, so the customer may still see it as pending. The order IS accepted here \u2014 do not accept it again.";
      // Template-literal form so the right-hand side begins with a string,
      // per the L-13 wiring guard: a bridgeWarning assignment must never be
      // something that CAN evaluate to nothing. `note` is a non-empty
      // constant, so this is always a real message, and `bridgeWarning ?? ""`
      // preserves any earlier warning rather than overwriting it.
      bridgeWarning = `${bridgeWarning ?? ""} ${note}`.trim();
    }
  }

  await recordAttempt({
    leaflyOrderId: orderId,
    orderIntegrationKey: key,
    operation: "acknowledge",
    responseStatus: raw.status,
    responseBody: raw.body,
    disposition: assessment.disposition,
    message: assessment.message,
    createdBy: input.staffId ?? null,
  });

  return {
    ok,
    refused: false,
    code: assessment.disposition,
    message: assessment.message,
    httpStatus: raw.status,
    assessment,
    // Both warnings, when both apply. The irreversibility notice from the pure
    // core tells the operator what just became permanent; the bridge warning
    // tells them the order is not where they are about to look for it. Dropping
    // either one would leave somebody either pressing accept twice or hunting a
    // register row that was never created.
    warning: ok ? [decision.warning, bridgeWarning].filter(Boolean).join(" ") || null : null,
  };
}

// ---------------------------------------------------------------------------
// Status change
// ---------------------------------------------------------------------------

/**
 * Advance a Leafly order's status (or cancel it).
 *
 * The body is built by the PURE CORE, not here. That matters more than it
 * looks: `decideStatusChange()` is what enforces all five of Leafly's
 * documented transition rules, restricts the cancel reason to the six that are
 * legal OUTBOUND (order_api_unacknowledged is explicitly rejected outbound even
 * though it is a legal INBOUND value), and applies Leafly's documented default
 * of `dispensary`. If the body were assembled here, every one of those rules
 * would become untestable without a Leafly account.
 */
export async function setLeaflyOrderStatus(input: {
  order: LeaflyOrderSnapshot;
  nextStatus: string;
  cancelationReasonCode?: string | null;
  staffId?: string | null;
}): Promise<OutboundResult> {
  const { environment, orderIntegrationKey } = await resolveOrderApiContext();

  // The acknowledge decision is consulted FIRST, for the two "we cannot even
  // build a URL" cases. decideStatusChange() does not know about the order id
  // or the integration key -- by design, it decides transition legality -- so
  // without this, a missing key would surface as a 404 from Leafly rather than
  // as "enter your key on the Integrations page".
  const idCheck = decideAcknowledgement({
    leaflyOrderId: input.order.leafly_order_id,
    orderIntegrationKey,
    // Deliberately passed as null: this call is ONLY being used for its
    // identifier checks, and passing the real acknowledged_at would make it
    // return already_acknowledged -- which, for a status change, is the
    // required state rather than a refusal.
    acknowledgedAt: null,
    leaflyStatus: null,
  });
  if (
    idCheck.code === "missing_order_id" ||
    idCheck.code === "missing_integration_key"
  ) {
    await recordAttempt({
      leaflyOrderId: input.order.leafly_order_id,
      orderIntegrationKey,
      operation: "status",
      requestedStatus: input.nextStatus,
      refusalCode: idCheck.code,
      message: idCheck.reason,
      createdBy: input.staffId ?? null,
    });
    return {
      ok: false,
      refused: true,
      code: idCheck.code,
      message: idCheck.reason,
      httpStatus: null,
      assessment: null,
      warning: null,
    };
  }

  const decision: StatusChangeDecision = decideStatusChange({
    acknowledgedAt: input.order.acknowledged_at,
    currentStatus: input.order.leafly_status,
    nextStatus: input.nextStatus,
    cancelationReasonCode: input.cancelationReasonCode ?? null,
  });

  if (!decision.allowed || decision.body === null) {
    await recordAttempt({
      leaflyOrderId: input.order.leafly_order_id,
      orderIntegrationKey,
      operation: "status",
      requestedStatus: input.nextStatus,
      cancelationReasonCode: input.cancelationReasonCode ?? null,
      refusalCode: decision.code,
      message: decision.reason,
      createdBy: input.staffId ?? null,
    });
    return {
      ok: false,
      refused: true,
      code: decision.code,
      message: decision.reason,
      httpStatus: null,
      assessment: null,
      warning: null,
    };
  }

  const orderId = (input.order.leafly_order_id ?? "").trim();
  const key = (orderIntegrationKey ?? "").trim();
  const url = leaflyStatusUrl(environment, key, orderId);
  const raw = await orderApiPost(url, decision.body);

  if (raw.status === null) {
    const message = `Could not reach Leafly to set this order to "${input.nextStatus}": ${raw.networkError ?? "network error"}. Leafly still shows the previous status.`;
    await recordAttempt({
      leaflyOrderId: orderId,
      orderIntegrationKey: key,
      operation: "status",
      requestedStatus: decision.body.status,
      cancelationReasonCode: decision.effectiveCancelReason,
      requestBody: decision.body,
      disposition: "retry",
      message,
      createdBy: input.staffId ?? null,
    });
    return {
      ok: false,
      refused: false,
      code: "network_error",
      message,
      httpStatus: null,
      assessment: null,
      warning: null,
    };
  }

  // 200 here, NOT 204. The difference from acknowledge is the reason
  // assessOutboundResponse takes the expected code as a parameter.
  const assessment = assessOutboundResponse(raw.status, LEAFLY_STATUS_SUCCESS_STATUS);

  await recordAttempt({
    leaflyOrderId: orderId,
    orderIntegrationKey: key,
    operation: "status",
    requestedStatus: decision.body.status,
    cancelationReasonCode: decision.effectiveCancelReason,
    requestBody: decision.body,
    responseStatus: raw.status,
    responseBody: raw.body,
    disposition: assessment.disposition,
    message: assessment.message,
    createdBy: input.staffId ?? null,
  });

  return {
    ok: assessment.disposition === "success",
    refused: false,
    code: assessment.disposition,
    message: assessment.message,
    httpStatus: raw.status,
    assessment,
    warning: null,
  };
}

// ---------------------------------------------------------------------------
// Reading the log back
// ---------------------------------------------------------------------------

export type OutboundAttemptRecord = {
  id: string;
  leafly_order_id: string | null;
  operation: string;
  requested_status: string | null;
  response_status: number | null;
  disposition: string | null;
  refusal_code: string | null;
  message: string;
  attempted_at: string;
};

/**
 * Most recent outbound attempts for one order, newest first.
 *
 * Returns [] rather than throwing when the service role is unconfigured, so a
 * missing database degrades the UI to "no history shown" instead of a 500 on a
 * page whose main job is something else.
 */
export async function listLeaflyOutboundAttempts(
  leaflyOrderId: string,
  limit = 20,
): Promise<OutboundAttemptRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("leafly_outbound_attempts")
      .select(
        "id, leafly_order_id, operation, requested_status, response_status, disposition, refusal_code, message, attempted_at",
      )
      .eq("leafly_order_id", leaflyOrderId)
      .order("attempted_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("[leafly/outbound] attempt history read failed:", error.message);
      return [];
    }
    return (data ?? []) as OutboundAttemptRecord[];
  } catch (err) {
    console.error("[leafly/outbound] attempt history threw:", err);
    return [];
  }
}
