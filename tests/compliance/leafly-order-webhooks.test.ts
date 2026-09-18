/**
 * tests/compliance/leafly-order-webhooks.test.ts
 *
 * SLICE L-5 — the RECEIVING side of the Leafly Order API.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Slice L-1b proved the order contract's *constants* agree with Leafly's spec. It could not
 * prove that any code exists to serve them, because at that point none did. This slice writes
 * the six receivers, and introduces a failure mode the constants cannot catch:
 *
 *   `LEAFLY_ORDER_WEBHOOK_PATHS` can say we serve `/api/webhooks/leafly/order-submit`
 *   while no such route file exists.
 *
 * In Next.js the URL is the directory path. There is no router table to review, so a contract
 * naming a path that nobody implemented looks completely healthy in code review, passes every
 * type check, and returns 404 to Leafly in production. Leafly's retry-then-auto-cancel
 * behaviour turns that 404 into cancelled customer orders — and because the shop never
 * receives the order, nobody at Greenway is even aware there was something to lose.
 *
 * So this file asserts against the FILESYSTEM as well as the spec:
 *   1. every event in the contract has a real `route.ts` at the declared path;
 *   2. every one of those routes exports a POST handler, on the Node runtime (the Edge
 *      runtime has no `node:crypto` timing-safe compare, so HMAC verification would break);
 *   3. no stray Leafly webhook route exists that the contract does not know about;
 *   4. the six events match the vendored spec's `webhooks` block exactly;
 *   5. the only response code the spec documents for a webhook is 200;
 *   6. `order_preview` — and only `order_preview` — returns a populated body, matching
 *      `OrderPreviewResponse` including its `minimum: 1` floors.
 *
 * Ground truth: docs/leafly-specs/order-api-v1.openapi.json (see docs/leafly-specs/SOURCES.md).
 * Nothing here is asserted from memory of the documentation.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LEAFLY_ORDER_EVENT_TYPES,
  LEAFLY_ORDER_EVENTS_RETURNING_A_BODY,
  LEAFLY_ORDER_WEBHOOK_PATHS,
  LEAFLY_REQUIRED_ORDER_EVENTS,
  LEAFLY_WEBHOOK_OK_STATUS_CODES,
} from "@/lib/leafly/order-contract-core";
import {
  LEAFLY_HMAC_ALGORITHM,
  LEAFLY_SIGNATURE_HEADER,
  LEAFLY_SIGNATURE_HEADER_LOWER,
} from "@/lib/leafly/hmac-core";
import {
  LEAFLY_WEBHOOK_EVENT_TYPES,
  LEAFLY_EVENTS_WITHOUT_AN_ORDER,
} from "@/lib/leafly/webhook-parse-core";
import {
  buildLeaflyPreviewResponse,
  type IncomingPreviewLine,
  type VariantFacts,
  type VariantLookup,
} from "@/lib/leafly/preview-core";
import {
  LEAFLY_ORDER_STATUS_SEQUENCE,
  LEAFLY_CANCEL_REASONS,
  leaflyToGreenwayStatus,
} from "@/lib/leafly/order-map-core";

const REPO_ROOT = process.cwd();
const SPEC_PATH = join(REPO_ROOT, "docs/leafly-specs/order-api-v1.openapi.json");

type OpenApiSpec = {
  webhooks: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, Record<string, unknown>>;
    responses: Record<string, Record<string, unknown>>;
    examples?: Record<string, { value?: unknown }>;
    securitySchemes: Record<string, Record<string, unknown>>;
  };
};

function loadSpec(): OpenApiSpec {
  return JSON.parse(readFileSync(SPEC_PATH, "utf8")) as OpenApiSpec;
}

/** Turn a served URL path into the route file Next.js requires for it. */
function routeFileForPath(urlPath: string): string {
  // "/api/webhooks/leafly/order-submit" -> "src/app/api/webhooks/leafly/order-submit/route.ts"
  return join(REPO_ROOT, "src/app", `${urlPath.replace(/^\//, "")}`, "route.ts");
}

describe("Leafly order webhooks — the vendored spec is the ground truth", () => {
  it("the vendored spec is present and parses", () => {
    expect(existsSync(SPEC_PATH)).toBe(true);
    const spec = loadSpec();
    expect(typeof spec.webhooks).toBe("object");
    expect(Object.keys(spec.webhooks).length).toBeGreaterThan(0);
  });

  it("declares exactly six webhooks, and our event list matches them one-for-one", () => {
    const spec = loadSpec();
    // The spec names webhooks by operationId-ish keys, not by our event names, so the
    // mapping is asserted explicitly rather than string-munged. If Leafly renames or adds
    // a webhook, this test fails and a human decides what it means.
    const specToEvent: Record<string, string> = {
      integrationActivationWebhook: "order_activate",
      integrationDectivationWebhook: "order_deactivate", // Leafly's spelling, sic.
      previewOrderWebhook: "order_preview",
      orderSubmissionWebhook: "order_submit",
      orderCancelationWebhook: "order_cancel",
      orderStatusWebhook: "order_status",
    };
    const specKeys = Object.keys(spec.webhooks).sort();
    expect(specKeys).toEqual(Object.keys(specToEvent).sort());
    expect(Object.values(specToEvent).sort()).toEqual([...LEAFLY_ORDER_EVENT_TYPES].sort());
  });

  it("every spec webhook is a POST, and 200 is the ONLY documented response code", () => {
    const spec = loadSpec();
    for (const [name, item] of Object.entries(spec.webhooks)) {
      const methods = Object.keys(item).filter((k) => k !== "parameters");
      expect(methods, `${name} methods`).toEqual(["post"]);
      const op = item.post as { responses: Record<string, unknown> };
      const codes = Object.keys(op.responses).sort();
      // This is the assertion behind every "fails soft" decision in the receivers: the
      // spec gives us no documented way to say "no". Returning 4xx/5xx to express a
      // business objection is therefore off-contract, and Leafly's retry/auto-cancel
      // behaviour makes it actively harmful.
      expect(codes, `${name} response codes`).toEqual(["200"]);
    }
    expect(LEAFLY_WEBHOOK_OK_STATUS_CODES).toContain(200);
  });

  it("the HMAC scheme in code matches the spec's securityScheme verbatim", () => {
    const spec = loadSpec();
    const scheme = spec.components.securitySchemes.WebhookHMACAuthentication as {
      type: string;
      in: string;
      name: string;
      description: string;
    };
    expect(scheme.type).toBe("apiKey");
    expect(scheme.in).toBe("header");
    // Header name, exactly as Leafly will send it.
    expect(scheme.name).toBe(LEAFLY_SIGNATURE_HEADER);
    expect(LEAFLY_SIGNATURE_HEADER_LOWER).toBe(LEAFLY_SIGNATURE_HEADER.toLowerCase());
    // Algorithm, read out of the prose rather than remembered.
    expect(scheme.description).toContain("HMAC-SHA-256");
    expect(LEAFLY_HMAC_ALGORITHM).toBe("sha256");
    // The spec says the digest is over "the request body" — which is why the receivers
    // read the raw text once and never re-serialise parsed JSON.
    expect(scheme.description).toContain("request body");
  });

  it("order_submit and order_cancel are the spec-required events", () => {
    const spec = loadSpec();
    const raw = readFileSync(SPEC_PATH, "utf8");
    // Both required events must exist as webhooks in the document.
    expect(Object.keys(spec.webhooks)).toContain("orderSubmissionWebhook");
    expect(Object.keys(spec.webhooks)).toContain("orderCancelationWebhook");
    expect([...LEAFLY_REQUIRED_ORDER_EVENTS].sort()).toEqual(["order_cancel", "order_submit"]);
    // And the requirement language must still be in the document we vendored.
    expect(raw).toContain("Required");
  });
});

describe("Leafly order webhooks — the routes actually exist on disk", () => {
  it("every contracted event has a real route.ts at its declared path", () => {
    // The whole point of this file. A path in a constant is not a served endpoint.
    for (const event of LEAFLY_ORDER_EVENT_TYPES) {
      const urlPath = LEAFLY_ORDER_WEBHOOK_PATHS[event];
      const file = routeFileForPath(urlPath);
      expect(existsSync(file), `missing route file for ${event}: ${file}`).toBe(true);
    }
  });

  it("every route exports POST and pins the Node runtime", () => {
    for (const event of LEAFLY_ORDER_EVENT_TYPES) {
      const src = readFileSync(routeFileForPath(LEAFLY_ORDER_WEBHOOK_PATHS[event]), "utf8");
      expect(src, `${event} must export POST`).toMatch(/export\s+(const|async\s+function)\s+POST/);
      // node:crypto's timingSafeEqual does not exist on the Edge runtime. If any of these
      // routes silently became Edge, HMAC verification would throw and — because the
      // receivers fail closed on signature errors — every real order would be rejected.
      expect(src, `${event} must run on nodejs`).toContain('runtime = "nodejs"');
      // Signature verification depends on the exact bytes; caching a webhook response
      // would be meaningless at best.
      expect(src, `${event} must not be statically optimised`).toContain(
        'dynamic = "force-dynamic"',
      );
    }
  });

  it("there is no Leafly webhook route the contract does not know about", () => {
    // Guards the reverse direction: a route added by hand, or left behind after a rename,
    // is an unauthenticated-by-omission public endpoint if nobody remembers it exists.
    const dir = join(REPO_ROOT, "src/app/api/webhooks/leafly");
    expect(existsSync(dir)).toBe(true);
    const served = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => `/api/webhooks/leafly/${e.name}`)
      .sort();
    const contracted = LEAFLY_ORDER_EVENT_TYPES.map(
      (e) => LEAFLY_ORDER_WEBHOOK_PATHS[e] as string,
    ).sort();
    expect(served).toEqual(contracted);
  });

  it("every route verifies the signature rather than trusting the caller", () => {
    // Each route either verifies inline or delegates to the shared handler/factory. What
    // must never happen is a route that parses a body without any signature check at all.
    for (const event of LEAFLY_ORDER_EVENT_TYPES) {
      const src = readFileSync(routeFileForPath(LEAFLY_ORDER_WEBHOOK_PATHS[event]), "utf8");
      const delegates =
        src.includes("createLeaflyWebhookRoute") || src.includes("handleLeaflyWebhook");
      expect(delegates, `${event} must go through the verified webhook handler`).toBe(true);
    }
  });

  it("the shared factory reads the raw body exactly once, and never re-serialises it", () => {
    const factory = readFileSync(
      join(REPO_ROOT, "src/app/api/webhooks/leafly/route-factory.ts"),
      "utf8",
    );
    // HMAC is computed over bytes. `await request.json()` then `JSON.stringify(...)` is the
    // classic way to break signature verification: key order and whitespace are not
    // preserved, so a perfectly genuine webhook fails to verify.
    expect(factory).toContain("request.text()");
    expect(factory).not.toContain("request.json()");
  });
});

describe("Leafly order webhooks — order_preview is the only one that answers with a body", () => {
  it("the contract and the spec agree that only order_preview returns a body", () => {
    const spec = loadSpec();
    const withBody: string[] = [];
    for (const [name, item] of Object.entries(spec.webhooks)) {
      const op = item.post as { responses: Record<string, { $ref?: string; content?: unknown }> };
      const r200 = op.responses["200"];
      if (r200?.$ref || r200?.content) withBody.push(name);
    }
    expect(withBody).toEqual(["previewOrderWebhook"]);
    expect([...LEAFLY_ORDER_EVENTS_RETURNING_A_BODY]).toEqual(["order_preview"]);
  });

  it("OrderPreviewResponse requires cartItems AND taxes", () => {
    const spec = loadSpec();
    const schema = spec.components.schemas.OrderPreviewResponse as {
      required: string[];
      properties: Record<string, unknown>;
    };
    // `taxes` being REQUIRED is why the builder always emits the key, even as `[]` in the
    // tax-inclusive presentation where there are no separate tax lines to report.
    expect([...schema.required].sort()).toEqual(["cartItems", "taxes"]);
  });

  it("our built preview body satisfies the spec schema, including every minimum:1", () => {
    const spec = loadSpec();
    const item = spec.components.schemas.PreviewResponseCartItem as {
      required: string[];
      properties: Record<string, { type: string; minimum?: number }>;
    };
    const tax = spec.components.schemas.TaxComponent as {
      required: string[];
      properties: Record<string, { type: string; minimum?: number }>;
    };
    // Read the floors out of the spec instead of hard-coding them, so that a change to
    // the spec changes the test.
    expect(item.properties.quantity.minimum).toBe(1);
    expect(item.properties.packagePrice.minimum).toBe(1);
    expect(tax.properties.amountCents.minimum).toBe(1);

    const catalogue: Record<string, VariantFacts> = {
      "v-flower": {
        inventoryLevel: 10,
        priceMinorUnits: 5000,
        category: "flower",
        orderable: true,
      },
      "v-merch": { inventoryLevel: 4, priceMinorUnits: 1200, category: "merch", orderable: true },
      // The trap: in stock, orderable, and priced at zero. `minimum: 1` makes it
      // unsendable, so it must be dropped rather than emitted as 0.
      "v-free": { inventoryLevel: 5, priceMinorUnits: 0, category: "flower", orderable: true },
    };
    const lookup: VariantLookup = (id) => catalogue[id] ?? null;
    const lines: IncomingPreviewLine[] = [
      { name: "Blue Dream", integratorVariantId: "v-flower", quantity: 2, packagePrice: 5000 },
      { name: "Tee", integratorVariantId: "v-merch", quantity: 1, packagePrice: 1200 },
      { name: "Freebie", integratorVariantId: "v-free", quantity: 1, packagePrice: 0 },
      { name: "Ghost", integratorVariantId: "does-not-exist", quantity: 1, packagePrice: 999 },
    ];

    for (const presentation of ["tax_inclusive_no_tax_lines", "tax_exclusive_with_tax_lines"] as const) {
      const built = buildLeaflyPreviewResponse({ lines, lookup, presentation });
      const body = built.body as unknown as Record<string, unknown>;

      // Required keys present, and nothing extra that the schema does not declare.
      for (const key of ["cartItems", "taxes"]) {
        expect(Object.keys(body), `${presentation} body keys`).toContain(key);
      }
      expect(Object.keys(body).sort()).toEqual(["cartItems", "taxes"]);

      for (const ci of built.body.cartItems) {
        expect([...item.required].every((k) => k in ci)).toBe(true);
        expect(Object.keys(ci).sort()).toEqual([...item.required].sort());
        expect(Number.isInteger(ci.quantity)).toBe(true);
        expect(ci.quantity).toBeGreaterThanOrEqual(item.properties.quantity.minimum!);
        expect(Number.isInteger(ci.packagePrice)).toBe(true);
        expect(ci.packagePrice).toBeGreaterThanOrEqual(item.properties.packagePrice.minimum!);
        expect(typeof ci.integratorVariantId).toBe("string");
        expect(ci.integratorVariantId.length).toBeGreaterThan(0);
      }
      for (const t of built.body.taxes) {
        expect(Object.keys(t).sort()).toEqual([...tax.required].sort());
        expect(typeof t.label).toBe("string");
        expect(t.label.length).toBeGreaterThan(0);
        expect(Number.isInteger(t.amountCents)).toBe(true);
        expect(t.amountCents).toBeGreaterThanOrEqual(tax.properties.amountCents.minimum!);
      }

      // The zero-priced and unknown lines are gone, the two good lines remain.
      expect(built.body.cartItems.map((c) => c.integratorVariantId).sort()).toEqual([
        "v-flower",
        "v-merch",
      ]);
      // And the money is identical whichever presentation we choose. This is the invariant
      // that makes the unresolved tax-model question safe to ship against.
      expect(built.outTheDoorTotalMinor).toBe(5000 * 2 + 1200);
    }
  });

  it("matches the shape of Leafly's own published example", () => {
    const spec = loadSpec();
    const example = spec.components.examples?.OrderPreviewResponse?.value as {
      cartItems: Record<string, unknown>[];
      taxes: Record<string, unknown>[];
    };
    expect(example).toBeTruthy();
    // Compare key sets with what we emit, so a field Leafly adds to the example shows up
    // here rather than in a support thread.
    const exampleItemKeys = Object.keys(example.cartItems[0]).sort();
    const exampleTaxKeys = Object.keys(example.taxes[0]).sort();

    const catalogue: Record<string, VariantFacts> = {
      "v-flower": {
        inventoryLevel: 10,
        priceMinorUnits: 5000,
        category: "flower",
        orderable: true,
      },
    };
    const built = buildLeaflyPreviewResponse({
      lines: [
        { name: "Blue Dream", integratorVariantId: "v-flower", quantity: 2, packagePrice: 5000 },
      ],
      lookup: (id) => catalogue[id] ?? null,
      presentation: "tax_exclusive_with_tax_lines",
    });
    expect(Object.keys(built.body.cartItems[0]).sort()).toEqual(exampleItemKeys);
    expect(Object.keys(built.body.taxes[0]).sort()).toEqual(exampleTaxKeys);
  });
});

describe("Leafly order webhooks — status vocabulary against the spec", () => {
  it("our Leafly status sequence is exactly the spec's OrderStatus enum", () => {
    const spec = loadSpec();
    const schemas = spec.components.schemas;
    // Find the enum wherever the spec declares it, rather than assuming a schema name.
    const candidates = Object.entries(schemas).filter(([, v]) => {
      const s = v as { enum?: unknown[] };
      return (
        Array.isArray(s.enum) &&
        s.enum.includes("pending") &&
        s.enum.includes("picked_up")
      );
    });
    expect(candidates.length).toBeGreaterThan(0);
    const specEnum = (candidates[0][1] as { enum: string[] }).enum;
    expect([...specEnum].sort()).toEqual([...LEAFLY_ORDER_STATUS_SEQUENCE].sort());
  });

  it("every spec status maps to a Greenway status without throwing", () => {
    for (const status of LEAFLY_ORDER_STATUS_SEQUENCE) {
      const mapped = leaflyToGreenwayStatus(status);
      expect(mapped, `no mapping for ${status}`).toBeTruthy();
    }
  });

  it("Leafly's cancel reasons in code are exactly the spec's enum", () => {
    const spec = loadSpec();
    const schemas = spec.components.schemas;
    const candidates = Object.entries(schemas).filter(([, v]) => {
      const s = v as { enum?: unknown[] };
      return Array.isArray(s.enum) && s.enum.some((x) => String(x).includes("unacknowledged"));
    });
    expect(candidates.length).toBeGreaterThan(0);
    const specEnum = (candidates[0][1] as { enum: string[] }).enum;
    expect([...specEnum].sort()).toEqual([...LEAFLY_CANCEL_REASONS].sort());
  });

  it("the parse core knows the same six events, and which two carry no order", () => {
    expect([...LEAFLY_WEBHOOK_EVENT_TYPES].sort()).toEqual([...LEAFLY_ORDER_EVENT_TYPES].sort());
    // Activation/deactivation are integration-level, not order-level. Treating them as
    // order events would mean looking for an order id that is never going to be there.
    expect([...LEAFLY_EVENTS_WITHOUT_AN_ORDER].sort()).toEqual([
      "order_activate",
      "order_deactivate",
    ]);
  });
});
