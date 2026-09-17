/**
 * tests/compliance/leafly-order-contract.test.ts
 *
 * SLICE L-1b — the Leafly ORDER contract, and the one rule that is invisible in code.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Slice L-1 proved that a prose document cannot hold a contract. `docs/leafly-menu-api-v2.md`
 * said "camelCase for all fields"; it was false, eight field defects descended from it, and
 * nothing in CI noticed for as long as the claim lived only in markdown.
 *
 * The ORDER side has a rule with the same shape and a worse blast radius. Leafly's Order API
 * v1.0 `info.description` states, verbatim:
 *
 *   "Leafly will be the sole originator of automated consumer facing communications related
 *    to orders placed on the Leafly platform. That is, Leafly shoppers should receive _no_
 *    automated emails or text messages from a partner system with regard to order
 *    confirmation, status updates, etc."
 *
 * Greenway already has a working order-confirmation email pipeline. When slice L-5 lands the
 * `order_submit` webhook, reusing that pipeline as-is is both the obvious move and a breach:
 * the shopper gets two confirmations that can disagree with each other. A comment asking a
 * future engineer to remember this would rot exactly like the camelCase claim did.
 *
 * So the rule is a constant, and this file asserts it. Every other assertion here is checked
 * against Leafly's VENDORED spec rather than against our own constants, so that
 * re-downloading the spec turns a Leafly-side change into a red test instead of a production
 * incident.
 *
 * Ground truth: docs/leafly-specs/order-api-v1.openapi.json (docs/leafly-specs/SOURCES.md)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LEAFLY_CUSTOMER_EMAIL_SUPPRESSION_REASON,
  LEAFLY_EMAIL_AUDIENCES,
  LEAFLY_FULFILLMENT_MECHANISMS,
  LEAFLY_NON_SETTABLE_ORDER_STATUSES,
  LEAFLY_ORDER_ACK_DEADLINE_MINUTES,
  LEAFLY_ORDER_API_ROOTS,
  LEAFLY_ORDER_CANCEL_REASONS,
  LEAFLY_ORDER_EVENT_TYPES,
  LEAFLY_ORDER_EVENTS_RETURNING_A_BODY,
  LEAFLY_ORDER_INTEGRATION_MAKES_DASHBOARD_READ_ONLY,
  LEAFLY_ORDER_MARKETPLACES,
  LEAFLY_ORDER_MEDIA_REQUIRES_PRE_ACKNOWLEDGEMENT,
  LEAFLY_ORDER_MEDICAL_STATUSES,
  LEAFLY_ORDER_PAYMENT_PREFERENCES,
  LEAFLY_ORDER_RETAILER_KEY_FIELD,
  LEAFLY_ORDER_RETRIEVAL_WINDOW_HOURS_AFTER_TERMINAL,
  LEAFLY_ORDER_STATUSES,
  LEAFLY_ORDER_WEBHOOK_PATHS,
  LEAFLY_PERMITTED_EMAIL_AUDIENCES,
  LEAFLY_REQUIRED_ORDER_EVENTS,
  LEAFLY_SUPPORTS_DYNAMIC_REQUEST_METADATA,
  LEAFLY_SUPPRESSED_EMAIL_AUDIENCES,
  LEAFLY_TERMINAL_ORDER_STATUSES,
  LEAFLY_WEBHOOK_HOST,
  LEAFLY_WEBHOOK_OK_STATUS_CODES,
  __runLeaflyOrderContractTests,
  isAcceptableLeaflyWebhookStatus,
  isLeaflyOrderEventType,
  isLeaflyOrderStatus,
  isRequiredLeaflyOrderEvent,
  isSettableLeaflyOrderStatus,
  isTerminalLeaflyOrderStatus,
  leaflyEventReturnsBody,
  leaflyWebhookUrl,
  mayEmailAudienceForOrderOrigin,
} from "@/lib/leafly/order-contract-core";
import type { EmailAudience } from "@/lib/orders/notify-outcome-core";

const REPO_ROOT = join(__dirname, "..", "..");
const SPEC_PATH = join(
  REPO_ROOT,
  "docs",
  "leafly-specs",
  "order-api-v1.openapi.json",
);

type OpenApiSpec = {
  openapi: string;
  info: { version: string; description: string };
  servers: { url: string; description?: string }[];
  webhooks: Record<string, Record<string, unknown>>;
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, { enum?: string[]; type?: string }> };
};

const spec: OpenApiSpec = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as OpenApiSpec;
const specDescription = spec.info.description;

/** The enum straight out of Leafly's spec — the only acceptable source for these lists. */
function specEnum(schemaName: string): string[] {
  const schema = spec.components.schemas[schemaName];
  expect(schema, `spec must define components.schemas.${schemaName}`).toBeDefined();
  const values = schema.enum;
  expect(values, `${schemaName} must be an enum in the spec`).toBeDefined();
  return values as string[];
}

describe("Leafly Order API spec is vendored and is the version we built against", () => {
  it("is OpenAPI 3.1 (the order spec uses the `webhooks` key, which 3.0 lacks)", () => {
    expect(spec.openapi.startsWith("3.1")).toBe(true);
  });

  it("is version 1.0", () => {
    expect(spec.info.version).toBe("1.0");
  });

  it("declares exactly the sandbox and production roots we encoded", () => {
    const urls = spec.servers.map((s) => s.url);
    expect(urls).toContain(LEAFLY_ORDER_API_ROOTS.sandbox);
    expect(urls).toContain(LEAFLY_ORDER_API_ROOTS.production);
  });

  it("keeps sandbox on leafly.io and production on leafly.com", () => {
    // Easy to fat-finger into one host; a sandbox test that silently hits production
    // would move real orders.
    expect(LEAFLY_ORDER_API_ROOTS.sandbox).toContain(".leafly.io");
    expect(LEAFLY_ORDER_API_ROOTS.production).toContain(".leafly.com");
    expect(LEAFLY_ORDER_API_ROOTS.sandbox).not.toContain("reservations-api.leafly.com");
  });
});

describe("the six webhook events match Leafly's spec exactly", () => {
  it("our event list equals Leafly's EventType enum", () => {
    expect([...LEAFLY_ORDER_EVENT_TYPES].sort()).toEqual([...specEnum("EventType")].sort());
  });

  it("Leafly declares exactly six webhooks", () => {
    expect(Object.keys(spec.webhooks)).toHaveLength(6);
    expect(LEAFLY_ORDER_EVENT_TYPES).toHaveLength(6);
  });

  it("every declared webhook is POST and answers 200", () => {
    for (const [name, item] of Object.entries(spec.webhooks)) {
      const post = item.post as { responses?: Record<string, unknown> } | undefined;
      expect(post, `${name} must be a POST webhook`).toBeDefined();
      expect(Object.keys(post?.responses ?? {}), `${name} responses`).toContain("200");
    }
  });

  it("only 200 and 201 are acceptable acknowledgements", () => {
    // From the spec: webhooks "should only be responded to with status codes 200 or 201.
    // These webhook events are not the place to apply business rules or validations".
    // Answering 4xx on a business complaint makes Leafly retry then auto-cancel.
    expect([...LEAFLY_WEBHOOK_OK_STATUS_CODES]).toEqual([200, 201]);
    expect(isAcceptableLeaflyWebhookStatus(200)).toBe(true);
    expect(isAcceptableLeaflyWebhookStatus(201)).toBe(true);
    for (const bad of [202, 204, 301, 400, 401, 403, 404, 422, 500, 502]) {
      expect(isAcceptableLeaflyWebhookStatus(bad), `${bad} must not be acceptable`).toBe(
        false,
      );
    }
  });

  it("the spec itself says business rules do not belong in the webhook response", () => {
    expect(specDescription).toMatch(
      /not the place to apply business rules or validations/i,
    );
  });

  it("marks order_submit and order_cancel Required, and the spec agrees", () => {
    expect([...LEAFLY_REQUIRED_ORDER_EVENTS].sort()).toEqual([
      "order_cancel",
      "order_submit",
    ]);
    // The requirement table in the description marks these two, and only these two,
    // as bold-Required webhooks.
    expect(specDescription).toMatch(/\|\s*Order Submission\s*\|\s*Webhook\s*\|[^|]*\|\s*\*\*_Required_\*\*/);
    expect(specDescription).toMatch(/\|\s*Order Cancelation\s*\|\s*Webhook\s*\|[^|]*\|\s*\*\*_Required_\*\*/);
    // ...and that Preview is only Recommended, so a preview outage is not a cert blocker.
    expect(specDescription).toMatch(/\|\s*Order Preview\s*\|\s*Webhook\s*\|[^|]*\|\s*_Recommended_/);
  });

  it("treats order_preview as the ONLY webhook that returns a body", () => {
    expect([...LEAFLY_ORDER_EVENTS_RETURNING_A_BODY]).toEqual(["order_preview"]);
    expect(leaflyEventReturnsBody("order_preview")).toBe(true);
    for (const event of LEAFLY_ORDER_EVENT_TYPES) {
      if (event === "order_preview") continue;
      expect(leaflyEventReturnsBody(event), `${event} must not return a body`).toBe(false);
    }
  });

  it("agrees with the spec that every other webhook returns an EMPTY body", () => {
    // The requirement table spells this out per-webhook; only Preview expects
    // "response bodies matching the specification of this document".
    expect(specDescription).toMatch(
      /Order Submission\s*\|\s*Webhook\s*\|\s*200 Ok, empty response bodies/,
    );
    expect(specDescription).toMatch(
      /Order Preview\s*\|\s*Webhook\s*\|\s*200 Ok, response bodies matching the specification/,
    );
  });

  it("gives every event its own route, all under /api/webhooks/leafly/", () => {
    const paths = Object.values(LEAFLY_ORDER_WEBHOOK_PATHS);
    expect(paths).toHaveLength(6);
    expect(new Set(paths).size).toBe(6);
    for (const p of paths) expect(p.startsWith("/api/webhooks/leafly/")).toBe(true);
  });

  it("derives each path from its event name (underscores become hyphens)", () => {
    for (const event of LEAFLY_ORDER_EVENT_TYPES) {
      expect(LEAFLY_ORDER_WEBHOOK_PATHS[event]).toBe(
        `/api/webhooks/leafly/${event.replace(/_/g, "-")}`,
      );
    }
  });

  it("builds absolute https URLs on the stable project alias", () => {
    expect(leaflyWebhookUrl("order_submit")).toBe(
      "https://greenwaywebsite1.vercel.app/api/webhooks/leafly/order-submit",
    );
    for (const event of LEAFLY_ORDER_EVENT_TYPES) {
      expect(leaflyWebhookUrl(event).startsWith("https://")).toBe(true);
    }
  });

  it("never points Leafly at a per-deployment Vercel URL", () => {
    // A per-deployment hostname changes on every push and would strand every webhook
    // after the next deploy. Owner confirmed the stable alias (Q1).
    expect(LEAFLY_WEBHOOK_HOST).toBe("greenwaywebsite1.vercel.app");
    expect(LEAFLY_WEBHOOK_HOST).not.toMatch(/-[a-z0-9]{6,}-/);
    expect(LEAFLY_WEBHOOK_HOST).not.toContain("git-");
    expect(LEAFLY_WEBHOOK_HOST).not.toContain("greenwaymarijuana.com");
  });

  it("recognises real events and rejects plausible fakes", () => {
    expect(isLeaflyOrderEventType("order_submit")).toBe(true);
    expect(isLeaflyOrderEventType("order_status")).toBe(true);
    for (const fake of ["order_update", "order_ready", "orderSubmit", "submit", ""]) {
      expect(isLeaflyOrderEventType(fake), `${fake} must be rejected`).toBe(false);
    }
  });

  it("marks the required events required and the rest not", () => {
    expect(isRequiredLeaflyOrderEvent("order_submit")).toBe(true);
    expect(isRequiredLeaflyOrderEvent("order_cancel")).toBe(true);
    for (const event of ["order_preview", "order_status", "order_activate", "order_deactivate"] as const) {
      expect(isRequiredLeaflyOrderEvent(event), event).toBe(false);
    }
  });
});

describe("the six REST endpoints match Leafly's spec", () => {
  it("declares exactly the six operations we planned against", () => {
    const ops: string[] = [];
    for (const item of Object.values(spec.paths)) {
      for (const [method, op] of Object.entries(item)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        ops.push((op as { operationId: string }).operationId);
      }
    }
    expect(ops.sort()).toEqual(
      [
        "acknowledgeOrder",
        "getGovernmentId",
        "getMedicalId",
        "getOrder",
        "updateCartItems",
        "updateOrder",
      ].sort(),
    );
  });

  it("keys every endpoint by order_integration_key, not by hostname", () => {
    // "Shared URL domain for all retailers associated with your system ... The
    // `orderIntegrationKey` uniquely identifies each retailer."
    for (const path of Object.keys(spec.paths)) {
      expect(path.startsWith("/{order_integration_key}/"), path).toBe(true);
    }
    expect(LEAFLY_ORDER_RETAILER_KEY_FIELD).toBe("orderIntegrationKey");
    expect(specDescription).toMatch(/Unique per-retailer URL domains are not supported/i);
  });

  it("records that Leafly supports no dynamic request metadata", () => {
    // So a webhook cannot be authenticated by a query-string secret or a custom header;
    // HMAC over the body is the only mechanism available to us (slice L-5).
    expect(LEAFLY_SUPPORTS_DYNAMIC_REQUEST_METADATA).toBe(false);
    expect(specDescription).toMatch(/Dynamic request metadata is not supported/i);
  });
});

describe("order lifecycle vocabulary matches Leafly's enums", () => {
  it("our status list equals Leafly's OrderStatus enum, in order", () => {
    expect([...LEAFLY_ORDER_STATUSES]).toEqual(specEnum("OrderStatus"));
  });

  it("our fulfillment mechanisms equal Leafly's FulfillmentMechanism enum", () => {
    expect([...LEAFLY_FULFILLMENT_MECHANISMS]).toEqual(specEnum("FulfillmentMechanism"));
  });

  it("our marketplaces equal Leafly's Marketplace enum", () => {
    expect([...LEAFLY_ORDER_MARKETPLACES]).toEqual(specEnum("Marketplace"));
  });

  it("our medical statuses equal Leafly's MedicalStatus enum", () => {
    expect([...LEAFLY_ORDER_MEDICAL_STATUSES]).toEqual(specEnum("MedicalStatus"));
  });

  it("our payment preferences equal Leafly's PaymentPreference enum", () => {
    expect([...LEAFLY_ORDER_PAYMENT_PREFERENCES]).toEqual(specEnum("PaymentPreference"));
  });

  it("our cancel reasons equal Leafly's CancelReason enum", () => {
    expect([...LEAFLY_ORDER_CANCEL_REASONS]).toEqual(specEnum("CancelReason"));
  });

  it("includes the cancel reason that WE cause by missing the ack deadline", () => {
    expect(LEAFLY_ORDER_CANCEL_REASONS).toContain("order_api_unacknowledged");
  });

  it("treats picked_up and canceled as the terminal states the spec names", () => {
    expect([...LEAFLY_TERMINAL_ORDER_STATUSES].sort()).toEqual(["canceled", "picked_up"]);
    expect(specDescription).toMatch(/terminal states \(\[`picked_up`, `canceled`\]\)/);
    expect(isTerminalLeaflyOrderStatus("picked_up")).toBe(true);
    expect(isTerminalLeaflyOrderStatus("canceled")).toBe(true);
    for (const s of ["pending", "confirmed", "ready", "out_for_delivery", "arrived_at_customer", "expired"]) {
      expect(isTerminalLeaflyOrderStatus(s), `${s} is not terminal`).toBe(false);
    }
  });

  it("refuses to SET pending or expired, exactly as the spec requires", () => {
    // "Pending and expired are valid statuses but are not valid values for the status
    // update endpoint." Both belong to Leafly: pending is pre-acknowledgement, and
    // expired is what Leafly sets when we blow the deadline.
    expect([...LEAFLY_NON_SETTABLE_ORDER_STATUSES].sort()).toEqual(["expired", "pending"]);
    expect(specDescription).toMatch(
      /Pending and expired are valid statuses but are not valid values for the status update endpoint/i,
    );
    expect(isSettableLeaflyOrderStatus("pending")).toBe(false);
    expect(isSettableLeaflyOrderStatus("expired")).toBe(false);
  });

  it("allows setting every other real status", () => {
    for (const s of LEAFLY_ORDER_STATUSES) {
      const expected = !(LEAFLY_NON_SETTABLE_ORDER_STATUSES as readonly string[]).includes(s);
      expect(isSettableLeaflyOrderStatus(s), s).toBe(expected);
    }
  });

  it("never treats an unknown status as settable", () => {
    for (const fake of ["in_progress", "fulfilled", "complete", "READY", ""]) {
      expect(isLeaflyOrderStatus(fake), `${fake} is not a status`).toBe(false);
      expect(isSettableLeaflyOrderStatus(fake), `${fake} is not settable`).toBe(false);
    }
  });

  it("rejects a jump straight to picked_up as a lifecycle, per the spec", () => {
    // "supporting only direct movement to `picked_up` would not be allowed" — so slice L-6
    // must emit intermediate statuses, not just the terminal one.
    expect(specDescription).toMatch(
      /supporting only direct movement to `picked_up` would not be allowed/i,
    );
  });
});

describe("hard deadlines and access windows are recorded, not remembered", () => {
  it("pins the acknowledgement deadline at the spec's fifteen minutes", () => {
    expect(LEAFLY_ORDER_ACK_DEADLINE_MINUTES).toBe(15);
    expect(specDescription).toMatch(
      /acknowledged as having been retrieved in whole by your system within fifteen minutes/i,
    );
    expect(specDescription).toMatch(/not acknowledged by this deadline will be auto canceled/i);
  });

  it("pins the post-terminal retrieval window at twenty four hours", () => {
    expect(LEAFLY_ORDER_RETRIEVAL_WINDOW_HOURS_AFTER_TERMINAL).toBe(24);
    expect(specDescription).toMatch(
      /only available for retrieval while live, or within twenty four hours of reaching a terminal state/i,
    );
  });

  it("records that ID media must be fetched BEFORE acknowledgement", () => {
    // The trap: acknowledging first (to beat the 15-minute clock) permanently revokes
    // access to the government/medical ID images.
    expect(LEAFLY_ORDER_MEDIA_REQUIRES_PRE_ACKNOWLEDGEMENT).toBe(true);
    expect(specDescription).toMatch(
      /only accessible before order acknowledgement and when the order is in pending status/i,
    );
  });

  it("records that enabling the integration makes Leafly's dashboard read-only", () => {
    // Once the toggle flips, there is no manual fallback — so the webhooks cannot ship
    // half-built.
    expect(LEAFLY_ORDER_INTEGRATION_MAKES_DASHBOARD_READ_ONLY).toBe(true);
    expect(specDescription).toMatch(/Leafly Order Dashboard will become read-only/i);
  });
});

describe("THE COMMUNICATIONS RULE — Leafly is the sole originator (owner's Q6)", () => {
  it("is stated verbatim in the spec we vendored", () => {
    // If Leafly ever relaxes this, re-downloading the spec turns this test red and the
    // suppression gets revisited deliberately rather than by accident.
    expect(specDescription).toMatch(
      /Leafly will be the sole originator of automated consumer facing communications/i,
    );
    expect(specDescription).toMatch(
      /Leafly shoppers should receive _no_ automated emails or text messages from a partner system/i,
    );
    expect(specDescription).toMatch(/order confirmation, status updates/i);
  });

  it("suppresses the CUSTOMER email for a Leafly-origin order", () => {
    expect(mayEmailAudienceForOrderOrigin("leafly", "customer")).toBe(false);
  });

  it("still sends the STAFF alert for a Leafly-origin order", () => {
    // The rule is about CONSUMER-facing communications. Leafly does not alert Greenway
    // staff through our system, and the staff alert is what stops a pickup order sitting
    // unnoticed until it auto-cancels at fifteen minutes.
    expect(mayEmailAudienceForOrderOrigin("leafly", "staff")).toBe(true);
  });

  it("applies the same suppression to UberEats-origin orders", () => {
    // UberEats orders arrive through the same Order API and are covered by the same rule.
    // They also carry no customer email address at all, so there is nobody to write to.
    expect(mayEmailAudienceForOrderOrigin("uberEats", "customer")).toBe(false);
    expect(mayEmailAudienceForOrderOrigin("uberEats", "staff")).toBe(true);
    expect(specDescription).toMatch(/No email address/);
  });

  it("leaves OUR OWN storefront's emails completely untouched", () => {
    // This is the half that must not regress. On greenwaymarijuana.com Greenway IS the
    // originator, and the existing confirmation email is the only one the customer gets.
    // A blanket "stop sending order emails" would silence it and nobody would notice
    // until a customer complained.
    expect(mayEmailAudienceForOrderOrigin("greenway", "customer")).toBe(true);
    expect(mayEmailAudienceForOrderOrigin("greenway", "staff")).toBe(true);
  });

  it("scopes the suppression to exactly one audience", () => {
    expect([...LEAFLY_SUPPRESSED_EMAIL_AUDIENCES]).toEqual(["customer"]);
    expect([...LEAFLY_PERMITTED_EMAIL_AUDIENCES]).toEqual(["staff"]);
  });

  it("keeps suppressed and permitted disjoint and exhaustive", () => {
    // Guards against the two ways this degrades: an audience in both lists (ambiguous),
    // or an audience in neither (silently unhandled when a third audience is added).
    for (const audience of LEAFLY_EMAIL_AUDIENCES) {
      const suppressed = (LEAFLY_SUPPRESSED_EMAIL_AUDIENCES as readonly string[]).includes(
        audience,
      );
      const permitted = (LEAFLY_PERMITTED_EMAIL_AUDIENCES as readonly string[]).includes(
        audience,
      );
      expect(suppressed !== permitted, `${audience} must be in exactly one list`).toBe(true);
    }
  });

  it("uses the SAME audience vocabulary as the existing notify pipeline", () => {
    // If `EmailAudience` ever gains a third member (e.g. "delivery_driver"), this fails
    // to compile/assert rather than letting an unclassified audience default to "send".
    const fromNotifyPipeline: EmailAudience[] = ["customer", "staff"];
    expect([...LEAFLY_EMAIL_AUDIENCES].sort()).toEqual([...fromNotifyPipeline].sort());
  });

  it("explains itself in the skip reason it records", () => {
    // `notify-outcome-core.ts` treats "skipped" as a normal, quiet state. A silent skip
    // with no reason is indistinguishable from a broken RESEND_API_KEY at 2am.
    expect(LEAFLY_CUSTOMER_EMAIL_SUPPRESSION_REASON).toMatch(/suppress/i);
    expect(LEAFLY_CUSTOMER_EMAIL_SUPPRESSION_REASON).toMatch(/Leafly/);
    expect(LEAFLY_CUSTOMER_EMAIL_SUPPRESSION_REASON).toMatch(/sole originator/i);
  });

  it("documents the rule for humans, in the doc that is allowed to hold prose", () => {
    const doc = readFileSync(join(REPO_ROOT, "docs", "leafly-order-api-v1.md"), "utf8");
    expect(doc).toMatch(/sole originator/i);
    expect(doc).toMatch(/staff/i);
    // And it must not tell a future reader to suppress everything.
    expect(doc).not.toMatch(/suppress all order emails/i);
  });
});

describe("the prose doc repeats no falsehood (precedent: announcer-docs.test.ts)", () => {
  // Blockquote lines are stripped before matching, so the doc is free to QUOTE a claim it
  // is warning against. This is the exact pattern slice L-1 needed for the menu doc.
  const doc = readFileSync(join(REPO_ROOT, "docs", "leafly-order-api-v1.md"), "utf8");
  const docBody = doc
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");

  /**
   * Whitespace-collapsed copy, for asserting sentences that the markdown hard-wraps.
   * Matching wrapped prose against the raw text makes an assertion hostage to where the
   * line break happens to fall, which is a reformatting away from a false red.
   */
  const docFlat = doc.replace(/\s+/g, " ");

  it("never claims a 4xx is a valid webhook response", () => {
    expect(docBody).not.toMatch(/return\s+4\d\d\s+(?:when|if|on)/i);
  });

  it("never claims the acknowledgement deadline is anything but fifteen minutes", () => {
    const claimed = docBody.match(/acknowledge[^.\n]{0,80}?(\d+)\s*minutes/i);
    if (claimed) expect(Number(claimed[1])).toBe(LEAFLY_ORDER_ACK_DEADLINE_MINUTES);
  });

  it("never claims ID media stay available after acknowledgement", () => {
    expect(docBody).not.toMatch(/media[^.\n]{0,60}after acknowledge/i);
  });

  it("names the sandbox host correctly (leafly.io, not leafly.com)", () => {
    expect(docBody).toContain("reservations-api-sandbox.leafly.io");
  });

  it("still carries the Q6 explanation the owner asked for", () => {
    // Guard the guard: if someone trims the doc down, the tests above that merely check
    // for the ABSENCE of falsehoods would all still pass on an empty file.
    //
    // NOTE: this assertion started life as `/Question 6|sole originator/i` and a mutation
    // (M33) SURVIVED against it — deleting the entire Q6 section left the phrase "sole
    // originator" elsewhere in the doc, so the alternation was satisfied by text that was
    // never the thing being protected. The owner asked for this section specifically
    // ("In the summary report of the first slice, explain it better for me"), so the
    // heading itself is now required, along with each question he actually asked.
    expect(doc).toMatch(/^##+ .*Question 6/im);
    expect(doc.length).toBeGreaterThan(2000);
  });

  it("answers all three parts of what the owner asked about Q6", () => {
    // He asked three distinct things: explain it; what is the professional industry
    // standard; what would Cultivera or the other POS providers do. Each is asserted
    // separately, and each is anchored on the ANSWER rather than on a keyword.
    //
    // NOTE: the first drafts of these assertions were `/industry standard/i`,
    // `/Cultivera/` and `/POSaBIT/`, and mutations M33a-M33d all SURVIVED against them:
    // "industry standard" also appears in the owner's quoted question, and "Cultivera"
    // and "POSaBIT" also appear in the sources list at the bottom. So every one of those
    // regexes was being satisfied by text that was not the thing being protected —
    // the same class of false green that M17b exposed in slice L-1.
    expect(doc).toMatch(/^###+ .*What Cultivera does/im);
    expect(doc).toMatch(/^###+ .*POS providers that DO have order integrations/im);
    expect(docFlat).toMatch(/call it the industry standard/i);
  });

  it("keeps the researched evidence, not just the vendor names", () => {
    // Each comparable must keep its bolded lead-in, which is where its cited behaviour
    // lives. Bare name-drops survive in the sources list and prove nothing.
    expect(doc).toMatch(/\*\*POSaBIT\*\*/);
    expect(doc).toMatch(/\*\*Dutchie\*\*/);
    expect(doc).toMatch(/\*\*Cova\*\*/);
    // The single most direct quote in the whole answer: the POS does not email the
    // customer, Leafly does.
    expect(docFlat).toMatch(/receive a email from Leafly/);
  });

  it("keeps the finding that Cultivera has no order integration at all", () => {
    // Load-bearing fact: there is no Cultivera behaviour to copy, because Leafly orders
    // never reach the Cultivera POS. Softened to "there may be", the section implies a
    // precedent that does not exist.
    expect(docFlat).toContain("There is no Cultivera order-integration article");
    expect(docFlat).toMatch(/under Cultivera, Leafly orders never reach the POS/i);
  });
});

describe("the core's own self-tests pass", () => {
  it("__runLeaflyOrderContractTests() throws nothing", () => {
    expect(() => __runLeaflyOrderContractTests()).not.toThrow();
  });
});
