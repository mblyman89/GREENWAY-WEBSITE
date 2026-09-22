/**
 * src/lib/leafly/order-fetch-core.ts
 *
 * SLICE L-15 — FETCHING THE ORDER ITSELF. The endpoint Leafly marks
 * **_Required_** and that this repository had never built.
 *
 * ===========================================================================
 * THE BUG THIS FILE EXISTS TO FIX
 * ===========================================================================
 * The owner placed a real Leafly order and reported: no record in the back
 * office, no printed receipt, no noise on the speaker, and no Leafly section
 * on the online orders dashboard.
 *
 * Three of those four had a single, previously unnoticed cause, and it is NOT
 * the one it looks like. It is not a missing webhook, not a missing UI, and
 * not a missing table. All of those exist and are correct. The cause is that
 * **the order submission webhook does not contain the order**.
 *
 * Verbatim from the vendored spec, `components.examples.OrderSubmissionWebhook`
 * (docs/leafly-specs/order-api-v1.openapi.json, md5
 * daab7bcf6f77177de85425adf7f805f1, re-verified byte-identical against the live
 * document at docs.leafly.io on 2026-09-22):
 *
 *   {
 *     "eventTime":           "2023-08-11T21:32:33.517Z",
 *     "eventType":           "order_submit",
 *     "orderId":             "e4dcae37-32d0-4498-ab3d-0c9a93c5f8ea",
 *     "orderIntegrationKey": "iAYK0fC0rjQIGJQKIJvzRnObjElOC40PhLEK9PEUgFFm",
 *     "acknowledgeBy":       "2023-08-11T21:47:33.517Z"
 *   }
 *
 * Five fields. No cart. No customer. No totals. No taxes.
 *
 * `webhook-server.ts` stored that object into `leafly_orders.raw_order`, and
 * `bridge-server.ts` then asked `readLeaflyOrderPayload(row.raw_order)` to
 * build a receipt out of it. That call can never succeed, because the payload
 * has no `id`, no `subtotal`, no `total` and no `cartItems`. Measured, not
 * assumed — running the spec's own example through the real production code
 * returns:
 *
 *   readLeaflyOrderPayload.ok = false
 *   reason = "the stored Leafly payload has no order id"
 *
 * So the receipt could never print, no matter how healthy every other part of
 * the pipeline was. The failure was silent because `onLeaflyOrderArrived`
 * correctly refuses to invent an order it cannot read, and correctly reports
 * that as a note rather than as an exception (it must never throw, or Leafly
 * retries and auto-cancels a real customer's order).
 *
 * The missing piece is the separate, authenticated GET that Leafly's
 * requirement table lists as **_Required_**:
 *
 *   | Fetch Order by ID | Endpoint | Successful retrievals | **_Required_** |
 *
 *   GET /{order_integration_key}/orders/{id}
 *     security: OAuth2ClientCredentials
 *     responses: 200, 401, 403, 404
 *
 * That endpoint returns the `Order` schema, which is where `cartItems`,
 * `subtotal`, `total`, `taxes`, `firstName` and `lastName` actually live. An
 * exhaustive search proved no GET to the Order API existed anywhere in the
 * repository: only `acknowledge` and `status`, both POSTs.
 *
 * ===========================================================================
 * WHY THE FETCH MUST HAPPEN BEFORE THE BELL, NOT AFTER
 * ===========================================================================
 * The tempting shape is: ring the bell immediately, fetch the order later. It
 * is wrong, and the reason is the fifteen-minute clock.
 *
 * Leafly's rule: "Orders are acknowledged as having been retrieved **in whole**
 * by your system within fifteen minutes of receiving an order submission
 * webhook. Any orders not acknowledged by this deadline will be auto canceled."
 *
 * "In whole" is the operative phrase. An acknowledgement asserts that we have
 * the order, so acknowledging before retrieving it would be a false statement
 * to a third party about a real customer's purchase. And a receipt is the
 * artefact staff use to build the bag — printing one from a payload we never
 * fetched is how the wrong product goes in the bag.
 *
 * So: fetch first, then announce and print from what we fetched. If the fetch
 * fails, the bell STILL rings (see `decideArrivalPlan`), because a human
 * hearing "a Leafly order arrived and we could not read it" has fourteen
 * minutes to open the Leafly dashboard, whereas silence guarantees the order
 * is auto-cancelled. Losing the paper is survivable. Losing the order is not.
 *
 * ===========================================================================
 * PURITY (house rule 5)
 * ===========================================================================
 * No imports. No I/O. No clock. No crypto. This file decides URLs, classifies
 * HTTP responses and normalises a payload; the network lives in
 * `order-fetch-server.ts`. That split is what lets the 404/401/403 branches —
 * which are painful to provoke against a live sandbox — be tested exhaustively
 * in CI with no Leafly account at all.
 */

/* ------------------------------------------------------------------------- *
 * 1. Where the order lives
 * ------------------------------------------------------------------------- */

/** The two Leafly environments, spelled as the rest of the codebase spells them. */
export type LeaflyFetchEnvironment = "sandbox" | "production";

/**
 * Order API roots, verbatim from `servers` in the vendored spec.
 *
 * Duplicated deliberately rather than imported from `order-ack-core.ts`. This
 * module must stay import-free to remain pure, and a compliance test asserts
 * the two constants agree — so a drift is a CI failure, not a silent divergence.
 * That is a stronger guarantee than a shared import, because a shared import
 * can be edited once and break both callers at the same time without anything
 * noticing.
 */
export const LEAFLY_ORDER_FETCH_BASE_URLS: Readonly<
  Record<LeaflyFetchEnvironment, string>
> = {
  sandbox: "https://reservations-api-sandbox.leafly.io/v1/order_integration",
  production: "https://reservations-api.leafly.com/v1/order_integration",
};

/**
 * Build the Fetch-Order-by-ID URL.
 *
 * Both path segments are percent-encoded. The order id is a uuid and the
 * integration key is an opaque token, so neither *should* need encoding — but
 * "should" is doing load-bearing work in that sentence, and an unencoded slash
 * in a key would silently retarget the request at a different path. Encoding
 * costs nothing and removes the question.
 */
export function leaflyFetchOrderUrl(
  environment: LeaflyFetchEnvironment,
  orderIntegrationKey: string,
  leaflyOrderId: string,
): string {
  const base = LEAFLY_ORDER_FETCH_BASE_URLS[environment];
  return `${base}/${encodeURIComponent(orderIntegrationKey)}/orders/${encodeURIComponent(
    leaflyOrderId,
  )}`;
}

/* ------------------------------------------------------------------------- *
 * 2. May we even try?
 * ------------------------------------------------------------------------- */

export type FetchRefusalCode =
  | "missing_order_id"
  | "missing_integration_key";

export type FetchDecision =
  | { allowed: true }
  | { allowed: false; code: FetchRefusalCode; reason: string };

/**
 * Decide whether a fetch is worth attempting.
 *
 * Refusing locally rather than firing a doomed request is not micro-optimising:
 * a request with an empty integration key becomes `/v1/order_integration//orders/x`,
 * which Leafly answers with a 404. A 404 is the code that means "this order does
 * not exist" — so a missing credential would be reported to the owner as a
 * missing order, sending him to look for a problem at Leafly that is actually
 * an empty box in his own settings page. The two must never be confusable.
 */
export function decideOrderFetch(input: {
  leaflyOrderId: string | null | undefined;
  orderIntegrationKey: string | null | undefined;
}): FetchDecision {
  const id = typeof input.leaflyOrderId === "string" ? input.leaflyOrderId.trim() : "";
  if (id === "") {
    return {
      allowed: false,
      code: "missing_order_id",
      reason: "No Leafly order id was supplied, so there is nothing to fetch.",
    };
  }
  const key =
    typeof input.orderIntegrationKey === "string" ? input.orderIntegrationKey.trim() : "";
  if (key === "") {
    return {
      allowed: false,
      code: "missing_integration_key",
      reason:
        "No Order integration key is saved, so Leafly cannot be asked for this order. " +
        "Add it on the Integrations page under “Order API”.",
    };
  }
  return { allowed: true };
}

/* ------------------------------------------------------------------------- *
 * 3. What Leafly's answer means
 * ------------------------------------------------------------------------- */

/**
 * Every documented response of the fetch endpoint, plus the two states the
 * document cannot describe (no answer at all, and an answer we could not parse).
 */
export type FetchDisposition =
  | "success"
  | "retry"
  | "fix_credentials"
  | "not_found"
  | "gone"
  | "unexpected";

export type FetchAssessment = {
  disposition: FetchDisposition;
  /** Safe to show a human standing at a counter. */
  message: string;
  /** True when trying the same request again could plausibly work. */
  retryable: boolean;
};

/**
 * The spec's documented status codes for `GET /{key}/orders/{id}`:
 * 200, 401, 403, 404. Anything else is undocumented and is treated as such
 * rather than being guessed at.
 */
export const LEAFLY_FETCH_DOCUMENTED_STATUSES = [200, 401, 403, 404] as const;

/**
 * Classify the HTTP status of a fetch attempt.
 *
 * ── WHY 404 IS SPLIT IN TWO ──────────────────────────────────────────────────
 * Leafly's limitation, verbatim: "Orders are only available for retrieval while
 * live, or within twenty four hours of reaching a terminal state." So a 404 has
 * two very different meanings, and only the caller knows which:
 *
 *   • fetching an order we have never seen  → it genuinely is not there
 *   • fetching an order we already stored   → it has aged out of Leafly's window
 *
 * The second is not an error at all; it is the documented retention policy, and
 * reporting it as "order not found" would have staff hunting a vanished order
 * that was completed last week. `knownLocally` is what separates them, and it
 * is a parameter rather than an inference because this core cannot see the
 * database.
 */
export function assessOrderFetch(
  status: number | null,
  opts?: { knownLocally?: boolean },
): FetchAssessment {
  if (status === null) {
    return {
      disposition: "retry",
      message:
        "Leafly could not be reached to collect this order. The order is still live at " +
        "Leafly and the fifteen-minute acknowledgement clock is still running.",
      retryable: true,
    };
  }

  if (status === 200) {
    return { disposition: "success", message: "The order was collected from Leafly.", retryable: false };
  }

  if (status === 401) {
    return {
      disposition: "fix_credentials",
      message:
        "Leafly rejected our sign-in while collecting this order. Check the OAuth client " +
        "ID and secret on the Integrations page.",
      retryable: false,
    };
  }

  if (status === 403) {
    return {
      disposition: "fix_credentials",
      message:
        "Leafly refused access to this order. The Order integration key saved here is " +
        "probably not the key for this store.",
      retryable: false,
    };
  }

  if (status === 404) {
    if (opts?.knownLocally === true) {
      return {
        disposition: "gone",
        message:
          "Leafly no longer holds this order. Leafly keeps orders only while they are live, " +
          "or for twenty-four hours after they finish, so this is expected for an older order.",
        retryable: false,
      };
    }
    return {
      disposition: "not_found",
      message: "Leafly does not have an order with that id.",
      retryable: false,
    };
  }

  // 5xx is the only undocumented family worth retrying: it is Leafly's side.
  if (status >= 500) {
    return {
      disposition: "retry",
      message: `Leafly had a server problem (HTTP ${status}) while we collected this order. Worth trying again.`,
      retryable: true,
    };
  }

  if (status === 429) {
    return {
      disposition: "retry",
      message:
        "Leafly is rate limiting us. The spec says there should be headroom for normal " +
        "order volumes, so this is worth retrying and worth noticing if it repeats.",
      retryable: true,
    };
  }

  return {
    disposition: "unexpected",
    message: `Leafly answered HTTP ${status}, which its documentation does not describe for this request.`,
    retryable: false,
  };
}

/* ------------------------------------------------------------------------- *
 * 4. Normalising the Order payload
 * ------------------------------------------------------------------------- */

/**
 * The handful of fields `leafly_orders` keeps as real columns.
 *
 * Everything else stays inside `raw_order`. Promoting a field to a column is a
 * commitment, and each of these earns it: they are the ones the board filters,
 * sorts or reasons about. `medicalStatus` is here because a medical order has
 * different compliance handling at the counter; `marketplace` because an
 * UberEats order behaves differently and the spec says so.
 */
export type NormalisedOrderFacts = {
  orderId: string | null;
  status: string | null;
  fulfillmentMechanism: string | null;
  marketplace: string | null;
  medicalStatus: string | null;
  paymentPreference: string | null;
  cancelationReasonCode: string | null;
  canceledAt: string | null;
  /** How many cart lines the fetched order carried. Zero is a real answer. */
  cartItemCount: number;
  /** Minor units, as Leafly sends them. Null when absent. */
  subtotalMinorUnits: number | null;
  totalMinorUnits: number | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) ? v : null;
}

/**
 * Pull the promoted columns out of a fetched Order.
 *
 * Every field is optional-tolerant even though the spec marks most of them
 * required. A reader that trusted `required` would throw on the first order
 * Leafly sends with an unexpected null — inside a path that must not throw —
 * and the one order that breaks the rules is precisely the one somebody is
 * trying to diagnose. Being liberal here costs nothing: the values are stored,
 * not acted upon, and `raw_order` keeps the original regardless.
 */
export function normaliseFetchedOrder(raw: unknown): NormalisedOrderFacts {
  const empty: NormalisedOrderFacts = {
    orderId: null,
    status: null,
    fulfillmentMechanism: null,
    marketplace: null,
    medicalStatus: null,
    paymentPreference: null,
    cancelationReasonCode: null,
    canceledAt: null,
    cartItemCount: 0,
    subtotalMinorUnits: null,
    totalMinorUnits: null,
  };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;

  return {
    orderId: str(o.id),
    status: str(o.status),
    fulfillmentMechanism: str(o.fulfillmentMechanism),
    marketplace: str(o.marketplace),
    medicalStatus: str(o.medicalStatus),
    paymentPreference: str(o.paymentPreference),
    cancelationReasonCode: str(o.cancelationReasonCode),
    canceledAt: str(o.canceledAt),
    cartItemCount: Array.isArray(o.cartItems) ? o.cartItems.length : 0,
    subtotalMinorUnits: intOrNull(o.subtotal),
    totalMinorUnits: intOrNull(o.total),
  };
}

/**
 * Is this payload rich enough to build a receipt from?
 *
 * Mirrors exactly what `readLeaflyOrderPayload` in `bridge-core.ts` requires:
 * an `id`, a numeric `subtotal` and a numeric `total`. Stated here as a cheap,
 * dependency-free predicate so the fetch path can tell the difference between
 * "we stored something" and "we stored something printable" WITHOUT importing
 * the 90KB bridge core into this pure module.
 *
 * A compliance test pins the two definitions together, so this cannot quietly
 * disagree with the function it is mirroring.
 */
export function isPrintableOrderPayload(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  const inner =
    o.order !== null && typeof o.order === "object" && !Array.isArray(o.order)
      ? (o.order as Record<string, unknown>)
      : o;
  if (str(inner.id) === null) return false;
  const sub = intOrNull(inner.subtotal);
  const tot = intOrNull(inner.total);
  if (sub === null || sub < 0 || tot === null || tot < 0) return false;

  // ── AT LEAST ONE PRICEABLE LINE ────────────────────────────────────────
  //
  // FOUND BY A CONTRACT TEST, NOT BY INSPECTION. An earlier version of this
  // function stopped at the three checks above, and the pin in
  // tests/compliance/leafly-order-fetch.test.ts ("the cheap predicate agrees
  // with the real reader on every sample") caught it: for
  // `{ id, subtotal, total }` with no cart, this said PRINTABLE while the real
  // receipt builder said `ok: false, reason: "the Leafly order has no line
  // items"`. `buildLeaflyLocalOrderDraft` refuses an empty `lines` array
  // outright, so a receipt was impossible in a case this predicate approved.
  //
  // Why that divergence actually mattered, rather than being merely untidy:
  // `decideArrivalPlan` consumes this boolean to choose between "announce and
  // print" and "announce, flag for attention". Getting it wrong meant the
  // planner reported a clean success with `needsAttention: false` for an order
  // that produced no paper at all — the arrival would look healthy in the log
  // while nothing came out of the printer. That is a quieter version of the
  // very bug this slice exists to fix, so it is fixed here rather than papered
  // over in the test.
  //
  // The rule mirrors the real reader's loop exactly: an item contributes a
  // line only if it is an object carrying a usable whole-number price in
  // either `discountedPriceCents` (preferred — what the shopper actually paid)
  // or `priceCents`. Items without one are skipped there, so they must not
  // count here either. Anything looser and this drifts again; anything
  // stricter and it would refuse orders the reader accepts.
  const items = inner.cartItems;
  if (!Array.isArray(items)) return false;
  for (const item of items) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const ci = item as Record<string, unknown>;
    const price = intOrNull(ci.discountedPriceCents) ?? intOrNull(ci.priceCents);
    if (price !== null) return true;
  }
  return false;
}

/* ------------------------------------------------------------------------- *
 * 5. The arrival plan — what to do when order_submit lands
 * ------------------------------------------------------------------------- */

export type ArrivalPlan = {
  /** Ring the speaker. */
  announce: boolean;
  /** Print the arrival ticket. */
  print: boolean;
  /** One line for the server log and for the dashboard note. */
  summary: string;
  /**
   * True when a human must look at this now. Set when the bell rang but the
   * paper could not be produced — the case where the shop knows an order
   * exists but not what is in it.
   */
  needsAttention: boolean;
};

/**
 * Decide what the arrival stage does, given how the fetch went.
 *
 * ── THE RULE THAT DRIVES EVERY BRANCH ────────────────────────────────────────
 * Announcing is cheap and reversible; a spurious chime costs a moment's
 * attention. NOT announcing is irreversible: fifteen minutes later the order is
 * gone and a paying customer has been told their order was cancelled. So the
 * bell rings on every non-terminal arrival, INCLUDING the ones we failed to
 * read. Printing is different — it requires content we may not have — so it is
 * conditional on a printable payload.
 *
 * `alreadyHandled` exists because Leafly retries. The database claim in
 * `bridge-server.ts` is the real guard against double-ringing; this is the
 * decision that guard enforces, stated where it can be tested.
 */
export function decideArrivalPlan(input: {
  fetch: FetchDisposition;
  printable: boolean;
  alreadyHandled: boolean;
  /** Leafly's status for the order, when known. */
  leaflyStatus?: string | null;
}): ArrivalPlan {
  if (input.alreadyHandled) {
    return {
      announce: false,
      print: false,
      summary: "already handled — nothing repeated",
      needsAttention: false,
    };
  }

  // A cancelled or completed order must never ring the new-order bell. That is
  // the one sound that sends somebody to build a bag for an order that no
  // longer exists.
  const status = typeof input.leaflyStatus === "string" ? input.leaflyStatus.trim() : "";
  if (status === "canceled" || status === "cancelled" || status === "picked_up" || status === "expired") {
    return {
      announce: false,
      print: false,
      summary: `order is already ${status} — no floor action`,
      needsAttention: false,
    };
  }

  if (input.fetch === "success" && input.printable) {
    return {
      announce: true,
      print: true,
      summary: "collected from Leafly — announcing and printing",
      needsAttention: false,
    };
  }

  if (input.fetch === "success" && !input.printable) {
    // Leafly answered 200 but the body was not something we can turn into a
    // ticket. Rare, and worth shouting about rather than silently skipping.
    return {
      announce: true,
      print: false,
      summary:
        "collected from Leafly, but the order could not be turned into a ticket — " +
        "open it in Leafly and accept it by hand",
      needsAttention: true,
    };
  }

  // Every remaining case is a failed fetch. The bell still rings.
  return {
    announce: true,
    print: false,
    summary:
      `an order arrived but could not be collected from Leafly (${input.fetch}) — ` +
      "the acknowledgement clock is running; open it in Leafly",
    needsAttention: true,
  };
}

/* ------------------------------------------------------------------------- *
 * 6. Self-tests
 * ------------------------------------------------------------------------- */

/**
 * The spec's own OrderSubmissionWebhook example, verbatim.
 * Source: docs/leafly-specs/order-api-v1.openapi.json
 *         components.examples.OrderSubmissionWebhook.value
 *
 * Used as a fixture so the tests are grounded in Leafly's document rather than
 * in our idea of what Leafly sends. If Leafly changes the shape, the contract
 * test against the vendored file fails and this fixture is re-derived.
 */
export const SPEC_ORDER_SUBMIT_WEBHOOK = {
  eventTime: "2023-08-11T21:32:33.517Z",
  eventType: "order_submit",
  orderId: "e4dcae37-32d0-4498-ab3d-0c9a93c5f8ea",
  orderIntegrationKey: "iAYK0fC0rjQIGJQKIJvzRnObjElOC40PhLEK9PEUgFFm",
  acknowledgeBy: "2023-08-11T21:47:33.517Z",
} as const;

/**
 * A trimmed but structurally faithful copy of the spec's Order example.
 * Source: components.examples.Order.value (same file).
 */
export const SPEC_FETCHED_ORDER = {
  id: "c58a7fe6-368c-4102-a1ba-285e50208a6e",
  status: "confirmed",
  createdAt: "2023-08-11T20:14:36.214Z",
  canceledAt: null,
  cancelationReasonCode: null,
  firstName: "Genevive",
  lastName: "Klein",
  fulfillmentMechanism: "delivery",
  marketplace: "uberEats",
  medicalStatus: "medical",
  paymentPreference: "cash",
  subtotal: 107276,
  total: 107629,
  cartItems: [
    {
      id: "de5c4bf6-ca62-44c8-9862-d3003f0f4ea8",
      name: "bubbler",
      integratorVariantId: "3cf37035-68e7-4b2c-97af-570f10e0bd03",
      quantity: 2,
      packageSize: "1.0",
      packageUnit: "gram",
      packagePrice: 3355,
      priceCents: 6710,
      discountedPriceCents: 6710,
    },
  ],
  taxes: [
    { amountCents: 8582, label: "Provincial Sales Tax" },
    { amountCents: 5364, label: "Goods and Services Tax" },
  ],
} as const;

export function __runLeaflyOrderFetchTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  [leafly-order-fetch] FAILED: ${label}`);
    }
  };
  const eq = (label: string, actual: unknown, expected: unknown) =>
    ok(`${label} (got ${JSON.stringify(actual)})`, actual === expected);

  // ---- 1. THE BUG, restated as an executable assertion -------------------
  // This is the heart of the whole slice. The submission webhook is NOT a
  // printable order. If this assertion ever flips to true, Leafly has changed
  // its contract and the fetch could in principle be skipped.
  ok(
    "the order_submit webhook is NOT printable — this is the bug",
    !isPrintableOrderPayload(SPEC_ORDER_SUBMIT_WEBHOOK),
  );
  ok(
    "the FETCHED order IS printable — this is the fix",
    isPrintableOrderPayload(SPEC_FETCHED_ORDER),
  );
  // Stated as a pair on purpose: a mutant that made isPrintableOrderPayload
  // always-false would satisfy the first assertion alone.
  ok(
    "the two differ — the fetch is what changes the outcome",
    isPrintableOrderPayload(SPEC_FETCHED_ORDER) !==
      isPrintableOrderPayload(SPEC_ORDER_SUBMIT_WEBHOOK),
  );

  // ---- 2. URLs -----------------------------------------------------------
  eq(
    "sandbox fetch url",
    leaflyFetchOrderUrl("sandbox", "key-123", "ord-abc"),
    "https://reservations-api-sandbox.leafly.io/v1/order_integration/key-123/orders/ord-abc",
  );
  eq(
    "production fetch url",
    leaflyFetchOrderUrl("production", "key-123", "ord-abc"),
    "https://reservations-api.leafly.com/v1/order_integration/key-123/orders/ord-abc",
  );
  ok(
    "the fetch url has no trailing verb — acknowledge/status are different endpoints",
    !leaflyFetchOrderUrl("sandbox", "k", "o").endsWith("/acknowledge") &&
      !leaflyFetchOrderUrl("sandbox", "k", "o").endsWith("/status"),
  );
  ok(
    "path segments are encoded",
    leaflyFetchOrderUrl("sandbox", "a/b", "c d").includes("a%2Fb") &&
      leaflyFetchOrderUrl("sandbox", "a/b", "c d").includes("c%20d"),
  );
  ok(
    "the order host is NOT the menu host",
    LEAFLY_ORDER_FETCH_BASE_URLS.sandbox.includes("reservations-api") &&
      !LEAFLY_ORDER_FETCH_BASE_URLS.sandbox.includes("menu_integration"),
  );
  ok(
    "sandbox is leafly.io and production is leafly.com",
    LEAFLY_ORDER_FETCH_BASE_URLS.sandbox.includes("leafly.io") &&
      LEAFLY_ORDER_FETCH_BASE_URLS.production.includes("leafly.com"),
  );
  ok(
    "the two environments are not the same string",
    LEAFLY_ORDER_FETCH_BASE_URLS.sandbox !== LEAFLY_ORDER_FETCH_BASE_URLS.production,
  );

  // ---- 3. Refusals -------------------------------------------------------
  ok("a blank order id refuses", decideOrderFetch({ leaflyOrderId: "  ", orderIntegrationKey: "k" }).allowed === false);
  eq(
    "and says which",
    (decideOrderFetch({ leaflyOrderId: "", orderIntegrationKey: "k" }) as { code: string }).code,
    "missing_order_id",
  );
  ok(
    "a missing integration key refuses",
    decideOrderFetch({ leaflyOrderId: "o", orderIntegrationKey: null }).allowed === false,
  );
  eq(
    "with its own code, never confused with a missing order",
    (decideOrderFetch({ leaflyOrderId: "o", orderIntegrationKey: "" }) as { code: string }).code,
    "missing_integration_key",
  );
  ok(
    "the missing-key refusal names where to fix it",
    (decideOrderFetch({ leaflyOrderId: "o", orderIntegrationKey: "" }) as { reason: string })
      .reason.includes("Integrations"),
  );
  ok("both present is allowed", decideOrderFetch({ leaflyOrderId: "o", orderIntegrationKey: "k" }).allowed);

  // ---- 4. Response classification ---------------------------------------
  eq("200 is success", assessOrderFetch(200).disposition, "success");
  eq("401 is a credentials problem", assessOrderFetch(401).disposition, "fix_credentials");
  eq("403 is a credentials problem", assessOrderFetch(403).disposition, "fix_credentials");
  eq("404 on an unknown order is not_found", assessOrderFetch(404).disposition, "not_found");
  eq(
    "404 on an order we already hold is 'gone', not 'not found'",
    assessOrderFetch(404, { knownLocally: true }).disposition,
    "gone",
  );
  ok(
    "the 'gone' message explains Leafly's 24-hour retention rather than alarming anyone",
    assessOrderFetch(404, { knownLocally: true }).message.includes("twenty-four hours"),
  );
  eq("no answer at all is retryable", assessOrderFetch(null).disposition, "retry");
  ok("and says the clock is still running", assessOrderFetch(null).message.includes("fifteen-minute"));
  eq("500 is retryable", assessOrderFetch(500).disposition, "retry");
  eq("503 is retryable", assessOrderFetch(503).disposition, "retry");
  eq("429 is retryable", assessOrderFetch(429).disposition, "retry");
  eq("418 is unexpected", assessOrderFetch(418).disposition, "unexpected");
  ok("only retryable dispositions claim to be retryable", assessOrderFetch(401).retryable === false);
  ok("a success is not 'retryable'", assessOrderFetch(200).retryable === false);
  ok(
    "every documented status is classified as something other than 'unexpected'",
    LEAFLY_FETCH_DOCUMENTED_STATUSES.every((s) => assessOrderFetch(s).disposition !== "unexpected"),
  );
  ok(
    "every assessment carries a non-empty human message",
    [null, 200, 401, 403, 404, 429, 500, 418].every(
      (s) => assessOrderFetch(s as number | null).message.trim().length > 10,
    ),
  );

  // ---- 5. Normalisation --------------------------------------------------
  const facts = normaliseFetchedOrder(SPEC_FETCHED_ORDER);
  eq("the order id is read", facts.orderId, "c58a7fe6-368c-4102-a1ba-285e50208a6e");
  eq("the status is read", facts.status, "confirmed");
  eq("the fulfilment mechanism is read", facts.fulfillmentMechanism, "delivery");
  eq("the marketplace is read", facts.marketplace, "uberEats");
  eq("the medical status is read", facts.medicalStatus, "medical");
  eq("the payment preference is read", facts.paymentPreference, "cash");
  eq("the cart is counted", facts.cartItemCount, 1);
  eq("the subtotal is taken as given, in minor units", facts.subtotalMinorUnits, 107276);
  eq("the total is taken as given, in minor units", facts.totalMinorUnits, 107629);
  eq("a null canceledAt stays null", facts.canceledAt, null);

  const emptyFacts = normaliseFetchedOrder(null);
  eq("null normalises to no order id", emptyFacts.orderId, null);
  eq("null normalises to zero cart items", emptyFacts.cartItemCount, 0);
  eq("a string normalises safely", normaliseFetchedOrder("nope").orderId, null);
  eq("an array normalises safely", normaliseFetchedOrder([1, 2]).orderId, null);
  // A blank string is NOT a value. Storing "" as a status would make the board
  // render an empty badge that looks like a state.
  eq("blank strings become null", normaliseFetchedOrder({ status: "   " }).status, null);
  // Non-integer money is refused rather than rounded: silently truncating a
  // price is how a receipt disagrees with what the shopper was charged.
  eq("a fractional subtotal is refused", normaliseFetchedOrder({ subtotal: 12.5 }).subtotalMinorUnits, null);
  eq("a string subtotal is refused", normaliseFetchedOrder({ subtotal: "100" }).subtotalMinorUnits, null);
  // Zero is a legitimate total (a fully discounted order) and must survive.
  eq("a zero total survives", normaliseFetchedOrder({ total: 0 }).totalMinorUnits, 0);

  // ---- 6. Printability ---------------------------------------------------
  //
  // CORRECTED AFTER A CONTRACT TEST CAUGHT THESE ASSERTIONS BEING WRONG.
  //
  // Three assertions here originally claimed that `{ id, subtotal, total }`
  // with NO cart was printable. They passed, and they were false. The pin in
  // tests/compliance/leafly-order-fetch.test.ts runs the same inputs through
  // the REAL receipt builder, `readLeaflyOrderPayload`, and proved the real
  // answer is `ok: false` — `buildLeaflyLocalOrderDraft` refuses an order with
  // an empty `lines` array ("the Leafly order has no line items").
  //
  // This is worth keeping in the record rather than quietly editing, because
  // it is the exact failure mode of pure self-tests: they are fast and total,
  // and they can only ever check the belief the author held while writing
  // them. Three assertions agreeing with a wrong belief is not evidence. Only
  // a test that reads the OTHER module could find it, which is why the seam
  // between modules is pinned separately.
  //
  // A receipt needs a NAME, a PRICE and a QUANTITY on it. Totals alone print a
  // blank ticket, which is why the real builder refuses them.
  const CART = [{ name: "Blue Dream", quantity: 1, discountedPriceCents: 1 }];

  ok("no id is not printable", !isPrintableOrderPayload({ subtotal: 1, total: 1, cartItems: CART }));
  ok("no subtotal is not printable", !isPrintableOrderPayload({ id: "x", total: 1, cartItems: CART }));
  ok("no total is not printable", !isPrintableOrderPayload({ id: "x", subtotal: 1, cartItems: CART }));
  ok(
    "id + subtotal + total + a priced cart line is printable",
    isPrintableOrderPayload({ id: "x", subtotal: 1, total: 1, cartItems: CART }),
  );
  ok(
    "zeroes are printable — a fully discounted order is still an order",
    isPrintableOrderPayload({
      id: "x",
      subtotal: 0,
      total: 0,
      cartItems: [{ name: "Freebie", quantity: 1, discountedPriceCents: 0 }],
    }),
  );
  ok(
    "a negative subtotal is not printable",
    !isPrintableOrderPayload({ id: "x", subtotal: -1, total: 1, cartItems: CART }),
  );
  ok(
    "an envelope shape is unwrapped, matching bridge-core",
    isPrintableOrderPayload({ order: { id: "x", subtotal: 1, total: 1, cartItems: CART } }),
  );
  ok("null is not printable", !isPrintableOrderPayload(null));
  ok("an array is not printable", !isPrintableOrderPayload([]));

  // ---- 6b. The empty-cart family, which is what the pin exposed ----------
  //
  // Every one of these agrees with `readLeaflyOrderPayload` by construction:
  // no priced line means no receipt, whatever the totals say.
  ok(
    "totals with NO cart key at all are not printable",
    !isPrintableOrderPayload({ id: "x", subtotal: 1, total: 1 }),
  );
  ok(
    "totals with an EMPTY cart are not printable",
    !isPrintableOrderPayload({ id: "x", subtotal: 1, total: 1, cartItems: [] }),
  );
  ok(
    "a cart that is not an array is not printable",
    !isPrintableOrderPayload({ id: "x", subtotal: 1, total: 1, cartItems: "one thing" }),
  );
  ok(
    "a cart of nulls is not printable",
    !isPrintableOrderPayload({ id: "x", subtotal: 1, total: 1, cartItems: [null, null] }),
  );
  ok(
    "a cart line with no price at all is not printable — the reader skips it",
    !isPrintableOrderPayload({
      id: "x",
      subtotal: 1,
      total: 1,
      cartItems: [{ name: "Mystery", quantity: 1 }],
    }),
  );
  ok(
    "a cart line priced only by priceCents IS printable — the reader falls back to it",
    isPrintableOrderPayload({
      id: "x",
      subtotal: 1,
      total: 1,
      cartItems: [{ name: "Undiscounted", quantity: 1, priceCents: 500 }],
    }),
  );
  ok(
    "one priced line among unpriced ones is enough",
    isPrintableOrderPayload({
      id: "x",
      subtotal: 1,
      total: 1,
      cartItems: [{ name: "No price" }, { name: "Priced", discountedPriceCents: 250 }],
    }),
  );
  ok(
    "a non-integer line price does not count as priced",
    !isPrintableOrderPayload({
      id: "x",
      subtotal: 1,
      total: 1,
      cartItems: [{ name: "Odd", discountedPriceCents: 1.5 }],
    }),
  );
  ok(
    "the spec's own submit webhook is still not printable",
    !isPrintableOrderPayload(SPEC_ORDER_SUBMIT_WEBHOOK),
  );
  ok(
    "the spec's own fetched order is still printable",
    isPrintableOrderPayload(SPEC_FETCHED_ORDER),
  );

  // ---- 7. The arrival plan ----------------------------------------------
  const good = decideArrivalPlan({ fetch: "success", printable: true, alreadyHandled: false });
  ok("a good arrival announces", good.announce);
  ok("a good arrival prints", good.print);
  ok("a good arrival needs no attention", !good.needsAttention);

  // THE MOST IMPORTANT ASSERTION IN THIS FILE. A failed fetch must still ring
  // the bell, because silence costs the order.
  for (const d of ["retry", "fix_credentials", "not_found", "gone", "unexpected"] as const) {
    const plan = decideArrivalPlan({ fetch: d, printable: false, alreadyHandled: false });
    ok(`a '${d}' fetch STILL announces — silence would lose the order`, plan.announce);
    ok(`a '${d}' fetch does not print an order it never read`, !plan.print);
    ok(`a '${d}' fetch flags that a human is needed`, plan.needsAttention);
  }

  const odd = decideArrivalPlan({ fetch: "success", printable: false, alreadyHandled: false });
  ok("a 200 with an unreadable body still announces", odd.announce);
  ok("a 200 with an unreadable body does not print", !odd.print);
  ok("a 200 with an unreadable body needs attention", odd.needsAttention);

  const repeat = decideArrivalPlan({ fetch: "success", printable: true, alreadyHandled: true });
  ok("a repeat announces nothing", !repeat.announce);
  ok("a repeat prints nothing", !repeat.print);
  ok("a repeat is not an alarm", !repeat.needsAttention);

  for (const s of ["canceled", "picked_up", "expired"]) {
    const term = decideArrivalPlan({
      fetch: "success",
      printable: true,
      alreadyHandled: false,
      leaflyStatus: s,
    });
    ok(`a '${s}' order does not ring the new-order bell`, !term.announce);
    ok(`a '${s}' order does not print`, !term.print);
  }
  ok(
    "a pending order is not treated as terminal",
    decideArrivalPlan({ fetch: "success", printable: true, alreadyHandled: false, leaflyStatus: "pending" })
      .announce,
  );
  ok(
    "every plan carries a non-empty summary",
    (["success", "retry", "fix_credentials", "not_found", "gone", "unexpected"] as const).every(
      (d) => decideArrivalPlan({ fetch: d, printable: false, alreadyHandled: false }).summary.trim().length > 10,
    ),
  );
  // Printing without announcing would put paper in a tray nobody was told about.
  ok(
    "nothing ever prints without also announcing",
    (["success", "retry", "fix_credentials", "not_found", "gone", "unexpected"] as const).every((d) =>
      [true, false].every((p) => {
        const plan = decideArrivalPlan({ fetch: d, printable: p, alreadyHandled: false });
        return !plan.print || plan.announce;
      }),
    ),
  );

  return { passed, failed };
}
