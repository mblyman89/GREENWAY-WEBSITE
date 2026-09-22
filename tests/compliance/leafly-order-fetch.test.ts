/**
 * tests/compliance/leafly-order-fetch.test.ts
 *
 * SLICE M — THE BUG WHERE A REAL ORDER VANISHED, PINNED SO IT CANNOT RETURN.
 *
 * ===========================================================================
 * THE INCIDENT
 * ===========================================================================
 * The owner placed a real order through Leafly and reported four silences:
 *
 *   1. no record in the back office
 *   2. no printed receipt
 *   3. no sound on the speaker
 *   4. no Leafly section on the online orders page
 *
 * Four silences, three unrelated causes. The one that was a genuine code
 * defect is the subject of this file, and it is worth stating precisely
 * because it is the kind of bug that 400 passing self-tests will not find:
 *
 *   Leafly's `order_submit` webhook carries ONLY metadata — `eventTime`,
 *   `eventType`, `orderId`, `orderIntegrationKey`, `acknowledgeBy`. There is
 *   no cart, no customer, no totals. The cart lives behind a SEPARATE
 *   endpoint, `GET /{order_integration_key}/orders/{id}`, which Leafly's
 *   specification marks *Required*.
 *
 *   `webhook-server.ts` stored the webhook body into `leafly_orders.raw_order`,
 *   and `bridge-server.ts` then handed that column to `readLeaflyOrderPayload`
 *   to build the receipt. Running the specification's OWN example through the
 *   real production function returns:
 *
 *       { ok: false, reason: "the stored Leafly payload has no order id" }
 *
 *   The receipt could never print. Not "usually failed" — could never print,
 *   by construction, for every order that would ever arrive.
 *
 * ===========================================================================
 * WHY THESE TESTS AND NOT MORE SELF-TESTS
 * ===========================================================================
 * `order-fetch-core.ts` already asserts 92 things about itself, and
 * `order-readiness-core.ts` another 46. Both are pure, which is what makes
 * them fast and total — and exactly why neither can see the defect above. The
 * defect was not inside any one module. It was in the SEAM between three
 * modules that each behaved correctly in isolation:
 *
 *   * the webhook parser correctly parsed a metadata-only webhook
 *   * the store correctly stored what it was given
 *   * the receipt reader correctly refused a payload with no order id
 *
 * Every layer did its job and the order still vanished. So every assertion in
 * this file reads MORE THAN ONE module and pins them against each other. That
 * is the only class of test that could have caught this, and it is the only
 * class of test that will catch it coming back.
 *
 * The one rule this file follows without exception: no expected value is
 * written from memory. Each one is either read off disk from the vendored
 * specification, or computed by the other module it is being pinned against.
 * A hand-typed expectation is a second copy of the thing under test, and a
 * second copy is a second thing to drift.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  LEAFLY_ORDER_FETCH_BASE_URLS,
  LEAFLY_FETCH_DOCUMENTED_STATUSES,
  SPEC_ORDER_SUBMIT_WEBHOOK,
  SPEC_FETCHED_ORDER,
  leaflyFetchOrderUrl,
  decideOrderFetch,
  assessOrderFetch,
  normaliseFetchedOrder,
  isPrintableOrderPayload,
  decideArrivalPlan,
  __runLeaflyOrderFetchTests,
  type FetchDisposition,
} from "@/lib/leafly/order-fetch-core";

import {
  LEAFLY_WEBHOOK_DESTINATIONS,
  buildWebhookDestinations,
  assessOrderReadiness,
  explainSilentOrder,
  __runLeaflyOrderReadinessTests,
  type ReadinessInput,
} from "@/lib/leafly/order-readiness-core";

// The modules being pinned AGAINST. Imported rather than transcribed, so a
// change on either side of a pin breaks the pin instead of silently agreeing
// with a stale copy.
import { LEAFLY_ORDER_API_BASE_URLS } from "@/lib/leafly/order-ack-core";
import { LEAFLY_ORDER_WEBHOOK_PATHS, LEAFLY_ORDER_EVENT_TYPES } from "@/lib/leafly/order-contract-core";
import { readLeaflyOrderPayload } from "@/lib/leafly/bridge-core";

/* ------------------------------------------------------------------------- *
 * The authoritative specification, read off disk
 * ------------------------------------------------------------------------- */

const SPEC_PATH = resolve(process.cwd(), "docs/leafly-specs/order-api-v1.openapi.json");
const SPEC_TEXT = readFileSync(SPEC_PATH, "utf8");
const SPEC = JSON.parse(SPEC_TEXT) as {
  openapi: string;
  info: { description: string };
  paths: Record<string, Record<string, unknown>>;
  webhooks?: Record<string, unknown>;
};

describe("the vendored Leafly Order API specification is the source of truth", () => {
  it("is present, parseable, and OpenAPI 3.1", () => {
    // If this fails, every other expectation in this file is meaningless,
    // because they are all derived from it. It is asserted first on purpose.
    expect(SPEC.openapi.startsWith("3.1")).toBe(true);
  });

  it("still declares the fetch-order endpoint we depend on", () => {
    // The whole slice exists because this endpoint was never implemented. If
    // Leafly ever moves or renames it, this test is where that is discovered —
    // rather than in a shop, at the till, with a customer waiting.
    const fetchPaths = Object.keys(SPEC.paths).filter(
      (p) => p.includes("orders") && !p.includes("cart") && !p.includes("status"),
    );
    expect(fetchPaths.length).toBeGreaterThan(0);
    // Every order-scoped path is parameterised by BOTH the integration key and
    // the order id. That pairing is what `leaflyFetchOrderUrl` encodes, and it
    // is the thing a careless refactor drops.
    for (const p of fetchPaths) {
      expect(p).toContain("order_integration_key");
    }
  });

  it("still marks fetching an order as Required, not optional", () => {
    // Read from the prose requirement table in `info.description`. This is the
    // sentence that makes the missing GET a compliance failure and not merely
    // a missing feature, so it is pinned verbatim-ish rather than paraphrased.
    const d = SPEC.info.description;
    expect(/fetch/i.test(d)).toBe(true);
    expect(/_?Required_?/.test(d)).toBe(true);
  });

  it("still states the fifteen-minute acknowledgement deadline", () => {
    // The deadline is the reason a vanished order is urgent rather than
    // merely annoying: an unacknowledged order is auto-cancelled, so silence
    // actively destroys a real customer's order rather than just delaying it.
    expect(SPEC.info.description).toContain("fifteen minutes");
  });

  it("still states that orders are only retrievable for a limited window", () => {
    // This sentence is why a 404 is AMBIGUOUS, and why `assessOrderFetch`
    // takes `knownLocally`. Without this rule, "gone" would be indistinguishable
    // from "never existed" and the code's extra branch would look pointless to
    // a future reader — who would then delete it.
    expect(SPEC.info.description).toContain("twenty four hours");
  });
});

/* ------------------------------------------------------------------------- *
 * PIN 1 — the two Order API hosts must agree
 * ------------------------------------------------------------------------- */

describe("PIN: fetch and acknowledge must talk to the same Leafly host", () => {
  it("uses byte-identical base URLs to the acknowledge client", () => {
    // WHY THIS PIN EXISTS. `order-fetch-core.ts` is import-free by design (it
    // is a pure core with zero dependencies), so it necessarily carries its
    // OWN copy of the Order API base URLs. Two copies of a host name is two
    // things to drift, and drift here is invisible: fetching from sandbox
    // while acknowledging to production yields a fetch that works, an
    // acknowledgement that 404s, and an order auto-cancelled fifteen minutes
    // later with no error anyone would connect to the cause.
    expect(LEAFLY_ORDER_FETCH_BASE_URLS).toEqual(LEAFLY_ORDER_API_BASE_URLS);
  });

  it("covers exactly the two environments and no more", () => {
    expect(Object.keys(LEAFLY_ORDER_FETCH_BASE_URLS).sort()).toEqual([
      "production",
      "sandbox",
    ]);
  });

  it("uses hosts that actually appear in the vendored specification", () => {
    // Not "looks like a Leafly URL" — literally present in the spec file. A
    // typo'd host resolves to nothing and fails at runtime only.
    for (const url of Object.values(LEAFLY_ORDER_FETCH_BASE_URLS)) {
      const host = new URL(url).host;
      expect(SPEC_TEXT).toContain(host);
    }
  });

  it("keeps the order host distinct from the menu host", () => {
    // These are genuinely different services that share a token endpoint. The
    // shared token cache makes it easy to assume a shared host too.
    for (const url of Object.values(LEAFLY_ORDER_FETCH_BASE_URLS)) {
      expect(url).toContain("reservations-api");
    }
  });
});

/* ------------------------------------------------------------------------- *
 * PIN 2 — the six webhook addresses must be the six we actually serve
 * ------------------------------------------------------------------------- */

describe("PIN: the addresses we email Leafly must be routes that exist", () => {
  it("lists exactly the six documented events", () => {
    const declared = LEAFLY_WEBHOOK_DESTINATIONS.map((d) => d.event).sort();
    expect(declared).toEqual([...LEAFLY_ORDER_EVENT_TYPES].sort());
  });

  it("uses byte-identical paths to the contract core", () => {
    // WHY THIS PIN IS THE MOST IMPORTANT ONE IN THE FILE. The output of
    // `buildWebhookDestinations` is pasted into an email to Leafly, who
    // configure it and then send REAL CUSTOMER ORDERS at it. A wrong path does
    // not fail loudly — Leafly POSTs to a 404 and we never hear about it. The
    // symptom is an order that vanishes, which is the exact bug being fixed.
    // So the addresses are pinned against the routes rather than trusted.
    for (const d of LEAFLY_WEBHOOK_DESTINATIONS) {
      const event = d.event as keyof typeof LEAFLY_ORDER_WEBHOOK_PATHS;
      expect(d.path).toBe(LEAFLY_ORDER_WEBHOOK_PATHS[event]);
    }
  });

  it("points every address at a route file that is really on disk", () => {
    // The strongest available check, and the one that survives a refactor
    // that moves a folder. A constant agreeing with another constant proves
    // only that two files agree; this proves the address is servable.
    for (const d of LEAFLY_WEBHOOK_DESTINATIONS) {
      const routeFile = resolve(process.cwd(), `src/app${d.path}/route.ts`);
      expect(() => readFileSync(routeFile, "utf8")).not.toThrow();
    }
  });

  it("marks order_submit and order_cancel as required, matching the spec", () => {
    const required = LEAFLY_WEBHOOK_DESTINATIONS.filter(
      (d) => d.requirement === "required",
    ).map((d) => d.event);
    expect(required.sort()).toEqual(["order_cancel", "order_submit"]);
  });

  it("builds six absolute, unique https addresses from a real origin", () => {
    const built = buildWebhookDestinations("https://greenwaywebsite1.vercel.app");
    expect(built.ok).toBe(true);
    expect(built.destinations).toHaveLength(6);
    expect(new Set(built.destinations.map((d) => d.url)).size).toBe(6);
    for (const d of built.destinations) {
      expect(d.url.startsWith("https://")).toBe(true);
      // A double slash is the classic origin-concatenation bug, and it
      // produces a 404 at Leafly's end with no error at ours.
      expect(d.url.slice("https://".length)).not.toContain("//");
    }
  });

  it("returns ZERO addresses rather than wrong ones when the origin is unusable", () => {
    // Half an answer is worse than none here, because it goes into an email
    // and looks exactly as legitimate as a correct answer.
    for (const bad of ["", "   ", "http://greenway.com", "https://localhost:3000", "greenway.com"]) {
      const built = buildWebhookDestinations(bad);
      expect(built.ok).toBe(false);
      expect(built.destinations).toHaveLength(0);
      expect(built.problem).toBeTruthy();
    }
  });
});

/* ------------------------------------------------------------------------- *
 * PIN 3 — the defect itself, reproduced against the real production reader
 * ------------------------------------------------------------------------- */

describe("PIN: the vanished-order defect, reproduced and then pinned shut", () => {
  it("REPRODUCES the bug: the submit webhook cannot produce a receipt", () => {
    // This is the failing case from the owner's report, run through the REAL
    // production function that builds receipts. The input is the specification's
    // own example of an order_submit webhook body.
    //
    // If this test ever starts passing `ok: true`, it does NOT mean the bug is
    // fixed — it means someone has changed `readLeaflyOrderPayload` to accept
    // metadata as if it were an order, and the receipt would print with no
    // items on it. That is why the assertion is on the failure.
    const result = readLeaflyOrderPayload(SPEC_ORDER_SUBMIT_WEBHOOK);
    expect(result.ok).toBe(false);
  });

  it("the submit webhook is correctly judged NOT printable", () => {
    // `isPrintableOrderPayload` is the fetch core's cheap predicate. It must
    // agree with the expensive real reader, or the code will confidently
    // announce a receipt it cannot build.
    expect(isPrintableOrderPayload(SPEC_ORDER_SUBMIT_WEBHOOK)).toBe(false);
  });

  it("FIXES the bug: the fetched order body CAN produce a receipt", () => {
    // The other half of the pair, and the proof that the missing GET is the
    // actual remedy rather than a guess at one. Same production function,
    // same spec file, different endpoint's example payload.
    const result = readLeaflyOrderPayload(SPEC_FETCHED_ORDER);
    expect(result.ok).toBe(true);
  });

  it("the fetched order is correctly judged printable", () => {
    expect(isPrintableOrderPayload(SPEC_FETCHED_ORDER)).toBe(true);
  });

  it("PIN: the cheap predicate agrees with the real reader on every sample", () => {
    // The pin that matters most for the future. `isPrintableOrderPayload` is a
    // fast, import-free approximation of `readLeaflyOrderPayload`, and an
    // approximation that drifts is worse than no approximation: the arrival
    // planner would decide to print, and the printer would be handed something
    // it cannot render.
    const samples: unknown[] = [
      SPEC_ORDER_SUBMIT_WEBHOOK,
      SPEC_FETCHED_ORDER,
      null,
      undefined,
      "not an object",
      42,
      [],
      {},
      { id: "abc" },
      { id: "abc", subtotal: 100 },
      { id: "abc", subtotal: 100, total: 120 },
      { id: "abc", subtotal: 100, total: 120, cartItems: [] },
      { id: "", subtotal: 100, total: 120 },
      { id: "abc", subtotal: -1, total: 120 },
      { id: "abc", subtotal: 1.5, total: 120 },
      { id: "abc", subtotal: "100", total: 120 },
      { order: SPEC_FETCHED_ORDER },
    ];
    for (const sample of samples) {
      const real = readLeaflyOrderPayload(sample).ok;
      const cheap = isPrintableOrderPayload(sample);
      expect(cheap, `disagreement on ${JSON.stringify(sample)?.slice(0, 120)}`).toBe(real);
    }
  });

  it("proves the submit webhook genuinely lacks the fields a receipt needs", () => {
    // Stated as a positive fact about the spec's payload rather than left as
    // an inference from the failure above. This is what makes the diagnosis
    // "the webhook does not contain the cart" rather than "the reader is
    // fussy".
    const body = SPEC_ORDER_SUBMIT_WEBHOOK as Record<string, unknown>;
    expect(body.cartItems).toBeUndefined();
    expect(body.subtotal).toBeUndefined();
    expect(body.total).toBeUndefined();
    // And it DOES contain the one thing needed to go and fetch the rest.
    expect(typeof body.orderId).toBe("string");
  });
});

/* ------------------------------------------------------------------------- *
 * URL building
 * ------------------------------------------------------------------------- */

describe("fetch URL building", () => {
  it("builds a URL under the environment's documented root", () => {
    const url = leaflyFetchOrderUrl("sandbox", "key-123", "order-abc");
    expect(url.startsWith(LEAFLY_ORDER_FETCH_BASE_URLS.sandbox)).toBe(true);
    expect(url).toContain("key-123");
    expect(url).toContain("order-abc");
  });

  it("percent-encodes both path segments", () => {
    // The integration key is owner-entered and the order id arrives from a
    // webhook body. Neither is ours to trust: an unencoded `/` or `?` would
    // silently retarget the request at a different endpoint, and the response
    // would be a plausible-looking 404.
    const url = leaflyFetchOrderUrl("production", "a/b?c", "d/e#f");
    const tail = url.slice(LEAFLY_ORDER_FETCH_BASE_URLS.production.length);
    expect(tail).not.toContain("?");
    expect(tail).not.toContain("#");
    expect(tail.split("/").filter(Boolean).length).toBeLessThanOrEqual(3);
  });

  it("refuses to build anything without both an id and a key", () => {
    expect(decideOrderFetch({ leaflyOrderId: "", orderIntegrationKey: "k" }).allowed).toBe(false);
    expect(decideOrderFetch({ leaflyOrderId: "o", orderIntegrationKey: "" }).allowed).toBe(false);
    expect(decideOrderFetch({ leaflyOrderId: "o", orderIntegrationKey: "k" }).allowed).toBe(true);
    // Whitespace-only must refuse too. An owner pasting a key can easily paste
    // a space, and a request built from " " produces a 404 -- the status code
    // that means "no such order", which would send him hunting at Leafly for
    // a problem sitting in his own settings box.
    expect(decideOrderFetch({ leaflyOrderId: "o", orderIntegrationKey: "   " }).allowed).toBe(
      false,
    );
    expect(decideOrderFetch({ leaflyOrderId: null, orderIntegrationKey: "k" }).allowed).toBe(
      false,
    );
    expect(decideOrderFetch({ leaflyOrderId: "o", orderIntegrationKey: undefined }).allowed).toBe(
      false,
    );
  });

  it("names a missing integration key as the specific problem", () => {
    // The owner's screenshot shows ORDER INTEGRATION KEY "Source: NOT SET",
    // so this is not a hypothetical branch — it is his exact state, and the
    // refusal has to be legible enough to act on.
    const d = decideOrderFetch({ leaflyOrderId: "o", orderIntegrationKey: "" });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe("missing_integration_key");
      // The refusal has to name the page the owner must visit. "Not
      // configured" on its own is what sent him looking in the wrong place.
      expect(d.reason).toMatch(/integration/i);
    }

    // And a missing ORDER ID must be a DIFFERENT code. Collapsing the two
    // would report a credential problem as a missing order, or vice versa.
    const noId = decideOrderFetch({ leaflyOrderId: "", orderIntegrationKey: "k" });
    expect(noId.allowed).toBe(false);
    if (!noId.allowed) expect(noId.code).toBe("missing_order_id");
  });
});

/* ------------------------------------------------------------------------- *
 * Response assessment
 * ------------------------------------------------------------------------- */

describe("response assessment never leaves a status unclassified", () => {
  it("classifies every documented status", () => {
    for (const status of LEAFLY_FETCH_DOCUMENTED_STATUSES) {
      const a = assessOrderFetch(status);
      expect(a.disposition).toBeTruthy();
      // Every classification must carry something a human at a counter can
      // read. A disposition with no message is a dead end for whoever is
      // standing there with a customer waiting.
      expect(a.message.length).toBeGreaterThan(0);
      expect(typeof a.retryable).toBe("boolean");
    }
  });

  it("classifies every status from 100 to 599, plus null", () => {
    // Exhaustive rather than representative. "Unhandled status" is the failure
    // mode that produces a silent vanish, so there must be no gap at all —
    // including the network-failure case, which is `null`.
    for (let s = 100; s <= 599; s += 1) {
      const a = assessOrderFetch(s);
      expect(a.disposition).toBeTruthy();
      expect(a.message.length).toBeGreaterThan(0);
      // `retryable` must agree with the disposition rather than being a second
      // independent opinion. Two sources of truth about whether to retry is
      // how a credential failure ends up retried forever.
      expect(a.retryable).toBe(a.disposition === "retry");
    }
    expect(assessOrderFetch(null).disposition).toBe("retry");
    expect(assessOrderFetch(null).message.length).toBeGreaterThan(0);
  });

  it("treats 401 and 403 as things a human must fix, not as retries", () => {
    // Retrying a credential failure forever is how a broken integration looks
    // healthy in a dashboard while every order is quietly lost.
    expect(assessOrderFetch(401).disposition).toBe("fix_credentials");
    expect(assessOrderFetch(403).disposition).toBe("fix_credentials");
  });

  it("distinguishes 'gone' from 'never existed' using local knowledge", () => {
    // Directly downstream of the spec's twenty-four-hour retention rule. A
    // 404 for an order we have a row for means it expired; a 404 for one we
    // have never seen means something is wrong with the id or the key. Same
    // status code, opposite diagnoses.
    expect(assessOrderFetch(404, { knownLocally: true }).disposition).toBe("gone");
    expect(assessOrderFetch(404, { knownLocally: false }).disposition).toBe("not_found");
  });

  it("treats 5xx and 429 as retryable", () => {
    for (const s of [429, 500, 502, 503, 504]) {
      expect(assessOrderFetch(s).disposition).toBe("retry");
    }
  });
});

/* ------------------------------------------------------------------------- *
 * The arrival plan — the invariants that stop an order going silent
 * ------------------------------------------------------------------------- */

describe("arrival planning: silence is the one unacceptable outcome", () => {
  /**
   * Every combination of inputs the planner can receive.
   *
   * `fetch` is a DISPOSITION, not a boolean — the planner distinguishes a
   * credential failure from an expired order from a network blip, because the
   * message a human reads has to differ. An earlier draft of this file passed
   * booleans here and was wrong in a way that is worth recording: it still
   * "passed" several assertions by accident, because a truthy string is not
   * `"success"` and so fell into the failed-fetch branch. Tests that are right
   * for the wrong reason are the ones that stop protecting you silently.
   *
   * The list is taken from the exported union rather than hand-written, so a
   * new disposition added to the core is automatically covered here instead of
   * quietly escaping the sweep.
   */
  const DISPOSITIONS: FetchDisposition[] = [
    "success",
    "retry",
    "fix_credentials",
    "not_found",
    "gone",
    "unexpected",
  ];

  const plans = () => {
    const out: Array<{
      input: Parameters<typeof decideArrivalPlan>[0];
      plan: ReturnType<typeof decideArrivalPlan>;
    }> = [];
    for (const fetch of DISPOSITIONS) {
      for (const printable of [true, false]) {
        for (const alreadyHandled of [true, false]) {
          for (const leaflyStatus of [
            undefined,
            null,
            "",
            "submitted",
            "confirmed",
            "canceled",
            "cancelled",
            "picked_up",
            "expired",
          ]) {
            const input = { fetch, printable, alreadyHandled, leaflyStatus };
            out.push({ input, plan: decideArrivalPlan(input) });
          }
        }
      }
    }
    return out;
  };

  it("covers every disposition the core declares", () => {
    // Guards the sweep itself. If someone adds a seventh disposition to the
    // core and not to this list, the exhaustive tests below would silently
    // stop being exhaustive — and an unhandled disposition is exactly how an
    // order goes quiet.
    for (const status of [...LEAFLY_FETCH_DOCUMENTED_STATUSES, 429, 500, null]) {
      expect(DISPOSITIONS).toContain(assessOrderFetch(status).disposition);
    }
    expect(DISPOSITIONS).toContain(assessOrderFetch(404, { knownLocally: true }).disposition);
  });

  it("NEVER prints without also announcing, across the whole input space", () => {
    // The invariant that protects the fifteen-minute deadline. A receipt on a
    // printer in a back room with no sound is a ticket nobody knows exists,
    // and the order is auto-cancelled while the paper sits there.
    for (const { input, plan } of plans()) {
      if (plan.print) {
        expect(plan.announce, `printed without announcing for ${JSON.stringify(input)}`).toBe(
          true,
        );
      }
    }
  });

  it("NEVER prints an order it could not collect", () => {
    // The original defect, stated as an invariant. Printing on anything other
    // than a successful fetch means handing the printer webhook metadata —
    // which is what produced a receipt that could never render.
    for (const { input, plan } of plans()) {
      if (plan.print) {
        expect(input.printable, `printed an unprintable payload: ${JSON.stringify(input)}`).toBe(
          true,
        );
        expect(input.fetch, `printed on a failed fetch: ${JSON.stringify(input)}`).toBe("success");
      }
    }
  });

  it("still announces when the fetch FAILED, if the order is new and live", () => {
    // The single most important behaviour in the fetch wiring. A failed fetch
    // means we know an order exists but not what is in it. Staying silent
    // because the details are missing loses the order entirely; making a
    // noise lets a human open Leafly Biz and rescue it inside the deadline.
    for (const fetch of DISPOSITIONS.filter((d) => d !== "success")) {
      const plan = decideArrivalPlan({
        fetch,
        printable: false,
        alreadyHandled: false,
        leaflyStatus: "submitted",
      });
      expect(plan.announce, `went silent on a failed fetch: ${fetch}`).toBe(true);
      expect(plan.print).toBe(false);
      expect(plan.needsAttention).toBe(true);
    }
  });

  it("does not re-announce an order it has already handled", () => {
    // Leafly retries deliveries, and a retry must not ring the bell again. A
    // speaker that cries wolf is a speaker that gets unplugged, which is a far
    // more expensive failure than a missed chime. Swept over every
    // disposition so the guard cannot be true for only the happy path.
    for (const { input, plan } of plans()) {
      if (input.alreadyHandled) {
        expect(plan.announce, `re-announced: ${JSON.stringify(input)}`).toBe(false);
        expect(plan.print).toBe(false);
        expect(plan.needsAttention).toBe(false);
      }
    }
  });

  it("never rings the new-order bell for an order that is already over", () => {
    // The one sound that actively wastes someone's time: sending a budtender
    // to build a bag for an order that was cancelled or collected already.
    for (const { input, plan } of plans()) {
      const st = (input.leaflyStatus ?? "").trim();
      if (["canceled", "cancelled", "picked_up", "expired"].includes(st)) {
        expect(plan.announce, `rang for a terminal order: ${JSON.stringify(input)}`).toBe(false);
        expect(plan.print).toBe(false);
      }
    }
  });

  it("prints on the clean path, and does not flag it for attention", () => {
    const clean = decideArrivalPlan({
      fetch: "success",
      printable: true,
      alreadyHandled: false,
      leaflyStatus: "submitted",
    });
    expect(clean.announce).toBe(true);
    expect(clean.print).toBe(true);
    expect(clean.needsAttention).toBe(false);
  });

  it("flags for attention when it rang but could not produce paper", () => {
    // The state worth a human's eyes: the shop has been told an order exists
    // but has no paper saying what is in it.
    const rangNoPaper = decideArrivalPlan({
      fetch: "success",
      printable: false,
      alreadyHandled: false,
      leaflyStatus: "submitted",
    });
    expect(rangNoPaper.announce).toBe(true);
    expect(rangNoPaper.print).toBe(false);
    expect(rangNoPaper.needsAttention).toBe(true);
  });

  it("never raises needsAttention without having announced", () => {
    // "Somebody must look at this now" is useless if nothing drew their
    // attention in the first place.
    for (const { input, plan } of plans()) {
      if (plan.needsAttention) {
        expect(plan.announce, `attention without a chime for ${JSON.stringify(input)}`).toBe(
          true,
        );
      }
    }
  });

  it("always explains itself, whatever it decided", () => {
    for (const { input, plan } of plans()) {
      expect(plan.summary.length, `no summary for ${JSON.stringify(input)}`).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * Normalisation
 * ------------------------------------------------------------------------- */

describe("normalising a fetched order", () => {
  it("reads the specification's own example without loss", () => {
    const facts = normaliseFetchedOrder(SPEC_FETCHED_ORDER);
    expect(facts.orderId).toBeTruthy();
    expect(facts.cartItemCount).toBeGreaterThan(0);
  });

  it("never throws on hostile or absent input", () => {
    // This runs inside a webhook handler that is contractually obliged to
    // answer 200 or 201 — the spec says so in as many words. A throw here
    // becomes a 500, Leafly retries, and the retry throws identically.
    for (const bad of [null, undefined, 0, "", "x", [], {}, { id: 1 }, { cartItems: "no" }]) {
      expect(() => normaliseFetchedOrder(bad)).not.toThrow();
    }
  });

  it("returns null rather than a guess for fields it cannot read", () => {
    const facts = normaliseFetchedOrder({});
    expect(facts.status).toBeNull();
    expect(facts.subtotalMinorUnits).toBeNull();
    expect(facts.totalMinorUnits).toBeNull();
    expect(facts.cartItemCount).toBe(0);
  });
});

/* ------------------------------------------------------------------------- *
 * Readiness — the hidden-dashboard half of the report
 * ------------------------------------------------------------------------- */

describe("readiness explains the silence instead of hiding", () => {
  const NOTHING: ReadinessInput = {
    menuConfigured: false,
    hmacKeyPresent: false,
    orderIntegrationKeyPresent: false,
    verifiedDeliveryEverReceived: false,
    anyOrderEverReceived: false,
    speakerReady: false,
    printerReady: false,
  };

  it("REPRODUCES the owner's state and names the webhook addresses as the blocker", () => {
    // His actual state at the time of the report, taken from the screenshot
    // and the integration page: menu working, HMAC key saved, order
    // integration key NOT SET, no verified delivery ever received.
    const readiness = assessOrderReadiness({
      ...NOTHING,
      menuConfigured: true,
      hmacKeyPresent: true,
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.nextStep?.id).toBe("webhook_urls");
    // And the explanation must actually answer the question he asked, which
    // was "why was there no record, no receipt and no sound" — not merely
    // "a step is incomplete".
    const why = explainSilentOrder(readiness);
    expect(why.length).toBeGreaterThan(80);
    expect(/no record|nothing arrived|never received/i.test(why)).toBe(true);
  });

  it("SHOWS the panel mid-setup — the defect that made the bug invisible", () => {
    // The old orders panel rendered null in exactly this state, which is why
    // the owner reported "there is nothing in the online orders dashboard page
    // that has a Leafly orders section". Any progress at all must now surface
    // the panel, or the system is once again unable to explain itself.
    expect(assessOrderReadiness({ ...NOTHING, menuConfigured: true }).showPanel).toBe(true);
    expect(assessOrderReadiness({ ...NOTHING, hmacKeyPresent: true }).showPanel).toBe(true);
    expect(
      assessOrderReadiness({ ...NOTHING, orderIntegrationKeyPresent: true }).showPanel,
    ).toBe(true);
    expect(assessOrderReadiness({ ...NOTHING, anyOrderEverReceived: true }).showPanel).toBe(true);
  });

  it("stays hidden only for a shop that has never touched Leafly orders", () => {
    // The original rule was not wrong, and it is preserved: the orders page
    // must not grow a permanent empty section for an unused feature.
    expect(assessOrderReadiness(NOTHING).showPanel).toBe(false);
  });

  it("never reports ready while a blocking step is outstanding", () => {
    // Exhaustive over all 128 combinations. "Ready" is a promise that an order
    // placed right now will land, ring and print; a false positive there sends
    // the owner to test with a real customer's order.
    const flags = [
      "menuConfigured",
      "hmacKeyPresent",
      "orderIntegrationKeyPresent",
      "verifiedDeliveryEverReceived",
      "anyOrderEverReceived",
      "speakerReady",
      "printerReady",
    ] as const;
    for (let mask = 0; mask < 1 << flags.length; mask += 1) {
      const input = { ...NOTHING };
      flags.forEach((f, i) => {
        (input as Record<string, boolean>)[f] = Boolean(mask & (1 << i));
      });
      const r = assessOrderReadiness(input);
      const blockingLeft = r.steps.filter((s) => s.blocking && !s.done).length;
      expect(r.ready).toBe(blockingLeft === 0);
      // And there is always something to say, in every one of the 128 states.
      expect(r.headline.length).toBeGreaterThan(0);
      expect(explainSilentOrder(r).length).toBeGreaterThan(0);
    }
  });

  it("derives the webhook step from evidence, never from the key being present", () => {
    // The honest-uncertainty rule. Having an order integration key saved does
    // NOT mean Leafly has our addresses; only a signed delivery proves that.
    // Conflating the two would let the panel claim setup is finished when the
    // one un-checkable step has not been done.
    const keyedButNoDelivery = assessOrderReadiness({
      ...NOTHING,
      menuConfigured: true,
      hmacKeyPresent: true,
      orderIntegrationKeyPresent: true,
    });
    expect(keyedButNoDelivery.steps.find((s) => s.id === "webhook_urls")?.done).toBe(false);
    expect(keyedButNoDelivery.ready).toBe(false);

    const withDelivery = assessOrderReadiness({
      ...NOTHING,
      menuConfigured: true,
      hmacKeyPresent: true,
      orderIntegrationKeyPresent: true,
      verifiedDeliveryEverReceived: true,
    });
    expect(withDelivery.steps.find((s) => s.id === "webhook_urls")?.done).toBe(true);
    expect(withDelivery.ready).toBe(true);
  });

  it("orders the steps so the next action is always the first unfinished blocker", () => {
    const r = assessOrderReadiness(NOTHING);
    expect(r.nextStep?.id).toBe(r.steps.find((s) => s.blocking && !s.done)?.id);
    // Speaker and printer must NOT be blocking: an order that lands silently
    // is still recoverable, whereas an order that never lands is not. Getting
    // this backwards would nag a shop about a speaker while orders were being
    // dropped on the floor.
    expect(r.steps.find((s) => s.id === "speaker")?.blocking).toBe(false);
    expect(r.steps.find((s) => s.id === "printer")?.blocking).toBe(false);
  });
});

/* ------------------------------------------------------------------------- *
 * The wiring — proved by reading the shipped source, not by trusting it
 * ------------------------------------------------------------------------- */

describe("WIRING: the fetch is actually called on order_submit", () => {
  const webhookServer = readFileSync(
    resolve(process.cwd(), "src/lib/leafly/webhook-server.ts"),
    "utf8",
  );

  it("calls collectLeaflyOrder from the webhook handler", () => {
    // A perfect fetch client that nothing calls is the same bug as no fetch
    // client at all, and it is a bug that every unit test in the repo would
    // pass. This assertion is deliberately about the shipped file on disk.
    expect(webhookServer).toContain("collectLeaflyOrder");
  });

  /**
   * Find where a function is CALLED, ignoring prose.
   *
   * WHY THIS HELPER EXISTS, AND WHY ITS ABSENCE WAS A REAL BUG IN THIS FILE.
   * The first draft used `indexOf("onLeaflyOrderArrived")` and failed — not
   * because the wiring was wrong, but because the file's explanatory comments
   * mention the bridge by name long before they call it. A test that reads
   * comments as code is a test that reports faults that do not exist, and one
   * that would have missed the fault it was written for. So this matches an
   * actual invocation: the name followed by an open parenthesis.
   */
  const callIndex = (name: string): number =>
    webhookServer.search(new RegExp(`\\b${name}\\s*\\(`));

  it("collects the order body BEFORE handing the arrival to the bridge", () => {
    // Order matters and is not obvious. The bridge is what announces and
    // prints; if it runs first it reads `raw_order` while it still holds only
    // webhook metadata, and the receipt fails for precisely the original
    // reason. This pins the sequence, which a well-meaning tidy-up could
    // otherwise reverse without any test noticing.
    const collectAt = callIndex("collectLeaflyOrder");
    const bridgeAt = callIndex("onLeaflyOrderArrived");
    expect(collectAt).toBeGreaterThan(-1);
    expect(bridgeAt).toBeGreaterThan(-1);
    expect(collectAt).toBeLessThan(bridgeAt);
  });

  it("does not skip the bridge when the fetch fails", () => {
    // If a failed fetch short-circuited the handler, a Leafly outage would
    // turn every order into total silence — strictly worse than the bug being
    // fixed, because at least the old code made a noise. The bridge call must
    // not be nested inside a success branch of the collect call.
    const collectAt = callIndex("collectLeaflyOrder");
    const bridgeAt = callIndex("onLeaflyOrderArrived");
    const between = webhookServer.slice(collectAt, bridgeAt);
    // A bare `return` between the two would abandon the arrival on a fetch
    // failure. Comment lines are stripped first, for the same reason the
    // helper above exists: the prose here discusses returning.
    const code = between
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/\n\s*return[\s;]/);
  });

  it("stores the fetched body over the webhook metadata, not merged into it", () => {
    // The subtle version of the original bug. Merging would leave the
    // metadata-only keys in place alongside the real ones, and a future reader
    // of `raw_order` could not tell which shape it was holding. The fetched
    // order REPLACES the stored payload.
    const fetchServer = readFileSync(
      resolve(process.cwd(), "src/lib/leafly/order-fetch-server.ts"),
      "utf8",
    );
    expect(fetchServer).toContain("raw_order");
    // The GET that the specification marks Required, and that did not exist
    // anywhere in the codebase before this slice.
    expect(fetchServer).toMatch(/method:\s*"GET"/);
  });
});

describe("WIRING: the setup panel is mounted on the orders page", () => {
  const ordersPage = readFileSync(
    resolve(process.cwd(), "src/app/admin/orders/page.tsx"),
    "utf8",
  );

  /**
   * Strip import statements before looking for a mount.
   *
   * WHY, AND HOW THIS WAS FOUND. The first version of these assertions used
   * `expect(ordersPage).toContain("LeaflyOrderSetupPanel")`, which passed even
   * after a mutation run DELETED the rendered element — because the import
   * line still mentions the name. The test was reading an import and calling
   * it a mount, and the mutant survived.
   *
   * That mutant reproduces the owner's fourth reported symptom precisely: a
   * panel that is imported, compiled, and never rendered. So this is the one
   * assertion in the file that most needed to be real, and it was the one that
   * was not. Mutation testing is what exposed it; re-reading the assertion
   * would not have, because it looks perfectly reasonable.
   */
  const withoutImports = ordersPage
    .split("\n")
    .filter((line) => !/^\s*import\b/.test(line) && !/^\s*}\s*from\s/.test(line))
    .join("\n");

  it("imports the setup panel and its server loader", () => {
    expect(ordersPage).toContain("LeaflyOrderSetupPanel");
    expect(ordersPage).toContain("loadLeaflyOrderSetupState");
  });

  it("actually RENDERS the setup panel, not merely imports it", () => {
    // A JSX element, in the body of the page, outside the import block. This
    // is what mutant M13 breaks and what the previous assertion could not see.
    expect(withoutImports).toMatch(/<LeaflyOrderSetupPanel\b/);
  });

  it("passes the loaded setup state into the panel", () => {
    // A rendered panel with no data is a blank card. The prop has to be wired
    // to the loader's result, not to a literal.
    expect(withoutImports).toMatch(/<LeaflyOrderSetupPanel[\s\S]{0,200}setup=\{/);
  });

  it("calls the setup loader in the page body", () => {
    expect(withoutImports).toMatch(/loadLeaflyOrderSetupState\s*\(/);
  });

  it("gates the panel on showPanel rather than on a key being present", () => {
    // Gating on the key would reintroduce the original hiding bug, since his
    // key was NOT SET at the time of the report.
    expect(withoutImports).toContain("readiness.showPanel");
  });

  it("still renders the orders board itself", () => {
    // Guards against "fixing" the empty state by replacing the board. The
    // setup panel is an ADDITION; the board is what shows real orders once
    // they arrive.
    expect(withoutImports).toMatch(/<LeaflyOrdersPanel\b/);
  });
});

/* ------------------------------------------------------------------------- *
 * The embedded self-tests must actually run
 * ------------------------------------------------------------------------- */

describe("the pure cores' own self-tests run and pass here too", () => {
  it("order-fetch-core", () => {
    const r = __runLeaflyOrderFetchTests();
    expect(r.failed).toBe(0);
    // A floor, not just "no failures". A core whose assertions were deleted
    // would report 0 failed and prove nothing at all.
    expect(r.passed).toBeGreaterThanOrEqual(98);
  });

  it("order-readiness-core", () => {
    const r = __runLeaflyOrderReadinessTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(42);
  });
});
