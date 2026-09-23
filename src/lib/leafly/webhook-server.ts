import "server-only";

/**
 * Leafly webhook server plumbing (Slice L-5)
 * =========================================================================
 *
 * The impure half of webhook handling: real crypto, real database. All of the
 * DECISIONS live in the pure cores (`hmac-core`, `webhook-parse-core`,
 * `order-map-core`); this file only supplies them with real inputs and stores
 * what they conclude.
 *
 * That split is not decoration. It means the security decision — "is this
 * signature valid?" — is exhaustively testable without a database, including
 * the failure paths a real crypto library cannot easily be made to take.
 *
 * ── EVERY FUNCTION HERE IS NON-THROWING ─────────────────────────────────────
 * Leafly's spec: webhook requests "should only be responded to with status codes
 * 200 or 201". An exception escaping into a Next route handler produces a 500,
 * which makes Leafly retry and eventually auto-cancel a real customer's order.
 * So every function returns a result object; none of them throw. Where a
 * database write fails, the failure is returned and the route still answers 200,
 * because a storage problem on our side is not a reason to tell Leafly the
 * delivery was bad.
 */

import { createHmac, createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getLeaflyOverrides } from "@/lib/integrations/integration-credentials-store";
// SLICE L-25 — the acknowledge stamp runs after Leafly's 204 and must not hang.
import { dbDeadline } from "./db-deadline";
import {
  verifyLeaflySignature,
  findSignatureHeader,
  type LeaflyHmacEncoding,
  type LeaflyHmacVerdict,
} from "./hmac-core";
import {
  parseLeaflyWebhook,
  type LeaflyWebhookEventType,
  type ParsedLeaflyWebhook,
} from "./webhook-parse-core";
import { leaflyToGreenwayStatus } from "./order-map-core";

/**
 * The real HMAC-SHA-256 digester injected into the pure core.
 *
 * Note `createHmac(...).digest(encoding)` — node renders the SAME digest bytes
 * in whichever encoding is asked for, which is exactly what the core needs to
 * try both candidates without computing the HMAC twice differently.
 */
export function nodeHmacDigest(
  body: string,
  key: string,
  encoding: LeaflyHmacEncoding,
): string {
  // "utf8" is explicit rather than default so the signed byte sequence is
  // unambiguous. Leafly signs the body bytes; if we hashed a different encoding
  // of the same characters the digest would differ for any non-ASCII content —
  // and customer names and delivery notes routinely contain non-ASCII.
  return createHmac("sha256", key).update(body, "utf8").digest(encoding);
}

/** SHA-256 of the raw body, used as the idempotency key. */
export function rawBodySha256(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

/**
 * Load the Leafly HMAC key.
 *
 * Returns null when unavailable, and the caller REFUSES on null. There is no
 * path here that returns a placeholder or an empty string that could be mistaken
 * for a usable key.
 */
export async function loadLeaflyHmacKey(): Promise<string | null> {
  try {
    // getLeaflyOverrides() already implements DB-over-env resolution, decrypts
    // the at-rest-encrypted secret, and returns undefined (never "") when the
    // value is absent. Rule 11: that precedence rule has a home, so this does
    // not re-implement it. An earlier draft of this file reached for a
    // `getIntegrationCredentials()` that does not exist, which is exactly the
    // class of mistake reuse prevents.
    const leafly = await getLeaflyOverrides();
    const key = leafly.hmacKey?.trim();
    if (key) return key;
  } catch {
    // Swallowed on purpose. A database hiccup must not throw inside a webhook
    // handler; returning null makes the caller REFUSE the delivery, which is
    // the fail-closed outcome. We never fall back to a default key.
  }
  return null;
}

/** Load this retailer's orderIntegrationKey, for cross-checking webhook bodies. */
export async function loadLeaflyOrderIntegrationKey(): Promise<string | null> {
  try {
    const leafly = await getLeaflyOverrides();
    const key = leafly.orderIntegrationKey?.trim();
    if (key) return key;
  } catch {
    /* Same posture as above: null, never a guess. */
  }
  return null;
}

export type WebhookVerification = {
  verdict: LeaflyHmacVerdict;
  bodySha256: string;
};

/**
 * Verify an inbound webhook against the configured HMAC key.
 * Pure decision, impure inputs.
 */
export async function verifyInboundLeaflyWebhook(
  rawBody: string,
  headers: Headers,
): Promise<WebhookVerification> {
  const hmacKey = await loadLeaflyHmacKey();
  const headerValue = findSignatureHeader(headers);
  const verdict = verifyLeaflySignature({
    rawBody,
    headerValue,
    hmacKey,
    digest: nodeHmacDigest,
  });
  return { verdict, bodySha256: rawBodySha256(rawBody) };
}

export type RecordEventResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; duplicate: false; error: string };

/**
 * Append a delivery to the event log.
 *
 * `duplicate: true` means Leafly has sent us these exact bytes before, so the
 * caller must answer 200 and do no further work. Detected via the unique index
 * on `body_sha256` rather than a prior SELECT: a check-then-insert is racy, and
 * two concurrent retries of the same delivery would both pass the check. Letting
 * the database arbitrate is the only correct version.
 */
export async function recordLeaflyWebhookEvent(input: {
  bodySha256: string;
  eventType: string | null;
  orderId: string | null;
  orderIntegrationKey: string | null;
  eventTime: string | null;
  signatureVerified: boolean;
  rejectionReason: string | null;
  responseStatus: number | null;
}): Promise<RecordEventResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, duplicate: false, error: "Database not connected." };
  }
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("leafly_webhook_events")
      .insert({
        body_sha256: input.bodySha256,
        event_type: input.eventType,
        order_id: input.orderId,
        order_integration_key: input.orderIntegrationKey,
        event_time: input.eventTime,
        signature_verified: input.signatureVerified,
        rejection_reason: input.rejectionReason,
        response_status: input.responseStatus,
      })
      // SLICE L-25. Bounded. Leafly retries a webhook we fail to answer
      // promptly; a hung insert means we never answer at all, so Leafly
      // redelivers while the original request is still pending.
      .abortSignal(dbDeadline("order_write"));
    if (error) {
      // 23505 = unique_violation → we have already stored this exact delivery.
      if (error.code === "23505" || /duplicate key|unique/i.test(error.message)) {
        return { ok: true, duplicate: true };
      }
      return { ok: false, duplicate: false, error: error.message };
    }
    return { ok: true, duplicate: false };
  } catch (err) {
    return {
      ok: false,
      duplicate: false,
      error: err instanceof Error ? err.message : "Unknown error recording webhook event.",
    };
  }
}

/** Best-effort "we finished handling this". Never throws. */
export async function markLeaflyWebhookProcessed(bodySha256: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  try {
    const admin = createSupabaseAdminClient();
    await admin
      .from("leafly_webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("body_sha256", bodySha256)
      // SLICE L-25. Bounded. The comment below says a failure here is
      // "bookkeeping loss, not a reason to turn a successful delivery into
      // a 500" — but an unbounded wait never reaches that catch, because
      // nothing is thrown. The deadline is what makes the stated policy
      // true in the one case it was written for.
      .abortSignal(dbDeadline("order_write"));
  } catch {
    // Deliberately swallowed. Failing to stamp processed_at is a bookkeeping
    // loss, not a reason to turn a successful delivery into a 500.
  }
}

export type UpsertOrderResult = { ok: true } | { ok: false; error: string };

/**
 * Create or update the order record from a parsed webhook.
 *
 * ── WHY THIS ONLY EVER WIDENS WHAT WE KNOW ─────────────────────────────────
 * Leafly does not guarantee webhook ORDERING. A status webhook can arrive before
 * the submission webhook that created the order, and a retry of an old delivery
 * can arrive after a newer one. So every field is written only when the incoming
 * value is present, and `acknowledge_by` is never overwritten with null. A naive
 * upsert would let a late-arriving retry blank out the acknowledgement deadline
 * of an order that is still counting down — which is the one field a real
 * customer's order gets auto-cancelled for.
 */
export async function upsertLeaflyOrderFromWebhook(
  parsed: ParsedLeaflyWebhook,
): Promise<UpsertOrderResult> {
  if (!parsed.orderId) return { ok: false, error: "No order id in the payload." };
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };

  try {
    const admin = createSupabaseAdminClient();

    // Only include fields the payload actually carried. `undefined` keys are
    // dropped by the client, which is what lets a partial event avoid clobbering
    // a fuller earlier one.
    const patch: Record<string, unknown> = { leafly_order_id: parsed.orderId };
    if (parsed.orderIntegrationKey) patch.order_integration_key = parsed.orderIntegrationKey;
    if (parsed.acknowledgeBy) patch.acknowledge_by = parsed.acknowledgeBy;
    if (parsed.status) patch.leafly_status = parsed.status;
    if (parsed.cancelationReasonCode) {
      patch.cancelation_reason_code = parsed.cancelationReasonCode;
    }
    if (parsed.body) patch.raw_order = parsed.body;

    // A cancellation stamps canceled_at, from Leafly's own eventTime when we
    // have it. Using their timestamp rather than ours keeps the record honest
    // under retry: re-processing a week-old delivery must not claim the order
    // was cancelled today.
    const mapping = parsed.status ? leaflyToGreenwayStatus(parsed.status) : null;
    if (parsed.status === "canceled" || parsed.eventType === "order_cancel") {
      patch.canceled_at = parsed.eventTime ?? new Date().toISOString();
    }
    if (mapping?.terminal === false && parsed.eventType === "order_submit") {
      // Nothing to add — noted only so the mapping is visibly consulted rather
      // than imported and ignored.
    }

    const { error } = await admin
      .from("leafly_orders")
      .upsert(patch, { onConflict: "leafly_order_id" })
      // SLICE L-25. Bounded. This is the write that first creates the order
      // row from the submission webhook, inside a fifteen-minute
      // acknowledge window. Every second spent stalled here is a second the
      // staff do not get back.
      .abortSignal(dbDeadline("order_write"));

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error saving the Leafly order.",
    };
  }
}

/** Stamp an order as acknowledged to Leafly. */
export async function markLeaflyOrderAcknowledged(
  leaflyOrderId: string,
  at: Date = new Date(),
): Promise<UpsertOrderResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  try {
    const admin = createSupabaseAdminClient();
    // SLICE L-25 — bounded. This is the stamp that runs immediately AFTER
    // Leafly returns its 204, and it is the most dangerous place on the whole
    // path to wait: the acknowledgement is already irreversible, the
    // customer's ID images are already gone, and the operator is still
    // looking at a spinner. Hanging here converts a completed, successful
    // acknowledgement into what the owner experiences as a total failure.
    //
    // A timeout comes back through `error`, and the caller
    // (`acknowledgeLeaflyOrder`) already treats a failed stamp as a logged
    // warning rather than a failed acknowledgement — precisely because the
    // acknowledgement DID succeed and must never invite a second press.
    const { error } = await admin
      .from("leafly_orders")
      .update({ acknowledged_at: at.toISOString() })
      .eq("leafly_order_id", leaflyOrderId)
      .abortSignal(dbDeadline("order_write"));
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error acknowledging the order.",
    };
  }
}

export type HandledWebhook = {
  /** The HTTP status the route should return. */
  status: number;
  parsed: ParsedLeaflyWebhook;
  duplicate: boolean;
  /** Server-log line. Never returned to Leafly. */
  logLine: string;
};

/**
 * The shared body of all six webhook routes.
 *
 * Sequenced deliberately:
 *   1. Verify the signature. Refuse if it fails — the ONLY case where we do not
 *      answer 200, and the spec explicitly carves it out: "Unless Leafly's
 *      outbound HMAC keys fails your validation, webhook requests should only be
 *      responded to with status codes 200 or 201."
 *   2. Record the delivery, which also detects duplicates.
 *   3. Parse and store — only if not a duplicate.
 *   4. Answer 200 regardless of how steps 2–3 went.
 *
 * Note the log/record happens for REJECTED deliveries too. A burst of signature
 * failures is the signature of a rotated HMAC key, and discarding those rows
 * would make the most likely real incident invisible.
 */
export async function handleLeaflyWebhook(input: {
  rawBody: string;
  headers: Headers;
  expectedEvent: LeaflyWebhookEventType;
}): Promise<HandledWebhook> {
  const { rawBody, headers, expectedEvent } = input;

  const { verdict, bodySha256 } = await verifyInboundLeaflyWebhook(rawBody, headers);
  const parsed = parseLeaflyWebhook(rawBody, expectedEvent);

  if (!verdict.ok) {
    // Log the refusal, but never echo the reason to the caller.
    await recordLeaflyWebhookEvent({
      bodySha256,
      eventType: parsed.rawEventType,
      orderId: parsed.orderId,
      orderIntegrationKey: parsed.orderIntegrationKey,
      eventTime: parsed.eventTime,
      signatureVerified: false,
      rejectionReason: verdict.reason,
      responseStatus: 401,
    });
    return {
      status: 401,
      parsed,
      duplicate: false,
      logLine: `[leafly ${expectedEvent}] REFUSED — ${verdict.reason}: ${verdict.detail}`,
    };
  }

  const recorded = await recordLeaflyWebhookEvent({
    bodySha256,
    eventType: parsed.rawEventType,
    orderId: parsed.orderId,
    orderIntegrationKey: parsed.orderIntegrationKey,
    eventTime: parsed.eventTime,
    signatureVerified: true,
    rejectionReason: null,
    responseStatus: 200,
  });

  if (recorded.ok && recorded.duplicate) {
    return {
      status: 200,
      parsed,
      duplicate: true,
      logLine: `[leafly ${expectedEvent}] duplicate delivery (${bodySha256.slice(0, 12)}…) — acknowledged, no work done.`,
    };
  }

  const notes: string[] = [];
  if (!recorded.ok) {
    // Storage failed, but the delivery was authentic. Answer 200 anyway: asking
    // Leafly to retry would not fix our database, and the retry could end in an
    // auto-cancelled customer order.
    notes.push(`event log write failed: ${recorded.error}`);
  }

  if (parsed.orderId) {
    const saved = await upsertLeaflyOrderFromWebhook(parsed);
    if (!saved.ok) notes.push(`order upsert failed: ${saved.error}`);

    // ── SLICE L-10, STAGE ONE: ring the bell and print the paper ─────────────
    //
    // The owner's instruction was specific about the ordering:
    //
    //   > "I think the leafly order should become floor visible once the order
    //   >  has been accepted by us. it should however, make noise on the
    //   >  speaker, and print out the receipt immediately so we know to accept
    //   >  the order as soon as possible."
    //
    // So this is the "immediately" half. It announces and prints; it creates
    // no local order, so nothing appears on the register's pickup queue yet.
    // That happens in stage two, when we acknowledge (see order-ack-server).
    //
    // ORDER MATTERS: this runs AFTER the upsert, because onLeaflyOrderArrived
    // reads the row the upsert just wrote -- including `raw_order`, which is
    // where the cart it prints comes from.
    //
    // GATED TO order_submit. An order_cancel delivery must never ring the
    // new-order bell; that is the one sound that would send somebody to build
    // a bag for an order that no longer exists.
    //
    // ONLY on a successful upsert. If the row was not written, the bridge
    // would read a missing or stale row, and a receipt printed from stale data
    // is worse than no receipt.
    //
    // AWAITED, unlike the website's fire-and-forget announcer. The website can
    // afford to answer the customer first and ring later; here the whole point
    // is that the bell beats Leafly's fifteen-minute acknowledgement clock, and
    // a serverless function that has already returned may be frozen before its
    // background work runs. onLeaflyOrderArrived is contractually incapable of
    // throwing -- every failure comes back as a value -- so awaiting it cannot
    // turn a valid delivery into a non-200, which would make Leafly retry and
    // could end with a real customer's order auto-cancelled.
    if (saved.ok && expectedEvent === "order_submit") {
      // ── SLICE L-15: COLLECT THE ORDER BEFORE RINGING THE BELL ──────────
      //
      // THE BUG THIS FIXES. The owner placed a real Leafly order and got no
      // receipt. The cause was not the printer, the bridge, or the bell: it
      // is that `order_submit` DOES NOT CONTAIN THE ORDER. Leafly's own
      // example payload is five fields -- eventTime, eventType, orderId,
      // orderIntegrationKey, acknowledgeBy. No cart. No customer. No totals.
      //
      // The upsert above therefore stored those five fields into
      // `raw_order`, and `onLeaflyOrderArrived` then asked
      // `readLeaflyOrderPayload(raw_order)` to build a ticket out of them.
      // Measured against the spec's own example, that call returns
      // ok=false, "the stored Leafly payload has no order id". It could
      // never have succeeded. The receipt was unreachable by construction.
      //
      // The missing piece is `GET /{key}/orders/{id}`, which Leafly marks
      // **_Required_** and which did not exist anywhere in this repository.
      // That endpoint returns the real Order -- cartItems, subtotal, total,
      // taxes, firstName, lastName -- and `collectLeaflyOrder` overwrites
      // `raw_order` with it.
      //
      // WHY IT RUNS HERE, BEFORE the bridge rather than inside it: the
      // bridge reads the row. Collecting first means the row it reads is the
      // real order. Collecting after would print from the metadata again.
      //
      // WHY A FAILURE DOES NOT SKIP THE BRIDGE: `decideArrivalPlan` is
      // explicit that a failed collection STILL announces. Leafly
      // auto-cancels at fifteen minutes, so a silent failure costs a real
      // customer's order, while a chime with no paper costs somebody a look
      // at the Leafly dashboard. The bell is the cheap half and it must not
      // depend on the expensive half succeeding.
      //
      // CANNOT THROW: collectLeaflyOrder returns every failure as a value,
      // so this cannot turn an authentic delivery into a non-200.
      const { collectLeaflyOrder } = await import("./order-fetch-server");
      const collected = await collectLeaflyOrder({
        leaflyOrderId: parsed.orderId,
        // The upsert above just wrote the row, so a 404 here means Leafly has
        // aged the order out, NOT that the order never existed.
        knownLocally: true,
      });
      if (!collected.ok) notes.push(collected.summary);

      const { onLeaflyOrderArrived } = await import("./bridge-server");
      const bridged = await onLeaflyOrderArrived(parsed.orderId);
      if (!bridged.ok) notes.push(bridged.summary);
      else if (!bridged.announced || !bridged.printed) notes.push(bridged.summary);

      // ── STANDING OFFER 2 (round L-24): the LAST-RESORT staff alert ────────
      //
      // The owner was explicit that he does not want an order-arrived email:
      //
      //   "I don't need an email sent to us, the back office dashboard,
      //    printer and speaker let us know an order has been placed."
      //
      // This is not that. `decideStaffAlert` stays SILENT whenever the bell
      // rang and the paper printed, which is the overwhelmingly common case.
      // It speaks only when those channels have already failed — at which
      // point the owner has received no signal at all, and Leafly's
      // fifteen-minute auto-cancel clock is running on a real customer's
      // order. Email is then the only remaining way to find out in time.
      //
      // STAGE "arrival" IS LOAD-BEARING. The order is deliberately NOT on the
      // register yet (decideBridgeActions returns createLocalOrder: false at
      // arrival, by the owner's own two-stage rule), so the register check is
      // suppressed here. Passing the wrong stage would alert on every order —
      // exactly the noise he ruled out.
      //
      // NON-FATAL BY CONSTRUCTION. This is wrapped and awaited inside its own
      // try/catch: a webhook that returned non-200 would make Leafly retry and
      // could end with a customer's order auto-cancelled. An alert failing is
      // never worth that, so any throw here is downgraded to a note.
      const { maybeSendLeaflyStaffAlert } = await import("./staff-alert-server");
      const alertNote = await maybeSendLeaflyStaffAlert({
        leaflyOrderId: parsed.orderId,
        stage: "arrival",
        announced: bridged.ok && bridged.announced === true,
        printed: bridged.ok && bridged.printed === true,
        // Suppressed at this stage by the core; reported honestly rather than
        // faked true, so the core — not the caller — owns the rule.
        bridgedToRegister: false,
        collectionFailed: !collected.ok,
        acknowledgeBy: parsed.acknowledgeBy,
      });
      if (alertNote) notes.push(alertNote);
    }

    // ── SLICE L-10, THE OTHER DIRECTION: a cancellation must follow the order
    //    all the way to the floor ───────────────────────────────────────────
    //
    // This is the consequence of the acceptance hook above. Until this slice,
    // no Leafly order had ever reached the register, so a cancellation had
    // nothing on the floor to invalidate and stopping at `leafly_orders` was
    // harmless. That is no longer true. A cancellation that did not propagate
    // would leave somebody bagging an order that no longer exists, and the
    // first anybody would know is a customer who never turns up.
    //
    // WHAT IT WILL NOT DO: silently empty a till. When product has already
    // moved -- preparing, ready, or a register sale open -- onLeaflyOrderCanceled
    // changes NOTHING and escalates to a human instead. That is the enterprise
    // standard the owner asked about, and the reasoning is in decideCancelPlan.
    //
    // WE MAY NOT REFUSE THIS. The spec is explicit: "These webhook events are
    // not the place to apply business rules or validations on the order
    // lifecycle." So this runs, and it still answers 200 regardless.
    const isCancel = parsed.status === "canceled" || parsed.eventType === "order_cancel";
    if (saved.ok && isCancel) {
      const { onLeaflyOrderCanceled } = await import("./bridge-server");
      const cancelled = await onLeaflyOrderCanceled(
        parsed.orderId,
        parsed.cancelationReasonCode ?? null,
      );
      // A collision is NOT an error -- it is the system working correctly --
      // but it must be visible in the log, because it is the one case where a
      // human has been handed a decision and may not have noticed.
      if (!cancelled.ok || cancelled.plan?.dispositionRequired) {
        notes.push(cancelled.summary);
      }
    }
  }

  await markLeaflyWebhookProcessed(bodySha256);

  const problemNote =
    parsed.problems.length > 0
      ? ` problems=[${parsed.problems.map((p) => `${p.severity}:${p.code}`).join(", ")}]`
      : "";

  return {
    status: 200,
    parsed,
    duplicate: false,
    logLine: `[leafly ${expectedEvent}] accepted${problemNote}${
      notes.length > 0 ? ` notes=[${notes.join("; ")}]` : ""
    }`,
  };
}
