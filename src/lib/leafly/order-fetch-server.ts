import "server-only";

/**
 * src/lib/leafly/order-fetch-server.ts
 *
 * SLICE L-15 — THE GET THAT WAS MISSING.
 *
 * ===========================================================================
 * WHAT THIS ADDS
 * ===========================================================================
 * `GET /{order_integration_key}/orders/{id}` — "Fetch Order Details".
 *
 * Leafly's production-readiness table, verbatim:
 *
 *   | Fetch Order by ID | Endpoint | Successful retrievals | **_Required_** |
 *
 * Before this file, the repository contained exactly two outbound Order API
 * calls — `acknowledge` and `status`, both POSTs in `order-ack-server.ts`.
 * An exhaustive search for any GET against the Order API returned nothing.
 * So a **required** element of the integration was absent, and its absence was
 * the direct cause of the owner's "it didn't print a receipt": the submission
 * webhook carries no cart, and nothing ever went back to Leafly to collect one.
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE FILE FROM order-ack-server.ts
 * ===========================================================================
 * Not tidiness. The two have opposite failure semantics, and merging them
 * would blur the distinction at the moment it matters most:
 *
 *   • ACKNOWLEDGE is a ONE-WAY DOOR. It may be sent exactly once, it destroys
 *     Leafly's ID images, and re-sending it is a real mistake.
 *   • FETCH is idempotent and free. It may be retried as often as we like, and
 *     retrying is usually the correct response to a failure.
 *
 * A reader who sees them in one file will eventually apply one file's caution
 * to the other's operation — either retrying an acknowledgement (bad) or
 * refusing to retry a fetch (also bad, because it loses the receipt).
 *
 * ===========================================================================
 * NON-THROWING, LIKE EVERYTHING ON THE WEBHOOK PATH
 * ===========================================================================
 * This runs inside the `order_submit` handler, which is contractually required
 * to answer 200 — "Unless Leafly's outbound HMAC keys fails your validation,
 * webhook requests should only be responded to with status codes 200 or 201."
 * An exception escaping here becomes a 500, which makes Leafly retry and then
 * auto-cancel a real customer's order. Every failure is therefore returned as
 * a value.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getLeaflyAccessToken, resetLeaflyTokenCache } from "./token";
// SLICE L-17 — no Leafly request may outlive its budget.
import { dbDeadline } from "./db-deadline";
import { leaflyFetchWithDeadline } from "./deadline-fetch";
import { getLeaflyConfig } from "./config";
import { refreshLeaflyConfig } from "./runtime";
import { loadLeaflyOrderIntegrationKey } from "./webhook-server";
import {
  decideOrderFetch,
  assessOrderFetch,
  leaflyFetchOrderUrl,
  normaliseFetchedOrder,
  isPrintableOrderPayload,
  type FetchAssessment,
  type LeaflyFetchEnvironment,
  type NormalisedOrderFacts,
} from "./order-fetch-core";

export type FetchOrderResult = {
  ok: boolean;
  /** The Order object exactly as Leafly returned it. Null unless ok. */
  order: Record<string, unknown> | null;
  /** The promoted columns, derived from `order`. */
  facts: NormalisedOrderFacts | null;
  /** True when `order` is rich enough for `readLeaflyOrderPayload` to print. */
  printable: boolean;
  assessment: FetchAssessment;
  /** HTTP status, or null when the request never completed. */
  httpStatus: number | null;
  /** One line safe to drop into a server log. */
  summary: string;
};

/**
 * Perform the fetch.
 *
 * `knownLocally` changes only the interpretation of a 404 — see
 * `assessOrderFetch`. It is passed in rather than looked up here because the
 * caller already knows (it has just upserted the row), and a second query to
 * re-learn something the caller knows is a round trip on the latency-critical
 * path that Leafly's fifteen-minute clock is measuring.
 */
export async function fetchLeaflyOrder(input: {
  leaflyOrderId: string;
  knownLocally?: boolean;
}): Promise<FetchOrderResult> {
  const fail = (
    assessment: FetchAssessment,
    httpStatus: number | null,
    summary: string,
  ): FetchOrderResult => ({
    ok: false,
    order: null,
    facts: null,
    printable: false,
    assessment,
    httpStatus,
    summary: `leafly-fetch: ${summary}`,
  });

  let environment: LeaflyFetchEnvironment = "sandbox";
  let key: string | null = null;
  try {
    await refreshLeaflyConfig();
    const config = getLeaflyConfig();
    environment = config.environment === "production" ? "production" : "sandbox";
    key = await loadLeaflyOrderIntegrationKey();
  } catch (err) {
    // Reading our own settings failed. That is not Leafly's fault and must not
    // be reported as one.
    return fail(
      {
        disposition: "retry",
        message: "Our own Leafly settings could not be read, so the order was not collected.",
        retryable: true,
      },
      null,
      `could not read settings (${err instanceof Error ? err.message : "unknown"})`,
    );
  }

  const decision = decideOrderFetch({
    leaflyOrderId: input.leaflyOrderId,
    orderIntegrationKey: key,
  });
  if (!decision.allowed) {
    return fail(
      { disposition: "fix_credentials", message: decision.reason, retryable: false },
      null,
      `refused before sending — ${decision.code}`,
    );
  }

  const url = leaflyFetchOrderUrl(
    environment,
    (key ?? "").trim(),
    input.leaflyOrderId.trim(),
  );

  // One retry, and one only, and ONLY for a 401. A 401 most often means our
  // cached bearer token expired mid-flight; minting a fresh one and trying
  // again is the documented recovery. Retrying anything else here would hide a
  // real problem behind a doubled latency on the path Leafly is timing.
  let didRetryAuth = false;
  for (;;) {
    let res: Response;
    {
      // SLICE L-17 — bounded. This GET runs on the path Leafly itself is
      // timing (we fetch the order after a submission webhook), so an
      // unbounded wait here did not merely hang our screen: it held the
      // request open while the fifteen-minute auto-cancel clock ran down.
      // 15s per attempt, two attempts, each paying a mint (deadline-core.ts).
      const token = await getLeaflyAccessToken().catch((err: unknown) => err as Error);
      if (token instanceof Error) {
        const assessment = assessOrderFetch(null, { knownLocally: input.knownLocally });
        return fail(assessment, null, `sign-in failure (${token.message})`);
      }
      const attempt = await leaflyFetchWithDeadline("order_fetch", url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!attempt.ok) {
        // Unchanged in KIND: still `assessOrderFetch(null, ...)`, still a
        // network failure rather than a refusal, so a timeout can never be
        // mistaken for "Leafly does not have that order" — which would be a
        // reason to stop trying.
        const assessment = assessOrderFetch(null, { knownLocally: input.knownLocally });
        return fail(assessment, null, `network failure (${attempt.detail})`);
      }
      res = attempt.response;
    }

    if (res.status === 401 && !didRetryAuth) {
      didRetryAuth = true;
      resetLeaflyTokenCache();
      continue;
    }

    const assessment = assessOrderFetch(res.status, { knownLocally: input.knownLocally });

    if (assessment.disposition !== "success") {
      return fail(assessment, res.status, `HTTP ${res.status} — ${assessment.disposition}`);
    }

    // 200. Read the body defensively: a success status with an unreadable body
    // is a real possibility through a proxy, and it must not throw here.
    let parsed: unknown = null;
    try {
      const text = await res.text();
      parsed = text.trim() === "" ? null : JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        order: null,
        facts: null,
        printable: false,
        assessment: {
          disposition: "unexpected",
          message:
            "Leafly said the order was found but did not send one we could read. " +
            "Open the order in Leafly and accept it by hand.",
          retryable: true,
        },
        httpStatus: res.status,
        summary: "leafly-fetch: HTTP 200 with an unreadable body",
      };
    }

    const order = parsed as Record<string, unknown>;
    const facts = normaliseFetchedOrder(order);
    const printable = isPrintableOrderPayload(order);

    return {
      ok: true,
      order,
      facts,
      printable,
      assessment,
      httpStatus: res.status,
      summary:
        `leafly-fetch: collected ${input.leaflyOrderId} ` +
        `(${facts.cartItemCount} line(s), printable=${printable})`,
    };
  }
}

export type StoreFetchedResult = { ok: boolean; error: string | null };

/**
 * Write the fetched order over the top of the webhook metadata.
 *
 * ── WHY `raw_order` IS REPLACED RATHER THAN MERGED ──────────────────────────
 * `raw_order` previously held the five-field submission webhook, which is not
 * an order. The fetched Order is the real thing, and it is the shape every
 * downstream reader — `readLeaflyOrderPayload`, the receipt, the local order
 * draft — was written to expect. Merging the two would produce an object that
 * is neither, carrying `eventType` and `acknowledgeBy` keys into something
 * that claims to be an Order.
 *
 * The webhook metadata is NOT lost: `leafly_webhook_events` is append-only and
 * holds the delivery, and `acknowledge_by` is already promoted to its own
 * column precisely because it must survive independently of this blob.
 *
 * ── WHY EVERY COLUMN IS CONDITIONAL ─────────────────────────────────────────
 * Same rule as `upsertLeaflyOrderFromWebhook`: only widen what we know. Leafly
 * does not guarantee webhook ordering, so a fetch triggered by a late-arriving
 * retry must not blank a field a newer event already filled.
 */
export async function storeFetchedLeaflyOrder(input: {
  leaflyOrderId: string;
  order: Record<string, unknown>;
  facts: NormalisedOrderFacts;
}): Promise<StoreFetchedResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database not connected." };
  }
  try {
    const admin = createSupabaseAdminClient();
    const patch: Record<string, unknown> = { raw_order: input.order };
    const f = input.facts;
    if (f.status) patch.leafly_status = f.status;
    if (f.fulfillmentMechanism) patch.fulfillment_mechanism = f.fulfillmentMechanism;
    if (f.marketplace) patch.marketplace = f.marketplace;
    if (f.medicalStatus) patch.medical_status = f.medicalStatus;
    if (f.paymentPreference) patch.payment_preference = f.paymentPreference;
    if (f.cancelationReasonCode) patch.cancelation_reason_code = f.cancelationReasonCode;
    if (f.canceledAt) patch.canceled_at = f.canceledAt;

    const { error } = await admin
      .from("leafly_orders")
      .update(patch)
      .eq("leafly_order_id", input.leaflyOrderId)
      // SLICE L-25. Bounded. THIS is the write that replaces the five-field
      // submission webhook in `raw_order` with the real Order payload. When
      // it does not happen, the detail view renders 18 blank fields out of
      // 18 — exactly what the owner reported seeing. A silent hang here is
      // one of the ways an order ends up permanently uncollected.
      .abortSignal(dbDeadline("order_write"));

    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error storing the fetched order.",
    };
  }
}

/**
 * Fetch and store in one call — what the webhook path actually wants.
 *
 * Returns the same result shape as `fetchLeaflyOrder`, with the storage
 * outcome folded into `summary`. A storage failure does NOT flip `ok` to
 * false, and that is deliberate: the fetch genuinely succeeded, we genuinely
 * have the order in memory, and the caller can still announce and print from
 * it. Reporting the whole operation as failed because a write failed would
 * suppress the receipt for a reason that has nothing to do with the receipt.
 */
export async function collectLeaflyOrder(input: {
  leaflyOrderId: string;
  knownLocally?: boolean;
}): Promise<FetchOrderResult> {
  const fetched = await fetchLeaflyOrder(input);
  if (!fetched.ok || fetched.order === null || fetched.facts === null) return fetched;

  const stored = await storeFetchedLeaflyOrder({
    leaflyOrderId: input.leaflyOrderId,
    order: fetched.order,
    facts: fetched.facts,
  });

  if (!stored.ok) {
    return { ...fetched, summary: `${fetched.summary}; STORE FAILED: ${stored.error}` };
  }
  return { ...fetched, summary: `${fetched.summary}; stored` };
}
